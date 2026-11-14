/*
 * The published Toei departures shown beside a dated ride. A small made-up
 * line pins each rule (a loop, a train that ends early, an express that
 * passes a station, a train after midnight, the last train, a through train
 * whose time at the junction is not published); the real file and the real
 * Tokyo map then pin that the two agree on every Toei station.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { RailNetwork, type RailNetworkData } from "../lib/rail-router.ts";
import {
  calendarFor, clockOf, dayKind, hasToeiRide, isToeiTimetableData, legTimetables, matchStation, normaliseStationName,
  rideTimetable, serviceMinutes, toeiRailwayId, type TimetableRide, type ToeiRailway, type ToeiTimetableData,
} from "../lib/shiori/timetable.ts";

// Six stations on a north–south line, 0.01° (about 1.1 km) apart; E sits
// beside A as a loop would bring it round.
const stations: ToeiRailway["stations"] = [
  ["甲", "Ko", 35.70, 139.70],
  ["乙", "Otsu", 35.71, 139.70],
  ["丙", "Hei", 35.72, 139.70],
  ["丁", "Tei", 35.73, 139.70],
  ["戊", "Bo", 35.74, 139.70],
  ["市ケ谷", "Ichigaya", 35.75, 139.70],
];
const point = (index: number) => ({ latitude: stations[index][2], longitude: stations[index][3] });
const railway: ToeiRailway = {
  id: "Oedo",
  ja: "大江戸線",
  en: "Oedo Line",
  issued: "2025-03-17",
  stations,
  patterns: [
    [0, 1, 2, 3, 4], // all stations northbound
    [0, 1, 2], // ends early at 丙
    [0, 2, 3], // express: passes 乙
    [4, 3, 2, 1, 0], // southbound
    [0, 1, 2, 3, 4, 5], // to 市ケ谷, then on to another company with no time there
  ],
  calendars: {
    Weekday: [
      [0, 0, 0, 600, 2, 2, 2, 2], // 10:00 local to 戊
      [1, 1, 0, 605, 2, 2], // 10:05 to 丙 only
      [2, 0, 1, 608, 3, 2], // 10:08 express, passes 乙
      [3, 2, 0, 603, 2, 2, 2, 2], // 10:03 southbound
      [0, 0, 0, 1_450, 2, 2, 2, 2], // 00:10 after midnight
      [4, 3, 0, 620, 2, 2, 2, 2, -1], // 10:20 through train, 市ケ谷 time not published
    ],
    SaturdayHoliday: [
      [0, 0, 0, 700, 2, 2, 2, 2],
    ],
  },
};
const data: ToeiTimetableData = {
  licence: "CC BY 4.0",
  credit: { ja: "東京都交通局・公共交通オープンデータ協議会", en: "Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation" },
  types: [["", ""], ["急行", "Express"]],
  destinations: [["戊", "Bo"], ["丙", "Hei"], ["甲", "Ko"], ["笹塚", "Sasazuka"]],
  railways: [railway],
};
const ride = (from: number, to: number, overrides: Partial<TimetableRide> = {}): TimetableRide => {
  const step = from < to ? 1 : -1;
  const path = [];
  for (let index = from; index !== to + step; index += step) path.push(point(index));
  return { line: "都営地下鉄大江戸線", from: `${stations[from][0]}駅`, to: `${stations[to][0]}駅`, minutes: 2 * Math.abs(to - from), path, ...overrides };
};
const WEDNESDAY = "2026-11-18";

test("a line is a Toei line only by its whole name, in either language", () => {
  assert.equal(toeiRailwayId("都営地下鉄大江戸線"), "Oedo");
  assert.equal(toeiRailwayId("Toei Ōedo Line"), "Oedo");
  assert.equal(toeiRailwayId("Asakusa Line"), "Asakusa");
  assert.equal(toeiRailwayId("日暮里・舎人ライナー"), "NipporiToneri");
  assert.equal(toeiRailwayId("西武新宿線"), null);
  assert.equal(toeiRailwayId("東京メトロ南北線"), null);
  assert.equal(toeiRailwayId("都営地下鉄浅草線・京急本線"), null, "a ride that runs off the Toei line is not looked up");
  assert.equal(toeiRailwayId(null), null);
  assert.equal(hasToeiRide([{ line: "JR山手線" }, { line: "都電荒川線" }]), true);
  assert.equal(hasToeiRide([{ line: "JR山手線" }]), false);
});

test("station names match through 駅, ヶ/ケ, spacing and macrons; else the one station within 300 m", () => {
  assert.equal(normaliseStationName("市ヶ谷駅"), normaliseStationName("市ケ谷"));
  assert.equal(normaliseStationName("Ryōgoku Station"), normaliseStationName("Ryogoku"));
  assert.equal(matchStation(railway, "市ヶ谷駅", point(5)), 5);
  assert.equal(matchStation(railway, "Ichigaya Station", undefined), 5);
  // Same name, but the map puts it kilometres away: another place.
  assert.equal(matchStation(railway, "甲駅", point(4)), null);
  // An unknown name next to a station of the line.
  assert.equal(matchStation(railway, "別名駅", { latitude: 35.7302, longitude: 139.7001 }), 3);
  assert.equal(matchStation(railway, "別名駅", { latitude: 35.735, longitude: 139.70 }), null, "half way between two stations is not sure");
});

test("the kind of day: weekday, Saturday, Sunday and public holiday, the New Year, and nothing outside the known years", () => {
  assert.equal(dayKind("2026-11-18"), "weekday");
  assert.equal(dayKind("2026-11-21"), "saturday");
  assert.equal(dayKind("2026-11-22"), "holiday");
  assert.equal(dayKind("2026-11-23"), "holiday", "勤労感謝の日");
  assert.equal(dayKind("2027-03-22"), "holiday", "振替休日");
  assert.equal(dayKind("2026-12-31"), "holiday");
  assert.equal(dayKind("2027-01-02"), "holiday");
  assert.equal(dayKind("2026-12-30"), null, "30 December is not sure");
  assert.equal(dayKind("2028-05-03"), null);
  assert.equal(dayKind("2026-02-30"), null);
  assert.equal(calendarFor(railway, "saturday"), "SaturdayHoliday");
  assert.equal(calendarFor(railway, "holiday"), "SaturdayHoliday");
  assert.equal(calendarFor({ ...railway, calendars: { Weekday: [[0, 0, 0, 600]], Saturday: [[0, 0, 0, 600]], Holiday: [[0, 0, 0, 600]] } }, "holiday"), "Holiday");
});

test("the next trains that stop at both ends, with when each gets in", () => {
  const answer = rideTimetable(data, ride(0, 3), WEDNESDAY, 600);
  assert.ok(answer && answer.kind === "trains");
  assert.equal(answer.calendar, "Weekday");
  assert.equal(answer.issued, "2025-03-17");
  // 10:05 ends at 丙 before 丁; the southbound 10:03 goes the other way.
  assert.deepEqual(answer.trains.map((train) => [clockOf(train.depart), train.arrive === null ? null : clockOf(train.arrive), train.destination.ja, train.type?.ja ?? null]), [
    ["10:00", "10:06", "戊", null],
    ["10:08", "10:13", "戊", "急行"],
    ["10:20", "10:26", "笹塚", null],
  ]);
});

test("an express that passes the alighting station is not offered; a train ending there is, with no arrival time", () => {
  const toOtsu = rideTimetable(data, ride(0, 1), WEDNESDAY, 606);
  assert.ok(toOtsu && toOtsu.kind === "trains");
  assert.deepEqual(toOtsu.trains.map((train) => clockOf(train.depart)), ["10:20", "00:10"], "the 10:08 express passes 乙");
  const toHei = rideTimetable(data, ride(0, 2), WEDNESDAY, 604);
  assert.ok(toHei && toHei.kind === "trains");
  assert.deepEqual(toHei.trains.map((train) => [clockOf(train.depart), train.arrive === null ? null : clockOf(train.arrive)]), [["10:05", "10:09"], ["10:08", "10:11"], ["10:20", "10:24"]]);
  // A train that ends at the station where the ride ends: the right train, arrival not published.
  const ending = rideTimetable({ ...data, railways: [{ ...railway, calendars: { Weekday: [[1, 1, 0, 605, 2]] } }] }, ride(0, 2), WEDNESDAY, 600);
  assert.ok(ending && ending.kind === "trains");
  assert.equal(ending.trains[0].arrive, null);
});

test("a through train is matched to the junction it calls at, with its time there left unknown", () => {
  const answer = rideTimetable(data, ride(3, 5), WEDNESDAY, 600);
  assert.ok(answer && answer.kind === "trains");
  assert.deepEqual(answer.trains.map((train) => [clockOf(train.depart), train.arrive, train.destination.ja]), [["10:26", null, "笹塚"]]);
});

test("the other way round a loop is not offered", () => {
  // 丁 → 乙 the short way is southbound; a northbound train that came back
  // round to 乙 would pass 戊 first, which the ride does not.
  const loop: ToeiRailway = { ...railway, patterns: [[3, 4, 0, 1]], calendars: { Weekday: [[0, 0, 0, 600, 2, 2, 2]] } };
  assert.equal(rideTimetable({ ...data, railways: [loop] }, ride(3, 1), WEDNESDAY, 590), null);
  const short: ToeiRailway = { ...railway, patterns: [[3, 2, 1]], calendars: { Weekday: [[0, 0, 0, 600, 2, 2]] } };
  assert.equal(rideTimetable({ ...data, railways: [short] }, ride(3, 1), WEDNESDAY, 590)?.kind, "trains");
});

test("after the last train it says so; after midnight belongs to the night before", () => {
  const late = rideTimetable(data, ride(0, 4), WEDNESDAY, serviceMinutes("23:50")!);
  assert.ok(late && late.kind === "trains");
  assert.equal(clockOf(late.trains[0].depart), "00:10");
  assert.equal(rideTimetable(data, ride(0, 4), WEDNESDAY, serviceMinutes("00:30")!)?.kind, "after-last");
  assert.equal(serviceMinutes("01:00"), 25 * 60);
  assert.equal(serviceMinutes("10:04"), 604);
});

test("no answer where nothing is sure: not a Toei line, unmatched stations, an unknown day, a ride no train makes", () => {
  assert.equal(rideTimetable(data, ride(0, 3, { line: "JR山手線" }), WEDNESDAY, 600), null);
  assert.equal(rideTimetable(data, ride(0, 3, { to: "どこか駅", path: [point(0), { latitude: 35.0, longitude: 139.0 }] }), WEDNESDAY, 600), null);
  assert.equal(rideTimetable(data, ride(0, 3), "2026-12-30", 600), null);
  assert.equal(rideTimetable(data, ride(0, 3), "2029-01-10", 600), null);
  const path = ride(0, 3).path;
  assert.equal(rideTimetable(data, ride(0, 3, { path: [...path.slice(0, 2), { latitude: 35.9, longitude: 139.9 }, ...path.slice(2)] }), WEDNESDAY, 600), null, "a ride passing somewhere off the line");
  assert.equal(rideTimetable(data, ride(5, 4), WEDNESDAY, 600), null, "no train in the timetable makes this ride");
  // The weekend timetable is used on a Saturday.
  assert.equal(rideTimetable(data, ride(0, 3), "2026-11-21", 600)?.calendar, "SaturdayHoliday");
});

test("a later ride is caught from when the train before it gets in, plus the change", () => {
  const second: ToeiRailway = { ...railway, id: "Mita", patterns: [[3, 4]], calendars: { Weekday: [[0, 0, 0, 609, 2], [0, 0, 0, 612, 2], [0, 0, 0, 614, 2]] } };
  const both = { ...data, railways: [railway, second] };
  const answers = legTimetables(both, {
    walkToMinutes: 5,
    transferMinutes: 4,
    rides: [ride(0, 3), { ...ride(3, 4), line: "都営地下鉄三田線" }],
  }, "09:55", WEDNESDAY);
  assert.ok(answers[0] && answers[0].kind === "trains");
  assert.equal(clockOf(answers[0].trains[0].depart), "10:00");
  // In at 10:06, four minutes to change: the 10:09 is too soon, the 10:12 is the one.
  assert.ok(answers[1] && answers[1].kind === "trains");
  assert.equal(clockOf(answers[1].trains[0].depart), "10:12");
  assert.deepEqual(legTimetables(both, { walkToMinutes: 0, transferMinutes: 0, rides: [ride(0, 3)] }, "not a time", WEDNESDAY), [null]);
});

const real = JSON.parse(readFileSync(new URL("../public/timetable/toei.json", import.meta.url), "utf8")) as ToeiTimetableData & { railways: ToeiRailway[] };
const tokyo = JSON.parse(readFileSync(new URL("../public/rail/tokyo.json", import.meta.url), "utf8")) as RailNetworkData;

test("the bundled timetable is small, credited and has every Toei line", () => {
  assert.ok(statSync(new URL("../public/timetable/toei.json", import.meta.url)).size < 2_000_000);
  assert.ok(isToeiTimetableData(real));
  assert.equal(real.licence, "CC BY 4.0");
  assert.equal(real.credit.ja, "東京都交通局・公共交通オープンデータ協議会");
  assert.equal(real.credit.en, "Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation");
  assert.deepEqual(real.railways.map((entry) => entry.id).sort(), ["Arakawa", "Asakusa", "Mita", "NipporiToneri", "Oedo", "Shinjuku"]);
  for (const entry of real.railways) {
    assert.match(entry.issued, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.calendars.Weekday.length > 100, `${entry.id} has a weekday timetable`);
  }
  assert.equal(isToeiTimetableData({ railways: "no" }), false);
});

test("every Toei station of the Tokyo map is found in the timetable by its name", () => {
  for (const [index, [ja, en]] of tokyo.lines.entries()) {
    const id = toeiRailwayId(ja) ?? toeiRailwayId(en);
    if (!id) continue;
    const entry = real.railways.find((candidate) => candidate.id === id)!;
    const on = new Set(tokyo.edges.filter((edge) => edge[2] === index).flatMap((edge) => [edge[0], edge[1]]));
    for (const station of on) {
      const [name, , latitude, longitude] = tokyo.stations[station];
      assert.notEqual(matchStation(entry, name, { latitude, longitude }), null, `${name} on ${ja}`);
    }
  }
});

test("real rides: round the Ōedo loop the short way, and on the Asakusa line to the junction at 泉岳寺", () => {
  const router = new RailNetwork(tokyo);
  const journey = (from: [number, number], to: [number, number], language: "ja" | "en" = "ja") => {
    const advice = router.advise({ latitude: from[0], longitude: from[1] }, { latitude: to[0], longitude: to[1] }, language);
    assert.equal(advice.kind, "rail");
    return (advice as Extract<typeof advice, { kind: "rail" }>).journey;
  };
  for (const language of ["ja", "en"] as const) {
    const oedo = journey([35.6628, 139.7314], [35.6968, 139.7934], language); // 六本木 → 両国
    assert.equal(toeiRailwayId(oedo.rides[0].line), "Oedo");
    const [answer] = legTimetables(real, oedo, "10:00", WEDNESDAY);
    assert.ok(answer && answer.kind === "trains", language);
    for (const train of answer.trains) {
      assert.ok(train.arrive !== null && train.arrive - train.depart < 40, "the short way round, not the whole loop");
    }
  }
  const asakusa = journey([35.7105, 139.7966], [35.6385, 139.7400]); // 浅草 → 泉岳寺
  const [answer] = legTimetables(real, asakusa, "10:00", WEDNESDAY);
  assert.ok(answer && answer.kind === "trains");
  assert.ok(answer.trains.some((train) => train.arrive === null && /羽田/.test(train.destination.ja)), "a train for 羽田 counts, its time at 泉岳寺 unpublished");
});

test("a same-named line in another city is not Toei", async () => {
  const { toeiRailwayId, hasToeiRide } = await import("../lib/shiori/timetable.ts");
  // Kobe Electric Railway's 三田線 (Sanda Line) shares the kanji with Toei's 三田線.
  assert.equal(toeiRailwayId("三田線"), null);
  assert.equal(hasToeiRide([{ line: "三田線" }, { line: "Sanda Line" }]), false);
  assert.equal(toeiRailwayId("都営地下鉄三田線"), "Mita");
  assert.equal(toeiRailwayId("Mita Line"), "Mita");
});
