package service

import (
	"encoding/json"
	"monitor/market/polymarket/api"
	"monitor/market/polymarket/parser"
	"monitor/market/polymarket/store"
	"os"
	"time"
)

type Crawler struct {
	Limit          int
	CheckpointPath string
	OutputPath     string
}

func (c *Crawler) Run() error {
	lastCheckpoint, err := store.Load(c.CheckpointPath)
	if err != nil {
		return err
	}

	out, err := os.OpenFile(c.OutputPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer out.Close()

	offset := 0
	maxUpdated := lastCheckpoint

	for {
		active := true
		closed := false
		q := api.MarketQuery{
			Active:    &active,
			Closed:    &closed,
			Limit:     c.Limit,
			Offset:    offset,
			Order:     "updatedAt",
			Ascending: false,
		}

		markets, err := api.FetchMarkets(q)
		if err != nil {
			return err
		}
		if len(markets) == 0 {
			break
		}

		stop := false

		for _, m := range markets {
			t, err := time.Parse(time.RFC3339Nano, m.UpdatedAt)
			if err != nil {
				continue
			}

			if !t.After(lastCheckpoint) {
				stop = true
				break
			}

			if err := writeJSONL(out, m); err != nil {
				return err
			}


			if t.After(maxUpdated) {
				maxUpdated = t
				store.Save(c.CheckpointPath, maxUpdated)
			}
		}

		if stop {
			break
		}

		offset += c.Limit
		time.Sleep(300 * time.Millisecond)
	}

	return store.Save(c.CheckpointPath, maxUpdated)
}
func writeJSONL(f *os.File, m parser.Market) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = f.Write(append(data, '\n'))
	return err
}

