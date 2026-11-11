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
  /** Wikimedia Commons file name of a representative photo. */
  img?: string;
  /** One-line Japanese description from Wikidata. */
  desc?: string;
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

/**
 * An index from a typed line to the one bundled sight it names.
 *
 * A name is only usable when it means one place: "王宮" is in Bangkok and in
 * Madrid, and guessing between them is exactly the mistake the network
 * lookup's region inference exists to avoid. Such names are left out and go
 * through the normal lookup.
 */
export function bundledSightIndex(destinations: readonly PopularDestination[]) {
  const byName = new Map<string, Array<{ sight: PopularSight; destination: PopularDestination }>>();
  for (const destination of destinations) {
    for (const sight of destination.sights) {
      for (const name of new Set([fold(sight.ja), fold(sight.en)])) {
        if (name.length < 2) continue;
        const entries = byName.get(name) ?? [];
        if (!entries.some((entry) => entry.sight.q === sight.q)) entries.push({ sight, destination });
        byName.set(name, entries);
      }
    }
  }
  return {
    find(line: string) {
      const entries = byName.get(fold(line));
      return entries && entries.length === 1 ? entries[0] : null;
    },
  };
}

/**
 * Where a visitor actually stands, for sights whose catalogue coordinate is
 * the middle of grounds nobody may cross. The Imperial Palace's centre is
 * closed: routed to it, walking directions fail and every leg becomes a taxi
 * around the moat. Its visit is Nijubashi and the outer garden.
 */
const VISITOR_POINT: Record<string, readonly [number, number]> = {
  Q500681: [35.6798, 139.7576],
};

const NOT_A_VISIT = /\bformer\b|demolished|destroyed|dynasty|historical (period|country|state|region)|\bera\b/;
const CONTAINER_KIND = /\bpark\b|square|plaza|neighbou?rhood|district|island|quarter/;

/**
 * The list a traveller picks from. The bundled data ranks what is well
 * known, which is not the same as what can be visited: a temple that burned
 * down in 1580 on the site of Osaka Castle, a dynasty, and the castle, its
 * park and its ruin as three stops at one spot. Those are dropped here; a
 * place already on someone's trip is unaffected.
 */
export function curateSights(sights: readonly PopularSight[]): PopularSight[] {
  const kept: PopularSight[] = [];
  for (const sight of sights) {
    if (NOT_A_VISIT.test(sight.kind.toLowerCase())) continue;
    const twin = kept.find((other) => {
      const meters = Math.hypot((sight.lat - other.lat) * 111_000, (sight.lon - other.lon) * 111_000 * Math.cos((sight.lat * Math.PI) / 180));
      if (meters > 60) return false;
      // Two real sights can share a square (a basilica and its bell tower);
      // only the same place under two names, or a place and the grounds
      // around it, count as one.
      return sight.ja.includes(other.ja) || other.ja.includes(sight.ja) || sight.en.includes(other.en) || other.en.includes(sight.en)
        || CONTAINER_KIND.test(sight.kind.toLowerCase()) || CONTAINER_KIND.test(other.kind.toLowerCase());
    });
    // A Japanese "name" that is really a description ("a museum in
    // Florence, Italy") is a bad label upstream; the English name is at
    // least the place's name.
    if (twin) continue;
    const point = VISITOR_POINT[sight.q];
    kept.push({
      ...sight,
      ...(point ? { lat: point[0], lon: point[1] } : {}),
      ...(/にある|に位置する|に所在する/.test(sight.ja) ? { ja: sight.en } : {}),
    });
  }
  return kept;
}
