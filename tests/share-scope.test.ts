import assert from "node:assert/strict";
import test from "node:test";
import { decodeTripShare, type ShareableTripInput } from "../lib/share-link.ts";
import { buildScopedTripShare, MAX_SHARE_FRAGMENT_CHARS } from "../lib/share-scope.ts";

function input(overrides: Partial<ShareableTripInput> = {}): ShareableTripInput {
  return {
    destination: "japan",
    itinerary: "Day 1\nSenso-ji\nteamLab Planets — 15:30 booked\nprivate reference ABCD-123456",
    tripDays: 2,
    tripStartDate: "2026-09-14",
    dateWasProvided: true,
    hotelQuery: "Hotel Example",
    pace: "balanced",
    mealPlan: "none",
    travelPreference: "auto",
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    departureAirport: "NRT",
    departureTime: "18:00",
    flightKind: "international",
    dayStartDefault: "09:00",
    dayEndTarget: "21:00",
    transferBufferMinutes: 10,
    userStayMinutes: {},
    lastEntryTimes: {},
    dayStartTimes: {},
    dayEndTimes: {},
    legModeOverrides: {},
    dayOverrides: {},
    removedStops: [],
    ...overrides,
  };
}

test("privacy-safe scope removes hotel, airports and reservation details", () => {
  const result = buildScopedTripShare(input(), { dates: true, hotel: false, airports: false, reservations: false });
  assert.equal(result.blocked, false);
  assert.equal(result.redactedReservationCount, 1);
  assert.equal(result.omittedUnparsedLines, 1);
  const decoded = decodeTripShare(result.code!)!;
  assert.equal(decoded.hotelQuery, "");
  assert.equal(decoded.arrivalAirport, "none");
  assert.equal(decoded.departureAirport, "none");
  assert.equal(decoded.dateWasProvided, true);
  assert.doesNotMatch(decoded.itinerary, /15:30|booked|ABCD-123456/);
  assert.match(decoded.itinerary, /teamLab Planets — must/);
});

test("date privacy scope preserves provisional semantics", () => {
  const hidden = buildScopedTripShare(input(), { dates: false, hotel: false, airports: false, reservations: false });
  assert.equal(hidden.blocked, false);
  const decodedHidden = decodeTripShare(hidden.code!)!;
  assert.equal(decodedHidden.tripStartDate, "");
  assert.equal(decodedHidden.dateWasProvided, false);

  const provisional = buildScopedTripShare(input({ dateWasProvided: false }), { dates: true, hotel: false, airports: false, reservations: false });
  assert.equal(provisional.blocked, false);
  assert.equal(decodeTripShare(provisional.code!)!.dateWasProvided, false);
});

test("reservation details are included only after explicit opt-in and warn", () => {
  const result = buildScopedTripShare(input(), { dates: true, hotel: true, airports: true, reservations: true });
  assert.equal(result.blocked, false);
  assert.ok(result.warnings.includes("RESERVATION_DETAILS_INCLUDED"));
  assert.match(decodeTripShare(result.code!)!.itinerary, /15:30 — booked|15:30 booked/);
});

test("long fragments are blocked instead of silently producing a brittle URL", () => {
  const huge = Array.from({ length: 150 }, (_, index) => `Place ${index} ${"x".repeat(60)}`).join("\n");
  const result = buildScopedTripShare(input({ itinerary: huge }), { dates: true, hotel: false, airports: false, reservations: false });
  assert.equal(result.blocked, true);
  assert.equal(result.code, null);
  assert.ok(result.warnings.includes("LINK_TOO_LONG"));
  assert.equal(MAX_SHARE_FRAGMENT_CHARS, 6_000);
});

test("an opaque-only paste cannot be shared as a falsely complete itinerary", () => {
  const result = buildScopedTripShare(input({ itinerary: "https://example.com/private/ABC-123456" }), { dates: false, hotel: false, airports: false, reservations: false });
  assert.equal(result.blocked, true);
  assert.ok(result.warnings.includes("NO_SHAREABLE_PLACES"));
});

test("omitted sensitive places drop their decisions and remap later occurrences", () => {
  const result = buildScopedTripShare(input({
    itinerary: [
      "Secret Place https://example.com/private/ABC-123456",
      "Second Place",
      "Third Place — 15:30 booked",
    ].join("\n"),
    resolutionOverrides: [
      { inputIndex: 0, providerRef: "ChIJ_omitted" },
      { inputIndex: 1, providerRef: "ChIJ_second" },
      {
        inputIndex: 2,
        name: "Traveller pin for third",
        address: "Traveller-authored address",
        latitude: 35.1,
        longitude: 139.2,
      },
    ],
  }), { dates: false, hotel: false, airports: false, reservations: false });

  assert.equal(result.blocked, false);
  assert.equal(result.omittedUnparsedLines, 1);
  assert.deepEqual(result.input?.resolutionOverrides, [
    { inputIndex: 0, providerRef: "ChIJ_second" },
    {
      inputIndex: 1,
      name: "Traveller pin for third",
      address: "Traveller-authored address",
      latitude: 35.1,
      longitude: 139.2,
    },
  ]);
  const decoded = decodeTripShare(result.code!)!;
  assert.deepEqual(decoded.resolutionOverrides, result.input?.resolutionOverrides);
  assert.doesNotMatch(decoded.itinerary, /Secret Place|ABC-123456/);
  assert.match(decoded.itinerary, /Second Place/);
  assert.match(decoded.itinerary, /Third Place/);
  assert.doesNotMatch(decoded.itinerary, /15:30|booked/, "reservation redaction retains the place and its remapped decision");
});

test("manual stop ids remap every dependent edit and drop omitted or unknown ids", () => {
  const droppedManualId = "manual-0-34.00000-135.00000";
  const oldManualId = "manual-1-35.10000-139.20000";
  const newManualId = "manual-0-35.10000-139.20000";
  const providerId = "google-ChIJ_provider";
  const unknownManualId = "manual-99-1.00000-2.00000";
  const result = buildScopedTripShare(input({
    itinerary: [
      "Secret Manual https://example.com/private/ABC-123456",
      "Kept Manual",
      "Kept Provider",
    ].join("\n"),
    resolutionOverrides: [
      { inputIndex: 0, name: "Secret Manual", address: "Private point", latitude: 34, longitude: 135 },
      { inputIndex: 1, name: "Kept Manual", address: "Traveller point", latitude: 35.1, longitude: 139.2 },
      { inputIndex: 2, providerRef: "ChIJ_provider" },
    ],
    userStayMinutes: { [droppedManualId]: 60, [oldManualId]: 180, [providerId]: 90, [unknownManualId]: 30 },
    lastEntryTimes: { [droppedManualId]: "15:00", [oldManualId]: "16:00", [providerId]: "17:00" },
    dayOverrides: { [droppedManualId]: 1, [oldManualId]: 2, [providerId]: 2, [unknownManualId]: 1 },
    lockedOrderByDay: {
      0: [droppedManualId, oldManualId, providerId, unknownManualId],
      1: [unknownManualId],
    },
    removedStops: [
      { id: droppedManualId, name: "Secret Manual" },
      { id: oldManualId, name: "Kept Manual" },
      { id: providerId, name: "Kept Provider" },
      { id: unknownManualId, name: "Unknown" },
    ],
    legModeOverrides: {
      [`${oldManualId}::${providerId}`]: "transit",
      [`${providerId}::${oldManualId}`]: "walk",
      [`${droppedManualId}::${providerId}`]: "taxi",
      [`${unknownManualId}::${providerId}`]: "walk",
      malformed: "taxi",
    },
  }), { dates: false, hotel: false, airports: false, reservations: false });

  assert.equal(result.blocked, false);
  assert.deepEqual(result.input?.resolutionOverrides, [
    { inputIndex: 0, name: "Kept Manual", address: "Traveller point", latitude: 35.1, longitude: 139.2 },
    { inputIndex: 1, providerRef: "ChIJ_provider" },
  ]);
  assert.deepEqual(result.input?.userStayMinutes, { [newManualId]: 180, [providerId]: 90 });
  assert.deepEqual(result.input?.lastEntryTimes, { [newManualId]: "16:00", [providerId]: "17:00" });
  assert.deepEqual(result.input?.dayOverrides, { [newManualId]: 2, [providerId]: 2 });
  assert.deepEqual(result.input?.lockedOrderByDay, { 0: [newManualId, providerId] });
  assert.deepEqual(result.input?.removedStops, [
    { id: newManualId, name: "Kept Manual" },
    { id: providerId, name: "Kept Provider" },
  ]);
  assert.deepEqual(result.input?.legModeOverrides, {
    [`${newManualId}::${providerId}`]: "transit",
    [`${providerId}::${newManualId}`]: "walk",
  });
  const decoded = decodeTripShare(result.code!)!;
  assert.deepEqual(decoded.userStayMinutes, result.input?.userStayMinutes);
  assert.deepEqual(decoded.lastEntryTimes, result.input?.lastEntryTimes);
  assert.deepEqual(decoded.dayOverrides, result.input?.dayOverrides);
  assert.deepEqual(decoded.lockedOrderByDay, result.input?.lockedOrderByDay);
  assert.deepEqual(decoded.removedStops, result.input?.removedStops);
  assert.deepEqual(decoded.legModeOverrides, result.input?.legModeOverrides);
});

test("a renumbered duplicate provider family drops ambiguous id-keyed edits", () => {
  const baseId = "google-ChIJ_same";
  const secondId = `${baseId}--occurrence-2`;
  const result = buildScopedTripShare(input({
    itinerary: "Hidden Twin https://example.com/private/ABC-123456\nVisible Twin",
    resolutionOverrides: [
      { inputIndex: 0, providerRef: "ChIJ_same" },
      { inputIndex: 1, providerRef: "ChIJ_same" },
    ],
    userStayMinutes: { [baseId]: 60, [secondId]: 120 },
    lockedOrderByDay: { 0: [baseId, secondId] },
    removedStops: [{ id: baseId, name: "Hidden Twin" }, { id: secondId, name: "Visible Twin" }],
    legModeOverrides: { [`${baseId}::${secondId}`]: "walk" },
  }), { dates: false, hotel: false, airports: false, reservations: false });

  assert.equal(result.blocked, false);
  assert.deepEqual(result.input?.resolutionOverrides, [{ inputIndex: 0, providerRef: "ChIJ_same" }]);
  assert.deepEqual(result.input?.userStayMinutes, {});
  assert.deepEqual(result.input?.lockedOrderByDay, {});
  assert.deepEqual(result.input?.removedStops, []);
  assert.deepEqual(result.input?.legModeOverrides, {});
});

test("omitting a sensitive catalogue place drops its stable-id edits and display label", () => {
  const result = buildScopedTripShare(input({
    itinerary: "Senso-ji https://example.com/private/ABC-123456\nTokyo Skytree",
    userStayMinutes: { sensoji: 60, "tokyo-skytree": 90 },
    lastEntryTimes: { sensoji: "16:00", "tokyo-skytree": "20:00" },
    dayOverrides: { sensoji: 1, "tokyo-skytree": 2 },
    lockedOrderByDay: { 0: ["sensoji", "tokyo-skytree"] },
    removedStops: [
      { id: "sensoji", name: "Senso-ji" },
      { id: "tokyo-skytree", name: "Tokyo Skytree" },
      { id: "google-ChIJ_hidden", name: "Hidden provider display name" },
    ],
    legModeOverrides: {
      "sensoji::tokyo-skytree": "transit",
      "tokyo-skytree::sensoji": "walk",
    },
  }), { dates: false, hotel: false, airports: false, reservations: false });

  assert.equal(result.blocked, false);
  assert.doesNotMatch(result.input?.itinerary ?? "", /Senso-ji|ABC-123456/);
  assert.deepEqual(result.input?.userStayMinutes, { "tokyo-skytree": 90 });
  assert.deepEqual(result.input?.lastEntryTimes, { "tokyo-skytree": "20:00" });
  assert.deepEqual(result.input?.dayOverrides, { "tokyo-skytree": 2 });
  assert.deepEqual(result.input?.lockedOrderByDay, { 0: ["tokyo-skytree"] });
  assert.deepEqual(result.input?.removedStops, [{ id: "tokyo-skytree", name: "Tokyo Skytree" }]);
  assert.deepEqual(result.input?.legModeOverrides, {});
  const code = result.code ?? "";
  assert.doesNotMatch(code, /Hidden provider display name/);
  assert.deepEqual(decodeTripShare(code)?.removedStops, result.input?.removedStops);
});
