import Foundation
import TripCheckKit

/*
 * 共有 —— いまの旅程を 1 本の URL に畳み、その URL から旅程を組み直す。
 *
 * **リンクがデータそのもの**で、サーバには何も残らない(`Share/ShareCodec.swift`)。だから
 * このファイルはコードのバイトを 1 つも作らない:畳むのは Kit の `ShareCodec`、何を隠すかを
 * 決めるのは Kit の `ShareScope` で、ここがするのは「いまの状態を `ShareableTripInput` に
 * 写す」ことと「受け取ったものを状態に戻す」ことだけである。墨消しをここで書き直せば、
 * Web と iPhone で隠れるものが違うリンクが 2 種類できてしまう。
 *
 * リンクは 2 つの姿で出る。Web の `https://…/ja#t=<code>` は相手が何を持っていても開き、
 * `tripcheck://t/<code>` は入っている端末で直に開く。**同じ 1 本のコード**なので、どちらから
 * 入っても同じ旅程になる。
 */
extension PlannerStore {

  // MARK: - リンクの形

  /// Web 側の入口。`app/components/planner/TripPlannerShell.tsx:1337` が
  /// `${origin}${locale === "ja" ? "/ja" : "/"}#t=${code}` を作るのと同じ綴りになる。
  public static let shareWebBase = "https://tripcheck-japan-tokyo.syoki.chatgpt.site/"

  /// アプリ側の入口(`apple/project.yml` の `CFBundleURLSchemes`)。
  public static let shareURLScheme = "tripcheck"

  /// base64url の字だけ。Web の受け口 `/^#t=([A-Za-z0-9_-]+)$/`
  /// (`app/components/planner/hooks/useTripPersistence.tsx:70`)と同じ集合で、これを通らない
  /// ものは**復号にも回さない** —— 通さなくても `ShareCodec.decode` が撥ねるが、リンクの形が
  /// 違うものと中身が壊れているものを同じ「読めません」にすると、どちらを直せばよいか
  /// 分からなくなる。
  private static let codeCharacters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")

  // MARK: - 共有できる形へ畳む

  /// いまの入力と編集を、共有できる 1 つの荷物に畳む。
  ///
  /// 行程の文字列は `tripRequest()` とまったく同じ直列化器(`WishlistSerialization.raw`)を
  /// 通る —— エンジンが読む文と、リンクに乗る文が同じ 1 つの綴りであることが、貼り付け →
  /// 編集 → 共有の往復で場所が化けないことの根拠になる。
  ///
  /// **プロバイダの応答は入らない。** 座標も営業時間も口コミも入らず、渡るのは旅行者が
  /// 書いた文と決めた条件だけで、場所は受け取った端末がもう一度決める。
  public func shareableInput() -> ShareableTripInput {
    ShareableTripInput(
      destination: request.destination,
      itinerary: WishlistSerialization.raw(from: request.entries, locale: request.locale),
      // `tripRequest()` と同じ式(R6)。名乗った日数が勝ち、名乗っていなければ直近の
      // 組み立てが落ち着いた日数。
      tripDays: request.tripDays ?? edit.tripDays,
      tripStartDate: request.tripStartDate ?? "",
      // アプリは「日付を入れたか」を別の欄で持たない —— 日付が入っていること自体が
      // 旅行者が入れたという意味である(`Store/BuildRunner.swift` の `dateWasProvided` も
      // 同じ 1 つの問いを見ている)。
      dateWasProvided: request.tripStartDate != nil,
      hotelQuery: edit.hotelQuery,
      pace: edit.pace,
      mealPlan: request.mealPlan,
      travelPreference: edit.travelPreference,
      arrivalAirport: Self.shareAirport(request.arrivalAirport),
      arrivalTime: request.arrivalTime,
      departureAirport: Self.shareAirport(request.departureAirport),
      departureTime: request.departureTime,
      flightKind: request.flightKind,
      dayStartDefault: request.dayStartDefault,
      dayEndTarget: request.dayEndTarget ?? "",
      transferBufferMinutes: edit.transferBufferMinutes,
      maxWalkingMinutesPerLeg: request.maxWalkingMinutesPerLeg,
      maxTransfersPerLeg: request.maxTransfersPerLeg,
      userStayMinutes: Self.shareRecord(edit.userStayMinutes),
      lastEntryTimes: Self.shareRecord(edit.lastEntryTimes),
      dayStartTimes: edit.dayStartTimes,
      dayEndTimes: edit.dayEndTimes,
      legModeOverrides: Self.shareRecord(edit.legModeOverrides),
      dayOverrides: Self.shareRecord(edit.dayOverrides),
      lockedOrderByDay: edit.lockedOrderByDay.values.isEmpty ? nil : edit.lockedOrderByDay,
      removedStops: edit.removedStops,
      resolutionOverrides: edit.resolutionOverrides.isEmpty ? nil : edit.resolutionOverrides
    )
  }

  /// 選んだ範囲でリンクを作ってみた結果 —— 隠したもの、落とした行、警告、作れたかどうか。
  /// 画面はこれを 1 度だけ計算して、文も URL も同じ 1 つの結果から出す。
  public func sharePreview(scope: ShareScopeOptions) -> ScopedShareResult {
    ShareScope.scoped(shareableInput(), scope: scope, locale: request.locale)
  }

  /// 配る 2 本の URL。**`blocked` なら `nil`** —— 壊れやすいリンクを黙って作るより、
  /// 作らなかったと言うほうがいい(Kit の `ShareScope` がその判断を持っている)。
  public func shareURLs(scope: ShareScopeOptions) -> (web: URL, app: URL)? {
    shareURLs(for: sharePreview(scope: scope))
  }

  /// 既に計算してある結果から URL を出す。画面は `sharePreview` を 2 度呼ばない
  /// —— 同じ選択で 2 度畳めば同じコードになるが、その 2 度目は要らない仕事である。
  public func shareURLs(for result: ScopedShareResult) -> (web: URL, app: URL)? {
    guard !result.blocked, let code = result.code else { return nil }
    return Self.shareURLs(code: code, locale: request.locale)
  }

  static func shareURLs(code: String, locale: PlannerLocale) -> (web: URL, app: URL)? {
    guard let web = URL(string: "\(shareWebBase)\(locale == .ja ? "ja" : "")#t=\(code)"),
          let app = URL(string: "\(shareURLScheme)://t/\(code)")
    else { return nil }
    return (web: web, app: app)
  }

  /// メールなどの件名。端末に残る旅程と**同じ題**(先頭 3 か所の名前)—— 送った人の一覧に
  /// 並ぶ名前と、受け取った人が見る名前が違うと、同じ旅だと分からない。
  public var shareSubject: String { persistedTitle }

  // MARK: - リンクから共有コードを取り出す

  /// `https://…/ja#t=<code>` と `tripcheck://t/<code>` の**両方**から、同じ 1 本のコードを
  /// 読み出す。読めなければ `nil`(その URL はこのアプリ宛てではない)。
  public static func shareCode(from url: URL) -> String? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    if let fragment = components.fragment, fragment.hasPrefix("t=") {
      return validCode(String(fragment.dropFirst(2)))
    }
    // `tripcheck://t/<code>` の `t` は URL としては**ホスト**に入る(`//` の直後なので)。
    // 経路の一部として扱うために先頭へ戻す。
    var segments = components.path.split(separator: "/").map(String.init)
    if let host = components.host, !host.isEmpty { segments.insert(host, at: 0) }
    guard segments.count == 2, segments[0] == "t" else { return nil }
    return validCode(segments[1])
  }

  /// base64url の字だけで、Web が受け取れる長さに収まっているか。上限は共有そのものの上限
  /// (`ShareScope.maxFragmentChars`)—— それより長いコードはどちらの端末も作らないので、
  /// 復号を試すまでもなく私たちのリンクではない。
  private static func validCode(_ code: String) -> String? {
    guard !code.isEmpty, code.count <= ShareScope.maxFragmentChars,
          code.allSatisfy({ codeCharacters.contains($0) })
    else { return nil }
    return code
  }

  // MARK: - リンクを開く

  /// 受け取ったコードから旅程を組み直す。戻り値は「読めたか」。
  ///
  /// **写しを戻すのではなく組み直す**(`openTrip` と同じ考え)—— コードに入っているのは
  /// 旅行者が書いた文と決めた条件だけなので、場所は Start と同じ手順でこの端末が決め、
  /// そのうえでもう一度組む。読めなかったときは**何も変えない**:開いていた旅程が黙って
  /// 消えるくらいなら、リンクを読めなかったと言う。
  @discardableResult
  public func importShare(code: String) async -> Bool {
    guard let shared = ShareCodec.decode(code) else {
      showToast(Toast(text: AppCopy.for(request.locale).shareImportFailed, kind: .info))
      return false
    }

    let parsed = WishlistSerialization.entries(fromPasted: shared.itinerary)
    reset()

    // 12 件の上限は手で足すときと同じ(`Store/PlannerStore+Start.swift`)。共有コードは
    // 4,000 文字まで行程を運べるので、上限より多い行が届きうる。
    request.entries = Array(parsed.entries.prefix(Self.placeLimit)).map { entry in
      guard let day = entry.fixedDay else { return entry }
      var clamped = entry
      clamped.fixedDay = Self.clampedFixedDay(day)
      return clamped
    }
    // 入り切らなかった行は**黙って捨てない**。貼り付けの取り込みと同じ 1 文で報せる ——
    // 受け取った旅程が送り主のものより短い理由が、どこにも書いていない画面にしない。
    if parsed.entries.count > Self.placeLimit {
      showToast(Toast(text: AppCopy.for(request.locale).pasteLimitToast(count: parsed.entries.count), kind: .limit))
    }
    request.unparsedLines = parsed.unparsed
    request.inputMode = parsed.mode
    request.tripDays = shared.tripDays
    request.tripStartDate = shared.tripStartDate.isEmpty ? nil : shared.tripStartDate
    request.destination = shared.destination
    request.dayStartDefault = shared.dayStartDefault
    request.dayEndTarget = shared.dayEndTarget.isEmpty ? nil : shared.dayEndTarget
    request.maxWalkingMinutesPerLeg = shared.maxWalkingMinutesPerLeg
    request.maxTransfersPerLeg = shared.maxTransfersPerLeg
    request.arrivalAirport = Self.requestAirport(shared.arrivalAirport)
    request.arrivalTime = shared.arrivalTime
    request.departureAirport = Self.requestAirport(shared.departureAirport)
    request.departureTime = shared.departureTime
    request.flightKind = shared.flightKind
    request.mealPlan = shared.mealPlan

    edit.tripDays = shared.tripDays
    edit.pace = shared.pace
    edit.hotelQuery = shared.hotelQuery
    edit.travelPreference = shared.travelPreference
    edit.transferBufferMinutes = shared.transferBufferMinutes
    edit.userStayMinutes = shared.userStayMinutes.dictionary
    edit.lastEntryTimes = shared.lastEntryTimes.dictionary
    edit.dayStartTimes = shared.dayStartTimes
    edit.dayEndTimes = shared.dayEndTimes
    edit.legModeOverrides = shared.legModeOverrides.dictionary
    edit.dayOverrides = shared.dayOverrides.dictionary
    edit.lockedOrderByDay = shared.lockedOrderByDay ?? IntKeyedDictionary()
    edit.removedStops = shared.removedStops
    edit.resolutionOverrides = shared.resolutionOverrides ?? []
    applySharedManualPins()

    // Start の CTA をそのまま通す —— 決まっていない行は解決し、決まらなかった行があれば
    // 確認画面へ回し、全部決まっていれば組む。ここで別の道を作ると、受け取った旅程だけ
    // 「場所が決まらないまま黙って消える」経路ができる。
    await requestBuildFromStart()
    return true
  }

  /// リンクに乗ってきた手入力の決定を、そのまま行に固定する。**座標が渡るのはこれだけ** ——
  /// 旅行者が地図に自分で置いた点は尋ね直す相手が居ないので、名前から引き直せない。
  ///
  /// 固定してから Start の解決に入るので、この行は解決器に尋ねられない(`requestBuildFromStart`
  /// が尋ねるのは `pinned == nil` の行だけ)。
  private func applySharedManualPins() {
    for override in edit.resolutionOverrides {
      guard case .manual(let inputIndex, _, _, _, _) = override,
            request.entries.indices.contains(inputIndex),
            let stop = PlannerEdits.manualStop(from: override, input: request.entries[inputIndex].text)
      else { continue }
      request.entries[inputIndex].pinned = .manual(stop)
    }
  }

  // MARK: - 画面に出す文

  /// 共有の画面に出る 1 行。**警告そのものではなく、warning コードから引いた文**なので、
  /// 出す順は Kit が並べた `warnings` の順のまま(privacy → caution → error)。
  public struct ShareNotice: Equatable, Sendable, Identifiable {
    /// 何色で読むか。`privacy` は選択に関わらず常にあるもの、`caution` は選択で消えるもの、
    /// `error` はリンクが作れないという知らせ。
    public enum Kind: Equatable, Sendable { case privacy, caution, error }

    public let id: String
    public let kind: Kind
    public let text: String
  }

  /// 1 つの結果を、画面がそのまま並べられる文の列にする。**数を数え直さない** ——
  /// 墨消しの件数も落とした行数も Kit が数えたものをそのまま読む。
  public func shareNotices(_ result: ScopedShareResult) -> [ShareNotice] {
    let app = AppCopy.for(request.locale)
    var notices = result.warnings.filter { Self.warningKind($0) == .privacy }.map { code in
      ShareNotice(id: code.rawValue, kind: .privacy, text: shareWarningLine(code, omittedLines: result.omittedUnparsedLines))
    }
    // 隠した予約の件数は警告コードを持たない —— 「気をつけて」ではなく「こう隠した」と
    // いう報告なので、警告の前に置く。
    if result.redactedReservationCount > 0 {
      notices.append(ShareNotice(
        id: "redactedReservations",
        kind: .caution,
        text: app.shareRedactedReservations(count: result.redactedReservationCount)
      ))
    }
    notices += result.warnings.filter { Self.warningKind($0) != .privacy }.map { code in
      ShareNotice(id: code.rawValue, kind: Self.warningKind(code), text: shareWarningLine(code, omittedLines: result.omittedUnparsedLines))
    }
    return notices
  }

  /// 警告 1 件の文。URL が見えるという 2 つは Kit の `shareWarning` / `shareWarningDetail`
  /// (Web と同じ文)で、残りはこのアプリの `AppCopy` にある。
  public func shareWarningLine(_ code: ShareWarningCode, omittedLines: Int) -> String {
    let text = Copy.for(request.locale)
    let app = AppCopy.for(request.locale)
    switch code {
    case .URL_VISIBLE_TO_RECIPIENTS: return text.shareWarning
    case .URL_VISIBLE_IN_BROWSER_HISTORY: return text.shareWarningDetail
    case .RESERVATION_DETAILS_INCLUDED: return app.shareReservationsIncluded
    case .UNPARSED_LINES_OMITTED: return app.shareOmittedLines(count: omittedLines)
    case .LINK_TOO_LONG: return app.shareTooLong
    case .NO_SHAREABLE_PLACES: return app.shareNoPlaces
    }
  }

  private static func warningKind(_ code: ShareWarningCode) -> ShareNotice.Kind {
    switch code {
    case .URL_VISIBLE_TO_RECIPIENTS, .URL_VISIBLE_IN_BROWSER_HISTORY: .privacy
    case .RESERVATION_DETAILS_INCLUDED, .UNPARSED_LINES_OMITTED: .caution
    case .LINK_TOO_LONG, .NO_SHAREABLE_PLACES: .error
    }
  }

  // MARK: - 欄の写し方

  /// 空文字(アプリの「指定なし」)を Web の番兵 `"none"` にする。
  private static func shareAirport(_ code: String) -> String { code.isEmpty ? "none" : code }

  /// その逆。`ShareCodec.decode` は読めない空港コードを必ず `"none"` にして返す。
  private static func requestAirport(_ code: String) -> String { code == "none" ? "" : code }

  /// 並びを覚えていない `Dictionary` から、並びを覚えている `ShareRecord` を作る。
  ///
  /// **鍵で並べる。** 共有コードは JSON の鍵の並びまで含めて 1 本の文字列なので、
  /// `Dictionary` の並び(実行ごとに変わる)をそのまま流すと、同じ旅程が押すたびに別の
  /// リンクになる。掃除役の「先頭 80 件」(`cleanNumberRecord`)もこの並びの上で数えられる
  /// ので、決まった順であること自体が受け取り側の答えを決めている。
  private static func shareRecord<Value: Equatable & Sendable>(_ values: [String: Value]) -> ShareRecord<Value> {
    ShareRecord(values.keys.sorted().map { ($0, values[$0]!) })
  }
}
