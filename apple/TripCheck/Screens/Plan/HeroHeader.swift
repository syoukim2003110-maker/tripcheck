import SwiftUI
import TripCheckAppCore

/// ファーストビューの問い 1 つ目 ——「この旅行は成立するか」。
///
/// 1 文と 1 つの絵だけ。絵は文を置き換えず、色を見分けにくい読み手にも意味が届くように
/// **文が単独で答えを言い切る**(絵は `accessibilityHidden`)。
struct HeroHeader: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let hero = store.hero
    if !hero.text.isEmpty {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        IconView(Icon(rawValue: hero.icon) ?? .search, size: 22, color: Self.tint(hero.icon))
          .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
        Text(hero.text)
          .tcFont(.hero)
          .foregroundStyle(Tokens.Color.ink)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier("plan.hero")
    }
  }

  /// 状態の色。緑は「無理なく回れる」だけに使い、赤は本当に直さないと成り立たないときだけ
  /// —— どちらも安売りすると、次に見たとき読み飛ばされる。
  private static func tint(_ icon: String) -> Color {
    switch icon {
    case "check": Tokens.Color.good
    case "close": Tokens.Color.danger
    case "spark": Tokens.Color.warnInk
    case "search": Tokens.Color.muted
    default: Tokens.Color.ink
    }
  }
}
