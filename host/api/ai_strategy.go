package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type AIStrategyDraftRequest struct {
	Prompt          string         `json:"prompt"`
	CurrentStrategy map[string]any `json:"current_strategy,omitempty"`
	ResponseFormat  string         `json:"response_format,omitempty"`
}

type AIStrategyDraftResponse struct {
	Strategy map[string]any `json:"strategy"`
	Source   string         `json:"source"`
	Model    string         `json:"model,omitempty"`
	Message  string         `json:"message,omitempty"`
}

type upstreamHTTPError struct {
	Provider string
	Status   int
	Body     string
}

func (e *upstreamHTTPError) Error() string {
	return fmt.Sprintf("%s status=%d body=%s", e.Provider, e.Status, trimForLog(e.Body, 800))
}

func (hs *HostServer) handleAIStrategyDraft(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req AIStrategyDraftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hs.sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		hs.sendError(w, http.StatusBadRequest, "prompt is required")
		return
	}

	provider := resolveAIProvider()
	var (
		strategy map[string]any
		model    string
		source   string
		err      error
	)
	switch provider {
	case "ollama":
		strategy, model, err = generateStrategyWithOllama(prompt, req.CurrentStrategy)
		source = "ollama-chat"
	case "gemini":
		strategy, model, err = generateStrategyWithGemini(prompt, req.CurrentStrategy)
		source = "google-gemini-generate-content"
	case "openai":
		strategy, model, err = generateStrategyWithOpenAI(prompt, req.CurrentStrategy)
		source = "openai-chat-completions"
	default:
		hs.sendError(w, http.StatusBadRequest, fmt.Sprintf("unsupported AI_PROVIDER: %s", provider))
		return
	}
	if err != nil {
		var upstreamErr *upstreamHTTPError
		if errors.As(err, &upstreamErr) {
			status := http.StatusBadGateway
			switch upstreamErr.Status {
			case http.StatusTooManyRequests:
				status = http.StatusTooManyRequests
			case http.StatusUnauthorized, http.StatusForbidden:
				status = http.StatusUnauthorized
			case http.StatusBadRequest:
				status = http.StatusBadRequest
			}
			hs.sendError(w, status, fmt.Sprintf("ai generation failed: %s", upstreamErr.Error()))
			return
		}
		hs.sendError(w, http.StatusBadGateway, fmt.Sprintf("ai generation failed: %v", err))
		return
	}

	resp := AIStrategyDraftResponse{
		Strategy: strategy,
		Source:   source,
		Model:    model,
		Message:  "AI strategy draft generated",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func resolveAIProvider() string {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("AI_PROVIDER")))
	if provider == "" {
		if strings.TrimSpace(os.Getenv("OLLAMA_BASE_URL")) != "" || strings.TrimSpace(os.Getenv("OLLAMA_MODEL")) != "" {
			return "ollama"
		}
		if strings.TrimSpace(os.Getenv("GOOGLE_API_KEY")) != "" || strings.TrimSpace(os.Getenv("GEMINI_API_KEY")) != "" {
			return "gemini"
		}
		if strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != "" {
			return "openai"
		}
		return "ollama"
	}
	switch provider {
	case "ollama", "local", "oss":
		return "ollama"
	case "google", "gemini", "gemini-api":
		return "gemini"
	case "openai":
		return "openai"
	default:
		return provider
	}
}

func resolveGeminiAPIKey() string {
	if key := strings.TrimSpace(os.Getenv("GOOGLE_API_KEY")); key != "" {
		return key
	}
	return strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
}

func generateStrategyWithOllama(prompt string, current map[string]any) (map[string]any, string, error) {
	baseURL := strings.TrimSpace(os.Getenv("OLLAMA_BASE_URL"))
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	baseURL = strings.TrimRight(baseURL, "/")

	endpoint := strings.TrimSpace(os.Getenv("OLLAMA_ENDPOINT"))
	if endpoint == "" {
		endpoint = baseURL + "/api/chat"
	}

	model := strings.TrimSpace(os.Getenv("OLLAMA_MODEL"))
	if model == "" {
		model = "gpt-oss:20b"
	}

	wireAPI := strings.ToLower(strings.TrimSpace(os.Getenv("OLLAMA_WIRE_API")))
	if wireAPI == "" {
		if strings.Contains(endpoint, "/v1/") {
			wireAPI = "openai"
		} else {
			wireAPI = "ollama"
		}
	}

	systemPrompt := buildAISystemPrompt()
	userPrompt := buildAIUserPrompt(prompt, current)

	var requestPayload map[string]any
	switch wireAPI {
	case "openai":
		requestPayload = map[string]any{
			"model": model,
			"messages": []map[string]string{
				{"role": "system", "content": systemPrompt},
				{"role": "user", "content": userPrompt},
			},
			"temperature": 0.2,
		}
	default:
		requestPayload = map[string]any{
			"model": model,
			"messages": []map[string]string{
				{"role": "system", "content": systemPrompt},
				{"role": "user", "content": userPrompt},
			},
			"stream": false,
			"format": "json",
			"options": map[string]any{
				"temperature": 0.2,
			},
		}
	}

	rawBody, err := json.Marshal(requestPayload)
	if err != nil {
		return nil, model, fmt.Errorf("marshal request payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, model, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if key := strings.TrimSpace(os.Getenv("OLLAMA_API_KEY")); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}

	client := &http.Client{Timeout: resolveTimeout("OLLAMA_TIMEOUT_SEC", 180)}
	resp, err := client.Do(req)
	if err != nil {
		return nil, model, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, model, fmt.Errorf("read response body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, model, &upstreamHTTPError{
			Provider: "ollama",
			Status:   resp.StatusCode,
			Body:     string(body),
		}
	}

	var content string
	if wireAPI == "openai" {
		content, err = parseChatCompletionContent(body)
	} else {
		content, err = parseOllamaChatContent(body)
	}
	if err != nil {
		return nil, model, err
	}

	strategy, err := parseStrategyGraph(content)
	if err != nil {
		return nil, model, err
	}
	return strategy, model, nil
}

func generateStrategyWithGemini(prompt string, current map[string]any) (map[string]any, string, error) {
	apiKey := resolveGeminiAPIKey()
	if apiKey == "" {
		return nil, "", fmt.Errorf("GOOGLE_API_KEY or GEMINI_API_KEY is not set")
	}

	model := strings.TrimSpace(os.Getenv("GEMINI_MODEL"))
	if model == "" {
		model = "gemini-2.0-flash"
	}

	baseURL := strings.TrimSpace(os.Getenv("GEMINI_BASE_URL"))
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta"
	}
	baseURL = strings.TrimRight(baseURL, "/")

	endpoint := strings.TrimSpace(os.Getenv("GEMINI_ENDPOINT"))
	if endpoint == "" {
		endpoint = fmt.Sprintf(
			"%s/models/%s:generateContent?key=%s",
			baseURL,
			url.PathEscape(model),
			url.QueryEscape(apiKey),
		)
	}

	requestPayload := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []map[string]string{
				{"text": buildAISystemPrompt()},
			},
		},
		"contents": []map[string]any{
			{
				"role": "user",
				"parts": []map[string]string{
					{"text": buildAIUserPrompt(prompt, current)},
				},
			},
		},
		"generationConfig": map[string]any{
			"temperature":      0.2,
			"responseMimeType": "application/json",
		},
	}

	rawBody, err := json.Marshal(requestPayload)
	if err != nil {
		return nil, model, fmt.Errorf("marshal request payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, model, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: resolveTimeout("GEMINI_TIMEOUT_SEC", 45)}
	resp, err := client.Do(req)
	if err != nil {
		return nil, model, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, model, fmt.Errorf("read response body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, model, &upstreamHTTPError{
			Provider: "gemini",
			Status:   resp.StatusCode,
			Body:     string(body),
		}
	}

	content, err := parseGeminiContent(body)
	if err != nil {
		return nil, model, err
	}

	strategy, err := parseStrategyGraph(content)
	if err != nil {
		return nil, model, err
	}
	return strategy, model, nil
}

func generateStrategyWithOpenAI(prompt string, current map[string]any) (map[string]any, string, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return nil, "", fmt.Errorf("OPENAI_API_KEY is not set")
	}

	baseURL := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	baseURL = strings.TrimRight(baseURL, "/")
	endpoint := strings.TrimSpace(os.Getenv("OPENAI_CHAT_ENDPOINT"))
	if endpoint == "" {
		endpoint = baseURL + "/chat/completions"
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "gpt-4o-mini"
	}

	requestPayload := map[string]any{
		"model":       model,
		"temperature": 0.2,
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": buildAISystemPrompt(),
			},
			{
				"role":    "user",
				"content": buildAIUserPrompt(prompt, current),
			},
		},
		"response_format": map[string]string{"type": "json_object"},
	}

	rawBody, err := json.Marshal(requestPayload)
	if err != nil {
		return nil, model, fmt.Errorf("marshal request payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, model, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: resolveTimeout("OPENAI_TIMEOUT_SEC", 35)}
	resp, err := client.Do(req)
	if err != nil {
		return nil, model, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, model, fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, model, &upstreamHTTPError{
			Provider: "openai",
			Status:   resp.StatusCode,
			Body:     string(body),
		}
	}

	content, err := parseChatCompletionContent(body)
	if err != nil {
		return nil, model, err
	}

	strategy, err := parseStrategyGraph(content)
	if err != nil {
		return nil, model, err
	}
	return strategy, model, nil
}

func parseGeminiContent(raw []byte) (string, error) {
	var resp map[string]any
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", fmt.Errorf("decode gemini response: %w", err)
	}

	candidates, _ := resp["candidates"].([]any)
	if len(candidates) == 0 {
		if feedback, ok := resp["promptFeedback"]; ok {
			return "", fmt.Errorf("gemini returned no candidates: %v", feedback)
		}
		return "", fmt.Errorf("gemini returned no candidates")
	}

	first, _ := candidates[0].(map[string]any)
	content, _ := first["content"].(map[string]any)
	parts, _ := content["parts"].([]any)

	var builder strings.Builder
	for _, part := range parts {
		segment, ok := part.(map[string]any)
		if !ok {
			continue
		}
		if text, ok := segment["text"].(string); ok {
			builder.WriteString(text)
		}
	}
	output := strings.TrimSpace(builder.String())
	if output == "" {
		return "", fmt.Errorf("gemini content is empty (finishReason=%v)", first["finishReason"])
	}
	return output, nil
}

func parseOllamaChatContent(raw []byte) (string, error) {
	var resp struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", fmt.Errorf("decode ollama response: %w", err)
	}
	if strings.TrimSpace(resp.Error) != "" {
		return "", fmt.Errorf("ollama error: %s", resp.Error)
	}
	content := strings.TrimSpace(resp.Message.Content)
	if content == "" {
		return "", fmt.Errorf("ollama content is empty")
	}
	return content, nil
}

func buildAISystemPrompt() string {
	return strings.TrimSpace(`
You generate strategy JSON for Hershy runner.
Return only valid JSON (no markdown).

Required top-level object:
{
  "schemaVersion": 1,
  "kind": "hershy-strategy-graph",
  "strategy": {"id": "string", "name": "string"},
  "generatedAt": "ISO8601",
  "summary": {"blocks": number, "connections": number, "byType": {"streaming": number, "normal": number, "trigger": number, "action": number, "monitoring": number}},
  "blocks": [...],
  "connections": [...]
}

Allowed block types:
- streaming: config {name, sourceUrl, updateMode, updateIntervalMs, fields[]}
- normal: config {name, value}
- trigger: config {name, triggerType(manual|time|condition), intervalMs, condition, logicOperator}
- action: config {name, actionType(cex|dex), exchange, executionMode, contractAddress, contractAbi, apiUrl, apiPayloadTemplate, parameters[]}
- monitoring: config {name, monitorType, connectedStreamId, connectedStream, fields[]}

Allowed connection kinds:
- stream-monitor: streaming -> monitoring
- trigger-action: trigger -> action
- action-input: streaming|normal|monitoring -> action

Validation constraints:
- at least 1 streaming block
- at least 1 trigger block
- at least 1 action block
- each action should have at least one incoming trigger-action connection
- use explicit id strings like streaming-1, trigger-1, action-1
- include position {x,y} for each block

Use paper-trading style defaults and Binance-compatible examples if not specified.
`)
}

func buildAIUserPrompt(prompt string, current map[string]any) string {
	var builder strings.Builder
	builder.WriteString("User request:\n")
	builder.WriteString(strings.TrimSpace(prompt))
	if current != nil && len(current) > 0 {
		builder.WriteString("\n\nCurrent strategy JSON (optional context):\n")
		builder.WriteString(trimForLog(mustMarshalJSON(current), 12000))
	}
	builder.WriteString("\n\nReturn a complete strategy graph JSON object.")
	return builder.String()
}

func parseChatCompletionContent(raw []byte) (string, error) {
	var resp struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", fmt.Errorf("decode chat completion: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("chat completion returned no choices")
	}
	content := extractMessageContent(resp.Choices[0].Message.Content)
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("chat completion content is empty")
	}
	return content, nil
}

func extractMessageContent(content any) string {
	switch value := content.(type) {
	case string:
		return strings.TrimSpace(value)
	case []any:
		var builder strings.Builder
		for _, item := range value {
			segment, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := segment["text"].(string); ok {
				builder.WriteString(text)
			}
		}
		return strings.TrimSpace(builder.String())
	default:
		return ""
	}
}

func parseStrategyGraph(text string) (map[string]any, error) {
	trimmed := strings.TrimSpace(text)
	if strings.HasPrefix(trimmed, "```") {
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimPrefix(trimmed, "```")
		trimmed = strings.TrimSuffix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
	}

	var out map[string]any
	if err := json.Unmarshal([]byte(trimmed), &out); err != nil {
		return nil, fmt.Errorf("invalid strategy JSON: %w", err)
	}

	if kind, _ := out["kind"].(string); kind == "hershy-strategy-graph" {
		return out, nil
	}
	if nested, ok := out["strategy"].(map[string]any); ok {
		if kind, _ := nested["kind"].(string); kind == "hershy-strategy-graph" {
			return nested, nil
		}
	}
	return nil, fmt.Errorf("response is not hershy-strategy-graph")
}

func mustMarshalJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func trimForLog(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "...(truncated)"
}

func resolveTimeout(envKey string, fallbackSec int) time.Duration {
	value := strings.TrimSpace(os.Getenv(envKey))
	if value == "" {
		return time.Duration(fallbackSec) * time.Second
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return time.Duration(fallbackSec) * time.Second
	}
	return time.Duration(seconds) * time.Second
}
