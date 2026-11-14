/*
 * Generates public/timetable/toei.json: the published timetables of the Toei
 * lines (都営地下鉄 浅草線・三田線・新宿線・大江戸線, 都電荒川線, 日暮里・舎人ライナー)
 * in a form small enough to ship with the site.
 *
 *   node --experimental-strip-types scripts/generate-toei-timetable.ts <folder>
 *   (or TOEI_ODPT_DIR=<folder> node --experimental-strip-types scripts/generate-toei-timetable.ts)
 *
 * <folder> holds three files from the ODPT public API (no registration):
 *   toei-station-timetable.json  https://api-public.odpt.org/api/v4/odpt:StationTimetable.json?odpt:operator=odpt.Operator:Toei
 *   toei-Station.json            https://api-public.odpt.org/api/v4/odpt:Station.json?odpt:operator=odpt.Operator:Toei
 *   toei-Railway.json            https://api-public.odpt.org/api/v4/odpt:Railway.json?odpt:operator=odpt.Operator:Toei
 * Licence: CC BY 4.0 (ckan.odpt.org datasets r_station_timetable-toei,
 * r_station-toei, r_route-toei). The provider asks for the credit kept in the
 * output file, and the page shows it wherever a time from it is shown.
 *
 * A station timetable lists only the departures from one station. The same
 * train id across all of a line's stations gives each train's run: the
 * stations it stops at, in order, with the minute it leaves each. From that a
 * page can tell whether a train that leaves A also stops at B later (an
 * express may pass B, a short working may end before it), and when it leaves
 * B, which is when it is there. A station where a train ends has no departure
 * for it, so its arrival there is not known and is never made up: such a stop
 * is written with -1 in place of its minutes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const folder = process.argv[2] ?? process.env.TOEI_ODPT_DIR;
if (!folder) {
  console.error("usage: generate-toei-timetable.ts <folder with the three ODPT files>");
  process.exit(1);
}
const read = (name: string) => JSON.parse(readFileSync(`${folder.replace(/\/$/, "")}/${name}`, "utf8"));

type Title = { ja?: string; en?: string };
type OdptStation = { "owl:sameAs": string; "odpt:railway": string; "odpt:stationTitle"?: Title; "dc:title"?: string; "geo:lat"?: number; "geo:long"?: number };
type OdptRailway = { "owl:sameAs": string; "odpt:railwayTitle"?: Title; "dc:title"?: string; "odpt:stationOrder": Array<{ "odpt:station": string }> };
type OdptDeparture = { "odpt:train": string; "odpt:trainType"?: string; "odpt:departureTime": string; "odpt:destinationStation"?: string[] };
type OdptStationTimetable = { "odpt:railway": string; "odpt:station": string; "odpt:calendar": string; "dct:issued"?: string; "dc:date"?: string; "odpt:stationTimetableObject": OdptDeparture[] };

const timetables = read("toei-station-timetable.json") as OdptStationTimetable[];
const stations = read("toei-Station.json") as OdptStation[];
const railways = read("toei-Railway.json") as OdptRailway[];
const stationById = new Map(stations.map((station) => [station["owl:sameAs"], station]));

// The kinds of train the Toei lines carry. A local is the default and is not
// named on the page; anything else is, since it passes stations.
const TRAIN_TYPES: Record<string, [string, string]> = {
  Express: ["急行", "Express"],
  LimitedExpress: ["特急", "Limited Express"],
  RapidLimitedExpress: ["快特", "Rapid Limited Express"],
  Rapid: ["快速", "Rapid"],
  AirportRapidLimitedExpress: ["エアポート快特", "Airport Rapid Limited Express"],
  AccessExpress: ["アクセス特急", "Access Express"],
  CommuterLimitedExpress: ["通勤特急", "Commuter Limited Express"],
};

// Trains that run through onto other companies' lines end at stations the
// Toei station data does not list. Their names as signed; a destination that
// appears later and is missing here falls back to the name in its ODPT id.
const OFF_NETWORK: Record<string, [string, string]> = {
  "Keio.KeioNew.Sasazuka": ["笹塚", "Sasazuka"],
  "Keio.Sagamihara.Hashimoto": ["橋本", "Hashimoto"],
  "Keio.Sagamihara.KeioTamaCenter": ["京王多摩センター", "Keio-tama-center"],
  "Keio.Sagamihara.Wakabadai": ["若葉台", "Wakabadai"],
  "Tokyu.Meguro.Hiyoshi": ["日吉", "Hiyoshi"],
  "Tokyu.Meguro.MusashiKosugi": ["武蔵小杉", "Musashi-kosugi"],
  "Tokyu.TokyuShinYokohama.ShinYokohama": ["新横浜", "Shin-yokohama"],
  "Sotetsu.Main.Ebina": ["海老名", "Ebina"],
  "Sotetsu.Main.Yamato": ["大和", "Yamato"],
  "Sotetsu.Izumino.Shonandai": ["湘南台", "Shonandai"],
  "Sotetsu.SotetsuShinYokohama.Nishiya": ["西谷", "Nishiya"],
  "Keikyu.Airport.HanedaAirportTerminal1and2": ["羽田空港第1・第2ターミナル", "Haneda Airport Terminal 1·2"],
  "Keikyu.Kurihama.Misakiguchi": ["三崎口", "Misakiguchi"],
  "Keikyu.Kurihama.KeikyuKurihama": ["京急久里浜", "Keikyu-kurihama"],
  "Keikyu.Kurihama.Miurakaigan": ["三浦海岸", "Miurakaigan"],
  "Keikyu.Main.Shinagawa": ["品川", "Shinagawa"],
  "Keikyu.Main.KanazawaBunko": ["金沢文庫", "Kanazawa-bunko"],
  "Keikyu.Main.KanagawaShimmachi": ["神奈川新町", "Kanagawa-shimmachi"],
  "Keikyu.Zushi.ZushiHayama": ["逗子・葉山", "Zushi·Hayama"],
  "Keisei.Oshiage.Aoto": ["青砥", "Aoto"],
  "Keisei.Main.KeiseiTakasago": ["京成高砂", "Keisei-takasago"],
  "Keisei.Main.NaritaAirportTerminal1": ["成田空港", "Narita Airport"],
  "Keisei.NaritaSkyAccess.NaritaAirportTerminal1": ["成田空港", "Narita Airport"],
  "Keisei.Main.KeiseiNarita": ["京成成田", "Keisei-narita"],
  "Keisei.Main.KeiseiSakura": ["京成佐倉", "Keisei-sakura"],
  "Keisei.Main.Sogosando": ["宗吾参道", "Sogosando"],
  "Hokuso.Hokuso.ImbaNihonIdai": ["印旛日本医大", "Imba-nihon-idai"],
  "Hokuso.Hokuso.InzaiMakinohara": ["印西牧の原", "Inzai-makinohara"],
  "Shibayama.Shibayama.ShibayamaChiyoda": ["芝山千代田", "Shibayama-chiyoda"],
};

/*
 * Where a train that runs on to another company leaves the Toei line. The
 * Toei station timetables stop listing such a train one station early (the
 * departure from the junction is in the other company's timetable), yet every
 * one of them calls at the junction. It is added to the run as a stop whose
 * time is not published (-1 in the output), so a ride to 泉岳寺 or 押上 can
 * still be matched to it, without a made-up arrival time.
 */
const HANDOVER: Record<string, string> = {
  Keikyu: "odpt.Station:Toei.Asakusa.Sengakuji",
  Keisei: "odpt.Station:Toei.Asakusa.Oshiage",
  Hokuso: "odpt.Station:Toei.Asakusa.Oshiage",
  Shibayama: "odpt.Station:Toei.Asakusa.Oshiage",
  Tokyu: "odpt.Station:Toei.Mita.Meguro",
  Sotetsu: "odpt.Station:Toei.Mita.Meguro",
  Keio: "odpt.Station:Toei.Shinjuku.Shinjuku",
};

/** "HanedaAirportTerminal1and2" → "Haneda Airport Terminal 1 and 2". */
function wordsOf(id: string) {
  return id.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([a-zA-Z])/g, "$1 $2");
}

const destinations: Array<[string, string]> = [];
const destinationIndex = new Map<string, number>();
function destinationOf(id: string): number {
  const known = destinationIndex.get(id);
  if (known !== undefined) return known;
  const station = stationById.get(id);
  const tail = id.replace(/^odpt\.Station:/, "");
  const english = station?.["odpt:stationTitle"]?.en ?? OFF_NETWORK[tail]?.[1] ?? wordsOf(tail.split(".").at(-1) ?? tail);
  // With no Japanese name on record the English one stands in: a guessed
  // reading in kanji would be a name nobody signed.
  const japanese = station?.["odpt:stationTitle"]?.ja ?? station?.["dc:title"] ?? OFF_NETWORK[tail]?.[0] ?? english;
  if (!station && !OFF_NETWORK[tail]) console.warn(`destination without a Japanese name: ${id}`);
  destinations.push([japanese, english]);
  destinationIndex.set(id, destinations.length - 1);
  return destinations.length - 1;
}

const typeNames: Array<[string, string]> = [["", ""]];
const typeIndex = new Map<string, number>();
function typeOf(id: string | undefined): number {
  const name = (id ?? "").split(".").at(-1) ?? "";
  if (!name || name === "Local") return 0;
  const known = typeIndex.get(name);
  if (known !== undefined) return known;
  typeNames.push(TRAIN_TYPES[name] ?? [wordsOf(name), wordsOf(name)]);
  typeIndex.set(name, typeNames.length - 1);
  return typeNames.length - 1;
}

/**
 * Minutes after midnight of the service day. Trains after midnight belong to
 * the day before, so a clock time before 03:00 counts on past 24:00.
 */
function serviceMinutes(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  const minutes = hour * 60 + minute;
  return minutes < 180 ? minutes + 1_440 : minutes;
}

/** The newest timetable revision of a line: each line is revised on its own day. */
function issuedOf(railwayId: string) {
  return timetables.filter((entry) => entry["odpt:railway"] === railwayId)
    .map((entry) => entry["dct:issued"] ?? entry["dc:date"]?.slice(0, 10) ?? "").filter(Boolean).sort().at(-1) ?? "";
}

type Stop = { station: number; minute: number; order: number };
const output = [];
for (const railway of railways) {
  const railwayId = railway["owl:sameAs"];
  const order = railway["odpt:stationOrder"].map((entry) => entry["odpt:station"]);
  // The Ōedo line passes 都庁前 twice (it is where the loop and the branch
  // meet); the station itself is listed once.
  const ids = [...new Set(order)];
  for (const entry of timetables) if (entry["odpt:railway"] === railwayId && !ids.includes(entry["odpt:station"])) ids.push(entry["odpt:station"]);
  const list = ids.map((id) => {
    const station = stationById.get(id);
    if (!station) throw new Error(`no station data for ${id}`);
    const title = station["odpt:stationTitle"] ?? {};
    return [title.ja ?? station["dc:title"] ?? "", title.en ?? wordsOf(id.split(".").at(-1)!), station["geo:lat"] ?? 0, station["geo:long"] ?? 0] as const;
  });
  const position = new Map(ids.map((id, index) => [id, index]));

  const runs = new Map<string, { calendar: string; destination: string[]; type?: string; stops: Stop[] }>();
  for (const entry of timetables) {
    if (entry["odpt:railway"] !== railwayId) continue;
    const calendar = entry["odpt:calendar"].replace(/^odpt\.Calendar:/, "");
    const station = position.get(entry["odpt:station"])!;
    for (const departure of entry["odpt:stationTimetableObject"]) {
      const key = `${calendar}|${departure["odpt:train"]}`;
      const run = runs.get(key) ?? { calendar, destination: [], type: departure["odpt:trainType"], stops: [] };
      if (run.destination.length === 0 && departure["odpt:destinationStation"]?.length) run.destination = departure["odpt:destinationStation"];
      run.stops.push({ station, minute: serviceMinutes(departure["odpt:departureTime"]), order: order.indexOf(entry["odpt:station"]) });
      runs.set(key, run);
    }
  }

  const patterns: number[][] = [];
  const patternIndex = new Map<string, number>();
  const calendars: Record<string, number[][]> = {};
  let split = 0;
  for (const run of runs.values()) {
    // Two stops in the same minute (a short tram hop) are put in the order of
    // the line; which way the train goes is settled by its other stops.
    const byTime = [...run.stops].sort((a, b) => a.minute - b.minute);
    const forward = byTime.length < 2 || byTime.at(-1)!.order >= byTime[0].order;
    run.stops.sort((a, b) => a.minute - b.minute || (forward ? a.order - b.order : b.order - a.order));
    // A train number used twice in a day would look like one run with a long
    // gap; such a run is cut there rather than joined into a journey nobody makes.
    const pieces: Stop[][] = [[]];
    const operator = /^odpt\.Station:([^.]+)\./.exec(run.destination[0] ?? "")?.[1] ?? "Toei";
    const junction = operator !== "Toei" ? HANDOVER[operator] : undefined;
    for (const stop of run.stops) {
      const last = pieces.at(-1)!.at(-1);
      if (last && stop.minute - last.minute > 60) {
        pieces.push([]);
        split += 1;
      }
      pieces.at(-1)!.push(stop);
    }
    const last = pieces.at(-1)!;
    const junctionAt = junction !== undefined ? position.get(junction) : undefined;
    if (junction !== undefined && junctionAt !== undefined && !last.some((stop) => stop.station === junctionAt)) {
      const junctionOrder = order.indexOf(junction);
      const end = last.at(-1)!.order;
      // Only where the junction lies ahead of the train's last listed stop.
      const ahead = last.length < 2 ? junctionOrder !== end : forward ? junctionOrder > end : junctionOrder < end;
      if (ahead) last.push({ station: junctionAt, minute: Number.NaN, order: junctionOrder });
      else console.warn(`${run.destination[0]}: junction behind the last stop`);
    }
    for (const stops of pieces) {
      const key = stops.map((stop) => stop.station).join(",");
      let pattern = patternIndex.get(key);
      if (pattern === undefined) {
        patterns.push(stops.map((stop) => stop.station));
        pattern = patterns.length - 1;
        patternIndex.set(key, pattern);
      }
      const destination = run.destination.length > 0 ? destinationOf(run.destination[0]) : -1;
      // [pattern, destination, train type, first departure, then the minutes to each next stop]
      const row = [pattern, destination, typeOf(run.type), stops[0].minute, ...stops.slice(1).map((stop, index) => (Number.isNaN(stop.minute) ? -1 : stop.minute - stops[index].minute))];
      (calendars[run.calendar] ??= []).push(row);
    }
  }
  for (const rows of Object.values(calendars)) rows.sort((a, b) => a[3] - b[3]);
  if (split > 0) console.warn(`${railwayId}: ${split} runs cut at a gap of over an hour`);
  const title = railway["odpt:railwayTitle"] ?? {};
  output.push({
    id: railwayId.replace(/^odpt\.Railway:Toei\./, ""),
    ja: title.ja ?? railway["dc:title"] ?? "",
    en: title.en ?? "",
    issued: issuedOf(railwayId),
    stations: list,
    patterns,
    calendars,
  });
}

const file = {
  source: "ODPT StationTimetable / Station / Railway, operator odpt.Operator:Toei",
  licence: "CC BY 4.0",
  credit: {
    ja: "東京都交通局・公共交通オープンデータ協議会",
    en: "Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation",
  },
  types: typeNames,
  destinations,
  railways: output,
};
mkdirSync(new URL("../public/timetable/", import.meta.url), { recursive: true });
const target = new URL("../public/timetable/toei.json", import.meta.url);
writeFileSync(target, JSON.stringify(file));
console.log(`wrote ${target.pathname}: ${output.length} railways, ${Math.round(JSON.stringify(file).length / 1024)} KB`);
