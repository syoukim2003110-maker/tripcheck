import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AppleRelayError, PLACE_IDS_PER_LOOKUP, appleRelayPlaces } from "../lib/apple-relay-client.ts";

/*
 * The relay's op=place: a trip keeps a place found through Apple as its
 * Place ID alone, and its name and position are asked for again through
 * this op each time the trip is opened. apple.php cannot be run here (no
 * PHP), so its contract is checked in its source, beside the Node twin's
 * and the page's side.
 */

const php = readFileSync(new URL("../deploy/xserver/api/apple.php", import.meta.url), "utf8");
const twin = readFileSync(new URL("../scripts/apple-relay-dev.ts", import.meta.url), "utf8");
const placeBlock = php.slice(php.indexOf("if (($_GET['op'] ?? '') === 'place') {"), php.indexOf("$query = trim((string) ($_GET['q'] ?? ''));"));

test("apple.php op=place: only this site's pages, counted against the same quota as every other op", () => {
  assert.ok(placeBlock.length > 200, "apple.php has no op=place block");
  // The site-only checks run before any op.
  assert.ok(php.indexOf("$fetchSite !== 'same-origin'") < php.indexOf("=== 'place') {"));
  assert.ok(php.indexOf("respond(405,") < php.indexOf("=== 'place') {"));
  // The request is checked, then admitted, then sent.
  const checked = placeBlock.indexOf("respond(400, ['code' => 'invalid_request']);");
  const admitted = placeBlock.indexOf("admit();");
  const sent = placeBlock.indexOf("apple_get(");
  assert.ok(checked > 0 && admitted > checked && sent > admitted);
});

test("apple.php op=place takes 1 to 25 distinct ids of letters and digits and one of the two languages", () => {
  assert.match(php, /const PLACE_IDS_PER_LOOKUP = 25;/);
  assert.equal(PLACE_IDS_PER_LOOKUP, 25);
  assert.match(placeBlock, /count\(\$ids\) < 1 \|\| count\(\$ids\) > PLACE_IDS_PER_LOOKUP \|\| count\(array_unique\(\$ids\)\) !== count\(\$ids\)/);
  assert.match(placeBlock, /preg_match\('\/\^\[A-Za-z0-9\]\{4,64\}\$\/D', \$id\) !== 1/);
  assert.match(placeBlock, /in_array\(\$language, \['ja-JP', 'en-US'\], true\)/);
  // Apple is asked at /v1/place with exactly those ids.
  assert.match(placeBlock, /APPLE_ORIGIN \. '\/v1\/place\?' \. http_build_query\(\['ids' => implode\(',', \$ids\), 'lang' => \$language\]/);
});

test("apple.php op=place: an outage is an outage, only Apple's two 'no such place' codes say a place is gone, and nothing is kept", () => {
  assert.match(placeBlock, /if \(\$status === 429\) respond\(429, \['code' => 'budget_exhausted'\]\);/);
  assert.match(placeBlock, /if \(\$status !== 200 \|\| !is_array\(\$body\)\) respond\(502, \['code' => 'unavailable'\]\);/);
  assert.match(placeBlock, /in_array\(\$code, \['FAILED_NOT_FOUND', 'FAILED_INVALID_ID'\], true\)/);
  // Only places that were asked for are passed on.
  assert.match(placeBlock, /in_array\(\$result\['id'\], \$ids, true\)/);
  // No answer is written anywhere: the only state is the quota count admit() keeps.
  assert.doesNotMatch(placeBlock, /file_put_contents|with_state|fopen|\$save\(/);
});

test("the local relay keeps the same op=place contract", () => {
  assert.match(twin, /const PLACE_IDS_PER_LOOKUP = 25;/);
  assert.match(twin, /const APPLE_PLACE_ID = \/\^\[A-Za-z0-9\]\{4,64\}\$\/;/);
  assert.match(twin, /const PLACE_NOT_FOUND = \/\^FAILED_\(\?:NOT_FOUND\|INVALID_ID\)\$\/;/);
  assert.match(twin, /\["ja-JP", "en-US"\]\.includes\(language\)/);
});

const place = (id: string, name: string) => ({ id, name, latitude: 34.296, longitude: 132.319, formattedAddress: "宮島町1-1", locality: "廿日市市", subLocality: null, countryCode: "JP", poiCategory: null });

test("the page asks for a whole trip in requests of at most 25 ids and reads what was found and what is gone", async () => {
  const ids = Array.from({ length: 30 }, (_, index) => `I${String(index).padStart(15, "0")}`);
  const asked: string[][] = [];
  const fetcher = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("op"), "place");
    assert.equal(url.searchParams.get("lang"), "ja-JP");
    const batch = (url.searchParams.get("ids") ?? "").split(",");
    asked.push(batch);
    return new Response(JSON.stringify({
      // An answer for an id that was not asked for is not taken.
      results: [...batch.slice(1).map((id) => place(id, `名所 ${id}`)), place("INOTASKED0000000", "別の場所")],
      notFound: [batch[0]],
    }), { status: 200 });
  }) as typeof fetch;
  const answer = await appleRelayPlaces(ids, "ja-JP", "http://relay.test/apple.php", fetcher);
  assert.deepEqual(asked.map((batch) => batch.length), [25, 5]);
  assert.equal(answer.found.size, 28);
  assert.deepEqual([...answer.notFound].sort(), [ids[0], ids[25]].sort());
  assert.equal(answer.found.has("INOTASKED0000000"), false);
  assert.equal(answer.found.get(ids[1])?.name, `名所 ${ids[1]}`);
});

test("the page tells a spent budget and an outage apart, and asks nothing without a relay", async () => {
  const answering = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  await assert.rejects(appleRelayPlaces(["I7EA0EDCABFD8E819"], "en-US", "http://relay.test/apple.php", answering(429, { code: "budget_exhausted" })),
    (error: unknown) => error instanceof AppleRelayError && error.code === "quota_exhausted");
  await assert.rejects(appleRelayPlaces(["I7EA0EDCABFD8E819"], "en-US", "http://relay.test/apple.php", answering(502, { code: "unavailable" })),
    (error: unknown) => error instanceof AppleRelayError && error.code === "unavailable");
  await assert.rejects(appleRelayPlaces(["I7EA0EDCABFD8E819"], "en-US", null),
    (error: unknown) => error instanceof AppleRelayError && error.code === "not_configured");
  // A malformed id is never sent: it can only be "not found".
  let calls = 0;
  const answer = await appleRelayPlaces(["bad id!"], "en-US", "http://relay.test/apple.php", (async () => { calls += 1; return new Response("{}"); }) as typeof fetch);
  assert.equal(calls, 0);
  assert.deepEqual([...answer.notFound], ["bad id!"]);
});
