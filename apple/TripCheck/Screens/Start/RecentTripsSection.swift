import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 入力画面の頭に置く「戻る道」3 つ —— 組みかけの旅程、端末に残せないという報せ、そして
/// 端末に残っている旅程の一覧。
///
/// 一覧が先頭にあるのは、アプリを開き直した旅行者がまずやりたいのが**続き**だからである。
/// 何も無ければ 1 行も出さない(初めての旅行者に空の棚を見せない)。
struct RecentTripsSection: View {
  @Environment(PlannerStore.self) private var store
  /// 消してよいかを尋ねている 1 件。尋ねている間は消さない。
  @State private var pendingDelete: StoredTripRecord?

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    Group {
      if store.bundle != nil || store.storageUnavailable || !store.recentTrips.isEmpty {
        VStack(alignment: .leading, spacing: 12) {
          if store.bundle != nil {
            Button(app.backToPlan) { store.view.screen = .plan }
              .buttonStyle(.secondaryPill)
              .tcFont(.body)
              .accessibilityIdentifier("start.backToPlan")
          }

          if store.storageUnavailable {
            Text(app.storageUnavailableNote)
              .tcFont(.body)
              .foregroundStyle(Tokens.Color.warnInk)
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(12)
              .background(RoundedRectangle(cornerRadius: Tokens.Radius.control).fill(Tokens.Color.warnBg))
              .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.control).stroke(Tokens.Color.warnBorder, lineWidth: 1))
              .accessibilityIdentifier("start.storageWarning")
          }

          if !store.recentTrips.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text(app.recentTripsTitle)
                .tcFont(.label)
                .foregroundStyle(Tokens.Color.muted)

              ForEach(store.recentTrips, id: \.id) { record in
                RecentTripRow(
                  record: record,
                  locale: store.request.locale,
                  onOpen: { Task { await store.openTrip(id: record.id) } },
                  onDelete: { pendingDelete = record }
                )
              }
            }
            .accessibilityIdentifier("start.recent")
            // 問いかけは一覧そのものに付ける —— 一覧が無いときこの節は 1 つも view を
            // 作らず、view の無いところに付けた修飾子は何もしない(`.task` を同じ場所に
            // 置いて一覧が永久に空だった、が実際に起きた)。
            .confirmationDialog(
              app.deleteTripQuestion(title: pendingDelete?.title ?? ""),
              isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
              titleVisibility: .visible
            ) {
              Button(app.deleteTripAction, role: .destructive) {
                if let record = pendingDelete {
                  Task { await store.deleteTrip(id: record.id) }
                }
                pendingDelete = nil
              }
              Button(app.hardEditCancel, role: .cancel) { pendingDelete = nil }
            }
          }
        }
      }
    }
  }
}

/// 端末に残っている旅程 1 件。題(先頭 3 か所の名前)で見分け、右端の印で消す。
///
/// 消すボタンを行の中に置くのは、`List` の外だから —— 横に払う操作(`swipeActions`)は
/// `List` の中でしか効かず、この画面は転がる 1 枚の紙(`ScrollView`)である。押した先で
/// 必ず一度尋ねる:消した旅程は戻らない。
private struct RecentTripRow: View {
  let record: StoredTripRecord
  let locale: PlannerLocale
  let onOpen: () -> Void
  let onDelete: () -> Void

  var body: some View {
    let app = AppCopy.for(locale)
    HStack(spacing: 4) {
      Button(action: onOpen) {
        VStack(alignment: .leading, spacing: 2) {
          Text(record.title)
            .tcFont(.stopName)
            .foregroundStyle(Tokens.Color.ink)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
          // 最後に触った日。時刻までは出さない —— 旅程を選ぶのに要るのは「いつごろの旅か」
          // であって、何時何分に保存されたかではない。
          Text(String(record.updatedAt.prefix(10)))
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
        }
        .frame(maxWidth: .infinity, minHeight: Tokens.Hit.primary, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityHint(app.openTripAction)
      .accessibilityIdentifier("start.recent.open")

      Button(action: onDelete) {
        IconView(.close, size: 16, color: Tokens.Color.muted)
          .frame(width: Tokens.Hit.primary, height: Tokens.Hit.primary)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(app.deleteTripAction)
      .accessibilityIdentifier("start.recent.delete")
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
    .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("start.recent.row")
  }
}
