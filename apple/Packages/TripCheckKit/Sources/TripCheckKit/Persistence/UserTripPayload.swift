import Foundation

/*
 * 端末内に置いてよい荷物の形と、その検査。
 *
 * 移植元は `lib/trip-store.ts`:`FORBIDDEN_PERSISTED_KEYS` `:94-123`、上限 `:125-127`、
 * `cloneJsonValue` `:135-185`、`validateUserTripPayload` `:188-203`。
 *
 * 保存してよいのは**利用者が書いたもの**(入力と編集)だけ。プロバイダの応答、ビルド済みの
 * 旅程、生きている経路・営業時間は、写すのではなく取り直す/組み直す(`lib/trip-store.ts:1-7`)。
 */

/// TS `JsonObject`(`lib/trip-store.ts:18`)。
public typealias JSONObject = [String: JSONValue]

/// 端末内保存が投げる誤り。`invalidPayload`/`invalidRecord` が持つ文字列は TS の `TypeError`
/// の文面そのままで、移植したテストが TS と同じ語で照合できるようにしてある。
public enum TripStoreError: Error {
  /// `validateUserTripPayload` / `cloneJsonValue` の拒否(`lib/trip-store.ts:135-203`)。
  case invalidPayload(String)
  /// `validId` / `validTitle` / `validTimestamp` / `cloneRecord` の拒否(`:206-232`)。
  case invalidRecord(String)
  /// `MAX_PAYLOAD_BYTES` 超え(`:200-202`)。
  case tooLarge
  /// ファイル読み書きの失敗。TS には無い(IndexedDB の失敗は memory への退避だった `:466-489`)。
  case ioFailure(any Error)

  public var message: String {
    switch self {
    case .invalidPayload(let text), .invalidRecord(let text): return text
    case .tooLarge: return "Trip payload is too large for device-local storage."
    case .ioFailure(let error): return String(describing: error)
    }
  }
}

/// TS `UserTripPayload`(`lib/trip-store.ts:22-25`)。`validate` を通さずには作れない
/// —— 記憶域に入る値が検査済みであることを、型そのもので担保する。
public struct UserTripPayload: Codable, Equatable, Sendable {
  public let input: JSONObject
  public let edits: JSONObject

  private init(input: JSONObject, edits: JSONObject) {
    self.input = input
    self.edits = edits
  }

  // MARK: - 上限(`lib/trip-store.ts:125-127`)

  public static let maxPayloadNodes = 8_000
  public static let maxPayloadDepth = 16
  public static let maxPayloadBytes = 160_000

  // MARK: - 禁止キー(`lib/trip-store.ts:94-123` + 統合仕様 §5.5)

  /// TS `FORBIDDEN_PERSISTED_KEYS`(32 個)に、統合仕様 §5.5 が名指しする 4 つ
  /// —— `displayname` / `providersnapshot` / `livetransitminutes` / `routes` —— を足したもの。
  ///
  /// 中身は**正規化済みの形**(ASCII の英数字以外を落として小文字化)で持つ。照合するときは
  /// `normalizedKey(_:)` を通すので、`"Opening-Hours"` も `"opening_hours"` も同じ鍵に落ちる。
  ///
  /// 仕様書案にあった `plan` / `days` は入れていない。Web が実際に持たせている入力は
  /// `input: { shareCode, tripDays, tripStartDate }` で、`days` は日数の欄と衝突する。
  /// ビルド済みの旅程は TS と同じく `builttripplan` / `scheduleddays` と、下の構造的な
  /// 見張り(`:165-169`)で止める。
  public static let forbiddenKeys: Set<String> = [
    // --- TS `FORBIDDEN_PERSISTED_KEYS` `:94-123` をそのまま ---
    "builttripplan",
    "scheduleddays",
    "baserecommendations",
    "foodrecommendationslots",
    "resolvedstops",
    "resolvedbase",
    "routegeometry",
    "routegeometrybyday",
    "livetransit",
    "livewalking",
    "livedriving",
    "liverouteevidence",
    "providersnapshothash",
    "providerresponse",
    "providerevidence",
    "criticalfacts",
    "openingwindowsbyday",
    "openinghours",
    "regularopeningperiods",
    "currentopeningperiods",
    "formattedaddress",
    "googlemapsurl",
    "googlemapsuri",
    "businessstatus",
    "placetypes",
    "rating",
    "userratingcount",
    "sourceurl",
    "verifiedat",
    "photo",
    "photos",
    "reviews",
    // --- 統合仕様 §5.5(Google の表示名・経路・生きた所要) ---
    "displayname",
    "providersnapshot",
    "livetransitminutes",
    "routes",
  ]

  /// TS `key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase()`(`:159`)。
  ///
  /// `/i` が付いていても JS の非 Unicode モードでは ASCII の外へ広がらない(ケルビン記号 U+212A は
  /// `[a-z]/i` に当たらない)ので、落とす対象は「ASCII の英数字以外すべて」。残るのは ASCII だけ
  /// なので、`toLocaleLowerCase` のロケール依存(トルコ語の `I`)も起きない。
  public static func normalizedKey(_ key: String) -> String {
    var output = String.UnicodeScalarView()
    for scalar in key.unicodeScalars {
      let value = scalar.value
      if (48...57).contains(value) || (97...122).contains(value) {
        output.append(scalar)
      } else if (65...90).contains(value), let lowered = UnicodeScalar(value + 32) {
        output.append(lowered)
      }
    }
    return String(output)
  }

  // MARK: - 検査(`validateUserTripPayload` `:188-203`)

  /// TS `validateUserTripPayload`(`:188-203`)。
  ///
  /// TS が持っていて Swift に相当が無い枝は落としてある:`JSONValue` は関数も `Date` も
  /// クラス実体も持てず、値型なので循環も疎な配列も作れない(TS `:139`/`:146`/`:150`/`:152`/`:154`)。
  /// 残る「JSON として不正」は非有限の数だけで、それは下で弾く。
  public static func validate(_ value: JSONValue) throws -> UserTripPayload {
    guard case .object(let root) = value else {
      throw TripStoreError.invalidPayload("Trip payload must be an object with input and edits fields.")
    }
    guard root.count == 2, let inputValue = root["input"], let editsValue = root["edits"] else {
      throw TripStoreError.invalidPayload("Trip payload may contain only input and edits; plans and provider data are excluded.")
    }
    guard case .object(let inputMembers) = inputValue, case .object(let editsMembers) = editsValue else {
      throw TripStoreError.invalidPayload("Trip payload input and edits must be plain objects.")
    }

    // TS は `cloneJsonValue(value, …, depth 0)` を root ごと呼ぶ(`:198`)。root はノード 1、
    // その 2 つの子は depth 1 のノード 2 と 3 —— 数え方を合わせるため、root のぶんをここで数え、
    // 子だけを歩く。root の鍵は `input` と `edits` の 2 つだけと確かめてあるので、TS `:160-169`
    // の禁止キー・構造検査が root で何かに当たることはない。
    var counter = 0
    try countNode(&counter, depth: 0)
    let edits = try checkObject(editsMembers, counter: &counter, depth: 1)
    let input = try checkObject(inputMembers, counter: &counter, depth: 1)
    let checked = JSONValue.object(["input": .object(input), "edits": .object(edits)])
    guard try compactByteCount(checked) <= maxPayloadBytes else { throw TripStoreError.tooLarge }
    return UserTripPayload(input: input, edits: edits)
  }

  /// 呼ぶ側の書き心地のための入り口。中身は `validate(_:)` と同じ。
  public static func validate(input: JSONObject, edits: JSONObject) throws -> UserTripPayload {
    try validate(.object(["input": .object(input), "edits": .object(edits)]))
  }

  /// 保存される JSON そのもの。
  public var jsonValue: JSONValue { .object(["input": .object(input), "edits": .object(edits)]) }

  /// TS `cloneJsonValue` の頭(`:136-138`)。値を 1 つ数え、予算を見る。
  private static func countNode(_ counter: inout Int, depth: Int) throws {
    counter += 1
    if counter > maxPayloadNodes || depth > maxPayloadDepth {
      throw TripStoreError.invalidPayload("Trip payload is too deeply nested or contains too many values.")
    }
  }

  /// TS `cloneJsonValue`(`:135-185`)。値型なので複製は要らず、残るのは検査だけ。
  private static func check(_ value: JSONValue, counter: inout Int, depth: Int) throws -> JSONValue {
    switch value {
    case .object(let members):
      return .object(try checkObject(members, counter: &counter, depth: depth))
    case .null, .string, .bool:
      try countNode(&counter, depth: depth)
      return value
    case .number(let number):
      try countNode(&counter, depth: depth)
      // TS `:142`。`Number.isFinite` —— NaN と ±Infinity は JSON にできない。
      guard number.isFinite else { throw TripStoreError.invalidPayload("Trip payload numbers must be finite.") }
      return value
    case .array(let elements):
      try countNode(&counter, depth: depth)
      var output: [JSONValue] = []
      output.reserveCapacity(elements.count)
      for element in elements { output.append(try check(element, counter: &counter, depth: depth + 1)) }
      return .array(output)
    }
  }

  /// `check` の object 枝(TS `:155-181`)。object のまま返すので、`validate` は root の 2 つの
  /// 子を型を失わずに受け取れる。
  private static func checkObject(_ members: JSONObject, counter: inout Int, depth: Int) throws -> JSONObject {
    try countNode(&counter, depth: depth)
    // 鍵の並びは `[String: JSONValue]` には無いので、誤りの文面が実行ごとに変わらないよう
    // 並べてから見る。TS は挿入順(`Object.keys`)で見ていた。
    let keys = members.keys.sorted()
    var normalized = Set<String>()
    for key in keys { normalized.insert(normalizedKey(key)) }
    // TS `:160-164` —— 正規化した鍵を**全部**集めてから照合する。
    for name in normalized.sorted() where forbiddenKeys.contains(name) {
      throw TripStoreError.invalidPayload("Trip payload field \"\(name)\" is provider or derived plan data and cannot be persisted.")
    }
    // TS `:165-169`。名前を変えられた/包み直された BuiltTripPlan への構造的な見張り。
    if (normalized.contains("stops") && normalized.contains("legs") && normalized.contains("starttime"))
      || (normalized.contains("scheduleddays") && normalized.contains("conflicts")) {
      throw TripStoreError.invalidPayload("A built or scheduled trip plan cannot be persisted; save user edits instead.")
    }
    var output = JSONObject(minimumCapacity: members.count)
    for key in keys {
      output[key] = try check(members[key]!, counter: &counter, depth: depth + 1)
    }
    return output
  }

  /// TS `new TextEncoder().encode(JSON.stringify(cloned)).byteLength`(`:200`)。
  ///
  /// 整形なしの JSON の UTF-8 バイト数。`.sortedKeys` は数を変えない(鍵の並びが変わるだけ)が
  /// 実行ごとに同じ値が出るように付けてある。`.withoutEscapingSlashes` は JS 側と揃えるため
  /// —— `JSON.stringify` は `/` を逃がさない。
  ///
  /// 数の書き方は多くの場合一致する(`3` → `3`、`0.1` → `0.1`、`1e21` → `1e+21`)が、全部では
  /// ない:`1e16` を Swift は `1e+16`、JS は `10000000000000000` と書き、`1e-7` は Swift が
  /// `1e-07`、JS は `1e-7`。つまり極端な指数の数を大量に持つ荷物では、この数え方が
  /// `JSON.stringify` と数バイト〜数十バイトずれうる。160,000 の境目のすぐ際で効く話で、
  /// 端末内保存の可否が Web と 1 件だけ食い違う可能性として記録しておく。
  static func compactByteCount(_ value: JSONValue) throws -> Int {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    do {
      return try encoder.encode(value).count
    } catch {
      throw TripStoreError.invalidPayload("Trip payload must contain JSON-safe values only.")
    }
  }

  // MARK: - Codable

  /// ディスクから読み戻すときも検査を通す(TS `cloneRecord` `:206-216` が
  /// `validateUserTripPayload` を呼び直すのと同じ)。書き換えられたファイルは読めない値として落ち、
  /// `TripStore` がその 1 件を飛ばす。
  public init(from decoder: Decoder) throws {
    self = try UserTripPayload.validate(JSONValue(from: decoder))
  }

  public func encode(to encoder: Encoder) throws {
    try jsonValue.encode(to: encoder)
  }
}
