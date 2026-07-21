const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export type GoogleRegularOpeningPoint = {
  day: number;
  hour: number;
  minute: number;
};

export type GoogleRegularOpeningPeriod = {
  open: GoogleRegularOpeningPoint;
  close?: GoogleRegularOpeningPoint;
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

/**
 * Returns Google-verified opening windows for one Japan-local calendar day.
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
 * Evaluates Google's structured weekly periods at a Japan-local calendar time.
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
