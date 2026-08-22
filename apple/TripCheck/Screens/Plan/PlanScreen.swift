import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 結果画面。**ファーストビューが 5 つの問いに順番どおり答える**(統合仕様 §5.5):
///
///   1. 旅行は成立するか        —— `HeroHeader`
///   2. いちばん重い心配 1 件    —— `WarningLine`(1 件だけ・行動 1 つ)
///   3. どの日がどれだけ埋まっているか —— `DayTabs` + `DayHeaderRow` + `DayTimeBar`
///   4. 最初の停留所            —— `TimelineList`(Task 7)
///   5. 実際の空きに合う 1 件    —— `SpareLine`
///
/// ダッシュボード(課題・結論の詳細・出発前)は**旅程の後ろ**。順番を入れ替えると、旅行者は
/// 自分の旅を見る前に監査結果を読まされる。
///
/// この画面は数を 1 つも計算しない —— 上の 5 つはどれも `PlannerStore` の導出値そのままで、
/// 同じ数が 2 か所で割れないことを型で守っている。
struct PlanScreen: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    let selectedDay = store.view.selectedDay

    NavigationStack {
      Group {
        if store.view.mobileView == .timeline {
          ScrollView {
            VStack(alignment: .leading, spacing: 12) {
              HeroHeader()
              if let warning = store.primaryWarning { WarningLine(warning: warning) }
              DayTabs()
              DayHeaderRow(index: selectedDay)
              TimelineList(dayIndex: selectedDay)
              if let spare = store.spareCapacityLine(selectedDay) { SpareLine(text: spare) }
              Text(store.statsLine)
                .tcFont(.stats)
                .foregroundStyle(Tokens.Color.ink2)
                .accessibilityIdentifier("plan.stats")
              IssueCard()
              VerdictDetails()
              BeforeYouGoCard()
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        } else {
          TripMapView()
        }
      }
      .background(Tokens.Color.bg)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { PlanToolbar() }
    }
    // 旅程と地図は iPhone では同時に出さない。切替は画面の下、親指の届くところ。
    .safeAreaInset(edge: .bottom) {
      SegmentedPills(
        options: [(MobileView.timeline, app.timelineTab), (MobileView.map, app.mapTab)],
        selection: store.view.mobileView,
        groupLabel: app.viewSwitchLabel,
        onSelect: { store.view.mobileView = $0 }
      )
      .padding(.horizontal, 16)
      .padding(.bottom, 8)
      .background(.ultraThinMaterial)
      .accessibilityIdentifier("plan.view")
    }
    // 組み上がるたびに結論の見出しを 1 度だけ読み上げる(`commit` が置く 1 文)。割り込まない
    // 優先度なので、旅行者が読んでいる途中の文を切らない。
    //
    // `initial: true` が要る —— `RootView` は `.building → .plan` のたびに新しい
    // `PlanScreen` を作り直す(`switch` の枝が変わるので SwiftUI の同一性が切れる)。
    // `commit` は `screen` と `announcement` を同じ同期のブロックで書き換えるので、この
    // 画面が生まれた時点でもう値は変わり終わっている。既定の `initial: false` では
    // 「生まれてから変わった」瞬間が 1 度も来ないため、初回のビルドはもちろん、
    // どの再ビルドでも読み上げが鳴らなかった。
    .onChange(of: store.view.announcement, initial: true) { _, announcement in
      guard let announcement, !announcement.isEmpty else { return }
      AccessibilityNotification.Announcement(announcement).post()
    }
  }
}

#Preview {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  return RootView()
    .environment(store)
    .task { await store.build() }
}
