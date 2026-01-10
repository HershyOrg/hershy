package exchanges

import (
	"bytes"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	ethmath "github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"

	"host/will/base"
	"host/will/models"
	"host/will/utils"
)

// Opinion exchange implementation.
type Opinion struct {
	// BaseExchange embeds shared exchange behavior.
	base.BaseExchange
	// apiKey is the API key for Opinion.
	apiKey string
	// privateKey is the signing key for orders.
	privateKey string
	// multiSigAddr is the multi-sig address for orders.
	multiSigAddr string
	// rpcURL is the chain RPC URL.
	rpcURL string
	// host is the REST API base URL.
	host string
	// chainID is the chain ID for EIP-712 signing.
	chainID int64
	// httpClient handles HTTP requests.
	httpClient *http.Client
	// signer is the parsed ECDSA private key.
	signer *ecdsa.PrivateKey
	// signerAddr is the derived signer address.
	signerAddr string
}

const (
	OpinionBaseURL      = "https://proxy.opinion.trade:8443"
	OpinionDataURL      = "https://proxy.opinion.trade:8443"
	OpinionChainID      = 56
	OpinionDefaultRPC   = "https://bsc-dataseed.binance.org"
	opinionDomainName   = "OPINION CTF Exchange"
	opinionDomainVer    = "1"
	opinionSignatureTyp = 2
)

// OpinionPricePoint represents a single price history point.
type OpinionPricePoint struct {
	// Timestamp is the time of the price point.
	Timestamp time.Time
	// Price is the price at that time.
	Price float64
	// Raw holds the raw payload for reference.
	Raw map[string]any
}

// OpinionPublicTrade represents a public trade from Opinion.
type OpinionPublicTrade struct {
	// ID is the trade identifier.
	ID string
	// MarketID is the market identifier.
	MarketID string
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

// NewOpinion creates a new Opinion exchange.
func NewOpinion(config map[string]any) (base.Exchange, error) {
	if config == nil {
		utils.DefaultLogger().Debugf("exchanges.NewOpinion: config is nil")
		return nil, fmt.Errorf("exchanges.NewOpinion: config is nil")
	}
	ex := &Opinion{
		BaseExchange: base.NewBaseExchange(config),
		apiKey:       stringFromConfig(config, "api_key"),
		privateKey:   stringFromConfig(config, "private_key"),
		multiSigAddr: stringFromConfig(config, "multi_sig_addr"),
		rpcURL:       stringFromConfig(config, "rpc_url"),
		host:         stringFromConfig(config, "host"),
	}
	if ex.host == "" {
		ex.host = OpinionBaseURL
	}
	if ex.rpcURL == "" {
		ex.rpcURL = OpinionDefaultRPC
	}
	if raw, ok := config["chain_id"].(float64); ok && raw > 0 {
		ex.chainID = int64(raw)
	} else {
		ex.chainID = OpinionChainID
	}
	ex.httpClient = &http.Client{Timeout: ex.Timeout}
	ex.BaseExchange.Bind(ex)
	if ex.privateKey != "" {
		if err := ex.initSigner(); err != nil && ex.Verbose {
			fmt.Printf("opinion signer init failed: %v\n", err)
		}
	}
	return ex, nil
}

// ID returns the exchange identifier.
func (o *Opinion) ID() string {
	return "opinion"
}

// Name returns the display name.
func (o *Opinion) Name() string {
	return "Opinion"
}

// initSigner parses and stores the signing key and address.
func (o *Opinion) initSigner() error {
	signer, err := crypto.HexToECDSA(strings.TrimPrefix(o.privateKey, "0x"))
	if err != nil {
		return base.AuthenticationError{Message: fmt.Sprintf("invalid private key: %v", err)}
	}
	o.signer = signer
	o.signerAddr = crypto.PubkeyToAddress(signer.PublicKey).Hex()
	return nil
}

// ensureClient validates required configuration.
func (o *Opinion) ensureClient() error {
	if o.apiKey == "" || o.privateKey == "" || o.multiSigAddr == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.ensureClient: missing api_key/private_key/multi_sig_addr")
		return base.AuthenticationError{Message: "api_key, private_key, and multi_sig_addr required for Opinion"}
	}
	if o.signer == nil {
		if err := o.initSigner(); err != nil {
			return err
		}
	}
	return nil
}

// requestJSON performs an HTTP request and decodes JSON.
func (o *Opinion) requestJSON(method, endpoint string, params map[string]any, body any) (map[string]any, error) {
	var output map[string]any
	err := o.RetryOnFailure(func() error {
		reqURL, err := url.Parse(o.host + endpoint)
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
		if o.apiKey != "" {
			req.Header.Set("apikey", o.apiKey)
			req.Header.Set("Authorization", "Bearer "+o.apiKey)
			req.Header.Set("X-API-Key", o.apiKey)
		}
		resp, err := o.httpClient.Do(req)
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		defer resp.Body.Close()
		payload, _ := io.ReadAll(resp.Body)
		if resp.StatusCode == http.StatusTooManyRequests {
			return base.RateLimitError{Message: "rate limited"}
		}
		if resp.StatusCode >= 400 {
			return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", resp.StatusCode, string(payload))}
		}
		if err := json.Unmarshal(payload, &output); err != nil {
			return base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
		}
		return nil
	})
	return output, err
}

// parseResultList extracts a list from an OpenAPI response.
func (o *Opinion) parseResultList(response map[string]any, operation string) ([]any, error) {
	if errNo := intFromAny(response["errno"], 0); errNo != 0 {
		return nil, base.ExchangeError{Message: fmt.Sprintf("failed to %s: %v", operation, response)}
	}
	result, _ := response["result"].(map[string]any)
	if list, ok := result["list"].([]any); ok {
		return list, nil
	}
	if data, ok := result["data"].([]any); ok {
		return data, nil
	}
	return nil, base.ExchangeError{Message: fmt.Sprintf("invalid list response for %s", operation)}
}

// parseResultData extracts a data object from an OpenAPI response.
func (o *Opinion) parseResultData(response map[string]any, operation string) (map[string]any, error) {
	if errNo := intFromAny(response["errno"], 0); errNo != 0 {
		return nil, base.ExchangeError{Message: fmt.Sprintf("failed to %s: %v", operation, response)}
	}
	result, _ := response["result"].(map[string]any)
	if data, ok := result["data"].(map[string]any); ok {
		return data, nil
	}
	if data, ok := result["data"].([]any); ok && len(data) > 0 {
		if first, ok := data[0].(map[string]any); ok {
			return first, nil
		}
	}
	if data, ok := result["orderData"].(map[string]any); ok {
		return data, nil
	}
	if data, ok := result["order_data"].(map[string]any); ok {
		return data, nil
	}
	return result, nil
}

// FetchMarkets returns markets with optional filters.
func (o *Opinion) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if err := o.ensureClient(); err != nil {
		return nil, err
	}
	if params == nil {
		params = map[string]any{}
	}
	if raw, ok := params["all"].(bool); ok && raw {
		return o.fetchAllMarkets(params)
	}
	page := intFromAny(params["page"], 1)
	limit := intFromAny(params["limit"], 20)
	if limit > 20 {
		limit = 20
	}
	status := anyString(params["status"])
	if params["active"] == true || params["closed"] == false {
		status = "activated"
	}
	topicType := parseOpinionTopicType(params["topic_type"])
	query := map[string]any{
		"page":       page,
		"limit":      limit,
		"marketType": topicType,
		"chainId":    fmt.Sprintf("%d", o.chainID),
	}
	if status != "" {
		query["status"] = status
	}
	if sortBy := anyString(params["sort_by"]); sortBy != "" {
		query["sortBy"] = sortBy
	}
	resp, err := o.requestJSON("GET", "/openapi/market", query, nil)
	if err != nil {
		return nil, err
	}
	items, err := o.parseResultList(resp, "fetch markets")
	if err != nil {
		return nil, err
	}
	markets := make([]models.Market, 0, len(items))
	for _, entry := range items {
		markets = append(markets, o.parseMarket(anyMap(entry), false))
	}
	if rawLimit, ok := params["limit"].(int); ok && rawLimit > 0 && len(markets) > rawLimit {
		markets = markets[:rawLimit]
	}
	return markets, nil
}

// fetchAllMarkets fetches all markets with pagination.
func (o *Opinion) fetchAllMarkets(params map[string]any) ([]models.Market, error) {
	all := []models.Market{}
	page := 1
	for page <= 100 {
		pageParams := map[string]any{"page": page, "limit": 20}
		for k, v := range params {
			if k == "all" {
				continue
			}
			pageParams[k] = v
		}
		batch, err := o.FetchMarkets(pageParams)
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

// FetchMarket fetches a market by ID.
func (o *Opinion) FetchMarket(marketID string) (models.Market, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.FetchMarket: marketID empty")
	}
	if err := o.ensureClient(); err != nil {
		return models.Market{}, err
	}
	resp, err := o.requestJSON("GET", fmt.Sprintf("/openapi/market/%s", marketID), nil, nil)
	if err == nil {
		if data, err := o.parseResultData(resp, "fetch market"); err == nil {
			return o.parseMarket(data, true), nil
		}
	}
	resp, err = o.requestJSON("GET", fmt.Sprintf("/openapi/market/categorical/%s", marketID), nil, nil)
	if err != nil {
		return models.Market{}, base.MarketNotFound{Message: fmt.Sprintf("market %s not found", marketID)}
	}
	data, err := o.parseResultData(resp, "fetch categorical market")
	if err != nil {
		return models.Market{}, err
	}
	return o.parseMarket(data, true), nil
}

// GetOrderbook fetches the orderbook for a token.
func (o *Opinion) GetOrderbook(tokenID string) (map[string]any, error) {
	if tokenID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.GetOrderbook: tokenID empty")
	}
	if err := o.ensureClient(); err != nil {
		return map[string]any{"bids": []any{}, "asks": []any{}}, err
	}
	resp, err := o.requestJSON("GET", "/openapi/token/orderbook", map[string]any{"token_id": tokenID}, nil)
	if err != nil {
		return map[string]any{"bids": []any{}, "asks": []any{}}, err
	}
	data, err := o.parseResultData(resp, "fetch orderbook")
	if err != nil {
		return map[string]any{"bids": []any{}, "asks": []any{}}, nil
	}
	bids := []map[string]any{}
	asks := []map[string]any{}
	for _, entry := range pickList(data["bids"], "") {
		level := anyMap(entry)
		price := anyFloat(level["price"])
		size := anyFloat(level["size"])
		if price > 0 && size > 0 {
			bids = append(bids, map[string]any{"price": fmt.Sprintf("%g", price), "size": fmt.Sprintf("%g", size)})
		}
	}
	for _, entry := range pickList(data["asks"], "") {
		level := anyMap(entry)
		price := anyFloat(level["price"])
		size := anyFloat(level["size"])
		if price > 0 && size > 0 {
			asks = append(asks, map[string]any{"price": fmt.Sprintf("%g", price), "size": fmt.Sprintf("%g", size)})
		}
	}
	sortLevels(bids, true)
	sortLevels(asks, false)
	return map[string]any{"bids": bids, "asks": asks}, nil
}

// FetchTokenIDs returns token IDs for a market.
func (o *Opinion) FetchTokenIDs(marketID string) ([]string, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.FetchTokenIDs: marketID empty")
	}
	market, err := o.FetchMarket(marketID)
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

// CreateOrder places a new Opinion order.
func (o *Opinion) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.CreateOrder: marketID empty")
	}
	if outcome == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.CreateOrder: outcome empty")
	}
	if price == 0 || size == 0 {
		utils.DefaultLogger().Debugf("exchanges.Opinion.CreateOrder: price or size zero (price=%.6f size=%.6f)", price, size)
	}
	if err := o.ensureClient(); err != nil {
		return models.Order{}, err
	}
	tokenID := anyString(params["token_id"])
	if tokenID == "" {
		return models.Order{}, base.InvalidOrder{Message: "token_id required in params"}
	}
	if price <= 0 || price >= 1 {
		return models.Order{}, base.InvalidOrder{Message: fmt.Sprintf("price must be between 0 and 1, got: %f", price)}
	}
	orderType := 2
	if strings.ToLower(anyString(params["order_type"])) == "market" {
		orderType = 1
	}
	sideInt := 0
	if side == models.OrderSideSell {
		sideInt = 1
	}
	orderInput := opinionPlaceOrderInput{
		MarketID: marketID,
		TokenID:  tokenID,
		Price:    price,
		Side:     sideInt,
		Type:     orderType,
	}
	if side == models.OrderSideBuy {
		orderInput.MakerAmountInQuote = size
	} else {
		orderInput.MakerAmountInBase = size
	}
	result, err := o.placeOrder(orderInput, params)
	if err != nil {
		return models.Order{}, err
	}
	orderID := anyString(result["orderId"])
	if orderID == "" {
		orderID = anyString(result["order_id"])
	}
	now := time.Now().UTC()
	return models.Order{
		ID:        orderID,
		MarketID:  marketID,
		Outcome:   outcome,
		Side:      side,
		Price:     price,
		Size:      size,
		Filled:    0,
		Status:    models.OrderStatusOpen,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// placeOrder builds and submits an order payload.
func (o *Opinion) placeOrder(input opinionPlaceOrderInput, params map[string]any) (map[string]any, error) {
	quoteTokens, err := o.getQuoteTokens()
	if err != nil {
		return nil, err
	}
	marketResp, err := o.requestJSON("GET", fmt.Sprintf("/openapi/market/%s", input.MarketID), nil, nil)
	if err != nil {
		return nil, err
	}
	market, err := o.parseResultData(marketResp, "get market for place order")
	if err != nil {
		return nil, err
	}
	if chainID := anyString(market["chainId"]); chainID != "" && chainID != fmt.Sprintf("%d", o.chainID) {
		return nil, base.ExchangeError{Message: "cannot place order on different chain"}
	}
	quoteTokenAddr := strings.ToLower(anyString(market["quoteToken"]))
	quoteToken := map[string]any{}
	for _, item := range quoteTokens {
		token := anyMap(item)
		if strings.ToLower(anyString(token["quoteTokenAddress"])) == quoteTokenAddr {
			quoteToken = token
			break
		}
	}
	if len(quoteToken) == 0 {
		return nil, base.ExchangeError{Message: "quote token not found for this market"}
	}
	exchangeAddr := anyString(quoteToken["ctfExchangeAddress"])
	decimals := intFromAny(quoteToken["decimal"], 6)
	if exchangeAddr == "" {
		return nil, base.ExchangeError{Message: "missing ctfExchangeAddress for quote token"}
	}
	makerAmount := 0.0
	if input.Side == 0 {
		if input.MakerAmountInBase > 0 {
			makerAmount = input.MakerAmountInBase * input.Price
			if input.MakerAmountInBase < 1 {
				return nil, base.InvalidOrder{Message: "makerAmountInBaseToken must be at least 1"}
			}
		} else if input.MakerAmountInQuote > 0 {
			makerAmount = input.MakerAmountInQuote
			if input.MakerAmountInQuote < 1 {
				return nil, base.InvalidOrder{Message: "makerAmountInQuoteToken must be at least 1"}
			}
		} else {
			return nil, base.InvalidOrder{Message: "maker amount required for BUY"}
		}
	} else {
		if input.MakerAmountInBase > 0 {
			makerAmount = input.MakerAmountInBase
			if input.MakerAmountInBase < 1 {
				return nil, base.InvalidOrder{Message: "makerAmountInBaseToken must be at least 1"}
			}
		} else if input.MakerAmountInQuote > 0 {
			if input.Price == 0 {
				return nil, base.InvalidOrder{Message: "price cannot be zero for SELL with quote amount"}
			}
			makerAmount = input.MakerAmountInQuote / input.Price
			if input.MakerAmountInQuote < 1 {
				return nil, base.InvalidOrder{Message: "makerAmountInQuoteToken must be at least 1"}
			}
		} else {
			return nil, base.InvalidOrder{Message: "maker amount required for SELL"}
		}
	}
	if makerAmount <= 0 {
		return nil, base.InvalidOrder{Message: fmt.Sprintf("invalid maker amount: %f", makerAmount)}
	}
	orderReq, err := o.buildOrderRequest(opinionOrderInput{
		MarketID:    input.MarketID,
		TokenID:     input.TokenID,
		MakerAmount: makerAmount,
		Price:       input.Price,
		Type:        input.Type,
		Side:        input.Side,
	}, exchangeAddr, quoteTokenAddr, decimals)
	if err != nil {
		return nil, err
	}
	resp, err := o.requestJSON("POST", "/openapi/order", nil, orderReq)
	if err != nil {
		return nil, err
	}
	data, _ := o.parseResultData(resp, "place order")
	if data == nil {
		return map[string]any{}, nil
	}
	return data, nil
}

// buildOrderRequest constructs a signed order request.
func (o *Opinion) buildOrderRequest(input opinionOrderInput, exchangeAddr, currencyAddr string, decimals int) (map[string]any, error) {
	if input.Type == 2 {
		if _, err := validateOpinionPrice(input.Price); err != nil {
			return nil, err
		}
	}
	makerAmountWei, err := safeAmountToWei(input.MakerAmount, decimals)
	if err != nil {
		return nil, err
	}
	var makerAmount, takerAmount *big.Int
	if input.Type == 1 {
		makerAmount = makerAmountWei
		takerAmount = big.NewInt(0)
		input.Price = 0
	} else {
		recalcMaker, taker, err := calculateOrderAmounts(input.Price, makerAmountWei, input.Side)
		if err != nil {
			return nil, err
		}
		makerAmount = recalcMaker
		takerAmount = taker
	}
	if o.signer == nil {
		return nil, base.AuthenticationError{Message: "missing signer"}
	}
	order := map[string]any{
		"salt":          generateOpinionSalt(),
		"maker":         strings.ToLower(o.multiSigAddr),
		"signer":        strings.ToLower(o.signerAddr),
		"taker":         "0x0000000000000000000000000000000000000000",
		"tokenId":       input.TokenID,
		"makerAmount":   makerAmount.String(),
		"takerAmount":   takerAmount.String(),
		"expiration":    "0",
		"nonce":         "0",
		"feeRateBps":    "0",
		"side":          fmt.Sprintf("%d", input.Side),
		"signatureType": fmt.Sprintf("%d", opinionSignatureTyp),
	}
	signature, err := o.signOrder(order, exchangeAddr)
	if err != nil {
		return nil, err
	}
	priceStr := fmt.Sprintf("%g", input.Price)
	orderReq := map[string]any{
		"salt":            order["salt"],
		"topicId":         parseMarketID(input.MarketID),
		"maker":           order["maker"],
		"signer":          order["signer"],
		"taker":           order["taker"],
		"tokenId":         order["tokenId"],
		"makerAmount":     order["makerAmount"],
		"takerAmount":     order["takerAmount"],
		"expiration":      order["expiration"],
		"nonce":           order["nonce"],
		"feeRateBps":      order["feeRateBps"],
		"side":            order["side"],
		"signatureType":   order["signatureType"],
		"signature":       signature,
		"sign":            signature,
		"contractAddress": "",
		"currencyAddress": currencyAddr,
		"price":           priceStr,
		"tradingMethod":   input.Type,
		"timestamp":       int(time.Now().Unix()),
		"safeRate":        "0",
		"orderExpTime":    "0",
	}
	return orderReq, nil
}

// signOrder signs an order using EIP-712.
func (o *Opinion) signOrder(order map[string]any, exchangeAddr string) (string, error) {
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
			Name:              opinionDomainName,
			Version:           opinionDomainVer,
			ChainId:           ethmath.NewHexOrDecimal256(o.chainID),
			VerifyingContract: exchangeAddr,
		},
		Message: order,
	}
	return signTypedData(o.signer, typedData)
}

// CancelOrder cancels an order by ID.
func (o *Opinion) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if orderID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.CancelOrder: orderID empty")
	}
	if err := o.ensureClient(); err != nil {
		return models.Order{}, err
	}
	payload := map[string]any{"orderId": orderID}
	_, err := o.requestJSON("POST", "/openapi/order/cancel", nil, payload)
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

// FetchOrder fetches an order by ID.
func (o *Opinion) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	if orderID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.FetchOrder: orderID empty")
	}
	if err := o.ensureClient(); err != nil {
		return models.Order{}, err
	}
	resp, err := o.requestJSON("GET", fmt.Sprintf("/openapi/order/%s", orderID), nil, nil)
	if err != nil {
		return models.Order{}, err
	}
	data, err := o.parseResultData(resp, "fetch order")
	if err != nil {
		return models.Order{}, err
	}
	return o.parseOrder(data), nil
}

// FetchOpenOrders fetches open orders.
func (o *Opinion) FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error) {
	if marketID != nil && *marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.FetchOpenOrders: marketID empty")
	}
	if err := o.ensureClient(); err != nil {
		return nil, err
	}
	query := map[string]any{
		"page":    intFromAny(params["page"], 1),
		"limit":   intFromAny(params["limit"], 10),
		"status":  "1",
		"chainId": fmt.Sprintf("%d", o.chainID),
	}
	if marketID != nil && *marketID != "" {
		query["marketId"] = parseMarketID(*marketID)
	}
	resp, err := o.requestJSON("GET", "/openapi/order", query, nil)
	if err != nil {
		if o.Verbose {
			fmt.Printf("opinion fetch open orders failed: %v\n", err)
		}
		return []models.Order{}, nil
	}
	items, err := o.parseResultList(resp, "fetch open orders")
	if err != nil {
		return []models.Order{}, nil
	}
	orders := make([]models.Order, 0, len(items))
	for _, entry := range items {
		orders = append(orders, o.parseOrder(anyMap(entry)))
	}
	return orders, nil
}

// parseOrder parses an order payload into models.Order.
func (o *Opinion) parseOrder(data map[string]any) models.Order {
	orderID := anyString(data["orderId"])
	if orderID == "" {
		orderID = anyString(data["id"])
	}
	marketID := anyString(data["topic_id"])
	if marketID == "" {
		marketID = anyString(data["marketId"])
	}
	side := models.OrderSideBuy
	sideEnum := strings.ToLower(anyString(data["sideEnum"]))
	if sideEnum != "" {
		if sideEnum == "sell" {
			side = models.OrderSideSell
		}
	} else if sideRaw, ok := data["side"].(float64); ok {
		if int(sideRaw) == 1 {
			side = models.OrderSideSell
		}
	}
	status := parseOpinionOrderStatus(data["status"])
	price := anyFloat(data["price"])
	size := anyFloat(data["orderShares"])
	if size == 0 {
		size = anyFloat(data["maker_amount"])
		if size == 0 {
			size = anyFloat(data["size"])
		}
	}
	filled := anyFloat(data["filledShares"])
	if filled == 0 {
		filled = anyFloat(data["matched_amount"])
	}
	createdAt := parseAnyTime(data["createdAt"], data["timestamp"])
	updatedAt := parseAnyTime(data["updatedAt"])
	if createdAt == nil {
		now := time.Now().UTC()
		createdAt = &now
	}
	if updatedAt == nil {
		updatedAt = createdAt
	}
	return models.Order{
		ID:        orderID,
		MarketID:  marketID,
		Outcome:   anyString(data["outcome"]),
		Side:      side,
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    status,
		CreatedAt: *createdAt,
		UpdatedAt: updatedAt,
	}
}

// FetchPositions fetches positions.
func (o *Opinion) FetchPositions(marketID *string, params map[string]any) ([]models.Position, error) {
	if marketID == nil || *marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Opinion.FetchPositions: marketID empty")
	}
	if err := o.ensureClient(); err != nil {
		return nil, err
	}
	query := map[string]any{
		"page":    intFromAny(params["page"], 1),
		"limit":   intFromAny(params["limit"], 10),
		"chainId": fmt.Sprintf("%d", o.chainID),
	}
	if marketID != nil && *marketID != "" {
		query["marketId"] = parseMarketID(*marketID)
	}
	resp, err := o.requestJSON("GET", "/openapi/positions", query, nil)
	if err != nil {
		if o.Verbose {
			fmt.Printf("opinion fetch positions failed: %v\n", err)
		}
		return []models.Position{}, nil
	}
	items, err := o.parseResultList(resp, "fetch positions")
	if err != nil {
		return []models.Position{}, nil
	}
	positions := make([]models.Position, 0, len(items))
	for _, entry := range items {
		positions = append(positions, o.parsePosition(anyMap(entry)))
	}
	return positions, nil
}

// FetchPositionsForMarket fetches positions for a market object.
func (o *Opinion) FetchPositionsForMarket(market models.Market) ([]models.Position, error) {
	return o.FetchPositions(&market.ID, nil)
}

// parsePosition parses a position payload into models.Position.
func (o *Opinion) parsePosition(data map[string]any) models.Position {
	marketID := anyString(data["topic_id"])
	if marketID == "" {
		marketID = anyString(data["marketId"])
	}
	outcome := anyString(data["outcome"])
	if outcome == "" {
		outcome = anyString(data["token_name"])
	}
	size := anyFloat(data["sharesOwned"])
	if size == 0 {
		size = anyFloat(data["size"])
	}
	avgPrice := anyFloat(data["avgEntryPrice"])
	if avgPrice == 0 {
		avgPrice = anyFloat(data["average_price"])
	}
	currentPrice := anyFloat(data["current_price"])
	if currentPrice == 0 {
		currentPrice = anyFloat(data["price"])
	}
	return models.Position{
		MarketID:     marketID,
		Outcome:      outcome,
		Size:         size,
		AveragePrice: avgPrice,
		CurrentPrice: currentPrice,
	}
}

// FetchBalance fetches account balance.
func (o *Opinion) FetchBalance() (map[string]float64, error) {
	if err := o.ensureClient(); err != nil {
		return nil, err
	}
	resp, err := o.requestJSON("GET", "/openapi/user/balance", map[string]any{"chain_id": fmt.Sprintf("%d", o.chainID)}, nil)
	if err != nil {
		return nil, err
	}
	if errNo := intFromAny(resp["errno"], 0); errNo != 0 {
		return nil, base.ExchangeError{Message: fmt.Sprintf("failed to fetch balance: %v", resp)}
	}
	result := anyMap(resp["result"])
	balances := map[string]float64{}
	if items, ok := result["balances"].([]any); ok {
		for _, entry := range items {
			item := anyMap(entry)
			balance := anyFloat(item["availableBalance"])
			if balance == 0 {
				balance = anyFloat(item["available_balance"])
			}
			if balance > 0 {
				balances["USDC"] = balance
				break
			}
		}
	}
	return balances, nil
}

// parseMarket parses a market payload into models.Market.
func (o *Opinion) parseMarket(data map[string]any, fetchPrices bool) models.Market {
	marketID := anyString(data["marketId"])
	if marketID == "" {
		marketID = anyString(data["topic_id"])
	}
	if marketID == "" {
		marketID = anyString(data["id"])
	}
	question := anyString(data["marketTitle"])
	if question == "" {
		question = anyString(data["title"])
	}
	if question == "" {
		question = anyString(data["question"])
	}
	yesToken := anyString(data["yesTokenId"])
	noToken := anyString(data["noTokenId"])
	yesLabel := anyString(data["yesLabel"])
	if yesLabel == "" {
		yesLabel = "Yes"
	}
	noLabel := anyString(data["noLabel"])
	if noLabel == "" {
		noLabel = "No"
	}
	outcomes := []string{}
	tokenIDs := []string{}
	childMarkets := []map[string]any{}
	if yesToken != "" && noToken != "" {
		outcomes = []string{yesLabel, noLabel}
		tokenIDs = []string{yesToken, noToken}
	} else if rawChildren, ok := data["childMarkets"].([]any); ok && len(rawChildren) > 0 {
		for _, entry := range rawChildren {
			child := anyMap(entry)
			title := anyString(child["marketTitle"])
			if title == "" {
				continue
			}
			childYes := anyString(child["yesTokenId"])
			if childYes == "" {
				continue
			}
			outcomes = append(outcomes, title)
			tokenIDs = append(tokenIDs, childYes)
			childMarkets = append(childMarkets, map[string]any{
				"market_id":    anyString(child["marketId"]),
				"title":        title,
				"yes_token_id": childYes,
				"no_token_id":  anyString(child["noTokenId"]),
				"volume":       anyString(child["volume"]),
			})
		}
	}
	if len(outcomes) == 0 {
		outcomes = []string{"Yes", "No"}
	}
	prices := map[string]float64{}
	if fetchPrices && len(tokenIDs) > 0 {
		for idx, tokenID := range tokenIDs {
			orderbook, err := o.GetOrderbook(tokenID)
			if err != nil {
				continue
			}
			bids := pickList(orderbook["bids"], "")
			asks := pickList(orderbook["asks"], "")
			var bestBid, bestAsk float64
			if len(bids) > 0 {
				bestBid = anyFloat(anyMap(bids[0])["price"])
			}
			if len(asks) > 0 {
				bestAsk = anyFloat(anyMap(asks[0])["price"])
			}
			if bestBid > 0 && bestAsk > 0 {
				prices[outcomes[idx]] = (bestBid + bestAsk) / 2
			} else if bestAsk > 0 {
				prices[outcomes[idx]] = bestAsk
			} else if bestBid > 0 {
				prices[outcomes[idx]] = bestBid
			}
		}
	}
	closeTime := parseAnyTime(data["cutoffAt"], data["cutoffTime"], data["endTime"])
	volume := anyFloat(data["volume"])
	liquidity := anyFloat(data["liquidity"])
	metadata := map[string]any{
		"topic_id":          marketID,
		"market_id":         marketID,
		"condition_id":      anyString(data["conditionId"]),
		"status":            anyString(data["status"]),
		"chain_id":          anyString(data["chainId"]),
		"quote_token":       anyString(data["quoteToken"]),
		"token_ids":         tokenIDs,
		"clobTokenIds":      tokenIDs,
		"tokens":            buildTokenMap(outcomes, tokenIDs),
		"child_markets":     childMarkets,
		"is_multi_outcome":  len(childMarkets) > 0,
		"description":       anyString(data["description"]),
		"category":          anyString(data["category"]),
		"image_url":         anyString(data["image_url"]),
		"minimum_tick_size": 0.001,
	}
	status := strings.ToLower(anyString(data["status"]))
	if status == "resolved" {
		metadata["closed"] = true
	} else if status == "activated" {
		metadata["closed"] = false
	} else {
		metadata["closed"] = false
	}
	return models.Market{
		ID:          marketID,
		Question:    question,
		Outcomes:    outcomes,
		CloseTime:   closeTime,
		Volume:      volume,
		Liquidity:   liquidity,
		Prices:      prices,
		Metadata:    metadata,
		TickSize:    0.001,
		Description: anyString(metadata["description"]),
	}
}

// parseOpinionOrderStatus converts status to models.OrderStatus.
func parseOpinionOrderStatus(status any) models.OrderStatus {
	if statusInt, ok := status.(float64); ok {
		switch int(statusInt) {
		case 0:
			return models.OrderStatusPending
		case 1:
			return models.OrderStatusOpen
		case 2:
			return models.OrderStatusFilled
		case 3:
			return models.OrderStatusPartiallyFilled
		case 4:
			return models.OrderStatusCancelled
		default:
			return models.OrderStatusOpen
		}
	}
	statusStr := strings.ToLower(fmt.Sprintf("%v", status))
	switch statusStr {
	case "pending":
		return models.OrderStatusPending
	case "open", "live":
		return models.OrderStatusOpen
	case "filled", "matched":
		return models.OrderStatusFilled
	case "partially_filled":
		return models.OrderStatusPartiallyFilled
	case "cancelled", "canceled":
		return models.OrderStatusCancelled
	case "rejected":
		return models.OrderStatusRejected
	default:
		return models.OrderStatusOpen
	}
}

// parseOpinionTopicType normalizes market type values.
func parseOpinionTopicType(raw any) int {
	switch strings.ToLower(anyString(raw)) {
	case "binary":
		return 0
	case "categorical":
		return 1
	case "all":
		return 2
	}
	if value := intFromAny(raw, -1); value >= 0 {
		return value
	}
	return 2
}

// parseMarketID converts a market ID string to int.
func parseMarketID(marketID string) int {
	parsed, err := strconv.Atoi(marketID)
	if err != nil {
		return 0
	}
	return parsed
}

type opinionPlaceOrderInput struct {
	// MarketID is the market ID as string.
	MarketID string
	// TokenID is the token ID for the outcome.
	TokenID string
	// Price is the order price.
	Price float64
	// Side is 0=buy, 1=sell.
	Side int
	// Type is 1=market, 2=limit.
	Type int
	// MakerAmountInBase is the base token amount.
	MakerAmountInBase float64
	// MakerAmountInQuote is the quote token amount.
	MakerAmountInQuote float64
}

type opinionOrderInput struct {
	// MarketID is the market ID as string.
	MarketID string
	// TokenID is the token ID for the outcome.
	TokenID string
	// MakerAmount is the amount provided by the maker.
	MakerAmount float64
	// Price is the order price.
	Price float64
	// Side is 0=buy, 1=sell.
	Side int
	// Type is 1=market, 2=limit.
	Type int
}

// getQuoteTokens returns available quote tokens.
func (o *Opinion) getQuoteTokens() ([]any, error) {
	resp, err := o.requestJSON("GET", "/openapi/quoteToken", map[string]any{"chain_id": fmt.Sprintf("%d", o.chainID)}, nil)
	if err != nil {
		return nil, err
	}
	return o.parseResultList(resp, "get quote tokens")
}

// validateOpinionPrice validates and normalizes a price string.
func validateOpinionPrice(price float64) (string, error) {
	if price <= 0 {
		return "", base.InvalidOrder{Message: fmt.Sprintf("price must be positive, got: %f", price)}
	}
	priceStr := strconv.FormatFloat(price, 'f', -1, 64)
	if strings.Contains(priceStr, "e") {
		priceStr = fmt.Sprintf("%.6f", price)
	}
	if idx := strings.Index(priceStr, "."); idx >= 0 {
		if len(priceStr[idx+1:]) > 6 {
			return "", base.InvalidOrder{Message: "price precision cannot exceed 6 decimal places"}
		}
	}
	priceVal := new(big.Rat)
	if _, ok := priceVal.SetString(priceStr); !ok {
		return "", base.InvalidOrder{Message: "invalid price format"}
	}
	if priceVal.Cmp(big.NewRat(1, 1000)) < 0 || priceVal.Cmp(big.NewRat(999, 1000)) > 0 {
		return "", base.InvalidOrder{Message: "price must be between 0.001 and 0.999"}
	}
	return priceStr, nil
}

// calculateOrderAmounts converts price/maker amount to maker/taker amounts.
func calculateOrderAmounts(price float64, makerAmount *big.Int, side int) (*big.Int, *big.Int, error) {
	priceStr, err := validateOpinionPrice(price)
	if err != nil {
		return nil, nil, err
	}
	priceRat, _ := new(big.Rat).SetString(priceStr)
	priceNum := priceRat.Num()
	priceDen := priceRat.Denom()
	if priceNum.Sign() == 0 || priceDen.Sign() == 0 {
		return nil, nil, base.InvalidOrder{Message: "invalid price fraction"}
	}
	maker4 := roundToSignificantDigits(makerAmount, 4)
	k := new(big.Int)
	if side == 0 {
		k.Div(maker4, priceNum)
		if k.Sign() == 0 {
			k.SetInt64(1)
		}
		recalc := new(big.Int).Mul(k, priceNum)
		taker := new(big.Int).Mul(k, priceDen)
		if recalc.Sign() == 0 {
			recalc.SetInt64(1)
		}
		if taker.Sign() == 0 {
			taker.SetInt64(1)
		}
		return recalc, taker, nil
	}
	k.Div(maker4, priceDen)
	if k.Sign() == 0 {
		k.SetInt64(1)
	}
	recalc := new(big.Int).Mul(k, priceDen)
	taker := new(big.Int).Mul(k, priceNum)
	if recalc.Sign() == 0 {
		recalc.SetInt64(1)
	}
	if taker.Sign() == 0 {
		taker.SetInt64(1)
	}
	return recalc, taker, nil
}

// roundToSignificantDigits rounds an integer to N significant digits.
func roundToSignificantDigits(value *big.Int, digits int) *big.Int {
	if value.Sign() == 0 {
		return big.NewInt(0)
	}
	str := value.String()
	if len(str) <= digits {
		return new(big.Int).Set(value)
	}
	divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(len(str)-digits)), nil)
	rounded := new(big.Int).Div(value, divisor)
	rounded.Mul(rounded, divisor)
	return rounded
}

// safeAmountToWei converts a float amount to integer wei.
func safeAmountToWei(amount float64, decimals int) (*big.Int, error) {
	if amount <= 0 {
		return nil, base.InvalidOrder{Message: fmt.Sprintf("amount must be positive, got: %f", amount)}
	}
	if decimals < 0 || decimals > 18 {
		return nil, base.InvalidOrder{Message: fmt.Sprintf("decimals must be between 0 and 18, got: %d", decimals)}
	}
	amountStr := strconv.FormatFloat(amount, 'f', -1, 64)
	if strings.Contains(amountStr, "e") {
		amountStr = fmt.Sprintf("%.6f", amount)
	}
	rat, ok := new(big.Rat).SetString(amountStr)
	if !ok {
		return nil, base.InvalidOrder{Message: "invalid amount format"}
	}
	multiplier := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil))
	rat.Mul(rat, multiplier)
	result := new(big.Int)
	if rat.Num().Sign() <= 0 {
		return nil, base.InvalidOrder{Message: "calculated amount is zero or negative"}
	}
	result.Div(rat.Num(), rat.Denom())
	if result.Sign() <= 0 {
		return nil, base.InvalidOrder{Message: "calculated amount is zero or negative"}
	}
	return result, nil
}

// generateOpinionSalt creates a pseudo-random salt.
func generateOpinionSalt() string {
	now := float64(time.Now().UTC().Unix())
	seed := int64(math.Round(now * randFloat()))
	if seed <= 0 {
		seed = time.Now().Unix()
	}
	return fmt.Sprintf("%d", seed)
}

// randFloat returns a pseudo-random float in [0,1).
func randFloat() float64 {
	return float64(time.Now().UnixNano()%1_000_000) / 1_000_000
}

// buildTokenMap builds outcome->tokenID mapping.
func buildTokenMap(outcomes []string, tokenIDs []string) map[string]any {
	result := map[string]any{}
	for i := 0; i < len(outcomes) && i < len(tokenIDs); i++ {
		result[outcomes[i]] = tokenIDs[i]
	}
	return result
}
