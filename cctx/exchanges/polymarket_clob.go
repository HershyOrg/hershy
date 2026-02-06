package exchanges

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	ethmath "github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"
)

const (
	polyHeaderAddress    = "POLY_ADDRESS"
	polyHeaderSignature  = "POLY_SIGNATURE"
	polyHeaderTimestamp  = "POLY_TIMESTAMP"
	polyHeaderNonce      = "POLY_NONCE"
	polyHeaderAPIKey     = "POLY_API_KEY"
	polyHeaderPassphrase = "POLY_PASSPHRASE"
)

const (
	clobDomainName    = "ClobAuthDomain"
	clobDomainVersion = "1"
	clobAuthMessage   = "This message attests that I control the given wallet"
)

const (
	orderDomainName    = "Polymarket CTF Exchange"
	orderDomainVersion = "1"
)

const (
	orderSideBuy  = 0
	orderSideSell = 1
)

const (
	signatureTypeEOA = 0
)

type clobClient struct {
	// host is the CLOB API base URL.
	host string
	// httpClient handles HTTP requests.
	httpClient *http.Client
	// chainID is the chain ID for signing.
	chainID int64
	// privateKey is the signer key.
	privateKey *ecdsa.PrivateKey
	// address is the signer address.
	address common.Address
	// creds holds API credentials.
	creds *apiCreds
	// funder is the funder address if required.
	funder common.Address
}

type apiCreds struct {
	// APIKey is the API key ID.
	APIKey string `json:"apiKey"`
	// APISecret is the API secret.
	APISecret string `json:"secret"`
	// APIPassphrase is the API passphrase.
	APIPassphrase string `json:"passphrase"`
}

type orderArgs struct {
	// TokenID is the asset token ID.
	TokenID string
	// Price is the order price.
	Price float64
	// Size is the order size.
	Size float64
	// Side is the order side string.
	Side string
	// FeeRateBps is the fee rate in basis points.
	FeeRateBps int
	// Nonce is the order nonce.
	Nonce int64
	// Expiration is the order expiry timestamp.
	Expiration int64
	// Taker is the taker address (optional).
	Taker string
	// SignatureType is the signature type.
	SignatureType int
}

type orderToSign struct {
	// Salt is the order salt.
	Salt *big.Int
	// Maker is the maker address.
	Maker string
	// Signer is the signer address.
	Signer string
	// Taker is the taker address.
	Taker string
	// TokenID is the token ID.
	TokenID *big.Int
	// MakerAmount is the maker amount.
	MakerAmount *big.Int
	// TakerAmount is the taker amount.
	TakerAmount *big.Int
	// Expiration is the expiry timestamp.
	Expiration *big.Int
	// Nonce is the order nonce.
	Nonce *big.Int
	// FeeRateBps is the fee rate in bps.
	FeeRateBps *big.Int
	// Side is the order side.
	Side int
	// SignatureType is the signature type.
	SignatureType int
}

type signedOrder struct {
	// Salt is the salt as string.
	Salt string `json:"salt"`
	// Maker is the maker address.
	Maker string `json:"maker"`
	// Signer is the signer address.
	Signer string `json:"signer"`
	// Taker is the taker address.
	Taker string `json:"taker"`
	// TokenID is the token ID.
	TokenID string `json:"tokenId"`
	// MakerAmount is the maker amount.
	MakerAmount string `json:"makerAmount"`
	// TakerAmount is the taker amount.
	TakerAmount string `json:"takerAmount"`
	// Expiration is the expiration timestamp.
	Expiration string `json:"expiration"`
	// Nonce is the order nonce.
	Nonce string `json:"nonce"`
	// FeeRateBps is the fee rate.
	FeeRateBps string `json:"feeRateBps"`
	// Side is the order side.
	Side string `json:"side"`
	// SignatureType is the signature type.
	SignatureType int `json:"signatureType"`
	// Signature is the signed payload.
	Signature string `json:"signature"`
}

type orderRequest struct {
	// Order is the signed order payload.
	Order signedOrder `json:"order"`
	// Owner is the owner address.
	Owner string `json:"owner"`
	// OrderType is the order type.
	OrderType string `json:"orderType"`
	// PostOnly indicates post-only placement.
	PostOnly bool `json:"postOnly"`
}

type contractConfig struct {
	// Exchange is the exchange contract address.
	Exchange string
	// Collateral is the collateral token address.
	Collateral string
	// ConditionalToken is the conditional token contract address.
	ConditionalToken string
}

// newClobClient constructs a CLOB client with optional auth.
func newClobClient(host string, chainID int64, privateKeyHex string, creds *apiCreds, funder string) (*clobClient, error) {
	host = strings.TrimRight(host, "/")
	client := &clobClient{
		host:       host,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		chainID:    chainID,
		creds:      creds,
	}

	if privateKeyHex != "" {
		key, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
		if err != nil {
			return nil, err
		}
		client.privateKey = key
		client.address = crypto.PubkeyToAddress(key.PublicKey)
		client.funder = client.address
		if funder != "" {
			client.funder = common.HexToAddress(funder)
		}
	}

	return client, nil
}

// setCreds updates the API credentials on the client.
func (c *clobClient) setCreds(creds *apiCreds) {
	c.creds = creds
}

// addressHex returns the signer address as hex.
func (c *clobClient) addressHex() string {
	return c.address.Hex()
}

// createOrDeriveAPIKey ensures API credentials exist.
func (c *clobClient) createOrDeriveAPIKey() (*apiCreds, error) {
	creds, err := c.createAPIKey()
	if err == nil {
		return creds, nil
	}
	return c.deriveAPIKey()
}

// createAPIKey requests a new API key using L1 auth.
func (c *clobClient) createAPIKey() (*apiCreds, error) {
	headers, err := c.level1Headers(0)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest("POST", "/auth/api-key", nil, headers)
	if err != nil {
		return nil, err
	}
	var parsed apiCreds
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

// deriveAPIKey derives API credentials using L2 auth.
func (c *clobClient) deriveAPIKey() (*apiCreds, error) {
	headers, err := c.level1Headers(0)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest("GET", "/auth/derive-api-key", nil, headers)
	if err != nil {
		return nil, err
	}
	var parsed apiCreds
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

// postOrder submits a signed order to the CLOB API.
func (c *clobClient) postOrder(order signedOrder, orderType string, postOnly bool) (map[string]any, error) {
	if c.creds == nil {
		return nil, errors.New("missing api credentials")
	}
	body := orderRequest{
		Order:     order,
		Owner:     c.creds.APIKey,
		OrderType: orderType,
		PostOnly:  postOnly,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	headers, err := c.level2Headers("POST", "/order", payload)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest("POST", "/order", payload, headers)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// cancelOrder cancels an order by ID.
func (c *clobClient) cancelOrder(orderID string) (map[string]any, error) {
	if c.creds == nil {
		return nil, errors.New("missing api credentials")
	}
	body := map[string]string{"orderID": orderID}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	headers, err := c.level2Headers("DELETE", "/order", payload)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest("DELETE", "/order", payload, headers)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// getOrders fetches orders for the authenticated account.
func (c *clobClient) getOrders() ([]map[string]any, error) {
	if c.creds == nil {
		return nil, errors.New("missing api credentials")
	}
	headers, err := c.level2Headers("GET", "/data/orders", nil)
	if err != nil {
		return nil, err
	}
	nextCursor := "MA=="
	var all []map[string]any
	for nextCursor != "" && nextCursor != "END" {
		path := fmt.Sprintf("/data/orders?next_cursor=%s", nextCursor)
		resp, err := c.doRequest("GET", path, nil, headers)
		if err != nil {
			return nil, err
		}
		var payload map[string]any
		if err := json.Unmarshal(resp, &payload); err != nil {
			return nil, err
		}
		data, _ := payload["data"].([]any)
		for _, item := range data {
			if row, ok := item.(map[string]any); ok {
				all = append(all, row)
			}
		}
		if cursor, ok := payload["next_cursor"].(string); ok {
			nextCursor = cursor
		} else {
			break
		}
		if nextCursor == "END" || nextCursor == "" {
			break
		}
	}
	return all, nil
}

// getBalanceAllowance returns the balance/allowance for a token.
func (c *clobClient) getBalanceAllowance(assetType string, tokenID string, signatureType int) (map[string]any, error) {
	if c.creds == nil {
		return nil, errors.New("missing api credentials")
	}
	query := fmt.Sprintf("/balance-allowance?asset_type=%s", assetType)
	if tokenID != "" {
		query = query + "&token_id=" + tokenID
	}
	if signatureType >= 0 {
		query = query + "&signature_type=" + fmt.Sprintf("%d", signatureType)
	}
	headers, err := c.level2Headers("GET", "/balance-allowance", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest("GET", query, nil, headers)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// getTickSize fetches the tick size for a token.
func (c *clobClient) getTickSize(tokenID string) (float64, error) {
	path := fmt.Sprintf("/tick-size?token_id=%s", tokenID)
	resp, err := c.doRequest("GET", path, nil, nil)
	if err != nil {
		return 0, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return 0, err
	}
	value, _ := parsed["minimum_tick_size"].(string)
	return parseFloat(value), nil
}

// getNegRisk checks whether neg-risk is enabled.
func (c *clobClient) getNegRisk(tokenID string) (bool, error) {
	path := fmt.Sprintf("/neg-risk?token_id=%s", tokenID)
	resp, err := c.doRequest("GET", path, nil, nil)
	if err != nil {
		return false, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return false, err
	}
	value, _ := parsed["neg_risk"].(bool)
	return value, nil
}

// getFeeRateBps returns the fee rate in bps for a token.
func (c *clobClient) getFeeRateBps(tokenID string) (int, error) {
	path := fmt.Sprintf("/fee-rate?token_id=%s", tokenID)
	resp, err := c.doRequest("GET", path, nil, nil)
	if err != nil {
		return 0, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return 0, err
	}
	if value, ok := parsed["fee_rate_bps"].(float64); ok {
		return int(value), nil
	}
	if value, ok := parsed["fee_rate_bps"].(int); ok {
		return value, nil
	}
	return 0, nil
}

// buildSignedOrder constructs and signs an order payload.
func (c *clobClient) buildSignedOrder(args orderArgs, tickSize float64, negRisk bool) (signedOrder, error) {
	if c.privateKey == nil {
		return signedOrder{}, errors.New("missing private key")
	}

	roundConfig := roundingConfig(tickSize)
	price := roundNormal(args.Price, roundConfig.price)
	if !priceValid(price, tickSize) {
		return signedOrder{}, fmt.Errorf("price %f invalid for tick size %f", price, tickSize)
	}

	sideValue := orderSideBuy
	if strings.ToUpper(args.Side) == "SELL" {
		sideValue = orderSideSell
	}

	var makerAmount int64
	var takerAmount int64
	if sideValue == orderSideBuy {
		rawTaker := roundDown(args.Size, roundConfig.size)
		rawMaker := rawTaker * price
		rawMaker = normalizeAmount(rawMaker, roundConfig.amount)
		makerAmount = toTokenDecimals(rawMaker)
		takerAmount = toTokenDecimals(rawTaker)
	} else {
		rawMaker := roundDown(args.Size, roundConfig.size)
		rawTaker := rawMaker * price
		rawTaker = normalizeAmount(rawTaker, roundConfig.amount)
		makerAmount = toTokenDecimals(rawMaker)
		takerAmount = toTokenDecimals(rawTaker)
	}

	salt := randomSalt()
	tokenIDBig := parseBigInt(args.TokenID)
	order := orderToSign{
		Salt:          big.NewInt(salt),
		Maker:         c.funder.Hex(),
		Signer:        c.address.Hex(),
		Taker:         zeroAddress(),
		TokenID:       tokenIDBig,
		MakerAmount:   big.NewInt(makerAmount),
		TakerAmount:   big.NewInt(takerAmount),
		Expiration:    big.NewInt(args.Expiration),
		Nonce:         big.NewInt(args.Nonce),
		FeeRateBps:    big.NewInt(int64(args.FeeRateBps)),
		Side:          sideValue,
		SignatureType: signatureTypeEOA,
	}

	sig, err := c.signOrder(order, negRisk)
	if err != nil {
		return signedOrder{}, err
	}

	sideLabel := "BUY"
	if sideValue == orderSideSell {
		sideLabel = "SELL"
	}

	return signedOrder{
		Salt:          order.Salt.String(),
		Maker:         c.funder.Hex(),
		Signer:        c.address.Hex(),
		Taker:         zeroAddress(),
		TokenID:       order.TokenID.String(),
		MakerAmount:   order.MakerAmount.String(),
		TakerAmount:   order.TakerAmount.String(),
		Expiration:    order.Expiration.String(),
		Nonce:         order.Nonce.String(),
		FeeRateBps:    order.FeeRateBps.String(),
		Side:          sideLabel,
		SignatureType: signatureTypeEOA,
		Signature:     sig,
	}, nil
}

// signOrder signs an order using EIP-712.
func (c *clobClient) signOrder(order orderToSign, negRisk bool) (string, error) {
	config, err := contractConfigForChain(c.chainID, negRisk)
	if err != nil {
		return "", err
	}
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
			Name:              orderDomainName,
			Version:           orderDomainVersion,
			ChainId:           ethmath.NewHexOrDecimal256(c.chainID),
			VerifyingContract: config.Exchange,
		},
		Message: map[string]any{
			"salt":          order.Salt,
			"maker":         order.Maker,
			"signer":        order.Signer,
			"taker":         order.Taker,
			"tokenId":       order.TokenID,
			"makerAmount":   order.MakerAmount,
			"takerAmount":   order.TakerAmount,
			"expiration":    order.Expiration,
			"nonce":         order.Nonce,
			"feeRateBps":    order.FeeRateBps,
			"side":          order.Side,
			"signatureType": order.SignatureType,
		},
	}
	return signTypedData(c.privateKey, typedData)
}

// level1Headers builds L1 auth headers.
func (c *clobClient) level1Headers(nonce int64) (map[string]string, error) {
	if c.privateKey == nil {
		return nil, errors.New("missing private key")
	}
	timestamp := time.Now().Unix()
	signature, err := signClobAuth(c.privateKey, c.address.Hex(), c.chainID, timestamp, nonce)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		polyHeaderAddress:   c.address.Hex(),
		polyHeaderSignature: signature,
		polyHeaderTimestamp: fmt.Sprintf("%d", timestamp),
		polyHeaderNonce:     fmt.Sprintf("%d", nonce),
	}, nil
}

// level2Headers builds L2 auth headers.
func (c *clobClient) level2Headers(method, path string, body []byte) (map[string]string, error) {
	if c.privateKey == nil || c.creds == nil {
		return nil, errors.New("missing auth for level2")
	}
	timestamp := time.Now().Unix()
	hmacSig, err := buildHMACSignature(c.creds.APISecret, timestamp, method, path, body)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		polyHeaderAddress:    c.address.Hex(),
		polyHeaderSignature:  hmacSig,
		polyHeaderTimestamp:  fmt.Sprintf("%d", timestamp),
		polyHeaderAPIKey:     c.creds.APIKey,
		polyHeaderPassphrase: c.creds.APIPassphrase,
	}, nil
}

// doRequest executes an HTTP request to the CLOB API.
func (c *clobClient) doRequest(method, path string, body []byte, headers map[string]string) ([]byte, error) {
	url := c.host + path
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "go-clob-client")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Content-Type", "application/json")
	if method == http.MethodGet {
		req.Header.Set("Accept-Encoding", "gzip")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("clob request failed: %s", resp.Status)
	}
	return payload, nil
}

// signClobAuth signs the CLOB auth typed data.
func signClobAuth(privateKey *ecdsa.PrivateKey, address string, chainID int64, timestamp int64, nonce int64) (string, error) {
	typedData := apitypes.TypedData{
		Types: apitypes.Types{
			"EIP712Domain": {
				{Name: "name", Type: "string"},
				{Name: "version", Type: "string"},
				{Name: "chainId", Type: "uint256"},
			},
			"ClobAuth": {
				{Name: "address", Type: "address"},
				{Name: "timestamp", Type: "string"},
				{Name: "nonce", Type: "uint256"},
				{Name: "message", Type: "string"},
			},
		},
		PrimaryType: "ClobAuth",
		Domain: apitypes.TypedDataDomain{
			Name:    clobDomainName,
			Version: clobDomainVersion,
			ChainId: ethmath.NewHexOrDecimal256(chainID),
		},
		Message: map[string]any{
			"address":   address,
			"timestamp": fmt.Sprintf("%d", timestamp),
			"nonce":     fmt.Sprintf("%d", nonce),
			"message":   clobAuthMessage,
		},
	}
	return signTypedData(privateKey, typedData)
}

// signTypedData hashes and signs typed data.
func signTypedData(privateKey *ecdsa.PrivateKey, typedData apitypes.TypedData) (string, error) {
	rawHash, _, err := apitypes.TypedDataAndHash(typedData)
	if err != nil {
		return "", err
	}
	sig, err := crypto.Sign(rawHash, privateKey)
	if err != nil {
		return "", err
	}
	if sig[64] < 27 {
		sig[64] += 27
	}
	return "0x" + hex.EncodeToString(sig), nil
}

// buildHMACSignature builds an HMAC signature for L2 requests.
func buildHMACSignature(secret string, timestamp int64, method, requestPath string, body []byte) (string, error) {
	decoded, err := decodeBase64URL(secret)
	if err != nil {
		return "", err
	}
	message := fmt.Sprintf("%d%s%s", timestamp, method, requestPath)
	if len(body) > 0 {
		message += strings.ReplaceAll(string(body), "'", "\"")
	}
	mac := hmac.New(sha256.New, decoded)
	if _, err := mac.Write([]byte(message)); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// decodeBase64URL decodes URL-safe base64.
func decodeBase64URL(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if pad := len(value) % 4; pad != 0 {
		value += strings.Repeat("=", 4-pad)
	}
	return base64.URLEncoding.DecodeString(value)
}

// roundingConfig returns rounding digits for a tick size.
func roundingConfig(tickSize float64) roundConfig {
	switch fmt.Sprintf("%.4f", tickSize) {
	case "0.1000":
		return roundConfig{price: 1, size: 2, amount: 3}
	case "0.0100":
		return roundConfig{price: 2, size: 2, amount: 4}
	case "0.0010":
		return roundConfig{price: 3, size: 2, amount: 5}
	case "0.0001":
		return roundConfig{price: 4, size: 2, amount: 6}
	default:
		return roundConfig{price: 2, size: 2, amount: 4}
	}
}

type roundConfig struct {
	// price is the number of price decimal digits.
	price int
	// size is the number of size decimal digits.
	size int
	// amount is the number of amount decimal digits.
	amount int
}

// roundDown rounds down to a fixed number of digits.
func roundDown(value float64, digits int) float64 {
	mult := math.Pow(10, float64(digits))
	return math.Floor(value*mult) / mult
}

// roundNormal rounds to the nearest value at a given precision.
func roundNormal(value float64, digits int) float64 {
	mult := math.Pow(10, float64(digits))
	return math.Round(value*mult) / mult
}

// roundUp rounds up to a fixed number of digits.
func roundUp(value float64, digits int) float64 {
	mult := math.Pow(10, float64(digits))
	return math.Ceil(value*mult) / mult
}

// normalizeAmount rounds and clamps order amount.
func normalizeAmount(value float64, digits int) float64 {
	fractional := value - math.Floor(value)
	if fractional == 0 {
		return value
	}
	value = roundUp(value, digits+4)
	if decimalPlaces(value) > digits {
		value = roundDown(value, digits)
	}
	return value
}

// decimalPlaces returns the count of decimal places.
func decimalPlaces(value float64) int {
	s := strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.8f", value), "0"), ".")
	if idx := strings.IndexByte(s, '.'); idx >= 0 {
		return len(s) - idx - 1
	}
	return 0
}

// toTokenDecimals converts a float to token decimals.
func toTokenDecimals(value float64) int64 {
	converted := value * 1e6
	if decimalPlaces(converted) > 0 {
		converted = roundNormal(converted, 0)
	}
	return int64(converted)
}

// priceValid reports whether a price aligns with tick size.
func priceValid(price, tickSize float64) bool {
	return price >= tickSize && price <= 1.0-tickSize
}

// randomSalt generates a random salt value.
func randomSalt() int64 {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return int64(binaryBigEndian(buf[:]))
	}
	return time.Now().UnixNano()
}

// binaryBigEndian reads a uint64 from bytes.
func binaryBigEndian(buf []byte) uint64 {
	var out uint64
	for _, b := range buf {
		out = out<<8 | uint64(b)
	}
	return out
}

// zeroAddress returns the zero address string.
func zeroAddress() string {
	return "0x0000000000000000000000000000000000000000"
}

// contractConfigForChain returns contract config by chain.
func contractConfigForChain(chainID int64, negRisk bool) (contractConfig, error) {
	configs := map[int64]contractConfig{
		137: {
			Exchange:         "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
			Collateral:       "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
			ConditionalToken: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
		},
		80002: {
			Exchange:         "0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40",
			Collateral:       "0x9c4e1703476e875070ee25b56a58b008cfb8fa78",
			ConditionalToken: "0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB",
		},
	}
	negRiskConfigs := map[int64]contractConfig{
		137: {
			Exchange:         "0xC5d563A36AE78145C45a50134d48A1215220f80a",
			Collateral:       "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
			ConditionalToken: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
		},
		80002: {
			Exchange:         "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
			Collateral:       "0x9c4e1703476e875070ee25b56a58b008cfb8fa78",
			ConditionalToken: "0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB",
		},
	}
	if negRisk {
		if cfg, ok := negRiskConfigs[chainID]; ok {
			return cfg, nil
		}
	} else if cfg, ok := configs[chainID]; ok {
		return cfg, nil
	}
	return contractConfig{}, fmt.Errorf("invalid chainID: %d", chainID)
}

// mathRoundBig converts an int64 to big.Int.
func mathRoundBig(value int64) *big.Int {
	return new(big.Int).SetInt64(value)
}

// parseFloat parses a float string.
func parseFloat(value string) float64 {
	if value == "" {
		return 0
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// parseBigInt parses an integer string to big.Int.
func parseBigInt(value string) *big.Int {
	if value == "" {
		return big.NewInt(0)
	}
	if strings.HasPrefix(value, "0x") {
		value = value[2:]
	}
	out := new(big.Int)
	if _, ok := out.SetString(value, 10); ok {
		return out
	}
	if _, ok := out.SetString(value, 16); ok {
		return out
	}
	return big.NewInt(0)
}
