import Testing
@testable import TripCheckKit

// 「文らしさ」判定 —— spec §4.1 の表そのまま。行を出すかを毎キー入力で決めるので純粋・即答。
@Test func aBarePlaceNameIsNotASentence() {
  #expect(!IntentTrigger.looksLikeTripSentence("金沢"))
  #expect(!IntentTrigger.looksLikeTripSentence(""))
  #expect(!IntentTrigger.looksLikeTripSentence("  金沢  "))
}

@Test func japaneseTripMarkersMakeASentence() {
  #expect(IntentTrigger.looksLikeTripSentence("9月に2泊で金沢に行きたい。海鮮と美術館めぐり"))
  #expect(IntentTrigger.looksLikeTripSentence("日帰りで鎌倉"))
  #expect(IntentTrigger.looksLikeTripSentence("沖縄でのんびりしたい"))
}

@Test func twoShortWordsWithASpaceAreNotASentence() {
  #expect(!IntentTrigger.looksLikeTripSentence("沖縄 ホテル"))
}

@Test func aLongSpacedEnglishLineIsASentence() {
  #expect(IntentTrigger.looksLikeTripSentence("Weekend trip to Kyoto, want temples and good coffee."))
}

@Test func shortMarkerTextStillFires() {
  #expect(IntentTrigger.looksLikeTripSentence("3泊で沖縄"))
}

// 全欄空だけが isEmpty —— 埋めるものが無い答えは .failed に落とすための判定(spec §4.2)。
@Test func onlyABlankIntentIsEmpty() {
  #expect(TripIntent(destination: "", durationText: "", whenText: "", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "金沢", durationText: "", whenText: "", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "", durationText: "2泊", whenText: "", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "", durationText: "", whenText: "9月", wishes: []).isEmpty)
  #expect(!TripIntent(destination: "", durationText: "", whenText: "", wishes: ["海鮮"]).isEmpty)
}
