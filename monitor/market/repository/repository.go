package repository

import (
	"context"
	"fmt"
	"monitor/market/repository/model"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)
type pgxRows interface {
    Next() bool
    Close()
    Scan(dest ...interface{}) error
    Err() error
}
var _ pgxRows = (pgx.Rows)(nil)

type Repository interface {
    // Polymarket
    GetLastUpdatedPolymarket(ctx context.Context) (time.Time, error)
    UpsertPolymarket(ctx context.Context, m model.PolyMarket) error
    ListPolymarkets(ctx context.Context, limit, offset int) ([]model.PolyMarket, error)


    // Kalshi
    GetLastUpdatedKalshi(ctx context.Context) (time.Time, error)
    UpsertKalshi(ctx context.Context, m model.KalshiMarket) error
    ListKalshimarkets(ctx context.Context, limit, offset int) ([]model.KalshiMarket, error)

    //Opinion
    UpsertOpinion(ctx context.Context, m model.OpinionMarket) error
}


type pgRepository struct {
    db *pgxpool.Pool
}

func NewPGRepository(db *pgxpool.Pool) Repository {
    return &pgRepository{db: db}
}

// Polymarket
func (r *pgRepository) GetLastUpdatedPolymarket(ctx context.Context) (time.Time, error) {
    var t time.Time
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    err := r.db.QueryRow(ctx, `
        SELECT COALESCE(MAX(updated_at), '0001-01-01T00:00:00Z')
        FROM market_polymarket
    `).Scan(&t)
    if err != nil {
        return time.Time{}, err
    }
    return t, nil
}

func (r *pgRepository) UpsertPolymarket(ctx context.Context, m model.PolyMarket) error {
    ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
    defer cancel()
    const upsertMarketSQL = `
        INSERT INTO market_polymarket (
            id, question, slug,
            active, closed,
            volume, liquidity,
            updated_at, created_at,
            neg_risk,
            yes_price, no_price, last_trade_price, accepting_orders, end_date, outcomes
        )
        VALUES (
            $1,$2,$3,
            $4,$5,
            $6,$7,
            $8,$9,
            $10,
            $11,$12,$13,$14,$15,$16
        )
        ON CONFLICT (id) DO UPDATE SET
            question          = EXCLUDED.question,
            slug              = EXCLUDED.slug,
            active            = EXCLUDED.active,
            closed            = EXCLUDED.closed,
            volume            = EXCLUDED.volume,
            liquidity         = EXCLUDED.liquidity,
            updated_at        = EXCLUDED.updated_at,
            neg_risk          = EXCLUDED.neg_risk,
            yes_price         = EXCLUDED.yes_price,
            no_price          = EXCLUDED.no_price,
            last_trade_price  = EXCLUDED.last_trade_price,
            accepting_orders  = EXCLUDED.accepting_orders,
            end_date          = EXCLUDED.end_date,
            outcomes          = EXCLUDED.outcomes
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
        m.YesPrice,
        m.NoPrice,
        m.LastTradePrice,
        m.AcceptingOrders,
        m.EndDate,
        m.Outcomes,
    )
    return err
}
func (r * pgRepository) ListPolymarkets(ctx context.Context, limit,offset int)([]model.PolyMarket,error){
    if limit <= 0 {
        limit = 100
    }
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()
    base :=  `SELECT * FROM market_polymarket`
    
    var rows pgxRows
    var err error
    rows, err = r.db.Query(ctx, base+" ORDER BY liquidity DESC NULLS LAST, updated_at DESC LIMIT $1 OFFSET $2", limit, offset)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    out := make([]model.PolyMarket, 0)

    for rows.Next() {
        var pm model.PolyMarket
        var endDate *time.Time
        var outcomes []string
        err := rows.Scan(
            &pm.ID, &pm.Question, &pm.Slug,
            &pm.Active, &pm.Closed,
            &pm.Volume, &pm.Liquidity,
            &pm.UpdatedAt, &pm.CreatedAt,
            &pm.NegRisk,
            &pm.YesPrice, &pm.NoPrice, &pm.LastTradePrice, &pm.AcceptingOrders, &endDate, &outcomes,
        )
        if err != nil {
            return nil, err
        }
        if endDate != nil {
            pm.EndDate = *endDate
        }
        pm.Outcomes = outcomes
        out = append(out, pm)
    }
    return out, nil
}





// Kalshi
func (r *pgRepository) GetLastUpdatedKalshi(ctx context.Context) (time.Time, error) {
    var t time.Time
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    err := r.db.QueryRow(ctx, `
        SELECT COALESCE(MAX(open_time), '0001-01-01T00:00:00Z')
        FROM market_kalshi
    `).Scan(&t)
    if err != nil {
        return time.Time{}, err
    }
    return t, nil
}

func (r *pgRepository) UpsertKalshi(ctx context.Context, m model.KalshiMarket) error {
    ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
    defer cancel()
    const upsertSQL = `
			INSERT INTO market_kalshi (
					external_id, ticker, title, category, status,
					open_time, close_time, last_price,
					yes_ask, no_ask, volume, open_interest, settlement_ts
			)
			VALUES (
					$1,$2,$3,$4,$5,
					$6,$7,$8,
					$9,$10,$11,$12,$13
			)
			ON CONFLICT (ticker) DO UPDATE SET
					external_id = EXCLUDED.external_id,
					title = EXCLUDED.title,
					category = EXCLUDED.category,
					status = EXCLUDED.status,
					open_time = EXCLUDED.open_time,
					close_time = EXCLUDED.close_time,
					last_price = EXCLUDED.last_price,
					yes_ask = EXCLUDED.yes_ask,
					no_ask = EXCLUDED.no_ask,
					volume = EXCLUDED.volume,
					open_interest = EXCLUDED.open_interest,
					settlement_ts = EXCLUDED.settlement_ts
			WHERE market_kalshi.status <> 'closed';
			`
		// fmt.Printf("[repo] upsert attempt kalshi ticker=%s external_id=%s\n", m.Ticker, m.ID)

    _, err := r.db.Exec(
        ctx, upsertSQL,
        m.ID, 
        m.Ticker, m.Title, m.Category, m.Status,
        m.OpenTime, m.CloseTime, m.LastPrice,
        m.YesAsk, m.NoAsk, m.Volume, m.OpenInterest, m.SettlementTs,
    )
		if err != nil {
						fmt.Printf("[repo] upsert error kalshi ticker=%s err=%v\n", m.Ticker, err)
						return err
				}
    // fmt.Printf("[repo] upsert ok kalshi ticker=%s rowsAffected=%d tag=%s\n", m.Ticker, ct.RowsAffected(), ct)
    return nil
}
func (r *pgRepository) ListKalshimarkets(ctx context.Context, limit, offset int) ([]model.KalshiMarket, error) {
    if limit <= 0 {
        limit = 100
    }
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()

    base := `
    SELECT external_id, ticker, title, category, status,
        open_time, close_time, last_price,
        yes_ask, no_ask, volume, open_interest, settlement_ts
    FROM market_kalshi
`
    var rows pgxRows
    var err error
    rows, err = r.db.Query(ctx, base+" ORDER BY volume DESC NULLS LAST, open_time DESC LIMIT $1 OFFSET $2", limit, offset)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    out := make([]model.KalshiMarket, 0)
    for rows.Next() {
        var km model.KalshiMarket
        var openTime, closeTime, settlement *time.Time
        err := rows.Scan(
            &km.ID, &km.Ticker, &km.Title, &km.Category, &km.Status,
            &openTime, &closeTime, &km.LastPrice,
            &km.YesAsk, &km.NoAsk, &km.Volume, &km.OpenInterest, &settlement,
        )
        if err != nil {
            return nil, err
        }
        if openTime != nil {
            km.OpenTime = *openTime
        }
        if closeTime != nil {
            km.CloseTime = *closeTime
        }
        if settlement != nil {
            km.SettlementTs = *settlement
        }
        out = append(out, km)
    }
    if err := rows.Err(); err != nil {
        return nil, err
    }
    return out, nil
}

// Opinion
func(r *pgRepository) UpsertOpinion(ctx context.Context, m model.OpinionMarket) error{
    ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
    defer cancel()
    const upsertSQL = `
    INSERT INTO market_opinion (
        market_id, title, status, yes_token_id, no_token_id,
        volume_24h, volume_7d, cutoff_at, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (market_id) DO UPDATE SET
        title       = EXCLUDED.title,
        status      = EXCLUDED.status,
        yes_token_id= EXCLUDED.yes_token_id,
        no_token_id = EXCLUDED.no_token_id,
        volume_24h  = EXCLUDED.volume_24h,
        volume_7d   = EXCLUDED.volume_7d,
        cutoff_at   = EXCLUDED.cutoff_at;
    `
    _, err := r.db.Exec(
        ctx, upsertSQL,
        m.MarketID,
        m.Title,
        m.Status,
        m.YesTokenID,
        m.NoTokenID,
        m.Volume24h,
        m.Volume7d,
        m.CutoffAt,
        m.CreatedAt,
    )
	if err != nil {
        fmt.Printf("[repo] upsert error opinion market_id=%v err=%v\n", m.MarketID, err)
        return err
    }
    // fmt.Printf("[repo] upsert ok kalshi ticker=%s rowsAffected=%d tag=%s\n", m.Ticker, ct.RowsAffected(), ct)
    return nil
}
