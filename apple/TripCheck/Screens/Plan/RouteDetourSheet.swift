import SwiftUI
import TripCheckAppCore

/// その日の空き(`bundle.gaps[dayIndex]`)の経路区間に近い寄り道先の一覧。
/// `HotelRecommendationsSheet` を鏡に —— 写真は出さない、テキストのみ + Google マップへの
/// タップスルー。取得は `PlannerStore` が lazy に日ごとに持つ(`gapDetourByDay`)ので、この
/// 画面は状態を読むだけで自分では取りに行かない、ただし**開いている間に候補が消えたら**
/// (再ビルド・日付変更・reset による `invalidateRouteDetour`)もう一度取りに行く —— シートは
/// 開いたままなので、閉じて開き直すまで待たせない。
struct RouteDetourSheet: View {
  let dayIndex: Int
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    let state = store.gapDetourByDay[dayIndex] ?? .loading

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
      .navigationTitle(app.routeDetourSheetTitle)
      .navigationBarTitleDisplayMode(.inline)
    }
    .task { store.loadGapDetour(dayIndex: dayIndex) }
    // 開いている間に候補が消えたら(再ビルド・日付変更・reset)、もう一度取りに行く。
    .onChange(of: store.gapDetourByDay[dayIndex]) { _, now in
      if now == nil { store.loadGapDetour(dayIndex: dayIndex) }
    }
    .accessibilityIdentifier("plan.gapDetour.sheet")
  }

  private func emptyView(_ app: AppCopy) -> some View {
    Text(app.routeDetourEmpty)
      .tcFont(.body)
      .foregroundStyle(Tokens.Color.muted)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(24)
      .accessibilityIdentifier("plan.gapDetour.empty")
  }

  private func card(_ candidate: RouteRecommendation, _ app: AppCopy) -> some View {
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
          if let distance = candidate.routeDistanceMeters {
            Text("\(app.routeDetourDistance) \(Int(distance.rounded()))m")
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
    .accessibilityIdentifier("plan.detourCandidate")
  }
}
