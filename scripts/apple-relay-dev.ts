/*
 * Local stand-in for the production Apple Maps relay (deploy/xserver/api/apple.php).
 *
 * Same contract, same validation, run with Node so the page can be developed
 * against the real Apple service:
 *
 *   pnpm relay:dev
 *   NEXT_PUBLIC_APPLE_RELAY_URL=http://localhost:8792/apple.php   (.env.local)
 *
 * Reads APPLE_MAPS_TEAM_ID / APPLE_MAPS_KEY_ID / APPLE_MAPS_PRIVATE_KEY from
 * .env.local. Never deployed.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { AppleMapsClient, AppleMapsError, appleMapsCredentialsFromEnvironment } from "../lib/server/apple-maps.ts";

const PORT = Number(process.env.APPLE_RELAY_PORT ?? 8792);

function localEnvironment() {
  const environment: Record<string, string | undefined> = { ...process.env };
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const match of raw.matchAll(/^([A-Z_][A-Z0-9_]*)=(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))$/gm)) {
      environment[match[1]] ??= (match[2] ?? match[3] ?? match[4] ?? "").trim();
    }
  } catch {
    // No .env.local: the relay answers not_configured.
  }
  return environment;
}

const credentials = appleMapsCredentialsFromEnvironment(localEnvironment());
const client = credentials ? new AppleMapsClient(credentials) : null;

const ALLOWED_CATEGORIES = new Set(["Restaurant", "Cafe", "Bakery", "Hotel"]);

createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";
  const send = (status: number, body: unknown) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    });
    response.end(JSON.stringify(body));
  };
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (request.method !== "GET" || url.pathname !== "/apple.php") return send(404, { code: "not_found" });
  if (!client) return send(503, { code: "not_configured" });

  const query = (url.searchParams.get("q") ?? "").trim();
  const language = url.searchParams.get("lang") ?? "";
  const near = (url.searchParams.get("near") ?? "").match(/^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/);
  const within = Number(url.searchParams.get("within") ?? 0);
  const categories = (url.searchParams.get("categories") ?? "").split(",").filter(Boolean);
  if (
    query.length < 1 || query.length > 120
    || !["ja-JP", "en-US"].includes(language)
    || (url.searchParams.has("near") && !near)
    || !Number.isFinite(within) || within < 0 || within > 5_000
    || categories.some((category) => !ALLOWED_CATEGORIES.has(category))
  ) return send(400, { code: "invalid_request" });

  try {
    const results = await client.search({
      query,
      language,
      near: near ? { latitude: Number(near[1]), longitude: Number(near[2]) } : null,
      withinMeters: near && within > 0 ? within : null,
      poiCategories: categories,
      poiOnly: url.searchParams.get("poi") === "1",
    });
    send(200, { results: results.slice(0, 20) });
  } catch (error) {
    if (error instanceof AppleMapsError && error.code === "quota_exhausted") return send(429, { code: "budget_exhausted" });
    send(502, { code: "unavailable" });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Apple Maps dev relay on http://localhost:${PORT}/apple.php (${client ? "configured" : "NOT configured"})`);
});
