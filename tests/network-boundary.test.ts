import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { API_ROUTE_KEYS, API_ROUTE_POLICIES } from "../lib/server/api-route-policy.ts";

// P1-03 / P1-05. The privacy contract used to scan three enumerated roots for
// the literal string `fetch(`. A new client outside those roots, a component
// under a directory nobody thought to list, or `const network = fetch` all
// passed it — and `app/PlannerGoogleMap.tsx` really was calling a paid endpoint
// directly, outside the scan, with no cancellation.
//
// The rule is not "which directory is this file in" but "can the browser reach
// it". These tests walk the real import graph from every page and component,
// and hold that the only modules in it that touch the network are the handful
// of transports below.

/** Browser-side modules whose entire job is to make one request. */
const BROWSER_TRANSPORT = [
  "lib/food-recommendations-client.ts",
  "lib/holidays-client.ts",
  "lib/hotel-recommendations-client.ts",
  "lib/link-preview-client.ts",
  "lib/map-route-geometry-client.ts",
  "lib/place-intelligence-client.ts",
  "lib/place-resolution-client.ts",
  "lib/place-suggestion-client.ts",
  "lib/product-analytics.ts",
  "lib/route-recommendations-client.ts",
  "lib/weather-client.ts",
];

const REPO = new URL("../", import.meta.url);
/** `fetch(`, `fetch =`, `globalThis.fetch`; not `.fetch(` on some object. */
const FETCH_CALL = /(?<![.\w$])fetch\s*\(|globalThis\.fetch|window\.fetch|self\.fetch/;
const FETCH_ALIAS = /(?:const|let|var)\s+[\w$]+\s*=\s*(?:globalThis\.|window\.|self\.)?fetch\s*(?:[;,)\n]|$)/;
/** `import type X from` is erased at build time and cannot pull code in. */
const VALUE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?from\s*)?["'](\.[^"']+)["']/g;

async function listFiles(directory: URL, prefix: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) found.push(...await listFiles(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(`${prefix}${entry.name}`);
  }
  return found;
}

async function readSource(path: string) {
  return readFile(new URL(path, REPO), "utf8");
}

async function resolveImport(fromPath: string, specifier: string) {
  const base = fromPath.split("/").slice(0, -1);
  const parts = specifier.split("/");
  for (const part of parts) {
    if (part === ".") continue;
    else if (part === "..") base.pop();
    else base.push(part);
  }
  const candidate = base.join("/").replace(/\.tsx?$/, "");
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      await readFile(new URL(`${candidate}${suffix}`, REPO), "utf8");
      return `${candidate}${suffix}`;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

/** Everything the browser bundle can actually reach, following value imports. */
async function browserReachableModules() {
  const appFiles = await listFiles(new URL("app/", REPO), "app/");
  const entryPoints = appFiles.filter((path) => !path.startsWith("app/api/"));
  const seen = new Set<string>(entryPoints);
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const source = await readSource(current);
    for (const match of source.matchAll(VALUE_IMPORT)) {
      const resolved = await resolveImport(current, match[1]);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return [...seen].sort();
}

test("the only modules a browser can reach that touch the network are the transports", async () => {
  const reachable = await browserReachableModules();
  const fetching: string[] = [];
  for (const path of reachable) {
    if (FETCH_CALL.test(await readSource(path))) fetching.push(path);
  }
  assert.deepEqual(
    fetching.sort(),
    [...BROWSER_TRANSPORT].sort(),
    "adding a module the browser can fetch from is a reviewed change to this list",
  );
});

test("no server-only module is reachable from the browser at all", async () => {
  const reachable = await browserReachableModules();
  assert.deepEqual(
    reachable.filter((path) => path.startsWith("lib/server/") || path.startsWith("worker/")),
    [],
    "server modules hold key material and quota logic; they must not enter the bundle",
  );
});

test("nothing anywhere hides a fetch behind another name", async () => {
  const offenders: string[] = [];
  for (const root of ["app/", "lib/", "worker/"]) {
    for (const path of await listFiles(new URL(root, REPO), root)) {
      if (FETCH_ALIAS.test(await readSource(path))) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, [], "aliasing fetch defeats every scan that looks for the name");
});

test("every endpoint a browser transport names is a classified route", async () => {
  const knownPaths = new Set(API_ROUTE_KEYS.map((key) => API_ROUTE_POLICIES[key].path));
  for (const path of BROWSER_TRANSPORT) {
    const source = await readSource(path);
    for (const match of source.matchAll(/["'`](\/api\/[a-z0-9/-]+)["'`]/g)) {
      assert.ok(knownPaths.has(match[1]), `${path} calls ${match[1]}, which no route policy classifies`);
    }
  }
});

/**
 * The exports of a transport module that actually issue a request. Client
 * modules also hold pure helpers next to their request — a component may use
 * those, because importing a helper sends nothing. What a component may never
 * do is call the request itself.
 */
async function requestingExports(path: string) {
  const source = await readSource(path);
  const names: string[] = [];
  const declarations = [...source.matchAll(/export\s+(?:async\s+)?function\s+([\w$]+)\s*\(/g)];
  declarations.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < declarations.length ? declarations[index + 1].index ?? source.length : source.length;
    const body = source.slice(start, end);
    if (FETCH_CALL.test(body) || /navigator\.sendBeacon/.test(body)) names.push(match[1]);
  });
  return names;
}

test("no non-hook planner component issues a request of its own", async () => {
  const requesters = new Map<string, string[]>();
  for (const path of BROWSER_TRANSPORT) requesters.set(path, await requestingExports(path));
  // Every transport must expose at least one request, or the list is stale.
  for (const [path, names] of requesters) {
    assert.ok(names.length > 0, `${path} is listed as a transport but issues no request`);
  }

  const offenders: string[] = [];
  for (const path of await listFiles(new URL("app/components/planner/", REPO), "app/components/planner/")) {
    if (path.includes("/hooks/")) continue;
    const source = await readSource(path);
    for (const match of source.matchAll(/(?:^|\n)\s*import\s+(?!type\s)([\s\S]*?)from\s*["']([^"']+)["']/g)) {
      const target = await resolveImport(path, match[2].startsWith(".") ? match[2] : `./${match[2]}`);
      if (!target) continue;
      for (const name of requesters.get(target) ?? []) {
        if (new RegExp(`\\b${name}\\b`).test(match[1])) offenders.push(`${path} → ${name}()`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    // Analytics is the one deliberate exception: it is a fire-and-forget
    // beacon with no response, available from any surface, and the privacy
    // contract pins the field set it may carry.
    ["app/components/planner/TripPlannerShell.tsx → trackProductEvent()"],
    "components emit events; hooks own the requests",
  );
});

test("the map's route geometry goes through a transport module with cancellation", async () => {
  const map = await readSource("app/PlannerGoogleMap.tsx");
  assert.match(map, /requestMapRouteGeometry\(\{/, "the map must use the shared transport");
  assert.doesNotMatch(map, /"\/api\/live-routes"/, "the map must not name a paid endpoint itself");
  assert.doesNotMatch(map, FETCH_CALL, "the map must not call fetch at all");
  assert.match(map, /routeGeometryAbortRef\.current\?\.abort\(\)/, "a newer pass must cancel the older one");

  const client = await readSource("lib/map-route-geometry-client.ts");
  assert.match(client, /signal: input\.signal/, "the request must honour the abort signal");
  // Coordinates and a travel mode leave; nothing the traveller typed does.
  const payload = client.slice(
    client.indexOf("export function buildMapRouteGeometryPayload"),
    client.indexOf("export async function requestMapRouteGeometry"),
  );
  assert.doesNotMatch(payload, /\bname\b|query|itinerary|address|title/i);
});
