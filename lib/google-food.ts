import { evaluateGoogleOpeningAt } from "./google-opening-hours.ts";

export type FoodSearchRequest = {
  latitude: number;
  longitude: number;
  area: string;
  mealKind: "lunch" | "dinner";
  query: string;
  languageCode: "en" | "ja";
  visitDate?: string;
  visitTime?: string;
};

export type FoodReviewSnippet = {
  rating: number | null;
  text: string;
  publishedAt: string | null;
  relativeTime: string;
  authorName: string;
  authorUri: string | null;
  authorPhotoUri: string | null;
  googleMapsUrl: string | null;
};

export type FoodPaymentEvidence = {
  kind: "cash_only" | "cards" | "debit" | "contactless" | "qr" | "transport_ic";
  accepted: boolean;
  label: string;
  evidence: string;
  source: "listing" | "review";
  sourceUrl: string | null;
};

export type FoodCandidate = {
  id: string;
  name: string;
  address: string;
  type: string;
  googleMapsUrl: string;
  latitude?: number;
  longitude?: number;
  distanceMeters: number | null;
  rating: number | null;
  userRatingCount: number | null;
  openNow: boolean | null;
  plannedOpen?: boolean | null;
  hours: string[];
  businessStatus: string | null;
  paymentEvidence: FoodPaymentEvidence[];
  reviewSnippets: FoodReviewSnippet[];
  websiteUrl: string | null;
  photoName?: string;
  photoAttribution?: { name: string; uri: string };
  photoGoogleMapsUrl?: string;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  primaryTypeDisplayName?: { text?: string };
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: unknown };
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: unknown; periods?: unknown };
  paymentOptions?: {
    acceptsCashOnly?: boolean;
    acceptsCreditCards?: boolean;
    acceptsDebitCards?: boolean;
    acceptsNfc?: boolean;
  };
  reviews?: unknown;
  photos?: Array<{
    name?: string;
    googleMapsUri?: string;
    authorAttributions?: Array<{ displayName?: string; uri?: string }>;
  }>;
};

const validLanguages = new Set(["en", "ja"]);
const validMealKinds = new Set(["lunch", "dinner"]);
const searchRadiusMeters = 1_500;
const popularityPriorRating = 4.0;
const popularityPriorReviews = 120;

const fieldMask = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
  "places.location",
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours",
  "places.regularOpeningHours",
  "places.paymentOptions",
  "places.reviews",
  "places.photos",
].join(",");

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function defaultFoodDiscoveryQuery(languageCode: "en" | "ja") {
  return languageCode === "ja"
    ? "この土地で今行くべき人気店・名物"
    : "locally important and popular places worth eating at now";
}

export function parseFoodSearchRequest(input: unknown): FoodSearchRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.latitude !== "number" || !Number.isFinite(candidate.latitude) || candidate.latitude < 20 || candidate.latitude > 46) return null;
  if (typeof candidate.longitude !== "number" || !Number.isFinite(candidate.longitude) || candidate.longitude < 122 || candidate.longitude > 154) return null;
  if (typeof candidate.languageCode !== "string" || !validLanguages.has(candidate.languageCode)) return null;
  if (typeof candidate.mealKind !== "string" || !validMealKinds.has(candidate.mealKind)) return null;
  const languageCode = candidate.languageCode as FoodSearchRequest["languageCode"];
  const area = boundedText(candidate.area, 1, 80);
  const suppliedQuery = boundedText(candidate.query, 1, 120);
  const queryMissing = candidate.query === undefined || candidate.query === null || candidate.query === "";
  const visitDate = candidate.visitDate === undefined || candidate.visitDate === null ? null : boundedText(candidate.visitDate, 10, 10);
  const visitTime = candidate.visitTime === undefined || candidate.visitTime === null ? null : boundedText(candidate.visitTime, 5, 5);
  const hasVisitPair = visitDate !== null && visitTime !== null;
  const hasNoVisitPair = candidate.visitDate == null && candidate.visitTime == null;
  if (!area || (!suppliedQuery && !queryMissing)) return null;
  if (!hasNoVisitPair && (!hasVisitPair || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate!) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(visitTime!))) return null;
  return {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    area,
    mealKind: candidate.mealKind as FoodSearchRequest["mealKind"],
    query: suppliedQuery ?? defaultFoodDiscoveryQuery(languageCode),
    languageCode,
    ...(hasVisitPair ? { visitDate: visitDate!, visitTime: visitTime! } : {}),
  };
}

function normalizeReview(input: unknown, languageCode: "en" | "ja"): FoodReviewSnippet | null {
  if (!input || typeof input !== "object") return null;
  const review = input as Record<string, unknown>;
  const localizedText = review.text as { text?: string } | undefined;
  const author = review.authorAttribution as { displayName?: string; uri?: string; photoUri?: string } | undefined;
  const text = boundedText(localizedText?.text, 1, 2_000)?.slice(0, 360);
  if (!text) return null;
  return {
    rating: optionalNumber(review.rating),
    text,
    publishedAt: boundedText(review.publishTime, 1, 80),
    relativeTime: boundedText(review.relativePublishTimeDescription, 1, 80) ?? "",
    authorName: boundedText(author?.displayName, 1, 120) ?? (languageCode === "ja" ? "Googleユーザー" : "Google user"),
    authorUri: boundedText(author?.uri, 1, 500),
    authorPhotoUri: boundedText(author?.photoUri, 1, 500),
    googleMapsUrl: boundedText(review.googleMapsUri, 1, 500),
  };
}

type FoodPaymentMethod = Exclude<FoodPaymentEvidence["kind"], "cash_only">;

const reviewPaymentPatterns: Array<{
  kind: FoodPaymentMethod;
  accepted: RegExp;
  rejected: RegExp;
}> = [
  {
    kind: "cards",
    accepted: /(?:カード|クレジット(?:カード)?).{0,12}(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK)|(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK).{0,12}(?:カード|クレジット(?:カード)?)|(?:credit\s+)?cards?.{0,12}(?:accepted|worked)|accepts?\s+(?:credit\s+)?cards?/i,
    rejected: /(?:カード|クレジット(?:カード)?).{0,12}(?:不可|使えない|使えません|支払えない|非対応|NG)|no\s+(?:credit\s+)?cards?|(?:credit\s+)?cards?.{0,12}(?:not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    kind: "debit",
    accepted: /デビットカード.{0,12}(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK)|debit cards?.{0,12}(?:accepted|worked)/i,
    rejected: /デビットカード.{0,12}(?:不可|使えない|使えません|支払えない|非対応|NG)|debit cards?.{0,12}(?:not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    kind: "contactless",
    accepted: /(?:タッチ決済|iD|QUICPay|contactless|NFC|Apple\s*Pay|Google\s*Pay).{0,14}(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK|accepted|worked)|(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK|accepts?).{0,14}(?:タッチ決済|iD|QUICPay|contactless|NFC|Apple\s*Pay|Google\s*Pay)/i,
    rejected: /(?:タッチ決済|iD|QUICPay|contactless|NFC|Apple\s*Pay|Google\s*Pay).{0,14}(?:不可|使えない|使えません|支払えない|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    kind: "qr",
    accepted: /(?:PayPay|楽天ペイ|d払い|au\s*PAY|LINE\s*Pay|メルペイ|コード決済|QR(?:コード)?決済|Alipay|WeChat\s*Pay).{0,14}(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK|accepted|worked)|(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK|accepts?).{0,14}(?:PayPay|楽天ペイ|d払い|au\s*PAY|LINE\s*Pay|メルペイ|コード決済|QR(?:コード)?決済|Alipay|WeChat\s*Pay)/i,
    rejected: /(?:PayPay|楽天ペイ|d払い|au\s*PAY|LINE\s*Pay|メルペイ|コード決済|QR(?:コード)?決済|Alipay|WeChat\s*Pay).{0,14}(?:不可|使えない|使えません|支払えない|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i,
  },
  {
    kind: "transport_ic",
    accepted: /(?:交通系(?:IC)?|Suica|PASMO|ICOCA|ICカード).{0,14}(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK|accepted|worked)|(?:使え(?:る|た|ます|ました)|支払え(?:る|た|ます|ました)|利用可|対応|OK|accepts?).{0,14}(?:交通系(?:IC)?|Suica|PASMO|ICOCA|ICカード)/i,
    rejected: /(?:交通系(?:IC)?|Suica|PASMO|ICOCA|ICカード).{0,14}(?:不可|使えない|使えません|支払えない|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i,
  },
];

export function extractPaymentEvidence(
  payment: GooglePlace["paymentOptions"],
  reviews: FoodReviewSnippet[],
  languageCode: "en" | "ja",
): FoodPaymentEvidence[] {
  const ja = languageCode === "ja";
  type Claim = Omit<FoodPaymentEvidence, "kind" | "label"> & { accepted: boolean };
  const claims = new Map<FoodPaymentMethod, Claim[]>();
  const addClaim = (kind: FoodPaymentMethod, claim: Claim) => {
    claims.set(kind, [...(claims.get(kind) ?? []), claim]);
  };
  const listing = ja ? "Google Mapsの店舗掲載" : "Google Maps listing";
  const listingValues: Array<[FoodPaymentMethod, boolean | undefined]> = [
    ["cards", payment?.acceptsCreditCards],
    ["debit", payment?.acceptsDebitCards],
    ["contactless", payment?.acceptsNfc],
  ];
  for (const [kind, accepted] of listingValues) {
    if (typeof accepted === "boolean") addClaim(kind, { accepted, evidence: listing, source: "listing", sourceUrl: null });
  }
  for (const review of reviews) {
    for (const pattern of reviewPaymentPatterns) {
      const rejected = pattern.rejected.test(review.text);
      if (pattern.accepted.test(review.text) && !rejected) addClaim(pattern.kind, {
        accepted: true,
        evidence: review.text,
        source: "review",
        sourceUrl: review.googleMapsUrl,
      });
      if (rejected) addClaim(pattern.kind, {
        accepted: false,
        evidence: review.text,
        source: "review",
        sourceUrl: review.googleMapsUrl,
      });
    }
  }

  const resolved = new Map<FoodPaymentMethod, Claim>();
  for (const [kind, methodClaims] of claims) {
    const values = new Set(methodClaims.map(({ accepted }) => accepted));
    if (values.size === 1) resolved.set(kind, methodClaims[0]);
  }

  const evidence: FoodPaymentEvidence[] = [];
  const cashClaims: Claim[] = [];
  if (typeof payment?.acceptsCashOnly === "boolean") cashClaims.push({
    accepted: payment.acceptsCashOnly,
    evidence: listing,
    source: "listing",
    sourceUrl: null,
  });
  for (const review of reviews) {
    if (/現金(?:のみ|だけ|しか)|キャッシュオンリー|cash[\s-]?only|only\s+(?:takes?|accepts?)\s+cash/i.test(review.text)) cashClaims.push({
      accepted: true,
      evidence: review.text,
      source: "review",
      sourceUrl: review.googleMapsUrl,
    });
    if (/現金のみではない|現金だけではない|not cash[\s-]?only/i.test(review.text)) cashClaims.push({
      accepted: false,
      evidence: review.text,
      source: "review",
      sourceUrl: review.googleMapsUrl,
    });
  }
  const cashValues = new Set(cashClaims.map(({ accepted }) => accepted));
  const nonCashAccepted = [...resolved.values()].some(({ accepted }) => accepted);
  if (cashValues.size === 1 && cashClaims[0]?.accepted === true && !nonCashAccepted) {
    const claim = cashClaims[0];
    evidence.push({
      kind: "cash_only",
      label: claim.source === "listing"
        ? (ja ? "現金のみの掲載" : "Listed as cash only")
        : (ja ? "口コミで現金のみとの報告" : "Cash-only reported in a review"),
      ...claim,
    });
  }

  const labels: Record<FoodPaymentMethod, [string, string, string, string]> = {
    cards: ["カード可", "カード不可", "Cards accepted", "Cards not accepted"],
    debit: ["デビットカード可", "デビットカード不可", "Debit cards accepted", "Debit cards not accepted"],
    contactless: ["タッチ決済可", "タッチ決済不可", "Contactless accepted", "Contactless not accepted"],
    qr: ["コード決済可", "コード決済不可", "QR payment accepted", "QR payment not accepted"],
    transport_ic: ["交通系IC可", "交通系IC不可", "Transit IC accepted", "Transit IC not accepted"],
  };
  for (const kind of ["cards", "debit", "contactless", "qr", "transport_ic"] as const) {
    const claim = resolved.get(kind);
    if (!claim) continue;
    const label = labels[kind][ja ? (claim.accepted ? 0 : 1) : (claim.accepted ? 2 : 3)];
    evidence.push({ kind, label, ...claim });
  }
  return evidence.slice(0, 4);
}

function distanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(toLatitude - fromLatitude);
  const deltaLongitude = radians(toLongitude - fromLongitude);
  const startLatitude = radians(fromLatitude);
  const endLatitude = radians(toLatitude);
  const halfChord = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord)));
}

export function foodPopularityScore(candidate: Pick<FoodCandidate, "rating" | "userRatingCount" | "openNow" | "distanceMeters">) {
  const reviewCount = Math.max(0, candidate.userRatingCount ?? 0);
  const rating = candidate.rating ?? popularityPriorRating;
  const bayesianRating = (rating * reviewCount + popularityPriorRating * popularityPriorReviews)
    / (reviewCount + popularityPriorReviews);
  const reviewVolume = Math.log10(reviewCount + 1);
  // Proximity matters, but lightly: a notably better local place can still win.
  const distanceAdjustment = Math.min(0.4, (candidate.distanceMeters ?? searchRadiusMeters) / 5_000);
  // openNow describes the request moment, not the future lunch/dinner window.
  return bayesianRating + reviewVolume * 0.18 - distanceAdjustment;
}

export function rankFoodCandidates(candidates: FoodCandidate[]) {
  return [...candidates]
    .filter((candidate) => candidate.businessStatus !== "CLOSED_PERMANENTLY" && candidate.businessStatus !== "CLOSED_TEMPORARILY" && candidate.plannedOpen !== false)
    .sort((left, right) => {
      const scoreDifference = foodPopularityScore(right) - foodPopularityScore(left);
      if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;
      const reviewDifference = (right.userRatingCount ?? 0) - (left.userRatingCount ?? 0);
      if (reviewDifference !== 0) return reviewDifference;
      return left.id.localeCompare(right.id);
    })
    .slice(0, 3);
}

function parseCandidate(place: GooglePlace, request: FoodSearchRequest): FoodCandidate | null {
  const name = place.displayName?.text?.trim();
  const googleMapsUrl = place.googleMapsUri?.trim();
  if (!place.id || !name || !googleMapsUrl) return null;
  const latitude = optionalNumber(place.location?.latitude);
  const longitude = optionalNumber(place.location?.longitude);
  const currentHours = place.currentOpeningHours;
  const regularHours = place.regularOpeningHours;
  const reviews = Array.isArray(place.reviews)
    ? place.reviews.slice(0, 5).flatMap((review) => {
      const normalized = normalizeReview(review, request.languageCode);
      return normalized ? [normalized] : [];
    })
    : [];
  const photo = place.photos?.[0];
  const attribution = photo?.authorAttributions?.[0];
  const businessStatus = boundedText(place.businessStatus, 1, 80);
  const plannedOpening = request.visitDate && request.visitTime
    ? evaluateGoogleOpeningAt({
      businessStatus,
      regularOpeningPeriods: regularHours?.periods,
    }, { date: request.visitDate, time: request.visitTime })
    : null;

  return {
    id: place.id,
    name,
    address: place.formattedAddress?.trim() ?? "",
    type: place.primaryTypeDisplayName?.text?.trim() ?? (request.languageCode === "ja" ? "飲食店" : "Restaurant"),
    googleMapsUrl,
    ...(latitude !== null && longitude !== null ? { latitude, longitude } : {}),
    distanceMeters: latitude !== null && longitude !== null
      ? distanceMeters(request.latitude, request.longitude, latitude, longitude)
      : null,
    rating: optionalNumber(place.rating),
    userRatingCount: optionalNumber(place.userRatingCount),
    openNow: optionalBoolean(currentHours?.openNow ?? regularHours?.openNow),
    plannedOpen: plannedOpening?.status === "open" ? true : plannedOpening?.status === "closed" ? false : null,
    hours: (Array.isArray(currentHours?.weekdayDescriptions)
      ? currentHours.weekdayDescriptions
      : Array.isArray(regularHours?.weekdayDescriptions) ? regularHours.weekdayDescriptions : []) as string[],
    businessStatus,
    paymentEvidence: extractPaymentEvidence(place.paymentOptions, reviews, request.languageCode),
    reviewSnippets: reviews,
    websiteUrl: boundedText(place.websiteUri, 1, 500),
    ...(photo?.name ? { photoName: photo.name } : {}),
    ...(attribution?.displayName && attribution.uri ? {
      photoAttribution: { name: attribution.displayName, uri: attribution.uri },
    } : {}),
    ...(photo?.googleMapsUri ? { photoGoogleMapsUrl: photo.googleMapsUri } : {}),
  };
}

function isLocalHighlightsRequest(request: FoodSearchRequest) {
  return request.query === defaultFoodDiscoveryQuery(request.languageCode);
}

export async function fetchGoogleFoodCandidates(
  request: FoodSearchRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<FoodCandidate[]> {
  const localHighlights = isLocalHighlightsRequest(request);
  const url = localHighlights
    ? "https://places.googleapis.com/v1/places:searchNearby"
    : "https://places.googleapis.com/v1/places:searchText";
  const body = localHighlights ? {
    includedTypes: ["restaurant"],
    maxResultCount: 10,
    languageCode: request.languageCode,
    regionCode: "JP",
    rankPreference: "POPULARITY",
    locationRestriction: {
      circle: {
        center: { latitude: request.latitude, longitude: request.longitude },
        radius: searchRadiusMeters,
      },
    },
  } : {
    textQuery: `${request.query} ${request.area}`,
    includedType: "restaurant",
    strictTypeFiltering: true,
    pageSize: 8,
    languageCode: request.languageCode,
    regionCode: "JP",
    rankPreference: "RELEVANCE",
    locationBias: {
      circle: {
        center: { latitude: request.latitude, longitude: request.longitude },
        radius: searchRadiusMeters,
      },
    },
  };
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as { places?: GooglePlace[] };
  return rankFoodCandidates((payload.places ?? []).flatMap((place) => {
    const candidate = parseCandidate(place, request);
    return candidate ? [candidate] : [];
  }));
}
