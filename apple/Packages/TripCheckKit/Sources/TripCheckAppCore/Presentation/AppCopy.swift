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
  /// まとめて貼り付けるシートを開くボタン。
  public let pasteText: String
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

  /// 結論の詳細に出す差分表の見出し。Kit の `TripScenarioMetrics` の 6 欄と 1 対 1 で、
  /// **この並びが表の行順**になる(衝突・超過・移動・最小余白・訪問数・日数)。Web は
  /// 訪問数と日数を 1 行に詰めるが、iPhone の幅では 1 欄 1 行のほうが読める。
  public let diffLabels: [String]

  private let daysValueText: @Sendable (Int) -> String
  private let priorityLabelText: @Sendable (String) -> String
  private let removeStopQuestionText: @Sendable (String) -> String
  private let mustRemovalNoteText: @Sendable (String) -> String
  private let reservationRemovalNoteText: @Sendable (String) -> String
  private let removedStopToastText: @Sendable (String) -> String

  init(
    startTitle: String,
    startHelpShort: String,
    placeFieldPlaceholder: String,
    addPlaceLabel: String,
    suggestionsUnavailable: String,
    placeLimitToast: String,
    priorityNormal: String,
    pasteText: String,
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
    diffLabels: [String],
    daysValue: @escaping @Sendable (Int) -> String,
    priorityLabel: @escaping @Sendable (String) -> String,
    removeStopQuestion: @escaping @Sendable (String) -> String,
    mustRemovalNote: @escaping @Sendable (String) -> String,
    reservationRemovalNote: @escaping @Sendable (String) -> String,
    removedStopToast: @escaping @Sendable (String) -> String
  ) {
    self.startTitle = startTitle
    self.startHelpShort = startHelpShort
    self.placeFieldPlaceholder = placeFieldPlaceholder
    self.addPlaceLabel = addPlaceLabel
    self.suggestionsUnavailable = suggestionsUnavailable
    self.placeLimitToast = placeLimitToast
    self.priorityNormal = priorityNormal
    self.pasteText = pasteText
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
    self.diffLabels = diffLabels
    self.daysValueText = daysValue
    self.priorityLabelText = priorityLabel
    self.removeStopQuestionText = removeStopQuestion
    self.mustRemovalNoteText = mustRemovalNote
    self.reservationRemovalNoteText = reservationRemovalNote
    self.removedStopToastText = removedStopToast
  }

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
    diffLabels: ["重大な衝突", "超過", "移動", "最小余白", "訪問数", "日数"],
    daysValue: { "\($0)日" },
    priorityLabel: { "\($0)の優先度" },
    removeStopQuestion: { "「\($0)」を予定から外しますか？" },
    mustRemovalNote: { "「\($0)」は必須に指定されています" },
    reservationRemovalNote: { "「\($0)」は予約済みとして固定されています" },
    removedStopToast: { "「\($0)」を外しました" }
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
    diffLabels: ["Hard conflicts", "Overrun", "Travel", "Minimum slack", "Visits", "Days"],
    daysValue: { "\($0) day\($0 == 1 ? "" : "s")" },
    priorityLabel: { "\($0) priority" },
    removeStopQuestion: { "Remove “\($0)” from the plan?" },
    mustRemovalNote: { "“\($0)” is marked as a must-visit" },
    reservationRemovalNote: { "“\($0)” is pinned as a booking" },
    removedStopToast: { "Removed “\($0)”" }
  )
}
