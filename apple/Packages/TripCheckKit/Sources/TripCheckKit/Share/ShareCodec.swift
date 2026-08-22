import Foundation

/*
 * 状態を持たない旅程の共有。**リンクがデータそのもの**で、入力欄の中身は URL のハッシュに
 * 畳まれ、サーバには何も残らない —— だから「何も保存しない」という約束を保ったまま、
 * 連れの端末で同じ旅程が開く。
 *
 * 移植元は `lib/share-link.ts` 全 306 行:`ShareableTripInput` `:21-55`、正規表現と上限
 * `:56-69`、`cleanCalendarDate` `:71-80`、`toBase64Url`/`fromBase64Url` `:82-94`、
 * `encodeTripShare` `:96-108`、`cleanClock` `:110-112`、`cleanAirport` `:114-118`、
 * `cleanNumberRecord` `:120-128`、`cleanDayTimes` `:130-139`、`cleanStopTimes` `:141-150`、
 * `cleanLegModes` `:152-157`、`cleanLockedOrder` `:159-170`、`cleanRemovedStops` `:172-180`、
 * `cleanTravellerText` `:182-190`、`cleanResolutionOverrides` `:192-246`、
 * `decodeTripShare` `:248-306`。
 *
 * `ShareableResolutionOverride`(TS `:17-19`)は `Edits/PlannerEditState.swift` の
 * `ResolutionOverride` がすでに持っているので、そちらを使う。
 *
 * ## なぜバイトまで同じでなければならないか
 *
 * 共有コードは Web と iOS の**間**を渡る 1 本の文字列で、どちらが書いてどちらが読むかは
 * 決まっていない。読めるだけなら「意味が同じ JSON」で足りるが、それでは端末をまたいだ
 * 「同じリンクかどうか」が判定できない —— 受け取った旅程をそのまま共有し直した人が、
 * 送り主と違うリンクを配ることになる。だから直列化は `JSON.stringify` の写しで、
 * 鍵の並びも数の表記も逃がし方も揃える(`Share/ShareJSON.swift`)。
 */

// MARK: - 鍵の並び

/// この入力が**どの並びで**書かれるか。
///
/// JS のオブジェクトは自分の鍵の並びを覚えていて、`JSON.stringify` はその並びで書く。
/// `buildScopedTripShare`(`lib/share-scope.ts:294-311`)は 7 つの欄を分割代入で外してから
/// 作り直すので、出来上がったオブジェクトでは**その 7 つが末尾に移る** —— 型は同じでも
/// バイトは違う。Swift の構造体は並びを 1 つしか持てないので、どちらで作られたかをここに
/// 覚えておく。`==` と `Codable` はこの欄を見ない(同じ旅程は、並びが違っても同じ旅程)。
public enum ShareFieldOrder: Sendable {
  /// `ShareableTripInput` の宣言順。`encodeTripShare` に渡す素の入力と、`decodeTripShare` が
  /// 組み立てて返すオブジェクト(TS `:270-305`)がこれ。
  case declared
  /// `buildScopedTripShare` が作り直した並び。`userStayMinutes` `lastEntryTimes` `dayOverrides`
  /// `lockedOrderByDay` `removedStops` `legModeOverrides` `resolutionOverrides` が末尾に来る。
  case remapped
}

// MARK: - 順序付きレコード

/// TS `Record<string, T>` —— **鍵の並びを覚えている**連想配列。
///
/// `Dictionary` では駄目な理由は 2 つある。1 つは直列化(JS はオブジェクトの並びのまま書く)。
/// もう 1 つは掃除役で、`cleanNumberRecord` などが `Object.entries(...).slice(0, 80)` と
/// **先頭 80 件**を残すので、どの停留所の編集が生き残るかが並びで決まる。
///
/// `==` は並びを見ない(TS のテストが使う `assert.deepEqual` と同じ)。並びが正しいことは
/// 共有コードのバイトが証明する。
public struct ShareRecord<Value: Equatable & Sendable>: Equatable, Sendable {
  private(set) var orderedKeys: [String]
  private var storage: [String: Value]

  public init() {
    orderedKeys = []
    storage = [:]
  }

  public init(_ pairs: [(String, Value)]) {
    orderedKeys = []
    storage = [:]
    for (key, value) in pairs { self[key] = value }
  }

  public subscript(key: String) -> Value? {
    get { storage[key] }
    set {
      guard let newValue else {
        if storage.removeValue(forKey: key) != nil { orderedKeys.removeAll { $0 == key } }
        return
      }
      // JS の代入と同じ:既にある鍵は位置を変えず値だけ差し替わる。
      if storage.updateValue(newValue, forKey: key) == nil { orderedKeys.append(key) }
    }
  }

  /// TS `Object.entries(record)` —— JS の並び規則(配列添字になれる鍵が昇順で先、残りは挿入順)。
  public var entries: [(key: String, value: Value)] {
    let indexed = orderedKeys.compactMap { key in ShareJSONObject.arrayIndex(key).map { (index: $0, key: key) } }
      .sorted { $0.index < $1.index }
      .map(\.key)
    let named = orderedKeys.filter { ShareJSONObject.arrayIndex($0) == nil }
    return (indexed + named).map { (key: $0, value: storage[$0]!) }
  }

  public var keys: [String] { entries.map(\.key) }
  public var count: Int { orderedKeys.count }
  public var isEmpty: Bool { orderedKeys.isEmpty }
  public var dictionary: [String: Value] { storage }

  public static func == (lhs: Self, rhs: Self) -> Bool { lhs.storage == rhs.storage }
}

extension ShareRecord: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (String, Value)...) {
    self.init(elements)
  }
}

extension ShareRecord: Codable where Value: Codable {
  private struct AnyStringKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  /// **この `Codable` は共有コードの経路ではない。** `KeyedDecodingContainer` は鍵の出現順を
  /// 教えてくれないので、往復すると並びが JS の並び規則どおりに整えられる(決定的ではあるが、
  /// 線の上にあった挿入順とは限らない)。Web と同じバイトが要るときは
  /// `ShareCodec.encode(_:)` / `ShareCodec.decode(_:)` を使うこと。
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: AnyStringKey.self)
    var pairs: [(String, Value)] = []
    for key in container.allKeys {
      pairs.append((key.stringValue, try container.decode(Value.self, forKey: key)))
    }
    let indexed = pairs.compactMap { pair in ShareJSONObject.arrayIndex(pair.0).map { (index: $0, pair: pair) } }
      .sorted { $0.index < $1.index }
      .map(\.pair)
    let named = pairs.filter { ShareJSONObject.arrayIndex($0.0) == nil }
      .sorted { jsStringLess($0.0, $1.0) }
    self.init(indexed + named)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: AnyStringKey.self)
    for entry in entries { try container.encode(entry.value, forKey: AnyStringKey(entry.key)) }
  }
}

// MARK: - 共有される旅程

/// TS `ShareableTripInput`(`lib/share-link.ts:21-54`)。欄の名前も並びも TS のまま。
///
/// TS の `number` のうち `userStayMinutes` と `dayOverrides` の値は `Int` にしてある:
/// 受け取り側の `cleanNumberRecord` が必ず `Math.round` で整数に均すので、小数は
/// 「送れても届かない」値でしかない。
public struct ShareableTripInput: Equatable, Sendable, Codable {
  /// 計画が立てられた国、または "auto"。
  public var destination: DestinationChoice
  public var itinerary: String
  public var tripDays: Int
  public var tripStartDate: String
  /// 偽なら、その日付は旅行者が確かめたものではなく計画上の仮置き。
  public var dateWasProvided: Bool
  public var hotelQuery: String
  public var pace: Pace
  public var mealPlan: MealPlan
  public var travelPreference: TravelPreference
  public var arrivalAirport: String
  public var arrivalTime: String
  public var departureAirport: String
  public var departureTime: String
  public var flightKind: FlightKind
  public var dayStartDefault: String
  public var dayEndTarget: String
  /// TS は `0 | 10 | 20 | 30`。値を絞るのは置く側の仕事なので入れ物は素の `Int`
  /// (`PlannerEditState.transferBufferMinutes` と同じ判断)。
  public var transferBufferMinutes: Int
  public var maxWalkingMinutesPerLeg: Int?
  public var maxTransfersPerLeg: Int?
  /// 結果画面で利用者が入れた編集。プロバイダの物証は決して共有されない。
  public var userStayMinutes: ShareRecord<Int>
  public var lastEntryTimes: ShareRecord<String>
  public var dayStartTimes: IntKeyedDictionary<String>
  public var dayEndTimes: IntKeyedDictionary<String>
  public var legModeOverrides: ShareRecord<TransportMode>
  public var dayOverrides: ShareRecord<Int>
  public var lockedOrderByDay: IntKeyedDictionary<[String]>?
  public var removedStops: [PlannerRemovedStop]
  /// 見直した入力を再現するために要る、安定した解決の選択。
  public var resolutionOverrides: [ResolutionOverride]?

  /// この値が書かれるときの鍵の並び。`==`・`Codable` の対象外(`CodingKeys` に無い既定値付きの
  /// 欄なので、合成された `init(from:)` も読まない)。
  public internal(set) var fieldOrder: ShareFieldOrder = .declared

  /// `fieldOrder` が入っていないのは意図的(既定値のある欄なので合成された `init(from:)` も
  /// 読まない)。欄を足したら **3 か所** —— ここ、`==`、`ShareCodec.payload` —— に書き足す
  /// ことになり、`everyFieldReachesTheWireAndTheComparison` が 3 つとも数える。
  enum CodingKeys: String, CodingKey, CaseIterable {
    case destination, itinerary, tripDays, tripStartDate, dateWasProvided, hotelQuery, pace,
         mealPlan, travelPreference, arrivalAirport, arrivalTime, departureAirport, departureTime,
         flightKind, dayStartDefault, dayEndTarget, transferBufferMinutes, maxWalkingMinutesPerLeg,
         maxTransfersPerLeg, userStayMinutes, lastEntryTimes, dayStartTimes, dayEndTimes,
         legModeOverrides, dayOverrides, lockedOrderByDay, removedStops, resolutionOverrides
  }

  public init(
    destination: DestinationChoice,
    itinerary: String,
    tripDays: Int,
    tripStartDate: String,
    dateWasProvided: Bool,
    hotelQuery: String,
    pace: Pace,
    mealPlan: MealPlan,
    travelPreference: TravelPreference,
    arrivalAirport: String,
    arrivalTime: String,
    departureAirport: String,
    departureTime: String,
    flightKind: FlightKind,
    dayStartDefault: String,
    dayEndTarget: String,
    transferBufferMinutes: Int,
    maxWalkingMinutesPerLeg: Int? = nil,
    maxTransfersPerLeg: Int? = nil,
    userStayMinutes: ShareRecord<Int> = [:],
    lastEntryTimes: ShareRecord<String> = [:],
    dayStartTimes: IntKeyedDictionary<String> = IntKeyedDictionary(),
    dayEndTimes: IntKeyedDictionary<String> = IntKeyedDictionary(),
    legModeOverrides: ShareRecord<TransportMode> = [:],
    dayOverrides: ShareRecord<Int> = [:],
    lockedOrderByDay: IntKeyedDictionary<[String]>? = nil,
    removedStops: [PlannerRemovedStop] = [],
    resolutionOverrides: [ResolutionOverride]? = nil
  ) {
    self.destination = destination
    self.itinerary = itinerary
    self.tripDays = tripDays
    self.tripStartDate = tripStartDate
    self.dateWasProvided = dateWasProvided
    self.hotelQuery = hotelQuery
    self.pace = pace
    self.mealPlan = mealPlan
    self.travelPreference = travelPreference
    self.arrivalAirport = arrivalAirport
    self.arrivalTime = arrivalTime
    self.departureAirport = departureAirport
    self.departureTime = departureTime
    self.flightKind = flightKind
    self.dayStartDefault = dayStartDefault
    self.dayEndTarget = dayEndTarget
    self.transferBufferMinutes = transferBufferMinutes
    self.maxWalkingMinutesPerLeg = maxWalkingMinutesPerLeg
    self.maxTransfersPerLeg = maxTransfersPerLeg
    self.userStayMinutes = userStayMinutes
    self.lastEntryTimes = lastEntryTimes
    self.dayStartTimes = dayStartTimes
    self.dayEndTimes = dayEndTimes
    self.legModeOverrides = legModeOverrides
    self.dayOverrides = dayOverrides
    self.lockedOrderByDay = lockedOrderByDay
    self.removedStops = removedStops
    self.resolutionOverrides = resolutionOverrides
  }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.destination == rhs.destination
      && lhs.itinerary == rhs.itinerary
      && lhs.tripDays == rhs.tripDays
      && lhs.tripStartDate == rhs.tripStartDate
      && lhs.dateWasProvided == rhs.dateWasProvided
      && lhs.hotelQuery == rhs.hotelQuery
      && lhs.pace == rhs.pace
      && lhs.mealPlan == rhs.mealPlan
      && lhs.travelPreference == rhs.travelPreference
      && lhs.arrivalAirport == rhs.arrivalAirport
      && lhs.arrivalTime == rhs.arrivalTime
      && lhs.departureAirport == rhs.departureAirport
      && lhs.departureTime == rhs.departureTime
      && lhs.flightKind == rhs.flightKind
      && lhs.dayStartDefault == rhs.dayStartDefault
      && lhs.dayEndTarget == rhs.dayEndTarget
      && lhs.transferBufferMinutes == rhs.transferBufferMinutes
      && lhs.maxWalkingMinutesPerLeg == rhs.maxWalkingMinutesPerLeg
      && lhs.maxTransfersPerLeg == rhs.maxTransfersPerLeg
      && lhs.userStayMinutes == rhs.userStayMinutes
      && lhs.lastEntryTimes == rhs.lastEntryTimes
      && lhs.dayStartTimes == rhs.dayStartTimes
      && lhs.dayEndTimes == rhs.dayEndTimes
      && lhs.legModeOverrides == rhs.legModeOverrides
      && lhs.dayOverrides == rhs.dayOverrides
      && lhs.lockedOrderByDay == rhs.lockedOrderByDay
      && lhs.removedStops == rhs.removedStops
      && lhs.resolutionOverrides == rhs.resolutionOverrides
  }
}

// MARK: - 符号化と復号

public enum ShareCodec {

  // `lib/share-link.ts:56-69` の集合・正規表現・上限。`\d` は書かない —— ICU の `\d` は
  // Unicode の数字全部(全角の「１」も)に当たるが、JS の `\d` は `[0-9]` だけ。`^`/`$` も
  // 使わない —— ICU の `$` は末尾の改行の**手前**にも当たるので、`\A`/`\z` で入力の端を指す。
  static let airportCodePattern = try! JSRegex("\\A[A-Z]{3}\\z")
  static let clockPattern = try! JSRegex("\\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\\z")
  static let datePattern = try! JSRegex("\\A[0-9]{4}-[0-9]{2}-[0-9]{2}\\z")
  static let providerRefPattern = try! JSRegex("\\A[A-Za-z0-9_-]{1,256}\\z")
  /// `cleanDayTimes`/`cleanLockedOrder` の鍵(0…13)。
  static let dayKeyPattern = try! JSRegex("\\A(?:[0-9]|1[0-3])\\z")

  static let transferBuffers: Set<Int> = [0, 10, 20, 30]
  static let maxResolutionOverrides = 12
  /// 共有できる旅程は 4,000 文字までなので、これより大きい出現番号はこの荷物が持っている
  /// 中身を指せない。
  static let maxResolutionInputIndex = 3_999

  // MARK: encodeTripShare (:96-108)

  /// TS `encodeTripShare`(`:96-108`)。`{ v: 1, ...input, resolutionOverrides? }` を
  /// `JSON.stringify` して UTF-8 にし、パディング無しの base64url にする。
  ///
  /// 解決の選択は書く前に射影し直す(TS `:98-101`)。型は防壁にならない —— 実行時には
  /// Google の可変な名前・住所・座標を持ったプロバイダ応答が渡されうる。
  public static func encode(_ input: ShareableTripInput) -> String {
    ShareBase64URL.encode(Data(payload(input).serialized.utf8))
  }

  /// `JSON.stringify` に渡される直前のオブジェクト。テストが中身を覗けるように internal。
  static func payload(_ input: ShareableTripInput) -> ShareJSON {
    var object = ShareJSONObject()
    object["v"] = .number(1)
    object["destination"] = .string(input.destination.rawValue)
    object["itinerary"] = .string(input.itinerary)
    object["tripDays"] = .number(Double(input.tripDays))
    object["tripStartDate"] = .string(input.tripStartDate)
    object["dateWasProvided"] = .bool(input.dateWasProvided)
    object["hotelQuery"] = .string(input.hotelQuery)
    object["pace"] = .string(input.pace.rawValue)
    object["mealPlan"] = .string(input.mealPlan.rawValue)
    object["travelPreference"] = .string(input.travelPreference.rawValue)
    object["arrivalAirport"] = .string(input.arrivalAirport)
    object["arrivalTime"] = .string(input.arrivalTime)
    object["departureAirport"] = .string(input.departureAirport)
    object["departureTime"] = .string(input.departureTime)
    object["flightKind"] = .string(input.flightKind.rawValue)
    object["dayStartDefault"] = .string(input.dayStartDefault)
    object["dayEndTarget"] = .string(input.dayEndTarget)
    object["transferBufferMinutes"] = .number(Double(input.transferBufferMinutes))
    if let value = input.maxWalkingMinutesPerLeg { object["maxWalkingMinutesPerLeg"] = .number(Double(value)) }
    if let value = input.maxTransfersPerLeg { object["maxTransfersPerLeg"] = .number(Double(value)) }

    let dayStartTimes = ShareJSONMember(key: "dayStartTimes", value: intKeyedJSON(input.dayStartTimes) { .string($0) })
    let dayEndTimes = ShareJSONMember(key: "dayEndTimes", value: intKeyedJSON(input.dayEndTimes) { .string($0) })
    let userStayMinutes = ShareJSONMember(key: "userStayMinutes", value: recordJSON(input.userStayMinutes) { .number(Double($0)) })
    let lastEntryTimes = ShareJSONMember(key: "lastEntryTimes", value: recordJSON(input.lastEntryTimes) { .string($0) })
    let legModeOverrides = ShareJSONMember(key: "legModeOverrides", value: recordJSON(input.legModeOverrides) { .string($0.rawValue) })
    let dayOverrides = ShareJSONMember(key: "dayOverrides", value: recordJSON(input.dayOverrides) { .number(Double($0)) })
    let lockedOrderByDay = input.lockedOrderByDay.map { locked in
      ShareJSONMember(key: "lockedOrderByDay", value: intKeyedJSON(locked) { ids in .array(ids.map(ShareJSON.string)) })
    }
    let removedStops = ShareJSONMember(key: "removedStops", value: .array(input.removedStops.map { stop in
      .object(ShareJSONObject([
        ShareJSONMember(key: "id", value: .string(stop.id)),
        ShareJSONMember(key: "name", value: .string(stop.name)),
      ]))
    }))

    let remapped = [dayOverrides, lockedOrderByDay, removedStops, legModeOverrides].compactMap { $0 }
    let members: [ShareJSONMember] = switch input.fieldOrder {
    case .declared:
      [userStayMinutes, lastEntryTimes, dayStartTimes, dayEndTimes, legModeOverrides, dayOverrides]
        + [lockedOrderByDay, removedStops].compactMap { $0 }
    // `lib/share-scope.ts:283-311` —— 分割代入で外された欄は、作り直された順で末尾に付く。
    case .remapped:
      [dayStartTimes, dayEndTimes, userStayMinutes, lastEntryTimes] + remapped
    }
    for member in members { object[member.key] = member.value }

    let resolutionOverrides = cleanResolutionOverrides(input.resolutionOverrides)
    if !resolutionOverrides.isEmpty {
      object["resolutionOverrides"] = .array(resolutionOverrides.map(overrideJSON))
    }
    return .object(object)
  }

  private static func recordJSON<Value>(_ record: ShareRecord<Value>, _ transform: (Value) -> ShareJSON) -> ShareJSON {
    .object(ShareJSONObject(record.entries.map { ShareJSONMember(key: $0.key, value: transform($0.value)) }))
  }

  /// TS `Record<number, T>` は JSON では文字列の鍵を持つオブジェクト。JS の並び規則では
  /// 配列添字になれる鍵(0 以上)が数として昇順で先に来る。負の鍵は JS では普通の文字列の
  /// 鍵で、挿入順を Swift の `Dictionary` は覚えていないので、昇順に並べて決定的にする
  /// (`cleanDayTimes`/`cleanLockedOrder` はどちらも負の鍵を捨てるので、線の上には現れない)。
  private static func intKeyedJSON<Value>(_ values: IntKeyedDictionary<Value>, _ transform: (Value) -> ShareJSON) -> ShareJSON {
    let keys = values.values.keys.sorted { left, right in
      let leftIsIndex = left >= 0
      let rightIsIndex = right >= 0
      if leftIsIndex != rightIsIndex { return leftIsIndex }
      return left < right
    }
    return .object(ShareJSONObject(keys.map { ShareJSONMember(key: String($0), value: transform(values.values[$0]!)) }))
  }

  private static func overrideJSON(_ override: ResolutionOverride) -> ShareJSON {
    switch override {
    case .provider(let inputIndex, let providerRef):
      return .object(ShareJSONObject([
        ShareJSONMember(key: "inputIndex", value: .number(Double(inputIndex))),
        ShareJSONMember(key: "providerRef", value: .string(providerRef)),
      ]))
    case .manual(let inputIndex, let name, let address, let latitude, let longitude):
      return .object(ShareJSONObject([
        ShareJSONMember(key: "inputIndex", value: .number(Double(inputIndex))),
        ShareJSONMember(key: "name", value: .string(name)),
        ShareJSONMember(key: "address", value: .string(address)),
        ShareJSONMember(key: "latitude", value: .number(latitude)),
        ShareJSONMember(key: "longitude", value: .number(longitude)),
      ]))
    }
  }

  // MARK: decodeTripShare (:248-306)

  /// TS `decodeTripShare`(`:248-306`)。読めない・版が違う・行程が空白だけ、のいずれかなら
  /// `nil`。それ以外の欄は 1 つずつ掃除役に通り、値がおかしければ既定に落ちる。
  public static func decode(_ code: String) -> ShareableTripInput? {
    guard let data = ShareBase64URL.decode(code) else { return nil }
    // `TextDecoder` は不正なバイト列で例外を投げず U+FFFD を置く。そのあと `JSON.parse` が転ぶ。
    guard let parsed = ShareJSON.parse(String(decoding: data, as: UTF8.self))?.asObject else { return nil }
    guard parsed["v"]?.asNumber == 1 else { return nil }

    let itinerary = parsed["itinerary"]?.asString.map { JSText.slice($0, 4_000) } ?? ""
    if JSText.trim(itinerary).isEmpty { return nil }

    let tripDays = parsed["tripDays"]?.asFiniteNumber.map { Int(min(14, max(1, JSText.round($0)))) } ?? 3
    let tripStartDate = cleanCalendarDate(parsed["tripStartDate"])
    let lockedOrderByDay = cleanLockedOrder(parsed["lockedOrderByDay"])
    let resolutionOverrides = cleanResolutionOverrides(parsed["resolutionOverrides"])
    let maxWalkingMinutesPerLeg = parsed["maxWalkingMinutesPerLeg"]?.asFiniteNumber.map { Int(min(180, max(5, JSText.round($0)))) }
    let maxTransfersPerLeg = parsed["maxTransfersPerLeg"]?.asFiniteNumber.map { Int(min(8, max(0, JSText.round($0)))) }
    let dayStartDefault = cleanClock(parsed["dayStartDefault"])

    return ShareableTripInput(
      destination: parsed["destination"]?.asString.flatMap(DestinationChoice.init(rawValue:)) ?? .auto,
      itinerary: itinerary,
      tripDays: tripDays,
      tripStartDate: tripStartDate,
      dateWasProvided: (parsed["dateWasProvided"]?.isTrue ?? false) && !tripStartDate.isEmpty,
      hotelQuery: parsed["hotelQuery"]?.asString.map { JSText.slice($0, 160) } ?? "",
      pace: parsed["pace"]?.asString.flatMap(Pace.init(rawValue:)) ?? .balanced,
      mealPlan: parsed["mealPlan"]?.asString.flatMap(MealPlan.init(rawValue:)) ?? .all,
      travelPreference: parsed["travelPreference"]?.asString.flatMap(TravelPreference.init(rawValue:)) ?? .auto,
      arrivalAirport: cleanAirport(parsed["arrivalAirport"]),
      arrivalTime: cleanClock(parsed["arrivalTime"]),
      departureAirport: cleanAirport(parsed["departureAirport"]),
      departureTime: cleanClock(parsed["departureTime"]),
      flightKind: parsed["flightKind"]?.asString.flatMap(FlightKind.init(rawValue:)) ?? .international,
      dayStartDefault: dayStartDefault.isEmpty ? "09:00" : dayStartDefault,
      dayEndTarget: cleanClock(parsed["dayEndTarget"]),
      transferBufferMinutes: transferBufferMinutes(parsed["transferBufferMinutes"]),
      maxWalkingMinutesPerLeg: maxWalkingMinutesPerLeg,
      maxTransfersPerLeg: maxTransfersPerLeg,
      userStayMinutes: cleanNumberRecord(parsed["userStayMinutes"], minimum: 15, maximum: 720),
      lastEntryTimes: cleanStopTimes(parsed["lastEntryTimes"]),
      dayStartTimes: cleanDayTimes(parsed["dayStartTimes"]),
      dayEndTimes: cleanDayTimes(parsed["dayEndTimes"]),
      legModeOverrides: cleanLegModes(parsed["legModeOverrides"]),
      dayOverrides: cleanNumberRecord(parsed["dayOverrides"], minimum: 1, maximum: 14),
      lockedOrderByDay: lockedOrderByDay.values.isEmpty ? nil : lockedOrderByDay,
      removedStops: cleanRemovedStops(parsed["removedStops"]),
      resolutionOverrides: resolutionOverrides.isEmpty ? nil : resolutionOverrides
    )
  }

  /// TS `transferBuffers.has(...)`(`:291-293`)。JS の `Set#has` は `SameValueZero` なので
  /// `20` と `20.0` は同じ、`20.5` は違う。ここに `Number.isFinite` は要らない —— 集合に
  /// `±∞` は入っていないので、そのまま既定の 10 に落ちる。
  private static func transferBufferMinutes(_ value: ShareJSON?) -> Int {
    guard let number = value?.asNumber, let integer = Int(exactly: number),
          transferBuffers.contains(integer) else { return 10 }
    return integer
  }

  // MARK: 掃除役 (:71-80, :110-246)

  /// TS `cleanCalendarDate`(`:71-80`)。形が合っていても存在しない日(2 月 31 日、閏でない
  /// 年の 2 月 29 日)は空になる —— `Date.UTC` が繰り上げた結果と元の数を突き合わせる。
  /// `Core/CalendarDate.swift` の `init?(_:)` が同じ繰り上げ検査(月 1–12、日はその月の日数まで)
  /// を持っているので、突き合わせはそれで足りる。
  ///
  /// ただし 1 つだけ足す:`Date.UTC` は **0–99 の年を 1900 年代に読み替える**(`Date.UTC(26, …)`
  /// は 1926 年)ので、`getUTCFullYear() === year` が成り立たず TS は "0026-09-14" を空にする。
  static func cleanCalendarDate(_ value: ShareJSON?) -> String {
    guard let text = value?.asString, datePattern.test(text),
          let date = CalendarDate(text), date.year >= 100 else { return "" }
    return text
  }

  /// TS `cleanClock`(`:110-112`)
  static func cleanClock(_ value: ShareJSON?) -> String {
    guard let text = value?.asString, clockPattern.test(text) else { return "" }
    return text
  }

  /// TS `cleanAirport`(`:114-118`)。どの IATA コードもここでは通す —— 選ばれた行き先が
  /// 持たないコードは組み立て側が無視するので、古いコードが別の旅程を曲げることはない。
  static func cleanAirport(_ value: ShareJSON?) -> String {
    guard let text = value?.asString, airportCodePattern.test(text) else { return "none" }
    return text
  }

  /// TS `cleanNumberRecord`(`:120-128`)
  static func cleanNumberRecord(_ value: ShareJSON?, minimum: Int, maximum: Int, limit: Int = 80) -> ShareRecord<Int> {
    guard let object = value?.asObject else { return [:] }
    var result = ShareRecord<Int>()
    for entry in object.entries.prefix(limit) {
      guard !entry.key.isEmpty, JSText.length(entry.key) <= 200, let raw = entry.value.asFiniteNumber else { continue }
      result[entry.key] = Int(min(Double(maximum), max(Double(minimum), JSText.round(raw))))
    }
    return result
  }

  /// TS `cleanDayTimes`(`:130-139`)。`.slice(0, 14)` が**先**なので、15 番目以降は鍵が正しくても
  /// 落ちる。
  static func cleanDayTimes(_ value: ShareJSON?) -> IntKeyedDictionary<String> {
    guard let object = value?.asObject else { return IntKeyedDictionary() }
    var result = IntKeyedDictionary<String>()
    for entry in object.entries.prefix(14) {
      guard dayKeyPattern.test(entry.key), let day = Int(entry.key) else { continue }
      let time = cleanClock(entry.value)
      if !time.isEmpty { result[day] = time }
    }
    return result
  }

  /// TS `cleanStopTimes`(`:141-150`)
  static func cleanStopTimes(_ value: ShareJSON?) -> ShareRecord<String> {
    guard let object = value?.asObject else { return [:] }
    var result = ShareRecord<String>()
    for entry in object.entries.prefix(80) {
      guard !entry.key.isEmpty, JSText.length(entry.key) <= 200 else { continue }
      let time = cleanClock(entry.value)
      if !time.isEmpty { result[entry.key] = time }
    }
    return result
  }

  /// TS `cleanLegModes`(`:152-157`)
  static func cleanLegModes(_ value: ShareJSON?) -> ShareRecord<TransportMode> {
    guard let object = value?.asObject else { return [:] }
    var result = ShareRecord<TransportMode>()
    for entry in object.entries.prefix(80) {
      let length = JSText.length(entry.key)
      guard length > 0, length <= 300, let mode = entry.value.asString.flatMap(TransportMode.init(rawValue:)) else { continue }
      result[entry.key] = mode
    }
    return result
  }

  /// TS `cleanLockedOrder`(`:159-170`)
  static func cleanLockedOrder(_ value: ShareJSON?) -> IntKeyedDictionary<[String]> {
    guard let object = value?.asObject else { return IntKeyedDictionary() }
    var result = IntKeyedDictionary<[String]>()
    for entry in object.entries.prefix(14) {
      guard dayKeyPattern.test(entry.key), let day = Int(entry.key), let rawIds = entry.value.asArray else { continue }
      var ids: [String] = []
      var seen: Set<String> = []
      for raw in rawIds.prefix(30) {
        guard let id = raw.asString, !id.isEmpty, JSText.length(id) <= 200 else { continue }
        // `[...new Set(ids)]` —— 最初に現れた位置で残す。
        if seen.insert(id).inserted { ids.append(id) }
      }
      if !ids.isEmpty { result[day] = ids }
    }
    return result
  }

  /// TS `cleanRemovedStops`(`:172-180`)
  static func cleanRemovedStops(_ value: ShareJSON?) -> [PlannerRemovedStop] {
    guard let entries = value?.asArray else { return [] }
    return entries.prefix(24).compactMap { entry in
      guard let object = entry.asObject,
            let id = object["id"]?.asString, !id.isEmpty, JSText.length(id) <= 200,
            let rawName = object["name"]?.asString else { return nil }
      let name = JSText.trim(rawName)
      guard !name.isEmpty else { return nil }
      return PlannerRemovedStop(id: id, name: JSText.slice(name, 160))
    }
  }

  /// TS `cleanTravellerText`(`:182-190`)。NFKC で畳み、制御文字を空白にし、空白の連なりを
  /// 1 つにし、端を落として、UTF-16 で切る。
  static func cleanTravellerText(_ value: ShareJSON?, _ maximumLength: Int) -> String {
    guard let text = value?.asString else { return "" }
    var replaced = String.UnicodeScalarView()
    for scalar in JSText.normalizeNFKC(text).unicodeScalars {
      replaced.append(scalar.value <= 0x1F || scalar.value == 0x7F ? " " : scalar)
    }
    var collapsed = String.UnicodeScalarView()
    var inWhitespace = false
    for scalar in replaced {
      if JSText.whitespaceScalars.contains(scalar) {
        if !inWhitespace { collapsed.append(" ") }
        inWhitespace = true
      } else {
        collapsed.append(scalar)
        inWhitespace = false
      }
    }
    return JSText.slice(JSText.trim(String(collapsed)), maximumLength)
  }

  /// TS `cleanResolutionOverrides`(`:192-246`)を、型の付いた値に対して。
  ///
  /// `encodeTripShare` はこれを**書く前**に通す(`:100-101`)。TS では実行時に何が来るか
  /// 分からないので同じ関数が使われる —— Swift でも同じ 1 つの実装を通すために、いったん
  /// 線の上の形に落としてから掃除する。
  static func cleanResolutionOverrides(_ overrides: [ResolutionOverride]?) -> [ResolutionOverride] {
    guard let overrides else { return [] }
    return cleanResolutionOverrides(ShareJSON.array(overrides.map(overrideJSON)))
  }

  /// TS `cleanResolutionOverrides`(`:192-246`)
  static func cleanResolutionOverrides(_ value: ShareJSON?) -> [ResolutionOverride] {
    guard let entries = value?.asArray else { return [] }
    var result: [ResolutionOverride] = []
    var usedInputIndexes: Set<Int> = []
    for raw in entries {
      if result.count >= maxResolutionOverrides { break }
      guard let entry = raw.asObject else { continue }
      guard let rawIndex = entry["inputIndex"]?.asNumber,
            let inputIndex = safeInteger(rawIndex),
            inputIndex >= 0,
            inputIndex <= maxResolutionInputIndex,
            !usedInputIndexes.contains(inputIndex) else { continue }

      // `providerRef` があるだけでプロバイダの決定になる。壊れたプロバイダ id は、
      // 手入力側へ落ちてプロバイダの表示欄を「旅行者が書いた」ものとして残すのではなく、
      // 閉じる方向で失敗しなければならない。
      if let providerRefValue = entry["providerRef"] {
        guard let providerRef = providerRefValue.asString, providerRefPattern.test(providerRef) else { continue }
        result.append(.provider(inputIndex: inputIndex, providerRef: providerRef))
        usedInputIndexes.insert(inputIndex)
        continue
      }

      let name = cleanTravellerText(entry["name"], 160)
      let address = cleanTravellerText(entry["address"], 300)
      guard !name.isEmpty, !address.isEmpty,
            let latitude = entry["latitude"]?.asFiniteNumber, latitude >= -90, latitude <= 90,
            let longitude = entry["longitude"]?.asFiniteNumber, longitude >= -180, longitude <= 180 else { continue }
      result.append(.manual(
        inputIndex: inputIndex,
        name: name,
        address: address,
        // `Object.is(latitude, -0) ? 0 : latitude`
        latitude: latitude == 0 ? 0 : latitude,
        longitude: longitude == 0 ? 0 : longitude
      ))
      usedInputIndexes.insert(inputIndex)
    }
    return result
  }

  /// TS `Number.isSafeInteger(value)`
  private static func safeInteger(_ value: Double) -> Int? {
    guard value.isFinite, value == value.rounded(.towardZero), abs(value) <= Double(jsMaxSafeInteger) else { return nil }
    return Int(value)
  }
}
