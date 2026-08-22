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
/// 現時点でこれを使っているのは `Builder/DayAssignment.swift` だけ(`:1724` のタイブレークと
/// `:1856`/`:1878-1879` の候補順)。TS が `localeCompare` を使っているのに Swift 側がまだ
/// `jsStringLess` のままの箇所 — `Builder/Clustering.swift:173`(TS `:1035`)、
/// `Builder/Legs.swift:162`(TS `:1185`/`:1197`)ほか — は、受け取る id やモード名が ASCII で
/// 両者が一致するという判断でそうなっている。**最終レビューでまとめて突き合わせる宿題として
/// 記録済み**で、この段では触らない。
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
