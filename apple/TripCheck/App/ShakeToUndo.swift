import SwiftUI
import UIKit

/// 端末を振ると 1 つ前に戻る —— iOS がずっと持っている「取り消し」の作法。
///
/// SwiftUI にはこれを受ける口が無い(`UIEvent.EventSubtype.motionShake` は
/// `UIResponder.motionEnded` にしか届かない)ので、`UIWindow` の側で受けて通知に載せ替え、
/// 結果画面が `.onReceive` で拾う。窓は 1 つしかないので、通知も 1 度しか出ない。
///
/// **画面側は「振られた」としか聞かない。** 戻せる履歴があるかどうか、何を戻すのかは
/// `PlannerStore` が決める —— ここが store を知ると、まだ旅程の無い画面で振っただけで
/// 何かが起きうる形になる。
extension Notification.Name {
  static let tripCheckShakeToUndo = Notification.Name("tripcheck.shakeToUndo")
}

extension UIWindow {
  open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    super.motionEnded(motion, with: event)
    guard motion == .motionShake else { return }
    NotificationCenter.default.post(name: .tripCheckShakeToUndo, object: nil)
  }
}
