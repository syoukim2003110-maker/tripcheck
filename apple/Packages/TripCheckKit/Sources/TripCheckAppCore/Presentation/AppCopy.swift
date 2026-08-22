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
  /// まとめて貼り付けるシートを開くボタン。
  public let pasteText: String
  /// 日付を入れる折り畳みの見出し。
  public let dateDisclosure: String
  /// 日数・ホテル・ペースなどの折り畳みの見出し。
  public let customDisclosure: String
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

  private let removeStopQuestionText: @Sendable (String) -> String
  private let mustRemovalNoteText: @Sendable (String) -> String
  private let reservationRemovalNoteText: @Sendable (String) -> String
  private let removedStopToastText: @Sendable (String) -> String

  init(
    startTitle: String,
    startHelpShort: String,
    pasteText: String,
    dateDisclosure: String,
    customDisclosure: String,
    timelineTab: String,
    mapTab: String,
    mapScopeAll: String,
    mapScopeDay: String,
    diffLabels: [String],
    removeStopQuestion: @escaping @Sendable (String) -> String,
    mustRemovalNote: @escaping @Sendable (String) -> String,
    reservationRemovalNote: @escaping @Sendable (String) -> String,
    removedStopToast: @escaping @Sendable (String) -> String
  ) {
    self.startTitle = startTitle
    self.startHelpShort = startHelpShort
    self.pasteText = pasteText
    self.dateDisclosure = dateDisclosure
    self.customDisclosure = customDisclosure
    self.timelineTab = timelineTab
    self.mapTab = mapTab
    self.mapScopeAll = mapScopeAll
    self.mapScopeDay = mapScopeDay
    self.diffLabels = diffLabels
    self.removeStopQuestionText = removeStopQuestion
    self.mustRemovalNoteText = mustRemovalNote
    self.reservationRemovalNoteText = reservationRemovalNote
    self.removedStopToastText = removedStopToast
  }

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

  /// Web の対応箇所:`StartIntro.tsx:32`、`PlacesStep.tsx:131` と `:282`、
  /// `ResolveScreen.tsx:383`、`MobileResultToggle.tsx:20-21`、`TripMap.tsx:154-155`、
  /// `VerdictDetails.tsx:237-241`、`usePlannerEdits.tsx:503-517`。約物は Web のバイトのまま。
  static let ja = AppCopy(
    startTitle: "行きたい場所だけ、決めてください。",
    startHelpShort: "1行に1か所。入力を止めると候補が出ます。選ぶと同名の都市・店を取り違えません。",
    pasteText: "まとめて貼り付ける",
    dateDisclosure: "日付を入れる（営業時間・祝日・天気が正確になります）",
    customDisclosure: "日数・ホテル・ペースなどの条件を調整（任意）",
    timelineTab: "旅程",
    mapTab: "地図",
    mapScopeAll: "全日程",
    mapScopeDay: "この日",
    diffLabels: ["重大な衝突", "超過", "移動", "最小余白", "訪問数", "日数"],
    removeStopQuestion: { "「\($0)」を予定から外しますか？" },
    mustRemovalNote: { "「\($0)」は必須に指定されています" },
    reservationRemovalNote: { "「\($0)」は予約済みとして固定されています" },
    removedStopToast: { "「\($0)」を外しました" }
  )

  static let en = AppCopy(
    startTitle: "Just choose the places.",
    startHelpShort: "One place per line. Pause to see matches, then choose one to avoid same-name mix-ups.",
    pasteText: "Paste a list",
    dateDisclosure: "Add dates (sharpens hours, holidays and weather)",
    customDisclosure: "Adjust days, hotel, pace and more (optional)",
    timelineTab: "Timeline",
    mapTab: "Map",
    mapScopeAll: "All days",
    mapScopeDay: "This day",
    diffLabels: ["Hard conflicts", "Overrun", "Travel", "Minimum slack", "Visits", "Days"],
    removeStopQuestion: { "Remove “\($0)” from the plan?" },
    mustRemovalNote: { "“\($0)” is marked as a must-visit" },
    reservationRemovalNote: { "“\($0)” is pinned as a booking" },
    removedStopToast: { "Removed “\($0)”" }
  )
}
