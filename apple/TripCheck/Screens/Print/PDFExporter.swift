import SwiftUI
import UIKit

/// SwiftUI の view を PDF のファイルに落とす。
///
/// `ImageRenderer` に**画で**なく `CGContext` を渡させるのがこの実装の要点である
/// (`render { size, draw in … }`)—— 画にすると紙は写真になり、拡大すれば字が潰れ、
/// A4 に刷ると解像度なりの粗さが出る。`UIGraphicsPDFRenderer` の文脈へそのまま描かせれば、
/// 文字は文字のまま PDF に入る(検索も選択もできる)。
///
/// ページは高さで切る。1 度だけ描いた内容を、ページごとに原点をずらして描き直し、ページの
/// 枠で切り抜く —— 同じ内容を何度も組み直さないので、20 日の旅程でも組み立ては 1 回で済む。
///
/// **座標系の裏返しを 1 度だけ戻す。** `ImageRenderer` が渡してくる描画は Core Graphics の
/// 素の向き(原点は左下・y は上向き)を前提に自分で天地を返すが、`UIGraphicsPDFRenderer` の
/// 文脈は UIKit の向き(原点は左上・y は下向き)で始まっている。そのまま描かせると天地が
/// 二度返って**上下逆さまの鏡文字**が刷れる(実際に 1 度そう刷れた)。だから内容を描く直前に
/// UIKit 側の裏返しを打ち消す。
enum PDFExporter {
  /// 72dpi の 11in。幅の既定(612 = 8.5in)と合わせて Letter、A4 にもそのまま収まる。
  static let pageHeight: CGFloat = 792

  /// 端末に置く一時ファイルの名前。旅ごとに変えないので、刷り直しても紙が溜まらない
  /// (同じ場所を上書きする)。
  static let fileName = "TripCheck.pdf"

  /// view を PDF にして、一時ファイルの場所を返す。
  ///
  /// `throws` なのは書き出しの失敗を**黙って隠さない**ため —— 返せる URL が無いのに URL を
  /// 返すと、共有シートは中身の無いファイルを配る。呼ぶ側(`PrintSheet`)は失敗を 1 行で言う。
  @MainActor
  static func render(_ view: some View, pageWidth: CGFloat = 612) throws -> URL {
    let renderer = ImageRenderer(content: view)
    // 高さは view に決めさせる。幅だけを渡すのが「紙の幅は決まっていて、長さは中身次第」
    // という紙の事情そのままの提案になる。
    renderer.proposedSize = ProposedViewSize(width: pageWidth, height: nil)

    let url = FileManager.default.temporaryDirectory.appending(path: fileName)
    var failure: (any Error)?
    var wrote = false

    renderer.render { size, draw in
      let page = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
      let pageCount = max(1, Int((size.height / pageHeight).rounded(.up)))
      do {
        try UIGraphicsPDFRenderer(bounds: page).writePDF(to: url) { context in
          for index in 0..<pageCount {
            context.beginPage()
            let cg = context.cgContext
            cg.saveGState()
            // 切り抜きが先。ずらしてから切ると、次のページの内容が今のページに残る。
            cg.clip(to: page)
            // このページに来る帯まで内容を送り(y は下向き)、
            cg.translateBy(x: 0, y: -CGFloat(index) * pageHeight)
            // そのうえで UIKit の裏返しを戻す —— 内容の**上端**が原点に来る。
            cg.translateBy(x: 0, y: size.height)
            cg.scaleBy(x: 1, y: -1)
            draw(cg)
            cg.restoreGState()
          }
        }
        wrote = true
      } catch {
        failure = error
      }
    }

    if let failure { throw failure }
    // `render` の閉包は同期で呼ばれるが、呼ばれなかった場合(中身の無い view)にも
    // 存在しないファイルの URL を返さない。
    guard wrote else { throw CocoaError(.fileWriteUnknown) }
    return url
  }
}
