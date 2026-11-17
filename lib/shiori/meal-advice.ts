import { budgetLabel, inJapan, lunchPrice, shopsForMeal, type HotpepperQuery, type HotpepperShop } from "../hotpepper-client.ts";
import {
  MEAL_ADVICE_LIMITS,
  MEAL_BUDGET_FEELS,
  MEAL_CLOSE_ROLES,
  MEAL_PARTIES,
  MEAL_WITHIN_METERS,
  cleanMealBrief,
  cleanMealText,
  type MealAdviceLocale,
  type MealBrief,
  type MealBriefDay,
  type MealBriefPrefs,
  type MealBriefSlot,
  type MealBriefStop,
  type MealBudgetFeel,
  type MealConditions,
  type MealFeature,
  type MealGenre,
  type MealKind,
  type MealOption,
  type MealParty,
  type MealRefineAsk,
  type MealRole,
  type MealStopKind,
  type MealWeather,
  type MealWeekday,
  type MealWithinMeters,
} from "./meal-advice-contract.ts";
import type { ShioriDay, ShioriPlace, ShioriPlan } from "./plan.ts";

/*
 * The page's half of the meal advisor, as pure functions: the outline of the
 * plan that is sent to the AI relay, the shop search an answer turns into,
 * and what the screen says about it.
 *
 * What goes out is the shape of the days — kinds of stops, times, walking,
 * weather, the traveller's own wish — and the names of sights from the
 * bundled list only, under the name the list itself gives them. A shop or a
 * place that came from a search (HotPepper, Apple, a map or Wikidata lookup),
 * from a shared link or from what the traveller typed goes without its name,
 * and no position is sent at all. What comes back is search conditions and a
 * sentence; every shop on screen comes from the HotPepper search itself.
 */

function minutesOf(clock: string) {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

/** The bundled sights: place id ("wikidata-Q…") → the names the bundled list gives that sight. */
export type MealSights = ReadonlyMap<string, readonly string[]>;

/**
 * The sights of the bundled list, by the id a place made from one carries.
 * The id's prefix alone proves nothing: a place found by the open lookup, or
 * carried by a shared link, has a "wikidata-" id as well.
 */
export function mealSights(cities: ReadonlyArray<{ sights: ReadonlyArray<{ q: string; ja: string; en: string }> }>): MealSights {
  const sights = new Map<string, string[]>();
  for (const city of cities) {
    for (const sight of city.sights) {
      const names = sights.get(`wikidata-${sight.q}`) ?? [];
      for (const name of [sight.ja.trim(), sight.en.trim()]) if (name && !names.includes(name)) names.push(name);
      sights.set(`wikidata-${sight.q}`, names);
    }
  }
  return sights;
}

/** What a stop is, said without its name. Only a sight of the bundled list is a "sight". */
export function mealStopKind(place: Pick<ShioriPlace, "id" | "kind" | "meal">, sights: MealSights): MealStopKind {
  const kind = (place.kind ?? "").toLowerCase();
  if (place.meal || /restaurant/.test(kind)) return "restaurant";
  if (/cafe|café|bakery|coffee/.test(kind)) return "cafe";
  if (/hotel|ryokan|hostel|lodging/.test(kind)) return "hotel";
  return sights.has(place.id) ? "sight" : "other";
}

/**
 * Only a sight of the bundled list may be named, and only by the name the
 * list gives it: a place that merely carries such an id under other words
 * (typed, renamed, from a link) is left unnamed. A name that does not fit is
 * left out, not cut.
 */
function sendableName(place: Pick<ShioriPlace, "id" | "name" | "kind" | "meal">, sights: MealSights): string | null {
  if (mealStopKind(place, sights) !== "sight") return null;
  const name = cleanMealText(place.name, MEAL_ADVICE_LIMITS.nameChars);
  return name && sights.get(place.id)?.includes(name) ? name : null;
}

const WEEKDAYS: readonly MealWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The weekday of a trip day ("2026-11-20" + 0 → "fri"); null without a readable start date. */
export function mealWeekday(startDate: string | null | undefined, dayIndex: number): MealWeekday | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const ms = Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return WEEKDAYS[new Date(ms + dayIndex * 86_400_000).getUTCDay()];
}

/** The forecast's kind in the four words the brief has; null for no forecast. */
export function mealWeather(kind: string | null | undefined): MealWeather | null {
  switch (kind) {
    case "clear": return "clear";
    case "partly": case "cloudy": case "fog": return "cloud";
    case "rain": case "storm": return "rain";
    case "snow": return "snow";
    default: return null;
  }
}

/** "d1-lunch": the day as the traveller counts it, and the meal. */
export function mealSlotId(dayIndex: number, meal: MealKind) {
  return `d${dayIndex + 1}-${meal}`;
}

type SlotMeal = ShioriDay["meals"][number];

/**
 * What an answer for a slot was made for: the slot, its time and where it is.
 * An answer is shown only while this is unchanged, so a suggestion made for
 * 12:30 near one place is never shown under 14:00 near another.
 */
export function mealSlotKey(dayIndex: number, meal: Pick<SlotMeal, "kind" | "start" | "near">) {
  return `${mealSlotId(dayIndex, meal.kind)}|${meal.start}|${meal.near.latitude.toFixed(4)},${meal.near.longitude.toFixed(4)}`;
}

/** The open meals an AI may be asked about: in Japan (where the shop guide is), on the day they are named for. */
export function openMealSlots(plan: Pick<ShioriPlan, "days">): Array<{ slot: string; key: string; day: ShioriDay; meal: SlotMeal }> {
  const found: Array<{ slot: string; key: string; day: ShioriDay; meal: SlotMeal }> = [];
  for (const day of plan.days) {
    if (day.index < 0 || day.index >= MEAL_ADVICE_LIMITS.days) continue;
    for (const meal of day.meals) {
      const slot = mealSlotId(day.index, meal.kind);
      if (meal.nextDay || !inJapan(meal.near) || found.some((known) => known.slot === slot)) continue;
      if (found.length >= MEAL_ADVICE_LIMITS.slots) return found;
      found.push({ slot, key: mealSlotKey(day.index, meal), day, meal });
    }
  }
  return found;
}

/** slot → key for every open slot of the plan as it stands. */
export function mealSlotKeys(plan: Pick<ShioriPlan, "days"> | null): Record<string, string> {
  return plan ? Object.fromEntries(openMealSlots(plan).map((entry) => [entry.slot, entry.key])) : {};
}

export type MealBriefInput = {
  plan: Pick<ShioriPlan, "days">;
  /** The bundled sights (mealSights): the only places whose name is sent. */
  sights: MealSights;
  /** The destination's name from the bundled list, or null: a name typed or carried by a link is not sent. */
  city: string | null;
  /** The trip's first day ("2026-11-20"), when the traveller gave one. */
  startDate?: string | null;
  /** The forecast's kind per day index, where there is one. */
  weatherByIndex?: Readonly<Record<number, { kind: string } | undefined>> | null;
  prefs: MealBriefPrefs;
};

/**
 * The outline that is sent. Null when the plan has no open meal to ask about,
 * or when the outline would not pass the relay's own check (it is run here,
 * so a brief the relay would refuse is never sent).
 */
export function buildMealBrief(input: MealBriefInput): MealBrief | null {
  const open = openMealSlots(input.plan);
  if (open.length === 0) return null;

  const days: MealBriefDay[] = [];
  let stopCount = 0;
  for (const day of input.plan.days) {
    if (day.index < 0 || day.index >= MEAL_ADVICE_LIMITS.days) continue;
    const stops: MealBriefStop[] = [];
    for (const stop of day.stops) {
      if (stopCount >= MEAL_ADVICE_LIMITS.stops) break;
      // A visit that runs past midnight has no time of this day to give.
      if (stop.arriveNextDay) continue;
      const entry: MealBriefStop = {
        kind: mealStopKind(stop.place, input.sights),
        start: stop.arrive,
        stayMinutes: Math.max(0, Math.min(MEAL_ADVICE_LIMITS.minutes, Math.round(stop.stayMinutes))),
      };
      const name = sendableName(stop.place, input.sights);
      if (name) entry.name = name;
      if (stop.place.meal) entry.meal = stop.place.meal;
      if (stop.reserved) entry.booked = true;
      stops.push(entry);
      stopCount += 1;
    }
    days.push({
      day: day.index + 1,
      weekday: mealWeekday(input.startDate, day.index),
      weather: mealWeather(input.weatherByIndex?.[day.index]?.kind),
      walkMinutes: Math.max(0, Math.min(MEAL_ADVICE_LIMITS.minutes, Math.round(day.walkMinutes))),
      stops,
    });
  }

  const slots: MealBriefSlot[] = open.map(({ slot, day, meal }) => {
    const after = day.stops[meal.afterStop];
    const next = day.stops[meal.afterStop + 1];
    // Only a booked time is one the next stop "must" begin at; the rest are the planner's estimates.
    let minutesUntilNext: number | null = null;
    if (next?.reserved && !next.arriveNextDay) {
      const free = minutesOf(next.arrive) - (day.legs[meal.afterStop]?.minutes ?? 0) - minutesOf(meal.start);
      if (Number.isFinite(free)) minutesUntilNext = Math.max(0, Math.min(MEAL_ADVICE_LIMITS.minutes, Math.round(free)));
    }
    return {
      slot,
      day: day.index + 1,
      meal: meal.kind,
      time: meal.start,
      minutesUntilNext,
      afterKind: after ? mealStopKind(after.place, input.sights) : null,
      beforeKind: next ? mealStopKind(next.place, input.sights) : day.toHotel ? "hotel" : null,
    };
  });

  return cleanMealBrief({ city: input.city ? cleanMealText(input.city, MEAL_ADVICE_LIMITS.cityChars) : null, days, slots, prefs: cleanMealPrefs(input.prefs) });
}

export const EMPTY_MEAL_PREFS: MealBriefPrefs = { party: null, budget: null, wish: "" };

/** A wish as it may be sent: cleaned and cut to the limit (the relay refuses, rather than cuts, a longer one). */
export function cleanMealWish(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return [...cleaned].slice(0, MEAL_ADVICE_LIMITS.wishChars).join("").trim();
}

/** The form's answers, whatever was stored or typed, as the brief accepts them. */
export function cleanMealPrefs(input: unknown): MealBriefPrefs {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    party: (MEAL_PARTIES as readonly unknown[]).includes(raw.party) ? raw.party as MealParty : null,
    budget: (MEAL_BUDGET_FEELS as readonly unknown[]).includes(raw.budget) ? raw.budget as MealBudgetFeel : null,
    wish: cleanMealWish(raw.wish),
  };
}

/** The conditions of an option, without its sentence: what a refinement sends back as "what was shown". */
export function mealConditionsOf(option: MealConditions): MealConditions {
  return { role: option.role, genre: option.genre, keyword: option.keyword, budgetMax: option.budgetMax, features: [...option.features], withinMeters: option.withinMeters };
}

/** The shop search an option stands for. The budget is not part of it: it is applied to the answer (shopsForOption). */
export function mealOptionQuery(option: MealConditions, near: { latitude: number; longitude: number }, meal: MealKind): HotpepperQuery {
  return {
    near,
    withinMeters: option.withinMeters,
    ...(option.keyword ? { name: option.keyword } : {}),
    meal,
    ...(option.genre ? { genre: option.genre } : {}),
    ...(option.features.length > 0 ? { features: option.features.slice(0, MEAL_ADVICE_LIMITS.featuresPerOption) } : {}),
  };
}

function yen(label: string | null) {
  if (!label) return null;
  const figure = Number(label.replace(/[^\d]/g, ""));
  return Number.isFinite(figure) && figure > 0 ? figure : null;
}

/**
 * What the shop itself states for this meal, in yen: its lunch price at
 * lunch, the top of its budget band at dinner. Null when it states none.
 * A band with no top ("30,001円〜") is as high as it likes: Infinity.
 */
export function statedMealYen(shop: Pick<HotpepperShop, "budget" | "budgetAverage">, meal: MealKind): number | null {
  if (meal === "lunch") return yen(lunchPrice(shop.budgetAverage));
  const band = budgetLabel(shop.budget);
  if (!band) return null;
  if (band.endsWith("円〜")) return Number.POSITIVE_INFINITY;
  const figures = band.split("〜").map((part) => yen(part)).filter((value): value is number => value !== null);
  return figures.length > 0 ? figures[figures.length - 1] : null;
}

/**
 * The shops shown under one option: within the option's distance; where the
 * option has a ceiling, shops that state a price above it are left out, shops
 * that state one within it come first, and shops that state none come after
 * (their price is not known, so nothing is claimed about it). Inside each
 * group the usual order for the meal (shopsForMeal). `taken` are shops already
 * shown under an earlier option of the same meal.
 */
export function shopsForOption(
  shops: readonly HotpepperShop[],
  option: Pick<MealConditions, "budgetMax" | "withinMeters">,
  meal: MealKind,
  taken: ReadonlySet<string> = new Set(),
  limit = 3,
): HotpepperShop[] {
  const near = shops.filter((shop) => shop.distanceMeters <= option.withinMeters && !taken.has(shop.id));
  if (option.budgetMax === null) return shopsForMeal(near, meal, limit);
  const ceiling = option.budgetMax;
  const fits = near.filter((shop) => { const stated = statedMealYen(shop, meal); return stated !== null && stated <= ceiling; });
  const unstated = near.filter((shop) => statedMealYen(shop, meal) === null);
  return [...shopsForMeal(fits, meal, limit), ...shopsForMeal(unstated, meal, limit)].slice(0, limit);
}

/**
 * How far the page may look when an option's own distance finds no shop: a
 * search word within 300 m is often nothing at all. Up to 1 km (what the plain
 * list of a meal row uses), and 500 m for "least walking" and "quick", whose
 * heading is a promise about the distance (the contract refuses such an
 * option that asks for more). Null when the option already looks that far.
 */
export function widerMealMeters(option: Pick<MealConditions, "role" | "withinMeters">): MealWithinMeters | null {
  const limit = (MEAL_CLOSE_ROLES as readonly string[]).includes(option.role) ? MEAL_ADVICE_LIMITS.closeRoleMeters : 1000;
  return option.withinMeters < limit ? limit : null;
}

/**
 * The shops of a wider search, held to the smallest distance step that has
 * any: the step is returned so the screen can say how far it really looked.
 */
export function shopsWithinWider(
  shops: readonly HotpepperShop[],
  option: Pick<MealConditions, "role" | "budgetMax" | "withinMeters">,
  meal: MealKind,
  taken: ReadonlySet<string> = new Set(),
  limit = 3,
): { shops: HotpepperShop[]; withinMeters: MealWithinMeters } | null {
  const widest = widerMealMeters(option);
  if (widest === null) return null;
  for (const withinMeters of MEAL_WITHIN_METERS) {
    if (withinMeters <= option.withinMeters || withinMeters > widest) continue;
    const found = shopsForOption(shops, { budgetMax: option.budgetMax, withinMeters }, meal, taken, limit);
    if (found.length > 0) return { shops: found, withinMeters };
  }
  return null;
}

/** The fixed name of each kind of reason; the model picks the kind, never the words. */
export const MEAL_ROLE_LABELS: Record<MealAdviceLocale, Record<MealRole, string>> = {
  ja: { "fits-day": "この日に合う", near: "歩かずに済む", relaxed: "座ってゆっくり", quick: "さっと食べる", treat: "少し贅沢に", local: "土地のもの", light: "軽めに", hearty: "しっかり食べる" },
  en: { "fits-day": "Fits the day", near: "Least walking", relaxed: "Sit down and rest", quick: "Quick bite", treat: "A treat", local: "Local food", light: "Something light", hearty: "A full meal" },
};

/** HotPepper Gourmet's genre names (its genre master), and plain English for them. */
export const MEAL_GENRE_LABELS: Record<MealAdviceLocale, Record<MealGenre, string>> = {
  ja: { G001: "居酒屋", G002: "ダイニングバー・バル", G003: "創作料理", G004: "和食", G005: "洋食", G006: "イタリアン・フレンチ", G007: "中華", G008: "焼肉・ホルモン", G009: "アジア・エスニック料理", G010: "各国料理", G013: "ラーメン", G014: "カフェ・スイーツ", G015: "その他グルメ", G016: "お好み焼き・もんじゃ", G017: "韓国料理" },
  en: { G001: "izakaya", G002: "dining bar", G003: "creative cuisine", G004: "Japanese food", G005: "Western food", G006: "Italian / French", G007: "Chinese", G008: "yakiniku", G009: "Asian / ethnic", G010: "world cuisines", G013: "ramen", G014: "café / sweets", G015: "other", G016: "okonomiyaki / monjayaki", G017: "Korean" },
};

export const MEAL_FEATURE_LABELS: Record<MealAdviceLocale, Record<MealFeature, string>> = {
  ja: { private_room: "個室あり", child: "お子様連れOK", non_smoking: "禁煙席あり", card: "カード可", tatami: "座敷あり", horigotatsu: "掘りごたつあり", barrier_free: "バリアフリー", english: "英語メニューあり", wifi: "Wi-Fiあり", parking: "駐車場あり" },
  en: { private_room: "private room", child: "children welcome", non_smoking: "non-smoking seats", card: "cards accepted", tatami: "tatami seating", horigotatsu: "sunken-floor seating", barrier_free: "step-free", english: "English menu", wifi: "Wi-Fi", parking: "parking" },
};

/** The search an option ran, in words: "和食 ・ 「蕎麦」 ・ 2,000円まで ・ 500m以内 ・ 禁煙席あり". */
export function mealConditionsText(option: MealConditions, locale: MealAdviceLocale): string {
  const parts: string[] = [];
  if (option.genre) parts.push(MEAL_GENRE_LABELS[locale][option.genre]);
  if (option.keyword) parts.push(locale === "ja" ? `「${option.keyword}」` : `"${option.keyword}"`);
  if (option.budgetMax !== null) parts.push(locale === "ja" ? `${option.budgetMax.toLocaleString("ja-JP")}円まで` : `up to ¥${option.budgetMax.toLocaleString("en-US")}`);
  parts.push(locale === "ja" ? `${option.withinMeters}m以内` : `within ${option.withinMeters} m`);
  for (const feature of option.features) parts.push(MEAL_FEATURE_LABELS[locale][feature]);
  return parts.join(" ・ ");
}

/** The quick refinements, in the order they are offered ("wish" is the text box). */
export const MEAL_QUICK_ASKS: readonly Exclude<MealRefineAsk, "wish">[] = ["casual", "quiet", "nearer", "cheaper", "different"];

/** One slot's answer as the page holds it: for which slot and plan it was made, and what it said. */
export type MealAdviceEntry = { key: string; options: MealOption[] };

/**
 * An answer's slots, each stamped with the key of the slot it was asked for,
 * kept only where the plan still has that slot unchanged. An answer that
 * arrives after the plan moved is dropped here rather than shown.
 */
export function entriesFromAnswer(
  answer: { slots: ReadonlyArray<{ slot: string; options: MealOption[] }> },
  askedKeys: Readonly<Record<string, string>>,
  currentKeys: Readonly<Record<string, string>>,
): Record<string, MealAdviceEntry> {
  const entries: Record<string, MealAdviceEntry> = {};
  for (const { slot, options } of answer.slots) {
    const key = askedKeys[slot];
    if (key && currentKeys[slot] === key && options.length > 0) entries[slot] = { key, options };
  }
  return entries;
}

/** The entry for a slot, if it was made for the slot as it stands now. */
export function liveMealEntry(entries: Readonly<Record<string, MealAdviceEntry>>, slot: string, key: string): MealAdviceEntry | null {
  const entry = entries[slot];
  return entry && entry.key === key ? entry : null;
}
