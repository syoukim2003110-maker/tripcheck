import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// ファーストビューの問い 3 つ目の前半 ——「どの日を見ているか」。
///
/// 選ばれている 1 枚はその日の色で塗り、ほかは同じ色の輪郭だけ。色は地図のピンと同じ
/// `DayPalette` の 7 色なので、タブと地図が同じ日を同じ色で指す。
///
/// 読み上げは「日程を選ぶ」というひとまとまりのタブ列。1 枚ごとの `accessibilityValue` が
/// 混み具合(「4か所」「ゆったり」)なので、日を選ぶ前に**その日がどれだけ埋まっているか**が
/// 耳でも分かる。
struct DayTabs: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let tabs = store.dayTabs
    let selected = store.view.selectedDay

    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(tabs) { tab in
          let isSelected = tab.index == selected
          let color = Tokens.Day.color(index: tab.index)
          Button { store.selectDay(tab.index) } label: {
            VStack(spacing: 2) {
              Text(tab.label).tcFont(.stats)
              Text(tab.density).tcFont(.label)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: Tokens.Hit.primary)
            .foregroundStyle(isSelected ? Tokens.Color.panel : color)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(isSelected ? color : Tokens.Color.panel))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(color, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.control))
          }
          .buttonStyle(.plain)
          .accessibilityLabel(tab.label)
          .accessibilityValue(tab.density)
          .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
          .accessibilityIdentifier("plan.dayTab.\(tab.index)")
        }
      }
      .padding(.horizontal, 1)   // 輪郭 1pt が端で切れないぶん
    }
    .scrollBounceBehavior(.basedOnSize)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Copy.for(store.request.locale).dayTabsLabel)
    .accessibilityAddTraits(.isTabBar)
  }
}
