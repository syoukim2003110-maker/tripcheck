"use client";

// The stop inspector aside (spec v2.1 inspector/): close/expand controls,
// header and meta badges, the stay-minutes and last-entry edits, the day
// move group and remove button, the Google intel card, the check-place
// actions row and the fresh public-voices card with its evidence sources.
// Emits events only — plan edits and AI checks stay with the parent.
import type { RefObject, SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import type { BuiltTripPlan } from "../../../../lib/trip-builder.ts";
import type { RouteStop } from "../../../../lib/route-optimizer.ts";
import { googleCurrentOpeningWindowsForDate, googleOpeningWindowsForDate } from "../../../../lib/google-opening-hours.ts";
import {
  P0_CORE_ONLY,
  type FreshState,
  type IntelligenceState,
  type SourcePreviewState,
} from "../../../../lib/planner-app-state.ts";
import {
  formatCheckedAt,
  formatWindowClock,
  googleMapsSearchUrl,
  paymentLabel,
} from "../../../../lib/presentation/trip-presentation.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type BuiltPlanStop = BuiltTripPlan["days"][number]["stops"][number];

type StopInspectorProps = {
  locale: PlannerLocale;
  selectedBuiltStop: BuiltPlanStop;
  selectedStopIndex: number;
  day: BuiltTripPlan["days"][number] | null;
  plan: BuiltTripPlan | null;
  activeDay: number;
  userStayMinutes: Record<string, number>;
  lastEntryTimes: Record<string, string>;
  selectedIntel: IntelligenceState | undefined;
  selectedFresh: FreshState | undefined;
  selectedCheckLoading: boolean;
  selectedCheckReady: boolean;
  selectedCheckRetry: boolean;
  aiEnabled: boolean;
  sourcePreviews: Record<string, SourcePreviewState>;
  sheetExpanded: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToggleSheet: () => void;
  onCommitStayMinutes: (stopId: string, value: string) => void;
  onCommitLastEntry: (stopId: string, value: string) => void;
  onMoveStopToDay: (stopId: string, dayIndex: number) => void;
  onRemoveStop: (stop: RouteStop) => void;
  onCheckPlace: (stop: RouteStop) => void;
  onEnsureSourcePreviews: (urls: string[]) => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function StopInspector({
  locale,
  selectedBuiltStop,
  selectedStopIndex,
  day,
  plan,
  activeDay,
  userStayMinutes,
  lastEntryTimes,
  selectedIntel,
  selectedFresh,
  selectedCheckLoading,
  selectedCheckReady,
  selectedCheckRetry,
  aiEnabled,
  sourcePreviews,
  sheetExpanded,
  panelRef,
  onClose,
  onToggleSheet,
  onCommitStayMinutes,
  onCommitLastEntry,
  onMoveStopToDay,
  onRemoveStop,
  onCheckPlace,
  onEnsureSourcePreviews,
  onPhotoError,
}: StopInspectorProps) {
  const text = ui[locale];
  return (
    <aside
      aria-labelledby="planner-stop-inspector-title"
      className={`planner-inspector${sheetExpanded ? " is-sheet-full" : ""}`}
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
    >
      <button className="planner-inspector-close" onClick={onClose} type="button" aria-label={text.close}><Icon name="close" size={13} /></button><button aria-label={locale === "ja" ? (sheetExpanded ? "シートを縮小" : "シートを全画面に広げる") : (sheetExpanded ? "Collapse sheet" : "Expand sheet")} className="planner-inspector-expand" onClick={onToggleSheet} type="button">{sheetExpanded ? "▾" : "▴"}</button>
      <header className="planner-inspector-head">
        <span className="planner-inspector-num">{selectedStopIndex + 1}</span>
        <div>
          <h2 id="planner-stop-inspector-title">{selectedBuiltStop.stop.name}</h2>
          <p>{selectedBuiltStop.stop.area}</p>
        </div>
      </header>
      <div className="planner-inspector-meta">
        <span>{selectedBuiltStop.arrival}–{selectedBuiltStop.departure}</span>
        {selectedBuiltStop.fixedTime ? <span className="is-booked">{selectedBuiltStop.isReservation ? text.reservation : text.timePinned} {selectedBuiltStop.fixedTime}</span> : null}
        {selectedBuiltStop.reservationLateMinutes > 0 ? <span className="is-booked">{text.lateBy(selectedBuiltStop.reservationLateMinutes)}</span> : null}
        {selectedBuiltStop.priority === "must" ? <span className="is-must">{text.must}</span> : null}
        {selectedBuiltStop.priority === "optional" ? <span className="is-optional">{text.optional}</span> : null}
        {selectedBuiltStop.openingStatus === "verified_open" ? <span>{text.openingAdjusted}</span> : null}
        {selectedBuiltStop.openingStatus === "conflict" ? <span className="is-booked">{text.openingConflict}</span> : null}
        {selectedBuiltStop.openingStatus === "closed_day" ? <span className="is-booked">{text.openingClosedDay}</span> : null}
        {selectedBuiltStop.openingStatus === "last_entry_conflict" ? <span className="is-booked">{locale === "ja" ? "最終入場に間に合いません" : "Misses last entry"}</span> : null}
        {selectedBuiltStop.crowd ? (
          <span className="is-crowd">
            {text.crowd[selectedBuiltStop.crowd.level]}{selectedBuiltStop.crowd.isWeekend ? text.crowdWeekend : ""}{text.crowdForecast}
          </span>
        ) : null}
      </div>
      <label className="planner-stay-edit">
        <span>{text.stayLabel}</span>
        <select
          onChange={(event) => {
            const value = event.target.value;
            const stopId = selectedBuiltStop.stop.id;
            onCommitStayMinutes(stopId, value);
          }}
          value={String(userStayMinutes[selectedBuiltStop.stop.id] ?? "")}
        >
          <option value="">
            {userStayMinutes[selectedBuiltStop.stop.id] == null
              ? `${text.stayAuto} · ${text.minutes(selectedBuiltStop.stop.planningDurationMinutes)}`
              : text.stayAuto}
          </option>
          {[30, 45, 60, 90, 120, 150, 180, 240].map((minutes) => (
            <option key={minutes} value={minutes}>{text.minutes(minutes)}</option>
          ))}
        </select>
      </label>
      <label className="planner-stay-edit">
        <span>{locale === "ja" ? "最終入場（分かる場合）" : "Last entry (if known)"}</span>
        <input
          aria-describedby="planner-last-entry-note"
          onChange={(event) => {
            const value = event.target.value;
            const stopId = selectedBuiltStop.stop.id;
            onCommitLastEntry(stopId, value);
          }}
          type="time"
          value={lastEntryTimes[selectedBuiltStop.stop.id] ?? ""}
        />
        <small id="planner-last-entry-note">{locale === "ja" ? "閉館時刻とは別の入場締切です。入力した値はあなたが確認した条件として扱います。" : "This is the admission cutoff, not closing time. It is treated as a condition you supplied."}</small>
      </label>
      {plan && plan.days.length > 1 ? (
        <div className="planner-day-move" role="group" aria-label={text.moveDay}>
          <span>{text.moveDay}</span>
          <div>
            {plan.days.map((_, dayIndex) => (
              <button
                aria-pressed={dayIndex === activeDay}
                className={dayIndex === activeDay ? "is-active" : ""}
                key={dayIndex}
                onClick={() => onMoveStopToDay(selectedBuiltStop.stop.id, dayIndex)}
                title={text.previewDay(dayIndex + 1)}
                type="button"
              >
                {dayIndex + 1}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <button className="planner-remove-stop" onClick={() => onRemoveStop(selectedBuiltStop.stop)} type="button">
        <Icon name="close" size={11} />{text.removeStop}
      </button>
      {selectedIntel?.status === "loading" ? (
        <section className="planner-intel-card is-loading" aria-live="polite">
          <header><h3>{text.fieldEvidence}</h3></header>
          <p className="planner-fresh-status"><i aria-hidden="true" />{text.fieldChecking}</p>
        </section>
      ) : null}
      {selectedIntel?.status === "unavailable" ? <p className="planner-intel-unavailable" role="status">{text.fieldUnavailable}</p> : null}
      {selectedIntel?.status === "ready" && selectedIntel.result ? (() => {
        const intel = selectedIntel.result;
        const listedPayment = P0_CORE_ONLY ? null : paymentLabel(intel, locale);
        const currentDayWindows = day?.date
          ? googleCurrentOpeningWindowsForDate({
            businessStatus: intel.place.businessStatus,
            currentOpeningPeriods: intel.place.currentOpeningPeriods,
            currentSpecialDays: intel.place.currentSpecialDays,
          }, day.date)
          : null;
        const dayWindows = currentDayWindows ?? (day?.date
          ? googleOpeningWindowsForDate({
            businessStatus: intel.place.businessStatus,
            regularOpeningPeriods: intel.place.regularOpeningPeriods,
          }, day.date)
          : null);
        const dayHoursText = dayWindows && dayWindows.length > 0
          ? dayWindows.map((window) => `${formatWindowClock(window.openMinutes)}–${formatWindowClock(window.closeMinutes)}`).join(" / ")
          : null;
        return (
          <section className="planner-intel-card" aria-label={`${selectedBuiltStop.stop.name} · ${text.fieldEvidence}`}>
            <header>
              <h3>{text.fieldEvidence}</h3>
              <small>{intel.analyzedBy === "anthropic" ? text.aiAudited : text.rulesAudited}</small>
            </header>
            {!P0_CORE_ONLY && intel.place.photoName ? (
              <a className="planner-intel-hero" href={intel.place.googleMapsUrl} key={intel.place.photoName} rel="noreferrer" target="_blank">
                {/* Google place photos are proxied at request time and are not stored. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={intel.place.name} loading="lazy" onError={onPhotoError} src={`/api/place-photo?name=${encodeURIComponent(intel.place.photoName)}`} />
              </a>
            ) : null}
            {!P0_CORE_ONLY && intel.place.photoAttribution ? (
              <a className="planner-photo-credit" href={intel.place.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {intel.place.photoAttribution.name}</a>
            ) : null}
            <div className="planner-intel-facts">
              <span className={intel.place.openNow === false ? "is-warning" : ""}>
                {intel.place.openNow === true ? text.openNow : intel.place.openNow === false ? text.closedNow : text.hoursUnknown}
              </span>
              {dayWindows !== null ? (
                dayHoursText
                  ? <span>{text.dayHours(dayHoursText)}</span>
                  : <span className="is-warning">{text.dayClosed}</span>
              ) : null}
              {listedPayment ? <span className={intel.place.payment.cashOnly === true ? "is-warning" : ""}>{listedPayment}</span> : null}
              {intel.place.websiteUrl === null ? <span className="is-warning">{text.noWebsite}</span> : null}
              {!P0_CORE_ONLY && intel.place.rating !== null ? (
                <span>★ {intel.place.rating.toFixed(1)} · {intel.place.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span>
              ) : null}
            </div>
            <small className="planner-evidence-provenance">
              Google Places · {formatCheckedAt(intel.checkedAt, locale)} · {currentDayWindows !== null
                ? (locale === "ja" ? "指定日を含む現在の営業時間" : "current hours covering this date")
                : (locale === "ja" ? "通常週の営業時間（祝日・臨時変更は未確認）" : "regular weekly hours; holidays and exceptions unverified")}
            </small>
            {intel.place.address ? <p className="planner-intel-address">{intel.place.address}</p> : null}
            {!P0_CORE_ONLY ? <p className="planner-intel-summary">{intel.analysis.summary}</p> : null}
            {!P0_CORE_ONLY && intel.analysis.signals.length > 0 ? (
              <ul className="planner-intel-signals">
                {intel.analysis.signals.slice(0, 2).map((signal, signalIndex) => (
                  <li className={`is-${signal.severity}`} key={`${signal.kind}-${signalIndex}`}>
                    <i aria-hidden="true" />
                    <div><b>{signal.title}</b><p>{signal.detail}</p><small>{signal.evidence}</small></div>
                  </li>
                ))}
              </ul>
            ) : null}
            {!P0_CORE_ONLY && intel.reviews.length > 0 ? (
              <div className="planner-intel-reviews">
                <h4>{text.recentVoices}</h4>
                {intel.reviews.slice(0, 1).map((review, reviewIndex) => (
                  <blockquote key={`${review.authorName}-${reviewIndex}`}>
                    <p>{review.text}</p>
                    <footer>
                      <span>{review.rating !== null ? `★ ${review.rating}` : ""} {review.relativeTime}</span>
                      <a href={review.authorUri ?? review.googleMapsUri ?? intel.place.googleMapsUrl} rel="noreferrer" target="_blank">{review.authorName} ↗</a>
                    </footer>
                  </blockquote>
                ))}
              </div>
            ) : null}
            <div className="planner-intel-links">
              {!P0_CORE_ONLY ? <a href={intel.links.x} rel="noreferrer" target="_blank">{text.latestX} ↗</a> : null}
              {!P0_CORE_ONLY ? <a href={intel.links.instagram} rel="noreferrer" target="_blank">{text.instagram} ↗</a> : null}
              {intel.place.websiteUrl ? <a href={intel.place.websiteUrl} rel="noreferrer" target="_blank">{text.official} ↗</a> : null}
              <a href={intel.place.googleMapsUrl} rel="noreferrer" target="_blank">Google Maps ↗</a>
            </div>
          </section>
        );
      })() : null}

      <div className="planner-inspector-actions">
        {aiEnabled ? (
          <button
            className="planner-check-button"
            disabled={selectedCheckLoading || selectedCheckReady}
            onClick={() => onCheckPlace(selectedBuiltStop.stop)}
            type="button"
          >
            <i aria-hidden="true" />{selectedCheckLoading ? text.fieldChecking : selectedCheckReady ? text.fieldChecked : selectedCheckRetry ? text.fieldRetry : text.fieldCheck}
          </button>
        ) : null}
        <a href={googleMapsSearchUrl(selectedBuiltStop.stop)} rel="noreferrer" target="_blank">Google Maps ↗</a>
      </div>

      {selectedFresh?.status === "loading" ? (
        <section className="planner-fresh-card is-loading" aria-live="polite">
          <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
          <p className="planner-fresh-status"><i aria-hidden="true" />{text.freshLoading}</p>
        </section>
      ) : null}

      {selectedFresh?.status === "unavailable" ? (
        <section className="planner-fresh-card" aria-live="polite">
          <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
          <p className="planner-fresh-empty">{text.freshUnavailable}</p>
        </section>
      ) : null}

      {selectedFresh?.status === "paused" ? (
        <section className="planner-fresh-card">
          <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3></div></header>
          <p className="planner-fresh-empty">{text.freshPaused}</p>
        </section>
      ) : null}

      {selectedFresh?.status === "ready" && selectedFresh.result ? (() => {
        const fresh = selectedFresh.result;
        return (
          <details
            className="planner-evidence-sources"
            aria-label={`${selectedBuiltStop.stop.name} · ${text.freshHeading}`}
            key={selectedBuiltStop.stop.id}
            onToggle={(event) => {
              if ((event.target as HTMLDetailsElement).open) onEnsureSourcePreviews(fresh.findings.slice(0, 3).map((finding) => finding.url));
            }}
          >
            <summary>{text.publicSources} · {fresh.findings.length} <small>{formatCheckedAt(fresh.checkedAt, locale)}</small></summary>
            {fresh.findings.length > 0 ? (
              <div className="planner-fresh-list">
                {fresh.findings.slice(0, 3).map((finding) => (
                  <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                    <div>
                      <span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span>
                      <small>{finding.age ?? text.freshAgeUnknown}</small>
                    </div>
                    <b>{finding.title}</b>
                    <p>{finding.note}</p>
                    {sourcePreviews[finding.url]?.imageUrl ? <>
                      {/* Open Graph preview from the cited page itself; broken images fall back to the media badge. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" className="planner-fresh-thumb" loading="lazy" onError={onPhotoError} referrerPolicy="no-referrer" src={sourcePreviews[finding.url].imageUrl ?? undefined} />
                    </> : null}
                    <i aria-hidden="true">↗</i>
                  </a>
                ))}
              </div>
            ) : <p className="planner-fresh-empty">{text.freshEmpty}</p>}
          </details>
        );
      })() : null}
    </aside>
  );
}
