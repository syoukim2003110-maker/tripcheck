import Foundation
import TripCheckKit
@testable import TripCheckAppCore

/// 名前を挙げた問い合わせだけ review / unresolved にし、**挙げなかった名前は confirmed にする**。
/// ResolutionPipeline は答えの無い index を `.unresolved(reason: notFoundReason)` にし、`attentionRanks` は
/// review と unresolved を同じ列に数えるので、この契約でないと Task 5 の「4 件目を抑止」が 2 件抑止になる。
struct FakeResolver: PlaceResolver {
  var review: [String] = []
  var unresolved: [String] = []
  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    var out: [Int: PlaceResolution] = [:]
    for q in queries {
      func stop(_ suffix: String, name: String) -> ResolvedStop {
        ResolvedStop(id: "fake-\(q.inputIndex)\(suffix)", name: name, area: "", latitude: 46.9 + Double(q.inputIndex) * 0.01, longitude: 7.4,
                     sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true,
                     input: q.input, inputIndex: q.inputIndex, address: "", countryCode: "CH", provider: .apple)
      }
      if unresolved.contains(q.input) { out[q.inputIndex] = .unresolved(reason: ResolutionPipeline.notFoundReason) }
      else if review.contains(q.input) { out[q.inputIndex] = .review([PlaceCandidate(stop: stop("-a", name: "\(q.input) Old Town")), PlaceCandidate(stop: stop("-b", name: "\(q.input) Museum"))]) }
      else { out[q.inputIndex] = .confirmed(stop("", name: q.input)) }
    }
    return out
  }
}

/// 返事に間の空く相手。**割り込みの競争を毎回同じ形で作る**ためだけに居る —— 解決が
/// 飛んでいる最中にリンクが開く、という順序は、答えが即座に返る `FakeResolver` では作れない。
///
/// 答えは必ず confirmed で、停留所の `input` に**問いの文字列をそのまま**入れる。どの旅の
/// 答えがどの行に着いたのかは、それを見れば後から言い当てられる。
struct SlowResolver: PlaceResolver {
  var delay: Duration = .milliseconds(200)

  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    try? await Task.sleep(for: delay)
    var out: [Int: PlaceResolution] = [:]
    for q in queries {
      out[q.inputIndex] = .confirmed(ResolvedStop(
        id: "slow-\(q.inputIndex)", name: q.input, area: "",
        latitude: 46.9 + Double(q.inputIndex) * 0.01, longitude: 7.4,
        sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60,
        isAnchor: true, input: q.input, inputIndex: q.inputIndex, address: "",
        countryCode: "CH", provider: .apple
      ))
    }
    return out
  }
}

/// 候補を返す端末の地図の代わり。既定は 0 件で、`titles` を挙げるとその見出しの候補を返す
/// —— 検索窓で選ぶ道(選んだ 1 件が行に固定される)をテストから通せるようにするため。
@MainActor final class FakeCompleter: SuggestionCompleting {
  var calls = 0
  var titles: [String] = []

  init(titles: [String] = []) { self.titles = titles }

  func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion] {
    calls += 1
    return titles.map { fakeSuggestion($0) }
  }
}

actor RouteCallLog {
  private(set) var requests: [RouteRequest] = []
  func record(_ request: RouteRequest) { requests.append(request) }
}

/// 経路の疑似提供元。鍵ごとの失敗・遅延・呼び出し記録を持つ。`swift test` は Apple を呼ばない。
struct FakeRouteProvider: RouteProvider {
  var walkMinutes = 9, taxiMinutes = 7, transitMinutes = 12
  var failing: Set<String> = []      // legKey → .failed
  var unroutable: Set<String> = []   // legKey → .unroutable
  var delay: Duration = .milliseconds(20)
  let log = RouteCallLog()

  func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    await log.record(request)
    try? await Task.sleep(for: delay)
    if Task.isCancelled || failing.contains(request.legKey) { return .failed }
    if unroutable.contains(request.legKey) { return .unroutable }
    let mid = GeoPoint(latitude: (request.from.latitude + request.to.latitude) / 2 + 0.002, longitude: (request.from.longitude + request.to.longitude) / 2)
    switch request.mode {
    case .walk: return .measured(minutes: walkMinutes, distanceMeters: 700, geometry: [request.from, mid, request.to], expectedDeparture: nil)
    case .taxi: return .measured(minutes: taxiMinutes, distanceMeters: 2100, geometry: [request.from, mid, request.to], expectedDeparture: request.departure)
    case .transit: return .measured(minutes: transitMinutes, distanceMeters: nil, geometry: nil, expectedDeparture: request.departure)
    }
  }
}

/// 決められた答えを返す聞き取り係。outcome を差し替えて成功も失敗も演じる。
struct FakeIntentParser: IntentParser {
  var outcome: IntentOutcome = .parsed(TripIntent(
    destination: "金沢", durationText: "3泊", whenText: "", wishes: ["海鮮"]))
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome { outcome }
}

/// 呼ばれたことを合図し、放すまで答えを返さない聞き取り係。読みかけ中の割り込みを
/// 決定的に作る(壁時計 sleep は並列スイートで飢えるため使わない —— RouteLatch と同じ教訓)。
actor IntentLatch {
  private var called = false
  private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
  private var callWaiters: [CheckedContinuation<Void, Never>] = []
  private var released = false
  func markCalled() {
    called = true
    for w in callWaiters { w.resume() }
    callWaiters = []
  }
  func waitUntilCalled() async {
    if called { return }
    await withCheckedContinuation { callWaiters.append($0) }
  }
  func release() {
    released = true
    for w in releaseWaiters { w.resume() }
    releaseWaiters = []
  }
  func waitUntilReleased() async {
    if released { return }
    await withCheckedContinuation { releaseWaiters.append($0) }
  }
}

/// ラッチが開くまで答えない聞き取り係。release を await より先に呼ぶこと(ラッチは
/// キャンセルを見ない)。
struct LatchedIntentParser: IntentParser {
  let latch: IntentLatch
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome {
    await latch.markCalled()
    await latch.waitUntilReleased()
    return .parsed(TripIntent(destination: "遅い答え", durationText: "", whenText: "", wishes: ["遅い答え"]))
  }
}

// MARK: - Worker 認証のフェイク(spec 2026-08-25)

struct FakeAttestor: AppAttesting {
  var supported = true
  var keyId = "fake-key-id"
  /// true なら `assert` が `keyInvalid` を投げ、keyId 破棄 → 再登録の自己回復を試させる。
  var assertInvalidates = false

  var isSupported: Bool { supported }
  func generateKey() async throws -> String { keyId }
  func attest(keyId: String, clientDataHash: Data) async throws -> Data { Data("attestation".utf8) }
  func assert(keyId: String, clientDataHash: Data) async throws -> Data {
    if assertInvalidates { throw AppAttestError.keyInvalid }
    return Data("assertion".utf8)
  }
}

/// `URLSession` を使わない通信。`handler` は純粋(状態は呼び出し側の actor に持たせる)。
struct FakeTransport: WorkerTransport {
  let handler: @Sendable (WorkerRequest) async throws -> WorkerResponse
  func send(_ request: WorkerRequest, baseURL: URL) async throws -> WorkerResponse {
    try await handler(request)
  }
}

final class InMemoryAttestKeyStore: AttestKeyStore, @unchecked Sendable {
  private let lock = NSLock()
  private var keyId: String?
  init(keyId: String? = nil) { self.keyId = keyId }
  func loadKeyId() throws -> String? { lock.withLock { keyId } }
  func saveKeyId(_ keyId: String) throws { lock.withLock { self.keyId = keyId } }
  func deleteKeyId() throws { lock.withLock { self.keyId = nil } }
  var storedKeyId: String? { lock.withLock { keyId } }
}

// MARK: - 天気のフェイク(spec 2026-08-25)

struct FakeWeatherProvider: WeatherProviding {
  /// 返す固定の日々(index はテストが要求に合わせて渡す)。
  var days: [WeatherDay] = []
  var attribution: WeatherAttribution? = WeatherAttribution(
    legalPageURL: URL(string: "https://weatherkit.apple.com/legal-attribution.html")!
  )
  /// 答えを返すまでの間(世代ガードのテストが遅れて届く答えを作るため)。既定は即答。
  var delay: Duration = .zero
  /// 呼ばれた要求を記録(世代ガードやスキップ判定の検証用)。
  final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var lastRequests: [WeatherDayRequest] = []
    func record(_ r: [WeatherDayRequest]) { lock.withLock { lastRequests = r } }
  }
  var recorder = Recorder()
  func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult {
    recorder.record(requests)
    if delay > .zero { try? await Task.sleep(for: delay) }
    let mapped = requests.compactMap { req in days.first { $0.index == req.index } }
    return mapped.isEmpty ? .empty : WeatherResult(days: mapped, attribution: attribution)
  }
}
