import SwiftUI
import TripCheckAppCore

/// 停留所シートの「この場所について」。Google 検証済み(`StopInspectorModel.isProviderVerified`)
/// の停留所だけに出る、既定で閉じた開示カード。写真は出さない。
///
/// **開いた初回だけ Worker に尋ねる**(inspector を開く度には取らない = 1 unit/展開)。
/// `DisclosureCard` は開いている間しか中身を描かない(`if open { content() }`)ので、その中身に
/// 付けた `.task` が「初めて開いたとき」の入口になる —— `expanded` の `@State` をもう一組
/// ここに持つ必要はない。閉じて開き直すたびに `.task` はもう一度走るが、`loadPlaceIntelligence`
/// は `.loading`/`.loaded` なら無視して戻るので、二重に取りに行くことはない。
struct PlaceIntelligenceDisclosure: View {
  let stopId: String
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    DisclosureCard(title: app.placeIntelligenceTitle) {
      content(app)
        .task { store.loadPlaceIntelligence(stopId: stopId) }
    }
    .accessibilityIdentifier("plan.placeIntelligence")
  }

  @ViewBuilder private func content(_ app: AppCopy) -> some View {
    switch store.placeIntelligenceByStop[stopId] {
    case .some(.loading), .none:
      ProgressView()
        .frame(maxWidth: .infinity, alignment: .leading)
    case .some(.unavailable):
      Text(app.placeIntelligenceUnavailable)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .accessibilityIdentifier("plan.placeIntelligence.unavailable")
    case .some(.loaded(let result)):
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          if let rating = result.place.rating {
            Text(String(format: "%.1f", rating) + (result.place.userRatingCount.map { " (\($0))" } ?? ""))
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
          }
          if result.place.openNow == true {
            Text(app.placeIntelligenceOpenNow)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.recommendation)
          }
        }
        if !result.analysis.summary.isEmpty {
          Text(result.analysis.summary)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
            .fixedSize(horizontal: false, vertical: true)
        }
        ForEach(result.place.hours, id: \.self) { line in
          Text(line)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
        }
        ForEach(result.reviews.prefix(2)) { review in
          if let text = review.text, !text.isEmpty {
            Text(text)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
              .lineLimit(3)
          }
        }
        if let url = URL(string: result.place.googleMapsUrl) {
          Link(destination: url) {
            Text(result.place.address)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
          }
        }
      }
      .accessibilityIdentifier("plan.placeIntelligence.loaded")
    }
  }
}
