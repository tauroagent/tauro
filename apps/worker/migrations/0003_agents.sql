-- House paper agents. Config is frozen at creation; its hash is sealed in the creation hour.
CREATE TABLE agents (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,          -- 'house' for now
  template     TEXT NOT NULL,
  market       TEXT NOT NULL,
  rules        TEXT NOT NULL,          -- canonical JSON
  config_hash  TEXT NOT NULL,
  paper        INTEGER NOT NULL DEFAULT 1,
  start_cash   REAL NOT NULL,
  created_hour INTEGER NOT NULL,
  start_price  REAL                    -- close at created_hour, the buy-and-hold baseline
);

-- Current paper book, one row per agent.
CREATE TABLE agent_state (
  agent        TEXT PRIMARY KEY,
  cash         REAL NOT NULL,
  qty          REAL NOT NULL,
  entry_price  REAL,
  opened_at    INTEGER,
  pending      TEXT,                   -- JSON {action, sizeUsd, decidedHour} or NULL
  last_hour    INTEGER NOT NULL
);

-- One decision per agent per hour. `record` is the canonical JSON sealed as a leaf.
CREATE TABLE decisions (
  agent   TEXT NOT NULL,
  hour    INTEGER NOT NULL,
  action  TEXT NOT NULL,
  record  TEXT NOT NULL,
  PRIMARY KEY (agent, hour)
);
CREATE INDEX decisions_hour ON decisions (hour);
