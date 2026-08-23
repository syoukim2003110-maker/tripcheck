import SwiftUI
import TripCheckAppCore

/// 食事の枠 1 つ。時刻と「昼食のおすすめ」だけ。
///
/// 破線の枠(`Tokens.Color.recommendation`)は「これは旅程ではなく提案です」の印。実線の
/// カードにすると、TripCheck が勝手に足した行が旅行者の頼んだ場所と同じ顔になる ——
/// product.md の Anchor / Filler 則がいちばん嫌う形。
///
/// 店の候補はここには出ない(次の spec)。**枠そのものは事実**なので行は残る ——
/// 動線のこの時刻に食事の時間が空いている、というのは旅程の情報である。
struct MealRow: View {
  let model: MealModel

  var body: some View {
    HStack(spacing: 10) {
      Text(model.time)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .frame(width: 44, alignment: .leading)
      IconView(.fork, size: 14, color: Tokens.Color.recommendation)
      Text(model.label)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .frame(minHeight: 40, alignment: .leading)
    .overlay(
      RoundedRectangle(cornerRadius: Tokens.Radius.control)
        .strokeBorder(Tokens.Color.recommendation, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
    )
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.meal")
  }
}
