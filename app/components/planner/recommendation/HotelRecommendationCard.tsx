"use client";

// One hotel candidate card (spec v2.1 recommendation/), shared by the
// single-stay comparison list and the nightly-night shortlist. The two call
// sites compose the facts line and tag labels themselves (their wording and
// travel evidence live with the parent state); the card only owns the DOM.
// The comparison list omits the tags row when empty, the nightly list always
// renders it — `showEmptyTags` keeps both structures exact.
import type { SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import type { HotelCandidate } from "../../../../lib/google-hotels.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";
import { placePhotoSrc } from "../../../../lib/presentation/place-photo";

type HotelRecommendationCardProps = {
  candidate: HotelCandidate;
  locale: PlannerLocale;
  isSelected: boolean;
  priceLabel: string;
  facts: string;
  tags: string[];
  showEmptyTags?: boolean;
  rakutenLine?: string | null;
  aiNote?: { reason: string; tag: string } | null;
  onSelect: () => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function HotelRecommendationCard({
  candidate,
  locale,
  isSelected,
  priceLabel,
  facts,
  tags,
  showEmptyTags = false,
  rakutenLine,
  aiNote,
  onSelect,
  onPhotoError,
}: HotelRecommendationCardProps) {
  const text = ui[locale];
  return (
    <article className={`planner-hotel-card${isSelected ? " is-selected" : ""}`}>
      <button aria-pressed={isSelected} onClick={onSelect} title={text.useThisHotel} type="button">
        <span className="planner-hotel-card-image">
          {candidate.photo && placePhotoSrc(candidate.photo.name, candidate.photo.signature) ? <>
            {/* Google photo names are fetched at request time and never persisted. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={candidate.name} loading="lazy" onError={onPhotoError} src={placePhotoSrc(candidate.photo.name, candidate.photo.signature)} />
          </> : <span aria-hidden="true"><Icon name="bed" size={22} /></span>}
          <em>{priceLabel}</em>
        </span>
        <span className="planner-hotel-card-copy">
          <b>{candidate.name}</b>
          <small>{facts}</small>
          {showEmptyTags || tags.length > 0 ? (
            <span className="planner-hotel-card-tags">
              {tags.map((tag) => <i key={tag}>{tag}</i>)}
            </span>
          ) : null}
          {rakutenLine ? (
            <small className="is-rakuten-line">{rakutenLine}</small>
          ) : null}
          {aiNote ? (
            <small className="planner-hotel-ai-line">AI: {aiNote.reason}</small>
          ) : null}
        </span>
      </button>
      <footer>
        {candidate.photo?.attribution
          ? <a href={candidate.photo.attribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photo.attribution.name}</a>
          : <span />}
        <a href={candidate.rakuten?.url ?? candidate.googleMapsUrl} rel="noreferrer" target="_blank">{candidate.rakuten ? "Rakuten" : "Maps"} ↗</a>
      </footer>
    </article>
  );
}
