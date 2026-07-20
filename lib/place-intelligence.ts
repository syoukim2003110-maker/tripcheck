import { FOOD_RANKING_MODEL } from "./ai-food-ranking.ts";

export type PlaceIntelligenceRequest = {
  name: string;
  area: string;
  languageCode: "en" | "ja";
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
    payment: {
      cashOnly: boolean | null;
      creditCards: boolean | null;
      debitCards: boolean | null;
      nfc: boolean | null;
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

export function parsePlaceIntelligenceRequest(input: unknown): PlaceIntelligenceRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const name = boundedText(source.name, 1, 160);
  const area = boundedText(source.area, 1, 100);
  if (!name || !area || (source.languageCode !== "ja" && source.languageCode !== "en")) return null;
  return { name, area, languageCode: source.languageCode };
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
  const evidence = {
    listing: {
      businessStatus: result.place.businessStatus,
      openNow: result.place.openNow,
      hours: result.place.hours,
      payment: result.place.payment,
      rating: result.place.rating,
      userRatingCount: result.place.userRatingCount,
    },
    reviews: result.reviews.map((review, index) => ({
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
  const response = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: FOOD_RANKING_MODEL,
      max_tokens: 480,
      temperature: 0,
      system: "Audit one travel stop using only the supplied evidence. The listing is platform data; reviews are individual reports, not confirmed facts. Identify only explicit evidence about hours, early closing, payment, crowds, closures or access friction. Never infer missing facts. If evidence is absent, mark it unknown. Cite listing or review_N in every signal.",
      messages: [{ role: "user", content: JSON.stringify({ task: languageRule, evidence }) }],
      output_config: { format: { type: "json_schema", schema: analysisSchema } },
    }),
    signal: AbortSignal.timeout(6_000),
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
  const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": placesApiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.businessStatus,places.currentOpeningHours,places.regularOpeningHours,places.rating,places.userRatingCount,places.paymentOptions,places.reviews",
    },
    body: JSON.stringify({
      textQuery: `${request.name} ${request.area} Japan`,
      pageSize: 1,
      languageCode: request.languageCode,
      regionCode: "JP",
      rankPreference: "RELEVANCE",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as { places?: Array<Record<string, unknown>> };
  const raw = payload.places?.[0];
  if (!raw) throw new Error("place_not_found");
  const displayName = raw.displayName as { text?: string } | undefined;
  const mapsUrl = boundedText(raw.googleMapsUri, 1, 500);
  const name = boundedText(displayName?.text, 1, 160);
  if (!mapsUrl || !name) throw new Error("place_not_found");
  const currentHours = raw.currentOpeningHours as { openNow?: boolean; weekdayDescriptions?: unknown } | undefined;
  const regularHours = raw.regularOpeningHours as { openNow?: boolean; weekdayDescriptions?: unknown } | undefined;
  const payment = raw.paymentOptions as Record<string, unknown> | undefined;
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.slice(0, 3).flatMap((review) => {
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
      payment: {
        cashOnly: optionalBoolean(payment?.acceptsCashOnly),
        creditCards: optionalBoolean(payment?.acceptsCreditCards),
        debitCards: optionalBoolean(payment?.acceptsDebitCards),
        nfc: optionalBoolean(payment?.acceptsNfc),
      },
    },
    reviews,
    links: socialLinks(name, request.area),
  };
  const fallback = rulesAnalysis(base, request.languageCode);
  if (!anthropicApiKey) return { ...base, analyzedBy: "rules", analysis: fallback };
  try {
    const analysis = await fetchAnthropicAnalysis(base, request.languageCode, anthropicApiKey, fetcher);
    return { ...base, analyzedBy: "anthropic", analysis };
  } catch {
    return { ...base, analyzedBy: "rules", analysis: fallback };
  }
}
