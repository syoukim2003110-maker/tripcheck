import Foundation
import TripCheckKit

/// いま出ている画面。`.error` が抱えるのは**機械が読む短い語**で、旅行者に見せる文ではない
/// (文言は Task 6 が `Copy` / `AppCopy` から引く)。
public enum Screen: Equatable, Sendable {
  case start, resolve, building, plan
  case error(String)
}

/// 旅程と地図のどちらを見ているか(iPhone は同時に出さない)。
public enum MobileView: Equatable, Sendable {
  case timeline, map
}

/// 地図が全日程を映しているか、選んだ 1 日だけか。
public enum MapScope: Equatable, Sendable {
  case all, day
}

/// 詳細シートの高さ。
public enum SheetDetent: Equatable, Sendable {
  case peek, half, full
}

/// 開いている詳細。停留所 id か、日ごとの設定。
public enum Inspector: Equatable, Sendable, Identifiable {
  case stop(String)
  case daySettings(Int)

  public var id: String {
    switch self {
    case .stop(let stopId): "stop:\(stopId)"
    case .daySettings(let day): "day:\(day)"
    }
  }
}

/// 旅行者の確認を待っている編集。
///
/// **閉包は持たない** —— `PlannerViewState` が `Equatable` かつ `Sendable` であるため。
/// 実際に適用する処理は `PlannerStore` の `pendingApply` が持ち(Task 9)、ここには
/// 「何を確認したいのか」だけが残る。
public enum PendingHardEdit: Equatable, Sendable {
  /// まだ場所が決まっていないものがあるので進めない。
  case mustUnresolved(names: [String])
  /// 進めてよいか聞く編集。`conflicts` は Kit の判定、`extraConflicts` はアプリ側の但し書き
  /// (必須指定・予約済みなど)、`fallbackTitle` は Kit が題を持たないときの問いかけ。
  case edit(conflicts: [PlannerHardEditConflict], extraConflicts: [String], fallbackTitle: String)
}

/*
 * 状態 3 グループの 3 つ目 —— 画面の開閉と選択。
 *
 * 保存も共有もしない。`TripCheckKit` の関数には渡さない(Kit にこの型は存在しないので、
 * 型でそもそも渡せない)。`tripRequest()` がここを読まないことが、「見ているものを変えても
 * 旅程が変わらない」という約束の実体になる。
 */
public struct PlannerViewState: Equatable, Sendable {
  public var screen: Screen
  /// 0 始まりの日。
  public var selectedDay: Int
  public var mobileView: MobileView
  public var inspector: Inspector?
  public var sheetDetent: SheetDetent
  public var shareOpen: Bool
  public var printOpen: Bool
  public var pendingHardEdit: PendingHardEdit?
  public var toast: Toast?
  public var mapScope: MapScope
  public var mapFocusedStopId: String?
  public var verdictExpanded: Bool
  public var pasteOpen: Bool
  public var editingEntry: UUID?
  /// VoiceOver へ読み上げる 1 文。組み上がるたびに結論の見出しで置き換える。
  public var announcement: String?

  public init(
    screen: Screen = .start,
    selectedDay: Int = 0,
    mobileView: MobileView = .timeline,
    inspector: Inspector? = nil,
    sheetDetent: SheetDetent = .peek,
    shareOpen: Bool = false,
    printOpen: Bool = false,
    pendingHardEdit: PendingHardEdit? = nil,
    toast: Toast? = nil,
    mapScope: MapScope = .all,
    mapFocusedStopId: String? = nil,
    verdictExpanded: Bool = false,
    pasteOpen: Bool = false,
    editingEntry: UUID? = nil,
    announcement: String? = nil
  ) {
    self.screen = screen
    self.selectedDay = selectedDay
    self.mobileView = mobileView
    self.inspector = inspector
    self.sheetDetent = sheetDetent
    self.shareOpen = shareOpen
    self.printOpen = printOpen
    self.pendingHardEdit = pendingHardEdit
    self.toast = toast
    self.mapScope = mapScope
    self.mapFocusedStopId = mapFocusedStopId
    self.verdictExpanded = verdictExpanded
    self.pasteOpen = pasteOpen
    self.editingEntry = editingEntry
    self.announcement = announcement
  }
}
