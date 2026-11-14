-- Every leaf of a sealed hour, with the exact record it commits to, so anyone can rebuild it.
CREATE TABLE leaves (
  hour    INTEGER NOT NULL,
  leaf    TEXT NOT NULL,       -- 0x hash
  kind    INTEGER NOT NULL,    -- LeafKind from packages/seal
  subject TEXT NOT NULL,
  record  TEXT NOT NULL,       -- canonical JSON hashed into the leaf
  PRIMARY KEY (hour, leaf)
);
CREATE INDEX leaves_subject ON leaves (subject, hour);

-- One row per hour: built locally, then sent to SealRegistry.
-- status: built | sent | confirmed | failed | missed
CREATE TABLE seals (
  hour         INTEGER PRIMARY KEY,
  root         TEXT NOT NULL,
  leaf_count   INTEGER NOT NULL,
  prev_root    TEXT,
  status       TEXT NOT NULL,
  tx_hash      TEXT,
  block_number INTEGER,
  block_time   INTEGER,
  timing       TEXT,           -- on_time | late (from block_time)
  error        TEXT,
  built_at     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
