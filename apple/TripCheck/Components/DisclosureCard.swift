import SwiftUI

/// 見出しを押すと中身が出る 1 枚。既定は閉じている —— Start 画面に並ぶ条件は全部「任意」で、
/// 開いていること自体が「入れなければならない」という合図になってしまうから。
///
/// `reduceMotion` のときは開閉を animate しない(spec §5.7)。
struct DisclosureCard<Content: View>: View {
  let title: String
  @ViewBuilder let content: () -> Content

  @State private var isOpen = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        if reduceMotion {
          isOpen.toggle()
        } else {
          withAnimation(.easeInOut(duration: 0.2)) { isOpen.toggle() }
        }
      } label: {
        HStack(spacing: 10) {
          Text(title)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
          IconView(.arrow, size: 16, color: Tokens.Color.muted)
            .rotationEffect(.degrees(isOpen ? 90 : 0))
        }
        .padding(.horizontal, 14)
        .frame(minHeight: Tokens.Hit.primary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(title)
      .accessibilityAddTraits(isOpen ? [.isButton, .isSelected] : .isButton)

      if isOpen {
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
