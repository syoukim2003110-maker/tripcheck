"use client";

// Print/PDF sheet (spec v2.1 summary/): verdict, conflicts, assumptions,
// conditions, omission-honesty list and the per-day schedule with evidence
// provenance. Render-only - every fact arrives via props.
import type { BuiltTripPlan } from "../../../../lib/trip-builder.ts";
import type { FeasibilityResult } from "../../../../lib/feasibility-result.ts";
import type { TripWeatherDay } from "../../../../lib/weather.ts";
import type { TripHoliday } from "../../../../lib/holidays.ts";
import { buildDayPresentation } from "../../../../lib/day-presentation.ts";
import { coveragePublicCopy } from "../../../../lib/coverage-profile.ts";
import { P0_CORE_ONLY } from "../../../../lib/planner-app-state.ts";
import { resolvedStopAddress } from "../../../../lib/presentation/trip-presentation.ts";
import {
  assumptionCopy,
  attentionCopy,
  conflictCopy,
  legModeLabel,
  printTransferCopy,
  ui,
  type PlannerLocale,
} from "../../../../lib/presentation/planner-copy.ts";
import type { DurationEvidenceStatus } from "../../../../lib/presentation/timeline-presentation.ts";

type TripPrintSheetProps = {
  plan: BuiltTripPlan;
  locale: PlannerLocale;
  feasibilityResult: FeasibilityResult | null;
  resultStateCopy: { label: string; headline: string } | null;
  tripDateTouched: boolean;
  tripStartDate: string;
  arrivalAirport: string;
  arrivalTime: string;
  departureAirport: string;
  departureTime: string;
  transferBufferMinutes: number;
  activeEssentials: { plug: string; emergency: { ja: string; en: string }; tipping: { ja: string; en: string } } | null;
  beforeYouGo: { reservations: ReadonlyArray<{ name: string; time?: string | null }>; watchlist: readonly string[] } | null;
  removedStops: ReadonlyArray<{ id: string; name: string }>;
  tripFit: { days: ReadonlyArray<Parameters<typeof buildDayPresentation>[1]> } | null;
  weatherByDay: Readonly<Record<number, TripWeatherDay>>;
  holidaysByDate: Readonly<Record<string, TripHoliday>>;
  durationEvidenceByStopId: Readonly<Record<string, DurationEvidenceStatus>>;
  regionalCoverage: Parameters<typeof coveragePublicCopy>[0] | null;
};

export default function TripPrintSheet({
  plan,
  locale,
  feasibilityResult,
  resultStateCopy,
  tripDateTouched,
  tripStartDate,
  arrivalAirport,
  arrivalTime,
  departureAirport,
  departureTime,
  transferBufferMinutes,
  activeEssentials,
  beforeYouGo,
  removedStops,
  tripFit,
  weatherByDay,
  holidaysByDate,
  durationEvidenceByStopId,
  regionalCoverage,
}: TripPrintSheetProps) {
  const text = ui[locale];
  return (
    <section className="planner-print-sheet">
      <header className="planner-print-header">
        <p>
          TripCheck · {tripDateTouched
            ? tripStartDate
            : locale === "ja" ? "日付未定" : "Date not decided"}
          {locale === "ja" ? ` · ${plan.requestedDays}日間` : ` · ${plan.requestedDays} days`}
        </p>
        <h1>{resultStateCopy?.headline ?? plan.days[0]?.theme ?? "Trip plan"}</h1>
        {feasibilityResult ? (
          <div className="planner-print-verdict">
            <b>{resultStateCopy?.label}</b>
            <span>
              {locale === "ja"
                ? `重要情報: 確認済み ${feasibilityResult.criticalFacts.verified} / 推定 ${feasibilityResult.criticalFacts.estimated} / 未確認 ${feasibilityResult.criticalFacts.unknown}`
                : `Critical facts: ${feasibilityResult.criticalFacts.verified} confirmed / ${feasibilityResult.criticalFacts.estimated} estimated / ${feasibilityResult.criticalFacts.unknown} unknown`}
            </span>
            <span>
              {feasibilityResult.minimumDays === null
                ? locale === "ja" ? "最短日数は未確定です。" : "Minimum days are not yet determined."
                : locale === "ja" ? `同じ条件での最短日数: ${feasibilityResult.minimumDays}日` : `Minimum under the same conditions: ${feasibilityResult.minimumDays} day${feasibilityResult.minimumDays === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : null}
      </header>
      {feasibilityResult?.conflicts.length ? (
        <section className="planner-print-alert is-conflict">
          <h2>{locale === "ja" ? "変更が必要な条件" : "Conflicts that need a change"}</h2>
          <ul>{feasibilityResult.conflicts.map((conflict, index) => <li key={`${conflict.code}-${index}`}>{conflictCopy(conflict, locale)}</li>)}</ul>
        </section>
      ) : feasibilityResult?.primaryAttention ? (
        <section className="planner-print-alert">
          <h2>{locale === "ja" ? "最大の注意点" : "Biggest attention"}</h2>
          <p>{attentionCopy(feasibilityResult.primaryAttention, locale)}</p>
        </section>
      ) : null}
      {feasibilityResult ? (
        <section className="planner-print-assumptions">
          <h2>{locale === "ja" ? "この判定の前提" : "Assumptions behind this verdict"}</h2>
          {feasibilityResult.assumptions.length ? (
            <ul>{feasibilityResult.assumptions.map((assumption) => <li key={assumption.code}>{assumptionCopy(assumption, locale)}</li>)}</ul>
          ) : <p>{locale === "ja" ? "重要な前提はすべて確認済みです。" : "All critical assumptions are confirmed."}</p>}
        </section>
      ) : null}
      <section className="planner-print-conditions">
        <h2>{locale === "ja" ? "旅の条件" : "Trip conditions"}</h2>
        <dl>
          <div><dt>{locale === "ja" ? "拠点" : "Base"}</dt><dd>{plan.selectedBase ? `${plan.selectedBase.name} · ${resolvedStopAddress(plan.selectedBase)}` : locale === "ja" ? "未指定" : "Not specified"}</dd></div>
          <div><dt>{locale === "ja" ? "到着" : "Arrival"}</dt><dd>{arrivalAirport === "none" ? (locale === "ja" ? "指定なし" : "Not specified") : `${arrivalAirport} · ${arrivalTime || "—"}`}</dd></div>
          <div><dt>{locale === "ja" ? "出発" : "Departure"}</dt><dd>{departureAirport === "none" ? (locale === "ja" ? "指定なし" : "Not specified") : `${departureAirport} · ${departureTime || "—"}`}</dd></div>
          <div><dt>{locale === "ja" ? "移動余白" : "Leg buffer"}</dt><dd>{transferBufferMinutes}{locale === "ja" ? "分" : " min"}</dd></div>
          <div><dt>{locale === "ja" ? "徒歩上限" : "Walking limit"}</dt><dd>{plan.mobilityPolicy.maxWalkingMinutesPerLeg}{locale === "ja" ? "分/区間" : " min/leg"}</dd></div>
          <div><dt>{locale === "ja" ? "乗換上限" : "Transfer limit"}</dt><dd>{plan.mobilityPolicy.maxTransfersPerLeg}{locale === "ja" ? "回/区間" : "/leg"}</dd></div>
        </dl>
      </section>
      {!P0_CORE_ONLY && activeEssentials ? (
        <p className="planner-print-essentials">
          {text.essentialsPlug}: {activeEssentials.plug} · {text.essentialsEmergency}: {locale === "ja" ? activeEssentials.emergency.ja : activeEssentials.emergency.en}
          {" · "}{locale === "ja" ? activeEssentials.tipping.ja : activeEssentials.tipping.en}
        </p>
      ) : null}
      {beforeYouGo && (beforeYouGo.reservations.length > 0 || beforeYouGo.watchlist.length > 0) ? (
        <p className="planner-print-essentials">
          {beforeYouGo.reservations.map((entry) => `✓ ${entry.name}${entry.time ? ` ${entry.time}` : ""}`).join(" · ")}
          {beforeYouGo.reservations.length > 0 && beforeYouGo.watchlist.length > 0 ? " · " : ""}
          {beforeYouGo.watchlist.map((name) => `! ${name}`).join(" · ")}
        </p>
      ) : null}
      {plan.unknownEntries.length > 0 || plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 || removedStops.length > 0 ? (
        <section className="planner-print-alert planner-print-omissions">
          <h2>{locale === "ja" ? "旅程に入っていない場所" : "Places not in the schedule"}</h2>
          <ul>
            {plan.deferredUnavailableStops.map((stop) => (
              <li key={`unavailable-${stop.id}`}><b>{stop.name}</b><small>{locale === "ja" ? "休業または営業時間が合いません" : "Closed or outside usable opening hours"}</small></li>
            ))}
            {plan.deferredOptionalStops.map((stop) => (
              <li key={`optional-${stop.id}`}><b>{stop.name}</b><small>{locale === "ja" ? "選んだ日数・ペースでは収まりません" : "Does not fit the selected days and pace"}</small></li>
            ))}
            {plan.unknownEntries.map((entry, index) => (
              <li key={`unknown-${index}-${entry}`}><b>{entry}</b><small>{locale === "ja" ? "場所を解決できないため未判定です" : "Unresolved, so it was not evaluated"}</small></li>
            ))}
            {removedStops.map((entry) => (
              <li key={`removed-${entry.id}`}><b>{entry.name}</b><small>{locale === "ja" ? "旅行者が旅程から外しました" : "Removed from the plan by the traveller"}</small></li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan.days.map((printDay, printIndex) => (
        <article key={printDay.label}>
          <h2>
            {printIndex + 1} · {tripDateTouched ? printDay.date ?? printDay.label : printDay.label} · {(() => {
              const printPresentation = buildDayPresentation(printDay, tripFit?.days[printIndex] ?? null, { dayIndex: printIndex });
              return printPresentation.consistency === "invalid"
                ? (locale === "ja" ? `時刻確認中（${printPresentation.diagnosticId}）` : `times withheld (${printPresentation.diagnosticId})`)
                : `${printPresentation.startClock}—${printPresentation.endClock}`;
            })()}
            {printDay.deadline ? ` · ${locale === "ja" ? "締切" : "cutoff"} ${printDay.deadline}${printDay.deadlineOverrunMinutes > 0 ? ` (+${printDay.deadlineOverrunMinutes}${locale === "ja" ? "分" : " min"})` : ""}` : ""}
            {weatherByDay[printIndex]
              ? ` · ${weatherByDay[printIndex].temperatureMaxC}°/${weatherByDay[printIndex].temperatureMinC}°${weatherByDay[printIndex].precipitationPercent !== null ? ` ${text.precipitation(weatherByDay[printIndex].precipitationPercent!)}` : ""}`
              : ""}
            {tripDateTouched && printDay.date && holidaysByDate[printDay.date]
              ? ` · ${text.holidayBadge} ${holidaysByDate[printDay.date].localName}`
              : ""}
          </h2>
          <ol>
            {printDay.stops.map((built, stopIndex) => {
              const leg = printDay.legs[stopIndex];
              const durationStatus = durationEvidenceByStopId[built.stop.id] ?? "estimated";
              const durationSource = durationStatus === "user_provided"
                ? (locale === "ja" ? "ユーザー指定" : "user-set")
                : durationStatus === "verified"
                  ? (locale === "ja" ? "確認済み" : "confirmed")
                  : (locale === "ja" ? "推定" : "estimated");
              return (
                <li key={`${built.stop.id}-${stopIndex}`}>
                  <b>{built.arrival}–{built.departure}</b> {built.stop.name}
                  <small> · {resolvedStopAddress(built.stop)} · {built.stop.planningDurationMinutes}{locale === "ja" ? "分滞在" : " min stay"} ({durationSource}){built.isReservation ? ` · ${text.printBooked}${built.fixedTime ? ` ${built.fixedTime}` : ""}` : built.fixedTime ? ` · ${locale === "ja" ? "固定" : "fixed"} ${built.fixedTime}` : ""}</small>
                  {built.reservationLateMinutes > 0 ? <strong>{locale === "ja" ? `予約に${built.reservationLateMinutes}分遅れ` : `${built.reservationLateMinutes} min late for booking`}</strong> : null}
                  {built.openingStatus === "conflict" ? <strong>{text.openingConflict}</strong> : null}
                  {built.openingStatus === "closed_day" ? <strong>{text.openingClosedDay}</strong> : null}
                  {built.openingStatus === "last_entry_conflict" ? <strong>{locale === "ja" ? "最終入場に間に合いません" : "Misses last entry"}</strong> : null}
                  {built.openingStatus === "unknown" ? <strong className="is-unknown">{locale === "ja" ? "営業時間は未確認" : "Opening hours unverified"}</strong> : null}
                  {leg ? <em> ↓ {leg.comparison.recommended.minutes}{locale === "ja" ? "分" : " min"} ({legModeLabel(leg.comparison.recommended.mode, locale)}){leg.comparison.recommended.source === "live" ? ` · ${locale === "ja" ? "取得済み" : "retrieved"}` : ` · ${locale === "ja" ? "推定" : "estimated"}`}{printTransferCopy(leg, plan.mobilityPolicy.maxTransfersPerLeg, locale)}{leg.walkingLimitExceededMinutes > 0 ? ` · ${locale === "ja" ? `徒歩上限+${leg.walkingLimitExceededMinutes}分` : `walking limit +${leg.walkingLimitExceededMinutes} min`}` : ""}</em> : null}
                </li>
              );
            })}
          </ol>
        </article>
      ))}
      {regionalCoverage ? (
        <section className="planner-print-coverage">
          <h2>{locale === "ja" ? "地域別の対応品質" : "Regional coverage"}</h2>
          <p>{regionalCoverage.label[locale]} · Routes {regionalCoverage.grades.routes} · Places {regionalCoverage.grades.poi} · Hours {regionalCoverage.grades.hours} · Transit {regionalCoverage.grades.transit}</p>
          <p>{coveragePublicCopy(regionalCoverage, locale)}</p>
        </section>
      ) : null}
      <p className="planner-print-essentials">{text.printFooter}</p>
    </section>
  );
}
