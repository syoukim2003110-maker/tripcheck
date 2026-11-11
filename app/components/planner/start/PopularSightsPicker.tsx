"use client";

import { useEffect, useMemo, useState } from "react";

import {
  filterDestinations,
  sightLineName,
  toggleSightLine,
  wishlistHasSight,
  type PopularDestination,
} from "../../../../lib/popular-sights";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";

/*
 * "Where are you going?" → the sights most people go there for, one tap each.
 *
 * A traveller usually knows the famous names but not how to spell them, and
 * typing eight of them is the first chore of planning. This turns that chore
 * into taps. It only ever adds or removes whole lines in the wishlist the
 * traveller can see and edit; nothing is planned until they press build.
 *
 * The list is bundled data (Wikidata, ranked by how widely each sight is
 * written about), loaded on first use so it costs nothing until opened.
 */

const FEATURED = ["tokyo", "kyoto", "osaka", "hongkong", "seoul", "taipei", "bangkok", "paris"];
const FIRST_PAGE = 14;

export default function PopularSightsPicker({
  locale,
  itinerary,
  onItineraryChange,
}: {
  locale: PlannerLocale;
  itinerary: string;
  onItineraryChange: (value: string) => void;
}) {
  const ja = locale === "ja";
  const [destinations, setDestinations] = useState<PopularDestination[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("../../../../lib/popular-sights-data.json").then((module) => {
      if (!cancelled) setDestinations((module.default as { cities: PopularDestination[] }).cities);
    }).catch(() => {
      // The picker is a convenience; typing still works without it.
      if (!cancelled) setDestinations([]);
    });
    return () => { cancelled = true; };
  }, []);

  const matches = useMemo(
    () => destinations ? filterDestinations(destinations, query, FEATURED) : [],
    [destinations, query],
  );
  const selected = destinations?.find((destination) => destination.id === selectedId) ?? null;
  if (destinations !== null && destinations.length === 0) return null;

  const sights = selected ? (showAll ? selected.sights : selected.sights.slice(0, FIRST_PAGE)) : [];
  const chosenCount = selected ? selected.sights.filter((sight) => wishlistHasSight(itinerary, sight)).length : 0;

  return (
    <section className="planner-sights" aria-label={ja ? "行き先から選ぶ" : "Pick from a destination"}>
      <div className="planner-sights-head">
        <label htmlFor="planner-sights-query">{ja ? "行き先から選ぶ" : "Pick from a destination"}</label>
        <input
          autoComplete="off"
          id="planner-sights-query"
          onChange={(event) => { setQuery(event.target.value); setSelectedId(null); setShowAll(false); }}
          placeholder={ja ? "どこに行く？（例：香港、京都、パリ）" : "Where to? (e.g. Kyoto, Paris)"}
          type="search"
          value={query}
        />
      </div>
      {!selected ? (
        <div className="planner-sights-cities" role="list">
          {matches.map((destination) => (
            <button
              className="planner-sights-city"
              key={destination.id}
              onClick={() => { setSelectedId(destination.id); setQuery(ja ? destination.ja : destination.en); setShowAll(false); }}
              role="listitem"
              type="button"
            >
              {ja ? destination.ja : destination.en}
            </button>
          ))}
          {destinations !== null && matches.length === 0 ? (
            <p className="planner-sights-empty">
              {ja
                ? "この行き先の一覧はまだありません。下の欄に行きたい場所をそのまま入力してください。"
                : "No list for this destination yet. Type your places in the box below."}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="planner-sights-body">
          <p className="planner-sights-hint">
            {ja
              ? `${selected.ja}でよく行かれる場所です。タップで下のリストに追加・解除できます。${chosenCount > 0 ? `（${chosenCount}件選択中）` : ""}`
              : `Places people most often visit in ${selected.en}. Tap to add or remove.${chosenCount > 0 ? ` (${chosenCount} selected)` : ""}`}
          </p>
          <div className="planner-sights-chips">
            {sights.map((sight) => {
              const chosen = wishlistHasSight(itinerary, sight);
              return (
                <button
                  aria-pressed={chosen}
                  className={`planner-sights-chip${chosen ? " is-chosen" : ""}`}
                  key={sight.q}
                  onClick={() => onItineraryChange(toggleSightLine(itinerary, sight, locale))}
                  type="button"
                >
                  <span aria-hidden="true">{chosen ? "✓" : "＋"}</span>
                  {sightLineName(sight, locale)}
                </button>
              );
            })}
          </div>
          <div className="planner-sights-foot">
            {!showAll && selected.sights.length > FIRST_PAGE ? (
              <button className="planner-sights-more" onClick={() => setShowAll(true)} type="button">
                {ja ? `もっと見る（あと${selected.sights.length - FIRST_PAGE}件）` : `Show ${selected.sights.length - FIRST_PAGE} more`}
              </button>
            ) : null}
            <button className="planner-sights-more" onClick={() => { setSelectedId(null); setQuery(""); setShowAll(false); }} type="button">
              {ja ? "別の行き先を選ぶ" : "Choose another destination"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
