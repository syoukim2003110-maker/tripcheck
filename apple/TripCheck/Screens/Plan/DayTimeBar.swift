import SwiftUI
import TripCheckAppCore

/// 1 日の時間の帯 —— 訪問(墨)・移動(赤)・余裕(斜線)。
///
/// **絵として 1 要素**にまとめ、内訳は全部 `bar.a11y` の 1 文が運ぶ。区間ごとに読み上げると、
/// 「訪問」「6時間」「移動」…と断片が並んで、どれが何の数か分からなくなる。
///
/// 余裕を色ではなく**斜線**で描くのは、余裕が「何かが入っている」ものではないから ——
/// 塗ってしまうと 3 つ目の予定に見える。`Canvas` で引くので、端末や OS の版で模様が
/// 変わらない。
struct DayTimeBar: View {
  let bar: DayTimeBarModel
  /// その日の色。マーカーの縁に使い、地図のピンと同じ日を指していることを示す。
  let dayColor: Color

  private static let trackHeight: CGFloat = 14

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      ZStack(alignment: .topLeading) {
        RoundedRectangle(cornerRadius: Tokens.Radius.pill)
          .fill(Tokens.Color.tile)
          .frame(height: Self.trackHeight)

        if !bar.isEmpty {
          HStack(spacing: 0) {
            Rectangle().fill(Tokens.Color.ink).frame(width: width * bar.visit)
            Rectangle().fill(Tokens.Color.accent).frame(width: width * bar.travel)
            SlackHatch().frame(width: width * bar.slack)
          }
          .frame(height: Self.trackHeight)
          .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.pill))
        }

        ForEach(bar.markers) { marker in
          MarkerDot(kind: marker.kind, dayColor: dayColor)
            .position(x: min(max(4, width * marker.position), width - 4), y: Self.trackHeight / 2)
        }
      }
      .frame(height: Self.trackHeight)
    }
    .frame(height: Self.trackHeight)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(bar.a11y)
    .accessibilityIdentifier("plan.dayBar")
  }
}

/// 余裕の斜線。`Canvas` で 45 度の細い線を等間隔に引く。
private struct SlackHatch: View {
  var body: some View {
    Canvas { context, size in
      context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Tokens.Color.panel))
      var offset: CGFloat = -size.height
      while offset < size.width {
        var line = Path()
        line.move(to: CGPoint(x: offset, y: size.height))
        line.addLine(to: CGPoint(x: offset + size.height, y: 0))
        context.stroke(line, with: .color(Tokens.Color.line), lineWidth: 3)
        offset += 7
      }
    }
    .accessibilityHidden(true)
  }
}

/// 帯の上の印。予約は丸、衝突は 45 度に傾けた四角(菱形)—— 色を見分けにくくても形が違う。
private struct MarkerDot: View {
  let kind: DayTimeBarModel.Marker.Kind
  let dayColor: Color

  var body: some View {
    Group {
      switch kind {
      case .reservation:
        Circle()
          .fill(Tokens.Color.panel)
          .overlay(Circle().stroke(dayColor, lineWidth: 2))
          .frame(width: 9, height: 9)
      case .conflict:
        Rectangle()
          .fill(Tokens.Color.danger)
          .overlay(Rectangle().stroke(Tokens.Color.panel, lineWidth: 1.5))
          .frame(width: 9, height: 9)
          .rotationEffect(.degrees(45))
      }
    }
    .accessibilityHidden(true)
  }
}
