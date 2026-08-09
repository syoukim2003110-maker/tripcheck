import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const FIXTURE_PATH = resolve(REPOSITORY_ROOT, "tests/fixtures/golden-feasibility.v1.json");
const ROOT_SEED = 20260809;
const FIXED_AT = "2026-08-09T00:00:00.000Z";
const TRIP_DATE = "2026-10-13";

const REGIONS = [
  { name: "Tokyo", slug: "tokyo", count: 250, latitude: 35.6812, longitude: 139.7671, countryCode: "JP" },
  { name: "Kyoto-Osaka", slug: "kyoto-osaka", count: 75, latitude: 34.9858, longitude: 135.7588, countryCode: "JP" },
  { name: "Switzerland", slug: "switzerland", count: 50, latitude: 46.948, longitude: 7.4474, countryCode: "CH" },
  { name: "Europe", slug: "europe", count: 50, latitude: 48.8566, longitude: 2.3522, countryCode: "FR" },
  { name: "US", slug: "us", count: 25, latitude: 40.7128, longitude: -74.006, countryCode: "US" },
  { name: "Edge", slug: "edge", count: 50, latitude: 0.25, longitude: 0.25, countryCode: "ZZ" },
];

const ARCHETYPES = [
  "day_end_conflict",
  "day_end_repaired",
  "fixed_booking_late",
  "fixed_booking_repaired",
  "closed_on_fixed_day",
  "open_on_fixed_day",
  "last_entry_conflict",
  "last_entry_repaired",
  "unknown_hours",
  "solver_timeout",
];

const PAIR_KINDS = ["day-end", "day-end", "fixed-booking", "fixed-booking", "opening-day", "opening-day", "last-entry", "last-entry"];

function hash32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededFraction(seed, salt) {
  let state = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return (state >>> 0) / 0x1_0000_0000;
}

function coordinate(origin, seed, salt) {
  const offset = (seededFraction(seed, salt) - 0.5) * 0.04;
  return Number((origin + offset).toFixed(6));
}

function pairMetadata(region, index, archetype) {
  const slot = index % ARCHETYPES.length;
  if (slot > 7) return {};
  const pairStart = slot % 2 === 0 ? index : index - 1;
  if (pairStart < 0 || pairStart + 1 >= region.count) return {};
  const kind = PAIR_KINDS[slot];
  if (!kind) throw new Error(`missing pair kind for ${archetype}`);
  return { pairId: `${region.slug}-${String(Math.floor(index / 10) + 1).padStart(3, "0")}-${kind}` };
}

function entityIdentity(region, index, pairId) {
  const entityKey = pairId ?? `${region.slug}-single-${String(index + 1).padStart(3, "0")}`;
  const seed = hash32(`${ROOT_SEED}:${entityKey}`);
  const suffix = entityKey.replaceAll("-", " ");
  return {
    id: `fixture-${entityKey}`,
    input: `Synthetic ${suffix}`,
    name: `Synthetic ${suffix}`,
    area: `Synthetic ${region.name}`,
    address: `Synthetic fixture address, ${region.name}`,
    latitude: coordinate(region.latitude, seed, 1),
    longitude: coordinate(region.longitude, seed, 2),
    countryCode: region.countryCode,
    sourceUrl: `https://example.test/golden/${entityKey}`,
    verifiedAt: FIXED_AT,
    confidence: "medium",
    planningDurationMinutes: 60,
    isAnchor: false,
  };
}

function baseContext(stop) {
  return {
    tripStartDate: TRIP_DATE,
    defaultDayStart: "09:00",
    dayEndTarget: "20:00",
    transferBufferMinutes: 0,
    durationOverrides: { [stop.id]: 60 },
    resolvedStops: [stop],
  };
}

function fullDayHours(stop) {
  return { [stop.id]: { 0: [{ openMinutes: 8 * 60, closeMinutes: 22 * 60 }] } };
}

function verifiedHoursEvidence(stop) {
  return {
    [stop.id]: {
      fetchedAt: FIXED_AT,
      dateSpecific: true,
      dateSpecificDates: [TRIP_DATE],
    },
  };
}

function baseEvidence(stop) {
  return {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: true,
    dayStartTimes: { 0: "09:00" },
    dayEndTimes: { 0: "20:00" },
    userDurationStopIds: [stop.id],
    capturedAt: FIXED_AT,
  };
}

function scenarioPayload(archetype, stop) {
  const context = baseContext(stop);
  const evidence = baseEvidence(stop);
  const ordinaryRaw = `${stop.input} — Day 1 must`;
  const bookingRaw = `${stop.input} — Day 1 09:00 booked`;
  const commonNonHardStates = ["VERIFIED_FEASIBLE", "PROVISIONAL_FEASIBLE", "FEASIBLE_IF_ASSUMPTIONS"];

  switch (archetype) {
    case "day_end_conflict":
      context.dayEndTarget = "09:30";
      context.durationOverrides[stop.id] = 120;
      context.openingWindowsByDay = fullDayHours(stop);
      evidence.dayEndTimes = { 0: "09:30" };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: true,
          expectedStateOneOf: ["INFEASIBLE_HARD_CONFLICT"],
          requiredConflictCodes: ["DAY_END_OVERRUN"],
          forbiddenConflictCodes: [],
          mustScheduledIds: [stop.id],
        },
      };
    case "day_end_repaired":
      context.dayEndTarget = "12:00";
      context.durationOverrides[stop.id] = 120;
      context.openingWindowsByDay = fullDayHours(stop);
      evidence.dayEndTimes = { 0: "12:00" };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: false,
          expectedStateOneOf: commonNonHardStates,
          requiredConflictCodes: [],
          forbiddenConflictCodes: ["DAY_END_OVERRUN"],
          mustScheduledIds: [stop.id],
        },
      };
    case "fixed_booking_late":
      context.defaultDayStart = "10:00";
      context.openingWindowsByDay = fullDayHours(stop);
      evidence.dayStartTimes = { 0: "10:00" };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      return {
        raw: bookingRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: true,
          expectedStateOneOf: ["INFEASIBLE_HARD_CONFLICT"],
          requiredConflictCodes: ["FIXED_BOOKING_LATE"],
          forbiddenConflictCodes: [],
          mustScheduledIds: [stop.id],
        },
      };
    case "fixed_booking_repaired":
      context.defaultDayStart = "08:00";
      context.openingWindowsByDay = fullDayHours(stop);
      evidence.dayStartTimes = { 0: "08:00" };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      return {
        raw: bookingRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: false,
          expectedStateOneOf: commonNonHardStates,
          requiredConflictCodes: [],
          forbiddenConflictCodes: ["FIXED_BOOKING_LATE"],
          mustScheduledIds: [stop.id],
        },
      };
    case "closed_on_fixed_day":
      context.openingWindowsByDay = { [stop.id]: { 0: [] } };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: true,
          expectedStateOneOf: ["INFEASIBLE_HARD_CONFLICT"],
          requiredConflictCodes: ["CLOSED_ON_FIXED_DAY"],
          forbiddenConflictCodes: [],
          mustScheduledIds: [stop.id],
        },
      };
    case "open_on_fixed_day":
      context.openingWindowsByDay = fullDayHours(stop);
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: false,
          expectedStateOneOf: commonNonHardStates,
          requiredConflictCodes: [],
          forbiddenConflictCodes: ["CLOSED_ON_FIXED_DAY"],
          mustScheduledIds: [stop.id],
        },
      };
    case "last_entry_conflict":
      context.defaultDayStart = "17:00";
      context.openingWindowsByDay = fullDayHours(stop);
      context.lastEntryTimes = { [stop.id]: "16:30" };
      evidence.dayStartTimes = { 0: "17:00" };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      evidence.lastEntryEvidenceByStop = { [stop.id]: { time: "16:30", status: "user_provided" } };
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: true,
          expectedStateOneOf: ["INFEASIBLE_HARD_CONFLICT"],
          requiredConflictCodes: ["LAST_ENTRY_CONFLICT"],
          forbiddenConflictCodes: [],
          mustScheduledIds: [stop.id],
        },
      };
    case "last_entry_repaired":
      context.defaultDayStart = "16:00";
      context.openingWindowsByDay = fullDayHours(stop);
      context.lastEntryTimes = { [stop.id]: "16:30" };
      evidence.dayStartTimes = { 0: "16:00" };
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      evidence.lastEntryEvidenceByStop = { [stop.id]: { time: "16:30", status: "user_provided" } };
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: false,
          expectedStateOneOf: commonNonHardStates,
          requiredConflictCodes: [],
          forbiddenConflictCodes: ["LAST_ENTRY_CONFLICT"],
          mustScheduledIds: [stop.id],
        },
      };
    case "unknown_hours":
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: false,
          expectedStateOneOf: ["FEASIBLE_IF_ASSUMPTIONS"],
          requiredConflictCodes: [],
          forbiddenConflictCodes: ["OPENING_HOURS_CONFLICT", "CLOSED_ON_FIXED_DAY", "LAST_ENTRY_CONFLICT"],
          mustScheduledIds: [stop.id],
          expectedUnknownKinds: ["opening_hours", "base"],
        },
      };
    case "solver_timeout":
      context.openingWindowsByDay = fullDayHours(stop);
      evidence.openingEvidenceByStop = verifiedHoursEvidence(stop);
      evidence.solverTimedOut = true;
      return {
        raw: ordinaryRaw,
        context,
        evidence,
        oracle: {
          hardConflictExpected: false,
          expectedStateOneOf: ["UNKNOWN"],
          requiredConflictCodes: [],
          forbiddenConflictCodes: [],
          mustScheduledIds: [stop.id],
          solverTimedOut: true,
        },
      };
    default:
      throw new Error(`unsupported archetype: ${archetype}`);
  }
}

function makeScenario(region, index) {
  const archetype = ARCHETYPES[index % ARCHETYPES.length];
  const pair = pairMetadata(region, index, archetype);
  const stop = entityIdentity(region, index, pair.pairId);
  const payload = scenarioPayload(archetype, stop);
  const ordinal = String(index + 1).padStart(3, "0");
  return {
    id: `${region.slug}-${ordinal}-${archetype}`,
    region: region.name,
    archetype,
    seed: hash32(`${ROOT_SEED}:${region.slug}:${index}`),
    ...pair,
    realWorldAccuracyClaim: false,
    providerCallsAllowed: false,
    trip: {
      raw: payload.raw,
      days: 1,
      pace: "balanced",
      locale: "en",
      context: payload.context,
    },
    evidence: payload.evidence,
    oracle: payload.oracle,
    provenance: {
      kind: "synthetic_contract_fixture",
      generatorVersion: "golden-feasibility-v1",
      realWorldAccuracyClaim: false,
    },
  };
}

export function buildGoldenFeasibilityCorpus() {
  return {
    schemaVersion: 1,
    corpusId: "tripcheck-synthetic-golden-feasibility-v1",
    description: "Synthetic contract fixtures for deterministic feasibility behavior. They do not measure real-world place, hours, or route accuracy.",
    generatedBy: "scripts/generate-golden-feasibility.mjs",
    rootSeed: ROOT_SEED,
    realWorldAccuracyClaim: false,
    providerCallsAllowed: false,
    fixedAt: FIXED_AT,
    regionQuotas: Object.fromEntries(REGIONS.map((region) => [region.name, region.count])),
    scenarios: REGIONS.flatMap((region) => Array.from({ length: region.count }, (_, index) => makeScenario(region, index))),
  };
}

export function serializeGoldenFeasibilityCorpus() {
  return `${JSON.stringify(buildGoldenFeasibilityCorpus(), null, 2)}\n`;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  const expected = serializeGoldenFeasibilityCorpus();
  if (mode === "--write") {
    writeFileSync(FIXTURE_PATH, expected, "utf8");
    process.stdout.write(`Wrote ${FIXTURE_PATH}\n`);
    return;
  }
  if (mode !== "--check") throw new Error("usage: node scripts/generate-golden-feasibility.mjs [--check|--write]");
  let actual;
  try {
    actual = readFileSync(FIXTURE_PATH, "utf8");
  } catch {
    throw new Error(`missing fixture: ${FIXTURE_PATH}`);
  }
  if (actual !== expected) {
    throw new Error("golden feasibility fixture is stale; run with --write and review the generated JSON");
  }
  process.stdout.write("Golden feasibility fixture is deterministic and current (500 synthetic scenarios).\n");
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) main();
