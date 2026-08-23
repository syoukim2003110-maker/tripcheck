import SwiftUI

/// 見出しを押すと中身が出る 1 枚。既定は閉じている —— Start 画面に並ぶ条件は全部「任意」で、
/// 開いていること自体が「入れなければならない」という合図になってしまうから。
///
/// `reduceMotion` のときは開閉を animate しない(spec §5.7)。
///
/// 開閉は既定では自分で持つが、`isOpen:` を渡せば外の状態に従う —— 結論の詳細は警告の
/// 一手(「代替案を見る」)から開かれるので、開いているかどうかを画面の側
/// (`view.verdictExpanded`)が知っていなければならない。**折り畳みの見た目と
/// `reduceMotion` の扱いは、それでもここ 1 か所のまま**である。
struct DisclosureCard<Content: View>: View {
  let title: String
  /// 外から開閉を持つときの綱。`nil` なら自分の `@State` で開閉する。
  var isOpen: Binding<Bool>?
  @ViewBuilder let content: () -> Content

  @State private var localIsOpen = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// 今開いているか。外の綱があればそちらが正。
  private var open: Bool { isOpen?.wrappedValue ?? localIsOpen }

  private func toggle() {
    if let isOpen { isOpen.wrappedValue.toggle() } else { localIsOpen.toggle() }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        if reduceMotion {
          toggle()
        } else {
          withAnimation(.easeInOut(duration: 0.2)) { toggle() }
        }
      } label: {
        HStack(spacing: 10) {
          Text(title)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
          IconView(.arrow, size: 16, color: Tokens.Color.muted)
            .rotationEffect(.degrees(open ? 90 : 0))
        }
        .padding(.horizontal, 14)
        .frame(minHeight: Tokens.Hit.primary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(title)
      .accessibilityAddTraits(open ? [.isButton, .isSelected] : .isButton)

      if open {
        content()
          .padding(.horizontal, 14)
          .padding(.bottom, 14)
      }
    }
    .background(
      RoundedRectangle(cornerRadius: Tokens.Radius.card)
        .fill(Tokens.Color.panel)
    )
    .overlay(
      RoundedRectangle(cornerRadius: Tokens.Radius.card)
        .stroke(Tokens.Color.line, lineWidth: 1)
    )
  }
}
