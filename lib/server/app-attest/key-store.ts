/**
 * The App Attest key ledger: keyId, public key, and the monotonic assertion
 * counter. D1 is the durable home; when the binding is absent (bare local
 * dev) a process-local map stands in, mirroring the provider-quota
 * fail-safe. Process-local keys vanish with the isolate, which the client
 * self-heals from by re-attesting on `unknown_key`.
 */

export type D1RunResultLike = Readonly<{
  success?: boolean;
  results?: readonly Record<string, unknown>[];
  error?: string;
}>;

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface AppAttestKeyRecord {
  readonly keyId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly environment: string;
  readonly appId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

export interface AppAttestKeyStore {
  get(keyId: string): Promise<AppAttestKeyRecord | null>;
  /** Upsert that keeps an existing row's counter and createdAt. */
  register(record: AppAttestKeyRecord): Promise<void>;
  advanceCounter(keyId: string, counter: number, seenAt: string): Promise<void>;
}

export const APP_ATTEST_KEYS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_attest_keys (
  key_id       TEXT PRIMARY KEY
    CHECK (length(key_id) BETWEEN 1 AND 64 AND key_id NOT GLOB '*[^0-9A-Za-z_-]*'),
  public_key   TEXT NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0
    CHECK (counter >= 0),
  environment  TEXT NOT NULL
    CHECK (environment IN ('development', 'production')),
  app_id       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) WITHOUT ROWID
`.trim();

const SELECT_KEY_SQL = `
SELECT key_id, public_key, counter, environment, app_id, created_at, last_seen_at
FROM app_attest_keys WHERE key_id = ?1
`.trim();

const REGISTER_KEY_SQL = `
INSERT INTO app_attest_keys (key_id, public_key, counter, environment, app_id, created_at, last_seen_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
ON CONFLICT (key_id) DO UPDATE SET
  public_key = excluded.public_key,
  environment = excluded.environment,
  app_id = excluded.app_id,
  last_seen_at = excluded.last_seen_at
`.trim();

const ADVANCE_COUNTER_SQL = `
UPDATE app_attest_keys SET counter = ?2, last_seen_at = ?3
WHERE key_id = ?1 AND counter < ?2
`.trim();

const initializedBindings = new WeakSet<D1DatabaseLike>();

export function d1AppAttestKeyStore(db: D1DatabaseLike): AppAttestKeyStore {
  async function ensureSchema() {
    if (initializedBindings.has(db)) return;
    await db.prepare(APP_ATTEST_KEYS_SCHEMA_SQL).run();
    initializedBindings.add(db);
  }
  return {
    async get(keyId) {
      await ensureSchema();
      const result = await db.prepare(SELECT_KEY_SQL).bind(keyId).run();
      const row = result.results?.[0];
      if (!row) return null;
      return {
        keyId: String(row.key_id),
        publicKey: String(row.public_key),
        counter: Number(row.counter),
        environment: String(row.environment),
        appId: String(row.app_id),
        createdAt: String(row.created_at),
        lastSeenAt: String(row.last_seen_at),
      };
    },
    async register(record) {
      await ensureSchema();
      await db.prepare(REGISTER_KEY_SQL).bind(
        record.keyId,
        record.publicKey,
        record.counter,
        record.environment,
        record.appId,
        record.createdAt,
        record.lastSeenAt,
      ).run();
    },
    async advanceCounter(keyId, counter, seenAt) {
      await ensureSchema();
      await db.prepare(ADVANCE_COUNTER_SQL).bind(keyId, counter, seenAt).run();
    },
  };
}

const processLocalKeys = new Map<string, AppAttestKeyRecord>();

/** Shared per process on purpose: it stands in for one durable ledger. */
export function processLocalAppAttestKeyStore(): AppAttestKeyStore {
  return {
    async get(keyId) {
      return processLocalKeys.get(keyId) ?? null;
    },
    async register(record) {
      const existing = processLocalKeys.get(record.keyId);
      processLocalKeys.set(record.keyId, existing
        ? { ...record, counter: existing.counter, createdAt: existing.createdAt }
        : record);
    },
    async advanceCounter(keyId, counter, seenAt) {
      const existing = processLocalKeys.get(keyId);
      if (existing && existing.counter < counter) {
        processLocalKeys.set(keyId, { ...existing, counter, lastSeenAt: seenAt });
      }
    },
  };
}

/** Test hook: the process-local ledger persists per process otherwise. */
export function resetProcessLocalAppAttestKeys() {
  processLocalKeys.clear();
}
