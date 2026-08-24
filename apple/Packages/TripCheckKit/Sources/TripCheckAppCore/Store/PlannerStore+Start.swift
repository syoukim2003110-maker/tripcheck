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
  /// **候補を選んだら、その 1 件を行に固定する**(spec §5.2)。選ばれた候補は
  /// `ApplePlaceResolver.resolve(completion:)` が座標と住所のある停留所に変え、
  /// `pinned = .apple(providerRef: nil, stop:)` として行に載る —— 載せずに名前だけを
  /// 持っていた頃は、CTA の解決が同じ文字列でもう一度地図に尋ねており、旅行者が目で見て
  /// 選んだ「Bahnhof Bern」が別の街の駅や候補待ちに化けえた。選んだことが画面に残らない。
  ///
  /// 行は**先に**足す。地図の返事は数秒後に来るので、待ってから足すと、押した指と行が現れる
  /// 瞬間の間が空く。引き当てられなかったとき(打ち切り・0 件・行き先の箱の外)は固定しない
  /// まま残し、CTA の解決が普通に尋ね直す。
  ///
  /// 待っている間に旅が入れ替わったら(`reset()`:リンクを開いた・保存した旅程を開いた・
  /// 見本を入れた)、この答えはもう誰の答えでもないので捨てる(`resolveGeneration`)。
  /// `isResolvingPlaces` は立てない —— あの旗は CTA を押せなくするためのもので、1 行足した
  /// だけで旅程を組む道を塞がない。
  public func addEntry(text: String, suggestion: PlaceSuggestion?) async {
    let name = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    guard canAddEntry else {
      showToast(Toast(text: AppCopy.for(request.locale).placeLimitToast, kind: .limit))
      return
    }
    let entryId = addEntrySync(text: name)
    guard let suggestion, let apple = resolvers.compactMap({ $0 as? ApplePlaceResolver }).first,
          let index = request.entries.firstIndex(where: { $0.id == entryId })
    else { return }

    let generation = resolveGeneration
    guard let stop = await apple.resolve(
      completion: suggestion.token,
      inputIndex: index,
      input: name,
      destination: request.destination,
      locale: request.locale
    ) else { return }
    guard generation == resolveGeneration,
          let live = request.entries.firstIndex(where: { $0.id == entryId })
    else { return }
    var pinned = stop
    // 待っている間に前の行が外れていることがある。番号は `tripRequest` が渡す一点でも
    // 押し直すが、行に載せる写しも今の並びに合わせておく。
    pinned.inputIndex = live
    request.entries[live].pinned = .apple(providerRef: nil, stop: pinned)
  }

  /// 1 行外す。**外した後の並びに、番号で貼るもの全部を合わせ直す** —— 手入力の点の id と、
  /// リンクから受け取った決定の番号がそれで(`restampManualPins(afterRemoving:)`)。
  /// エンジンへ渡す番号そのものは渡す一点(`tripRequest`)で押し直す。
  public func removeEntry(id: UUID) {
    guard let index = request.entries.firstIndex(where: { $0.id == id }) else { return }
    request.entries.remove(at: index)
    request.resolutions[id] = nil
    restampManualPins(afterRemoving: index)
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
      showToast(Toast(
        text: AppCopy.for(request.locale).pasteLimitToast(count: already + parsed.entries.count),
        kind: .limit
      ))
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
  /// **新しい箱の外に出た固定は、ここで外す。** Start の行は「まだ何も尋ねていない」とは
  /// 限らない —— 旅程を組んだ後に「入力にもどる」で帰ってくれば、行は全部固定されている。
  /// そのまま国だけ選ぶと、`requestBuildFromStart` は固定済みの行を尋ね直さない
  /// (`entry.pinned == nil` の行しか尋ねない)ので、日本の場所のままスイスの旅程が組み上がる。
  /// しかも跨ぎの報せは「国を選んだ」ことで消えているから、画面のどこにも書いていない。
  ///
  /// 外すのは箱の**外**に出た `.apple` / `.catalog` の固定だけ。`.auto` と `.worldwide` は箱を
  /// 持たないので 1 件も落ちず、旅行者が地図に自分で置いた点(`.manual`)は箱の外でも動かさない
  /// —— 座標は旅行者のもので、尋ね直す相手が居ない(統合仕様 §4.2)。
  ///
  /// 尋ね直しは**しない**(この setter は画面のピッカーから同期に呼ばれる)。外した行は
  /// 「まだ決まっていない」として残り、次の CTA が新しい国で尋ねる。確認画面から呼ぶときは
  /// `changeDestinationFromResolve` のほうを使う: そちらは外した行をその場で尋ね直す
  /// —— 確認画面には CTA まで待つという道が無く、行が空のまま止まって見えるからである。
  ///
  /// 戻り値は外した行(番号・行の id・書いた文字列)。`changeDestinationFromResolve` が
  /// 尋ね直す相手はこれで、Start の画面は読み捨ててよい。
  @discardableResult
  public func setDestination(_ choice: DestinationChoice) -> [StrayPin] {
    request.destination = choice
    // 国が変われば旅も変わる。測った経路は前の国のもので、外れた固定(`unpinStrays`)の
    // 座標を含んでいることさえある —— 残すと、隣の国の分数が新しい旅程に効く。
    invalidateRoutes(keepCache: false)
    let stray = unpinStrays()
    guard choice == .auto else {
      request.mixedCountryCodes = []
      return stray
    }
    request.mixedCountryCodes = ResolutionPipeline.mixedCountryCodes(request.entries.compactMap { $0.pinned?.stop })
    return stray
  }

  /// 行き先の箱から出てしまった 1 行。
  public struct StrayPin: Equatable, Sendable {
    public var index: Int
    public var id: UUID
    public var input: String
  }

  /// いまの行き先の箱の外にある固定を外す。**先に外す**のは、尋ね直している間、画面が隣の国の
  /// 場所を「確認済み」として見せ続けないため。
  private func unpinStrays() -> [StrayPin] {
    guard let bounds = destinationBounds else { return [] }
    let stray = request.entries.enumerated().compactMap { index, entry -> StrayPin? in
      guard let pinned = entry.pinned else { return nil }
      if case .manual = pinned { return nil }
      let stop = pinned.stop
      guard !Destinations.withinBounds(bounds, latitude: stop.latitude, longitude: stop.longitude) else { return nil }
      return StrayPin(index: index, id: entry.id, input: entry.text)
    }
    for item in stray {
      request.entries[item.index].pinned = nil
      request.resolutions[item.id] = nil
    }
    return stray
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
    // CTA で Start を離れるなら、読みかけの自由文パースもここで捨てる —— 遅れて届いた
    // LLM の答えが、もう見えていない画面の裏でフォームを書き換えないように(spec §4.2
    // 「画面を離れる → 進行中タスクをキャンセルし結果を捨てる」)。
    intentQueryChanged()
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
