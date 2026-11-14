import assert from "node:assert/strict";
import test from "node:test";

import { openCandidate, openLookupHit, placeOfCandidate, putPlace, type AddCandidate } from "../lib/shiori/add-search.ts";
import { emptyTrip, MAX_PLACES } from "../lib/shiori/state.ts";
import {
  BulkBudgetError, bulkAfterTripChange, bulkLeftover, bulkProgress, bulkSummary, bundledMatches, chooseBulk, confirmBulk, mergeBulk, parseBulkText, requeueBulk, resolveBulk, sameName, settleLine, startBulk, tripChange,
  type BulkLine,
} from "../lib/shiori/bulk-add.ts";

const candidate = (name: string, id = `apple-${name}`, category: string | null = null): AddCandidate => ({ id, name, lat: 35.7, lon: 139.8, address: `${name}の住所`, category, km: 2 });
const SIGHTS = [
  { q: "Q1", ja: "浅草寺", en: "Sensō-ji", lat: 35.7148, lon: 139.7967, kind: "temple" },
  { q: "Q2", ja: "東京タワー", en: "Tokyo Tower", lat: 35.6586, lon: 139.7454, kind: "tower" },
];
const local = (name: string) => bundledMatches(name, SIGHTS, "ja", { latitude: 35.68, longitude: 139.76 });
const run = (search: (name: string) => Promise<AddCandidate[] | null>, extra: Partial<Parameters<typeof resolveBulk>[1]> = {}) => ({
  local, search, takenIds: new Set<string>(), isCurrent: () => true, onChange: () => {}, ...extra,
});

test("a pasted list is one name per line, without bullets, blanks or exact repeats", () => {
  assert.deepEqual(
    parseBulkText("1. 浅草寺\r\n ・東京タワー\n\n- もんじゃ 月島\n(4) 上野公園\n③ 築地\n　□ 銀座　\n浅草寺\n* [x] 渋谷"),
    ["浅草寺", "東京タワー", "もんじゃ 月島", "上野公園", "築地", "銀座", "[x] 渋谷"],
  );
});

test("a line is never split on commas, and numbers that are part of a name stay", () => {
  assert.deepEqual(parseBulkText("すし、天ぷら 銀座,本店\n21世紀美術館\n3.11メモリアル\n109\n2. 109\n-"), ["すし、天ぷら 銀座,本店", "21世紀美術館", "3.11メモリアル", "109", "-"]);
  assert.deepEqual(parseBulkText("  \n\n"), []);
});

test("only as many lines as the trip has room for are taken, and the rest are handed back", () => {
  const { lines, leftOut } = startBulk("A寺\nB寺\nC寺\nD寺", 2, []);
  assert.deepEqual(lines.map((line) => line.text), ["A寺", "B寺"]);
  assert.deepEqual(leftOut, ["C寺", "D寺"]);
  assert.deepEqual(startBulk("A寺", 0, []).leftOut, ["A寺"]);
});

test("a line already in the trip is marked so, costs no room and no request", async () => {
  const { lines, leftOut } = startBulk("東京タワー\nA寺\nB寺", 1, [{ id: "wikidata-Q2", name: "東京 タワー" }]);
  assert.deepEqual(lines.map((line) => line.status), ["already", "waiting"]);
  assert.deepEqual(leftOut, ["B寺"]);
  const asked: string[] = [];
  await resolveBulk(lines, run(async (name) => { asked.push(name); return []; }));
  assert.deepEqual(asked, ["A寺"]);
});

test("the same name is certain; a longer or shorter one is not", () => {
  assert.equal(sameName("Senso-ji", "SENSO JI"), true);
  assert.equal(sameName("靖國神社", "靖国神社"), true);
  assert.equal(sameName("東京タワー", "東京タワー水族館"), false);
  assert.equal(sameName("とらや", "とらや 本店"), false);
});

test("a bundled sight is found by its name in either language without a request", async () => {
  let asked = 0;
  const { lines } = startBulk("浅草寺\ntokyo tower", 24, []);
  const outcome = await resolveBulk(lines, run(async () => { asked += 1; return []; }));
  assert.equal(asked, 0);
  assert.deepEqual(outcome?.lines.map((line) => [line.status, line.chosen]), [["found", "wikidata-Q1"], ["found", "wikidata-Q2"]]);
  assert.equal(outcome?.stopped, null);
});

test("one result bearing the very name is found; several, or another name, is left to choose; none is missing", async () => {
  const answers: Record<string, AddCandidate[]> = {
    "根津美術館": [candidate("根津美術館"), candidate("根津美術館前", "apple-stop")],
    "もんじゃ 月島": [candidate("月島もんじゃ もへじ"), candidate("もんじゃ 蔵")],
    "スターバックス": [candidate("スターバックス", "apple-a"), candidate("スターバックス", "apple-b")],
    "ないところ": [],
  };
  const { lines } = startBulk(Object.keys(answers).join("\n"), 24, []);
  const outcome = await resolveBulk(lines, run(async (name) => answers[name]));
  assert.deepEqual(outcome?.lines.map((line) => [line.status, line.chosen, line.candidates.length]), [
    ["found", "apple-根津美術館", 1], ["choose", null, 2], ["choose", null, 2], ["missing", null, 0],
  ]);
  // Nothing is chosen for the traveller: only the certain line is going to be added.
  const summary = bulkSummary(outcome!.lines);
  assert.deepEqual([summary.confirmed.length, summary.held.length], [1, 3]);
});

test("a bus stop or car park named exactly like the sight is not a certain match", () => {
  const line = startBulk("清水寺", 24, []).lines[0];
  assert.equal(settleLine(line, [candidate("清水寺", "apple-stop", "PublicTransport")], new Set(), new Set()).status, "choose");
  assert.equal(settleLine(line, [candidate("清水寺", "apple-stop", "PublicTransport"), candidate("清水寺", "apple-temple", "ReligiousSite")], new Set(), new Set()).chosen, "apple-temple");
});

test("a certain match that is already in the trip, or is the place of a line above, is not added twice", async () => {
  const { lines } = startBulk("浅草寺\nSensō-ji\n東京タワー", 24, []);
  const outcome = await resolveBulk(lines, run(async () => [], { takenIds: new Set(["wikidata-Q2"]) }));
  assert.deepEqual(outcome?.lines.map((line) => line.status), ["found", "repeat", "already"]);
});

test("lines are asked one at a time, in order, and the screen hears of every step", async () => {
  let open = 0;
  const steps: string[] = [];
  const { lines } = startBulk("A寺\nB寺\nC寺", 24, []);
  await resolveBulk(lines, run(async (name) => {
    open += 1;
    assert.equal(open, 1);
    await new Promise((resolve) => setTimeout(resolve, 1));
    open -= 1;
    return [candidate(name)];
  }, { onChange: (next) => { const at = bulkProgress(next); steps.push(`${at.done}/${at.total}`); } }));
  assert.deepEqual(steps, ["0/3", "1/3", "1/3", "2/3", "2/3", "3/3"]);
});

test("a run that was overtaken changes nothing more and asks nothing more", async () => {
  let current = true;
  const asked: string[] = [];
  const seen: BulkLine[][] = [];
  const { lines } = startBulk("A寺\nB寺\nC寺", 24, []);
  const outcome = await resolveBulk(lines, run(async (name) => {
    asked.push(name);
    if (name === "B寺") current = false;
    return [candidate(name)];
  }, { isCurrent: () => current, onChange: (next) => seen.push(next) }));
  assert.equal(outcome, null);
  assert.deepEqual(asked, ["A寺", "B寺"]);
  assert.deepEqual(seen.at(-1)?.map((line) => line.status), ["found", "checking", "waiting"]);
  // The search itself reporting staleness (null) ends the run the same way.
  assert.equal(await resolveBulk(lines, run(async () => null)), null);
});

test("a search that fails in the middle marks its line and the rest are still looked up", async () => {
  const { lines } = startBulk("A寺\nB寺\nC寺", 24, []);
  const outcome = await resolveBulk(lines, run(async (name) => { if (name === "B寺") throw new Error("offline"); return [candidate(name)]; }));
  assert.deepEqual(outcome?.lines.map((line) => line.status), ["found", "failed", "found"]);
  assert.equal(outcome?.stopped, null);
  // Retrying looks up that line only.
  const asked: string[] = [];
  const again = await resolveBulk(requeueBulk(outcome!.lines, 1, "B寺"), run(async (name) => { asked.push(name); return [candidate(name)]; }));
  assert.deepEqual(asked, ["B寺"]);
  assert.deepEqual(again?.lines.map((line) => line.status), ["found", "found", "found"]);
});

test("a spent search budget stops the run and leaves the remaining lines unsearched, not 'missing'", async () => {
  const asked: string[] = [];
  const { lines } = startBulk("A寺\nB寺\n浅草寺\nC寺", 24, []);
  const outcome = await resolveBulk(lines, run(async (name) => { asked.push(name); if (name === "B寺") throw new BulkBudgetError(); return [candidate(name)]; }));
  assert.deepEqual(asked, ["A寺", "B寺"]);
  assert.equal(outcome?.stopped, "budget");
  assert.deepEqual(outcome?.lines.map((line) => line.status), ["found", "failed", "failed", "failed"]);
});

test("choosing, unticking and correcting a line", () => {
  const two = [candidate("X", "apple-1"), candidate("Y", "apple-2")];
  let lines = [settleLine(startBulk("もんじゃ", 24, []).lines[0], two, new Set(), new Set())];
  lines = chooseBulk(lines, 0, "apple-2");
  assert.equal(lines[0].chosen, "apple-2");
  assert.equal(chooseBulk(lines, 0, "apple-nowhere")[0].chosen, null);
  assert.equal(chooseBulk(lines, 0, null)[0].chosen, null);
  const edited = requeueBulk(lines, 0, " もんじゃ 月島 ");
  assert.deepEqual([edited[0].text, edited[0].query, edited[0].status, edited[0].chosen], ["もんじゃ", "もんじゃ 月島", "waiting", null]);
  assert.equal(requeueBulk(lines, 0, "  ")[0].status, "choose");
});

test("confirmed lines are added in order, once each, only as far as there is room; the rest go back to the box", () => {
  const start = startBulk("A寺\nB寺\nA 寺\nC寺\nD寺\nE寺", 5, []);
  let lines = start.lines.map((line) => settleLine(line, line.text === "D寺" ? [] : line.text === "A 寺" ? [candidate("A寺"), candidate("A寺", "apple-twin")] : [candidate(line.text)], new Set(), new Set()));
  assert.deepEqual(lines.map((line) => line.status), ["found", "found", "choose", "found", "missing"]);
  lines = chooseBulk(lines, 2, "apple-A寺");
  const done = confirmBulk(lines, 2, new Set());
  assert.deepEqual(done.add.map((entry) => entry.name), ["A寺", "B寺"]);
  assert.deepEqual(done.lines.map((line) => line.status), ["added", "added", "already", "found", "missing"]);
  assert.equal(done.over, 1);
  assert.equal(bulkLeftover(done.lines, start.leftOut), "C寺\nD寺\nE寺");
  // Cancelling before anything was added gives the whole text back.
  assert.equal(bulkLeftover(start.lines, start.leftOut), "A寺\nB寺\nA 寺\nC寺\nD寺\nE寺");
  // A place that entered the trip while the review was open is not added again.
  assert.deepEqual(confirmBulk(lines, 9, new Set(["apple-B寺"])).add.map((entry) => entry.name), ["A寺", "C寺"]);
});

test("a decision made while the run is still going is not overwritten by the run", () => {
  const lines = startBulk("A寺\nB寺", 24, []).lines;
  const first = settleLine(lines[0], [candidate("A寺")], new Set(), new Set());
  // The screen: the traveller unticked the first line; the run still has it ticked and has now settled the second.
  const screen = chooseBulk([first, { ...lines[1], status: "checking" }], 0, null);
  const merged = mergeBulk(screen, [first, settleLine(lines[1], [candidate("B寺")], new Set(), new Set())]);
  assert.deepEqual(merged.map((line) => [line.status, line.chosen]), [["found", null], ["found", "apple-B寺"]]);
  // A line the traveller rewrote meanwhile is not settled with the answer for its old text.
  const rewritten = requeueBulk([{ ...lines[1], status: "checking" }], 1, "B寺 京都");
  assert.equal(mergeBulk(rewritten, [settleLine(lines[1], [candidate("B寺")], new Set(), new Set())])[0].status, "waiting");
});

test("a candidate enters the trip once, is updated when chosen again, and never pushes the trip past its limit", () => {
  let trip = putPlace(emptyTrip, placeOfCandidate(candidate("A寺"), "place"));
  assert.deepEqual([trip.places.length, trip.places[0].stayMinutes, trip.places[0].meal], [1, 60, undefined]);
  trip = putPlace(trip, placeOfCandidate(candidate("A寺"), "dinner"));
  assert.deepEqual([trip.places.length, trip.places[0].meal, trip.places[0].stayMinutes], [1, "dinner", 90]);
  for (let index = 0; index < MAX_PLACES + 3; index += 1) trip = putPlace(trip, placeOfCandidate(candidate(`寺${index}`), "place"));
  assert.equal(trip.places.length, MAX_PLACES);
});

/* ------------------------------------------------- what the reviewer found */

test("a guess of the open lookup, or a hit with no address, is offered to choose and never ticked", async () => {
  const hit = { id: "osm-1", name: "浅草神社", latitude: 35.715, longitude: 139.797, planningDurationMinutes: 40 };
  const anchor = { latitude: 35.68, longitude: 139.76 };
  // The lookup could not decide between several: its first candidate is a guess.
  const guess = openLookupHit({ places: [], ambiguous: [{ input: "浅草神社", candidates: [hit, { ...hit, id: "osm-2" }] }] }, "浅草神社")!;
  assert.deepEqual(guess, { hit, ambiguous: true });
  assert.equal(openCandidate(guess.hit, anchor, 60, guess.ambiguous)!.unsure, true);
  // Resolved without doubt, but with no address to tell it from a namesake: unsure all the same.
  const sure = openLookupHit({ places: [{ ...hit, input: "浅草神社" }], ambiguous: [] }, "浅草神社")!;
  assert.equal(sure.ambiguous, false);
  assert.equal(openCandidate(sure.hit, anchor, 60, sure.ambiguous)!.unsure, true);
  assert.equal(openLookupHit({ places: [], ambiguous: [] }, "浅草神社"), null);

  const [line] = startBulk("浅草神社", 5, []).lines;
  const unsure = openCandidate(guess.hit, anchor, 60, true)!;
  // The name is the very name pasted — and still it is not "found".
  assert.equal(unsure.name, line.query);
  const settled = settleLine(line, [unsure], new Set(), new Set());
  assert.equal(settled.status, "choose");
  assert.equal(settled.chosen, null);
  assert.deepEqual(settled.candidates, [unsure]);
  // The same candidate from the map search, with its address, is found as before.
  assert.equal(settleLine(line, [candidate("浅草神社")], new Set(), new Set()).status, "found");
  // Through a whole run: nothing is ticked, nothing would be added.
  const outcome = await resolveBulk(startBulk("浅草神社\nスカイツリー", 5, []).lines, run(async (name) => name === "浅草神社" ? [unsure] : [candidate(name)]));
  assert.deepEqual(outcome!.lines.map((entry) => [entry.status, entry.chosen]), [["choose", null], ["found", "apple-スカイツリー"]]);
  assert.deepEqual(bulkSummary(outcome!.lines).confirmed.map((entry) => entry.text), ["スカイツリー"]);
  // Chosen by the traveller, it is added like any other.
  assert.equal(confirmBulk(chooseBulk(outcome!.lines, 0, unsure.id), 5, new Set()).add.length, 2);
});

test("a correction typed into a line but not searched yet goes back to the box, not the original text", () => {
  const start = startBulk("あさくさでら\n東京タワー\n上野", 2, []);
  const lines = start.lines.map((line) => ({ ...line, status: "missing" as const }));
  assert.equal(bulkLeftover(lines, start.leftOut, { 0: " 浅草寺 " }), "浅草寺\n東京タワー\n上野");
  // An edit emptied out falls back to what was searched; no edits is as before.
  assert.equal(bulkLeftover(lines, start.leftOut, { 0: "  " }), "あさくさでら\n東京タワー\n上野");
  assert.equal(bulkLeftover(lines, start.leftOut), "あさくさでら\n東京タワー\n上野");
  // An edit of a line that was added in the meantime brings nothing back.
  assert.equal(bulkLeftover([{ ...lines[0], status: "added" }, lines[1]], [], { 0: "浅草寺" }), "東京タワー");
});

test("a review does not outlive its trip: another trip clears it and the box, another destination hands the lines back", () => {
  const places = [{ id: "a" }];
  const tokyo = { cityId: "tokyo", places };
  // The very trip (choosing the city it already has, reopening the trip in hand).
  assert.equal(tripChange(tokyo, tokyo), "same");
  assert.equal(tripChange(tokyo, { ...tokyo }), "same");
  // A new trip, a saved one, a shared link: another list — even for the same city.
  assert.equal(tripChange(tokyo, { cityId: null, places: [] }), "replaced");
  assert.equal(tripChange(tokyo, { cityId: "tokyo", places: [{ id: "a" }] }), "replaced");
  assert.equal(tripChange({ cityId: null, places: [] }, { cityId: "tokyo", places: [] }), "replaced");
  // The same list under another destination.
  assert.equal(tripChange(tokyo, { cityId: "kyoto", places }), "city");

  const start = startBulk("浅草寺\nあさくさ\n上野\n銀座", 3, []);
  const review = { lines: [{ ...start.lines[0], status: "added" as const }, { ...start.lines[1], status: "missing" as const }, { ...start.lines[2], status: "checking" as const }], leftOut: start.leftOut, edits: { 1: "浅草" } };
  // Untouched trip: the check goes on, the review and the box stay.
  assert.deepEqual(bulkAfterTripChange(review, "", "same"), { cancel: false, text: "" });
  // Another trip: the check is cancelled, and neither the review ("3件を追加しました") nor its lines come along.
  assert.deepEqual(bulkAfterTripChange(review, "", "replaced"), { cancel: true, text: "" });
  assert.deepEqual(bulkAfterTripChange(null, "書きかけ", "replaced"), { cancel: true, text: "" });
  // Same trip, other destination: cancelled — a line never stays "checking" — and what was not added returns, as last written.
  assert.deepEqual(bulkAfterTripChange(review, "", "city"), { cancel: true, text: "浅草\n上野\n銀座" });
  assert.deepEqual(bulkAfterTripChange(null, "書きかけ", "city"), { cancel: true, text: "書きかけ" });
});
