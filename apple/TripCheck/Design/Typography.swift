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
