/**
 * Durable paid-provider quota counters.
 *
 * Privacy boundary: this table accepts only server-derived opaque SHA-256
 * subject hashes and server-derived UTC buckets. It must never receive an
 * itinerary, place, hotel, reservation, or traveller-supplied date.
 */
export const PROVIDER_QUOTA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provider_quota_counters (
  provider TEXT NOT NULL
    CHECK (provider IN ('google', 'anthropic')),
  operation TEXT NOT NULL
    CHECK (operation IN ('live_routes', 'place_resolution', 'place_intelligence', 'fresh_voices')),
  scope TEXT NOT NULL
    CHECK (scope IN ('trip', 'session', 'day', 'month')),
  subject_hash TEXT NOT NULL
    CHECK (
      length(subject_hash) = 64
      AND subject_hash NOT GLOB '*[^0-9a-f]*'
    ),
  bucket TEXT NOT NULL
    CHECK (
      length(bucket) BETWEEN 1 AND 16
      AND bucket NOT GLOB '*[^0-9A-Za-z_-]*'
    ),
  used_count INTEGER NOT NULL
    CHECK (used_count >= 0),
  failure_count INTEGER NOT NULL DEFAULT 0
    CHECK (failure_count >= 0 AND failure_count <= used_count),
  hard_limit INTEGER NOT NULL
    CHECK (hard_limit > 0),
  updated_at_ms INTEGER NOT NULL
    CHECK (updated_at_ms >= 0),
  CONSTRAINT provider_quota_used_within_limit
    CHECK (used_count <= hard_limit),
  PRIMARY KEY (provider, operation, scope, subject_hash, bucket)
) WITHOUT ROWID
`.trim();
