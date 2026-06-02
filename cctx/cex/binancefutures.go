package cex

import (
	"github.com/HershyOrg/hershy/cctx/base"
	binancefuturespkg "github.com/HershyOrg/hershy/cctx/cex/binancefutures"
)

const BinanceFuturesBaseURL = binancefuturespkg.BinanceFuturesBaseURL

type BinanceFutures = binancefuturespkg.BinanceFutures

func NewBinanceFutures(config map[string]any) (base.Exchange, error) {
	return binancefuturespkg.NewBinanceFutures(config)
}
