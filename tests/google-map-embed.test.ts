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
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?destination=japan&points=35.6909,139.7003%7C35.6491,139.7898%7C35.7148,139.7967&labels=Shinjuku%20Hotel%7CteamLab%20Planets%7CSensoji");
  assert.ok(parsed);
  const url = buildGoogleMapEmbedUrl(parsed, "test-key");
  assert.match(url, /origin=35.6909%2C139.7003/);
  assert.match(url, /destination=35.7148%2C139.7967/);
  assert.match(url, /waypoints=teamLab\+Planets%2C\+Japan/);
  assert.doesNotMatch(url, /waypoints=35.6491/);
});

test("accepts any real coordinate but rejects impossible ones, unknown countries and excessive waypoints", () => {
  // London is a legitimate trip now; only impossible coordinates are refused.
  assert.ok(parseMapEmbedRequest("https://example.test/api/map-embed?points=51.5,-0.1"));
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=95,-0.1"), null);
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=35,200"), null);
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?destination=narnia&points=35,135"), null);
  const tooMany = Array.from({ length: 11 }, () => "35,135").join("|");
  assert.equal(parseMapEmbedRequest(`https://example.test/api/map-embed?points=${encodeURIComponent(tooMany)}`), null);
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=35,135%7C36,136&labels=Only%20one"), null);
  assert.equal(parseMapEmbedRequest("https://example.test/api/map-embed?points=35,135&zoom=0"), null);
});

test("a Swiss route is biased to Switzerland, not Japan", () => {
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?destination=switzerland&points=46.6863,7.8632%7C46.5474,7.9853%7C46.0207,7.7491&labels=Interlaken%7CJungfraujoch%7CZermatt");
  assert.ok(parsed);
  const url = buildGoogleMapEmbedUrl(parsed, "test-key");
  assert.match(url, /region=CH/);
  assert.match(url, /waypoints=Jungfraujoch%2C\+Switzerland/);
  assert.doesNotMatch(url, /Japan/);
});

test("a car-first country routes the embed by road instead of transit", () => {
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?destination=iceland&points=64.1466,-21.9426%7C64.2559,-21.1226");
  assert.ok(parsed);
  assert.match(buildGoogleMapEmbedUrl(parsed, "test-key"), /mode=driving/);
});

test("supports a zoomed-out Japan overview before a trip exists", () => {
  const parsed = parseMapEmbedRequest("https://example.test/api/map-embed?destination=japan&language=ja&points=36.2048,138.2529&labels=Japan&zoom=5&overview=1");
  assert.ok(parsed);
  assert.equal(parsed.zoom, 5);
  const url = buildGoogleMapEmbedUrl(parsed, "test-key");
  assert.match(url, /\/embed\/v1\/view\?/);
  assert.match(url, /zoom=5/);
  assert.match(url, /center=36.2048%2C138.2529/);
});
