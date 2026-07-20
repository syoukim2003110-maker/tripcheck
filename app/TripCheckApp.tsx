"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import CinematicJourney from "./CinematicJourney";
import { copy, localeLabels, type Locale } from "../lib/i18n";
import { FoodRecommendationsError, foodSearchLinks, requestFoodRecommendations } from "../lib/food-recommendations-client";
import type { FoodCandidate } from "../lib/google-food";
import { fullTripDemo, getMockHotels } from "../lib/mock-trip";
import { LiveRoutesError, requestLiveTransit } from "../lib/live-routes-client";
import { buildRouteSketchPoints, routeSketchLine } from "../lib/route-sketch";
import { analyzeTrip, type Pace, type Severity } from "../lib/trip-analysis";
import type { AirportCode, BuiltPlanDay, CrowdOutlook, FlightKind, FoodRecommendationSlot, MealPlan } from "../lib/trip-builder";

const localeOrder: Locale[] = ["en", "ja"];
type LiveRouteStatus = "idle" | "loading" | "ready" | "missingDate" | "notConfigured" | "outOfRange" | "unavailable";
type FoodSearchState = {
  status: "idle" | "loading" | "ready" | "notConfigured" | "unavailable";
  query: string;
  fetchedAt: string;
  candidates: FoodCandidate[];
};
const emptyLiveTransitMinutes: Record<string, number> = {};

const answerCopy: Record<Locale, {
  eyebrow: string;
  title: string;
  intro: string;
  items: Array<{ question: string; answer: string }>;
}> = {
  en: {
    eyebrow: "Direct answers",
    title: "Before you trust the plan.",
    intro: "TripCheck turns an unordered Tokyo wishlist into a day-by-day route, then checks an existing timed itinerary when you already have one.",
    items: [
      { question: "What does TripCheck Japan build?", answer: "Add places in any order and choose the number of days. It groups nearby stops, orders each day, protects booked and must-do places, keeps optional stops as backups and compares walking, trains and taxis." },
      { question: "Can it recommend where to stay?", answer: "Yes—at area level. TripCheck ranks hotel areas by the total travel required for your own wishlist. It does not rank individual hotels by commission, price or generic popularity." },
      { question: "Does it account for flights and airports?", answer: "Yes. Arrival processing and the city transfer delay the first usable hour; the return trip and airport arrival buffer create a hard deadline on the last day." },
      { question: "How is it different from ChatGPT or Google Maps?", answer: "TripCheck makes the multi-day grouping and ordering decision immediately with reproducible algorithms. Google Maps remains the final source for live directions; AI is reserved for messy language and explanations, not travel facts." },
      { question: "Can it still check a finished itinerary?", answer: "Yes. If the input contains Day headings and times, TripCheck switches to checker mode, keeps reservations as anchors and looks for route or timing conflicts." },
      { question: "Are the transport comparisons live?", answer: "Public-transport minutes can be refreshed from Google Maps for a trip within its supported schedule window. Walking and taxi remain clearly labelled planning estimates; opening hours, ticket availability, weather and road traffic are not live yet." },
      { question: "Who can see the itinerary I paste?", answer: "The itinerary is analysed inside your browser and is not stored or reviewed by a person. Live transit sends only coordinate pairs and departure times; food search sends only one area's coordinates, meal type, language and selected phrase. Your pasted notes are never included." },
    ],
  },
  ja: {
    eyebrow: "端的な答え",
    title: "その旅程を信じる前に。",
    intro: "TripCheckは、順番のない東京の行きたい場所リストから日別旅程を作り、すでに時刻付き旅程があれば成立性も検査します。",
    items: [
      { question: "TripCheck Japanは何を作りますか？", answer: "行きたい場所を順不同で入れ、日数を選ぶだけです。近い場所を同じ日にまとめ、予約と必須予定を守り、任意候補は予備に残して、各区間の徒歩・電車・タクシーも比較します。" },
      { question: "泊まる場所もおすすめできますか？", answer: "現在は宿泊エリア単位で比較できます。入力した行き先への総移動量で順位を付け、広告報酬、価格、一般的な人気では個別ホテルを順位付けしません。" },
      { question: "飛行機と空港の時間も入りますか？", answer: "入ります。到着後の手続きと市内移動から初日の開始時刻を遅らせ、空港までの移動と搭乗前の余裕から最終日の締切を作ります。" },
      { question: "ChatGPTやGoogle Mapsとの違いは？", answer: "日ごとの分類と順番は再現可能なアルゴリズムで即時計算します。最新経路の最終確認はGoogle Mapsに任せ、AIは曖昧な文章理解と説明だけに使います。" },
      { question: "完成済みの旅程も検査できますか？", answer: "できます。入力に「1日目」などの日付見出しと時刻があれば自動で診断モードへ切り替わり、予約を軸にして経路と時間の衝突を探します。" },
      { question: "移動手段の比較はリアルタイムですか？", answer: "対応期間内の旅行なら、公共交通の時間をGoogle Mapsから更新できます。徒歩とタクシーは明示された計画用概算のままで、営業時間、チケット在庫、天候、道路交通はまだライブではありません。" },
      { question: "貼り付けた旅程は誰に見られますか？", answer: "旅程本文はブラウザ内で処理し、保存もしません。ライブ交通では地点間の座標と出発時刻、食事検索ではエリアの座標・昼夜・言語・選んだ検索語だけを送ります。貼り付けた文章は送りません。" },
    ],
  },
  ko: {
    eyebrow: "바로 답하기",
    title: "그 일정을 믿기 전에.",
    intro: "TripCheck는 순서 없는 도쿄 위시리스트를 날짜별 일정으로 만들고, 이미 시간이 있는 일정은 실행 가능한지 검사합니다.",
    items: [
      { question: "TripCheck Japan은 무엇을 만드나요?", answer: "장소를 아무 순서로 넣고 날짜 수를 고르면 가까운 곳을 묶어 방문 순서를 만듭니다. 예약과 필수 장소를 지키고 선택 장소는 예비로 남기며 구간별 도보·전철·택시도 비교합니다." },
      { question: "어디에 머물지 추천할 수 있나요?", answer: "현재는 숙박 지역 단위로 비교합니다. 실제 위시리스트의 총 이동량으로 순위를 정하며 광고 수익, 가격이나 일반 인기로 개별 호텔을 정렬하지 않습니다." },
      { question: "항공편과 공항 시간도 반영하나요?", answer: "네. 도착 절차와 도심 이동으로 첫날 시작을 늦추고 공항 이동과 탑승 전 여유로 마지막 날 마감 시간을 만듭니다." },
      { question: "ChatGPT나 Google Maps와 무엇이 다른가요?", answer: "날짜별 그룹과 순서는 재현 가능한 알고리즘으로 즉시 계산합니다. 최신 길은 Google Maps에서 확인하고 AI는 모호한 문장과 설명에만 씁니다." },
      { question: "완성된 일정도 검사할 수 있나요?", answer: "네. 날짜 제목과 시간이 있으면 자동으로 검사 모드로 바뀌어 예약을 기준점으로 유지하고 경로와 시간 충돌을 찾습니다." },
      { question: "교통수단 비교는 실시간인가요?", answer: "지원 일정 범위 안의 여행은 대중교통 시간을 Google Maps에서 업데이트할 수 있습니다. 도보와 택시는 계획 추정치이며 영업시간, 티켓, 날씨와 도로 교통은 아직 실시간이 아닙니다." },
      { question: "붙여 넣은 일정은 누가 볼 수 있나요?", answer: "일정 본문은 브라우저에서 분석하며 저장하거나 사람이 열람하지 않습니다. 실시간 교통을 선택한 경우에만 붙여 넣은 메모가 아닌 좌표 쌍과 예정 출발 시간을 TripCheck를 통해 Google Maps에 보냅니다." },
    ],
  },
  zh: {
    eyebrow: "直接回答",
    title: "在相信这份行程之前。",
    intro: "TripCheck会把无序的东京愿望清单变成每日行程；如果已有带时间的计划，也能检查是否可执行。",
    items: [
      { question: "TripCheck Japan会生成什么？", answer: "按任意顺序输入地点并选择天数，系统会把附近地点分组并安排每天顺序，保护预约与必去地点，把可选地点留作备用，并比较每段的步行、电车和出租车。" },
      { question: "可以推荐住宿地点吗？", answer: "目前可在住宿区域层面比较。排名只依据你的地点清单所需的总移动量，不按佣金、价格或通用人气给单个酒店排序。" },
      { question: "会计入航班和机场时间吗？", answer: "会。到达手续和市区交通会推迟第一天的开始；前往机场和登机前预留会形成最后一天的硬性截止时间。" },
      { question: "它与ChatGPT或Google Maps有什么不同？", answer: "每日分组和排序由可复现算法即时计算。实时路线最终交给Google Maps确认，AI只用于理解模糊文字和改善说明。" },
      { question: "还能检查已完成的行程吗？", answer: "可以。输入含日期标题和时间时会自动切换到检查模式，保留预约锚点并寻找路线与时间冲突。" },
      { question: "交通方式比较是实时的吗？", answer: "在支持的日期范围内，可从Google Maps更新公共交通时间。步行与出租车仍是明确标注的规划估算；营业时间、门票、天气与道路交通尚未实时连接。" },
      { question: "谁可以看到我粘贴的行程？", answer: "行程正文在浏览器内分析，不会保存或交由人工查看。只有你主动选择实时交通时，才会通过TripCheck向Google Maps发送地点坐标和计划出发时间，而不会发送粘贴的文字。" },
    ],
  },
};

const routeCopy: Record<Locale, {
  eyebrow: string;
  engine: string;
  title: string;
  detailTitle: string;
  detailTitle: string;
  body: string;
  recognized: string;
  before: string;
  after: string;
  saved: string;
  unchanged: string;
  dayChanged: string;
  dayKept: string;
  exact: string;
  heuristic: string;
  openMaps: string;
  disclosure: string;
  source: string;
  anchor: string;
}> = {
  en: {
    eyebrow: "Instant geography",
    engine: "INSTANT · ON-DEVICE",
    title: "Remove the backtracking first.",
    body: "Known Tokyo stops are ordered by geographic distance in your browser. Your first stop stays fixed; days and reservations are never merged automatically.",
    recognized: "known stops",
    before: "draft path",
    after: "shorter path",
    saved: "less backtracking",
    unchanged: "already efficient",
    dayChanged: "A shorter order",
    dayKept: "Your order is already compact",
    exact: "exact shortest path",
    heuristic: "fast route heuristic",
    openMaps: "Check this order in Google Maps",
    disclosure: "Straight-line geography only. Google calculates the live transit route after you choose to open it; those selected coordinates are then shared with Google.",
    source: "place source",
    anchor: "reservation-sensitive",
  },
  ja: {
    eyebrow: "即時の位置関係チェック",
    engine: "即時計算 · 端末内処理",
    title: "まず、無駄な往復をなくす。",
    body: "既知の東京スポットを、ブラウザ内で地理的に短い順へ並べます。最初の場所は固定し、日付や予約を勝手にまたいで動かしません。",
    recognized: "認識できた場所",
    before: "元の順番",
    after: "短い順番",
    saved: "往復を削減",
    unchanged: "すでに効率的",
    dayChanged: "より短い順番",
    dayKept: "元の順番で十分コンパクト",
    exact: "厳密な最短経路",
    heuristic: "高速近似経路",
    openMaps: "この順番をGoogle Mapsで確認",
    disclosure: "ここでは直線距離だけを比較します。Google Mapsを開く操作をしたときだけ、選択された地点の座標がGoogleへ渡り、最新の公共交通経路が計算されます。",
    source: "場所の出典",
    anchor: "予約注意",
  },
  ko: {
    eyebrow: "즉시 위치 검사",
    engine: "즉시 계산 · 기기 내 처리",
    title: "불필요한 왕복부터 없앱니다.",
    body: "알려진 도쿄 장소를 브라우저에서 지리적으로 짧은 순서로 정렬합니다. 첫 장소와 날짜는 유지하며 예약을 자동으로 다른 날로 옮기지 않습니다.",
    recognized: "인식한 장소",
    before: "원래 경로",
    after: "짧은 경로",
    saved: "왕복 감소",
    unchanged: "이미 효율적",
    dayChanged: "더 짧은 순서",
    dayKept: "현재 순서가 이미 간결함",
    exact: "정확한 최단 경로",
    heuristic: "빠른 경로 근사",
    openMaps: "Google Maps에서 이 순서 확인",
    disclosure: "여기서는 직선거리만 비교합니다. Google Maps를 직접 열 때만 선택한 좌표가 Google에 전달되어 최신 대중교통 경로가 계산됩니다.",
    source: "장소 출처",
    anchor: "예약 주의",
  },
  zh: {
    eyebrow: "即时位置检查",
    engine: "即时计算 · 设备内处理",
    title: "先去掉不必要的折返。",
    body: "在浏览器内按地理距离排列已知的东京地点。首个地点和日期保持不变，不会自动跨天移动预约。",
    recognized: "已识别地点",
    before: "原顺序",
    after: "更短顺序",
    saved: "减少折返",
    unchanged: "已经高效",
    dayChanged: "更短的顺序",
    dayKept: "当前顺序已经紧凑",
    exact: "精确最短路径",
    heuristic: "快速近似路径",
    openMaps: "在Google Maps中确认此顺序",
    disclosure: "这里仅比较直线距离。只有在你主动打开Google Maps时，所选地点坐标才会发送给Google并计算最新公共交通路线。",
    source: "地点来源",
    anchor: "预约注意",
  },
};

const timeCopy: Record<Locale, {
  eyebrow: string;
  engine: string;
  title: string;
  body: string;
  timed: string;
  conflicts: string;
  tight: string;
  longest: string;
  finish: string;
  anchor: string;
  customStay: string;
  assumedStay: string;
  walk: string;
  transit: string;
  unknownTravel: string;
  shortBy: string;
  buffer: string;
  comfortable: string;
  disclosure: string;
}> = {
  en: {
    eyebrow: "Instant time check",
    engine: "INSTANT · PLANNING ESTIMATES",
    title: "See where the clock breaks.",
    body: "TripCheck compares the time between your entries with a stay assumption and a local travel estimate. A negative buffer means the next time cannot work as written.",
    timed: "timed stops",
    conflicts: "time conflicts",
    tight: "tight connections",
    longest: "longest day",
    finish: "estimated finish",
    anchor: "reservation-sensitive",
    customStay: "your stay",
    assumedStay: "planning stay",
    walk: "walk estimate",
    transit: "transit estimate",
    unknownTravel: "travel not estimated",
    shortBy: "short by",
    buffer: "buffer",
    comfortable: "workable buffer",
    disclosure: "Stay durations are editable planning assumptions, not venue facts. Add “stay 45m” to a line to override one. Travel remains a formula-based estimate until live routing is connected.",
  },
  ja: {
    eyebrow: "即時の時間チェック",
    engine: "即時計算 · 計画用の概算",
    title: "時計が破綻する場所を見つける。",
    body: "予定間の時間を、滞在の計画値と移動概算に分けて比較します。余白がマイナスなら、書かれた時刻のままでは次へ間に合いません。",
    timed: "時刻付き予定",
    conflicts: "時間の衝突",
    tight: "余白が少ない区間",
    longest: "最長の一日",
    finish: "終了目安",
    anchor: "予約注意",
    customStay: "指定した滞在",
    assumedStay: "滞在の計画値",
    walk: "徒歩概算",
    transit: "交通概算",
    unknownTravel: "移動時間は未計算",
    shortBy: "不足",
    buffer: "余白",
    comfortable: "余白あり",
    disclosure: "滞在時間は施設の公式値ではなく、編集可能な計画用の仮定です。行に「滞在45分」と書くと上書きできます。ライブ経路接続までは移動も数式による概算です。",
  },
  ko: {
    eyebrow: "즉시 시간 검사",
    engine: "즉시 계산 · 계획 추정치",
    title: "시간이 무너지는 구간을 찾습니다.",
    body: "일정 사이 시간을 체류 계획값과 이동 추정치로 나눠 비교합니다. 여유가 음수면 적힌 시간대로 다음 장소에 갈 수 없습니다.",
    timed: "시간이 있는 일정",
    conflicts: "시간 충돌",
    tight: "촉박한 연결",
    longest: "가장 긴 하루",
    finish: "예상 종료",
    anchor: "예약 주의",
    customStay: "지정 체류",
    assumedStay: "계획 체류",
    walk: "도보 추정",
    transit: "교통 추정",
    unknownTravel: "이동시간 미계산",
    shortBy: "부족",
    buffer: "여유",
    comfortable: "여유 있음",
    disclosure: "체류시간은 시설 공식 정보가 아니라 수정 가능한 계획 가정입니다. 줄에 ‘체류 45분’을 적어 덮어쓸 수 있습니다. 실시간 경로 연결 전까지 이동도 수식 기반 추정치입니다.",
  },
  zh: {
    eyebrow: "即时检查时间",
    engine: "即时计算 · 规划估算",
    title: "找出时间会崩溃的区间。",
    body: "把两项安排之间的时间拆成停留规划值和移动估算。如果余量为负，按当前写法无法准时到达下一地点。",
    timed: "带时间安排",
    conflicts: "时间冲突",
    tight: "紧张衔接",
    longest: "最长一天",
    finish: "预计结束",
    anchor: "预约注意",
    customStay: "指定停留",
    assumedStay: "规划停留",
    walk: "步行估算",
    transit: "交通估算",
    unknownTravel: "未估算移动时间",
    shortBy: "不足",
    buffer: "余量",
    comfortable: "余量充足",
    disclosure: "停留时间是可编辑的规划假设，并非设施官方数据。在行内加入“停留45分钟”即可覆盖。连接实时路线前，移动时间也只是公式估算。",
  },
};

const planCopy: Record<Locale, {
  eyebrow: string;
  engine: string;
  title: string;
  body: string;
  daysBuilt: string;
  placed: string;
  unresolved: string;
  overflow: string;
  dayLength: string;
  stay: string;
  recommended: string;
  fastest: string;
  modes: Record<"walk" | "transit" | "taxi", string>;
  openMaps: string;
  unresolvedTitle: string;
  unresolvedBody: string;
  crowded: string;
  disclosure: string;
}> = {
  en: {
    eyebrow: "Built from your wishlist",
    engine: "INSTANT · PRIVATE",
    title: "Your places, now a trip.",
    detailTitle: "The route, day by day.",
    body: "TripCheck groups nearby places into the days you have, protects meal and reservation time, builds around the hotel and keeps the airport window clear.",
    daysBuilt: "days built",
    placed: "places scheduled",
    unresolved: "need map lookup",
    overflow: "days needing adjustment",
    dayLength: "planning span",
    stay: "planning stay",
    recommended: "best balance",
    fastest: "fastest",
    modes: { walk: "Walk", transit: "Train", taxi: "Taxi" },
    openMaps: "Open this day in Google Maps",
    unresolvedTitle: "Kept aside, not discarded",
    unresolvedBody: "These entries are still in your trip. The local catalog cannot locate them yet, so TripCheck will not guess where they belong.",
    crowded: "At least one day needs more time, fewer stops or a different flight window.",
    disclosure: "Transport minutes are local planning estimates, not live traffic or train results. ‘Best balance’ prefers a short walk, then public transit unless a taxi saves substantial time. Open any mode to verify that leg in Google Maps.",
  },
  ja: {
    eyebrow: "行きたい場所から自動作成",
    engine: "即時作成 · プライベート",
    title: "行きたい場所が、旅程になった。",
    detailTitle: "日ごとの最適な回り方。",
    body: "近い場所を使える日数へまとめ、予約と食事時間を守り、ホテル往復と到着日・出発日の空港時間まで含めて組みます。",
    daysBuilt: "作成した日数",
    placed: "配置した場所",
    unresolved: "地図確認が必要",
    overflow: "調整が必要な日",
    dayLength: "一日の計画時間",
    stay: "滞在の計画値",
    recommended: "効率重視",
    fastest: "最速",
    modes: { walk: "徒歩", transit: "電車", taxi: "タクシー" },
    openMaps: "この一日をGoogle Mapsで開く",
    unresolvedTitle: "消さずに、保留しました",
    unresolvedBody: "この場所も旅の候補に残っています。ローカルカタログでは位置を特定できないため、勝手な日程配置はしていません。",
    crowded: "日数、候補数、または便の時間を調整したい日があります。",
    disclosure: "移動分数はライブ交通・列車結果ではなく計画用の概算です。「効率重視」は短い距離なら徒歩、それ以外はタクシーが大幅に速い場合を除いて公共交通を優先します。各手段を押すと、その区間をGoogle Mapsで確認できます。",
  },
  ko: {
    eyebrow: "가고 싶은 곳으로 자동 생성",
    engine: "즉시 생성 · 비공개",
    title: "장소 목록이 여행 일정이 되었습니다.",
    detailTitle: "날짜별로 정리한 경로.",
    body: "가까운 장소를 날짜별로 묶고 예약과 식사 시간을 지키며 호텔 왕복과 공항 시간까지 포함합니다.",
    daysBuilt: "생성한 날짜",
    placed: "배치한 장소",
    unresolved: "지도 확인 필요",
    overflow: "조정이 필요한 날",
    dayLength: "하루 계획 시간",
    stay: "계획 체류",
    recommended: "효율 우선",
    fastest: "가장 빠름",
    modes: { walk: "도보", transit: "전철", taxi: "택시" },
    openMaps: "이 하루를 Google Maps에서 열기",
    unresolvedTitle: "삭제하지 않고 보류했습니다",
    unresolvedBody: "이 장소도 여행 후보에 남아 있습니다. 로컬 카탈로그가 위치를 찾지 못해 임의로 날짜에 넣지 않았습니다.",
    crowded: "날짜, 장소 수 또는 항공편 시간을 조정해야 하는 날이 있습니다.",
    disclosure: "이동 시간은 실시간 교통 결과가 아닌 계획 추정치입니다. 효율 우선은 짧으면 걷고, 택시가 크게 빠르지 않으면 대중교통을 우선합니다. 각 수단을 누르면 Google Maps에서 해당 구간을 확인할 수 있습니다.",
  },
  zh: {
    eyebrow: "根据想去地点自动生成",
    engine: "即时生成 · 私密处理",
    title: "地点清单已经变成行程。",
    detailTitle: "按天整理的游览路线。",
    body: "把附近地点分到每天，保护预约与用餐时间，并计入酒店往返和到达、出发日的机场时间。",
    daysBuilt: "已生成天数",
    placed: "已安排地点",
    unresolved: "需要地图确认",
    overflow: "需要调整的天数",
    dayLength: "每日规划时长",
    stay: "规划停留",
    recommended: "效率优先",
    fastest: "最快",
    modes: { walk: "步行", transit: "电车", taxi: "出租车" },
    openMaps: "在Google Maps中打开这一天",
    unresolvedTitle: "没有删除，只是暂缓安排",
    unresolvedBody: "这些地点仍保留在旅行候选中。本地目录无法确定位置，因此不会擅自把它们排进某一天。",
    crowded: "至少有一天需要增加时间、减少地点或调整航班时段。",
    disclosure: "移动分钟数是规划估算，并非实时交通或列车结果。效率优先会在短距离选择步行，其他情况优先公共交通，除非出租车能明显节省时间。点击任一方式可在Google Maps中核对该路段。",
  },
};

const contextCopy: Record<Locale, {
  eyebrow: string;
  title: string;
  body: string;
  hotel: string;
  hotelPlaceholder: string;
  tripStart: string;
  arrival: string;
  departure: string;
  flightTime: string;
  flightKind: string;
  none: string;
  international: string;
  domestic: string;
  baseEyebrow: string;
  baseTitle: string;
  baseBody: string;
  selectedBase: string;
  unresolvedBase: string;
  recommended: string;
  routeDistance: string;
  airportTitle: string;
  arrivalReady: string;
  departureLeave: string;
  airportTime: string;
  cityTransfer: string;
  previousDay: string;
  nextDay: string;
  officialGuide: string;
  checkMaps: string;
  hotelTravel: string;
  departureDeadline: string;
  overrun: string;
}> = {
  en: {
    eyebrow: "Details that change the answer",
    title: "Where the trip starts and ends.",
    body: "Optional, but useful. A hotel base and flight times change the route, the first usable hour and when the last day must stop.",
    hotel: "Hotel or nearest station",
    hotelPlaceholder: "e.g. hotel near Shinjuku Station",
    tripStart: "First day in Tokyo",
    arrival: "Arrival airport",
    departure: "Departure airport",
    flightTime: "Flight time",
    flightKind: "Flight type",
    none: "Not set",
    international: "International",
    domestic: "Domestic",
    baseEyebrow: "Hotel location",
    baseTitle: "Stay where the trip gets lighter.",
    baseBody: "Areas are ranked only by the travel needed for the places you entered—not by commission, hotel quality or price.",
    selectedBase: "Route built around",
    unresolvedBase: "This hotel is kept in the trip, but its location is not resolved yet.",
    recommended: "Best base areas for this wishlist",
    routeDistance: "estimated total day-route distance",
    airportTitle: "Airport time is part of the trip.",
    arrivalReady: "Ready to start in Tokyo",
    departureLeave: "Leave the hotel by",
    airportTime: "airport buffer",
    cityTransfer: "city transfer",
    previousDay: "previous day",
    nextDay: "next day",
    officialGuide: "official airport guidance",
    checkMaps: "check airport route",
    hotelTravel: "hotel travel",
    departureDeadline: "sightseeing deadline",
    overrun: "plan runs over by",
  },
  ja: {
    eyebrow: "答えが変わる条件",
    title: "旅の始まりと終わりも入れる。",
    body: "任意ですが、ホテルと便の時刻を入れると、回る順番、初日に動ける時刻、最終日に切り上げる時刻まで変わります。",
    hotel: "ホテル名または最寄り駅",
    hotelPlaceholder: "例：新宿駅近くのホテル",
    tripStart: "東京旅行の初日",
    arrival: "到着空港",
    departure: "出発空港",
    flightTime: "便の時刻",
    flightKind: "便の種類",
    none: "設定なし",
    international: "国際線",
    domestic: "国内線",
    baseEyebrow: "ホテルの立地",
    baseTitle: "この旅が軽くなる場所に泊まる。",
    baseBody: "入力した行き先への移動負担だけでエリアを比較します。広告報酬、ホテルの品質、価格による順位ではありません。",
    selectedBase: "この拠点を含めて計算",
    unresolvedBase: "ホテル名は旅に残していますが、現在は位置を特定できないため経路へ反映していません。",
    recommended: "この行き先に合う宿泊エリア",
    routeDistance: "日別ルートの推定総距離",
    airportTitle: "空港までが、旅行の時間です。",
    arrivalReady: "東京で動き始められる目安",
    departureLeave: "ホテルを出る目安",
    airportTime: "空港で確保する時間",
    cityTransfer: "市内との移動",
    previousDay: "前日",
    nextDay: "翌日",
    officialGuide: "空港の公式案内",
    checkMaps: "空港経路を確認",
    hotelTravel: "ホテル往復",
    departureDeadline: "観光を切り上げる時刻",
    overrun: "超過",
  },
  ko: {
    eyebrow: "답을 바꾸는 조건",
    title: "여행의 시작과 끝까지 넣으세요.",
    body: "선택 사항이지만 호텔과 항공편 시간을 넣으면 방문 순서, 첫날 시작 시간과 마지막 날 종료 시간이 달라집니다.",
    hotel: "호텔 또는 가까운 역",
    hotelPlaceholder: "예: 신주쿠역 근처 호텔",
    tripStart: "도쿄 여행 첫날",
    arrival: "도착 공항",
    departure: "출발 공항",
    flightTime: "항공편 시간",
    flightKind: "항공편 종류",
    none: "설정 안 함",
    international: "국제선",
    domestic: "국내선",
    baseEyebrow: "호텔 위치",
    baseTitle: "이 여행이 가벼워지는 곳에 머무세요.",
    baseBody: "입력한 장소까지의 이동만으로 지역을 비교합니다. 광고 수익, 호텔 품질이나 가격 순위가 아닙니다.",
    selectedBase: "이 거점을 포함해 계산",
    unresolvedBase: "호텔은 여행에 남아 있지만 현재 위치를 찾지 못해 경로에는 반영하지 않았습니다.",
    recommended: "이 위시리스트에 맞는 숙박 지역",
    routeDistance: "예상 일일 경로 총거리",
    airportTitle: "공항까지의 시간도 여행입니다.",
    arrivalReady: "도쿄에서 시작 가능한 시간",
    departureLeave: "호텔 출발 시간",
    airportTime: "공항 여유",
    cityTransfer: "도심 이동",
    previousDay: "전날",
    nextDay: "다음 날",
    officialGuide: "공항 공식 안내",
    checkMaps: "공항 경로 확인",
    hotelTravel: "호텔 왕복",
    departureDeadline: "관광 종료 시각",
    overrun: "초과",
  },
  zh: {
    eyebrow: "会改变答案的条件",
    title: "把旅行的起点和终点也算进去。",
    body: "选填，但很有用。酒店和航班时间会改变游览顺序、第一天可出发时间以及最后一天必须结束的时间。",
    hotel: "酒店或最近车站",
    hotelPlaceholder: "例如：新宿站附近的酒店",
    tripStart: "东京旅行第一天",
    arrival: "到达机场",
    departure: "出发机场",
    flightTime: "航班时间",
    flightKind: "航班类型",
    none: "未设置",
    international: "国际航班",
    domestic: "国内航班",
    baseEyebrow: "酒店位置",
    baseTitle: "住在能让旅程更轻松的地方。",
    baseBody: "只按你输入地点所需的移动量排名，不受佣金、酒店质量或价格影响。",
    selectedBase: "路线已围绕此区域计算",
    unresolvedBase: "酒店仍保留在旅行中，但目前无法确定位置，因此尚未影响路线。",
    recommended: "适合这份清单的住宿区域",
    routeDistance: "预计每日路线总距离",
    airportTitle: "去机场的时间也是旅行时间。",
    arrivalReady: "可在东京开始活动",
    departureLeave: "最晚离开酒店",
    airportTime: "机场预留",
    cityTransfer: "市区交通",
    previousDay: "前一天",
    nextDay: "第二天",
    officialGuide: "机场官方指南",
    checkMaps: "查看机场路线",
    hotelTravel: "酒店往返",
    departureDeadline: "观光结束时间",
    overrun: "超出",
  },
};

const demoCopy: Record<Locale, {
  fullDemo: string;
  mockHotels: string;
  mockBadge: string;
  perNight: string;
  stationWalk: string;
  useHotel: string;
  selected: string;
  disclaimer: string;
}> = {
  en: {
    fullDemo: "Run the full trip demo",
    mockHotels: "Example hotel choices",
    mockBadge: "MOCK DATA",
    perNight: "per night",
    stationWalk: "walk to station",
    useHotel: "Build around this hotel",
    selected: "In this plan",
    disclaimer: "Hotel names, prices and walking minutes are fictional demo data. The geographic area ranking is calculated from the wishlist.",
  },
  ja: {
    fullDemo: "ホテル・飛行機入りデモを実行",
    mockHotels: "ホテル候補の完成イメージ",
    mockBadge: "モックデータ",
    perNight: "1泊",
    stationWalk: "駅まで徒歩",
    useHotel: "このホテルで旅程を作る",
    selected: "この旅程で選択中",
    disclaimer: "ホテル名、価格、駅までの分数は操作確認用の架空データです。宿泊エリアの順位だけは、入力した行き先から計算しています。",
  },
  ko: {
    fullDemo: "호텔·항공편 포함 데모 실행",
    mockHotels: "호텔 선택 완성 예시",
    mockBadge: "목업 데이터",
    perNight: "1박",
    stationWalk: "역까지 도보",
    useHotel: "이 호텔로 일정 만들기",
    selected: "현재 일정에서 선택",
    disclaimer: "호텔명, 가격과 역 도보 시간은 체험용 가상 데이터입니다. 숙박 지역 순위는 입력한 장소에서 실제 계산합니다.",
  },
  zh: {
    fullDemo: "运行酒店与航班完整演示",
    mockHotels: "酒店选择完成示例",
    mockBadge: "模拟数据",
    perNight: "每晚",
    stationWalk: "步行到车站",
    useHotel: "围绕此酒店生成行程",
    selected: "当前行程已选择",
    disclaimer: "酒店名称、价格和步行分钟均为演示用虚构数据；住宿区域排名由输入地点实际计算。",
  },
};

const constraintCopy: Record<Locale, {
  guideTitle: string;
  guideBody: string;
  example: string;
  must: string;
  reserved: string;
  optional: string;
  protected: string;
  lateBy: string;
  backupTitle: string;
  backupBody: string;
}> = {
  en: {
    guideTitle: "Protect what matters",
    guideBody: "Add a day, time or priority on the same line. Everything else can stay unordered.",
    example: "Ghibli Museum — Day 2 10:00 booked · must",
    must: "Must-do",
    reserved: "Reserved",
    optional: "If time",
    protected: "conditions protected",
    lateBy: "late by",
    backupTitle: "Ready as a backup",
    backupBody: "These optional places were kept out of the main route because adding them would break your pace or airport deadline.",
  },
  ja: {
    guideTitle: "大事な予定だけ固定する",
    guideBody: "同じ行に日付・予約時刻・優先度を追記できます。それ以外は順不同のままで大丈夫です。",
    example: "三鷹の森ジブリ美術館 — 2日目 10:00 予約 · 必須",
    must: "必ず行く",
    reserved: "予約",
    optional: "時間があれば",
    protected: "守った条件",
    lateBy: "遅れ",
    backupTitle: "予備候補として残しました",
    backupBody: "入れると旅行ペースまたは空港の締切を壊す任意候補です。削除せず、余裕ができたときに使えるよう残しています。",
  },
  ko: {
    guideTitle: "중요한 일정만 고정",
    guideBody: "같은 줄에 날짜, 예약 시간이나 우선순위를 추가하세요. 나머지는 순서 없이 넣어도 됩니다.",
    example: "지브리 미술관 — 2일차 10:00 예약 · 필수",
    must: "꼭 가기",
    reserved: "예약",
    optional: "시간 되면",
    protected: "보호한 조건",
    lateBy: "지연",
    backupTitle: "예비 후보로 남겼습니다",
    backupBody: "추가하면 여행 속도나 공항 마감 시간을 넘기는 선택 장소입니다. 삭제하지 않고 여유가 생길 때를 위해 보관했습니다.",
  },
  zh: {
    guideTitle: "只固定真正重要的安排",
    guideBody: "可在同一行补充日期、预约时间或优先级，其余地点仍可随意排序输入。",
    example: "三鹰之森吉卜力美术馆 — 第2天 10:00 预约 · 必去",
    must: "必去",
    reserved: "预约",
    optional: "有时间再去",
    protected: "已保护条件",
    lateBy: "迟到",
    backupTitle: "已保留为备用地点",
    backupBody: "加入这些可选地点会打乱旅行节奏或超过机场截止时间，因此暂不放入主路线，但不会删除。",
  },
};

const editingCopy: Record<Locale, {
  eyebrow: string;
  title: string;
  body: string;
  dayStart: string;
  stayTime: string;
  arrivalAdjusted: string;
  reset: string;
}> = {
  en: {
    eyebrow: "Make it yours",
    title: "Change a time. The whole day responds.",
    body: "Set when each day begins and how long you want at a place. Routes, reservations and the airport deadline recalculate immediately.",
    dayStart: "Start this day",
    stayTime: "Time here",
    arrivalAdjusted: "Arrival time sets the earliest possible start.",
    reset: "Reset timing",
  },
  ja: {
    eyebrow: "自分の旅に合わせる",
    title: "時間を変えると、一日すべてが動く。",
    body: "日ごとの開始時刻と各場所の滞在時間を変更できます。経路、予約、空港の締切まで即座に再計算します。",
    dayStart: "この日の開始",
    stayTime: "ここで過ごす時間",
    arrivalAdjusted: "到着時刻より前には開始できないため、自動調整しています。",
    reset: "時間を初期値へ戻す",
  },
  ko: {
    eyebrow: "내 여행에 맞추기",
    title: "시간 하나를 바꾸면 하루 전체가 움직입니다.",
    body: "날짜별 시작 시간과 장소별 체류 시간을 바꾸세요. 경로, 예약과 공항 마감 시간을 즉시 다시 계산합니다.",
    dayStart: "이 날 시작",
    stayTime: "이곳 체류 시간",
    arrivalAdjusted: "도착 시간보다 일찍 시작할 수 없어 자동 조정했습니다.",
    reset: "시간 초기화",
  },
  zh: {
    eyebrow: "按你的旅行调整",
    title: "改一个时间，整天行程都会响应。",
    body: "可修改每天开始时间和各地点停留时长，路线、预约与机场截止时间会立即重新计算。",
    dayStart: "当天开始时间",
    stayTime: "在此停留",
    arrivalAdjusted: "无法早于抵达时间开始，已自动调整。",
    reset: "重置时间",
  },
};

const mealCopy: Record<Locale, {
  input: string;
  inputHint: string;
  all: string;
  dinner: string;
  none: string;
  briefEyebrow: string;
  briefTitle: string;
  briefBody: string;
  reservations: string;
  mealBreaks: string;
  toDecide: string;
  noReservations: string;
  noMeals: string;
  nothingOpen: string;
  lunch: string;
  dinnerLabel: string;
  chooseRestaurantLater: string;
  userLocation: string;
  protectedTime: string;
  localPause: string;
  crowd: string;
  crowdLevels: Record<CrowdOutlook["level"], string>;
  weekday: string;
  weekend: string;
  weekendUplift: string;
  peakTime: string;
  crowdEstimate: string;
  crowdBasis: string;
}> = {
  en: {
    input: "Food suggestions",
    inputHint: "Suggestions stay flexible and never change the itinerary time.",
    all: "Suggest around the route",
    dinner: "Dinner ideas only",
    none: "Hide food ideas",
    briefEyebrow: "Trip brief",
    briefTitle: "What is fixed—and what is still open.",
    briefBody: "See the commitments that shape the route. Food ideas remain separate so you can decide on the day.",
    reservations: "Fixed reservations",
    mealBreaks: "Meal windows",
    toDecide: "Still to decide",
    noReservations: "No fixed reservations yet",
    noMeals: "No automatic meal breaks",
    nothingOpen: "No unresolved places",
    lunch: "Lunch",
    dinnerLabel: "Dinner",
    chooseRestaurantLater: "restaurant to choose later",
    userLocation: "user-entered · area location is approximate",
    protectedTime: "protected in the schedule",
    localPause: "Meal break in this area — no extra cross-city move",
    crowd: "Crowd outlook",
    crowdLevels: { quiet: "Light", moderate: "Moderate", busy: "Busy", veryBusy: "Very busy" },
    weekday: "Weekday baseline",
    weekend: "Weekend",
    weekendUplift: "+1 crowd level vs weekday",
    peakTime: "peak-time uplift",
    crowdEstimate: "planning estimate",
    crowdBasis: "Crowd outlook is a transparent planning heuristic, not a live queue. Weekends are shown one level busier than the same time on a weekday.",
  },
  ja: {
    input: "食事の提案",
    inputHint: "食事は旅程に固定せず、立ち寄りやすい候補だけを出します。",
    all: "旅程に合わせて提案",
    dinner: "夕食だけ提案",
    none: "食事の提案は表示しない",
    briefEyebrow: "旅のまとめ",
    briefTitle: "先に押さえる予定だけ、ひと目で。",
    briefBody: "旅程を左右する予約と、場所を特定できなかった候補をまとめました。食事は当日の気分で選べるよう、別に提案します。",
    reservations: "固定した予約",
    mealBreaks: "確保した食事枠",
    toDecide: "あとで決めること",
    noReservations: "固定予約はまだありません",
    noMeals: "食事枠は自動追加していません",
    nothingOpen: "未確定の場所はありません",
    lunch: "昼食",
    dinnerLabel: "夕食",
    chooseRestaurantLater: "店はあとで選択",
    userLocation: "ユーザー入力 · 場所はエリア単位の概算",
    protectedTime: "旅程に時間を確保",
    localPause: "このエリアで食事 — 街をまたぐ移動は追加しません",
    crowd: "混雑目安",
    crowdLevels: { quiet: "空きやすい", moderate: "ふつう", busy: "混みやすい", veryBusy: "かなり混みやすい" },
    weekday: "平日基準",
    weekend: "土日",
    weekendUplift: "平日より1段階混雑",
    peakTime: "ピーク時間を加味",
    crowdEstimate: "計画用の予測",
    crowdBasis: "混雑目安はライブの待ち時間ではなく、計画用の簡易予測です。同じ時間帯の平日と比べ、土日は1段階混む前提で表示します。",
  },
  ko: {
    input: "일정에 식사 넣기",
    inputHint: "식당은 나중에 고르고 식사 시간부터 확보합니다.",
    all: "점심 + 저녁",
    dinner: "저녁만",
    none: "자동 추가 안 함",
    briefEyebrow: "여행 요약",
    briefTitle: "정한 것, 보호한 것, 아직 남은 것.",
    briefBody: "예약, 식사 시간과 미확인 장소를 상세 경로 앞에서 한 번에 봅니다.",
    reservations: "고정 예약",
    mealBreaks: "식사 시간",
    toDecide: "나중에 결정",
    noReservations: "고정 예약이 없습니다",
    noMeals: "자동 식사 시간이 없습니다",
    nothingOpen: "미확인 장소가 없습니다",
    lunch: "점심",
    dinnerLabel: "저녁",
    chooseRestaurantLater: "식당은 나중에 선택",
    userLocation: "사용자 입력 · 위치는 지역 단위 추정",
    protectedTime: "일정에 시간 확보",
    localPause: "이 지역에서 식사 — 도시를 가로지르는 이동 없음",
    crowd: "혼잡 예상",
    crowdLevels: { quiet: "여유", moderate: "보통", busy: "혼잡", veryBusy: "매우 혼잡" },
    weekday: "평일 기준",
    weekend: "주말",
    weekendUplift: "평일보다 1단계 혼잡",
    peakTime: "피크 시간 반영",
    crowdEstimate: "계획 추정치",
    crowdBasis: "혼잡 예상은 실시간 대기 시간이 아닌 계획용 휴리스틱입니다. 같은 시간대의 평일보다 주말을 한 단계 더 혼잡하게 표시합니다.",
  },
  zh: {
    input: "把用餐加入路线",
    inputHint: "餐厅以后再选，先把用餐时间留出来。",
    all: "午餐＋晚餐",
    dinner: "只加晚餐",
    none: "不自动添加",
    briefEyebrow: "行程摘要",
    briefTitle: "已决定、已保护、仍待选择。",
    briefBody: "在详细路线前集中查看预约、用餐时段和未确认地点。",
    reservations: "固定预约",
    mealBreaks: "用餐时段",
    toDecide: "稍后决定",
    noReservations: "暂无固定预约",
    noMeals: "未自动添加用餐",
    nothingOpen: "没有未确认地点",
    lunch: "午餐",
    dinnerLabel: "晚餐",
    chooseRestaurantLater: "餐厅稍后选择",
    userLocation: "用户输入 · 位置仅按区域估算",
    protectedTime: "已在行程中留出时间",
    localPause: "在此区域用餐，不增加跨城移动",
    crowd: "拥挤预估",
    crowdLevels: { quiet: "较空", moderate: "一般", busy: "拥挤", veryBusy: "非常拥挤" },
    weekday: "工作日基准",
    weekend: "周末",
    weekendUplift: "比工作日高1级",
    peakTime: "计入高峰时段",
    crowdEstimate: "规划估算",
    crowdBasis: "拥挤预估是规划用启发式判断，不是实时排队时间。同一时段下，周末会比工作日显示高一个拥挤等级。",
  },
};

const foodCopy = {
  en: {
    eyebrow: "Food along the way",
    title: "What do you feel like eating?",
    body: "Tap a food mood. We will show a few places near the route—not lock one into your day.",
    lunch: "Lunch idea",
    dinner: "Dinner idea",
    near: "Easy area",
    window: "Flexible window",
    routeFit: "Why here",
    search: "Find nearby places",
    loading: "Looking nearby…",
    ready: "Nearby options from Google Maps",
    notConfigured: "Live place search is not connected yet. You can still open the same search in Google Maps, Tabelog or X.",
    unavailable: "The live search did not respond. Use the search links below instead.",
    noResults: "No exact matches came back. Try another food style or open the broader searches.",
    chooseStyle: "Tap what looks good",
    routeLabel: "That day's route",
    google: "Maps",
    tabelog: "Tabelog",
    x: "X posts",
    fallback: "Search outside TripCheck",
    sourceNote: "Restaurant names come from a fresh Google Maps search. Tabelog and X are outbound cross-check links; TripCheck does not scrape or combine their rankings.",
    privacy: "Only this area's coordinates, meal type, language and selected search phrase are sent—never the itinerary text.",
  },
  ja: {
    eyebrow: "旅程のついでに、ごはん探し",
    title: "今日は、何食べる？",
    body: "写真で気分を選ぶだけ。旅のルート近くにある店を、数件だけ見つけます。",
    lunch: "昼ごはん候補",
    dinner: "夜ごはん候補",
    near: "寄りやすいエリア",
    window: "探しやすい時間帯",
    routeFit: "ここを勧める理由",
    search: "この近くのお店を見る",
    loading: "近くのお店を探しています…",
    ready: "Google Mapsで見つかった候補",
    notConfigured: "現在、店名の自動取得は準備中です。同じ条件でGoogle Maps・食べログ・Xを開けます。",
    unavailable: "店名を取得できませんでした。下のリンクから同じ条件で探せます。",
    noResults: "ぴったりの店が見つかりませんでした。食べたいものを変えるか、検索先を直接開いてみてください。",
    chooseStyle: "おいしそう、をタップ",
    routeLabel: "この日の流れ",
    google: "地図",
    tabelog: "食べログ",
    x: "Xの投稿",
    fallback: "ほかのサービスでも探す",
    sourceNote: "店名はGoogle Mapsでその都度検索します。食べログとXは確認用リンクで、TripCheckが口コミや順位を取得・合算しているわけではありません。",
    privacy: "送るのはエリアの座標、昼夜の区分、言語、選んだ検索語だけ。旅程本文は送りません。",
  },
} as const;

const visualCopy = {
  en: {
    routeMap: "Route map",
    routeHint: "Follow the numbers",
    stops: "stops",
    foodImage: "Food mood image",
    foodImageNote: "Images show the food mood, not a photo of the restaurant.",
    recommended: "Best balance",
    openRoute: "Open the full route",
  },
  ja: {
    routeMap: "旅程マップ",
    routeHint: "数字の順に進むだけ",
    stops: "スポット",
    foodImage: "料理イメージ",
    foodImageNote: "料理写真は気分選び用のイメージです。各店舗の写真ではありません。",
    recommended: "おすすめ",
    openRoute: "大きな地図で見る",
  },
} as const;

const liveRouteCopy: Record<Locale, {
  eyebrow: string;
  title: string;
  body: string;
  button: string;
  loading: string;
  ready: string;
  missingDate: string;
  notConfigured: string;
  outOfRange: string;
  unavailable: string;
  live: string;
  disclosure: string;
  privacy: string;
}> = {
  en: {
    eyebrow: "Live transit",
    title: "Replace the biggest guess.",
    body: "Fetch scheduled public-transport time for the route as currently planned. Walking and taxi remain planning estimates.",
    button: "Update train times",
    loading: "Checking current routes…",
    ready: "Train times updated",
    missingDate: "Add the first day of your Tokyo trip to check scheduled transit.",
    notConfigured: "The live Google Routes connection is ready in the product but still needs its private service key.",
    outOfRange: "Google provides scheduled transit from 7 days ago through 100 days ahead. Choose a date inside that window.",
    unavailable: "Live transit could not be reached. The plan is still using its visible estimates.",
    live: "Live route",
    disclosure: "Public-transport minutes marked Live route come from a fresh Google Maps request for the shown date and time. They are not stored. Walking and taxi remain planning estimates; always verify disruptions in Google Maps before departure.",
    privacy: "Only the coordinate pairs and planned departure times are sent when you choose this update—never the pasted notes.",
  },
  ja: {
    eyebrow: "電車の時間を最新情報に",
    title: "旅程の日付に合わせて、乗車時間を確認。",
    body: "表示中の日付と出発時刻で、公共交通の所要時間を調べ直します。徒歩とタクシーは計画用の目安です。",
    button: "電車時間を更新",
    loading: "現在の経路を確認中…",
    ready: "電車時間を更新しました",
    missingDate: "時刻表に合わせるには、東京旅行の初日を入力してください。",
    notConfigured: "電車時間の自動取得は現在準備中です。表示中のGoogle Mapsリンクから経路を確認できます。",
    outOfRange: "Googleの交通日時指定は7日前から100日先までです。この範囲内の日付を選んでください。",
    unavailable: "ライブ交通へ接続できませんでした。旅程は表示中の概算をそのまま使っています。",
    live: "ライブ経路",
    disclosure: "「ライブ経路」の電車時間は、表示日時に対するGoogle Mapsの新規取得結果です。結果は保存しません。徒歩とタクシーは計画用概算のため、出発前にGoogle Mapsで運休等を確認してください。",
    privacy: "更新を押したときだけ、地点間の座標と出発予定時刻を送ります。貼り付けた文章は送りません。",
  },
  ko: {
    eyebrow: "실시간 교통",
    title: "가장 큰 추정치를 실제 데이터로.",
    body: "현재 일정 날짜와 시간에 맞춘 대중교통 소요 시간을 가져옵니다. 도보와 택시는 계속 계획 추정치입니다.",
    button: "전철 시간 업데이트",
    loading: "현재 경로 확인 중…",
    ready: "전철 시간을 업데이트했습니다",
    missingDate: "운행 일정 확인을 위해 도쿄 여행 첫날을 입력하세요.",
    notConfigured: "Google Routes 연결 기능은 준비됐지만 비공개 서비스 키 설정이 아직 필요합니다.",
    outOfRange: "Google 대중교통 시간 지정은 7일 전부터 100일 후까지 가능합니다.",
    unavailable: "실시간 교통에 연결하지 못했습니다. 현재 표시된 추정치를 계속 사용합니다.",
    live: "실시간 경로",
    disclosure: "실시간 경로로 표시된 전철 시간은 해당 날짜와 시간에 새로 요청한 Google Maps 결과이며 저장하지 않습니다. 도보와 택시는 계획 추정치이므로 출발 전 Google Maps에서 운행 상태를 확인하세요.",
    privacy: "업데이트를 선택할 때 장소 좌표 쌍과 예정 출발 시간만 보내며 붙여 넣은 메모는 보내지 않습니다.",
  },
  zh: {
    eyebrow: "实时交通",
    title: "把最大的估算换成真实数据。",
    body: "按当前行程日期和时间获取公共交通所需时间，步行与出租车仍为规划估算。",
    button: "更新电车时间",
    loading: "正在查询当前路线…",
    ready: "电车时间已更新",
    missingDate: "请输入东京旅行第一天，以便查询对应时刻表。",
    notConfigured: "Google Routes连接功能已经完成，但仍需设置私密服务密钥。",
    outOfRange: "Google支持查询过去7天至未来100天内的公共交通时间。",
    unavailable: "无法连接实时交通，行程仍使用当前明确标注的估算值。",
    live: "实时路线",
    disclosure: "标有“实时路线”的电车时间来自针对所示日期时间新请求的Google Maps结果，且不会保存。步行与出租车仍为规划估算，出发前请在Google Maps确认停运等信息。",
    privacy: "仅在你主动更新时发送地点坐标和计划出发时间，不会发送粘贴的文字内容。",
  },
};

function formatDuration(minutes: number, locale: Locale) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return locale === "ja" ? `${remainder}分` : locale === "ko" ? `${remainder}분` : locale === "zh" ? `${remainder}分钟` : `${remainder}m`;
  if (remainder === 0) return locale === "ja" ? `${hours}時間` : locale === "ko" ? `${hours}시간` : locale === "zh" ? `${hours}小时` : `${hours}h`;
  return locale === "ja" ? `${hours}時間${remainder}分` : locale === "ko" ? `${hours}시간 ${remainder}분` : locale === "zh" ? `${hours}小时${remainder}分钟` : `${hours}h ${remainder}m`;
}

function formatDayCount(days: number, locale: Locale) {
  if (locale === "ja") return `${days}日`;
  if (locale === "ko") return `${days}일`;
  if (locale === "zh") return `${days}天`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function IssueMark({ kind }: { kind: Severity }) {
  return (
    <span className={`issue-glyph ${kind}`} aria-hidden="true">
      {kind === "note" ? "i" : "!"}
    </span>
  );
}

function CrowdBadge({ outlook, text }: { outlook: CrowdOutlook; text: (typeof mealCopy)[Locale] }) {
  const drivers = [
    outlook.isWeekend ? `${text.weekend} · ${text.weekendUplift}` : text.weekday,
    outlook.peakTime ? text.peakTime : null,
  ].filter(Boolean).join(" · ");
  return (
    <span className={`crowd-badge level-${outlook.level}`} title={`${text.crowdEstimate} · ${drivers}`}>
      <i aria-hidden="true" />
      <b>{text.crowd}: {text.crowdLevels[outlook.level]}</b>
      <small>{outlook.isWeekend ? text.weekend : text.weekday}</small>
    </span>
  );
}

function modeGlyph(mode: string) {
  if (mode === "walk") return "🚶";
  if (mode === "taxi") return "🚕";
  return "🚆";
}

function foodMoodPosition(query: string, fallbackIndex = 0) {
  const normalized = query.toLowerCase();
  if (/sushi|seafood|market|寿司|海鮮|市場/.test(normalized)) return "14% 24%";
  if (/ramen|ラーメン|라멘|拉面/.test(normalized)) return "50% 20%";
  if (/yakitori|izakaya|焼き鳥|居酒屋|이자카야|烤鸡串/.test(normalized)) return "84% 23%";
  if (/tempura|soba|天ぷら|そば|덴푸라|소바|天妇罗|荞麦/.test(normalized)) return "15% 82%";
  if (/café|cafe|kissaten|coffee|カフェ|喫茶|甘味|咖啡/.test(normalized)) return "84% 82%";
  if (/set meal|teishoku|定食|和食|일식|日料|tonkatsu|とんかつ/.test(normalized)) return "52% 82%";
  return ["14% 24%", "50% 20%", "84% 23%", "52% 82%", "84% 82%"][fallbackIndex % 5];
}

function DayRouteMap({ day, locale }: { day: BuiltPlanDay; locale: Locale }) {
  const text = visualCopy[locale === "ja" ? "ja" : "en"];
  const points = buildRouteSketchPoints(day.stops.map(({ stop }) => stop));

  return (
    <section className="day-route-map" aria-label={`${day.label} · ${text.routeMap}`}>
      <header>
        <div><span>{text.routeMap}</span><b>{text.routeHint}</b></div>
        <p><strong>{String(points.length).padStart(2, "0")}</strong>{text.stops}</p>
      </header>
      <p className="sr-only">{day.stops.map(({ stop }, index) => `${index + 1}. ${stop.name}`).join(" → ")}</p>
      <div className="route-map-canvas" aria-hidden="true">
        {points.slice(0, -1).map((point, index) => {
          const line = routeSketchLine(point, points[index + 1]);
          const leg = day.legs[index];
          const recommended = leg?.comparison.recommended;
          return (
            <span className="route-map-connection" key={`${point.id}-${points[index + 1].id}`}>
              <i
                className="route-map-line"
                style={{
                  left: `${line.left}%`,
                  top: `${line.top}%`,
                  width: `${line.width}%`,
                  transform: `rotate(${line.angle}deg)`,
                }}
              />
              {recommended ? (
                <em className="route-map-travel" style={{ left: `${line.labelX}%`, top: `${line.labelY}%` }}>
                  <span>{leg.isLocalMealPause ? "🍽️" : modeGlyph(recommended.mode)}</span>
                  <b>{formatDuration(recommended.minutes, locale)}</b>
                </em>
              ) : null}
            </span>
          );
        })}
        {points.map((point, index) => {
          const scheduled = day.stops[index];
          return (
            <span
              className={`route-map-node ${scheduled.kind === "meal" ? "is-meal" : ""}`}
              key={point.id}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <i>{scheduled.kind === "meal" ? "🍽" : index + 1}</i>
              <b>{point.name}</b>
              <small>{point.area}</small>
            </span>
          );
        })}
      </div>
      {day.googleMapsUrl ? (
        <a className="route-map-open" href={day.googleMapsUrl} target="_blank" rel="noreferrer">
          <span aria-hidden="true">⌖</span>{text.openRoute}<b aria-hidden="true">↗</b>
        </a>
      ) : null}
    </section>
  );
}

function Brand() {
  return (
    <span className="brand-lockup">
      <span className="route-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>TRIPCHECK</span>
      <small>JAPAN</small>
    </span>
  );
}

export default function TripCheckApp({ initialLocale = "en" }: { initialLocale?: Locale }) {
  const appRef = useRef<HTMLElement>(null);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [itinerary, setItinerary] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [tripDays, setTripDays] = useState(2);
  const [tripStartDate, setTripStartDate] = useState("");
  const [hotelQuery, setHotelQuery] = useState("");
  const [arrivalAirport, setArrivalAirport] = useState<AirportCode>("none");
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureAirport, setDepartureAirport] = useState<AirportCode>("none");
  const [departureTime, setDepartureTime] = useState("");
  const [flightKind, setFlightKind] = useState<FlightKind>("international");
  const [mealPlan, setMealPlan] = useState<MealPlan>("all");
  const [mockMode, setMockMode] = useState(false);
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [liveTransitMinutes, setLiveTransitMinutes] = useState<Record<string, number>>({});
  const [liveRouteSignature, setLiveRouteSignature] = useState("");
  const [liveRouteStatus, setLiveRouteStatus] = useState<LiveRouteStatus>("idle");
  const [liveFetchedAt, setLiveFetchedAt] = useState("");
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodSearchState>>({});
  const [foodSearchSignature, setFoodSearchSignature] = useState("");
  const [hasChecked, setHasChecked] = useState(false);
  const [navCompact, setNavCompact] = useState(false);
  const t = copy[locale];
  const answers = answerCopy[locale];
  const routeText = routeCopy[locale];
  const timeText = timeCopy[locale];
  const planText = planCopy[locale];
  const details = contextCopy[locale];
  const demo = demoCopy[locale];
  const constraints = constraintCopy[locale];
  const editing = editingCopy[locale];
  const meals = mealCopy[locale];
  const food = foodCopy[locale === "ja" ? "ja" : "en"];
  const visual = visualCopy[locale === "ja" ? "ja" : "en"];
  const liveRoute = liveRouteCopy[locale];
  const planningSignature = useMemo(() => JSON.stringify({
    itinerary,
    pace,
    tripDays,
    tripStartDate,
    hotelQuery,
    arrivalAirport,
    arrivalTime,
    departureAirport,
    departureTime,
    flightKind,
    mealPlan,
    dayStartTimes,
    durationOverrides,
    locale,
  }), [arrivalAirport, arrivalTime, dayStartTimes, departureAirport, departureTime, durationOverrides, flightKind, hotelQuery, itinerary, locale, mealPlan, pace, tripDays, tripStartDate]);
  const activeLiveTransitMinutes = liveRouteSignature === planningSignature ? liveTransitMinutes : emptyLiveTransitMinutes;
  const activeLiveRouteStatus = liveRouteSignature === planningSignature ? liveRouteStatus : "idle";

  const analysis = useMemo(
    () => (hasChecked ? analyzeTrip(itinerary, pace, locale, tripDays, {
      hotelQuery,
      tripStartDate,
      arrivalAirport,
      arrivalTime,
      departureAirport,
      departureTime,
      flightKind,
      mealPlan,
      dayStartTimes,
      durationOverrides,
      liveTransitMinutes: activeLiveTransitMinutes,
    }) : null),
    [activeLiveTransitMinutes, arrivalAirport, arrivalTime, dayStartTimes, departureAirport, departureTime, durationOverrides, flightKind, hasChecked, hotelQuery, itinerary, locale, mealPlan, pace, tripDays, tripStartDate],
  );
  const mockHotels = useMemo(
    () => {
      if (!analysis || analysis.inputMode !== "wishlist") return [];
      const ids = [
        ...(analysis.plan.selectedBase ? [analysis.plan.selectedBase.id] : []),
        ...analysis.plan.baseRecommendations.map((recommendation) => recommendation.base.id),
      ];
      return getMockHotels(locale, [...new Set(ids)].slice(0, 3));
    },
    [analysis, locale],
  );
  const fixedReservations = analysis?.inputMode === "wishlist"
    ? analysis.plan.days.flatMap((day) => day.stops.flatMap((stop) => stop.fixedTime ? [{ day: day.label, stop }] : []))
    : [];
  const foodSlots = analysis?.inputMode === "wishlist"
    ? analysis.plan.foodRecommendationSlots
    : [];

  const characterCount = itinerary.length;
  const canCheck = itinerary.trim().length >= 3;
  const hasTimingEdits = Object.keys(dayStartTimes).length > 0 || Object.keys(durationOverrides).length > 0;
  const hasLiveTransit = Object.keys(activeLiveTransitMinutes).length > 0;
  const canRequestLiveTransit = Boolean(
    tripStartDate
    && analysis?.inputMode === "wishlist"
    && analysis.plan.days.some((day) => day.legs.some((leg) => !leg.isLocalMealPause)),
  );
  const liveStatusMessage = !tripStartDate
    ? liveRoute.missingDate
    : activeLiveRouteStatus === "loading" ? liveRoute.loading
      : activeLiveRouteStatus === "ready" ? `${liveRoute.ready}${liveFetchedAt ? ` · ${new Date(liveFetchedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}` : ""}`
        : activeLiveRouteStatus === "notConfigured" ? liveRoute.notConfigured
          : activeLiveRouteStatus === "outOfRange" ? liveRoute.outOfRange
            : activeLiveRouteStatus === "unavailable" ? liveRoute.unavailable
              : "";

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
    try {
      window.localStorage.setItem("tripcheck-locale", locale);
    } catch {
      // The interface still works without storage.
    }
  }, [locale]);

  useEffect(() => {
    const root = appRef.current;
    if (!root) return;
    let cancelled = false;
    let context: { revert: () => void } | null = null;
    document.documentElement.classList.add("motion-ready");
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([gsapModule, triggerModule]) => {
      if (cancelled) return;
      const gsap = gsapModule.gsap;
      const ScrollTrigger = triggerModule.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      context = gsap.context(() => {
        root.querySelectorAll<HTMLElement>(".reveal").forEach((node) => {
          gsap.fromTo(node, {
            autoAlpha: 0,
            clipPath: "inset(0 0 108% 0)",
            y: 44,
          }, {
            autoAlpha: 1,
            clipPath: "inset(0 0 0% 0)",
            ease: "none",
            scrollTrigger: {
              end: "top 68%",
              scrub: 1,
              start: "top 92%",
              trigger: node,
            },
            y: 0,
          });
        });
        window.requestAnimationFrame(() => ScrollTrigger.refresh());
      }, root);
    });
    return () => {
      cancelled = true;
      context?.revert();
      document.documentElement.classList.remove("motion-ready");
    };
  }, [hasChecked]);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      setNavCompact(window.scrollY > 24);
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    try {
      window.localStorage.setItem("tripcheck-locale", nextLocale);
    } catch {
      // Language persistence is optional.
    }
    const nextPath = nextLocale === "en" ? "/" : `/${nextLocale}`;
    window.history.replaceState({}, "", `${nextPath}${window.location.hash}`);
  }

  function loadSample() {
    setItinerary(t.sample);
    setTripStartDate("");
    setHotelQuery("");
    setArrivalAirport("none");
    setArrivalTime("");
    setDepartureAirport("none");
    setDepartureTime("");
    setMealPlan("all");
    setDayStartTimes({});
    setDurationOverrides({});
    setMockMode(false);
    setHasChecked(false);
    window.setTimeout(() => document.getElementById("trip-input")?.focus(), 30);
  }

  function scrollToResult() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById("analysis-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function loadFullDemo() {
    setItinerary(fullTripDemo.places[locale]);
    setTripDays(fullTripDemo.tripDays);
    setTripStartDate(fullTripDemo.tripStartDate);
    setPace(fullTripDemo.pace);
    setHotelQuery(fullTripDemo.hotelQuery[locale]);
    setArrivalAirport(fullTripDemo.arrivalAirport);
    setArrivalTime(fullTripDemo.arrivalTime);
    setDepartureAirport(fullTripDemo.departureAirport);
    setDepartureTime(fullTripDemo.departureTime);
    setFlightKind(fullTripDemo.flightKind);
    setMealPlan("all");
    setDayStartTimes({});
    setDurationOverrides({});
    setMockMode(true);
    setHasChecked(true);
    window.setTimeout(scrollToResult, 30);
  }

  function runCheck() {
    if (!canCheck) return;
    setHasChecked(true);
    scrollToResult();
  }

  function updateDayStart(dayIndex: number, value: string) {
    setDayStartTimes((current) => ({ ...current, [dayIndex]: value }));
  }

  function updateDuration(stopId: string, minutes: number) {
    setDurationOverrides((current) => ({ ...current, [stopId]: minutes }));
  }

  function resetTiming() {
    setDayStartTimes({});
    setDurationOverrides({});
  }

  async function updateLiveRoutes() {
    if (!analysis || analysis.inputMode !== "wishlist") return;
    if (!tripStartDate) {
      setLiveRouteStatus("missingDate");
      return;
    }
    const requestSignature = planningSignature;
    setLiveRouteSignature(requestSignature);
    setLiveTransitMinutes({});
    setLiveRouteStatus("loading");
    try {
      const response = await requestLiveTransit(analysis.plan, locale);
      const updates = Object.fromEntries(response.legs.flatMap((leg) => (
        leg.status === "ok" && leg.durationMinutes !== null ? [[leg.id, leg.durationMinutes]] : []
      )));
      if (Object.keys(updates).length === 0) {
        setLiveRouteStatus("unavailable");
        return;
      }
      setLiveTransitMinutes(updates);
      setLiveFetchedAt(response.fetchedAt);
      setLiveRouteStatus("ready");
    } catch (error) {
      if (error instanceof LiveRoutesError) {
        if (error.code === "not_configured") setLiveRouteStatus("notConfigured");
        else if (error.code === "invalid_or_out_of_range") setLiveRouteStatus("outOfRange");
        else if (error.code === "missing_date") setLiveRouteStatus("missingDate");
        else setLiveRouteStatus("unavailable");
      } else {
        setLiveRouteStatus("unavailable");
      }
    }
  }

  async function searchFood(slot: FoodRecommendationSlot, query: string) {
    if (foodSearchSignature !== planningSignature) {
      setFoodSearches({});
      setFoodSearchSignature(planningSignature);
    }
    setFoodSearches((current) => ({
      ...current,
      [slot.id]: { status: "loading", query, fetchedAt: "", candidates: [] },
    }));
    try {
      const response = await requestFoodRecommendations(slot, query, locale);
      setFoodSearches((current) => ({
        ...current,
        [slot.id]: {
          status: "ready",
          query,
          fetchedAt: response.fetchedAt,
          candidates: response.candidates,
        },
      }));
    } catch (error) {
      const status = error instanceof FoodRecommendationsError && error.code === "not_configured"
        ? "notConfigured"
        : "unavailable";
      setFoodSearches((current) => ({
        ...current,
        [slot.id]: { status, query, fetchedAt: "", candidates: [] },
      }));
    }
  }

  return (
    <main className="experience" data-locale={locale} lang={locale === "zh" ? "zh-CN" : locale} ref={appRef}>
      <header className={`global-nav ${navCompact ? "is-compact" : ""}`}>
        <a href="#top" aria-label="TripCheck Japan home"><Brand /></a>
        <nav aria-label="Main navigation">
          <a href="#method">{t.nav.method}</a>
          <a href="#trust">{t.nav.trust}</a>
        </nav>
        <label className="locale-switcher">
          <span className="sr-only">{t.languageLabel}</span>
          <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)} aria-label={t.languageLabel}>
            {localeOrder.map((option) => <option value={option} key={option}>{localeLabels[option]}</option>)}
          </select>
        </label>
      </header>

      <CinematicJourney locale={locale} t={t} />

      <section className="checker-section" id="checker">
        <header className="checker-heading">
          <p className="section-eyebrow reveal">04 / {t.checker.eyebrow}</p>
          <h2 className="reveal">{t.checker.title}</h2>
          <p className="reveal">{t.checker.body}</p>
        </header>

        <div className="checker-workbench reveal">
          <div className="workbench-bar">
            <span>TRIPCHECK / TOKYO / 001</span>
            <div className="workbench-demo-actions">
              <button onClick={loadSample} type="button">{t.checker.sample}<b aria-hidden="true">↗</b></button>
              <button className="full-demo-button" onClick={loadFullDemo} type="button">{demo.fullDemo}<b aria-hidden="true">→</b></button>
            </div>
          </div>
          <label className="itinerary-input" htmlFor="trip-input">
            <span className="input-index" aria-hidden="true">A</span>
            <span className="sr-only">{t.checker.inputLabel}</span>
            <textarea
              id="trip-input"
              value={itinerary}
              onChange={(event) => { setItinerary(event.target.value); setHasChecked(false); }}
              placeholder={t.checker.placeholder}
              rows={12}
              maxLength={8000}
            />
            <span className="character-count">{characterCount.toLocaleString(locale)} / 8,000</span>
          </label>
          <aside className="constraint-guide" aria-label={constraints.guideTitle}>
            <div><b>{constraints.guideTitle}</b><span>{constraints.guideBody}</span></div>
            <code>{constraints.example}</code>
            <div className="constraint-key" aria-hidden="true">
              <span className="is-must">{constraints.must}</span>
              <span className="is-reserved">{constraints.reserved}</span>
              <span className="is-optional">{constraints.optional}</span>
            </div>
          </aside>
          <section className="trip-context-panel" aria-labelledby="trip-context-title">
            <header>
              <p>{details.eyebrow}</p>
              <div><h3 id="trip-context-title">{details.title}</h3><span>{details.body}</span></div>
            </header>
            <div className="trip-context-grid">
              <label className="context-hotel-field">
                <span>{details.hotel}</span>
                <input
                  type="text"
                  value={hotelQuery}
                  onChange={(event) => { setHotelQuery(event.target.value); setHasChecked(false); }}
                  placeholder={details.hotelPlaceholder}
                  autoComplete="organization"
                />
              </label>
              <label>
                <span>{details.tripStart}</span>
                <input
                  type="date"
                  value={tripStartDate}
                  onChange={(event) => { setTripStartDate(event.target.value); setHasChecked(false); }}
                />
              </label>
              <label className="context-meal-field">
                <span>{meals.input}</span>
                <select value={mealPlan} onChange={(event) => { setMealPlan(event.target.value as MealPlan); setHasChecked(false); }}>
                  <option value="all">{meals.all}</option>
                  <option value="dinner">{meals.dinner}</option>
                  <option value="none">{meals.none}</option>
                </select>
                <small>{meals.inputHint}</small>
              </label>
              <label>
                <span>{details.flightKind}</span>
                <select value={flightKind} onChange={(event) => { setFlightKind(event.target.value as FlightKind); setHasChecked(false); }}>
                  <option value="international">{details.international}</option>
                  <option value="domestic">{details.domestic}</option>
                </select>
              </label>
              <label>
                <span>{details.arrival}</span>
                <select value={arrivalAirport} onChange={(event) => { setArrivalAirport(event.target.value as AirportCode); setHasChecked(false); }}>
                  <option value="none">{details.none}</option>
                  <option value="HND">HND · Haneda</option>
                  <option value="NRT">NRT · Narita</option>
                </select>
              </label>
              <label>
                <span>{details.flightTime}</span>
                <input aria-label={`${details.arrival} ${details.flightTime}`} disabled={arrivalAirport === "none"} type="time" value={arrivalTime} onChange={(event) => { setArrivalTime(event.target.value); setHasChecked(false); }} />
              </label>
              <label>
                <span>{details.departure}</span>
                <select value={departureAirport} onChange={(event) => { setDepartureAirport(event.target.value as AirportCode); setHasChecked(false); }}>
                  <option value="none">{details.none}</option>
                  <option value="HND">HND · Haneda</option>
                  <option value="NRT">NRT · Narita</option>
                </select>
              </label>
              <label>
                <span>{details.flightTime}</span>
                <input aria-label={`${details.departure} ${details.flightTime}`} disabled={departureAirport === "none"} type="time" value={departureTime} onChange={(event) => { setDepartureTime(event.target.value); setHasChecked(false); }} />
              </label>
            </div>
          </section>
          <div className="workbench-controls">
            <label className="select-field">
              <span>{t.checker.tripDays}</span>
              <select value={tripDays} onChange={(event) => { setTripDays(Number(event.target.value)); setHasChecked(false); }}>
                {Array.from({ length: 14 }, (_, index) => index + 1).map((days) => <option value={days} key={days}>{formatDayCount(days, locale)}</option>)}
              </select>
            </label>
            <fieldset className="pace-field">
              <legend>{t.checker.pace}</legend>
              <div>
                {(["relaxed", "balanced", "fast"] as Pace[]).map((option) => (
                  <button className={pace === option ? "active" : ""} key={option} onClick={() => setPace(option)} type="button">{t.pace[option]}</button>
                ))}
              </div>
            </fieldset>
            <button className="check-button" disabled={!canCheck} onClick={runCheck} type="button">
              <span>{t.checker.button}</span><b aria-hidden="true">→</b>
            </button>
          </div>
          <p className="prototype-note"><b>{t.checker.prototype}</b>{t.checker.prototypeBody}</p>
        </div>
      </section>

      {analysis ? (
        <section className="results-section" id="analysis-result" aria-live="polite">
          <div className="result-head reveal">
            <div className={analysis.inputMode === "wishlist" ? "plan-days-count" : `reality-score ${analysis.score < 60 ? "is-low" : ""}`}>
              <span>{analysis.inputMode === "wishlist" ? analysis.plan.days.length : analysis.score}</span>
              <small>{analysis.inputMode === "wishlist" ? planText.daysBuilt : t.result.score}</small>
            </div>
            <div>
              <p className="section-eyebrow">{analysis.inputMode === "wishlist" ? planText.eyebrow : t.result.eyebrow} · {t.pace[pace]}</p>
              <h2>{analysis.inputMode === "wishlist" ? planText.title : analysis.headline}</h2>
              <p>{analysis.inputMode === "wishlist" ? planText.body : analysis.subhead}</p>
            </div>
          </div>
          <div className={`result-stats reveal ${analysis.inputMode === "wishlist" ? "wishlist-stats" : ""}`}>
            {analysis.inputMode === "wishlist" ? (
              <>
                <div><strong>{analysis.plan.scheduledStopCount}</strong><span>{planText.placed}</span></div>
                <div><strong>{analysis.plan.unknownEntries.length}</strong><span>{planText.unresolved}</span></div>
                <div><strong>{analysis.plan.overCapacityCount + analysis.plan.scheduleConflictCount}</strong><span>{planText.overflow}</span></div>
                <div><strong>{analysis.plan.constraintCount}</strong><span>{constraints.protected}</span></div>
              </>
            ) : (
              <>
                <div><strong>{analysis.criticalCount}</strong><span>{t.result.critical}</span></div>
                <div><strong>{analysis.warningCount}</strong><span>{t.result.warning}</span></div>
                <div><strong>{analysis.hiddenTransit}</strong><span>{t.result.transit}</span></div>
              </>
            )}
          </div>
          {analysis.inputMode === "wishlist" ? (
            <section className="wishlist-plan reveal" aria-labelledby="wishlist-plan-title">
              <header className="wishlist-plan-heading">
                <div>
                  <p className="section-eyebrow">{planText.eyebrow}</p>
                  <h3 id="wishlist-plan-title">{planText.detailTitle}</h3>
                  <p>{planText.body}</p>
                </div>
                <span className="engine-badge">{planText.engine}</span>
              </header>
              <section className="trip-brief" aria-labelledby="trip-brief-title">
                <header>
                  <p className="section-eyebrow">{meals.briefEyebrow}</p>
                  <div><h4 id="trip-brief-title">{meals.briefTitle}</h4><span>{meals.briefBody}</span></div>
                </header>
                <div className="trip-brief-grid">
                  <article>
                    <h5><span>{String(fixedReservations.length).padStart(2, "0")}</span>{meals.reservations}</h5>
                    {fixedReservations.length > 0 ? <ul>{fixedReservations.map(({ day, stop }) => (
                      <li key={`${day}-${stop.stop.id}`}><b>{day} · {stop.fixedTime}</b><span>{stop.stop.name}</span>{stop.stop.isUserEntered ? <small>{meals.userLocation}</small> : null}</li>
                    ))}</ul> : <p>{meals.noReservations}</p>}
                  </article>
                  <article>
                    <h5><span>{String(analysis.plan.unknownEntries.length).padStart(2, "0")}</span>{meals.toDecide}</h5>
                    {analysis.plan.unknownEntries.length > 0 ? <ul>{analysis.plan.unknownEntries.map((entry) => <li key={entry}><span>{entry}</span></li>)}</ul> : <p>{meals.nothingOpen}</p>}
                  </article>
                </div>
                {tripStartDate ? <p className="crowd-basis"><span aria-hidden="true">◌</span>{meals.crowdBasis}</p> : null}
              </section>
              {foodSlots.length > 0 ? (
                <section className="food-recommendations" id="food-recommendations" aria-labelledby="food-recommendations-title">
                  <header>
                    <div className="food-hero-copy">
                      <p className="section-eyebrow">FOOD / {food.eyebrow}</p>
                      <h4 id="food-recommendations-title">{food.title}</h4>
                      <p>{food.body}</p>
                    </div>
                    <div className="food-hero-image" role="img" aria-label={visual.foodImage}>
                      <span>{visual.foodImage}</span>
                    </div>
                  </header>
                  <div className="food-slot-list">
                    {foodSlots.map((slot) => {
                      const search: FoodSearchState = (foodSearchSignature === planningSignature ? foodSearches[slot.id] : undefined)
                        ?? { status: "idle", query: slot.queryIdeas[0], fetchedAt: "", candidates: [] };
                      const day = analysis.plan.days[slot.dayIndex];
                      const broadLinks = foodSearchLinks(search.query || slot.queryIdeas[0], slot.area, locale);
                      return (
                        <article className="food-slot" key={slot.id}>
                          <header style={{ backgroundPosition: slot.kind === "lunch" ? "17% 76%" : "82% 22%" }}>
                            <div className="food-slot-number"><span>{String(slot.dayIndex + 1).padStart(2, "0")}</span><small>{slot.dayLabel}</small></div>
                            <div>
                              <p>{slot.kind === "lunch" ? food.lunch : food.dinner}</p>
                              <h5>{slot.area}</h5>
                              <span>{food.window} · {slot.window}</span>
                            </div>
                          </header>
                          <div className="food-route-context">
                            <p>{food.routeLabel}</p>
                            <div className="food-route-strip" aria-label={`${slot.dayLabel} · ${food.routeLabel}`}>
                              <span><i aria-hidden="true" />{day.stops[0]?.stop.name}</span>
                              <strong><i aria-hidden="true">🍽</i>{slot.area}<small>{slot.kind === "lunch" ? food.lunch : food.dinner}</small></strong>
                              <span><i aria-hidden="true" />{day.stops.at(-1)?.stop.name}</span>
                            </div>
                            <p className="food-route-reason"><span aria-hidden="true">↳</span>{slot.rationale}</p>
                          </div>
                          <div className="food-query-panel">
                            <p>{food.chooseStyle}</p>
                            <div className="food-query-chips">
                              {slot.queryIdeas.map((query, index) => (
                                <button
                                  className={search.query === query ? "is-selected" : ""}
                                  disabled={search.status === "loading"}
                                  key={query}
                                  onClick={() => searchFood(slot, query)}
                                  aria-pressed={search.query === query}
                                  type="button"
                                >
                                  <span className="food-query-art" style={{ backgroundPosition: foodMoodPosition(query, index) }}><small>{visual.foodImage}</small></span>
                                  <b>{query}</b>
                                  <i aria-hidden="true">→</i>
                                </button>
                              ))}
                            </div>
                            {search.status === "loading" ? <p className="food-inline-status" role="status">{food.loading}</p> : null}
                            <small>{food.privacy}</small>
                          </div>
                          {search.status === "ready" ? (
                            <div className="food-candidates" aria-live="polite">
                              <header><p>{food.ready}</p><span className="google-maps-attribution" translate="no">Google Maps</span></header>
                              {search.candidates.length > 0 ? <ol>{search.candidates.map((candidate, index) => {
                                const links = foodSearchLinks(candidate.name, slot.area, locale);
                                return (
                                  <li key={candidate.id}>
                                    <div className="food-candidate-image" style={{ backgroundPosition: foodMoodPosition(`${search.query} ${candidate.type}`, index) }}>
                                      <span>{visual.foodImage}</span><b>{String(index + 1).padStart(2, "0")}</b>
                                    </div>
                                    <div className="food-candidate-copy"><p>{candidate.type}</p><h6>{candidate.name}</h6><small>{candidate.address}</small></div>
                                    <nav aria-label={candidate.name}>
                                      <a className="is-primary" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank"><span aria-hidden="true">⌖</span>{food.google}</a>
                                      <a href={links.tabelog} rel="noreferrer" target="_blank"><span aria-hidden="true">◎</span>{food.tabelog}</a>
                                      <a href={links.x} rel="noreferrer" target="_blank"><span aria-hidden="true">𝕏</span>{food.x}</a>
                                    </nav>
                                  </li>
                                );
                              })}</ol> : <p className="food-search-message">{food.noResults}</p>}
                            </div>
                          ) : search.status === "notConfigured" || search.status === "unavailable" ? (
                            <p className="food-search-message" role="status">{search.status === "notConfigured" ? food.notConfigured : food.unavailable}</p>
                          ) : null}
                          <footer>
                            <p>{food.fallback}</p>
                            <nav>
                              <a href={broadLinks.googleMaps} rel="noreferrer" target="_blank">Google Maps ↗</a>
                              <a href={broadLinks.tabelog} rel="noreferrer" target="_blank">Tabelog ↗</a>
                              <a href={broadLinks.x} rel="noreferrer" target="_blank">X ↗</a>
                            </nav>
                            <small>{visual.foodImageNote} {food.sourceNote}</small>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              <section className="base-result" aria-labelledby="base-result-title">
                <header>
                  <div><p className="section-eyebrow">{details.baseEyebrow}</p><h4 id="base-result-title">{details.baseTitle}</h4></div>
                  <p>{details.baseBody}</p>
                </header>
                {analysis.plan.selectedBase ? (
                  <p className="selected-base"><span>{details.selectedBase}</span><b>{analysis.plan.selectedBase.name}</b><small>{analysis.plan.hotelQuery}</small></p>
                ) : analysis.plan.hotelQuery ? (
                  <p className="unresolved-base"><b>{analysis.plan.hotelQuery}</b><span>{details.unresolvedBase}</span></p>
                ) : null}
                <div className="base-ranking">
                  <p>{details.recommended}</p>
                  <ol>
                    {analysis.plan.baseRecommendations.map((recommendation, index) => (
                      <li className={recommendation.base.id === analysis.plan.selectedBase?.id ? "is-selected" : ""} key={recommendation.base.id}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div><b>{recommendation.base.name}</b><small>{recommendation.routeDistanceKm.toFixed(1)} km · {details.routeDistance}</small></div>
                      </li>
                    ))}
                  </ol>
                </div>
                {mockMode && mockHotels.length > 0 ? (
                  <section className="mock-hotels" aria-labelledby="mock-hotels-title">
                    <header><h5 id="mock-hotels-title">{demo.mockHotels}</h5><span>{demo.mockBadge}</span></header>
                    <div>
                      {mockHotels.map((hotel) => {
                        const selected = hotel.baseId === analysis.plan.selectedBase?.id;
                        return (
                          <article className={selected ? "is-selected" : ""} key={hotel.id}>
                            <span>{demo.mockBadge}</span>
                            <h6>{hotel.name}</h6>
                            <p><b>¥{hotel.nightlyPriceJpy.toLocaleString(locale)}</b> / {demo.perNight}</p>
                            <p>{demo.stationWalk} {hotel.stationWalkMinutes} min</p>
                            <button disabled={selected} onClick={() => { setHotelQuery(hotel.baseQuery); setHasChecked(true); }} type="button">
                              {selected ? demo.selected : demo.useHotel}<span aria-hidden="true">→</span>
                            </button>
                          </article>
                        );
                      })}
                    </div>
                    <p>{demo.disclaimer}</p>
                  </section>
                ) : null}
              </section>
              {analysis.plan.airportConstraints.length > 0 ? (
                <section className="airport-result" aria-labelledby="airport-result-title">
                  <header><p className="section-eyebrow">AIR / GROUND</p><h4 id="airport-result-title">{details.airportTitle}</h4></header>
                  <div>
                    {analysis.plan.airportConstraints.map((constraint) => (
                      <article key={`${constraint.direction}-${constraint.airport}`}>
                        <span>{constraint.direction === "arrival" ? details.arrival : details.departure} · {constraint.airport} · {constraint.flightTime}</span>
                        <strong>{constraint.direction === "arrival" ? details.arrivalReady : details.departureLeave} {constraint.cityTime}{constraint.cityTimeDayOffset === -1 ? ` · ${details.previousDay}` : constraint.cityTimeDayOffset === 1 ? ` · ${details.nextDay}` : ""}</strong>
                        <p>{details.airportTime} {formatDuration(constraint.airportMinutes, locale)} + {details.cityTransfer} {formatDuration(constraint.transferMinutes, locale)}</p>
                        <div><a href={constraint.sourceUrl} target="_blank" rel="noreferrer">{details.officialGuide} ↗</a>{constraint.googleMapsUrl ? <a href={constraint.googleMapsUrl} target="_blank" rel="noreferrer">{details.checkMaps} ↗</a> : null}</div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="timing-editor-intro" aria-labelledby="timing-editor-title">
                <div>
                  <p className="section-eyebrow">{editing.eyebrow}</p>
                  <h4 id="timing-editor-title">{editing.title}</h4>
                  <span>{editing.body}</span>
                </div>
                <button disabled={!hasTimingEdits} onClick={resetTiming} type="button">{editing.reset}<span aria-hidden="true">↺</span></button>
              </section>
              <section className={`live-route-panel ${hasLiveTransit ? "is-live" : ""}`} aria-labelledby="live-route-title">
                <div>
                  <p className="section-eyebrow">{liveRoute.eyebrow}</p>
                  <h4 id="live-route-title">{liveRoute.title}</h4>
                  <span>{liveRoute.body}</span>
                  <small>{liveRoute.privacy}</small>
                </div>
                <div className="live-route-action">
                  <button disabled={!canRequestLiveTransit || activeLiveRouteStatus === "loading"} onClick={updateLiveRoutes} type="button">
                    {activeLiveRouteStatus === "loading" ? liveRoute.loading : liveRoute.button}<span aria-hidden="true">↻</span>
                  </button>
                  {liveStatusMessage ? <p role="status">{liveStatusMessage}</p> : null}
                  {hasLiveTransit ? <span className="google-maps-attribution" translate="no">Google Maps</span> : null}
                </div>
              </section>
              {analysis.plan.overCapacityCount + analysis.plan.scheduleConflictCount > 0 ? <p className="pace-warning">{planText.crowded}</p> : null}
              <div className="built-days">
                {analysis.plan.days.map((day, dayIndex) => (
                  <article className="built-day" key={day.label}>
                    <header>
                      <div><span>{day.label}</span><h4>{day.theme}</h4></div>
                      <div className="day-time-tools">
                        <label>
                          <span>{editing.dayStart}</span>
                          <input
                            aria-label={`${day.label} · ${editing.dayStart}`}
                            onChange={(event) => updateDayStart(dayIndex, event.target.value)}
                            type="time"
                            value={dayStartTimes[dayIndex] ?? day.startTime}
                          />
                        </label>
                        <em>{day.startTime}—{day.finishTime}</em>
                      </div>
                    </header>
                    {day.startAdjustedByArrival ? <p className="arrival-start-note">{editing.arrivalAdjusted}</p> : null}
                    <div className="day-constraints">
                      <span>{planText.dayLength} <b>{formatDuration(day.totalMinutes, locale)}</b></span>
                      {day.hotelTravelMinutes !== null ? <span>{details.hotelTravel} <b>{formatDuration(day.hotelTravelMinutes, locale)}</b></span> : null}
                      {day.deadline ? <span className={day.deadlineOverrunMinutes > 0 ? "is-danger" : ""}>{details.departureDeadline} <b>{day.deadline}</b>{day.deadlineOverrunMinutes > 0 ? ` · ${details.overrun} ${formatDuration(day.deadlineOverrunMinutes, locale)}` : ""}</span> : null}
                    </div>
                    <DayRouteMap day={day} locale={locale} />
                    <ol>
                      {day.stops.map((scheduled, index) => {
                        const leg = day.legs[index];
                        const longestOption = leg ? Math.max(...leg.comparison.options.map((option) => option.minutes), 1) : 1;
                        return (
                          <li className={scheduled.kind === "meal" ? "is-meal-stop" : ""} key={scheduled.stop.id}>
                            <div className="built-stop">
                              <time>{scheduled.arrival}</time>
                              <span className="built-stop-index">{String(index + 1).padStart(2, "0")}</span>
                              <div>
                                <b>{scheduled.stop.name}</b>
                                {scheduled.kind === "meal" ? <span className="meal-stop-badges"><em>{scheduled.mealKind === "lunch" ? meals.lunch : meals.dinnerLabel}</em><small>{meals.protectedTime}</small></span> : null}
                                {scheduled.priority !== "normal" || scheduled.fixedTime ? (
                                  <span className="stop-constraint-badges">
                                    {scheduled.priority === "must" ? <em className="is-must">{constraints.must}</em> : null}
                                    {scheduled.fixedTime ? <em className="is-reserved">{constraints.reserved} {scheduled.fixedTime}</em> : null}
                                    {scheduled.priority === "optional" ? <em className="is-optional">{constraints.optional}</em> : null}
                                    {scheduled.reservationLateMinutes > 0 ? <em className="is-late">{constraints.lateBy} {formatDuration(scheduled.reservationLateMinutes, locale)}</em> : null}
                                  </span>
                                ) : null}
                                {scheduled.stop.isUserEntered ? <span className="user-location-note">{meals.userLocation}</span> : null}
                                {scheduled.crowd ? <CrowdBadge outlook={scheduled.crowd} text={meals} /> : null}
                                {scheduled.kind === "place" ? <label className="stay-time-editor">
                                  <span>{editing.stayTime}</span>
                                  <select
                                    aria-label={`${scheduled.stop.name} · ${editing.stayTime}`}
                                    onChange={(event) => updateDuration(scheduled.stop.id, Number(event.target.value))}
                                    value={scheduled.stop.planningDurationMinutes}
                                  >
                                    {[30, 45, 60, 75, 90, 120, 150, 180, 240].map((minutes) => (
                                      <option key={minutes} value={minutes}>{formatDuration(minutes, locale)}</option>
                                    ))}
                                  </select>
                                </label> : null}
                                {scheduled.kind === "meal"
                                  ? <small>{scheduled.stop.area} · {formatDuration(scheduled.stop.planningDurationMinutes, locale)} · {meals.chooseRestaurantLater}</small>
                                  : <small>{scheduled.stop.area} · {planText.stay} {formatDuration(scheduled.stop.planningDurationMinutes, locale)} · <a href={scheduled.stop.sourceUrl} target="_blank" rel="noreferrer">{routeText.source}</a></small>}
                              </div>
                            </div>
                            {leg?.isLocalMealPause ? (
                              <div className="meal-local-connector"><span aria-hidden="true">↓</span><b>{meals.localPause}</b></div>
                            ) : leg ? (
                              <div className="built-leg">
                                <div className="mode-options">
                                  {leg.comparison.options.map((option) => (
                                    <a
                                      className={`mode-chip ${option.mode === leg.comparison.recommended.mode ? "is-recommended" : ""}`}
                                      href={leg.googleMapsUrls[option.mode]}
                                      key={option.mode}
                                      rel="noreferrer"
                                      style={{ "--mode-width": `${Math.max(18, (option.minutes / longestOption) * 100)}%` } as CSSProperties}
                                      target="_blank"
                                    >
                                      <span className="mode-icon" aria-hidden="true">{modeGlyph(option.mode)}</span>
                                      <span className="mode-name">{planText.modes[option.mode]}</span>
                                      <b>{formatDuration(option.minutes, locale)}</b>
                                      {option.mode === leg.comparison.recommended.mode ? <i>{visual.recommended}</i> : option.source === "live" ? <i>{liveRoute.live}</i> : null}
                                      <span className="mode-bar" aria-hidden="true"><i /></span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                    {day.legs.some((leg) => leg.comparison.options.some((option) => option.source === "live")) ? (
                      <span className="google-maps-attribution day-attribution" translate="no">Google Maps</span>
                    ) : null}
                  </article>
                ))}
              </div>
              {analysis.plan.deferredOptionalStops.length > 0 ? (
                <article className="deferred-places">
                  <div><span>{String(analysis.plan.deferredOptionalStops.length).padStart(2, "0")}</span><h4>{constraints.backupTitle}</h4></div>
                  <p>{constraints.backupBody}</p>
                  <ul>{analysis.plan.deferredOptionalStops.map((stop) => <li key={stop.id}>{stop.name}<span>{stop.area}</span></li>)}</ul>
                </article>
              ) : null}
              {analysis.plan.unknownEntries.length > 0 ? (
                <article className="unresolved-places">
                  <div><span>{String(analysis.plan.unknownEntries.length).padStart(2, "0")}</span><h4>{planText.unresolvedTitle}</h4></div>
                  <p>{planText.unresolvedBody}</p>
                  <ul>{analysis.plan.unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                </article>
              ) : null}
              <p className="route-disclosure">{hasLiveTransit ? liveRoute.disclosure : planText.disclosure}</p>
            </section>
          ) : null}
          {analysis.inputMode === "itinerary" && analysis.geography.days.length > 0 ? (
            <section className="route-result reveal" aria-labelledby="route-result-title">
              <header className="route-result-heading">
                <div>
                  <p className="section-eyebrow">{routeText.eyebrow}</p>
                  <h3 id="route-result-title">{routeText.title}</h3>
                  <p>{routeText.body}</p>
                </div>
                <span className="engine-badge">{routeText.engine}</span>
              </header>
              <div className="route-metrics">
                <div><strong>{analysis.geography.recognizedStopCount}</strong><span>{routeText.recognized}</span></div>
                <div><strong>{analysis.geography.originalDistanceKm.toFixed(1)} km</strong><span>{routeText.before}</span></div>
                <div><strong>{analysis.geography.optimizedDistanceKm.toFixed(1)} km</strong><span>{routeText.after}</span></div>
                <div className="route-saving"><strong>{analysis.geography.distanceSavedKm >= 0.1 ? `−${analysis.geography.distanceSavedKm.toFixed(1)} km` : "0 km"}</strong><span>{analysis.geography.distanceSavedKm >= 0.1 ? routeText.saved : routeText.unchanged}</span></div>
              </div>
              <div className="optimized-days">
                {analysis.geography.days.map((day) => (
                  <article className="optimized-day" key={day.label}>
                    <header>
                      <div><span>{day.label}</span><h4>{day.changed ? routeText.dayChanged : routeText.dayKept}</h4></div>
                      <em>{day.exact ? routeText.exact : routeText.heuristic}</em>
                    </header>
                    <ol>
                      {day.optimizedStops.map((stop, index) => (
                        <li key={stop.id}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div><b>{stop.name}</b><small>{stop.area} · <a href={stop.sourceUrl} target="_blank" rel="noreferrer">{routeText.source}</a>{stop.isAnchor ? ` · ${routeText.anchor}` : ""}</small></div>
                        </li>
                      ))}
                    </ol>
                    <a className="maps-button" href={day.googleMapsUrl} target="_blank" rel="noreferrer">
                      {routeText.openMaps}<span aria-hidden="true">↗</span>
                    </a>
                  </article>
                ))}
              </div>
              <p className="route-disclosure">{routeText.disclosure}</p>
            </section>
          ) : null}
          {analysis.inputMode === "itinerary" && analysis.timing.days.length > 0 ? (
            <section className="time-result reveal" aria-labelledby="time-result-title">
              <header className="time-result-heading">
                <div>
                  <p className="section-eyebrow">{timeText.eyebrow}</p>
                  <h3 id="time-result-title">{timeText.title}</h3>
                  <p>{timeText.body}</p>
                </div>
                <span className="engine-badge">{timeText.engine}</span>
              </header>
              <div className="time-metrics">
                <div><strong>{analysis.timing.timedStopCount}</strong><span>{timeText.timed}</span></div>
                <div className={analysis.timing.conflictCount > 0 ? "is-danger" : ""}><strong>{analysis.timing.conflictCount}</strong><span>{timeText.conflicts}</span></div>
                <div className={analysis.timing.tightCount > 0 ? "is-tight" : ""}><strong>{analysis.timing.tightCount}</strong><span>{timeText.tight}</span></div>
                <div><strong>{formatDuration(analysis.timing.longestDayMinutes, locale)}</strong><span>{timeText.longest}</span></div>
              </div>
              <div className="time-days">
                {analysis.timing.days.map((day) => (
                  <article className="time-day" key={day.label}>
                    <header><h4>{day.label}</h4><span>{timeText.finish} {day.estimatedFinish}</span></header>
                    <ol>
                      {day.stops.map((stop, index) => {
                        const leg = day.legs[index];
                        return (
                          <li key={`${day.label}-${stop.time}-${index}`}>
                            <div className="timed-stop">
                              <time>{stop.time}</time>
                              <div><b>{stop.name}</b><small>{stop.stayIsCustom ? timeText.customStay : timeText.assumedStay} {formatDuration(stop.stayMinutes, locale)}</small></div>
                              {stop.isAnchor ? <em>{timeText.anchor}</em> : null}
                            </div>
                            {leg ? (
                              <div className={`time-connection ${leg.status}`}>
                                <span>{leg.travelMinutes === null ? timeText.unknownTravel : `${leg.travelMode === "walk" ? timeText.walk : timeText.transit} ${formatDuration(leg.travelMinutes, locale)}`}</span>
                                <strong>
                                  {leg.status === "conflict"
                                    ? `${timeText.shortBy} ${formatDuration(Math.abs(leg.bufferMinutes), locale)}`
                                    : leg.status === "unknown"
                                      ? timeText.unknownTravel
                                      : leg.status === "tight"
                                        ? `${timeText.buffer} ${formatDuration(leg.bufferMinutes, locale)}`
                                        : `${timeText.comfortable} ${formatDuration(leg.bufferMinutes, locale)}`}
                                </strong>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </article>
                ))}
              </div>
              <p className="time-disclosure">{timeText.disclosure}</p>
            </section>
          ) : null}
          {analysis.inputMode === "itinerary" ? <div className="result-layout">
            <div className="issue-column">
              <div className="column-heading reveal"><p>{t.result.issuesEyebrow}</p><h3>{t.result.issuesTitle}</h3></div>
              <div className="issue-list">
                {analysis.issues.map((issue, index) => (
                  <article className={`issue-card reveal ${issue.severity}`} style={{ transitionDelay: `${index * 60}ms` }} key={`${issue.title}-${index}`}>
                    <IssueMark kind={issue.severity} />
                    <div>
                      <div className="issue-meta"><span>{t.result.severity[issue.severity]}</span><span>{issue.eyebrow}</span><span>{t.result.confidence[issue.confidence]}</span></div>
                      <h4>{issue.title}</h4><p>{issue.detail}</p>
                      <div className="issue-action"><b>{t.result.action}</b><span>{issue.action}</span></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <aside className="revision-panel reveal">
              <p className="section-eyebrow">{t.result.revisedEyebrow}</p>
              <h3>{t.result.revisedTitle}</h3><p className="revision-intro">{t.result.revisedIntro}</p>
              <div className="day-list">
                {analysis.revisedDays.map((day) => (
                  <article className="day-card" key={day.day}>
                    <header><div><span>{day.day}</span><h4>{day.theme}</h4></div><em>{t.result.load[day.load]}</em></header>
                    <ol>
                      {day.stops.map((stop, index) => (
                        <li key={`${stop.name}-${index}`}><time>{stop.time}</time><span><b>{stop.name}</b>{stop.note && <small>{stop.note}</small>}</span></li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
              <button className="save-button" type="button" disabled>{t.result.save}<span>{t.result.coming}</span></button>
            </aside>
          </div> : null}
        </section>
      ) : null}

      <section className="answer-section" id="trust">
        <header className="answer-heading reveal">
          <p className="section-eyebrow">07 / {answers.eyebrow}</p>
          <h2>{answers.title}</h2>
          <p>{answers.intro}</p>
        </header>
        <div className="answer-list">
          {answers.items.map((item, index) => (
            <article className="answer-row reveal" style={{ transitionDelay: `${index * 60}ms` }} key={item.question}>
              <span>0{index + 1}</span>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <Brand />
        <p>{t.footer}</p>
        <nav aria-label="Legal and page links"><a href="/privacy">PRIVACY</a><a href="/terms">TERMS</a><a href="#top">BACK TO TOP ↑</a></nav>
      </footer>
    </main>
  );
}
