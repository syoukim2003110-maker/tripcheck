import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CORE_RECOMMENDATION_FEATURE_FLAGS,
  coreRecommendationApiEnabled,
  coreRecommendationApiGate,
} from "../lib/server/non-core-api-gate.ts";
import { API_ROUTE_KEYS, API_ROUTE_POLICIES } from "../lib/server/api-route-policy.ts";

// P1-06 / P1-07. Two defects that both come down to a document and a
// behaviour disagreeing:
//
//   * The README said hotel, food and trip-idea routes all fail closed until an
//     operator enables them. Since v0.3 the first two are core and default on,
//     and only the broad experiments are opt-in. An operator reading it would
//     have mis-scoped both the running cost and the incident kill procedure.
//   * The Worker trusted a client-supplied session header over its own HttpOnly
//     cookie, so rotating that header walked past every per-session and
//     per-trip ceiling.

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const ENV_EXAMPLE = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");

test("the core recommendation flags really do default on", () => {
  for (const feature of Object.keys(CORE_RECOMMENDATION_FEATURE_FLAGS) as (keyof typeof CORE_RECOMMENDATION_FEATURE_FLAGS)[]) {
    const flag = CORE_RECOMMENDATION_FEATURE_FLAGS[feature];
    assert.equal(coreRecommendationApiEnabled(feature, {}), true, `${flag} unset must leave the route on`);
    assert.equal(coreRecommendationApiEnabled(feature, { [flag]: "true" }), true);
    assert.equal(coreRecommendationApiEnabled(feature, { [flag]: "false" }), false, `${flag}=false must be the kill switch`);
    // Anything that is not exactly "false" leaves the route running, so a
    // typo can never silently disable a core surface.
    assert.equal(coreRecommendationApiEnabled(feature, { [flag]: "FALSE" }), true);
    assert.equal(coreRecommendationApiEnabled(feature, { [flag]: "" }), true);
    assert.equal(coreRecommendationApiGate(feature, {}), null);
    assert.equal(coreRecommendationApiGate(feature, { [flag]: "false" })?.status, 503);
  }
});

test("the README describes the switches the code actually has", () => {
  assert.match(README, /run by default/i, "core recommendations must be documented as default-on");
  assert.match(README, /TRIPCHECK_NON_CORE_APIS_ENABLED=true/, "the opt-in experiment switch must be named");
  assert.match(README, /ANTHROPIC_REQUESTS_ENABLED=true/, "the Anthropic pause must be named");
  for (const flag of Object.values(CORE_RECOMMENDATION_FEATURE_FLAGS)) {
    assert.match(README, new RegExp(flag), `${flag} must be documented`);
    assert.match(ENV_EXAMPLE, new RegExp(`^${flag}=`, "m"), `${flag} must appear in .env.example`);
  }
  // The old claim, which said the core recommendation routes fail closed.
  assert.doesNotMatch(
    README.replaceAll("\n", " "),
    /Food discovery, hotel comparison, trip-idea generation and other non-core experiments[\s\S]*?fail closed/,
    "the superseded fail-closed claim must not come back",
  );
});

test(".env.example agrees with the defaults rather than contradicting them", () => {
  for (const flag of Object.values(CORE_RECOMMENDATION_FEATURE_FLAGS)) {
    const line = new RegExp(`^${flag}=(.*)$`, "m").exec(ENV_EXAMPLE);
    assert.ok(line, `${flag} missing from .env.example`);
    assert.equal(
      coreRecommendationApiEnabled(
        (Object.keys(CORE_RECOMMENDATION_FEATURE_FLAGS) as (keyof typeof CORE_RECOMMENDATION_FEATURE_FLAGS)[])
          .find((feature) => CORE_RECOMMENDATION_FEATURE_FLAGS[feature] === flag)!,
        { [flag]: line[1] },
      ),
      true,
      `${flag} is documented as ${line[1]}, which does not match the shipped default`,
    );
  }
  assert.match(ENV_EXAMPLE, /^TRIPCHECK_NON_CORE_APIS_ENABLED=false$/m);
  assert.match(ENV_EXAMPLE, /^ANTHROPIC_REQUESTS_ENABLED=false$/m);
});

test("every paid route that carries a feature flag names one the gate knows", () => {
  const known = new Set([...Object.values(CORE_RECOMMENDATION_FEATURE_FLAGS), "ANTHROPIC_REQUESTS_ENABLED"]);
  for (const key of API_ROUTE_KEYS) {
    for (const flag of API_ROUTE_POLICIES[key].featureFlags ?? []) {
      assert.ok(known.has(flag.name), `${key} names an unknown feature flag ${flag.name}`);
    }
  }
});

test("the Worker charges the session it issued, not the one the caller claims", () => {
  const identity = WORKER.slice(WORKER.indexOf("function quotaIdentity"), WORKER.indexOf("async function paidRequestUnits"));
  assert.ok(identity.length > 0);
  assert.match(identity, /cookieValue\(request, SESSION_COOKIE\)/, "the cookie must be the session source");
  assert.doesNotMatch(
    identity,
    /request\.headers\.get\("X-TripCheck-Session"\)/,
    "a caller-supplied session header must not decide who is billed",
  );
  assert.match(identity, /HttpOnly; SameSite=Lax/, "the issued cookie must stay HttpOnly");
  // The trip token is still the client's, but namespaced under the session so
  // it cannot be aimed at another actor's counter.
  assert.match(identity, /\$\{sessionId\.slice\(0, 16\)\}_\$\{tripScope\}/);
});
