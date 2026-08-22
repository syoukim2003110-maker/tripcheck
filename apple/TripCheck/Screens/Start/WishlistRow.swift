import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 行きたい場所リストの 1 行。名前・場所が決まった印・貼り付けから読み取った条件(日・時刻・
/// 予約・滞在)・優先度の 3 つ組・外すボタン。
///
/// 外すのは**押せるボタン**にしてある —— 行きたい場所リストは `ScrollView` の中の縦並びで、
/// `List` の横滑りは使えない。隠れた操作より、見えている的のほうが確実に届く。
struct WishlistRow: View {
  let entry: WishlistEntry
  let locale: PlannerLocale
  let onPriority: (WishlistPriority) -> Void
  let onEdit: () -> Void
  let onRemove: () -> Void

  var body: some View {
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)

    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 8) {
        if entry.pinned != nil {
          IconView(.check, size: 14, color: Tokens.Color.good)
        }
        // 名前そのものを押せるボタンにする。カード全体のタップでも同じシートが開くが、
        // 手のひらで撫でて回る VoiceOver には「押せるもの」しか見えないので、行編集へ
        // 届く的をここに 1 つ置く。
        Button(action: onEdit) {
          Text(entry.text)
            .tcFont(.stopName)
            .foregroundStyle(Tokens.Color.ink)
            .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(app.editEntryAction)
        Button(action: onRemove) {
          IconView(.close, size: 16, color: Tokens.Color.muted)
            .frame(width: Tokens.Hit.primary, height: Tokens.Hit.primary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text.resolveRemoveAria(entry.text))
      }

      if !chips.isEmpty {
        HStack(spacing: 6) {
          ForEach(chips, id: \.self) { chip in
            Text(chip)
              .tcFont(.label)
              .foregroundStyle(Tokens.Color.ink2)
              .padding(.horizontal, 8)
              .padding(.vertical, 4)
              .background(
                RoundedRectangle(cornerRadius: Tokens.Radius.pill).fill(Tokens.Color.tile)
              )
          }
        }
      }

      SegmentedPills(
        options: [
          (WishlistPriority.normal, app.priorityNormal),
          (WishlistPriority.must, text.must),
          (WishlistPriority.optional, text.optional),
        ],
        selection: entry.priority,
        groupLabel: app.priorityLabel(name: entry.text),
        onSelect: onPriority
      )
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel)
    )
    .overlay(
      RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1)
    )
    .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.card))
    .onTapGesture(perform: onEdit)
  }

  /// 貼り付けから読み取れた条件だけを、読み取れた順に。無い条件はチップも出さない。
  private var chips: [String] {
    let text = Copy.for(locale)
    var out: [String] = []
    if let day = entry.fixedDay { out.append(text.previewDay(day)) }
    if let time = entry.fixedTime {
      out.append(entry.isReservation ? "\(time) \(text.reservation)" : time)
    } else if entry.isReservation {
      out.append(text.reservation)
    }
    if let stay = entry.stayMinutes { out.append(text.previewStay(stay)) }
    return out
  }
}
