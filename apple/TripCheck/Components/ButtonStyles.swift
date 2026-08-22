import SwiftUI

/// 押せるものの見た目は 2 つだけ —— 画面ごとに 1 つの主ボタン(赤)と、それ以外(枠だけ)。
///
/// どちらも高さの下限は `Tokens.Hit.primary`(44pt)。ボタンの中身が小さくても、指で押せる
/// 大きさは形のほうが持つ。
struct PrimaryAccentButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View { Surface(configuration: configuration) }

  /// `@Environment` は View にしか流れてこないので、押せるかどうかを読むために 1 枚挟む。
  private struct Surface: View {
    @Environment(\.isEnabled) private var isEnabled
    let configuration: PrimaryAccentButtonStyle.Configuration

    var body: some View {
      configuration.label
        .foregroundStyle(isEnabled ? Tokens.Color.panel : Tokens.Color.muted)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary)
        .background(
          RoundedRectangle(cornerRadius: Tokens.Radius.control)
            .fill(fill)
        )
        .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.control))
    }

    private var fill: Color {
      guard isEnabled else { return Tokens.Color.tileDeep }
      return configuration.isPressed ? Tokens.Color.accentDeep : Tokens.Color.accent
    }
  }
}

/// 枠だけの丸い錠剤。主ボタンと並んでも競らない。
struct SecondaryPillButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View { Surface(configuration: configuration) }

  private struct Surface: View {
    @Environment(\.isEnabled) private var isEnabled
    let configuration: SecondaryPillButtonStyle.Configuration

    var body: some View {
      configuration.label
        .foregroundStyle(isEnabled ? Tokens.Color.ink2 : Tokens.Color.muted)
        .padding(.horizontal, 16)
        .frame(minHeight: Tokens.Hit.primary)
        .background(
          RoundedRectangle(cornerRadius: Tokens.Radius.pill)
            .fill(configuration.isPressed ? Tokens.Color.tileDeep : Tokens.Color.panel)
        )
        .overlay(
          RoundedRectangle(cornerRadius: Tokens.Radius.pill)
            .stroke(Tokens.Color.line, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.pill))
    }
  }
}

extension ButtonStyle where Self == PrimaryAccentButtonStyle {
  static var primaryAccent: PrimaryAccentButtonStyle { PrimaryAccentButtonStyle() }
}

extension ButtonStyle where Self == SecondaryPillButtonStyle {
  static var secondaryPill: SecondaryPillButtonStyle { SecondaryPillButtonStyle() }
}
