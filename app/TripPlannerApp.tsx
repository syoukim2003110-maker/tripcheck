"use client";

import { useEffect, useMemo, useState } from "react";
import { foodSearchLinks, requestFoodRecommendations } from "../lib/food-recommendations-client";
import type { FoodCandidate } from "../lib/google-food";
import { fullTripDemo } from "../lib/mock-trip";
import { PlaceResolutionError, requestPlaceResolution } from "../lib/place-resolution-client";
import type { ResolvedInputStop, RouteStop } from "../lib/route-optimizer";
import { analyzeTrip, type Pace } from "../lib/trip-analysis";
import type { AirportCode, FoodRecommendationSlot, MealPlan } from "../lib/trip-builder";

type PlannerLocale = "en" | "ja";
type FoodState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  query: string;
  candidates: FoodCandidate[];
};

const airportOptions: Array<{ value: AirportCode; label: string }> = [
  { value: "none", label: "—" },
  { value: "HND", label: "HND · Haneda" },
  { value: "NRT", label: "NRT · Narita" },
  { value: "KIX", label: "KIX · Kansai" },
  { value: "ITM", label: "ITM · Itami" },
  { value: "NGO", label: "NGO · Chubu" },
  { value: "FUK", label: "FUK · Fukuoka" },
  { value: "CTS", label: "CTS · New Chitose" },
  { value: "OKA", label: "OKA · Naha" },
];

const ui = {
  ja: {
    brandNote: "日本旅行プランナー",
    newTrip: "新しい旅行",
    headline: "行きたい場所から、旅程をつくる",
    subhead: "順番は気にせず、場所・予約・食べたいものをそのまま入力してください。",
    inputLabel: "行きたい場所",
    placeholder: "例）\n浅草寺\nチームラボプラネッツ — 1日目 15:30 予約\n三鷹の森ジブリ美術館 — 必須\n渋谷スカイ — 時間があれば",
    sample: "デモを入れる",
    days: "日数",
    date: "初日",
    hotel: "ホテル・最寄り駅",
    hotelPlaceholder: "例：新宿駅近く",
    details: "ホテル・空港・食事の条件",
    arrival: "到着空港",
    arrivalTime: "到着時刻",
    departure: "出発空港",
    departureTime: "出発時刻",
    pace: "旅行のペース",
    meal: "食事の提案",
    relaxed: "ゆったり",
    balanced: "標準",
    fast: "たくさん回る",
    allMeals: "昼・夜",
    dinner: "夜だけ",
    noMeals: "表示しない",
    build: "旅程をつくる",
    building: "場所を確認して、地図を作っています…",
    mapReady: "Googleマップ",
    mapEmpty: "行き先を入れると、日別ルートがここに出ます",
    japanOverview: "日本全体",
    edit: "入力を編集",
    planSummary: (days: number, stops: number) => `${days}日間 · ${stops}か所`,
    openMaps: "Google Mapsで開く",
    route: "この日の流れ",
    stay: "滞在",
    move: { walk: "徒歩", transit: "電車", taxi: "タクシー" },
    unknown: "地図に出せなかった入力",
    placeFallback: "一部の場所を地図で確認できませんでした。分かる場所だけで旅程を表示しています。",
    mealIdeas: "この近くで食べるなら",
    findFood: "お店を見る",
    foodLoading: "近くのお店を探しています…",
    foodUnavailable: "お店を取得できませんでした。Google Mapsから同じ条件で探せます。",
    maps: "地図で見る",
    foodNote: "店を予定に固定せず、近くの候補だけ表示します。",
    reservation: "予約",
    must: "必須",
    optional: "任意",
    estimated: "移動時間は計画用の目安",
    language: "言語",
    privacy: "旅程は保存しません",
  },
  en: {
    brandNote: "Japan trip planner",
    newTrip: "New trip",
    headline: "Turn places into a workable trip",
    subhead: "Add places, bookings and food ideas in any order. We will sort the route.",
    inputLabel: "Places you want to visit",
    placeholder: "Example\nSenso-ji\nteamLab Planets — Day 1 15:30 booked\nGhibli Museum — must\nShibuya Sky — optional",
    sample: "Use demo",
    days: "Days",
    date: "First day",
    hotel: "Hotel or nearest station",
    hotelPlaceholder: "e.g. near Shinjuku Station",
    details: "Hotel, airport and meal details",
    arrival: "Arrival airport",
    arrivalTime: "Arrival time",
    departure: "Departure airport",
    departureTime: "Departure time",
    pace: "Pace",
    meal: "Food ideas",
    relaxed: "Relaxed",
    balanced: "Balanced",
    fast: "See more",
    allMeals: "Lunch + dinner",
    dinner: "Dinner only",
    noMeals: "Hide",
    build: "Build my trip",
    building: "Checking places and drawing your map…",
    mapReady: "Google Maps",
    mapEmpty: "Your day-by-day route will appear here",
    japanOverview: "Japan overview",
    edit: "Edit input",
    planSummary: (days: number, stops: number) => `${days} days · ${stops} places`,
    openMaps: "Open in Google Maps",
    route: "Today’s route",
    stay: "Stay",
    move: { walk: "Walk", transit: "Train", taxi: "Taxi" },
    unknown: "Not shown on the map",
    placeFallback: "Some places could not be confirmed. The route still uses the places we could locate.",
    mealIdeas: "Food near this route",
    findFood: "Show places",
    foodLoading: "Finding nearby places…",
    foodUnavailable: "Places did not load. Open the same search in Google Maps instead.",
    maps: "View on map",
    foodNote: "These are flexible suggestions, not locked bookings.",
    reservation: "Booked",
    must: "Must",
    optional: "Optional",
    estimated: "Travel times are planning estimates",
    language: "Language",
    privacy: "Your itinerary is not saved",
  },
} as const;

function uniqueMapStops(base: RouteStop | null, routeStops: RouteStop[]) {
  const candidates = base && routeStops.length <= 9 ? [base, ...routeStops] : routeStops;
  return candidates
    .filter((stop, index, all) => index === 0 || stop.id !== all[index - 1].id)
    .filter((stop, index, all) => index === 0 || index !== all.length - 1 || stop.id !== all[0].id)
    .slice(0, 10);
}

function modeIcon(mode: "walk" | "transit" | "taxi") {
  if (mode === "walk") return "↟";
  if (mode === "taxi") return "◆";
  return "⇄";
}

export default function TripPlannerApp({ initialLocale = "en" }: { initialLocale?: PlannerLocale }) {
  const [locale, setLocale] = useState<PlannerLocale>(initialLocale);
  const [itinerary, setItinerary] = useState("");
  const [tripDays, setTripDays] = useState(3);
  const [tripStartDate, setTripStartDate] = useState("");
  const [hotelQuery, setHotelQuery] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [mealPlan, setMealPlan] = useState<MealPlan>("all");
  const [arrivalAirport, setArrivalAirport] = useState<AirportCode>("none");
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureAirport, setDepartureAirport] = useState<AirportCode>("none");
  const [departureTime, setDepartureTime] = useState("");
  const [resolvedStops, setResolvedStops] = useState<ResolvedInputStop[]>([]);
  const [resolvedBase, setResolvedBase] = useState<ResolvedInputStop | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [placeWarning, setPlaceWarning] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodState>>({});
  const text = ui[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.remove("cursor-visible", "motion-ready");
    try { window.localStorage.setItem("tripcheck-locale", locale); } catch { /* optional */ }
  }, [locale]);

  const analysis = useMemo(() => hasPlan ? analyzeTrip(itinerary, pace, locale, tripDays, {
    tripStartDate,
    hotelQuery,
    arrivalAirport,
    arrivalTime,
    departureAirport,
    departureTime,
    flightKind: "international",
    mealPlan,
    resolvedStops,
    resolvedBase,
  }) : null, [arrivalAirport, arrivalTime, departureAirport, departureTime, hasPlan, hotelQuery, itinerary, locale, mealPlan, pace, resolvedBase, resolvedStops, tripDays, tripStartDate]);

  const plan = analysis?.inputMode === "wishlist" ? analysis.plan : null;
  const day = plan?.days[activeDay] ?? null;
  const mapStops = day ? uniqueMapStops(plan?.selectedBase ?? null, day.stops.map(({ stop }) => stop)) : [];
  const mapParams = new URLSearchParams({
    language: locale,
    points: mapStops.length > 0
      ? mapStops.map((stop) => `${stop.latitude},${stop.longitude}`).join("|")
      : "36.2048,138.2529",
    labels: mapStops.length > 0 ? mapStops.map((stop) => stop.name.replaceAll("|", " ")).join("|") : "Japan",
    ...(mapStops.length === 0 ? { zoom: "5", overview: "1" } : {}),
  });

  const canBuild = itinerary.trim().length >= 3 && !isBuilding;

  function changeLocale(next: PlannerLocale) {
    setLocale(next);
    window.history.replaceState({}, "", next === "ja" ? "/ja" : "/");
  }

  function loadDemo() {
    setItinerary(fullTripDemo.places[locale]);
    setTripDays(fullTripDemo.tripDays);
    setTripStartDate(fullTripDemo.tripStartDate);
    setHotelQuery(fullTripDemo.hotelQuery[locale]);
    setPace(fullTripDemo.pace);
    setArrivalAirport(fullTripDemo.arrivalAirport);
    setArrivalTime(fullTripDemo.arrivalTime);
    setDepartureAirport(fullTripDemo.departureAirport);
    setDepartureTime(fullTripDemo.departureTime);
    setMealPlan("all");
    setResolvedStops([]);
    setResolvedBase(null);
    setPlaceWarning(false);
    setActiveDay(0);
    setHasPlan(true);
  }

  async function buildPlan() {
    if (!canBuild) return;
    setIsBuilding(true);
    setPlaceWarning(false);
    setFoodSearches({});
    try {
      const response = await requestPlaceResolution(itinerary, hotelQuery, locale);
      setResolvedStops(response.places);
      setResolvedBase(response.hotel);
    } catch (error) {
      setResolvedStops([]);
      setResolvedBase(null);
      setPlaceWarning(error instanceof PlaceResolutionError);
    }
    setActiveDay(0);
    setHasPlan(true);
    setIsBuilding(false);
  }

  function resetTrip() {
    setItinerary("");
    setHotelQuery("");
    setTripStartDate("");
    setResolvedStops([]);
    setResolvedBase(null);
    setFoodSearches({});
    setHasPlan(false);
    setPlaceWarning(false);
    setActiveDay(0);
  }

  async function findFood(slot: FoodRecommendationSlot, query: string) {
    setFoodSearches((current) => ({ ...current, [slot.id]: { status: "loading", query, candidates: [] } }));
    try {
      const response = await requestFoodRecommendations(slot, query, locale);
      setFoodSearches((current) => ({ ...current, [slot.id]: { status: "ready", query, candidates: response.candidates } }));
    } catch {
      setFoodSearches((current) => ({ ...current, [slot.id]: { status: "unavailable", query, candidates: [] } }));
    }
  }

  return (
    <main className="trip-planner-app">
      <header className="planner-topbar">
        <button className="planner-brand" onClick={resetTrip} type="button" aria-label="TripCheck home">
          <span className="planner-brand-mark" aria-hidden="true"><i /><i /></span>
          <b>TripCheck</b><small>{text.brandNote}</small>
        </button>
        <div className="planner-top-actions">
          <span className="planner-privacy"><i aria-hidden="true">✓</i>{text.privacy}</span>
          <div className="planner-language" aria-label={text.language}>
            <button className={locale === "ja" ? "is-active" : ""} onClick={() => changeLocale("ja")} type="button">日本語</button>
            <button className={locale === "en" ? "is-active" : ""} onClick={() => changeLocale("en")} type="button">EN</button>
          </div>
          {hasPlan ? <button className="planner-new-trip" onClick={resetTrip} type="button"><span aria-hidden="true">＋</span>{text.newTrip}</button> : null}
        </div>
      </header>

      <div className="planner-workspace">
        <section className="planner-panel" aria-label={hasPlan ? text.route : text.headline}>
          {!hasPlan ? (
            <div className="planner-form-view">
              <div className="planner-intro">
                <span className="planner-step">01</span>
                <div><h1>{text.headline}</h1><p>{text.subhead}</p></div>
              </div>

              <label className="planner-composer">
                <span>{text.inputLabel}</span>
                <textarea
                  autoFocus
                  id="trip-input"
                  onChange={(event) => setItinerary(event.target.value)}
                  placeholder={text.placeholder}
                  value={itinerary}
                />
                <button onClick={loadDemo} type="button"><span aria-hidden="true">✦</span>{text.sample}</button>
              </label>

              <div className="planner-primary-fields">
                <label><span>{text.days}</span><select onChange={(event) => setTripDays(Number(event.target.value))} value={tripDays}>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{locale === "ja" ? `${value}日` : `${value} day${value === 1 ? "" : "s"}`}</option>)}</select></label>
                <label><span>{text.date}</span><input onChange={(event) => setTripStartDate(event.target.value)} type="date" value={tripStartDate} /></label>
              </div>

              <label className="planner-hotel-field"><span>{text.hotel}</span><input onChange={(event) => setHotelQuery(event.target.value)} placeholder={text.hotelPlaceholder} value={hotelQuery} /></label>

              <details className="planner-details">
                <summary>{text.details}<span aria-hidden="true">＋</span></summary>
                <div className="planner-detail-grid">
                  <label><span>{text.arrival}</span><select onChange={(event) => setArrivalAirport(event.target.value as AirportCode)} value={arrivalAirport}>{airportOptions.map((airport) => <option key={airport.value} value={airport.value}>{airport.label}</option>)}</select></label>
                  <label><span>{text.arrivalTime}</span><input disabled={arrivalAirport === "none"} onChange={(event) => setArrivalTime(event.target.value)} type="time" value={arrivalTime} /></label>
                  <label><span>{text.departure}</span><select onChange={(event) => setDepartureAirport(event.target.value as AirportCode)} value={departureAirport}>{airportOptions.map((airport) => <option key={airport.value} value={airport.value}>{airport.label}</option>)}</select></label>
                  <label><span>{text.departureTime}</span><input disabled={departureAirport === "none"} onChange={(event) => setDepartureTime(event.target.value)} type="time" value={departureTime} /></label>
                  <label><span>{text.pace}</span><select onChange={(event) => setPace(event.target.value as Pace)} value={pace}><option value="relaxed">{text.relaxed}</option><option value="balanced">{text.balanced}</option><option value="fast">{text.fast}</option></select></label>
                  <label><span>{text.meal}</span><select onChange={(event) => setMealPlan(event.target.value as MealPlan)} value={mealPlan}><option value="all">{text.allMeals}</option><option value="dinner">{text.dinner}</option><option value="none">{text.noMeals}</option></select></label>
                </div>
              </details>

              <button className="planner-build-button" disabled={!canBuild} onClick={buildPlan} type="button">
                <span>{isBuilding ? text.building : text.build}</span><b aria-hidden="true">→</b>
              </button>
            </div>
          ) : plan && day ? (
            <div className="planner-result-view">
              <header className="planner-result-header">
                <div><span>{text.planSummary(plan.requestedDays, plan.scheduledStopCount)}</span><h1>{day.theme}</h1></div>
                <button onClick={() => setHasPlan(false)} type="button">{text.edit}</button>
              </header>

              <div className="planner-day-tabs" role="tablist">
                {plan.days.map((candidate, index) => <button aria-selected={activeDay === index} className={activeDay === index ? "is-active" : ""} key={candidate.label} onClick={() => setActiveDay(index)} role="tab" type="button"><b>{index + 1}</b><span>{candidate.label}</span></button>)}
              </div>

              {placeWarning ? <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.placeFallback}</p> : null}

              <section className="planner-day-summary">
                <div><span>{day.date || day.label}</span><b>{day.startTime}—{day.finishTime}</b></div>
                <small>{text.estimated}</small>
              </section>

              <ol className="planner-timeline">
                {day.stops.map((builtStop, index) => {
                  const leg = index > 0 ? day.legs[index - 1] : null;
                  const recommended = leg?.comparison.recommended;
                  return (
                    <li key={`${builtStop.stop.id}-${index}`}>
                      {leg && recommended ? <div className="planner-leg"><span aria-hidden="true">{modeIcon(recommended.mode)}</span><b>{text.move[recommended.mode]}</b><small>{recommended.minutes} min</small></div> : null}
                      <article>
                        <time>{builtStop.arrival}</time>
                        <span className="planner-stop-dot">{index + 1}</span>
                        <div><h2>{builtStop.stop.name}</h2><p>{builtStop.stop.area}</p><small>{builtStop.departure !== builtStop.arrival ? `${text.stay} ${builtStop.arrival}–${builtStop.departure}` : ""}</small></div>
                        <div className="planner-stop-tags">{builtStop.fixedTime ? <span>{text.reservation}</span> : null}{builtStop.priority === "must" ? <span>{text.must}</span> : builtStop.priority === "optional" ? <span>{text.optional}</span> : null}</div>
                      </article>
                    </li>
                  );
                })}
              </ol>

              {plan.foodRecommendationSlots.filter((slot) => slot.dayIndex === activeDay).map((slot) => {
                const foodState = foodSearches[slot.id] ?? { status: "idle", query: slot.queryIdeas[0], candidates: [] };
                const broadLink = foodSearchLinks(foodState.query, slot.area, locale).googleMaps;
                return (
                  <section className="planner-food" key={slot.id}>
                    <header><div><span>FOOD · {slot.window}</span><h2>{text.mealIdeas}</h2></div><small>{slot.area}</small></header>
                    <p>{text.foodNote}</p>
                    <div className="planner-food-chips">{slot.queryIdeas.map((query) => <button className={foodState.query === query ? "is-active" : ""} disabled={foodState.status === "loading"} key={query} onClick={() => findFood(slot, query)} type="button">{query}</button>)}</div>
                    {foodState.status === "loading" ? <p className="planner-food-status" role="status">{text.foodLoading}</p> : null}
                    {foodState.status === "unavailable" ? <p className="planner-food-status">{text.foodUnavailable} <a href={broadLink} rel="noreferrer" target="_blank">Google Maps ↗</a></p> : null}
                    {foodState.status === "ready" ? <div className="planner-food-results">{foodState.candidates.map((candidate) => (
                      <article key={candidate.id}>
                        <a className="planner-food-image" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
                          {candidate.photoName ? <>
                            {/* Google place photos are short-lived, server-proxied URLs and cannot use a static Next image allowlist. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt={candidate.name} loading="lazy" src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
                          </> : <span aria-hidden="true">🍽</span>}
                        </a>
                        <div><small>{candidate.type}</small><h3>{candidate.name}</h3><p>{candidate.address}</p>{candidate.photoAttribution ? <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">Photo: {candidate.photoAttribution.name}</a> : null}</div>
                        <a className="planner-food-map" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">{text.maps}<span aria-hidden="true">↗</span></a>
                      </article>
                    ))}</div> : null}
                  </section>
                );
              })}

              {plan.unknownEntries.length > 0 ? <details className="planner-unknown"><summary>{text.unknown} · {plan.unknownEntries.length}</summary><ul>{plan.unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul></details> : null}
            </div>
          ) : (
            <div className="planner-form-view"><p className="planner-warning">{text.placeFallback}</p><button className="planner-build-button" onClick={() => setHasPlan(false)} type="button"><span>{text.edit}</span><b>→</b></button></div>
          )}
        </section>

        <section className="planner-map-pane" aria-label={text.mapReady}>
          <iframe
            allowFullScreen
            key={`${activeDay}-${mapStops.map((stop) => stop.id).join("-") || "japan"}`}
            referrerPolicy="strict-origin-when-cross-origin"
            src={`/api/map-embed?${mapParams.toString()}`}
            title={day ? `${day.label} · Google Maps` : text.japanOverview}
          />
          <div className="planner-map-topline">
            <span className="planner-map-provider"><i aria-hidden="true" />{text.mapReady}</span>
            <strong>{day ? `${day.label} · ${day.theme}` : text.japanOverview}</strong>
          </div>
          {!day ? <div className="planner-map-empty"><span aria-hidden="true">⌖</span><p>{text.mapEmpty}</p></div> : null}
          {day ? <div className="planner-map-bottom">
            <div className="planner-map-route-summary">
              {plan?.selectedBase ? <span><i className="is-hotel" aria-hidden="true">H</i>{plan.selectedBase.name}</span> : null}
              {day.stops.slice(0, 4).map(({ stop }, index) => <span key={stop.id}><i aria-hidden="true">{index + 1}</i>{stop.name}</span>)}
            </div>
            {day.googleMapsUrl ? <a href={day.googleMapsUrl} rel="noreferrer" target="_blank">{text.openMaps}<span aria-hidden="true">↗</span></a> : null}
          </div> : null}
        </section>
      </div>
    </main>
  );
}
