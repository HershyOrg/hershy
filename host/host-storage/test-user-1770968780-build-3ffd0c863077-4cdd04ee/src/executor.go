package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/exchanges"
	"github.com/HershyOrg/hershy/cctx/models"
)

const (
	usdcScale        = 1_000_000
	conditionalScale = 1_000_000
)

type TradeExecutor interface {
	GetUSDCAvailable() (float64, error)
	GetTokenBalance(tokenID string) (float64, error)
	ComputeBuyUSDC() (float64, error)
	MarketBuyMax(tokenID string) (*FillResult, error)
	MarketSellAll(tokenID string) (*FillResult, error)
}

type LiveExecutor struct {
	client   *exchanges.Polymarket
	cfg      TradeConfig
	clobHost string
}

func NewLiveExecutor(client *exchanges.Polymarket, cfg TradeConfig, clobHost string) *LiveExecutor {
	return &LiveExecutor{client: client, cfg: cfg, clobHost: clobHost}
}

func (e *LiveExecutor) GetUSDCAvailable() (float64, error) {
	resp, err := e.client.GetBalanceAllowance("COLLATERAL", "", -1)
	if err != nil {
		return 0, err
	}
	balance := safeFloat(resp["balance"])
	allowance := extractAllowance(resp)
	available := balance
	if allowance < available {
		available = allowance
	}
	return available / usdcScale, nil
}

func (e *LiveExecutor) GetTokenBalance(tokenID string) (float64, error) {
	resp, err := e.client.GetBalanceAllowance("CONDITIONAL", tokenID, -1)
	if err != nil {
		return 0, err
	}
	return scaleConditionalBalance(resp["balance"]), nil
}

func (e *LiveExecutor) ComputeBuyUSDC() (float64, error) {
	available, err := e.GetUSDCAvailable()
	if err != nil {
		return 0, err
	}
	available -= e.cfg.ReserveUSDC
	if e.cfg.MaxUSDC != nil {
		if *e.cfg.MaxUSDC < available {
			available = *e.cfg.MaxUSDC
		}
	}
	if available < 0 {
		return 0, nil
	}
	return available, nil
}

func (e *LiveExecutor) MarketBuyMax(tokenID string) (*FillResult, error) {
	amount, err := e.ComputeBuyUSDC()
	if err != nil {
		return nil, err
	}
	if amount < e.cfg.MinUSDC {
		fmt.Printf("[TRADE] skip buy (amount=%.4f < min_usdc=%.4f)\n", amount, e.cfg.MinUSDC)
		return nil, nil
	}
	book, err := fetchOrderbook(e.clobHost, tokenID)
	if err != nil {
		fmt.Printf("[TRADE] orderbook fetch failed: %v\n", err)
		return nil, nil
	}
	fill := simulateMarketBuy(book, amount)
	if fill == nil {
		fmt.Println("[TRADE] buy skipped (no liquidity)")
		return nil, nil
	}
	if e.cfg.OrderType == "FOK" && fill.Partial {
		fmt.Println("[TRADE] buy skipped (FOK partial fill)")
		return nil, nil
	}
	if fill.USDC <= 0 || fill.Shares <= 0 {
		fmt.Println("[TRADE] buy skipped (empty fill)")
		return nil, nil
	}
	if e.cfg.DryRun {
		fmt.Printf("[DRY] market buy token=%s usdc=%.4f shares=%.6f limit=%.4f\n", tokenID, amount, fill.Shares, fill.WorstPrice)
		return &FillResult{USDC: amount, Shares: 0, AvgPrice: nil, Partial: false}, nil
	}
	_, err = e.client.CreateOrderWithType("", "", models.OrderSideBuy, fill.WorstPrice, fill.Shares, e.cfg.OrderType, false, map[string]any{"token_id": tokenID})
	if err != nil {
		fmt.Printf("[TRADE] buy failed: %v\n", err)
		return nil, nil
	}
	fmt.Printf("[TRADE] buy placed token=%s usdc=%.4f shares=%.6f limit=%.4f\n", tokenID, amount, fill.Shares, fill.WorstPrice)
	return &FillResult{USDC: amount, Shares: 0, AvgPrice: nil, Partial: false}, nil
}

func (e *LiveExecutor) MarketSellAll(tokenID string) (*FillResult, error) {
	shares, err := e.GetTokenBalance(tokenID)
	if err != nil {
		return nil, err
	}
	if shares < e.cfg.MinShares {
		fmt.Printf("[TRADE] skip sell (shares=%.6f < min_shares=%.6f)\n", shares, e.cfg.MinShares)
		return nil, nil
	}
	book, err := fetchOrderbook(e.clobHost, tokenID)
	if err != nil {
		fmt.Printf("[TRADE] orderbook fetch failed: %v\n", err)
		return nil, nil
	}
	fill := simulateMarketSell(book, shares)
	if fill == nil {
		fmt.Println("[TRADE] sell skipped (no liquidity)")
		return nil, nil
	}
	if e.cfg.OrderType == "FOK" && fill.Partial {
		fmt.Println("[TRADE] sell skipped (FOK partial fill)")
		return nil, nil
	}
	if fill.USDC <= 0 || fill.Shares <= 0 {
		fmt.Println("[TRADE] sell skipped (empty fill)")
		return nil, nil
	}
	if e.cfg.DryRun {
		fmt.Printf("[DRY] market sell token=%s shares=%.6f limit=%.4f\n", tokenID, shares, fill.WorstPrice)
		return &FillResult{USDC: 0, Shares: shares, AvgPrice: nil, Partial: false}, nil
	}
	_, err = e.client.CreateOrderWithType("", "", models.OrderSideSell, fill.WorstPrice, shares, e.cfg.OrderType, false, map[string]any{"token_id": tokenID})
	if err != nil {
		fmt.Printf("[TRADE] sell failed: %v\n", err)
		return nil, nil
	}
	fmt.Printf("[TRADE] sell placed token=%s shares=%.6f limit=%.4f\n", tokenID, shares, fill.WorstPrice)
	return &FillResult{USDC: 0, Shares: shares, AvgPrice: nil, Partial: false}, nil
}

type PaperExecutor struct {
	cfg         TradeConfig
	paperCfg    PaperConfig
	clobHost    string
	usdcBalance float64
	positions   map[string]float64
}

func NewPaperExecutor(cfg TradeConfig, paperCfg PaperConfig, clobHost string) *PaperExecutor {
	return &PaperExecutor{
		cfg:         cfg,
		paperCfg:    paperCfg,
		clobHost:    clobHost,
		usdcBalance: paperCfg.StartUSDC,
		positions:   map[string]float64{},
	}
}

func (e *PaperExecutor) GetUSDCAvailable() (float64, error) {
	return e.usdcBalance, nil
}

func (e *PaperExecutor) GetTokenBalance(tokenID string) (float64, error) {
	return e.positions[tokenID], nil
}

func (e *PaperExecutor) ComputeBuyUSDC() (float64, error) {
	available := e.usdcBalance - e.cfg.ReserveUSDC
	if e.cfg.MaxUSDC != nil {
		if *e.cfg.MaxUSDC < available {
			available = *e.cfg.MaxUSDC
		}
	}
	if available < 0 {
		return 0, nil
	}
	return available, nil
}

func (e *PaperExecutor) MarketBuyMax(tokenID string) (*FillResult, error) {
	amount, err := e.ComputeBuyUSDC()
	if err != nil {
		return nil, err
	}
	if amount < e.cfg.MinUSDC {
		fmt.Printf("[PAPER] skip buy (amount=%.4f < min_usdc=%.4f)\n", amount, e.cfg.MinUSDC)
		return nil, nil
	}
	book, err := fetchOrderbook(e.clobHost, tokenID)
	if err != nil {
		fmt.Printf("[PAPER] orderbook fetch failed: %v\n", err)
		return nil, nil
	}
	fill := simulateMarketBuy(book, amount)
	if fill == nil {
		fmt.Println("[PAPER] buy skipped (no liquidity)")
		return nil, nil
	}
	if e.cfg.OrderType == "FOK" && fill.Partial {
		fmt.Println("[PAPER] buy skipped (FOK partial fill)")
		return nil, nil
	}
	if fill.USDC <= 0 || fill.Shares <= 0 {
		fmt.Println("[PAPER] buy skipped (empty fill)")
		return nil, nil
	}
	remainingUSDC := amount - fill.USDC
	if remainingUSDC < 0 {
		remainingUSDC = 0
	}
	e.usdcBalance -= fill.USDC
	e.positions[tokenID] = e.positions[tokenID] + fill.Shares
	fmt.Printf("[PAPER] buy token=%s usdc=%.4f shares=%.6f avg_px=%.4f remaining_usdc=%.4f balance=%.4f\n", tokenID, fill.USDC, fill.Shares, derefFloat(fill.AvgPrice), remainingUSDC, e.usdcBalance)
	writePaperLedger(e.paperCfg.LedgerPath, map[string]any{
		"event":          "buy",
		"t_ms":           time.Now().UnixMilli(),
		"token_id":       tokenID,
		"requested_usdc": amount,
		"usdc":           fill.USDC,
		"remaining_usdc": remainingUSDC,
		"shares":         fill.Shares,
		"avg_price":      fill.AvgPrice,
		"partial":        fill.Partial,
		"balance_usdc":   e.usdcBalance,
	})
	return fill, nil
}

func (e *PaperExecutor) MarketSellAll(tokenID string) (*FillResult, error) {
	shares := e.positions[tokenID]
	if shares < e.cfg.MinShares {
		fmt.Printf("[PAPER] skip sell (shares=%.6f < min_shares=%.6f)\n", shares, e.cfg.MinShares)
		return nil, nil
	}
	book, err := fetchOrderbook(e.clobHost, tokenID)
	if err != nil {
		fmt.Printf("[PAPER] orderbook fetch failed: %v\n", err)
		return nil, nil
	}
	fill := simulateMarketSell(book, shares)
	if fill == nil {
		fmt.Println("[PAPER] sell skipped (no liquidity)")
		return nil, nil
	}
	if e.cfg.OrderType == "FOK" && fill.Partial {
		fmt.Println("[PAPER] sell skipped (FOK partial fill)")
		return nil, nil
	}
	if fill.USDC <= 0 || fill.Shares <= 0 {
		fmt.Println("[PAPER] sell skipped (empty fill)")
		return nil, nil
	}
	remainingShares := shares - fill.Shares
	if remainingShares < 0 {
		remainingShares = 0
	}
	e.usdcBalance += fill.USDC
	remaining := e.positions[tokenID] - fill.Shares
	if remaining <= 1e-9 {
		delete(e.positions, tokenID)
	} else {
		e.positions[tokenID] = remaining
	}
	fmt.Printf("[PAPER] sell token=%s usdc=%.4f shares=%.6f avg_px=%.4f remaining_shares=%.6f balance=%.4f\n", tokenID, fill.USDC, fill.Shares, derefFloat(fill.AvgPrice), remainingShares, e.usdcBalance)
	writePaperLedger(e.paperCfg.LedgerPath, map[string]any{
		"event":            "sell",
		"t_ms":             time.Now().UnixMilli(),
		"token_id":         tokenID,
		"requested_shares": shares,
		"usdc":             fill.USDC,
		"remaining_shares": remainingShares,
		"shares":           fill.Shares,
		"avg_price":        fill.AvgPrice,
		"partial":          fill.Partial,
		"balance_usdc":     e.usdcBalance,
	})
	return fill, nil
}

func safeFloat(value any) float64 {
	return toFloat(value)
}

func extractAllowance(resp map[string]any) float64 {
	if resp == nil {
		return 0
	}
	if allowance, ok := resp["allowance"]; ok {
		return safeFloat(allowance)
	}
	if allowances, ok := resp["allowances"].(map[string]any); ok {
		max := 0.0
		for _, v := range allowances {
			fv := safeFloat(v)
			if fv > max {
				max = fv
			}
		}
		return max
	}
	return 0
}

func scaleConditionalBalance(raw any) float64 {
	if raw == nil {
		return 0
	}
	if s, ok := raw.(string); ok && strings.Contains(s, ".") {
		return safeFloat(raw)
	}
	return safeFloat(raw) / conditionalScale
}

func writePaperLedger(path string, payload map[string]any) {
	if path == "" {
		return
	}
	if err := os.MkdirAll(dirName(path), 0o755); err != nil {
		return
	}
	fh, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer fh.Close()
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = fh.Write(append(data, '\n'))
}

func dirName(path string) string {
	idx := strings.LastIndex(path, "/")
	if idx <= 0 {
		return "."
	}
	return path[:idx]
}

func derefFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
