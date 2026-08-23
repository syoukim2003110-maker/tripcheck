import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 紙の 1 枚。全日程・全停留所・全時刻。
///
/// **環境を 1 つも読まない。** この view を描くのは画面ではなく `ImageRenderer`
/// (`PDFExporter`)で、そこには `PlannerStore` も Dynamic Type も配色も届かない ——
/// 環境から引こうとした値は黙って既定に落ち、白紙や別言語の紙が刷れる。だから事実は
/// `PrintModel`、言語は `locale`、大きさは `Typography.printed` と、全部引数と定数から来る。
///
/// 地図は無い。色も日ごとの 7 色も使わない —— 紙は白地に黒字が最も読みやすく、
/// 白黒で刷られる可能性のほうが高い(色は面積の分だけインクを食い、灰色になって
/// 意味を失う)。押せるものも無い:紙の上のボタンは押せない。
struct TripPrintSheet: View {
  /// Letter / A4 に共通で収まる幅(72dpi の 8.5in)。`PDFExporter` の既定と同じ数。
  static let pageWidth: CGFloat = 612
  /// 紙の余白。四辺とも同じで、綴じ代は取らない(閉じずに配ることのほうが多い)。
  static let margin: CGFloat = 40

  let model: PrintModel
  let locale: PlannerLocale

  var body: some View {
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)

    VStack(alignment: .leading, spacing: 16) {
      header

      if !model.conflicts.isEmpty { section(app.printConflictsHeading, lines: model.conflicts) }
      if !model.assumptions.isEmpty {
        section(app.assumptionsHeading(count: model.assumptions.count), lines: model.assumptions)
      }
      if !model.airportNotes.isEmpty { section(app.flightsDisclosure, lines: model.airportNotes) }
      // 祝日の出どころが入る日まで、この節は 1 度も出ない(`PrintModel.holidays`)。
      if !model.holidays.isEmpty { section(text.holidayBadge, lines: model.holidays) }
      if !model.coverage.isEmpty { section(app.coverageHeading, lines: [model.coverage]) }
      // 結論の下・日程の上 —— 旅程を組んだ条件を、結果を読んだ直後に置く(Web の「旅の条件」
      // 節と同じ位置。外部レビュー Important 2)。
      if !model.conditions.isEmpty { section(app.printConditionsHeading, lines: model.conditions) }

      ForEach(Array(model.days.enumerated()), id: \.offset) { _, day in
        dayBlock(day)
      }

      // 日程の下 —— 全日程を読み終えた旅行者に、載っていない場所があることを最後に言う
      // (外部レビュー Important 2)。
      if !model.omissions.isEmpty { section(app.printOmissionsHeading, lines: model.omissions) }

      Text(app.printFooter)
        .font(Typography.printed(.meta))
        .foregroundStyle(Tokens.Color.ink2)
        .padding(.top, 4)
    }
    .padding(Self.margin)
    .frame(width: Self.pageWidth, alignment: .leading)
    .background(Tokens.Color.panel)
    .foregroundStyle(Tokens.Color.ink)
  }

  // MARK: - 題と結論

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(model.title)
        .font(Typography.printed(.title))
        .fixedSize(horizontal: false, vertical: true)
      if !model.verdict.isEmpty {
        Text(model.verdict)
          .font(Typography.printed(.body))
          .fixedSize(horizontal: false, vertical: true)
      }
      hairline
    }
  }

  // MARK: - 節

  /// 見出し 1 行と、その下の箇条書き。**空の節は呼ばれない**(呼ぶ側が中身の有無で決める)
  /// —— 見出しだけが残った節は、中身が消えたのか元から無いのか読めない。
  private func section(_ heading: String, lines: [String]) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(heading)
        .font(Typography.printed(.heading))
        .foregroundStyle(Tokens.Color.ink2)
      ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
        Text(line)
          .font(Typography.printed(.body))
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  // MARK: - 1 日

  private func dayBlock(_ day: PrintModel.Day) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(day.date.isEmpty ? day.label : "\(day.label) · \(day.date)")
        .font(Typography.printed(.dayHeading))
      hairline
      ForEach(Array(day.rows.enumerated()), id: \.offset) { _, row in
        stopRow(row)
      }
    }
  }

  /// 停留所 1 行。時刻は左の柱に固定幅で置く —— 桁が揃っていないと、上から下へ時刻だけを
  /// 追うことができない。
  private func stopRow(_ row: PrintModel.Row) -> some View {
    let text = Copy.for(locale)
    // 住所・滞在・予約の印を 1 行にまとめる(Web `TripPrintSheet.tsx:186` の
    // `· ${text.printBooked}` と同じ並び。外部レビュー Important 2)。
    var meta = row.address.isEmpty ? row.stay : "\(row.address) · \(row.stay)"
    if row.booked { meta += " · \(text.printBooked)" }
    return HStack(alignment: .top, spacing: 10) {
      Text(row.time)
        .font(Typography.printed(.clock))
        .frame(width: 88, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        Text(row.name)
          .font(Typography.printed(.stopName))
          .fixedSize(horizontal: false, vertical: true)
        Text(meta)
          .font(Typography.printed(.meta))
          .foregroundStyle(Tokens.Color.ink2)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var hairline: some View {
    Rectangle().fill(Tokens.Color.line).frame(height: 1)
  }
}

#Preview {
  // 見本の旅程をそのまま紙にする。作り物の `PrintModel` を書かないのは、紙に出る文の
  // 出どころ(Kit の判定文)を preview でも通しておきたいから。
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  return ScrollView {
    TripPrintSheet(model: store.printModel, locale: store.request.locale)
  }
  .task { await store.build() }
}
