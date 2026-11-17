import { appleRelayUrl } from "../apple-relay-client.ts";
import {
  MEAL_ADVICE_LIMITS,
  cleanMealAdviceAnswer,
  cleanMealAdviceRequest,
  mealAdviceSlotIds,
  type MealAdviceAnswer,
  type MealAdviceRequest,
} from "./meal-advice-contract.ts";

/*
 * The page's way to the site's AI relay (api/ai.php, or the local twin). It
 * is asked only after the traveller pressed the button and confirmed the
 * form. Whatever goes wrong — no relay, a refusal, a limit, a slow or broken
 * answer — is one and the same thing to the screen: no answer (null), and the
 * meal row stays as it was.
 */

/** How long the page waits before it gives up and leaves the row as it is. */
export const MEAL_ADVICE_TIMEOUT_MS = 20_000;

/** The AI relay beside the Apple relay (…/apple.php → …/ai.php); null when this build has no relay. */
export function mealAdviceUrl(relayUrl: string | null = appleRelayUrl()): string | null {
  if (!relayUrl) return null;
  const [path, ...rest] = relayUrl.split("?");
  return /(^|\/)apple\.php$/.test(path) && rest.length === 0 ? path.replace(/apple\.php$/, "ai.php") : null;
}

/**
 * Whether this build has the advisor at all: a flag the build sets only when
 * it wrote an AI key into the relay's config. The relay is never probed.
 */
export function mealAdviceAvailable(flag: string | undefined = process.env.NEXT_PUBLIC_TRIPCHECK_AI, relayUrl: string | null = appleRelayUrl()): boolean {
  return flag === "1" && mealAdviceUrl(relayUrl) !== null;
}

export type MealAdviceAsk = {
  signal?: AbortSignal;
  timeoutMs?: number;
  url?: string | null;
  fetcher?: typeof fetch;
};

/**
 * One question to the relay. The request is checked with the relay's own
 * rules before it leaves (a brief it would refuse is not sent), and the
 * answer is checked with them again before anything is shown.
 */
export async function askMealAdvice(request: MealAdviceRequest, options: MealAdviceAsk = {}): Promise<MealAdviceAnswer | null> {
  const url = options.url === undefined ? mealAdviceUrl() : options.url;
  const clean = cleanMealAdviceRequest(request);
  if (!url || !clean) return null;
  const body = JSON.stringify(clean);
  if (new TextEncoder().encode(body).length > MEAL_ADVICE_LIMITS.bodyBytes) return null;

  const fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (options.signal?.aborted) return null;
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, options.timeoutMs ?? MEAL_ADVICE_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as unknown;
    if (controller.signal.aborted) return null;
    return cleanMealAdviceAnswer(payload, mealAdviceSlotIds(clean), clean.locale);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
}
