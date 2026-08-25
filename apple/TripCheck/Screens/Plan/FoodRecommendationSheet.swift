import SwiftUI
import TripCheckAppCore

/// 食事枠 1 つの候補一覧。破線の「提案」(`MealRow`)を、タップで開く一覧に広げる。
///
/// 写真は出さない —— テキストのみ + Google マップへのタップスルー。取得は `PlannerStore` が
/// lazy に持つ(`foodRecommendationsBySlot`)ので、この画面は状態を読むだけで自分では取りに
/// 行かない、ただし**開いている間に候補が消えたら**(再ビルド・日付変更・reset による
/// `invalidateFoodRecommendations`)もう一度取りに行く —— シートは開いたままなので、閉じて
/// 開き直すまで待たせない。
struct FoodRecommendationSheet: View {
  let slotId: String
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    let state = store.foodRecommendationsBySlot[slotId] ?? .loading

    NavigationStack {
      Group {
        switch state {
        case .loading:
          ProgressView()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let candidates) where candidates.isEmpty:
          emptyView(app)
        case .unavailable:
          emptyView(app)
        case .loaded(let candidates):
          ScrollView {
            VStack(spacing: 10) {
              ForEach(candidates) { candidate in card(candidate, app) }
            }
            .padding(16)
          }
        }
      }
      .background(Tokens.Color.bg)
      .navigationTitle(app.mealRecommendationsTitle)
      .navigationBarTitleDisplayMode(.inline)
    }
    .task { store.loadFoodRecommendations(slotId: slotId) }
    // 開いている間に候補が消えたら(再ビルド・日付変更・reset)、もう一度取りに行く。
    .onChange(of: store.foodRecommendationsBySlot[slotId]) { _, new in
      if new == nil { store.loadFoodRecommendations(slotId: slotId) }
    }
    .accessibilityIdentifier("plan.mealRecommendations.sheet")
  }

  private func emptyView(_ app: AppCopy) -> some View {
    Text(app.mealRecommendationsEmpty)
      .tcFont(.body)
      .foregroundStyle(Tokens.Color.muted)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(24)
      .accessibilityIdentifier("plan.mealRecommendations.empty")
  }

  private func card(_ candidate: FoodCandidate, _ app: AppCopy) -> some View {
    Link(destination: URL(string: candidate.googleMapsUrl) ?? URL(string: "https://maps.google.com")!) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(candidate.name)
            .tcFont(.stopName)
            .foregroundStyle(Tokens.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
          Spacer(minLength: 0)
          IconView(.external, size: 14, color: Tokens.Color.ink2)
        }
        Text(candidate.type.replacingOccurrences(of: "_", with: " "))
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
        HStack(spacing: 8) {
          if let rating = candidate.rating {
            Text(String(format: "%.1f", rating) + (candidate.userRatingCount.map { " (\($0))" } ?? ""))
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
          }
          if let distance = candidate.distanceMeters {
            Text("\(distance) m")
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
          }
          if candidate.openNow == true {
            Text(app.openNowLabel)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.recommendation)
          }
        }
        if !candidate.address.isEmpty {
          Text(candidate.address)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
            .lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
      .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("plan.foodCandidate")
  }
}
