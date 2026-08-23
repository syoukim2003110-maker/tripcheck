import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// ファーストビューの問い 4 つ目 ——「最初の停留所」。
///
/// 行まるごとが 1 つのボタン(≥44pt)で、押すと停留所の詳細が開く。丸の中の数はその日の
/// 何番目か、色は地図のピンと同じ日の色 —— タイムラインと地図が同じものを指していることを、
/// 説明ではなく色で言う。
///
/// **文は 1 つも作らない**:滞在の 1 行も、旗の言葉も、アクセスの注記も `ActivityModel` が
/// 運んできたものをそのまま出す(出どころは Kit の `TimelinePresentation` / `PoiAccess`)。
struct ActivityCard: View {
  @Environment(PlannerStore.self) private var store
  let model: ActivityModel

  var body: some View {
    Button { store.openInspector(.stop(model.stopId)) } label: {
      HStack(alignment: .top, spacing: 10) {
        Text(model.time)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
          .frame(width: 44, alignment: .leading)
        marker
        VStack(alignment: .leading, spacing: 2) {
          Text(model.name)
            .tcFont(.stopName)
            .foregroundStyle(Tokens.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
          Text(model.areaAndStay)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.ink2)
            .fixedSize(horizontal: false, vertical: true)
          if let note = model.accessNote {
            HStack(alignment: .top, spacing: 4) {
              IconView(.train, size: 11, color: Tokens.Color.muted)
              Text(note)
                .tcFont(.meta)
                .foregroundStyle(Tokens.Color.muted)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
          if !model.flags.isEmpty { flags }
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(minHeight: Tokens.Hit.primary, alignment: .top)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
    .accessibilityIdentifier("plan.activity")
  }

  /// 番号の丸。TripCheck が自分で挟んだ行は数を持たない —— 番号を振ると、旅行者が
  /// 頼んだ場所と同じ重みに見える。食事は `fork`、それ以外の提案は `spark`。
  private var marker: some View {
    ZStack {
      Circle().fill(Tokens.Day.color(hex: model.colorHex))
      if model.isFiller {
        IconView(model.fillerKind == nil ? .spark : .fork, size: 12, color: Tokens.Color.panel)
      } else {
        Text(model.number.formatted())
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.panel)
      }
    }
    .frame(width: 22, height: 22)
  }

  /// 状態の旗(予約の時刻・遅れ・必須・その日休み・最終入場後)。数は 2 つまでしか立たない
  /// (`TimelinePresentation.activityFlags`)ので、行の中に収まる。
  private var flags: some View {
    HStack(spacing: 4) {
      ForEach(Array(model.flags.enumerated()), id: \.offset) { _, flag in
        Text(flag.label)
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.warnInk)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(RoundedRectangle(cornerRadius: Tokens.Radius.pill).fill(Tokens.Color.warnBg))
          .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.pill).stroke(Tokens.Color.warnBorder, lineWidth: 1))
      }
    }
  }
}
