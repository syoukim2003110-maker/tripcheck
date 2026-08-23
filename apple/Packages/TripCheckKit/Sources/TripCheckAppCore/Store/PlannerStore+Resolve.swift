import Foundation
import TripCheckKit

/*
 * 確認画面から呼ばれる操作 —— 候補を選ぶ・候補を断る・地図に自分で置く・もう一度探す・進む。
 *
 * 画面が読むのは `resolveRows` ただ 1 つ。行の状態(確認済み・候補待ち・見つからない)も、
 * 候補も、抑止の印も、全部そこに入っている —— 画面が `request.resolutions` を自分で読んで
 * 数え直すと、抑止の順位が画面ごとに違う答えを出す。
 */

/// 確認画面の 1 行。`id` は行(`WishlistEntry`)の id で、名前ではない —— 同じ名前を 2 回
/// 書いた旅行者が、片方だけを直せる。
public struct ResolveRowModel: Identifiable, Sendable, Equatable {

  /// 画面が出し分ける 3 つ。`PlaceResolution` の 3 つと 1 対 1 で、Web の 4 状態のうち
  /// `parsed`(まだ尋ねていない)は確認画面には来ない —— CTA が尋ね終えてから開く画面だから。
  public enum State: Sendable, Equatable {
    case confirmed, review, unresolved
  }

  public var id: UUID
  /// 旅行者が書いた文字列。「どちらの『X』ですか？」の X はこれ。
  public var input: String
  /// 行に出す名前。決まっていればその場所の名前、決まっていなければ書いた文字列のまま。
  public var name: String
  /// 決まった行の下に出る住所(無ければ地区名)。決まっていない行は空。
  public var address: String
  public var state: State
  /// 3 件まで(`ResolutionPipeline.reviewShortlistLimit`)。切るのは解決器の側なので、
  /// ここに 4 件目は来ない。
  public var candidates: [PlaceCandidate]
  /// 確認が要る行に付く 0 始まりの順位。確認済みの行は `nil`。
  public var rank: Int?
  /// 3 件目までしか触らせない(`rank >= 3`)。画面はこの行に抑止の 1 文を出す。
  public var suppressed: Bool
  /// 未解決のまま進めてよいかを尋ねる対象(必須指定・予約済み)。
  public var isProtected: Bool
}

extension PlannerStore {

  // MARK: - 画面が読むもの

  /// 確認画面の全行。順位は `ResolutionPipeline.attentionRanks`(入力順に、確認が要る行だけ
  /// 数える)から出し、3 番目以降を抑止する —— 1 件解決するたびに次の 1 件が窓に入る
  /// (Web `ResolveScreen.tsx:218-219`)。
  public var resolveRows: [ResolveRowModel] {
    let byIndex = resolutionsByInputIndex
    let ranks = ResolutionPipeline.attentionRanks(byIndex)
    return request.entries.enumerated().map { index, entry in
      let rank = ranks[index]
      switch byIndex[index] {
      case .confirmed(let stop):
        return ResolveRowModel(
          id: entry.id, input: entry.text, name: stop.name,
          address: TripPresentation.resolvedStopAddress(stop),
          state: .confirmed, candidates: [], rank: nil, suppressed: false,
          isProtected: Self.isProtected(entry)
        )
      case .review(let candidates):
        return ResolveRowModel(
          id: entry.id, input: entry.text, name: entry.text, address: "",
          state: .review, candidates: candidates, rank: rank,
          suppressed: Self.isSuppressed(rank), isProtected: Self.isProtected(entry)
        )
      case .unresolved, nil:
        return ResolveRowModel(
          id: entry.id, input: entry.text, name: entry.text, address: "",
          state: .unresolved, candidates: [], rank: rank,
          suppressed: Self.isSuppressed(rank), isProtected: Self.isProtected(entry)
        )
      }
    }
  }

  /// 進むボタンに出す数。「N か所で続ける」の N は、**決まった場所の数**であって行の数では
  /// ない —— 決まっていない行はこの旅程に入らない。
  public var confirmedCount: Int {
    resolveRows.filter { $0.state == .confirmed }.count
  }

  /// 進めるかどうか。決まった場所が 1 つも無い、候補待ちが残っている、国が混ざったまま、
  /// いま調べている —— どれか 1 つでも当たれば押させない。
  ///
  /// **未解決は止めない。** 見つからなかった場所は旅程に入らないだけで、残りの旅程は組める
  /// (画面はその件数を出し、必須・予約なら `continueFromResolve` が先に尋ねる)。ここで
  /// 止めると、綴りを直せない場所 1 つで旅そのものが作れなくなる。
  public var canContinue: Bool {
    guard !isResolvingPlaces, request.mixedCountryCodes.isEmpty else { return false }
    let rows = resolveRows
    return rows.contains { $0.state == .confirmed } && !rows.contains { $0.state == .review }
  }

  // MARK: - 1 行を決める

  /// 候補の 1 つを「これだ」と決める。行に固定するので、次の組み立てでもう一度尋ね直さない。
  public func chooseCandidate(entryId: UUID, candidate: PlaceCandidate) {
    apply(.confirmed(candidate.stop), to: entryId)
  }

  /// 「候補にない(住所で指定)」。候補一覧を捨てて未解決に戻す —— 黙って先頭を採らない。
  /// 画面はこの後、手動ピンのシートを開く。
  public func rejectCandidates(entryId: UUID) {
    apply(.unresolved(reason: ResolutionPipeline.notFoundReason), to: entryId)
  }

  /// 旅行者が地図で置いた 1 点。**`userProvidedCoordinates` が真**で、提供元が確かめた場所と
  /// 見分けが付く(統合仕様 §4.2)—— 証拠の欄は空のまま、`provider: .user` で運ぶ。
  ///
  /// 国コードは付けない。旅行者が置いた点に国の証拠は無く、国は座標から `DestinationVote`
  /// (ビルダー)が決める —— カタログ由来の停留所と同じ扱い。
  public func setManualPin(entryId: UUID, name: String, address: String, latitude: Double, longitude: Double) {
    guard let index = request.entries.firstIndex(where: { $0.id == entryId }) else { return }
    let entry = request.entries[index]
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let label = trimmedName.isEmpty ? entry.text : trimmedName
    let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
    let stop = ResolvedStop(
      id: "manual-\(entryId.uuidString.lowercased())",
      providerRef: nil,
      name: label,
      area: AppleAddress.area(from: trimmedAddress, fallback: label, countryCode: nil),
      latitude: latitude,
      longitude: longitude,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: entry.stayMinutes ?? StayEstimates.estimateStayMinutes(name: label),
      isAnchor: true,
      isUserEntered: true,
      userProvidedCoordinates: true,
      input: entry.text,
      inputIndex: index,
      address: trimmedAddress,
      countryCode: nil,
      provider: .user
    )
    apply(.confirmed(stop), to: entryId)
  }

  /// 「もう一度探す」。その 1 行だけを尋ね直す —— 隣の行で旅行者が既に選んだ答えを消さない。
  public func retryResolve(entryId: UUID) async {
    guard !isResolvingPlaces, view.screen != .building else { return }
    guard let index = request.entries.firstIndex(where: { $0.id == entryId }) else { return }
    let entry = request.entries[index]

    resolveGeneration += 1
    let generation = resolveGeneration
    isResolvingPlaces = true
    let answers = await ResolutionPipeline.resolve(
      [PlaceQuery(inputIndex: index, input: entry.text)],
      destination: request.destination,
      locale: request.locale,
      resolvers: resolvers
    )
    // 待っている間に旅そのものが入れ替わっていたら、この答えは捨てる(`resolveGeneration`)。
    guard generation == resolveGeneration else { return }
    isResolvingPlaces = false

    // 待っている間に行が外れている・並びが動いていることがあるので、id で引き直す。
    guard let answer = answers[index] else { return }
    apply(answer, to: entryId)
  }

  // MARK: - 国を選び直す

  /// 確認画面で国を選んだとき。**選ぶだけでは片付かない。**
  ///
  /// `setDestination` は「国が混ざっている」という報せを消すだけで、混ざる原因になった場所は
  /// 行に固定されたまま残る —— 次の組み立ては固定済みの行を尋ね直さない
  /// (`requestBuildFromStart` の `entry.pinned == nil`)し、「もう一度探す」は未解決の行に
  /// しか出ないので、選ばなかったほうの国の場所が黙って旅程に入る。画面が約束しているのは
  /// 「国を選ぶと、いまの入力をその国の範囲で探し直します。」(`AppCopy.resolveCountryHint`)
  /// なので、ここで本当に探し直す —— Web も同じ一手で
  /// `reviewWishlistPlaces({ destinationOverride })` を掛ける
  /// (`app/components/planner/TripPlannerShell.tsx:2058-2064`)。
  ///
  /// 外すのは**新しい箱の外に出た**固定だけ。`.auto` と `.worldwide` は箱を持たないので
  /// 1 件も落ちない。旅行者が地図に自分で置いた点(`.manual`)は箱の外でも動かさない ——
  /// 座標は旅行者のもので、尋ね直す相手が居ない(統合仕様 §4.2)。
  public func changeDestinationFromResolve(_ choice: DestinationChoice) async {
    setDestination(choice)
    guard let bounds = destinationBounds else { return }

    let stale = request.entries.enumerated().compactMap { index, entry -> (index: Int, id: UUID, input: String)? in
      guard let pinned = entry.pinned else { return nil }
      if case .manual = pinned { return nil }
      let stop = pinned.stop
      guard !Destinations.withinBounds(bounds, latitude: stop.latitude, longitude: stop.longitude) else { return nil }
      return (index, entry.id, entry.text)
    }
    guard !stale.isEmpty else { return }

    // 先に固定を外す。尋ね直している間、画面が隣の国の場所を「確認済み」として見せ続けない。
    for item in stale {
      request.entries[item.index].pinned = nil
      request.resolutions[item.id] = nil
    }

    // 問い合わせは 1 本ずつ。ほかの解決が走っている間は**外すところまでで止める** ——
    // その行は「見つかっていない」として残り、「もう一度探す」で拾い直せる。黙って別の国の
    // 場所を旅程へ入れるよりよい。
    guard !isResolvingPlaces, view.screen != .building else { return }

    resolveGeneration += 1
    let generation = resolveGeneration
    isResolvingPlaces = true
    let answers = await ResolutionPipeline.resolve(
      stale.map { PlaceQuery(inputIndex: $0.index, input: $0.input) },
      destination: request.destination,
      locale: request.locale,
      resolvers: resolvers
    )
    // 待っている間に旅そのものが入れ替わっていたら、この答えは捨てる(`resolveGeneration`)。
    guard generation == resolveGeneration else { return }
    isResolvingPlaces = false

    // 待っている間に行が外れている・並びが動いていることがあるので、id で書き戻す
    // (`apply` が固定と辞書と国跨ぎの 3 つを一緒に動かす)。
    for item in stale {
      guard let answer = answers[item.index] else { continue }
      apply(answer, to: item.id)
    }
  }

  // MARK: - 進む

  /// 確認画面の主ボタン。**必須指定と予約済みが未解決のまま残っていたら先に尋ねる** ——
  /// 旅行者が守れと言った場所を黙って落とさない。`force` は確認ダイアログの「続ける」。
  public func continueFromResolve(force: Bool = false) async {
    guard canContinue else { return }
    if !force {
      let blocked = resolveRows.filter { $0.state == .unresolved && $0.isProtected }.map(\.input)
      if !blocked.isEmpty {
        view.pendingHardEdit = .mustUnresolved(names: blocked)
        return
      }
    }
    view.pendingHardEdit = nil
    await build()
  }

  // MARK: - 内部

  /// 行の答えを添字で引ける形に畳む。`ResolutionPipeline.attentionRanks` が入力順で数えるので、
  /// 鍵は行の id ではなく**並びの添字**でなければならない。
  private var resolutionsByInputIndex: [Int: PlaceResolution] {
    var byIndex: [Int: PlaceResolution] = [:]
    for (index, entry) in request.entries.enumerated() {
      if let answer = request.resolutions[entry.id] {
        byIndex[index] = answer
      } else if let pinned = entry.pinned {
        // まだ CTA を通っていない行(旅行者が検索窓で選んだ 1 件)。確認画面が全行を同じ
        // 辞書から読めるように、決まっている事実をそのまま入れる。
        byIndex[index] = .confirmed(pinned.stop)
      }
    }
    return byIndex
  }

  /// 1 行ぶんの答えを状態へ書き戻す。**固定と辞書と国跨ぎの 3 つを必ず一緒に動かす** ——
  /// どれか 1 つだけを書くと、画面の行と、エンジンへ渡る座標と、国の報せがずれる。
  private func apply(_ answer: PlaceResolution, to entryId: UUID) {
    guard let index = request.entries.firstIndex(where: { $0.id == entryId }) else { return }
    switch answer {
    case .confirmed(let stop):
      request.entries[index].pinned = Self.pinned(stop)
    case .review, .unresolved:
      request.entries[index].pinned = nil
    }
    request.resolutions[entryId] = answer
    request.mixedCountryCodes = request.destination == .auto
      ? ResolutionPipeline.mixedCountryCodes(request.entries.compactMap { $0.pinned?.stop })
      : []
  }

  /// 一度に触らせる数。Web `ResolveScreen.tsx:218-219` の `attentionRank >= 3`。
  private static func isSuppressed(_ rank: Int?) -> Bool {
    guard let rank else { return false }
    return rank >= ResolutionPipeline.reviewShortlistLimit
  }

  /// 旅行者が「守れ」と言った行。予約済みは Web でも Must として扱う(`ResolveScreen.tsx:334`)。
  private static func isProtected(_ entry: WishlistEntry) -> Bool {
    entry.priority == .must || entry.isReservation
  }
}
