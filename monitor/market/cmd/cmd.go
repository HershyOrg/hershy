package cmd

import (
	"context"
	"sync"

	kalshiService "monitor/market/domain/kalshi/service"
	polyService "monitor/market/domain/polymarket/service"

	"github.com/jackc/pgx/v5/pgxpool"
)



func kalshiRun(ctx context.Context, db *pgxpool.Pool) error {
	return kalshiService.SyncKalshiMarkets(ctx, db)
}
func polymarketRun(ctx context.Context, db *pgxpool.Pool) error {
	return polyService.SyncPolyMarkets(ctx, db)
}

func RunBothConcurrent(ctx context.Context, db *pgxpool.Pool) error {
    var wg sync.WaitGroup
    errCh := make(chan error, 2)

    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := kalshiRun(ctx, db); err != nil {
            errCh <- err
        }
    }()

    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := polymarketRun(ctx, db); err != nil {
            errCh <- err
        }
    }()

    wg.Wait()
    close(errCh)
    for e := range errCh {
        return e
    }
    return nil
}