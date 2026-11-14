"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { fetchAppleFoodCandidates } from "../../lib/apple-food";
import { budgetLabel, fetchHotpepperShops, inJapan, lunchPrice, shopsForMeal, type HotpepperShop } from "../../lib/hotpepper-client";
import { placeCardsAvailable } from "../../lib/apple-place-card";
import { AppleRelayError, appleRelayClient, appleRelaySearch } from "../../lib/apple-relay-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../../lib/google-food";
import { rerankHotelCandidates } from "../../lib/apple-hotels";
import type { HotelCandidate } from "../../lib/google-hotels";
import { requestHotelRecommendations } from "../../lib/hotel-recommendations-client";
import { requestPlaceResolution } from "../../lib/place-resolution-client";
import { curateSights, filterDestinations, type PopularDestination, type PopularSight } from "../../lib/popular-sights";
import { loadRailNetwork } from "../../lib/rail-network-client";
import type { RailNetwork } from "../../lib/rail-router";
import { fetchStreetRoute } from "../../lib/street-route-client";
import { addAnchor, openCandidate, openLookupHit, placeOfCandidate, putPlace, searchAddCandidates, type AddCandidate } from "../../lib/shiori/add-search";
import { BulkBudgetError, bulkAfterTripChange, bulkLeftover, bulkProgress, bulkSummary, bundledMatches, chooseBulk, confirmBulk, mergeBulk, requeueBulk, resolveBulk, startBulk, tripChange, type BulkLine, type BulkStatus } from "../../lib/shiori/bulk-add";
import { findCafes, withListedCafes, type CafeBreak, type CafePick } from "../../lib/shiori/cafes";
import { fetchedStamp, forecastCentre, loadForecast, wetDaysOf, type DayForecast, type ForecastAnswer, type ForecastCache } from "../../lib/shiori/forecast";
import { lineColor } from "../../lib/shiori/line-colors";
import { buildShioriPlan, departureAfterStop, type ShioriLeg, type ShioriMeal, type ShioriNotice, type ShioriPlace, type ShioriPlan, type ShioriRoute, type ShioriStop } from "../../lib/shiori/plan";
import {
  MAX_DAYS,
  MAX_PLACES,
  decodeTrip,
  durationText,
  emptyTrip,
  encodeTrip,
  keepAside,
  kindLabel,
  photoCreditUrl,
  photoUrl,
  placeFromSight,
  safePlaceId,
  storageStep,
  togglePlace,
  withCity,
  withStartDate,
  type ShioriTrip,
} from "../../lib/shiori/state";
import { FORECAST_DAYS_AHEAD, dateLabel, earliestStartDate, forecastWindow, tripDate, type ForecastWindow } from "../../lib/shiori/trip-dates";
import { isWetForecast, wetReason, type WetReason } from "../../lib/shiori/weather-days";
import type { WeatherKind } from "../../lib/weather";
import PlaceCard from "./PlaceCard";
import ShioriMap, { DAY_COLORS } from "./ShioriMap";

type Locale = "ja" | "en";
type Screen = "home" | "pick" | "plan";
const STORAGE_KEY = "shiori-trip-v1";
/** The booklet this device had before a shared link or another city replaced it. */
const PREVIOUS_KEY = "shiori-trip-prev";
/** Street paths already looked up, so a reopened booklet keeps its clock and lines offline. */
const ROUTES_KEY = "shiori-routes-v1";

function readTrip(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? decodeTrip(raw) : null;
  } catch {
    return null;
  }
}

function readRoutes(): Map<string, ShioriRoute> {
  const routes = new Map<string, ShioriRoute>();
  try {
    const stored = JSON.parse(window.localStorage.getItem(ROUTES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return routes;
    for (const entry of stored.slice(0, 160)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !/^(walk|drive)\|.{3,400}$/.test(entry[0]) || !Array.isArray(entry[2])) continue;
      const minutes = typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0 && entry[1] < 1_440 ? Math.round(entry[1]) : null;
      const path = entry[2].flatMap((point: unknown) => (
        Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number" && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180
          ? [{ latitude: point[0], longitude: point[1] }]
          : []
      )).slice(0, 80);
      if (path.length >= 2) routes.set(entry[0], { minutes, path });
    }
  } catch {
    // Unreadable storage is an empty cache.
  }
  return routes;
}

function writeRoutes(routes: ReadonlyMap<string, ShioriRoute | null>) {
  const entries = [...routes].flatMap(([key, route]) => {
    if (!route) return [];
    const stride = Math.max(1, (route.path.length - 1) / 59);
    const count = Math.min(route.path.length, 60);
    const path = Array.from({ length: count }, (_, index) => route.path[Math.min(route.path.length - 1, Math.round(index * stride))]);
    return [[key, route.minutes, path.map((point) => [Number(point.latitude.toFixed(5)), Number(point.longitude.toFixed(5))])]];
  }).slice(-120);
  try {
    window.localStorage.setItem(ROUTES_KEY, JSON.stringify(entries));
  } catch {
    // Full or private storage: the paths are looked up again next time.
  }
}
const FEATURED = ["tokyo", "kyoto", "osaka", "hongkong", "seoul", "taipei", "bangkok", "singapore", "paris", "london", "newyork", "honolulu"];

type AddKind = "place" | "lunch" | "dinner" | "hotel";

const text = {
  ja: {
    heroTitle: "どこに行く？",
    navLabel: "旅行の計画",
    language: "言語",
    nav: { home: "行き先", pick: "場所", plan: "予定" },
    daySummary: "1日の概要",
    legDetails: "乗り換え・移動の詳細",
    addPanel: "場所・お店・ホテルを追加",
    addShortcut: "場所を追加",
    stayShortcut: "ホテル",
    mapShortcut: "地図",
    where: "行き先",
    wherePlaceholder: "都市を検索（例：東京、パリ）",
    popular: "行き先を探す",
    noCity: "この行き先はまだ準備中です。近い都市を選ぶか、別の名前で試してください。",
    resume: "前回の予定を開く",
    resumePrevious: "その前の予定を開く",
    back: "もどる",
    pickTitle: (city: string) => `${city}で行きたい場所`,
    pickHint: "気になる場所を選んでください。あとから変更できます。",
    days: "日数",
    dayUnit: "日間",
    addOther: "名前で探す",
    addKinds: { place: "場所", lunch: "昼ごはんの店", dinner: "夜ごはんの店", hotel: "泊まるホテル" } as Record<AddKind, string>,
    addPlaceholders: { place: "場所の名前", lunch: "昼に行きたい店の名前", dinner: "夜に行きたい店の名前", hotel: "泊まりたいホテルの名前" } as Record<AddKind, string>,
    addHint: "選んだ店やホテルも移動時間に含めます。",
    mealLabels: { lunch: "昼ごはん（行きたい店）", dinner: "夜ごはん（行きたい店）" },
    hotelChip: "ホテル",
    wait: (minutes: string) => `ここで約${minutes}の空き時間（店の時間に合わせています）`,
    mealMissed: "この店に食事の時間帯に着けません。",
    noticesTitle: "このままだと無理がある点",
    noticeNeedsDays: (asked: number, days: number) => `この内容は${asked}日では回りきれません。${days}日あれば無理なく収まります。`,
    noticeNeedsDaysAction: (days: number) => `${days}日にする`,
    noticeDrop: (name: string, days: number) => `「${name}」を外すと、${days}日のまま収まります。`,
    noticeDropAction: "外す",
    noticeTooMuch: "行きたい場所が多く、1日増やしても収まりません。場所を減らすか、日数を大きく増やしてください。",
    noticeHotelFar: (oneWay: string, saved: string) => `このホテルは行き先から遠く、毎日片道 約${oneWay}かかります。下の「泊まる場所」のエリアにすると、旅行全体の移動が約${saved}減ります。`,
    noticeMealDetour: (name: string, meal: string, minutes: string) => `「${name}」（${meal}）は他の行き先から離れていて、寄るために約${minutes}余計に移動します。`,
    noticeMealTime: (name: string, meal: string) => `「${name}」に${meal}の時間帯に着ける日がありません。日数を増やすか、近くの場所と同じ日にしてください。`,
    noticeMealHotel: (name: string, minutes: string) => `夜ごはんの「${name}」からホテルまで約${minutes}かかります。`,
    mealShort: { lunch: "昼ごはん", dinner: "夜ごはん" },
    working: "予定を作成中…",
    updating: "予定を更新中…",
    cafe: "ひと休み",
    cafeOnTheWay: (from: string, to: string) => `${from}から${to}へ歩く途中`,
    cafeAfter: (from: string) => `${from}を出たあたり`,
    showCafes: "近くのカフェを見る",
    hideCafes: "閉じる",
    cafeDetour: (minutes: number) => minutes <= 1 ? "道の途中" : `寄り道 約${minutes}分`,
    cafeWalk: (minutes: number) => `徒歩約${Math.max(1, minutes)}分`,
    cafeAdd: "予定に入れる",
    cafeNote: "この日の動線から近い順です（歩く途中なら寄り道が少ない順）。評判や営業時間は地図で確認してください。",
    cafeNone: "近くにカフェが見つかりませんでした。",
    cafeKinds: { cafe: "カフェ", bakery: "ベーカリー" },
    add: "追加",
    adding: "探しています…",
    addFailed: "見つかりませんでした。正式な名前や地名を付けて試してください。",
    addSearch: "探す",
    addChoose: "どれを追加しますか？",
    addChooseHint: "地図の検索結果です。近い順ではなく、名前の合う順に出ます。違う場合は地名を足して探し直してください。",
    addKm: (km: number) => km < 1 ? "中心から1km以内" : `中心から約${Math.round(km)}km`,
    addCancel: "やめる",
    addedAs: (name: string, kind: AddKind) => kind === "hotel" ? `「${name}」を泊まるホテルにしました。` : kind === "place" ? `「${name}」を追加しました。` : `「${name}」を${kind === "lunch" ? "昼" : "夜"}ごはんの店として追加しました。`,
    addedWhere: (day: number) => `${day}日目に入りました。`,
    addedSee: "予定で見る",
    addFull: `一度に組めるのは${MAX_PLACES}か所までです。`,
    bulkOpen: "リストをまとめて貼る",
    bulkLabel: "行きたい場所のリスト（1行に1つ）",
    bulkPlaceholder: "浅草寺\n東京タワー\n上野公園",
    bulkHint: (room: number) => `あと${room}か所まで。追加する前に、見つかった場所を確認できます。`,
    bulkCheck: "確認する",
    bulkChecking: (at: number, total: number) => `${at} / ${total} を確認中`,
    bulkChecked: "確認が終わりました。",
    bulkLeftOut: (count: number) => `${count}件は入りきらないため確認していません（1つの旅は${MAX_PLACES}か所まで）。`,
    bulkBudget: "地図検索の利用上限に達したため、ここで止めました。残りの行は検索していません。時間をおいてやり直してください。",
    bulkStatus: { waiting: "順番待ち", checking: "確認中", found: "見つかりました", choose: "選んでください", missing: "見つかりません", failed: "検索できませんでした", already: "追加済み", repeat: "上の行と同じ場所", added: "追加しました" } as Record<BulkStatus, string>,
    bulkSearchedAs: (query: string) => `「${query}」で検索`,
    bulkChooseFor: (text: string) => `「${text}」はどれですか`,
    bulkSkip: "追加しない",
    bulkEdit: (text: string) => `「${text}」を書き直す`,
    bulkAgain: "探し直す",
    bulkRetry: "やり直す",
    bulkSummary: (add: number, held: number) => `${add}件を追加します・${held}件は保留`,
    bulkAdd: (count: number) => `${count}件を追加`,
    bulkAdded: (count: number) => `${count}件を追加しました。`,
    bulkOver: (count: number) => `${count}件は入りきりませんでした（1つの旅は${MAX_PLACES}か所まで）。`,
    bulkHeld: "保留の行は、閉じると入力欄に戻ります。",
    bulkClose: "閉じる",
    selected: (count: number) => `${count}か所を選択中`,
    make: "予定を作る",
    needOne: "場所を1つ以上選んでください",
    showMore: "もっと見る",
    planTitle: (city: string, days: number) => `${city} ${days}日間`,
    editPlaces: "場所を選び直す",
    share: "リンクをコピー",
    shared: "コピーしました",
    print: "印刷",
    dayTab: (index: number) => `${index + 1}日目`,
    freeTab: "空き日",
    loads: { easy: "ゆとりのある日", normal: "ちょうどいい日", tight: "詰まっている日" },
    loadTight: "移動や立ち寄りが多めです。1か所を別の日に移すか、減らすと楽になります。",
    rainTitle: "雨の日なら（屋内の候補）",
    // What a wet day's forecast says: only rain is called rain.
    wetForecast: { rain: "雨の予報", snow: "雪の予報", storm: "荒天の予報", chance: "降水確率が高い予報" } as Record<WetReason, string>,
    rainTitleWet: (forecast: string) => `${forecast}です（屋内の候補）`,
    startDate: "出発日",
    optional: "（任意）",
    startDateHint: "入れると、日付と天気予報を予定に反映します。",
    weatherKinds: { clear: "晴れ", partly: "晴れ時々くもり", cloudy: "くもり", fog: "霧", rain: "雨", snow: "雪", storm: "雷雨" },
    rainChance: (percent: number) => `降水確率 ${percent}%`,
    forecastTag: "予報",
    forecastBy: "予報:",
    forecastFetched: (time: string) => `${time} 取得`,
    forecastFailed: "天気を取得できませんでした。",
    forecastLater: (day: number, date: string, whole: boolean) => whole
      ? `天気予報は${date}ごろから反映します（予報があるのは${FORECAST_DAYS_AHEAD}日先まで）。`
      : `${day}日目以降の天気予報は${date}ごろから反映します。`,
    weatherOrder: (days: Array<{ day: number; forecast: string }>) => `${days.map((entry) => `${entry.day}日目は${entry.forecast}`).join("、")}のため、そこに屋外で過ごす時間が短い日を入れました。予報は変わることがあります。`,
    checkHours: "営業日・営業時間・予約を地図で確認 ↗",
    hoursNote: "営業時間・定休日・予約の要否は未確認です。各スポットを開いて確認してください。",
    hoursNotePrint: "営業時間・定休日・予約の要否は未確認です。出発前に各スポットの公式案内で確認してください。",
    shareLine: "LINEで送る",
    late: "この日は予定が多めです。日数を増やすか、場所を減らすと楽になります。",
    stay: "滞在",
    shorter: "滞在を15分短く",
    longer: "滞在を15分長く",
    remove: "予定から外す",
    moveDay: "日を変える",
    auto: "おまかせ",
    walk: "徒歩",
    rail: "電車",
    transit: "電車・バス",
    taxi: "タクシー",
    about: "約",
    minute: "分",
    estimate: "目安",
    openMaps: "地図アプリで行き方を見る",
    openTimetable: "この時刻の電車・番線・運賃を調べる（Yahoo!乗換案内）",
    walkTo: (minutes: number, station: string) => `徒歩${minutes}分で ${station}`,
    walkFrom: (minutes: number, station: string) => `${station} から徒歩${minutes}分`,
    ride: (stops: number, minutes: number) => `${stops}駅・約${minutes}分`,
    change: "乗り換え",
    fromHotel: "ホテルを出発",
    toHotel: "ホテルへ戻る",
    lunch: "昼ごはん",
    dinner: "夜ごはん",
    mealNear: (name: string) => `${name}の近く`,
    showFood: "近くのお店を見る",
    hideFood: "閉じる",
    foodLoading: "近くのお店を探しています…",
    foodNone: "近くのお店の情報を取得できませんでした。地図アプリで探せます。",
    foodNote: "近い順です。評価や営業時間は地図アプリで確認してください。",
    shopNote: "ホットペッパーグルメに載っている店を近い順に出しています（載っていない店は出ません）。予算は店が載せている目安で、評判や空席は店のページで確認してください。",
    shopNoteLunch: "ホットペッパーグルメに載っている店のうち、ランチ料金の記載がある食事の店を先に、近い順で出しています（居酒屋・バーは後ろ。載っていない店は出ません）。評判や空席は店のページで確認してください。",
    shopBudget: (band: string) => `夜の予算 ${band}`,
    shopLunch: (price: string) => `ランチ ${price}〜`,
    shopPrice: (band: string) => `予算 ${band}`,
    shopAdd: "この店にする",
    walkAbout: (minutes: number) => `徒歩約${minutes}分`,
    ideasTitle: "近くのスポットを追加",
    ideasAdd: "追加",
    freeTitle: (count: number) => `あと${count}日、空いています`,
    freeBody: "空いた日に追加できる場所です。",
    freeNone: "空いた日は自由行動にできます。",
    leftOut: "入りきらなかった場所",
    stayTitle: "泊まる場所",
    stayBody: "移動の少ないエリアから探しています。料金・空室は予約サイトで確認してください。",
    stayAround: (name: string) => `おすすめのエリア：${name}の周辺`,
    stayLoading: "ホテルを探しています…",
    stayNone: "ホテル候補を取得できませんでした。",
    useHotel: "ここを拠点にする",
    usingHotel: "拠点にしています",
    clearHotel: "拠点を外す",
    searchRakuten: "楽天トラベルで探す",
    searchBooking: "Booking.comで探す",
    hotelDistance: (meters: number) => `各日の行き先まで平均 約${meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters / 10) * 10}m`}`,
    note: "所要時間は目安です。電車の区間は駅と路線のつながりから計算しており、時刻表ではありません。出発前に地図アプリで確認してください。",
    credits: "地図 © OpenStreetMap contributors / OpenFreeMap ・ スポットと駅のデータ Wikidata ・ 写真 Wikimedia Commons",
    photo: "写真",
    mapLabel: "旅程の地図",
    legendRail: "電車（駅をつないだ線）",
    legendWalk: "徒歩・車（実際の道）",
    legendOther: "道順を取得できなかった区間（直線）",
    newTrip: "新しい旅行",
    privacy: "プライバシー",
    classic: "以前の画面",
    brand: "TripCheck",
    otherCities: "ほかの街は\n上の欄に入力",
    coverMeta: (days: number, places: number) => `${days}日間 ・ ${places}か所`,
    daysTabs: "日ごとの予定",
    facts: { time: "時間", places: "行き先", moving: "移動", walking: "うち歩き" },
    placeUnit: "か所",
    movingTotal: (span: string) => `約${span}`,
    walkingAbout: (minutes: number) => `約${minutes}分`,
    steps: (count: number) => `約${count.toLocaleString("ja-JP")}歩`,
    nextDayMark: "翌",
    nextDayLabel: "翌日",
    short: { edit: "選び直す", share: "リンク", shared: "コピー済", line: "LINE", print: "印刷" },
    parts: { morning: "朝", noon: "昼", evening: "夕" },
    rideStops: (stops: number) => `${stops}駅`,
    rideLabel: "乗車",
    changeWalk: (minutes: number) => `乗り換え 約${minutes}分`,
    legWhen: (from: string, to: string) => `${from}発 → ${to}ごろ着`,
    legChain: "乗り継ぎの順番",
    legWalking: (minutes: number) => `徒歩 計${minutes}分`,
    legChanges: (count: number) => `乗り換え${count}回`,
    legDirect: "乗り換えなし",
    mapExpand: "地図を広げる",
    mapCollapse: "地図をたたむ",
    mapView: "予定で見る",
    close: "閉じる",
    mapFailed: "地図を読み込めませんでした。予定は引き続き確認できます。",
    pinLabel: (dayIndex: number, position: number, name: string) => `${dayIndex + 1}日目 ${position + 1}番 ${name}`,
    hotelMark: "泊",
    dayNav: "前後の日",
    staySep: "",
  },
  en: {
    heroTitle: "Where to?",
    navLabel: "Trip planning",
    language: "Language",
    nav: { home: "Destinations", pick: "Places", plan: "Itinerary" },
    daySummary: "Day overview",
    legDetails: "Journey details",
    addPanel: "Add a place, restaurant or hotel",
    addShortcut: "Add a place",
    stayShortcut: "Hotels",
    mapShortcut: "Map",
    where: "Destination",
    wherePlaceholder: "Type a destination (e.g. Kyoto, Paris)",
    popular: "Explore destinations",
    noCity: "This destination is not ready yet. Try a nearby city or another spelling.",
    resume: "Open your last trip",
    resumePrevious: "Open your previous trip",
    back: "Back",
    pickTitle: (city: string) => `Places to visit in ${city}`,
    pickHint: "You can add or remove places later.",
    days: "Days",
    dayUnit: " days",
    addOther: "Search by name",
    addKinds: { place: "Place", lunch: "Lunch spot", dinner: "Dinner spot", hotel: "Hotel" } as Record<AddKind, string>,
    addPlaceholders: { place: "Place name", lunch: "Restaurant for lunch", dinner: "Restaurant for dinner", hotel: "Hotel you want to stay at" } as Record<AddKind, string>,
    addHint: "Your restaurants and hotel are included in travel times.",
    mealLabels: { lunch: "Lunch (your pick)", dinner: "Dinner (your pick)" },
    hotelChip: "Hotel",
    wait: (minutes: string) => `About ${minutes} free here (timed for the restaurant)`,
    mealMissed: "This restaurant cannot be reached during the meal.",
    noticesTitle: "What does not work as it stands",
    noticeNeedsDays: (asked: number, days: number) => `This does not fit in ${asked} day${asked === 1 ? "" : "s"}. It fits comfortably in ${days}.`,
    noticeNeedsDaysAction: (days: number) => `Make it ${days} days`,
    noticeDrop: (name: string, days: number) => `Without “${name}” it fits in ${days} day${days === 1 ? "" : "s"}.`,
    noticeDropAction: "Remove",
    noticeTooMuch: "There is too much here even with one more day. Drop some places or add several days.",
    noticeHotelFar: (oneWay: string, saved: string) => `This hotel is far from your places: about ${oneWay} each way, every day. Staying in the area suggested below saves about ${saved} over the trip.`,
    noticeMealDetour: (name: string, meal: string, minutes: string) => `“${name}” (${meal}) is away from everything else; going there adds about ${minutes} of travel.`,
    noticeMealTime: (name: string, meal: string) => `No day reaches “${name}” at ${meal} time. Add a day, or plan places near it on the same day.`,
    noticeMealHotel: (name: string, minutes: string) => `From dinner at “${name}” it is about ${minutes} back to the hotel.`,
    mealShort: { lunch: "lunch", dinner: "dinner" },
    working: "Planning your trip…",
    updating: "Re-planning…",
    cafe: "Take a break",
    cafeOnTheWay: (from: string, to: string) => `on the walk from ${from} to ${to}`,
    cafeAfter: (from: string) => `around ${from}`,
    showCafes: "Cafés nearby",
    hideCafes: "Close",
    cafeDetour: (minutes: number) => minutes <= 1 ? "on your way" : `${minutes} min off your way`,
    cafeWalk: (minutes: number) => `${Math.max(1, minutes)} min walk`,
    cafeAdd: "Add to the plan",
    cafeNote: "Nearest to this day's route first (on a walk: least off your way). Check reviews and hours on the map.",
    cafeNone: "No café found nearby.",
    cafeKinds: { cafe: "Café", bakery: "Bakery" },
    add: "Add",
    adding: "Searching…",
    addFailed: "Not found. Try the full name or add the area.",
    addSearch: "Search",
    addChoose: "Which one?",
    addChooseHint: "Results from the map search, best name match first. If none is right, add the area and search again.",
    addKm: (km: number) => km < 1 ? "within 1 km of the centre" : `about ${Math.round(km)} km from the centre`,
    addCancel: "Cancel",
    addedAs: (name: string, kind: AddKind) => kind === "hotel" ? `${name} is now your hotel.` : kind === "place" ? `Added ${name}.` : `Added ${name} for ${kind}.`,
    addedWhere: (day: number) => `It is on day ${day}.`,
    addedSee: "Show in the plan",
    addFull: `One trip holds up to ${MAX_PLACES} places.`,
    bulkOpen: "Paste a list",
    bulkLabel: "Your list of places (one per line)",
    bulkPlaceholder: "Senso-ji\nTokyo Tower\nUeno Park",
    bulkHint: (room: number) => `Room for ${room} more. You check what was found before anything is added.`,
    bulkCheck: "Check the list",
    bulkChecking: (at: number, total: number) => `Checking ${at} of ${total}`,
    bulkChecked: "Finished checking.",
    bulkLeftOut: (count: number) => `${count} ${count === 1 ? "line was" : "lines were"} not checked: one trip holds up to ${MAX_PLACES} places.`,
    bulkBudget: "The map search has reached its usage limit, so the check stopped here. The remaining lines were not searched. Please try again later.",
    bulkStatus: { waiting: "Waiting", checking: "Checking", found: "Found", choose: "Please choose", missing: "Not found", failed: "Could not search", already: "Already added", repeat: "Same place as a line above", added: "Added" } as Record<BulkStatus, string>,
    bulkSearchedAs: (query: string) => `searched as "${query}"`,
    bulkChooseFor: (text: string) => `Which one is "${text}"?`,
    bulkSkip: "Don't add",
    bulkEdit: (text: string) => `Rewrite "${text}"`,
    bulkAgain: "Search again",
    bulkRetry: "Retry",
    bulkSummary: (add: number, held: number) => `${add} to add · ${held} on hold`,
    bulkAdd: (count: number) => `Add ${count}`,
    bulkAdded: (count: number) => `Added ${count} ${count === 1 ? "place" : "places"}.`,
    bulkOver: (count: number) => `${count} did not fit: one trip holds up to ${MAX_PLACES} places.`,
    bulkHeld: "Lines on hold go back into the box when you close.",
    bulkClose: "Close",
    selected: (count: number) => `${count} selected`,
    make: "Plan my trip",
    needOne: "Pick at least one place",
    showMore: "Show more",
    planTitle: (city: string, days: number) => `${city}: ${days}-day trip`,
    editPlaces: "Change places",
    share: "Copy link",
    shared: "Copied",
    print: "Print",
    dayTab: (index: number) => `Day ${index + 1}`,
    freeTab: "Free",
    loads: { easy: "An easy day", normal: "A comfortable day", tight: "A packed day" },
    loadTight: "A lot of moving or many stops. Moving one place to another day, or dropping one, makes it easier.",
    rainTitle: "If it rains (indoor ideas)",
    wetForecast: { rain: "Rain is forecast", snow: "Snow is forecast", storm: "Stormy weather is forecast", chance: "A high chance of precipitation is forecast" } as Record<WetReason, string>,
    rainTitleWet: (forecast: string) => `${forecast} (indoor ideas)`,
    startDate: "Start date",
    optional: " (optional)",
    startDateHint: "Adds dates and the weather forecast to the plan.",
    weatherKinds: { clear: "Clear", partly: "Partly cloudy", cloudy: "Cloudy", fog: "Fog", rain: "Rain", snow: "Snow", storm: "Thunderstorm" },
    rainChance: (percent: number) => `rain chance ${percent}%`,
    forecastTag: "Forecast",
    forecastBy: "Forecast:",
    forecastFetched: (time: string) => `fetched ${time}`,
    forecastFailed: "Could not get the weather forecast.",
    forecastLater: (day: number, date: string, whole: boolean) => whole
      ? `The weather forecast is added from about ${date} (forecasts reach ${FORECAST_DAYS_AHEAD} days ahead).`
      : `The forecast for day ${day} onward is added from about ${date}.`,
    weatherOrder: (days: Array<{ day: number; forecast: string }>) => `${days.map((entry, index) => `${index === 0 ? entry.forecast : entry.forecast.charAt(0).toLowerCase() + entry.forecast.slice(1)} for day ${entry.day}`).join(" and ")}, so the day with less time outdoors was put there. Forecasts change.`,
    checkHours: "Check opening days, hours and booking on the map ↗",
    hoursNote: "Opening hours, closed days and booking requirements are not checked. Open each place to confirm before you go.",
    hoursNotePrint: "Opening hours, closed days and booking requirements are not checked. Confirm on each place's website before you go.",
    shareLine: "Send on LINE",
    late: "This day is full. Add a day or drop a place to ease it.",
    stay: "Stay",
    shorter: "15 minutes shorter",
    longer: "15 minutes longer",
    remove: "Remove",
    moveDay: "Move to",
    auto: "Auto",
    walk: "Walk",
    rail: "Train",
    transit: "Transit",
    taxi: "Taxi",
    about: "~",
    minute: " min",
    estimate: "estimate",
    openMaps: "Directions in a maps app",
    openTimetable: "Exact trains, platform and fare (Yahoo! Transit, Japanese)",
    walkTo: (minutes: number, station: string) => `${minutes} min walk to ${station}`,
    walkFrom: (minutes: number, station: string) => `${minutes} min walk from ${station}`,
    ride: (stops: number, minutes: number) => `${stops} stops · ~${minutes} min`,
    change: "Change",
    fromHotel: "Leave the hotel",
    toHotel: "Back to the hotel",
    lunch: "Lunch",
    dinner: "Dinner",
    mealNear: (name: string) => `near ${name}`,
    showFood: "Places to eat nearby",
    hideFood: "Hide",
    foodLoading: "Looking nearby…",
    foodNone: "Could not load places nearby. A maps app can.",
    foodNote: "Nearest first. Check ratings and hours in a maps app.",
    shopNote: "Restaurants listed on HotPepper Gourmet, nearest first (unlisted places are not shown). Budgets are the restaurant's own guide; check reviews and seats on its page.",
    shopNoteLunch: "From HotPepper Gourmet: places for eating that state a lunch price first, nearest first (izakaya and bars after; unlisted places are not shown). Check reviews and seats on the restaurant's page.",
    shopBudget: (band: string) => `dinner budget ${band}`,
    shopLunch: (price: string) => `lunch from ${price}`,
    shopPrice: (band: string) => `budget ${band}`,
    shopAdd: "Choose this one",
    walkAbout: (minutes: number) => `~${minutes} min walk`,
    ideasTitle: "Add a nearby place",
    ideasAdd: "Add",
    freeTitle: (count: number) => `${count} more day${count === 1 ? "" : "s"} free`,
    freeBody: "Places to add on your free days:",
    freeNone: "Keep the spare days open.",
    leftOut: "Did not fit",
    stayTitle: "Where to stay",
    stayBody: "Hotels in areas with less travel. Check prices and availability on a booking site.",
    stayAround: (name: string) => `Suggested area: around ${name}`,
    stayLoading: "Looking for hotels…",
    stayNone: "Could not load hotels.",
    useHotel: "Use as my base",
    usingHotel: "Your base",
    clearHotel: "Clear base",
    searchRakuten: "Rakuten Travel",
    searchBooking: "Booking.com",
    hotelDistance: (meters: number) => `~${meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`} on average from each day's places`,
    note: "Durations are estimates. Train legs come from how stations and lines connect, not from a timetable. Check a maps app before you go.",
    credits: "Map © OpenStreetMap contributors / OpenFreeMap · Sights and stations: Wikidata · Photos: Wikimedia Commons",
    photo: "Photo",
    mapLabel: "Trip map",
    legendRail: "Train (through its stations)",
    legendWalk: "On foot or by road (the actual streets)",
    legendOther: "No route found (straight line)",
    newTrip: "New trip",
    privacy: "Privacy",
    classic: "Previous version",
    brand: "TripCheck",
    otherCities: "Type any other\ncity above",
    coverMeta: (days: number, places: number) => `${days} day${days === 1 ? "" : "s"} · ${places} place${places === 1 ? "" : "s"}`,
    daysTabs: "Days",
    facts: { time: "Time", places: "Places", moving: "Moving", walking: "On foot" },
    placeUnit: " places",
    movingTotal: (span: string) => `~${span}`,
    walkingAbout: (minutes: number) => `~${minutes} min`,
    steps: (count: number) => `~${count.toLocaleString("en-US")} steps`,
    nextDayMark: "+1",
    nextDayLabel: "next day",
    short: { edit: "Places", share: "Link", shared: "Copied", line: "LINE", print: "Print" },
    parts: { morning: "Morning", noon: "Afternoon", evening: "Evening" },
    rideStops: (stops: number) => `${stops} stop${stops === 1 ? "" : "s"}`,
    rideLabel: "Ride",
    changeWalk: (minutes: number) => `Change · ~${minutes} min`,
    legWhen: (from: string, to: string) => `leave ${from} → arrive ~${to}`,
    legChain: "Order of the journey",
    legWalking: (minutes: number) => `${minutes} min on foot in all`,
    legChanges: (count: number) => `${count} change${count === 1 ? "" : "s"}`,
    legDirect: "no change",
    mapExpand: "Expand map",
    mapCollapse: "Collapse map",
    mapView: "Show in itinerary",
    close: "Close",
    mapFailed: "The map could not be loaded. Your itinerary is still available.",
    pinLabel: (dayIndex: number, position: number, name: string) => `Day ${dayIndex + 1}, stop ${position + 1}: ${name}`,
    hotelMark: "H",
    dayNav: "Other days",
    staySep: " ",
  },
};

type IconName = "walk" | "rail" | "bus" | "taxi" | "meal" | "bed" | "check" | "plus" | "pin" | "back" | "link" | "send" | "printer" | "cup" | "clock" | "info" | "spark" | "umbrella" | "book" | "warn" | "sun" | "cloudsun" | "cloud" | "fog" | "rain" | "snow" | "storm";

/** The symbol for each kind of forecast day. */
const WEATHER_ICON: Record<WeatherKind, IconName> = { clear: "sun", partly: "cloudsun", cloudy: "cloud", fog: "fog", rain: "rain", snow: "snow", storm: "storm" };
const CLOUD = "M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4.25 4.25 0 0 1 .5 8.5H7Z";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    walk: "M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 9l3-1.5 2.5 2.5 2.5 1M12 7.5 11 13l2.5 3 .5 5M11 13l-2 3-2.5 4",
    rail: "M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 17l-2 3M16 17l2 3",
    bus: "M6 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM5 12h14M8 15h.01M16 15h.01M7 17v2M17 17v2",
    taxi: "M5 16v-3l1.5-4h11L19 13v3M5 16h14M5 16v2M19 16v2M7.5 13.5h.01M16.5 13.5h.01M10 9V7h4v2",
    meal: "M7 3v7a2 2 0 0 0 2 2v9M11 3v7M9 3v7M16 3c-1.5 2-2 4-2 7h2v11",
    bed: "M4 18v-9M4 13h16v5M20 13v-1a3 3 0 0 0-3-3h-6v4M7.5 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
    check: "M5 12.5 10 17.5 19 7",
    plus: "M12 5v14M5 12h14",
    pin: "M12 21s6.5-5.7 6.5-10.8a6.5 6.5 0 1 0-13 0C5.500 15.3 12 21 12 21ZM12 12.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z",
    back: "M19 12H5M11 6l-6 6 6 6",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    send: "M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z",
    printer: "M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z",
    cup: "M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2M4 21h13",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
    spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
    umbrella: "M12 3v1M4 12a8 8 0 0 1 16 0H4ZM12 12v7a2 2 0 0 1-4 0",
    book: "M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4ZM5 18a2 2 0 0 1 2-2h11M9 8h5",
    warn: "M12 4 3 20h18L12 4ZM12 10v5M12 17.5h.01",
    sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
    cloudsun: "M8 4.5V3M3 9.500H1.500M4.5 6 3.400 4.900M11.500 6l1.100-1.100M5 11.800A3.500 3.500 0 1 1 11.300 8.300M9 20a3.500 3.500 0 0 1-.4-6.980A4.800 4.800 0 0 1 17.800 13.600 3.300 3.300 0 0 1 17.500 20H9Z",
    cloud: "M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a4.25 4.25 0 0 1 .5 8.5H7Z",
    fog: "M5 8h14M3 12h18M6 16h12M9 20h6",
    rain: `${CLOUD}M8 18l-1 3M12 18l-1 3M16 18l-1 3`,
    snow: `${CLOUD}M8 18.500h.01M12 18.500h.01M16 18.500h.01M10 21.500h.01M14 21.500h.01`,
    storm: `${CLOUD}M13 16l-2.500 3h3L11 22`,
  };
  return (
    <svg aria-hidden="true" className="shiori-icon" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d={paths[name]} />
    </svg>
  );
}

/** Digits stay large; the words around them ("計", "分", " min") are set small. */
function withUnits(value: string): ReactNode[] {
  return value.split(/(\d[\d:,.]*)/).map((part, index) => index % 2 === 1 ? part : part ? <small key={index}>{part}</small> : null);
}

/**
 * Japanese has no spaces to break at, so a heading made of names is given its
 * phrases: each stays whole on a line where it fits, with its mark attached.
 */
function phrases(value: string, mark = "・"): ReactNode {
  const parts = value.split(mark);
  if (parts.length < 2) return value;
  return parts.map((part, index) => <span className="shiori-nb" key={index}>{part}{index < parts.length - 1 ? mark : ""}</span>);
}

/** The same sentence, kept whole from the name in it to its end ("…：浅草寺の周辺"). */
function withName(sentence: string, name: string): ReactNode {
  const at = name ? sentence.indexOf(name) : -1;
  if (at < 0) return sentence;
  return <>{sentence.slice(0, at)}<span className="shiori-nb">{sentence.slice(at)}</span></>;
}

/** A clock time past midnight belongs to the next day; "01:45" alone cannot say so. */
function NextDay({ locale }: { locale: Locale }) {
  return <span aria-label={text[locale].nextDayLabel} className="shiori-next" role="img">{text[locale].nextDayMark}</span>;
}

function Photo({ img, alt, width, icon = "pin" }: { img?: string; alt: string; width: number; icon?: IconName }) {
  const url = photoUrl(img, width);
  // A photo that will not load is no photo: the card shows its plain tile,
  // never the browser's broken-image mark.
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span aria-hidden="true" className="shiori-photo is-empty"><Icon name={icon} /></span>;
  // Commons thumbnails are remote and of unknown size; next/image cannot
  // optimise them on a static host.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className="shiori-photo" decoding="async" loading="lazy" onError={() => setFailed(true)} src={url} />;
}

/** Yahoo! 乗換案内 for two stations, leaving at this time today (the booklet has no dates). */
function transitSearchUrl(from: string, to: string, time: string) {
  const station = (name: string) => name.replace(/(駅|停留場|停留所)$/, "");
  const [hour, minute] = time.split(":").map(Number);
  const now = new Date();
  const query = new URLSearchParams({
    from: station(from), to: station(to),
    y: String(now.getFullYear()), m: String(now.getMonth() + 1), d: String(now.getDate()),
    hh: String(hour), m1: String(Math.floor(minute / 10)), m2: String(minute % 10), type: "1",
  });
  return `https://transit.yahoo.co.jp/search/result?${query}`;
}

/** "09:08" plus minutes, wrapping past midnight. */
function clockPlus(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (((hour * 60 + minute + minutes) % 1_440) + 1_440) % 1_440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function LegCard({ leg, locale, heading, depart }: { leg: ShioriLeg; locale: Locale; heading?: string; depart?: string }) {
  const t = text[locale];
  // The way a maps app sums a journey up: when, how long, and the chain of
  // walk › line › line › walk; the tickets below are the detail.
  const walking = leg.rail ? leg.rail.walkToMinutes + leg.rail.walkFromMinutes + leg.rail.transferMinutes : 0;
  // The booklet has no timetable of its own. In Japan the stations and the
  // planned time are handed to a transit search, which has the exact trains,
  // the platform and the fare.
  const timetable = leg.rail && depart && inJapan(leg.from) ? transitSearchUrl(leg.rail.rides[0].from, leg.rail.rides.at(-1)!.to, clockPlus(depart, leg.rail.walkToMinutes)) : null;
  const label = leg.mode === "walk" ? t.walk : leg.mode === "rail" ? t.rail : leg.mode === "taxi" ? t.taxi : t.transit;
  const icon = leg.mode === "walk" ? "walk" : leg.mode === "rail" ? "rail" : leg.mode === "taxi" ? "taxi" : "bus";
  // One change of train: the minutes on foot belong to it. With several, the
  // total cannot be split between them, so none is given a number.
  const change = leg.rail && leg.rail.rides.length === 2 && leg.rail.transferMinutes > 0 ? t.changeWalk(leg.rail.transferMinutes) : t.change;
  const links = (
    <div className="shiori-leg-links">
      {/* One way out, only where it adds something the booklet lacks. A train
          in Japan: the transit search has the actual trains, platform and
          fare. Elsewhere, or a taxi or bus estimate: a maps app's live
          directions. A short walk needs neither. */}
      {timetable ? <a className="shiori-leg-link" href={timetable} rel="noreferrer" target="_blank">{t.openTimetable} ↗</a>
        : leg.mode !== "walk" || leg.minutes >= 12 ? <a className="shiori-leg-link" href={leg.mapsUrl} rel="noreferrer" target="_blank">{t.openMaps} ↗</a> : null}
    </div>
  );
  return (
    <div className={`shiori-leg is-${leg.mode}`}>
      <div className="shiori-leg-head">
        {heading ? <small className="shiori-eyebrow">{heading}</small> : null}
        <span className="shiori-leg-title">
          <Icon name={icon} />
          <b>{label} {t.about}{leg.minutes}{t.minute}</b>
          {leg.mode === "transit" || leg.mode === "taxi" ? <i className="shiori-est">{t.estimate}</i> : null}
          {depart ? <span className="shiori-leg-when">{t.legWhen(depart, clockPlus(depart, leg.minutes))}</span> : null}
        </span>
        {leg.rail ? (
          <>
            <ol aria-label={t.legChain} className="shiori-chain">
              {[
                ...(leg.rail.walkToMinutes > 0 ? [<li className="is-walk" key="to"><Icon name="walk" /><span>{leg.rail.walkToMinutes}{t.minute}</span></li>] : []),
                ...leg.rail.rides.map((ride, index) => (
                  <li className="is-line" key={`${ride.from}-${ride.to}-${index}`} style={lineColor(ride.line) ? { ["--lc" as string]: lineColor(ride.line)! } : undefined}>
                    <i aria-hidden="true" /><span>{ride.line ?? t.rail}</span>
                  </li>
                )),
                ...(leg.rail.walkFromMinutes > 0 ? [<li className="is-walk" key="from"><Icon name="walk" /><span>{leg.rail.walkFromMinutes}{t.minute}</span></li>] : []),
              ].flatMap((item, index) => index === 0 ? [item] : [<li aria-hidden="true" className="is-sep" key={`sep-${index}`}>›</li>, item])}
            </ol>
            <p className="shiori-leg-facts">{[t.legWalking(walking), leg.rail.rides.length > 1 ? t.legChanges(leg.rail.rides.length - 1) : t.legDirect].join(" ・ ")}</p>
          </>
        ) : null}
      </div>
      {leg.rail ? (
        <details className="shiori-leg-details">
          <summary>{t.legDetails}</summary>
        <ol className="shiori-rail">
          <li className="is-walk"><Icon name="walk" />{t.walkTo(leg.rail.walkToMinutes, leg.rail.walkToStation)}</li>
          {leg.rail.rides.map((ride, index) => {
            const color = lineColor(ride.line);
            return (
              <li className="is-ride" key={`${ride.from}-${ride.to}-${index}`}>
                {index > 0 ? <em className="shiori-change">{change}</em> : null}
                <div className="shiori-ticket" style={color ? { ["--lc" as string]: color } : undefined}>
                  <i aria-hidden="true" className="shiori-ticket-bar" />
                  <div className="shiori-ticket-main">
                    <b className="shiori-ticket-line">{ride.line ?? t.rail}</b>
                    <span className="shiori-ticket-route">
                      <span>{ride.from}</span>
                      <span className="shiori-sr"> → </span>
                      <span>{ride.to}</span>
                    </span>
                    <small>{t.rideStops(ride.stops)}</small>
                  </div>
                  <div className="shiori-ticket-stub">
                    <small>{t.rideLabel}</small>
                    <b>{t.about}{ride.minutes}<span>{t.minute}</span></b>
                  </div>
                  <i aria-hidden="true" className="shiori-ticket-notch is-top" />
                  <i aria-hidden="true" className="shiori-ticket-notch is-bottom" />
                </div>
              </li>
            );
          })}
          <li className="is-walk"><Icon name="walk" />{t.walkFrom(leg.rail.walkFromMinutes, leg.rail.walkFromStation)}</li>
        </ol>
        </details>
      ) : null}
      {/* The way out to a maps app and the timetable stays one tap away, not two. */}
      {links}
    </div>
  );
}

function MealRow({ meal, locale, onAdd }: { meal: ShioriMeal; locale: Locale; onAdd: (shop: HotpepperShop, kind: "lunch" | "dinner") => void }) {
  const t = text[locale];
  const [state, setState] = useState<"closed" | "loading" | "ready" | "failed">("closed");
  const [candidates, setCandidates] = useState<FoodCandidate[]>([]);
  // In Japan the list comes with a photo and a budget when the shop guide has the area.
  const [shops, setShops] = useState<HotpepperShop[]>([]);
  const relay = useMemo(() => appleRelayClient(), []);
  const open = async () => {
    if (state !== "closed") { setState("closed"); return; }
    if (!relay) { setState("failed"); return; }
    setState("loading");
    try {
      if (inJapan(meal.near)) {
        const listed = await fetchHotpepperShops({ near: meal.near, withinMeters: 1000, meal: meal.kind });
        if (listed.length >= 3) {
          setShops(shopsForMeal(listed, meal.kind));
          setCandidates([]);
          setState("ready");
          return;
        }
      }
      setShops([]);
      const found = await fetchAppleFoodCandidates({
        latitude: meal.near.latitude,
        longitude: meal.near.longitude,
        area: meal.nearName.slice(0, 80) || "meal",
        mealKind: meal.kind,
        query: defaultFoodDiscoveryQuery(locale),
        languageCode: locale,
        destination: "auto",
      }, relay);
      setCandidates(found.slice(0, 5));
      setState(found.length > 0 ? "ready" : "failed");
    } catch {
      setState("failed");
    }
  };
  const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${locale === "ja" ? "レストラン" : "restaurants"} ${meal.near.latitude.toFixed(5)},${meal.near.longitude.toFixed(5)}`)}`;
  return (
    <div className="shiori-meal">
      <span aria-hidden="true" className="shiori-meal-mark"><Icon name="meal" /></span>
      <div className="shiori-meal-head">
        <span>
          <b>{meal.kind === "lunch" ? t.lunch : t.dinner}</b> <span className="shiori-meal-time">{meal.nextDay ? <NextDay locale={locale} /> : null}{meal.start}{meal.end ? `–${meal.end}` : locale === "ja" ? "ごろ" : ""}</span>
          <small><span className="shiori-sep"> ・ </span>{t.mealNear(meal.nearName)}</small>
        </span>
        <button aria-expanded={state !== "closed"} onClick={() => void open()} type="button">{state === "closed" ? t.showFood : t.hideFood}</button>
      </div>
      {state === "loading" ? <p className="shiori-quiet">{t.foodLoading}</p> : null}
      {state === "failed" ? <p className="shiori-quiet">{t.foodNone} <a href={mapsSearch} rel="noreferrer" target="_blank">Google Maps ↗</a></p> : null}
      {state === "ready" && shops.length > 0 ? (
        <>
          <ul className="shiori-food is-shops">
            {shops.map((shop) => (
              <li className="has-action" key={shop.id}>
                <a href={shop.url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${shop.address ?? ""}`)}`} rel="noreferrer" target="_blank">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser */}
                  {shop.photo ? <img alt="" decoding="async" height={72} loading="lazy" src={shop.photo} width={72} /> : null}
                  <span>
                    <b>{shop.name}</b>
                    <small>{[shop.genre, meal.kind === "lunch" && lunchPrice(shop.budgetAverage) ? t.shopLunch(lunchPrice(shop.budgetAverage)!) : budgetLabel(shop.budget) ? t.shopBudget(budgetLabel(shop.budget)!) : null].filter(Boolean).join(" ・ ")}</small>
                    <small>{t.walkAbout(Math.max(1, Math.round(shop.distanceMeters * 1.3 / 75)))} <i className="shiori-est">{t.estimate}</i></small>
                  </span>
                </a>
                <button onClick={() => onAdd(shop, meal.kind)} type="button">{t.shopAdd}</button>
              </li>
            ))}
          </ul>
          <p className="shiori-quiet">{meal.kind === "lunch" ? t.shopNoteLunch : t.shopNote}</p>
          {/* The provider's credit, in its own wording and markup (its guideline forbids altering either). */}
          <p className="shiori-quiet shiori-credit">【画像提供：ホットペッパー グルメ】 Powered by <a href="http://webservice.recruit.co.jp/">ホットペッパーグルメ Webサービス</a></p>
        </>
      ) : null}
      {state === "ready" && shops.length === 0 ? (
        <>
          <ul className="shiori-food">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <a href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
                  <b>{candidate.name}</b>
                  <small>{candidate.type}{typeof candidate.distanceMeters === "number" ? <>{` ・ ${t.walkAbout(Math.max(1, Math.round(candidate.distanceMeters * 1.3 / 75)))} `}<i className="shiori-est">{t.estimate}</i></> : null}</small>
                </a>
              </li>
            ))}
          </ul>
          <p className="shiori-quiet">{t.foodNote}</p>
        </>
      ) : null}
    </div>
  );
}

function CafeRow({ cafe, locale, onAdd }: { cafe: CafeBreak; locale: Locale; onAdd: (pick: CafePick) => void }) {
  const t = text[locale];
  const [state, setState] = useState<"closed" | "loading" | "ready" | "failed">("closed");
  const [picks, setPicks] = useState<CafePick[]>([]);
  const relay = useMemo(() => appleRelayClient(), []);
  const open = async () => {
    if (state !== "closed") { setState("closed"); return; }
    if (!relay) { setState("failed"); return; }
    setState("loading");
    try {
      // Asked together: the map's cafés in walking order, and — in Japan — the shop guide's, for photos and prices.
      const [nearby, listed] = await Promise.all([
        findCafes(cafe, relay, locale),
        inJapan(cafe.search) ? fetchHotpepperShops({ near: cafe.search, withinMeters: 1000, genre: "cafe" }) : Promise.resolve([]),
      ]);
      const found = listed.length > 0 ? withListedCafes(nearby, cafe, listed) : nearby;
      setPicks(found);
      setState(found.length > 0 ? "ready" : "failed");
    } catch {
      setState("failed");
    }
  };
  const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${locale === "ja" ? "カフェ" : "cafe"} ${cafe.search.latitude.toFixed(5)},${cafe.search.longitude.toFixed(5)}`)}`;
  return (
    <div className="shiori-meal is-cafe">
      <span aria-hidden="true" className="shiori-meal-mark"><Icon name="cup" /></span>
      <div className="shiori-meal-head">
        <span>
          <b>{t.cafe}</b> <span className="shiori-meal-time">{cafe.time}{locale === "ja" ? "ごろ" : ""}</span>
          <small><span className="shiori-sep"> ・ </span>{cafe.reason === "on-the-way" && cafe.toName ? t.cafeOnTheWay(cafe.fromName, cafe.toName) : t.cafeAfter(cafe.fromName)}</small>
        </span>
        <button aria-expanded={state !== "closed"} onClick={() => void open()} type="button">{state === "closed" ? t.showCafes : t.hideCafes}</button>
      </div>
      {state === "loading" ? <p className="shiori-quiet">{t.foodLoading}</p> : null}
      {state === "failed" ? <p className="shiori-quiet">{t.cafeNone} <a href={mapsSearch} rel="noreferrer" target="_blank">Google Maps ↗</a></p> : null}
      {state === "ready" ? (
        <>
          <ul className={`shiori-food${picks.some((pick) => pick.photo) ? " is-shops" : ""}`}>
            {picks.map((pick) => (
              <li className="has-action" key={pick.id}>
                <a href={pick.mapsUrl} rel="noreferrer" target="_blank">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser */}
                  {pick.photo ? <img alt="" decoding="async" height={72} loading="lazy" src={pick.photo} width={72} /> : picks.some((other) => other.photo) ? <span aria-hidden="true" className="shiori-food-blank"><Icon name="cup" /></span> : null}
                  <span>
                    <b>{pick.name}</b>
                    <small>{[t.cafeKinds[pick.kind], budgetLabel(pick.budget ?? null) ? t.shopPrice(budgetLabel(pick.budget ?? null)!) : null].filter(Boolean).join(" ・ ")}</small>
                    <small>{cafe.reason === "on-the-way" ? t.cafeDetour(pick.detourMinutes) : t.cafeWalk(pick.detourMinutes)} <i className="shiori-est">{t.estimate}</i></small>
                  </span>
                </a>
                <button onClick={() => onAdd(pick)} type="button">{t.cafeAdd}</button>
              </li>
            ))}
          </ul>
          <p className="shiori-quiet">{t.cafeNote}</p>
          {picks.some((pick) => pick.photo) ? <p className="shiori-quiet shiori-credit">【画像提供：ホットペッパー グルメ】 Powered by <a href="http://webservice.recruit.co.jp/">ホットペッパーグルメ Webサービス</a></p> : null}
        </>
      ) : null}
    </div>
  );
}

function StayNear({ plan, trip, locale, onHotel }: { plan: ShioriPlan; trip: ShioriTrip; locale: Locale; onHotel: (hotel: ShioriTrip["hotel"]) => void }) {
  const t = text[locale];
  // One lookup per trip shape: a re-plan that leaves the centre where it was
  // must not spend another request. The answer is stored with the centre it
  // was asked for, so "loading" is simply "no answer for this centre yet".
  const key = plan.stayNear ? `${plan.stayNear.latitude.toFixed(2)},${plan.stayNear.longitude.toFixed(2)}` : "";
  const available = useMemo(() => appleRelayClient() !== null, []);
  const [answer, setAnswer] = useState<{ key: string; hotels: HotelCandidate[] } | null>(null);
  // The search is kept as it came; the order and the printed distance are
  // worked out again from the days as they are now. Places can move a long
  // way while the centre stays put, and the list must not keep an old answer.
  const routePoints = plan.stayNear?.routePoints;
  const hotels = useMemo(
    () => answer?.key === key && routePoints ? rerankHotelCandidates(answer.hotels, routePoints.slice(0, 10)).slice(0, 4) : [],
    [answer, key, routePoints],
  );
  const state: "loading" | "ready" | "failed" = !available ? "failed" : answer?.key !== key ? "loading" : hotels.length > 0 ? "ready" : "failed";
  useEffect(() => {
    if (!plan.stayNear || !available) return;
    let cancelled = false;
    requestHotelRecommendations({
      latitude: plan.stayNear.latitude,
      longitude: plan.stayNear.longitude,
      area: trip.cityName.slice(0, 80) || "trip",
      routePoints: plan.stayNear.routePoints.slice(0, 10),
    }, locale).then((response) => {
      if (!cancelled) setAnswer({ key, hotels: response.candidates });
    }).catch(() => { if (!cancelled) setAnswer({ key, hotels: [] }); });
    return () => { cancelled = true; };
    // Keyed on the rounded centre only: a re-plan must not spend a request.
    // What the other inputs change — the ranking — is recomputed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locale]);
  if (!plan.stayNear) return null;
  return (
    <section className="shiori-section shiori-stay" id="shiori-stay" tabIndex={-1}>
      <h2>{t.stayTitle}</h2>
      {plan.stayNear.nearName ? <p className="shiori-stay-area"><i aria-hidden="true">{t.hotelMark}</i><b>{withName(t.stayAround(plan.stayNear.nearName), plan.stayNear.nearName)}</b></p> : null}
      <p className="shiori-quiet">{t.stayBody}</p>
      {state === "loading" ? <p className="shiori-quiet shiori-screen-only">{t.stayLoading}</p> : null}
      {state === "failed" ? <p className="shiori-quiet shiori-screen-only">{t.stayNone}</p> : null}
      {state === "ready" ? (
        <ul className="shiori-hotels">
          {hotels.map((hotel) => {
            const using = trip.hotel?.name === hotel.name;
            const query = encodeURIComponent(hotel.name);
            return (
              <li className={using ? "is-using" : ""} key={hotel.id}>
                <div>
                  <b>{hotel.name}</b>
                  {using ? <em className="shiori-seal">{t.usingHotel}</em> : null}
                  <small>{t.hotelDistance(hotel.routeAverageDistanceMeters)}</small>
                </div>
                <div className="shiori-hotel-actions">
                  {using
                    ? <button onClick={() => onHotel(null)} type="button">{t.clearHotel}</button>
                    : <button className="is-primary" onClick={() => onHotel({ name: hotel.name, lat: hotel.latitude, lon: hotel.longitude })} type="button">{t.useHotel}</button>}
                  {locale === "ja" ? <a className="shiori-action-link" href={`https://kw.travel.rakuten.co.jp/keyword/Search.do?f_query=${query}`} rel="noreferrer" target="_blank">{t.searchRakuten} ↗</a> : null}
                  <a className="shiori-action-link" href={`https://www.booking.com/searchresults.html?ss=${query}`} rel="noreferrer" target="_blank">{t.searchBooking} ↗</a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export default function ShioriApp({ locale }: { locale: Locale }) {
  const t = text[locale];
  const [cities, setCities] = useState<PopularDestination[]>([]);
  // Null until the list of cities with a station map has been read.
  const [railCities, setRailCities] = useState<string[] | null>(null);
  const [trip, setTrip] = useState<ShioriTrip>(emptyTrip);
  const [screen, setScreen] = useState<Screen>("home");
  // Counts entries to the plan screen.
  const [planVisit, setPlanVisit] = useState(0);
  const [saved, setSaved] = useState<ShioriTrip | null>(null);
  const [previous, setPrevious] = useState<ShioriTrip | null>(null);
  const [query, setQuery] = useState("");
  const [railState, setRailState] = useState<{ cityId: string; network: RailNetwork | null } | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [focus, setFocus] = useState<{ placeId: string; token: number } | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [other, setOther] = useState("");
  const [otherKind, setOtherKind] = useState<AddKind>("place");
  const [otherState, setOtherState] = useState<"idle" | "busy" | "failed" | "full">("idle");
  // What the search found, waiting for the traveller to say which one is meant.
  const [otherHits, setOtherHits] = useState<{ kind: AddKind; candidates: AddCandidate[] } | null>(null);
  // The last thing added, said out loud: the plan it changed is far up the page.
  const [added, setAdded] = useState<{ id: string | null; name: string; kind: AddKind } | null>(null);
  // The pasted-list mode of the add form: the text, and, once it is being checked, the review of its lines.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkReview, setBulk] = useState<{ cityId: string | null; lines: BulkLine[]; leftOut: string[]; busy: boolean; stopped: "budget" | null; over: number; added: number; edits: Record<number, string> } | null>(null);
  const [copied, setCopied] = useState(false);
  // Street paths looked up so far, keyed "walk|<leg>" / "drive|<leg>". Null
  // means the map service had no answer; it is not asked twice.
  const [routes, setRoutes] = useState<ReadonlyMap<string, ShioriRoute | null>>(() => new Map());
  const askedRoutes = useRef(new Set<string>());
  const routeAttempts = useRef(new Map<string, number>());
  const hydrated = useRef(false);
  // Whether this visit has saved the trip in hand (see storageStep).
  const wrote = useRef(false);
  // Counts searches by name; an answer is used only if its search is still the latest.
  const otherRun = useRef(0);
  // The same for checks of a pasted list: cancelling or starting another moves it on.
  const bulkRun = useRef(0);
  // Where the keyboard goes once the list mode has changed its face: the
  // button just pressed is gone from the page by then.
  const bulkFocus = useRef<"text" | "status" | "opener" | null>(null);
  const bulkOpener = useRef<HTMLButtonElement | null>(null);
  const bulkBox = useRef<HTMLTextAreaElement | null>(null);
  const bulkStatusLine = useRef<HTMLParagraphElement | null>(null);
  // Which way the page turns when another day is opened.
  const [dayDir, setDayDir] = useState<"fwd" | "back">("fwd");
  const tabs = useRef<HTMLDivElement | null>(null);
  const dayTop = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("../../lib/popular-sights-data.json").then((module) => {
      if (!cancelled) setCities((module.default as { cities: PopularDestination[] }).cities.map((entry) => ({ ...entry, sights: curateSights(entry.sights) })));
    }).catch(() => undefined);
    void import("../../lib/rail-network-index.json").then((module) => {
      if (!cancelled) setRailCities((module.default as { cities: string[] }).cities);
    }).catch(() => { if (!cancelled) setRailCities([]); });
    return () => { cancelled = true; };
  }, []);

  // A shared link wins over the device's last trip; either opens the booklet.
  // Reading the address bar and localStorage is a one-time sync with the
  // browser that cannot happen during server render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const fromHash = window.location.hash.startsWith("#s=") ? decodeTrip(window.location.hash.slice(3)) : null;
    const stored = readTrip(STORAGE_KEY);
    const kept = readTrip(PREVIOUS_KEY);
    const known = readRoutes();
    if (known.size > 0) {
      setRoutes(known);
      for (const key of known.keys()) askedRoutes.current.add(key);
    }
    if (fromHash && fromHash.places.length > 0) {
      // A friend's link must not cost this device its own booklet: that one
      // is kept aside and offered on the home screen. The link leaves the
      // address bar, so a reload opens what was last edited here.
      if (stored && stored.places.length > 0 && encodeTrip(stored) !== encodeTrip(fromHash)) {
        try { window.localStorage.setItem(PREVIOUS_KEY, encodeTrip(stored)); } catch { /* ignore */ }
        setPrevious(stored);
      } else if (kept) {
        setPrevious(kept);
      }
      window.history.replaceState({ shiori: "plan" }, "", window.location.pathname + window.location.search);
      setTrip(fromHash);
      setScreen("plan");
    } else {
      if (stored && stored.places.length > 0) setSaved(stored);
      if (kept && kept.places.length > 0 && (!stored || encodeTrip(kept) !== encodeTrip(stored))) setPrevious(kept);
    }
    hydrated.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated.current) return;
    const step = storageStep(trip, wrote.current);
    if (step === "none") return;
    wrote.current = step === "write";
    try {
      if (step === "write") window.localStorage.setItem(STORAGE_KEY, encodeTrip(trip));
      // The last place was removed: the old list must not come back on the next visit.
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode: the booklet still works for this visit.
    }
  }, [trip]);

  useEffect(() => {
    const cityId = trip.cityId;
    if (!cityId || !railCities?.includes(cityId)) return;
    let cancelled = false;
    void loadRailNetwork(cityId).then((network) => { if (!cancelled) setRailState({ cityId, network }); });
    return () => { cancelled = true; };
  }, [trip.cityId, railCities]);
  // A network loaded for another city is not this trip's network.
  const rail = railState && railState.cityId === trip.cityId ? railState.network : null;
  // Until the station map is in (or known not to exist), a leg that will be
  // a train ride still looks like a road leg; nothing is looked up for it.
  const railSettled = railCities !== null && (!trip.cityId || !railCities.includes(trip.cityId) || railState?.cityId === trip.cityId);

  const city = cities.find((candidate) => candidate.id === trip.cityId) ?? null;
  const matches = useMemo(() => filterDestinations(cities, query, FEATURED), [cities, query]);
  // Planning a long list takes a second or two. It runs after the screen
  // has painted, so a tap shows "working" at once instead of a frozen page;
  // the plan on screen stays until its replacement is ready.
  // The forecast, once the traveller has given a start date — and not before:
  // without a date nothing is asked of anyone. One question per plan, for the
  // destination's rounded centre and the trip's dates; answers are kept for
  // three hours, so editing the list does not ask again; an older answer is
  // asked for anew the next time the plan is put together — not on a timer.
  const forecastCache = useRef<ForecastCache>(new Map());
  // The question now on its way: a plan put together twice in a row waits for the one answer.
  const forecastAsk = useRef<{ key: string; answer: Promise<ForecastAnswer> } | null>(null);
  const [forecast, setForecast] = useState<{ key: string; byIndex: Record<number, DayForecast>; failed: boolean; later: ForecastWindow["later"] } | null>(null);
  // A trip with a city waits for the city list: asking about the middle of
  // the places first and the city's centre a moment later would be two
  // questions where one is promised.
  const centre = useMemo(() => (trip.cityId && cities.length === 0 ? null : forecastCentre(city, trip.places)), [trip.cityId, cities.length, city, trip.places]);
  const centreLat = centre?.latitude ?? null;
  const centreLon = centre?.longitude ?? null;
  const startDate = trip.startDate ?? null;
  const forecastKey = screen === "plan" && startDate && centreLat !== null && centreLon !== null ? `${centreLat},${centreLon}|${startDate}|${trip.days}` : null;
  useEffect(() => {
    if (!forecastKey || !startDate || centreLat === null || centreLon === null) return;
    let current = true;
    const days = forecastWindow(startDate, trip.days);
    const pending = forecastAsk.current?.key === forecastKey ? forecastAsk.current.answer : null;
    const answer = (pending ?? Promise.resolve()).then(() => loadForecast({ latitude: centreLat, longitude: centreLon }, days.within, forecastCache.current));
    const ask = { key: forecastKey, answer };
    forecastAsk.current = ask;
    void answer.then((found) => {
      if (forecastAsk.current === ask) forecastAsk.current = null;
      if (!current) return;
      const next = { key: forecastKey, ...found, later: days.later };
      // The same answer again is the same forecast: the plan is not put together a second time for it.
      setForecast((shown) => (shown && JSON.stringify(shown) === JSON.stringify(next) ? shown : next));
    });
    return () => { current = false; };
    // `trip` and `planVisit`: every time the plan is put together again the
    // cache is consulted, which is when an expired answer is asked for anew.
  }, [forecastKey, startDate, centreLat, centreLon, trip.days, trip, planVisit]);
  // A forecast for other dates or another place is not this trip's forecast.
  const weather = forecast && forecast.key === forecastKey ? forecast : null;
  const wetDays = useMemo(() => (weather ? wetDaysOf(weather.byIndex, trip.days) : null), [weather, trip.days]);
  // The forecast is part of what the plan is made from: a plan numbered for
  // one forecast is not shown for another.
  const planKey = useMemo(() => screen === "plan" ? `${planVisit}|${locale}|${encodeTrip(trip)}|${JSON.stringify(wetDays)}` : null, [screen, planVisit, locale, trip, wetDays]);
  const [planned, setPlanned] = useState<{ key: string; visit: number; plan: ShioriPlan } | null>(null);
  useEffect(() => {
    if (!planKey) return;
    const handle = window.setTimeout(() => {
      setPlanned({ key: planKey, visit: planVisit, plan: buildShioriPlan({ places: trip.places, days: trip.days, hotel: trip.hotel, locale, wetDays }, { rail, cities, routes }) });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [planKey, planVisit, trip, rail, cities, locale, routes, wetDays]);
  // A plan made on an earlier visit to this screen is another trip's plan.
  const plan = screen === "plan" && planned && planned.visit === planVisit ? planned.plan : null;
  const planning = screen === "plan" && planned?.key !== planKey;

  // Every leg that is not a train ride gets the way along the streets, so
  // the map shows where one actually walks or drives and the clock uses the
  // real walking time. Each leg is asked about once per visit, and a batch
  // of answers arrives together: one redraw, not twenty.
  useEffect(() => {
    if (!plan || !railSettled) return;
    const wanted: Array<[string, ShioriLeg]> = [];
    for (const day of plan.days) {
      for (const leg of [day.fromHotel, ...day.legs, day.toHotel]) {
        if (!leg || leg.hasPath || leg.mode === "rail") continue;
        const routeKey = `${leg.mode === "walk" ? "walk" : "drive"}|${leg.key}`;
        if (askedRoutes.current.has(routeKey) || (routeAttempts.current.get(routeKey) ?? 0) >= 2) continue;
        askedRoutes.current.add(routeKey);
        wanted.push([routeKey, leg]);
      }
    }
    if (wanted.length === 0) return;
    let found = new Map<string, ShioriRoute | null>();
    let lastFlush = Date.now();
    // Answers reach the page about once a second, not one by one and not
    // only when the slowest is in: one stalled request holds back nothing.
    const flush = () => {
      if (found.size === 0) return;
      const batch = found;
      found = new Map();
      lastFlush = Date.now();
      setRoutes((current) => new Map([...current, ...batch]));
    };
    const worker = async () => {
      for (let next = wanted.shift(); next; next = wanted.shift()) {
        const [routeKey, leg] = next;
        const answer = await fetchStreetRoute({ origin: leg.from, destination: leg.to, mode: routeKey.startsWith("walk|") ? "walk" : "drive" });
        if (answer.status === "failed") {
          // Offline or busy is not "no route": the leg may be asked about
          // once more when the plan next changes.
          askedRoutes.current.delete(routeKey);
          routeAttempts.current.set(routeKey, (routeAttempts.current.get(routeKey) ?? 0) + 1);
        } else {
          found.set(routeKey, answer.status === "found" ? { minutes: answer.route.minutes, path: answer.route.path } : null);
        }
        if (Date.now() - lastFlush > 1_200) flush();
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]).then(flush);
  }, [plan, railSettled]);
  // A re-plan can leave fewer days than the one being read.
  // The stop being edited decides the day on screen: lengthening a stay or
  // moving it can put it on another day, and its card must not vanish.
  const openDay = openStop ? plan?.days.find((entry) => entry.stops.some((stop) => stop.place.id === openStop))?.index : undefined;
  // Days carry their own number (a pinned "Day 3" stays 3 with Day 2 free),
  // so the day on screen is looked up by number, not by position.
  const activeDay = openDay ?? (plan?.days.some((entry) => entry.index === selectedDay) ? selectedDay : plan?.days[0]?.index ?? 0);

  // The tab of the day being read is kept in view in its own row; the page
  // itself is not scrolled for it.
  useEffect(() => {
    const row = tabs.current;
    const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !tab) return;
    const left = tab.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - 16);
    else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tab.offsetWidth - row.clientWidth + 16;
  }, [activeDay, plan]);

  const update = useCallback((change: (current: ShioriTrip) => ShioriTrip) => setTrip(change), []);
  // The start date, optional, beside the day count on both screens. While a
  // date is being typed the field shows the keystrokes; the trip only takes
  // a date it can use, and on leaving the field it shows what the trip has.
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const [firstDate] = useState(() => earliestStartDate());
  const dateField = (
    <label className="shiori-date">
      <span>{t.startDate}<small>{t.optional}</small></span>
      <input
        min={firstDate}
        onBlur={() => setDateDraft(null)}
        onChange={(event) => { const value = event.target.value; setDateDraft(value); update((current) => withStartDate(current, value)); }}
        type="date"
        value={dateDraft ?? trip.startDate ?? ""}
      />
      <small className="shiori-date-hint">{t.startDateHint}</small>
    </label>
  );
  // Each screen is a history entry, so the phone's back gesture goes to the
  // previous screen instead of leaving the site with the plan.
  const go = useCallback((next: Screen) => {
    setScreen(next);
    if (next === "plan") setPlanVisit((visit) => visit + 1);
    window.history.pushState({ shiori: next }, "");
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const target = (event.state as { shiori?: Screen } | null)?.shiori;
      setScreen(target === "pick" || target === "plan" ? target : "home");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { if (hydrated.current) writeRoutes(routes); }, [routes]);
  // A pasted list under review was checked against the trip in hand. When
  // another trip takes its place (a new one, a saved one, another
  // destination) the running check is cancelled and the review dropped; what
  // was not added goes back to the box only if the same trip stays open.
  const leaveTrip = (next: ShioriTrip) => {
    const step = bulkAfterTripChange(bulkReview, bulkText, tripChange(trip, next));
    if (!step.cancel) return;
    bulkRun.current += 1;
    setBulk(null);
    setBulkText(step.text);
  };
  const chooseCity = (destination: PopularDestination) => {
    // Another destination starts another trip; the one in hand is kept aside.
    // So is the trip saved on an earlier visit when it was not reopened: the
    // first place added to the new trip would otherwise overwrite it.
    const next = withCity(trip, destination, locale);
    leaveTrip(next);
    const aside = keepAside(trip, saved, next);
    if (aside) {
      setPrevious(aside);
      setSaved(null);
      try { window.localStorage.setItem(PREVIOUS_KEY, encodeTrip(aside)); } catch { /* ignore */ }
    }
    update((current) => withCity(current, destination, locale));
    setQuery("");
    setShowAll(false);
    go("pick");
  };
  const addSight = (sight: PopularSight) => update((current) => togglePlace(current, placeFromSight(sight, locale)));

  const putCandidate = (candidate: AddCandidate, kind: AddKind) => {
    if (kind === "hotel") {
      update((current) => ({ ...current, hotel: { name: candidate.name, lat: candidate.lat, lon: candidate.lon } }));
    } else {
      update((current) => putPlace(current, placeOfCandidate(candidate, kind)));
    }
    setAdded({ id: kind === "hotel" ? null : candidate.id, name: candidate.name, kind });
    otherRun.current += 1;
    setOtherHits(null);
    setOther("");
    setOtherState("idle");
  };

  // One name looked up near the trip. `mapFailed` hears why the map search
  // could not be asked; the lookup itself still falls back to the open one.
  const lookUp = (name: string, kind: AddKind, isCurrent: () => boolean, mapFailed?: (error: unknown) => void, openFailed?: () => void) => {
    const anchor = addAnchor(city, trip.places);
    const reach = (city?.radiusKm ?? 60) + 80;
    return searchAddCandidates({
      poiFirst: kind !== "place",
      anchor,
      reachKm: reach,
      cityKm: city?.radiusKm ?? reach,
      // Asked near the trip: a same-named shop in another city is not what was meant.
      mapSearch: appleRelayClient()
        ? (poiOnly) => appleRelaySearch({ query: name, language: locale === "ja" ? "ja-JP" : "en-US", near: anchor, poiOnly }).catch((error: unknown) => { mapFailed?.(error); throw error; })
        : null,
      // No map search in this build, it knew nothing, or it could not be
      // reached: the open lookup, with the places already chosen as its hint
      // of which city this is.
      openLookup: async () => {
        try {
          const context = trip.places.length >= 2 || !city
            ? trip.places.map((place) => place.name)
            : [...trip.places.map((place) => place.name), ...city.sights.slice(0, 3).map((sight) => locale === "ja" ? sight.ja : sight.en)];
          const result = await requestPlaceResolution([...context, name].join("\n"), "", locale);
          // The first of several the lookup could not decide between is a guess, and is carried as one.
          const found = openLookupHit(result, name);
          return found ? openCandidate(found.hit, anchor, reach, found.ambiguous) : null;
        } catch (error) {
          openFailed?.();
          throw error;
        }
      },
      isCurrent,
    });
  };

  const addOther = async () => {
    const name = other.trim();
    if (!name || otherState === "busy") return;
    const kind = otherKind;
    if (kind !== "hotel" && trip.places.length >= MAX_PLACES) { setOtherState("full"); return; }
    // Only the latest search may change the form: typing, another kind,
    // cancelling or choosing a hit moves the counter on and this one is dropped.
    const run = ++otherRun.current;
    setOtherState("busy");
    setOtherHits(null);
    setAdded(null);
    const candidates = await lookUp(name, kind, () => run === otherRun.current);
    if (candidates === null) return;
    if (candidates.length === 0) { setOtherState("failed"); return; }
    setOtherHits({ kind, candidates });
    setOtherState("idle");
  };

  // A review belongs to the destination it was checked for: its candidates
  // are places of that city, so another destination starts without one.
  const bulk = bulkReview && bulkReview.cityId === trip.cityId ? bulkReview : null;
  useEffect(() => { bulkRun.current += 1; }, [trip.cityId]);

  // Looks up every waiting line of the pasted list and lets the review follow.
  const checkBulk = async (lines: BulkLine[]) => {
    const run = ++bulkRun.current;
    const isCurrent = () => run === bulkRun.current;
    const anchor = addAnchor(city, trip.places);
    setBulk((current) => current ? { ...current, lines, busy: true, stopped: null } : current);
    const outcome = await resolveBulk(lines, {
      local: (name) => city ? bundledMatches(name, city.sights, locale, anchor) : [],
      search: async (name) => {
        let mapError: unknown = null;
        let openDown = false;
        const candidates = await lookUp(name, "place", isCurrent, (error) => { mapError = error; }, () => { openDown = true; });
        if (candidates === null) return null;
        // A spent budget fails every later line the same way: the run stops instead of asking on.
        if (mapError instanceof AppleRelayError && mapError.code === "quota_exhausted") throw new BulkBudgetError();
        // "Not found" is only said when a search really answered so.
        if (candidates.length === 0 && (mapError || (!appleRelayClient() && openDown))) throw new Error("search unavailable");
        return candidates;
      },
      takenIds: new Set(trip.places.map((place) => place.id)),
      isCurrent,
      onChange: (next) => { if (isCurrent()) setBulk((current) => current ? { ...current, lines: mergeBulk(current.lines, next) } : current); },
    });
    if (!outcome || !isCurrent()) return;
    setBulk((current) => current ? { ...current, lines: mergeBulk(current.lines, outcome.lines), busy: false, stopped: outcome.stopped } : current);
  };
  const pickBulk = (key: number, candidateId: string | null) => setBulk((current) => current ? { ...current, lines: chooseBulk(current.lines, key, candidateId) } : current);
  const startBulkCheck = () => {
    if (!bulkText.trim() || bulk) return;
    const { lines, leftOut } = startBulk(bulkText, MAX_PLACES - trip.places.length, trip.places);
    setAdded(null);
    bulkFocus.current = "status";
    setBulk({ cityId: trip.cityId, lines, leftOut, busy: false, stopped: null, over: 0, added: 0, edits: {} });
    void checkBulk(lines);
  };
  // Closing (or cancelling) stops the check and hands every line that was not added back to the box.
  const closeBulk = () => {
    bulkRun.current += 1;
    if (bulk) setBulkText(bulkLeftover(bulk.lines, bulk.leftOut, bulk.edits));
    bulkFocus.current = "text";
    setBulk(null);
  };
  const hasBulk = bulk !== null;
  useEffect(() => {
    const target = bulkFocus.current;
    bulkFocus.current = null;
    if (target === "text") bulkBox.current?.focus();
    else if (target === "status") bulkStatusLine.current?.focus();
    else if (target === "opener") bulkOpener.current?.focus();
  }, [bulkOpen, hasBulk]);
  const retryBulk = (line: BulkLine) => {
    if (!bulk || bulk.busy) return;
    void checkBulk(requeueBulk(bulk.lines, line.key, bulk.edits[line.key] ?? line.query));
  };
  const addBulk = () => {
    if (!bulk || bulk.busy) return;
    const done = confirmBulk(bulk.lines, MAX_PLACES - trip.places.length, new Set(trip.places.map((place) => place.id)));
    if (done.add.length > 0) {
      update((current) => done.add.reduce((next, candidate) => {
        // A bundled sight keeps its photo, description and usual length of stay.
        const sight = city?.sights.find((entry) => `wikidata-${entry.q}` === candidate.id);
        return putPlace(next, sight ? placeFromSight(sight, locale) : placeOfCandidate(candidate, "place"));
      }, current));
    }
    setAdded(null);
    setBulk({ ...bulk, lines: done.lines, over: done.over, added: bulk.added + done.add.length });
  };

  // Paper cannot be unfolded: before printing, every folded part is opened
  // (older Safari and Firefox print a closed <details> closed) and put back after.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>(".shiori-days details:not([open])")];
      for (const part of opened) part.open = true;
    };
    const after = () => { for (const part of opened) part.open = false; opened = []; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const share = async () => {
    const link = `${window.location.origin}${window.location.pathname}#s=${encodeTrip(trip)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt(t.share, link);
    }
  };

  const header = (
    <header className="shiori-top">
      <button className="shiori-brand" onClick={() => go("home")} type="button">
        <i aria-hidden="true"><Icon name="pin" /></i>
        <span><b>{t.brand}</b></span>
      </button>
      <nav aria-label={t.navLabel} className="shiori-nav">
        {(["home", "pick", "plan"] as const).map((step) => (
          <button aria-current={screen === step ? "page" : undefined} disabled={step === "pick" ? !city : step === "plan" ? trip.places.length === 0 : false} key={step} onClick={() => { if (step !== screen) go(step); }} type="button">
            <span aria-hidden="true" className="shiori-nav-icon">{step === "home" ? "🌏" : step === "pick" ? "📍" : "🧳"}</span>
            <span>{t.nav[step]}</span>
          </button>
        ))}
      </nav>
      <nav aria-label={t.language} className="shiori-lang">
        <Link aria-current={locale === "ja" ? "true" : undefined} href="/ja" onClick={() => { try { window.localStorage.setItem("tripcheck-locale", "ja"); } catch { /* ignore */ } }}>日本語</Link>
        <Link aria-current={locale === "en" ? "true" : undefined} href="/" onClick={() => { try { window.localStorage.setItem("tripcheck-locale", "en"); } catch { /* ignore */ } }}>EN</Link>
      </nav>
    </header>
  );

  // Which day the place just added landed on, once the plan has caught up.
  const addedDay = added?.id && plan ? plan.days.find((day) => day.stops.some((stop) => stop.place.id === added.id))?.index ?? null : null;
  const showStop = (dayIndex: number, placeId: string) => {
    setSelectedDay(dayIndex);
    setOpenStop(placeId);
    setFocus({ placeId, token: Date.now() });
    // Two frames: the day and the opened card are on the page before it is scrolled to.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.querySelector(`[data-stop="${CSS.escape(placeId)}"]`)?.scrollIntoView({ block: "center" });
    }));
  };

  // Places the traveller typed in themselves: restaurants, and anything the
  // destination's list does not have.
  const extras = trip.places.filter((place) => place.meal || !city?.sights.some((sight) => `wikidata-${sight.q}` === place.id));
  const bulkRoom = MAX_PLACES - trip.places.length;
  const bulkAt = bulkProgress(bulk?.lines ?? []);
  const bulkSum = bulkSummary(bulk?.lines ?? []);
  const addForm = (
    <form className="shiori-other" id="shiori-add" onSubmit={(event) => { event.preventDefault(); void addOther(); }}>
      <label htmlFor="shiori-other">{phrases(t.addOther)}</label>
      <div className="shiori-pace" role="group" aria-label={t.addOther}>
        {(["place", "lunch", "dinner", "hotel"] as const).map((kind) => (
          <button aria-pressed={otherKind === kind} key={kind} onClick={() => { otherRun.current += 1; setOtherKind(kind); setOtherState("idle"); }} type="button">{t.addKinds[kind]}</button>
        ))}
      </div>
      <div className="shiori-other-row">
        <input id="shiori-other" onChange={(event) => { otherRun.current += 1; setOther(event.target.value); setOtherState("idle"); setOtherHits(null); }} placeholder={t.addPlaceholders[otherKind]} value={other} />
        <button disabled={otherState === "busy" || !other.trim()} type="submit">{otherState === "busy" ? t.adding : t.addSearch}</button>
      </div>
      {otherState === "failed" ? <p className="shiori-warn" role="alert">{t.addFailed}</p> : null}
      {otherHits ? (
        <div className="shiori-hits" role="group" aria-label={t.addChoose}>
          <p className="shiori-hits-head"><b>{t.addChoose}</b><button onClick={() => { otherRun.current += 1; setOtherHits(null); }} type="button">{t.addCancel}</button></p>
          <ul>
            {otherHits.candidates.map((candidate) => (
              <li key={candidate.id}>
                <button onClick={() => putCandidate(candidate, otherHits.kind)} type="button">
                  <b>{candidate.name}</b>
                  <small>{[candidate.address, city ? t.addKm(candidate.km) : null].filter(Boolean).join(" ・ ")}</small>
                </button>
              </li>
            ))}
          </ul>
          <p className="shiori-quiet">{t.addChooseHint}</p>
        </div>
      ) : null}
      {added ? (
        <p className="shiori-added" role="status">
          <span>{t.addedAs(added.name, added.kind)}{addedDay !== null ? ` ${t.addedWhere(addedDay + 1)}` : ""}</span>
          {addedDay !== null && screen === "plan" && added.id ? <button onClick={() => showStop(addedDay, added.id!)} type="button">{t.addedSee}</button> : null}
        </p>
      ) : null}
      {otherState === "full" ? <p className="shiori-warn" role="alert">{t.addFull}</p> : null}
      <p className="shiori-quiet">{t.addHint}</p>
      {extras.length > 0 || trip.hotel ? (
        <ul className="shiori-chips is-own">
          {extras.map((place) => (
            <li key={place.id}><button onClick={() => update((current) => togglePlace(current, place))} type="button">{place.meal ? <small>{`${t.mealShort[place.meal]}: `}</small> : null}{place.name}<i aria-hidden="true"> ×</i></button></li>
          ))}
          {trip.hotel ? <li><button onClick={() => update((current) => ({ ...current, hotel: null }))} type="button"><small>{t.hotelChip}: </small>{trip.hotel.name}<i aria-hidden="true"> ×</i></button></li> : null}
        </ul>
      ) : null}
      <div className="shiori-bulk">
        {!bulkOpen ? (
          <button aria-expanded="false" className="shiori-link" onClick={() => { bulkFocus.current = "text"; setBulkOpen(true); }} ref={bulkOpener} type="button">{t.bulkOpen}</button>
        ) : !bulk ? (
          <>
            <label htmlFor="shiori-bulk-text">{t.bulkLabel}</label>
            {/* The example names are the chosen destination's own: Tokyo's would read oddly on a Kyoto trip. */}
            <textarea id="shiori-bulk-text" ref={bulkBox} onChange={(event) => setBulkText(event.target.value)} placeholder={city ? city.sights.slice(0, 3).map((sight) => locale === "ja" ? sight.ja : sight.en).join("\n") : t.bulkPlaceholder} rows={5} value={bulkText} />
            {bulkRoom > 0 ? <p className="shiori-quiet">{t.bulkHint(bulkRoom)}</p> : <p className="shiori-warn">{t.addFull}</p>}
            <div className="shiori-bulk-actions">
              <button className="shiori-bulk-go" disabled={!bulkText.trim()} onClick={startBulkCheck} type="button">{t.bulkCheck}</button>
              <button className="shiori-link" onClick={() => { bulkFocus.current = "opener"; setBulkOpen(false); }} type="button">{t.bulkClose}</button>
            </div>
          </>
        ) : (
          <>
            <p className="shiori-bulk-title"><b>{t.bulkLabel}</b></p>
            <p aria-live="polite" className="shiori-quiet" ref={bulkStatusLine} role="status" tabIndex={-1}>{bulk.busy ? t.bulkChecking(Math.min(bulkAt.done + 1, bulkAt.total), bulkAt.total) : bulk.stopped ? "" : t.bulkChecked}</p>
            {bulk.stopped ? <p className="shiori-warn" role="alert">{t.bulkBudget}</p> : null}
            {bulk.leftOut.length > 0 ? <p className="shiori-warn">{t.bulkLeftOut(bulk.leftOut.length)} {bulk.leftOut.join(locale === "ja" ? "、" : ", ")}</p> : null}
            <ol className="shiori-bulk-lines">
              {bulk.lines.map((line) => {
                const about = (candidate: AddCandidate) => [candidate.address, city ? t.addKm(candidate.km) : null].filter(Boolean).join(" ・ ");
                return (
                  <li data-status={line.status} key={line.key}>
                    <p className="shiori-bulk-typed">
                      <span>{line.text}{line.query !== line.text ? <small>{` (${t.bulkSearchedAs(line.query)})`}</small> : null}</span>
                      <b>{t.bulkStatus[line.status]}</b>
                    </p>
                    {line.status === "found" ? line.candidates.map((candidate) => (
                      <label className="shiori-bulk-pick" key={candidate.id}>
                        <input checked={line.chosen === candidate.id} onChange={(event) => pickBulk(line.key, event.target.checked ? candidate.id : null)} type="checkbox" />
                        <span><b>{candidate.name}</b><small>{about(candidate)}</small></span>
                      </label>
                    )) : null}
                    {line.status === "choose" ? (
                      <fieldset>
                        <legend>{t.bulkChooseFor(line.text)}</legend>
                        {line.candidates.map((candidate) => (
                          <label className="shiori-bulk-pick" key={candidate.id}>
                            <input checked={line.chosen === candidate.id} name={`shiori-bulk-${line.key}`} onChange={() => pickBulk(line.key, candidate.id)} type="radio" />
                            <span><b>{candidate.name}</b><small>{about(candidate)}</small></span>
                          </label>
                        ))}
                        <label className="shiori-bulk-pick">
                          <input checked={line.chosen === null} name={`shiori-bulk-${line.key}`} onChange={() => pickBulk(line.key, null)} type="radio" />
                          <span>{t.bulkSkip}</span>
                        </label>
                      </fieldset>
                    ) : null}
                    {line.status === "missing" || line.status === "failed" ? (
                      <div className="shiori-other-row">
                        <input
                          aria-label={t.bulkEdit(line.text)}
                          onChange={(event) => setBulk((current) => current ? { ...current, edits: { ...current.edits, [line.key]: event.target.value } } : current)}
                          // Enter here must search this line again, not send the search-by-name form above.
                          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); retryBulk(line); } }}
                          value={bulk.edits[line.key] ?? line.query}
                        />
                        <button className="shiori-bulk-again" disabled={bulk.busy || !(bulk.edits[line.key] ?? line.query).trim()} onClick={() => retryBulk(line)} type="button">{line.status === "missing" ? t.bulkAgain : t.bulkRetry}</button>
                      </div>
                    ) : null}
                    {(line.status === "already" || line.status === "repeat" || line.status === "added") && line.candidates[0] && line.candidates[0].name !== line.text ? <p className="shiori-quiet">{line.candidates.find((candidate) => candidate.id === line.chosen)?.name ?? line.candidates[0].name}</p> : null}
                  </li>
                );
              })}
            </ol>
            {bulk.added > 0 ? <p className="shiori-added" role="status"><span>{t.bulkAdded(bulk.added)}</span></p> : null}
            {bulk.over > 0 ? <p className="shiori-warn" role="alert">{t.bulkOver(bulk.over)}</p> : null}
            {bulkSum.confirmed.length + bulkSum.held.length > 0 ? <p className="shiori-bulk-sum" role="status">{t.bulkSummary(bulkSum.confirmed.length, bulkSum.held.length)}</p> : null}
            {bulkSum.held.length > 0 || bulk.leftOut.length > 0 ? <p className="shiori-quiet">{t.bulkHeld}</p> : null}
            <div className="shiori-bulk-actions">
              <button className="shiori-bulk-go" disabled={bulk.busy || bulkSum.confirmed.length === 0} onClick={addBulk} type="button">{t.bulkAdd(bulkSum.confirmed.length)}</button>
              <button className="shiori-link" onClick={closeBulk} type="button">{bulk.added > 0 ? t.bulkClose : t.addCancel}</button>
            </div>
          </>
        )}
      </div>
    </form>
  );

  if (screen === "home") {
    return (
      <main className="shiori">
        {header}
        <section className="shiori-hero">
          <h1>{t.heroTitle}</h1>
          <label className="shiori-search">
            <span>{t.where}</span>
            <span aria-hidden="true" className="shiori-search-icon"><Icon name="pin" /></span>
            <input autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder={t.wherePlaceholder} type="search" value={query} />
          </label>
          {[trip.places.length > 0 ? trip : saved, previous].flatMap((candidate, index) => candidate && candidate.places.length > 0 ? [(
            <button className="shiori-resume" key={index} onClick={() => {
              if (index === 1) {
                // Opening the previous trip swaps the two: the one in hand becomes the previous one, not nothing.
                const aside = keepAside(trip, saved, candidate);
                setPrevious(aside);
                try {
                  if (aside) window.localStorage.setItem(PREVIOUS_KEY, encodeTrip(aside));
                  else window.localStorage.removeItem(PREVIOUS_KEY);
                } catch { /* ignore */ }
              }
              // The page-load copy has done its job; it must not reappear after the trip is emptied.
              setSaved(null);
              leaveTrip(candidate);
              setTrip(candidate);
              setSelectedDay(0);
              go("plan");
            }} type="button">
              <Icon name="clock" />
              <span>{index === 0 ? t.resume : t.resumePrevious}：{candidate.cityName || candidate.places[0]?.name} ・ {candidate.places.length}</span>
            </button>
          )] : [])}
        </section>
        <section className="shiori-cities">
          {query ? null : <h2>{t.popular}</h2>}
          <div className="shiori-city-grid">
            {matches.map((destination) => (
              <button className="shiori-city" key={destination.id} onClick={() => chooseCity(destination)} type="button">
                <Photo alt="" img={destination.sights.find((sight) => sight.img)?.img} width={480} />
                <span className="shiori-city-name">
                  <b>{locale === "ja" ? destination.ja : destination.en}</b>
                  {locale === "ja" && /^[\x20-\x7e]+$/.test(destination.en) ? <small aria-hidden="true">{destination.en}</small> : null}
                </span>
              </button>
            ))}
            {!query && matches.length > 0 ? <p className="shiori-city-blank">{t.otherCities}</p> : null}
          </div>
          {cities.length > 0 && matches.length === 0 ? <p className="shiori-quiet">{t.noCity}</p> : null}
        </section>
        <footer className="shiori-foot">
          <p>{t.credits}</p>
          <p className="shiori-credit">Powered by <a href="http://webservice.recruit.co.jp/">ホットペッパーグルメ Webサービス</a></p>
          <p><Link href="/privacy">{t.privacy}</Link> ・ <Link href={locale === "ja" ? "/classic/ja" : "/classic"}>{t.classic}</Link></p>
        </footer>
      </main>
    );
  }

  if (screen === "pick") {
    const sights = city ? (showAll ? city.sights : city.sights.slice(0, 16)) : [];
    const chosen = new Set(trip.places.map((place) => place.id));
    return (
      <main className="shiori">
        {header}
        <section className="shiori-pick">
          <button className="shiori-back" onClick={() => go("home")} type="button">← {t.back}</button>
          <div className="shiori-pick-head">
            <h1>{t.pickTitle(trip.cityName)}</h1>
            <p className="shiori-quiet">{t.pickHint}</p>
          </div>
          {/* Open when something was added by name: its chips are the only place to see or remove it. */}
          <details className="shiori-add-panel" open={extras.length > 0 || Boolean(trip.hotel) || undefined}>
            <summary><Icon name="plus" />{t.addPanel}</summary>
            {addForm}
          </details>
          <div className="shiori-sights">
            {sights.map((sight) => {
              const id = `wikidata-${sight.q}`;
              const isChosen = chosen.has(id);
              return (
                <button aria-pressed={isChosen} className={`shiori-sight${isChosen ? " is-chosen" : ""}`} key={sight.q} onClick={() => addSight(sight)} type="button">
                  <Photo alt="" img={sight.img} width={360} />
                  <span aria-hidden="true" className="shiori-sight-check">{isChosen ? <Icon name="check" /> : <Icon name="plus" />}</span>
                  <span className="shiori-sight-text">
                    <b>{locale === "ja" ? sight.ja : sight.en}</b>
                    <small>{kindLabel(sight.kind, locale)}{locale === "ja" && sight.desc ? ` ・ ${sight.desc}` : ""}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {city && !showAll && city.sights.length > 16 ? (
            <button className="shiori-more" onClick={() => setShowAll(true)} type="button">{t.showMore}（{city.sights.length - 16}）</button>
          ) : null}
        </section>
        <div className="shiori-bar">
            <label className="shiori-bar-days">
              <span>{t.days}</span>
              <select onChange={(event) => update((current) => ({ ...current, days: Number(event.target.value) }))} value={trip.days}>
                {Array.from({ length: MAX_DAYS }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days}{t.dayUnit}</option>)}
              </select>
            </label>
            {dateField}

          <span aria-live="polite">{trip.places.length > 0 ? withUnits(t.selected(trip.places.length)).map((part, index) => index === 1 ? <b key="count">{part}</b> : part) : t.needOne}</span>
          <button disabled={trip.places.length === 0} onClick={() => { setSelectedDay(0); go("plan"); }} type="button">{t.make} →</button>
        </div>
      </main>
    );
  }

  const noticeKey = (notice: ShioriNotice) => `${notice.kind}-${"placeId" in notice ? notice.placeId : "days" in notice ? notice.days : ""}`;
  const noticeView = (notice: ShioriNotice) => {
    const span = (minutes: number) => durationText(minutes, locale);
    switch (notice.kind) {
      case "needs-days":
        return <><span>{t.noticeNeedsDays(trip.days, notice.days)}</span><button onClick={() => update((current) => ({ ...current, days: notice.days }))} type="button">{t.noticeNeedsDaysAction(notice.days)}</button></>;
      case "drop":
        return <><span>{t.noticeDrop(notice.name, trip.days)}</span><button onClick={() => update((current) => ({ ...current, places: current.places.filter((place) => place.id !== notice.placeId) }))} type="button">{t.noticeDropAction}</button></>;
      case "too-much":
        return <span>{t.noticeTooMuch}</span>;
      case "hotel-far":
        return <span>{t.noticeHotelFar(span(notice.oneWayMinutes), span(notice.savedMinutes))}</span>;
      case "meal-detour":
        return <span>{t.noticeMealDetour(notice.name, t.mealShort[notice.meal], span(notice.minutes))}</span>;
      case "meal-time":
        return <span>{t.noticeMealTime(notice.name, t.mealShort[notice.meal])}</span>;
      case "meal-hotel":
        return <span>{t.noticeMealHotel(notice.name, span(notice.minutes))}</span>;
      case "weather-order":
        // Each day is named with what its own forecast says; a wet day whose forecast is not on screen is only "likely wet".
        return <span>{t.weatherOrder(notice.days.map((day) => { const known = weather?.byIndex[day - 1]; return { day, forecast: t.wetForecast[known ? wetReason(known) : "chance"] }; }))}</span>;
    }
  };

  // What the plan says it did because of the forecast is told beside the
  // forecast, not in the list of things that do not work.
  const problems = plan?.notices.filter((notice) => notice.kind !== "weather-order") ?? [];
  const weatherMove = plan?.notices.find((notice) => notice.kind === "weather-order") ?? null;
  const dayDate = (index: number) => (trip.startDate ? tripDate(trip.startDate, index) : null);
  const dayDateLabel = (index: number) => { const date = dayDate(index); return date ? dateLabel(date, locale) : ""; };
  const shownForecasts = weather && plan ? plan.days.flatMap((day) => weather.byIndex[day.index] ?? []) : [];
  // The oldest answer on screen: the time by which all of it was known.
  const fetchedAt = shownForecasts.map((day) => day.fetchedAt).sort()[0] ?? null;
  const usedDays = plan?.days.length ?? 0;
  const setStay = (place: ShioriPlace, delta: number) => update((current) => ({
    ...current,
    places: current.places.map((entry) => entry.id === place.id ? { ...entry, stayMinutes: Math.min(720, Math.max(15, entry.stayMinutes + delta)) } : entry),
  }));
  const setDay = (place: ShioriPlace, value: number | null) => update((current) => ({
    ...current,
    places: current.places.map((entry) => entry.id === place.id ? { ...entry, day: value } : entry),
  }));

  const dayColor = (index: number) => DAY_COLORS[index % DAY_COLORS.length];
  const cityTitle = trip.cityName || trip.places[0]?.name || "";
  const planTitle = t.planTitle(cityTitle, trip.days);
  const partOf = (clock: string) => {
    const hour = Number(clock.slice(0, 2));
    return hour < 12 ? "morning" : hour < 17 ? "noon" : "evening";
  };
  const selectDay = (index: number, reveal = false) => {
    setDayDir(index < activeDay ? "back" : "fwd");
    setOpenStop(null);
    setFocus(null);
    setSelectedDay(index);
    if (reveal) window.requestAnimationFrame(() => dayTop.current?.scrollIntoView({ block: "start" }));
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const order = plan?.days.map((entry) => entry.index) ?? [];
    const at = order.indexOf(activeDay);
    const next = event.key === "ArrowRight" ? order[at + 1] : event.key === "ArrowLeft" ? order[at - 1] : event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1] : undefined;
    if (next === undefined || next === activeDay) return;
    event.preventDefault();
    selectDay(next);
    window.requestAnimationFrame(() => document.getElementById(`shiori-tab-${next}`)?.focus());
  };
  const stayText = (minutes: number) => `${t.stay}${t.staySep}${durationText(minutes, locale)}`;
  const shareLink = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}#s=${encodeTrip(trip)}`;

  return (
    <main className="shiori is-plan">
      {header}
      <div className="shiori-plan">
        <div className="shiori-plan-main">
          <div className="shiori-plan-head">
            <h1>{planTitle}</h1>
            <p className="shiori-cover-meta">{t.coverMeta(trip.days, trip.places.length)}</p>
          </div>

          {plan && problems.length > 0 ? (
            <section aria-label={t.noticesTitle} className="shiori-notices">
              <h2>{t.noticesTitle}</h2>
              <ul>
                {problems.map((notice) => <li key={noticeKey(notice)}>{noticeView(notice)}</li>)}
              </ul>
            </section>
          ) : null}

          {/* On a phone each action is its icon over a short word; its full name is always what is read out. */}
          <div className="shiori-plan-actions">
            <button onClick={() => go(city ? "pick" : "home")} type="button"><Icon name="back" /><span className="shiori-act-long">{t.editPlaces}</span><span aria-hidden="true" className="shiori-act-short">{t.short.edit}</span></button>
            <button onClick={() => void share()} type="button"><Icon name="link" /><span aria-live="polite" className="shiori-act-long">{copied ? t.shared : t.share}</span><span aria-hidden="true" className="shiori-act-short">{copied ? t.short.shared : t.short.share}</span></button>
            <a className="shiori-action-link" href={`https://line.me/R/share?text=${encodeURIComponent(`${planTitle} ${shareLink}`)}`} rel="noreferrer" target="_blank"><Icon name="send" /><span className="shiori-act-long">{t.shareLine}</span><span aria-hidden="true" className="shiori-act-short">{t.short.line}</span></a>
            <button onClick={() => window.print()} type="button"><Icon name="printer" /><span className="shiori-act-long">{t.print}</span><span aria-hidden="true" className="shiori-act-short">{t.short.print}</span></button>
            <label className="shiori-plan-days">
              <span>{t.days}</span>
              <select onChange={(event) => update((current) => ({ ...current, days: Number(event.target.value) }))} value={trip.days}>
                {Array.from({ length: MAX_DAYS }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days}{t.dayUnit}</option>)}
              </select>
            </label>
          </div>
          {dateField}

          <div className="shiori-plan-tools">
            <button onClick={() => { document.getElementById("shiori-other")?.focus({ preventScroll: true }); document.getElementById("shiori-add")?.scrollIntoView({ block: "start", behavior: "instant" }); }} type="button"><Icon name="plus" />{t.addShortcut}</button>
            {plan ? <button className="shiori-map-jump" onClick={() => { const map = document.getElementById("shiori-map-panel"); map?.focus({ preventScroll: true }); map?.scrollIntoView({ block: "start", behavior: "instant" }); }} type="button"><Icon name="pin" />{t.mapShortcut}</button> : null}
            {plan?.stayNear ? <button onClick={() => { const section = document.getElementById("shiori-stay"); section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: "start", behavior: "instant" }); }} type="button"><Icon name="bed" />{t.stayShortcut}</button> : null}
          </div>

          {planning ? <p aria-live="polite" className={`shiori-working${plan ? " is-update" : ""}`}>{plan ? t.updating : t.working}</p> : null}

          {/* Said once for the whole plan: whose forecast it is and how old, what it changed, and what is not known yet. */}
          {plan && weather && (shownForecasts.length > 0 || weather.failed || weather.later || weatherMove) ? (
            <div className="shiori-forecast">
              {weatherMove ? <p className="shiori-forecast-move"><Icon name="umbrella" /><span>{noticeView(weatherMove)}</span></p> : null}
              {shownForecasts.length > 0 && fetchedAt ? <p>{t.forecastBy} <a href="https://open-meteo.com/" rel="noreferrer" target="_blank">Open-Meteo</a> ・ {t.forecastFetched(fetchedStamp(fetchedAt, locale))}</p> : null}
              {weather.failed ? <p aria-live="polite">{t.forecastFailed}</p> : null}
              {weather.later ? <p>{t.forecastLater(weather.later.index + 1, dateLabel(weather.later.availableOn, locale), shownForecasts.length === 0 && !weather.failed)}</p> : null}
            </div>
          ) : null}

          <div className="shiori-day-anchor" ref={dayTop} />
          {plan && plan.days.length > 0 ? (
            <div className="shiori-tabs-wrap" style={{ ["--day" as string]: dayColor(activeDay) }}>
              <div aria-label={t.daysTabs} className="shiori-tabs" onKeyDown={onTabKey} ref={tabs} role="tablist">
                {plan.days.map((entry) => (
                  <button
                    aria-controls={`shiori-day-${entry.index}`}
                    aria-selected={entry.index === activeDay}
                    id={`shiori-tab-${entry.index}`}
                    key={entry.index}
                    onClick={() => selectDay(entry.index)}
                    role="tab"
                    style={{ ["--day" as string]: dayColor(entry.index) }}
                    tabIndex={entry.index === activeDay ? 0 : -1}
                    type="button"
                  >
                    <b>{t.dayTab(entry.index)}</b>
                    {trip.startDate ? <small>{dayDateLabel(entry.index)}</small> : null}
                    <small>{entry.title}</small>
                  </button>
                ))}
              </div>
              {plan.freeDays > 0 ? <span className="shiori-tab-free">{t.freeTab} ×{plan.freeDays}</span> : null}
            </div>
          ) : null}



          <div className="shiori-days" data-dir={dayDir}>
            {plan?.days.map((day, dayPosition) => {
              const previousDay = plan.days[dayPosition - 1];
              const nextDay = plan.days[dayPosition + 1];
              // The day's first heading (朝…) stands before the way out of the hotel, not after it.
              const startPart = day.fromHotel ? partOf(day.start) : null;
              const steps = Math.round(day.walkMinutes / 10) * 1000;
              // Only what was actually forecast for this date; a day without an answer shows nothing about weather.
              const dayWeather = weather?.byIndex[day.index] ?? null;
              const wet = dayWeather ? isWetForecast(dayWeather) : false;
              const rainIdeas = day.rainIdeas.length > 0 ? (
                <div className="shiori-ideas is-rain">
                  <h3><Icon name="umbrella" />{wet && dayWeather ? t.rainTitleWet(t.wetForecast[wetReason(dayWeather)]) : t.rainTitle}</h3>
                  <ul className="shiori-chips">
                    {day.rainIdeas.map((sight) => (
                      <li key={sight.q}><button onClick={() => addSight(sight)} type="button"><i aria-hidden="true">＋</i> {locale === "ja" ? sight.ja : sight.en}</button></li>
                    ))}
                  </ul>
                </div>
              ) : null;
              return (
                <section
                  aria-labelledby={`shiori-tab-${day.index}`}
                  className={`shiori-day${day.index === activeDay ? " is-current" : ""}`}
                  id={`shiori-day-${day.index}`}
                  key={day.index}
                  role="tabpanel"
                  style={{ ["--day" as string]: dayColor(day.index) }}
                  tabIndex={-1}
                >
                  <header className="shiori-day-head">
                    <h2><small>{t.dayTab(day.index)}{trip.startDate ? ` ・ ${dayDateLabel(day.index)}` : ""}</small> <span>{phrases(day.title)}</span></h2>
                    {dayWeather ? (
                      <p className="shiori-weather">
                        <Icon name={WEATHER_ICON[dayWeather.kind]} />
                        <b>{t.weatherKinds[dayWeather.kind]}</b>
                        <span>{dayWeather.temperatureMaxC}° / {dayWeather.temperatureMinC}°</span>
                        {dayWeather.precipitationPercent !== null ? <span>{t.rainChance(dayWeather.precipitationPercent)}</span> : null}
                        <small>{t.forecastTag}</small>
                      </p>
                    ) : null}
                  </header>
                  <details className="shiori-day-summary">
                    <summary>{t.daySummary}</summary>
                  <dl className="shiori-facts">
                    <div><dt>{t.facts.time}</dt><dd>{day.start}–{day.endsNextDay ? <NextDay locale={locale} /> : null}{day.end}</dd></div>
                    <div><dt>{t.facts.places}</dt><dd>{day.stops.length}<small>{t.placeUnit}</small></dd></div>
                    <div><dt>{t.facts.moving}</dt><dd>{day.travelMinutes > 0 ? withUnits(t.movingTotal(durationText(day.travelMinutes, locale))) : "—"}</dd></div>
                    <div><dt>{t.facts.walking}</dt><dd>{day.walkMinutes > 0 ? <>{withUnits(t.walkingAbout(day.walkMinutes))}{steps > 0 ? <small className="shiori-facts-sub">{t.steps(steps)}</small> : null}</> : "—"}</dd></div>
                  </dl>
                  </details>
                  <p className={`shiori-load is-${day.load}`}><b>{t.loads[day.load]}</b>{day.load === "tight" && !day.runsLate ? <span>{t.loadTight}</span> : null}</p>
                  {day.runsLate ? <p className="shiori-warn"><Icon name="warn" /> {t.late}</p> : null}
                  <ol className="shiori-timeline">
                    {day.fromHotel && startPart ? (
                      <li className="is-leg">
                        <p className="shiori-part"><span>{t.parts[startPart]}</span></p>
                        <LegCard depart={day.start} heading={t.fromHotel} leg={day.fromHotel} locale={locale} />
                      </li>
                    ) : null}
                    {day.stops.map((stop, index) => {
                      const part = partOf(stop.arrive);
                      const isOpen = openStop === stop.place.id;
                      // A clock that follows a taxi or an unscheduled ride is no firmer than that ride.
                      const incoming = index === 0 ? day.fromHotel : day.legs[index - 1];
                      const estimated = incoming?.mode === "taxi" || incoming?.mode === "transit";
                      return (
                        <li key={stop.place.id}>
                          {(index === 0 ? startPart !== part : partOf(day.stops[index - 1].arrive) !== part) ? <p className="shiori-part"><span>{t.parts[part]}</span></p> : null}
                          {stop.waitMinutes > 0 ? <p className="shiori-wait"><Icon name="clock" />{t.wait(durationText(stop.waitMinutes, locale))}</p> : null}
                          <article className={`shiori-stop${isOpen ? " is-open" : ""}`} data-stop={stop.place.id}>
                            <button
                              aria-expanded={isOpen}
                              className="shiori-stop-main"
                              onClick={() => { setOpenStop(isOpen ? null : stop.place.id); setFocus(isOpen ? null : { placeId: stop.place.id, token: Date.now() }); }}
                              type="button"
                            >
                              <span className="shiori-stop-number">{index + 1}</span>
                              <span className="shiori-stop-text">
                                <span className="shiori-stop-time">
                                  {stop.arriveNextDay ? <NextDay locale={locale} /> : null}<b>{stop.arrive}</b>–{stop.leaveNextDay ? <NextDay locale={locale} /> : null}{stop.leave}
                                  {estimated ? <> <i className="shiori-est">{t.estimate}</i></> : null}
                                </span>
                                <b className="shiori-stop-name">{stop.place.name}</b>
                                <small>{stop.place.meal ? t.mealLabels[stop.place.meal] : kindLabel(stop.place.kind, locale)} ・ <span className="shiori-nb">{stayText(stop.stayMinutes)}</span></small>
                                {stop.mealMissed ? <small className="shiori-warn">{t.mealMissed}</small> : null}
                              </span>
                              <Photo alt="" icon={stop.place.meal ? "meal" : "pin"} img={stop.place.img} width={160} />
                            </button>
                            {isOpen ? (
                              <div className="shiori-stop-edit">
                                <div>
                                  <span>{t.stay} {durationText(stop.place.stayMinutes, locale)}</span>
                                  <button aria-label={t.shorter} onClick={() => setStay(stop.place, -15)} type="button">−15{t.minute}</button>
                                  <button aria-label={t.longer} onClick={() => setStay(stop.place, 15)} type="button">+15{t.minute}</button>
                                </div>
                                <div>
                                  <label>
                                    <span>{t.moveDay}</span>
                                    <select onChange={(event) => setDay(stop.place, event.target.value ? Number(event.target.value) : null)} value={stop.place.day ?? ""}>
                                      <option value="">{t.auto}</option>
                                      {Array.from({ length: trip.days }, (_, dayIndex) => <option key={dayIndex} value={dayIndex + 1}>{t.dayTab(dayIndex)}</option>)}
                                    </select>
                                  </label>
                                  <button className="is-danger" onClick={() => update((current) => togglePlace(current, stop.place))} type="button">{t.remove}</button>
                                </div>
                                {placeCardsAvailable() ? <PlaceCard locale={locale} stop={stop.place} /> : null}
                                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.place.name} ${stop.place.lat.toFixed(5)},${stop.place.lon.toFixed(5)}`)}`} rel="noreferrer" target="_blank">{t.checkHours}</a>
                                {stop.place.img ? <a href={photoCreditUrl(stop.place.img)} rel="noreferrer" target="_blank">{t.photo}: Wikimedia Commons ↗</a> : null}
                              </div>
                            ) : null}
                          </article>
                          {day.meals.filter((meal) => meal.afterStop === index).map((meal) => <MealRow
                            key={`${meal.kind}-${day.index}-${trip.places.length}`}
                            locale={locale}
                            meal={meal}
                            onAdd={(shop, kind) => {
                              if (trip.places.length >= MAX_PLACES) return;
                              const id = safePlaceId(`hotpepper-${shop.id}`);
                              update((current) => current.places.some((place) => place.id === id) ? current : {
                                ...current,
                                places: [...current.places, { id, name: shop.name, lat: shop.latitude, lon: shop.longitude, stayMinutes: kind === "lunch" ? 60 : 90, kind: "restaurant", meal: kind, day: day.index + 1 }],
                              });
                              setAdded({ id, name: shop.name, kind });
                            }}
                          />)}
                          {day.cafe && day.cafe.afterStop === index ? (
                            <CafeRow
                              cafe={day.cafe}
                              key={`cafe-${day.index}-${stop.place.id}`}
                              locale={locale}
                              onAdd={(pick) => update((current) => current.places.length >= MAX_PLACES || current.places.some((place) => place.id === pick.id) ? current : {
                                ...current,
                                // On this day, as a half-hour stop; the order is the planner's.
                                places: [...current.places, { id: pick.id, name: pick.name, lat: pick.latitude, lon: pick.longitude, stayMinutes: 30, kind: pick.kind === "bakery" ? "bakery cafe" : "cafe", day: day.index + 1 }],
                              })}
                            />
                          ) : null}
                          {/* A lunch hour suggested after this stop is spent before setting off: the leg leaves when lunch ends. */}
                          {day.legs[index] ? <LegCard depart={departureAfterStop(day, index)} leg={day.legs[index]} locale={locale} /> : null}
                        </li>
                      );
                    })}
                    {day.toHotel ? <li className="is-leg"><LegCard depart={departureAfterStop(day, day.stops.length - 1)} heading={t.toHotel} leg={day.toHotel} locale={locale} /></li> : null}
                  </ol>
                  {/* With rain forecast for this date, the roofed ideas come before the others. */}
                  {wet ? rainIdeas : null}
                  {day.ideas.length > 0 ? (
                    <div className="shiori-ideas">
                      <h3><Icon name="spark" /><span>{phrases(t.ideasTitle, "。")}</span></h3>
                      <ul className="shiori-chips">
                        {day.ideas.map((sight) => (
                          <li key={sight.q}><button onClick={() => addSight(sight)} type="button"><i aria-hidden="true">＋</i> {locale === "ja" ? sight.ja : sight.en}</button></li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {wet ? null : rainIdeas}
                  <p className="shiori-quiet shiori-hours-note"><Icon name="info" /><span className="shiori-screen-only">{t.hoursNote}</span><span className="shiori-print-only">{t.hoursNotePrint}</span></p>
                  {previousDay || nextDay ? (
                    <nav aria-label={t.dayNav} className="shiori-daynav">
                      {previousDay ? <button onClick={() => selectDay(previousDay.index, true)} type="button">← {t.dayTab(previousDay.index)}</button> : <span />}
                      {nextDay ? <button onClick={() => selectDay(nextDay.index, true)} type="button"><span>{t.dayTab(nextDay.index)} {nextDay.title}</span> →</button> : null}
                    </nav>
                  ) : null}
                </section>
              );
            })}
          </div>

          <aside aria-label={t.mapLabel} className="shiori-plan-map" id="shiori-map-panel" tabIndex={-1}>
            {plan ? (
              <ShioriMap
                days={plan.days}
                focus={focus}
                hotel={trip.hotel}
                label={t.mapLabel}
                legend={{ rail: t.legendRail, street: t.legendWalk, straight: t.legendOther }}
                onSelectStop={showStop}
                selectedDay={activeDay}
                text={{
                  expand: t.mapExpand,
                  collapse: t.mapCollapse,
                  view: t.mapView,
                  close: t.close,
                  hotel: t.hotelChip,
                  hotelMark: t.hotelMark,
                  failed: t.mapFailed,
                  pinLabel: t.pinLabel,
                  legTag: (minutes: number) => `${t.about}${minutes}${t.minute}`,
                  modes: { walk: t.walk, rail: t.rail, transit: t.transit, taxi: t.taxi },
                  peekMeta: (stop: ShioriStop) => `${stop.arriveNextDay ? t.nextDayMark : ""}${stop.arrive}–${stop.leaveNextDay ? t.nextDayMark : ""}${stop.leave} ・ ${stayText(stop.stayMinutes)}`,
                }}
              />
            ) : null}
          </aside>

          {plan && plan.freeDays > 0 ? (
            <section className="shiori-section">
              <h2>{t.freeTitle(plan.freeDays)}</h2>
              <p className="shiori-quiet">{plan.freeDayIdeas.length > 0 ? t.freeBody : t.freeNone}</p>
              {plan.freeDayIdeas.length > 0 ? (
                <ul className="shiori-chips">
                  {plan.freeDayIdeas.map((sight) => (
                    <li key={sight.q}><button onClick={() => addSight(sight)} type="button"><i aria-hidden="true">＋</i> {locale === "ja" ? sight.ja : sight.en}</button></li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {plan && plan.leftOut.length > 0 ? (
            <section className="shiori-section">
              <h2>{t.leftOut}</h2>
              <p className="shiori-warn">{plan.leftOut.join("、")}</p>
            </section>
          ) : null}

          <section className="shiori-plan-add">{addForm}</section>

          {plan ? <StayNear locale={locale} onHotel={(hotel) => update((current) => ({ ...current, hotel }))} plan={plan} trip={trip} /> : null}

          {usedDays === 0 && plan ? <p className="shiori-quiet">{t.needOne}</p> : null}

          <footer className="shiori-foot">
            <p>{t.note}</p>
            <p>{t.credits}</p>
            {/* Restaurant listings and photos in Japan come from this service; its guideline asks for this line on the site. */}
            <p className="shiori-credit">Powered by <a href="http://webservice.recruit.co.jp/">ホットペッパーグルメ Webサービス</a></p>
            <p>
              <button className="shiori-link" onClick={() => { leaveTrip(emptyTrip); setTrip(emptyTrip); setSaved(null); go("home"); try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } window.history.replaceState({}, "", window.location.pathname); }} type="button">{t.newTrip}</button>
              {" ・ "}<Link href="/privacy">{t.privacy}</Link>
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}
