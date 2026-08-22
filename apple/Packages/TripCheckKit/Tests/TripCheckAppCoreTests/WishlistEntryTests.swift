import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func entriesSerialiseToWebCompatibleTextAndBack() {
  // 日付なしを先に置く(後ろに置くと `Day 2` 見出しの contextDay を継いで fixedDay == 2 になる —— WishlistParser.swift:221)
  let e = [WishlistEntry(text: "Ueno Park", priority: .optional),
           WishlistEntry(text: "Ghibli Museum", priority: .must, fixedDay: 2, fixedTime: "10:00", isReservation: true, stayMinutes: 120)]
  let raw = WishlistSerialization.raw(from: e, locale: .en)
  #expect(raw == "Ueno Park — optional\nDay 2\nGhibli Museum — 10:00 — booked — stay 120 min")   // WishlistSerializer.formatPlaces の形(booked と must は排他)
  let back = WishlistSerialization.entries(fromPasted: raw)
  #expect(back.entries.map(\.text) == ["Ueno Park", "Ghibli Museum"])
  #expect(back.entries[0].fixedDay == nil)
  #expect(back.entries[1].fixedDay == 2)
  #expect(back.entries[1].isReservation)
  #expect(back.mode == .existing_itinerary)   // 見出しがあるのでビルダーと同じく checker モード
}

@Test func plainListStaysInWishlistMode() {
  let r = WishlistSerialization.entries(fromPasted: "Ueno Park\nSenso-ji\nhttps://x.example\n")
  #expect(r.mode == .wishlist)
  #expect(r.entries.map(\.text) == ["Ueno Park", "Senso-ji"])
  #expect(r.unparsed == ["https://x.example"])   // URL だけの行は WishlistParser が .unparsed にする
}

@Test func pastedItineraryWithHeadingsBecomesCheckerMode() {
  let r = WishlistSerialization.entries(fromPasted: "Day 1\nUeno Park\nSenso-ji\nDay 2\nTokyo Tower\nhttps://x.example")
  #expect(r.mode == .existing_itinerary)
  #expect(r.entries.filter { $0.fixedDay == 1 }.map(\.text) == ["Ueno Park", "Senso-ji"])
  #expect(r.entries.filter { $0.fixedDay == 2 }.map(\.text) == ["Tokyo Tower"])
  #expect(r.unparsed == ["https://x.example"])
}
