import SwiftUI
import TripCheckAppCore

/// ファーストビューの問い 2 つ目 ——「いちばん重い心配 1 件」と、それに答える一手 1 つ。
///
/// **1 件しか出ない**(どれを出すかは `PlannerStore.primaryWarning` が決める)。心配を並べる
/// 画面は、どれから手を付けるかを旅行者に決めさせる。それは製品の仕事である。
struct WarningLine: View {
  let warning: (text: String, action: PlanWarningAction?)

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(warning.text)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.warnInk)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)

      if let action = warning.action {
        WarningActionButton(action: action)
      }
    }
    .padding(12)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.warnBg))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.warnBorder, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("plan.warning")
  }
}

/// 一手 1 つのボタン。**行き先の表はここ 1 か所**にしかない —— 課題カード(Task 10)も
/// 同じ行動を出すので、2 つ目の表を作ると同じボタンが画面ごとに違う場所へ飛ぶ。
struct WarningActionButton: View {
  @Environment(PlannerStore.self) private var store
  let action: PlanWarningAction

  var body: some View {
    Button(action.label(store.request.locale)) { perform() }
      .buttonStyle(.secondaryPill)
      .tcFont(.body)
      .accessibilityIdentifier("plan.warning.action")
  }

  private func perform() {
    switch action {
    // 場所が決まっていない・同名の候補が残っている:直せるのは入力そのもの。
    case .fixInput:
      store.view.screen = .start
    // 国と候補は確認画面が受け持つ(国のセレクタも候補の一覧もそこにある)。
    case .chooseCountry, .chooseCandidate:
      store.view.screen = .resolve
    // 代替案と「減らし方」はどちらも結論の詳細の中(Task 10 が中身を入れる)。
    case .openAlternatives, .removeOptional:
      store.view.verdictExpanded = true
    // 営業時間を確かめる相手が 1 つに決まっているとき。シートは Task 9 が開く。
    case .openStop(let stopId):
      store.view.inspector = .stop(stopId)
    case .retryBuild:
      Task { await store.build() }
    }
  }
}
