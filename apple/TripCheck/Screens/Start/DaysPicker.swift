import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 何日の旅か。3・4・5 日と「未定」をタイルで出し、そのほかの日数(1〜14)は選択肢に畳む ——
/// Web と同じ形(`PlacesStep.tsx:227-277`)。
///
/// `nil` は「未定」で、旅行者が自分で選んだときだけそうなる(既定は 3 日)。未定のときだけ、
/// 日数を提案する旨の但し書きを出す。
struct DaysPicker: View {
  @Binding var days: Int?
  let locale: PlannerLocale

  /// タイルに出す日数。Web と同じ 3 枚。
  private static let tiles = [3, 4, 5]
  /// 選択肢に並ぶ日数の幅。エンジンが組めるのは 1〜14 日。
  private static let range = 1...14

  var body: some View {
    let app = AppCopy.for(locale)

    VStack(alignment: .leading, spacing: 10) {
      Text(app.daysQuestion)
        .tcFont(.dayHeader)
        .foregroundStyle(Tokens.Color.ink)

      HStack(spacing: 6) {
        ForEach(Self.tiles, id: \.self) { value in
          tile(label: app.daysValue(value), isChosen: days == value) { days = value }
        }
        tile(label: app.daysUndecided, isChosen: days == nil) { days = nil }
      }

      // 名前は自分で書く。`.menu` の `Picker` は見出しを畳んで選ばれている値しか出さないので、
      // 見出しを渡しただけだと「3日」とだけ出て、上のタイルと見分けが付かない。
      HStack(spacing: 8) {
        Text(app.daysOther)
          .tcFont(.body)
          .foregroundStyle(Tokens.Color.ink2)
        Spacer(minLength: 0)
        Picker(app.daysOtherLabel, selection: $days) {
          ForEach(Self.range, id: \.self) { value in
            Text(app.daysValue(value)).tag(Int?.some(value))
          }
          Text(app.daysUndecided).tag(Int?.none)
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Tokens.Color.ink2)
      }
      .frame(minHeight: Tokens.Hit.primary)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(app.daysOtherLabel)

      if days == nil {
        Text(app.daysUndecidedNote)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
      }
    }
  }

  /// 日数のタイル 1 枚。選ばれている 1 枚は色と `check` の両方で示す。
  private func tile(label: String, isChosen: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 4) {
        Text(label).tcFont(.stats)
        if isChosen { IconView(.check, size: 11, color: Tokens.Color.accentDeep) }
      }
      .foregroundStyle(isChosen ? Tokens.Color.accentDeep : Tokens.Color.ink2)
      .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary)
      .background(
        RoundedRectangle(cornerRadius: Tokens.Radius.control)
          .fill(isChosen ? Tokens.Color.accentSoft : Tokens.Color.tile)
      )
      .overlay(
        RoundedRectangle(cornerRadius: Tokens.Radius.control)
          .stroke(isChosen ? Tokens.Color.accent : Tokens.Color.line, lineWidth: 1)
      )
      .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.control))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityAddTraits(isChosen ? [.isButton, .isSelected] : .isButton)
  }
}
