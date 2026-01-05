package cmd

import (
	"context"

	"monitor/market/service"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Run(ctx context.Context, db *pgxpool.Pool) error {
	return service.SyncMarkets(ctx, db)
}
