#!/usr/bin/env node
/*
 * Local stand-in for the Anthropic Messages API, answered by the Claude Code
 * CLI on this machine. Run it next to `vinext start` and point the app at it:
 *
 *   node scripts/claude-local-proxy.mjs          # listens on 127.0.0.1:8791
 *   # .env: ANTHROPIC_REQUESTS_ENABLED=true
 *   #       ANTHROPIC_BASE_URL=http://127.0.0.1:8791
 *   #       ANTHROPIC_API_KEY=local-claude-cli   (any non-empty value)
 *
 * The app's request and response shapes are exactly the production ones, so
 * every AI feature — food ranking, evidence analysis and the web-search
 * field check — runs the same code path it would run against the paid API. Only this process knows the answers came from `claude -p`.
 *
 * Supported request families (all the shapes this codebase sends):
 *   1. plain text            → one text block
 *   2. output_config json_schema → one text block whose text is schema-shaped JSON
 *   3. tools: web_search     → server_tool_use + web_search_tool_result +
 *                              cited text blocks, like the real server tool
 *
 * This is a development tool. It binds to localhost only, checks nothing but
 * shape, and must never be exposed publicly.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const PORT = Number(process.env.CLAUDE_PROXY_PORT ?? 8791);
const CLI_TIMEOUT_MS = Number(process.env.CLAUDE_PROXY_TIMEOUT_MS ?? 150_000);

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

/** Model ids like claude-haiku-4-5-20251001 → the CLI's short alias. */
function cliModelFor(requestedModel) {
  const name = String(requestedModel ?? "");
  if (name.includes("haiku")) return "haiku";
  if (name.includes("opus")) return "opus";
  return "sonnet";
}

function runClaude(prompt, { model, allowWebSearch }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--model", cliModelFor(model),
      "--setting-sources", "user",
      ...(allowWebSearch
        ? ["--allowedTools", "WebSearch", "--disallowedTools", "Bash,Read,Write,Edit,Glob,Grep,WebFetch,Task,NotebookEdit"]
        : ["--tools", ""]),
    ];
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("cli_timeout"));
    }, CLI_TIMEOUT_MS);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`cli_exit_${code}: ${stderr.slice(0, 400)}`));
      try {
        const envelope = JSON.parse(stdout);
        resolve(String(envelope.result ?? ""));
      } catch {
        resolve(stdout.trim());
      }
    });
    child.stdin.end(prompt);
  });
}

/** Pull the first JSON value out of a possibly chatty CLI answer. */
function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through to bracket scan */ }
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  for (let end = cleaned.length; end > start; end -= 1) {
    try {
      return JSON.parse(cleaned.slice(start, end));
    } catch { /* keep shrinking */ }
  }
  return null;
}

function flattenMessages(body) {
  const parts = [];
  if (typeof body.system === "string" && body.system) parts.push(`System instructions:\n${body.system}`);
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const content = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("\n")
        : "";
    if (content) parts.push(`${message.role === "assistant" ? "Assistant" : "User"} message:\n${content}`);
  }
  return parts.join("\n\n");
}

async function answerPlain(body) {
  const text = await runClaude(
    `${flattenMessages(body)}\n\nAnswer directly with the assistant reply only — no preamble, no meta commentary.`,
    { model: body.model, allowWebSearch: false },
  );
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

async function answerJsonSchema(body) {
  const schema = JSON.stringify(body.output_config.format.schema);
  const text = await runClaude(
    `${flattenMessages(body)}\n\nReply with ONLY a JSON value that validates against this JSON Schema — no commentary, no code fences:\n${schema}`,
    { model: body.model, allowWebSearch: false },
  );
  const parsed = extractJson(text);
  if (parsed === null) throw new Error("schema_answer_not_json");
  return { content: [{ type: "text", text: JSON.stringify(parsed) }], stop_reason: "end_turn" };
}

/*
 * Emulates the server web_search tool closely enough that the app's strict
 * parser (lib/fresh-voices.ts) accepts the answer: a successful
 * web_search_tool_result block carrying the sources, then one text block per
 * claim, each citing the source URL it came from. Claims the CLI cannot tie
 * to a real fetched URL are dropped here rather than dressed up as evidence.
 */
async function answerWebSearch(body) {
  const maxUses = body.tools?.find((tool) => tool?.name === "web_search")?.max_uses ?? 2;
  const envelopePrompt = `${flattenMessages(body)}

Use the WebSearch tool (at most ${maxUses} search${maxUses === 1 ? "" : "es"}) to complete the task above. Then reply with ONLY this JSON shape, no commentary, no code fences:
{
  "searchCount": <number of searches you actually ran>,
  "sources": [{ "url": "<real URL from the search results>", "title": "<page title>", "page_age": "<age like '2 days ago' or an ISO date, or null if unknown>" }],
  "claims": [{ "text": "<one short factual statement in the requested answer language>", "url": "<the sources[] URL that supports it>", "cited_text": "<short quote or paraphrase from that source>" }]
}
Rules: every claim's url must appear in sources. Only include facts the search results actually support. If the searches found nothing useful, return {"searchCount": <n>, "sources": [], "claims": []}.`;

  const raw = await runClaude(envelopePrompt, { model: body.model, allowWebSearch: true });
  const envelope = extractJson(raw);
  if (!envelope || typeof envelope !== "object") throw new Error("search_answer_not_json");

  const sources = (Array.isArray(envelope.sources) ? envelope.sources : [])
    .filter((source) => typeof source?.url === "string" && /^https?:\/\//.test(source.url))
    .slice(0, 10)
    .map((source) => ({
      type: "web_search_result",
      url: source.url,
      title: typeof source.title === "string" && source.title ? source.title.slice(0, 180) : source.url,
      ...(typeof source.page_age === "string" && source.page_age ? { page_age: source.page_age.slice(0, 80) } : {}),
    }));
  const sourceUrls = new Set(sources.map((source) => source.url));
  const claims = (Array.isArray(envelope.claims) ? envelope.claims : [])
    .filter((claim) => typeof claim?.text === "string" && claim.text
      && typeof claim?.url === "string" && sourceUrls.has(claim.url)
      && typeof claim?.cited_text === "string" && claim.cited_text)
    .slice(0, 6);

  const searchCount = Number.isInteger(envelope.searchCount) && envelope.searchCount >= 0
    ? Math.min(envelope.searchCount, maxUses)
    : sources.length > 0 ? 1 : 0;

  return {
    content: [
      { type: "server_tool_use", id: "srvtoolu_local", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_local", content: sources },
      ...claims.map((claim) => ({
        type: "text",
        text: claim.text,
        citations: [{
          type: "web_search_result_location",
          url: claim.url,
          cited_text: claim.cited_text.slice(0, 300),
        }],
      })),
    ],
    stop_reason: "end_turn",
    usage: { server_tool_use: { web_search_requests: searchCount } },
  };
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || !request.url?.startsWith("/v1/messages")) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "POST /v1/messages only" } }));
    return;
  }
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "body is not JSON" } }));
      return;
    }
    const wantsSearch = Array.isArray(body.tools) && body.tools.some((tool) => tool?.name === "web_search");
    const wantsSchema = body.output_config?.format?.type === "json_schema";
    const kind = wantsSearch ? "web_search" : wantsSchema ? "json_schema" : "plain";
    log(`→ ${kind} (${body.model ?? "?"})`);
    try {
      const payload = wantsSearch
        ? await answerWebSearch(body)
        : wantsSchema
          ? await answerJsonSchema(body)
          : await answerPlain(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: `msg_local_${Date.now().toString(36)}`,
        type: "message",
        role: "assistant",
        model: body.model ?? "claude-local",
        ...payload,
      }));
      log(`← ${kind} ok`);
    } catch (error) {
      log(`← ${kind} FAILED: ${error.message}`);
      response.writeHead(529, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: String(error.message).slice(0, 200) } }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`claude-local-proxy listening on http://127.0.0.1:${PORT}`);
  log("point the app at it: ANTHROPIC_BASE_URL=http://127.0.0.1:" + PORT);
});
