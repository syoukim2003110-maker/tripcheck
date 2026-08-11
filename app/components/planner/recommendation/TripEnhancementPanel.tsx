"use client";

// The route-ideas inspector aside (spec v2.1 recommendation/): intro, gap
// note, loading/unavailable/rate-limited/empty states and the candidate list
// hosting GapRecommendationCard. Emits events only — the parent owns the
// inspector, sheet and alternatives state.
import type { RefObject, SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import GapRecommendationCard from "./GapRecommendationCard";
import type { ItineraryGap } from "../../../../lib/gap-detection.ts";
import type { RouteRecommendation } from "../../../../lib/route-recommendations.ts";
import type { RouteRecommendationState } from "../../../../lib/planner-app-state.ts";
import type { PlanImpactMetrics } from "../../../../lib/recommendation-impact.ts";
import { recommendationStopId } from "../../../../lib/presentation/recommendation-presentation.ts";
import { formatCheckedAt } from "../../../../lib/presentation/trip-presentation.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type TripEnhancementPanelProps = {
  locale: PlannerLocale;
  dayLabel: string | undefined;
  state: RouteRecommendationState;
  gap: ItineraryGap | null;
  /** TC-047 detour order: within-cap candidates first, beyond-cap after them. */
  orderedCandidates: RouteRecommendation[];
  /** Candidates beyond the 15-minute walking cap — never lead, always labeled. */
  overCapIds: Set<string>;
  impactById: Record<string, PlanImpactMetrics>;
  notice: string;
  sheetExpanded: boolean;
  alternativesExpanded: boolean;
  selectedCandidateId: string | undefined;
  plannedStopIds: Set<string>;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToggleSheet: () => void;
  onRetry: () => void;
  onExpandAlternatives: () => void;
  onSelectCandidate: (candidateId: string) => void;
  onAddCandidate: (candidate: RouteRecommendation) => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function TripEnhancementPanel({
  locale,
  dayLabel,
  state,
  gap,
  orderedCandidates,
  overCapIds,
  impactById,
  notice,
  sheetExpanded,
  alternativesExpanded,
  selectedCandidateId,
  plannedStopIds,
  panelRef,
  onClose,
  onToggleSheet,
  onRetry,
  onExpandAlternatives,
  onSelectCandidate,
  onAddCandidate,
  onPhotoError,
}: TripEnhancementPanelProps) {
  const text = ui[locale];
  return (
    <aside
      aria-labelledby="planner-route-ideas-title"
      className={`planner-inspector is-recommendations${sheetExpanded ? " is-sheet-full" : ""}`}
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
    >
      <button className="planner-inspector-close" onClick={onClose} type="button" aria-label={text.close}><Icon name="close" size={13} /></button><button aria-label={locale === "ja" ? (sheetExpanded ? "シートを縮小" : "シートを全画面に広げる") : (sheetExpanded ? "Collapse sheet" : "Expand sheet")} className="planner-inspector-expand" onClick={onToggleSheet} type="button">{sheetExpanded ? "▾" : "▴"}</button>
      <header className="planner-inspector-head">
        <span className="planner-inspector-num is-recommendation" aria-hidden="true"><Icon name="spark" size={17} /></span>
        <div>
          <h2 id="planner-route-ideas-title">{text.routeIdeasTitle}</h2>
          <p>{dayLabel}{state.fetchedAt ? ` · ${formatCheckedAt(state.fetchedAt, locale)}` : ""}</p>
        </div>
      </header>
      <p className="planner-route-ideas-intro">{text.routeIdeasSubtitle}</p>
      {gap ? (
        <p className="planner-route-gap-note">
          {locale === "ja"
            ? `${gap.startAt}〜${gap.endAt}の${gap.availableMinutes}分に収まる候補です。`
            : `Fits the ${gap.availableMinutes}-minute gap from ${gap.startAt} to ${gap.endAt}.`}
        </p>
      ) : null}
      {notice ? <p className="planner-route-ideas-feedback" role="status">{notice}</p> : null}
      {state.status === "loading" ? (
        <p className="planner-route-ideas-status" role="status"><i aria-hidden="true" />{text.routeIdeasLoading}</p>
      ) : null}
      {state.status === "unavailable" ? (
        <div className="planner-route-ideas-empty" role="status">
          <p>{text.routeIdeasUnavailable}</p>
          <button onClick={onRetry} type="button">{text.routeIdeasChip}</button>
        </div>
      ) : null}
      {state.status === "rate_limited" ? (
        <p className="planner-route-ideas-empty" role="status">{text.routeIdeasRateLimited}</p>
      ) : null}
      {state.status === "ready" && state.candidates.length === 0 ? (
        <p className="planner-route-ideas-empty" role="status">{text.routeIdeasEmpty}</p>
      ) : null}
      {state.status === "ready" && orderedCandidates.length > 0 ? (
        <div className="planner-route-ideas-list">
          {/* TC-047: unexpanded shows only the detour-capped lead; expanding
              is the explicit alternatives list, where beyond-cap candidates
              appear labeled with their real walking detour. */}
          {orderedCandidates.slice(0, alternativesExpanded ? 3 : 1).map((candidate, index) => (
            <GapRecommendationCard
              added={plannedStopIds.has(recommendationStopId(candidate.id))}
              candidate={candidate}
              impact={plannedStopIds.has(recommendationStopId(candidate.id)) ? null : impactById[candidate.id] ?? null}
              index={index}
              key={candidate.id}
              locale={locale}
              onAdd={onAddCandidate}
              onPhotoError={onPhotoError}
              onSelect={onSelectCandidate}
              overDetourCap={overCapIds.has(candidate.id)}
              selected={selectedCandidateId === candidate.id}
            />
          ))}
          {!alternativesExpanded && orderedCandidates.length > 1 ? (
            <button className="planner-route-alternatives" onClick={onExpandAlternatives} type="button">
              {(() => {
                const extraCount = Math.min(2, orderedCandidates.length - 1);
                return locale === "ja" ? `他の候補を${extraCount}件見る` : `See ${extraCount} ${extraCount === 1 ? "alternative" : "alternatives"}`;
              })()}
            </button>
          ) : null}
          <p className="planner-route-ideas-note">{text.routeIdeasNote}</p>
        </div>
      ) : null}
    </aside>
  );
}
