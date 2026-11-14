/*
 * Which calendar day each planned day goes on, given a forecast.
 *
 * The planner has already decided which places share a day and in what order
 * — on travel time, which a forecast does not change. All that is left to the
 * weather is the numbering: a day spent in gardens is better on the dry date
 * and the museum day on the wet one. Days swap whole, so no leg, lunch or
 * hotel ride changes; only "Day 2" and "Day 3" trade places.
 */

/** A rain chance from which a day counts as wet. */
export const WET_RAIN_PERCENT = 60;
/** Days are only renumbered when it keeps at least this many outdoor minutes out of the wet. */
export const WEATHER_SWAP_MINUTES = 60;

/** A forecast day on which being outdoors is a poor plan. */
export function isWetForecast(day: { kind: string; precipitationPercent: number | null }): boolean {
  return day.kind === "rain" || day.kind === "snow" || day.kind === "storm"
    || (day.precipitationPercent !== null && day.precipitationPercent >= WET_RAIN_PERCENT);
}

/** What a wet day's forecast actually says, for the sentence that explains it. */
export type WetReason = "rain" | "snow" | "storm" | "chance";

/**
 * Why a forecast day counts as wet: its kind when that is rain, snow or
 * storm, otherwise only that precipitation is likely — a cloudy day at 60%
 * is not "rain is forecast".
 */
export function wetReason(day: { kind: string }): WetReason {
  return day.kind === "rain" || day.kind === "snow" || day.kind === "storm" ? day.kind : "chance";
}

export type WeatherSlot = {
  /** Minutes the group now on this day spends at outdoor places. */
  outdoorMinutes: number;
  /** The traveller pinned a place to this day: its group stays. */
  fixed: boolean;
  /** The forecast for this day's date; null when there is none. */
  wet: boolean | null;
};

export type WeatherOrder = {
  /** order[slot] is the slot whose group now goes on this day. Identity when nothing moves. */
  order: number[];
  changed: boolean;
  /** Wet slots that received another group, in ascending order. */
  wetSlotsChanged: number[];
  /** Outdoor minutes kept out of the wet by the change (0 when nothing moves). */
  savedMinutes: number;
};

/**
 * The assignment of groups to days with the fewest outdoor minutes on wet
 * days. Only days that are free (not pinned) and have a forecast take part:
 * a day without one is not assumed dry, so nothing is moved onto it or off
 * it. Wet days are alike and dry days are alike, so the best assignment is
 * simply "the groups with the least outdoors go on the wet days"; of all such
 * assignments the one that moves the fewest groups is returned, and none at
 * all unless it saves WEATHER_SWAP_MINUTES.
 */
export function weatherDayOrder(slots: readonly WeatherSlot[]): WeatherOrder {
  const same: WeatherOrder = { order: slots.map((_, index) => index), changed: false, wetSlotsChanged: [], savedMinutes: 0 };
  const free = slots.flatMap((slot, index) => (!slot.fixed && slot.wet !== null ? [index] : []));
  const wetSlots = free.filter((index) => slots[index].wet === true);
  if (wetSlots.length === 0 || wetSlots.length === free.length) return same;

  // The groups that belong on the wet days: least outdoors first; on equal
  // minutes the group already there, then the earlier day, so a tie never
  // moves anything.
  const indoors = new Set([...free]
    .sort((left, right) => slots[left].outdoorMinutes - slots[right].outdoorMinutes
      || Number(slots[right].wet === true) - Number(slots[left].wet === true)
      || left - right)
    .slice(0, wetSlots.length));
  const before = wetSlots.reduce((sum, index) => sum + slots[index].outdoorMinutes, 0);
  const after = [...indoors].reduce((sum, index) => sum + slots[index].outdoorMinutes, 0);
  if (before - after < WEATHER_SWAP_MINUTES) return same;

  // Groups already on the right kind of day stay. The rest trade: each wet
  // day that held an outdoor group takes the next indoor group from a dry
  // day, and gives its own group that dry day.
  const incoming = free.filter((index) => indoors.has(index) && slots[index].wet !== true);
  const outgoing = wetSlots.filter((index) => !indoors.has(index));
  const order = [...same.order];
  outgoing.forEach((wetSlot, position) => {
    order[wetSlot] = incoming[position];
    order[incoming[position]] = wetSlot;
  });
  return { order, changed: true, wetSlotsChanged: outgoing, savedMinutes: before - after };
}
