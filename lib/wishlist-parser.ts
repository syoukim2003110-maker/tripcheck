/*
 * Shared wishlist reader. One deterministic parser feeds the composer preview,
 * the Google place-resolution queries and the trip builder, so what the user
 * sees recognized is exactly what gets planned. Marker words are DETECTED
 * anywhere in a line (Japanese rarely uses spaces) but only REMOVED from the
 * place name when they sit on a safe boundary, so real names that merely
 * contain a marker substring survive.
 */

export type WishlistPriority = "must" | "optional" | "normal";

export type ParsedWishlistPlace = {
  name: string;
  day: number | null;
  time: string | null;
  isReservation: boolean;
  priority: WishlistPriority;
  stayMinutes: number | null;
};

export type ParsedWishlistLine =
  | { kind: "empty"; raw: string }
  | { kind: "heading"; raw: string; day: number }
  | { kind: "unparsed"; raw: string }
  | { kind: "place"; raw: string; places: ParsedWishlistPlace[] };

const SEP = "\\s、,，・·()（）\\[\\]【】—–―:~\\-\\.。|｜";
const EDGE_SEP = "\\s、,，・·—–―:~\\-\\.。|｜";
const boundaryToken = (source: string) =>
  new RegExp(`(?:(?<=^)|(?<=[${SEP}]))(?:${source})(?=$|[${SEP}])`, "giu");

const dayTokenSource = "day\\s*\\d{1,2}|\\d{1,2}\\s*日目|\\d{1,2}\\s*일차|第?\\s*\\d{1,2}\\s*天";
const dayAnywhere = /day\s*(\d{1,2})|(\d{1,2})\s*日目|(\d{1,2})\s*일차|第?\s*(\d{1,2})\s*天/i;

const mustAnywhere = /\bmust(?:-do)?\b|\bnon[- ]?negotiable\b|絶対に?行く|絶対に?行きたい|必須|絶対|マスト|필수|꼭|必去|必须/i;
const mustTokenSource = "must(?:-do)?|non[- ]?negotiable|絶対に?行きたい|絶対に?行く|必須|絶対|マスト|필수|꼭|必去|必须";

const optionalAnywhere = /\boptional\b|\bif\s+(?:there(?:'s| is)\s+)?time\b|時間があれば|時間が余れば|余裕があれば|できれば|任意|선택|시간(?:이|\s)?되면|可选|有时间/i;
const optionalTokenSource = "optional|if\\s+(?:there(?:'s| is)\\s+)?time|時間があれば|時間が余れば|余裕があれば|できれば|任意|선택|可选|有时间";

const reservationAnywhere = /\bbooked\b|\breserved\b|\breservation\b|\btimed ticket\b|予約済み?|要予約|予約|確定|チケット(?:購入|確保)済み?|예약|예매|预约|预订/i;
const reservationTokenSource = "booked|reserved|reservation|timed ticket|予約済み?|要予約|予約|確定|チケット(?:購入|確保)済み?|예약|예매|预约|预订";

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
    .replace(/[（(]\s*[)）]/g, "")
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

function headingDay(match: RegExpMatchArray) {
  const value = match[1] ?? match[2] ?? match[3] ?? match[4];
  const day = Number(value);
  return Number.isFinite(day) && day >= 1 && day <= 30 ? day : null;
}

export function parseWishlist(raw: string): ParsedWishlistLine[] {
  const lines: ParsedWishlistLine[] = [];
  let contextDay: number | null = null;

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
    text = text
      .replace(boundaryToken(reservationTokenSource), " ")
      .replace(boundaryToken(mustTokenSource), " ")
      .replace(boundaryToken(optionalTokenSource), " ")
      .replace(/https?:\/\/\S+/g, " ");

    const day = lineDay ?? contextDay;
    const shared = {
      day,
      time,
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
      const markers = languageCode === "ja"
        ? [place.time, place.isReservation ? "予約" : place.priority === "must" ? "必須" : null, place.priority === "optional" ? "時間があれば" : null, place.stayMinutes ? `滞在${place.stayMinutes}分` : null]
        : [place.time, place.isReservation ? "booked" : place.priority === "must" ? "must" : null, place.priority === "optional" ? "optional" : null, place.stayMinutes ? `stay ${place.stayMinutes} min` : null];
      output.push([place.name, ...markers.filter(Boolean)].join(" — "));
    }
  }
  return output.join("\n");
}
