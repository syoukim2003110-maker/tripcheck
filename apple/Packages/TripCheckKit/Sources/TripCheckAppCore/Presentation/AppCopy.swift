import Foundation
import TripCheckKit

/*
 * アプリだけが要る文言。
 *
 * 旅行者が読む文の大半は Kit の `PlannerCopy`(`Copy.for(locale)`)にある —— Web と同じ 267
 * キーで、TS のキー一覧とのパリティがテストされている。**そこには鍵を足さない。** 画面の
 * 見出し・タブ名・確認の問いかけのように iPhone にしか無いものだけが、この表に入る。
 *
 * 値は Web に対応する文があればそのバイトを写す(出どころは `ja` の直前に残した)。無いもの
 * だけ新しく書く。ビューに日本語・英語の文リテラルを直書きしないための唯一の逃げ場なので、
 * Task 14 の走査テストはこのファイルを除外する代わりに、ここの ja/en 表を `BannedTerms` に
 * 通す。
 */
public struct AppCopy: Sendable {

  /// Start 画面の見出し。
  public let startTitle: String
  /// 入力欄のすぐ下の 1 行。
  public let startHelpShort: String
  /// 入力欄に薄く出る書きかけの例。
  public let placeFieldPlaceholder: String
  /// 入力欄の隣の「足す」ボタン(絵しか出ないので読み上げ用)。
  public let addPlaceLabel: String
  /// 端末の地図が候補を出せなかったときの 1 行。打った名前のままでも進める、と伝える。
  public let suggestionsUnavailable: String
  /// 1 回に扱える場所の上限に当たったときのトースト。
  public let placeLimitToast: String
  /// 優先度の「通常」。「必須」「任意」は Kit の `must` / `optional`。
  public let priorityNormal: String
  /// まとめて貼り付けるシートを開くボタン。シートの見出しも兼ねる。
  public let pasteText: String
  /// 貼り付け欄に薄く出る書きかけの例。Web の入力例(`PlacesStep.tsx:139-140`)そのまま。
  public let pastePlaceholder: String
  /// 貼った文字列を場所として読み取らせるボタンと、読み取れたものをリストへ足すボタン。
  public let pasteRead: String
  public let pasteAdd: String
  /// 行をタップすると開く編集シートの、読み上げ用の名前。
  public let editEntryAction: String
  /// 行編集シートの「行く日」と、日を決めないという選択肢。
  public let entryDayLabel: String
  public let entryDayAny: String
  /// 日数の見出しと、その選択肢。
  public let daysQuestion: String
  public let daysUndecided: String
  public let daysOther: String
  /// 「他の日数」の選択そのものの読み上げ名。
  public let daysOtherLabel: String
  /// 日数を「未定」にしたときの但し書き。
  public let daysUndecidedNote: String
  /// 日付を入れる折り畳みの見出しと、日付を消すボタン。
  public let dateDisclosure: String
  public let dateUndecided: String
  /// 行き先の国を先に選ぶと検索が正確になる、という但し書き。
  public let destinationHint: String
  /// 日数・ホテル・ペースなどの折り畳みの見出し。
  public let customDisclosure: String
  /// 画面下の主ボタン。押せる時・場所を調べている時・組んでいる時の 3 つ。
  public let buildCTA: String
  public let checkingPlacesCTA: String
  public let buildingCTA: String
  /// 結果画面の下タブ。
  public let timelineTab: String
  public let mapTab: String
  /// 地図が映す範囲のピル。
  public let mapScopeAll: String
  public let mapScopeDay: String
  /// そのピル 2 つをひとまとめに呼ぶ名前(読み上げ用。Task 8)。
  public let mapScopeLabel: String
  /// 地図のピンが耳に名乗る種別のうち、Kit の凡例に鍵が無いもの(Task 8)。予定地点と
  /// おすすめ地点は Kit の `legendAnchor` / `legendSuggestion` から来る —— 凡例と同じ語で
  /// 名乗るために、ここには**足さない**。
  public let mapPinHotel: String
  public let mapPinManual: String
  public let mapPinWarning: String

  // MARK: - 確認画面(Task 5)

  /// 確認画面の見出しと、そこから入力へ戻る 2 つの逃げ道(リスト全体・行 1 つ)。
  public let resolveTitle: String
  public let resolveEditInput: String
  public let resolveEditName: String
  /// 国が混ざったときの但し書きと、1 か国に収まらない旅のための選択。
  public let resolveCountryHint: String
  public let resolveWorldwide: String
  /// 候補のどれでもない、と言うためのボタン。押すと住所で指定する道へ移る。
  public let resolveNoneOfThese: String
  /// 4 件目以降の行に出す抑止の 1 文。
  public let resolveDeferred: String
  /// 見つからなかった行の 1 文と、そこから戻る 3 つの道。
  public let resolveNotFound: String
  public let resolveSearchAgain: String
  public let resolvePinOnMap: String
  /// 行頭の絵が意味するもの(絵は読み上げないので、これが読み上げられる)。
  public let resolveStatusConfirmed: String
  public let resolveStatusReview: String
  public let resolveStatusUnresolved: String
  /// 地図で自分の点を置くシート。
  public let manualAddressLabel: String
  public let manualLatitude: String
  public let manualLongitude: String
  public let manualUsePoint: String
  public let manualPinHint: String
  public let manualPinMapLabel: String
  /// 条件の折り畳みのうち、Kit に対応する鍵が無いもの。
  public let bufferHeading: String
  public let maxWalkingHeading: String
  public let maxWalkingNote: String
  public let maxWalkingDefault: String
  public let maxTransfersHeading: String
  public let maxTransfersNote: String
  public let maxTransfersDefault: String
  public let flightsDisclosure: String
  /// 空港の比較。数字はどれも TripCheck の見立てで、空港が示した事実ではない。
  public let airportCompareArrival: String
  public let airportCompareDeparture: String
  public let airportArrivalBoundary: String
  public let airportDepartureBoundary: String
  public let airportNextDay: String
  public let airportPreviousDay: String
  public let airportArrivalWinner: String
  public let airportDepartureWinner: String
  public let airportEstimate: String
  public let airportUse: String
  public let airportSelected: String
  public let airportDisclaimer: String
  /// 未解決の必須・予約を抱えたまま進もうとしたときの問いかけ。
  public let mustUnresolvedTitle: String
  public let mustUnresolvedContinue: String
  public let mustUnresolvedBack: String

  // MARK: - 結果画面(Task 6)

  /// 結論の警告 1 件に添えるボタンの文。Kit の `WarningAction` が持たない 3 つだけ ——
  /// 「入力を直す」は `resolveEditInput` を使い回す(同じ行き先・同じ一手)。
  public let chooseCountryAction: String
  public let chooseCandidateAction: String
  public let retryBuildAction: String
  /// 「旅程 | 地図」の切替そのものの読み上げ名(2 つの錠剤の親)。
  public let viewSwitchLabel: String
  /// 組み上がった旅程が 1 日も持たなかったときの 1 文。`Screen.error` の機械語ではなく、
  /// 旅行者が読む側。
  public let planErrorMessage: String

  /// 結論の詳細に出す差分表の見出し。Kit の `TripScenarioMetrics` の 6 欄と 1 対 1 で、
  /// **この並びが表の行順**になる(衝突・超過・移動・最小余白・訪問数・日数)。Web は
  /// 訪問数と日数を 1 行に詰めるが、iPhone の幅では 1 欄 1 行のほうが読める。
  public let diffLabels: [String]

  // MARK: - 編集(Task 9)

  /// 旅程を書き換えたときのトースト。**「何をしたか」だけを言う** —— どれだけ余裕が動いたかは
  /// Kit の `VerdictCopy.bufferToastDetail` が同じ行の後ろに足すので、ここで数を語らない。
  /// 出どころの違う編集(滞在時間・区間の手段・最終入場・日の窓)で別の文を用意しないのは、
  /// どれも旅行者が今まさに開いている欄そのものを変えた直後で、何を変えたかは目の前にあるから。
  public let editedToast: String
  /// 指定を外して自動に戻したときのトースト。上と対になる 1 対で、「決めた」と「任せた」を
  /// 言い分ける。
  public let revertedToast: String
  /// 拠点の指定を外したときのトーストと、その問いかけ。
  public let baseClearedToast: String
  public let clearBaseQuestion: String

  /// 停留所シートの外部リンク。Google 側は Kit の `openMaps` を使う(同じ文が Web にある)。
  public let openAppleMaps: String
  /// 「この場所の条件を変える」——滞在時間と最終入場の折り畳み。
  public let stopConditionsDisclosure: String
  /// 最終入場の欄。Kit の `PlannerCopy` に対応する鍵が無い。
  public let lastEntryLabel: String
  /// 日の設定シートの見出しと、既定の 3 択に無い時刻を自分で選ぶ選択肢。
  public let daySettingsTitle: String
  public let customTimeLabel: String
  /// 重い結果の出る編集を確かめるダイアログの 2 つのボタン。題は Kit の
  /// `PlannerEdits.confirmTitle` が決めるので、ここにあるのは返事だけ。
  public let hardEditConfirm: String
  public let hardEditCancel: String
  /// Undo / Redo と、それを収めるツールバーのメニュー。
  public let undoAction: String
  public let redoAction: String
  public let moreActions: String
  /// 元に戻した / やり直した後に読み上げる 1 文。**過去形**でなければならない ——
  /// ボタンの名前をそのまま読み上げると、これから起きることの告知に聞こえる。
  public let undoneAnnouncement: String
  public let redoneAnnouncement: String
  /// 根拠の行で、事実に中身が無いときに置く印。**空欄にしない** —— 空欄は「まだ読み込み中」
  /// にも読めるが、この印は「調べたが分からなかった」を意味する。
  public let evidenceNoValue: String
  /// 根拠の行が何についての事実かを言う語。Kit の `CriticalFact.label` は 4 種のどれでも
  /// 場所の名前なので、それだけでは同じ見出しが 2 度並ぶ。滞在時間は Kit の `stayLabel`、
  /// 最終入場は上の `lastEntryLabel` を使い、残り 2 つがここ。
  public let evidencePlaceLabel: String
  public let evidenceHoursLabel: String
  /// 訪問時刻が営業時間に収まっているときの 1 行。Kit の `opening*` は「ずれている」側の
  /// 3 つしか持たない。
  public let evidenceHoursOpen: String
  /// 事実の確かさのうち、Kit の `durationSourceLabel` が言い分けない 2 つ(`unknown` /
  /// `failed`)。**「推定」と呼ばない** —— 調べていない場所を見積もったことにしてしまう。
  public let evidenceStatusUnknown: String

  // MARK: - 課題カード・結論の詳細(Task 10)

  /// 「結論の詳細」の折り畳みの見出し。Web `VerdictDetails.tsx:71` と同じ 1 語。
  public let verdictDetailsTitle: String
  /// 重要情報の 3 つの数に添える語。Kit の `durationSourceLabel` は滞在時間の出どころを
  /// 言う語で、この 3 つは**事実の確かさ**なので別の表に置く。
  public let factVerified: String
  public let factEstimated: String
  public let factUnknown: String
  /// この地域をどこまで確かめてあるかの折り畳み。地域の名前と評価は Kit の
  /// `CoverageProfile` が持つので、ここにあるのは見出しだけ。
  public let coverageHeading: String
  /// 貼り付けた旅程だけが出す 3 枚の比較。**「元の案」は旅行者が書いたもの**で、
  /// 残る 2 枚がこちらの提案である。
  public let comparisonHeading: String
  public let comparisonOriginal: String
  public let comparisonOriginalDetail: String
  /// 2 枚目の題は結果で変わる —— 1 回の変更で成立するなら「最小修正版」、成立まで届かない
  /// なら「最小の改善案」。同じ題で両方を出すと、直りきらない案が直った案に見える。
  public let comparisonMinimalRepair: String
  public let comparisonMinimalImprovement: String
  public let comparisonShortest: String
  /// 提案が無いときの 1 行。**空欄にしない** —— 空欄は「まだ計算中」に読める。
  public let comparisonNoRepair: String
  public let comparisonNoRepairNeeded: String
  public let comparisonNoShortest: String
  /// 代替案の一覧の見出しと、差分表の 2 列の名前、適用のボタン。
  public let alternativesHeading: String
  public let diffBefore: String
  public let diffAfter: String
  public let applyAlternative: String
  /// 前提が 1 つも無いときの 1 行。
  public let assumptionsNone: String
  /// 旅程に入り切らなかったもの・1 日に収まらない日の見出し。
  public let attentionsHeading: String
  /// 旅券の国の錠剤に出す「未選択」。Kit の `passportUnset` は括弧書きの理由まで含む 1 文で、
  /// 3 つ並ぶ錠剤には長すぎる —— 錠剤には短い名前を出し、**理由の 1 文は錠剤の下に**残す。
  public let passportUnsetShort: String

  // MARK: - 保存・最近の旅程(Task 11)

  /// 組んだ旅程が手元にあるときだけ出る、入力から戻る道。
  public let backToPlan: String
  /// 端末に残っている旅程の見出しと、その 1 件に対する 2 つの操作。
  public let recentTripsTitle: String
  public let openTripAction: String
  public let deleteTripAction: String
  /// 端末に残せないときの 1 行。**「保存に失敗しました」とは言わない** —— 旅行者に要るのは
  /// 何が起きたかではなく、この先どうなるか(アプリを閉じると消える)である。
  public let storageUnavailableNote: String

  private let pasteLimitToastText: @Sendable (Int) -> String
  private let daysValueText: @Sendable (Int) -> String
  private let priorityLabelText: @Sendable (String) -> String
  private let removeStopQuestionText: @Sendable (String) -> String
  private let mustRemovalNoteText: @Sendable (String) -> String
  private let reservationRemovalNoteText: @Sendable (String) -> String
  private let removedStopToastText: @Sendable (String) -> String
  private let resolveAllConfirmedText: @Sendable (Int) -> String
  private let resolveCountryConflictText: @Sendable ([String]) -> String
  private let resolveCandidateQuestionText: @Sendable (String) -> String
  private let resolveCandidatesLabelText: @Sendable (String) -> String
  private let resolveUnresolvedCountText: @Sendable (Int) -> String
  private let resolveAmbiguousCountText: @Sendable (Int) -> String
  private let resolveContinueText: @Sendable (Int) -> String
  private let minutesShortText: @Sendable (Int) -> String
  private let airportArrivalBreakdownText: @Sendable (Int, Int) -> String
  private let airportDepartureBreakdownText: @Sendable (Int, Int) -> String
  private let mustUnresolvedBodyText: @Sendable ([String]) -> String
  private let planUnresolvedWarningText: @Sendable ([String]) -> String
  private let planAmbiguousWarningText: @Sendable ([String]) -> String
  private let planDeferredAnchorsText: @Sendable ([String]) -> String
  private let dayTimeBarLabelText: @Sendable (String, String, String, String, Int, Int) -> String
  private let hotelLegDepartText: @Sendable (String) -> String
  private let hotelLegReturnText: @Sendable (String) -> String
  private let mapPinLabelText: @Sendable (String, String) -> String
  private let restoredStopToastText: @Sendable (String) -> String
  private let movedToDayToastText: @Sendable (Int) -> String
  private let tripDaysToastText: @Sendable (Int) -> String
  private let baseSetToastText: @Sendable (String) -> String
  private let moveStopQuestionText: @Sendable (String, Int) -> String
  private let moveStopAutoQuestionText: @Sendable (String) -> String
  private let shortenTripQuestionText: @Sendable (Int) -> String
  private let extendTripQuestionText: @Sendable (Int) -> String
  private let changeBaseQuestionText: @Sendable (String) -> String
  private let issuesHeadingText: @Sendable (Int) -> String
  private let assumptionsHeadingText: @Sendable (Int) -> String
  private let deleteTripQuestionText: @Sendable (String) -> String

  init(
    startTitle: String,
    startHelpShort: String,
    placeFieldPlaceholder: String,
    addPlaceLabel: String,
    suggestionsUnavailable: String,
    placeLimitToast: String,
    priorityNormal: String,
    pasteText: String,
    pastePlaceholder: String,
    pasteRead: String,
    pasteAdd: String,
    editEntryAction: String,
    entryDayLabel: String,
    entryDayAny: String,
    daysQuestion: String,
    daysUndecided: String,
    daysOther: String,
    daysOtherLabel: String,
    daysUndecidedNote: String,
    dateDisclosure: String,
    dateUndecided: String,
    destinationHint: String,
    customDisclosure: String,
    buildCTA: String,
    checkingPlacesCTA: String,
    buildingCTA: String,
    timelineTab: String,
    mapTab: String,
    mapScopeAll: String,
    mapScopeDay: String,
    mapScopeLabel: String,
    mapPinHotel: String,
    mapPinManual: String,
    mapPinWarning: String,
    resolveTitle: String,
    resolveEditInput: String,
    resolveEditName: String,
    resolveCountryHint: String,
    resolveWorldwide: String,
    resolveNoneOfThese: String,
    resolveDeferred: String,
    resolveNotFound: String,
    resolveSearchAgain: String,
    resolvePinOnMap: String,
    resolveStatusConfirmed: String,
    resolveStatusReview: String,
    resolveStatusUnresolved: String,
    manualAddressLabel: String,
    manualLatitude: String,
    manualLongitude: String,
    manualUsePoint: String,
    manualPinHint: String,
    manualPinMapLabel: String,
    bufferHeading: String,
    maxWalkingHeading: String,
    maxWalkingNote: String,
    maxWalkingDefault: String,
    maxTransfersHeading: String,
    maxTransfersNote: String,
    maxTransfersDefault: String,
    flightsDisclosure: String,
    airportCompareArrival: String,
    airportCompareDeparture: String,
    airportArrivalBoundary: String,
    airportDepartureBoundary: String,
    airportNextDay: String,
    airportPreviousDay: String,
    airportArrivalWinner: String,
    airportDepartureWinner: String,
    airportEstimate: String,
    airportUse: String,
    airportSelected: String,
    airportDisclaimer: String,
    mustUnresolvedTitle: String,
    mustUnresolvedContinue: String,
    mustUnresolvedBack: String,
    chooseCountryAction: String,
    chooseCandidateAction: String,
    retryBuildAction: String,
    viewSwitchLabel: String,
    planErrorMessage: String,
    diffLabels: [String],
    editedToast: String,
    revertedToast: String,
    baseClearedToast: String,
    clearBaseQuestion: String,
    openAppleMaps: String,
    stopConditionsDisclosure: String,
    lastEntryLabel: String,
    daySettingsTitle: String,
    customTimeLabel: String,
    hardEditConfirm: String,
    hardEditCancel: String,
    undoAction: String,
    redoAction: String,
    moreActions: String,
    undoneAnnouncement: String,
    redoneAnnouncement: String,
    evidenceNoValue: String,
    evidencePlaceLabel: String,
    evidenceHoursLabel: String,
    evidenceHoursOpen: String,
    evidenceStatusUnknown: String,
    verdictDetailsTitle: String,
    factVerified: String,
    factEstimated: String,
    factUnknown: String,
    coverageHeading: String,
    comparisonHeading: String,
    comparisonOriginal: String,
    comparisonOriginalDetail: String,
    comparisonMinimalRepair: String,
    comparisonMinimalImprovement: String,
    comparisonShortest: String,
    comparisonNoRepair: String,
    comparisonNoRepairNeeded: String,
    comparisonNoShortest: String,
    alternativesHeading: String,
    diffBefore: String,
    diffAfter: String,
    applyAlternative: String,
    assumptionsNone: String,
    attentionsHeading: String,
    passportUnsetShort: String,
    backToPlan: String,
    recentTripsTitle: String,
    openTripAction: String,
    deleteTripAction: String,
    storageUnavailableNote: String,
    pasteLimitToast: @escaping @Sendable (Int) -> String,
    daysValue: @escaping @Sendable (Int) -> String,
    priorityLabel: @escaping @Sendable (String) -> String,
    removeStopQuestion: @escaping @Sendable (String) -> String,
    mustRemovalNote: @escaping @Sendable (String) -> String,
    reservationRemovalNote: @escaping @Sendable (String) -> String,
    removedStopToast: @escaping @Sendable (String) -> String,
    resolveAllConfirmed: @escaping @Sendable (Int) -> String,
    resolveCountryConflict: @escaping @Sendable ([String]) -> String,
    resolveCandidateQuestion: @escaping @Sendable (String) -> String,
    resolveCandidatesLabel: @escaping @Sendable (String) -> String,
    resolveUnresolvedCount: @escaping @Sendable (Int) -> String,
    resolveAmbiguousCount: @escaping @Sendable (Int) -> String,
    resolveContinue: @escaping @Sendable (Int) -> String,
    minutesShort: @escaping @Sendable (Int) -> String,
    airportArrivalBreakdown: @escaping @Sendable (Int, Int) -> String,
    airportDepartureBreakdown: @escaping @Sendable (Int, Int) -> String,
    mustUnresolvedBody: @escaping @Sendable ([String]) -> String,
    planUnresolvedWarning: @escaping @Sendable ([String]) -> String,
    planAmbiguousWarning: @escaping @Sendable ([String]) -> String,
    planDeferredAnchors: @escaping @Sendable ([String]) -> String,
    dayTimeBarLabel: @escaping @Sendable (String, String, String, String, Int, Int) -> String,
    hotelLegDepart: @escaping @Sendable (String) -> String,
    hotelLegReturn: @escaping @Sendable (String) -> String,
    mapPinLabel: @escaping @Sendable (String, String) -> String,
    restoredStopToast: @escaping @Sendable (String) -> String,
    movedToDayToast: @escaping @Sendable (Int) -> String,
    tripDaysToast: @escaping @Sendable (Int) -> String,
    baseSetToast: @escaping @Sendable (String) -> String,
    moveStopQuestion: @escaping @Sendable (String, Int) -> String,
    moveStopAutoQuestion: @escaping @Sendable (String) -> String,
    shortenTripQuestion: @escaping @Sendable (Int) -> String,
    extendTripQuestion: @escaping @Sendable (Int) -> String,
    changeBaseQuestion: @escaping @Sendable (String) -> String,
    issuesHeading: @escaping @Sendable (Int) -> String,
    assumptionsHeading: @escaping @Sendable (Int) -> String,
    deleteTripQuestion: @escaping @Sendable (String) -> String
  ) {
    self.startTitle = startTitle
    self.startHelpShort = startHelpShort
    self.placeFieldPlaceholder = placeFieldPlaceholder
    self.addPlaceLabel = addPlaceLabel
    self.suggestionsUnavailable = suggestionsUnavailable
    self.placeLimitToast = placeLimitToast
    self.priorityNormal = priorityNormal
    self.pasteText = pasteText
    self.pastePlaceholder = pastePlaceholder
    self.pasteRead = pasteRead
    self.pasteAdd = pasteAdd
    self.editEntryAction = editEntryAction
    self.entryDayLabel = entryDayLabel
    self.entryDayAny = entryDayAny
    self.daysQuestion = daysQuestion
    self.daysUndecided = daysUndecided
    self.daysOther = daysOther
    self.daysOtherLabel = daysOtherLabel
    self.daysUndecidedNote = daysUndecidedNote
    self.dateDisclosure = dateDisclosure
    self.dateUndecided = dateUndecided
    self.destinationHint = destinationHint
    self.customDisclosure = customDisclosure
    self.buildCTA = buildCTA
    self.checkingPlacesCTA = checkingPlacesCTA
    self.buildingCTA = buildingCTA
    self.timelineTab = timelineTab
    self.mapTab = mapTab
    self.mapScopeAll = mapScopeAll
    self.mapScopeDay = mapScopeDay
    self.mapScopeLabel = mapScopeLabel
    self.mapPinHotel = mapPinHotel
    self.mapPinManual = mapPinManual
    self.mapPinWarning = mapPinWarning
    self.resolveTitle = resolveTitle
    self.resolveEditInput = resolveEditInput
    self.resolveEditName = resolveEditName
    self.resolveCountryHint = resolveCountryHint
    self.resolveWorldwide = resolveWorldwide
    self.resolveNoneOfThese = resolveNoneOfThese
    self.resolveDeferred = resolveDeferred
    self.resolveNotFound = resolveNotFound
    self.resolveSearchAgain = resolveSearchAgain
    self.resolvePinOnMap = resolvePinOnMap
    self.resolveStatusConfirmed = resolveStatusConfirmed
    self.resolveStatusReview = resolveStatusReview
    self.resolveStatusUnresolved = resolveStatusUnresolved
    self.manualAddressLabel = manualAddressLabel
    self.manualLatitude = manualLatitude
    self.manualLongitude = manualLongitude
    self.manualUsePoint = manualUsePoint
    self.manualPinHint = manualPinHint
    self.manualPinMapLabel = manualPinMapLabel
    self.bufferHeading = bufferHeading
    self.maxWalkingHeading = maxWalkingHeading
    self.maxWalkingNote = maxWalkingNote
    self.maxWalkingDefault = maxWalkingDefault
    self.maxTransfersHeading = maxTransfersHeading
    self.maxTransfersNote = maxTransfersNote
    self.maxTransfersDefault = maxTransfersDefault
    self.flightsDisclosure = flightsDisclosure
    self.airportCompareArrival = airportCompareArrival
    self.airportCompareDeparture = airportCompareDeparture
    self.airportArrivalBoundary = airportArrivalBoundary
    self.airportDepartureBoundary = airportDepartureBoundary
    self.airportNextDay = airportNextDay
    self.airportPreviousDay = airportPreviousDay
    self.airportArrivalWinner = airportArrivalWinner
    self.airportDepartureWinner = airportDepartureWinner
    self.airportEstimate = airportEstimate
    self.airportUse = airportUse
    self.airportSelected = airportSelected
    self.airportDisclaimer = airportDisclaimer
    self.mustUnresolvedTitle = mustUnresolvedTitle
    self.mustUnresolvedContinue = mustUnresolvedContinue
    self.mustUnresolvedBack = mustUnresolvedBack
    self.chooseCountryAction = chooseCountryAction
    self.chooseCandidateAction = chooseCandidateAction
    self.retryBuildAction = retryBuildAction
    self.viewSwitchLabel = viewSwitchLabel
    self.planErrorMessage = planErrorMessage
    self.diffLabels = diffLabels
    self.editedToast = editedToast
    self.revertedToast = revertedToast
    self.baseClearedToast = baseClearedToast
    self.clearBaseQuestion = clearBaseQuestion
    self.openAppleMaps = openAppleMaps
    self.stopConditionsDisclosure = stopConditionsDisclosure
    self.lastEntryLabel = lastEntryLabel
    self.daySettingsTitle = daySettingsTitle
    self.customTimeLabel = customTimeLabel
    self.hardEditConfirm = hardEditConfirm
    self.hardEditCancel = hardEditCancel
    self.undoAction = undoAction
    self.redoAction = redoAction
    self.moreActions = moreActions
    self.undoneAnnouncement = undoneAnnouncement
    self.redoneAnnouncement = redoneAnnouncement
    self.evidenceNoValue = evidenceNoValue
    self.evidencePlaceLabel = evidencePlaceLabel
    self.evidenceHoursLabel = evidenceHoursLabel
    self.evidenceHoursOpen = evidenceHoursOpen
    self.evidenceStatusUnknown = evidenceStatusUnknown
    self.verdictDetailsTitle = verdictDetailsTitle
    self.factVerified = factVerified
    self.factEstimated = factEstimated
    self.factUnknown = factUnknown
    self.coverageHeading = coverageHeading
    self.comparisonHeading = comparisonHeading
    self.comparisonOriginal = comparisonOriginal
    self.comparisonOriginalDetail = comparisonOriginalDetail
    self.comparisonMinimalRepair = comparisonMinimalRepair
    self.comparisonMinimalImprovement = comparisonMinimalImprovement
    self.comparisonShortest = comparisonShortest
    self.comparisonNoRepair = comparisonNoRepair
    self.comparisonNoRepairNeeded = comparisonNoRepairNeeded
    self.comparisonNoShortest = comparisonNoShortest
    self.alternativesHeading = alternativesHeading
    self.diffBefore = diffBefore
    self.diffAfter = diffAfter
    self.applyAlternative = applyAlternative
    self.assumptionsNone = assumptionsNone
    self.attentionsHeading = attentionsHeading
    self.passportUnsetShort = passportUnsetShort
    self.backToPlan = backToPlan
    self.recentTripsTitle = recentTripsTitle
    self.openTripAction = openTripAction
    self.deleteTripAction = deleteTripAction
    self.storageUnavailableNote = storageUnavailableNote
    self.pasteLimitToastText = pasteLimitToast
    self.daysValueText = daysValue
    self.priorityLabelText = priorityLabel
    self.removeStopQuestionText = removeStopQuestion
    self.mustRemovalNoteText = mustRemovalNote
    self.reservationRemovalNoteText = reservationRemovalNote
    self.removedStopToastText = removedStopToast
    self.resolveAllConfirmedText = resolveAllConfirmed
    self.resolveCountryConflictText = resolveCountryConflict
    self.resolveCandidateQuestionText = resolveCandidateQuestion
    self.resolveCandidatesLabelText = resolveCandidatesLabel
    self.resolveUnresolvedCountText = resolveUnresolvedCount
    self.resolveAmbiguousCountText = resolveAmbiguousCount
    self.resolveContinueText = resolveContinue
    self.minutesShortText = minutesShort
    self.airportArrivalBreakdownText = airportArrivalBreakdown
    self.airportDepartureBreakdownText = airportDepartureBreakdown
    self.mustUnresolvedBodyText = mustUnresolvedBody
    self.planUnresolvedWarningText = planUnresolvedWarning
    self.planAmbiguousWarningText = planAmbiguousWarning
    self.planDeferredAnchorsText = planDeferredAnchors
    self.dayTimeBarLabelText = dayTimeBarLabel
    self.hotelLegDepartText = hotelLegDepart
    self.hotelLegReturnText = hotelLegReturn
    self.mapPinLabelText = mapPinLabel
    self.restoredStopToastText = restoredStopToast
    self.movedToDayToastText = movedToDayToast
    self.tripDaysToastText = tripDaysToast
    self.baseSetToastText = baseSetToast
    self.moveStopQuestionText = moveStopQuestion
    self.moveStopAutoQuestionText = moveStopAutoQuestion
    self.shortenTripQuestionText = shortenTripQuestion
    self.extendTripQuestionText = extendTripQuestion
    self.changeBaseQuestionText = changeBaseQuestion
    self.issuesHeadingText = issuesHeading
    self.assumptionsHeadingText = assumptionsHeading
    self.deleteTripQuestionText = deleteTripQuestion
  }

  /// 貼り付けが上限に当たったときのトースト。**件数を名指しする** —— 12 までですとだけ
  /// 言われても、旅行者は何件書いたのかを数え直すことになる(Web `PlacesStep.tsx:146`)。
  public func pasteLimitToast(count: Int) -> String { pasteLimitToastText(count) }

  /// 日数のタイル 1 枚ぶんの文字(「4日」/ "4 days")。
  public func daysValue(_ days: Int) -> String { daysValueText(days) }

  /// 優先度の 3 つ組をまとめて読み上げるときの名前。
  public func priorityLabel(name: String) -> String { priorityLabelText(name) }

  /// 「この場所を外しますか」の問いかけ。Kit が題を持たない編集の fallback。
  public func removeStopQuestion(name: String) -> String { removeStopQuestionText(name) }

  /// 外そうとしているのが必須指定の場所だという但し書き。
  public func mustRemovalNote(name: String) -> String { mustRemovalNoteText(name) }

  /// 外そうとしているのが予約済みの場所だという但し書き。
  public func reservationRemovalNote(name: String) -> String { reservationRemovalNoteText(name) }

  /// 外した後に出るトースト。
  public func removedStopToast(name: String) -> String { removedStopToastText(name) }

  /// 全部決まったときの見出し。数えるのは決まった場所で、行の数ではない。
  public func resolveAllConfirmed(count: Int) -> String { resolveAllConfirmedText(count) }

  /// 場所が 2 か国以上に分かれた、と伝える 1 文。**国コードを並べる** —— どの国が混ざった
  /// のかが分からなければ、旅行者はどちらを選べばよいかを決められない。
  public func resolveCountryConflict(codes: [String]) -> String { resolveCountryConflictText(codes) }

  /// 「どちらの『X』ですか？」。X は旅行者が書いた文字列そのもの。
  public func resolveCandidateQuestion(name: String) -> String { resolveCandidateQuestionText(name) }

  /// 候補の並びをひとまとめに読み上げるときの名前。
  public func resolveCandidatesLabel(name: String) -> String { resolveCandidatesLabelText(name) }

  /// 未解決・同名候補が残っている件数。件数を名指しするのは、旅行者が数え直さずに済むように。
  public func resolveUnresolvedCount(count: Int) -> String { resolveUnresolvedCountText(count) }
  public func resolveAmbiguousCount(count: Int) -> String { resolveAmbiguousCountText(count) }

  /// 確認画面の主ボタン。
  public func resolveContinue(count: Int) -> String { resolveContinueText(count) }

  /// 「10分」のような短い分数。余白の錠剤に出す。
  public func minutesShort(_ minutes: Int) -> String { minutesShortText(minutes) }

  /// 空港の内訳 1 行。前の数が空港内、後ろの数が市街地までの移動。
  public func airportArrivalBreakdown(airportMinutes: Int, transferMinutes: Int) -> String {
    airportArrivalBreakdownText(airportMinutes, transferMinutes)
  }

  public func airportDepartureBreakdown(airportMinutes: Int, transferMinutes: Int) -> String {
    airportDepartureBreakdownText(airportMinutes, transferMinutes)
  }

  /// 未解決の必須・予約を抱えたまま進もうとしたときの本文。名前を並べる。
  public func mustUnresolvedBody(names: [String]) -> String { mustUnresolvedBodyText(names) }

  /// 場所が決まらなかった入力を名指しする 1 文。結論の警告と課題の行が**同じ文**を使う ——
  /// 同じ事実に 2 通りの言い方があると、旅行者は 2 件あると読む。
  public func planUnresolvedWarning(names: [String]) -> String { planUnresolvedWarningText(names) }

  /// 同名候補が残っている入力を名指しする 1 文。
  public func planAmbiguousWarning(names: [String]) -> String { planAmbiguousWarningText(names) }

  /// 日程に入り切らなかった、旅行者が名前で書いた場所。
  public func planDeferredAnchors(names: [String]) -> String { planDeferredAnchorsText(names) }

  /// 時間帯の読み上げ 1 文。帯は絵なので、内訳は全部この文が運ぶ(`role="img"` 相当)。
  /// 分数は呼び出し側が `TripPresentation.formatDuration` で整えたものを渡す ——
  /// 画面の他の分数と同じ書式にするため。
  public func dayTimeBarLabel(
    visit: String,
    travel: String,
    slack: String,
    available: String,
    reservations: Int,
    conflicts: Int
  ) -> String {
    dayTimeBarLabelText(visit, travel, slack, available, reservations, conflicts)
  }

  /// ホテルとのあいだの 1 行(Task 7)。`headline` は Kit の
  /// `TimelinePresentation.legHeadline`(「徒歩 5分」)で、ここが足すのは向きの前置きだけ。
  ///
  /// Kit にも `hotelDepartRow` があるが、あちらは分に「約」を付ける古い形 —— v3.1 は移動の
  /// 行から丸めの但し書きを外し、推定であることは別の 1 文が言う、と決めた。同じ画面の中で
  /// ホテルの行だけが「約」を名乗ると、丸めているのはその区間だけに読める。
  public func hotelLegDepart(_ headline: String) -> String { hotelLegDepartText(headline) }
  public func hotelLegReturn(_ headline: String) -> String { hotelLegReturnText(headline) }

  /// 地図のピンが耳に名乗る 1 文(Task 8)。「ツェルマット、予定地点」——**名前が先**で、
  /// 種別が後ろ。VoiceOver で点から点へ移る旅行者は、まず「どこ」を聞きたいからである。
  /// 区切りの記号が言語で違うので、組み立てをビューに置かずここへ持つ。
  public func mapPinLabel(name: String, kind: String) -> String { mapPinLabelText(name, kind) }

  /// 外した場所を戻したときのトースト(Web `usePlannerEdits.tsx:534`)。
  public func restoredStopToast(name: String) -> String { restoredStopToastText(name) }

  /// 日をまたいで動かしたときのトースト。**1 始まりの日**を渡す(旅行者が読む番号)。
  public func movedToDayToast(day: Int) -> String { movedToDayToastText(day) }

  /// 旅の長さを変えたときのトースト。
  public func tripDaysToast(days: Int) -> String { tripDaysToastText(days) }

  /// 拠点を変えたときのトースト。
  public func baseSetToast(name: String) -> String { baseSetToastText(name) }

  /// 日をまたいで動かしてよいか、自動配置に戻してよいかの問いかけ。**1 始まりの日**。
  public func moveStopQuestion(name: String, day: Int) -> String { moveStopQuestionText(name, day) }
  public func moveStopAutoQuestion(name: String) -> String { moveStopAutoQuestionText(name) }

  /// 旅の長さを変えてよいかの問いかけ。**向きで文が違う** —— 伸ばすほうも問いかけは出る
  /// (日が増えると締切の位置が付け替わり、予約や最終入場が新たに割れることがある)ので、
  /// 「短縮しますか？」を両方向で使い回すと、伸ばした旅行者に押した覚えのない操作を
  /// 確かめさせることになる。
  public func shortenTripQuestion(days: Int) -> String { shortenTripQuestionText(days) }
  public func extendTripQuestion(days: Int) -> String { extendTripQuestionText(days) }

  /// 拠点を変えてよいかの問いかけ。
  public func changeBaseQuestion(name: String) -> String { changeBaseQuestionText(name) }

  /// 課題カードの見出し。**件数は行の数ではなく確かめる対象の数**(`PlannerStore.issueCount`)。
  public func issuesHeading(count: Int) -> String { issuesHeadingText(count) }

  /// 前提の折り畳みの見出し。件数を出すのは、開く前に「何件あるか」が読めるようにするため。
  public func assumptionsHeading(count: Int) -> String { assumptionsHeadingText(count) }

  /// 端末から 1 件消してよいかの問いかけ。**題を名指しする** —— 一覧の並びは更新のたびに
  /// 変わるので、「この旅程を削除しますか？」では、どれを消すのかが読めない。
  public func deleteTripQuestion(title: String) -> String { deleteTripQuestionText(title) }

  public static func `for`(_ locale: PlannerLocale) -> AppCopy {
    locale == .ja ? ja : en
  }

  /// Web の対応箇所:`StartIntro.tsx:32`、`PlacesStep.tsx:125` `:131` `:170` `:179`
  /// `:227` `:261` `:265` `:267` `:279` `:282` `:289` `:308-310` `:317-319`、
  /// `ResolveScreen.tsx:383`、`MobileResultToggle.tsx:20-21`、`TripMap.tsx:154-155`、
  /// `VerdictDetails.tsx:237-241`、`usePlannerEdits.tsx:503-517`。約物は Web のバイトのまま。
  ///
  /// 入力欄の例だけは Web と形が違う —— Web は複数行のテキストエリアに 3 行の例を薄く出すが、
  /// iPhone は 1 行の検索窓なので 1 件だけを出す(まとめて入れる道は「まとめて貼り付ける」)。
  static let ja = AppCopy(
    startTitle: "行きたい場所だけ、決めてください。",
    startHelpShort: "1行に1か所。入力を止めると候補が出ます。選ぶと同名の都市・店を取り違えません。",
    placeFieldPlaceholder: "例：ラウターブルンネン",
    addPlaceLabel: "この場所を追加",
    suggestionsUnavailable: "いまは候補を出せませんでした。打った名前のまま追加できます。",
    placeLimitToast: "1回に確認できるのは12か所までです。残りは別の旅として分けてください。",
    priorityNormal: "通常",
    pasteText: "まとめて貼り付ける",
    pastePlaceholder: "1日目\n浅草寺\nチームラボプラネッツ 15:30 予約\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば",
    pasteRead: "読み取る",
    pasteAdd: "リストに追加",
    editEntryAction: "時刻・予約・滞在を編集",
    entryDayLabel: "行く日",
    entryDayAny: "どの日でも",
    daysQuestion: "何日くらい？",
    daysUndecided: "未定",
    daysOther: "他の日数",
    daysOtherLabel: "他の日数を選ぶ",
    daysUndecidedNote: "場所に合わせて、必要な日数をTripCheckが提案します。",
    dateDisclosure: "日付を入れる（営業時間・祝日・天気が正確になります）",
    dateUndecided: "日付はまだ未定",
    destinationHint: "同名の都市・店があるため、国が分かる場合は先に選ぶと検索が正確になります。",
    customDisclosure: "日数・ホテル・ペースなどの条件を調整（任意）",
    buildCTA: "旅程をつくる",
    checkingPlacesCTA: "場所を確認しています…",
    buildingCTA: "旅程を作成中…",
    timelineTab: "旅程",
    mapTab: "地図",
    mapScopeAll: "全日程",
    mapScopeDay: "この日",
    mapScopeLabel: "地図に出す範囲",
    mapPinHotel: "ホテル",
    mapPinManual: "自分で指定した地点",
    mapPinWarning: "注意地点",
    resolveTitle: "場所を確認してください。",
    resolveEditInput: "入力を直す",
    resolveEditName: "この名前を直す",
    resolveCountryHint: "国を選ぶと、いまの入力をその国の範囲で探し直します。",
    resolveWorldwide: "世界中を対象にする",
    resolveNoneOfThese: "候補にない（住所で指定）",
    resolveDeferred: "先に上の項目を確認すると、ここが選べるようになります。",
    resolveNotFound: "この場所だけ見つかりませんでした",
    resolveSearchAgain: "もう一度探す",
    resolvePinOnMap: "地図で場所を指定する",
    resolveStatusConfirmed: "確認済み",
    resolveStatusReview: "候補を選択",
    resolveStatusUnresolved: "見つかっていません",
    manualAddressLabel: "住所・目印（任意）",
    manualLatitude: "緯度",
    manualLongitude: "経度",
    manualUsePoint: "この地点を使う",
    manualPinHint: "地図をタップすると座標が入ります。住所だけでも大丈夫です。提供元が確認した地点ではなく、あなたが指定した地点として表示します。",
    manualPinMapLabel: "地図（タップで地点を指定）",
    bufferHeading: "移動ごとの余白",
    maxWalkingHeading: "1区間の徒歩上限（任意）",
    maxWalkingNote: "超える徒歩は他の移動手段を優先します。",
    maxWalkingDefault: "標準 30分",
    maxTransfersHeading: "1区間の乗換上限（任意）",
    maxTransfersNote: "乗換回数を取得できない区間は未確認と表示します。",
    maxTransfersDefault: "標準 2回",
    flightsDisclosure: "フライト・空港の条件",
    airportCompareArrival: "到着便の候補を比較",
    airportCompareDeparture: "出発便の候補を比較",
    airportArrivalBoundary: "主要市街地で動ける目安",
    airportDepartureBoundary: "主要市街地を出る目安",
    airportNextDay: "翌日",
    airportPreviousDay: "前日",
    airportArrivalWinner: "市街地で動ける時刻が最も早い",
    airportDepartureWinner: "市街地を出る時刻が最も遅い",
    airportEstimate: "TripCheckの見立て",
    airportUse: "この候補を使う",
    airportSelected: "選択中",
    airportDisclaimer: "空港内と市街地移動の分数は、空港が示した事実ではなくTripCheckの計画用の目安です。ホテルまでではなく主要市街地までの目安なので、最終確認は航空会社で行ってください。",
    mustUnresolvedTitle: "見つからなかった場所があります",
    mustUnresolvedContinue: "続ける",
    mustUnresolvedBack: "戻って直す",
    chooseCountryAction: "国を選ぶ",
    chooseCandidateAction: "候補から選ぶ",
    retryBuildAction: "もう一度つくる",
    viewSwitchLabel: "表示を切り替える",
    planErrorMessage: "この条件では1日も組めませんでした。場所か日数を見直してから、もう一度つくってください。",
    diffLabels: ["重大な衝突", "超過", "移動", "最小余白", "訪問数", "日数"],
    editedToast: "変更しました",
    revertedToast: "自動に戻しました",
    baseClearedToast: "拠点の指定を外しました",
    clearBaseQuestion: "拠点の指定を外しますか？",
    openAppleMaps: "Apple Mapsで開く",
    stopConditionsDisclosure: "この場所の条件を変える",
    lastEntryLabel: "最終入場",
    daySettingsTitle: "この日の設定",
    customTimeLabel: "時刻を選ぶ",
    hardEditConfirm: "このまま進める",
    hardEditCancel: "やめる",
    undoAction: "元に戻す",
    redoAction: "やり直す",
    moreActions: "その他の操作",
    undoneAnnouncement: "元に戻しました",
    redoneAnnouncement: "やり直しました",
    evidenceNoValue: "—",
    evidencePlaceLabel: "場所",
    evidenceHoursLabel: "営業時間",
    evidenceHoursOpen: "訪問時刻は営業時間内",
    evidenceStatusUnknown: "未確認",
    verdictDetailsTitle: "結論の詳細",
    factVerified: "確認済み",
    factEstimated: "推定",
    factUnknown: "未確認",
    coverageHeading: "この地域の対応",
    comparisonHeading: "3つの見方を比較",
    comparisonOriginal: "元の案",
    comparisonOriginalDetail: "入力した日別割当と順番",
    comparisonMinimalRepair: "最小修正版",
    comparisonMinimalImprovement: "最小の改善案",
    comparisonShortest: "移動を減らす案",
    comparisonNoRepair: "1回の変更で成立する案はまだありません",
    comparisonNoRepairNeeded: "必要な修正はありません",
    comparisonNoShortest: "固定条件内で、より移動の少ない案は見つかりませんでした",
    alternativesHeading: "比較できる変更案",
    diffBefore: "現在の案",
    diffAfter: "変更案",
    applyAlternative: "この変更を適用",
    assumptionsNone: "重要な前提はすべて確認済みです。",
    attentionsHeading: "その他の注意",
    passportUnsetShort: "未選択",
    backToPlan: "組んだ旅程にもどる",
    recentTripsTitle: "最近の旅程",
    openTripAction: "開く",
    deleteTripAction: "削除",
    storageUnavailableNote: "旅程をこの端末に保存できません。アプリを閉じると、組んだ旅程は消えます。",
    pasteLimitToast: { "\($0)件あります。1回に確認できるのは12か所までです。残りは別の旅として分けてください。" },
    daysValue: { "\($0)日" },
    priorityLabel: { "\($0)の優先度" },
    removeStopQuestion: { "「\($0)」を予定から外しますか？" },
    mustRemovalNote: { "「\($0)」は必須に指定されています" },
    reservationRemovalNote: { "「\($0)」は予約済みとして固定されています" },
    removedStopToast: { "「\($0)」を外しました" },
    resolveAllConfirmed: { "\($0)か所を確認しました。" },
    resolveCountryConflict: { codes in
      "場所が\(codes.count)か国（\(codes.joined(separator: "・"))）に分かれています。国を選ぶとその範囲で探し直します。1か国に収まらない旅なら「世界中」を選んでください。"
    },
    resolveCandidateQuestion: { "どちらの「\($0)」ですか？" },
    resolveCandidatesLabel: { "\($0)の候補" },
    resolveUnresolvedCount: { "\($0)件は見つかっていません。確認が終わるまで結論を出しません。" },
    resolveAmbiguousCount: { "\($0)件は同名候補があります。住所を見て選んでください。" },
    resolveContinue: { "\($0)か所で続ける" },
    minutesShort: { "\($0)分" },
    airportArrivalBreakdown: { "着陸後：空港内 \($0)分 + 主要市街地まで約\($1)分" },
    airportDepartureBreakdown: { "出発前：空港まで約\($1)分 + 空港内 \($0)分" },
    mustUnresolvedBody: { names in
      "「\(names.joined(separator: "」「"))」は必須または予約として指定されていますが、場所が決まっていません。このまま進めると旅程に入りません。"
    },
    planUnresolvedWarning: { names in
      "「\(AppCopy.nameList(names, locale: .ja))」の場所がまだ決まっていません。決まるまで旅程には入りません。"
    },
    planAmbiguousWarning: { names in
      "「\(AppCopy.nameList(names, locale: .ja))」は同名の候補が残っています。住所を見て選んでください。"
    },
    planDeferredAnchors: { names in
      "「\(AppCopy.nameList(names, locale: .ja))」は、いまの条件では日程に入りません。"
    },
    dayTimeBarLabel: { visit, travel, slack, available, reservations, conflicts in
      ([
        "1日の時間配分。訪問\(visit)",
        "移動\(travel)",
        "余裕\(slack)",
        "利用可能\(available)",
        reservations > 0 ? "予約マーカー\(reservations)件" : nil,
        conflicts > 0 ? "衝突\(conflicts)件" : nil,
      ].compactMap { $0 }).joined(separator: "、") + "。"
    },
    hotelLegDepart: { headline in "ホテルから \(headline)" },
    hotelLegReturn: { headline in "ホテルへ \(headline)" },
    mapPinLabel: { name, kind in "\(name)、\(kind)" },
    restoredStopToast: { "「\($0)」を戻しました" },
    movedToDayToast: { "\($0)日目に移動しました" },
    tripDaysToast: { "\($0)日の旅程にしました" },
    baseSetToast: { "拠点を「\($0)」にしました" },
    moveStopQuestion: { name, day in "「\(name)」を\(day)日目へ移動しますか？" },
    moveStopAutoQuestion: { "「\($0)」の日程を自動配置に戻しますか？" },
    shortenTripQuestion: { "\($0)日に短縮しますか？" },
    extendTripQuestion: { "\($0)日に延ばしますか？" },
    changeBaseQuestion: { "拠点を「\($0)」に変更しますか？" },
    issuesHeading: { "確認したいこと \($0)" },
    assumptionsHeading: { "この結論の前提 \($0)件" },
    deleteTripQuestion: { "「\($0)」を端末から削除しますか？" }
  )

  static let en = AppCopy(
    startTitle: "Just choose the places.",
    startHelpShort: "One place per line. Pause to see matches, then choose one to avoid same-name mix-ups.",
    placeFieldPlaceholder: "e.g. Lauterbrunnen",
    addPlaceLabel: "Add this place",
    suggestionsUnavailable: "No matches right now — you can still add the name you typed.",
    placeLimitToast: "Up to 12 places at a time. Keep the rest for a second trip.",
    priorityNormal: "Normal",
    pasteText: "Paste a list",
    pastePlaceholder: "Day 1\nSenso-ji\nteamLab Planets 15:30 booked\nGhibli Museum must\nShibuya Sky optional",
    pasteRead: "Read this",
    pasteAdd: "Add to my list",
    editEntryAction: "Edit time, booking and stay",
    entryDayLabel: "Day to visit",
    entryDayAny: "Any day",
    daysQuestion: "How many days?",
    daysUndecided: "Not decided",
    daysOther: "Other",
    daysOtherLabel: "Choose another day count",
    daysUndecidedNote: "TripCheck will propose the day count that fits your places.",
    dateDisclosure: "Add dates (sharpens hours, holidays and weather)",
    dateUndecided: "Date not decided yet",
    destinationHint: "If you know the country, choose it first to disambiguate same-named cities and venues.",
    customDisclosure: "Adjust days, hotel, pace and more (optional)",
    buildCTA: "Build my trip",
    checkingPlacesCTA: "Checking your places…",
    buildingCTA: "Building your itinerary…",
    timelineTab: "Timeline",
    mapTab: "Map",
    mapScopeAll: "All days",
    mapScopeDay: "This day",
    mapScopeLabel: "What the map shows",
    mapPinHotel: "hotel",
    mapPinManual: "point you placed",
    mapPinWarning: "stop to check",
    resolveTitle: "Check these places.",
    resolveEditInput: "Edit input",
    resolveEditName: "Edit the name",
    resolveCountryHint: "Choose a country to search the current input again inside it.",
    resolveWorldwide: "Search worldwide",
    resolveNoneOfThese: "None of these (use an address)",
    resolveDeferred: "Settle the items above first — this one unlocks next.",
    resolveNotFound: "We couldn’t find this place",
    resolveSearchAgain: "Search again",
    resolvePinOnMap: "Pin it on the map",
    resolveStatusConfirmed: "Confirmed",
    resolveStatusReview: "Choose a match",
    resolveStatusUnresolved: "Not found yet",
    manualAddressLabel: "Address or landmark (optional)",
    manualLatitude: "Latitude",
    manualLongitude: "Longitude",
    manualUsePoint: "Use this point",
    manualPinHint: "Tap the map to capture coordinates. An address alone is enough. This stays labelled as a traveller-supplied point, not a place a provider confirmed.",
    manualPinMapLabel: "Map (tap to place the point)",
    bufferHeading: "Buffer after each leg",
    maxWalkingHeading: "Max walking per leg (optional)",
    maxWalkingNote: "Longer walks are deprioritised when another mode is available.",
    maxWalkingDefault: "Default 30 min",
    maxTransfersHeading: "Max transfers per leg (optional)",
    maxTransfersNote: "A leg stays marked unverified when transfer-step data is unavailable.",
    maxTransfersDefault: "Default 2",
    flightsDisclosure: "Flight and airport constraints",
    airportCompareArrival: "Compare arrival options",
    airportCompareDeparture: "Compare departure options",
    airportArrivalBoundary: "Ready in the main city",
    airportDepartureBoundary: "Leave the main city",
    airportNextDay: "next day",
    airportPreviousDay: "previous day",
    airportArrivalWinner: "Earliest city-ready time",
    airportDepartureWinner: "Latest leave-city time",
    airportEstimate: "TripCheck estimate",
    airportUse: "Use this option",
    airportSelected: "Selected",
    airportDisclaimer: "Minutes at the airport and to the city are TripCheck planning assumptions, not facts supplied by the airport, and the transfer is to the main city rather than your hotel. Confirm the final flight with the airline.",
    mustUnresolvedTitle: "Some places were not found",
    mustUnresolvedContinue: "Continue",
    mustUnresolvedBack: "Go back and fix",
    chooseCountryAction: "Choose a country",
    chooseCandidateAction: "Pick a match",
    retryBuildAction: "Build it again",
    viewSwitchLabel: "Switch view",
    planErrorMessage: "Nothing could be scheduled under these conditions. Revisit the places or the day count, then build again.",
    diffLabels: ["Hard conflicts", "Overrun", "Travel", "Minimum slack", "Visits", "Days"],
    editedToast: "Updated",
    revertedToast: "Back to automatic",
    baseClearedToast: "Base cleared",
    clearBaseQuestion: "Clear the base?",
    openAppleMaps: "Open in Apple Maps",
    stopConditionsDisclosure: "Change the conditions here",
    lastEntryLabel: "Last entry",
    daySettingsTitle: "Day settings",
    customTimeLabel: "Pick a time",
    hardEditConfirm: "Go ahead",
    hardEditCancel: "Keep it",
    undoAction: "Undo",
    redoAction: "Redo",
    moreActions: "More actions",
    undoneAnnouncement: "Undone",
    redoneAnnouncement: "Redone",
    evidenceNoValue: "—",
    evidencePlaceLabel: "Place",
    evidenceHoursLabel: "Opening hours",
    evidenceHoursOpen: "The visit falls inside opening hours",
    evidenceStatusUnknown: "Unconfirmed",
    verdictDetailsTitle: "Result details",
    factVerified: "confirmed",
    factEstimated: "estimated",
    factUnknown: "unknown",
    coverageHeading: "Coverage in this region",
    comparisonHeading: "Compare three views",
    comparisonOriginal: "Original",
    comparisonOriginalDetail: "Pasted days and order",
    comparisonMinimalRepair: "Minimal revision",
    comparisonMinimalImprovement: "Smallest improvement",
    comparisonShortest: "Lower-travel order",
    comparisonNoRepair: "No one-change repair is available yet",
    comparisonNoRepairNeeded: "No corrective change needed",
    comparisonNoShortest: "No lower-travel alternative was found within the fixed constraints",
    alternativesHeading: "Comparable changes",
    diffBefore: "Current plan",
    diffAfter: "Proposed plan",
    applyAlternative: "Apply this change",
    assumptionsNone: "All critical assumptions are confirmed.",
    attentionsHeading: "Other notices",
    passportUnsetShort: "Not set",
    backToPlan: "Back to your plan",
    recentTripsTitle: "Recent trips",
    openTripAction: "Open",
    deleteTripAction: "Delete",
    storageUnavailableNote: "Trips cannot be saved on this device. What you build disappears when the app closes.",
    pasteLimitToast: { "\($0) places found. Up to 12 places at a time. Keep the rest for a second trip." },
    daysValue: { "\($0) day\($0 == 1 ? "" : "s")" },
    priorityLabel: { "\($0) priority" },
    removeStopQuestion: { "Remove “\($0)” from the plan?" },
    mustRemovalNote: { "“\($0)” is marked as a must-visit" },
    reservationRemovalNote: { "“\($0)” is pinned as a booking" },
    removedStopToast: { "Removed “\($0)”" },
    resolveAllConfirmed: { "Confirmed \($0) place\($0 == 1 ? "" : "s")." },
    resolveCountryConflict: { codes in
      "Your places span \(codes.count) countries (\(codes.joined(separator: ", "))). Choose a country to search again inside it, or pick worldwide for a trip that genuinely crosses borders."
    },
    resolveCandidateQuestion: { "Which “\($0)” did you mean?" },
    resolveCandidatesLabel: { "Candidates for \($0)" },
    resolveUnresolvedCount: { "\($0) place\($0 == 1 ? " is" : "s are") still not found. The result stays conditional until they are confirmed." },
    resolveAmbiguousCount: { "\($0) place\($0 == 1 ? " has" : "s have") same-name matches. Choose by address." },
    resolveContinue: { "Continue with \($0) place\($0 == 1 ? "" : "s")" },
    minutesShort: { "\($0) min" },
    airportArrivalBreakdown: { "After landing: \($0) min at the airport + about \($1) min to the main city" },
    airportDepartureBreakdown: { "Before takeoff: about \($1) min to the airport + \($0) min at the airport" },
    mustUnresolvedBody: { names in
      "“\(names.joined(separator: "”, “"))” \(names.count == 1 ? "is" : "are") marked must-visit or booked, but the place is still not found. Continuing leaves \(names.count == 1 ? "it" : "them") out of the itinerary."
    },
    planUnresolvedWarning: { names in
      "“\(AppCopy.nameList(names, locale: .en))” \(names.count == 1 ? "has" : "have") no place yet, so \(names.count == 1 ? "it stays" : "they stay") out of the itinerary until settled."
    },
    planAmbiguousWarning: { names in
      "“\(AppCopy.nameList(names, locale: .en))” still \(names.count == 1 ? "has" : "have") same-name matches. Pick one by its address."
    },
    planDeferredAnchors: { names in
      "“\(AppCopy.nameList(names, locale: .en))” \(names.count == 1 ? "does" : "do") not fit the plan as it stands."
    },
    dayTimeBarLabel: { visit, travel, slack, available, reservations, conflicts in
      ([
        "Day time allocation: \(visit) visiting",
        "\(travel) travelling",
        "\(slack) spare",
        "\(available) available",
        reservations > 0 ? "\(reservations) reservation marker\(reservations == 1 ? "" : "s")" : nil,
        conflicts > 0 ? "\(conflicts) conflict\(conflicts == 1 ? "" : "s")" : nil,
      ].compactMap { $0 }).joined(separator: ", ") + "."
    },
    hotelLegDepart: { headline in "From hotel · \(headline)" },
    hotelLegReturn: { headline in "To hotel · \(headline)" },
    mapPinLabel: { name, kind in "\(name), \(kind)" },
    restoredStopToast: { "Restored “\($0)”" },
    movedToDayToast: { "Moved to Day \($0)" },
    tripDaysToast: { "Trip length set to \($0) \($0 == 1 ? "day" : "days")" },
    baseSetToast: { "Base set to \($0)" },
    moveStopQuestion: { name, day in "Move “\(name)” to day \(day)?" },
    moveStopAutoQuestion: { "Return “\($0)” to automatic placement?" },
    shortenTripQuestion: { "Shorten the trip to \($0) \($0 == 1 ? "day" : "days")?" },
    extendTripQuestion: { "Extend the trip to \($0) \($0 == 1 ? "day" : "days")?" },
    changeBaseQuestion: { "Change the base to “\($0)”?" },
    issuesHeading: { "\($0) thing\($0 == 1 ? "" : "s") to check" },
    assumptionsHeading: { "\($0) assumption\($0 == 1 ? "" : "s") behind this result" },
    deleteTripQuestion: { "Delete “\($0)” from this device?" }
  )

  /// 保存した旅程の題 —— **先頭 3 か所の名前**。一覧はこれで旅を見分けるので、名前を
  /// 削るより並べる:「4日間の旅」では、どれが自分のスイスかは分からない。長さは
  /// `StoredTripRecord.validTitle` の上限(UTF-16 で 160)に畳む。
  static func tripTitle(_ names: [String], locale: PlannerLocale) -> String {
    JSText.slice(names.prefix(3).joined(separator: locale == .ja ? "・" : ", "), 160)
  }

  /// 名前を並べるときの共通の切り詰め —— 先頭 2 件だけを出し、残りは件数で言う。Kit の
  /// `minimumDaysCopy`(`Presentation/Copy.swift`)が未確定の場所を並べるのと同じ形で、
  /// 3 つ以上を読み上げても旅行者はどれから直すか決められない。
  static func nameList(_ names: [String], locale: PlannerLocale) -> String {
    let head = names.prefix(2).joined(separator: locale == .ja ? "・" : ", ")
    let extra = names.count - 2
    guard extra > 0 else { return head }
    return head + (locale == .ja ? " 他\(extra)件" : " +\(extra) more")
  }
}
