import SwiftUI
import TripCheckAppCore
import TripCheckKit

/*
 * Start 画面に並ぶ「決めなくてもよいこと」—— 行き先の国・初日の日付・ホテルとペースと移動手段。
 *
 * どれも旅程を組む前の条件なので、書き先は `request` の単純な欄か、`store` の setter 経由の
 * `edit` に限る。組み上がった後に同じ値を変えるのは別の話(Task 9 のガード付き編集)。
 */

/// 行き先の国。`auto` が既定で、選ぶと候補検索がその国の箱に寄る。
struct DestinationPicker: View {
  @Binding var choice: DestinationChoice
  let locale: PlannerLocale

  var body: some View {
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)

    VStack(alignment: .leading, spacing: 6) {
      // 見出しは自分で書く(`.menu` の `Picker` は見出しを畳んで値しか出さない)。
      HStack(spacing: 8) {
        Text(text.destination)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        Spacer(minLength: 0)
        Picker(text.destination, selection: $choice) {
          let options = Destinations.options(locale: locale)
          ForEach(Array(options.indices), id: \.self) { index in
            Text(options[index].label).tag(options[index].choice)
          }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Tokens.Color.ink2)
      }
      .frame(minHeight: Tokens.Hit.primary)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(text.destination)

      Text(app.destinationHint)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
    }
  }
}

/// 初日の日付。`YYYY-MM-DD` の文字列と `Date` の間だけを持つ小さな行で、日付が無い状態
/// (`nil`)にも戻せる —— 日付を入れると営業時間・祝日・天気が効くが、入れないまま組むのが
/// 既定だから。
struct DatePickerRow: View {
  @Binding var date: String?
  let locale: PlannerLocale

  var body: some View {
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)

    VStack(alignment: .leading, spacing: 8) {
      DatePicker(
        text.date,
        selection: Binding(get: { Self.day(from: date) }, set: { date = Self.text(from: $0) }),
        displayedComponents: [.date]
      )
      .datePickerStyle(.compact)
      .tint(Tokens.Color.accent)
      .frame(minHeight: Tokens.Hit.primary)
      .foregroundStyle(Tokens.Color.ink2)
      .tcFont(.body)

      Button(app.dateUndecided) { date = nil }
        .buttonStyle(.secondaryPill)
        .tcFont(.body)
        .disabled(date == nil)
    }
  }

  /// 文字列 → `Date`。無い・読めないときは今日(選び始める起点)。
  private static func day(from text: String?) -> Date {
    guard let text, let parsed = CalendarDate(text),
          let day = Calendar.current.date(from: DateComponents(year: parsed.year, month: parsed.month, day: parsed.day))
    else { return Date() }
    return day
  }

  /// `Date` → `YYYY-MM-DD`。エンジンが読むのはこの形だけ(`CalendarDate.description`)。
  private static func text(from day: Date) -> String? {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: day)
    guard let year = parts.year, let month = parts.month, let dayOfMonth = parts.day,
          let calendarDate = CalendarDate(year: year, month: month, day: dayOfMonth)
    else { return nil }
    return calendarDate.description
  }
}

/// ホテル・ペース・移動手段。どれも `edit` の欄なので、書くのは `store` の setter 経由。
struct CustomOptions: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let text = Copy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Text(text.hotel)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        TextField(
          text.hotelPlaceholder,
          text: Binding(get: { store.edit.hotelQuery }, set: { store.setHotelQuery($0) })
        )
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink)
        .padding(.horizontal, 12)
        .frame(minHeight: Tokens.Hit.primary)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.panel))
        .overlay(
          RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.controlBorder, lineWidth: 1)
        )
        .accessibilityLabel(text.hotel)
      }

      VStack(alignment: .leading, spacing: 6) {
        Text(text.pace)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        SegmentedPills(
          options: [(Pace.relaxed, text.relaxed), (Pace.balanced, text.balanced), (Pace.fast, text.fast)],
          selection: store.edit.pace,
          groupLabel: text.pace,
          onSelect: { store.setPace($0) }
        )
      }

      VStack(alignment: .leading, spacing: 6) {
        Text(text.travelHeading)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        SegmentedPills(
          options: [(TravelPreference.auto, text.travelAuto), (TravelPreference.car, text.travelCar)],
          selection: store.edit.travelPreference,
          groupLabel: text.travelHeading,
          onSelect: { store.setTravelPreference($0) }
        )
      }
    }
    .padding(.top, 4)
  }
}
