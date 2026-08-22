import Foundation

/*
 * 端末内に置いた旅程の記録と、その出し入れ。
 *
 * 移植元は `lib/trip-store.ts`:`StoredTripRecord` `:27-34`、`SaveTripRecord` `:36-40`、
 * `cloneRecord` `:206-216`、`validId`/`validTitle`/`validTimestamp` `:218-232`、
 * `compareNewest` `:234`、`TripStoreFacade.save` `:501-517`、`TRIP_STORE_MAX_RECORDS` `:12`。
 *
 * Web は IndexedDB(と localStorage からの移行)だったが、こちらはファイル 1 件 1 枚。
 * `<directory>/trips/<id>.json` に書き、書き込みは一時ファイル → `replaceItemAt` の置き換えで
 * 途中の姿を残さない。TS の `putMany(records, maximum)` `:262-268` にあたる「新しい 10 件だけ
 * 残す」は、書いたあとに古い順から消して合わせる。
 */

/// TS `StoredTripRecord`(`lib/trip-store.ts:27-34`)。
public struct StoredTripRecord: Codable, Equatable, Sendable {
  public let id: String
  public let schemaVersion: Int
  public let title: String
  public let createdAt: String
  public let updatedAt: String
  public let payload: UserTripPayload

  /// TS のリテラル型 `schemaVersion: 1`(`:29`)。
  public static let currentSchemaVersion = 1

  init(id: String, title: String, createdAt: String, updatedAt: String, payload: UserTripPayload) {
    self.id = id
    self.schemaVersion = StoredTripRecord.currentSchemaVersion
    self.title = title
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.payload = payload
  }

  // MARK: - 欄ごとの検査(`lib/trip-store.ts:218-232`)

  /// TS `validId`(`:218-222`)+ ファイル名として使うぶんの上乗せ。
  ///
  /// TS の id は IndexedDB の鍵なので何でも通ったが、こちらは `<id>.json` というファイル名に
  /// なる。区切り文字と NUL、それに `.`/`..` は、保存先の外を指せてしまうので**意図的に**
  /// 弾く(移植元との差)。
  public static func validId(_ value: String) throws -> String {
    let id = JSText.trim(value)
    guard !id.isEmpty, id.utf16.count <= 200 else {
      throw TripStoreError.invalidRecord("Stored trip id must be 1–200 characters.")
    }
    guard !id.contains("/"), !id.contains("\\"), !id.unicodeScalars.contains("\0"), id != ".", id != ".." else {
      throw TripStoreError.invalidRecord("Stored trip id must not contain path separators or path components.")
    }
    return id
  }

  /// TS `validTitle`(`:224-228`)。長さは JS の `.length` に合わせて UTF-16 の単位で数える。
  public static func validTitle(_ value: String) throws -> String {
    let title = JSText.trim(value)
    guard !title.isEmpty, title.utf16.count <= 160 else {
      throw TripStoreError.invalidRecord("Stored trip title must be 1–160 characters.")
    }
    return title
  }

  /// TS `validTimestamp`(`:230-232`)。読めた時刻を `new Date(ms).toISOString()` の形
  /// —— `YYYY-MM-DDTHH:mm:ss.SSSZ`、UTC —— に書き直す。
  ///
  /// TS の `Date.parse` は RFC 2822 まで飲むが、こちらが受けるのは ISO 8601(小数秒あり/なし)と
  /// 日付だけの `YYYY-MM-DD` の 3 つ。記録に入るのは自分で書いた `toISOString` の形だけなので、
  /// 狭いほうに倒してある。
  public static func validTimestamp(_ value: String) throws -> String {
    guard !value.isEmpty, let date = parseTimestamp(value) else {
      throw TripStoreError.invalidRecord("Stored trip timestamps must be valid ISO-compatible dates.")
    }
    return Feasibility.nowISO8601(date)
  }

  static func parseTimestamp(_ value: String) -> Date? {
    let candidates: [ISO8601DateFormatter.Options] = [
      [.withInternetDateTime, .withFractionalSeconds],
      [.withInternetDateTime],
      [.withFullDate],
    ]
    for options in candidates {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = options
      formatter.timeZone = TimeZone(secondsFromGMT: 0)
      if let date = formatter.date(from: value) { return date }
    }
    return nil
  }

  /// TS `compareNewest`(`:234`)。新しいものが先、同じ時刻なら id の照合順。
  /// 負なら `left` が先。
  public static func compareNewest(_ left: StoredTripRecord, _ right: StoredTripRecord) -> Int {
    let leftTime = parseTimestamp(left.updatedAt)?.timeIntervalSince1970 ?? 0
    let rightTime = parseTimestamp(right.updatedAt)?.timeIntervalSince1970 ?? 0
    if leftTime != rightTime { return rightTime > leftTime ? 1 : -1 }
    return jsLocaleCompare(left.id, right.id)
  }

  // MARK: - Codable

  enum CodingKeys: String, CodingKey {
    case id, schemaVersion, title, createdAt, updatedAt, payload
  }

  /// TS `cloneRecord`(`:206-216`)。ディスクの 1 枚を読むたび、版・id・題・時刻・荷物を
  /// 全部検査し直す。落ちた記録は `TripStore` が飛ばす。
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(Int.self, forKey: .schemaVersion)
    guard version == StoredTripRecord.currentSchemaVersion else {
      throw TripStoreError.invalidRecord("Unsupported stored trip record version.")
    }
    self.schemaVersion = version
    self.id = try StoredTripRecord.validId(container.decode(String.self, forKey: .id))
    self.title = try StoredTripRecord.validTitle(container.decode(String.self, forKey: .title))
    self.createdAt = try StoredTripRecord.validTimestamp(container.decode(String.self, forKey: .createdAt))
    self.updatedAt = try StoredTripRecord.validTimestamp(container.decode(String.self, forKey: .updatedAt))
    self.payload = try container.decode(UserTripPayload.self, forKey: .payload)
  }
}

/// TS `SaveTripRecord`(`lib/trip-store.ts:36-40`)。`id` が無ければ `idFactory` が作る。
public struct SaveTripRecord: Codable, Equatable, Sendable {
  public var id: String?
  public var title: String
  public var payload: UserTripPayload

  public init(id: String? = nil, title: String, payload: UserTripPayload) {
    self.id = id
    self.title = title
    self.payload = payload
  }
}

/// TS `TripStore`(`lib/trip-store.ts:75-83`)のファイル版。
///
/// TS にあって無いもの:IndexedDB の可否で変わる `status`、localStorage からの移行、
/// memory への退避(`:396-489`)。どれもブラウザの事情で、端末のファイルには相手がいない。
public actor TripStore {
  /// TS `TRIP_STORE_MAX_RECORDS`(`:12`)。
  public static let maxRecords = 10

  /// 記録が置かれる場所。`init` に渡した場所の下の `trips/`。
  private let directory: URL
  private let maxRecords: Int
  private let now: @Sendable () -> Date
  private let idFactory: @Sendable () -> String

  /// TS `CreateTripStoreOptions.now` / `.idFactory`(`:70-76`)。テストが時計と id を握れる。
  public init(
    directory: URL,
    maxRecords: Int = TripStore.maxRecords,
    now: @Sendable @escaping () -> Date = { Date() },
    idFactory: @Sendable @escaping () -> String = { UUID().uuidString }
  ) {
    self.directory = directory.appendingPathComponent("trips", isDirectory: true)
    self.maxRecords = maxRecords
    self.now = now
    self.idFactory = idFactory
  }

  // MARK: - 読み

  /// TS `list`(`:522-524`)。`updatedAt` の新しい順、同じなら id の照合順。読めない/検査に
  /// 落ちたファイルは**消さずに**飛ばす。
  public func list() -> [StoredTripRecord] {
    storedRecords().map(\.record)
  }

  /// TS `get`(`:518-520`)。TS は id が不正なら投げるが、こちらはファイル名にできない id を
  /// 「その記録は無い」として `nil` を返す。
  public func load(id: String) -> StoredTripRecord? {
    guard let id = try? StoredTripRecord.validId(id) else { return nil }
    return readRecord(at: fileURL(for: id))
  }

  // MARK: - 書き

  /// TS `save`(`:501-517`)。既にある id なら `createdAt` を引き継ぎ、`updatedAt` だけ進める。
  /// 書いたあと、`maxRecords` を超えた古いものを落とす(TS `putMany(…, maximum)` `:262-268`)。
  @discardableResult
  public func save(_ record: SaveTripRecord) throws -> StoredTripRecord {
    let id = try StoredTripRecord.validId(record.id ?? idFactory())
    let title = try StoredTripRecord.validTitle(record.title)
    let payload = try UserTripPayload.validate(record.payload.jsonValue)
    let timestamp = try StoredTripRecord.validTimestamp(Feasibility.nowISO8601(now()))
    let existing = readRecord(at: fileURL(for: id))
    let stored = StoredTripRecord(
      id: id,
      title: title,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      payload: payload
    )
    try write(stored)
    try prune()
    return stored
  }

  /// TS `delete`(`:526-528`)。消せたら `true`、元から無ければ `false`。
  @discardableResult
  public func delete(id: String) throws -> Bool {
    let id = try StoredTripRecord.validId(id)
    let url = fileURL(for: id)
    guard FileManager.default.fileExists(atPath: url.path) else { return false }
    do {
      try FileManager.default.removeItem(at: url)
    } catch {
      throw TripStoreError.ioFailure(error)
    }
    return true
  }

  // MARK: - ファイル

  private func fileURL(for id: String) -> URL {
    directory.appendingPathComponent("\(id).json", isDirectory: false)
  }

  private func readRecord(at url: URL) -> StoredTripRecord? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(StoredTripRecord.self, from: data)
  }

  /// ディスクにある読める記録を、新しい順に。並べる前の入力順もファイル名で決めておく
  /// —— `contentsOfDirectory` の順はファイルシステム任せで、実行ごとに変わりうる。
  private func storedRecords() -> [(url: URL, record: StoredTripRecord)] {
    guard let urls = try? FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    ) else { return [] }
    var entries: [(url: URL, record: StoredTripRecord)] = []
    for url in urls.sorted(by: { jsStringLess($0.lastPathComponent, $1.lastPathComponent) })
    where url.pathExtension == "json" {
      guard let record = readRecord(at: url) else { continue }
      entries.append((url, record))
    }
    return stableSorted(entries) { StoredTripRecord.compareNewest($0.record, $1.record) < 0 }
  }

  /// 一時ファイルへ書いてから置き換える。置き換え先が無いときは移すだけ
  /// (`replaceItemAt` は元が無いと失敗する)。
  private func write(_ record: StoredTripRecord) throws {
    let manager = FileManager.default
    let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp", isDirectory: false)
    do {
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      try encoder.encode(record).write(to: temporary, options: .atomic)
      let destination = fileURL(for: record.id)
      if manager.fileExists(atPath: destination.path) {
        _ = try manager.replaceItemAt(destination, withItemAt: temporary)
      } else {
        try manager.moveItem(at: temporary, to: destination)
      }
    } catch {
      try? manager.removeItem(at: temporary)
      throw TripStoreError.ioFailure(error)
    }
  }

  /// TS `putMany(records, maximum)` `:262-268` の「新しい `maximum` 件だけ残す」。
  private func prune() throws {
    let entries = storedRecords()
    guard entries.count > maxRecords else { return }
    for entry in entries.dropFirst(maxRecords) {
      do {
        try FileManager.default.removeItem(at: entry.url)
      } catch {
        throw TripStoreError.ioFailure(error)
      }
    }
  }
}
