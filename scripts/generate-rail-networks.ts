/*
 * Generates public/rail/<city>.json: the rail network around each bundled
 * destination, as stations, lines and which station is next to which.
 *
 *   node --experimental-strip-types scripts/generate-rail-networks.ts [city…]
 *
 * Source: Wikidata (CC0) — "adjacent station" (P197) and "connecting line"
 * (P81). The app turns this into "board here, change there, get off here".
 * It is a map of the network, not a timetable: travel times derived from it
 * are estimates and are labelled as such.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type City = { id: string; ja: string; en: string; lat: number; lon: number; radiusKm: number };
const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: City[] }).cities;

const UA = "TripCheck/0.1 (+https://github.com/syoukim2003110-maker/tripcheck)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Binding = Record<string, { value: string } | undefined>;
async function sparql(query: string, tries = 3): Promise<Binding[]> {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/sparql-results+json", "User-Agent": UA }, signal: AbortSignal.timeout(65_000) });
      if (response.ok) return ((await response.json()) as { results: { bindings: Binding[] } }).results.bindings;
      if (attempt >= tries) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= tries) throw error;
    }
    await sleep(5_000 * attempt);
  }
}

const plannedLine = /構想|計画|未成|予定線|廃線|廃止|proposed|planned|abandoned|defunct|under construction/i;
const idOf = (binding: { value: string } | undefined) => binding?.value.split("/").at(-1) ?? "";

async function networkFor(city: City) {
  const radius = Math.min(45, Math.round(city.radiusKm * 1.4));
  const around = `SERVICE wikibase:around { ?s wdt:P625 ?c . bd:serviceParam wikibase:center "Point(${city.lon} ${city.lat})"^^geo:wktLiteral ; wikibase:radius "${radius}" . }`;
  const names = (variable: string) => `OPTIONAL { ?${variable} rdfs:label ?${variable}Ja FILTER(LANG(?${variable}Ja) = "ja") } OPTIONAL { ?${variable} rdfs:label ?${variable}En FILTER(LANG(?${variable}En) = "en") }`;
  const adjacency = await sparql(`SELECT ?s ?c ?sJa ?sEn ?adj ?line WHERE { ${around} ?s p:P197 ?statement . ?statement ps:P197 ?adj . OPTIONAL { ?statement pq:P81 ?line } ${names("s")} } LIMIT 30000`);
  await sleep(1_200);
  // A station that has closed, or has not been built yet, is on the map of
  // Wikidata but not on the ground: the Hakubutsukan-Dobutsuen station shut
  // in 1997, and "新築地駅" is a proposal. Neither may appear in a journey.
  const notInService = new Set((await sparql(`SELECT DISTINCT ?s WHERE { ${around} ?s wdt:P197 ?any . { ?s wdt:P576 ?ended } UNION { ?s wdt:P3999 ?closed } UNION { ?s wdt:P5817 ?state . ?state rdfs:label ?label FILTER(LANG(?label) = "en" && REGEX(?label, "proposed|planned|construction|closed|defunct|abandoned|demolished|disused|former", "i")) } UNION { ?s wdt:P31 ?kind . ?kind rdfs:label ?kindLabel FILTER(LANG(?kindLabel) = "en" && REGEX(?kindLabel, "former|proposed|planned|abandoned|defunct|closed|ghost|under construction", "i")) } } LIMIT 30000`)).map((row) => idOf(row.s)));
  await sleep(1_200);
  const membership = await sparql(`SELECT ?s ?line ?lineJa ?lineEn WHERE { ${around} ?s wdt:P197 ?any ; wdt:P81 ?line . ${names("line")} } LIMIT 30000`);

  const stations = new Map<string, { ja: string; en: string; lat: number; lon: number; lines: Set<string> }>();
  for (const row of adjacency) {
    const id = idOf(row.s);
    const point = row.c?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!id || !point || stations.has(id) || notInService.has(id)) continue;
    const ja = row.sJa?.value.trim() ?? "";
    const en = row.sEn?.value.trim() ?? "";
    if (!ja && !en) continue;
    stations.set(id, { ja: ja || en, en: en || ja, lat: Number(Number(point[2]).toFixed(5)), lon: Number(Number(point[1]).toFixed(5)), lines: new Set() });
  }
  const lines = new Map<string, { ja: string; en: string }>();
  for (const row of membership) {
    const station = stations.get(idOf(row.s));
    const line = idOf(row.line);
    if (!station || !line) continue;
    // A line that is only a plan connects nothing yet.
    if (plannedLine.test(row.lineJa?.value ?? "") || plannedLine.test(row.lineEn?.value ?? "")) continue;
    station.lines.add(line);
    if (!lines.has(line)) {
      const ja = row.lineJa?.value.trim() ?? "";
      const en = row.lineEn?.value.trim() ?? "";
      lines.set(line, { ja: ja || en || "電車", en: en || ja || "Rail" });
    }
  }

  const stationIds = [...stations.keys()];
  const stationIndex = new Map(stationIds.map((id, index) => [id, index]));
  const lineIds = [...lines.keys()];
  const lineIndex = new Map(lineIds.map((id, index) => [id, index]));
  const edges = new Map<string, [number, number, number]>();
  for (const row of adjacency) {
    const from = stationIndex.get(idOf(row.s));
    const to = stationIndex.get(idOf(row.adj));
    if (from === undefined || to === undefined || from === to) continue;
    // The statement's own "connecting line" is authoritative; otherwise the
    // one line both stations are on. Two shared lines cannot be told apart
    // and no shared line means the data does not say: both stay unknown (-1).
    // A link whose own line is a plan (or was dropped above) does not exist.
    if (row.line && !lineIndex.has(idOf(row.line))) continue;
    let line = lineIndex.get(idOf(row.line)) ?? -1;
    if (line < 0) {
      const shared = [...stations.get(stationIds[from])!.lines].filter((candidate) => stations.get(stationIds[to])!.lines.has(candidate));
      if (shared.length === 1) line = lineIndex.get(shared[0]) ?? -1;
    }
    const [low, high] = from < to ? [from, to] : [to, from];
    const key = `${low}-${high}-${line}`;
    // A known line replaces an unknown one for the same pair.
    if (line >= 0) edges.delete(`${low}-${high}--1`);
    if (line < 0 && [...edges.keys()].some((existing) => existing.startsWith(`${low}-${high}-`))) continue;
    edges.set(key, [low, high, line]);
  }
  return {
    id: city.id,
    source: "Wikidata (CC0)",
    stations: stationIds.map((id) => { const station = stations.get(id)!; return [station.ja, station.en, station.lat, station.lon] as const; }),
    lines: lineIds.map((id) => [lines.get(id)!.ja, lines.get(id)!.en] as const),
    edges: [...edges.values()],
  };
}

const only = process.argv.slice(2);
mkdirSync(new URL("../public/rail/", import.meta.url), { recursive: true });
const index: Array<{ id: string; stations: number; edges: number }> = [];
for (const city of cities) {
  if (only.length > 0 && !only.includes(city.id)) continue;
  try {
    const network = await networkFor(city);
    console.log(`${city.id}: ${network.stations.length} stations, ${network.lines.length} lines, ${network.edges.length} links`);
    // A handful of stations is a tram stub or a data gap, not a network.
    if (network.stations.length >= 12 && network.edges.length >= 12) {
      writeFileSync(new URL(`../public/rail/${city.id}.json`, import.meta.url), `${JSON.stringify(network)}\n`);
      index.push({ id: city.id, stations: network.stations.length, edges: network.edges.length });
    }
  } catch (error) {
    console.log(`${city.id}: FAILED ${error instanceof Error ? error.message : error}`);
  }
  await sleep(1_500);
}
if (only.length === 0) {
  writeFileSync(new URL("../lib/rail-network-index.json", import.meta.url), `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), cities: index.map((entry) => entry.id) })}\n`);
  console.log(`wrote ${index.length} networks`);
}
