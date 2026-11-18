/*
 * When in the day a kind of place is usually visited — a habit of the planner
 * for putting a day in order, never a fact about a place. The planner knows
 * no opening hours and prints none: nothing here says when a door opens or
 * shuts, and nothing made from it may be worded as if it did. It only makes
 * the first draft the one a traveller would have drawn: the museum not at
 * half past eight while a shrine could open the day, the temple not after
 * five while a street could close it, the night market in the evening.
 *
 * Read first from the planning note of a bundled sight (sight-notes.ts:
 * which part of the day suits it, as two independent drafts agreed), then
 * from the kind the catalogue gives a place (lib/popular-sights-data.json)
 * and, for the few places of the evening or the morning, from the name. A
 * kind that says nothing — a tower, a market, a shopping street, a mountain
 * — has no habit unless its note gives one.
 */
import { sightNote } from "./sight-notes.ts";


/**
 * - `ticketed`: a place with a door and a counter (museum, gallery, aquarium,
 *   zoo, castle, palace). Visited in the daytime, and not the first thing in
 *   the morning when something under the open sky could go first.
 * - `daytime`: visited in the daytime (temple, garden, church, ruins).
 * - `daytime-open`: visited in the daytime, and reachable first thing
 *   (shrine, island, waterfall, volcano).
 * - `early`: visited in the first half of the day, and a good place to open
 *   it (a palace, a large zoo, a museum that takes most of a morning): a
 *   daytime place preferred to be over by about four instead of five. Only
 *   from a sight's note: no kind says it.
 * - `morning`: belongs to the morning, and can open the day (fish market,
 *   morning market).
 * - `open`: under the open sky at any hour (park, street, square, viewpoint).
 * - `evening`: belongs to the evening (night market, night-life street).
 */
export type PlaceHabit = "ticketed" | "daytime" | "daytime-open" | "early" | "morning" | "open" | "evening";

/** Places that belong to the evening, by what they are called. */
const EVENING_NAME = /夜市|ナイトマーケット|ナイトバザール|ナイトサファリ|night ?market|night ?bazaar|night ?safari|パッポン|patpong|ソイ・?カウボーイ|soi cowboy/i;
const EVENING_KIND = /night market/;
/** Places that belong to the morning, by what they are called. */
const MORNING_NAME = /朝市|morning ?market/i;
/** A hotel, a station, a shop or a café that carries such a name is not the market: only its neighbour. */
const NAMED_AFTER = /ホテル|ホステル|旅館|hotel|hostel|\binn\b|駅|station|店|ショップ|shop|store|カフェ|喫茶|caf[eé]|レストラン|restaurant|食堂/i;

/*
 * In order: the first rule that matches decides. A square in front of a
 * cathedral is a square, the park around a castle is a park, a museum in a
 * historical park is a museum.
 */
const rules: Array<[RegExp, PlaceHabit | null]> = [
  // (Before the kinds that say nothing: a fish market is a market with a habit.)
  [/fish market|morning market/, "morning"],
  // Kinds that carry another kind's word without being it.
  [/observation|skyscraper|\btower\b|tower block|ferris|theme park|amusement|water park|shopping|department store|market|bazaar|stadium|arena|theat|opera|cinema|movie|library|onsen|hot spring|ryokan|funicular|cable car|circuit|grand prix/, null],
  [/square|plaza|promenade|street|avenue|boulevard|neighbou?rhood|quarter|district|harbou?r|bridge|aqueduct|beach|\bgate\b|triumphal arch|fountain|statue|sculpture$|group of sculptures|monument|memorial cross|lighthouse/, "open"],
  [/museum|gallery|aquarium|\bzoo\b|zoological|wildlife park|planetarium|science cent/, "ticketed"],
  [/castle park|castle ruin/, "open"],
  [/ruins?$|archaeological site/, "daytime"],
  [/castle|palace|fortress|citadel|\bfort\b/, "ticketed"],
  [/shrine/, "daytime-open"],
  [/garden/, "daytime"],
  [/island|waterfall|canyon|cemetery/, "daytime-open"],
  [/volcano observatory/, "open"],
  [/volcano/, "daytime-open"],
  [/park|mountain|hill|lake|historic(al)? (site|settlement)/, "open"],
  [/temple|pagoda|monastery|mausoleum|church|cathedral|basilica|chapel|mosque|abbey|synagogue/, "daytime"],
];

/** Asked for every place each time a trip is planned, compared or looked up: worked out once per kind and name. */
const known = new Map<string, PlaceHabit | null>();

/** The habit by kind and name alone. */
function habitByKind(kind: string | undefined, name: string): PlaceHabit | null {
  const lowered = (kind ?? "").toLowerCase();
  if (EVENING_KIND.test(lowered) || (EVENING_NAME.test(name) && !NAMED_AFTER.test(name))) return "evening";
  if (MORNING_NAME.test(name) && !NAMED_AFTER.test(name)) return "morning";
  for (const [pattern, found] of rules) if (pattern.test(lowered)) return found;
  return null;
}

/**
 * The habit a sight's note gives it, or undefined when the note says nothing
 * the planner uses. The note wins over the kind: a mountain of night views
 * is of the evening, a palace of the first half of the day. A hotel, a shop
 * or a station is never kept for the evening by a note either.
 */
function habitByNote(id: string | undefined, kind: string | undefined, name: string): PlaceHabit | undefined {
  const hours = sightNote(id)?.hours;
  switch (hours) {
    case "morning": return "morning";
    case "early": return "early";
    case "any": return "open";
    case "evening": return NAMED_AFTER.test(name) ? undefined : "evening";
    case "day": {
      // In the daytime: with a door and a counter when the kind says so, reachable first thing when it says that.
      const byKind = habitByKind(kind, name);
      return byKind === "ticketed" || byKind === "daytime-open" ? byKind : "daytime";
    }
    default: return undefined;
  }
}

/**
 * The planner's habit for a place of this kind and name — and, for a bundled
 * sight (`id` "wikidata-Q…"), its note — or null when it has none.
 */
export function placeHabit(kind: string | undefined, name: string, id?: string): PlaceHabit | null {
  const key = `${kind ?? ""}\n${name}\n${id ?? ""}`;
  const answered = known.get(key);
  if (answered !== undefined) return answered;
  const habit = habitByNote(id, kind, name) ?? habitByKind(kind, name);
  if (known.size >= 4000) known.clear();
  known.set(key, habit);
  return habit;
}

/** Visited in the daytime: preferred to be over by about five (by about four for a place of the first half of the day). */
export const isDaytime = (habit: PlaceHabit | null | undefined) => habit === "ticketed" || habit === "daytime" || habit === "daytime-open" || habit === "early" || habit === "morning";
/** Reachable first thing in the morning. */
export const isOpenEarly = (habit: PlaceHabit | null | undefined) => habit === "open" || habit === "daytime-open" || habit === "early" || habit === "morning";
