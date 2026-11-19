-- Sealed calls: anyone signs a call on a stock token (up or down within a horizon). It is a leaf in the
-- next hourly root on Robinhood Chain. Entry is that hour's close; the result is read at entry + horizon.
CREATE TABLE calls (
  id           TEXT PRIMARY KEY,
  caller       TEXT NOT NULL,
  market       TEXT NOT NULL,
  side         TEXT NOT NULL,          -- up | down
  horizon      INTEGER NOT NULL,       -- hours
  note         TEXT NOT NULL,
  issued       TEXT NOT NULL,
  message      TEXT NOT NULL,          -- the exact text the wallet signed
  signature    TEXT NOT NULL,
  sig_hash     TEXT NOT NULL UNIQUE,
  submitted_at INTEGER NOT NULL,
  hour         INTEGER NOT NULL        -- the hour whose root seals this call
);
CREATE INDEX calls_caller ON calls (caller, submitted_at);
CREATE INDEX calls_hour ON calls (hour);
