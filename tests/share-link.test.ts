import assert from "node:assert/strict";
import test from "node:test";
import { decodeTripShare, encodeTripShare, type ShareableTripInput } from "../lib/share-link.ts";
import { buildScopedTripShare } from "../lib/share-scope.ts";

const input: ShareableTripInput = {
  destination: "japan",
  itinerary: "1日目\n浅草寺\nチームラボプラネッツ 15:30 予約",
  tripDays: 3,
  tripStartDate: "2026-09-14",
  dateWasProvided: true,
  hotelQuery: "新宿駅近く",
  pace: "balanced",
  mealPlan: "all",
  travelPreference: "car",
  arrivalAirport: "HND",
  arrivalTime: "10:30",
  departureAirport: "none",
  departureTime: "",
  flightKind: "domestic",
  dayStartDefault: "08:00",
  dayEndTarget: "21:30",
  transferBufferMinutes: 20,
  userStayMinutes: { "google-sensoji": 120 },
  lastEntryTimes: { "google-sensoji": "16:30" },
  dayStartTimes: { 0: "08:30" },
  dayEndTimes: { 0: "19:45", 1: "21:15" },
  legModeOverrides: { "google-sensoji::google-skytree": "walk" },
  dayOverrides: { "google-skytree": 2 },
  removedStops: [{ id: "google-akihabara", name: "Akihabara" }],
  resolutionOverrides: [
    { inputIndex: 0, providerRef: "ChIJ_sensoji-123" },
    {
      inputIndex: 1,
      name: "Traveller's quiet entrance",
      address: "East side of the station",
      latitude: 35.6491,
      longitude: 139.7898,
    },
  ],
};

test("a share link round-trips every input, including Japanese text", () => {
  const code = encodeTripShare(input);
  assert.match(code, /^[A-Za-z0-9_-]+$/, "URL-hash safe");
  assert.deepEqual(decodeTripShare(code), input);
});

test("a shared Swiss trip keeps its country and airport", () => {
  const swiss = decodeTripShare(encodeTripShare({
    ...input,
    destination: "switzerland",
    itinerary: "Jungfraujoch\nZermatt",
    arrivalAirport: "ZRH",
    departureAirport: "GVA",
  }));
  assert.ok(swiss);
  assert.equal(swiss.destination, "switzerland");
  assert.equal(swiss.arrivalAirport, "ZRH");
  assert.equal(swiss.departureAirport, "GVA");
});

test("garbage and hostile share payloads are rejected or clamped", () => {
  assert.equal(decodeTripShare("not-base64!!"), null);
  assert.equal(decodeTripShare(encodeTripShare({ ...input, itinerary: "   " })), null);

  const oversized = decodeTripShare(encodeTripShare({
    ...input,
    tripDays: 99,
    pace: "hyperspeed" as ShareableTripInput["pace"],
    destination: "narnia" as ShareableTripInput["destination"],
    arrivalAirport: "lax",
    arrivalTime: "99:99",
  }));
  assert.ok(oversized);
  assert.equal(oversized.tripDays, 14);
  assert.equal(oversized.pace, "balanced");
  // An unknown country falls back to auto-detection instead of a wrong guess.
  assert.equal(oversized.destination, "auto");
  assert.equal(oversized.arrivalAirport, "none");
  assert.equal(oversized.arrivalTime, "");

  const forgedConfirmedDate = decodeTripShare(encodeTripShare({
    ...input,
    tripStartDate: "2026-02-31",
    dateWasProvided: true,
  }));
  assert.ok(forgedConfirmedDate);
  assert.equal(forgedConfirmedDate.tripStartDate, "");
  assert.equal(forgedConfirmedDate.dateWasProvided, false, "an invalid date can never become confirmed by falling back in the UI");

  const nonLeapDay = decodeTripShare(encodeTripShare({
    ...input,
    tripStartDate: "2025-02-29",
    dateWasProvided: true,
  }));
  assert.ok(nonLeapDay);
  assert.equal(nonLeapDay.dateWasProvided, false);
});

test("legacy links keep an inferred date provisional", () => {
  const legacy = { ...input } as Partial<ShareableTripInput>;
  delete legacy.dateWasProvided;
  delete legacy.resolutionOverrides;
  const decoded = decodeTripShare(encodeTripShare(legacy as ShareableTripInput));
  assert.ok(decoded);
  assert.equal(decoded.dateWasProvided, false);
  assert.equal("resolutionOverrides" in decoded, false, "v1 links without resolution choices stay valid");
});

test("provider choices serialize only the occurrence and Place ID", () => {
  const unsafeProviderResult = {
    inputIndex: 0,
    providerRef: "ChIJ_provider-only_123",
    name: "Mutable Google display name",
    address: "Mutable Google address",
    latitude: 35.1,
    longitude: 139.1,
    googleMapsUrl: "https://maps.google.com/private-detail",
  };
  const code = encodeTripShare({
    ...input,
    resolutionOverrides: [unsafeProviderResult] as ShareableTripInput["resolutionOverrides"],
  });
  const wire = JSON.parse(Buffer.from(code, "base64url").toString("utf8")) as Record<string, unknown>;

  assert.deepEqual(wire.resolutionOverrides, [{ inputIndex: 0, providerRef: "ChIJ_provider-only_123" }]);
  assert.deepEqual(decodeTripShare(code)?.resolutionOverrides, [{ inputIndex: 0, providerRef: "ChIJ_provider-only_123" }]);
});

test("resolution choices fail closed, dedupe by occurrence and cap at twelve", () => {
  const providerTail = Array.from({ length: 18 }, (_, index) => ({
    inputIndex: index + 2,
    providerRef: `ChIJ_tail_${index + 2}`,
  }));
  const hostilePayload = {
    v: 1,
    ...input,
    itinerary: Array.from({ length: 24 }, (_, index) => `Place ${index}`).join("\n"),
    resolutionOverrides: [
      { inputIndex: -1, providerRef: "ChIJ_negative" },
      { inputIndex: 0, providerRef: "ChIJ_safe_0", name: "must be stripped", address: "must be stripped", latitude: 1, longitude: 2 },
      { inputIndex: 0, name: "duplicate", address: "duplicate", latitude: 1, longitude: 2 },
      { inputIndex: 1, name: "bad coordinate", address: "somewhere", latitude: 91, longitude: 2 },
      { inputIndex: 1, name: "  Manual pin  ", address: "  Traveller address  ", latitude: 35.1, longitude: 139.2, sourceUrl: "must be stripped" },
      { inputIndex: 22, providerRef: "places/not-a-place-id", name: "must not fall through", address: "provider content", latitude: 1, longitude: 2 },
      { inputIndex: 4_000, providerRef: "ChIJ_too_large" },
      ...providerTail,
    ],
  };
  const code = Buffer.from(JSON.stringify(hostilePayload), "utf8").toString("base64url");
  const decoded = decodeTripShare(code);

  assert.ok(decoded?.resolutionOverrides);
  assert.equal(decoded.resolutionOverrides.length, 12);
  assert.deepEqual(decoded.resolutionOverrides[0], { inputIndex: 0, providerRef: "ChIJ_safe_0" });
  assert.deepEqual(decoded.resolutionOverrides[1], {
    inputIndex: 1,
    name: "Manual pin",
    address: "Traveller address",
    latitude: 35.1,
    longitude: 139.2,
  });
  assert.deepEqual(decoded.resolutionOverrides.map((entry) => entry.inputIndex), Array.from({ length: 12 }, (_, index) => index));
  assert.ok(decoded.resolutionOverrides.every((entry) => !Object.hasOwn(entry, "sourceUrl")));
});

test("selective share scope retains safe resolution decisions needed to reproduce the plan", () => {
  const scoped = buildScopedTripShare(input, {
    dates: false,
    hotel: false,
    airports: false,
    reservations: false,
  }, "ja");

  assert.equal(scoped.blocked, false);
  assert.deepEqual(decodeTripShare(scoped.code!)?.resolutionOverrides, input.resolutionOverrides);
});
