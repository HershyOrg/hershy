package gateio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

func (g *GateIO) doPublicQueryRequest(method, endpoint string, values url.Values) (any, error) {
	requestPath := endpoint
	encodedQuery := cloneValues(values).Encode()
	if encodedQuery != "" {
		requestPath += "?" + encodedQuery
	}
	reqURL := strings.TrimRight(g.baseURL, "/") + requestPath

	return g.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, reqURL, nil)
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		return req, nil
	}, endpoint)
}

func (g *GateIO) doSignedQueryRequest(method, endpoint string, values url.Values) (any, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return nil, err
	}

	requestPath := endpoint
	encodedQuery := cloneValues(values).Encode()
	if encodedQuery != "" {
		requestPath += "?" + encodedQuery
	}
	reqURL := strings.TrimRight(g.baseURL, "/") + requestPath
	headers := g.buildAuthHeaders(method, endpoint, encodedQuery, "")

	return g.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, reqURL, nil)
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		return req, nil
	}, endpoint)
}

func (g *GateIO) doSignedJSONRequest(method, endpoint string, body map[string]any) (any, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return nil, err
	}

	encodedBody, err := json.Marshal(body)
	if err != nil {
		return nil, base.ExchangeError{Message: fmt.Sprintf("encode gateio request: %v", err)}
	}
	headers := g.buildAuthHeaders(method, endpoint, "", string(encodedBody))

	return g.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, strings.TrimRight(g.baseURL, "/")+endpoint, bytes.NewReader(encodedBody))
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		return req, nil
	}, endpoint)
}

func (g *GateIO) doSignedDeleteRequest(endpoint string, values url.Values) (any, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return nil, err
	}

	requestPath := endpoint
	encodedQuery := cloneValues(values).Encode()
	if encodedQuery != "" {
		requestPath += "?" + encodedQuery
	}
	reqURL := strings.TrimRight(g.baseURL, "/") + requestPath
	headers := g.buildAuthHeaders(http.MethodDelete, endpoint, encodedQuery, "")

	return g.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(http.MethodDelete, reqURL, nil)
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		return req, nil
	}, endpoint)
}

func (g *GateIO) performRequest(buildRequest func() (*http.Request, error), endpoint string) (any, error) {
	var out any
	err := g.RetryOnFailure(func() error {
		req, err := buildRequest()
		if err != nil {
			return err
		}
		resp, err := g.httpClient.Do(req)
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		defer resp.Body.Close()

		payload, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return base.RateLimitError{Message: "gateio rate limited"}
		}
		if resp.StatusCode >= 400 {
			return classifyGateIOError(resp.StatusCode, endpoint, payload)
		}
		if len(strings.TrimSpace(string(payload))) == 0 {
			out = []any{}
			return nil
		}

		if err := json.Unmarshal(payload, &out); err != nil {
			return base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
		}
		return nil
	})
	return out, err
}

func (g *GateIO) buildAuthHeaders(method, endpoint, query, body string) map[string]string {
	timestamp := strconvFormatInt(time.Now().UTC().Unix())
	bodyHash := sha512Hex(body)
	signString := strings.ToUpper(strings.TrimSpace(method)) + "\n" + endpoint + "\n" + query + "\n" + bodyHash + "\n" + timestamp
	signature := buildHMACSHA512Hex(g.apiSecret, signString)
	return map[string]string{
		"KEY":       g.apiKey,
		"SIGN":      signature,
		"Timestamp": timestamp,
	}
}

func strconvFormatInt(value int64) string {
	return fmt.Sprintf("%d", value)
}
