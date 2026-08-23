import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 停留所と停留所のあいだの 1 件。
///
/// v3.1 §5.2:移動は**キャプションではなくカード**。閉じているときの 1 行が、旅行者が実際に
/// 知りたい 2 つ —— この区間がどこからどこへ行くのか、何回乗り換えるのか —— を表に出す。
/// 開くと手段を選べる(各手段に分数が付く)。押すと開く行そのものが「開きます」と言うので、
/// 「変更する」の文字リンクは要らない。
///
/// **見出しに「約」は出ない**(`legHeadline`)。推定であることは開いた先の 1 行が言う ——
/// 数字の横に毎回「約」を置くと、確かめた区間と見積もりの区間の見分けが付かなくなる。
struct MovementCard: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let model: MovementModel
  /// Task 9 がガード付きの編集に差し替える。Task 7 では `TimelineList` が最小の
  /// `setLegMode` を渡す。
  let onSelectMode: (TransportMode) -> Void

  @State private var isOpen = false

  var body: some View {
    let text = Copy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 0) {
      Button { toggle() } label: {
        HStack(spacing: 10) {
          IconView(Icon(rawValue: model.icon) ?? .train, size: 16, color: Tokens.Color.ink2)
          VStack(alignment: .leading, spacing: 1) {
            Text(model.summary)
              .tcFont(.body)
              .foregroundStyle(Tokens.Color.ink2)
              .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: "\(model.from) → \(model.to)")
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
              .lineLimit(1)
              .truncationMode(.middle)
          }
          Spacer(minLength: 0)
          IconView(.arrow, size: 14, color: Tokens.Color.muted)
            .rotationEffect(.degrees(isOpen ? 90 : 0))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minHeight: Tokens.Hit.primary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(isOpen ? [.isButton, .isSelected] : .isButton)

      if isOpen {
        VStack(alignment: .leading, spacing: 8) {
          SegmentedPills(
            options: model.options.map { (value: $0.mode, label: "\($0.label) \(text.minutes($0.minutes))") },
            selection: selectedMode,
            groupLabel: text.legModes,
            onSelect: onSelectMode,
            disabled: Set(model.options.filter { !$0.enabled }.map(\.mode)),
            identifier: { "plan.movement.mode.\($0.rawValue)" }
          )
          if let evidence = model.evidenceLine {
            HStack(alignment: .top, spacing: 4) {
              IconView(.signal, size: 11, color: Tokens.Color.muted)
              Text(evidence)
                .tcFont(.meta)
                .foregroundStyle(Tokens.Color.muted)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 10)
      }
    }
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.tile))
    .accessibilityIdentifier("plan.movement")
  }

  /// いま使われている手段。`options` は必ずそれを含む(エンジンの推薦か、旅行者の指定
  /// そのもの)ので、既定には落ちない。
  private var selectedMode: TransportMode {
    model.options.first { $0.selected }?.mode ?? .transit
  }

  private func toggle() {
    if reduceMotion {
      isOpen.toggle()
    } else {
      withAnimation(.easeInOut(duration: 0.2)) { isOpen.toggle() }
    }
  }
}
