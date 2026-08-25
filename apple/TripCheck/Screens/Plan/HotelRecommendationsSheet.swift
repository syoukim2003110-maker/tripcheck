import SwiftUI
import TripCheckAppCore

/// 経路全体に近い宿の候補一覧。`FoodRecommendationSheet` を鏡に —— 写真は出さない、
/// テキストのみ + Google マップへのタップスルー。取得は `PlannerStore` が lazy に持つ
/// (`hotelRecommendations`)ので、この画面は状態を読むだけで自分では取りに行かない、
/// ただし**開いている間に候補が消えたら**(再ビルド・日付変更・reset による
/// `invalidateHotelRecommendations`)もう一度取りに行く —— シートは開いたままなので、
/// 閉じて開き直すまで待たせない。
struct HotelRecommendationsSheet: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    let state = store.hotelRecommendations ?? .loading

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
      .navigationTitle(app.hotelRecommendationsSheetTitle)
      .navigationBarTitleDisplayMode(.inline)
    }
    .task { store.loadHotelRecommendations() }
    // 開いている間に候補が消えたら(再ビルド・日付変更・reset)、もう一度取りに行く。
    .onChange(of: store.hotelRecommendations) { _, now in
      if now == nil { store.loadHotelRecommendations() }
    }
    .accessibilityIdentifier("plan.hotelRecommendations.sheet")
  }

  private func emptyView(_ app: AppCopy) -> some View {
    Text(app.hotelRecommendationsEmpty)
      .tcFont(.body)
      .foregroundStyle(Tokens.Color.muted)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(24)
      .accessibilityIdentifier("plan.hotelRecommendations.empty")
  }

  private func card(_ candidate: HotelCandidate, _ app: AppCopy) -> some View {
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
        HStack(spacing: 8) {
          if let rating = candidate.rating {
            Text(String(format: "%.1f", rating) + (candidate.userRatingCount.map { " (\($0))" } ?? ""))
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
          }
          if let burden = candidate.routeBurdenMeters {
            Text("\(app.hotelRouteBurden) \(String(format: "%.1f", burden / 1000)) km")
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
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
    .accessibilityIdentifier("plan.hotelCandidate")
  }
}
