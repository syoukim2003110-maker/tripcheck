import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 確認画面の 1 行。状態は 3 つで、出る的もそのぶんだけ変わる:
///
///   - **確認済み** —— 名前と住所だけ。押すものは「外す」しかない。
///   - **候補待ち** —— 「どちらの『X』ですか？」と最大 3 件の候補、そして「候補にない」。
///     4 件目以降の選択肢は**作らない**(パイプラインが結果の側で 3 件に切っている)。
///   - **見つからない** —— 「もう一度探す」「入力を直す」「地図で場所を指定する」の 3 つ。
///
/// 4 件目以降の確認が要る行(`suppressed`)は候補を出さず、抑止の 1 文だけを出す ——
/// 一度に 3 件までしか尋ねないのは、確認画面が作業表になった瞬間に全部いい加減に押される
/// から(Web `ResolveScreen.tsx:218-219`)。
struct ResolveRow: View {
  let row: ResolveRowModel
  let locale: PlannerLocale
  /// 候補 1 行の説明に使う「ほかの決まった場所」。距離の但し書き(「他の場所から約3km」)は
  /// これが無いと出せない。
  let anchors: [ResolvedStop]
  /// いま何かを探している最中。探している間は「もう一度探す」を押させない。
  let isSearching: Bool
  let onChoose: (PlaceCandidate) -> Void
  let onReject: () -> Void
  let onRetry: () -> Void
  let onEditInput: () -> Void
  let onPinOnMap: () -> Void
  let onRemove: () -> Void

  var body: some View {
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)

    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        IconView(statusIcon, size: 15, color: statusColor)
        // 絵は読み上げない(`IconView` の約束)ので、状態は名前の「値」として読ませる ——
        // VoiceOver は「ベルン、確認済み」と読む。
        Text(row.name)
          .tcFont(.stopName)
          .foregroundStyle(Tokens.Color.ink)
          .frame(maxWidth: .infinity, alignment: .leading)
          .accessibilityValue(statusLabel(app))
        Button(action: onRemove) {
          IconView(.close, size: 16, color: Tokens.Color.muted)
            .frame(width: Tokens.Hit.primary, height: Tokens.Hit.primary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text.resolveRemoveAria(row.input))
      }

      if row.suppressed {
        Text(app.resolveDeferred)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
      } else {
        switch row.state {
        case .confirmed:
          if !row.address.isEmpty {
            Text(row.address)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
          }
        case .review:
          candidates(app: app)
        case .unresolved:
          notFound(app: app)
        }
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(borderColor, lineWidth: 1))
  }

  // MARK: - 状態ごとの中身

  /// 候補は縦に積む —— 1 件の説明(名前・住所・国・距離)が横並びに収まらないので、
  /// 押す前に読めることを幅より優先する。
  private func candidates(app: AppCopy) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(app.resolveCandidateQuestion(name: row.input))
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)

      VStack(spacing: 6) {
        ForEach(row.candidates, id: \.stop.id) { candidate in
          Button { onChoose(candidate) } label: {
            Text(TripPresentation.placeCandidateLabel(candidate: candidate.stop, anchors: anchors, locale: locale))
              .tcFont(.body)
              .multilineTextAlignment(.leading)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .buttonStyle(.secondaryPill)
        }

        Button(app.resolveNoneOfThese, action: onReject)
          .buttonStyle(.secondaryPill)
          .tcFont(.body)
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(app.resolveCandidatesLabel(name: row.input))
    }
  }

  /// 見つからなかった行の 3 つの道。どれも「進む」を邪魔しない —— 進むかどうかは画面下の
  /// ボタンが決める(未解決のまま進めること自体は止めない)。
  private func notFound(app: AppCopy) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(app.resolveNotFound)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.warnInk)

      Button(app.resolveSearchAgain, action: onRetry)
        .buttonStyle(.secondaryPill)
        .tcFont(.body)
        .disabled(isSearching)

      Button(app.resolveEditName, action: onEditInput)
        .buttonStyle(.secondaryPill)
        .tcFont(.body)

      Button(app.resolvePinOnMap, action: onPinOnMap)
        .buttonStyle(.secondaryPill)
        .tcFont(.body)
    }
  }

  // MARK: - 行頭の絵

  /// 探している間は探している絵にする —— 「見つからない」と「まだ探している」が同じ顔だと、
  /// 旅行者は同じボタンをもう一度押す。
  private var statusIcon: Icon {
    if isSearching, row.state != .confirmed { return .search }
    return switch row.state {
    case .confirmed: .check
    case .review: .mark
    case .unresolved: .close
    }
  }

  private var statusColor: Color {
    switch row.state {
    case .confirmed: Tokens.Color.good
    case .review: Tokens.Color.warnInk
    case .unresolved: Tokens.Color.danger
    }
  }

  private var borderColor: Color {
    row.state == .confirmed || row.suppressed ? Tokens.Color.line : Tokens.Color.warnBorder
  }

  private func statusLabel(_ app: AppCopy) -> String {
    switch row.state {
    case .confirmed: app.resolveStatusConfirmed
    case .review: app.resolveStatusReview
    case .unresolved: app.resolveStatusUnresolved
    }
  }
}
