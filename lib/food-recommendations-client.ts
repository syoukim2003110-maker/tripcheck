import type { Locale } from "./i18n.ts";
import type { FoodRecommendationSlot } from "./trip-builder.ts";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "./google-food.ts";
import type { FoodRankingItem } from "./ai-food-ranking.ts";

export type FoodRecommendationsResponse = {
  provider: "google_maps";
  ranking: "evidence_weighted";
  fetchedAt: string;
  candidates: FoodCandidate[];
};

export type FoodRankingResponse = {
  provider: "anthropic";
  model: string;
  ranked: FoodRankingItem[];
};

type FoodSearchPayload = {
  latitude: number;
  longitude: number;
  area: string;
  mealKind: FoodRecommendationSlot["kind"];
  query: string;
  languageCode: "en" | "ja";
  visitDate?: string;
  visitTime?: string;
};

type FoodRequestOptions = {
  signal?: AbortSignal;
};

export type FoodSlotReconciliation = {
  refresh: FoodRecommendationSlot[];
  reuse: FoodRecommendationSlot[];
  droppedIds: string[];
};

const earthRadiusMeters = 6_371_000;

function foodSlotDistanceMeters(left: FoodRecommendationSlot, right: FoodRecommendationSlot) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function foodSlotNeedsRefresh(
  previous: FoodRecommendationSlot | undefined,
  next: FoodRecommendationSlot,
  anchorToleranceMeters = 250,
) {
  if (!previous) return true;
  if (previous.kind !== next.kind || previous.date !== next.date) return true;
  return foodSlotDistanceMeters(previous, next) > anchorToleranceMeters;
}

export function reconcileFoodRecommendationSlots(
  previousSlots: FoodRecommendationSlot[],
  nextSlots: FoodRecommendationSlot[],
  maxRefresh = 20,
): FoodSlotReconciliation {
  const previousById = new Map(previousSlots.map((slot) => [slot.id, slot]));
  const nextIds = new Set(nextSlots.map((slot) => slot.id));
  const refresh: FoodRecommendationSlot[] = [];
  const reuse: FoodRecommendationSlot[] = [];
  for (const slot of nextSlots) {
    if (foodSlotNeedsRefresh(previousById.get(slot.id), slot) && refresh.length < maxRefresh) refresh.push(slot);
    else reuse.push(slot);
  }
  return {
    refresh,
    reuse,
    droppedIds: previousSlots.filter((slot) => !nextIds.has(slot.id)).map((slot) => slot.id),
  };
}

export function foodRecommendationRequestKey(slot: FoodRecommendationSlot, locale: Locale) {
  return `${slot.latitude.toFixed(4)}|${slot.longitude.toFixed(4)}|${slot.area.normalize("NFKC").toLowerCase()}|${slot.date ?? "undated"}|${slot.kind}|${locale}`;
}

export class FoodRecommendationsError extends Error {
  code: "not_configured" | "invalid_request" | "unavailable";

  constructor(code: FoodRecommendationsError["code"]) {
    super(code);
    this.code = code;
  }
}

function resolveFoodSearchArgs(queryOrLocale: string, maybeLocale?: Locale) {
  const locale = maybeLocale ?? queryOrLocale as Locale;
  const languageCode = locale === "ja" ? "ja" as const : "en" as const;
  const query = maybeLocale ? queryOrLocale.trim() : "";
  return {
    languageCode,
    query: query || defaultFoodDiscoveryQuery(languageCode),
  };
}

export function buildFoodSearchPayload(slot: FoodRecommendationSlot, locale: Locale): FoodSearchPayload;
export function buildFoodSearchPayload(slot: FoodRecommendationSlot, query: string, locale: Locale): FoodSearchPayload;
export function buildFoodSearchPayload(slot: FoodRecommendationSlot, queryOrLocale: string, maybeLocale?: Locale) {
  const { languageCode, query } = resolveFoodSearchArgs(queryOrLocale, maybeLocale);
  return {
    latitude: slot.latitude,
    longitude: slot.longitude,
    area: slot.area,
    mealKind: slot.kind,
    query,
    languageCode,
    ...(slot.date ? {
      visitDate: slot.date,
      visitTime: slot.kind === "lunch" ? "12:30" : "19:00",
    } : {}),
  };
}

export function buildFoodRankingPayload(
  slot: FoodRecommendationSlot,
  query: string,
  candidates: FoodCandidate[],
  locale: Locale,
) {
  return {
    area: slot.area,
    mealKind: slot.kind,
    query,
    languageCode: locale === "ja" ? "ja" as const : "en" as const,
    candidates: candidates.map(({ id, name, address, type }) => ({ id, name, address, type })),
  };
}

// One evidence-only sentence for the food card. Composes only fields Google
// actually returned (rating, review volume, distance, planned-open) so the
// reason never asserts anything a source did not.
export function foodCandidateReason(candidate: FoodCandidate, locale: Locale): string {
  const ja = locale === "ja";
  const parts: string[] = [];
  if (candidate.rating !== null && candidate.userRatingCount !== null && candidate.userRatingCount >= 50) {
    const count = candidate.userRatingCount.toLocaleString(ja ? "ja-JP" : "en-US");
    parts.push(ja
      ? `★${candidate.rating.toFixed(1)}・口コミ${count}件と評価が安定`
      : `a steady ★${candidate.rating.toFixed(1)} across ${count} reviews`);
  }
  if (typeof candidate.distanceMeters === "number" && candidate.distanceMeters <= 1_500) {
    const walkMinutes = Math.max(1, Math.round(candidate.distanceMeters / 80));
    parts.push(ja
      ? `予定の流れから徒歩約${walkMinutes}分`
      : `about a ${walkMinutes}-minute walk from the day's route`);
  }
  if (candidate.plannedOpen === true) {
    parts.push(ja ? "食事の時間帯も営業予定" : "open for this meal time");
  }
  if (parts.length === 0) return candidate.address;
  const sentence = parts.slice(0, 2).join(ja ? "、" : ", ");
  return ja ? `${sentence}。` : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export function foodSearchLinks(query: string, area: string, locale: Locale) {
  const languageCode = locale === "ja" ? "ja" : "en";
  const phrase = query.trim() || defaultFoodDiscoveryQuery(languageCode);
  const search = encodeURIComponent(`${phrase} ${area}`);
  return {
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${search}`,
    tabelog: `${locale === "ja" ? "https://tabelog.com/rstLst/" : "https://tabelog.com/en/rstLst/"}?sk=${search}`,
    x: `https://x.com/search?q=${search}&src=typed_query`,
  };
}

export function requestFoodRecommendations(slot: FoodRecommendationSlot, locale: Locale, options?: FoodRequestOptions): Promise<FoodRecommendationsResponse>;
export function requestFoodRecommendations(slot: FoodRecommendationSlot, query: string, locale: Locale, options?: FoodRequestOptions): Promise<FoodRecommendationsResponse>;
export async function requestFoodRecommendations(
  slot: FoodRecommendationSlot,
  queryOrLocale: string,
  localeOrOptions?: Locale | FoodRequestOptions,
  maybeOptions?: FoodRequestOptions,
): Promise<FoodRecommendationsResponse> {
  const maybeLocale = typeof localeOrOptions === "string" ? localeOrOptions : undefined;
  const options = typeof localeOrOptions === "string" ? maybeOptions : localeOrOptions;
  let response: Response;
  try {
    response = await fetch("/api/food-recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options?.signal,
      body: JSON.stringify(maybeLocale
        ? buildFoodSearchPayload(slot, queryOrLocale, maybeLocale)
        : buildFoodSearchPayload(slot, queryOrLocale as Locale)),
    });
  } catch {
    throw new FoodRecommendationsError("unavailable");
  }
  const payload = await response.json().catch(() => null) as (FoodRecommendationsResponse & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new FoodRecommendationsError("not_configured");
    if (payload?.code === "invalid_request") throw new FoodRecommendationsError("invalid_request");
    throw new FoodRecommendationsError("unavailable");
  }
  return payload;
}

export async function requestFoodRanking(
  slot: FoodRecommendationSlot,
  query: string,
  candidates: FoodCandidate[],
  locale: Locale,
): Promise<FoodRankingResponse> {
  const response = await fetch("/api/food-recommendations/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFoodRankingPayload(slot, query, candidates, locale)),
  }).catch(() => null);
  if (!response?.ok) throw new Error("ai_ranking_unavailable");
  const payload = await response.json().catch(() => null) as FoodRankingResponse | null;
  if (!payload || payload.provider !== "anthropic" || !Array.isArray(payload.ranked)) throw new Error("ai_ranking_unavailable");
  // The Google evidence score is the source of truth for order. Claude may add
  // compact copy, but must not undo the deterministic popularity ranking.
  const notesById = new Map(payload.ranked.map((item) => [item.id, item]));
  return {
    ...payload,
    ranked: candidates.flatMap((candidate) => {
      const item = notesById.get(candidate.id);
      return item ? [item] : [];
    }),
  };
}
