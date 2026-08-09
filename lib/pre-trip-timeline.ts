import type { EntryAuthority, PassportRule } from "./destinations.ts";

/*
 * The dated half of "before you go": entry authorisations and passport
 * validity turned into concrete do-by dates computed from the trip itself.
 * Generic advice ("get an ESTA at some point") is exactly what travellers
 * already ignore; a date, a fee and an official link is what stops the
 * check-in-counter surprise.
 */

export type PreTripUrgency = "overdue" | "due_soon" | "scheduled" | "info";

export type PreTripItem = {
  id: string;
  /** Do-by day (YYYY-MM-DD); null when the task has no calendar deadline. */
  dueDate: string | null;
  /** Earliest day the task CAN be done, for windowed arrival cards. */
  opensDate?: string;
  urgency: PreTripUrgency;
  label: { en: string; ja: string };
  detail: { en: string; ja: string };
  url: string | null;
};

export type PreTripTimelineInput = {
  /** First trip day, YYYY-MM-DD; null disables date math (items go info). */
  tripStartDate: string | null;
  /** Last trip day; used by passport rules measured from departure. */
  tripEndDate: string | null;
  authority: EntryAuthority | null;
  passportRule: PassportRule | null;
  /** User-entered passport expiry (YYYY-MM-DD); stays on the device. */
  passportExpiry: string | null;
  now?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 7;

function calendarDateMs(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(ms);
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return ms;
}

function isoDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Month arithmetic with end-of-month clamping (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsUtc(ms: number, months: number) {
  const date = new Date(ms);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

function deadlineUrgency(dueMs: number, todayMs: number): PreTripUrgency {
  if (todayMs > dueMs) return "overdue";
  if (dueMs - todayMs <= DUE_SOON_DAYS * DAY_MS) return "due_soon";
  return "scheduled";
}

function authorityItem(
  authority: EntryAuthority,
  startMs: number | null,
  todayMs: number,
): PreTripItem {
  const base = {
    id: `authority-${authority.name}`,
    url: authority.officialUrl,
    detail: authority.summary,
  };
  if (authority.status === "not_yet") {
    return {
      ...base,
      dueDate: null,
      urgency: "info",
      label: {
        en: `${authority.name}: not required yet — re-check before departure`,
        ja: `${authority.name}：現時点では不要 — 出発前に最新状況を確認`,
      },
    };
  }
  if (authority.status === "waived") {
    const validThroughMs = calendarDateMs(authority.statusValidUntil ?? null);
    const relevantDateMs = startMs ?? todayMs;
    if (validThroughMs !== null && relevantDateMs > validThroughMs) {
      return {
        ...base,
        dueDate: null,
        urgency: "info",
        label: {
          en: `${authority.name}: the temporary waiver does not cover this trip — re-check the official requirement`,
          ja: `${authority.name}：一時免除の期間外です — 公式サイトで必要条件を再確認`,
        },
      };
    }
    return {
      ...base,
      dueDate: null,
      urgency: "info",
      label: {
        en: `${authority.name}: currently waived for Japanese passports`,
        ja: `${authority.name}：日本のパスポートは現在免除`,
      },
    };
  }
  if (startMs === null) {
    return {
      ...base,
      dueDate: null,
      urgency: "info",
      label: {
        en: `${authority.name}: required before travel`,
        ja: `${authority.name}：渡航前に取得が必要`,
      },
    };
  }
  if (authority.opensDaysBefore !== null) {
    // Windowed arrival cards: can only be filed close to arrival, due by the
    // arrival day itself. Before the window opens the item is a calendar note,
    // inside the window it is a to-do now.
    const opensMs = startMs - authority.opensDaysBefore * DAY_MS;
    const urgency: PreTripUrgency = todayMs > startMs ? "overdue" : todayMs >= opensMs ? "due_soon" : "scheduled";
    return {
      ...base,
      dueDate: isoDate(startMs),
      opensDate: isoDate(opensMs),
      urgency,
      label: {
        en: `${authority.name}: submit between ${isoDate(opensMs)} and arrival`,
        ja: `${authority.name}：${isoDate(opensMs)}から到着日までに提出`,
      },
    };
  }
  const dueMs = startMs - authority.deadlineDaysBefore * DAY_MS;
  return {
    ...base,
    dueDate: isoDate(dueMs),
    urgency: deadlineUrgency(dueMs, todayMs),
    label: {
      en: `${authority.name}: apply by ${isoDate(dueMs)}`,
      ja: `${authority.name}：${isoDate(dueMs)}までに申請`,
    },
  };
}

function passportItem(
  rule: PassportRule,
  startMs: number | null,
  endMs: number | null,
  expiry: string | null,
): PreTripItem {
  const base = { id: "passport", url: rule.sourceUrl, detail: rule.summary };
  const expiryMs = calendarDateMs(expiry);
  const referenceMs = rule.referenceDate === "entry" ? startMs : endMs;
  if (expiryMs === null || referenceMs === null) {
    return {
      ...base,
      dueDate: null,
      urgency: "info",
      label: {
        en: "Passport validity: check the remaining months, not just the expiry",
        ja: "パスポート残存期間：期限内かではなく「残り何ヶ月か」を確認",
      },
    };
  }
  const requiredMs = addMonthsUtc(referenceMs, rule.monthsBeyond);
  if (expiryMs < requiredMs) {
    return {
      ...base,
      dueDate: null,
      urgency: "overdue",
      label: {
        en: `Passport validity is NOT enough for this trip (needs ${isoDate(requiredMs)}, expires ${isoDate(expiryMs)}) — renew before booking`,
        ja: `パスポートの残存期間がこの旅行に不足（${isoDate(requiredMs)}まで必要・期限${isoDate(expiryMs)}）— 先に更新を`,
      },
    };
  }
  if (rule.additionalCheck) {
    return {
      ...base,
      dueDate: null,
      urgency: "info",
      label: {
        en: `Passport expiry requirement appears met (expires ${isoDate(expiryMs)}), but ${rule.additionalCheck.en} remains unchecked`,
        ja: `パスポートの有効期限要件は満たしているようです（期限${isoDate(expiryMs)}）— ${rule.additionalCheck.ja}は未確認`,
      },
    };
  }
  return {
    ...base,
    dueDate: null,
    urgency: "info",
    label: {
      en: `Passport validity OK for this trip (expires ${isoDate(expiryMs)})`,
      ja: `パスポート残存期間はこの旅行にはOK（期限${isoDate(expiryMs)}）`,
    },
  };
}

/**
 * Orders the destination's paperwork by how loudly it should be shouting:
 * blockers first, then dated to-dos by date, notes last.
 */
export function buildPreTripTimeline(input: PreTripTimelineInput): PreTripItem[] {
  const now = input.now ?? new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = calendarDateMs(input.tripStartDate);
  const endMs = calendarDateMs(input.tripEndDate) ?? startMs;
  const items: PreTripItem[] = [];
  if (input.authority) items.push(authorityItem(input.authority, startMs, todayMs));
  if (input.passportRule) items.push(passportItem(input.passportRule, startMs, endMs, input.passportExpiry));
  const rank: Record<PreTripUrgency, number> = { overdue: 0, due_soon: 1, scheduled: 2, info: 3 };
  return items.sort((left, right) =>
    rank[left.urgency] - rank[right.urgency]
    || (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999"));
}
