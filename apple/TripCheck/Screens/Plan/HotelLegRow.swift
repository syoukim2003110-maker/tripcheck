import SwiftUI
import TripCheckAppCore

/// その日の最初と最後 —— 宿を出るところと、宿へ戻るところ。
///
/// 1 行 34pt の細い行にしてあるのは、これが**訪問ではない**から。停留所と同じ高さのカードに
/// すると、その日に 2 か所増えたように見える。拠点が決まっていない旅ではこの行そのものが
/// 出ない(`PlannerStore.timelineRows` が作らない)。
struct HotelLegRow: View {
  let model: HotelLegModel

  var body: some View {
    HStack(spacing: 8) {
      IconView(.bed, size: 14, color: Tokens.Color.muted)
      Text(model.label)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 10)
    .frame(minHeight: 34, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.hotelLeg")
  }
}
