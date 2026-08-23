import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 画面の下に一瞬出る 1 行(モデルは `TripCheckAppCore` の `Toast`)。
///
/// 「元に戻す」がここに乗るのは、**直前の一手を消すのがいちばん近いところ**だから ——
/// ツールバーの奥まで戻らせない。取り消せないトースト(入力の上限など)はボタンを出さない:
/// 押しても何も起きないボタンを置くと、次からは取り消せるトーストのボタンも信用されなくなる。
///
/// 読み上げ:`.updatesFrequently` で「勝手に変わる場所」だと告げ、出た瞬間に 1 度だけ文を
/// 読み上げる。割り込まない優先度なので、旅行者が読んでいる途中の文を切らない。
struct ToastView: View {
  @Environment(PlannerStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let toast: Toast

  var body: some View {
    let app = AppCopy.for(store.request.locale)

    HStack(spacing: 12) {
      Text(toast.text)
        .tcFont(.body)
        .foregroundStyle(Tokens.Color.panel)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      if toast.canUndo {
        Button {
          Task {
            await store.undo()
            AccessibilityNotification.Announcement(app.undoneAnnouncement).post()
          }
        } label: {
          Text(app.undoAction)
            .tcFont(.label)
            .foregroundStyle(Tokens.Color.panel)
            .padding(.horizontal, 12)
            .frame(minHeight: Tokens.Hit.primary)
            .overlay(
              RoundedRectangle(cornerRadius: Tokens.Radius.pill)
                .stroke(Tokens.Color.panel.opacity(0.6), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.pill))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("toast.undo")
      }
    }
    .padding(.leading, 16)
    .padding(.trailing, toast.canUndo ? 8 : 16)
    .padding(.vertical, 8)
    .frame(minHeight: Tokens.Hit.primary)
    .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.ink))
    .padding(.horizontal, 16)
    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.updatesFrequently)
    .accessibilityIdentifier("toast")
    .onAppear { AccessibilityNotification.Announcement(toast.text).post() }
  }
}

#Preview {
  let store = PlannerStore(resolvers: [], store: nil)
  let app = AppCopy.for(.ja)
  let text = [app.editedToast, VerdictCopy.bufferToastDetail(-30, locale: .ja)].compactMap { $0 }.joined(separator: " ")
  return ToastView(toast: Toast(text: text, kind: .edit, canUndo: true))
    .environment(store)
}
