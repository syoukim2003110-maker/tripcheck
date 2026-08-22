import SwiftUI

/// ファーストビューの問い 5 つ目 ——「この日はどれだけ空いていて、あと何か所入るか」。
///
/// 出るのは**空いている日だけ**(`PlannerStore.spareCapacityLine` が `nil` を返す日には
/// この行そのものが無い)。埋まった日に「あと何か所」と誘わない。
struct SpareLine: View {
  let text: String

  var body: some View {
    Text(text)
      .tcFont(.meta)
      .foregroundStyle(Tokens.Color.muted)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityIdentifier("plan.spare")
  }
}
