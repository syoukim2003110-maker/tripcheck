// User-facing copy for the planner: the full ja/en UI table plus the
// localized sentence builders for feasibility verdicts, conflicts,
// assumptions and alternatives. Pure data and string functions - no React.
import type {
  AlternativePlan,
  Assumption,
  Attention,
  Conflict,
  FeasibilityResult,
  FeasibilityState,
  FeasibilityUnknownCause,
} from "../feasibility-result.ts";
import type { BuiltTripPlan } from "../trip-builder.ts";
import type { TransportMode } from "../time-feasibility.ts";

export type PlannerLocale = "en" | "ja";

export const ui = {
  ja: {
    brandNote: (place: string) => place ? `${place}の旅プランナー` : "旅のプランナー",
    destination: "行き先の国",
    destinationSearch: "国名を入力して選択",
    airportSearch: "空港名・都市・3レターコードで検索",
    noMatchingOption: "一致する候補がありません",
    optionCount: (count: number) => `${count}件の候補`,
    newTrip: "新しい旅",
    inputLabel: "行きたい場所",
    sample: "サンプルを見る",
    swissDemo: "スイスデモ",
    parseHint: "改行のほか「・」「／」「,」でまとめて貼っても、場所ごとに分けます。「1日目」、時刻、予約、必須、滞在時間も読み取ります。地名は現地表記でも英語でも大丈夫です。",
    previewHeading: (count: number) => `${count}か所として読み取り`,
    previewFormat: "1件ずつに整える",
    previewDay: (day: number) => `${day}日目`,
    previewUnparsed: "場所名として読み取れない行",
    previewStay: (minutes: number) => `滞在${minutes}分`,
    days: "日数",
    date: "初日",
    hotel: "ホテル名・泊まりたいエリア",
    hotelPlaceholder: "例：中央駅の近く（未定でもOK）",
    arrival: "到着空港",
    arrivalTime: "到着時刻",
    departure: "出発空港",
    departureTime: "出発時刻",
    pace: "旅のペース",
    travelHeading: "移動手段",
    travelAuto: "おまかせ（効率重視）",
    travelCar: "レンタカー・車",
    moveCar: "車",
    timebandHeading: "1日の時間帯",
    timebandEarly: "朝型 8:00〜",
    timebandNormal: "標準 9:00〜",
    timebandLate: "ゆっくり 10:30〜",
    dayEndHeading: "1日の終わり",
    dayEndNone: "標準 22:00",
    curfewOver: (time: string) => `${time} までに収まっていません`,
    recentHeading: "最近の旅程",
    recentNote: "この端末の中だけに保存されます",
    recentDays: (days: number) => `${days}日間`,
    recentDelete: "削除",
    moveDay: "日を移動",
    mealChoose: "この店にする",
    mealChosen: "行程に入れました",
    toastAdded: "旅程に追加しました",
    share: "共有リンク",
    shareCopied: "コピーしました",
    shareTitle: "この旅程を同じ設定で開けるリンクをコピーします。内容はリンクの中だけに入り、サーバには保存されません。",
    relaxed: "ゆったり",
    balanced: "標準",
    fast: "たくさん回る",
    buildingTitle: "予定をつくっています",
    buildingBody: "場所・営業時間・拠点を確認し、固定条件を破らない予定を計算します。",
    buildingBodyNoSocial: "場所・営業時間・拠点を確認し、固定条件を破らない予定を計算します。経路データは表示後に反映します。",
    buildingCancel: "入力にもどる",
    // Copy Deck build.stage1-3 (verbatim): three outcome stages, no counts.
    buildSteps: {
      grouping: "近い場所を同じ日にまとめています",
      ordering: "回る順番を整えています",
      enriching: "ホテルと食事の候補を探しています",
    },
    mapReady: "Googleマップ",
    mapEmpty: "行き先を入れると、ここに旅が描かれます",
    legendLabel: "凡例",
    legendMeasured: "実経路",
    legendEstimated: "推定",
    legendAnchor: "予定地点",
    legendSuggestion: "おすすめ地点",
    routeIdeasChip: "今日の予定の近く",
    routeIdeasTitle: "今日の予定の近くなら、ここも寄れます",
    routeIdeasSubtitle: "今日の実経路と予定地点の周辺から、評価の裏付けがある場所だけを探しました。",
    routeIdeasLoading: "動線上の候補を探しています…",
    routeIdeasUnavailable: "いまは動線上の候補を取得できませんでした。予定そのものはそのまま使えます。",
    routeIdeasRateLimited: "今日の無料検索枠に達しました。予定そのものはそのまま使えます。",
    routeIdeasEmpty: "評価と近さの両方を満たす候補は見つかりませんでした。無理に場所を足していません。",
    routeIdeasDistance: (meters: number) => meters < 1_000 ? `予定経路から約${meters}m` : `予定経路から約${(meters / 1_000).toFixed(1)}km`,
    routeIdeasAdd: "この日に追加して再計算",
    routeIdeasAdded: "追加済み",
    routeIdeasNote: "評価はGoogle Maps、近さは取得できたGoogle実経路（未取得区間は予定地点）への概算距離です。追加後の順番と移動時間はTripCheckが再計算します。自動では追加しません。",
    edit: "入力にもどる",
    openMaps: "Google Mapsで開く",
    removeStop: "この行き先を予定から外す",
    removedHeading: "自分で外した場所",
    restoreStop: "もどす",
    backToPlan: "作成した計画にもどる",
    hotelDepartRow: (mode: string, minutes: number) => `ホテルから ${mode} 約${minutes}分`,
    hotelReturnRow: (mode: string, minutes: number) => `ホテルへ ${mode} 約${minutes}分`,
    travelTotal: (minutes: number) => `移動 合計約${minutes}分`,
    precipitation: (percent: number) => `降水${percent}%`,
    forecastNote: "Open-Meteo予報",
    holidayBadge: "祝",
    holidayNote: (name: string) => `祝日「${name}」— 美術館・商店は休業・短縮営業の可能性。営業時間の再確認を`,
    holidayRegional: "（一部地域のみ）",
    sundayClosingNote: "日曜 — 閉店法で商店・スーパーはほぼ休業（駅ナカ店舗は例外が多い）",
    flightKindHeading: "フライトの種類",
    flightInternational: "国際線",
    flightDomestic: "国内線",
    essentialsPlug: "電源プラグ",
    essentialsEmergency: "緊急通報",
    essentialsEntry: "入国（日本のパスポート）",
    essentialsPass: "交通パス",
    essentialsOfficial: "公式情報",
    beforeStrike: "スト・運休の確認",
    beforeMedication: "薬の持ち込み",
    beforeMedicationNote: "常用薬は元の箱・説明書きのまま携行（一包化は中身不明扱いのリスク）。向精神薬成分や多量の持込みは事前手続きが必要な国がある。米国はFDA未認可薬だと処方箋があっても没収されることがある。",
    beforeHeading: "出発前チェック",
    beforeOverdue: "要対応",
    beforeDueSoon: "期限接近",
    beforePassportLabel: "パスポートの有効期限",
    beforePassportHint: "残存期間チェック用。この端末にのみ保存されます。",
    passportCountry: "パスポートの国",
    passportUnset: "未選択（入国判定を表示しない）",
    passportJapan: "日本",
    passportOther: "その他",
    passportUnsupported: "現在の個別入国判定は日本のパスポートのみ対応。その他は目的地の公式情報を確認してください。",
    beforeBooked: "予約済みとして計画 — バウチャーと入場方法を確認",
    beforeBookedAt: (time: string) => `${time}に予約済みとして計画 — バウチャーと入場方法を確認`,
    beforeWatch: "売り切れ・行列の報告あり — 事前予約か朝イチを検討",
    print: "印刷 / PDF",
    printTitle: "全日程を1枚にして印刷・PDF保存（オフライン用）",
    printBooked: "予約",
    printFooter: "時間は計画用の目安です。移動と営業時間は現地で最終確認してください。 · Weather by Open-Meteo",
    legModes: "この区間の移動手段。タップで固定、もう一度タップで自動に戻す",
    move: { walk: "徒歩", transit: "電車", taxi: "タクシー" },
    minutes: (value: number) => `${value}分`,
    legLive: "Google Maps経路",
    unknown: "地図に出せなかった場所",
    placeFallback: "見つからなかった場所があります。確認できた場所だけで組み立てています。",
    noDays: "地図に置ける場所がまだありません。名前を少し変えると見つかることがあります。",
    openDay: "この日はまだ予定がありません",
    selectHint: "ピンや行き先をタップすると、詳しい情報が開きます",
    // Copy Deck plan.reco.meal (verbatim): the meal recommendation label line.
    mealIdeas: "この動線なら、ここが便利です",
    // Copy Deck plan.reco.gap: the inline gap suggestion label (minutes parameterized).
    gapRecoLabel: (minutes: number) => `${minutes}分の空き時間に寄れます`,
    // Copy Deck plan.reco.accept / plan.reco.replace.
    recoAccept: "ここにする",
    recoAlternatives: "他を見る",
    // Real walking detour from the slot's route position (≈80m/min).
    detourLine: (minutes: number) => `動線から約${minutes}分`,
    lunchChip: "昼ごはん",
    dinnerChip: "夜ごはん",
    foodLoading: "近くのお店を探しています…",
    foodUnavailable: "お店を取得できませんでした。Google Mapsで同じ条件を開けます。",
    maps: "地図で見る",
    foodNote: "Googleの評価・口コミ量・距離・営業表示をロジックで比較。公開SNSは引用できた情報だけを補足しています。",
    foodFresh: (count: number) => `最近の公開情報 ${count}件`,
    // Copy Deck plan.hotel.change: the visible change-base control.
    hotelChip: "ホテルを変える",
    hotelPending: "ホテルを探しています…",
    // Copy Deck plan.hotel.title.
    hotelCandidate: "おすすめの拠点",
    // Copy Deck plan.hotel.effect: only shown for a real travel saving vs the
    // current base, measured on the really simulated candidate plan.
    hotelSavesTravel: (minutes: number) => {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      const duration = hours > 0 ? `${hours}時間${rest > 0 ? `${rest}分` : ""}` : `${rest}分`;
      return `移動を${duration}短縮`;
    },
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
    styleNote: "参考価格は日付・空室未指定のため、コスパ順位には使いません。",
    hotelRankNote: "各日の行き先を1日1票で比較し、直線距離の平均と最も遠い日の負担が小さいホテルを優先。そこへGoogle評価と口コミ量を加えて総合順位を決めます。実際の所要時間は地図の経路で確認します。",
    hotelCompareHeading: "候補を比べる（タップで切り替え）",
    priceUnlisted: "価格未掲載",
    rakutenTag: (average: number, count: number) => `楽天トラベル ★${average.toFixed(1)}（${count.toLocaleString("ja-JP")}件）`,
    hotelPriceNote: "¥価格は楽天トラベル掲載の参考最安（日付未指定）です。",
    hotelReasonTop: "全日程への行きやすさ・評価・口コミ量の合計で1位の候補です。",
    hotelReasonNearest: "各日の行き先への距離負担が最も小さい候補です。",
    hotelReasonRated: "十分な口コミ数がある候補の中で、Google評価が最も高いホテルです。",
    hotelReasonValue: "参考価格は表示しますが、日付と空室が未確認のためコスパ1位とは判定しません。",
    hotelReasonSpecified: "入力したホテル名に一致した候補です。行程の出発・帰着地点にも反映しています。",
    hotelReasonPicked: "切り替えて選んだ候補です。",
    hotelPurposeHeading: "何を優先する？",
    hotelPurposeBalanced: "総合",
    hotelPurposeNearest: "移動を少なく",
    hotelPurposeRated: "評価重視",
    hotelPurposeHelp: "総移動時間と評価を比較します。価格・空室は予約サイトで確認してください。",
    axisOverall: "総合おすすめ",
    axisNearest: "移動が少ない",
    axisTopRated: "口コミ高評価",
    distanceFrom: (distance: string) => `各日の中心へ直線平均約${distance}`,
    hotelWideTrip: "行き先が広範囲です。1つのホテルでは長距離移動が残るため、日ごとに変える方が楽です。",
    useThisHotel: "このホテルに切り替え",
    tonightHotel: (name: string) => `今夜の宿 · ${name}`,
    publicSources: "公開SNS・記事の出典",
    reservation: "予約",
    timePinned: "時間指定",
    lateBy: (minutes: number) => `指定時刻に約${minutes}分間に合わない見込み`,
    lateShort: (minutes: number) => `${minutes}分遅れ`,
    must: "必須",
    optional: "任意",
    stayLabel: "滞在時間",
    stayAuto: "自動",
    dayStart: "開始時刻",
    dayEnd: "終了時刻",
    dayTabsLabel: "日程を選ぶ",
    dayTimelineLabel: (day: string) => `${day}の行程`,
    dayBreakdownLabel: "この日の時間内訳",
    dayWindowLabel: "時間帯",
    dayPlannedLabel: "予定",
    dayAvailableLabel: "利用可能",
    dayTravelLabel: "移動",
    // Copy Deck data.estimated (verbatim headline); the provider detail is
    // secondary text, never the headline.
    estimated: "所要時間は目安です",
    estimatedDetail: "Google Maps経路データを取得できた区間だけ自動で更新します。",
    // Copy Deck data.checkhours (verbatim): the standard unverified-hours phrasing.
    checkHours: "出発前に営業時間を確認",
    // Copy Deck scope.beta (verbatim): shown only for non-deep coverage regions.
    betaRegion: "この地域はベータ対応です",
    // TC-062 scope warnings (terms: border crossings, multiple time zones and
    // ferries are unsupported). One short honest line per triggered case, each
    // naming a safe next step (spec QA-050); planning is never blocked.
    scopeBorder: "国をまたぐ旅程は精度が下がります。国境をまたぐ移動は公式サイトで確認してください。",
    scopeTimezone: "複数の時間帯にまたがる旅程です。時刻は各地の現地時間で確認してください。",
    scopeFerry: "フェリー区間は対応範囲外です。運航時刻は公式サイトで確認してください。",
    // Copy Deck share.warning (verbatim primary line); the nuance stays secondary.
    shareWarning: "リンクを知っている人は旅程を見られます",
    shareWarningDetail: "このリンク自体が旅程データです。受信者、ブラウザ履歴、拡張機能から読めます。公開場所へ貼らないでください。",
    // TC-052 §9.3 sheet-size controls: explicit buttons, never drag-only.
    sheetExpand: "シートを全画面に広げる",
    sheetShrink: "シートを半分の高さに戻す",
    sheetMinimize: "シートを最小化",
    sheetPeekOpen: "シートを開く",
    openingAdjusted: "営業時間に合わせて訪問時刻を調整",
    openingConflict: "営業時間と予約時刻を再確認",
    openingClosedDay: "この日は休業の可能性 — 日の移動を検討",
    excludedHeading: "予定から外した場所",
    excludedClosed: "休業・営業時間が合わない",
    excludedPace: "ペースに収まらない任意の場所",
    overCapacity: "1日に収まりきらない日があります。日数を増やすか、任意の場所を減らすと現実的になります。",
    fitSelectedDays: "日数を変えて再計算",
    fitDaysValue: (days: number) => `${days}日間`,
    fitDaysDecrease: "旅行を1日短くする",
    fitDaysIncrease: "旅行を1日長くする",
    walkingSafety: "徒歩経路はベータ版。安全状況は現地で確認してください。",
    deadlineOver: (time: string) => `空港へ向かう目安 ${time} を超えています`,
    language: "言語",
    // Copy Deck privacy.short. The "no account" fact moved into the header
    // link's title/aria-label; the policy page carries the full statement.
    privacy: "旅程はこの端末に保存されます",
    privacyTitle: "アカウント不要 · プライバシー方針",
    resolveRemove: "外す",
    resolveRemoveAria: (name: string) => `「${name}」をリストから外す`,
    manualAddressResolving: "住所を確認しています…",
    manualAddressNotFound: "住所を見つけられませんでした",
    fieldCheck: "最新の公開情報も確認",
    fieldChecking: "確認中…",
    fieldChecked: "公開情報も確認済み",
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
    brandNote: (place: string) => place ? `${place} trip planner` : "Trip planner",
    destination: "Country",
    destinationSearch: "Type a country to choose",
    airportSearch: "Search airport, city or IATA code",
    noMatchingOption: "No matching option",
    optionCount: (count: number) => `${count} option${count === 1 ? "" : "s"}`,
    newTrip: "New trip",
    inputLabel: "Places you want to visit",
    sample: "Try a sample",
    swissDemo: "Swiss demo",
    parseHint: "Paste one per line, or use commas, slashes and middle dots; we separate the places. Day headings, times, booked / must / optional and stay length are also read. Local-language names are fine.",
    previewHeading: (count: number) => `Read as ${count} place${count === 1 ? "" : "s"}`,
    previewFormat: "Make one per line",
    previewDay: (day: number) => `Day ${day}`,
    previewUnparsed: "Can't read this line as a place",
    previewStay: (minutes: number) => `Stay ${minutes} min`,
    days: "Days",
    date: "First day",
    hotel: "Hotel or preferred area",
    hotelPlaceholder: "e.g. near the main station (optional)",
    arrival: "Arrival airport",
    arrivalTime: "Arrival time",
    departure: "Departure airport",
    departureTime: "Departure time",
    pace: "Pace",
    travelHeading: "Getting around",
    travelAuto: "Recommended · efficient",
    travelCar: "Rental car",
    moveCar: "Drive",
    timebandHeading: "Day rhythm",
    timebandEarly: "Early 8:00",
    timebandNormal: "Standard 9:00",
    timebandLate: "Slow 10:30",
    dayEndHeading: "Day ends by",
    dayEndNone: "Standard 22:00",
    curfewOver: (time: string) => `Runs past your ${time} target`,
    recentHeading: "Recent trips",
    recentNote: "Stored only on this device",
    recentDays: (days: number) => `${days} days`,
    recentDelete: "Remove",
    moveDay: "Move to day",
    mealChoose: "Pick this place",
    mealChosen: "Added to the day",
    toastAdded: "Added to the itinerary",
    share: "Copy share link",
    shareCopied: "Copied",
    shareTitle: "Copies a link that reopens this trip with the same inputs. Everything lives in the link itself; nothing is stored.",
    relaxed: "Relaxed",
    balanced: "Balanced",
    fast: "See more",
    buildingTitle: "Building your trip",
    buildingBody: "We confirm places, hours and the base, then calculate a plan that keeps every hard constraint.",
    buildingBodyNoSocial: "We confirm places, hours and the base, then calculate every hard constraint. Route data blends in after the result appears.",
    buildingCancel: "Back to input",
    // Copy Deck build.stage1-3 (verbatim): three outcome stages, no counts.
    buildSteps: {
      grouping: "Grouping nearby places into days",
      ordering: "Finding a practical order",
      enriching: "Finding a practical base and meal stops",
    },
    mapReady: "Google Maps",
    mapEmpty: "Your trip will appear here",
    legendLabel: "Legend",
    legendMeasured: "measured",
    legendEstimated: "estimated",
    legendAnchor: "planned stop",
    legendSuggestion: "suggestion",
    routeIdeasChip: "Near today's plan",
    routeIdeasTitle: "Worthwhile places near today's plan",
    routeIdeasSubtitle: "We searched around today's live route and planned stops, then kept only places backed by ratings.",
    routeIdeasLoading: "Finding worthwhile stops along this route…",
    routeIdeasUnavailable: "Route ideas are unavailable right now. Your plan still works as-is.",
    routeIdeasRateLimited: "Today's free search allowance has been used. Your plan still works as-is.",
    routeIdeasEmpty: "Nothing met both the rating and proximity bar, so we did not pad the day with a weak suggestion.",
    routeIdeasDistance: (meters: number) => meters < 1_000 ? `About ${meters}m from the route` : `About ${(meters / 1_000).toFixed(1)}km from the route`,
    routeIdeasAdd: "Add to this day & reroute",
    routeIdeasAdded: "Already added",
    routeIdeasNote: "Ratings are from Google Maps. Proximity is an approximate distance from available Google route geometry, falling back to planned stops for any missing leg. TripCheck reroutes after you add one; nothing is added automatically.",
    edit: "Back to input",
    openMaps: "Open in Google Maps",
    removeStop: "Remove from the plan",
    removedHeading: "Removed by you",
    restoreStop: "Put back",
    backToPlan: "Back to your plan",
    hotelDepartRow: (mode: string, minutes: number) => `From hotel · ${mode} ~${minutes} min`,
    hotelReturnRow: (mode: string, minutes: number) => `To hotel · ${mode} ~${minutes} min`,
    travelTotal: (minutes: number) => `~${minutes} min total travel`,
    precipitation: (percent: number) => `${percent}% rain`,
    forecastNote: "Open-Meteo forecast",
    holidayBadge: "PH",
    holidayNote: (name: string) => `Public holiday “${name}” — museums and shops may close or shorten hours; re-check opening times`,
    holidayRegional: " (some regions only)",
    sundayClosingNote: "Sunday — most shops and supermarkets are closed by law (station shops are the usual exception)",
    flightKindHeading: "Flight type",
    flightInternational: "International",
    flightDomestic: "Domestic",
    essentialsPlug: "Power plug",
    essentialsEmergency: "Emergency",
    essentialsEntry: "Entry (Japan passport)",
    essentialsPass: "Transit pass",
    essentialsOfficial: "Official info",
    beforeStrike: "Strike / disruption check",
    beforeMedication: "Medication rules",
    beforeMedicationNote: "Carry medicines in their original packaging with documentation. Some countries require advance permits for psychotropic ingredients or large quantities; the US can confiscate non-FDA-approved drugs even with a prescription.",
    beforeHeading: "Before you go",
    beforeOverdue: "Action needed",
    beforeDueSoon: "Due soon",
    beforePassportLabel: "Passport expiry date",
    beforePassportHint: "Used for the validity check. Stored on this device only.",
    passportCountry: "Passport country",
    passportUnset: "Not set (hide personalised entry checks)",
    passportJapan: "Japan",
    passportOther: "Other",
    passportUnsupported: "Personalised entry checks currently support Japanese passports only. For other passports, use the destination's official guidance.",
    beforeBooked: "Planned as booked — check your voucher and entry method",
    beforeBookedAt: (time: string) => `Planned as booked for ${time} — check your voucher and entry method`,
    beforeWatch: "Sell-outs or queues reported — consider booking ahead or going first thing",
    print: "Print / PDF",
    printTitle: "Print or save the whole trip as one page (for offline use)",
    printBooked: "booked",
    printFooter: "Times are planning estimates. Reconfirm travel and opening hours locally. · Weather by Open-Meteo",
    legModes: "Travel mode for this leg. Tap to pin, tap again for automatic",
    move: { walk: "Walk", transit: "Train", taxi: "Taxi" },
    minutes: (value: number) => `${value} min`,
    legLive: "Google route",
    unknown: "Not shown on the map",
    placeFallback: "Some places could not be found. The plan uses only the ones we could confirm.",
    noDays: "Nothing could be placed on the map yet. A slightly different name often helps.",
    openDay: "Nothing planned for this day yet",
    selectHint: "Tap a pin or a stop to open details",
    // Copy Deck plan.reco.meal (verbatim): the meal recommendation label line.
    mealIdeas: "Best fit for this route",
    // Copy Deck plan.reco.gap: the inline gap suggestion label (minutes parameterized).
    gapRecoLabel: (minutes: number) => `Fits your ${minutes}-minute gap`,
    // Copy Deck plan.reco.accept / plan.reco.replace.
    recoAccept: "Add this",
    recoAlternatives: "See alternatives",
    // Real walking detour from the slot's route position (≈80m/min).
    detourLine: (minutes: number) => `~${minutes} min from the route`,
    lunchChip: "Lunch",
    dinnerChip: "Dinner",
    foodLoading: "Finding nearby places…",
    foodUnavailable: "Places did not load. Open the same search in Google Maps instead.",
    maps: "View on map",
    foodNote: "Ranked by Google rating strength, review volume, distance and open status. Public social evidence is shown only when a cited page was found.",
    foodFresh: (count: number) => `${count} recent public signals`,
    // Copy Deck plan.hotel.change: the visible change-base control.
    hotelChip: "Change base",
    hotelPending: "Finding a base…",
    // Copy Deck plan.hotel.title.
    hotelCandidate: "Recommended base",
    // Copy Deck plan.hotel.effect: only shown for a real travel saving vs the
    // current base, measured on the really simulated candidate plan.
    hotelSavesTravel: (minutes: number) => {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      const duration = hours > 0 ? `${hours}h${rest > 0 ? ` ${rest}m` : ""}` : `${rest}m`;
      return `Saves ${duration} of travel`;
    },
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
    styleNote: "Reference prices are dateless and availability is unknown, so they do not determine a value winner.",
    hotelRankNote: "Every day gets one equal vote. Hotels with a lower average and worst-day straight-line distance rank higher, then Google rating and review strength are added. Confirm actual travel time on the mapped routes.",
    hotelCompareHeading: "Compare picks — tap to switch",
    priceUnlisted: "No listed price",
    rakutenTag: (average: number, count: number) => `Rakuten Travel ★${average.toFixed(1)} (${count.toLocaleString("en-US")})`,
    hotelPriceNote: "¥ prices are Rakuten Travel's reference minimum (dateless).",
    hotelReasonTop: "Top combined score for whole-trip access, rating and review strength.",
    hotelReasonNearest: "Lowest distance burden across each day's destinations.",
    hotelReasonRated: "Highest Google rating among candidates backed by at least 50 reviews.",
    hotelReasonValue: "A reference price is shown, but TripCheck does not call it best value without dated availability.",
    hotelReasonSpecified: "This matches the hotel you entered and is also used as the route's start and end base.",
    hotelReasonPicked: "Your pick from the alternatives.",
    hotelPurposeHeading: "What matters most?",
    hotelPurposeBalanced: "Overall",
    hotelPurposeNearest: "Less travel",
    hotelPurposeRated: "Top rated",
    hotelPurposeHelp: "Compare total travel and rating here; confirm price and availability with a booking provider.",
    axisOverall: "Overall pick",
    axisNearest: "Least travel",
    axisTopRated: "Top rated",
    distanceFrom: (distance: string) => `~${distance} straight-line average`,
    hotelWideTrip: "Your destinations cover a wide area. One hotel still leaves a long travel day; changing hotels nightly will be easier.",
    useThisHotel: "Switch to this hotel",
    tonightHotel: (name: string) => `Tonight · ${name}`,
    publicSources: "Public social and article sources",
    reservation: "Booked",
    timePinned: "Timed",
    lateBy: (minutes: number) => `Runs about ${minutes} min past the set time`,
    lateShort: (minutes: number) => `${minutes} min late`,
    must: "Must",
    optional: "Optional",
    stayLabel: "Stay",
    stayAuto: "Auto",
    dayStart: "Start time",
    dayEnd: "End time",
    dayTabsLabel: "Choose a day",
    dayTimelineLabel: (day: string) => `${day} itinerary`,
    dayBreakdownLabel: "Day time breakdown",
    dayWindowLabel: "Day window",
    dayPlannedLabel: "Planned",
    dayAvailableLabel: "Available",
    dayTravelLabel: "Travel",
    // Copy Deck data.estimated (verbatim headline); the provider detail is
    // secondary text, never the headline.
    estimated: "Travel time is estimated",
    estimatedDetail: "Legs update automatically only where Google Maps route data is available.",
    // Copy Deck data.checkhours (verbatim): the standard unverified-hours phrasing.
    checkHours: "Check opening hours before you go",
    // Copy Deck scope.beta (verbatim): shown only for non-deep coverage regions.
    betaRegion: "Beta coverage in this region",
    // TC-062 scope warnings (terms: border crossings, multiple time zones and
    // ferries are unsupported). One short honest line per triggered case, each
    // naming a safe next step (spec QA-050); planning is never blocked.
    scopeBorder: "This trip crosses a national border, so accuracy drops. Confirm cross-border legs on official sites.",
    scopeTimezone: "This trip spans more than one time zone. Confirm each time in the local zone.",
    scopeFerry: "Ferry legs are outside TripCheck's scope. Confirm sailing times on the official site.",
    // Copy Deck share.warning (verbatim primary line); the nuance stays secondary.
    shareWarning: "Anyone with the full link can view this trip",
    shareWarningDetail: "The link itself contains the trip data. Recipients, browser history and extensions can read it. Do not post it publicly.",
    // TC-052 §9.3 sheet-size controls: explicit buttons, never drag-only.
    sheetExpand: "Expand sheet",
    sheetShrink: "Back to half height",
    sheetMinimize: "Minimize sheet",
    sheetPeekOpen: "Open the sheet",
    openingAdjusted: "Timed to verified opening hours",
    openingConflict: "Recheck opening hours and booking time",
    openingClosedDay: "Likely closed this day — consider moving it",
    excludedHeading: "Left out of this plan",
    excludedClosed: "closed or hours don't fit",
    excludedPace: "optional stop beyond this pace",
    overCapacity: "Some days hold more than this pace fits. Add a day or trim optional stops.",
    fitSelectedDays: "Change days and recalculate",
    fitDaysValue: (days: number) => `${days} day${days === 1 ? "" : "s"}`,
    fitDaysDecrease: "Make this trip one day shorter",
    fitDaysIncrease: "Add one day to this trip",
    walkingSafety: "Walking routes are beta. Check real-world safety conditions.",
    deadlineOver: (time: string) => `Runs past the ${time} airport cutoff`,
    language: "Language",
    // Copy Deck privacy.short, verbatim. The chip is an auto-width flex item
    // in the header row, so the full sentence fits; the mobile breakpoint
    // hides the label entirely. The "no account" fact rides in the link's
    // title/aria-label and the policy page carries the full statement.
    privacy: "Your recent plans stay on this device",
    privacyTitle: "No account needed · Your recent plans stay on this device · Privacy policy",
    resolveRemove: "Remove",
    resolveRemoveAria: (name: string) => `Remove “${name}” from the list`,
    manualAddressResolving: "Checking that address…",
    manualAddressNotFound: "We couldn't find that address",
    fieldCheck: "Check recent public sources too",
    fieldChecking: "Checking…",
    fieldChecked: "Public sources checked",
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

export function legModeLabel(mode: TransportMode, locale: PlannerLocale) {
  return ui[locale].move[mode];
}

export function printTransferCopy(
  leg: BuiltTripPlan["days"][number]["legs"][number],
  maxTransfers: number,
  locale: PlannerLocale,
) {
  if (leg.comparison.recommended.mode !== "transit") return "";
  if (leg.transferCount === null) return locale === "ja" ? " · 乗換回数 未確認" : " · transfers unverified";
  const count = locale === "ja"
    ? `乗換${leg.transferCount}回`
    : `${leg.transferCount} transfer${leg.transferCount === 1 ? "" : "s"}`;
  const excess = Math.max(0, leg.transferCount - maxTransfers);
  if (excess === 0) return ` · ${count}`;
  return locale === "ja" ? ` · ${count}（上限+${excess}回）` : ` · ${count} (limit +${excess})`;
}

// v1.1 spec §5.4 state copy: a conclusion in the traveller's language, never
// an internal state name. Reasons and the one next action live beside it.
// Copy Deck plan.state.conditional/infeasible: the conditional headline names
// the real check count when one exists (matching the issue chip) and the
// infeasible headline says what has to move. With assumptions but nothing
// countable to check, the assumptions phrasing stays — no fabricated counts.
export function feasibilityStateCopy(
  state: FeasibilityState,
  locale: PlannerLocale,
  days: number,
  stops: number,
  unplacedCount = 0,
  checkCount = 0,
  unknownCause: FeasibilityUnknownCause | null = null,
) {
  // TC-004: UNKNOWN has two causes and they need two different sentences. The
  // default headline asks the traveller to confirm a place — useless advice
  // when every place resolved and the solver simply ran out of budget, whose
  // one action is to shorten the list.
  if (state === "UNKNOWN" && unknownCause === "COMPUTATION_LIMIT") {
    return locale === "ja"
      ? { label: "計算上限", headline: "場所が多く、計算しきれませんでした" }
      : { label: "Too many places", headline: "There were too many places to finish the calculation" };
  }
  if (locale === "ja") {
    if (state === "VERIFIED_FEASIBLE") return { label: `全${stops}か所`, headline: `${days}日なら、無理なく回れます` };
    if (state === "PROVISIONAL_FEASIBLE") return { label: `全${stops}か所`, headline: `${days}日で回れそうです` };
    if (state === "FEASIBLE_IF_ASSUMPTIONS") {
      return checkCount > 0
        ? { label: "条件付き", headline: `${days}日で回れます。${checkCount}か所だけ確認が必要です` }
        : { label: "条件付き", headline: `この条件なら${days}日で回れます` };
    }
    if (state === "INFEASIBLE_HARD_CONFLICT") {
      return unplacedCount > 0
        ? { label: "要修正", headline: `${days}日だと${unplacedCount}か所外す必要があります` }
        : { label: "要修正", headline: "このままだと予約・時間に間に合いません" };
    }
    return { label: "確認待ち", headline: "場所を確認すると完成します" };
  }
  if (state === "VERIFIED_FEASIBLE") return { label: `${stops} places`, headline: `This works comfortably in ${days} day${days === 1 ? "" : "s"}` };
  if (state === "PROVISIONAL_FEASIBLE") return { label: `${stops} places`, headline: `This should work in ${days} day${days === 1 ? "" : "s"}` };
  if (state === "FEASIBLE_IF_ASSUMPTIONS") {
    return checkCount > 0
      ? { label: "Conditional", headline: `This works in ${days} day${days === 1 ? "" : "s"}, with ${checkCount} detail${checkCount === 1 ? "" : "s"} to check` }
      : { label: "Conditional", headline: `This works in ${days} day${days === 1 ? "" : "s"} with these assumptions` };
  }
  if (state === "INFEASIBLE_HARD_CONFLICT") {
    return unplacedCount > 0
      ? { label: "Needs a change", headline: `In ${days} day${days === 1 ? "" : "s"}, ${unplacedCount === 1 ? "one stop needs" : `${unplacedCount} stops need`} to move or be removed` }
      : { label: "Needs a change", headline: "A booking or time constraint cannot be met as planned" };
  }
  return { label: "Almost there", headline: "Confirm the places to finish the plan" };
}

export function conflictCopy(conflict: Conflict, locale: PlannerLocale) {
  const item = conflict.affectedItems[0] ?? (locale === "ja" ? "この予定" : "This plan");
  const minutes = conflict.overrunMinutes ?? 0;
  if (locale === "ja") {
    if (conflict.code === "AIRPORT_CUTOFF") return `${item}を含む日程が、空港へ向かう締切を${minutes}分超えます。`;
    if (conflict.code === "FIXED_BOOKING_LATE") return `${item}の予約時刻に約${minutes}分遅れます。`;
    if (conflict.code === "CLOSED_ON_FIXED_DAY") return `${item}は固定した日に営業していない可能性があります。`;
    if (conflict.code === "OPENING_HOURS_CONFLICT") return `${item}の営業時間内に滞在を収められません。`;
    if (conflict.code === "LAST_ENTRY_CONFLICT") return `${item}の到着が、指定した最終入場時刻を過ぎます。`;
    if (conflict.code === "PLACE_UNAVAILABLE") return `${item}を現在の日付・営業時間では配置できません。`;
    if (conflict.code === "DAY_END_OVERRUN") return `${item}の日程が終了時刻を${minutes}分超えます。`;
    return `${item}の日程が利用できる時間を${minutes}分超えます。`;
  }
  if (conflict.code === "AIRPORT_CUTOFF") return `The day containing ${item} runs ${minutes} minutes past the airport cutoff.`;
  if (conflict.code === "FIXED_BOOKING_LATE") return `The plan reaches ${item} about ${minutes} minutes after its booking time.`;
  if (conflict.code === "CLOSED_ON_FIXED_DAY") return `${item} may be closed on its fixed day.`;
  if (conflict.code === "OPENING_HOURS_CONFLICT") return `${item} cannot fit inside its available opening window.`;
  if (conflict.code === "LAST_ENTRY_CONFLICT") return `The plan reaches ${item} after its specified last-entry cutoff.`;
  if (conflict.code === "PLACE_UNAVAILABLE") return `${item} could not be placed on any available day.`;
  if (conflict.code === "DAY_END_OVERRUN") return `The day containing ${item} runs ${minutes} minutes past its end time.`;
  return `The day containing ${item} exceeds its usable time by ${minutes} minutes.`;
}

export function attentionCopy(attention: Attention, locale: PlannerLocale) {
  if (attention.code === "TRANSIT_NON_CONVERGED") return locale === "ja"
    ? "公共交通の時刻を反映した再計算が上限内に安定しませんでした。観測した最長時間を使った条件付き日程です。"
    : "The transit-timed replan did not stabilize within the safety limit. This conditional schedule uses the longest observed durations.";
  if (attention.code === "WALKING_LIMIT_EXCEEDED") return locale === "ja"
    ? `${attention.affectedItems.join(" → ")}の徒歩が設定上限を${attention.minutes ?? 0}分超えます。移動手段を変更してください。`
    : `Walking ${attention.affectedItems.join(" → ")} exceeds your per-leg limit by ${attention.minutes ?? 0} minutes. Choose another mode.`;
  if (attention.code === "TRANSFER_LIMIT_EXCEEDED") return locale === "ja"
    ? `${attention.affectedItems.join(" → ")}は乗換${attention.transferCount ?? "?"}回で、設定上限${attention.transferLimit ?? "?"}回を超えます。固定条件を守ったまま、別の移動手段も比較してください。`
    : `${attention.affectedItems.join(" → ")} needs ${attention.transferCount ?? "?"} transfers, above your limit of ${attention.transferLimit ?? "?"}. Compare another mode without silently changing a locked choice.`;
  if (attention.code === "LOW_BUFFER") return locale === "ja"
    ? `${attention.affectedItems[0]}の余白は${attention.minutes ?? 0}分です。遅れが出ると次の予定へ影響します。`
    : `${attention.affectedItems[0]} has ${attention.minutes ?? 0} minutes of buffer. A delay can affect the next stop.`;
  // UI/UX v3.1 §2.1 Tier C: this used to be a tally — 「未確認の重要情報が10件」 —
  // sitting above a things-to-check card that counted the same concern as 2,
  // because one counts facts and the other counts actions. Two numbers for one
  // worry, and neither is something a traveller can do. The warning names the
  // first place instead; the card below still lists them all and can act.
  // Naming the item is what makes the line actionable, and it also lets the
  // sentence drop the 「営業時間・拠点など」 preamble: which kind of fact is
  // unverified is in the things-to-check card, next to the button that opens
  // it. What belongs here is the place and the fact that it wants a look.
  const first = attention.affectedItems[0] ?? "";
  const andOthers = attention.affectedItems.length > 1;
  return locale === "ja"
    ? `${first}${andOthers ? "ほか" : ""}は出発前の確認が必要です。`
    : `${first}${andOthers ? " and others" : ""} need a check before you go.`;
}

export function assumptionCopy(assumption: Assumption, locale: PlannerLocale) {
  const labels = locale === "ja" ? {
    DATE_PROVISIONAL: "旅行日は仮の日付",
    BASE_UNKNOWN: "ホテル・拠点は未指定",
    DAY_START_DEFAULT: "各日の開始時刻は初期値を使用",
    DAY_END_DEFAULT: "1日の終了は22:00と仮定",
    STAY_DURATION_ESTIMATED: `滞在時間${assumption.count}件は推定`,
    ROUTE_ESTIMATED: `移動${assumption.count}区間は推定`,
    OPENING_HOURS_UNKNOWN: `営業時間${assumption.count}件は未確認`,
    LAST_ENTRY_ESTIMATED: `最終入場${assumption.count}件は推定`,
    AIRPORT_TRANSFER_ESTIMATED: `空港の手続き・市内移動${assumption.count}件は推定`,
    TRANSFER_BUFFER: "各移動後に選択した乗換・道迷い余白を加算",
    WALKING_LIMIT_DEFAULT: "1区間の徒歩上限は標準30分を使用",
    TRANSFER_LIMIT_DEFAULT: "1区間の乗換上限は標準2回を使用",
    TRANSFER_COUNT_UNKNOWN: `乗換回数${assumption.count}区間は提供元から未取得`,
    TRANSIT_NON_CONVERGED: "時刻別の公共交通経路データを反映した日程が反復上限内に安定せず、取得できた最長時間を使用",
  } : {
    DATE_PROVISIONAL: "The trip date is provisional",
    BASE_UNKNOWN: "No hotel or base is confirmed",
    DAY_START_DEFAULT: "Day start times use the current default",
    DAY_END_DEFAULT: "Days are assumed to end at 22:00",
    STAY_DURATION_ESTIMATED: `${assumption.count} stay durations are estimated`,
    ROUTE_ESTIMATED: `${assumption.count} route legs are estimated`,
    OPENING_HOURS_UNKNOWN: `${assumption.count} opening-hour facts are unverified`,
    LAST_ENTRY_ESTIMATED: `${assumption.count} last-entry cutoffs are estimated`,
    AIRPORT_TRANSFER_ESTIMATED: `${assumption.count} airport processing or transfer times are estimated`,
    TRANSFER_BUFFER: "The selected wayfinding buffer is added after every travelled leg",
    WALKING_LIMIT_DEFAULT: "The standard 30-minute per-leg walking limit is used",
    TRANSFER_LIMIT_DEFAULT: "The standard limit of 2 transfers per leg is used",
    TRANSFER_COUNT_UNKNOWN: `Transfer counts are unavailable for ${assumption.count} route legs`,
    TRANSIT_NON_CONVERGED: "The transit-timed itinerary did not stabilize within the bounded loop, so it uses the longest observed durations",
  };
  return labels[assumption.code];
}

export function alternativeCopy(alternative: AlternativePlan, locale: PlannerLocale) {
  const improvement = [
    alternative.improvement.hardConflictsRemoved > 0
      ? locale === "ja" ? `固定衝突-${alternative.improvement.hardConflictsRemoved}` : `${alternative.improvement.hardConflictsRemoved} hard conflict${alternative.improvement.hardConflictsRemoved === 1 ? "" : "s"} removed`
      : null,
    alternative.improvement.overrunMinutesReduced > 0
      ? locale === "ja" ? `超過-${alternative.improvement.overrunMinutesReduced}分` : `${alternative.improvement.overrunMinutesReduced} min less overrun`
      : null,
    (alternative.improvement.slackMinutesGained ?? 0) > 0
      ? locale === "ja" ? `最小余白+${alternative.improvement.slackMinutesGained}分` : `+${alternative.improvement.slackMinutesGained} min minimum slack`
      : null,
    alternative.improvement.travelMinutesReduced > 0
      ? locale === "ja" ? `移動-${alternative.improvement.travelMinutesReduced}分` : `${alternative.improvement.travelMinutesReduced} min less travel`
      : null,
  ].filter(Boolean).join(" · ");
  if (alternative.kind === "CHANGE_DAYS") {
    const days = alternative.change.days ?? alternative.after.dayCount;
    const dayDelta = alternative.change.dayDelta ?? days - alternative.before.dayCount;
    return locale === "ja"
      ? { title: `${days}日案を比較`, detail: `${dayDelta > 0 ? `${dayDelta}日追加` : `${Math.abs(dayDelta)}日短縮`}${improvement ? ` · ${improvement}` : ""}` }
      : { title: `Compare a ${days}-day plan`, detail: `${dayDelta > 0 ? `Add ${dayDelta} day${dayDelta === 1 ? "" : "s"}` : `Use ${Math.abs(dayDelta)} fewer day${Math.abs(dayDelta) === 1 ? "" : "s"}`}${improvement ? ` · ${improvement}` : ""}` };
  }
  if (alternative.kind === "START_EARLIER") return locale === "ja"
    ? { title: `${alternative.change.minutes ?? 60}分早く始める`, detail: improvement }
    : { title: `Start ${alternative.change.minutes ?? 60} minutes earlier`, detail: improvement };
  if (alternative.kind === "END_LATER") return locale === "ja"
    ? { title: `${alternative.change.minutes ?? 60}分遅く終える`, detail: improvement }
    : { title: `Finish ${alternative.change.minutes ?? 60} minutes later`, detail: improvement };
  if (alternative.kind === "CHANGE_BASE") return locale === "ja"
    ? { title: `拠点を${alternative.change.baseName ?? "候補"}に変更`, detail: improvement }
    : { title: `Use ${alternative.change.baseName ?? "the suggested base"}`, detail: improvement };
  if (alternative.kind === "CHANGE_MODE") {
    const from = alternative.change.fromName ?? (locale === "ja" ? "出発地" : "the first stop");
    const to = alternative.change.toName ?? (locale === "ja" ? "到着地" : "the next stop");
    const mode = alternative.change.mode
      ? locale === "ja"
        ? { walk: "徒歩", transit: "公共交通", taxi: "タクシー" }[alternative.change.mode]
        : { walk: "walking", transit: "transit", taxi: "taxi" }[alternative.change.mode]
      : locale === "ja" ? "別の移動手段" : "another mode";
    const tradeoff = alternative.change.mode === "taxi"
      ? locale === "ja" ? "所要時間を短縮できますが、運賃が増えます" : "Saves time but adds a fare"
      : alternative.change.mode === "walk"
        ? locale === "ja" ? "運賃を抑えられますが、歩行負荷が増えます" : "Avoids a fare but adds walking effort"
        : locale === "ja" ? "乗換や待ち時間が発生する場合があります" : "May add transfers or waiting time";
    return locale === "ja"
      ? { title: `${from} → ${to}を${mode}に変更`, detail: `${tradeoff}${improvement ? ` · ${improvement}` : ""}` }
      : { title: `Use ${mode} from ${from} to ${to}`, detail: `${tradeoff}${improvement ? ` · ${improvement}` : ""}` };
  }
  if (alternative.kind === "OPTIMIZE_ORDER") return locale === "ja"
    ? { title: "日ごとの移動を減らす順番にする", detail: `元の日別割当と固定条件を守り、行順だけを解放${improvement ? ` · ${improvement}` : ""}` }
    : { title: "Use a lower-travel order", detail: `Keeps day assignments and fixed constraints, while releasing pasted line order${improvement ? ` · ${improvement}` : ""}` };
  const stopName = alternative.change.stopName ?? alternative.loss?.stopName ?? "Optional";
  const stayMinutes = alternative.loss?.stayMinutes ?? 0;
  return locale === "ja"
    ? { title: `${stopName}を外して比較`, detail: `失うもの: ${stopName}（滞在${stayMinutes}分）${improvement ? ` · ${improvement}` : ""}` }
    : { title: `Compare without ${stopName}`, detail: `Trade-off: lose ${stopName} (${stayMinutes} min)${improvement ? ` · ${improvement}` : ""}` };
}

export function alternativeLossCopy(alternative: AlternativePlan, locale: PlannerLocale) {
  if (!alternative.loss) return null;
  if (alternative.loss.kind === "ORIGINAL_ORDER") return locale === "ja"
    ? "失うもの: 入力した行順。日別割当、予約、固定時刻、固定した移動手段は維持します。"
    : "Trade-off: release the pasted line order. Day assignments, bookings, fixed times and locked modes stay protected.";
  if (alternative.loss.kind === "TRANSPORT_TRADEOFF") {
    const mode = alternative.loss.mode
      ? locale === "ja"
        ? { walk: "徒歩", transit: "公共交通", taxi: "タクシー" }[alternative.loss.mode]
        : { walk: "walking", transit: "transit", taxi: "taxi" }[alternative.loss.mode]
      : locale === "ja" ? "別の移動手段" : "another mode";
    return locale === "ja"
      ? `交換条件: ${mode}に固定すると、費用・歩行・乗換の負担が変わります。`
      : `Trade-off: locking ${mode} changes fare, walking effort, or transfer load.`;
  }
  const stopName = alternative.loss.stopName ?? alternative.change.stopName ?? "Optional";
  return locale === "ja" ? `失うもの: ${stopName}` : `Trade-off: remove ${stopName}`;
}

// v1.1 TC-007 hard-edit confirmations: every guarded edit shares these
// sentences, so the dialog reads the same whether the change came from a leg
// mode, a stay time, a last-entry cutoff or a day window.
export type HardEditConflictKind =
  | "booking_late"
  | "must_drop"
  | "airport_cutoff"
  | "day_end_missed"
  | "opening_closed"
  | "last_entry_missed";

export function hardEditConflictSentence(
  kind: HardEditConflictKind,
  name: string,
  minutes: number,
  locale: PlannerLocale,
) {
  if (kind === "booking_late") return locale === "ja"
    ? `「${name}」の予約に${minutes}分遅れます`
    : `You would be ${minutes} minutes late for “${name}”`;
  if (kind === "must_drop") return locale === "ja"
    ? `必須の「${name}」が日程に入らなくなります`
    : `Must-visit “${name}” would no longer fit the plan`;
  // A day-end target and an airport cutoff are different promises. They used
  // to share one sentence and one running total, so an airport breach could be
  // hidden by an unrelated curfew improvement — and a curfew breach was
  // announced as a missed flight.
  if (kind === "day_end_missed") return locale === "ja"
    ? `その日の終了時刻を${minutes}分超えます`
    : `That day would run ${minutes} minutes past its end time`;
  if (kind === "opening_closed") return locale === "ja"
    ? `「${name}」の営業時間から外れます`
    : `“${name}” would fall outside its opening hours`;
  if (kind === "last_entry_missed") return locale === "ja"
    ? `「${name}」の最終入場に間に合わなくなります`
    : `You would arrive after the last entry for “${name}”`;
  return locale === "ja"
    ? `空港へ向かう締切を${minutes}分超えます`
    : `The airport cutoff would be missed by ${minutes} minutes`;
}

// Copy Deck confirm.delay.title: when the only new damage is a single booking
// delay, the dialog title states the delay itself.
export function hardEditBookingDelayTitle(minutes: number, locale: PlannerLocale) {
  return locale === "ja"
    ? `この変更で予約に${minutes}分遅れます`
    : `This change makes you ${minutes} minutes late`;
}

export const hardEditTitles = {
  ja: {
    legMode: (mode: string) => `この区間の移動を${mode}に変更しますか？`,
    legModeAuto: "この区間の移動手段を自動に戻しますか？",
    stayMinutes: (name: string, minutes: number) => `「${name}」の滞在時間を${minutes}分にしますか？`,
    stayMinutesAuto: (name: string) => `「${name}」の滞在時間を自動に戻しますか？`,
    lastEntry: (name: string, time: string) => `「${name}」の最終入場を${time}にしますか？`,
    lastEntryClear: (name: string) => `「${name}」の最終入場指定を外しますか？`,
    dayStart: (day: number, time: string) => `${day}日目の開始を${time}にしますか？`,
    dayStartAuto: (day: number) => `${day}日目の開始時刻を標準に戻しますか？`,
    dayEnd: (day: number, time: string) => `${day}日目の終了を${time}にしますか？`,
    dayEndAuto: (day: number) => `${day}日目の終了時刻を標準に戻しますか？`,
    restoreStop: (name: string) => `「${name}」を予定に戻しますか？`,
    startEarlier: (minutes: number) => `全日程の開始を${minutes}分早めますか？`,
    endLater: (minutes: number) => `全日程の終了を${minutes}分遅らせますか？`,
    optimizeOrder: "各日の回る順番を並べ替えますか？",
  },
  en: {
    legMode: (mode: string) => `Change this leg to ${mode}?`,
    legModeAuto: "Return this leg to automatic mode?",
    stayMinutes: (name: string, minutes: number) => `Set the stay at “${name}” to ${minutes} minutes?`,
    stayMinutesAuto: (name: string) => `Return the stay at “${name}” to automatic?`,
    lastEntry: (name: string, time: string) => `Set the last entry for “${name}” to ${time}?`,
    lastEntryClear: (name: string) => `Clear the last-entry time for “${name}”?`,
    dayStart: (day: number, time: string) => `Start day ${day} at ${time}?`,
    dayStartAuto: (day: number) => `Return day ${day} to the standard start time?`,
    dayEnd: (day: number, time: string) => `End day ${day} at ${time}?`,
    dayEndAuto: (day: number) => `Return day ${day} to the standard end time?`,
    restoreStop: (name: string) => `Put “${name}” back into the plan?`,
    startEarlier: (minutes: number) => `Start every day ${minutes} minutes earlier?`,
    endLater: (minutes: number) => `End every day ${minutes} minutes later?`,
    optimizeOrder: "Reorder the stops on each day?",
  },
} as const;

// Copy Deck toast.changed / TC-048: recommendation cards and edit toasts
// report at most two impact metrics — the travel-minute delta and the buffer
// (余裕) change — both measured on a really simulated candidate plan, never
// guessed. The toast's single metric is the buffer change.
export function travelDeltaLine(deltaMinutes: number, locale: PlannerLocale) {
  const sign = deltaMinutes > 0 ? "+" : deltaMinutes < 0 ? "−" : "±";
  const minutes = Math.abs(deltaMinutes);
  return locale === "ja" ? `移動 ${sign}${minutes}分` : `travel ${sign}${minutes} min`;
}

export function bufferDeltaLine(deltaMinutes: number, locale: PlannerLocale) {
  const sign = deltaMinutes > 0 ? "+" : deltaMinutes < 0 ? "−" : "±";
  const minutes = Math.abs(deltaMinutes);
  return locale === "ja" ? `余裕 ${sign}${minutes}分` : `${sign}${minutes}m buffer`;
}

/** A zero delta shows no metric at all rather than a fabricated "±0". */
export function bufferToastDetail(deltaMinutes: number, locale: PlannerLocale) {
  return deltaMinutes === 0 ? null : bufferDeltaLine(deltaMinutes, locale);
}

export function minimumDaysCopy(result: FeasibilityResult, locale: PlannerLocale) {
  if (result.minimumDays === null) {
    // Name the ONE actual blocker and its one next action instead of reciting
    // every theoretical cause (v1.1 TC-004).
    const unresolved = result.unresolvedPlaceNames;
    if (unresolved.length > 0) {
      const names = unresolved.slice(0, 2).join(locale === "ja" ? "・" : ", ")
        + (unresolved.length > 2 ? (locale === "ja" ? ` 他${unresolved.length - 2}件` : ` +${unresolved.length - 2} more`) : "");
      if (result.partialMinimumDays !== null) {
        return locale === "ja"
          ? `「${names}」が未確定のため、確認が終わるまで結論を出しません。確定済みの場所だけなら最短${result.partialMinimumDays}日です。上の「確認する」から場所を確定してください。`
          : `On hold because “${names}” is not settled yet. The confirmed places alone need at least ${result.partialMinimumDays} day${result.partialMinimumDays === 1 ? "" : "s"}. Use “Confirm” above to settle the place.`;
      }
      return locale === "ja"
        ? `「${names}」が未確定のため、最短日数はまだ判定できません。上の「確認する」から場所を確定するか、入力を直してください。`
        : `Minimum days are withheld because “${names}” is not settled. Use “Confirm” above to pick the place, or edit the input.`;
    }
    // The computation cap is its own cause with its own action: shrinking the
    // candidate list, never a generic "something failed".
    if (result.unknownCause === "COMPUTATION_LIMIT") return locale === "ja"
      ? "計算の上限に達したため、最短日数を判定できませんでした。場所を15件以下にしてください。"
      : "The computation limit was reached before minimum days could be settled. Remove optional places to bring the list to 15 or fewer.";
    if (result.searchedThroughDays > 0) return locale === "ja"
      ? `${result.searchedThroughDays}日まで探索しましたが、固定条件が競合して収まりませんでした。予約・時間指定の固定条件を1つ見直してください。`
      : `Searched through ${result.searchedThroughDays} days, but a fixed constraint still conflicts. Revisit one booked or fixed-time constraint.`;
    if (result.partialMinimumDays !== null || result.conflicts.some((conflict) => conflict.code === "PLACE_UNAVAILABLE")) {
      return locale === "ja"
        ? `選んだ日程では営業しない場所があるため、確認が終わるまで結論を出しません。${result.partialMinimumDays !== null ? `配置できる場所だけなら最短${result.partialMinimumDays}日です。` : ""}「予定から外した場所」を確認してください。`
        : `On hold because some places cannot open on the chosen days. ${result.partialMinimumDays !== null ? `The placeable stops alone need at least ${result.partialMinimumDays} day${result.partialMinimumDays === 1 ? "" : "s"}. ` : ""}Review the places left out of this plan.`;
    }
    return locale === "ja"
      ? "14日を超える日指定があるため、最短日数はまだ判定していません。日指定を14日以内へ直してください。"
      : "Minimum days are withheld because a day pin is beyond the supported range. Move day pins within 14 days.";
  }
  const assumptions = result.minimumDaysAssumptions;
  const windows = assumptions.dayWindows.map((window) => `${window.start}–${window.end}`);
  const uniqueWindows = [...new Set(windows)];
  const windowCopy = uniqueWindows.length === 1
    ? uniqueWindows[0]
    : locale === "ja" ? `${windows.length}日それぞれの時間枠` : `the ${windows.length} per-day time windows`;
  const base = assumptions.base.name ?? (locale === "ja" ? "仮の拠点" : "the provisional base");
  const stayCount = assumptions.stayDurations.length;
  return locale === "ja"
    ? `${windowCopy}・拠点「${base}」・${stayCount}件の滞在時間・移動ごと${assumptions.transferBufferMinutes}分の余白では、最短${result.minimumDays}日です。`
    : `With ${windowCopy}, base “${base}”, ${stayCount} stay durations and ${assumptions.transferBufferMinutes}-minute leg buffers, the minimum is ${result.minimumDays} day${result.minimumDays === 1 ? "" : "s"}.`;
}
