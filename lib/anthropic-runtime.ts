type AnthropicEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Where /v1/messages lives. ANTHROPIC_BASE_URL lets a local development
 * server stand in for the real API (for example scripts/claude-local-proxy.mjs,
 * which answers with the Claude Code CLI) so every AI feature can be exercised
 * end-to-end without paid credits. Request and response shapes stay identical
 * to production — the app cannot tell the difference, which is the point.
 */
function anthropicMessagesUrl(env: AnthropicEnvironment = process.env) {
  const base = env.ANTHROPIC_BASE_URL?.trim().replace(/\/+$/, "");
  return `${base || "https://api.anthropic.com"}/v1/messages`;
}

export class AnthropicDisabledError extends Error {
  constructor() {
    super("anthropic_requests_disabled");
    this.name = "AnthropicDisabledError";
  }
}

/** Claude access is fail-closed and requires an explicit server-side opt-in. */
export function anthropicRequestsEnabled(env: AnthropicEnvironment = process.env) {
  return env.ANTHROPIC_REQUESTS_ENABLED === "true";
}

export function enabledAnthropicApiKey(env: AnthropicEnvironment = process.env) {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return anthropicRequestsEnabled(env) && key ? key : null;
}

/**
 * Provider timeouts are tuned for the real API's 2–8 s answers. The local
 * CLI stand-in legitimately takes tens of seconds (cold start + web search),
 * so when a base-URL override is active every per-call budget stretches by
 * one factor instead of each caller inventing its own dev number.
 */
export function anthropicTimeoutMs(baseMs: number, env: AnthropicEnvironment = process.env) {
  return env.ANTHROPIC_BASE_URL?.trim() ? baseMs * 8 : baseMs;
}

export async function postAnthropicMessages(
  apiKey: string,
  body: unknown,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
) {
  // Guard again at the actual network boundary so new callers cannot bypass
  // the pause switch by passing a previously loaded API key directly.
  if (!anthropicRequestsEnabled()) throw new AnthropicDisabledError();
  return (options.fetcher ?? fetch)(anthropicMessagesUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}
