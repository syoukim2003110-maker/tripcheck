import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 組み立て中の画面。
///
/// 段は 2 つ(近い場所をまとめる → 回る順を整える)。3 つ目の「ホテルと食事の候補を探す」は
/// 提供元を呼ぶ段なので、鍵ゼロのこのアプリには来ない —— 起きないことを進行中と見せない。
///
/// 段の一覧は**進み具合の計器ではない**。`BuildRunner.run` は 1 本の同期計算で、途中の位置を
/// 外へ知らせない(知らせるようにすれば嘘のない計器になるが、そのために純関数を割る価値は
/// 無い)。ここに出るのは「いま何をしているか」の説明で、先頭の段だけが太字なのはそのため。
/// 実際この画面はほとんど一瞬で通り過ぎる。
struct BuildScreen: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let text = Copy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 16) {
      Spacer(minLength: 0)

      ProgressView()
        .controlSize(.large)
        .tint(Tokens.Color.accent)
        .frame(maxWidth: .infinity)

      Text(text.buildingTitle)
        .tcFont(.screenTitle)
        .foregroundStyle(Tokens.Color.ink)

      Text(text.buildingBodyNoSocial)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)

      VStack(alignment: .leading, spacing: 8) {
        stage(text.buildSteps.grouping, isCurrent: true)
        stage(text.buildSteps.ordering, isCurrent: false)
      }
      .accessibilityElement(children: .combine)

      Spacer(minLength: 0)

      Button(text.buildingCancel) { store.cancelBuild() }
        .buttonStyle(.secondaryPill)
        .tcFont(.body)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("build.cancel")
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(Tokens.Color.bg)
    // 出来上がりは `view.announcement`(結論の見出し)が読み上げる。ここは「まだ途中」を
    // 邪魔にならない優先度で伝えるだけ。
    .accessibilityElement(children: .contain)
    .accessibilityLabel(text.buildingTitle)
  }

  private func stage(_ label: String, isCurrent: Bool) -> some View {
    HStack(spacing: 8) {
      Circle()
        .fill(isCurrent ? Tokens.Color.accent : Tokens.Color.line)
        .frame(width: 8, height: 8)
      Text(label)
        .tcFont(isCurrent ? .stats : .body)
        .foregroundStyle(isCurrent ? Tokens.Color.ink : Tokens.Color.muted)
    }
  }
}

#Preview {
  let store = PlannerStore(resolvers: [], store: nil)
  store.view.screen = .building
  return RootView()
    .environment(store)
    .environment(WorkerSuggestions(client: CannedWorkerClient()))
}
