import {
  cleanMealAdviceAnswer,
  cleanMealAdviceRequest,
  mealAdviceSlotIds,
  type MealAdviceAnswer,
  type MealAdviceErrorCode,
  type MealAdviceRequest,
  type MealAdviceTask,
} from "../shiori/meal-advice-contract.ts";

/*
 * The meal advisor's relay, as run by the local stand-in
 * (scripts/apple-relay-dev.ts). deploy/xserver/api/ai.php is the same thing in
 * PHP for the live host; both read deploy/xserver/api/ai-spec.json for the
 * prompts, the answer's schema, the model names and the limits, so the two
 * cannot drift on any of those.
 *
 * The caller supplies a brief and nothing else: no prompt, no model, no
 * schema, no token limit. The brief is validated and rebuilt before it is
 * sent on, and the model's answer is validated before it is sent back.
 * Provider error bodies are never passed through (they can echo the input).
 */

export type MealAdviceSpec = {
  limits: { bodyBytes: number; dailyCalls: number; perClientPerMinute: number; perClientPerDay: number; featuresPerOption: number };
  providers: {
    anthropic: { url: string; version: string; model: string; maxTokens: number; effort: string; timeoutSeconds: number; beta?: string; fallbacks?: string };
    openai: { url: string; model: string; maxOutputTokens: number; reasoningEffort: string; timeoutSeconds: number };
  };
  system: Record<"common" | MealAdviceTask, string[]>;
  answerSchema: Record<string, unknown>;
};

export type MealAdviceKeys = { anthropic: string | null; openai: string | null };

export type MealAdviceUsage = { provider: "anthropic" | "openai"; ok: boolean; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; milliseconds: number };

/** Printable, 20–300 characters, no quote, backslash or space: enough to be written into a PHP string safely. */
function keyShape(value: string | undefined) {
  const key = (value ?? "").trim();
  return /^[\x21-\x7e]{20,300}$/.test(key) && !/['"\\`]/.test(key) ? key : null;
}

/**
 * The AI keys in an environment. The variable's name is matched without
 * regard to case, because the owner's file spells one of them Claude_API_KEY.
 */
export function aiKeysFromEnvironment(environment: Record<string, string | undefined>): MealAdviceKeys {
  const named = (...names: string[]) => {
    for (const name of names) {
      for (const [key, value] of Object.entries(environment)) {
        if (key.toUpperCase() === name && keyShape(value)) return keyShape(value);
      }
    }
    return null;
  };
  return { anthropic: named("ANTHROPIC_API_KEY", "CLAUDE_API_KEY"), openai: named("OPENAI_API_KEY") };
}

/** api/ai-config.php for the live host, or null when there is no key (then the file is not written and the page has no AI button). */
export function aiConfigPhp(keys: MealAdviceKeys): string | null {
  if (!keys.anthropic && !keys.openai) return null;
  const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return `<?php\n// Generated from .env.local. Keep private; blocked from the web by .htaccess.\nreturn [\n${keys.anthropic ? `  'anthropic_key' => ${quote(keys.anthropic)},\n` : ""}${keys.openai ? `  'openai_key' => ${quote(keys.openai)},\n` : ""}];\n`;
}

export function mealAdviceSystemPrompt(spec: MealAdviceSpec, task: MealAdviceTask) {
  return [...spec.system.common, ...spec.system[task]].join("\n\n");
}

/** The user message: the cleaned request and nothing the caller did not pass validation with. */
export function mealAdviceUserMessage(request: MealAdviceRequest) {
  return JSON.stringify(request.task === "meal-refine"
    ? { locale: request.locale, brief: request.brief, refine: request.refine }
    : { locale: request.locale, brief: request.brief });
}

type Outgoing = { url: string; headers: Record<string, string>; body: Record<string, unknown>; timeoutMs: number };

/**
 * Claude Messages API. Thinking is always on for this model and is steered by
 * effort; the answer's shape is guaranteed by a JSON schema (this model
 * refuses a forced tool call). The fixed system prompt is marked for caching.
 */
export function anthropicRequest(spec: MealAdviceSpec, request: MealAdviceRequest, key: string): Outgoing {
  const provider = spec.providers.anthropic;
  return {
    url: provider.url,
    timeoutMs: provider.timeoutSeconds * 1000,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": provider.version,
      ...(provider.beta ? { "anthropic-beta": provider.beta } : {}),
    },
    body: {
      model: provider.model,
      max_tokens: provider.maxTokens,
      ...(provider.fallbacks ? { fallbacks: provider.fallbacks } : {}),
      output_config: { effort: provider.effort, format: { type: "json_schema", schema: spec.answerSchema } },
      system: [{ type: "text", text: mealAdviceSystemPrompt(spec, request.task), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: mealAdviceUserMessage(request) }],
    },
  };
}

/** OpenAI Responses API with the same prompt and schema; nothing is stored there. */
export function openaiRequest(spec: MealAdviceSpec, request: MealAdviceRequest, key: string): Outgoing {
  const provider = spec.providers.openai;
  return {
    url: provider.url,
    timeoutMs: provider.timeoutSeconds * 1000,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: {
      model: provider.model,
      store: false,
      reasoning: { effort: provider.reasoningEffort },
      max_output_tokens: provider.maxOutputTokens,
      input: [
        { role: "system", content: mealAdviceSystemPrompt(spec, request.task) },
        { role: "user", content: mealAdviceUserMessage(request) },
      ],
      text: { format: { type: "json_schema", name: "meal_advice", schema: spec.answerSchema, strict: true } },
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The JSON a Claude reply carries, or null: a refusal, a cut-off reply and anything but a finished turn count as no answer. */
export function readAnthropicReply(status: number, body: unknown): unknown {
  if (status !== 200 || !body || typeof body !== "object") return null;
  const reply = body as { stop_reason?: unknown; content?: unknown };
  // Checked before the content is read: on a refusal or at the token limit the content is empty or partial.
  if (reply.stop_reason !== "end_turn" || !Array.isArray(reply.content)) return null;
  const text = reply.content
    .filter((block): block is { type: "text"; text: string } => !!block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
  return text === "" ? null : parseJson(text);
}

/** The JSON an OpenAI reply carries, or null: an incomplete reply or a refusal counts as no answer. */
export function readOpenaiReply(status: number, body: unknown): unknown {
  if (status !== 200 || !body || typeof body !== "object") return null;
  const reply = body as { status?: unknown; output?: unknown };
  if (reply.status !== "completed" || !Array.isArray(reply.output)) return null;
  let text = "";
  for (const item of reply.output) {
    const message = item as { type?: unknown; content?: unknown } | null;
    if (!message || message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const piece = part as { type?: unknown; text?: unknown } | null;
      if (piece?.type === "refusal") return null;
      if (piece?.type === "output_text" && typeof piece.text === "string") text += piece.text;
    }
  }
  return text === "" ? null : parseJson(text);
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Who a request is counted against. An IPv6 line is handed a whole /64 of
 * addresses, so those count as one client; an IPv4 address (also when written
 * as an IPv6-mapped one) counts as itself. Anything unreadable is its own
 * client under the text it came as.
 */
export function mealAdviceClientGroup(address: string): string {
  const bare = address.trim().toLowerCase().replace(/%.*$/, "");
  if (!bare.includes(":")) return bare;
  const halves = bare.split("::");
  if (halves.length > 2) return bare;
  const groupsOf = (part: string) => (part === "" ? [] : part.split(":")).flatMap((group) => {
    // An IPv4 tail ("::ffff:203.0.113.7") is two groups.
    const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(group);
    if (!quad) return [group];
    const bytes = quad.slice(1).map(Number);
    return bytes.some((byte) => byte > 255) ? ["x"] : [((bytes[0] << 8) | bytes[1]).toString(16), ((bytes[2] << 8) | bytes[3]).toString(16)];
  });
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return bare;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return bare;
  const words = groups.map((group) => parseInt(group, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  return `${words.slice(0, 4).map((word) => word.toString(16).padStart(4, "0")).join("")}::/64`;
}

/**
 * The limits of the relay, kept in memory here (ai.php keeps them in .state/):
 * a ceiling for the whole site per day, and per client so many a minute and a
 * day. `admit` counts the request when it lets it through.
 */
export function createMealAdviceLimiter(spec: MealAdviceSpec, now: () => number = Date.now) {
  let state = { day: "", calls: 0, clients: new Map<string, number>(), minute: 0, minuteClients: new Map<string, number>() };
  return function admit(address: string) {
    const client = mealAdviceClientGroup(address);
    const day = new Date(now()).toISOString().slice(0, 10);
    const minute = Math.floor(now() / 60_000);
    if (state.day !== day) state = { day, calls: 0, clients: new Map(), minute, minuteClients: new Map() };
    if (state.minute !== minute) {
      state.minute = minute;
      state.minuteClients = new Map();
    }
    const today = state.clients.get(client) ?? 0;
    const thisMinute = state.minuteClients.get(client) ?? 0;
    if (state.calls >= spec.limits.dailyCalls || today >= spec.limits.perClientPerDay || thisMinute >= spec.limits.perClientPerMinute) return false;
    state.calls += 1;
    state.clients.set(client, today + 1);
    state.minuteClients.set(client, thisMinute + 1);
    return true;
  };
}

export type MealAdviceReply = { status: 200; body: MealAdviceAnswer } | { status: number; body: { code: MealAdviceErrorCode } };

/**
 * One request through the relay: validate, count, ask Claude, on any failure
 * ask OpenAI once, validate the answer. A provider with no key is skipped.
 */
export async function answerMealAdvice(input: {
  /** The request body as text, exactly as received. */
  rawBody: string;
  spec: MealAdviceSpec;
  keys: MealAdviceKeys;
  admit: () => boolean;
  fetcher?: typeof fetch;
  onUsage?: (usage: MealAdviceUsage) => void;
}): Promise<MealAdviceReply> {
  const { spec, keys } = input;
  const fetcher = input.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const refuse = (status: number, code: MealAdviceErrorCode): MealAdviceReply => ({ status, body: { code } });
  if (!keys.anthropic && !keys.openai) return refuse(503, "not_configured");
  if (Buffer.byteLength(input.rawBody, "utf8") > spec.limits.bodyBytes) return refuse(400, "invalid_request");
  const request = cleanMealAdviceRequest(parseJson(input.rawBody));
  if (!request) return refuse(400, "invalid_request");
  if (!input.admit()) return refuse(429, "budget_exhausted");

  const slotIds = mealAdviceSlotIds(request);
  const ask = async (provider: "anthropic" | "openai", outgoing: Outgoing, read: (status: number, body: unknown) => unknown) => {
    const started = Date.now();
    let body: unknown = null;
    let status = 0;
    try {
      const response = await fetcher(outgoing.url, {
        method: "POST",
        headers: outgoing.headers,
        body: JSON.stringify(outgoing.body),
        signal: AbortSignal.timeout(outgoing.timeoutMs),
      });
      status = response.status;
      body = await response.json().catch(() => null);
    } catch {
      // A timeout or no connection: no answer from this provider.
    }
    const answer = cleanMealAdviceAnswer(read(status, body), slotIds, request.locale);
    const usage = (body as { usage?: Record<string, unknown> } | null)?.usage ?? {};
    input.onUsage?.({
      provider,
      ok: answer !== null,
      inputTokens: tokenCount(usage.input_tokens),
      outputTokens: tokenCount(usage.output_tokens),
      cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
      cacheWriteTokens: tokenCount(usage.cache_creation_input_tokens),
      milliseconds: Date.now() - started,
    });
    return answer;
  };

  let answer: MealAdviceAnswer | null = null;
  if (keys.anthropic) answer = await ask("anthropic", anthropicRequest(spec, request, keys.anthropic), readAnthropicReply);
  if (!answer && keys.openai) answer = await ask("openai", openaiRequest(spec, request, keys.openai), readOpenaiReply);
  return answer ? { status: 200, body: answer } : refuse(502, "unavailable");
}
