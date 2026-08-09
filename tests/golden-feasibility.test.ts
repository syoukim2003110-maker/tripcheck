import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPlannerEvidenceSnapshot,
  deriveFeasibilityResult,
  type ConflictCode,
  type CriticalFactKind,
  type EvidenceSnapshotOptions,
  type FeasibilityState,
} from "../lib/feasibility-result.ts";
import { buildTripFromWishlist, type Pace, type TripPlannerContext } from "../lib/trip-builder.ts";
import { assessTripFit } from "../lib/trip-scenarios.ts";

type GoldenOracle = {
  hardConflictExpected: boolean;
  expectedStateOneOf: FeasibilityState[];
  requiredConflictCodes: ConflictCode[];
  forbiddenConflictCodes: ConflictCode[];
  mustScheduledIds: string[];
  expectedUnknownKinds?: CriticalFactKind[];
  solverTimedOut?: boolean;
};

type GoldenScenario = {
  id: string;
  region: string;
  archetype: string;
  seed: number;
  pairId?: string;
  realWorldAccuracyClaim: false;
  providerCallsAllowed: false;
  trip: {
    raw: string;
    days: number;
    pace: Pace;
    locale: "en" | "ja";
    context: TripPlannerContext;
  };
  evidence: EvidenceSnapshotOptions;
  oracle: GoldenOracle;
  provenance: {
    kind: "synthetic_contract_fixture";
    generatorVersion: string;
    realWorldAccuracyClaim: false;
  };
};

type GoldenCorpus = {
  schemaVersion: 1;
  corpusId: string;
  description: string;
  generatedBy: string;
  rootSeed: number;
  realWorldAccuracyClaim: false;
  providerCallsAllowed: false;
  fixedAt: string;
  regionQuotas: Record<string, number>;
  scenarios: GoldenScenario[];
};

const FIXTURE_URL = new URL("./fixtures/golden-feasibility.v1.json", import.meta.url);
const corpus = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as GoldenCorpus;

function runScenario(scenario: GoldenScenario) {
  const { raw, days, pace, locale, context } = scenario.trip;
  const plan = buildTripFromWishlist(raw, days, pace, locale, context);
  const fit = assessTripFit(raw, days, pace, locale, context, plan);
  const evidence = createPlannerEvidenceSnapshot(plan, scenario.evidence);
  const result = deriveFeasibilityResult(plan, fit, evidence);
  return { plan, fit, evidence, result };
}

function canonicalRun(scenario: GoldenScenario) {
  const run = runScenario(scenario);
  return JSON.stringify({
    plan: run.plan,
    fit: run.fit,
    evidence: run.evidence,
    result: run.result,
  });
}

test("the checked-in corpus has exactly the declared 500 synthetic scenarios", () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.realWorldAccuracyClaim, false);
  assert.equal(corpus.providerCallsAllowed, false);
  assert.match(corpus.description, /Synthetic contract fixtures/i);
  assert.match(corpus.description, /do not measure real-world/i);
  assert.equal(corpus.scenarios.length, 500);
  assert.deepEqual(corpus.regionQuotas, {
    Tokyo: 250,
    "Kyoto-Osaka": 75,
    Switzerland: 50,
    Europe: 50,
    US: 25,
    Edge: 50,
  });

  const regionCounts: Record<string, number> = {};
  const ids = new Set<string>();
  const archetypes = new Set<string>();
  for (const scenario of corpus.scenarios) {
    regionCounts[scenario.region] = (regionCounts[scenario.region] ?? 0) + 1;
    assert.equal(ids.has(scenario.id), false, `duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    archetypes.add(scenario.archetype);
    assert.equal(scenario.realWorldAccuracyClaim, false, scenario.id);
    assert.equal(scenario.providerCallsAllowed, false, scenario.id);
    assert.equal(scenario.provenance.kind, "synthetic_contract_fixture", scenario.id);
    assert.equal(scenario.provenance.realWorldAccuracyClaim, false, scenario.id);
    assert.ok(Number.isInteger(scenario.seed), scenario.id);
    for (const stop of scenario.trip.context.resolvedStops ?? []) {
      assert.match(stop.sourceUrl, /^https:\/\/example\.test\/golden\//, scenario.id);
      assert.equal(stop.providerRef, undefined, `${scenario.id} must not contain a provider identifier`);
    }
  }
  assert.deepEqual(regionCounts, corpus.regionQuotas);
  assert.deepEqual([...archetypes].sort(), [
    "closed_on_fixed_day",
    "day_end_conflict",
    "day_end_repaired",
    "fixed_booking_late",
    "fixed_booking_repaired",
    "last_entry_conflict",
    "last_entry_repaired",
    "open_on_fixed_day",
    "solver_timeout",
    "unknown_hours",
  ]);
});

test("all 500 scenarios honor their independent hard-conflict oracle without provider calls", () => {
  const originalFetch = globalThis.fetch;
  let providerCallCount = 0;
  globalThis.fetch = (async () => {
    providerCallCount += 1;
    throw new Error("provider calls are forbidden in the synthetic golden corpus");
  }) as typeof fetch;

  let expectedHardConflictCount = 0;
  let falseNegativeCount = 0;
  try {
    for (const scenario of corpus.scenarios) {
      const { plan, evidence, result } = runScenario(scenario);
      const actualCodes = new Set(result.conflicts.map((conflict) => conflict.code));
      const evidenceIds = new Set(evidence.facts.map((fact) => fact.id));
      const scheduledIds = new Set(plan.days.flatMap((day) => day.stops.map((stop) => stop.stop.id)));

      assert.ok(scenario.oracle.expectedStateOneOf.includes(result.state), `${scenario.id}: unexpected state ${result.state}`);
      for (const code of scenario.oracle.requiredConflictCodes) {
        assert.equal(actualCodes.has(code), true, `${scenario.id}: missing ${code}`);
      }
      for (const code of scenario.oracle.forbiddenConflictCodes) {
        assert.equal(actualCodes.has(code), false, `${scenario.id}: unexpected ${code}`);
      }
      for (const id of scenario.oracle.mustScheduledIds) {
        assert.equal(scheduledIds.has(id), true, `${scenario.id}: Must stop ${id} was dropped`);
      }
      for (const conflict of result.conflicts) {
        assert.ok(conflict.evidenceIds.length > 0, `${scenario.id}: ${conflict.code} has no evidence`);
        assert.ok(conflict.evidenceIds.every((id) => evidenceIds.has(id)), `${scenario.id}: ${conflict.code} has dangling evidence`);
      }
      for (const kind of scenario.oracle.expectedUnknownKinds ?? []) {
        assert.ok(
          evidence.facts.some((fact) => fact.kind === kind && (fact.evidence.status === "unknown" || fact.evidence.status === "failed")),
          `${scenario.id}: expected unknown ${kind}`,
        );
      }
      if (result.criticalFacts.unknown > 0) {
        assert.notEqual(result.state, "VERIFIED_FEASIBLE", `${scenario.id}: unknown evidence was upgraded to verified`);
      }

      if (scenario.oracle.hardConflictExpected) {
        expectedHardConflictCount += 1;
        if (result.state !== "INFEASIBLE_HARD_CONFLICT") falseNegativeCount += 1;
      } else {
        assert.notEqual(result.state, "INFEASIBLE_HARD_CONFLICT", `${scenario.id}: repaired/non-hard scenario became hard-infeasible`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(expectedHardConflictCount >= 200, "the corpus must contain a substantial positive hard-conflict set");
  assert.equal(falseNegativeCount, 0, `${falseNegativeCount}/${expectedHardConflictCount} expected hard conflicts were missed`);
  assert.equal(providerCallCount, 0);
});

test("declared repair pairs flip hard feasibility while preserving the synthetic trip identity", () => {
  const pairs = new Map<string, GoldenScenario[]>();
  for (const scenario of corpus.scenarios) {
    if (!scenario.pairId) continue;
    pairs.set(scenario.pairId, [...(pairs.get(scenario.pairId) ?? []), scenario]);
  }
  assert.ok(pairs.size >= 190);
  for (const [pairId, scenarios] of pairs) {
    assert.equal(scenarios.length, 2, pairId);
    const hard = scenarios.find((scenario) => scenario.oracle.hardConflictExpected);
    const repaired = scenarios.find((scenario) => !scenario.oracle.hardConflictExpected);
    assert.ok(hard, `${pairId}: missing hard member`);
    assert.ok(repaired, `${pairId}: missing repaired member`);
    assert.equal(hard.trip.raw, repaired.trip.raw, `${pairId}: the repair must preserve raw input`);
    assert.deepEqual(hard.trip.context.resolvedStops, repaired.trip.context.resolvedStops, `${pairId}: the repair must preserve place identity`);
    assert.equal(runScenario(hard).result.state, "INFEASIBLE_HARD_CONFLICT", pairId);
    assert.notEqual(runScenario(repaired).result.state, "INFEASIBLE_HARD_CONFLICT", pairId);
  }
});

test("all 500 snapshots are deterministic and each archetype survives 100 repetitions", () => {
  for (const scenario of corpus.scenarios) {
    assert.equal(canonicalRun(scenario), canonicalRun(scenario), scenario.id);
  }

  const representatives = new Map<string, GoldenScenario>();
  for (const scenario of corpus.scenarios) {
    if (!representatives.has(scenario.archetype)) representatives.set(scenario.archetype, scenario);
  }
  for (const scenario of representatives.values()) {
    const expected = canonicalRun(scenario);
    for (let repetition = 0; repetition < 100; repetition += 1) {
      assert.equal(canonicalRun(scenario), expected, `${scenario.id}: nondeterministic repetition ${repetition + 1}`);
    }
  }
});
