"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlannerGoogleMap, { type FoodPin, type HotelPin } from "./PlannerGoogleMap";
import Icon from "./PlannerIcons";
import {
  foodCandidateReason,
  foodRecommendationRequestKey,
  foodSearchLinks,
  reconcileFoodRecommendationSlots,
  requestFoodRecommendations,
} from "../lib/food-recommendations-client";
import { requestLinkPreview } from "../lib/link-preview-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../lib/google-food";
import { requestHotelRecommendations } from "../lib/hotel-recommendations-client";
import { placeTypesIncludeLodging, type HotelCandidate, type HotelPriceLevel, type HotelStyle } from "../lib/google-hotels";
import { fullTripDemo } from "../lib/mock-trip";
import { requestFreshVoices, requestPlaceIntelligence, PlaceIntelligenceError } from "../lib/place-intelligence-client";
import { requestAiStatus } from "../lib/ai-status-client";
import type { FreshVoicesResult } from "../lib/fresh-voices";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence";
import { googleOpeningWindowsForDate } from "../lib/google-opening-hours";
import { deriveStopPlanningEvidence } from "../lib/planning-evidence";
import { buildPlanningRouteLegs, planningRouteRequestKey, prefetchPlanningRouteDurations } from "../lib/planning-live-routes-client";
import { rankFoodWithPublicEvidence } from "../lib/public-evidence-ranking";
import { PlaceResolutionError, requestPlaceResolution } from "../lib/place-resolution-client";
import type { ResolvedInputStop, RouteStop } from "../lib/route-optimizer";
import type { Pace } from "../lib/trip-analysis";
import type { TransportMode, TravelPreference } from "../lib/time-feasibility";
import { decodeTripShare, encodeTripShare, type ShareableTripInput } from "../lib/share-link";
import { requestTripIdeas, TripIdeasError } from "../lib/trip-ideas-client";
import { forgetRecentTrip, loadRecentTrips, rememberRecentTrip, type RecentTrip } from "../lib/recent-trips";
import { balancedGeoCenter, buildTripFromWishlist, hotelRouteContextForDraft, routeLegKey, type AirportCode, type BuiltTripPlan, type FoodRecommendationSlot, type MealPlan, type VisitWindow } from "../lib/trip-builder";
import { formatWishlistLines, parsedWishlistPlaces, parseWishlist, type ParsedWishlistPlace } from "../lib/wishlist-parser";

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
  status: "idle" | "loading" | "ready" | "unavailable" | "paused";
  result: FreshVoicesResult | null;
};
type HotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  candidates: HotelCandidate[];
  selectedId: string | null;
  fresh: FreshState;
};
type HotelStayMode = "single" | "nightly";
type HotelStyleChoice = "recommended" | HotelStyle;
type HotelPurpose = "balanced" | "nearest" | "rated" | "value" | "picked";
type NightlyHotelNight = {
  area: string;
  fetchedAt: string;
  candidates: HotelCandidate[];
  selectedId: string | null;
};
type NightlyHotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  nights: NightlyHotelNight[];
};
type BuildStage = "resolving" | "hotel" | "reviews" | "food" | "public" | "routes" | "scheduling";
type BuildProgress = {
  stage: BuildStage;
  current: number;
  total: number;
  reviewCount: number;
  publicCount: number;
  socialCount: number;
};
type Inspector = { kind: "stop"; stopId: string } | { kind: "food"; slotId: string; candidateId?: string } | { kind: "hotel" } | null;
type SourcePreviewState = { status: "loading" | "ready" | "failed"; imageUrl: string | null };

const emptyFreshState: FreshState = { status: "idle", result: null };
const emptyHotelState: HotelState = { status: "idle", candidates: [], selectedId: null, fresh: emptyFreshState };
const emptyNightlyHotelState: NightlyHotelState = { status: "idle", nights: [] };

const priceBandSymbols: Record<HotelPriceLevel, string> = {
  inexpensive: "¥",
  moderate: "¥¥",
  expensive: "¥¥¥",
  very_expensive: "¥¥¥¥",
};

function priceBand(level: HotelPriceLevel | null) {
  return level === null ? null : priceBandSymbols[level];
}

function styledBestCandidate(candidates: HotelCandidate[], style: HotelStyleChoice) {
  if (style === "recommended") return candidates[0] ?? null;
  return candidates.find((candidate) => candidate.styles.includes(style)) ?? null;
}

const weekdayNames = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
} as const;

function weekdayInfo(date: string | null | undefined, locale: PlannerLocale) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = parsed.getUTCDay();
  return { label: weekdayNames[locale][day], isWeekend: day === 0 || day === 6 };
}

function clampTripDays(value: number) {
  return Math.min(10, Math.max(1, Math.round(value)));
}

/* "2泊3日" → 3, "3日" → 3, "3 days" → 3; null when the concept names no length. */
function tripDaysFromConcept(concept: string): number | null {
  const normalized = concept.normalize("NFKC");
  const nights = normalized.match(/(\d{1,2})\s*泊\s*(\d{1,2})\s*日/);
  if (nights) return clampTripDays(Number(nights[2]));
  // Do not mistake a calendar date such as "8月3日から" for a three-day trip.
  const daysJa = normalized.match(/(?:^|[^\d月])(\d{1,2})\s*日間/)
    ?? normalized.match(/(?:^|[^\d月])(\d{1,2})\s*日(?!目|から|に|発)/);
  if (daysJa) return clampTripDays(Number(daysJa[1]));
  const daysEn = normalized.match(/(\d{1,2})\s*[- ]?days?\b/i);
  if (daysEn) return clampTripDays(Number(daysEn[1]));
  return null;
}

function formatDistanceMeters(meters: number) {
  return meters < 950 ? `${Math.max(10, Math.round(meters / 10) * 10)}m` : `${(meters / 1000).toFixed(1)}km`;
}

/* Axis winners are asserted only against the fetched candidate list, and only
 * when there is an actual comparison to make. */
function hotelAxisWinners(candidates: HotelCandidate[]) {
  if (candidates.length < 2) return { nearestId: null as string | null, topRatedId: null as string | null, valueId: null as string | null };
  let nearest = candidates[0];
  let topRated: HotelCandidate | null = null;
  let value: HotelCandidate | null = null;
  for (const candidate of candidates) {
    if (
      candidate.routeBurdenMeters < nearest.routeBurdenMeters
      || (candidate.routeBurdenMeters === nearest.routeBurdenMeters && candidate.routeWorstDistanceMeters < nearest.routeWorstDistanceMeters)
    ) nearest = candidate;
    const count = candidate.userRatingCount ?? 0;
    if (candidate.rating !== null && count >= 50) {
      const bestRating = topRated?.rating ?? -1;
      const bestCount = topRated?.userRatingCount ?? 0;
      if (candidate.rating > bestRating || (candidate.rating === bestRating && count > bestCount)) topRated = candidate;
    }
    if (candidate.styles.includes("value") && (value === null || candidate.score > value.score)) value = candidate;
  }
  return { nearestId: nearest.id, topRatedId: topRated?.id ?? null, valueId: value?.id ?? null };
}

/* Stop order can change when the route is optimized, so the hotel becomes
 * stale only when a day's actual set of destinations changes. */
export function hotelPlanSignature(plan: BuiltTripPlan | null) {
  if (!plan) return "";
  return plan.days.map((day, dayIndex) => (
    `${dayIndex}:${day.stops.map(({ stop }) => stop.id).sort().join(",")}`
  )).join("|");
}

type ParsePreviewRow =
  | { type: "day"; day: number }
  | { type: "warn"; raw: string }
  | { type: "place"; place: ParsedWishlistPlace; showDay: boolean };
const initialBuildProgress: BuildProgress = {
  stage: "resolving",
  current: 0,
  total: 0,
  reviewCount: 0,
  publicCount: 0,
  socialCount: 0,
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

const airportNames: Record<Exclude<AirportCode, "none">, { ja: string; en: string }> = {
  HND: { ja: "羽田空港", en: "Haneda" },
  NRT: { ja: "成田空港", en: "Narita" },
  KIX: { ja: "関西国際空港", en: "Kansai" },
  ITM: { ja: "伊丹空港", en: "Itami" },
  NGO: { ja: "中部国際空港", en: "Chubu" },
  FUK: { ja: "福岡空港", en: "Fukuoka" },
  CTS: { ja: "新千歳空港", en: "New Chitose" },
  OKA: { ja: "那覇空港", en: "Naha" },
};

function airportOptionsFor(locale: PlannerLocale): Array<{ value: AirportCode; label: string }> {
  return [
    { value: "none" as const, label: "—" },
    ...(Object.keys(airportNames) as Array<Exclude<AirportCode, "none">>).map((code) => ({
      value: code,
      label: `${code} · ${airportNames[code][locale]}`,
    })),
  ];
}

const ui = {
  ja: {
    brandNote: "日本の旅プランナー",
    newTrip: "新しい旅",
    headline: "どこへ行きたい？",
    subhead: "行きたい場所を、思いつくまま入れてください。近い場所を同じ日にまとめて、地図に一日の流れを描きます。",
    inputLabel: "行きたい場所",
    placeholder: "例）\n1日目\n浅草寺\nチームラボプラネッツ 15:30 予約\n2日目\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば",
    sample: "サンプルを見る",
    parseHint: "改行のほか「・」「／」でまとめて貼っても、場所ごとに分けます。「1日目」、時刻、予約、必須、滞在時間も読み取ります。",
    previewHeading: (count: number) => `${count}か所として読み取り`,
    previewFormat: "1件ずつに整える",
    previewCheck: "違う場所があれば、上の入力欄で直せます",
    previewDay: (day: number) => `${day}日目`,
    previewUnparsed: "場所名として読み取れない行",
    previewStay: (minutes: number) => `滞在${minutes}分`,
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
    travelHeading: "移動手段",
    travelAuto: "おまかせ（最短）",
    travelCar: "レンタカー・車",
    moveCar: "車",
    timebandHeading: "1日の時間帯",
    timebandEarly: "朝型 8:00〜",
    timebandNormal: "標準 9:00〜",
    timebandLate: "ゆっくり 10:30〜",
    dayEndHeading: "1日の終わり",
    dayEndNone: "指定なし",
    curfewOver: (time: string) => `${time} までに収まっていません`,
    conceptLabel: "コンセプトから作る",
    conceptPlaceholder: "例：大阪 食い倒れ 2泊3日",
    conceptRun: "たたき台を出す",
    conceptRunning: "候補を考えています…",
    conceptNote: "AIの提案はあくまで下書きです。実在するかはビルド時にGoogleで確認し、見つからない場所は外れます。",
    conceptUnavailable: "いまは提案を作れませんでした。少し待って再試行してください。",
    conceptNotConfigured: "AI提案は一時停止中、または未設定です。",
    conceptRateLimited: "提案の回数上限に達しました。しばらくしてからどうぞ。",
    recentHeading: "最近の旅程",
    recentNote: "この端末の中だけに保存されます",
    recentDays: (days: number) => `${days}日間`,
    recentDelete: "削除",
    moveDay: "日を移動",
    mealChoose: "この店にする",
    mealChosen: "行程に入れました",
    share: "共有リンク",
    shareCopied: "コピーしました",
    shareTitle: "この旅程を同じ設定で開けるリンクをコピーします。内容はリンクの中だけに入り、サーバには保存されません。",
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
    buildingBodyNoSocial: "営業時間・口コミ・実経路をGoogleで確認してから、ルートを確定します。",
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
    progressPublic: (current: number, total: number, findings: number, social: number) => `公開検索 ${current}/${total} · 出典 ${findings}件（SNS ${social}）`,
    progressRoutes: (current: number, total: number) => `実測できた移動 ${current}/${total}`,
    progressScheduling: "混雑の明示情報は余白時間として反映します",
    progressFinalize: (current: number, total: number) => `動いた食事候補を再確認 ${current}/${total}`,
    mapReady: "Googleマップ",
    mapEmpty: "行き先を入れると、ここに旅が描かれます",
    edit: "入力にもどる",
    planSummary: (days: number, stops: number) => `${days}日間 · ${stops}か所`,
    openMaps: "Google Mapsで開く",
    stay: "滞在",
    removeStop: "この行き先を予定から外す",
    removedHeading: "自分で外した場所",
    restoreStop: "もどす",
    backToPlan: "作成した計画にもどる",
    hotelDepartRow: (mode: string, minutes: number) => `ホテルから ${mode} 約${minutes}分`,
    hotelReturnRow: (mode: string, minutes: number) => `ホテルへ ${mode} 約${minutes}分`,
    travelTotal: (minutes: number) => `移動 合計約${minutes}分`,
    legModes: "この区間の移動手段。タップで固定、もう一度タップで自動に戻す",
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
    hotelCandidate: "おすすめのホテル",
    hotelAlternatives: "ほかの候補",
    hotelNoAvailability: "料金・空室は宿泊サイトで最終確認してください。",
    hotelUnavailable: "ホテル候補を取得できませんでした。",
    hotelSearch: "Google Mapsでホテルを探す",
    hotelRefresh: "ホテルを再検索",
    hotelRefreshChanged: "変更後の行程でホテルを再検索",
    hotelRefreshing: "ホテルを探し直しています…",
    hotelRefreshHint: "行き先が変わったため、ホテル候補も更新できます。",
    hotelRefreshFailed: "再検索できませんでした。今のホテルはそのまま残しています。",
    stayModeHeading: "泊まり方",
    staySame: "同じホテルで通す",
    stayNightly: "日ごとに変える",
    nightLabel: (night: number) => `${night}泊目`,
    nightlyLoading: "夜ごとの候補を探しています…",
    nightlyUnavailable: "日ごとの候補を取得できませんでした。共通のホテルのまま計画しています。",
    nightlyNightMissing: "この夜は候補を取得できず、共通のホテルのままです。",
    styleRecommended: "おすすめ",
    styleLuxury: "ラグジュアリー",
    styleValue: "お手頃で高評価",
    styleNote: "価格帯はGoogleの掲載区分です。",
    hotelRankNote: "各日の行き先を1日1票で比較し、直線距離の平均と最も遠い日の負担が小さいホテルを優先。そこへGoogle評価と口コミ量を加えて総合順位を決めます。実際の所要時間は地図の経路で確認します。",
    hotelCompareHeading: "候補を比べる（タップで切り替え）",
    priceUnlisted: "価格未掲載",
    rakutenTag: (average: number, count: number) => `楽天トラベル ★${average.toFixed(1)}（${count.toLocaleString("ja-JP")}件）`,
    hotelPriceNote: "¥価格は楽天トラベル掲載の参考最安（日付未指定）です。",
    hotelReasonTop: "全日程への行きやすさ・評価・口コミ量の合計で1位の候補です。",
    hotelReasonNearest: "各日の行き先への距離負担が最も小さい候補です。",
    hotelReasonRated: "十分な口コミ数がある候補の中で、Google評価が最も高いホテルです。",
    hotelReasonValue: "Googleの価格帯がお手頃で、評価4.1以上・口コミ100件以上の候補です。",
    hotelReasonSpecified: "入力したホテル名に一致した候補です。行程の出発・帰着地点にも反映しています。",
    hotelReasonPicked: "切り替えて選んだ候補です。",
    hotelPurposeHeading: "何を優先する？",
    hotelPurposeBalanced: "総合",
    hotelPurposeNearest: "移動を少なく",
    hotelPurposeRated: "評価重視",
    hotelPurposeValue: "コスパ",
    hotelPurposeHelp: "同じ候補が複数の条件で1位になることがあります。",
    axisNearest: "全日程に行きやすい目安",
    axisTopRated: "最高評価",
    distanceFrom: (distance: string) => `各日の中心へ直線平均約${distance}`,
    hotelWideTrip: "行き先が広範囲です。1つのホテルでは長距離移動が残るため、日ごとに変える方が楽です。",
    useThisHotel: "このホテルに切り替え",
    tonightHotel: (name: string) => `今夜の宿 · ${name}`,
    publicSources: "公開SNS・記事の出典",
    reviewReport: "口コミでの支払い報告",
    reservation: "予約",
    timePinned: "時間指定",
    lateBy: (minutes: number) => `指定時刻に約${minutes}分間に合わない見込み`,
    lateShort: (minutes: number) => `${minutes}分遅れ`,
    must: "必須",
    optional: "任意",
    stayLabel: "滞在時間",
    stayAuto: "自動",
    dayStart: "開始時刻",
    estimated: "移動時間は目安。Googleの実測が届くと自動でなじみます。",
    openingAdjusted: "営業時間に合わせて訪問時刻を調整",
    openingConflict: "営業時間と予約時刻を再確認",
    openingClosedDay: "この日は休業の可能性 — 日の移動を検討",
    openingUnknown: "営業時間 未確認",
    excludedHeading: "予定から外した場所",
    excludedClosed: "休業・営業時間が合わない",
    excludedPace: "ペースに収まらない任意の場所",
    overCapacity: "1日に収まりきらない日があります。日数を増やすか、任意の場所を減らすと現実的になります。",
    publicEvidenceFound: (count: number, social: number) => social > 0 ? `公開情報 ${count}件（SNS ${social}件）` : `公開情報 ${count}件・SNS投稿は見つからず`,
    publicEvidenceMissing: "公開SNSは確認できず、Google情報で作成",
    routeEvidenceFound: (count: number) => `Google実測 ${count}区間`,
    routeEvidenceMissing: "移動は推定値。日付・経路を要確認",
    walkingSafety: "徒歩経路はベータ版。安全状況は現地で確認してください。",
    deadlineOver: (time: string) => `空港へ向かう目安 ${time} を超えています`,
    language: "言語",
    privacy: "旅程はこの端末だけに保存",
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
    dayHours: (value: string) => `この日の営業 ${value}`,
    dayClosed: "この日は休業の表示",
    cashOnly: "現金のみ",
    cardsAccepted: "カード可",
    noWebsite: "公式サイト未掲載",
    photoLabel: "写真:",
    recentVoices: "最近の口コミ（生の声）",
    freshHeading: "ネットの近況",
    freshLoading: "公開情報を探しています…",
    freshEmpty: "90日以内と確認できる公開情報は見つかりませんでした。日付不明の情報も無理に最新扱いしません。",
    freshUnavailable: "いまは最新情報を確認できませんでした。Google Mapsや公式情報も確認してください。",
    freshPaused: "公開SNSチェックはいま休止中です。Googleの営業情報・口コミだけで表示しています。",
    freshSource: { social: "SNS", news: "ニュース", blog: "体験記", web: "公開情報" },
    freshAgeUnknown: "更新日不明",
    freshCheckedAt: "確認",
    freshAiRole: "Claudeが公開の投稿・記事だけを検索して要約します（非公開・ログイン限定の投稿は対象外）。日程と移動はルール計算です。",
    official: "公式サイト",
    latestX: "Xで最新の声",
    instagram: "Instagramで探す",
    aiAudited: "Claudeが根拠だけを要約",
    rulesAudited: "取得情報を自動整理",
    crowd: { quiet: "静かめ", moderate: "ふつう", busy: "混みやすい", veryBusy: "かなり混む" },
    crowdWeekend: "・週末",
    crowdForecast: "（予測）",
    close: "閉じる",
  },
  en: {
    brandNote: "Japan trip planner",
    newTrip: "New trip",
    headline: "Where do you want to go?",
    subhead: "Drop in places as they come to mind. We group what's near, then draw each day on the map.",
    inputLabel: "Places you want to visit",
    placeholder: "Example\nDay 1\nSenso-ji\nteamLab Planets 15:30 booked\nDay 2\nGhibli Museum must\nShibuya Sky optional",
    sample: "Try a sample",
    parseHint: "Paste one per line or use Japanese middle dots and slashes; we separate the places. Day headings, times, booked / must / optional and stay length are also read.",
    previewHeading: (count: number) => `Read as ${count} place${count === 1 ? "" : "s"}`,
    previewFormat: "Make one per line",
    previewCheck: "If anything looks wrong, edit the field above",
    previewDay: (day: number) => `Day ${day}`,
    previewUnparsed: "Can't read this line as a place",
    previewStay: (minutes: number) => `Stay ${minutes} min`,
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
    travelHeading: "Getting around",
    travelAuto: "Best · fastest",
    travelCar: "Rental car",
    moveCar: "Drive",
    timebandHeading: "Day rhythm",
    timebandEarly: "Early 8:00",
    timebandNormal: "Standard 9:00",
    timebandLate: "Slow 10:30",
    dayEndHeading: "Day ends by",
    dayEndNone: "No limit",
    curfewOver: (time: string) => `Runs past your ${time} target`,
    conceptLabel: "Start from a concept",
    conceptPlaceholder: "e.g. Osaka street food, 3 days",
    conceptRun: "Draft a list",
    conceptRunning: "Thinking…",
    conceptNote: "AI suggestions are only a draft. Every place is verified on Google at build time; anything unfindable drops out.",
    conceptUnavailable: "Couldn't draft ideas right now. Try again shortly.",
    conceptNotConfigured: "AI drafts are paused or not configured.",
    conceptRateLimited: "Draft limit reached — try again later.",
    recentHeading: "Recent trips",
    recentNote: "Stored only on this device",
    recentDays: (days: number) => `${days} days`,
    recentDelete: "Remove",
    moveDay: "Move to day",
    mealChoose: "Pick this place",
    mealChosen: "Added to the day",
    share: "Copy share link",
    shareCopied: "Copied",
    shareTitle: "Copies a link that reopens this trip with the same inputs. Everything lives in the link itself; nothing is stored.",
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
    buildingBodyNoSocial: "We verify hours, reviews and real routes on Google before locking the route.",
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
    progressPublic: (current: number, total: number, findings: number, social: number) => `${current}/${total} public checks · ${findings} sources (${social} social)`,
    progressRoutes: (current: number, total: number) => `${current}/${total} route legs verified`,
    progressScheduling: "Explicit crowd signals become schedule buffer",
    progressFinalize: (current: number, total: number) => `Rechecking moved meal picks ${current}/${total}`,
    mapReady: "Google Maps",
    mapEmpty: "Your trip will appear here",
    edit: "Back to input",
    planSummary: (days: number, stops: number) => `${days} days · ${stops} places`,
    openMaps: "Open in Google Maps",
    stay: "Stay",
    removeStop: "Remove from the plan",
    removedHeading: "Removed by you",
    restoreStop: "Put back",
    backToPlan: "Back to your plan",
    hotelDepartRow: (mode: string, minutes: number) => `From hotel · ${mode} ~${minutes} min`,
    hotelReturnRow: (mode: string, minutes: number) => `To hotel · ${mode} ~${minutes} min`,
    travelTotal: (minutes: number) => `~${minutes} min total travel`,
    legModes: "Travel mode for this leg. Tap to pin, tap again for automatic",
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
    hotelCandidate: "Recommended hotel",
    hotelAlternatives: "Other options",
    hotelNoAvailability: "Confirm price and availability with a booking provider.",
    hotelUnavailable: "Hotel options didn't load.",
    hotelSearch: "Search hotels on Google Maps",
    hotelRefresh: "Search hotels again",
    hotelRefreshChanged: "Re-search for the changed itinerary",
    hotelRefreshing: "Searching for a better base…",
    hotelRefreshHint: "Your destinations changed, so the hotel options can be updated too.",
    hotelRefreshFailed: "The re-search failed. Your current hotel has been kept.",
    stayModeHeading: "Stay style",
    staySame: "One hotel",
    stayNightly: "Change nightly",
    nightLabel: (night: number) => `Night ${night}`,
    nightlyLoading: "Finding hotels for each night…",
    nightlyUnavailable: "Nightly options didn't load. The plan keeps one hotel.",
    nightlyNightMissing: "No option loaded for this night — the shared hotel stays.",
    styleRecommended: "Best match",
    styleLuxury: "Luxury",
    styleValue: "Value · high rated",
    styleNote: "Price bands come from Google's listing.",
    hotelRankNote: "Every day gets one equal vote. Hotels with a lower average and worst-day straight-line distance rank higher, then Google rating and review strength are added. Confirm actual travel time on the mapped routes.",
    hotelCompareHeading: "Compare picks — tap to switch",
    priceUnlisted: "No listed price",
    rakutenTag: (average: number, count: number) => `Rakuten Travel ★${average.toFixed(1)} (${count.toLocaleString("en-US")})`,
    hotelPriceNote: "¥ prices are Rakuten Travel's reference minimum (dateless).",
    hotelReasonTop: "Top combined score for whole-trip access, rating and review strength.",
    hotelReasonNearest: "Lowest distance burden across each day's destinations.",
    hotelReasonRated: "Highest Google rating among candidates backed by at least 50 reviews.",
    hotelReasonValue: "Google lists a lower price band, with at least a 4.1 rating and 100 reviews.",
    hotelReasonSpecified: "This matches the hotel you entered and is also used as the route's start and end base.",
    hotelReasonPicked: "Your pick from the alternatives.",
    hotelPurposeHeading: "What matters most?",
    hotelPurposeBalanced: "Overall",
    hotelPurposeNearest: "Less travel",
    hotelPurposeRated: "Top rated",
    hotelPurposeValue: "Best value",
    hotelPurposeHelp: "One hotel can win more than one category.",
    axisNearest: "Best access estimate",
    axisTopRated: "Top rated",
    distanceFrom: (distance: string) => `~${distance} straight-line average`,
    hotelWideTrip: "Your destinations cover a wide area. One hotel still leaves a long travel day; changing hotels nightly will be easier.",
    useThisHotel: "Switch to this hotel",
    tonightHotel: (name: string) => `Tonight · ${name}`,
    publicSources: "Public social and article sources",
    reviewReport: "Payment reported in a review",
    reservation: "Booked",
    timePinned: "Timed",
    lateBy: (minutes: number) => `Runs about ${minutes} min past the set time`,
    lateShort: (minutes: number) => `${minutes} min late`,
    must: "Must",
    optional: "Optional",
    stayLabel: "Stay",
    stayAuto: "Auto",
    dayStart: "Start time",
    estimated: "Times are estimates — live Google routes blend in automatically.",
    openingAdjusted: "Timed to verified opening hours",
    openingConflict: "Recheck opening hours and booking time",
    openingClosedDay: "Likely closed this day — consider moving it",
    openingUnknown: "Hours unverified",
    excludedHeading: "Left out of this plan",
    excludedClosed: "closed or hours don't fit",
    excludedPace: "optional stop beyond this pace",
    overCapacity: "Some days hold more than this pace fits. Add a day or trim optional stops.",
    publicEvidenceFound: (count: number, social: number) => social > 0 ? `${count} public sources · ${social} social` : `${count} public sources · no social post found`,
    publicEvidenceMissing: "Public social sources unavailable · built from Google evidence",
    routeEvidenceFound: (count: number) => `${count} Google-measured route legs`,
    routeEvidenceMissing: "Travel uses estimates · recheck date and route",
    walkingSafety: "Walking routes are beta. Check real-world safety conditions.",
    deadlineOver: (time: string) => `Runs past the ${time} airport cutoff`,
    language: "Language",
    privacy: "Trips stay on this device",
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
    dayHours: (value: string) => `Hours this day: ${value}`,
    dayClosed: "Listed closed on this day",
    cashOnly: "Cash only",
    cardsAccepted: "Cards accepted",
    noWebsite: "No official site",
    photoLabel: "Photo:",
    recentVoices: "Recent reviews — real voices",
    freshHeading: "Latest public signals",
    freshLoading: "Searching public sources…",
    freshEmpty: "No public source could be verified as updated within 90 days. Undated pages are not presented as recent.",
    freshUnavailable: "Fresh sources are unavailable right now. Recheck Google Maps and the official source.",
    freshPaused: "Public social checks are paused for now. Showing Google hours and reviews only.",
    freshSource: { social: "Social", news: "News", blog: "Firsthand", web: "Web" },
    freshAgeUnknown: "Date unknown",
    freshCheckedAt: "Checked",
    freshAiRole: "Claude searches and summarizes public posts only — private or login-only posts can't be read. Schedule and routing stay rule-based.",
    official: "Official site",
    latestX: "Latest on X",
    instagram: "Search Instagram",
    aiAudited: "Evidence summarized by Claude",
    rulesAudited: "Evidence organized automatically",
    crowd: { quiet: "Quiet", moderate: "Steady", busy: "Busy", veryBusy: "Very busy" },
    crowdWeekend: " · weekend",
    crowdForecast: " · forecast",
    close: "Close",
  },
} as const;

function formatWindowClock(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(normalized / 60)}:${String(normalized % 60).padStart(2, "0")}`;
}

function modeIcon(mode: "walk" | "transit" | "taxi", carMode: boolean) {
  return <Icon name={mode === "transit" ? "train" : mode === "taxi" && carMode ? "car" : mode} size={14} />;
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
  const [liveDriving, setLiveDriving] = useState<Record<string, number>>({});
  const [travelPreference, setTravelPreference] = useState<TravelPreference>("auto");
  const [legModeOverrides, setLegModeOverrides] = useState<Record<string, TransportMode>>({});
  const [dayOverrides, setDayOverrides] = useState<Record<string, number>>({});
  const [mealSelections, setMealSelections] = useState<Record<string, string>>({});
  const [dayStartDefault, setDayStartDefault] = useState("09:00");
  const [shareCopied, setShareCopied] = useState(false);
  const [pendingSharedBuild, setPendingSharedBuild] = useState(false);
  // Once a plan is built it stays available: "back to input" must never force
  // a full (paid, slow) rebuild just to peek at the form again.
  const [planReady, setPlanReady] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [concept, setConcept] = useState("");
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptError, setConceptError] = useState<"not_configured" | "rate_limited" | "unavailable" | null>(null);
  const [dayEndTarget, setDayEndTarget] = useState("");
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>([]);
  const [removedStops, setRemovedStops] = useState<Array<{ id: string; name: string }>>([]);
  const [openingWindowsByDay, setOpeningWindowsByDay] = useState<Record<string, Record<number, VisitWindow[]>>>({});
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodState>>({});
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceState>>({});
  const [freshVoices, setFreshVoices] = useState<Record<string, FreshState>>({});
  const [hotelState, setHotelState] = useState<HotelState>(emptyHotelState);
  const [hotelSearchSignature, setHotelSearchSignature] = useState("");
  const [hotelRefreshing, setHotelRefreshing] = useState(false);
  const [hotelRefreshFailed, setHotelRefreshFailed] = useState(false);
  const [hotelUsesRecommendations, setHotelUsesRecommendations] = useState(true);
  const [hotelStayMode, setHotelStayMode] = useState<HotelStayMode>("single");
  const [hotelStyle, setHotelStyle] = useState<HotelStyleChoice>("recommended");
  const [hotelPurpose, setHotelPurpose] = useState<HotelPurpose>("balanced");
  const [nightlyHotels, setNightlyHotels] = useState<NightlyHotelState>(emptyNightlyHotelState);
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [userStayMinutes, setUserStayMinutes] = useState<Record<string, number>>({});
  const [earlyVisitStopIds, setEarlyVisitStopIds] = useState<string[]>([]);
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [sourcePreviews, setSourcePreviews] = useState<Record<string, SourcePreviewState>>({});
  const [previewStops, setPreviewStops] = useState<RouteStop[]>([]);
  const [buildProgress, setBuildProgress] = useState<BuildProgress>(initialBuildProgress);
  // Whether the server accepts Claude-backed requests. While paused, the AI
  // surfaces (concept drafts, social checks) are hidden instead of failing.
  const [aiEnabled, setAiEnabled] = useState(true);
  const aiEnabledRef = useRef(true);
  const buildRunRef = useRef(0);
  const buildAbortRef = useRef<AbortController | null>(null);
  const hotelRefreshAbortRef = useRef<AbortController | null>(null);
  const hotelPlanSignatureRef = useRef("");
  // Mode, place-pair and departure-time keys already requested from Google,
  // plus a small post-build
  // allowance so hotel switches and nightly bases can still get measured legs.
  const attemptedLegKeysRef = useRef<Set<string>>(new Set());
  const postBuildLegBudgetRef = useRef(0);
  const text = ui[locale];
  const airportChoices = airportOptionsFor(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.remove("cursor-visible", "motion-ready");
    try { window.localStorage.setItem("tripcheck-locale", locale); } catch { /* optional */ }
  }, [locale]);

  // Applies a self-contained trip code (share link or device-local history)
  // to the form, then a follow-up effect builds it immediately.
  const applySharedTripInput = useCallback((shared: ShareableTripInput) => {
    setItinerary(shared.itinerary);
    setTripDays(shared.tripDays);
    if (shared.tripStartDate) setTripStartDate(shared.tripStartDate);
    setHotelQuery(shared.hotelQuery);
    setHotelUsesRecommendations(shouldUseRecommendedHotel(shared.hotelQuery));
    setPace(shared.pace);
    setMealPlan(shared.mealPlan);
    setTravelPreference(shared.travelPreference);
    setArrivalAirport(shared.arrivalAirport as AirportCode);
    setArrivalTime(shared.arrivalTime);
    setDepartureAirport(shared.departureAirport as AirportCode);
    setDepartureTime(shared.departureTime);
    setDayStartDefault(shared.dayStartDefault);
    setDayEndTarget(shared.dayEndTarget);
    setPendingSharedBuild(true);
  }, []);

  // A shared link carries the whole trip in its hash; opening it restores the
  // inputs and builds immediately, so a companion lands on the finished plan.
  const sharedHydrationRef = useRef(false);
  useEffect(() => {
    if (sharedHydrationRef.current) return;
    sharedHydrationRef.current = true;
    try {
      setRecentTrips(loadRecentTrips(window.localStorage));
    } catch { /* private-mode storage stays optional */ }
    const match = window.location.hash.match(/^#t=([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const shared = decodeTripShare(match[1]);
    if (!shared) return;
    applySharedTripInput(shared);
  }, [applySharedTripInput]);

  useEffect(() => {
    if (!pendingSharedBuild) return;
    setPendingSharedBuild(false);
    void buildPlan();
    // buildPlan reads the freshly hydrated state from this render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSharedBuild]);

  useEffect(() => {
    if (inspector !== null) setHintDismissed(true);
  }, [inspector]);

  useEffect(() => {
    let cancelled = false;
    void requestAiStatus().then((enabled) => {
      if (cancelled) return;
      aiEnabledRef.current = enabled;
      setAiEnabled(enabled);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (inspector?.kind !== "food" || !inspector.candidateId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>("[data-food-candidate]")]
        .find((element) => element.dataset.foodCandidate === inspector.candidateId);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspector]);

  // Nightly hotel picks become per-night routing bases; nights without a
  // usable candidate keep the trip-wide hotel.
  const nightBases = useMemo(() => {
    if (hotelStayMode !== "nightly" || nightlyHotels.status !== "ready") return undefined;
    const record: Record<number, ResolvedInputStop | null> = {};
    nightlyHotels.nights.forEach((night, index) => {
      const selected = night.candidates.find((candidate) => candidate.id === night.selectedId) ?? null;
      if (selected) record[index] = hotelAsResolvedBase(selected, "", night.area, night.fetchedAt);
    });
    return Object.keys(record).length > 0 ? record : undefined;
  }, [hotelStayMode, nightlyHotels]);

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
    nightBases,
    dayStartTimes,
    // Evidence buffers first, the user's explicit stay edits on top.
    durationOverrides: { ...durationOverrides, ...userStayMinutes },
    earlyVisitStopIds,
    liveTransitMinutes: liveTransit,
    liveWalkingMinutes: liveWalking,
    liveDrivingMinutes: liveDriving,
    travelPreference,
    legModeOverrides,
    dayOverrides,
    defaultDayStart: dayStartDefault,
    dayEndTarget: dayEndTarget || undefined,
    excludedStopIds: removedStops.map((entry) => entry.id),
    openingWindowsByDay,
  }) : null, [arrivalAirport, arrivalTime, dayEndTarget, dayOverrides, dayStartDefault, dayStartTimes, departureAirport, departureTime, durationOverrides, earlyVisitStopIds, hasPlan, hotelQuery, itinerary, legModeOverrides, liveDriving, liveTransit, liveWalking, locale, mealPlan, nightBases, openingWindowsByDay, pace, removedStops, resolvedBase, resolvedStops, travelPreference, tripDays, tripStartDate, userStayMinutes]);

  const currentHotelPlanSignature = useMemo(() => hotelPlanSignature(plan), [plan]);
  const hotelRouteContext = useMemo(() => plan ? hotelRouteContextForDraft(plan) : null, [plan]);
  const hotelPlanDirty = Boolean(
    currentHotelPlanSignature
    && hotelSearchSignature
    && currentHotelPlanSignature !== hotelSearchSignature,
  );
  useEffect(() => {
    hotelPlanSignatureRef.current = currentHotelPlanSignature;
  }, [currentHotelPlanSignature]);

  const day = plan?.days[activeDay] ?? null;
  const base = day ? day.startBase ?? plan?.selectedBase ?? null : null;
  const dayEndBase = day ? day.endBase ?? base : null;
  const modeLabel = (mode: TransportMode | null) => mode === "taxi" && travelPreference === "car"
    ? text.moveCar
    : mode ? text.move[mode] : travelPreference === "car" ? text.moveCar : text.move.transit;
  const dayTravelTotal = day
    ? day.legs.reduce((sum, leg) => sum + leg.comparison.recommended.minutes, 0)
      + (day.hotelOutboundMinutes ?? 0)
      + (day.hotelInboundMinutes ?? 0)
    : 0;
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
    const fallbackBoundary = travelPreference === "car" ? "taxi" as const : "transit" as const;
    if (!day || mapStops.length < 2) {
      return base && mapStops.length === 1
        ? [day?.hotelOutboundMode ?? fallbackBoundary, day?.hotelInboundMode ?? fallbackBoundary]
        : [];
    }
    const betweenStops = day.legs.map((leg) => leg.comparison.recommended.mode);
    return base
      ? [day.hotelOutboundMode ?? fallbackBoundary, ...betweenStops, day.hotelInboundMode ?? fallbackBoundary]
      : betweenStops;
  }, [base, day, mapStops.length, travelPreference]);

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
  const hotelAxis = useMemo(() => hotelAxisWinners(hotelState.candidates), [hotelState.candidates]);
  const hasRakutenHotelEvidence = hotelState.candidates.some((candidate) => candidate.rakuten !== null);
  const hotelPriceLabel = useCallback((candidate: HotelCandidate) => (
    candidate.rakuten?.minCharge
      ? `¥${candidate.rakuten.minCharge.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}〜`
      : priceBand(candidate.priceLevel) ?? text.priceUnlisted
  ), [locale, text]);
  const hotelAxisLabels = useCallback((candidate: HotelCandidate) => [
    ...(candidate.id === hotelAxis.nearestId ? [text.axisNearest] : []),
    ...(candidate.id === hotelAxis.topRatedId ? [text.axisTopRated] : []),
  ], [hotelAxis, text]);
  const hotelPins = useMemo<HotelPin[]>(() => (
    inspector?.kind === "hotel" && hotelStayMode === "single"
      ? hotelState.candidates
        .filter((candidate) => candidate.id !== selectedHotel?.id)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          priceLabel: candidate.rakuten?.minCharge
            ? `¥${candidate.rakuten.minCharge.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}`
            : priceBand(candidate.priceLevel) ?? "H",
        }))
      : []
  ), [hotelState.candidates, hotelStayMode, inspector?.kind, locale, selectedHotel?.id]);
  // Live per-line reading of the wishlist so a misread line is visible before
  // the build starts, not after.
  const parsePreviewRows = useMemo<ParsePreviewRow[]>(() => {
    if (!itinerary.trim()) return [];
    const rows: ParsePreviewRow[] = [];
    let sectionDay: number | null = null;
    for (const line of parseWishlist(itinerary)) {
      if (line.kind === "empty") continue;
      if (line.kind === "heading") {
        sectionDay = line.day;
        rows.push({ type: "day", day: line.day });
        continue;
      }
      if (line.kind === "unparsed") {
        rows.push({ type: "warn", raw: line.raw });
        continue;
      }
      for (const place of line.places) {
        rows.push({ type: "place", place, showDay: place.day !== null && place.day !== sectionDay });
      }
    }
    return rows;
  }, [itinerary]);
  const parsedPlaceCount = useMemo(() => parsePreviewRows.filter((row) => row.type === "place").length, [parsePreviewRows]);
  // "Day 5" in the pasted text quietly outgrowing a 3-day selector produced a
  // plan that contradicted the paste; the selector now follows the headings.
  const maxParsedDay = useMemo(() => parsePreviewRows.reduce((max, row) => {
    if (row.type === "day") return Math.max(max, row.day);
    if (row.type === "place" && row.place.day !== null) return Math.max(max, row.place.day);
    return max;
  }, 0), [parsePreviewRows]);
  const autoBumpedDaysRef = useRef(0);
  useEffect(() => {
    if (maxParsedDay <= tripDays || maxParsedDay > 10) return;
    if (autoBumpedDaysRef.current === maxParsedDay) return;
    autoBumpedDaysRef.current = maxParsedDay;
    setTripDays(maxParsedDay);
  }, [maxParsedDay, tripDays]);
  const formattedItinerary = useMemo(() => formatWishlistLines(itinerary, locale), [itinerary, locale]);
  const canNormalizeItinerary = parsedPlaceCount > 1 && formattedItinerary.trim() !== itinerary.trim();
  const measuredRouteCount = useMemo(() => new Set([
    ...Object.keys(liveTransit),
    ...Object.keys(liveWalking),
  ]).size, [liveTransit, liveWalking]);
  const displayedMapStops = isBuilding ? previewStops : mapStops;
  const displayedMapBase = hasPlan ? base : null;
  const foodPins = useMemo<FoodPin[]>(() => {
    if (activeFoodSlot && activeFoodState && activeFoodState.status === "ready") {
      return activeFoodState.candidates.flatMap((candidate, index) => (
        typeof candidate.latitude === "number" && typeof candidate.longitude === "number"
          ? [{ id: candidate.id, name: candidate.name, latitude: candidate.latitude, longitude: candidate.longitude, index }]
          : []
      ));
    }
    // Confirmed meal picks stay pinned on the map even with the panel closed.
    return daySlots.flatMap((slot) => {
      const selectedId = mealSelections[slot.id];
      const candidate = selectedId ? foodSearches[slot.id]?.candidates.find((entry) => entry.id === selectedId) : undefined;
      return candidate && typeof candidate.latitude === "number" && typeof candidate.longitude === "number"
        ? [{ id: candidate.id, name: candidate.name, latitude: candidate.latitude, longitude: candidate.longitude, index: -1 }]
        : [];
    });
  }, [activeFoodSlot, activeFoodState, daySlots, foodSearches, mealSelections]);

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

  // A photo that 404s must not leave a broken frame (17.4). The node stays in
  // the DOM (hidden) so React's reconciliation is never fighting a manually
  // removed element; the parent class lets CSS show the place-type icon.
  const handlePhotoError = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    image.style.display = "none";
    image.parentElement?.classList.add("is-photo-fallback");
  }, []);

  // Open Graph thumbnails for public-source cards, fetched lazily when the
  // source list is opened and cached for the session. Failures fall back to
  // the media-kind badge that is always rendered.
  const requestedSourcePreviewsRef = useRef<Set<string>>(new Set());
  const ensureSourcePreviews = useCallback((urls: string[]) => {
    const missing = urls.filter((url) => url.startsWith("https://") && !requestedSourcePreviewsRef.current.has(url)).slice(0, 3);
    if (missing.length === 0) return;
    for (const url of missing) requestedSourcePreviewsRef.current.add(url);
    setSourcePreviews((state) => ({
      ...state,
      ...Object.fromEntries(missing.map((url) => [url, { status: "loading", imageUrl: null } satisfies SourcePreviewState])),
    }));
    for (const url of missing) {
      void requestLinkPreview(url)
        .then((preview) => {
          setSourcePreviews((state) => ({ ...state, [url]: { status: "ready", imageUrl: preview.imageUrl } }));
        })
        .catch(() => {
          setSourcePreviews((state) => ({ ...state, [url]: { status: "failed", imageUrl: null } }));
        });
    }
  }, []);

  const handleSelectFoodPin = useCallback((candidateId: string) => {
    if (!activeFoodSlot) return;
    setInspector({ kind: "food", slotId: activeFoodSlot.id, candidateId });
  }, [activeFoodSlot]);

  // When a plan change introduces legs Google has not measured yet (switching
  // hotels, nightly bases), fetch just those legs within a small post-build
  // budget. Keys are place-pair based, so ordinary edits refetch nothing.
  useEffect(() => {
    if (!hasPlan || isBuilding || !plan || postBuildLegBudgetRef.current <= 0) return;
    let missingCount = 0;
    try {
      missingCount = buildPlanningRouteLegs(plan)
        .filter((leg) => !attemptedLegKeysRef.current.has(planningRouteRequestKey(leg))).length;
    } catch {
      return;
    }
    if (missingCount === 0) return;
    const runId = buildRunRef.current;
    const timer = window.setTimeout(() => {
      const excludeKeys = new Set(attemptedLegKeysRef.current);
      const budget = Math.min(postBuildLegBudgetRef.current, 12);
      // Marked as attempted up-front so a failing leg is never retried in a loop.
      let marked: string[] = [];
      try {
        marked = buildPlanningRouteLegs(plan)
          .filter((leg) => !excludeKeys.has(planningRouteRequestKey(leg)))
          .slice(0, budget)
          .map(planningRouteRequestKey);
      } catch {
        return;
      }
      for (const key of marked) attemptedLegKeysRef.current.add(key);
      postBuildLegBudgetRef.current = Math.max(0, postBuildLegBudgetRef.current - marked.length);
      void prefetchPlanningRouteDurations(plan, locale, { concurrency: 2, maxLegs: budget, excludeKeys })
        .then((measured) => {
          if (buildRunRef.current !== runId) return;
          if (Object.keys(measured.transitMinutes).length > 0) {
            setLiveTransit((current) => ({ ...current, ...measured.transitMinutes }));
          }
          if (Object.keys(measured.walkingMinutes).length > 0) {
            setLiveWalking((current) => ({ ...current, ...measured.walkingMinutes }));
          }
          if (Object.keys(measured.drivingMinutes).length > 0) {
            setLiveDriving((current) => ({ ...current, ...measured.drivingMinutes }));
          }
        })
        .catch(() => { /* Estimates stay in place and are labeled as such. */ });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hasPlan, isBuilding, locale, plan]);

  function selectHotelCandidate(candidate: HotelCandidate, purpose: HotelPurpose = "picked") {
    const changed = hotelState.selectedId !== candidate.id;
    if (changed) hotelRefreshAbortRef.current?.abort();
    setHotelState((current) => ({
      ...current,
      selectedId: candidate.id,
      ...(changed ? { fresh: { status: "loading", result: null } satisfies FreshState } : {}),
    }));
    setHotelPurpose(purpose);
    // The displayed hotel and the routing base must never diverge.
    setResolvedBase(hotelAsResolvedBase(candidate, hotelQuery, candidate.address.slice(0, 100) || candidate.name, new Date().toISOString()));
    if (!changed) return;
    if (!aiEnabledRef.current) {
      setHotelState((current) => current.selectedId === candidate.id
        ? { ...current, fresh: { status: "paused", result: null } }
        : current);
      return;
    }
    // Public evidence belongs to one hotel only. Switching a photo card or map
    // pin must never leave the previous hotel's findings attached to this one.
    void requestFreshVoices(
      { name: candidate.name, area: candidate.address.slice(0, 100) || candidate.name },
      locale,
      { intent: "hotel", depth: "quick" },
    ).then((result) => {
      setHotelState((current) => current.selectedId === candidate.id
        ? { ...current, fresh: { status: "ready", result } }
        : current);
    }).catch(() => {
      setHotelState((current) => current.selectedId === candidate.id
        ? { ...current, fresh: { status: "unavailable", result: null } }
        : current);
    });
  }

  async function refreshHotelRecommendations() {
    if (!plan || hotelRefreshing || hotelStayMode !== "single" || !hotelUsesRecommendations) return;
    const routeContext = hotelRouteContextForDraft(plan);
    if (!routeContext) return;
    const signatureAtStart = hotelPlanSignature(plan);
    const areaWasRequested = Boolean(hotelQuery.trim() && hotelUsesRecommendations);
    const searchAnchor = areaWasRequested && resolvedBase
      ? { latitude: resolvedBase.latitude, longitude: resolvedBase.longitude, area: hotelQuery.trim() }
      : routeContext;
    hotelRefreshAbortRef.current?.abort();
    const controller = new AbortController();
    hotelRefreshAbortRef.current = controller;
    setHotelRefreshing(true);
    setHotelRefreshFailed(false);
    try {
      const response = await requestHotelRecommendations({
        latitude: searchAnchor.latitude,
        longitude: searchAnchor.longitude,
        area: searchAnchor.area,
        routePoints: routeContext.routePoints,
      }, locale, controller.signal);
      if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
      const axes = hotelAxisWinners(response.candidates);
      const selected = hotelStyle !== "recommended"
        ? styledBestCandidate(response.candidates, hotelStyle) ?? response.candidates[0] ?? null
        : hotelPurpose === "nearest"
          ? response.candidates.find((candidate) => candidate.id === axes.nearestId) ?? response.candidates[0] ?? null
          : hotelPurpose === "rated"
            ? response.candidates.find((candidate) => candidate.id === axes.topRatedId) ?? response.candidates[0] ?? null
            : hotelPurpose === "value"
              ? response.candidates.find((candidate) => candidate.id === axes.valueId) ?? response.candidates[0] ?? null
              : response.candidates[0] ?? null;
      if (!selected) throw new Error("no_hotel_candidates");
      setHotelState({
        status: "ready",
        candidates: response.candidates,
        selectedId: selected.id,
        fresh: { status: "loading", result: null },
      });
      setResolvedBase(hotelAsResolvedBase(selected, hotelQuery, selected.address.slice(0, 100) || searchAnchor.area, response.fetchedAt));
      setHotelSearchSignature(signatureAtStart);
      setNightlyHotels(emptyNightlyHotelState);
      postBuildLegBudgetRef.current = Math.max(postBuildLegBudgetRef.current, 16);
      setInspector({ kind: "hotel" });

      if (!aiEnabledRef.current) {
        setHotelState((current) => current.selectedId === selected.id
          ? { ...current, fresh: { status: "paused", result: null } }
          : current);
        return;
      }
      // The route decision is deterministic; the optional public-source check
      // follows in the background and never blocks or changes the hotel rank.
      void requestFreshVoices(
        { name: selected.name, area: selected.address.slice(0, 100) || searchAnchor.area },
        locale,
        { intent: "hotel", depth: "quick", signal: controller.signal },
      ).then((result) => {
        if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
        setHotelState((current) => current.selectedId === selected.id
          ? { ...current, fresh: { status: "ready", result } }
          : current);
      }).catch(() => {
        if (controller.signal.aborted) return;
        setHotelState((current) => current.selectedId === selected.id
          ? { ...current, fresh: { status: "unavailable", result: null } }
          : current);
      });
    } catch {
      if (!controller.signal.aborted) setHotelRefreshFailed(true);
    } finally {
      if (hotelRefreshAbortRef.current === controller) {
        hotelRefreshAbortRef.current = null;
        setHotelRefreshing(false);
      }
    }
  }

  async function runConceptDraft() {
    const trimmed = concept.trim();
    if (trimmed.length < 2 || conceptLoading) return;
    setConceptLoading(true);
    setConceptError(null);
    try {
      const response = await requestTripIdeas(trimmed, locale);
      const existing = new Set(parsedWishlistPlaces(itinerary).map((place) => place.name.normalize("NFKC").toLocaleLowerCase()));
      const additions = response.places.filter((place) => !existing.has(place.normalize("NFKC").toLocaleLowerCase()));
      setItinerary((current) => current.trim()
        ? (additions.length > 0 ? `${current.replace(/\s+$/, "")}\n${additions.join("\n")}` : current)
        : response.places.join("\n"));
      const days = tripDaysFromConcept(trimmed);
      if (days !== null) setTripDays(days);
    } catch (error) {
      setConceptError(error instanceof TripIdeasError ? error.code : "unavailable");
    } finally {
      setConceptLoading(false);
    }
  }

  function openRecentTrip(entry: RecentTrip) {
    const shared = decodeTripShare(entry.code);
    if (!shared) {
      setRecentTrips(forgetRecentTrip(window.localStorage, entry.code));
      return;
    }
    applySharedTripInput(shared);
  }

  function removeStopFromPlan(stop: RouteStop) {
    setRemovedStops((current) => current.some((entry) => entry.id === stop.id)
      ? current
      : [...current, { id: stop.id, name: stop.name }]);
    setInspector(null);
  }

  function restoreRemovedStop(stopId: string) {
    setRemovedStops((current) => current.filter((entry) => entry.id !== stopId));
  }

  function moveStopToDay(stopId: string, dayIndex: number) {
    if (dayIndex === activeDay) {
      // Tapping the current day releases the stop back to automatic placement.
      setDayOverrides((current) => {
        if (!(stopId in current)) return current;
        const next = { ...current };
        delete next[stopId];
        return next;
      });
      return;
    }
    setDayOverrides((current) => ({ ...current, [stopId]: dayIndex + 1 }));
    setActiveDay(dayIndex);
  }

  // Confirmed meal picks appear inside the timeline: lunch after its anchor
  // stop, dinner after the day's last stop, each opening its food panel.
  function mealRowsAfter(stopId: string, isLastStop: boolean) {
    return daySlots
      .filter((slot) => {
        const candidateId = mealSelections[slot.id];
        if (!candidateId) return false;
        return slot.kind === "lunch" ? slot.anchorStopId === stopId : isLastStop;
      })
      .sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "lunch" ? -1 : 1))
      .flatMap((slot) => {
        const candidate = foodSearches[slot.id]?.candidates.find((entry) => entry.id === mealSelections[slot.id]);
        if (!candidate) return [];
        return [(
          <li className="planner-meal-row" key={`meal-${slot.id}`}>
            <button
              className="planner-meal-stop"
              onClick={() => setInspector({ kind: "food", slotId: slot.id, candidateId: candidate.id })}
              type="button"
            >
              <time>{slot.window.split("–")[0]}</time>
              <span className="planner-meal-dot" aria-hidden="true"><Icon name="fork" size={13} /></span>
              <span className="planner-stop-main">
                <b>{candidate.name}</b>
                <small>{slot.kind === "lunch" ? text.lunchChip : text.dinnerChip} · {slot.window}</small>
              </span>
            </button>
          </li>
        )];
      });
  }

  function toggleMealSelection(slotId: string, candidateId: string) {
    setMealSelections((current) => {
      if (current[slotId] === candidateId) {
        const next = { ...current };
        delete next[slotId];
        return next;
      }
      return { ...current, [slotId]: candidateId };
    });
  }

  function renderHotelComparison() {
    if (!selectedHotel || hotelState.candidates.length <= 1) return null;
    return (
      <section className="planner-hotel-compare">
        <header><span>{text.hotelCompareHeading}</span><small>{hotelState.candidates.length}</small></header>
        <div className="planner-hotel-compare-list">
          {hotelState.candidates.map((candidate) => {
            const tags = [
              ...hotelAxisLabels(candidate),
              ...(candidate.styles.includes("luxury") ? [text.styleLuxury] : []),
              ...(candidate.styles.includes("value") ? [text.styleValue] : []),
            ];
            return (
              <article className={`planner-hotel-card${candidate.id === selectedHotel.id ? " is-selected" : ""}`} key={candidate.id}>
                <button onClick={() => selectHotelCandidate(candidate)} title={text.useThisHotel} type="button">
                  <span className="planner-hotel-card-image">
                    {candidate.photo ? <>
                      {/* Google photo names are fetched at request time and never persisted. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={candidate.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photo.name)}`} />
                    </> : <span aria-hidden="true"><Icon name="bed" size={22} /></span>}
                    <em>{hotelPriceLabel(candidate)}</em>
                  </span>
                  <span className="planner-hotel-card-copy">
                    <b>{candidate.name}</b>
                    <small>
                      {[
                        candidate.rating !== null ? `★ ${candidate.rating.toFixed(1)}（${candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}）` : null,
                        text.distanceFrom(formatDistanceMeters(candidate.routeAverageDistanceMeters)),
                      ].filter(Boolean).join(" · ")}
                    </small>
                    {tags.length > 0 ? (
                      <span className="planner-hotel-card-tags">
                        {tags.map((tag) => <i key={tag}>{tag}</i>)}
                      </span>
                    ) : null}
                    {candidate.rakuten?.reviewAverage ? (
                      <small className="is-rakuten-line">{text.rakutenTag(candidate.rakuten.reviewAverage, candidate.rakuten.reviewCount ?? 0)}</small>
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
          })}
        </div>
      </section>
    );
  }

  async function copyShareLink() {
    const code = encodeTripShare({
      itinerary,
      tripDays,
      tripStartDate,
      hotelQuery,
      pace,
      mealPlan,
      travelPreference,
      arrivalAirport,
      arrivalTime,
      departureAirport,
      departureTime,
      dayStartDefault,
      dayEndTarget,
    });
    const url = `${window.location.origin}${locale === "ja" ? "/ja" : "/"}#t=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt(text.share, url);
    }
  }

  function setLegMode(legKey: string, mode: TransportMode) {
    setLegModeOverrides((current) => {
      // Tapping the already-pinned mode releases the leg back to automatic.
      if (current[legKey] === mode) {
        const next = { ...current };
        delete next[legKey];
        return next;
      }
      return { ...current, [legKey]: mode };
    });
  }

  function selectNightCandidate(nightIndex: number, candidateId: string) {
    setNightlyHotels((state) => state.status !== "ready" ? state : {
      ...state,
      nights: state.nights.map((night, index) => index === nightIndex ? { ...night, selectedId: candidateId } : night),
    });
  }

  function applyHotelStyle(style: HotelStyleChoice) {
    setHotelStyle(style);
    const pick = styledBestCandidate(hotelState.candidates, style);
    if (pick && pick.id !== hotelState.selectedId) selectHotelCandidate(pick, style === "recommended" ? "balanced" : style === "value" ? "value" : "picked");
    setNightlyHotels((state) => state.status !== "ready" ? state : {
      ...state,
      nights: state.nights.map((night) => {
        const nightPick = styledBestCandidate(night.candidates, style);
        return nightPick ? { ...night, selectedId: nightPick.id } : night;
      }),
    });
  }

  async function enableNightlyHotels() {
    setHotelStayMode("nightly");
    if (nightlyHotels.status === "loading" || nightlyHotels.status === "ready") return;
    if (!plan || plan.days.length < 2) return;
    const runId = buildRunRef.current;
    const stale = () => buildRunRef.current !== runId;
    setNightlyHotels({ status: "loading", nights: [] });
    // Night N should be handy for day N's evening and day N+1's morning, so it
    // anchors on day N's stop centroid (falling back to the next morning or
    // the trip-wide hotel).
    const anchors = plan.days.slice(0, -1).map((planDay, index) => {
      const stops = planDay.stops.map((built) => built.stop);
      const fallback = plan.days[index + 1]?.stops[0]?.stop ?? planDay.endBase ?? plan.selectedBase;
      if (stops.length === 0 && !fallback) return null;
      const center = balancedGeoCenter(stops);
      const latitude = center?.latitude ?? fallback!.latitude;
      const longitude = center?.longitude ?? fallback!.longitude;
      const area = stops.at(-1)?.area ?? fallback?.area ?? "Japan";
      return {
        latitude,
        longitude,
        area,
        routePoints: center ? [center] : fallback ? [{ latitude: fallback.latitude, longitude: fallback.longitude }] : [],
      };
    });
    const styleAtRequest = hotelStyle;
    const nights = await mapWithConcurrency(anchors, 2, async (anchor): Promise<NightlyHotelNight> => {
      if (!anchor) return { area: "", fetchedAt: "", candidates: [], selectedId: null };
      try {
        const response = await requestHotelRecommendations(anchor, locale);
        const pick = styledBestCandidate(response.candidates, styleAtRequest) ?? response.candidates[0] ?? null;
        return { area: anchor.area, fetchedAt: response.fetchedAt, candidates: response.candidates, selectedId: pick?.id ?? null };
      } catch {
        return { area: anchor.area, fetchedAt: "", candidates: [], selectedId: null };
      }
    }, undefined, stale);
    if (stale()) return;
    if (nights.every((night) => night.candidates.length === 0)) {
      setNightlyHotels({ status: "unavailable", nights: [] });
      return;
    }
    setNightlyHotels({ status: "ready", nights });
  }

  function changeLocale(next: PlannerLocale) {
    if (next === locale) return;
    // Switching language must not throw away the built plan or its evidence
    // (coordinates, measured routes, reviews, public sources). Labels and the
    // schedule text rebuild instantly from the same data; already-fetched
    // evidence keeps the language it was collected in until re-checked.
    if (isBuilding) {
      buildAbortRef.current?.abort();
      buildAbortRef.current = null;
      buildRunRef.current += 1;
      setIsBuilding(false);
      setPreviewStops([]);
      setBuildProgress(initialBuildProgress);
    }
    setInspector(null);
    setLocale(next);
    window.history.replaceState({}, "", next === "ja" ? "/ja" : "/");
  }

  function loadDemo() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    buildRunRef.current += 1;
    setItinerary(fullTripDemo.places[locale]);
    setTravelPreference("auto");
    setDayStartDefault("09:00");
    setDayEndTarget("");
    setConcept("");
    setConceptError(null);
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
    setHotelSearchSignature("");
    setHotelRefreshing(false);
    setHotelRefreshFailed(false);
    setHotelUsesRecommendations(shouldUseRecommendedHotel(fullTripDemo.hotelQuery[locale]));
    setHotelStayMode("single");
    setHotelStyle("recommended");
    setHotelPurpose("balanced");
    setNightlyHotels(emptyNightlyHotelState);
    setDurationOverrides({});
    setUserStayMinutes({});
    setEarlyVisitStopIds([]);
    setDayStartTimes({});
    setPreviewStops([]);
    setLiveTransit({});
    setLiveWalking({});
    setLiveDriving({});
    setLegModeOverrides({});
    setDayOverrides({});
    setMealSelections({});
    setRemovedStops([]);
    setOpeningWindowsByDay({});
    setBuildProgress(initialBuildProgress);
    setIsBuilding(false);
    setHasPlan(false);
    setPlanReady(false);
  }

  async function buildPlan() {
    if (!canBuild) return;
    buildAbortRef.current?.abort();
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
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
      setPlanReady(false);
      setPlaceWarning(false);
      setFoodSearches({});
      setIntelligence({});
      setFreshVoices({});
      setHotelState({ ...emptyHotelState, status: "loading" });
      setHotelSearchSignature("");
      setHotelRefreshing(false);
      setHotelRefreshFailed(false);
      setHotelUsesRecommendations(shouldUseRecommendedHotel(hotelQuery));
      setHotelStayMode("single");
      setHotelStyle("recommended");
      setHotelPurpose("balanced");
      setNightlyHotels(emptyNightlyHotelState);
      setDurationOverrides({});
      setUserStayMinutes({});
      setEarlyVisitStopIds([]);
      setDayStartTimes({});
      setPreviewStops([]);
      setLiveTransit({});
      setLiveWalking({});
      setLiveDriving({});
      setLegModeOverrides({});
      setDayOverrides({});
      setMealSelections({});
      setRemovedStops([]);
      setOpeningWindowsByDay({});
      setInspector(null);
      setBuildProgress(initialBuildProgress);
    })) return;

    let places: ResolvedInputStop[] = [];
    let resolvedHotel: ResolvedInputStop | null = null;
    let useRecommendedHotelForBuild = shouldUseRecommendedHotel(hotelQuery);
    try {
      const response = await requestPlaceResolution(itinerary, hotelQuery, locale, controller.signal);
      if (cancelled()) return;
      places = response.places;
      resolvedHotel = response.hotel;
      // The field accepts either a hotel or an area. Google place types settle
      // ambiguous plain inputs such as "新宿駅" or "Nara": non-lodging results
      // become an area anchor, while an actual hotel name remains fixed.
      if (!useRecommendedHotelForBuild && resolvedHotel?.placeTypes?.length) {
        useRecommendedHotelForBuild = !placeTypesIncludeLodging(resolvedHotel.placeTypes);
      }
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
    if (!commit(() => setHotelUsesRecommendations(useRecommendedHotelForBuild))) return;

    const plannerContext = (
      baseOverride: ResolvedInputStop | null,
      overrides: Record<string, number> = {},
      earlyStops: string[] = [],
      openings: Record<string, Record<number, VisitWindow[]>> = {},
      transit: Record<string, number> = {},
      walking: Record<string, number> = {},
      driving: Record<string, number> = {},
    ) => ({
      tripStartDate,
      hotelQuery,
      arrivalAirport,
      arrivalTime,
      departureAirport,
      departureTime,
      flightKind: "international" as const,
      mealPlan,
      travelPreference,
      resolvedStops: places,
      resolvedBase: baseOverride,
      durationOverrides: overrides,
      earlyVisitStopIds: earlyStops,
      openingWindowsByDay: openings,
      liveTransitMinutes: transit,
      liveWalkingMinutes: walking,
      liveDrivingMinutes: driving,
      defaultDayStart: dayStartDefault,
      dayEndTarget: dayEndTarget || undefined,
    });
    let draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(resolvedHotel));
    if (!commit(() => setPreviewStops(draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))))) return;

    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "hotel", current: 0, total: 1 })))) return;
    // Every day gets one route point. A distant excursion no longer drags the
    // hotel halfway toward itself, and every returned candidate is measured
    // against the whole trip.
    const draftHotelContext = hotelRouteContextForDraft(draft);
    const hotelAnchor = resolvedHotel
      ?? draftHotelContext
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
          area: hotelQuery.trim() && useRecommendedHotelForBuild ? hotelQuery.trim() : hotelAnchor.area,
          ...(!useRecommendedHotelForBuild ? { query: hotelQuery } : {}),
          ...(draftHotelContext?.routePoints.length ? { routePoints: draftHotelContext.routePoints } : {}),
        }, locale, controller.signal);
        if (cancelled()) return;
        const recommended = hotelResponse.candidates[0] ?? null;
        const matchedExact = resolvedHotel ? matchingHotelCandidate(resolvedHotel, hotelResponse.candidates) : null;
        // A typed hotel name can still match a Google candidate directly, but
        // only when place resolution failed — once a resolved hotel is the
        // routing base, the displayed hotel must never diverge from it.
        const normalizedQuery = normalizeHotelName(hotelQuery);
        const matchedByQuery = !useRecommendedHotelForBuild && !resolvedHotel && normalizedQuery.length >= 3
          ? hotelResponse.candidates.find((candidate) => {
            const candidateName = normalizeHotelName(candidate.name);
            return candidateName.length >= 3 && (candidateName.includes(normalizedQuery) || normalizedQuery.includes(candidateName));
          }) ?? null
          : null;
        const selected = useRecommendedHotelForBuild ? recommended : matchedExact ?? matchedByQuery;
        if (selected && (useRecommendedHotelForBuild || !resolvedHotel)) {
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
      setHotelPurpose(useRecommendedHotelForBuild ? "balanced" : "picked");
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

    // Route legs are keyed by place pair + mode, so most measurements from this
    // draft stay valid even after evidence buffers shift departure times.
    // Probing them now, in parallel with the public-evidence stage, removes the
    // routes stage from the critical path; only legs that genuinely changed are
    // fetched afterwards.
    const speculativeRoutesPromise = prefetchPlanningRouteDurations(draft, locale, {
      concurrency: 3,
      maxLegs: 36,
      signal: controller.signal,
    }).catch(() => null);

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
    let publicCount = 0;
    let socialCount = 0;
    const localFreshVoices: Record<string, FreshState> = {};
    if (!aiEnabledRef.current) {
      // Social checks are paused server-side. Skip the stage honestly instead
      // of running checks that are guaranteed to fail one by one.
      const pausedState: FreshState = { status: "paused", result: null };
      for (const target of targetMap.values()) {
        for (const stopId of target.stopIds) localFreshVoices[stopId] = pausedState;
      }
      if (!commit(() => setFreshVoices(localFreshVoices))) return;
    } else {
    const publicTargets = [...targetMap.values()].flatMap((target) => {
      if (remainingSearchUnits <= 0) return [];
      const preferredUnits = target.intent === "hotel" ? 2 : 1;
      const units = Math.min(preferredUnits, remainingSearchUnits);
      remainingSearchUnits -= units;
      return [{ ...target, depth: units === 2 ? "deep" as const : "quick" as const }];
    });
    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "public", current: 0, total: publicTargets.length, publicCount: 0, socialCount: 0 })))) return;
    const publicResults = await mapWithConcurrency(publicTargets, 4, async (target) => {
      try {
        const result = await requestFreshVoices({ name: target.name, area: target.area }, locale, { intent: target.intent, depth: target.depth, signal: controller.signal });
        publicCount += result.findings.length;
        socialCount += result.findings.filter((finding) => finding.sourceKind === "social").length;
        return { target, state: { status: "ready", result } satisfies FreshState };
      } catch (error) {
        const paused = error instanceof PlaceIntelligenceError && error.code === "not_configured";
        return { target, state: { status: paused ? "paused" : "unavailable", result: null } satisfies FreshState };
      }
    }, (current, total) => {
      commit(() => setBuildProgress((progress) => ({ ...progress, current, total, publicCount, socialCount })));
    }, cancelled);
    if (cancelled()) return;
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
      food.candidates = rankFoodWithPublicEvidence(food.candidates, evidenceByCandidateId).slice(0, 3);
    }
    if (!commit(() => {
      setFreshVoices(localFreshVoices);
      setFoodSearches({ ...localFoodSearches });
      setHotelState(localHotelState);
    })) return;
    }

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
      setBuildProgress((current) => ({ ...current, stage: "routes", current: 0, total: plannedRouteLegs, reviewCount, publicCount, socialCount }));
    })) return;
    let measuredTransit: Record<string, number> = {};
    let measuredWalking: Record<string, number> = {};
    let measuredDriving: Record<string, number> = {};
    const attemptedRouteKeys = new Set<string>();
    const measuredOkKeys = new Set<string>();
    const measuredLegIds = new Set<string>();
    try {
      const speculative = await speculativeRoutesPromise;
      if (cancelled()) return;
      if (speculative) {
        measuredTransit = { ...speculative.transitMinutes };
        measuredWalking = { ...speculative.walkingMinutes };
        measuredDriving = { ...speculative.drivingMinutes };
        for (const leg of speculative.legs) {
          attemptedRouteKeys.add(planningRouteRequestKey(leg));
          if (leg.status === "ok") {
            measuredOkKeys.add(planningRouteRequestKey(leg));
            measuredLegIds.add(leg.id);
          }
        }
        if (!commit(() => setBuildProgress((current) => ({ ...current, current: Math.min(measuredLegIds.size, plannedRouteLegs), total: plannedRouteLegs })))) return;
      }
      // Only the delta between the probed draft and the evidence-adjusted
      // route is requested here — usually zero or a handful of legs.
      const remaining = await prefetchPlanningRouteDurations(routeDraft, locale, {
        concurrency: 3,
        maxLegs: 36,
        excludeKeys: measuredOkKeys,
        signal: controller.signal,
      });
      if (cancelled()) return;
      measuredTransit = { ...measuredTransit, ...remaining.transitMinutes };
      measuredWalking = { ...measuredWalking, ...remaining.walkingMinutes };
      measuredDriving = { ...measuredDriving, ...remaining.drivingMinutes };
      for (const leg of remaining.legs) {
        attemptedRouteKeys.add(planningRouteRequestKey(leg));
        if (leg.status === "ok") measuredLegIds.add(leg.id);
      }
      if (!commit(() => setBuildProgress((current) => ({ ...current, current: Math.min(measuredLegIds.size, plannedRouteLegs), total: plannedRouteLegs })))) return;
    } catch {
      if (cancelled()) return;
    }

    if (!commit(() => setBuildProgress((current) => ({
      ...current,
      stage: "scheduling",
      current: 0,
      total: 0,
      reviewCount,
      publicCount,
      socialCount,
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
      plannerContext(effectiveBase, overrides, earlyStops, localOpeningWindows, measuredTransit, measuredWalking, measuredDriving),
    );
    const finalSlots = finalDraft.foodRecommendationSlots;
    const reconciliation = reconcileFoodRecommendationSlots(slots, finalSlots, 20);
    // The finalize stage can trigger real work (moved meal slots and their
    // public re-checks); its progress stays visible so the build never looks
    // stalled while Claude searches run.
    if (!commit(() => setBuildProgress((current) => ({ ...current, total: reconciliation.refresh.length })))) return;
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
    }, (current) => {
      commit(() => setBuildProgress((progress) => ({ ...progress, current })));
    }, cancelled);
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
    const reanchoredTargets = aiEnabledRef.current
      ? [...reanchoredTargetMap.values()].slice(0, reanchorSearchUnits)
      : [];
    const reanchorProgressBase = reconciliation.refresh.length;
    if (reanchoredTargets.length > 0) {
      if (!commit(() => setBuildProgress((current) => ({
        ...current,
        current: reanchorProgressBase,
        total: reanchorProgressBase + reanchoredTargets.length,
      })))) return;
    }
    const reanchoredResults = await mapWithConcurrency(reanchoredTargets, 4, async (target) => {
      try {
        const result = await requestFreshVoices(
          { name: target.name, area: target.area },
          locale,
          { intent: "food", depth: "quick", signal: controller.signal },
        );
        publicCount += result.findings.length;
        socialCount += result.findings.filter((finding) => finding.sourceKind === "social").length;
        return { target, state: { status: "ready", result } satisfies FreshState };
      } catch {
        return { target, state: { status: "unavailable", result: null } satisfies FreshState };
      }
    }, (current) => {
      commit(() => setBuildProgress((progress) => ({ ...progress, current: reanchorProgressBase + current, publicCount, socialCount })));
    }, cancelled);
    if (cancelled()) return;
    for (const { target, state } of reanchoredResults) {
      for (const slotId of target.refs) {
        const food = finalFoodSearches[slotId];
        if (food) food.fresh[target.candidateId] = state;
      }
    }
    for (const food of Object.values(finalFoodSearches)) {
      const evidenceByCandidateId = Object.fromEntries(Object.entries(food.fresh).map(([candidateId, state]) => [candidateId, state.result]));
      food.candidates = rankFoodWithPublicEvidence(food.candidates, evidenceByCandidateId).slice(0, 3);
    }
    if (!commit(() => setFoodSearches(finalFoodSearches))) return;

    if (!commit(() => {
      attemptedLegKeysRef.current = attemptedRouteKeys;
      postBuildLegBudgetRef.current = 16;
      setBuildProgress((current) => ({ ...current, stage: "scheduling", current: 0, total: 0, reviewCount, publicCount, socialCount }));
      setDurationOverrides(overrides);
      setEarlyVisitStopIds(earlyStops);
      setOpeningWindowsByDay(localOpeningWindows);
      setLiveTransit(measuredTransit);
      setLiveDriving(measuredDriving);
      setLiveWalking(measuredWalking);
      setResolvedStops(places);
      setResolvedBase(effectiveBase);
      setHotelSearchSignature(hotelPlanSignature(finalDraft));
      setActiveDay(0);
      setHasPlan(true);
      setPlanReady(true);
      setHintDismissed(false);
      setPreviewStops([]);
      setIsBuilding(false);
      buildAbortRef.current = null;
      // Device-local history: the same self-contained code a share link uses.
      try {
        setRecentTrips(rememberRecentTrip(window.localStorage, {
          code: encodeTripShare({
            itinerary,
            tripDays,
            tripStartDate,
            hotelQuery,
            pace,
            mealPlan,
            travelPreference,
            arrivalAirport,
            arrivalTime,
            departureAirport,
            departureTime,
            dayStartDefault,
            dayEndTarget,
          }),
          title: finalDraft.days.find((candidate) => candidate.stops.length > 0)?.theme
            ?? itinerary.split("\n").find((line) => line.trim())?.trim()
            ?? "Trip",
          days: tripDays,
          startDate: tripStartDate,
          savedAt: new Date().toISOString(),
        }));
      } catch { /* private-mode storage stays optional */ }
    })) return;
  }

  function resetTrip() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    buildRunRef.current += 1;
    setItinerary("");
    setTravelPreference("auto");
    setDayStartDefault("09:00");
    setDayEndTarget("");
    setConcept("");
    setConceptError(null);
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
    setHotelSearchSignature("");
    setHotelRefreshing(false);
    setHotelRefreshFailed(false);
    setHotelUsesRecommendations(true);
    setHotelStayMode("single");
    setHotelStyle("recommended");
    setHotelPurpose("balanced");
    setNightlyHotels(emptyNightlyHotelState);
    setDurationOverrides({});
    setUserStayMinutes({});
    setEarlyVisitStopIds([]);
    setDayStartTimes({});
    setPreviewStops([]);
    setLiveTransit({});
    setLiveWalking({});
    setLiveDriving({});
    setLegModeOverrides({});
    setDayOverrides({});
    setMealSelections({});
    setRemovedStops([]);
    setOpeningWindowsByDay({});
    setInspector(null);
    setHasPlan(false);
    setPlanReady(false);
    setPlaceWarning(false);
    setActiveDay(0);
    setIsBuilding(false);
    setBuildProgress(initialBuildProgress);
  }

  function cancelBuild() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    buildRunRef.current += 1;
    setIsBuilding(false);
    setHasPlan(false);
    setPlanReady(false);
    setResolvedStops([]);
    setResolvedBase(null);
    setFoodSearches({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setHotelSearchSignature("");
    setHotelRefreshing(false);
    setHotelRefreshFailed(false);
    setHotelUsesRecommendations(true);
    setHotelStayMode("single");
    setHotelStyle("recommended");
    setHotelPurpose("balanced");
    setNightlyHotels(emptyNightlyHotelState);
    setDurationOverrides({});
    setUserStayMinutes({});
    setEarlyVisitStopIds([]);
    setDayStartTimes({});
    setPreviewStops([]);
    setLiveTransit({});
    setLiveWalking({});
    setLiveDriving({});
    setLegModeOverrides({});
    setDayOverrides({});
    setMealSelections({});
    setRemovedStops([]);
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
      const next: FoodState = { status: "ready", query, candidates: response.candidates.slice(0, 3), notes: {}, fresh: {} };
      setFoodSearches((current) => ({ ...current, [slot.id]: next }));
      // Public-evidence checks stay budgeted to the top two; the third pick
      // remains visible on Google evidence alone.
      for (const candidate of aiEnabledRef.current ? next.candidates.slice(0, 2) : []) {
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
    if (cachedIntel?.status === "ready" && (cachedFresh?.status === "ready" || cachedFresh?.status === "paused")) return;

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
    if (!aiEnabledRef.current) {
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "paused", result: null } }));
      return;
    }
    setFreshVoices((current) => ({ ...current, [stop.id]: { status: "loading", result: null } }));
    try {
      // One search per ordinary target; only the selected hotel earns a deeper check.
      const result = await requestFreshVoices({
        name: placeResult.place.name,
        area: placeResult.place.address.slice(0, 100) || stop.area,
      }, locale, { intent: "place", depth: "quick" });
      if (stale()) return;
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "ready", result } }));
    } catch (error) {
      if (stale()) return;
      const paused = error instanceof PlaceIntelligenceError && error.code === "not_configured";
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: paused ? "paused" : "unavailable", result: null } }));
    }
  }

  const selectedIntel = selectedBuiltStop ? intelligence[selectedBuiltStop.stop.id] : undefined;
  const selectedFresh = selectedBuiltStop ? freshVoices[selectedBuiltStop.stop.id] : undefined;
  const selectedCheckLoading = selectedIntel?.status === "loading" || selectedFresh?.status === "loading";
  // While social checks are paused, Google evidence alone completes a check.
  const selectedCheckReady = selectedIntel?.status === "ready" && (selectedFresh?.status === "ready" || selectedFresh?.status === "paused");
  const selectedCheckRetry = selectedIntel?.status === "unavailable" || selectedFresh?.status === "unavailable";
  const visibleBuildStages = aiEnabled ? buildStageOrder : buildStageOrder.filter((stage) => stage !== "public");
  const activeBuildIndex = visibleBuildStages.indexOf(buildProgress.stage);
  const activeBuildDetail = buildProgress.stage === "resolving"
    ? text.progressPlaces(buildProgress.current, buildProgress.total)
    : buildProgress.stage === "reviews"
      ? text.progressReviews(buildProgress.reviewCount)
      : buildProgress.stage === "food"
        ? text.progressFood(buildProgress.current, buildProgress.total)
        : buildProgress.stage === "public"
          ? text.progressPublic(buildProgress.current, buildProgress.total, buildProgress.publicCount, buildProgress.socialCount)
          : buildProgress.stage === "routes"
            ? text.progressRoutes(buildProgress.current, buildProgress.total)
          : buildProgress.stage === "scheduling"
            ? buildProgress.total > 0
              ? text.progressFinalize(buildProgress.current, buildProgress.total)
              : text.progressScheduling
            : selectedHotel?.name ?? (locale === "ja" ? "旅程に合うホテルを検索中" : "Searching hotels that fit the route");

  return (
    <main className="trip-planner-app">
      <header className="planner-topbar">
        <button className="planner-brand" onClick={resetTrip} type="button" aria-label="TripCheck home">
          <span className="planner-brand-mark" aria-hidden="true"><Icon name="mark" size={19} /></span>
          <b>TripCheck</b><small>{text.brandNote}</small>
        </button>
        <div className="planner-top-actions">
          <span className="planner-privacy"><i aria-hidden="true"><Icon name="check" size={10} /></i>{text.privacy}</span>
          <div className="planner-language" aria-label={text.language}>
            <button aria-pressed={locale === "ja"} className={locale === "ja" ? "is-active" : ""} onClick={() => changeLocale("ja")} type="button">日本語</button>
            <button aria-pressed={locale === "en"} className={locale === "en" ? "is-active" : ""} onClick={() => changeLocale("en")} type="button">EN</button>
          </div>
          {hasPlan ? <button className="planner-new-trip" onClick={resetTrip} type="button"><span aria-hidden="true"><Icon name="plus" size={14} /></span>{text.newTrip}</button> : null}
        </div>
      </header>

      <div className="planner-map-canvas" aria-label={text.mapReady}>
        <PlannerGoogleMap
          apiKey={mapsApiKey}
          base={displayedMapBase}
          endBase={hasPlan ? dayEndBase : null}
          departureTimes={routeDepartureTimes}
          drawRoute={hasPlan}
          foodPins={foodPins}
          hotelPins={hotelPins}
          inspectorOpen={Boolean(inspector)}
          locale={locale}
          onLegDurations={handleLegDurations}
          onSelectFood={handleSelectFoodPin}
          onSelectHotel={selectedHotel ? () => setInspector({ kind: "hotel" }) : undefined}
          onSelectHotelCandidate={(candidateId) => {
            const candidate = hotelState.candidates.find((entry) => entry.id === candidateId);
            if (candidate) selectHotelCandidate(candidate);
          }}
          onSelectStop={handleSelectStop}
          routeModes={routeModes}
          selectedFoodPinId={inspector?.kind === "food" ? inspector.candidateId ?? null : null}
          selectedHotelPinId={selectedHotel?.id ?? null}
          selectedStopId={inspector?.kind === "stop" ? inspector.stopId : inspector?.kind === "hotel" ? displayedMapBase?.id ?? null : null}
          stops={displayedMapStops}
        />

        {!day && !hasPlan && !isBuilding ? <div className="planner-map-empty"><span aria-hidden="true"><Icon name="pin" size={16} /></span><p>{text.mapEmpty}</p></div> : null}

        {day ? (
          <div className="planner-map-bottom">
            {selectedHotel ? (
              <button
                className={`planner-hotel-chip${inspector?.kind === "hotel" ? " is-active" : ""}`}
                onClick={() => setInspector(inspector?.kind === "hotel" ? null : { kind: "hotel" })}
                type="button"
              >
                <span aria-hidden="true"><Icon name="bed" size={15} /></span>{text.hotelChip}
              </button>
            ) : null}
            {daySlots.map((slot) => (
              <button
                className={`planner-meal-chip${inspector?.kind === "food" && inspector.slotId === slot.id ? " is-active" : ""}`}
                key={slot.id}
                onClick={() => openFoodSlot(slot)}
                type="button"
              >
                <span aria-hidden="true"><Icon name={slot.kind === "lunch" ? "sun" : "moon"} size={15} /></span>
                {slot.kind === "lunch" ? text.lunchChip : text.dinnerChip}
              </button>
            ))}
            {day.googleMapsUrl ? (
              <a className="planner-open-maps" href={day.googleMapsUrl} rel="noreferrer" target="_blank">
                {text.openMaps}<span aria-hidden="true"><Icon name="external" size={14} /></span>
              </a>
            ) : null}
          </div>
        ) : null}

        {selectedBuiltStop ? (
          <aside className="planner-inspector" aria-label={selectedBuiltStop.stop.name}>
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num">{selectedStopIndex + 1}</span>
              <div>
                <h2>{selectedBuiltStop.stop.name}</h2>
                <p>{selectedBuiltStop.stop.area}</p>
              </div>
            </header>
            <div className="planner-inspector-meta">
              <span>{selectedBuiltStop.arrival}–{selectedBuiltStop.departure}</span>
              {selectedBuiltStop.fixedTime ? <span className="is-booked">{selectedBuiltStop.isReservation ? text.reservation : text.timePinned} {selectedBuiltStop.fixedTime}</span> : null}
              {selectedBuiltStop.reservationLateMinutes > 0 ? <span className="is-booked">{text.lateBy(selectedBuiltStop.reservationLateMinutes)}</span> : null}
              {selectedBuiltStop.priority === "must" ? <span className="is-must">{text.must}</span> : null}
              {selectedBuiltStop.priority === "optional" ? <span className="is-optional">{text.optional}</span> : null}
              {selectedBuiltStop.openingStatus === "verified_open" ? <span>{text.openingAdjusted}</span> : null}
              {selectedBuiltStop.openingStatus === "conflict" ? <span className="is-booked">{text.openingConflict}</span> : null}
              {selectedBuiltStop.openingStatus === "closed_day" ? <span className="is-booked">{text.openingClosedDay}</span> : null}
              {selectedBuiltStop.crowd ? (
                <span className="is-crowd">
                  {text.crowd[selectedBuiltStop.crowd.level]}{selectedBuiltStop.crowd.isWeekend ? text.crowdWeekend : ""}{text.crowdForecast}
                </span>
              ) : null}
            </div>
            <label className="planner-stay-edit">
              <span>{text.stayLabel}</span>
              <select
                onChange={(event) => {
                  const value = event.target.value;
                  const stopId = selectedBuiltStop.stop.id;
                  // Only the user's own edits live here; clearing back to auto
                  // re-exposes the evidence buffer kept in durationOverrides.
                  setUserStayMinutes((current) => {
                    if (!value) {
                      if (!(stopId in current)) return current;
                      const next = { ...current };
                      delete next[stopId];
                      return next;
                    }
                    return { ...current, [stopId]: Number(value) };
                  });
                }}
                value={String(userStayMinutes[selectedBuiltStop.stop.id] ?? "")}
              >
                <option value="">
                  {userStayMinutes[selectedBuiltStop.stop.id] == null
                    ? `${text.stayAuto} · ${text.minutes(selectedBuiltStop.stop.planningDurationMinutes)}`
                    : text.stayAuto}
                </option>
                {[30, 45, 60, 90, 120, 150, 180, 240].map((minutes) => (
                  <option key={minutes} value={minutes}>{text.minutes(minutes)}</option>
                ))}
              </select>
            </label>
            {plan && plan.days.length > 1 ? (
              <div className="planner-day-move" role="group" aria-label={text.moveDay}>
                <span>{text.moveDay}</span>
                <div>
                  {plan.days.map((_, dayIndex) => (
                    <button
                      aria-pressed={dayIndex === activeDay}
                      className={dayIndex === activeDay ? "is-active" : ""}
                      key={dayIndex}
                      onClick={() => moveStopToDay(selectedBuiltStop.stop.id, dayIndex)}
                      title={text.previewDay(dayIndex + 1)}
                      type="button"
                    >
                      {dayIndex + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button className="planner-remove-stop" onClick={() => removeStopFromPlan(selectedBuiltStop.stop)} type="button">
              <Icon name="close" size={11} />{text.removeStop}
            </button>
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
              const dayWindows = day?.date
                ? googleOpeningWindowsForDate({
                  businessStatus: intel.place.businessStatus,
                  regularOpeningPeriods: intel.place.regularOpeningPeriods,
                }, day.date)
                : null;
              const dayHoursText = dayWindows && dayWindows.length > 0
                ? dayWindows.map((window) => `${formatWindowClock(window.openMinutes)}–${formatWindowClock(window.closeMinutes)}`).join(" / ")
                : null;
              return (
                <section className="planner-intel-card" aria-label={`${selectedBuiltStop.stop.name} · ${text.fieldEvidence}`}>
                  <header>
                    <h3>{text.fieldEvidence}</h3>
                    <small>{intel.analyzedBy === "anthropic" ? text.aiAudited : text.rulesAudited}</small>
                  </header>
                  {intel.place.photoName ? (
                    <a className="planner-intel-hero" href={intel.place.googleMapsUrl} key={intel.place.photoName} rel="noreferrer" target="_blank">
                      {/* Google place photos are proxied at request time and are not stored. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={intel.place.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(intel.place.photoName)}`} />
                    </a>
                  ) : null}
                  {intel.place.photoAttribution ? (
                    <a className="planner-photo-credit" href={intel.place.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {intel.place.photoAttribution.name}</a>
                  ) : null}
                  <div className="planner-intel-facts">
                    <span className={intel.place.openNow === false ? "is-warning" : ""}>
                      {intel.place.openNow === true ? text.openNow : intel.place.openNow === false ? text.closedNow : text.hoursUnknown}
                    </span>
                    {dayWindows !== null ? (
                      dayHoursText
                        ? <span>{text.dayHours(dayHoursText)}</span>
                        : <span className="is-warning">{text.dayClosed}</span>
                    ) : null}
                    {listedPayment ? <span className={intel.place.payment.cashOnly === true ? "is-warning" : ""}>{listedPayment}</span> : null}
                    {intel.place.websiteUrl === null ? <span className="is-warning">{text.noWebsite}</span> : null}
                    {intel.place.rating !== null ? (
                      <span>★ {intel.place.rating.toFixed(1)} · {intel.place.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span>
                    ) : null}
                  </div>
                  {intel.place.address ? <p className="planner-intel-address">{intel.place.address}</p> : null}
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
                <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
                <p className="planner-fresh-status"><i aria-hidden="true" />{text.freshLoading}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "unavailable" ? (
              <section className="planner-fresh-card" aria-live="polite">
                <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
                <p className="planner-fresh-empty">{text.freshUnavailable}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "paused" ? (
              <section className="planner-fresh-card">
                <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3></div></header>
                <p className="planner-fresh-empty">{text.freshPaused}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "ready" && selectedFresh.result ? (() => {
              const fresh = selectedFresh.result;
              return (
                <details
                  className="planner-evidence-sources"
                  aria-label={`${selectedBuiltStop.stop.name} · ${text.freshHeading}`}
                  key={selectedBuiltStop.stop.id}
                  onToggle={(event) => {
                    if ((event.target as HTMLDetailsElement).open) ensureSourcePreviews(fresh.findings.slice(0, 3).map((finding) => finding.url));
                  }}
                >
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
                          {sourcePreviews[finding.url]?.imageUrl ? <>
                            {/* Open Graph preview from the cited page itself; broken images fall back to the media badge. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt="" className="planner-fresh-thumb" loading="lazy" onError={handlePhotoError} referrerPolicy="no-referrer" src={sourcePreviews[finding.url].imageUrl ?? undefined} />
                          </> : null}
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
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-hotel" aria-hidden="true"><Icon name="bed" size={17} /></span>
              <div>
                <h2>{hotelStayMode === "nightly" ? text.stayNightly : selectedHotel.name}</h2>
                <p>{text.hotelCandidate}</p>
              </div>
            </header>
            {hotelUsesRecommendations && hotelStayMode === "single" ? (
              <div className={`planner-hotel-refresh-wrap${hotelPlanDirty ? " is-dirty" : ""}`}>
                {hotelPlanDirty ? <p>{text.hotelRefreshHint}</p> : null}
                <button className="planner-hotel-refresh" disabled={hotelRefreshing || !plan} onClick={() => void refreshHotelRecommendations()} type="button">
                  <Icon name="search" size={14} />
                  {hotelRefreshing ? text.hotelRefreshing : hotelPlanDirty ? text.hotelRefreshChanged : text.hotelRefresh}
                </button>
                {hotelRefreshFailed ? <small role="status">{text.hotelRefreshFailed}</small> : null}
              </div>
            ) : null}
            {hotelRouteContext && hotelRouteContext.spreadKm >= 70 ? (
              <div className="planner-hotel-wide-note">
                <Icon name="train" size={15} />
                <p>{text.hotelWideTrip}</p>
                <button onClick={() => void enableNightlyHotels()} type="button">{text.stayNightly}</button>
              </div>
            ) : null}
            {plan && plan.days.length >= 2 ? (
              <div className="planner-stay-mode" role="group" aria-label={text.stayModeHeading}>
                <button
                  aria-pressed={hotelStayMode === "single"}
                  className={hotelStayMode === "single" ? "is-active" : ""}
                  onClick={() => setHotelStayMode("single")}
                  type="button"
                >
                  {text.staySame}
                </button>
                <button
                  aria-pressed={hotelStayMode === "nightly"}
                  className={hotelStayMode === "nightly" ? "is-active" : ""}
                  onClick={() => void enableNightlyHotels()}
                  type="button"
                >
                  {text.stayNightly}
                </button>
              </div>
            ) : null}
            {(() => {
              if (hotelStayMode !== "nightly") return null;
              const nightCandidates = nightlyHotels.status === "ready" ? nightlyHotels.nights.flatMap((night) => night.candidates) : [];
              const styleAvailable = (style: HotelStyle) => hotelState.candidates.some((candidate) => candidate.styles.includes(style))
                || nightCandidates.some((candidate) => candidate.styles.includes(style));
              if (!styleAvailable("luxury") && !styleAvailable("value")) return null;
              const choices: Array<{ value: HotelStyleChoice; label: string; enabled: boolean }> = [
                { value: "recommended", label: text.styleRecommended, enabled: true },
                { value: "luxury", label: text.styleLuxury, enabled: styleAvailable("luxury") },
                { value: "value", label: text.styleValue, enabled: styleAvailable("value") },
              ];
              return (
                <div className="planner-hotel-styles" role="group" aria-label={text.styleNote}>
                  {choices.map((choice) => (
                    <button
                      aria-pressed={hotelStyle === choice.value}
                      className={hotelStyle === choice.value ? "is-active" : ""}
                      disabled={!choice.enabled}
                      key={choice.value}
                      onClick={() => applyHotelStyle(choice.value)}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              );
            })()}
            {hotelStayMode === "nightly" ? (
              <div className="planner-night-list">
                {nightlyHotels.status === "loading" ? <p className="planner-food-status" role="status">{text.nightlyLoading}</p> : null}
                {nightlyHotels.status === "unavailable" ? <p className="planner-food-status">{text.nightlyUnavailable}</p> : null}
                {nightlyHotels.status === "ready" ? nightlyHotels.nights.map((night, nightIndex) => {
                  const selected = night.candidates.find((candidate) => candidate.id === night.selectedId) ?? null;
                  return (
                    <section className="planner-night" key={`night-${nightIndex}`}>
                      <header><b>{text.nightLabel(nightIndex + 1)}</b><small>{night.area}</small></header>
                      {selected ? (
                        <>
                          <a className="planner-night-hotel" href={selected.googleMapsUrl} rel="noreferrer" target="_blank">
                            <b>{selected.name}</b>
                            <span>
                              {[
                                selected.rating !== null ? `★ ${selected.rating.toFixed(1)}` : null,
                                hotelPriceLabel(selected),
                                formatDistanceMeters(selected.routeAverageDistanceMeters),
                                selected.styles.includes("luxury") ? text.styleLuxury : selected.styles.includes("value") ? text.styleValue : null,
                              ].filter(Boolean).join(" · ")}
                            </span>
                          </a>
                          {night.candidates.length > 1 ? (
                            <div className="planner-night-alts">
                              {night.candidates.filter((candidate) => candidate.id !== selected.id).slice(0, 3).map((candidate) => (
                                <button key={candidate.id} onClick={() => selectNightCandidate(nightIndex, candidate.id)} title={text.useThisHotel} type="button">
                                  <span>{candidate.name}</span>
                                  <small>{[candidate.rating !== null ? `★ ${candidate.rating.toFixed(1)}` : null, hotelPriceLabel(candidate), formatDistanceMeters(candidate.routeAverageDistanceMeters)].filter(Boolean).join(" · ")}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : <p className="planner-food-status">{text.nightlyNightMissing}</p>}
                    </section>
                  );
                }) : null}
                <p className="planner-food-note">{text.hotelRankNote} {text.styleNote} {text.hotelNoAvailability}</p>
              </div>
            ) : (<>
            {hotelUsesRecommendations ? <div className="planner-hotel-purpose">
              <b>{text.hotelPurposeHeading}</b>
              <div role="group" aria-label={text.hotelPurposeHeading}>
                {([
                  { purpose: "balanced" as const, label: text.hotelPurposeBalanced, id: hotelState.candidates[0]?.id ?? null },
                  { purpose: "nearest" as const, label: text.hotelPurposeNearest, id: hotelAxis.nearestId },
                  { purpose: "rated" as const, label: text.hotelPurposeRated, id: hotelAxis.topRatedId },
                  { purpose: "value" as const, label: text.hotelPurposeValue, id: hotelAxis.valueId },
                ]).map((choice) => {
                  const candidate = choice.id ? hotelState.candidates.find((item) => item.id === choice.id) ?? null : null;
                  return (
                    <button
                      aria-pressed={hotelPurpose === choice.purpose}
                      className={hotelPurpose === choice.purpose ? "is-active" : ""}
                      disabled={!candidate}
                      key={choice.purpose}
                      onClick={() => candidate && selectHotelCandidate(candidate, choice.purpose)}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
              <small>{text.hotelPurposeHelp}</small>
            </div> : null}
            {renderHotelComparison()}
            <p className="planner-hotel-reason">
              {!hotelUsesRecommendations ? text.hotelReasonSpecified
                : hotelPurpose === "nearest" ? text.hotelReasonNearest
                : hotelPurpose === "rated" ? text.hotelReasonRated
                  : hotelPurpose === "value" ? text.hotelReasonValue
                    : hotelPurpose === "balanced" ? text.hotelReasonTop
                      : text.hotelReasonPicked}
            </p>
            <a className="planner-hotel-hero" href={selectedHotel.googleMapsUrl} key={selectedHotel.id} rel="noreferrer" target="_blank">
              {selectedHotel.photo ? <>
                {/* Google place photos are proxied at request time and are not stored. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={selectedHotel.name} onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(selectedHotel.photo.name)}`} />
              </> : <span aria-hidden="true"><Icon name="bed" size={26} /></span>}
              <i>{hotelPriceLabel(selectedHotel)}</i>
            </a>
            {selectedHotel.photo?.attribution ? <a className="planner-photo-credit" href={selectedHotel.photo.attribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {selectedHotel.photo.attribution.name} ↗</a> : null}
            <div className="planner-hotel-facts">
              {selectedHotel.rating !== null ? <span className="is-rating">★ {selectedHotel.rating.toFixed(1)} · {selectedHotel.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span> : null}
              <span className={selectedHotel.rakuten?.minCharge ? "is-price" : ""}>{hotelPriceLabel(selectedHotel)}</span>
              <span>{text.distanceFrom(formatDistanceMeters(selectedHotel.routeAverageDistanceMeters))}</span>
              {hotelAxisLabels(selectedHotel).map((label) => <span className="is-axis" key={label}>{label}</span>)}
              {selectedHotel.styles.includes("luxury") ? <span>{text.styleLuxury}</span> : null}
              {selectedHotel.styles.includes("value") ? <span>{text.styleValue}</span> : null}
              {selectedHotel.rakuten?.reviewAverage ? (
                <a className="is-rakuten" href={selectedHotel.rakuten.url} rel="noreferrer" target="_blank">
                  {text.rakutenTag(selectedHotel.rakuten.reviewAverage, selectedHotel.rakuten.reviewCount ?? 0)} ↗
                </a>
              ) : null}
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
              <details
                className="planner-evidence-sources"
                onToggle={(event) => {
                  if ((event.target as HTMLDetailsElement).open) ensureSourcePreviews((hotelState.fresh.result?.findings ?? []).slice(0, 3).map((finding) => finding.url));
                }}
              >
                <summary>{text.publicSources} · {hotelState.fresh.result.findings.length}</summary>
                <div className="planner-fresh-list">
                  {hotelState.fresh.result.findings.map((finding) => (
                    <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                      <div><span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span><small>{finding.age ?? text.freshAgeUnknown}</small></div>
                      <b>{finding.title}</b><p>{finding.note}</p>
                      {sourcePreviews[finding.url]?.imageUrl ? <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt="" className="planner-fresh-thumb" loading="lazy" onError={handlePhotoError} referrerPolicy="no-referrer" src={sourcePreviews[finding.url].imageUrl ?? undefined} />
                      </> : null}
                      <i aria-hidden="true">↗</i>
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            <p className="planner-food-note">
              {text.hotelRankNote} {hasRakutenHotelEvidence ? `${text.hotelPriceNote} ` : ""}{text.styleNote} {text.hotelNoAvailability}
            </p>
            </>)}
          </aside>
        ) : null}

        {activeFoodSlot && activeFoodState ? (
          <aside className="planner-inspector is-food" aria-label={text.mealIdeas}>
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-food" aria-hidden="true"><Icon name={activeFoodSlot.kind === "lunch" ? "sun" : "moon"} size={17} /></span>
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
                          <img alt={candidate.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
                        </> : <span aria-hidden="true"><Icon name="fork" size={20} /></span>}
                        <i className="planner-food-badge">{index + 1}</i>
                      </a>
                      <div>
                        <small>{note?.tag ?? (index === 0 ? (locale === "ja" ? "この土地なら、まずここ" : "Start here") : candidate.type)}</small>
                        <h3>{candidate.name}</h3>
                        <p>{note?.reason ?? foodCandidateReason(candidate, locale)}</p>
                        <div className="planner-food-stats">
                          {candidate.rating !== null ? <span className="is-rating">★ {candidate.rating.toFixed(1)} · {candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span> : null}
                          {candidate.plannedOpen === true ? <span>{text.plannedOpen}</span> : candidate.plannedOpen == null && candidate.openNow === true ? <span>{text.openNow}</span> : null}
                          {candidate.paymentEvidence[0] ? <span>{candidate.paymentEvidence[0].label}</span> : null}
                          {foodFresh?.findings.length ? <span className="is-fresh">{text.foodFresh(foodFresh.findings.length)}</span> : null}
                        </div>
                        <button
                          className={`planner-meal-choose${mealSelections[activeFoodSlot.id] === candidate.id ? " is-active" : ""}`}
                          onClick={() => toggleMealSelection(activeFoodSlot.id, candidate.id)}
                          type="button"
                        >
                          {mealSelections[activeFoodSlot.id] === candidate.id ? (<><Icon name="check" size={11} />{text.mealChosen}</>) : text.mealChoose}
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
              <div><h1>{text.buildingTitle}</h1><p>{aiEnabled ? text.buildingBody : text.buildingBodyNoSocial}</p></div>
            </header>
            <ol className="planner-building-steps">
              {visibleBuildStages.map((stage, index) => {
                const state = index < activeBuildIndex ? "is-complete" : index === activeBuildIndex ? "is-active" : "";
                return (
                  <li className={state} key={stage}>
                    <span className="planner-building-step-dot" aria-hidden="true">{index < activeBuildIndex ? <Icon name="check" size={11} /> : index + 1}</span>
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

            {aiEnabled ? <div className="planner-concept">
              <span>{text.conceptLabel}</span>
              <div className="planner-concept-row">
                <input
                  onChange={(event) => setConcept(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runConceptDraft();
                    }
                  }}
                  placeholder={text.conceptPlaceholder}
                  value={concept}
                />
                <button disabled={concept.trim().length < 2 || conceptLoading} onClick={() => void runConceptDraft()} type="button">
                  {conceptLoading ? text.conceptRunning : text.conceptRun}
                </button>
              </div>
              <small className={conceptError ? "is-error" : ""}>
                {conceptError === "not_configured"
                  ? text.conceptNotConfigured
                  : conceptError === "rate_limited"
                    ? text.conceptRateLimited
                    : conceptError === "unavailable"
                      ? text.conceptUnavailable
                      : text.conceptNote}
              </small>
            </div> : null}

            <label className="planner-composer">
              <span>{text.inputLabel}</span>
              <textarea
                autoFocus
                id="trip-input"
                onChange={(event) => setItinerary(event.target.value)}
                placeholder={text.placeholder}
                value={itinerary}
              />
              <button onClick={loadDemo} type="button"><span aria-hidden="true"><Icon name="spark" size={13} /></span>{text.sample}</button>
            </label>
            <p className="planner-parse-hint">{text.parseHint}</p>

            {parsePreviewRows.length > 0 ? (
              <div className="planner-parse-preview">
                <div className="planner-parse-head">
                  <span className="planner-parse-title">{text.previewHeading(parsedPlaceCount)}</span>
                  {canNormalizeItinerary ? <button onClick={() => setItinerary(formattedItinerary)} type="button">{text.previewFormat}</button> : null}
                </div>
                <ul>
                  {parsePreviewRows.slice(0, 30).map((row, index) => row.type === "day" ? (
                    <li className="is-day" key={`row-${index}`}><b>{text.previewDay(row.day)}</b></li>
                  ) : row.type === "warn" ? (
                    <li className="is-warn" key={`row-${index}`}><span>{row.raw}</span><small>{text.previewUnparsed}</small></li>
                  ) : (
                    <li key={`row-${index}`}>
                      <span>{row.place.name}</span>
                      <span className="planner-parse-chips">
                        {row.showDay && row.place.day !== null ? <i>{text.previewDay(row.place.day)}</i> : null}
                        {row.place.time ? <i className="is-time">{row.place.time}{row.place.isReservation ? ` ${text.reservation}` : ""}</i> : row.place.isReservation ? <i className="is-time">{text.reservation}</i> : null}
                        {row.place.priority === "must" && !row.place.isReservation ? <i className="is-must">{text.must}</i> : null}
                        {row.place.priority === "optional" ? <i className="is-opt">{text.optional}</i> : null}
                        {row.place.stayMinutes !== null ? <i>{text.previewStay(row.place.stayMinutes)}</i> : null}
                      </span>
                    </li>
                  ))}
                  {parsePreviewRows.length > 30 ? <li className="is-more"><small>+{parsePreviewRows.length - 30}</small></li> : null}
                </ul>
                <small className="planner-parse-check">{text.previewCheck}</small>
              </div>
            ) : null}

            <div className="planner-primary-fields">
              <label><span>{text.days}</span><select onChange={(event) => setTripDays(Number(event.target.value))} value={tripDays}>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{locale === "ja" ? `${value}日` : `${value} day${value === 1 ? "" : "s"}`}</option>)}</select></label>
              <label><span>{text.date}</span><input onChange={(event) => setTripStartDate(event.target.value)} type="date" value={tripStartDate} /></label>
            </div>

            <label className="planner-hotel-field"><span>{text.hotel}</span><input onChange={(event) => setHotelQuery(event.target.value)} placeholder={text.hotelPlaceholder} value={hotelQuery} /></label>

            <details className="planner-details">
              <summary>{text.details}<span aria-hidden="true"><Icon name="plus" size={15} /></span></summary>
              <div className="planner-detail-grid">
                <label><span>{text.arrival}</span><select onChange={(event) => setArrivalAirport(event.target.value as AirportCode)} value={arrivalAirport}>{airportChoices.map((airport) => <option key={airport.value} value={airport.value}>{airport.label}</option>)}</select></label>
                <label><span>{text.arrivalTime}</span><input disabled={arrivalAirport === "none"} onChange={(event) => setArrivalTime(event.target.value)} type="time" value={arrivalTime} /></label>
                <label><span>{text.departure}</span><select onChange={(event) => setDepartureAirport(event.target.value as AirportCode)} value={departureAirport}>{airportChoices.map((airport) => <option key={airport.value} value={airport.value}>{airport.label}</option>)}</select></label>
                <label><span>{text.departureTime}</span><input disabled={departureAirport === "none"} onChange={(event) => setDepartureTime(event.target.value)} type="time" value={departureTime} /></label>
                <div className="planner-choice"><span>{text.pace}</span><div className="planner-choice-chips" role="group" aria-label={text.pace}>{(["relaxed", "balanced", "fast"] as const).map((value) => <button aria-pressed={pace === value} className={pace === value ? "is-active" : ""} key={value} onClick={() => setPace(value)} type="button">{text[value]}</button>)}</div></div>
                <div className="planner-choice"><span>{text.travelHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.travelHeading}>{([["auto", text.travelAuto], ["car", text.travelCar]] as const).map(([value, label]) => <button aria-pressed={travelPreference === value} className={travelPreference === value ? "is-active" : ""} key={value} onClick={() => setTravelPreference(value)} type="button">{label}</button>)}</div></div>
                <div className="planner-choice"><span>{text.timebandHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.timebandHeading}>{([["08:00", text.timebandEarly], ["09:00", text.timebandNormal], ["10:30", text.timebandLate]] as const).map(([value, label]) => <button aria-pressed={dayStartDefault === value} className={dayStartDefault === value ? "is-active" : ""} key={value} onClick={() => setDayStartDefault(value)} type="button">{label}</button>)}</div></div>
                <div className="planner-choice"><span>{text.dayEndHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.dayEndHeading}>{([["", text.dayEndNone], ["19:30", "〜19:30"], ["21:30", "〜21:30"]] as const).map(([value, label]) => <button aria-pressed={dayEndTarget === value} className={dayEndTarget === value ? "is-active" : ""} key={value || "none"} onClick={() => setDayEndTarget(value)} type="button">{label}</button>)}</div></div>
                <div className="planner-choice"><span>{text.meal}</span><div className="planner-choice-chips" role="group" aria-label={text.meal}>{([["all", text.allMeals], ["dinner", text.dinner], ["none", text.noMeals]] as const).map(([value, label]) => <button aria-pressed={mealPlan === value} className={mealPlan === value ? "is-active" : ""} key={value} onClick={() => setMealPlan(value)} type="button">{label}</button>)}</div></div>
              </div>
            </details>

            <button className="planner-build-button" disabled={!canBuild} onClick={buildPlan} type="button">
              <span>{isBuilding ? text.building : text.build}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b>
            </button>
            {planReady && !isBuilding ? (
              <button className="planner-return-plan" onClick={() => setHasPlan(true)} type="button">
                {text.backToPlan}<Icon name="arrow" size={15} />
              </button>
            ) : null}

            {recentTrips.length > 0 ? (
              <div className="planner-recent">
                <span>{text.recentHeading}<small> · {text.recentNote}</small></span>
                <ul>
                  {recentTrips.map((entry) => (
                    <li key={entry.code}>
                      <button className="planner-recent-open" onClick={() => openRecentTrip(entry)} type="button">
                        <b>{entry.title}</b>
                        <small>{entry.startDate} · {text.recentDays(entry.days)}</small>
                      </button>
                      <button
                        aria-label={text.recentDelete}
                        className="planner-recent-remove"
                        onClick={() => setRecentTrips(forgetRecentTrip(window.localStorage, entry.code))}
                        type="button"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : plan && day ? (
          <div className="planner-result-view">
            <header className="planner-result-header">
              <div>
                <span>{text.planSummary(plan.requestedDays, plan.scheduledStopCount)}</span>
                <h1>{day.theme}</h1>
              </div>
              <div className="planner-result-actions">
                <button className={shareCopied ? "is-copied" : ""} onClick={() => void copyShareLink()} title={text.shareTitle} type="button">
                  {shareCopied ? text.shareCopied : text.share}
                </button>
                <button onClick={() => { setHasPlan(false); setInspector(null); }} type="button">{text.edit}</button>
              </div>
            </header>

            <div className="planner-evidence-summary" aria-label={locale === "ja" ? "予定に反映した根拠" : "Evidence used in this plan"}>
              <span className={buildProgress.socialCount > 0 ? "is-good" : buildProgress.publicCount > 0 ? "is-warning" : "is-muted"}>
                {buildProgress.publicCount > 0 ? text.publicEvidenceFound(buildProgress.publicCount, buildProgress.socialCount) : text.publicEvidenceMissing}
              </span>
              <span className={measuredRouteCount > 0 ? "is-good" : "is-warning"}>
                {measuredRouteCount > 0 ? text.routeEvidenceFound(measuredRouteCount) : text.routeEvidenceMissing}
              </span>
            </div>

            <div className="planner-day-tabs" aria-label={locale === "ja" ? "日程を選ぶ" : "Choose a day"}>
              {plan.days.map((candidate, index) => {
                const weekday = weekdayInfo(candidate.date, locale);
                return (
                  <button
                    aria-pressed={activeDay === index}
                    className={`${activeDay === index ? "is-active" : ""}${weekday?.isWeekend ? " is-weekend" : ""}`}
                    key={candidate.label}
                    onClick={() => switchDay(index)}
                    type="button"
                  >
                    <b>{index + 1}</b>
                    <span>
                      {candidate.date ? candidate.date.slice(5).replace("-", "/") : candidate.label}
                      {weekday ? ` ${weekday.label}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            {placeWarning && plan.unknownEntries.length === 0 ? <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.placeFallback}</p> : null}
            {hotelState.status === "unavailable" ? (
              <p className="planner-warning" role="status">
                <span aria-hidden="true">!</span>
                <span className="planner-warning-body">
                  {text.hotelUnavailable}{" "}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotelQuery.trim() || mapStops[0]?.area || "Japan"} ${locale === "ja" ? "ホテル" : "hotels"}`)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {text.hotelSearch} ↗
                  </a>
                </span>
              </p>
            ) : null}
            {plan.overCapacityCount > 0 ? <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.overCapacity}</p> : null}
            {plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 ? (
              <details className="planner-warning planner-excluded" role="status">
                <summary><span aria-hidden="true">!</span>{text.excludedHeading} · {plan.deferredUnavailableStops.length + plan.deferredOptionalStops.length}</summary>
                <ul>
                  {plan.deferredUnavailableStops.map((stop) => <li key={stop.id}><b>{stop.name}</b><small> — {text.excludedClosed}</small></li>)}
                  {plan.deferredOptionalStops.map((stop) => <li key={stop.id}><b>{stop.name}</b><small> — {text.excludedPace}</small></li>)}
                </ul>
              </details>
            ) : null}

            <section className="planner-day-summary">
              <div>
                <span>
                  {day.date
                    ? locale === "ja"
                      ? `${day.date}（${weekdayInfo(day.date, locale)?.label ?? ""}）`
                      : `${day.date} (${weekdayInfo(day.date, locale)?.label ?? ""})`
                    : day.label}
                </span>
                <b>{day.startTime}—{day.finishTime}</b>
                {dayTravelTotal > 0 ? <small className="planner-day-total">{text.travelTotal(dayTravelTotal)}</small> : null}
              </div>
              <label className="planner-day-start">
                <span>{text.dayStart}</span>
                <input
                  onChange={(event) => {
                    const value = event.target.value;
                    setDayStartTimes((current) => {
                      if (!value) {
                        if (!(activeDay in current)) return current;
                        const next = { ...current };
                        delete next[activeDay];
                        return next;
                      }
                      return { ...current, [activeDay]: value };
                    });
                  }}
                  type="time"
                  value={dayStartTimes[activeDay] ?? day.requestedStartTime}
                />
              </label>
              {day.deadlineOverrunMinutes > 0 && day.deadline
                ? <em>{day.deadlineKind === "curfew" ? text.curfewOver(day.deadline) : text.deadlineOver(day.deadline)}</em>
                : <small>{measuredRouteCount > 0 ? text.walkingSafety : text.estimated}</small>}
            </section>

            {hotelStayMode === "nightly" && day.endBase ? (
              <button className="planner-tonight" onClick={() => setInspector({ kind: "hotel" })} type="button">
                <span aria-hidden="true"><Icon name="bed" size={13} /></span>{text.tonightHotel(day.endBase.name)}
              </button>
            ) : null}

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
                    <Fragment key={`${builtStop.stop.id}-${index}`}>
                    {index === 0 && base && day.hotelOutboundMinutes !== null ? (
                      <li className="planner-hotel-leg">
                        <span aria-hidden="true"><Icon name="bed" size={12} /></span>
                        <span>{text.hotelDepartRow(modeLabel(day.hotelOutboundMode), day.hotelOutboundMinutes)}</span>
                      </li>
                    ) : null}
                    <li>
                      {leg && recommended ? (() => {
                        const legKey = routeLegKey(leg.from.id, leg.to.id);
                        const modeLabel = (mode: TransportMode) => mode === "taxi" && travelPreference === "car" ? text.moveCar : text.move[mode];
                        return (
                          <div className="planner-leg">
                            <div className="planner-leg-modes" role="group" aria-label={`${leg.from.name} → ${leg.to.name} · ${text.legModes}`}>
                              {leg.comparison.options
                                .filter((option) => option.mode !== "walk" || option.minutes <= 90)
                                .map((option) => (
                                  <button
                                    aria-pressed={option.mode === recommended.mode}
                                    className={option.mode === recommended.mode ? "is-active" : ""}
                                    key={option.mode}
                                    onClick={() => setLegMode(legKey, option.mode)}
                                    title={`${modeLabel(option.mode)} · ${text.legModes}`}
                                    type="button"
                                  >
                                    {modeIcon(option.mode, travelPreference === "car")}
                                    <b>{text.minutes(option.minutes)}</b>
                                  </button>
                                ))}
                            </div>
                            {recommended.source === "live" ? <em>{text.legLive}</em> : null}
                          </div>
                        );
                      })() : null}
                      <button
                        className={`planner-stop-row${isSelected ? " is-selected" : ""}`}
                        onClick={() => setInspector(isSelected ? null : { kind: "stop", stopId: builtStop.stop.id })}
                        type="button"
                      >
                        <time>{builtStop.arrival}</time>
                        <span className="planner-stop-dot">{index + 1}</span>
                        <span className="planner-stop-main">
                          <b>{builtStop.stop.name}</b>
                          <small>{builtStop.stop.area} · {text.previewStay(builtStop.stop.planningDurationMinutes)}</small>
                        </span>
                        <span className="planner-stop-flags">
                          {builtStop.fixedTime ? <i className="is-booked">{builtStop.fixedTime}</i> : null}
                          {builtStop.reservationLateMinutes > 0 ? <i className="is-booked">{text.lateShort(builtStop.reservationLateMinutes)}</i> : null}
                          {builtStop.priority === "must" ? <i className="is-must">{text.must}</i> : null}
                          {builtStop.priority === "optional" ? <i className="is-optional">{text.optional}</i> : null}
                          {stopIntel?.place.rating !== null && stopIntel?.place.rating !== undefined ? <i className="is-checked">★ {stopIntel.place.rating.toFixed(1)}</i> : checked ? <i className="is-checked" aria-hidden="true">✓</i> : null}
                          {publicSignals > 0 ? <i className="is-must">SNS {publicSignals}</i> : null}
                          {builtStop.openingStatus === "verified_open" ? <i className="is-checked">{text.openingAdjusted}</i> : null}
                          {builtStop.openingStatus === "conflict" ? <i className="is-booked">{text.openingConflict}</i> : null}
                          {builtStop.openingStatus === "closed_day" ? <i className="is-booked">{text.openingClosedDay}</i> : null}
                          {builtStop.openingStatus === "unknown" && stopIntel?.place.rating != null ? <i>{text.openingUnknown}</i> : null}
                        </span>
                      </button>
                    </li>
                    {mealRowsAfter(builtStop.stop.id, index === day.stops.length - 1)}
                    {index === day.stops.length - 1 && dayEndBase && day.hotelInboundMinutes !== null ? (
                      <li className="planner-hotel-leg is-return">
                        <span aria-hidden="true"><Icon name="bed" size={12} /></span>
                        <span>{text.hotelReturnRow(modeLabel(day.hotelInboundMode), day.hotelInboundMinutes)}</span>
                      </li>
                    ) : null}
                    </Fragment>
                  );
                })}
              </ol>
            )}

            {!hintDismissed ? <p className="planner-select-hint">{text.selectHint}</p> : null}

            {removedStops.length > 0 ? (
              <details className="planner-unknown planner-removed" open>
                <summary>{text.removedHeading} · {removedStops.length}</summary>
                <ul>
                  {removedStops.map((entry) => (
                    <li key={entry.id}>
                      {entry.name}
                      <button onClick={() => restoreRemovedStop(entry.id)} type="button">{text.restoreStop}</button>
                    </li>
                  ))}
                </ul>
                {hotelUsesRecommendations && hotelStayMode === "single" && hotelPlanDirty ? (
                  <div className="planner-removed-refresh">
                    <p>{text.hotelRefreshHint}</p>
                    <button className="planner-hotel-refresh" disabled={hotelRefreshing} onClick={() => void refreshHotelRecommendations()} type="button">
                      <Icon name="search" size={13} />
                      {hotelRefreshing ? text.hotelRefreshing : text.hotelRefreshChanged}
                    </button>
                    {hotelRefreshFailed ? <small role="status">{text.hotelRefreshFailed}</small> : null}
                  </div>
                ) : null}
              </details>
            ) : null}

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
            <button className="planner-build-button" onClick={() => setHasPlan(false)} type="button"><span>{text.edit}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b></button>
          </div>
        )}
      </section>
    </main>
  );
}
