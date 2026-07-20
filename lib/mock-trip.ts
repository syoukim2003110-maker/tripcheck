import type { Locale } from "./i18n.ts";

type Localized = Record<Locale, string>;

export type MockHotel = {
  id: string;
  baseId: string;
  baseQuery: Localized;
  name: Localized;
  nightlyPriceJpy: number;
  stationWalkMinutes: number;
};

export const fullTripDemo = {
  tripDays: 4,
  tripStartDate: "2026-09-14",
  pace: "balanced" as const,
  places: {
    en: `Ghibli Museum — Day 2 10:00 booked · must
Shibuya Sky — Day 3 17:30 booked · must
Senso-ji
Tokyo Skytree — optional
teamLab Planets — Day 1 15:30 booked · must
Tsukiji Outer Market
Meiji Jingu
Akihabara`,
    ja: `三鷹の森ジブリ美術館 — 2日目 10:00 予約 · 必須
渋谷スカイ — 3日目 17:30 予約 · 必須
浅草寺
東京スカイツリー — 時間があれば
チームラボプラネッツ — 1日目 15:30 予約 · 必須
築地場外市場
明治神宮
秋葉原`,
    ko: `지브리 미술관 — 2일차 10:00 예약 · 필수
시부야 스카이 — 3일차 17:30 예약 · 필수
센소지
도쿄 스카이트리 — 시간 되면
팀랩 플래닛 — 1일차 15:30 예약 · 필수
쓰키지 장외시장
메이지 신궁
아키하바라`,
    zh: `三鹰之森吉卜力美术馆 — 第2天 10:00 预约 · 必去
涩谷SKY — 第3天 17:30 预约 · 必去
浅草寺
东京晴空塔 — 有时间
teamLab Planets — 第1天 15:30 预约 · 必去
筑地场外市场
明治神宫
秋叶原`,
  } satisfies Localized,
  hotelQuery: {
    en: "Shinjuku Station",
    ja: "新宿駅",
    ko: "신주쿠역",
    zh: "新宿站",
  } satisfies Localized,
  arrivalAirport: "HND" as const,
  arrivalTime: "10:20",
  departureAirport: "NRT" as const,
  departureTime: "18:30",
  flightKind: "international" as const,
};

const hotels: MockHotel[] = [
  {
    id: "mock-kado-shinjuku",
    baseId: "base-shinjuku",
    baseQuery: { en: "Shinjuku hotel", ja: "新宿のホテル", ko: "신주쿠 호텔", zh: "新宿酒店" },
    name: { en: "KADO Shinjuku", ja: "KADO 新宿", ko: "KADO 신주쿠", zh: "KADO 新宿" },
    nightlyPriceJpy: 28600,
    stationWalkMinutes: 6,
  },
  {
    id: "mock-arc-shibuya",
    baseId: "base-shibuya",
    baseQuery: { en: "Shibuya hotel", ja: "渋谷のホテル", ko: "시부야 호텔", zh: "涩谷酒店" },
    name: { en: "ARC Shibuya", ja: "ARC 渋谷", ko: "ARC 시부야", zh: "ARC 涩谷" },
    nightlyPriceJpy: 31400,
    stationWalkMinutes: 4,
  },
  {
    id: "mock-maru-tokyo",
    baseId: "base-tokyo-station",
    baseQuery: { en: "Tokyo Station hotel", ja: "東京駅のホテル", ko: "도쿄역 호텔", zh: "东京站酒店" },
    name: { en: "MARU Tokyo", ja: "MARU 東京", ko: "MARU 도쿄", zh: "MARU 东京" },
    nightlyPriceJpy: 35200,
    stationWalkMinutes: 7,
  },
  {
    id: "mock-north-ueno",
    baseId: "base-ueno",
    baseQuery: { en: "Ueno hotel", ja: "上野のホテル", ko: "우에노 호텔", zh: "上野酒店" },
    name: { en: "NORTH Ueno", ja: "NORTH 上野", ko: "NORTH 우에노", zh: "NORTH 上野" },
    nightlyPriceJpy: 22800,
    stationWalkMinutes: 3,
  },
  {
    id: "mock-kura-asakusa",
    baseId: "base-asakusa",
    baseQuery: { en: "Asakusa hotel", ja: "浅草のホテル", ko: "아사쿠사 호텔", zh: "浅草酒店" },
    name: { en: "KURA Asakusa", ja: "KURA 浅草", ko: "KURA 아사쿠사", zh: "KURA 浅草" },
    nightlyPriceJpy: 19600,
    stationWalkMinutes: 5,
  },
];

export function getMockHotels(locale: Locale, baseIds: string[]) {
  return baseIds.flatMap((baseId) => {
    const hotel = hotels.find((candidate) => candidate.baseId === baseId);
    return hotel ? [{
      ...hotel,
      name: hotel.name[locale],
      baseQuery: hotel.baseQuery[locale],
    }] : [];
  });
}
