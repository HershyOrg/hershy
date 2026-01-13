package cmd

import (
	"context"
	"log"
	"sync"

	kalshiService "monitor/market/domain/kalshi/service"
	polyService "monitor/market/domain/polymarket/service"

	"github.com/jackc/pgx/v5/pgxpool"
)



func kalshiRun(ctx context.Context, db *pgxpool.Pool) error {
    log.Printf("[cmd] kalshiRun start")
    err := kalshiService.SyncKalshiMarkets(ctx, db)
    if err != nil {
        log.Printf("[cmd] kalshiRun error: %v", err)
    } else {
        log.Printf("[cmd] kalshiRun done")
    }
    return err
}
func polymarketRun(ctx context.Context, db *pgxpool.Pool) error {
    log.Printf("[cmd] polymarketRun start")
    err := polyService.SyncPolyMarkets(ctx, db)
    if err != nil {
        log.Printf("[cmd] polymarketRun error: %v", err)
    } else {
        log.Printf("[cmd] polymarketRun done")
    }
    return err
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