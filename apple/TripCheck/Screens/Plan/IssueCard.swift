import SwiftUI
import TripCheckAppCore

/// 「確認したいこと N」—— 種類ごとに 1 行 + 行動 1 つ(`PlannerStore.issues` / `.issueCount`)。
///
/// **旅程の後ろに置く**(統合仕様 §5.5)。旅行者が最初に見たいのは自分の旅で、監査結果では
/// ない —— 上に置くと、成立している旅でも「まず確認事項を読む画面」になる。
///
/// 見出しの数(`issueCount`)と行の数は**わざと違う**。見つからない場所が 3 件なら見出しは
/// 3 と数え、行は「見つからない場所」の 1 行にまとまる。同じ心配を 3 行に割ると、旅行者は
/// 3 つの別々の問題として読む —— かつて「未確認の重要情報が10件」が 2 枚のカードの上に
/// 乗っていた不具合が、まさにその形だった。数の持ち主は `PlannerStore` ひとつである。
struct IssueCard: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let issues = store.issues
    if !issues.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        Text(AppCopy.for(store.request.locale).issuesHeading(count: store.issueCount))
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)

        ForEach(issues) { issue in
          VStack(alignment: .leading, spacing: 8) {
            Text(issue.text)
              .tcFont(.body)
              .foregroundStyle(Tokens.Color.ink2)
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
            // 行き先の表は `WarningActionButton` 1 か所だけ —— 同じ一手が、警告から
            // 押したときと課題カードから押したときで別の場所へ飛ばないように。
            if let action = issue.action { WarningActionButton(action: action) }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .accessibilityElement(children: .contain)
          .accessibilityIdentifier("plan.issue.\(issue.kind.rawValue)")
        }
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
      .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
      .accessibilityIdentifier("plan.issues")
    }
  }
}
