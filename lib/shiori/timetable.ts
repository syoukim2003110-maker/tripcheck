/*
 * The published departures for a Toei ride (都営地下鉄 浅草線・三田線・新宿線・
 * 大江戸線, 都電荒川線, 日暮里・舎人ライナー) on a dated day of the trip.
 *
 * The rail router draws the ride from a map of the network and estimates its
 * minutes; this module looks the same ride up in the operator's own station
 * timetables (public/timetable/toei.json, made by
 * scripts/generate-toei-timetable.ts from ODPT data, CC BY 4.0) and gives the
 * next trains that really stop at both ends. It never changes the plan: the
 * plan's times stay estimates, and these trains are shown beside them.
 *
 * Anything uncertain gives no answer rather than a wrong one: a line or a
 * station that cannot be matched for sure, a date whose kind of day is not
 * known (outside the bundled holiday list, or 30 December), a ride whose
 * direction the timetable cannot confirm.
 */

export type TimetableName = readonly [string, string];

export type ToeiRailway = {
  id: string;
  ja: string;
  en: string;
  /** Newest revision date of this line's timetables, YYYY-MM-DD. */
  issued: string;
  /** [nameJa, nameEn, latitude, longitude] */
  stations: ReadonlyArray<readonly [string, string, number, number]>;
  /** Station index sequences that trains stop at. */
  patterns: ReadonlyArray<ReadonlyArray<number>>;
  /**
   * Per calendar: [pattern, destination, type, first departure, minutes to
   * each next stop…]; -1 for a stop whose time is not published (the
   * junction where a train runs on to another company).
   */
  calendars: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number>>>>;
};

export type ToeiTimetableData = {
  licence: string;
  credit: { ja: string; en: string };
  /** Index 0 is the local train, which is not named. */
  types: ReadonlyArray<TimetableName>;
  destinations: ReadonlyArray<TimetableName>;
  railways: ReadonlyArray<ToeiRailway>;
};

type Point = { latitude: number; longitude: number };
export type TimetableRide = { line: string | null; from: string; to: string; minutes: number; path: ReadonlyArray<Point> };

export type TimetableTrain = {
  /** Minutes after midnight of the service day (past 1440 after midnight). */
  depart: number;
  /** When it is at the alighting station; null where the train ends there (the timetable lists departures only). */
  arrive: number | null;
  destination: { ja: string; en: string };
  /** Null for a local train. */
  type: { ja: string; en: string } | null;
};

export type ServiceCalendar = "Weekday" | "Saturday" | "Holiday" | "SaturdayHoliday";

export type RideTimetable = {
  railway: string;
  calendar: ServiceCalendar;
  issued: string;
} & ({ kind: "trains"; trains: TimetableTrain[] } | { kind: "after-last" });

/**
 * The names the bundled networks and the timetable give each line, in both
 * languages. A name is only taken when it is one of these whole: "新宿線"
 * inside "西武新宿線" is another company's line.
 * Bare short names are left out: "三田線" is also Kobe Electric Railway's
 * line, and the timetable is only ever looked up for Tokyo plans.
 */
const LINE_NAMES: Record<string, readonly string[]> = {
  Oedo: ["都営地下鉄大江戸線", "都営大江戸線", "Toei Ōedo Line", "Toei Oedo Line", "Ōedo Line", "Oedo Line"],
  Asakusa: ["都営地下鉄浅草線", "都営浅草線", "Toei Asakusa Line", "Asakusa Line"],
  Mita: ["都営地下鉄三田線", "都営三田線", "Toei Mita Line", "Mita Line"],
  Shinjuku: ["都営地下鉄新宿線", "都営新宿線", "Toei Shinjuku Line", "Shinjuku Line"],
  Arakawa: ["都電荒川線", "東京さくらトラム", "東京さくらトラム（都電荒川線）", "Toden Arakawa Line", "Tokyo Sakura Tram", "Tokyo Sakura Tram (Arakawa Line)", "Arakawa Line"],
  NipporiToneri: ["日暮里・舎人ライナー", "Nippori-Toneri Liner", "Nippori Toneri Liner"],
};

/** The Toei railway a ride's line name means, or null. */
export function toeiRailwayId(line: string | null | undefined): string | null {
  if (!line) return null;
  const name = line.trim();
  for (const [id, names] of Object.entries(LINE_NAMES)) if (names.includes(name)) return id;
  return null;
}

/** "大門駅" and "大門", "市ヶ谷" and "市ケ谷", "Ichigaya Station" and "Ichigaya" are one station. */
export function normaliseStationName(name: string) {
  return name.normalize("NFKC").trim()
    .replace(/\s*Station$/i, "")
    .replace(/(駅|停留場|停留所|電停)$/, "")
    .replace(/[ヶヵ]/g, "ケ")
    .replace(/[\s　]/g, "")
    .replace(/[ōŌ]/g, (letter) => (letter === "ō" ? "o" : "O"))
    .toLowerCase();
}

function meters(a: Point, b: { 2: number; 3: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(b[2] - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b[2])) * Math.sin(radians(b[3] - a.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Within this distance the bundled map and the operator place the same platform. */
const NEAR_METERS = 300;
/**
 * For the stations a ride passes, which have no name in the ride, only a
 * point. The map's point for a station shared with another company can sit
 * on that company's platform (両国, 浅草: some 350 m from the Toei one), so the
 * nearest station of the line within this distance is taken.
 */
const PASSED_METERS = 600;
/** A same-named station further than this from where the map puts it is another place. */
const SAME_NAME_METERS = 1_000;

function nearestStation(railway: ToeiRailway, point: Point | undefined, within = NEAR_METERS) {
  if (!point) return null;
  let best: { index: number; distance: number } | null = null;
  railway.stations.forEach((station, index) => {
    const distance = meters(point, station);
    if (!best || distance < best.distance) best = { index, distance };
  });
  const found = best as { index: number; distance: number } | null;
  return found && found.distance <= within ? found.index : null;
}

/**
 * The station of this line a ride's end means: by name first (one match, and
 * not far from where the map has it), else the one station of the line
 * within a few hundred metres of that point.
 */
export function matchStation(railway: ToeiRailway, name: string, point: Point | undefined): number | null {
  const wanted = normaliseStationName(name);
  const named = railway.stations.flatMap((station, index) => (normaliseStationName(station[0]) === wanted || normaliseStationName(station[1]) === wanted ? [index] : []));
  if (named.length === 1) {
    if (!point || meters(point, railway.stations[named[0]]) <= SAME_NAME_METERS) return named[0];
    return null;
  }
  return nearestStation(railway, point);
}

/*
 * Japanese public holidays, from the Cabinet Office list
 * (https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv, read 2026-11-14),
 * substitute holidays (休日) included. Dates outside these years get no
 * timetable: which kind of day it is would be a guess.
 */
const HOLIDAY_YEARS = [2026, 2027];
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
  "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
]);

export type DayKind = "weekday" | "saturday" | "holiday";

/**
 * Which timetable a date runs on. 31 December to 3 January are taken as
 * holidays (Toei runs its weekend-and-holiday timetable over the New Year;
 * this is an assumption from the operator's usual notices, not from the
 * data). 30 December varies from year to year, so it gets no answer.
 */
export function dayKind(date: string): DayKind | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const when = new Date(Date.UTC(year, month - 1, day));
  if (when.getUTCMonth() !== month - 1 || when.getUTCDate() !== day) return null;
  if (!HOLIDAY_YEARS.includes(year)) return null;
  if (month === 12 && day === 30) return null;
  if ((month === 12 && day === 31) || (month === 1 && day <= 3)) return "holiday";
  if (HOLIDAYS.has(date) || when.getUTCDay() === 0) return "holiday";
  return when.getUTCDay() === 6 ? "saturday" : "weekday";
}

/** The calendar of this line for that kind of day: a line with one weekend timetable uses it for both. */
export function calendarFor(railway: ToeiRailway, kind: DayKind): ServiceCalendar | null {
  const has = (calendar: ServiceCalendar) => Array.isArray(railway.calendars[calendar]) && railway.calendars[calendar].length > 0;
  const choice: ServiceCalendar[] = kind === "weekday" ? ["Weekday"] : kind === "saturday" ? ["Saturday", "SaturdayHoliday"] : ["Holiday", "SaturdayHoliday"];
  return choice.find(has) ?? null;
}

/** "10:04" → minutes of the service day; a time before 03:00 belongs to the night before. */
export function serviceMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 180 ? minutes + 1_440 : minutes;
}

/** Service-day minutes back to a clock: 1450 → "00:10". */
export function clockOf(minutes: number) {
  const day = ((Math.round(minutes) % 1_440) + 1_440) % 1_440;
  return `${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`;
}

const MAX_TRAINS = 3;

/**
 * The next trains for one ride, leaving the boarding station at or after
 * `at` (service-day minutes) on `date`. Null when the ride is not a Toei ride
 * or cannot be matched for certain.
 */
export function rideTimetable(data: ToeiTimetableData, ride: TimetableRide, date: string, at: number): RideTimetable | null {
  const railwayId = toeiRailwayId(ride.line);
  const railway = railwayId ? data.railways.find((entry) => entry.id === railwayId) : undefined;
  if (!railway) return null;
  const kind = dayKind(date);
  const calendar = kind ? calendarFor(railway, kind) : null;
  if (!calendar) return null;
  const from = matchStation(railway, ride.from, ride.path[0]);
  const to = matchStation(railway, ride.to, ride.path.at(-1));
  if (from === null || to === null || from === to) return null;
  // The stations the ride passes, as the map draws it. A train is the right
  // one only if every stop it makes on the way is one of them: on the Ōedo
  // loop the other way round also reaches the station, an hour later.
  const passed = new Set<number>([from, to]);
  for (const point of ride.path) {
    const index = nearestStation(railway, point, PASSED_METERS);
    if (index === null) return null;
    passed.add(index);
  }
  const toName = railway.stations[to][0];

  const found: TimetableTrain[] = [];
  for (const row of railway.calendars[calendar]) {
    const pattern = railway.patterns[row[0]];
    if (!pattern) continue;
    const times: Array<number | null> = [row[3]];
    for (let index = 4; index < row.length; index += 1) {
      const before = times[index - 4];
      times.push(row[index] < 0 || before === null ? null : before + row[index]);
    }
    const destination = data.destinations[row[1]];
    for (let board = 0; board < pattern.length; board += 1) {
      const leaves = times[board];
      if (pattern[board] !== from || leaves === null) continue;
      let arrive: number | null | undefined;
      let fits = true;
      for (let next = board + 1; next < pattern.length; next += 1) {
        if (pattern[next] === to) {
          arrive = times[next];
          break;
        }
        if (!passed.has(pattern[next])) {
          fits = false;
          break;
        }
      }
      // A train whose last stop before the end of its run is on the ride and
      // that is bound for the alighting station ends there: it is the right
      // train, and when it gets in is not in a timetable of departures.
      if (fits && arrive === undefined && destination && destination[0] === toName) arrive = null;
      if (!fits || arrive === undefined) continue;
      const type = data.types[row[2]];
      found.push({
        depart: leaves,
        arrive,
        destination: { ja: destination?.[0] ?? "", en: destination?.[1] ?? "" },
        type: row[2] > 0 && type ? { ja: type[0], en: type[1] } : null,
      });
      break;
    }
  }
  // No train in the published timetable does this ride at all: the match is
  // not sure enough to say anything, least of all "no more trains".
  if (found.length === 0) return null;
  found.sort((a, b) => a.depart - b.depart);
  const next = found.filter((train) => train.depart >= at).slice(0, MAX_TRAINS);
  const base = { railway: railway.id, calendar, issued: railway.issued };
  return next.length > 0 ? { ...base, kind: "trains", trains: next } : { ...base, kind: "after-last" };
}

export type TimetableJourney = {
  walkToMinutes: number;
  /** Minutes on foot between rides, all changes together. */
  transferMinutes: number;
  rides: ReadonlyArray<TimetableRide>;
};

/**
 * The trains for each ride of a leg that sets off at `depart` ("HH:MM") on
 * `date`. The first ride is caught from the time the traveller reaches the
 * platform; a later one from when the train before it gets in, plus the walk
 * of the change. With several changes the walk is shared out evenly: the
 * total is all the map knows. Where a ride before has no timetable, or ends
 * at a terminus with no arrival time, the plan's own estimate stands in.
 */
export function legTimetables(data: ToeiTimetableData, journey: TimetableJourney, depart: string, date: string): Array<RideTimetable | null> {
  const start = serviceMinutes(depart);
  if (start === null) return journey.rides.map(() => null);
  const changes = journey.rides.length - 1;
  const changeWalk = changes > 0 ? Math.ceil(journey.transferMinutes / changes) : 0;
  let ready = start + journey.walkToMinutes;
  return journey.rides.map((ride, index) => {
    if (index > 0) ready += changeWalk;
    const answer = rideTimetable(data, ride, date, ready);
    const first = answer?.kind === "trains" ? answer.trains[0] : null;
    ready = first?.arrive != null ? first.arrive : (first ? first.depart : ready) + ride.minutes;
    return answer;
  });
}

/** Whether any ride of these legs is on a Toei line: only then is the timetable file asked for. */
export function hasToeiRide(rides: Iterable<{ line: string | null }>) {
  for (const ride of rides) if (toeiRailwayId(ride.line)) return true;
  return false;
}

/** A loaded file is used only if it has the shape this module reads. */
export function isToeiTimetableData(value: unknown): value is ToeiTimetableData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.railways) && Array.isArray(data.destinations) && Array.isArray(data.types)
    && !!data.credit && typeof data.credit === "object"
    && (data.railways as unknown[]).every((railway) => !!railway && typeof railway === "object"
      && Array.isArray((railway as ToeiRailway).stations) && Array.isArray((railway as ToeiRailway).patterns)
      && !!(railway as ToeiRailway).calendars && typeof (railway as ToeiRailway).calendars === "object");
}
