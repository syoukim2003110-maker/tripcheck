import type { FoodCandidate } from "./google-food.ts";
import { anthropicTimeoutMs, postAnthropicMessages } from "./anthropic-runtime.ts";

export const FOOD_RANKING_MODEL = "claude-haiku-4-5-20251001";

export type FoodRankingRequest = {
  area: string;
  mealKind: "lunch" | "dinner";
  query: string;
  languageCode: "en" | "ja";
  candidates: Array<Pick<FoodCandidate, "id" | "name" | "address" | "type">>;
};

export type FoodRankingItem = {
  id: string;
  reason: string;
  tag: string;
};

const rankingSchema = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
          tag: { type: "string" },
        },
        required: ["id", "reason", "tag"],
        additionalProperties: false,
      },
    },
  },
  required: ["ranked"],
  additionalProperties: false,
} as const;

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

export function parseFoodRankingRequest(input: unknown): FoodRankingRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const area = boundedText(source.area, 1, 80);
  const query = boundedText(source.query, 1, 120);
  if (!area || !query || (source.mealKind !== "lunch" && source.mealKind !== "dinner")) return null;
  if (source.languageCode !== "en" && source.languageCode !== "ja") return null;
  if (!Array.isArray(source.candidates) || source.candidates.length === 0 || source.candidates.length > 4) return null;

  const candidates = source.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const id = boundedText(item.id, 1, 300);
    const name = boundedText(item.name, 1, 160);
    const address = boundedText(item.address, 0, 240);
    const type = boundedText(item.type, 1, 100);
    if (!id || !name || address === null || !type) return [];
    return [{ id, name, address, type }];
  });
  if (candidates.length !== source.candidates.length || new Set(candidates.map(({ id }) => id)).size !== candidates.length) return null;
  return { area, query, mealKind: source.mealKind, languageCode: source.languageCode, candidates };
}

export function buildAnthropicFoodRankingBody(request: FoodRankingRequest) {
  const instruction = request.languageCode === "ja"
    ? "理由とタグは自然な日本語で。理由は35文字以内、タグは8文字以内。"
    : "Write natural English reasons (12 words max) and tags (3 words max).";
  return {
    model: FOOD_RANKING_MODEL,
    max_tokens: 320,
    temperature: 0,
    system: "Rank only the supplied Google Maps restaurant candidates for this meal. Never add a restaurant or claim ratings, opening hours, prices, popularity, menu items, or facts not present in the input. Prefer fit with the requested food, meal, and area. Return every supplied id once. Keep the explanation concrete and short.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: instruction,
        area: request.area,
        meal: request.mealKind,
        food: request.query,
        candidates: request.candidates,
      }),
    }],
    output_config: { format: { type: "json_schema", schema: rankingSchema } },
  };
}

export async function fetchAnthropicFoodRanking(
  request: FoodRankingRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<FoodRankingItem[]> {
  const response = await postAnthropicMessages(apiKey, buildAnthropicFoodRankingBody(request), {
    fetcher,
    signal: AbortSignal.timeout(anthropicTimeoutMs(4_000)),
  });
  if (!response.ok) throw new Error("ai_ranking_unavailable");
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = payload.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("ai_ranking_unavailable");
  const parsed = JSON.parse(text) as { ranked?: unknown };
  if (!Array.isArray(parsed.ranked)) throw new Error("ai_ranking_unavailable");

  const allowedIds = new Set(request.candidates.map(({ id }) => id));
  const seen = new Set<string>();
  return parsed.ranked.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const id = boundedText(source.id, 1, 300);
    const reason = boundedText(source.reason, 1, 160);
    const tag = boundedText(source.tag, 1, 40);
    if (!id || !reason || !tag || !allowedIds.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, reason, tag }];
  });
}
