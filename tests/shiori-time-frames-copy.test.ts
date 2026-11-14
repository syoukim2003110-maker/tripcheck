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
    "unReserveDay", "unBeforeStart", "unAfterFinish", "unClash", "unReserveLate", "unNoRoomFinish", "unNoRoomReserve", "frameOrder",
  ];
  for (const key of keys) {
    assert.match(ja, new RegExp(`\\n    ${key}: `), `ja: ${key}`);
    assert.match(en, new RegExp(`\\n    ${key}: `), `en: ${key}`);
  }
  const line = (block: string, key: string) => block.slice(block.indexOf(`\n    ${key}: `)).split("\n")[1];
  // The start is when the traveller can move, not when a flight lands — said in so many words.
  assert.match(line(ja, "firstStart"), /動き始められる時刻/);
  assert.match(line(en, "firstStart"), /when you can start/i);
  // A booking is "booked", never "about" or "estimate".
  assert.match(line(ja, "reserveChip"), /予約/);
  assert.doesNotMatch(line(ja, "reserveChip").replace("予約", ""), /約|目安|ごろ/);
  assert.doesNotMatch(line(en, "reserveChip"), /about|estimate/i);
  assert.match(line(en, "reserveChip"), /booked/);
  // Proven: "cannot" / 間に合いません・収まりません・両立しません. Not proven: "could not" / ませんでした.
  for (const key of ["unBeforeStart", "unAfterFinish", "unClash"]) {
    assert.doesNotMatch(line(ja, key), /ませんでした/, key);
    assert.doesNotMatch(line(en, key), /could not|was not found/i, key);
  }
  for (const key of ["unReserveLate", "unNoRoomFinish", "unNoRoomReserve"]) {
    assert.match(line(ja, key), /ませんでした/, key);
    assert.match(line(en, key), /could not|No way was found/i, key);
  }
});
