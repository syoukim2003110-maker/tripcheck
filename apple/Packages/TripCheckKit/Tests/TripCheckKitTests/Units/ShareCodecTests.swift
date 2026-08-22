import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/share-link.ts` と `lib/share-scope.ts` の移植の検証。
 *
 * 中心にあるのは `Fixtures/share-vectors.json` —— `scripts/export-share-vectors.mjs` が
 * **TypeScript のエンジン自身に**書かせた共有コードの表。同じ入力を Swift 側でも組み立て、
 * 出てきた文字列がバイトまで同じであることを見る。これが「Web で開く」の実際の中身で、
 * 「意味が同じ JSON」では足りない理由は `Share/ShareCodec.swift` の見出しに書いてある。
 *
 * 入力そのものは fixture から読まずに Swift の literal で持つ。読んでしまうと「同じ入力か」を
 * 誰も確かめないまま比較することになるが、literal なら片方だけ書き換わった瞬間に
 * `expectedCode` が食い違って落ちる。
 */

// MARK: - ベクタ表

struct ShareVectorFile: Decodable {
  var maxShareFragmentChars: Int
  var vectors: [ShareVector]
  var decodeVectors: [ShareDecodeVector]

  enum LoadError: Error { case missingFixture }

  static func load() throws -> ShareVectorFile {
    guard let url = Bundle.module.url(forResource: "share-vectors", withExtension: "json", subdirectory: "Fixtures") else {
      throw LoadError.missingFixture
    }
    return try JSONDecoder().decode(ShareVectorFile.self, from: try Data(contentsOf: url))
  }

  func vector(_ name: String) throws -> ShareVector {
    try #require(vectors.first { $0.name == name }, "vector \(name)")
  }

  func decodeVector(_ name: String) throws -> ShareDecodeVector {
    try #require(decodeVectors.first { $0.name == name }, "decode vector \(name)")
  }
}

struct ShareVector: Decodable {
  var name: String
  var locale: PlannerLocale
  var expectedCode: String
  /// `decodeTripShare(expectedCode)` を書き直したバイト列。`null` なら復号が `nil` を返す。
  var decodedCode: String?
  var scopes: [ShareScopeVector]

  func scope(_ name: String) throws -> ShareScopeVector {
    try #require(scopes.first { $0.name == name }, "scope \(name) of \(self.name)")
  }
}

struct ShareScopeVector: Decodable {
  var name: String
  var scope: ShareScopeFlags
  /// `encodeTripShare(result.input)` —— 欄ごとに較べるより強い。並びまで含めて一致していないと
  /// 通らない。
  var inputCode: String?
  var code: String?
  var warnings: [String]
  var omittedUnparsedLines: Int
  var redactedReservationCount: Int
  var blocked: Bool
}

struct ShareScopeFlags: Decodable {
  var dates: Bool
  var hotel: Bool
  var airports: Bool
  var reservations: Bool
}

struct ShareDecodeVector: Decodable {
  var name: String
  var code: String
  var decodedCode: String?
}

// MARK: - `scripts/export-share-vectors.mjs` と同じ入力

enum ShareInputs {
  /// `tests/share-link.test.ts:6-41`
  static let link = ShareableTripInput(
    destination: .destination(.japan),
    itinerary: "1日目\n浅草寺\nチームラボプラネッツ 15:30 予約",
    tripDays: 3,
    tripStartDate: "2026-09-14",
    dateWasProvided: true,
    hotelQuery: "新宿駅近く",
    pace: .balanced,
    mealPlan: .all,
    travelPreference: .car,
    arrivalAirport: "HND",
    arrivalTime: "10:30",
    departureAirport: "none",
    departureTime: "",
    flightKind: .domestic,
    dayStartDefault: "08:00",
    dayEndTarget: "21:30",
    transferBufferMinutes: 20,
    userStayMinutes: ["google-sensoji": 120],
    lastEntryTimes: ["google-sensoji": "16:30"],
    dayStartTimes: [0: "08:30"],
    dayEndTimes: [0: "19:45", 1: "21:15"],
    legModeOverrides: ["google-sensoji::google-skytree": .walk],
    dayOverrides: ["google-skytree": 2],
    removedStops: [PlannerRemovedStop(id: "google-akihabara", name: "Akihabara")],
    resolutionOverrides: [
      .provider(inputIndex: 0, providerRef: "ChIJ_sensoji-123"),
      .manual(
        inputIndex: 1,
        name: "Traveller's quiet entrance",
        address: "East side of the station",
        latitude: 35.6491,
        longitude: 139.7898
      ),
    ]
  )

  /// `tests/share-scope.test.ts:6-34` の `input()`
  static func scope(_ mutate: (inout ShareableTripInput) -> Void = { _ in }) -> ShareableTripInput {
    var input = ShareableTripInput(
      destination: .destination(.japan),
      itinerary: "Day 1\nSenso-ji\nteamLab Planets — 15:30 booked\nprivate reference ABCD-123456",
      tripDays: 2,
      tripStartDate: "2026-09-14",
      dateWasProvided: true,
      hotelQuery: "Hotel Example",
      pace: .balanced,
      mealPlan: .none,
      travelPreference: .auto,
      arrivalAirport: "HND",
      arrivalTime: "10:00",
      departureAirport: "NRT",
      departureTime: "18:00",
      flightKind: .international,
      dayStartDefault: "09:00",
      dayEndTarget: "21:00",
      transferBufferMinutes: 10
    )
    mutate(&input)
    return input
  }

  static let droppedManualId = "manual-0-34.00000-135.00000"
  static let oldManualId = "manual-1-35.10000-139.20000"
  static let newManualId = "manual-0-35.10000-139.20000"
  static let providerId = "google-ChIJ_provider"
  static let unknownManualId = "manual-99-1.00000-2.00000"
  static let twinBaseId = "google-ChIJ_same"
  static let twinSecondId = "google-ChIJ_same--occurrence-2"

  /// ベクタ名 → 同じ入力。fixture 側(JS)の並びと 1 件ずつ対応する。
  static let byName: [String: ShareableTripInput] = [
    "link-basic": link,
    "link-basic-ja": link,
    "link-swiss": {
      var input = link
      input.destination = .destination(.switzerland)
      input.itinerary = "Jungfraujoch\nZermatt"
      input.arrivalAirport = "ZRH"
      input.departureAirport = "GVA"
      return input
    }(),
    "link-escapes": {
      var input = link
      input.itinerary = "Quote \" backslash \\ solidus / tab \t\nbell \u{07} sep \u{2028}\u{2029} astral \u{1F44D}\u{1F3FD} kana \u{FF8A}\u{FF9F}"
      input.hotelQuery = "Ho\u{0}tel \u{7F} \u{6771}\u{4EAC}\u{A0}\u{99C5}"
      return input
    }(),
    "link-optional-fields": {
      var input = link
      input.maxWalkingMinutesPerLeg = 25
      input.maxTransfersPerLeg = 2
      input.userStayMinutes = ["z-last": 90, "a-first": 45, "google-sensoji": 120]
      input.lastEntryTimes = ["z-last": "17:00", "a-first": "16:00"]
      input.dayStartTimes = [0: "08:30", 2: "07:15", 13: "10:00"]
      input.dayEndTimes = [1: "21:15", 0: "19:45"]
      input.legModeOverrides = ["a-first::z-last": .taxi, "z-last::google-sensoji": .transit]
      input.dayOverrides = ["z-last": 3, "a-first": 1]
      input.lockedOrderByDay = [1: ["z-last", "a-first"], 0: ["google-sensoji"]]
      input.removedStops = [
        PlannerRemovedStop(id: "google-akihabara", name: "Akihabara"),
        PlannerRemovedStop(id: "a-first", name: "A First"),
      ]
      return input
    }(),
    "link-manual-pin-only": {
      var input = link
      input.itinerary = "Traveller's quiet entrance\nSenso-ji"
      input.resolutionOverrides = [
        .manual(
          inputIndex: 0,
          name: "Traveller's quiet entrance",
          address: "East side of the station",
          latitude: 35.6491,
          longitude: 139.7898
        ),
      ]
      return input
    }(),
    "link-provider-pin-only": {
      var input = link
      input.itinerary = "Senso-ji\nTokyo Skytree"
      input.resolutionOverrides = [.provider(inputIndex: 1, providerRef: "ChIJ_skytree-9")]
      return input
    }(),
    "link-awkward-coordinates": {
      var input = link
      input.resolutionOverrides = [
        .manual(inputIndex: 0, name: "Tiny", address: "Near the equator", latitude: 1e-7, longitude: 0.1 + 0.2),
        .manual(inputIndex: 1, name: "Negative zero", address: "Null Island", latitude: -0.0, longitude: -1e-7),
        .manual(inputIndex: 2, name: "Range limits", address: "Antimeridian", latitude: 90, longitude: -180),
        .manual(inputIndex: 3, name: "Long tail", address: "Somewhere", latitude: 35.66666666666667, longitude: -0.000001),
      ]
      return input
    }(),
    "scope-minimal": scope(),
    "scope-provisional-date": scope { $0.dateWasProvided = false },
    "scope-too-long": scope {
      $0.itinerary = (0..<150).map { "Place \($0) \(String(repeating: "x", count: 60))" }.joined(separator: "\n")
    },
    "scope-opaque-only": scope { $0.itinerary = "https://example.com/private/ABC-123456" },
    "scope-omitted-sensitive": scope {
      $0.itinerary = [
        "Secret Place https://example.com/private/ABC-123456",
        "Second Place",
        "Third Place — 15:30 booked",
      ].joined(separator: "\n")
      $0.resolutionOverrides = [
        .provider(inputIndex: 0, providerRef: "ChIJ_omitted"),
        .provider(inputIndex: 1, providerRef: "ChIJ_second"),
        .manual(
          inputIndex: 2,
          name: "Traveller pin for third",
          address: "Traveller-authored address",
          latitude: 35.1,
          longitude: 139.2
        ),
      ]
    },
    "scope-manual-remap": scope {
      $0.itinerary = [
        "Secret Manual https://example.com/private/ABC-123456",
        "Kept Manual",
        "Kept Provider",
      ].joined(separator: "\n")
      $0.resolutionOverrides = [
        .manual(inputIndex: 0, name: "Secret Manual", address: "Private point", latitude: 34, longitude: 135),
        .manual(inputIndex: 1, name: "Kept Manual", address: "Traveller point", latitude: 35.1, longitude: 139.2),
        .provider(inputIndex: 2, providerRef: "ChIJ_provider"),
      ]
      $0.userStayMinutes = [droppedManualId: 60, oldManualId: 180, providerId: 90, unknownManualId: 30]
      $0.lastEntryTimes = [droppedManualId: "15:00", oldManualId: "16:00", providerId: "17:00"]
      $0.dayOverrides = [droppedManualId: 1, oldManualId: 2, providerId: 2, unknownManualId: 1]
      $0.lockedOrderByDay = [
        0: [droppedManualId, oldManualId, providerId, unknownManualId],
        1: [unknownManualId],
      ]
      $0.removedStops = [
        PlannerRemovedStop(id: droppedManualId, name: "Secret Manual"),
        PlannerRemovedStop(id: oldManualId, name: "Kept Manual"),
        PlannerRemovedStop(id: providerId, name: "Kept Provider"),
        PlannerRemovedStop(id: unknownManualId, name: "Unknown"),
      ]
      $0.legModeOverrides = [
        "\(oldManualId)::\(providerId)": .transit,
        "\(providerId)::\(oldManualId)": .walk,
        "\(droppedManualId)::\(providerId)": .taxi,
        "\(unknownManualId)::\(providerId)": .walk,
        "malformed": .taxi,
      ]
    },
    "scope-duplicate-provider-family": scope {
      $0.itinerary = "Hidden Twin https://example.com/private/ABC-123456\nVisible Twin"
      $0.resolutionOverrides = [
        .provider(inputIndex: 0, providerRef: "ChIJ_same"),
        .provider(inputIndex: 1, providerRef: "ChIJ_same"),
      ]
      $0.userStayMinutes = [twinBaseId: 60, twinSecondId: 120]
      $0.lockedOrderByDay = [0: [twinBaseId, twinSecondId]]
      $0.removedStops = [
        PlannerRemovedStop(id: twinBaseId, name: "Hidden Twin"),
        PlannerRemovedStop(id: twinSecondId, name: "Visible Twin"),
      ]
      $0.legModeOverrides = ["\(twinBaseId)::\(twinSecondId)": .walk]
    },
    "scope-catalogue-stable-ids": scope {
      $0.itinerary = "Senso-ji https://example.com/private/ABC-123456\nTokyo Skytree"
      $0.userStayMinutes = ["sensoji": 60, "tokyo-skytree": 90]
      $0.lastEntryTimes = ["sensoji": "16:00", "tokyo-skytree": "20:00"]
      $0.dayOverrides = ["sensoji": 1, "tokyo-skytree": 2]
      $0.lockedOrderByDay = [0: ["sensoji", "tokyo-skytree"]]
      $0.removedStops = [
        PlannerRemovedStop(id: "sensoji", name: "Senso-ji"),
        PlannerRemovedStop(id: "tokyo-skytree", name: "Tokyo Skytree"),
        PlannerRemovedStop(id: "google-ChIJ_hidden", name: "Hidden provider display name"),
      ]
      $0.legModeOverrides = ["sensoji::tokyo-skytree": .transit, "tokyo-skytree::sensoji": .walk]
    },
    "scope-link-input-ja": link,
  ]
}

// MARK: - Web と同じバイト

@Test func everyVectorEncodesToTheBytesTheWebEmits() throws {
  let file = try ShareVectorFile.load()
  for vector in file.vectors {
    let input = try #require(ShareInputs.byName[vector.name], "no Swift input for \(vector.name)")
    #expect(ShareCodec.encode(input) == vector.expectedCode, "\(vector.name): web-compatible bytes")
  }
}

@Test func everyVectorRoundTripsThroughDecode() throws {
  let file = try ShareVectorFile.load()
  for vector in file.vectors {
    let input = try #require(ShareInputs.byName[vector.name])
    let decoded = try #require(ShareCodec.decode(vector.expectedCode), "\(vector.name) decodes")
    // 復号したものを書き直すと、TS が同じことをしたときと同じ文字列になる。欄ごとに較べるより
    // 強い —— 掃除役が削った分も、鍵の並びも、全部この 1 本に出る。
    #expect(ShareCodec.encode(decoded) == vector.decodedCode, "\(vector.name): re-encoded bytes")
    // 掃除役が何も削らなかったベクタ(TS 側でも書き直したバイトが元と同じもの)だけは、
    // 値そのものが往復する。`scope-too-long` の行程は 4,000 文字で切られるので入らない。
    if vector.decodedCode == vector.expectedCode {
      #expect(decoded == input, "\(vector.name) round-trips")
    }
  }
}

@Test func everyDecodeVectorReachesTheSameValueAsTheWeb() throws {
  let file = try ShareVectorFile.load()
  for vector in file.decodeVectors {
    let decoded = ShareCodec.decode(vector.code)
    guard let expectedCode = vector.decodedCode else {
      #expect(decoded == nil, "\(vector.name) must be rejected")
      continue
    }
    let value = try #require(decoded, "\(vector.name) decodes")
    #expect(ShareCodec.encode(value) == expectedCode, "\(vector.name): every cleaned field")
  }
}

@Test func payloadIsVersionedJsonInBase64Url() throws {
  let code = ShareCodec.encode(ShareInputs.link)
  #expect(!code.contains("=") && !code.contains("+") && !code.contains("/"))
  let data = try #require(ShareBase64URL.decode(code))
  #expect(String(decoding: data, as: UTF8.self).hasPrefix("{\"v\":1,"))
}

// MARK: - tests/share-link.test.ts の各ケース

/// tests/share-link.test.ts:43-47
@Test func aShareLinkRoundTripsEveryInputIncludingJapaneseText() throws {
  let code = ShareCodec.encode(ShareInputs.link)
  #expect(try JSRegex("\\A[A-Za-z0-9_-]+\\z").test(code), "URL-hash safe")
  #expect(ShareCodec.decode(code) == ShareInputs.link)
}

/// tests/share-link.test.ts:49-61
@Test func aSharedSwissTripKeepsItsCountryAndAirport() throws {
  let input = try #require(ShareInputs.byName["link-swiss"])
  let swiss = try #require(ShareCodec.decode(ShareCodec.encode(input)))
  #expect(swiss.destination == .destination(.switzerland))
  #expect(swiss.arrivalAirport == "ZRH")
  #expect(swiss.departureAirport == "GVA")
}

/// tests/share-link.test.ts:63-99
@Test func garbageAndHostileSharePayloadsAreRejectedOrClamped() throws {
  let file = try ShareVectorFile.load()
  #expect(ShareCodec.decode("not-base64!!") == nil)
  var blank = ShareInputs.link
  blank.itinerary = "   "
  #expect(ShareCodec.decode(ShareCodec.encode(blank)) == nil)

  let oversized = try #require(ShareCodec.decode(try file.decodeVector("hostile-scalars").code))
  #expect(oversized.tripDays == 14)
  #expect(oversized.pace == .balanced)
  // 知らない国は、当てずっぽうではなく自動判定に戻る。
  #expect(oversized.destination == .auto)
  #expect(oversized.arrivalAirport == "none")
  #expect(oversized.arrivalTime == "")

  var forged = ShareInputs.link
  forged.tripStartDate = "2026-02-31"
  forged.dateWasProvided = true
  let forgedConfirmedDate = try #require(ShareCodec.decode(ShareCodec.encode(forged)))
  #expect(forgedConfirmedDate.tripStartDate == "")
  #expect(forgedConfirmedDate.dateWasProvided == false, "an invalid date can never become confirmed by falling back in the UI")

  var nonLeap = ShareInputs.link
  nonLeap.tripStartDate = "2025-02-29"
  nonLeap.dateWasProvided = true
  let nonLeapDay = try #require(ShareCodec.decode(ShareCodec.encode(nonLeap)))
  #expect(nonLeapDay.dateWasProvided == false)
}

/// tests/share-link.test.ts:101-109
@Test func legacyLinksKeepAnInferredDateProvisional() throws {
  let file = try ShareVectorFile.load()
  let decoded = try #require(ShareCodec.decode(try file.decodeVector("legacy-no-date-flag").code))
  #expect(decoded.dateWasProvided == false)
  #expect(decoded.resolutionOverrides == nil, "v1 links without resolution choices stay valid")
}

/// tests/share-link.test.ts:111-129
@Test func providerChoicesSerializeOnlyTheOccurrenceAndPlaceId() throws {
  let file = try ShareVectorFile.load()
  let code = try file.decodeVector("provider-display-fields-stripped").code
  let bytes = try #require(ShareBase64URL.decode(code))
  let wire = try #require(ShareJSON.parse(String(decoding: bytes, as: UTF8.self))?.asObject)
  let overrides = try #require(wire["resolutionOverrides"]?.asArray)
  #expect(overrides.count == 1)
  let first = try #require(overrides.first?.asObject)
  #expect(first.keys == ["inputIndex", "providerRef"])
  #expect(ShareCodec.decode(code)?.resolutionOverrides == [.provider(inputIndex: 0, providerRef: "ChIJ_provider-only_123")])
}

/// tests/share-link.test.ts:131-166
@Test func resolutionChoicesFailClosedDedupeByOccurrenceAndCapAtTwelve() throws {
  let file = try ShareVectorFile.load()
  let decoded = try #require(ShareCodec.decode(try file.decodeVector("hostile-resolution-overrides").code))
  let overrides = try #require(decoded.resolutionOverrides)
  #expect(overrides.count == 12)
  #expect(overrides[0] == .provider(inputIndex: 0, providerRef: "ChIJ_safe_0"))
  #expect(overrides[1] == .manual(
    inputIndex: 1,
    name: "Manual pin",
    address: "Traveller address",
    latitude: 35.1,
    longitude: 139.2
  ))
  #expect(overrides.map(\.inputIndex) == Array(0..<12))
}

// MARK: - 掃除役そのもの

@Test func travellerTextIsFoldedCollapsedAndCutInUtf16() {
  #expect(ShareCodec.cleanTravellerText(.string("ﾊﾟﾝ\t\tケーキ  の  店"), 160) == "パン ケーキ の 店")
  #expect(ShareCodec.cleanTravellerText(.string("  \u{3000}trimmed\u{feff}  "), 160) == "trimmed")
  // 160 は書記素ではなく UTF-16 コード単位で数える。
  #expect(ShareCodec.cleanTravellerText(.string(String(repeating: "あ", count: 200)), 160).utf16.count == 160)
  #expect(ShareCodec.cleanTravellerText(.number(1), 160) == "")
}

@Test func jsNumbersAreWrittenTheWayJavaScriptWritesThem() {
  #expect(JSText.numberString(1e-7) == "1e-7")
  #expect(JSText.numberString(0.1 + 0.2) == "0.30000000000000004")
  #expect(JSText.numberString(90) == "90")
  #expect(JSText.numberString(-180) == "-180")
  #expect(JSText.numberString(-0.000001) == "-0.000001")
  #expect(JSText.numberString(-0.0) == "0")
  #expect(JSText.numberString(1e21) == "1e+21")
  #expect(JSText.numberString(1e20) == "100000000000000000000")
  #expect(JSText.numberString(5e-324) == "5e-324")
  #expect(JSText.numberString(1.7976931348623157e308) == "1.7976931348623157e+308")
}

@Test func mathRoundLeansTowardsPositiveInfinity() {
  #expect(JSText.round(2.5) == 3)
  #expect(JSText.round(-2.5) == -2)
  #expect(JSText.round(0.49999999999999994) == 0)
  #expect(JSText.round(-0.5) == 0)
}

@Test func objectKeysFollowTheJavaScriptOrder() throws {
  let parsed = try #require(ShareJSON.parse("{\"a\":1,\"10\":2,\"2\":3,\"07\":4,\"a\":5}")?.asObject)
  #expect(parsed.keys == ["2", "10", "a", "07"])
  #expect(parsed["a"]?.asNumber == 5, "a later duplicate wins, in the first key's position")
}
