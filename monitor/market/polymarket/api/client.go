package api

import (
	"encoding/json"
	"net/http"
	"time"

	"monitor/market/polymarket/parser"
)

const baseURL = "https://gamma-api.polymarket.com/markets"

func FetchMarkets(q MarketQuery) ([]parser.Market, error) {
	url := q.ToURL()

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var markets []parser.Market
	if err := json.NewDecoder(resp.Body).Decode(&markets); err != nil {
		return nil, err
	}

	return markets, nil
}
