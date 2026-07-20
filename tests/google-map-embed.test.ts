import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleMapEmbedUrl, parseMapEmbedRequest } from "../lib/google-map-embed.ts";

test("accepts a bounded Japan day route and builds a Google Maps Embed directions URL", () => {
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?language=ja&points=35.0116,135.7681%7C34.6851,135.8048&labels=Kyoto%20Station%7CFushimi%20Inari");
  assert.ok(parsed);
  const url = buildGoogleMapEmbedUrl(parsed, "test-key");
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/embed\/v1\/directions\?/);
  assert.match(url, /mode=transit/);
  assert.match(url, /language=ja/);
  assert.match(url, /key=test-key/);
});

test("uses place labels for intermediate waypoints instead of unsupported coordinate waypoints", () => {
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?points=35.6909,139.7003%7C35.6491,139.7898%7C35.7148,139.7967&labels=Shinjuku%20Hotel%7CteamLab%20Planets%7CSensoji");
  assert.ok(parsed);
  const url = buildGoogleMapEmbedUrl(parsed, "test-key");
  assert.match(url, /origin=35.6909%2C139.7003/);
  assert.match(url, /destination=35.7148%2C139.7967/);
  assert.match(url, /waypoints=teamLab\+Planets%2C\+Japan/);
  assert.doesNotMatch(url, /waypoints=35.6491/);
});

test("rejects coordinates outside Japan and excessive waypoints", () => {
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=51.5,-0.1"), null);
  const tooMany = Array.from({ length: 11 }, () => "35,135").join("|");
  assert.equal(parseMapEmbedRequest(`https://example.test/api/map-embed?points=${encodeURIComponent(tooMany)}`), null);
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=35,135%7C36,136&labels=Only%20one"), null);
});
