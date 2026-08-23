import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 「結論の詳細」—— 日数ステッパー・重要事実の 3 数・カバレッジ・代替案の差分・仮定・注意。
///
/// **畳んだまま旅程の後ろにいる**(docs/product.md:「Evidence counts, regional coverage,
/// assumptions and counterfactuals … are not a dashboard placed before the itinerary」)。
/// 開く手は 2 つ:この見出しを押すか、警告の「代替案を見る」を押すか —— どちらも
/// `view.verdictExpanded` を書くので、開いているかどうかは 1 か所にしかない。
///
/// この画面は数を 1 つも作らない。差分の数は `PlannerStore.verdictDetails` が
/// `TripScenarioMetrics` から**生のまま**運んでくる(90 分は「90分」で、「1時間30分」では
/// ない)—— 件数を時間に見せず、負の余白を 0 に丸めないため。
struct VerdictDetails: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    @Bindable var store = store
    let locale = store.request.locale
    let app = AppCopy.for(locale)
    let model = store.verdictDetails

    DisclosureCard(title: app.verdictDetailsTitle, isOpen: $store.view.verdictExpanded) {
      VStack(alignment: .leading, spacing: 16) {
        DayStepperRow(model: model)
        FactCountsRow(model: model)
        CoverageRow(model: model)
        if let comparison = model.comparison {
          ComparisonSection(cards: [comparison.original, comparison.minimalRepair, comparison.shortest])
        }
        if !model.alternatives.isEmpty {
          AlternativesSection(alternatives: model.alternatives)
        }
        AssumptionsSection(lines: model.assumptions)
        if !model.attentions.isEmpty {
          BulletDisclosure(title: app.attentionsHeading, lines: model.attentions, identifier: "plan.verdict.attentions")
        }
      }
      .padding(.top, 4)
    }
    .accessibilityIdentifier("plan.verdict")
  }
}

// MARK: - 日数

/// 旅の長さを 1 日ずつ動かす。**押すたびに旅程を組み直し、壊れる約束があれば先に訊く** ——
/// `changeTripDays` は他の 10 の編集と同じ関所を通る(統合仕様 §5.1)。
///
/// 端に着いたら閉じる側の手を `nil` にする:消してしまうと、なぜ動かないのかが読めない。
private struct DayStepperRow: View {
  @Environment(PlannerStore.self) private var store
  let model: VerdictDetailsModel

  var body: some View {
    let text = Copy.for(store.request.locale)
    let days = model.daysStepper
    Stepper(
      onIncrement: days.value >= days.max ? nil : { Task { await store.changeTripDays(days.value + 1) } },
      onDecrement: days.value <= days.min ? nil : { Task { await store.changeTripDays(days.value - 1) } }
    ) {
      HStack(spacing: 8) {
        Text(text.fitSelectedDays)
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.ink2)
        Spacer(minLength: 0)
        Text(text.fitDaysValue(days.value))
          .tcFont(.stats)
          .foregroundStyle(Tokens.Color.ink)
      }
    }
    .frame(minHeight: Tokens.Hit.primary)
    .accessibilityLabel(text.fitSelectedDays)
    .accessibilityValue(text.fitDaysValue(days.value))
    .accessibilityIdentifier("plan.verdict.days")
  }
}

// MARK: - 重要情報の 3 数

/// 確認済み・推定・未確認。**合計は作らない** —— 判定が数えた 3 つをそのまま出す。
private struct FactCountsRow: View {
  @Environment(PlannerStore.self) private var store
  let model: VerdictDetailsModel

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    HStack(spacing: 8) {
      tile(count: model.factCounts.verified, label: app.factVerified, color: Tokens.Color.good)
      tile(count: model.factCounts.estimated, label: app.factEstimated, color: Tokens.Color.warnInk)
      tile(count: model.factCounts.unknown, label: app.factUnknown, color: Tokens.Color.muted)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("plan.verdict.facts")
  }

  private func tile(count: Int, label: String, color: Color) -> some View {
    VStack(spacing: 2) {
      Text(String(count))
        .tcFont(.stats)
        .foregroundStyle(color)
      Text(label)
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.muted)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 10)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.tile))
    .accessibilityElement(children: .combine)
  }
}

// MARK: - 地域の対応

/// この地域をどこまで確かめてあるか。**測っていない領域があるときだけ色を変える** ——
/// 深い地域で毎回警戒色を出すと、色そのものが読み飛ばされる。
private struct CoverageRow: View {
  @Environment(PlannerStore.self) private var store
  let model: VerdictDetailsModel

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    HStack(spacing: 8) {
      Text(app.coverageHeading)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)
      Spacer(minLength: 0)
      Text(model.coverage.label)
        .tcFont(.label)
        .foregroundStyle(model.coverage.hasUnknown ? Tokens.Color.warnInk : Tokens.Color.ink2)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
          RoundedRectangle(cornerRadius: Tokens.Radius.pill)
            .fill(model.coverage.hasUnknown ? Tokens.Color.warnBg : Tokens.Color.tile)
        )
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.verdict.coverage")
  }
}

// MARK: - 3 つの見方(貼り付けた旅程だけ)

/// 元の案・最小修正版・移動を減らす案。iPhone では横に並べず**縦に積む** —— 3 列に割ると、
/// 数が読めない幅になる。
private struct ComparisonSection: View {
  @Environment(PlannerStore.self) private var store
  let cards: [VerdictComparisonCard]

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    VStack(alignment: .leading, spacing: 8) {
      Text(app.comparisonHeading)
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)
      ForEach(cards) { card in
        VStack(alignment: .leading, spacing: 6) {
          Text(card.label)
            .tcFont(.label)
            .foregroundStyle(Tokens.Color.muted)
          Text(card.detail)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
          ForEach(Array(card.rows.enumerated()), id: \.offset) { _, row in
            HStack(spacing: 8) {
              Text(row.label)
                .tcFont(.meta)
                .foregroundStyle(Tokens.Color.muted)
              Spacer(minLength: 0)
              Text(row.value)
                .tcFont(.meta)
                .foregroundStyle(Tokens.Color.ink2)
            }
          }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.tile))
        .accessibilityElement(children: .contain)
      }
    }
    .accessibilityIdentifier("plan.verdict.comparison")
  }
}

// MARK: - 代替案

/// 比較できる変更案(3 件まで)。1 枚ごとに **6 行の差分表**と、失うものの 1 行と、
/// 「この変更を適用」が付く。適用は `store.applyAlternative` —— 代替案を採るのも編集なので、
/// 予約に遅れるなら先に訊かれる(`PlannerStore+Edits.swift` の関所)。
private struct AlternativesSection: View {
  @Environment(PlannerStore.self) private var store
  let alternatives: [AlternativeModel]

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    VStack(alignment: .leading, spacing: 10) {
      Text(app.alternativesHeading)
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)
      ForEach(alternatives) { alternative in
        VStack(alignment: .leading, spacing: 8) {
          Text(alternative.title)
            .tcFont(.stopName)
            .foregroundStyle(Tokens.Color.ink)
            .fixedSize(horizontal: false, vertical: true)

          DiffTable(rows: alternative.diff, before: app.diffBefore, after: app.diffAfter)

          if let loss = alternative.lossLine {
            Text(loss)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.warnInk)
              .fixedSize(horizontal: false, vertical: true)
          }

          Button(app.applyAlternative) {
            Task { await store.applyAlternative(alternative.apply) }
          }
          .buttonStyle(.secondaryPill)
          .tcFont(.body)
          .accessibilityIdentifier("plan.verdict.apply")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.panel))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
      }
    }
    .accessibilityIdentifier("plan.verdict.alternatives")
  }
}

/// 変更前と変更後を 1 行ずつ。読み上げは 1 行を 1 つの塊にまとめる —— 「重大な衝突」
/// 「2」「0」と 3 つに割れて読まれると、どの数がどちらの案のものか分からなくなる。
private struct DiffTable: View {
  let rows: [(label: String, before: String, after: String)]
  let before: String
  let after: String

  var body: some View {
    VStack(spacing: 4) {
      HStack(spacing: 8) {
        Spacer(minLength: 0)
        Text(before).frame(minWidth: 60, alignment: .trailing)
        Text(after).frame(minWidth: 60, alignment: .trailing)
      }
      .tcFont(.label)
      .foregroundStyle(Tokens.Color.muted)
      .accessibilityHidden(true)

      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        HStack(spacing: 8) {
          Text(row.label)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
          Spacer(minLength: 0)
          Text(row.before)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
            .frame(minWidth: 60, alignment: .trailing)
          Text(row.after)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.ink)
            .frame(minWidth: 60, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.label). \(before) \(row.before). \(after) \(row.after)")
      }
    }
  }
}

// MARK: - 前提と注意

/// この結論が何を前提にしているか。**1 つも無いときも 1 行出す** —— 空の折り畳みは
/// 「まだ調べていない」に読める。
private struct AssumptionsSection: View {
  @Environment(PlannerStore.self) private var store
  let lines: [String]

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    BulletDisclosure(
      title: app.assumptionsHeading(count: lines.count),
      lines: lines.isEmpty ? [app.assumptionsNone] : lines,
      identifier: "plan.verdict.assumptions"
    )
  }
}

/// 箇条書き 1 枚。点は絵ではなく丸なので、`Design/Icons` の 24 種にも SF Symbols にも
/// 出番が無い。
private struct BulletDisclosure: View {
  let title: String
  let lines: [String]
  let identifier: String

  var body: some View {
    DisclosureCard(title: title) {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
              .fill(Tokens.Color.muted)
              .frame(width: 4, height: 4)
              .accessibilityHidden(true)
            Text(line)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      }
      .padding(.top, 4)
    }
    .accessibilityIdentifier(identifier)
  }
}
