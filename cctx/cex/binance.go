package cex

import (
	"github.com/HershyOrg/hershy/cctx/base"
	binancepkg "github.com/HershyOrg/hershy/cctx/cex/binance"
)

const BinanceBaseURL = binancepkg.BinanceBaseURL

type Binance = binancepkg.Binance

func NewBinance(config map[string]any) (base.Exchange, error) {
	return binancepkg.NewBinance(config)
}
