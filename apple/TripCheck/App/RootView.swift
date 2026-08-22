import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// いちばん外側の画面。出ているものは `store.view.screen` ただ 1 つで決まる —— 画面が自分で
/// 「次はどこ」を覚えないので、どの道から来ても同じ状態には同じ画面が出る。
struct RootView: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    switch store.view.screen {
    case .start:
      StartScreen()
    case .resolve:
      ResolveScreen()
    case .building:
      BuildScreen()
    case .plan:
      PlanScreen()
    case .error(let code):
      ErrorScreen(code: code)
    }
  }
}

/// 組み立てが 1 日も返さなかったときの行き止まり。
///
/// `code` は機械が読む短い語(`"empty"` など)で、**旅行者には見せない** —— 見せるのは
/// 何が起きたかと、そこから出る道 1 つだけ。識別子には残すので、UI テストは原因で選べる。
private struct ErrorScreen: View {
  @Environment(PlannerStore.self) private var store
  let code: String

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Spacer(minLength: 0)

      IconView(.search, size: 28, color: Tokens.Color.muted)

      Text(AppCopy.for(store.request.locale).planErrorMessage)
        .tcFont(.stopName)
        .foregroundStyle(Tokens.Color.ink)
        .fixedSize(horizontal: false, vertical: true)

      Spacer(minLength: 0)

      Button(Copy.for(store.request.locale).edit) { store.view.screen = .start }
        .buttonStyle(.primaryAccent)
        .tcFont(.stats)
        .accessibilityIdentifier("error.edit")
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(Tokens.Color.bg)
    .accessibilityIdentifier("error.\(code)")
  }
}

#Preview {
  RootView().environment(PlannerStore(resolvers: [], store: nil))
}
