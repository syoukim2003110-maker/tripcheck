import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 地図の左下の凡例。**線の意味**(実経路と推定)、**点の意味**(予定地点とおすすめ地点)、
/// 出ている日の色、そして地図に何を出すか(全日程 / この日)。
///
/// 言葉は Kit の `legend*` から取る —— 凡例が読む語と、ピンが耳に名乗る語
/// (`MapPin.a11y`)は同じ 1 か所から出ていなければ、凡例が凡例でなくなる。
///
/// 折り畳めるのは、地図そのものが答えだから。開いたままの札が旅程の 1 日ぶんを隠すくらいなら、
/// 見出しだけ残して閉じられるほうがよい(既定は開いた状態 —— 破線が何を意味するのかを、
/// 初めて見る人が探しに行かなくて済むように)。
struct MapLegend: View {
  let days: [(index: Int, colorHex: String)]
  @Binding var scope: MapScope

  @Environment(PlannerStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isOpen = true
  /// 「全日程 | この日」の幅。札は字と一緒に伸びるので、枠も伸ばす。
  @ScaledMetric(relativeTo: .caption2) private var scopeWidth: CGFloat = 190

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 8) {
      Button {
        if reduceMotion { isOpen.toggle() } else { withAnimation(.easeInOut(duration: 0.2)) { isOpen.toggle() } }
      } label: {
        HStack(spacing: 6) {
          Text(text.legendLabel).tcFont(.label).foregroundStyle(Tokens.Color.ink2)
          IconView(.arrow, size: 12, color: Tokens.Color.muted)
            .rotationEffect(.degrees(isOpen ? -90 : 90))
        }
        // 地図の上のボタンは 44pt を割ってはいけない —— 外した指はそのまま地図を掴んで
        // 動かすので、押し損ないが「畳めなかった」ではなく「見ていた場所を見失った」になる。
        .frame(minHeight: Tokens.Hit.primary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(text.legendLabel)
      .accessibilityAddTraits(isOpen ? [.isButton, .isSelected] : .isButton)

      if isOpen {
        dayRow
        line(dashed: false, label: text.legendMeasured)
        line(dashed: true, label: text.legendEstimated)
        symbol(label: text.legendAnchor) { numberSample }
        symbol(label: text.legendSuggestion) { IconView(.spark, size: 14, color: Tokens.Color.ink2) }
        SegmentedPills(
          options: [(MapScope.all, app.mapScopeAll), (MapScope.day, app.mapScopeDay)],
          selection: scope,
          groupLabel: app.mapScopeLabel,
          onSelect: { scope = $0 }
        )
        // 190pt は既定の文字サイズでの幅。字と一緒に広げないと、accessibility5 で
        // 「全日程」が 1 文字ずつ縦に折れた(シミュレータで撮った)。
        .frame(maxWidth: scopeWidth)
      }
    }
    .padding(10)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel.opacity(0.94)))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("map.legend")
  }

  /// 出ている日の色。押すとその日が選ばれる(地図の色とタイムラインの日が同じものを指す)。
  private var dayRow: some View {
    HStack(spacing: 6) {
      ForEach(days.indices, id: \.self) { position in
        let day = days[position]
        let color = Tokens.Day.color(hex: day.colorHex)
        let isSelected = day.index == store.view.selectedDay
        Button { store.selectDay(day.index) } label: {
          Text((day.index + 1).formatted())
            .tcFont(.label)
            .foregroundStyle(isSelected ? Tokens.Color.panel : color)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: 24, height: 24)
            .background(Circle().fill(isSelected ? color : Tokens.Color.panel))
            .overlay(Circle().stroke(color, lineWidth: 1.5))
            // 同じ理由で日ボタンも 44pt 角。見た目の丸は 24pt のまま(札が旅程を隠さない)。
            .frame(minWidth: Tokens.Hit.primary, minHeight: Tokens.Hit.primary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TimelinePresentation.dayTabTitle(index: day.index, locale: store.request.locale))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Copy.for(store.request.locale).dayTabsLabel)
  }

  /// 線の見本 1 行。破線は地図に出ているものと**同じ間隔**で描く —— 見本と実物の刻みが
  /// 違うと、凡例は別の線の説明に見える。
  private func line(dashed: Bool, label: String) -> some View {
    HStack(spacing: 8) {
      Path { path in
        path.move(to: CGPoint(x: 0, y: 1))
        path.addLine(to: CGPoint(x: 26, y: 1))
      }
      .stroke(
        Tokens.Color.ink2,
        style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: dashed ? TripMapView.dash : [])
      )
      .frame(width: 26, height: 2)
      Text(label).tcFont(.label).foregroundStyle(Tokens.Color.ink2)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }

  private func symbol(label: String, @ViewBuilder mark: () -> some View) -> some View {
    HStack(spacing: 8) {
      mark().frame(width: 26)
      Text(label).tcFont(.label).foregroundStyle(Tokens.Color.ink2)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }

  /// 番号入りの丸(予定地点の見本)。選んでいる日の色で出す。
  private var numberSample: some View {
    Text((store.view.selectedDay + 1).formatted())
      .tcFont(.label)
      .foregroundStyle(Tokens.Color.panel)
      .lineLimit(1)
      .minimumScaleFactor(0.5)
      .frame(width: 18, height: 18)
      .background(Circle().fill(Tokens.Day.color(index: store.view.selectedDay)))
  }
}
