import { PROVIDER_COST_OPERATIONS } from "../lib/server/provider-cost-policy.ts";

/**
 * Durable paid-provider quota counters.
 *
 * Privacy boundary: this table accepts only server-derived opaque SHA-256
 * subject hashes and server-derived UTC buckets. It must never receive an
 * itinerary, place, hotel, reservation, or traveller-supplied date.
 */

/**
 * Every operation the durable ledger may charge. The runtime schema check in
 * initializeDurableProviderQuotaSchema keys off this list: a deployed table
 * whose CHECK constraint predates an entry here is migrated in place,
 * because an outdated CHECK makes every new operation's reservation fail as
 * "check constraint failed" — which the enforcer would misread as a
 * permanently exhausted budget.
 */
export const PROVIDER_QUOTA_OPERATIONS = PROVIDER_COST_OPERATIONS;

const operationCheckList = PROVIDER_QUOTA_OPERATIONS.map((operation) => `'${operation}'`).join(", ");

function schemaSql(tableName: string) {
  return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  provider TEXT NOT NULL
    CHECK (provider IN ('google', 'anthropic')),
  operation TEXT NOT NULL
    CHECK (operation IN (${operationCheckList})),
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
}

export const PROVIDER_QUOTA_SCHEMA_SQL = schemaSql("provider_quota_counters");

/** Statements that upgrade a table created by an older schema, transactionally. */
export const PROVIDER_QUOTA_MIGRATION_SQL = [
  "DROP TABLE IF EXISTS provider_quota_counters_legacy",
  "ALTER TABLE provider_quota_counters RENAME TO provider_quota_counters_legacy",
  schemaSql("provider_quota_counters"),
  "INSERT INTO provider_quota_counters SELECT * FROM provider_quota_counters_legacy",
  "DROP TABLE provider_quota_counters_legacy",
] as const;

export const PROVIDER_QUOTA_TABLE_INFO_SQL =
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_quota_counters'";
