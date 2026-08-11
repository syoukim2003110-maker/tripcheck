/*
 * Shared wishlist reader. One deterministic parser feeds the composer preview,
 * the Google place-resolution queries and the trip builder, so what the user
 * sees recognized is exactly what gets planned. Marker words are DETECTED
 * anywhere in a line (Japanese rarely uses spaces) but only REMOVED from the
 * place name when they sit on a safe boundary, so real names that merely
 * contain a marker substring survive.
 */

export type WishlistPriority = "must" | "optional" | "normal";

export type WishlistTimeOfDay = "morning" | "evening" | "night";

export type ParsedWishlistPlace = {
  name: string;
  day: number | null;
  time: string | null;
  timeOfDay: WishlistTimeOfDay | null;
  isReservation: boolean;
  priority: WishlistPriority;
  stayMinutes: number | null;
};

export type WishlistPlaceConstraintPatch = Partial<Pick<
  ParsedWishlistPlace,
  "priority" | "time" | "timeOfDay" | "isReservation" | "stayMinutes"
>>;

export type ParsedWishlistLine =
  | { kind: "empty"; raw: string }
  | { kind: "heading"; raw: string; day: number }
  | { kind: "unparsed"; raw: string }
  | { kind: "place"; raw: string; places: ParsedWishlistPlace[] };

const SEP = "\\s、,，・·()（）\\[\\]【】—–―:~\\-\\.。|｜!！?？";
const EDGE_SEP = "\\s、,，・·—–―:~\\-\\.。|｜!！?？";
const boundaryToken = (source: string) =>
  new RegExp(`(?:(?<=^)|(?<=[${SEP}]))(?:${source})(?=$|[${SEP}])`, "giu");

const dayTokenSource = "day\\s*\\d{1,2}|\\d{1,2}\\s*日目|\\d{1,2}\\s*일차|第?\\s*\\d{1,2}\\s*天";
const dayAnywhere = /day\s*(\d{1,2})|(\d{1,2})\s*日目|(\d{1,2})\s*일차|第?\s*(\d{1,2})\s*天/i;

const mustAnywhere = /\bmust(?:-do)?\b|\bnon[- ]?negotiable\b|絶対に?行く|絶対に?行きたい|必須|絶対|マスト|필수|꼭|必去|必须/i;
const mustTokenSource = "must(?:-do)?|non[- ]?negotiable|絶対に?行きたい|絶対に?行く|必須|絶対|マスト|필수|꼭|必去|必须";

const optionalAnywhere = /\boptional\b|\bif\s+(?:there(?:'s| is)\s+)?time\b|時間があれば|時間が余れば|余裕があれば|できれば|任意|선택|시간(?:이|\s)?되면|可选|有时间/i;
const optionalTokenSource = "optional|if\\s+(?:there(?:'s| is)\\s+)?time|時間があれば|時間が余れば|余裕があれば|できれば|任意|선택|可选|有时间";

const reservationAnywhere = /\bbooked\b|\breserved\b|\breservation\b|\btimed ticket\b|\bneed tickets?\b|\btickets? (?:required|needed)\b|\badvance tickets?\b|予約済み?|要予約|予約|確定|要チケット|チケット必要|チケット(?:購入|確保)済み?|예약|예매|预约|预订/i;
const reservationTokenSource = "booked|reserved|reservation|timed ticket|need\\s+tickets?|tickets?\\s+(?:required|needed)|advance\\s+tickets?|予約済み?|要予約|予約|確定|要チケット|チケット必要|チケット(?:購入|確保)済み?|예약|예매|预约|预订";

/* A traveller's time-of-day wish ("Shibuya Sky at sunset", "豊洲市場 朝イチ")
 * is a scheduling constraint, not part of the place name. Detected only on
 * safe boundaries so names that merely contain these words survive. */
const eveningTokenSource = "at\\s+sunset|sunset|at\\s+dusk|dusk|in\\s+the\\s+evening|evening|夕方|夕暮れ|夕日|サンセット";
const nightTokenSource = "at\\s+night|night\\s+view|night|夜景|ナイト|夜";
const morningTokenSource = "early\\s+morning|morning|朝イチ|朝一番?|午前中|朝ごはん|朝食|朝";

const colonTimeSource = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
const kanjiTimeSource = "(?:[01]?\\d|2[0-3])\\s*時(?!間)(?:\\s*(?:半|[0-5]?\\d\\s*分))?";
const anyTimeSource = `(?:${colonTimeSource}|${kanjiTimeSource})`;
const timeRange = new RegExp(`${anyTimeSource}\\s*(?:[-~–—―]|から)\\s*${anyTimeSource}`, "giu");
const timeWithAffixes = new RegExp(
  `(?:午前|午後|am|pm)?\\s*(?:@\\s*)?(${colonTimeSource})(?:\\s*(?:予約|集合|入場|開始|着|発|に|から|頃|ごろ|くらい))?`
  + `|(?:午前|午後|am|pm)?\\s*(?:@\\s*)?((?:[01]?\\d|2[0-3]))\\s*時(?!間)(?:\\s*(半)|\\s*([0-5]?\\d)\\s*分)?(?:\\s*(?:予約|集合|入場|開始|着|発|に|から|頃|ごろ|くらい))?`,
  "giu",
);

const staySources = [
  "滞在\\s*(\\d{1,3})\\s*分",
  "(\\d{1,3})\\s*分\\s*滞在",
  "stay\\s*(\\d{1,3})\\s*min(?:ute)?s?",
];

function toClock(hourRaw: number, minuteRaw: number, meridiem: "am" | "pm" | null) {
  let hour = hourRaw;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minuteRaw).padStart(2, "0")}`;
}

function stripBullet(line: string) {
  return line
    .replace(/^[-•*・●○◦▪‣☆★>»]+\s*/, "")
    .replace(/^\(?\d{1,2}[.)、]\s*/, "")
    .trim();
}

function tidyName(value: string) {
  return value
    // A parenthesis group left holding only punctuation is residue from a
    // removed marker ("(must!)" → "(!)"), never a real qualifier.
    .replace(/[（(][\s!！?？。.、,，・·—–―:~\-|｜]*[)）]/gu, "")
    .replace(/[「『]\s*[」』]/g, "")
    // A whitespace-delimited run of nothing but separators is residue from a
    // removed marker ("… — · …"), never part of a name.
    .replace(/(?:^|\s)[—–―·・:~\-,、，.。|｜]+(?=\s|$)/gu, " ")
    // Parentheses can carry a useful area qualifier. Do not trim them as if
    // they were list punctuation; an unmatched trailing parenthesis made a
    // pasted list such as "天橋立（丹後）" impossible to resolve.
    .replace(new RegExp(`^[${EDGE_SEP}]+`, "u"), "")
    .replace(new RegExp(`[${EDGE_SEP}]+$`, "u"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasCjk(value: string) {
  return /[぀-ヿ㐀-鿿豈-﫿]/u.test(value);
}

function topLevelMiddleDotCount(value: string) {
  let depth = 0;
  let count = 0;
  for (const character of value) {
    if (character === "(" || character === "[" || character === "【") depth += 1;
    else if (character === ")" || character === "]" || character === "】") depth = Math.max(0, depth - 1);
    else if (depth === 0 && character === "・") count += 1;
  }
  return count;
}

/* Japanese users commonly paste a visual list separated by middle dots and
 * slashes. Split those separators only at the top level so a group such as
 * "嵐山（渡月橋・竹林）" stays intact long enough to keep its context. A
 * single unspaced middle dot remains part of an official name (for example
 * 東京ミッドタウン・日比谷); two or more on one line clearly indicate a
 * pasted list. */
function splitTopLevel(value: string, forceMiddleDot = false) {
  const pieces: string[] = [];
  let current = "";
  let depth = 0;
  const middleDotIsList = forceMiddleDot
    || topLevelMiddleDotCount(value) >= 2
    || /\s・|・\s/u.test(value);
  const slashIsList = value.split(/[\/／]/u).filter(Boolean).every((part) => hasCjk(part));

  const flush = () => {
    const clean = tidyName(current);
    if (clean) pieces.push(clean);
    current = "";
  };
  for (const character of value) {
    if (character === "(" || character === "[" || character === "【") {
      depth += 1;
      current += character;
      continue;
    }
    if (character === ")" || character === "]" || character === "】") {
      depth = Math.max(0, depth - 1);
      current += character;
      continue;
    }
    const separator = depth === 0 && (
      character === "、"
      || character === "，"
      || (character === "," && hasCjk(value))
      || ((character === "/" || character === "／") && slashIsList)
      || (character === "・" && middleDotIsList)
    );
    if (separator) flush();
    else current += character;
  }
  flush();
  return pieces;
}

const parentheticalLandmark = /(?:寺|神社|大社|城|橋|公園|庭園|竹林|市場|駅|タワー|ミュージアム|博物館|美術館|水族館|動物園|通天閣)$/u;

function expandParentheticalPlace(value: string) {
  const match = value.match(/^(.+?)\(([^()]*)\)$/u);
  if (!match) return [value];
  const base = tidyName(match[1]);
  const detail = tidyName(match[2]);
  if (!base || !detail) return [value];
  const detailPieces = splitTopLevel(detail, true);
  if (detailPieces.length > 1) {
    return [base, ...detailPieces.map((piece) => piece.length <= 2 || piece === "竹林" ? `${base} ${piece}` : piece)];
  }
  if (parentheticalLandmark.test(detail)) return [base, detail];
  // A short regional qualifier such as 天橋立（丹後） should guide Google,
  // not become a second, vague stop of its own.
  return [`${base} ${detail}`];
}

function splitPlaces(name: string) {
  return splitTopLevel(name)
    .flatMap(expandParentheticalPlace)
    .map(tidyName)
    .filter((segment) => segment.length > 0);
}

const headingLead = new RegExp(
  `^(?:day\\s*(\\d{1,2})|(\\d{1,2})\\s*日目|(\\d{1,2})\\s*일차|第?\\s*(\\d{1,2})\\s*天)(?:\\s+|\\s*[.:、,，\\-–—―~]\\s*|$)`,
  "iu",
);

// Existing itineraries are frequently headed by calendar dates rather than
// “Day 1”. Preserve the real calendar offset: Sep 14 followed by Sep 16 means
// Day 1 and Day 3, not two adjacent sightseeing days. Deliberately require a
// heading-shaped prefix so a date inside a place note is never stripped as
// structure.
const englishMonthSource = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const calendarHeadingLead = new RegExp(
  `^(?:(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})|(?:(\\d{4})\\s*年\\s*)?(\\d{1,2})月(\\d{1,2})日|(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?(?:,)?\\s+)?(${englishMonthSource})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?)(?:\\s+|\\s*[.:、,，\\-–—―~]\\s*|$)`,
  "iu",
);

const englishMonths: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

type CalendarHeadingDate = { year: number | null; month: number; day: number };

function parsedCalendarHeadingDate(match: RegExpMatchArray): CalendarHeadingDate | null {
  const isoYear = match[1] ? Number(match[1]) : null;
  const japaneseYear = match[4] ? Number(match[4]) : null;
  const englishYear = match[9] ? Number(match[9]) : null;
  const monthName = match[7]?.slice(0, 3).toLocaleLowerCase();
  const month = match[2] ? Number(match[2]) : match[5] ? Number(match[5]) : monthName ? englishMonths[monthName] : null;
  const day = match[3] ? Number(match[3]) : match[6] ? Number(match[6]) : match[8] ? Number(match[8]) : null;
  if (month === null || day === null || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: isoYear ?? japaneseYear ?? englishYear, month, day };
}

function calendarEpochDay(date: { year: number; month: number; day: number }) {
  const parsed = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (parsed.getUTCFullYear() !== date.year || parsed.getUTCMonth() !== date.month - 1 || parsed.getUTCDate() !== date.day) return null;
  return Math.floor(parsed.getTime() / 86_400_000);
}

function headingDay(match: RegExpMatchArray) {
  const value = match[1] ?? match[2] ?? match[3] ?? match[4];
  const day = Number(value);
  return Number.isFinite(day) && day >= 1 && day <= 30 ? day : null;
}

export function parseWishlist(raw: string): ParsedWishlistLine[] {
  const lines: ParsedWishlistLine[] = [];
  let contextDay: number | null = null;
  let calendarHeadingCount = 0;
  let calendarAnchor: { year: number; month: number; day: number; epochDay: number } | null = null;
  let previousCalendarDate: { year: number; month: number; day: number } | null = null;

  for (const rawLine of raw.split("\n")) {
    const original = rawLine.trim();
    if (!original) {
      lines.push({ kind: "empty", raw: rawLine });
      continue;
    }

    let text = stripBullet(original.normalize("NFKC").replace(/[～〜]/g, "~"));

    let lineDay: number | null = null;
    const heading = text.match(headingLead);
    if (heading) {
      const day = headingDay(heading);
      const rest = text.slice(heading[0].length).trim();
      if (day !== null) {
        contextDay = day;
        if (!rest) {
          lines.push({ kind: "heading", raw: original, day });
          continue;
        }
        lineDay = day;
        text = rest;
      }
    }

    if (!heading) {
      const calendarHeading = text.match(calendarHeadingLead);
      if (calendarHeading) {
        const parts = parsedCalendarHeadingDate(calendarHeading);
        let calendarDay: number | null = null;
        if (parts) {
          let year: number = parts.year ?? previousCalendarDate?.year ?? 2000;
          if (parts.year === null && previousCalendarDate && (
            parts.month < previousCalendarDate.month
            || (parts.month === previousCalendarDate.month && parts.day < previousCalendarDate.day)
          )) year += 1;
          const epochDay = calendarEpochDay({ year, month: parts.month, day: parts.day });
          if (epochDay !== null) {
            calendarAnchor ??= { year, month: parts.month, day: parts.day, epochDay };
            const offset = epochDay - calendarAnchor.epochDay;
            if (offset >= 0 && offset < 30) {
              calendarDay = offset + 1;
              previousCalendarDate = { year, month: parts.month, day: parts.day };
            }
          }
        }
        // Retain the legacy sequential fallback only for malformed, backwards,
        // or out-of-range headings. Valid supported dates never lose gaps.
        calendarHeadingCount += 1;
        contextDay = calendarDay ?? calendarHeadingCount;
        calendarHeadingCount = Math.max(calendarHeadingCount, contextDay);
        const rest = text.slice(calendarHeading[0].length).trim();
        if (!rest) {
          lines.push({ kind: "heading", raw: original, day: contextDay });
          continue;
        }
        lineDay = contextDay;
        text = rest;
      }
    }

    if (lineDay === null) {
      const inlineDay = text.match(dayAnywhere);
      if (inlineDay) {
        const day = Number(inlineDay[1] ?? inlineDay[2] ?? inlineDay[3] ?? inlineDay[4]);
        if (Number.isFinite(day) && day >= 1 && day <= 30) lineDay = day;
        text = text.replace(boundaryToken(dayTokenSource), " ");
      }
    }

    // Opening-hours style ranges ("9:00-17:00", "9時~17時") are notes, not a
    // requested visit time; drop them and never pin a time from this line.
    const hadRange = timeRange.test(text);
    timeRange.lastIndex = 0;
    if (hadRange) text = text.replace(timeRange, " ");

    let stayMinutes: number | null = null;
    for (const source of staySources) {
      const stayRegex = new RegExp(source, "giu");
      const match = stayRegex.exec(text);
      if (match) {
        const value = Number(match[1] ?? match[2] ?? match[3]);
        if (Number.isFinite(value)) stayMinutes = Math.min(480, Math.max(15, value));
        text = text.replace(stayRegex, " ");
      }
    }

    let time: string | null = null;
    let timeWasReservation = false;
    if (!hadRange) {
      timeWithAffixes.lastIndex = 0;
      const match = timeWithAffixes.exec(text);
      if (match) {
        const matched = match[0];
        const meridiem = /午後|pm/i.test(matched) ? "pm" as const : /午前|am/i.test(matched) ? "am" as const : null;
        if (match[1]) {
          const [hourText, minuteText] = match[1].split(":");
          time = toClock(Number(hourText), Number(minuteText), meridiem);
        } else if (match[2]) {
          const minute = match[3] ? 30 : match[4] ? Number(match[4]) : 0;
          time = toClock(Number(match[2]), minute, meridiem);
        }
        if (time !== null) {
          timeWasReservation = matched.includes("@") || /予約/.test(matched);
          text = `${text.slice(0, match.index)} ${text.slice(match.index + matched.length)}`;
        }
      }
    }

    const isReservation = reservationAnywhere.test(text) || timeWasReservation;
    const isMust = mustAnywhere.test(text);
    const isOptional = !isMust && optionalAnywhere.test(text);

    let timeOfDay: WishlistTimeOfDay | null = null;
    if (time === null) {
      for (const [source, value] of [
        [eveningTokenSource, "evening"],
        [nightTokenSource, "night"],
        [morningTokenSource, "morning"],
      ] as const) {
        const token = boundaryToken(source);
        if (token.test(text)) {
          timeOfDay = value;
          text = text.replace(boundaryToken(source), " ");
          break;
        }
      }
    }

    text = text
      .replace(boundaryToken(reservationTokenSource), " ")
      .replace(boundaryToken(mustTokenSource), " ")
      .replace(boundaryToken(optionalTokenSource), " ")
      .replace(/https?:\/\/\S+/g, " ");

    const day = lineDay ?? contextDay;
    const shared = {
      day,
      time,
      timeOfDay,
      isReservation,
      priority: (isMust || isReservation ? "must" : isOptional ? "optional" : "normal") as WishlistPriority,
      stayMinutes,
    };
    const places = splitPlaces(tidyName(text)).map((name) => ({ name, ...shared }));
    if (places.length === 0) {
      lines.push({ kind: "unparsed", raw: original });
      continue;
    }
    lines.push({ kind: "place", raw: original, places });
  }

  return lines;
}

export function parsedWishlistPlaces(raw: string): ParsedWishlistPlace[] {
  return parseWishlist(raw).flatMap((line) => (line.kind === "place" ? line.places : []));
}

/** Serializes already-reviewed places without carrying opaque/unparsed lines. */
export function formatParsedWishlistPlaces(
  places: ParsedWishlistPlace[],
  languageCode: "ja" | "en",
) {
  const output: string[] = [];
  let visibleDay: number | null = null;
  for (const place of places) {
    if (place.day !== null && place.day !== visibleDay) {
      output.push(languageCode === "ja" ? `${place.day}日目` : `Day ${place.day}`);
      visibleDay = place.day;
    }
    const timeOfDayLabel = place.timeOfDay === null ? null : languageCode === "ja"
      ? { morning: "朝", evening: "夕方", night: "夜" }[place.timeOfDay]
      : place.timeOfDay;
    const markers = languageCode === "ja"
      ? [place.time ?? timeOfDayLabel, place.isReservation ? "予約" : place.priority === "must" ? "必須" : null, place.priority === "optional" ? "時間があれば" : null, place.stayMinutes ? `滞在${place.stayMinutes}分` : null]
      : [place.time ?? timeOfDayLabel, place.isReservation ? "booked" : place.priority === "must" ? "must" : null, place.priority === "optional" ? "optional" : null, place.stayMinutes ? `stay ${place.stayMinutes} min` : null];
    output.push([place.name, ...markers.filter(Boolean)].join(" — "));
  }
  return output.join("\n");
}

/* Convert a free-form paste into the strict one-place-per-line form shown by
 * the UI. This is optional: the planner already consumes the parsed places,
 * but making the normalized form visible gives the user an editable source of
 * truth before any paid lookup begins. */
export function formatWishlistLines(raw: string, languageCode: "ja" | "en") {
  const output: string[] = [];
  let visibleDay: number | null = null;
  for (const line of parseWishlist(raw)) {
    if (line.kind === "empty" || line.kind === "heading") continue;
    if (line.kind === "unparsed") {
      output.push(line.raw.trim());
      continue;
    }
    for (const place of line.places) {
      if (place.day !== null && place.day !== visibleDay) {
        output.push(languageCode === "ja" ? `${place.day}日目` : `Day ${place.day}`);
        visibleDay = place.day;
      }
      const timeOfDayLabel = place.timeOfDay === null ? null : languageCode === "ja"
        ? { morning: "朝", evening: "夕方", night: "夜" }[place.timeOfDay]
        : place.timeOfDay;
      const markers = languageCode === "ja"
        ? [place.time ?? timeOfDayLabel, place.isReservation ? "予約" : place.priority === "must" ? "必須" : null, place.priority === "optional" ? "時間があれば" : null, place.stayMinutes ? `滞在${place.stayMinutes}分` : null]
        : [place.time ?? timeOfDayLabel, place.isReservation ? "booked" : place.priority === "must" ? "must" : null, place.priority === "optional" ? "optional" : null, place.stayMinutes ? `stay ${place.stayMinutes} min` : null];
      output.push([place.name, ...markers.filter(Boolean)].join(" — "));
    }
  }
  return output.join("\n");
}

function serializeWishlistPlaceLine(place: ParsedWishlistPlace, languageCode: "ja" | "en") {
  const timeOfDayLabel = place.timeOfDay === null ? null : languageCode === "ja"
    ? { morning: "朝", evening: "夕方", night: "夜" }[place.timeOfDay]
    : place.timeOfDay;
  const markers = languageCode === "ja"
    ? [place.time ?? timeOfDayLabel, place.isReservation ? "予約" : place.priority === "must" ? "必須" : null, place.priority === "optional" ? "時間があれば" : null, place.stayMinutes ? `滞在${place.stayMinutes}分` : null]
    : [place.time ?? timeOfDayLabel, place.isReservation ? "booked" : place.priority === "must" ? "must" : null, place.priority === "optional" ? "optional" : null, place.stayMinutes ? `stay ${place.stayMinutes} min` : null];
  return [place.name, ...markers.filter(Boolean)].join(" — ");
}

/**
 * Removes one occurrence from the textual source of truth (v1.1 TC-020).
 * Every OTHER source line stays byte-identical — day headings, annotations,
 * private notes and formatting all survive verbatim. Only the removed
 * occurrence's own line changes: a single-place line disappears entirely,
 * while a multi-place line is re-serialized without the removed occurrence
 * (re-emitting its day heading when the line itself carried the day).
 */
export function removeWishlistPlace(
  raw: string,
  placeIndex: number,
  languageCode: "ja" | "en",
) {
  if (!Number.isInteger(placeIndex) || placeIndex < 0) return raw;
  // parseWishlist pushes exactly one entry per source line, so entry N maps
  // onto raw.split("\n")[N] and untouched lines can be kept verbatim.
  const parsed = parseWishlist(raw);
  const sourceLines = raw.split("\n");
  let cursor = 0;
  let contextDay: number | null = null;
  for (let lineIndex = 0; lineIndex < parsed.length; lineIndex += 1) {
    const line = parsed[lineIndex];
    if (line.kind === "heading") {
      contextDay = line.day;
      continue;
    }
    if (line.kind !== "place") continue;
    if (placeIndex < cursor + line.places.length) {
      const remaining = line.places.filter((_, occurrence) => occurrence !== placeIndex - cursor);
      const replacement: string[] = [];
      let visibleDay = contextDay;
      for (const place of remaining) {
        if (place.day !== null && place.day !== visibleDay) {
          replacement.push(languageCode === "ja" ? `${place.day}日目` : `Day ${place.day}`);
          visibleDay = place.day;
        }
        replacement.push(serializeWishlistPlaceLine(place, languageCode));
      }
      sourceLines.splice(lineIndex, 1, ...replacement);
      return sourceLines.join("\n");
    }
    cursor += line.places.length;
    // A place line can itself establish the running day for later lines.
    const lineDay = line.places.at(-1)?.day;
    if (lineDay !== null && lineDay !== undefined) contextDay = lineDay;
  }
  return raw;
}

/**
 * Applies a Must/Optional choice from the chip UI without introducing a second
 * hidden source of truth. The normalized text remains what sharing, parsing
 * and the deterministic planner consume.
 */
export function setWishlistPlacePriority(
  raw: string,
  placeIndex: number,
  priority: WishlistPriority,
  languageCode: "ja" | "en",
) {
  return updateWishlistPlaceConstraints(raw, placeIndex, { priority }, languageCode);
}

function normalizeConstraintPatch(
  original: ParsedWishlistPlace,
  patch: WishlistPlaceConstraintPatch,
): ParsedWishlistPlace {
  const priority = patch.priority === "must" || patch.priority === "normal" || patch.priority === "optional"
    ? patch.priority
    : original.priority;
  const isReservation = typeof patch.isReservation === "boolean" ? patch.isReservation : original.isReservation;
  const time = patch.time === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time ?? "")
    ? patch.time ?? null
    : original.time;
  const timeOfDay = patch.timeOfDay === null
    || patch.timeOfDay === "morning"
    || patch.timeOfDay === "evening"
    || patch.timeOfDay === "night"
    ? patch.timeOfDay ?? null
    : original.timeOfDay;
  const requestedStay = patch.stayMinutes;
  const stayMinutes = requestedStay === null
    ? null
    : typeof requestedStay === "number" && Number.isFinite(requestedStay)
      ? Math.min(480, Math.max(15, Math.round(requestedStay)))
      : original.stayMinutes;
  return {
    ...original,
    priority: isReservation ? "must" : priority,
    isReservation,
    time,
    // A precise clock and a broad time-of-day hint are mutually exclusive.
    timeOfDay: time === null ? timeOfDay : null,
    stayMinutes,
  };
}

/**
 * Applies one occurrence's structured constraints while retaining a single,
 * shareable textual source of truth. Unparsed/private lines survive verbatim;
 * callers never need to splice marker words into free-form input themselves.
 */
export function updateWishlistPlaceConstraints(
  raw: string,
  placeIndex: number,
  patch: WishlistPlaceConstraintPatch,
  languageCode: "ja" | "en",
) {
  const parsed = parseWishlist(raw);
  const placeCount = parsed.reduce((count, line) => count + (line.kind === "place" ? line.places.length : 0), 0);
  if (!Number.isInteger(placeIndex) || placeIndex < 0 || placeIndex >= placeCount) return raw;
  const output: string[] = [];
  let visibleDay: number | null = null;
  let cursor = 0;
  for (const line of parsed) {
    if (line.kind === "empty") {
      if (output.at(-1) !== "") output.push("");
      continue;
    }
    if (line.kind === "heading") {
      visibleDay = line.day;
      output.push(line.raw.trim());
      continue;
    }
    if (line.kind === "unparsed") {
      output.push(line.raw);
      continue;
    }
    for (const original of line.places) {
      const place = cursor === placeIndex
        ? normalizeConstraintPatch(original, patch)
        : original;
      cursor += 1;
      if (place.day !== null && place.day !== visibleDay) {
        output.push(languageCode === "ja" ? `${place.day}日目` : `Day ${place.day}`);
        visibleDay = place.day;
      }
      const timeOfDayLabel = place.timeOfDay === null ? null : languageCode === "ja"
        ? { morning: "朝", evening: "夕方", night: "夜" }[place.timeOfDay]
        : place.timeOfDay;
      const markers = languageCode === "ja"
        ? [place.time ?? timeOfDayLabel, place.isReservation ? "予約" : place.priority === "must" ? "必須" : null, place.priority === "optional" ? "時間があれば" : null, place.stayMinutes ? `滞在${place.stayMinutes}分` : null]
        : [place.time ?? timeOfDayLabel, place.isReservation ? "booked" : place.priority === "must" ? "must" : null, place.priority === "optional" ? "optional" : null, place.stayMinutes ? `stay ${place.stayMinutes} min` : null];
      output.push([place.name, ...markers.filter(Boolean)].join(" — "));
    }
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
