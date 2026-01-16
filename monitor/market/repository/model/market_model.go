package model

import "time"

type PolyMarket struct {
	ID        string
	Question  string
	Slug      string

	Active bool
	Closed bool

	Volume    float64
	Liquidity float64

	UpdatedAt time.Time
	CreatedAt time.Time

	NegRisk bool
	YesPrice        float64
  NoPrice         float64
  LastTradePrice  float64
  AcceptingOrders bool
  EndDate         time.Time
  Outcomes        []string
}

type KalshiMarket struct {
  	ID           string    `json:"id"`
    Ticker       string    `json:"ticker"`
    Title        string    `json:"title"`
    Category     string    `json:"category"`
    Status       string    `json:"status"`
    OpenTime     time.Time `json:"open_time"`
    CloseTime    time.Time `json:"close_time"`
    LastPrice    float64   `json:"last_price"`
    YesAsk       float64   `json:"yes_ask"`
    NoAsk        float64   `json:"no_ask"`
    Volume       float64   `json:"volume"`
    OpenInterest float64   `json:"open_interest"`
    SettlementTs time.Time `json:"settlement_ts"`
		CreatedAt  string  `json:"created_time"` 
}
type OpinionMarket struct {
	MarketID    int64  `json:"market_id"`
	Title       string `json:"title"`
	Status      string `json:"status"` 
	YesTokenID string `json:"yes_token_id"`
	NoTokenID  string `json:"no_token_id"`
	Volume24h float64 `json:"volume_24h"`
	Volume7d  float64 `json:"volume_7d"`
	CutoffAt time.Time `json:"cutoff_at"`
	CreatedAt time.Time `json:"created_at"`
}