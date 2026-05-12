package main

import (
	"context"
	"time"

	"github.com/HershyOrg/hersh/shared"
)

type SimulatedMarketFeed struct {
	interval  time.Duration
	loop      bool
	snapshots []MarketSnapshot
}

func NewSimulatedMarketFeed(interval time.Duration, loop bool, snapshots []MarketSnapshot) *SimulatedMarketFeed {
	copied := make([]MarketSnapshot, len(snapshots))
	copy(copied, snapshots)
	return &SimulatedMarketFeed{
		interval:  interval,
		loop:      loop,
		snapshots: copied,
	}
}

func DefaultPepeScenario(interval time.Duration, loop bool) *SimulatedMarketFeed {
	return NewSimulatedMarketFeed(interval, loop, []MarketSnapshot{
		{PEPEPrice: 0.00000100, ETHPrice: 3000, FundingCostBps: 4, SlippageBps: 12},
		{PEPEPrice: 0.00000103, ETHPrice: 3010, FundingCostBps: 3, SlippageBps: 10},
		{PEPEPrice: 0.00000118, ETHPrice: 3025, FundingCostBps: 5, SlippageBps: 9},
		{PEPEPrice: 0.00000115, ETHPrice: 3240, FundingCostBps: 4, SlippageBps: 11},
		{PEPEPrice: 0.00000111, ETHPrice: 3210, FundingCostBps: 12, SlippageBps: 45},
		{PEPEPrice: 0.00000108, ETHPrice: 3175, FundingCostBps: 6, SlippageBps: 14},
	})
}

func (f *SimulatedMarketFeed) Stream() func(context.Context) (<-chan shared.FlowValue[MarketSnapshot], error) {
	return func(ctx context.Context) (<-chan shared.FlowValue[MarketSnapshot], error) {
		ch := make(chan shared.FlowValue[MarketSnapshot], 8)

		go func() {
			defer close(ch)

			index := 0
			sequence := 0
			for {
				if len(f.snapshots) == 0 {
					return
				}

				raw := f.snapshots[index]
				sequence++
				raw.Sequence = sequence
				raw.CapturedAt = time.Now()

				select {
				case ch <- shared.FlowValue[MarketSnapshot]{V: raw}:
				case <-ctx.Done():
					return
				}

				if !f.loop && index == len(f.snapshots)-1 {
					return
				}

				select {
				case <-time.After(f.interval):
				case <-ctx.Done():
					return
				}

				index++
				if index >= len(f.snapshots) {
					index = 0
				}
			}
		}()

		return ch, nil
	}
}
