-- Separate metadata preserves existing authoritative records and old room inserts.
CREATE TABLE IF NOT EXISTS coop_run_details (
  run_id TEXT PRIMARY KEY REFERENCES coop_runs(id),
  telemetry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  moderated INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
