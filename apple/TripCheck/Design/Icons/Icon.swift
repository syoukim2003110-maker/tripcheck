import CoreGraphics
import SwiftUI

/// 画面に出る絵は全部この 24 種。SF Symbols も絵文字も使わない —— 端末や OS の版で形が変わると、
/// 同じ旅程が別の顔で出てしまうから。名前と並びは `app/PlannerIcons.tsx:6-30` と同じ。
enum Icon: String, CaseIterable {
  case arrow, bed, calendar, car, check, close, cloud, external, fog, fork, mark, moon
  case rain, pin, plus, search, signal, snow, spark, storm, sun, taxi, train, walk
}

/// `PlannerIcons.tsx` の 1 要素。24 グリッドの座標で、Web の属性をそのまま持つ。
enum IconGeometry {
  /// `<path d>`。`d` は Web の文字列を書き写さずに貼り、`SVGPath` が読む。
  case path(String)
  /// `<rect x y width height rx>`(`ry` は SVG の既定どおり `rx` と同じ)。
  case roundedRect(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, radius: CGFloat)
  /// `<circle cx cy r>`。
  case circle(x: CGFloat, y: CGFloat, radius: CGFloat)
}

extension IconGeometry {
  /// 24 グリッドを `scale` 倍した `Path`。
  func path(scale: CGFloat) -> Path {
    switch self {
    case let .path(d):
      SVGPath.path(d: d, scale: scale)
    case let .roundedRect(x, y, width, height, radius):
      Path(
        roundedRect: CGRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale),
        cornerRadius: radius * scale
      )
    case let .circle(x, y, radius):
      Path(ellipseIn: CGRect(
        x: (x - radius) * scale,
        y: (y - radius) * scale,
        width: radius * 2 * scale,
        height: radius * 2 * scale
      ))
    }
  }

  /// 図形をひと続きの `Path` にまとめる。
  static func combined(_ shapes: [IconGeometry], scale: CGFloat) -> Path {
    var combined = Path()
    for shape in shapes { combined.addPath(shape.path(scale: scale)) }
    return combined
  }
}

extension Icon {
  /// 線で描く層 —— `<path>`・`<rect>`・輪郭だけの `<circle>`。
  var strokeShapes: [IconGeometry] {
    switch self {
    case .arrow: [
      .path("M4.5 12h15"),
      .path("M13 5.5 19.5 12 13 18.5"),
    ]
    case .bed: [
      .path("M3 6.5v12"),
      .path("M3 15h18"),
      .path("M21 18.5v-5a3.5 3.5 0 0 0-3.5-3.5H10v5"),
      .roundedRect(x: 5, y: 10.9, width: 4, height: 2.6, radius: 1.3),
    ]
    case .calendar: [
      .roundedRect(x: 4, y: 5.5, width: 16, height: 15, radius: 2.5),
      .path("M4 10.5h16"),
      .path("M8.5 3.5v4M15.5 3.5v4"),
    ]
    case .car: [
      .path("M4 16.4v-2.5c0-1 .7-1.9 1.7-2.1l1.7-3.2C8 7.6 9 7 10 7h4c1.1 0 2.1.6 2.6 1.6l1.7 3.2c1 .2 1.7 1.1 1.7 2.1v2.5"),
      .path("M4 16.4h16"),
      .circle(x: 8.1, y: 16.4, radius: 1.9),
      .circle(x: 15.9, y: 16.4, radius: 1.9),
      .path("M7.6 13h2M14.4 13h2"),
    ]
    case .check: [
      .path("M4.5 12.5 9.6 17.6 19.5 6.8"),
    ]
    case .close: [
      .path("M6 6l12 12M18 6 6 18"),
    ]
    case .cloud: [
      .path("M7.3 17.5a4.1 4.1 0 0 1-.6-8.2 5.3 5.3 0 0 1 10.3 1.3 3.5 3.5 0 0 1-.5 6.9Z"),
    ]
    case .external: [
      .path("M7 17 17 7"),
      .path("M9 7h8v8"),
    ]
    case .fog: [
      .path("M7.6 10.5a4 4 0 0 1 .3-3.7 4.6 4.6 0 0 1 8.6 1.7 3.2 3.2 0 0 1 2.4 2"),
      .path("M4.5 13.7h15M6.5 16.7h11M8.5 19.7h7"),
    ]
    case .fork: [
      .path("M7 3.5v4.6a2.4 2.4 0 0 0 4.8 0V3.5"),
      .path("M9.4 10.5V20.5"),
      .path("M16.2 3.5c1.9 1.9 2.7 4.4 2.7 6.8 0 2.3-1.1 3.7-2.7 4.2v6"),
    ]
    case .mark: [
      .path("M6.2 17.8c6.6 0 3.7-10 11.4-10.9"),
    ]
    case .moon: [
      .path("M19.7 14.4A8.1 8.1 0 1 1 9.6 4.3a6.6 6.6 0 0 0 10.1 10.1Z"),
    ]
    case .rain: [
      .path("M7.3 13.5a4.1 4.1 0 0 1-.6-8.2 5.3 5.3 0 0 1 10.3 1.3 3.5 3.5 0 0 1-.5 6.9Z"),
      .path("M8.4 16.2l-1 3M12.5 16.2l-1 3M16.6 16.2l-1 3"),
    ]
    case .pin: [
      .path("M12 21.3s6.8-6 6.8-11.2a6.8 6.8 0 1 0-13.6 0c0 5.2 6.8 11.2 6.8 11.2Z"),
      .circle(x: 12, y: 9.9, radius: 2.3),
    ]
    case .plus: [
      .path("M12 5.5v13M5.5 12h13"),
    ]
    case .search: [
      .circle(x: 11, y: 11, radius: 6.8),
      .path("m16.2 16.2 4.3 4.3"),
    ]
    case .signal: [
      .path("M8.2 13.4a5.4 5.4 0 0 1 7.6 0"),
      .path("M5.2 10.2a9.6 9.6 0 0 1 13.6 0"),
    ]
    case .snow: [
      .path("M12 4.5v15M5.5 8.2l13 7.6M18.5 8.2l-13 7.6"),
      .path("M12 4.5 10.4 6.4M12 4.5l1.6 1.9M12 19.5l-1.6-1.9M12 19.5l1.6-1.9"),
    ]
    case .spark: [
      .path("M12 3.5 13.7 10.3 20.5 12 13.7 13.7 12 20.5 10.3 13.7 3.5 12 10.3 10.3Z"),
    ]
    case .storm: [
      .path("M7.3 13.5a4.1 4.1 0 0 1-.6-8.2 5.3 5.3 0 0 1 10.3 1.3 3.5 3.5 0 0 1-.5 6.9"),
      .path("M12.8 11.5 10 16h3.4l-2.2 4.3"),
    ]
    case .sun: [
      .circle(x: 12, y: 12, radius: 3.6),
      .path("M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5"),
    ]
    case .taxi: [
      .path("M4 16.4v-2.5c0-1 .7-1.9 1.7-2.1l1.7-3.2C8 7.6 9 7 10 7h4c1.1 0 2.1.6 2.6 1.6l1.7 3.2c1 .2 1.7 1.1 1.7 2.1v2.5"),
      .path("M4 16.4h16"),
      .circle(x: 8.1, y: 16.4, radius: 1.9),
      .circle(x: 15.9, y: 16.4, radius: 1.9),
      .path("M10.6 7V5.2h2.8V7"),
    ]
    case .train: [
      .roundedRect(x: 6.2, y: 3.2, width: 11.6, height: 12.6, radius: 3),
      .roundedRect(x: 8.5, y: 6.1, width: 7, height: 3.4, radius: 0.9),
      .path("M9.4 15.8 7.2 20.6M14.6 15.8l2.2 4.8M8.3 18.5h7.4"),
    ]
    case .walk: [
      .path("M12.7 8 11.2 12.4"),
      .path("M12.2 9.4 15 11.6l1.7 1"),
      .path("M11.2 12.4l2.4 2.9-.5 5.2"),
      .path("M11.2 12.4 9.5 16.1l-2 3.6"),
    ]
    }
  }

  /// 本文色で塗りつぶす層 —— `fill="currentColor" stroke="none"` の円。
  var inkFillShapes: [IconGeometry] {
    switch self {
    case .mark: [.circle(x: 6.2, y: 17.8, radius: 1.9)]
    case .signal: [.circle(x: 12, y: 17, radius: 1.7)]
    case .train: [.circle(x: 9.6, y: 12.9, radius: 1), .circle(x: 14.4, y: 12.9, radius: 1)]
    case .walk: [.circle(x: 13.1, y: 4.4, radius: 2)]
    default: []
    }
  }

  /// `mark` の行き先の赤点だけ(`app/PlannerIcons.tsx:89` の `fill="#e2634e"`)。
  /// 本文色ではないので塗りを分けてある。
  var accentFillShapes: [IconGeometry] {
    switch self {
    case .mark: [.circle(x: 17.8, y: 6.8, radius: 2.3)]
    default: []
    }
  }
}

/// 線で描く層。Web と同じ 24 グリッドを、与えられた枠の幅に合わせて拡縮する。
struct IconShape: Shape {
  let icon: Icon

  func path(in rect: CGRect) -> Path {
    IconGeometry.combined(icon.strokeShapes, scale: rect.width / 24)
  }
}

/// 塗りつぶす層。`mark` / `signal` / `train` / `walk` の円だけが中身を持つ。
struct IconFillShape: Shape {
  /// `ink` は本文色の円、`accent` は `mark` の赤点。
  enum Layer { case ink, accent }

  let icon: Icon
  var layer: Layer = .ink

  func path(in rect: CGRect) -> Path {
    let shapes = layer == .ink ? icon.inkFillShapes : icon.accentFillShapes
    return IconGeometry.combined(shapes, scale: rect.width / 24)
  }
}

/// アイコン 1 つ。線と塗りを重ねて、Web と同じ丸い線端・線継ぎで描く。
///
/// 絵そのものは読み上げない —— 隣の文字が意味を言うので、`accessibilityHidden` にしてある。
struct IconView: View {
  let icon: Icon
  var size: CGFloat = 20
  var color: Color = Tokens.Color.ink

  init(_ icon: Icon, size: CGFloat = 20, color: Color = Tokens.Color.ink) {
    self.icon = icon
    self.size = size
    self.color = color
  }

  var body: some View {
    ZStack {
      IconShape(icon: icon)
        .stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
      IconFillShape(icon: icon, layer: .ink).fill(color)
      IconFillShape(icon: icon, layer: .accent).fill(Tokens.Color.markDot)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
