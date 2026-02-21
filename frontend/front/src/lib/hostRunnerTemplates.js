const RUNNER_GO_MOD = `module strategy-runner

go 1.24.13

require (
	github.com/HershyOrg/hersh v0.2.0
	github.com/ethereum/go-ethereum v1.16.8
	github.com/gorilla/websocket v1.5.3
)
`;

const RUNNER_GO_SUM = `github.com/HershyOrg/hersh v0.2.0 h1:5iPfdHc+567hp1rVRLECpmuW2WQjCyWleOZoNPhBzIg=
github.com/HershyOrg/hersh v0.2.0/go.mod h1:/oES/OVsTyr7bv63qC0k/YsW6z51/k+j5TBWwSPrib4=
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
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	mathrand "math/rand"
	"math/big"
	"net/http"
	"net/url"
	"os"
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
		exchange := strings.ToLower(asString(action.Config["exchange"]))
		if exchange != "binance" {
			exec.Error = fmt.Sprintf("live execution not supported for exchange=%s", exchange)
			return exec
		}
		credentials, ok := e.authCredentials("binance")
		if !ok {
			exec.Error = "missing Binance pre-auth credentials"
			return exec
		}
		exec.Mode = "live"
		result, err := placeBinanceSpotOrder(params, credentials)
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
	if value := asString(action.Config["chainId"]); value != "" {
		params["chainId"] = value
	}
	if value := asString(action.Config["apiUrl"]); value != "" {
		params["apiUrl"] = value
	}
	if value := asString(action.Config["rpcUrl"]); value != "" {
		params["rpcUrl"] = value
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

func buildHMACSHA256Hex(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
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

	abiText := strings.TrimSpace(toTrimmedString(params["contractAbi"]))
	if abiText == "" {
		return nil, errors.New("evm contractAbi is required")
	}
	parsedABI, err := ethabi.JSON(strings.NewReader(abiText))
	if err != nil {
		return nil, fmt.Errorf("evm abi parse failed: %w", err)
	}

	functionName := strings.TrimSpace(firstNonEmpty(toTrimmedString(params["evmFunctionName"]), toTrimmedString(params["functionName"])))
	functionSignature := strings.TrimSpace(firstNonEmpty(toTrimmedString(params["evmFunctionSignature"]), toTrimmedString(params["functionSignature"])))
	if functionName == "" {
		functionName = parseFunctionNameFromSignature(functionSignature)
	}
	if functionName == "" && functionSignature == "" {
		return nil, errors.New("evm function name or signature is required")
	}

	method, err := resolveEVMABIMethod(parsedABI, functionName, functionSignature)
	if err != nil {
		return nil, err
	}
	inputArgs, err := buildEVMFunctionArgs(method, params)
	if err != nil {
		return nil, err
	}
	callData, err := parsedABI.Pack(method.Name, inputArgs...)
	if err != nil {
		return nil, fmt.Errorf("evm abi pack failed: %w", err)
	}

	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return nil, fmt.Errorf("evm private key invalid: %w", err)
	}
	fromAddress := crypto.PubkeyToAddress(privateKey.PublicKey)

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	isReadOnly := method.StateMutability == "view" || method.StateMutability == "pure"
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
		decoded, err := method.Outputs.Unpack(outBytes)
		if err != nil {
			return nil, fmt.Errorf("evm call output decode failed: %w", err)
		}
		return map[string]any{
			"mode":             "call",
			"chain":            firstNonEmpty(toTrimmedString(params["evmChain"]), "custom"),
			"rpc_url":          rpcURL,
			"from":             fromAddress.Hex(),
			"to":               contractAddress.Hex(),
			"function":         method.Name,
			"state_mutability": method.StateMutability,
			"outputs":          formatEVMOutputs(method, decoded),
			"raw_output":       fmt.Sprintf("0x%x", outBytes),
		}, nil
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
		"chain":            firstNonEmpty(toTrimmedString(params["evmChain"]), "custom"),
		"rpc_url":          rpcURL,
		"from":             fromAddress.Hex(),
		"to":               contractAddress.Hex(),
		"function":         method.Name,
		"state_mutability": method.StateMutability,
		"tx_hash":          signedTx.Hash().Hex(),
		"nonce":            nonce,
		"gas_limit":        gasLimit,
		"max_fee_per_gas":  feeCap.String(),
		"max_priority_fee": tipCap.String(),
		"value_wei":        valueWei.String(),
	}, nil
}

func resolveEVMRPCURL(params map[string]any, credentials map[string]string) (string, error) {
	rpcURL := firstNonEmpty(
		toTrimmedString(params["rpcUrl"]),
		toTrimmedString(params["apiUrl"]),
		strings.TrimSpace(credentials["rpcUrl"]),
	)
	if rpcURL != "" {
		return rpcURL, nil
	}

	alchemyKey := strings.TrimSpace(credentials["alchemyApiKey"])
	if alchemyKey == "" {
		return "", errors.New("evm rpc url or alchemy api key is required")
	}

	chain := normalizeAlchemyChainSlug(firstNonEmpty(toTrimmedString(params["evmChain"]), "eth-mainnet"))
	if chain == "" {
		return "", errors.New("unsupported evm chain slug")
	}
	return fmt.Sprintf("https://%s.g.alchemy.com/v2/%s", chain, alchemyKey), nil
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
	case isWSSourceURL(sourceURL):
		return e.watchWSStream(stream, ctx)
	case isHTTPSourceURL(sourceURL):
		return e.watchHTTPStream(stream, ctx)
	default:
		return e.watchSyntheticStream(stream, ctx)
	}
}

func isEVMRPCStream(stream StreamDef) bool {
	kind := strings.ToLower(strings.TrimSpace(stream.Kind))
	if kind == "evm-rpc" {
		return true
	}
	return strings.TrimSpace(stream.Chain) != ""
}

func (e *Engine) watchSyntheticStream(stream StreamDef, ctx hersh.HershContext) any {
	varName := "stream_" + stream.ID
	return hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			prevMap, _ := prev.(map[string]any)
			next := generateStreamSnapshot(stream, prevMap)
			return next, true, nil
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
				fallback := generateStreamSnapshot(stream, prevMap)
				fallback["fetch_error"] = err.Error()
				return fallback, true, nil
			}
			return next, true, nil
		}, nil
	}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)
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
				fallback := generateStreamSnapshot(stream, prevMap)
				fallback["fetch_error"] = err.Error()
				return fallback, true, nil
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

func generateStreamSnapshot(stream StreamDef, prev map[string]any) map[string]any {
	now := time.Now().UnixMilli()
	out := map[string]any{
		"t_ms":      now,
		"stream_id": stream.ID,
		"source":    stream.SourceURL,
		"kind":      firstNonEmpty(stream.Kind, "url"),
		"chain":     stream.Chain,
	}
	fields := stream.Fields
	if len(fields) == 0 {
		fields = []string{"value"}
	}
	for _, field := range fields {
		out[field] = nextFieldValue(field, prev[field], now)
	}
	return out
}

func nextFieldValue(field string, prev any, now int64) any {
	name := strings.ToLower(field)
	if strings.Contains(name, "time") || strings.Contains(name, "date") {
		return now
	}
	if strings.Contains(name, "symbol") {
		return "BTCUSDT"
	}
	if v, ok := toFloat(prev); ok {
		jitter := (mathrand.Float64() - 0.5) * math.Max(0.1, math.Abs(v)*0.002)
		return round(v+jitter, 6)
	}
	base := 100.0 + math.Sin(float64(now)/10000.0)*5.0 + mathrand.Float64()
	if strings.Contains(name, "price") || strings.Contains(name, "last") {
		base = 65000 + math.Sin(float64(now)/60000.0)*100 + mathrand.Float64()*5
	}
	return round(base, 6)
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

func round(value float64, places int) float64 {
	factor := math.Pow(10, float64(places))
	return math.Round(value*factor) / factor
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
