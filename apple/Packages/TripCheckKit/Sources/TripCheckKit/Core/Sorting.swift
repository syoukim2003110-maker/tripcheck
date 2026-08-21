/// JS の `<` / `localeCompare` なし比較 = UTF-16 コード単位の辞書順
public func jsStringLess(_ a: String, _ b: String) -> Bool {
  a.utf16.lexicographicallyPrecedes(b.utf16)
}

public func jsStringCompare(_ a: String, _ b: String) -> Int {
  a == b ? 0 : (jsStringLess(a, b) ? -1 : 1)
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
