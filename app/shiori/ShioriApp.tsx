"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchAppleFoodCandidates } from "../../lib/apple-food";
import { appleRelayClient } from "../../lib/apple-relay-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../../lib/google-food";
import type { HotelCandidate } from "../../lib/google-hotels";
import { requestHotelRecommendations } from "../../lib/hotel-recommendations-client";
import { requestPlaceResolution } from "../../lib/place-resolution-client";
import { curateSights, filterDestinations, type PopularDestination, type PopularSight } from "../../lib/popular-sights";
import { loadRailNetwork } from "../../lib/rail-network-client";
import type { RailNetwork } from "../../lib/rail-router";
import { fetchStreetRoute } from "../../lib/street-route-client";
import { findCafes, type CafeBreak, type CafePick } from "../../lib/shiori/cafes";
import { buildShioriPlan, type ShioriDay, type ShioriLeg, type ShioriMeal, type ShioriNotice, type ShioriPlace, type ShioriPlan, type ShioriRoute } from "../../lib/shiori/plan";
import {
  MAX_DAYS,
  MAX_PLACES,
  decodeTrip,
  durationText,
  emptyTrip,
  encodeTrip,
  kindLabel,
  photoCreditUrl,
  photoUrl,
  placeFromSight,
  togglePlace,
  withCity,
  type ShioriTrip,
} from "../../lib/shiori/state";
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
    tagline: "旅のしおりメーカー",
    heroTitle: "行きたい場所を選ぶだけ。\n旅のしおりが、すぐできる。",
    heroBody: "どの日にどこを、どの順番で、どうやって回るか。行きたい店や泊まりたいホテルも入れて、無理がないかまで地図と一緒に確かめます。無料・登録なし・広告なし・件数の課金なし。",
    where: "どこに行く？",
    wherePlaceholder: "行き先を入力（例：香港、京都、パリ）",
    popular: "人気の行き先",
    noCity: "この行き先はまだ準備中です。近い都市を選ぶか、別の名前で試してください。",
    resume: "前回のしおりを開く",
    resumePrevious: "その前のしおりを開く",
    back: "もどる",
    pickTitle: (city: string) => `${city}で行きたい場所をタップ`,
    pickHint: "あとから追加・削除できます。まずは気になるところを選んでください。",
    days: "日数",
    dayUnit: "日間",
    addOther: "行きたい店・泊まりたいホテル・一覧にない場所を追加",
    addKinds: { place: "場所", lunch: "昼ごはんの店", dinner: "夜ごはんの店", hotel: "泊まるホテル" } as Record<AddKind, string>,
    addPlaceholders: { place: "場所の名前", lunch: "昼に行きたい店の名前", dinner: "夜に行きたい店の名前", hotel: "泊まりたいホテルの名前" } as Record<AddKind, string>,
    addHint: "店とホテルも予定に組み込み、離れすぎていないかを確かめます。",
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
    working: "しおりを作っています…",
    updating: "組み直しています…",
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
    addFull: `一度に組めるのは${MAX_PLACES}か所までです。`,
    selected: (count: number) => `${count}か所を選択中`,
    make: "しおりを作る",
    needOne: "場所を1つ以上選んでください",
    showMore: "もっと見る",
    planTitle: (city: string, days: number) => `${city} ${days}日間のしおり`,
    editPlaces: "場所を選び直す",
    share: "リンクをコピー",
    shared: "コピーしました",
    print: "印刷",
    dayTab: (index: number) => `${index + 1}日目`,
    freeTab: "空き日",
    dayMeta: (day: ShioriDay) => `${day.start}〜${day.end} ・ ${day.stops.length}か所${day.travelMinutes > 0 ? ` ・ 移動 計${durationText(day.travelMinutes, "ja")}` : ""}${day.walkMinutes > 0 ? `（うち歩き約${day.walkMinutes}分・約${(Math.round(day.walkMinutes / 10) * 1000).toLocaleString("ja-JP")}歩）` : ""}`,
    loads: { easy: "ゆとりのある日", normal: "ちょうどいい日", tight: "詰まっている日" },
    loadTight: "移動や立ち寄りが多めです。1か所を別の日に移すか、減らすと楽になります。",
    rainTitle: "雨の日なら（屋内の候補）",
    checkHours: "営業日・営業時間・予約を地図で確認 ↗",
    hoursNote: "このしおりは営業時間・定休日・予約の要否を知りません。行く前に各スポットを開いて確認してください。",
    shareLine: "LINEで送る",
    late: "この日は予定が多めです。日数を増やすか、場所を減らすと楽になります。",
    stay: "滞在",
    shorter: "滞在を15分短く",
    longer: "滞在を15分長く",
    remove: "しおりから外す",
    moveDay: "日を変える",
    auto: "おまかせ",
    walk: "徒歩",
    rail: "電車",
    transit: "電車・バス",
    taxi: "タクシー",
    about: "約",
    minute: "分",
    estimate: "目安",
    openMaps: "地図アプリで行き方・時刻を見る",
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
    walkAbout: (minutes: number) => `徒歩約${minutes}分`,
    ideasTitle: "時間に余裕があります。近くの人気スポット",
    ideasAdd: "追加",
    freeTitle: (count: number) => `あと${count}日、空いています`,
    freeBody: "無理に広げず、必要な日数にまとめました。空いた日に行けそうな場所です。",
    freeNone: "空いた日は自由行動にできます。",
    leftOut: "入りきらなかった場所",
    stayTitle: "泊まる場所",
    stayBody: "全日程の移動がいちばん少なくなるエリアのホテルです。料金と空室は予約サイトで確認してください。",
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
    newTrip: "新しいしおり",
    privacy: "プライバシー",
    classic: "以前の画面",
  },
  en: {
    tagline: "Trip booklet maker",
    heroTitle: "Pick the places.\nGet a day-by-day trip booklet.",
    heroBody: "Which day, what order, how to get between them — with your own restaurants and hotel, checked for whether it all really fits, on a map. Free, no account, no ads, no paid tier.",
    where: "Where to?",
    wherePlaceholder: "Type a destination (e.g. Kyoto, Paris)",
    popular: "Popular destinations",
    noCity: "This destination is not ready yet. Try a nearby city or another spelling.",
    resume: "Open your last booklet",
    resumePrevious: "Open the booklet before that",
    back: "Back",
    pickTitle: (city: string) => `Tap the places you want in ${city}`,
    pickHint: "You can add or remove places later.",
    days: "Days",
    dayUnit: "days",
    addOther: "Add a restaurant, your hotel, or a place that is not listed",
    addKinds: { place: "Place", lunch: "Lunch spot", dinner: "Dinner spot", hotel: "Hotel" } as Record<AddKind, string>,
    addPlaceholders: { place: "Place name", lunch: "Restaurant for lunch", dinner: "Restaurant for dinner", hotel: "Hotel you want to stay at" } as Record<AddKind, string>,
    addHint: "Restaurants and the hotel are planned in, and checked for being too far apart.",
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
    working: "Building your booklet…",
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
    addFull: `One trip holds up to ${MAX_PLACES} places.`,
    selected: (count: number) => `${count} selected`,
    make: "Make my booklet",
    needOne: "Pick at least one place",
    showMore: "Show more",
    planTitle: (city: string, days: number) => `${city}: ${days}-day booklet`,
    editPlaces: "Change places",
    share: "Copy link",
    shared: "Copied",
    print: "Print",
    dayTab: (index: number) => `Day ${index + 1}`,
    freeTab: "Free",
    dayMeta: (day: ShioriDay) => `${day.start}–${day.end} · ${day.stops.length} places${day.travelMinutes > 0 ? ` · ${durationText(day.travelMinutes, "en")} moving` : ""}${day.walkMinutes > 0 ? ` (~${day.walkMinutes} min on foot, ~${(Math.round(day.walkMinutes / 10) * 1000).toLocaleString("en-US")} steps)` : ""}`,
    loads: { easy: "An easy day", normal: "A comfortable day", tight: "A packed day" },
    loadTight: "A lot of moving or many stops. Moving one place to another day, or dropping one, makes it easier.",
    rainTitle: "If it rains (indoor ideas)",
    checkHours: "Check opening days, hours and booking on the map ↗",
    hoursNote: "This booklet does not know opening hours, closed days or whether you need a booking. Open each place and check before you go.",
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
    openMaps: "Open directions and times in a maps app",
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
    walkAbout: (minutes: number) => `~${minutes} min walk`,
    ideasTitle: "There is time left. Well-known places nearby",
    ideasAdd: "Add",
    freeTitle: (count: number) => `${count} more day${count === 1 ? "" : "s"} free`,
    freeBody: "The list fits in fewer days, so it was not stretched. Ideas for the free time:",
    freeNone: "Keep the spare days open.",
    leftOut: "Did not fit",
    stayTitle: "Where to stay",
    stayBody: "Hotels in the area that keeps the whole trip's travel shortest. Check price and availability on a booking site.",
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
    newTrip: "New booklet",
    privacy: "Privacy",
    classic: "Previous version",
  },
};

function Icon({ name }: { name: "walk" | "rail" | "bus" | "taxi" | "meal" | "bed" | "check" | "plus" | "pin" }) {
  const paths: Record<string, string> = {
    walk: "M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 9l3-1.5 2.5 2.5 2.5 1M12 7.5 11 13l2.5 3 .5 5M11 13l-2 3-2.5 4",
    rail: "M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 17l-2 3M16 17l2 3",
    bus: "M6 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM5 12h14M8 15h.01M16 15h.01M7 17v2M17 17v2",
    taxi: "M5 16v-3l1.5-4h11L19 13v3M5 16h14M5 16v2M19 16v2M7.5 13.5h.01M16.5 13.5h.01M10 9V7h4v2",
    meal: "M7 3v7a2 2 0 0 0 2 2v9M11 3v7M9 3v7M16 3c-1.5 2-2 4-2 7h2v11",
    bed: "M4 18v-9M4 13h16v5M20 13v-1a3 3 0 0 0-3-3h-6v4M7.5 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
    check: "M5 12.5 10 17.5 19 7",
    plus: "M12 5v14M5 12h14",
    pin: "M12 21s6.5-5.7 6.5-10.8a6.5 6.5 0 1 0-13 0C5.500 15.3 12 21 12 21ZM12 12.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z",
  };
  return (
    <svg aria-hidden="true" className="shiori-icon" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d={paths[name]} />
    </svg>
  );
}

function Photo({ img, alt, width }: { img?: string; alt: string; width: number }) {
  const url = photoUrl(img, width);
  // A photo that will not load is no photo: the card shows its plain tile,
  // never the browser's broken-image mark.
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span aria-hidden="true" className="shiori-photo is-empty"><Icon name="pin" /></span>;
  // Commons thumbnails are remote and of unknown size; next/image cannot
  // optimise them on a static host.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className="shiori-photo" decoding="async" loading="lazy" onError={() => setFailed(true)} src={url} />;
}

function LegCard({ leg, locale, heading }: { leg: ShioriLeg; locale: Locale; heading?: string }) {
  const t = text[locale];
  const label = leg.mode === "walk" ? t.walk : leg.mode === "rail" ? t.rail : leg.mode === "taxi" ? t.taxi : t.transit;
  const icon = leg.mode === "walk" ? "walk" : leg.mode === "rail" ? "rail" : leg.mode === "taxi" ? "taxi" : "bus";
  return (
    <div className={`shiori-leg is-${leg.mode}`}>
      <div className="shiori-leg-head">
        <Icon name={icon} />
        <span>
          {heading ? <b>{heading} · </b> : null}
          {label} {t.about}{leg.minutes}{t.minute}
          {leg.mode === "transit" || leg.mode === "taxi" ? <small>（{t.estimate}）</small> : null}
        </span>
      </div>
      {leg.rail ? (
        <ol className="shiori-rail">
          <li className="is-walk">{t.walkTo(leg.rail.walkToMinutes, leg.rail.walkToStation)}</li>
          {leg.rail.rides.map((ride, index) => (
            <li key={`${ride.from}-${ride.to}-${index}`}>
              {index > 0 ? <em>{t.change}</em> : null}
              <b>{ride.line ?? t.rail}</b>
              <span>{ride.from} → {ride.to}</span>
              <small>{t.ride(ride.stops, ride.minutes)}</small>
            </li>
          ))}
          <li className="is-walk">{t.walkFrom(leg.rail.walkFromMinutes, leg.rail.walkFromStation)}</li>
        </ol>
      ) : null}
      {leg.mode !== "walk" || leg.minutes >= 12 ? (
        <a className="shiori-leg-link" href={leg.mapsUrl} rel="noreferrer" target="_blank">{t.openMaps} ↗</a>
      ) : null}
    </div>
  );
}

function MealRow({ meal, locale }: { meal: ShioriMeal; locale: Locale }) {
  const t = text[locale];
  const [state, setState] = useState<"closed" | "loading" | "ready" | "failed">("closed");
  const [candidates, setCandidates] = useState<FoodCandidate[]>([]);
  const relay = useMemo(() => appleRelayClient(), []);
  const open = async () => {
    if (state !== "closed") { setState("closed"); return; }
    if (!relay) { setState("failed"); return; }
    setState("loading");
    try {
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
      <div className="shiori-meal-head">
        <Icon name="meal" />
        <span>
          <b>{meal.kind === "lunch" ? t.lunch : t.dinner}</b> {meal.start}{meal.end ? `–${meal.end}` : locale === "ja" ? "ごろ" : ""}
          <small> ・ {t.mealNear(meal.nearName)}</small>
        </span>
        <button onClick={() => void open()} type="button">{state === "closed" ? t.showFood : t.hideFood}</button>
      </div>
      {state === "loading" ? <p className="shiori-quiet">{t.foodLoading}</p> : null}
      {state === "failed" ? <p className="shiori-quiet">{t.foodNone} <a href={mapsSearch} rel="noreferrer" target="_blank">Google Maps ↗</a></p> : null}
      {state === "ready" ? (
        <>
          <ul className="shiori-food">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <a href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
                  <b>{candidate.name}</b>
                  <small>{candidate.type}{typeof candidate.distanceMeters === "number" ? ` ・ ${t.walkAbout(Math.max(1, Math.round(candidate.distanceMeters * 1.3 / 75)))}` : ""}</small>
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
      const found = await findCafes(cafe, relay, locale);
      setPicks(found);
      setState(found.length > 0 ? "ready" : "failed");
    } catch {
      setState("failed");
    }
  };
  const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${locale === "ja" ? "カフェ" : "cafe"} ${cafe.search.latitude.toFixed(5)},${cafe.search.longitude.toFixed(5)}`)}`;
  return (
    <div className="shiori-meal is-cafe">
      <div className="shiori-meal-head">
        <Icon name="meal" />
        <span>
          <b>{t.cafe}</b> {cafe.time}{locale === "ja" ? "ごろ" : ""}
          <small> ・ {cafe.reason === "on-the-way" && cafe.toName ? t.cafeOnTheWay(cafe.fromName, cafe.toName) : t.cafeAfter(cafe.fromName)}</small>
        </span>
        <button onClick={() => void open()} type="button">{state === "closed" ? t.showCafes : t.hideCafes}</button>
      </div>
      {state === "loading" ? <p className="shiori-quiet">{t.foodLoading}</p> : null}
      {state === "failed" ? <p className="shiori-quiet">{t.cafeNone} <a href={mapsSearch} rel="noreferrer" target="_blank">Google Maps ↗</a></p> : null}
      {state === "ready" ? (
        <>
          <ul className="shiori-food">
            {picks.map((pick) => (
              <li className="has-action" key={pick.id}>
                <a href={pick.mapsUrl} rel="noreferrer" target="_blank">
                  <b>{pick.name}</b>
                  <small>{t.cafeKinds[pick.kind]} ・ {cafe.reason === "on-the-way" ? t.cafeDetour(pick.detourMinutes) : t.cafeWalk(pick.detourMinutes)}</small>
                </a>
                <button onClick={() => onAdd(pick)} type="button">{t.cafeAdd}</button>
              </li>
            ))}
          </ul>
          <p className="shiori-quiet">{t.cafeNote}</p>
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
  const hotels = answer?.key === key ? answer.hotels : [];
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
      if (!cancelled) setAnswer({ key, hotels: response.candidates.slice(0, 4) });
    }).catch(() => { if (!cancelled) setAnswer({ key, hotels: [] }); });
    return () => { cancelled = true; };
    // Keyed on the rounded centre; the other inputs follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locale]);
  if (!plan.stayNear) return null;
  return (
    <section className="shiori-section">
      <h2><Icon name="bed" /> {t.stayTitle}</h2>
      <p className="shiori-quiet">{t.stayBody}</p>
      {state === "loading" ? <p className="shiori-quiet">{t.stayLoading}</p> : null}
      {state === "failed" ? <p className="shiori-quiet">{t.stayNone}</p> : null}
      {state === "ready" ? (
        <ul className="shiori-hotels">
          {hotels.map((hotel) => {
            const using = trip.hotel?.name === hotel.name;
            const query = encodeURIComponent(hotel.name);
            return (
              <li className={using ? "is-using" : ""} key={hotel.id}>
                <div>
                  <b>{hotel.name}</b>
                  <small>{t.hotelDistance(hotel.routeAverageDistanceMeters)}</small>
                </div>
                <div className="shiori-hotel-actions">
                  {using
                    ? <button onClick={() => onHotel(null)} type="button">{t.clearHotel}</button>
                    : <button className="is-primary" onClick={() => onHotel({ name: hotel.name, lat: hotel.latitude, lon: hotel.longitude })} type="button">{t.useHotel}</button>}
                  {locale === "ja" ? <a href={`https://kw.travel.rakuten.co.jp/keyword/Search.do?f_query=${query}`} rel="noreferrer" target="_blank">{t.searchRakuten} ↗</a> : null}
                  <a href={`https://www.booking.com/searchresults.html?ss=${query}`} rel="noreferrer" target="_blank">{t.searchBooking} ↗</a>
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
  const [copied, setCopied] = useState(false);
  // Street paths looked up so far, keyed "walk|<leg>" / "drive|<leg>". Null
  // means the map service had no answer; it is not asked twice.
  const [routes, setRoutes] = useState<ReadonlyMap<string, ShioriRoute | null>>(() => new Map());
  const askedRoutes = useRef(new Set<string>());
  const routeAttempts = useRef(new Map<string, number>());
  const hydrated = useRef(false);

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
    if (!hydrated.current || trip.places.length === 0) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeTrip(trip));
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
  const planKey = useMemo(() => screen === "plan" ? `${planVisit}|${locale}|${encodeTrip(trip)}` : null, [screen, planVisit, locale, trip]);
  const [planned, setPlanned] = useState<{ key: string; visit: number; plan: ShioriPlan } | null>(null);
  useEffect(() => {
    if (!planKey) return;
    const handle = window.setTimeout(() => {
      setPlanned({ key: planKey, visit: planVisit, plan: buildShioriPlan({ places: trip.places, days: trip.days, hotel: trip.hotel, locale }, { rail, cities, routes }) });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [planKey, planVisit, trip, rail, cities, locale, routes]);
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

  const update = useCallback((change: (current: ShioriTrip) => ShioriTrip) => setTrip(change), []);
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
  const chooseCity = (destination: PopularDestination) => {
    // Another destination starts another trip; the one in hand is kept aside.
    if (trip.places.length > 0 && trip.cityId !== destination.id) {
      setPrevious(trip);
      try { window.localStorage.setItem(PREVIOUS_KEY, encodeTrip(trip)); } catch { /* ignore */ }
    }
    update((current) => withCity(current, destination, locale));
    setQuery("");
    setShowAll(false);
    go("pick");
  };
  const addSight = (sight: PopularSight) => update((current) => togglePlace(current, placeFromSight(sight, locale)));

  const addOther = async () => {
    const name = other.trim();
    if (!name || otherState === "busy") return;
    const kind = otherKind;
    if (kind !== "hotel" && trip.places.length >= MAX_PLACES) { setOtherState("full"); return; }
    setOtherState("busy");
    try {
      // The places already chosen go along so the lookup knows which city
      // this is; only the new line is read back.
      // With nothing chosen yet, the city's own best-known sights stand in
      // as that context (they resolve from the bundled list, not the network).
      const context = trip.places.length >= 2 || !city
        ? trip.places.map((place) => place.name)
        : [...trip.places.map((place) => place.name), ...city.sights.slice(0, 3).map((sight) => locale === "ja" ? sight.ja : sight.en)];
      const raw = [...context, name].join("\n");
      const result = await requestPlaceResolution(raw, "", locale);
      const hit = result.places.find((place) => place.input === name)
        ?? result.ambiguous.find((entry) => entry.input === name)?.candidates[0];
      if (!hit) { setOtherState("failed"); return; }
      // A same-named place on another continent is not what was meant.
      if (city) {
        const km = Math.hypot(hit.latitude - city.lat, (hit.longitude - city.lon) * Math.cos((city.lat * Math.PI) / 180)) * 111;
        if (km > city.radiusKm + 80) { setOtherState("failed"); return; }
      }
      if (kind === "hotel") {
        update((current) => ({ ...current, hotel: { name: hit.name, lat: hit.latitude, lon: hit.longitude } }));
      } else {
        update((current) => {
          const place: ShioriPlace = {
            id: hit.id,
            name: hit.name,
            lat: hit.latitude,
            lon: hit.longitude,
            ...(kind === "place"
              ? { stayMinutes: Math.min(240, Math.max(30, hit.planningDurationMinutes)), ...(hit.placeTypes?.[0] ? { kind: hit.placeTypes[0].replace(/_/g, " ") } : {}) }
              : { stayMinutes: kind === "lunch" ? 60 : 90, kind: "restaurant", meal: kind }),
          };
          // Adding a place that is already listed updates it (a sight that is
          // really tonight's dinner) instead of removing it.
          return current.places.some((entry) => entry.id === place.id)
            ? { ...current, places: current.places.map((entry) => entry.id === place.id ? { ...entry, ...place } : entry) }
            : togglePlace(current, place);
        });
      }
      setOther("");
      setOtherState("idle");
    } catch {
      setOtherState("failed");
    }
  };

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
        <b>TripCheck</b>
        <small>{t.tagline}</small>
      </button>
      <nav className="shiori-lang">
        <Link aria-current={locale === "ja" ? "true" : undefined} href="/ja" onClick={() => { try { window.localStorage.setItem("tripcheck-locale", "ja"); } catch { /* ignore */ } }}>日本語</Link>
        <Link aria-current={locale === "en" ? "true" : undefined} href="/" onClick={() => { try { window.localStorage.setItem("tripcheck-locale", "en"); } catch { /* ignore */ } }}>EN</Link>
      </nav>
    </header>
  );

  // Places the traveller typed in themselves: restaurants, and anything the
  // destination's list does not have.
  const extras = trip.places.filter((place) => place.meal || !city?.sights.some((sight) => `wikidata-${sight.q}` === place.id));
  const addForm = (
<form className="shiori-other" onSubmit={(event) => { event.preventDefault(); void addOther(); }}>
      <label htmlFor="shiori-other">{t.addOther}</label>
      <div className="shiori-pace" role="group" aria-label={t.addOther}>
        {(["place", "lunch", "dinner", "hotel"] as const).map((kind) => (
          <button aria-pressed={otherKind === kind} key={kind} onClick={() => { setOtherKind(kind); setOtherState("idle"); }} type="button">{t.addKinds[kind]}</button>
        ))}
      </div>
      <div className="shiori-other-row">
        <input id="shiori-other" onChange={(event) => { setOther(event.target.value); setOtherState("idle"); }} placeholder={t.addPlaceholders[otherKind]} value={other} />
        <button disabled={otherState === "busy" || !other.trim()} type="submit">{otherState === "busy" ? t.adding : t.add}</button>
      </div>
      {otherState === "failed" ? <p className="shiori-warn" role="alert">{t.addFailed}</p> : null}
      {otherState === "full" ? <p className="shiori-warn" role="alert">{t.addFull}</p> : null}
      <p className="shiori-quiet">{t.addHint}</p>
      {extras.length > 0 || trip.hotel ? (
        <ul className="shiori-chips">
          {extras.map((place) => (
            <li key={place.id}><button onClick={() => update((current) => togglePlace(current, place))} type="button">{place.meal ? `${t.mealShort[place.meal]}: ` : ""}{place.name} ×</button></li>
          ))}
          {trip.hotel ? <li><button onClick={() => update((current) => ({ ...current, hotel: null }))} type="button">{t.hotelChip}: {trip.hotel.name} ×</button></li> : null}
        </ul>
      ) : null}
    </form>
  );

  if (screen === "home") {
    return (
      <main className="shiori">
        {header}
        <section className="shiori-hero">
          <h1>{t.heroTitle}</h1>
          <p>{t.heroBody}</p>
          <label className="shiori-search">
            <span>{t.where}</span>
            <input autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder={t.wherePlaceholder} type="search" value={query} />
          </label>
          {[trip.places.length > 0 ? trip : saved, previous].flatMap((candidate, index) => candidate && candidate.places.length > 0 ? [(
            <button className="shiori-resume" key={index} onClick={() => { setTrip(candidate); setSelectedDay(0); go("plan"); }} type="button">
              {index === 0 ? t.resume : t.resumePrevious}：{candidate.cityName || candidate.places[0]?.name} ・ {candidate.places.length}
            </button>
          )] : [])}
        </section>
        <section className="shiori-cities">
          {query ? null : <h2>{t.popular}</h2>}
          <div className="shiori-city-grid">
            {matches.map((destination) => (
              <button className="shiori-city" key={destination.id} onClick={() => chooseCity(destination)} type="button">
                <Photo alt="" img={destination.sights.find((sight) => sight.img)?.img} width={480} />
                <span>{locale === "ja" ? destination.ja : destination.en}</span>
              </button>
            ))}
          </div>
          {cities.length > 0 && matches.length === 0 ? <p className="shiori-quiet">{t.noCity}</p> : null}
        </section>
        <footer className="shiori-foot">
          <p>{t.credits}</p>
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
          <h1>{t.pickTitle(trip.cityName)}</h1>
          <p className="shiori-quiet">{t.pickHint}</p>
          <div className="shiori-controls">
            <label>
              <span>{t.days}</span>
              <select onChange={(event) => update((current) => ({ ...current, days: Number(event.target.value) }))} value={trip.days}>
                {Array.from({ length: MAX_DAYS }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days}{t.dayUnit}</option>)}
              </select>
            </label>
          </div>
          <div className="shiori-sights">
            {sights.map((sight) => {
              const id = `wikidata-${sight.q}`;
              const isChosen = chosen.has(id);
              return (
                <button aria-pressed={isChosen} className={`shiori-sight${isChosen ? " is-chosen" : ""}`} key={sight.q} onClick={() => addSight(sight)} type="button">
                  <Photo alt="" img={sight.img} width={360} />
                  <span className="shiori-sight-check"><Icon name={isChosen ? "check" : "plus"} /></span>
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
          {addForm}
        </section>
        <div className="shiori-bar">
          <span>{trip.places.length > 0 ? t.selected(trip.places.length) : t.needOne}</span>
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
    }
  };

  const usedDays = plan?.days.length ?? 0;
  const setStay = (place: ShioriPlace, delta: number) => update((current) => ({
    ...current,
    places: current.places.map((entry) => entry.id === place.id ? { ...entry, stayMinutes: Math.min(720, Math.max(15, entry.stayMinutes + delta)) } : entry),
  }));
  const setDay = (place: ShioriPlace, value: number | null) => update((current) => ({
    ...current,
    places: current.places.map((entry) => entry.id === place.id ? { ...entry, day: value } : entry),
  }));

  return (
    <main className="shiori is-plan">
      {header}
      <div className="shiori-plan">
        <div className="shiori-plan-main">
          {planning ? <p aria-live="polite" className={`shiori-working${plan ? " is-update" : ""}`}>{plan ? t.updating : t.working}</p> : null}
          <div className="shiori-plan-head">
            <h1>{t.planTitle(trip.cityName || trip.places[0]?.name || "", trip.days)}</h1>
            <div className="shiori-plan-actions">
              <button onClick={() => go(city ? "pick" : "home")} type="button">{t.editPlaces}</button>
              <button onClick={() => void share()} type="button">{copied ? t.shared : t.share}</button>
              <a className="shiori-action-link" href={`https://line.me/R/share?text=${encodeURIComponent(`${t.planTitle(trip.cityName || trip.places[0]?.name || "", trip.days)} ${typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}#s=${encodeTrip(trip)}`}`)}`} rel="noreferrer" target="_blank">{t.shareLine}</a>
              <button onClick={() => window.print()} type="button">{t.print}</button>
            </div>
            <div className="shiori-controls">
              <label>
                <span>{t.days}</span>
                <select onChange={(event) => update((current) => ({ ...current, days: Number(event.target.value) }))} value={trip.days}>
                  {Array.from({ length: MAX_DAYS }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days}{t.dayUnit}</option>)}
                </select>
              </label>
            </div>
          </div>

          {plan && plan.notices.length > 0 ? (
            <section aria-label={t.noticesTitle} className="shiori-notices">
              <h2>{t.noticesTitle}</h2>
              <ul>
                {plan.notices.map((notice) => <li key={noticeKey(notice)}>{noticeView(notice)}</li>)}
              </ul>
            </section>
          ) : null}

          <div className="shiori-tabs" role="tablist">
            {plan?.days.map((entry) => (
              <button
                aria-selected={entry.index === activeDay}
                key={entry.index}
                onClick={() => { setOpenStop(null); setSelectedDay(entry.index); }}
                role="tab"
                style={{ ["--day" as string]: DAY_COLORS[entry.index % DAY_COLORS.length] }}
                type="button"
              >
                {t.dayTab(entry.index)}
              </button>
            ))}
            {plan && plan.freeDays > 0 ? <span className="shiori-tab-free">{t.freeTab} ×{plan.freeDays}</span> : null}
          </div>

          {plan?.days.map((day) => (
            <section className={`shiori-day${day.index === activeDay ? " is-current" : ""}`} key={day.index} style={{ ["--day" as string]: DAY_COLORS[day.index % DAY_COLORS.length] }}>
              <header>
                <h2>{t.dayTab(day.index)} <span>{day.title}</span></h2>
                <p>{t.dayMeta(day)}</p>
                <p className={`shiori-load is-${day.load}`}><b>{t.loads[day.load]}</b>{day.load === "tight" && !day.runsLate ? ` ・ ${t.loadTight}` : ""}</p>
                {day.runsLate ? <p className="shiori-warn">{t.late}</p> : null}
              </header>
              <ol className="shiori-timeline">
                {day.fromHotel ? <li className="is-leg"><LegCard heading={t.fromHotel} leg={day.fromHotel} locale={locale} /></li> : null}
                {day.stops.map((stop, index) => (
                  <li key={stop.place.id}>
                    {stop.waitMinutes > 0 ? <p className="shiori-wait">{t.wait(durationText(stop.waitMinutes, locale))}</p> : null}
                    <article className={`shiori-stop${openStop === stop.place.id ? " is-open" : ""}`}>
                      <button
                        className="shiori-stop-main"
                        onClick={() => { setOpenStop(openStop === stop.place.id ? null : stop.place.id); setFocus({ placeId: stop.place.id, token: Date.now() }); }}
                        type="button"
                      >
                        <span className="shiori-stop-number">{index + 1}</span>
                        <span className="shiori-stop-text">
                          <small>{stop.arrive}–{stop.leave}</small>
                          <b>{stop.place.name}</b>
                          <small>{stop.place.meal ? t.mealLabels[stop.place.meal] : kindLabel(stop.place.kind, locale)} ・ {t.stay}{durationText(stop.stayMinutes, locale)}</small>
                          {stop.mealMissed ? <small className="shiori-warn">{t.mealMissed}</small> : null}
                        </span>
                        <Photo alt="" img={stop.place.img} width={160} />
                      </button>
                      {openStop === stop.place.id ? (
                        <div className="shiori-stop-edit">
                          <div>
                            <button aria-label={t.shorter} onClick={() => setStay(stop.place, -15)} type="button">−15{t.minute}</button>
                            <span>{t.stay} {durationText(stop.place.stayMinutes, locale)}</span>
                            <button aria-label={t.longer} onClick={() => setStay(stop.place, 15)} type="button">+15{t.minute}</button>
                          </div>
                          <label>
                            <span>{t.moveDay}</span>
                            <select onChange={(event) => setDay(stop.place, event.target.value ? Number(event.target.value) : null)} value={stop.place.day ?? ""}>
                              <option value="">{t.auto}</option>
                              {Array.from({ length: trip.days }, (_, dayIndex) => <option key={dayIndex} value={dayIndex + 1}>{t.dayTab(dayIndex)}</option>)}
                            </select>
                          </label>
                          <button className="is-danger" onClick={() => update((current) => togglePlace(current, stop.place))} type="button">{t.remove}</button>
                          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.place.name} ${stop.place.lat.toFixed(5)},${stop.place.lon.toFixed(5)}`)}`} rel="noreferrer" target="_blank">{t.checkHours}</a>
                          {stop.place.img ? <a href={photoCreditUrl(stop.place.img)} rel="noreferrer" target="_blank">{t.photo}: Wikimedia Commons ↗</a> : null}
                        </div>
                      ) : null}
                    </article>
                    {day.meals.filter((meal) => meal.afterStop === index).map((meal) => <MealRow key={`${meal.kind}-${day.index}-${trip.places.length}`} locale={locale} meal={meal} />)}
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
                    {day.legs[index] ? <LegCard leg={day.legs[index]} locale={locale} /> : null}
                  </li>
                ))}
                {day.toHotel ? <li className="is-leg"><LegCard heading={t.toHotel} leg={day.toHotel} locale={locale} /></li> : null}
              </ol>
              {day.ideas.length > 0 ? (
                <div className="shiori-ideas">
                  <h3>{t.ideasTitle}</h3>
                  <ul className="shiori-chips">
                    {day.ideas.map((sight) => (
                      <li key={sight.q}><button onClick={() => addSight(sight)} type="button">＋ {locale === "ja" ? sight.ja : sight.en}</button></li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {day.rainIdeas.length > 0 ? (
                <div className="shiori-ideas is-rain">
                  <h3>{t.rainTitle}</h3>
                  <ul className="shiori-chips">
                    {day.rainIdeas.map((sight) => (
                      <li key={sight.q}><button onClick={() => addSight(sight)} type="button">＋ {locale === "ja" ? sight.ja : sight.en}</button></li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="shiori-quiet shiori-hours-note">{t.hoursNote}</p>
            </section>
          ))}

          {plan && plan.freeDays > 0 ? (
            <section className="shiori-section">
              <h2>{t.freeTitle(plan.freeDays)}</h2>
              <p className="shiori-quiet">{plan.freeDayIdeas.length > 0 ? t.freeBody : t.freeNone}</p>
              {plan.freeDayIdeas.length > 0 ? (
                <ul className="shiori-chips">
                  {plan.freeDayIdeas.map((sight) => (
                    <li key={sight.q}><button onClick={() => addSight(sight)} type="button">＋ {locale === "ja" ? sight.ja : sight.en}</button></li>
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

          <section className="shiori-section">{addForm}</section>

          {plan ? <StayNear locale={locale} onHotel={(hotel) => update((current) => ({ ...current, hotel }))} plan={plan} trip={trip} /> : null}

          <footer className="shiori-foot">
            <p>{t.note}</p>
            <p>{t.credits}</p>
            <p>
              <button className="shiori-link" onClick={() => { setTrip(emptyTrip); setSaved(null); go("home"); try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } window.history.replaceState({}, "", window.location.pathname); }} type="button">{t.newTrip}</button>
              {" ・ "}<Link href="/privacy">{t.privacy}</Link>
            </p>
          </footer>
        </div>
        <aside className="shiori-plan-map">
          {plan ? (
            <ShioriMap
              days={plan.days}
              focus={focus}
              hotel={trip.hotel}
              label={t.mapLabel}
              legend={{ rail: t.legendRail, street: t.legendWalk, straight: t.legendOther }}
              onSelectStop={(dayIndex, placeId) => { setSelectedDay(dayIndex); setOpenStop(placeId); }}
              selectedDay={activeDay}
            />
          ) : null}
        </aside>
      </div>
      {usedDays === 0 && plan ? <p className="shiori-quiet">{t.needOne}</p> : null}
    </main>
  );
}
