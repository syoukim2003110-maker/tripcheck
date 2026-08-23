import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// ファーストビューの問い 3 つ目の後半 ——「その日はどれだけ埋まっているか」。
///
/// 見出しが持つ数はちょうど 2 つ(か所数と余裕)。時計の範囲と合計は日の設定の中にいる
/// (v1.1 TC-032)—— 見出しに 4 つ数を並べると、どれが答えなのか読み取れなくなる。
///
/// 見出しの行そのものが日の設定への入口(Task 9)。その日の時計を変えたくなるのは
/// **その日を見ているとき**なので、設定を別の画面へ追いやらない。
struct DayHeaderRow: View {
  @Environment(PlannerStore.self) private var store
  let index: Int

  var body: some View {
    let header = store.dayHeader(index)
    let app = AppCopy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 6) {
      Button { store.openInspector(.daySettings(index)) } label: {
        HStack(spacing: 8) {
          Text(store.dayDateLabel(index))
            .tcFont(.dayHeader)
            .foregroundStyle(Tokens.Day.color(index: index))
          Text(header.summary)
            .tcFont(.dayHeader)
            .foregroundStyle(Tokens.Color.ink2)
          Spacer(minLength: 0)
          IconView(.arrow, size: 14, color: Tokens.Color.muted)
        }
        .frame(minHeight: Tokens.Hit.primary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(store.dayDateLabel(index)) \(header.summary)")
      .accessibilityHint(app.daySettingsTitle)
      .accessibilityIdentifier("plan.daySettings")

      if header.bar.isEmpty {
        Text(Copy.for(store.request.locale).openDay)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
      } else {
        DayTimeBar(bar: header.bar, dayColor: Tokens.Day.color(index: index))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityIdentifier("plan.dayHeader")
  }
}
