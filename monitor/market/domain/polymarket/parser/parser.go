package parser

import (
	"encoding/json"
	"monitor/market/repository/model"
	"time"
)

type Market struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Slug     string `json:"slug"`

	Active bool `json:"active"`
	Closed bool `json:"closed"`

	Volume    json.Number `json:"volumeNum" db:"volume"`
	Liquidity json.Number `json:"liquidity" db:"liquidity"`

	UpdatedAt string `json:"updatedAt"`
	CreatedAt string `json:"createdAt"`

	NegRisk bool `json:"negRisk"`

	//TODO : 데이터 없음. 추후 ID를 파라미터로 요청 보내야지 얻을 수 있는 듯
	YesPrice       json.Number `json:"yes_price"`
	NoPrice        json.Number `json:"no_price"`

	LastTradePrice json.Number `json:"last_trade_price"`
	AcceptingOrders bool       `json:"accepting_orders"`
	EndDate         string     `json:"end_date"`
	Outcomes       string `json:"outcomes"` 
}

func ParseMarket(r Market) (model.PolyMarket, error) {
	updatedAt, err := time.Parse(time.RFC3339Nano, r.UpdatedAt)
	if err != nil {
		return model.PolyMarket{}, err
	}

	createdAt, err := time.Parse(time.RFC3339Nano, r.CreatedAt)
	if err != nil {
		return model.PolyMarket{}, err
	}

	volume, _ := r.Volume.Float64()
	liquidity, _ := r.Liquidity.Float64()

	yesPrice, _ := r.YesPrice.Float64()
	noPrice, _ := r.NoPrice.Float64()
	lastTradePrice, _ := r.LastTradePrice.Float64()

	var endDate time.Time
	if r.EndDate != "" {
		if t, err := time.Parse(time.RFC3339Nano, r.EndDate); err == nil {
			endDate = t
		}
	}
	var outcomes []string
	_ = json.Unmarshal([]byte(r.Outcomes), &outcomes)

	return model.PolyMarket{
		ID:             r.ID,
		Question:       r.Question,
		Slug:           r.Slug,
		Active:         r.Active,
		Closed:         r.Closed,
		Volume:         volume,
		Liquidity:      liquidity,
		UpdatedAt:      updatedAt,
		CreatedAt:      createdAt,
		NegRisk:        r.NegRisk,
		YesPrice:       yesPrice,
		NoPrice:        noPrice,
		LastTradePrice: lastTradePrice,
		AcceptingOrders: r.AcceptingOrders,
		EndDate:        endDate,
		Outcomes:       outcomes,
	}, nil
}