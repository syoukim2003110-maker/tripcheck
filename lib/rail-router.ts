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
  /** [stationIndex, stationIndex, lineIndex or -1 when the line is unknown] */
  edges: ReadonlyArray<readonly [number, number, number]>;
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

/*
 * Wikidata keeps one item per operator at a shared station and names it
 * "東京メトロ渋谷駅" or "東急電鉄・東京メトロ渋谷駅". A traveller looks for
 * 「渋谷駅」 on the signs. Only company names are removed — never a prefix that
 * is part of a real station name (京成上野, 近鉄奈良, 西武新宿).
 */
const operatorNames = [
  "JR東日本", "JR西日本", "JR東海", "JR九州", "JR北海道", "JR四国", "東京メトロ", "東京地下鉄", "都営地下鉄", "東京都交通局",
  "東急電鉄", "京王電鉄", "小田急電鉄", "西武鉄道", "東武鉄道", "京成電鉄", "京浜急行電鉄", "相模鉄道", "首都圏新都市鉄道",
  "大阪メトロ", "Osaka Metro", "大阪市高速電気軌道", "京都市営地下鉄", "京都市交通局", "名古屋市営地下鉄", "名古屋市交通局",
  "福岡市地下鉄", "札幌市営地下鉄", "仙台市地下鉄", "神戸市営地下鉄", "横浜市営地下鉄", "阪急電鉄", "阪神電気鉄道",
  "近畿日本鉄道", "南海電気鉄道", "京阪電気鉄道", "名古屋鉄道", "西日本鉄道", "東京モノレール", "東京臨海高速鉄道",
];
const operatorPrefix = new RegExp(`^(?:(?:${operatorNames.join("|")})[・･、]?)+(?=.+駅$)`);

export function plainStationName(name: string) {
  const plain = name.replace(operatorPrefix, "").replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
  return plain.length >= 2 ? plain : name;
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

type Link = { to: number; line: number; minutes: number };

export class RailNetwork {
  readonly id: string;
  private readonly data: RailNetworkData;
  private readonly points: GeoPoint[];
  private readonly links: Link[][];
  /** Stations close enough to change between on foot. */
  private readonly interchanges: Array<Array<{ to: number; minutes: number }>>;

  constructor(data: RailNetworkData) {
    this.id = data.id;
    this.data = data;
    this.points = data.stations.map(([, , latitude, longitude]) => ({ latitude, longitude }));
    this.links = data.stations.map(() => []);
    for (const [from, to, line] of data.edges) {
      if (!this.points[from] || !this.points[to]) continue;
      const distance = meters(this.points[from], this.points[to]);
      // Neighbouring stations are never 40 km apart; such a link is an
      // intercity "next station" that would teleport a city journey.
      if (distance > 25_000) continue;
      const minutes = distance / 1_000 * RIDE_MINUTES_PER_KM + DWELL_MINUTES;
      this.links[from].push({ to, line, minutes });
      this.links[to].push({ to: from, line, minutes });
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
  advise(from: GeoPoint, to: GeoPoint, language: "ja" | "en" = "ja"):
    | { kind: "rail"; journey: RailJourney }
    | { kind: "walk"; minutes: number }
    | { kind: "none" } {
    const journey = this.route(from, to, language);
    if (journey) return { kind: "rail", journey };
    const direct = walkMinutes(from, to);
    return direct <= 30 ? { kind: "walk", minutes: direct } : { kind: "none" };
  }

  get stationCount() {
    return this.points.length;
  }

  private stationName(index: number, language: "ja" | "en") {
    const [ja, en] = this.data.stations[index];
    return language === "ja" ? plainStationName(ja) : en;
  }

  private lineName(index: number, language: "ja" | "en") {
    if (index < 0) return null;
    const line = this.data.lines[index];
    return line ? (language === "ja" ? line[0] : line[1]) : null;
  }

  private nearestStations(point: GeoPoint) {
    return this.points
      .map((station, index) => ({ index, distance: meters(point, station) }))
      .filter((entry) => entry.distance <= MAX_ACCESS_METERS && this.links[entry.index].length > 0)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, ACCESS_CANDIDATES);
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

    // State: (station, line being ridden). Line -2 means "on foot, not yet
    // aboard" — boarding from it costs the first wait, not a transfer.
    // Line -3 means "walked over from a neighbouring station": boarding from
    // it is a change of train. Line -1 is a real train whose line is unknown.
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
      for (const link of this.links[current.station]) {
        const sameTrain = current.line === link.line && link.line >= -1;
        const boarding = current.line === ON_FOOT ? FIRST_WAIT_MINUTES : sameTrain ? 0 : TRANSFER_MINUTES;
        push(current.cost + boarding + link.minutes, link.to, link.line, current);
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
      if (last && last.line === hop.line && last.stations.at(-1) === from.station) last.stations.push(hop.station);
      else ridesRaw.push({ line: hop.line, stations: [from.station, hop.station] });
    }
    if (ridesRaw.length === 0) return null;

    const rides = ridesRaw.map((ride): RailRide => {
      let minutes = 0;
      for (let index = 1; index < ride.stations.length; index += 1) {
        minutes += meters(this.points[ride.stations[index - 1]], this.points[ride.stations[index]]) / 1_000 * RIDE_MINUTES_PER_KM + DWELL_MINUTES;
      }
      return {
        line: this.lineName(ride.line, language),
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
