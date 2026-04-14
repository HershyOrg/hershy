package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"math/big"
	"math/rand"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/manager"
	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/cex"
	cctxdebug "github.com/HershyOrg/hershy/cctx/debug"
	"github.com/HershyOrg/hershy/cctx/diagnostics"
	"github.com/HershyOrg/hershy/cctx/models"
	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

const (
	strategyRunnerVenue    = "strategy-runner"
	strategyRunnerDebugKey = "strategy-runner"
)

var (
	errDEXMissingCredentials    = errors.New("evm eoaPrivateKey required")
	errDEXMissingRPCURL         = errors.New("evm rpc url required")
	errDEXUnsupportedTransport  = errors.New("unsupported evm transport")
	errDEXMissingCastBinary     = errors.New("foundry cast binary not found")
	errDEXMissingContract       = errors.New("evm contractAddress is invalid")
	errDEXMissingCalldataOrABI  = errors.New("evm calldata or contract ABI is required")
	errDEXMissingFunctionTarget = errors.New("evm function name or signature is required")
)

type StreamDef struct {
	ID         string
	Name       string
	Fields     []string
	IntervalMs int
	SourceURL  string
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

type MonitorDef struct {
	ID       string
	Name     string
	Fields   []string
	StreamID string
}

type RuntimeProviderAuth struct {
	Authenticated bool
	Credentials   map[string]string
}

type ActionExecution struct {
	Mode       string
	Status     string
	Error      string
	ReasonCode diagnostics.ReasonCode
	Params     map[string]any
	Result     map[string]any
}

type Engine struct {
	strategyName     string
	streams          []StreamDef
	normals          map[string]any
	triggers         []TriggerDef
	actions          map[string]ActionDef
	monitors         []MonitorDef
	triggerToActions map[string][]string
	actionInputs     map[string][]string
	auth             map[string]RuntimeProviderAuth

	mu          sync.Mutex
	runID       cctxdebug.RunID
	decisionSeq int64
	recorder    *cctxdebug.Recorder
}

func main() {
	strategyPath := flag.String("strategy", "/app/strategy.json", "Strategy JSON file path")
	debugEventsPath := flag.String("debug-events-path", defaultDebugEventsPath(), "Structured debug timeline path (.json for state, .jsonl for legacy stream)")
	flag.Parse()

	engine, err := LoadEngine(*strategyPath)
	if err != nil {
		log.Fatalf("[BOOT] failed to load strategy: %v", err)
	}
	engine.SetRecorder(openDebugRecorder(*debugEventsPath, engine.strategyName))

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute

	watcher := hersh.NewWatcher(config, map[string]string{"RUNNER": "strategy-runner"}, context.Background())
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return engine.Run(msg, ctx)
	}, "StrategyRunner").Cleanup(func(ctx hersh.HershContext) {
		engine.Close()
	})

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

func defaultDebugEventsPath() string {
	if info, err := os.Stat("/state"); err == nil && info.IsDir() {
		return "/state/debug/timeline.json"
	}
	return "state/debug/timeline.json"
}

func openDebugRecorder(path, strategyName string) *cctxdebug.Recorder {
	recorder, err := cctxdebug.OpenRecorder(path, firstNonEmpty(strategyName, strategyRunnerDebugKey), cctxdebug.WithDefaultVenue(strategyRunnerVenue))
	if err != nil {
		log.Printf("[DEBUG] recorder init failed path=%s: %v", path, err)
		return cctxdebug.NewNoopRecorder(firstNonEmpty(strategyName, strategyRunnerDebugKey), cctxdebug.WithDefaultVenue(strategyRunnerVenue))
	}
	return recorder
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
		runID:            cctxdebug.RunID(fmt.Sprintf("run-%d", time.Now().UnixNano())),
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
		case "monitoring":
			engine.monitors = append(engine.monitors, MonitorDef{
				ID:       id,
				Name:     firstNonEmpty(asString(cfg["name"]), id),
				Fields:   asStringSlice(cfg["fields"]),
				StreamID: asString(cfg["connectedStreamId"]),
			})
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
		if kind == "stream-monitor" {
			for i := range engine.monitors {
				if engine.monitors[i].ID == toID {
					engine.monitors[i].StreamID = fromID
				}
			}
		}
	}

	if len(engine.streams) == 0 {
		return nil, fmt.Errorf("strategy has no streaming blocks")
	}

	return engine, nil
}

func (e *Engine) SetRecorder(recorder *cctxdebug.Recorder) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.recorder = recorder
}

func (e *Engine) Close() {
	e.mu.Lock()
	recorder := e.recorder
	e.recorder = nil
	e.mu.Unlock()

	if recorder != nil {
		_ = recorder.Close()
	}
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
		varName := "stream_" + stream.ID
		val := hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
			return func(prev any) (any, bool, error) {
				prevMap, _ := prev.(map[string]any)
				next := generateStreamSnapshot(stream, prevMap)
				return next, true, nil
			}, nil
		}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)

		if item, ok := val.(map[string]any); ok {
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
			inputs := e.collectActionInputs(actionID, streamValues)
			params := e.resolveActionParams(action, inputs)
			runID, decisionID := e.nextDecisionContext()
			e.emitActionAttempt(runID, decisionID, triggerID, action, inputs, params)
			exec := e.executeAction(action, params)

			event := map[string]any{
				"t_ms":        nowMs,
				"run_id":      string(runID),
				"decision_id": string(decisionID),
				"trigger_id":  triggerID,
				"action_id":   actionID,
				"action_name": action.Name,
				"action_type": action.Kind,
				"mode":        exec.Mode,
				"status":      exec.Status,
				"inputs":      cloneMap(inputs),
				"params":      cloneMap(exec.Params),
				"result":      cloneMap(exec.Result),
			}
			if exec.ReasonCode != "" {
				event["reason_code"] = exec.ReasonCode.String()
			}
			if exec.Error != "" {
				event["error"] = exec.Error
			}

			actionEvents = append(actionEvents, event)
			if len(actionEvents) > 100 {
				actionEvents = actionEvents[len(actionEvents)-100:]
			}
			ctx.SetValue("last_action", event)
			e.emitActionResult(runID, decisionID, triggerID, action, inputs, exec)

			if exec.Error != "" {
				log.Printf("[ACTION] trigger=%s action=%s type=%s mode=%s status=%s err=%s", triggerID, action.Name, action.Kind, exec.Mode, exec.Status, exec.Error)
			} else {
				log.Printf("[ACTION] trigger=%s action=%s type=%s mode=%s status=%s", triggerID, action.Name, action.Kind, exec.Mode, exec.Status)
			}
		}
	}
	ctx.SetValue("action_events", actionEvents)

	for _, monitor := range e.monitors {
		if monitor.StreamID == "" {
			continue
		}
		snapshot, exists := streamValues[monitor.StreamID]
		if !exists {
			continue
		}
		monitorValue := map[string]any{"t_ms": nowMs}
		for _, field := range monitor.Fields {
			monitorValue[field] = snapshot[field]
		}
		if len(monitor.Fields) == 0 {
			for key, value := range snapshot {
				monitorValue[key] = value
			}
		}
		ctx.SetValue("monitor_"+monitor.ID, monitorValue)
	}

	ctx.SetValue("runner_state", map[string]any{
		"t_ms":             nowMs,
		"streams_ready":    len(streamValues),
		"triggers_fired":   len(triggerFire),
		"action_event_cnt": len(actionEvents),
	})

	return nil
}

func (e *Engine) collectActionInputs(actionID string, streamValues map[string]map[string]any) map[string]any {
	inputs := map[string]any{}
	for _, sourceID := range e.actionInputs[actionID] {
		if value, exists := streamValues[sourceID]; exists {
			inputs[sourceID] = cloneMap(value)
			continue
		}
		if value, exists := e.normals[sourceID]; exists {
			inputs[sourceID] = value
		}
	}
	return inputs
}

func (e *Engine) executeAction(action ActionDef, params map[string]any) ActionExecution {
	exec := ActionExecution{
		Mode:   "paper",
		Status: "skipped",
		Params: cloneMap(params),
		Result: map[string]any{},
	}

	switch strings.ToLower(strings.TrimSpace(action.Kind)) {
	case "cex":
		exchange := strings.ToLower(asString(action.Config["exchange"]))
		if exchange != "binance" {
			exec.Error = fmt.Sprintf("live execution not supported for exchange=%s", exchange)
			exec.ReasonCode = diagnostics.ReasonCapabilityUnsupportedVenue
			return exec
		}
		credentials, ok := e.authCredentials("binance")
		if !ok {
			exec.Error = "missing Binance pre-auth credentials"
			exec.ReasonCode = diagnostics.ReasonConfigMissingCredentials
			return exec
		}
		exec.Mode = "live"
		result, err := placeBinanceSpotOrder(params, credentials)
		if err != nil {
			exec.Status = "failed"
			exec.Error = err.Error()
			exec.ReasonCode = reasonCodeForActionError(err)
			return exec
		}
		exec.Status = "submitted"
		exec.Result = result
		return exec
	case "dex":
		protocol := strings.ToLower(asString(action.Config["dexProtocol"]))
		if protocol != "evm" && protocol != "evm-contract" {
			exec.Error = fmt.Sprintf("live execution not supported for dexProtocol=%s", protocol)
			exec.ReasonCode = diagnostics.ReasonCapabilityUnsupportedVenue
			return exec
		}
		credentials, ok := e.authCredentials("evm")
		if !ok {
			exec.Error = "missing EVM pre-auth credentials"
			exec.ReasonCode = diagnostics.ReasonConfigMissingCredentials
			return exec
		}
		exec.Mode = "live"
		result, err := executeEVMDEXAction(params, credentials)
		if err != nil {
			exec.Status = "failed"
			exec.Error = err.Error()
			exec.ReasonCode = reasonCodeForDEXError(err)
			return exec
		}
		exec.Status = "submitted"
		exec.Result = result
		return exec
	default:
		exec.Error = fmt.Sprintf("unsupported action kind: %s", action.Kind)
		exec.ReasonCode = diagnostics.ReasonCapabilityUnsupportedVenue
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
	if value := asString(action.Config["rpcUrl"]); value != "" {
		params["rpcUrl"] = value
	}
	if value := asString(action.Config["apiBaseUrl"]); value != "" {
		params["apiBaseUrl"] = value
	}
	if value := asString(action.Config["baseUrl"]); value != "" {
		params["baseUrl"] = value
	}
	if value := asString(action.Config["evmValue"]); value != "" {
		params["value"] = value
	}
	return params
}

func (e *Engine) nextDecisionContext() (cctxdebug.RunID, cctxdebug.DecisionID) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.decisionSeq++
	return e.runID, cctxdebug.DecisionID(fmt.Sprintf("%s-d%06d", e.runID, e.decisionSeq))
}

func (e *Engine) emitActionAttempt(runID cctxdebug.RunID, decisionID cctxdebug.DecisionID, triggerID string, action ActionDef, inputs, params map[string]any) {
	tags := map[string]string{
		"trigger_id":  triggerID,
		"action_id":   action.ID,
		"action_name": action.Name,
		"action_type": action.Kind,
	}
	venue := strings.ToLower(firstNonEmpty(asString(action.Config["exchange"]), strategyRunnerVenue))
	marketID := strings.ToUpper(firstNonEmpty(asString(params["symbol"]), asString(params["market_id"])))
	e.emitDebugEvent(runID, decisionID, cctxdebug.EventOrderAction, venue, marketID, "", "attempt_submit", cloneMap(inputs), cloneMap(params), nil, tags)
}

func (e *Engine) emitActionResult(runID cctxdebug.RunID, decisionID cctxdebug.DecisionID, triggerID string, action ActionDef, inputs map[string]any, exec ActionExecution) {
	tags := map[string]string{
		"trigger_id":  triggerID,
		"action_id":   action.ID,
		"action_name": action.Name,
		"action_type": action.Kind,
		"mode":        exec.Mode,
		"status":      exec.Status,
	}
	venue := strings.ToLower(firstNonEmpty(asString(action.Config["exchange"]), strategyRunnerVenue))
	marketID := strings.ToUpper(firstNonEmpty(asString(exec.Params["symbol"]), asString(exec.Params["market_id"])))
	outcome := cloneMap(exec.Result)
	if exec.Error != "" {
		outcome["error"] = exec.Error
	}

	switch exec.Status {
	case "submitted":
		e.emitDebugEvent(runID, decisionID, cctxdebug.EventOrderAction, venue, marketID, "", "submitted", nil, nil, outcome, tags)
	case "failed":
		e.emitDebugEvent(runID, decisionID, cctxdebug.EventAnomaly, venue, marketID, exec.ReasonCode.String(), "submission_failed", nil, nil, outcome, tags)
	default:
		e.emitDebugEvent(runID, decisionID, cctxdebug.EventEntryEval, venue, marketID, exec.ReasonCode.String(), "blocked", nil, nil, outcome, tags)
	}
}

func (e *Engine) emitDebugEvent(runID cctxdebug.RunID, decisionID cctxdebug.DecisionID, eventType cctxdebug.EventType, venue, marketID, reasonCode, decision string, inputs, derived, outcome map[string]any, tags map[string]string) {
	e.mu.Lock()
	recorder := e.recorder
	e.mu.Unlock()

	if recorder == nil {
		return
	}
	decisionIDValue := decisionID
	_ = recorder.Emit(eventType, cctxdebug.EmitParams{
		RunID:      runID,
		DecisionID: &decisionIDValue,
		MarketID:   marketID,
		Venue:      venue,
		ReasonCode: reasonCode,
		Decision:   decision,
		Inputs:     inputs,
		Derived:    derived,
		Outcome:    outcome,
		Tags:       tags,
	})
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
	text := strings.TrimSpace(clause)
	if text == "" {
		return false
	}
	for _, op := range []string{">=", "<=", "==", "!=", ">", "<"} {
		idx := strings.Index(text, op)
		if idx == -1 {
			continue
		}
		left := resolveValue(strings.TrimSpace(text[:idx]), streams, normals)
		right := resolveValue(strings.TrimSpace(text[idx+len(op):]), streams, normals)
		return compare(left, right, op)
	}
	return toBool(resolveValue(text, streams, normals))
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
	if value, ok := toFloat(prev); ok {
		jitter := (rand.Float64() - 0.5) * math.Max(0.1, math.Abs(value)*0.002)
		return round(value+jitter, 6)
	}
	baseValue := 100.0 + math.Sin(float64(now)/10000.0)*5.0 + rand.Float64()
	if strings.Contains(name, "price") || strings.Contains(name, "last") {
		baseValue = 65000 + math.Sin(float64(now)/60000.0)*100 + rand.Float64()*5
	}
	return round(baseValue, 6)
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
		return normalizePayloadValue(trimmed), true
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
		return normalizePayloadValue(value), true
	}
	if mapped, ok := raw.(map[string]any); ok {
		if value, exists := mapped[field]; exists {
			return normalizePayloadValue(value), true
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
			text := asString(val)
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
		return nil, base.AuthenticationError{Message: "binance apiKey/hmacSecret required"}
	}

	symbol := strings.ToUpper(asString(params["symbol"]))
	if symbol == "" {
		return nil, base.InvalidOrder{Message: "binance action requires symbol"}
	}

	side := models.OrderSideBuy
	if strings.EqualFold(asString(params["side"]), "sell") {
		side = models.OrderSideSell
	}

	config := map[string]any{
		"api_key":    apiKey,
		"api_secret": hmacSecret,
	}
	if baseURL := firstNonEmpty(asString(params["apiBaseUrl"]), asString(params["baseUrl"])); baseURL != "" {
		config["base_url"] = baseURL
	}
	raw, err := cex.NewBinance(config)
	if err != nil {
		return nil, err
	}

	client, ok := raw.(base.Exchange)
	if !ok {
		return nil, fmt.Errorf("unexpected cctx exchange type: %T", raw)
	}

	price := asFloat(params["price"])
	size := asFloat(params["quantity"])
	extra := map[string]any{
		"type":          firstNonEmpty(asString(params["type"]), "MARKET"),
		"timeInForce":   asString(params["timeInForce"]),
		"quoteOrderQty": asFloat(params["quoteOrderQty"]),
		"recv_window":   asFloat(params["recvWindow"]),
	}
	if clientOrderID := asString(params["newClientOrderId"]); clientOrderID != "" {
		extra["newClientOrderId"] = clientOrderID
	}

	order, err := client.CreateOrder(symbol, "", side, price, size, extra)
	if err != nil {
		return nil, err
	}

	result := map[string]any{
		"order_id":   order.ID,
		"market_id":  order.MarketID,
		"status":     string(order.Status),
		"side":       string(order.Side),
		"price":      order.Price,
		"size":       order.Size,
		"filled":     order.Filled,
		"created_at": order.CreatedAt.UnixMilli(),
	}
	if order.UpdatedAt != nil {
		result["updated_at"] = order.UpdatedAt.UnixMilli()
	}
	return result, nil
}

func reasonCodeForActionError(err error) diagnostics.ReasonCode {
	var authErr base.AuthenticationError
	var invalidErr base.InvalidOrder
	var exchangeErr base.ExchangeError
	var rateErr base.RateLimitError

	switch {
	case errors.As(err, &authErr):
		return diagnostics.ReasonVenueAuthenticationError
	case errors.As(err, &invalidErr):
		return diagnostics.ReasonConfigInvalidParams
	case errors.As(err, &rateErr):
		return diagnostics.ReasonVenueUnavailable
	case errors.As(err, &exchangeErr):
		return diagnostics.ReasonExecutionOrderRejected
	default:
		return diagnostics.ReasonVenueUnavailable
	}
}

func reasonCodeForDEXError(err error) diagnostics.ReasonCode {
	switch {
	case errors.Is(err, errDEXMissingCredentials), errors.Is(err, errDEXMissingRPCURL):
		return diagnostics.ReasonConfigMissingCredentials
	case errors.Is(err, errDEXUnsupportedTransport), errors.Is(err, errDEXMissingContract), errors.Is(err, errDEXMissingCalldataOrABI), errors.Is(err, errDEXMissingFunctionTarget):
		return diagnostics.ReasonConfigInvalidParams
	case errors.Is(err, errDEXMissingCastBinary):
		return diagnostics.ReasonCapabilityUnsupportedVenue
	default:
		return diagnostics.ReasonVenueUnavailable
	}
}

func executeEVMDEXAction(params map[string]any, credentials map[string]string) (map[string]any, error) {
	transport := strings.ToLower(firstNonEmpty(asString(params["evmTransport"]), asString(params["txTransport"]), "foundry"))
	if transport != "foundry" {
		return nil, fmt.Errorf("%w: %s", errDEXUnsupportedTransport, transport)
	}
	return executeEVMDEXActionWithFoundry(params, credentials)
}

func executeEVMDEXActionWithFoundry(params map[string]any, credentials map[string]string) (map[string]any, error) {
	privateKeyHex := strings.TrimSpace(credentials["eoaPrivateKey"])
	if privateKeyHex == "" {
		return nil, errDEXMissingCredentials
	}
	if _, err := exec.LookPath("cast"); err != nil {
		return nil, errDEXMissingCastBinary
	}

	rpcURL, err := resolveEVMRPCURL(params, credentials)
	if err != nil {
		return nil, err
	}

	contractAddressRaw := firstNonEmpty(asString(params["contractAddress"]), asString(params["to"]))
	if !common.IsHexAddress(contractAddressRaw) {
		return nil, errDEXMissingContract
	}
	contractAddress := common.HexToAddress(contractAddressRaw)

	callData, method, functionName, stateMutability, err := resolveEVMCallData(params)
	if err != nil {
		return nil, err
	}
	callDataHex := fmt.Sprintf("0x%x", callData)
	valueText := strings.TrimSpace(asString(params["value"]))
	chain := firstNonEmpty(asString(params["evmChain"]), "custom")
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

	txHash, err := runCastSend(ctx, rpcURL, privateKeyHex, contractAddress.Hex(), callDataHex, valueText, params)
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
		"value":            valueText,
	}, nil
}

func resolveEVMCallData(params map[string]any) ([]byte, *ethabi.Method, string, string, error) {
	rawData := firstNonEmpty(asString(params["evmCalldata"]), asString(params["calldata"]), asString(params["data"]))
	if rawData != "" {
		decoded, err := decodeEVMHexData(rawData)
		if err != nil {
			return nil, nil, "", "", fmt.Errorf("invalid evm calldata: %w", err)
		}
		functionName := firstNonEmpty(asString(params["evmFunctionName"]), "raw_calldata")
		stateMutability := firstNonEmpty(asString(params["evmFunctionStateMutability"]), "nonpayable")
		return decoded, nil, functionName, stateMutability, nil
	}

	abiText := strings.TrimSpace(asString(params["contractAbi"]))
	if abiText == "" {
		return nil, nil, "", "", errDEXMissingCalldataOrABI
	}
	parsedABI, err := ethabi.JSON(strings.NewReader(abiText))
	if err != nil {
		return nil, nil, "", "", fmt.Errorf("evm abi parse failed: %w", err)
	}

	functionName := strings.TrimSpace(firstNonEmpty(asString(params["evmFunctionName"]), asString(params["functionName"])))
	functionSignature := strings.TrimSpace(firstNonEmpty(asString(params["evmFunctionSignature"]), asString(params["functionSignature"])))
	if functionName == "" {
		functionName = parseFunctionNameFromSignature(functionSignature)
	}
	if functionName == "" && functionSignature == "" {
		return nil, nil, "", "", errDEXMissingFunctionTarget
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

func runCastCall(ctx context.Context, rpcURL, to, calldataHex string) (string, error) {
	args := []string{
		"call",
		to,
		"--data", calldataHex,
		"--rpc-url", rpcURL,
	}
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
	if gasLimit := strings.TrimSpace(asString(params["gasLimit"])); gasLimit != "" {
		args = append(args, "--gas-limit", gasLimit)
	}
	if gasPrice := normalizeFoundryGwei(asString(params["maxFeeGwei"])); gasPrice != "" {
		args = append(args, "--gas-price", gasPrice)
	}
	if priorityFee := normalizeFoundryGwei(asString(params["maxPriorityFeeGwei"])); priorityFee != "" {
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

func resolveEVMRPCURL(params map[string]any, credentials map[string]string) (string, error) {
	chain := firstNonEmpty(asString(params["evmChain"]), "eth-mainnet")
	rpcURL := firstNonEmpty(
		asString(params["rpcUrl"]),
		resolveChainSpecificRPCURL(chain, credentials),
		asString(params["apiUrl"]),
	)
	if rpcURL != "" {
		return rpcURL, nil
	}

	alchemyKey := strings.TrimSpace(credentials["alchemyApiKey"])
	if alchemyKey == "" {
		return "", errDEXMissingRPCURL
	}
	alchemyChain := normalizeAlchemyChainSlug(chain)
	if alchemyChain == "" {
		return "", errDEXMissingRPCURL
	}
	return fmt.Sprintf("https://%s.g.alchemy.com/v2/%s", alchemyChain, alchemyKey), nil
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

func normalizeAlchemyChainSlug(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "eth-mainnet", "ethereum":
		return "eth-mainnet"
	case "base-mainnet", "base":
		return "base-mainnet"
	case "arb-mainnet", "arbitrum":
		return "arb-mainnet"
	case "opt-mainnet", "optimism":
		return "opt-mainnet"
	case "polygon-mainnet", "polygon":
		return "polygon-mainnet"
	case "bsc-mainnet", "bsc":
		return "bsc-mainnet"
	default:
		return ""
	}
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
		candidate := strings.TrimSpace(strings.Trim(field, `"'`))
		if len(candidate) != expectedLen || !strings.HasPrefix(candidate, "0x") {
			continue
		}
		if _, err := hex.DecodeString(candidate[2:]); err == nil {
			return candidate
		}
	}
	return ""
}

func decodeEVMHexData(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "0x")
	trimmed = strings.TrimPrefix(trimmed, "0X")
	if trimmed == "" {
		return []byte{}, nil
	}
	return hex.DecodeString(trimmed)
}

func decodeEVMCallOutput(rawOutput string, method *ethabi.Method) (map[string]any, bool) {
	if method == nil {
		return nil, false
	}
	decodedBytes, err := decodeEVMHexData(rawOutput)
	if err != nil {
		return nil, false
	}
	values, err := method.Outputs.Unpack(decodedBytes)
	if err != nil {
		return nil, false
	}
	return formatEVMOutputs(*method, values), true
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
		for _, method := range parsedABI.Methods {
			if strings.EqualFold(strings.TrimSpace(method.RawName), trimmedName) || strings.EqualFold(strings.TrimSpace(method.Name), trimmedName) {
				return method, nil
			}
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
		text := asString(raw)
		if !common.IsHexAddress(text) {
			return nil, errors.New("invalid address")
		}
		return common.HexToAddress(text), nil
	case ethabi.StringTy:
		return asString(raw), nil
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
	text := asString(raw)
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
	text := asString(raw)
	if text == "" {
		return []byte{}, nil
	}
	if strings.HasPrefix(text, "0x") || strings.HasPrefix(text, "0X") {
		return decodeEVMHexData(text)
	}
	return []byte(text), nil
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

func asMap(value any) map[string]any {
	if out, ok := value.(map[string]any); ok {
		return out
	}
	return map[string]any{}
}

func asMapSlice(value any) []map[string]any {
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if mapped, ok := item.(map[string]any); ok {
				out = append(out, mapped)
			}
		}
		return out
	default:
		return nil
	}
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
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func asFloat(value any) float64 {
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
		f, _ := strconvToFloat(typed)
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
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if mapped, ok := item.(map[string]any); ok {
				out = append(out, mapped)
			}
		}
		return out
	default:
		return nil
	}
}

func toFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case string:
		f, err := strconvToFloat(typed)
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
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		lower := strings.ToLower(strings.TrimSpace(typed))
		return lower == "true" || lower == "1" || lower == "yes"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return value != nil
	}
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
