import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The words about times a traveller entered. They are read from the screen's
 * own text table: each exists in both languages, a booking is never called
 * an estimate, and "cannot" is said only of what the planner has proven.
 */

test("every word about entered times exists in Japanese and English, and says 'cannot' only where it is proven", () => {
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  const table = source.slice(source.indexOf("const text = {"), source.indexOf("\n};", source.indexOf("const text = {")));
  const ja = table.slice(table.indexOf("  ja: {"), table.indexOf("\n  en: {"));
  const en = table.slice(table.indexOf("\n  en: {"));
  const keys = [
    "framesTitle", "firstStart", "firstStartHint", "lastFinish", "lastFinishHint", "framesSummary", "dayFrom", "dayBy",
    "reserveLabel", "reserveDay", "reserveTime", "reserveClear", "reserveLocked", "reserveChip", "waitReserved", "noLunchRoom",
    "unReserveDay", "unBeforeStart", "unBeforeStartRide", "unAfterFinish", "unAfterFinishRide", "unClash", "unClashRide",
    "unReserveLate", "unNoRoomFinish", "unNoRoomReserve", "unNoRoomDay", "frameOrder", "dayEmptyStart", "dayEmptyFinish",
  ];
  for (const key of keys) {
    assert.match(ja, new RegExp(`\\n    ${key}: `), `ja: ${key}`);
    assert.match(en, new RegExp(`\\n    ${key}: `), `en: ${key}`);
  }
  const line = (block: string, key: string) => block.slice(block.indexOf(`\n    ${key}: `)).split("\n")[1];
  // The start is when the traveller can move, not when a flight lands — said in so many words.
  assert.match(line(ja, "firstStart"), /動き始められる時刻/);
  assert.match(line(en, "firstStart"), /when you can start/i);
  // A day left empty by an entered time: what the plan did and why — not a proof that nothing could go there.
  for (const key of ["dayEmptyStart", "dayEmptyFinish"]) {
    assert.match(line(ja, key), /予定を入れていません/, key);
    assert.match(line(en, key), /has nothing planned/, key);
    assert.doesNotMatch(line(en, key), /cannot/i, key);
  }
  // A booking is "booked", never "about" or "estimate".
  assert.match(line(ja, "reserveChip"), /予約/);
  assert.doesNotMatch(line(ja, "reserveChip").replace("予約", ""), /約|目安|ごろ/);
  assert.doesNotMatch(line(en, "reserveChip"), /about|estimate/i);
  assert.match(line(en, "reserveChip"), /booked/);
  // Proven — the traveller's own entries contradict each other: "cannot" / 間に合いません・収まりません・両立しません,
  // and nothing in the line is an estimate (no ride, no 約・ごろ・目安, no "about").
  for (const key of ["unBeforeStart", "unAfterFinish", "unClash"]) {
    assert.match(line(ja, key), /間に合いません|収まりません|両立しません/, key);
    assert.doesNotMatch(line(ja, key).replace(/予約/g, ""), /ませんでした|約|ごろ|目安/, key);
    assert.match(line(en, key), /cannot/, key);
    assert.doesNotMatch(line(en, key), /could not|was not found|about|around|estimate/i, key);
  }
  // Not proven: "could not" / ませんでした.
  for (const key of ["unBeforeStartRide", "unAfterFinishRide", "unClashRide", "unReserveLate", "unNoRoomFinish", "unNoRoomReserve", "unNoRoomDay"]) {
    assert.match(line(ja, key), /ませんでした/, key);
    assert.match(line(en, key), /could not|No way was found/i, key);
    assert.doesNotMatch(line(en, key), /cannot/i, key);
  }
  // Where a ride is what does not fit, it is given as the booklet's estimate, never as a fact.
  for (const key of ["unBeforeStartRide", "unAfterFinishRide", "unClashRide"]) {
    assert.match(line(ja, key), /目安/, key);
    assert.match(line(ja, key).replace(/予約/g, ""), /約/, key);
    assert.match(line(en, key), /estimate/, key);
    assert.match(line(en, key), /about/, key);
  }
  // The screen picks the proven wording only for an entry the planner marked proven.
  const picker = source.slice(source.indexOf("const unplacedText = "), source.indexOf("const sameRoom = "));
  for (const [proven, unproven] of [["t.unBeforeStart(", "t.unBeforeStartRide("], ["t.unAfterFinish(", "t.unAfterFinishRide("], ["t.unClash(", "t.unClashRide("]]) {
    const at = picker.indexOf(proven);
    assert.ok(at > 0 && picker.indexOf(unproven) > at, proven);
    assert.match(picker.slice(picker.lastIndexOf("return", at), at), /entry\.proven/, proven);
  }
});
