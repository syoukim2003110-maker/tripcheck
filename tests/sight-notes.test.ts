import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { HABITS, daySearch, daylightEnd, scheduleDay, type SearchProblem } from "../lib/shiori/day-search.ts";
import { isDaytime, isOpenEarly, placeHabit } from "../lib/shiori/habits.ts";
import { SMALL_PART_KM, buildShioriPlan, foldedParts, habitOf } from "../lib/shiori/plan.ts";
import { isClosedSight, isExteriorSight, sightNote } from "../lib/shiori/sight-notes.ts";
import { decodeTrip, emptyTrip, encodeTrip, placeFromSight, sightStayMinutes, type ShioriTrip } from "../lib/shiori/state.ts";
import { EXTERIOR_STAY, namedParkStay, shioriStayMinutes } from "../lib/shiori/stay.ts";
import { OVERRIDES, buildNotes, notesText, snapStay, STAYS } from "../scripts/build-sight-notes.ts";

const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const shipped = readFileSync(new URL("../lib/shiori/sight-notes.json", import.meta.url), "utf8");

test("the sight notes in the repository are exactly what the two kept drafts and the web check give", () => {
  assert.equal(notesText(buildNotes()), shipped);
  const notes = JSON.parse(shipped) as Record<string, Record<string, unknown>>;
  // 2,223 of the 2,277 bundled sights have at least one value both drafts agree on and no reviewer struck out.
  assert.equal(Object.keys(notes).length, 2223);
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
    // (A reviewer's correction, with its reason, is the build script's OVERRIDES: see below.)
    if (note.partOf !== undefined && OVERRIDES[q]?.set.partOf === undefined) {
      assert.ok(one.partOf === note.partOf && two.partOf === note.partOf && note.partOf !== q, q);
      assert.equal(cityOf.get(note.partOf), cityOf.get(q), q);
    }
    if (note.access === "booking" || note.access === "tour") assert.ok(one.access === note.access && two.access === note.access, q);
  }
});

test("what the web found decides the places the drafts call closed or private", () => {
  // Both drafts: closed; the web: closed (ended operations in 2024).
  assert.equal(sightNote("Q105438533")?.access, "closed");
  assert.ok(isClosedSight("wikidata-Q105438533"));
  // Both drafts and the web: closed — but only the inner market moved to Toyosu; the outer market still trades,
  // and a reviewer struck the note out: 築地市場 is offered, a place of the morning.
  assert.deepEqual([isClosedSight("wikidata-Q859471"), sightNote("Q859471")?.hours], [false, "morning"]);
  assert.ok(OVERRIDES.Q859471.why.includes("場外市場"));
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
  assert.deepEqual(counts, { booking: 49, closed: 11, gone: 18, exterior: 30, tour: 6 });
  // A place nobody made a note about, or not a bundled sight at all, has none.
  assert.equal(sightNote("osm-node-1"), null);
  assert.equal(sightNote(undefined), null);
  assert.equal(isClosedSight("wikidata-Q0"), false);
});

test("every closed, gone or outside-only verdict cites a page, and the ones not fetched at the time say they are from memory: 32 fetched, 29 from memory", () => {
  const items = (JSON.parse(readFileSync(new URL("../scripts/sight-notes/web-check.json", import.meta.url), "utf8")) as { items: Array<{ q: string; evidence: string }> }).items;
  for (const item of items) assert.match(item.evidence, /https?:\/\//, item.q);
  const fromMemory = items.filter((item) => /from memory/i.test(item.evidence)).length;
  assert.deepEqual([items.length - fromMemory, fromMemory], [32, 29]);
  // What the code and the guide say of them is no more than that.
  for (const file of ["../scripts/build-sight-notes.ts", "../lib/shiori/sight-notes.ts", "../lib/popular-sights.ts", "../AGENTS.md"]) {
    assert.equal(/checked on the web/.test(readFileSync(new URL(file, import.meta.url), "utf8")), false, file);
  }
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

test("the part of the day a sight's note gives it is the planner's habit for it, before the rule by kind — except that a tower, a theme park or a mall is not kept to the daytime by it", () => {
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
  // …but a tower, a theme park or a shopping centre keeps no habit by a note of the daytime: it may close the day, for its night view or its evening.
  assert.deepEqual(habit("tokyo", "東京タワー"), [null, null]);
  assert.deepEqual(habit("tokyo", "東京スカイツリー"), [null, null]);
  assert.deepEqual(habit("tokyo", "東京ディズニーランド"), [null, null]);
  assert.deepEqual(habit("dubai", "ドバイ・モール"), [null, null]);
  assert.equal(sightNote(sight("tokyo", "東京タワー").q)?.hours, "day");
  // A note of the first half of the day still keeps one there.
  assert.equal(placeHabit("observation tower", "x", "wikidata-Q1202239"), "early");
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
  const yokohama = cities.find((city) => city.id === "yokohama")!;
  const factory = yokohama.sights.find((entry) => entry.q === "Q105438533")!;
  assert.equal(curateSights(yokohama.sights).some((entry) => entry.q === factory.q), false);
  // 築地市場's outer market still trades: offered among Tokyo's sights.
  assert.ok(curateSights(cities.find((city) => city.id === "tokyo")!.sights).some((entry) => entry.ja === "築地市場"));
  let closed = 0;
  for (const city of cities) {
    closed += city.sights.filter((entry) => isClosedSight(entry.q)).length;
    assert.deepEqual(curateSights(city.sights).filter((entry) => isClosedSight(entry.q)), [], city.id);
  }
  assert.equal(closed, 29);
  // Seen from outside only is still offered: a short stop, not a closed door (正倉院, behind its fence).
  assert.ok(curateSights(cities.find((city) => city.id === "nara")!.sights).some((entry) => entry.ja === "正倉院"));
  // Reopened, by the web check: offered again.
  assert.ok(curateSights(cities.find((city) => city.id === "sapporo")!.sights).some((entry) => entry.q === "Q2420835"));
  // A saved or shared trip that has the closed place keeps it, and the booklet plans it as before.
  const closedPlace = placeFromSight(factory, "ja");
  const park = placeFromSight(sight("yokohama", "山下公園"), "ja");
  const trip: ShioriTrip = { ...emptyTrip, cityId: "yokohama", cityName: "横浜", days: 1, places: [closedPlace, park] };
  const opened = decodeTrip(encodeTrip(trip))!;
  assert.deepEqual(opened.places.map((place) => place.name), [closedPlace.name, "山下公園"]);
  const plan = buildShioriPlan({ places: opened.places, days: 1, hotel: null, locale: "ja" }, { cities: cities.map((city) => ({ ...city, sights: curateSights(city.sights) })) });
  assert.deepEqual(plan.days[0].stops.map((stop) => stop.place.name).sort(), [closedPlace.name, "山下公園"].sort());
  assert.deepEqual(plan.leftOut, []);
  // Nor is it suggested back as an idea for a free day.
  const free = buildShioriPlan({ places: [placeFromSight(sight("tokyo", "東京タワー"), "ja")], days: 3, hotel: null, locale: "ja" }, { cities: cities.map((city) => ({ ...city, sights: curateSights(city.sights) })) });
  assert.ok(free.freeDayIdeas.length > 0);
  assert.equal(free.freeDayIdeas.some((idea) => isClosedSight(idea.q)), false);
});

/* ------------------------------------------------------------------ part of another place */

const nikko = (name: string) => placeFromSight(sight("nikko", name), "ja");
const allNames = (plan: ReturnType<typeof buildShioriPlan>) => plan.days.flatMap((day) => day.stops.flatMap((stop) => [stop.place.name, ...(stop.within ?? []).map((place) => place.name)]));

test("a small part of another place on the list is seen during that place's visit: 眠り猫 on the card of 日光東照宮, one stop, no leg between them, nothing added to the stay", () => {
  const shrine = nikko("日光東照宮");
  const cat = nikko("眠り猫");
  const temple = nikko("輪王寺");
  assert.deepEqual([shrine.stayMinutes, cat.stayMinutes], [120, 15]);
  assert.deepEqual([...foldedParts([cat, temple, shrine])], [[cat.id, shrine.id]]);
  const plan = buildShioriPlan({ places: [cat, temple, shrine], days: 1, hotel: null, locale: "ja" }, { cities });
  const stops = plan.days[0].stops;
  assert.equal(stops.length, 2);
  assert.equal(plan.days[0].legs.length, 1);
  const visit = stops.find((stop) => stop.place.id === shrine.id)!;
  assert.deepEqual(visit.within?.map((place) => place.name), ["眠り猫"]);
  assert.equal(visit.stayMinutes, 120);
  assert.equal(stops.some((stop) => stop.place.id === cat.id), false);
  assert.deepEqual([allNames(plan).sort(), plan.leftOut], [["日光東照宮", "眠り猫", "輪王寺"].sort(), []]);
  // A stop with nothing inside it says nothing of the kind.
  assert.equal(stops.find((stop) => stop.place.id === temple.id)!.within, undefined);
  // Without the shrine on the list the carving is a stop of its own.
  assert.deepEqual(buildShioriPlan({ places: [cat, temple], days: 1, hotel: null, locale: "ja" }, { cities }).days[0].stops.map((stop) => stop.place.name).sort(), ["眠り猫", "輪王寺"].sort());
  // The same in Okinawa and Hiroshima: the gate of the castle, the statue in the park.
  const naha = cities.find((city) => city.id === "naha")!;
  const gate = placeFromSight(naha.sights.find((entry) => entry.ja === "守礼門")!, "ja");
  const castle = placeFromSight(naha.sights.find((entry) => entry.ja === "首里城")!, "ja");
  assert.deepEqual([...foldedParts([gate, castle])], [[gate.id, castle.id]]);
  const statue = placeFromSight(sight("hiroshima", "原爆の子の像"), "ja");
  const park = placeFromSight(sight("hiroshima", "平和記念公園"), "ja");
  assert.deepEqual([...foldedParts([park, statue])], [[statue.id, park.id]]);
});

test("a place a note wrongly calls part of another, kilometres away, is a stop of its own: no card says it is seen where the traveller never goes", () => {
  const kanazawa = (name: string) => placeFromSight(sight("kanazawa", name), "ja");
  const group = kanazawa("卯辰山山麓寺院群");
  const [far, farther] = [kanazawa("本光寺"), kanazawa("本興寺")];
  // Both drafts called them temples of the group at the foot of 卯辰山; they stand 3.4 and 4.7 km from it. Struck out, with the reason.
  assert.deepEqual([sightNote(far.id)?.partOf, sightNote(farther.id)?.partOf], [undefined, undefined]);
  assert.ok(OVERRIDES.Q29408050.why.length > 0 && OVERRIDES.Q30926295.why.length > 0);
  const plan = buildShioriPlan({ places: [group, farther, far, kanazawa("兼六園")], days: 1, hotel: null, locale: "ja" }, { cities });
  assert.equal(plan.days.some((day) => day.stops.some((stop) => stop.within)), false);
  const stops = plan.days.flatMap((day) => day.stops.map((stop) => stop.place.name));
  for (const name of ["本興寺", "本光寺"]) assert.ok(stops.includes(name) || plan.leftOut.includes(name), name);
  // Whatever a note says, a part is seen during a place's visit only when it is near: a temple two kilometres off is a stop.
  const shrine = nikko("日光東照宮");
  const cat = nikko("眠り猫");
  assert.equal(foldedParts([shrine, cat]).size, 1);
  assert.equal(foldedParts([shrine, { ...cat, lat: shrine.lat + (SMALL_PART_KM + 0.2) / 111 }]).size, 0);
  // Every small part a note gives is within that distance of its place — a statue across Stanley Park, a funicular up Tibidabo.
  const byQ = new Map(cities.flatMap((city) => city.sights.map((entry) => [entry.q, entry] as const)));
  for (const [q, note] of Object.entries(JSON.parse(shipped) as Record<string, { partOf?: string; stay?: number }>)) {
    if (!note.partOf || (note.stay ?? 99) > 30) continue;
    const [part, main] = [byQ.get(q)!, byQ.get(note.partOf)!];
    assert.equal(foldedParts([placeFromSight(main, "ja"), placeFromSight(part, "ja")]).size, 1, part.ja);
  }
});

test("a large part of another place is a stop of its own: 東大寺 in 奈良公園, 上野動物園 in 上野公園", () => {
  const nara = [placeFromSight(sight("nara", "奈良公園"), "ja"), placeFromSight(sight("nara", "東大寺"), "ja")];
  assert.equal(foldedParts(nara).size, 0);
  assert.deepEqual(buildShioriPlan({ places: nara, days: 1, hotel: null, locale: "ja" }, { cities }).days[0].stops.length, 2);
  assert.equal(foldedParts([placeFromSight(sight("tokyo", "上野公園"), "ja"), placeFromSight(sight("tokyo", "上野動物園"), "ja")]).size, 0);
});

test("a listing seen through its parts is not hours more on top of them: 日光の社寺 on the card of 日光東照宮, 大阪城公園 on 大阪城's, and nikko's day is over by four with 華厳滝 in it", () => {
  // The drafts disagreed on which way round these lie; the build script's overrides say, each with its reason.
  assert.deepEqual(["日光東照宮", "輪王寺", "日光二荒山神社"].map((name) => sightNote(sight("nikko", name).q)?.partOf), ["Q1063133", "Q1063133", "Q1063133"]);
  assert.equal(sightNote(sight("osaka", "大阪城").q)?.partOf, sight("osaka", "大阪城公園").q);
  const [listing, shrine, temple] = [nikko("日光の社寺"), nikko("日光東照宮"), nikko("輪王寺")];
  assert.deepEqual([listing.stayMinutes, shrine.stayMinutes, temple.stayMinutes], [180, 120, 60]);
  assert.deepEqual([...foldedParts([temple, listing, shrine])], [[listing.id, shrine.id]]);
  const plan = buildShioriPlan({ places: [nikko("華厳滝"), temple, listing, shrine], days: 1, hotel: null, locale: "ja" }, { cities });
  const stops = plan.days[0].stops;
  assert.deepEqual(stops.map((stop) => [stop.place.name, stop.within?.map((place) => place.name)]).filter(([, within]) => within), [["日光東照宮", ["日光の社寺"]]]);
  // Nothing is added for it: the shrine is its own two hours.
  assert.equal(stops.find((stop) => stop.place.name === "日光東照宮")!.stayMinutes, 120);
  assert.deepEqual([plan.leftOut, plan.days[0].runsLate], [[], false]);
  assert.ok(plan.days[0].stops.at(-1)!.leave <= "16:00", plan.days[0].stops.at(-1)!.leave);
  // Its parts on the list taking less than its time, the listing is the stop — and 輪王寺, an hour of its three, is seen in it.
  assert.deepEqual([...foldedParts([listing, temple])], [[temple.id, listing.id]]);
  // The park around the castle: the castle takes all of the park's time.
  const osaka = (name: string) => placeFromSight(sight("osaka", name), "ja");
  assert.deepEqual([...foldedParts([osaka("大阪城公園"), osaka("大阪城")])], [[osaka("大阪城公園").id, osaka("大阪城").id]]);
});

test("a part that takes at most half its place's time is seen during the visit: エメラルド仏 in 王宮, one stop of 150 minutes, not 225; a part as long as its park is a stop of its own", () => {
  const bangkok = (name: string) => placeFromSight(sight("bangkok", name), "ja");
  const [palace, buddha] = [bangkok("王宮"), bangkok("エメラルド仏")];
  assert.deepEqual([palace.stayMinutes, buddha.stayMinutes], [150, 75]);
  const plan = buildShioriPlan({ places: [buddha, palace], days: 1, hotel: null, locale: "ja" }, { cities });
  assert.deepEqual(plan.days[0].stops.map((stop) => [stop.place.name, stop.stayMinutes, stop.within?.map((place) => place.name)]), [["王宮", 150, ["エメラルド仏"]]]);
  // Given a longer stay than its note's, booked, or on another day: a stop of its own.
  assert.equal(foldedParts([palace, { ...buddha, reserve: { day: 1, time: "10:00" } }]).size, 0);
  assert.equal(foldedParts([palace, { ...buddha, day: 2 }]).size, 0);
  const kyoto = (name: string) => placeFromSight(sight("kyoto", name), "ja");
  assert.deepEqual([...foldedParts([kyoto("嵐山"), kyoto("天龍寺")])], [[kyoto("天龍寺").id, kyoto("嵐山").id]]);
  assert.equal(foldedParts([kyoto("嵐山"), { ...kyoto("天龍寺"), stayMinutes: 75 }]).size, 0);
  // More than half — 東大寺, ninety minutes of 奈良公園's hundred and twenty — is a stop of its own (see below).
  assert.equal(foldedParts([placeFromSight(sight("nara", "奈良公園"), "ja"), placeFromSight(sight("nara", "東大寺"), "ja")]).size, 0);
  // A part whose place's point is farther than SMALL_PART_KM — the middle of 厳島, 2.5 km from 厳島神社 by the pier — is a stop of its own.
  const hiroshima = (name: string) => placeFromSight(sight("hiroshima", name), "ja");
  assert.equal(sightNote(hiroshima("厳島神社").id)?.partOf, sight("hiroshima", "厳島").q);
  assert.equal(foldedParts([hiroshima("厳島"), hiroshima("厳島神社")]).size, 0);
});

test("a part the traveller booked, chose as a meal, lengthened or put on another day than its place is a stop of its own", () => {
  const shrine = nikko("日光東照宮");
  const cat = nikko("眠り猫");
  assert.equal(foldedParts([shrine, { ...cat, stayMinutes: 45 }]).size, 0);
  assert.equal(foldedParts([shrine, { ...cat, day: 2 }]).size, 0);
  assert.equal(foldedParts([{ ...shrine, day: 2 }, { ...cat, day: 2 }]).size, 1);
  assert.equal(foldedParts([shrine, { ...cat, reserve: { day: 1, time: "10:00" } }]).size, 0);
  assert.equal(foldedParts([shrine, { ...cat, meal: "lunch" }]).size, 0);
  assert.equal(foldedParts([{ ...shrine, meal: "lunch" }, cat]).size, 0);
});

test("a part of a part is seen at the outermost place on the list; a place is never lost, even when its place is left out", () => {
  const taipei = (name: string) => placeFromSight(sight("taipei", name), "ja");
  const theatre = taipei("国家戯劇院");
  const centre = taipei("国立中正文化中心");
  const hall = taipei("中正紀念堂");
  assert.deepEqual(new Map(foldedParts([theatre, centre, hall])), new Map([[theatre.id, hall.id], [centre.id, hall.id]]));
  assert.deepEqual(new Map(foldedParts([theatre, centre])), new Map([[theatre.id, centre.id]]));
  const plan = buildShioriPlan({ places: [theatre, centre, hall], days: 1, hotel: null, locale: "ja" }, { cities });
  assert.deepEqual(plan.days[0].stops.map((stop) => [stop.place.name, stop.within?.map((place) => place.name)]), [["中正紀念堂", ["国家戯劇院", "国立中正文化中心"]]]);
  // The shrine booked on a day the trip does not have is left out, and the carving seen inside it with it.
  const shrine = { ...nikko("日光東照宮"), reserve: { day: 3, time: "10:00" } };
  const left = buildShioriPlan({ places: [nikko("眠り猫"), shrine, nikko("輪王寺")], days: 1, hotel: null, locale: "ja" }, { cities });
  assert.deepEqual([allNames(left), [...left.leftOut].sort()], [["輪王寺"], ["日光東照宮", "眠り猫"].sort()]);
  // A place whose own stay is shorter than its part's is visited for as long as the part takes.
  const short = buildShioriPlan({ places: [{ ...nikko("日光東照宮"), stayMinutes: 15 }, { ...nikko("眠り猫"), stayMinutes: 30 }], days: 1, hotel: null, locale: "ja" }, { cities });
  assert.deepEqual([short.days[0].stops.length, short.days[0].stops[0].stayMinutes, short.days[0].stops[0].place.stayMinutes], [1, 30, 15]);
});

test("a trip with a part folded into its place survives the share link, and the part is not suggested back as an idea", () => {
  const trip: ShioriTrip = { ...emptyTrip, cityId: "nikko", cityName: "日光", days: 3, places: [nikko("眠り猫"), nikko("日光東照宮")] };
  const opened = decodeTrip(encodeTrip(trip))!;
  assert.deepEqual(opened.places.map((place) => place.id), trip.places.map((place) => place.id));
  const plan = buildShioriPlan({ places: opened.places, days: 3, hotel: null, locale: "ja" }, { cities: cities.map((city) => ({ ...city, sights: curateSights(city.sights) })) });
  assert.deepEqual(plan.days.map((day) => day.stops.map((stop) => [stop.place.name, stop.within?.map((place) => place.name)])), [[["日光東照宮", ["眠り猫"]]]]);
  const ideas = [...plan.freeDayIdeas, ...plan.days.flatMap((day) => [...day.ideas, ...day.rainIdeas])];
  assert.ok(plan.freeDayIdeas.length > 0);
  assert.equal(ideas.some((idea) => idea.ja === "眠り猫" || idea.ja === "日光東照宮"), false);
});

test("a place seen from outside only says so on its card: バチカン宮殿's fifteen minutes are a look from outside, not a rushed visit", () => {
  const rome = (name: string) => placeFromSight(sight("rome", name), "ja");
  const plan = buildShioriPlan({ places: [rome("サン・ピエトロ大聖堂"), rome("バチカン宮殿")], days: 1, hotel: null, locale: "ja" }, { cities });
  const stops = plan.days[0].stops;
  assert.deepEqual(stops.map((stop) => [stop.place.name, stop.stayMinutes, stop.exterior]).sort(), [["サン・ピエトロ大聖堂", 75, undefined], ["バチカン宮殿", 15, true]].sort());
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  const lines = source.match(/^ {4}exterior: .*$/gm) ?? [];
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(/営業|開店|閉店|開く|閉ま|\bopens?\b|\bcloses?\b|\d{1,2}:\d{2}|\d時/i.test(line), false, line);
  assert.equal(source.match(/stop\.exterior \? <small className="shiori-within">\{t\.exterior\}/g)?.length, 1);
});

test("the card of a stop names what is seen within it, in both languages, and says nothing about hours", () => {
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  const lines = source.match(/^ {4}within: .*$/gm) ?? [];
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(/営業|開店|閉店|開く|閉ま|\bopens?\b|\bcloses?\b|\d{1,2}:\d{2}|\d時/i.test(line), false, line);
  assert.equal(source.match(/stop\.within \? <small className="shiori-within">\{t\.within\(/g)?.length, 1);
});
