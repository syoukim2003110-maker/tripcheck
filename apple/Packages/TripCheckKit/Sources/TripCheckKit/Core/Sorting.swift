import Foundation

/// JS の `<` / `localeCompare` なし比較 = UTF-16 コード単位の辞書順
public func jsStringLess(_ a: String, _ b: String) -> Bool {
  a.utf16.lexicographicallyPrecedes(b.utf16)
}

public func jsStringCompare(_ a: String, _ b: String) -> Int {
  a == b ? 0 : (jsStringLess(a, b) ? -1 : 1)
}

/// TS `String.prototype.localeCompare`(照合順序による比較)。`jsStringLess` の UTF-16 順とは
/// 別物で、"a-stop" < "B-stop"(照合)と "B-stop" < "a-stop"(コード単位)のように**順が入れ替わる**。
///
/// 使い分けの規則は移植元をそのまま写す: **TS が `localeCompare` を呼んでいる箇所は
/// `jsLocaleCompare`、TS が `<` や比較関数なしの `sort()` を使っている箇所は `jsStringLess`**。
/// TS 側の `localeCompare` は 1 箇所ではなく 12 箇所ある(`lib/trip-builder.ts:1035, 1185, 1197,
/// 1298, 1410, 1434, 1724, 1856, 1878, 1879, 1960, 1968`)。
///
/// TS の `localeCompare` は既定ロケール依存 = 実行環境依存だが、移植先は端末をまたいで同じ順に
/// ならなければならない。そこで既定ロケールではなく `en` 固定で比較する。
///
/// TS 側の 12 箇所は全て突き合わせ済みで、対応する Swift 側は次の通り(Task 26 で最後の 5 件を
/// 揃えた):
///
/// | TS `lib/trip-builder.ts` | Swift |
/// | --- | --- |
/// | `:1035`(移動候補のタイブレーク) | `Builder/Clustering.swift` `isBetterFixedDayMove` |
/// | `:1185` / `:1197`(代替モード名) | `Builder/Legs.swift` `leastBroken` |
/// | `:1298`(`deterministicTieBreak`) | `Builder/DayOrdering.swift` `ScheduleOrderScore.<` |
/// | `:1410`(固定順に無い訪問の末尾) | `Builder/DayOrdering.swift` `orderForReservations` |
/// | `:1434`(緊急度順の種) | `Builder/DayOrdering.swift` `urgencySeed` |
/// | `:1724`(割り当て得点のタイブレーク) | `Builder/DayAssignment.swift` `DayAssignmentScore.compare` |
/// | `:1856` / `:1878` / `:1879`(移動候補順) | `Builder/DayAssignment.swift` `movableStops` |
/// | `:1960` / `:1968`(解決済み停留所の選択) | `Builder/TripBuilder.swift` |
///
/// 受け取るのが ASCII の id やモード名であればコード単位順と結果は変わらないが、利用者が付けた
/// 名前から作られる id はいつでも ASCII の外へ出られる。**どちらの順になるかを移植元と同じ関数で
/// 決める**ほうが、一致の根拠として強い。
public func jsLocaleCompare(_ a: String, _ b: String) -> Int {
  switch a.compare(b, options: [], range: nil, locale: Locale(identifier: "en")) {
  case .orderedAscending: return -1
  case .orderedDescending: return 1
  case .orderedSame: return 0
  }
}

/// `Array.prototype.sort` は安定(ES2019 以降)だが Swift の `sorted(by:)` はそうではない。
/// TS の比較関数が 0 を返した組は入力順のまま残さないと結果が変わるので、入力位置を最後の
/// タイブレークに使う。
public func stableSorted<Element>(_ elements: [Element], by areInIncreasingOrder: (Element, Element) -> Bool) -> [Element] {
  elements.enumerated()
    .sorted { left, right in
      if areInIncreasingOrder(left.element, right.element) { return true }
      if areInIncreasingOrder(right.element, left.element) { return false }
      return left.offset < right.offset
    }
    .map(\.element)
}
