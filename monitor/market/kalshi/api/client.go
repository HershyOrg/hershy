package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"monitor/market/kalshi/parser"
)

type Client struct {
    baseURL    string
    httpClient *http.Client
}

func NewClient(baseURL string, httpClient *http.Client) *Client {
    if httpClient == nil {
        httpClient = &http.Client{Timeout: 10 * time.Second}
    }
    return &Client{baseURL: baseURL, httpClient: httpClient}
}


func (c *Client) FetchMarkets(ctx context.Context, cursor string, limit int, status string, minCloseTs int64) (parser.KalshiMarketResponse, error) {
    var out parser.KalshiMarketResponse

    u, err := url.Parse(c.baseURL)
    if err != nil {
        return out, err
    }
    params := url.Values{}
    if limit <= 0 {
        limit = 100
    }
    params.Set("limit", strconv.Itoa(limit))
    if status != "" {
        params.Set("status", status)
    }
    if minCloseTs > 0 {
        params.Set("min_close_ts", strconv.FormatInt(minCloseTs, 10))
    }
    if cursor != "" {
        params.Set("cursor", cursor)
    }
    u.RawQuery = params.Encode()
		// fmt.Printf("[kalshi client] GET %s\n", u.String())
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
    if err != nil {
        return out, err
    }

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return out, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return out, fmt.Errorf("unexpected status %d", resp.StatusCode)
    }

    if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
        return out, err
    }
		fmt.Printf("[kalshi client] got %d markets, cursor=%q\n", len(out.Markets), out.Cursor)
    return out, nil
}
