package model

import "time"

type Market struct {
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
}
