/*
 * Builds lib/shiori/sight-notes.json: for the bundled sights
 * (lib/popular-sights-data.json), the planning notes two independent model
 * passes agreed on, with a cited source where they say a place cannot be
 * visited. A development tool; nothing here runs on the site, and no model is
 * asked anything here: the two passes were drafted once, at development time,
 * and are kept in scripts/sight-notes/drafts so that this build gives the
 * same file on every run.
 *
 *   node --experimental-strip-types scripts/build-sight-notes.ts [--check]
 *
 * Each pass wrote, per sight (by its Wikidata id):
 *   stay    minutes a first visit usually takes;
 *   hours   morning | early | day | evening | any (or unsure);
 *   access  walk-in | booking | tour | closed | private (or unsure);
 *   partOf  the id of another sight of the same city it lies inside or is
 *           the same as, or null.
 *
 * A value is kept only when both passes agree:
 *   stay    both within a factor of 1.5 of each other; the geometric mean,
 *           snapped to the nearest of STAYS (on a log scale);
 *   hours   the same word, not "unsure";
 *   access  the same word, neither "unsure" nor "walk-in" (walk-in is what
 *           any place is without a note);
 *   partOf  the same id, of another sight of the same city.
 *
 * A place both passes call closed or private was then given a verdict with a
 * cited source (scripts/sight-notes/web-check.json): 32 of the 61 were
 * fetched from the web at the time, 29 were written from memory with the
 * page they rest on and say so ("from memory"). The verdict decides: "closed" or
 * "gone-historic" keep the place as closed ("closed" / "gone"),
 * "exterior-only" makes it a place seen from outside ("exterior"), "open"
 * removes the note. A closed or private place nobody checked keeps no access
 * note at all.
 *
 * Last, OVERRIDES corrects a note both drafts agreed on and a reviewer found
 * wrong, each with its reason: a field set to null is removed, any other value
 * replaces the drafts'.
 *
 * What the notes are for — and what they are not: they are planning habits
 * and estimates (how long a stop is planned, which part of the day suits it,
 * which places are not offered, which place is seen as part of another). They
 * are never printed as opening hours or as facts about a place.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Draft = { q: string; stay?: number | null; hours?: string | null; access?: string | null; partOf?: string | null };
export type SightNote = {
  stay?: number;
  hours?: "morning" | "early" | "day" | "evening" | "any";
  access?: "booking" | "tour" | "closed" | "gone" | "exterior";
  partOf?: string;
};

/** The stays a note can carry, in minutes. */
export const STAYS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480] as const;
const HOURS = new Set(["morning", "early", "day", "evening", "any"]);
const ACCESS = new Set(["booking", "tour", "closed", "private"]);
const STAY_FACTOR = 1.5;

/**
 * Notes both drafts agreed on that a reviewer found wrong. By Wikidata id: the
 * fields to change (null removes one) and why. Kept short: a correction here
 * is for a note that would put something false on screen or in a plan.
 */
export const OVERRIDES: Record<string, { set: Partial<Record<keyof SightNote, SightNote[keyof SightNote] | null>>; why: string }> = {
  // 卯辰山山麓寺院群 is a group of temples at the foot of 卯辰山; these two stand elsewhere in the city.
  Q29408050: { set: { partOf: null }, why: "本興寺 is 4.7 km from 卯辰山山麓寺院群, not one of its temples" },
  Q30926295: { set: { partOf: null }, why: "本光寺 is 3.4 km from 卯辰山山麓寺院群, not one of its temples" },
  Q864752: { set: { partOf: null }, why: "the Hanoi flag tower stands on its own; the military history museum it was part of has moved 9 km away" },
  Q715264: { set: { partOf: null }, why: "Operation Anthropoid is an event, not a part of the cathedral 5.7 km away where it ended" },
  Q220274: { set: { partOf: null }, why: "the university's zoological museum is a building of its own 2 km from the natural history museum it now belongs to: a visit to one is not a visit to the other" },
  // The drafts disagreed on which way round these lie (one called 日光の社寺 part of 日光東照宮, the castle park part
  // of the castle, the island part of its shrine), so no note was kept; a place inside another is the smaller one.
  Q696641: { set: { partOf: "Q1063133" }, why: "日光東照宮 is one of the shrines and temples of 日光の社寺" },
  Q1348249: { set: { partOf: "Q1063133" }, why: "輪王寺 is one of the shrines and temples of 日光の社寺" },
  Q701927: { set: { partOf: "Q1063133" }, why: "日光二荒山神社 is one of the shrines and temples of 日光の社寺" },
  Q321242: { set: { partOf: "Q150118" }, why: "大阪城 stands in 大阪城公園" },
  Q191763: { set: { partOf: "Q875301" }, why: "厳島神社 is on 厳島 (Miyajima)" },
  Q859471: { set: { access: null }, why: "only the inner wholesale market of 築地市場 moved to Toyosu; the outer market (場外市場) still trades and is a usual morning visit" },
};

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

function drafts(path: string) {
  const byId = new Map<string, Draft>();
  for (const line of read(path).split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as Draft;
    if (typeof entry.q === "string") byId.set(entry.q, entry);
  }
  return byId;
}

export function snapStay(minutes: number) {
  let best: number = STAYS[0];
  for (const bucket of STAYS) if (Math.abs(Math.log(bucket / minutes)) < Math.abs(Math.log(best / minutes))) best = bucket;
  return best;
}

export function buildNotes() {
  const cities = (JSON.parse(read("lib/popular-sights-data.json")) as { cities: Array<{ id: string; sights: Array<{ q: string }> }> }).cities;
  const cityOf = new Map<string, string>();
  for (const city of cities) for (const sight of city.sights) cityOf.set(sight.q, city.id);
  const first = drafts("scripts/sight-notes/drafts/pass-A.jsonl");
  const second = drafts("scripts/sight-notes/drafts/pass-B.jsonl");
  const verdicts = new Map((JSON.parse(read("scripts/sight-notes/web-check.json")) as { items: Array<{ q: string; verdict: string }> }).items.map((item) => [item.q, item.verdict]));
  const notes: Record<string, SightNote> = {};
  for (const city of cities) {
    for (const { q } of city.sights) {
      const a = first.get(q);
      const b = second.get(q);
      if (!a || !b) continue;
      const note: SightNote = {};
      if (typeof a.stay === "number" && typeof b.stay === "number" && a.stay > 0 && b.stay > 0 && Math.max(a.stay, b.stay) / Math.min(a.stay, b.stay) <= STAY_FACTOR) {
        note.stay = snapStay(Math.sqrt(a.stay * b.stay));
      }
      if (a.hours && a.hours === b.hours && HOURS.has(a.hours)) note.hours = a.hours as SightNote["hours"];
      if (a.access && a.access === b.access && ACCESS.has(a.access)) {
        if (a.access === "booking" || a.access === "tour") note.access = a.access;
        else {
          const verdict = verdicts.get(q);
          if (verdict === "closed") note.access = "closed";
          else if (verdict === "gone-historic") note.access = "gone";
          else if (verdict === "exterior-only") note.access = "exterior";
        }
      }
      if (a.partOf && a.partOf === b.partOf && a.partOf !== q && cityOf.get(a.partOf) === city.id) note.partOf = a.partOf;
      for (const [field, value] of Object.entries(OVERRIDES[q]?.set ?? {})) {
        if (value === null) delete note[field as keyof SightNote];
        else (note as Record<string, unknown>)[field] = value;
      }
      if (Object.keys(note).length > 0) notes[q] = note;
    }
  }
  return notes;
}

/** One sight per line: small to ship, and a change to one sight is one line of a diff. */
export function notesText(notes: Record<string, SightNote>) {
  const entries = Object.entries(notes).map(([q, note]) => `${JSON.stringify(q)}:${JSON.stringify(note)}`);
  return `{\n${entries.join(",\n")}\n}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = notesText(buildNotes());
  const target = new URL("lib/shiori/sight-notes.json", root);
  if (process.argv.includes("--check")) {
    const same = readFileSync(target, "utf8") === text;
    console.log(same ? "lib/shiori/sight-notes.json is up to date" : "lib/shiori/sight-notes.json differs from what the drafts give");
    process.exitCode = same ? 0 : 1;
  } else {
    writeFileSync(target, text);
    console.log(`${Object.keys(JSON.parse(text)).length} sights with notes written to lib/shiori/sight-notes.json`);
  }
}
