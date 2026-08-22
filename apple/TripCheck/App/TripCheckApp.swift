import SwiftUI

/// アプリの入口。画面は常に明るい配色で出す —— 紙の上の旅程表という見立てなので、
/// 端末の暗い配色に合わせて色を反転させない。
@main
struct TripCheckApp: App {
  var body: some Scene {
    WindowGroup {
      RootView().preferredColorScheme(.light)
    }
  }
}
