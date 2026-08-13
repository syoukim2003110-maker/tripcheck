import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  API_ROUTE_KEYS,
  API_ROUTE_POLICIES,
  apiRoutePolicy,
  paidApiRoutePolicies,
} from "../lib/server/api-route-policy.ts";
import { PROVIDER_COST_POLICIES } from "../lib/server/provider-cost-policy.ts";

// P1-01. The Worker's old paid-route table was looked up for POSTs only and
// the contract test asked for "at least eight" entries, so a paid GET could
// exist outside the cost boundary and deleting two registrations stayed green.
// This test diffs the manifest against the filesystem exactly: a new route,
// a new method on an existing route, or a deleted classification all fail.

const API_ROOT = new URL("../app/api/", import.meta.url);
const METHOD_EXPORT = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;

async function routeFiles(directory: URL, prefix = "/api"): Promise<{ path: string; file: URL }[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: { path: string; file: URL }[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      found.push(...await routeFiles(new URL(`${entry.name}/`, directory), `${prefix}/${entry.name}`));
    } else if (entry.name === "route.ts") {
      found.push({ path: prefix, file: new URL(entry.name, directory) });
    }
  }
  return found;
}

async function filesystemRouteMethods() {
  const keys: string[] = [];
  for (const { path, file } of await routeFiles(API_ROOT)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(METHOD_EXPORT)) keys.push(`${match[1]} ${path}`);
  }
  return keys.sort();
}

test("every exported API handler is classified, and nothing extra is", async () => {
  assert.deepEqual(await filesystemRouteMethods(), [...API_ROUTE_KEYS].sort());
});

test("the manifest key always matches the policy it holds", () => {
  for (const key of API_ROUTE_KEYS) {
    const policy = API_ROUTE_POLICIES[key];
    assert.equal(key, `${policy.method} ${policy.path}`);
    assert.equal(apiRoutePolicy(policy.method, policy.path), policy);
  }
});

test("a paid route always names a provider, an operation and an origin rule", () => {
  const paid = paidApiRoutePolicies();
  assert.equal(paid.length, 11, "eleven route-methods spend a metered provider key");
  for (const policy of paid) {
    assert.ok(policy.operation, `${policy.path} must name a quota operation`);
    assert.ok(policy.provider, `${policy.path} must name a provider`);
    assert.equal(
      PROVIDER_COST_POLICIES[policy.operation!].provider,
      policy.provider,
      `${policy.path} disagrees with the cost policy about who is billed`,
    );
    assert.ok(
      policy.origin === "strict_same_origin" || policy.origin === "signed_resource",
      `${policy.path} must be gated at the edge`,
    );
  }
});

test("the full classification is pinned, so a reclassification is a reviewed change", () => {
  assert.deepEqual(
    Object.fromEntries(API_ROUTE_KEYS.map((key) => [key, [
      API_ROUTE_POLICIES[key].class,
      API_ROUTE_POLICIES[key].operation ?? null,
      API_ROUTE_POLICIES[key].origin,
    ]])),
    {
      "POST /api/live-routes": ["paid", "live_routes", "strict_same_origin"],
      "POST /api/place-suggestions": ["paid", "place_suggestions", "strict_same_origin"],
      "POST /api/place-resolution": ["paid", "place_resolution", "strict_same_origin"],
      "POST /api/place-intelligence": ["paid", "place_intelligence", "strict_same_origin"],
      "POST /api/place-intelligence/fresh": ["paid", "fresh_voices", "strict_same_origin"],
      "POST /api/hotel-recommendations": ["paid", "hotel_recommendations", "strict_same_origin"],
      "POST /api/hotel-recommendations/ai": ["paid", "hotel_ranking", "strict_same_origin"],
      "POST /api/food-recommendations": ["paid", "food_recommendations", "strict_same_origin"],
      "POST /api/food-recommendations/ai": ["paid", "food_ranking", "strict_same_origin"],
      "POST /api/route-recommendations": ["paid", "route_recommendations", "strict_same_origin"],
      "GET /api/place-photo": ["paid", "place_photo", "signed_resource"],
      "POST /api/weather": ["free_public", null, "handler_guarded"],
      "POST /api/holidays": ["free_public", null, "handler_guarded"],
      "POST /api/link-preview": ["free_public", null, "handler_guarded"],
      "GET /api/link-image": ["free_public", null, "signed_resource"],
      "GET /api/ai-status": ["local", null, "handler_guarded"],
      "POST /api/product-events": ["local", null, "handler_guarded"],
    },
  );
});

test("a route that reads a provider key is never classified free or local", async () => {
  // The classification has to survive somebody adding a Google call to a
  // route that was free when it was written.
  const providerKeyPattern = /GOOGLE_[A-Z_]*API_KEY|ANTHROPIC_API_KEY|RAKUTEN_[A-Z_]+/;
  for (const { path, file } of await routeFiles(API_ROOT)) {
    const source = await readFile(file, "utf8");
    if (!providerKeyPattern.test(source)) continue;
    for (const match of source.matchAll(METHOD_EXPORT)) {
      const policy = apiRoutePolicy(match[1], path);
      assert.equal(policy?.class, "paid", `${match[1]} ${path} reads a provider key but is not classified paid`);
    }
  }
});

test("the Worker dispatches from the manifest rather than its own table", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /paidRoutePolicy\(request, url\)/, "the Worker must look routes up by method and path");
  assert.doesNotMatch(worker, /request\.method === "POST" \? /, "the POST-only paid dispatch must be gone");
  assert.doesNotMatch(worker, /const PAID_API_ROUTES/, "the Worker must not keep a second route table");
});
