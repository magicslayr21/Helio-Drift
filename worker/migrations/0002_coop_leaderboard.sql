CREATE TABLE IF NOT EXISTS coop_runs (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_one TEXT NOT NULL,
  player_two TEXT NOT NULL,
  score INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  sector INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  bosses_defeated INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('victory', 'defeat', 'abandoned')),
  completed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS coop_runs_ranking ON coop_runs
  (completed DESC, wave DESC, score DESC, bosses_defeated DESC, duration_seconds DESC, id ASC);
