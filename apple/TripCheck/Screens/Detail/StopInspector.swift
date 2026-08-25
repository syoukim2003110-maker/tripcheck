import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 停留所 1 つの詳細。旅程のカードか地図のピンを押すと、下から出てくる 1 枚。
///
/// 並びは「読むもの → 変えるもの → 出ていくもの」:名前と番号、日を移す錠剤、根拠の開閉部、
/// この場所の条件、地図の入口、そして**いちばん最後に**赤い「予定から外す」。外すのが最後で
/// 赤いのは、指が滑って触れる場所に取り返しの付かない一手を置かないためである(同じ規則が
/// Start 画面の行編集シートにもある)。
///
/// この画面は数も文も作らない —— 全部 `PlannerStore.inspector(for:)` が Kit から引いて
/// 並べ終えたものを、受け取った順に描くだけ。書き換えはどれも `store` の編集 1 本を通るので、
/// **押した場所が違っても守られ方は同じ**になる(v1.1 TC-007)。
struct StopInspector: View {
  @Environment(PlannerStore.self) private var store
  let stopId: String

  /// 番号の丸は字と一緒に伸びる。決め打ちの 24pt のままだと、accessibility5 で中の数が
  /// 欠ける(`ActivityCard` と同じ)—— 上限は 44pt。
  @ScaledMetric(relativeTo: .caption2) private var rawBadgeSize: CGFloat = 24
  private var badgeSize: CGFloat { min(rawBadgeSize, 44) }

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    NavigationStack {
      ScrollView {
        if let model = store.inspector(for: stopId) {
          VStack(alignment: .leading, spacing: 12) {
            header(model)
            if model.dayOptions.count > 1 { dayPills(model, text: text) }
            EvidenceDisclosure(model: model)
            if model.isProviderVerified {
              PlaceIntelligenceDisclosure(stopId: model.stopId)
            }
            ConditionsDisclosure(model: model)
            mapLinks(model, text: text, app: app)
            if model.canRemove { removeButton(model, text: text) }
          }
          .padding(20)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .background(Tokens.Color.bg)
      .navigationTitle(store.inspector(for: stopId)?.name ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(text.close) { store.closeInspector() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.accentDeep)
            .accessibilityIdentifier("detail.close")
        }
      }
    }
    .accessibilityIdentifier("detail.sheet")
  }

  // MARK: - 読むもの

  /// 番号の丸(日の色)と、名前・「1日目 · 10:30 · ツェルマット」。丸の色が地図のピンと
  /// 同じなのは、シートと地図が同じものを指していることを説明ではなく色で言うため。
  private func header(_ model: StopInspectorModel) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text(String(model.number))
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.panel)
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(width: badgeSize, height: badgeSize)
        .background(Circle().fill(Tokens.Day.color(index: model.dayIndex)))
      VStack(alignment: .leading, spacing: 2) {
        Text(model.name)
          .tcFont(.stopName)
          .foregroundStyle(Tokens.Color.ink)
          .fixedSize(horizontal: false, vertical: true)
        Text(model.meta)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }

  // MARK: - 変えるもの

  /// 日を移す。いま居る日をもう一度押すと自動配置へ戻る(押せる状態のまま残すのは、
  /// 「今この日に固定されている」ことが押してみるまで分からないと困るから)。
  private func dayPills(_ model: StopInspectorModel, text: PlannerCopy) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(text.moveDay)
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.muted)
      SegmentedPills(
        options: model.dayOptions.map {
          (value: $0, label: TimelinePresentation.dayTabTitle(index: $0, locale: store.request.locale))
        },
        selection: model.dayIndex,
        groupLabel: text.moveDay,
        onSelect: { day in Task { await store.moveStop(id: model.stopId, toDay: day) } }
      )
    }
    .accessibilityIdentifier("detail.moveDay")
  }

  /// 地図の入口 2 つ。組み立てられなかった URL は**出さない** —— 押しても何も起きない
  /// リンクを置かない。
  @ViewBuilder private func mapLinks(_ model: StopInspectorModel, text: PlannerCopy, app: AppCopy) -> some View {
    VStack(spacing: 8) {
      if let url = model.appleMapsUrl { mapLink(app.openAppleMaps, url: url, identifier: "detail.appleMaps") }
      if let url = model.mapsUrl { mapLink(text.openMaps, url: url, identifier: "detail.googleMaps") }
    }
  }

  private func mapLink(_ title: String, url: URL, identifier: String) -> some View {
    Link(destination: url) {
      HStack(spacing: 8) {
        Text(title)
          .tcFont(.body)
          .frame(maxWidth: .infinity, alignment: .leading)
        IconView(.external, size: 14, color: Tokens.Color.ink2)
      }
      .foregroundStyle(Tokens.Color.ink2)
      .padding(.horizontal, 14)
      .frame(minHeight: Tokens.Hit.primary)
      .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.panel))
      .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.line, lineWidth: 1))
      .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.control))
    }
    .accessibilityIdentifier(identifier)
  }

  // MARK: - 出ていくもの

  private func removeButton(_ model: StopInspectorModel, text: PlannerCopy) -> some View {
    Button {
      Task { await store.removeStop(id: model.stopId) }
    } label: {
      Text(text.removeStop)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.danger)
        .frame(maxWidth: .infinity)
    }
    .buttonStyle(.secondaryPill)
    .accessibilityIdentifier("detail.remove")
  }
}

/// 「この場所の条件を変える」—— 滞在時間と最終入場。
///
/// 別の型に分けてあるのは、この 2 行だけが「読む」ではなく「決める」欄で、`Binding` と
/// `HH:MM` ↔ `Date` の変換という別種の面倒を抱えるからである。シート本体はそれを知らずに
/// 済み、開いたときだけ描かれる中身がここに閉じる。
private struct ConditionsDisclosure: View {
  @Environment(PlannerStore.self) private var store
  let model: StopInspectorModel

  /// 時刻だけの `DatePicker` が乗る 1 日。**今日を使わない** —— 日付が変わる瞬間に選んだ
  /// 時刻が動くことがあり、時刻しか読まないこの欄では意味の無い揺れになる。
  private static let timeBaseDay = Date(timeIntervalSinceReferenceDate: 0)

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    DisclosureCard(title: app.stopConditionsDisclosure) {
      VStack(alignment: .leading, spacing: 12) {
        stayRow(text: text)
        lastEntryRow(app: app)
      }
      .padding(.top, 4)
    }
    .accessibilityIdentifier("detail.conditions")
  }

  /// 滞在時間。先頭の「自動」がエンジンの見積もりで、それ以外は旅行者が決めた長さ。
  private func stayRow(text: PlannerCopy) -> some View {
    HStack(spacing: 8) {
      Text(text.stayLabel)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
      Spacer(minLength: 0)
      Picker(text.stayLabel, selection: Binding<Int?>(
        get: { model.stayOverride },
        set: { minutes in Task { await store.setStayMinutes(stopId: model.stopId, minutes: minutes) } }
      )) {
        ForEach(model.stayOptions.indices, id: \.self) { index in
          let minutes = model.stayOptions[index]
          Text(minutes.map { text.previewStay($0) } ?? text.stayAuto).tag(minutes)
        }
      }
      .pickerStyle(.menu)
      .labelsHidden()
      .tint(Tokens.Color.ink2)
    }
    .frame(minHeight: Tokens.Hit.primary)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(text.stayLabel)
  }

  /// 最終入場。**決めていない場所には時計を出さない** —— 出すと、既定で置いた時刻が
  /// 「この場所は 9:00 までに入らなければならない」という決まった条件に読める(シミュレータで
  /// 実際にそう出た)。倒したときの初期値はこの停留所を出る時刻なので、倒しただけでは旅程が
  /// 動かず、そこから前へずらして初めて指定が効く。
  @ViewBuilder private func lastEntryRow(app: AppCopy) -> some View {
    Toggle(isOn: Binding(
      get: { model.lastEntry != nil },
      set: { on in
        Task { await store.setLastEntry(stopId: model.stopId, time: on ? model.lastEntryDefault : nil) }
      }
    )) {
      Text(app.lastEntryLabel)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
    }
    .tint(Tokens.Color.accent)
    .frame(minHeight: Tokens.Hit.primary)
    .accessibilityIdentifier("detail.lastEntry")

    if let lastEntry = model.lastEntry {
      DatePicker(
        app.lastEntryLabel,
        selection: Binding(
          get: { Self.day(from: lastEntry) },
          set: { day in Task { await store.setLastEntry(stopId: model.stopId, time: Self.clock(from: day)) } }
        ),
        displayedComponents: [.hourAndMinute]
      )
      .datePickerStyle(.compact)
      .labelsHidden()
      .tint(Tokens.Color.accent)
      .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary, alignment: .leading)
      .accessibilityLabel(app.lastEntryLabel)
    }
  }

  // MARK: - `HH:MM` と時刻だけの `Date` の間

  private static func day(from clock: String?) -> Date {
    let minutes = clock.flatMap { ClockTime($0) }?.minutes ?? EngineConstants.defaultDayStart.minutes
    return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: timeBaseDay) ?? timeBaseDay
  }

  private static func clock(from day: Date) -> String {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: day)
    return ClockTime(minutes: (parts.hour ?? 0) * 60 + (parts.minute ?? 0)).description
  }
}
