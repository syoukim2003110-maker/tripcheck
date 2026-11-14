import { NOT_THE_SIGHT, placeNameCertainty } from "../apple-place-card.ts";
import type { PopularSight } from "../popular-sights.ts";
import { kmBetween, type AddAnchor, type AddCandidate } from "./add-search.ts";

/*
 * Adding a pasted list of place names at once. Every line is looked up and
 * shown for review before anything is added: a list from a memo is full of
 * half names and nicknames, and a place added on a guess is worse than a line
 * the traveller still has to decide on. Nothing here touches the trip.
 */

export type BulkStatus =
  /** Not looked up yet. */
  | "waiting"
  | "checking"
  /** Exactly one place bears this very name: ticked for the traveller, who may untick it. */
  | "found"
  /** Candidates exist but none is certainly meant: the traveller picks one, or none. */
  | "choose"
  /** The search answered and knew nothing by this name. */
  | "missing"
  /** The search could not be asked; says nothing about the place. */
  | "failed"
  /** Already in the trip. */
  | "already"
  /** The same place as a line further up. */
  | "repeat"
  | "added";

export type BulkLine = {
  key: number;
  /** The line as pasted (bullet removed). Never changed, always shown. */
  text: string;
  /** What is searched for: the pasted text until the traveller edits it. */
  query: string;
  status: BulkStatus;
  candidates: AddCandidate[];
  /** The id of the candidate that will be added; null adds nothing. */
  chosen: string | null;
};

/** Bullets and numbering a memo or chat list starts its lines with: "1." "(2)" "③" "・" "- " "□". A number followed by another ("3.11") is part of the name. */
const BULLET = /^(?:[\s\u3000]*(?:[-*•・･‣◦▪■□●○◆◇▶▷☐☑✓✔]+|[(（]?\d{1,3}[)）.．、:：](?!\d)|[①-⑳]))+[\s\u3000]*/u;

/**
 * The names in a pasted list: one per line, bullets and numbering removed,
 * empty lines and exact repeats dropped. A line is never split further: "、"
 * and "," are part of many names and addresses.
 */
export function parseBulkText(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n|\u2028|\u2029/)) {
    const line = raw.normalize("NFC").trim();
    // A number alone ("2025") or a name that is all bullet is kept as typed.
    const name = line.replace(BULLET, "").trim() || line;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** The same name once spacing, width, case, punctuation and old-form characters are set aside. */
export function sameName(left: string, right: string) {
  return placeNameCertainty(left, right) === 2;
}

export type BulkTaken = Readonly<{ id: string; name: string }>;

/**
 * The review list for a pasted text. Lines naming a place already in the trip
 * are marked so and cost neither a request nor room; of the rest only as many
 * as the trip has room for are taken, and the others are handed back so the
 * screen can say they were left out.
 */
export function startBulk(text: string, room: number, taken: readonly BulkTaken[]): { lines: BulkLine[]; leftOut: string[] } {
  const lines: BulkLine[] = [];
  const leftOut: string[] = [];
  let used = 0;
  for (const name of parseBulkText(text)) {
    const already = taken.some((place) => sameName(place.name, name));
    if (!already && used >= room) { leftOut.push(name); continue; }
    if (!already) used += 1;
    lines.push({ key: lines.length, text: name, query: name, status: already ? "already" : "waiting", candidates: [], chosen: null });
  }
  return { lines, leftOut };
}

/** The city's bundled sights that bear exactly this name, in either language. */
export function bundledMatches(name: string, sights: readonly PopularSight[], locale: "ja" | "en", anchor: AddAnchor | null): AddCandidate[] {
  return sights
    .filter((sight) => sameName(sight.ja, name) || sameName(sight.en, name))
    .map((sight) => ({
      id: `wikidata-${sight.q}`,
      name: (locale === "ja" ? sight.ja : sight.en).trim(),
      lat: sight.lat,
      lon: sight.lon,
      address: "",
      category: null,
      km: anchor ? kmBetween(anchor, { latitude: sight.lat, longitude: sight.lon }) : 0,
    }));
}

/**
 * What a line becomes once its candidates are known. It is "found" only when
 * exactly one candidate bears the very name that was typed — a station or car
 * park named after the sight does not count — and that place is new. Anything
 * less sure — a candidate the lookup itself marked unsure included — is left
 * for the traveller to choose.
 */
export function settleLine(
  line: BulkLine,
  candidates: readonly AddCandidate[],
  takenIds: ReadonlySet<string>,
  listedIds: ReadonlySet<string>,
  // Bundled sights were matched on either of their two names already; the one shown may be the other language's.
  bearsName: (candidate: AddCandidate) => boolean = (candidate) => sameName(candidate.name, line.query),
): BulkLine {
  if (candidates.length === 0) return { ...line, status: "missing", candidates: [], chosen: null };
  // A guess of the lookup's, or a hit with no address to check it by, is never certain however well its name fits.
  const certain = candidates.filter((candidate) => bearsName(candidate) && !candidate.unsure && !(candidate.category && NOT_THE_SIGHT.has(candidate.category)));
  if (certain.length !== 1) return { ...line, status: "choose", candidates: [...candidates], chosen: null };
  const [only] = certain;
  if (takenIds.has(only.id)) return { ...line, status: "already", candidates: [only], chosen: null };
  if (listedIds.has(only.id)) return { ...line, status: "repeat", candidates: [only], chosen: null };
  return { ...line, status: "found", candidates: [only], chosen: only.id };
}

/** Thrown by the injected search when the map service's budget is used up: asking for the next line would fail the same way. */
export class BulkBudgetError extends Error {
  constructor() {
    super("The map search budget is used up.");
    this.name = "BulkBudgetError";
  }
}

export type BulkRun = {
  /** Certain matches that need no request (the city's bundled sights). */
  local: (name: string) => AddCandidate[];
  /**
   * The search by name. Resolves to null when the run is no longer current,
   * throws BulkBudgetError when the budget is gone, anything else when it
   * could not be asked.
   */
  search: (name: string) => Promise<AddCandidate[] | null>;
  /** Ids of the places already in the trip. */
  takenIds: ReadonlySet<string>;
  /** False once the traveller cancelled or started another run. */
  isCurrent: () => boolean;
  /** Called with the whole list after every change, so the screen can follow. */
  onChange: (lines: BulkLine[]) => void;
};

export type BulkOutcome = { lines: BulkLine[]; stopped: "budget" | null };

/**
 * Looks up every waiting line, in order and one request at a time. A search
 * that fails marks its line and the run goes on; a spent budget stops the run
 * and leaves the remaining lines marked as not searched. Returns null when the
 * run was overtaken: nothing it knows may reach the screen any more.
 */
export async function resolveBulk(start: readonly BulkLine[], run: BulkRun): Promise<BulkOutcome | null> {
  let lines = [...start];
  const set = (index: number, line: BulkLine) => {
    lines = lines.map((entry, at) => at === index ? line : entry);
    run.onChange(lines);
  };
  // Places the lines above already stand for: two spellings of one place are one place.
  const listed = () => new Set(lines.flatMap((line) => line.chosen ? [line.chosen] : []));
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].status !== "waiting") continue;
    if (!run.isCurrent()) return null;
    const local = run.local(lines[index].query);
    if (local.length > 0) { set(index, settleLine(lines[index], local, run.takenIds, listed(), () => true)); continue; }
    set(index, { ...lines[index], status: "checking" });
    try {
      const candidates = await run.search(lines[index].query);
      if (candidates === null || !run.isCurrent()) return null;
      set(index, settleLine(lines[index], candidates, run.takenIds, listed()));
    } catch (error) {
      if (!run.isCurrent()) return null;
      if (error instanceof BulkBudgetError) {
        lines = lines.map((line, at) => at >= index && (line.status === "waiting" || line.status === "checking") ? { ...line, status: "failed" as const } : line);
        run.onChange(lines);
        return { lines, stopped: "budget" };
      }
      set(index, { ...lines[index], status: "failed", candidates: [], chosen: null });
    }
  }
  return { lines, stopped: null };
}

/**
 * The list on screen brought up to date with a run's. Only lines the screen
 * still shows as unsettled are taken from the run: a line the traveller has
 * ticked, unticked or chosen for while the others were being looked up keeps
 * their decision.
 */
export function mergeBulk(screen: readonly BulkLine[], fromRun: readonly BulkLine[]): BulkLine[] {
  return screen.map((line) => {
    if (line.status !== "waiting" && line.status !== "checking") return line;
    return fromRun.find((entry) => entry.key === line.key && entry.query === line.query) ?? line;
  });
}

/** How far a run has come: lines settled so far (those that needed no lookup included), out of all. */
export function bulkProgress(lines: readonly BulkLine[]) {
  return { done: lines.filter((line) => line.status !== "waiting" && line.status !== "checking").length, total: lines.length };
}

/** The line with another candidate chosen, or none (null). Only a candidate the line really has can be chosen. */
export function chooseBulk(lines: readonly BulkLine[], key: number, candidateId: string | null): BulkLine[] {
  return lines.map((line) => line.key !== key || (line.status !== "found" && line.status !== "choose") ? line
    : { ...line, chosen: candidateId !== null && line.candidates.some((candidate) => candidate.id === candidateId) ? candidateId : null });
}

/** A line sent back to be looked up again, under the text the traveller corrected it to. */
export function requeueBulk(lines: readonly BulkLine[], key: number, query: string): BulkLine[] {
  const next = query.trim();
  return lines.map((line) => line.key === key && next ? { ...line, query: next, status: "waiting", candidates: [], chosen: null } : line);
}

/** The lines that will be added, and how many are still undecided, unfound or unsearched. */
export function bulkSummary(lines: readonly BulkLine[]) {
  const confirmed = lines.filter((line) => line.chosen !== null && (line.status === "found" || line.status === "choose"));
  const held = lines.filter((line) => !confirmed.includes(line) && line.status !== "already" && line.status !== "repeat" && line.status !== "added");
  return { confirmed, held };
}

/**
 * Adds the confirmed lines, as far as the trip has room: the candidates to
 * add in list order, the list with those lines marked added, and how many
 * confirmed lines did not fit (they stay ticked and listed). One place is
 * added once even when two lines chose it.
 */
export function confirmBulk(lines: readonly BulkLine[], room: number, takenIds: ReadonlySet<string>): { add: AddCandidate[]; lines: BulkLine[]; over: number } {
  const add: AddCandidate[] = [];
  const seen = new Set(takenIds);
  let over = 0;
  const next = lines.map((line) => {
    if (line.chosen === null || (line.status !== "found" && line.status !== "choose")) return line;
    const candidate = line.candidates.find((entry) => entry.id === line.chosen);
    if (!candidate) return line;
    if (seen.has(candidate.id)) return { ...line, status: "already" as const, chosen: null };
    if (add.length >= room) { over += 1; return line; }
    seen.add(candidate.id);
    add.push(candidate);
    return { ...line, status: "added" as const };
  });
  return { add, lines: next, over };
}

/**
 * The text to put back into the box when the review is closed: every line
 * that was not added and is not already in the trip, as the traveller last
 * wrote it — a correction typed but not yet searched included — then the
 * lines that were left out for want of room.
 */
export function bulkLeftover(lines: readonly BulkLine[], leftOut: readonly string[], edits: Readonly<Record<number, string>> = {}): string {
  return [
    ...lines
      .filter((line) => line.status !== "added" && line.status !== "already" && line.status !== "repeat")
      .map((line) => edits[line.key]?.trim() || line.query),
    ...leftOut,
  ].join("\n");
}

/** What happened to the trip in hand: it is the very same, it took another destination, or another trip took its place. */
export type TripChange = "same" | "city" | "replaced";

/**
 * How the trip in hand relates to the one about to be shown. Another list of
 * places is another trip (a new one, a saved one reopened, a shared link);
 * the same list under another destination is the same trip moved.
 */
export function tripChange(
  before: { cityId: string | null; places: readonly unknown[] },
  after: { cityId: string | null; places: readonly unknown[] },
): TripChange {
  if (before === after) return "same";
  if (before.places !== after.places) return "replaced";
  return before.cityId === after.cityId ? "same" : "city";
}

/**
 * What is left of the pasted list after such a change. A review was checked
 * against one trip and one destination: unless the trip is untouched the
 * running check is cancelled and the review dropped, so it can neither come
 * back on another trip nor stay "checking" for ever. The lines not yet added
 * go back to the box only while the same trip is open; another trip starts
 * with an empty box.
 */
export function bulkAfterTripChange(
  review: { lines: readonly BulkLine[]; leftOut: readonly string[]; edits?: Readonly<Record<number, string>> } | null,
  text: string,
  change: TripChange,
): { cancel: boolean; text: string } {
  if (change === "same") return { cancel: false, text };
  if (change === "replaced") return { cancel: true, text: "" };
  return { cancel: true, text: review ? bulkLeftover(review.lines, review.leftOut, review.edits) : text };
}
