import SwiftUI
import TripCheckAppCore

/// 経路アンカーがあるときに旅程の後ろへ挿す破線カード。`MealRow` と同じ「これは旅程ではなく
/// 提案です」の印(`Tokens.Color.recommendation` の破線)——実線のカードにすると、
/// TripCheck が勝手に足した行が旅行者の頼んだ場所と同じ顔になる。
///
/// タップすると `HotelRecommendationsSheet` が開き、そこで初めて経路全体に近い宿を lazy に
/// 取りに行く(`PlannerStore.loadHotelRecommendations`)。カードの側は取得を始めない —— 開く
/// 前から通信すると、見えているだけで通信量を使う旅行者が出る。
struct SuggestedHotelsCard: View {
  @Environment(PlannerStore.self) private var store
  @State private var showing = false

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    HStack(spacing: 10) {
      IconView(.bed, size: 14, color: Tokens.Color.recommendation)
      Text(app.suggestedHotelsTitle)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)
        .fixedSize(horizontal: false, vertical: true)
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
    .accessibilityIdentifier("plan.suggestedHotels")
    .accessibilityAddTraits(.isButton)
    .accessibilityHint(app.mealRecommendationsHint)
    .sheet(isPresented: $showing) {
      HotelRecommendationsSheet()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
  }
}
