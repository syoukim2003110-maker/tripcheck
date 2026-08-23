import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 1 日を上から下へ読んだときの並びと、その行が名乗る言葉。
 *
 * ここが守るのは 4 つ:行の順(移動が 2 つ続かない・食事枠が出る)、滞在の長さが誰の言い分か
 * (推定は「目安」、旅行者が決めたら「滞在」)、食事行のラベルが Kit のものであること、
 * 徒歩の選択肢が 90 分を超えたら選べないこと。
 */

/// 行は「訪問 → 移動 → 訪問」の順で交互に出る。移動が 2 つ続くのは、間の停留所が消えた
/// ときにだけ起こる形 —— 起きたら旅程が 1 か所ぶん抜けている。
@Test @MainActor func timelineRowsAlternateMovementAndActivity() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let rows = store.timelineRows(0)
  let kinds = rows.map { r -> String in if case .activity = r { return "A" }; if case .movement = r { return "M" }; if case .meal = r { return "F" }; return "H" }
  #expect(!kinds.isEmpty)
  #expect(kinds.first == "A" || kinds.first == "H")
  #expect(!kinds.joined().contains("MM"))
  #expect(rows.contains { if case .meal = $0 { return true }; return false })
}

/// 滞在の長さは、誰が決めたかで名詞が変わる。TripCheck の見積もりは「滞在の目安」、旅行者が
/// 指定した長さは「滞在」—— バッジを外した v3.1 では、この 1 語だけが不確かさを運ぶ。
@Test @MainActor func estimatedStayUsesTheWordMeyasuUntilTheTravellerSetsIt() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let rows = store.timelineRows(0)
  guard let a = rows.lazy.compactMap({ if case .activity(let m) = $0 { return m }; return nil }).first else { Issue.record("day 0 has no activity row"); return }
  #expect(a.areaAndStay.contains("目安"))   // TimelinePresentation.stayLine(.estimated, .ja)
  await store.setStayMinutes(stopId: a.stopId, minutes: 120)   // Task 9 のガード付き編集。Task 7 時点では PlannerStore+Edits の最小実装
  guard let b = store.timelineRows(0).lazy.compactMap({ if case .activity(let m) = $0, m.stopId == a.stopId { return m }; return nil }).first else { Issue.record("stop vanished"); return }
  #expect(!b.areaAndStay.contains("目安"))   // 指定した長さは「滞在」
}

/// 食事行の見出しは Kit の `fillerRowLabel` そのもの。「昼食のおすすめ」であって「目安」では
/// ない —— 枠は提案であって、そこに何分いるかの見積もりではない。
@Test @MainActor func mealRowLabelComesFromTheKit() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let meals = store.timelineRows(0).compactMap { if case .meal(let m) = $0 { return m }; return nil }
  #expect(!meals.isEmpty)
  for m in meals { #expect(m.label == TimelinePresentation.fillerRowLabel(m.kind == .lunch ? .lunch : .dinner, locale: .ja)) }
}

/// 徒歩は 90 分まで。それを超える区間で徒歩を選べる画面は、選べば必ず日程が壊れる選択肢を
/// 差し出していることになる。選択肢そのものは消さない(何分かかるかは事実)。
@Test @MainActor func walkOptionOnlyUpToNinetyMinutes() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  var checked = 0
  for day in 0..<4 {
    for row in store.timelineRows(day) {
      if case .movement(let m) = row, let walk = m.options.first(where: { $0.mode == .walk }), let minutes = m.walkMinutes {
        checked += 1; #expect(walk.enabled == (minutes <= 90)); #expect(walk.minutes == minutes)
      }
    }
  }
  #expect(checked > 0)
}

/// 鍵ゼロの今のアプリでは Filler の停留所は 1 つも作れない —— ビルダーが作る
/// `BuiltPlanStop` は常に `kind: .place, mealKind: nil`(`DayClock.swift:153-158`)。
/// この表明が赤くなったら、それは「Filler が出るようになった」ではなく「実装が
/// コメントの言う唯一の出どころ(`built.kind`/`mealKind`)から外れた」ことを疑う。
@Test @MainActor func noStopIsEverAFillerInTheKeyZeroApp() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let dayCount = store.bundle?.plan.days.count ?? 0
  #expect(dayCount > 0)
  var checked = 0
  for day in 0..<dayCount {
    for row in store.timelineRows(day) {
      if case .activity(let m) = row {
        checked += 1
        #expect(!m.isFiller)
        #expect(m.fillerKind == nil)
      }
    }
  }
  #expect(checked > 0)
}

/// `TimelineRow.id` は `ForEach` がそのまま使う。同じ 2 地点を 1 日に何度も行き来する
/// 旅程では区間の id が `legKey` だけでは足りない(2 度目が 1 度目とかぶる)——
/// サンプルの全ての日で、行 id に重複が無いことを刺しておく。
@Test @MainActor func timelineRowIdsAreUniquePerDay() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let dayCount = store.bundle?.plan.days.count ?? 0
  #expect(dayCount > 0)
  for day in 0..<dayCount {
    let ids = store.timelineRows(day).map(\.id)
    #expect(!ids.isEmpty)
    #expect(Set(ids).count == ids.count)
  }
}
