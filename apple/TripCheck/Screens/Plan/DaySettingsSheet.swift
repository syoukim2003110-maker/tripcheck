import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 1 日の時計 —— 何時に動き出し、何時に切り上げるか。日の見出しを押すと開く。
///
/// 選べる形が錠剤ではなく `Picker` なのは、選択肢が 4 つ(3 つの目安 + 任意の時刻)あって、
/// うち 1 つが時計を開くからである。既定は「標準」で、標準のままの日は `edit` に何も書かない
/// —— 書くと、旅行者が決めていない時刻が旅程の根拠として物証に載ってしまう。
///
/// 3 つの目安は Kit の `timeband*`(「朝型 8:00〜」)と `dayEndNone`(「標準 22:00」)から
/// 来る。この画面が時刻の文字を組み立てるのは「任意の時刻」を選んだときだけで、それは
/// `HH:MM` という機械の書式そのものである。
struct DaySettingsSheet: View {
  @Environment(PlannerStore.self) private var store
  let day: Int

  /// 一日の始まりの目安。Kit の 3 つの `timeband*` と 1 対 1 で並ぶ(順も同じ)。
  private static let startPresets = ["08:00", "09:00", "10:30"]
  /// 一日の終わりの目安。Web の門限の 2 択(v1.1 TC-032)。
  private static let endPresets = ["19:30", "21:30"]

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(store.dayDateLabel(day))
            .tcFont(.dayHeader)
            .foregroundStyle(Tokens.Day.color(index: day))

          VStack(spacing: 0) {
            DayTimeRow(
              title: text.dayStart,
              value: store.dayStartTime(day),
              // 「標準」は Kit の「標準 9:00〜」そのもの —— 何も決めていない日が実際に
              // 何時に始まるかを、選択肢の名前が言う。
              autoLabel: text.timebandNormal,
              presets: Self.startPresets,
              presetLabels: [text.timebandEarly, text.timebandNormal, text.timebandLate],
              customLabel: app.customTimeLabel,
              identifier: "day.start",
              apply: { time in await store.setDayStart(day: day, time: time) }
            )
            Rectangle().fill(Tokens.Color.line).frame(height: 1)
            DayTimeRow(
              title: text.dayEnd,
              value: store.dayEndTime(day),
              autoLabel: text.dayEndNone,
              presets: Self.endPresets,
              // 目安の 2 つは時刻そのもの(`19:30`)—— 機械の書式で、訳す語ではない。
              presetLabels: Self.endPresets,
              customLabel: app.customTimeLabel,
              identifier: "day.end",
              apply: { time in await store.setDayEnd(day: day, time: time) }
            )
          }
          .padding(.horizontal, 14)
          .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
          .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(Tokens.Color.bg)
      .navigationTitle(app.daySettingsTitle)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(text.close) { store.closeInspector() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.accentDeep)
        }
      }
    }
    .accessibilityIdentifier("daySettings.sheet")
  }

}

/// 時刻の欄 1 つぶん。`Picker` の選択肢は「標準」+ 目安 + 「時刻を選ぶ」で、最後を選ぶと
/// その下に時計が出る。**目安と同じ時刻を自分で選んでも同じ 1 つの値**になるので、選択肢が
/// 2 つ光ることはない。
///`@State` を持つのは「時刻を選ぶ」に倒したがまだ回していない瞬間だけで、
/// 決まった値は常に `store` の側にある —— 下書きを溜め込むと、シートを開き直したときに
/// 画面と旅程が別のことを言う。
private struct DayTimeRow: View {
  let title: String
  let value: String?
  let autoLabel: String
  let presets: [String]
  let presetLabels: [String]
  let customLabel: String
  let identifier: String
  let apply: (String?) async -> Void

  /// 時刻だけの `DatePicker` が乗る 1 日(`StopInspector` と同じ理由で今日を使わない)。
  private static let timeBaseDay = Date(timeIntervalSinceReferenceDate: 0)

  /// 目安のどれでもない時刻を自分で選んでいる最中か。決まった値が目安の 1 つでも、
  /// 一度時計を開いたらそのまま出しておく(閉じると、直したい人がもう一度倒すことになる)。
  @State private var showsClock = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text(title)
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.ink)
        Spacer(minLength: 0)
        Picker(title, selection: selection) {
          Text(autoLabel).tag(Choice.auto)
          ForEach(presets.indices, id: \.self) { index in
            Text(presetLabels[index]).tag(Choice.preset(presets[index]))
          }
          Text(customLabel).tag(Choice.custom)
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Tokens.Color.ink2)
      }
      .frame(minHeight: Tokens.Hit.primary)

      if showsClock || (value.map { !presets.contains($0) } ?? false) {
        DatePicker(
          title,
          selection: Binding(
            get: { Self.day(from: value) },
            set: { day in Task { await apply(Self.clock(from: day)) } }
          ),
          displayedComponents: [.hourAndMinute]
        )
        .datePickerStyle(.compact)
        .labelsHidden()
        .tint(Tokens.Color.accent)
        .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary, alignment: .leading)
        .accessibilityLabel(title)
        .padding(.bottom, 6)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(title)
    .accessibilityIdentifier(identifier)
  }

  /// `Picker` が選ぶ 3 つの形。時刻そのものを選択肢にすると「標準」と「任意」を表せない。
  private enum Choice: Hashable {
    case auto
    case preset(String)
    case custom
  }

  private var selection: Binding<Choice> {
    Binding(
      get: {
        guard let value else { return .auto }
        return presets.contains(value) ? .preset(value) : .custom
      },
      set: { choice in
        switch choice {
        case .auto:
          showsClock = false
          Task { await apply(nil) }
        case .preset(let time):
          showsClock = false
          Task { await apply(time) }
        case .custom:
          // 時計を開くだけ。**まだ何も決めない** —— 開いた瞬間に適当な時刻を旅程へ流すと、
          // 旅行者が選ぶ前に旅程が組み直される。
          showsClock = true
        }
      }
    )
  }

  private static func day(from clock: String?) -> Date {
    let minutes = clock.flatMap { ClockTime($0) }?.minutes ?? EngineConstants.defaultDayStart.minutes
    return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: timeBaseDay) ?? timeBaseDay
  }

  private static func clock(from day: Date) -> String {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: day)
    return ClockTime(minutes: (parts.hour ?? 0) * 60 + (parts.minute ?? 0)).description
  }
}
