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
 * Tokyo to Ueno is one stop on the Akita Shinkansen, Seoul to Cheongnyangni
 * one stop on the KTX, Berlin Hauptbahnhof to Südkreuz one stop on an ICE.
 * Nobody crosses a city that way — it needs an express ticket or a reserved
 * seat — and with fewer stops it would always look quickest. High-speed and
 * intercity services are left out of a city's map.
 */
const notOrdinaryLine = /新幹線|Shinkansen|\bKTX\b|\bSRT\b|韓国高速鉄道|Korea Train eXpress|ムグンファ|Mugunghwa|ITX|セマウル|Saemaeul|DMZ|high[- ]speed|高速鉄道|\bTGV\b|\bLGV\b|Acela|アセラ|Express Rail Link|\bICE\b|\bIC\b|\bECE?\b|Inter-?City|インターシティ|都市間鉄道|城際|Warszawa-Express|^WEST(green|blue|Süd)$/i;
/** Amtrak's named trains: a seat on one is booked, and none is a way across New York or Los Angeles. */
const namedIntercityTrain = /^(Ethan Allen Express|Adirondack|Maple Leaf|Empire Service|Southwest Chief|Coast Starlight|Gold Runner|San Joaquins?|San Diegan|Pacific Surfliner|Capitol Corridor)$/;
/** Ordinary commuter lines whose company name happens to contain 高速 ("rapid"). */
const ordinaryDespiteName = new Set(["東京臨海高速鉄道りんかい線", "埼玉高速鉄道線", "東葉高速線", "阪神神戸高速線", "阪急神戸高速線", "神戸電鉄神戸高速線"]);
/*
 * Freight lines carry no passengers (東海道貨物線, the 神奈川臨海鉄道 lines),
 * a bus route or a river tour is not a railway, a "former" line has closed,
 * and a "line" whose name is a station is a slip of the data.
 */
const freightLine = /貨物|臨海鉄道|freight|\bgoods\b|industrial spur/i;
const notARailway = /Bus Route|cycle shuttle|River Tours|^Former /i;
/** A "line" that is a station (the 猫空 gondola's last link is on "Taipei Zoo Station"): the link is real, its line unknown. */
const stationNotLine = /\bstation$|駅$/i;
/** Lines that pass every test above and still do not run. Each one was checked. */
const closedLines = new Set([
  // 仙台鉄道: closed in 1960; Wikidata has no end date on the item.
  "仙台鉄道",
  // Freight branches around Yokohama port (神奈川臨海鉄道本牧線, JR 羽沢線 and 高島線).
  "本牧線", "羽沢線", "高島線",
  // The freight branch from 小岩 to 越中島貨物駅.
  "越中島支線",
]);
/*
 * Places a train passes or stops at that a passenger cannot use: a signal
 * station where trains wait for each other, a freight terminal, a depot.
 * Tokyo Freight Terminal sits beside a sight and would otherwise be offered
 * as the station to walk to.
 */
const notForPassengersKind = /signal (station|box)|passing loop|goods station|freight (station|terminal|yard)|rail yard|classification yard|marshalling yard|motive power depot|train depot|railway depot|rail depot|tram depot|rail terminal|block post|crossover/i;
const passengerKind = /railway station|metro station|subway station|tram stop|train station|light rail station|interchange station|underground station|railway stop|railway halt|passenger|commuter|station building/i;
const notForPassengersName = /信号場|信号所|貨物駅|貨物ターミナル|操車場|車両基地|Signal (Base|Station|Box)\b|Freight (Terminal|Station)|rail yard\b/i;
/*
 * A freight station is "a railway station" to Wikidata too (隅田川駅, 東高島駅,
 * 横浜羽沢駅), so the word alone does not make it one a traveller can use.
 * Unlike a signal station it is not on the way of a passenger train either:
 * the stations either side of it are not joined up when it is taken out.
 */
const freightKind = /goods station|freight (station|terminal|yard)|classification yard|marshalling yard|rail yard/i;
const surelyPassengerKind = /passenger railway station|metro station|tram stop|S-Bahn station|subway station/i;
/** A bus stop is not a station, whatever line Wikidata hangs on it (名古屋の基幹バス, Istanbul's Metrobüs, a BRT). */
const busKind = /^(bus (stop|station|terminus)|combined bus and tram stop)$/i;
const railKind = /rail|metro|tram|subway|train|bahn|funicular|monorail|people mover|cable|landing|ferry|ship|halt/i;
/** Stops with no station building, served by trams or water buses that share the track or the pier. */
const stopKind = /tram stop|landing|passenger ship terminal|ferry (slip|terminal|port)|light rail stop/i;
/** A language whose label is most likely the name on the local sign, tried in this order. */
const fallbackLanguages = ["mul", "fr", "de", "es", "it", "nl", "pt", "cs", "hu", "sv", "da", "tr", "el", "ko", "zh", "zh-hant", "zh-hans", "th", "vi", "ms", "id"];
const companyEnding = /(鉄道|電鉄|電気軌道|交通局|交通|地下鉄|メトロ|モノレール|軌道|急行)$/;
const englishCompanyEnding = /\b(Railway|Railways|Railroad|Metro|Subway|Corporation|Monorail|Transit|Bureau|Liner|Line)$/;
const hasJapanese = /[぀-ヿ一-鿿]/;
const japaneseCities = new Set(["tokyo", "yokohama", "kamakura", "hakone", "nikko", "osaka", "kyoto", "nara", "kobe", "nagoya", "kanazawa", "hiroshima", "fukuoka", "nagasaki", "sapporo", "hakodate", "sendai", "naha"]);

/*
 * What Wikidata cannot tell, city by city. Every entry is a fact about the
 * railway that anyone can check on the operator's map; none is a guess.
 * Line names here are Wikidata's Japanese labels, station names the plain
 * ones this file writes.
 *
 *  open       a station Wikidata marks as closed that trains stop at (its
 *             item also describes a closed namesake).
 *  dropLines  services that run too rarely to send a visitor to.
 *  dropStations / dropLinks  items and "next station" links that are stale
 *             or wrong.
 *  across     two stations with one between them that Wikidata cannot place
 *             (no position on the item): they are joined, one stop short.
 *  sameLine   a line under two names. `from` is the track's name (or a
 *             second label for the same line); every link of it takes the
 *             name on the signs. With several names in `to`, each link takes
 *             the nearest one along the line (東海道本線 is 琵琶湖線 east of
 *             京都 and JR京都線 west of it).
 *  split      one label for two lines that meet end to end.
 *  runsOver   trains of a branch that start on the main line: the 呉線
 *             trains leave from 広島, the 鞍馬 trains from 出町柳.
 *  through    lines whose trains run on into each other end to end. Riding
 *             from one onto the next is one ride, not a change.
 *  tram       what the city calls its tramway, for the stretches where
 *             Wikidata's route numbers do not join up.
 *  nameless   a line Wikidata has the stations of but no item for: the
 *             links with no line that can be reached from `at` are it.
 */
type Fixes = {
  open?: string[];
  dropLines?: string[];
  dropStations?: string[];
  dropLinks?: Array<[string, string, string?]>;
  across?: Array<[string, string]>;
  sameLine?: Array<{ from: string[]; to: Array<[string, string]> }>;
  split?: Array<{ line: string; at: string; side: string; name: [string, string]; rest: [string, string] }>;
  runsOver?: Array<{ service: string; over: string; from: string; to: string }>;
  through?: string[][];
  tram?: [string, string];
  nameless?: Array<{ at: string; name: [string, string] }>;
};
const yokosuka: [string, string] = ["横須賀線", "Yokosuka Line"];
const tokaido: [string, string] = ["東海道線", "Tōkaidō Line"];
const fixes: Record<string, Fixes> = {
  tokyo: {
    // 田端–三河島 is the freight link to the 常磐線; no passenger train uses it.
    // 鶴見–新川崎 is the freight route through 新鶴見信号場.
    dropLinks: [["田端駅", "三河島駅"], ["鶴見駅", "新川崎駅"]],
    sameLine: [
      // The 常磐線 trains that run on to 品川 are the 常磐線（快速）.
      { from: ["常磐線"], to: [["常磐快速線", "Jōban Line (Rapid)"]] },
      // 東武スカイツリーライン is the 伊勢崎線 between 浅草/押上 and 東武動物公園.
      { from: ["東武伊勢崎線"], to: [["東武スカイツリーライン", "Tobu Skytree Line"]] },
      // 中央東線 is the track the 中央線（快速） runs on.
      { from: ["中央東線"], to: [["中央線快速", "Chūō Line (Rapid)"]] },
      // The branches are signed 鶴見線 like the main line.
      { from: ["鶴見線海芝浦支線", "鶴見線大川支線"], to: [["鶴見線", "Tsurumi Line"]] },
    ],
    // West of 東京 the trains are the 横須賀線, east of it the 総武線（快速）.
    split: [{ line: "横須賀・総武快速線", at: "東京駅", side: "品川駅", name: yokosuka, rest: ["総武線（快速）", "Sōbu Line (Rapid)"] }],
    // Airport trains start at 泉岳寺 and 品川.
    runsOver: [{ service: "京急空港線", over: "京急本線", from: "泉岳寺駅", to: "京急蒲田駅" }],
    through: [["横須賀線", "総武線（快速）"], ["東急東横線", "東京メトロ副都心線"], ["東急田園都市線", "東京メトロ半蔵門線"]],
  },
  yokohama: {
    // The subway's 高島町 shares an item with the Tōkyū station that closed in 2004.
    open: ["高島町駅"],
    // …and the Tōkyū link from it to 桜木町 went with that station.
    dropLinks: [["鶴見駅", "新川崎駅"], ["桜木町駅", "高島町駅", "東急東横線"]],
    sameLine: [
      { from: ["横須賀・総武快速線"], to: [yokosuka] },
      // South of 東京 the 上野東京ライン trains are signed 東海道線.
      { from: ["上野東京ライン", "東海道本線"], to: [tokaido] },
      { from: ["鶴見線海芝浦支線", "鶴見線大川支線"], to: [["鶴見線", "Tsurumi Line"]] },
    ],
    // 京浜東北線 trains run on to 大船 over the 根岸線; every みなとみらい線 train comes off the 東横線.
    through: [["京浜東北線", "根岸線"], ["東急東横線", "みなとみらい線"]],
  },
  kamakura: {
    sameLine: [{ from: ["横須賀・総武快速線"], to: [yokosuka] }, { from: ["上野東京ライン", "東海道本線"], to: [tokaido] }],
  },
  hakone: { sameLine: [{ from: ["上野東京ライン", "東海道本線"], to: [tokaido] }] },
  osaka: {
    // 立花, between 尼崎 and 甲子園口.
    across: [["尼崎駅", "甲子園口駅"]],
    sameLine: [
      // 東海道本線 is signed JR京都線 north-east of 大阪 and JR神戸線 west of it.
      { from: ["東海道本線"], to: [["JR京都線", "JR Kyoto Line"], ["JR神戸線", "JR Kobe Line"]] },
      // 関西本線 is signed 大和路線 from JR難波 to 加茂, 福知山線 is JR宝塚線.
      { from: ["関西本線"], to: [["大和路線", "Yamatoji Line"]] },
      { from: ["福知山線"], to: [["JR宝塚線", "JR Takarazuka Line"]] },
    ],
    // Trains run through 大阪 (JR京都線 ⇄ JR神戸線), 江坂 (every 北大阪急行 train is a 御堂筋線 train) and 京橋 (JR東西線 ⇄ 学研都市線).
    through: [["JR京都線", "JR神戸線"], ["御堂筋線", "北大阪急行"], ["JR東西線", "学研都市線"]],
  },
  kyoto: {
    sameLine: [
      // 山陰本線 is signed 嵯峨野線 from 京都 to 園部.
      { from: ["山陰本線"], to: [["嵯峨野線", "Sagano Line"]] },
      // 東海道本線 is signed 琵琶湖線 east of 京都 and JR京都線 west of it.
      { from: ["東海道本線"], to: [["琵琶湖線", "Biwako Line"], ["JR京都線", "JR Kyoto Line"]] },
    ],
    // 鞍馬 trains start at 出町柳.
    runsOver: [{ service: "鞍馬線", over: "叡山本線", from: "出町柳駅", to: "宝ヶ池駅" }],
    // Trains run through 京都 (琵琶湖線 ⇄ JR京都線) and 三条 (鴨東線 ⇄ 京阪本線).
    through: [["琵琶湖線", "JR京都線"], ["京阪鴨東線", "京阪本線"]],
  },
  nara: { sameLine: [{ from: ["関西本線"], to: [["大和路線", "Yamatoji Line"]] }] },
  kobe: {
    // JR神戸線 is the 東海道本線 and 山陽本線 between 大阪 and 姫路.
    sameLine: [{ from: ["東海道本線", "山陽本線"], to: [["JR神戸線", "JR Kobe Line"]] }],
    // 北神線 trains have run through to the 西神・山手線 since the line joined the city subway in 2020.
    through: [["西神・山手線", "北神線"]],
  },
  nagoya: {
    // 東大手 closed in 1944 and reopened in 1978; trains stop there.
    open: ["東大手駅"],
    // 砂田橋, between ナゴヤドーム前矢田 and 守山 on the ゆとりーとライン.
    across: [["守山駅", "ナゴヤドーム前矢田駅"]],
    // 熱田–千種 does not exist, and 熱田–名古屋 skips 金山 and 尾頭橋.
    dropLinks: [["熱田駅", "千種駅"], ["熱田駅", "名古屋駅"]],
    sameLine: [
      { from: ["東海道線 (名古屋地区)"], to: [["東海道本線", "Tōkaidō Main Line"]] },
      { from: ["中央本線 (名古屋地区)", "中央西線"], to: [["中央本線", "Chūō Main Line"]] },
      // ゆとりーとライン is what the ガイドウェイバス志段味線 is called.
      { from: ["ガイドウェイバス志段味線"], to: [["ゆとりーとライン", "Yutorito Line"]] },
    ],
  },
  // The 北陸本線 through 金沢 became the IRいしかわ鉄道線 on 2024-03-16.
  kanazawa: { sameLine: [{ from: ["北陸本線"], to: [["IRいしかわ鉄道線", "IR Ishikawa Railway Line"]] }] },
  hiroshima: {
    // 紙屋町 was split into 紙屋町東 and 紙屋町西 in 2001; the old item still has links.
    dropStations: ["紙屋町"],
    // 広島–横川 skips 新白島. The tram track from 的場町 to 広島駅 over 猿猴橋 closed
    // in August 2025 when the trams moved to the new bridge route into the station.
    dropLinks: [["広島駅", "横川駅"], ["的場町", "広島駅"]],
    sameLine: [{ from: ["広島新交通1号線"], to: [["アストラムライン", "Astram Line"]] }],
    // 呉線 and 可部線 trains start at 広島.
    runsOver: [
      { service: "呉線", over: "山陽本線", from: "広島駅", to: "海田市駅" },
      { service: "可部線", over: "山陽本線", from: "広島駅", to: "横川駅" },
    ],
  },
  // 福北ゆたか線 is 博多–吉塚, the whole 篠栗線, and the 筑豊本線 north of 桂川.
  fukuoka: { sameLine: [{ from: ["篠栗線"], to: [["福北ゆたか線", "Fukuhoku Yutaka Line"]] }] },
  // Route 2 is a single late-night run from 蛍茶屋 to 赤迫; the trams a visitor boards are 1, 3, 4 and 5.
  nagasaki: { dropLines: ["長崎電気軌道2号系統"], tram: ["長崎電気軌道", "Nagasaki Electric Tramway"] },
  hakodate: { tram: ["函館市電", "Hakodate City Tram"] },
  sapporo: { tram: ["札幌市電", "Sapporo Streetcar"] },
  venice: { tram: ["ヴァポレット", "Vaporetto"] },
  // The cable car from Tung Chung up to the Big Buddha, by way of two angle stations.
  hongkong: { nameless: [{ at: "昂坪駅", name: ["昂坪360", "Ngong Ping 360"] }] },
};

/*
 * The name on the signs, where Wikidata's label is the legal or the
 * engineering one. Applied to a line by its Japanese label, in every city.
 */
const lineDisplayNames: Record<string, [string, string]> = {
  "ゆりかもめ東京臨海新交通臨海線": ["ゆりかもめ", "Yurikamome"],
  "舞浜リゾートラインディズニーリゾートライン線": ["ディズニーリゾートライン", "Disney Resort Line"],
  "東京モノレール羽田空港線": ["東京モノレール", "Tokyo Monorail"],
  // JR East's own names for the rapid and the all-stations trains.
  "中央・総武緩行線": ["中央・総武線（各駅停車）", "Chūō-Sōbu Line (Local)"],
  "中央線快速": ["中央線（快速）", "Chūō Line (Rapid)"],
  "常磐快速線": ["常磐線（快速）", "Jōban Line (Rapid)"],
  "常磐緩行線": ["常磐線（各駅停車）", "Jōban Line (Local)"],
  "東京メトロ丸ノ内線方南町支線": ["東京メトロ丸ノ内線（方南町支線）", "Marunouchi Line (Hōnanchō Branch)"],
  "みなとみらい21線": ["みなとみらい線", "Minatomirai Line"],
  // 湘南モノレール's one line; "江の島線" alone reads as the Odakyū or the Enoden.
  "江の島線": ["湘南モノレール", "Shonan Monorail"],
  // The company became 小田急箱根 in 2024; the trains are still 箱根登山電車.
  "小田急箱根鉄道線": ["箱根登山電車", "Hakone Tozan Train"],
  "小田急箱根鋼索線": ["箱根登山ケーブルカー", "Hakone Tozan Cable Car"],
  "箱根 駒ヶ岳ロープウェー": ["箱根駒ヶ岳ロープウェー", "Hakone Komagatake Ropeway"],
  // JR West's line nicknames, used on every sign.
  "桜島線": ["JRゆめ咲線", "JR Yumesaki Line"],
  "片町線": ["学研都市線", "Gakkentoshi Line"],
  "桜井線": ["万葉まほろば線", "Man-yō Mahoroba Line"],
  "札沼線": ["学園都市線", "Gakuen-Toshi Line"],
  // 北大阪急行電鉄南北線: "南北線" alone says nothing in Osaka.
  "南北線|Kita-Osaka Kyuko railway Namboku Line": ["北大阪急行", "Kita-Osaka Kyuko Line"],
  "国際文化公園都市モノレール線": ["彩都線", "Saito Line"],
  // 嵐電 is what Keifuku's two Kyoto tram lines are called.
  "京福電気鉄道嵐山本線": ["嵐電嵐山本線", "Randen Arashiyama Line"],
  "北野線|Keifuku Kitano Line": ["嵐電北野線", "Randen Kitano Line"],
  "東部丘陵線": ["リニモ", "Linimo"],
  "一条・山鼻軌道線": ["札幌市電", "Sapporo Streetcar"],
  // The city subway's lines are 西神・山手線, 海岸線 and 北神線 on the signs.
  "神戸市営地下鉄西神・山手線": ["西神・山手線", "Seishin-Yamate Line"],
  "神戸市営地下鉄海岸線": ["海岸線", "Kaigan Line"],
  "神戸市営地下鉄北神線": ["北神線", "Hokushin Line"],
  // English labels that were another line's name, or missing.
  "阪神神戸高速線": ["阪神神戸高速線", "Hanshin Kobe Kosoku Line"],
  "神戸電鉄神戸高速線": ["神戸電鉄神戸高速線", "Shintetsu Kobe Kosoku Line"],
  "原田線": ["原田線", "Haruda Line"],
};
/** The tram carries the number; the company name in front of it is on no sign. */
const routePrefix = /^長崎電気軌道(?=\d+号系統$)/;
/** Seoul's subway lines are 「4号線」 on every sign, whoever operates the stretch. */
const seoulLine = /^(?:首都圏電鉄|ソウル交通公社|ソウル市メトロ)(\d+号線)(急行)?$/;
const seoulLineEnglish = /^Seoul (?:Metropolitan )?Subway (Line \d+)( Express)?$/;
/** Station names with no English label, romanised from the Japanese one. */
const stationEnglish: Record<string, string> = {
  "飛鳥山公園入口駅": "Asukayama Kōen-iriguchi Station",
  "飛鳥山山頂駅": "Asukayama Sanchō Station",
  "比叡山頂駅": "Hiei Sanchō Station",
  "函館駅前": "Hakodate-Ekimae",
};

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
/** Venice names each pontoon of a stop: Accademia "A" and Accademia "B" are Accademia. */
const pontoon = /\s*["“”«»]\s*[A-Z0-9]{1,2}\s*["“”«»]$/;

type Station = { id: string; ja: string; en: string; lat: number; lon: number; lines: Set<string>; forPassengers: boolean; passedThrough: boolean; stop: boolean };
type Link = { low: string; high: string; lines: Set<string> };

function build(city: City, raw: Raw) {
  const fix = fixes[city.id] ?? {};
  const notes: string[] = [];
  const open = new Set(fix.open ?? []);
  const closed = new Set(raw.notInService.map((row) => idOf(row.s)));
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
  /** Stations Wikidata says have closed: a train may still run through where one stood. */
  const closedIds = new Set<string>();
  for (const row of adjacency) {
    const id = idOf(row.s);
    const point = row.c?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!id || !point || stations.has(id)) continue;
    if (closed.has(id) && !open.has(plainStationName(text(row.sJa)))) { closedIds.add(id); continue; }
    // A few "English" labels are the Japanese name pasted in (広島高速交通
    // 大町駅). That is no English label at all.
    const english = hasJapanese.test(text(row.sEn)) ? "" : text(row.sEn);
    const local = text(row.sJa) || english ? "" : localName(id);
    const ja = text(row.sJa) || english || local;
    const en = english || local || text(row.sJa);
    if (!ja && !en) continue;
    const kind = kinds.get(id) ?? [];
    const freight = kind.some((entry) => freightKind.test(entry)) && !kind.some((entry) => surelyPassengerKind.test(entry));
    const bus = /(停留所|バス停)$/.test(ja) || (kind.some((entry) => busKind.test(entry)) && !kind.some((entry) => !busKind.test(entry) && railKind.test(entry)) && !/駅$/.test(ja));
    const siding = notForPassengersName.test(ja) || notForPassengersName.test(en) || (kind.some((entry) => notForPassengersKind.test(entry)) && !kind.some((entry) => passengerKind.test(entry)));
    stations.set(id, {
      id, ja, en, lat: Number(Number(point[2]).toFixed(5)), lon: Number(Number(point[1]).toFixed(5)), lines: new Set(),
      forPassengers: !(freight || bus || siding),
      // A signal station is on a passenger train's way; a freight yard or a bus stop is not.
      passedThrough: siding && !bus && !(freight && !notForPassengersName.test(ja)),
      stop: kind.some((entry) => stopKind.test(entry)) || /停留場$/.test(ja),
    });
  }

  const lines = new Map<string, { ja: string; en: string }>();
  const droppedLines = new Set(fix.dropLines ?? []);
  const slips = new Set<string>();
  for (const row of [...raw.lineInfo].sort((left, right) => qNumber(idOf(left.line)) - qNumber(idOf(right.line)))) {
    const id = idOf(row.line);
    if (!id || lines.has(id)) continue;
    const labels = [text(row.lineJa), text(row.lineEn)];
    // A line that is only a plan connects nothing yet, and one that has
    // closed (the Ueno Zoo monorail) connects nothing any more.
    if (row.unbuilt?.value === "true" || row.closed?.value === "true" || labels.some((label) => plannedLine.test(label))) continue;
    if (!ordinaryDespiteName.has(labels[0]) && labels.some((label) => notOrdinaryLine.test(label) || freightLine.test(label) || namedIntercityTrain.test(label))) continue;
    if (labels.some((label) => stationNotLine.test(label))) { slips.add(id); continue; }
    if (labels.some((label) => notARailway.test(label)) || closedLines.has(labels[0]) || droppedLines.has(labels[0])) continue;
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

  const links = new Map<string, Link>();
  const pairKey = (a: string, b: string) => (qNumber(a) < qNumber(b) ? `${a}-${b}` : `${b}-${a}`);
  const linkOf = (a: string, b: string) => {
    const key = pairKey(a, b);
    if (!links.has(key)) links.set(key, qNumber(a) < qNumber(b) ? { low: a, high: b, lines: new Set() } : { low: b, high: a, lines: new Set() });
    return links.get(key)!;
  };
  const addLine = (a: string, b: string, line: string) => { if (a !== b) linkOf(a, b).lines.add(line); };
  const removeLine = (link: Link, line: string) => {
    link.lines.delete(line);
    if (link.lines.size === 0) links.delete(pairKey(link.low, link.high));
  };
  /**
   * "pair|line" where the line is a guest: Wikidata gives it there only as a
   * service on some other track, and a line whose own track it is runs there
   * too (武蔵野線 on the 京葉線 into 東京, 七尾線 on the IRいしかわ鉄道線 out
   * of 金沢, おおさか東線 beside the JR京都線 into 大阪).
   */
  const guest = new Set<string>();
  /** "pair|line" where the line is the track itself, or is given without a track. */
  const atHome = new Set<string>();
  /** A link's line takes another name: a guest stays one, and the track's own name is never a guest. */
  const rename = (link: Link, source: string, target: string) => {
    const pair = pairKey(link.low, link.high);
    const wasGuest = guest.delete(`${pair}|${source}`);
    link.lines.delete(source);
    if (!link.lines.has(target)) { link.lines.add(target); if (wasGuest) guest.add(`${pair}|${target}`); }
    else if (!wasGuest) guest.delete(`${pair}|${target}`);
  };
  const offTheMap = new Set<string>();
  /** Lines between tram stops that Wikidata gives as the track under a route. */
  const tramTracks = new Set<string>();
  /** "Next station" pointers at a station that is not on the map, by that station and line. */
  const pointersAtMissing = new Map<string, Set<string>>();
  for (const row of adjacency) {
    const from = idOf(row.s);
    const to = idOf(row.adj);
    if (!stations.has(from) || !to || from === to) continue;
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
    const service = slips.has(idOf(row.service)) ? "" : idOf(row.service);
    const track = slips.has(idOf(row.line)) ? "" : idOf(row.line);
    const stated = service || track;
    // A link given on a line that is not on the map (freight, high-speed,
    // closed) is not a link, even where another statement repeats it with
    // no line at all.
    if (stated && !lines.has(stated)) { if (stations.has(to)) offTheMap.add(pairKey(from, to)); continue; }
    if (!stations.has(to)) {
      pointersAtMissing.set(`${to}|${stated}`, (pointersAtMissing.get(`${to}|${stated}`) ?? new Set()).add(from));
      continue;
    }
    if (stated) {
      addLine(from, to, stated);
      const tram = stations.get(from)!.stop && stations.get(to)!.stop;
      if (!service || !track || tram) atHome.add(`${pairKey(from, to)}|${stated}`);
      if (track && lines.has(track)) atHome.add(`${pairKey(from, to)}|${track}`);
      // Between tram stops the "line" is as often a route of its own
      // (Melbourne's City Circle beside routes 70 and 75) and is kept too.
      if (service && track && track !== service && lines.has(track) && tram) { addLine(from, to, track); tramTracks.add(track); }
      continue;
    }
    const shared = [...stations.get(from)!.lines].filter((candidate) => stations.get(to)!.lines.has(candidate)).sort((left, right) => qNumber(left) - qNumber(right));
    // Neighbouring stops that are both on the same two or three lines — the
    // Hakodate trams 2 and 5 on their shared track, 大和路線 and 関西本線
    // for one pair of rails — are joined by each of them. Beyond that the
    // stations are big junctions and the guess would be too wide.
    if (shared.length >= 1 && shared.length <= 3) for (const line of shared) { addLine(from, to, line); atHome.add(`${pairKey(from, to)}|${line}`); }
    else addLine(from, to, "");
  }
  // A known line replaces an unknown one for the same pair.
  for (const link of links.values()) if (link.lines.size > 1) link.lines.delete("");
  for (const pair of offTheMap) if (links.get(pair)?.lines.size === 1 && links.get(pair)!.lines.has("")) links.delete(pair);
  for (const [pair, link] of links) {
    if (![...link.lines].some((line) => atHome.has(`${pair}|${line}`))) continue;
    for (const line of link.lines) if (!atHome.has(`${pair}|${line}`)) guest.add(`${pair}|${line}`);
  }
  const linksAt = (id: string) => [...links.values()].filter((link) => link.low === id || link.high === id);
  const other = (link: Link, id: string) => (link.low === id ? link.high : link.low);

  /*
   * Wikidata sometimes points "next station" at the wrong one of two items
   * for the same station: 出屋敷 (Hanshin) lists JR 尼崎 as its neighbour as
   * well as Hanshin 尼崎, 1.9 km away. The link with no line is the mistake
   * when the same station already has a named link to the namesake.
   */
  const sameName = (left: Station, right: Station) => comparable(plainStationName(left.ja)) === comparable(plainStationName(right.ja)) && meters(left, right) <= 2_500;
  for (const link of [...links.values()]) {
    if (!(link.lines.size === 1 && link.lines.has(""))) continue;
    const namesake = [link.low, link.high].some((end) => linksAt(end).some((known) => known !== link && !known.lines.has("")
      && other(known, end) !== other(link, end) && sameName(stations.get(other(known, end))!, stations.get(other(link, end))!)));
    if (namesake) links.delete(pairKey(link.low, link.high));
  }

  /*
   * A place passengers cannot use is taken out. Where a passenger train runs
   * through it (a signal station) the stations either side on the same line
   * become neighbours; a freight yard or a bus stop just goes.
   */
  for (const station of [...stations.values()]) {
    if (station.forPassengers) continue;
    const byLine = new Map<string, string[]>();
    for (const link of linksAt(station.id)) {
      links.delete(pairKey(link.low, link.high));
      for (const line of link.lines) byLine.set(line, [...(byLine.get(line) ?? []), other(link, station.id)]);
    }
    if (station.passedThrough) {
      for (const [line, neighbours] of byLine) {
        if (neighbours.length !== 2 || neighbours[0] === neighbours[1] || links.has(pairKey(neighbours[0], neighbours[1]))) continue;
        addLine(neighbours[0], neighbours[1], line);
        notes.push(`joined ${stations.get(neighbours[0])!.ja} – ${stations.get(neighbours[1])!.ja} across ${station.ja} [${lines.get(line)?.ja ?? ""}]`);
      }
    }
    stations.delete(station.id);
  }
  /*
   * Two stations that both name the same missing station as their neighbour
   * on the same line are neighbours themselves where that station has
   * closed: the train runs through (工業都市 between 新丸子 and 元住吉).
   * Where the station is missing for another reason — Wikidata's item has no
   * position (立花 between 尼崎 and 甲子園口) — the pair is joined only if the
   * table above names it: two stations can also share a neighbour that is a
   * junction off the map (川崎 and 新川崎 both lead to 横浜).
   */
  const join = (a: string, b: string, joining: string[], why: string) => {
    const [first, second] = [stations.get(a), stations.get(b)];
    if (!first || !second || a === b || links.has(pairKey(a, b)) || meters(first, second) > 8_000) return;
    for (const line of joining) addLine(a, b, line);
    notes.push(`joined ${first.ja} – ${second.ja} across ${why} [${joining.map((line) => lines.get(line)?.ja ?? "").join(", ")}]`);
  };
  const across = new Set((fix.across ?? []).flatMap(([first, second]) => [`${first}|${second}`, `${second}|${first}`]));
  const pointing = new Map<string, Map<string, Set<string>>>();
  for (const [key, from] of [...pointersAtMissing].sort(([left], [right]) => left.localeCompare(right))) {
    const [missing, line] = key.split("|");
    if (!pointing.has(missing)) pointing.set(missing, new Map());
    for (const id of from) if (stations.has(id)) pointing.get(missing)!.set(id, (pointing.get(missing)!.get(id) ?? new Set()).add(line));
    if (closedIds.has(missing) && line && from.size === 2) join([...from][0], [...from][1], [line], "a closed station");
  }
  for (const [missing, from] of pointing) {
    if (closedIds.has(missing) || from.size !== 2) continue;
    const [a, b] = [...from.keys()];
    if (!across.has(`${plainStationName(stations.get(a)!.ja)}|${plainStationName(stations.get(b)!.ja)}`)) continue;
    const given = [...new Set([...from.get(a)!, ...from.get(b)!])].filter(Boolean).sort();
    join(a, b, given.length > 0 ? given : [""], "a station that is not on the map");
  }

  /*
   * Names. Company and line names that Wikidata glues onto a station
   * ("東京メトロ有楽町線市ケ谷駅") come off; the candidates are the built-in
   * company list plus this network's own line names and operators.
   */
  const usedLineIds = () => [...new Set([...links.values()].flatMap((link) => [...link.lines]))].filter((id) => id && lines.has(id)).sort((left, right) => left.localeCompare(right));
  const japanesePrefixes = [
    ...usedLineIds().map((id) => lines.get(id)!.ja).filter((name) => hasJapanese.test(name) && name.length >= 3 && /(線|ライン|ライナー)$/.test(name)),
    ...raw.operators.map((row) => text(row.opJa)).filter((name) => companyEnding.test(name)),
  ];
  const englishPrefixes = [
    ...usedLineIds().map((id) => lines.get(id)!.en.replace(/‐/g, "-")).filter((name) => /\b(Line|Liner)$/.test(name)),
    ...raw.operators.map((row) => text(row.opEn)).filter((name) => englishCompanyEnding.test(name)),
  ];
  const renamed: string[] = [];
  for (const station of stations.values()) {
    const before = `${station.ja} / ${station.en}`;
    const ja = plainStationName(station.ja, japanesePrefixes);
    let en = plainStationName(station.en);
    // An English prefix is removed only where the Japanese label lost one
    // (a bracket comes off the end, so the start of the name tells).
    if (hasJapanese.test(station.ja) && !station.ja.startsWith(ja)) en = plainEnglishStationName(en, englishPrefixes);
    // Likewise a bracket on the English label of a station whose Japanese
    // label was told apart by company ("Kanayama Station (Meitetsu)").
    if (hasJapanese.test(station.ja) && station.ja !== ja && station.ja.trim() !== ja) en = en.replace(/(\bStation)\s*\([^)]*\)$/i, "$1");
    en = stationEnglish[ja] ?? en;
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
  for (const station of stations.values()) {
    const lacksJapanese = station.ja === station.en && !hasJapanese.test(station.ja);
    const lacksEnglish = station.ja === station.en && hasJapanese.test(station.en);
    if (!lacksJapanese && !lacksEnglish) continue;
    const twin = [...stations.values()].find((candidate) => candidate !== station && candidate.ja !== candidate.en && meters(station, candidate) <= 320
      && comparable(lacksJapanese ? candidate.en : candidate.ja) === comparable(lacksJapanese ? station.en : station.ja) && comparable(station.en) !== "");
    if (!twin) continue;
    renamed.push(`${station.ja} / ${station.en}  =>  ${twin.ja} / ${twin.en} (borrowed)`);
    if (lacksJapanese) station.ja = twin.ja; else station.en = twin.en;
  }
  // "Yoyogi" beside "Shinjuku Station": in Japan every 駅 is "… Station".
  if (japaneseCities.has(city.id)) {
    for (const station of stations.values()) if (/駅$/.test(station.ja) && !hasJapanese.test(station.en) && !/station/i.test(station.en)) station.en = `${station.en} Station`;
  }

  // ----- what Wikidata cannot tell (the table above) -----
  const named = (ja: string) => [...stations.values()].filter((station) => station.ja === ja).map((station) => station.id);
  const linksOf = (line: string) => [...links.values()].filter((link) => link.lines.has(line));
  /** The line with this Japanese name that has the most links, or a new one. */
  const lineNamed = (ja: string, en: string) => {
    const known = [...lines.entries()].filter(([, line]) => line.ja === ja).map(([id]) => ({ id, size: linksOf(id).length })).sort((left, right) => right.size - left.size || left.id.localeCompare(right.id))[0];
    if (known) return known.id;
    lines.set(`X:${ja}`, { ja, en });
    return `X:${ja}`;
  };
  const existing = (ja: string) => [...lines.entries()].filter(([, line]) => line.ja === ja).map(([id]) => id);
  for (const name of fix.dropStations ?? []) {
    for (const id of named(name)) {
      for (const link of linksAt(id)) links.delete(pairKey(link.low, link.high));
      stations.delete(id);
    }
  }
  for (const [first, second, only] of fix.dropLinks ?? []) {
    for (const a of named(first)) {
      for (const b of named(second)) {
        const link = links.get(pairKey(a, b));
        if (link && only) for (const line of existing(only)) removeLine(link, line);
        else links.delete(pairKey(a, b));
      }
    }
  }
  for (const { from, to } of fix.sameLine ?? []) {
    const targets = to.map(([ja, en]) => lineNamed(ja, en));
    for (const source of from.flatMap(existing)) {
      if (targets.includes(source)) continue;
      // How far each station is from the nearest link that already has one
      // of the names, walking along the line being renamed.
      const nearest = new Map<string, { line: string; hops: number }>();
      let frontier: string[] = [];
      for (const target of targets) {
        for (const link of linksOf(target)) for (const end of [link.low, link.high]) if (!nearest.has(end)) { nearest.set(end, { line: target, hops: 0 }); frontier.push(end); }
      }
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const link of linksAt(id)) {
            const far = other(link, id);
            if (!link.lines.has(source) || nearest.has(far)) continue;
            nearest.set(far, { line: nearest.get(id)!.line, hops: nearest.get(id)!.hops + 1 });
            next.push(far);
          }
        }
        frontier = next;
      }
      // A stretch the walk cannot reach (a gap in the data) takes the name used nearest to it on the ground.
      const inUse = targets.flatMap((target) => linksOf(target).map((link) => ({ target, at: stations.get(link.low)! })));
      const onTheGround = (link: Link) => inUse.sort((left, right) => meters(left.at, stations.get(link.low)!) - meters(right.at, stations.get(link.low)!))[0]?.target ?? targets[0];
      for (const link of linksOf(source)) {
        const [low, high] = [nearest.get(link.low), nearest.get(link.high)];
        rename(link, source, targets.find((target) => link.lines.has(target)) ?? (!low && !high ? onTheGround(link) : !low ? high!.line : !high || low.hops <= high.hops ? low.line : high.line));
      }
    }
  }
  for (const { line, at, side, name, rest } of fix.split ?? []) {
    for (const source of existing(line)) {
      const [sideLine, restLine] = [lineNamed(name[0], name[1]), lineNamed(rest[0], rest[1])];
      const wall = new Set(named(at));
      const reached = new Set(named(side).filter((id) => linksAt(id).some((link) => link.lines.has(source))));
      let frontier = [...reached];
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const id of frontier) {
          if (wall.has(id)) continue;
          for (const link of linksAt(id)) {
            const far = other(link, id);
            if (!link.lines.has(source) || reached.has(far)) continue;
            reached.add(far);
            next.push(far);
          }
        }
        frontier = next;
      }
      for (const link of linksOf(source)) {
        const onSide = (reached.has(link.low) && !wall.has(link.low)) || (reached.has(link.high) && !wall.has(link.high));
        rename(link, source, onSide ? sideLine : restLine);
      }
    }
  }
  for (const { service, over, from, to } of fix.runsOver ?? []) {
    const [serviceLine] = existing(service);
    const goals = new Set(named(to));
    for (const track of serviceLine ? existing(over) : []) {
      // The shortest way from one station to the other along the main line.
      const came = new Map<string, string | null>(named(from).map((id) => [id, null]));
      let frontier = [...came.keys()];
      let goal: string | undefined;
      while (frontier.length > 0 && !goal) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const link of linksAt(id)) {
            const far = other(link, id);
            if (!link.lines.has(track) || came.has(far)) continue;
            came.set(far, id);
            next.push(far);
            if (goals.has(far)) goal ??= far;
          }
        }
        frontier = next;
      }
      for (let id = goal; id && came.get(id); id = came.get(id)!) {
        if (!linkOf(id, came.get(id)!).lines.has(serviceLine)) guest.add(`${pairKey(id, came.get(id)!)}|${serviceLine}`);
        addLine(id, came.get(id)!, serviceLine);
      }
    }
  }

  for (const { at, name } of fix.nameless ?? []) {
    const line = lineNamed(name[0], name[1]);
    const seen = new Set(named(at));
    for (const queue = [...seen]; queue.length > 0;) {
      const id = queue.pop()!;
      for (const link of linksAt(id)) {
        if (!(link.lines.size === 1 && link.lines.has(""))) continue;
        link.lines.clear();
        link.lines.add(line);
        if (!seen.has(other(link, id))) { seen.add(other(link, id)); queue.push(other(link, id)); }
      }
    }
  }

  // ----- what holds for every network -----
  /*
   * One stop, two items: Venice has one per pontoon (Accademia "A" and "B"),
   * and a water bus that calls at "A" continues from "B". They become one
   * stop. Only stops with no station building, never two railway stations —
   * those stay apart, to change between.
   */
  const stopName = (station: Station) => comparable(station.ja.replace(pontoon, ""));
  for (const station of [...stations.values()].sort((left, right) => qNumber(left.id) - qNumber(right.id))) {
    if (!station.stop || !stations.has(station.id)) continue;
    for (const twin of [...stations.values()]) {
      if (twin === station || !twin.stop || stopName(twin) !== stopName(station) || stopName(station) === "") continue;
      if (meters(station, twin) > (pontoon.test(station.ja) || pontoon.test(twin.ja) ? 300 : 120)) continue;
      for (const link of linksAt(twin.id)) {
        links.delete(pairKey(link.low, link.high));
        for (const line of link.lines) addLine(station.id, other(link, twin.id), line);
      }
      stations.delete(twin.id);
      notes.push(`one stop: ${station.ja} + ${twin.ja}`);
    }
    station.ja = station.ja.replace(pontoon, "");
    station.en = station.en.replace(pontoon, "");
  }
  for (const link of links.values()) if (link.lines.size > 1) link.lines.delete("");

  /*
   * A "next station" that skips some (名古屋 → 熱田 past 金山, ソウル駅 → 清凉里
   * past nine stations of line 1): when the same line also joins A to C by
   * way of the stations between them, A–C is the same track written twice
   * and would be ridden as a one-stop shortcut. A real express has a line
   * of its own and is not touched.
   */
  const neighboursOn = (line: string) => {
    const at = new Map<string, Set<string>>();
    for (const link of linksOf(line)) {
      at.set(link.low, (at.get(link.low) ?? new Set()).add(link.high));
      at.set(link.high, (at.get(link.high) ?? new Set()).add(link.low));
    }
    return at;
  };
  const removeShortcuts = () => {
    for (const line of usedLineIds()) {
      const at = neighboursOn(line);
      // Longest first, so that of three stops in a row it is the link past the middle one that goes.
      const longestFirst = linksOf(line).map((link) => ({ link, length: meters(stations.get(link.low)!, stations.get(link.high)!) })).sort((left, right) => right.length - left.length);
      for (const { link, length } of longestFirst) {
        // The shortest way round by shorter links, given up once it is clearly a detour.
        const reached = new Map<string, number>([[link.low, 0]]);
        const queue = [link.low];
        let around = Infinity;
        while (queue.length > 0) {
          queue.sort((left, right) => reached.get(left)! - reached.get(right)!);
          const id = queue.shift()!;
          if (id === link.high) { around = reached.get(id)!; break; }
          for (const next of at.get(id) ?? []) {
            if (id === link.low && next === link.high) continue;
            const hop = meters(stations.get(id)!, stations.get(next)!);
            const far = reached.get(id)! + hop;
            if (hop >= length || far > length * 1.25 || far >= (reached.get(next) ?? Infinity)) continue;
            reached.set(next, far);
            if (!queue.includes(next)) queue.push(next);
          }
        }
        if (around === Infinity) continue;
        notes.push(`shortcut removed: ${stations.get(link.low)!.ja} – ${stations.get(link.high)!.ja} [${lines.get(line)!.ja}]`);
        at.get(link.low)!.delete(link.high);
        at.get(link.high)!.delete(link.low);
        removeLine(link, line);
      }
    }
  };
  removeShortcuts();

  /*
   * A link with no line between two stations of the same line is that line
   * (原町–篠栗 on the 福北ゆたか線), and so is one that leads on from a line
   * to a station with nothing else (the far end of a ropeway).
   */
  const namedLinesAt = (id: string) => new Set(linksAt(id).flatMap((link) => [...link.lines]).filter(Boolean));
  for (let changed = true; changed;) {
    changed = false;
    for (const link of [...links.values()]) {
      if (!link.lines.has("")) continue;
      const [low, high] = [namedLinesAt(link.low), namedLinesAt(link.high)];
      const both = [...low].filter((line) => high.has(line));
      const only = low.size === 0 && high.size === 1 ? [...high] : high.size === 0 && low.size === 1 ? [...low] : [];
      const line = both.length === 1 ? both[0] : only[0];
      if (!line) continue;
      link.lines.delete("");
      link.lines.add(line);
      notes.push(`named: ${stations.get(link.low)!.ja} – ${stations.get(link.high)!.ja} [${lines.get(line)!.ja}]`);
      changed = true;
    }
  }

  const pieces = (line: string) => {
    const at = neighboursOn(line);
    const piece = new Map<string, number>();
    let count = 0;
    for (const start of at.keys()) {
      if (piece.has(start)) continue;
      piece.set(start, count);
      for (const queue = [start]; queue.length > 0;) {
        for (const far of at.get(queue.pop()!)!) if (!piece.has(far)) { piece.set(far, count); queue.push(far); }
      }
      count += 1;
    }
    return { piece, count, at };
  };
  /*
   * A line in two pieces whose loose ends are joined by a link under another
   * name is one line: the link in the gap gets the line's name as well.
   */
  for (const line of usedLineIds()) {
    for (let changed = true; changed;) {
      changed = false;
      const { piece, count, at } = pieces(line);
      if (count < 2) break;
      for (const link of links.values()) {
        if (link.lines.has(line) || !piece.has(link.low) || !piece.has(link.high) || piece.get(link.low) === piece.get(link.high)) continue;
        if (at.get(link.low)!.size !== 1 || at.get(link.high)!.size !== 1) continue;
        link.lines.add(line);
        link.lines.delete("");
        notes.push(`gap closed: ${stations.get(link.low)!.ja} – ${stations.get(link.high)!.ja} [${lines.get(line)!.ja}]`);
        changed = true;
        break;
      }
    }
  }

  /*
   * Trams and water buses. A route's name is worth printing only if the
   * route is one connected run: Hakodate's routes 2 and 5 come out of
   * Wikidata in three pieces each, and a single tram ride across the city
   * became five rides with walks between them. Where the routes do not join
   * up, the stretch is named after the tramway itself — one name, one ride.
   * Where most of a city's tram links are like that, the whole tramway is.
   */
  // The track under tram routes is kept only where it is a ride of its own.
  // 長崎電気軌道本線 is all inside route 1 and says nothing a tram's number
  // does not; Melbourne's City Circle is a tram to board.
  for (const track of [...tramTracks].sort()) {
    const own = linksOf(track);
    const cover = own.length > 0 ? [...own[0].lines].find((line) => line !== track && line !== "" && own.every((link) => link.lines.has(line))) : undefined;
    if (cover) for (const link of own) link.lines.delete(track);
  }
  const isStopLink = (link: Link) => stations.get(link.low)!.stop && stations.get(link.high)!.stop;
  const system = new Map<string, number>();
  let systems = 0;
  for (const link of links.values()) {
    if (!isStopLink(link) || system.has(link.low)) continue;
    system.set(link.low, systems);
    for (const queue = [link.low]; queue.length > 0;) {
      const id = queue.pop()!;
      for (const next of linksAt(id)) if (isStopLink(next) && !system.has(other(next, id))) { system.set(other(next, id), systems); queue.push(other(next, id)); }
    }
    systems += 1;
  }
  const joinedUp = new Map<string, boolean>();
  const isJoinedUp = (line: string) => {
    if (!joinedUp.has(line)) joinedUp.set(line, line !== "" && pieces(line).count === 1);
    return joinedUp.get(line)!;
  };
  for (let index = 0; index < systems; index += 1) {
    const own = [...links.values()].filter((link) => isStopLink(link) && system.get(link.low) === index);
    const loose = own.filter((link) => ![...link.lines].some(isJoinedUp));
    // A route in pieces is not printed where a whole one runs on the same track.
    for (const link of own) for (const line of [...link.lines]) if (!isJoinedUp(line) && [...link.lines].some(isJoinedUp)) link.lines.delete(line);
    if (loose.length === 0) continue;
    const water = own.filter((link) => (kinds.get(link.low) ?? []).some((entry) => /landing|ship|ferry/i.test(entry))).length * 2 > own.length;
    const [ja, en] = fix.tram ?? (water ? ["水上バス", "Water bus"] : japaneseCities.has(city.id) ? ["路面電車", "Tram"] : ["トラム", "Tram"]);
    const tramway = lineNamed(ja, en);
    const whole = loose.length * 10 > own.length * 3;
    for (const link of whole ? own : loose) {
      link.lines.clear();
      link.lines.add(tramway);
    }
    notes.push(`tramway "${ja}": ${whole ? "all" : loose.length} of ${own.length} links`);
  }

  /*
   * The names on the signs (the table above), then lines that end up with
   * one name are one line: Seoul's line 1 is 首都圏電鉄1号線 on Korail's
   * stretch and ソウル交通公社1号線 under the city, and 「1号線」 on both.
   */
  for (const line of lines.values()) {
    const display = lineDisplayNames[line.ja] ?? lineDisplayNames[`${line.ja}|${line.en}`];
    if (display) [line.ja, line.en] = display;
    line.ja = line.ja.replace(routePrefix, "");
    if (city.id === "seoul") {
      line.ja = line.ja.replace(seoulLine, (_, number: string) => number);
      line.en = line.en.replace(seoulLineEnglish, (_, number: string) => number);
    }
  }
  const firstWithName = new Map<string, string>();
  for (const id of usedLineIds()) {
    const name = lines.get(id)!.ja;
    if (!name) continue;
    const first = firstWithName.get(name);
    if (!first) { firstWithName.set(name, id); continue; }
    for (const link of linksOf(id)) rename(link, id, first);
  }
  // The same track written twice may have appeared again.
  removeShortcuts();

  // Only what a journey can use is written: a station nothing connects to
  // cannot be boarded, and a line with no link left is a name without trains.
  const usedStations = new Set([...links.values()].flatMap((link) => [link.low, link.high]));
  const stationList = [...stations.values()].filter((station) => usedStations.has(station.id)).sort((left, right) => qNumber(left.id) - qNumber(right.id));
  const lineIds = usedLineIds().sort((left, right) => (left.startsWith("X:") ? 1 : 0) - (right.startsWith("X:") ? 1 : 0) || qNumber(left) - qNumber(right) || left.localeCompare(right));

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
  const edgeList = [...links.values()]
    .flatMap((link) => [...link.lines].map((line) => [stationIndex.get(link.low)!, stationIndex.get(link.high)!, line ? lineIndex.get(line)! : -1, guest.has(`${pairKey(link.low, link.high)}|${line}`) && link.lines.size > 1 ? 1 : 0]))
    .map(([a, b, line, asGuest]) => (a < b ? [a, b, line, asGuest] : [b, a, line, asGuest]))
    .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2])
    // The fourth number is written only where it says something.
    .map(([a, b, line, asGuest]) => (asGuest ? [a, b, line, 1] : [a, b, line]));
  const through = (fix.through ?? [])
    .map((group) => group.map((name) => lineIds.findIndex((id) => lines.get(id)!.ja === name)).filter((index) => index >= 0).sort((left, right) => left - right))
    .filter((group) => group.length >= 2);
  for (const group of fix.through ?? []) for (const name of group) if (!lineIds.some((id) => lines.get(id)!.ja === name)) notes.push(`through: no line named ${name}`);
  return {
    network: {
      id: city.id,
      source: "Wikidata (CC0)",
      stations: stationList.map((station) => [station.ja, station.en, station.lat, station.lon] as const),
      lines: lineIds.map((id) => [lines.get(id)!.ja, lines.get(id)!.en] as const),
      edges: edgeList,
      // Lines whose trains run on into each other: no change of train between them.
      ...(through.length > 0 ? { through } : {}),
    },
    renamed,
    notes,
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
    const { network, renamed, notes } = build(city, await download(city));
    console.log(`${city.id}: ${network.stations.length} stations, ${network.lines.length} lines, ${network.edges.length} links, ${network.edges.filter((edge) => edge[2] < 0).length} without a line`);
    if (report) for (const line of [...renamed, ...notes]) console.log(`    ${line}`);
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
