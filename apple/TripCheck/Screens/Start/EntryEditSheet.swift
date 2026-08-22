import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 行きたい場所リストの 1 行を開いたところ —— 優先度・時刻・予約・滞在・行く日を決め、
/// 最後に「この行き先を予定から外す」。
///
/// 持つのは行の `id` だけで、中身は毎回 `store` から引き直す。開いている間に外された行を
/// 掴んだまま書き戻すと、消したはずの場所が戻ってくるからである(id が消えれば
/// `StartScreen` 側の `Binding` が nil を返し、シートはひとりでに閉じる)。
///
/// 欄はどれも `store.updateEntry(...)` を通す。**触っていない欄と空にした欄を型で分ける**
/// のがその関数の仕事なので、シートは「決める / 決めない」のスイッチと、その値だけを送る。
struct EntryEditSheet: View {
  let entryID: UUID

  @Environment(PlannerStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  /// 滞在時間を「決める」に倒した最初の値。Kit の見積り(`StayEstimates`)はまだ場所が
  /// 決まっていないと出せないので、刻み(15 分)の倍数のうち控えめな 1 時間から始める。
  private static let initialStayMinutes = 60

  /// 時刻だけの `DatePicker` が乗る 1 日。**今日を使わない** —— 日付が変わる瞬間に選んだ
  /// 時刻が動くことがあり、時刻しか読まないこの欄では意味の無い揺れになる。
  private static let timeBaseDay = Date(timeIntervalSinceReferenceDate: 0)

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    NavigationStack {
      ScrollView {
        if let entry {
          VStack(alignment: .leading, spacing: 16) {
            SegmentedPills(
              options: [
                (WishlistPriority.normal, app.priorityNormal),
                (WishlistPriority.must, text.must),
                (WishlistPriority.optional, text.optional),
              ],
              selection: entry.priority,
              groupLabel: app.priorityLabel(name: entry.text),
              onSelect: { store.updateEntry(id: entryID, priority: $0) }
            )

            VStack(spacing: 0) {
              timeRows(entry, text: text)
              hairline
              toggleRow(text.reservation, isOn: Binding(
                get: { entry.isReservation },
                set: { store.updateEntry(id: entryID, isReservation: $0) }
              ))
              hairline
              stayRows(entry, text: text)
              hairline
              dayRow(entry, text: text, app: app)
            }
            .padding(.horizontal, 14)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))

            // 外すのはいちばん下。指が滑って触れる場所に置かない。
            Button {
              store.removeEntry(id: entryID)
              dismiss()
            } label: {
              Text(text.removeStop)
                .tcFont(.body)
                .foregroundStyle(Tokens.Color.danger)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.secondaryPill)
            .accessibilityIdentifier("entry.remove")
          }
          .padding(20)
        }
      }
      .background(Tokens.Color.bg)
      .navigationTitle(entry?.text ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(text.close) { dismiss() }
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.accentDeep)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  /// いま編集している行。外されていれば `nil`(シートは閉じる途中)。
  private var entry: WishlistEntry? {
    store.request.entries.first { $0.id == entryID }
  }

  // MARK: - 欄

  /// 時刻を決めるかどうかと、決めたときの時計。倒すと時刻そのものが消える
  /// (`fixedTime: .some(nil)`)—— 「9:00 のまま無効」という中途半端な状態を作らない。
  @ViewBuilder private func timeRows(_ entry: WishlistEntry, text: PlannerCopy) -> some View {
    toggleRow(text.timePinned, isOn: Binding(
      get: { entry.fixedTime != nil },
      set: { store.updateEntry(id: entryID, fixedTime: .some($0 ? store.request.dayStartDefault : nil)) }
    ))
    if entry.fixedTime != nil {
      DatePicker(
        text.timePinned,
        selection: Binding(
          get: { Self.day(from: entry.fixedTime) },
          set: { store.updateEntry(id: entryID, fixedTime: .some(Self.clock(from: $0))) }
        ),
        displayedComponents: [.hourAndMinute]
      )
      .datePickerStyle(.compact)
      .labelsHidden()
      .tint(Tokens.Color.accent)
      .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary, alignment: .leading)
      .accessibilityLabel(text.timePinned)
      .padding(.bottom, 6)
    }
  }

  /// 滞在時間。決めないままなら「自動」で、エンジンが場所ごとの見積りを使う。
  @ViewBuilder private func stayRows(_ entry: WishlistEntry, text: PlannerCopy) -> some View {
    toggleRow(text.stayLabel, isOn: Binding(
      get: { entry.stayMinutes != nil },
      set: { store.updateEntry(id: entryID, stayMinutes: .some($0 ? Self.initialStayMinutes : nil)) }
    ))
    if let minutes = entry.stayMinutes {
      Stepper(
        value: Binding(get: { minutes }, set: { store.updateEntry(id: entryID, stayMinutes: .some($0)) }),
        in: EngineConstants.stayMinutesRange,
        step: PlannerStore.stayMinutesStep
      ) {
        Text(text.previewStay(minutes))
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.ink2)
      }
      .tint(Tokens.Color.accent)
      .frame(minHeight: Tokens.Hit.primary)
      .accessibilityLabel(text.stayLabel)
      .accessibilityValue(text.previewStay(minutes))
    } else {
      Text(text.stayAuto)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 8)
    }
  }

  /// 行く日。既定は「どの日でも」で、選べる幅は旅の日数そのもの。
  private func dayRow(_ entry: WishlistEntry, text: PlannerCopy, app: AppCopy) -> some View {
    HStack(spacing: 8) {
      Text(app.entryDayLabel)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
      Spacer(minLength: 0)
      Picker(app.entryDayLabel, selection: Binding<Int?>(
        get: { entry.fixedDay },
        set: { store.updateEntry(id: entryID, fixedDay: .some($0)) }
      )) {
        Text(app.entryDayAny).tag(Int?.none)
        ForEach(1...store.plannedDays, id: \.self) { day in
          Text(text.previewDay(day)).tag(Int?.some(day))
        }
      }
      .pickerStyle(.menu)
      .labelsHidden()
      .tint(Tokens.Color.ink2)
    }
    .frame(minHeight: Tokens.Hit.primary)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(app.entryDayLabel)
  }

  /// スイッチ 1 つぶん。`Binding` は呼ぶ側で組む —— 閉包を引数で渡すと、`body` の
  /// MainActor がそこで途切れる(Swift 6 の `@Sendable` 警告)。
  private func toggleRow(_ title: String, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) {
      Text(title)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
    }
    .tint(Tokens.Color.accent)
    .frame(minHeight: Tokens.Hit.primary)
  }

  private var hairline: some View {
    Rectangle().fill(Tokens.Color.line).frame(height: 1)
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

#Preview {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Ghibli Museum")
  EntryEditSheet(entryID: id).environment(store)
}
