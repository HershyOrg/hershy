package validator

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

type StrategyGraph struct {
	SchemaVersion int          `json:"schemaVersion"`
	Kind          string       `json:"kind"`
	Strategy      StrategyMeta `json:"strategy"`
	Blocks        []Block      `json:"blocks"`
	Connections   []Connection `json:"connections"`
}

type StrategyMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Block struct {
	ID     string                 `json:"id"`
	Type   string                 `json:"type"`
	Config map[string]interface{} `json:"config"`
}

type Connection struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	FromID string `json:"fromId"`
	ToID   string `json:"toId"`
}

var allowedBlockTypes = map[string]struct{}{
	"streaming":  {},
	"normal":     {},
	"trigger":    {},
	"action":     {},
	"monitoring": {},
}

var allowedConnectionKinds = map[string]struct{}{
	"trigger-action": {},
	"action-input":   {},
	"stream-monitor": {},
}

func ValidateFile(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var graph StrategyGraph
	if err := json.Unmarshal(data, &graph); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	return Validate(graph), nil
}

func Validate(graph StrategyGraph) []string {
	issues := make([]string, 0)

	if graph.Kind != "" && graph.Kind != "hershy-strategy-graph" {
		issues = append(issues, fmt.Sprintf("kind must be 'hershy-strategy-graph' when provided (got %q)", graph.Kind))
	}

	if len(graph.Blocks) == 0 {
		issues = append(issues, "blocks must not be empty")
		return issues
	}

	blockTypeByID := make(map[string]string, len(graph.Blocks))
	blockIDs := make([]string, 0, len(graph.Blocks))
	triggerConditionByID := make(map[string]string)
	for i, b := range graph.Blocks {
		prefix := fmt.Sprintf("blocks[%d]", i)
		if strings.TrimSpace(b.ID) == "" {
			issues = append(issues, prefix+": id is required")
			continue
		}
		if _, exists := blockTypeByID[b.ID]; exists {
			issues = append(issues, prefix+": duplicate block id: "+b.ID)
			continue
		}

		if _, ok := allowedBlockTypes[b.Type]; !ok {
			issues = append(issues, fmt.Sprintf("%s: unsupported block type %q", prefix, b.Type))
			continue
		}

		if b.Config == nil {
			issues = append(issues, prefix+": config object is required")
		}

		if b.Type == "streaming" {
			if _, ok := b.Config["updateIntervalMs"]; !ok {
				issues = append(issues, prefix+": streaming.config.updateIntervalMs is required")
			}
		}

		if b.Type == "trigger" {
			if triggerType, ok := asString(b.Config["triggerType"]); ok && triggerType == "condition" {
				if condition, ok := asString(b.Config["condition"]); !ok || strings.TrimSpace(condition) == "" {
					issues = append(issues, prefix+": triggerType=condition requires non-empty config.condition")
				} else {
					triggerConditionByID[b.ID] = condition
				}
			}
		}

		blockTypeByID[b.ID] = b.Type
		blockIDs = append(blockIDs, b.ID)
	}

	streamCount := countBlocksByType(blockTypeByID, "streaming")
	triggerCount := countBlocksByType(blockTypeByID, "trigger")
	actionCount := countBlocksByType(blockTypeByID, "action")
	if streamCount == 0 {
		issues = append(issues, "graph must include at least one streaming block")
	}
	if triggerCount == 0 {
		issues = append(issues, "graph must include at least one trigger block")
	}
	if actionCount == 0 {
		issues = append(issues, "graph must include at least one action block")
	}

	if len(graph.Connections) == 0 {
		issues = append(issues, "connections should not be empty for executable graphs")
	}

	connIDs := make(map[string]struct{}, len(graph.Connections))
	connected := make(map[string]bool, len(blockTypeByID))
	adj := make(map[string]map[string]struct{}, len(blockTypeByID))
	triggerOut := make(map[string]int)
	actionInFromTrigger := make(map[string]int)
	actionInFromInput := make(map[string]int)
	monitorInFromStream := make(map[string]int)
	streamOut := make(map[string]int)
	normalOut := make(map[string]int)
	for i, c := range graph.Connections {
		prefix := fmt.Sprintf("connections[%d]", i)

		if strings.TrimSpace(c.ID) == "" {
			issues = append(issues, prefix+": id is required")
		} else {
			if _, exists := connIDs[c.ID]; exists {
				issues = append(issues, prefix+": duplicate connection id: "+c.ID)
			} else {
				connIDs[c.ID] = struct{}{}
			}
		}

		if _, ok := allowedConnectionKinds[c.Kind]; !ok {
			issues = append(issues, fmt.Sprintf("%s: unsupported connection kind %q", prefix, c.Kind))
			continue
		}

		fromType, fromOK := blockTypeByID[c.FromID]
		toType, toOK := blockTypeByID[c.ToID]
		if !fromOK {
			issues = append(issues, fmt.Sprintf("%s: fromId %q not found in blocks", prefix, c.FromID))
		}
		if !toOK {
			issues = append(issues, fmt.Sprintf("%s: toId %q not found in blocks", prefix, c.ToID))
		}
		if !fromOK || !toOK {
			continue
		}

		connected[c.FromID] = true
		connected[c.ToID] = true
		addUndirectedEdge(adj, c.FromID, c.ToID)

		switch c.Kind {
		case "trigger-action":
			if fromType != "trigger" || toType != "action" {
				issues = append(issues, fmt.Sprintf("%s: trigger-action requires trigger -> action (got %s -> %s)", prefix, fromType, toType))
				break
			}
			triggerOut[c.FromID]++
			actionInFromTrigger[c.ToID]++
		case "action-input":
			if toType != "action" {
				issues = append(issues, fmt.Sprintf("%s: action-input requires * -> action (got %s -> %s)", prefix, fromType, toType))
				break
			}
			if fromType != "streaming" && fromType != "normal" {
				issues = append(issues, fmt.Sprintf("%s: action-input fromId must be streaming or normal (got %s)", prefix, fromType))
				break
			}
			actionInFromInput[c.ToID]++
			if fromType == "streaming" {
				streamOut[c.FromID]++
			}
			if fromType == "normal" {
				normalOut[c.FromID]++
			}
		case "stream-monitor":
			if fromType != "streaming" || toType != "monitoring" {
				issues = append(issues, fmt.Sprintf("%s: stream-monitor requires streaming -> monitoring (got %s -> %s)", prefix, fromType, toType))
				break
			}
			streamOut[c.FromID]++
			monitorInFromStream[c.ToID]++
		}
	}

	for triggerID, condition := range triggerConditionByID {
		for _, candidateID := range blockIDs {
			if candidateID == triggerID {
				continue
			}
			if !conditionMentionsID(condition, candidateID) {
				continue
			}

			candidateType := blockTypeByID[candidateID]
			if candidateType != "streaming" && candidateType != "normal" {
				continue
			}

			connected[candidateID] = true
			connected[triggerID] = true
			addUndirectedEdge(adj, candidateID, triggerID)
			if candidateType == "streaming" {
				streamOut[candidateID]++
			}
			if candidateType == "normal" {
				normalOut[candidateID]++
			}
		}
	}

	for id, t := range blockTypeByID {
		switch t {
		case "trigger":
			if triggerOut[id] == 0 {
				issues = append(issues, fmt.Sprintf("block %q (trigger) is not connected to any action via trigger-action", id))
			}
		case "action":
			if actionInFromTrigger[id] == 0 {
				issues = append(issues, fmt.Sprintf("block %q (action) has no incoming trigger-action", id))
			}
			if actionInFromInput[id] == 0 {
				issues = append(issues, fmt.Sprintf("block %q (action) has no incoming action-input (streaming/normal data)", id))
			}
		case "monitoring":
			if monitorInFromStream[id] == 0 {
				issues = append(issues, fmt.Sprintf("block %q (monitoring) has no incoming stream-monitor", id))
			}
		case "streaming":
			if streamOut[id] == 0 {
				issues = append(issues, fmt.Sprintf("block %q (streaming) is not used by action-input or stream-monitor", id))
			}
		case "normal":
			if normalOut[id] == 0 {
				issues = append(issues, fmt.Sprintf("block %q (normal) is not used by any action-input", id))
			}
		}

		if !connected[id] {
			issues = append(issues, fmt.Sprintf("block %q is isolated (no connections)", id))
		}
	}

	components := connectedComponents(adj, blockIDs)
	if len(components) > 1 {
		for i, comp := range components {
			sort.Strings(comp)
			issues = append(issues, fmt.Sprintf("graph is disconnected: component %d = %s", i+1, strings.Join(comp, ",")))
		}
	}

	sort.Strings(issues)
	return issues
}

func countBlocksByType(blockTypeByID map[string]string, target string) int {
	cnt := 0
	for _, t := range blockTypeByID {
		if t == target {
			cnt++
		}
	}
	return cnt
}

func addUndirectedEdge(adj map[string]map[string]struct{}, a, b string) {
	if _, ok := adj[a]; !ok {
		adj[a] = map[string]struct{}{}
	}
	if _, ok := adj[b]; !ok {
		adj[b] = map[string]struct{}{}
	}
	adj[a][b] = struct{}{}
	adj[b][a] = struct{}{}
}

func connectedComponents(adj map[string]map[string]struct{}, nodes []string) [][]string {
	if len(nodes) == 0 {
		return nil
	}

	visited := make(map[string]bool, len(nodes))
	components := make([][]string, 0)

	for _, start := range nodes {
		if visited[start] {
			continue
		}

		queue := []string{start}
		visited[start] = true
		component := []string{start}

		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]
			for next := range adj[cur] {
				if visited[next] {
					continue
				}
				visited[next] = true
				queue = append(queue, next)
				component = append(component, next)
			}
		}

		components = append(components, component)
	}

	return components
}

func asString(v interface{}) (string, bool) {
	s, ok := v.(string)
	if !ok {
		return "", false
	}
	return s, true
}

func conditionMentionsID(condition, id string) bool {
	if id == "" {
		return false
	}
	if strings.Contains(condition, id+"::") {
		return true
	}
	return hasWordToken(condition, id)
}

func hasWordToken(s, token string) bool {
	if token == "" {
		return false
	}

	start := 0
	for {
		idx := strings.Index(s[start:], token)
		if idx < 0 {
			return false
		}
		idx += start
		leftOK := idx == 0 || !isIdentChar(rune(s[idx-1]))
		rightPos := idx + len(token)
		rightOK := rightPos >= len(s) || !isIdentChar(rune(s[rightPos]))
		if leftOK && rightOK {
			return true
		}
		start = idx + len(token)
		if start >= len(s) {
			return false
		}
	}
}

func isIdentChar(r rune) bool {
	return (r >= 'a' && r <= 'z') ||
		(r >= 'A' && r <= 'Z') ||
		(r >= '0' && r <= '9') ||
		r == '_' || r == '-'
}
