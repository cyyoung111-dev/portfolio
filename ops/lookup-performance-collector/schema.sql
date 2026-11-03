CREATE TABLE IF NOT EXISTS perf_samples (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 day TEXT NOT NULL,
 device TEXT NOT NULL CHECK(device IN ('desktop','mobile','unknown')),
 stage TEXT NOT NULL,
 ms INTEGER NOT NULL CHECK(ms BETWEEN 0 AND 120000),
 result TEXT NOT NULL CHECK(result IN ('ok','error')),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_recent_idx ON perf_samples(created_at);
CREATE INDEX IF NOT EXISTS perf_day_idx ON perf_samples(day);
