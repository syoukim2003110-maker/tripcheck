import assert from "node:assert/strict";
import test from "node:test";

import { buildShioriPlan, nobodySleepsAt } from "../lib/shiori/plan.ts";
import { shioriStayMinutes } from "../lib/shiori/stay.ts";
import { auditPlan, cities, railOf, scenarioPlaces, scenarios } from "../scripts/audit-scenarios.ts";

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

test("the area to stay is not a far-out place that wins by putting the trip on fewer, fuller days", () => {
  // Was: 高山寺, a mountain temple ten kilometres out. From there the list
  // goes on two packed days (337 minutes moving); from 本能寺 in the centre
  // on three easy ones (343). Fewer days are fewer ways out and back, and
  // the least total alone decided.
  const { scenario, plan } = auditPlan("kyoto-3");
  assert.equal(plan.stayNear?.nearName, "本能寺");
  const from = (name: string) => {
    const base = scenarioPlaces(scenario).find((place) => place.name === name)!;
    return buildShioriPlan({ places: scenarioPlaces(scenario), days: scenario.days, hotel: { name: "h", lat: base.lat, lon: base.lon }, locale: "ja" }, { rail: railOf("kyoto"), cities });
  };
  const packed = (name: string) => from(name).days.filter((day) => day.load === "tight").length;
  assert.equal(packed("本能寺"), 0);
  assert.ok(packed("高山寺") > 0);
  // Top eight of Kyoto: not 伏見稲荷大社 at the southern edge for five minutes' difference, nor 延暦寺 on its mountain.
  assert.equal(auditPlan("kyoto-2").plan.stayNear?.nearName, "清水寺");
  // Tokyo: not the Skytree in the east for one minute over two days.
  assert.equal(auditPlan("tokyo-2").plan.stayNear?.nearName, "皇居");
});

test("a summit, a volcano, an island or a forest is never the area to stay while the list holds a place with beds near it", () => {
  // Was: 箱根山, the volcano itself.
  assert.equal(auditPlan("hakone-2").plan.stayNear?.nearName, "箱根神社");
  for (const kind of ["volcano", "stratovolcano", "mountain", "mountain range", "mountain pass", "island", "island group", "forest park", "waterfall", "canyon", "cave"]) assert.equal(nobodySleepsAt(kind), true, kind);
  for (const kind of [undefined, "buddhist temple", "artificial island", "hill castle", "cave church", "volcano observatory", "theme park", "beach", "urban park", "observation tower"]) assert.equal(nobodySleepsAt(kind), false, String(kind));
  // In every trip of the audit.
  for (const scenario of scenarios) {
    const { plan } = auditPlan(scenario.id);
    const places = scenarioPlaces(scenario);
    if (!plan.stayNear?.nearName || places.every((place) => nobodySleepsAt(place.kind))) continue;
    const named = places.find((place) => place.name === plan.stayNear!.nearName)!;
    assert.equal(nobodySleepsAt(named.kind), false, `${scenario.id}: ${named.name} [${named.kind}]`);
  }
  // A list of nothing but mountains still gets an answer: one of them.
  const kyoto = cities.find((city) => city.id === "kyoto")!;
  const peaks = kyoto.sights.filter((sight) => sight.kind === "mountain").slice(0, 2);
  assert.equal(peaks.length, 2);
  const plan = buildShioriPlan({ places: peaks.map((sight, index) => ({ id: `m${index}`, name: sight.ja, lat: sight.lat, lon: sight.lon, stayMinutes: 120, kind: sight.kind })), days: 1, hotel: null, locale: "ja" }, { cities });
  assert.ok(peaks.some((sight) => sight.ja === plan.stayNear?.nearName));
});
