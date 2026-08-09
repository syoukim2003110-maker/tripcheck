/**
 * Device-local persistence for user-authored trip input and edits.
 *
 * Deliberately excluded: BuiltTripPlan, provider responses, live route/place
 * fields, opening-hours snapshots and other externally-owned changing data.
 * Those values must be fetched/re-derived instead of copied into this store.
 */

export const TRIP_STORE_DB_NAME = "tripcheck-local";
export const TRIP_STORE_DB_VERSION = 1;
export const TRIP_STORE_OBJECT_STORE = "trips";
export const TRIP_STORE_MAX_RECORDS = 10;
export const LEGACY_RECENT_TRIPS_KEY = "tripcheck-recent-trips";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The only payload shape accepted by the persistent store. */
export type UserTripPayload = Readonly<{
  input: JsonObject;
  edits: JsonObject;
}>;

export type StoredTripRecord = Readonly<{
  id: string;
  schemaVersion: 1;
  title: string;
  createdAt: string;
  updatedAt: string;
  payload: UserTripPayload;
}>;

export type SaveTripRecord = Readonly<{
  id?: string;
  title: string;
  payload: UserTripPayload;
}>;

export type TripStoreMigrationStatus = "not_needed" | "completed" | "failed" | "not_attempted";

export type TripStoreStatus =
  | Readonly<{
    backend: "indexeddb";
    persistent: true;
    migration: TripStoreMigrationStatus;
    migrationError?: string;
  }>
  | Readonly<{
    backend: "memory";
    persistent: false;
    migration: "not_attempted" | "failed";
    reason: "indexeddb_unavailable" | "indexeddb_open_failed" | "indexeddb_operation_failed" | "injected_memory";
  }>;

export type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

/**
 * Adapter contract used by the browser IndexedDB implementation and small
 * dependency-free test doubles. putMany must be one atomic transaction.
 */
export type TripStoreAdapter = {
  readonly kind: "indexeddb" | "memory";
  get(id: string): Promise<StoredTripRecord | null>;
  list(): Promise<StoredTripRecord[]>;
  putMany(records: readonly StoredTripRecord[], maximum: number): Promise<void>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  close?(): void;
};

export type CreateTripStoreOptions = Readonly<{
  indexedDB?: IDBFactory | null;
  legacyStorage?: LegacyStorage | null;
  adapter?: TripStoreAdapter;
  now?: () => string;
  idFactory?: () => string;
}>;

export type TripStore = {
  readonly status: TripStoreStatus;
  save(input: SaveTripRecord): Promise<StoredTripRecord>;
  get(id: string): Promise<StoredTripRecord | null>;
  list(): Promise<StoredTripRecord[]>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  close(): void;
};

const FORBIDDEN_PERSISTED_KEYS = new Set([
  "builttripplan",
  "scheduleddays",
  "baserecommendations",
  "foodrecommendationslots",
  "resolvedstops",
  "resolvedbase",
  "routegeometry",
  "routegeometrybyday",
  "livetransit",
  "livewalking",
  "livedriving",
  "liverouteevidence",
  "providersnapshothash",
  "providerresponse",
  "providerevidence",
  "criticalfacts",
  "openingwindowsbyday",
  "openinghours",
  "regularopeningperiods",
  "currentopeningperiods",
  "formattedaddress",
  "googlemapsurl",
  "googlemapsuri",
  "businessstatus",
  "placetypes",
  "rating",
  "userratingcount",
  "sourceurl",
  "verifiedat",
  "photo",
  "photos",
  "reviews",
]);

const MAX_PAYLOAD_NODES = 8_000;
const MAX_PAYLOAD_DEPTH = 16;
const MAX_PAYLOAD_BYTES = 160_000;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(value: unknown, ancestors: Set<object>, counter: { value: number }, depth: number): JsonValue {
  counter.value += 1;
  if (counter.value > MAX_PAYLOAD_NODES || depth > MAX_PAYLOAD_DEPTH) {
    throw new TypeError("Trip payload is too deeply nested or contains too many values.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Trip payload numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Trip payload must contain JSON-safe values only.");
  if (ancestors.has(value)) throw new TypeError("Trip payload must not contain cycles.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Trip payload arrays must not be sparse.");
        output.push(cloneJsonValue(value[index], ancestors, counter, depth + 1));
      }
      return output;
    }
    if (!plainObject(value)) throw new TypeError("Trip payload must use plain objects, not provider class instances.");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("Trip payload must not contain symbol keys.");

    const keys = Object.keys(value);
    const normalizedKeys = new Set(keys.map((key) => key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase()));
    for (const key of normalizedKeys) {
      if (FORBIDDEN_PERSISTED_KEYS.has(key)) {
        throw new TypeError(`Trip payload field "${key}" is provider or derived plan data and cannot be persisted.`);
      }
    }
    // Structural backstop for a renamed/wrapped BuiltTripPlan day or result.
    if ((normalizedKeys.has("stops") && normalizedKeys.has("legs") && normalizedKeys.has("starttime"))
      || (normalizedKeys.has("scheduleddays") && normalizedKeys.has("conflicts"))) {
      throw new TypeError("A built or scheduled trip plan cannot be persisted; save user edits instead.");
    }

    const output: Record<string, JsonValue> = {};
    for (const key of keys) {
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: cloneJsonValue(value[key], ancestors, counter, depth + 1),
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function validateUserTripPayload(value: unknown): UserTripPayload {
  if (!plainObject(value)) throw new TypeError("Trip payload must be an object with input and edits fields.");
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("input") || !keys.includes("edits")) {
    throw new TypeError("Trip payload may contain only input and edits; plans and provider data are excluded.");
  }
  if (!plainObject(value.input) || !plainObject(value.edits)) {
    throw new TypeError("Trip payload input and edits must be plain objects.");
  }
  const counter = { value: 0 };
  const cloned = cloneJsonValue(value, new Set(), counter, 0) as { input: JsonObject; edits: JsonObject };
  if (new TextEncoder().encode(JSON.stringify(cloned)).byteLength > MAX_PAYLOAD_BYTES) {
    throw new TypeError("Trip payload is too large for device-local storage.");
  }
  return cloned;
}

function cloneRecord(value: StoredTripRecord): StoredTripRecord {
  if (value.schemaVersion !== 1) throw new TypeError("Unsupported stored trip record version.");
  return {
    id: validId(value.id),
    schemaVersion: 1,
    title: validTitle(value.title),
    createdAt: validTimestamp(value.createdAt),
    updatedAt: validTimestamp(value.updatedAt),
    payload: validateUserTripPayload(value.payload),
  };
}

function validId(value: string) {
  const id = value.trim();
  if (!id || id.length > 200) throw new TypeError("Stored trip id must be 1–200 characters.");
  return id;
}

function validTitle(value: string) {
  const title = value.trim();
  if (!title || title.length > 160) throw new TypeError("Stored trip title must be 1–160 characters.");
  return title;
}

function validTimestamp(value: string) {
  const milliseconds = Date.parse(value);
  if (!value || !Number.isFinite(milliseconds)) throw new TypeError("Stored trip timestamps must be valid ISO-compatible dates.");
  return new Date(milliseconds).toISOString();
}

function compareNewest(left: StoredTripRecord, right: StoredTripRecord) {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id);
}

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

class MemoryTripStoreAdapter implements TripStoreAdapter {
  readonly kind = "memory" as const;
  private records = new Map<string, StoredTripRecord>();

  async get(id: string) {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : null;
  }

  async list() {
    return [...this.records.values()].sort(compareNewest).map(cloneRecord);
  }

  async putMany(records: readonly StoredTripRecord[], maximum: number) {
    for (const record of records) this.records.set(record.id, cloneRecord(record));
    const keep = new Set([...this.records.values()].sort(compareNewest).slice(0, maximum).map((record) => record.id));
    for (const id of this.records.keys()) if (!keep.has(id)) this.records.delete(id);
  }

  async delete(id: string) {
    return this.records.delete(id);
  }

  async clear() {
    this.records.clear();
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_request_failed"));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb_transaction_aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb_transaction_failed"));
  });
}

class IndexedDbTripStoreAdapter implements TripStoreAdapter {
  readonly kind = "indexeddb" as const;
  private database: IDBDatabase;

  constructor(database: IDBDatabase) {
    this.database = database;
  }

  async get(id: string) {
    const transaction = this.database.transaction(TRIP_STORE_OBJECT_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const result = await requestResult(transaction.objectStore(TRIP_STORE_OBJECT_STORE).get(id));
    await completed;
    return result ? cloneRecord(result as StoredTripRecord) : null;
  }

  async list() {
    const transaction = this.database.transaction(TRIP_STORE_OBJECT_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const result = await requestResult(transaction.objectStore(TRIP_STORE_OBJECT_STORE).getAll());
    await completed;
    return (result as StoredTripRecord[]).map(cloneRecord).sort(compareNewest);
  }

  async putMany(records: readonly StoredTripRecord[], maximum: number) {
    const transaction = this.database.transaction(TRIP_STORE_OBJECT_STORE, "readwrite");
    const objectStore = transaction.objectStore(TRIP_STORE_OBJECT_STORE);
    for (const record of records) objectStore.put(cloneRecord(record));
    const allRequest = objectStore.getAll();
    allRequest.onsuccess = () => {
      const stale = (allRequest.result as StoredTripRecord[]).sort(compareNewest).slice(maximum);
      for (const record of stale) objectStore.delete(record.id);
    };
    allRequest.onerror = () => transaction.abort();
    await transactionComplete(transaction);
  }

  async delete(id: string) {
    const existing = await this.get(id);
    if (!existing) return false;
    const transaction = this.database.transaction(TRIP_STORE_OBJECT_STORE, "readwrite");
    transaction.objectStore(TRIP_STORE_OBJECT_STORE).delete(id);
    await transactionComplete(transaction);
    return true;
  }

  async clear() {
    const transaction = this.database.transaction(TRIP_STORE_OBJECT_STORE, "readwrite");
    transaction.objectStore(TRIP_STORE_OBJECT_STORE).clear();
    await transactionComplete(transaction);
  }

  close() {
    this.database.close();
  }
}

function openIndexedDb(factory: IDBFactory) {
  return new Promise<TripStoreAdapter>((resolve, reject) => {
    let settled = false;
    const request = factory.open(TRIP_STORE_DB_NAME, TRIP_STORE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const objectStore = database.objectStoreNames.contains(TRIP_STORE_OBJECT_STORE)
        ? request.transaction?.objectStore(TRIP_STORE_OBJECT_STORE)
        : database.createObjectStore(TRIP_STORE_OBJECT_STORE, { keyPath: "id" });
      if (objectStore && !objectStore.indexNames.contains("updatedAt")) objectStore.createIndex("updatedAt", "updatedAt");
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(new IndexedDbTripStoreAdapter(request.result));
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("indexeddb_open_failed"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("indexeddb_open_blocked"));
    };
  });
}

type LegacyRecentTrip = {
  code: string;
  title: string;
  days: number;
  startDate: string;
  savedAt: string;
};

function parseLegacyTrips(raw: string): LegacyRecentTrip[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const output: LegacyRecentTrip[] = [];
  for (const item of value) {
    if (!plainObject(item)
      || typeof item.code !== "string" || !item.code
      || typeof item.title !== "string" || !item.title.trim()
      || typeof item.days !== "number" || !Number.isFinite(item.days)
      || typeof item.startDate !== "string"
      || typeof item.savedAt !== "string" || !Number.isFinite(Date.parse(item.savedAt))) return null;
    output.push({
      code: item.code.slice(0, 32_000),
      title: item.title.trim().slice(0, 160),
      days: Math.max(1, Math.min(30, Math.round(item.days))),
      startDate: item.startDate.slice(0, 32),
      savedAt: item.savedAt,
    });
  }
  return output.slice(0, TRIP_STORE_MAX_RECORDS);
}

function stableLegacyId(code: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `legacy-${(hash >>> 0).toString(36)}`;
}

async function migrateLegacyRecentTrips(adapter: TripStoreAdapter, storage: LegacyStorage | null) {
  if (!storage) return { migration: "not_needed" as const };
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_RECENT_TRIPS_KEY);
  } catch {
    return { migration: "failed" as const, migrationError: "legacy_read_failed" };
  }
  if (!raw) return { migration: "not_needed" as const };
  const legacy = parseLegacyTrips(raw);
  if (!legacy) return { migration: "failed" as const, migrationError: "legacy_payload_invalid" };
  const records = legacy.map((entry): StoredTripRecord => ({
    id: stableLegacyId(entry.code),
    schemaVersion: 1,
    title: entry.title,
    createdAt: entry.savedAt,
    updatedAt: entry.savedAt,
    payload: validateUserTripPayload({
      input: {
        legacyShareCode: entry.code,
        tripDays: entry.days,
        tripStartDate: entry.startDate,
      },
      edits: {},
    }),
  }));

  try {
    // putMany is one IndexedDB read/write transaction. The legacy key is never
    // removed before this promise confirms transaction completion.
    await adapter.putMany(records, TRIP_STORE_MAX_RECORDS);
  } catch {
    return { migration: "failed" as const, migrationError: "indexeddb_migration_transaction_failed" };
  }
  try {
    storage.removeItem(LEGACY_RECENT_TRIPS_KEY);
  } catch {
    return { migration: "failed" as const, migrationError: "legacy_delete_failed" };
  }
  return { migration: "completed" as const };
}

class TripStoreFacade implements TripStore {
  private adapter: TripStoreAdapter;
  private currentStatus: TripStoreStatus;
  private now: () => string;
  private idFactory: () => string;

  constructor(adapter: TripStoreAdapter, status: TripStoreStatus, now: () => string, idFactory: () => string) {
    this.adapter = adapter;
    this.currentStatus = status;
    this.now = now;
    this.idFactory = idFactory;
  }

  get status() {
    return this.currentStatus;
  }

  private fallBackToMemory() {
    if (this.adapter.kind === "memory") return;
    this.adapter.close?.();
    this.adapter = new MemoryTripStoreAdapter();
    this.currentStatus = {
      backend: "memory",
      persistent: false,
      migration: "failed",
      reason: "indexeddb_operation_failed",
    };
  }

  private async run<T>(operation: (adapter: TripStoreAdapter) => Promise<T>) {
    try {
      return await operation(this.adapter);
    } catch (error) {
      if (this.adapter.kind !== "indexeddb") throw error;
      this.fallBackToMemory();
      return operation(this.adapter);
    }
  }

  async save(input: SaveTripRecord) {
    const id = validId(input.id ?? this.idFactory());
    const title = validTitle(input.title);
    const payload = validateUserTripPayload(input.payload);
    const timestamp = validTimestamp(this.now());
    const existing = await this.run((adapter) => adapter.get(id));
    const record: StoredTripRecord = {
      id,
      schemaVersion: 1,
      title,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      payload,
    };
    await this.run((adapter) => adapter.putMany([record], TRIP_STORE_MAX_RECORDS));
    return cloneRecord(record);
  }

  async get(id: string) {
    return this.run((adapter) => adapter.get(validId(id)));
  }

  async list() {
    return this.run((adapter) => adapter.list());
  }

  async delete(id: string) {
    return this.run((adapter) => adapter.delete(validId(id)));
  }

  async clear() {
    await this.run((adapter) => adapter.clear());
  }

  close() {
    this.adapter.close?.();
  }
}

function availableLegacyStorage(explicit: LegacyStorage | null | undefined) {
  if (explicit !== undefined) return explicit;
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export async function createTripStore(options: CreateTripStoreOptions = {}): Promise<TripStore> {
  const now = options.now ?? (() => new Date().toISOString());
  const idFactory = options.idFactory ?? defaultIdFactory;
  const legacyStorage = availableLegacyStorage(options.legacyStorage);

  if (options.adapter) {
    if (options.adapter.kind === "memory") {
      return new TripStoreFacade(options.adapter, {
        backend: "memory",
        persistent: false,
        migration: "not_attempted",
        reason: "injected_memory",
      }, now, idFactory);
    }
    const migrated = await migrateLegacyRecentTrips(options.adapter, legacyStorage);
    if (migrated.migrationError === "indexeddb_migration_transaction_failed") {
      options.adapter.close?.();
      return new TripStoreFacade(new MemoryTripStoreAdapter(), {
        backend: "memory",
        persistent: false,
        migration: "failed",
        reason: "indexeddb_operation_failed",
      }, now, idFactory);
    }
    return new TripStoreFacade(options.adapter, {
      backend: "indexeddb",
      persistent: true,
      ...migrated,
    }, now, idFactory);
  }

  const factory = options.indexedDB === undefined
    ? (typeof globalThis.indexedDB === "undefined" ? null : globalThis.indexedDB)
    : options.indexedDB;
  if (!factory) {
    return new TripStoreFacade(new MemoryTripStoreAdapter(), {
      backend: "memory",
      persistent: false,
      migration: "not_attempted",
      reason: "indexeddb_unavailable",
    }, now, idFactory);
  }

  let adapter: TripStoreAdapter;
  try {
    adapter = await openIndexedDb(factory);
  } catch {
    return new TripStoreFacade(new MemoryTripStoreAdapter(), {
      backend: "memory",
      persistent: false,
      migration: "not_attempted",
      reason: "indexeddb_open_failed",
    }, now, idFactory);
  }

  const migrated = await migrateLegacyRecentTrips(adapter, legacyStorage);
  if (migrated.migrationError === "indexeddb_migration_transaction_failed") {
    adapter.close?.();
    return new TripStoreFacade(new MemoryTripStoreAdapter(), {
      backend: "memory",
      persistent: false,
      migration: "failed",
      reason: "indexeddb_operation_failed",
    }, now, idFactory);
  }
  return new TripStoreFacade(adapter, {
    backend: "indexeddb",
    persistent: true,
    ...migrated,
  }, now, idFactory);
}
