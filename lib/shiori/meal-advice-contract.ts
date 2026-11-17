/*
 * The meal advisor's contract: what the page may send to the site's AI relay
 * (api/ai.php, or scripts/apple-relay-dev.ts locally) and what it may accept
 * back. The same rules run in three places — the page before it sends and
 * after it receives, the local relay, and ai.php — so a brief or an answer
 * that one of them would refuse never reaches the next.
 *
 * The values below repeat deploy/xserver/api/ai-spec.json, which the two
 * relays read at run time; tests/meal-advice-contract.test.ts fails when the
 * two drift. They are repeated rather than imported so the page does not
 * carry the relay's prompts.
 *
 * What the answer can hold is narrow on purpose: search conditions out of
 * fixed lists and one sentence about the plan. No shop, price, opening hour
 * or rating can come through, because none of those is the model's to give.
 */

export const MEAL_ADVICE_LIMITS = {
  bodyBytes: 8192,
  days: 7,
  stops: 24,
  slots: 14,
  optionsPerSlot: 3,
  featuresPerOption: 2,
  /** The furthest a "least walking" or "quick" option may look: its heading stands above the walk to each shop. */
  closeRoleMeters: 500,
  minutes: 1440,
  cityChars: 40,
  nameChars: 40,
  wishChars: 80,
  keywordChars: 12,
  reasonChars: { ja: 70, en: 140 },
} as const;

export const MEAL_ADVICE_TASKS = ["meals", "meal-refine"] as const;
export const MEAL_ADVICE_LOCALES = ["ja", "en"] as const;
export const MEAL_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const MEAL_WEATHER = ["rain", "clear", "cloud", "snow"] as const;
export const MEAL_STOP_KINDS = ["sight", "restaurant", "cafe", "hotel", "other"] as const;
export const MEAL_MEALS = ["lunch", "dinner"] as const;
export const MEAL_PARTIES = ["solo", "couple", "friends", "family-kids", "family-elder"] as const;
export const MEAL_BUDGET_FEELS = ["low", "mid", "high"] as const;
export const MEAL_REFINE_ASKS = ["casual", "quiet", "nearer", "cheaper", "different", "wish"] as const;
export const MEAL_ROLES = ["fits-day", "near", "relaxed", "quick", "treat", "local", "light", "hearty"] as const;
/** The roles whose name is a promise about the distance (see MEAL_ADVICE_LIMITS.closeRoleMeters). */
export const MEAL_CLOSE_ROLES = ["near", "quick"] as const;
/** HotPepper Gourmet's genre master, less karaoke (G011) and bars (G012), which are not meals. */
export const MEAL_GENRES = ["G001", "G002", "G003", "G004", "G005", "G006", "G007", "G008", "G009", "G010", "G013", "G014", "G015", "G016", "G017"] as const;
export const MEAL_BUDGET_CEILINGS = [1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000] as const;
/** Yes/no filters of HotPepper's shop search that matter to a traveller. */
export const MEAL_FEATURES = ["private_room", "child", "non_smoking", "card", "tatami", "horigotatsu", "barrier_free", "english", "wifi", "parking"] as const;
export const MEAL_WITHIN_METERS = [300, 500, 1000, 2000] as const;

export type MealAdviceTask = (typeof MEAL_ADVICE_TASKS)[number];
export type MealAdviceLocale = (typeof MEAL_ADVICE_LOCALES)[number];
export type MealWeekday = (typeof MEAL_WEEKDAYS)[number];
export type MealWeather = (typeof MEAL_WEATHER)[number];
export type MealStopKind = (typeof MEAL_STOP_KINDS)[number];
export type MealKind = (typeof MEAL_MEALS)[number];
export type MealParty = (typeof MEAL_PARTIES)[number];
export type MealBudgetFeel = (typeof MEAL_BUDGET_FEELS)[number];
export type MealRefineAsk = (typeof MEAL_REFINE_ASKS)[number];
export type MealRole = (typeof MEAL_ROLES)[number];
export type MealGenre = (typeof MEAL_GENRES)[number];
export type MealBudgetCeiling = (typeof MEAL_BUDGET_CEILINGS)[number];
export type MealFeature = (typeof MEAL_FEATURES)[number];
export type MealWithinMeters = (typeof MEAL_WITHIN_METERS)[number];

export type MealBriefStop = {
  kind: MealStopKind;
  /** Only a bundled sight's name. A shop or a place found by search goes without. */
  name?: string;
  start: string;
  stayMinutes: number;
  meal?: MealKind;
  booked?: true;
};

export type MealBriefDay = {
  day: number;
  weekday: MealWeekday | null;
  weather: MealWeather | null;
  walkMinutes: number;
  stops: MealBriefStop[];
};

export type MealBriefSlot = {
  /** "d1-lunch", "d2-dinner": the day and the meal. */
  slot: string;
  day: number;
  meal: MealKind;
  time: string;
  minutesUntilNext: number | null;
  afterKind: MealStopKind | null;
  beforeKind: MealStopKind | null;
};

export type MealBriefPrefs = {
  party: MealParty | null;
  budget: MealBudgetFeel | null;
  wish: string;
};

export type MealBrief = {
  city: string | null;
  days: MealBriefDay[];
  slots: MealBriefSlot[];
  prefs: MealBriefPrefs;
};

/** What the page searches with: every field comes out of a fixed list. */
export type MealConditions = {
  role: MealRole;
  genre: MealGenre | null;
  keyword: string | null;
  budgetMax: MealBudgetCeiling | null;
  features: MealFeature[];
  withinMeters: MealWithinMeters;
};

export type MealOption = MealConditions & {
  /** One sentence about the plan, in the request's language. Shown as an AI suggestion. */
  reason: string;
};

export type MealRefine = {
  slot: string;
  previous: MealConditions[];
  ask: MealRefineAsk;
  wish: string;
};

export type MealAdviceRequest =
  | { task: "meals"; locale: MealAdviceLocale; brief: MealBrief }
  | { task: "meal-refine"; locale: MealAdviceLocale; brief: MealBrief; refine: MealRefine };

export type MealAdviceSlotAnswer = { slot: string; options: MealOption[] };
export type MealAdviceAnswer = { slots: MealAdviceSlotAnswer[] };

/** What the relay answers besides 200: {"code": …} with one of these. */
export type MealAdviceErrorCode = "invalid_request" | "forbidden" | "method_not_allowed" | "not_configured" | "budget_exhausted" | "unavailable";

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function oneOf<const T extends readonly (string | number)[]>(list: T, value: unknown): T[number] | undefined {
  return (list as readonly unknown[]).includes(value) ? value as T[number] : undefined;
}

/** Null stays null; anything outside the list is `undefined`, which callers treat as a refusal. */
function nullableOneOf<const T extends readonly (string | number)[]>(list: T, value: unknown): T[number] | null | undefined {
  return value === null || value === undefined ? null : oneOf(list, value);
}

function characters(text: string) {
  return [...text].length;
}

/** Trimmed, with control and invisible format characters removed; null when not a string or too long. */
export function cleanMealText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return characters(text) <= maxChars ? text : null;
}

function minutes(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MEAL_ADVICE_LIMITS.minutes ? value : null;
}

function clock(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function dayNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MEAL_ADVICE_LIMITS.days ? value : null;
}

/**
 * A search word: letters, kana and kanji only (so no address, link, number or
 * symbol can ride in), at most twelve of them.
 */
export function cleanMealKeyword(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const word = value.trim();
  if (word === "") return null;
  return /^\p{L}+$/u.test(word) && characters(word) <= MEAL_ADVICE_LIMITS.keywordChars ? word : undefined;
}

/**
 * A sentence the page may show. Money, ratings and links are refused outright:
 * those are the directory's to state, never the model's. Times are allowed,
 * since the brief gives them.
 */
export function mealReasonAllowed(reason: string, locale: MealAdviceLocale) {
  if (reason === "" || characters(reason) > MEAL_ADVICE_LIMITS.reasonChars[locale]) return false;
  return !/https?:|:\/\/|www\.|[円¥￥$＄★☆]|\byen\b|\bJPY\b/i.test(reason);
}

function cleanConditions(input: unknown): MealConditions | null {
  const raw = record(input);
  if (!raw) return null;
  const role = oneOf(MEAL_ROLES, raw.role);
  const genre = nullableOneOf(MEAL_GENRES, raw.genre);
  const keyword = cleanMealKeyword(raw.keyword);
  const budgetMax = nullableOneOf(MEAL_BUDGET_CEILINGS, raw.budgetMax);
  const withinMeters = oneOf(MEAL_WITHIN_METERS, raw.withinMeters);
  const listed = raw.features === undefined || raw.features === null ? [] : raw.features;
  if (role === undefined || genre === undefined || keyword === undefined || budgetMax === undefined || withinMeters === undefined) return null;
  // "Least walking" over shops a long walk away would be the page contradicting itself.
  if ((MEAL_CLOSE_ROLES as readonly string[]).includes(role) && withinMeters > MEAL_ADVICE_LIMITS.closeRoleMeters) return null;
  if (!Array.isArray(listed) || listed.length > MEAL_ADVICE_LIMITS.featuresPerOption) return null;
  const features: MealFeature[] = [];
  for (const entry of listed) {
    const feature = oneOf(MEAL_FEATURES, entry);
    if (feature === undefined) return null;
    if (!features.includes(feature)) features.push(feature);
  }
  return { role, genre, keyword, budgetMax, features, withinMeters };
}

/** One option of an answer, or null when any part of it is outside the contract. */
export function cleanMealOption(input: unknown, locale: MealAdviceLocale): MealOption | null {
  const conditions = cleanConditions(input);
  const reason = cleanMealText(record(input)?.reason, 400);
  if (!conditions || reason === null || !mealReasonAllowed(reason, locale)) return null;
  return { ...conditions, reason };
}

function cleanStop(input: unknown): MealBriefStop | null {
  const raw = record(input);
  if (!raw) return null;
  const kind = oneOf(MEAL_STOP_KINDS, raw.kind);
  const start = clock(raw.start);
  const stayMinutes = minutes(raw.stayMinutes);
  if (kind === undefined || start === null || stayMinutes === null) return null;
  const stop: MealBriefStop = { kind, start, stayMinutes };
  if (raw.name !== undefined && raw.name !== null) {
    const name = cleanMealText(raw.name, MEAL_ADVICE_LIMITS.nameChars);
    if (name === null) return null;
    if (name !== "") stop.name = name;
  }
  if (raw.meal !== undefined && raw.meal !== null) {
    const meal = oneOf(MEAL_MEALS, raw.meal);
    if (meal === undefined) return null;
    stop.meal = meal;
  }
  if (raw.booked === true) stop.booked = true;
  return stop;
}

/**
 * The brief rebuilt from scratch out of validated parts: anything the contract
 * does not name (coordinates, shop ids, whatever a caller added) is not copied.
 * Null when a part is of the wrong type, outside its list, too long or too many.
 */
export function cleanMealBrief(input: unknown): MealBrief | null {
  const raw = record(input);
  if (!raw || !Array.isArray(raw.days) || !Array.isArray(raw.slots)) return null;
  if (raw.days.length < 1 || raw.days.length > MEAL_ADVICE_LIMITS.days) return null;
  if (raw.slots.length < 1 || raw.slots.length > MEAL_ADVICE_LIMITS.slots) return null;

  let city: string | null = null;
  if (raw.city !== undefined && raw.city !== null) {
    city = cleanMealText(raw.city, MEAL_ADVICE_LIMITS.cityChars);
    if (city === null) return null;
    if (city === "") city = null;
  }

  const days: MealBriefDay[] = [];
  let stopCount = 0;
  for (const entry of raw.days) {
    const rawDay = record(entry);
    if (!rawDay || !Array.isArray(rawDay.stops)) return null;
    const day = dayNumber(rawDay.day);
    const weekday = nullableOneOf(MEAL_WEEKDAYS, rawDay.weekday);
    const weather = nullableOneOf(MEAL_WEATHER, rawDay.weather);
    const walkMinutes = minutes(rawDay.walkMinutes);
    if (day === null || weekday === undefined || weather === undefined || walkMinutes === null) return null;
    if (days.some((known) => known.day === day)) return null;
    stopCount += rawDay.stops.length;
    if (stopCount > MEAL_ADVICE_LIMITS.stops) return null;
    const stops: MealBriefStop[] = [];
    for (const rawStop of rawDay.stops) {
      const stop = cleanStop(rawStop);
      if (!stop) return null;
      stops.push(stop);
    }
    days.push({ day, weekday, weather, walkMinutes, stops });
  }

  const slots: MealBriefSlot[] = [];
  for (const entry of raw.slots) {
    const rawSlot = record(entry);
    if (!rawSlot) return null;
    const day = dayNumber(rawSlot.day);
    const meal = oneOf(MEAL_MEALS, rawSlot.meal);
    const time = clock(rawSlot.time);
    const afterKind = nullableOneOf(MEAL_STOP_KINDS, rawSlot.afterKind);
    const beforeKind = nullableOneOf(MEAL_STOP_KINDS, rawSlot.beforeKind);
    const minutesUntilNext = rawSlot.minutesUntilNext === null || rawSlot.minutesUntilNext === undefined ? null : minutes(rawSlot.minutesUntilNext);
    if (day === null || meal === undefined || time === null || afterKind === undefined || beforeKind === undefined) return null;
    if (minutesUntilNext === null && rawSlot.minutesUntilNext !== null && rawSlot.minutesUntilNext !== undefined) return null;
    // The id is the day and the meal, so it cannot carry anything else.
    if (rawSlot.slot !== `d${day}-${meal}` || slots.some((known) => known.slot === rawSlot.slot)) return null;
    if (!days.some((known) => known.day === day)) return null;
    slots.push({ slot: rawSlot.slot, day, meal, time, minutesUntilNext, afterKind, beforeKind });
  }

  const rawPrefs = raw.prefs === undefined || raw.prefs === null ? {} : record(raw.prefs);
  if (!rawPrefs) return null;
  const party = nullableOneOf(MEAL_PARTIES, rawPrefs.party);
  const budget = nullableOneOf(MEAL_BUDGET_FEELS, rawPrefs.budget);
  const wish = rawPrefs.wish === undefined || rawPrefs.wish === null ? "" : cleanMealText(rawPrefs.wish, MEAL_ADVICE_LIMITS.wishChars);
  if (party === undefined || budget === undefined || wish === null) return null;

  return { city, days, slots, prefs: { party, budget, wish } };
}

function cleanRefine(input: unknown, brief: MealBrief): MealRefine | null {
  const raw = record(input);
  if (!raw || !Array.isArray(raw.previous) || raw.previous.length > MEAL_ADVICE_LIMITS.optionsPerSlot) return null;
  const ask = oneOf(MEAL_REFINE_ASKS, raw.ask);
  const wish = raw.wish === undefined || raw.wish === null ? "" : cleanMealText(raw.wish, MEAL_ADVICE_LIMITS.wishChars);
  if (ask === undefined || wish === null || typeof raw.slot !== "string") return null;
  if (!brief.slots.some((slot) => slot.slot === raw.slot)) return null;
  // Asking with words needs the words.
  if (ask === "wish" && wish === "") return null;
  const previous: MealConditions[] = [];
  for (const entry of raw.previous) {
    const conditions = cleanConditions(entry);
    if (!conditions) return null;
    previous.push(conditions);
  }
  return { slot: raw.slot, previous, ask, wish };
}

/** The whole request body as the relay accepts it, rebuilt clean; null when it must be refused. */
export function cleanMealAdviceRequest(body: unknown): MealAdviceRequest | null {
  const raw = record(body);
  if (!raw) return null;
  const task = oneOf(MEAL_ADVICE_TASKS, raw.task);
  const locale = oneOf(MEAL_ADVICE_LOCALES, raw.locale);
  const brief = cleanMealBrief(raw.brief);
  if (task === undefined || locale === undefined || !brief) return null;
  if (task === "meals") return { task, locale, brief };
  const refine = cleanRefine(raw.refine, brief);
  return refine ? { task, locale, brief, refine } : null;
}

/** The slots an answer to this request may speak about. */
export function mealAdviceSlotIds(request: MealAdviceRequest): string[] {
  return request.task === "meal-refine" ? [request.refine.slot] : request.brief.slots.map((slot) => slot.slot);
}

/**
 * An answer reduced to what the contract allows: only the slots that were
 * asked about, each once; per slot at most three options, each valid on its
 * own and each with a different role. An option that breaks a rule is left
 * out, not repaired. Null when nothing usable is left, which callers treat
 * exactly like no answer.
 */
export function cleanMealAdviceAnswer(input: unknown, slotIds: readonly string[], locale: MealAdviceLocale): MealAdviceAnswer | null {
  const raw = record(input);
  if (!raw || !Array.isArray(raw.slots)) return null;
  const slots: MealAdviceSlotAnswer[] = [];
  for (const entry of raw.slots.slice(0, MEAL_ADVICE_LIMITS.slots * 2)) {
    const rawSlot = record(entry);
    if (!rawSlot || typeof rawSlot.slot !== "string" || !Array.isArray(rawSlot.options)) continue;
    const slot = rawSlot.slot;
    if (!slotIds.includes(slot) || slots.some((known) => known.slot === slot)) continue;
    const options: MealOption[] = [];
    for (const rawOption of rawSlot.options.slice(0, MEAL_ADVICE_LIMITS.optionsPerSlot * 2)) {
      if (options.length >= MEAL_ADVICE_LIMITS.optionsPerSlot) break;
      const option = cleanMealOption(rawOption, locale);
      if (option && !options.some((known) => known.role === option.role)) options.push(option);
    }
    if (options.length > 0) slots.push({ slot, options });
  }
  return slots.length > 0 ? { slots } : null;
}
