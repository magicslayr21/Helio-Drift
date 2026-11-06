CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
  revision INTEGER NOT NULL, report_json TEXT NOT NULL, stage_order INTEGER NOT NULL,
  wave INTEGER NOT NULL, score INTEGER NOT NULL, credits INTEGER NOT NULL,
  level INTEGER NOT NULL, status TEXT NOT NULL, assisted INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, moderated INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0, username_override TEXT
);
CREATE INDEX IF NOT EXISTS runs_player_best ON runs
  (player_id, deleted, stage_order DESC, wave DESC, score DESC, credits DESC, id);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
INSERT OR IGNORE INTO metadata(key, value) VALUES ('updated_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
