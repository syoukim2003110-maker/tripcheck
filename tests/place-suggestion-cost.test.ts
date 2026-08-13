import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { DURABLE_PROVIDER_QUOTA_POLICIES } from "../lib/server/durable-provider-quota.ts";
import { PAID_OPERATION_POLICIES } from "../lib/server/provider-gateway.ts";
import { PROVIDER_QUOTA_OPERATIONS } from "../db/provider-quota-schema.ts";

/*
 * Autocomplete fires on every accepted typing pause, which makes it the one
 * paid path a traveller can trigger dozens of times before a plan exists.
 * These are the two properties that keep that affordable, both of which were
 * absent when the feature first landed:
 *   1. it is charged to its own operation, so typing cannot exhaust the
 *      place-resolution budget the build itself needs;
 *   2. the request is keyed and cached, so an unchanged query is not re-billed
 *      when the caret moves, the field is refocused, or the line is revisited.
 */

const suggestionsHookUrl = new URL("../app/components/planner/hooks/usePlaceSuggestions.tsx", import.meta.url);

test("place suggestions are charged to their own budget, never place resolution", async () => {
  assert.ok(PROVIDER_QUOTA_OPERATIONS.includes("place_suggestions"));
  const durable = DURABLE_PROVIDER_QUOTA_POLICIES.place_suggestions;
  const process = PAID_OPERATION_POLICIES.place_suggestions;
  assert.equal(durable.provider, "google");
  assert.equal(process.provider, "google");
  // One accepted pause is one prediction request; a client asking for more in
  // a single call is a client that has been modified.
  assert.equal(durable.maxPerRequest, 1);
  assert.equal(process.maxPerRequest, 1);
  // The two ledgers must not drift: the process-local fail-safe is what holds
  // when the durable one is unavailable.
  assert.equal(durable.maxPerTrip, process.maxPerTrip);
  assert.equal(durable.maxPerSessionDay, process.maxPerSession);
  // Typing is more frequent than resolving, so its own ceiling has to be the
  // looser of the two, or the split achieves nothing.
  assert.ok(durable.maxPerTrip > DURABLE_PROVIDER_QUOTA_POLICIES.place_resolution.maxPerTrip);

  const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(workerSource, /"\/api\/place-suggestions": Object\.freeze\(\{ provider: "google", operation: "place_suggestions" \}\)/);
  const routeSource = await readFile(new URL("../app/api/place-suggestions/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /reserve\(preflight, "place_suggestions", 1\)/);
  assert.doesNotMatch(routeSource, /place_resolution/);
});

test("an unchanged query is not re-billed while the caret moves around it", async () => {
  const source = await readFile(suggestionsHookUrl, "utf8");
  // The request identity is the query, not the target object: a fresh object
  // describing the same place occurrence used to restart the request, costing
  // one Google event per cursor keypress.
  assert.match(source, /function requestKey\(query: string, destination: DestinationChoice, locale: PlannerLocale\)/);
  assert.match(source, /if \(current && current\.key === key && current\.target\.inputIndex === target\.inputIndex\) return current;/);
  // Answered keys are reused instead of refetched.
  assert.match(source, /const cached = cacheRef\.current\.get\(request\.key\);/);
  assert.match(source, /cacheRef\.current\.set\(request\.key, suggestions\);/);
  // A failure must stay uncached so the next pause can recover.
  const catchStart = source.indexOf(".catch((error: unknown)");
  assert.ok(catchStart > 0);
  assert.doesNotMatch(source.slice(catchStart), /cacheRef\.current\.set/);
  // The cache is bounded; a long session must not grow it without limit.
  assert.match(source, /MAX_CACHED_QUERIES/);
  assert.match(source, /cacheRef\.current\.delete\(cacheRef\.current\.keys\(\)\.next\(\)\.value as string\)/);
});

test("planner components emit events; provider lookups stay in the hooks layer", async () => {
  const root = new URL("../app/components/planner/", import.meta.url);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const checked: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const path = `${entry.parentPath.replace(/\/?$/, "/")}${entry.name}`;
    if (path.includes("/hooks/")) continue;
    const text = await readFile(new URL(path, "file://"), "utf8");
    checked.push(path);
    assert.doesNotMatch(text, /\bfetch\s*\(/, `bare fetch( in ${path}`);
    // The "-client" modules are the transport layer. Components may import
    // their pure helpers and types, but calling one starts a provider request
    // from a leaf, which is what the hooks layer exists to prevent.
    for (const call of text.matchAll(/\brequest[A-Z][A-Za-z]*\s*\(/g)) {
      const name = call[0].replace(/\s*\($/, "");
      assert.ok(
        name === "requestAnimationFrame",
        `${path} calls ${name}(): provider requests belong in app/components/planner/hooks/`,
      );
    }
  }
  assert.ok(checked.length > 25, `component enumeration looks too small: ${checked.length} files`);
});
