package parser

import (
	"monitor/market/repository/model"
	"strconv"
	"time"
)
type OpinionMarketResponseRaw struct {
	Data []OpinionMarketResponse `json:"data"`
	Meta Meta               `json:"meta"`
}

type Meta struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	TotalPages int `json:"totalPages"`
}
type OpinionMarketResponse struct {
	MarketID    int64  `json:"marketId"`
	MarketTitle string `json:"marketTitle"`
	StatusEnum  string `json:"statusEnum"`

	YesTokenID string `json:"yesTokenId"`
	NoTokenID  string `json:"noTokenId"`

	Volume   string `json:"volume"`
	Volume24h string `json:"volume24h"`
	Volume7d  string `json:"volume7d"`

	CreatedAt int64 `json:"createdAt"`
	CutoffAt  int64 `json:"cutoffAt"`
}

func (r OpinionMarketResponse) ParseOpinionMarket() (*model.OpinionMarket, error) {
	vol24h, _ := strconv.ParseFloat(r.Volume24h, 64)
	vol7d, _ := strconv.ParseFloat(r.Volume7d, 64)

	return &model.OpinionMarket{
		MarketID:  r.MarketID,
		Title:     r.MarketTitle,
		Status:    r.StatusEnum,
		YesTokenID: r.YesTokenID,
		NoTokenID:  r.NoTokenID,
		Volume24h: vol24h,
		Volume7d:  vol7d,
		CutoffAt:  time.Unix(r.CutoffAt, 0),
		CreatedAt: time.Unix(r.CreatedAt, 0),
	}, nil
}
