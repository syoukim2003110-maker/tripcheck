import Foundation
import MapKit
import Testing
@testable import TripCheckAppCore
import TripCheckKit

private let a = GeoPoint(latitude: 46.948, longitude: 7.447), b = GeoPoint(latitude: 46.96, longitude: 7.46)
private func walk(_ key: String = "x::y") -> RouteRequest { RouteRequest(legKey: key, from: a, to: b, mode: .walk, departure: nil) }
private func transit() -> RouteRequest { RouteRequest(legKey: "x::y", from: a, to: b, mode: .transit, departure: Date(timeIntervalSince1970: 1_800_000_000)) }
/// 出発時刻は**答えのほうにも**入る —— 尋ねた時刻(`transit()` の 1_800_000_000)と、
/// 地図が「その次の便」として返した時刻(ここでは 10 分後)は別物で、旅程に載るのは後者。
private let departureFound = Date(timeIntervalSince1970: 1_800_000_600)
private let tenMinutes = DirectionsAnswer(travelSeconds: 600, distanceMeters: nil, geometry: nil, expectedDeparture: departureFound)

@Test func aMeasuredWalkCarriesMinutesAndGeometryAndZeroMinutesIsAFailure() async {
  let fake = FakeDirecting(answers: ["walk|x::y": DirectionsAnswer(travelSeconds: 1_530, distanceMeters: 1_900.4, geometry: [a, b], expectedDeparture: nil)])
  #expect(await AppleRouteProvider(directing: fake).route(walk(), locale: .ja) == .measured(minutes: 26, distanceMeters: 1_900, geometry: [a, b], expectedDeparture: nil))
  let zero = FakeDirecting(answers: ["walk|x::y": DirectionsAnswer(travelSeconds: 20, distanceMeters: 10, geometry: [a, b], expectedDeparture: nil)])
  #expect(await AppleRouteProvider(directing: zero).route(walk(), locale: .en) == .failed)

  // 数千点の線は提供元が間引いてから返す(アダプタの `@MainActor` の中ではなく、ここで)。
  let line = (0...4000).map { GeoPoint(latitude: 46.0 + Double($0) * 0.00001, longitude: 7.0 + Double($0) * 0.00001) }
  let long = FakeDirecting(answers: ["walk|x::y": DirectionsAnswer(travelSeconds: 600, distanceMeters: 4_000, geometry: line, expectedDeparture: nil)])
  #expect(await AppleRouteProvider(directing: long).route(walk(), locale: .en) == .measured(minutes: 10, distanceMeters: 4_000, geometry: PolylineSimplifier.thinned(line), expectedDeparture: nil))
  guard case .measured(_, _, let thinned, _) = await AppleRouteProvider(directing: long).route(walk(), locale: .en) else { return #expect(Bool(false), "a long walk must still measure") }
  #expect(thinned?.count == 2)
}

/// 3 分類: notFound → unroutable、other → failed、throttled → 1/2/4 秒で 3 回まで再試行(ここでは短く注入)。
@Test func failuresAreClassifiedAndThrottlingIsRetriedThreeTimes() async {
  #expect(await AppleRouteProvider(directing: FakeDirecting()).route(walk("no::route"), locale: .en) == .unroutable)
  struct Broken: Directing { func directions(_ request: RouteRequest) async throws -> DirectionsAnswer { throw DirectionsFailure.other } }
  #expect(await AppleRouteProvider(directing: Broken()).route(walk(), locale: .en) == .failed)
  let fast: [Duration] = [.milliseconds(1), .milliseconds(2), .milliseconds(4)]
  let recovers = FakeDirecting(answers: ["transit|x::y": tenMinutes], throttleFirst: 3)
  #expect(await AppleRouteProvider(directing: recovers, throttleDelays: fast).route(transit(), locale: .en) == .measured(minutes: 10, distanceMeters: nil, geometry: nil, expectedDeparture: departureFound))
  let recoveredAfter = await recovers.log.calls
  #expect(recoveredAfter == 4)
  let givesUp = FakeDirecting(answers: ["transit|x::y": tenMinutes], throttleFirst: 4)
  #expect(await AppleRouteProvider(directing: givesUp, throttleDelays: fast).route(transit(), locale: .en) == .failed)
  let gaveUpAfter = await givesUp.log.calls
  #expect(gaveUpAfter == 4)
}

/// タイムアウト(徒歩/車 8 秒・公共交通 12 秒、ここでは短く注入)。待ちは本当に解ける。
///
/// **経った時間では測らない。** この suite は既定で並列に走り(`tools/verify-kit.sh`)、816 本が
/// 一斉に立つと 1 本の待ち時間は機械の忙しさそのものになる —— 実測すると、答えが正しくても
/// 「5 秒以内に返った」の側が落ちる。代わりに、負けた 60 秒の相手が**取り消しで畳まれて
/// 返ったこと**を数える: `withTaskGroup` は子が全部終わるまで返らないので、解けていなければ
/// `route` は 60 秒返らず、解けていれば `witness` に 1 回ずつ残る。
@Test func aHangingProviderLosesTheRace() async {
  let hanging = HangingDirecting()
  let provider = AppleRouteProvider(directing: hanging, walkDriveTimeout: .milliseconds(30), transitTimeout: .milliseconds(60))
  #expect(await provider.route(walk(), locale: .en) == .failed)
  #expect(await provider.route(transit(), locale: .en) == .failed)
  let unwound = await hanging.witness.unwound
  #expect(unwound == 2)
}

/// 端末の地図が投げるものを 3 分類へ写す表(spec §7)。**ここが唯一の置き場所** ——
/// `swift test` は `MKDirections` を呼ばないので、この表を通る道はこのテストしかない。
/// `@MainActor` なのは `classify` が `@MainActor` の `MKDirectionsAdapter` の中に居るから。
@MainActor @Test func mapKitErrorsFallIntoThreeClasses() {
  #expect(MKDirectionsAdapter.classify(MKError(.loadingThrottled)) == .throttled)
  #expect(MKDirectionsAdapter.classify(MKError(.placemarkNotFound)) == .notFound)
  #expect(MKDirectionsAdapter.classify(MKError(.directionsNotFound)) == .notFound)
  // 表に無いものは全部 `.other`(= `.failed`)。「経路なし」に混ぜない —— 混ぜると、
  // 通信が落ちただけの脚が「歩ける道が無い」として旅程から消える。
  #expect(MKDirectionsAdapter.classify(MKError(.serverFailure)) == .other)
  #expect(MKDirectionsAdapter.classify(MKError(.unknown)) == .other)
  #expect(MKDirectionsAdapter.classify(MKError(.decodingFailed)) == .other)
}

@Test func douglasPeuckerKeepsEndpointsAndDropsNearlyCollinearPoints() {
  let line = (0...4000).map { GeoPoint(latitude: 46.0 + Double($0) * 0.00001, longitude: 7.0 + Double($0) * 0.00001) }
  let simplified = PolylineSimplifier.simplify(line, toleranceMeters: 5)
  #expect(simplified.first == line.first && simplified.last == line.last && simplified.count < 10)
  let bent = [GeoPoint(latitude: 46, longitude: 7), GeoPoint(latitude: 46.01, longitude: 7.02), GeoPoint(latitude: 46.02, longitude: 7)]
  #expect(PolylineSimplifier.simplify(bent, toleranceMeters: 5) == bent)
  // 0 以下の物差しでは何も落とさない(public な入口なので、落ちずに返ること自体が答え)。
  #expect(PolylineSimplifier.simplify(bent, toleranceMeters: -1) == bent)
  #expect(PolylineSimplifier.simplify(line, toleranceMeters: 0) == line)
  // 掛ける・掛けないの境目は `thinned` が 1 か所で決める: 2000 点以下はそのまま。
  #expect(PolylineSimplifier.thinned(bent) == bent)
  #expect(PolylineSimplifier.thinned(line) == simplified)
  #expect(PolylineSimplifier.thinned(Array(line.prefix(PolylineSimplifier.simplifyAbovePoints))).count == PolylineSimplifier.simplifyAbovePoints)
}

/// 通信しない決定的な提供元。`-uiTesting` の画面が毎回同じ旅程を出せるのは、答えが
/// 直線距離だけで決まるから —— 乱数も時計も見ない。1.66 km の 1 レグで 徒歩 20 分・
/// 車 5 分・公共交通 7 分、67 m の 1 レグでは車と公共交通が下限(3 分・5 分)に当たる。
@Test func theCannedProviderAnswersFromTheStraightLineAlone() async {
  let provider = CannedRouteProvider()
  let departure = Date(timeIntervalSince1970: 1_800_000_000)
  let bend = GeoPoint(latitude: (a.latitude + b.latitude) / 2 + 0.002, longitude: (a.longitude + b.longitude) / 2)

  #expect(await provider.route(walk(), locale: .ja) == .measured(minutes: 20, distanceMeters: 1_660, geometry: [a, bend, b], expectedDeparture: nil))
  let taxi = RouteRequest(legKey: "x::y", from: a, to: b, mode: .taxi, departure: departure)
  #expect(await provider.route(taxi, locale: .ja) == .measured(minutes: 5, distanceMeters: 1_660, geometry: [a, bend, b], expectedDeparture: departure))
  let ridden = await provider.route(transit(), locale: .en)
  #expect(ridden == .measured(minutes: 7, distanceMeters: nil, geometry: nil, expectedDeparture: departure))
  // 2 度目も同じ答え。
  #expect(await provider.route(transit(), locale: .en) == ridden)

  // 短いレグは下限に当たる —— 車で 0 分・公共交通で 0 分の脚は旅程に置けない。
  let near = GeoPoint(latitude: 46.9485, longitude: 7.4475)
  let short = { (mode: TransportMode) in RouteRequest(legKey: "x::z", from: a, to: near, mode: mode, departure: nil) }
  let shortBend = GeoPoint(latitude: (a.latitude + near.latitude) / 2 + 0.002, longitude: (a.longitude + near.longitude) / 2)
  #expect(await provider.route(short(.walk), locale: .ja) == .measured(minutes: 1, distanceMeters: 67, geometry: [a, shortBend, near], expectedDeparture: nil))
  #expect(await provider.route(short(.taxi), locale: .ja) == .measured(minutes: 3, distanceMeters: 67, geometry: [a, shortBend, near], expectedDeparture: nil))
  #expect(await provider.route(short(.transit), locale: .ja) == .measured(minutes: 5, distanceMeters: nil, geometry: nil, expectedDeparture: nil))
}
