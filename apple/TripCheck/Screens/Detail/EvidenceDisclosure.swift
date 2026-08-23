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
/// 文は 1 つも作らない —— 題は `TimelinePresentation.evidenceDisclosureLabel`、滞在の 1 行と
/// その根拠は `stayLine` / `stayBasisLine`、印の語は `durationSourceLabel` から来る。
struct EvidenceDisclosure: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let model: StopInspectorModel

  @State private var isOpen = false

  var body: some View {
    let title = TimelinePresentation.evidenceDisclosureLabel(store.request.locale)

    VStack(alignment: .leading, spacing: 0) {
      Button {
        if reduceMotion {
          isOpen.toggle()
        } else {
          withAnimation(.easeInOut(duration: 0.2)) { isOpen.toggle() }
        }
      } label: {
        HStack(spacing: 10) {
          Text(title)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
            .frame(maxWidth: .infinity, alignment: .leading)
          IconView(.arrow, size: 14, color: Tokens.Color.muted)
            .rotationEffect(.degrees(isOpen ? 90 : 0))
        }
        .padding(.horizontal, 14)
        .frame(minHeight: Tokens.Hit.primary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(title)
      .accessibilityAddTraits(isOpen ? [.isButton, .isSelected] : .isButton)

      if isOpen {
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
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
      }
    }
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
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
