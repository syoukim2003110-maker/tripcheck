import SwiftUI

/// 統計行の横の小さな進捗。文言は `PlannerStore.routeProgressLine` が決め、ここは描くだけ(`SpareLine` と同じ作り)。
/// 全部測れたら store が nil を返し、この行そのものが消える。
struct RouteProgressLine: View {
  let text: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      IconView(.signal, size: 11, color: Tokens.Color.muted)
      Text(text)
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.routeProgress")
  }
}
