import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// その日の停留所(ホテル出発 → 移動 → 訪問 → 食事枠 → … → 帰着)。
///
/// この画面は**並びを決めない** —— どの行がどの順で出るかは `PlannerStore.timelineRows(_:)`
/// が畳み、ここは受け取った順に 4 種の行を描くだけ。並べ替えの規則(食事枠は時刻順に、
/// まだ過ぎていない最後の停留所の後ろ)が画面側にもあると、Kit の単体テストが守っている
/// はずの規則が黙って 2 つになる。
struct TimelineList: View {
  @Environment(PlannerStore.self) private var store
  let dayIndex: Int

  var body: some View {
    let text = Copy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 8) {
      ForEach(store.timelineRows(dayIndex)) { row in
        switch row {
        case .hotelLeg(let model):
          HotelLegRow(model: model)
        case .movement(let model):
          // Task 9 がガード付きの編集(聞いてから直す)に差し替える。
          MovementCard(model: model) { mode in
            Task { await store.setLegMode(legKey: model.legKey, mode: mode) }
          }
        case .activity(let model):
          ActivityCard(model: model)
        case .meal(let model):
          MealRow(model: model)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    // 一覧であることを読み上げに残す(「4 件中 2 件目」が読めないと、日を追えない)。
    .accessibilityElement(children: .contain)
    .accessibilityLabel(text.dayTimelineLabel(store.dayDateLabel(dayIndex)))
    .accessibilityIdentifier("plan.timeline")
  }
}
