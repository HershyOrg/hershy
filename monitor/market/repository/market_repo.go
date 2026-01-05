package repository

import (
	"context"
	"monitor/market/repository/model"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type MarketRepository struct {
	db *pgxpool.Pool
}
func (r *MarketRepository) GetLastUpdatedAt(ctx context.Context) (time.Time, error) {
	var t time.Time

	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(MAX(updated_at), '0001-01-01T00:00:00Z')
		FROM market_polymarket
	`).Scan(&t)

	if err != nil {
		return time.Time{}, err
	}

	return t, nil
}


func (r *MarketRepository) Upsert(ctx context.Context, m model.Market) error {
	const upsertMarketSQL = `
		INSERT INTO market_polymarket (
			id, question, slug,
			active, closed,
			volume, liquidity,
			updated_at, created_at,
			neg_risk
		)
		VALUES (
			$1,$2,$3,
			$4,$5,
			$6,$7,
			$8,$9,
			$10
		)
		ON CONFLICT (id) DO UPDATE SET
			question   = EXCLUDED.question,
			slug       = EXCLUDED.slug,
			active     = EXCLUDED.active,
			closed     = EXCLUDED.closed,
			volume     = EXCLUDED.volume,
			liquidity  = EXCLUDED.liquidity,
			updated_at = EXCLUDED.updated_at,
			neg_risk   = EXCLUDED.neg_risk
		WHERE market_polymarket.updated_at < EXCLUDED.updated_at;
		`

	_, err := r.db.Exec(
		ctx, upsertMarketSQL,
		m.ID,
		m.Question,
		m.Slug,
		m.Active,
		m.Closed,
		m.Volume,
		m.Liquidity,
		m.UpdatedAt,
		m.CreatedAt,
		m.NegRisk,
	)

	return err
}

func NewMarketRepository(db *pgxpool.Pool) *MarketRepository{
	return &MarketRepository{db:db}
}