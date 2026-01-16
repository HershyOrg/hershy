package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	parser "monitor/market/domain/opinion/parser"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type MarketQueryParams struct {
	Page       int
	Limit      int
	Status     string // activated | resolved
	// MarketType int    // 0=binary
	// SortBy     int    // 5=volume24h desc
	//ChainID    string
}
type Client struct {
	BaseURL string
	APIKey  string
	Client  *http.Client
}

func NewClient(baseURL string,apiKey string) *Client {
	return &Client{
		BaseURL:baseURL,
		APIKey:  apiKey,
		Client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) FetchMarkets(
	ctx context.Context,
	params MarketQueryParams,
) (*parser.OpinionMarketResponseRaw, error) {

	u, _ := url.Parse(c.BaseURL)
	q := u.Query()

	q.Set("page", strconv.Itoa(params.Page))
	q.Set("limit", strconv.Itoa(params.Limit))

	if params.Status != "" {
		q.Set("status", params.Status)
	}

	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}


	req.Header.Add("Apikey", c.APIKey)
	req.Header.Set("Accept", "*/*")
	log.Printf("[opinion] request GET %s headers=%v", req.URL.String(), req.Header)

	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
    log.Printf("[opinion] response status=%s headers=%v body=%s", resp.Status, resp.Header, string(bodyBytes))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("opinion api error: %s body=%s", resp.Status, string(bodyBytes))
	}

	var result parser.OpinionMarketResponseRaw
	if err := json.Unmarshal(bodyBytes, &result); err != nil || len(result.Data) == 0 {
        var wrapper struct {
            Result struct {
                Total int             `json:"total"`
                List  json.RawMessage `json:"list"`
            } `json:"result"`
        }
        if err2 := json.Unmarshal(bodyBytes, &wrapper); err2 != nil {
            if err != nil {
                return nil, err
            }
            return nil, err2
        }
        if err3 := json.Unmarshal(wrapper.Result.List, &result.Data); err3 != nil {
            return nil, err3
        }
				result.Meta.TotalPages = wrapper.Result.Total
    }

	return &result, nil
}
