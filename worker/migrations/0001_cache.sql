-- The shared cache behind worker/lib/cache.js: one row per key, holding the
-- entry ({ stored_at, value, ttl_ms }) as JSON. WITHOUT ROWID keeps each write
-- to one row, which matters on D1's free plan (100,000 rows written a day).
CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  entry TEXT NOT NULL
) WITHOUT ROWID;
