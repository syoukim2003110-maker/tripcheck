import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// ファーストビューの問い 3 つ目の後半 ——「その日はどれだけ埋まっているか」。
///
/// 見出しが持つ数はちょうど 2 つ(か所数と余裕)。時計の範囲と合計は日の設定の中にいる
/// (v1.1 TC-032)—— 見出しに 4 つ数を並べると、どれが答えなのか読み取れなくなる。
struct DayHeaderRow: View {
  @Environment(PlannerStore.self) private var store
  let index: Int

  var body: some View {
    let header = store.dayHeader(index)

    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(store.dayDateLabel(index))
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Day.color(index: index))
        Text(header.summary)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink2)
        Spacer(minLength: 0)
      }

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
