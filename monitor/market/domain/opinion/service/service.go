package service

import (
	"context"
	"fmt"
	"log"
	opinion "github.com/HershyOrg/hershy/monitor/market/domain/opinion/api"
	"github.com/HershyOrg/hershy/monitor/market/repository"
	"github.com/HershyOrg/hershy/monitor/market/repository/model"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)
func SyncOpinionMarkets(ctx context.Context, db *pgxpool.Pool) error {
    apikey := os.Getenv("OPINION_API_KEY")
    if apikey == "" {
        return fmt.Errorf("missing OPINION_API_KEY")
    }
    repo := repository.NewPGRepository(db)
		client := opinion.NewClient("https://openapi.opinion.trade/openapi/market", apikey)

    page := 1
    limit := 20

    for {
        resp, err := client.FetchMarkets(ctx, opinion.MarketQueryParams{
            Page:       page,
            Limit:      limit,
            Status:     "activated",
        })
				if err != nil {
            return err
        }
				if len(resp.Data) == 0{
					break
				}
        for _, m := range resp.Data {
						 var vol24, vol7 float64
            if m.Volume24h != "" {
                if v, err := strconv.ParseFloat(m.Volume24h, 64); err == nil {
                    vol24 = v
                }
            }
            if m.Volume7d != "" {
                if v, err := strconv.ParseFloat(m.Volume7d, 64); err == nil {
                    vol7 = v
                }
            }
            var createdAt, cutoffAt time.Time
            if m.CreatedAt != 0 {
                createdAt = time.Unix(m.CreatedAt, 0)
            }
            if m.CutoffAt != 0 {
                cutoffAt = time.Unix(m.CutoffAt, 0)
            }

            om := model.OpinionMarket{
                MarketID:   m.MarketID,
                Title:      m.MarketTitle,
                Status:     fmt.Sprintf("%v", m.StatusEnum),
                YesTokenID: m.YesTokenID,
                NoTokenID:  m.NoTokenID,
                Volume24h:  vol24,
                Volume7d:   vol7,
                CutoffAt:   cutoffAt,
                CreatedAt:  createdAt,
            }
						if err := repo.UpsertOpinion(ctx, om); err != nil {
                log.Printf("[opinion] upsert failed market_id=%v err=%v", m.MarketID, err)
            }	
					}
					if page >= resp.Meta.TotalPages {
            break
        	}
        page++
    }
    return nil
}
