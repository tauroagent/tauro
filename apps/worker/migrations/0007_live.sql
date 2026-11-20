-- The public real-money wallet (src/live.ts). One row per acted-on decision of the mirrored agent, per mode.
-- status: filled | blocked (price gate) | skipped (cap, halt, nothing to do) | failed (tx reverted).
-- record: the full order as sealed in a Fill leaf of the hour it was created (created_hour).
CREATE TABLE live_orders (
  hour         INTEGER NOT NULL,   -- the decision's hour
  mode         TEXT NOT NULL,      -- dry_run | live
  action       TEXT NOT NULL,
  status       TEXT NOT NULL,
  reason       TEXT,
  usd_in       REAL,
  tx_hash      TEXT,
  cash_after   REAL NOT NULL,
  qty_after    REAL NOT NULL,
  equity_after REAL,
  created_at   INTEGER NOT NULL,
  created_hour INTEGER NOT NULL,
  record       TEXT NOT NULL,
  PRIMARY KEY (hour, mode)
);
CREATE INDEX live_orders_created ON live_orders (created_hour);
CREATE TABLE live_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
