import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleMapEmbedUrl, parseMapEmbedRequest } from "../lib/google-map-embed.ts";

test("accepts a bounded Japan day route and builds a Google Maps Embed directions URL", () => {
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?language=ja&points=35.0116,135.7681%7C34.6851,135.8048");
  assert.ok(parsed);
  const url = buildGoogleMapEmbedUrl(parsed, "test-key");
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/embed\/v1\/directions\?/);
  assert.match(url, /mode=transit/);
  assert.match(url, /language=ja/);
  assert.match(url, /key=test-key/);
});

test("rejects coordinates outside Japan and excessive waypoints", () => {
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=51.5,-0.1"), null);
  const tooMany = Array.from({ length: 11 }, () => "35,135").join("|");
  assert.equal(parseMapEmbedRequest(`https://example.test/api/map-embed?points=${encodeURIComponent(tooMany)}`), null);
});
