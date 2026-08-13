import type { DestinationChoice } from "./destinations.ts";
import { destinationById, isDestinationChoice } from "./destinations.ts";
import type { GapSuggestionKind } from "./gap-detection.ts";

export type RouteRecommendationPoint = {
  latitude: number;
  longitude: number;
};

export type RouteRecommendationRequest = {
  routePoints: RouteRecommendationPoint[];
  excludedPlaceIds: string[];
  excludedNames: string[];
  languageCode: "en" | "ja";
  destination: DestinationChoice;
  /**
   * The gap band's deterministic suggestion categories (lib/gap-detection).
   * They drive both the Google text query and the accepted place types, so a
   * 30-minute gap can never surface a theme park. Absent = every supported
   * category (legacy requests and non-gap searches).
   */
  suggestionKinds?: GapSuggestionKind[];
};

export type RouteRecommendation = {
  id: string;
  /** Raw Google Place ID. Unlike `id`, this is safe for exact Place Details. */
  providerRef: string;
  name: string;
  address: string;
  type: string;
  placeTypes: string[];
  businessStatus: string | null;
  regularOpeningPeriods: unknown[] | null;
  googleMapsUrl: string;
  latitude: number;
  longitude: number;
  rating: number | null;
  userRatingCount: number | null;
  routeDistanceMeters: number;
  photoName: string | null;
  /** Server signature over `photoName`, minted at the route boundary. */
  photoSignature?: string | null;
  photoAttribution: { name: string; uri: string } | null;
};

type RawPlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  googleMapsUri?: unknown;
  businessStatus?: unknown;
  primaryType?: unknown;
  types?: unknown;
  primaryTypeDisplayName?: { text?: unknown };
  location?: { latitude?: unknown; longitude?: unknown };
  rating?: unknown;
  userRatingCount?: unknown;
  photos?: Array<{
    name?: unknown;
    authorAttributions?: Array<{ displayName?: unknown; uri?: unknown }>;
  }>;
  regularOpeningHours?: { periods?: unknown };
};

const fieldMask = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.primaryType",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
  "places.regularOpeningHours",
].join(",");

const allowedRecommendationTypes = new Set([
  "amusement_park",
  "aquarium",
  "art_gallery",
  "art_museum",
  "bakery",
  "beach",
  "botanical_garden",
  "bridge",
  "buddhist_temple",
  "cafe",
  "castle",
  "church",
  "city_park",
  "coffee_shop",
  "cultural_landmark",
  "dessert_shop",
  "fort",
  "garden",
  "hiking_area",
  "hindu_temple",
  "historical_landmark",
  "historical_place",
  "history_museum",
  "island",
  "lake",
  "lookout",
  "monument",
  "mosque",
  "mountain_peak",
  "museum",
  "national_park",
  "nature_preserve",
  "observation_deck",
  "park",
  "performing_arts_theater",
  "place_of_worship",
  "planetarium",
  "scenic_spot",
  "science_museum",
  "shinto_shrine",
  "ski_resort",
  "synagogue",
  "tea_house",
  "theme_park",
  "tourist_attraction",
  "visitor_center",
  "water_park",
  "waterfall",
  "woods",
  "zoo",
]);

// Deterministic mapping from the gap bands' suggestion kinds onto supported
// Google place types. ATTRACTION (the 120+ band) opens the whole supported
// catalogue; every other kind names a bounded slice of it.
const cafeTypes = ["cafe", "coffee_shop", "tea_house", "dessert_shop"] as const;
const walkTypes = ["park", "city_park", "garden", "hiking_area", "bridge", "beach", "woods", "island", "lake", "waterfall"] as const;
const suggestionKindTypes: Record<GapSuggestionKind, readonly string[]> = {
  CAFE: cafeTypes,
  BAKERY: ["bakery"],
  PARK: ["park", "city_park", "garden", "botanical_garden", "national_park", "nature_preserve", "woods", "beach", "lake"],
  LOOKOUT: ["lookout", "observation_deck", "scenic_spot", "mountain_peak", "waterfall", "bridge"],
  SMALL_FACILITY: [
    "art_gallery", "art_museum", "museum", "history_museum", "science_museum", "planetarium", "aquarium",
    "historical_landmark", "historical_place", "cultural_landmark", "monument", "castle", "fort",
    "church", "mosque", "synagogue", "place_of_worship", "buddhist_temple", "hindu_temple", "shinto_shrine",
    "visitor_center", "performing_arts_theater",
  ],
  WALK: walkTypes,
  CAFE_AND_WALK: [...cafeTypes, ...walkTypes],
  ATTRACTION: [...allowedRecommendationTypes],
};

export function isGapSuggestionKind(value: unknown): value is GapSuggestionKind {
  return typeof value === "string" && Object.hasOwn(suggestionKindTypes, value);
}

/** The place types a request may accept; absent kinds keep the full catalogue. */
export function recommendationTypesForKinds(kinds: readonly GapSuggestionKind[] | undefined): ReadonlySet<string> {
  if (!kinds || kinds.length === 0) return allowedRecommendationTypes;
  const allowed = new Set<string>();
  for (const kind of kinds) for (const type of suggestionKindTypes[kind] ?? []) allowed.add(type);
  return allowed.size > 0 ? allowed : allowedRecommendationTypes;
}

// One deterministic query phrase per kind, composed in fixed kind order so
// the same band always sends the same query.
const suggestionKindOrder: readonly GapSuggestionKind[] = ["ATTRACTION", "SMALL_FACILITY", "CAFE_AND_WALK", "CAFE", "BAKERY", "PARK", "LOOKOUT", "WALK"];
const suggestionKindQueryWords: Record<GapSuggestionKind, { ja: string; en: string }> = {
  CAFE: { ja: "カフェ", en: "cafes" },
  BAKERY: { ja: "ベーカリー", en: "bakeries" },
  PARK: { ja: "公園 庭園", en: "parks and gardens" },
  LOOKOUT: { ja: "展望スポット 景勝地", en: "lookouts and scenic spots" },
  SMALL_FACILITY: { ja: "小さな美術館 ギャラリー 歴史的名所", en: "small museums galleries and landmarks" },
  WALK: { ja: "散歩道 公園", en: "walks and parks" },
  CAFE_AND_WALK: { ja: "カフェ 公園", en: "cafes and parks" },
  ATTRACTION: { ja: "観光名所 景勝地 公園 美術館 カフェ", en: "attractions scenic places parks museums and cafes" },
};

export function recommendationQueryForKinds(
  kinds: readonly GapSuggestionKind[] | undefined,
  languageCode: "en" | "ja",
) {
  const active = suggestionKindOrder.filter((kind) => kinds?.includes(kind));
  if (active.length === 0 || active.includes("ATTRACTION")) {
    return languageCode === "ja"
      ? "評価の高い観光名所 景勝地 公園 美術館 カフェ"
      : "highly rated attractions scenic places parks museums and cafes";
  }
  const words = active.map((kind) => suggestionKindQueryWords[kind][languageCode]);
  return languageCode === "ja" ? `評価の高い ${words.join(" ")}` : `highly rated ${words.join(" ")}`;
}

function boundedString(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function parseStringArray(value: unknown, maximumItems: number, maximumLength: number) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const result: string[] = [];
  for (const entry of value) {
    const parsed = boundedString(entry, 1, maximumLength);
    if (!parsed) return null;
    if (!result.includes(parsed)) result.push(parsed);
  }
  return result;
}

export function parseRouteRecommendationRequest(input: unknown): RouteRecommendationRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  if (!Array.isArray(source.routePoints) || source.routePoints.length < 1 || source.routePoints.length > 12) return null;
  const routePoints: RouteRecommendationPoint[] = [];
  for (const rawPoint of source.routePoints) {
    if (!rawPoint || typeof rawPoint !== "object") return null;
    const point = rawPoint as Record<string, unknown>;
    const latitude = finiteNumber(point.latitude, -90, 90);
    const longitude = finiteNumber(point.longitude, -180, 180);
    if (latitude === null || longitude === null) return null;
    const previous = routePoints.at(-1);
    if (!previous || previous.latitude !== latitude || previous.longitude !== longitude) {
      routePoints.push({ latitude, longitude });
    }
  }
  if (routePoints.length < 1) return null;
  // A same-hotel return makes the route origin equal its destination, a case
  // Google's Search Along Route explicitly warns can return no results. The
  // outbound path still contains the day's useful geometry without it.
  if (routePoints.length >= 3) {
    const first = routePoints[0];
    const last = routePoints.at(-1)!;
    if (first.latitude === last.latitude && first.longitude === last.longitude) routePoints.pop();
  }
  const excludedPlaceIds = parseStringArray(source.excludedPlaceIds, 80, 160);
  const excludedNames = parseStringArray(source.excludedNames, 80, 160);
  if (!excludedPlaceIds || !excludedNames) return null;
  if (source.languageCode !== "en" && source.languageCode !== "ja") return null;
  let suggestionKinds: GapSuggestionKind[] | undefined;
  if (source.suggestionKinds !== undefined && source.suggestionKinds !== null) {
    if (!Array.isArray(source.suggestionKinds) || source.suggestionKinds.length > 8) return null;
    const kinds: GapSuggestionKind[] = [];
    for (const kind of source.suggestionKinds) {
      if (!isGapSuggestionKind(kind)) return null;
      if (!kinds.includes(kind)) kinds.push(kind);
    }
    if (kinds.length > 0) suggestionKinds = kinds;
  }
  return {
    routePoints,
    excludedPlaceIds,
    excludedNames,
    languageCode: source.languageCode,
    destination: isDestinationChoice(source.destination) ? source.destination : "auto",
    ...(suggestionKinds ? { suggestionKinds } : {}),
  };
}

function encodeSigned(value: number) {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (shifted >= 0x20) {
    encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return encoded + String.fromCharCode(shifted + 63);
}

/**
 * Downsamples real route geometry to the request budget: evenly spaced picks
 * that always keep both endpoints, deduplicating consecutive repeats. Inputs
 * already within budget pass through unchanged.
 */
export function sampleRoutePoints(
  points: readonly RouteRecommendationPoint[],
  maxPoints = 12,
): RouteRecommendationPoint[] {
  const budget = Math.max(2, Math.floor(maxPoints));
  const unique: RouteRecommendationPoint[] = [];
  for (const point of points) {
    const previous = unique.at(-1);
    if (!previous || previous.latitude !== point.latitude || previous.longitude !== point.longitude) {
      unique.push({ latitude: point.latitude, longitude: point.longitude });
    }
  }
  if (unique.length <= budget) return unique;
  const sampled: RouteRecommendationPoint[] = [];
  for (let index = 0; index < budget; index += 1) {
    const source = unique[Math.round(index * (unique.length - 1) / (budget - 1))];
    const previous = sampled.at(-1);
    if (!previous || previous.latitude !== source.latitude || previous.longitude !== source.longitude) {
      sampled.push(source);
    }
  }
  return sampled;
}

/**
 * The search points for one gap: when real provider geometry exists for the
 * gap's leg, sample along it within the budget; otherwise fall back to the
 * gap's two anchors (the honest straight-line proxy).
 */
export function gapGeometrySearchPoints(
  geometry: readonly RouteRecommendationPoint[] | null | undefined,
  anchors: readonly RouteRecommendationPoint[],
  maxPoints = 12,
): RouteRecommendationPoint[] {
  if (geometry && geometry.length >= 2) return sampleRoutePoints(geometry, maxPoints);
  return anchors.map((point) => ({ latitude: point.latitude, longitude: point.longitude }));
}

/** Google Encoded Polyline Algorithm at 1e-5 precision. */
export function encodeRoutePolyline(points: RouteRecommendationPoint[]) {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let result = "";
  for (const point of points) {
    const latitude = Math.round(point.latitude * 1e5);
    const longitude = Math.round(point.longitude * 1e5);
    result += encodeSigned(latitude - previousLatitude);
    result += encodeSigned(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return result;
}

function routeDistanceMeters(point: RouteRecommendationPoint, route: RouteRecommendationPoint[]) {
  const referenceLatitude = point.latitude * Math.PI / 180;
  const project = (candidate: RouteRecommendationPoint) => ({
    x: (candidate.longitude - point.longitude) * 111_320 * Math.cos(referenceLatitude),
    y: (candidate.latitude - point.latitude) * 110_540,
  });
  if (route.length === 1) {
    const projected = project(route[0]);
    return Math.round(Math.hypot(projected.x, projected.y));
  }
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = project(route[index]);
    const end = project(route[index + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = dx * dx + dy * dy;
    const rawT = denominator === 0 ? 0 : -(start.x * dx + start.y * dy) / denominator;
    const t = Math.max(0, Math.min(1, rawT));
    best = Math.min(best, Math.hypot(start.x + dx * t, start.y + dy * t));
  }
  return Math.round(best);
}

function popularityScore(candidate: Pick<RouteRecommendation, "rating" | "userRatingCount" | "routeDistanceMeters">) {
  const priorRating = 4.1;
  const priorReviews = 120;
  const reviewCount = Math.max(0, candidate.userRatingCount ?? 0);
  const rating = candidate.rating ?? priorRating;
  const supportedRating = (rating * reviewCount + priorRating * priorReviews) / (reviewCount + priorReviews);
  const reviewVolume = Math.log10(reviewCount + 1) * 0.18;
  const routePenalty = Math.min(1.3, candidate.routeDistanceMeters / 1_800) * 0.62;
  return supportedRating + reviewVolume - routePenalty;
}

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s'’"“”・·.\-–—]/g, "");
}

function parseCandidate(raw: RawPlace, request: RouteRecommendationRequest): RouteRecommendation | null {
  const providerId = boundedString(raw.id, 1, 160);
  const name = boundedString(raw.displayName?.text, 1, 160);
  const googleMapsUrl = boundedString(raw.googleMapsUri, 1, 500);
  const latitude = finiteNumber(raw.location?.latitude, -90, 90);
  const longitude = finiteNumber(raw.location?.longitude, -180, 180);
  if (!providerId || !name || !googleMapsUrl || latitude === null || longitude === null) return null;
  // Match the resolver's RouteStop identity so adding a suggestion participates
  // in the same dedupe, day-override and live-route machinery as typed places.
  const id = `google-${providerId}`;
  if (raw.businessStatus === "CLOSED_PERMANENTLY" || raw.businessStatus === "CLOSED_TEMPORARILY") return null;
  const primaryType = boundedString(raw.primaryType, 1, 100);
  const returnedTypes = Array.isArray(raw.types)
    ? raw.types.flatMap((entry) => {
      const parsed = boundedString(entry, 1, 100);
      return parsed ? [parsed] : [];
    })
    : [];
  const placeTypes = [...new Set([...(primaryType ? [primaryType] : []), ...returnedTypes])].slice(0, 20);
  // A primary type can be narrower than the useful secondary classification
  // (for example mountain_peak + tourist_attraction). Accept any supported
  // returned type, while lodging and transit inventory remain excluded. The
  // gap band's suggestion kinds bound the acceptable set further, so a short
  // gap only ever surfaces its own categories.
  const acceptedTypes = recommendationTypesForKinds(request.suggestionKinds);
  if (!placeTypes.some((type) => acceptedTypes.has(type))) return null;
  const excludedIds = new Set(request.excludedPlaceIds);
  const excludedNames = new Set(request.excludedNames.map(normalizedName));
  if (excludedIds.has(id) || excludedIds.has(providerId) || excludedNames.has(normalizedName(name))) return null;
  const routeDistance = routeDistanceMeters({ latitude, longitude }, request.routePoints);
  // Search Along Route is a relevance bias, not a geometric guarantee. A
  // deterministic cap prevents a high-rated but distant result becoming a
  // misleading "on your way" recommendation.
  if (routeDistance > 2_500) return null;
  const rating = finiteNumber(raw.rating, 0, 5);
  const userRatingCount = finiteNumber(raw.userRatingCount, 0, Number.MAX_SAFE_INTEGER);
  const photo = raw.photos?.find((entry) => boundedString(entry?.name, 1, 500));
  const attribution = photo?.authorAttributions?.find((entry) => (
    boundedString(entry?.displayName, 1, 160) && boundedString(entry?.uri, 1, 500)
  ));
  const businessStatus = boundedString(raw.businessStatus, 1, 80);
  const regularOpeningPeriods = Array.isArray(raw.regularOpeningHours?.periods)
    ? raw.regularOpeningHours.periods.slice(0, 30)
    : null;
  return {
    id,
    providerRef: providerId,
    name,
    address: boundedString(raw.formattedAddress, 1, 300) ?? "",
    type: boundedString(raw.primaryTypeDisplayName?.text, 1, 100)
      ?? (request.languageCode === "ja" ? "立ち寄りスポット" : "Place to visit"),
    placeTypes,
    businessStatus,
    regularOpeningPeriods,
    googleMapsUrl,
    latitude,
    longitude,
    rating,
    userRatingCount: userRatingCount === null ? null : Math.floor(userRatingCount),
    routeDistanceMeters: routeDistance,
    photoName: boundedString(photo?.name, 1, 500),
    photoAttribution: attribution ? {
      name: boundedString(attribution.displayName, 1, 160)!,
      uri: boundedString(attribution.uri, 1, 500)!,
    } : null,
  };
}

export function rankRouteRecommendations(candidates: RouteRecommendation[]) {
  const supported = candidates.filter((candidate) => (
    candidate.rating !== null
    && candidate.rating >= 4
    && (candidate.userRatingCount ?? 0) >= 10
  ));
  const credible = supported.length > 0 ? supported : candidates.filter((candidate) => (
    candidate.rating !== null
    && candidate.rating >= 4.2
    && (candidate.userRatingCount ?? 0) >= 3
  ));
  const ranked = credible.sort((left, right) => {
    const scoreDifference = popularityScore(right) - popularityScore(left);
    if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;
    if (left.routeDistanceMeters !== right.routeDistanceMeters) return left.routeDistanceMeters - right.routeDistanceMeters;
    return left.id.localeCompare(right.id);
  });
  const isCafe = (candidate: RouteRecommendation) => candidate.placeTypes.some((type) => (
    type === "cafe" || type === "coffee_shop" || type === "bakery" || type === "tea_house" || type === "dessert_shop"
  ));
  const firstPlace = ranked.find((candidate) => !isCafe(candidate));
  const firstCafe = ranked.find(isCafe);
  const diversified = [firstPlace, firstCafe, ...ranked].filter((candidate): candidate is RouteRecommendation => Boolean(candidate));
  return [...new Map(diversified.map((candidate) => [candidate.id, candidate])).values()].slice(0, 3);
}

export async function fetchGoogleRouteRecommendations(
  request: RouteRecommendationRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  const destination = destinationById(request.destination === "auto" ? "worldwide" : request.destination);
  // The gap band's suggestion kinds decide what is asked for, not only what
  // is kept afterwards.
  const textQuery = recommendationQueryForKinds(request.suggestionKinds, request.languageCode);
  const routeSearch = request.routePoints.length >= 2;
  const body = {
    textQuery,
    pageSize: 20,
    languageCode: request.languageCode,
    ...(destination.regionCode ? { regionCode: destination.regionCode } : {}),
    ...(routeSearch ? {
      searchAlongRouteParameters: {
        polyline: { encodedPolyline: encodeRoutePolyline(request.routePoints) },
      },
    } : {
      locationBias: {
        circle: { center: request.routePoints[0], radius: 2_500 },
      },
    }),
  };
  const search = async (requestBody: Record<string, unknown>) => {
    const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("google_places_unavailable");
    const payload = await response.json() as { places?: RawPlace[] };
    return payload.places ?? [];
  };
  const byProviderId = new Map<string, RawPlace>();
  for (const place of await search(body)) {
    if (typeof place.id === "string") byProviderId.set(place.id, place);
  }
  let candidates = [...byProviderId.values()].flatMap((place) => {
    const parsed = parseCandidate(place, request);
    return parsed ? [parsed] : [];
  });
  // Search Along Route is relevance-biased and can return an empty useful set
  // on long rural or mountain routes. Probe at most two actual scheduled
  // anchors before saying there is nothing nearby.
  if (rankRouteRecommendations(candidates).length < 3) {
    const fallbackPoints = [request.routePoints[0], request.routePoints.at(-1)!]
      .filter((point, index, all) => index === 0 || point.latitude !== all[0].latitude || point.longitude !== all[0].longitude)
      .slice(0, 2);
    const fallbackResults = await Promise.all(fallbackPoints.map((point) => search({
      textQuery,
      pageSize: 10,
      languageCode: request.languageCode,
      ...(destination.regionCode ? { regionCode: destination.regionCode } : {}),
      locationBias: { circle: { center: point, radius: 2_000 } },
    }).catch(() => [])));
    for (const place of fallbackResults.flat()) {
      if (typeof place.id === "string") byProviderId.set(place.id, place);
    }
    candidates = [...byProviderId.values()].flatMap((place) => {
      const parsed = parseCandidate(place, request);
      return parsed ? [parsed] : [];
    });
  }
  return rankRouteRecommendations(candidates);
}
