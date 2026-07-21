"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlannerGoogleMap, { type FoodPin } from "./PlannerGoogleMap";
import {
  foodRecommendationRequestKey,
  foodSearchLinks,
  reconcileFoodRecommendationSlots,
  requestFoodRecommendations,
} from "../lib/food-recommendations-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../lib/google-food";
import { requestHotelRecommendations } from "../lib/hotel-recommendations-client";
import type { HotelCandidate } from "../lib/google-hotels";
import { fullTripDemo } from "../lib/mock-trip";
import { requestFreshVoices, requestPlaceIntelligence } from "../lib/place-intelligence-client";
import type { FreshVoicesResult } from "../lib/fresh-voices";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence";
import { googleOpeningWindowsForDate } from "../lib/google-opening-hours";
import { deriveStopPlanningEvidence } from "../lib/planning-evidence";
import { prefetchPlanningRouteDurations } from "../lib/planning-live-routes-client";
import { rankFoodWithPublicEvidence } from "../lib/public-evidence-ranking";
import { PlaceResolutionError, requestPlaceResolution } from "../lib/place-resolution-client";
import type { ResolvedInputStop, RouteStop } from "../lib/route-optimizer";
import type { Pace } from "../lib/trip-analysis";
import { buildTripFromWishlist, type AirportCode, type FoodRecommendationSlot, type MealPlan, type VisitWindow } from "../lib/trip-builder";

type PlannerLocale = "en" | "ja";
type FoodState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  query: string;
  candidates: FoodCandidate[];
  notes: Record<string, { reason: string; tag: string }>;
  fresh: Record<string, FreshState>;
};
type IntelligenceState = {
  status: "loading" | "ready" | "unavailable";
  result: PlaceIntelligenceResult | null;
};
type FreshState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  result: FreshVoicesResult | null;
};
type HotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  candidates: HotelCandidate[];
  selectedId: string | null;
  fresh: FreshState;
};
type BuildStage = "resolving" | "hotel" | "reviews" | "food" | "public" | "routes" | "scheduling";
type BuildProgress = {
  stage: BuildStage;
  current: number;
  total: number;
  reviewCount: number;
  publicCount: number;
};
type Inspector = { kind: "stop"; stopId: string } | { kind: "food"; slotId: string; candidateId?: string } | { kind: "hotel" } | null;

const emptyFreshState: FreshState = { status: "idle", result: null };
const emptyHotelState: HotelState = { status: "idle", candidates: [], selectedId: null, fresh: emptyFreshState };
const initialBuildProgress: BuildProgress = {
  stage: "resolving",
  current: 0,
  total: 0,
  reviewCount: 0,
  publicCount: 0,
};

function defaultTripDate() {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrow);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
  shouldStop?: () => boolean,
) {
  const results: Array<{ index: number; value: R }> = [];
  let cursor = 0;
  let completed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && !shouldStop?.()) {
      const index = cursor;
      cursor += 1;
      const value = await worker(items[index], index);
      if (shouldStop?.()) return;
      results.push({ index, value });
      completed += 1;
      onProgress?.(completed, items.length);
    }
  });
  await Promise.all(runners);
  return results.sort((a, b) => a.index - b.index).map(({ value }) => value);
}

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
    hotel: "ホテル名・泊まりたいエリア",
    hotelPlaceholder: "例：新宿駅近く（未定でもOK）",
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
    buildingTitle: "予定をつくっています",
    buildingBody: "口コミと公開SNSまで確認してから、最後にルートを確定します。",
    buildingCancel: "入力にもどる",
    buildSteps: {
      resolving: "場所を地図で確認",
      hotel: "実在するホテルを比較",
      reviews: "Googleの口コミ・営業情報を確認",
      food: "その土地で食べるべき店を比較",
      public: "Instagram・X・体験記の公開情報を確認",
      routes: "Googleの実経路と所要時間を確認",
      scheduling: "移動と現地情報から日程を確定",
    },
    progressPlaces: (current: number, total: number) => `${current}/${total}か所を確認`,
    progressReviews: (count: number) => `口コミ ${count}件を確認`,
    progressFood: (current: number, total: number) => `食事エリア ${current}/${total}`,
    progressPublic: (current: number, total: number, findings: number) => `公開検索 ${current}/${total} · 根拠 ${findings}件`,
    progressRoutes: (current: number, total: number) => `実測できた移動 ${current}/${total}`,
    progressScheduling: "混雑の明示情報は余白時間として反映します",
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
    mealIdeas: "この土地なら、まずこれ",
    lunchChip: "昼ごはん",
    dinnerChip: "夜ごはん",
    foodLoading: "近くのお店を探しています…",
    foodUnavailable: "お店を取得できませんでした。Google Mapsで同じ条件を開けます。",
    maps: "地図で見る",
    foodNote: "Googleの評価・口コミ量・距離・営業表示をロジックで比較。公開SNSは引用できた情報だけを補足しています。",
    foodFresh: (count: number) => `最近の公開情報 ${count}件`,
    hotelChip: "ホテル",
    hotelCandidate: "おすすめの実在ホテル",
    hotelAlternatives: "ほかの実在候補",
    hotelNoAvailability: "料金・空室は宿泊サイトで最終確認してください。",
    publicSources: "公開SNS・記事の出典",
    reviewReport: "口コミでの支払い報告",
    reservation: "予約",
    must: "必須",
    optional: "任意",
    estimated: "移動時間は目安。Googleの実測が届くと自動でなじみます。",
    openingAdjusted: "営業時間に合わせて訪問時刻を調整",
    openingConflict: "営業時間と予約時刻を再確認",
    unavailableStops: (count: number) => `休業・営業時間のため ${count}か所を予定から外しました`,
    publicEvidenceFound: (count: number) => `公開SNS・記事 ${count}件を反映`,
    publicEvidenceMissing: "公開SNSは確認できず、Google情報で作成",
    routeEvidenceFound: (count: number) => `Google実測 ${count}区間`,
    routeEvidenceMissing: "移動は推定値。日付・経路を要確認",
    walkingSafety: "徒歩経路はベータ版。安全状況は現地で確認してください。",
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
    plannedOpen: "食事時間に営業予定",
    closedNow: "営業時間外の表示",
    hoursUnknown: "営業時間は不明",
    cashOnly: "現金のみ",
    cardsAccepted: "カード可",
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
    hotel: "Hotel or preferred area",
    hotelPlaceholder: "e.g. near Shinjuku Station (optional)",
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
    buildingTitle: "Building your trip",
    buildingBody: "We check reviews and public social sources before locking the route.",
    buildingCancel: "Back to input",
    buildSteps: {
      resolving: "Confirm every place on the map",
      hotel: "Compare real hotels",
      reviews: "Check Google reviews and opening details",
      food: "Compare what is worth eating here",
      public: "Check public Instagram, X and firsthand posts",
      routes: "Check Google route times",
      scheduling: "Finalize the route from travel and local signals",
    },
    progressPlaces: (current: number, total: number) => `${current}/${total} places confirmed`,
    progressReviews: (count: number) => `${count} reviews checked`,
    progressFood: (current: number, total: number) => `${current}/${total} meal areas`,
    progressPublic: (current: number, total: number, findings: number) => `${current}/${total} public checks · ${findings} cited signals`,
    progressRoutes: (current: number, total: number) => `${current}/${total} route legs verified`,
    progressScheduling: "Explicit crowd signals become schedule buffer",
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
    mealIdeas: "Start with these local picks",
    lunchChip: "Lunch",
    dinnerChip: "Dinner",
    foodLoading: "Finding nearby places…",
    foodUnavailable: "Places did not load. Open the same search in Google Maps instead.",
    maps: "View on map",
    foodNote: "Ranked by Google rating strength, review volume, distance and open status. Public social evidence is shown only when a cited page was found.",
    foodFresh: (count: number) => `${count} recent public signals`,
    hotelChip: "Hotel",
    hotelCandidate: "Recommended real hotel",
    hotelAlternatives: "Other real options",
    hotelNoAvailability: "Confirm price and availability with a booking provider.",
    publicSources: "Public social and article sources",
    reviewReport: "Payment reported in a review",
    reservation: "Booked",
    must: "Must",
    optional: "Optional",
    estimated: "Times are estimates — live Google routes blend in automatically.",
    openingAdjusted: "Timed to verified opening hours",
    openingConflict: "Recheck opening hours and booking time",
    unavailableStops: (count: number) => `${count} place${count === 1 ? "" : "s"} left out for closure or opening hours`,
    publicEvidenceFound: (count: number) => `${count} cited public signals used`,
    publicEvidenceMissing: "Public social sources unavailable · built from Google evidence",
    routeEvidenceFound: (count: number) => `${count} Google-measured route legs`,
    routeEvidenceMissing: "Travel uses estimates · recheck date and route",
    walkingSafety: "Walking routes are beta. Check real-world safety conditions.",
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
    plannedOpen: "Open for this meal time",
    closedNow: "Listed closed now",
    hoursUnknown: "Hours unknown",
    cashOnly: "Cash only",
    cardsAccepted: "Cards accepted",
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

function paymentLabel(intel: PlaceIntelligenceResult, locale: PlannerLocale) {
  const payment = intel.place.payment;
  if (payment.cashOnly === true) return locale === "ja" ? "現金のみ（Google掲載）" : "Cash only · Google listing";
  if (payment.creditCards === true) return locale === "ja" ? "カード可（Google掲載）" : "Cards accepted · Google listing";
  const observations = payment.observations;
  if (observations.length === 0) return null;
  const hasConflict = observations.some((item) => item.method === "card" && item.accepted)
    && observations.some((item) => item.method === "card" && !item.accepted);
  if (hasConflict) return locale === "ja" ? "支払いの口コミが分かれています" : "Payment reports conflict";
  const observation = observations[0];
  if (observation.method === "cash") return locale === "ja" ? "口コミ: 現金のみとの報告" : "Review: cash only reported";
  if (observation.method === "card" && !observation.accepted) return locale === "ja" ? "口コミ: カード不可との報告" : "Review: cards not accepted";
  if (observation.method === "qr") return observation.accepted
    ? (locale === "ja" ? "口コミ: コード決済の利用報告" : "Review: code payment reported")
    : (locale === "ja" ? "口コミ: コード決済不可との報告" : "Review: code payment not accepted");
  if (observation.method === "transport_ic") return observation.accepted
    ? (locale === "ja" ? "口コミ: 交通系ICの利用報告" : "Review: transit IC reported")
    : (locale === "ja" ? "口コミ: 交通系IC不可との報告" : "Review: transit IC not accepted");
  return locale === "ja" ? "口コミ: カード利用の報告" : "Review: card payment reported";
}

function hotelAsResolvedBase(candidate: HotelCandidate, input: string, area: string, verifiedAt: string): ResolvedInputStop {
  return {
    id: `hotel-${candidate.id}`,
    input: input.trim() || candidate.name,
    name: candidate.name,
    area,
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    sourceUrl: candidate.googleMapsUrl,
    verifiedAt,
    confidence: "medium",
    planningDurationMinutes: 0,
    isAnchor: false,
  };
}

function normalizeHotelName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function isAreaLikeHotelQuery(value: string) {
  const query = value.normalize("NFKC").trim().toLowerCase();
  if (!query) return true;
  return /(?:周辺|近く|近辺|付近|エリア|界隈|あたり|駅前|駅のそば|のホテル|で泊まりたい|near\b|around\b|\barea\b|hotels?\s+(?:in|near)|(?:near|around)\s+.+\s+hotels?)/iu.test(query);
}

function shouldUseRecommendedHotel(query: string) {
  return !query.trim() || isAreaLikeHotelQuery(query);
}

function matchingHotelCandidate(resolved: ResolvedInputStop, candidates: HotelCandidate[]) {
  const resolvedName = normalizeHotelName(resolved.name);
  return candidates.find((candidate) => {
    const candidateName = normalizeHotelName(candidate.name);
    const namesMatch = resolvedName.length >= 3
      && candidateName.length >= 3
      && (resolvedName.includes(candidateName) || candidateName.includes(resolvedName));
    const latitudeDelta = candidate.latitude - resolved.latitude;
    const longitudeDelta = candidate.longitude - resolved.longitude;
    return namesMatch || latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta < 0.000004;
  }) ?? null;
}

const buildStageOrder: BuildStage[] = ["resolving", "hotel", "reviews", "food", "public", "routes", "scheduling"];

export default function TripPlannerApp({ initialLocale = "en", mapsApiKey = "" }: { initialLocale?: PlannerLocale; mapsApiKey?: string }) {
  const [locale, setLocale] = useState<PlannerLocale>(initialLocale);
  const [itinerary, setItinerary] = useState("");
  const [tripDays, setTripDays] = useState(3);
  const [tripStartDate, setTripStartDate] = useState(defaultTripDate);
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
  const [liveWalking, setLiveWalking] = useState<Record<string, number>>({});
  const [openingWindowsByDay, setOpeningWindowsByDay] = useState<Record<string, Record<number, VisitWindow[]>>>({});
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodState>>({});
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceState>>({});
  const [freshVoices, setFreshVoices] = useState<Record<string, FreshState>>({});
  const [hotelState, setHotelState] = useState<HotelState>(emptyHotelState);
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [earlyVisitStopIds, setEarlyVisitStopIds] = useState<string[]>([]);
  const [previewStops, setPreviewStops] = useState<RouteStop[]>([]);
  const [buildProgress, setBuildProgress] = useState<BuildProgress>(initialBuildProgress);
  const buildRunRef = useRef(0);
  const buildAbortRef = useRef<AbortController | null>(null);
  const text = ui[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.remove("cursor-visible", "motion-ready");
    try { window.localStorage.setItem("tripcheck-locale", locale); } catch { /* optional */ }
  }, [locale]);

  useEffect(() => {
    if (inspector?.kind !== "food" || !inspector.candidateId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>("[data-food-candidate]")]
        .find((element) => element.dataset.foodCandidate === inspector.candidateId);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspector]);

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
    durationOverrides,
    earlyVisitStopIds,
    liveTransitMinutes: liveTransit,
    liveWalkingMinutes: liveWalking,
    openingWindowsByDay,
  }) : null, [arrivalAirport, arrivalTime, departureAirport, departureTime, durationOverrides, earlyVisitStopIds, hasPlan, hotelQuery, itinerary, liveTransit, liveWalking, locale, mealPlan, openingWindowsByDay, pace, resolvedBase, resolvedStops, tripDays, tripStartDate]);

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
    ? foodSearches[activeFoodSlot.id] ?? { status: "idle", query: defaultFoodDiscoveryQuery(locale), candidates: [], notes: {}, fresh: {} }
    : null, [activeFoodSlot, foodSearches, locale]);
  const selectedHotel = hotelState.selectedId
    ? hotelState.candidates.find((candidate) => candidate.id === hotelState.selectedId) ?? null
    : null;
  const measuredRouteCount = useMemo(() => new Set([
    ...Object.keys(liveTransit),
    ...Object.keys(liveWalking),
  ]).size, [liveTransit, liveWalking]);
  const displayedMapStops = isBuilding ? previewStops : mapStops;
  const displayedMapBase = hasPlan ? base : null;
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

  const handleSelectFoodPin = useCallback((candidateId: string) => {
    if (!activeFoodSlot) return;
    setInspector({ kind: "food", slotId: activeFoodSlot.id, candidateId });
  }, [activeFoodSlot]);

  function changeLocale(next: PlannerLocale) {
    if (next === locale) return;
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    buildRunRef.current += 1;
    setIsBuilding(false);
    setHasPlan(false);
    setResolvedStops([]);
    setResolvedBase(null);
    setPreviewStops([]);
    setInspector(null);
    setLocale(next);
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setDurationOverrides({});
    setEarlyVisitStopIds([]);
    setLiveTransit({});
    setLiveWalking({});
    setOpeningWindowsByDay({});
    setPlaceWarning(false);
    setActiveDay(0);
    setBuildProgress(initialBuildProgress);
    window.history.replaceState({}, "", next === "ja" ? "/ja" : "/");
  }

  function loadDemo() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    buildRunRef.current += 1;
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
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setDurationOverrides({});
    setEarlyVisitStopIds([]);
    setPreviewStops([]);
    setLiveTransit({});
    setLiveWalking({});
    setOpeningWindowsByDay({});
    setBuildProgress(initialBuildProgress);
    setIsBuilding(false);
    setHasPlan(false);
  }

  async function buildPlan() {
    if (!canBuild) return;
    buildAbortRef.current?.abort();
    const controller = new AbortController();
    buildAbortRef.current = controller;
    const runId = ++buildRunRef.current;
    const cancelled = () => buildRunRef.current !== runId;
    const commit = (action: () => void) => {
      if (cancelled()) return false;
      action();
      return true;
    };
    if (!commit(() => {
      setIsBuilding(true);
      setHasPlan(false);
      setPlaceWarning(false);
      setFoodSearches({});
      setIntelligence({});
      setFreshVoices({});
      setHotelState({ ...emptyHotelState, status: "loading" });
      setDurationOverrides({});
      setEarlyVisitStopIds([]);
      setPreviewStops([]);
      setLiveTransit({});
      setLiveWalking({});
      setOpeningWindowsByDay({});
      setInspector(null);
      setBuildProgress(initialBuildProgress);
    })) return;

    let places: ResolvedInputStop[] = [];
    let resolvedHotel: ResolvedInputStop | null = null;
    try {
      const response = await requestPlaceResolution(itinerary, hotelQuery, locale, controller.signal);
      if (cancelled()) return;
      places = response.places;
      resolvedHotel = response.hotel;
      if (!commit(() => {
        setResolvedStops(places);
        setResolvedBase(resolvedHotel);
        setPreviewStops(places);
        setBuildProgress((current) => ({ ...current, current: places.length, total: Math.max(places.length, itinerary.split("\n").filter((line) => line.trim()).length) }));
      })) return;
    } catch (error) {
      if (cancelled()) return;
      if (!commit(() => {
        setResolvedStops([]);
        setResolvedBase(null);
        setPlaceWarning(error instanceof PlaceResolutionError);
      })) return;
    }
    if (cancelled()) return;

    const plannerContext = (
      baseOverride: ResolvedInputStop | null,
      overrides: Record<string, number> = {},
      earlyStops: string[] = [],
      openings: Record<string, Record<number, VisitWindow[]>> = {},
      transit: Record<string, number> = {},
      walking: Record<string, number> = {},
    ) => ({
      tripStartDate,
      hotelQuery,
      arrivalAirport,
      arrivalTime,
      departureAirport,
      departureTime,
      flightKind: "international" as const,
      mealPlan,
      resolvedStops: places,
      resolvedBase: baseOverride,
      durationOverrides: overrides,
      earlyVisitStopIds: earlyStops,
      openingWindowsByDay: openings,
      liveTransitMinutes: transit,
      liveWalkingMinutes: walking,
    });
    let draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(resolvedHotel));
    if (!commit(() => setPreviewStops(draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))))) return;

    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "hotel", current: 0, total: 1 })))) return;
    const hotelAnchor = resolvedHotel
      ?? draft.baseRecommendations[0]?.base
      ?? draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))[0]
      ?? null;
    let effectiveBase = resolvedHotel;
    let localHotelState: HotelState = { status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState };
    if (hotelAnchor) {
      try {
        const hotelResponse = await requestHotelRecommendations({
          latitude: hotelAnchor.latitude,
          longitude: hotelAnchor.longitude,
          area: hotelAnchor.area,
          ...(hotelQuery.trim() ? { query: hotelQuery } : {}),
        }, locale, controller.signal);
        if (cancelled()) return;
        const recommended = hotelResponse.candidates[0] ?? null;
        const matchedExact = resolvedHotel ? matchingHotelCandidate(resolvedHotel, hotelResponse.candidates) : null;
        const selected = shouldUseRecommendedHotel(hotelQuery) ? recommended : matchedExact;
        if (selected && shouldUseRecommendedHotel(hotelQuery)) {
          effectiveBase = hotelAsResolvedBase(selected, hotelQuery, hotelAnchor.area, hotelResponse.fetchedAt);
        }
        const candidates = selected
          ? [selected, ...hotelResponse.candidates.filter((candidate) => candidate.id !== selected.id)]
          : hotelResponse.candidates;
        localHotelState = { status: "ready", candidates, selectedId: selected?.id ?? null, fresh: emptyFreshState };
      } catch {
        localHotelState = { status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState };
      }
    }
    if (cancelled()) return;
    if (!commit(() => {
      setHotelState(localHotelState);
      setResolvedBase(effectiveBase);
      setBuildProgress((current) => ({ ...current, current: 1, total: 1 }));
    })) return;

    draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(effectiveBase));
    const uniqueStops = [...new Map(
      draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => [stop.id, stop] as const)),
    ).values()];
    if (!commit(() => setPreviewStops(uniqueStops))) return;

    const selectedHotelForBuild = localHotelState.selectedId
      ? localHotelState.candidates.find((candidate) => candidate.id === localHotelState.selectedId) ?? null
      : null;
    let reviewCount = selectedHotelForBuild?.reviews?.length ?? 0;
    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "reviews", current: 0, total: uniqueStops.length, reviewCount })))) return;
    const intelligenceEntries = await mapWithConcurrency(uniqueStops, 4, async (stop) => {
      try {
        const result = await requestPlaceIntelligence(stop, locale, controller.signal);
        reviewCount += result.reviews.length;
        return [stop.id, { status: "ready", result } satisfies IntelligenceState] as const;
      } catch {
        return [stop.id, { status: "unavailable", result: null } satisfies IntelligenceState] as const;
      }
    }, (current, total) => {
      commit(() => setBuildProgress((progress) => ({ ...progress, current, total, reviewCount })));
    }, cancelled);
    if (cancelled()) return;
    const localIntelligence = Object.fromEntries(intelligenceEntries) as Record<string, IntelligenceState>;
    if (!commit(() => setIntelligence(localIntelligence))) return;

    const localOpeningWindows: Record<string, Record<number, VisitWindow[]>> = {};
    for (const stop of uniqueStops) {
      const place = localIntelligence[stop.id]?.result?.place;
      if (!place) continue;
      for (let dayIndex = 0; dayIndex < draft.days.length; dayIndex += 1) {
        const date = draft.days[dayIndex]?.date;
        if (!date) continue;
        const windows = googleOpeningWindowsForDate({
          businessStatus: place.businessStatus,
          regularOpeningPeriods: place.regularOpeningPeriods,
        }, date);
        if (windows !== null) {
          localOpeningWindows[stop.id] ??= {};
          localOpeningWindows[stop.id][dayIndex] = windows;
        }
      }
    }
    draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(effectiveBase, {}, [], localOpeningWindows));
    if (!commit(() => setPreviewStops(draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))))) return;

    const slots = draft.foodRecommendationSlots;
    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "food", current: 0, total: slots.length })))) return;
    const foodRequestCache = new Map<string, ReturnType<typeof requestFoodRecommendations>>();
    const foodEntries = await mapWithConcurrency(slots, 4, async (slot) => {
      const query = defaultFoodDiscoveryQuery(locale);
      try {
        const cacheKey = foodRecommendationRequestKey(slot, locale);
        let pending = foodRequestCache.get(cacheKey);
        if (!pending) {
          pending = requestFoodRecommendations(slot, locale, { signal: controller.signal });
          foodRequestCache.set(cacheKey, pending);
        }
        const response = await pending;
        return [slot.id, { status: "ready", query, candidates: response.candidates, notes: {}, fresh: {} } satisfies FoodState] as const;
      } catch {
        return [slot.id, { status: "unavailable", query, candidates: [], notes: {}, fresh: {} } satisfies FoodState] as const;
      }
    }, (current, total) => {
      commit(() => setBuildProgress((progress) => ({ ...progress, current, total })));
    }, cancelled);
    if (cancelled()) return;
    const localFoodSearches = Object.fromEntries(foodEntries) as Record<string, FoodState>;
    if (!commit(() => setFoodSearches(localFoodSearches))) return;

    type PublicTarget = {
      key: string;
      name: string;
      area: string;
      intent: "place" | "food" | "hotel";
      stopIds: string[];
      foodRefs: Array<{ slotId: string; candidateId: string }>;
      hotel: boolean;
    };
    const targetMap = new Map<string, PublicTarget>();
    const addTarget = (target: Omit<PublicTarget, "key">) => {
      const key = `${target.intent}|${target.name.normalize("NFKC").toLowerCase()}|${target.area.normalize("NFKC").toLowerCase()}`;
      const existing = targetMap.get(key);
      if (existing) {
        existing.stopIds.push(...target.stopIds);
        existing.foodRefs.push(...target.foodRefs);
        existing.hotel ||= target.hotel;
      } else {
        targetMap.set(key, { ...target, key });
      }
    };
    const selectedHotelCandidate = localHotelState.selectedId
      ? localHotelState.candidates.find((candidate) => candidate.id === localHotelState.selectedId) ?? null
      : null;
    if (selectedHotelCandidate) {
      addTarget({
        name: selectedHotelCandidate.name,
        area: selectedHotelCandidate.address.slice(0, 100) || hotelAnchor?.area || "Japan",
        intent: "hotel",
        stopIds: [],
        foodRefs: [],
        hotel: true,
      });
    }
    for (const slot of slots) {
      for (const candidate of (localFoodSearches[slot.id]?.candidates ?? []).slice(0, 2)) {
        addTarget({
          name: candidate.name,
          area: candidate.address.slice(0, 100) || slot.area,
          intent: "food",
          stopIds: [],
          foodRefs: [{ slotId: slot.id, candidateId: candidate.id }],
          hotel: false,
        });
      }
    }
    for (const stop of uniqueStops) {
      const google = localIntelligence[stop.id]?.result;
      addTarget({
        name: google?.place.name ?? stop.name,
        area: google?.place.address.slice(0, 100) || stop.area,
        intent: "place",
        stopIds: [stop.id],
        foodRefs: [],
        hotel: false,
      });
    }
    // Search units are explicitly budgeted. Hotel and meal decisions are added
    // first so a long wishlist cannot consume their evidence allowance. The
    // selected hotel gets two searches when possible; every other target gets
    // one until the 24-unit ceiling is reached.
    // Hold a few of the 24 per-plan search units for candidates that have to be
    // re-anchored after live evidence changes the route. This avoids paying for
    // the same restaurant twice while ensuring a replacement can still be
    // checked against a cited public source.
    const reanchorSearchReserve = Math.min(6, slots.length * 2);
    let remainingSearchUnits = 24 - reanchorSearchReserve;
    const publicTargets = [...targetMap.values()].flatMap((target) => {
      if (remainingSearchUnits <= 0) return [];
      const preferredUnits = target.intent === "hotel" ? 2 : 1;
      const units = Math.min(preferredUnits, remainingSearchUnits);
      remainingSearchUnits -= units;
      return [{ ...target, depth: units === 2 ? "deep" as const : "quick" as const }];
    });
    let publicCount = 0;
    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "public", current: 0, total: publicTargets.length, publicCount: 0 })))) return;
    const publicResults = await mapWithConcurrency(publicTargets, 4, async (target) => {
      try {
        const result = await requestFreshVoices({ name: target.name, area: target.area }, locale, { intent: target.intent, depth: target.depth, signal: controller.signal });
        publicCount += result.findings.length;
        return { target, state: { status: "ready", result } satisfies FreshState };
      } catch {
        return { target, state: { status: "unavailable", result: null } satisfies FreshState };
      }
    }, (current, total) => {
      commit(() => setBuildProgress((progress) => ({ ...progress, current, total, publicCount })));
    }, cancelled);
    if (cancelled()) return;
    const localFreshVoices: Record<string, FreshState> = {};
    for (const { target, state } of publicResults) {
      for (const stopId of target.stopIds) localFreshVoices[stopId] = state;
      for (const { slotId, candidateId } of target.foodRefs) {
        const food = localFoodSearches[slotId];
        if (food) food.fresh[candidateId] = state;
      }
      if (target.hotel) localHotelState = { ...localHotelState, fresh: state };
    }
    for (const food of Object.values(localFoodSearches)) {
      const evidenceByCandidateId = Object.fromEntries(Object.entries(food.fresh).map(([candidateId, state]) => [candidateId, state.result]));
      food.candidates = rankFoodWithPublicEvidence(food.candidates, evidenceByCandidateId).slice(0, 2);
    }
    if (!commit(() => {
      setFreshVoices(localFreshVoices);
      setFoodSearches({ ...localFoodSearches });
      setHotelState(localHotelState);
    })) return;

    const overrides: Record<string, number> = {};
    const earlyStops: string[] = [];
    for (const stop of uniqueStops) {
      const evidence = deriveStopPlanningEvidence(localIntelligence[stop.id]?.result, localFreshVoices[stop.id]?.result);
      if (evidence.bufferMinutes > 0) overrides[stop.id] = Math.min(480, stop.planningDurationMinutes + evidence.bufferMinutes);
      if (evidence.reasons.some((reason) => reason === "queue" || reason === "sold_out" || reason === "early_close")) earlyStops.push(stop.id);
    }
    const routeDraft = buildTripFromWishlist(
      itinerary,
      tripDays,
      pace,
      locale,
      plannerContext(effectiveBase, overrides, earlyStops, localOpeningWindows),
    );
    const plannedRouteLegs = Math.min(24, routeDraft.days.reduce((total, candidate) => (
      total + candidate.legs.length + (routeDraft.selectedBase && candidate.stops.length > 0 ? 2 : 0)
    ), 0));
    if (!commit(() => {
      setPreviewStops(routeDraft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop)));
      setBuildProgress((current) => ({ ...current, stage: "routes", current: 0, total: plannedRouteLegs, reviewCount, publicCount }));
    })) return;
    let measuredTransit: Record<string, number> = {};
    let measuredWalking: Record<string, number> = {};
    try {
      const measured = await prefetchPlanningRouteDurations(routeDraft, locale, {
        concurrency: 2,
        maxLegs: 24,
        signal: controller.signal,
      });
      if (cancelled()) return;
      measuredTransit = measured.transitMinutes;
      measuredWalking = measured.walkingMinutes;
      const measuredCount = new Set(measured.legs.filter((leg) => leg.status === "ok").map((leg) => leg.id)).size;
      if (!commit(() => setBuildProgress((current) => ({ ...current, current: measuredCount, total: plannedRouteLegs })))) return;
    } catch {
      if (cancelled()) return;
    }

    if (!commit(() => setBuildProgress((current) => ({
      ...current,
      stage: "scheduling",
      current: 0,
      total: 1,
      reviewCount,
      publicCount,
    })))) return;

    // Public queue/sell-out evidence and measured travel can move the stop
    // nearest a meal window. Reconcile against that final schedule before any
    // recommendation is displayed. Nearby anchors within 250 m reuse the
    // already fetched Google result; materially moved/date-changed slots are
    // fetched once more through the same per-build request cache.
    const finalDraft = buildTripFromWishlist(
      itinerary,
      tripDays,
      pace,
      locale,
      plannerContext(effectiveBase, overrides, earlyStops, localOpeningWindows, measuredTransit, measuredWalking),
    );
    const finalSlots = finalDraft.foodRecommendationSlots;
    const reconciliation = reconcileFoodRecommendationSlots(slots, finalSlots, 20);
    const refreshEntries = await mapWithConcurrency(reconciliation.refresh, 4, async (slot) => {
      const query = defaultFoodDiscoveryQuery(locale);
      try {
        const cacheKey = foodRecommendationRequestKey(slot, locale);
        let pending = foodRequestCache.get(cacheKey);
        if (!pending) {
          pending = requestFoodRecommendations(slot, locale, { signal: controller.signal });
          foodRequestCache.set(cacheKey, pending);
        }
        const response = await pending;
        return [slot.id, { status: "ready", query, candidates: response.candidates, notes: {}, fresh: {} } satisfies FoodState] as const;
      } catch {
        return [slot.id, { status: "unavailable", query, candidates: [], notes: {}, fresh: {} } satisfies FoodState] as const;
      }
    }, undefined, cancelled);
    if (cancelled()) return;
    const refreshedById = Object.fromEntries(refreshEntries) as Record<string, FoodState>;
    const finalFoodSearches = Object.fromEntries(finalSlots.map((slot) => [
      slot.id,
      refreshedById[slot.id]
        ?? localFoodSearches[slot.id]
        ?? { status: "unavailable", query: defaultFoodDiscoveryQuery(locale), candidates: [], notes: {}, fresh: {} } satisfies FoodState,
    ])) as Record<string, FoodState>;

    const knownFreshByCandidateId = new Map<string, FreshState>();
    for (const state of Object.values(localFoodSearches)) {
      for (const [candidateId, fresh] of Object.entries(state.fresh)) knownFreshByCandidateId.set(candidateId, fresh);
    }
    for (const state of Object.values(finalFoodSearches)) {
      for (const candidate of state.candidates) {
        const known = knownFreshByCandidateId.get(candidate.id);
        if (known) state.fresh[candidate.id] = known;
      }
    }

    type ReanchoredFoodTarget = {
      candidateId: string;
      name: string;
      area: string;
      refs: string[];
    };
    const reanchoredTargetMap = new Map<string, ReanchoredFoodTarget>();
    // Give every changed meal's first choice a chance to be grounded before
    // spending the remaining allowance on second choices.
    for (const rank of [0, 1]) {
      for (const slot of reconciliation.refresh) {
        const state = finalFoodSearches[slot.id];
        const candidate = state?.candidates[rank];
        if (!candidate || state.fresh[candidate.id]?.status === "ready") continue;
        const existing = reanchoredTargetMap.get(candidate.id);
        if (existing) existing.refs.push(slot.id);
        else reanchoredTargetMap.set(candidate.id, {
          candidateId: candidate.id,
          name: candidate.name,
          area: candidate.address.slice(0, 100) || slot.area,
          refs: [slot.id],
        });
      }
    }
    const reanchorSearchUnits = reanchorSearchReserve + remainingSearchUnits;
    const reanchoredTargets = [...reanchoredTargetMap.values()].slice(0, reanchorSearchUnits);
    const reanchoredResults = await mapWithConcurrency(reanchoredTargets, 4, async (target) => {
      try {
        const result = await requestFreshVoices(
          { name: target.name, area: target.area },
          locale,
          { intent: "food", depth: "quick", signal: controller.signal },
        );
        publicCount += result.findings.length;
        return { target, state: { status: "ready", result } satisfies FreshState };
      } catch {
        return { target, state: { status: "unavailable", result: null } satisfies FreshState };
      }
    }, undefined, cancelled);
    if (cancelled()) return;
    for (const { target, state } of reanchoredResults) {
      for (const slotId of target.refs) {
        const food = finalFoodSearches[slotId];
        if (food) food.fresh[target.candidateId] = state;
      }
    }
    for (const food of Object.values(finalFoodSearches)) {
      const evidenceByCandidateId = Object.fromEntries(Object.entries(food.fresh).map(([candidateId, state]) => [candidateId, state.result]));
      food.candidates = rankFoodWithPublicEvidence(food.candidates, evidenceByCandidateId).slice(0, 2);
    }
    if (!commit(() => setFoodSearches(finalFoodSearches))) return;

    if (!commit(() => {
      setBuildProgress((current) => ({ ...current, stage: "scheduling", current: 1, total: 1, reviewCount, publicCount }));
      setDurationOverrides(overrides);
      setEarlyVisitStopIds(earlyStops);
      setOpeningWindowsByDay(localOpeningWindows);
      setLiveTransit(measuredTransit);
      setLiveWalking(measuredWalking);
      setResolvedStops(places);
      setResolvedBase(effectiveBase);
      setActiveDay(0);
      setHasPlan(true);
      setPreviewStops([]);
      setIsBuilding(false);
      buildAbortRef.current = null;
    })) return;
  }

  function resetTrip() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    buildRunRef.current += 1;
    setItinerary("");
    setTripDays(3);
    setHotelQuery("");
    setTripStartDate(defaultTripDate());
    setPace("balanced");
    setMealPlan("all");
    setArrivalAirport("none");
    setArrivalTime("");
    setDepartureAirport("none");
    setDepartureTime("");
    setResolvedStops([]);
    setResolvedBase(null);
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setDurationOverrides({});
    setEarlyVisitStopIds([]);
    setPreviewStops([]);
    setLiveTransit({});
    setLiveWalking({});
    setOpeningWindowsByDay({});
    setInspector(null);
    setHasPlan(false);
    setPlaceWarning(false);
    setActiveDay(0);
    setIsBuilding(false);
    setBuildProgress(initialBuildProgress);
  }

  function cancelBuild() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    buildRunRef.current += 1;
    setIsBuilding(false);
    setHasPlan(false);
    setResolvedStops([]);
    setResolvedBase(null);
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setDurationOverrides({});
    setEarlyVisitStopIds([]);
    setPreviewStops([]);
    setLiveTransit({});
    setLiveWalking({});
    setOpeningWindowsByDay({});
    setPlaceWarning(false);
    setActiveDay(0);
    setBuildProgress(initialBuildProgress);
    setInspector(null);
  }

  function switchDay(index: number) {
    setActiveDay(index);
    setInspector(null);
  }

  async function findFood(slot: FoodRecommendationSlot) {
    const runId = buildRunRef.current;
    const stale = () => buildRunRef.current !== runId;
    const query = defaultFoodDiscoveryQuery(locale);
    setInspector({ kind: "food", slotId: slot.id });
    setFoodSearches((current) => ({ ...current, [slot.id]: { status: "loading", query, candidates: [], notes: {}, fresh: {} } }));
    try {
      const response = await requestFoodRecommendations(slot, locale);
      if (stale()) return;
      const next: FoodState = { status: "ready", query, candidates: response.candidates, notes: {}, fresh: {} };
      setFoodSearches((current) => ({ ...current, [slot.id]: next }));
      const candidate = response.candidates[0];
      if (candidate) {
        void requestFreshVoices({ name: candidate.name, area: candidate.address.slice(0, 100) || slot.area }, locale, { intent: "food", depth: "quick" })
          .then((result) => {
            if (stale()) return;
            setFoodSearches((current) => {
              const entry = current[slot.id];
              if (!entry || entry.status !== "ready") return current;
              return { ...current, [slot.id]: { ...entry, fresh: { ...entry.fresh, [candidate.id]: { status: "ready", result } } } };
            });
          })
          .catch(() => { /* Google-ranked food remains useful without a public source. */ });
      }
    } catch {
      if (stale()) return;
      setFoodSearches((current) => ({ ...current, [slot.id]: { status: "unavailable", query, candidates: [], notes: {}, fresh: {} } }));
    }
  }

  function openFoodSlot(slot: FoodRecommendationSlot) {
    if (inspector?.kind === "food" && inspector.slotId === slot.id) {
      setInspector(null);
      return;
    }
    const state = foodSearches[slot.id];
    if (!state || state.status === "idle") {
      void findFood(slot);
      return;
    }
    setInspector({ kind: "food", slotId: slot.id });
  }

  async function checkPlace(stop: RouteStop) {
    const runId = buildRunRef.current;
    const stale = () => buildRunRef.current !== runId;
    const cachedIntel = intelligence[stop.id];
    const cachedFresh = freshVoices[stop.id];
    if (cachedIntel?.status === "loading" || cachedFresh?.status === "loading") return;
    if (cachedIntel?.status === "ready" && cachedFresh?.status === "ready") return;

    let placeResult = cachedIntel?.status === "ready" ? cachedIntel.result : null;
    if (!placeResult) {
      setIntelligence((current) => ({ ...current, [stop.id]: { status: "loading", result: null } }));
      try {
        placeResult = await requestPlaceIntelligence(stop, locale);
        if (stale()) return;
        setIntelligence((current) => ({ ...current, [stop.id]: { status: "ready", result: placeResult } }));
      } catch {
        if (stale()) return;
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
      if (stale()) return;
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "ready", result } }));
    } catch {
      if (stale()) return;
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "unavailable", result: null } }));
    }
  }

  const selectedIntel = selectedBuiltStop ? intelligence[selectedBuiltStop.stop.id] : undefined;
  const selectedFresh = selectedBuiltStop ? freshVoices[selectedBuiltStop.stop.id] : undefined;
  const selectedCheckLoading = selectedIntel?.status === "loading" || selectedFresh?.status === "loading";
  const selectedCheckReady = selectedIntel?.status === "ready" && selectedFresh?.status === "ready";
  const selectedCheckRetry = selectedIntel?.status === "unavailable" || selectedFresh?.status === "unavailable";
  const activeBuildIndex = buildStageOrder.indexOf(buildProgress.stage);
  const activeBuildDetail = buildProgress.stage === "resolving"
    ? text.progressPlaces(buildProgress.current, buildProgress.total)
    : buildProgress.stage === "reviews"
      ? text.progressReviews(buildProgress.reviewCount)
      : buildProgress.stage === "food"
        ? text.progressFood(buildProgress.current, buildProgress.total)
        : buildProgress.stage === "public"
          ? text.progressPublic(buildProgress.current, buildProgress.total, buildProgress.publicCount)
          : buildProgress.stage === "routes"
            ? text.progressRoutes(buildProgress.current, buildProgress.total)
          : buildProgress.stage === "scheduling"
            ? text.progressScheduling
            : selectedHotel?.name ?? (locale === "ja" ? "旅程に合うホテルを検索中" : "Searching hotels that fit the route");

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
          base={displayedMapBase}
          departureTimes={routeDepartureTimes}
          drawRoute={hasPlan}
          foodPins={foodPins}
          inspectorOpen={Boolean(inspector)}
          locale={locale}
          onLegDurations={handleLegDurations}
          onSelectFood={handleSelectFoodPin}
          onSelectHotel={selectedHotel ? () => setInspector({ kind: "hotel" }) : undefined}
          onSelectStop={handleSelectStop}
          routeModes={routeModes}
          selectedFoodPinId={inspector?.kind === "food" ? inspector.candidateId ?? null : null}
          selectedStopId={inspector?.kind === "stop" ? inspector.stopId : inspector?.kind === "hotel" ? displayedMapBase?.id ?? null : null}
          stops={displayedMapStops}
        />

        {!day && !hasPlan && !isBuilding ? <div className="planner-map-empty"><span aria-hidden="true">⌖</span><p>{text.mapEmpty}</p></div> : null}

        {day ? (
          <div className="planner-map-bottom">
            {selectedHotel ? (
              <button
                className={`planner-hotel-chip${inspector?.kind === "hotel" ? " is-active" : ""}`}
                onClick={() => setInspector(inspector?.kind === "hotel" ? null : { kind: "hotel" })}
                type="button"
              >
                <span aria-hidden="true">H</span>{text.hotelChip}
              </button>
            ) : null}
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
              {selectedBuiltStop.openingStatus === "verified_open" ? <span>{text.openingAdjusted}</span> : null}
              {selectedBuiltStop.openingStatus === "conflict" ? <span className="is-booked">{text.openingConflict}</span> : null}
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
              const listedPayment = paymentLabel(intel, locale);
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
                    {listedPayment ? <span className={intel.place.payment.cashOnly === true ? "is-warning" : ""}>{listedPayment}</span> : null}
                    {intel.place.websiteUrl === null ? <span className="is-warning">{text.noWebsite}</span> : null}
                    {intel.place.rating !== null ? (
                      <span>★ {intel.place.rating.toFixed(1)} · {intel.place.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span>
                    ) : null}
                  </div>
                  <p className="planner-intel-summary">{intel.analysis.summary}</p>
                  {intel.analysis.signals.length > 0 ? (
                    <ul className="planner-intel-signals">
                      {intel.analysis.signals.slice(0, 2).map((signal, signalIndex) => (
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
                      {intel.reviews.slice(0, 1).map((review, reviewIndex) => (
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
                <details className="planner-evidence-sources" aria-label={`${selectedBuiltStop.stop.name} · ${text.freshHeading}`}>
                  <summary>{text.publicSources} · {fresh.findings.length} <small>{formatCheckedAt(fresh.checkedAt, locale)}</small></summary>
                  {fresh.findings.length > 0 ? (
                    <div className="planner-fresh-list">
                      {fresh.findings.slice(0, 3).map((finding) => (
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
                </details>
              );
            })() : null}
          </aside>
        ) : null}

        {inspector?.kind === "hotel" && selectedHotel ? (
          <aside className="planner-inspector is-hotel" aria-label={selectedHotel.name}>
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}>✕</button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-food" aria-hidden="true">H</span>
              <div>
                <h2>{selectedHotel.name}</h2>
                <p>{text.hotelCandidate}</p>
              </div>
            </header>
            <a className="planner-hotel-hero" href={selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">
              {selectedHotel.photo ? <>
                {/* Google place photos are proxied at request time and are not stored. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={selectedHotel.name} src={`/api/place-photo?name=${encodeURIComponent(selectedHotel.photo.name)}`} />
              </> : <span aria-hidden="true">▣</span>}
            </a>
            {selectedHotel.photo?.attribution ? <a className="planner-photo-credit" href={selectedHotel.photo.attribution.uri} rel="noreferrer" target="_blank">Photo: {selectedHotel.photo.attribution.name} ↗</a> : null}
            <div className="planner-hotel-facts">
              {selectedHotel.rating !== null ? <span className="is-rating">★ {selectedHotel.rating.toFixed(1)} · {selectedHotel.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span> : null}
              {selectedHotel.payment?.cashOnly === true ? <span>{text.cashOnly}</span> : null}
              {selectedHotel.payment?.acceptedMethods.includes("credit_card") ? <span>{text.cardsAccepted}</span> : null}
              {hotelState.fresh.result?.findings.length ? <span>{text.foodFresh(hotelState.fresh.result.findings.length)}</span> : null}
            </div>
            <p className="planner-hotel-address">{selectedHotel.address}</p>
            {selectedHotel.reviews?.[0] ? (
              <blockquote className="planner-hotel-review">
                <p>“{selectedHotel.reviews[0].text}”</p>
                <footer>
                  <span>{selectedHotel.reviews[0].rating !== null ? `★ ${selectedHotel.reviews[0].rating}` : ""} {selectedHotel.reviews[0].relativeTime ?? ""}</span>
                  <a href={selectedHotel.reviews[0].googleMapsUrl ?? selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">{selectedHotel.reviews[0].authorName ?? "Google Maps"} ↗</a>
                </footer>
              </blockquote>
            ) : null}
            <div className="planner-inspector-actions">
              <a href={selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">Google Maps ↗</a>
              {selectedHotel.websiteUrl ? <a href={selectedHotel.websiteUrl} rel="noreferrer" target="_blank">{text.official} ↗</a> : null}
            </div>
            {hotelState.fresh.result?.findings.length ? (
              <details className="planner-evidence-sources">
                <summary>{text.publicSources} · {hotelState.fresh.result.findings.length}</summary>
                <div className="planner-fresh-list">
                  {hotelState.fresh.result.findings.map((finding) => (
                    <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                      <div><span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span><small>{finding.age ?? text.freshAgeUnknown}</small></div>
                      <b>{finding.title}</b><p>{finding.note}</p><i aria-hidden="true">↗</i>
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            {hotelState.candidates.length > 1 ? (
              <div className="planner-hotel-alternatives">
                <span>{text.hotelAlternatives}</span>
                {hotelState.candidates.slice(1).map((candidate) => <a href={candidate.googleMapsUrl} key={candidate.id} rel="noreferrer" target="_blank"><span>{candidate.name}</span><b>{candidate.rating !== null ? `★ ${candidate.rating.toFixed(1)}` : "↗"}</b></a>)}
              </div>
            ) : null}
            <p className="planner-food-note">{text.hotelNoAvailability}</p>
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
                  const foodFresh = activeFoodState.fresh[candidate.id]?.result;
                  return (
                    <article
                      className={inspector?.kind === "food" && inspector.candidateId === candidate.id ? "is-selected" : undefined}
                      data-food-candidate={candidate.id}
                      key={candidate.id}
                    >
                      <a className="planner-food-image" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
                        {candidate.photoName ? <>
                          {/* Google place photos are short-lived, server-proxied URLs and cannot use a static Next image allowlist. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={candidate.name} loading="lazy" src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
                        </> : <span aria-hidden="true">🍽</span>}
                        <i className="planner-food-badge">{index + 1}</i>
                      </a>
                      <div>
                        <small>{note?.tag ?? (index === 0 ? (locale === "ja" ? "この土地なら、まずここ" : "Start here") : candidate.type)}</small>
                        <h3>{candidate.name}</h3>
                        <p>{note?.reason ?? candidate.address}</p>
                        <div className="planner-food-stats">
                          {candidate.rating !== null ? <span className="is-rating">★ {candidate.rating.toFixed(1)} · {candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span> : null}
                          {candidate.plannedOpen === true ? <span>{text.plannedOpen}</span> : candidate.plannedOpen == null && candidate.openNow === true ? <span>{text.openNow}</span> : null}
                          {candidate.paymentEvidence[0] ? <span>{candidate.paymentEvidence[0].label}</span> : null}
                          {foodFresh?.findings.length ? <span className="is-fresh">{text.foodFresh(foodFresh.findings.length)}</span> : null}
                        </div>
                        {candidate.reviewSnippets[0] ? <p className="planner-food-proof">“{candidate.reviewSnippets[0].text}” <a href={candidate.reviewSnippets[0].googleMapsUrl ?? candidate.googleMapsUrl} rel="noreferrer" target="_blank">{candidate.reviewSnippets[0].authorName} · {candidate.reviewSnippets[0].relativeTime} ↗</a></p> : null}
                        {candidate.photoAttribution ? (
                          <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">Photo: {candidate.photoAttribution.name}</a>
                        ) : null}
                        {foodFresh?.findings[0] ? <a className="planner-photo-credit" href={foodFresh.findings[0].url} rel="noreferrer" target="_blank">{text.freshSource[foodFresh.findings[0].sourceKind]} · {foodFresh.findings[0].title} ↗</a> : null}
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
        {isBuilding ? (
          <div className="planner-building-view" aria-live="polite">
            <header className="planner-building-head">
              <span className="planner-building-orbit" aria-hidden="true" />
              <div><h1>{text.buildingTitle}</h1><p>{text.buildingBody}</p></div>
            </header>
            <ol className="planner-building-steps">
              {buildStageOrder.map((stage, index) => {
                const state = index < activeBuildIndex ? "is-complete" : index === activeBuildIndex ? "is-active" : "";
                return (
                  <li className={state} key={stage}>
                    <span className="planner-building-step-dot" aria-hidden="true">{index < activeBuildIndex ? "✓" : index + 1}</span>
                    <span className="planner-building-step-copy">
                      <b>{text.buildSteps[stage]}</b>
                      {index === activeBuildIndex ? <small>{activeBuildDetail}</small> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="planner-building-live"><i aria-hidden="true" />{activeBuildDetail}</p>
            <button className="planner-building-cancel" onClick={cancelBuild} type="button">{text.buildingCancel}</button>
          </div>
        ) : !hasPlan ? (
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

            <div className="planner-evidence-summary" aria-label={locale === "ja" ? "予定に反映した根拠" : "Evidence used in this plan"}>
              <span className={buildProgress.publicCount > 0 ? "is-good" : "is-muted"}>
                {buildProgress.publicCount > 0 ? text.publicEvidenceFound(buildProgress.publicCount) : text.publicEvidenceMissing}
              </span>
              <span className={measuredRouteCount > 0 ? "is-good" : "is-warning"}>
                {measuredRouteCount > 0 ? text.routeEvidenceFound(measuredRouteCount) : text.routeEvidenceMissing}
              </span>
            </div>

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
            {plan.deferredUnavailableStops.length > 0 ? <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.unavailableStops(plan.deferredUnavailableStops.length)}</p> : null}

            <section className="planner-day-summary">
              <div>
                <span>{day.date || day.label}</span>
                <b>{day.startTime}—{day.finishTime}</b>
              </div>
              {day.deadlineOverrunMinutes > 0 && day.deadline ? <em>{text.deadlineOver(day.deadline)}</em> : <small>{measuredRouteCount > 0 ? text.walkingSafety : text.estimated}</small>}
            </section>

            {day.stops.length === 0 ? <p className="planner-open-day">{text.openDay}</p> : (
              <ol className="planner-timeline">
                {day.stops.map((builtStop, index) => {
                  const leg = index > 0 ? day.legs[index - 1] : null;
                  const recommended = leg?.comparison.recommended;
                  const stopIntel = intelligence[builtStop.stop.id]?.result;
                  const checked = intelligence[builtStop.stop.id]?.status === "ready";
                  const publicSignals = freshVoices[builtStop.stop.id]?.result?.findings.length ?? 0;
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
                          {stopIntel?.place.rating !== null && stopIntel?.place.rating !== undefined ? <i className="is-checked">★ {stopIntel.place.rating.toFixed(1)}</i> : checked ? <i className="is-checked" aria-hidden="true">✓</i> : null}
                          {publicSignals > 0 ? <i className="is-must">SNS {publicSignals}</i> : null}
                          {builtStop.openingStatus === "verified_open" ? <i className="is-checked">{text.openingAdjusted}</i> : null}
                          {builtStop.openingStatus === "conflict" ? <i className="is-booked">{text.openingConflict}</i> : null}
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
