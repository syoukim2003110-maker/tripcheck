/*
 * "Board here, change there, get off here."
 *
 * A small journey planner over a bundled map of a city's rail network
 * (stations, lines, and which station is next to which — Wikidata, CC0).
 * It answers the question a traveller actually has about a train leg: which
 * station, which line, where to change, where to get off, roughly how long.
 *
 * It is a map, not a timetable. Ride times come from the distance between
 * stations at a typical urban-rail pace, plus a wait and a transfer
 * allowance; they are estimates and every caller must present them as such.
 * A departure time, a platform or a last train is never claimed.
 */

export type RailNetworkData = {
  id: string;
  /** [nameJa, nameEn, latitude, longitude] */
  stations: ReadonlyArray<readonly [string, string, number, number]>;
  /** [nameJa, nameEn] */
  lines: ReadonlyArray<readonly [string, string]>;
  /**
   * [stationIndex, stationIndex, lineIndex or -1 when the line is unknown],
   * and a fourth 1 where the line is a guest on another line's track
   * (武蔵野線 trains on the 京葉線 into 東京): a ride that either could name
   * is named after the line whose track it is.
   */
  edges: ReadonlyArray<readonly [number, number, number] | readonly [number, number, number, number]>;
  /**
   * Groups of line indexes whose trains run on into each other end to end
   * (京浜東北線 into 根岸線 at 横浜). Riding from one onto the next is one
   * ride; no change of train is charged or printed.
   */
  through?: ReadonlyArray<ReadonlyArray<number>>;
};

export type GeoPoint = { latitude: number; longitude: number };

export type RailRide = {
  /** Line name in the requested language; null when the data does not say. */
  line: string | null;
  from: string;
  to: string;
  /** Stations travelled, counting the one you get off at. */
  stops: number;
  minutes: number;
  /** Every station passed, for drawing the ride on the map. */
  path: GeoPoint[];
  /** Present (true) where the ride is a boat: a crossing no taxi and no walk can stand in for. */
  boat?: true;
};

export type RailJourney = {
  walkToMinutes: number;
  walkToStation: string;
  rides: RailRide[];
  /** Minutes on foot between stations when changing lines, already in total. */
  transferMinutes: number;
  walkFromMinutes: number;
  walkFromStation: string;
  totalMinutes: number;
  /** Changes of train. */
  transfers: number;
};

const WALK_METERS_PER_MINUTE = 75;
/** Streets are not straight lines. */
const WALK_DETOUR = 1.3;
const MAX_ACCESS_METERS = 1_600;
const ACCESS_CANDIDATES = 4;
const FIRST_WAIT_MINUTES = 4;
const TRANSFER_MINUTES = 6;
/** Different stations this close are one interchange (原宿 / 明治神宮前). */
const INTERCHANGE_METERS = 320;
/** ~32 km/h between stations, plus a dwell at each stop. */
const RIDE_MINUTES_PER_KM = 1.85;
const DWELL_MINUTES = 0.6;
/**
 * A train state for "still aboard, on a stretch whose line the data does not
 * name": the train's number plus this. Far above any line count.
 */
const UNNAMED_STRETCH = 2_048;

/**
 * A line that is a boat, by the name it carries in the bundled networks
 * (宮島航路, JR西日本宮島フェリー, 宮島松大汽船, スタテン島フェリー, 水上バス, "… ferry").
 * The networks keep a line's name and nothing about what runs on it; the
 * generator itself names a tramway of landing stages 「水上バス」. A test pins
 * the full list of bundled lines this matches, so a regenerated network
 * with a boat under another name does not pass unnoticed.
 */
export function isBoatLineName(ja: string, en: string) {
  return /フェリー|汽船|航路|水上バス|渡船|連絡船/.test(ja) || /\bferr(y|ies)\b|\bwater ?bus\b|\bvaporetto\b/i.test(en);
}

/*
 * Wikidata keeps one item per operator — sometimes per line — at a shared
 * station and names it "東京メトロ渋谷駅", "東急電鉄・東京メトロ渋谷駅" or
 * "東京メトロ有楽町線市ケ谷駅". A traveller looks for 「渋谷駅」 and 「市ケ谷駅」
 * on the signs. Only full company names and line names are removed — never a
 * short prefix that is part of a real station name (京成上野, 近鉄奈良,
 * 西武新宿, 地下鉄成増).
 */
const operatorNames = [
  "JR東日本", "JR西日本", "JR東海", "JR九州", "JR北海道", "JR四国", "東京メトロ", "東京地下鉄", "都営地下鉄", "東京都交通局", "都営",
  "東急電鉄", "京王電鉄", "小田急電鉄", "西武鉄道", "東武鉄道", "京成電鉄", "京浜急行電鉄", "相模鉄道", "首都圏新都市鉄道",
  "大阪メトロ", "Osaka Metro", "大阪市高速電気軌道", "京都市営地下鉄", "京都市交通局", "名古屋市営地下鉄", "名古屋市交通局",
  "福岡市地下鉄", "札幌市営地下鉄", "仙台市地下鉄", "神戸市営地下鉄", "横浜市営地下鉄", "阪急電鉄", "阪神電気鉄道",
  "近畿日本鉄道", "南海電気鉄道", "京阪電気鉄道", "京福電気鉄道", "名古屋鉄道", "西日本鉄道", "東京モノレール", "東京臨海高速鉄道",
  "横浜高速鉄道", "名古屋臨海高速鉄道", "神戸新交通", "広島高速交通",
  // Not companies, but the same kind of label: "新幹線名古屋駅" is 名古屋駅,
  // and the Keiō New Line platforms at Shinjuku ("新線新宿駅") are 新宿駅.
  "新幹線", "新線",
];
/*
 * The English labels carry the same baggage ("Tokyo Metro Ueno Station").
 * A full company name is never part of a station's name and always comes
 * off. A short brand can be — "JR Namba" and "Keikyū Kamata" are what the
 * signs say — so those come off only where the generator has seen the
 * Japanese label of the same station lose its company prefix.
 */
const englishCompanyNames = [
  "JR East", "JR West", "JR Central", "JR Kyushu", "JR Hokkaido", "JR Shikoku", "Tokyo Metro", "Toei Subway",
  "Tokyu Railways", "Tokyu Corporation", "Keio Corporation", "Odakyu Electric Railway", "Seibu Railway", "Tobu Railway",
  "Keisei Electric Railway", "Keikyu Corporation", "Sagami Railways", "Sagami Railway",
  "Osaka Metro", "Kyoto Municipal Subway", "Nagoya Municipal Subway", "Fukuoka City Subway", "Sapporo Municipal Subway",
  "Sendai Subway", "Kobe City Subway", "Kobe Municipal Subway", "Kobe New Transit", "Yokohama Municipal Subway", "Hankyu Corporation", "Hankyu Railway",
  "Hanshin Electric Railway", "Kintetsu Railway", "Nankai Electric Railway", "Keihan Electric Railway", "Keifuku Electric Railroad",
  "Nagoya Railroad", "Nishi-Nippon Railroad", "Tokyo Monorail", "Yokohama Minatomirai Railway",
];
const englishBrandNames = [
  "JR", "Toei", "Tokyu", "Keio", "Keiō", "Odakyu", "Seibu", "Tobu", "Keisei", "Keikyu", "Keikyū", "Hankyu", "Hanshin",
  "Kintetsu", "Nankai", "Keihan", "Meitetsu", "Shinkansen", "Hiroden",
];
/*
 * Wikidata's own disambiguated labels where the name on the platform sign is
 * plainer and no rule can tell (西武 is part of 西武新宿 but not of 練馬).
 * Each entry was checked against the operator's station list.
 */
const officialStationNames: Record<string, string> = {
  // Seibu Ikebukuro line and Toei Ōedo line: both call the station 練馬.
  "西武練馬駅": "練馬駅",
  // The Keiō New Line platforms: the station is Shinjuku in either language.
  "Shinsen-Shinjuku Station": "Shinjuku Station",
  // JR Kyūshū's item for 博多. "JR" is no general prefix (JR難波 is a real
  // name), so it is named here; the subway's item 18 m away is plain 博多駅.
  "JR博多駅": "博多駅",
  "JR Hakata Station": "Hakata Station",
  // A line name without 線 on the end, which the prefix rule does not catch.
  "つくばエクスプレス秋葉原駅": "秋葉原駅",
  "Tsukuba Express Akihabara Station": "Akihabara Station",
  "ゆりかもめ新橋駅": "新橋駅",
  "Yurikamome Shimbashi Station": "Shimbashi Station",
};

const longestFirst = (names: readonly string[]) => [...new Set(names.filter((name) => name.length >= 2))].sort((left, right) => right.length - left.length);
const japanesePrefixes = longestFirst(operatorNames);
const englishCompanyPrefixes = longestFirst(englishCompanyNames);
const englishBrandPrefixes = longestFirst([...englishCompanyNames, ...englishBrandNames]);
/** "Osaka-Umeda Station (Hanshin)": the bracket is the company again. */
const companyBrackets = new Set([...englishCompanyNames, ...englishBrandNames]);
/** A bracket that only says which railway the station belongs to. */
const transportBracket = /\b(tram|tramway|rer|m[eé]tro|subway|underground|railways?|rail|line|liner|station|mtr|lrt|mrt|bts|u-bahn|s-bahn|path|irt|ind|bmt)\b/i;

function tidy(name: string) {
  // U+2010 is a hyphen some labels use instead of "-"; one spelling is enough.
  // "ソウル駅駅" is the metro's item for Seoul Station: the word once is the name.
  // "Tram stop Rijksmuseum" is a description of the stop; the sign says "Rijksmuseum".
  return name.replace(/\u2010/g, "-").replace(/[\s\u3000]+/g, " ").replace(/駅駅$/, "駅").replace(/\b(station) station$/i, "$1")
    .replace(/^(?:Tram stop|Tramhalte|Metrostation)\s+(?=\S)/i, "")
    // 「原爆ドーム前停留場」 is the legal word for a tram stop; the stop's sign
    // and the tram's display say 「原爆ドーム前」.
    .replace(/^(.{2,})停留場$/, "$1").trim();
}

function withoutPrefixes(name: string, prefixes: readonly string[], ending: RegExp) {
  if (!ending.test(name)) return name;
  let rest = name;
  // "東急電鉄・東京メトロ・都営地下鉄目黒駅": several owners, one after another.
  for (let round = 0; round < 6; round += 1) {
    // A Latin prefix must end at a word break: "Toei" is not the start of "Toeizan".
    const hit = prefixes.find((prefix) => rest.startsWith(prefix) && rest.length - prefix.length >= 2 && (!/[A-Za-z]$/.test(prefix) || /^[\s,]/.test(rest.slice(prefix.length))));
    if (!hit) break;
    const next = rest.slice(hit.length).replace(/^[・･、,\s]+(?:and\s+)?/, "");
    // What is left must still be a station name of its own.
    if (next.length < 2 || next === "駅" || /^station$/i.test(next)) break;
    rest = next;
  }
  return rest;
}

/**
 * The name a traveller reads on the sign. `knownPrefixes` are further company
 * and line names of this network (the generator passes the ones Wikidata
 * lists); without them the built-in company list is used.
 */
export function plainStationName(name: string, knownPrefixes: readonly string[] = []) {
  let plain = tidy(name);
  // "代々木駅 (都営地下鉄)" is an encyclopedia's way to tell two articles
  // apart. A bracket inside the name — 西鉄福岡（天神）駅 — is official, and a
  // bracket after a foreign name is dropped only when it names the railway
  // ("Laplace (Paris RER)"), not when it is the stop's own suburb.
  const bracket = plain.match(/^(.*?)\s*[(（]([^)）]*)[)）]$/);
  if (bracket && bracket[1].length >= 2 && (/(駅|停留場|停留所|電停)$/.test(bracket[1]) || transportBracket.test(bracket[2]) || companyBrackets.has(bracket[2].trim()))) plain = bracket[1].trim();
  plain = officialStationNames[plain] ?? plain;
  const prefixes = knownPrefixes.length > 0 ? longestFirst([...japanesePrefixes, ...knownPrefixes]) : japanesePrefixes;
  plain = withoutPrefixes(plain, prefixes, /.駅$/);
  plain = withoutPrefixes(plain, englishCompanyPrefixes, /\sStation$/i);
  plain = officialStationNames[plain] ?? plain;
  return plain.length >= 2 ? plain : name;
}

/**
 * For the English label of a station whose Japanese label carried a company
 * or line prefix: the short brands and this network's line names come off
 * too ("Keiō Line Shinjuku Station" → "Shinjuku Station").
 */
export function plainEnglishStationName(name: string, knownPrefixes: readonly string[] = []) {
  const prefixes = knownPrefixes.length > 0 ? longestFirst([...englishBrandPrefixes, ...knownPrefixes]) : englishBrandPrefixes;
  const plain = withoutPrefixes(plainStationName(name), prefixes, /\sStation$/i);
  return officialStationNames[plain] ?? plain;
}

function meters(from: GeoPoint, to: GeoPoint) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(to.latitude - from.latitude) / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function walkMinutes(from: GeoPoint, to: GeoPoint) {
  return Math.max(1, Math.round(meters(from, to) * WALK_DETOUR / WALK_METERS_PER_MINUTE));
}

/** `train` is the line, or the lowest line of its through-running group; -1 when unknown. */
type Link = { to: number; line: number; train: number; minutes: number };

export type RailAdvice =
  | { kind: "rail"; journey: RailJourney }
  | { kind: "walk"; minutes: number }
  | { kind: "none" };

export class RailNetwork {
  private readonly advice = new Map<string, RailAdvice>();
  readonly id: string;
  private readonly data: RailNetworkData;
  private readonly points: GeoPoint[];
  private readonly links: Link[][];
  /** Stations close enough to change between on foot. */
  private readonly interchanges: Array<Array<{ to: number; minutes: number }>>;
  /** For each line, the train it is part of (itself, or its through-running group). */
  private readonly trainOf: number[];
  /** How many links each line has, and each train (a line and the lines it runs through to). */
  private readonly linkCount: number[];
  private readonly trainLinkCount: Map<number, number>;
  /** The named lines between two neighbouring stations. */
  private readonly linesBetween = new Map<number, number[]>();
  /** "pair:line" where the line runs as a guest on another line's track. */
  private readonly guestOn = new Set<string>();
  /** For each line, whether it is a boat (see isBoatLineName). */
  private readonly boatLine: boolean[];

  constructor(data: RailNetworkData) {
    this.id = data.id;
    this.data = data;
    this.points = data.stations.map(([, , latitude, longitude]) => ({ latitude, longitude }));
    this.links = data.stations.map(() => []);
    this.trainOf = data.lines.map((_, index) => index);
    for (const group of data.through ?? []) {
      const members = group.filter((line) => Number.isInteger(line) && line >= 0 && line < data.lines.length);
      for (const line of members) this.trainOf[line] = Math.min(...members);
    }
    this.boatLine = data.lines.map(([ja, en]) => isBoatLineName(ja, en));
    this.linkCount = data.lines.map(() => 0);
    this.trainLinkCount = new Map();
    for (const [from, to, line, guest] of data.edges) {
      if (!this.points[from] || !this.points[to]) continue;
      const distance = meters(this.points[from], this.points[to]);
      // Neighbouring stations are never 40 km apart; such a link is an
      // intercity "next station" that would teleport a city journey.
      if (distance > 25_000) continue;
      const minutes = distance / 1_000 * RIDE_MINUTES_PER_KM + DWELL_MINUTES;
      const named = line >= 0 && line < data.lines.length;
      const train = named ? this.trainOf[line] : -1;
      this.links[from].push({ to, line: named ? line : -1, train, minutes });
      this.links[to].push({ to: from, line: named ? line : -1, train, minutes });
      if (!named) continue;
      this.linkCount[line] += 1;
      this.trainLinkCount.set(train, (this.trainLinkCount.get(train) ?? 0) + 1);
      const pair = this.pairKey(from, to);
      const known = this.linesBetween.get(pair) ?? [];
      if (!known.includes(line)) known.push(line);
      this.linesBetween.set(pair, known);
      if (guest === 1) this.guestOn.add(`${pair}:${line}`);
    }
    this.interchanges = this.points.map(() => []);
    // A coarse grid keeps this from being quadratic on an 800-station city.
    const cell = (point: GeoPoint) => `${Math.floor(point.latitude * 200)},${Math.floor(point.longitude * 200)}`;
    const grid = new Map<string, number[]>();
    this.points.forEach((point, index) => {
      const key = cell(point);
      grid.set(key, [...(grid.get(key) ?? []), index]);
    });
    this.points.forEach((point, index) => {
      const latitudeCell = Math.floor(point.latitude * 200);
      const longitudeCell = Math.floor(point.longitude * 200);
      for (let latitudeOffset = -1; latitudeOffset <= 1; latitudeOffset += 1) {
        for (let longitudeOffset = -1; longitudeOffset <= 1; longitudeOffset += 1) {
          for (const other of grid.get(`${latitudeCell + latitudeOffset},${longitudeCell + longitudeOffset}`) ?? []) {
            if (other === index) continue;
            const distance = meters(point, this.points[other]);
            if (distance <= INTERCHANGE_METERS) {
              this.interchanges[index].push({ to: other, minutes: distance * WALK_DETOUR / WALK_METERS_PER_MINUTE });
            }
          }
        }
      }
    });
  }

  /**
   * What to tell a traveller about getting from one point to another:
   * a train journey, "just walk" (it is close, and the train saves nothing),
   * or nothing — this network has no opinion.
   */
  advise(from: GeoPoint, to: GeoPoint, language: "ja" | "en" = "ja"): RailAdvice {
    // The same pair is asked about on every re-plan; the network does not change.
    const key = `${language}|${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}|${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
    const known = this.advice.get(key);
    if (known) return known;
    const journey = this.route(from, to, language);
    const direct = journey ? 0 : walkMinutes(from, to);
    const advice: RailAdvice = journey ? { kind: "rail", journey } : direct <= 30 ? { kind: "walk", minutes: direct } : { kind: "none" };
    if (this.advice.size > 4000) this.advice.clear();
    this.advice.set(key, advice);
    return advice;
  }

  get stationCount() {
    return this.points.length;
  }

  private stationName(index: number, language: "ja" | "en") {
    const [ja, en] = this.data.stations[index];
    // The bundled names are already plain; this is the safety net for a
    // network built before that, or loaded from somewhere else. A station
    // with a name in only one language is shown in that one.
    return language === "ja" ? plainStationName(ja || en) : plainStationName(en || ja);
  }

  private pairKey(from: number, to: number) {
    return from < to ? from * 65_536 + to : to * 65_536 + from;
  }

  /**
   * Of several lines that could name a ride, the one a traveller is most
   * likely to see on the platform: the line whose own track it is rather
   * than a guest on it, then the busiest train (its links, with the lines
   * it runs through to), then the longer line, then the name. Never the
   * order the lines happen to have in the file.
   */
  private preferred(lines: readonly number[], pairs: readonly number[]) {
    const name = (line: number) => this.data.lines[line]?.[0] ?? "";
    const asGuest = (line: number) => pairs.filter((pair) => this.guestOn.has(`${pair}:${line}`)).length;
    return [...lines].sort((left, right) =>
      asGuest(left) - asGuest(right)
      || (this.trainLinkCount.get(this.trainOf[right]) ?? 0) - (this.trainLinkCount.get(this.trainOf[left]) ?? 0)
      || this.linkCount[right] - this.linkCount[left]
      || (name(left) < name(right) ? -1 : name(left) > name(right) ? 1 : 0)
      || left - right)[0];
  }

  /**
   * What to call a ride along these stations aboard this train. One line
   * that covers every link, if there is one — the same answer whichever of
   * several parallel services the search happened to take. Otherwise the
   * ride runs through from one line onto the next (琵琶湖線・JR京都線), and the
   * names are given in the order travelled. Links with no line of their own
   * are part of whatever the train is.
   */
  private rideName(stations: readonly number[], train: number, language: "ja" | "en") {
    const hops: Array<{ pair: number; lines: number[] }> = [];
    for (let index = 1; index < stations.length; index += 1) {
      const pair = this.pairKey(stations[index - 1], stations[index]);
      const lines = this.linesBetween.get(pair) ?? [];
      if (lines.length > 0) hops.push({ pair, lines });
    }
    if (hops.length === 0) return null;
    const whole = hops[0].lines.filter((line) => hops.every((hop) => hop.lines.includes(line)));
    if (whole.length > 0) return this.lineName(this.preferred(whole, hops.map((hop) => hop.pair)), language);
    const names: string[] = [];
    for (let index = 0; index < hops.length;) {
      const aboard = hops[index].lines.filter((line) => this.trainOf[line] === train);
      const candidates = aboard.length > 0 ? aboard : hops[index].lines;
      const reach = (line: number) => {
        let end = index;
        while (end < hops.length && hops[end].lines.includes(line)) end += 1;
        return end;
      };
      const farthest = Math.max(...candidates.map(reach));
      const line = this.preferred(candidates.filter((candidate) => reach(candidate) === farthest), hops.slice(index, farthest).map((hop) => hop.pair));
      const name = this.lineName(line, language);
      if (name && names.at(-1) !== name) names.push(name);
      index = farthest;
    }
    return names.length > 0 ? names.join(language === "ja" ? "・" : " / ") : null;
  }

  private lineName(index: number, language: "ja" | "en") {
    if (index < 0) return null;
    const line = this.data.lines[index];
    if (!line) return null;
    // An empty name means the data has the line but no name for it. Saying
    // so (null) lets the page write "train" instead of a blank.
    const name = (language === "ja" ? line[0] || line[1] : line[1] || line[0]).trim();
    return name || null;
  }

  private nearestStations(point: GeoPoint) {
    const reachable = this.points
      .map((station, index) => ({ index, distance: meters(point, station) }))
      .filter((entry) => entry.distance <= MAX_ACCESS_METERS && this.links[entry.index].length > 0)
      .sort((left, right) => left.distance - right.distance);
    // The four nearest, plus any farther station (up to eight in all) that
    // offers a line none of the kept ones has. Beside the Hong Kong botanical
    // gardens the four nearest are all Peak Tram stops; the MTR that crosses
    // the harbour is the fifth.
    // A link is new only if no line that runs on it can already be boarded
    // at a kept station. In Hiroshima each tram stop along the main street
    // carried one more name for the same track, and the eight places were
    // full before the JR station was reached.
    const kept = reachable.slice(0, ACCESS_CANDIDATES);
    const lines = new Set(kept.flatMap((entry) => this.links[entry.index].map((link) => link.line)));
    for (const entry of reachable.slice(ACCESS_CANDIDATES)) {
      if (kept.length >= ACCESS_CANDIDATES * 2) break;
      const fresh = this.links[entry.index].some((link) => link.line < 0
        || !(this.linesBetween.get(this.pairKey(entry.index, link.to)) ?? [link.line]).some((line) => lines.has(line)));
      if (!fresh) continue;
      kept.push(entry);
      for (const link of this.links[entry.index]) lines.add(link.line);
    }
    return kept;
  }

  /**
   * The quickest rail journey between two points, or null when rail is not a
   * sensible answer: no station near one end, no connection in the data, or
   * a journey that is mostly walking to and from the trains.
   */
  route(from: GeoPoint, to: GeoPoint, language: "ja" | "en" = "ja"): RailJourney | null {
    const origins = this.nearestStations(from);
    const destinations = this.nearestStations(to);
    if (origins.length === 0 || destinations.length === 0) return null;
    const exitWalk = new Map(destinations.map((entry) => [entry.index, entry.distance * WALK_DETOUR / WALK_METERS_PER_MINUTE]));

    // State: (station, train being ridden). A train is a line, or the lines
    // that run through into each other. -2 means "on foot, not yet aboard" —
    // boarding from it costs the first wait, not a transfer. -3 means "walked
    // over from a neighbouring station": boarding from it is a change of
    // train. -1 is a real train whose line is unknown.
    //
    // A link with no line in the data is not a change of train by itself: a
    // traveller aboard train T who rides one stays aboard (state T +
    // UNNAMED_STRETCH), and one who boards on such a link is aboard whatever
    // named train the track leads into. Changing to a different named train
    // after it is still a change.
    const ON_FOOT = -2;
    const WALKED_OVER = -3;
    const key = (station: number, line: number) => station * 4_096 + (line + 3);
    const best = new Map<number, number>();
    const previous = new Map<number, { state: number; station: number; line: number }>();
    const queue: Array<{ cost: number; station: number; line: number }> = [];
    const push = (cost: number, station: number, line: number, via: { station: number; line: number } | null) => {
      const state = key(station, line);
      if ((best.get(state) ?? Infinity) <= cost) return;
      best.set(state, cost);
      if (via) previous.set(state, { state: key(via.station, via.line), station: via.station, line: via.line });
      else previous.delete(state);
      queue.push({ cost, station, line });
    };
    for (const origin of origins) push(origin.distance * WALK_DETOUR / WALK_METERS_PER_MINUTE, origin.index, ON_FOOT, null);

    let goal: { cost: number; station: number; line: number } | null = null;
    while (queue.length > 0) {
      // The graph is a few thousand states; a linear scan for the minimum is
      // simpler than a heap and fast enough.
      let smallest = 0;
      for (let index = 1; index < queue.length; index += 1) if (queue[index].cost < queue[smallest].cost) smallest = index;
      const current = queue.splice(smallest, 1)[0];
      if (current.cost > (best.get(key(current.station, current.line)) ?? Infinity)) continue;
      const exit = exitWalk.get(current.station);
      if (exit !== undefined && current.line !== ON_FOOT && current.line !== WALKED_OVER) {
        const total = current.cost + exit;
        if (!goal || total < goal.cost) goal = { cost: total, station: current.station, line: current.line };
      }
      if (goal && current.cost >= goal.cost) break;
      const aboard = current.line >= UNNAMED_STRETCH ? current.line - UNNAMED_STRETCH : current.line;
      for (const link of this.links[current.station]) {
        const riding = current.line >= -1;
        // The same train, a nameless stretch of it, or the named train a nameless start leads into.
        const sameTrain = riding && (link.train === aboard || link.train === -1 || current.line === -1);
        const boarding = current.line === ON_FOOT ? FIRST_WAIT_MINUTES : sameTrain ? 0 : TRANSFER_MINUTES;
        const state = link.train === -1 && riding && aboard >= 0 ? aboard + UNNAMED_STRETCH : link.train;
        push(current.cost + boarding + link.minutes, link.to, state, current);
      }
      // Walk to a neighbouring station to change there. Arriving on foot.
      for (const interchange of this.interchanges[current.station]) {
        if (current.line === ON_FOOT) continue;
        push(current.cost + interchange.minutes, interchange.to, WALKED_OVER, current);
      }
    }
    if (!goal) return null;

    // Walk the chain back into (station, line) hops.
    const hops: Array<{ station: number; line: number }> = [];
    let cursor: { station: number; line: number } | undefined = { station: goal.station, line: goal.line };
    let guard = 0;
    while (cursor && guard < 5_000) {
      hops.unshift(cursor);
      const step = previous.get(key(cursor.station, cursor.line));
      cursor = step ? { station: step.station, line: step.line } : undefined;
      guard += 1;
    }
    const ridesRaw: Array<{ line: number; stations: number[] }> = [];
    const trainOfState = (line: number) => (line >= UNNAMED_STRETCH ? line - UNNAMED_STRETCH : line);
    let transferMinutes = 0;
    for (let index = 1; index < hops.length; index += 1) {
      const from = hops[index - 1];
      const hop = hops[index];
      if (hop.line === WALKED_OVER) {
        // An on-foot interchange between two nearby stations.
        transferMinutes += meters(this.points[from.station], this.points[hop.station]) * WALK_DETOUR / WALK_METERS_PER_MINUTE;
        continue;
      }
      if (hop.line === ON_FOOT) continue;
      const last = ridesRaw.at(-1);
      const train = trainOfState(hop.line);
      // A ride that began on a nameless stretch takes the name of the train it turns out to be.
      if (last && last.stations.at(-1) === from.station && (last.line === train || last.line === -1)) {
        last.stations.push(hop.station);
        last.line = train;
      } else ridesRaw.push({ line: train, stations: [from.station, hop.station] });
    }
    if (ridesRaw.length === 0) return null;

    const rides = ridesRaw.map((ride): RailRide => {
      let minutes = 0;
      for (let index = 1; index < ride.stations.length; index += 1) {
        minutes += meters(this.points[ride.stations[index - 1]], this.points[ride.stations[index]]) / 1_000 * RIDE_MINUTES_PER_KM + DWELL_MINUTES;
      }
      // A boat: every stretch of the ride is served by boats and nothing else.
      const boat = ride.stations.every((station, index) => {
        if (index === 0) return true;
        const lines = this.linesBetween.get(this.pairKey(ride.stations[index - 1], station)) ?? [];
        return lines.length > 0 && lines.every((line) => this.boatLine[line]);
      });
      return {
        ...(boat ? { boat: true as const } : {}),
        line: this.rideName(ride.stations, ride.line, language),
        from: this.stationName(ride.stations[0], language),
        to: this.stationName(ride.stations.at(-1)!, language),
        stops: ride.stations.length - 1,
        minutes: Math.max(1, Math.round(minutes)),
        path: ride.stations.map((station) => this.points[station]),
      };
    });
    const firstStation = ridesRaw[0].stations[0];
    const lastStation = ridesRaw.at(-1)!.stations.at(-1)!;
    const walkToMinutes = Math.max(1, Math.round(meters(from, this.points[firstStation]) * WALK_DETOUR / WALK_METERS_PER_MINUTE));
    const walkFromMinutes = Math.max(1, Math.round(meters(this.points[lastStation], to) * WALK_DETOUR / WALK_METERS_PER_MINUTE));
    const totalMinutes = Math.max(1, Math.round(goal.cost));
    const direct = walkMinutes(from, to);
    // Rail that saves nothing over walking, or that is mostly walking to
    // and from the stations, is not a train leg.
    if (direct <= totalMinutes + 3 || direct <= 12) return null;
    return {
      walkToMinutes,
      walkToStation: this.stationName(firstStation, language),
      rides,
      transferMinutes: Math.round(transferMinutes),
      walkFromMinutes,
      walkFromStation: this.stationName(lastStation, language),
      totalMinutes,
      transfers: rides.length - 1,
    };
  }
}
