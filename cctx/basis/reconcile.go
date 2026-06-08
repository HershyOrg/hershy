package basis

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

const DefaultReconcileToleranceBps uint32 = 50

// ReconciliationStatus describes how stored state compares with live exposure.
type ReconciliationStatus string

const (
	ReconciliationStatusBalancedOpen               ReconciliationStatus = "balanced_open"
	ReconciliationStatusSpotOnly                   ReconciliationStatus = "spot_only"
	ReconciliationStatusFuturesOnly                ReconciliationStatus = "futures_only"
	ReconciliationStatusStateOnlyOpen              ReconciliationStatus = "state_only_open"
	ReconciliationStatusImbalancedOpen             ReconciliationStatus = "imbalanced_open"
	ReconciliationStatusCleanClosed                ReconciliationStatus = "clean_closed"
	ReconciliationStatusResidualSpotAfterClose     ReconciliationStatus = "residual_spot_after_close"
	ReconciliationStatusResidualFuturesAfterClose  ReconciliationStatus = "residual_futures_after_close"
	ReconciliationStatusResidualExposureAfterClose ReconciliationStatus = "residual_exposure_after_close"
	ReconciliationStatusUnknown                    ReconciliationStatus = "unknown"
)

// ReconciliationAction is the recommended next operational action.
type ReconciliationAction string

const (
	ReconciliationActionNone             ReconciliationAction = "none"
	ReconciliationActionCloseSpotOnly    ReconciliationAction = "close_spot_only"
	ReconciliationActionCloseFuturesOnly ReconciliationAction = "close_futures_only"
	ReconciliationActionCloseBoth        ReconciliationAction = "close_both"
	ReconciliationActionMarkStateClosed  ReconciliationAction = "mark_state_closed_after_manual_check"
	ReconciliationActionInvestigate      ReconciliationAction = "investigate"
)

// Reconciler compares stored basis positions with live DEX and futures exposure.
type Reconciler struct {
	Store         *PositionStore
	DEXReader     base.EVMDEXReader
	Futures       base.FuturesTrader
	WalletAddress string
	Now           func() time.Time
}

// ReconcileRequest controls which stored positions are checked.
type ReconcileRequest struct {
	PositionID           string
	IncludeClosed        bool
	QuantityToleranceBps uint32
}

// ReconciliationReport is a read-only go/no-go and recovery snapshot.
type ReconciliationReport struct {
	GeneratedAt   time.Time                `json:"generated_at"`
	StorePath     string                   `json:"store_path,omitempty"`
	WalletAddress string                   `json:"wallet_address,omitempty"`
	Summary       ReconciliationSummary    `json:"summary"`
	Positions     []PositionReconciliation `json:"positions"`
}

// ReconciliationSummary aggregates recommendations across positions.
type ReconciliationSummary struct {
	Total          int `json:"total"`
	NeedsAction    int `json:"needs_action"`
	BalancedOpen   int `json:"balanced_open"`
	CleanClosed    int `json:"clean_closed"`
	SpotOnly       int `json:"spot_only"`
	FuturesOnly    int `json:"futures_only"`
	ImbalancedOpen int `json:"imbalanced_open"`
}

// PositionReconciliation captures one position's stored-vs-live comparison.
type PositionReconciliation struct {
	PositionID          string                 `json:"position_id"`
	PositionStatus      PositionStatus         `json:"position_status"`
	Status              ReconciliationStatus   `json:"status"`
	RecommendedAction   ReconciliationAction   `json:"recommended_action"`
	Reasons             []string               `json:"reasons,omitempty"`
	ExpectedSpotWei     string                 `json:"expected_spot_wei,omitempty"`
	ActualSpotWei       string                 `json:"actual_spot_wei,omitempty"`
	SpotMatched         bool                   `json:"spot_matched"`
	ExpectedFuturesQty  string                 `json:"expected_futures_qty,omitempty"`
	ActualFuturesAbsQty string                 `json:"actual_futures_abs_qty,omitempty"`
	FuturesMatched      bool                   `json:"futures_matched"`
	SpotExposure        bool                   `json:"spot_exposure"`
	FuturesExposure     bool                   `json:"futures_exposure"`
	SpotBalance         *base.EVMERC20Balance  `json:"spot_balance,omitempty"`
	FuturesPositions    []base.FuturesPosition `json:"futures_positions,omitempty"`
}

// Reconcile checks stored positions against live DEX balances and futures positions.
func (r *Reconciler) Reconcile(request ReconcileRequest) (ReconciliationReport, error) {
	if r == nil {
		return ReconciliationReport{}, errors.New("basis reconciler is nil")
	}
	if r.Store == nil {
		return ReconciliationReport{}, errors.New("basis reconciler store is required")
	}
	if r.DEXReader == nil {
		return ReconciliationReport{}, errors.New("basis reconciler dex reader is required")
	}
	if r.Futures == nil {
		return ReconciliationReport{}, errors.New("basis reconciler futures trader is required")
	}
	if strings.TrimSpace(r.WalletAddress) == "" {
		return ReconciliationReport{}, errors.New("basis reconciler wallet address is required")
	}

	positions, err := r.Store.Load()
	if err != nil {
		return ReconciliationReport{}, err
	}
	selected := selectPositionsForReconcile(positions, request)
	out := ReconciliationReport{
		GeneratedAt:   r.now(),
		StorePath:     r.Store.Path(),
		WalletAddress: r.WalletAddress,
		Positions:     make([]PositionReconciliation, 0, len(selected)),
	}
	for _, position := range selected {
		spot, err := r.DEXReader.FetchERC20Balance(base.EVMERC20BalanceRequest{
			Chain:        position.Spot.Chain,
			TokenAddress: position.Spot.TokenAddress,
			OwnerAddress: r.WalletAddress,
		})
		if err != nil {
			return out, fmt.Errorf("fetch spot balance for %s: %w", position.ID, err)
		}
		symbol := position.Futures.Symbol
		futuresPositions, err := r.Futures.FetchFuturesPositions(&symbol, nil)
		if err != nil {
			return out, fmt.Errorf("fetch futures positions for %s: %w", position.ID, err)
		}
		item := ReconcilePosition(position, spot, futuresPositions, request.QuantityToleranceBps)
		out.Positions = append(out.Positions, item)
		out.Summary.add(item)
	}
	out.Summary.Total = len(out.Positions)
	return out, nil
}

// ReconcilePosition classifies one position using already-fetched live snapshots.
func ReconcilePosition(
	position Position,
	spotBalance base.EVMERC20Balance,
	futuresPositions []base.FuturesPosition,
	toleranceBps uint32,
) PositionReconciliation {
	if toleranceBps == 0 {
		toleranceBps = DefaultReconcileToleranceBps
	}
	expectedSpot := strings.TrimSpace(position.Spot.TokenQtyWei)
	actualSpot := strings.TrimSpace(spotBalance.BalanceWei)
	expectedFutures := strings.TrimSpace(position.Futures.Quantity)
	actualFutures := aggregateFuturesAbsQty(position, futuresPositions)

	spotExposure := positiveInteger(actualSpot)
	futuresExposure := positiveDecimal(actualFutures)
	spotMatched := approxInteger(expectedSpot, actualSpot, toleranceBps)
	futuresMatched := approxDecimal(expectedFutures, actualFutures, toleranceBps)

	item := PositionReconciliation{
		PositionID:          position.ID,
		PositionStatus:      position.Status,
		ExpectedSpotWei:     expectedSpot,
		ActualSpotWei:       actualSpot,
		SpotMatched:         spotMatched,
		ExpectedFuturesQty:  expectedFutures,
		ActualFuturesAbsQty: actualFutures,
		FuturesMatched:      futuresMatched,
		SpotExposure:        spotExposure,
		FuturesExposure:     futuresExposure,
		SpotBalance:         &spotBalance,
		FuturesPositions:    futuresPositions,
	}
	item.Status, item.RecommendedAction, item.Reasons = classifyReconciliation(position, item)
	return item
}

func selectPositionsForReconcile(positions []Position, request ReconcileRequest) []Position {
	out := make([]Position, 0, len(positions))
	for _, position := range positions {
		if request.PositionID != "" && position.ID != request.PositionID {
			continue
		}
		if !request.IncludeClosed && !position.IsOpen() {
			continue
		}
		out = append(out, position)
	}
	return out
}

func classifyReconciliation(position Position, item PositionReconciliation) (ReconciliationStatus, ReconciliationAction, []string) {
	if position.IsOpen() {
		switch {
		case item.SpotMatched && item.FuturesMatched:
			return ReconciliationStatusBalancedOpen, ReconciliationActionNone, []string{"spot and futures exposure match stored open position"}
		case item.SpotExposure && !item.FuturesExposure:
			return ReconciliationStatusSpotOnly, ReconciliationActionCloseSpotOnly, []string{"spot leg exists but no matching futures hedge exists"}
		case !item.SpotExposure && item.FuturesExposure:
			return ReconciliationStatusFuturesOnly, ReconciliationActionCloseFuturesOnly, []string{"futures hedge exists but no matching spot leg exists"}
		case !item.SpotExposure && !item.FuturesExposure:
			return ReconciliationStatusStateOnlyOpen, ReconciliationActionMarkStateClosed, []string{"state is open but no live spot or futures exposure was found"}
		default:
			return ReconciliationStatusImbalancedOpen, ReconciliationActionCloseBoth, []string{"spot and futures exposure exist but do not match stored quantities"}
		}
	}

	switch {
	case !item.SpotExposure && !item.FuturesExposure:
		return ReconciliationStatusCleanClosed, ReconciliationActionNone, []string{"stored position is closed and no live exposure was found"}
	case item.SpotExposure && !item.FuturesExposure:
		return ReconciliationStatusResidualSpotAfterClose, ReconciliationActionCloseSpotOnly, []string{"closed state still has residual spot exposure"}
	case !item.SpotExposure && item.FuturesExposure:
		return ReconciliationStatusResidualFuturesAfterClose, ReconciliationActionCloseFuturesOnly, []string{"closed state still has residual futures exposure"}
	case item.SpotExposure && item.FuturesExposure:
		return ReconciliationStatusResidualExposureAfterClose, ReconciliationActionCloseBoth, []string{"closed state still has residual spot and futures exposure"}
	default:
		return ReconciliationStatusUnknown, ReconciliationActionInvestigate, []string{"unable to classify reconciliation state"}
	}
}

func aggregateFuturesAbsQty(position Position, futuresPositions []base.FuturesPosition) string {
	total := new(big.Rat)
	for _, candidate := range futuresPositions {
		if !strings.EqualFold(strings.TrimSpace(candidate.Symbol), strings.TrimSpace(position.Futures.Symbol)) {
			continue
		}
		if !futuresSideMatches(position.Futures.PositionSide, candidate.PositionSide) {
			continue
		}
		amount, ok := decimalRat(candidate.PositionAmount)
		if !ok {
			continue
		}
		total.Add(total, absRat(amount))
	}
	return ratDecimalString(total, 18)
}

func futuresSideMatches(expected string, actual base.FuturesPositionSide) bool {
	expected = strings.ToUpper(strings.TrimSpace(expected))
	actualText := strings.ToUpper(strings.TrimSpace(string(actual)))
	if expected == "" || expected == string(base.FuturesPositionSideBoth) {
		return actualText == "" || actualText == string(base.FuturesPositionSideBoth) || actualText == string(base.FuturesPositionSideShort)
	}
	if expected == string(base.FuturesPositionSideShort) {
		return actualText == "" || actualText == string(base.FuturesPositionSideBoth) || actualText == string(base.FuturesPositionSideShort)
	}
	return expected == actualText
}

func (s *ReconciliationSummary) add(item PositionReconciliation) {
	if item.RecommendedAction != ReconciliationActionNone {
		s.NeedsAction++
	}
	switch item.Status {
	case ReconciliationStatusBalancedOpen:
		s.BalancedOpen++
	case ReconciliationStatusCleanClosed:
		s.CleanClosed++
	case ReconciliationStatusSpotOnly, ReconciliationStatusResidualSpotAfterClose:
		s.SpotOnly++
	case ReconciliationStatusFuturesOnly, ReconciliationStatusResidualFuturesAfterClose:
		s.FuturesOnly++
	case ReconciliationStatusImbalancedOpen, ReconciliationStatusResidualExposureAfterClose:
		s.ImbalancedOpen++
	}
}

func (r *Reconciler) now() time.Time {
	if r.Now != nil {
		return r.Now().UTC()
	}
	return time.Now().UTC()
}

func positiveInteger(raw string) bool {
	value, ok := new(big.Int).SetString(strings.TrimSpace(raw), 10)
	return ok && value.Sign() > 0
}

func positiveDecimal(raw string) bool {
	value, ok := decimalRat(raw)
	return ok && value.Sign() > 0
}

func approxInteger(expectedRaw, actualRaw string, toleranceBps uint32) bool {
	expected, ok := new(big.Int).SetString(strings.TrimSpace(expectedRaw), 10)
	if !ok {
		return false
	}
	actual, ok := new(big.Int).SetString(strings.TrimSpace(actualRaw), 10)
	if !ok {
		return false
	}
	if expected.Sign() == 0 {
		return actual.Sign() == 0
	}
	diff := new(big.Int).Sub(actual, expected)
	if diff.Sign() < 0 {
		diff.Neg(diff)
	}
	allowed := new(big.Int).Mul(expected, big.NewInt(int64(toleranceBps)))
	allowed.Quo(allowed, big.NewInt(10_000))
	return diff.Cmp(allowed) <= 0
}

func approxDecimal(expectedRaw, actualRaw string, toleranceBps uint32) bool {
	expected, ok := decimalRat(expectedRaw)
	if !ok {
		return false
	}
	actual, ok := decimalRat(actualRaw)
	if !ok {
		return false
	}
	if expected.Sign() == 0 {
		return actual.Sign() == 0
	}
	diff := new(big.Rat).Sub(actual, expected)
	diff = absRat(diff)
	allowed := new(big.Rat).Mul(expected, big.NewRat(int64(toleranceBps), 10_000))
	return diff.Cmp(allowed) <= 0
}

func decimalRat(raw string) (*big.Rat, bool) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return new(big.Rat), true
	}
	value := new(big.Rat)
	if _, ok := value.SetString(text); ok {
		return value, true
	}
	return nil, false
}

func absRat(value *big.Rat) *big.Rat {
	out := new(big.Rat).Set(value)
	if out.Sign() < 0 {
		out.Neg(out)
	}
	return out
}

func ratDecimalString(value *big.Rat, precision int) string {
	if value == nil || value.Sign() == 0 {
		return "0"
	}
	text := value.FloatString(precision)
	text = strings.TrimRight(text, "0")
	text = strings.TrimRight(text, ".")
	if text == "" || text == "-0" {
		return "0"
	}
	return text
}
