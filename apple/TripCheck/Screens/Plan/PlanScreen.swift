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
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    @Bindable var store = store
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
              HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(store.statsLine)
                  .tcFont(.stats)
                  .foregroundStyle(Tokens.Color.ink2)
                  .accessibilityIdentifier("plan.stats")
                Spacer(minLength: 0)
                if let progress = store.routeProgressLine { RouteProgressLine(text: progress) }
              }
              .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.routeProgressLine)
              IssueCard()
              VerdictDetails()
              if store.hotelRecommendationsAvailable { SuggestedHotelsCard() }
              if store.gapDetourAvailable(selectedDay) { GapDetourCard(dayIndex: selectedDay) }
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
    // 旅程と地図は iPhone では同時に出さない。切替は画面の下、親指の届くところ。トーストは
    // その真上 —— 押した指がまだ画面の下にあるうちに「元に戻す」へ届く。
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 8) {
        // `.id(toast.id)` が要る。付けないと 2 つ目のトーストは同じビューの中身を
        // 差し替えるだけになり、`ToastView` の `.onAppear` が二度と走らない ——
        // 6 秒の間に別の編集をした旅行者に、読み上げは**何も告げなくなる**。
        if let toast = store.view.toast { ToastView(toast: toast).id(toast.id) }
        SegmentedPills(
          options: [(MobileView.timeline, app.timelineTab), (MobileView.map, app.mapTab)],
          selection: store.view.mobileView,
          groupLabel: app.viewSwitchLabel,
          onSelect: { store.view.mobileView = $0 },
          identifier: { $0 == .map ? "plan.view.map" : "plan.view.timeline" }
        )
        .padding(.horizontal, 16)
        .accessibilityIdentifier("plan.view")
      }
      .padding(.bottom, 8)
      .background(.ultraThinMaterial)
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.view.toast)
    }
    // 詳細シート。3 段の高さで、いちばん低い「覗く」から始まる(`openInspector` が毎回
    // そこへ戻す)—— 前に全画面まで引き上げたことが、次に軽く覗きたいときの邪魔にならない。
    .sheet(item: $store.view.inspector) { target in
      switch target {
      case .stop(let stopId):
        StopInspector(stopId: stopId)
          .presentationDetents([.fraction(0.3), .medium, .large], selection: detent)
          .presentationDragIndicator(.visible)
      case .daySettings(let day):
        DaySettingsSheet(day: day)
          .presentationDetents([.medium, .large])
          .presentationDragIndicator(.visible)
      case .mealRecommendations(let slotId):
        FoodRecommendationSheet(slotId: slotId)
          .presentationDetents([.fraction(0.3), .medium, .large], selection: detent)
          .presentationDragIndicator(.visible)
      }
    }
    // 何を渡すかを決める 1 枚。**全画面の高さで出す** —— 4 つの選択と、その結果として何が
    // 隠れるかの文と、配る 2 本のボタンは 1 つの判断で、途中で切れていると「何を渡すか」を
    // 決める前に配るボタンが目に入る(半分の高さで実際にそうなった)。
    .sheet(isPresented: $store.view.shareOpen) {
      ShareSheet()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
    // 紙にする 1 枚。**低い高さで足りる** —— この画面が持っているのは受け渡しだけで、
    // 何を載せるかの選択が無い(紙には全部載る)。共有の 1 枚が全画面なのと対になる:
    // あちらは 4 つの選択を先に見せなければならず、こちらは見せるものが 2 行しかない。
    .sheet(isPresented: $store.view.printOpen) {
      PrintSheet()
        .presentationDetents([.fraction(0.3), .large])
        .presentationDragIndicator(.visible)
    }
    // 重い結果の出る編集は**先に訊く**(v1.1 TC-007)。題は Kit が決める —— 新しい損傷が
    // ちょうど 1 件の予約遅れなら「この変更で予約に N 分遅れます」、それ以外は編集ごとの
    // 問いかけがそのまま残る(`PlannerEdits.confirmTitle`)。
    //
    // ここに `AccessibilityNotification.Announcement` は**足さない**。警告は modal として
    // 出るので、UIKit が提示の瞬間に screen-changed を投げ、VoiceOver は焦点を移して題と
    // 本文を読む —— 自前の 1 文を重ねると、同じ題が 2 度鳴る。読み上げを自分で出すのは、
    // 焦点の動かない変化(組み上がり・Undo・Redo・トースト)の側だけである。
    .alert(hardEditTitle, isPresented: hardEditPresented) {
      Button(app.hardEditCancel, role: .cancel) { store.cancelPendingEdit() }
      Button(app.hardEditConfirm, role: .destructive) { Task { await store.confirmPendingEdit() } }
    } message: {
      Text(hardEditBody)
    }
    // 端末を振ると 1 つ前へ。iOS の作法どおり `UIWindow.motionEnded` から届く。
    .onReceive(NotificationCenter.default.publisher(for: .tripCheckShakeToUndo)) { _ in
      guard store.canUndo else { return }
      Task {
        await store.undo()
        AccessibilityNotification.Announcement(app.undoneAnnouncement).post()
      }
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

  // MARK: - シートの高さ

  /// `SheetDetent`(AppCore の 3 値)と SwiftUI の高さの往復。AppCore は SwiftUI を知らない
  /// ので、対応表はここに置く。
  private var detent: Binding<PresentationDetent> {
    @Bindable var store = store
    return Binding(
      get: {
        switch store.view.sheetDetent {
        case .peek: .fraction(0.3)
        case .half: .medium
        case .full: .large
        }
      },
      set: { value in
        store.view.sheetDetent = value == .large ? .full : value == .medium ? .half : .peek
      }
    )
  }

  // MARK: - 確認ダイアログ

  /// 出ているかどうか。**`.edit` だけを見る** —— `.mustUnresolved` は確認画面(Task 5)の
  /// ダイアログで、こちらが横取りすると同じ問いが 2 枚出る。
  private var hardEditPresented: Binding<Bool> {
    Binding(
      get: { if case .edit = store.view.pendingHardEdit { true } else { false } },
      set: { shown in if !shown { store.cancelPendingEdit() } }
    )
  }

  private var hardEditTitle: String {
    guard case .edit(let conflicts, let extra, let fallback)? = store.view.pendingHardEdit else { return "" }
    return PlannerEdits.confirmTitle(
      conflicts: conflicts,
      extraConflicts: extra,
      fallback: fallback,
      locale: store.request.locale
    )
  }

  /// 本文は壊れる約束を 1 行ずつ。Kit の判定文が先、アプリ側の但し書き(必須指定・予約済み)が
  /// 後 —— 旅程そのものが壊れる話を、指定の話より先に読ませる。
  private var hardEditBody: String {
    guard case .edit(let conflicts, let extra, _)? = store.view.pendingHardEdit else { return "" }
    return (conflicts.map(\.message) + extra).joined(separator: "\n")
  }
}

#Preview {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  return RootView()
    .environment(store)
    .environment(WorkerSuggestions(client: CannedWorkerClient()))
    .task { await store.build() }
}
