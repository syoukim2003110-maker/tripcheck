/**
 * SYNTHETIC REGRESSION FIXTURES ONLY.
 *
 * These hand-authored tokens exercise known syntax branches deterministically.
 * They are not sampled traveller input and must never be cited as real-world
 * parser accuracy, language coverage or product validation evidence.
 */

export const SYNTHETIC_CORPUS_NOTICE = "Synthetic parser regression corpus; not real-world accuracy evidence.";

export const ENGLISH_PLACES = [
  "Senso-ji",
  "Tokyo Skytree",
  "Meiji Jingu",
  "Shibuya Sky",
  "Ueno Park",
  "Ghibli Museum",
  "teamLab Planets",
  "Tokyo Tower",
  "Imperial Palace",
  "Tsukiji Outer Market",
] as const;

export const JAPANESE_PLACES = [
  "浅草寺",
  "東京スカイツリー",
  "明治神宮",
  "渋谷スカイ",
  "上野公園",
  "三鷹の森ジブリ美術館",
  "チームラボプラネッツ",
  "東京タワー",
  "皇居",
  "築地場外市場",
] as const;

export const MUST_MARKERS = [
  "must",
  "must-do",
  "non-negotiable",
  "必須",
  "絶対行きたい",
  "マスト",
] as const;

export const OPTIONAL_MARKERS = [
  "optional",
  "if there's time",
  "if time",
  "時間があれば",
  "できれば",
  "任意",
] as const;

export const BOOKING_MARKERS = [
  "booked",
  "reserved",
  "reservation",
  "timed ticket",
  "予約",
  "予約済み",
  "要予約",
] as const;

export const FIXED_TIME_MARKERS = [
  { text: "@ 08:15", expected: "08:15" },
  { text: "14:30", expected: "14:30" },
  { text: "pm 3:45", expected: "15:45" },
  { text: "午後3:30", expected: "15:30" },
  { text: "16時15分", expected: "16:15" },
  { text: "11時半", expected: "11:30" },
] as const;

export const STAY_MARKERS = [
  { text: "stay 45 min", expected: 45 },
  { text: "stay 90 minutes", expected: 90 },
  { text: "滞在60分", expected: 60 },
  { text: "120分滞在", expected: 120 },
  { text: "滞在180分", expected: 180 },
] as const;

export const BULLETS = ["-", "•", "*", "・", "1.", "2)", "3、"] as const;

export const ISO_HEADINGS = [
  "2026-09-14",
  "2026/10/03",
  "2027.01.08",
] as const;

export const MONTH_NAME_HEADINGS = [
  "September 14",
  "Monday, October 5",
  "Aug 9",
  "Sunday, December 20",
] as const;
