/// JS の `<` / `localeCompare` なし比較 = UTF-16 コード単位の辞書順
public func jsStringLess(_ a: String, _ b: String) -> Bool {
  a.utf16.lexicographicallyPrecedes(b.utf16)
}

public func jsStringCompare(_ a: String, _ b: String) -> Int {
  a == b ? 0 : (jsStringLess(a, b) ? -1 : 1)
}
