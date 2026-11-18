-- Holder agents: a TAURO holder's own paper agent, started with a wallet signature.
-- queued: waiting for its first hour (or for a slot). active: runs this hour. paused: was running, no slot now. retired: stopped by its owner.
CREATE TABLE launches (
  agent         TEXT PRIMARY KEY,
  owner         TEXT NOT NULL,
  template      TEXT NOT NULL,
  market        TEXT NOT NULL,
  rules         TEXT NOT NULL,          -- canonical JSON
  config_hash   TEXT NOT NULL,
  requested_at  INTEGER NOT NULL,
  message       TEXT NOT NULL,          -- the exact text the wallet signed
  signature     TEXT NOT NULL,
  sig_hash      TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL,
  status_reason TEXT,
  status_hour   INTEGER
);
CREATE INDEX launches_owner ON launches (owner);

-- TAURO sent to 0x…dEaD, read from chain. Each full 1,000,000 TAURO adds one slot for 30 days.
CREATE TABLE burns (
  tx_hash      TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  amount       TEXT NOT NULL,           -- wei, decimal string
  block_number INTEGER NOT NULL,
  block_time   INTEGER NOT NULL,
  slots        INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  recorded_at  INTEGER NOT NULL
);
CREATE INDEX burns_owner ON burns (owner);

-- What the hourly run saw for each holder: balance and slots.
CREATE TABLE holder_checks (
  owner   TEXT NOT NULL,
  hour    INTEGER NOT NULL,
  balance TEXT,                         -- NULL when the read failed
  slots   INTEGER,
  PRIMARY KEY (owner, hour)
);
