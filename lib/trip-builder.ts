import type { Locale } from "./i18n.ts";
import type { Pace } from "./trip-analysis.ts";
import {
  buildGoogleMapsUrl,
  optimizeKnownStopOrder,
  resolveKnownStops,
  straightLineDistanceKm,
  type RouteStop,
} from "./route-optimizer.ts";
import { applyLiveTransitMinutes, estimateTravelOptions, type ModeComparison, type TransportMode } from "./time-feasibility.ts";

export type BuiltPlanStop = {
  stop: RouteStop;
  arrival: string;
  departure: string;
  kind: "place" | "meal";
  mealKind: MealKind | null;
  priority: StopPriority;
  fixedTime: string | null;
  reservationLateMinutes: number;
  crowd: CrowdOutlook | null;
};

export type BuiltPlanLeg = {
  from: RouteStop;
  to: RouteStop;
  comparison: ModeComparison;
  googleMapsUrls: Record<TransportMode, string>;
  isLocalMealPause: boolean;
};

export type BuiltPlanDay = {
  label: string;
  date: string | null;
  theme: string;
  stops: BuiltPlanStop[];
  legs: BuiltPlanLeg[];
  totalMinutes: number;
  startTime: string;
  requestedStartTime: string;
  startAdjustedByArrival: boolean;
  finishTime: string;
  hotelTravelMinutes: number | null;
  deadline: string | null;
  deadlineOverrunMinutes: number;
  reservationConflictCount: number;
  googleMapsUrl: string | null;
};

export type StopPriority = "must" | "normal" | "optional";
export type MealPlan = "all" | "dinner" | "none";
export type MealKind = "lunch" | "dinner";
export type CrowdLevel = "quiet" | "moderate" | "busy" | "veryBusy";

export type CrowdOutlook = {
  level: CrowdLevel;
  confidence: "low" | "medium";
  isWeekend: boolean;
  weekendUplift: 0 | 1;
  peakTime: boolean;
};

export type WishlistStopConstraint = {
  priority: StopPriority;
  fixedDay: number | null;
  fixedTime: string | null;
  fixedTimeMinutes: number | null;
  isReservation: boolean;
};

export type AirportCode = "none" | "HND" | "NRT";
export type FlightKind = "international" | "domestic";

export type TripPlannerContext = {
  tripStartDate?: string;
  hotelQuery?: string;
  arrivalAirport?: AirportCode;
  arrivalTime?: string;
  departureAirport?: AirportCode;
  departureTime?: string;
  flightKind?: FlightKind;
  dayStartTimes?: Record<number, string>;
  durationOverrides?: Record<string, number>;
  liveTransitMinutes?: Record<string, number>;
  mealPlan?: MealPlan;
};

export type TripBase = RouteStop & { query: string };

export type BaseRecommendation = {
  base: TripBase;
  routeDistanceKm: number;
};

export type AirportConstraint = {
  direction: "arrival" | "departure";
  airport: Exclude<AirportCode, "none">;
  flightTime: string;
  cityTime: string;
  cityTimeDayOffset: -1 | 0 | 1;
  airportMinutes: number;
  transferMinutes: number;
  sourceUrl: string;
  googleMapsUrl: string | null;
};

export type BuiltTripPlan = {
  requestedDays: number;
  recognizedStopCount: number;
  scheduledStopCount: number;
  mealBreakCount: number;
  unknownEntries: string[];
  deferredOptionalStops: RouteStop[];
  constraintCount: number;
  overCapacityCount: number;
  scheduleConflictCount: number;
  selectedBase: TripBase | null;
  hotelQuery: string;
  hotelResolved: boolean;
  baseRecommendations: BaseRecommendation[];
  airportConstraints: AirportConstraint[];
  days: BuiltPlanDay[];
};

const headingPattern = /^(?:day\s*\d+|\d+\s*日目|\d+\s*일차|第?\s*\d+\s*天)(?:\s*[-–—:].*)?$/i;
const mustPattern = /\bmust(?:-do)?\b|\bnon[- ]?negotiable\b|必須|絶対|필수|꼭|必去|必须/i;
const optionalPattern = /\boptional\b|\bif\s+(?:there(?:'s| is)\s+)?time\b|任意|時間があれば|선택|시간(?:이|\s)?되면|可选|有时间/i;
const reservationPattern = /\bbooked\b|\breserved\b|\breservation\b|\btimed ticket\b|予約|確定|예약|예매|预约|预订/i;
const foodVenuePattern = /\b(?:restaurant|cafe|café|lunch|dinner|sushi|ramen|izakaya|bar)\b|レストラン|食堂|寿司|すし|鮨|ラーメン|居酒屋|カフェ|ランチ|ディナー|昼食|夕食|식당|레스토랑|카페|점심|저녁|스시|라멘|餐厅|餐館|咖啡|午餐|晚餐|寿司|拉面/i;

const airportData = {
  HND: {
    latitude: 35.5494,
    longitude: 139.7798,
    transferMinutes: 60,
    internationalDepartureMinutes: 180,
    sourceUrl: "https://www.tokyo-haneda.com/en/flight/detail/int_departure.html",
  },
  NRT: {
    latitude: 35.772,
    longitude: 140.3929,
    transferMinutes: 105,
    internationalDepartureMinutes: 120,
    sourceUrl: "https://www.narita-airport.jp/en/airportguide/inter-dep/",
  },
} as const;

const baseDefinitions: Array<{
  id: string;
  lookup: string;
  aliases: RegExp[];
  names: Record<Locale, string>;
}> = [
  { id: "base-shinjuku", lookup: "Shinjuku", aliases: [/shinjuku|新宿|신주쿠/i], names: { en: "Shinjuku area", ja: "新宿エリア", ko: "신주쿠 지역", zh: "新宿区域" } },
  { id: "base-shibuya", lookup: "Shibuya", aliases: [/shibuya|渋谷|시부야|涩谷/i], names: { en: "Shibuya area", ja: "渋谷エリア", ko: "시부야 지역", zh: "涩谷区域" } },
  { id: "base-tokyo-station", lookup: "Tokyo Station", aliases: [/tokyo\s*station|東京駅|도쿄역|东京站/i], names: { en: "Tokyo Station area", ja: "東京駅エリア", ko: "도쿄역 지역", zh: "东京站区域" } },
  { id: "base-ueno", lookup: "Ueno Park", aliases: [/ueno|上野|우에노/i], names: { en: "Ueno area", ja: "上野エリア", ko: "우에노 지역", zh: "上野区域" } },
  { id: "base-asakusa", lookup: "Asakusa", aliases: [/asakusa|浅草|아사쿠사/i], names: { en: "Asakusa area", ja: "浅草エリア", ko: "아사쿠사 지역", zh: "浅草区域" } },
];

function dayLabel(day: number, locale: Locale) {
  if (locale === "ja") return `${day}日目`;
  if (locale === "ko") return `${day}일차`;
  if (locale === "zh") return `第${day}天`;
  return `Day ${day}`;
}

function openDayLabel(locale: Locale) {
  if (locale === "ja") return "自由に使える日";
  if (locale === "ko") return "비어 있는 날";
  if (locale === "zh") return "自由安排日";
  return "Open day";
}

function cleanEntry(line: string) {
  return line
    .replace(/^[-•*]\s*/, "")
    .replace(/^\d{1,2}(?::|\.)\d{2}\s*(?:[-–—:]\s*)?/, "")
    .trim();
}

function parseWishlistConstraint(line: string): WishlistStopConstraint {
  const isReservation = reservationPattern.test(line) || /@\s*(?:[01]?\d|2[0-3]):[0-5]\d/.test(line);
  const fixedDayMatch = line.match(/\bday\s*(\d{1,2})\b/i)
    ?? line.match(/(\d{1,2})\s*日目/)
    ?? line.match(/(\d{1,2})\s*일차/)
    ?? line.match(/第?\s*(\d{1,2})\s*天/);
  const timeMatch = line.match(/(?:@\s*|\b)((?:[01]?\d|2[0-3]):([0-5]\d))\b/);
  const fixedTime = isReservation && timeMatch ? timeMatch[1].padStart(5, "0") : null;
  const priority: StopPriority = mustPattern.test(line) || isReservation
    ? "must"
    : optionalPattern.test(line) ? "optional" : "normal";

  return {
    priority,
    fixedDay: fixedDayMatch ? Number(fixedDayMatch[1]) : null,
    fixedTime,
    fixedTimeMinutes: fixedTime ? clockMinutes(fixedTime) : null,
    isReservation,
  };
}

function mergeConstraints(current: WishlistStopConstraint | undefined, next: WishlistStopConstraint): WishlistStopConstraint {
  if (!current) return next;
  const rank: Record<StopPriority, number> = { optional: 0, normal: 1, must: 2 };
  return {
    priority: rank[next.priority] > rank[current.priority] ? next.priority : current.priority,
    fixedDay: next.fixedDay ?? current.fixedDay,
    fixedTime: next.fixedTime ?? current.fixedTime,
    fixedTimeMinutes: next.fixedTimeMinutes ?? current.fixedTimeMinutes,
    isReservation: current.isReservation || next.isReservation,
  };
}

function clock(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function clockMinutes(value?: string) {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function routeLegKey(fromId: string, toId: string) {
  return `${fromId}::${toId}`;
}

function addDaysToIsoDate(value: string | undefined, days: number) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isMealStop(stop: RouteStop) {
  return stop.id.startsWith("meal-");
}

function mealKindForStop(stop: RouteStop): MealKind | null {
  if (stop.id.includes("-lunch")) return "lunch";
  if (stop.id.includes("-dinner")) return "dinner";
  return null;
}

function makeMealStop(kind: MealKind, anchor: RouteStop, dayIndex: number, locale: Locale): RouteStop {
  const label = kind === "lunch"
    ? { en: "Lunch", ja: "昼食", ko: "점심", zh: "午餐" }[locale]
    : { en: "Dinner", ja: "夕食", ko: "저녁", zh: "晚餐" }[locale];
  const connector = { en: "in", ja: "・", ko: " · ", zh: " · " }[locale];
  return {
    id: `meal-${dayIndex + 1}-${kind}`,
    name: locale === "en" ? `${label} ${connector} ${anchor.area}` : `${anchor.area}${connector}${label}`,
    area: anchor.area,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    sourceUrl: "https://www.gotokyo.org/en/see-and-do/drinking-and-dining/",
    verifiedAt: "2026-07-19",
    confidence: "medium",
    planningDurationMinutes: kind === "lunch" ? 60 : 75,
    isAnchor: false,
  };
}

function sequenceTiming(
  ordered: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  liveTransitMinutes?: Record<string, number>,
) {
  let cursor = startMinutes;
  let lateMinutes = 0;
  const arrivals = new Map<string, number>();
  if (base && ordered[0]) cursor += routeTravelMinutes(base, ordered[0], liveTransitMinutes);
  ordered.forEach((stop, index) => {
    const fixed = constraints.get(stop.id)?.fixedTimeMinutes;
    if (fixed !== null && fixed !== undefined) {
      lateMinutes += Math.max(0, cursor - fixed);
      cursor = Math.max(cursor, fixed);
    }
    arrivals.set(stop.id, cursor);
    cursor += stop.planningDurationMinutes;
    if (ordered[index + 1]) cursor += routeTravelMinutes(stop, ordered[index + 1], liveTransitMinutes);
  });
  return { arrivals, finishMinutes: cursor, lateMinutes };
}

function insertMealBreaks(
  places: RouteStop[],
  dayIndex: number,
  locale: Locale,
  mealPlan: MealPlan,
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  liveTransitMinutes?: Record<string, number>,
) {
  if (mealPlan === "none" || places.length === 0) return places;
  let sequence = [...places];
  const requestedMeals: Array<{ kind: MealKind; target: number }> = mealPlan === "all"
    ? [{ kind: "lunch", target: 12 * 60 + 15 }, { kind: "dinner", target: 18 * 60 + 30 }]
    : [{ kind: "dinner", target: 18 * 60 + 30 }];

  for (const requested of requestedMeals) {
    const currentTiming = sequenceTiming(sequence, base, startMinutes, constraints, liveTransitMinutes);
    const shouldAdd = requested.kind === "lunch"
      ? startMinutes <= 14 * 60 && currentTiming.finishMinutes >= 11 * 60 + 15
      : startMinutes <= 20 * 60 && currentTiming.finishMinutes >= 17 * 60 + 15;
    if (!shouldAdd) continue;

    let bestSequence = sequence;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let position = 1; position <= sequence.length; position += 1) {
      const anchor = sequence[position - 1];
      const meal = makeMealStop(requested.kind, anchor, dayIndex, locale);
      const candidate = [...sequence.slice(0, position), meal, ...sequence.slice(position)];
      const timing = sequenceTiming(candidate, base, startMinutes, constraints, liveTransitMinutes);
      const mealArrival = timing.arrivals.get(meal.id) ?? timing.finishMinutes;
      const targetDistance = Math.abs(mealArrival - requested.target);
      const score = timing.lateMinutes * 100_000 + targetDistance * 100 + timing.finishMinutes;
      if (score < bestScore) {
        bestScore = score;
        bestSequence = candidate;
      }
    }
    sequence = bestSequence;
  }
  return sequence;
}

function buildCrowdOutlook(date: string | null, arrival: string, stop: RouteStop): CrowdOutlook | null {
  if (!date) return null;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) return null;
  const day = parsedDate.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const arrivalMinutes = clockMinutes(arrival) ?? 0;
  const mealKind = mealKindForStop(stop);
  const peakTime = mealKind === "lunch"
    ? arrivalMinutes >= 11 * 60 + 30 && arrivalMinutes <= 13 * 60 + 30
    : mealKind === "dinner"
      ? arrivalMinutes >= 18 * 60 && arrivalMinutes <= 20 * 60
      : arrivalMinutes >= 11 * 60 && arrivalMinutes <= 16 * 60;
  let score = mealKind ? 1 : stop.isAnchor ? 2 : 1;
  if (peakTime) score += 1;
  if (isWeekend) score += 1;
  const levels: CrowdLevel[] = ["quiet", "moderate", "busy", "veryBusy"];
  return {
    level: levels[Math.min(levels.length - 1, score)],
    confidence: mealKind || stop.confidence === "low" ? "low" : "medium",
    isWeekend,
    weekendUplift: isWeekend ? 1 : 0,
    peakTime,
  };
}

function routeDistanceFromBase(stops: RouteStop[], base: RouteStop) {
  if (stops.length === 0) return 0;
  return straightLineDistanceKm(base, stops[0])
    + stops.slice(1).reduce((sum, stop, index) => sum + straightLineDistanceKm(stops[index], stop), 0)
    + straightLineDistanceKm(stops.at(-1)!, base);
}

function optimizeFromBase(stops: RouteStop[], base: RouteStop) {
  if (stops.length <= 1) return [...stops];
  if (stops.length > 10) {
    const ordered = optimizeKnownStopOrder([base, ...stops], true).slice(1);
    return routeDistanceFromBase(ordered, base) <= routeDistanceFromBase([...ordered].reverse(), base) ? ordered : ordered.reverse();
  }

  const count = stops.length;
  const fullMask = (1 << count) - 1;
  const distances = Array.from({ length: 1 << count }, () => Array<number>(count).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: 1 << count }, () => Array<number>(count).fill(-1));
  for (let index = 0; index < count; index += 1) distances[1 << index][index] = straightLineDistanceKm(base, stops[index]);

  for (let mask = 1; mask <= fullMask; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      if ((mask & (1 << last)) === 0 || !Number.isFinite(distances[mask][last])) continue;
      for (let next = 0; next < count; next += 1) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const candidate = distances[mask][last] + straightLineDistanceKm(stops[last], stops[next]);
        if (candidate < distances[nextMask][next]) {
          distances[nextMask][next] = candidate;
          previous[nextMask][next] = last;
        }
      }
    }
  }

  let last = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const candidate = distances[fullMask][index] + straightLineDistanceKm(stops[index], base);
    if (candidate < best) {
      best = candidate;
      last = index;
    }
  }

  const order: number[] = [];
  let mask = fullMask;
  while (last >= 0) {
    order.push(last);
    const parent = previous[mask][last];
    mask ^= 1 << last;
    last = parent;
  }
  return order.reverse().map((index) => stops[index]);
}

function buildBase(definition: (typeof baseDefinitions)[number], locale: Locale, query: string): TripBase {
  const source = resolveKnownStops(definition.lookup, locale)[0];
  return {
    ...source,
    id: definition.id,
    name: definition.names[locale],
    planningDurationMinutes: 0,
    isAnchor: false,
    query,
  };
}

function resolveTripBase(query: string, locale: Locale) {
  const normalized = query.trim();
  if (!normalized) return null;
  const match = baseDefinitions.find((definition) => definition.aliases.some((alias) => alias.test(normalized)));
  return match ? buildBase(match, locale, normalized) : null;
}

function stableEntryId(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function resolveUserFoodReservation(
  entry: string,
  constraint: WishlistStopConstraint,
  locale: Locale,
): RouteStop | null {
  if (!constraint.isReservation || !foodVenuePattern.test(entry)) return null;
  const areaDefinition = baseDefinitions.find((definition) => definition.aliases.some((alias) => alias.test(entry)));
  if (!areaDefinition) return null;
  const area = buildBase(areaDefinition, locale, entry);
  const name = entry.split(/\s+[—–-]\s+/)[0].trim();
  return {
    ...area,
    id: `user-food-${stableEntryId(name.toLocaleLowerCase())}`,
    name,
    sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
    verifiedAt: "user-entered",
    confidence: "low",
    planningDurationMinutes: 75,
    isAnchor: true,
    isUserEntered: true,
  };
}

function recommendBases(stops: RouteStop[], clusters: RouteStop[][], locale: Locale) {
  if (stops.length === 0) return [];
  return baseDefinitions
    .map((definition) => {
      const base = buildBase(definition, locale, "");
      const routeDistanceKm = clusters.reduce((sum, cluster) => sum + routeDistanceFromBase(optimizeFromBase(cluster, base), base), 0);
      return { base, routeDistanceKm };
    })
    .sort((a, b) => a.routeDistanceKm - b.routeDistanceKm)
    .slice(0, 3);
}

function airportStop(code: Exclude<AirportCode, "none">, locale: Locale): RouteStop {
  const airport = airportData[code];
  const name = code === "HND"
    ? { en: "Haneda Airport", ja: "羽田空港", ko: "하네다 공항", zh: "羽田机场" }[locale]
    : { en: "Narita Airport", ja: "成田空港", ko: "나리타 공항", zh: "成田机场" }[locale];
  return {
    id: `airport-${code.toLowerCase()}`,
    name,
    area: code,
    latitude: airport.latitude,
    longitude: airport.longitude,
    sourceUrl: airport.sourceUrl,
    verifiedAt: "2026-07-18",
    confidence: "medium",
    planningDurationMinutes: 0,
    isAnchor: true,
  };
}

function buildAirportConstraints(context: TripPlannerContext, base: TripBase | null, locale: Locale) {
  const constraints: AirportConstraint[] = [];
  const flightKind = context.flightKind ?? "international";
  const arrivalAirport = context.arrivalAirport && context.arrivalAirport !== "none" ? context.arrivalAirport : null;
  const arrivalTime = clockMinutes(context.arrivalTime);
  if (arrivalAirport && arrivalTime !== null) {
    const data = airportData[arrivalAirport];
    const airportMinutes = flightKind === "international" ? 90 : 45;
    const cityMinutes = arrivalTime + airportMinutes + data.transferMinutes;
    const airport = airportStop(arrivalAirport, locale);
    constraints.push({
      direction: "arrival",
      airport: arrivalAirport,
      flightTime: clock(arrivalTime),
      cityTime: clock(cityMinutes),
      cityTimeDayOffset: cityMinutes >= 1440 ? 1 : 0,
      airportMinutes,
      transferMinutes: data.transferMinutes,
      sourceUrl: data.sourceUrl,
      googleMapsUrl: base ? buildGoogleMapsUrl([airport, base], "transit") : null,
    });
  }

  const departureAirport = context.departureAirport && context.departureAirport !== "none" ? context.departureAirport : null;
  const departureTime = clockMinutes(context.departureTime);
  if (departureAirport && departureTime !== null) {
    const data = airportData[departureAirport];
    const airportMinutes = flightKind === "international" ? data.internationalDepartureMinutes : 90;
    const cityMinutes = departureTime - airportMinutes - data.transferMinutes;
    const airport = airportStop(departureAirport, locale);
    constraints.push({
      direction: "departure",
      airport: departureAirport,
      flightTime: clock(departureTime),
      cityTime: clock(cityMinutes),
      cityTimeDayOffset: cityMinutes < 0 ? -1 : 0,
      airportMinutes,
      transferMinutes: data.transferMinutes,
      sourceUrl: data.sourceUrl,
      googleMapsUrl: base ? buildGoogleMapsUrl([base, airport], "transit") : null,
    });
  }
  return constraints;
}

function clusterStops(stops: RouteStop[], requestedDays: number) {
  const dayCount = Math.max(1, requestedDays);
  const activeDayCount = Math.min(dayCount, stops.length);
  if (activeDayCount === 1) return [[...stops], ...Array.from({ length: dayCount - 1 }, () => [] as RouteStop[])];

  const seeds: RouteStop[] = [stops.reduce((west, stop) => stop.longitude < west.longitude ? stop : west)];
  while (seeds.length < activeDayCount) {
    const remaining = stops.filter((stop) => !seeds.some((seed) => seed.id === stop.id));
    const next = remaining.reduce((best, stop) => {
      const distance = Math.min(...seeds.map((seed) => straightLineDistanceKm(seed, stop)));
      const bestDistance = Math.min(...seeds.map((seed) => straightLineDistanceKm(seed, best)));
      return distance > bestDistance ? stop : best;
    });
    seeds.push(next);
  }

  const capacity = Math.ceil(stops.length / activeDayCount);
  const clusters = seeds.map((seed) => [seed]);
  const remaining = stops.filter((stop) => !seeds.some((seed) => seed.id === stop.id));
  remaining.sort((a, b) => {
    const aDistance = Math.min(...seeds.map((seed) => straightLineDistanceKm(seed, a)));
    const bDistance = Math.min(...seeds.map((seed) => straightLineDistanceKm(seed, b)));
    return bDistance - aDistance;
  });

  for (const stop of remaining) {
    const eligible = clusters.map((cluster, index) => ({ cluster, index })).filter(({ cluster }) => cluster.length < capacity);
    const destination = eligible.reduce((best, candidate) => {
      const average = candidate.cluster.reduce((sum, member) => sum + straightLineDistanceKm(member, stop), 0) / candidate.cluster.length;
      const bestAverage = best.cluster.reduce((sum, member) => sum + straightLineDistanceKm(member, stop), 0) / best.cluster.length;
      return average < bestAverage ? candidate : best;
    });
    clusters[destination.index].push(stop);
  }
  return [...clusters, ...Array.from({ length: dayCount - activeDayCount }, () => [] as RouteStop[])];
}

const defaultConstraint: WishlistStopConstraint = {
  priority: "normal",
  fixedDay: null,
  fixedTime: null,
  fixedTimeMinutes: null,
  isReservation: false,
};

function applyFixedDays(
  clusters: RouteStop[][],
  constraints: Map<string, WishlistStopConstraint>,
) {
  const assigned = clusters.map((cluster) => [...cluster]);
  for (const [stopId, constraint] of constraints) {
    if (constraint.fixedDay === null || constraint.fixedDay < 1 || constraint.fixedDay > assigned.length) continue;
    let stop: RouteStop | undefined;
    for (const cluster of assigned) {
      const index = cluster.findIndex((candidate) => candidate.id === stopId);
      if (index >= 0) [stop] = cluster.splice(index, 1);
    }
    if (stop) assigned[constraint.fixedDay - 1].push(stop);
  }
  return assigned;
}

function routeComparison(from: RouteStop, to: RouteStop, liveTransitMinutes?: Record<string, number>) {
  return applyLiveTransitMinutes(
    estimateTravelOptions(from, to),
    liveTransitMinutes?.[routeLegKey(from.id, to.id)],
  );
}

function routeTravelMinutes(from: RouteStop, to: RouteStop, liveTransitMinutes?: Record<string, number>) {
  return routeComparison(from, to, liveTransitMinutes).recommended.minutes + 10;
}

function scheduleOrderScore(
  ordered: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  liveTransitMinutes?: Record<string, number>,
) {
  let cursor = startMinutes;
  let lateMinutes = 0;
  let travelMinutes = 0;
  if (base && ordered[0]) {
    const travel = routeTravelMinutes(base, ordered[0], liveTransitMinutes);
    travelMinutes += travel;
    cursor += travel;
  }
  ordered.forEach((stop, index) => {
    const fixed = constraints.get(stop.id)?.fixedTimeMinutes;
    if (fixed !== null && fixed !== undefined) {
      lateMinutes += Math.max(0, cursor - fixed);
      cursor = Math.max(cursor, fixed);
    }
    cursor += stop.planningDurationMinutes;
    if (ordered[index + 1]) {
      const travel = routeTravelMinutes(stop, ordered[index + 1], liveTransitMinutes);
      travelMinutes += travel;
      cursor += travel;
    }
  });
  if (base && ordered.at(-1)) {
    const travel = estimateTravelOptions(ordered.at(-1)!, base).recommended.minutes;
    travelMinutes += travel;
    cursor += travel;
  }
  return lateMinutes * 100_000 + cursor - startMinutes + travelMinutes;
}

function orderForReservations(
  stops: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  liveTransitMinutes?: Record<string, number>,
) {
  const geographic = base ? optimizeFromBase(stops, base) : optimizeKnownStopOrder(stops, false);
  if (stops.length <= 1 || !stops.some((stop) => constraints.get(stop.id)?.fixedTimeMinutes != null)) return geographic;
  if (stops.length > 8) {
    return [...geographic].sort((a, b) => {
      const aTime = constraints.get(a.id)?.fixedTimeMinutes;
      const bTime = constraints.get(b.id)?.fixedTimeMinutes;
      if (aTime === null || aTime === undefined || bTime === null || bTime === undefined) return 0;
      return aTime - bTime;
    });
  }

  let best = geographic;
  let bestScore = scheduleOrderScore(best, base, startMinutes, constraints, liveTransitMinutes);
  const used = new Set<string>();
  const candidate: RouteStop[] = [];
  const visit = () => {
    if (candidate.length === stops.length) {
      const score = scheduleOrderScore(candidate, base, startMinutes, constraints, liveTransitMinutes);
      if (score < bestScore) {
        best = [...candidate];
        bestScore = score;
      }
      return;
    }
    for (const stop of stops) {
      if (used.has(stop.id)) continue;
      used.add(stop.id);
      candidate.push(stop);
      visit();
      candidate.pop();
      used.delete(stop.id);
    }
  };
  visit();
  return best;
}

function buildDay(
  stops: RouteStop[],
  index: number,
  dayCount: number,
  locale: Locale,
  base: TripBase | null,
  airportConstraints: AirportConstraint[],
  constraints: Map<string, WishlistStopConstraint>,
  requestedStart?: string,
  startDate?: string,
  liveTransitMinutes?: Record<string, number>,
  mealPlan: MealPlan = "none",
): BuiltPlanDay {
  const arrivalConstraint = index === 0 ? airportConstraints.find((constraint) => constraint.direction === "arrival") : null;
  const departureConstraint = index === dayCount - 1 ? airportConstraints.find((constraint) => constraint.direction === "departure") : null;
  const arrivalReadyMinutes = arrivalConstraint
    ? clockMinutes(arrivalConstraint.cityTime)! + (arrivalConstraint.cityTimeDayOffset === 1 ? 1440 : 0)
    : 9 * 60;
  const requestedStartMinutes = clockMinutes(requestedStart) ?? 9 * 60;
  const startMinutes = Math.max(requestedStartMinutes, arrivalReadyMinutes);
  const orderedPlaces = orderForReservations(stops, base, startMinutes, constraints, liveTransitMinutes);
  const ordered = insertMealBreaks(
    orderedPlaces,
    index,
    locale,
    mealPlan,
    base,
    startMinutes,
    constraints,
    liveTransitMinutes,
  );
  const date = addDaysToIsoDate(startDate, index);
  const legs = ordered.slice(0, -1).map((from, stopIndex): BuiltPlanLeg => {
    const to = ordered[stopIndex + 1];
    return {
      from,
      to,
      comparison: routeComparison(from, to, liveTransitMinutes),
      googleMapsUrls: {
        walk: buildGoogleMapsUrl([from, to], "walking"),
        transit: buildGoogleMapsUrl([from, to], "transit"),
        taxi: buildGoogleMapsUrl([from, to], "driving"),
      },
      isLocalMealPause: (isMealStop(from) || isMealStop(to)) && straightLineDistanceKm(from, to) < 0.05,
    };
  });
  let cursor = startMinutes;
  let hotelTravelMinutes: number | null = null;
  if (base && ordered[0]) {
    const outbound = routeComparison(base, ordered[0], liveTransitMinutes).recommended.minutes;
    cursor += outbound + 10;
    hotelTravelMinutes = outbound;
  }
  const scheduledStops = ordered.map((stop, stopIndex): BuiltPlanStop => {
    const constraint = constraints.get(stop.id) ?? defaultConstraint;
    const reservationLateMinutes = constraint.fixedTimeMinutes === null ? 0 : Math.max(0, cursor - constraint.fixedTimeMinutes);
    if (constraint.fixedTimeMinutes !== null) cursor = Math.max(cursor, constraint.fixedTimeMinutes);
    const arrival = clock(cursor);
    cursor += stop.planningDurationMinutes;
    const departure = clock(cursor);
    const leg = legs[stopIndex];
    if (leg) cursor += leg.comparison.recommended.minutes + 10;
    return {
      stop,
      arrival,
      departure,
      kind: isMealStop(stop) ? "meal" : "place",
      mealKind: mealKindForStop(stop),
      priority: constraint.priority,
      fixedTime: constraint.fixedTime,
      reservationLateMinutes,
      crowd: buildCrowdOutlook(date, arrival, stop),
    };
  });
  if (base && ordered.at(-1)) {
    const inbound = routeComparison(ordered.at(-1)!, base, liveTransitMinutes).recommended.minutes;
    cursor += inbound;
    hotelTravelMinutes = (hotelTravelMinutes ?? 0) + inbound;
  }
  const deadlineMinutes = departureConstraint
    ? clockMinutes(departureConstraint.cityTime)! + (departureConstraint.cityTimeDayOffset === -1 ? -1440 : 0)
    : null;
  const areas = [...new Set(ordered.map((stop) => stop.area))];
  const mapStops = base ? [base, ...ordered, base] : ordered;
  return {
    label: dayLabel(index + 1, locale),
    date,
    theme: areas.length > 0 ? areas.slice(0, 3).join(" · ") : openDayLabel(locale),
    stops: scheduledStops,
    legs,
    totalMinutes: cursor - startMinutes,
    startTime: clock(startMinutes),
    requestedStartTime: clock(requestedStartMinutes),
    startAdjustedByArrival: startMinutes > requestedStartMinutes,
    finishTime: clock(cursor),
    hotelTravelMinutes,
    deadline: deadlineMinutes === null ? null : clock(deadlineMinutes),
    deadlineOverrunMinutes: deadlineMinutes === null ? 0 : Math.max(0, cursor - deadlineMinutes),
    reservationConflictCount: scheduledStops.filter((stop) => stop.reservationLateMinutes > 0).length,
    googleMapsUrl: ordered.length > 0 ? buildGoogleMapsUrl(mapStops) : null,
  };
}

export function buildTripFromWishlist(
  raw: string,
  requestedDays: number,
  pace: Pace,
  locale: Locale = "en",
  context: TripPlannerContext = {},
): BuiltTripPlan {
  const knownStops: RouteStop[] = [];
  const unknownEntries: string[] = [];
  const constraints = new Map<string, WishlistStopConstraint>();

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || headingPattern.test(line)) continue;
    const entry = cleanEntry(line);
    if (!entry) continue;
    const parsedConstraint = parseWishlistConstraint(line);
    const userFoodReservation = resolveUserFoodReservation(entry, parsedConstraint, locale);
    const resolved = userFoodReservation ? [userFoodReservation] : resolveKnownStops(entry, locale);
    if (resolved.length === 0) {
      unknownEntries.push(entry);
      continue;
    }
    for (const stop of resolved) {
      const durationOverride = context.durationOverrides?.[stop.id];
      const plannedStop = typeof durationOverride === "number" && Number.isFinite(durationOverride) && durationOverride >= 15 && durationOverride <= 480
        ? { ...stop, planningDurationMinutes: Math.round(durationOverride) }
        : stop;
      if (!knownStops.some((candidate) => candidate.id === plannedStop.id)) knownStops.push(plannedStop);
      constraints.set(stop.id, mergeConstraints(constraints.get(stop.id), parsedConstraint));
    }
  }

  const paceCapacity = pace === "relaxed" ? 3 : pace === "fast" ? 5 : 4;
  const initialClusters = knownStops.length > 0 ? clusterStops(knownStops, requestedDays) : [];
  const fullClusters = applyFixedDays(initialClusters, constraints);
  const clusters = fullClusters.map((cluster) => [...cluster]);
  const deferredOptionalStops: RouteStop[] = [];
  for (const cluster of clusters) {
    while (cluster.length > paceCapacity) {
      const optionalIndex = cluster.findLastIndex((stop) => constraints.get(stop.id)?.priority === "optional");
      if (optionalIndex < 0) break;
      deferredOptionalStops.push(...cluster.splice(optionalIndex, 1));
    }
  }
  const hotelQuery = context.hotelQuery?.trim() ?? "";
  const selectedBase = resolveTripBase(hotelQuery, locale);
  const baseRecommendations = recommendBases(knownStops, fullClusters, locale);
  const airportConstraints = buildAirportConstraints(context, selectedBase, locale);
  const days = clusters.map((cluster, index) => buildDay(
    cluster,
    index,
    clusters.length,
    locale,
    selectedBase,
    airportConstraints,
    constraints,
    context.dayStartTimes?.[index],
    context.tripStartDate,
    context.liveTransitMinutes,
    context.mealPlan ?? "none",
  ));
  const lastIndex = days.length - 1;
  if (lastIndex >= 0) {
    while (days[lastIndex].deadlineOverrunMinutes > 0) {
      const optionalIndex = clusters[lastIndex].findLastIndex((stop) => constraints.get(stop.id)?.priority === "optional");
      if (optionalIndex < 0) break;
      deferredOptionalStops.push(...clusters[lastIndex].splice(optionalIndex, 1));
      days[lastIndex] = buildDay(
        clusters[lastIndex],
        lastIndex,
        clusters.length,
        locale,
        selectedBase,
        airportConstraints,
        constraints,
        context.dayStartTimes?.[lastIndex],
        context.tripStartDate,
        context.liveTransitMinutes,
        context.mealPlan ?? "none",
      );
    }
  }
  const scheduledStopCount = days.reduce((sum, day) => sum + day.stops.filter((stop) => stop.kind === "place").length, 0);
  const mealBreakCount = days.reduce((sum, day) => sum + day.stops.filter((stop) => stop.kind === "meal").length, 0);
  return {
    requestedDays,
    recognizedStopCount: knownStops.length,
    scheduledStopCount,
    mealBreakCount,
    unknownEntries: [...new Set(unknownEntries)],
    deferredOptionalStops,
    constraintCount: [...constraints.values()].filter((constraint) => (
      constraint.priority !== "normal" || constraint.fixedDay !== null || constraint.fixedTime !== null
    )).length,
    overCapacityCount: clusters.reduce((sum, cluster) => sum + Math.max(0, cluster.length - paceCapacity), 0),
    scheduleConflictCount: days.filter((day) => day.deadlineOverrunMinutes > 0 || day.reservationConflictCount > 0).length,
    selectedBase,
    hotelQuery,
    hotelResolved: hotelQuery.length > 0 && selectedBase !== null,
    baseRecommendations,
    airportConstraints,
    days,
  };
}
