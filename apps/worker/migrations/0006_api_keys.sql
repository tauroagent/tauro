-- Read API keys for TAURO holders. One key per wallet; only its hash is stored.
-- tier follows the wallet's TAURO balance, re-read on chain at most once an hour.
CREATE TABLE api_keys (
  address    TEXT PRIMARY KEY,
  key_hash   TEXT NOT NULL UNIQUE,
  sig_hash   TEXT NOT NULL UNIQUE,
  tier       TEXT NOT NULL,
  balance    TEXT,
  checked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
