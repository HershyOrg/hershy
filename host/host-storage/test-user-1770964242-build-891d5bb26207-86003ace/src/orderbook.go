package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

type BookLevel struct {
	Price float64
	Size  float64
}

type Orderbook struct {
	Bids []BookLevel
	Asks []BookLevel
}

func fetchOrderbook(clobHost, tokenID string) (Orderbook, error) {
	clobHost = strings.TrimRight(clobHost, "/")
	url := fmt.Sprintf("%s/book?token_id=%s", clobHost, tokenID)
	resp, err := http.Get(url)
	if err != nil {
		return Orderbook{}, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return Orderbook{}, err
	}
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return Orderbook{}, err
	}
	bids := parseBookLevels(raw["bids"], true)
	asks := parseBookLevels(raw["asks"], false)
	return Orderbook{Bids: bids, Asks: asks}, nil
}

func parseBookLevels(raw any, reverse bool) []BookLevel {
	items := toSlice(raw)
	levels := make([]BookLevel, 0, len(items))
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		price := toFloat(row["price"])
		size := toFloat(row["size"])
		if price > 0 && size > 0 {
			levels = append(levels, BookLevel{Price: price, Size: size})
		}
	}
	sort.Slice(levels, func(i, j int) bool {
		if reverse {
			return levels[i].Price > levels[j].Price
		}
		return levels[i].Price < levels[j].Price
	})
	return levels
}

func bestBidAsk(book Orderbook) (*float64, *float64) {
	var bid *float64
	var ask *float64
	if len(book.Bids) > 0 {
		v := book.Bids[0].Price
		bid = &v
	}
	if len(book.Asks) > 0 {
		v := book.Asks[0].Price
		ask = &v
	}
	return bid, ask
}

func midFromBidAsk(bid, ask *float64) *float64 {
	if bid == nil || ask == nil {
		return nil
	}
	v := (*bid + *ask) / 2.0
	return &v
}

func simulateMarketBuy(book Orderbook, usdcAmount float64) *FillResult {
	if usdcAmount <= 0 {
		return nil
	}
	remaining := usdcAmount
	cost := 0.0
	shares := 0.0
	worstPrice := 0.0
	for _, level := range book.Asks {
		if remaining <= 1e-12 {
			break
		}
		levelCost := level.Price * level.Size
		var fillSize, fillCost float64
		if levelCost <= remaining+1e-12 {
			fillSize = level.Size
			fillCost = levelCost
		} else {
			fillSize = remaining / level.Price
			fillCost = remaining
		}
		shares += fillSize
		cost += fillCost
		remaining -= fillCost
		worstPrice = level.Price
	}
	if shares <= 0 {
		return nil
	}
	avg := cost / shares
	partial := remaining > 1e-9
	return &FillResult{USDC: cost, Shares: shares, AvgPrice: &avg, Partial: partial, WorstPrice: worstPrice}
}

func simulateMarketSell(book Orderbook, sharesToSell float64) *FillResult {
	if sharesToSell <= 0 {
		return nil
	}
	remaining := sharesToSell
	proceeds := 0.0
	sold := 0.0
	worstPrice := 0.0
	for _, level := range book.Bids {
		if remaining <= 1e-12 {
			break
		}
		fillSize := level.Size
		if fillSize > remaining {
			fillSize = remaining
		}
		sold += fillSize
		proceeds += fillSize * level.Price
		remaining -= fillSize
		worstPrice = level.Price
	}
	if sold <= 0 {
		return nil
	}
	avg := proceeds / sold
	partial := remaining > 1e-9
	return &FillResult{USDC: proceeds, Shares: sold, AvgPrice: &avg, Partial: partial, WorstPrice: worstPrice}
}

func toFloat(value any) float64 {
	if value == nil {
		return 0
	}
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	case string:
		f := 0.0
		fmt.Sscanf(v, "%f", &f)
		return f
	default:
		return 0
	}
}
