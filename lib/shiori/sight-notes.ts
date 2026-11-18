/*
 * Planning notes about the bundled sights (lib/shiori/sight-notes.json, built
 * by scripts/build-sight-notes.ts): how long a first visit is usually
 * planned, which part of the day suits the place, whether it can be visited
 * at all, and which other sight of the same city it lies inside.
 *
 * They were drafted at development time by two independent model passes, and
 * only what both agreed on is kept; a place they called closed was given a
 * verdict with a cited source (fetched from the web, or from memory with the
 * page it rests on: scripts/sight-notes/web-check.json says which). At run time nothing is asked of any model: this is a table.
 *
 * They are the planner's habits and estimates, like the rules by kind they
 * refine. Nothing here is an opening hour or a fact about a place, and
 * nothing made from it may be printed as one.
 */
import data from "./sight-notes.json" with { type: "json" };

export type SightNote = {
  /** Minutes a first visit is usually planned at. */
  stay?: number;
  /**
   * Which part of the day suits the place: `morning` (a fish market),
   * `early` (better in the first half of the day: a palace, a large zoo),
   * `day` (in the daytime), `evening` (a night market), `any` (any hour).
   */
  hours?: "morning" | "early" | "day" | "evening" | "any";
  /**
   * `closed`: closed for good or for years; `gone`: no longer there;
   * `exterior`: seen from outside only; `booking` / `tour`: entry is booked
   * ahead or by guided tour only (recorded, not used yet).
   */
  access?: "booking" | "tour" | "closed" | "gone" | "exterior";
  /** The Wikidata id of another sight of the same city this one lies inside, or is the same as. */
  partOf?: string;
};

const notes = data as Record<string, SightNote>;
const PLACE_PREFIX = "wikidata-";

/** The note about a bundled sight, by its Wikidata id ("Q…"), or by the id of a place made from it ("wikidata-Q…"). */
export function sightNote(id: string | undefined | null): SightNote | null {
  if (!id) return null;
  const q = id.startsWith(PLACE_PREFIX) ? id.slice(PLACE_PREFIX.length) : id;
  return Object.hasOwn(notes, q) ? notes[q] : null;
}

/** A place that cannot be visited now: closed for good or for years, or gone. */
export const isClosedSight = (id: string | undefined | null) => {
  const access = sightNote(id)?.access;
  return access === "closed" || access === "gone";
};

/** A place that is only seen from outside: a residence, an office, a closed precinct. */
export const isExteriorSight = (id: string | undefined | null) => sightNote(id)?.access === "exterior";
