package main

import (
	"context"
	"errors"
	"log"
	"github.com/HershyOrg/hershy/monitor/market/cmd"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
    log.Printf("[START] CRON %s", time.Now().Format(time.RFC3339Nano))
    ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
    defer cancel()

    db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    if err := cmd.RunBothConcurrent(ctx, db); err != nil {
        if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
            log.Printf("[CRON] cancelled or deadline exceeded: %v", err)
        } else {
            log.Printf("[CRON] failed: %v", err)
        }
    }
    log.Printf("[END] CRON %s", time.Now().Format(time.RFC3339Nano))
}