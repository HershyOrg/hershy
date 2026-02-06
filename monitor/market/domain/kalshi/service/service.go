package service

import (
	"context"
	"fmt"
	"time"

	"github.com/HershyOrg/hershy/monitor/market/domain/kalshi/api"
	"github.com/HershyOrg/hershy/monitor/market/domain/kalshi/parser"

	"github.com/HershyOrg/hershy/monitor/market/repository"

	"github.com/jackc/pgx/v5/pgxpool"
)



func SyncKalshiMarkets(ctx context.Context, db *pgxpool.Pool) error {
	repo := repository.NewPGRepository(db)
	client := api.NewClient("https://api.elections.kalshi.com/trade-api/v2/markets", nil)
	cursor := ""

	for {
		res, err := client.FetchMarkets(ctx, cursor, 1000, "open", time.Now().Unix())
    if err != nil {
        return err
    }

    if len(res.Markets) == 0 {
        break
    }

		for _, raw := range res.Markets {
			

			mkt, err := parser.ParseKalshiMarket(raw)
			if err != nil {
					fmt.Printf("[error] parse failed market_id=%s err=%v\n", raw.ID, err)
					continue
			}
			// fmt.Printf("[kalshi] parsed id=%s status=%s open_time=%v\n", mkt.ID, mkt.Status, mkt.OpenTime)

			if err := repo.UpsertKalshi(ctx, mkt); err != nil {
					fmt.Printf("[error] upsert failed market_id=%s err=%v\n", mkt.ID, err)
			}
		}

		if res.Cursor == "" {
			break
		}
		cursor = res.Cursor
		timer := time.NewTimer(300 * time.Millisecond)
		select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
		}
	}

	return nil
}
