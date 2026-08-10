import type { DestinationChoice } from "./destinations.ts";
import { destinationById, destinationPlaceQuery, isDestinationChoice } from "./destinations.ts";
import { bayesianWeightedRating, hotelRatingPrior } from "./rating-confidence.ts";

export type HotelSearchRequest = {
  latitude: number;
  longitude: number;
  area: string;
  query?: string;
  routePoints?: Array<{ latitude: number; longitude: number }>;
  languageCode: "en" | "ja";
  /** Country the trip is in; decides the region bias and the query suffix. */
  destination: DestinationChoice;
};

export type HotelPaymentMethod =
  | "cash"
  | "credit_card"
  | "debit_card"
  | "contactless"
  | "qr_code"
  | "transport_ic";

export type HotelPaymentEvidence = {
  cashOnly: boolean | null;
  acceptedMethods: HotelPaymentMethod[];
  notAcceptedMethods: HotelPaymentMethod[];
  source: "google_listing" | "google_review" | "google_listing_and_review";
  evidence: string;
};

export type HotelReviewExcerpt = {
  rating: number | null;
  text: string;
  relativeTime: string | null;
  publishedAt: string | null;
  authorName: string | null;
  googleMapsUrl: string | null;
};

export type HotelPhoto = {
  name: string;
  attribution: { name: string; uri: string } | null;
};

export type HotelPriceLevel = "inexpensive" | "moderate" | "expensive" | "very_expensive";
export type HotelStyle = "luxury" | "value";

/** Listing facts from Rakuten Travel, attached when the server has an app id. */
export type RakutenHotelEvidence = {
  minCharge: number | null;
  reviewAverage: number | null;
  reviewCount: number | null;
  url: string;
};

export type HotelCandidate = {
  id: string;
  name: string;
  address: string;
  googleMapsUrl: string;
  websiteUrl: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  userRatingCount: number | null;
  /** Straight-line distance from the Google hotel-search anchor. */
  distanceMeters: number;
  /** Average distance to each day's route center (each day has equal weight). */
  routeAverageDistanceMeters: number;
  /** Longest distance to a day's route center. */
  routeWorstDistanceMeters: number;
  /** Stable comparison metric: 70% average + 30% longest-day distance. */
  routeBurdenMeters: number;
  score: number;
  googleRelevanceRank: number;
  priceLevel: HotelPriceLevel | null;
  styles: HotelStyle[];
  photo: HotelPhoto | null;
  reviews: HotelReviewExcerpt[] | null;
  payment: HotelPaymentEvidence | null;
  rakuten: RakutenHotelEvidence | null;
};

type RawGoogleReview = {
  rating?: unknown;
  text?: { text?: unknown };
  publishTime?: unknown;
  relativePublishTimeDescription?: unknown;
  authorAttribution?: { displayName?: unknown };
  googleMapsUri?: unknown;
};

type RawGooglePlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  googleMapsUri?: unknown;
  websiteUri?: unknown;
  businessStatus?: unknown;
  primaryType?: unknown;
  types?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  rating?: unknown;
  userRatingCount?: unknown;
  priceLevel?: unknown;
  photos?: Array<{
    name?: unknown;
    authorAttributions?: Array<{ displayName?: unknown; uri?: unknown }>;
  }>;
  reviews?: RawGoogleReview[];
  paymentOptions?: {
    acceptsCashOnly?: unknown;
    acceptsCreditCards?: unknown;
    acceptsDebitCards?: unknown;
    acceptsNfc?: unknown;
  };
};

const validLanguages = new Set(["en", "ja"]);
const fieldMask = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
  "places.primaryType",
  "places.types",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.photos",
  "places.reviews",
  "places.paymentOptions",
].join(",");

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function parseHotelSearchRequest(input: unknown): HotelSearchRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  if (!finiteCoordinate(source.latitude, -90, 90) || !finiteCoordinate(source.longitude, -180, 180)) return null;
  if (typeof source.languageCode !== "string" || !validLanguages.has(source.languageCode)) return null;
  const area = boundedText(source.area, 1, 100);
  if (!area) return null;

  let query: string | undefined;
  if (source.query !== undefined && source.query !== null) {
    if (typeof source.query !== "string") return null;
    const trimmed = source.query.trim();
    if (trimmed) {
      const parsed = boundedText(trimmed, 1, 160);
      if (!parsed) return null;
      query = parsed;
    }
  }

  let routePoints: HotelSearchRequest["routePoints"];
  if (source.routePoints !== undefined && source.routePoints !== null) {
    if (!Array.isArray(source.routePoints) || source.routePoints.length > 10) return null;
    const parsedPoints = source.routePoints.map((point) => {
      if (!point || typeof point !== "object") return null;
      const candidate = point as Record<string, unknown>;
      if (!finiteCoordinate(candidate.latitude, -90, 90) || !finiteCoordinate(candidate.longitude, -180, 180)) return null;
      return { latitude: candidate.latitude as number, longitude: candidate.longitude as number };
    });
    if (parsedPoints.some((point) => point === null)) return null;
    if (parsedPoints.length > 0) routePoints = parsedPoints as NonNullable<HotelSearchRequest["routePoints"]>;
  }

  return {
    latitude: source.latitude as number,
    longitude: source.longitude as number,
    area,
    ...(query ? { query } : {}),
    ...(routePoints ? { routePoints } : {}),
    languageCode: source.languageCode as HotelSearchRequest["languageCode"],
    destination: isDestinationChoice(source.destination) ? source.destination : "auto",
  };
}

function requestDestination(request: HotelSearchRequest) {
  return destinationById(request.destination === "auto" ? "worldwide" : request.destination);
}

function regionBias(request: HotelSearchRequest) {
  const { regionCode } = requestDestination(request);
  return regionCode ? { regionCode } : {};
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function distanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function numericRating(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
}

function nonNegativeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

const priceLevelMap: Record<string, HotelPriceLevel> = {
  PRICE_LEVEL_INEXPENSIVE: "inexpensive",
  PRICE_LEVEL_MODERATE: "moderate",
  PRICE_LEVEL_EXPENSIVE: "expensive",
  PRICE_LEVEL_VERY_EXPENSIVE: "very_expensive",
};

function parsePriceLevel(value: unknown): HotelPriceLevel | null {
  return typeof value === "string" ? priceLevelMap[value] ?? null : null;
}

/**
 * Styles are asserted only from Google's own listing data: "luxury" needs an
 * expensive price level, "value" needs a listed budget/moderate price level
 * plus a strong, well-supported rating. No price level → no style claim.
 */
export function hotelStyles(priceLevel: HotelPriceLevel | null, rating: number | null, userRatingCount: number | null): HotelStyle[] {
  const styles: HotelStyle[] = [];
  if (priceLevel === "expensive" || priceLevel === "very_expensive") styles.push("luxury");
  if (
    (priceLevel === "inexpensive" || priceLevel === "moderate")
    && rating !== null && rating >= 4.1
    && userRatingCount !== null && userRatingCount >= 100
  ) styles.push("value");
  return styles;
}

function parseReviews(input: unknown): HotelReviewExcerpt[] | null {
  if (!Array.isArray(input)) return null;
  const reviews = input.slice(0, 5).flatMap((review) => {
    if (!review || typeof review !== "object") return [];
    const source = review as RawGoogleReview;
    const text = boundedText(source.text?.text, 1, 2_000)?.slice(0, 360);
    if (!text) return [];
    return [{
      rating: numericRating(source.rating),
      text,
      relativeTime: boundedText(source.relativePublishTimeDescription, 1, 80),
      publishedAt: boundedText(source.publishTime, 1, 80),
      authorName: boundedText(source.authorAttribution?.displayName, 1, 120),
      googleMapsUrl: boundedText(source.googleMapsUri, 1, 500),
    }];
  });
  return reviews.length > 0 ? reviews.slice(0, 5) : null;
}

function parsePhoto(input: unknown): HotelPhoto | null {
  if (!Array.isArray(input)) return null;
  for (const raw of input.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const photo = raw as NonNullable<RawGooglePlace["photos"]>[number];
    const name = boundedText(photo.name, 1, 500);
    if (!name) continue;
    const author = photo.authorAttributions?.find((candidate) =>
      Boolean(boundedText(candidate?.displayName, 1, 160) && boundedText(candidate?.uri, 1, 500)));
    const authorName = boundedText(author?.displayName, 1, 160);
    const authorUri = boundedText(author?.uri, 1, 500);
    return {
      name,
      attribution: authorName && authorUri ? { name: authorName, uri: authorUri } : null,
    };
  }
  return null;
}

function uniqueMethods(methods: HotelPaymentMethod[]) {
  return [...new Set(methods)];
}

function listingPaymentEvidence(raw: RawGooglePlace["paymentOptions"], languageCode: "en" | "ja"): HotelPaymentEvidence | null {
  if (!raw) return null;
  const cashOnlyValue = optionalBoolean(raw.acceptsCashOnly);
  const values: Array<[HotelPaymentMethod, boolean | null]> = [
    ["credit_card", optionalBoolean(raw.acceptsCreditCards)],
    ["debit_card", optionalBoolean(raw.acceptsDebitCards)],
    ["contactless", optionalBoolean(raw.acceptsNfc)],
  ];
  const acceptedMethods = values.filter(([, accepted]) => accepted === true).map(([method]) => method);
  const notAcceptedMethods = values.filter(([, accepted]) => accepted === false).map(([method]) => method);
  const hasAnyExplicitValue = cashOnlyValue !== null || acceptedMethods.length > 0 || notAcceptedMethods.length > 0;
  if (!hasAnyExplicitValue) return null;

  // A listing that simultaneously says "cash only" and accepts another method is contradictory.
  const cashOnly = cashOnlyValue === true && acceptedMethods.length > 0 ? null : cashOnlyValue;
  const acceptedLabel = acceptedMethods.join(", ");
  const rejectedLabel = notAcceptedMethods.join(", ");
  const details = [
    cashOnly === true ? (languageCode === "ja" ? "現金のみ" : "cash only") : null,
    acceptedLabel ? (languageCode === "ja" ? `利用可: ${acceptedLabel}` : `accepted: ${acceptedLabel}`) : null,
    rejectedLabel ? (languageCode === "ja" ? `利用不可: ${rejectedLabel}` : `not accepted: ${rejectedLabel}`) : null,
  ].filter(Boolean).join(" / ");
  return {
    cashOnly,
    acceptedMethods,
    notAcceptedMethods,
    source: "google_listing",
    evidence: `${languageCode === "ja" ? "Google マップ掲載" : "Google Maps listing"}: ${details || (languageCode === "ja" ? "現金のみではない掲載" : "not listed as cash only")}`,
  };
}

const paymentPatterns: Array<{
  method: HotelPaymentMethod;
  accepted: RegExp;
  rejected?: RegExp;
}> = [
  {
    method: "credit_card",
    accepted: /(?:クレジット)?カード.{0,12}(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK)|(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK).{0,12}(?:クレジット)?カード|(?:credit )?cards?.{0,12}(?:accepted|worked)|paid by (?:credit )?card/i,
    rejected: /(?:クレジット)?カード.{0,12}(?:使えない|使えません|不可|非対応|NG)|(?:credit )?cards?.{0,12}(?:not accepted|unavailable|did(?: not|n't) work)|no (?:credit )?cards?/i,
  },
  {
    method: "debit_card",
    accepted: /デビットカード.{0,12}(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK)|(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK).{0,12}デビットカード|debit cards?.{0,12}(?:accepted|worked)/i,
    rejected: /デビットカード.{0,12}(?:使えない|使えません|不可|非対応|NG)|debit cards?.{0,12}(?:not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    method: "contactless",
    accepted: /(?:タッチ決済|コンタクトレス).{0,12}(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK)|(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK).{0,12}(?:タッチ決済|コンタクトレス)|(?:contactless|apple pay|google pay).{0,16}(?:accepted|worked|available)/i,
    rejected: /(?:タッチ決済|コンタクトレス).{0,12}(?:使えない|使えません|不可|非対応|NG)|(?:contactless|apple pay|google pay).{0,16}(?:not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    method: "qr_code",
    accepted: /(?:paypay|楽天ペイ|d払い|au\s*pay|メルペイ|コード決済|qr(?:コード)?決済|alipay|wechat pay).{0,16}(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK|accepted|worked|available)|(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK|accepts?).{0,16}(?:paypay|楽天ペイ|d払い|au\s*pay|メルペイ|コード決済|qr(?:コード)?決済|qr payments?|alipay|wechat pay)/i,
    rejected: /(?:paypay|楽天ペイ|d払い|au\s*pay|メルペイ|コード決済|qr(?:コード)?決済|qr payments?|alipay|wechat pay).{0,16}(?:使えない|使えません|不可|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    method: "transport_ic",
    accepted: /(?:交通系(?:ic)?|suica|pasmo|icカード).{0,16}(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK|accepted|worked|available)|(?:使え(?:た|る|ます|ました)|支払え(?:た|る|ます|ました)|利用(?:可|でき)|対応|OK|accepts?).{0,16}(?:交通系(?:ic)?|suica|pasmo|icカード)/i,
    rejected: /(?:交通系(?:ic)?|suica|pasmo|icカード).{0,16}(?:使えない|使えません|不可|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i,
  },
];

function reviewPaymentEvidence(reviews: HotelReviewExcerpt[] | null): HotelPaymentEvidence | null {
  if (!reviews) return null;
  const acceptedClaims = new Map<HotelPaymentMethod, string>();
  const rejectedClaims = new Map<HotelPaymentMethod, string>();
  const cashOnlyClaims: Array<{ value: boolean; evidence: string }> = [];
  for (const review of reviews) {
    if (/現金(?:のみ|だけ|しか)|cash[ -]?only|only (?:accepts? )?cash/i.test(review.text)) {
      cashOnlyClaims.push({ value: true, evidence: review.text });
    }
    if (/現金のみではない|現金だけではない|not cash[ -]?only/i.test(review.text)) {
      cashOnlyClaims.push({ value: false, evidence: review.text });
    }
    for (const pattern of paymentPatterns) {
      const rejected = pattern.rejected?.test(review.text) ?? false;
      const accepted = pattern.accepted.test(review.text) && !rejected;
      if (accepted) acceptedClaims.set(pattern.method, review.text);
      if (rejected) rejectedClaims.set(pattern.method, review.text);
    }
  }
  const acceptedMethods = [...acceptedClaims.keys()].filter((method) => !rejectedClaims.has(method));
  const notAcceptedMethods = [...rejectedClaims.keys()].filter((method) => !acceptedClaims.has(method));
  const cashValues = new Set(cashOnlyClaims.map(({ value }) => value));
  const cashOnly = cashValues.size === 1 && !acceptedMethods.length
    ? cashOnlyClaims[0].value
    : null;
  if (cashOnly === true) acceptedMethods.unshift("cash");
  const evidence = uniqueMethods([
    ...acceptedMethods.filter((method) => method !== "cash"),
    ...notAcceptedMethods,
  ]).flatMap((method) => [acceptedClaims.get(method) ?? rejectedClaims.get(method)]).filter(Boolean);
  if (cashOnlyClaims[0]) evidence.unshift(cashOnlyClaims[0].evidence);
  if (cashValues.size > 1 || acceptedMethods.some((method) => rejectedClaims.has(method))) {
    evidence.push("Conflicting payment reports; no assertion was made for the conflicting method.");
  }
  if (cashOnly === null && acceptedMethods.length === 0 && notAcceptedMethods.length === 0 && evidence.length === 0) return null;
  return {
    cashOnly,
    acceptedMethods: uniqueMethods(acceptedMethods),
    notAcceptedMethods: uniqueMethods(notAcceptedMethods),
    source: "google_review",
    evidence: evidence.join(" / ").slice(0, 360),
  };
}

function paymentEvidence(place: RawGooglePlace, reviews: HotelReviewExcerpt[] | null, languageCode: "en" | "ja"): HotelPaymentEvidence | null {
  const listing = listingPaymentEvidence(place.paymentOptions, languageCode);
  const review = reviewPaymentEvidence(reviews);
  if (!listing) return review;
  if (!review) return listing;

  const acceptedClaims = new Set([...listing.acceptedMethods, ...review.acceptedMethods]);
  const rejectedClaims = new Set([...listing.notAcceptedMethods, ...review.notAcceptedMethods]);
  const acceptedMethods = [...acceptedClaims].filter((method) => !rejectedClaims.has(method));
  const notAcceptedMethods = [...rejectedClaims].filter((method) => !acceptedClaims.has(method));
  const hasAlternative = acceptedMethods.some((method) => method !== "cash");
  const cashClaims = [listing.cashOnly, review.cashOnly].filter((value) => value !== null);
  const cashOnly = hasAlternative || new Set(cashClaims).size > 1
    ? null
    : cashClaims[0] ?? null;
  return {
    cashOnly,
    acceptedMethods,
    notAcceptedMethods,
    source: "google_listing_and_review",
    evidence: `${listing.evidence} / ${languageCode === "ja" ? "口コミ" : "review"}: ${review.evidence}`.slice(0, 360),
  };
}

const lodgingTypes = new Set([
  "bed_and_breakfast",
  "budget_japanese_inn",
  "cottage",
  "extended_stay_hotel",
  "farmstay",
  "guest_house",
  "hostel",
  "hotel",
  "inn",
  "japanese_inn",
  "lodging",
  "motel",
  "private_guest_room",
  "resort_hotel",
  "ryokan",
]);

const nearbyLodgingTypes = [...lodgingTypes].filter((type) => type !== "ryokan");

// Camping-style places carry Google's generic "lodging" type too, but a
// campground pitch or RV site is not what a hotel recommendation should
// return. Automatic searches exclude them; a query that names one keeps it.
const campingStyleTypes = new Set([
  "campground",
  "camping_cabin",
  "mobile_home_park",
  "rv_park",
]);

export function placeTypesIncludeLodging(placeTypes: readonly string[] | undefined) {
  return Boolean(placeTypes?.some((type) => lodgingTypes.has(type)));
}

function placeTypeList(place: RawGooglePlace) {
  const types = Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === "string") : [];
  const primaryType = boundedText(place.primaryType, 1, 100);
  return primaryType !== null ? [primaryType, ...types] : types;
}

function isOperationalLodging(place: RawGooglePlace) {
  return place.businessStatus === "OPERATIONAL" && placeTypeList(place).some((type) => lodgingTypes.has(type));
}

function isCampingStyleLodging(place: RawGooglePlace) {
  return placeTypeList(place).some((type) => campingStyleTypes.has(type));
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function scoreCandidate(
  rating: number | null,
  userRatingCount: number | null,
  routeBurden: number,
  routeWorstDistance: number,
  apiIndex: number,
  name: string,
  query?: string,
) {
  // Rating and review count are judged together, not added independently: the
  // Bayesian weighted rating shrinks a thin-sample 4.9★ toward the prior while
  // thousands of reviews let a merely-good average keep its full value. The
  // small volume bonus keeps a broad review base worth something on its own.
  const weightedRating = bayesianWeightedRating(rating, userRatingCount, hotelRatingPrior);
  const confidencePoints = weightedRating === null ? 0 : Math.max(0, Math.min(44, (weightedRating - 3) * 24));
  const volumePoints = Math.min(12, Math.log10((userRatingCount ?? 0) + 1) * 4);
  const qualityPoints = confidencePoints + volumePoints;
  // Absolute route fit remains meaningful on compact and multi-city trips;
  // unlike a linear cutoff it does not collapse every candidate to zero just
  // because one excursion day is far away.
  const routePoints = 18 / (1 + routeBurden / 12_000) + 8 / (1 + routeWorstDistance / 25_000);
  const relevancePoints = query ? Math.max(5, 35 - apiIndex * 6) : Math.max(0, 5 - apiIndex);
  const exactNamePoints = query && normalized(name).includes(normalized(query)) ? 18 : 0;
  return Math.round((qualityPoints + routePoints + relevancePoints + exactNamePoints) * 100) / 100;
}

function routeDistanceSummary(request: HotelSearchRequest, latitude: number, longitude: number) {
  const points = request.routePoints?.length
    ? request.routePoints
    : [{ latitude: request.latitude, longitude: request.longitude }];
  const distances = points.map((point) => distanceMeters(latitude, longitude, point.latitude, point.longitude));
  const average = Math.round(distances.reduce((sum, value) => sum + value, 0) / distances.length);
  const worst = Math.max(...distances);
  return {
    average,
    worst,
    burden: Math.round(average * 0.7 + worst * 0.3),
  };
}

async function searchHotelText(
  textQuery: string,
  request: HotelSearchRequest,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<RawGooglePlace[]> {
  const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      textQuery,
      includedType: "hotel",
      strictTypeFiltering: false,
      pageSize: 6,
      languageCode: request.languageCode,
      ...regionBias(request),
      rankPreference: "RELEVANCE",
      locationBias: {
        circle: {
          center: { latitude: request.latitude, longitude: request.longitude },
          radius: 10_000,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as { places?: RawGooglePlace[] };
  return (payload.places ?? []).slice(0, 6);
}

async function searchHotelsNearRouteCenter(
  request: HotelSearchRequest,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<RawGooglePlace[]> {
  const response = await fetcher("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      includedTypes: nearbyLodgingTypes,
      // searchNearby can exclude server-side (searchText cannot); the
      // client-side isCampingStyleLodging filter remains the guarantee.
      excludedTypes: [...campingStyleTypes],
      maxResultCount: 20,
      languageCode: request.languageCode,
      ...regionBias(request),
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: {
          center: { latitude: request.latitude, longitude: request.longitude },
          radius: 25_000,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as { places?: RawGooglePlace[] };
  return (payload.places ?? []).slice(0, 20);
}

export async function fetchGoogleHotelCandidates(
  request: HotelSearchRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<HotelCandidate[]> {
  // Named hotels keep one focused text search. Recommendations start with a
  // coordinate-restricted category search instead: an explicit area name in a
  // text query can override Google's location bias and pull the whole candidate
  // pool toward one excursion. Generic, coordinate-biased style searches are
  // optional additions so luxury and value remain comparable.
  const pages = request.query
    ? [await searchHotelText(destinationPlaceQuery(`${request.query} ${request.area}`, requestDestination(request), request.languageCode), request, apiKey, fetcher)]
    : await Promise.all([
      searchHotelsNearRouteCenter(request, apiKey, fetcher)
        .catch(() => searchHotelText(request.languageCode === "ja" ? "ホテル" : "hotels", request, apiKey, fetcher)),
      searchHotelText(request.languageCode === "ja" ? "高級ホテル" : "luxury hotels", request, apiKey, fetcher)
        .catch(() => [] as RawGooglePlace[]),
      searchHotelText(request.languageCode === "ja" ? "ビジネスホテル 格安" : "budget business hotels", request, apiKey, fetcher)
        .catch(() => [] as RawGooglePlace[]),
    ]);

  const seen = new Set<string>();
  const candidates: HotelCandidate[] = [];
  pages.forEach((places) => {
    places.forEach((place, apiIndex) => {
      if (!isOperationalLodging(place)) return;
      // Recommendations never surface campgrounds or RV parks; only a user
      // who explicitly typed such a place's name gets it back.
      if (!request.query && isCampingStyleLodging(place)) return;
      const id = boundedText(place.id, 1, 300);
      const name = boundedText(place.displayName?.text, 1, 200);
      const googleMapsUrl = boundedText(place.googleMapsUri, 1, 500);
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;
      if (!id || !name || !googleMapsUrl || !finiteCoordinate(latitude, -90, 90) || !finiteCoordinate(longitude, -180, 180)) return;
      if (seen.has(id)) return;
      seen.add(id);
      const distance = distanceMeters(request.latitude, request.longitude, latitude as number, longitude as number);
      const routeDistance = routeDistanceSummary(request, latitude as number, longitude as number);
      const rating = numericRating(place.rating);
      const userRatingCount = nonNegativeCount(place.userRatingCount);
      const priceLevel = parsePriceLevel(place.priceLevel);
      const reviews = parseReviews(place.reviews);
      candidates.push({
        id,
        name,
        address: boundedText(place.formattedAddress, 0, 350) ?? "",
        googleMapsUrl,
        websiteUrl: boundedText(place.websiteUri, 1, 500),
        latitude: latitude as number,
        longitude: longitude as number,
        rating,
        userRatingCount,
        distanceMeters: distance,
        routeAverageDistanceMeters: routeDistance.average,
        routeWorstDistanceMeters: routeDistance.worst,
        routeBurdenMeters: routeDistance.burden,
        score: scoreCandidate(rating, userRatingCount, routeDistance.burden, routeDistance.worst, apiIndex, name, request.query),
        googleRelevanceRank: apiIndex + 1,
        priceLevel,
        styles: hotelStyles(priceLevel, rating, userRatingCount),
        photo: parsePhoto(place.photos),
        reviews,
        payment: paymentEvidence(place, reviews, request.languageCode),
        rakuten: null,
      });
    });
  });

  // Google's locationBias is intentionally soft. For an area recommendation,
  // keep far-away text matches out when a usable local pool exists; an exact
  // named-hotel search is never clipped.
  const nearby = request.query ? candidates : candidates.filter((candidate) => candidate.distanceMeters <= 25_000);
  const eligible = nearby.length >= Math.min(3, candidates.length) ? nearby : candidates;
  const routeOrder = [...eligible].sort((left, right) => (
    left.routeBurdenMeters - right.routeBurdenMeters
    || left.routeWorstDistanceMeters - right.routeWorstDistanceMeters
    || left.name.localeCompare(right.name)
  ));
  const routeRank = new Map(routeOrder.map((candidate, index) => [candidate.id, index]));
  for (const candidate of eligible) {
    // Relative route rank keeps convenience decisive even when every hotel is
    // many kilometres from one excursion day.
    candidate.score = Math.round((candidate.score + Math.max(0, 24 - (routeRank.get(candidate.id) ?? 6) * 4)) * 100) / 100;
  }

  const ranked = eligible
    .sort((left, right) => right.score - left.score || left.googleRelevanceRank - right.googleRelevanceRank || left.name.localeCompare(right.name));
  // The shortlist is a comparison, not a top-N: best overall, closest to the
  // route, best rated, best value band and best luxury band each get a seat,
  // so the picks spread across price bands instead of clustering in one.
  const selected: HotelCandidate[] = [];
  const addPick = (candidate: HotelCandidate | undefined) => {
    if (candidate && !selected.some((existing) => existing.id === candidate.id)) selected.push(candidate);
  };
  addPick(ranked[0]);
  addPick([...ranked].sort((left, right) => left.routeBurdenMeters - right.routeBurdenMeters || left.routeWorstDistanceMeters - right.routeWorstDistanceMeters)[0]);
  addPick([...ranked]
    .filter((candidate) => candidate.rating !== null && (candidate.userRatingCount ?? 0) >= 50)
    .sort((left, right) => (
      (bayesianWeightedRating(right.rating, right.userRatingCount, hotelRatingPrior) ?? 0)
        - (bayesianWeightedRating(left.rating, left.userRatingCount, hotelRatingPrior) ?? 0)
      || (right.userRatingCount ?? 0) - (left.userRatingCount ?? 0)
    ))[0]);
  addPick(ranked.find((candidate) => candidate.styles.includes("value")));
  addPick(ranked.find((candidate) => candidate.styles.includes("luxury")));
  for (const candidate of ranked) {
    if (selected.length >= 5) break;
    addPick(candidate);
  }
  return selected.slice(0, 5);
}
