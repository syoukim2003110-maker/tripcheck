import { anthropicTimeoutMs, postAnthropicMessages } from "./anthropic-runtime.ts";

export const HOTEL_RANKING_MODEL = "claude-haiku-4-5-20251001";
export const HOTEL_RANKING_MAX_WEB_SEARCHES = 3;

/**
 * Only Google-verified facts travel to the model. The model may add web
 * research on top, but it can only choose among these exact ids — it can
 * neither add a hotel nor change any number shown in the UI.
 */
export type HotelRankingCandidate = {
  id: string;
  name: string;
  area: string;
  rating: number | null;
  reviewCount: number | null;
  /** Whole-trip travel minutes when this hotel is the base; measured by the planner. */
  totalTravelMinutes: number | null;
  styles: string[];
  priceHint: string | null;
};

export type HotelRankingRequest = {
  destination: string;
  area: string;
  tripDays: number;
  purpose: string;
  languageCode: "en" | "ja";
  candidates: HotelRankingCandidate[];
};

export type HotelRankingResult = {
  recommendedId: string;
  ranked: Array<{ id: string; reason: string; tag: string }>;
};

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

export function parseHotelRankingRequest(input: unknown): HotelRankingRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const destination = boundedText(source.destination, 1, 80);
  const area = boundedText(source.area, 1, 80);
  const purpose = boundedText(source.purpose, 1, 40);
  const tripDays = boundedNumber(source.tripDays, 1, 30);
  if (!destination || !area || !purpose || tripDays === null || !Number.isInteger(tripDays)) return null;
  if (source.languageCode !== "en" && source.languageCode !== "ja") return null;
  if (!Array.isArray(source.candidates) || source.candidates.length < 2 || source.candidates.length > 6) return null;

  const candidates = source.candidates.flatMap((candidate): HotelRankingCandidate[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const id = boundedText(item.id, 1, 300);
    const name = boundedText(item.name, 1, 160);
    const itemArea = boundedText(item.area, 0, 120);
    if (!id || !name || itemArea === null) return [];
    const styles = Array.isArray(item.styles)
      ? item.styles.flatMap((style) => {
        const text = boundedText(style, 1, 20);
        return text ? [text] : [];
      }).slice(0, 4)
      : [];
    return [{
      id,
      name,
      area: itemArea,
      rating: boundedNumber(item.rating, 0, 5),
      reviewCount: boundedNumber(item.reviewCount, 0, 10_000_000),
      totalTravelMinutes: boundedNumber(item.totalTravelMinutes, 0, 100_000),
      styles,
      priceHint: boundedText(item.priceHint, 1, 60),
    }];
  });
  if (candidates.length !== source.candidates.length || new Set(candidates.map(({ id }) => id)).size !== candidates.length) return null;
  return { destination, area, purpose, tripDays, languageCode: source.languageCode, candidates };
}

export function buildAnthropicHotelRankingBody(request: HotelRankingRequest) {
  const instruction = request.languageCode === "ja"
    ? "理由は45文字以内の自然な日本語、タグは8文字以内。最終回答はJSONのみ。"
    : "Reasons in natural English (15 words max), tags 3 words max. Final answer must be JSON only.";
  return {
    model: HOTEL_RANKING_MODEL,
    max_tokens: 900,
    temperature: 0,
    system: [
      "You choose the best hotel base for a multi-day trip from the supplied Google Maps candidates only.",
      `You may run at most ${HOTEL_RANKING_MAX_WEB_SEARCHES} web searches to check recent guest sentiment or the practicality of a candidate's location. Skip searching when the supplied facts already decide it.`,
      "Never add a hotel. Never state a rating, review count, price or travel time that is not in the input — web findings may only inform qualitative judgement.",
      "Weigh, in order: total travel minutes across the trip, review credibility (count times rating), fit with the stated purpose, then reputation nuances from research.",
      'Respond with ONLY a JSON object of the shape {"recommendedId": string, "ranked": [{"id": string, "reason": string, "tag": string}]} — every supplied id exactly once in ranked, best first, recommendedId equal to ranked[0].id. No prose around the JSON.',
    ].join(" "),
    tools: [{
      type: "web_search_20250305",
      name: "web_search",
      max_uses: HOTEL_RANKING_MAX_WEB_SEARCHES,
    }],
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: instruction,
        destination: request.destination,
        area: request.area,
        tripDays: request.tripDays,
        purpose: request.purpose,
        candidates: request.candidates,
      }),
    }],
  };
}

/** Pulls the final JSON object out of the last text block, tolerating fences. */
export function parseHotelRankingResponseText(text: string, allowedIds: readonly string[]): HotelRankingResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const source = parsed as Record<string, unknown>;
  if (!Array.isArray(source.ranked)) return null;
  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const ranked = source.ranked.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const id = boundedText(entry.id, 1, 300);
    const reason = boundedText(entry.reason, 1, 200);
    const tag = boundedText(entry.tag, 1, 40);
    if (!id || !reason || !tag || !allowed.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, reason, tag }];
  });
  if (ranked.length === 0) return null;
  const recommendedId = boundedText(source.recommendedId, 1, 300);
  if (!recommendedId || !allowed.has(recommendedId)) return null;
  return { recommendedId, ranked };
}

export async function fetchAnthropicHotelRanking(
  request: HotelRankingRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<HotelRankingResult> {
  const response = await postAnthropicMessages(apiKey, buildAnthropicHotelRankingBody(request), {
    fetcher,
    signal: AbortSignal.timeout(anthropicTimeoutMs(20_000)),
  });
  if (!response.ok) throw new Error("ai_hotel_ranking_unavailable");
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const textBlocks = (payload.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string");
  const text = textBlocks.at(-1)?.text;
  if (!text) throw new Error("ai_hotel_ranking_unavailable");
  const result = parseHotelRankingResponseText(text, request.candidates.map(({ id }) => id));
  if (!result) throw new Error("ai_hotel_ranking_unavailable");
  return result;
}
