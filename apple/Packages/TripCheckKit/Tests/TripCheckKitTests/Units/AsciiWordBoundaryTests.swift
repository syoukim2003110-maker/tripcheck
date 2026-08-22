import Testing
@testable import TripCheckKit

/*
 * JS の `\b` は ASCII だけを語の文字として数える —— その一点だけを検査する。
 *
 * ICU(`NSRegularExpression`)の `\b` は Unicode の語構成文字で判定するので、漢字・かなも
 * 「語の文字」に入る。`\b` を逐語で移すと、和欧が隣り合う行(`京都must` / `浅草寺booked` /
 * `浅草sushi`)で **境界が一度も立たず**、TS が拾う制約を Swift だけが落としていた。
 *
 * 期待値は移植元の正規表現そのものから読む(JavaScriptCore で実測して確かめた):
 *
 *   - `mustAnywhere` `lib/wishlist-parser.ts:43`
 *   - `optionalAnywhere` `lib/wishlist-parser.ts:46`
 *   - `reservationAnywhere` `lib/wishlist-parser.ts:49`
 *   - `explicitAnchorPattern` `lib/route-optimizer.ts:289`
 *   - `foodVenuePattern` `lib/trip-builder.ts:293`
 *
 * golden 500 とパーサコーパスには CJK と ASCII が隣り合う語が 1 件も無いので、G1/G2/G3 は
 * ここを一度も通らない。だからこのファイルが要る。
 */

// MARK: - パーサの 3 パターン(`lib/wishlist-parser.ts:43, 46, 49`)

@Test func cjkAdjacentMarkersAreDetectedTheWayJavaScriptDoes() {
  // TS `/\bmust(?:-do)?\b|…/i` (`lib/wishlist-parser.ts:43`)
  #expect(WishlistPatterns.mustAnywhere.test("京都must"))
  #expect(WishlistPatterns.mustAnywhere.test("must京都"))
  #expect(WishlistPatterns.mustAnywhere.test("浅草寺must-do"))
  #expect(WishlistPatterns.mustAnywhere.test("must see"))
  #expect(WishlistPatterns.mustAnywhere.test("mustard") == false)      // ASCII の隣接は境界を作らない

  // TS `/\boptional\b|…/i` (`lib/wishlist-parser.ts:46`)
  #expect(WishlistPatterns.optionalAnywhere.test("渋谷optional"))
  #expect(WishlistPatterns.optionalAnywhere.test("optional渋谷"))
  #expect(WishlistPatterns.optionalAnywhere.test("optional stop"))
  #expect(WishlistPatterns.optionalAnywhere.test("optionally") == false)

  // TS `/\bbooked\b|…|\bneed tickets?\b|…/i` (`lib/wishlist-parser.ts:49`)
  #expect(WishlistPatterns.reservationAnywhere.test("浅草寺booked"))
  #expect(WishlistPatterns.reservationAnywhere.test("booked浅草寺"))
  #expect(WishlistPatterns.reservationAnywhere.test("浅草寺need tickets"))
  #expect(WishlistPatterns.reservationAnywhere.test("hotel booked"))
  #expect(WishlistPatterns.reservationAnywhere.test("rebooked") == false)
}

@Test func parsedLineCarriesTheMarkerThatSitsAgainstCjk() {
  let lines = WishlistParser.parse("京都must\n渋谷optional\n浅草寺booked")
  let places: [ParsedWishlistPlace] = lines.flatMap { line -> [ParsedWishlistPlace] in
    if case .place(_, let places) = line { return places }
    return []
  }
  #expect(places.count == 3)
  #expect(places.first?.priority == .must)
  #expect(places.dropFirst().first?.priority == .optional)
  #expect(places.last?.isReservation == true)
}

// MARK: - カタログの錨(`lib/route-optimizer.ts:289`)

@Test func catalogAnchorSeesAReservationWordGluedToAJapaneseName() throws {
  // 浅草寺 は `reservationSensitive` を持たないので、`isAnchor` は行の語だけで決まる。
  let anchored = try #require(Catalog.resolveKnownStops("浅草寺booked").first)
  #expect(anchored.id == "sensoji")
  #expect(anchored.isAnchor)

  let spaced = try #require(Catalog.resolveKnownStops("浅草寺 booked").first)
  #expect(spaced.isAnchor)

  // ASCII が続く語は TS でも境界を作らない。
  let plain = try #require(Catalog.resolveKnownStops("浅草寺 rebooked").first)
  #expect(plain.isAnchor == false)
}

// MARK: - 飲食店(`lib/trip-builder.ts:293`)

private let reservationConstraint = WishlistStopConstraint(priority: .normal, isReservation: true)

@Test func foodVenueSeesSushiGluedToAJapaneseAreaName() {
  // TS `/\b(?:…|sushi|…)\b|…/i` は `浅草sushi` に当たる(`草` は JS にとって語の文字ではない)。
  #expect(resolveUserFoodReservation(entry: "浅草sushi", constraint: reservationConstraint, locale: .en) != nil)
  #expect(resolveUserFoodReservation(entry: "浅草 sushi bar", constraint: reservationConstraint, locale: .en) != nil)

  // ASCII の隣接は TS でも境界を作らない。
  #expect(resolveUserFoodReservation(entry: "浅草 sushiro", constraint: reservationConstraint, locale: .en) == nil)

  // 予約と書かれていない行は、語がどう並んでいても停留所にならない。
  #expect(resolveUserFoodReservation(entry: "浅草sushi", constraint: .default, locale: .en) == nil)
}

@Test func foodVenueKeepsTheJavaScriptQuirkAtTheEndOfCafe() {
  // `/\bcafé\b/` の末尾 `\b` は `é` が語の文字でないため「次が語の文字」でなければ立たない。
  // JavaScriptCore で実測: `/\b(?:…|café|…)\b/i.test("Blue Bottle Café")` は false。
  // 前後読み(`notAfterWord`/`notBeforeWord`)だけに置き換えると true になってしまうので、
  // ここは厳密形 `JSText.wordBoundary` を使っている。
  #expect(resolveUserFoodReservation(entry: "Asakusa Café", constraint: reservationConstraint, locale: .en) == nil)
  // 続く語が ASCII なら TS でも当たる。
  #expect(resolveUserFoodReservation(entry: "Asakusa Caféx", constraint: reservationConstraint, locale: .en) != nil)
  // `bar` の枝は独立して当たる。
  #expect(resolveUserFoodReservation(entry: "Asakusa Café bar", constraint: reservationConstraint, locale: .en) != nil)
  // 全角の「カフェ」は `\b` を持たない枝なのでそのまま当たる。
  #expect(resolveUserFoodReservation(entry: "浅草カフェ", constraint: reservationConstraint, locale: .en) != nil)
}

// MARK: - ASCII 語境界の綴りは 1 か所だけ

@Test func asciiWordBoundarySpellingsLiveOnlyInJSText() {
  // 生の `\b` を書いた正規表現があると和欧混在で JS と分かれる。綴りをここで固定して、
  // 各パターンが `JSText` の定数を通っていることを読み手に見せる。
  #expect(JSText.notAfterWord == "(?<![0-9A-Za-z_])")
  #expect(JSText.notBeforeWord == "(?![0-9A-Za-z_])")
  #expect(JSText.wordBoundary == "(?:(?<=[0-9A-Za-z_])(?![0-9A-Za-z_])|(?<![0-9A-Za-z_])(?=[0-9A-Za-z_]))")
}
