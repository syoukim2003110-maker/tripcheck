import Foundation
import TripCheckKit

/*
 * 端末に置く旅程の形 —— **旅行者が書いたものだけ**を写した DTO と、状態との行き来。
 *
 * `TripRequestState` も Kit の `PlannerEditState` もそのまま書き出さない(R11)。前者は
 * 場所解決の途中経過(`resolutions`)を抱えており、後者は `resolvedStops` / `resolvedBase` を
 * 必ず符号化する —— どちらも中身は Kit の `ResolvedStop` で、`sourceUrl` と `verifiedAt` を
 * 必ず持つ。`UserTripPayload.validate` は入れ子の全ての鍵を `normalizedKey` で
 * `forbiddenKeys` と照合して投げるので、そのまま入れると**保存が毎回失敗する**。
 *
 * 失敗しない書き方があったとしても入れない、というのがこの層の存在理由である:プロバイダの
 * 応答は取り直せるし、組み上がった旅程は組み直せる。端末に残すのは、取り直しようのない
 * 「旅行者が書いたもの」だけでよい(`lib/trip-store.ts:1-7`)。
 *
 * ## 停留所 id
 *
 * `ResolvedStop.id` は解決器が作る値で、この荷物には入らない。開き直したときは
 * `PersistedTripInput.stopId(_:)` —— 出現の位置から決まる `pin-<添字>` —— を必ず作り直す。
 * だから**保存する側**も、場所に貼り付いた編集(滞在時間・最終入場・外した場所・日の指定・
 * 順の固定・区間の手段)の宛先を同じ綴りへ揃えてから書く(`PersistedEdits.init`)。揃えないと、
 * 開き直した瞬間に外した場所が戻り、決めた滞在時間が消える —— 旅程は同じなのに編集だけが
 * 宙に浮くからである。
 */

/// 「この名前はこの場所のことだ」と決まった 1 件のうち、端末に残してよい欄だけ。
///
/// `sourceUrl` / `verifiedAt` / `placeTypes` / `countryCode` は**持たない**。前 2 つは
/// プロバイダが確かめた証拠で、保存した瞬間に古くなる(開き直したときに「確かめた」と
/// 名乗り続ける記録になる)。`placeTypes` は提供元の分類そのもので、`countryCode` は
/// 座標から `DestinationVote` が決め直せる。
public struct PersistedPin: Codable, Equatable, Sendable {

  /// どうやって決まったか。開き直したときの扱いがこれで分かれる(`WishlistEntry` の
  /// `PinnedResolution` と 1 対 1)。
  public enum Kind: String, Codable, Sendable {
    case apple, manual, catalog

    var provider: ResolvedStopProvider {
      switch self {
      case .apple: .apple
      case .manual: .user
      case .catalog: .catalog
      }
    }
  }

  public var kind: Kind
  /// 同じ場所をもう一度引くための識別子(端末の地図の決定だけが持つ)。
  public var providerRef: String?
  public var name: String
  public var area: String
  public var address: String
  public var latitude: Double
  public var longitude: Double
  public var planningDurationMinutes: Int
  /// 旅行者が地図に自分で置いた点。提供元が確かめた座標と見分けるための印(統合仕様 §4.2)。
  public var userProvidedCoordinates: Bool?

  init(_ pinned: PinnedResolution) {
    let stop = pinned.stop
    switch pinned {
    case .apple(let providerRef, _):
      kind = .apple
      self.providerRef = providerRef ?? stop.providerRef
    case .manual:
      kind = .manual
      providerRef = nil
    case .catalog:
      kind = .catalog
      providerRef = nil
    }
    name = stop.name
    area = stop.area
    address = stop.address
    latitude = stop.latitude
    longitude = stop.longitude
    planningDurationMinutes = stop.planningDurationMinutes
    userProvidedCoordinates = stop.userProvidedCoordinates
  }

  /// 保存された欄から停留所を組み直す。**証拠の欄は空のまま**(`sourceUrl` / `verifiedAt`)
  /// —— 端末の中の写しは、提供元が今も同じことを言っている証拠にはならない。確かさは
  /// `.medium` で、`.apple` の決定は座標ごとそのまま使う(尋ね直しても同じ点が返る保証は
  /// 無く、旅行者が見ていた地図の点はこれだから)。
  ///
  /// 手入力の点だけ `isAnchor` が偽なのは、Kit の `PlannerEdits.manualStop`(と Web)がそう
  /// 作るからである。行に当たった写しはビルダーが行の制約で押し直す
  /// (`TripBuilder.swift:147`)ので旅程は変わらず、変わるのは行に当たらなかった写しを読む側
  /// —— そこで開き直した旅だけ錨の数が違う、ということが起きないようにする。
  func stop(inputIndex: Int, input: String) -> ResolvedStop {
    ResolvedStop(
      id: PersistedTripInput.stopId(inputIndex),
      providerRef: providerRef,
      name: name,
      area: area,
      latitude: latitude,
      longitude: longitude,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: planningDurationMinutes,
      isAnchor: kind != .manual,
      isUserEntered: kind == .manual ? true : nil,
      userProvidedCoordinates: userProvidedCoordinates,
      input: input,
      inputIndex: inputIndex,
      address: address,
      countryCode: nil,
      provider: kind.provider
    )
  }
}

/// 行きたい場所 1 行ぶん(`WishlistEntry` の写し)。
public struct PersistedEntry: Codable, Equatable, Sendable {
  /// 行の id。並べ替えや編集の途中で行を見失わないように、開き直しても同じ値を使う。
  public var id: String
  public var text: String
  /// `WishlistPriority` は `Codable` ではない(R5)ので生の値で持つ。読めない値は「通常」。
  public var priority: String
  public var fixedDay: Int?
  public var fixedTime: String?
  public var timeOfDay: WishlistTimeOfDay?
  public var isReservation: Bool
  public var stayMinutes: Int?
  public var pin: PersistedPin?

  init(_ entry: WishlistEntry) {
    id = entry.id.uuidString
    text = entry.text
    priority = entry.priority.rawValue
    fixedDay = entry.fixedDay
    fixedTime = entry.fixedTime
    timeOfDay = entry.timeOfDay
    isReservation = entry.isReservation
    stayMinutes = entry.stayMinutes
    pin = entry.pinned.map(PersistedPin.init)
  }

  /// 行に戻す。`fixedDay` は `1...14` に畳む —— 貼り付けの取り込みと行編集シートが同じ
  /// ことをしている(`PlannerStore.clampedFixedDay`)ので、書き換えられた保存ファイルから
  /// 「99 日目」が入って `Picker` にタグの無い日ができる道をここでも閉じる。
  func entry(index: Int) -> WishlistEntry {
    WishlistEntry(
      id: UUID(uuidString: id) ?? UUID(),
      text: text,
      priority: WishlistPriority(rawValue: priority) ?? .normal,
      fixedDay: fixedDay.map(PlannerStore.clampedFixedDay),
      fixedTime: fixedTime,
      timeOfDay: timeOfDay,
      isReservation: isReservation,
      stayMinutes: stayMinutes,
      pinned: pin.map { pin in
        let stop = pin.stop(inputIndex: index, input: text)
        return switch pin.kind {
        case .apple: PinnedResolution.apple(providerRef: pin.providerRef, stop: stop)
        case .manual: PinnedResolution.manual(stop)
        case .catalog: PinnedResolution.catalog(stop)
        }
      }
    )
  }
}

/// 「何を組むか」(`TripRequestState`)のうち保存するもの。
///
/// `resolutions`(場所解決の途中経過)と `mixedCountryCodes`(そこから数えた報せ)は入らない
/// —— どちらも尋ね直せば作り直せる派生値で、`resolutions` は Kit の `ResolvedStop` を
/// 抱えている。
public struct PersistedTripInput: Codable, Equatable, Sendable {
  public var entries: [PersistedEntry]
  public var unparsedLines: [String]
  public var inputMode: InputMode
  public var tripDays: Int?
  public var tripStartDate: String?
  /// `DestinationChoice` は `Codable` ではないので `"auto"` / 国の id を生で持つ。
  public var destination: String
  public var dayStartDefault: String
  public var dayEndTarget: String?
  public var maxWalkingMinutesPerLeg: Int?
  public var maxTransfersPerLeg: Int?
  public var arrivalAirport: String
  public var arrivalTime: String
  public var departureAirport: String
  public var departureTime: String
  public var flightKind: FlightKind
  public var mealPlan: MealPlan
  public var locale: PlannerLocale
  /// `BuildMode` は AppCore の型で `Codable` ではない。`"custom"` 以外は「おまかせ」。
  public var buildMode: String

  init(_ request: TripRequestState) {
    entries = request.entries.map(PersistedEntry.init)
    unparsedLines = request.unparsedLines
    inputMode = request.inputMode
    tripDays = request.tripDays
    tripStartDate = request.tripStartDate
    destination = request.destination.rawValue
    dayStartDefault = request.dayStartDefault
    dayEndTarget = request.dayEndTarget
    maxWalkingMinutesPerLeg = request.maxWalkingMinutesPerLeg
    maxTransfersPerLeg = request.maxTransfersPerLeg
    arrivalAirport = request.arrivalAirport
    arrivalTime = request.arrivalTime
    departureAirport = request.departureAirport
    departureTime = request.departureTime
    flightKind = request.flightKind
    mealPlan = request.mealPlan
    locale = request.locale
    buildMode = request.buildMode == .custom ? "custom" : "automatic"
  }

  /// 入力に戻す。場所解決の途中経過は空 —— 開き直した直後は誰にも尋ねていない。
  func tripRequestState() -> TripRequestState {
    TripRequestState(
      entries: entries.enumerated().map { index, entry in entry.entry(index: index) },
      unparsedLines: unparsedLines,
      inputMode: inputMode,
      tripDays: tripDays,
      tripStartDate: tripStartDate,
      destination: DestinationChoice(rawValue: destination) ?? .auto,
      dayStartDefault: dayStartDefault,
      dayEndTarget: dayEndTarget,
      maxWalkingMinutesPerLeg: maxWalkingMinutesPerLeg,
      maxTransfersPerLeg: maxTransfersPerLeg,
      arrivalAirport: arrivalAirport,
      arrivalTime: arrivalTime,
      departureAirport: departureAirport,
      departureTime: departureTime,
      flightKind: flightKind,
      mealPlan: mealPlan,
      locale: locale,
      buildMode: buildMode == "custom" ? .custom : .automatic
    )
  }

  /// 開き直したときに必ず作られる停留所 id。**出現の位置だけで決まる**ので、保存する側と
  /// 開く側が同じ綴りに辿り着ける。
  public static func stopId(_ inputIndex: Int) -> String { "pin-\(inputIndex)" }

  /// いま生きている停留所 id から、保存後の綴りへの引き当て表。同じ場所を 2 行に書いた
  /// 旅では先の行が勝つ(後の行の編集はその 1 件に寄る)。
  static func canonicalStopIds(_ entries: [WishlistEntry]) -> [String: String] {
    var map: [String: String] = [:]
    for (index, entry) in entries.enumerated() {
      guard let live = entry.pinned?.stop.id else { continue }
      let canonical = stopId(index)
      if live != canonical, map[live] == nil { map[live] = canonical }
    }
    return map
  }
}

/// 組み上がった旅程への編集(`PlannerEditState`)のうち保存するもの —— 18 欄から
/// `resolvedStops` と `resolvedBase` を抜いた 16 欄。
///
/// その 2 欄は Kit の `ResolvedStop` そのものなので、荷物に入れれば `UserTripPayload.validate`
/// が `sourceurl` / `verifiedat` を見つけて投げる。抜いても失われるものは無い:場所は
/// `input` 側の pin から組み直し、拠点は `hotelQuery` から引き直す。
public struct PersistedEdits: Codable, Equatable, Sendable {
  public var tripDays: Int
  public var pace: Pace
  public var hotelQuery: String
  public var travelPreference: TravelPreference
  public var transferBufferMinutes: Int
  public var userStayMinutes: [String: Int]
  public var lastEntryTimes: [String: String]
  public var dayStartTimes: IntKeyedDictionary<String>
  public var dayEndTimes: IntKeyedDictionary<String>
  public var legModeOverrides: [String: TransportMode]
  public var dayOverrides: [String: Int]
  public var lockedOrderByDay: IntKeyedDictionary<[String]>
  public var removedStops: [PlannerRemovedStop]
  public var itinerary: String
  public var mealSelections: [String: String]
  public var resolutionOverrides: [ResolutionOverride]

  /// - Parameter stopIds: 生きている停留所 id から `pin-<出現>` への引き当て表
  ///   (`PersistedTripInput.canonicalStopIds`)。表に無い id はそのまま残す —— 拠点
  ///   (`base-…`)のように出現に紐づかない id がそれで、開き直したときに当たらなければ
  ///   ビルダーが黙って落とす(知らない id は元から落ちる)。
  init(_ edit: PlannerEditState, stopIds: [String: String]) {
    func remap(_ id: String) -> String { stopIds[id] ?? id }
    tripDays = edit.tripDays
    pace = edit.pace
    hotelQuery = edit.hotelQuery
    travelPreference = edit.travelPreference
    transferBufferMinutes = edit.transferBufferMinutes
    userStayMinutes = Dictionary(edit.userStayMinutes.map { (remap($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    lastEntryTimes = Dictionary(edit.lastEntryTimes.map { (remap($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    dayStartTimes = edit.dayStartTimes
    dayEndTimes = edit.dayEndTimes
    // 区間の鍵は `<出発 id>::<到着 id>`(Kit の `routeLegKey`)。両端を別々に引き当てる。
    legModeOverrides = Dictionary(
      edit.legModeOverrides.map { (PersistedEdits.remapLegKey($0.key, remap), $0.value) },
      uniquingKeysWith: { first, _ in first }
    )
    dayOverrides = Dictionary(edit.dayOverrides.map { (remap($0.key), $0.value) }, uniquingKeysWith: { first, _ in first })
    lockedOrderByDay = IntKeyedDictionary(edit.lockedOrderByDay.values.mapValues { $0.map(remap) })
    removedStops = edit.removedStops.map { PlannerRemovedStop(id: remap($0.id), name: $0.name) }
    itinerary = edit.itinerary
    // `mealSelections` の鍵は日と食事の種類で、停留所 id を含まない(引き当てない)。
    mealSelections = edit.mealSelections
    resolutionOverrides = edit.resolutionOverrides
  }

  /// 編集に戻す。**`resolvedStops` / `resolvedBase` は空** —— 場所は pin から、拠点は
  /// `hotelQuery` から、開く側が組み直す(`PlannerStore.openTrip`)。
  func editState() -> PlannerEditState {
    PlannerEditState(
      tripDays: tripDays,
      pace: pace,
      hotelQuery: hotelQuery,
      resolvedBase: nil,
      travelPreference: travelPreference,
      transferBufferMinutes: transferBufferMinutes,
      userStayMinutes: userStayMinutes,
      lastEntryTimes: lastEntryTimes,
      dayStartTimes: dayStartTimes,
      dayEndTimes: dayEndTimes,
      legModeOverrides: legModeOverrides,
      dayOverrides: dayOverrides,
      lockedOrderByDay: lockedOrderByDay,
      removedStops: removedStops,
      itinerary: itinerary,
      mealSelections: mealSelections,
      resolvedStops: [],
      resolutionOverrides: resolutionOverrides
    )
  }

  private static func remapLegKey(_ key: String, _ remap: (String) -> String) -> String {
    guard let separator = key.range(of: "::") else { return remap(key) }
    return routeLegKey(remap(String(key[key.startIndex..<separator.lowerBound])), remap(String(key[separator.upperBound...])))
  }
}
