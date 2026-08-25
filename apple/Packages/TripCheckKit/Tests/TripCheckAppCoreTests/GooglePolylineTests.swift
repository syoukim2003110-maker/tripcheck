import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func decodesGoogleReferenceExample() {
  // Google 公式の canonical 例(1e-5 デルタ符号化)。
  let points = GooglePolyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
  #expect(points.count == 3)
  let expected = [
    GeoPoint(latitude: 38.5, longitude: -120.2),
    GeoPoint(latitude: 40.7, longitude: -120.95),
    GeoPoint(latitude: 43.252, longitude: -126.453),
  ]
  for (p, e) in zip(points, expected) {
    #expect(abs(p.latitude - e.latitude) < 1e-9)
    #expect(abs(p.longitude - e.longitude) < 1e-9)
  }
}

@Test func emptyOrPartialDecodesToEmpty() {
  #expect(GooglePolyline.decode("").isEmpty)
  #expect(GooglePolyline.decode("_p~iF").isEmpty)   // 緯度デルタだけで経度が無い → 空
  #expect(GooglePolyline.decode("_").isEmpty)        // 1 チャンクだけ → 空
}
