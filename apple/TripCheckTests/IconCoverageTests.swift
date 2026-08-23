import CoreGraphics
import SwiftUI
import Testing
@testable import TripCheck

/*
 * 24 種のアイコン。
 *
 * 絵は `app/PlannerIcons.tsx` の `d` 属性を**文字列のまま**貼って `SVGPath` に読ませている
 * (座標を手で写すと Web 版と少しずつずれる)。読み手が黙って壊れると、絵は消えるのでは
 * なく**空のまま出る** —— 枠は 20pt 取られ、線は 1 本も引かれない。Task 1 は `SVGPath` に
 * 自動の検査を残していなかったので、ここがその穴を塞ぐ。
 *
 * 見るのは 3 つ。全 24 種が線を持つこと、塗りの層を持つ 4 種が持っていること、そして
 * **円弧が本当に弧として引かれていること**。最後の 1 つが要るのは、`A/a` を読み損ねた
 * `SVGPath` が黙って端点を直線で結ぶからで、そのとき絵は「出ているのに違う形」になる。
 */

private let box = CGRect(x: 0, y: 0, width: 24, height: 24)

@Test func everyIconHasAPath() {
  for icon in Icon.allCases {
    #expect(!IconShape(icon: icon).path(in: box).isEmpty, "\(icon.rawValue)")
  }
  for icon in [Icon.mark, .signal, .train, .walk] {
    #expect(!IconFillShape(icon: icon).path(in: box).isEmpty, "\(icon.rawValue) fill layer")
  }
  // 赤点を持つのは `mark` だけ。ほかの 23 種の accent 層は空でなければならない ——
  // 空でなければ、どの絵にも行き先の赤点が乗る。
  #expect(!IconFillShape(icon: .mark, layer: .accent).path(in: box).isEmpty)
  for icon in Icon.allCases where icon != .mark {
    #expect(IconFillShape(icon: icon, layer: .accent).path(in: box).isEmpty, "\(icon.rawValue) accent layer")
  }
}

/// どの絵も 24 の枠からはみ出さず、点にも潰れない。はみ出せば隣の字に掛かり、潰れれば
/// 「出ているのに読めない」形になる。
@Test func everyIconStaysInsideItsBoxWithoutCollapsing() {
  for icon in Icon.allCases {
    let bounds = IconShape(icon: icon).path(in: box).boundingRect
    #expect(bounds.minX >= -0.5 && bounds.minY >= -0.5, "\(icon.rawValue) starts outside: \(bounds)")
    #expect(bounds.maxX <= 24.5 && bounds.maxY <= 24.5, "\(icon.rawValue) runs past the box: \(bounds)")
    #expect(bounds.width >= 5 && bounds.height >= 1.5, "\(icon.rawValue) collapsed: \(bounds)")
  }
}

/// **円弧が弧として引かれている。** どれも、`A/a` を直線に落とした読み手なら決して届かない
/// ところを見ている —— 比べる相手は「端点だけを結んだ場合の枠」で、その数はソースの `d` から
/// 手で読める。
@Test func theArcsBowTheWayTheirRadiusSays() {
  // `pin`: 上半分は半径 6.8 の半円(`a6.8 6.8 0 1 0-13.6 0`)。端点は y = 10.1 なので、
  // 直線で結べば枠の上端は 10.1 のまま。弧なら 10.1 - 6.8 = 3.3 まで上がる。
  let pin = IconShape(icon: .pin).path(in: box).boundingRect
  #expect(pin.minY < 5, "pin arc was flattened: \(pin)")

  // `signal`: 外側の弧は端点 (5.2, 10.2)-(18.8, 10.2)、半径 9.6。矢高は
  // 9.6 - √(9.6² - 6.8²) ≒ 2.82 なので、弧なら上端は 7.4 前後まで上がる。
  let signal = IconShape(icon: .signal).path(in: box).boundingRect
  #expect(signal.minY < 9, "signal arcs were flattened: \(signal)")
  #expect(signal.maxY >= 13, "signal lost its lower arc: \(signal)")

  // `moon`: 端点は (19.7, 14.4) と (9.6, 4.3) の 2 つだけ。直線 2 本なら枠は 10.1 角。
  // 大きいほうの弧(`A8.1 8.1 0 1 1`)は 236 度あるので、枠は 15 を超える。
  let moon = IconShape(icon: .moon).path(in: box).boundingRect
  #expect(moon.width > 12 && moon.height > 12, "moon arc was flattened: \(moon)")

  // `cloud`: 閉じた 1 本。雲の腹に落とした点は中に入り、枠の隅は外に出る。
  let cloud = IconShape(icon: .cloud).path(in: box)
  #expect(cloud.contains(CGPoint(x: 11.5, y: 13)), "cloud is not a closed body")
  #expect(!cloud.contains(CGPoint(x: 1, y: 1)))
  #expect(!cloud.contains(CGPoint(x: 23, y: 23)))
}

/// 枠に合わせて拡縮する。20pt でも 44pt でも同じ形が出る(`rect.width / 24`)。
@Test func iconsScaleWithTheirBox() {
  let small = IconShape(icon: .pin).path(in: CGRect(x: 0, y: 0, width: 12, height: 12)).boundingRect
  let large = IconShape(icon: .pin).path(in: CGRect(x: 0, y: 0, width: 48, height: 48)).boundingRect
  #expect(abs(large.width / small.width - 4) < 0.001)
  #expect(abs(large.minY / small.minY - 4) < 0.001)
}

/// 線の太さは Web の `strokeWidth={1.8}`(24 グリッドの中の 1.8)—— 絵と一緒に伸び縮みする。
@Test func theStrokeWidthTravelsWithTheIconSize() {
  #expect(abs(IconShape.strokeStyle(size: 24).lineWidth - 1.8) < 0.0001)
  #expect(abs(IconShape.strokeStyle(size: 20).lineWidth - 1.5) < 0.0001)
  #expect(IconShape.strokeStyle(size: 20).lineCap == .round)
  #expect(IconShape.strokeStyle(size: 20).lineJoin == .round)
}

/// `SVGPath` そのものの読み方。`d` の書き方(相対・区切り無し・鏡像・弧)ごとに 1 本ずつ。
@Test func theDReaderHandlesEveryCommandTheIconsUse() {
  // `M/L` と、区切りの無い相対座標(`l` の後ろに符号で続く形)。
  let line = SVGPath.path(d: "M2 2L10 2l0 8", scale: 1).boundingRect
  #expect(line == CGRect(x: 2, y: 2, width: 8, height: 8))

  // `H/V`。
  let hv = SVGPath.path(d: "M4 4H20V16", scale: 1).boundingRect
  #expect(hv == CGRect(x: 4, y: 4, width: 16, height: 12))

  // `Z` は部分パスの始点へ戻る。戻った先から次の線が引ける。
  let closed = SVGPath.path(d: "M4 4L20 4L20 20Z", scale: 1)
  #expect(closed.contains(CGPoint(x: 18, y: 10)))
  #expect(!closed.contains(CGPoint(x: 6, y: 18)))

  // `s` は直前の 3 次曲線の制御点の鏡像を使う。直前が曲線でなければ現在点。
  #expect(!SVGPath.path(d: "M2 12s4-8 10-8", scale: 1).isEmpty)

  // 半径が端点間の距離に届かないときは SVG の規則どおり広げる(F.6.6)—— 広げないと
  // 中心が求まらず、弧は 1 本も引かれない。
  let tight = SVGPath.path(d: "M4 12a1 1 0 0 1 16 0", scale: 1).boundingRect
  #expect(tight.width > 15)
  #expect(tight.minY < 12, "the arc did not bow: \(tight)")

  // 読めない命令が来たらそこで止まる(読めたところまでは返す)。
  let partial = SVGPath.path(d: "M2 2L10 2 Q 4 4 6 6", scale: 1).boundingRect
  #expect(partial == CGRect(x: 2, y: 2, width: 8, height: 0))
}
