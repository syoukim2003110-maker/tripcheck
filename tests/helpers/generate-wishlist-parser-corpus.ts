import {
  BOOKING_MARKERS,
  BULLETS,
  ENGLISH_PLACES,
  FIXED_TIME_MARKERS,
  ISO_HEADINGS,
  JAPANESE_PLACES,
  MONTH_NAME_HEADINGS,
  MUST_MARKERS,
  OPTIONAL_MARKERS,
  STAY_MARKERS,
  SYNTHETIC_CORPUS_NOTICE,
} from "../fixtures/wishlist-parser-synthetic-fixtures.ts";
import type { WishlistPriority } from "../../lib/wishlist-parser.ts";

export type ExpectedSyntheticPlace = {
  name: string;
  day?: number;
  priority?: Exclude<WishlistPriority, "normal">;
  isReservation?: true;
  time?: string;
  stayMinutes?: number;
};

export type SyntheticParserCase = {
  id: string;
  category: string;
  input: string;
  expectedPlaces: ExpectedSyntheticPlace[];
  expectedHeadings: number[];
};

const choose = <T>(values: readonly T[], index: number) => values[index % values.length];

const syntheticMonths: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function syntheticCalendarDate(value: string) {
  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const monthName = value.match(/^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?,?\s+)?([a-z]+)\s+(\d{1,2})$/i);
  const month = monthName ? syntheticMonths[monthName[1].slice(0, 3).toLocaleLowerCase()] : undefined;
  return monthName && month ? { year: 2000, month, day: Number(monthName[2]) } : null;
}

/** Independent fixture oracle for the parser's supported 30-day trip horizon. */
function syntheticSecondCalendarDay(first: string, second: string) {
  const anchor = syntheticCalendarDate(first);
  const candidate = syntheticCalendarDate(second);
  if (!anchor || !candidate) return 2;
  if (!/^\d{4}/.test(second) && (
    candidate.month < anchor.month
    || (candidate.month === anchor.month && candidate.day < anchor.day)
  )) candidate.year += 1;
  const epoch = (date: { year: number; month: number; day: number }) => Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
  const offset = epoch(candidate) - epoch(anchor);
  return offset >= 0 && offset < 30 ? offset + 1 : 2;
}

function englishPlaces(index: number, count: number) {
  return Array.from({ length: count }, (_, offset) => choose(ENGLISH_PLACES, index + offset * 3));
}

function japanesePlaces(index: number, count: number) {
  return Array.from({ length: count }, (_, offset) => choose(JAPANESE_PLACES, index + offset * 3));
}

function expected(names: readonly string[], facts: Omit<ExpectedSyntheticPlace, "name"> = {}) {
  return names.map((name) => ({ name, ...facts }));
}

function makeCase(index: number): SyntheticParserCase {
  const category = index % 10;
  const variant = Math.floor(index / 10);
  const en = englishPlaces(variant, 3);
  const ja = japanesePlaces(variant, 3);
  const must = choose(MUST_MARKERS, variant);
  const optional = choose(OPTIONAL_MARKERS, variant);
  const booking = choose(BOOKING_MARKERS, variant);
  const fixedTime = choose(FIXED_TIME_MARKERS, variant);
  const stay = choose(STAY_MARKERS, variant);
  const day = variant % 7 + 1;

  switch (category) {
    case 0:
      return {
        id: `synthetic-${index}-newline`,
        category: "newline",
        input: `${en[0]}\n${en[1]}\n${en[2]}`,
        expectedPlaces: expected(en),
        expectedHeadings: [],
      };
    case 1:
      return {
        id: `synthetic-${index}-comma-must`,
        category: "japanese-comma-and-must",
        input: `${ja.join(variant % 2 === 0 ? "、" : "，")} — ${must}`,
        expectedPlaces: expected(ja, { priority: "must" }),
        expectedHeadings: [],
      };
    case 2:
      return {
        id: `synthetic-${index}-slash-optional`,
        category: "japanese-slash-and-optional",
        input: `${ja.join(variant % 2 === 0 ? "/" : "／")} — ${optional}`,
        expectedPlaces: expected(ja, { priority: "optional" }),
        expectedHeadings: [],
      };
    case 3:
      return {
        id: `synthetic-${index}-middle-dot-booking`,
        category: "japanese-middle-dot-booking-time-stay",
        // Japanese list punctuation is normally unspaced. A single middle dot
        // inside an official name is covered separately by the noisy family.
        input: `${ja.join("・")} — ${booking} — ${fixedTime.text} — ${stay.text}`,
        expectedPlaces: expected(ja, {
          priority: "must",
          isReservation: true,
          time: fixedTime.expected,
          stayMinutes: stay.expected,
        }),
        expectedHeadings: [],
      };
    case 4: {
      const bullets = [choose(BULLETS, variant), choose(BULLETS, variant + 2), choose(BULLETS, variant + 4)];
      return {
        id: `synthetic-${index}-bullets`,
        category: "mixed-bullets-and-markers",
        input: `${bullets[0]} ${en[0]} — ${must}\n${bullets[1]} ${en[1]} — ${optional}\n${bullets[2]} ${en[2]} — ${booking} — ${fixedTime.text} — ${stay.text}`,
        expectedPlaces: [
          { name: en[0], priority: "must" },
          { name: en[1], priority: "optional" },
          { name: en[2], priority: "must", isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected },
        ],
        expectedHeadings: [],
      };
    }
    case 5:
      return {
        id: `synthetic-${index}-day-heading`,
        category: "english-day-heading",
        input: `Day ${day}\n${en[0]} — ${must}\n${en[1]} — ${optional}`,
        expectedPlaces: [
          { name: en[0], day, priority: "must" },
          { name: en[1], day, priority: "optional" },
        ],
        expectedHeadings: [day],
      };
    case 6:
      return {
        id: `synthetic-${index}-japanese-day-heading`,
        category: "japanese-day-heading",
        input: `${day}日目\n${ja[0]} — ${booking} — ${fixedTime.text}\n${ja[1]} — ${stay.text}`,
        expectedPlaces: [
          { name: ja[0], day, priority: "must", isReservation: true, time: fixedTime.expected },
          { name: ja[1], day, stayMinutes: stay.expected },
        ],
        expectedHeadings: [day],
      };
    case 7: {
      const firstHeading = choose(ISO_HEADINGS, variant);
      const secondHeading = choose(ISO_HEADINGS, variant + 1);
      const secondDay = syntheticSecondCalendarDay(firstHeading, secondHeading);
      return {
        id: `synthetic-${index}-iso-heading`,
        category: "iso-date-headings",
        input: `${firstHeading}\n${en[0]} — ${must}\n${secondHeading}\n${en[1]} — ${optional}`,
        expectedPlaces: [
          { name: en[0], day: 1, priority: "must" },
          { name: en[1], day: secondDay, priority: "optional" },
        ],
        expectedHeadings: [1, secondDay],
      };
    }
    case 8: {
      const firstHeading = choose(MONTH_NAME_HEADINGS, variant);
      const secondHeading = choose(MONTH_NAME_HEADINGS, variant + 1);
      const secondDay = syntheticSecondCalendarDay(firstHeading, secondHeading);
      return {
        id: `synthetic-${index}-month-heading`,
        category: "month-name-date-headings",
        input: `${firstHeading}\n${en[0]} — ${booking} — ${fixedTime.text}\n${secondHeading}\n${en[1]} — ${stay.text}`,
        expectedPlaces: [
          { name: en[0], day: 1, priority: "must", isReservation: true, time: fixedTime.expected },
          { name: en[1], day: secondDay, stayMinutes: stay.expected },
        ],
        expectedHeadings: [1, secondDay],
      };
    }
    default: {
      const officialMiddleDotName = "東京ミッドタウン・日比谷";
      return {
        id: `synthetic-${index}-mixed-noise`,
        category: "mixed-and-noisy",
        input: `\n${choose(BULLETS, variant)} ${ja[0]}、${ja[1]} — ${booking} — ${fixedTime.text} — ${stay.text}\nhttps://example.com/saved-list/${variant}\nDay ${day} — ${en[0]} — ${optional}\n${officialMiddleDotName} — 9:00-17:00\n`,
        expectedPlaces: [
          { name: ja[0], priority: "must", isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected },
          { name: ja[1], priority: "must", isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected },
          { name: en[0], day, priority: "optional" },
          { name: officialMiddleDotName, day },
        ],
        expectedHeadings: [],
      };
    }
  }
}

export function generateSyntheticWishlistParserCorpus(count = 500): SyntheticParserCase[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("Synthetic corpus size must be a positive integer.");
  return Array.from({ length: count }, (_, index) => makeCase(index));
}

export { SYNTHETIC_CORPUS_NOTICE };
