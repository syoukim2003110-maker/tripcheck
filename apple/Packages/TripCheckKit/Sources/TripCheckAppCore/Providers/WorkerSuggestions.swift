import Foundation
import TripCheckKit

/// 「この文字列で Worker にサジェストを尋ねて」に答えられるもの。実物は WorkerClient を包む
/// アダプタ、テストはフェイク。失敗・未認証・タイムアウトは nil(=呼び手は Apple のみ)。
public protocol PlaceSuggesting: Sendable {
  func suggest(query: String, destination: String, languageCode: String) async -> [WorkerPlaceSuggestion]?
}

/// 実物。`any WorkerAuthenticating`(= WorkerClient)を包み、タイプアヘッド用に上限時間を切って
/// `suggestPlaces` を呼ぶ。`WorkerPlaceResolver` の withTaskGroup レースを鏡に、負けは打ち切る。
public struct WorkerSuggestionAdapter: PlaceSuggesting {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(3)) {
    self.client = client
    self.timeout = timeout
  }
  public func suggest(query: String, destination: String, languageCode: String) async -> [WorkerPlaceSuggestion]? {
    let payload = PlaceSuggestionRequestPayload(query: query, languageCode: languageCode, destination: destination)
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: PlaceSuggestionResult?.self) { group in
      group.addTask { await client.suggestPlaces(payload) }
      group.addTask {
        try? await Task.sleep(for: limit)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first?.suggestions
    }
  }
}

/// 検索窓 1 つぶんの Google サジェスト状態。画面は `query` を書き、`results` を読む。
/// `AppleSuggestions` と同じ規律だが、paid・ネットワーク源なので **3 文字最小・より長い
/// デバウンス**。未認証・失敗・タイムアウトは静かに空(Apple 行はそのまま出る)。
@Observable
@MainActor
public final class WorkerSuggestions {
  /// これ未満の長さでは尋ねない(Apple の 2 より 1 段厳しく)。
  public static let minimumQueryLength = 3
  /// 覚えておく問いの数。超えたら古いものから捨てる。
  public static let cacheLimit = 40

  public var query: String = "" {
    didSet {
      guard query != oldValue else { return }
      schedule()
    }
  }
  public private(set) var results: [WorkerPlaceSuggestion] = []

  @ObservationIgnored private let debounce: Duration
  @ObservationIgnored private let source: any PlaceSuggesting
  @ObservationIgnored private var destination: String = DestinationChoice.auto.rawValue
  @ObservationIgnored private var languageCode: String = PlannerLocale.ja.rawValue
  @ObservationIgnored private var cache: [CacheKey: [WorkerPlaceSuggestion]] = [:]
  @ObservationIgnored private var cacheOrder: [CacheKey] = []
  @ObservationIgnored private var pending: Task<Void, Never>?

  public init(debounce: Duration = .milliseconds(700), source: any PlaceSuggesting) {
    self.debounce = debounce
    self.source = source
  }

  /// 合成の根が WorkerClient から作る既定。UI テストは Canned(`suggestPlaces` が常に nil)。
  public convenience init(client: any WorkerAuthenticating) {
    self.init(source: WorkerSuggestionAdapter(client: client))
  }

  /// 行き先・言語を反映する。どちらかが変われば、同じ文字列でも尋ね直す。
  public func configure(destination: DestinationChoice, locale: PlannerLocale) {
    let d = destination.rawValue
    let l = locale.rawValue
    guard d != self.destination || l != self.languageCode else { return }
    self.destination = d
    self.languageCode = l
    schedule()
  }

  /// 画面が出直したときに前の答えを消す(この源は root 常駐で画面と同い年ではない)。
  public func reset() {
    pending?.cancel()
    pending = nil
    results = []
    query = ""
  }

  // MARK: - 内部

  private struct CacheKey: Hashable {
    var query: String
    var destination: String
    var languageCode: String
  }

  private var currentKey: CacheKey? {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count >= Self.minimumQueryLength else { return nil }
    return CacheKey(query: text, destination: destination, languageCode: languageCode)
  }

  private func schedule() {
    pending?.cancel()
    pending = nil
    guard let key = currentKey else {
      // 3 文字未満。前の候補は残さない。
      results = []
      return
    }
    if let remembered = cache[key] {
      results = remembered
      return
    }
    pending = Task { [weak self] in
      guard let self else { return }
      try? await Task.sleep(for: self.debounce)
      guard !Task.isCancelled else { return }
      await self.ask(key)
    }
  }

  private func ask(_ key: CacheKey) async {
    let found = await source.suggest(query: key.query, destination: key.destination, languageCode: key.languageCode)
    guard !Task.isCancelled, key == currentKey else { return }   // 待つ間に打ち替えられた
    guard let found else {
      // 失敗・未認証・タイムアウトは覚えない。Apple は別途出ているので可視の劣化なし。
      results = []
      return
    }
    remember(key, found)
    results = found
  }

  private func remember(_ key: CacheKey, _ found: [WorkerPlaceSuggestion]) {
    if cache[key] == nil { cacheOrder.append(key) }
    cache[key] = found
    while cacheOrder.count > Self.cacheLimit {
      cache[cacheOrder.removeFirst()] = nil
    }
  }
}
