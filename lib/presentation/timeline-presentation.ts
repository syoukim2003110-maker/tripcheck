// Timeline presentation builders (refactor spec v2.1 sections 4 and 6):
// every user-facing decision the day timeline makes - labels, flags, slot
// placement, transit boarding lines - as pure, unit-testable functions.
import type { BuiltTripPlan, FoodRecommendationSlot } from "../trip-builder.ts";
import type { TransportMode, TravelPreference } from "../time-feasibility.ts";
import type { EvidenceStatus } from "../feasibility-result.ts";
import type { DayPresentation } from "../day-presentation.ts";
import { clockToMinutes, type TransitLegBoarding } from "../planner-app-state.ts";
import { formatDuration } from "./trip-presentation.ts";
import { ui, type PlannerLocale } from "./planner-copy.ts";

type BuiltPlanDay = BuiltTripPlan["days"][number];
type BuiltPlanStop = BuiltPlanDay["stops"][number];

/** Localized transport-mode label honoring the car travel preference. An
 * unknown mode falls back to the preference's default vehicle. */
export function transportModeLabel(mode: TransportMode | null, travelPreference: TravelPreference, locale: PlannerLocale) {
  if (mode === "taxi" && travelPreference === "car") return ui[locale].moveCar;
  if (mode) return ui[locale].move[mode];
  return travelPreference === "car" ? ui[locale].moveCar : ui[locale].move.transit;
}

/** Day-tab density copy: empty / easy / N stops. */
export function dayTabDensityLabel(stopCount: number, locale: PlannerLocale) {
  if (stopCount === 0) return locale === "ja" ? "予定なし" : "empty";
  if (stopCount <= 2) return locale === "ja" ? "ゆったり" : "easy";
  return locale === "ja" ? `${stopCount}か所` : `${stopCount} stops`;
}

export function dayTabTitle(index: number, locale: PlannerLocale) {
  return locale === "ja" ? `${index + 1}日目` : `Day ${index + 1}`;
}

/** Copy Deck plan.day.summary / TC-032: the day header carries exactly two
 * numbers — stop count and buffer — read from the DayPresentation single
 * source (ja 「4か所・余裕1時間30分」 / en "4 stops · 1h 30m buffer"). The
 * clock range and the remaining totals live in the day-settings disclosure.
 * A day without stops or without positive slack (fit unknown, or fully
 * packed) shows the count alone rather than claiming zero buffer. */
export function dayHeaderSummary(
  presentation: Pick<DayPresentation, "stopCount" | "slackMinutes">,
  locale: PlannerLocale,
) {
  const count = presentation.stopCount;
  const stops = locale === "ja" ? `${count}か所` : `${count} stop${count === 1 ? "" : "s"}`;
  if (count === 0 || presentation.slackMinutes <= 0) return stops;
  const buffer = formatDuration(presentation.slackMinutes, locale);
  return locale === "ja" ? `${stops}・余裕${buffer}` : `${stops} · ${buffer} buffer`;
}

/** Date + weekday heading for the active day, falling back to the day label. */
export function dayDateLabel(
  day: Pick<BuiltPlanDay, "date" | "label">,
  weekdayLabel: string | null,
  tripDateTouched: boolean,
  locale: PlannerLocale,
) {
  if (!tripDateTouched || !day.date) return day.label;
  return locale === "ja" ? `${day.date}（${weekdayLabel ?? ""}）` : `${day.date} (${weekdayLabel ?? ""})`;
}

export type DurationEvidenceStatus = EvidenceStatus;

/** The compact confidence marker. UI/UX v3.1 §2.1 keeps this one control away
 * — in the stop sheet's evidence disclosure — rather than on the timeline. */
export function durationSourceLabel(status: DurationEvidenceStatus, locale: PlannerLocale) {
  if (status === "user_provided") return locale === "ja" ? "指定" : "set";
  if (status === "verified") return locale === "ja" ? "確認" : "confirmed";
  return locale === "ja" ? "推定" : "estimated";
}

/**
 * How a stay length is stated on the timeline (UI/UX v3.1 §2.2).
 *
 * This replaces the 推定 / 確認 / 指定 badge that used to sit beside the
 * number. The badge is a confidence code, which is exactly the class of
 * internal signal the v3.1 handoff moves off the surface — but deleting it
 * on its own would leave an estimate reading as a measurement. So the
 * uncertainty moves into the noun: an estimate is 「滞在の目安」, and a length
 * the traveller set or the provider confirmed is plain 「滞在」.
 *
 * The two halves of that rule ship together or not at all. Dropping the badge
 * without the word turns every guess into a claim, which is the one thing this
 * product must not do.
 */
export function stayLine(minutes: number, status: DurationEvidenceStatus, locale: PlannerLocale) {
  const duration = formatDuration(minutes, locale);
  if (status === "user_provided" || status === "verified") {
    return locale === "ja" ? `滞在 ${duration}` : `Stay ${duration}`;
  }
  return locale === "ja" ? `滞在の目安 ${duration}` : `Stay about ${duration}`;
}

/** The sentence the evidence disclosure gives for where a stay length came
 * from. The timeline says the number; this says who decided it. */
export function stayBasisLine(status: DurationEvidenceStatus, locale: PlannerLocale) {
  if (status === "user_provided") {
    return locale === "ja" ? "滞在時間はあなたが指定した値です。" : "You set this stay length.";
  }
  if (status === "verified") {
    return locale === "ja" ? "滞在時間は確認できた値です。" : "This stay length is confirmed.";
  }
  return locale === "ja"
    ? "滞在時間はTripCheckの目安です。過ごし方に合わせて変えられます。"
    : "This stay length is a TripCheck estimate. Change it to match how you will spend the visit.";
}

/** Label on the one control that reveals demoted evidence (v3.1 §2, and the
 * handoff's own mobile reference: 「営業時間・根拠を見る ›」). */
export function evidenceDisclosureLabel(locale: PlannerLocale) {
  return locale === "ja" ? "営業時間・根拠を見る" : "Opening hours and evidence";
}

export type TimelineFillerKind = "lunch" | "dinner" | "micro" | undefined;

/** Label above a system-recommended (filler) stop row. */
export function fillerRowLabel(fillerKind: TimelineFillerKind, locale: PlannerLocale) {
  if (fillerKind === "lunch") return locale === "ja" ? "昼食のおすすめ" : "Lunch recommendation";
  if (fillerKind === "dinner") return locale === "ja" ? "夕食のおすすめ" : "Dinner recommendation";
  return locale === "ja" ? "おすすめ" : "Recommended";
}

export type ActivityFlag = { className: "is-booked" | "is-must"; label: string };

/** Priority-ordered status flags on a stop row: lateness beats the fixed
 * time, which beats the must badge; opening trouble is a second flag. */
export function activityFlags(
  builtStop: Pick<BuiltPlanStop, "reservationLateMinutes" | "fixedTime" | "priority" | "openingStatus">,
  locale: PlannerLocale,
): ActivityFlag[] {
  const text = ui[locale];
  const flags: ActivityFlag[] = [];
  if (builtStop.reservationLateMinutes > 0) flags.push({ className: "is-booked", label: text.lateShort(builtStop.reservationLateMinutes) });
  else if (builtStop.fixedTime) flags.push({ className: "is-booked", label: builtStop.fixedTime });
  else if (builtStop.priority === "must") flags.push({ className: "is-must", label: text.must });
  if (builtStop.openingStatus === "conflict") flags.push({ className: "is-booked", label: text.openingConflict });
  else if (builtStop.openingStatus === "closed_day") flags.push({ className: "is-booked", label: text.openingClosedDay });
  else if (builtStop.openingStatus === "last_entry_conflict") flags.push({ className: "is-booked", label: locale === "ja" ? "最終入場後" : "after last entry" });
  return flags;
}

/** Which meal slots render after a given stop index: the latest stop whose
 * arrival is not after the slot's display time hosts the row; slots without
 * a parseable time attach to the last stop. Sorted by time, lunch first. */
export function mealSlotsAfterStop(
  daySlots: readonly FoodRecommendationSlot[],
  dayStops: readonly Pick<BuiltPlanStop, "arrival">[],
  stopIndex: number,
) {
  return daySlots
    .filter((slot) => {
      const slotMinutes = clockToMinutes(slot.displayTime);
      if (slotMinutes === null) return stopIndex === dayStops.length - 1;
      let insertAfter = 0;
      dayStops.forEach((candidate, index) => {
        const arrival = clockToMinutes(candidate.arrival);
        if (arrival !== null && arrival <= slotMinutes) insertAfter = index;
      });
      return insertAfter === stopIndex;
    })
    .sort((left, right) => (
      (clockToMinutes(left.displayTime) ?? 0) - (clockToMinutes(right.displayTime) ?? 0)
      || (left.kind === right.kind ? 0 : left.kind === "lunch" ? -1 : 1)
    ));
}

/** One "board this train/bus" line under a transit leg, or null without
 * usable steps. Pure text assembly from prefetched transit evidence. */
export function transitBoardingText(boarding: TransitLegBoarding | undefined, locale: PlannerLocale) {
  const steps = boarding?.steps;
  if (!boarding || !steps?.length) return null;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const lineLabel = [first.shortName ?? first.lineName, first.headsign
    ? locale === "ja" ? `${first.headsign}行き` : `toward ${first.headsign}`
    : null].filter(Boolean).join(locale === "ja" ? "・" : " ");
  const extra = steps.length - 1;
  const walkTo = boarding.walkToStopMinutes;
  const walkFrom = boarding.walkFromStopMinutes;
  const parts: string[] = [];
  if (locale === "ja") {
    if (walkTo !== null && walkTo > 0 && first.departureStop) parts.push(`徒歩約${walkTo}分 →`);
    if (first.departureStop) parts.push(`${first.departureStop} ${first.departureTime ? `${first.departureTime}発` : ""}`.trim());
    parts.push(first.departureStop ? `${lineLabel}` : `${lineLabel}${first.departureTime ? ` · ${first.departureTime}発` : ""}`);
    if (extra > 0) parts.push(`乗継ぎ${extra}本`);
    if (last.arrivalStop) parts.push(`→ ${last.arrivalStop}${extra === 0 && first.stopCount ? `(${first.stopCount}駅)` : ""}`);
    if (walkFrom !== null && walkFrom > 0 && last.arrivalStop) parts.push(`→ 徒歩約${walkFrom}分`);
  } else {
    if (walkTo !== null && walkTo > 0 && first.departureStop) parts.push(`~${walkTo} min walk →`);
    if (first.departureStop) parts.push(`${first.departureStop}${first.departureTime ? ` dep ${first.departureTime}` : ""}`);
    parts.push(first.departureStop ? lineLabel : `${lineLabel}${first.departureTime ? ` · dep ${first.departureTime}` : ""}`);
    if (extra > 0) parts.push(`+${extra} connection${extra === 1 ? "" : "s"}`);
    if (last.arrivalStop) parts.push(`→ ${last.arrivalStop}${extra === 0 && first.stopCount ? ` (${first.stopCount} stops)` : ""}`);
    if (walkFrom !== null && walkFrom > 0 && last.arrivalStop) parts.push(`→ ~${walkFrom} min walk`);
  }
  return parts.join(" ");
}
