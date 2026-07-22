export type HotelSearchRequest = {
  latitude: number;
  longitude: number;
  area: string;
  query?: string;
  languageCode: "en" | "ja";
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
  distanceMeters: number;
  score: number;
  googleRelevanceRank: number;
  priceLevel: HotelPriceLevel | null;
  styles: HotelStyle[];
  photo: HotelPhoto | null;
  reviews: HotelReviewExcerpt[] | null;
  payment: HotelPaymentEvidence | null;
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
  if (!finiteCoordinate(source.latitude, 20, 46) || !finiteCoordinate(source.longitude, 122, 154)) return null;
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

  return {
    latitude: source.latitude as number,
    longitude: source.longitude as number,
    area,
    ...(query ? { query } : {}),
    languageCode: source.languageCode as HotelSearchRequest["languageCode"],
  };
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
  "cottage",
  "extended_stay_hotel",
  "farmstay",
  "guest_house",
  "hostel",
  "hotel",
  "lodging",
  "motel",
  "private_guest_room",
  "resort_hotel",
  "ryokan",
]);

function isOperationalLodging(place: RawGooglePlace) {
  if (place.businessStatus !== "OPERATIONAL") return false;
  const types = Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === "string") : [];
  const primaryType = boundedText(place.primaryType, 1, 100);
  return (primaryType !== null && lodgingTypes.has(primaryType)) || types.some((type) => lodgingTypes.has(type));
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function scoreCandidate(
  rating: number | null,
  userRatingCount: number | null,
  distance: number,
  apiIndex: number,
  name: string,
  query?: string,
) {
  const ratingPoints = rating === null ? 0 : Math.max(0, Math.min(32, (rating - 3) * 16));
  const reviewPoints = userRatingCount === null ? 0 : Math.min(24, Math.log10(userRatingCount + 1) * 7);
  const distancePoints = Math.max(0, 24 - distance / 500);
  const relevancePoints = query ? Math.max(5, 35 - apiIndex * 6) : Math.max(0, 5 - apiIndex);
  const exactNamePoints = query && normalized(name).includes(normalized(query)) ? 18 : 0;
  return Math.round((ratingPoints + reviewPoints + distancePoints + relevancePoints + exactNamePoints) * 100) / 100;
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
      regionCode: "JP",
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

export async function fetchGoogleHotelCandidates(
  request: HotelSearchRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<HotelCandidate[]> {
  // A named hotel keeps one focused search. An area search widens with a
  // luxury-leaning and a budget-leaning query so "luxury" and "value · high
  // rated" both have real Google-listed candidates — an area's top results
  // alone often sit in one price band, which left the other style unpickable.
  const queries = request.query
    ? [`${request.query} ${request.area} Japan`]
    : request.languageCode === "ja"
      ? [`${request.area} ホテル`, `${request.area} 高級ホテル`, `${request.area} ビジネスホテル 格安`]
      : [`${request.area} hotels`, `${request.area} luxury hotels`, `${request.area} budget business hotels`];
  const pages = await Promise.all(queries.map(async (textQuery, index) => {
    if (index === 0) return searchHotelText(textQuery, request, apiKey, fetcher);
    // The style-widening query is optional: its failure never hides the primary results.
    return searchHotelText(textQuery, request, apiKey, fetcher).catch(() => [] as RawGooglePlace[]);
  }));

  const seen = new Set<string>();
  const candidates: HotelCandidate[] = [];
  pages.forEach((places) => {
    places.forEach((place, apiIndex) => {
      if (!isOperationalLodging(place)) return;
      const id = boundedText(place.id, 1, 300);
      const name = boundedText(place.displayName?.text, 1, 200);
      const googleMapsUrl = boundedText(place.googleMapsUri, 1, 500);
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;
      if (!id || !name || !googleMapsUrl || !finiteCoordinate(latitude, -90, 90) || !finiteCoordinate(longitude, -180, 180)) return;
      if (seen.has(id)) return;
      seen.add(id);
      const distance = distanceMeters(request.latitude, request.longitude, latitude as number, longitude as number);
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
        score: scoreCandidate(rating, userRatingCount, distance, apiIndex, name, request.query),
        googleRelevanceRank: apiIndex + 1,
        priceLevel,
        styles: hotelStyles(priceLevel, rating, userRatingCount),
        photo: parsePhoto(place.photos),
        reviews,
        payment: paymentEvidence(place, reviews, request.languageCode),
      });
    });
  });

  const ranked = candidates
    .sort((left, right) => right.score - left.score || left.googleRelevanceRank - right.googleRelevanceRank || left.name.localeCompare(right.name));
  const selected = ranked.slice(0, 3);
  // Keep the best candidate of each style reachable even when the overall
  // top three happen to share one price band.
  for (const style of ["luxury", "value"] as const) {
    if (selected.some((candidate) => candidate.styles.includes(style))) continue;
    const best = ranked.find((candidate) => candidate.styles.includes(style));
    if (best) selected.push(best);
  }
  return selected.slice(0, 5);
}
