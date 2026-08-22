import SwiftUI
import TripCheckAppCore

/// いちばん外側の画面。出ているものは `store.view.screen` ただ 1 つで決まる —— 画面が自分で
/// 「次はどこ」を覚えないので、どの道から来ても同じ状態には同じ画面が出る。
///
/// `.building` / `.plan` は Task 6 が中身を入れるまでの置き札。
struct RootView: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    switch store.view.screen {
    case .start:
      StartScreen()
    case .resolve:
      ResolveScreen()
    case .building:
      placeholder("building")
    case .plan:
      placeholder("plan")
    case .error(let code):
      placeholder(code)
    }
  }

  /// 機械が読む短い語をそのまま出す置き札。旅行者に見せる文ではないので、文言表には無い。
  private func placeholder(_ code: String) -> some View {
    Text(verbatim: code)
      .tcFont(.display)
      .foregroundStyle(Tokens.Color.ink)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Tokens.Color.bg)
  }
}

#Preview {
  RootView().environment(PlannerStore(resolvers: [], store: nil))
}
