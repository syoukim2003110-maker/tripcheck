import type {
  Destination,
  DestinationAirport,
  DestinationChoice,
  DestinationId,
  MealWindow,
  MobilityProfile,
} from "./destinations.ts";
import {
  destinationAirport,
  destinationById,
  destinationForCoordinate,
  destinationForCountryCode,
} from "./destinations.ts";
import type { Locale } from "./i18n.ts";
import { compareAirportOptions, type FlightKind } from "./airport-comparison.ts";
export type Pace = "relaxed" | "balanced" | "fast";
import { parseWishlist, type ParsedWishlistPlace, type WishlistTimeOfDay } from "./wishlist-parser.ts";
import {
  buildGoogleMapsUrl,
  optimizeKnownStopOrder,
  resolveKnownStops,
  straightLineDistanceKm,
  type ResolvedInputStop,
  type RouteStop,
} from "./route-optimizer.ts";
import { applyLiveTransitMinutes, estimateTravelOptions, type ModeComparison, type TransportMode, type TravelPreference } from "./time-feasibility.ts";
import {
  allowedTransportModesForLeg,
  routeAccessEndpointsForLeg,
  type PoiAccessAssumption,
  type PoiRouteEndpoint,
} from "./poi-access.ts";

import { isDayAnchorStay, isFoodPlaceTypes } from "./stay-estimates.ts";

const DEFAULT_DAY_END = "22:00";

export type BuiltPlanStop = {
  stop: RouteStop;
  arrival: string;
  departure: string;
  kind: "place" | "meal";
  mealKind: MealKind | null;
  priority: StopPriority;
  fixedTime: string | null;
  isReservation: boolean;
  reservationLateMinutes: number;
  openingStatus: "verified_open" | "unknown" | "conflict" | "closed_day" | "last_entry_conflict";
  crowd: CrowdOutlook | null;
};

export type BuiltPlanLeg = {
  from: RouteStop;
  to: RouteStop;
  comparison: ModeComparison;
  googleMapsUrls: Record<TransportMode, string>;
  isLocalMealPause: boolean;
  walkingMinutes: number;
  walkingLimitExceededMinutes: number;
  /** Exact selected-route evidence; null never means zero transfers. */
  transferCount: number | null;
  /** Provider route ends at a disclosed access node, or could not be resolved. */
  routeEvidenceScope?: "access_node" | "conditional";
  accessAssumptions?: readonly PoiAccessAssumption[];
};

export type MobilityPolicy = {
  maxWalkingMinutesPerLeg: number;
  maxTransfersPerLeg: number;
  walkingLimitWasProvided: boolean;
  transferLimitWasProvided: boolean;
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
  hotelOutboundMinutes: number | null;
  hotelInboundMinutes: number | null;
  hotelOutboundMode: TransportMode | null;
  hotelInboundMode: TransportMode | null;
  hotelOutboundSource: "estimate" | "live" | null;
  hotelInboundSource: "estimate" | "live" | null;
  hotelOutboundTransferCount: number | null;
  hotelInboundTransferCount: number | null;
  hotelOutboundRouteEvidenceScope?: "access_node" | "conditional";
  hotelInboundRouteEvidenceScope?: "access_node" | "conditional";
  hotelOutboundAccessAssumptions?: readonly PoiAccessAssumption[];
  hotelInboundAccessAssumptions?: readonly PoiAccessAssumption[];
  /** Where this day begins (previous night's hotel) and ends (tonight's hotel). */
  startBase: TripBase | null;
  endBase: TripBase | null;
  deadline: string | null;
  /**
   * True when the airport boundary lands on the previous calendar day. The
   * deadline string keeps the boundary's clock face, so readers need this
   * flag to know the day has no usable window at all.
   */
  deadlinePreviousDay?: boolean;
  deadlineKind: "airport" | "curfew" | null;
  deadlineOverrunMinutes: number;
  reservationConflictCount: number;
  openingConflictCount: number;
  googleMapsUrl: string | null;
};

export type VisitWindow = {
  openMinutes: number;
  closeMinutes: number;
  /** Admission cutoff, distinct from the time the facility closes. */
  lastEntryMinutes?: number;
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
  /**
   * Schedule-aware local clock for this meal: the destination meal window
   * pulled toward when the route actually passes the anchor. This is what the
   * timeline displays and sorts by; `window` remains the static range chip.
   */
  displayTime: string;
  /** Local clock used when probing "open at the planned meal time". */
  probeTime?: string;
  /**
   * Encoded provider polyline of the leg being travelled at mealtime. Set by
   * the app (never the builder) so the meal search can run along the route.
   */
  routePolyline?: string;
  rationale: string;
  queryIdeas: string[];
};

export type WishlistStopConstraint = {
  priority: StopPriority;
  fixedDay: number | null;
  fixedTime: string | null;
  fixedTimeMinutes: number | null;
  timeOfDay: WishlistTimeOfDay | null;
  isReservation: boolean;
  stayMinutes: number | null;
};

/** "none" or an IATA code offered by the selected destination. */
export type AirportCode = string;
export type TripPlannerContext = {
  /** Country the trip happens in; supplies airports, meal hours and cuisine words. */
  destination?: DestinationChoice;
  tripStartDate?: string;
  hotelQuery?: string;
  arrivalAirport?: AirportCode;
  arrivalTime?: string;
  departureAirport?: AirportCode;
  departureTime?: string;
  flightKind?: FlightKind;
  dayStartTimes?: Record<number, string>;
  /** Per-day sightseeing cutoff. A day-specific value wins over dayEndTarget. */
  dayEndTimes?: Record<number, string>;
  durationOverrides?: Record<string, number>;
  earlyVisitStopIds?: string[];
  liveTransitMinutes?: Record<string, number>;
  /**
   * Legs (routeLegKey) where the provider explicitly answered that no transit
   * route exists for the requested departure. Negative live evidence: it lets
   * the recommendation fall back to a measured drive instead of pinning an
   * invented train forever.
   */
  liveTransitAbsentLegs?: Record<string, boolean>;
  /**
   * Google transit ride changes keyed by routeLegKey. Callers must derive this
   * from the bounded convergence result, not a pair-only first-write cache;
   * exact request provenance is retained separately in the evidence snapshot.
   */
  liveTransitTransferCounts?: Record<string, number>;
  liveWalkingMinutes?: Record<string, number>;
  liveDrivingMinutes?: Record<string, number>;
  /** "car" plans every leg around a rental car; "auto" recommends the fastest sane mode. */
  travelPreference?: TravelPreference;
  /** The user's per-leg picks ("this hop by taxi"), keyed by routeLegKey. */
  legModeOverrides?: Record<string, TransportMode>;
  /** The user's per-stop day picks (1-based), keyed by stop id. */
  dayOverrides?: Record<string, number>;
  /**
   * Explicit visit order for an existing itinerary, keyed by zero-based day.
   * Wishlist mode leaves this empty so the deterministic optimiser is free to
   * improve the route. Existing-itinerary mode treats the listed relative
   * order as a hard user constraint.
   */
  lockedOrderByDay?: Record<number, string[]>;
  /** Counterfactual-only switch: keep Day assignments but release pasted line order. */
  optimizeExistingOrder?: boolean;
  /** Default day start clock used when a day has no explicit start time. */
  defaultDayStart?: string;
  /** Soft end-of-day target ("21:30"); overruns are flagged, never hidden. */
  dayEndTarget?: string;
  /** Explicit connection/wayfinding margin added after every travelled leg. */
  transferBufferMinutes?: 0 | 10 | 20 | 30;
  /** Stops the user removed from the plan ("not realistic after all"). */
  excludedStopIds?: string[];
  /** Soft mobility preferences. Exceeding them is explained, never hidden. */
  maxWalkingMinutesPerLeg?: number;
  maxTransfersPerLeg?: number;
  openingWindowsByDay?: Record<string, Record<number, VisitWindow[]>>;
  /** Product-owned/user-confirmed admission cutoffs, keyed by stop id. */
  lastEntryTimes?: Record<string, string>;
  mealPlan?: MealPlan;
  resolvedStops?: ResolvedInputStop[];
  resolvedBase?: ResolvedInputStop | null;
  /**
   * Optional hotel per night (night N = where you sleep after day N).
   * Missing nights fall back to the trip-wide base.
   */
  nightBases?: Record<number, ResolvedInputStop | null>;
};

export type TripBase = RouteStop & { query: string };

export type BaseRecommendation = {
  base: TripBase;
  routeDistanceKm: number;
};

export type AirportConstraint = {
  direction: "arrival" | "departure";
  airport: string;
  flightTime: string;
  cityTime: string;
  cityTimeDayOffset: -1 | 0 | 1;
  airportMinutes: number;
  transferMinutes: number;
  transferCount: number | null;
  sourceUrl: string;
  googleMapsUrl: string | null;
};

export type BuiltTripPlan = {
  inputMode: "wishlist" | "existing_itinerary";
  /** Country this plan was built for, after auto-detection. */
  destination: DestinationId;
  requestedDays: number;
  recognizedStopCount: number;
  scheduledStopCount: number;
  mealBreakCount: number;
  unknownEntries: string[];
  deferredOptionalStops: RouteStop[];
  deferredUnavailableStops: RouteStop[];
  constraintCount: number;
  /** Highest explicit day pin among stops that are still part of this plan. */
  minimumPinnedDay: number;
  overCapacityCount: number;
  scheduleConflictCount: number;
  selectedBase: TripBase | null;
  hotelQuery: string;
  hotelResolved: boolean;
  travelPreference: TravelPreference;
  mobilityPolicy: MobilityPolicy;
  baseRecommendations: BaseRecommendation[];
  airportConstraints: AirportConstraint[];
  foodRecommendationSlots: FoodRecommendationSlot[];
  days: BuiltPlanDay[];
};

const foodVenuePattern = /\b(?:restaurant|cafe|café|lunch|dinner|sushi|ramen|izakaya|bar)\b|レストラン|食堂|寿司|すし|鮨|ラーメン|居酒屋|カフェ|ランチ|ディナー|昼食|夕食|식당|레스토랑|카페|점심|저녁|스시|라멘|餐厅|餐館|咖啡|午餐|晚餐|寿司|拉面/i;


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

function constraintFromParsedPlace(place: ParsedWishlistPlace): WishlistStopConstraint {
  return {
    priority: place.priority,
    fixedDay: place.day,
    fixedTime: place.time,
    fixedTimeMinutes: place.time ? clockMinutes(place.time) : null,
    timeOfDay: place.timeOfDay,
    isReservation: place.isReservation,
    stayMinutes: place.stayMinutes,
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
    timeOfDay: next.timeOfDay ?? current.timeOfDay,
    isReservation: current.isReservation || next.isReservation,
    stayMinutes: next.stayMinutes ?? current.stayMinutes,
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

/*
 * Area profiles are Tokyo-specific by design; outside them the fallback must
 * be the destination's own food, never "casual Japanese" in Zermatt.
 */
function foodIdeasForArea(area: string, locale: Locale, destination: Destination) {
  const profile = destination.id === "japan"
    ? foodProfiles.find((candidate) => candidate.areas.test(area))
    : undefined;
  if (profile) return profile.ideas[locale];
  return locale === "ja" ? destination.cuisine.ja : destination.cuisine.en;
}

function buildFoodRecommendationSlots(
  days: BuiltPlanDay[],
  mealPlan: MealPlan,
  locale: Locale,
  destination: Destination,
) {
  const { lunch, dinner } = destination.meals;
  const lunchAnchorMinutes = Math.round((lunch.start + lunch.end) / 2);
  if (mealPlan === "none") return [];
  const slots: FoodRecommendationSlot[] = [];
  days.forEach((day, dayIndex) => {
    if (day.stops.length === 0) return;
    if (day.deadlinePreviousDay) return;
    const requestedKinds: MealKind[] = mealPlan === "all" ? ["lunch", "dinner"] : ["dinner"];
    const firstArrival = clockMinutes(day.stops[0].arrival);
    const lastDepartureRaw = clockMinutes(day.stops.at(-1)!.departure);
    if (firstArrival === null || lastDepartureRaw === null) return;
    // A schedule that runs past midnight wraps to 00:xx; unwrap it so the
    // meal-window overlap gates see the real end of the day.
    const lastDeparture = lastDepartureRaw < firstArrival ? lastDepartureRaw + 1440 : lastDepartureRaw;
    for (const kind of requestedKinds) {
      const deadlineMinutes = clockMinutes(day.deadline ?? undefined);
      // Meals belong to the schedule that actually exists: a day whose route
      // never touches the meal window gets no slot, so a morning-only day
      // cannot grow an 18:00 「帰路の夕食」 row below its 10:42 finish.
      if (kind === "lunch" && (firstArrival > lunch.end || lastDeparture < lunch.start)) continue;
      if (kind === "dinner" && deadlineMinutes !== null && deadlineMinutes < dinner.start) continue;
      if (kind === "dinner" && lastDeparture < dinner.start - 120) continue;
      // Lunch anchors on the stop the traveller is at (or has most recently
      // reached) inside lunch hours — never a stop the route only reaches
      // after the window, which would put the meal row after a later visit.
      const unwrappedArrival = (stop: BuiltPlanStop) => {
        const value = clockMinutes(stop.arrival);
        if (value === null) return Number.MAX_SAFE_INTEGER;
        return value < firstArrival ? value + 1440 : value;
      };
      const anchor = kind === "lunch"
        ? [...day.stops].filter((stop) => unwrappedArrival(stop) <= lunch.end).at(-1) ?? day.stops[0]
        : day.stops.at(-1)!;
      const anchorArrival = clockMinutes(anchor.arrival) ?? lunchAnchorMinutes;
      const displayMinutes = kind === "lunch"
        ? Math.min(Math.max(lunchAnchorMinutes, anchorArrival), lunch.end)
        : Math.max(dinner.start, Math.min(lastDeparture, dinner.end));
      // 「動線上」を名乗る以上、検索の中心は食事時刻に旅行者が実際にいる
      // 地点に置く: 滞在中ならその場所、移動中ならその区間の中間点、
      // 最終地点を出た後ならホテルへの帰路の中間点。アンカー1点に候補が
      // 固まる見え方を避ける。
      const positionAtMealTime = (minutes: number): { latitude: number; longitude: number } => {
        for (let index = 0; index < day.stops.length; index += 1) {
          const stopArrival = clockMinutes(day.stops[index].arrival);
          const stopDeparture = clockMinutes(day.stops[index].departure);
          if (stopArrival !== null && minutes < stopArrival) {
            const previous = index > 0 ? day.stops[index - 1].stop : day.startBase;
            const current = day.stops[index].stop;
            return previous
              ? { latitude: (previous.latitude + current.latitude) / 2, longitude: (previous.longitude + current.longitude) / 2 }
              : { latitude: current.latitude, longitude: current.longitude };
          }
          if (stopDeparture !== null && minutes <= stopDeparture) {
            const current = day.stops[index].stop;
            return { latitude: current.latitude, longitude: current.longitude };
          }
        }
        const lastStop = day.stops.at(-1)!.stop;
        const home = day.endBase;
        return home
          ? { latitude: (lastStop.latitude + home.latitude) / 2, longitude: (lastStop.longitude + home.longitude) / 2 }
          : { latitude: lastStop.latitude, longitude: lastStop.longitude };
      };
      const mealPosition = positionAtMealTime(displayMinutes);
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
        latitude: mealPosition.latitude,
        longitude: mealPosition.longitude,
        window: kind === "lunch"
          ? `${clock(lunch.start)}–${clock(lunch.end)}`
          : `${clock(dinner.start)}–${clock(dinner.end)}`,
        displayTime: clock(displayMinutes),
        probeTime: clock(displayMinutes),
        rationale,
        queryIdeas: foodIdeasForArea(anchor.stop.area, locale, destination),
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

type GeoPoint = { latitude: number; longitude: number };

export type HotelRoutePoint = GeoPoint;

export type HotelRouteContext = {
  latitude: number;
  longitude: number;
  area: string;
  routePoints: HotelRoutePoint[];
  spreadKm: number;
};

function meanPoint(points: GeoPoint[]): GeoPoint | null {
  if (points.length === 0) return null;
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

function geoDistanceKm(from: GeoPoint, to: GeoPoint) {
  return straightLineDistanceKm(from as RouteStop, to as RouteStop);
}

/*
 * Geometric median: the point that minimizes the sum of distances to every
 * input. Unlike a mean (and the old "pull halfway to the farthest stop"
 * heuristic), one distant excursion cannot drag the hotel away from the days
 * where the traveller spends most of the trip.
 */
export function balancedGeoCenter(points: GeoPoint[]): GeoPoint | null {
  let current = meanPoint(points);
  if (!current) return null;
  if (points.length <= 2) return current;

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const coincident = points.find((point) => geoDistanceKm(current!, point) < 0.001);
    if (coincident) return { latitude: coincident.latitude, longitude: coincident.longitude };
    let latitude = 0;
    let longitude = 0;
    let weightTotal = 0;
    for (const point of points) {
      const weight = 1 / Math.max(0.001, geoDistanceKm(current, point));
      latitude += point.latitude * weight;
      longitude += point.longitude * weight;
      weightTotal += weight;
    }
    const next = { latitude: latitude / weightTotal, longitude: longitude / weightTotal };
    if (geoDistanceKm(current, next) < 0.001) return next;
    current = next;
  }
  return current;
}

function maximumPairDistanceKm(points: GeoPoint[]) {
  let maximum = 0;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      maximum = Math.max(maximum, geoDistanceKm(points[left], points[right]));
    }
  }
  return maximum;
}

/*
 * One route point per day gives every travel day one vote, regardless of how
 * many POIs were entered that day. Candidate hotels can then be compared
 * against the whole trip rather than only against one synthetic coordinate.
 */
export function hotelRouteContextForDraft(plan: BuiltTripPlan): HotelRouteContext | null {
  const routePoints = plan.days
    .map((day) => balancedGeoCenter(day.stops.map(({ stop }) => stop)))
    .filter((point): point is GeoPoint => point !== null);
  const center = balancedGeoCenter(routePoints);
  if (!center) return null;
  const scheduled = plan.days.flatMap((day) => day.stops.map(({ stop }) => stop));
  const nearest = [...scheduled].sort((left, right) => geoDistanceKm(center, left) - geoDistanceKm(center, right))[0];
  return {
    latitude: center.latitude,
    longitude: center.longitude,
    area: nearest?.area ?? "",
    routePoints,
    spreadKm: maximumPairDistanceKm(routePoints),
  };
}

export function hotelAnchorForDraft(plan: BuiltTripPlan): { latitude: number; longitude: number; area: string } | null {
  const context = hotelRouteContextForDraft(plan);
  return context ? { latitude: context.latitude, longitude: context.longitude, area: context.area } : null;
}

function airportStop(airport: DestinationAirport, locale: Locale): RouteStop {
  return {
    id: `airport-${airport.code.toLowerCase()}`,
    name: locale === "ja" ? airport.names.ja : airport.names.en,
    area: airport.code,
    latitude: airport.latitude,
    longitude: airport.longitude,
    sourceUrl: airport.sourceUrl,
    verifiedAt: "2026-07-18",
    confidence: "medium",
    planningDurationMinutes: 0,
    isAnchor: true,
  };
}

/*
 * The airport transfer starts as the destination profile's country-wide
 * estimate and is replaced by the measured Google route for THIS hotel the
 * moment the prefetch has one. The measured key mirrors the ids the prefetch
 * uses for airport legs, and the mode consulted first matches the mode the
 * prefetch actually requested for this trip.
 */
function measuredAirportTransferMinutes(
  context: TripPlannerContext,
  destination: Destination,
  airportStopId: string,
  baseId: string | undefined,
  direction: "arrival" | "departure",
) {
  if (!baseId) return null;
  const key = direction === "arrival"
    ? routeLegKey(airportStopId, baseId)
    : routeLegKey(baseId, airportStopId);
  const preferDriving = context.travelPreference === "car" || destination.mobility === "car_first";
  const preferred = preferDriving ? context.liveDrivingMinutes?.[key] : context.liveTransitMinutes?.[key];
  const fallback = preferDriving ? context.liveTransitMinutes?.[key] : context.liveDrivingMinutes?.[key];
  const minutes = preferred ?? fallback;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes)
    : null;
}

function measuredAirportTransferCount(
  context: TripPlannerContext,
  destination: Destination,
  airportStopId: string,
  baseId: string | undefined,
  direction: "arrival" | "departure",
) {
  if (!baseId || context.travelPreference === "car" || destination.mobility === "car_first") return null;
  const key = direction === "arrival"
    ? routeLegKey(airportStopId, baseId)
    : routeLegKey(baseId, airportStopId);
  const count = context.liveTransitTransferCounts?.[key];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 100
    ? count
    : null;
}

function buildAirportConstraints(
  context: TripPlannerContext,
  base: TripBase | null,
  locale: Locale,
  destination: Destination,
) {
  const constraints: AirportConstraint[] = [];
  const flightKind = context.flightKind ?? "international";
  // An airport code that is not on this destination's list simply does not
  // apply: a stale HND left over from a Japan trip must not squeeze a Swiss day.
  const transitMode = destination.mobility === "car_first" ? "driving" : "transit";
  const arrival = destinationAirport(destination, context.arrivalAirport);
  const arrivalTime = clockMinutes(context.arrivalTime);
  if (arrival && arrivalTime !== null) {
    const airport = airportStop(arrival, locale);
    const measuredTransferMinutes = measuredAirportTransferMinutes(context, destination, airport.id, base?.id, "arrival");
    const transferCount = measuredAirportTransferCount(context, destination, airport.id, base?.id, "arrival");
    const comparison = compareAirportOptions({
      destination,
      direction: "arrival",
      flightKind,
      locale: locale === "ja" ? "ja" : "en",
      options: [{
        id: "selected-arrival",
        airportCode: arrival.code,
        scheduledLocalTime: clock(arrivalTime),
        ...(measuredTransferMinutes === null ? {} : { transferMinutes: measuredTransferMinutes }),
      }],
    }).options[0];
    if (comparison) constraints.push({
      direction: "arrival",
      airport: arrival.code,
      flightTime: clock(arrivalTime),
      cityTime: comparison.cityBoundaryTime,
      cityTimeDayOffset: comparison.cityDayOffset,
      airportMinutes: comparison.processingMinutes,
      transferMinutes: comparison.transferMinutes,
      transferCount,
      sourceUrl: arrival.sourceUrl,
      googleMapsUrl: base ? buildGoogleMapsUrl([airport, base], transitMode) : null,
    });
  }

  const departure = destinationAirport(destination, context.departureAirport);
  const departureTime = clockMinutes(context.departureTime);
  if (departure && departureTime !== null) {
    const airport = airportStop(departure, locale);
    const measuredTransferMinutes = measuredAirportTransferMinutes(context, destination, airport.id, base?.id, "departure");
    const transferCount = measuredAirportTransferCount(context, destination, airport.id, base?.id, "departure");
    const comparison = compareAirportOptions({
      destination,
      direction: "departure",
      flightKind,
      locale: locale === "ja" ? "ja" : "en",
      options: [{
        id: "selected-departure",
        airportCode: departure.code,
        scheduledLocalTime: clock(departureTime),
        ...(measuredTransferMinutes === null ? {} : { transferMinutes: measuredTransferMinutes }),
      }],
    }).options[0];
    if (comparison) constraints.push({
      direction: "departure",
      airport: departure.code,
      flightTime: clock(departureTime),
      cityTime: comparison.cityBoundaryTime,
      cityTimeDayOffset: comparison.cityDayOffset,
      airportMinutes: comparison.processingMinutes,
      transferMinutes: comparison.transferMinutes,
      transferCount,
      sourceUrl: departure.sourceUrl,
      googleMapsUrl: base ? buildGoogleMapsUrl([base, airport], transitMode) : null,
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
  timeOfDay: null,
  isReservation: false,
  stayMinutes: null,
};

function applyFixedDays(
  clusters: RouteStop[][],
  constraints: Map<string, WishlistStopConstraint>,
) {
  const assigned = clusters.map((cluster) => [...cluster]);
  const originalDayByStop = new Map(clusters.flatMap((cluster, dayIndex) => (
    cluster.map((stop) => [stop.id, dayIndex] as const)
  )));
  for (const [stopId, constraint] of constraints) {
    if (constraint.fixedDay === null || constraint.fixedDay < 1 || constraint.fixedDay > assigned.length) continue;
    let stop: RouteStop | undefined;
    for (const cluster of assigned) {
      const index = cluster.findIndex((candidate) => candidate.id === stopId);
      if (index >= 0) [stop] = cluster.splice(index, 1);
    }
    if (stop) assigned[constraint.fixedDay - 1].push(stop);
  }
  const stopCount = assigned.reduce((total, cluster) => total + cluster.length, 0);
  const targetSize = assigned.length > 0 ? Math.ceil(stopCount / assigned.length) : 0;
  // Moving a booking onto its promised day must not leave the geographically
  // seeded ordinary visits piled onto that same day. Rehome only non-fixed
  // visits, preferring their original cluster and then the smallest/best-fit
  // cluster. Fixed visits are never moved to make the counts look balanced.
  for (let dayIndex = 0; dayIndex < assigned.length; dayIndex += 1) {
    while (assigned[dayIndex].length > targetSize) {
      const movable = assigned[dayIndex].filter((stop) => (constraints.get(stop.id)?.fixedDay ?? null) === null);
      const destinations = assigned
        .map((cluster, index) => ({ cluster, index }))
        .filter(({ cluster, index }) => index !== dayIndex && cluster.length < targetSize);
      if (movable.length === 0 || destinations.length === 0) break;
      const choice = movable.flatMap((stop) => destinations.map((destination) => ({
        stop,
        destination,
        original: originalDayByStop.get(stop.id),
        distance: clusterDistanceKm(stop, destination.cluster),
      }))).sort((left, right) => (
        Number(left.destination.index !== left.original) - Number(right.destination.index !== right.original)
        || left.destination.cluster.length - right.destination.cluster.length
        || left.distance - right.distance
        || left.stop.id.localeCompare(right.stop.id)
        || left.destination.index - right.destination.index
      ))[0];
      assigned[dayIndex] = assigned[dayIndex].filter((stop) => stop.id !== choice.stop.id);
      assigned[choice.destination.index].push(choice.stop);
    }
  }
  return assigned;
}

function hasUsableOpeningWindow(stop: RouteStop, windows: VisitWindow[] | undefined) {
  if (windows === undefined) return null;
  return windows.some((window) => (
    Number.isFinite(window.openMinutes)
    && Number.isFinite(window.closeMinutes)
    && Math.min(
      window.closeMinutes - stop.planningDurationMinutes,
      window.lastEntryMinutes ?? Number.POSITIVE_INFINITY,
    ) >= window.openMinutes
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

/*
 * Opening-hour results are fetched by calendar day from tripStartDate. When a
 * late flight reaches the city after midnight, activity Day 1 belongs to the
 * next calendar day, so its availability is source index 1 (not index 0).
 * Re-index once here and keep every later scheduling function day-local.
 */
function activityDayOpeningWindows(
  availability: Record<string, Record<number, VisitWindow[]>>,
  calendarDayOffset: number,
) {
  if (calendarDayOffset === 0) return availability;
  return Object.fromEntries(Object.entries(availability).map(([stopId, windowsByCalendarDay]) => [
    stopId,
    Object.fromEntries(Object.entries(windowsByCalendarDay).flatMap(([rawIndex, windows]) => {
      const activityDayIndex = Number(rawIndex) - calendarDayOffset;
      return Number.isInteger(activityDayIndex) && activityDayIndex >= 0
        ? [[activityDayIndex, windows] as const]
        : [];
    })),
  ]));
}

type TravelInputs = {
  preference: TravelPreference;
  /** Which mode the destination actually rewards when nothing else decides. */
  mobility?: MobilityProfile;
  transit?: Record<string, number>;
  /** Legs where the provider answered that no transit route exists. */
  transitAbsent?: Record<string, boolean>;
  transfers?: Record<string, number>;
  walking?: Record<string, number>;
  driving?: Record<string, number>;
  overrides?: Record<string, TransportMode>;
  bufferMinutes?: number;
  maxWalkingMinutesPerLeg?: number;
  maxTransfersPerLeg?: number;
};

const defaultTravel: TravelInputs = { preference: "auto", bufferMinutes: 10 };

function knownTransferCount(from: RouteStop, to: RouteStop, travel: TravelInputs) {
  if (routeAccessEndpointsForLeg(from, to).status !== "direct") return null;
  const count = travel.transfers?.[routeLegKey(from.id, to.id)];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 100
    ? count
    : null;
}

function routeComparison(from: RouteStop, to: RouteStop, travel: TravelInputs) {
  const key = routeLegKey(from.id, to.id);
  const mobility = travel.mobility ?? "transit_first";
  const access = routeAccessEndpointsForLeg(from, to);
  // A provider result ending at an access station is useful route evidence,
  // but it is not the full summit journey. Keep the solver's duration
  // conditional/estimated until the mountain continuation is modelled.
  const fullLegProviderEvidence = access.status === "direct";
  const providerComparison = applyLiveTransitMinutes(
    estimateTravelOptions(from, to, travel.preference, mobility),
    fullLegProviderEvidence ? travel.transit?.[key] : undefined,
    fullLegProviderEvidence ? travel.walking?.[key] : undefined,
    fullLegProviderEvidence ? travel.driving?.[key] : undefined,
    travel.preference,
    mobility,
    fullLegProviderEvidence && travel.transitAbsent?.[key] === true,
  );
  const unfilteredComparison = fullLegProviderEvidence ? providerComparison : {
    options: providerComparison.options.map((option) => ({ ...option, source: "estimate" as const })),
    fastest: { ...providerComparison.fastest, source: "estimate" as const },
    recommended: { ...providerComparison.recommended, source: "estimate" as const },
  };
  const allowedModes = allowedTransportModesForLeg(from, to);
  const allowedOptions = unfilteredComparison.options.filter((option) => allowedModes.includes(option.mode));
  // Curated access policies fail closed. Their current P0 policy always keeps
  // transit, but preserve the unfiltered comparison if a malformed future
  // policy were to remove every supported mode.
  const comparison = allowedOptions.length > 0 && allowedOptions.length !== unfilteredComparison.options.length
    ? {
        options: allowedOptions,
        fastest: allowedOptions.reduce((best, option) => option.minutes < best.minutes ? option : best),
        recommended: allowedOptions.reduce((best, option) => option.minutes < best.minutes ? option : best),
      }
    : unfilteredComparison;
  // A per-leg pick beats every automatic rule; the schedule, map and Google
  // measurements all follow it.
  const overrideMode = travel.overrides?.[key];
  const overridden = overrideMode ? comparison.options.find((option) => option.mode === overrideMode) : undefined;
  if (overridden) return { ...comparison, recommended: overridden };
  const maxWalk = travel.maxWalkingMinutesPerLeg;
  const maxTransfers = travel.maxTransfersPerLeg;
  const transferCount = knownTransferCount(from, to, travel);
  let recommended = comparison.recommended;
  if (typeof maxWalk === "number" && recommended.mode === "walk" && recommended.minutes > maxWalk) {
    const alternative = comparison.options
      .filter((option) => option.mode !== "walk")
      .sort((left, right) => {
        const leftBreaksTransfers = left.mode === "transit" && transferCount !== null && typeof maxTransfers === "number" && transferCount > maxTransfers;
        const rightBreaksTransfers = right.mode === "transit" && transferCount !== null && typeof maxTransfers === "number" && transferCount > maxTransfers;
        return Number(leftBreaksTransfers) - Number(rightBreaksTransfers)
          || left.minutes - right.minutes
          || left.mode.localeCompare(right.mode);
      })[0];
    if (alternative) recommended = alternative;
  }
  if (typeof maxTransfers === "number" && transferCount !== null && transferCount > maxTransfers && recommended.mode === "transit") {
    const alternative = comparison.options
      .filter((option) => option.mode !== "transit")
      .sort((left, right) => {
        const leftBreaksWalking = left.mode === "walk" && typeof maxWalk === "number" && left.minutes > maxWalk;
        const rightBreaksWalking = right.mode === "walk" && typeof maxWalk === "number" && right.minutes > maxWalk;
        return Number(leftBreaksWalking) - Number(rightBreaksWalking)
          || left.minutes - right.minutes
          || left.mode.localeCompare(right.mode);
      })[0];
    if (alternative) recommended = alternative;
  }
  return recommended === comparison.recommended ? comparison : { ...comparison, recommended };
}

function endpointAsRouteStop(original: RouteStop, endpoint: PoiRouteEndpoint): RouteStop {
  return endpoint.kind === "poi" ? original : {
    ...original,
    id: endpoint.id,
    name: endpoint.name,
    latitude: endpoint.coordinate.latitude,
    longitude: endpoint.coordinate.longitude,
  };
}

function accessMetadataForLeg(from: RouteStop, to: RouteStop) {
  const access = routeAccessEndpointsForLeg(from, to);
  if (access.status === "direct") return {};
  return {
    routeEvidenceScope: access.status,
    accessAssumptions: access.assumptions,
  } as const;
}

function googleMapsUrlsForLeg(from: RouteStop, to: RouteStop): Record<TransportMode, string> {
  const access = routeAccessEndpointsForLeg(from, to);
  if (access.status === "conditional" || !access.origin || !access.destination) {
    return { walk: "", transit: "", taxi: "" };
  }
  if (access.status === "access_node") {
    const origin = endpointAsRouteStop(from, access.origin);
    const destination = endpointAsRouteStop(to, access.destination);
    return {
      walk: "",
      transit: buildGoogleMapsUrl([origin, destination], "transit"),
      taxi: "",
    };
  }
  return {
    walk: buildGoogleMapsUrl([from, to], "walking"),
    transit: buildGoogleMapsUrl([from, to], "transit"),
    taxi: buildGoogleMapsUrl([from, to], "driving"),
  };
}

function routeTravelMinutes(from: RouteStop, to: RouteStop, travel: TravelInputs) {
  return routeComparison(from, to, travel).recommended.minutes + (travel.bufferMinutes ?? 10);
}

function clusterDistanceKm(stop: RouteStop, cluster: RouteStop[]) {
  if (cluster.length === 0) return Number.MAX_SAFE_INTEGER;
  const centroid = {
    ...stop,
    latitude: cluster.reduce((sum, member) => sum + member.latitude, 0) / cluster.length,
    longitude: cluster.reduce((sum, member) => sum + member.longitude, 0) / cluster.length,
  };
  return straightLineDistanceKm(stop, centroid);
}

function fitVisitToWindow(cursor: number, duration: number, windows: VisitWindow[] | undefined) {
  if (windows === undefined) return { start: cursor, status: "unknown" as const };
  // Google returned a schedule for this weekday and it is empty: the place is
  // listed as closed on the planned day. This is a louder fact than a mere
  // timing conflict and gets its own status.
  if (windows.length === 0) return { start: cursor, status: "closed_day" as const };
  let blockedByLastEntry = false;
  for (const window of windows) {
    if (!Number.isFinite(window.openMinutes) || !Number.isFinite(window.closeMinutes) || window.closeMinutes <= window.openMinutes) continue;
    const start = Math.max(cursor, window.openMinutes);
    if (start + duration > window.closeMinutes) continue;
    if (window.lastEntryMinutes !== undefined && start > window.lastEntryMinutes) {
      blockedByLastEntry = true;
      continue;
    }
    return { start, status: "verified_open" as const };
  }
  if (blockedByLastEntry) return { start: cursor, status: "last_entry_conflict" as const };
  return { start: cursor, status: "conflict" as const };
}

function distanceToWindow(cursor: number, window: MealWindow) {
  if (cursor < window.start) return window.start - cursor;
  return Math.max(0, cursor - window.end);
}

type ScheduleOrderScore = readonly [
  hardViolationCount: number,
  hardViolationMinutes: number,
  softPreferencePenalty: number,
  travelMinutes: number,
  elapsedMinutes: number,
  deterministicTieBreak: string,
];

function compareScheduleOrderScore(left: ScheduleOrderScore, right: ScheduleOrderScore) {
  for (let index = 0; index < left.length - 1; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return left[5].localeCompare(right[5]);
}

function scheduleOrderScore(
  ordered: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  earlyVisitStopIds: Set<string>,
  foodStopIds: Set<string>,
  openingWindows: Record<string, VisitWindow[]>,
  meals: { lunch: MealWindow; dinner: MealWindow },
  travelInputs: TravelInputs = defaultTravel,
) {
  let cursor = startMinutes;
  let hardViolationCount = 0;
  let lateMinutes = 0;
  let travelMinutes = 0;
  let earlyVisitPenalty = 0;
  if (base && ordered[0]) {
    // routeTravelMinutes already includes the transfer buffer once, matching
    // the real clock in buildDay.
    const travel = routeTravelMinutes(base, ordered[0], travelInputs);
    travelMinutes += travel;
    cursor += travel;
  }
  ordered.forEach((stop, index) => {
    const constraint = constraints.get(stop.id);
    const fixed = constraint?.fixedTimeMinutes;
    if (fixed !== null && fixed !== undefined) {
      const fixedLateness = Math.max(0, cursor - fixed);
      if (fixedLateness > 0) hardViolationCount += 1;
      lateMinutes += fixedLateness;
      cursor = Math.max(cursor, fixed);
    }
    const fitted = fitVisitToWindow(cursor, stop.planningDurationMinutes, openingWindows[stop.id]);
    if (fitted.status === "conflict" || fitted.status === "closed_day" || fitted.status === "last_entry_conflict") {
      hardViolationCount += 1;
      lateMinutes += 24 * 60;
    }
    else cursor = fitted.start;
    const wish = constraint?.timeOfDay ?? null;
    if (earlyVisitStopIds.has(stop.id) && wish !== "evening" && wish !== "night") {
      // Explicit sell-out, early-cutoff or queue evidence is a soft preference,
      // never a replacement for a reservation or verified opening time. A
      // written "at sunset" outranks it: the user's wish wins over a nudge.
      earlyVisitPenalty += index * 90 + Math.max(0, cursor - 12 * 60);
    }
    // A written time-of-day wish ("at sunset", "朝イチ") biases the order the
    // same soft way: sunset stops drift late, morning stops drift early.
    if (wish === "morning") {
      earlyVisitPenalty += index * 90 + Math.max(0, cursor - 12 * 60);
    } else if (wish === "evening") {
      earlyVisitPenalty += Math.max(0, 16 * 60 - cursor);
    } else if (wish === "night") {
      earlyVisitPenalty += Math.max(0, 18 * 60 - cursor);
    }
    // An unpinned meal stop belongs to a meal window, not to 9:40 in the
    // morning; penalize the distance to the nearest lunch or dinner slot.
    if (fixed == null && foodStopIds.has(stop.id)) {
      // Meal hours are local: 21:00 is a normal dinner in Madrid and a closed
      // kitchen in Zermatt, so the window comes from the destination.
      earlyVisitPenalty += Math.min(distanceToWindow(cursor, meals.lunch), distanceToWindow(cursor, meals.dinner));
    }
    cursor += stop.planningDurationMinutes;
    if (ordered[index + 1]) {
      const travel = routeTravelMinutes(stop, ordered[index + 1], travelInputs);
      travelMinutes += travel;
      cursor += travel;
    }
  });
  if (base && ordered.at(-1)) {
    const travel = routeComparison(ordered.at(-1)!, base, travelInputs).recommended.minutes;
    travelMinutes += travel;
    cursor += travel;
  }
  // Keep hard constraints in their own tuple slots. A very large soft score
  // must never numerically overflow into (or outweigh) one booking/opening
  // violation. The final Place-ID key makes exact ties deterministic.
  return [
    hardViolationCount,
    lateMinutes,
    earlyVisitPenalty,
    travelMinutes,
    cursor - startMinutes,
    ordered.map((stop) => stop.id).join("\u0000"),
  ] as const;
}

function orderForReservations(
  stops: RouteStop[],
  base: TripBase | null,
  startMinutes: number,
  constraints: Map<string, WishlistStopConstraint>,
  earlyVisitStopIds: Set<string>,
  foodStopIds: Set<string>,
  openingWindows: Record<string, VisitWindow[]>,
  meals: { lunch: MealWindow; dinner: MealWindow },
  travelInputs: TravelInputs = defaultTravel,
  lockedOrder: string[] = [],
) {
  if (lockedOrder.length > 0) {
    const rank = new Map(lockedOrder.map((stopId, index) => [stopId, index]));
    const listed = stops
      .filter((stop) => rank.has(stop.id))
      .sort((left, right) => rank.get(left.id)! - rank.get(right.id)!);
    // A partially edited legacy itinerary can contain a new, unpinned place.
    // Keep every locked visit in its exact relative order and append only the
    // genuinely new visits in a deterministic order; never silently interleave
    // them between locked visits.
    const unlisted = stops
      .filter((stop) => !rank.has(stop.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    return [...listed, ...unlisted];
  }
  const geographic = base ? optimizeFromBase(stops, base) : optimizeKnownStopOrder(stops, false);
  const hasTimedConstraint = stops.some((stop) => constraints.get(stop.id)?.fixedTimeMinutes != null);
  const hasEarlyPreference = stops.some((stop) => earlyVisitStopIds.has(stop.id));
  const hasOpeningConstraint = stops.some((stop) => openingWindows[stop.id] !== undefined);
  const hasTimeWish = stops.some((stop) => constraints.get(stop.id)?.timeOfDay != null || foodStopIds.has(stop.id));
  if (stops.length <= 1 || (!hasTimedConstraint && !hasEarlyPreference && !hasOpeningConstraint && !hasTimeWish)) return geographic;
  // 8! orderings repeated across up to fourteen TripFit scenarios can block
  // the result UI for close to a second. Seven remains exact; larger days use
  // the stable constraint-aware heuristic below.
  if (stops.length > 7) {
    const urgencyOrder = [...stops].sort((a, b) => {
      const earlyDifference = Number(earlyVisitStopIds.has(b.id)) - Number(earlyVisitStopIds.has(a.id));
      if (earlyDifference !== 0) return earlyDifference;
      const aTime = constraints.get(a.id)?.fixedTimeMinutes;
      const bTime = constraints.get(b.id)?.fixedTimeMinutes;
      if (aTime !== null && aTime !== undefined || bTime !== null && bTime !== undefined) {
        return (aTime ?? Number.MAX_SAFE_INTEGER) - (bTime ?? Number.MAX_SAFE_INTEGER);
      }
      const aClose = Math.min(...(openingWindows[a.id] ?? []).map((window) => window.lastEntryMinutes ?? window.closeMinutes), Number.MAX_SAFE_INTEGER);
      const bClose = Math.min(...(openingWindows[b.id] ?? []).map((window) => window.lastEntryMinutes ?? window.closeMinutes), Number.MAX_SAFE_INTEGER);
      if (aClose !== bClose) return aClose - bClose;
      return a.id.localeCompare(b.id);
    });

    const inserted: RouteStop[] = [];
    for (const stop of urgencyOrder) {
      let bestInsertion: RouteStop[] | null = null;
      let bestInsertionScore: ScheduleOrderScore | null = null;
      for (let position = 0; position <= inserted.length; position += 1) {
        const candidate = [...inserted.slice(0, position), stop, ...inserted.slice(position)];
        const score = scheduleOrderScore(candidate, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
        if (bestInsertionScore === null || compareScheduleOrderScore(score, bestInsertionScore) < 0) {
          bestInsertion = candidate;
          bestInsertionScore = score;
        }
      }
      inserted.splice(0, inserted.length, ...(bestInsertion ?? [stop]));
    }

    let best = [geographic, urgencyOrder, inserted].reduce((current, candidate) => {
      const currentScore = scheduleOrderScore(current, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
      const candidateScore = scheduleOrderScore(candidate, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
      return compareScheduleOrderScore(candidateScore, currentScore) < 0 ? candidate : current;
    });
    let bestScore = scheduleOrderScore(best, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
    const maxPasses = Math.min(6, stops.length);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let improved: RouteStop[] | null = null;
      let improvedScore = bestScore;
      for (let from = 0; from < best.length; from += 1) {
        const without = [...best.slice(0, from), ...best.slice(from + 1)];
        for (let to = 0; to <= without.length; to += 1) {
          const candidate = [...without.slice(0, to), best[from], ...without.slice(to)];
          const score = scheduleOrderScore(candidate, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
          if (compareScheduleOrderScore(score, improvedScore) < 0) {
            improved = candidate;
            improvedScore = score;
          }
        }
      }
      if (!improved) break;
      best = improved;
      bestScore = improvedScore;
    }
    return best;
  }

  let best = geographic;
  let bestScore = scheduleOrderScore(best, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
  const used = new Set<string>();
  const candidate: RouteStop[] = [];
  const visit = () => {
    if (candidate.length === stops.length) {
      const score = scheduleOrderScore(candidate, base, startMinutes, constraints, earlyVisitStopIds, foodStopIds, openingWindows, meals, travelInputs);
      if (compareScheduleOrderScore(score, bestScore) < 0) {
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
  startBase: TripBase | null,
  endBase: TripBase | null,
  airportConstraints: AirportConstraint[],
  constraints: Map<string, WishlistStopConstraint>,
  earlyVisitStopIds: Set<string>,
  foodStopIds: Set<string>,
  openingWindows: Record<string, VisitWindow[]>,
  destination: Destination,
  requestedStart?: string,
  startDate?: string,
  travelInputs: TravelInputs = defaultTravel,
  dayEndTarget?: string,
  lockedOrder: string[] = [],
): BuiltPlanDay {
  const arrivalConstraint = index === 0 ? airportConstraints.find((constraint) => constraint.direction === "arrival") : null;
  const departureConstraint = index === dayCount - 1 ? airportConstraints.find((constraint) => constraint.direction === "departure") : null;
  // Only a real arrival flight floors the start; without one an early-riser
  // 8:00 start is a legitimate choice. The calendar rollover lives in the
  // day's date, not in this day-local clock; adding 1440 here would compare a
  // next-day 02:00 arrival with opening hours as if it were 26:00.
  const arrivalReadyMinutes = arrivalConstraint
    ? clockMinutes(arrivalConstraint.cityTime)!
    : 0;
  const requestedStartMinutes = clockMinutes(requestedStart) ?? 9 * 60;
  const startMinutes = Math.max(requestedStartMinutes, arrivalReadyMinutes);
  const routeOrdered = orderForReservations(
    stops,
    startBase,
    startMinutes,
    constraints,
    earlyVisitStopIds,
    foodStopIds,
    openingWindows,
    destination.meals,
    // The prefetch covers the selected draft legs, not an all-pairs matrix.
    // Keep its order stable and use measured durations only for the clock.
    travelInputs,
    lockedOrder,
  );
  // A day-consuming stop (theme park class) opens the day: it needs the
  // morning far more than the route needs a perfect loop. A booked time or an
  // explicit day-order pin still wins.
  const dayAnchors = lockedOrder.length > 0 ? [] : routeOrdered.filter((stop) => (
    isDayAnchorStay(stop.planningDurationMinutes) && constraints.get(stop.id)?.fixedTimeMinutes == null
  ));
  const ordered = dayAnchors.length > 0
    ? [...dayAnchors, ...routeOrdered.filter((stop) => !dayAnchors.some((anchor) => anchor.id === stop.id))]
    : routeOrdered;
  const date = addDaysToIsoDate(startDate, index);
  const legs = ordered.slice(0, -1).map((from, stopIndex): BuiltPlanLeg => {
    const to = ordered[stopIndex + 1];
    const comparison = routeComparison(from, to, travelInputs);
    const walkingMinutes = comparison.options.find((option) => option.mode === "walk")?.minutes ?? 0;
    const walkingLimitExceededMinutes = Math.max(0, walkingMinutes - (travelInputs.maxWalkingMinutesPerLeg ?? 30));
    return {
      from,
      to,
      comparison,
      googleMapsUrls: googleMapsUrlsForLeg(from, to),
      isLocalMealPause: false,
      walkingMinutes,
      walkingLimitExceededMinutes,
      transferCount: comparison.recommended.mode === "transit"
        ? knownTransferCount(from, to, travelInputs)
        : null,
      ...accessMetadataForLeg(from, to),
    };
  });
  let cursor = startMinutes;
  let hotelTravelMinutes: number | null = null;
  let hotelOutboundMinutes: number | null = null;
  let hotelInboundMinutes: number | null = null;
  let hotelOutboundMode: TransportMode | null = null;
  let hotelInboundMode: TransportMode | null = null;
  let hotelOutboundSource: "estimate" | "live" | null = null;
  let hotelInboundSource: "estimate" | "live" | null = null;
  let hotelOutboundTransferCount: number | null = null;
  let hotelInboundTransferCount: number | null = null;
  let hotelOutboundRouteEvidenceScope: "access_node" | "conditional" | undefined;
  let hotelInboundRouteEvidenceScope: "access_node" | "conditional" | undefined;
  let hotelOutboundAccessAssumptions: readonly PoiAccessAssumption[] | undefined;
  let hotelInboundAccessAssumptions: readonly PoiAccessAssumption[] | undefined;
  const transferBufferMinutes = travelInputs.bufferMinutes ?? 10;
  if (startBase && ordered[0]) {
    const access = accessMetadataForLeg(startBase, ordered[0]);
    const outbound = routeComparison(startBase, ordered[0], travelInputs).recommended;
    cursor += outbound.minutes + transferBufferMinutes;
    hotelTravelMinutes = outbound.minutes;
    hotelOutboundMinutes = outbound.minutes;
    hotelOutboundMode = outbound.mode;
    hotelOutboundSource = outbound.source ?? "estimate";
    hotelOutboundTransferCount = outbound.mode === "transit"
      ? knownTransferCount(startBase, ordered[0], travelInputs)
      : null;
    hotelOutboundRouteEvidenceScope = access.routeEvidenceScope;
    hotelOutboundAccessAssumptions = access.accessAssumptions;
  }
  const scheduledStops = ordered.map((stop, stopIndex): BuiltPlanStop => {
    const constraint = constraints.get(stop.id) ?? defaultConstraint;
    if (constraint.fixedTimeMinutes !== null) cursor = Math.max(cursor, constraint.fixedTimeMinutes);
    // "At sunset" / "at night" written by the user floors the visit into the
    // evening; a written clock time still wins over the vaguer wish.
    if (constraint.fixedTimeMinutes === null && constraint.timeOfDay === "evening") cursor = Math.max(cursor, 16 * 60);
    if (constraint.fixedTimeMinutes === null && constraint.timeOfDay === "night") cursor = Math.max(cursor, 18 * 60);
    const opening = fitVisitToWindow(cursor, stop.planningDurationMinutes, openingWindows[stop.id]);
    if (opening.status !== "conflict" && opening.status !== "closed_day") cursor = opening.start;
    const reservationLateMinutes = constraint.fixedTimeMinutes === null ? 0 : Math.max(0, cursor - constraint.fixedTimeMinutes);
    const arrival = clock(cursor);
    cursor += stop.planningDurationMinutes;
    const departure = clock(cursor);
    const leg = legs[stopIndex];
    if (leg) cursor += leg.comparison.recommended.minutes + transferBufferMinutes;
    return {
      stop,
      arrival,
      departure,
      kind: "place",
      mealKind: null,
      priority: constraint.priority,
      fixedTime: constraint.fixedTime,
      isReservation: constraint.isReservation,
      reservationLateMinutes,
      openingStatus: opening.status,
      crowd: buildCrowdOutlook(date, arrival, stop),
    };
  });
  const finishBase = endBase ?? startBase;
  if (finishBase && ordered.at(-1)) {
    const access = accessMetadataForLeg(ordered.at(-1)!, finishBase);
    const inbound = routeComparison(ordered.at(-1)!, finishBase, travelInputs).recommended;
    cursor += inbound.minutes;
    hotelTravelMinutes = (hotelTravelMinutes ?? 0) + inbound.minutes;
    hotelInboundMinutes = inbound.minutes;
    hotelInboundMode = inbound.mode;
    hotelInboundSource = inbound.source ?? "estimate";
    hotelInboundTransferCount = inbound.mode === "transit"
      ? knownTransferCount(ordered.at(-1)!, finishBase, travelInputs)
      : null;
    hotelInboundRouteEvidenceScope = access.routeEvidenceScope;
    hotelInboundAccessAssumptions = access.accessAssumptions;
  }
  const airportDeadline = departureConstraint
    ? clockMinutes(departureConstraint.cityTime)! + (departureConstraint.cityTimeDayOffset === -1 ? -1440 : 0)
    : null;
  // A curfew is a soft target for every day; a flight cutoff always wins when
  // it is earlier, because a plane does not wait.
  const curfewDeadline = clockMinutes(dayEndTarget) ?? null;
  const deadlineMinutes = airportDeadline !== null && curfewDeadline !== null
    ? Math.min(airportDeadline, curfewDeadline)
    : airportDeadline ?? curfewDeadline;
  const deadlineKind: "airport" | "curfew" | null = deadlineMinutes === null
    ? null
    : airportDeadline !== null && (curfewDeadline === null || airportDeadline <= curfewDeadline) ? "airport" : "curfew";
  const areas = [...new Set(ordered.map((stop) => stop.area))];
  const mapStops = startBase ? [startBase, ...ordered, finishBase ?? startBase] : ordered;
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
    hotelOutboundMinutes,
    hotelInboundMinutes,
    hotelOutboundMode,
    hotelInboundMode,
    hotelOutboundSource,
    hotelInboundSource,
    hotelOutboundTransferCount,
    hotelInboundTransferCount,
    ...(hotelOutboundRouteEvidenceScope ? { hotelOutboundRouteEvidenceScope } : {}),
    ...(hotelInboundRouteEvidenceScope ? { hotelInboundRouteEvidenceScope } : {}),
    ...(hotelOutboundAccessAssumptions ? { hotelOutboundAccessAssumptions } : {}),
    ...(hotelInboundAccessAssumptions ? { hotelInboundAccessAssumptions } : {}),
    startBase,
    endBase: finishBase,
    deadline: deadlineMinutes === null ? null : clock(deadlineMinutes),
    ...(deadlineMinutes !== null && deadlineMinutes < 0 ? { deadlinePreviousDay: true } : {}),
    deadlineKind,
    deadlineOverrunMinutes: deadlineMinutes === null ? 0 : Math.max(0, cursor - deadlineMinutes),
    reservationConflictCount: scheduledStops.filter((stop) => stop.reservationLateMinutes > 0).length,
    openingConflictCount: scheduledStops.filter((stop) => stop.openingStatus === "conflict" || stop.openingStatus === "closed_day" || stop.openingStatus === "last_entry_conflict").length,
    googleMapsUrl: ordered.length > 0 ? buildGoogleMapsUrl(mapStops) : null,
  };
}

const MAX_DAY_ASSIGNMENT_STOPS = 12;
const MAX_DAY_ASSIGNMENT_EVALUATIONS = 600;

type DayAssignmentScore = readonly [
  hardViolationCount: number,
  hardViolationMagnitude: number,
  overrunDayCount: number,
  totalOverrunMinutes: number,
  emptyDayCount: number,
  overloadMinutes: number,
  underfillMinutes: number,
  travelMinutes: number,
  maximumDayMinutes: number,
  loadSpreadMinutes: number,
  deterministicTieBreak: string,
];

function compareDayAssignmentScore(left: DayAssignmentScore, right: DayAssignmentScore) {
  for (let index = 0; index < left.length - 1; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return (left.at(-1) as string).localeCompare(right.at(-1) as string);
}

type DayAssignmentLimits = {
  paceCapacity: number;
  dayBudgetMinutes: number;
};

function dayAssignmentSignature(clusters: RouteStop[][]) {
  return clusters.map((cluster) => cluster.map((stop) => stop.id).sort().join("\u0000")).join("\u0001");
}

function scoreDayAssignment(
  days: BuiltPlanDay[],
  clusters: RouteStop[][],
  limits: DayAssignmentLimits,
): DayAssignmentScore {
  const openingViolations = days.reduce((sum, day) => sum + day.openingConflictCount, 0);
  const reservationViolations = days.reduce((sum, day) => sum + day.reservationConflictCount, 0);
  const reservationLateMinutes = days.reduce((sum, day) => sum + day.stops.reduce(
    (daySum, stop) => daySum + stop.reservationLateMinutes,
    0,
  ), 0);
  const overrunDays = days.filter((day) => day.deadlineOverrunMinutes > 0);
  const totalOverrunMinutes = overrunDays.reduce((sum, day) => sum + day.deadlineOverrunMinutes, 0);
  const travelMinutes = days.reduce((sum, day) => sum
    + (day.hotelTravelMinutes ?? 0)
    + day.legs.reduce((daySum, leg) => daySum + leg.comparison.recommended.minutes, 0), 0);
  const loads = days.map((day) => day.totalMinutes);
  const maximumDayMinutes = loads.length > 0 ? Math.max(...loads) : 0;
  const minimumDayMinutes = loads.length > 0 ? Math.min(...loads) : 0;
  // Emptying a day deletes its whole hotel round trip from travelMinutes, so
  // raw travel comparison actively rewards cramming every stop onto one or
  // two mega-days. When there is enough material to use every requested day,
  // an empty day is a comfort violation ranked above travel; likewise a day
  // stuffed past the pace's stop count or waking-time budget.
  const totalStops = clusters.reduce((sum, cluster) => sum + cluster.length, 0);
  const emptyDayCount = totalStops >= clusters.length
    ? clusters.filter((cluster) => cluster.length === 0).length
    : 0;
  const overloadMinutes = days.reduce((sum, day, index) => sum
    + Math.max(0, (clusters[index]?.length ?? 0) - limits.paceCapacity) * 240
    + Math.max(0, day.totalMinutes - limits.dayBudgetMinutes), 0);
  // A two-hour "day" next to a stuffed one wastes a requested day. When there
  // is more material than days, a non-empty day should carry a sensible
  // minimum of CONTENT — stay minutes, never elapsed time, so the optimizer
  // cannot "fill" a day with pointless crosstown travel. The deficit is
  // SQUARED: a linear sum is invariant under redistribution while every day
  // sits below the floor, which strands the search in 1-stop local optima;
  // the convex form makes each evening-out move strictly better. Ranked
  // below overload so spreading never creates a violation, and above travel
  // so saving one hotel transfer cannot hollow a day out again.
  const underfillFloor = Math.min(240, Math.round(limits.dayBudgetMinutes * 0.45));
  const underfillMinutes = totalStops > clusters.length
    ? clusters.reduce((sum, cluster) => {
      if (cluster.length === 0) return sum;
      const deficit = Math.max(0, underfillFloor - cluster.reduce((stay, stop) => stay + stop.planningDurationMinutes, 0));
      return sum + deficit * deficit;
    }, 0)
    : 0;
  // Hard facts and clock-window overruns are compared before any route or
  // comfort preference. An opening conflict cannot be hidden by a shorter day.
  return [
    openingViolations + reservationViolations + overrunDays.length,
    openingViolations * 24 * 60 + reservationLateMinutes + totalOverrunMinutes,
    overrunDays.length,
    totalOverrunMinutes,
    emptyDayCount,
    overloadMinutes,
    underfillMinutes,
    travelMinutes,
    maximumDayMinutes,
    maximumDayMinutes - minimumDayMinutes,
    dayAssignmentSignature(clusters),
  ];
}

/**
 * Bounded local search for the P0 input range. Geographic clustering is only
 * a seed: a long-stay cluster must not make a feasible day count look
 * impossible. Each move/swap is fully rebuilt through the same deterministic
 * clock, booking, opening-hours and route rules used by the returned plan.
 */
function optimizeDayAssignments(
  initial: RouteStop[][],
  constraints: Map<string, WishlistStopConstraint>,
  lockedDayByStop: ReadonlyMap<string, number>,
  build: (cluster: RouteStop[], dayIndex: number) => BuiltPlanDay,
  limits: DayAssignmentLimits,
) {
  const stopCount = initial.reduce((sum, cluster) => sum + cluster.length, 0);
  if (initial.length <= 1 || stopCount <= 1 || stopCount > MAX_DAY_ASSIGNMENT_STOPS) {
    return initial.map((cluster) => [...cluster]);
  }

  const scoreCache = new Map<string, DayAssignmentScore>();
  let evaluationCount = 0;
  const score = (clusters: RouteStop[][]) => {
    const signature = dayAssignmentSignature(clusters);
    const cached = scoreCache.get(signature);
    if (cached) return cached;
    if (evaluationCount >= MAX_DAY_ASSIGNMENT_EVALUATIONS) return null;
    evaluationCount += 1;
    const value = scoreDayAssignment(clusters.map((cluster, dayIndex) => build(cluster, dayIndex)), clusters, limits);
    scoreCache.set(signature, value);
    return value;
  };
  const movable = (stop: RouteStop) => (
    (constraints.get(stop.id)?.fixedDay ?? null) === null
    && !lockedDayByStop.has(stop.id)
  );
  const copy = (clusters: RouteStop[][]) => clusters.map((cluster) => [...cluster]);

  let current = copy(initial);
  let currentScore = score(current);
  if (!currentScore) return current;

  for (let pass = 0; pass < stopCount && evaluationCount < MAX_DAY_ASSIGNMENT_EVALUATIONS; pass += 1) {
    let best: RouteStop[][] | null = null;
    let bestScore: DayAssignmentScore = currentScore;
    const consider = (candidate: RouteStop[][]) => {
      const candidateScore = score(candidate);
      if (candidateScore && compareDayAssignmentScore(candidateScore, bestScore) < 0) {
        best = candidate;
        bestScore = candidateScore;
      }
    };

    // Relocation handles overloaded days and can make deliberate use of an
    // otherwise empty day. Stable ID/day ordering keeps the bounded cutoff
    // reproducible.
    for (let sourceDay = 0; sourceDay < current.length && evaluationCount < MAX_DAY_ASSIGNMENT_EVALUATIONS; sourceDay += 1) {
      const sourceStops = current[sourceDay].filter(movable).sort((left, right) => left.id.localeCompare(right.id));
      for (const stop of sourceStops) {
        for (let targetDay = 0; targetDay < current.length && evaluationCount < MAX_DAY_ASSIGNMENT_EVALUATIONS; targetDay += 1) {
          if (targetDay === sourceDay) continue;
          // No hard capacity bound here: overloadMinutes in the score tuple
          // already penalizes over-capacity days BELOW hard booking/opening
          // violations, so a relocation into a full day stays available as
          // the only repair when the receiving day's stops are locked — while
          // never winning merely to save travel minutes.
          const candidate = copy(current);
          candidate[sourceDay] = candidate[sourceDay].filter((entry) => entry.id !== stop.id);
          candidate[targetDay].push(stop);
          consider(candidate);
        }
      }
    }

    // A duration-heavy geographic cluster often needs a long/short exchange,
    // not another centroid move. Evaluate every movable cross-day pair while
    // staying inside the shared hard evaluation ceiling.
    for (let leftDay = 0; leftDay < current.length && evaluationCount < MAX_DAY_ASSIGNMENT_EVALUATIONS; leftDay += 1) {
      for (let rightDay = leftDay + 1; rightDay < current.length && evaluationCount < MAX_DAY_ASSIGNMENT_EVALUATIONS; rightDay += 1) {
        const leftStops = current[leftDay].filter(movable).sort((left, right) => left.id.localeCompare(right.id));
        const rightStops = current[rightDay].filter(movable).sort((left, right) => left.id.localeCompare(right.id));
        for (const leftStop of leftStops) {
          for (const rightStop of rightStops) {
            if (evaluationCount >= MAX_DAY_ASSIGNMENT_EVALUATIONS) break;
            const candidate = copy(current);
            candidate[leftDay] = candidate[leftDay].map((stop) => stop.id === leftStop.id ? rightStop : stop);
            candidate[rightDay] = candidate[rightDay].map((stop) => stop.id === rightStop.id ? leftStop : stop);
            consider(candidate);
          }
        }
      }
    }

    if (!best) break;
    current = best;
    currentScore = bestScore;
  }
  return current;
}

/*
 * The destination behind this plan. An explicit pick always wins. With
 * "auto" every stop that made it into the plan votes — by Google's country
 * code where there is one, otherwise by coordinate — so one mis-resolved
 * place cannot drag the whole trip to another continent.
 */
function resolveContextDestination(context: TripPlannerContext, stops: RouteStop[]): Destination {
  const choice = context.destination ?? "auto";
  if (choice !== "auto") return destinationById(choice);
  const countryById = new Map(
    [...(context.resolvedStops ?? []), ...(context.resolvedBase ? [context.resolvedBase] : [])]
      .flatMap((stop) => stop.countryCode ? [[stop.id, stop.countryCode] as const] : []),
  );
  const votes = new Map<string, number>();
  let hasUnsupportedProviderCountry = false;
  for (const stop of stops) {
    const code = countryById.get(stop.id);
    // A provider-supplied country code outranks the approximate rectangular
    // coordinate fallback. If that country is unsupported, stay worldwide
    // instead of inheriting a neighbour's currency, airports or entry rules.
    const match = code
      ? destinationForCountryCode(code)
      : destinationForCoordinate(stop.latitude, stop.longitude);
    if (code && !match) hasUnsupportedProviderCountry = true;
    if (match) votes.set(match.id, (votes.get(match.id) ?? 0) + 1);
  }
  // Mixed-country and unsupported-country inputs are not a safe place to
  // inherit one country's airports, entry rules, currency and meal hours.
  // Require a strict majority; a tie or an unsupported provider country stays
  // in the no-assumptions profile until the traveller chooses explicitly.
  if (hasUnsupportedProviderCountry) return destinationById("worldwide");
  const ranked = [...votes.entries()].sort((left, right) => right[1] - left[1]);
  const winner = ranked[0];
  const totalVotes = ranked.reduce((sum, [, count]) => sum + count, 0);
  return winner && winner[1] * 2 > totalVotes
    ? destinationById(winner[0])
    : destinationById("worldwide");
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
  const parsedInput = parseWishlist(raw);
  const inputMode: BuiltTripPlan["inputMode"] = parsedInput.some((line) => (
    line.kind === "heading" || (line.kind === "place" && line.places.some((place) => place.day !== null))
  )) ? "existing_itinerary" : "wishlist";
  const parsedOrderByDay: Record<number, string[]> = {};
  let placeOccurrenceIndex = 0;
  const normalizedInput = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const indexedResolvedStops = new Map<number, ResolvedInputStop>();
  const unindexedResolvedStops = new Map<string, ResolvedInputStop[]>();
  for (const candidate of context.resolvedStops ?? []) {
    if (candidate.inputIndex !== undefined && Number.isInteger(candidate.inputIndex) && candidate.inputIndex >= 0) {
      const current = indexedResolvedStops.get(candidate.inputIndex);
      if (!current || candidate.id.localeCompare(current.id) < 0) indexedResolvedStops.set(candidate.inputIndex, candidate);
      continue;
    }
    const key = normalizedInput(candidate.input);
    const matches = unindexedResolvedStops.get(key) ?? [];
    matches.push(candidate);
    unindexedResolvedStops.set(key, matches);
  }
  for (const matches of unindexedResolvedStops.values()) matches.sort((left, right) => left.id.localeCompare(right.id));
  const usedResolvedStopIds = new Set<string>();

  for (const line of parsedInput) {
    if (line.kind !== "place") continue;
    for (const place of line.places) {
      const inputIndex = placeOccurrenceIndex;
      placeOccurrenceIndex += 1;
      const entry = place.name;
      const parsedConstraint = constraintFromParsedPlace(place);
      const exactUnindexedMatches = unindexedResolvedStops.get(normalizedInput(entry)) ?? [];
      const providerStop = indexedResolvedStops.get(inputIndex)
        // Multiple unindexed candidates are ambiguous. Only an occurrence-bound
        // traveller choice may select one; never take the first provider row.
        ?? (exactUnindexedMatches.length === 1 ? exactUnindexedMatches[0] : undefined);
      const userFoodReservation = resolveUserFoodReservation(entry, parsedConstraint, locale);
      const resolved = providerStop
        ? [{
            ...providerStop,
            // The provider can return one result for two identical query lines.
            // Keep each reviewed occurrence addressable instead of merging its
            // day/time constraints into the first visit.
            id: usedResolvedStopIds.has(providerStop.id)
              ? `${providerStop.id}--occurrence-${inputIndex + 1}`
              : providerStop.id,
            inputIndex,
            isAnchor: parsedConstraint.isReservation || parsedConstraint.priority === "must",
          }]
        : userFoodReservation ? [userFoodReservation] : resolveKnownStops(entry, locale);
      if (resolved.length === 0) {
        unknownEntries.push(entry);
        continue;
      }
      for (const stop of resolved) {
        if (providerStop) usedResolvedStopIds.add(stop.id);
        if (!knownStops.some((candidate) => candidate.id === stop.id)) knownStops.push(stop);
        constraints.set(stop.id, mergeConstraints(constraints.get(stop.id), parsedConstraint));
        if (inputMode === "existing_itinerary" && place.day !== null) {
          const dayIndex = place.day - 1;
          const order = parsedOrderByDay[dayIndex] ?? [];
          if (!order.includes(stop.id)) order.push(stop.id);
          parsedOrderByDay[dayIndex] = order;
        }
      }
    }
  }

  // A locked order is also a locked day assignment. Apply it before inspector
  // overrides so an explicit later day move can intentionally replace a stale
  // lock from the previous plan version.
  const lockedDayByStop = new Map<string, number>();
  const knownStopIds = new Set(knownStops.map((stop) => stop.id));
  for (const [rawDayIndex, stopIds] of Object.entries(context.lockedOrderByDay ?? {})
    .sort(([left], [right]) => Number(left) - Number(right))) {
    const dayIndex = Number(rawDayIndex);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= requestedDays || !Array.isArray(stopIds)) continue;
    for (const stopId of stopIds) {
      if (!knownStopIds.has(stopId) || lockedDayByStop.has(stopId)) continue;
      lockedDayByStop.set(stopId, dayIndex);
      const existing = constraints.get(stopId) ?? defaultConstraint;
      if (existing.fixedDay === null) constraints.set(stopId, { ...existing, fixedDay: dayIndex + 1 });
    }
  }

  // One tap in the inspector moves a stop to another day; the pick behaves
  // exactly like an explicit "2日目" marker written in the wishlist.
  for (const [stopId, day] of Object.entries(context.dayOverrides ?? {})) {
    if (!Number.isFinite(day) || day < 1 || day > requestedDays) continue;
    constraints.set(stopId, { ...(constraints.get(stopId) ?? defaultConstraint), fixedDay: Math.round(day) });
    lockedDayByStop.set(stopId, Math.round(day) - 1);
  }

  // Durations resolve from the merged constraints so a stay marker still
  // applies when the same place appears on more than one line. A per-stop edit
  // (or an evidence buffer) wins over the wishlist's own "滞在90分 / stay 90
  // min" marker, which wins over the estimate.
  for (let index = 0; index < knownStops.length; index += 1) {
    const stop = knownStops[index];
    const durationOverride = context.durationOverrides?.[stop.id];
    const stayMinutes = constraints.get(stop.id)?.stayMinutes ?? null;
    const effectiveDuration = typeof durationOverride === "number" && Number.isFinite(durationOverride) && durationOverride >= 15 && durationOverride <= 480
      ? Math.round(durationOverride)
      : stayMinutes;
    if (effectiveDuration !== null) knownStops[index] = { ...stop, planningDurationMinutes: effectiveDuration };
  }

  // One tap on "外す" removes a stop the user decided against; the rest of the
  // plan recomputes around the gap.
  const excludedStopIds = new Set(context.excludedStopIds ?? []);
  const activeStops = excludedStopIds.size > 0
    ? knownStops.filter((stop) => !excludedStopIds.has(stop.id))
    : knownStops;
  const minimumPinnedDay = activeStops.reduce((maximum, stop) => {
    const fixedDay = constraints.get(stop.id)?.fixedDay;
    return fixedDay === null || fixedDay === undefined ? maximum : Math.max(maximum, fixedDay);
  }, 1);

  // With "auto", the country of the stops that actually made the plan decides,
  // so a Swiss wishlist gets Swiss meal hours, airports and mode preference
  // without the traveller having to say so.
  const destination = resolveContextDestination(context, activeStops);
  const travelInputs: TravelInputs = {
    preference: context.travelPreference ?? "auto",
    mobility: destination.mobility,
    transit: context.liveTransitMinutes,
    transitAbsent: context.liveTransitAbsentLegs,
    transfers: context.liveTransitTransferCounts,
    walking: context.liveWalkingMinutes,
    driving: context.liveDrivingMinutes,
    overrides: context.legModeOverrides,
    bufferMinutes: [0, 10, 20, 30].includes(context.transferBufferMinutes ?? 10)
      ? context.transferBufferMinutes ?? 10
      : 10,
    maxWalkingMinutesPerLeg: typeof context.maxWalkingMinutesPerLeg === "number"
      && Number.isFinite(context.maxWalkingMinutesPerLeg)
      ? Math.min(180, Math.max(5, Math.round(context.maxWalkingMinutesPerLeg)))
      : 30,
    maxTransfersPerLeg: typeof context.maxTransfersPerLeg === "number" && Number.isFinite(context.maxTransfersPerLeg)
      ? Math.min(8, Math.max(0, Math.round(context.maxTransfersPerLeg)))
      : 2,
  };
  const mobilityPolicy: MobilityPolicy = {
    maxWalkingMinutesPerLeg: travelInputs.maxWalkingMinutesPerLeg ?? 30,
    maxTransfersPerLeg: travelInputs.maxTransfersPerLeg ?? 2,
    walkingLimitWasProvided: typeof context.maxWalkingMinutesPerLeg === "number" && Number.isFinite(context.maxWalkingMinutesPerLeg),
    transferLimitWasProvided: typeof context.maxTransfersPerLeg === "number" && Number.isFinite(context.maxTransfersPerLeg),
  };
  const hotelQuery = context.hotelQuery?.trim() ?? "";
  const selectedBase = resolveTripBase(hotelQuery, locale, context.resolvedBase);
  const airportConstraints = buildAirportConstraints(context, selectedBase, locale, destination);
  const activityStartDayOffset = Math.max(
    0,
    airportConstraints.find((constraint) => constraint.direction === "arrival")?.cityTimeDayOffset ?? 0,
  );
  const activityStartDate = addDaysToIsoDate(context.tripStartDate, activityStartDayOffset) ?? context.tripStartDate;
  const openingWindowsByActivityDay = activityDayOpeningWindows(
    context.openingWindowsByDay ?? {},
    activityStartDayOffset,
  );
  const lastEntryMinutesByStop = Object.fromEntries(Object.entries(context.lastEntryTimes ?? {}).flatMap(([stopId, value]) => {
    const minutes = clockMinutes(value);
    return minutes === null ? [] : [[stopId, minutes] as const];
  }));
  const accessWindowsByActivityDay: Record<string, Record<number, VisitWindow[]>> = {};
  for (const stop of activeStops) {
    const lastEntryMinutes = lastEntryMinutesByStop[stop.id];
    const providerDays = openingWindowsByActivityDay[stop.id] ?? {};
    const daysWithEvidence = new Set([
      ...Object.keys(providerDays).map(Number),
      ...(lastEntryMinutes === undefined ? [] : Array.from({ length: requestedDays }, (_, index) => index)),
    ]);
    if (daysWithEvidence.size === 0) continue;
    accessWindowsByActivityDay[stop.id] = Object.fromEntries([...daysWithEvidence].sort((left, right) => left - right).map((dayIndex) => {
      const windows = providerDays[dayIndex] ?? [{ openMinutes: 0, closeMinutes: 24 * 60 }];
      return [dayIndex, windows.map((window) => lastEntryMinutes === undefined ? window : { ...window, lastEntryMinutes })];
    }));
  }
  const paceCapacity = pace === "relaxed" ? 3 : pace === "fast" ? 5 : 4;
  const initialClusters = activeStops.length > 0 ? clusterStops(activeStops, requestedDays) : [];
  const fixedClusters = applyFixedDays(initialClusters, constraints);
  // Day reassignment follows provider opening days. A separate last-entry
  // cutoff is evaluated in the final clock schedule so its own conflict and
  // evidence are not collapsed into a generic "unavailable" stop.
  const openingAssignment = applyOpeningDays(fixedClusters, constraints, openingWindowsByActivityDay, paceCapacity);
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
  // A theme-park-class stop consumes most of a day. Move its unpinned
  // companions to the nearest day that has room, so USJ does not get squeezed
  // in as an evening footnote after four other stops.
  const stopIsMovable = (stop: RouteStop) => {
    const constraint = constraints.get(stop.id);
    return !isDayAnchorStay(stop.planningDurationMinutes)
      && constraint?.fixedDay == null
      && constraint?.fixedTimeMinutes == null;
  };
  if (clusters.length > 1) {
    for (const cluster of clusters) {
      if (!cluster.some((stop) => isDayAnchorStay(stop.planningDurationMinutes))) continue;
      while (cluster.length > 2) {
        const movable = [...cluster].filter(stopIsMovable)
          .sort((left, right) => left.planningDurationMinutes - right.planningDurationMinutes)[0];
        if (!movable) break;
        const target = clusters
          .filter((candidate) => candidate !== cluster
            && candidate.length < paceCapacity
            && !candidate.some((stop) => isDayAnchorStay(stop.planningDurationMinutes)))
          .sort((left, right) => clusterDistanceKm(movable, left) - clusterDistanceKm(movable, right))[0];
        if (target) {
          cluster.splice(cluster.findIndex((stop) => stop.id === movable.id), 1);
          target.push(movable);
          continue;
        }
        if (constraints.get(movable.id)?.priority === "optional") {
          cluster.splice(cluster.findIndex((stop) => stop.id === movable.id), 1);
          deferredOptionalStops.push(movable);
          continue;
        }
        break;
      }
    }
  }
  // Time-based ceiling on top of the count-based one: a day is ~10 waking
  // hours; drop trailing optionals when the stays alone exceed what fits.
  const dayBudgetMinutes = pace === "relaxed" ? 480 : pace === "fast" ? 660 : 570;
  const trimClustersToDayBudget = () => {
    for (const cluster of clusters) {
      const clusterMinutes = () => cluster.reduce((sum, stop) => sum + stop.planningDurationMinutes, 0)
        + Math.max(0, cluster.length - 1) * 35;
      while (clusterMinutes() > dayBudgetMinutes) {
        // A day-pinned optional was placed there on purpose; an over-budget
        // day surfaces honestly rather than silently dropping it.
        const optionalIndex = cluster.findLastIndex((stop) => (
          constraints.get(stop.id)?.priority === "optional" && constraints.get(stop.id)?.fixedDay == null
        ));
        if (optionalIndex < 0) break;
        deferredOptionalStops.push(...cluster.splice(optionalIndex, 1));
      }
    }
  };
  trimClustersToDayBudget();
  const scheduledKnownStops = fullClusters.flat();
  const baseRecommendations = recommendBases(scheduledKnownStops, fullClusters, locale, Boolean(context.resolvedStops?.length));
  const earlyVisitStopIds = new Set(context.earlyVisitStopIds ?? []);
  // Resolved stops carry their Google placeTypes at runtime; a restaurant or
  // cafe schedules toward meal windows instead of opening the day.
  const foodStopIds = new Set(
    activeStops
      .filter((stop) => isFoodPlaceTypes((stop as { placeTypes?: string[] }).placeTypes ?? []))
      .map((stop) => stop.id),
  );
  // Night N is where you sleep after day N; a day starts at the previous
  // night's hotel and ends at tonight's. Clamping keeps day 0 and the final
  // day anchored to the first/last night, and missing nights fall back to
  // the trip-wide base — so a single-hotel trip behaves exactly as before.
  const nightCount = Math.max(1, clusters.length - 1);
  const nightBaseFor = (night: number): TripBase | null => {
    const resolved = context.nightBases?.[Math.max(0, Math.min(nightCount - 1, night))];
    if (!resolved) return selectedBase;
    return {
      ...resolved,
      id: `base-${resolved.id}`,
      planningDurationMinutes: 0,
      isAnchor: false,
      query: resolved.name,
    };
  };
  const buildCandidateDay = (cluster: RouteStop[], index: number) => buildDay(
    cluster,
    index,
    clusters.length,
    locale,
    nightBaseFor(index - 1),
    nightBaseFor(index),
    airportConstraints,
    constraints,
    earlyVisitStopIds,
    foodStopIds,
    Object.fromEntries(cluster.map((stop) => [stop.id, accessWindowsByActivityDay[stop.id]?.[index]]).filter((entry) => entry[1] !== undefined)) as Record<string, VisitWindow[]>,
    destination,
    context.dayStartTimes?.[index] ?? context.defaultDayStart,
    activityStartDate,
    travelInputs,
    clockMinutes(context.dayEndTimes?.[index] ?? context.dayEndTarget) === null
      ? DEFAULT_DAY_END
      : context.dayEndTimes?.[index] ?? context.dayEndTarget,
    context.lockedOrderByDay?.[index] ?? (context.optimizeExistingOrder ? [] : parsedOrderByDay[index] ?? []),
  );
  const optimizedClusters = optimizeDayAssignments(clusters, constraints, lockedDayByStop, buildCandidateDay, {
    paceCapacity,
    dayBudgetMinutes,
  });
  clusters.splice(0, clusters.length, ...optimizedClusters);
  // A swap can still assemble an over-budget day out of two in-budget ones;
  // shed trailing optionals once more so the returned schedule honours the
  // same ceiling the seed clusters were trimmed to.
  trimClustersToDayBudget();
  const days = clusters.map(buildCandidateDay);
  const lastIndex = days.length - 1;
  if (lastIndex >= 0) {
    while (days[lastIndex].deadlineOverrunMinutes > 0) {
      const optionalIndex = clusters[lastIndex].findLastIndex((stop) => constraints.get(stop.id)?.priority === "optional");
      if (optionalIndex < 0) break;
      deferredOptionalStops.push(...clusters[lastIndex].splice(optionalIndex, 1));
      days[lastIndex] = buildCandidateDay(clusters[lastIndex], lastIndex);
    }
  }
  // An unpinned Optional place that is closed on every candidate day is a
  // declared trade-off, not a hard contradiction. Keep required/Must places
  // in the unavailable set so the verdict can distinguish the two.
  const deferredUnavailableStops = openingAssignment.unavailable.filter((stop) => (
    (constraints.get(stop.id) ?? defaultConstraint).priority !== "optional"
  ));
  for (const stop of openingAssignment.unavailable) {
    if ((constraints.get(stop.id) ?? defaultConstraint).priority !== "optional") continue;
    if (!deferredOptionalStops.some((candidate) => candidate.id === stop.id)) deferredOptionalStops.push(stop);
  }
  const scheduledStopCount = days.reduce((sum, day) => sum + day.stops.filter((stop) => stop.kind === "place").length, 0);
  const foodRecommendationSlots = buildFoodRecommendationSlots(days, context.mealPlan ?? "none", locale, destination);
  return {
    inputMode,
    destination: destination.id,
    requestedDays,
    recognizedStopCount: activeStops.length,
    scheduledStopCount,
    mealBreakCount: 0,
    unknownEntries: [...new Set(unknownEntries)],
    deferredOptionalStops,
    deferredUnavailableStops,
    constraintCount: [...constraints.values()].filter((constraint) => (
      constraint.priority !== "normal" || constraint.fixedDay !== null || constraint.fixedTime !== null
    )).length + Object.keys(lastEntryMinutesByStop).length,
    minimumPinnedDay,
    overCapacityCount: clusters.reduce((sum, cluster) => sum + Math.max(0, cluster.length - paceCapacity), 0),
    scheduleConflictCount: days.filter((day) => day.deadlineOverrunMinutes > 0 || day.reservationConflictCount > 0 || day.openingConflictCount > 0).length,
    selectedBase,
    hotelQuery,
    hotelResolved: selectedBase !== null,
    travelPreference: travelInputs.preference,
    mobilityPolicy,
    baseRecommendations,
    airportConstraints,
    foodRecommendationSlots,
    days,
  };
}
