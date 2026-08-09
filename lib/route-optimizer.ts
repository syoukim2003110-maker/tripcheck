import type { Locale } from "./i18n.ts";

export type RouteStop = {
  id: string;
  /** Provider identity kept separately from TripCheck's stable local id. */
  providerRef?: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
  sourceUrl: string;
  verifiedAt: string;
  confidence: "low" | "medium";
  planningDurationMinutes: number;
  isAnchor: boolean;
  isUserEntered?: boolean;
  /** Coordinates explicitly confirmed by the traveller, not provider-verified. */
  userProvidedCoordinates?: boolean;
};

export type ResolvedInputStop = RouteStop & {
  input: string;
  /** Stable within the currently reviewed paste; lets duplicate names be corrected independently. */
  inputIndex?: number;
  address: string;
  /** Google place types retained so a hotel-field result can be classified as lodging or an area anchor. */
  placeTypes?: string[];
  /** ISO 3166-1 alpha-2 from Google's address components; drives destination auto-detection. */
  countryCode?: string;
};

export type OptimizedRouteDay = {
  label: string;
  originalStops: RouteStop[];
  optimizedStops: RouteStop[];
  originalDistanceKm: number;
  optimizedDistanceKm: number;
  distanceSavedKm: number;
  changed: boolean;
  exact: boolean;
  googleMapsUrl: string;
};

export type RouteOptimization = {
  recognizedStopCount: number;
  originalDistanceKm: number;
  optimizedDistanceKm: number;
  distanceSavedKm: number;
  days: OptimizedRouteDay[];
};

type Localized = Record<Locale, string>;

type CatalogPoi = Omit<RouteStop, "name" | "area" | "isAnchor"> & {
  name: Localized;
  area: Localized;
  aliases: RegExp[];
  reservationSensitive?: boolean;
};

const poiCatalog: CatalogPoi[] = [
  {
    id: "tsukiji-market",
    name: { en: "Tsukiji Outer Market", ja: "築地場外市場", ko: "쓰키지 장외시장", zh: "筑地场外市场" },
    area: { en: "Tsukiji", ja: "築地", ko: "쓰키지", zh: "筑地" },
    latitude: 35.6655,
    longitude: 139.7708,
    sourceUrl: "https://www.tsukiji.or.jp/english/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    aliases: [/tsukiji(?:\s+outer)?\s+market/i, /築地(?:場外市場)?/, /쓰키지(?:\s*장외시장)?/, /筑地(?:场外市场)?/],
  },
  {
    id: "teamlab-planets",
    name: { en: "teamLab Planets", ja: "チームラボプラネッツ", ko: "팀랩 플래닛", zh: "teamLab Planets" },
    area: { en: "Toyosu", ja: "豊洲", ko: "도요스", zh: "丰洲" },
    latitude: 35.6491,
    longitude: 139.7898,
    sourceUrl: "https://www.teamlab.art/e/planets/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    reservationSensitive: true,
    aliases: [/teamlab\s+planets/i, /チームラボプラネッツ/, /팀랩\s*플래닛/, /teamlab\s*无界/i],
  },
  {
    id: "sensoji",
    name: { en: "Senso-ji", ja: "浅草寺", ko: "센소지", zh: "浅草寺" },
    area: { en: "Asakusa", ja: "浅草", ko: "아사쿠사", zh: "浅草" },
    latitude: 35.7148,
    longitude: 139.7967,
    sourceUrl: "https://www.senso-ji.jp/english/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 75,
    aliases: [/senso-?ji/i, /浅草寺/, /센소지/],
  },
  {
    id: "asakusa",
    name: { en: "Asakusa", ja: "浅草", ko: "아사쿠사", zh: "浅草" },
    area: { en: "Asakusa", ja: "浅草", ko: "아사쿠사", zh: "浅草" },
    latitude: 35.7119,
    longitude: 139.7983,
    sourceUrl: "https://e-asakusa.jp/en/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    aliases: [/asakusa/i, /浅草(?!寺)/, /아사쿠사/],
  },
  {
    id: "tokyo-skytree",
    name: { en: "Tokyo Skytree", ja: "東京スカイツリー", ko: "도쿄 스카이트리", zh: "东京晴空塔" },
    area: { en: "Oshiage", ja: "押上", ko: "오시아게", zh: "押上" },
    latitude: 35.7101,
    longitude: 139.8107,
    sourceUrl: "https://www.tokyo-skytree.jp/en/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/tokyo\s+skytree/i, /(?:東京)?スカイツリー/, /(?:도쿄\s*)?스카이트리/, /(?:东京)?晴空塔/],
  },
  {
    id: "akihabara",
    name: { en: "Akihabara", ja: "秋葉原", ko: "아키하바라", zh: "秋叶原" },
    area: { en: "Akihabara", ja: "秋葉原", ko: "아키하바라", zh: "秋叶原" },
    latitude: 35.6984,
    longitude: 139.7731,
    sourceUrl: "https://www.gotokyo.org/en/story/walks-and-tours/akihabara/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/akihabara/i, /秋葉原/, /아키하바라/, /秋叶原/],
  },
  {
    id: "ueno-park",
    name: { en: "Ueno Park", ja: "上野公園", ko: "우에노 공원", zh: "上野公园" },
    area: { en: "Ueno", ja: "上野", ko: "우에노", zh: "上野" },
    latitude: 35.7148,
    longitude: 139.7732,
    sourceUrl: "https://www.kensetsu.metro.tokyo.lg.jp/jimusho/toubuk/ueno/en_index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/ueno\s+park/i, /上野公園/, /우에노\s*공원/, /上野公园/],
  },
  {
    id: "tokyo-station",
    name: { en: "Tokyo Station", ja: "東京駅", ko: "도쿄역", zh: "东京站" },
    area: { en: "Marunouchi", ja: "丸の内", ko: "마루노우치", zh: "丸之内" },
    latitude: 35.6812,
    longitude: 139.7671,
    sourceUrl: "https://www.jreast.co.jp/e/stations/e1039.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 60,
    aliases: [/tokyo\s+station/i, /東京駅/, /도쿄역/, /东京站/],
  },
  {
    id: "imperial-palace",
    name: { en: "Imperial Palace", ja: "皇居", ko: "고쿄", zh: "皇居" },
    area: { en: "Chiyoda", ja: "千代田", ko: "지요다", zh: "千代田" },
    latitude: 35.6852,
    longitude: 139.7528,
    sourceUrl: "https://sankan.kunaicho.go.jp/english/guide/koukyo.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    aliases: [/imperial\s+palace/i, /皇居/, /고쿄/],
  },
  {
    id: "tokyo-tower",
    name: { en: "Tokyo Tower", ja: "東京タワー", ko: "도쿄 타워", zh: "东京塔" },
    area: { en: "Shibakoen", ja: "芝公園", ko: "시바코엔", zh: "芝公园" },
    latitude: 35.6586,
    longitude: 139.7454,
    sourceUrl: "https://www.gotokyo.org/en/spot/4/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    aliases: [/tokyo\s+tower/i, /東京タワー/, /도쿄\s*타워/, /东京塔/],
  },
  {
    id: "roppongi-hills",
    name: { en: "Roppongi Hills", ja: "六本木ヒルズ", ko: "롯폰기 힐즈", zh: "六本木新城" },
    area: { en: "Roppongi", ja: "六本木", ko: "롯폰기", zh: "六本木" },
    latitude: 35.6605,
    longitude: 139.7292,
    sourceUrl: "https://www.gotokyo.org/en/destinations/southern-tokyo/roppongi/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/roppongi\s+hills/i, /六本木ヒルズ/, /롯폰기\s*힐즈/, /六本木新城/],
  },
  {
    id: "meiji-jingu",
    name: { en: "Meiji Jingu", ja: "明治神宮", ko: "메이지 신궁", zh: "明治神宫" },
    area: { en: "Harajuku", ja: "原宿", ko: "하라주쿠", zh: "原宿" },
    latitude: 35.6764,
    longitude: 139.6993,
    sourceUrl: "https://www.meijijingu.or.jp/en/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    aliases: [/meiji\s+(?:jingu|shrine)/i, /明治神宮/, /메이지\s*신궁/, /明治神宫/],
  },
  {
    id: "harajuku",
    name: { en: "Harajuku", ja: "原宿", ko: "하라주쿠", zh: "原宿" },
    area: { en: "Harajuku", ja: "原宿", ko: "하라주쿠", zh: "原宿" },
    latitude: 35.6702,
    longitude: 139.7027,
    sourceUrl: "https://www.gotokyo.org/en/destinations/western-tokyo/harajuku/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/harajuku/i, /原宿/, /하라주쿠/],
  },
  {
    id: "shibuya-sky",
    name: { en: "Shibuya Sky", ja: "渋谷スカイ", ko: "시부야 스카이", zh: "涩谷SKY" },
    area: { en: "Shibuya", ja: "渋谷", ko: "시부야", zh: "涩谷" },
    latitude: 35.6584,
    longitude: 139.7016,
    sourceUrl: "https://www.shibuya-scramble-square.com/sky/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    reservationSensitive: true,
    aliases: [/shibuya\s+sky/i, /渋谷スカイ/, /시부야\s*스카이/, /涩谷\s*sky/i],
  },
  {
    id: "shibuya",
    name: { en: "Shibuya", ja: "渋谷", ko: "시부야", zh: "涩谷" },
    area: { en: "Shibuya", ja: "渋谷", ko: "시부야", zh: "涩谷" },
    latitude: 35.6595,
    longitude: 139.7005,
    sourceUrl: "https://www.gotokyo.org/en/destinations/western-tokyo/shibuya/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/shibuya(?!\s+sky)/i, /渋谷(?!スカイ)/, /시부야(?!\s*스카이)/, /涩谷(?!\s*sky)/i],
  },
  {
    id: "shinjuku",
    name: { en: "Shinjuku", ja: "新宿", ko: "신주쿠", zh: "新宿" },
    area: { en: "Shinjuku", ja: "新宿", ko: "신주쿠", zh: "新宿" },
    latitude: 35.6909,
    longitude: 139.7003,
    sourceUrl: "https://www.gotokyo.org/en/destinations/western-tokyo/shinjuku/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    aliases: [/shinjuku/i, /新宿/, /신주쿠/],
  },
  {
    id: "golden-gai",
    name: { en: "Golden Gai", ja: "ゴールデン街", ko: "골든가이", zh: "黄金街" },
    area: { en: "Shinjuku", ja: "新宿", ko: "신주쿠", zh: "新宿" },
    latitude: 35.6941,
    longitude: 139.7047,
    sourceUrl: "https://www.gotokyo.org/en/spot/62/index.html",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 90,
    aliases: [/golden\s+gai/i, /ゴールデン街/, /골든가이/, /黄金街/],
  },
  {
    id: "ghibli-museum",
    name: { en: "Ghibli Museum", ja: "三鷹の森ジブリ美術館", ko: "지브리 미술관", zh: "吉卜力美术馆" },
    area: { en: "Mitaka", ja: "三鷹", ko: "미타카", zh: "三鹰" },
    latitude: 35.6962,
    longitude: 139.5704,
    sourceUrl: "https://www.ghibli-museum.jp/en/",
    verifiedAt: "2026-07-17",
    confidence: "medium",
    planningDurationMinutes: 120,
    reservationSensitive: true,
    aliases: [/ghibli\s+museum/i, /(?:三鷹の森)?ジブリ美術館/, /지브리\s*미술관/, /吉卜力美术馆/],
  },
];

function dayHeading(line: string) {
  return /^(?:day\s*\d+|\d+\s*日目|\d+\s*일차|第?\s*\d+\s*天)(?:\s*[-–—:].*)?$/i.test(line);
}

const explicitAnchorPattern = /\b(?:booked|booking|reserved|reservation|ticket|fixed|must[- ]?do)\b|予約|確定|チケット|예매|예약|티켓|预订|预约|门票/i;

function toStop(poi: CatalogPoi, locale: Locale, line: string): RouteStop {
  return {
    id: poi.id,
    name: poi.name[locale],
    area: poi.area[locale],
    latitude: poi.latitude,
    longitude: poi.longitude,
    sourceUrl: poi.sourceUrl,
    verifiedAt: poi.verifiedAt,
    confidence: poi.confidence,
    planningDurationMinutes: poi.planningDurationMinutes,
    isAnchor: Boolean(poi.reservationSensitive || explicitAnchorPattern.test(line)),
  };
}

export function resolveKnownStops(line: string, locale: Locale = "en") {
  const matches = poiCatalog.flatMap((poi) => {
    const indices = poi.aliases
      .map((alias) => alias.exec(line)?.index)
      .filter((index): index is number => index !== undefined);
    return indices.length > 0 ? [{ index: Math.min(...indices), stop: toStop(poi, locale, line) }] : [];
  });

  matches.sort((a, b) => a.index - b.index);
  return matches.map((match) => match.stop);
}

export function straightLineDistanceKm(a: RouteStop, b: RouteStop) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = radians(b.latitude - a.latitude);
  const deltaLongitude = radians(b.longitude - a.longitude);
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const h = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function routeDistance(stops: RouteStop[]) {
  return stops.slice(1).reduce((sum, stop, index) => sum + straightLineDistanceKm(stops[index], stop), 0);
}

export function optimizeKnownStopOrder(stops: RouteStop[], preserveFirst = true) {
  if (stops.length <= 1) return [...stops];
  const optimizeFromFirst = (candidate: RouteStop[]) => candidate.length <= 10 ? exactOpenPath(candidate) : heuristicOpenPath(candidate);
  if (preserveFirst) return optimizeFromFirst(stops);

  let best = optimizeFromFirst(stops);
  let bestDistance = routeDistance(best);
  for (let index = 1; index < stops.length; index += 1) {
    const candidateInput = [stops[index], ...stops.slice(0, index), ...stops.slice(index + 1)];
    const candidate = optimizeFromFirst(candidateInput);
    const candidateDistance = routeDistance(candidate);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }
  return best;
}

function exactOpenPath(stops: RouteStop[]) {
  const count = stops.length;
  const fullMask = (1 << count) - 1;
  const distance = Array.from({ length: 1 << count }, () => Array<number>(count).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: 1 << count }, () => Array<number>(count).fill(-1));
  const anchorIndices = stops.flatMap((stop, index) => stop.isAnchor ? [index] : []);
  distance[1][0] = 0;

  for (let mask = 1; mask <= fullMask; mask += 1) {
    if ((mask & 1) === 0) continue;
    for (let last = 0; last < count; last += 1) {
      if ((mask & (1 << last)) === 0 || !Number.isFinite(distance[mask][last])) continue;
      for (let next = 1; next < count; next += 1) {
        if (mask & (1 << next)) continue;
        const anchorPosition = anchorIndices.indexOf(next);
        if (anchorPosition > 0 && anchorIndices.slice(0, anchorPosition).some((index) => (mask & (1 << index)) === 0)) continue;
        const nextMask = mask | (1 << next);
        const candidate = distance[mask][last] + straightLineDistanceKm(stops[last], stops[next]);
        if (candidate < distance[nextMask][next]) {
          distance[nextMask][next] = candidate;
          previous[nextMask][next] = last;
        }
      }
    }
  }

  let last = 0;
  for (let index = 1; index < count; index += 1) {
    if (distance[fullMask][index] < distance[fullMask][last]) last = index;
  }

  const order: number[] = [];
  let mask = fullMask;
  while (last >= 0) {
    order.push(last);
    const parent = previous[mask][last];
    mask ^= 1 << last;
    last = parent;
  }

  return order.reverse().map((index) => stops[index]);
}

function heuristicOpenPath(stops: RouteStop[]) {
  const remaining = stops.slice(1);
  const route = [stops[0]];
  const anchorOrder = stops.filter((stop) => stop.isAnchor).map((stop) => stop.id);
  const preservesAnchorOrder = (candidate: RouteStop[]) => {
    const candidateAnchors = candidate.filter((stop) => stop.isAnchor).map((stop) => stop.id);
    return candidateAnchors.every((id, index) => id === anchorOrder[index]);
  };
  while (remaining.length > 0) {
    const current = route.at(-1)!;
    const nextRequiredAnchor = anchorOrder.find((id) => !route.some((stop) => stop.id === id));
    const eligibleIndices = remaining.flatMap((stop, index) => !stop.isAnchor || stop.id === nextRequiredAnchor ? [index] : []);
    let nearestIndex = eligibleIndices[0];
    let nearestDistance = straightLineDistanceKm(current, remaining[nearestIndex]);
    for (const index of eligibleIndices.slice(1)) {
      const candidate = straightLineDistanceKm(current, remaining[index]);
      if (candidate < nearestDistance) {
        nearestDistance = candidate;
        nearestIndex = index;
      }
    }
    route.push(remaining.splice(nearestIndex, 1)[0]);
  }

  let improved = true;
  while (improved) {
    improved = false;
    for (let start = 1; start < route.length - 2; start += 1) {
      for (let end = start + 1; end < route.length - 1; end += 1) {
        const candidate = [...route.slice(0, start), ...route.slice(start, end + 1).reverse(), ...route.slice(end + 1)];
        if (preservesAnchorOrder(candidate) && routeDistance(candidate) + 0.001 < routeDistance(route)) {
          route.splice(0, route.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return route;
}

export function buildGoogleMapsUrl(stops: RouteStop[], travelMode: "transit" | "walking" | "driving" = "transit") {
  const visibleStops = stops.slice(0, 10);
  const coordinate = (stop: RouteStop) => `${stop.latitude},${stop.longitude}`;
  const params = new URLSearchParams({
    api: "1",
    origin: coordinate(visibleStops[0]),
    destination: coordinate(visibleStops.at(-1)!),
    travelmode: travelMode,
  });
  if (visibleStops.length > 2) {
    params.set("waypoints", visibleStops.slice(1, -1).map(coordinate).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function optimizeItineraryRoute(raw: string, locale: Locale = "en"): RouteOptimization {
  const parsedDays: Array<{ label: string; stops: RouteStop[] }> = [];
  let current = { label: locale === "ja" ? "1日目" : locale === "ko" ? "1일차" : locale === "zh" ? "第1天" : "Day 1", stops: [] as RouteStop[] };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (dayHeading(line)) {
      if (current.stops.length > 0) parsedDays.push(current);
      current = { label: line.replace(/\s*[-–—:].*$/, ""), stops: [] };
      continue;
    }
    for (const stop of resolveKnownStops(line, locale)) {
      if (!current.stops.some((candidate) => candidate.id === stop.id)) current.stops.push(stop);
    }
  }
  if (current.stops.length > 0) parsedDays.push(current);

  const days = parsedDays
    .filter((day) => day.stops.length >= 2)
    .map((day): OptimizedRouteDay => {
      const exact = day.stops.length <= 10;
      const optimizedStops = exact ? exactOpenPath(day.stops) : heuristicOpenPath(day.stops);
      const originalDistanceKm = routeDistance(day.stops);
      const optimizedDistanceKm = routeDistance(optimizedStops);
      const distanceSavedKm = Math.max(0, originalDistanceKm - optimizedDistanceKm);
      return {
        label: day.label,
        originalStops: day.stops,
        optimizedStops,
        originalDistanceKm,
        optimizedDistanceKm,
        distanceSavedKm,
        changed: day.stops.some((stop, index) => stop.id !== optimizedStops[index]?.id),
        exact,
        googleMapsUrl: buildGoogleMapsUrl(optimizedStops),
      };
    });

  return {
    recognizedStopCount: parsedDays.reduce((sum, day) => sum + day.stops.length, 0),
    originalDistanceKm: days.reduce((sum, day) => sum + day.originalDistanceKm, 0),
    optimizedDistanceKm: days.reduce((sum, day) => sum + day.optimizedDistanceKm, 0),
    distanceSavedKm: days.reduce((sum, day) => sum + day.distanceSavedKm, 0),
    days,
  };
}
