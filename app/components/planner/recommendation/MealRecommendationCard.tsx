"use client";

// One food candidate card from the meal inspector (spec v2.1
// recommendation/): photo, AI/tag line, stats, choose toggle and fresh-proof
// links. Emits onChoose only — the parent owns the meal selection state.
// The rating/open/payment stat lines come from the shared presentation rules
// that also feed mealEnhancement, so the card and the tested model agree.
import type { SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import { foodCandidateReason } from "../../../../lib/food-recommendations-client.ts";
import type { FoodCandidate } from "../../../../lib/google-food.ts";
import type { FreshVoicesResult } from "../../../../lib/fresh-voices.ts";
import { bufferDeltaLine, travelDeltaLine, ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";
import { openStatusLabel, paymentEvidenceLabel, ratingFactLine } from "../../../../lib/presentation/recommendation-presentation.ts";
import type { PlanImpactMetrics } from "../../../../lib/recommendation-impact.ts";
import { placePhotoSrc } from "../../../../lib/presentation/place-photo";

type MealRecommendationCardProps = {
  candidate: FoodCandidate;
  index: number;
  locale: PlannerLocale;
  isSelected: boolean;
  isChosen: boolean;
  /** AI-written comparison label for this candidate (TC-049: label-only authority). */
  note: { reason: string; tag: string } | undefined;
  foodFresh: FreshVoicesResult | null | undefined;
  /** Pre-accept impact from the really simulated candidate plan (TC-048). */
  impact?: PlanImpactMetrics | null;
  /** Real walking detour from the slot's route position (TC-044). */
  detourMinutes?: number | null;
  onChoose: () => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function MealRecommendationCard({
  candidate,
  index,
  locale,
  isSelected,
  isChosen,
  note,
  foodFresh,
  impact = null,
  detourMinutes = null,
  onChoose,
  onPhotoError,
}: MealRecommendationCardProps) {
  const text = ui[locale];
  const ratingLine = ratingFactLine(candidate.rating, candidate.userRatingCount, locale);
  const openStatus = openStatusLabel(candidate, locale);
  const paymentLabel = paymentEvidenceLabel(candidate);
  return (
    <article
      className={isSelected ? "is-selected" : undefined}
      data-food-candidate={candidate.id}
    >
      <a className="planner-food-image" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
        {placePhotoSrc(candidate.photoName, candidate.photoSignature) ? <>
          {/* Google place photos are short-lived, server-proxied URLs and cannot use a static Next image allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={candidate.name} loading="lazy" onError={onPhotoError} src={placePhotoSrc(candidate.photoName, candidate.photoSignature)} />
        </> : <span aria-hidden="true"><Icon name="fork" size={20} /></span>}
        <i className="planner-food-badge">{index + 1}</i>
      </a>
      <div>
        {/* Copy Deck plan.reco.meal labels the deterministic lead (TC-049);
            the AI's comparison tag rides along as a label, never as rank. */}
        <small>
          {index === 0
            ? `${text.mealIdeas}${note?.tag ? ` · ${note.tag}` : ""}`
            : note?.tag ?? candidate.type}
        </small>
        <h3>{candidate.name}</h3>
        <p>{note?.reason ?? foodCandidateReason(candidate, locale)}</p>
        <div className="planner-food-stats">
          {ratingLine !== null ? <span className="is-rating">{ratingLine}</span> : null}
          {/* TC-044: the real walking detour, shown for every candidate so a
              beyond-cap alternative is never passed off as on the way. */}
          {detourMinutes !== null ? <span className="is-detour">{text.detourLine(detourMinutes)}</span> : null}
          {openStatus !== null ? <span>{openStatus}</span> : null}
          {paymentLabel !== null ? <span>{paymentLabel}</span> : null}
          {foodFresh?.findings.length ? <span className="is-fresh">{text.foodFresh(foodFresh.findings.length)}</span> : null}
          {impact ? <span className="is-impact">{travelDeltaLine(impact.travelDeltaMinutes, locale)}</span> : null}
          {impact ? <span className="is-impact">{bufferDeltaLine(impact.bufferDeltaMinutes, locale)}</span> : null}
        </div>
        <button
          className={`planner-meal-choose${isChosen ? " is-active" : ""}`}
          onClick={onChoose}
          type="button"
        >
          {isChosen ? (<><Icon name="check" size={11} />{text.mealChosen}</>) : text.mealChoose}
        </button>
        {candidate.reviewSnippets[0] ? <p className="planner-food-proof">“{candidate.reviewSnippets[0].text}” <a href={candidate.reviewSnippets[0].googleMapsUrl ?? candidate.googleMapsUrl} rel="noreferrer" target="_blank">{candidate.reviewSnippets[0].authorName} · {candidate.reviewSnippets[0].relativeTime} ↗</a></p> : null}
        {candidate.photoAttribution ? (
          <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photoAttribution.name}</a>
        ) : null}
        {foodFresh?.findings[0] ? <a className="planner-photo-credit" href={foodFresh.findings[0].url} rel="noreferrer" target="_blank">{text.freshSource[foodFresh.findings[0].sourceKind]} · {foodFresh.findings[0].title} ↗</a> : null}
      </div>
      <a className="planner-food-map" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">{text.maps}<span aria-hidden="true">↗</span></a>
    </article>
  );
}
