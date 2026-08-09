import assert from "node:assert/strict";
import test from "node:test";
import { decodeTripShare, encodeTripShare, type ShareableTripInput } from "../lib/share-link.ts";
import {
  LEGACY_RECENT_TRIPS_KEY,
  TRIP_STORE_MAX_RECORDS,
  createTripStore,
  validateUserTripPayload,
  type StoredTripRecord,
  type TripStoreAdapter,
} from "../lib/trip-store.ts";

function payload(days: number) {
  return validateUserTripPayload({
    input: { itinerary: "Senso-ji\nTokyo Skytree", tripDays: days },
    edits: { dayStartTimes: { 0: "09:00" }, removedStopIds: [] },
  });
}

function clock() {
  let tick = 0;
  return () => `2026-08-${String(++tick).padStart(2, "0")}T00:00:00.000Z`;
}

class FakeAdapter implements TripStoreAdapter {
  readonly kind = "indexeddb" as const;
  records = new Map<string, StoredTripRecord>();
  failWrites = false;
  putManyCalls = 0;

  async get(id: string) {
    return this.records.get(id) ?? null;
  }

  async list() {
    return [...this.records.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async putMany(records: readonly StoredTripRecord[], maximum: number) {
    this.putManyCalls += 1;
    if (this.failWrites) throw new Error("private_mode_write_failed");
    const staged = new Map(this.records);
    for (const record of records) staged.set(record.id, record);
    const kept = [...staged.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, maximum);
    this.records = new Map(kept.map((record) => [record.id, record]));
  }

  async delete(id: string) {
    return this.records.delete(id);
  }

  async clear() {
    this.records.clear();
  }
}

class FakeLegacyStorage {
  values = new Map<string, string>();
  removed: string[] = [];

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.removed.push(key);
    this.values.delete(key);
  }
}

test("returns an explicit memory fallback and still provides async CRUD", async () => {
  const now = clock();
  let id = 0;
  const store = await createTripStore({
    indexedDB: null,
    legacyStorage: null,
    now,
    idFactory: () => `trip-${++id}`,
  });

  assert.deepEqual(store.status, {
    backend: "memory",
    persistent: false,
    migration: "not_attempted",
    reason: "indexeddb_unavailable",
  });

  const first = await store.save({ title: "Tokyo", payload: payload(3) });
  assert.equal((await store.get(first.id))?.title, "Tokyo");
  const updated = await store.save({ id: first.id, title: "Tokyo revised", payload: payload(4) });
  assert.equal(updated.createdAt, first.createdAt);
  assert.notEqual(updated.updatedAt, first.updatedAt);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.delete(first.id), true);
  assert.equal(await store.delete(first.id), false);
});

test("device-local share codes round-trip stable provider choices and manual pins", async () => {
  const shareInput: ShareableTripInput = {
    destination: "japan",
    itinerary: "Synthetic provider place\nSynthetic manual place",
    tripDays: 2,
    tripStartDate: "2026-09-14",
    dateWasProvided: true,
    hotelQuery: "",
    pace: "balanced",
    mealPlan: "none",
    travelPreference: "auto",
    arrivalAirport: "none",
    arrivalTime: "",
    departureAirport: "none",
    departureTime: "",
    flightKind: "international",
    dayStartDefault: "09:00",
    dayEndTarget: "22:00",
    transferBufferMinutes: 10,
    userStayMinutes: {},
    lastEntryTimes: {},
    dayStartTimes: {},
    dayEndTimes: {},
    legModeOverrides: {},
    dayOverrides: {},
    removedStops: [],
    resolutionOverrides: [
      { inputIndex: 0, providerRef: "ChIJ_stable_choice" },
      {
        inputIndex: 1,
        name: "Traveller pin",
        address: "Traveller-authored address",
        latitude: 35.6,
        longitude: 139.7,
      },
    ],
  };
  const shareCode = encodeTripShare(shareInput);
  const store = await createTripStore({ indexedDB: null, legacyStorage: null, idFactory: () => "shared-trip" });
  const stored = await store.save({
    title: "Shared choices",
    payload: validateUserTripPayload({ input: { shareCode }, edits: {} }),
  });
  const restoredCode = (await store.get(stored.id))?.payload.input.shareCode;

  assert.equal(typeof restoredCode, "string");
  const decoded = decodeTripShare(restoredCode as string);
  assert.deepEqual(decoded?.resolutionOverrides, shareInput.resolutionOverrides);
  assert.deepEqual(Object.keys(decoded?.resolutionOverrides?.[0] ?? {}).sort(), ["inputIndex", "providerRef"]);
});

test("keeps only the ten newest local trips", async () => {
  const now = clock();
  let id = 0;
  const store = await createTripStore({ indexedDB: null, legacyStorage: null, now, idFactory: () => `trip-${++id}` });
  for (let index = 1; index <= 13; index += 1) {
    await store.save({ title: `Trip ${index}`, payload: payload(index) });
  }

  const records = await store.list();
  assert.equal(records.length, TRIP_STORE_MAX_RECORDS);
  assert.equal(records[0].title, "Trip 13");
  assert.equal(records.at(-1)?.title, "Trip 4");
});

test("rejects provider data, built plans and non-JSON values before storage", () => {
  assert.throws(() => validateUserTripPayload({
    input: { itinerary: "Tokyo" },
    edits: {},
    plan: { days: [] },
  }), /only input and edits/);
  assert.throws(() => validateUserTripPayload({
    input: { resolvedStops: [{ formattedAddress: "provider-owned" }] },
    edits: {},
  }), /cannot be persisted/);
  assert.throws(() => validateUserTripPayload({
    input: { itinerary: "Tokyo" },
    edits: { candidate: { stops: [], legs: [], startTime: "09:00" } },
  }), /built or scheduled trip plan/);
  assert.throws(() => validateUserTripPayload({
    input: { itinerary: "Tokyo", createdBy: () => "provider" },
    edits: {},
  }), /JSON-safe/);
  assert.throws(() => validateUserTripPayload({
    input: { itinerary: "Tokyo", fetchedAt: new Date() },
    edits: {},
  }), /plain objects/);
});

test("migrates legacy recent trips atomically, then deletes the old key", async () => {
  const adapter = new FakeAdapter();
  const legacy = new FakeLegacyStorage();
  legacy.values.set(LEGACY_RECENT_TRIPS_KEY, JSON.stringify([{
    code: "share-code-user-input-only",
    title: "Old Tokyo trip",
    days: 3,
    startDate: "2026-09-14",
    savedAt: "2026-08-01T00:00:00.000Z",
  }]));

  const store = await createTripStore({ adapter, legacyStorage: legacy });
  assert.equal(store.status.backend, "indexeddb");
  assert.equal(store.status.migration, "completed");
  assert.equal(adapter.putManyCalls, 1);
  assert.equal(legacy.getItem(LEGACY_RECENT_TRIPS_KEY), null);
  assert.deepEqual(legacy.removed, [LEGACY_RECENT_TRIPS_KEY]);
  const migrated = (await store.list())[0];
  assert.equal(migrated.title, "Old Tokyo trip");
  assert.equal(migrated.payload.input.legacyShareCode, "share-code-user-input-only");
  assert.deepEqual(migrated.payload.edits, {});
});

test("does not delete legacy data when the IndexedDB migration transaction fails", async () => {
  const adapter = new FakeAdapter();
  adapter.failWrites = true;
  const legacy = new FakeLegacyStorage();
  const raw = JSON.stringify([{
    code: "still-needed",
    title: "Do not lose me",
    days: 2,
    startDate: "2026-10-01",
    savedAt: "2026-08-02T00:00:00.000Z",
  }]);
  legacy.values.set(LEGACY_RECENT_TRIPS_KEY, raw);

  const store = await createTripStore({ adapter, legacyStorage: legacy, idFactory: () => "memory-trip" });
  assert.deepEqual(store.status, {
    backend: "memory",
    persistent: false,
    migration: "failed",
    reason: "indexeddb_operation_failed",
  });
  assert.equal(legacy.getItem(LEGACY_RECENT_TRIPS_KEY), raw);
  assert.deepEqual(legacy.removed, []);

  await store.save({ title: "Session-only trip", payload: payload(1) });
  assert.equal((await store.list()).length, 1, "fallback remains usable for the current session");
});

test("keeps malformed legacy data untouched and reports migration failure", async () => {
  const adapter = new FakeAdapter();
  const legacy = new FakeLegacyStorage();
  legacy.values.set(LEGACY_RECENT_TRIPS_KEY, "not-json");

  const store = await createTripStore({ adapter, legacyStorage: legacy });
  assert.equal(store.status.backend, "indexeddb");
  assert.equal(store.status.migration, "failed");
  assert.equal(store.status.backend === "indexeddb" ? store.status.migrationError : null, "legacy_payload_invalid");
  assert.equal(legacy.getItem(LEGACY_RECENT_TRIPS_KEY), "not-json");
  assert.equal(adapter.putManyCalls, 0);
});
