package debug

import (
	"encoding/json"
	"errors"
	"os"
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

func compactAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	return values
}

func compactStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	return values
}

func dirName(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			if i == 0 {
				return "/"
			}
			return path[:i]
		}
	}
	return "."
}
