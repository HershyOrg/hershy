package codegen

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/format"
	"os"
	"sort"
	"strconv"
	"strings"

	"strategy-runner/validator"
)

func GenerateFile(inputPath, outputPath string) error {
	data, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("read strategy json: %w", err)
	}

	var graph validator.StrategyGraph
	if err := json.Unmarshal(data, &graph); err != nil {
		return fmt.Errorf("parse strategy json: %w", err)
	}
	if issues := validator.Validate(graph); len(issues) > 0 {
		return fmt.Errorf("strategy graph is invalid:\n- %s", strings.Join(issues, "\n- "))
	}

	source, err := Generate(graph)
	if err != nil {
		return err
	}
	if err := os.WriteFile(outputPath, source, 0644); err != nil {
		return fmt.Errorf("write generated go source: %w", err)
	}
	return nil
}

func Generate(graph validator.StrategyGraph) ([]byte, error) {
	var b bytes.Buffer
	strategyName := firstNonEmpty(graph.Strategy.Name, "AI Generated Strategy")
	managerName := safeIdent(firstNonEmpty(graph.Strategy.ID, graph.Strategy.Name, "generated_strategy"))

	fmt.Fprintln(&b, "package main")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "import (")
	fmt.Fprintln(&b, strconv.Quote("context"))
	fmt.Fprintln(&b, strconv.Quote("log"))
	fmt.Fprintln(&b, strconv.Quote("os"))
	fmt.Fprintln(&b, strconv.Quote("os/signal"))
	fmt.Fprintln(&b, strconv.Quote("syscall"))
	fmt.Fprintln(&b, strconv.Quote("time"))
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, strconv.Quote("github.com/HershyOrg/hersh"))
	fmt.Fprintln(&b, strconv.Quote("strategy-runner/runner"))
	fmt.Fprintln(&b, ")")
	fmt.Fprintln(&b)
	fmt.Fprintf(&b, "const generatedStrategyName = %q\n\n", strategyName)
	fmt.Fprintf(&b, "const generatedManagerName = %q\n\n", managerName)

	writeBlockInventory(&b, graph.Blocks)
	writeStreams(&b, graph.Blocks)
	writeNormalConfigs(&b, graph.Blocks)
	writeTriggers(&b, graph.Blocks)
	writeActions(&b, graph.Blocks)
	writeMonitors(&b, graph.Blocks)
	writeConnections(&b, graph.Connections)
	writeBuilderAndMain(&b)

	formatted, err := format.Source(b.Bytes())
	if err != nil {
		return nil, fmt.Errorf("format generated source: %w\n%s", err, b.String())
	}
	return formatted, nil
}

func writeBlockInventory(b *bytes.Buffer, blocks []validator.Block) {
	fmt.Fprintln(b, "// generatedBlockInventory keeps the strategy.json block IDs visible in this Go source.")
	fmt.Fprintln(b, "var generatedBlockInventory = []struct {")
	fmt.Fprintln(b, "ID string")
	fmt.Fprintln(b, "Type string")
	fmt.Fprintln(b, "Name string")
	fmt.Fprintln(b, "}{")
	for _, block := range blocks {
		fmt.Fprintf(b, "{ID:%q, Type:%q, Name:%q},\n", block.ID, block.Type, blockName(block))
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeStreams(b *bytes.Buffer, blocks []validator.Block) {
	fmt.Fprintln(b, "var generatedStreams = []runner.StreamDef{")
	for _, block := range blocksByType(blocks, "streaming") {
		cfg := block.Config
		fmt.Fprintf(
			b,
			"{ID:%q, Name:%q, Fields:%s, IntervalMs:%d, SourceURL:%q},\n",
			block.ID,
			blockName(block),
			stringSliceLiteral(asStringSlice(cfg["fields"])),
			int(asFloat(cfg["updateIntervalMs"])),
			asString(cfg["sourceUrl"]),
		)
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeNormalConfigs(b *bytes.Buffer, blocks []validator.Block) {
	fmt.Fprintln(b, "var generatedNormalConfigs = map[string]map[string]any{")
	for _, block := range blocksByType(blocks, "normal") {
		fmt.Fprintf(b, "%q: %s,\n", block.ID, mapLiteral(block.Config))
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeTriggers(b *bytes.Buffer, blocks []validator.Block) {
	fmt.Fprintln(b, "var generatedTriggers = []runner.TriggerDef{")
	for _, block := range blocksByType(blocks, "trigger") {
		cfg := block.Config
		intervalMs := int64(asFloat(cfg["intervalMs"]))
		if intervalMs <= 0 {
			intervalMs = 1000
		}
		fmt.Fprintf(
			b,
			"{ID:%q, Name:%q, Type:%q, Condition:%q, IntervalMs:%d},\n",
			block.ID,
			blockName(block),
			firstNonEmpty(asString(cfg["triggerType"]), "manual"),
			asString(cfg["condition"]),
			intervalMs,
		)
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeActions(b *bytes.Buffer, blocks []validator.Block) {
	fmt.Fprintln(b, "var generatedActions = []runner.ActionDef{")
	for _, block := range blocksByType(blocks, "action") {
		cfg := block.Config
		fmt.Fprintf(
			b,
			"{ID:%q, Name:%q, Kind:%q, Config:%s},\n",
			block.ID,
			blockName(block),
			firstNonEmpty(asString(cfg["actionType"]), "cex"),
			mapLiteral(cfg),
		)
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeMonitors(b *bytes.Buffer, blocks []validator.Block) {
	fmt.Fprintln(b, "var generatedMonitors = []runner.MonitorDef{")
	for _, block := range blocksByType(blocks, "monitoring") {
		cfg := block.Config
		fmt.Fprintf(
			b,
			"{ID:%q, Name:%q, Fields:%s, StreamID:%q},\n",
			block.ID,
			blockName(block),
			stringSliceLiteral(asStringSlice(cfg["fields"])),
			asString(cfg["connectedStreamId"]),
		)
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeConnections(b *bytes.Buffer, connections []validator.Connection) {
	fmt.Fprintln(b, "var generatedConnections = []runner.ConnectionDef{")
	for _, conn := range connections {
		fmt.Fprintf(
			b,
			"{ID:%q, Kind:%q, FromID:%q, ToID:%q},\n",
			conn.ID,
			conn.Kind,
			conn.FromID,
			conn.ToID,
		)
	}
	fmt.Fprintln(b, "}")
	fmt.Fprintln(b)
}

func writeBuilderAndMain(b *bytes.Buffer) {
	b.WriteString(`func buildGeneratedEngine() (*runner.Engine, error) {
	return runner.NewEngine(
		generatedStrategyName,
		generatedStreams,
		generatedNormalConfigs,
		generatedTriggers,
		generatedActions,
		generatedMonitors,
		generatedConnections,
	)
}

func main() {
	engine, err := buildGeneratedEngine()
	if err != nil {
		log.Fatalf("[BOOT] failed to build generated strategy: %v", err)
	}

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute

	watcher := hersh.NewWatcher(config, map[string]string{"RUNNER": "generated-strategy"}, context.Background())
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return engine.Run(msg, ctx)
	}, generatedManagerName)

	if err := watcher.Start(); err != nil {
		log.Fatalf("[BOOT] watcher start failed: %v", err)
	}

	log.Printf("[BOOT] generated Hershy strategy started: strategy=%q streams=%d triggers=%d actions=%d trading_mode=%s",
		engine.StrategyName(),
		engine.StreamCount(),
		engine.TriggerCount(),
		engine.ActionCount(),
		os.Getenv("HERSHY_TRADING_MODE"),
	)

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
`)
}

func blocksByType(blocks []validator.Block, blockType string) []validator.Block {
	out := make([]validator.Block, 0)
	for _, block := range blocks {
		if block.Type == blockType {
			out = append(out, block)
		}
	}
	return out
}

func blockName(block validator.Block) string {
	return firstNonEmpty(asString(block.Config["name"]), asString(block.Config["label"]), block.ID)
}

func mapLiteral(value map[string]interface{}) string {
	if value == nil {
		return "map[string]any{}"
	}
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("map[string]any{")
	for _, key := range keys {
		b.WriteString(strconv.Quote(key))
		b.WriteString(":")
		b.WriteString(literal(value[key]))
		b.WriteString(",")
	}
	b.WriteString("}")
	return b.String()
}

func literal(value any) string {
	switch v := value.(type) {
	case nil:
		return "nil"
	case string:
		return strconv.Quote(v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case []any:
		var b strings.Builder
		b.WriteString("[]any{")
		for _, item := range v {
			b.WriteString(literal(item))
			b.WriteString(",")
		}
		b.WriteString("}")
		return b.String()
	case map[string]any:
		return mapLiteral(v)
	default:
		return strconv.Quote(fmt.Sprint(v))
	}
}

func stringSliceLiteral(values []string) string {
	var b strings.Builder
	b.WriteString("[]string{")
	for _, value := range values {
		b.WriteString(strconv.Quote(value))
		b.WriteString(",")
	}
	b.WriteString("}")
	return b.String()
}

func asStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text := asString(item); text != "" {
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
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return parsed
	default:
		return 0
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

func safeIdent(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "generated_strategy"
	}
	return out
}
