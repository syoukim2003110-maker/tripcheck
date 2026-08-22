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
  }

  public func setPriority(id: UUID, _ priority: WishlistPriority) {
    guard let index = request.entries.firstIndex(where: { $0.id == id }) else { return }
    request.entries[index].priority = priority
  }

  // MARK: - 行き先の国

  /// 行き先を決める。国を選ぶのは「場所が 2 か国に散っている」という問いに旅行者が答えた
  /// ということなので、跨ぎの報せはその場で消す。`auto` に戻したときだけ、いま決まっている
  /// 場所からもう一度数え直す。
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
  public func requestBuildFromStart() async {
    guard !request.entries.isEmpty, !isResolvingPlaces, view.screen != .building else { return }

    let queries = request.entries.enumerated().compactMap { index, entry in
      entry.pinned == nil ? PlaceQuery(inputIndex: index, input: entry.text) : nil
    }
    var answers: [Int: PlaceResolution] = [:]
    if !queries.isEmpty {
      isResolvingPlaces = true
      answers = await ResolutionPipeline.resolve(
        queries,
        destination: request.destination,
        locale: request.locale,
        resolvers: resolvers
      )
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
      return
    }
    await build()
  }

  /// 決まった 1 件を、**どうやって決まったか**を残す形に畳む(保存した旅程を開き直すときに
  /// 扱いが分かれる —— Task 11)。Plan 2 に居る解決器はカタログと Apple と手入力だけ。
  private static func pinned(_ stop: ResolvedStop) -> PinnedResolution {
    switch stop.provider {
    case .apple: .apple(providerRef: stop.providerRef, stop: stop)
    case .user: .manual(stop)
    case .catalog, .google, nil: .catalog(stop)
    }
  }
}
