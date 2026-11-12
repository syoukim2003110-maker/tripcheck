/*
 * Generates public/rail/<city>.json: the rail network around each bundled
 * destination, as stations, lines and which station is next to which.
 *
 *   node --experimental-strip-types scripts/generate-rail-networks.ts [city…]
 *
 * Source: Wikidata (CC0) — "adjacent station" (P197) with its "connecting
 * line" (P81) or "connecting service" (P1192). The app turns this into
 * "board here, change there, get off here". It is a map of the network, not a
 * timetable: travel times derived from it are estimates and are labelled so.
 *
 * Set RAIL_RAW_DIR to keep the downloaded rows on disk. A second run then
 * rebuilds every network from them without asking Wikidata again, which is
 * how a change to the naming rules below is tried out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { plainEnglishStationName, plainStationName } from "../lib/rail-router.ts";

type City = { id: string; ja: string; en: string; lat: number; lon: number; radiusKm: number };
const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: City[] }).cities;

// Wikidata asks automated clients to identify themselves. The name of the
// tool is enough; nothing about the person running it belongs in a header.
const UA = "rail-network-generator/1.0 (bundled city rail maps)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rawDir = process.env.RAIL_RAW_DIR;

type Binding = Record<string, { value: string } | undefined>;
async function sparql(query: string, tries = 4): Promise<Binding[]> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // POST, because a list of several hundred ids does not fit in a URL.
      const response = await fetch("https://query.wikidata.org/sparql", {
        method: "POST",
        headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: new URLSearchParams({ query }).toString(),
        signal: AbortSignal.timeout(65_000),
      });
      if (response.ok) return ((await response.json()) as { results: { bindings: Binding[] } }).results.bindings;
      if (attempt >= tries) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= tries) throw error;
    }
    // One request at a time, and a longer pause after each failure.
    await sleep(6_000 * attempt);
  }
}

// Only a real item counts. Wikidata's "unknown value" comes back as a
// hash, and a line that is a hash has no name and never will.
const idOf = (binding: { value: string } | undefined) => {
  const id = binding?.value.split("/").at(-1) ?? "";
  return /^Q\d+$/.test(id) ? id : "";
};
const text = (binding: { value: string } | undefined) => binding?.value.trim() ?? "";
const qNumber = (id: string) => Number(id.slice(1)) || 0;

type Raw = {
  adjacency: Binding[];
  notInService: Binding[];
  membership: Binding[];
  lineInfo: Binding[];
  kinds: Binding[];
  operators: Binding[];
  /** Every label of the few stations and lines with neither a Japanese nor an English one. */
  otherLabels: Binding[];
};

async function download(city: City): Promise<Raw> {
  const file = rawDir ? `${rawDir}/${city.id}.json` : null;
  const kept: Partial<Raw> = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Partial<Raw> : {};
  const radius = Math.min(45, Math.round(city.radiusKm * 1.4));
  const around = `SERVICE wikibase:around { ?s wdt:P625 ?c . bd:serviceParam wikibase:center "Point(${city.lon} ${city.lat})"^^geo:wktLiteral ; wikibase:radius "${radius}" . }`;
  const names = (variable: string) => `OPTIONAL { ?${variable} rdfs:label ?${variable}Ja FILTER(LANG(?${variable}Ja) = "ja") } OPTIONAL { ?${variable} rdfs:label ?${variable}En FILTER(LANG(?${variable}En) = "en") }`;
  const labelled = (item: string, property: string, words: string) => `EXISTS { ${item} wdt:${property} ?x${property} . ?x${property} rdfs:label ?l${property} FILTER(LANG(?l${property}) = "en" && REGEX(?l${property}, "${words}", "i")) }`;
  const unbuilt = "proposed|planned|construction|unbuilt";
  const gone = "closed|defunct|abandoned|demolished|disused|former|dismantled";
  const queries: Record<Exclude<keyof Raw, "otherLabels">, string> = {
    adjacency: `SELECT ?s ?c ?sJa ?sEn ?adj ?line ?service WHERE { ${around} ?s p:P197 ?statement . ?statement ps:P197 ?adj . OPTIONAL { ?statement pq:P81 ?line } OPTIONAL { ?statement pq:P1192 ?service } ${names("s")} } LIMIT 60000`,
    // A station that has closed, or has not been built yet, is on the map of
    // Wikidata but not on the ground: the Hakubutsukan-Dobutsuen station shut
    // in 1997, and "新築地駅" is a proposal. Neither may appear in a journey.
    notInService: `SELECT DISTINCT ?s WHERE { ${around} ?s wdt:P197 ?any . { ?s wdt:P576 ?ended } UNION { ?s wdt:P3999 ?closed } UNION { ?s wdt:P5817 ?state . ?state rdfs:label ?label FILTER(LANG(?label) = "en" && REGEX(?label, "${unbuilt}|${gone}", "i")) } UNION { ?s wdt:P31 ?kind . ?kind rdfs:label ?kindLabel FILTER(LANG(?kindLabel) = "en" && REGEX(?kindLabel, "former|proposed|planned|abandoned|defunct|closed|ghost|under construction", "i")) } } LIMIT 30000`,
    membership: `SELECT ?s ?line WHERE { ${around} ?s wdt:P197 ?any ; wdt:P81 ?line . } LIMIT 60000`,
    // "dated" (a dissolution or closure date) is kept apart from "closed"
    // (what the line is said to be): the Chikuhi and Yongsan lines carry a
    // date for a section that shut decades ago and still run every day.
    lineInfo: `SELECT DISTINCT ?line ?lineJa ?lineEn ?unbuilt ?closed ?dated WHERE { { SELECT DISTINCT ?line WHERE { ${around} { ?s p:P197 ?st . ?st pq:P81 ?line } UNION { ?s p:P197 ?st . ?st pq:P1192 ?line } UNION { ?s wdt:P197 ?any ; wdt:P81 ?line } } } ${names("line")} BIND((${labelled("?line", "P5817", unbuilt)} || ${labelled("?line", "P31", unbuilt)}) AS ?unbuilt) BIND((${labelled("?line", "P5817", gone)} || ${labelled("?line", "P31", gone)}) AS ?closed) BIND((EXISTS { ?line wdt:P576 ?ended } || EXISTS { ?line wdt:P3999 ?shut }) AS ?dated) } LIMIT 30000`,
    kinds: `SELECT DISTINCT ?s ?kindEn WHERE { ${around} ?s wdt:P197 ?any ; wdt:P31 ?kind . ?kind rdfs:label ?kindEn FILTER(LANG(?kindEn) = "en") } LIMIT 60000`,
    operators: `SELECT DISTINCT ?opJa ?opEn WHERE { ${around} ?s wdt:P197 ?any ; wdt:P137 ?op . ${names("op")} } LIMIT 5000`,
  };
  const save = () => { if (file) writeFileSync(file, JSON.stringify(kept)); };
  for (const [name, query] of Object.entries(queries) as Array<[keyof Raw, string]>) {
    if (kept[name]) continue;
    kept[name] = await sparql(query);
    save();
    await sleep(1_200);
  }
  if (!kept.otherLabels) {
    const nameless = new Set<string>();
    for (const row of kept.adjacency!) if (!row.sJa && !row.sEn) nameless.add(idOf(row.s));
    for (const row of kept.lineInfo!) if (!row.lineJa && !row.lineEn) nameless.add(idOf(row.line));
    const ids = [...nameless].filter(Boolean).sort();
    kept.otherLabels = [];
    for (let start = 0; start < ids.length; start += 200) {
      kept.otherLabels.push(...await sparql(`SELECT ?item ?label WHERE { VALUES ?item { ${ids.slice(start, start + 200).map((id) => `wd:${id}`).join(" ")} } ?item rdfs:label ?label }`));
      await sleep(1_200);
    }
    save();
  }
  return kept as Raw;
}

const plannedLine = /構想|計画|未成|予定線|廃線|廃止|proposed|planned|abandoned|defunct|under construction/i;
/*
 * Tokyo to Ueno is one stop on the Akita Shinkansen, and Seoul to Yongsan
 * one stop on the KTX. Nobody crosses a city that way — it needs a separate
 * express ticket and a reserved seat — and with fewer stops it would always
 * look quickest. High-speed lines are left out of a city's map.
 */
const highSpeedLine = /新幹線|Shinkansen|\bKTX\b|\bSRT\b|high[- ]speed|\bTGV\b|\bLGV\b/i;
/*
 * Places a train passes or stops at that a passenger cannot use: a signal
 * station where trains wait for each other, a freight terminal, a depot.
 * Tokyo Freight Terminal sits beside a sight and would otherwise be offered
 * as the station to walk to.
 */
const notForPassengersKind = /signal (station|box)|passing loop|goods station|freight (station|terminal|yard)|rail yard|classification yard|marshalling yard|motive power depot|train depot|railway depot|rail depot|tram depot|rail terminal|block post|crossover/i;
const passengerKind = /railway station|metro station|subway station|tram stop|train station|light rail station|interchange station|underground station|railway stop|railway halt|passenger|commuter|station building/i;
const notForPassengersName = /信号場|信号所|貨物駅|貨物ターミナル|操車場|車両基地|Signal (Base|Station|Box)\b|Freight (Terminal|Station)|rail yard\b/i;
/** A language whose label is most likely the name on the local sign, tried in this order. */
const fallbackLanguages = ["mul", "fr", "de", "es", "it", "nl", "pt", "cs", "hu", "sv", "da", "tr", "el", "ko", "zh", "zh-hant", "zh-hans", "th", "vi", "ms", "id"];
const companyEnding = /(鉄道|電鉄|電気軌道|交通局|交通|地下鉄|メトロ|モノレール|軌道|急行)$/;
const englishCompanyEnding = /\b(Railway|Railways|Railroad|Metro|Subway|Corporation|Monorail|Transit|Bureau|Liner|Line)$/;
const hasJapanese = /[぀-ヿ一-鿿]/;

function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "Balard", "Balard station" and "Balard Station" are one name. */
function comparable(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(railway station|metro station|subway station|tube station|mrt station|lrt station|train station|tram stop|station|stop|駅|停留場)\b/g, "")
    .replace(/駅$|停留場$/, "").replace(/[^\p{L}\p{N}]/gu, "");
}

type Station = { id: string; ja: string; en: string; lat: number; lon: number; lines: Set<string>; forPassengers: boolean };

function build(city: City, raw: Raw) {
  const notInService = new Set(raw.notInService.map((row) => idOf(row.s)));
  const otherLabels = new Map<string, Map<string, string>>();
  for (const row of raw.otherLabels) {
    const id = idOf(row.item);
    const language = (row.label as { "xml:lang"?: string } | undefined)?.["xml:lang"] ?? "";
    if (!otherLabels.has(id)) otherLabels.set(id, new Map());
    otherLabels.get(id)!.set(language, text(row.label));
  }
  // A station or line with no Japanese and no English label still has a
  // name — the local one. Dropping it, as an earlier version did, cut the
  // line in two at that station.
  const localName = (id: string) => {
    const labels = otherLabels.get(id);
    if (!labels || labels.size === 0) return "";
    for (const language of fallbackLanguages) if (labels.get(language)) return labels.get(language)!;
    return labels.get([...labels.keys()].sort()[0]) ?? "";
  };
  const kinds = new Map<string, string[]>();
  for (const row of raw.kinds) kinds.set(idOf(row.s), [...(kinds.get(idOf(row.s)) ?? []), text(row.kindEn)]);

  const stations = new Map<string, Station>();
  // Sorted by id so that the same Wikidata gives the same file, whatever
  // order the rows came back in.
  const adjacency = [...raw.adjacency].sort((left, right) => qNumber(idOf(left.s)) - qNumber(idOf(right.s)) || qNumber(idOf(left.adj)) - qNumber(idOf(right.adj)) || qNumber(idOf(left.line)) - qNumber(idOf(right.line)) || qNumber(idOf(left.service)) - qNumber(idOf(right.service)));
  for (const row of adjacency) {
    const id = idOf(row.s);
    const point = row.c?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!id || !point || stations.has(id) || notInService.has(id)) continue;
    // A few "English" labels are the Japanese name pasted in (広島高速交通
    // 大町駅). That is no English label at all.
    const english = hasJapanese.test(text(row.sEn)) ? "" : text(row.sEn);
    const local = text(row.sJa) || english ? "" : localName(id);
    const ja = text(row.sJa) || english || local;
    const en = english || local || text(row.sJa);
    if (!ja && !en) continue;
    const kind = kinds.get(id) ?? [];
    const forPassengers = !(notForPassengersName.test(ja) || notForPassengersName.test(en) || (kind.some((entry) => notForPassengersKind.test(entry)) && !kind.some((entry) => passengerKind.test(entry))));
    stations.set(id, { id, ja, en, lat: Number(Number(point[2]).toFixed(5)), lon: Number(Number(point[1]).toFixed(5)), lines: new Set(), forPassengers });
  }

  const lines = new Map<string, { ja: string; en: string }>();
  for (const row of [...raw.lineInfo].sort((left, right) => qNumber(idOf(left.line)) - qNumber(idOf(right.line)))) {
    const id = idOf(row.line);
    if (!id || lines.has(id)) continue;
    // A line that is only a plan connects nothing yet, and one that has
    // closed (the Ueno Zoo monorail) connects nothing any more.
    if (row.unbuilt?.value === "true" || row.closed?.value === "true" || plannedLine.test(text(row.lineJa)) || plannedLine.test(text(row.lineEn))) continue;
    if (highSpeedLine.test(text(row.lineJa)) || highSpeedLine.test(text(row.lineEn))) continue;
    const english = hasJapanese.test(text(row.lineEn)) ? "" : text(row.lineEn);
    const local = text(row.lineJa) || english ? "" : localName(id);
    // No label in any language leaves the name empty. The line is still a
    // line — staying on it is not a change of train — but the page must say
    // "train", not a name made up here.
    lines.set(id, { ja: text(row.lineJa) || english || local, en: english || local || text(row.lineJa) });
  }
  for (const row of raw.membership) {
    const station = stations.get(idOf(row.s));
    if (station && lines.has(idOf(row.line))) station.lines.add(idOf(row.line));
  }

  type Edge = { low: string; high: string; line: string };
  const edges = new Map<string, Edge>();
  const pairKey = (low: string, high: string) => `${low}-${high}-`;
  const linesOfPair = new Map<string, Set<string>>();
  for (const row of adjacency) {
    const from = idOf(row.s);
    const to = idOf(row.adj);
    if (!stations.has(from) || !stations.has(to) || from === to) continue;
    // What the link is called, best first:
    //  1. the statement's "connecting service" — the name on the platform.
    //     Tokyo to Ueno is track of the Tōhoku Main Line, but the trains a
    //     traveller boards there are the Yamanote and Keihin-Tōhoku lines;
    //     the Venice water buses exist only as services ("ACTV service 1").
    //  2. the statement's "connecting line" — the track, which for a metro
    //     or a private railway is the same thing as the service.
    //  3. the one line both stations are on.
    // Two shared lines cannot be told apart and no shared line means the
    // data does not say: both stay unknown (""). A link whose own line is a
    // plan or has closed (dropped above) does not exist.
    const stated = idOf(row.service) || idOf(row.line);
    if (stated && !lines.has(stated)) continue;
    const [low, high] = qNumber(from) < qNumber(to) ? [from, to] : [to, from];
    const pair = pairKey(low, high);
    const known = linesOfPair.get(pair) ?? new Set<string>();
    linesOfPair.set(pair, known);
    const add = (line: string) => {
      // A known line replaces an unknown one for the same pair.
      if (line) edges.delete(pair);
      if (!line && known.size > 0) return;
      known.add(line);
      edges.set(pair + line, { low, high, line });
    };
    if (stated) { add(stated); continue; }
    const shared = [...stations.get(from)!.lines].filter((candidate) => stations.get(to)!.lines.has(candidate)).sort((left, right) => qNumber(left) - qNumber(right));
    // Neighbouring stops that are both on the same two or three lines — the
    // Hakodate trams 2 and 5 on their shared track, 大和路線 and 関西本線
    // for one pair of rails — are joined by each of them. Beyond that the
    // stations are big junctions and the guess would be too wide.
    if (shared.length >= 1 && shared.length <= 3) for (const line of shared) add(line);
    else add("");
  }
  /*
   * Wikidata sometimes points "next station" at the wrong one of two items
   * for the same station: 出屋敷 (Hanshin) lists JR 尼崎 as its neighbour as
   * well as Hanshin 尼崎, 300 m away. The link with no line is the mistake
   * when the same station already has a named link to the namesake.
   */
  const sameName = (left: Station, right: Station) => comparable(plainStationName(left.ja)) === comparable(plainStationName(right.ja)) && meters(left, right) <= 1_500;
  for (const [key, edge] of [...edges.entries()]) {
    if (edge.line) continue;
    const low = stations.get(edge.low)!;
    const high = stations.get(edge.high)!;
    const namesake = [...edges.values()].some((other) => other.line !== "" && (
      (other.low === edge.low && other.high !== edge.high && sameName(stations.get(other.high)!, high))
      || (other.high === edge.low && other.low !== edge.high && sameName(stations.get(other.low)!, high))
      || (other.low === edge.high && other.high !== edge.low && sameName(stations.get(other.high)!, low))
      || (other.high === edge.high && other.low !== edge.low && sameName(stations.get(other.low)!, low))));
    if (namesake) edges.delete(key);
  }

  /*
   * A place passengers cannot use is taken out, and the stations either side
   * of it on the same line become neighbours — the train does run through.
   */
  for (const station of stations.values()) {
    if (station.forPassengers) continue;
    const touching = [...edges.entries()].filter(([, edge]) => edge.low === station.id || edge.high === station.id);
    const byLine = new Map<string, string[]>();
    for (const [key, edge] of touching) {
      edges.delete(key);
      const other = edge.low === station.id ? edge.high : edge.low;
      byLine.set(edge.line, [...(byLine.get(edge.line) ?? []), other]);
    }
    for (const [line, neighbours] of byLine) {
      if (neighbours.length !== 2 || neighbours[0] === neighbours[1]) continue;
      const [low, high] = qNumber(neighbours[0]) < qNumber(neighbours[1]) ? neighbours : [neighbours[1], neighbours[0]];
      const pair = pairKey(low, high);
      if ([...edges.keys()].some((key) => key.startsWith(pair))) continue;
      edges.set(pair + line, { low, high, line });
    }
    stations.delete(station.id);
  }

  // Only what a journey can use is written: a station nothing connects to
  // cannot be boarded, and a line with no link left is a name without trains.
  const usedStations = new Set([...edges.values()].flatMap((edge) => [edge.low, edge.high]));
  const usedLines = new Set([...edges.values()].map((edge) => edge.line).filter(Boolean));
  const stationList = [...stations.values()].filter((station) => usedStations.has(station.id));
  const lineIds = [...lines.keys()].filter((id) => usedLines.has(id));

  /*
   * Names. Company and line names that Wikidata glues onto a station
   * ("東京メトロ有楽町線市ケ谷駅") come off; the candidates are the built-in
   * company list plus this network's own line names and operators.
   */
  const japanesePrefixes = [
    ...lineIds.map((id) => lines.get(id)!.ja).filter((name) => hasJapanese.test(name) && name.length >= 3 && /(線|ライン|ライナー)$/.test(name)),
    ...raw.operators.map((row) => text(row.opJa)).filter((name) => companyEnding.test(name)),
  ];
  const englishPrefixes = [
    ...lineIds.map((id) => lines.get(id)!.en.replace(/‐/g, "-")).filter((name) => /\b(Line|Liner)$/.test(name)),
    ...raw.operators.map((row) => text(row.opEn)).filter((name) => englishCompanyEnding.test(name)),
  ];
  const renamed: string[] = [];
  for (const station of stationList) {
    const before = `${station.ja} / ${station.en}`;
    const ja = plainStationName(station.ja, japanesePrefixes);
    let en = plainStationName(station.en);
    // An English prefix is removed only where the Japanese label lost one
    // (a bracket comes off the end, so the start of the name tells).
    if (hasJapanese.test(station.ja) && !station.ja.startsWith(ja)) en = plainEnglishStationName(en, englishPrefixes);
    // Likewise a bracket on the English label of a station whose Japanese
    // label was told apart by company ("Kanayama Station (Meitetsu)").
    if (hasJapanese.test(station.ja) && station.ja !== ja && station.ja.trim() !== ja) en = en.replace(/(\bStation)\s*\([^)]*\)$/i, "$1");
    station.ja = ja;
    station.en = en;
    if (before !== `${station.ja} / ${station.en}`) renamed.push(`${before}  =>  ${station.ja} / ${station.en}`);
  }
  /*
   * One building, two Wikidata items, and only one of them has the Japanese
   * (or English) label: 薬院駅 beside "Yakuin". The item without one borrows
   * it from the neighbour within 320 m (the distance the planner treats as
   * one interchange) whose name in the other language is
   * the same. Nothing is merged — they stay two stations to change between.
   */
  for (const station of stationList) {
    const lacksJapanese = station.ja === station.en && !hasJapanese.test(station.ja);
    const lacksEnglish = station.ja === station.en && hasJapanese.test(station.en);
    if (!lacksJapanese && !lacksEnglish) continue;
    const twin = stationList.find((other) => other !== station && other.ja !== other.en && meters(station, other) <= 320
      && comparable(lacksJapanese ? other.en : other.ja) === comparable(lacksJapanese ? station.en : station.ja) && comparable(station.en) !== "");
    if (!twin) continue;
    renamed.push(`${station.ja} / ${station.en}  =>  ${twin.ja} / ${twin.en} (borrowed)`);
    if (lacksJapanese) station.ja = twin.ja; else station.en = twin.en;
  }

  /*
   * "Tram line 19 (Amsterdam)", "S 1 (Berlin/Brandenburg)", "東海道線 (JR
   * East)": the bracket tells an encyclopedia reader where the line is or
   * who runs it, which the traveller standing there knows. It stays when it
   * tells two lines of this network apart ("京義急行 (龍山)" / "(ソウル)")
   * or says what kind of train it is ("Chūō Line (Rapid)").
   */
  const whereOrWho = new RegExp(`^(?:${[city.en, city.ja, "Praha", "Stockhom", "Berlin/Brandenburg", "JR East", "JR Central", "JR West", "SkyTrain", "Metrobus line", "バート", "シティレール", "タイ"].map((word) => word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")}|.*(?:Metro|メトロ|トラム|州|地区))$`, "i");
  const withoutPlace = (name: string) => {
    const bracket = name.match(/^(.+?)\s*[(（]([^)）]*)[)）]$/);
    return bracket && whereOrWho.test(bracket[2].trim()) ? bracket[1].trim() : name;
  };
  for (const language of ["ja", "en"] as const) {
    const plain = new Map<string, number>();
    for (const id of lineIds) plain.set(withoutPlace(lines.get(id)![language]), (plain.get(withoutPlace(lines.get(id)![language])) ?? 0) + 1);
    for (const id of lineIds) {
      const short = withoutPlace(lines.get(id)![language]);
      if (plain.get(short) === 1) lines.get(id)![language] = short;
    }
  }

  const stationIndex = new Map(stationList.map((station, index) => [station.id, index]));
  const lineIndex = new Map(lineIds.map((id, index) => [id, index]));
  const edgeList = [...edges.values()]
    .map((edge) => [stationIndex.get(edge.low)!, stationIndex.get(edge.high)!, edge.line ? lineIndex.get(edge.line)! : -1] as [number, number, number])
    .map(([a, b, line]) => (a < b ? [a, b, line] : [b, a, line]) as [number, number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
  return {
    network: {
      id: city.id,
      source: "Wikidata (CC0)",
      stations: stationList.map((station) => [station.ja, station.en, station.lat, station.lon] as const),
      lines: lineIds.map((id) => [lines.get(id)!.ja, lines.get(id)!.en] as const),
      edges: edgeList,
    },
    renamed,
  };
}

const only = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const report = process.argv.includes("--report");
mkdirSync(new URL("../public/rail/", import.meta.url), { recursive: true });
if (rawDir) mkdirSync(rawDir, { recursive: true });
const index: Array<{ id: string; stations: number; edges: number }> = [];
for (const city of cities) {
  if (only.length > 0 && !only.includes(city.id)) continue;
  try {
    const { network, renamed } = build(city, await download(city));
    console.log(`${city.id}: ${network.stations.length} stations, ${network.lines.length} lines, ${network.edges.length} links, ${network.edges.filter((edge) => edge[2] < 0).length} without a line`);
    if (report) for (const line of renamed) console.log(`    ${line}`);
    // A handful of stations is a tram stub or a data gap, not a network.
    if (network.stations.length >= 12 && network.edges.length >= 12) {
      writeFileSync(new URL(`../public/rail/${city.id}.json`, import.meta.url), `${JSON.stringify(network)}\n`);
      index.push({ id: city.id, stations: network.stations.length, edges: network.edges.length });
    }
  } catch (error) {
    console.log(`${city.id}: FAILED ${error instanceof Error ? error.message : error}`);
  }
  if (!rawDir) await sleep(1_500);
}
if (only.length === 0) {
  writeFileSync(new URL("../lib/rail-network-index.json", import.meta.url), `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), cities: index.map((entry) => entry.id) })}\n`);
  console.log(`wrote ${index.length} networks`);
}
