/*
 * Generates lib/popular-sights-data.json: for each well-travelled destination,
 * the sights most people go there for, ranked by how many language editions of
 * Wikipedia have an article about them (a free, neutral fame signal).
 *
 *   node --experimental-strip-types scripts/generate-popular-sights.ts
 *
 * Source: Wikidata (CC0). The live query is too slow to run while a traveller
 * waits — ten seconds for Kyoto, a timeout for Tokyo — so the answer is
 * computed here once and shipped with the app. Re-run to refresh.
 */
import { writeFileSync } from "node:fs";

type City = { id: string; ja: string; en: string; lat: number; lon: number; radiusKm: number; minLinks?: number };

const cities: City[] = [
  // Japan
  { id: "tokyo", ja: "東京", en: "Tokyo", lat: 35.6812, lon: 139.7671, radiusKm: 16, minLinks: 12 },
  { id: "kyoto", ja: "京都", en: "Kyoto", lat: 35.0116, lon: 135.7681, radiusKm: 13 },
  { id: "osaka", ja: "大阪", en: "Osaka", lat: 34.6937, lon: 135.5023, radiusKm: 13 },
  { id: "nara", ja: "奈良", en: "Nara", lat: 34.6851, lon: 135.8048, radiusKm: 10, minLinks: 5 },
  { id: "kobe", ja: "神戸", en: "Kobe", lat: 34.6901, lon: 135.1956, radiusKm: 10, minLinks: 5 },
  { id: "yokohama", ja: "横浜", en: "Yokohama", lat: 35.4437, lon: 139.638, radiusKm: 9, minLinks: 5 },
  { id: "kamakura", ja: "鎌倉", en: "Kamakura", lat: 35.3192, lon: 139.5467, radiusKm: 6, minLinks: 4 },
  { id: "hakone", ja: "箱根", en: "Hakone", lat: 35.2324, lon: 139.1069, radiusKm: 12, minLinks: 4 },
  { id: "nikko", ja: "日光", en: "Nikko", lat: 36.7199, lon: 139.6982, radiusKm: 18, minLinks: 4 },
  { id: "kanazawa", ja: "金沢", en: "Kanazawa", lat: 36.5613, lon: 136.6562, radiusKm: 8, minLinks: 4 },
  { id: "nagoya", ja: "名古屋", en: "Nagoya", lat: 35.1815, lon: 136.9066, radiusKm: 12, minLinks: 5 },
  { id: "hiroshima", ja: "広島・宮島", en: "Hiroshima", lat: 34.3853, lon: 132.4553, radiusKm: 22, minLinks: 5 },
  { id: "fukuoka", ja: "福岡", en: "Fukuoka", lat: 33.5902, lon: 130.4017, radiusKm: 16, minLinks: 5 },
  { id: "nagasaki", ja: "長崎", en: "Nagasaki", lat: 32.7503, lon: 129.8777, radiusKm: 10, minLinks: 4 },
  { id: "sapporo", ja: "札幌", en: "Sapporo", lat: 43.0618, lon: 141.3545, radiusKm: 14, minLinks: 4 },
  { id: "hakodate", ja: "函館", en: "Hakodate", lat: 41.7687, lon: 140.7288, radiusKm: 10, minLinks: 3 },
  { id: "sendai", ja: "仙台・松島", en: "Sendai", lat: 38.2682, lon: 140.8694, radiusKm: 22, minLinks: 4 },
  { id: "naha", ja: "沖縄（那覇）", en: "Okinawa (Naha)", lat: 26.2124, lon: 127.6809, radiusKm: 25, minLinks: 4 },
  // East and Southeast Asia
  { id: "hongkong", ja: "香港", en: "Hong Kong", lat: 22.3, lon: 114.17, radiusKm: 25, minLinks: 8 },
  { id: "macau", ja: "マカオ", en: "Macau", lat: 22.1667, lon: 113.55, radiusKm: 8, minLinks: 6 },
  { id: "taipei", ja: "台北", en: "Taipei", lat: 25.033, lon: 121.5654, radiusKm: 16, minLinks: 8 },
  { id: "seoul", ja: "ソウル", en: "Seoul", lat: 37.5665, lon: 126.978, radiusKm: 16, minLinks: 10 },
  { id: "busan", ja: "釜山", en: "Busan", lat: 35.1796, lon: 129.0756, radiusKm: 18, minLinks: 6 },
  { id: "shanghai", ja: "上海", en: "Shanghai", lat: 31.2304, lon: 121.4737, radiusKm: 18, minLinks: 10 },
  { id: "beijing", ja: "北京", en: "Beijing", lat: 39.9042, lon: 116.4074, radiusKm: 22, minLinks: 12 },
  { id: "bangkok", ja: "バンコク", en: "Bangkok", lat: 13.7563, lon: 100.5018, radiusKm: 16, minLinks: 8 },
  { id: "chiangmai", ja: "チェンマイ", en: "Chiang Mai", lat: 18.7883, lon: 98.9853, radiusKm: 16, minLinks: 4 },
  { id: "phuket", ja: "プーケット", en: "Phuket", lat: 7.8804, lon: 98.3923, radiusKm: 28, minLinks: 4 },
  { id: "singapore", ja: "シンガポール", en: "Singapore", lat: 1.3521, lon: 103.8198, radiusKm: 20, minLinks: 10 },
  { id: "kualalumpur", ja: "クアラルンプール", en: "Kuala Lumpur", lat: 3.139, lon: 101.6869, radiusKm: 18, minLinks: 8 },
  { id: "hanoi", ja: "ハノイ", en: "Hanoi", lat: 21.0278, lon: 105.8342, radiusKm: 14, minLinks: 6 },
  { id: "hochiminh", ja: "ホーチミン", en: "Ho Chi Minh City", lat: 10.8231, lon: 106.6297, radiusKm: 14, minLinks: 6 },
  { id: "danang", ja: "ダナン・ホイアン", en: "Da Nang & Hoi An", lat: 15.98, lon: 108.26, radiusKm: 28, minLinks: 4 },
  { id: "bali", ja: "バリ島", en: "Bali", lat: -8.5, lon: 115.2, radiusKm: 50, minLinks: 5 },
  { id: "cebu", ja: "セブ", en: "Cebu", lat: 10.3157, lon: 123.8854, radiusKm: 25, minLinks: 4 },
  { id: "manila", ja: "マニラ", en: "Manila", lat: 14.5995, lon: 120.9842, radiusKm: 16, minLinks: 8 },
  // Europe
  { id: "paris", ja: "パリ", en: "Paris", lat: 48.8566, lon: 2.3522, radiusKm: 9, minLinks: 25 },
  { id: "london", ja: "ロンドン", en: "London", lat: 51.5074, lon: -0.1278, radiusKm: 11, minLinks: 25 },
  { id: "rome", ja: "ローマ", en: "Rome", lat: 41.9028, lon: 12.4964, radiusKm: 9, minLinks: 20 },
  { id: "florence", ja: "フィレンツェ", en: "Florence", lat: 43.7696, lon: 11.2558, radiusKm: 6, minLinks: 12 },
  { id: "venice", ja: "ヴェネツィア", en: "Venice", lat: 45.4408, lon: 12.3155, radiusKm: 8, minLinks: 12 },
  { id: "milan", ja: "ミラノ", en: "Milan", lat: 45.4642, lon: 9.19, radiusKm: 8, minLinks: 12 },
  { id: "barcelona", ja: "バルセロナ", en: "Barcelona", lat: 41.3851, lon: 2.1734, radiusKm: 9, minLinks: 15 },
  { id: "madrid", ja: "マドリード", en: "Madrid", lat: 40.4168, lon: -3.7038, radiusKm: 9, minLinks: 15 },
  { id: "lisbon", ja: "リスボン", en: "Lisbon", lat: 38.7223, lon: -9.1393, radiusKm: 10, minLinks: 12 },
  { id: "amsterdam", ja: "アムステルダム", en: "Amsterdam", lat: 52.3676, lon: 4.9041, radiusKm: 8, minLinks: 12 },
  { id: "berlin", ja: "ベルリン", en: "Berlin", lat: 52.52, lon: 13.405, radiusKm: 11, minLinks: 18 },
  { id: "munich", ja: "ミュンヘン", en: "Munich", lat: 48.1351, lon: 11.582, radiusKm: 9, minLinks: 12 },
  { id: "vienna", ja: "ウィーン", en: "Vienna", lat: 48.2082, lon: 16.3738, radiusKm: 9, minLinks: 15 },
  { id: "prague", ja: "プラハ", en: "Prague", lat: 50.0755, lon: 14.4378, radiusKm: 8, minLinks: 15 },
  { id: "budapest", ja: "ブダペスト", en: "Budapest", lat: 47.4979, lon: 19.0402, radiusKm: 9, minLinks: 12 },
  { id: "zurich", ja: "チューリッヒ", en: "Zurich", lat: 47.3769, lon: 8.5417, radiusKm: 8, minLinks: 8 },
  { id: "athens", ja: "アテネ", en: "Athens", lat: 37.9838, lon: 23.7275, radiusKm: 9, minLinks: 15 },
  { id: "istanbul", ja: "イスタンブール", en: "Istanbul", lat: 41.0082, lon: 28.9784, radiusKm: 12, minLinks: 18 },
  { id: "copenhagen", ja: "コペンハーゲン", en: "Copenhagen", lat: 55.6761, lon: 12.5683, radiusKm: 9, minLinks: 12 },
  { id: "stockholm", ja: "ストックホルム", en: "Stockholm", lat: 59.3293, lon: 18.0686, radiusKm: 9, minLinks: 12 },
  // Americas, Oceania, Middle East
  { id: "newyork", ja: "ニューヨーク", en: "New York", lat: 40.7589, lon: -73.9851, radiusKm: 12, minLinks: 30 },
  { id: "losangeles", ja: "ロサンゼルス", en: "Los Angeles", lat: 34.0522, lon: -118.2437, radiusKm: 28, minLinks: 18 },
  { id: "sanfrancisco", ja: "サンフランシスコ", en: "San Francisco", lat: 37.7749, lon: -122.4194, radiusKm: 12, minLinks: 15 },
  { id: "lasvegas", ja: "ラスベガス", en: "Las Vegas", lat: 36.1147, lon: -115.1728, radiusKm: 12, minLinks: 10 },
  { id: "honolulu", ja: "ハワイ（ホノルル）", en: "Honolulu", lat: 21.3069, lon: -157.8583, radiusKm: 28, minLinks: 8 },
  { id: "guam", ja: "グアム", en: "Guam", lat: 13.4443, lon: 144.7937, radiusKm: 25, minLinks: 4 },
  { id: "vancouver", ja: "バンクーバー", en: "Vancouver", lat: 49.2827, lon: -123.1207, radiusKm: 12, minLinks: 10 },
  { id: "sydney", ja: "シドニー", en: "Sydney", lat: -33.8688, lon: 151.2093, radiusKm: 14, minLinks: 12 },
  { id: "melbourne", ja: "メルボルン", en: "Melbourne", lat: -37.8136, lon: 144.9631, radiusKm: 12, minLinks: 10 },
  { id: "dubai", ja: "ドバイ", en: "Dubai", lat: 25.2048, lon: 55.2708, radiusKm: 22, minLinks: 12 },
];

// What a traveller puts on a wishlist…
const visitKind = /temple|shrine|pagoda|monastery|church|cathedral|basilica|mosque|chapel|synagogue|museum|gallery|\bpark\b|garden|\bzoo\b|aquarium|amusement|theme park|castle|palace|fortress|\bfort\b|citadel|tower|skyscraper|observation|market|bazaar|shopping (?:street|mall|center|centre|district|arcade)|department store|tourist attraction|landmark|monument|memorial|statue|sculpture|fountain|bridge|square|plaza|pier|promenade|harbou?r|beach|island|mountain|\bhill\b|volcano|lake|waterfall|hot spring|onsen|canyon|\bcave\b|neighbou?rhood|quarter|chinatown|old town|historic|archaeological|heritage|ruins|opera|theat(?:er|re)|concert hall|stadium|arena|cemetery|mausoleum|tomb|lighthouse|\bstreet\b|avenue|boulevard|\bgate\b|city gate|triumphal arch|ferris wheel|cable car|funicular|botanical|library|aqueduct|amphitheat/;
// …and what merely has many Wikipedia articles.
const notASight = /station|railway|metro|subway|\bline\b|airport|university|college|school|institute|academy|company|business|enterprise|corporation|bank|hospital|ministry|embassy|consulate|government|parliament house of|municipality|special ward|\bward\b|prefecture|province|\bcity\b|town|village|county|district of|administrative|constituency|capital|country|state|newspaper|broadcaster|television|radio|football club|sports club|team|organization|political|election|event|battle|festival|incident|disaster|earthquake|attack|war\b|summit|olympic games|expo\b|river|sea\b|bay\b|strait|channel|road\b|highway|expressway|motorway|tunnel|port\b|hotel|restaurant|human|family|taxon|film|album|book|song|video game|series/;

const administrative = /special ward|municipality|prefecture|province|\bcountry\b|sovereign|district of|administrative|city designated|big city|million city|megacity|\bcounty\b|commune of|borough|arrondissement|capital|region of|autonomous|\bward\b/;
function kindWeight(kind: string) {
  if (/skyscraper|tower block|office building|library|stadium|arena|cemetery|concert hall/.test(kind)) return 0.25;
  if (/\bisland\b|mosque|church building|chapel|synagogue/.test(kind)) return 0.4;
  if (/theat|opera|bridge|mountain|\bhill\b|volcano|lake|harbou?r|pier|street|avenue|boulevard|square|plaza|neighbou?rhood|quarter|monument|memorial|sculpture|statue/.test(kind)) return 0.65;
  if (/amusement|theme park|market|bazaar|\bzoo\b|aquarium|observation|tourist attraction|castle|palace|temple|shrine|pagoda/.test(kind)) return 1.25;
  return 1;
}

const notASightName = /教区|Diocese|諸島$|Archipelago|取引所|国会図書館|国立.*図書館|総領事館|大使館|証券|^.{0,6}銀行$|Stock Exchange|National Library|の文化財$|^Historic Monuments of|世界遺産$|^(香港島|ランタオ島|九龍|新界|オアフ島|マンハッタン|シンガポール島|済州島|バリ島|セブ島|プーケット島|台湾)$/;

// Wikidata's Japanese headword is the formal name; a wishlist uses the one
// on the guidebook cover.
const familiarJa: Record<string, string> = {
  "鹿苑寺": "金閣寺",
  "慈照寺": "銀閣寺",
  "元離宮二条城": "二条城",
  "大坂城": "大阪城",
  "上野恩賜公園": "上野公園",
  "恩賜上野動物園": "上野動物園",
  "賀茂別雷神社": "上賀茂神社",
  "賀茂御祖神社": "下鴨神社",
  "艋舺龍山寺": "龍山寺",
  "国立故宮博物院": "故宮博物院",
  "高徳院": "鎌倉大仏（高徳院）",
  "東京都庁舎": "東京都庁",
};

/** Applies the naming and exclusion rules to an already generated list. */
function polish(sights: Array<{ q: string; ja: string; en: string; lat: number; lon: number; kind: string; img?: string; desc?: string }>, city: { ja: string; en: string }) {
  const seen = new Set<string>();
  return sights.flatMap((sight) => {
    if (notASightName.test(sight.ja) || notASightName.test(sight.en) || sight.ja === city.ja || sight.en === city.en) return [];
    const ja = familiarJa[sight.ja] ?? sight.ja;
    const key = ja.replace(/[\s・]/g, "");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...sight, ja }];
  });
}

const UA = "TripCheck/0.1 (+https://github.com/syoukim2003110-maker/tripcheck)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generator script reading two loosely shaped public APIs
async function getJson(url: URL, tries = 3): Promise<any> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/sparql-results+json, application/json", "User-Agent": UA }, signal: AbortSignal.timeout(65_000) });
      if (response.ok) return await response.json();
      if (attempt >= tries) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= tries) throw error;
    }
    await sleep(4_000 * attempt);
  }
}

const classLabels = new Map<string, string>();
async function labelClasses(ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => !classLabels.has(id));
  for (let index = 0; index < missing.length; index += 50) {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", missing.slice(index, index + 50).join("|"));
    url.searchParams.set("props", "labels");
    url.searchParams.set("languages", "en");
    url.searchParams.set("format", "json");
    const payload = await getJson(url);
    for (const id of missing.slice(index, index + 50)) {
      classLabels.set(id, String(payload.entities?.[id]?.labels?.en?.value ?? "").toLowerCase());
    }
    await sleep(300);
  }
}

type Sight = { q: string; ja: string; en: string; lat: number; lon: number; kind: string; links: number; img?: string; desc?: string };

async function sightsFor(city: City): Promise<Sight[]> {
  const query = `SELECT ?item ?links ?c ?class WHERE { SERVICE wikibase:around { ?item wdt:P625 ?c . bd:serviceParam wikibase:center "Point(${city.lon} ${city.lat})"^^geo:wktLiteral ; wikibase:radius "${city.radiusKm}" . } ?item wikibase:sitelinks ?links . FILTER(?links >= ${city.minLinks ?? 6}) ?item wdt:P31 ?class . } ORDER BY DESC(?links) LIMIT 900`;
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  const rows: Array<{ item: { value: string }; links: { value: string }; c: { value: string }; class: { value: string } }> = (await getJson(url)).results.bindings;
  // Fame is not the same as being on a traveller's list: Hong Kong's most
  // written-about places are islands and office towers, while the Ladies'
  // Market has six articles. Having a travel-guide listing (a TripAdvisor
  // identifier on the item) is the free signal for "people go here", and
  // those items are fetched separately so a low article count cannot hide them.
  const guideQuery = `SELECT ?item ?links ?c ?class WHERE { SERVICE wikibase:around { ?item wdt:P625 ?c . bd:serviceParam wikibase:center "Point(${city.lon} ${city.lat})"^^geo:wktLiteral ; wikibase:radius "${city.radiusKm}" . } ?item wdt:P3134 ?guide ; wikibase:sitelinks ?links ; wdt:P31 ?class . } ORDER BY DESC(?links) LIMIT 900`;
  const guideUrl = new URL("https://query.wikidata.org/sparql");
  guideUrl.searchParams.set("query", guideQuery);
  let guideRows: typeof rows = [];
  try {
    guideRows = (await getJson(guideUrl)).results.bindings;
  } catch {
    // The fame-ranked list still stands on its own.
  }
  const listed = new Set(guideRows.map((row) => row.item.value.split("/").at(-1)!));
  const byItem = new Map<string, { links: number; lat: number; lon: number; classes: string[] }>();
  for (const row of [...rows, ...guideRows]) {
    const id = row.item.value.split("/").at(-1)!;
    const point = row.c.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!point) continue;
    const entry = byItem.get(id) ?? { links: Number(row.links.value), lat: Number(point[2]), lon: Number(point[1]), classes: [] };
    entry.classes.push(row.class.value.split("/").at(-1)!);
    byItem.set(id, entry);
  }
  await labelClasses([...byItem.values()].flatMap((entry) => entry.classes));
  const kept = [...byItem.entries()].flatMap(([id, entry]) => {
    const kinds = entry.classes.map((value) => classLabels.get(value) ?? "").filter(Boolean);
    // An administrative unit is never a sight, whatever else it is tagged as.
    if (kinds.some((kind) => administrative.test(kind))) return [];
    const visits = kinds.filter((kind) => visitKind.test(kind) && !notASight.test(kind));
    if (visits.length === 0) return [];
    // Fame alone over-ranks office towers and libraries (every Wikipedia has
    // a list of tall buildings). Weight by how wishlist-like the kind is.
    const weight = Math.max(...visits.map(kindWeight));
    const visit = visits.sort((left, right) => kindWeight(right) - kindWeight(left))[0];
    const guideListed = listed.has(id);
    return [{ id, ...entry, kind: visit, score: (entry.links * (guideListed ? 2 : 1) + (guideListed ? 8 : 0)) * weight }];
  }).sort((left, right) => right.score - left.score).slice(0, 45);

  const sights: Sight[] = [];
  for (let index = 0; index < kept.length; index += 45) {
    const batch = kept.slice(index, index + 45);
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", batch.map((entry) => entry.id).join("|"));
    url.searchParams.set("props", "labels|descriptions");
    url.searchParams.set("languages", "ja|en");
    url.searchParams.set("format", "json");
    const payload = await getJson(url);
    // One photo per sight (Wikimedia Commons file name), for the picker cards.
    const imageUrl = new URL("https://query.wikidata.org/sparql");
    imageUrl.searchParams.set("query", `SELECT ?item (SAMPLE(?image) AS ?img) WHERE { VALUES ?item { ${batch.map((entry) => `wd:${entry.id}`).join(" ")} } ?item wdt:P18 ?image } GROUP BY ?item`);
    const images = new Map<string, string>();
    try {
      for (const row of (await getJson(imageUrl)).results.bindings as Array<{ item: { value: string }; img: { value: string } }>) {
        const file = decodeURIComponent(row.img.value.split("/Special:FilePath/").at(-1) ?? "");
        if (file && /\.(jpe?g|png|webp)$/i.test(file)) images.set(row.item.value.split("/").at(-1)!, file);
      }
    } catch {
      // Photos are decoration; the list stands without them.
    }
    for (const entry of batch) {
      const labels = payload.entities?.[entry.id]?.labels ?? {};
      const description = String(payload.entities?.[entry.id]?.descriptions?.ja?.value ?? "").trim();
      const en = String(labels.en?.value ?? "").trim();
      const ja = String(labels.ja?.value ?? "").trim();
      if (!en && !ja) continue;
      // Organisations and island groups that carry a visitable-sounding class.
      if (notASightName.test(ja) || notASightName.test(en) || ja === city.ja || en === city.en) continue;
      sights.push({
        q: entry.id, ja: ja || en, en: en || ja, lat: Number(entry.lat.toFixed(5)), lon: Number(entry.lon.toFixed(5)), kind: entry.kind, links: entry.links,
        ...(images.has(entry.id) ? { img: images.get(entry.id) } : {}),
        ...(description && description.length <= 40 ? { desc: description } : {}),
      });
    }
  }
  // The same sight under two items (a temple and its main hall) reads as a
  // duplicate chip; keep the more famous one.
  const seen = new Set<string>();
  return sights.filter((sight) => {
    const key = sight.ja.replace(/[\s・]/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 36);
}

if (process.argv.includes("--polish")) {
  const { readFileSync } = await import("node:fs");
  const path = new URL("../lib/popular-sights-data.json", import.meta.url);
  const data = JSON.parse(readFileSync(path, "utf8")) as { cities: Array<{ ja: string; en: string; sights: Parameters<typeof polish>[0] }> };
  for (const entry of data.cities) entry.sights = polish(entry.sights, entry);
  writeFileSync(path, `${JSON.stringify(data)}\n`);
  console.log(`polished ${data.cities.length} destinations`);
  process.exit(0);
}

const only = process.argv.slice(2);
const output: Array<Omit<City, "minLinks"> & { sights: Array<Omit<Sight, "links">> }> = [];
for (const city of cities) {
  if (only.length > 0 && !only.includes(city.id)) continue;
  try {
    const sights = await sightsFor(city);
    console.log(`${city.id}: ${sights.length}  ${sights.slice(0, 8).map((sight) => sight.ja).join(" / ")}`);
    if (sights.length >= 6) {
      output.push({ id: city.id, ja: city.ja, en: city.en, lat: city.lat, lon: city.lon, radiusKm: city.radiusKm, sights: polish(sights.map(({ links: _links, ...sight }) => { void _links; return sight; }), city) });
    }
  } catch (error) {
    console.log(`${city.id}: FAILED ${error instanceof Error ? error.message : error}`);
  }
  await sleep(1_500);
}
if (only.length === 0) {
  writeFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), source: "Wikidata (CC0)", cities: output })}\n`);
  console.log(`wrote ${output.length} destinations`);
}
