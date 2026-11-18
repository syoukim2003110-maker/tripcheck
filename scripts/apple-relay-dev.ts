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
 *
 * It also stands in for the meal advisor's relay (deploy/xserver/api/ai.php):
 *
 *   POST http://localhost:8792/ai.php
 *   NEXT_PUBLIC_TRIPCHECK_AI=1                                     (.env.local)
 *
 * with ANTHROPIC_API_KEY (or Claude_API_KEY) and/or OPENAI_API_KEY in
 * .env.local. Prompts, schema, models and limits come from the same
 * deploy/xserver/api/ai-spec.json that ai.php reads. Token counts of each
 * call are printed here; keys and provider replies never are.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { AppleMapsClient, AppleMapsError, appleMapsCredentialsFromEnvironment } from "../lib/server/apple-maps.ts";
import { aiKeysFromEnvironment, answerMealAdvice, createMealAdviceLimiter, type MealAdviceSpec } from "../lib/server/meal-advice-relay.ts";

const PORT = Number(process.env.APPLE_RELAY_PORT ?? 8792);

function localEnvironment() {
  const environment: Record<string, string | undefined> = { ...process.env };
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const match of raw.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))$/gm)) {
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
// op=place: as many ids as one trip holds (24 places and a hotel).
const PLACE_IDS_PER_LOOKUP = 25;
const APPLE_PLACE_ID = /^[A-Za-z0-9]{4,64}$/;
// Apple answers FAILED_NOT_FOUND for an id it does not know (any more) and FAILED_INVALID_ID for a malformed one.
const PLACE_NOT_FOUND = /^FAILED_(?:NOT_FOUND|INVALID_ID)$/;

// The meal advisor: one spec file shared with ai.php.
const aiSpec = JSON.parse(readFileSync(new URL("../deploy/xserver/api/ai-spec.json", import.meta.url), "utf8")) as MealAdviceSpec & { enums: { genres: string[]; features: string[] } };
const aiKeys = aiKeysFromEnvironment(localEnvironment());
const admitMealAdvice = createMealAdviceLimiter(aiSpec);
const FOOD_GENRES = new Set(aiSpec.enums.genres);
const FOOD_FEATURES = new Set(aiSpec.enums.features);

createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";
  const send = (status: number, body: unknown) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
        ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
        : {}),
    });
    response.end(JSON.stringify(body));
  };
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/ai.php") {
    // The page is on another port here, so a JSON POST is preceded by a preflight.
    if (request.method === "OPTIONS") return send(200, {});
    if (request.method !== "POST") return send(405, { code: "method_not_allowed" });
    // Only the local page may ask, as only the site's own pages may ask ai.php.
    // (ai.php asks for a same-origin fetch; here the page is on another port, so its Origin is what is checked.)
    if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) return send(403, { code: "forbidden" });
    if (!/^application\/json\b/i.test(String(request.headers["content-type"] ?? ""))) return send(400, { code: "invalid_request" });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > aiSpec.limits.bodyBytes) return send(400, { code: "invalid_request" });
      chunks.push(chunk as Buffer);
    }
    const reply = await answerMealAdvice({
      rawBody: Buffer.concat(chunks).toString("utf8"),
      spec: aiSpec,
      keys: aiKeys,
      admit: () => admitMealAdvice(request.socket.remoteAddress ?? "unknown"),
      onUsage: (usage) => console.log(`ai ${usage.provider} ${usage.ok ? "ok" : "no answer"} in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens} ${usage.milliseconds}ms`),
    });
    return send(reply.status, reply.body);
  }
  if (request.method !== "GET" || url.pathname !== "/apple.php") return send(404, { code: "not_found" });
  if (!client) return send(503, { code: "not_configured" });

  const coordinate = /^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/;
  if (url.searchParams.get("op") === "food") {
    // The same contract as apple.php's op=food (HotPepper Gourmet; nothing is stored).
    const key = localEnvironment().HOTPEPPER_API_KEY ?? "";
    if (!/^[0-9A-Za-z]{8,64}$/.test(key)) return send(503, { code: "not_configured" });
    const at = (url.searchParams.get("near") ?? "").match(coordinate);
    const name = (url.searchParams.get("name") ?? "").trim();
    const within = Number(url.searchParams.get("within") ?? "1000");
    // The meal advisor's search conditions: a genre code and yes/no filters, each out of the fixed list.
    const genre = url.searchParams.get("genre") ?? "";
    const features = (url.searchParams.get("features") ?? "").split(",").filter(Boolean);
    if (
      !at || name.length > 60 || !Number.isInteger(within) || within < 1 || within > 3000
      || (genre !== "" && genre !== "cafe" && !FOOD_GENRES.has(genre))
      || features.length > aiSpec.limits.featuresPerOption || features.some((feature) => !FOOD_FEATURES.has(feature))
    ) return send(400, { code: "invalid_request" });
    const range = within <= 300 ? 1 : within <= 500 ? 2 : within <= 1000 ? 3 : within <= 2000 ? 4 : 5;
    const query = new URLSearchParams({ key, lat: at[1], lng: at[2], range: String(range), order: "4", count: "100", format: "json" });
    if (name) query.set("keyword", name);
    if (url.searchParams.get("meal") === "lunch") query.set("lunch", "1");
    if (genre !== "") query.set("genre", genre === "cafe" ? "G014" : genre);
    for (const feature of features) query.set(feature, "1");
    try {
      const answer = await fetch(`https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${query}`, { signal: AbortSignal.timeout(8000) });
      const body = await answer.json() as { results?: { shop?: Record<string, unknown>[] } };
      const shops = body.results?.shop;
      if (!answer.ok || !Array.isArray(shops)) return send(502, { code: "unavailable" });
      const line = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
      const https = (value: unknown) => typeof value === "string" && /^https:\/\/[a-z0-9.-]+\.(hotp\.jp|hotpepper\.jp)\//.test(value) ? value : null;
      const field = (value: unknown, ...path: string[]) => path.reduce<unknown>((at, step) => at && typeof at === "object" ? (at as Record<string, unknown>)[step] : undefined, value);
      return send(200, {
        results: shops.slice(0, 100).flatMap((shop) => {
          const shopName = line(shop.name);
          const latitude = Number(shop.lat);
          const longitude = Number(shop.lng);
          if (!shopName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
          return [{
            id: line(shop.id), name: shopName, latitude, longitude, address: line(shop.address),
            genre: line(field(shop, "genre", "name")), budget: line(field(shop, "budget", "name")), budgetAverage: line(field(shop, "budget", "average")),
            catch: line(shop.catch), open: line(shop.open), photo: https(field(shop, "photo", "pc", "l")), url: https(field(shop, "urls", "pc")),
          }];
        }),
      });
    } catch {
      return send(502, { code: "unavailable" });
    }
  }
  if (url.searchParams.get("op") === "maptoken") {
    // The same contract as apple.php's op=maptoken: a 20-minute MapKit JS
    // token tied to the page that asked. Here that page is the local app on
    // another port, so its origin comes from the Origin header.
    // A same-origin GET (the static preview proxying to this relay) carries no
    // Origin header; the page's address is then in Referer.
    const page = origin || (() => { try { return new URL(String(request.headers.referer ?? "")).origin; } catch { return ""; } })();
    if (!credentials || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(page)) return send(403, { code: "forbidden" });
    const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 1200;
    const head = b64(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }));
    const body = b64(JSON.stringify({ iss: credentials.teamId, iat: now, exp: expiresAt, origin: page }));
    try {
      const signature = createSign("SHA256").update(`${head}.${body}`).sign({ key: credentials.privateKey, dsaEncoding: "ieee-p1363" });
      return send(200, { token: `${head}.${body}.${b64(signature)}`, expiresAt, expiresIn: 1200 });
    } catch {
      return send(502, { code: "unavailable" });
    }
  }
  if (url.searchParams.get("op") === "eta") {
    const from = (url.searchParams.get("from") ?? "").match(coordinate);
    const to = (url.searchParams.get("to") ?? "").match(coordinate);
    const mode = url.searchParams.get("mode") ?? "";
    const depart = url.searchParams.get("depart");
    if (!from || !to || !["transit", "walk", "drive"].includes(mode) || (depart !== null && !Number.isFinite(Date.parse(depart)))) {
      return send(400, { code: "invalid_request" });
    }
    try {
      const eta = await client.eta({
        origin: { latitude: Number(from[1]), longitude: Number(from[2]) },
        destination: { latitude: Number(to[1]), longitude: Number(to[2]) },
        mode: mode as "transit" | "walk" | "drive",
        departureTime: depart,
      });
      return send(200, { minutes: eta?.minutes ?? null, distanceMeters: eta?.distanceMeters ?? null });
    } catch (error) {
      if (error instanceof AppleMapsError && error.code === "quota_exhausted") return send(429, { code: "budget_exhausted" });
      return send(502, { code: "unavailable" });
    }
  }

  if (url.searchParams.get("op") === "route") {
    const from = (url.searchParams.get("from") ?? "").match(coordinate);
    const to = (url.searchParams.get("to") ?? "").match(coordinate);
    const mode = url.searchParams.get("mode") ?? "";
    if (!from || !to || !["walk", "drive"].includes(mode)) return send(400, { code: "invalid_request" });
    try {
      const route = await client.route({
        origin: { latitude: Number(from[1]), longitude: Number(from[2]) },
        destination: { latitude: Number(to[1]), longitude: Number(to[2]) },
        mode: mode as "walk" | "drive",
      });
      return send(200, route
        ? { minutes: route.minutes, distanceMeters: route.distanceMeters, path: route.path.map((point) => [Number(point.latitude.toFixed(5)), Number(point.longitude.toFixed(5))]) }
        : { minutes: null, distanceMeters: null, path: [] });
    } catch (error) {
      if (error instanceof AppleMapsError && error.code === "quota_exhausted") return send(429, { code: "budget_exhausted" });
      return send(502, { code: "unavailable" });
    }
  }

  if (url.searchParams.get("op") === "place") {
    // The same contract as apple.php's op=place: places by Apple Place ID.
    const ids = (url.searchParams.get("ids") ?? "").split(",");
    const language = url.searchParams.get("lang") ?? "";
    if (
      ids.length < 1 || ids.length > PLACE_IDS_PER_LOOKUP || new Set(ids).size !== ids.length
      || ids.some((id) => !APPLE_PLACE_ID.test(id)) || !["ja-JP", "en-US"].includes(language)
    ) return send(400, { code: "invalid_request" });
    try {
      const answer = await client.places(ids, language);
      return send(200, {
        results: answer.places.filter((place) => place.id !== null && ids.includes(place.id)),
        notFound: answer.missing.filter((entry) => ids.includes(entry.id) && PLACE_NOT_FOUND.test(entry.code)).map((entry) => entry.id),
      });
    } catch (error) {
      if (error instanceof AppleMapsError && error.code === "quota_exhausted") return send(429, { code: "budget_exhausted" });
      return send(502, { code: "unavailable" });
    }
  }

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
  console.log(`Meal advisor on http://localhost:${PORT}/ai.php (Claude: ${aiKeys.anthropic ? "key found" : "no key"}, OpenAI: ${aiKeys.openai ? "key found" : "no key"})`);
});
