import { postAnthropicMessages } from "./anthropic-runtime.ts";

/*
 * Concept → starter wishlist. Claude proposes real, well-known places for a
 * trip concept; the proposals are only a draft. Everything still passes the
 * normal Google place-resolution gate at build time, so an invented or
 * unfindable name simply drops out instead of reaching the plan.
 */

export const TRIP_IDEAS_MODEL = "claude-haiku-4-5-20251001";

export type TripIdeasRequest = {
  concept: string;
  languageCode: "ja" | "en";
};

export type TripIdeasResult = {
  provider: "anthropic";
  concept: string;
  places: string[];
};

export class TripIdeasProviderError extends Error {
  reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

export function parseTripIdeasRequest(input: unknown): TripIdeasRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  const concept = boundedText(candidate.concept, 2, 120);
  if (!concept) return null;
  if (candidate.languageCode !== "ja" && candidate.languageCode !== "en") return null;
  return { concept, languageCode: candidate.languageCode };
}

export function buildTripIdeasBody(request: TripIdeasRequest) {
  const language = request.languageCode === "ja" ? "Japanese" : "English";
  return {
    model: TRIP_IDEAS_MODEL,
    max_tokens: 400,
    temperature: 0,
    system: "You draft starting points for a Japan trip wishlist. Given a trip concept, list 8 to 12 real, existing, specific places in Japan that fit it: sightseeing spots, landmarks, districts, markets or food streets. Prefer famous, easily findable places over obscure ones; for food concepts prefer food districts and markets over individual restaurants. Never invent a place — leave out anything you are not sure exists. Reply with ONLY a JSON array of place-name strings in the requested language, no commentary, no code fences.",
    messages: [{
      role: "user",
      content: `Concept: ${request.concept}\nLanguage for place names: ${language}\nJSON array only.`,
    }],
  };
}

type AnthropicPayload = {
  content?: Array<{ type?: string; text?: string }>;
};

export function parseTripIdeasResponse(payload: AnthropicPayload, concept: string): TripIdeasResult {
  const textBlock = (payload.content ?? []).find((block) => block.type === "text" && typeof block.text === "string");
  if (!textBlock?.text) throw new TripIdeasProviderError("empty_response");
  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TripIdeasProviderError("unparseable_response");
  }
  if (!Array.isArray(parsed)) throw new TripIdeasProviderError("unparseable_response");
  const seen = new Set<string>();
  const places = parsed.flatMap((entry) => {
    const name = boundedText(entry, 1, 60);
    if (!name) return [];
    const key = name.normalize("NFKC").toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [name];
  }).slice(0, 12);
  if (places.length === 0) throw new TripIdeasProviderError("empty_response");
  return { provider: "anthropic", concept, places };
}

export async function fetchTripIdeas(
  request: TripIdeasRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TripIdeasResult> {
  const response = await postAnthropicMessages(apiKey, buildTripIdeasBody(request), {
    fetcher,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new TripIdeasProviderError(
      response.status === 401 || response.status === 403 ? "upstream_auth"
        : response.status === 429 ? "upstream_rate_limited"
          : "upstream_unavailable",
    );
  }
  const payload = await response.json() as AnthropicPayload;
  return parseTripIdeasResponse(payload, request.concept);
}
