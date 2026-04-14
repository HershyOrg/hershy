package debug

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Recorder struct {
	mu                sync.Mutex
	sink              EventSink
	defaultStrategyID string
	defaultVenue      string
}

type Option func(*Recorder)

func WithDefaultVenue(venue string) Option {
	return func(r *Recorder) {
		r.defaultVenue = venue
	}
}

func NewRecorder(strategyID string, sink EventSink, options ...Option) *Recorder {
	recorder := &Recorder{
		sink:              sink,
		defaultStrategyID: strategyID,
	}
	for _, option := range options {
		if option != nil {
			option(recorder)
		}
	}
	return recorder
}

func NewNoopRecorder(strategyID string, options ...Option) *Recorder {
	return NewRecorder(strategyID, nil, options...)
}

func OpenJSONLRecorder(path, strategyID string, options ...Option) (*Recorder, error) {
	if path == "" {
		return NewNoopRecorder(strategyID, options...), nil
	}
	sink, err := OpenJSONLSink(path)
	if err != nil {
		return nil, err
	}
	return NewRecorder(strategyID, sink, options...), nil
}

func OpenRecorder(path, strategyID string, options ...Option) (*Recorder, error) {
	if path == "" {
		return NewNoopRecorder(strategyID, options...), nil
	}
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(path)), ".jsonl") {
		return OpenJSONLRecorder(path, strategyID, options...)
	}
	return OpenStateRecorder(path, strategyID, options...)
}

func (r *Recorder) Emit(eventType EventType, params EmitParams) error {
	if r == nil {
		return nil
	}
	if eventType == "" {
		return errors.New("debug: missing event type")
	}

	envelope := EventEnvelope{
		RunID:      params.RunID,
		TradeID:    params.TradeID,
		DecisionID: params.DecisionID,
		Event:      eventType,
		TsMs:       params.TsMs,
		StrategyID: r.defaultStrategyID,
		MarketID:   params.MarketID,
		Venue:      params.Venue,
		ReasonCode: params.ReasonCode,
		Decision:   params.Decision,
		Inputs:     compactAnyMap(params.Inputs),
		Derived:    compactAnyMap(params.Derived),
		Outcome:    compactAnyMap(params.Outcome),
		Tags:       compactStringMap(params.Tags),
	}
	if envelope.TsMs == 0 {
		envelope.TsMs = time.Now().UnixMilli()
	}
	if envelope.Venue == "" {
		envelope.Venue = r.defaultVenue
	}
	if r.sink == nil {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sink.WriteEvent(envelope)
}

func (r *Recorder) Close() error {
	if r == nil || r.sink == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sink.Close()
}

type JSONLSink struct {
	mu   sync.Mutex
	file *os.File
	enc  *json.Encoder
}

type StateSink struct {
	mu         sync.Mutex
	path       string
	state      TimelineState
	mergeIndex map[string]string
}

var timelineTagWhitelist = map[string]bool{
	"action_id":   true,
	"action_type": true,
	"market_slug": true,
	"mode":        true,
	"status":      true,
	"trigger_id":  true,
}

var timelineDataWhitelist = map[string]bool{
	"available_usdc":        true,
	"avg_price":             true,
	"bet_up":                true,
	"cancelled_open_orders": true,
	"created_at":            true,
	"current_exit_price":    true,
	"edge":                  true,
	"edge_vs_exit":          true,
	"error":                 true,
	"estimated_entry_price": true,
	"filled":                true,
	"from_bet_up":           true,
	"market_id":             true,
	"min_entry_edge":        true,
	"min_position_prob":     true,
	"order_id":              true,
	"p_bad":                 true,
	"p_up":                  true,
	"partial":               true,
	"pnl":                   true,
	"position_prob":         true,
	"price":                 true,
	"proceeds":              true,
	"quantity":              true,
	"quoteOrderQty":         true,
	"realized_cost":         true,
	"remaining_cost":        true,
	"remaining_shares":      true,
	"remaining_upside":      true,
	"retry_ms":              true,
	"roi_pct":               true,
	"shares":                true,
	"side":                  true,
	"size":                  true,
	"state":                 true,
	"status":                true,
	"stop_at_ms":            true,
	"tau_sec":               true,
	"to_bet_up":             true,
	"token_id":              true,
	"unrealized_roi":        true,
	"updated_at":            true,
	"usdc":                  true,
}

func OpenJSONLSink(path string) (*JSONLSink, error) {
	if err := os.MkdirAll(dirName(path), 0o755); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	return &JSONLSink{
		file: file,
		enc:  json.NewEncoder(file),
	}, nil
}

func (s *JSONLSink) WriteEvent(event EventEnvelope) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enc.Encode(event)
}

func (s *JSONLSink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		return nil
	}
	if err := s.file.Sync(); err != nil {
		_ = s.file.Close()
		s.file = nil
		return err
	}
	err := s.file.Close()
	s.file = nil
	return err
}

func OpenStateRecorder(path, strategyID string, options ...Option) (*Recorder, error) {
	if path == "" {
		return NewNoopRecorder(strategyID, options...), nil
	}
	sink, err := OpenStateSink(path, strategyID)
	if err != nil {
		return nil, err
	}
	return NewRecorder(strategyID, sink, options...), nil
}

func OpenStateSink(path, strategyID string) (*StateSink, error) {
	if err := os.MkdirAll(dirName(path), 0o755); err != nil {
		return nil, err
	}

	sink := &StateSink{
		path: path,
		state: TimelineState{
			StrategyID: strategyID,
			Entries:    map[string]TimelineEntry{},
		},
		mergeIndex: map[string]string{},
	}

	data, err := os.ReadFile(path)
	if err == nil && len(data) > 0 {
		var existing TimelineState
		if unmarshalErr := json.Unmarshal(data, &existing); unmarshalErr != nil {
			return nil, unmarshalErr
		}
		if existing.StrategyID == "" {
			existing.StrategyID = strategyID
		}
		if existing.Entries == nil {
			existing.Entries = map[string]TimelineEntry{}
		}
		sink.state = existing
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	sink.rebuildMergeIndex()
	return sink, nil
}

func (s *StateSink) WriteEvent(event EventEnvelope) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if shouldSkipTimelineEvent(event.Event) {
		return nil
	}

	if s.state.StrategyID == "" {
		s.state.StrategyID = event.StrategyID
	}
	if s.state.Entries == nil {
		s.state.Entries = map[string]TimelineEntry{}
	}
	if s.mergeIndex == nil {
		s.mergeIndex = map[string]string{}
	}

	tsMs := event.TsMs
	if tsMs == 0 {
		tsMs = time.Now().UnixMilli()
	}
	event.TsMs = tsMs

	entryKey := s.entryKeyForEvent(event)
	entry, exists := s.state.Entries[entryKey]
	if !exists {
		entry = TimelineEntry{
			TsMs:       tsMs,
			RunID:      event.RunID,
			TradeID:    cloneTradeID(event.TradeID),
			DecisionID: cloneDecisionID(event.DecisionID),
			MarketID:   event.MarketID,
			Venue:      event.Venue,
			Tags:       compactTags(event.Tags),
		}
		s.state.Timeline = append(s.state.Timeline, entryKey)
	} else {
		if entry.RunID == "" {
			entry.RunID = event.RunID
		}
		if entry.TradeID == nil && event.TradeID != nil {
			entry.TradeID = cloneTradeID(event.TradeID)
		}
		if entry.DecisionID == nil && event.DecisionID != nil {
			entry.DecisionID = cloneDecisionID(event.DecisionID)
		}
		if entry.MarketID == "" {
			entry.MarketID = event.MarketID
		}
		if entry.Venue == "" {
			entry.Venue = event.Venue
		}
		entry.Tags = mergeStringMaps(entry.Tags, compactTags(event.Tags))
		if tsMs > entry.LastTsMs {
			entry.LastTsMs = tsMs
		}
	}

	entry.LastTsMs = maxInt64(entry.LastTsMs, tsMs)
	entry.Steps = append(entry.Steps, TimelineStep{
		TsMs:       tsMs,
		Event:      event.Event,
		ReasonCode: event.ReasonCode,
		Decision:   event.Decision,
		Data:       compactStepData(event),
	})
	s.state.Entries[entryKey] = entry
	s.state.UpdatedTsMs = maxInt64(s.state.UpdatedTsMs, tsMs)

	return s.flush()
}

func (s *StateSink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flush()
}

func (s *StateSink) flush() error {
	payload, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, append(payload, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.path)
}

func (s *StateSink) rebuildMergeIndex() {
	for key, entry := range s.state.Entries {
		if mergeKey := mergeKeyFromEntry(entry); mergeKey != "" {
			s.mergeIndex[mergeKey] = key
		}
	}
}

func (s *StateSink) entryKeyForEvent(event EventEnvelope) string {
	if mergeKey := mergeKeyFromEvent(event); mergeKey != "" {
		if existing, ok := s.mergeIndex[mergeKey]; ok {
			return existing
		}
		key := s.uniqueTimestampKey(event.TsMs)
		s.mergeIndex[mergeKey] = key
		return key
	}

	return s.uniqueTimestampKey(event.TsMs)
}

func (s *StateSink) uniqueTimestampKey(tsMs int64) string {
	baseKey := formatTimestampKey(tsMs)
	if _, exists := s.state.Entries[baseKey]; !exists {
		return baseKey
	}
	for idx := 1; ; idx++ {
		candidate := fmt.Sprintf("%s-%02d", baseKey, idx)
		if _, exists := s.state.Entries[candidate]; !exists {
			return candidate
		}
	}
}

func mergeKeyFromEvent(event EventEnvelope) string {
	if event.DecisionID != nil && strings.TrimSpace(string(*event.DecisionID)) != "" {
		return fmt.Sprintf("decision:%s:%s", strings.TrimSpace(string(event.RunID)), strings.TrimSpace(string(*event.DecisionID)))
	}
	if event.TradeID != nil && strings.TrimSpace(string(*event.TradeID)) != "" {
		return fmt.Sprintf("trade:%s:%s", strings.TrimSpace(string(event.RunID)), strings.TrimSpace(string(*event.TradeID)))
	}
	return ""
}

func mergeKeyFromEntry(entry TimelineEntry) string {
	if entry.DecisionID != nil && strings.TrimSpace(string(*entry.DecisionID)) != "" {
		return fmt.Sprintf("decision:%s:%s", strings.TrimSpace(string(entry.RunID)), strings.TrimSpace(string(*entry.DecisionID)))
	}
	if entry.TradeID != nil && strings.TrimSpace(string(*entry.TradeID)) != "" {
		return fmt.Sprintf("trade:%s:%s", strings.TrimSpace(string(entry.RunID)), strings.TrimSpace(string(*entry.TradeID)))
	}
	return ""
}

func formatTimestampKey(tsMs int64) string {
	if tsMs <= 0 {
		tsMs = time.Now().UnixMilli()
	}
	return fmt.Sprintf("%013d", tsMs)
}

func compactAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	compacted := map[string]any{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		normalized, ok := compactAnyValue(value)
		if !ok {
			continue
		}
		compacted[key] = normalized
	}
	if len(compacted) == 0 {
		return nil
	}
	return compacted
}

func compactStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	compacted := map[string]string{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		compacted[key] = value
	}
	if len(compacted) == 0 {
		return nil
	}
	return compacted
}

func dirName(path string) string {
	dir := filepath.Dir(path)
	if dir == "" {
		return "."
	}
	return dir
}

func cloneAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func mergeStringMaps(current map[string]string, incoming map[string]string) map[string]string {
	if len(incoming) == 0 {
		return current
	}
	if current == nil {
		current = map[string]string{}
	}
	for key, value := range incoming {
		if strings.TrimSpace(key) == "" {
			continue
		}
		current[key] = value
	}
	if len(current) == 0 {
		return nil
	}
	return current
}

func cloneTradeID(value *TradeID) *TradeID {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneDecisionID(value *DecisionID) *DecisionID {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func shouldSkipTimelineEvent(eventType EventType) bool {
	return eventType == EventMarketSnapshot
}

func compactTags(tags map[string]string) map[string]string {
	if len(tags) == 0 {
		return nil
	}
	filtered := map[string]string{}
	for key, value := range tags {
		key = strings.TrimSpace(key)
		if !timelineTagWhitelist[key] {
			continue
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		filtered[key] = value
	}
	if len(filtered) == 0 {
		return nil
	}
	return filtered
}

func compactStepData(event EventEnvelope) map[string]any {
	data := map[string]any{}
	collectTimelineFields(event.Inputs, data)
	collectTimelineFields(event.Derived, data)
	collectTimelineFields(event.Outcome, data)
	if len(data) == 0 {
		return nil
	}
	return data
}

func collectTimelineFields(value any, out map[string]any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			key = strings.TrimSpace(key)
			if timelineDataWhitelist[key] {
				if normalized, ok := compactAnyValue(nested); ok {
					if _, exists := out[key]; !exists {
						out[key] = normalized
					}
				}
				continue
			}
			collectTimelineFields(nested, out)
		}
	case map[string]string:
		for key, nested := range typed {
			key = strings.TrimSpace(key)
			if !timelineDataWhitelist[key] {
				continue
			}
			normalized, ok := compactAnyValue(nested)
			if ok {
				if _, exists := out[key]; !exists {
					out[key] = normalized
				}
			}
		}
	case []any:
		for _, item := range typed {
			collectTimelineFields(item, out)
		}
	case []string:
		for _, item := range typed {
			collectTimelineFields(item, out)
		}
	}
}

func compactAnyValue(value any) (any, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, false
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil, false
		}
		return trimmed, true
	case map[string]any:
		compacted := compactAnyMap(typed)
		if len(compacted) == 0 {
			return nil, false
		}
		return compacted, true
	case map[string]string:
		compacted := compactStringMap(typed)
		if len(compacted) == 0 {
			return nil, false
		}
		return compacted, true
	case []any:
		compacted := compactAnySlice(typed)
		if len(compacted) == 0 {
			return nil, false
		}
		return compacted, true
	case []string:
		compacted := compactStringSlice(typed)
		if len(compacted) == 0 {
			return nil, false
		}
		return compacted, true
	default:
		return value, true
	}
}

func compactAnySlice(values []any) []any {
	if len(values) == 0 {
		return nil
	}
	compacted := make([]any, 0, len(values))
	for _, value := range values {
		normalized, ok := compactAnyValue(value)
		if ok {
			compacted = append(compacted, normalized)
		}
	}
	if len(compacted) == 0 {
		return nil
	}
	return compacted
}

func compactStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	compacted := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			compacted = append(compacted, value)
		}
	}
	if len(compacted) == 0 {
		return nil
	}
	return compacted
}
