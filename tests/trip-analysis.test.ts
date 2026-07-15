import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTrip } from "../lib/trip-analysis.ts";

const crossCityDraft = `Day 1
08:30 Tsukiji Outer Market
10:30 teamLab Planets
13:00 Senso-ji
15:30 Ghibli Museum
18:00 Shibuya Sky
20:00 Golden Gai`;

test("flags a cross-city Tokyo day and rebuilds it into two clusters", () => {
  const result = analyzeTrip(crossCityDraft, "balanced");

  assert.ok(result.score < 70);
  assert.ok(result.criticalCount >= 2);
  assert.match(result.issues[0].title, /Asakusa to the Ghibli Museum/);
  assert.equal(result.revisedDays.length, 2);
  assert.equal(result.revisedDays[0].theme, "Bay & old Tokyo");
  assert.equal(result.revisedDays[1].theme, "West Tokyo");
});

test("changes the density warning threshold with the selected pace", () => {
  const draft = `Day 1
09:00 Senso-ji
10:00 Asakusa
11:00 Tokyo Skytree
13:00 Akihabara
15:00 Harajuku`;

  const relaxed = analyzeTrip(draft, "relaxed");
  const fast = analyzeTrip(draft, "fast");

  assert.ok(relaxed.issues.some((issue) => issue.eyebrow === "Daily load"));
  assert.ok(!fast.issues.some((issue) => issue.eyebrow === "Daily load"));
});

test("labels unmatched input as prototype coverage instead of inventing facts", () => {
  const result = analyzeTrip(
    `Day 1\n09:00 A small gallery in Koenji\n12:00 Friend's recommendation`,
    "balanced",
  );

  assert.equal(result.criticalCount, 0);
  assert.match(result.issues[0].title, /live verification is still required/i);
});

test("recognises and explains the Japanese sample in Japanese", () => {
  const result = analyzeTrip(
    `1日目\n09:00 浅草寺\n13:00 三鷹の森ジブリ美術館\n18:00 渋谷スカイ`,
    "balanced",
    "ja",
  );

  assert.ok(result.criticalCount >= 2);
  assert.match(result.headline, /今の順番/);
  assert.match(result.issues[0].title, /浅草からジブリ美術館/);
  assert.equal(result.revisedDays[0].day, "1日目");
});

test("recognises Korean and Chinese day headings", () => {
  const korean = analyzeTrip(
    `1일차\n09:00 아사쿠사\n14:00 지브리 미술관`,
    "balanced",
    "ko",
  );
  const chinese = analyzeTrip(
    `第1天\n09:00 浅草寺\n14:00 三鹰之森吉卜力美术馆`,
    "balanced",
    "zh",
  );

  assert.match(korean.issues[0].title, /아사쿠사/);
  assert.match(chinese.issues[0].title, /浅草/);
});
