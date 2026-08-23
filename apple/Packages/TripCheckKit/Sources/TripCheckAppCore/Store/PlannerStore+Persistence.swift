import Foundation
import Observation
import TripCheckKit

/*
 * 端末の中に旅程を残す —— 書くのは入力と編集だけ、戻すのは組み直しで。
 *
 * 保存は旅行者が頼まない。入力か編集が動いたら 550 ミリ秒(`autosaveDebounce`)待って
 * 1 枚書く。待つのは、組み立ての最中に `edit` が何度も動くから —— 1 回の組み立てで
 * 10 枚書いても、残るのは最後の 1 枚と、無駄になった 9 回のディスク書き込みだけである。
 *
 * 見張るのは `request` と `edit` の 2 つで、`view` は見張らない(開閉や選択で記録が
 * 書き換わらない)。**書き換えるのは常に同じ 1 枚**(`currentTripId`)で、旅を新しく
 * 始めたとき(`reset()`)だけ次の記録に移る。
 *
 * 開き直す側は「写しを戻す」のではなく**組み直す**:場所は保存した pin から
 * `ResolvedStop` を作り直し、カタログの決定はカタログを引き直して、最後にビルダーを
 * 回す。拠点は `edit.resolvedBase` を渡さない(保存していない)ままビルダーへ入り、
 * `hotelQuery` からビルダー自身が組み直す。だから端末の中に古い経路も古い営業時間も
 * 残らない。
 */
extension PlannerStore {

  // MARK: - 荷物

  /// いまの入力と編集を、端末に置いてよい形へ畳む。`UserTripPayload.validate` を通るので、
  /// 禁じられた鍵が 1 つでも混ざっていればここで投げる —— 保存の直前ではなく、**作った
  /// 時点で**落ちる。
  public func persistedPayload() throws -> UserTripPayload {
    let input = PersistedTripInput(request)
    let edits = PersistedEdits(edit, stopIds: PersistedTripInput.canonicalStopIds(request.entries))
    return try UserTripPayload.validate(input: Self.jsonObject(input), edits: Self.jsonObject(edits))
  }

  /// 記録の題。**先頭 3 か所の名前**で、一覧はこれで旅を見分ける。空白だけの行は数えない
  /// —— 数えると `StoredTripRecord.validTitle` が空の題として撥ね、旅程が残らないのに
  /// 「端末に残せません」とだけ出る。
  var persistedTitle: String {
    AppCopy.tripTitle(request.entries.map { JSText.trim($0.text) }.filter { !$0.isEmpty }, locale: request.locale)
  }

  // MARK: - 自動保存

  /// 入力と編集の変化を見張る。`onChange` は変化の**直前**に一度だけ呼ばれるので、
  /// 呼ばれたら次の見張りを張り直す(`withObservationTracking` は 1 回きりの約束)。
  ///
  /// 張り直しを次の実行に回すのは、`onChange` が書き換えの途中で呼ばれるから —— その場で
  /// 読み直すと、まだ古い値が見える。同じ実行の中で何度状態が動いても保存の予約は 1 回に
  /// なり(2 回目以降は見張りが外れている)、予約は必ず最後の状態を書く。
  func watchForAutosave() {
    withObservationTracking {
      _ = request
      _ = edit
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self else { return }
        self.scheduleAutosave()
        self.watchForAutosave()
      }
    }
  }

  /// 保存を予約する。前の予約は破る —— 打つたびに書いていては、指の速さがそのまま
  /// ディスクへの書き込み回数になる。
  func scheduleAutosave() {
    guard store != nil else { return }
    autosaveTask?.cancel()
    autosaveTask = Task { [weak self, clock, autosaveDebounce] in
      try? await clock.sleep(for: autosaveDebounce)
      guard !Task.isCancelled else { return }
      await self?.saveNow()
    }
  }

  /// いまの状態を 1 枚書く。**場所が 1 つも無い旅は書かない** —— 名前の無い記録が一覧に
  /// 並び、10 件の枠を食う。
  func saveNow() async {
    guard let store, !request.entries.isEmpty else { return }
    let title = persistedTitle
    guard !title.isEmpty else { return }

    let payload: UserTripPayload
    do {
      payload = try persistedPayload()
    } catch {
      // 荷物が検査に落ちた。原因(禁止キー・大きすぎる)は違っても、旅行者の側から見えて
      // いる事実は 1 つ ——「この旅程は端末に残っていない」。黙って捨てない。
      storageUnavailable = true
      return
    }

    // id は**待つ前に**決めて持っておく。保存が飛んでいる間に次の保存が始まっても、
    // 同じ 1 枚を書き換えるためである(後から決めると 1 回の旅で 2 枚できる)。
    let id = currentTripId ?? Self.newTripId()
    currentTripId = id
    do {
      let saved = try await store.save(SaveTripRecord(id: id, title: title, payload: payload))
      currentTripId = saved.id
      storageUnavailable = false
    } catch {
      storageUnavailable = true
    }
  }

  // MARK: - 一覧

  /// 端末に残っている旅程を読み直す。`TripStore.list()` は投げない(読めないファイルは
  /// 飛ばす)ので、ここで一覧が空になっても「保存できない」とは限らない —— その問いに
  /// 答えるのは `storageUnavailable` のほう。
  public func loadRecent() async {
    guard let store else {
      recentTrips = []
      return
    }
    recentTrips = await store.list()
  }

  /// 保存した旅程を開く。**写しを戻すのではなく組み直す** —— 端末に残っているのは入力と
  /// 編集だけなので、場所を作り直し、カタログの決定を引き直してから、もう一度組む。拠点は
  /// ここでは引き直さない(`reopenResolutions` を見よ)—— `build()` の中でビルダーが
  /// `hotelQuery` から組み直す。
  public func openTrip(id: String) async {
    guard let store, let record = await store.load(id: id) else { return }
    guard let input = try? Self.decode(PersistedTripInput.self, from: record.payload.input),
          let edits = try? Self.decode(PersistedEdits.self, from: record.payload.edits)
    else { return }

    reset()
    currentTripId = record.id
    request = input.tripRequestState()
    edit = edits.editState()
    // 開き直している間にリンクが開いていたら、ここで止める —— そのまま組むと、いま画面に
    // 入ったばかりの旅程を、保存してあった別の旅の答えで上書きすることになる。
    guard await reopenResolutions(overrides: edits.resolutionOverrides) else { return }
    await build()
  }

  /// 1 枚捨てる。消したのが今書き換えている旅なら、次の変更は新しい記録に書く —— そして
  /// 待たせてある保存があれば破る。破らないと、削除の直後に古い予約が効いて、消したはずの
  /// 記録が(1 拍遅れて)また端末に書かれる。
  public func deleteTrip(id: String) async {
    guard let store else { return }
    do {
      _ = try await store.delete(id: id)
    } catch TripStoreError.ioFailure {
      storageUnavailable = true
    } catch {
      // ファイル名にできない id(`invalidRecord`)。そんな記録は端末に無いので、
      // 消えているという答えは正しい —— 保存できないという報せは出さない。
    }
    if currentTripId == id {
      autosaveTask?.cancel()
      autosaveTask = nil
      currentTripId = nil
    }
    await loadRecent()
  }

  // MARK: - 開き直しの場所

  /// 開いた直後の場所を整える 2 手。**拠点はここでは触らない**:`edit.resolvedBase` は
  /// 保存していない(R11)ので `nil` のまま `build()` に渡り、Kit のビルダーが
  /// `ctx.hotelQuery`(`PlannerStore.swift` の `tripRequest(with:days:)`)を
  /// `Bases.resolveTripBase(query:resolved:locale:)` へ通して拠点を組み直す
  /// (`Bases.swift:109`)。旅行者が `setBase` で選んだ拠点(Kit の推薦の 1 つを選んだ
  /// もの)はそれで戻らずビルダーの推薦へ戻るが、これは意図どおり:拠点は旅行者が
  /// 置いた pin ではなく Kit が計算した推薦データなので、pin と違って書き戻す元が無い。
  ///
  /// ここでかつて `hotelQuery` を `resolvers`(端末の地図が先頭)へ流して拠点を引き直して
  /// いたが、地図には尋ねる相手が無い(ホテルは pin ではなく文字列でしか残らない)ので、
  /// 旅行者が選んだ覚えのない点へ拠点が変わり得た —— `.catalog` の pin で実機に出た不具合
  /// と同じ形。ビルダーの再解決に任せれば、セッション 1 と同じ拠点(同じ `hotelQuery` から
  /// 同じ手順で決まる)に必ず揃う。
  ///
  /// 戻り値は「開き直しがまだこの旅のものか」。カタログを引き直している間にリンクが開けば
  /// (`.onOpenURL` → `importShare` → `reset()`)、行はもう別の旅のもので、保存してあった
  /// 決定を番号で貼る先が無い —— そこで止める。
  private func reopenResolutions(overrides: [ResolutionOverride]) async -> Bool {
    guard await reresolveCatalogPins() else { return false }
    applyReopenedOverrides(overrides)
    return true
  }

  /// カタログの決定はカタログを引き直す —— 名前が同じなら座標も滞在時間も同梱の表から
  /// 取り直せるので、保存した写しより新しい。**id は `pin-<出現>` のまま**にする:
  /// 場所に貼り付いた編集(滞在時間・外した場所)の宛先が変わってはいけない。
  ///
  /// 尋ねる相手は**カタログだけ**で、`resolvers` の列(端末の地図が先頭)へは流さない。
  /// 流すと同じ名前に地図が別の点を答え、旅行者が選んだ覚えのない場所へ旅程が組み変わる
  /// —— 実機で実際に起きた(開き直した 1 日目の並びが変わった)。`.apple` の決定に手を
  /// 出さないのと同じ理由で、決定を出した相手だけがそれを引き直せる。
  private func reresolveCatalogPins() async -> Bool {
    let queries = request.entries.enumerated().compactMap { index, entry -> PlaceQuery? in
      guard case .catalog = entry.pinned else { return nil }
      return PlaceQuery(inputIndex: index, input: entry.text)
    }
    guard !queries.isEmpty else { return true }

    resolveGeneration += 1
    let generation = resolveGeneration
    isResolvingPlaces = true
    let answers = await ResolutionPipeline.resolve(
      queries,
      destination: request.destination,
      locale: request.locale,
      resolvers: [CatalogResolver()]
    )
    // 待っている間に旅そのものが入れ替わっていたら、この答えは捨てる(`resolveGeneration`)
    // —— 開き直している最中にリンクが開くことがある。
    guard generation == resolveGeneration else { return false }
    isResolvingPlaces = false

    for (index, answer) in answers {
      guard case .confirmed(let stop) = answer, request.entries.indices.contains(index) else { continue }
      var fresh = stop
      fresh.id = PersistedTripInput.stopId(index)
      request.entries[index].pinned = .catalog(fresh)
    }
    return true
  }

  /// 手入力の決定は pin より新しい —— 同じ出現に両方あれば手入力が勝つ(Kit の
  /// `applyManualOverrides` がその規則そのもの)。旅行者が置いた座標には尋ね直す相手が
  /// 居ないので、引き直しはしない。
  private func applyReopenedOverrides(_ overrides: [ResolutionOverride]) {
    guard !overrides.isEmpty else { return }
    let pins = request.entries.compactMap { $0.pinned?.stop }
    let stops = PlannerEdits.applyManualOverrides(pins, overrides: overrides).map { stop -> ResolvedStop in
      guard let index = stop.inputIndex else { return stop }
      var canonical = stop
      canonical.id = PersistedTripInput.stopId(index)
      return canonical
    }
    var extras: [ResolvedStop] = []
    for stop in stops {
      guard let index = stop.inputIndex, request.entries.indices.contains(index) else {
        // 行の無い出現(範囲の外を指した決定)。捨てずに編集側へ回す。
        extras.append(stop)
        continue
      }
      request.entries[index].pinned = Self.pinned(stop)
    }
    edit.resolvedStops = extras
  }

  // MARK: - 道具

  /// 起動時の探り。`trips/` を作ってみて、作れなければ「残せない」。**`TripStore` は
  /// `save` まで一度もディスクに触らない**ので、これをやらないと最初の保存(早くても
  /// 数百ミリ秒後、旅行者が何も入れなければ永遠に来ない)まで誰も気付かない。
  static func storageIsUnavailable(at directory: URL?) -> Bool {
    guard let directory else { return false }
    do {
      try FileManager.default.createDirectory(
        at: directory.appendingPathComponent("trips", isDirectory: true),
        withIntermediateDirectories: true
      )
      return false
    } catch {
      return true
    }
  }

  /// 記録の id。ファイル名になるので**小文字に倒す** —— 端末のファイルシステムは大小を
  /// 区別しないので、大小だけ違う 2 つの id は同じ 1 枚を指す。
  static func newTripId() -> String { UUID().uuidString.lowercased() }

  private static func jsonObject(_ value: some Encodable) throws -> JSONObject {
    let data = try JSONEncoder().encode(value)
    guard case .object(let members) = try JSONDecoder().decode(JSONValue.self, from: data) else {
      throw TripStoreError.invalidPayload("Trip payload input and edits must be plain objects.")
    }
    return members
  }

  private static func decode<T: Decodable>(_ type: T.Type, from members: JSONObject) throws -> T {
    let data = try JSONEncoder().encode(JSONValue.object(members))
    return try JSONDecoder().decode(T.self, from: data)
  }
}
