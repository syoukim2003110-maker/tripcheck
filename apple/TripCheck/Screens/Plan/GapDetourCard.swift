import SwiftUI
import TripCheckAppCore

/// その日にいちばん埋める価値のある空き(`bundle.gaps[dayIndex]`)があるときに旅程の後ろへ
/// 挿す破線カード。`SuggestedHotelsCard` と同じ「これは旅程ではなく提案です」の印
/// (`Tokens.Color.recommendation` の破線)——実線のカードにすると、TripCheck が勝手に足した
/// 行が旅行者の頼んだ場所と同じ顔になる。
///
/// タップすると `RouteDetourSheet` が開き、そこで初めてその空きの経路区間に近い寄り道先を
/// lazy に取りに行く(`PlannerStore.loadGapDetour`)。カードの側は取得を始めない —— 開く前
/// から通信すると、見えているだけで通信量を使う旅行者が出る。
struct GapDetourCard: View {
  let dayIndex: Int
  @Environment(PlannerStore.self) private var store
  @State private var showing = false

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    HStack(spacing: 10) {
      IconView(.pin, size: 14, color: Tokens.Color.recommendation)
      VStack(alignment: .leading, spacing: 2) {
        Text(app.gapDetourTitle)
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.ink2)
          .fixedSize(horizontal: false, vertical: true)
        Text(store.gapDetourTimeRange(dayIndex) ?? "")
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
      }
      Spacer(minLength: 0)
      Text(app.mealRecommendationsHint)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.recommendation)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .frame(minHeight: 40, alignment: .leading)
    .overlay(
      RoundedRectangle(cornerRadius: Tokens.Radius.control)
        .strokeBorder(Tokens.Color.recommendation, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
    )
    .contentShape(Rectangle())
    .onTapGesture { showing = true }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.gapDetour")
    .accessibilityAddTraits(.isButton)
    .accessibilityHint(app.mealRecommendationsHint)
    .sheet(isPresented: $showing) {
      RouteDetourSheet(dayIndex: dayIndex)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
  }
}
