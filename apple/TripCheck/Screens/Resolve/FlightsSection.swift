import SwiftUI
import TripCheckAppCore
import TripCheckKit

/*
 * フライトと空港の条件、そして「どちらの空港のほうが 1 日を長く使えるか」の比較。
 *
 * 空港の一覧は `TripPresentation.airportOptionsFor` から取る —— **国が決まっていなければ
 * 全部の玄関口を国ごとにまとめて出す**(最初のビルドの前にフライトを入れられなければ
 * ならない)。値の "none" が「未指定」で、`TripRequestState` は同じことを空文字で持って
 * いるので、この画面が 2 つの間を訳す。
 */
struct FlightsSection: View {
  @Environment(PlannerStore.self) private var store

  /// Kit の空港一覧が「未指定」に使う値。`request.arrivalAirport` の空文字と同じ意味。
  private static let noAirport = "none"

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)
    let groups = TripPresentation.airportOptionsFor(locale: store.request.locale, destination: activeDestination)

    VStack(alignment: .leading, spacing: 16) {
      airportRow(
        title: text.arrival,
        identifier: "resolve.arrivalAirport",
        groups: groups,
        code: Binding(get: { store.request.arrivalAirport }, set: { store.request.arrivalAirport = $0 }),
        clock: Binding(get: { store.request.arrivalTime }, set: { store.request.arrivalTime = $0 })
      )
      timeRow(
        title: text.arrivalTime,
        clock: Binding(get: { store.request.arrivalTime }, set: { store.request.arrivalTime = $0 }),
        isEnabled: !store.request.arrivalAirport.isEmpty
      )

      airportRow(
        title: text.departure,
        identifier: "resolve.departureAirport",
        groups: groups,
        code: Binding(get: { store.request.departureAirport }, set: { store.request.departureAirport = $0 }),
        clock: Binding(get: { store.request.departureTime }, set: { store.request.departureTime = $0 })
      )
      timeRow(
        title: text.departureTime,
        clock: Binding(get: { store.request.departureTime }, set: { store.request.departureTime = $0 }),
        isEnabled: !store.request.departureAirport.isEmpty
      )

      // 便の種別は空港を 1 つでも決めてから聞く —— 空港が無ければ、答えの使い道が無い。
      if !store.request.arrivalAirport.isEmpty || !store.request.departureAirport.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text(text.flightKindHeading)
            .tcFont(.dayHeader)
            .foregroundStyle(Tokens.Color.ink)
          SegmentedPills(
            options: [(FlightKind.international, text.flightInternational), (FlightKind.domestic, text.flightDomestic)],
            selection: store.request.flightKind,
            groupLabel: text.flightKindHeading,
            onSelect: { store.request.flightKind = $0 }
          )
        }
      }

      if !store.request.arrivalAirport.isEmpty {
        AirportComparisonView(
          direction: .arrival,
          destination: TripPresentation.airportComparisonDestination(active: activeDestination, airportCode: store.request.arrivalAirport),
          flightKind: store.request.flightKind,
          selectedAirport: store.request.arrivalAirport,
          selectedTime: store.request.arrivalTime,
          locale: store.request.locale,
          title: app.airportCompareArrival,
          boundaryLabel: app.airportArrivalBoundary,
          winnerLabel: app.airportArrivalWinner,
          onUse: { code, time in
            store.request.arrivalAirport = code
            store.request.arrivalTime = time
          }
        )
      }

      if !store.request.departureAirport.isEmpty {
        AirportComparisonView(
          direction: .departure,
          destination: TripPresentation.airportComparisonDestination(active: activeDestination, airportCode: store.request.departureAirport),
          flightKind: store.request.flightKind,
          selectedAirport: store.request.departureAirport,
          selectedTime: store.request.departureTime,
          locale: store.request.locale,
          title: app.airportCompareDeparture,
          boundaryLabel: app.airportDepartureBoundary,
          winnerLabel: app.airportDepartureWinner,
          onUse: { code, time in
            store.request.departureAirport = code
            store.request.departureTime = time
          }
        )
      }
    }
  }

  /// いまの行き先。`auto` はまだ国が決まっていないので「世界中」—— 全部の玄関口が並ぶ。
  private var activeDestination: Destination {
    guard case .destination(let id) = store.request.destination else { return Destinations.byId(.worldwide) }
    return Destinations.byId(id)
  }

  // MARK: - 欄

  /// 空港 1 つぶん。Kit の "none" と `request` の空文字の間の訳はここだけで起きる。
  ///
  /// **空港を決めたら時刻も同時に決める。** 隣の時刻欄は空のときも既定の 9:00 を描く
  /// (時計に「無」は描けない)ので、書き込まないままにすると、画面は 9:00 と言い、
  /// エンジンは時刻を受け取っていない、という食い違いが残る。空港を外したときは時刻も
  /// 一緒に外す —— 空港の無い時刻に使い道は無い。
  private func airportRow(
    title: String,
    identifier: String,
    groups: [AirportGroup],
    code: Binding<String>,
    clock: Binding<String>
  ) -> some View {
    HStack(spacing: 8) {
      Text(title)
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)
      Spacer(minLength: 0)
      Picker(title, selection: Binding(
        get: { code.wrappedValue.isEmpty ? Self.noAirport : code.wrappedValue },
        set: { chosen in
          guard chosen != Self.noAirport else {
            code.wrappedValue = ""
            clock.wrappedValue = ""
            return
          }
          code.wrappedValue = chosen
          if clock.wrappedValue.isEmpty { clock.wrappedValue = EngineConstants.defaultDayStart.description }
        }
      )) {
        ForEach(Array(groups.indices), id: \.self) { index in
          let group = groups[index]
          if let label = group.label {
            Section(label) { options(group) }
          } else {
            options(group)
          }
        }
      }
      .pickerStyle(.menu)
      .labelsHidden()
      .tint(Tokens.Color.ink2)
    }
    .frame(minHeight: Tokens.Hit.primary)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(title)
    .accessibilityIdentifier(identifier)
  }

  private func options(_ group: AirportGroup) -> some View {
    ForEach(Array(group.options.indices), id: \.self) { index in
      Text(group.options[index].label).tag(group.options[index].value)
    }
  }

  /// 便の時刻。空港を決めていない向きの時刻は聞かない(押せない欄を出すより、意味の無い
  /// 数を持たせないほうがよい)。
  private func timeRow(title: String, clock: Binding<String>, isEnabled: Bool) -> some View {
    HStack(spacing: 8) {
      Text(title)
        .tcFont(.dayHeader)
        .foregroundStyle(isEnabled ? Tokens.Color.ink : Tokens.Color.muted)
      Spacer(minLength: 0)
      DatePicker(
        title,
        selection: Binding(
          get: { ClockBridge.day(from: clock.wrappedValue) },
          set: { clock.wrappedValue = ClockBridge.clock(from: $0) }
        ),
        displayedComponents: [.hourAndMinute]
      )
      .datePickerStyle(.compact)
      .labelsHidden()
      .tint(Tokens.Color.accent)
      .disabled(!isEnabled)
      .accessibilityLabel(title)
    }
    .frame(minHeight: Tokens.Hit.primary)
  }
}

/// 「どちらの空港のほうが 1 日を長く使えるか」だけを比べる。値段も空席も見ない ——
/// 見ていないものを比べた顔をしないために、比べる軸を 1 つに絞ってある。
///
/// 比べるのは同じ都市圏の玄関口だけ(`Destinations.airportComparisonGroup`)。都市が違う
/// 空港を並べても「近いほう」という答えにしかならない。時刻がまだ無いときは何も出さない
/// (`AirportComparison.compare` が読めない時刻を落とすので、結果が空になる)。
struct AirportComparisonView: View {
  let direction: AirportDirection
  let destination: Destination
  let flightKind: FlightKind
  let selectedAirport: String
  let selectedTime: String
  let locale: PlannerLocale
  let title: String
  let boundaryLabel: String
  let winnerLabel: String
  let onUse: (String, String) -> Void

  var body: some View {
    let app = AppCopy.for(locale)
    let results = AirportComparison.compare(
      options: Destinations.airportComparisonGroup(destination, code: selectedAirport)
        .map { AirportOptionInput(code: $0.code, flightTime: selectedTime) },
      direction: direction,
      flightKind: flightKind,
      destination: destination,
      locale: locale
    )

    if results.count >= 2 {
      DisclosureCard(title: title) {
        VStack(alignment: .leading, spacing: 12) {
          ForEach(results, id: \.code) { result in
            option(result, app: app)
          }
          Text(app.airportDisclaimer)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
        }
        .padding(.top, 4)
      }
    }
  }

  private func option(_ result: AirportOptionResult, app: AppCopy) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(verbatim: "\(result.code) · \(result.airportName)")
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)

      Text(boundaryLabel)
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.muted)

      HStack(spacing: 6) {
        Text(result.cityTime)
          .tcFont(.stats)
          .foregroundStyle(Tokens.Color.ink)
        if let offset = dayOffsetLabel(result, app: app) {
          Text(offset)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
        }
      }

      Text(breakdown(result, app: app))
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)

      if result.isTimeWinner {
        Text(winnerLabel)
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.good)
      }

      Button {
        onUse(result.code, result.flightTime)
      } label: {
        Text(isSelected(result) ? app.airportSelected : app.airportUse)
          .tcFont(.body)
      }
      .buttonStyle(.secondaryPill)
      .disabled(isSelected(result))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: Tokens.Radius.control)
        .fill(result.isTimeWinner ? Tokens.Color.goodSoft : Tokens.Color.tile)
    )
  }

  private func isSelected(_ result: AirportOptionResult) -> Bool {
    result.code == selectedAirport && result.flightTime == selectedTime
  }

  /// 市街地に着く(出る)のが翌日・前日になることがある。日をまたぐことが見えないと、
  /// 「23:00 着で 01:30 から動ける」が同じ日の話に読める。
  private func dayOffsetLabel(_ result: AirportOptionResult, app: AppCopy) -> String? {
    switch result.cityTimeDayOffset {
    case 1: app.airportNextDay
    case -1: app.airportPreviousDay
    default: nil
    }
  }

  private func breakdown(_ result: AirportOptionResult, app: AppCopy) -> String {
    direction == .arrival
      ? app.airportArrivalBreakdown(airportMinutes: result.airportMinutes, transferMinutes: result.transferMinutes)
      : app.airportDepartureBreakdown(airportMinutes: result.airportMinutes, transferMinutes: result.transferMinutes)
  }
}

/// `HH:MM` と時刻だけの `Date` の間。`EntryEditSheet` が同じ変換を持っているが、あちらは
/// 行 1 つぶんの private —— 空港の時刻はここでしか使わないので、この 2 つも小さく閉じておく。
private enum ClockBridge {
  /// 時刻だけの `DatePicker` が乗る 1 日。今日を使わないのは、日付が変わる瞬間に選んだ
  /// 時刻が動くことがあるから。
  private static let baseDay = Date(timeIntervalSinceReferenceDate: 0)

  static func day(from clock: String) -> Date {
    let minutes = ClockTime(clock)?.minutes ?? EngineConstants.defaultDayStart.minutes
    return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: baseDay) ?? baseDay
  }

  static func clock(from day: Date) -> String {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: day)
    return ClockTime(minutes: (parts.hour ?? 0) * 60 + (parts.minute ?? 0)).description
  }
}
