const RUNNER_GO_MOD = `module strategy-runner

go 1.24.13

require (
	github.com/HershyOrg/hersh v0.3.1
	github.com/ethereum/go-ethereum v1.16.8
	github.com/gorilla/websocket v1.5.3
)
`;

const RUNNER_GO_SUM = `github.com/HershyOrg/hersh v0.3.1 h1:Db1T3SOrmADAGgB4Rd4TU3jw38lODT1pgwMhCyxOBB0=
github.com/HershyOrg/hersh v0.3.1/go.mod h1:/oES/OVsTyr7bv63qC0k/YsW6z51/k+j5TBWwSPrib4=
github.com/gorilla/websocket v1.5.3 h1:saDtZ6Pbx/0u+bgYQ3q96pZgCzfhKXGPqt7kZ72aNNg=
github.com/gorilla/websocket v1.5.3/go.mod h1:YR8l580nyteQvAITg2hZ9XVh4b55+EU/adAjf1fMHhE=
`;

const RUNNER_MAIN_GO = String.raw`package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/manager"
	ethereum "github.com/ethereum/go-ethereum"
	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	ethmath "github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"
	"github.com/gorilla/websocket"
)

type StreamDef struct {
	ID         string
	Name       string
	Fields     []string
	IntervalMs int
	SourceURL  string
	Kind       string
	Exchange   string
	Symbol     string
	MarketID   string
	TokenID    string
	Chain      string
	Method     string
	ParamsJSON string
}

type TriggerDef struct {
	ID         string
	Name       string
	Type       string
	Condition  string
	IntervalMs int64
}

type ActionDef struct {
	ID     string
	Name   string
	Kind   string
	Config map[string]any
}

type RuntimeProviderAuth struct {
	Authenticated bool
	Credentials   map[string]string
}

type Engine struct {
	strategyName     string
	streams          []StreamDef
	normals          map[string]any
	triggers         []TriggerDef
	actions          map[string]ActionDef
	triggerToActions map[string][]string
	actionInputs     map[string][]string
	auth             map[string]RuntimeProviderAuth
}

func main() {
	strategyPath := flag.String("strategy", "/app/strategy.json", "Strategy JSON file path")
	flag.Parse()

	engine, err := LoadEngine(*strategyPath)
	if err != nil {
		log.Fatalf("[BOOT] failed to load strategy: %v", err)
	}

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute

	watcher := hersh.NewWatcher(config, map[string]string{"RUNNER": "strategy-runner"}, context.Background())
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return engine.Run(msg, ctx)
	}, "StrategyRunner")

	if err := watcher.Start(); err != nil {
		log.Fatalf("[BOOT] watcher start failed: %v", err)
	}

	log.Printf("[BOOT] strategy-runner started: strategy=%q streams=%d triggers=%d actions=%d", engine.strategyName, len(engine.streams), len(engine.triggers), len(engine.actions))

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigChan)

	for {
		select {
		case <-sigChan:
			_ = watcher.Stop()
			return
		}
	}
}

func LoadEngine(path string) (*Engine, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read strategy file: %w", err)
	}

	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("parse strategy json: %w", err)
	}

	kind := asString(root["kind"])
	if kind != "" && kind != "hershy-strategy-graph" {
		return nil, fmt.Errorf("unsupported kind: %s", kind)
	}

	strategyName := "strategy"
	if strategy, ok := root["strategy"].(map[string]any); ok {
		if name := asString(strategy["name"]); name != "" {
			strategyName = name
		}
	}

	engine := &Engine{
		strategyName:     strategyName,
		normals:          map[string]any{},
		actions:          map[string]ActionDef{},
		triggerToActions: map[string][]string{},
		actionInputs:     map[string][]string{},
		auth:             map[string]RuntimeProviderAuth{},
	}

	if runtime, ok := root["runtime"].(map[string]any); ok {
		engine.auth = parseRuntimeAuth(runtime["auth"])
	}

	for _, block := range asMapSlice(root["blocks"]) {
		id := asString(block["id"])
		blockType := asString(block["type"])
		cfg := asMap(block["config"])
		if id == "" || blockType == "" {
			continue
		}

		switch blockType {
		case "streaming":
			intervalMs := int(asFloat(cfg["updateIntervalMs"]))
			if intervalMs < 300 {
				intervalMs = 1000
			}
			engine.streams = append(engine.streams, StreamDef{
				ID:         id,
				Name:       firstNonEmpty(asString(cfg["name"]), id),
				Fields:     asStringSlice(cfg["fields"]),
				IntervalMs: intervalMs,
				SourceURL:  asString(cfg["sourceUrl"]),
				Kind:       firstNonEmpty(asString(cfg["streamKind"]), "url"),
				Exchange:   asString(cfg["exchange"]),
				Symbol:     asString(cfg["symbol"]),
				MarketID:   asString(cfg["marketId"]),
				TokenID:    asString(cfg["tokenId"]),
				Chain:      asString(cfg["streamChain"]),
				Method:     asString(cfg["streamMethod"]),
				ParamsJSON: asString(cfg["streamParamsJson"]),
			})
		case "normal":
			engine.normals[id] = cfg["value"]
		case "trigger":
			intervalMs := int64(asFloat(cfg["intervalMs"]))
			if intervalMs <= 0 {
				intervalMs = 1000
			}
			triggerType := firstNonEmpty(asString(cfg["triggerType"]), "manual")
			engine.triggers = append(engine.triggers, TriggerDef{
				ID:         id,
				Name:       firstNonEmpty(asString(cfg["name"]), id),
				Type:       triggerType,
				Condition:  asString(cfg["condition"]),
				IntervalMs: intervalMs,
			})
		case "action":
			engine.actions[id] = ActionDef{
				ID:     id,
				Name:   firstNonEmpty(asString(cfg["name"]), id),
				Kind:   firstNonEmpty(asString(cfg["actionType"]), "cex"),
				Config: cfg,
			}
		}
	}

	for _, conn := range asMapSlice(root["connections"]) {
		kind := asString(conn["kind"])
		fromID := asString(conn["fromId"])
		toID := asString(conn["toId"])
		if kind == "trigger-action" {
			engine.triggerToActions[fromID] = append(engine.triggerToActions[fromID], toID)
		}
		if kind == "action-input" {
			engine.actionInputs[toID] = append(engine.actionInputs[toID], fromID)
		}
	}

	if len(engine.streams) == 0 {
		return nil, fmt.Errorf("strategy has no streaming blocks")
	}

	return engine, nil
}

func (e *Engine) Run(msg *hersh.Message, ctx hersh.HershContext) error {
	if ctx.GetValue("strategy_meta") == nil {
		ctx.SetValue("strategy_meta", map[string]any{
			"name":     e.strategyName,
			"streams":  len(e.streams),
			"triggers": len(e.triggers),
			"actions":  len(e.actions),
		})
	}
	ctx.SetValue("normal_values", e.normals)

	streamValues := map[string]map[string]any{}
	for _, stream := range e.streams {
		val := e.resolveStreamValue(stream, ctx)
		if item, ok := val.(map[string]any); ok && item != nil {
			streamValues[stream.ID] = item
		}
	}

	ctx.SetValue("stream_values", streamValues)

	nowMs := time.Now().UnixMilli()
	prevCond := asBoolMap(ctx.GetValue("trigger_prev_state"))
	lastFire := asInt64Map(ctx.GetValue("trigger_last_fire_ms"))
	triggerFire := map[string]bool{}
	nextCond := map[string]bool{}

	manualMsg := ""
	if msg != nil {
		manualMsg = strings.TrimSpace(strings.ToLower(msg.Content))
	}

	for _, trigger := range e.triggers {
		fired := false
		currentCond := false

		switch trigger.Type {
		case "manual":
			manualKey := "trigger:" + strings.ToLower(trigger.ID)
			fired = manualMsg == manualKey || manualMsg == "trigger:all"
		case "time":
			last := lastFire[trigger.ID]
			if last == 0 || nowMs-last >= trigger.IntervalMs {
				fired = true
				lastFire[trigger.ID] = nowMs
			}
		case "condition":
			currentCond = evalCondition(trigger.Condition, streamValues, e.normals)
			fired = currentCond && !prevCond[trigger.ID]
		default:
			fired = false
		}

		nextCond[trigger.ID] = currentCond
		if fired {
			triggerFire[trigger.ID] = true
		}
	}

	ctx.SetValue("trigger_prev_state", nextCond)
	ctx.SetValue("trigger_last_fire_ms", lastFire)
	ctx.SetValue("trigger_fires", triggerFire)

	actionEvents := asEventSlice(ctx.GetValue("action_events"))
	for triggerID := range triggerFire {
		for _, actionID := range e.triggerToActions[triggerID] {
			action, ok := e.actions[actionID]
			if !ok {
				continue
			}
				inputs := map[string]any{}
				for _, sourceID := range e.actionInputs[actionID] {
					if value, exists := streamValues[sourceID]; exists {
						inputs[sourceID] = value
					continue
				}
					if value, exists := e.normals[sourceID]; exists {
						inputs[sourceID] = value
					}
				}
				exec := e.executeAction(action, inputs)

				event := map[string]any{
					"t_ms":        nowMs,
					"trigger_id":  triggerID,
					"action_id":   actionID,
					"action_name": action.Name,
					"action_type": action.Kind,
					"mode":        exec.Mode,
					"status":      exec.Status,
					"inputs":      inputs,
					"params":      exec.Params,
					"result":      exec.Result,
				}
				if exec.Error != "" {
					event["error"] = exec.Error
				}
				actionEvents = append(actionEvents, event)
				if len(actionEvents) > 100 {
					actionEvents = actionEvents[len(actionEvents)-100:]
				}
				ctx.SetValue("last_action", event)
				if exec.Error != "" {
					log.Printf("[ACTION] trigger=%s action=%s type=%s mode=%s status=%s err=%s", triggerID, action.Name, action.Kind, exec.Mode, exec.Status, exec.Error)
				} else {
					log.Printf("[ACTION] trigger=%s action=%s type=%s mode=%s status=%s", triggerID, action.Name, action.Kind, exec.Mode, exec.Status)
				}
			}
		}
	ctx.SetValue("action_events", actionEvents)
	ctx.SetValue("runner_state", map[string]any{
		"t_ms":             nowMs,
		"streams_ready":    len(streamValues),
		"triggers_fired":   len(triggerFire),
		"action_event_cnt": len(actionEvents),
	})

	return nil
}

type ActionExecution struct {
	Mode   string
	Status string
	Error  string
	Params map[string]any
	Result map[string]any
}

func (e *Engine) executeAction(action ActionDef, inputs map[string]any) ActionExecution {
	params := e.resolveActionParams(action, inputs)
	exec := ActionExecution{
		Mode:   "paper",
		Status: "skipped",
		Params: params,
		Result: map[string]any{},
	}

	switch strings.ToLower(strings.TrimSpace(action.Kind)) {
	case "cex":
		exchange := normalizeCEXExchange(asString(action.Config["exchange"]))
		providerID := exchange
		if providerID == "" {
			providerID = "binance"
		}
		credentials, ok := e.authCredentials(providerID)
		if !ok {
			exec.Error = fmt.Sprintf("missing %s pre-auth credentials", strings.ToUpper(providerID))
			return exec
		}
		exec.Mode = "live"
		result, err := placeCEXSpotOrder(exchange, params, credentials)
		if err != nil {
			exec.Status = "failed"
			exec.Error = err.Error()
			return exec
		}
		exec.Status = "submitted"
		exec.Result = result
		return exec
	case "dex":
		protocol := strings.ToLower(asString(action.Config["dexProtocol"]))
		apiURL := strings.ToLower(asString(action.Config["apiUrl"]))
		if protocol == "polymarket" || strings.Contains(apiURL, "polymarket") {
			credentials, ok := e.authCredentials("polymarket")
			if !ok {
				exec.Error = "missing Polymarket pre-auth credentials"
				return exec
			}
			exec.Mode = "live"
			result, err := placePolymarketOrder(params, credentials)
			if err != nil {
				exec.Status = "failed"
				exec.Error = err.Error()
				return exec
			}
			exec.Status = "submitted"
			exec.Result = result
			return exec
		}
		if protocol == "evm" || protocol == "evm-contract" {
			credentials, ok := e.authCredentials("evm")
			if !ok {
				exec.Error = "missing EVM pre-auth credentials"
				return exec
			}
			exec.Mode = "live"
			result, err := executeEVMContractAction(params, credentials)
			if err != nil {
				exec.Status = "failed"
				exec.Error = err.Error()
				return exec
			}
			exec.Status = "submitted"
			exec.Result = result
			return exec
		}
		exec.Error = "live execution not supported for current DEX settings"
		return exec
	default:
		exec.Error = fmt.Sprintf("unsupported action kind: %s", action.Kind)
		return exec
	}
}

func (e *Engine) authCredentials(providerID string) (map[string]string, bool) {
	auth, ok := e.auth[strings.ToLower(strings.TrimSpace(providerID))]
	if !ok || !auth.Authenticated || len(auth.Credentials) == 0 {
		return nil, false
	}
	out := map[string]string{}
	for key, value := range auth.Credentials {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			out[key] = trimmed
		}
	}
	return out, len(out) > 0
}

func (e *Engine) resolveActionParams(action ActionDef, inputs map[string]any) map[string]any {
	params := map[string]any{}
	for _, item := range asMapSlice(action.Config["parameters"]) {
		name := strings.TrimSpace(asString(item["name"]))
		if name == "" {
			continue
		}
		if value, ok := resolveActionParamValue(item, inputs); ok {
			params[name] = value
		}
	}

	// keep common top-level config values available to executors
	if value := asString(action.Config["exchange"]); value != "" {
		params["exchange"] = value
	}
	if value := asString(action.Config["dexProtocol"]); value != "" {
		params["dexProtocol"] = value
	}
	if value := asString(action.Config["executionMode"]); value != "" {
		params["executionMode"] = value
	}
	if value := asString(action.Config["contractAddress"]); value != "" {
		params["contractAddress"] = value
	}
	if value := asString(action.Config["contractAbi"]); value != "" {
		params["contractAbi"] = value
	}
	if value := asString(action.Config["evmChain"]); value != "" {
		params["evmChain"] = value
	}
	if value := asString(action.Config["evmFunctionName"]); value != "" {
		params["evmFunctionName"] = value
	}
	if value := asString(action.Config["evmFunctionSignature"]); value != "" {
		params["evmFunctionSignature"] = value
	}
	if value := asString(action.Config["evmFunctionStateMutability"]); value != "" {
		params["evmFunctionStateMutability"] = value
	}
	if value := asString(action.Config["evmTransport"]); value != "" {
		params["evmTransport"] = value
	}
	if value := asString(action.Config["evmCalldata"]); value != "" {
		params["evmCalldata"] = value
	}
	if value := asString(action.Config["chainId"]); value != "" {
		params["chainId"] = value
	}
	if value := asString(action.Config["apiUrl"]); value != "" {
		params["apiUrl"] = value
	}
	if value := asString(action.Config["rpcUrl"]); value != "" {
		params["rpcUrl"] = value
	}
	if value := asString(action.Config["evmValue"]); value != "" {
		params["value"] = value
	}
	return params
}

func resolveActionParamValue(item map[string]any, inputs map[string]any) (any, bool) {
	if sourceValue, ok := resolveInputSourceValue(asMap(item["source"]), inputs); ok {
		return sourceValue, true
	}
	for _, source := range asMapSlice(item["sources"]) {
		if sourceValue, ok := resolveInputSourceValue(source, inputs); ok {
			return sourceValue, true
		}
	}

	rawValue := item["value"]
	switch typed := rawValue.(type) {
	case nil:
		return nil, false
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil, false
		}
		return trimmed, true
	default:
		return rawValue, true
	}
}

func resolveInputSourceValue(source map[string]any, inputs map[string]any) (any, bool) {
	blockID := asString(source["blockId"])
	if blockID == "" {
		return nil, false
	}
	raw, ok := inputs[blockID]
	if !ok {
		return nil, false
	}

	field := strings.TrimSpace(asString(source["field"]))
	if field == "" {
		return raw, true
	}

	path := parseFieldPath(field)
	if value, ok := lookupPayloadPath(raw, path); ok {
		return value, true
	}
	if mapped, ok := raw.(map[string]any); ok {
		if value, exists := mapped[field]; exists {
			return value, true
		}
	}
	return nil, false
}

func parseRuntimeAuth(raw any) map[string]RuntimeProviderAuth {
	out := map[string]RuntimeProviderAuth{}
	payload, ok := raw.(map[string]any)
	if !ok {
		return out
	}

	for providerID, value := range payload {
		row := asMap(value)
		credentials := map[string]string{}
		for key, val := range asMap(row["credentials"]) {
			text := toTrimmedString(val)
			if text != "" {
				credentials[key] = text
			}
		}
		if len(credentials) == 0 {
			continue
		}
		out[strings.ToLower(strings.TrimSpace(providerID))] = RuntimeProviderAuth{
			Authenticated: toBool(row["authenticated"]),
			Credentials:   credentials,
		}
	}
	return out
}

func placeCEXSpotOrder(exchange string, params map[string]any, credentials map[string]string) (map[string]any, error) {
	switch normalizeCEXExchange(exchange) {
	case "", "binance":
		return placeBinanceSpotOrder(params, credentials)
	case "polymarket":
		return placePolymarketOrder(params, credentials)
	case "bybit":
		return placeBybitSpotOrder(params, credentials)
	case "okx":
		return placeOKXSpotOrder(params, credentials)
	case "gateio":
		return placeGateIOSpotOrder(params, credentials)
	default:
		return nil, fmt.Errorf("live execution not supported for exchange=%s", exchange)
	}
}

func placeBinanceSpotOrder(params map[string]any, credentials map[string]string) (map[string]any, error) {
	apiKey := strings.TrimSpace(credentials["apiKey"])
	hmacSecret := strings.TrimSpace(credentials["hmacSecret"])
	if apiKey == "" || hmacSecret == "" {
		return nil, errors.New("binance apiKey/hmacSecret required")
	}

	symbol := strings.ToUpper(toTrimmedString(params["symbol"]))
	if symbol == "" {
		return nil, errors.New("binance action requires symbol")
	}

	side := strings.ToUpper(firstNonEmpty(toTrimmedString(params["side"]), "BUY"))
	orderType := strings.ToUpper(firstNonEmpty(toTrimmedString(params["type"]), "MARKET"))
	baseURL := firstNonEmpty(toTrimmedString(params["apiBaseUrl"]), toTrimmedString(params["baseUrl"]), "https://api.binance.com")
	endpoint := strings.TrimRight(baseURL, "/") + "/api/v3/order"

	values := url.Values{}
	values.Set("symbol", symbol)
	values.Set("side", side)
	values.Set("type", orderType)
	values.Set("timestamp", fmt.Sprintf("%d", time.Now().UnixMilli()))

	recvWindow := int64(asFloat(params["recvWindow"]))
	if recvWindow <= 0 {
		recvWindow = 5000
	}
	values.Set("recvWindow", fmt.Sprintf("%d", recvWindow))

	quantity := formatOrderNumber(params["quantity"])
	price := formatOrderNumber(params["price"])
	quoteOrderQty := formatOrderNumber(params["quoteOrderQty"])
	switch orderType {
	case "LIMIT":
		if quantity == "" || price == "" {
			return nil, errors.New("binance limit order requires quantity and price")
		}
		values.Set("quantity", quantity)
		values.Set("price", price)
		values.Set("timeInForce", strings.ToUpper(firstNonEmpty(toTrimmedString(params["timeInForce"]), "GTC")))
	case "MARKET":
		if quantity == "" && quoteOrderQty == "" {
			return nil, errors.New("binance market order requires quantity or quoteOrderQty")
		}
		if quantity != "" {
			values.Set("quantity", quantity)
		}
		if quoteOrderQty != "" {
			values.Set("quoteOrderQty", quoteOrderQty)
		}
	default:
		if quantity != "" {
			values.Set("quantity", quantity)
		}
		if price != "" {
			values.Set("price", price)
		}
		if tif := strings.ToUpper(toTrimmedString(params["timeInForce"])); tif != "" {
			values.Set("timeInForce", tif)
		}
	}

	query := values.Encode()
	signature := buildHMACSHA256Hex(hmacSecret, query)
	body := query + "&signature=" + signature
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-MBX-APIKEY", apiKey)

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("binance order failed (%d): %s", resp.StatusCode, trimSnippet(payload, 240))
	}

	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("binance response parse failed: %w", err)
	}
	return out, nil
}

func placeBybitSpotOrder(params map[string]any, credentials map[string]string) (map[string]any, error) {
	apiKey := strings.TrimSpace(credentials["apiKey"])
	apiSecret := strings.TrimSpace(credentials["apiSecret"])
	if apiKey == "" || apiSecret == "" {
		return nil, errors.New("bybit apiKey/apiSecret required")
	}

	symbol := formatCEXSymbol("bybit", toTrimmedString(params["symbol"]))
	if symbol == "" {
		return nil, errors.New("bybit action requires symbol")
	}

	side := "Buy"
	if strings.EqualFold(toTrimmedString(params["side"]), "SELL") {
		side = "Sell"
	}
	orderType := strings.Title(strings.ToLower(firstNonEmpty(toTrimmedString(params["type"]), "MARKET")))
	baseURL := firstNonEmpty(toTrimmedString(params["apiBaseUrl"]), toTrimmedString(params["baseUrl"]), "https://api.bybit.com")
	recvWindow := firstNonEmpty(toTrimmedString(params["recvWindow"]), "5000")

	bodyMap := map[string]any{
		"category":    "spot",
		"symbol":      symbol,
		"side":        side,
		"orderType":   orderType,
		"isLeverage":  0,
		"orderFilter": "Order",
	}
	if clientOrderID := firstNonEmpty(toTrimmedString(params["orderLinkId"]), toTrimmedString(params["newClientOrderId"])); clientOrderID != "" {
		bodyMap["orderLinkId"] = clientOrderID
	}

	quantity := formatOrderNumber(params["quantity"])
	price := formatOrderNumber(params["price"])
	quoteOrderQty := formatOrderNumber(params["quoteOrderQty"])
	switch orderType {
	case "Limit":
		if quantity == "" || price == "" {
			return nil, errors.New("bybit limit order requires quantity and price")
		}
		bodyMap["qty"] = quantity
		bodyMap["price"] = price
		bodyMap["timeInForce"] = firstNonEmpty(toTrimmedString(params["timeInForce"]), "GTC")
	case "Market":
		if quoteOrderQty != "" {
			bodyMap["qty"] = quoteOrderQty
			bodyMap["marketUnit"] = "quoteCoin"
		} else if quantity != "" {
			bodyMap["qty"] = quantity
			bodyMap["marketUnit"] = "baseCoin"
		} else {
			return nil, errors.New("bybit market order requires quantity or quoteOrderQty")
		}
		bodyMap["timeInForce"] = firstNonEmpty(toTrimmedString(params["timeInForce"]), "IOC")
	default:
		if quantity == "" {
			return nil, errors.New("bybit order requires quantity")
		}
		bodyMap["qty"] = quantity
		if price != "" {
			bodyMap["price"] = price
		}
	}

	bodyBytes, err := json.Marshal(bodyMap)
	if err != nil {
		return nil, err
	}
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	signature := buildHMACSHA256Hex(apiSecret, timestamp+apiKey+recvWindow+string(bodyBytes))
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(baseURL, "/")+"/v5/order/create", strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BAPI-API-KEY", apiKey)
	req.Header.Set("X-BAPI-TIMESTAMP", timestamp)
	req.Header.Set("X-BAPI-RECV-WINDOW", recvWindow)
	req.Header.Set("X-BAPI-SIGN", signature)
	req.Header.Set("X-BAPI-SIGN-TYPE", "2")

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("bybit response parse failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("bybit order failed (%d): %s", resp.StatusCode, trimSnippet(payload, 240))
	}
	if retCode := int(asFloat(out["retCode"])); retCode != 0 {
		return nil, fmt.Errorf("bybit order failed (%d): %s", retCode, firstNonEmpty(toTrimmedString(out["retMsg"]), trimSnippet(payload, 240)))
	}
	if result := asMap(out["result"]); len(result) > 0 {
		return result, nil
	}
	return out, nil
}

func placeOKXSpotOrder(params map[string]any, credentials map[string]string) (map[string]any, error) {
	apiKey := strings.TrimSpace(credentials["apiKey"])
	apiSecret := strings.TrimSpace(credentials["apiSecret"])
	apiPassphrase := strings.TrimSpace(credentials["apiPassphrase"])
	if apiKey == "" || apiSecret == "" || apiPassphrase == "" {
		return nil, errors.New("okx apiKey/apiSecret/apiPassphrase required")
	}

	symbol := formatCEXSymbol("okx", toTrimmedString(params["symbol"]))
	if symbol == "" {
		return nil, errors.New("okx action requires symbol")
	}

	side := strings.ToLower(firstNonEmpty(toTrimmedString(params["side"]), "buy"))
	orderType := strings.ToLower(firstNonEmpty(toTrimmedString(params["type"]), "market"))
	baseURL := firstNonEmpty(toTrimmedString(params["apiBaseUrl"]), toTrimmedString(params["baseUrl"]), "https://www.okx.com")
	bodyMap := map[string]any{
		"instId":  symbol,
		"tdMode":  firstNonEmpty(toTrimmedString(params["tdMode"]), "cash"),
		"side":    side,
		"ordType": orderType,
	}
	if clientOrderID := firstNonEmpty(toTrimmedString(params["clOrdId"]), toTrimmedString(params["newClientOrderId"])); clientOrderID != "" {
		bodyMap["clOrdId"] = clientOrderID
	}

	quantity := formatOrderNumber(params["quantity"])
	price := formatOrderNumber(params["price"])
	quoteOrderQty := formatOrderNumber(params["quoteOrderQty"])
	switch orderType {
	case "limit":
		if quantity == "" || price == "" {
			return nil, errors.New("okx limit order requires quantity and price")
		}
		bodyMap["sz"] = quantity
		bodyMap["px"] = price
	case "market":
		if quoteOrderQty != "" {
			bodyMap["sz"] = quoteOrderQty
			bodyMap["tgtCcy"] = "quote_ccy"
		} else if quantity != "" {
			bodyMap["sz"] = quantity
			bodyMap["tgtCcy"] = "base_ccy"
		} else {
			return nil, errors.New("okx market order requires quantity or quoteOrderQty")
		}
	default:
		if quantity == "" {
			return nil, errors.New("okx order requires quantity")
		}
		bodyMap["sz"] = quantity
		if price != "" {
			bodyMap["px"] = price
		}
	}

	bodyBytes, err := json.Marshal(bodyMap)
	if err != nil {
		return nil, err
	}
	requestPath := "/api/v5/trade/order"
	timestamp := okxTimestamp(time.Now().UTC())
	signature := buildHMACSHA256Base64(apiSecret, timestamp+"POST"+requestPath+string(bodyBytes))
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(baseURL, "/")+requestPath, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("OK-ACCESS-KEY", apiKey)
	req.Header.Set("OK-ACCESS-SIGN", signature)
	req.Header.Set("OK-ACCESS-TIMESTAMP", timestamp)
	req.Header.Set("OK-ACCESS-PASSPHRASE", apiPassphrase)
	if strings.EqualFold(firstNonEmpty(toTrimmedString(credentials["simulated"]), toTrimmedString(params["simulated"])), "true") || firstNonEmpty(toTrimmedString(credentials["simulated"]), toTrimmedString(params["simulated"])) == "1" {
		req.Header.Set("x-simulated-trading", "1")
	}

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("okx response parse failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("okx order failed (%d): %s", resp.StatusCode, trimSnippet(payload, 240))
	}
	if code := firstNonEmpty(toTrimmedString(out["code"]), "0"); code != "0" {
		return nil, fmt.Errorf("okx order failed (%s): %s", code, firstNonEmpty(toTrimmedString(out["msg"]), trimSnippet(payload, 240)))
	}
	if items := asMapSlice(out["data"]); len(items) > 0 {
		return items[0], nil
	}
	return out, nil
}

func placeGateIOSpotOrder(params map[string]any, credentials map[string]string) (map[string]any, error) {
	apiKey := strings.TrimSpace(credentials["apiKey"])
	apiSecret := strings.TrimSpace(credentials["apiSecret"])
	if apiKey == "" || apiSecret == "" {
		return nil, errors.New("gateio apiKey/apiSecret required")
	}

	symbol := formatCEXSymbol("gateio", toTrimmedString(params["symbol"]))
	if symbol == "" {
		return nil, errors.New("gateio action requires symbol")
	}

	side := strings.ToLower(firstNonEmpty(toTrimmedString(params["side"]), "buy"))
	orderType := strings.ToLower(firstNonEmpty(toTrimmedString(params["type"]), "market"))
	baseURL := firstNonEmpty(toTrimmedString(params["apiBaseUrl"]), toTrimmedString(params["baseUrl"]), "https://api.gateio.ws")
	bodyMap := map[string]any{
		"currency_pair": symbol,
		"account":       firstNonEmpty(toTrimmedString(params["account"]), "spot"),
		"side":          side,
		"type":          orderType,
	}
	if clientOrderID := firstNonEmpty(toTrimmedString(params["text"]), toTrimmedString(params["newClientOrderId"])); clientOrderID != "" {
		bodyMap["text"] = clientOrderID
	}

	quantity := formatOrderNumber(params["quantity"])
	price := formatOrderNumber(params["price"])
	quoteOrderQty := formatOrderNumber(params["quoteOrderQty"])
	switch orderType {
	case "limit":
		if quantity == "" || price == "" {
			return nil, errors.New("gateio limit order requires quantity and price")
		}
		bodyMap["amount"] = quantity
		bodyMap["price"] = price
		bodyMap["time_in_force"] = strings.ToLower(firstNonEmpty(toTrimmedString(params["timeInForce"]), "gtc"))
	case "market":
		if side == "buy" && quoteOrderQty != "" {
			bodyMap["amount"] = quoteOrderQty
		} else if quantity != "" {
			bodyMap["amount"] = quantity
		} else {
			return nil, errors.New("gateio market order requires quantity or quoteOrderQty")
		}
		bodyMap["time_in_force"] = strings.ToLower(firstNonEmpty(toTrimmedString(params["timeInForce"]), "ioc"))
	default:
		if quantity == "" {
			return nil, errors.New("gateio order requires quantity")
		}
		bodyMap["amount"] = quantity
		if price != "" {
			bodyMap["price"] = price
		}
	}

	bodyBytes, err := json.Marshal(bodyMap)
	if err != nil {
		return nil, err
	}
	requestPath := "/api/v4/spot/orders"
	timestamp := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	signString := "POST\n" + requestPath + "\n\n" + sha512Hex(string(bodyBytes)) + "\n" + timestamp
	signature := buildHMACSHA512Hex(apiSecret, signString)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(baseURL, "/")+requestPath, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("KEY", apiKey)
	req.Header.Set("SIGN", signature)
	req.Header.Set("Timestamp", timestamp)

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("gateio response parse failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("gateio order failed (%d): %s", resp.StatusCode, trimSnippet(payload, 240))
	}
	return out, nil
}

func buildHMACSHA256Hex(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func buildHMACSHA256Base64(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func buildHMACSHA512Hex(secret, payload string) string {
	mac := hmac.New(sha512.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func sha512Hex(payload string) string {
	sum := sha512.Sum512([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func okxTimestamp(now time.Time) string {
	return now.UTC().Format("2006-01-02T15:04:05.000Z")
}

func formatOrderNumber(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case int:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func toTrimmedString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func trimSnippet(payload []byte, limit int) string {
	text := strings.TrimSpace(string(payload))
	if text == "" {
		return ""
	}
	if len(text) > limit {
		return text[:limit]
	}
	return text
}

func executeEVMContractAction(params map[string]any, credentials map[string]string) (map[string]any, error) {
	privateKeyHex := strings.TrimSpace(credentials["eoaPrivateKey"])
	if privateKeyHex == "" {
		return nil, errors.New("evm eoaPrivateKey required")
	}

	rpcURL, err := resolveEVMRPCURL(params, credentials)
	if err != nil {
		return nil, err
	}
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("evm rpc dial failed: %w", err)
	}
	defer client.Close()

	contractAddressRaw := firstNonEmpty(toTrimmedString(params["contractAddress"]), toTrimmedString(params["to"]))
	if !common.IsHexAddress(contractAddressRaw) {
		return nil, errors.New("evm contractAddress is invalid")
	}
	contractAddress := common.HexToAddress(contractAddressRaw)

	callData, method, functionName, stateMutability, err := resolveEVMCallSpec(params)
	if err != nil {
		return nil, err
	}

	transport := strings.ToLower(firstNonEmpty(toTrimmedString(params["evmTransport"]), toTrimmedString(params["txTransport"]), "foundry"))
	switch transport {
	case "", "foundry":
		return executeEVMContractActionViaFoundry(params, rpcURL, privateKeyHex, contractAddress, callData, method, functionName, stateMutability)
	case "rpc":
		return executeEVMContractActionViaRPC(params, rpcURL, privateKeyHex, contractAddress, callData, method, functionName, stateMutability)
	default:
		return nil, fmt.Errorf("unsupported evm transport: %s", transport)
	}
}

func resolveEVMRPCURL(params map[string]any, credentials map[string]string) (string, error) {
	chain := firstNonEmpty(toTrimmedString(params["evmChain"]), "eth-mainnet")
	rpcURL := firstNonEmpty(
		toTrimmedString(params["rpcUrl"]),
		resolveChainSpecificRPCURL(chain, credentials),
		toTrimmedString(params["apiUrl"]),
	)
	if rpcURL != "" {
		return rpcURL, nil
	}

	alchemyKey := strings.TrimSpace(credentials["alchemyApiKey"])
	if alchemyKey == "" {
		return "", errors.New("evm rpc url or alchemy api key is required")
	}

	alchemyChain := normalizeAlchemyChainSlug(chain)
	if alchemyChain == "" {
		return "", errors.New("unsupported evm chain slug")
	}
	return fmt.Sprintf("https://%s.g.alchemy.com/v2/%s", alchemyChain, alchemyKey), nil
}

func resolveEVMCallSpec(params map[string]any) ([]byte, *ethabi.Method, string, string, error) {
	rawCalldata := firstNonEmpty(toTrimmedString(params["evmCalldata"]), toTrimmedString(params["calldata"]), toTrimmedString(params["data"]))
	if rawCalldata != "" {
		callData, err := decodeHexOrPlainBytes(rawCalldata)
		if err != nil {
			return nil, nil, "", "", fmt.Errorf("invalid evm calldata: %w", err)
		}
		functionName := firstNonEmpty(toTrimmedString(params["evmFunctionName"]), "raw_calldata")
		stateMutability := firstNonEmpty(toTrimmedString(params["evmFunctionStateMutability"]), "nonpayable")
		return callData, nil, functionName, stateMutability, nil
	}

	abiText := strings.TrimSpace(toTrimmedString(params["contractAbi"]))
	if abiText == "" {
		return nil, nil, "", "", errors.New("evm calldata or contractAbi is required")
	}
	parsedABI, err := ethabi.JSON(strings.NewReader(abiText))
	if err != nil {
		return nil, nil, "", "", fmt.Errorf("evm abi parse failed: %w", err)
	}

	functionName := strings.TrimSpace(firstNonEmpty(toTrimmedString(params["evmFunctionName"]), toTrimmedString(params["functionName"])))
	functionSignature := strings.TrimSpace(firstNonEmpty(toTrimmedString(params["evmFunctionSignature"]), toTrimmedString(params["functionSignature"])))
	if functionName == "" {
		functionName = parseFunctionNameFromSignature(functionSignature)
	}
	if functionName == "" && functionSignature == "" {
		return nil, nil, "", "", errors.New("evm function name or signature is required")
	}

	method, err := resolveEVMABIMethod(parsedABI, functionName, functionSignature)
	if err != nil {
		return nil, nil, "", "", err
	}
	inputArgs, err := buildEVMFunctionArgs(method, params)
	if err != nil {
		return nil, nil, "", "", err
	}
	callData, err := parsedABI.Pack(method.Name, inputArgs...)
	if err != nil {
		return nil, nil, "", "", fmt.Errorf("evm abi pack failed: %w", err)
	}
	return callData, &method, method.Name, method.StateMutability, nil
}

func executeEVMContractActionViaFoundry(params map[string]any, rpcURL, privateKeyHex string, contractAddress common.Address, callData []byte, method *ethabi.Method, functionName, stateMutability string) (map[string]any, error) {
	if _, err := exec.LookPath("cast"); err != nil {
		return nil, errors.New("foundry cast binary not found")
	}

	callDataHex := fmt.Sprintf("0x%x", callData)
	chain := firstNonEmpty(toTrimmedString(params["evmChain"]), "custom")
	readOnly := stateMutability == "view" || stateMutability == "pure"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if readOnly {
		rawOutput, err := runCastCall(ctx, rpcURL, contractAddress.Hex(), callDataHex)
		if err != nil {
			return nil, err
		}
		result := map[string]any{
			"mode":             "call",
			"transport":        "foundry",
			"chain":            chain,
			"rpc_url":          rpcURL,
			"to":               contractAddress.Hex(),
			"function":         functionName,
			"state_mutability": stateMutability,
			"raw_output":       rawOutput,
			"calldata":         callDataHex,
		}
		if decoded, ok := decodeEVMCallOutput(rawOutput, method); ok {
			result["outputs"] = decoded
		}
		return result, nil
	}

	txHash, err := runCastSend(ctx, rpcURL, privateKeyHex, contractAddress.Hex(), callDataHex, toTrimmedString(params["value"]), params)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"mode":             "transaction",
		"transport":        "foundry",
		"chain":            chain,
		"rpc_url":          rpcURL,
		"to":               contractAddress.Hex(),
		"function":         functionName,
		"state_mutability": stateMutability,
		"tx_hash":          txHash,
		"calldata":         callDataHex,
		"value":            toTrimmedString(params["value"]),
	}, nil
}

func executeEVMContractActionViaRPC(params map[string]any, rpcURL, privateKeyHex string, contractAddress common.Address, callData []byte, method *ethabi.Method, functionName, stateMutability string) (map[string]any, error) {
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("evm rpc dial failed: %w", err)
	}
	defer client.Close()

	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return nil, fmt.Errorf("evm private key invalid: %w", err)
	}
	fromAddress := crypto.PubkeyToAddress(privateKey.PublicKey)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	isReadOnly := stateMutability == "view" || stateMutability == "pure"
	if isReadOnly {
		callMsg := ethereum.CallMsg{
			From: fromAddress,
			To:   &contractAddress,
			Data: callData,
		}
		outBytes, err := client.CallContract(ctx, callMsg, nil)
		if err != nil {
			return nil, fmt.Errorf("evm eth_call failed: %w", err)
		}
		result := map[string]any{
			"mode":             "call",
			"transport":        "rpc",
			"chain":            firstNonEmpty(toTrimmedString(params["evmChain"]), "custom"),
			"rpc_url":          rpcURL,
			"from":             fromAddress.Hex(),
			"to":               contractAddress.Hex(),
			"function":         functionName,
			"state_mutability": stateMutability,
			"raw_output":       fmt.Sprintf("0x%x", outBytes),
			"calldata":         fmt.Sprintf("0x%x", callData),
		}
		if method != nil {
			decoded, err := method.Outputs.Unpack(outBytes)
			if err == nil {
				result["outputs"] = formatEVMOutputs(*method, decoded)
			}
		}
		return result, nil
	}

	valueWei, err := parseETHValueToWei(params["value"])
	if err != nil {
		return nil, err
	}
	nonce, err := client.PendingNonceAt(ctx, fromAddress)
	if err != nil {
		return nil, fmt.Errorf("evm nonce fetch failed: %w", err)
	}
	chainID, err := client.NetworkID(ctx)
	if err != nil {
		return nil, fmt.Errorf("evm network id fetch failed: %w", err)
	}

	callMsg := ethereum.CallMsg{
		From:  fromAddress,
		To:    &contractAddress,
		Value: valueWei,
		Data:  callData,
	}
	gasLimit := uint64(0)
	if rawGas, ok := toFloat(params["gasLimit"]); ok && rawGas > 0 {
		gasLimit = uint64(rawGas)
	}
	if gasLimit == 0 {
		estimatedGas, err := client.EstimateGas(ctx, callMsg)
		if err == nil && estimatedGas > 0 {
			gasLimit = estimatedGas
		}
	}
	if gasLimit == 0 {
		gasLimit = 250000
	}

	tipCap, err := resolveEVMGasTipCap(ctx, client, params)
	if err != nil {
		return nil, err
	}
	feeCap, err := resolveEVMGasFeeCap(ctx, client, params, tipCap)
	if err != nil {
		return nil, err
	}

	tx := types.NewTx(&types.DynamicFeeTx{
		ChainID:   chainID,
		Nonce:     nonce,
		GasTipCap: tipCap,
		GasFeeCap: feeCap,
		Gas:       gasLimit,
		To:        &contractAddress,
		Value:     valueWei,
		Data:      callData,
	})
	signedTx, err := types.SignTx(tx, types.LatestSignerForChainID(chainID), privateKey)
	if err != nil {
		return nil, fmt.Errorf("evm tx signing failed: %w", err)
	}
	if err := client.SendTransaction(ctx, signedTx); err != nil {
		return nil, fmt.Errorf("evm send transaction failed: %w", err)
	}

	return map[string]any{
		"mode":             "transaction",
		"transport":        "rpc",
		"chain":            firstNonEmpty(toTrimmedString(params["evmChain"]), "custom"),
		"rpc_url":          rpcURL,
		"from":             fromAddress.Hex(),
		"to":               contractAddress.Hex(),
		"function":         functionName,
		"state_mutability": stateMutability,
		"tx_hash":          signedTx.Hash().Hex(),
		"nonce":            nonce,
		"gas_limit":        gasLimit,
		"max_fee_per_gas":  feeCap.String(),
		"max_priority_fee": tipCap.String(),
		"value_wei":        valueWei.String(),
		"calldata":         fmt.Sprintf("0x%x", callData),
	}, nil
}

func runCastCall(ctx context.Context, rpcURL, to, calldataHex string) (string, error) {
	args := []string{"call", to, "--data", calldataHex, "--rpc-url", rpcURL}
	cmd := exec.CommandContext(ctx, "cast", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("cast call failed: %s", strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func runCastSend(ctx context.Context, rpcURL, privateKeyHex, to, calldataHex, valueText string, params map[string]any) (string, error) {
	args := []string{
		"send",
		to,
		"--data", calldataHex,
		"--private-key", privateKeyHex,
		"--rpc-url", rpcURL,
		"--async",
	}
	if value := strings.TrimSpace(valueText); value != "" {
		args = append(args, "--value", value)
	}
	if gasLimit := strings.TrimSpace(toTrimmedString(params["gasLimit"])); gasLimit != "" {
		args = append(args, "--gas-limit", gasLimit)
	}
	if gasPrice := normalizeFoundryGwei(toTrimmedString(params["maxFeeGwei"])); gasPrice != "" {
		args = append(args, "--gas-price", gasPrice)
	}
	if priorityFee := normalizeFoundryGwei(toTrimmedString(params["maxPriorityFeeGwei"])); priorityFee != "" {
		args = append(args, "--priority-gas-price", priorityFee)
	}

	cmd := exec.CommandContext(ctx, "cast", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("cast send failed: %s", strings.TrimSpace(string(output)))
	}
	txHash := extractHexHash(string(output), 64)
	if txHash == "" {
		return "", fmt.Errorf("cast send returned no tx hash: %s", strings.TrimSpace(string(output)))
	}
	return txHash, nil
}

func resolveChainSpecificRPCURL(chain string, credentials map[string]string) string {
	if key := evmRPCURLCredentialKey(chain); key != "" {
		if rpcURL := strings.TrimSpace(credentials[key]); rpcURL != "" {
			return rpcURL
		}
	}
	return strings.TrimSpace(credentials["rpcUrl"])
}

func evmRPCURLCredentialKey(chain string) string {
	normalized := normalizeEVMRPCKey(chain)
	if normalized == "" {
		return ""
	}
	return "rpcUrl_" + normalized
}

func normalizeEVMRPCKey(raw string) string {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return ""
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, char := range text {
		isAlphaNum := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if isAlphaNum {
			builder.WriteRune(char)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(builder.String(), "_")
}

func normalizeFoundryGwei(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if strings.ContainsAny(text, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
		return text
	}
	return text + "gwei"
}

func extractHexHash(raw string, byteLen int) string {
	fields := strings.Fields(strings.TrimSpace(raw))
	expectedLen := 2 + (byteLen * 2)
	for _, field := range fields {
		candidate := strings.TrimSpace(strings.Trim(field, "\"'"))
		if len(candidate) != expectedLen || !strings.HasPrefix(candidate, "0x") {
			continue
		}
		if _, err := hex.DecodeString(candidate[2:]); err == nil {
			return candidate
		}
	}
	return ""
}

func decodeEVMCallOutput(rawOutput string, method *ethabi.Method) (map[string]any, bool) {
	if method == nil {
		return nil, false
	}
	decodedBytes, err := decodeHexOrPlainBytes(rawOutput)
	if err != nil {
		return nil, false
	}
	values, err := method.Outputs.Unpack(decodedBytes)
	if err != nil {
		return nil, false
	}
	return formatEVMOutputs(*method, values), true
}

func normalizeAlchemyChainSlug(raw string) string {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return ""
	}
	allowed := map[string]string{
		"eth-mainnet":     "eth-mainnet",
		"ethereum":        "eth-mainnet",
		"base-mainnet":    "base-mainnet",
		"base":            "base-mainnet",
		"arb-mainnet":     "arb-mainnet",
		"arbitrum":        "arb-mainnet",
		"opt-mainnet":     "opt-mainnet",
		"optimism":        "opt-mainnet",
		"polygon-mainnet": "polygon-mainnet",
		"polygon":         "polygon-mainnet",
		"bsc-mainnet":     "bsc-mainnet",
		"bsc":             "bsc-mainnet",
	}
	if slug, ok := allowed[text]; ok {
		return slug
	}
	return ""
}

func parseFunctionNameFromSignature(signature string) string {
	text := strings.TrimSpace(signature)
	if text == "" {
		return ""
	}
	index := strings.Index(text, "(")
	if index < 0 {
		return text
	}
	return strings.TrimSpace(text[:index])
}

func resolveEVMABIMethod(parsedABI ethabi.ABI, functionName, functionSignature string) (ethabi.Method, error) {
	normalizedSignature := normalizeFunctionSignature(functionSignature)
	if normalizedSignature != "" {
		for _, method := range parsedABI.Methods {
			if normalizeFunctionSignature(methodCanonicalSignature(method)) == normalizedSignature {
				return method, nil
			}
		}
	}

	trimmedName := strings.TrimSpace(functionName)
	if trimmedName != "" {
		if method, ok := parsedABI.Methods[trimmedName]; ok {
			return method, nil
		}

		matches := make([]ethabi.Method, 0, 2)
		for _, method := range parsedABI.Methods {
			if strings.EqualFold(strings.TrimSpace(method.RawName), trimmedName) || strings.EqualFold(strings.TrimSpace(method.Name), trimmedName) {
				matches = append(matches, method)
			}
		}
		if len(matches) == 1 {
			return matches[0], nil
		}
		if len(matches) > 1 {
			return ethabi.Method{}, fmt.Errorf("evm function is overloaded, specify signature: %s", trimmedName)
		}
	}

	if normalizedSignature != "" {
		return ethabi.Method{}, fmt.Errorf("evm function signature not found in abi: %s", functionSignature)
	}
	return ethabi.Method{}, fmt.Errorf("evm function not found in abi: %s", functionName)
}

func methodCanonicalSignature(method ethabi.Method) string {
	name := strings.TrimSpace(method.RawName)
	if name == "" {
		name = strings.TrimSpace(method.Name)
	}
	argTypes := make([]string, 0, len(method.Inputs))
	for _, input := range method.Inputs {
		argTypes = append(argTypes, strings.TrimSpace(input.Type.String()))
	}
	return fmt.Sprintf("%s(%s)", name, strings.Join(argTypes, ","))
}

func normalizeFunctionSignature(signature string) string {
	text := strings.TrimSpace(signature)
	if text == "" {
		return ""
	}
	return strings.ReplaceAll(text, " ", "")
}

func buildEVMFunctionArgs(method ethabi.Method, params map[string]any) ([]any, error) {
	args := make([]any, 0, len(method.Inputs))
	for index, input := range method.Inputs {
		key := strings.TrimSpace(input.Name)
		if key == "" {
			key = fmt.Sprintf("arg%d", index+1)
		}
		raw, exists := params[key]
		if !exists {
			return nil, fmt.Errorf("missing evm input: %s", key)
		}
		converted, err := convertEVMInputValue(input.Type, raw)
		if err != nil {
			return nil, fmt.Errorf("invalid evm input %s (%s): %w", key, input.Type.String(), err)
		}
		args = append(args, converted)
	}
	return args, nil
}

func convertEVMInputValue(typ ethabi.Type, raw any) (any, error) {
	switch typ.T {
	case ethabi.AddressTy:
		text := toTrimmedString(raw)
		if !common.IsHexAddress(text) {
			return nil, errors.New("invalid address")
		}
		return common.HexToAddress(text), nil
	case ethabi.StringTy:
		return toTrimmedString(raw), nil
	case ethabi.BoolTy:
		return toBool(raw), nil
	case ethabi.IntTy, ethabi.UintTy:
		return parseBigIntFromAny(raw)
	case ethabi.BytesTy:
		return decodeHexOrPlainBytes(raw)
	case ethabi.FixedBytesTy:
		decoded, err := decodeHexOrPlainBytes(raw)
		if err != nil {
			return nil, err
		}
		if len(decoded) > typ.Size {
			return nil, fmt.Errorf("fixed bytes too long: %d > %d", len(decoded), typ.Size)
		}
		fixed := make([]byte, typ.Size)
		copy(fixed, decoded)
		return fixed, nil
	default:
		return nil, fmt.Errorf("unsupported abi type: %s", typ.String())
	}
}

func parseBigIntFromAny(raw any) (*big.Int, error) {
	text := toTrimmedString(raw)
	if text == "" {
		return nil, errors.New("empty number")
	}
	base := 10
	if strings.HasPrefix(text, "0x") || strings.HasPrefix(text, "0X") {
		base = 16
		text = text[2:]
	}
	out := new(big.Int)
	if _, ok := out.SetString(text, base); ok {
		return out, nil
	}
	return nil, errors.New("invalid integer")
}

func decodeHexOrPlainBytes(raw any) ([]byte, error) {
	text := toTrimmedString(raw)
	if text == "" {
		return []byte{}, nil
	}
	if strings.HasPrefix(text, "0x") || strings.HasPrefix(text, "0X") {
		out, err := hex.DecodeString(strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X"))
		if err != nil {
			return nil, err
		}
		return out, nil
	}
	return []byte(text), nil
}

func parseETHValueToWei(raw any) (*big.Int, error) {
	text := toTrimmedString(raw)
	if text == "" {
		return big.NewInt(0), nil
	}

	rat, ok := new(big.Rat).SetString(text)
	if !ok {
		return nil, errors.New("invalid eth value")
	}
	multiplier := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	weiRat := new(big.Rat).Mul(rat, multiplier)
	wei := new(big.Int).Quo(weiRat.Num(), weiRat.Denom())
	if wei.Sign() < 0 {
		return nil, errors.New("eth value cannot be negative")
	}
	return wei, nil
}

func parseGweiToWei(raw any) (*big.Int, error) {
	text := toTrimmedString(raw)
	if text == "" {
		return nil, nil
	}
	rat, ok := new(big.Rat).SetString(text)
	if !ok {
		return nil, errors.New("invalid gwei value")
	}
	multiplier := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(9), nil))
	weiRat := new(big.Rat).Mul(rat, multiplier)
	wei := new(big.Int).Quo(weiRat.Num(), weiRat.Denom())
	if wei.Sign() < 0 {
		return nil, errors.New("gwei value cannot be negative")
	}
	return wei, nil
}

func resolveEVMGasTipCap(ctx context.Context, client *ethclient.Client, params map[string]any) (*big.Int, error) {
	if override, err := parseGweiToWei(params["maxPriorityFeeGwei"]); err != nil {
		return nil, err
	} else if override != nil {
		return override, nil
	}
	tip, err := client.SuggestGasTipCap(ctx)
	if err == nil && tip != nil && tip.Sign() > 0 {
		return tip, nil
	}
	// fallback 2 gwei
	return new(big.Int).Mul(big.NewInt(2), big.NewInt(1_000_000_000)), nil
}

func resolveEVMGasFeeCap(ctx context.Context, client *ethclient.Client, params map[string]any, tipCap *big.Int) (*big.Int, error) {
	if override, err := parseGweiToWei(params["maxFeeGwei"]); err != nil {
		return nil, err
	} else if override != nil {
		return override, nil
	}
	head, err := client.HeaderByNumber(ctx, nil)
	if err == nil && head != nil && head.BaseFee != nil {
		feeCap := new(big.Int).Mul(head.BaseFee, big.NewInt(2))
		feeCap.Add(feeCap, tipCap)
		return feeCap, nil
	}
	return new(big.Int).Mul(tipCap, big.NewInt(2)), nil
}

func normalizeEVMOutputValue(value any) any {
	switch typed := value.(type) {
	case *big.Int:
		if typed == nil {
			return "0"
		}
		return typed.String()
	case common.Address:
		return typed.Hex()
	case []byte:
		return fmt.Sprintf("0x%x", typed)
	default:
		return value
	}
}

func formatEVMOutputs(method ethabi.Method, values []any) map[string]any {
	out := map[string]any{}
	for index, value := range values {
		key := fmt.Sprintf("out%d", index+1)
		if index < len(method.Outputs) {
			name := strings.TrimSpace(method.Outputs[index].Name)
			if name != "" {
				key = name
			}
		}
		out[key] = normalizeEVMOutputValue(value)
	}
	return out
}

const (
	polyHeaderAddress    = "POLY_ADDRESS"
	polyHeaderSignature  = "POLY_SIGNATURE"
	polyHeaderTimestamp  = "POLY_TIMESTAMP"
	polyHeaderNonce      = "POLY_NONCE"
	polyHeaderAPIKey     = "POLY_API_KEY"
	polyHeaderPassphrase = "POLY_PASSPHRASE"
)

const (
	polyClobDomainName    = "ClobAuthDomain"
	polyClobDomainVersion = "1"
	polyClobAuthMessage   = "This message attests that I control the given wallet"
	polyOrderDomainName   = "Polymarket CTF Exchange"
	polyOrderDomainVer    = "1"
)

type polyAPICreds struct {
	APIKey        string
	APISecret     string
	APIPassphrase string
}

type polyClient struct {
	host       string
	httpClient *http.Client
	chainID    int64
	privateKey *ecdsa.PrivateKey
	address    common.Address
	funder     common.Address
	creds      *polyAPICreds
}

type polyOrderArgs struct {
	TokenID    string
	Price      float64
	Size       float64
	Side       string
	FeeRateBps int
	Nonce      int64
	Expiration int64
}

type polyOrderToSign struct {
	Salt          *big.Int
	Maker         string
	Signer        string
	Taker         string
	TokenID       *big.Int
	MakerAmount   *big.Int
	TakerAmount   *big.Int
	Expiration    *big.Int
	Nonce         *big.Int
	FeeRateBps    *big.Int
	Side          int
	SignatureType int
}

type polySignedOrder struct {
	Salt          string
	Maker         string
	Signer        string
	Taker         string
	TokenID       string
	MakerAmount   string
	TakerAmount   string
	Expiration    string
	Nonce         string
	FeeRateBps    string
	Side          string
	SignatureType int
	Signature     string
}

type polyContractConfig struct {
	Exchange string
}

func placePolymarketOrder(params map[string]any, credentials map[string]string) (map[string]any, error) {
	privateKey := strings.TrimSpace(credentials["privateKey"])
	funder := strings.TrimSpace(credentials["funder"])
	if privateKey == "" || funder == "" {
		return nil, errors.New("polymarket privateKey/funder required")
	}

	tokenID := firstNonEmpty(toTrimmedString(params["tokenId"]), toTrimmedString(params["token_id"]))
	if tokenID == "" {
		return nil, errors.New("polymarket action requires tokenId")
	}

	price, ok := toFloat(params["price"])
	if !ok || price <= 0 {
		return nil, errors.New("polymarket action requires positive price")
	}
	size, ok := toFloat(params["size"])
	if !ok || size <= 0 {
		return nil, errors.New("polymarket action requires positive size")
	}
	side := strings.ToUpper(firstNonEmpty(toTrimmedString(params["side"]), "BUY"))
	orderType := strings.ToUpper(firstNonEmpty(toTrimmedString(params["orderType"]), "GTC"))
	postOnly := toBool(params["postOnly"])

	chainID := int64(137)
	if raw := strings.TrimSpace(firstNonEmpty(credentials["chainId"], toTrimmedString(params["chainId"]))); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			chainID = parsed
		}
	}
	host := firstNonEmpty(toTrimmedString(params["clobHost"]), toTrimmedString(params["baseUrl"]), "https://clob.polymarket.com")

	client, err := newPolyClient(host, chainID, privateKey, funder, &polyAPICreds{
		APIKey:        strings.TrimSpace(credentials["apiKey"]),
		APISecret:     strings.TrimSpace(credentials["apiSecret"]),
		APIPassphrase: strings.TrimSpace(credentials["apiPassphrase"]),
	})
	if err != nil {
		return nil, err
	}

	if err := client.ensureAPICreds(); err != nil {
		return nil, err
	}

	feeRate, _ := client.getFeeRateBps(tokenID)
	tickSize, err := client.getTickSize(tokenID)
	if err != nil || tickSize == 0 {
		tickSize = 0.01
	}
	negRisk, _ := client.getNegRisk(tokenID)
	signed, err := client.buildSignedOrder(polyOrderArgs{
		TokenID:    tokenID,
		Price:      price,
		Size:       size,
		Side:       side,
		FeeRateBps: feeRate,
	}, tickSize, negRisk)
	if err != nil {
		return nil, err
	}

	result, err := client.postOrder(signed, orderType, postOnly)
	if err != nil {
		return nil, err
	}
	result["token_id"] = tokenID
	result["price"] = price
	result["size"] = size
	result["side"] = strings.ToLower(side)
	result["order_type"] = orderType
	return result, nil
}

func newPolyClient(host string, chainID int64, privateKeyHex, funder string, creds *polyAPICreds) (*polyClient, error) {
	key, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(privateKeyHex), "0x"))
	if err != nil {
		return nil, err
	}
	address := crypto.PubkeyToAddress(key.PublicKey)
	client := &polyClient{
		host:       strings.TrimRight(host, "/"),
		httpClient: &http.Client{Timeout: 20 * time.Second},
		chainID:    chainID,
		privateKey: key,
		address:    address,
		funder:     address,
		creds:      creds,
	}
	if trimmedFunder := strings.TrimSpace(funder); trimmedFunder != "" {
		client.funder = common.HexToAddress(trimmedFunder)
	}
	return client, nil
}

func (c *polyClient) ensureAPICreds() error {
	if c.creds != nil && strings.TrimSpace(c.creds.APIKey) != "" && strings.TrimSpace(c.creds.APISecret) != "" && strings.TrimSpace(c.creds.APIPassphrase) != "" {
		return nil
	}
	creds, err := c.createOrDeriveAPIKey()
	if err != nil {
		return err
	}
	c.creds = creds
	return nil
}

func (c *polyClient) createOrDeriveAPIKey() (*polyAPICreds, error) {
	created, createErr := c.createAPIKey()
	if createErr == nil {
		return created, nil
	}
	derived, deriveErr := c.deriveAPIKey()
	if deriveErr == nil {
		return derived, nil
	}
	return nil, fmt.Errorf("create/derive api key failed: create=%v derive=%v", createErr, deriveErr)
}

func (c *polyClient) createAPIKey() (*polyAPICreds, error) {
	headers, err := c.level1Headers(0)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest(http.MethodPost, "/auth/api-key", nil, headers)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return &polyAPICreds{
		APIKey:        firstNonEmpty(toTrimmedString(parsed["apiKey"]), toTrimmedString(parsed["api_key"])),
		APISecret:     firstNonEmpty(toTrimmedString(parsed["secret"]), toTrimmedString(parsed["apiSecret"])),
		APIPassphrase: firstNonEmpty(toTrimmedString(parsed["passphrase"]), toTrimmedString(parsed["apiPassphrase"])),
	}, nil
}

func (c *polyClient) deriveAPIKey() (*polyAPICreds, error) {
	headers, err := c.level1Headers(0)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest(http.MethodGet, "/auth/derive-api-key", nil, headers)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return &polyAPICreds{
		APIKey:        firstNonEmpty(toTrimmedString(parsed["apiKey"]), toTrimmedString(parsed["api_key"])),
		APISecret:     firstNonEmpty(toTrimmedString(parsed["secret"]), toTrimmedString(parsed["apiSecret"])),
		APIPassphrase: firstNonEmpty(toTrimmedString(parsed["passphrase"]), toTrimmedString(parsed["apiPassphrase"])),
	}, nil
}

func (c *polyClient) postOrder(order polySignedOrder, orderType string, postOnly bool) (map[string]any, error) {
	if c.creds == nil {
		return nil, errors.New("polymarket api credentials missing")
	}
	payload, err := json.Marshal(map[string]any{
		"order": map[string]any{
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
			"signature":     order.Signature,
		},
		"owner":     c.creds.APIKey,
		"orderType": orderType,
		"postOnly":  postOnly,
	})
	if err != nil {
		return nil, err
	}
	headers, err := c.level2Headers(http.MethodPost, "/order", payload)
	if err != nil {
		return nil, err
	}
	resp, err := c.doRequest(http.MethodPost, "/order", payload, headers)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

func (c *polyClient) getTickSize(tokenID string) (float64, error) {
	path := fmt.Sprintf("/tick-size?token_id=%s", tokenID)
	resp, err := c.doRequest(http.MethodGet, path, nil, nil)
	if err != nil {
		return 0, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return 0, err
	}
	return polyParseFloat(parsed["minimum_tick_size"]), nil
}

func (c *polyClient) getNegRisk(tokenID string) (bool, error) {
	path := fmt.Sprintf("/neg-risk?token_id=%s", tokenID)
	resp, err := c.doRequest(http.MethodGet, path, nil, nil)
	if err != nil {
		return false, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return false, err
	}
	return toBool(parsed["neg_risk"]), nil
}

func (c *polyClient) getFeeRateBps(tokenID string) (int, error) {
	path := fmt.Sprintf("/fee-rate?token_id=%s", tokenID)
	resp, err := c.doRequest(http.MethodGet, path, nil, nil)
	if err != nil {
		return 0, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return 0, err
	}
	return int(asFloat(parsed["fee_rate_bps"])), nil
}

func (c *polyClient) buildSignedOrder(args polyOrderArgs, tickSize float64, negRisk bool) (polySignedOrder, error) {
	roundCfg := polyRoundingConfig(tickSize)
	price := polyRoundNormal(args.Price, roundCfg.price)
	if !polyPriceValid(price, tickSize) {
		return polySignedOrder{}, fmt.Errorf("invalid price %f for tick size %f", price, tickSize)
	}

	sideValue := 0
	if strings.ToUpper(args.Side) == "SELL" {
		sideValue = 1
	}

	var makerAmount int64
	var takerAmount int64
	if sideValue == 0 {
		rawTaker := polyRoundDown(args.Size, roundCfg.size)
		rawMaker := polyNormalizeAmount(rawTaker*price, roundCfg.amount)
		makerAmount = polyToTokenDecimals(rawMaker)
		takerAmount = polyToTokenDecimals(rawTaker)
	} else {
		rawMaker := polyRoundDown(args.Size, roundCfg.size)
		rawTaker := polyNormalizeAmount(rawMaker*price, roundCfg.amount)
		makerAmount = polyToTokenDecimals(rawMaker)
		takerAmount = polyToTokenDecimals(rawTaker)
	}

	order := polyOrderToSign{
		Salt:          big.NewInt(polyRandomSalt()),
		Maker:         c.funder.Hex(),
		Signer:        c.address.Hex(),
		Taker:         polyZeroAddress(),
		TokenID:       polyParseBigInt(args.TokenID),
		MakerAmount:   big.NewInt(makerAmount),
		TakerAmount:   big.NewInt(takerAmount),
		Expiration:    big.NewInt(args.Expiration),
		Nonce:         big.NewInt(args.Nonce),
		FeeRateBps:    big.NewInt(int64(args.FeeRateBps)),
		Side:          sideValue,
		SignatureType: 0,
	}
	sig, err := c.signOrder(order, negRisk)
	if err != nil {
		return polySignedOrder{}, err
	}

	sideLabel := "BUY"
	if sideValue == 1 {
		sideLabel = "SELL"
	}
	return polySignedOrder{
		Salt:          order.Salt.String(),
		Maker:         order.Maker,
		Signer:        order.Signer,
		Taker:         order.Taker,
		TokenID:       order.TokenID.String(),
		MakerAmount:   order.MakerAmount.String(),
		TakerAmount:   order.TakerAmount.String(),
		Expiration:    order.Expiration.String(),
		Nonce:         order.Nonce.String(),
		FeeRateBps:    order.FeeRateBps.String(),
		Side:          sideLabel,
		SignatureType: order.SignatureType,
		Signature:     sig,
	}, nil
}

func (c *polyClient) signOrder(order polyOrderToSign, negRisk bool) (string, error) {
	contractCfg, err := polyContractForChain(c.chainID, negRisk)
	if err != nil {
		return "", err
	}
	typed := apitypes.TypedData{
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
			Name:              polyOrderDomainName,
			Version:           polyOrderDomainVer,
			ChainId:           ethmath.NewHexOrDecimal256(c.chainID),
			VerifyingContract: contractCfg.Exchange,
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
	return polySignTypedData(c.privateKey, typed)
}

func (c *polyClient) level1Headers(nonce int64) (map[string]string, error) {
	ts := time.Now().Unix()
	signature, err := polySignClobAuth(c.privateKey, c.address.Hex(), c.chainID, ts, nonce)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		polyHeaderAddress:   c.address.Hex(),
		polyHeaderSignature: signature,
		polyHeaderTimestamp: fmt.Sprintf("%d", ts),
		polyHeaderNonce:     fmt.Sprintf("%d", nonce),
	}, nil
}

func (c *polyClient) level2Headers(method, path string, body []byte) (map[string]string, error) {
	if c.creds == nil {
		return nil, errors.New("missing api credentials for level2")
	}
	ts := time.Now().Unix()
	signature, err := polyBuildHMACSignature(c.creds.APISecret, ts, method, path, body)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		polyHeaderAddress:    c.address.Hex(),
		polyHeaderSignature:  signature,
		polyHeaderTimestamp:  fmt.Sprintf("%d", ts),
		polyHeaderAPIKey:     c.creds.APIKey,
		polyHeaderPassphrase: c.creds.APIPassphrase,
	}, nil
}

func (c *polyClient) doRequest(method, path string, body []byte, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequest(method, c.host+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("polymarket request failed (%d): %s", resp.StatusCode, trimSnippet(payload, 240))
	}
	return payload, nil
}

func polySignClobAuth(privateKey *ecdsa.PrivateKey, address string, chainID, timestamp, nonce int64) (string, error) {
	typed := apitypes.TypedData{
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
			Name:    polyClobDomainName,
			Version: polyClobDomainVersion,
			ChainId: ethmath.NewHexOrDecimal256(chainID),
		},
		Message: map[string]any{
			"address":   address,
			"timestamp": fmt.Sprintf("%d", timestamp),
			"nonce":     fmt.Sprintf("%d", nonce),
			"message":   polyClobAuthMessage,
		},
	}
	return polySignTypedData(privateKey, typed)
}

func polySignTypedData(privateKey *ecdsa.PrivateKey, typed apitypes.TypedData) (string, error) {
	hash, _, err := apitypes.TypedDataAndHash(typed)
	if err != nil {
		return "", err
	}
	sig, err := crypto.Sign(hash, privateKey)
	if err != nil {
		return "", err
	}
	if sig[64] < 27 {
		sig[64] += 27
	}
	return "0x" + hex.EncodeToString(sig), nil
}

func polyBuildHMACSignature(secret string, timestamp int64, method, path string, body []byte) (string, error) {
	decoded, err := polyDecodeBase64URL(secret)
	if err != nil {
		return "", err
	}
	message := fmt.Sprintf("%d%s%s", timestamp, method, path)
	if len(body) > 0 {
		message += strings.ReplaceAll(string(body), "'", "\"")
	}
	mac := hmac.New(sha256.New, decoded)
	if _, err := mac.Write([]byte(message)); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func polyDecodeBase64URL(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, errors.New("empty base64 payload")
	}
	if mod := len(trimmed) % 4; mod != 0 {
		trimmed += strings.Repeat("=", 4-mod)
	}
	return base64.URLEncoding.DecodeString(trimmed)
}

func polyContractForChain(chainID int64, negRisk bool) (polyContractConfig, error) {
	regular := map[int64]polyContractConfig{
		137:   {Exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"},
		80002: {Exchange: "0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40"},
	}
	negRiskMap := map[int64]polyContractConfig{
		137:   {Exchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a"},
		80002: {Exchange: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296"},
	}
	if negRisk {
		if cfg, ok := negRiskMap[chainID]; ok {
			return cfg, nil
		}
	}
	if cfg, ok := regular[chainID]; ok {
		return cfg, nil
	}
	return polyContractConfig{}, fmt.Errorf("unsupported chain id: %d", chainID)
}

type polyRoundConfig struct {
	price  int
	size   int
	amount int
}

func polyRoundingConfig(tickSize float64) polyRoundConfig {
	switch fmt.Sprintf("%.4f", tickSize) {
	case "0.1000":
		return polyRoundConfig{price: 1, size: 2, amount: 3}
	case "0.0100":
		return polyRoundConfig{price: 2, size: 2, amount: 4}
	case "0.0010":
		return polyRoundConfig{price: 3, size: 2, amount: 5}
	case "0.0001":
		return polyRoundConfig{price: 4, size: 2, amount: 6}
	default:
		return polyRoundConfig{price: 2, size: 2, amount: 4}
	}
}

func polyRoundDown(value float64, digits int) float64 {
	m := math.Pow(10, float64(digits))
	return math.Floor(value*m) / m
}

func polyRoundUp(value float64, digits int) float64 {
	m := math.Pow(10, float64(digits))
	return math.Ceil(value*m) / m
}

func polyRoundNormal(value float64, digits int) float64 {
	m := math.Pow(10, float64(digits))
	return math.Round(value*m) / m
}

func polyNormalizeAmount(value float64, digits int) float64 {
	fractional := value - math.Floor(value)
	if fractional == 0 {
		return value
	}
	value = polyRoundUp(value, digits+4)
	if polyDecimalPlaces(value) > digits {
		value = polyRoundDown(value, digits)
	}
	return value
}

func polyDecimalPlaces(value float64) int {
	s := strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.8f", value), "0"), ".")
	if index := strings.IndexByte(s, '.'); index >= 0 {
		return len(s) - index - 1
	}
	return 0
}

func polyToTokenDecimals(value float64) int64 {
	converted := value * 1e6
	if polyDecimalPlaces(converted) > 0 {
		converted = polyRoundNormal(converted, 0)
	}
	return int64(converted)
}

func polyPriceValid(price, tickSize float64) bool {
	return price >= tickSize && price <= 1.0-tickSize
}

func polyRandomSalt() int64 {
	var buf [8]byte
	if _, err := cryptorand.Read(buf[:]); err == nil {
		var out uint64
		for _, b := range buf {
			out = (out << 8) | uint64(b)
		}
		return int64(out)
	}
	return time.Now().UnixNano()
}

func polyZeroAddress() string {
	return "0x0000000000000000000000000000000000000000"
}

func polyParseBigInt(value string) *big.Int {
	text := strings.TrimSpace(value)
	if text == "" {
		return big.NewInt(0)
	}
	if strings.HasPrefix(text, "0x") {
		text = text[2:]
	}
	out := new(big.Int)
	if _, ok := out.SetString(text, 10); ok {
		return out
	}
	if _, ok := out.SetString(text, 16); ok {
		return out
	}
	return big.NewInt(0)
}

func polyParseFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err == nil {
			return parsed
		}
	}
	return 0
}

func (e *Engine) resolveStreamValue(stream StreamDef, ctx hersh.HershContext) any {
	sourceURL := strings.TrimSpace(stream.SourceURL)
	switch {
	case isEVMRPCStream(stream):
		return e.watchEVMRPCStream(stream, ctx)
	case isCEXMarketStream(stream):
		return e.watchCEXMarketStream(stream, ctx)
	case isPolymarketMarketStream(stream):
		return e.watchPolymarketMarketStream(stream, ctx)
	case isWSSourceURL(sourceURL):
		return e.watchWSStream(stream, ctx)
	case isHTTPSourceURL(sourceURL):
		return e.watchHTTPStream(stream, ctx)
	default:
		return e.watchUnavailableStream(stream, ctx)
	}
}

func isEVMRPCStream(stream StreamDef) bool {
	kind := strings.ToLower(strings.TrimSpace(stream.Kind))
	if kind == "evm-rpc" {
		return true
	}
	return strings.TrimSpace(stream.Chain) != ""
}

func isCEXMarketStream(stream StreamDef) bool {
	return strings.EqualFold(strings.TrimSpace(stream.Kind), "cex-market")
}

func isPolymarketMarketStream(stream StreamDef) bool {
	return strings.EqualFold(strings.TrimSpace(stream.Kind), "polymarket-market")
}

func (e *Engine) watchUnavailableStream(stream StreamDef, ctx hersh.HershContext) any {
	varName := "stream_" + stream.ID
	return hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			return buildStreamErrorSnapshot(stream, errors.New("stream source is not configured")), true, nil
		}, nil
	}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)
}

func (e *Engine) watchEVMRPCStream(stream StreamDef, ctx hersh.HershContext) any {
	varName := "stream_" + stream.ID
	client := httpClientForStream(ctx)
	credentials, _ := e.authCredentials("evm")
	return hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			prevMap, _ := prev.(map[string]any)
			next, err := readEVMRPCStreamSnapshot(client, stream, credentials)
			if err != nil {
				if len(prevMap) > 0 {
					stale := cloneMap(prevMap)
					stale["t_ms"] = time.Now().UnixMilli()
					stale["fetch_error"] = err.Error()
					return stale, true, nil
				}
				return buildStreamErrorSnapshot(stream, err), true, nil
			}
			return next, true, nil
		}, nil
	}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)
}

func (e *Engine) watchCEXMarketStream(stream StreamDef, ctx hersh.HershContext) any {
	varName := "stream_" + stream.ID
	client := httpClientForStream(ctx)
	return hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			prevMap, _ := prev.(map[string]any)
			next, err := readCEXMarketSnapshot(client, stream)
			if err != nil {
				if len(prevMap) > 0 {
					stale := cloneMap(prevMap)
					stale["t_ms"] = time.Now().UnixMilli()
					stale["fetch_error"] = err.Error()
					return stale, true, nil
				}
				return buildStreamErrorSnapshot(stream, err), true, nil
			}
			return next, true, nil
		}, nil
	}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)
}

func (e *Engine) watchPolymarketMarketStream(stream StreamDef, ctx hersh.HershContext) any {
	varName := "stream_" + stream.ID
	client := httpClientForStream(ctx)
	return hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			prevMap, _ := prev.(map[string]any)
			next, err := readPolymarketMarketSnapshot(client, stream)
			if err != nil {
				if len(prevMap) > 0 {
					stale := cloneMap(prevMap)
					stale["t_ms"] = time.Now().UnixMilli()
					stale["fetch_error"] = err.Error()
					return stale, true, nil
				}
				return buildStreamErrorSnapshot(stream, err), true, nil
			}
			return next, true, nil
		}, nil
	}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)
}

func readCEXMarketSnapshot(client *http.Client, stream StreamDef) (map[string]any, error) {
	exchange := normalizeCEXExchange(stream.Exchange)
	symbol := formatCEXSymbol(exchange, stream.Symbol)
	if exchange == "" {
		return nil, errors.New("cex market stream requires exchange")
	}
	if symbol == "" {
		return nil, errors.New("cex market stream requires symbol")
	}

	switch exchange {
	case "binance":
		payload, err := fetchJSONPayload(client, "https://api.binance.com/api/v3/ticker/24hr?symbol="+url.QueryEscape(symbol))
		if err != nil {
			return nil, err
		}
		row := asMap(payload)
		return buildMarketSnapshot(stream, map[string]any{
			"exchange":    exchange,
			"symbol":      symbol,
			"lastPrice":   row["lastPrice"],
			"bidPrice":    row["bidPrice"],
			"askPrice":    row["askPrice"],
			"bidSize":     row["bidQty"],
			"askSize":     row["askQty"],
			"volume":      row["volume"],
			"quoteVolume": row["quoteVolume"],
			"highPrice":   row["highPrice"],
			"lowPrice":    row["lowPrice"],
			"openPrice":   row["openPrice"],
			"eventTime":   row["closeTime"],
		}), nil
	case "bybit":
		payload, err := fetchJSONPayload(client, "https://api.bybit.com/v5/market/tickers?category=spot&symbol="+url.QueryEscape(symbol))
		if err != nil {
			return nil, err
		}
		root := asMap(payload)
		items := asMapSlice(asMap(root["result"])["list"])
		row := map[string]any{}
		if len(items) > 0 {
			row = items[0]
		}
		return buildMarketSnapshot(stream, map[string]any{
			"exchange":    exchange,
			"symbol":      symbol,
			"lastPrice":   row["lastPrice"],
			"bidPrice":    row["bid1Price"],
			"askPrice":    row["ask1Price"],
			"bidSize":     row["bid1Size"],
			"askSize":     row["ask1Size"],
			"volume":      row["volume24h"],
			"quoteVolume": row["turnover24h"],
			"highPrice":   row["highPrice24h"],
			"lowPrice":    row["lowPrice24h"],
			"eventTime":   root["time"],
		}), nil
	case "okx":
		payload, err := fetchJSONPayload(client, "https://www.okx.com/api/v5/market/ticker?instId="+url.QueryEscape(symbol))
		if err != nil {
			return nil, err
		}
		items := asMapSlice(asMap(payload)["data"])
		row := map[string]any{}
		if len(items) > 0 {
			row = items[0]
		}
		return buildMarketSnapshot(stream, map[string]any{
			"exchange":    exchange,
			"symbol":      symbol,
			"lastPrice":   row["last"],
			"bidPrice":    row["bidPx"],
			"askPrice":    row["askPx"],
			"bidSize":     row["bidSz"],
			"askSize":     row["askSz"],
			"volume":      row["vol24h"],
			"quoteVolume": row["volCcy24h"],
			"highPrice":   row["high24h"],
			"lowPrice":    row["low24h"],
			"eventTime":   row["ts"],
		}), nil
	case "kucoin":
		payload, err := fetchJSONPayload(client, "https://api.kucoin.com/api/ua/v1/market/ticker?tradeType=SPOT&symbol="+url.QueryEscape(symbol))
		if err != nil {
			return nil, err
		}
		items := asMapSlice(asMap(asMap(payload)["data"])["list"])
		row := map[string]any{}
		if len(items) > 0 {
			row = items[0]
		}
		return buildMarketSnapshot(stream, map[string]any{
			"exchange":    exchange,
			"symbol":      symbol,
			"lastPrice":   row["lastPrice"],
			"bidPrice":    row["bestBidPrice"],
			"askPrice":    row["bestAskPrice"],
			"bidSize":     row["bestBidSize"],
			"askSize":     row["bestAskSize"],
			"volume":      row["baseVolume"],
			"quoteVolume": row["quoteVolume"],
			"highPrice":   row["high"],
			"lowPrice":    row["low"],
			"openPrice":   row["open"],
			"eventTime":   row["ts"],
		}), nil
	case "bitget":
		payload, err := fetchJSONPayload(client, "https://api.bitget.com/api/v2/spot/market/tickers?symbol="+url.QueryEscape(symbol))
		if err != nil {
			return nil, err
		}
		items := asMapSlice(asMap(payload)["data"])
		row := map[string]any{}
		if len(items) > 0 {
			row = items[0]
		}
		return buildMarketSnapshot(stream, map[string]any{
			"exchange":    exchange,
			"symbol":      symbol,
			"lastPrice":   row["lastPr"],
			"bidPrice":    row["bidPr"],
			"askPrice":    row["askPr"],
			"bidSize":     row["bidSz"],
			"askSize":     row["askSz"],
			"volume":      row["baseVolume"],
			"quoteVolume": firstNonEmpty(toTrimmedString(row["quoteVolume"]), toTrimmedString(row["usdtVolume"])),
			"highPrice":   row["high24h"],
			"lowPrice":    row["low24h"],
			"openPrice":   row["open"],
			"eventTime":   row["ts"],
		}), nil
	case "gateio":
		payload, err := fetchJSONPayload(client, "https://api.gateio.ws/api/v4/spot/tickers?currency_pair="+url.QueryEscape(symbol))
		if err != nil {
			return nil, err
		}
		rows := asMapSlice(payload)
		row := map[string]any{}
		if len(rows) > 0 {
			row = rows[0]
		}
		return buildMarketSnapshot(stream, map[string]any{
			"exchange":    exchange,
			"symbol":      symbol,
			"lastPrice":   row["last"],
			"bidPrice":    row["highest_bid"],
			"askPrice":    row["lowest_ask"],
			"bidSize":     row["highest_size"],
			"askSize":     row["lowest_size"],
			"volume":      row["base_volume"],
			"quoteVolume": row["quote_volume"],
			"highPrice":   firstNonEmpty(toTrimmedString(row["high_24h"]), toTrimmedString(row["high24h"])),
			"lowPrice":    firstNonEmpty(toTrimmedString(row["low_24h"]), toTrimmedString(row["low24h"])),
			"eventTime":   time.Now().UnixMilli(),
		}), nil
	default:
		return nil, fmt.Errorf("unsupported cex exchange: %s", exchange)
	}
}

func readPolymarketMarketSnapshot(client *http.Client, stream StreamDef) (map[string]any, error) {
	tokenID := strings.TrimSpace(stream.TokenID)
	if tokenID == "" {
		return nil, errors.New("polymarket stream requires tokenId")
	}
	payload, err := fetchJSONPayload(client, "https://clob.polymarket.com/book?token_id="+url.QueryEscape(tokenID))
	if err != nil {
		return nil, err
	}
	row := asMap(payload)
	bestBidPrice, bestBidSize := bestBookLevel(asMapSlice(row["bids"]))
	bestAskPrice, bestAskSize := bestBookLevel(asMapSlice(row["asks"]))
	lastPrice := asFloat(row["last_trade_price"])
	if lastPrice <= 0 {
		lastPrice = midpoint(bestBidPrice, bestAskPrice)
	}
	return buildMarketSnapshot(stream, map[string]any{
		"exchange":  "polymarket",
		"tokenId":   tokenID,
		"marketId":  firstNonEmpty(stream.MarketID, toTrimmedString(row["market"])),
		"lastPrice": lastPrice,
		"bidPrice":  bestBidPrice,
		"askPrice":  bestAskPrice,
		"bidSize":   bestBidSize,
		"askSize":   bestAskSize,
		"liquidity": bestBidPrice*bestBidSize + bestAskPrice*bestAskSize,
		"eventTime": row["timestamp"],
	}), nil
}

func fetchJSONPayload(client *http.Client, sourceURL string) (any, error) {
	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, trimSnippet(body, 160))
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}
	return payload, nil
}

func buildMarketSnapshot(stream StreamDef, values map[string]any) map[string]any {
	bidPrice := asFloat(values["bidPrice"])
	askPrice := asFloat(values["askPrice"])
	lastPrice := asFloat(values["lastPrice"])
	if lastPrice <= 0 {
		lastPrice = midpoint(bidPrice, askPrice)
	}
	out := map[string]any{
		"t_ms":      time.Now().UnixMilli(),
		"stream_id": stream.ID,
		"source":    stream.SourceURL,
		"kind":      firstNonEmpty(stream.Kind, "url"),
		"exchange":  values["exchange"],
	}
	for key, value := range values {
		out[key] = normalizePayloadValue(value)
	}
	out["lastPrice"] = lastPrice
	out["midPrice"] = midpoint(bidPrice, askPrice)
	out["spread"] = spreadValue(bidPrice, askPrice)
	if value := strings.TrimSpace(toTrimmedString(values["exchange"])); value != "" {
		out["exchange"] = value
	}
	if value := strings.TrimSpace(toTrimmedString(values["symbol"])); value != "" {
		out["symbol"] = value
	}
	if value := strings.TrimSpace(toTrimmedString(values["marketId"])); value != "" {
		out["marketId"] = value
	}
	if value := strings.TrimSpace(toTrimmedString(values["tokenId"])); value != "" {
		out["tokenId"] = value
	}
	if out["eventTime"] == nil || out["eventTime"] == "" || out["eventTime"] == 0 {
		out["eventTime"] = out["t_ms"]
	}
	return out
}

func midpoint(bidPrice, askPrice float64) float64 {
	switch {
	case bidPrice > 0 && askPrice > 0:
		return (bidPrice + askPrice) / 2
	case bidPrice > 0:
		return bidPrice
	default:
		return askPrice
	}
}

func spreadValue(bidPrice, askPrice float64) float64 {
	if bidPrice > 0 && askPrice > 0 {
		return askPrice - bidPrice
	}
	return 0
}

func bestBookLevel(levels []map[string]any) (float64, float64) {
	if len(levels) == 0 {
		return 0, 0
	}
	first := levels[0]
	return asFloat(first["price"]), asFloat(first["size"])
}

func normalizeCEXExchange(raw string) string {
	text := strings.ToLower(strings.TrimSpace(raw))
	switch text {
	case "gate", "gate.io":
		return "gateio"
	case "poly-market", "poly_market", "poly market":
		return "polymarket"
	default:
		return text
	}
}

func formatCEXSymbol(exchange, raw string) string {
	base, quote := splitCompactMarketSymbol(raw)
	if base == "" {
		return strings.TrimSpace(raw)
	}
	switch exchange {
	case "okx", "kucoin":
		if quote != "" {
			return base + "-" + quote
		}
	case "gateio":
		if quote != "" {
			return base + "_" + quote
		}
	}
	return base + quote
}

func splitCompactMarketSymbol(raw string) (string, string) {
	compact := strings.ToUpper(strings.TrimSpace(raw))
	replacer := strings.NewReplacer("-", "", "_", "", "/", "", " ", "")
	compact = replacer.Replace(compact)
	if compact == "" {
		return "", ""
	}
	quotes := []string{"USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USD", "BTC", "ETH", "EUR", "KRW"}
	for _, quote := range quotes {
		if len(compact) > len(quote) && strings.HasSuffix(compact, quote) {
			return compact[:len(compact)-len(quote)], quote
		}
	}
	return compact, ""
}

func (e *Engine) watchHTTPStream(stream StreamDef, ctx hersh.HershContext) any {
	varName := "stream_" + stream.ID
	client := httpClientForStream(ctx)
	return hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			prevMap, _ := prev.(map[string]any)
			next, err := readHTTPStreamSnapshot(client, stream)
			if err != nil {
				if len(prevMap) > 0 {
					stale := cloneMap(prevMap)
					stale["t_ms"] = time.Now().UnixMilli()
					stale["fetch_error"] = err.Error()
					return stale, true, nil
				}
				return buildStreamErrorSnapshot(stream, err), true, nil
			}
			return next, true, nil
		}, nil
	}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)
}

func (e *Engine) watchWSStream(stream StreamDef, ctx hersh.HershContext) any {
	wsChan := e.ensureWSChannel(stream, ctx)
	if wsChan == nil {
		return nil
	}
	return hersh.WatchFlow(wsChan, "stream_"+stream.ID, ctx)
}

func (e *Engine) ensureWSChannel(stream StreamDef, ctx hersh.HershContext) <-chan any {
	value := hersh.Memo(func() any {
		out := make(chan any, 8)
		go startWSReader(stream, out)
		return out
	}, "stream_ws_source_"+stream.ID, ctx)

	switch typed := value.(type) {
	case chan any:
		return typed
	case <-chan any:
		return typed
	default:
		return nil
	}
}

func startWSReader(stream StreamDef, out chan any) {
	reconnectDelay := 2 * time.Second
	for {
		conn, resp, err := websocket.DefaultDialer.Dial(stream.SourceURL, nil)
		if err != nil {
			if resp != nil {
				log.Printf("[STREAM] ws connect failed id=%s status=%s err=%v", stream.ID, resp.Status, err)
			} else {
				log.Printf("[STREAM] ws connect failed id=%s err=%v", stream.ID, err)
			}
			time.Sleep(reconnectDelay)
			continue
		}

		log.Printf("[STREAM] ws connected id=%s source=%s", stream.ID, stream.SourceURL)
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				log.Printf("[STREAM] ws read failed id=%s err=%v", stream.ID, err)
				_ = conn.Close()
				break
			}
			snapshot, err := parseSnapshotFromRaw(stream, payload)
			if err != nil {
				log.Printf("[STREAM] ws payload parse failed id=%s err=%v", stream.ID, err)
				continue
			}
			pushLatest(out, snapshot)
		}

		time.Sleep(reconnectDelay)
	}
}

func pushLatest(out chan any, value any) {
	select {
	case out <- value:
		return
	default:
	}

	select {
	case <-out:
	default:
	}

	select {
	case out <- value:
	default:
	}
}

func readHTTPStreamSnapshot(client *http.Client, stream StreamDef) (map[string]any, error) {
	req, err := http.NewRequest(http.MethodGet, stream.SourceURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 160 {
			snippet = snippet[:160]
		}
		if snippet == "" {
			snippet = http.StatusText(resp.StatusCode)
		}
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, snippet)
	}

	return parseSnapshotFromRaw(stream, body)
}

func readEVMRPCStreamSnapshot(client *http.Client, stream StreamDef, credentials map[string]string) (map[string]any, error) {
	params := map[string]any{
		"evmChain": firstNonEmpty(stream.Chain, "eth-mainnet"),
	}
	if rawURL := strings.TrimSpace(stream.SourceURL); rawURL != "" {
		params["rpcUrl"] = rawURL
	}
	rpcURL, err := resolveEVMRPCURL(params, credentials)
	if err != nil {
		return nil, fmt.Errorf("resolve rpc url: %w", err)
	}

	method := strings.TrimSpace(stream.Method)
	if method == "" {
		method = "eth_blockNumber"
	}
	requestBody := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  parseStreamRPCParams(stream.ParamsJSON),
	}
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("marshal rpc request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, rpcURL, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build rpc request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("rpc request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read rpc response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("rpc status %d: %s", resp.StatusCode, trimSnippet(body, 160))
	}

	var rpcResp map[string]any
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return nil, fmt.Errorf("rpc response parse failed: %w", err)
	}

	if rpcErr, ok := rpcResp["error"].(map[string]any); ok {
		if message := toTrimmedString(rpcErr["message"]); message != "" {
			return nil, errors.New(message)
		}
	}

	result := rpcResp["result"]
	payloadMap := map[string]any{
		"result": result,
		"method": method,
		"chain":  firstNonEmpty(stream.Chain, "eth-mainnet"),
	}
	if resultText := toTrimmedString(result); strings.HasPrefix(resultText, "0x") {
		if parsed, ok := new(big.Int).SetString(strings.TrimPrefix(resultText, "0x"), 16); ok {
			payloadMap["result_dec"] = parsed.String()
		}
	}
	return buildSnapshotFromPayload(stream, payloadMap), nil
}

func parseStreamRPCParams(raw string) []any {
	text := strings.TrimSpace(raw)
	if text == "" {
		return []any{}
	}
	var parsed any
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return []any{}
	}
	if list, ok := parsed.([]any); ok {
		return list
	}
	return []any{parsed}
}

func parseSnapshotFromRaw(stream StreamDef, raw []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return nil, fmt.Errorf("empty payload")
	}

	var payload any
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		if number, numErr := strconvToFloat(text); numErr == nil {
			payload = map[string]any{"value": number}
		} else {
			payload = map[string]any{"value": text}
		}
	}

	return buildSnapshotFromPayload(stream, payload), nil
}

func buildSnapshotFromPayload(stream StreamDef, payload any) map[string]any {
	out := map[string]any{
		"t_ms":      time.Now().UnixMilli(),
		"stream_id": stream.ID,
		"source":    stream.SourceURL,
		"kind":      firstNonEmpty(stream.Kind, "url"),
		"chain":     stream.Chain,
	}
	for _, field := range streamFields(stream) {
		out[field] = extractPayloadField(payload, field)
	}
	return out
}

func streamFields(stream StreamDef) []string {
	if len(stream.Fields) == 0 {
		return []string{"value"}
	}
	out := make([]string, 0, len(stream.Fields))
	for _, field := range stream.Fields {
		text := strings.TrimSpace(field)
		if text != "" {
			out = append(out, text)
		}
	}
	if len(out) == 0 {
		return []string{"value"}
	}
	return out
}

func extractPayloadField(payload any, field string) any {
	if payload == nil {
		return nil
	}

	path := parseFieldPath(field)
	if value, ok := lookupPayloadPath(payload, path); ok {
		return normalizePayloadValue(value)
	}

	if root, ok := payload.(map[string]any); ok {
		if nested, exists := root["data"]; exists {
			if value, ok := lookupPayloadPath(nested, path); ok {
				return normalizePayloadValue(value)
			}
		}
	}

	if strings.TrimSpace(field) == "value" {
		return normalizePayloadValue(payload)
	}
	return nil
}

func parseFieldPath(field string) []string {
	text := strings.TrimSpace(field)
	if text == "" {
		return []string{"value"}
	}
	if strings.Contains(text, "::") {
		parts := strings.Split(text, "::")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if strings.Contains(text, ".") {
		parts := strings.Split(text, ".")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []string{text}
}

func lookupPayloadPath(payload any, path []string) (any, bool) {
	current := payload
	for _, segment := range path {
		part := strings.TrimSpace(segment)
		if part == "" {
			return nil, false
		}
		switch typed := current.(type) {
		case map[string]any:
			next, ok := typed[part]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			indexFloat, err := strconvToFloat(part)
			if err != nil {
				return nil, false
			}
			index := int(indexFloat)
			if float64(index) != indexFloat || index < 0 || index >= len(typed) {
				return nil, false
			}
			current = typed[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func normalizePayloadValue(value any) any {
	switch typed := value.(type) {
	case string:
		text := strings.TrimSpace(typed)
		if number, err := strconvToFloat(text); err == nil {
			return number
		}
		return typed
	default:
		return value
	}
}

func httpClientForStream(ctx hersh.HershContext) *http.Client {
	value := hersh.Memo(func() any {
		return &http.Client{Timeout: 8 * time.Second}
	}, "stream_http_client", ctx)
	if client, ok := value.(*http.Client); ok && client != nil {
		return client
	}
	return &http.Client{Timeout: 8 * time.Second}
}

func isHTTPSourceURL(raw string) bool {
	lower := strings.ToLower(strings.TrimSpace(raw))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func isWSSourceURL(raw string) bool {
	lower := strings.ToLower(strings.TrimSpace(raw))
	return strings.HasPrefix(lower, "ws://") || strings.HasPrefix(lower, "wss://")
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func evalCondition(condition string, streams map[string]map[string]any, normals map[string]any) bool {
	text := strings.TrimSpace(condition)
	if text == "" {
		return false
	}
	text = strings.ReplaceAll(text, "&&", " and ")
	text = strings.ReplaceAll(text, "||", " or ")

	orParts := splitOnKeyword(text, "or")
	for _, orPart := range orParts {
		andParts := splitOnKeyword(orPart, "and")
		allTrue := true
		for _, clause := range andParts {
			if !evalClause(clause, streams, normals) {
				allTrue = false
				break
			}
		}
		if allTrue {
			return true
		}
	}
	return false
}

func evalClause(clause string, streams map[string]map[string]any, normals map[string]any) bool {
	c := strings.TrimSpace(clause)
	if c == "" {
		return false
	}
	for _, op := range []string{">=", "<=", "==", "!=", ">", "<"} {
		idx := strings.Index(c, op)
		if idx == -1 {
			continue
		}
		left := resolveValue(strings.TrimSpace(c[:idx]), streams, normals)
		right := resolveValue(strings.TrimSpace(c[idx+len(op):]), streams, normals)
		return compare(left, right, op)
	}
	return toBool(resolveValue(c, streams, normals))
}

func resolveValue(token string, streams map[string]map[string]any, normals map[string]any) any {
	if token == "" {
		return nil
	}
	if token == "true" {
		return true
	}
	if token == "false" {
		return false
	}
	if strings.HasPrefix(token, "\"") && strings.HasSuffix(token, "\"") {
		return strings.Trim(token, "\"")
	}
	if number, err := strconvToFloat(token); err == nil {
		return number
	}
	if strings.Contains(token, "::") {
		parts := strings.SplitN(token, "::", 2)
		if len(parts) == 2 {
			if stream, ok := streams[parts[0]]; ok {
				return stream[parts[1]]
			}
		}
	}
	if val, ok := normals[token]; ok {
		return val
	}
	return token
}

func compare(left any, right any, op string) bool {
	lf, lok := toFloat(left)
	rf, rok := toFloat(right)
	if lok && rok {
		switch op {
		case ">=":
			return lf >= rf
		case "<=":
			return lf <= rf
		case ">":
			return lf > rf
		case "<":
			return lf < rf
		case "==":
			return lf == rf
		case "!=":
			return lf != rf
		}
	}
	ls := fmt.Sprintf("%v", left)
	rs := fmt.Sprintf("%v", right)
	switch op {
	case "==":
		return ls == rs
	case "!=":
		return ls != rs
	default:
		return false
	}
}

func buildStreamErrorSnapshot(stream StreamDef, err error) map[string]any {
	out := map[string]any{
		"t_ms":      time.Now().UnixMilli(),
		"stream_id": stream.ID,
		"source":    stream.SourceURL,
		"kind":      firstNonEmpty(stream.Kind, "url"),
		"chain":     stream.Chain,
	}
	if err != nil {
		out["fetch_error"] = err.Error()
	}
	return out
}

func splitOnKeyword(input, keyword string) []string {
	parts := strings.Split(strings.ToLower(input), " "+keyword+" ")
	if len(parts) <= 1 {
		return []string{input}
	}
	actual := make([]string, 0, len(parts))
	cursor := input
	for range parts {
		idx := strings.Index(strings.ToLower(cursor), " "+keyword+" ")
		if idx < 0 {
			actual = append(actual, strings.TrimSpace(cursor))
			break
		}
		actual = append(actual, strings.TrimSpace(cursor[:idx]))
		cursor = cursor[idx+len(keyword)+2:]
	}
	return actual
}

func asMap(value any) map[string]any {
	if out, ok := value.(map[string]any); ok {
		return out
	}
	return map[string]any{}
}

func asMapSlice(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func asStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text := asString(item)
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func asFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		f, _ := strconvToFloat(v)
		return f
	default:
		return 0
	}
}

func asBoolMap(value any) map[string]bool {
	out := map[string]bool{}
	mapped, ok := value.(map[string]any)
	if !ok {
		return out
	}
	for key, val := range mapped {
		out[key] = toBool(val)
	}
	return out
}

func asInt64Map(value any) map[string]int64 {
	out := map[string]int64{}
	mapped, ok := value.(map[string]any)
	if !ok {
		return out
	}
	for key, val := range mapped {
		out[key] = int64(asFloat(val))
	}
	return out
}

func asEventSlice(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func toFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		f, err := strconvToFloat(v)
		if err == nil {
			return f, true
		}
	}
	return 0, false
}

func strconvToFloat(text string) (float64, error) {
	var value float64
	_, err := fmt.Sscanf(strings.TrimSpace(text), "%f", &value)
	if err != nil {
		return 0, err
	}
	return value, nil
}

func toBool(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		lower := strings.ToLower(strings.TrimSpace(v))
		return lower == "true" || lower == "1" || lower == "yes"
	case float64:
		return v != 0
	case int:
		return v != 0
	default:
		return value != nil
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

`;

const RUNNER_DOCKERFILE = `FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git ca-certificates
WORKDIR /build

COPY go.mod go.sum ./
COPY main.go ./

RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o strategy-runner .

FROM alpine:latest

RUN apk add --no-cache ca-certificates
WORKDIR /app

COPY --from=builder /build/strategy-runner /app/
COPY strategy.json /app/

EXPOSE 8080
CMD ["/app/strategy-runner", "--strategy", "/app/strategy.json"]
`;

const sanitizeUserId = (value) => (
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
);

const toStrategyObject = (strategyInput) => {
  if (strategyInput && typeof strategyInput === 'object') {
    return JSON.parse(JSON.stringify(strategyInput));
  }
  if (typeof strategyInput === 'string') {
    return JSON.parse(strategyInput);
  }
  throw new Error('strategy payload is required');
};

const buildRuntimeAuth = (actionAuth = {}) => (
  Object.entries(actionAuth).reduce((acc, [providerId, raw]) => {
    const authenticated = Boolean(raw?.authenticated);
    const credentials = Object.entries(raw?.credentials || {}).reduce((credAcc, [key, value]) => {
      if (typeof value !== 'string') {
        return credAcc;
      }
      const sanitized = value.trim();
      if (sanitized) {
        credAcc[key] = sanitized;
      }
      return credAcc;
    }, {});

    if (authenticated && Object.keys(credentials).length > 0) {
      acc[providerId] = {
        authenticated: true,
        verifiedAt: raw?.verifiedAt || null,
        credentials
      };
    }
    return acc;
  }, {})
);

const buildRuntimeStrategyJson = (strategyInput, actionAuth = {}) => {
  const strategy = toStrategyObject(strategyInput);
  const runtimeAuth = buildRuntimeAuth(actionAuth);

  strategy.runtime = {
    ...(strategy.runtime || {}),
    auth: runtimeAuth
  };

  return JSON.stringify(strategy, null, 2);
};

export const buildStrategyRunnerPayload = (strategyInput, options = {}) => {
  const now = Date.now();
  const userHint = sanitizeUserId(options.userHint || '');
  const userId = userHint ? `ui-${userHint}-${now}` : `ui-${now}`;
  const runtimeStrategyJson = buildRuntimeStrategyJson(strategyInput, options.actionAuth);

  return {
    user_id: userId,
    dockerfile: RUNNER_DOCKERFILE,
    src_files: {
      'main.go': RUNNER_MAIN_GO,
      'go.mod': RUNNER_GO_MOD,
      'go.sum': RUNNER_GO_SUM,
      'strategy.json': runtimeStrategyJson
    }
  };
};
