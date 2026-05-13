package cex

import (
	"github.com/HershyOrg/hershy/cctx/base"
	okxpkg "github.com/HershyOrg/hershy/cctx/cex/okx"
)

const OKXBaseURL = okxpkg.OKXBaseURL

type OKX = okxpkg.OKX

func NewOKX(config map[string]any) (base.Exchange, error) {
	return okxpkg.NewOKX(config)
}
