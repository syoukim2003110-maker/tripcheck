import SwiftUI
import UIKit

/// 画面が使ってよい書体の全て(spec §5.6 の表)。ビューに `Font.system(…)` を直に書かない。
///
/// `Font.system(size:weight:)` は固定サイズなので、それだけでは Dynamic Type に追随しない
/// (`Font.custom(_:size:relativeTo:)` に当たるものが system 書体には無い)。そこで各ロールに
/// 対応する `UIFont.TextStyle` を持たせ、`UIFontMetrics` で拡縮した値から `Font` を組む。
/// ビュー側は `.tcFont(.stopName)` を使えば、読み手の文字サイズ設定がそのまま効く。
///
/// `hero` などの静的プロパティは既定の文字サイズ(`.large`)での姿。プレビューや、環境を持たない
/// 場所のための入口で、本文には `.tcFont(_:)` を使う。
enum Typography {
  enum Role: String, CaseIterable {
    case hero, screenTitle, stats, dayHeader, stopName, body, meta, label, display
  }

  static var hero: Font { scaled(.hero, in: .large) }
  static var screenTitle: Font { scaled(.screenTitle, in: .large) }
  static var stats: Font { scaled(.stats, in: .large) }
  static var dayHeader: Font { scaled(.dayHeader, in: .large) }
  static var stopName: Font { scaled(.stopName, in: .large) }
  static var body: Font { scaled(.body, in: .large) }
  static var meta: Font { scaled(.meta, in: .large) }
  static var label: Font { scaled(.label, in: .large) }
  static var display: Font { scaled(.display, in: .large) }

  /// 読み手の文字サイズ設定に合わせた `Font`。同じロールなら設定が同じ限り同じ値を返す。
  static func scaled(_ role: Role, in dynamicTypeSize: DynamicTypeSize) -> Font {
    let spec = role.spec
    let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize))
    let size = UIFontMetrics(forTextStyle: spec.textStyle).scaledValue(for: spec.size, compatibleWith: traits)

    var font: Font
    if spec.usesDisplayFace, displayFaceIsInstalled {
      // `size` は既に `UIFontMetrics` を通した後の大きさなので、`fixedSize:` で渡す。
      // `Font.custom(_:size:)` は本文の比率でもう一度伸ばすので、二重に効いてしまう。
      font = .custom(displayFaceName, fixedSize: size)
    } else {
      font = .system(size: size, weight: spec.weight)
    }
    if spec.monospacedDigit { font = font.monospacedDigit() }
    if spec.tightLeading { font = font.leading(.tight) }
    return font
  }

  /// 紙の上の字(`Screens/Print/TripPrintSheet.swift`)。
  ///
  /// **Dynamic Type に追随しない。** 紙の幅は 612pt で固定なので、読み手の端末の文字サイズを
  /// 掛けると、同じ旅程が人によって行の途中で折れ、ページの割れる場所も変わる。画面の下限
  /// (本文 12pt 未満禁止)もここには掛からない —— 腕の長さで読む画面と、手元で読む紙は
  /// 事情が違うし、全日程を 1 枚に収めるにはこの大きさが要る。
  static func printed(_ role: PrintRole) -> Font {
    let spec = role.spec
    var font = Font.system(size: spec.size, weight: spec.weight)
    if spec.monospacedDigit { font = font.monospacedDigit() }
    return font
  }

  /// 紙の上の 7 つの役。
  enum PrintRole {
    /// 旅の題。
    case title
    /// 節の見出し(前提・衝突・この地域の対応・フライト)。
    case heading
    /// 日の見出し。
    case dayHeading
    /// 「09:00–10:30」。**等幅の数字** —— 桁が揃わないと、時刻の列が読み下せない。
    case clock
    case stopName
    /// 結論・前提・空港の 1 行など、文として読むもの。
    case body
    /// 住所・滞在・紙の下の但し書き。
    case meta

    var spec: (size: CGFloat, weight: Font.Weight, monospacedDigit: Bool) {
      switch self {
      case .title: (22, .bold, false)
      case .heading: (11, .heavy, false)
      case .dayHeading: (14, .heavy, false)
      case .clock: (10.5, .semibold, true)
      case .stopName: (11.5, .semibold, false)
      case .body: (10, .regular, false)
      case .meta: (9, .regular, false)
      }
    }
  }

  /// 見出し用の Anton(`Design/Fonts/Anton-Regular.ttf`、`UIAppFonts` で登録)。
  /// 同梱に失敗した版では system の太字に落ちる。
  static let displayFaceName = "Anton-Regular"
  static let displayFaceIsInstalled = UIFont(name: displayFaceName, size: 12) != nil
}

extension Typography.Role {
  /// spec §5.6 の 1 行。`textStyle` は「この字の大きさが Dynamic Type でどう伸びるか」の基準。
  struct Spec {
    var size: CGFloat
    var weight: Font.Weight = .regular
    var textStyle: UIFont.TextStyle
    var monospacedDigit = false
    var tightLeading = false
    var usesDisplayFace = false
  }

  var spec: Spec {
    switch self {
    case .hero: Spec(size: 24, weight: .black, textStyle: .title1, tightLeading: true)
    case .screenTitle: Spec(size: 32, weight: .heavy, textStyle: .largeTitle)
    case .stats: Spec(size: 14, weight: .bold, textStyle: .subheadline, monospacedDigit: true)
    case .dayHeader: Spec(size: 14, weight: .heavy, textStyle: .subheadline)
    case .stopName: Spec(size: 16, weight: .bold, textStyle: .body)
    case .body: Spec(size: 13, textStyle: .footnote)
    case .meta: Spec(size: 12.5, textStyle: .footnote, monospacedDigit: true)
    case .label: Spec(size: 11, weight: .heavy, textStyle: .caption2)
    case .display: Spec(size: 28, weight: .black, textStyle: .title1, usesDisplayFace: true)
    }
  }
}

extension View {
  /// `Typography` の 1 ロールを当てる。Dynamic Type は環境から読むので、ビューは大きさを知らない。
  func tcFont(_ role: Typography.Role) -> some View { modifier(TypographyFontModifier(role: role)) }
}

private struct TypographyFontModifier: ViewModifier {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let role: Typography.Role

  func body(content: Content) -> some View { content.font(Typography.scaled(role, in: dynamicTypeSize)) }
}
