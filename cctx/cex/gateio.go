package cex

import (
	"github.com/HershyOrg/hershy/cctx/base"
	gateiopkg "github.com/HershyOrg/hershy/cctx/cex/gateio"
)

const GateIOBaseURL = gateiopkg.GateIOBaseURL

type GateIO = gateiopkg.GateIO

func NewGateIO(config map[string]any) (base.Exchange, error) {
	return gateiopkg.NewGateIO(config)
}
