const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export type GoogleRegularOpeningPoint = {
  day: number;
  hour: number;
  minute: number;
};

export type GoogleOpeningEvaluation = {
  status: "open" | "closed" | "unknown";
  reason:
    | "closed_permanently"
    | "closed_temporarily"
    | "within_regular_period"
    | "outside_regular_periods"
    | "always_open"
    | "no_regular_open_periods"
    | "missing_schedule"
    | "invalid_schedule"
    | "invalid_local_datetime"
    | "unknown_business_status";
};

export type GoogleOpeningEvaluationInput = {
  businessStatus?: string | null;
  regularOpeningPeriods?: unknown;
};

export type GoogleCurrentOpeningEvaluationInput = {
  businessStatus?: string | null;
  currentOpeningPeriods?: unknown;
  currentSpecialDays?: unknown;
};

export type PlannedLocalDateTime = {
  date: string;
  time: string;
};

export type LocalOpeningWindow = {
  openMinutes: number;
  closeMinutes: number;
};

function openingPoint(value: unknown): GoogleRegularOpeningPoint | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const { day, hour, minute } = candidate;
  if (!Number.isInteger(day) || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if ((day as number) < 0 || (day as number) > 6) return null;
  if ((hour as number) < 0 || (hour as number) > 23) return null;
  if ((minute as number) < 0 || (minute as number) > 59) return null;
  return { day: day as number, hour: hour as number, minute: minute as number };
}

function minuteOfWeek(point: GoogleRegularOpeningPoint) {
  return point.day * MINUTES_PER_DAY + point.hour * 60 + point.minute;
}

function plannedMinuteOfWeek(value: PlannedLocalDateTime) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(value.time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const dayOfMonth = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  // UTC is used only to obtain the weekday of the already-local calendar date.
  // This avoids the server or browser timezone changing the answer.
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dayOfMonth) return null;
  return date.getUTCDay() * MINUTES_PER_DAY + hour * 60 + minute;
}

function localDateWeekday(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dayOfMonth) return null;
  return date.getUTCDay();
}

function calendarDate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.year) || !Number.isInteger(candidate.month) || !Number.isInteger(candidate.day)) return null;
  const iso = `${String(candidate.year).padStart(4, "0")}-${String(candidate.month).padStart(2, "0")}-${String(candidate.day).padStart(2, "0")}`;
  return localDateWeekday(iso) === null ? null : iso;
}

function datedOpeningPoint(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const date = calendarDate(candidate.date);
  const hour = candidate.hour;
  const minute = candidate.minute;
  if (!date || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if ((hour as number) < 0 || (hour as number) > 23 || (minute as number) < 0 || (minute as number) > 59) return null;
  return { date, minutes: (hour as number) * 60 + (minute as number) };
}

function calendarDayDelta(from: string, to: string) {
  const left = new Date(`${from}T00:00:00.000Z`).getTime();
  const right = new Date(`${to}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round((right - left) / 86_400_000);
}

/**
 * Uses Google's date-qualified `currentOpeningHours` only when the requested
 * calendar date is actually inside that payload. Returning `null` tells the
 * caller to fall back to a typical weekly schedule as an estimate.
 */
export function googleCurrentOpeningWindowsForDate(
  input: GoogleCurrentOpeningEvaluationInput,
  date: string,
): LocalOpeningWindow[] | null {
  if (input.businessStatus === "CLOSED_PERMANENTLY" || input.businessStatus === "CLOSED_TEMPORARILY") return [];
  if (input.businessStatus && input.businessStatus !== "OPERATIONAL") return null;
  if (localDateWeekday(date) === null || !Array.isArray(input.currentOpeningPeriods)) return null;

  const specialDateCovered = Array.isArray(input.currentSpecialDays) && input.currentSpecialDays.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return calendarDate((entry as Record<string, unknown>).date) === date;
  });
  let dateCovered = specialDateCovered;
  const windows: LocalOpeningWindow[] = [];
  for (const rawPeriod of input.currentOpeningPeriods) {
    if (!rawPeriod || typeof rawPeriod !== "object") continue;
    const period = rawPeriod as Record<string, unknown>;
    const open = datedOpeningPoint(period.open);
    if (!open) continue;
    const close = datedOpeningPoint(period.close);
    if (!close) {
      if (open.date === date && open.minutes === 0) {
        dateCovered = true;
        windows.push({ openMinutes: 0, closeMinutes: MINUTES_PER_DAY });
      }
      continue;
    }
    const openDelta = calendarDayDelta(date, open.date);
    const closeDelta = calendarDayDelta(date, close.date);
    if (openDelta === null || closeDelta === null) continue;
    const start = openDelta * MINUTES_PER_DAY + open.minutes;
    const finish = closeDelta * MINUTES_PER_DAY + close.minutes;
    if (start < MINUTES_PER_DAY && finish > 0) dateCovered = true;
    const overlapStart = Math.max(0, start);
    const overlapEnd = Math.min(MINUTES_PER_DAY, finish);
    if (overlapStart < overlapEnd) windows.push({ openMinutes: overlapStart, closeMinutes: overlapEnd });
  }
  if (!dateCovered) return null;
  return windows
    .sort((left, right) => left.openMinutes - right.openMinutes)
    .filter((window, index, values) => index === 0
      || window.openMinutes !== values[index - 1].openMinutes
      || window.closeMinutes !== values[index - 1].closeMinutes);
}

/**
 * Returns Google-verified opening windows for one place-local calendar day.
 * `null` means the schedule is missing or invalid; an empty array means the
 * place is explicitly unavailable that day.
 */
export function googleOpeningWindowsForDate(
  input: GoogleOpeningEvaluationInput,
  date: string,
): LocalOpeningWindow[] | null {
  if (input.businessStatus === "CLOSED_PERMANENTLY" || input.businessStatus === "CLOSED_TEMPORARILY") return [];
  if (input.businessStatus && input.businessStatus !== "OPERATIONAL") return null;
  const weekday = localDateWeekday(date);
  if (weekday === null || !Array.isArray(input.regularOpeningPeriods)) return null;
  if (input.regularOpeningPeriods.length === 0) return [];

  const targetStart = weekday * MINUTES_PER_DAY;
  const targetEnd = targetStart + MINUTES_PER_DAY;
  const windows: LocalOpeningWindow[] = [];
  for (const rawPeriod of input.regularOpeningPeriods) {
    if (!rawPeriod || typeof rawPeriod !== "object") return null;
    const period = rawPeriod as Record<string, unknown>;
    const open = openingPoint(period.open);
    if (!open) return null;
    if (period.close === undefined || period.close === null) {
      if (open.day === 0 && open.hour === 0 && open.minute === 0 && input.regularOpeningPeriods.length === 1) {
        return [{ openMinutes: 0, closeMinutes: MINUTES_PER_DAY }];
      }
      return null;
    }
    const close = openingPoint(period.close);
    if (!close || minuteOfWeek(open) === minuteOfWeek(close)) return null;
    const rawOpen = minuteOfWeek(open);
    const rawClose = minuteOfWeek(close) <= rawOpen ? minuteOfWeek(close) + MINUTES_PER_WEEK : minuteOfWeek(close);
    for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
      const shiftedOpen = rawOpen + shift;
      const shiftedClose = rawClose + shift;
      const overlapStart = Math.max(targetStart, shiftedOpen);
      const overlapEnd = Math.min(targetEnd, shiftedClose);
      if (overlapStart < overlapEnd) {
        windows.push({ openMinutes: overlapStart - targetStart, closeMinutes: overlapEnd - targetStart });
      }
    }
  }
  return windows
    .sort((left, right) => left.openMinutes - right.openMinutes)
    .filter((window, index, values) => index === 0
      || window.openMinutes !== values[index - 1].openMinutes
      || window.closeMinutes !== values[index - 1].closeMinutes);
}

function insideWeeklyInterval(target: number, open: number, close: number) {
  const normalizedClose = close <= open ? close + MINUTES_PER_WEEK : close;
  return (target >= open && target < normalizedClose)
    || (target + MINUTES_PER_WEEK >= open && target + MINUTES_PER_WEEK < normalizedClose);
}

/**
 * Evaluates Google's structured weekly periods at a place-local calendar time.
 * Weekday descriptions are deliberately not parsed because their text is localized.
 */
export function evaluateGoogleOpeningAt(
  input: GoogleOpeningEvaluationInput,
  planned: PlannedLocalDateTime,
): GoogleOpeningEvaluation {
  if (input.businessStatus === "CLOSED_PERMANENTLY") {
    return { status: "closed", reason: "closed_permanently" };
  }
  if (input.businessStatus === "CLOSED_TEMPORARILY") {
    return { status: "closed", reason: "closed_temporarily" };
  }
  if (input.businessStatus && input.businessStatus !== "OPERATIONAL") {
    return { status: "unknown", reason: "unknown_business_status" };
  }

  const target = plannedMinuteOfWeek(planned);
  if (target === null) return { status: "unknown", reason: "invalid_local_datetime" };
  if (!Array.isArray(input.regularOpeningPeriods)) {
    return { status: "unknown", reason: "missing_schedule" };
  }
  if (input.regularOpeningPeriods.length === 0) {
    return { status: "closed", reason: "no_regular_open_periods" };
  }

  let hasInvalidPeriod = false;
  for (const rawPeriod of input.regularOpeningPeriods) {
    if (!rawPeriod || typeof rawPeriod !== "object") {
      hasInvalidPeriod = true;
      continue;
    }
    const period = rawPeriod as Record<string, unknown>;
    const open = openingPoint(period.open);
    if (!open) {
      hasInvalidPeriod = true;
      continue;
    }
    if (period.close === undefined || period.close === null) {
      // This is the canonical representation documented by Google for 24/7.
      if (open.day === 0 && open.hour === 0 && open.minute === 0 && input.regularOpeningPeriods.length === 1) {
        return { status: "open", reason: "always_open" };
      }
      hasInvalidPeriod = true;
      continue;
    }
    const close = openingPoint(period.close);
    if (!close || minuteOfWeek(open) === minuteOfWeek(close)) {
      hasInvalidPeriod = true;
      continue;
    }
    if (insideWeeklyInterval(target, minuteOfWeek(open), minuteOfWeek(close))) {
      return { status: "open", reason: "within_regular_period" };
    }
  }

  return hasInvalidPeriod
    ? { status: "unknown", reason: "invalid_schedule" }
    : { status: "closed", reason: "outside_regular_periods" };
}
