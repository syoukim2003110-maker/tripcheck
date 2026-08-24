import Testing
@testable import TripCheckAppCore
import TripCheckKit

// 通信しない決定的な聞き取り係 —— 入力に依らず同じ答え。UI テストはこの値を前提に書く。
@Test func theCannedParserAlwaysReturnsTheSameIntent() async {
  let expected = TripIntent(
    destination: "金沢", durationText: "3泊", whenText: "", wishes: ["海鮮", "21世紀美術館"])
  #expect(await CannedIntentParser().parse("anything", locale: .ja) == .parsed(expected))
  #expect(await CannedIntentParser().parse("別の入力", locale: .en) == .parsed(expected))
}

// -uiTesting では必ず Canned —— シミュレータのホスト状態に依存させない(spec §4.5)。
@Test func uiTestingAlwaysGetsTheCannedParser() {
  #expect(IntentAvailability.makeDefaultParser(uiTesting: true) as? CannedIntentParser != nil)
}
