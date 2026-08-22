// Exports the TypeScript engine's plan/fit/evidence/result for every scenario in one or more
// corpus files, so the Swift port (`apple/Packages/TripCheckKit`) can diff itself field by field
// against the engine it was ported from (G3 in the Swift v1 plan).
//
// The four calls below are exactly `runScenario` in `tests/golden-feasibility.test.ts:60-67`;
// nothing in `lib/` is imported for any other purpose and nothing in `lib/` is modified.
//
// Usage:
//   node --experimental-strip-types scripts/export-golden-snapshots.mjs \
//     --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-snapshots.v1.json \
//     tests/fixtures/golden-feasibility.v1.json
//
// A corpus is `{ scenarios: [{ id, trip: { raw, days, pace, locale, context }, evidence }] }` —
// the golden corpus and the hand-written builder corpus share that shape.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { buildTripFromWishlist } = await import("../lib/trip-builder.ts");
const { assessTripFit } = await import("../lib/trip-scenarios.ts");
const { createPlannerEvidenceSnapshot, deriveFeasibilityResult } = await import(
  "../lib/feasibility-result.ts"
);

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function parseArguments(argv) {
  const inputs = [];
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out" || argument === "-o") {
      out = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--out=")) {
      out = argument.slice("--out=".length);
      continue;
    }
    inputs.push(argument);
  }
  if (!out) throw new Error("missing --out <path>");
  if (inputs.length === 0) throw new Error("missing at least one input corpus path");
  return { inputs, out };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

const { inputs, out } = parseArguments(process.argv.slice(2));

const snapshots = [];
const seen = new Set();
for (const input of inputs) {
  const corpus = JSON.parse(readFileSync(input, "utf8"));
  for (const scenario of corpus.scenarios) {
    if (seen.has(scenario.id)) throw new Error(`duplicate scenario id across corpora: ${scenario.id}`);
    seen.add(scenario.id);
    const { raw, days, pace, locale, context } = scenario.trip;
    // tests/golden-feasibility.test.ts:60-67 — the exact four-stage call sequence.
    const plan = buildTripFromWishlist(raw, days, pace, locale, context);
    const fit = assessTripFit(raw, days, pace, locale, context, plan);
    const evidence = createPlannerEvidenceSnapshot(plan, scenario.evidence);
    const result = deriveFeasibilityResult(plan, fit, evidence);
    snapshots.push({ id: scenario.id, plan, fit, evidence, result });
  }
}

// `JSON.stringify` drops `undefined`-valued keys, so an absent TS field and an unset one are the
// same absence in the export — which is what the Swift side compares a nil Optional against.
writeFileSync(out, `${JSON.stringify({ schemaVersion: 1, generatedFrom: gitHead(), snapshots })}\n`);
process.stdout.write(`${snapshots.length} snapshots -> ${out}\n`);
