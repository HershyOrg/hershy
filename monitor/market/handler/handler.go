package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"monitor/market/service"
)

type MarketHandlers struct {
    svc service.MarketService
}

func NewMarketHandlers(svc service.MarketService) *MarketHandlers {
    return &MarketHandlers{svc: svc}
}

func (h *MarketHandlers) Register(mux *http.ServeMux) {
    mux.HandleFunc("/polymarkets", h.handleListPolymarkets)
    mux.HandleFunc("/kalshimarkets", h.handleListKalshimarkets)
}

func (h *MarketHandlers) parseLimitOffset(r *http.Request) (int, int) {
    limit := 100
    offset := 0
    if v := r.URL.Query().Get("limit"); v != "" {
        if n, err := strconv.Atoi(v); err == nil && n > 0 {
            limit = n
        }
    }
    if v := r.URL.Query().Get("offset"); v != "" {
        if n, err := strconv.Atoi(v); err == nil && n >= 0 {
            offset = n
        }
    }
    return limit, offset
}

func (h *MarketHandlers) handleListPolymarkets(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    limit, offset := h.parseLimitOffset(r)
    markets, err := h.svc.ListPolymarkets(ctx, limit, offset)
    if err != nil {
        http.Error(w, fmt.Sprintf("list polymarkets error: %v", err), http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(markets)
}

func (h *MarketHandlers) handleListKalshimarkets(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    limit, offset := h.parseLimitOffset(r)
    markets, err := h.svc.ListKalshimarkets(ctx, limit, offset)
    if err != nil {
        http.Error(w, fmt.Sprintf("list kalshimarkets error: %v", err), http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(markets)
}