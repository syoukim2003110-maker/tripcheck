import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 停留所シートの「営業時間・根拠を見る」。
///
/// **既定は閉じている。** 旅行者が最初に知りたいのは何時にどこへ行くかで、その裏付けは
/// 疑ったときに開くもの —— 常に開いていると、確かめる必要のない場所まで確かめさせられる。
/// 開くと、滞在時間が誰の言い分か(v3.1 §2.1 はこの印をタイムラインではなくここに置く)と、
/// 場所ごとの事実が 1 行ずつ並ぶ。
///
/// 開閉そのものは `DisclosureCard` に任せる —— 折り畳みの見た目と `reduceMotion` の扱いを
/// ここにもう一組持つと、片方だけ直された日に、同じアプリの中で開き方が 2 通りになる。
/// ここに残るのは**中身**だけである。
///
/// 文は 1 つも作らない —— 題は `TimelinePresentation.evidenceDisclosureLabel`、滞在の 1 行と
/// その根拠は `stayLine` / `stayBasisLine`、印の語は `durationSourceLabel` から来る。
struct EvidenceDisclosure: View {
  @Environment(PlannerStore.self) private var store
  let model: StopInspectorModel

  var body: some View {
    DisclosureCard(title: TimelinePresentation.evidenceDisclosureLabel(store.request.locale)) {
      VStack(alignment: .leading, spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text(model.stayHeadline)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
          Text(model.stayBasisLine)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        ForEach(model.evidenceLines) { line in
          factRow(line)
        }
      }
    }
    .accessibilityIdentifier("detail.evidence")
  }

  /// 事実 1 件 ——「何について」「中身」「誰が言っているか」。3 つ目が **1 語で右端に**
  /// 立つのは、行を横に読んだときに確かさが最後に来るほうが、数を先に読めるから。
  private func factRow(_ line: EvidenceLine) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      VStack(alignment: .leading, spacing: 1) {
        Text(line.label)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.ink2)
          .fixedSize(horizontal: false, vertical: true)
        Text(line.value)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 0)
      Text(line.status)
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.ink2)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.pill).fill(Tokens.Color.tile))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
