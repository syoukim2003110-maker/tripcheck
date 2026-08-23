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
  /// 停留所そのものは**組み立てない**。Kit の `PlannerEdits.manualStop`(TS
  /// `manualStopFromResolutionOverride` の移植)に作らせる —— あの関数だけが
  /// `manual-<番号>-<緯度5桁>-<経度5桁>` という id の綴りを持っており、**共有はその綴りしか
  /// 読み戻せない**。`ShareScope.stopId` は手入力の id をこの形から組み直して付け替え、
  /// 形の違う `manual-` の id には `nil` を返す(残った決定に対応しない id だから)。ここで
  /// 独自の id を作っていた頃は、その点に貼った滞在時間・最終入場・外した記録・日の指定・
  /// 区間の手段が、リンクを作る瞬間にまとめて落ちていた —— 点だけが渡り、点に付けた
  /// 決めごとは渡らない。
  ///
  /// `isAnchor` も `confidence` も Kit の値のまま(`false` / `.low`)にする。Web の手入力の点と
  /// 同じ物にするためで、`isAnchor` は行から読んだ制約でビルダーが押し直す
  /// (`TripBuilder.swift:147`)ので旅程は変わらない —— 変わるのは行に当たらなかった写しを
  /// 読む側(`deferredAnchorStops` と Kit の錨まわりの文)だけである。
  ///
  /// 国コードは付けない。旅行者が置いた点に国の証拠は無く、国は座標から `DestinationVote`
  /// (ビルダー)が決める —— カタログ由来の停留所と同じ扱い。
  public func setManualPin(entryId: UUID, name: String, address: String, latitude: Double, longitude: Double) {
    guard let index = request.entries.firstIndex(where: { $0.id == entryId }) else { return }
    let entry = request.entries[index]
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let label = trimmedName.isEmpty ? entry.text : trimmedName
    let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard var stop = PlannerEdits.manualStop(
      from: .manual(
        inputIndex: index,
        name: label,
        address: trimmedAddress,
        latitude: latitude,
        longitude: longitude
      ),
      // 引き当ての材料は旅行者が書いた行のまま(`manualStop` の既定は場所の名前)。同じ名前を
      // 2 行に書いた旅で、どちらの行の点かは行の文字列でしか言えない。
      input: entry.text
    ) else { return }
    // 行編集シートで滞在時間を決めてあれば、それが見積もりに勝つ。
    if let stayMinutes = entry.stayMinutes { stop.planningDurationMinutes = stayMinutes }
    apply(.confirmed(stop), to: entryId)
  }

  /// 手入力の点の id を、**いまの並び**から作り直す(行を外した直後に呼ぶ)。
  ///
  /// `manual-<番号>-…` の番号は行の並びそのものなので、前の行が 1 つ消えれば綴りが変わる。
  /// 共有はこの綴りで編集の宛先を組み直す(`ShareScope.manualStopId` は
  /// `manualPinOverrides()` が数えた**いまの**番号で id を作る)ため、押し直さないと
  /// 「点は渡るのに、その点に付けた決めごとだけが落ちる」に戻る。
  ///
  /// 押し直した分は、場所に貼り付いた編集の鍵も一緒に動かす —— 動かさなければ、鍵が
  /// どこも指さなくなり、滞在時間も外した記録もその場で消える。
  ///
  /// リンクから受け取った決定(`edit.resolutionOverrides`)も同じ番号で貼るので、外れた行より
  /// 後ろの番号を 1 つずつ詰める。詰めないと、保存した旅程を開き直したときに旅行者の座標が
  /// 隣の行へ乗る(`applyReopenedOverrides` は番号で貼る)。
  func restampManualPins(afterRemoving removedIndex: Int) {
    edit.resolutionOverrides = edit.resolutionOverrides.compactMap { override in
      Self.shifted(override, afterRemoving: removedIndex)
    }

    var renamed: [String: String] = [:]
    for index in request.entries.indices {
      guard case .manual(let stop)? = request.entries[index].pinned, stop.inputIndex != index else { continue }
      guard var fresh = PlannerEdits.manualStop(
        from: .manual(
          inputIndex: index,
          name: stop.name,
          address: stop.address,
          latitude: stop.latitude,
          longitude: stop.longitude
        ),
        input: stop.input
      ) else { continue }
      fresh.planningDurationMinutes = stop.planningDurationMinutes
      if fresh.id != stop.id { renamed[stop.id] = fresh.id }
      request.entries[index].pinned = .manual(fresh)
      // 確認画面が読む辞書も一緒に動かす(片方だけ動かすと、画面の行とエンジンへ渡る点がずれる)。
      if case .confirmed? = request.resolutions[request.entries[index].id] {
        request.resolutions[request.entries[index].id] = .confirmed(fresh)
      }
    }
    guard !renamed.isEmpty else { return }
    remapEditStopIds(renamed)
  }

  /// 1 行外れたときの、リンク由来の決定の番号。外れた行そのものの決定は落とす。
  private static func shifted(_ override: ResolutionOverride, afterRemoving removedIndex: Int) -> ResolutionOverride? {
    let index = override.inputIndex
    guard index != removedIndex else { return nil }
    guard index > removedIndex else { return override }
    switch override {
    case .provider(_, let providerRef):
      return .provider(inputIndex: index - 1, providerRef: providerRef)
    case .manual(_, let name, let address, let latitude, let longitude):
      return .manual(inputIndex: index - 1, name: name, address: address, latitude: latitude, longitude: longitude)
    }
  }

  /// 場所に貼り付いた編集の宛先を付け替える。`PersistedEdits` が端末内保存でしている
  /// ことと同じ 6 か所(滞在時間・最終入場・日の指定・区間の手段・順の固定・外した場所)。
  private func remapEditStopIds(_ renamed: [String: String]) {
    func id(_ key: String) -> String { renamed[key] ?? key }
    func remapLeg(_ key: String) -> String {
      guard let separator = key.range(of: "::") else { return id(key) }
      return routeLegKey(id(String(key[key.startIndex..<separator.lowerBound])), id(String(key[separator.upperBound...])))
    }
    edit.userStayMinutes = Dictionary(edit.userStayMinutes.map { (id($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    edit.lastEntryTimes = Dictionary(edit.lastEntryTimes.map { (id($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    edit.dayOverrides = Dictionary(edit.dayOverrides.map { (id($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    edit.legModeOverrides = Dictionary(edit.legModeOverrides.map { (remapLeg($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    edit.lockedOrderByDay = IntKeyedDictionary(edit.lockedOrderByDay.values.mapValues { $0.map(id) })
    edit.removedStops = edit.removedStops.map { PlannerRemovedStop(id: id($0.id), name: $0.name) }
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
  /// 箱の外に出た固定を外すところまでは `setDestination` が両方の画面に対してする(Start でも
  /// 「入力にもどる」の後は行が固定されているので、外さなければ隣の国の場所がそのまま組まれる)。
  /// 確認画面だけが違うのは**その場で尋ね直す**ところで、画面が約束しているのは
  /// 「国を選ぶと、いまの入力をその国の範囲で探し直します。」(`AppCopy.resolveCountryHint`)
  /// だからである —— Web も同じ一手で `reviewWishlistPlaces({ destinationOverride })` を掛ける
  /// (`app/components/planner/TripPlannerShell.tsx:2058-2064`)。Start は CTA という
  /// 尋ね直しの機会が後ろに控えているので、外すところまででよい。
  public func changeDestinationFromResolve(_ choice: DestinationChoice) async {
    let stale = setDestination(choice)
    guard !stale.isEmpty else { return }

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
