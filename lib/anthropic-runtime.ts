const anthropicMessagesUrl = "https://api.anthropic.com/v1/messages";

export class AnthropicDisabledError extends Error {
  constructor() {
    super("anthropic_requests_disabled");
    this.name = "AnthropicDisabledError";
  }
}

/** Claude access is fail-closed and requires an explicit server-side opt-in. */
export function anthropicRequestsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.ANTHROPIC_REQUESTS_ENABLED === "true";
}

export function enabledAnthropicApiKey(env: NodeJS.ProcessEnv = process.env) {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return anthropicRequestsEnabled(env) && key ? key : null;
}

export async function postAnthropicMessages(
  apiKey: string,
  body: unknown,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
) {
  // Guard again at the actual network boundary so new callers cannot bypass
  // the pause switch by passing a previously loaded API key directly.
  if (!anthropicRequestsEnabled()) throw new AnthropicDisabledError();
  return (options.fetcher ?? fetch)(anthropicMessagesUrl, {
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
