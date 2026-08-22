import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/trip-store.ts` の移植の検証。
 *
 * `tests/trip-store.test.ts` から移せるものは移した ——「新しい 10 件だけ残る」`:150-163`、
 * 「プロバイダの中身とビルド済みプランは保存前に断る」`:165-186`、共有コードの往復 `:98-148`。
 * IndexedDB の可否と localStorage からの移行(`:188-250`)はブラウザの事情なので相手がいない。
 *
 * 時計は必ず注いでいる。実時計はミリ秒までしか刻まないので、続けて 12 回保存すると `updatedAt`
 * が並び、順は id の照合順に落ちて「Trip 11 が先頭」が揺れる。1 秒ずつ進む時計ならそれが起きない。
 */

// MARK: - 道具

/// 1 ずつ増える数。時計と id の両方に使う。
private final class TripStoreTicks: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func next() -> Int {
    lock.lock()
    defer { lock.unlock() }
    value += 1
    return value
  }
}

private func makeTemporaryDirectory() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("tripstore-\(UUID().uuidString)", isDirectory: true)
}

/// `tests/trip-store.test.ts:13-18` の `payload(days)`。
private func tripPayload(days: Int) throws -> UserTripPayload {
  try UserTripPayload.validate(
    input: ["itinerary": .string("Senso-ji\nTokyo Skytree"), "tripDays": .number(Double(days))],
    edits: ["dayStartTimes": .object(["0": .string("09:00")]), "removedStopIds": .array([])]
  )
}

/// 1 秒ずつ進む時計と `trip-1`, `trip-2`, … の id を持つ記憶域。
private func makeStore(at directory: URL, maxRecords: Int = TripStore.maxRecords) throws -> TripStore {
  let base = try #require(StoredTripRecord.parseTimestamp("2026-08-01T00:00:00.000Z"))
  let ticks = TripStoreTicks()
  let ids = TripStoreTicks()
  return TripStore(
    directory: directory,
    maxRecords: maxRecords,
    now: { base.addingTimeInterval(Double(ticks.next())) },
    idFactory: { "trip-\(ids.next())" }
  )
}

/// 断られること**と**その文面を見る。TS 側の `assert.throws(..., /only input and edits/)` と
/// 同じ語で照合する。
private func expectPayloadRejection(_ value: JSONValue, saying fragment: String) {
  do {
    _ = try UserTripPayload.validate(value)
    Issue.record("expected the payload to be rejected with \"\(fragment)\"")
  } catch let error as TripStoreError {
    #expect(error.message.contains(fragment), "got \"\(error.message)\"")
  } catch {
    Issue.record("expected TripStoreError, got \(error)")
  }
}

// MARK: - 荷物の検査

@Test func payloadAcceptsOnlyInputAndEdits() {
  #expect(throws: TripStoreError.self) { try UserTripPayload.validate(.object(["input": .object([:])])) }
  #expect(throws: TripStoreError.self) {
    try UserTripPayload.validate(.object(["input": .object([:]), "edits": .object([:]), "plan": .object([:])]))
  }
  #expect(throws: TripStoreError.self) { try UserTripPayload.validate(.array([])) }
  #expect(throws: TripStoreError.self) {
    try UserTripPayload.validate(.object(["input": .string("Senso-ji"), "edits": .object([:])]))
  }
  #expect(throws: Never.self) {
    try UserTripPayload.validate(.object(["input": .object(["itinerary": .string("Senso-ji")]), "edits": .object([:])]))
  }

  let payload = try? UserTripPayload.validate(input: ["itinerary": .string("Senso-ji")], edits: [:])
  #expect(payload?.input["itinerary"] == .string("Senso-ji"))
  #expect(payload?.edits.isEmpty == true)
}

@Test func payloadRejectsProviderDisplayDataAnywhere() {
  let nested: JSONValue = .object([
    "input": .object(["stops": .array([.object(["id": .string("x"), "openingHours": .array([])])])]),
    "edits": .object([:]),
  ])
  #expect(throws: TripStoreError.self) { try UserTripPayload.validate(nested) }
}

/// `tests/trip-store.test.ts:165-186`。関数と `Date` の枝は `JSONValue` に相当が無いので、
/// 移せる 3 つを文面ごと写す。
@Test func rejectsProviderDataAndBuiltPlansBeforeStorage() {
  expectPayloadRejection(
    .object([
      "input": .object(["itinerary": .string("Tokyo")]),
      "edits": .object([:]),
      "plan": .object(["days": .array([])]),
    ]),
    saying: "only input and edits"
  )
  expectPayloadRejection(
    .object([
      "input": .object(["resolvedStops": .array([.object(["formattedAddress": .string("provider-owned")])])]),
      "edits": .object([:]),
    ]),
    saying: "cannot be persisted"
  )
  expectPayloadRejection(
    .object([
      "input": .object(["itinerary": .string("Tokyo")]),
      "edits": .object(["candidate": .object([
        "stops": .array([]),
        "legs": .array([]),
        "startTime": .string("09:00"),
      ])]),
    ]),
    saying: "built or scheduled trip plan"
  )
}

/// `lib/trip-store.ts:94-123` の 32 個 + 統合仕様 §5.5 の 4 個。数と中身の両方を見ておかないと、
/// 足すつもりが差し替えになっていても気付けない。
@Test func forbiddenKeysCoverTheTypeScriptListAndTheSpecExtras() {
  let typeScriptKeys: Set<String> = [
    "builttripplan", "scheduleddays", "baserecommendations", "foodrecommendationslots",
    "resolvedstops", "resolvedbase", "routegeometry", "routegeometrybyday", "livetransit",
    "livewalking", "livedriving", "liverouteevidence", "providersnapshothash", "providerresponse",
    "providerevidence", "criticalfacts", "openingwindowsbyday", "openinghours",
    "regularopeningperiods", "currentopeningperiods", "formattedaddress", "googlemapsurl",
    "googlemapsuri", "businessstatus", "placetypes", "rating", "userratingcount", "sourceurl",
    "verifiedat", "photo", "photos", "reviews",
  ]
  let specExtras: Set<String> = ["displayname", "providersnapshot", "livetransitminutes", "routes"]

  #expect(typeScriptKeys.count == 32)
  #expect(UserTripPayload.forbiddenKeys.count == 36)
  #expect(typeScriptKeys.isSubset(of: UserTripPayload.forbiddenKeys))
  #expect(specExtras.isSubset(of: UserTripPayload.forbiddenKeys))
  // 案にあった `plan` / `days` は入れない。Web が持たせている入力は `tripDays` などで、
  // `days` を禁じると通るはずのものが通らなくなる。
  #expect(!UserTripPayload.forbiddenKeys.contains("plan"))
  #expect(!UserTripPayload.forbiddenKeys.contains("days"))
  #expect(throws: Never.self) {
    try UserTripPayload.validate(input: ["tripDays": .number(3)], edits: ["days": .number(3)])
  }
}

/// TS の正規化(`:159`)—— 記号を落として小文字にしてから照合する。
@Test func forbiddenKeysAreMatchedAfterNormalisation() {
  #expect(UserTripPayload.normalizedKey("Opening-Hours") == "openinghours")
  #expect(UserTripPayload.normalizedKey("provider_snapshot") == "providersnapshot")
  #expect(UserTripPayload.normalizedKey("  display name  ") == "displayname")
  #expect(UserTripPayload.normalizedKey("日本語") == "")

  for key in ["Opening-Hours", "opening_hours", "OPENINGHOURS", "display Name", "route Geometry"] {
    expectPayloadRejection(
      .object(["input": .object([key: .array([])]), "edits": .object([:])]),
      saying: "cannot be persisted"
    )
  }
  // 記号を落とした形が禁止語に当たらなければ通る。
  #expect(throws: Never.self) {
    try UserTripPayload.validate(input: ["opening-notes": .string("closed Mondays")], edits: [:])
  }
}

/// `lib/trip-store.ts:125-127` と `:196-202`。
@Test func payloadLimitsRejectDeepLargeAndNonFiniteValues() {
  var deep: JSONValue = .string("bottom")
  for _ in 0..<20 { deep = .array([deep]) }
  expectPayloadRejection(
    .object(["input": .object(["nest": deep]), "edits": .object([:])]),
    saying: "too deeply nested or contains too many values"
  )

  let wide = JSONValue.array((0..<9_000).map { .number(Double($0)) })
  expectPayloadRejection(
    .object(["input": .object(["many": wide]), "edits": .object([:])]),
    saying: "too deeply nested or contains too many values"
  )

  expectPayloadRejection(
    .object(["input": .object(["latitude": .number(.infinity)]), "edits": .object([:])]),
    saying: "must be finite"
  )

  let huge = String(repeating: "a", count: UserTripPayload.maxPayloadBytes + 1)
  do {
    _ = try UserTripPayload.validate(input: ["itinerary": .string(huge)], edits: [:])
    Issue.record("expected the oversized payload to be rejected")
  } catch let error as TripStoreError {
    guard case .tooLarge = error else {
      Issue.record("expected .tooLarge, got \(error)")
      return
    }
  } catch {
    Issue.record("expected TripStoreError, got \(error)")
  }

  // 上限のすぐ下は通る。`{"edits":{},"input":{"itinerary":"…"}}` の外枠が 38 バイト。
  #expect(throws: Never.self) {
    try UserTripPayload.validate(
      input: ["itinerary": .string(String(repeating: "a", count: UserTripPayload.maxPayloadBytes - 100))],
      edits: [:]
    )
  }
}

// MARK: - 記録の欄

@Test func titleAndIdAreBounded() throws {
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validTitle(String(repeating: "a", count: 161)) }
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validTitle("   ") }
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validId("") }
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validId(String(repeating: "a", count: 201)) }
  #expect(try StoredTripRecord.validTitle("  Tokyo  ") == "Tokyo")
  #expect(try StoredTripRecord.validId("  trip-1  ") == "trip-1")
  #expect(try StoredTripRecord.validTitle(String(repeating: "a", count: 160)).count == 160)
}

/// id はファイル名になる。TS(IndexedDB の鍵)には無い上乗せで、保存先の外を指せる形は断る。
@Test func pathUnsafeIdsAreRejected() async throws {
  for id in ["../escape", "a/b", "a\\b", "..", "."] {
    #expect(throws: TripStoreError.self) { try StoredTripRecord.validId(id) }
  }

  let directory = makeTemporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try makeStore(at: directory)
  await #expect(throws: TripStoreError.self) {
    try await store.save(SaveTripRecord(id: "../escape", title: "Escape", payload: try tripPayload(days: 2)))
  }
  #expect(await store.load(id: "../escape") == nil)
  #expect(await store.list().isEmpty)
}

/// `lib/trip-store.ts:230-232`。読めた時刻は `toISOString` の形に書き直される。
@Test func timestampsAreNormalisedToTheJavaScriptShape() throws {
  #expect(try StoredTripRecord.validTimestamp("2026-08-01T00:00:00Z") == "2026-08-01T00:00:00.000Z")
  #expect(try StoredTripRecord.validTimestamp("2026-08-01T09:00:00+09:00") == "2026-08-01T00:00:00.000Z")
  #expect(try StoredTripRecord.validTimestamp("2026-08-01T00:00:00.123Z") == "2026-08-01T00:00:00.123Z")
  #expect(try StoredTripRecord.validTimestamp("2026-08-01") == "2026-08-01T00:00:00.000Z")
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validTimestamp("") }
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validTimestamp("last Tuesday") }
}

// MARK: - 記憶域

@Test func storeKeepsTenMostRecentAndSurvivesRelaunch() async throws {
  let directory = makeTemporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try makeStore(at: directory)

  for index in 0..<12 {
    _ = try await store.save(SaveTripRecord(
      id: nil,
      title: "Trip \(index)",
      payload: try UserTripPayload.validate(.object([
        "input": .object(["n": .number(Double(index))]),
        "edits": .object([:]),
      ]))
    ))
  }

  let list = await store.list()
  #expect(list.count == 10)
  #expect(list.first?.title == "Trip 11")
  #expect(list.last?.title == "Trip 2")
  #expect(!list.contains { $0.title == "Trip 0" })
  #expect(!list.contains { $0.title == "Trip 1" })

  // 立ち上げ直しても同じ 10 件。
  let again = try makeStore(at: directory)
  #expect(await again.list().count == 10)
  #expect(await again.load(id: list[0].id)?.title == "Trip 11")
  try await again.delete(id: list[0].id)
  #expect(await again.list().count == 9)
  #expect(await again.load(id: list[0].id) == nil)
  #expect(try await again.delete(id: list[0].id) == false)
}

/// `tests/trip-store.test.ts:150-163`。
@Test func keepsOnlyTheTenNewestLocalTrips() async throws {
  let directory = makeTemporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try makeStore(at: directory)

  for index in 1...13 {
    _ = try await store.save(SaveTripRecord(title: "Trip \(index)", payload: try tripPayload(days: index)))
  }

  let records = await store.list()
  #expect(records.count == TripStore.maxRecords)
  #expect(records.first?.title == "Trip 13")
  #expect(records.last?.title == "Trip 4")
  // 消えた 3 件のファイルも残っていない。
  let files = try FileManager.default.contentsOfDirectory(
    at: directory.appendingPathComponent("trips"),
    includingPropertiesForKeys: nil
  )
  #expect(files.filter { $0.pathExtension == "json" }.count == 10)
}

/// `lib/trip-store.ts:501-517`。同じ id への保存は `createdAt` を引き継ぎ、`updatedAt` だけ進める。
@Test func savingAnExistingIdKeepsCreatedAt() async throws {
  let directory = makeTemporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try makeStore(at: directory)

  let first = try await store.save(SaveTripRecord(title: "Tokyo", payload: try tripPayload(days: 3)))
  #expect(first.id == "trip-1")
  #expect(first.createdAt == first.updatedAt)

  let updated = try await store.save(SaveTripRecord(id: first.id, title: "Tokyo revised", payload: try tripPayload(days: 4)))
  #expect(updated.id == first.id)
  #expect(updated.createdAt == first.createdAt)
  #expect(updated.updatedAt != first.updatedAt)
  #expect(updated.title == "Tokyo revised")
  #expect(await store.list().count == 1)
  #expect(await store.load(id: first.id)?.payload.input["tripDays"] == .number(4))
  #expect(await store.load(id: first.id)?.schemaVersion == 1)
}

/// 読めないファイル・検査に落ちるファイルは飛ばすだけで、消さない。
@Test func unreadableRecordFilesAreSkippedAndKept() async throws {
  let directory = makeTemporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try makeStore(at: directory)
  _ = try await store.save(SaveTripRecord(title: "Tokyo", payload: try tripPayload(days: 3)))

  let trips = directory.appendingPathComponent("trips")
  let broken = trips.appendingPathComponent("broken.json")
  try Data("not json".utf8).write(to: broken)
  // 版が違う記録、禁止キーを持ち込まれた記録、時刻が壊れた記録。
  let wrongVersion = trips.appendingPathComponent("wrong-version.json")
  try Data(#"{"id":"wrong-version","schemaVersion":2,"title":"Old","createdAt":"2026-08-01T00:00:00.000Z","updatedAt":"2026-08-01T00:00:00.000Z","payload":{"input":{},"edits":{}}}"#.utf8).write(to: wrongVersion)
  let tampered = trips.appendingPathComponent("tampered.json")
  try Data(#"{"id":"tampered","schemaVersion":1,"title":"Tampered","createdAt":"2026-08-01T00:00:00.000Z","updatedAt":"2026-08-01T00:00:00.000Z","payload":{"input":{"reviews":[]},"edits":{}}}"#.utf8).write(to: tampered)

  let records = await store.list()
  #expect(records.count == 1)
  #expect(records.first?.title == "Tokyo")
  #expect(await store.load(id: "tampered") == nil)
  #expect(await store.load(id: "wrong-version") == nil)
  for url in [broken, wrongVersion, tampered] {
    #expect(FileManager.default.fileExists(atPath: url.path), "\(url.lastPathComponent) must be kept, not deleted")
  }
}

/// 全体規約:Kit のソースが import してよいのは `Foundation` だけ(UIKit / SwiftUI / MapKit /
/// CoreLocation は端末側の都合で、エンジンには持ち込まない)。ここだけはファイルそのものを読む
/// —— `#filePath` からパッケージの根を辿り、`Sources/TripCheckKit` の `import` 行を全部見る。
@Test func kitSourcesImportFoundationOnly() throws {
  let packageRoot = URL(fileURLWithPath: #filePath)   // …/Tests/TripCheckKitTests/Units/TripStoreTests.swift
    .deletingLastPathComponent()                      // …/Units
    .deletingLastPathComponent()                      // …/TripCheckKitTests
    .deletingLastPathComponent()                      // …/Tests
    .deletingLastPathComponent()                      // …/TripCheckKit
  let sources = packageRoot.appendingPathComponent("Sources/TripCheckKit", isDirectory: true)
  // ソースの無い場所(配布されたバイナリなど)で走らせたときは何も言わない。
  guard FileManager.default.fileExists(atPath: sources.path) else { return }

  let walker = try #require(FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil))
  var scanned = 0
  for case let url as URL in walker where url.pathExtension == "swift" {
    scanned += 1
    let text = try String(contentsOf: url, encoding: .utf8)
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard trimmed.hasPrefix("import ") else { continue }
      #expect(trimmed == "import Foundation", "\(url.lastPathComponent) imports more than Foundation: \(trimmed)")
    }
  }
  #expect(scanned >= 60, "the walk must actually reach the Kit's sources")
}

/// `tests/trip-store.test.ts:98-148`。保存するのは共有**コード**であって構造体ではない
/// —— 端末に置くのは利用者が書いた入力だけ、という約束はコードの中身にも効いている。
@Test func shareCodesRoundTripThroughTheStore() async throws {
  let overrides: [ResolutionOverride] = [
    .provider(inputIndex: 0, providerRef: "ChIJ_stable_choice"),
    .manual(
      inputIndex: 1,
      name: "Traveller pin",
      address: "Traveller-authored address",
      latitude: 35.6,
      longitude: 139.7
    ),
  ]
  let shareInput = ShareableTripInput(
    destination: .destination(.japan),
    itinerary: "Synthetic provider place\nSynthetic manual place",
    tripDays: 2,
    tripStartDate: "2026-09-14",
    dateWasProvided: true,
    hotelQuery: "",
    pace: .balanced,
    mealPlan: .none,
    travelPreference: .auto,
    arrivalAirport: "none",
    arrivalTime: "",
    departureAirport: "none",
    departureTime: "",
    flightKind: .international,
    dayStartDefault: "09:00",
    dayEndTarget: "22:00",
    transferBufferMinutes: 10,
    resolutionOverrides: overrides
  )
  let shareCode = ShareCodec.encode(shareInput)

  let directory = makeTemporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try makeStore(at: directory)
  let stored = try await store.save(SaveTripRecord(
    title: "Shared choices",
    payload: try UserTripPayload.validate(input: ["shareCode": .string(shareCode)], edits: [:])
  ))

  let restored = await store.load(id: stored.id)
  guard case .string(let restoredCode)? = restored?.payload.input["shareCode"] else {
    Issue.record("the stored payload must hold the share code as a string")
    return
  }
  #expect(restoredCode == shareCode)
  let decoded = try #require(ShareCodec.decode(restoredCode))
  #expect(decoded.resolutionOverrides == overrides)
  #expect(decoded.itinerary == shareInput.itinerary)
  #expect(decoded.tripDays == 2)
  #expect(decoded.tripStartDate == "2026-09-14")
}
