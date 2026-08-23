import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 結果画面のツールバー ——「入力にもどる」と、`日本語 | EN`、`•••` の中の Undo / Redo /
/// 共有 / 印刷。
///
/// 結論の詳細はここには来ない:旅程の下に畳んである折り畳みそのものが入口で、警告の一手
/// (「代替案を見る」)がそれを開く —— メニューにもう 1 つ入口を作ると、開いた先が画面の
/// どこにあるのか分からないまま開くことになる。戻せる履歴が無いときは項目そのものを無効に
/// する:消してしまうと、「元に戻す」がこのアプリに在ることを旅行者が知る機会が無くなる。
struct PlanToolbar: ToolbarContent {
  var body: some ToolbarContent {
    ToolbarItem(placement: .topBarLeading) {
      EditInputButton()
    }
    ToolbarItem(placement: .principal) {
      LanguagePills()
    }
    ToolbarItem(placement: .topBarTrailing) {
      HistoryMenu()
    }
  }
}

/// `日本語 | EN`。
///
/// **旅程の真上に居る**のは、切り替えて何が変わるのかがその場で見えるから —— 設定画面の
/// 奥に置くと、旅行者は戻ってくるまで結果を確かめられない。押しても旅程は組み直さない:
/// 座標も分も変わらず、言葉だけが言い直される(`PlannerStore.changeLocale`)。
///
/// 札は**どちらの言語で見ていても同じ 2 語**にしてある。英語で見ている旅行者が日本語へ
/// 戻したいとき、探す語が「Japanese」に化けていると自分の言語を見つけられない。
private struct LanguagePills: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    SegmentedPills(
      options: [(PlannerLocale.ja, app.languageJa), (PlannerLocale.en, app.languageEn)],
      selection: store.request.locale,
      groupLabel: app.languageSwitchLabel,
      onSelect: { store.changeLocale($0) },
      identifier: { "plan.language.\($0.rawValue)" }
    )
    // 錠剤は**中身の幅**で置く。`SegmentedPills` は既定で 1 枚ずつを端まで伸ばすので、
    // ツールバーの真ん中に幅を決め打ちで嵌めると「日本語」が縦に 3 行へ折れ、名札の帯が
    // 倍の高さになった(組んだ bundle で見た)。折らないと決めれば、詰まったときに縮むのは
    // 隣の「入力にもどる」で、あちらは既に `lineLimit(1)` を持っている。
    .fixedSize(horizontal: true, vertical: false)
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

/// `•••`。中身は Undo と Redo と共有と印刷で、外付けキーボードからは ⌘Z / ⇧⌘Z でも
/// 最初の 2 つに届く(メニューに乗せた `keyboardShortcut` は、長押しの一覧にも出る)。
///
/// 共有が**メニューの中**にあるのは、押した先が配る動作ではなく「何を渡すか」を決める
/// 画面だからである。ツールバーに置くと 1 手で配れるように見えるが、ホテルの名前や予約の
/// 印が入るかどうかは、その 1 手の前に見せなければならない。
///
/// 印刷はその共有の**次**に置く。同じ「他の人・他の紙に渡す」仕事だが、リンクは相手の端末で
/// 開くもの、紙は端末が要らないもの —— 並べておくと、電池の切れた旅先で何を持っていれば
/// よかったのかが、選ぶ時点で目に入る。
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

      Button(app.shareAction) { store.view.shareOpen = true }
        .accessibilityIdentifier("plan.share")

      // 文言は Kit の `print`(「印刷 / PDF」)—— Web のメニューと同じ 1 語で呼ぶ。
      Button(Copy.for(store.request.locale).print) { store.view.printOpen = true }
        .accessibilityIdentifier("plan.print")
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
