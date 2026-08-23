import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 共有 —— 何がリンクに入り、何が入らず、そのリンクを開いた端末に何が戻るか。
 *
 * 共有コードのバイトは Kit の `ShareCodec` が作る(Web と同一であることは Plan 1 の
 * 17/17 + 68/68 のベクタが証明している)。ここで見るのはその手前と後ろ ——
 * 「いまの入力と編集を `ShareableTripInput` に畳む」ところと、「受け取ったコードから
 * 旅程を組み直す」ところ。墨消しそのものは `ShareScope` の仕事で、この層は選択を
 * 渡すだけである。
 */

@Test @MainActor func shareRoundTripsThroughTheAppScheme() async {
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: nil); s1.loadSample(.switzerland); await s1.build(); await s1.changeTripDays(5)
  guard let urls = s1.shareURLs(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)) else { Issue.record("share was blocked"); return }
  #expect(urls.web.absoluteString.hasPrefix("https://tripcheck-japan-tokyo.syoki.chatgpt.site/ja#t="))
  guard let code = PlannerStore.shareCode(from: urls.app) else { Issue.record("app url has no code"); return }
  #expect(code == PlannerStore.shareCode(from: urls.web))
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  let imported = await s2.importShare(code: code)
  #expect(imported)
  #expect(s2.edit.tripDays == 5); #expect(s2.request.tripDays == 5); #expect(s2.request.entries.count == 8)
}

@Test @MainActor func reservationsAreRedactedUnlessIncluded() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil); s.loadSample(.switzerland)
  s.request.entries[0].isReservation = true; s.request.entries[0].fixedTime = "10:00"; await s.build()
  #expect(s.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)).redactedReservationCount == 1)
  #expect(s.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: true)).warnings.contains(.RESERVATION_DETAILS_INCLUDED))
}

/// リンクは 2 つの形で来る —— Web の `#t=` と、アプリの `tripcheck://t/`。同じ 1 本の
/// コードを両方から読み出せなければ、端末で作ったリンクを Web で開いた人と、その逆の人が
/// 別の旅程を見ることになる。base64url でない字が混じったものは**読まない**。
@Test @MainActor func theShareCodeIsReadFromBothLinkForms() async {
  #expect(PlannerStore.shareCode(from: URL(string: "https://tripcheck-japan-tokyo.syoki.chatgpt.site/ja#t=AbC-_09")!) == "AbC-_09")
  #expect(PlannerStore.shareCode(from: URL(string: "https://tripcheck-japan-tokyo.syoki.chatgpt.site/#t=AbC-_09")!) == "AbC-_09")
  #expect(PlannerStore.shareCode(from: URL(string: "tripcheck://t/AbC-_09")!) == "AbC-_09")
  #expect(PlannerStore.shareCode(from: URL(string: "tripcheck://t/AbC-_09/extra")!) == nil)
  #expect(PlannerStore.shareCode(from: URL(string: "https://tripcheck-japan-tokyo.syoki.chatgpt.site/ja#t=has%20space")!) == nil)
  #expect(PlannerStore.shareCode(from: URL(string: "https://tripcheck-japan-tokyo.syoki.chatgpt.site/ja")!) == nil)
  #expect(PlannerStore.shareCode(from: URL(string: "tripcheck://open")!) == nil)
}

/// 選ばなかったものはリンクに入らない —— ホテルの名前は、その 1 つの錠剤だけで消える。
/// 消えるのは**リンクの中身**であって手元の旅程ではないので、同じ store から続けて
/// 両方のリンクが作れる。
@Test @MainActor func theHotelTravelsOnlyWhenItIsChosen() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s.loadSample(.switzerland)
  s.setHotelQuery("Hotel Schweizerhof Luzern")
  await s.build()

  let withoutHotel = s.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false))
  let withHotel = s.sharePreview(scope: ShareScopeOptions(dates: true, hotel: true, airports: false, reservations: false))
  guard let bare = withoutHotel.code.flatMap(ShareCodec.decode), let full = withHotel.code.flatMap(ShareCodec.decode) else {
    Issue.record("both scopes must produce a readable code")
    return
  }
  #expect(bare.hotelQuery.isEmpty)
  #expect(full.hotelQuery == "Hotel Schweizerhof Luzern")
  #expect(s.edit.hotelQuery == "Hotel Schweizerhof Luzern")
}

/// どんな選択でも、リンクを持っている人は旅程を見られる —— その 2 つの警告は選択で
/// 消えない。消える警告(予約・読めなかった行)と同じ列に並べておくと、消えたことが
/// 「安全になった」という意味に読める。
@Test @MainActor func thePrivacyWarningsNeverDependOnTheScope() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s.loadSample(.switzerland)
  await s.build()
  var checked = 0
  for scope in [ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false),
                ShareScopeOptions(dates: false, hotel: true, airports: true, reservations: true)] {
    let preview = s.sharePreview(scope: scope)
    #expect(preview.warnings.contains(.URL_VISIBLE_TO_RECIPIENTS))
    #expect(preview.warnings.contains(.URL_VISIBLE_IN_BROWSER_HISTORY))
    #expect(!preview.blocked)
    checked += 1
  }
  #expect(checked == 2)
}

/// 共有できないときは URL を作らない。「作ったが壊れている」リンクを配らせるより、
/// 配れないと言うほうがいい —— 画面の CTA はこの `nil` をそのまま無効に写す。
@Test @MainActor func aBlockedShareHasNoUrlAtAll() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s.request.entries = [WishlistEntry(text: "https://example.com/booking/12345")]
  await s.build()

  let scope = ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)
  let preview = s.sharePreview(scope: scope)
  #expect(preview.blocked)
  #expect(preview.warnings.contains(.NO_SHAREABLE_PLACES))
  #expect(preview.omittedUnparsedLines == 1)
  #expect(s.shareURLs(scope: scope) == nil)
}

/// 読めないコードは何も変えない —— 開いていた旅程が黙って消えるくらいなら、リンクを
/// 読めなかったと言う。
@Test @MainActor func aLinkThatCannotBeReadLeavesTheTripAlone() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s.loadSample(.switzerland)
  await s.build()
  let before = s.request.entries.count

  let imported = await s.importShare(code: "not-a-real-share-code")
  #expect(!imported)
  #expect(s.request.entries.count == before)
  #expect(s.view.screen == .plan)
  #expect(s.view.toast?.text == AppCopy.for(s.request.locale).shareImportFailed)
}

/// 受け取った旅程は**組み直す** —— コードに座標は入っていないので、場所は受け取った端末の
/// 解決器がもう一度決める。決まったところまでは編集(滞在時間)も宛先を見つける。
@Test @MainActor func anImportedTripIsResolvedAndBuiltAgain() async {
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s1.loadSample(.switzerland)
  await s1.build()
  guard let stopId = s1.bundle?.plan.days.first?.stops.first?.stop.id else { Issue.record("the sample must build"); return }
  await s1.setStayMinutes(stopId: stopId, minutes: 75)
  #expect(s1.edit.userStayMinutes[stopId] == 75)

  guard let code = s1.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)).code else {
    Issue.record("share was blocked")
    return
  }
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  #expect(await s2.importShare(code: code))
  #expect(s2.view.screen == .plan)
  #expect(s2.bundle != nil)
  #expect(s2.request.entries.allSatisfy { $0.pinned != nil })
  #expect(s2.edit.userStayMinutes[stopId] == 75)
  #expect(s2.request.destination == .destination(.switzerland))
}

/// 仮置きの日付は日付ではない。Web は入力欄に既定の日付を先に置き、旅行者が触ったかどうかを
/// `dateWasProvided` で別に覚えている —— 触っていない日付をこの端末が採ると、祝日も営業時間も
/// 「旅行者が決めた日」の根拠として付いてしまう(`Store/BuildRunner.swift` の
/// `dateWasProvided: ctx.tripStartDate != nil`)。
@Test @MainActor func aPlaceholderDateFromTheWebNeverBecomesAChosenDate() async {
  let s = PlannerStore(resolvers: [], store: nil)

  #expect(await s.importShare(code: handMadeShareCode(
    itinerary: "Chalet Bergblick",
    tripStartDate: "2026-09-01",
    dateWasProvided: false
  )))
  #expect(s.request.tripStartDate == nil)

  #expect(await s.importShare(code: handMadeShareCode(
    itinerary: "Chalet Bergblick",
    tripStartDate: "2026-09-01",
    dateWasProvided: true
  )))
  #expect(s.request.tripStartDate == "2026-09-01")
}

/// 旅行者が地図に自分で置いた点は**リンクに乗る**。乗らなければ、受け取った端末は名前から
/// 引き直すしかなく、送り主が「ここだ」と言った 1 点が別の場所に化ける。乗るのは手入力の
/// 決定だけ(端末の地図が答えた識別子は Web にとって別の提供元の番号なので送らない)。
@Test @MainActor func aPinTheTravellerPlacedRidesInTheLink() async {
  let s1 = PlannerStore(resolvers: [], store: nil)
  let entryId = s1.addEntrySync(text: "Chalet Bergblick")
  s1.setManualPin(
    entryId: entryId,
    name: "Chalet Bergblick",
    address: "Dorfstrasse 12, Grindelwald",
    latitude: 46.62405,
    longitude: 8.03412
  )
  #expect(s1.shareableInput().resolutionOverrides == [
    .manual(inputIndex: 0, name: "Chalet Bergblick", address: "Dorfstrasse 12, Grindelwald",
            latitude: 46.62405, longitude: 8.03412)
  ])

  guard let code = s1.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)).code else {
    Issue.record("share was blocked")
    return
  }
  let s2 = PlannerStore(resolvers: [], store: nil)
  #expect(await s2.importShare(code: code))
  guard case .manual(let stop)? = s2.request.entries.first?.pinned else {
    Issue.record("the traveller's own pin must arrive as a pin, not as a name to look up again")
    return
  }
  #expect(stop.latitude == 46.62405)
  #expect(stop.longitude == 8.03412)
  #expect(stop.name == "Chalet Bergblick")
  #expect(stop.userProvidedCoordinates == true)
}

/// リンクは**解決の最中にも**開く(`.onOpenURL` は待ってくれない)。飛んでいた問い合わせが
/// 返ってきたとき、その答えはもう誰の答えでもない —— 番号で新しい旅の行に貼り付けない。
/// そして取り込みは、組めていないのに「開きました」と言わない。
@Test @MainActor func aLinkOpenedDuringAResolveNeverInheritsTheOldAnswers() async {
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s1.loadSample(.switzerland)
  await s1.build()
  guard let code = s1.sharePreview(scope: ShareScopeOptions(dates: true, hotel: false, airports: false, reservations: false)).code else {
    Issue.record("share was blocked")
    return
  }

  let s2 = PlannerStore(resolvers: [SlowResolver()], store: nil)
  s2.request.entries = [WishlistEntry(text: "Stale Place One"), WishlistEntry(text: "Stale Place Two")]
  let stale = Task { await s2.requestBuildFromStart() }
  // 本当に飛んでいるところへ割り込む(旗が立つまで待つ)—— 待たないと、機械の忙しさ次第で
  // 「解決が始まる前の取り込み」を測ることになる。
  while !s2.isResolvingPlaces { await Task.yield() }

  let imported = await s2.importShare(code: code)
  let staleLanded = await stale.value

  #expect(imported)
  #expect(!staleLanded)
  #expect(s2.view.screen == .plan)
  #expect(s2.bundle != nil)
  #expect(s2.request.entries.count == 8)
  // 貼り付いた場所は 1 つ残らず**その行自身の問い**の答え。前の旅の 2 件はどこにも居ない。
  #expect(s2.request.entries.allSatisfy { $0.pinned?.stop.input == $0.text })
  #expect(!s2.request.entries.contains { $0.text.hasPrefix("Stale Place") })
}

/// 場所が 1 つも読めないコードは、読めなかったコードと同じ扱い —— **開いていた旅程を
/// 消さない**。復号は通るが中身が URL だけ、という形は Web でも作れる。
@Test @MainActor func aCodeWithNoPlacesLeavesTheTripAlone() async {
  let s = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  s.loadSample(.switzerland)
  await s.build()
  let before = s.request.entries.count

  let imported = await s.importShare(code: handMadeShareCode(itinerary: "https://example.com/booking/12345"))
  #expect(!imported)
  #expect(s.request.entries.count == before)
  #expect(s.view.screen == .plan)
  #expect(s.bundle != nil)
  #expect(s.view.toast?.text == AppCopy.for(s.request.locale).shareImportFailed)
}

/// 表示のモードは**12 件に詰めた後の行**から出す。日が付いていたのが切り落とされた行だけ
/// だった旅程で「既にある旅程の確認」が残ると、画面が手元の行と食い違う。
@Test @MainActor func theModeIsReadFromTheRowsThatSurvivedTheCap() async {
  let itinerary = (1...12).map { "Place \($0)" }.joined(separator: "\n") + "\nDay 2\nPlace 13"
  let s = PlannerStore(resolvers: [], store: nil)
  #expect(await s.importShare(code: handMadeShareCode(itinerary: itinerary)))
  #expect(s.request.entries.count == 12)
  #expect(s.request.entries.allSatisfy { $0.fixedDay == nil })
  #expect(s.request.inputMode == .wishlist)
}

/// 送信側の画面を通さずに 1 本のリンクを組む。`sharePreview` は `ShareScope` を通るので、
/// そこで止まる形(場所の無い行程)や、Web だけが作る形(仮置きの日付)はテストに渡って
/// こない —— このヘルパはその 2 つを作るためだけに在る。
private func handMadeShareCode(
  itinerary: String,
  tripStartDate: String = "",
  dateWasProvided: Bool = false
) -> String {
  ShareCodec.encode(ShareableTripInput(
    destination: .destination(.switzerland),
    itinerary: itinerary,
    tripDays: 3,
    tripStartDate: tripStartDate,
    dateWasProvided: dateWasProvided,
    hotelQuery: "",
    pace: .balanced,
    mealPlan: .all,
    travelPreference: .auto,
    arrivalAirport: "none",
    arrivalTime: "",
    departureAirport: "none",
    departureTime: "",
    flightKind: .international,
    dayStartDefault: "09:00",
    dayEndTarget: "",
    transferBufferMinutes: 0
  ))
}

/// 警告 1 件につき文が 1 つ。どれも空でなく、禁止語を踏まない —— 旅行者が最後に読む
/// 「共有していいか」の判断材料そのものなので、機械語が混ざってはいけない。
@Test @MainActor func everyShareWarningHasAReadableLine() async {
  var checked = 0
  for locale in [PlannerLocale.ja, .en] {
    let s = PlannerStore(resolvers: [], store: nil)
    s.request.locale = locale
    for code in ShareWarningCode.allCases {
      let line = s.shareWarningLine(code, omittedLines: 2)
      #expect(!line.isEmpty, "\(locale): \(code)")
      #expect(BannedTerms.violations(in: line).isEmpty, "\(locale): \(line)")
      checked += 1
    }
  }
  #expect(checked == ShareWarningCode.allCases.count * 2)
}
