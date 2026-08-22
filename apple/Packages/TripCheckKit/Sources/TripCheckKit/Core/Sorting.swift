import Foundation

/// JS の `<` / `localeCompare` なし比較 = UTF-16 コード単位の辞書順
public func jsStringLess(_ a: String, _ b: String) -> Bool {
  a.utf16.lexicographicallyPrecedes(b.utf16)
}

public func jsStringCompare(_ a: String, _ b: String) -> Int {
  a == b ? 0 : (jsStringLess(a, b) ? -1 : 1)
}

/// TS `String.prototype.localeCompare`(照合順序による比較。`<` の UTF-16 順とは別物)。
///
/// TS 側は既定ロケール依存 = 実行環境依存だが、これを使う唯一の呼び出し元
/// (`DayAssignment` の決定的タイブレーク、`lib/trip-builder.ts:1723`)は**環境をまたいで
/// 同じ順**でなければならない。そこで既定ロケールではなく `en` 固定で比較する — 移植先が
/// どの端末で動いても、また TS 側が英語ロケールで動く限り、同じ日割りに落ち着く。
/// **この関数はそのタイブレーク専用**で、他の文字列比較は `jsStringLess` のままにする
/// (TS 側も `localeCompare` を使っているのはここだけ)。
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
