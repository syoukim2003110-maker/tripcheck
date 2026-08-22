import SwiftUI
import TripCheckAppCore
import TripCheckKit

/*
 * 確認画面に畳んである「旅の条件」—— 日数・日付・ホテル・ペース・移動手段・1 日の開始と
 * 終わり・移動ごとの余白・1 区間の徒歩と乗換の上限。
 *
 * Start 画面と同じ部品(`DaysPicker` / `DatePickerRow` / `CustomOptions`)をそのまま使う ——
 * 同じことを 2 か所で聞くなら、同じ顔で聞く。ここにしか無いのは、Start では畳んでいた
 * 細かい 4 つ(開始・終わり・余白・上限)である。
 *
 * 書き先は `request` の単純な欄か、`store` の setter 経由の `edit` に限る。旅程を組む前の
 * 条件なので、組み上がった後に同じ値を変えるのは別の話(Task 9 のガード付き編集)。
 */
struct ConditionsSection: View {
  @Environment(PlannerStore.self) private var store

  /// 1 日の始まりの 3 択。値は Web と同じ `HH:MM`(`ResolveScreen.tsx:398`)。
  private static let dayStarts = ["08:00", "09:00", "10:30"]
  /// 1 日の終わりの 3 択。空文字はエンジンの既定(22:00)に任せる、という意味の番兵。
  private static let dayEnds = ["", "19:30", "21:30"]
  /// 1 区間の徒歩上限に選ばせる分数。既定(30 分)は `nil` 側の選択肢が持つ。
  private static let walkingChoices = [10, 15, 20, 30, 45, 60, 90, 120, 180]
  /// 1 区間の乗換上限。エンジンが受ける幅は 0〜8 回。
  private static let transferChoices = Array(0...8)

  var body: some View {
    @Bindable var store = store
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)

    VStack(alignment: .leading, spacing: 16) {
      DaysPicker(days: $store.request.tripDays, locale: store.request.locale)

      VStack(alignment: .leading, spacing: 6) {
        Text(text.date)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        DatePickerRow(date: $store.request.tripStartDate, locale: store.request.locale)
      }

      CustomOptions()

      VStack(alignment: .leading, spacing: 6) {
        Text(text.timebandHeading)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        SegmentedPills(
          options: [
            (Self.dayStarts[0], text.timebandEarly),
            (Self.dayStarts[1], text.timebandNormal),
            (Self.dayStarts[2], text.timebandLate),
          ],
          selection: store.request.dayStartDefault,
          groupLabel: text.timebandHeading,
          onSelect: { store.request.dayStartDefault = $0 }
        )
      }

      VStack(alignment: .leading, spacing: 6) {
        Text(text.dayEndHeading)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        SegmentedPills(
          options: [
            (Self.dayEnds[0], text.dayEndNone),
            (Self.dayEnds[1], Self.dayEnds[1]),
            (Self.dayEnds[2], Self.dayEnds[2]),
          ],
          // `nil`(未指定)と `""` は同じ意味なので、選ばれている 1 つを `""` に畳んで比べる。
          selection: store.request.dayEndTarget ?? "",
          groupLabel: text.dayEndHeading,
          onSelect: { store.request.dayEndTarget = $0.isEmpty ? nil : $0 }
        )
      }

      VStack(alignment: .leading, spacing: 6) {
        Text(app.bufferHeading)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        SegmentedPills(
          options: EngineConstants.transferBufferChoices.sorted().map { ($0, app.minutesShort($0)) },
          selection: store.edit.transferBufferMinutes,
          groupLabel: app.bufferHeading,
          onSelect: { store.setTransferBufferMinutes($0) }
        )
      }

      // 上限の 2 つは選択肢に畳む。数を打たせると「空欄 = 既定」という約束が画面に出ず、
      // 消したつもりが 0 になる。既定はそれ自身が 1 つの選択肢として並ぶ。
      optionalNumber(
        title: app.maxWalkingHeading,
        note: app.maxWalkingNote,
        defaultLabel: app.maxWalkingDefault,
        choices: Self.walkingChoices,
        label: { app.minutesShort($0) },
        selection: $store.request.maxWalkingMinutesPerLeg
      )

      optionalNumber(
        title: app.maxTransfersHeading,
        note: app.maxTransfersNote,
        defaultLabel: app.maxTransfersDefault,
        choices: Self.transferChoices,
        // 回数そのものは文ではないので、数字だけを出す(単位は見出しが言っている)。
        label: { "\($0)" },
        selection: $store.request.maxTransfersPerLeg
      )
    }
  }

  /// 「決めなくてよい数」1 つぶん。既定を選ぶと `nil` に戻り、エンジンの既定に任せる。
  private func optionalNumber(
    title: String,
    note: String,
    defaultLabel: String,
    choices: [Int],
    label: @escaping (Int) -> String,
    selection: Binding<Int?>
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(title)
          .tcFont(.dayHeader)
          .foregroundStyle(Tokens.Color.ink)
        Spacer(minLength: 0)
        Picker(title, selection: selection) {
          Text(defaultLabel).tag(Int?.none)
          ForEach(choices, id: \.self) { value in
            Text(label(value)).tag(Int?.some(value))
          }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Tokens.Color.ink2)
      }
      .frame(minHeight: Tokens.Hit.primary)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(title)

      Text(note)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
    }
  }
}
