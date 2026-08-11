"use client";

// The meal inspector aside (spec v2.1 inspector/): close/expand controls,
// header, slot rationale, the loading/unavailable states with the Maps
// fallback link and the ranked candidate list hosting
// MealRecommendationCard. Emits events only — the meal selection state
// stays with the parent.
import type { RefObject, SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import MealRecommendationCard from "../recommendation/MealRecommendationCard";
import { foodSearchLinks } from "../../../../lib/food-recommendations-client.ts";
import type { FoodCandidate } from "../../../../lib/google-food.ts";
import type { FoodRecommendationSlot } from "../../../../lib/trip-builder.ts";
import { type FoodState, type Inspector } from "../../../../lib/planner-app-state.ts";
import { detourWalkingMinutes, type DetourPartition } from "../../../../lib/recommendation-evaluator.ts";
import type { PlanImpactMetrics } from "../../../../lib/recommendation-impact.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type MealInspectorProps = {
  locale: PlannerLocale;
  activeFoodSlot: FoodRecommendationSlot;
  activeFoodState: FoodState;
  inspector: Inspector;
  foodRecommendationNotice: string;
  mealCandidatesBySlot: Record<string, FoodCandidate[]>;
  /** TC-044 detour partition: within-cap candidates lead; beyond-cap ones follow with real detours. */
  mealDetourBySlot: Record<string, DetourPartition<FoodCandidate>>;
  mealImpactBySlot: Record<string, Record<string, PlanImpactMetrics>>;
  mealSelections: Record<string, string>;
  sheetExpanded: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToggleSheet: () => void;
  onToggleMealSelection: (slotId: string, candidateId: string) => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function MealInspector({
  locale,
  activeFoodSlot,
  activeFoodState,
  inspector,
  foodRecommendationNotice,
  mealCandidatesBySlot,
  mealDetourBySlot,
  mealImpactBySlot,
  mealSelections,
  sheetExpanded,
  panelRef,
  onClose,
  onToggleSheet,
  onToggleMealSelection,
  onPhotoError,
}: MealInspectorProps) {
  const text = ui[locale];
  return (
    <aside
      aria-labelledby="planner-food-inspector-title"
      className={`planner-inspector is-food${sheetExpanded ? " is-sheet-full" : ""}`}
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
    >
      <button className="planner-inspector-close" onClick={onClose} type="button" aria-label={text.close}><Icon name="close" size={13} /></button><button aria-label={locale === "ja" ? (sheetExpanded ? "シートを縮小" : "シートを全画面に広げる") : (sheetExpanded ? "Collapse sheet" : "Expand sheet")} className="planner-inspector-expand" onClick={onToggleSheet} type="button">{sheetExpanded ? "▾" : "▴"}</button>
      <header className="planner-inspector-head">
        <span className="planner-inspector-num is-food" aria-hidden="true"><Icon name={activeFoodSlot.kind === "lunch" ? "sun" : "moon"} size={17} /></span>
        <div>
          <h2 id="planner-food-inspector-title">{text.mealIdeas}</h2>
          <p>{activeFoodSlot.area} · {activeFoodSlot.window}</p>
        </div>
      </header>
      <p className="planner-food-rationale">{activeFoodSlot.rationale}</p>
      {foodRecommendationNotice ? <p className="planner-route-ideas-feedback" role="status">{foodRecommendationNotice}</p> : null}
      {activeFoodState.status === "loading" ? <p className="planner-food-status" role="status">{text.foodLoading}</p> : null}
      {activeFoodState.status === "unavailable" ? (
        <p className="planner-food-status">
          {text.foodUnavailable}{" "}
          <a href={foodSearchLinks(activeFoodState.query, activeFoodSlot.area, locale).googleMaps} rel="noreferrer" target="_blank">Google Maps ↗</a>
        </p>
      ) : null}
      {activeFoodState.status === "ready" ? (
        <div className="planner-food-results">
          {(() => {
            // TC-044: within-cap candidates render first (the auto-shown
            // shortlist); beyond-cap candidates stay reachable here in the
            // explicit alternatives list, each with its real walking detour.
            const partition = mealDetourBySlot[activeFoodSlot.id];
            const ordered = partition
              ? [...partition.autoDisplay, ...partition.overCap]
              : mealCandidatesBySlot[activeFoodSlot.id] ?? [];
            return ordered.map((candidate, index) => (
              <MealRecommendationCard
                candidate={candidate}
                detourMinutes={detourWalkingMinutes(candidate.distanceMeters)}
                foodFresh={activeFoodState.fresh[candidate.id]?.result}
                impact={mealSelections[activeFoodSlot.id] === candidate.id ? null : mealImpactBySlot[activeFoodSlot.id]?.[candidate.id] ?? null}
                index={index}
                isChosen={mealSelections[activeFoodSlot.id] === candidate.id}
                isSelected={inspector?.kind === "food" && inspector.candidateId === candidate.id}
                key={candidate.id}
                locale={locale}
                note={activeFoodState.notes[candidate.id]}
                onChoose={() => onToggleMealSelection(activeFoodSlot.id, candidate.id)}
                onPhotoError={onPhotoError}
              />
            ));
          })()}
          <p className="planner-food-note">{text.foodNote}</p>
        </div>
      ) : null}
    </aside>
  );
}
