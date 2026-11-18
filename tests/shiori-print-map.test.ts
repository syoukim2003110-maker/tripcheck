import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SNAPSHOT_MAX_URL, readSnapshotSpec, signSnapshotPath, snapshotFrame, snapshotPath } from "../lib/server/apple-snapshot.ts";
import type { ShioriLeg, ShioriStop } from "../lib/shiori/plan.ts";
import { SNAPSHOT_LIMITS, daySnapshotSpec, encodePolyline, requestSnapshotUrl, snapshotSpecParam, type SnapshotSpec } from "../lib/shiori/print-map.ts";

/*
 * The printed booklet's Apple maps: one Apple Maps Web Snapshot per day,
 * signed by the relay (op=snapshot) when the traveller prints. On paper a
 * day still carries Apple's place names and minutes, and Apple's terms show
 * those only with the Apple map they belong to.
 */

const stop = (id: string, lat: number, lon: number) => ({ place: { id, name: id, lat, lon, stayMinutes: 60 } }) as unknown as ShioriStop;
const leg = (mode: ShioriLeg["mode"], path: Array<[number, number]>, how: "path" | "none" = "path") => ({
  mode, minutes: 10, path: path.map(([latitude, longitude]) => ({ latitude, longitude })), hasPath: how === "path", noPath: how === "none",
}) as unknown as ShioriLeg;

test("the encoded polyline is Google's, the form Apple's snapshot overlays read", () => {
  // Google's own worked example.
  assert.equal(encodePolyline([{ latitude: 38.5, longitude: -120.2 }, { latitude: 40.7, longitude: -120.95 }, { latitude: 43.252, longitude: -126.453 }]), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
});

test("a day's picture: its stops numbered in order, the hotel, and each leg drawn as the screen's map draws it", () => {
  const stops = Array.from({ length: 11 }, (_, index) => stop(`s${index}`, 34.39 + index / 1000, 132.45 + index / 1000));
  const spec = daySnapshotSpec({
    stops,
    legs: [
      leg("walk", [[34.39, 132.45], [34.3905, 132.4502], [34.391, 132.451]]),
      leg("rail", [[34.391, 132.451], [34.392, 132.452]]),
      // A way that could not be looked up: two points, dashed grey.
      leg("taxi", [[34.392, 132.452], [34.3925, 132.4527], [34.393, 132.453]], "none"),
      // Still being looked up: not drawn yet, as on screen.
      leg("walk", [[34.393, 132.453], [34.394, 132.454]], "pending" as never),
    ],
    fromHotel: leg("walk", [[34.385, 132.455], [34.39, 132.45]]),
    toHotel: null,
  }, { lat: 34.3853, lon: 132.4553 })!;
  assert.deepEqual(spec.p.map(([, , glyph, kind]) => `${glyph}:${kind}`), [
    "1:stop", "2:stop", "3:stop", "4:stop", "5:stop", "6:stop", "7:stop", "8:stop", "9:stop",
    // A number from 10 on is not one character: the pin is left blank, the printed list numbers it.
    ":stop", ":stop", "H:hotel",
  ]);
  assert.deepEqual(spec.l.map(([kind]) => kind), ["hotel", "street", "rail", "straight"]);
  // The unknown way is the straight line between its ends, never the path guessed for it.
  assert.equal(spec.l[3][1], encodePolyline([{ latitude: 34.392, longitude: 132.452 }, { latitude: 34.393, longitude: 132.453 }]));
  assert.equal(daySnapshotSpec({ stops: [], legs: [], fromHotel: null, toHotel: null }, null), null);
});

test("a long day is thinned until its picture fits in a URL Apple takes, and the relay accepts what the page sends", () => {
  const path = Array.from({ length: 160 }, (_, index) => [35 + index / 997, 139 + Math.sin(index) / 300] as [number, number]);
  const legs = Array.from({ length: 12 }, () => leg("walk", path));
  const stops = Array.from({ length: 13 }, (_, index) => stop(`s${index}`, 35 + index / 100, 139 + index / 100));
  const spec = daySnapshotSpec({ stops, legs, fromHotel: null, toHotel: null }, null)!;
  assert.ok(spec.l.reduce((sum, [, line]) => sum + line.length, 0) <= SNAPSHOT_LIMITS.encodedChars);
  const read = readSnapshotSpec(snapshotSpecParam(spec));
  assert.ok(read, "the relay reads the page's description");
  const signedPath = snapshotPath(read!, "ja-JP", 1_800_000_000, "TEAMID1234", "KEYID12345");
  assert.ok(signedPath.length <= SNAPSHOT_MAX_URL, `${signedPath.length}`);
});

test("the relay takes only exactly what the contract says", () => {
  const good: SnapshotSpec = { p: [[34.39, 132.45, "1", "stop"]], l: [["street", "_p~iF~ps|U"]] };
  const param = (spec: unknown) => Buffer.from(JSON.stringify(spec)).toString("base64url");
  assert.ok(readSnapshotSpec(param(good)));
  for (const bad of [
    { p: [], l: [] },
    { p: [[34.39, 132.45, "10", "stop"]], l: [] },
    { p: [[34.39, 132.45, "x", "stop"]], l: [] },
    { p: [[34.39, 132.45, "1", "red"]], l: [] },
    { p: [["34.39", 132.45, "1", "stop"]], l: [] },
    { p: [[91, 132.45, "1", "stop"]], l: [] },
    { p: Array.from({ length: 31 }, () => [34.39, 132.45, "", "stop"]), l: [] },
    { p: [[34.39, 132.45, "1", "stop"]], l: [["street", "has space"]] },
    { p: [[34.39, 132.45, "1", "stop"]], l: [["purple", "_p~iF"]] },
    { p: [[34.39, 132.45, "1", "stop"]], l: [["street", "_p~iF", "extra"]] },
  ]) assert.equal(readSnapshotSpec(param(bad)), null, JSON.stringify(bad));
  assert.equal(readSnapshotSpec("not base64!"), null);
  assert.equal(readSnapshotSpec(null), null);
});

test("the signed URL: the picture fixed by the relay, the expiry, team and key last, then a signature of exactly that path", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const request = readSnapshotSpec(Buffer.from(JSON.stringify({ p: [[34.39, 132.45, "1", "stop"], [34.38, 132.46, "H", "hotel"]], l: [["straight", "_p~iF~ps|U"]] })).toString("base64url"))!;
  const path = snapshotPath(request, "en-US", 1_800_000_000, "TEAMID1234", "KEYID12345");
  const url = new URL(signSnapshotPath(path, pem));
  assert.equal(url.origin, "https://snapshot.apple-mapkit.com");
  assert.deepEqual([...url.searchParams.keys()], ["center", "spn", "size", "scale", "t", "colorScheme", "poi", "lang", "annotations", "overlays", "expires", "teamId", "keyId", "signature"]);
  assert.equal(url.searchParams.get("poi"), "0");
  assert.equal(url.searchParams.get("t"), "mutedStandard");
  assert.deepEqual(JSON.parse(url.searchParams.get("annotations")!), [
    { point: "34.39,132.45", color: "1967D2", markerStyle: "balloon", glyphText: "1" },
    { point: "34.38,132.46", color: "1F2937", markerStyle: "balloon", glyphText: "H" },
  ]);
  // A way that could not be looked up is dashed and grey on paper too.
  assert.deepEqual(JSON.parse(url.searchParams.get("overlays")!), [{ points: "_p~iF~ps|U", strokeColor: "6B7280", lineWidth: 2, lineDash: [5, 5] }]);
  const signature = url.searchParams.get("signature")!;
  const signed = url.pathname + url.search.slice(0, url.search.indexOf("&signature="));
  assert.equal(signed, path);
  assert.ok(createVerify("SHA256").update(path).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  // Framed on the pins, with room around them.
  const [center, span] = snapshotFrame(request.pins);
  assert.equal(url.searchParams.get("center"), center);
  assert.equal(url.searchParams.get("spn"), span);
});

test("the page takes only a snapshot URL of Apple's, and none without a relay", async () => {
  const spec: SnapshotSpec = { p: [[34.39, 132.45, "1", "stop"]], l: [] };
  const answering = (body: unknown, status = 200) => (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("op"), "snapshot");
    assert.equal(url.searchParams.get("spec"), snapshotSpecParam(spec));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  assert.equal(await requestSnapshotUrl(spec, "ja-JP", "http://relay.test/apple.php", answering({ url: "https://snapshot.apple-mapkit.com/api/v1/snapshot?center=1&signature=x" })), "https://snapshot.apple-mapkit.com/api/v1/snapshot?center=1&signature=x");
  assert.equal(await requestSnapshotUrl(spec, "ja-JP", "http://relay.test/apple.php", answering({ url: "https://evil.example/x.png" })), null);
  assert.equal(await requestSnapshotUrl(spec, "ja-JP", "http://relay.test/apple.php", answering({ code: "budget_exhausted" }, 429)), null);
  assert.equal(await requestSnapshotUrl(spec, "ja-JP", null), null);
});

const php = readFileSync(new URL("../deploy/xserver/api/apple.php", import.meta.url), "utf8");
const snapshotBlock = php.slice(php.indexOf("if (($_GET['op'] ?? '') === 'snapshot') {"), php.indexOf("if (($_GET['op'] ?? '') === 'eta') {"));
const twin = readFileSync(new URL("../lib/server/apple-snapshot.ts", import.meta.url), "utf8");

test("apple.php op=snapshot keeps the same contract: this site's page only, checked, counted, framed and signed the same way", () => {
  assert.ok(snapshotBlock.length > 500, "apple.php has no op=snapshot block");
  assert.match(snapshotBlock, /if \(\(\$_SERVER\['HTTP_SEC_FETCH_SITE'\] \?\? ''\) !== 'same-origin'\) respond\(403/);
  assert.match(snapshotBlock, /if \(!hash_equals\(substr\(\$siteOrigin, 8\), \$host\)\) respond\(403/);
  assert.match(snapshotBlock, /preg_match\('\/\^\[1-9H\]\?\$\/D', \$pin\[2\]\)/);
  assert.match(snapshotBlock, /preg_match\('\/\^\[\\x3f-\\x7e\]\{2,2000\}\$\/D', \$line\[1\]\)/);
  assert.match(snapshotBlock, /count\(\$pins\) < 1 \|\| count\(\$pins\) > 30 \|\| !is_array\(\$lines\) \|\| count\(\$lines\) > 40/);
  assert.ok(snapshotBlock.indexOf("admit();") > snapshotBlock.lastIndexOf("respond(400, ['code' => 'invalid_request']);\n        }\n        $overlays"), "admitted only once the description is checked");
  assert.match(snapshotBlock, /\$expires = time\(\) \+ 900;/);
  assert.match(snapshotBlock, /if \(strlen\(\$path\) > 8000\) respond\(400/);
  assert.match(snapshotBlock, /'https:\/\/snapshot\.apple-mapkit\.com' \. \$path \. '&signature=' \. \$signature/);
  assert.match(snapshotBlock, /der_to_raw_signature\(\$der\)/);
  // Same order of parameters, same frame, same colours and lines as the local relay's.
  const order = [...snapshotBlock.slice(snapshotBlock.indexOf("$params = [")).matchAll(/(?:\$params\['|^\s*')(\w+)'(?:\] =| =>)/gm)].map((match) => match[1]);
  assert.deepEqual(order, ["center", "spn", "size", "scale", "t", "colorScheme", "poi", "lang", "annotations", "overlays", "expires", "teamId", "keyId"]);
  for (const colour of ["1967D2", "1F2937", "6B7280"]) {
    assert.ok(snapshotBlock.includes(`'${colour}'`) && twin.includes(`"${colour}"`), colour);
  }
  assert.match(snapshotBlock, /'lineDash' => \[5, 5\]/);
  assert.match(snapshotBlock, /\* 1\.6, 0\.006\), max\(\(\$east - \$west\) \* 1\.35, 0\.009\)/);
  assert.match(twin, /\* 1\.6, 0\.006\);[\s\S]*\* 1\.35, 0\.009\);/);
  // Nothing of the picture is kept.
  assert.doesNotMatch(snapshotBlock, /file_put_contents|with_state|fopen/);
});

test("on paper each day carries its Apple map, asked for when the traveller prints; on screen it is not shown", () => {
  const app = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/shiori/shiori.css", import.meta.url), "utf8");
  assert.match(app, /<button onClick=\{\(\) => void printBooklet\(\)\} type="button"><Icon name="printer" \/>/);
  assert.match(app, /const printBooklet = async \(\) => \{\s*await preparePrintMaps\(\);\s*window\.print\(\);/);
  // The browser's own print menu asks for them too.
  assert.match(app, /void preparePrintMaps\(\);\s*\};/);
  const figure = app.slice(app.indexOf('<figure className="shiori-print-map">'), app.indexOf("</figure>"));
  assert.match(figure, /<img alt=\{t\.printMapAlt\(day\.index\)\} height=\{400\} src=\{printMaps\.urls\[day\.index\]!\} width=\{600\} \/>/);
  // TripCheck's own lines on Apple's picture are credited under it; Apple's logo is in the picture.
  assert.match(figure, /\{t\.mapRailCredit\}[\s\S]*\{t\.mapStreetCredit\}/);
  assert.match(figure, /\{t\.printMapNone\}/);
  assert.match(css, /^\.shiori-print-map \{ display: none; \}$/m);
  assert.match(css, /@media print \{[\s\S]*\.shiori-print-map \{ break-inside: avoid; display: block;/);
  for (const key of ["printMapAlt", "printMapNone"]) assert.equal(app.split("\n").filter((line) => line.startsWith(`    ${key}: `)).length, 2, key);
});
