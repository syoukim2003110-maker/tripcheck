"use client";

// Result header (spec v2.1 summary/): mobile view toggle, verdict label,
// headline, the Copy Deck plan.stats totals line, issue-count chip and the
// actions menu (edit, verdict details, undo/redo, print, share). Emits
// events; history and dialogs live above.
import type { RefObject } from "react";
import Icon from "../../../PlannerIcons";
import { feasibilityStateIcon } from "../icon-maps";
import type { FeasibilityResult } from "../../../../lib/feasibility-result.ts";
import type { MobileResultView } from "../../../../lib/planner-app-state.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";
import { tripStatsLine } from "../../../../lib/presentation/trip-presentation.ts";

type ResultHeaderProps = {
  locale: PlannerLocale;
  mobileResultView: MobileResultView;
  onMobileResultView: (view: MobileResultView) => void;
  feasibilityResult: FeasibilityResult | null;
  resultStateCopy: { label: string; headline: string } | null;
  dayTheme: string;
  /** Copy Deck plan.stats totals — the same numbers the verdict details use. */
  tripStats: { placeCount: number; travelMinutes: number; bufferMinutes: number } | null;
  scheduledStopCount: number | null;
  deferredAnchorCount: number;
  planIssueCount: number;
  canUndo: boolean;
  canRedo: boolean;
  shareCopied: boolean;
  shareTriggerRef: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPrint: () => void;
  onShare: () => void;
};

export default function ResultHeader({
  locale,
  mobileResultView,
  onMobileResultView,
  feasibilityResult,
  resultStateCopy,
  dayTheme,
  tripStats,
  scheduledStopCount,
  deferredAnchorCount,
  planIssueCount,
  canUndo,
  canRedo,
  shareCopied,
  shareTriggerRef,
  onEdit,
  onUndo,
  onRedo,
  onPrint,
  onShare,
}: ResultHeaderProps) {
  const text = ui[locale];
  return (
    <>
      <div className="planner-mobile-result-toggle" role="group" aria-label={locale === "ja" ? "結果の表示" : "Result view"}>
        <button aria-pressed={mobileResultView === "timeline"} className={mobileResultView === "timeline" ? "is-active" : ""} onClick={() => onMobileResultView("timeline")} type="button">{locale === "ja" ? "旅程" : "Timeline"}</button>
        <button aria-pressed={mobileResultView === "map"} className={mobileResultView === "map" ? "is-active" : ""} onClick={() => onMobileResultView("map")} type="button">{locale === "ja" ? "地図" : "Map"}</button>
        <button aria-pressed={mobileResultView === "compact"} className={mobileResultView === "compact" ? "is-active" : ""} onClick={() => onMobileResultView("compact")} type="button">{locale === "ja" ? "地図を隠す" : "Hide map"}</button>
      </div>

      <header className="planner-result-header">
        <div>
          <span className={`planner-verdict-label${feasibilityResult ? ` is-${feasibilityResult.state.toLowerCase()}` : ""}`}>
            {feasibilityResult ? <i aria-hidden="true"><Icon name={feasibilityStateIcon(feasibilityResult.state)} size={12} /></i> : null}
            {deferredAnchorCount > 0 && scheduledStopCount !== null
              ? locale === "ja"
                ? `${scheduledStopCount}/${scheduledStopCount + deferredAnchorCount}か所を日程化`
                : `${scheduledStopCount} of ${scheduledStopCount + deferredAnchorCount} places planned`
              : resultStateCopy?.label ?? (locale === "ja" ? "旅程の結論" : "Plan result")}
          </span>
          <h1>{resultStateCopy?.headline ?? dayTheme}</h1>
          {tripStats || planIssueCount > 0 ? (
            // Copy Deck plan.stats: one compact totals line directly under
            // the headline, the issue chip on its right (TC-029: no audit
            // counts here — those stay inside the verdict details).
            <div className="planner-headline-facts">
              {tripStats ? <p className="planner-trip-stats">{tripStatsLine(tripStats, locale)}</p> : null}
              {planIssueCount > 0 ? (
                <button
                  className="planner-issue-chip"
                  onClick={() => document.getElementById("planner-issue-card")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  type="button"
                >{locale === "ja" ? `確認したいこと ${planIssueCount}` : `${planIssueCount} thing${planIssueCount === 1 ? "" : "s"} to check`}</button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="planner-result-actions">
          <button onClick={onEdit} type="button">{text.edit}</button>
          <details className="planner-result-menu">
            <summary aria-label={locale === "ja" ? "その他の操作" : "More actions"}>•••</summary>
            <div>
              <button
                className="planner-mobile-verdict-action"
                onClick={(event) => {
                  const menu = event.currentTarget.closest("details") as HTMLDetailsElement | null;
                  if (menu) menu.open = false;
                  const details = document.querySelector(".planner-verdict-details") as HTMLDetailsElement | null;
                  if (!details) return;
                  details.open = true;
                  details.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                type="button"
              >{locale === "ja" ? "結論の詳細" : "Result details"}</button>
              <button aria-label={locale === "ja" ? "変更を取り消す" : "Undo change"} disabled={!canUndo} onClick={onUndo} title={locale === "ja" ? "取り消す (⌘/Ctrl+Z)" : "Undo (⌘/Ctrl+Z)"} type="button">↶ {locale === "ja" ? "元に戻す" : "Undo"}</button>
              <button aria-label={locale === "ja" ? "変更をやり直す" : "Redo change"} disabled={!canRedo} onClick={onRedo} title={locale === "ja" ? "やり直す (⌘/Ctrl+Shift+Z)" : "Redo (⌘/Ctrl+Shift+Z)"} type="button">↷ {locale === "ja" ? "やり直す" : "Redo"}</button>
              <button onClick={onPrint} title={text.printTitle} type="button">{text.print}</button>
              <button className={shareCopied ? "is-copied" : ""} onClick={onShare} ref={shareTriggerRef} title={text.shareTitle} type="button">{shareCopied ? text.shareCopied : text.share}</button>
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
