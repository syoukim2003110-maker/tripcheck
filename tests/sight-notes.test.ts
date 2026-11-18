import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { HABITS, daySearch, daylightEnd, scheduleDay, type SearchProblem } from "../lib/shiori/day-search.ts";
import { isDaytime, isOpenEarly, placeHabit } from "../lib/shiori/habits.ts";
import { buildShioriPlan, habitOf } from "../lib/shiori/plan.ts";
import { isClosedSight, isExteriorSight, sightNote } from "../lib/shiori/sight-notes.ts";
import { decodeTrip, emptyTrip, encodeTrip, placeFromSight, sightStayMinutes, type ShioriTrip } from "../lib/shiori/state.ts";
import { EXTERIOR_STAY, namedParkStay, shioriStayMinutes } from "../lib/shiori/stay.ts";
import { buildNotes, notesText, snapStay, STAYS } from "../scripts/build-sight-notes.ts";

const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const shipped = readFileSync(new URL("../lib/shiori/sight-notes.json", import.meta.url), "utf8");

test("the sight notes in the repository are exactly what the two kept drafts and the web check give", () => {
  assert.equal(notesText(buildNotes()), shipped);
  const notes = JSON.parse(shipped) as Record<string, Record<string, unknown>>;
  // 2,225 of the 2,277 bundled sights have at least one value both drafts agree on.
  assert.equal(Object.keys(notes).length, 2225);
});

test("a stay is kept only when both drafts are within half again of each other, as their geometric mean on the list of stays", () => {
  assert.equal(snapStay(Math.sqrt(60 * 90)), 75);
  assert.equal(snapStay(Math.sqrt(15 * 15)), 15);
  assert.equal(snapStay(Math.sqrt(240 * 360)), 300);
  assert.equal(snapStay(Math.sqrt(120 * 180)), 150);
  const drafts = (pass: string) => new Map(readFileSync(new URL(`../scripts/sight-notes/drafts/pass-${pass}.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((line) => {
    const entry = JSON.parse(line) as { q: string; stay: number; hours: string; access: string; partOf: string | null };
    return [entry.q, entry] as const;
  }));
  const [a, b] = [drafts("A"), drafts("B")];
  const cityOf = new Map(cities.flatMap((city) => city.sights.map((sight) => [sight.q, city.id] as const)));
  for (const [q, note] of Object.entries(JSON.parse(shipped) as Record<string, { stay?: number; hours?: string; access?: string; partOf?: string }>)) {
    const [one, two] = [a.get(q)!, b.get(q)!];
    if (note.stay !== undefined) {
      assert.ok((STAYS as readonly number[]).includes(note.stay), q);
      assert.ok(Math.max(one.stay, two.stay) / Math.min(one.stay, two.stay) <= 1.5, q);
    }
    if (note.hours !== undefined) assert.ok(one.hours === note.hours && two.hours === note.hours, q);
    if (note.partOf !== undefined) {
      assert.ok(one.partOf === note.partOf && two.partOf === note.partOf && note.partOf !== q, q);
      assert.equal(cityOf.get(note.partOf), cityOf.get(q), q);
    }
    if (note.access === "booking" || note.access === "tour") assert.ok(one.access === note.access && two.access === note.access, q);
  }
});

test("what the web found decides the places the drafts call closed or private", () => {
  // Both drafts: closed; the web: closed (the inner market moved to Toyosu in 2018).
  assert.equal(sightNote("Q859471")?.access, "closed");
  assert.ok(isClosedSight("wikidata-Q859471"));
  // Burned in 1580; only a marker stone.
  assert.equal(sightNote("Q1098123")?.access, "gone");
  assert.ok(isClosedSight("Q1098123"));
  // Both drafts: private; the web: seen from outside only.
  assert.equal(sightNote("Q2379007")?.access, "exterior");
  assert.ok(isExteriorSight("wikidata-Q2379007") && !isClosedSight("wikidata-Q2379007"));
  // Both drafts: closed; the web: open again since 2025. No access note at all.
  assert.equal(sightNote("Q2420835")?.access, undefined);
  // Both drafts: private; the web: closed to visitors.
  assert.equal(sightNote("Q61053357")?.access, "closed");
  const counts: Record<string, number> = {};
  for (const note of Object.values(JSON.parse(shipped) as Record<string, { access?: string }>)) if (note.access) counts[note.access] = (counts[note.access] ?? 0) + 1;
  assert.deepEqual(counts, { booking: 49, closed: 12, gone: 18, exterior: 30, tour: 6 });
  // A place nobody made a note about, or not a bundled sight at all, has none.
  assert.equal(sightNote("osm-node-1"), null);
  assert.equal(sightNote(undefined), null);
  assert.equal(isClosedSight("wikidata-Q0"), false);
});

test("nothing in the notes reads as an hour of the day", () => {
  assert.equal(/\d{1,2}:\d{2}/.test(shipped), false);
  for (const note of Object.values(JSON.parse(shipped) as Record<string, Record<string, unknown>>)) {
    for (const key of Object.keys(note)) assert.ok(["stay", "hours", "access", "partOf"].includes(key), key);
    if (note.hours !== undefined) assert.ok(["morning", "early", "day", "evening", "any"].includes(note.hours as string));
  }
});

/* ------------------------------------------------------------------ stays */

const sight = (cityId: string, name: string) => cities.find((city) => city.id === cityId)!.sights.find((entry) => entry.ja === name)!;

test("a bundled sight is added with the usual stay of its note, before the rule by kind: the Louvre four hours, not ninety minutes like any museum", () => {
  assert.deepEqual([shioriStayMinutes("art museum", "ルーヴル美術館 Louvre Museum"), placeFromSight(sight("paris", "ルーヴル美術館"), "ja").stayMinutes], [90, 240]);
  assert.deepEqual([shioriStayMinutes("buddhist temple", "清水寺 Kiyomizu-dera"), placeFromSight(sight("kyoto", "清水寺"), "en").stayMinutes], [50, 90]);
  // Shorter too: a gate is a few minutes, not half an hour; an islet off Busan is seen from the shore, not a day trip of three hours.
  assert.equal(placeFromSight(sight("naha", "守礼門"), "ja").stayMinutes, 15);
  assert.deepEqual([shioriStayMinutes("island", "五六島"), placeFromSight(sight("busan", "五六島"), "ja").stayMinutes], [180, 30]);
  // Without a note the rule by kind is the stay, as it was.
  const plain = cities.flatMap((city) => city.sights).find((entry) => sightNote(entry.q)?.stay === undefined && sightNote(entry.q)?.access !== "exterior")!;
  assert.equal(sightStayMinutes(plain), shioriStayMinutes(plain.kind, `${plain.ja} ${plain.en}`));
});

test("a park named for the day it takes keeps that day whatever its note says: 日光江戸村 six hours, Disneyland eight", () => {
  assert.deepEqual([sightNote("Q11504885")?.stay, sightStayMinutes(sight("nikko", "日光江戸村"))], [240, 360]);
  assert.equal(sightStayMinutes(sight("tokyo", "東京ディズニーランド")), 480);
  for (const city of cities) {
    for (const entry of city.sights) {
      const named = namedParkStay(entry.kind, `${entry.ja} ${entry.en}`);
      if (named !== null) assert.equal(sightStayMinutes(entry), named, entry.ja);
    }
  }
});

test("a place seen from outside only is a short stop, at most half an hour, whatever else is said of it", () => {
  // 正倉院: the drafts said private, the web says fence and exterior only.
  assert.equal(sightStayMinutes(sight("nara", "正倉院")), 15);
  // イスタナ: no stay both drafts agree on; as a palace the rule by kind would plan 75 minutes.
  assert.deepEqual([shioriStayMinutes("palace", "x"), sightStayMinutes(sight("singapore", "イスタナ・シンガポール"))], [75, EXTERIOR_STAY]);
  for (const city of cities) for (const entry of city.sights) if (isExteriorSight(entry.q)) assert.ok(sightStayMinutes(entry) <= EXTERIOR_STAY, entry.ja);
});

test("of the 2,277 bundled sights 1,826 are added with another stay than the rule by kind gave, 613 longer and 1,213 shorter", () => {
  let changed = 0;
  let longer = 0;
  for (const city of cities) {
    for (const entry of city.sights) {
      const before = shioriStayMinutes(entry.kind, `${entry.ja} ${entry.en}`);
      const after = sightStayMinutes(entry);
      if (after !== before) changed += 1;
      if (after > before) longer += 1;
    }
  }
  assert.deepEqual([changed, longer], [1826, 613]);
});

/* ------------------------------------------------------------------ hours */

test("the part of the day a sight's note gives it is the planner's habit for it, before the rule by kind", () => {
  const habit = (cityId: string, name: string) => {
    const entry = sight(cityId, name);
    return [placeHabit(entry.kind, entry.ja), placeHabit(entry.kind, entry.ja, `wikidata-${entry.q}`)];
  };
  // early: a palace, a large zoo, a museum that takes a morning — of the first half of the day, a good place to open it.
  assert.deepEqual(habit("kyoto", "京都御所"), ["ticketed", "early"]);
  assert.deepEqual(habit("bangkok", "王宮"), ["ticketed", "early"]);
  assert.deepEqual(habit("sapporo", "札幌市円山動物園"), ["ticketed", "early"]);
  assert.deepEqual(habit("rome", "バチカン美術館"), ["ticketed", "early"]);
  // any: under the open sky at any hour.
  assert.deepEqual(habit("kyoto", "伏見稲荷大社"), ["daytime-open", "open"]);
  // evening: a mountain of night views, a night safari.
  assert.deepEqual(habit("sapporo", "藻岩山"), ["open", "evening"]);
  assert.deepEqual(habit("singapore", "ナイトサファリ"), ["evening", "evening"]);
  // day: in the daytime — with a door when the kind has one, reachable first thing when the kind is a shrine.
  assert.deepEqual(habit("tokyo", "東京国立博物館"), ["ticketed", "ticketed"]);
  assert.deepEqual(habit("tokyo", "明治神宮"), ["daytime-open", "daytime-open"]);
  assert.deepEqual(habit("tokyo", "東京タワー"), [null, "daytime"]);
  // A hotel, a shop or a station is not kept for the evening by a note either: only the place itself.
  const safari = sight("singapore", "ナイトサファリ");
  assert.equal(placeHabit(safari.kind, "ナイトサファリ駅", `wikidata-${safari.q}`), "ticketed");
  // A place with no note — not a bundled sight, or one the drafts did not agree on — keeps the rule by kind.
  assert.equal(placeHabit("royal palace", "どこかの宮殿", "osm-node-1"), "ticketed");
  assert.equal(habitOf({ id: "wikidata-Q1202239", kind: "royal palace", name: "京都御所" }), "early");
  // A restaurant chosen for a meal has its meal, not a habit, whatever its id.
  assert.equal(habitOf({ id: "wikidata-Q1202239", kind: "royal palace", name: "京都御所", meal: "lunch" }), null);
  // A place of the first half of the day is a daytime place that can open the day.
  assert.deepEqual([isDaytime("early"), isOpenEarly("early")], [true, true]);
});

test("a place of the first half of the day is better over by four, and goes first when that costs no more on the way: the palace before the temple", () => {
  const stop = (hours: Partial<SearchProblem["stops"][number]>) => ({ stay: 180, meal: null, day: null, ...hours });
  const line = (stops: SearchProblem["stops"]): SearchProblem => ({ stops, minutes: [[0, 10], [10, 0]], km: [[0, 1], [1, 0]], hotel: null });
  // Two visits of three hours and a lunch hour: whichever is second is over at 16:20. The temple there costs
  // nothing; the palace, twenty minutes past four, twenty: the palace goes first.
  const palace = stop({ daytime: true, early: true, firstHalf: true });
  const temple = stop({ daytime: true });
  assert.deepEqual(daySearch(line([temple, palace])).choose(1).days[0].order, [1, 0]);
  assert.deepEqual(daySearch(line([palace, temple])).choose(1).days[0].order, [0, 1]);
  assert.equal(daySearch(line([temple, palace])).choose(1).days[0].leave.at(-1), 16 * 60 + 20);
  assert.equal(HABITS.firstHalfEnd, 16 * 60);
  // The later start of a day that waits for its evening does not carry it past four either.
  assert.equal(daylightEnd(palace), 16 * 60);
  assert.equal(daylightEnd(temple), 17 * 60);
  assert.equal(daylightEnd(stop({})), false);
  assert.equal(scheduleDay([50, 75], [null, "dinner"], [10], null, undefined, [daylightEnd(palace), false]).leave[0], 16 * 60);
  assert.equal(scheduleDay([50, 75], [null, "dinner"], [10], null, undefined, [daylightEnd(temple), false]).leave[0], 17 * 60);
});

/* ------------------------------------------------------------------ closed */

test("a place closed for good or gone is not offered among a city's sights, and a trip that already has it still opens and plans it", () => {
  const tokyo = cities.find((city) => city.id === "tokyo")!;
  assert.ok(tokyo.sights.some((entry) => entry.ja === "築地市場"));
  assert.equal(curateSights(tokyo.sights).some((entry) => entry.ja === "築地市場"), false);
  let closed = 0;
  for (const city of cities) {
    closed += city.sights.filter((entry) => isClosedSight(entry.q)).length;
    assert.deepEqual(curateSights(city.sights).filter((entry) => isClosedSight(entry.q)), [], city.id);
  }
  assert.equal(closed, 30);
  // Seen from outside only is still offered: a short stop, not a closed door (正倉院, behind its fence).
  assert.ok(curateSights(cities.find((city) => city.id === "nara")!.sights).some((entry) => entry.ja === "正倉院"));
  // Reopened, by the web check: offered again.
  assert.ok(curateSights(cities.find((city) => city.id === "sapporo")!.sights).some((entry) => entry.q === "Q2420835"));
  // A saved or shared trip that has the market keeps it, and the booklet plans it as before.
  const market = placeFromSight(sight("tokyo", "築地市場"), "ja");
  const trip: ShioriTrip = { ...emptyTrip, cityId: "tokyo", cityName: "東京", days: 1, places: [market, placeFromSight(sight("tokyo", "東京タワー"), "ja")] };
  const opened = decodeTrip(encodeTrip(trip))!;
  assert.deepEqual(opened.places.map((place) => place.name), ["築地市場", "東京タワー"]);
  const plan = buildShioriPlan({ places: opened.places, days: 1, hotel: null, locale: "ja" }, { cities: cities.map((city) => ({ ...city, sights: curateSights(city.sights) })) });
  assert.deepEqual(plan.days[0].stops.map((stop) => stop.place.name).sort(), ["東京タワー", "築地市場"]);
  assert.deepEqual(plan.leftOut, []);
  // Nor is it suggested back as an idea for a free day.
  const free = buildShioriPlan({ places: [placeFromSight(sight("tokyo", "東京タワー"), "ja")], days: 3, hotel: null, locale: "ja" }, { cities: cities.map((city) => ({ ...city, sights: curateSights(city.sights) })) });
  assert.ok(free.freeDayIdeas.length > 0);
  assert.equal(free.freeDayIdeas.some((idea) => isClosedSight(idea.q)), false);
});
