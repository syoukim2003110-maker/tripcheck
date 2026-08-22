import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 結果画面のツールバー。
///
/// いま乗っているのは「入力にもどる」1 つだけ。`•••`(結論の詳細・Undo・Redo・印刷・共有)は
/// その中身を作る課題(Task 9 / 10)が、言語の切替は Task 14 が足す —— **押しても何も起きない
/// ボタンを先に置かない**。
struct PlanToolbar: ToolbarContent {
  var body: some ToolbarContent {
    ToolbarItem(placement: .topBarLeading) {
      EditInputButton()
    }
  }
}

/// `ToolbarContent` は View ではないので、環境を読む側を 1 枚挟む。
private struct EditInputButton: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    // 幅は自分で決めない。ツールバーの項目は当たり判定を自前で持っていて、`frame` を
    // 足すと文字のほうが先に切れる(「入力にもどる」が「力にもど」になった)。
    Button(Copy.for(store.request.locale).edit) { store.view.screen = .start }
      .tcFont(.body)
      .foregroundStyle(Tokens.Color.ink2)
      .lineLimit(1)
      .accessibilityIdentifier("plan.edit")
  }
}
