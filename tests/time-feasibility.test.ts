import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTimeFeasibility } from "../lib/time-feasibility.ts";

test("finds a timed connection that cannot fit stay plus travel", () => {
  const result = analyzeTimeFeasibility(`Day 1
10:00 teamLab Planets
12:00 Senso-ji
13:00 Ghibli Museum`);

  assert.equal(result.timedStopCount, 3);
  assert.equal(result.knownLegCount, 2);
  assert.ok(result.conflictCount >= 1);
  assert.equal(result.days[0].legs[0].from.stayMinutes, 120);
  assert.ok(result.days[0].legs[0].travelMinutes! > 0);
  assert.ok(result.days[0].legs[0].bufferMinutes < 0);
});

test("accepts an explicit stay override without AI", () => {
  const result = analyzeTimeFeasibility(`1日目
09:00 浅草寺 滞在30分
10:00 東京スカイツリー`, "ja");

  assert.equal(result.days[0].stops[0].stayMinutes, 30);
  assert.equal(result.days[0].stops[0].stayIsCustom, true);
  assert.notEqual(result.days[0].legs[0].status, "unknown");
});

test("keeps an unknown leg visibly unknown instead of inventing travel time", () => {
  const result = analyzeTimeFeasibility(`Day 1
09:00 Friend's apartment
11:00 Senso-ji`);

  assert.equal(result.knownLegCount, 0);
  assert.equal(result.days[0].legs[0].travelMinutes, null);
  assert.equal(result.days[0].legs[0].status, "unknown");
});

test("preserves reservation-sensitive stop order in geographic optimization", async () => {
  const { optimizeItineraryRoute } = await import("../lib/route-optimizer.ts");
  const result = optimizeItineraryRoute(`Day 1
09:00 Tsukiji Outer Market
10:30 teamLab Planets
13:00 Senso-ji
15:30 Ghibli Museum
18:00 Shibuya Sky
20:00 Shinjuku`);
  const anchors = result.days[0].optimizedStops.filter((stop) => stop.isAnchor).map((stop) => stop.id);

  assert.deepEqual(anchors, ["teamlab-planets", "ghibli-museum", "shibuya-sky"]);
});
