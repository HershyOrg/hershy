package binance

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

func (b *Binance) doQueryRequest(method, endpoint string, values url.Values, signed bool) (any, error) {
	query := cloneValues(values)
	if signed {
		if err := b.ensureAuthenticated(); err != nil {
			return nil, err
		}
		query = b.withSignature(query)
	}

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
		if signed {
			req.Header.Set("X-MBX-APIKEY", b.apiKey)
		}
		return req, nil
	}, endpoint)
}

func (b *Binance) doFormRequest(method, endpoint string, values url.Values, signed bool) (map[string]any, error) {
	form := cloneValues(values)
	if signed {
		if err := b.ensureAuthenticated(); err != nil {
			return nil, err
		}
		form = b.withSignature(form)
	}

	encodedForm := form.Encode()
	payload, err := b.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, strings.TrimRight(b.baseURL, "/")+endpoint, strings.NewReader(encodedForm))
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if signed {
			req.Header.Set("X-MBX-APIKEY", b.apiKey)
		}
		return req, nil
	}, endpoint)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance response malformed"}
	}
	return root, nil
}

func (b *Binance) performRequest(buildRequest func() (*http.Request, error), endpoint string) (any, error) {
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
			return base.RateLimitError{Message: "binance rate limited"}
		}
		if resp.StatusCode >= 400 {
			return classifyBinanceError(resp.StatusCode, endpoint, payload)
		}
		if len(strings.TrimSpace(string(payload))) == 0 {
			out = map[string]any{}
			return nil
		}
		if err := json.Unmarshal(payload, &out); err != nil {
			return base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
		}
		return nil
	})
	return out, err
}

func (b *Binance) withSignature(values url.Values) url.Values {
	b.syncServerTimeOffsetBestEffort()

	out := cloneValues(values)
	out.Set("timestamp", strconv.FormatInt(b.currentTimestampMillis(), 10))
	if _, ok := out["recvWindow"]; !ok && b.recvWindow > 0 {
		out.Set("recvWindow", strconv.FormatInt(b.recvWindow, 10))
	}
	signature := buildHMACSHA256Hex(b.apiSecret, out.Encode())
	out.Set("signature", signature)
	return out
}

func (b *Binance) currentTimestampMillis() int64 {
	return time.Now().UnixMilli() + atomic.LoadInt64(&b.serverTimeOffsetMillis)
}

func (b *Binance) syncServerTimeOffsetBestEffort() {
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

func (b *Binance) fetchServerTimeOffsetMillis() (int64, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(b.baseURL, "/")+"/api/v3/time", nil)
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
		return 0, classifyBinanceError(resp.StatusCode, "/api/v3/time", payload)
	}

	root := map[string]any{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("decode server time response: %v", err)}
	}

	serverMillis := int64(floatFromAny(root["serverTime"]))
	if serverMillis <= 0 {
		return 0, base.ExchangeError{Message: "binance server time missing"}
	}

	return serverMillis - time.Now().UnixMilli(), nil
}
