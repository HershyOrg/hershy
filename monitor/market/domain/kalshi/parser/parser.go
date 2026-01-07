package parser

import (
	"monitor/market/repository/model"
	"time"
)
type KalshiMarketResponse struct {
    Markets []KalshiMarketRaw `json:"markets"`
    Cursor  string            `json:"cursor"`
}
// TODO : SettlementTs, createTime 삭제요망
type KalshiMarketRaw struct {
    ID           string `json:"id"` 
    Ticker       string `json:"ticker"`
    Title        string `json:"title"`
    Category     string `json:"category"`
    Status       string `json:"status"`
    OpenTime     string `json:"open_time"`
    CloseTime    string `json:"close_time"`
    LastPrice    float64 `json:"last_price"`
    YesAsk       float64 `json:"yes_ask"`
    NoAsk        float64 `json:"no_ask"`
    Volume       float64 `json:"volume"`
    OpenInterest float64 `json:"open_interest"`
    SettlementTs string `json:"settlement_ts"`
}

func ParseKalshiMarket(r KalshiMarketRaw) (model.KalshiMarket, error) {
    openTime, _ := time.Parse(time.RFC3339, r.OpenTime)
    closeTime, _ := time.Parse(time.RFC3339, r.CloseTime)
    settlement, _ := time.Parse(time.RFC3339, r.SettlementTs)

    return model.KalshiMarket{
        ID:           r.ID,
        Ticker:       r.Ticker,
        Title:        r.Title,
        Category:     r.Category,
        Status:       r.Status,
        OpenTime:     openTime,
        CloseTime:    closeTime,
        LastPrice:    r.LastPrice,
        YesAsk:       r.YesAsk,
        NoAsk:        r.NoAsk,
        Volume:       r.Volume,
        OpenInterest: r.OpenInterest,
        SettlementTs: settlement,
    }, nil
}
