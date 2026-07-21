import type { Locale } from "./i18n.ts";
import type { Pace } from "./trip-analysis.ts";
import {
  buildGoogleMapsUrl,
  optimizeKnownStopOrder,
  resolveKnownStops,
  straightLineDistanceKm,
  type ResolvedInputStop,
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
  openingStatus: "verified_open" | "unknown" | "conflict";
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
  openingConflictCount: number;
  googleMapsUrl: string | null;
};

export type VisitWindow = {
  openMinutes: number;
  closeMinutes: number;
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

export type FoodRecommendationSlot = {
  id: string;
  dayIndex: number;
  dayLabel: string;
  date: string | null;
  kind: MealKind;
  area: string;
  anchorStopId: string;
  latitude: number;
  longitude: number;
  window: string;
  rationale: string;
  queryIdeas: string[];
};

export type WishlistStopConstraint = {
  priority: StopPriority;
  fixedDay: number | null;
  fixedTime: string | null;
  fixedTimeMinutes: number | null;
  isReservation: boolean;
};

export type AirportCode = "none" | "HND" | "NRT" | "KIX" | "ITM" | "NGO" | "FUK" | "CTS" | "OKA";
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
  earlyVisitStopIds?: string[];
  liveTransitMinutes?: Record<string, number>;
  liveWalkingMinutes?: Record<string, number>;
  openingWindowsByDay?: Record<string, Record<number, VisitWindow[]>>;
  mealPlan?: MealPlan;
  resolvedStops?: ResolvedInputStop[];
  resolvedBase?: ResolvedInputStop | null;
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
  deferredUnavailableStops: RouteStop[];
  constraintCount: number;
  overCapacityCount: number;
  scheduleConflictCount: number;
  selectedBase: TripBase | null;
  hotelQuery: string;
  hotelResolved: boolean;
  baseRecommendations: BaseRecommendation[];
  airportConstraints: AirportConstraint[];
  foodRecommendationSlots: FoodRecommendationSlot[];
  days: BuiltPlanDay[];
};

const headingPattern = /^(?:day\s*\d+|\d+\s*日目|\d+\s*일차|第?\s*\d+\s*天)(?:\s*[-–—:].*)?$/i;
const mustPattern = /\bmust(?:-do)?\b|\bnon[- ]?negotiable\b|必須|絶対|필수|꼭|必去|必须/i;
const optionalPattern = /\boptional\b|\bif\s+(?:there(?:'s| is)\s+)?time\b|任意|時間があれば|선택|시간(?:이|\s)?되면|可选|有时间/i;
const reservationPattern = /\bbooked\b|\breserved\b|\breservation\b|\btimed ticket\b|予約|確定|예약|예매|预约|预订/i;
const foodVenuePattern = /\b(?:restaurant|cafe|café|lunch|dinner|sushi|ramen|izakaya|bar)\b|レストラン|食堂|寿司|すし|鮨|ラーメン|居酒屋|カフェ|ランチ|ディナー|昼食|夕食|식당|레스토랑|카페|점심|저녁|스시|라멘|餐厅|餐館|咖啡|午餐|晚餐|寿司|拉面/i;

const airportData = {
  HND: {
    names: { en: "Haneda Airport", ja: "羽田空港", ko: "하네다 공항", zh: "羽田机场" },
    latitude: 35.5494,
    longitude: 139.7798,
    transferMinutes: 60,
    internationalDepartureMinutes: 180,
    sourceUrl: "https://www.tokyo-haneda.com/en/flight/detail/int_departure.html",
  },
  NRT: {
    names: { en: "Narita Airport", ja: "成田空港", ko: "나리타 공항", zh: "成田机场" },
    latitude: 35.772,
    longitude: 140.3929,
    transferMinutes: 105,
    internationalDepartureMinutes: 120,
    sourceUrl: "https://www.narita-airport.jp/en/airportguide/inter-dep/",
  },
  KIX: {
    names: { en: "Kansai Airport", ja: "関西国際空港", ko: "간사이 공항", zh: "关西机场" },
    latitude: 34.432,
    longitude: 135.2304,
    transferMinutes: 60,
    internationalDepartureMinutes: 150,
    sourceUrl: "https://www.kansai-airport.or.jp/en/",
  },
  ITM: {
    names: { en: "Osaka Itami Airport", ja: "大阪国際空港（伊丹）", ko: "오사카 이타미 공항", zh: "大阪伊丹机场" },
    latitude: 34.7855,
    longitude: 135.4382,
    transferMinutes: 40,
    internationalDepartureMinutes: 120,
    sourceUrl: "https://www.osaka-airport.co.jp/en/",
  },
  NGO: {
    names: { en: "Chubu Centrair Airport", ja: "中部国際空港", ko: "주부 센트레아 공항", zh: "中部国际机场" },
    latitude: 34.8584,
    longitude: 136.8054,
    transferMinutes: 50,
    internationalDepartureMinutes: 150,
    sourceUrl: "https://www.centrair.jp/en/",
  },
  FUK: {
    names: { en: "Fukuoka Airport", ja: "福岡空港", ko: "후쿠오카 공항", zh: "福冈机场" },
    latitude: 33.5859,
    longitude: 130.4507,
    transferMinutes: 20,
    internationalDepartureMinutes: 150,
    sourceUrl: "https://www.fukuoka-airport.jp/en/",
  },
  CTS: {
    names: { en: "New Chitose Airport", ja: "新千歳空港", ko: "신치토세 공항", zh: "新千岁机场" },
    latitude: 42.7752,
    longitude: 141.6923,
    transferMinutes: 50,
    internationalDepartureMinutes: 150,
    sourceUrl: "https://www.hokkaido-airports.com/en/new-chitose/",
  },
  OKA: {
    names: { en: "Naha Airport", ja: "那覇空港", ko: "나하 공항", zh: "那霸机场" },
    latitude: 26.1958,
    longitude: 127.6458,
    transferMinutes: 25,
    internationalDepartureMinutes: 150,
    sourceUrl: "https://www.naha-airport.co.jp/en/",
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

function buildCrowdOutlook(date: string | null, arrival: string, stop: RouteStop): CrowdOutlook | null {
  if (!date) return null;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) return null;
  const day = parsedDate.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const arrivalMinutes = clockMinutes(arrival) ?? 0;
  const peakTime = arrivalMinutes >= 11 * 60 && arrivalMinutes <= 16 * 60;
  let score = stop.isAnchor ? 2 : 1;
  if (peakTime) score += 1;
  if (isWeekend) score += 1;
  const levels: CrowdLevel[] = ["quiet", "moderate", "busy", "veryBusy"];
  return {
    level: levels[Math.min(levels.length - 1, score)],
    confidence: stop.confidence === "low" ? "low" : "medium",
    isWeekend,
    weekendUplift: isWeekend ? 1 : 0,
    peakTime,
  };
}

const foodProfiles: Array<{
  areas: RegExp;
  ideas: Record<Locale, string[]>;
}> = [
  {
    areas: /Tsukiji|Toyosu|築地|豊洲|쓰키지|도요스|筑地|丰洲/i,
    ideas: {
      en: ["sushi & seafood", "market breakfast", "casual Japanese"],
      ja: ["寿司・海鮮", "市場らしい朝ごはん", "気軽な和食"],
      ko: ["스시·해산물", "시장 아침 식사", "캐주얼 일식"],
      zh: ["寿司与海鲜", "市场早餐", "轻松日料"],
    },
  },
  {
    areas: /Asakusa|Oshiage|浅草|押上|아사쿠사|오시아게|浅草|押上/i,
    ideas: {
      en: ["tempura & soba", "old-Tokyo classics", "kissaten café"],
      ja: ["天ぷら・そば", "下町の定番", "喫茶店・甘味"],
      ko: ["덴푸라·소바", "도쿄 서민 음식", "킷사텐 카페"],
      zh: ["天妇罗与荞麦面", "下町经典", "复古咖啡馆"],
    },
  },
  {
    areas: /Shibuya|Harajuku|渋谷|原宿|시부야|하라주쿠|涩谷|原宿/i,
    ideas: {
      en: ["modern Japanese", "small-plate izakaya", "specialty café"],
      ja: ["今っぽい和食", "小皿系の居酒屋", "専門店カフェ"],
      ko: ["모던 일식", "소접시 이자카야", "스페셜티 카페"],
      zh: ["现代日料", "小盘居酒屋", "精品咖啡馆"],
    },
  },
  {
    areas: /Shinjuku|新宿|신주쿠/i,
    ideas: {
      en: ["yakitori & izakaya", "ramen", "late-night Japanese"],
      ja: ["焼き鳥・居酒屋", "ラーメン", "遅めでも入れる和食"],
      ko: ["야키토리·이자카야", "라멘", "늦은 시간 일식"],
      zh: ["烤鸡串与居酒屋", "拉面", "深夜日料"],
    },
  },
  {
    areas: /Akihabara|Ueno|秋葉原|上野|아키하바라|우에노|秋叶原|上野/i,
    ideas: {
      en: ["ramen & curry", "tonkatsu", "casual izakaya"],
      ja: ["ラーメン・カレー", "とんかつ", "気軽な居酒屋"],
      ko: ["라멘·카레", "돈카츠", "캐주얼 이자카야"],
      zh: ["拉面与咖喱", "炸猪排", "轻松居酒屋"],
    },
  },
  {
    areas: /Mitaka|三鷹|미타카|三鹰/i,
    ideas: {
      en: ["neighborhood Japanese", "set meal", "quiet café"],
      ja: ["街の和食店", "定食", "落ち着いたカフェ"],
      ko: ["동네 일식", "정식", "조용한 카페"],
      zh: ["社区日料", "定食", "安静咖啡馆"],
    },
  },
];

function foodIdeasForArea(area: string, locale: Locale) {
  const profile = foodProfiles.find((candidate) => candidate.areas.test(area));
  if (profile) return profile.ideas[locale];
  return {
    en: ["local Japanese", "casual set meal", "café break"],
    ja: ["その街らしい和食", "気軽な定食", "カフェ休憩"],
    ko: ["현지 일식", "캐주얼 정식", "카페 휴식"],
    zh: ["当地日料", "轻松定食", "咖啡休息"],
  }[locale];
}

function buildFoodRecommendationSlots(days: BuiltPlanDay[], mealPlan: MealPlan, locale: Locale) {
  if (mealPlan === "none") return [];
  const slots: FoodRecommendationSlot[] = [];
  days.forEach((day, dayIndex) => {
    if (day.stops.length === 0) return;
    const requestedKinds: MealKind[] = mealPlan === "all" ? ["lunch", "dinner"] : ["dinner"];
    for (const kind of requestedKinds) {
      const deadlineMinutes = clockMinutes(day.deadline ?? undefined);
      if (kind === "lunch" && clockMinutes(day.startTime)! > 14 * 60) continue;
      if (kind === "dinner" && deadlineMinutes !== null && deadlineMinutes < 17 * 60 + 30) continue;
      const anchor = kind === "lunch"
        ? day.stops.reduce((closest, stop) => {
          const target = 12 * 60 + 30;
          return Math.abs((clockMinutes(stop.arrival) ?? target) - target) < Math.abs((clockMinutes(closest.arrival) ?? target) - target) ? stop : closest;
        })
        : day.stops.at(-1)!;
      const rationale = kind === "lunch"
        ? {
          en: `Easy to reach around ${anchor.stop.name}, without adding a cross-city detour.`,
          ja: `${anchor.stop.name}の前後で寄りやすく、わざわざ別の街へ移動せずに済みます。`,
          ko: `${anchor.stop.name} 전후로 들르기 쉬워 도시를 가로지를 필요가 없습니다.`,
          zh: `适合在${anchor.stop.name}前后前往，不必额外跨城移动。`,
        }[locale]
        : {
          en: `A flexible finish near ${anchor.stop.name}; keep it here or move dinner back toward the hotel.`,
          ja: `${anchor.stop.name}を見終えた流れで選びやすいエリアです。疲れていたらホテル周辺へ変えても大丈夫。`,
          ko: `${anchor.stop.name} 이후 자연스럽게 고를 수 있고, 피곤하면 호텔 근처로 바꿔도 됩니다.`,
          zh: `游览${anchor.stop.name}后顺路选择即可；累了也可以改到酒店附近。`,
        }[locale];
      slots.push({
        id: `food-${dayIndex + 1}-${kind}`,
        dayIndex,
        dayLabel: day.label,
        date: day.date,
        kind,
        area: anchor.stop.area,
        anchorStopId: anchor.stop.id,
        latitude: anchor.stop.latitude,
        longitude: anchor.stop.longitude,
        window: kind === "lunch" ? "11:30–14:00" : "17:30–21:00",
        rationale,
        queryIdeas: foodIdeasForArea(anchor.stop.area, locale),
      });
    }
  });
  return slots;
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

function resolveTripBase(query: string, locale: Locale, resolvedBase?: ResolvedInputStop | null) {
  const normalized = query.trim();
  if (resolvedBase) {
    return {
      ...resolvedBase,
      id: `base-${resolvedBase.id}`,
      planningDurationMinutes: 0,
      isAnchor: false,
      query: normalized || resolvedBase.name,
    };
  }
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

function recommendBases(stops: RouteStop[], clusters: RouteStop[][], locale: Locale, nationwide: boolean) {
  if (stops.length === 0) return [];
  const dynamicBases = [...new Map(stops.map((stop) => [stop.area, stop])).values()].map((stop): TripBase => ({
    ...stop,
    id: `base-dynamic-${stop.id}`,
    name: locale === "ja" ? `${stop.area}周辺` : `${stop.area} area`,
    planningDurationMinutes: 0,
    isAnchor: false,
    query: stop.name,
  }));
  const bases = nationwide
    ? dynamicBases
    : baseDefinitions.map((definition) => buildBase(definition, locale, ""));
  return bases
    .map((base) => {
      const routeDistanceKm = clusters.reduce((sum, cluster) => sum + routeDistanceFromBase(optimizeFromBase(cluster, base), base), 0);
      return { base, routeDistanceKm };
    })
    .sort((a, b) => a.routeDistanceKm - b.routeDistanceKm)
    .slice(0, 3);
}

function airportStop(code: Exclude<AirportCode, "none">, locale: Locale): RouteStop {
  const airport = airportData[code];
  return {
    id: `airport-${code.toLowerCase()}`,
    name: airport.names[locale],
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

function hasUsableOpeningWindow(stop: RouteStop, windows: VisitWindow[] | undefined) {
  if (windows === undefined) return null;
  return windows.some((window) => (
    Number.isFinite(window.openMinutes)
    && Number.isFinite(window.closeMinutes)
    && window.closeMinutes - window.openMinutes >= stop.planningDurationMinutes
  ));
}

function applyOpeningDays(
  clusters: RouteStop[][],
  constraints: Map<string, WishlistStopConstraint>,
  availability: Record<string, Record<number, VisitWindow[]>>,
  capacity: number,
) {
  const assigned = clusters.map((cluster) => [...cluster]);
  const unavailable: RouteStop[] = [];
  for (let dayIndex = 0; dayIndex < assigned.length; dayIndex += 1) {
    for (const stop of [...assigned[dayIndex]]) {
      if (hasUsableOpeningWindow(stop, availability[stop.id]?.[dayIndex]) !== false) continue;
      const constraint = constraints.get(stop.id) ?? defaultConstraint;
      if (constraint.fixedDay !== null || constraint.isReservation) continue;
      const destination = assigned
        .map((cluster, index) => ({ cluster, index }))
        .filter(({ cluster, index }) => (
          index !== dayIndex
          && cluster.length < capacity
          && hasUsableOpeningWindow(stop, availability[stop.id]?.[index]) === true
        ))
        .sort((left, right) => Math.abs(left.index - dayIndex) - Math.abs(right.index - dayIndex))[0];
      assigned[dayIndex] = assigned[dayIndex].filter((candidate) => candidate.id !== stop.id);
      if (destination) assigned[destination.index].push(stop);
      else unavailable.push(stop);
    }
  }
  return { assigned, unavailable };
}

function routeComparison(
  from: RouteStop,
  to: RouteStop,
  liveTransitMinutes?: Record<string, number>,
  liveWalkingMinutes?: Record<string, number>,
) {
  const key = routeLegKey(from.id, to.id);
  return applyLiveTransitMinutes(
    estimateTravelOptions(from, to),
    liveTransitMinutes?.[key],
    liveWalkingMinutes?.[key],
  );
}

function routeTravelMinutes(
  from: RouteStop,
  to: RouteStop,
  liveTransitMinutes?: Record<string, number>,
  liveWalkingMinutes?: Record<string, number>,
) {
  return routeComparison(from, to, liveTransitMinutes, liveWalkingMinutes).recommended.minutes + 10;
}

function fitVisitToWindow(cursor: number, duration: number, windows: VisitWindow[] | undefined) {
  if (windows === undefined) return { start: cursor, status: "unknown" as const };
  for (const window of windows) {
    if (!Number.isFinite(window.openMinutes) || !Number.isFinite(window.closeMinutes) || window.closeMinutes <= window.openMinutes) continue;
    const start = Math.max(cursor, window.openMinutes);
    if (start + duration <= window.closeMinutes) return { start, status: "verified_open" as const };
  }
  return { start: cursor, status: "conflict" as const };
}

function scheduleOrderScore(
  ordered: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  earlyVisitStopIds: Set<string>,
  openingWindows: Record<string, VisitWindow[]>,
  liveTransitMinutes?: Record<string, number>,
  liveWalkingMinutes?: Record<string, number>,
) {
  let cursor = startMinutes;
  let lateMinutes = 0;
  let travelMinutes = 0;
  let earlyVisitPenalty = 0;
  if (base && ordered[0]) {
    const travel = routeTravelMinutes(base, ordered[0], liveTransitMinutes, liveWalkingMinutes);
    travelMinutes += travel;
    cursor += travel;
  }
  ordered.forEach((stop, index) => {
    const fixed = constraints.get(stop.id)?.fixedTimeMinutes;
    if (fixed !== null && fixed !== undefined) {
      lateMinutes += Math.max(0, cursor - fixed);
      cursor = Math.max(cursor, fixed);
    }
    const fitted = fitVisitToWindow(cursor, stop.planningDurationMinutes, openingWindows[stop.id]);
    if (fitted.status === "conflict") lateMinutes += 24 * 60;
    else cursor = fitted.start;
    if (earlyVisitStopIds.has(stop.id)) {
      // Explicit sell-out, early-cutoff or queue evidence is a soft preference,
      // never a replacement for a reservation or verified opening time.
      earlyVisitPenalty += index * 90 + Math.max(0, cursor - 12 * 60);
    }
    cursor += stop.planningDurationMinutes;
    if (ordered[index + 1]) {
      const travel = routeTravelMinutes(stop, ordered[index + 1], liveTransitMinutes, liveWalkingMinutes);
      travelMinutes += travel;
      cursor += travel;
    }
  });
  if (base && ordered.at(-1)) {
    const travel = routeComparison(ordered.at(-1)!, base, liveTransitMinutes, liveWalkingMinutes).recommended.minutes;
    travelMinutes += travel;
    cursor += travel;
  }
  return lateMinutes * 100_000 + earlyVisitPenalty * 100 + cursor - startMinutes + travelMinutes;
}

function orderForReservations(
  stops: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  earlyVisitStopIds: Set<string>,
  openingWindows: Record<string, VisitWindow[]>,
  liveTransitMinutes?: Record<string, number>,
  liveWalkingMinutes?: Record<string, number>,
) {
  const geographic = base ? optimizeFromBase(stops, base) : optimizeKnownStopOrder(stops, false);
  const hasTimedConstraint = stops.some((stop) => constraints.get(stop.id)?.fixedTimeMinutes != null);
  const hasEarlyPreference = stops.some((stop) => earlyVisitStopIds.has(stop.id));
  const hasOpeningConstraint = stops.some((stop) => openingWindows[stop.id] !== undefined);
  if (stops.length <= 1 || (!hasTimedConstraint && !hasEarlyPreference && !hasOpeningConstraint && !liveTransitMinutes && !liveWalkingMinutes)) return geographic;
  if (stops.length > 8) {
    return [...geographic].sort((a, b) => {
      const earlyDifference = Number(earlyVisitStopIds.has(b.id)) - Number(earlyVisitStopIds.has(a.id));
      if (earlyDifference !== 0) return earlyDifference;
      const aOpen = openingWindows[a.id]?.[0]?.openMinutes;
      const bOpen = openingWindows[b.id]?.[0]?.openMinutes;
      if (aOpen !== undefined || bOpen !== undefined) return (aOpen ?? Number.MAX_SAFE_INTEGER) - (bOpen ?? Number.MAX_SAFE_INTEGER);
      const aTime = constraints.get(a.id)?.fixedTimeMinutes;
      const bTime = constraints.get(b.id)?.fixedTimeMinutes;
      if (aTime === null || aTime === undefined || bTime === null || bTime === undefined) return 0;
      return aTime - bTime;
    });
  }

  let best = geographic;
  let bestScore = scheduleOrderScore(best, base, startMinutes, constraints, earlyVisitStopIds, openingWindows, liveTransitMinutes, liveWalkingMinutes);
  const used = new Set<string>();
  const candidate: RouteStop[] = [];
  const visit = () => {
    if (candidate.length === stops.length) {
      const score = scheduleOrderScore(candidate, base, startMinutes, constraints, earlyVisitStopIds, openingWindows, liveTransitMinutes, liveWalkingMinutes);
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
  earlyVisitStopIds: Set<string>,
  openingWindows: Record<string, VisitWindow[]>,
  requestedStart?: string,
  startDate?: string,
  liveTransitMinutes?: Record<string, number>,
  liveWalkingMinutes?: Record<string, number>,
): BuiltPlanDay {
  const arrivalConstraint = index === 0 ? airportConstraints.find((constraint) => constraint.direction === "arrival") : null;
  const departureConstraint = index === dayCount - 1 ? airportConstraints.find((constraint) => constraint.direction === "departure") : null;
  const arrivalReadyMinutes = arrivalConstraint
    ? clockMinutes(arrivalConstraint.cityTime)! + (arrivalConstraint.cityTimeDayOffset === 1 ? 1440 : 0)
    : 9 * 60;
  const requestedStartMinutes = clockMinutes(requestedStart) ?? 9 * 60;
  const startMinutes = Math.max(requestedStartMinutes, arrivalReadyMinutes);
  const ordered = orderForReservations(
    stops,
    base,
    startMinutes,
    constraints,
    earlyVisitStopIds,
    openingWindows,
    // The prefetch covers the selected draft legs, not an all-pairs matrix.
    // Keep its order stable and use measured durations only for the clock.
    undefined,
    undefined,
  );
  const date = addDaysToIsoDate(startDate, index);
  const legs = ordered.slice(0, -1).map((from, stopIndex): BuiltPlanLeg => {
    const to = ordered[stopIndex + 1];
    return {
      from,
      to,
      comparison: routeComparison(from, to, liveTransitMinutes, liveWalkingMinutes),
      googleMapsUrls: {
        walk: buildGoogleMapsUrl([from, to], "walking"),
        transit: buildGoogleMapsUrl([from, to], "transit"),
        taxi: buildGoogleMapsUrl([from, to], "driving"),
      },
      isLocalMealPause: false,
    };
  });
  let cursor = startMinutes;
  let hotelTravelMinutes: number | null = null;
  if (base && ordered[0]) {
    const outbound = routeComparison(base, ordered[0], liveTransitMinutes, liveWalkingMinutes).recommended.minutes;
    cursor += outbound + 10;
    hotelTravelMinutes = outbound;
  }
  const scheduledStops = ordered.map((stop, stopIndex): BuiltPlanStop => {
    const constraint = constraints.get(stop.id) ?? defaultConstraint;
    if (constraint.fixedTimeMinutes !== null) cursor = Math.max(cursor, constraint.fixedTimeMinutes);
    const opening = fitVisitToWindow(cursor, stop.planningDurationMinutes, openingWindows[stop.id]);
    if (opening.status !== "conflict") cursor = opening.start;
    const reservationLateMinutes = constraint.fixedTimeMinutes === null ? 0 : Math.max(0, cursor - constraint.fixedTimeMinutes);
    const arrival = clock(cursor);
    cursor += stop.planningDurationMinutes;
    const departure = clock(cursor);
    const leg = legs[stopIndex];
    if (leg) cursor += leg.comparison.recommended.minutes + 10;
    return {
      stop,
      arrival,
      departure,
      kind: "place",
      mealKind: null,
      priority: constraint.priority,
      fixedTime: constraint.fixedTime,
      reservationLateMinutes,
      openingStatus: opening.status,
      crowd: buildCrowdOutlook(date, arrival, stop),
    };
  });
  if (base && ordered.at(-1)) {
    const inbound = routeComparison(ordered.at(-1)!, base, liveTransitMinutes, liveWalkingMinutes).recommended.minutes;
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
    openingConflictCount: scheduledStops.filter((stop) => stop.openingStatus === "conflict").length,
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
    const providerStop = context.resolvedStops?.find((candidate) => (
      candidate.input === entry || entry.startsWith(candidate.input) || candidate.input.startsWith(entry)
    ));
    const userFoodReservation = resolveUserFoodReservation(entry, parsedConstraint, locale);
    const resolved = providerStop
      ? [{ ...providerStop, isAnchor: parsedConstraint.isReservation || parsedConstraint.priority === "must" }]
      : userFoodReservation ? [userFoodReservation] : resolveKnownStops(entry, locale);
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
  const fixedClusters = applyFixedDays(initialClusters, constraints);
  const openingAssignment = applyOpeningDays(fixedClusters, constraints, context.openingWindowsByDay ?? {}, paceCapacity);
  const fullClusters = openingAssignment.assigned;
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
  const selectedBase = resolveTripBase(hotelQuery, locale, context.resolvedBase);
  const scheduledKnownStops = fullClusters.flat();
  const baseRecommendations = recommendBases(scheduledKnownStops, fullClusters, locale, Boolean(context.resolvedStops?.length));
  const airportConstraints = buildAirportConstraints(context, selectedBase, locale);
  const earlyVisitStopIds = new Set(context.earlyVisitStopIds ?? []);
  const days = clusters.map((cluster, index) => buildDay(
    cluster,
    index,
    clusters.length,
    locale,
    selectedBase,
    airportConstraints,
    constraints,
    earlyVisitStopIds,
    Object.fromEntries(cluster.map((stop) => [stop.id, context.openingWindowsByDay?.[stop.id]?.[index]]).filter((entry) => entry[1] !== undefined)) as Record<string, VisitWindow[]>,
    context.dayStartTimes?.[index],
    context.tripStartDate,
    context.liveTransitMinutes,
    context.liveWalkingMinutes,
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
        earlyVisitStopIds,
        Object.fromEntries(clusters[lastIndex].map((stop) => [stop.id, context.openingWindowsByDay?.[stop.id]?.[lastIndex]]).filter((entry) => entry[1] !== undefined)) as Record<string, VisitWindow[]>,
        context.dayStartTimes?.[lastIndex],
        context.tripStartDate,
        context.liveTransitMinutes,
        context.liveWalkingMinutes,
      );
    }
  }
  const scheduledStopCount = days.reduce((sum, day) => sum + day.stops.filter((stop) => stop.kind === "place").length, 0);
  const foodRecommendationSlots = buildFoodRecommendationSlots(days, context.mealPlan ?? "none", locale);
  return {
    requestedDays,
    recognizedStopCount: knownStops.length,
    scheduledStopCount,
    mealBreakCount: 0,
    unknownEntries: [...new Set(unknownEntries)],
    deferredOptionalStops,
    deferredUnavailableStops: openingAssignment.unavailable,
    constraintCount: [...constraints.values()].filter((constraint) => (
      constraint.priority !== "normal" || constraint.fixedDay !== null || constraint.fixedTime !== null
    )).length,
    overCapacityCount: clusters.reduce((sum, cluster) => sum + Math.max(0, cluster.length - paceCapacity), 0),
    scheduleConflictCount: days.filter((day) => day.deadlineOverrunMinutes > 0 || day.reservationConflictCount > 0 || day.openingConflictCount > 0).length,
    selectedBase,
    hotelQuery,
    hotelResolved: selectedBase !== null,
    baseRecommendations,
    airportConstraints,
    foodRecommendationSlots,
    days,
  };
}
