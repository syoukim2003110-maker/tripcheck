import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 出発前チェック(旅券・入国認証・薬・国ごとの基本)。
///
/// 判定は Kit の `PreTripTimeline` が、渡し方は `PlannerStore.beforeYouGo` が持つので、
/// この画面がするのは**急ぎ具合を色にする**ことだけである:期限切れは赤、期限接近は黄、
/// それ以外は無色。3 段階しか無いのは、4 段階目を作った瞬間にどれが今日やることなのかが
/// 読めなくなるからである。
///
/// 旅券の有効期限は**この端末にしか無い**(`UserDefaults`)。どこへも送らないと決めておくと、
/// 「送っていないか」を後から確かめる仕事そのものが生まれない。
struct BeforeYouGoCard: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let locale = store.request.locale
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)
    let model = store.beforeYouGo

    DisclosureCard(title: text.beforeHeading) {
      VStack(alignment: .leading, spacing: 14) {
        // 1. 誰の旅券か。選ぶまで(そして日本以外を選んだら)入国の判定は出さない。
        VStack(alignment: .leading, spacing: 6) {
          Text(text.passportCountry)
            .tcFont(.label)
            .foregroundStyle(Tokens.Color.muted)
          SegmentedPills(
            options: [
              (PassportCountry.unset, app.passportUnsetShort),
              (PassportCountry.jp, text.passportJapan),
              (PassportCountry.other, text.passportOther),
            ],
            selection: model.passportCountry,
            groupLabel: text.passportCountry,
            onSelect: { store.setPassportCountry($0) }
          )
          .accessibilityIdentifier("plan.passport.country")
          if model.passportCountry == .unset {
            Note(text: text.passportUnset)
          } else if model.passportCountry == .other {
            Note(text: text.passportUnsupported)
          }
        }

        // 2. 日本の旅券のときだけ、残存期間を測るための 1 日を訊く。
        if model.passportCountry == .jp {
          PassportExpiryField()
        }

        // 3. 期限のある宿題。
        ForEach(model.items) { item in
          BeforeYouGoRow(item: item, officialLabel: text.essentialsOfficial, overdue: text.beforeOverdue, dueSoon: text.beforeDueSoon)
        }

        // 4. 薬。国内の旅には出ない。
        if !model.medicineLines.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(model.medicineLines.enumerated()), id: \.offset) { index, line in
              Text(line)
                .tcFont(index == 0 ? .body : .meta)
                .foregroundStyle(index == 0 ? Tokens.Color.ink : Tokens.Color.muted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
          }
          .accessibilityElement(children: .combine)
          .accessibilityIdentifier("plan.beforeyougo.medicine")
        }

        // 5. 国ごとの基本。旅券の国とは無関係に読める(プラグの形も救急番号も同じ)。
        if !model.essentials.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(model.essentials.enumerated()), id: \.offset) { _, row in
              VStack(alignment: .leading, spacing: 2) {
                Text(row.label)
                  .tcFont(.label)
                  .foregroundStyle(Tokens.Color.muted)
                Text(row.value)
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.ink2)
                  .fixedSize(horizontal: false, vertical: true)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .accessibilityElement(children: .combine)
            }
          }
          .accessibilityIdentifier("plan.beforeyougo.essentials")
        }
      }
      .padding(.top, 4)
    }
    .accessibilityIdentifier("plan.beforeyougo")
  }
}

// MARK: - 1 行

/// 宿題 1 件。**急ぎの語は文の前に置く**(「要対応 ·」)—— 色を見分けにくい読み手にも、
/// 読み上げにも、同じ順で同じことが伝わる。
private struct BeforeYouGoRow: View {
  let item: BeforeYouGoItem
  let officialLabel: String
  let overdue: String
  let dueSoon: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(headline)
        .tcFont(.body)
        .foregroundStyle(ink)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      Text(item.detail)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let url = item.url {
        Link(destination: url) {
          HStack(spacing: 4) {
            Text(officialLabel).tcFont(.label)
            IconView(.external, size: 11, color: Tokens.Color.accentDeep)
          }
          .foregroundStyle(Tokens.Color.accentDeep)
          .frame(minHeight: Tokens.Hit.primary, alignment: .leading)
          .contentShape(Rectangle())
        }
        .accessibilityLabel(officialLabel)
      }
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(background))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(border, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("plan.beforeyougo.\(item.id)")
  }

  /// 「要対応 · パスポートの残存期間が…」。急ぎでない行には印を付けない —— 全部に印が
  /// 付いた一覧は、印の無い一覧と同じである。
  private var headline: String {
    switch item.urgency {
    case .overdue: "\(overdue) · \(item.label)"
    case .due_soon: "\(dueSoon) · \(item.label)"
    case .scheduled, .info: item.label
    }
  }

  private var ink: Color {
    switch item.urgency {
    case .overdue: Tokens.Color.danger
    case .due_soon: Tokens.Color.warnInk
    case .scheduled, .info: Tokens.Color.ink
    }
  }

  private var background: Color {
    switch item.urgency {
    case .overdue: Tokens.Color.accentSoft
    case .due_soon: Tokens.Color.warnBg
    case .scheduled, .info: Tokens.Color.tile
    }
  }

  private var border: Color {
    switch item.urgency {
    case .overdue: Tokens.Color.accent
    case .due_soon: Tokens.Color.warnBorder
    case .scheduled, .info: Tokens.Color.line
    }
  }
}

// MARK: - 旅券の有効期限

/// 日付を 1 つ。押した瞬間に端末へ書き、判定はその場で更新される。
///
/// 選ぶまでは今日を映すが、**触るまで何も保存しない** —— 開いただけで「今日が期限の旅券」を
/// 記録すると、次に開いた旅行者は自分が入れた覚えのない日付を見ることになる。
private struct PassportExpiryField: View {
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let text = Copy.for(store.request.locale)
    VStack(alignment: .leading, spacing: 4) {
      DatePicker(text.beforePassportLabel, selection: expiry, displayedComponents: .date)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.ink2)
        .frame(minHeight: Tokens.Hit.primary)
        .accessibilityIdentifier("plan.passport.expiry")
      Note(text: text.beforePassportHint)
    }
  }

  /// `YYYY-MM-DD` と `Date` の往復。暦は Kit と同じ UTC のグレゴリオ暦で持つ —— 端末の
  /// 時間帯で日付が 1 日ずれると、残存期間の判定も 1 日ずれる。
  private var expiry: Binding<Date> {
    Binding(
      get: { store.passportExpiry.flatMap(Self.date) ?? Date() },
      set: { store.setPassportExpiry(Self.calendarDate(from: $0)) }
    )
  }

  private static var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }

  private static func date(_ text: String) -> Date? {
    guard let parsed = CalendarDate(text) else { return nil }
    return utc.date(from: DateComponents(year: parsed.year, month: parsed.month, day: parsed.day))
  }

  private static func calendarDate(from date: Date) -> String? {
    let parts = utc.dateComponents([.year, .month, .day], from: date)
    guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
    return CalendarDate(year: year, month: month, day: day)?.description
  }
}

/// 補足の 1 行。**消さずに残す** —— 「日本の旅券だけ判定できる」を出さないと、他の旅券の
/// 持ち主は「何も問題が無い」と読む。
private struct Note: View {
  let text: String

  var body: some View {
    Text(text)
      .tcFont(.meta)
      .foregroundStyle(Tokens.Color.muted)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}
