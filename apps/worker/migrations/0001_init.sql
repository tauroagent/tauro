-- Markets come from src/universe.json; this table mirrors it so SQL can join on it.
CREATE TABLE markets (
  symbol        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token         TEXT NOT NULL,
  feed          TEXT NOT NULL,
  feed_decimals INTEGER NOT NULL,
  heartbeat_sec INTEGER NOT NULL
);

-- One Chainlink close per market per hour: the last round updated before the hour ended.
-- Rows are insert-only. A close is never rewritten after it is stored.
CREATE TABLE price_hourly (
  symbol     TEXT NOT NULL,
  hour       INTEGER NOT NULL,       -- unix seconds, start of the hour
  round_id   TEXT,                   -- uint80 as decimal string
  answer     TEXT,                   -- raw int256 as decimal string
  price      REAL,                   -- answer / 10^decimals
  updated_at INTEGER,                -- round's updatedAt
  status     TEXT NOT NULL,          -- ok | no_round | read_error
  read_at    INTEGER NOT NULL,
  PRIMARY KEY (symbol, hour)
);
CREATE INDEX price_hourly_hour ON price_hourly (hour);

-- One row per hour the ingester ran, including failed runs.
CREATE TABLE ingest_runs (
  hour        INTEGER PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  ok          INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
