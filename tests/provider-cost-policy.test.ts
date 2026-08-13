import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROVIDER_COST_OPERATIONS,
  PROVIDER_COST_POLICIES,
  providerDailyCeilingUnits,
} from "../lib/server/provider-cost-policy.ts";
import { DURABLE_PROVIDER_QUOTA_POLICIES } from "../lib/server/durable-provider-quota.ts";
import { PAID_OPERATION_POLICIES } from "../lib/server/provider-gateway.ts";
import { PROVIDER_QUOTA_OPERATIONS } from "../db/provider-quota-schema.ts";

// P1-04. The durable D1 ledger and the process-local fail-safe used to hold
// two hand-maintained copies of every ceiling, with nothing asserting they
// agreed: raising one of them tenfold left all 31 quota tests green. Both are
// now derived from PROVIDER_COST_POLICIES, and these tests make an accidental
// widening loud.

test("the durable ledger is a faithful view of the one cost policy", () => {
  assert.deepEqual(
    Object.keys(DURABLE_PROVIDER_QUOTA_POLICIES).sort(),
    [...PROVIDER_COST_OPERATIONS].sort(),
  );
  for (const operation of PROVIDER_COST_OPERATIONS) {
    const source = PROVIDER_COST_POLICIES[operation];
    assert.deepEqual(DURABLE_PROVIDER_QUOTA_POLICIES[operation], {
      provider: source.provider,
      maxPerRequest: source.maxPerRequest,
      maxPerTrip: source.maxPerTrip,
      maxPerSessionDay: source.maxPerSessionDay,
      maxPerDay: source.maxPerDay,
      maxPerMonth: source.maxPerMonth,
    }, `${operation} drifted from the cost policy`);
  }
});

test("the process-local fail-safe is a faithful view of the one cost policy", () => {
  assert.deepEqual(
    Object.keys(PAID_OPERATION_POLICIES).sort(),
    [...PROVIDER_COST_OPERATIONS].sort(),
  );
  for (const operation of PROVIDER_COST_OPERATIONS) {
    const source = PROVIDER_COST_POLICIES[operation];
    assert.deepEqual(PAID_OPERATION_POLICIES[operation], {
      provider: source.provider,
      maxPerRequest: source.maxPerRequest,
      maxPerTrip: source.maxPerTrip,
      maxPerSession: source.maxPerSessionDay,
      maxPerProcessDay: source.maxPerDay,
    }, `${operation} drifted from the cost policy`);
  }
});

test("the D1 CHECK constraint covers exactly the operations that can be charged", () => {
  assert.deepEqual([...PROVIDER_QUOTA_OPERATIONS], [...PROVIDER_COST_OPERATIONS]);
});

test("a limit can only be raised by editing the reviewed snapshot", () => {
  // A deliberate rewrite of this table is a reviewed change. A stray digit is
  // not: any edit that moves a ceiling has to move this snapshot with it.
  assert.deepEqual(
    Object.fromEntries(PROVIDER_COST_OPERATIONS.map((operation) => [operation, [
      PROVIDER_COST_POLICIES[operation].provider,
      PROVIDER_COST_POLICIES[operation].maxPerRequest,
      PROVIDER_COST_POLICIES[operation].maxPerTrip,
      PROVIDER_COST_POLICIES[operation].maxPerSessionDay,
      PROVIDER_COST_POLICIES[operation].maxPerDay,
      PROVIDER_COST_POLICIES[operation].maxPerMonth,
    ]])),
    {
      live_routes: ["google", 20, 120, 360, 2_000, 20_000],
      place_resolution: ["google", 12, 36, 108, 1_200, 12_000],
      place_suggestions: ["google", 1, 60, 180, 3_000, 30_000],
      place_intelligence: ["google", 1, 30, 90, 1_000, 10_000],
      fresh_voices: ["anthropic", 2, 24, 48, 192, 1_920],
      hotel_recommendations: ["google", 4, 60, 180, 600, 6_000],
      food_recommendations: ["google", 2, 112, 336, 2_000, 20_000],
      food_ranking: ["anthropic", 1, 28, 56, 192, 1_920],
      hotel_ranking: ["anthropic", 1, 12, 24, 96, 960],
      route_recommendations: ["google", 3, 84, 168, 300, 9_000],
      place_photo: ["google", 1, 150, 450, 3_000, 30_000],
    },
  );
});

test("the total daily spend ceiling is pinned per provider", () => {
  assert.equal(providerDailyCeilingUnits("google"), 13_100);
  assert.equal(providerDailyCeilingUnits("anthropic"), 480);
  assert.equal(
    providerDailyCeilingUnits("google") + providerDailyCeilingUnits("anthropic"),
    13_580,
    "one deployment-day of provider request-events across every paid operation",
  );
});

test("every ceiling is a positive integer and grows with its scope", () => {
  for (const operation of PROVIDER_COST_OPERATIONS) {
    const policy = PROVIDER_COST_POLICIES[operation];
    for (const [name, value] of Object.entries(policy)) {
      if (name === "provider") continue;
      assert.ok(Number.isInteger(value) && (value as number) > 0, `${operation}.${name} must be a positive integer`);
    }
    assert.ok(policy.maxPerRequest <= policy.maxPerTrip, `${operation}: one request may not exceed a trip`);
    assert.ok(policy.maxPerTrip <= policy.maxPerSessionDay, `${operation}: one trip may not exceed a session day`);
    assert.ok(policy.maxPerSessionDay <= policy.maxPerDay, `${operation}: one session may not exceed the deployment day`);
    assert.ok(policy.maxPerDay <= policy.maxPerMonth, `${operation}: one day may not exceed the month`);
  }
});

test("no ceiling is defined anywhere but the cost policy", () => {
  for (const path of ["lib/server/durable-provider-quota.ts", "lib/server/provider-gateway.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const declarations = source.match(/max(?:PerRequest|PerTrip|PerSession|PerSessionDay|PerDay|PerProcessDay|PerMonth)\s*:\s*[0-9_]+/g) ?? [];
    assert.deepEqual(declarations, [], `${path} must read its ceilings from provider-cost-policy.ts`);
  }
});
