import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 結果画面のツールバー ——「入力にもどる」と、`•••` の中の Undo / Redo。
///
/// 印刷・共有はまだ乗らない(Task 12 / 13)—— **押しても何も起きないボタンを先に置かない**。
/// 結論の詳細もここには来ない:旅程の下に畳んである折り畳みそのものが入口で、警告の一手
/// (「代替案を見る」)がそれを開く —— メニューにもう 1 つ入口を作ると、開いた先が画面の
/// どこにあるのか分からないまま開くことになる。戻せる履歴が無いときは項目そのものを無効に
/// する:消してしまうと、「元に戻す」がこのアプリに在ることを旅行者が知る機会が無くなる。
struct PlanToolbar: ToolbarContent {
  var body: some ToolbarContent {
    ToolbarItem(placement: .topBarLeading) {
      EditInputButton()
    }
    ToolbarItem(placement: .topBarTrailing) {
      HistoryMenu()
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

/// `•••`。中身は今のところ Undo と Redo の 2 つで、外付けキーボードからは ⌘Z / ⇧⌘Z でも
/// 同じ 2 つに届く(メニューに乗せた `keyboardShortcut` は、長押しの一覧にも出る)。
private struct HistoryMenu: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    Menu {
      Button(app.undoAction) {
        Task {
          await store.undo()
          AccessibilityNotification.Announcement(app.undoneAnnouncement).post()
        }
      }
      .keyboardShortcut("z", modifiers: .command)
      .disabled(!store.canUndo)
      .accessibilityIdentifier("plan.undo")

      Button(app.redoAction) {
        Task {
          await store.redo()
          AccessibilityNotification.Announcement(app.redoneAnnouncement).post()
        }
      }
      .keyboardShortcut("z", modifiers: [.command, .shift])
      .disabled(!store.canRedo)
      .accessibilityIdentifier("plan.redo")
    } label: {
      // `•••` は絵ではなく約物なので、`Design/Icons` の 24 種にも SF Symbols にも要らない。
      Text(verbatim: "•••")
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)
    }
    .accessibilityLabel(app.moreActions)
    .accessibilityIdentifier("plan.more")
  }
}
