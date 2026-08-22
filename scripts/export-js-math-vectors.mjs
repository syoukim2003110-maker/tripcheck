// Exports the exact bits V8 produces for the three transcendental functions the trip engine leans
// on, plus the exact bits of every straight-line distance the builder corpus can ask for.
//
// `apple/Packages/TripCheckKit/Sources/TripCheckKit/Core/JSMath.swift` is a port of V8's
// `src/base/ieee754.cc`; this table is what proves the port, so it has to come from V8 itself
// rather than from any Swift-side reimplementation.
//
// Usage:
//   node scripts/export-js-math-vectors.mjs \
//     --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/js-math-vectors.v1.json \
//     apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const view = new DataView(new ArrayBuffer(8));
function bits(value) {
  view.setFloat64(0, value);
  let out = "";
  for (let index = 0; index < 8; index += 1) out += view.getUint8(index).toString(16).padStart(2, "0");
  return out.replace(/^0+/, "") || "0";
}

function parseArguments(argv) {
  const inputs = [];
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out" || argument === "-o") { out = argv[index + 1]; index += 1; continue; }
    if (argument.startsWith("--out=")) { out = argument.slice("--out=".length); continue; }
    inputs.push(argument);
  }
  if (!out) throw new Error("missing --out <path>");
  if (inputs.length !== 1) throw new Error("expected exactly one corpus path");
  return { corpusPath: inputs[0], out };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const { corpusPath, out } = parseArguments(process.argv.slice(2));

// 1. The latitude sweep the divergence was measured on: 35.5–38.5° and 45.9–47.4° at 0.0001°,
//    covering the Tokyo/Kyoto-Osaka band and the Swiss band. Both cos and sin, of the same radian
//    argument, so the sweep also pins `degrees * Math.PI / 180` itself.
const latitudeRadians = [];
const latitudes = [];
for (let step = 0; step <= 30000; step += 1) latitudes.push(35.5 + step / 10000);
for (let step = 0; step <= 15000; step += 1) latitudes.push(45.9 + step / 10000);
for (const latitude of latitudes) {
  const radians = latitude * Math.PI / 180;
  latitudeRadians.push(`${bits(radians)} ${bits(Math.cos(radians))} ${bits(Math.sin(radians))}`);
}

// 2. The half-delta range the haversine actually evaluates `sin` on: two stops 0–400 km apart give
//    |Δ/2| well under 0.035 rad. Swept at 100,000 points, every fifth one stored.
const smallSin = [];
for (let step = 0; step <= 100000; step += 5) {
  const x = 0.035 * step / 100000;
  smallSin.push(`${bits(x)} ${bits(Math.sin(x))}`);
}

// 3. `asin(√h)` over its whole domain, swept at 200,000 points, every tenth one stored.
const asin = [];
for (let step = 0; step <= 200000; step += 10) {
  const x = step / 200000;
  asin.push(`${bits(x)} ${bits(Math.asin(x))}`);
}

// 3b. The argument-reduction branches of `__ieee754_rem_pio2`. Nothing a coordinate can produce
//     reaches them — every latitude is under 1 rad — but `JSMath` implements them, and an
//     implementation nothing measures is a guess. Bit patterns are built explicitly so the sample
//     lands inside the intended branch rather than near it.
const bitsToDouble = (hi, lo) => {
  view.setUint32(0, hi);
  view.setUint32(4, lo);
  return view.getFloat64(0);
};

//     (a) |x| < 3π/4 with the high word exactly 0x3FF921FB — the "near π/2, use 33+33+53 bit π"
//         sub-branch, which is one `if` away from the ordinary n = ±1 path.
const nearHalfPi = [];
for (let step = 0; step < 120; step += 1) {
  const low = Math.floor(step * 0xFFFFFFFF / 119);
  const x = bitsToDouble(0x3FF921FB, low);
  for (const value of [x, -x]) {
    nearHalfPi.push(`${bits(value)} ${bits(Math.cos(value))} ${bits(Math.sin(value))}`);
  }
}

//     (b) 3π/4 … 2^19×(π/2), the medium-size path with its one-, two- and three-round refinements,
//         swept logarithmically and pinned at both ends.
const mediumReduction = [];
const mediumLow = 3 * Math.PI / 4;
const mediumHigh = 524288 * (Math.PI / 2);  // 2^19 × (π/2), the top of the branch
for (let step = 0; step <= 160; step += 1) {
  const x = mediumLow * Math.exp(Math.log(mediumHigh / mediumLow) * step / 160);
  for (const value of [x, -x]) {
    mediumReduction.push(`${bits(value)} ${bits(Math.cos(value))} ${bits(Math.sin(value))}`);
  }
}

//     (c) Beyond 2^19×(π/2), where reduction hands over to `__kernel_rem_pio2` and the 396 hex
//         digits of 2/π. Swept by powers up to 1e300.
const hugeArguments = [];
for (let step = 0; step <= 120; step += 1) {
  const x = mediumHigh * 1.0001 * Math.pow(10, 294 * step / 120);
  if (!Number.isFinite(x)) continue;
  for (const value of [x, -x]) {
    hugeArguments.push(`${bits(value)} ${bits(Math.cos(value))} ${bits(Math.sin(value))}`);
  }
}

// 4. Every ordered pair of distinct coordinates the builder corpus contains — stops, the trip base
//    and the per-night bases. This is the table the port has to reproduce edge for edge: the route
//    optimiser's strict `<` between a path and its reverse is decided by these exact bits.
//
//    The distance comes from the engine's own `straightLineDistanceKm`, not from a copy of it here:
//    a second transcription of the formula could drift from `lib/` and would then be pinning the
//    wrong numbers with total confidence.
const { straightLineDistanceKm } = await import("../lib/route-optimizer.ts");
const { destinationById, destinationAirport } = await import("../lib/destinations.ts");

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const byKey = new Map();
const add = (point) => {
  if (!point) return;
  byKey.set(`${point.latitude},${point.longitude}`, { latitude: point.latitude, longitude: point.longitude });
};
for (const scenario of corpus.scenarios) {
  const context = scenario.trip.context;
  for (const stop of context.resolvedStops ?? []) add(stop);
  add(context.resolvedBase);
  for (const base of Object.values(context.nightBases ?? {})) add(base);
  // Airport legs run through the same distance function, and the airport coordinates come from
  // `lib/destinations.ts` rather than from the corpus.
  const destination = destinationById(context.destination ?? "worldwide");
  for (const code of [context.arrivalAirport, context.departureAirport]) {
    if (code) add(destinationAirport(destination, code));
  }
}
const points = [...byKey.entries()]
  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([key, point]) => ({ key, ...point }));

const corpusEdges = [];
for (const from of points) {
  for (const to of points) {
    if (from.key === to.key) continue;
    corpusEdges.push(`${from.latitude} ${from.longitude} ${to.latitude} ${to.longitude} ${bits(straightLineDistanceKm(from, to))}`);
  }
}

writeFileSync(out, `${JSON.stringify({
  schemaVersion: 1,
  generatedFrom: gitHead(),
  v8Version: process.versions.v8,
  nodeVersion: process.versions.node,
  encoding: "each entry is space-separated; bit patterns are lowercase hex of the IEEE-754 double, leading zeros stripped",
  groups: {
    latitudeRadians: { format: "radians cos sin", entries: latitudeRadians },
    smallSin: { format: "x sin", entries: smallSin },
    asin: { format: "x asin", entries: asin },
    nearHalfPi: { format: "x cos sin", entries: nearHalfPi },
    mediumReduction: { format: "x cos sin", entries: mediumReduction },
    hugeArguments: { format: "x cos sin", entries: hugeArguments },
    corpusEdges: { format: "fromLat fromLon toLat toLon distanceKm", entries: corpusEdges },
  },
})}\n`);

process.stdout.write(
  `${latitudeRadians.length} latitude, ${smallSin.length} smallSin, ${asin.length} asin, `
  + `${nearHalfPi.length} nearHalfPi, ${mediumReduction.length} mediumReduction, `
  + `${hugeArguments.length} hugeArguments, `
  + `${corpusEdges.length} corpus edges (${points.length} distinct points) -> ${out}\n`
);
