// Exports the TypeScript share codec's own bytes so the Swift port
// (`apple/Packages/TripCheckKit/Sources/TripCheckKit/Share`) can prove it produces the *same*
// `#t=` fragment the web produces, not merely a fragment the web happens to accept.
//
// Only `lib/share-link.ts` and `lib/share-scope.ts` are imported, and nothing in `lib/` is
// modified. Every vector is `{ name, input, expectedCode, decoded, decodedCode, scopes }`:
//
//   expectedCode  encodeTripShare(input)                       — the byte string the web emits
//   decoded       decodeTripShare(expectedCode)                — what a recipient reconstructs
//   decodedCode   encodeTripShare(decoded)                     — the recipient's bytes, so a Swift
//                                                                diff covers every field at once
//   scopes[]      buildScopedTripShare(input, scope, locale)   — the redacted payload per scope,
//                                                                with `inputCode` for the same
//                                                                byte-level comparison
//
// `decodeVectors` carries payloads that a typed `ShareableTripInput` cannot express — hostile
// enum values, a legacy link with fields deleted, provider results carrying Google display
// fields, records past every cap — as raw codes with the decoded result the web reaches.
//
// Usage:
//   node --experimental-strip-types scripts/export-share-vectors.mjs \
//     --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/share-vectors.json

import { writeFileSync } from "node:fs";

const { decodeTripShare, encodeTripShare } = await import("../lib/share-link.ts");
const { buildScopedTripShare } = await import("../lib/share-scope.ts");

function parseArguments(argv) {
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out" || argument === "-o") {
      out = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--out=")) out = argument.slice("--out=".length);
  }
  if (!out) throw new Error("usage: export-share-vectors.mjs --out <file.json>");
  return out;
}

/* `ShareableTripInput`'s declaration order (`lib/share-link.ts:21-54`).
 *
 * The order is part of the wire format: `JSON.stringify` writes an object's own property order,
 * and a spread that introduces a key the source did not have appends it at the end. Test files
 * build their inputs with `{ ...input, lockedOrderByDay: … }`, which produces an order no
 * production path ever produces — `decodeTripShare` builds its result in declaration order, and
 * so does the Swift `ShareableTripInput`. So every vector input is rewritten into declaration
 * order before it is encoded, and the same object is what the Swift literal mirrors. */
const declaredOrder = [
  "destination", "itinerary", "tripDays", "tripStartDate", "dateWasProvided", "hotelQuery", "pace",
  "mealPlan", "travelPreference", "arrivalAirport", "arrivalTime", "departureAirport",
  "departureTime", "flightKind", "dayStartDefault", "dayEndTarget", "transferBufferMinutes",
  "maxWalkingMinutesPerLeg", "maxTransfersPerLeg", "userStayMinutes", "lastEntryTimes",
  "dayStartTimes", "dayEndTimes", "legModeOverrides", "dayOverrides", "lockedOrderByDay",
  "removedStops", "resolutionOverrides",
];

function inDeclaredOrder(source) {
  const result = {};
  for (const key of declaredOrder) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  const unknown = Object.keys(source).filter((key) => !declaredOrder.includes(key));
  if (unknown.length > 0) throw new Error(`unknown ShareableTripInput keys: ${unknown.join(", ")}`);
  return result;
}

/* The `tests/share-link.test.ts:6-41` input, key for key. */
const linkInput = {
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

/* `tests/share-scope.test.ts:6-34`'s `input()` factory. `overrides` is spread last exactly as the
 * factory does, so a key it replaces keeps its original position and a new key lands at the end. */
function scopeInput(overrides = {}) {
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

const droppedManualId = "manual-0-34.00000-135.00000";
const oldManualId = "manual-1-35.10000-139.20000";
const providerId = "google-ChIJ_provider";
const unknownManualId = "manual-99-1.00000-2.00000";
const twinBaseId = "google-ChIJ_same";
const twinSecondId = `${twinBaseId}--occurrence-2`;

/* Every vector is scoped through the same four combinations: nothing shared, the dates-only
 * scope the UI offers first, everything shared, and one mixed scope that keeps the hotel and the
 * bookings but hides the dates and the airports. */
const scopeCombinations = [
  { name: "none", scope: { dates: false, hotel: false, airports: false, reservations: false } },
  { name: "dates-only", scope: { dates: true, hotel: false, airports: false, reservations: false } },
  { name: "everything", scope: { dates: true, hotel: true, airports: true, reservations: true } },
  { name: "hotel-and-reservations", scope: { dates: false, hotel: true, airports: false, reservations: true } },
];

const vectors = [
  { name: "link-basic", locale: "en", input: linkInput },
  { name: "link-basic-ja", locale: "ja", input: linkInput },
  {
    name: "link-swiss",
    locale: "en",
    input: {
      ...linkInput,
      destination: "switzerland",
      itinerary: "Jungfraujoch\nZermatt",
      arrivalAirport: "ZRH",
      departureAirport: "GVA",
    },
  },
  {
    // Nothing here is cleaned on the way out, so this pins `JSON.stringify`'s escaping itself:
    // a quote, a backslash, a solidus (never escaped), C0 controls, U+2028/U+2029 (never escaped
    // by JSON.stringify, unlike a JS string literal), astral text and raw UTF-8.
    name: "link-escapes",
    locale: "en",
    input: {
      ...linkInput,
      itinerary: 'Quote " backslash \\ solidus / tab \t\nbell \u0007 sep \u2028\u2029 astral \u{1f44d}\u{1f3fd} kana \uff8a\uff9f',
      hotelQuery: "Ho\u0000tel \u007f \u6771\u4eac\u00a0\u99c5",
    },
  },
  {
    // Every optional field present at once, plus multi-key records whose insertion order the
    // fragment must preserve and integer-like keys JS reorders ahead of them.
    name: "link-optional-fields",
    locale: "en",
    input: {
      ...linkInput,
      maxWalkingMinutesPerLeg: 25,
      maxTransfersPerLeg: 2,
      userStayMinutes: { "z-last": 90, "a-first": 45, "google-sensoji": 120 },
      lastEntryTimes: { "z-last": "17:00", "a-first": "16:00" },
      dayStartTimes: { 0: "08:30", 2: "07:15", 13: "10:00" },
      dayEndTimes: { 1: "21:15", 0: "19:45" },
      legModeOverrides: { "a-first::z-last": "taxi", "z-last::google-sensoji": "transit" },
      dayOverrides: { "z-last": 3, "a-first": 1 },
      lockedOrderByDay: { 1: ["z-last", "a-first"], 0: ["google-sensoji"] },
      removedStops: [
        { id: "google-akihabara", name: "Akihabara" },
        { id: "a-first", name: "A First" },
      ],
    },
  },
  {
    name: "link-manual-pin-only",
    locale: "en",
    input: {
      ...linkInput,
      itinerary: "Traveller's quiet entrance\nSenso-ji",
      resolutionOverrides: [
        {
          inputIndex: 0,
          name: "Traveller's quiet entrance",
          address: "East side of the station",
          latitude: 35.6491,
          longitude: 139.7898,
        },
      ],
    },
  },
  {
    name: "link-provider-pin-only",
    locale: "en",
    input: {
      ...linkInput,
      itinerary: "Senso-ji\nTokyo Skytree",
      resolutionOverrides: [{ inputIndex: 1, providerRef: "ChIJ_skytree-9" }],
    },
  },
  {
    // Coordinates are the only `number` the payload carries that is not an integer, so they are
    // where `JSON.stringify`'s shortest-round-trip formatting has to be reproduced exactly:
    // an exponent below 1e-6, a value that is not representable in binary, the range limits, and
    // the negative zero `cleanResolutionOverrides` normalises to `0`.
    name: "link-awkward-coordinates",
    locale: "en",
    input: {
      ...linkInput,
      resolutionOverrides: [
        { inputIndex: 0, name: "Tiny", address: "Near the equator", latitude: 1e-7, longitude: 0.1 + 0.2 },
        { inputIndex: 1, name: "Negative zero", address: "Null Island", latitude: -0, longitude: -1e-7 },
        { inputIndex: 2, name: "Range limits", address: "Antimeridian", latitude: 90, longitude: -180 },
        { inputIndex: 3, name: "Long tail", address: "Somewhere", latitude: 35.66666666666667, longitude: -0.000001 },
      ],
    },
  },
  { name: "scope-minimal", locale: "en", input: scopeInput() },
  { name: "scope-provisional-date", locale: "en", input: scopeInput({ dateWasProvided: false }) },
  {
    // tests/share-scope.test.ts:69-76 — long enough that the fragment exceeds 6,000 characters.
    name: "scope-too-long",
    locale: "en",
    input: scopeInput({
      itinerary: Array.from({ length: 150 }, (_, index) => `Place ${index} ${"x".repeat(60)}`).join("\n"),
    }),
  },
  {
    // tests/share-scope.test.ts:78-82 — an opaque-only paste has nothing shareable left.
    name: "scope-opaque-only",
    locale: "en",
    input: scopeInput({ itinerary: "https://example.com/private/ABC-123456" }),
  },
  {
    // tests/share-scope.test.ts:84-122
    name: "scope-omitted-sensitive",
    locale: "en",
    input: scopeInput({
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
    }),
  },
  {
    // tests/share-scope.test.ts:124-187
    name: "scope-manual-remap",
    locale: "en",
    input: scopeInput({
      itinerary: ["Secret Manual https://example.com/private/ABC-123456", "Kept Manual", "Kept Provider"].join("\n"),
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
    }),
  },
  {
    // tests/share-scope.test.ts:189-210
    name: "scope-duplicate-provider-family",
    locale: "en",
    input: scopeInput({
      itinerary: "Hidden Twin https://example.com/private/ABC-123456\nVisible Twin",
      resolutionOverrides: [
        { inputIndex: 0, providerRef: "ChIJ_same" },
        { inputIndex: 1, providerRef: "ChIJ_same" },
      ],
      userStayMinutes: { [twinBaseId]: 60, [twinSecondId]: 120 },
      lockedOrderByDay: { 0: [twinBaseId, twinSecondId] },
      removedStops: [
        { id: twinBaseId, name: "Hidden Twin" },
        { id: twinSecondId, name: "Visible Twin" },
      ],
      legModeOverrides: { [`${twinBaseId}::${twinSecondId}`]: "walk" },
    }),
  },
  {
    // tests/share-scope.test.ts:212-241
    name: "scope-catalogue-stable-ids",
    locale: "en",
    input: scopeInput({
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
    }),
  },
  {
    // tests/share-link.test.ts:168-178 — the selective scope keeps both resolution decisions.
    name: "scope-link-input-ja",
    locale: "ja",
    input: linkInput,
  },
];

/** The exact call `tests/share-link.test.ts:131-151` makes: a payload the type system forbids. */
function rawCode(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

const decodeVectors = [
  { name: "garbage", code: "not-base64!!" },
  { name: "empty", code: "" },
  { name: "not-json", code: Buffer.from("{oops", "utf8").toString("base64url") },
  { name: "wrong-length", code: Buffer.from("{}", "utf8").toString("base64url").slice(0, 1) },
  { name: "invalid-utf8", code: Buffer.from([0xff, 0xfe, 0x7b, 0x7d]).toString("base64url") },
  { name: "json-array", code: rawCode([1, 2, 3]) },
  { name: "json-string", code: rawCode("hello") },
  { name: "json-null", code: rawCode(null) },
  { name: "wrong-version", code: rawCode({ ...linkInput, v: 2 }) },
  { name: "no-version", code: rawCode({ ...linkInput }) },
  { name: "blank-itinerary", code: encodeTripShare({ ...linkInput, itinerary: "   " }) },
  { name: "missing-itinerary", code: rawCode({ v: 1, destination: "japan" }) },
  {
    // tests/share-link.test.ts:67-81
    name: "hostile-scalars",
    code: encodeTripShare({
      ...linkInput,
      tripDays: 99,
      pace: "hyperspeed",
      destination: "narnia",
      arrivalAirport: "lax",
      arrivalTime: "99:99",
    }),
  },
  { name: "forged-confirmed-date", code: encodeTripShare({ ...linkInput, tripStartDate: "2026-02-31", dateWasProvided: true }) },
  { name: "non-leap-day", code: encodeTripShare({ ...linkInput, tripStartDate: "2025-02-29", dateWasProvided: true }) },
  // `Date.UTC` maps a two-digit year into the 1900s, so `getUTCFullYear() === year` fails and a
  // year below 0100 is rejected however well-formed it looks. Month 00 and day 00 roll over.
  { name: "two-digit-year", code: encodeTripShare({ ...linkInput, tripStartDate: "0026-09-14", dateWasProvided: true }) },
  { name: "year-0100", code: encodeTripShare({ ...linkInput, tripStartDate: "0100-09-14", dateWasProvided: true }) },
  { name: "month-zero", code: encodeTripShare({ ...linkInput, tripStartDate: "2026-00-14", dateWasProvided: true }) },
  { name: "day-zero", code: encodeTripShare({ ...linkInput, tripStartDate: "2026-09-00", dateWasProvided: true }) },
  { name: "leap-day", code: encodeTripShare({ ...linkInput, tripStartDate: "2028-02-29", dateWasProvided: true }) },
  {
    // tests/share-link.test.ts:101-109 — a v1 link written before the two later fields existed.
    name: "legacy-no-date-flag",
    code: (() => {
      const legacy = { ...linkInput };
      delete legacy.dateWasProvided;
      delete legacy.resolutionOverrides;
      return encodeTripShare(legacy);
    })(),
  },
  {
    // tests/share-link.test.ts:111-129 — a provider result carrying mutable Google display fields.
    name: "provider-display-fields-stripped",
    code: encodeTripShare({
      ...linkInput,
      resolutionOverrides: [
        {
          inputIndex: 0,
          providerRef: "ChIJ_provider-only_123",
          name: "Mutable Google display name",
          address: "Mutable Google address",
          latitude: 35.1,
          longitude: 139.1,
          googleMapsUrl: "https://maps.google.com/private-detail",
        },
      ],
    }),
  },
  {
    // tests/share-link.test.ts:131-166
    name: "hostile-resolution-overrides",
    code: rawCode({
      v: 1,
      ...linkInput,
      itinerary: Array.from({ length: 24 }, (_, index) => `Place ${index}`).join("\n"),
      resolutionOverrides: [
        { inputIndex: -1, providerRef: "ChIJ_negative" },
        { inputIndex: 0, providerRef: "ChIJ_safe_0", name: "must be stripped", address: "must be stripped", latitude: 1, longitude: 2 },
        { inputIndex: 0, name: "duplicate", address: "duplicate", latitude: 1, longitude: 2 },
        { inputIndex: 1, name: "bad coordinate", address: "somewhere", latitude: 91, longitude: 2 },
        { inputIndex: 1, name: "  Manual pin  ", address: "  Traveller address  ", latitude: 35.1, longitude: 139.2, sourceUrl: "must be stripped" },
        { inputIndex: 22, providerRef: "places/not-a-place-id", name: "must not fall through", address: "provider content", latitude: 1, longitude: 2 },
        { inputIndex: 4_000, providerRef: "ChIJ_too_large" },
        ...Array.from({ length: 18 }, (_, index) => ({ inputIndex: index + 2, providerRef: `ChIJ_tail_${index + 2}` })),
      ],
    }),
  },
  {
    // Fractional, non-finite-adjacent and negative-zero coordinates, plus a manual pin whose
    // traveller text needs NFKC folding, control-character replacement and a UTF-16 truncation.
    name: "resolution-override-text-and-numbers",
    code: rawCode({
      v: 1,
      ...linkInput,
      resolutionOverrides: [
        { inputIndex: 0, name: "ﾊﾟﾝ		ケーキ  の  店", address: `${"あ".repeat(320)}`, latitude: -0, longitude: -0 },
        { inputIndex: 1, name: "x".repeat(200), address: "ok", latitude: 90, longitude: -180 },
        { inputIndex: 2, name: "  ", address: "blank name", latitude: 1, longitude: 2 },
        { inputIndex: 3, name: "no address", address: "   ", latitude: 1, longitude: 2 },
        { inputIndex: 4, name: "bad longitude", address: "ok", latitude: 1, longitude: 181 },
        { inputIndex: 5.5, name: "fractional index", address: "ok", latitude: 1, longitude: 2 },
        { inputIndex: 6, providerRef: "" },
        { inputIndex: 7, providerRef: "a".repeat(257) },
        { inputIndex: 8, providerRef: "ok-256_ref" },
        "not an object",
        null,
        [1, 2],
      ],
    }),
  },
  {
    // Every cap in the record cleaners at once: 90 stay entries, an over-long key, non-numeric
    // values, out-of-range clamps, 16 day-time keys, malformed day keys, 40 locked ids with
    // duplicates, 30 removed stops, and leg modes with a bad mode and an over-long key.
    name: "record-caps",
    code: rawCode({
      v: 1,
      ...linkInput,
      userStayMinutes: {
        ...Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`stop-${index}`, index * 10])),
        ["k".repeat(201)]: 60,
        "": 60,
        "not-a-number": "60",
        "too-small": 1,
        "too-large": 5_000,
        fractional: 42.6,
      },
      lastEntryTimes: {
        ...Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`stop-${index}`, "16:30"])),
        bad: "25:00",
        ["k".repeat(201)]: "10:00",
      },
      dayStartTimes: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [String(index), "08:00"])),
      dayEndTimes: { 0: "19:45", "07": "20:00", "-1": "21:00", 13: "22:00", 14: "23:00", 2: "bad" },
      legModeOverrides: {
        "a::b": "walk",
        "c::d": "hovercraft",
        ["k".repeat(301)]: "walk",
        "": "taxi",
        ...Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`leg-${index}`, "transit"])),
      },
      dayOverrides: { "google-skytree": 20, negative: -3, ok: 7 },
      lockedOrderByDay: {
        0: [...Array.from({ length: 40 }, (_, index) => `id-${index}`), "id-0"],
        1: ["dup", "dup", "", "k".repeat(201), "keep"],
        2: "not an array",
        14: ["out of range"],
        3: [],
      },
      removedStops: [
        ...Array.from({ length: 30 }, (_, index) => ({ id: `removed-${index}`, name: `Removed ${index}` })),
        { id: "blank-name", name: "   " },
        { id: "", name: "no id" },
        { id: "trimmed", name: `  ${"n".repeat(200)}  ` },
      ],
      maxWalkingMinutesPerLeg: 999,
      maxTransfersPerLeg: -4,
      transferBufferMinutes: 25,
      dayStartDefault: "nope",
      dayEndTarget: "24:00",
      departureAirport: "HNDX",
      mealPlan: "brunch",
      travelPreference: "boat",
      flightKind: "orbital",
    }),
  },
];

const file = {
  schemaVersion: 1,
  generatedBy: "scripts/export-share-vectors.mjs",
  source: ["lib/share-link.ts", "lib/share-scope.ts"],
  maxShareFragmentChars: 6_000,
  vectors: vectors.map(({ name, locale, input: source }) => {
    const input = inDeclaredOrder(source);
    const expectedCode = encodeTripShare(input);
    const decoded = decodeTripShare(expectedCode);
    return {
      name,
      locale,
      input,
      expectedCode,
      decoded,
      decodedCode: decoded === null ? null : encodeTripShare(decoded),
      scopes: scopeCombinations.map(({ name: scopeName, scope }) => {
        const result = buildScopedTripShare(input, scope, locale);
        return {
          name: scopeName,
          scope,
          input: result.input,
          inputCode: result.input === null ? null : encodeTripShare(result.input),
          code: result.code,
          warnings: result.warnings,
          omittedUnparsedLines: result.omittedUnparsedLines,
          redactedReservationCount: result.redactedReservationCount,
          blocked: result.blocked,
        };
      }),
    };
  }),
  decodeVectors: decodeVectors.map(({ name, code }) => {
    const decoded = decodeTripShare(code);
    return { name, code, decoded, decodedCode: decoded === null ? null : encodeTripShare(decoded) };
  }),
};

const out = parseArguments(process.argv.slice(2));
writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
console.log(`wrote ${file.vectors.length} vectors and ${file.decodeVectors.length} decode vectors to ${out}`);
