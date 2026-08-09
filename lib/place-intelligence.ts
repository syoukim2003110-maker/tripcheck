import { FOOD_RANKING_MODEL } from "./ai-food-ranking.ts";
import { anthropicTimeoutMs, postAnthropicMessages } from "./anthropic-runtime.ts";
import { destinationById, destinationPlaceQuery, isDestinationChoice } from "./destinations.ts";
import type { DestinationChoice } from "./destinations.ts";

export type PlaceIntelligenceRequest = {
  name: string;
  area: string;
  latitude: number;
  longitude: number;
  /** Exact Google Place ID retained from resolution when available. */
  providerRef?: string;
  languageCode: "en" | "ja";
  /** Country the stop belongs to; "auto" searches without a region bias. */
  destination: DestinationChoice;
  /**
   * P0 needs identity and opening hours only. Rich reviews/photos/payment are
   * a separate enrichment surface and must not leak into the core field mask.
   */
  scope?: "planning" | "enrichment";
};

export type PlaceReviewEvidence = {
  rating: number | null;
  text: string;
  publishedAt: string | null;
  relativeTime: string;
  authorName: string;
  authorUri: string | null;
  googleMapsUri: string | null;
};

export type PaymentObservation = {
  method: "cash" | "card" | "qr" | "transport_ic";
  accepted: boolean;
  label: string;
  excerpt: string;
  publishedAt: string | null;
  source: "google_review";
};

export type PlaceIntelSignal = {
  kind: "hours" | "payment" | "crowd" | "closure" | "access" | "freshness";
  severity: "info" | "warning" | "unknown";
  title: string;
  detail: string;
  evidence: string;
};

export type PlaceIntelligenceResult = {
  provider: "google_places";
  checkedAt: string;
  analyzedBy: "anthropic" | "rules";
  place: {
    name: string;
    address: string;
    googleMapsUrl: string;
    websiteUrl: string | null;
    businessStatus: string | null;
    rating: number | null;
    userRatingCount: number | null;
    openNow: boolean | null;
    hours: string[];
    currentOpeningPeriods?: unknown[] | null;
    currentSpecialDays?: unknown[] | null;
    regularOpeningPeriods?: unknown[] | null;
    photoName?: string | null;
    photoAttribution?: { name: string; uri: string } | null;
    payment: {
      cashOnly: boolean | null;
      creditCards: boolean | null;
      debitCards: boolean | null;
      nfc: boolean | null;
      observations: PaymentObservation[];
    };
  };
  reviews: PlaceReviewEvidence[];
  analysis: {
    summary: string;
    confidence: "high" | "medium" | "low";
    signals: PlaceIntelSignal[];
    nextCheck: string;
  };
  links: {
    x: string;
    instagram: string;
  };
};

const analysisSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    signals: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["hours", "payment", "crowd", "closure", "access", "freshness"] },
          severity: { type: "string", enum: ["info", "warning", "unknown"] },
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["kind", "severity", "title", "detail", "evidence"],
        additionalProperties: false,
      },
    },
    nextCheck: { type: "string" },
  },
  required: ["summary", "confidence", "signals", "nextCheck"],
  additionalProperties: false,
} as const;

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function excerptAroundMatch(text: string, matchIndex: number) {
  const start = Math.max(0, matchIndex - 38);
  const end = Math.min(text.length, matchIndex + 86);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function extractPaymentObservations(reviews: PlaceReviewEvidence[]): PaymentObservation[] {
  const patterns: Array<{
    method: PaymentObservation["method"];
    accepted: boolean;
    label: string;
    pattern: RegExp;
  }> = [
    { method: "cash", accepted: true, label: "Cash only", pattern: /現金(?:のみ|だけ|しか(?:使え|対応))|キャッシュオンリー|cash[ -]?only|only\s+accept(?:s|ed)?\s+cash/i },
    { method: "card", accepted: false, label: "Cards not accepted", pattern: /(?:クレジット)?カード(?:は|が)?(?:使えない|使えません|不可|非対応)|no\s+(?:credit\s+)?cards?|cards?\s+(?:are\s+)?not\s+accepted/i },
    { method: "card", accepted: true, label: "Cards accepted", pattern: /(?:クレジット)?カード.{0,12}(?:使え(?:た|ます|ました|る)|支払え(?:た|ます|ました|る)|利用可|対応|OK)|カード(?:決済|払い)(?:可|対応)|クレジットカード(?:可|対応)|cards?.{0,12}(?:accepted|worked)|paid\s+by\s+(?:credit\s+)?card/i },
    { method: "qr", accepted: false, label: "QR / code payment not accepted", pattern: /(?:PayPay|楽天ペイ|d払い|au\s*PAY|メルペイ|コード決済|QR(?:コード)?決済|Alipay|WeChat\s*Pay).{0,14}(?:不可|使えない|使えません|支払えない|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i },
    { method: "qr", accepted: true, label: "QR / code payment accepted", pattern: /(?:PayPay|楽天ペイ|d払い|au\s*PAY|メルペイ|コード決済|QR(?:コード)?決済|Alipay|WeChat\s*Pay).{0,14}(?:使え(?:た|ます|ました|る)|支払え(?:た|ます|ました|る)|利用可|対応|OK|accepted|worked)|(?:使え(?:た|ます|ました|る)|支払え(?:た|ます|ました|る)|利用可|対応|OK|accepts?).{0,14}(?:PayPay|楽天ペイ|d払い|au\s*PAY|メルペイ|コード決済|QR(?:コード)?決済|Alipay|WeChat\s*Pay)/i },
    { method: "transport_ic", accepted: false, label: "Transit IC not accepted", pattern: /(?:Suica|PASMO|ICOCA|交通系\s*IC|ICカード|transit\s+IC).{0,14}(?:不可|使えない|使えません|支払えない|非対応|NG|not accepted|unavailable|did(?: not|n't) work)/i },
    { method: "transport_ic", accepted: true, label: "Transit IC accepted", pattern: /(?:Suica|PASMO|ICOCA|交通系\s*IC|ICカード|transit\s+IC).{0,14}(?:使え(?:た|ます|ました|る)|支払え(?:た|ます|ました|る)|利用可|対応|OK|accepted|worked)|(?:使え(?:た|ます|ました|る)|支払え(?:た|ます|ました|る)|利用可|対応|OK|accepts?).{0,14}(?:Suica|PASMO|ICOCA|交通系\s*IC|ICカード|transit\s+IC)/i },
  ];
  const observations: PaymentObservation[] = [];
  for (const review of reviews) {
    for (const candidate of patterns) {
      const match = review.text.match(candidate.pattern);
      if (!match || typeof match.index !== "number") continue;
      if (candidate.accepted && patterns.some((pattern) => pattern.method === candidate.method
        && !pattern.accepted
        && pattern.pattern.test(review.text))) continue;
      observations.push({
        method: candidate.method,
        accepted: candidate.accepted,
        label: candidate.label,
        excerpt: excerptAroundMatch(review.text, match.index),
        publishedAt: review.publishedAt,
        source: "google_review",
      });
    }
  }
  const valuesByMethod = new Map<PaymentObservation["method"], Set<boolean>>();
  for (const observation of observations) {
    const values = valuesByMethod.get(observation.method) ?? new Set<boolean>();
    values.add(observation.accepted);
    valuesByMethod.set(observation.method, values);
  }
  const positiveNonCash = observations.some((observation) => observation.method !== "cash"
    && observation.accepted
    && valuesByMethod.get(observation.method)?.size === 1);
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (valuesByMethod.get(observation.method)?.size !== 1) return false;
    // "Cash only" contradicts any explicit report that a non-cash method worked.
    if (observation.method === "cash" && positiveNonCash) return false;
    const key = `${observation.method}:${observation.accepted}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function reconcilePaymentEvidence(
  payment: Record<string, unknown> | undefined,
  reviews: PlaceReviewEvidence[],
) {
  let cashOnly = optionalBoolean(payment?.acceptsCashOnly);
  let creditCards = optionalBoolean(payment?.acceptsCreditCards);
  const debitCards = optionalBoolean(payment?.acceptsDebitCards);
  const nfc = optionalBoolean(payment?.acceptsNfc);
  const reviewObservations = extractPaymentObservations(reviews);
  let observations = reviewObservations;

  // A listing and an individual review are independent evidence. When they
  // explicitly disagree about the same method, present neither claim as fact.
  const cardObservation = reviewObservations.find(({ method }) => method === "card");
  if (cardObservation && creditCards !== null && cardObservation.accepted !== creditCards) {
    creditCards = null;
    observations = observations.filter(({ method }) => method !== "card");
  }

  const cashObservation = reviewObservations.find(({ method }) => method === "cash");
  if (cashObservation && cashOnly !== null && cashObservation.accepted !== cashOnly) {
    cashOnly = null;
    observations = observations.filter(({ method }) => method !== "cash");
  }

  const listingAcceptsNonCash = optionalBoolean(payment?.acceptsCreditCards) === true
    || debitCards === true
    || nfc === true;
  const reviewAcceptsNonCash = reviewObservations.some(({ method, accepted }) => method !== "cash" && accepted);

  // "Cash only" is a stronger assertion than any individual method. Any
  // explicit non-cash success report makes that assertion unsafe, even if a
  // separate source disagrees about the particular non-cash method.
  if (cashOnly === true && (listingAcceptsNonCash || reviewAcceptsNonCash)) cashOnly = null;
  if (listingAcceptsNonCash) observations = observations.filter(({ method }) => method !== "cash");

  return { cashOnly, creditCards, debitCards, nfc, observations };
}

export function parsePlaceIntelligenceRequest(input: unknown): PlaceIntelligenceRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const name = boundedText(source.name, 1, 160);
  const area = boundedText(source.area, 1, 100);
  const latitude = typeof source.latitude === "number" && Number.isFinite(source.latitude) && source.latitude >= -90 && source.latitude <= 90 ? source.latitude : null;
  const longitude = typeof source.longitude === "number" && Number.isFinite(source.longitude) && source.longitude >= -180 && source.longitude <= 180 ? source.longitude : null;
  const providerRef = source.providerRef === undefined ? undefined : boundedText(source.providerRef, 4, 256);
  if (!name || !area || latitude === null || longitude === null || (source.languageCode !== "ja" && source.languageCode !== "en")) return null;
  if (source.providerRef !== undefined && (!providerRef || !/^[A-Za-z0-9_-]+$/.test(providerRef))) return null;
  return {
    name,
    area,
    latitude,
    longitude,
    ...(providerRef ? { providerRef } : {}),
    languageCode: source.languageCode,
    destination: isDestinationChoice(source.destination) ? source.destination : "auto",
    ...(source.scope === "planning" || source.scope === "enrichment" ? { scope: source.scope } : {}),
  };
}

function socialLinks(name: string, area: string) {
  const phrase = `"${name}" ${area}`;
  return {
    x: `https://x.com/search?q=${encodeURIComponent(`${phrase} -filter:replies`)}&src=typed_query&f=live`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(`${name} ${area}`)}`,
  };
}

function rulesAnalysis(result: Omit<PlaceIntelligenceResult, "analysis" | "analyzedBy">, languageCode: "en" | "ja") {
  const ja = languageCode === "ja";
  const signals: PlaceIntelSignal[] = [];
  if (result.place.openNow !== null) {
    signals.push({
      kind: "hours",
      severity: result.place.openNow ? "info" : "warning",
      title: result.place.openNow ? (ja ? "現在は営業表示" : "Listed as open now") : (ja ? "現在は営業時間外表示" : "Listed as closed now"),
      detail: result.place.hours[0] ?? (ja ? "当日の最終受付は公式情報も確認してください。" : "Check the official source for last entry."),
      evidence: "Google Maps listing",
    });
  }
  if (result.place.payment.cashOnly === true) {
    signals.push({
      kind: "payment",
      severity: "warning",
      title: ja ? "現金のみの掲載" : "Listed as cash only",
      detail: ja ? "訪問前に現金を用意してください。" : "Bring cash before visiting.",
      evidence: "Google Maps payment options",
    });
  } else if (result.place.payment.creditCards === true) {
    signals.push({
      kind: "payment",
      severity: "info",
      title: ja ? "カード利用可の掲載" : "Cards listed as accepted",
      detail: ja ? "利用可能ブランドは現地で確認してください。" : "Confirm the supported card brand on arrival.",
      evidence: "Google Maps payment options",
    });
  } else if (result.place.payment.observations.length > 0) {
    const observation = result.place.payment.observations[0];
    const title = observation.method === "cash"
      ? (ja ? "口コミに現金のみとの報告" : "A review reports cash only")
      : observation.method === "card" && !observation.accepted
        ? (ja ? "口コミにカード不可との報告" : "A review reports cards are not accepted")
        : observation.method === "qr"
          ? observation.accepted
            ? (ja ? "口コミにコード決済の利用報告" : "A review reports code payment")
            : (ja ? "口コミにコード決済不可との報告" : "A review reports code payment is not accepted")
          : observation.method === "transport_ic"
            ? observation.accepted
              ? (ja ? "口コミに交通系ICの利用報告" : "A review reports transit IC payment")
              : (ja ? "口コミに交通系IC不可との報告" : "A review reports transit IC is not accepted")
            : (ja ? "口コミにカード利用の報告" : "A review reports card payment");
    signals.push({
      kind: "payment",
      severity: observation.accepted && observation.method !== "cash" ? "info" : "warning",
      title,
      detail: observation.excerpt,
      evidence: "Google review (individual report)",
    });
  }
  if (result.place.websiteUrl === null) {
    signals.push({
      kind: "freshness",
      severity: "info",
      title: ja ? "公式サイトの掲載なし" : "No official site listed",
      detail: ja ? "InstagramやXの投稿が一番新しい一次情報かもしれません。臨時休業は当日に確認を。" : "Instagram or X posts may be the freshest first-hand source. Recheck closures on the day.",
      evidence: "Google Maps listing",
    });
  }
  if (result.reviews.length === 0) {
    signals.push({
      kind: "freshness",
      severity: "unknown",
      title: ja ? "最近の体験談は未確認" : "No recent firsthand report checked",
      detail: ja ? "X・Instagram・公式サイトを出発前に確認してください。" : "Check X, Instagram and the official site before departure.",
      evidence: "No review evidence returned",
    });
  }
  return {
    summary: ja
      ? "Google掲載情報を確認しました。未掲載の条件は推測せず、出発前の再確認項目として残しています。"
      : "Google listing data was checked. Missing conditions remain explicit instead of being guessed.",
    confidence: (result.place.hours.length > 0 ? "medium" : "low") as "medium" | "low",
    signals: signals.slice(0, 4),
    nextCheck: ja ? "当日に公式サイトと最新投稿をもう一度確認" : "Recheck the official site and latest posts on the day",
  };
}

function parseAnalysis(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const summary = boundedText(source.summary, 1, 240);
  const nextCheck = boundedText(source.nextCheck, 1, 160);
  if (!summary || !nextCheck || !["high", "medium", "low"].includes(String(source.confidence)) || !Array.isArray(source.signals)) return null;
  const signals = source.signals.slice(0, 4).flatMap((signal) => {
    if (!signal || typeof signal !== "object") return [];
    const item = signal as Record<string, unknown>;
    const kind = String(item.kind) as PlaceIntelSignal["kind"];
    const severity = String(item.severity) as PlaceIntelSignal["severity"];
    const title = boundedText(item.title, 1, 80);
    const detail = boundedText(item.detail, 1, 220);
    const evidence = boundedText(item.evidence, 1, 100);
    if (!title || !detail || !evidence || !["hours", "payment", "crowd", "closure", "access", "freshness"].includes(kind) || !["info", "warning", "unknown"].includes(severity)) return [];
    return [{ kind, severity, title, detail, evidence }];
  });
  return { summary, confidence: source.confidence as "high" | "medium" | "low", signals, nextCheck };
}

async function fetchAnthropicAnalysis(
  result: Omit<PlaceIntelligenceResult, "analysis" | "analyzedBy">,
  languageCode: "en" | "ja",
  apiKey: string,
  fetcher: typeof fetch,
) {
  // Null fields carry no evidence, so they are stripped to keep the prompt small and the response fast.
  const compact = (record: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));
  const evidence = {
    listing: compact({
      businessStatus: result.place.businessStatus,
      openNow: result.place.openNow,
      hours: result.place.hours.length > 0 ? result.place.hours : null,
      payment: compact({ ...result.place.payment }),
      rating: result.place.rating,
      userRatingCount: result.place.userRatingCount,
    }),
    reviews: result.reviews.map((review, index) => compact({
      id: `review_${index + 1}`,
      publishedAt: review.publishedAt,
      relativeTime: review.relativeTime,
      rating: review.rating,
      text: review.text,
    })),
  };
  const languageRule = languageCode === "ja"
    ? "自然な日本語で。要約は80文字以内、各詳細は70文字以内。"
    : "Use natural English. Keep the summary under 25 words and each detail under 20 words.";
  const response = await postAnthropicMessages(apiKey, {
    model: FOOD_RANKING_MODEL,
    max_tokens: 440,
    temperature: 0,
    system: "Audit one travel stop using only the supplied evidence. The listing is platform data; reviews are individual reports, not confirmed facts. Identify only explicit evidence about hours, early closing, payment, crowds, closures or access friction. Prioritize evidence that reality differs from the listing: earlier last entry or sell-outs than posted hours, crowd cutoffs, irregular holidays, cash-only in practice, or detours to reach the place. Never infer missing facts. If evidence is absent, mark it unknown. Cite listing or review_N in every signal.",
    messages: [{ role: "user", content: JSON.stringify({ task: languageRule, evidence }) }],
    output_config: { format: { type: "json_schema", schema: analysisSchema } },
  }, {
    fetcher,
    signal: AbortSignal.timeout(anthropicTimeoutMs(5_000)),
  });
  if (!response.ok) throw new Error("anthropic_unavailable");
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = payload.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("anthropic_unavailable");
  const parsed = parseAnalysis(JSON.parse(text));
  if (!parsed) throw new Error("anthropic_unavailable");
  return parsed;
}

export async function fetchPlaceIntelligence(
  request: PlaceIntelligenceRequest,
  placesApiKey: string,
  anthropicApiKey: string | null,
  fetcher: typeof fetch = fetch,
): Promise<PlaceIntelligenceResult> {
  const destination = destinationById(request.destination === "auto" ? "worldwide" : request.destination);
  const planningFields = "id,displayName,formattedAddress,location,googleMapsUri,websiteUri,businessStatus,currentOpeningHours,regularOpeningHours";
  const enrichmentFields = `${planningFields},rating,userRatingCount,paymentOptions,reviews,photos`;
  // An exact resolver identity is already sufficient for planning and should
  // never be expanded into a reviews/photos/payment SKU implicitly. Rich
  // fallback search remains available only to the explicitly separate
  // enrichment scope.
  const selectedFields = request.providerRef || request.scope === "planning" ? planningFields : enrichmentFields;
  const searchFields = `places.${selectedFields.split(",").join(",places.")}`;
  const exactUrl = request.providerRef
    ? `https://places.googleapis.com/v1/places/${encodeURIComponent(request.providerRef)}?languageCode=${request.languageCode}`
    : "https://places.googleapis.com/v1/places:searchText";
  const response = await fetcher(exactUrl, request.providerRef ? {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": placesApiKey,
      "X-Goog-FieldMask": selectedFields,
    },
    signal: AbortSignal.timeout(8_000),
  } : {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": placesApiKey,
      "X-Goog-FieldMask": searchFields,
    },
    body: JSON.stringify({
      textQuery: destinationPlaceQuery(`${request.name} ${request.area}`, destination),
      pageSize: 1,
      languageCode: request.languageCode,
      ...(destination.regionCode ? { regionCode: destination.regionCode } : {}),
      locationBias: { circle: { center: { latitude: request.latitude, longitude: request.longitude }, radius: 1_000 } },
      rankPreference: "RELEVANCE",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as Record<string, unknown> & { places?: Array<Record<string, unknown>> };
  const raw = request.providerRef ? payload : payload.places?.[0];
  if (!raw) throw new Error("place_not_found");
  const location = raw.location as { latitude?: unknown; longitude?: unknown } | undefined;
  const actualLatitude = typeof location?.latitude === "number" ? location.latitude : null;
  const actualLongitude = typeof location?.longitude === "number" ? location.longitude : null;
  if (actualLatitude === null || actualLongitude === null) throw new Error("place_not_found");
  const latitudeDeltaKm = Math.abs(actualLatitude - request.latitude) * 111;
  const longitudeDeltaKm = Math.abs(actualLongitude - request.longitude) * 111 * Math.cos(request.latitude * Math.PI / 180);
  if (Math.hypot(latitudeDeltaKm, longitudeDeltaKm) > 1.5) throw new Error("place_mismatch");
  const displayName = raw.displayName as { text?: string } | undefined;
  const mapsUrl = boundedText(raw.googleMapsUri, 1, 500);
  const name = boundedText(displayName?.text, 1, 160);
  if (!mapsUrl || !name) throw new Error("place_not_found");
  const currentHours = raw.currentOpeningHours as { openNow?: boolean; weekdayDescriptions?: unknown; periods?: unknown; specialDays?: unknown } | undefined;
  const regularHours = raw.regularOpeningHours as { openNow?: boolean; weekdayDescriptions?: unknown; periods?: unknown } | undefined;
  const payment = raw.paymentOptions as Record<string, unknown> | undefined;
  const photos = Array.isArray(raw.photos) ? raw.photos as Array<Record<string, unknown>> : [];
  const photo = photos.find((candidate) => typeof candidate?.name === "string"
    && /^places\/[A-Za-z0-9_-]{8,300}\/photos\/[A-Za-z0-9_-]{8,600}$/.test(candidate.name as string)) ?? null;
  const photoAuthor = Array.isArray(photo?.authorAttributions)
    ? (photo.authorAttributions as Array<Record<string, unknown>>)[0]
    : undefined;
  const photoAttribution = photoAuthor && boundedText(photoAuthor.displayName, 1, 120) && boundedText(photoAuthor.uri, 1, 500)
    ? { name: boundedText(photoAuthor.displayName, 1, 120)!, uri: boundedText(photoAuthor.uri, 1, 500)! }
    : null;
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.slice(0, 5).flatMap((review) => {
    if (!review || typeof review !== "object") return [];
    const source = review as Record<string, unknown>;
    const reviewText = source.text as { text?: string } | undefined;
    const author = source.authorAttribution as { displayName?: string; uri?: string } | undefined;
    const text = boundedText(reviewText?.text, 1, 2_000)?.slice(0, 360);
    if (!text) return [];
    return [{
      rating: typeof source.rating === "number" ? source.rating : null,
      text,
      publishedAt: boundedText(source.publishTime, 1, 80),
      relativeTime: boundedText(source.relativePublishTimeDescription, 1, 80) ?? "",
      authorName: boundedText(author?.displayName, 1, 120) ?? (request.languageCode === "ja" ? "Googleユーザー" : "Google user"),
      authorUri: boundedText(author?.uri, 1, 500),
      googleMapsUri: boundedText(source.googleMapsUri, 1, 500),
    }];
  }) : [];
  const base = {
    provider: "google_places" as const,
    checkedAt: new Date().toISOString(),
    place: {
      name,
      address: boundedText(raw.formattedAddress, 0, 300) ?? "",
      googleMapsUrl: mapsUrl,
      websiteUrl: boundedText(raw.websiteUri, 1, 500),
      businessStatus: boundedText(raw.businessStatus, 1, 80),
      rating: typeof raw.rating === "number" ? raw.rating : null,
      userRatingCount: typeof raw.userRatingCount === "number" ? raw.userRatingCount : null,
      openNow: optionalBoolean(currentHours?.openNow ?? regularHours?.openNow),
      hours: (Array.isArray(currentHours?.weekdayDescriptions) ? currentHours?.weekdayDescriptions : regularHours?.weekdayDescriptions) as string[] ?? [],
      currentOpeningPeriods: Array.isArray(currentHours?.periods) ? currentHours.periods : null,
      currentSpecialDays: Array.isArray(currentHours?.specialDays) ? currentHours.specialDays : null,
      regularOpeningPeriods: Array.isArray(regularHours?.periods) ? regularHours.periods : null,
      photoName: photo ? photo.name as string : null,
      photoAttribution,
      payment: reconcilePaymentEvidence(payment, reviews),
    },
    reviews,
    links: socialLinks(name, request.area),
  };
  const fallback = rulesAnalysis(base, request.languageCode);
  // With no reviews and no posted hours there is nothing for the model to audit — answer instantly from rules.
  const thinEvidence = base.reviews.length === 0 && base.place.hours.length === 0;
  if (!anthropicApiKey || thinEvidence) return { ...base, analyzedBy: "rules", analysis: fallback };
  try {
    const analysis = await fetchAnthropicAnalysis(base, request.languageCode, anthropicApiKey, fetcher);
    return { ...base, analyzedBy: "anthropic", analysis };
  } catch {
    return { ...base, analyzedBy: "rules", analysis: fallback };
  }
}
