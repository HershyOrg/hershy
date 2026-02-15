const RUNNER_GO_MOD = `module strategy-runner

go 1.24.13

require github.com/HershyOrg/hersh v0.2.0
`;

const RUNNER_GO_SUM = `github.com/HershyOrg/hersh v0.2.0 h1:5iPfdHc+567hp1rVRLECpmuW2WQjCyWleOZoNPhBzIg=
github.com/HershyOrg/hersh v0.2.0/go.mod h1:/oES/OVsTyr7bv63qC0k/YsW6z51/k+j5TBWwSPrib4=
`;

const RUNNER_MAIN_GO = String.raw`package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/manager"
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

type Engine struct {
	strategyName     string
	streams          []StreamDef
	normals          map[string]any
	triggers         []TriggerDef
	actions          map[string]ActionDef
	triggerToActions map[string][]string
	actionInputs     map[string][]string
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

			event := map[string]any{
				"t_ms":        nowMs,
				"trigger_id":  triggerID,
				"action_id":   actionID,
				"action_name": action.Name,
				"action_type": action.Kind,
				"mode":        "paper",
				"inputs":      inputs,
			}
			actionEvents = append(actionEvents, event)
			if len(actionEvents) > 100 {
				actionEvents = actionEvents[len(actionEvents)-100:]
			}
			ctx.SetValue("last_action", event)
			log.Printf("[ACTION] trigger=%s action=%s type=%s", triggerID, action.Name, action.Kind)
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

RUN go mod download
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

export const buildStrategyRunnerPayload = (strategyJson, options = {}) => {
  const now = Date.now();
  const userHint = sanitizeUserId(options.userHint || '');
  const userId = userHint ? `ui-${userHint}-${now}` : `ui-${now}`;

  return {
    user_id: userId,
    dockerfile: RUNNER_DOCKERFILE,
    src_files: {
      'main.go': RUNNER_MAIN_GO,
      'go.mod': RUNNER_GO_MOD,
      'go.sum': RUNNER_GO_SUM,
      'strategy.json': strategyJson
    }
  };
};
