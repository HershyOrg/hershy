CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  slug TEXT,
  active BOOLEAN NOT NULL,
  closed BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  neg_risk BOOLEAN NOT NULL,
  volume NUMERIC,
  liquidity NUMERIC
);


CREATE INDEX idx_markets_updated_at
  ON markets (updated_at DESC);
