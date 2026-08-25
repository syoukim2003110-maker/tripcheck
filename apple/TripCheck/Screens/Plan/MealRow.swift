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
  @Environment(PlannerStore.self) private var store

  /// 時刻の列は字と一緒に伸びる(`ActivityCard` と同じ理由・同じ上限)。
  @ScaledMetric(relativeTo: .footnote) private var rawTimeWidth: CGFloat = 44
  private var timeWidth: CGFloat { min(rawTimeWidth, 96) }

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    HStack(spacing: 10) {
      Text(model.time)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(width: timeWidth, alignment: .leading)
      IconView(.fork, size: 14, color: Tokens.Color.recommendation)
      Text(model.label)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
      // 候補一覧が開けることを示す控えめなヒント。破線の枠・`Spacer` はそのまま残す。
      Text(app.mealRecommendationsHint)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.recommendation)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .frame(minHeight: 40, alignment: .leading)
    .overlay(
      RoundedRectangle(cornerRadius: Tokens.Radius.control)
        .strokeBorder(Tokens.Color.recommendation, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
    )
    .contentShape(Rectangle())
    .onTapGesture {
      store.openInspector(.mealRecommendations(model.slotId))
      store.loadFoodRecommendations(slotId: model.slotId)
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.meal")
    .accessibilityAddTraits(.isButton)
    .accessibilityHint(app.mealRecommendationsHint)
  }
}
