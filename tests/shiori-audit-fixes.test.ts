import assert from "node:assert/strict";
import test from "node:test";

import { shioriStayMinutes } from "../lib/shiori/stay.ts";
import { auditPlan, cities } from "../scripts/audit-scenarios.ts";

/*
 * Faults a reader found in the 63 trips of the plan audit
 * (scripts/audit-plans.ts). Each test builds the very trip that showed the
 * fault and asserts what a traveller would have seen go wrong.
 */

const stopNamed = (id: string, name: RegExp) => {
  const { plan } = auditPlan(id);
  const stop = plan.days.flatMap((day) => day.stops).find((entry) => name.test(entry.place.name));
  assert.ok(stop, `${id} has no stop ${name}`);
  return stop;
};

test("a food hall, a small fairground or a children's museum is a visit of a couple of hours, not a seven-hour theme-park day", () => {
  // Were all 420 minutes: one stop ate a day and pushed the rest into the night.
  assert.equal(stopNamed("yokohama-1", /ラーメン博物館/).stayMinutes, 150);
  assert.equal(stopNamed("yokohama-2", /コスモワールド/).stayMinutes, 150);
  assert.equal(stopNamed("hiroshima-3", /マリーナホップ/).stayMinutes, 150);
  assert.equal(stopNamed("kobe-3", /アンパンマン/).stayMinutes, 150);
  assert.equal(stopNamed("paris-3", /アクリマタシオン/).stayMinutes, 150);
  // Two days of Yokohama no longer run until ten at night because of them.
  const { plan } = auditPlan("yokohama-2");
  assert.equal(plan.days.some((day) => day.runsLate), false, plan.days.map((day) => `${day.start}–${day.end}`).join(" "));
  // A park that is a day out keeps its day.
  assert.equal(stopNamed("nikko-3", /江戸村/).stayMinutes, 360);
});

test("every bundled sight of an amusement or theme-park kind has the stay its size calls for, and none gets a long one by its category alone", () => {
  const expected: Record<string, number> = {
    // The whole day.
    "東京ディズニーランド": 480,
    "東京ディズニーシー": 480,
    "香港ディズニーランド": 480,
    "ユニバーサル・スタジオ・ジャパン": 480,
    "ユニバーサル・スタジオ・シンガポール": 480,
    "ユニバーサル・スタジオ・ハリウッド": 480,
    // Most of a day.
    "香港海洋公園": 360,
    "ロッテワールド": 360,
    "日光江戸村": 360,
    // Half a day: a ride park or a water park.
    "チボリ公園": 240,
    "グローナルンド遊園地": 240,
    "八木山ベニーランド": 240,
    "Dam Sen Cultural Park": 240,
    "ワイルド・ワディ・ウォーター・パーク": 240,
    "Wild Wild Wet": 240,
    // A couple of hours: what the category alone gives.
    "神戸アンパンマンこどもミュージアム&モール": 150,
    "仙台アンパンマンこどもミュージアム&モール": 150,
    "新横浜ラーメン博物館": 150,
    "よこはまコスモワールド": 150,
    "GUNDAM FACTORY YOKOHAMA": 150,
    "名古屋港シートレインランド": 150,
    "あま市七宝焼アートヴィレッジ": 150,
    "マリーナホップ": 150,
    "美浜タウンリゾート・アメリカンビレッジ": 150,
    "マカオ・フィッシャーマンズ・ワーフ": 150,
    "ハウパーヴィラ": 150,
    "アクリマタシオン庭園": 150,
    "ドバイランド": 150,
    // A building of food stalls.
    "お好み村": 75,
  };
  const found = new Map<string, number>();
  for (const city of cities) {
    for (const sight of city.sights) {
      if (/amusement|theme park/i.test(sight.kind ?? "")) found.set(sight.ja, shioriStayMinutes(sight.kind, `${sight.ja} ${sight.en}`));
    }
  }
  // A sight added to the list later fails here until someone has decided its size.
  assert.deepEqual(Object.fromEntries([...found].sort()), Object.fromEntries(Object.entries(expected).sort()));
  assert.equal(shioriStayMinutes("amusement park", "どこかの遊園地"), 150);
  assert.equal(shioriStayMinutes("theme park", "富士急ハイランド"), 420);
});

test("the way back to a Taipei hotel is not a ride on a line that does not run there", () => {
  // Was: 台北捷運環状線 松山駅→永春駅 (1 stop, 3 min), then 23 minutes on foot.
  const { plan } = auditPlan("taipei-2");
  const rides = plan.days.flatMap((day) => [day.fromHotel, ...day.legs, day.toHotel]).flatMap((leg) => leg?.rail?.rides ?? []);
  assert.ok(rides.length > 0);
  for (const ride of rides.filter((entry) => entry.line === "台北捷運環状線")) assert.ok(!/松山|永春/.test(`${ride.from}${ride.to}`), `${ride.from}→${ride.to}`);
});
