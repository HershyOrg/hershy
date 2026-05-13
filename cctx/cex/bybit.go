package cex

import (
	"github.com/HershyOrg/hershy/cctx/base"
	bybitpkg "github.com/HershyOrg/hershy/cctx/cex/bybit"
)

const BybitBaseURL = bybitpkg.BybitBaseURL

type Bybit = bybitpkg.Bybit

func NewBybit(config map[string]any) (base.Exchange, error) {
	return bybitpkg.NewBybit(config)
}
