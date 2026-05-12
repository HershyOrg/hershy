package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"strings"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/manager"
	"strategy-runner/liveexec"
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

type ConnectionDef struct {
	ID     string
	Kind   string
	FromID string
	ToID   string
}

type Engine struct {
	strategyName       string
	streams            []StreamDef
	normals            map[string]any
	normalConfigs      map[string]map[string]any
	triggers           []TriggerDef
	actions            map[string]ActionDef
	monitors           []MonitorDef
	triggerToActions   map[string][]string
	triggerInputs      map[string][]string
	actionInputs       map[string][]string
	dataInputs         map[string][]string
	actionResultInputs map[string][]string
}

func NewEngine(
	strategyName string,
	streams []StreamDef,
	normalConfigs map[string]map[string]any,
	triggers []TriggerDef,
	actions []ActionDef,
	monitors []MonitorDef,
	connections []ConnectionDef,
) (*Engine, error) {
	engine := newEngineBase(strategyName)
	engine.streams = append(engine.streams, streams...)
	engine.triggers = append(engine.triggers, triggers...)
	engine.monitors = append(engine.monitors, monitors...)

	for id, cfg := range normalConfigs {
		if id == "" {
			continue
		}
		engine.normalConfigs[id] = cfg
		if value, ok := cfg["value"]; ok {
			engine.normals[id] = value
		}
	}

	for _, action := range actions {
		if action.ID == "" {
			continue
		}
		engine.actions[action.ID] = action
	}

	for _, conn := range connections {
		engine.registerConnection(conn.Kind, conn.FromID, conn.ToID)
	}

	if len(engine.streams) == 0 {
		return nil, fmt.Errorf("strategy has no streaming blocks")
	}

	return engine, nil
}

func newEngineBase(strategyName string) *Engine {
	if strings.TrimSpace(strategyName) == "" {
		strategyName = "strategy"
	}
	return &Engine{
		strategyName:       strategyName,
		normals:            map[string]any{},
		normalConfigs:      map[string]map[string]any{},
		actions:            map[string]ActionDef{},
		triggerToActions:   map[string][]string{},
		triggerInputs:      map[string][]string{},
		actionInputs:       map[string][]string{},
		dataInputs:         map[string][]string{},
		actionResultInputs: map[string][]string{},
	}
}

func (e *Engine) registerConnection(kind, fromID, toID string) {
	if kind == "trigger-action" {
		e.triggerToActions[fromID] = append(e.triggerToActions[fromID], toID)
	}
	if kind == "trigger-input" {
		e.triggerInputs[toID] = append(e.triggerInputs[toID], fromID)
	}
	if kind == "action-input" {
		e.actionInputs[toID] = append(e.actionInputs[toID], fromID)
	}
	if kind == "data-flow" {
		e.dataInputs[toID] = append(e.dataInputs[toID], fromID)
	}
	if kind == "action-result" {
		e.actionResultInputs[toID] = append(e.actionResultInputs[toID], fromID)
	}
	if kind == "stream-monitor" {
		for i := range e.monitors {
			if e.monitors[i].ID == toID {
				e.monitors[i].StreamID = fromID
			}
		}
	}
}

func (e *Engine) StrategyName() string {
	return e.strategyName
}

func (e *Engine) StreamCount() int {
	return len(e.streams)
}

func (e *Engine) TriggerCount() int {
	return len(e.triggers)
}

func (e *Engine) ActionCount() int {
	return len(e.actions)
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

	engine := newEngineBase(strategyName)

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
			engine.normalConfigs[id] = cfg
			if value, ok := cfg["value"]; ok {
				engine.normals[id] = value
			}
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
		engine.registerConnection(kind, fromID, toID)
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

	streamValues := map[string]map[string]any{}
	for _, stream := range e.streams {
		varName := "stream_" + stream.ID
		val := hersh.WatchCall(func() (manager.VarUpdateFunc, bool, error) {
			return func(prev hersh.HershValue) (hersh.HershValue, error) {
				prevMap, _ := prev.Value.(map[string]any)
				next := generateStreamSnapshot(stream, prevMap)
				return hersh.HershValue{Value: next, VarName: varName}, nil
			}, false, nil
		}, varName, time.Duration(stream.IntervalMs)*time.Millisecond, ctx)

		if item, ok := val.Value.(map[string]any); ok {
			streamValues[stream.ID] = item
		}
	}

	ctx.SetValue("stream_values", streamValues)
	actionResults := asNestedMap(ctx.GetValue("action_results"))
	normalValues := e.computeNormalValues(streamValues, actionResults)
	ctx.SetValue("normal_values", normalValues)

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
			if fired && strings.TrimSpace(trigger.Condition) != "" {
				fired = evalCondition(trigger.Condition, streamValues, normalValues, actionResults)
			}
		case "condition":
			continue
		default:
			fired = false
		}

		nextCond[trigger.ID] = currentCond
		if fired {
			triggerFire[trigger.ID] = true
		}
	}

	for _, trigger := range e.triggers {
		if trigger.Type != "condition" {
			continue
		}

		gateSources := e.triggerInputs[trigger.ID]
		if len(gateSources) > 0 {
			gated := false
			for _, sourceID := range gateSources {
				if triggerFire[sourceID] {
					gated = true
					break
				}
			}
			if !gated {
				nextCond[trigger.ID] = prevCond[trigger.ID]
				continue
			}
		}

		currentCond := evalCondition(trigger.Condition, streamValues, normalValues, actionResults)
		fired := currentCond && !prevCond[trigger.ID]
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
				if value, exists := normalValues[sourceID]; exists {
					inputs[sourceID] = value
				}
			}

			event := map[string]any{
				"t_ms":        nowMs,
				"trigger_id":  triggerID,
				"action_id":   actionID,
				"action_name": action.Name,
				"action_type": action.Kind,
				"inputs":      inputs,
			}
			result, err := liveexec.ExecuteAction(context.Background(), liveexec.Action{
				ID:     action.ID,
				Name:   action.Name,
				Kind:   action.Kind,
				Config: action.Config,
			}, inputs, nowMs)
			if err != nil {
				result = map[string]any{
					"status":        "REJECTED",
					"error":         err.Error(),
					"timestamp":     nowMs,
					"executionMode": string(liveexec.ResolveMode()),
				}
			}
			event["mode"] = result["executionMode"]
			event["result"] = result
			actionResults[actionID] = result
			actionEvents = append(actionEvents, event)
			if len(actionEvents) > 100 {
				actionEvents = actionEvents[len(actionEvents)-100:]
			}
			ctx.SetValue("last_action", event)
			log.Printf("[ACTION] trigger=%s action=%s type=%s mode=%v status=%v", triggerID, action.Name, action.Kind, event["mode"], result["status"])
		}
	}
	ctx.SetValue("action_events", actionEvents)
	ctx.SetValue("action_results", actionResults)

	for _, monitor := range e.monitors {
		resultSourceIDs := e.actionResultInputs[monitor.ID]
		if monitor.StreamID == "" && len(resultSourceIDs) == 0 {
			continue
		}
		snapshot, exists := streamValues[monitor.StreamID]
		if !exists && len(resultSourceIDs) > 0 {
			snapshot = map[string]any{}
			for _, actionID := range resultSourceIDs {
				if result, ok := actionResults[actionID]; ok {
					for key, value := range result {
						snapshot[actionID+"::"+key] = value
						snapshot[key] = value
					}
				}
			}
			exists = len(snapshot) > 0
		}
		if !exists {
			continue
		}
		monitorValue := map[string]any{"t_ms": nowMs}
		for _, field := range monitor.Fields {
			monitorValue[field] = snapshot[field]
		}
		if len(monitor.Fields) == 0 {
			for k, v := range snapshot {
				monitorValue[k] = v
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

func (e *Engine) computeNormalValues(streamValues map[string]map[string]any, actionResults map[string]map[string]any) map[string]any {
	values := make(map[string]any, len(e.normalConfigs))
	for key, value := range e.normals {
		values[key] = value
	}

	for pass := 0; pass < len(e.normalConfigs)+1; pass++ {
		changed := false
		for id, cfg := range e.normalConfigs {
			expression := firstNonEmpty(asString(cfg["expression"]), asString(cfg["formula"]), asString(cfg["logic"]), asString(cfg["code"]))
			if expression == "" {
				if value, ok := cfg["value"]; ok {
					if values[id] != value {
						values[id] = value
						changed = true
					}
				}
				continue
			}

			value, ok := evalNumericExpression(expression, streamValues, values, actionResults)
			if !ok {
				continue
			}
			if previous, sameType := values[id].(float64); !sameType || previous != value {
				values[id] = value
				changed = true
			}
		}
		if !changed {
			break
		}
	}

	return values
}

func evalCondition(condition string, streams map[string]map[string]any, normals map[string]any, actionResults map[string]map[string]any) bool {
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
			if !evalClause(clause, streams, normals, actionResults) {
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

func evalClause(clause string, streams map[string]map[string]any, normals map[string]any, actionResults map[string]map[string]any) bool {
	c := strings.TrimSpace(clause)
	if c == "" {
		return false
	}
	for _, op := range []string{">=", "<=", "==", "!=", ">", "<"} {
		idx := strings.Index(c, op)
		if idx == -1 {
			continue
		}
		left := resolveValue(strings.TrimSpace(c[:idx]), streams, normals, actionResults)
		right := resolveValue(strings.TrimSpace(c[idx+len(op):]), streams, normals, actionResults)
		return compare(left, right, op)
	}
	return toBool(resolveValue(c, streams, normals, actionResults))
}

func resolveValue(token string, streams map[string]map[string]any, normals map[string]any, actionResults map[string]map[string]any) any {
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
	if strings.HasPrefix(token, "'") && strings.HasSuffix(token, "'") {
		return strings.Trim(token, "'")
	}
	if number, err := strconvToFloat(token); err == nil {
		return number
	}
	if number, ok := evalNumericExpression(token, streams, normals, actionResults); ok {
		return number
	}
	if strings.Contains(token, "::") {
		parts := strings.SplitN(token, "::", 2)
		if len(parts) == 2 {
			if stream, ok := streams[parts[0]]; ok {
				return stream[parts[1]]
			}
			if val, ok := normals[parts[0]]; ok && (parts[1] == "value" || parts[1] == "result" || parts[1] == "output") {
				return val
			}
			if result, ok := actionResults[parts[0]]; ok {
				return result[parts[1]]
			}
		}
	}
	if val, ok := normals[token]; ok {
		return val
	}
	return token
}

type expressionParser struct {
	text          string
	pos           int
	streams       map[string]map[string]any
	normals       map[string]any
	actionResults map[string]map[string]any
}

func evalNumericExpression(expression string, streams map[string]map[string]any, normals map[string]any, actionResults map[string]map[string]any) (float64, bool) {
	parser := &expressionParser{
		text:          strings.TrimSpace(expression),
		streams:       streams,
		normals:       normals,
		actionResults: actionResults,
	}
	if parser.text == "" {
		return 0, false
	}
	value, ok := parser.parseExpression()
	if !ok {
		return 0, false
	}
	parser.skipSpace()
	if parser.pos != len(parser.text) {
		return 0, false
	}
	return value, true
}

func (p *expressionParser) parseExpression() (float64, bool) {
	left, ok := p.parseTerm()
	if !ok {
		return 0, false
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.text) {
			return left, true
		}
		op := p.text[p.pos]
		if op != '+' && op != '-' {
			return left, true
		}
		p.pos++
		right, ok := p.parseTerm()
		if !ok {
			return 0, false
		}
		if op == '+' {
			left += right
		} else {
			left -= right
		}
	}
}

func (p *expressionParser) parseTerm() (float64, bool) {
	left, ok := p.parseFactor()
	if !ok {
		return 0, false
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.text) {
			return left, true
		}
		op := p.text[p.pos]
		if op != '*' && op != '/' {
			return left, true
		}
		p.pos++
		right, ok := p.parseFactor()
		if !ok {
			return 0, false
		}
		if op == '*' {
			left *= right
		} else {
			if right == 0 {
				return 0, false
			}
			left /= right
		}
	}
}

func (p *expressionParser) parseFactor() (float64, bool) {
	p.skipSpace()
	if p.pos >= len(p.text) {
		return 0, false
	}

	if p.text[p.pos] == '-' {
		p.pos++
		value, ok := p.parseFactor()
		return -value, ok
	}

	if p.text[p.pos] == '(' {
		p.pos++
		value, ok := p.parseExpression()
		if !ok {
			return 0, false
		}
		p.skipSpace()
		if p.pos >= len(p.text) || p.text[p.pos] != ')' {
			return 0, false
		}
		p.pos++
		return value, true
	}

	if isNumberStart(p.text[p.pos]) {
		return p.parseNumber()
	}

	return p.parseReference()
}

func (p *expressionParser) parseNumber() (float64, bool) {
	start := p.pos
	for p.pos < len(p.text) {
		ch := p.text[p.pos]
		if (ch < '0' || ch > '9') && ch != '.' {
			break
		}
		p.pos++
	}
	value, err := strconvToFloat(p.text[start:p.pos])
	return value, err == nil
}

func (p *expressionParser) parseReference() (float64, bool) {
	start := p.pos
	for p.pos < len(p.text) {
		ch := p.text[p.pos]
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '+' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
			break
		}
		p.pos++
	}
	if start == p.pos {
		return 0, false
	}

	token := strings.TrimSpace(p.text[start:p.pos])
	if strings.Contains(token, "::") {
		parts := strings.SplitN(token, "::", 2)
		if len(parts) == 2 {
			if stream, ok := p.streams[parts[0]]; ok {
				return toFloat(stream[parts[1]])
			}
			if value, ok := p.normals[parts[0]]; ok && (parts[1] == "value" || parts[1] == "result" || parts[1] == "output") {
				return toFloat(value)
			}
			if result, ok := p.actionResults[parts[0]]; ok {
				return toFloat(result[parts[1]])
			}
		}
	}
	if value, ok := p.normals[token]; ok {
		return toFloat(value)
	}
	return 0, false
}

func (p *expressionParser) skipSpace() {
	for p.pos < len(p.text) {
		ch := p.text[p.pos]
		if ch != ' ' && ch != '\t' && ch != '\n' && ch != '\r' {
			return
		}
		p.pos++
	}
}

func isNumberStart(ch byte) bool {
	return (ch >= '0' && ch <= '9') || ch == '.'
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

func generatePaperActionResult(action ActionDef, inputs map[string]any, nowMs int64) map[string]any {
	status := firstNonEmpty(asString(action.Config["paperStatus"]), asString(action.Config["status"]), "FILLED")
	amount := firstPositiveFloat(
		action.Config["filledQty"],
		action.Config["quantity"],
		action.Config["qty"],
		action.Config["amount"],
		action.Config["size"],
		action.Config["quote"],
		action.Config["notional"],
	)
	if amount == 0 {
		amount = 1
	}
	price := firstPositiveFloat(action.Config["avgFillPrice"], action.Config["price"], findFirstInputPrice(inputs))
	if price == 0 {
		price = round(100+rand.Float64()*10, 4)
	}

	result := map[string]any{
		"status":        status,
		"filledQty":     amount,
		"avgFillPrice":  price,
		"fee":           round(amount*price*0.0004, 8),
		"timestamp":     nowMs,
		"error":         "",
		"executionMode": "paper",
	}

	if strings.Contains(strings.ToLower(action.Kind), "dex") || strings.Contains(strings.ToLower(action.Kind), "swap") {
		result["txHash"] = fmt.Sprintf("paper-tx-%s-%d", action.ID, nowMs)
		result["amountIn"] = amount
		result["amountOut"] = amount
		result["executionPrice"] = price
		result["gasUsed"] = 0
		result["slippage"] = 0
	} else {
		result["orderId"] = fmt.Sprintf("paper-order-%s-%d", action.ID, nowMs)
	}

	return result
}

func findFirstInputPrice(inputs map[string]any) any {
	for _, value := range inputs {
		if mapped, ok := value.(map[string]any); ok {
			for _, key := range []string{"lastPrice", "price", "close", "avgFillPrice", "executionPrice"} {
				if mapped[key] != nil {
					return mapped[key]
				}
			}
		}
	}
	return nil
}

func firstPositiveFloat(values ...any) float64 {
	for _, value := range values {
		number, ok := toFloat(value)
		if ok && number > 0 {
			return number
		}
	}
	return 0
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
		jitter := (rand.Float64() - 0.5) * math.Max(0.1, math.Abs(v)*0.002)
		return round(v+jitter, 6)
	}
	base := 100.0 + math.Sin(float64(now)/10000.0)*5.0 + rand.Float64()
	if strings.Contains(name, "price") || strings.Contains(name, "last") {
		base = 65000 + math.Sin(float64(now)/60000.0)*100 + rand.Float64()*5
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

func asNestedMap(value any) map[string]map[string]any {
	out := map[string]map[string]any{}
	if typed, ok := value.(map[string]map[string]any); ok {
		for key, val := range typed {
			out[key] = val
		}
		return out
	}
	mapped, ok := value.(map[string]any)
	if !ok {
		return out
	}
	for key, val := range mapped {
		if nested, ok := val.(map[string]any); ok {
			out[key] = nested
		}
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
