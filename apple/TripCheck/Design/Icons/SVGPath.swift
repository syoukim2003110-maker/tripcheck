import CoreGraphics
import SwiftUI

/// `app/PlannerIcons.tsx` が書いている SVG の `d` 属性を、そのまま `Path` にする。
///
/// 座標を手で写し取ると、アイコンが Web 版と少しずつずれていく。だから `d` は文字列のまま貼って
/// ここで読む。扱うのは 24 個のアイコンが実際に使う命令だけ —— `M/m`(移動)`L/l`(直線)
/// `H/h` `V/v`(水平・垂直)`C/c`(3 次曲線)`S/s`(前の制御点の鏡像を使う 3 次曲線)
/// `A/a`(円弧)`Z/z`(閉じる)。小文字は現在点からの相対座標。
///
/// 円弧はこの 24 個ではすべて回転 0・等半径、つまり本物の円の一部なので、SVG の端点表現
/// (F.6.5)から中心を求めて `addArc` に渡す。半径が端点間の距離に届かないときは SVG の規則
/// どおり広げる。`Q/T`(2 次曲線)は現れないので読まない —— 現れたらそこで読むのをやめる。
enum SVGPath {
  /// 24 グリッドで書かれた `d` を `scale` 倍した `Path`。壊れた `d` は読めたところまでを返す。
  static func path(d: String, scale: CGFloat) -> Path {
    var pen = Pen()
    var reader = Reader(d)
    var command: Character = " "

    while true {
      reader.skipSeparators()
      if reader.isAtEnd { break }
      if let letter = reader.takeCommand() {
        command = letter
      } else if command == " " || command == "Z" || command == "z" {
        // 数値が続いても繰り返す先が無い(`Z` は引数を取らない)。
        break
      }
      guard pen.apply(command, from: &reader) else { break }
      // `M x y x y` の 2 組目以降は暗黙の直線。次の文字が命令ならそちらが勝つ。
      if command == "M" { command = "L" }
      if command == "m" { command = "l" }
    }

    return pen.path.applying(CGAffineTransform(scaleX: scale, y: scale))
  }
}

/// 命令を 1 組ずつ受け取って線を引く。現在点・部分パスの始点・直前の 3 次曲線の制御点を覚える。
private struct Pen {
  var path = Path()
  private var current = CGPoint.zero
  private var subpathStart = CGPoint.zero
  /// `S/s` が鏡像を取る相手。直前が 3 次曲線でなければ nil(SVG の規則では現在点を使う)。
  private var lastCubicControl: CGPoint?

  /// 1 命令ぶんの引数を読んで描く。引数が足りなければ false(そこで読むのをやめる合図)。
  mutating func apply(_ command: Character, from reader: inout Reader) -> Bool {
    switch command {
    case "M", "m":
      guard let point = nextPoint(command, &reader) else { return false }
      path.move(to: point)
      current = point
      subpathStart = point
      lastCubicControl = nil

    case "L", "l":
      guard let point = nextPoint(command, &reader) else { return false }
      addLine(to: point)

    case "H", "h":
      guard let x = reader.number() else { return false }
      addLine(to: CGPoint(x: command == "h" ? current.x + x : x, y: current.y))

    case "V", "v":
      guard let y = reader.number() else { return false }
      addLine(to: CGPoint(x: current.x, y: command == "v" ? current.y + y : y))

    case "C", "c":
      guard let control1 = nextPoint(command, &reader),
            let control2 = nextPoint(command, &reader),
            let end = nextPoint(command, &reader) else { return false }
      addCurve(control1: control1, control2: control2, to: end)

    case "S", "s":
      guard let control2 = nextPoint(command, &reader),
            let end = nextPoint(command, &reader) else { return false }
      let mirrored = lastCubicControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) }
      addCurve(control1: mirrored ?? current, control2: control2, to: end)

    case "A", "a":
      guard let radiusX = reader.number(),
            let radiusY = reader.number(),
            reader.number() != nil,              // x 軸回転。この 24 個では常に 0。
            let largeArc = reader.flag(),
            let sweep = reader.flag(),
            let end = nextPoint(command, &reader) else { return false }
      addArc(radius: max(abs(radiusX), abs(radiusY)), largeArc: largeArc, sweep: sweep, to: end)

    case "Z", "z":
      path.closeSubpath()
      current = subpathStart
      lastCubicControl = nil

    default:
      return false
    }
    return true
  }

  /// 座標 2 つ。小文字の命令なら現在点からの相対。
  private mutating func nextPoint(_ command: Character, _ reader: inout Reader) -> CGPoint? {
    guard let x = reader.number(), let y = reader.number() else { return nil }
    return command.isLowercase ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
  }

  private mutating func addLine(to point: CGPoint) {
    path.addLine(to: point)
    current = point
    lastCubicControl = nil
  }

  private mutating func addCurve(control1: CGPoint, control2: CGPoint, to end: CGPoint) {
    path.addCurve(to: end, control1: control1, control2: control2)
    current = end
    lastCubicControl = control2
  }

  /// 端点 2 つ + 半径から円の中心を出して弧を足す(SVG 1.1 F.6.5 を等半径・回転 0 に絞ったもの)。
  /// `sweep` は「角度が増える向き」= y 軸が下を向くこの座標系では時計回り。
  private mutating func addArc(radius requested: CGFloat, largeArc: Bool, sweep: Bool, to end: CGPoint) {
    let halfX = (current.x - end.x) / 2
    let halfY = (current.y - end.y) / 2
    let half = (halfX * halfX + halfY * halfY).squareRoot()
    guard half > 0 else { return }                    // 始点と終点が同じなら弧は無い

    let radius = max(requested, half)                 // 端点に届かない半径は広げる(F.6.6)
    let offset = (radius * radius - half * half).squareRoot() / half * (largeArc != sweep ? 1 : -1)
    let center = CGPoint(
      x: (current.x + end.x) / 2 + offset * halfY,
      y: (current.y + end.y) / 2 - offset * halfX
    )

    path.addArc(
      center: center,
      radius: radius,
      startAngle: .radians(atan2(current.y - center.y, current.x - center.x)),
      endAngle: .radians(atan2(end.y - center.y, end.x - center.x)),
      clockwise: !sweep
    )
    current = end
    lastCubicControl = nil
  }
}

/// `d` の文字列を命令・数値・フラグに切り分ける。区切りは空白か `,`、無くてもよい
/// (`c0-1 .7-1.9` のように符号や小数点が次の数値の始まりになる)。
private struct Reader {
  private let characters: [Character]
  private var index = 0

  init(_ text: String) { characters = Array(text) }

  var isAtEnd: Bool { index >= characters.count }

  mutating func skipSeparators() {
    while index < characters.count, characters[index] == "," || characters[index].isWhitespace { index += 1 }
  }

  /// 命令の 1 文字。数値の先頭なら nil(直前の命令の繰り返し)。
  mutating func takeCommand() -> Character? {
    guard index < characters.count, "MmLlHhVvCcSsAaZz".contains(characters[index]) else { return nil }
    defer { index += 1 }
    return characters[index]
  }

  /// 数値 1 つ。`-.6` や `2.6` のように区切り無しで並ぶ。指数表記は現れないので読まない。
  mutating func number() -> CGFloat? {
    skipSeparators()
    var text = ""
    if index < characters.count, characters[index] == "-" || characters[index] == "+" {
      text.append(characters[index])
      index += 1
    }
    var sawDot = false
    while index < characters.count {
      let character = characters[index]
      if character.isASCII, character.isNumber {
        text.append(character)
      } else if character == ".", !sawDot {
        sawDot = true
        text.append(character)
      } else {
        break
      }
      index += 1
    }
    guard let value = Double(text) else { return nil }
    return CGFloat(value)
  }

  /// 円弧の large-arc / sweep フラグ。1 文字きっかりで、次の数値と地続きに書けてしまう。
  mutating func flag() -> Bool? {
    skipSeparators()
    guard index < characters.count, characters[index] == "0" || characters[index] == "1" else { return nil }
    defer { index += 1 }
    return characters[index] == "1"
  }
}
