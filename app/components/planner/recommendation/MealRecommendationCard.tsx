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

type MealRecommendationCardProps = {
  candidate: FoodCandidate;
  index: number;
  locale: PlannerLocale;
  isSelected: boolean;
  isChosen: boolean;
  aiOrdered: boolean | undefined;
  note: { reason: string; tag: string } | undefined;
  foodFresh: FreshVoicesResult | null | undefined;
  /** Pre-accept impact from the really simulated candidate plan (TC-048). */
  impact?: PlanImpactMetrics | null;
  onChoose: () => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function MealRecommendationCard({
  candidate,
  index,
  locale,
  isSelected,
  isChosen,
  aiOrdered,
  note,
  foodFresh,
  impact = null,
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
        {candidate.photoName ? <>
          {/* Google place photos are short-lived, server-proxied URLs and cannot use a static Next image allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={candidate.name} loading="lazy" onError={onPhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
        </> : <span aria-hidden="true"><Icon name="fork" size={20} /></span>}
        <i className="planner-food-badge">{index + 1}</i>
      </a>
      <div>
        <small>
          {aiOrdered && index === 0
            ? `${locale === "ja" ? "AIのおすすめ" : "AI pick"}${note?.tag ? ` · ${note.tag}` : ""}`
            : note?.tag ?? (index === 0 ? (locale === "ja" ? "この土地なら、まずここ" : "Start here") : candidate.type)}
        </small>
        <h3>{candidate.name}</h3>
        <p>{note?.reason ?? foodCandidateReason(candidate, locale)}</p>
        <div className="planner-food-stats">
          {ratingLine !== null ? <span className="is-rating">{ratingLine}</span> : null}
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
