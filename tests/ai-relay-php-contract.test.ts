import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fetchHotpepperShops } from "../lib/hotpepper-client.ts";

/*
 * deploy/xserver/api/ai.php cannot be run by this suite (no PHP here), so
 * what must hold in it is checked in its source, as for apple.php. These
 * guard the things that would fail silently on the live host: a relay with
 * no working counter running unlimited on paid keys, a caller choosing the
 * prompt or the model, a provider's error text reaching the page, and the
 * PHP relay and its local stand-in reading different rules.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const php = read("deploy/xserver/api/ai.php");
const twin = read("scripts/apple-relay-dev.ts");
const relay = read("lib/server/meal-advice-relay.ts");
const applePhp = read("deploy/xserver/api/apple.php");
const build = read("scripts/build-static.ts");
const htaccess = read("deploy/xserver/api/.htaccess");
const spec = JSON.parse(read("deploy/xserver/api/ai-spec.json"));

const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing ${start} … ${end}`);
  return source.slice(from, to);
};

test("both relays take prompts, schema, models and limits from the one ai-spec.json", () => {
  assert.match(php, /file_get_contents\(__DIR__ \. '\/ai-spec\.json'\)/);
  assert.match(twin, /readFileSync\(new URL\("\.\.\/deploy\/xserver\/api\/ai-spec\.json", import\.meta\.url\), "utf8"\)/);
  // Neither carries a model name, a prompt or a number of its own.
  for (const [name, source] of [["ai.php", php], ["meal-advice-relay.ts", relay], ["apple-relay-dev.ts", twin]] as const) {
    assert.doesNotMatch(source, /claude-opus|gpt-\d|claude-sonnet|claude-fable/, `${name} names a model`);
  }
  assert.doesNotMatch(php, /\b(?:150|8192)\b/, "ai.php repeats a limit instead of reading it");
  for (const key of ["dailyCalls", "perClientPerDay", "perClientPerMinute", "bodyBytes", "optionsPerSlot", "featuresPerOption", "keywordChars", "reasonChars", "wishChars", "nameChars", "cityChars", "minutes", "days", "stops", "slots"]) {
    assert.ok(php.includes(`['${key}']`), `ai.php does not read limits.${key}`);
    assert.ok(Number.isInteger(spec.limits[key]) || key === "reasonChars", `ai-spec.json has no limits.${key}`);
  }
  for (const list of ["tasks", "locales", "weekdays", "weather", "kinds", "meals", "party", "budget", "asks", "roles", "genres", "budgetMax", "features", "withinMeters"]) {
    assert.ok(php.includes(`['${list}']`), `ai.php does not read enums.${list}`);
    assert.ok(Array.isArray(spec.enums[list]) && spec.enums[list].length > 0, `ai-spec.json has no enums.${list}`);
  }
});

test("the spec names the models and settings that were decided", () => {
  assert.deepEqual(spec.providers.anthropic, {
    url: "https://api.anthropic.com/v1/messages", version: "2026-10-21", model: "claude-opus-5-5", maxTokens: 4000, effort: "low", timeoutSeconds: 20,
    beta: "server-side-fallback-2026-07-01", fallbacks: "default",
  });
  assert.deepEqual(spec.providers.openai, { url: "https://api.openai.com/v1/responses", model: "gpt-6.1-terra", maxOutputTokens: 4000, reasoningEffort: "low", timeoutSeconds: 20 });
  assert.deepEqual(Object.keys(spec.system).sort(), ["common", "meal-refine", "meals"]);
});

test("ai.php takes a JSON POST from this site's own pages only, and never caches", () => {
  const head = php.slice(php.indexOf("/* ------------------------------------------------------------------ request */"));
  assert.match(head, /REQUEST_METHOD'\] \?\? ''\) !== 'POST'\) respond\(405, \['code' => 'method_not_allowed'\]\);/);
  assert.match(head, /\$fetchSite !== '' && \$fetchSite !== 'same-origin'\) respond\(403, \['code' => 'forbidden'\]\);/);
  assert.match(head, /strcasecmp\(\$referer, explode\(':', \$_SERVER\['HTTP_HOST'\] \?\? ''\)\[0\]\) !== 0\) \{\s*respond\(403,/);
  assert.match(head, /stripos\(\(string\) \(\$_SERVER\['CONTENT_TYPE'\] \?\? ''\), 'application\/json'\) !== 0\) respond\(400,/);
  assert.match(php, /header\('Cache-Control: no-store'\);/);
  // The body is capped before it is parsed, by its declared and by its real size.
  assert.match(head, /\(int\) \(\$_SERVER\['CONTENT_LENGTH'\] \?\? 0\) > \$bodyLimit\) respond\(400,/);
  assert.match(head, /file_get_contents\('php:\/\/input', false, null, 0, \$bodyLimit \+ 1\);/);
  assert.match(head, /strlen\(\$rawBody\) > \$bodyLimit\) respond\(400,/);
});

test("ai.php does things in the safe order: validate, then count, then ask", () => {
  const head = php.slice(php.indexOf("/* ------------------------------------------------------------------ request */"));
  const order = ["not_configured", "$request = clean_request(", "admit($spec['limits']);", "ask_anthropic(", "ask_openai(", "respond(200, $answer);"].map((mark) => head.indexOf(mark));
  assert.ok(order.every((at) => at >= 0), "a step is missing");
  assert.deepEqual([...order].sort((left, right) => left - right), order);
  // Nothing of the caller's reaches a provider except through the cleaned request.
  assert.doesNotMatch(between(php, "function ask_anthropic(", "/* ------------------------------------------------------------------ request */"), /\$_(?:POST|GET|REQUEST|SERVER)|\$rawBody|php:\/\/input/);
  assert.match(head, /if \(\$request === null\) respond\(400, \['code' => 'invalid_request'\]\);/);
});

test("ai.php refuses when its counter cannot be opened, locked or written, and counts per site and per client", () => {
  const withState = between(php, "function with_state(", "function admit(");
  assert.doesNotMatch(withState, /\$work\(\[\]/);
  assert.match(withState, /if \(\$handle === false\) respond\(503, \['code' => 'unavailable'\]\);/);
  assert.match(withState, /if \(!flock\(\$handle, LOCK_EX\)\) \{[^}]*respond\(503,/);
  assert.match(withState, /fwrite\(\$handle, \$json\) !== strlen\(\$json\) \|\| !fflush\(\$handle\)\) \{[^}]*respond\(503,/);
  const admit = between(php, "function admit(", "/* --------------------------------------------------------------- validation");
  assert.match(admit, /hash\('sha256', \(\$_SERVER\['REMOTE_ADDR'\] \?\? 'unknown'\) \. '\|' \. date\('Y-m-d'\)\)/);
  assert.match(admit, /with_state\('ai-quota',/);
  assert.match(admit, /if \(\$calls >= \$limits\['dailyCalls'\]\) return false;/);
  assert.match(admit, /\$today >= \$limits\['perClientPerDay'\] \|\| \$thisMinute >= \$limits\['perClientPerMinute'\]\) return false;/);
  assert.match(admit, /if \(!\$allowed\) respond\(429, \['code' => 'budget_exhausted'\]\);/);
  // Its own file: apple.php is not included (it answers a request when loaded).
  assert.doesNotMatch(php, /(?:require|include)(?:_once)?\s+[^;]*apple\.php/);
});

test("ai.php sends Claude the documented request and reads the stop reason before the content", () => {
  const ask = between(php, "function ask_anthropic(", "function ask_openai(");
  assert.match(ask, /'x-api-key: ' \. \$key, 'anthropic-version: ' \. \$provider\['version'\]/);
  assert.match(ask, /'output_config' => \['effort' => \$provider\['effort'\], 'format' => \['type' => 'json_schema', 'schema' => \$spec\['answerSchema'\]\]\]/);
  assert.match(ask, /'system' => \[\['type' => 'text', 'text' => system_prompt\(\$spec, \$request\['task'\]\), 'cache_control' => \['type' => 'ephemeral'\]\]\]/);
  assert.match(ask, /'messages' => \[\['role' => 'user', 'content' => user_message\(\$request\)\]\]/);
  // Thinking is always on, sampling parameters and a forced tool call are refused by this model.
  assert.doesNotMatch(ask, /'thinking'|'temperature'|'top_p'|'tool_choice'|'tools'/);
  const stop = ask.indexOf("($body['stop_reason'] ?? null) !== 'end_turn'");
  const content = ask.indexOf("foreach ($body['content']");
  assert.ok(stop >= 0 && content > stop, "stop_reason must be checked before the content is read");
  assert.match(ask, /\(\$block\['type'\] \?\? null\) === 'text'/);
});

test("ai.php asks OpenAI with the same prompt and schema, stores nothing there, and treats a refusal as no answer", () => {
  const ask = between(php, "function ask_openai(", "/* ------------------------------------------------------------------ request */");
  assert.match(ask, /'store' => false,/);
  assert.match(ask, /'reasoning' => \['effort' => \$provider\['reasoningEffort'\]\]/);
  assert.match(ask, /'text' => \['format' => \['type' => 'json_schema', 'name' => 'meal_advice', 'schema' => \$spec\['answerSchema'\], 'strict' => true\]\]/);
  assert.match(ask, /\['role' => 'system', 'content' => system_prompt\(\$spec, \$request\['task'\]\)\]/);
  assert.match(ask, /\(\$body\['status'\] \?\? null\) !== 'completed'/);
  assert.match(ask, /=== 'refusal'\) return null;/);
});

test("ai.php falls back once, validates what comes back, and passes on a code and nothing else", () => {
  const tail = php.slice(php.indexOf("$slotIds = $request['task']"));
  assert.match(tail, /\$answer = clean_answer\(ask_anthropic\(\$spec, \$request, \$anthropicKey\), \$slotIds, \$request\['locale'\], \$spec\);/);
  assert.match(tail, /if \(\$answer === null && \$openaiKey !== null\) \{\s*\$answer = clean_answer\(ask_openai\(/);
  assert.match(tail, /if \(\$answer === null\) respond\(502, \['code' => 'unavailable'\]\);\s*respond\(200, \$answer\);\s*$/);
  // Every answer the relay gives is a cleaned answer or a bare code.
  for (const match of php.matchAll(/respond\((\d+), ([^;]*)\);/g)) {
    assert.ok(match[2] === "$answer" || /^\['code' => '[a-z_]+'\]$/.test(match[2]), `respond(${match[1]}, ${match[2]})`);
  }
  assert.doesNotMatch(php, /error_log|var_dump|print_r|\['error'\]\['message'\]/);
  // A timeout or a dropped connection is "no reply", never a half-read body.
  assert.match(php, /CURLOPT_TIMEOUT => \$timeoutSeconds,/);
  assert.match(php, /if \(!is_string\(\$body\)\) return \[0, null\];/);
});

test("ai.php's rules for text are the page's rules", () => {
  // The same patterns as lib/shiori/meal-advice-contract.ts, character for character where PHP allows.
  assert.ok(php.includes("preg_replace('/[\\p{Cc}\\p{Cf}]/u', '', $value)"));
  assert.ok(php.includes("preg_match('/^\\p{L}+$/Du', $word) !== 1"));
  assert.ok(php.includes("preg_match('/https?:|:\\/\\/|www\\.|[円¥￥$＄★☆]|\\byen\\b|\\bJPY\\b/iu', $reason) !== 1"));
  assert.ok(php.includes("preg_match('/^(?:[01]\\d|2[0-3]):[0-5]\\d$/D', $value) === 1"));
  const contract = read("lib/shiori/meal-advice-contract.ts");
  assert.ok(contract.includes("/[\\p{Cc}\\p{Cf}]/gu"));
  assert.ok(contract.includes("/^\\p{L}+$/u"));
  assert.ok(contract.includes("/https?:|:\\/\\/|www\\.|[円¥￥$＄★☆]|\\byen\\b|\\bJPY\\b/i"));
  assert.ok(contract.includes("/^(?:[01]\\d|2[0-3]):[0-5]\\d$/"));
  // The slot id is rebuilt from the day and the meal, never copied from the caller.
  assert.match(php, /\$id = 'd' \. \$day \. '-' \. \$meal;/);
  assert.match(php, /\(\$rawSlot\['slot'\] \?\? null\) !== \$id/);
  // Roles are unique per slot and options are capped.
  assert.match(php, /if \(\$option === null \|\| in_array\(\$option\['role'\], \$roles, true\)\) continue;/);
  assert.match(php, /if \(count\(\$options\) >= \$perSlot\) break;/);
});

test("the keys and the spec are not served, and the config is read only by ai.php", () => {
  assert.match(htaccess, /<FilesMatch "\^\(\(apple\|deploy\|ai\)-config\\\.php\|ai-spec\\\.json\)\$">/);
  assert.match(htaccess, /Require all denied/);
  assert.match(php, /\$configPath = __DIR__ \. '\/ai-config\.php';/);
  assert.match(php, /if \(\$anthropicKey === null && \$openaiKey === null\) respond\(503, \['code' => 'not_configured'\]\);/);
});

test("the build writes the keys only into api/ai-config.php and tells the page with a flag, never a key", () => {
  assert.match(build, /const aiConfig = aiConfigPhp\(aiKeysFromEnvironment\(environment\)\);/);
  assert.match(build, /\.\.\.\(aiConfig \? \{ NEXT_PUBLIC_TRIPCHECK_AI: "1" \} : \{\}\),/);
  assert.match(build, /if \(aiConfig\) \{\s*const aiConfigPath = join\(output, "api", "ai-config\.php"\);\s*writeFileSync\(aiConfigPath, aiConfig\);\s*chmodSync\(aiConfigPath, 0o600\);/);
  // The page's build environment stays a fixed list: no key name appears in it.
  const pageEnvironment = between(build, "env: {", "});");
  assert.doesNotMatch(pageEnvironment, /API_KEY|anthropic|openai|environment\./i);
  // What the build prints about AI says "included" or "left out", nothing more.
  const printed = [...build.matchAll(/console\.log\(([\s\S]*?)\);\n/g)].map((match) => match[1]).filter((text) => /AI/.test(text));
  assert.equal(printed.length, 1);
  assert.doesNotMatch(printed[0], /\$\{|aiKeys|environment/);
  // Variable names in .env.local are read in any case (the owner wrote Claude_API_KEY).
  assert.match(build, /matchAll\(\/\^\(\[A-Za-z_\]\[A-Za-z0-9_\]\*\)=/);
  assert.match(twin, /matchAll\(\/\^\(\[A-Za-z_\]\[A-Za-z0-9_\]\*\)=/);
});

test("the local relay answers /ai.php with the shared code and prints token counts, never keys", () => {
  const route = between(twin, 'if (url.pathname === "/ai.php") {', 'if (request.method !== "GET" || url.pathname !== "/apple.php")');
  assert.match(route, /if \(request\.method !== "POST"\) return send\(405, \{ code: "method_not_allowed" \}\);/);
  assert.match(route, /size > aiSpec\.limits\.bodyBytes\) return send\(400, \{ code: "invalid_request" \}\);/);
  assert.match(route, /answerMealAdvice\(\{/);
  assert.doesNotMatch(route, /aiKeys\.(?:anthropic|openai)\b(?! \?)/);
  for (const log of twin.matchAll(/console\.log\(([^\n]*)\);/g)) assert.doesNotMatch(log[1], /\$\{aiKeys\.(?:anthropic|openai)\}/);
});

test("a shop search accepts the advisor's genre codes and filters, and only those", async () => {
  // apple.php and its local stand-in both check against the lists in ai-spec.json.
  assert.match(applePhp, /function food_search_lists\(\): array\s*\{\s*\$raw = @file_get_contents\(__DIR__ \. '\/ai-spec\.json'\);/);
  const food = applePhp.slice(applePhp.indexOf("=== 'food') {"));
  assert.match(food, /\(\$genre !== '' && \$genre !== 'cafe' && !in_array\(\$genre, \$lists\['genres'\], true\)\)/);
  assert.match(food, /\|\| count\(\$features\) > \$lists\['featuresPerSearch'\]\s*\|\| array_diff\(\$features, \$lists\['features'\]\) !== \[\]/);
  assert.match(food, /if \(\$genre !== ''\) \$params\['genre'\] = \$genre === 'cafe' \? 'G014' : \$genre;/);
  assert.match(food, /foreach \(\$features as \$feature\) \$params\[\$feature\] = 1;/);
  // The check comes before the call is counted and before anything is asked of the guide.
  assert.ok(food.indexOf("$lists = food_search_lists();") < food.indexOf("admit();"));
  assert.match(twin, /\(genre !== "" && genre !== "cafe" && !FOOD_GENRES\.has\(genre\)\)/);
  assert.match(twin, /features\.length > aiSpec\.limits\.featuresPerOption \|\| features\.some\(\(feature\) => !FOOD_FEATURES\.has\(feature\)\)/);
  // Every filter in the list is a real yes/no parameter of the guide's search (checked against its reference).
  const documented = ["private_room", "child", "non_smoking", "card", "tatami", "horigotatsu", "barrier_free", "english", "wifi", "parking", "lunch", "open_air", "course", "free_food", "free_drink", "midnight", "midnight_meal", "pet", "sommelier", "night_view"];
  for (const feature of spec.enums.features) assert.ok(documented.includes(feature), feature);
  // A filter name can never collide with a parameter the relay sets itself.
  for (const feature of spec.enums.features) assert.ok(!["key", "lat", "lng", "range", "order", "count", "format", "keyword", "genre", "lunch"].includes(feature), feature);
  // The credit lines and what a shop carries are untouched by this.
  assert.match(food, /'photo' => \$https\(\$shop\['photo'\]\['pc'\]\['l'\] \?\? null\),/);

  const asked: string[] = [];
  await fetchHotpepperShops(
    { near: { latitude: 35.7148, longitude: 139.7967 }, withinMeters: 500, meal: "lunch", name: "蕎麦", genre: "G004", features: ["child", "non_smoking"] },
    "/api/apple.php",
    async (input) => { asked.push(String(input)); return new Response(JSON.stringify({ results: [] }), { status: 200 }); },
  );
  const url = new URL(asked[0]);
  assert.equal(url.searchParams.get("genre"), "G004");
  assert.equal(url.searchParams.get("features"), "child,non_smoking");
  assert.equal(url.searchParams.get("name"), "蕎麦");
  assert.equal(url.searchParams.get("within"), "500");
  // Without conditions the request is exactly what it was before.
  await fetchHotpepperShops({ near: { latitude: 35.7148, longitude: 139.7967 }, genre: "cafe" }, "/api/apple.php", async (input) => { asked.push(String(input)); return new Response("{}", { status: 200 }); });
  const plain = new URL(asked[1]);
  assert.equal(plain.searchParams.get("genre"), "cafe");
  assert.equal(plain.searchParams.has("features"), false);
});
