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
///
/// 基底が `.loaded` になった後にだけ、入れ子の「最新の声」節(`/api/place-intelligence/fresh`)を
/// 出す —— これも展開でだけ取りに行く 2 度目のタップ(opt-in、depth "quick" = 1 unit)。
struct PlaceIntelligenceDisclosure: View {
  let stopId: String
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    DisclosureCard(title: app.placeIntelligenceTitle) {
      content(app)
        .task { store.loadPlaceIntelligence(stopId: stopId) }
        // 開いている最中に再ビルド(背景の経路差し替え等)で候補が消えたら、閉じ開きを
        // 待たずに取り直す(食事シートと同じ自己回復)。
        .onChange(of: store.placeIntelligenceByStop[stopId]) { _, now in
          if now == nil { store.loadPlaceIntelligence(stopId: stopId) }
        }
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
      // 「最新の声」の題材は解決済みの基底結果から組む(web の checkPlace と同じ)。検証済み
      // 停留所は name/address が必ず埋まるので、空ガードは防御的な保険。
      let freshName = result.place.name.isEmpty ? result.place.address : result.place.name
      let freshArea = result.place.address.isEmpty ? result.place.name : String(result.place.address.prefix(100))
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
          if let status = result.place.businessStatus, status != "OPERATIONAL" {
            Text(app.placeIntelligenceClosed)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.accent)
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
        // 入れ子の「最新の声」。折り畳んだ札のラベルが「見る」CTA を兼ね、開いた初回だけ取りに行く。
        DisclosureCard(title: app.freshVoicesExpand) {
          freshContent(app)
            .task { store.loadFreshVoices(stopId: stopId, name: freshName, area: freshArea) }
            .onChange(of: store.freshVoicesByStop[stopId]) { _, now in
              if now == nil { store.loadFreshVoices(stopId: stopId, name: freshName, area: freshArea) }
            }
        }
        .accessibilityIdentifier("plan.placeIntelligence.fresh")
      }
      .accessibilityIdentifier("plan.placeIntelligence.loaded")
    }
  }

  /// 入れ子の「最新の声」節の中身。基底カードと同じ状態機械(読取中→スピナー、取得不可/空→
  /// 1 行、取得済み→節見出し + 要約 + 出典行)。写真・絵文字は出さない。
  @ViewBuilder private func freshContent(_ app: AppCopy) -> some View {
    switch store.freshVoicesByStop[stopId] {
    case .some(.loading), .none:
      ProgressView()
        .frame(maxWidth: .infinity, alignment: .leading)
    case .some(.unavailable):
      Text(app.freshVoicesEmpty)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .accessibilityIdentifier("plan.placeIntelligence.fresh.unavailable")
    case .some(.loaded(let fresh)):
      if fresh.summary.isEmpty, fresh.findings.isEmpty {
        Text(app.freshVoicesEmpty)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
          .accessibilityIdentifier("plan.placeIntelligence.fresh.unavailable")
      } else {
        VStack(alignment: .leading, spacing: 8) {
          Text(app.freshVoicesTitle)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
          if !fresh.summary.isEmpty {
            Text(fresh.summary)
              .tcFont(.body)
              .foregroundStyle(Tokens.Color.ink2)
              .fixedSize(horizontal: false, vertical: true)
          }
          ForEach(Array(fresh.findings.enumerated()), id: \.offset) { _, finding in
            VStack(alignment: .leading, spacing: 2) {
              if let url = URL(string: finding.url) {
                Link(destination: url) {
                  Text(finding.title)
                    .tcFont(.meta)
                    .foregroundStyle(Tokens.Color.ink2)
                }
              } else {
                Text(finding.title)
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.ink2)
              }
              if !finding.note.isEmpty {
                Text(finding.note)
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.muted)
                  .fixedSize(horizontal: false, vertical: true)
              }
              HStack(spacing: 8) {
                Text(freshSourceLabel(app, finding.sourceKind))
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.muted)
                if finding.isRecent == true || finding.age != nil {
                  Text(app.freshVoicesRecent)
                    .tcFont(.meta)
                    .foregroundStyle(Tokens.Color.recommendation)
                }
              }
            }
            .accessibilityIdentifier("plan.placeIntelligence.fresh.finding")
          }
        }
        .accessibilityIdentifier("plan.placeIntelligence.fresh.loaded")
      }
    }
  }

  /// web の `sourceKind` を UI ラベルへ。未知値は「ウェブ」に寄せる(web の既定と同じ)。
  private func freshSourceLabel(_ app: AppCopy, _ kind: String) -> String {
    switch kind {
    case "social": return app.freshSourceSocial
    case "news": return app.freshSourceNews
    case "blog": return app.freshSourceBlog
    default: return app.freshSourceWeb
    }
  }
}
