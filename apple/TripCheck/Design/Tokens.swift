import SwiftUI
import TripCheckKit

/// 画面が使ってよい色・角丸・当たり判定の全て。ビューに `Color(hex:)` を直に書かない —— 足りない
/// 色が出てきたらここに名前を付けてから使う。
///
/// 日ごとの色だけは Kit の `DayPalette`(TS `PLANNER_MAP_DAY_COLORS`)が持ち主で、こちらは
/// その 16 進表記を `Color` に直すだけ。地図のピンと日の見出しが同じ色になるのはそのため。
enum Tokens {
  enum Color {
    static let bg = SwiftUI.Color(hex: 0xF7F7F4), panel = SwiftUI.Color(hex: 0xFFFFFF)
    static let ink = SwiftUI.Color(hex: 0x171717), ink2 = SwiftUI.Color(hex: 0x3F3F3C), muted = SwiftUI.Color(hex: 0x616161)
    static let line = SwiftUI.Color(hex: 0xE3E3DE), controlBorder = SwiftUI.Color(hex: 0x85858E)
    static let tile = SwiftUI.Color(hex: 0xF0F0EC), tileDeep = SwiftUI.Color(hex: 0xE6E6E0)
    static let accent = SwiftUI.Color(hex: 0xD63F35), accentDeep = SwiftUI.Color(hex: 0xAE2E27), accentSoft = SwiftUI.Color(hex: 0xFBE9E6)
    static let good = SwiftUI.Color(hex: 0x157A46), goodSoft = SwiftUI.Color(hex: 0xE8F5EC)
    static let warnBg = SwiftUI.Color(hex: 0xFFF8E8), warnBorder = SwiftUI.Color(hex: 0xE9DFC2), warnInk = SwiftUI.Color(hex: 0x765700)
    static let danger = SwiftUI.Color(hex: 0xB42318), focus = SwiftUI.Color(hex: 0x2563EB)
    /// 食事など「足してみては」の行を囲む破線(Task 7)。
    static let recommendation = SwiftUI.Color(hex: 0x7C3AED)
    /// `mark` アイコンの赤点(`app/PlannerIcons.tsx:89` の `fill="#e2634e"`)。
    static let markDot = SwiftUI.Color(hex: 0xE2634E)
  }

  enum Radius { static let control: CGFloat = 10, card: CGFloat = 14, pill: CGFloat = 999 }

  enum Day {
    static func color(index: Int) -> SwiftUI.Color { SwiftUI.Color(hexString: DayPalette.color(forDayIndex: index)) }
  }

  /// 指で押せる大きさ。主要な操作は 44pt、行内の小さな操作でも 24pt を下回らない。
  enum Hit { static let primary: CGFloat = 44, secondary: CGFloat = 24 }
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }

  /// `DayPalette` が返す `"#2563EB"` 形式を読む。
  init(hexString: String) { self.init(hex: UInt32(hexString.dropFirst(), radix: 16) ?? 0) }
}
