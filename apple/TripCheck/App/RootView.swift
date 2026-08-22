import SwiftUI

/// いちばん外側の画面。今は名前が出るだけで、旅程の入口(Task 3 以降)がここに入る。
struct RootView: View {
  var body: some View {
    Text(verbatim: "TripCheck")
      .tcFont(.display)
      .foregroundStyle(Tokens.Color.ink)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Tokens.Color.bg)
  }
}

#Preview {
  RootView()
}
