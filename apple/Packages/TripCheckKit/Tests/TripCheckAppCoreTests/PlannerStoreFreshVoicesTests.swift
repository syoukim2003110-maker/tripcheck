import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private final class FakeFresh: FreshVoicesProviding {
  var calls = 0
  var lastPayload: FreshVoicesRequestPayload?
  var answer: FreshVoicesResult?
  var sleep: Duration?
  init(answer: FreshVoicesResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? {
    calls += 1; lastPayload = payload
    if let sleep { try? await Task.sleep(for: sleep) }
    return answer
  }
}

private func result() -> FreshVoicesResult {
  FreshVoicesResult(provider: "anthropic_web_search", checkedAt: "t", intent: "place", depth: "quick",
    summary: "Buzzing.", findings: [FreshFinding(title: "T", url: "https://x.example", note: "n",
      age: "2 days ago", isRecent: true, sourceKind: "news")])
}

@MainActor private func store(_ provider: (any FreshVoicesProviding)?) -> PlannerStore {
  PlannerStore(resolvers: [], store: nil, freshVoicesProvider: provider)
}

@Test @MainActor func freshLoadsAndMapsPayload() async throws {
  let fake = FakeFresh(answer: result())
  let s = store(fake)
  s.beginFreshVoices(stopId: "s1", name: "Kaffee", area: "Bern")
  #expect(s.freshVoicesByStop["s1"] == .loading)
  await s.freshVoicesTasks["s1"]?.value
  guard case .loaded(let r) = s.freshVoicesByStop["s1"] else { return #expect(Bool(false)) }
  #expect(r.summary == "Buzzing.")
  #expect(r.findings.first?.sourceKind == "news")
  #expect(fake.lastPayload?.name == "Kaffee")
  #expect(fake.lastPayload?.area == "Bern")
  #expect(fake.lastPayload?.intent == "place")
  #expect(fake.lastPayload?.depth == "quick")
  #expect(fake.lastPayload?.languageCode == "ja")
  #expect(fake.lastPayload?.destination == s.request.destination.rawValue)
}

@Test @MainActor func freshNilResultBecomesUnavailable() async throws {
  let s = store(FakeFresh(answer: nil))
  s.beginFreshVoices(stopId: "s1", name: "K", area: "B")
  await s.freshVoicesTasks["s1"]?.value
  #expect(s.freshVoicesByStop["s1"] == .unavailable)
}

@Test @MainActor func freshIsIdempotentWhileLoadingOrLoaded() async throws {
  let fake = FakeFresh(answer: result())
  let s = store(fake)
  s.loadFreshVoices(stopId: "s1", name: "K", area: "B")   // sets .loading, launches the task
  s.loadFreshVoices(stopId: "s1", name: "K", area: "B")   // .loading → no-op (no second task)
  await s.freshVoicesTasks["s1"]?.value
  s.loadFreshVoices(stopId: "s1", name: "K", area: "B")   // .loaded → no-op
  #expect(fake.calls == 1)
}

@Test @MainActor func freshStaleResultDroppedByGenerationGuard() async throws {
  let fake = FakeFresh(answer: result(), sleep: .milliseconds(80))
  let s = store(fake)
  s.beginFreshVoices(stopId: "s1", name: "K", area: "B")
  let running = s.freshVoicesTasks["s1"]
  s.invalidateFreshVoices()
  #expect(s.freshVoicesByStop.isEmpty)
  await running?.value
  #expect(s.freshVoicesByStop["s1"] == nil)
}

@Test @MainActor func freshNilProviderIsImmediatelyUnavailable() async {
  let s = store(nil)
  s.beginFreshVoices(stopId: "s1", name: "K", area: "B")
  #expect(s.freshVoicesByStop["s1"] == .unavailable)
}
