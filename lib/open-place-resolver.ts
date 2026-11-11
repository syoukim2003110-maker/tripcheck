import {
  destinationById,
  destinationForCoordinate,
  withinBounds,
  type Destination,
} from "./destinations.ts";
import {
  areaFromAddress,
  type AmbiguousPlaceResolution,
  type PlaceResolutionRequest,
} from "./google-place-resolver.ts";
import { NominatimPlaceResolver } from "./nominatim-place-resolver.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { estimateStayMinutes } from "./stay-estimates.ts";

/*
 * Keyless place resolution.
 *
 * One public geocoder is not enough to turn a traveller's wishlist into pins:
 * Nominatim does not know that 「ビクトリアピーク」 is Victoria Peak, and a bare
 * name search has no idea the other seven lines are all in Hong Kong. This
 * resolver asks two complementary free sources and lets the wishlist itself
 * say where the trip is:
 *
 *   1. Wikipedia full-text search — famous sights under the names travellers
 *      actually type, in their own language, with coordinates.
 *   2. Wikidata — the same sights under every label and alias they have in
 *      any language ("金閣寺" is an alias of 鹿苑寺), plus many that have no
 *      article in the traveller's language.
 *      Photon (OpenStreetMap) joins when it is reachable; the public
 *      instance throttles hard, so nothing may depend on it.
 *   3. The region most of the confident answers agree on, which then biases
 *      a second look at whatever is still missing or contested.
 *   4. Nominatim, strictly one request per second, only for the leftovers.
 *
 * Nothing here is AI and nothing is guessed: an input with no convincing
 * candidate stays unresolved, and two convincing candidates in different
 * places go back to the traveller.
 */

export const OPEN_PLACE_ATTRIBUTION = Object.freeze({
  label: "© OpenStreetMap contributors · Wikipedia",
  url: "https://www.openstreetmap.org/copyright",
});

const REGION_RADIUS_KM = 150;
/** A city-scale trip: inside this, a candidate is plainly "in the trip". */
const REGION_CORE_KM = 25;
/** Where the in-trip credit has faded to nothing. */
const REGION_FADE_KM = 120;
/** Below this a candidate is not even worth showing as a "did you mean". */
const SHORTLIST_SIMILARITY = 0.45;
const SAME_PLACE_KM = 0.6;
const STRONG_SIMILARITY = 0.8;
const USABLE_SIMILARITY = 0.55;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const CACHE_ENTRIES = 1_500;
const REQUEST_TIMEOUT_MS = 4_500;
/** A host that refused or timed out is left alone for this long. */
const HOST_COOLDOWN_MS = 5 * 60 * 1_000;
const INPUT_CONCURRENCY = 4;
const DEFAULT_CONTACT_URL = "https://github.com/syoukim2003110-maker/tripcheck";

type CandidateSource = "wikipedia" | "wikidata" | "photon" | "nominatim" | "maps";

type Candidate = {
  source: CandidateSource;
  stop: ResolvedInputStop;
  /** 0..1 textual agreement between what was typed and what was found. */
  similarity: number;
  /** Position in the provider's own ranking, 0 first. */
  rank: number;
  /** 0..1 prior that this kind of map object is something a traveller visits. */
  visitWeight: number;
  /** Other sources that returned the same spot. */
  corroborated: boolean;
  /** 0..1 notability: article length or number of language editions. */
  prominence: number;
  wikidataId?: string;
};

type Region = { latitude: number; longitude: number; countryCode?: string };

/** One result from a quota-metered maps search (Apple Maps Server API). */
export type MapsSearchPlace = Readonly<{
  id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  area: string | null;
  countryCode: string | null;
  category: string | null;
}>;

/**
 * Optional maps search the deployment may plug in. It is metered by a daily
 * quota, so the resolver only asks it about lines the open sources could not
 * settle. `null` means "could not answer", an empty array "nothing found".
 */
export type MapsPlaceSearch = (
  input: string,
  languageCode: "en" | "ja",
  near: { latitude: number; longitude: number } | null,
  signal?: AbortSignal,
) => Promise<MapsSearchPlace[] | null>;

const mapsCategoryTypes: Record<string, string> = {
  religioussite: "place_of_worship",
  landmark: "landmark",
  theater: "performing_arts_theater",
  musicvenue: "concert_hall",
  store: "store",
  foodmarket: "food_market",
  hotel: "lodging",
  nationalmonument: "monument",
  fairground: "amusement_park",
};

function mapsPlaceTypes(category: string | null) {
  if (!category) return [];
  const snake = category.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLocaleLowerCase("en-US");
  return [mapsCategoryTypes[category.toLocaleLowerCase("en-US")] ?? snake];
}

export type OpenPlaceResolverOptions = Partial<{
  fetcher: typeof fetch;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
  nominatim: Pick<NominatimPlaceResolver, "search"> | null;
  userAgent: string;
  /** Minimum spacing between requests to one host. Tests set this to 0. */
  hostIntervalMs: number;
  /**
   * Running inside a web page rather than on a server. A page may not set
   * User-Agent (it would turn every lookup into a CORS preflight) and must
   * ask the Wikimedia APIs for anonymous cross-origin access explicitly.
   */
  browser: boolean;
}>;

/* ------------------------------------------------------------------ text */

/**
 * Folds the spelling differences that separate what a traveller types from a
 * gazetteer's headword: width, case, punctuation, the long-vowel mark, the
 * ヴ-row, and a trailing disambiguator such as 「(香港)」.
 */
/*
 * The same character is drawn differently in Japanese, Traditional Chinese
 * and Simplified Chinese ("黄大仙祠" / "黃大仙祠", "天壇" / "天坛"). A traveller
 * typing the Japanese form must still match the local map label. This is the
 * set that actually shows up in place names, not a general converter.
 */
const hanVariantGroups = [
  "黄黃", "広廣广", "国國", "楽樂乐", "関關关", "竜龍龙", "鉄鐵铁", "湾灣", "台臺颱", "門门", "東东", "華华",
  "園园", "島岛嶋", "橋桥", "館馆", "場场", "区區", "廟庙", "壇坛", "仏佛", "鳥鸟", "馬马", "観觀观", "沢澤泽",
  "浜濱滨", "駅驛站", "桜櫻樱", "塩鹽盐", "県縣县", "歴歷历", "験驗验", "鎮镇", "銀银", "閣阁", "宮宫", "陽阳",
  "陰阴", "長长", "風风", "雲云", "海", "児兒儿", "図圖图", "絵繪绘", "芸藝艺", "医醫", "学學", "会會", "万萬",
  "与與", "両兩两", "亜亞亚", "仮假", "伝傳传", "価價价", "倹儉俭", "円圓圆", "処處处", "剣劍剑", "労勞劳",
  "勧勸劝", "単單单", "厳嚴严", "参參", "収收", "営營营", "団團团", "囲圍围", "圧壓压", "塁壘垒", "増增",
  "壊壞坏", "声聲", "変變变", "実實实", "寛寬宽", "対對对", "専專专", "将將将", "尽盡尽", "届屆", "岳嶽",
  "峡峽峡", "巣巢", "帯帶带", "庁廳厅", "応應应", "徳德", "恵惠", "戦戰战", "戯戲戏", "挙擧举", "斎齋斋",
  "旧舊旧", "昼晝昼", "暁曉晓", "条條条", "来來", "栄榮荣", "検檢检", "楼樓楼", "権權权", "横橫", "歓歡欢",
  "気氣气", "汚污", "満滿满", "滝瀧泷", "漢漢汉", "灯燈", "炉爐炉", "点點点", "焼燒烧", "犠犧牺", "猟獵猎",
  "獣獸兽", "産產产", "画畫画", "発發发", "真眞", "稲稻", "穂穗", "総總总", "経經经", "継繼继", "続續续",
  "緑綠绿", "縄繩绳", "聴聽听", "荘莊庄", "蔵藏", "薬藥药", "虫蟲", "蛍螢萤", "衆眾众", "覧覽览", "覚覺觉",
  "訳譯译", "読讀读", "豊豐丰", "賛贊赞", "転轉转", "軽輕轻", "辺邊边", "逓遞递", "遅遲迟", "郷鄉乡", "酔醉",
  "釈釋释", "銭錢钱", "鋳鑄铸", "関關关", "険險险", "陥陷", "雑雜杂", "霊靈灵", "顕顯显", "駆驅驱", "騒騷骚",
  "髪髮发", "鶏鷄鸡", "麦麥麦", "黒黑", "斉齊齐", "歯齒齿", "亀龜龟", "齢齡龄", "塔", "湖", "頭头", "車车",
  "貝贝", "見见", "記记", "語语", "請请", "軍军", "運运", "達达", "遠远", "郵邮", "鐘钟", "開开", "間间",
  "陳陈", "陸陆", "隊队", "雙双", "電电", "韓韩", "順顺", "飛飞", "飯饭", "魚鱼", "麗丽", "龍龙竜",
];
const hanVariantFold = new Map<string, string>();
for (const group of hanVariantGroups) {
  const [canonical, ...variants] = [...group];
  for (const variant of variants) if (!hanVariantFold.has(variant)) hanVariantFold.set(variant, canonical);
}

export function foldPlaceName(value: string) {
  return [...value.normalize("NFKC")]
    .map((character) => hanVariantFold.get(character) ?? character)
    .join("")
    .toLocaleLowerCase()
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/ヴァ/g, "バ")
    .replace(/ヴィ/g, "ビ")
    .replace(/ヴェ/g, "ベ")
    .replace(/ヴォ/g, "ボ")
    .replace(/ヴ/g, "ブ")
    .replace(/[\s\p{P}\p{S}ー]+/gu, "");
}

function bigrams(value: string) {
  const characters = [...value];
  if (characters.length < 2) return characters;
  return characters.slice(1).map((character, index) => characters[index] + character);
}

function diceCoefficient(left: string, right: string) {
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  if (leftGrams.length === 0 || rightGrams.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const gram of rightGrams) remaining.set(gram, (remaining.get(gram) ?? 0) + 1);
  let shared = 0;
  for (const gram of leftGrams) {
    const count = remaining.get(gram) ?? 0;
    if (count > 0) {
      shared += 1;
      remaining.set(gram, count - 1);
    }
  }
  return (2 * shared) / (leftGrams.length + rightGrams.length);
}

function foldedSimilarity(input: string, name: string) {
  if (!input || !name) return 0;
  if (input === name) return 1;
  if (name.includes(input) || input.includes(name)) {
    const shorter = Math.min([...input].length, [...name].length);
    const longer = Math.max([...input].length, [...name].length);
    // A one-character overlap ("塔" inside "エッフェル塔") is not agreement.
    if (shorter < 2) return 0.2;
    return 0.6 + 0.35 * (shorter / longer);
  }
  return 0.9 * diceCoefficient(input, name);
}

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * OpenStreetMap often stores a bilingual name ("女人街 Ladies Market"). Each
 * script is a complete name on its own, so the typed text is compared with
 * the whole label and with each half.
 */
export function placeNameSimilarity(input: string, name: string) {
  const foldedInput = foldPlaceName(input);
  const whole = foldedSimilarity(foldedInput, foldPlaceName(name));
  const characters = [...name.normalize("NFKC")];
  const cjkHalf = characters.filter((character) => cjkPattern.test(character) || /[\s\dー・]/.test(character)).join("");
  const otherHalf = characters.filter((character) => !cjkPattern.test(character) && character !== "ー" && character !== "・").join("");
  const halves = [cjkHalf, otherHalf]
    .map(foldPlaceName)
    .filter((half) => half.length >= 2 && half !== foldPlaceName(name));
  return Math.max(whole, ...halves.map((half) => foldedSimilarity(foldedInput, half)));
}

/**
 * "Notre-Dame fire", 「金閣寺放火事件」, 「渋谷駅」: an article *about* the
 * place, or the station named after it, is not the place the traveller typed.
 */
function isDerivativeArticle(input: string, title: string) {
  const derivative = /(?:事件|事故|放火|火災|地震|の戦い|駅|停留場|大学|\buniversity\b|\bfire\b|\bincident\b|\battack\b|\bbombing\b|\bstation\b|\bdisaster\b)/i;
  return derivative.test(title) && !derivative.test(input);
}

/* ------------------------------------------------------------- geometry */

function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const h = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    // (0, 0) is the classic "no coordinate" sentinel, not a destination.
    && !(latitude === 0 && longitude === 0);
}

function profileCountryCode(latitude: number, longitude: number, fallback?: string) {
  const profile = destinationForCoordinate(latitude, longitude);
  // Only a single-country profile names a country; a regional profile such as
  // "Southeast Asia" must not relabel Thailand as Vietnam.
  if (profile && profile.countryCodes.length === 1) return profile.countryCodes[0];
  const code = fallback?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/* ------------------------------------------------------------ transport */

class HostGate {
  private queue: Promise<void> = Promise.resolve();
  private nextStartAt = 0;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(intervalMs: number, now: () => number, sleep: (delayMs: number) => Promise<void>) {
    this.intervalMs = intervalMs;
    this.now = now;
    this.sleep = sleep;
  }

  async turn<T>(operation: () => Promise<T>) {
    let release = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = this.nextStartAt - this.now();
      if (wait > 0) await this.sleep(wait);
      this.nextStartAt = this.now() + this.intervalMs;
    } finally {
      // Only the *start* is serialized; responses may overlap.
      release();
    }
    return operation();
  }
}

type WikipediaSearchHit = { pageid?: number; title?: string; redirecttitle?: string };
type WikipediaPage = {
  pageid?: number;
  title?: string;
  description?: string;
  length?: number;
  coordinates?: Array<{ lat?: number; lon?: number; primary?: boolean; globe?: string; country?: string }>;
  pageprops?: { wikibase_item?: string; disambiguation?: string };
};
type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number | string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    country?: string;
    countrycode?: string;
    state?: string;
    county?: string;
    city?: string;
    district?: string;
    locality?: string;
    street?: string;
    housenumber?: string;
  };
};

const visitKeys = new Set(["tourism", "historic", "leisure", "natural", "place", "railway", "aeroway", "boundary", "waterway", "man_made"]);
const visitValues = new Set([
  "place_of_worship", "marketplace", "theatre", "cinema", "arts_centre", "ferry_terminal", "restaurant", "cafe",
  "bar", "pub", "fast_food", "food_court", "library", "townhall", "fountain", "mall", "department_store",
  "station", "aerodrome", "pedestrian",
]);
const lowVisitValues = new Set([
  "apartments", "residential", "house", "office", "company", "bus_stop", "parking", "school", "kindergarten",
  "hospital", "clinic", "insurance", "estate_agent", "industrial", "warehouse",
]);

function photonVisitWeight(properties: NonNullable<PhotonFeature["properties"]>) {
  const key = properties.osm_key ?? "";
  const value = properties.osm_value ?? "";
  if (lowVisitValues.has(value)) return 0;
  if (visitKeys.has(key) || visitValues.has(value)) return 1;
  if (key === "highway") return value === "pedestrian" || value === "footway" ? 0.7 : 0.3;
  return 0.5;
}

function photonAddress(properties: NonNullable<PhotonFeature["properties"]>, name: string) {
  const street = [properties.street, properties.housenumber].filter(Boolean).join(" ");
  const parts = [name, street, properties.locality, properties.district, properties.city, properties.county, properties.state, properties.country]
    .flatMap((part) => typeof part === "string" && part.trim() ? [part.trim()] : []);
  return [...new Set(parts)].join(", ");
}

function photonArea(properties: NonNullable<PhotonFeature["properties"]>) {
  return [properties.district, properties.locality, properties.city, properties.county, properties.state]
    .find((part): part is string => typeof part === "string" && part.trim().length > 0)?.trim();
}

function wikipediaLanguages(input: string, languageCode: "en" | "ja") {
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(input);
  const hasHan = /\p{Script=Han}/u.test(input);
  const hasHangul = /\p{Script=Hangul}/u.test(input);
  if (hasKana) return ["ja"];
  if (hasHangul) return ["ko", languageCode];
  // Han-only text is as likely a Chinese headword as a Japanese one.
  if (hasHan) return languageCode === "ja" ? ["ja", "zh"] : ["zh", "ja"];
  return languageCode === "ja" ? ["en", "ja"] : ["en"];
}

/* -------------------------------------------------------------- resolver */

export class OpenPlaceResolver {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly nominatim: Pick<NominatimPlaceResolver, "search"> | null;
  private readonly userAgent: string;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly gates = new Map<string, HostGate>();
  private readonly hostDownUntil = new Map<string, number>();
  private readonly hostIntervalMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly browser: boolean;

  constructor(options: OpenPlaceResolverOptions = {}) {
    this.browser = options.browser ?? (typeof window !== "undefined" && typeof document !== "undefined");
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.nominatim = options.nominatim === undefined ? new NominatimPlaceResolver({
      fetcher: this.fetcher,
      now: this.now,
      sleep: this.sleep,
      browser: this.browser,
    }) : options.nominatim;
    this.hostIntervalMs = Math.max(0, Math.floor(options.hostIntervalMs ?? 80));
    this.userAgent = (options.userAgent ?? this.defaultUserAgent()).replace(/[\r\n]+/g, " ").trim().slice(0, 256);
  }

  private defaultUserAgent() {
    const environment: Record<string, string | undefined> = typeof process !== "undefined" && process.env ? process.env : {};
    const explicit = (environment.TRIPCHECK_NOMINATIM_USER_AGENT ?? "").replace(/[\r\n]+/g, " ").trim();
    if (explicit) return explicit;
    let contact = DEFAULT_CONTACT_URL;
    try {
      const publicOrigin = environment.TRIPCHECK_PUBLIC_ORIGIN?.trim();
      if (publicOrigin) contact = new URL(publicOrigin).origin;
    } catch {
      // A malformed origin must not produce an invalid header.
    }
    return `TripCheck/0.1 (+${contact})`;
  }

  /** Cached GET. A failure is `null`, never an exception: one source being down must not sink the others. */
  private async getJson(url: URL, signal?: AbortSignal): Promise<unknown | null> {
    if (this.browser && /(?:^|\.)(?:wikipedia|wikidata)\.org$/.test(url.host) && url.host !== "query.wikidata.org") {
      url.searchParams.set("origin", "*");
    }
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    if ((this.hostDownUntil.get(url.host) ?? 0) > this.now()) return null;
    let gate = this.gates.get(url.host);
    if (!gate) {
      gate = new HostGate(this.hostIntervalMs, this.now, this.sleep);
      this.gates.set(url.host, gate);
    }
    try {
      const value = await gate.turn(async () => {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const response = await this.fetcher(url, {
          method: "GET",
          headers: this.browser
            ? { Accept: "application/json" }
            : { Accept: "application/json", "User-Agent": this.userAgent },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) {
          if (response.status === 429 || response.status === 403 || response.status >= 500) {
            this.hostDownUntil.set(url.host, this.now() + HOST_COOLDOWN_MS);
          }
          return null;
        }
        return await response.json() as unknown;
      });
      if (value === null) return null;
      this.cache.set(key, { expiresAt: this.now() + CACHE_TTL_MS, value });
      while (this.cache.size > CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (typeof oldest !== "string") break;
        this.cache.delete(oldest);
      }
      return value;
    } catch {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("request_aborted");
      // Refused, reset or timed out: stop spending every later lookup's
      // time budget on a host that is not answering.
      this.hostDownUntil.set(url.host, this.now() + HOST_COOLDOWN_MS);
      return null;
    }
  }

  private async wikipediaCandidates(
    input: string,
    language: string,
    near: Region | null,
    signal?: AbortSignal,
  ): Promise<Candidate[] | null> {
    const origin = `https://${language}.wikipedia.org`;
    const search = new URL(`${origin}/w/api.php`);
    search.searchParams.set("action", "query");
    search.searchParams.set("list", "search");
    search.searchParams.set(
      "srsearch",
      near ? `${input} nearcoord:${REGION_RADIUS_KM}km,${near.latitude.toFixed(3)},${near.longitude.toFixed(3)}` : input,
    );
    search.searchParams.set("srlimit", "6");
    search.searchParams.set("srprop", "redirecttitle");
    search.searchParams.set("format", "json");
    search.searchParams.set("formatversion", "2");
    const searchPayload = await this.getJson(search, signal) as { query?: { search?: WikipediaSearchHit[] } } | null;
    if (!searchPayload) return null;
    const hits = (searchPayload.query?.search ?? []).filter((hit) => (
      typeof hit.pageid === "number" && typeof hit.title === "string"
    ));
    if (hits.length === 0) return [];

    const pages = new URL(`${origin}/w/api.php`);
    pages.searchParams.set("action", "query");
    pages.searchParams.set("pageids", hits.map((hit) => hit.pageid).join("|"));
    pages.searchParams.set("prop", "coordinates|pageprops|description|info");
    pages.searchParams.set("colimit", "max");
    pages.searchParams.set("coprop", "country");
    pages.searchParams.set("ppprop", "wikibase_item|disambiguation");
    pages.searchParams.set("format", "json");
    pages.searchParams.set("formatversion", "2");
    const pagePayload = await this.getJson(pages, signal) as { query?: { pages?: WikipediaPage[] } } | null;
    if (!pagePayload) return null;
    const pageById = new Map((pagePayload.query?.pages ?? []).map((page) => [page.pageid, page]));
    const verifiedAt = new Date(this.now()).toISOString();

    const candidates: Candidate[] = [];
    for (const [rank, hit] of hits.entries()) {
      const page = pageById.get(hit.pageid);
      if (!page || page.pageprops?.disambiguation !== undefined) continue;
      const title = hit.title!.trim();
      const similarity = Math.max(
        placeNameSimilarity(input, title),
        hit.redirecttitle ? placeNameSimilarity(input, hit.redirecttitle) : 0,
      ) * (isDerivativeArticle(input, title) ? 0.7 : 1);
      const coordinate = (page.coordinates ?? []).find((entry) => entry.primary !== false && (entry.globe ?? "earth") === "earth")
        ?? page.coordinates?.[0];
      let latitude = Number(coordinate?.lat);
      let longitude = Number(coordinate?.lon);
      if (!validCoordinate(latitude, longitude)) {
        // Many Japanese articles carry no coordinate template although the
        // linked Wikidata item does. Only worth a request for a real match.
        if (similarity < USABLE_SIMILARITY) continue;
        const item = page.pageprops?.wikibase_item;
        const located = item ? await this.wikidataCoordinate(item, signal) : null;
        if (!located) continue;
        latitude = located.latitude;
        longitude = located.longitude;
      }
      const name = title.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim() || title;
      const description = page.description?.trim() ?? "";
      const countryCode = profileCountryCode(latitude, longitude, coordinate?.country);
      const item = page.pageprops?.wikibase_item;
      candidates.push({
        source: "wikipedia",
        similarity,
        rank,
        visitWeight: 1,
        corroborated: false,
        // ~2 kB stub → 0, ~100 kB feature article → 1.
        prominence: Math.min(1, Math.max(0, (Math.log10(Math.max(1, page.length ?? 0)) - 3.3) / 1.7)),
        ...(item && /^Q\d{1,12}$/.test(item) ? { wikidataId: item } : {}),
        stop: {
          id: `wikipedia-${language}-${hit.pageid}`,
          input,
          name,
          area: "",
          address: description,
          ...(countryCode ? { countryCode } : {}),
          latitude,
          longitude,
          sourceUrl: `${origin}/?curid=${hit.pageid}`,
          verifiedAt,
          confidence: "medium",
          planningDurationMinutes: estimateStayMinutes(`${input} ${name}`, [], 90),
          isAnchor: false,
          placeTypes: [],
        },
      });
    }
    return candidates;
  }

  private async wikidataCandidates(
    input: string,
    languageCode: "en" | "ja",
    near: Region | null,
    signal?: AbortSignal,
  ): Promise<Candidate[] | null> {
    const api = "https://www.wikidata.org/w/api.php";
    const search = new URL(api);
    search.searchParams.set("action", "query");
    search.searchParams.set("generator", "search");
    search.searchParams.set(
      "gsrsearch",
      `${input} haswbstatement:P625${near ? ` nearcoord:${REGION_RADIUS_KM}km,${near.latitude.toFixed(3)},${near.longitude.toFixed(3)}` : ""}`,
    );
    search.searchParams.set("gsrlimit", "6");
    search.searchParams.set("prop", "coordinates");
    search.searchParams.set("colimit", "max");
    search.searchParams.set("format", "json");
    search.searchParams.set("formatversion", "2");
    const searchPayload = await this.getJson(search, signal) as {
      query?: { pages?: Array<{ title?: string; index?: number; coordinates?: Array<{ lat?: number; lon?: number; globe?: string }> }> };
    } | null;
    if (!searchPayload) return null;
    const hits = (searchPayload.query?.pages ?? [])
      .filter((page) => typeof page.title === "string" && /^Q\d{1,12}$/.test(page.title))
      .sort((left, right) => (left.index ?? 99) - (right.index ?? 99));
    if (hits.length === 0) return [];

    const languages = [...new Set([languageCode, "ja", "en", "zh", "zh-hant", "zh-hk", "zh-tw", "ko"])];
    const entities = new URL(api);
    entities.searchParams.set("action", "wbgetentities");
    entities.searchParams.set("ids", hits.map((hit) => hit.title).join("|"));
    entities.searchParams.set("props", "labels|aliases|descriptions|sitelinks");
    entities.searchParams.set("languages", languages.join("|"));
    entities.searchParams.set("format", "json");
    type Term = { value?: string };
    const entityPayload = await this.getJson(entities, signal) as {
      entities?: Record<string, {
        labels?: Record<string, Term>;
        aliases?: Record<string, Term[]>;
        descriptions?: Record<string, Term>;
        sitelinks?: Record<string, unknown>;
      }>;
    } | null;
    if (!entityPayload) return null;
    const verifiedAt = new Date(this.now()).toISOString();

    return hits.flatMap((hit, rank): Candidate[] => {
      const id = hit.title!;
      const entity = entityPayload.entities?.[id];
      const coordinate = (hit.coordinates ?? []).find((entry) => (entry.globe ?? "earth") === "earth");
      const latitude = Number(coordinate?.lat);
      const longitude = Number(coordinate?.lon);
      if (!entity || !validCoordinate(latitude, longitude)) return [];
      const names = languages.flatMap((language) => [
        entity.labels?.[language]?.value,
        ...(entity.aliases?.[language] ?? []).map((alias) => alias.value),
      ]).flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []);
      // A sight the traveller named by a well-known alias keeps that name on
      // the itinerary: they typed 金閣寺, not its formal headword 鹿苑寺.
      const typedAlias = names.find((candidate) => foldPlaceName(candidate) === foldPlaceName(input));
      const name = typedAlias
        ?? entity.labels?.[languageCode]?.value?.trim()
        ?? entity.labels?.en?.value?.trim()
        ?? names[0];
      if (!name) return [];
      const derivative = isDerivativeArticle(input, name) || isDerivativeArticle(input, entity.labels?.en?.value ?? "");
      const textual = Math.max(0, ...names.map((candidate) => placeNameSimilarity(input, candidate)))
        * (derivative ? 0.7 : 1);
      // The search matched *some* label in *some* language even when none of
      // the fetched ones looks like the input ("尖沙咀プロムナード" finds the
      // promenade through a label this request did not ask for). That is
      // worth a visible low-confidence pin, never a confident one.
      const similarity = derivative ? textual : Math.max(textual, rank === 0 ? 0.6 : 0.5);
      const description = entity.descriptions?.[languageCode]?.value?.trim()
        ?? entity.descriptions?.en?.value?.trim()
        ?? "";
      const countryCode = profileCountryCode(latitude, longitude);
      const sitelinks = Object.keys(entity.sitelinks ?? {}).length;
      return [{
        source: "wikidata",
        similarity,
        rank,
        visitWeight: 1,
        corroborated: false,
        prominence: Math.min(1, Math.log10(1 + sitelinks) / 2),
        wikidataId: id,
        stop: {
          id: `wikidata-${id}`,
          input,
          name,
          area: "",
          address: description,
          ...(countryCode ? { countryCode } : {}),
          latitude,
          longitude,
          sourceUrl: `https://www.wikidata.org/wiki/${id}`,
          verifiedAt,
          confidence: "medium",
          planningDurationMinutes: estimateStayMinutes(`${input} ${name}`, [], 90),
          isAnchor: false,
          placeTypes: [],
        },
      }];
    });
  }

  /**
   * One batched question for the whole trip: which district is each pin in,
   * and which country. Encyclopedia pins arrive with neither.
   */
  private async wikidataLocality(ids: string[], languageCode: "en" | "ja", signal?: AbortSignal) {
    const result = new Map<string, { area?: string; countryCode?: string; kinds: string[] }>();
    const valid = [...new Set(ids.filter((id) => /^Q\d{1,12}$/.test(id)))].slice(0, 60);
    if (valid.length === 0) return result;
    const url = new URL("https://query.wikidata.org/sparql");
    url.searchParams.set("query", [
      "SELECT ?item ?adminLabel ?iso ?kindName WHERE {",
      `VALUES ?item { ${valid.map((id) => `wd:${id}`).join(" ")} }`,
      "OPTIONAL { ?item wdt:P131 ?admin }",
      "OPTIONAL { ?item wdt:P17 ?country . ?country wdt:P297 ?iso }",
      "OPTIONAL { ?item wdt:P31 ?kind . ?kind rdfs:label ?kindName . FILTER(LANG(?kindName) = \"en\") }",
      `SERVICE wikibase:label { bd:serviceParam wikibase:language "${languageCode === "ja" ? "ja,en" : "en"}". }`,
      "}",
    ].join(" "));
    url.searchParams.set("format", "json");
    const payload = await this.getJson(url, signal) as {
      results?: { bindings?: Array<{
        item?: { value?: string };
        adminLabel?: { value?: string };
        iso?: { value?: string };
        kindName?: { value?: string };
      }> };
    } | null;
    for (const binding of payload?.results?.bindings ?? []) {
      const id = binding.item?.value?.split("/").at(-1);
      if (!id) continue;
      const entry = result.get(id) ?? { kinds: [] };
      const kind = binding.kindName?.value?.trim().toLocaleLowerCase("en-US");
      if (kind && !entry.kinds.includes(kind)) entry.kinds.push(kind);
      const area = binding.adminLabel?.value?.trim();
      // An unlabelled administrative unit comes back as its bare Q-id.
      if (area && !/^Q\d+$/.test(area) && !entry.area) entry.area = area;
      const iso = binding.iso?.value?.trim().toUpperCase();
      if (iso && /^[A-Z]{2}$/.test(iso) && !entry.countryCode) entry.countryCode = iso;
      result.set(id, entry);
    }
    return result;
  }

  private async wikidataCoordinate(item: string, signal?: AbortSignal) {
    if (!/^Q\d{1,12}$/.test(item)) return null;
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetclaims");
    url.searchParams.set("entity", item);
    url.searchParams.set("property", "P625");
    url.searchParams.set("format", "json");
    const payload = await this.getJson(url, signal) as {
      claims?: { P625?: Array<{ mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number; globe?: string } } } }> };
    } | null;
    const value = payload?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    const latitude = Number(value?.latitude);
    const longitude = Number(value?.longitude);
    if (!validCoordinate(latitude, longitude)) return null;
    if (value?.globe && !value.globe.endsWith("/Q2")) return null;
    return { latitude, longitude };
  }

  private async photonCandidates(
    input: string,
    near: Region | null,
    signal?: AbortSignal,
  ): Promise<Candidate[] | null> {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", input);
    url.searchParams.set("limit", "6");
    if (near) {
      url.searchParams.set("lat", near.latitude.toFixed(3));
      url.searchParams.set("lon", near.longitude.toFixed(3));
      url.searchParams.set("zoom", "9");
      url.searchParams.set("location_bias_scale", "0.6");
    }
    const payload = await this.getJson(url, signal) as { features?: PhotonFeature[] } | null;
    if (!payload) return null;
    const verifiedAt = new Date(this.now()).toISOString();
    return (payload.features ?? []).flatMap((feature, rank): Candidate[] => {
      const properties = feature.properties;
      const longitude = Number(feature.geometry?.coordinates?.[0]);
      const latitude = Number(feature.geometry?.coordinates?.[1]);
      const name = properties?.name?.trim();
      const osmType = ({ N: "node", W: "way", R: "relation" } as Record<string, string>)[properties?.osm_type ?? ""];
      const osmId = String(properties?.osm_id ?? "");
      if (!properties || !name || !osmType || !/^\d{1,24}$/.test(osmId) || !validCoordinate(latitude, longitude)) return [];
      const placeTypes = [...new Set([properties.osm_key, properties.osm_value, properties.type]
        .flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))];
      const countryCode = profileCountryCode(latitude, longitude, properties.countrycode);
      return [{
        source: "photon",
        similarity: placeNameSimilarity(input, name),
        rank,
        visitWeight: photonVisitWeight(properties),
        corroborated: false,
        prominence: 0,
        stop: {
          id: `osm-${osmType}-${osmId}`,
          input,
          name,
          area: photonArea(properties) ?? "",
          address: photonAddress(properties, name),
          ...(countryCode ? { countryCode } : {}),
          latitude,
          longitude,
          sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
          verifiedAt,
          confidence: "medium",
          planningDurationMinutes: estimateStayMinutes(`${input} ${name}`, placeTypes, 90),
          isAnchor: false,
          placeTypes,
        },
      }];
    });
  }

  private async mapsCandidates(
    search: MapsPlaceSearch,
    input: string,
    languageCode: "en" | "ja",
    near: Region | null,
    signal?: AbortSignal,
  ): Promise<Candidate[] | null> {
    let found: MapsSearchPlace[] | null;
    try {
      found = await search(input, languageCode, near, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    if (!found) return null;
    const verifiedAt = new Date(this.now()).toISOString();
    return found.slice(0, 6).flatMap((place, rank): Candidate[] => {
      if (!place.name.trim() || !validCoordinate(place.latitude, place.longitude)) return [];
      const placeTypes = mapsPlaceTypes(place.category);
      const countryCode = profileCountryCode(place.latitude, place.longitude, place.countryCode ?? undefined);
      const coordinate = `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
      return [{
        source: "maps",
        similarity: placeNameSimilarity(input, place.name),
        rank,
        // A categorised point of interest is something to visit; a bare
        // address match may be anything.
        visitWeight: place.category ? 1 : 0.6,
        corroborated: false,
        prominence: 0,
        stop: {
          id: `maps-${place.id ?? coordinate}`.slice(0, 120),
          input,
          name: place.name.trim(),
          area: place.area ?? "",
          address: place.address,
          ...(countryCode ? { countryCode } : {}),
          latitude: place.latitude,
          longitude: place.longitude,
          sourceUrl: `https://maps.apple.com/?ll=${coordinate}&q=${encodeURIComponent(place.name.trim())}`,
          verifiedAt,
          confidence: "medium",
          planningDurationMinutes: estimateStayMinutes(`${input} ${place.name}`, placeTypes, 90),
          isAnchor: false,
          placeTypes,
        },
      }];
    });
  }

  private async gather(
    input: string,
    languageCode: "en" | "ja",
    destination: Destination,
    near: Region | null,
    signal?: AbortSignal,
    mapsSearch: MapsPlaceSearch | null = null,
  ) {
    const languages = wikipediaLanguages(input, languageCode);
    // The first pass asks one encyclopedia; the regional second pass can
    // afford every plausible language because it only runs for leftovers.
    const wikiLanguages = near ? languages : languages.slice(0, 1);
    const batches = await Promise.all([
      this.photonCandidates(input, near, signal),
      this.wikidataCandidates(input, languageCode, near, signal),
      mapsSearch ? this.mapsCandidates(mapsSearch, input, languageCode, near, signal) : Promise.resolve(null),
      ...wikiLanguages.map((language) => this.wikipediaCandidates(input, language, near, signal)),
    ]);
    const answered = batches.some((batch) => batch !== null);
    const candidates = batches.flatMap((batch) => batch ?? [])
      .filter((candidate) => withinBounds(destination.bounds, candidate.stop.latitude, candidate.stop.longitude));
    return { answered, candidates };
  }

  /**
   * `known` carries lines that were already placed without the network (a
   * sight picked from the bundled list). They are not looked up again, but
   * they still vote on where the trip is, so the remaining lines are
   * resolved around them.
   */
  async resolve(
    request: PlaceResolutionRequest,
    signal?: AbortSignal,
    mapsSearch: MapsPlaceSearch | null = null,
    known: ReadonlyMap<string, ResolvedInputStop> = new Map(),
  ) {
    const destination = destinationById(request.destination === "auto" ? "worldwide" : request.destination);
    const inputs = [...request.queries, ...(request.hotelQuery ? [request.hotelQuery] : [])];
    const pools: Candidate[][] = inputs.map(() => []);
    let anySourceAnswered = inputs.length === 0;

    const forEachInput = async (indexes: number[], work: (index: number) => Promise<void>) => {
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(INPUT_CONCURRENCY, indexes.length) }, async () => {
        while (cursor < indexes.length) {
          const index = indexes[cursor];
          cursor += 1;
          await work(index);
        }
      }));
    };

    const isKnown = (index: number) => index < request.queries.length && known.has(inputs[index]);
    inputs.forEach((input, index) => {
      if (!isKnown(index)) return;
      const stop = known.get(input)!;
      if (!withinBounds(destination.bounds, stop.latitude, stop.longitude)) return;
      pools[index] = [{ source: "wikidata", stop: { ...stop, input }, similarity: 1, rank: 0, visitWeight: 1, corroborated: true, prominence: 1 }];
    });
    const unknown = inputs.map((_input, index) => index).filter((index) => pools[index].length === 0);
    anySourceAnswered ||= unknown.length === 0;
    await forEachInput(unknown, async (index) => {
      const { answered, candidates } = await this.gather(inputs[index], request.languageCode, destination, null, signal);
      anySourceAnswered ||= answered;
      pools[index] = candidates;
    });
    if (!anySourceAnswered) throw new Error("open_place_sources_unavailable");

    let region = inferRegion(pools);
    const settled = (index: number, currentRegion: Region | null) => pools[index].some((candidate) => (
      candidate.similarity >= STRONG_SIMILARITY
      && (!currentRegion || distanceKm(candidate.stop, currentRegion) <= REGION_CORE_KM * 2)
    ));

    if (region) {
      const leftovers = inputs.map((_input, index) => index).filter((index) => !settled(index, region));
      const knownRegion = region;
      await forEachInput(leftovers, async (index) => {
        const { candidates } = await this.gather(
          inputs[index], request.languageCode, destination, knownRegion, signal, mapsSearch,
        );
        pools[index] = [...pools[index], ...candidates];
      });
      region = inferRegion(pools) ?? region;
    } else if (mapsSearch) {
      // No region emerged (a single line, or nothing confident yet). The
      // maps search is the one source that knows ordinary shops and hotels
      // by name, so it gets the unsettled lines directly.
      const leftovers = inputs.map((_input, index) => index).filter((index) => !settled(index, null));
      await forEachInput(leftovers, async (index) => {
        const found = await this.mapsCandidates(mapsSearch, inputs[index], request.languageCode, null, signal);
        pools[index] = [...pools[index], ...(found ?? [])
          .filter((candidate) => withinBounds(destination.bounds, candidate.stop.latitude, candidate.stop.longitude))];
      });
      region = inferRegion(pools);
    }

    // A descriptive tail the map does not carry ("尖沙咀プロムナード") still
    // names its neighbourhood. Inside a known region the leading proper noun
    // is a usable, visibly low-confidence pin — far better for day planning
    // than a line the traveller has to place by hand.
    if (region) {
      const knownRegion = region;
      const partial = inputs.map((_input, index) => index).filter((index) => (
        !pools[index].some((candidate) => candidate.similarity >= USABLE_SIMILARITY)
        && leadingProperNoun(inputs[index]) !== null
      ));
      await forEachInput(partial, async (index) => {
        const head = leadingProperNoun(inputs[index])!;
        const { candidates } = await this.gather(head, request.languageCode, destination, knownRegion, signal);
        pools[index].push(...candidates
          .filter((candidate) => candidate.similarity >= STRONG_SIMILARITY && inRegion(candidate, knownRegion))
          .map((candidate) => ({
            ...candidate,
            similarity: PARTIAL_NAME_SIMILARITY,
            stop: { ...candidate.stop, input: inputs[index] },
          })));
      });
    }

    // Nominatim is the slowest and most rate-limited source, so it only sees
    // what nothing else could place.
    if (this.nominatim) {
      const nominatimDestination = destination.bounds || !region
        ? destination
        : destinationForCoordinate(region.latitude, region.longitude) ?? destination;
      for (let index = 0; index < inputs.length; index += 1) {
        const hasUsable = pools[index].some((candidate) => candidate.similarity >= USABLE_SIMILARITY);
        if (hasUsable) continue;
        try {
          const found = await this.nominatim.search(inputs[index], request.languageCode, nominatimDestination, signal);
          pools[index].push(...found.map((stop, rank): Candidate => ({
            source: "nominatim",
            stop: {
              ...stop,
              ...(profileCountryCode(stop.latitude, stop.longitude, stop.countryCode)
                ? { countryCode: profileCountryCode(stop.latitude, stop.longitude, stop.countryCode) }
                : {}),
            },
            similarity: placeNameSimilarity(inputs[index], stop.name),
            rank,
            visitWeight: 0.7,
            corroborated: false,
            prominence: 0,
          })));
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
    }

    const wikidataIdByStopId = new Map<string, string>();
    const decisions = pools.map((pool, index) => decide(inputs[index], pool, region, wikidataIdByStopId));
    const places: ResolvedInputStop[] = [];
    const ambiguous: AmbiguousPlaceResolution[] = [];
    decisions.slice(0, request.queries.length).forEach((decision, index) => {
      if (decision.kind === "accepted") places.push(decision.stop);
      else if (decision.kind === "ambiguous") ambiguous.push({ input: request.queries[index], candidates: decision.candidates });
    });
    const hotelDecision = request.hotelQuery ? decisions.at(-1) : undefined;
    const hotel = !hotelDecision ? null
      : hotelDecision.kind === "accepted" ? hotelDecision.stop
        : hotelDecision.kind === "ambiguous" ? hotelDecision.candidates[0] ?? null
          : null;

    const shown = [
      ...places,
      ...(hotel ? [hotel] : []),
      ...ambiguous.flatMap((entry) => entry.candidates),
    ];
    const locality = await this.wikidataLocality(
      shown.flatMap((stop) => stop.area ? [] : [wikidataIdByStopId.get(stop.id) ?? ""]),
      request.languageCode,
      signal,
    );
    const finish = (stop: ResolvedInputStop): ResolvedInputStop => {
      const known = locality.get(wikidataIdByStopId.get(stop.id) ?? "");
      const countryCode = stop.countryCode ?? known?.countryCode;
      const area = stop.area || known?.area || "";
      // "<name>, <district>" reads as an address in the review list; the
      // encyclopedia's one-line description is the fallback.
      const address = stop.address;
      // A sight with no label in the traveller's language comes back in
      // another script ("文武廟" → "Sheung Wan Man Mo Temple"). The traveller's
      // own words are the name they will recognise on the itinerary; the
      // source's name stays visible in the address line.
      // "instance of: Buddhist temple / pier / amusement park" is the only
      // category an encyclopedia pin has, and it is what keeps a ferry pier
      // from being planned as a 90-minute visit.
      const placeTypes = (stop.placeTypes ?? []).length > 0 ? stop.placeTypes! : placeTypesFromKinds(known?.kinds ?? []);
      const foreignScript = cjkPattern.test(stop.input) && !cjkPattern.test(stop.name);
      const name = foreignScript ? stop.input.trim() : stop.name;
      return {
        ...stop,
        name,
        placeTypes,
        planningDurationMinutes: estimateStayMinutes(`${stop.input} ${stop.name}`, placeTypes, 90),
        area: area || areaFromAddress(address, stop.name, destination) || stop.name,
        address: [foreignScript ? stop.name : "", area, address].filter(Boolean).join(" · ") || stop.name,
        ...(countryCode ? { countryCode } : {}),
      };
    };
    return {
      places: places.map(finish),
      hotel: hotel ? finish(hotel) : null,
      ambiguous: ambiguous.map((entry) => ({ input: entry.input, candidates: entry.candidates.map(finish) })),
    };
  }
}

const kindTypeRules: Array<[RegExp, string]> = [
  [/amusement park|theme park/, "amusement_park"],
  [/\bzoo\b/, "zoo"],
  [/aquarium/, "aquarium"],
  [/museum|art gallery/, "museum"],
  [/buddhist temple|\btemple\b|monastery/, "buddhist_temple"],
  [/shrine/, "shinto_shrine"],
  [/church|cathedral|basilica|mosque|synagogue/, "church"],
  [/castle|palace|fort\b/, "castle"],
  [/botanical garden/, "botanical_garden"],
  [/national park/, "national_park"],
  [/\bpark\b|garden/, "park"],
  [/market|bazaar/, "market"],
  [/shopping (?:mall|center|centre)|department store/, "shopping_mall"],
  [/observation (?:deck|tower)|\btower\b|skyscraper/, "observation_deck"],
  [/hot spring|onsen|public bath/, "onsen"],
  [/\bbeach\b/, "beach"],
  [/stadium|arena/, "stadium"],
  [/\bpier\b|ferry (?:terminal|pier)|\bwharf\b/, "pier"],
  [/promenade|esplanade|boardwalk/, "promenade"],
  [/\bstreet\b|\broad\b|thoroughfare|pedestrian/, "street"],
  [/\bsquare\b|plaza|intersection|crossing/, "square"],
  [/\bbridge\b/, "bridge"],
  [/statue|sculpture/, "statue"],
];

/** Wikidata "instance of" labels → the place types the stay table understands. */
export function placeTypesFromKinds(kinds: readonly string[]) {
  return [...new Set(kinds.flatMap((kind) => {
    const match = kindTypeRules.find(([pattern]) => pattern.test(kind));
    return match ? [match[1]] : [];
  }))];
}

/** Similarity credited to a pin found from only the leading part of the typed name. */
const PARTIAL_NAME_SIMILARITY = 0.6;

/**
 * "尖沙咀プロムナード" → "尖沙咀", "Shibuya scramble crossing" → null. Only a
 * Han proper noun followed by a katakana/latin descriptor is split: that
 * shape is reliably "<place> <kind of thing>", while splitting anything else
 * manufactures names nobody typed.
 */
export function leadingProperNoun(input: string) {
  const match = input.normalize("NFKC").trim().match(/^(\p{Script=Han}{2,})[\s・]*(?:[\p{Script=Katakana}ー]{2,}|[A-Za-z][A-Za-z\s]+)$/u);
  return match ? match[1] : null;
}

/* -------------------------------------------------------------- decisions */

/**
 * The trip's region is wherever the largest number of wishlist lines have a
 * confident candidate close to one another. A lone confident answer is not a
 * region: it must not drag every other line toward itself.
 */
export function inferRegion(pools: ReadonlyArray<ReadonlyArray<Pick<Candidate, "stop" | "similarity">>>): Region | null {
  const strong = pools.map((pool) => pool.filter((candidate) => candidate.similarity >= STRONG_SIMILARITY));
  let best: { members: Array<Pick<Candidate, "stop" | "similarity">>; weight: number } | null = null;
  for (const pool of strong) {
    for (const center of pool) {
      const members = strong.flatMap((other) => {
        const near = other
          .filter((candidate) => distanceKm(candidate.stop, center.stop) <= REGION_RADIUS_KM)
          .sort((left, right) => right.similarity - left.similarity)[0];
        return near ? [near] : [];
      });
      const weight = members.reduce((sum, member) => sum + member.similarity, 0);
      if (!best || members.length > best.members.length || (members.length === best.members.length && weight > best.weight)) {
        best = { members, weight };
      }
    }
  }
  if (!best || best.members.length < 2) return null;
  const centroid = (members: typeof best.members) => ({
    latitude: members.reduce((sum, member) => sum + member.stop.latitude, 0) / members.length,
    longitude: members.reduce((sum, member) => sum + member.stop.longitude, 0) / members.length,
  });
  // A namesake at the edge of the radius (Guangzhou's temple on a Hong Kong
  // list) must not drag the centre toward itself: once the rough centre is
  // known, only the members actually clustered around it define it.
  const rough = centroid(best.members);
  const core = best.members.filter((member) => distanceKm(member.stop, rough) <= REGION_CORE_KM * 2);
  const { latitude, longitude } = centroid(core.length >= 2 ? core : best.members);
  const codes = new Map<string, number>();
  for (const member of best.members) {
    if (member.stop.countryCode) codes.set(member.stop.countryCode, (codes.get(member.stop.countryCode) ?? 0) + 1);
  }
  const countryCode = [...codes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return { latitude, longitude, ...(countryCode ? { countryCode } : {}) };
}

function inRegion(candidate: Candidate, region: Region | null) {
  return region !== null && distanceKm(candidate.stop, region) <= REGION_RADIUS_KM;
}

function score(candidate: Candidate, region: Region | null) {
  let total = candidate.similarity;
  if (region) {
    // Full credit inside the city, fading to nothing at the edge of the
    // region: Guangzhou is "near" Hong Kong on a globe, not on a trip.
    const distance = distanceKm(candidate.stop, region);
    const proximity = distance <= REGION_CORE_KM
      ? 1
      : Math.max(0, 1 - (distance - REGION_CORE_KM) / (REGION_FADE_KM - REGION_CORE_KM));
    total += 0.3 * proximity;
    if (proximity === 0 && region.countryCode && candidate.stop.countryCode === region.countryCode) total += 0.05;
  }
  if (candidate.corroborated) total += 0.12;
  // An encyclopedia article under the typed name is the only prominence
  // signal a keyless lookup has: it separates the Toyosu Market from a
  // greengrocer that borrowed its name.
  if (candidate.source === "wikipedia" || candidate.source === "wikidata") {
    total += candidate.similarity >= STRONG_SIMILARITY ? 0.15 : 0.05;
  }
  total += 0.08 * candidate.visitWeight;
  total += 0.12 * candidate.prominence;
  total += candidate.rank === 0 ? 0.06 : candidate.rank === 1 ? 0.03 : 0;
  return total;
}

/** Merges the same spot reported by several sources into its best description. */
function mergeSamePlace(pool: Candidate[], region: Region | null) {
  const merged: Candidate[] = [];
  const ordered = [...pool].sort((left, right) => score(right, region) - score(left, region));
  for (let candidate of ordered) {
    const twin = merged.find((existing) => distanceKm(existing.stop, candidate.stop) <= SAME_PLACE_KM);
    if (!twin) {
      merged.push({ ...candidate, stop: { ...candidate.stop } });
      continue;
    }
    if (twin.stop.id === candidate.stop.id) continue;
    if (twin.source !== candidate.source && candidate.similarity >= USABLE_SIMILARITY) twin.corroborated = true;
    // Two sources, one spot, different things: the Shibuya article and the
    // ramen shop a block away. The pin keeps the identity of whichever name
    // is closer to what was typed, and the other's supporting evidence.
    if (candidate.similarity > twin.similarity + 0.05) {
      const supporting = twin.stop;
      twin.stop = { ...candidate.stop };
      twin.source = candidate.source;
      if (!twin.stop.area && supporting.area) twin.stop.area = supporting.area;
      candidate = { ...candidate, stop: supporting, similarity: twin.similarity };
    }
    twin.similarity = Math.max(twin.similarity, candidate.similarity);
    twin.visitWeight = Math.max(twin.visitWeight, candidate.visitWeight);
    twin.prominence = Math.max(twin.prominence, candidate.prominence);
    twin.wikidataId ??= candidate.wikidataId;
    // An encyclopedia pin has no address or map type; borrow the map's.
    if (!twin.stop.area && candidate.stop.area) twin.stop.area = candidate.stop.area;
    const encyclopedic = (source: CandidateSource) => source === "wikipedia" || source === "wikidata";
    if ((encyclopedic(twin.source) || !twin.stop.address) && !encyclopedic(candidate.source) && candidate.stop.address) {
      twin.stop.address = candidate.stop.address;
    }
    if ((twin.stop.placeTypes ?? []).length === 0 && (candidate.stop.placeTypes ?? []).length > 0) {
      twin.stop.placeTypes = candidate.stop.placeTypes;
      twin.stop.planningDurationMinutes = estimateStayMinutes(
        `${twin.stop.input} ${twin.stop.name}`,
        candidate.stop.placeTypes,
        90,
      );
    }
  }
  return merged.sort((left, right) => score(right, region) - score(left, region));
}

type Decision =
  | { kind: "accepted"; stop: ResolvedInputStop }
  | { kind: "ambiguous"; candidates: ResolvedInputStop[] }
  | { kind: "unresolved" };

export function decide(
  input: string,
  pool: Candidate[],
  region: Region | null,
  wikidataIdByStopId: Map<string, string> = new Map(),
): Decision {
  const ranked = mergeSamePlace(pool, region).filter((candidate) => candidate.similarity >= SHORTLIST_SIMILARITY);
  for (const candidate of ranked.slice(0, 3)) {
    if (candidate.wikidataId) wikidataIdByStopId.set(candidate.stop.id, candidate.wikidataId);
  }
  const best = ranked[0];
  if (!best) return { kind: "unresolved" };
  const shortlist = () => ({ kind: "ambiguous" as const, candidates: ranked.slice(0, 3).map((candidate) => candidate.stop) });
  const bestScore = score(best, region);
  // A rival is another *place* (not the same spot again) that the evidence
  // cannot separate from the leader.
  const rival = ranked.slice(1).find((candidate) => (
    candidate.similarity >= USABLE_SIMILARITY
    && bestScore - score(candidate, region) < 0.1
    && distanceKm(candidate.stop, best.stop) > 2
    // Once the wishlist has said where the trip is, a namesake elsewhere on
    // the planet contests an in-region answer only when it is far more
    // famous — Kyoto's Kiyomizu-dera against a namesake near a Tokyo trip.
    && (!inRegion(best, region) || inRegion(candidate, region) || candidate.prominence - best.prominence >= 0.4)
  ));

  if (best.similarity >= STRONG_SIMILARITY) {
    // With no region to arbitrate, a confident name is enough only when it
    // is the provider's clear first answer.
    return rival ? shortlist() : { kind: "accepted", stop: best.stop };
  }
  if (best.similarity >= USABLE_SIMILARITY && inRegion(best, region) && !rival) {
    return { kind: "accepted", stop: { ...best.stop, confidence: "low" } };
  }
  return shortlist();
}

const publicOpenPlaceResolver = new OpenPlaceResolver();

export async function fetchOpenPlaceResolutions(
  request: PlaceResolutionRequest,
  signal?: AbortSignal,
  resolver: OpenPlaceResolver = publicOpenPlaceResolver,
  mapsSearch: MapsPlaceSearch | null = null,
  known: ReadonlyMap<string, ResolvedInputStop> = new Map(),
) {
  // providerOverrides are Google Place IDs. An exact choice that cannot be
  // rehydrated stays unresolved; it never degrades to a fuzzy text match.
  return resolver.resolve(request, signal, mapsSearch, known);
}
