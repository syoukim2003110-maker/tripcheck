import SwiftUI

/// 3 つ前後の選択肢を横に並べ、1 つだけを選ぶ。優先度(通常・必須・任意)、ペース、移動手段が
/// 同じ形を使う。
///
/// 選ばれている 1 つは色だけでなく `check` の絵でも示す —— 色の差だけだと、色を見分けにくい
/// 読み手に「どれが選ばれているか」が伝わらない。読み上げには `isSelected` を渡すので、
/// VoiceOver は「選択中」と読む。
struct SegmentedPills<Value: Hashable>: View {
  let options: [(value: Value, label: String)]
  let selection: Value
  /// この一組そのものの名前(「〜の優先度」など)。
  let groupLabel: String
  let onSelect: (Value) -> Void

  var body: some View {
    HStack(spacing: 6) {
      ForEach(Array(options.indices), id: \.self) { index in
        let option = options[index]
        let isSelected = option.value == selection
        Button { onSelect(option.value) } label: {
          HStack(spacing: 4) {
            Text(option.label).tcFont(.label)
            if isSelected { IconView(.check, size: 11, color: Tokens.Color.accentDeep) }
          }
          .padding(.horizontal, 12)
          .frame(minHeight: Tokens.Hit.primary)
          .frame(maxWidth: .infinity)
          .foregroundStyle(isSelected ? Tokens.Color.accentDeep : Tokens.Color.ink2)
          .background(
            RoundedRectangle(cornerRadius: Tokens.Radius.control)
              .fill(isSelected ? Tokens.Color.accentSoft : Tokens.Color.tile)
          )
          .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.control)
              .stroke(isSelected ? Tokens.Color.accent : Tokens.Color.line, lineWidth: 1)
          )
          .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.control))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(groupLabel)
  }
}
