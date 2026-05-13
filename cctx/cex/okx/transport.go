package okx

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

func (o *OKX) doPublicQueryRequest(method, endpoint string, values url.Values) (any, error) {
	requestPath := endpoint
	if encoded := cloneValues(values).Encode(); encoded != "" {
		requestPath += "?" + encoded
	}
	reqURL := strings.TrimRight(o.baseURL, "/") + requestPath

	return o.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, reqURL, nil)
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		return req, nil
	}, endpoint)
}

func (o *OKX) doSignedQueryRequest(method, endpoint string, values url.Values) (any, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return nil, err
	}

	requestPath := endpoint
	if encoded := cloneValues(values).Encode(); encoded != "" {
		requestPath += "?" + encoded
	}
	reqURL := strings.TrimRight(o.baseURL, "/") + requestPath
	headers := o.buildAuthHeaders(method, requestPath, "")

	return o.performRequest(func() (*http.Request, error) {
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

func (o *OKX) doSignedJSONRequest(method, endpoint string, body map[string]any) (any, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return nil, err
	}

	encodedBody, err := json.Marshal(body)
	if err != nil {
		return nil, base.ExchangeError{Message: fmt.Sprintf("encode okx request: %v", err)}
	}
	headers := o.buildAuthHeaders(method, endpoint, string(encodedBody))

	return o.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, strings.TrimRight(o.baseURL, "/")+endpoint, bytes.NewReader(encodedBody))
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

func (o *OKX) performRequest(buildRequest func() (*http.Request, error), endpoint string) (any, error) {
	var out any
	err := o.RetryOnFailure(func() error {
		req, err := buildRequest()
		if err != nil {
			return err
		}
		resp, err := o.httpClient.Do(req)
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		defer resp.Body.Close()

		payload, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return base.RateLimitError{Message: "okx rate limited"}
		}
		if resp.StatusCode >= 400 {
			return classifyOKXError(resp.StatusCode, endpoint, payload)
		}
		if len(strings.TrimSpace(string(payload))) == 0 {
			out = []any{}
			return nil
		}

		root := map[string]any{}
		if err := json.Unmarshal(payload, &root); err != nil {
			return base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
		}

		code := strings.TrimSpace(stringFromAny(root["code"]))
		msg := strings.TrimSpace(stringFromAny(root["msg"]))
		if code != "" && code != "0" {
			return classifyOKXEnvelopeError(code, msg, endpoint)
		}

		out = root["data"]
		if out == nil {
			out = []any{}
		}
		return nil
	})
	return out, err
}

func (o *OKX) buildAuthHeaders(method, requestPath, body string) map[string]string {
	timestamp := okxTimestamp(time.Now().UTC())
	signature := buildHMACSHA256Base64(o.apiSecret, timestamp+strings.ToUpper(strings.TrimSpace(method))+requestPath+body)
	headers := map[string]string{
		"OK-ACCESS-KEY":        o.apiKey,
		"OK-ACCESS-SIGN":       signature,
		"OK-ACCESS-TIMESTAMP":  timestamp,
		"OK-ACCESS-PASSPHRASE": o.apiPassphrase,
	}
	if o.simulated {
		headers["x-simulated-trading"] = "1"
	}
	return headers
}
