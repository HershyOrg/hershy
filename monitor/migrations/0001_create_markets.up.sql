-- CREATE TABLE IF NOT EXISTS market_polymarket (
--   id TEXT PRIMARY KEY,
--   question TEXT NOT NULL,
--   slug TEXT,
--   active BOOLEAN NOT NULL,
--   closed BOOLEAN NOT NULL,
--   updated_at TIMESTAMPTZ NOT NULL,
--   created_at TIMESTAMPTZ NOT NULL,
--   neg_risk BOOLEAN NOT NULL,
--   volume NUMERIC,
--   liquidity NUMERIC
-- );
CREATE TABLE IF NOT EXISTS market_polymarket (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    slug TEXT,
    active BOOLEAN NOT NULL,
    closed BOOLEAN NOT NULL,
    volume NUMERIC,
    liquidity NUMERIC,
    updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    neg_risk BOOLEAN NOT NULL,
    yes_price NUMERIC,
    no_price NUMERIC,
    last_trade_price NUMERIC,
    accepting_orders BOOLEAN,
    end_date TIMESTAMPTZ,
    outcomes TEXT[]
);

CREATE TABLE IF NOT EXISTS market_kalshi (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT,
    ticker TEXT UNIQUE,
    title TEXT,
    category TEXT,
    status TEXT,
    open_time TIMESTAMPTZ,
    close_time TIMESTAMPTZ,
    last_price NUMERIC,
    yes_ask NUMERIC,
    no_ask NUMERIC,
    volume NUMERIC,
    open_interest NUMERIC,
    settlement_ts TIMESTAMPTZ
);

CREATE INDEX idx_market_polymarket_updated_at
  ON market_polymarket (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_kalshi_ticker ON market_kalshi (ticker);
