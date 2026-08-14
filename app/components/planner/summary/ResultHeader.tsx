"use client";

// Result header (spec v2.1 summary/): verdict label, headline, the Copy Deck
// plan.stats totals line and the actions menu (edit, verdict details,
// undo/redo, print, share). Emits events; history and dialogs live above.
// The mobile view toggle is a map control and lives beside the map; the
// things-to-check list is named once, on the card that carries its actions.
import type { RefObject } from "react";
import Icon from "../../../PlannerIcons";
import { feasibilityStateIcon } from "../icon-maps";
import type { FeasibilityResult } from "../../../../lib/feasibility-result.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";
import { tripStatsParts } from "../../../../lib/presentation/trip-presentation.ts";

type ResultHeaderProps = {
  locale: PlannerLocale;
  feasibilityResult: FeasibilityResult | null;
  resultStateCopy: { label: string; headline: string } | null;
  dayTheme: string;
  /** Copy Deck plan.stats totals — the same numbers the verdict details use.
   * `spareDays` is the fit assessment's own figure and is null whenever that
   * assessment withholds a conclusion. */
  tripStats: {
    placeCount: number;
    travelMinutes: number;
    bufferMinutes: number;
    spareDays?: number | null;
  } | null;
  scheduledStopCount: number | null;
  deferredAnchorCount: number;
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
  feasibilityResult,
  resultStateCopy,
  dayTheme,
  tripStats,
  scheduledStopCount,
  deferredAnchorCount,
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
      <header className="planner-result-header">
        <div>
          {/* v3.1 §2.1 Tier C: the verdict eyebrow used to repeat the headline
              as a code — 「条件付き」 above 「4日で回れます。2か所だけ確認が必要です」.
              Two encodings of one fact, and the code is the one a traveller has
              to learn. The sentence keeps the meaning; the state survives as
              colour on the mark beside it. The eyebrow now renders only for the
              one thing the sentence does not say: that some of the traveller's
              own places did not make it into the schedule. */}
          {deferredAnchorCount > 0 && scheduledStopCount !== null ? (
            <span className={`planner-verdict-label${feasibilityResult ? ` is-${feasibilityResult.state.toLowerCase()}` : ""}`}>
              {feasibilityResult ? <i aria-hidden="true"><Icon name={feasibilityStateIcon(feasibilityResult.state)} size={12} /></i> : null}
              {locale === "ja"
                ? `${scheduledStopCount}/${scheduledStopCount + deferredAnchorCount}か所を日程化`
                : `${scheduledStopCount} of ${scheduledStopCount + deferredAnchorCount} places planned`}
            </span>
          ) : null}
          <h1>
            {resultStateCopy?.headline ?? dayTheme}
            {feasibilityResult && deferredAnchorCount === 0 ? (
              <i aria-hidden="true" className={`planner-verdict-mark is-${feasibilityResult.state.toLowerCase()}`}>
                <Icon name={feasibilityStateIcon(feasibilityResult.state)} size={15} />
              </i>
            ) : null}
          </h1>
          {tripStats ? (
            // Copy Deck plan.stats: one compact totals line directly under the
            // headline (TC-029: no audit counts here — those stay inside the
            // verdict details). The things-to-check count used to be repeated
            // here as a chip while the card below the itinerary carried the
            // same sentence and the actions; the card is the one that can act,
            // so the count is stated once, there.
            <div className="planner-headline-facts">
              {/* v3.1 §4.2: the spare clause is the one a traveller acts on —
                  it is the difference between a full trip and an empty
                  afternoon — so it carries the good colour. The sentence is
                  byte-identical to the one `tripStatsLine` builds. */}
              {(() => {
                const parts = tripStatsParts(tripStats, locale);
                return (
                  <p className="planner-trip-stats">
                    {parts.places}{parts.separator}{parts.travel}{parts.separator}
                    <span className="planner-trip-spare">{parts.spare}</span>
                  </p>
                );
              })()}
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
