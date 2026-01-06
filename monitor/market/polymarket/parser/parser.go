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
}



//추후 Tag Table 구축 후 JOIN 예정
type Tag struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
	Slug  string `json:"slug"`
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

	return model.PolyMarket{
		ID:        r.ID,
		Question:  r.Question,
		Slug:      r.Slug,
		Active:    r.Active,
		Closed:    r.Closed,
		Volume:    volume,
		Liquidity: liquidity,
		UpdatedAt: updatedAt,
		CreatedAt: createdAt,
		NegRisk:   r.NegRisk,
	}, nil
}