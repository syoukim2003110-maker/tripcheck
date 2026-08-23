import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 紙に落とす 1 枚。
 *
 * 画面は「いま見ている 1 日」を出すが、紙は**全部**を出す —— 電池が切れた端末の代わりに
 * なるものなので、選んだ日だけを刷っても意味が無い。だからここで守るのは 2 つ:全日程・
 * 全停留所が 1 つ残らず載ること、そしてどの行も**到着と出発の両方**を名乗ること(片方だけの
 * 行は、次の場所へ何時に出ればよいのかを紙の上で答えられない)。
 *
 * 3 つ目は文の出どころ。紙は画面より長く残る(印刷して持ち歩く・PDF を配る)ので、社内語が
 * 1 語でも混ざると回収できない。`printModel` の**全ての文字列**を `Mirror` で舐めて
 * `BannedTerms` に通すのはそのためで、欄が増えたときに検査から漏れる欄が出ないようにしている。
 */

// Task 13 brief §Step 1 test (verbatim).

@Test @MainActor func printModelListsEveryStopWithFullTimes() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let p = store.printModel
  #expect(p.days.count == 4); #expect(p.days.flatMap(\.rows).count == 8)
  #expect(p.days.flatMap(\.rows).allSatisfy { !$0.arrival.isEmpty && !$0.departure.isEmpty })
  #expect(BannedTerms.violations(in: p.verdict).isEmpty)
}

// 残りの約束。

/// 紙に出る文字列は**1 つ残らず** `BannedTerms` を通る。欄を数え上げるのではなく `Mirror` で
/// 舐めるのは、次に欄が増えたときこの検査が黙って素通りしないため。
@Test @MainActor func everyStringOnThePrintedPagePassesBannedTerms() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.request.tripStartDate = "2026-08-24"
  store.request.arrivalAirport = "ZRH"
  store.request.arrivalTime = "10:30"
  await store.build()
  let strings = PrintModelWalk.strings(in: store.printModel)
  // 見出し・結論・前提・対応・空港・4 日分の行 —— 40 は「ほとんど空の模型を舐めて通った」を
  // 弾くための下限で、上限は決めない。
  #expect(strings.count > 40)
  for text in strings {
    #expect(BannedTerms.violations(in: text).isEmpty, "\(text)")
  }
}

/// 行の時刻は「到着–出発」の 1 つながりで、両端の数は別々の欄にも残る —— 紙を読む人は
/// 幅の 1 か所で読み、機械(次に来る画面や書き出し)は端の 2 つを読む。
@Test @MainActor func eachRowCarriesArrivalAndDepartureInOneClockRange() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  let rows = store.printModel.days.flatMap(\.rows)
  #expect(rows.count == 8)
  for row in rows {
    #expect(row.time == "\(row.arrival)–\(row.departure)", "\(row.time)")
    #expect(!row.name.isEmpty)
    #expect(!row.stay.isEmpty)
  }
}

/// 紙の滞在時間は、画面のタイムラインと**同じ 1 文**でなければならない。別々に組むと、
/// 同じ場所が画面では「滞在の目安 1時間」、紙では「滞在 1時間」になる(推定が主張に化ける)。
@Test @MainActor func theStayLineOnPaperIsTheSameSentenceAsTheTimeline() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  var checked = 0
  for (index, day) in store.printModel.days.enumerated() {
    let activities = store.timelineRows(index).compactMap { row -> ActivityModel? in
      if case .activity(let model) = row { return model }
      return nil
    }
    #expect(day.rows.count == activities.count)
    for (row, activity) in zip(day.rows, activities) {
      #expect(row.name == activity.name)
      #expect(activity.areaAndStay.hasSuffix(row.stay), "\(activity.areaAndStay) / \(row.stay)")
      checked += 1
    }
  }
  #expect(checked == 8)
}

/// 日付を入れた旅は、日の見出しに曜日つきの日付を出す。入れていない旅の日付欄は**空**
/// —— 決めていない日付を紙の上で名乗らない(見出しの「1日目」がその日を呼ぶ)。
@Test @MainActor func theDayHeadingNamesADateOnlyWhenTheTravellerGaveOne() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  #expect(store.printModel.days.allSatisfy { $0.date.isEmpty })
  #expect(store.printModel.days.allSatisfy { !$0.label.isEmpty })

  store.request.tripStartDate = "2026-08-24"
  await store.build()
  let dated = store.printModel.days
  #expect(dated.first?.date.contains("2026-08-24") == true, "\(dated.first?.date ?? "")")
  #expect(dated.allSatisfy { !$0.date.isEmpty })
}

/// 空港の 1 行は、便の時刻と**街で動き出せる時刻**の両方を名乗り、最後に「この分数は
/// 空港が示した事実ではない」と言い切る。数字だけを紙に載せると、空港の公式発表に見える。
@Test @MainActor func theAirportNotesNameBothClocksAndKeepTheirDisclaimer() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.request.arrivalAirport = "ZRH"
  store.request.arrivalTime = "10:30"
  await store.build()
  let notes = store.printModel.airportNotes
  #expect(notes.count >= 2)
  #expect(notes.contains { $0.contains("ZRH") && $0.contains("10:30") }, "\(notes.joined(separator: " / "))")
  #expect(notes.last == AppCopy.for(.ja).airportDisclaimer)
}

/// 空港を 1 つも入れていない旅は、空港の節を**出さない**。「指定なし」と刷ると、決めて
/// いないことが決めたことのように読める。
@Test @MainActor func aTripWithoutFlightsPrintsNoAirportSection() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  #expect(store.printModel.airportNotes.isEmpty)
}

/// 祝日の欄は**常に空**。鍵ゼロのアプリに祝日の出どころが無いので、日付を入れた旅でも
/// 空のままにする —— 空でない祝日欄は「この日は祝日ではない」と読めてしまう。
@Test @MainActor func theHolidayListStaysEmptyWithoutASourceForIt() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.request.tripStartDate = "2026-01-01"
  await store.build()
  #expect(store.printModel.holidays.isEmpty)
}

/// 結論・前提・対応は判定そのものから来る。紙が数え直したり言い換えたりすると、画面と紙で
/// 違うことを言う 1 枚ができる。
@Test @MainActor func theVerdictAndItsAssumptionsComeFromTheResultItself() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  guard let result = store.bundle?.result else { Issue.record("the sample must build"); return }
  let model = store.printModel
  #expect(model.verdict == store.hero.text)
  #expect(model.assumptions == result.assumptions.map { VerdictCopy.assumptionCopy($0, locale: .ja) })
  #expect(model.conflicts == result.conflicts.map { VerdictCopy.conflictCopy($0, locale: .ja) })
  let profile = CoverageProfile.forLocation(destination: .switzerland)
  #expect(model.coverage.hasPrefix(profile.label[.ja] ?? ""))
  #expect(model.coverage.contains(CoverageProfile.publicCopy(profile, locale: .ja)))
  #expect(model.title == store.shareSubject)
}

/// まだ組んでいない旅には刷る中身が無い。題だけを持って**日を 1 つも出さない** ——
/// 空の日付表を刷ると、旅程が空だという意味に読める。
@Test @MainActor func nothingIsPrintedBeforeTheTripIsBuilt() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  let model = store.printModel
  #expect(model.days.isEmpty)
  #expect(model.verdict.isEmpty)
  #expect(model.conflicts.isEmpty)
  #expect(!model.title.isEmpty)
  #expect(model.conditions.isEmpty)
  #expect(model.omissions.isEmpty)
}

// MARK: - フィックスラウンド 1(外部レビュー)

/// 日をまたぐ空港の時刻は、英語では ASCII の丸括弧で囲む。日本語の全角括弧を英単語に
/// かぶせると(`01:30（next day）`)、外来の記号が混ざって見える —— Important 1。
@Test @MainActor func theEnglishAirportNoteWrapsTheDayOffsetInAsciiParens() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.request.locale = .en
  store.request.arrivalAirport = "ZRH"
  // 空港内 90 分 + 市街地までの移動 60 分を足すと日をまたぐ(Kit
  // `AirportsTests.midnightArrivalPushesActivityDayToNextDate` と同じ組み立て)。
  store.request.arrivalTime = "23:30"
  await store.build()
  let notes = store.printModel.airportNotes
  #expect(notes.contains { $0.contains("(next day)") }, "\(notes.joined(separator: " / "))")
  #expect(!notes.contains { $0.contains("（") }, "\(notes.joined(separator: " / "))")
}

/// 旅の条件は、旅行者が決めた拠点を名指しする。`edit.resolvedBase` から出た拠点は、Web の
/// 「旅の条件」節と同じく名前と住所を並べる —— Important 2(条件)。
@Test @MainActor func conditionsNameTheBaseWhenOneIsSet() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.edit.resolvedBase = ResolvedStop(
    id: "test-base",
    name: "ルツェルン中央駅",
    area: "ルツェルン",
    latitude: 47.0502,
    longitude: 8.3093,
    sourceUrl: "",
    verifiedAt: "2026-01-01",
    confidence: .medium,
    planningDurationMinutes: 0,
    isAnchor: false,
    input: "ルツェルン中央駅",
    address: "Zentralstrasse 1, 6003 Luzern"
  )
  await store.build()
  #expect(store.bundle?.plan.selectedBase?.name == "ルツェルン中央駅")
  let conditions = store.printModel.conditions
  #expect(conditions.contains { $0.contains("ルツェルン中央駅") }, "\(conditions.joined(separator: " / "))")
  #expect(conditions.contains { $0.contains("Zentralstrasse 1") }, "\(conditions.joined(separator: " / "))")
  // 移動余白は拠点の有無に関わらず必ず出る。
  #expect(conditions.contains { $0.contains(AppCopy.for(.ja).printConditionsBuffer) }, "\(conditions.joined(separator: " / "))")
}

/// 旅程に入っていない場所は紙からも消えない。旅行者が外した場所は、Web と同じ理由文つきで
/// 「旅程に入っていない場所」に載る —— Important 2(省略の正直さ)。
@Test @MainActor func omissionsNameARemovedStop() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  guard let stopId = store.bundle?.plan.days.first?.stops.first?.stop.id else {
    Issue.record("the sample must build with at least one stop"); return
  }
  await store.removeStop(id: stopId)
  if store.view.pendingHardEdit != nil { await store.confirmPendingEdit() }
  guard let removed = store.edit.removedStops.first(where: { $0.id == stopId }) else {
    Issue.record("removing a stop must record it in edit.removedStops"); return
  }
  let omissions = store.printModel.omissions
  #expect(
    omissions.contains { $0.hasPrefix(removed.name) && $0.contains(AppCopy.for(.ja).printOmissionRemoved) },
    "\(omissions.joined(separator: " / "))"
  )
}

/// 予約した停留所は、その行にだけ印が付く。Kit の `printBooked`(「予約」)を借りる ——
/// Important 2(行の予約マーカー)。
@Test @MainActor func aReservedEntryPrintsAsBookedOnItsRow() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  let reservedName = store.request.entries[0].text
  store.request.entries[0].isReservation = true
  store.request.entries[0].fixedTime = "10:00"
  await store.build()
  let rows = store.printModel.days.flatMap(\.rows)
  guard let bookedRow = rows.first(where: { $0.name == reservedName }) else {
    Issue.record("the reserved stop must still be scheduled somewhere"); return
  }
  #expect(bookedRow.booked)
  #expect(rows.filter { $0.name != reservedName }.allSatisfy { !$0.booked })
}

// MARK: - 内部

/// `PrintModel` の中に入っている文字列を全部集める。`Mirror` を使うのは、欄が増えたときに
/// 検査へ足し忘れないため —— 手で並べた一覧は、次に足された欄が黙って抜ける。
enum PrintModelWalk {
  static func strings(in value: Any) -> [String] {
    if let text = value as? String { return [text] }
    return Mirror(reflecting: value).children.flatMap { strings(in: $0.value) }
  }
}
