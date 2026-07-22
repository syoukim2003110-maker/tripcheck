import assert from "node:assert/strict";
import test from "node:test";
import { forgetRecentTrip, loadRecentTrips, rememberRecentTrip, type StorageLike } from "../lib/recent-trips.ts";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function entry(code: string, savedAt: string) {
  return { code, title: `Trip ${code}`, days: 3, startDate: "2026-09-14", savedAt };
}

test("recent trips remember, dedupe by code and cap at five", () => {
  const storage = memoryStorage();
  for (let index = 1; index <= 7; index += 1) {
    rememberRecentTrip(storage, entry(`code-${index}`, `2026-07-${String(index).padStart(2, "0")}`));
  }
  const list = loadRecentTrips(storage);
  assert.equal(list.length, 5);
  assert.equal(list[0].code, "code-7");

  rememberRecentTrip(storage, entry("code-5", "2026-07-23"));
  const deduped = loadRecentTrips(storage);
  assert.equal(deduped.length, 5);
  assert.equal(deduped[0].code, "code-5");
  assert.equal(deduped.filter((item) => item.code === "code-5").length, 1);
});

test("forgetting removes one entry; corrupt storage reads as empty", () => {
  const storage = memoryStorage();
  rememberRecentTrip(storage, entry("keep", "2026-07-20"));
  rememberRecentTrip(storage, entry("drop", "2026-07-21"));
  const remaining = forgetRecentTrip(storage, "drop");
  assert.deepEqual(remaining.map((item) => item.code), ["keep"]);

  assert.deepEqual(loadRecentTrips(memoryStorage({ "tripcheck-recent-trips": "{broken" })), []);
  assert.deepEqual(loadRecentTrips(memoryStorage({ "tripcheck-recent-trips": "[{\"code\":1}]" })), []);
});
