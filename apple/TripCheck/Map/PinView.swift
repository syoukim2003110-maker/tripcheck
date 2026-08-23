import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 地図の点 1 つ。
///
/// 種別は**形と絵**で言う —— 色だけでは、色を見分けにくい読み手に「予定地点」と「おすすめ」の
/// 違いが伝わらない(v1.1 §7.1 の「日の同一性は必ず番号か線種と組で示す」と同じ理由)。
/// 予定地点はデイカラーの丸に番号、提案は輪郭だけの丸に `spark`、食事は `fork`、ホテルは
/// `bed`、自分で置いた点は `plus`、直すところのある場所は右上に `!`。
///
/// 名前は出さない(地図が名前で埋まる)。**耳には `pin.a11y` の 1 文が名前と種別を運ぶ** ——
/// 目で読めるのが番号だけである以上、読み上げは名前から始まらなければならない。
struct PinView: View {
  let pin: MapPin
  /// タイムラインの行や、直前に押したピン。少し大きく、影を濃くする。
  var highlighted = false

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// 丸の直径。当たり判定は下の `padding` を足して 44pt になる。
  private static let diameter: CGFloat = 32

  var body: some View {
    let color = Tokens.Day.color(hex: pin.colorHex)

    ZStack(alignment: .topTrailing) {
      face(color)
      if case .warning = pin.kind { warningBadge }
    }
    .frame(width: Self.diameter, height: Self.diameter)
    .scaleEffect(highlighted ? 1.18 : 1)
    .shadow(color: .black.opacity(highlighted ? 0.35 : 0.18), radius: highlighted ? 5 : 2, y: 1)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.15), value: highlighted)
    // 指で押す大きさ(≥44pt)。丸そのものを 44pt にすると地図が点で埋まるので、
    // 見た目は 32pt のまま、当たり判定だけを広げる。
    .padding(6)
    .contentShape(Rectangle())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(pin.a11y)
    .accessibilityAddTraits(.isButton)
  }

  /// 丸の中身。`label` が空でない種別(予定地点・注意)は番号を、ほかは絵を置く。
  @ViewBuilder
  private func face(_ color: Color) -> some View {
    switch pin.kind {
    case .anchor, .warning:
      filled(color) {
        Text(pin.label)
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.panel)
      }
    case .hotel:
      // ホテルはどの日のものでもない —— 毎日そこから出て、そこへ帰る 1 点なので、
      // デイカラーで塗らずに本文色で塗る。
      filled(Tokens.Color.ink) { IconView(.bed, size: 17, color: Tokens.Color.panel) }
    case .filler:
      outlined(color) { IconView(.spark, size: 16, color: color) }
    case .meal:
      outlined(Tokens.Color.recommendation) { IconView(.fork, size: 16, color: Tokens.Color.recommendation) }
    case .manual:
      outlined(color) { IconView(.plus, size: 16, color: color) }
    }
  }

  private func filled(_ color: Color, @ViewBuilder content: () -> some View) -> some View {
    Circle()
      .fill(color)
      .overlay(Circle().stroke(Tokens.Color.panel, lineWidth: 2))
      .overlay(content())
  }

  private func outlined(_ color: Color, @ViewBuilder content: () -> some View) -> some View {
    Circle()
      .fill(Tokens.Color.panel)
      .overlay(Circle().stroke(color, lineWidth: 2))
      .overlay(content())
  }

  /// 右上の `!`。**この 1 文字だけは文言表を通さない** —— 日本語でも英語でも同じ字で、
  /// 訳すものが無いからである。意味は `pin.a11y` の「注意地点」が運ぶ。
  private var warningBadge: some View {
    Text(verbatim: "!")
      .tcFont(.label)
      .foregroundStyle(Tokens.Color.panel)
      .frame(width: 14, height: 14)
      .background(Circle().fill(Tokens.Color.danger))
      .overlay(Circle().stroke(Tokens.Color.panel, lineWidth: 1.5))
      .offset(x: 4, y: -4)
  }
}

#Preview {
  HStack(spacing: 12) {
    PinView(pin: MapPin(id: "a", coordinate: .init(latitude: 0, longitude: 0), kind: .anchor(number: 3),
                        dayIndex: 0, colorHex: "#2563EB", label: "3", a11y: "ツェルマット、予定地点"))
    PinView(pin: MapPin(id: "w", coordinate: .init(latitude: 0, longitude: 0), kind: .warning,
                        dayIndex: 1, colorHex: "#7C3AED", label: "2", a11y: "ベルン旧市街、注意地点"), highlighted: true)
    PinView(pin: MapPin(id: "h", coordinate: .init(latitude: 0, longitude: 0), kind: .hotel,
                        dayIndex: 0, colorHex: "#2563EB", label: "", a11y: "ホテル、ホテル"))
    PinView(pin: MapPin(id: "f", coordinate: .init(latitude: 0, longitude: 0), kind: .filler,
                        dayIndex: 2, colorHex: "#C2410C", label: "", a11y: "おすすめ、おすすめ地点"))
    PinView(pin: MapPin(id: "m", coordinate: .init(latitude: 0, longitude: 0), kind: .meal(.lunch),
                        dayIndex: 2, colorHex: "#C2410C", label: "", a11y: "昼食、昼食のおすすめ"))
    PinView(pin: MapPin(id: "p", coordinate: .init(latitude: 0, longitude: 0), kind: .manual,
                        dayIndex: 3, colorHex: "#15803D", label: "", a11y: "自分の点、自分で指定した地点"))
  }
  .padding()
  .background(Tokens.Color.bg)
}
