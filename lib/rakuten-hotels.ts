/*
 * Rakuten Travel listing facts (reference lowest price, review score, page
 * link) for hotels near a point. Purely additive evidence: Google remains the
 * source of the candidates themselves; a Rakuten fact attaches only when the
 * name and location clearly match, and prices are labeled as the listing's
 * reference minimum, never a live quote.
 */

export type RakutenHotelFact = {
  hotelName: string;
  minCharge: number | null;
  reviewAverage: number | null;
  reviewCount: number | null;
  url: string;
  latitude: number;
  longitude: number;
};

const searchCache = new Map<string, { expiresAt: number; facts: RakutenHotelFact[] }>();
const cacheTtlMs = 30 * 60 * 1000;
const maxCacheEntries = 256;
const totalRequestDeadlineMs = 2_500;
const allowedHotelLinkHosts = new Set([
  "travel.rakuten.co.jp",
  "hb.afl.rakuten.co.jp",
]);
let requestTail: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

export function buildRakutenSearchUrl(applicationId: string, latitude: number, longitude: number) {
  const params = new URLSearchParams({
    applicationId,
    format: "json",
    latitude: String(latitude),
    longitude: String(longitude),
    searchRadius: "3",
    datumType: "1",
    hits: "30",
    sort: "standard",
    elements: "hotelName,hotelMinCharge,reviewAverage,reviewCount,hotelInformationUrl,latitude,longitude",
  });
  return `https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20260731?${params.toString()}`;
}

type RakutenPayload = {
  hotels?: Array<{
    hotel?: Array<{
      hotelBasicInfo?: {
        hotelName?: unknown;
        hotelMinCharge?: unknown;
        reviewAverage?: unknown;
        reviewCount?: unknown;
        hotelInformationUrl?: unknown;
        latitude?: unknown;
        longitude?: unknown;
      };
    }>;
  }>;
};

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function safeHotelInformationUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:"
      || url.port !== ""
      || url.username !== ""
      || url.password !== ""
      || !allowedHotelLinkHosts.has(url.hostname.toLocaleLowerCase())
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseRakutenHotels(payload: RakutenPayload): RakutenHotelFact[] {
  return (payload.hotels ?? []).flatMap((entry) => {
    const info = entry.hotel?.[0]?.hotelBasicInfo;
    const name = typeof info?.hotelName === "string" ? info.hotelName.trim() : "";
    const url = safeHotelInformationUrl(info?.hotelInformationUrl);
    const latitude = positiveNumber(info?.latitude);
    const longitude = positiveNumber(info?.longitude);
    if (!name || url === null || latitude === null || longitude === null) return [];
    return [{
      hotelName: name,
      minCharge: positiveNumber(info?.hotelMinCharge),
      reviewAverage: positiveNumber(info?.reviewAverage),
      reviewCount: positiveNumber(info?.reviewCount),
      url,
      latitude,
      longitude,
    }];
  });
}

function normalizedName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function roughDistanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const latMeters = (aLat - bLat) * 111_000;
  const lngMeters = (aLng - bLng) * 91_000;
  return Math.sqrt(latMeters * latMeters + lngMeters * lngMeters);
}

/*
 * A fact attaches only when it is clearly the same building: matching name
 * fragments within 400 m, or a near-exact coordinate hit. Anything looser
 * would risk pinning one hotel's price onto another.
 */
export function matchRakutenFact(
  candidate: { name: string; latitude: number; longitude: number },
  facts: RakutenHotelFact[],
): RakutenHotelFact | null {
  const candidateName = normalizedName(candidate.name);
  let best: { fact: RakutenHotelFact; distance: number } | null = null;
  for (const fact of facts) {
    const distance = roughDistanceMeters(candidate.latitude, candidate.longitude, fact.latitude, fact.longitude);
    const factName = normalizedName(fact.hotelName);
    const namesOverlap = candidateName.length >= 4 && factName.length >= 4
      && (candidateName.includes(factName) || factName.includes(candidateName));
    const matches = (namesOverlap && distance <= 400) || distance <= 80;
    if (matches && (best === null || distance < best.distance)) best = { fact, distance };
  }
  return best?.fact ?? null;
}

function deadlineError() {
  return new Error("rakuten_timeout");
}

function remainingDeadlineMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = remainingDeadlineMs(deadline);
  if (remaining <= 0) throw deadlineError();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(deadlineError()), remaining);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function fetchRakutenHotelFacts(
  latitude: number,
  longitude: number,
  applicationId: string,
  accessKey: string,
  fetcher: typeof fetch = fetch,
): Promise<RakutenHotelFact[]> {
  const deadline = Date.now() + totalRequestDeadlineMs;
  const cacheKey = `${latitude.toFixed(3)}|${longitude.toFixed(3)}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.facts;

  // Rakuten's published limit is one request per second per application id.
  // A short in-isolate queue prevents a burst from nightly-hotel comparisons;
  // the cache avoids repeating the same nearby search altogether.
  let release!: () => void;
  const previous = requestTail.catch(() => undefined);
  const ownTurn = new Promise<void>((resolve) => { release = resolve; });
  // Keep this turn chained behind its predecessor even if this caller reaches
  // its deadline while waiting. Resolving ownTurn in finally then lets all
  // later callers advance once the predecessor itself has finished.
  requestTail = previous.then(() => ownTurn);

  try {
    await beforeDeadline(previous, deadline);
    const filledWhileQueued = searchCache.get(cacheKey);
    if (filledWhileQueued && filledWhileQueued.expiresAt > Date.now()) return filledWhileQueued.facts;

    const waitMs = Math.max(0, 1_000 - (Date.now() - lastRequestStartedAt));
    if (waitMs > 0) {
      await beforeDeadline(new Promise<void>((resolve) => setTimeout(resolve, waitMs)), deadline);
    }
    lastRequestStartedAt = Date.now();

    const fetchTimeoutMs = Math.max(1, Math.ceil(remainingDeadlineMs(deadline)));
    const facts = await beforeDeadline((async () => {
      const response = await fetcher(buildRakutenSearchUrl(applicationId, latitude, longitude), {
        headers: { accessKey },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (!response.ok) throw new Error("rakuten_unavailable");
      return parseRakutenHotels(await response.json() as RakutenPayload);
    })(), deadline);
    const now = Date.now();
    for (const [key, entry] of searchCache) if (entry.expiresAt <= now) searchCache.delete(key);
    while (searchCache.size >= maxCacheEntries) searchCache.delete(searchCache.keys().next().value as string);
    searchCache.set(cacheKey, { expiresAt: now + cacheTtlMs, facts });
    return facts;
  } finally {
    release();
  }
}
