import Foundation

/// 画面の下に一瞬出る 1 行。`kind` は見た目ではなく**出どころ**で分ける:
/// `.limit` は入力の上限に当たったとき、`.edit` は旅程を書き換えたとき(だいたい `canUndo`)、
/// `.info` はそれ以外の報せ。
///
/// 見た目(`Components/Toast.swift`)は Task 9。この型は状態だけを持つので、
/// `PlannerViewState` が `Equatable` かつ `Sendable` のままでいられる。
public struct Toast: Equatable, Sendable, Identifiable {
  public enum Kind: Equatable, Sendable {
    case limit, edit, info
  }

  public let id: UUID
  public var text: String
  public var kind: Kind
  public var canUndo: Bool

  public init(id: UUID = UUID(), text: String, kind: Kind, canUndo: Bool = false) {
    self.id = id
    self.text = text
    self.kind = kind
    self.canUndo = canUndo
  }
}
