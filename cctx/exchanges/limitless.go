package exchanges

import (
	"bytes"
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts"
	ethmath "github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/utils"
)

// Limitless exchange implementation.
type Limitless struct {
	// BaseExchange embeds shared exchange behavior.
	base.BaseExchange
	// privateKey is the signing key for authenticated actions.
	privateKey string
	// host is the REST API base URL.
	host string
	// chainID is the chain ID for EIP-712 signing.
	chainID int64
	// httpClient handles HTTP requests.
	httpClient *http.Client
	// signer is the parsed ECDSA private key.
	signer *ecdsa.PrivateKey
	// address is the derived wallet address.
	address string
	// authenticated indicates login status.
	authenticated bool
	// ownerID is the user profile ID from auth.
	ownerID string
	// tokenToSlug maps token IDs to market slugs.
	tokenToSlug map[string]string
	// noTokens tracks token IDs representing "No" outcomes.
	noTokens map[string]bool
	// ws is the market websocket implementation.
	ws *LimitlessWebSocket
	// userWS is the user websocket implementation.
	userWS *LimitlessUserWebSocket
}

const (
	LimitlessBaseURL = "https://api.limitless.exchange"
	LimitlessWSURL   = "wss://ws.limitless.exchange"
	LimitlessChainID = 8453
)

// LimitlessPricePoint represents a single price history point.
type LimitlessPricePoint struct {
	// Timestamp is the time of the price point.
	Timestamp time.Time
	// Price is the price at that time.
	Price float64
	// Raw holds the raw payload for reference.
	Raw map[string]any
}

// LimitlessPublicTrade represents a public trade from Limitless.
type LimitlessPublicTrade struct {
	// ID is the trade identifier.
	ID string
	// Slug is the market slug.
	Slug string
	// TokenID is the token ID traded.
	TokenID string
	// Side is the trade side.
	Side string
	// Price is the trade price.
	Price float64
	// Size is the trade size.
	Size float64
	// Timestamp is the trade time.
	Timestamp time.Time
	// Maker is the maker address.
	Maker string
	// Taker is the taker address.
	Taker string
	// Outcome is the outcome label.
	Outcome string
	// TransactionHash is the tx hash if available.
	TransactionHash string
}

// NewLimitless creates a new Limitless exchange.
func NewLimitless(config map[string]any) (base.Exchange, error) {
	if config == nil {
		utils.DefaultLogger().Debugf("exchanges.NewLimitless: config is nil")
		return nil, fmt.Errorf("exchanges.NewLimitless: config is nil")
	}
	ex := &Limitless{
		BaseExchange: base.NewBaseExchange(config),
		privateKey:   stringFromConfig(config, "private_key"),
		host:         stringFromConfig(config, "host"),
		tokenToSlug:  map[string]string{},
		noTokens:     map[string]bool{},
	}
	if ex.host == "" {
		ex.host = LimitlessBaseURL
	}
	if raw, ok := config["chain_id"].(float64); ok && raw > 0 {
		ex.chainID = int64(raw)
	} else {
		ex.chainID = LimitlessChainID
	}
	jar, _ := cookiejar.New(nil)
	ex.httpClient = &http.Client{
		Timeout: ex.Timeout,
		Jar:     jar,
	}
	ex.BaseExchange.Bind(ex)
	if ex.privateKey != "" {
		if err := ex.initializeAuth(); err != nil && ex.Verbose {
			fmt.Printf("limitless auth init failed: %v\n", err)
		}
	}
	return ex, nil
}

// ID returns the exchange identifier.
func (l *Limitless) ID() string {
	return "limitless"
}

// Name returns the display name.
func (l *Limitless) Name() string {
	return "Limitless"
}

// initializeAuth sets up signer and authenticates.
func (l *Limitless) initializeAuth() error {
	signer, err := crypto.HexToECDSA(strings.TrimPrefix(l.privateKey, "0x"))
	if err != nil {
		return base.AuthenticationError{Message: fmt.Sprintf("invalid private key: %v", err)}
	}
	l.signer = signer
	l.address = crypto.PubkeyToAddress(signer.PublicKey).Hex()
	return l.authenticate()
}

// authenticate performs the signing login flow.
func (l *Limitless) authenticate() error {
	message, err := l.getSigningMessage()
	if err != nil {
		return err
	}
	hash := accounts.TextHash([]byte(message))
	sig, err := crypto.Sign(hash, l.signer)
	if err != nil {
		return base.AuthenticationError{Message: fmt.Sprintf("failed to sign auth message: %v", err)}
	}
	if sig[64] < 27 {
		sig[64] += 27
	}
	signature := "0x" + hex.EncodeToString(sig)
	messageHex := "0x" + hex.EncodeToString([]byte(message))

	headers := map[string]string{
		"x-account":         l.address,
		"x-signing-message": messageHex,
		"x-signature":       signature,
	}
	payload := map[string]any{"client": "eoa"}
	resp, err := l.requestRaw("POST", "/auth/login", nil, payload, headers)
	if err != nil {
		return err
	}
	var body map[string]any
	if err := json.Unmarshal(resp, &body); err == nil {
		if user, ok := body["user"].(map[string]any); ok {
			l.ownerID = anyString(user["id"])
		} else {
			l.ownerID = anyString(body["id"])
		}
	}
	l.authenticated = true
	return nil
}

// ensureAuthenticated checks that auth is ready.
func (l *Limitless) ensureAuthenticated() error {
	if l.authenticated {
		return nil
	}
	return base.AuthenticationError{Message: "not authenticated; provide private_key in config"}
}

// getSigningMessage fetches the auth signing message.
func (l *Limitless) getSigningMessage() (string, error) {
	resp, err := l.requestRaw("GET", "/auth/signing-message", nil, nil, nil)
	if err != nil {
		return "", err
	}
	message := strings.TrimSpace(string(resp))
	if message == "" {
		return "", base.AuthenticationError{Message: "empty signing message"}
	}
	return message, nil
}

// requestRaw performs a raw HTTP request with retries.
func (l *Limitless) requestRaw(method, endpoint string, params map[string]any, body any, headers map[string]string) ([]byte, error) {
	var result []byte
	err := l.RetryOnFailure(func() error {
		reqURL, err := url.Parse(l.host + endpoint)
		if err != nil {
			return base.ExchangeError{Message: err.Error()}
		}
		if len(params) > 0 {
			query := reqURL.Query()
			for key, value := range params {
				query.Set(key, fmt.Sprintf("%v", value))
			}
			reqURL.RawQuery = query.Encode()
		}

		var reader io.Reader
		if body != nil {
			encoded, err := json.Marshal(body)
			if err != nil {
				return base.ExchangeError{Message: err.Error()}
			}
			reader = bytes.NewReader(encoded)
		}
		req, err := http.NewRequest(method, reqURL.String(), reader)
		if err != nil {
			return base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		resp, err := l.httpClient.Do(req)
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		defer resp.Body.Close()
		payload, _ := io.ReadAll(resp.Body)
		if resp.StatusCode == http.StatusTooManyRequests {
			return base.RateLimitError{Message: "rate limited"}
		}
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return base.AuthenticationError{Message: string(payload)}
		}
		if resp.StatusCode >= 400 {
			return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", resp.StatusCode, string(payload))}
		}
		result = payload
		return nil
	})
	return result, err
}

// requestJSON performs an HTTP request and decodes JSON.
func (l *Limitless) requestJSON(method, endpoint string, params map[string]any, body any, requireAuth bool) (any, error) {
	if requireAuth {
		if err := l.ensureAuthenticated(); err != nil {
			return nil, err
		}
	}
	payload, err := l.requestRaw(method, endpoint, params, body, nil)
	if err != nil {
		if requireAuth && (strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "403")) && l.privateKey != "" {
			if authErr := l.authenticate(); authErr == nil {
				payload, err = l.requestRaw(method, endpoint, params, body, nil)
			}
		}
		if err != nil {
			return nil, err
		}
	}
	if len(payload) == 0 {
		return map[string]any{}, nil
	}
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
	}
	return decoded, nil
}

// FetchMarkets returns markets, optionally paginated.
func (l *Limitless) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if params == nil {
		params = map[string]any{}
	}
	if raw, ok := params["all"].(bool); ok && raw {
		return l.fetchAllMarkets(params)
	}
	page := intFromAny(params["page"], 1)
	limit := intFromAny(params["limit"], 25)
	if limit > 25 {
		limit = 25
	}
	query := map[string]any{"page": page, "limit": limit}
	for key, value := range params {
		if key == "all" || key == "page" || key == "limit" {
			continue
		}
		query[key] = value
	}
	raw, err := l.requestJSON("GET", "/markets/active", query, nil, false)
	if err != nil {
		return nil, err
	}
	marketItems := pickList(raw, "data")
	markets := make([]models.Market, 0, len(marketItems))
	for _, entry := range marketItems {
		market := l.parseMarket(entry)
		if (params["active"] == true || params["closed"] == false) && !market.IsOpen() {
			continue
		}
		markets = append(markets, market)
	}
	return markets, nil
}

// fetchAllMarkets fetches all markets with pagination.
func (l *Limitless) fetchAllMarkets(params map[string]any) ([]models.Market, error) {
	all := []models.Market{}
	page := 1
	for page <= 100 {
		pageParams := map[string]any{"page": page, "limit": 25}
		for k, v := range params {
			if k == "all" {
				continue
			}
			pageParams[k] = v
		}
		batch, err := l.FetchMarkets(pageParams)
		if err != nil {
			return nil, err
		}
		if len(batch) == 0 {
			break
		}
		all = append(all, batch...)
		page++
	}
	return all, nil
}

// FetchMarket fetches a single market by slug or address.
func (l *Limitless) FetchMarket(marketID string) (models.Market, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.FetchMarket: marketID empty")
	}
	raw, err := l.requestJSON("GET", fmt.Sprintf("/markets/%s", marketID), nil, nil, false)
	if err != nil {
		return models.Market{}, base.MarketNotFound{Message: fmt.Sprintf("market %s not found", marketID)}
	}
	return l.parseMarket(raw), nil
}

// FetchMarketsBySlug expands nested markets when present.
func (l *Limitless) FetchMarketsBySlug(slug string) ([]models.Market, error) {
	if slug == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.FetchMarketsBySlug: slug empty")
	}
	market, err := l.FetchMarket(slug)
	if err != nil {
		return []models.Market{}, nil
	}
	nestedRaw, ok := market.Metadata["markets"].([]any)
	if !ok || len(nestedRaw) == 0 {
		return []models.Market{market}, nil
	}
	out := []models.Market{}
	for _, item := range nestedRaw {
		data, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, l.parseNestedMarket(data, slug))
	}
	return out, nil
}

// parseNestedMarket parses a nested market entry.
func (l *Limitless) parseNestedMarket(data map[string]any, parentSlug string) models.Market {
	title := anyString(data["title"])
	if title == "" {
		title = anyString(data["question"])
	}
	prices := map[string]float64{}
	if rawPrices, ok := data["prices"].([]any); ok && len(rawPrices) >= 2 {
		yesPrice := anyFloat(rawPrices[0])
		noPrice := anyFloat(rawPrices[1])
		if yesPrice > 1 {
			yesPrice = yesPrice / 100
		}
		if noPrice > 1 {
			noPrice = noPrice / 100
		}
		prices["Yes"] = yesPrice
		prices["No"] = noPrice
	}
	tokens := anyMap(data["tokens"])
	yesToken := anyString(tokens["yes"])
	noToken := anyString(tokens["no"])
	tokenIDs := []string{}
	if yesToken != "" && noToken != "" {
		tokenIDs = []string{yesToken, noToken}
	}
	closeTime := parseAnyTime(data["deadline"], data["expirationDate"])
	volume := anyFloat(data["volumeFormatted"])
	if volume == 0 {
		volume = anyFloat(data["volume"])
	}
	metadata := cloneMap(data)
	metadata["readable_id"] = []any{parentSlug, title}
	metadata["match_id"] = title
	metadata["tokens"] = map[string]any{"Yes": yesToken, "No": noToken}
	metadata["token_ids"] = tokenIDs
	metadata["clobTokenIds"] = tokenIDs
	metadata["minimum_tick_size"] = 0.001
	if status := strings.ToLower(anyString(data["status"])); status == "resolved" || status == "closed" {
		metadata["closed"] = true
	} else {
		metadata["closed"] = false
	}
	return models.Market{
		ID:        title,
		Question:  title,
		Outcomes:  []string{"Yes", "No"},
		CloseTime: closeTime,
		Volume:    volume,
		Liquidity: 0,
		Prices:    prices,
		Metadata:  metadata,
		TickSize:  0.001,
	}
}

// parseMarket parses a market payload into models.Market.
func (l *Limitless) parseMarket(raw any) models.Market {
	data := anyMap(raw)
	slug := anyString(data["slug"])
	if slug == "" {
		slug = anyString(data["address"])
	}
	title := anyString(data["title"])
	if title == "" {
		title = anyString(data["question"])
	}
	tokens := anyMap(data["tokens"])
	yesToken := anyString(tokens["yes"])
	noToken := anyString(tokens["no"])
	outcomes := []string{"Yes", "No"}
	tokenIDs := []string{}
	if yesToken != "" && noToken != "" {
		tokenIDs = []string{yesToken, noToken}
	}
	prices := map[string]float64{}
	if data["yesPrice"] != nil || data["noPrice"] != nil {
		yesPrice := anyFloat(data["yesPrice"])
		noPrice := anyFloat(data["noPrice"])
		if yesPrice > 1 {
			yesPrice = yesPrice / 100
		}
		if noPrice > 1 {
			noPrice = noPrice / 100
		}
		prices["Yes"] = yesPrice
		prices["No"] = noPrice
	} else if rawPrices, ok := data["prices"].([]any); ok && len(rawPrices) >= 2 {
		yesPrice := anyFloat(rawPrices[0])
		noPrice := anyFloat(rawPrices[1])
		if yesPrice > 1 {
			yesPrice = yesPrice / 100
		}
		if noPrice > 1 {
			noPrice = noPrice / 100
		}
		prices["Yes"] = yesPrice
		prices["No"] = noPrice
	} else if priceMap := anyMap(data["prices"]); len(priceMap) > 0 {
		yesPrice := anyFloat(priceMap["yes"])
		noPrice := anyFloat(priceMap["no"])
		if yesPrice > 1 {
			yesPrice = yesPrice / 100
		}
		if noPrice > 1 {
			noPrice = noPrice / 100
		}
		prices["Yes"] = yesPrice
		prices["No"] = noPrice
	}
	closeTime := parseAnyTime(data["deadline"], data["closeDate"], data["expirationDate"])
	volume := anyFloat(data["volumeFormatted"])
	if volume == 0 {
		volume = anyFloat(data["volume"])
	}
	liquidity := anyFloat(data["liquidityFormatted"])
	if liquidity == 0 {
		liquidity = anyFloat(data["liquidity"])
	}
	metadata := cloneMap(data)
	metadata["slug"] = slug
	metadata["clobTokenIds"] = tokenIDs
	metadata["token_ids"] = tokenIDs
	metadata["tokens"] = map[string]any{"Yes": yesToken, "No": noToken}
	metadata["minimum_tick_size"] = 0.001
	if status := strings.ToLower(anyString(data["status"])); status == "resolved" || status == "closed" {
		metadata["closed"] = true
	} else {
		metadata["closed"] = false
	}
	for _, tokenID := range tokenIDs {
		if tokenID != "" {
			l.tokenToSlug[tokenID] = slug
		}
	}
	if noToken != "" {
		l.noTokens[noToken] = true
	}
	return models.Market{
		ID:          slug,
		Question:    title,
		Outcomes:    outcomes,
		CloseTime:   closeTime,
		Volume:      volume,
		Liquidity:   liquidity,
		Prices:      prices,
		Metadata:    metadata,
		TickSize:    0.001,
		Description: anyString(data["description"]),
	}
}

// GetOrderbook fetches the orderbook for a market or token ID.
func (l *Limitless) GetOrderbook(marketSlugOrTokenID string) (map[string]any, error) {
	if marketSlugOrTokenID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.GetOrderbook: marketSlugOrTokenID empty")
	}
	isNoToken := l.noTokens[marketSlugOrTokenID]
	slug := l.tokenToSlug[marketSlugOrTokenID]
	if slug == "" {
		slug = marketSlugOrTokenID
	}
	resp, err := l.requestJSON("GET", fmt.Sprintf("/markets/%s/orderbook", slug), nil, nil, false)
	if err != nil {
		return map[string]any{"bids": []any{}, "asks": []any{}}, err
	}
	orders := pickList(resp, "orders")
	bids := []map[string]any{}
	asks := []map[string]any{}
	for _, entry := range orders {
		item, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		side := strings.ToLower(anyString(item["side"]))
		price := anyFloat(item["price"])
		size := anyFloat(item["size"])
		if price <= 0 || size <= 0 {
			continue
		}
		level := map[string]any{"price": fmt.Sprintf("%g", price), "size": fmt.Sprintf("%g", size)}
		if side == "buy" {
			bids = append(bids, level)
		} else {
			asks = append(asks, level)
		}
	}
	sortLevels(bids, true)
	sortLevels(asks, false)
	if !isNoToken {
		return map[string]any{"bids": bids, "asks": asks}, nil
	}
	invertedBids := []map[string]any{}
	invertedAsks := []map[string]any{}
	for _, ask := range asks {
		price := anyFloat(ask["price"])
		invertedBids = append(invertedBids, map[string]any{
			"price": fmt.Sprintf("%g", roundTo(priceInverse(price), 3)),
			"size":  ask["size"],
		})
	}
	for _, bid := range bids {
		price := anyFloat(bid["price"])
		invertedAsks = append(invertedAsks, map[string]any{
			"price": fmt.Sprintf("%g", roundTo(priceInverse(price), 3)),
			"size":  bid["size"],
		})
	}
	sortLevels(invertedBids, true)
	sortLevels(invertedAsks, false)
	return map[string]any{"bids": invertedBids, "asks": invertedAsks}, nil
}

// FetchTokenIDs returns token IDs for a market.
func (l *Limitless) FetchTokenIDs(marketID string) ([]string, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.FetchTokenIDs: marketID empty")
	}
	market, err := l.FetchMarket(marketID)
	if err != nil {
		return nil, err
	}
	raw := market.Metadata["clobTokenIds"]
	switch ids := raw.(type) {
	case []string:
		return ids, nil
	case []any:
		out := make([]string, 0, len(ids))
		for _, item := range ids {
			val := anyString(item)
			if val != "" {
				out = append(out, val)
			}
		}
		return out, nil
	}
	return nil, base.ExchangeError{Message: fmt.Sprintf("no token IDs for market %s", marketID)}
}

// CreateOrder places a new order on Limitless.
func (l *Limitless) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.CreateOrder: marketID empty")
	}
	if outcome == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.CreateOrder: outcome empty")
	}
	if price == 0 || size == 0 {
		utils.DefaultLogger().Debugf("exchanges.Limitless.CreateOrder: price or size zero (price=%.6f size=%.6f)", price, size)
	}
	if err := l.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}
	tokenID := anyString(params["token_id"])
	market, err := l.FetchMarket(marketID)
	if err != nil {
		return models.Order{}, err
	}
	if tokenID == "" {
		tokens, _ := market.Metadata["tokens"].(map[string]any)
		tokenID = anyString(tokens[outcome])
		if tokenID == "" {
			return models.Order{}, base.InvalidOrder{Message: fmt.Sprintf("missing token_id for outcome %s", outcome)}
		}
	}
	if price <= 0 || price >= 1 {
		return models.Order{}, base.InvalidOrder{Message: fmt.Sprintf("price must be between 0 and 1, got %f", price)}
	}
	orderType := strings.ToUpper(anyString(params["order_type"]))
	if orderType == "" {
		orderType = "GTC"
	}
	venue := anyMap(market.Metadata["venue"])
	exchangeAddress := anyString(venue["exchange"])
	if exchangeAddress == "" {
		return models.Order{}, base.InvalidOrder{Message: "market missing venue.exchange address"}
	}
	signed, err := l.buildSignedOrder(tokenID, price, size, side, orderType, exchangeAddress, 300)
	if err != nil {
		return models.Order{}, err
	}
	payload := map[string]any{
		"order":      signed,
		"orderType":  orderType,
		"marketSlug": marketID,
	}
	if l.ownerID != "" {
		payload["ownerId"] = l.ownerID
	}
	raw, err := l.requestJSON("POST", "/orders", nil, payload, true)
	if err != nil {
		return models.Order{}, err
	}
	orderData := anyMap(raw)
	if nested := anyMap(orderData["order"]); len(nested) > 0 {
		orderData = nested
	}
	orderID := anyString(orderData["id"])
	if orderID == "" {
		orderID = anyString(orderData["orderId"])
	}
	status := l.parseOrderStatus(anyString(orderData["status"]))
	now := time.Now().UTC()
	return models.Order{
		ID:        orderID,
		MarketID:  marketID,
		Outcome:   outcome,
		Side:      side,
		Price:     price,
		Size:      size,
		Filled:    anyFloat(orderData["filled"]),
		Status:    status,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// buildSignedOrder constructs and signs an order payload.
func (l *Limitless) buildSignedOrder(tokenID string, price, size float64, side models.OrderSide, orderType, exchangeAddress string, feeRateBps int64) (map[string]any, error) {
	timestampMs := time.Now().UnixNano() / int64(time.Millisecond)
	nanoOffset := (time.Now().UnixNano() / 1000) % 1_000_000
	oneDayMs := int64(1000 * 60 * 60 * 24)
	salt := timestampMs*1000 + nanoOffset + oneDayMs

	sharesScale := int64(1_000_000)
	collateralScale := int64(1_000_000)
	priceScale := int64(1_000_000)
	priceTick := int64(0.001 * float64(priceScale))

	shares := int64(size * float64(sharesScale))
	priceInt := int64(price * float64(priceScale))
	if priceTick <= 0 {
		return nil, base.InvalidOrder{Message: "invalid price tick"}
	}
	sharesStep := priceScale / priceTick
	if sharesStep > 0 && shares%sharesStep != 0 {
		shares = (shares / sharesStep) * sharesStep
	}

	numerator := new(big.Int).Mul(big.NewInt(shares), big.NewInt(priceInt))
	numerator.Mul(numerator, big.NewInt(collateralScale))
	denominator := new(big.Int).Mul(big.NewInt(sharesScale), big.NewInt(priceScale))

	sideInt := int64(0)
	if side == models.OrderSideSell {
		sideInt = 1
	}
	var makerAmount, takerAmount *big.Int
	if side == models.OrderSideBuy {
		collateral := new(big.Int).Add(numerator, new(big.Int).Sub(denominator, big.NewInt(1)))
		collateral.Div(collateral, denominator)
		makerAmount = collateral
		takerAmount = big.NewInt(shares)
	} else {
		collateral := new(big.Int).Div(numerator, denominator)
		makerAmount = big.NewInt(shares)
		takerAmount = collateral
	}
	if !makerAmount.IsInt64() || !takerAmount.IsInt64() {
		return nil, base.InvalidOrder{Message: "order amounts overflow"}
	}
	makerAmountInt := makerAmount.Int64()
	takerAmountInt := takerAmount.Int64()

	orderForSigning := map[string]any{
		"salt":          fmt.Sprintf("%d", salt),
		"maker":         l.address,
		"signer":        l.address,
		"taker":         "0x0000000000000000000000000000000000000000",
		"tokenId":       fmt.Sprintf("%s", tokenID),
		"makerAmount":   fmt.Sprintf("%d", makerAmountInt),
		"takerAmount":   fmt.Sprintf("%d", takerAmountInt),
		"expiration":    fmt.Sprintf("%d", 0),
		"nonce":         fmt.Sprintf("%d", 0),
		"feeRateBps":    fmt.Sprintf("%d", feeRateBps),
		"side":          fmt.Sprintf("%d", sideInt),
		"signatureType": fmt.Sprintf("%d", 0),
	}
	signature, err := l.signOrderEIP712(orderForSigning, exchangeAddress)
	if err != nil {
		return nil, err
	}
	order := map[string]any{
		"salt":          salt,
		"maker":         l.address,
		"signer":        l.address,
		"taker":         "0x0000000000000000000000000000000000000000",
		"tokenId":       tokenID,
		"makerAmount":   makerAmountInt,
		"takerAmount":   takerAmountInt,
		"expiration":    "0",
		"nonce":         0,
		"feeRateBps":    feeRateBps,
		"side":          sideInt,
		"signatureType": 0,
		"signature":     signature,
	}
	if strings.ToUpper(orderType) == "GTC" {
		order["price"] = roundTo(price, 3)
	}
	return order, nil
}

// signOrderEIP712 signs an order with EIP-712.
func (l *Limitless) signOrderEIP712(order map[string]any, exchangeAddress string) (string, error) {
	typedData := apitypes.TypedData{
		Types: apitypes.Types{
			"EIP712Domain": {
				{Name: "name", Type: "string"},
				{Name: "version", Type: "string"},
				{Name: "chainId", Type: "uint256"},
				{Name: "verifyingContract", Type: "address"},
			},
			"Order": {
				{Name: "salt", Type: "uint256"},
				{Name: "maker", Type: "address"},
				{Name: "signer", Type: "address"},
				{Name: "taker", Type: "address"},
				{Name: "tokenId", Type: "uint256"},
				{Name: "makerAmount", Type: "uint256"},
				{Name: "takerAmount", Type: "uint256"},
				{Name: "expiration", Type: "uint256"},
				{Name: "nonce", Type: "uint256"},
				{Name: "feeRateBps", Type: "uint256"},
				{Name: "side", Type: "uint8"},
				{Name: "signatureType", Type: "uint8"},
			},
		},
		PrimaryType: "Order",
		Domain: apitypes.TypedDataDomain{
			Name:              "Limitless CTF Exchange",
			Version:           "1",
			ChainId:           ethmath.NewHexOrDecimal256(l.chainID),
			VerifyingContract: exchangeAddress,
		},
		Message: order,
	}
	return signTypedData(l.signer, typedData)
}

// CancelOrder cancels a Limitless order.
func (l *Limitless) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if orderID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.CancelOrder: orderID empty")
	}
	if err := l.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}
	_, err := l.requestJSON("DELETE", fmt.Sprintf("/orders/%s", orderID), nil, nil, true)
	if err != nil {
		return models.Order{}, err
	}
	now := time.Now().UTC()
	return models.Order{
		ID:        orderID,
		MarketID:  stringOrEmpty(marketID),
		Side:      models.OrderSideBuy,
		Status:    models.OrderStatusCancelled,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// FetchOrder fetches a specific order.
func (l *Limitless) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	if orderID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.FetchOrder: orderID empty")
	}
	if err := l.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}
	raw, err := l.requestJSON("GET", fmt.Sprintf("/orders/%s", orderID), nil, nil, true)
	if err != nil {
		return models.Order{}, err
	}
	return l.parseOrder(anyMap(raw), nil), nil
}

// FetchOpenOrders fetches open orders, optionally by market.
func (l *Limitless) FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error) {
	if marketID != nil && *marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.FetchOpenOrders: marketID empty")
	}
	if err := l.ensureAuthenticated(); err != nil {
		return nil, err
	}
	query := map[string]any{}
	for k, v := range params {
		query[k] = v
	}
	endpoint := "/orders"
	if marketID != nil && *marketID != "" {
		endpoint = fmt.Sprintf("/markets/%s/user-orders", *marketID)
		query["statuses"] = "LIVE"
	} else {
		query["statuses"] = "LIVE"
	}
	tokenToOutcome := map[string]string{}
	if marketID != nil && *marketID != "" {
		if market, err := l.FetchMarket(*marketID); err == nil {
			if tokens, ok := market.Metadata["tokens"].(map[string]any); ok {
				for outcome, token := range tokens {
					if tokenStr := anyString(token); tokenStr != "" {
						tokenToOutcome[tokenStr] = outcome
					}
				}
			}
		}
	}
	raw, err := l.requestJSON("GET", endpoint, query, nil, true)
	if err != nil {
		if l.Verbose {
			fmt.Printf("limitless fetch open orders failed: %v\n", err)
		}
		return []models.Order{}, nil
	}
	items := pickList(raw, "data")
	orders := make([]models.Order, 0, len(items))
	for _, entry := range items {
		orders = append(orders, l.parseOrder(anyMap(entry), tokenToOutcome))
	}
	return orders, nil
}

// parseOrder parses an order payload into models.Order.
func (l *Limitless) parseOrder(data map[string]any, tokenToOutcome map[string]string) models.Order {
	orderID := anyString(data["id"])
	if orderID == "" {
		orderID = anyString(data["orderId"])
	}
	marketID := anyString(data["marketSlug"])
	if marketID == "" {
		marketID = anyString(data["market_id"])
	}
	sideRaw := data["side"]
	side := models.OrderSideBuy
	if sideInt, ok := sideRaw.(float64); ok {
		if int(sideInt) == 1 {
			side = models.OrderSideSell
		}
	} else if sideStr := strings.ToLower(anyString(sideRaw)); sideStr == "sell" {
		side = models.OrderSideSell
	}
	status := l.parseOrderStatus(anyString(data["status"]))
	price := anyFloat(data["price"])

	size := anyFloat(data["size"])
	if size == 0 {
		makerAmount := anyFloat(data["makerAmount"])
		takerAmount := anyFloat(data["takerAmount"])
		if side == models.OrderSideBuy {
			size = takerAmount / 1_000_000
		} else {
			size = makerAmount / 1_000_000
		}
	}
	filled := anyFloat(data["filled"])
	if filled == 0 {
		filled = anyFloat(data["matchedAmount"])
	}
	createdAt := parseAnyTime(data["createdAt"])
	updatedAt := parseAnyTime(data["updatedAt"])
	if createdAt == nil {
		now := time.Now().UTC()
		createdAt = &now
	}
	if updatedAt == nil {
		updatedAt = createdAt
	}
	outcome := anyString(data["outcome"])
	if outcome == "" && tokenToOutcome != nil {
		tokenID := anyString(data["token"])
		if tokenID == "" {
			tokenID = anyString(data["tokenId"])
		}
		outcome = tokenToOutcome[tokenID]
	}
	return models.Order{
		ID:        orderID,
		MarketID:  marketID,
		Outcome:   outcome,
		Side:      side,
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    status,
		CreatedAt: *createdAt,
		UpdatedAt: updatedAt,
	}
}

// parseOrderStatus converts status string to enum.
func (l *Limitless) parseOrderStatus(status any) models.OrderStatus {
	statusStr := strings.ToLower(fmt.Sprintf("%v", status))
	switch statusStr {
	case "pending":
		return models.OrderStatusPending
	case "open", "live", "active":
		return models.OrderStatusOpen
	case "filled", "matched":
		return models.OrderStatusFilled
	case "partially_filled", "partial":
		return models.OrderStatusPartiallyFilled
	case "cancelled", "canceled":
		return models.OrderStatusCancelled
	case "rejected":
		return models.OrderStatusRejected
	default:
		return models.OrderStatusOpen
	}
}

// FetchPositions fetches positions, optionally by market.
func (l *Limitless) FetchPositions(marketID *string, _ map[string]any) ([]models.Position, error) {
	if marketID == nil || *marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Limitless.FetchPositions: marketID empty")
	}
	if err := l.ensureAuthenticated(); err != nil {
		return nil, err
	}
	raw, err := l.requestJSON("GET", "/portfolio/positions", nil, nil, true)
	if err != nil {
		if l.Verbose {
			fmt.Printf("limitless fetch positions failed: %v\n", err)
		}
		return []models.Position{}, nil
	}
	response := anyMap(raw)
	clob := pickList(response["clob"], "")
	positions := []models.Position{}
	for _, entry := range clob {
		for _, pos := range l.parsePortfolioPosition(anyMap(entry)) {
			if marketID != nil && *marketID != "" && pos.MarketID != *marketID {
				continue
			}
			positions = append(positions, pos)
		}
	}
	return positions, nil
}

// FetchPositionsForMarket fetches positions for a market object.
func (l *Limitless) FetchPositionsForMarket(market models.Market) ([]models.Position, error) {
	return l.FetchPositions(&market.ID, nil)
}

// parsePortfolioPosition parses portfolio position data.
func (l *Limitless) parsePortfolioPosition(data map[string]any) []models.Position {
	market := anyMap(data["market"])
	marketID := anyString(market["slug"])
	tokensBalance := anyMap(data["tokensBalance"])
	positionDetails := anyMap(data["positions"])
	latestTrade := anyMap(data["latestTrade"])
	positions := []models.Position{}

	yesBalance := anyFloat(tokensBalance["yes"])
	if yesBalance > 0 {
		yesDetails := anyMap(positionDetails["yes"])
		fillPrice := anyFloat(yesDetails["fillPrice"])
		avgPrice := fillPrice
		if fillPrice > 1 {
			avgPrice = fillPrice / 1_000_000
		}
		currentPrice := anyFloat(latestTrade["latestYesPrice"])
		positions = append(positions, models.Position{
			MarketID:     marketID,
			Outcome:      "Yes",
			Size:         yesBalance / 1_000_000,
			AveragePrice: avgPrice,
			CurrentPrice: currentPrice,
		})
	}
	noBalance := anyFloat(tokensBalance["no"])
	if noBalance > 0 {
		noDetails := anyMap(positionDetails["no"])
		fillPrice := anyFloat(noDetails["fillPrice"])
		avgPrice := fillPrice
		if fillPrice > 1 {
			avgPrice = fillPrice / 1_000_000
		}
		currentPrice := anyFloat(latestTrade["latestNoPrice"])
		positions = append(positions, models.Position{
			MarketID:     marketID,
			Outcome:      "No",
			Size:         noBalance / 1_000_000,
			AveragePrice: avgPrice,
			CurrentPrice: currentPrice,
		})
	}
	return positions
}

// FetchBalance fetches account balance.
func (l *Limitless) FetchBalance() (map[string]float64, error) {
	if err := l.ensureAuthenticated(); err != nil {
		return nil, err
	}
	usdcAddress := "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
	baseRPC := "https://mainnet.base.org"
	if l.address != "" {
		data := "0x70a08231000000000000000000000000" + strings.TrimPrefix(strings.ToLower(l.address), "0x")
		payload := map[string]any{
			"jsonrpc": "2.0",
			"method":  "eth_call",
			"params":  []any{map[string]any{"to": usdcAddress, "data": data}, "latest"},
			"id":      1,
		}
		body, err := json.Marshal(payload)
		if err == nil {
			req, _ := http.NewRequest("POST", baseRPC, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := l.httpClient.Do(req)
			if err == nil {
				defer resp.Body.Close()
				responseBody, _ := io.ReadAll(resp.Body)
				var decoded map[string]any
				if err := json.Unmarshal(responseBody, &decoded); err == nil {
					if result, ok := decoded["result"].(string); ok && result != "" {
						value, err := strconv.ParseInt(strings.TrimPrefix(result, "0x"), 16, 64)
						if err == nil {
							return map[string]float64{"USDC": float64(value) / 1_000_000}, nil
						}
					}
				}
			}
		}
	}
	resp, err := l.requestJSON("GET", "/portfolio/trading/allowance", map[string]any{"type": "clob"}, nil, true)
	if err != nil {
		return nil, err
	}
	data := anyMap(resp)
	balance := anyFloat(data["balance"])
	if balance == 0 {
		balance = anyFloat(data["allowance"])
	}
	return map[string]float64{"USDC": balance}, nil
}

// GetWebsocket returns the market websocket.
func (l *Limitless) GetWebsocket() base.OrderbookWebSocket {
	if l.ws == nil {
		l.ws = NewLimitlessWebSocket(map[string]any{
			"exchange":      l,
			"poll_interval": 2 * time.Second,
		})
	}
	return l.ws
}

// GetUserWebsocket returns the user websocket.
func (l *Limitless) GetUserWebsocket() base.UserWebSocket {
	if l.userWS == nil {
		l.userWS = NewLimitlessUserWebSocket(nil)
	}
	return l.userWS
}

// intFromAny converts a value to int with fallback.
func intFromAny(value any, fallback int) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

// anyString converts a value to string.
func anyString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	case fmt.Stringer:
		return v.String()
	case float64:
		if v == math.Trunc(v) {
			return fmt.Sprintf("%.0f", v)
		}
		return fmt.Sprintf("%v", v)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	}
	return ""
}

// anyFloat converts a value to float64.
func anyFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		if parsed, err := v.Float64(); err == nil {
			return parsed
		}
	case string:
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			return parsed
		}
	}
	return 0
}

// anyMap converts a value to map[string]any.
func anyMap(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// pickList extracts a list from a payload.
func pickList(raw any, key string) []any {
	if key == "" {
		if list, ok := raw.([]any); ok {
			return list
		}
	}
	if data, ok := raw.(map[string]any); ok {
		if key != "" {
			if list, ok := data[key].([]any); ok {
				return list
			}
		}
		if list, ok := data["data"].([]any); ok {
			return list
		}
	}
	if list, ok := raw.([]any); ok {
		return list
	}
	return []any{}
}

// cloneMap makes a shallow copy of a map.
func cloneMap(data map[string]any) map[string]any {
	cloned := map[string]any{}
	for k, v := range data {
		cloned[k] = v
	}
	return cloned
}

// parseAnyTime parses various timestamp formats.
func parseAnyTime(values ...any) *time.Time {
	for _, value := range values {
		if value == nil {
			continue
		}
		switch v := value.(type) {
		case time.Time:
			return &v
		case string:
			if v == "" {
				continue
			}
			if ts, err := time.Parse(time.RFC3339, strings.ReplaceAll(v, "Z", "+00:00")); err == nil {
				return &ts
			}
		case float64:
			secs := int64(v)
			ts := time.Unix(secs, 0).UTC()
			return &ts
		case int64:
			ts := time.Unix(v, 0).UTC()
			return &ts
		case int:
			ts := time.Unix(int64(v), 0).UTC()
			return &ts
		}
	}
	return nil
}

// roundTo rounds a float to a number of decimal places.
func roundTo(value float64, places int) float64 {
	factor := math.Pow(10, float64(places))
	return math.Round(value*factor) / factor
}

// priceInverse converts Yes price to No price.
func priceInverse(price float64) float64 {
	return 1 - price
}

// sortLevels sorts price levels in-place.
func sortLevels(levels []map[string]any, descending bool) {
	sortFn := func(i, j int) bool {
		left := anyFloat(levels[i]["price"])
		right := anyFloat(levels[j]["price"])
		if descending {
			return left > right
		}
		return left < right
	}
	for i := 0; i < len(levels); i++ {
		for j := i + 1; j < len(levels); j++ {
			if sortFn(j, i) {
				levels[i], levels[j] = levels[j], levels[i]
			}
		}
	}
}

// stringOrEmpty dereferences a string pointer.
func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// stringFromConfig reads a string config value.
func stringFromConfig(config map[string]any, key string) string {
	if config == nil {
		return ""
	}
	if value, ok := config[key]; ok {
		return anyString(value)
	}
	return ""
}
