import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * What Apple says about places is shown only with the Apple map it belongs
 * to (Apple Developer Program License Agreement, Attachment 6, 2.4). Every
 * list of places found through Apple — a search by name, a pasted list,
 * the restaurants and cafés of a day, the hotels — is drawn beside a small
 * Apple map with a numbered pin per place, and is not shown when that map
 * cannot be. The page is checked in its source; the map itself was looked
 * at in a browser.
 */

const app = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../app/shiori/ShioriMap.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/shiori/shiori.css", import.meta.url), "utf8");
const block = (start: string, end: string) => {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `ShioriApp.tsx no longer has ${start} … ${end}`);
  return app.slice(from, to);
};

test("the small map is an Apple map with Apple's own places off, never printed, and says when it cannot be shown", () => {
  const candidate = map.slice(map.indexOf("export function CandidateMap("));
  assert.match(candidate, /loadMapKit\(locale\)/);
  assert.match(candidate, /pointOfInterestFilter: mapkit\.PointOfInterestFilter\.excludingAllCategories/);
  assert.match(candidate, /onStateRef\.current\?\.\("failed"\)/);
  assert.match(candidate, /className="shiori-candmap shiori-screen-only"/);
  // Apple's logo and legal link sit at the foot of the frame; nothing is laid over the frame but the note when it failed.
  assert.match(css, /\.shiori-candmap \{[^}]*overflow: hidden;[^}]*position: relative;/);
});

test("every list of Apple's places is drawn beside that map, with the same numbers, and not shown without it", () => {
  const lists = {
    "search by name": block("{otherHits ? (", "{added ? ("),
    "pasted list": block("<p className=\"shiori-bulk-title\">", "{bulk.added > 0 ?"),
    "meal": block("function MealRow(", "function CafeRow("),
    "coffee break": block("function CafeRow(", "function StayNear("),
    "hotels": block("function StayNear(", "function TimeInput("),
  };
  for (const [name, source] of Object.entries(lists)) {
    assert.match(source, /<CandidateMap failed=\{t\.candidateMapFailed\} label=\{t\.candidateMapLabel\} locale=\{locale\} onState=\{set\w*Map\}/, `${name}: no Apple map beside the list`);
    assert.match(source, /className="shiori-hit-no">\{/, `${name}: the list does not carry the pins' numbers`);
  }
  // A failed map takes Apple's places off the list: by source on the search lists, the whole list elsewhere.
  assert.match(app, /const withoutApple = <T extends \{ id: string \}>\(list: readonly T\[\]\) => \(listMap === "failed" \? list\.filter\(\(entry\) => placeSource\(entry\.id\) !== "apple"\) : \[\.\.\.list\]\);/);
  assert.match(lists.meal, /shops\.length === 0 && listMap !== "failed"/);
  assert.match(lists["coffee break"], /state === "ready" && listMap !== "failed"/);
  assert.match(lists.hotels, /hotels\.length > 0 && listMap !== "failed" \? "ready" : "failed"/);
  // And the lists of a day stay off paper, where there is no such map beside them.
  assert.match(lists.meal, /<div className="shiori-screen-only">\s*<CandidateMap/);
  assert.match(lists["coffee break"], /<div className="shiori-screen-only">[\s\S]*<CandidateMap/);
  assert.match(lists.hotels, /<ul className="shiori-hotels shiori-screen-only">/);
});

test("Apple's places, and the places where a meal or a break falls, are handed to Apple Maps, never to another map", () => {
  for (const name of ["MealRow", "CafeRow"]) {
    const source = block(`function ${name}(`, name === "MealRow" ? "function CafeRow(" : "function StayNear(");
    assert.doesNotMatch(source, /google\.com\/maps/, name);
    assert.match(source, /https:\/\/maps\.apple\.com\/\?q=/, name);
  }
  for (const file of ["../lib/shiori/cafes.ts", "../lib/apple-food.ts", "../lib/apple-hotels.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    // Only a HotPepper café without its own page falls back to a search by its (HotPepper) name.
    const appleParts = file.endsWith("cafes.ts") ? source.slice(source.indexOf("export async function findCafes("), source.indexOf("type ListedCafe")) : source;
    assert.doesNotMatch(appleParts, /google\.com\/maps/, file);
  }
});

test("the strings of the small map exist in both languages", () => {
  for (const key of ["candidateMapLabel", "candidateMapFailed", "appleMapsLink", "appleLoading", "appleFailed", "appleRetry", "appleGone", "appleGoneRemove", "applePendingChip", "appleFailedChip"]) {
    assert.equal(app.split("\n").filter((line) => line.startsWith(`    ${key}: `)).length, 2, key);
  }
});
