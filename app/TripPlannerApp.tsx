"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlannerGoogleMap, { type FoodPin } from "./PlannerGoogleMap";
import { foodSearchLinks, requestFoodRanking, requestFoodRecommendations } from "../lib/food-recommendations-client";
import type { FoodCandidate } from "../lib/google-food";
import { fullTripDemo } from "../lib/mock-trip";
import { requestFreshVoices, requestPlaceIntelligence } from "../lib/place-intelligence-client";
import type { FreshVoicesResult } from "../lib/fresh-voices";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence";
import { PlaceResolutionError, requestPlaceResolution } from "../lib/place-resolution-client";
import type { ResolvedInputStop, RouteStop } from "../lib/route-optimizer";
import type { Pace } from "../lib/trip-analysis";
import { buildTripFromWishlist, type AirportCode, type FoodRecommendationSlot, type MealPlan } from "../lib/trip-builder";

type PlannerLocale = "en" | "ja";
type FoodState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  query: string;
  candidates: FoodCandidate[];
  notes: Record<string, { reason: string; tag: string }>;
};
type IntelligenceState = {
  status: "loading" | "ready" | "unavailable";
  result: PlaceIntelligenceResult | null;
};
type FreshState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  result: FreshVoicesResult | null;
};
type Inspector = { kind: "stop"; stopId: string } | { kind: "food"; slotId: string } | null;

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
    brandNote: "日本の旅プランナー",
    newTrip: "新しい旅",
    headline: "どこへ行きたい？",
    subhead: "行きたい場所を、思いつくまま入れてください。近い場所を同じ日にまとめて、地図に一日の流れを描きます。",
    inputLabel: "行きたい場所",
    placeholder: "例）\n浅草寺\nチームラボプラネッツ — 1日目 15:30 予約\n三鷹の森ジブリ美術館 — 必須\n渋谷スカイ — 時間があれば",
    sample: "サンプルを見る",
    days: "日数",
    date: "初日",
    hotel: "ホテル・最寄り駅",
    hotelPlaceholder: "例：新宿駅近く",
    details: "空港・ペース・食事の設定",
    arrival: "到着空港",
    arrivalTime: "到着時刻",
    departure: "出発空港",
    departureTime: "出発時刻",
    pace: "旅のペース",
    meal: "食事の提案",
    relaxed: "ゆったり",
    balanced: "標準",
    fast: "たくさん回る",
    allMeals: "昼・夜",
    dinner: "夜だけ",
    noMeals: "表示しない",
    build: "地図にする",
    building: "場所を確認しています…",
    mapReady: "Googleマップ",
    mapEmpty: "行き先を入れると、ここに旅が描かれます",
    edit: "入力にもどる",
    planSummary: (days: number, stops: number) => `${days}日間 · ${stops}か所`,
    openMaps: "Google Mapsで開く",
    stay: "滞在",
    move: { walk: "徒歩", transit: "電車", taxi: "タクシー" },
    minutes: (value: number) => `${value}分`,
    legLive: "実測",
    unknown: "地図に出せなかった場所",
    placeFallback: "見つからなかった場所があります。確認できた場所だけで組み立てています。",
    noDays: "地図に置ける場所がまだありません。名前を少し変えると見つかることがあります。",
    openDay: "この日はまだ予定がありません",
    selectHint: "ピンや行き先をタップすると、詳しい情報が開きます",
    mealIdeas: "この近くで食べるなら",
    lunchChip: "昼ごはん",
    dinnerChip: "夜ごはん",
    foodLoading: "近くのお店を探しています…",
    foodUnavailable: "お店を取得できませんでした。Google Mapsで同じ条件を開けます。",
    maps: "地図で見る",
    foodNote: "予定には固定しません。気分で選べる近くの候補です。",
    reservation: "予約",
    must: "必須",
    optional: "任意",
    estimated: "移動時間は目安。Googleの実測が届くと自動でなじみます。",
    deadlineOver: (time: string) => `空港へ向かう目安 ${time} を超えています`,
    language: "言語",
    privacy: "旅程は保存されません",
    fieldCheck: "現地チェック",
    fieldChecking: "確認中…",
    fieldChecked: "確認済み",
    fieldRetry: "再試行",
    fieldUnavailable: "現地情報を取得できませんでした。出発前に公式情報の確認を。",
    fieldEvidence: "いまの現地シグナル",
    openNow: "営業中の表示",
    closedNow: "営業時間外の表示",
    hoursUnknown: "営業時間は不明",
    cashOnly: "現金のみ",
    cardsAccepted: "カード可",
    paymentUnknown: "支払い情報なし",
    noWebsite: "公式サイト未掲載",
    recentVoices: "最近の口コミ（生の声）",
    freshHeading: "ネットの近況",
    freshLoading: "公開情報を探しています…",
    freshEmpty: "90日以内と確認できる公開情報は見つかりませんでした。日付不明の情報も無理に最新扱いしません。",
    freshUnavailable: "いまは最新情報を確認できませんでした。Google Mapsや公式情報も確認してください。",
    freshSource: { social: "SNS", news: "ニュース", blog: "体験記", web: "公開情報" },
    freshAgeUnknown: "更新日不明",
    freshCheckedAt: "確認",
    freshAiRole: "AIは公開情報の検索・要約だけ。日程と移動はルール計算です。",
    official: "公式サイト",
    latestX: "Xで最新の声",
    instagram: "Instagramで探す",
    aiAudited: "Claudeが根拠だけを要約",
    rulesAudited: "取得情報を自動整理",
    crowd: { quiet: "静かめ", moderate: "ふつう", busy: "混みやすい", veryBusy: "かなり混む" },
    crowdWeekend: "・週末",
    close: "閉じる",
  },
  en: {
    brandNote: "Japan trip planner",
    newTrip: "New trip",
    headline: "Where do you want to go?",
    subhead: "Drop in places as they come to mind. We group what's near, then draw each day on the map.",
    inputLabel: "Places you want to visit",
    placeholder: "Example\nSenso-ji\nteamLab Planets — Day 1 15:30 booked\nGhibli Museum — must\nShibuya Sky — optional",
    sample: "Try a sample",
    days: "Days",
    date: "First day",
    hotel: "Hotel or nearest station",
    hotelPlaceholder: "e.g. near Shinjuku Station",
    details: "Airports, pace and meals",
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
    build: "Put it on the map",
    building: "Checking your places…",
    mapReady: "Google Maps",
    mapEmpty: "Your trip will appear here",
    edit: "Back to input",
    planSummary: (days: number, stops: number) => `${days} days · ${stops} places`,
    openMaps: "Open in Google Maps",
    stay: "Stay",
    move: { walk: "Walk", transit: "Train", taxi: "Taxi" },
    minutes: (value: number) => `${value} min`,
    legLive: "live",
    unknown: "Not shown on the map",
    placeFallback: "Some places could not be found. The plan uses only the ones we could confirm.",
    noDays: "Nothing could be placed on the map yet. A slightly different name often helps.",
    openDay: "Nothing planned for this day yet",
    selectHint: "Tap a pin or a stop to open details",
    mealIdeas: "Food near this route",
    lunchChip: "Lunch",
    dinnerChip: "Dinner",
    foodLoading: "Finding nearby places…",
    foodUnavailable: "Places did not load. Open the same search in Google Maps instead.",
    maps: "View on map",
    foodNote: "Nothing gets locked in — just easy options near your route.",
    reservation: "Booked",
    must: "Must",
    optional: "Optional",
    estimated: "Times are estimates — live Google routes blend in automatically.",
    deadlineOver: (time: string) => `Runs past the ${time} airport cutoff`,
    language: "Language",
    privacy: "Nothing is saved",
    fieldCheck: "Reality check",
    fieldChecking: "Checking…",
    fieldChecked: "Checked",
    fieldRetry: "Try again",
    fieldUnavailable: "Live info did not load. Recheck the official source before you go.",
    fieldEvidence: "On-the-ground signals",
    openNow: "Listed open now",
    closedNow: "Listed closed now",
    hoursUnknown: "Hours unknown",
    cashOnly: "Cash only",
    cardsAccepted: "Cards accepted",
    paymentUnknown: "Payment unknown",
    noWebsite: "No official site",
    recentVoices: "Recent reviews — real voices",
    freshHeading: "Latest public signals",
    freshLoading: "Searching public sources…",
    freshEmpty: "No public source could be verified as updated within 90 days. Undated pages are not presented as recent.",
    freshUnavailable: "Fresh sources are unavailable right now. Recheck Google Maps and the official source.",
    freshSource: { social: "Social", news: "News", blog: "Firsthand", web: "Web" },
    freshAgeUnknown: "Date unknown",
    freshCheckedAt: "Checked",
    freshAiRole: "AI is used only to search and summarize public sources. Schedule and routing use rules.",
    official: "Official site",
    latestX: "Latest on X",
    instagram: "Search Instagram",
    aiAudited: "Evidence summarized by Claude",
    rulesAudited: "Evidence organized automatically",
    crowd: { quiet: "Quiet", moderate: "Steady", busy: "Busy", veryBusy: "Very busy" },
    crowdWeekend: " · weekend",
    close: "Close",
  },
} as const;

function modeIcon(mode: "walk" | "transit" | "taxi") {
  if (mode === "walk") return "🚶";
  if (mode === "taxi") return "🚕";
  return "🚃";
}

function googleMapsSearchUrl(stop: RouteStop) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name} ${stop.area}`)}`;
}

function formatCheckedAt(value: string, locale: PlannerLocale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function TripPlannerApp({ initialLocale = "en", mapsApiKey = "" }: { initialLocale?: PlannerLocale; mapsApiKey?: string }) {
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
  const [inspector, setInspector] = useState<Inspector>(null);
  const [liveTransit, setLiveTransit] = useState<Record<string, number>>({});
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodState>>({});
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceState>>({});
  const [freshVoices, setFreshVoices] = useState<Record<string, FreshState>>({});
  const text = ui[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.remove("cursor-visible", "motion-ready");
    try { window.localStorage.setItem("tripcheck-locale", locale); } catch { /* optional */ }
  }, [locale]);

  const plan = useMemo(() => hasPlan ? buildTripFromWishlist(itinerary, tripDays, pace, locale, {
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
    liveTransitMinutes: liveTransit,
  }) : null, [arrivalAirport, arrivalTime, departureAirport, departureTime, hasPlan, hotelQuery, itinerary, liveTransit, locale, mealPlan, pace, resolvedBase, resolvedStops, tripDays, tripStartDate]);

  const day = plan?.days[activeDay] ?? null;
  const base = day ? plan?.selectedBase ?? null : null;
  const mapStops = useMemo(() => day ? day.stops.map(({ stop }) => stop) : [], [day]);
  const routeDepartureTimes = useMemo(() => {
    if (!day?.date || mapStops.length === 0) return [];
    const stopDeparture = (index: number) => day.stops[index]?.departure ?? day.finishTime;
    const times: string[] = [];
    if (base) {
      times.push(day.startTime);
      for (let index = 0; index < mapStops.length; index += 1) times.push(stopDeparture(index));
    } else {
      for (let index = 0; index < mapStops.length - 1; index += 1) times.push(stopDeparture(index));
    }
    return times.map((time) => `${day.date}T${time}:00+09:00`);
  }, [base, day, mapStops]);
  const routeModes = useMemo(() => {
    if (!day || mapStops.length < 2) return base && mapStops.length === 1 ? ["transit" as const, "transit" as const] : [];
    const betweenStops = day.legs.map((leg) => leg.comparison.recommended.mode);
    return base ? ["transit" as const, ...betweenStops, "transit" as const] : betweenStops;
  }, [base, day, mapStops.length]);

  const daySlots = useMemo(
    () => plan?.foodRecommendationSlots.filter((slot) => slot.dayIndex === activeDay) ?? [],
    [activeDay, plan],
  );
  const selectedBuiltStop = inspector?.kind === "stop" && day
    ? day.stops.find(({ stop }) => stop.id === inspector.stopId) ?? null
    : null;
  const selectedStopIndex = inspector?.kind === "stop" && day
    ? day.stops.findIndex(({ stop }) => stop.id === inspector.stopId)
    : -1;
  const activeFoodSlot = inspector?.kind === "food"
    ? daySlots.find((slot) => slot.id === inspector.slotId) ?? null
    : null;
  const activeFoodState = useMemo<FoodState | null>(() => activeFoodSlot
    ? foodSearches[activeFoodSlot.id] ?? { status: "idle", query: activeFoodSlot.queryIdeas[0], candidates: [], notes: {} }
    : null, [activeFoodSlot, foodSearches]);
  const foodPins = useMemo<FoodPin[]>(() => {
    if (!activeFoodSlot || !activeFoodState || activeFoodState.status !== "ready") return [];
    return activeFoodState.candidates.flatMap((candidate, index) => (
      typeof candidate.latitude === "number" && typeof candidate.longitude === "number"
        ? [{ id: candidate.id, name: candidate.name, latitude: candidate.latitude, longitude: candidate.longitude, index }]
        : []
    ));
  }, [activeFoodSlot, activeFoodState]);

  const canBuild = itinerary.trim().length >= 3 && !isBuilding;

  const handleLegDurations = useCallback((incoming: Record<string, number>) => {
    setLiveTransit((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, minutes] of Object.entries(incoming)) {
        if (key in next) continue;
        next[key] = minutes;
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const handleSelectStop = useCallback((stopId: string | null) => {
    setInspector(stopId ? { kind: "stop", stopId } : null);
  }, []);

  function changeLocale(next: PlannerLocale) {
    setLocale(next);
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
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
    setInspector(null);
    setIntelligence({});
    setFreshVoices({});
    setHasPlan(true);
  }

  async function buildPlan() {
    if (!canBuild) return;
    setIsBuilding(true);
    setPlaceWarning(false);
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
    setInspector(null);
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
    setIntelligence({});
    setFreshVoices({});
    setLiveTransit({});
    setInspector(null);
    setHasPlan(false);
    setPlaceWarning(false);
    setActiveDay(0);
  }

  function switchDay(index: number) {
    setActiveDay(index);
    setInspector(null);
  }

  async function findFood(slot: FoodRecommendationSlot, query: string) {
    setInspector({ kind: "food", slotId: slot.id });
    setFoodSearches((current) => ({ ...current, [slot.id]: { status: "loading", query, candidates: [], notes: {} } }));
    try {
      const response = await requestFoodRecommendations(slot, query, locale);
      setFoodSearches((current) => ({ ...current, [slot.id]: { status: "ready", query, candidates: response.candidates, notes: {} } }));
      if (response.candidates.length > 1) {
        void requestFoodRanking(slot, query, response.candidates, locale).then((ranking) => {
          setFoodSearches((current) => {
            const entry = current[slot.id];
            if (!entry || entry.status !== "ready" || entry.query !== query) return current;
            const order = new Map(ranking.ranked.map((item, index) => [item.id, index]));
            const candidates = [...entry.candidates].sort(
              (a, b) => (order.get(a.id) ?? ranking.ranked.length) - (order.get(b.id) ?? ranking.ranked.length),
            );
            const notes = Object.fromEntries(ranking.ranked.map((item) => [item.id, { reason: item.reason, tag: item.tag }]));
            return { ...current, [slot.id]: { ...entry, candidates, notes } };
          });
        }).catch(() => { /* ranking is optional garnish */ });
      }
    } catch {
      setFoodSearches((current) => ({ ...current, [slot.id]: { status: "unavailable", query, candidates: [], notes: {} } }));
    }
  }

  function openFoodSlot(slot: FoodRecommendationSlot) {
    if (inspector?.kind === "food" && inspector.slotId === slot.id) {
      setInspector(null);
      return;
    }
    const state = foodSearches[slot.id];
    if (!state || state.status === "idle") {
      void findFood(slot, slot.queryIdeas[0]);
      return;
    }
    setInspector({ kind: "food", slotId: slot.id });
  }

  async function checkPlace(stop: RouteStop) {
    const cachedIntel = intelligence[stop.id];
    const cachedFresh = freshVoices[stop.id];
    if (cachedIntel?.status === "loading" || cachedFresh?.status === "loading") return;
    if (cachedIntel?.status === "ready" && cachedFresh?.status === "ready") return;

    let placeResult = cachedIntel?.status === "ready" ? cachedIntel.result : null;
    if (!placeResult) {
      setIntelligence((current) => ({ ...current, [stop.id]: { status: "loading", result: null } }));
      try {
        placeResult = await requestPlaceIntelligence(stop, locale);
        setIntelligence((current) => ({ ...current, [stop.id]: { status: "ready", result: placeResult } }));
      } catch {
        setIntelligence((current) => ({ ...current, [stop.id]: { status: "unavailable", result: null } }));
        return;
      }
    }

    if (cachedFresh?.status === "ready") return;
    setFreshVoices((current) => ({ ...current, [stop.id]: { status: "loading", result: null } }));
    try {
      const result = await requestFreshVoices({
        name: placeResult.place.name,
        area: placeResult.place.address.slice(0, 100) || stop.area,
      }, locale);
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "ready", result } }));
    } catch {
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "unavailable", result: null } }));
    }
  }

  const selectedIntel = selectedBuiltStop ? intelligence[selectedBuiltStop.stop.id] : undefined;
  const selectedFresh = selectedBuiltStop ? freshVoices[selectedBuiltStop.stop.id] : undefined;
  const selectedCheckLoading = selectedIntel?.status === "loading" || selectedFresh?.status === "loading";
  const selectedCheckReady = selectedIntel?.status === "ready" && selectedFresh?.status === "ready";
  const selectedCheckRetry = selectedIntel?.status === "unavailable" || selectedFresh?.status === "unavailable";

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
            <button aria-pressed={locale === "ja"} className={locale === "ja" ? "is-active" : ""} onClick={() => changeLocale("ja")} type="button">日本語</button>
            <button aria-pressed={locale === "en"} className={locale === "en" ? "is-active" : ""} onClick={() => changeLocale("en")} type="button">EN</button>
          </div>
          {hasPlan ? <button className="planner-new-trip" onClick={resetTrip} type="button"><span aria-hidden="true">＋</span>{text.newTrip}</button> : null}
        </div>
      </header>

      <div className="planner-map-canvas" aria-label={text.mapReady}>
        <PlannerGoogleMap
          apiKey={mapsApiKey}
          base={base}
          departureTimes={routeDepartureTimes}
          foodPins={foodPins}
          locale={locale}
          onLegDurations={handleLegDurations}
          onSelectStop={handleSelectStop}
          routeModes={routeModes}
          selectedStopId={inspector?.kind === "stop" ? inspector.stopId : null}
          stops={mapStops}
        />

        {!day && !hasPlan ? <div className="planner-map-empty"><span aria-hidden="true">⌖</span><p>{text.mapEmpty}</p></div> : null}

        {day ? (
          <div className="planner-map-bottom">
            {daySlots.map((slot) => (
              <button
                className={`planner-meal-chip${inspector?.kind === "food" && inspector.slotId === slot.id ? " is-active" : ""}`}
                key={slot.id}
                onClick={() => openFoodSlot(slot)}
                type="button"
              >
                <span aria-hidden="true">{slot.kind === "lunch" ? "☀️" : "🌙"}</span>
                {slot.kind === "lunch" ? text.lunchChip : text.dinnerChip}
              </button>
            ))}
            {day.googleMapsUrl ? (
              <a className="planner-open-maps" href={day.googleMapsUrl} rel="noreferrer" target="_blank">
                {text.openMaps}<span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </div>
        ) : null}

        {selectedBuiltStop ? (
          <aside className="planner-inspector" aria-label={selectedBuiltStop.stop.name}>
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}>✕</button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num">{selectedStopIndex + 1}</span>
              <div>
                <h2>{selectedBuiltStop.stop.name}</h2>
                <p>{selectedBuiltStop.stop.area}</p>
              </div>
            </header>
            <div className="planner-inspector-meta">
              <span>{selectedBuiltStop.arrival}–{selectedBuiltStop.departure}</span>
              {selectedBuiltStop.fixedTime ? <span className="is-booked">{text.reservation} {selectedBuiltStop.fixedTime}</span> : null}
              {selectedBuiltStop.priority === "must" ? <span className="is-must">{text.must}</span> : null}
              {selectedBuiltStop.priority === "optional" ? <span className="is-optional">{text.optional}</span> : null}
              {selectedBuiltStop.crowd ? (
                <span className="is-crowd">
                  {text.crowd[selectedBuiltStop.crowd.level]}{selectedBuiltStop.crowd.isWeekend ? text.crowdWeekend : ""}
                </span>
              ) : null}
            </div>
            <div className="planner-inspector-actions">
              <button
                className="planner-check-button"
                disabled={selectedCheckLoading || selectedCheckReady}
                onClick={() => checkPlace(selectedBuiltStop.stop)}
                type="button"
              >
                <i aria-hidden="true" />{selectedCheckLoading ? text.fieldChecking : selectedCheckReady ? text.fieldChecked : selectedCheckRetry ? text.fieldRetry : text.fieldCheck}
              </button>
              <a href={googleMapsSearchUrl(selectedBuiltStop.stop)} rel="noreferrer" target="_blank">Google Maps ↗</a>
            </div>

            {selectedIntel?.status === "unavailable" ? <p className="planner-intel-unavailable" role="status">{text.fieldUnavailable}</p> : null}
            {selectedIntel?.status === "ready" && selectedIntel.result ? (() => {
              const intel = selectedIntel.result;
              return (
                <section className="planner-intel-card" aria-label={`${selectedBuiltStop.stop.name} · ${text.fieldEvidence}`}>
                  <header>
                    <h3>{text.fieldEvidence}</h3>
                    <small>{intel.analyzedBy === "anthropic" ? text.aiAudited : text.rulesAudited}</small>
                  </header>
                  <div className="planner-intel-facts">
                    <span className={intel.place.openNow === false ? "is-warning" : ""}>
                      {intel.place.openNow === true ? text.openNow : intel.place.openNow === false ? text.closedNow : text.hoursUnknown}
                    </span>
                    <span className={intel.place.payment.cashOnly === true ? "is-warning" : ""}>
                      {intel.place.payment.cashOnly === true ? text.cashOnly : intel.place.payment.creditCards === true ? text.cardsAccepted : text.paymentUnknown}
                    </span>
                    {intel.place.websiteUrl === null ? <span className="is-warning">{text.noWebsite}</span> : null}
                    {intel.place.rating !== null ? (
                      <span>★ {intel.place.rating.toFixed(1)} · {intel.place.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span>
                    ) : null}
                  </div>
                  <p className="planner-intel-summary">{intel.analysis.summary}</p>
                  {intel.analysis.signals.length > 0 ? (
                    <ul className="planner-intel-signals">
                      {intel.analysis.signals.map((signal, signalIndex) => (
                        <li className={`is-${signal.severity}`} key={`${signal.kind}-${signalIndex}`}>
                          <i aria-hidden="true" />
                          <div><b>{signal.title}</b><p>{signal.detail}</p><small>{signal.evidence}</small></div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {intel.reviews.length > 0 ? (
                    <div className="planner-intel-reviews">
                      <h4>{text.recentVoices}</h4>
                      {intel.reviews.slice(0, 2).map((review, reviewIndex) => (
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
                    <a href={intel.links.x} rel="noreferrer" target="_blank">{text.latestX} ↗</a>
                    <a href={intel.links.instagram} rel="noreferrer" target="_blank">{text.instagram} ↗</a>
                    {intel.place.websiteUrl ? <a href={intel.place.websiteUrl} rel="noreferrer" target="_blank">{text.official} ↗</a> : null}
                    <a href={intel.place.googleMapsUrl} rel="noreferrer" target="_blank">Google Maps ↗</a>
                  </div>
                </section>
              );
            })() : null}

            {selectedFresh?.status === "loading" ? (
              <section className="planner-fresh-card is-loading" aria-live="polite">
                <header><span aria-hidden="true">◎</span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
                <p className="planner-fresh-status"><i aria-hidden="true" />{text.freshLoading}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "unavailable" ? (
              <section className="planner-fresh-card" aria-live="polite">
                <header><span aria-hidden="true">◎</span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
                <p className="planner-fresh-empty">{text.freshUnavailable}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "ready" && selectedFresh.result ? (() => {
              const fresh = selectedFresh.result;
              return (
                <section className="planner-fresh-card" aria-label={`${selectedBuiltStop.stop.name} · ${text.freshHeading}`}>
                  <header>
                    <span aria-hidden="true">◎</span>
                    <div>
                      <h3>{text.freshHeading}</h3>
                      <small>{text.freshCheckedAt} {formatCheckedAt(fresh.checkedAt, locale)} · {text.freshAiRole}</small>
                    </div>
                  </header>
                  {fresh.summary ? <p className="planner-fresh-summary">{fresh.summary}</p> : null}
                  {fresh.findings.length > 0 ? (
                    <div className="planner-fresh-list">
                      {fresh.findings.map((finding) => (
                        <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                          <div>
                            <span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span>
                            <small>{finding.age ?? text.freshAgeUnknown}</small>
                          </div>
                          <b>{finding.title}</b>
                          <p>{finding.note}</p>
                          <i aria-hidden="true">↗</i>
                        </a>
                      ))}
                    </div>
                  ) : <p className="planner-fresh-empty">{text.freshEmpty}</p>}
                </section>
              );
            })() : null}
          </aside>
        ) : null}

        {activeFoodSlot && activeFoodState ? (
          <aside className="planner-inspector is-food" aria-label={text.mealIdeas}>
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}>✕</button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-food" aria-hidden="true">{activeFoodSlot.kind === "lunch" ? "☀️" : "🌙"}</span>
              <div>
                <h2>{text.mealIdeas}</h2>
                <p>{activeFoodSlot.area} · {activeFoodSlot.window}</p>
              </div>
            </header>
            <p className="planner-food-rationale">{activeFoodSlot.rationale}</p>
            <div className="planner-food-chips">
              {activeFoodSlot.queryIdeas.map((query) => (
                <button
                  className={activeFoodState.query === query ? "is-active" : ""}
                  disabled={activeFoodState.status === "loading"}
                  key={query}
                  onClick={() => findFood(activeFoodSlot, query)}
                  type="button"
                >
                  {query}
                </button>
              ))}
            </div>
            {activeFoodState.status === "loading" ? <p className="planner-food-status" role="status">{text.foodLoading}</p> : null}
            {activeFoodState.status === "unavailable" ? (
              <p className="planner-food-status">
                {text.foodUnavailable}{" "}
                <a href={foodSearchLinks(activeFoodState.query, activeFoodSlot.area, locale).googleMaps} rel="noreferrer" target="_blank">Google Maps ↗</a>
              </p>
            ) : null}
            {activeFoodState.status === "ready" ? (
              <div className="planner-food-results">
                {activeFoodState.candidates.map((candidate, index) => {
                  const note = activeFoodState.notes[candidate.id];
                  return (
                    <article key={candidate.id}>
                      <a className="planner-food-image" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
                        {candidate.photoName ? <>
                          {/* Google place photos are short-lived, server-proxied URLs and cannot use a static Next image allowlist. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={candidate.name} loading="lazy" src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
                        </> : <span aria-hidden="true">🍽</span>}
                        <i className="planner-food-badge">{index + 1}</i>
                      </a>
                      <div>
                        <small>{note?.tag ?? candidate.type}</small>
                        <h3>{candidate.name}</h3>
                        <p>{note?.reason ?? candidate.address}</p>
                        {candidate.photoAttribution ? (
                          <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">Photo: {candidate.photoAttribution.name}</a>
                        ) : null}
                      </div>
                      <a className="planner-food-map" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">{text.maps}<span aria-hidden="true">↗</span></a>
                    </article>
                  );
                })}
                <p className="planner-food-note">{text.foodNote}</p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      <section className="planner-sheet">
        {!hasPlan ? (
          <div className="planner-form-view">
            <div className="planner-intro">
              <h1>{text.headline}</h1>
              <p>{text.subhead}</p>
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
              <div>
                <span>{text.planSummary(plan.requestedDays, plan.scheduledStopCount)}</span>
                <h1>{day.theme}</h1>
              </div>
              <button onClick={() => { setHasPlan(false); setInspector(null); }} type="button">{text.edit}</button>
            </header>

            <div className="planner-day-tabs" aria-label={locale === "ja" ? "日程を選ぶ" : "Choose a day"}>
              {plan.days.map((candidate, index) => (
                <button
                  aria-pressed={activeDay === index}
                  className={activeDay === index ? "is-active" : ""}
                  key={candidate.label}
                  onClick={() => switchDay(index)}
                  type="button"
                >
                  <b>{index + 1}</b><span>{candidate.date ? candidate.date.slice(5).replace("-", "/") : candidate.label}</span>
                </button>
              ))}
            </div>

            {placeWarning ? <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.placeFallback}</p> : null}

            <section className="planner-day-summary">
              <div>
                <span>{day.date || day.label}</span>
                <b>{day.startTime}—{day.finishTime}</b>
              </div>
              {day.deadlineOverrunMinutes > 0 && day.deadline ? <em>{text.deadlineOver(day.deadline)}</em> : <small>{text.estimated}</small>}
            </section>

            {day.stops.length === 0 ? <p className="planner-open-day">{text.openDay}</p> : (
              <ol className="planner-timeline">
                {day.stops.map((builtStop, index) => {
                  const leg = index > 0 ? day.legs[index - 1] : null;
                  const recommended = leg?.comparison.recommended;
                  const checked = intelligence[builtStop.stop.id]?.status === "ready";
                  const isSelected = inspector?.kind === "stop" && inspector.stopId === builtStop.stop.id;
                  return (
                    <li key={`${builtStop.stop.id}-${index}`}>
                      {leg && recommended ? (
                        <div className="planner-leg">
                          <span aria-hidden="true">{modeIcon(recommended.mode)}</span>
                          <b>{text.move[recommended.mode]} {text.minutes(recommended.minutes)}</b>
                          {recommended.source === "live" ? <em>{text.legLive}</em> : null}
                        </div>
                      ) : null}
                      <button
                        className={`planner-stop-row${isSelected ? " is-selected" : ""}`}
                        onClick={() => setInspector(isSelected ? null : { kind: "stop", stopId: builtStop.stop.id })}
                        type="button"
                      >
                        <time>{builtStop.arrival}</time>
                        <span className="planner-stop-dot">{index + 1}</span>
                        <span className="planner-stop-main">
                          <b>{builtStop.stop.name}</b>
                          <small>{builtStop.stop.area}</small>
                        </span>
                        <span className="planner-stop-flags">
                          {builtStop.fixedTime ? <i className="is-booked">{builtStop.fixedTime}</i> : null}
                          {builtStop.priority === "must" ? <i className="is-must">{text.must}</i> : null}
                          {builtStop.priority === "optional" ? <i className="is-optional">{text.optional}</i> : null}
                          {checked ? <i className="is-checked" aria-hidden="true">✓</i> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <p className="planner-select-hint">{text.selectHint}</p>

            {plan.unknownEntries.length > 0 ? (
              <details className="planner-unknown">
                <summary>{text.unknown} · {plan.unknownEntries.length}</summary>
                <ul>{plan.unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="planner-result-view">
            <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.noDays}</p>
            {plan && plan.unknownEntries.length > 0 ? (
              <details className="planner-unknown" open>
                <summary>{text.unknown} · {plan.unknownEntries.length}</summary>
                <ul>{plan.unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </details>
            ) : null}
            <button className="planner-build-button" onClick={() => setHasPlan(false)} type="button"><span>{text.edit}</span><b aria-hidden="true">→</b></button>
          </div>
        )}
      </section>
    </main>
  );
}
