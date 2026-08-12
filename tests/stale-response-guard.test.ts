/**
 * DoD-REL-3「stale resultを通常結果に見せない」.
 *
 * Every paid provider call in the planner is fired from a hook and resolves
 * long after the user may have changed the trip. The planner's answer to that
 * is a single generation counter, `buildRunRef`: each lifecycle event that
 * invalidates in-flight work bumps it, each async worker captures the value it
 * started with, and no state is written once the two disagree.
 *
 * There is no React test harness in this repo (see tests/README of the QA
 * harness), so this is a source contract: it fails when a lifecycle entry
 * point stops bumping the generation, when a hook stops receiving the shared
 * ref, or when a hook's staleness helper is deleted. It cannot prove the
 * absence of a race — the E2E harness covers the observable flow — but it
 * makes the guard impossible to remove silently.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hookUrl = (name: string) => new URL(`../app/components/planner/hooks/${name}`, import.meta.url);
const read = (name: string) => readFileSync(hookUrl(name), "utf8");

const buildSource = read("usePlanBuild.tsx");

/** The body of `name`, from its declaration to the next top-level `function`. */
function functionBody(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found — the build hook was restructured`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n {2}(?:async )?function \w+\(/);
  return rest.slice(0, end === -1 ? undefined : end);
}

test("the planner keeps exactly one build generation and shares it with the async hooks", () => {
  assert.match(buildSource, /const buildRunRef = useRef\(0\)/);
  // The ref is handed to the hooks that own the paid clients rather than
  // re-created per hook; a second counter would let one hook's stale answer
  // survive another hook's reset.
  for (const hook of ["useFoodAndGaps.tsx", "useHotels.tsx", "useTransitEvidence.tsx"]) {
    const source = read(hook);
    assert.match(source, /buildRunRef: RefObject<number>;/, `${hook} no longer takes the shared build generation`);
    assert.match(
      source,
      /buildRunRef\.current !== runId/,
      `${hook} no longer compares in-flight work against the build generation`,
    );
  }
});

test("every trip lifecycle event invalidates in-flight provider work", () => {
  // Locale switch, sample load, a new build, reset and an explicit cancel all
  // make earlier answers wrong: each must bump the generation.
  for (const name of ["changeLocale", "loadDemo", "buildPlan", "resetTrip", "cancelBuild"]) {
    assert.match(
      functionBody(buildSource, name),
      /buildRunRef\.current (?:\+= 1|= buildRunRef\.current \+ 1)|\+\+buildRunRef\.current/,
      `${name} no longer invalidates in-flight provider work`,
    );
  }
});

test("the build run refuses to write state once its generation is superseded", () => {
  const body = functionBody(buildSource, "buildPlan");
  assert.match(body, /const runId = \+\+buildRunRef\.current/);
  assert.match(body, /const cancelled = \(\) => controller\.signal\.aborted \|\| buildRunRef\.current !== runId/);
  // Every state write inside the build goes through `commit`, so the guard is
  // one decision instead of one-per-setter.
  assert.match(body, /const commit = \(action: \(\) => void\) => \{[^]*?if \(cancelled\(\)\) return;/);
});

test("place checks discard their own late answers instead of overwriting a newer trip", () => {
  const body = functionBody(buildSource, "checkPlace");
  assert.match(body, /const runId = buildRunRef\.current;\s*\n\s*const stale = \(\) => buildRunRef\.current !== runId;/);
  // Both the success and the failure path of each awaited provider call are
  // guarded — an unguarded catch would surface a dead trip's error state.
  const awaits = body.match(/await request\w+\(/g) ?? [];
  assert.ok(awaits.length >= 2, "checkPlace no longer awaits the place providers");
  assert.equal((body.match(/if \(stale\(\)\) return;/g) ?? []).length, 4);
});
