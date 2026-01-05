package service

import (
	"context"
	"log"
	"time"

	"monitor/market/polymarket/api"
	"monitor/market/polymarket/parser"
	"monitor/market/repository"

	"github.com/jackc/pgx/v5/pgxpool"
)

func SyncPolyMarkets(ctx context.Context, db *pgxpool.Pool) error {
	repo := repository.NewPGRepository(db)

	// 마지막 업데이트 시간 조회
	lastUpdated, err := repo.GetLastUpdatedPolymarket(ctx)
	if err != nil {
		return err
	}

	log.Printf("[sync] lastUpdatedAt = %s\n", lastUpdated.Format(time.RFC3339Nano))

	const limit = 100
	offset := 0
	
	for {
		q := api.MarketQuery{
			Active:        ptr(true),
			Closed:        ptr(false),
			Limit:         limit,
			Offset:        offset,
			Order:         "updatedAt",
			Ascending:     false,
			UpdatedAfter:  ptr(lastUpdated.Format(time.RFC3339Nano)),
		}
		raws, err := api.FetchMarkets(q)
		if err != nil{
			return err
		}
		log.Printf(
			"[sync] fetched=%d offset=%d",
			len(raws), offset,
		)

		if len(raws) == 0 {
			break
		}
		stop := false
			// 파싱 + 업서트
		for _, r := range raws {
			t,err := time.Parse(time.RFC3339Nano,r.UpdatedAt)
			if err != nil {
				continue
			}
			// 증분 종료
			if !t.After(lastUpdated){
				log.Printf(
					"[sync] stop at updatedAt=%s (<= %s)",
					t, lastUpdated,
				)
				stop = true
				break
			}
			m, err := parser.ParseMarket(r)
			if err != nil {
				log.Printf("[skip] parse error market_id=%s err=%v\n", r.ID, err)
				continue
			}

			if err := repo.UpsertPolymarket(ctx, m); err != nil {
				log.Printf("[error] upsert failed market_id=%s err=%v\n", m.ID, err)
				return err
			}
		}
		if stop{
			break
		}
		offset += limit
		time.Sleep(200 * time.Microsecond)
	}

	log.Printf("[sync] completed successfully\n")
	return nil
}
func ptr[T any](v T) *T {
	return &v
}
