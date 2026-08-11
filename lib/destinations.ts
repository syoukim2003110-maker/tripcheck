import type { Locale } from "./i18n.ts";

/*
 * Where the trip happens. Everything that used to be a hardcoded "Japan" —
 * the Google region bias, the disambiguating query suffix, the timezone used
 * for "today", the currency shown on a price band, the map's opening view,
 * the airport list, the mode the planner reaches for first, and the hours
 * people actually eat — lives here as one profile per destination.
 *
 * A destination is a country, because that is the granularity every provider
 * we call already speaks (ISO 3166-1 alpha-2). "worldwide" is the honest
 * fallback: no bias, no coordinate box, no invented local knowledge.
 *
 * Airport transfer and check-in minutes are planning ESTIMATES, exactly like
 * every other travel minute in this product. They are labelled as such in the
 * UI and carry a source link so a traveller can verify the real number.
 */

export type DestinationId =
  | "worldwide"
  | "japan"
  | "switzerland"
  | "korea"
  | "taiwan"
  | "hongkong"
  | "singapore"
  | "thailand"
  | "vietnam"
  | "indonesia"
  | "uae"
  | "france"
  | "italy"
  | "spain"
  | "portugal"
  | "uk"
  | "germany"
  | "austria"
  | "netherlands"
  | "iceland"
  | "norway"
  | "usa"
  | "canada"
  | "australia"
  | "newzealand";

/** "auto" lets the first resolved place decide; anything else pins the country. */
export type DestinationChoice = DestinationId | "auto";

/**
 * Which mode the planner reaches for when nothing else decides.
 * `transit_first` — dense rail, waiting and parking make a car slower.
 * `car_first` — intercity distances where transit is a fallback, not a plan.
 * `balanced` — neither wins by default; the shortest sane option decides.
 */
export type MobilityProfile = "transit_first" | "balanced" | "car_first";

export type GeoBounds = { south: number; west: number; north: number; east: number };

/** Minutes from local midnight. */
export type MealWindow = { start: number; end: number };

export type DestinationAirport = {
  code: string;
  names: { en: string; ja: string };
  latitude: number;
  longitude: number;
  /** Airport ⇄ main city centre door to door on the usual public route. Estimate. */
  transferMinutes: number;
  /** Time to be at the airport before an international departure. Estimate. */
  internationalDepartureMinutes: number;
  sourceUrl: string;
};

export type Destination = {
  id: DestinationId;
  names: Record<Locale, string>;
  /** ISO 3166-1 alpha-2 codes this profile covers. Empty for worldwide. */
  countryCodes: string[];
  /** Region bias handed to Google Places, Routes and Maps. */
  regionCode: string | null;
  /** Appended to a bare place name so "Old Town" lands in the right country. */
  querySuffix: string | null;
  /** IANA zone used for "today" and for reading a local calendar day. */
  timeZone: string;
  currency: {
    code: string;
    /** One glyph repeated for Google's four price levels; "•" when no single glyph fits. */
    bandGlyph: string;
  };
  center: { latitude: number; longitude: number };
  overviewZoom: number;
  /** Generous sanity box. A resolution outside it is a wrong-country match. */
  bounds: GeoBounds | null;
  mobility: MobilityProfile;
  meals: { lunch: MealWindow; dinner: MealWindow };
  /** Extra listing evidence that only exists in this country. */
  hotelFacts: "rakuten" | null;
  /**
   * True where a shop-closing law shutters most retail on Sundays (DACH
   * countries). Drives a Sunday warning on affected trip days: a shopping or
   * grocery errand planned for that day will find locked doors.
   */
  sundayClosing?: boolean;
  airports: DestinationAirport[];
  /** Cuisine words for a meal slot when no area profile matches. */
  cuisine: { en: string[]; ja: string[] };
  /**
   * Structural local realities that change a plan — closing days, meal hours,
   * timetable-bound transport. Short, checkable, and empty where we do not
   * have a fact worth stating.
   */
  notes: { en: string[]; ja: string[] };
  /** Starter wishlist offered by the example button. */
  sample: { en: string; ja: string } | null;
  /**
   * Deterministic coordinates for the starter wishlist, in the same order as
   * its lines. The "see a finished example" promise must hold with zero
   * provider keys, so the demo build seeds these instead of calling a
   * resolver. Names must equal the parsed line names (markers stripped).
   */
  sampleStops?: Array<{
    names: { en: string; ja: string };
    area: { en: string; ja: string };
    latitude: number;
    longitude: number;
    stayMinutes: number;
  }>;
};

const hour = (h: number, m = 0) => h * 60 + m;

/* ── Airports ─────────────────────────────────────────────────────────────
 * Main international gateways only. A traveller flying into a smaller field
 * leaves the airport fields empty and loses nothing but the arrival/departure
 * squeeze on the first and last day.
 */

const japanAirports: DestinationAirport[] = [
  { code: "HND", names: { en: "Haneda", ja: "羽田空港" }, latitude: 35.5494, longitude: 139.7798, transferMinutes: 60, internationalDepartureMinutes: 180, sourceUrl: "https://www.tokyo-haneda.com/en/flight/detail/int_departure.html" },
  { code: "NRT", names: { en: "Narita", ja: "成田空港" }, latitude: 35.772, longitude: 140.3929, transferMinutes: 105, internationalDepartureMinutes: 120, sourceUrl: "https://www.narita-airport.jp/en/airportguide/inter-dep/" },
  { code: "KIX", names: { en: "Kansai", ja: "関西国際空港" }, latitude: 34.432, longitude: 135.2304, transferMinutes: 60, internationalDepartureMinutes: 150, sourceUrl: "https://www.kansai-airport.or.jp/en/" },
  { code: "ITM", names: { en: "Itami", ja: "大阪国際空港（伊丹）" }, latitude: 34.7855, longitude: 135.4382, transferMinutes: 40, internationalDepartureMinutes: 120, sourceUrl: "https://www.osaka-airport.co.jp/en/" },
  { code: "NGO", names: { en: "Chubu Centrair", ja: "中部国際空港" }, latitude: 34.8584, longitude: 136.8054, transferMinutes: 50, internationalDepartureMinutes: 150, sourceUrl: "https://www.centrair.jp/en/" },
  { code: "FUK", names: { en: "Fukuoka", ja: "福岡空港" }, latitude: 33.5859, longitude: 130.4507, transferMinutes: 20, internationalDepartureMinutes: 150, sourceUrl: "https://www.fukuoka-airport.jp/en/" },
  { code: "CTS", names: { en: "New Chitose", ja: "新千歳空港" }, latitude: 42.7752, longitude: 141.6923, transferMinutes: 50, internationalDepartureMinutes: 150, sourceUrl: "https://www.hokkaido-airports.com/en/new-chitose/" },
  { code: "OKA", names: { en: "Naha", ja: "那覇空港" }, latitude: 26.1958, longitude: 127.6458, transferMinutes: 25, internationalDepartureMinutes: 150, sourceUrl: "https://www.naha-airport.co.jp/en/" },
];

const swissAirports: DestinationAirport[] = [
  { code: "ZRH", names: { en: "Zurich", ja: "チューリッヒ空港" }, latitude: 47.4647, longitude: 8.5492, transferMinutes: 25, internationalDepartureMinutes: 150, sourceUrl: "https://www.flughafen-zuerich.ch/en/passengers" },
  { code: "GVA", names: { en: "Geneva", ja: "ジュネーブ空港" }, latitude: 46.2381, longitude: 6.1089, transferMinutes: 20, internationalDepartureMinutes: 150, sourceUrl: "https://www.gva.ch/en/" },
  { code: "BSL", names: { en: "Basel EuroAirport", ja: "バーゼル空港" }, latitude: 47.5896, longitude: 7.5299, transferMinutes: 30, internationalDepartureMinutes: 150, sourceUrl: "https://www.euroairport.com/en/" },
];

/**
 * Airport pairs that genuinely serve the same metropolitan base. Country
 * profiles also contain gateways for entirely different cities, so their
 * full airport list must never be presented as interchangeable options.
 */
const airportMetroGroups = [
  ["HND", "NRT"],
  ["KIX", "ITM"],
  ["ICN", "GMP"],
  ["TPE", "TSA"],
  ["BKK", "DMK"],
  ["CDG", "ORY"],
  ["LHR", "LGW"],
] as const;

/* ── Destinations ─────────────────────────────────────────────────────── */

const destinationList: Destination[] = [
  {
    id: "worldwide",
    names: { en: "Anywhere", ja: "世界のどこか", ko: "전 세계", zh: "全球" },
    countryCodes: [],
    regionCode: null,
    querySuffix: null,
    timeZone: "UTC",
    currency: { code: "USD", bandGlyph: "•" },
    center: { latitude: 20, longitude: 0 },
    overviewZoom: 2,
    bounds: null,
    // Until the country is known, keep the product's long-standing lean toward
    // transit: recommending a train that turns out to be a bus is a smaller
    // error than quietly budgeting every leg as a taxi.
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18, 30), end: hour(21) } },
    hotelFacts: null,
    airports: [],
    cuisine: {
      en: ["a local speciality", "a casual sit-down meal", "a café break"],
      ja: ["その土地の名物", "気軽に座れる食事", "カフェ休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "japan",
    names: { en: "Japan", ja: "日本", ko: "일본", zh: "日本" },
    countryCodes: ["JP"],
    regionCode: "JP",
    querySuffix: "Japan",
    timeZone: "Asia/Tokyo",
    currency: { code: "JPY", bandGlyph: "¥" },
    center: { latitude: 36.2048, longitude: 138.2529 },
    overviewZoom: 5,
    bounds: { south: 20, west: 122, north: 46, east: 154 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(11), end: hour(14, 30) }, dinner: { start: hour(17, 30), end: hour(21) } },
    hotelFacts: "rakuten",
    airports: japanAirports,
    cuisine: {
      en: ["local Japanese", "casual set meal", "café break"],
      ja: ["その街らしい和食", "気軽な定食", "カフェ休憩"],
    },
    notes: {
      en: [
        "Many museums close on Mondays (or the next weekday when Monday is a holiday).",
        "The most popular timed venues sell out days ahead; some run a lottery rather than a queue.",
      ],
      ja: [
        "美術館・博物館は月曜休館が多い（祝日の場合は翌平日）。",
        "人気の日時指定施設は数日前に売り切れることがあり、抽選制のものもある。",
      ],
    },
    sample: null,
  },
  {
    id: "switzerland",
    names: { en: "Switzerland", ja: "スイス", ko: "스위스", zh: "瑞士" },
    countryCodes: ["CH", "LI"],
    regionCode: "CH",
    querySuffix: "Switzerland",
    timeZone: "Europe/Zurich",
    currency: { code: "CHF", bandGlyph: "₣" },
    center: { latitude: 46.8182, longitude: 8.2275 },
    overviewZoom: 8,
    bounds: { south: 45.6, west: 5.8, north: 47.9, east: 10.6 },
    mobility: "transit_first",
    // Kitchens in much of Switzerland stop serving well before closing time,
    // so an itinerary that puts dinner at 21:30 quietly plans a closed door.
    meals: { lunch: { start: hour(11, 45), end: hour(13, 45) }, dinner: { start: hour(18), end: hour(20, 30) } },
    hotelFacts: null,
    sundayClosing: true,
    airports: swissAirports,
    cuisine: {
      en: ["Swiss classics", "a mountain restaurant", "a café or bakery"],
      ja: ["スイスの定番料理", "山のレストラン", "カフェ・ベーカリー"],
    },
    notes: {
      en: [
        "Shops and many restaurants close on Sundays; station and airport outlets are the usual exception.",
        "Mountain railways and cable cars run to a fixed timetable with a published last descent, and several close for maintenance in spring and late autumn.",
        "High-altitude viewpoints are weather-dependent — check the summit webcam the morning you go.",
      ],
      ja: [
        "日曜は商店と多くのレストランが休業。駅構内と空港はだいたい例外。",
        "登山鉄道・ロープウェイは時刻表制で「最終下り」が決まっている。春と晩秋には整備運休する路線もある。",
        "高所の展望台は天候次第。当日の朝に山頂ライブカメラを確認するのが確実。",
      ],
    },
    sample: {
      en: `Lucerne Chapel Bridge
Mount Rigi
Interlaken
Jungfraujoch — must
Lauterbrunnen
Zermatt
Gornergrat
Bern Old Town`,
      ja: `ルツェルン カペル橋
リギ山
インターラーケン
ユングフラウヨッホ — 必須
ラウターブルンネン
ツェルマット
ゴルナーグラート
ベルン旧市街`,
    },
    // Widely published landmark coordinates; the sample must build offline.
    sampleStops: [
      { names: { en: "Lucerne Chapel Bridge", ja: "ルツェルン カペル橋" }, area: { en: "Lucerne", ja: "ルツェルン" }, latitude: 47.0517, longitude: 8.3073, stayMinutes: 45 },
      { names: { en: "Mount Rigi", ja: "リギ山" }, area: { en: "Arth", ja: "アルト" }, latitude: 47.0567, longitude: 8.4854, stayMinutes: 150 },
      { names: { en: "Interlaken", ja: "インターラーケン" }, area: { en: "Interlaken", ja: "インターラーケン" }, latitude: 46.6863, longitude: 7.8632, stayMinutes: 90 },
      { names: { en: "Jungfraujoch", ja: "ユングフラウヨッホ" }, area: { en: "Lauterbrunnen", ja: "ラウターブルンネン" }, latitude: 46.5474, longitude: 7.9793, stayMinutes: 150 },
      { names: { en: "Lauterbrunnen", ja: "ラウターブルンネン" }, area: { en: "Lauterbrunnen", ja: "ラウターブルンネン" }, latitude: 46.5936, longitude: 7.9081, stayMinutes: 60 },
      { names: { en: "Zermatt", ja: "ツェルマット" }, area: { en: "Zermatt", ja: "ツェルマット" }, latitude: 46.0207, longitude: 7.7491, stayMinutes: 120 },
      { names: { en: "Gornergrat", ja: "ゴルナーグラート" }, area: { en: "Zermatt", ja: "ツェルマット" }, latitude: 45.9833, longitude: 7.7842, stayMinutes: 120 },
      { names: { en: "Bern Old Town", ja: "ベルン旧市街" }, area: { en: "Bern", ja: "ベルン" }, latitude: 46.948, longitude: 7.4474, stayMinutes: 90 },
    ],
  },
  {
    id: "korea",
    names: { en: "South Korea", ja: "韓国", ko: "대한민국", zh: "韩国" },
    countryCodes: ["KR"],
    regionCode: "KR",
    querySuffix: "South Korea",
    timeZone: "Asia/Seoul",
    currency: { code: "KRW", bandGlyph: "₩" },
    center: { latitude: 36.5, longitude: 127.85 },
    overviewZoom: 7,
    bounds: { south: 33, west: 125, north: 38.7, east: 131.9 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(11, 30), end: hour(14) }, dinner: { start: hour(17, 30), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "ICN", names: { en: "Incheon", ja: "仁川空港" }, latitude: 37.4602, longitude: 126.4407, transferMinutes: 70, internationalDepartureMinutes: 180, sourceUrl: "https://www.airport.kr/ap/en/index.do" },
      { code: "GMP", names: { en: "Gimpo", ja: "金浦空港" }, latitude: 37.5583, longitude: 126.7906, transferMinutes: 35, internationalDepartureMinutes: 120, sourceUrl: "https://www.airport.co.kr/gimpoeng/index.do" },
      { code: "PUS", names: { en: "Busan Gimhae", ja: "釜山金海空港" }, latitude: 35.1795, longitude: 128.9382, transferMinutes: 45, internationalDepartureMinutes: 150, sourceUrl: "https://www.airport.co.kr/gimhaeeng/index.do" },
    ],
    cuisine: {
      en: ["Korean staples", "a market meal", "a café break"],
      ja: ["韓国の定番", "市場のごはん", "カフェ休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "taiwan",
    names: { en: "Taiwan", ja: "台湾", ko: "대만", zh: "台灣" },
    countryCodes: ["TW"],
    regionCode: "TW",
    querySuffix: "Taiwan",
    timeZone: "Asia/Taipei",
    currency: { code: "TWD", bandGlyph: "$" },
    center: { latitude: 23.7, longitude: 120.96 },
    overviewZoom: 7,
    bounds: { south: 21.5, west: 118, north: 25.5, east: 122.5 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(11, 30), end: hour(14) }, dinner: { start: hour(17, 30), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "TPE", names: { en: "Taoyuan", ja: "桃園空港" }, latitude: 25.0777, longitude: 121.2328, transferMinutes: 55, internationalDepartureMinutes: 150, sourceUrl: "https://www.taoyuan-airport.com/english" },
      { code: "TSA", names: { en: "Taipei Songshan", ja: "台北松山空港" }, latitude: 25.0697, longitude: 121.5522, transferMinutes: 20, internationalDepartureMinutes: 120, sourceUrl: "https://www.tsa.gov.tw/en/" },
    ],
    cuisine: {
      en: ["night-market food", "a noodle or rice shop", "a tea house"],
      ja: ["夜市の食べ歩き", "麺・ごはんの店", "茶藝館"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "hongkong",
    names: { en: "Hong Kong", ja: "香港", ko: "홍콩", zh: "香港" },
    countryCodes: ["HK"],
    regionCode: "HK",
    querySuffix: "Hong Kong",
    timeZone: "Asia/Hong_Kong",
    currency: { code: "HKD", bandGlyph: "$" },
    center: { latitude: 22.3193, longitude: 114.1694 },
    overviewZoom: 10,
    bounds: { south: 22.1, west: 113.8, north: 22.6, east: 114.5 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21, 30) } },
    hotelFacts: null,
    airports: [
      { code: "HKG", names: { en: "Hong Kong", ja: "香港国際空港" }, latitude: 22.308, longitude: 113.9185, transferMinutes: 35, internationalDepartureMinutes: 150, sourceUrl: "https://www.hongkongairport.com/" },
    ],
    cuisine: {
      en: ["dim sum", "a cha chaan teng", "a tea break"],
      ja: ["飲茶", "茶餐廳", "お茶休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "singapore",
    names: { en: "Singapore", ja: "シンガポール", ko: "싱가포르", zh: "新加坡" },
    countryCodes: ["SG"],
    regionCode: "SG",
    querySuffix: "Singapore",
    timeZone: "Asia/Singapore",
    currency: { code: "SGD", bandGlyph: "$" },
    center: { latitude: 1.3521, longitude: 103.8198 },
    overviewZoom: 11,
    bounds: { south: 1.1, west: 103.5, north: 1.5, east: 104.2 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18, 30), end: hour(21, 30) } },
    hotelFacts: null,
    airports: [
      { code: "SIN", names: { en: "Changi", ja: "チャンギ空港" }, latitude: 1.3644, longitude: 103.9915, transferMinutes: 35, internationalDepartureMinutes: 180, sourceUrl: "https://www.changiairport.com/" },
    ],
    cuisine: {
      en: ["a hawker centre", "a local one-dish meal", "a kopitiam break"],
      ja: ["ホーカーセンター", "名物の一皿", "コピティアム休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "thailand",
    names: { en: "Thailand", ja: "タイ", ko: "태국", zh: "泰国" },
    countryCodes: ["TH"],
    regionCode: "TH",
    querySuffix: "Thailand",
    timeZone: "Asia/Bangkok",
    currency: { code: "THB", bandGlyph: "฿" },
    center: { latitude: 15.87, longitude: 100.99 },
    overviewZoom: 6,
    bounds: { south: 5.5, west: 97, north: 20.6, east: 106 },
    mobility: "balanced",
    meals: { lunch: { start: hour(11, 30), end: hour(14) }, dinner: { start: hour(18), end: hour(21, 30) } },
    hotelFacts: null,
    airports: [
      { code: "BKK", names: { en: "Suvarnabhumi", ja: "スワンナプーム空港" }, latitude: 13.69, longitude: 100.7501, transferMinutes: 60, internationalDepartureMinutes: 180, sourceUrl: "https://www.suvarnabhumiairport.com/en" },
      { code: "DMK", names: { en: "Don Mueang", ja: "ドンムアン空港" }, latitude: 13.9126, longitude: 100.6068, transferMinutes: 55, internationalDepartureMinutes: 150, sourceUrl: "https://www.donmueangairport.com/en" },
      { code: "HKT", names: { en: "Phuket", ja: "プーケット空港" }, latitude: 8.1132, longitude: 98.3169, transferMinutes: 60, internationalDepartureMinutes: 150, sourceUrl: "https://www.phuketairportthai.com/en" },
    ],
    cuisine: {
      en: ["Thai street food", "a rice or noodle shop", "an iced-coffee stop"],
      ja: ["タイの屋台料理", "ごはん・麺の食堂", "アイスコーヒー休憩"],
    },
    notes: {
      en: ["Temples enforce a dress code — covered shoulders and knees."],
      ja: ["寺院は服装規定あり（肩と膝が隠れる服装）。"],
    },
    sample: null,
  },
  {
    id: "vietnam",
    names: { en: "Vietnam", ja: "ベトナム", ko: "베트남", zh: "越南" },
    countryCodes: ["VN"],
    regionCode: "VN",
    querySuffix: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    currency: { code: "VND", bandGlyph: "₫" },
    center: { latitude: 14.06, longitude: 108.28 },
    overviewZoom: 6,
    bounds: { south: 8, west: 102, north: 23.5, east: 110 },
    mobility: "balanced",
    meals: { lunch: { start: hour(11, 30), end: hour(13, 30) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "SGN", names: { en: "Ho Chi Minh City", ja: "タンソンニャット空港" }, latitude: 10.8188, longitude: 106.652, transferMinutes: 40, internationalDepartureMinutes: 180, sourceUrl: "https://www.vietnamairport.vn/tansonnhatairport/en" },
      { code: "HAN", names: { en: "Hanoi Noi Bai", ja: "ノイバイ空港" }, latitude: 21.2212, longitude: 105.8072, transferMinutes: 50, internationalDepartureMinutes: 180, sourceUrl: "https://www.vietnamairport.vn/noibaiairport/en" },
      { code: "DAD", names: { en: "Da Nang", ja: "ダナン空港" }, latitude: 16.0439, longitude: 108.1994, transferMinutes: 20, internationalDepartureMinutes: 150, sourceUrl: "https://www.vietnamairport.vn/danangairport/en" },
    ],
    cuisine: {
      en: ["a pho or banh mi stop", "a local rice shop", "a Vietnamese coffee break"],
      ja: ["フォー・バインミー", "地元の食堂", "ベトナムコーヒー休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "indonesia",
    names: { en: "Indonesia", ja: "インドネシア", ko: "인도네시아", zh: "印度尼西亚" },
    countryCodes: ["ID"],
    regionCode: "ID",
    querySuffix: "Indonesia",
    timeZone: "Asia/Jakarta",
    currency: { code: "IDR", bandGlyph: "•" },
    center: { latitude: -2.55, longitude: 118.02 },
    overviewZoom: 5,
    bounds: { south: -11.5, west: 94, north: 6.5, east: 141.5 },
    mobility: "car_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "CGK", names: { en: "Jakarta Soekarno-Hatta", ja: "スカルノハッタ空港" }, latitude: -6.1256, longitude: 106.6558, transferMinutes: 70, internationalDepartureMinutes: 180, sourceUrl: "https://soekarnohatta-airport.co.id/en" },
      { code: "DPS", names: { en: "Bali Denpasar", ja: "デンパサール空港" }, latitude: -8.7482, longitude: 115.1675, transferMinutes: 40, internationalDepartureMinutes: 180, sourceUrl: "https://bali-airport.com/en" },
    ],
    cuisine: {
      en: ["a warung meal", "grilled seafood", "a coffee stop"],
      ja: ["ワルンの食事", "焼き魚・シーフード", "コーヒー休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "uae",
    names: { en: "United Arab Emirates", ja: "アラブ首長国連邦", ko: "아랍에미리트", zh: "阿联酋" },
    countryCodes: ["AE"],
    regionCode: "AE",
    querySuffix: "United Arab Emirates",
    timeZone: "Asia/Dubai",
    currency: { code: "AED", bandGlyph: "•" },
    center: { latitude: 24.4, longitude: 54.4 },
    overviewZoom: 7,
    bounds: { south: 22, west: 51, north: 26.5, east: 56.5 },
    mobility: "car_first",
    meals: { lunch: { start: hour(12, 30), end: hour(15) }, dinner: { start: hour(19), end: hour(22, 30) } },
    hotelFacts: null,
    airports: [
      { code: "DXB", names: { en: "Dubai", ja: "ドバイ空港" }, latitude: 25.2532, longitude: 55.3657, transferMinutes: 30, internationalDepartureMinutes: 180, sourceUrl: "https://www.dubaiairports.ae/" },
      { code: "AUH", names: { en: "Abu Dhabi", ja: "アブダビ空港" }, latitude: 24.433, longitude: 54.6511, transferMinutes: 45, internationalDepartureMinutes: 180, sourceUrl: "https://www.zayedinternationalairport.ae/en" },
    ],
    cuisine: {
      en: ["Emirati and Levantine food", "a mall food hall", "a café break"],
      ja: ["中東料理", "モールのフードホール", "カフェ休憩"],
    },
    notes: {
      en: ["Outdoor sightseeing is limited by heat from roughly June to September."],
      ja: ["6〜9月ごろは暑さで屋外の観光が制限される。"],
    },
    sample: null,
  },
  {
    id: "france",
    names: { en: "France", ja: "フランス", ko: "프랑스", zh: "法国" },
    countryCodes: ["FR", "MC"],
    regionCode: "FR",
    querySuffix: "France",
    timeZone: "Europe/Paris",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 46.6, longitude: 2.35 },
    overviewZoom: 6,
    bounds: { south: 41, west: -5.5, north: 51.5, east: 10 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(19, 30), end: hour(22) } },
    hotelFacts: null,
    airports: [
      { code: "CDG", names: { en: "Paris Charles de Gaulle", ja: "シャルル・ド・ゴール空港" }, latitude: 49.0097, longitude: 2.5479, transferMinutes: 50, internationalDepartureMinutes: 180, sourceUrl: "https://www.parisaeroport.fr/en" },
      { code: "ORY", names: { en: "Paris Orly", ja: "オルリー空港" }, latitude: 48.7233, longitude: 2.3794, transferMinutes: 40, internationalDepartureMinutes: 150, sourceUrl: "https://www.parisaeroport.fr/en" },
      { code: "NCE", names: { en: "Nice", ja: "ニース空港" }, latitude: 43.6584, longitude: 7.2159, transferMinutes: 25, internationalDepartureMinutes: 150, sourceUrl: "https://www.nice.aeroport.fr/en" },
    ],
    cuisine: {
      en: ["a bistro lunch", "a boulangerie stop", "a café terrace"],
      ja: ["ビストロのランチ", "ブーランジェリー", "カフェのテラス"],
    },
    notes: {
      en: [
        "Most national museums close one weekday — commonly Monday or Tuesday.",
        "Restaurant kitchens usually close between lunch and dinner service.",
      ],
      ja: [
        "国立美術館の多くは週に1日休館（月曜か火曜が多い）。",
        "レストランはランチとディナーの間に厨房を閉める店が多い。",
      ],
    },
    sample: null,
  },
  {
    id: "italy",
    names: { en: "Italy", ja: "イタリア", ko: "이탈리아", zh: "意大利" },
    countryCodes: ["IT", "VA", "SM"],
    regionCode: "IT",
    querySuffix: "Italy",
    timeZone: "Europe/Rome",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 42.5, longitude: 12.5 },
    overviewZoom: 6,
    bounds: { south: 35.4, west: 6.5, north: 47.2, east: 18.6 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12, 30), end: hour(14, 30) }, dinner: { start: hour(19, 30), end: hour(22) } },
    hotelFacts: null,
    airports: [
      { code: "FCO", names: { en: "Rome Fiumicino", ja: "ローマ フィウミチーノ空港" }, latitude: 41.8003, longitude: 12.2389, transferMinutes: 45, internationalDepartureMinutes: 180, sourceUrl: "https://www.adr.it/web/aeroporti-di-roma-en" },
      { code: "MXP", names: { en: "Milan Malpensa", ja: "ミラノ マルペンサ空港" }, latitude: 45.6306, longitude: 8.7281, transferMinutes: 55, internationalDepartureMinutes: 180, sourceUrl: "https://www.milanomalpensa-airport.com/en" },
      { code: "VCE", names: { en: "Venice Marco Polo", ja: "ヴェネツィア空港" }, latitude: 45.5053, longitude: 12.3519, transferMinutes: 45, internationalDepartureMinutes: 150, sourceUrl: "https://www.veniceairport.it/en/" },
    ],
    cuisine: {
      en: ["a trattoria meal", "a pizzeria", "an espresso bar"],
      ja: ["トラットリア", "ピッツェリア", "エスプレッソバール"],
    },
    notes: {
      en: [
        "Major sites (Uffizi, Last Supper, Colosseum) run on timed entry booked ahead.",
        "Many churches close in the early afternoon.",
      ],
      ja: [
        "主要施設（ウフィツィ、最後の晩餐、コロッセオなど）は事前予約の時間指定入場。",
        "教会は昼過ぎに閉まるところが多い。",
      ],
    },
    sample: null,
  },
  {
    id: "spain",
    names: { en: "Spain", ja: "スペイン", ko: "스페인", zh: "西班牙" },
    countryCodes: ["ES", "AD"],
    regionCode: "ES",
    querySuffix: "Spain",
    timeZone: "Europe/Madrid",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 40, longitude: -3.7 },
    overviewZoom: 6,
    bounds: { south: 27, west: -18.5, north: 44, east: 4.5 },
    mobility: "transit_first",
    // Spain really does eat this late; planning dinner at 18:30 books an empty room.
    meals: { lunch: { start: hour(14), end: hour(16) }, dinner: { start: hour(21), end: hour(23) } },
    hotelFacts: null,
    airports: [
      { code: "MAD", names: { en: "Madrid Barajas", ja: "マドリード バラハス空港" }, latitude: 40.4719, longitude: -3.5626, transferMinutes: 40, internationalDepartureMinutes: 180, sourceUrl: "https://www.aena.es/en/adolfo-suarez-madrid-barajas.html" },
      { code: "BCN", names: { en: "Barcelona El Prat", ja: "バルセロナ空港" }, latitude: 41.2974, longitude: 2.0833, transferMinutes: 35, internationalDepartureMinutes: 180, sourceUrl: "https://www.aena.es/en/josep-tarradellas-barcelona-el-prat.html" },
    ],
    cuisine: {
      en: ["tapas", "a menú del día lunch", "a café con leche stop"],
      ja: ["タパス", "メニュー・デル・ディア（日替わり定食）", "カフェ休憩"],
    },
    notes: {
      en: [
        "Lunch runs roughly 14:00–16:00 and dinner rarely starts before 21:00.",
        "Smaller shops close in the afternoon and reopen in the early evening.",
      ],
      ja: [
        "昼食は14〜16時、夕食は21時以降が普通。",
        "小さな店は午後に閉め、夕方に再開する。",
      ],
    },
    sample: null,
  },
  {
    id: "portugal",
    names: { en: "Portugal", ja: "ポルトガル", ko: "포르투갈", zh: "葡萄牙" },
    countryCodes: ["PT"],
    regionCode: "PT",
    querySuffix: "Portugal",
    timeZone: "Europe/Lisbon",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 39.5, longitude: -8 },
    overviewZoom: 7,
    bounds: { south: 30, west: -32, north: 42.5, east: -6 },
    mobility: "balanced",
    meals: { lunch: { start: hour(12, 30), end: hour(15) }, dinner: { start: hour(19, 30), end: hour(22) } },
    hotelFacts: null,
    airports: [
      { code: "LIS", names: { en: "Lisbon", ja: "リスボン空港" }, latitude: 38.7742, longitude: -9.1342, transferMinutes: 25, internationalDepartureMinutes: 180, sourceUrl: "https://www.ana.pt/en/lis/home" },
      { code: "OPO", names: { en: "Porto", ja: "ポルト空港" }, latitude: 41.2481, longitude: -8.6814, transferMinutes: 35, internationalDepartureMinutes: 150, sourceUrl: "https://www.ana.pt/en/opo/home" },
    ],
    cuisine: {
      en: ["a tasca meal", "grilled fish", "a pastelaria stop"],
      ja: ["タスカ（大衆食堂）", "魚のグリル", "パステラリア（菓子店）"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "uk",
    names: { en: "United Kingdom", ja: "イギリス", ko: "영국", zh: "英国" },
    countryCodes: ["GB"],
    regionCode: "GB",
    querySuffix: "United Kingdom",
    timeZone: "Europe/London",
    currency: { code: "GBP", bandGlyph: "£" },
    center: { latitude: 54, longitude: -2.5 },
    overviewZoom: 6,
    bounds: { south: 49, west: -11, north: 61, east: 2.2 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "LHR", names: { en: "London Heathrow", ja: "ヒースロー空港" }, latitude: 51.47, longitude: -0.4543, transferMinutes: 55, internationalDepartureMinutes: 180, sourceUrl: "https://www.heathrow.com/" },
      { code: "LGW", names: { en: "London Gatwick", ja: "ガトウィック空港" }, latitude: 51.1537, longitude: -0.1821, transferMinutes: 50, internationalDepartureMinutes: 180, sourceUrl: "https://www.gatwickairport.com/" },
      { code: "MAN", names: { en: "Manchester", ja: "マンチェスター空港" }, latitude: 53.3537, longitude: -2.275, transferMinutes: 25, internationalDepartureMinutes: 180, sourceUrl: "https://www.manchesterairport.co.uk/" },
    ],
    cuisine: {
      en: ["a pub meal", "a market food hall", "afternoon tea or a café"],
      ja: ["パブの食事", "マーケットのフードホール", "アフタヌーンティー・カフェ"],
    },
    notes: {
      en: ["Sunday opening hours are shorter, and pub kitchens often stop serving before the bar closes."],
      ja: ["日曜は営業時間が短い。パブは閉店前に厨房が終わることが多い。"],
    },
    sample: null,
  },
  {
    id: "germany",
    names: { en: "Germany", ja: "ドイツ", ko: "독일", zh: "德国" },
    countryCodes: ["DE"],
    regionCode: "DE",
    querySuffix: "Germany",
    timeZone: "Europe/Berlin",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 51.16, longitude: 10.45 },
    overviewZoom: 6,
    bounds: { south: 47, west: 5.5, north: 55.2, east: 15.2 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    sundayClosing: true,
    airports: [
      { code: "FRA", names: { en: "Frankfurt", ja: "フランクフルト空港" }, latitude: 50.0379, longitude: 8.5622, transferMinutes: 20, internationalDepartureMinutes: 180, sourceUrl: "https://www.frankfurt-airport.com/en.html" },
      { code: "MUC", names: { en: "Munich", ja: "ミュンヘン空港" }, latitude: 48.3538, longitude: 11.7861, transferMinutes: 45, internationalDepartureMinutes: 180, sourceUrl: "https://www.munich-airport.com/" },
      { code: "BER", names: { en: "Berlin Brandenburg", ja: "ベルリン空港" }, latitude: 52.3667, longitude: 13.5033, transferMinutes: 40, internationalDepartureMinutes: 180, sourceUrl: "https://ber.berlin-airport.de/en.html" },
    ],
    cuisine: {
      en: ["a Gasthaus meal", "a bakery or imbiss", "a Kaffee und Kuchen break"],
      ja: ["ガストハウスの食事", "パン屋・軽食スタンド", "コーヒーとケーキ"],
    },
    notes: {
      en: ["Shops close on Sundays; station supermarkets are the usual exception."],
      ja: ["日曜は商店が休業。駅のスーパーはだいたい例外。"],
    },
    sample: null,
  },
  {
    id: "austria",
    names: { en: "Austria", ja: "オーストリア", ko: "오스트리아", zh: "奥地利" },
    countryCodes: ["AT"],
    regionCode: "AT",
    querySuffix: "Austria",
    timeZone: "Europe/Vienna",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 47.52, longitude: 14.55 },
    overviewZoom: 7,
    bounds: { south: 46.3, west: 9.4, north: 49.1, east: 17.2 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    sundayClosing: true,
    airports: [
      { code: "VIE", names: { en: "Vienna", ja: "ウィーン空港" }, latitude: 48.1103, longitude: 16.5697, transferMinutes: 25, internationalDepartureMinutes: 180, sourceUrl: "https://www.viennaairport.com/en/passengers" },
      { code: "SZG", names: { en: "Salzburg", ja: "ザルツブルク空港" }, latitude: 47.7933, longitude: 13.0043, transferMinutes: 20, internationalDepartureMinutes: 120, sourceUrl: "https://www.salzburg-airport.com/en/" },
      { code: "INN", names: { en: "Innsbruck", ja: "インスブルック空港" }, latitude: 47.2602, longitude: 11.344, transferMinutes: 20, internationalDepartureMinutes: 120, sourceUrl: "https://www.innsbruck-airport.com/en" },
    ],
    cuisine: {
      en: ["a Gasthaus meal", "a Viennese coffee house", "a bakery stop"],
      ja: ["ガストハウスの食事", "ウィーンのカフェハウス", "パン屋"],
    },
    notes: {
      en: ["Shops close on Sundays; mountain lifts follow a summer/winter season calendar."],
      ja: ["日曜は商店が休業。山岳リフトは夏・冬のシーズン制で運休期間がある。"],
    },
    sample: null,
  },
  {
    id: "netherlands",
    names: { en: "Netherlands", ja: "オランダ", ko: "네덜란드", zh: "荷兰" },
    countryCodes: ["NL", "BE", "LU"],
    regionCode: "NL",
    querySuffix: "Netherlands",
    timeZone: "Europe/Amsterdam",
    currency: { code: "EUR", bandGlyph: "€" },
    center: { latitude: 52.13, longitude: 5.29 },
    overviewZoom: 8,
    bounds: { south: 49.4, west: 2.5, north: 53.7, east: 7.3 },
    mobility: "transit_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "AMS", names: { en: "Amsterdam Schiphol", ja: "スキポール空港" }, latitude: 52.3105, longitude: 4.7683, transferMinutes: 25, internationalDepartureMinutes: 180, sourceUrl: "https://www.schiphol.nl/en/" },
    ],
    cuisine: {
      en: ["a brown café meal", "a market stall", "a coffee and appeltaart stop"],
      ja: ["ブラウンカフェの食事", "市場の屋台", "コーヒーとアップルパイ"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "iceland",
    names: { en: "Iceland", ja: "アイスランド", ko: "아이슬란드", zh: "冰岛" },
    countryCodes: ["IS"],
    regionCode: "IS",
    querySuffix: "Iceland",
    timeZone: "Atlantic/Reykjavik",
    currency: { code: "ISK", bandGlyph: "•" },
    center: { latitude: 64.96, longitude: -19.02 },
    overviewZoom: 6,
    bounds: { south: 63, west: -25, north: 67, east: -13 },
    mobility: "car_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "KEF", names: { en: "Keflavík", ja: "ケプラヴィーク空港" }, latitude: 63.985, longitude: -22.6056, transferMinutes: 50, internationalDepartureMinutes: 150, sourceUrl: "https://www.isavia.is/en/keflavik-airport" },
    ],
    cuisine: {
      en: ["a soup or seafood stop", "a bakery", "a coffee break"],
      ja: ["スープ・シーフードの店", "ベーカリー", "コーヒー休憩"],
    },
    notes: {
      en: [
        "Daylight is very short in winter and roads close at short notice — check road.is before a driving day.",
        "Distances between stops are long; a day usually holds fewer places than it looks.",
      ],
      ja: [
        "冬は日照が非常に短く、道路も急に閉鎖される。運転する日は road.is を確認。",
        "拠点間の距離が長く、1日に入る場所は見た目より少ない。",
      ],
    },
    sample: null,
  },
  {
    id: "norway",
    names: { en: "Norway", ja: "ノルウェー", ko: "노르웨이", zh: "挪威" },
    countryCodes: ["NO"],
    regionCode: "NO",
    querySuffix: "Norway",
    timeZone: "Europe/Oslo",
    currency: { code: "NOK", bandGlyph: "•" },
    center: { latitude: 62, longitude: 10 },
    overviewZoom: 5,
    bounds: { south: 57.5, west: 4, north: 71.5, east: 31.5 },
    mobility: "balanced",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(17), end: hour(20, 30) } },
    hotelFacts: null,
    airports: [
      { code: "OSL", names: { en: "Oslo Gardermoen", ja: "オスロ空港" }, latitude: 60.1939, longitude: 11.1004, transferMinutes: 30, internationalDepartureMinutes: 150, sourceUrl: "https://avinor.no/en/airport/oslo-airport/" },
      { code: "BGO", names: { en: "Bergen", ja: "ベルゲン空港" }, latitude: 60.2934, longitude: 5.2181, transferMinutes: 30, internationalDepartureMinutes: 150, sourceUrl: "https://avinor.no/en/airport/bergen-airport/" },
    ],
    cuisine: {
      en: ["seafood", "a casual bistro", "a bakery and coffee stop"],
      ja: ["シーフード", "気軽なビストロ", "ベーカリーとコーヒー"],
    },
    notes: {
      en: ["Ferries and scenic rail run to a seasonal timetable that thins out sharply in winter."],
      ja: ["フェリーや観光列車は季節ダイヤ。冬は大幅に減便される。"],
    },
    sample: null,
  },
  {
    id: "usa",
    names: { en: "United States", ja: "アメリカ", ko: "미국", zh: "美国" },
    countryCodes: ["US"],
    regionCode: "US",
    querySuffix: "USA",
    // The country spans six zones; this one only seeds the default trip date,
    // which the traveller can change. Opening hours are always read in the
    // place's own local calendar day.
    timeZone: "America/New_York",
    currency: { code: "USD", bandGlyph: "$" },
    center: { latitude: 39.83, longitude: -98.58 },
    overviewZoom: 4,
    bounds: { south: 18, west: -172, north: 72, east: -66 },
    mobility: "car_first",
    meals: { lunch: { start: hour(11, 30), end: hour(14) }, dinner: { start: hour(17, 30), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "JFK", names: { en: "New York JFK", ja: "ニューヨーク JFK空港" }, latitude: 40.6413, longitude: -73.7781, transferMinutes: 60, internationalDepartureMinutes: 180, sourceUrl: "https://www.jfkairport.com/" },
      { code: "LAX", names: { en: "Los Angeles", ja: "ロサンゼルス空港" }, latitude: 33.9416, longitude: -118.4085, transferMinutes: 50, internationalDepartureMinutes: 180, sourceUrl: "https://www.flylax.com/" },
      { code: "SFO", names: { en: "San Francisco", ja: "サンフランシスコ空港" }, latitude: 37.6213, longitude: -122.379, transferMinutes: 40, internationalDepartureMinutes: 180, sourceUrl: "https://www.flysfo.com/" },
    ],
    cuisine: {
      en: ["a neighbourhood restaurant", "a diner or deli", "a coffee stop"],
      ja: ["近所のレストラン", "ダイナー・デリ", "コーヒー休憩"],
    },
    notes: {
      en: ["Outside the largest cities, transit between stops is thin — a rental car is usually the realistic plan."],
      ja: ["大都市以外は公共交通が薄く、レンタカー前提の方が現実的なことが多い。"],
    },
    sample: null,
  },
  {
    id: "canada",
    names: { en: "Canada", ja: "カナダ", ko: "캐나다", zh: "加拿大" },
    countryCodes: ["CA"],
    regionCode: "CA",
    querySuffix: "Canada",
    timeZone: "America/Toronto",
    currency: { code: "CAD", bandGlyph: "$" },
    center: { latitude: 56.13, longitude: -106.35 },
    overviewZoom: 3,
    bounds: { south: 41, west: -142, north: 84, east: -52 },
    mobility: "car_first",
    meals: { lunch: { start: hour(11, 30), end: hour(14) }, dinner: { start: hour(17, 30), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "YYZ", names: { en: "Toronto Pearson", ja: "トロント空港" }, latitude: 43.6777, longitude: -79.6248, transferMinutes: 40, internationalDepartureMinutes: 180, sourceUrl: "https://www.torontopearson.com/" },
      { code: "YVR", names: { en: "Vancouver", ja: "バンクーバー空港" }, latitude: 49.1967, longitude: -123.1815, transferMinutes: 30, internationalDepartureMinutes: 180, sourceUrl: "https://www.yvr.ca/en" },
    ],
    cuisine: {
      en: ["a neighbourhood restaurant", "a brunch spot", "a coffee stop"],
      ja: ["近所のレストラン", "ブランチの店", "コーヒー休憩"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "australia",
    names: { en: "Australia", ja: "オーストラリア", ko: "호주", zh: "澳大利亚" },
    countryCodes: ["AU"],
    regionCode: "AU",
    querySuffix: "Australia",
    timeZone: "Australia/Sydney",
    currency: { code: "AUD", bandGlyph: "$" },
    center: { latitude: -25.27, longitude: 133.78 },
    overviewZoom: 4,
    bounds: { south: -45, west: 110, north: -9, east: 155 },
    mobility: "car_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(18), end: hour(21) } },
    hotelFacts: null,
    airports: [
      { code: "SYD", names: { en: "Sydney", ja: "シドニー空港" }, latitude: -33.9399, longitude: 151.1753, transferMinutes: 30, internationalDepartureMinutes: 180, sourceUrl: "https://www.sydneyairport.com.au/" },
      { code: "MEL", names: { en: "Melbourne", ja: "メルボルン空港" }, latitude: -37.669, longitude: 144.841, transferMinutes: 35, internationalDepartureMinutes: 180, sourceUrl: "https://www.melbourneairport.com.au/" },
    ],
    cuisine: {
      en: ["a modern Australian meal", "a brunch café", "a bakery stop"],
      ja: ["モダン・オーストラリア料理", "ブランチのカフェ", "ベーカリー"],
    },
    notes: { en: [], ja: [] },
    sample: null,
  },
  {
    id: "newzealand",
    names: { en: "New Zealand", ja: "ニュージーランド", ko: "뉴질랜드", zh: "新西兰" },
    countryCodes: ["NZ"],
    regionCode: "NZ",
    querySuffix: "New Zealand",
    timeZone: "Pacific/Auckland",
    currency: { code: "NZD", bandGlyph: "$" },
    center: { latitude: -41, longitude: 173 },
    overviewZoom: 5,
    bounds: { south: -48, west: 165, north: -33, east: 179.5 },
    mobility: "car_first",
    meals: { lunch: { start: hour(12), end: hour(14) }, dinner: { start: hour(17, 30), end: hour(20, 30) } },
    hotelFacts: null,
    airports: [
      { code: "AKL", names: { en: "Auckland", ja: "オークランド空港" }, latitude: -37.0082, longitude: 174.785, transferMinutes: 45, internationalDepartureMinutes: 180, sourceUrl: "https://www.aucklandairport.co.nz/" },
      { code: "CHC", names: { en: "Christchurch", ja: "クライストチャーチ空港" }, latitude: -43.4894, longitude: 172.532, transferMinutes: 25, internationalDepartureMinutes: 150, sourceUrl: "https://www.christchurchairport.co.nz/" },
      { code: "ZQN", names: { en: "Queenstown", ja: "クイーンズタウン空港" }, latitude: -45.0211, longitude: 168.7392, transferMinutes: 15, internationalDepartureMinutes: 120, sourceUrl: "https://www.queenstownairport.co.nz/" },
    ],
    cuisine: {
      en: ["a local restaurant", "a brunch café", "a bakery stop"],
      ja: ["地元のレストラン", "ブランチのカフェ", "ベーカリー"],
    },
    notes: {
      en: ["Driving times between regions are long, and rural kitchens often close by 20:30."],
      ja: ["地方間の運転時間が長い。地方の飲食店は20時半ごろに厨房が閉まることが多い。"],
    },
    sample: null,
  },
];

/*
 * ── Traveller essentials ─────────────────────────────────────────────────
 * The handful of country facts that reliably trip people up abroad: the plug
 * in the wall, whether to tip, whether to drink the tap water, the number to
 * call, what a Japanese passport needs at the border, and the one transport
 * pass that changes the trip's budget. These are stable, well-documented
 * facts — but entry rules do change, so every entry line links to the
 * official source and is written as "verify before departure", never as a
 * guarantee.
 */

export type DestinationEssentials = {
  /** IEC plug letters and mains voltage, e.g. "C / J · 230V". */
  plug: string;
  tipping: { en: string; ja: string };
  emergency: { en: string; ja: string };
  /** Entry requirement for a Japanese passport; always verify officially. */
  entry: { en: string; ja: string; sourceUrl: string };
  /** The one pass that materially changes trip cost, if the country has one. */
  pass: { en: string; ja: string; url: string } | null;
  /** Official page for planned strikes/disruption, where a reliable one exists. */
  strikeInfo?: { en: string; ja: string; url: string };
};

const mofa = (path: string) => `https://www.mofa.go.jp/mofaj/area/${path}/index.html`;

const schengenEntry = (path: string) => ({
  en: "Japan passport: visa-free 90 days in any 180 (Schengen). ETIAS pre-travel authorisation is being introduced — check before departure.",
  ja: "日本のパスポート：シェンゲン圏はビザ不要（180日中90日）。ETIAS（電子渡航認証）の導入が予定されているため出発前に要確認。",
  sourceUrl: mofa(path),
});

const essentialsById: Partial<Record<DestinationId, DestinationEssentials>> = {
  japan: {
    plug: "A · 100V",
    tipping: { en: "No tipping anywhere.", ja: "チップの習慣なし。" },
    emergency: { en: "110 police · 119 fire/ambulance", ja: "110 警察 / 119 消防・救急" },
    entry: {
      en: "Japanese citizens need no visa or travel authorisation to enter Japan. Non-Japanese companions must check their own passport rules.",
      ja: "日本国籍は不要。外国籍の同行者は各自の旅券の条件を確認。",
      sourceUrl: "https://www.mofa.go.jp/j_info/visit/visa/index.html",
    },
    pass: {
      en: "Japan Rail Pass (overseas visitors only) can pay off on multi-city rail trips.",
      ja: "ジャパン・レール・パスは訪日外国人専用。日本国籍者は利用不可。",
      url: "https://japanrailpass.net/",
    },
  },
  switzerland: {
    plug: "C / J · 230V",
    tipping: { en: "Service included; rounding up is plenty.", ja: "サービス料込み。端数を切り上げる程度で十分。" },
    emergency: { en: "112 general · 117 police · 144 ambulance · 1414 Rega air rescue", ja: "112 共通 / 117 警察 / 144 救急 / 1414 山岳救助(Rega)" },
    entry: schengenEntry("switzerland"),
    pass: {
      en: "Swiss Travel Pass covers rail, bus, boat and most museums; the Half Fare Card halves mountain railways. Price the pass before buying single tickets.",
      ja: "スイストラベルパスは鉄道・バス・湖船・多くの美術館をカバー。山岳鉄道は半額カード適用。個別購入前にパスの損益分岐を確認する価値あり。",
      url: "https://www.myswitzerland.com/ja/planning/transport/tickets-public-transport/swiss-travel-pass/",
    },
  },
  korea: {
    plug: "C / F · 220V",
    tipping: { en: "No tipping.", ja: "チップの習慣なし。" },
    emergency: { en: "112 police · 119 fire/ambulance", ja: "112 警察 / 119 消防・救急" },
    entry: {
      en: "Japan passport: visa-free short stays; K-ETA requirement is periodically waived — check current status.",
      ja: "日本のパスポート：短期観光はビザ不要。K-ETAの要否は時期で変わるため出発前に要確認。",
      sourceUrl: mofa("korea"),
    },
    pass: null,
  },
  taiwan: {
    plug: "A / B · 110V",
    tipping: { en: "No tipping.", ja: "チップの習慣なし。" },
    emergency: { en: "110 police · 119 fire/ambulance", ja: "110 警察 / 119 消防・救急" },
    entry: {
      en: "Japan passport: visa-free 90 days.",
      ja: "日本のパスポート：90日以内はビザ不要。",
      sourceUrl: mofa("taiwan"),
    },
    pass: null,
  },
  hongkong: {
    plug: "G · 220V",
    tipping: { en: "10% service charge is usually added; loose change otherwise.", ja: "10%のサービス料が加算されることが多い。追加は小銭程度。" },
    emergency: { en: "999 all services", ja: "999（警察・消防・救急共通）" },
    entry: {
      en: "Japan passport: visa-free 90 days.",
      ja: "日本のパスポート：90日以内はビザ不要。",
      sourceUrl: mofa("hongkong"),
    },
    pass: null,
  },
  singapore: {
    plug: "G · 230V",
    tipping: { en: "No tipping; 10% service charge is built in.", ja: "チップ不要。10%サービス料込みが基本。" },
    emergency: { en: "999 police · 995 fire/ambulance", ja: "999 警察 / 995 消防・救急" },
    entry: {
      en: "Japan passport: visa-free short stays; submit the SG Arrival Card online before landing.",
      ja: "日本のパスポート：短期滞在はビザ不要。入国前にSGアライバルカード（電子入国申告）の提出が必要。",
      sourceUrl: mofa("singapore"),
    },
    pass: null,
  },
  thailand: {
    plug: "A / B / C / O · 220V",
    tipping: { en: "Not required; small notes appreciated at sit-down places.", ja: "必須ではない。レストランで少額を置く程度。" },
    emergency: { en: "191 police · 1669 ambulance · 1155 tourist police", ja: "191 警察 / 1669 救急 / 1155 ツーリストポリス" },
    entry: {
      en: "Japan passport: visa-free tourist stays; a digital arrival card may be required — check before departure.",
      ja: "日本のパスポート：観光はビザ不要。電子入国カード（TDAC）の要否を出発前に確認。",
      sourceUrl: mofa("thailand"),
    },
    pass: null,
  },
  vietnam: {
    plug: "A / C · 220V",
    tipping: { en: "Not expected; appreciated for guides and spas.", ja: "基本不要。ガイドやスパでは歓迎される。" },
    emergency: { en: "113 police · 115 ambulance", ja: "113 警察 / 115 救急" },
    entry: {
      en: "Japan passport: visa-free 45 days — verify the current limit.",
      ja: "日本のパスポート：45日以内はビザ不要（最新の日数は要確認）。",
      sourceUrl: mofa("vietnam"),
    },
    pass: null,
  },
  indonesia: {
    plug: "C / F · 230V",
    tipping: { en: "Not required; 5–10% at upscale places.", ja: "基本不要。高級店では5〜10%程度。" },
    emergency: { en: "110 police · 118 ambulance · 112 general (rollout)", ja: "110 警察 / 118 救急 / 112 共通(整備中)" },
    entry: {
      en: "Japan passport: Visa on Arrival (paid) at major airports — e-VOA can be bought online in advance.",
      ja: "日本のパスポート：到着ビザ（VOA・有料）が必要。事前にe-VOAをオンライン取得可能。",
      sourceUrl: mofa("indonesia"),
    },
    pass: null,
  },
  uae: {
    plug: "G · 230V",
    tipping: { en: "10% common; often already on the bill.", ja: "10%程度が一般的。伝票に含まれていることも多い。" },
    emergency: { en: "999 police · 998 ambulance", ja: "999 警察 / 998 救急" },
    entry: {
      en: "Japan passport: visa-free 30 days on arrival.",
      ja: "日本のパスポート：30日以内はビザ不要（到着時スタンプ）。",
      sourceUrl: mofa("uae"),
    },
    pass: null,
  },
  france: {
    plug: "C / E · 230V",
    tipping: { en: "Service included; leave coins for great service.", ja: "サービス料込み。良い接客に小銭を置く程度。" },
    emergency: { en: "112 general · 17 police · 15 SAMU", ja: "112 共通 / 17 警察 / 15 救急(SAMU)" },
    entry: schengenEntry("france"),
    pass: null,
    strikeInfo: {
      en: "French transport strikes are announced in advance — check SNCF traffic info for your dates.",
      ja: "フランスの交通ストは事前告知制。旅程の日付でSNCFの運行情報を確認。",
      url: "https://www.sncf-connect.com/en-en/trafficInfo",
    },
  },
  italy: {
    plug: "C / F / L · 230V",
    tipping: { en: "No tipping needed; coperto (cover charge) appears on bills.", ja: "チップ不要。コペルト（席料）が伝票に載るのは正規の慣習。" },
    emergency: { en: "112 all services", ja: "112（共通）" },
    entry: schengenEntry("italy"),
    pass: null,
    strikeInfo: {
      en: "Italian strikes are pre-announced on the transport ministry's official calendar — check it against your dates; guaranteed-service trains still run.",
      ja: "イタリアのストは交通省の公式カレンダーで事前告知される。旅程の日付と照合を。スト中も「運行保証便」は走る。",
      url: "https://scioperi.mit.gov.it/mit2/public/scioperi",
    },
  },
  spain: {
    plug: "C / F · 230V",
    tipping: { en: "Not expected; rounding up is fine.", ja: "基本不要。端数の切り上げ程度。" },
    emergency: { en: "112 all services", ja: "112（共通）" },
    entry: schengenEntry("spain"),
    pass: null,
  },
  portugal: {
    plug: "C / F · 230V",
    tipping: { en: "Round up ~5–10% for table service.", ja: "テーブルサービスで5〜10%目安の切り上げ。" },
    emergency: { en: "112 all services", ja: "112（共通）" },
    entry: schengenEntry("portugal"),
    pass: null,
  },
  uk: {
    plug: "G · 230V",
    tipping: { en: "10–12.5% at restaurants when service isn't added.", ja: "サービス料がなければレストランで10〜12.5%。" },
    emergency: { en: "999 (or 112) all services", ja: "999（112も可・共通）" },
    entry: {
      en: "Japan passport: ETA (electronic travel authorisation) required before travel; visa-free up to 6 months.",
      ja: "日本のパスポート：渡航前にETA（電子渡航認証）の取得が必要。観光は最長6か月ビザ不要。",
      sourceUrl: mofa("uk"),
    },
    pass: null,
  },
  germany: {
    plug: "C / F · 230V",
    tipping: { en: "Round up 5–10%; say the total when paying.", ja: "5〜10%の切り上げ。支払い時に合計額を告げる方式。" },
    emergency: { en: "112 fire/ambulance · 110 police", ja: "112 消防・救急 / 110 警察" },
    entry: schengenEntry("germany"),
    pass: null,
    strikeInfo: {
      en: "Check DB's live disruption page close to travel — rail strikes are announced, not spontaneous.",
      ja: "鉄道ストは事前告知制。直前にDBの運行情報ページを確認。",
      url: "https://www.bahn.de/service/fahrplaene/aktuell",
    },
  },
  austria: {
    plug: "C / F · 230V",
    tipping: { en: "Round up 5–10%.", ja: "5〜10%の切り上げが目安。" },
    emergency: { en: "112 general · 133 police · 144 ambulance", ja: "112 共通 / 133 警察 / 144 救急" },
    entry: schengenEntry("austria"),
    pass: null,
  },
  netherlands: {
    plug: "C / F · 230V",
    tipping: { en: "Not expected; round up if you like.", ja: "基本不要。端数の切り上げ程度。" },
    emergency: { en: "112 all services", ja: "112（共通）" },
    entry: schengenEntry("netherlands"),
    pass: null,
  },
  iceland: {
    plug: "C / F · 230V",
    tipping: { en: "No tipping.", ja: "チップの習慣なし。" },
    emergency: { en: "112 all services", ja: "112（共通）" },
    entry: schengenEntry("iceland"),
    pass: null,
  },
  norway: {
    plug: "C / F · 230V",
    tipping: { en: "Not expected; round up for good service.", ja: "基本不要。良い接客に切り上げ程度。" },
    emergency: { en: "112 police · 113 ambulance · 110 fire", ja: "112 警察 / 113 救急 / 110 消防" },
    entry: schengenEntry("norway"),
    pass: null,
  },
  usa: {
    plug: "A / B · 120V",
    tipping: { en: "18–20% expected at sit-down restaurants; tip counter service less.", ja: "レストランで18〜20%が事実上必須。カウンター店は少なめ。" },
    emergency: { en: "911 all services", ja: "911（共通）" },
    entry: {
      en: "Japan passport: ESTA required before travel (Visa Waiver Program).",
      ja: "日本のパスポート：渡航前にESTAの取得が必要（ビザ免除プログラム）。",
      sourceUrl: mofa("usa"),
    },
    pass: null,
  },
  canada: {
    plug: "A / B · 120V",
    tipping: { en: "15–20% at restaurants.", ja: "レストランで15〜20%が一般的。" },
    emergency: { en: "911 all services", ja: "911（共通）" },
    entry: {
      en: "Japan passport: eTA required before flying in.",
      ja: "日本のパスポート：空路入国は事前にeTAの取得が必要。",
      sourceUrl: mofa("canada"),
    },
    pass: null,
  },
  australia: {
    plug: "I · 230V",
    tipping: { en: "Not expected.", ja: "チップは基本不要。" },
    emergency: { en: "000 all services", ja: "000（共通）" },
    entry: {
      en: "Japan passport: ETA (subclass 601) required before travel.",
      ja: "日本のパスポート：渡航前にETA（サブクラス601）の取得が必要。",
      sourceUrl: mofa("australia"),
    },
    pass: null,
  },
  newzealand: {
    plug: "I · 230V",
    tipping: { en: "Not expected.", ja: "チップは基本不要。" },
    emergency: { en: "111 all services", ja: "111（共通）" },
    entry: {
      en: "Japan passport: NZeTA required before travel (plus IVL levy).",
      ja: "日本のパスポート：渡航前にNZeTAの取得が必要（IVL料金あり）。",
      sourceUrl: mofa("nz"),
    },
    pass: null,
  },
};

/** Traveller-basics card data; null when we have no verified facts to show. */
export function destinationEssentials(destination: Destination): DestinationEssentials | null {
  return essentialsById[destination.id] ?? null;
}

/*
 * ── Entry authorisations & passport validity ─────────────────────────────
 * The pre-trip timeline turns these into dated to-dos. Real travellers get
 * turned away at check-in over exactly two things encoded here: an electronic
 * authorisation they never heard of (ESTA at the counter, eTA for a mere
 * Vancouver transit) and a passport that is valid but not valid ENOUGH.
 * Figures verified 2026-08 against the linked official sites; no free API
 * exists for any of this, so the data is static by design and each item
 * carries its official URL for the user to re-verify.
 */

export type EntryAuthority = {
  /** What the airline agent will call it. */
  name: string;
  /** required now · not launched yet ("check again") · currently waived. */
  status: "required" | "not_yet" | "waived";
  /** Last calendar day covered by a temporary status such as a waiver. */
  statusValidUntil?: string;
  summary: { en: string; ja: string };
  /**
   * Days before arrival when applications OPEN (Thailand's TDAC and
   * Singapore's arrival card cannot be filed earlier); null = apply anytime.
   */
  opensDaysBefore: number | null;
  /** Have-it-done margin in days before departure; 0 = by the arrival day. */
  deadlineDaysBefore: number;
  /** True when even an airside transit through the country requires it. */
  transit: boolean;
  officialUrl: string;
};

export type PassportRule = {
  /**
   * Months of validity the border demands beyond the relevant date.
   * `entry` rules are measured from the first trip day; `departure` rules
   * are measured from the final trip day. 0 + departure means the passport
   * only needs to remain valid for the whole stay.
   */
  monthsBeyond: number;
  referenceDate: "entry" | "departure";
  /** A condition (other than expiry) that this product cannot verify. */
  additionalCheck?: { en: string; ja: string };
  summary: { en: string; ja: string };
  sourceUrl: string;
};

const etiasPending: EntryAuthority = {
  name: "ETIAS",
  status: "not_yet",
  summary: {
    en: "EU travel authorisation — NOT launched yet (2027 expected). Check the official page before departure and ignore paid lookalike sites.",
    ja: "EUの電子渡航認証。まだ開始されていない（2027年開始見込み）。出発前に公式ページで最新状況を確認。高額な非公式代行サイトに注意。",
  },
  opensDaysBefore: null,
  deadlineDaysBefore: 0,
  transit: false,
  officialUrl: "https://travel-europe.europa.eu/etias_en",
};

const entryAuthorityById: Partial<Record<DestinationId, EntryAuthority>> = {
  usa: {
    name: "ESTA",
    status: "required",
    summary: {
      en: "US$40.27, valid 2 years. Needed even for a transit. Apply at least 72 hours before departure.",
      ja: "US$40.27・有効2年。乗り継ぎだけでも必要。出発72時間前までの申請が推奨。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 3,
    transit: true,
    officialUrl: "https://esta.cbp.dhs.gov/",
  },
  uk: {
    name: "ETA",
    status: "required",
    summary: {
      en: "£20, valid 2 years. Usually minutes, allow 3 working days.",
      ja: "£20・有効2年。通常は数分〜、最大3営業日みておく。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 3,
    transit: false,
    officialUrl: "https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta",
  },
  canada: {
    name: "eTA",
    status: "required",
    summary: {
      en: "CA$7, valid 5 years. Needed even when only transiting a Canadian airport. Usually minutes, can take days.",
      ja: "CA$7・有効5年。カナダの空港で乗り継ぐだけでも必要（見落とし最多）。通常は数分だが数日かかる場合あり。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 3,
    transit: true,
    officialUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html",
  },
  australia: {
    name: "ETA (601)",
    status: "required",
    summary: {
      en: "AU$20, valid 1 year. Apply only via the AustralianETA app.",
      ja: "AU$20・有効1年。申請はAustralianETAアプリからのみ。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 3,
    transit: false,
    officialUrl: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601",
  },
  newzealand: {
    name: "NZeTA",
    status: "required",
    summary: {
      en: "NZ$17 (app) / NZ$23 (web) plus NZ$100 IVL levy, valid 2 years. Needed for Auckland transits too. Allow 72 hours.",
      ja: "NZ$17（アプリ）/ NZ$23（Web）+ IVL料 NZ$100・有効2年。オークランド乗り継ぎでも必要。72時間前までの申請推奨。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 3,
    transit: true,
    officialUrl: "https://www.immigration.govt.nz/visas/new-zealand-electronic-travel-authority-nzeta/",
  },
  korea: {
    name: "K-ETA",
    status: "waived",
    statusValidUntil: "2026-12-31",
    summary: {
      en: "Waived for Japanese passports until 31 Dec 2026 — re-check for later trips.",
      ja: "日本のパスポートは2026年12月31日まで免除。それ以降の旅行は要再確認。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 0,
    transit: false,
    officialUrl: "https://www.k-eta.go.kr/",
  },
  thailand: {
    name: "TDAC",
    status: "required",
    summary: {
      en: "Digital arrival card, free. Opens 72 hours before arrival — it cannot be filed earlier.",
      ja: "電子入国カード・無料。到着72時間前から提出可（それより早くは出せない）。",
    },
    opensDaysBefore: 3,
    deadlineDaysBefore: 0,
    transit: false,
    officialUrl: "https://tdac.immigration.go.th/",
  },
  singapore: {
    name: "SG Arrival Card",
    status: "required",
    summary: {
      en: "Free, mandatory. Opens 3 days before arrival, including the arrival day.",
      ja: "無料・必須。到着日を含む3日前から提出可。",
    },
    opensDaysBefore: 3,
    deadlineDaysBefore: 0,
    transit: false,
    officialUrl: "https://eservices.ica.gov.sg/sgarrivalcard/",
  },
  indonesia: {
    name: "e-VOA",
    status: "required",
    summary: {
      en: "Visa on Arrival, IDR 500,000. Buying the e-VOA online beforehand skips the airport queue.",
      ja: "到着ビザ（IDR 500,000・有料）。オンラインのe-VOAを事前取得すると空港の列を回避できる。",
    },
    opensDaysBefore: null,
    deadlineDaysBefore: 3,
    transit: false,
    officialUrl: "https://evisa.imigrasi.go.id/",
  },
  switzerland: etiasPending,
  france: etiasPending,
  italy: etiasPending,
  spain: etiasPending,
  portugal: etiasPending,
  germany: etiasPending,
  austria: etiasPending,
  netherlands: etiasPending,
  iceland: etiasPending,
  norway: etiasPending,
};

const anzen = "https://www.anzen.mofa.go.jp/";

const schengenPassport: PassportRule = {
  monthsBeyond: 3,
  referenceDate: "departure",
  additionalCheck: {
    en: "whether the passport was issued within the last 10 years",
    ja: "パスポートが発行から10年以内か",
  },
  summary: {
    en: "Passport must be valid 3+ months beyond leaving Schengen and issued within the last 10 years.",
    ja: "シェンゲン圏出国予定日から3ヶ月以上の残存+発行10年以内が必要。",
  },
  sourceUrl: anzen,
};

const sixMonthsAtEntry: PassportRule = {
  monthsBeyond: 6,
  referenceDate: "entry",
  summary: {
    en: "Passport must be valid 6+ months at entry.",
    ja: "入国時点で6ヶ月以上の残存有効期間が必要。",
  },
  sourceUrl: anzen,
};

const validForStay: PassportRule = {
  monthsBeyond: 0,
  referenceDate: "departure",
  summary: {
    en: "Passport must be valid for the whole stay (comfortable margin recommended).",
    ja: "滞在全期間有効であればよい（余裕を持つのが安全）。",
  },
  sourceUrl: anzen,
};

const passportRuleById: Partial<Record<DestinationId, PassportRule>> = {
  switzerland: schengenPassport,
  france: schengenPassport,
  italy: schengenPassport,
  spain: schengenPassport,
  portugal: schengenPassport,
  germany: schengenPassport,
  austria: schengenPassport,
  netherlands: schengenPassport,
  iceland: schengenPassport,
  norway: schengenPassport,
  thailand: sixMonthsAtEntry,
  singapore: sixMonthsAtEntry,
  vietnam: sixMonthsAtEntry,
  indonesia: sixMonthsAtEntry,
  uae: sixMonthsAtEntry,
  usa: validForStay,
  uk: validForStay,
  canada: validForStay,
  korea: validForStay,
  taiwan: validForStay,
  hongkong: {
    monthsBeyond: 1,
    referenceDate: "departure",
    summary: {
      en: "Passport must be valid 1+ month beyond the stay.",
      ja: "滞在期間+1ヶ月以上の残存有効期間が必要。",
    },
    sourceUrl: anzen,
  },
  australia: validForStay,
  newzealand: {
    monthsBeyond: 3,
    referenceDate: "departure",
    summary: {
      en: "Passport must be valid 3+ months beyond your departure from NZ.",
      ja: "NZ出国予定日から3ヶ月以上の残存有効期間が必要。",
    },
    sourceUrl: anzen,
  },
};

export function destinationEntryAuthority(destination: Destination): EntryAuthority | null {
  return entryAuthorityById[destination.id] ?? null;
}

export function destinationPassportRule(destination: Destination): PassportRule | null {
  return passportRuleById[destination.id] ?? null;
}

export const destinations: readonly Destination[] = destinationList;

const byId = new Map(destinationList.map((destination) => [destination.id, destination]));
const byCountryCode = new Map(
  destinationList.flatMap((destination) => destination.countryCodes.map((code) => [code, destination] as const)),
);

export const WORLDWIDE = byId.get("worldwide")!;

export function isDestinationId(value: unknown): value is DestinationId {
  return typeof value === "string" && byId.has(value as DestinationId);
}

export function isDestinationChoice(value: unknown): value is DestinationChoice {
  return value === "auto" || isDestinationId(value);
}

/** Never throws: an unknown or absent id means "no local knowledge yet". */
export function destinationById(value: unknown): Destination {
  return (isDestinationId(value) ? byId.get(value) : undefined) ?? WORLDWIDE;
}

/** ISO 3166-1 alpha-2, as returned in a Google address component. */
export function destinationForCountryCode(code: unknown): Destination | null {
  return typeof code === "string" ? byCountryCode.get(code.trim().toUpperCase()) ?? null : null;
}

export function withinBounds(bounds: GeoBounds | null, latitude: number, longitude: number) {
  if (!bounds) return true;
  return latitude >= bounds.south && latitude <= bounds.north
    && longitude >= bounds.west && longitude <= bounds.east;
}

function boundsArea(bounds: GeoBounds) {
  return (bounds.north - bounds.south) * (bounds.east - bounds.west);
}

/**
 * Last-resort inference when a resolution carried no country component.
 * Country boxes overlap heavily in Europe, so the tightest box that contains
 * the point wins: Zermatt sits inside France's and Italy's rectangles too, but
 * only Switzerland's is drawn that small. This is a fallback — Google's own
 * country component is the primary answer and always outranks it.
 */
export function destinationForCoordinate(latitude: number, longitude: number): Destination | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  let best: { destination: Destination; area: number } | null = null;
  for (const destination of destinationList) {
    if (!destination.bounds || !withinBounds(destination.bounds, latitude, longitude)) continue;
    const area = boundsArea(destination.bounds);
    if (best === null || area < best.area) best = { destination, area };
  }
  return best?.destination ?? null;
}

/** The disambiguating text query Google receives for a bare place name. */
export function destinationPlaceQuery(input: string, destination: Destination, languageCode: "en" | "ja" = "en") {
  if (!destination.querySuffix) return input;
  // A Japanese query with an English country word degrades Google's ranking
  // ("ベルン旧市街 Switzerland" returns the university, not the Old Town), so
  // the disambiguating suffix follows the query's language.
  const suffix = languageCode === "ja" ? destination.names.ja : destination.querySuffix;
  return suffix ? `${input} ${suffix}` : input;
}

/** Google's four relative price levels rendered in the local currency glyph. */
export function priceBandSymbols(destination: Destination) {
  const glyph = [...destination.currency.bandGlyph][0] ?? "•";
  return [glyph, glyph.repeat(2), glyph.repeat(3), glyph.repeat(4)] as const;
}

export function destinationAirport(destination: Destination, code: string | null | undefined) {
  if (!code || code === "none") return null;
  return destination.airports.find((airport) => airport.code === code) ?? null;
}

/**
 * Returns only airports that serve the same metropolitan base as `anchorCode`.
 * With no anchor, the destination's first supported comparison group is used.
 * An unpaired selected airport deliberately returns no alternatives rather
 * than suggesting an airport in a different city.
 */
export function destinationAirportComparisonGroup(
  destination: Destination,
  anchorCode?: string | null,
): DestinationAirport[] {
  const normalized = anchorCode?.trim().toUpperCase() || null;
  const normalizedAnchor = normalized === "NONE" ? null : normalized;
  const group = normalizedAnchor
    ? airportMetroGroups.find((codes) => (codes as readonly string[]).includes(normalizedAnchor))
    : airportMetroGroups.find((codes) => codes.every((code) => destinationAirport(destination, code)));
  if (!group) return [];
  if (normalizedAnchor && !destinationAirport(destination, normalizedAnchor)) return [];
  const airports = group.flatMap((code) => {
    const airport = destinationAirport(destination, code);
    return airport ? [airport] : [];
  });
  return airports.length >= 2 ? airports : [];
}

export function destinationName(destination: Destination, locale: Locale) {
  return destination.names[locale] ?? destination.names.en;
}

/** Options for the destination picker: auto first, then curated countries A→Z. */
export function destinationOptions(locale: Locale) {
  const named = destinationList
    .filter((destination) => destination.id !== "worldwide")
    .map((destination) => ({ value: destination.id as DestinationChoice, label: destinationName(destination, locale) }))
    .sort((left, right) => left.label.localeCompare(right.label, locale === "ja" ? "ja" : "en"));
  return [
    { value: "auto" as DestinationChoice, label: locale === "ja" ? "自動判定" : "Detect automatically" },
    ...named,
    { value: "worldwide" as DestinationChoice, label: destinationName(WORLDWIDE, locale) },
  ];
}

/** UTC offset of an IANA zone at an instant, in minutes; null for an unknown zone. */
export function utcOffsetMinutesAt(instant: Date, timeZone: string) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((candidate) => candidate.type === "timeZoneName")?.value;
  // "GMT" (UTC exactly) or "GMT±HH:MM".
  const match = part?.match(/^GMT(?:([+-])(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * "2026-08-09" + "09:30" in Europe/Zurich → "2026-08-09T09:30:00+02:00".
 * A local wall time only becomes an instant once the zone's offset at that
 * moment is known, and the offset itself depends on the instant (DST), so the
 * guess is refined until it agrees with itself. Returns null for a malformed
 * input or an unknown zone rather than silently stamping the wrong country's
 * offset on a departure time.
 */
export function localDateTimeWithOffset(date: string, time: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const wallClockAsUtc = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(wallClockAsUtc)) return null;
  try {
    let offsetMinutes = 0;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const next = utcOffsetMinutesAt(new Date(wallClockAsUtc - offsetMinutes * 60_000), timeZone);
      if (next === null) return null;
      if (next === offsetMinutes) break;
      offsetMinutes = next;
    }
    const sign = offsetMinutes < 0 ? "-" : "+";
    const absolute = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
    const minutes = String(absolute % 60).padStart(2, "0");
    return `${date}T${time}:00${sign}${hours}:${minutes}`;
  } catch {
    return null;
  }
}

/** Today's calendar date in the destination, so "tomorrow" means their tomorrow. */
export function localDateIn(timeZone: string, at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
