package main

import "time"

func floorToHourMs(tMs int64) int64 {
	return (tMs / 3_600_000) * 3_600_000
}

func msToUTCStr(tMs int64) string {
	return time.UnixMilli(tMs).UTC().Format("2006-01-02 15:04:05")
}

func msToETStr(tMs int64, loc *time.Location) string {
	if loc == nil {
		loc = time.FixedZone("ET", -5*60*60)
	}
	return time.UnixMilli(tMs).In(loc).Format("2006-01-02 15:04:05 ET")
}

func gapValue(prob float64, mid *float64) *float64 {
	if mid == nil {
		return nil
	}
	v := prob - *mid
	return &v
}

func applyFillToPosition(pos *Position, fill *FillResult) {
	if pos == nil || fill == nil {
		return
	}
	prevShares := pos.Shares
	pos.Shares += fill.Shares
	pos.CostUSDC += fill.USDC
	if fill.AvgPrice == nil || fill.Shares <= 0 {
		return
	}
	if prevShares > 0 && pos.EntryPrice != nil {
		v := ((*pos.EntryPrice * prevShares) + (*fill.AvgPrice * fill.Shares)) / (prevShares + fill.Shares)
		pos.EntryPrice = &v
		return
	}
	pos.EntryPrice = fill.AvgPrice
}
