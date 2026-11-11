/*
 * Pure helpers behind the "pick from a destination" control: matching a typed
 * destination, and adding or removing a sight as one line of the wishlist.
 */

export type PopularSight = {
  /** Wikidata item id. */
  q: string;
  ja: string;
  en: string;
  lat: number;
  lon: number;
  kind: string;
};

export type PopularDestination = {
  id: string;
  ja: string;
  en: string;
  lat: number;
  lon: number;
  radiusKm: number;
  sights: PopularSight[];
};

function fold(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}ー]+/gu, "");
}

/** The name a sight is written under in this locale's wishlist. */
export function sightLineName(sight: PopularSight, locale: string) {
  return (locale === "ja" ? sight.ja : sight.en).trim();
}

/**
 * Destinations matching what was typed. Nothing typed shows the featured
 * few, in the given order, rather than seventy buttons.
 */
export function filterDestinations(
  destinations: readonly PopularDestination[],
  query: string,
  featured: readonly string[],
) {
  const typed = fold(query);
  if (!typed) {
    return featured.flatMap((id) => destinations.find((destination) => destination.id === id) ?? []);
  }
  const scored = destinations.flatMap((destination) => {
    const names = [fold(destination.ja), fold(destination.en), fold(destination.id)];
    // "沖縄（那覇）" must answer to both "沖縄" and "那覇"; "広島・宮島" to either.
    const starts = names.some((name) => name.startsWith(typed));
    const contains = names.some((name) => name.includes(typed) || (name.length >= 2 && typed.includes(name)));
    return starts ? [{ destination, rank: 0 }] : contains ? [{ destination, rank: 1 }] : [];
  });
  return scored.sort((left, right) => left.rank - right.rank).map(({ destination }) => destination).slice(0, 12);
}

function lines(itinerary: string) {
  return itinerary.split("\n");
}

function lineIsSight(line: string, sight: PopularSight) {
  const folded = fold(line);
  return folded.length > 0 && (folded === fold(sight.ja) || folded === fold(sight.en));
}

/** Whether the wishlist already carries this sight as a line of its own. */
export function wishlistHasSight(itinerary: string, sight: PopularSight) {
  return lines(itinerary).some((line) => lineIsSight(line, sight));
}

/**
 * Adds the sight as a new last line, or removes the line that is exactly it.
 * A line the traveller annotated ("清水寺 必須", "金閣寺 10:00 予約") is theirs:
 * it is not an exact match, so it is never removed from here.
 */
export function toggleSightLine(itinerary: string, sight: PopularSight, locale: string) {
  if (wishlistHasSight(itinerary, sight)) {
    return lines(itinerary).filter((line) => !lineIsSight(line, sight)).join("\n");
  }
  const body = itinerary.replace(/\s+$/, "");
  return `${body}${body ? "\n" : ""}${sightLineName(sight, locale)}\n`;
}
