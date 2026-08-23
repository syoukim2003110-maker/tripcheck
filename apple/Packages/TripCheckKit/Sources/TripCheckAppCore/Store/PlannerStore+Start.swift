import Foundation
import TripCheckKit

/*
 * Start 画面から呼ばれる操作 —— 行きたい場所を 1 件ずつ足し、優先度を変え、外し、
 * 行き先の国を選び、ビルド前の条件を決め、最後に CTA を押す。
 *
 * 画面が状態を直に書き換えるのはここに無い欄(`view` の開閉と `request` の単純な欄)だけで、
 * `edit` に触るもの・解決やビルドを走らせるものは全部この拡張の関数を通る。
 */
extension PlannerStore {

  /// 1 回に扱える場所の数。Web の `PlacesStep.tsx:220` と同じ 12 ——「黙って切り捨てない」
  /// ための上限なので、超えた分は捨てずに**足させない**。
  public static let placeLimit = 12

  // MARK: - 行きたい場所

  public var canAddEntry: Bool { request.entries.count < Self.placeLimit }

  /// 1 行足して、その行の id を返す。**上限は見ない** —— 見張りは `addEntry` と
  /// `canAddEntry` の側で、こちらは「足す」という一手だけを持つ(貼り付け取り込みなど、
  /// 自前で数えてから呼ぶ道がある)。
  @discardableResult
  public func addEntrySync(text: String) -> UUID {
    let entry = WishlistEntry(text: text)
    request.entries.append(entry)
    return entry.id
  }

  /// 検索窓から 1 件足す。候補を選んで足したときは `suggestion` が付く。
  ///
  /// いまは名前だけを持ち、場所そのものは CTA の解決で決める。**Task 5** で、候補つきの
  /// 追加は `ApplePlaceResolver.resolve(completion:)` にその 1 件を引き当てさせ、
  /// `pinned = .apple(providerRef:stop:)` にする —— 旅行者が選んだ 1 件が、後の解決で
  /// 同名の別の場所に化けないように。
  public func addEntry(text: String, suggestion: PlaceSuggestion?) async {
    let name = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    guard canAddEntry else {
      view.toast = Toast(text: AppCopy.for(request.locale).placeLimitToast, kind: .limit)
      return
    }
    addEntrySync(text: name)
  }

  public func removeEntry(id: UUID) {
    request.entries.removeAll { $0.id == id }
    request.resolutions[id] = nil
    // 日の付いた最後の 1 行を外したら、もう「既にある旅程」ではない。
    refreshInputMode()
  }

  public func setPriority(id: UUID, _ priority: WishlistPriority) {
    guard let index = request.entries.firstIndex(where: { $0.id == id }) else { return }
    request.entries[index].priority = priority
  }

  /// 行 1 つぶんの条件を書き換える。**「触っていない」と「空にした」を型で分ける** ——
  /// 素の `nil` はその欄を触らない、`.some(nil)` はその欄を空にする。1 段の
  /// オプショナルに畳むと、シートが時刻だけを消したのか、優先度だけを変えたのかが
  /// 区別できず、片方を触るたびにもう片方が消える。
  ///
  /// 値はここで**エンジンが読める形に丸める**。`WishlistSerialization.raw` が吐く行は Kit の
  /// パーサが読み戻せなければならない(貼り付け → 編集 → 共有の往復で綴りが変わらない、が
  /// この型の存在理由)ので、時計として読めない時刻は空に、滞在は
  /// `EngineConstants.stayMinutesRange` の中に、日は `EngineConstants.tripDaysRange`
  /// (1〜14 日目)の中に畳む。`tripDays`(旅行者が名乗った日数)には丸めない —— 日数は後で
  /// 増やせるし、`day > tripDays` はビルダー側が扱う話なので、ここでは切り捨てない。
  public func updateEntry(
    id: UUID,
    priority: WishlistPriority? = nil,
    fixedTime: String?? = nil,
    isReservation: Bool? = nil,
    stayMinutes: Int?? = nil,
    fixedDay: Int?? = nil
  ) {
    guard let index = request.entries.firstIndex(where: { $0.id == id }) else { return }
    if let priority { request.entries[index].priority = priority }
    if let fixedTime { request.entries[index].fixedTime = fixedTime.flatMap { ClockTime($0)?.description } }
    if let isReservation { request.entries[index].isReservation = isReservation }
    if let stayMinutes { request.entries[index].stayMinutes = stayMinutes.map(Self.clampedStayMinutes) }
    if let fixedDay {
      request.entries[index].fixedDay = fixedDay.map(Self.clampedFixedDay)
      refreshInputMode()
    }
  }

  /// まとめて貼られた文字列を、行きたい場所リストへ**足す**。入れ替えない —— 1 件ずつ
  /// 入れた場所が貼り付けで消えたら、旅行者は打ち直すことになる。
  ///
  /// 12 件を超えた分は入れずにトーストで報せ(黙って切り捨てない)、場所名として読み取れ
  /// なかった行は `request.unparsedLines` に残す。戻り値は「足せた数」と「読めなかった行数」。
  ///
  /// **`edit.lockedOrderByDay` には書かない。** 停留所 id は場所が決まった後にしか存在せず、
  /// `TripBuilder` は `knownStopIds` に無い id を黙って落としたうえで、日が非 nil ならパーサが
  /// 読んだ順(`parsedOrderByDay`)を上書きする —— 貼った順序がむしろ失われる。日を
  /// `fixedDay` に載せておけば `WishlistSerialization.raw` が `Day N` 見出しを出し、ビルダー
  /// 自身が `.existing_itinerary` を選ぶ。
  @discardableResult
  public func importPasted(_ raw: String) -> (added: Int, unparsed: Int) {
    let parsed = WishlistSerialization.entries(fromPasted: raw)
    let already = request.entries.count
    let room = max(0, Self.placeLimit - already)
    // 貼った見出しの日は `EngineConstants.tripDaysRange` の外に出うる(「Day 99」も文字列と
    // しては読める)。`fixedDay` に丸めずに載せると、行編集シートの `Picker` に対応するタグが
    // 無くなり(空・VoiceOver が何も読まない・触ると黙って別の日に変わる)、共有時は
    // `Day 99` がそのまま出て Web が受け取れない。
    let added = parsed.entries.prefix(room).map { entry -> WishlistEntry in
      guard let day = entry.fixedDay else { return entry }
      var entry = entry
      entry.fixedDay = Self.clampedFixedDay(day)
      return entry
    }

    request.entries.append(contentsOf: added)
    request.unparsedLines.append(contentsOf: parsed.unparsed)
    refreshInputMode()
    if parsed.entries.count > room {
      view.toast = Toast(
        text: AppCopy.for(request.locale).pasteLimitToast(count: already + parsed.entries.count),
        kind: .limit
      )
    }
    return (added.count, parsed.unparsed.count)
  }

  /// 表示用のモードを、いま手元にある行から出し直す。`WishlistSerialization.raw` が `Day N`
  /// 見出しを出す条件と、`TripBuilder` が `.existing_itinerary` を選ぶ条件は同じ 1 つの問い
  /// (日の付いた場所が 1 つでもあるか)なので、ここも同じ問いで決める —— 表示が手元の行と
  /// 食い違わない。正はあくまで `bundle.plan.inputMode`。
  ///
  /// `private` でないのは、リンクからの取り込み(`PlannerStore+Share.swift`)が 12 件へ
  /// 詰めた**後**に同じ問いを立てるから —— パーサが数えたモードは切り落とす前の行を
  /// 見ているので、13 件目だけに日が付いていた旅程で表示と手元の行が食い違う。
  func refreshInputMode() {
    request.inputMode = request.entries.contains { $0.fixedDay != nil } ? .existing_itinerary : .wishlist
  }

  private static func clampedStayMinutes(_ minutes: Int) -> Int {
    min(EngineConstants.stayMinutesRange.upperBound, max(EngineConstants.stayMinutesRange.lowerBound, minutes))
  }

  /// 日を `EngineConstants.tripDaysRange`(1〜14 日目)の両端に畳む。下だけを畳んで上を
  /// 開けたままにすると、貼り付けの「Day 99」がそのまま `fixedDay` へ載り、行編集シートの
  /// `Picker` に対応するタグの無い値になる。
  ///
  /// 貼り付けと行編集シートのほかに、端末内保存から読み戻す道も同じ畳み方を通る
  /// (`PersistedEntry.entry(index:)`)—— 保存ファイルは書き換えられうるので、入り口が
  /// 1 つ増えるたびにここを通す。
  nonisolated static func clampedFixedDay(_ day: Int) -> Int {
    min(EngineConstants.tripDaysRange.upperBound, max(EngineConstants.tripDaysRange.lowerBound, day))
  }

  /// 滞在時間の刻み。幅は Kit の `EngineConstants.stayMinutesRange`(15〜480 分)で、Web の
  /// 数値入力には無い「段」を、指で押す `Stepper` のためにここで決める。
  public static let stayMinutesStep = 15

  /// 行編集シートが「何日目まで選べるか」を出すときの日数。`tripRequest()` が使う式と同じ
  /// —— 旅行者が名乗った日数が勝ち、名乗っていなければ直近の組み立てが落ち着いた日数 ——
  /// に、1 日目の下限だけを足す(0 日の旅に「行く日」の選択肢は作れない)。
  public var plannedDays: Int {
    max(EngineConstants.tripDaysRange.lowerBound, request.tripDays ?? edit.tripDays)
  }

  /// 行編集シートの「行く日」`Picker` が選ばせる幅。既定は `1...plannedDays` だが、貼り付けが
  /// その行へ `plannedDays` を超える日を既に載せていれば(旅行者がまだ日数を上げていない
  /// 5 日目の旅程を貼った、など)、その日も範囲へ含める —— でなければ `Picker` にその日の
  /// タグが無く、選ばれていることが画面にも VoiceOver にも見えなくなり、どこを触っても
  /// 黙って別の日へ変わる。`fixedDay` は `updateEntry`/`importPasted` で既に
  /// `EngineConstants.tripDaysRange` の中へ畳んであるので、上限はその範囲を超えない。
  public func dayPickerRange(for entryId: UUID) -> ClosedRange<Int> {
    let entryDay = request.entries.first { $0.id == entryId }?.fixedDay ?? 0
    let upper = min(EngineConstants.tripDaysRange.upperBound, max(plannedDays, entryDay))
    return EngineConstants.tripDaysRange.lowerBound...upper
  }

  // MARK: - 行き先の国

  /// 行き先を決める。国を選ぶのは「場所が 2 か国に散っている」という問いに旅行者が答えた
  /// ということなので、跨ぎの報せはその場で消す。`auto` に戻したときだけ、いま決まっている
  /// 場所からもう一度数え直す。
  ///
  /// **記録するだけで、決まっている場所には触らない。** Start 画面ではまだ何も尋ねていない
  /// ので、それで足りる —— CTA の `requestBuildFromStart` が新しい国で尋ねる。確認画面から
  /// 呼ぶときは `changeDestinationFromResolve` のほうを使う: そちらは箱の外に出た場所の
  /// 固定を外して尋ね直す(ここで止めると、報せだけ消えて場所が残る)。
  public func setDestination(_ choice: DestinationChoice) {
    request.destination = choice
    guard choice == .auto else {
      request.mixedCountryCodes = []
      return
    }
    request.mixedCountryCodes = ResolutionPipeline.mixedCountryCodes(request.entries.compactMap { $0.pinned?.stop })
  }

  /// 候補検索を寄せる箱。`auto` と `worldwide` は箱を持たない(世界中が対象)。
  public var destinationBounds: GeoBounds? {
    guard case .destination(let id) = request.destination, id != .worldwide else { return nil }
    return Destinations.byId(id).bounds
  }

  // MARK: - ビルド前の条件

  /*
   * どれも `edit`(Kit の `PlannerEditState`)の欄をそのまま書くだけの同期 setter。
   * `request` に写しを持たないので、`tripRequest()` が読む値と画面が書く値がずれない。
   * **組み上がった後に同じ値を変えるのは別の話**で、そちらは Task 9 のガード付き編集を通る。
   */

  public func setPace(_ pace: Pace) { edit.pace = pace }

  public func setTravelPreference(_ preference: TravelPreference) { edit.travelPreference = preference }

  public func setTransferBufferMinutes(_ minutes: Int) { edit.transferBufferMinutes = minutes }

  public func setHotelQuery(_ query: String) { edit.hotelQuery = query }

  // MARK: - CTA

  /// 画面下の主ボタン。文と押せるかどうかは同じ 1 つの状態から出す。
  public var startCTA: (label: String, enabled: Bool) {
    let app = AppCopy.for(request.locale)
    if view.screen == .building { return (app.buildingCTA, false) }
    if isResolvingPlaces { return (app.checkingPlacesCTA, false) }
    return (app.buildCTA, !request.entries.isEmpty)
  }

  /// Start の CTA。**場所を決めてから組む** —— 決まらなかった 1 件があるまま組むと、
  /// その場所は黙って旅程から消える。
  ///
  /// 決めるのは固定されていない行だけ(既に旅行者が選んだ行に手を出さない)。1 件でも
  /// 確認が要れば確認画面へ回し、全部決まっていても場所が 2 か国に散っていれば
  /// (Web `usePlanBuild.tsx:1090-1105`)やはり回す —— どちらの国の旅かで営業時間も祝日も
  /// 変わるので、推測で組まない。
  ///
  /// 戻り値は「**この呼び出しが旅行者の画面まで届いたか**」:組んだか確認画面へ回したなら
  /// 真、入る前のガードで引き返したか、待っている間に旅が入れ替わって答えを捨てたなら偽。
  /// 押した本人(Start の CTA)は画面を見ているので気にしなくてよいが、リンクからの取り込み
  /// (`PlannerStore+Share.swift`)は**組めたと言い切る前に**これを見る —— 見ないと、
  /// 組まれていない旅程を「開きました」と報せることになる。
  @discardableResult
  public func requestBuildFromStart() async -> Bool {
    guard !request.entries.isEmpty, !isResolvingPlaces, view.screen != .building else { return false }

    let queries = request.entries.enumerated().compactMap { index, entry in
      entry.pinned == nil ? PlaceQuery(inputIndex: index, input: entry.text) : nil
    }
    var answers: [Int: PlaceResolution] = [:]
    if !queries.isEmpty {
      resolveGeneration += 1
      let generation = resolveGeneration
      isResolvingPlaces = true
      answers = await ResolutionPipeline.resolve(
        queries,
        destination: request.destination,
        locale: request.locale,
        resolvers: resolvers
      )
      // 待っている間に旅そのものが入れ替わっていたら(`reset()`)、この答えはもう
      // 誰の答えでもない。`isResolvingPlaces` にも触らない —— 旗はいま走っている
      // 新しい解決のものである。
      guard generation == resolveGeneration else { return false }
      isResolvingPlaces = false
    }

    var entries = request.entries
    var resolutions: [UUID: PlaceResolution] = [:]
    var needsAttention = false
    for index in entries.indices {
      if let answer = answers[index] {
        switch answer {
        case .confirmed(let stop):
          // 決まった場所は行に固定する。固定しないと座標がエンジンへ渡らない。
          entries[index].pinned = Self.pinned(stop)
        case .review, .unresolved:
          needsAttention = true
        }
        resolutions[entries[index].id] = answer
      } else if let pinned = entries[index].pinned {
        // 既に旅行者が選んでいた行。確認画面が全行を同じ辞書から読めるように残す。
        resolutions[entries[index].id] = .confirmed(pinned.stop)
      }
    }
    request.entries = entries
    request.resolutions = resolutions
    request.mixedCountryCodes = request.destination == .auto
      ? ResolutionPipeline.mixedCountryCodes(entries.compactMap { $0.pinned?.stop })
      : []

    guard !needsAttention, request.mixedCountryCodes.isEmpty else {
      view.screen = .resolve
      return true
    }
    await build()
    return true
  }

  /// 決まった 1 件を、**どうやって決まったか**を残す形に畳む(保存した旅程を開き直すときに
  /// 扱いが分かれる —— Task 11)。Plan 2 に居る解決器はカタログと Apple と手入力だけ。
  ///
  /// `private` ではないのは、確認画面(`PlannerStore+Resolve.swift`)が同じ畳み方をするから
  /// —— 候補を選んだ 1 件と、最初の解決で決まった 1 件が別の形で入ると、保存した旅程を
  /// 開き直したときに扱いが分かれる。
  static func pinned(_ stop: ResolvedStop) -> PinnedResolution {
    switch stop.provider {
    case .apple: .apple(providerRef: stop.providerRef, stop: stop)
    case .user: .manual(stop)
    case .catalog, .google, nil: .catalog(stop)
    }
  }
}
