package bybit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

func (b *Bybit) doPublicQueryRequest(method, endpoint string, values url.Values) (any, error) {
	query := cloneValues(values)
	reqURL := strings.TrimRight(b.baseURL, "/") + endpoint
	if encoded := query.Encode(); encoded != "" {
		reqURL += "?" + encoded
	}
	return b.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, reqURL, nil)
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		return req, nil
	}, endpoint)
}

func (b *Bybit) doSignedQueryRequest(method, endpoint string, values url.Values) (any, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}
	b.syncServerTimeOffsetBestEffort()

	query := cloneValues(values)
	encoded := query.Encode()
	headers := b.buildAuthHeaders(encoded)
	reqURL := strings.TrimRight(b.baseURL, "/") + endpoint
	if encoded != "" {
		reqURL += "?" + encoded
	}

	return b.performRequest(func() (*http.Request, error) {
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

func (b *Bybit) doSignedJSONRequest(method, endpoint string, body map[string]any) (any, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}
	b.syncServerTimeOffsetBestEffort()

	encodedBody, err := json.Marshal(body)
	if err != nil {
		return nil, base.ExchangeError{Message: fmt.Sprintf("encode bybit request: %v", err)}
	}
	headers := b.buildAuthHeaders(string(encodedBody))

	return b.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, strings.TrimRight(b.baseURL, "/")+endpoint, bytes.NewReader(encodedBody))
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

func (b *Bybit) performRequest(buildRequest func() (*http.Request, error), endpoint string) (any, error) {
	var out any
	err := b.RetryOnFailure(func() error {
		req, err := buildRequest()
		if err != nil {
			return err
		}
		resp, err := b.httpClient.Do(req)
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		defer resp.Body.Close()

		payload, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return base.RateLimitError{Message: "bybit rate limited"}
		}
		if resp.StatusCode >= 400 {
			return classifyBybitError(resp.StatusCode, endpoint, payload)
		}
		if len(strings.TrimSpace(string(payload))) == 0 {
			out = map[string]any{}
			return nil
		}

		root := map[string]any{}
		if err := json.Unmarshal(payload, &root); err != nil {
			return base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
		}

		retCode := intFromAny(root["retCode"], 0)
		retMsg := strings.TrimSpace(stringFromAny(root["retMsg"]))
		if retCode != 0 && strings.ToUpper(retMsg) != "OK" && retMsg != "" {
			return classifyBybitEnvelopeError(retCode, retMsg, endpoint)
		}
		if retCode != 0 {
			return classifyBybitEnvelopeError(retCode, retMsg, endpoint)
		}

		out = root["result"]
		if out == nil {
			out = map[string]any{}
		}
		return nil
	})
	return out, err
}

func (b *Bybit) buildAuthHeaders(payload string) map[string]string {
	timestamp := stringFromAny(b.currentTimestampMillis())
	recvWindow := stringFromAny(b.recvWindow)
	signature := buildHMACSHA256Hex(b.apiSecret, timestamp+b.apiKey+recvWindow+payload)
	return map[string]string{
		"X-BAPI-API-KEY":     b.apiKey,
		"X-BAPI-TIMESTAMP":   timestamp,
		"X-BAPI-RECV-WINDOW": recvWindow,
		"X-BAPI-SIGN":        signature,
		"X-BAPI-SIGN-TYPE":   "2",
	}
}

func (b *Bybit) currentTimestampMillis() int64 {
	return time.Now().UnixMilli() + atomic.LoadInt64(&b.serverTimeOffsetMillis)
}

func (b *Bybit) syncServerTimeOffsetBestEffort() {
	const minSyncInterval = 30 * time.Second

	lastSyncUnix := atomic.LoadInt64(&b.lastServerTimeSyncUnix)
	if lastSyncUnix > 0 && time.Since(time.Unix(lastSyncUnix, 0)) < minSyncInterval {
		return
	}

	b.timeSyncMu.Lock()
	defer b.timeSyncMu.Unlock()

	lastSyncUnix = atomic.LoadInt64(&b.lastServerTimeSyncUnix)
	if lastSyncUnix > 0 && time.Since(time.Unix(lastSyncUnix, 0)) < minSyncInterval {
		return
	}

	offsetMillis, err := b.fetchServerTimeOffsetMillis()
	atomic.StoreInt64(&b.lastServerTimeSyncUnix, time.Now().Unix())
	if err != nil {
		return
	}
	atomic.StoreInt64(&b.serverTimeOffsetMillis, offsetMillis)
}

func (b *Bybit) fetchServerTimeOffsetMillis() (int64, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(b.baseURL, "/")+"/v5/market/time", nil)
	if err != nil {
		return 0, base.ExchangeError{Message: err.Error()}
	}
	req.Header.Set("Accept", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return 0, base.NetworkError{Message: err.Error()}
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, base.NetworkError{Message: err.Error()}
	}
	if resp.StatusCode >= 400 {
		return 0, classifyBybitError(resp.StatusCode, "/v5/market/time", payload)
	}

	root := map[string]any{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("decode server time response: %v", err)}
	}
	serverMillis := int64(floatFromAny(root["time"]))
	if serverMillis <= 0 {
		return 0, base.ExchangeError{Message: "bybit server time missing"}
	}
	return serverMillis - time.Now().UnixMilli(), nil
}
