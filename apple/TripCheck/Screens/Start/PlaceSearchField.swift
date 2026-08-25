import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 行きたい場所を 1 件ずつ入れる窓。打つ手を止めると端末の地図が候補を出し、選べば同名の
/// 別の場所と取り違えない。**候補が出なくても進める** —— Return を押せば打った名前のまま
/// 足せる(候補は近道であって、関所ではない)。
struct PlaceSearchField: View {
  @Bindable var suggestions: AppleSuggestions
  let webSuggestions: WorkerSuggestions
  /// 足すときに呼ばれる。第 2 引数は候補から選んだときだけ付く。
  let onSubmit: (String, PlaceSuggestion?) -> Void

  @Environment(PlannerStore.self) private var store
  @Environment(\.isEnabled) private var isEnabled
  @FocusState private var isFocused: Bool

  /// 候補は 5 行まで。iPhone の 1 画面に収まる数で、下の行きたい場所リストを押し出さない。
  private static let visibleSuggestions = 5
  /// Google 行は 3 行まで。Apple の下に添える区画なので、より控えめな数にする。
  private static let visibleWebSuggestions = 3

  var body: some View {
    let text = Copy.for(store.request.locale)
    let app = AppCopy.for(store.request.locale)
    let webRows = self.webRows

    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 10) {
        IconView(.search, size: 18, color: Tokens.Color.muted)
        TextField(app.placeFieldPlaceholder, text: $suggestions.query)
          .tcFont(.stopName)
          .foregroundStyle(Tokens.Color.ink)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.done)
          .focused($isFocused)
          .onSubmit { submitTypedName() }
          .onChange(of: suggestions.query) { store.intentQueryChanged() }
          .onChange(of: suggestions.query) { _, newValue in webSuggestions.query = newValue }
          .accessibilityLabel(text.inputLabel)
          .accessibilityIdentifier("start.placeField")
        Button { submitTypedName() } label: {
          IconView(.plus, size: 20, color: Tokens.Color.accent)
            .frame(width: Tokens.Hit.primary, height: Tokens.Hit.primary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(typedName.isEmpty)
        .accessibilityLabel(app.addPlaceLabel)
      }
      .padding(.leading, 14)
      .frame(minHeight: Tokens.Hit.primary + 8)
      .background(
        RoundedRectangle(cornerRadius: Tokens.Radius.control)
          .fill(isEnabled ? Tokens.Color.panel : Tokens.Color.tile)
      )
      .overlay(
        RoundedRectangle(cornerRadius: Tokens.Radius.control)
          .stroke(isFocused ? Tokens.Color.focus : Tokens.Color.controlBorder, lineWidth: isFocused ? 2 : 1)
      )

      if suggestions.state == .unavailable {
        Text(app.suggestionsUnavailable)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
          .padding(.top, 8)
      }

      if store.intentRowVisible(for: suggestions.query) || !suggestions.results.isEmpty || !webRows.isEmpty {
        VStack(spacing: 0) {
          if store.intentRowVisible(for: suggestions.query) {
            Button {
              let text = suggestions.query
              Task {
                if let query = await store.readTripIntent(from: text) {
                  suggestions.query = query
                }
              }
            } label: {
              HStack(spacing: 8) {
                if store.intentPhase == .reading {
                  ProgressView().controlSize(.small)
                }
                VStack(alignment: .leading, spacing: 2) {
                  Text(store.intentPhase == .reading ? app.intentParsing : app.intentRowTitle)
                    .tcFont(.stopName)
                    .foregroundStyle(Tokens.Color.ink)
                  if store.intentPhase == .failed {
                    Text(app.intentFailed)
                      .tcFont(.meta)
                      .foregroundStyle(Tokens.Color.muted)
                  }
                }
                Spacer(minLength: 0)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 14)
              .padding(.vertical, 8)
              .frame(minHeight: Tokens.Hit.primary)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(store.intentPhase == .reading)
            .accessibilityIdentifier("start.intentRow")
            .onAppear { store.prewarmIntentIfNeeded() }
            if !suggestions.results.isEmpty {
              Rectangle().fill(Tokens.Color.line).frame(height: 1).padding(.leading, 14)
            }
          }
          ForEach(suggestions.results.prefix(Self.visibleSuggestions)) { suggestion in
            Button { choose(suggestion) } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(suggestion.title)
                  .tcFont(.stopName)
                  .foregroundStyle(Tokens.Color.ink)
                if !suggestion.subtitle.isEmpty {
                  Text(suggestion.subtitle)
                    .tcFont(.meta)
                    .foregroundStyle(Tokens.Color.muted)
                }
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 14)
              .padding(.vertical, 8)
              .frame(minHeight: Tokens.Hit.primary)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(suggestion.subtitle.isEmpty ? suggestion.title : "\(suggestion.title) \(suggestion.subtitle)")

            if suggestion.id != suggestions.results.prefix(Self.visibleSuggestions).last?.id {
              Rectangle().fill(Tokens.Color.line).frame(height: 1).padding(.leading, 14)
            }
          }
          if !webRows.isEmpty {
            if !suggestions.results.isEmpty {
              Rectangle().fill(Tokens.Color.line).frame(height: 1).padding(.leading, 14)
            }
            Text(app.webSuggestionsHeader)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 14)
              .padding(.top, 8)
            ForEach(webRows) { row in
              Button { chooseWeb(row) } label: {
                VStack(alignment: .leading, spacing: 2) {
                  Text(row.primaryText)
                    .tcFont(.stopName)
                    .foregroundStyle(Tokens.Color.ink)
                  if !row.secondaryText.isEmpty {
                    Text(row.secondaryText)
                      .tcFont(.meta)
                      .foregroundStyle(Tokens.Color.muted)
                  }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(minHeight: Tokens.Hit.primary)
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("start.webSuggestion")
              .accessibilityLabel(row.secondaryText.isEmpty ? row.primaryText : "\(row.primaryText) \(row.secondaryText)")
              if row.id != webRows.last?.id {
                Rectangle().fill(Tokens.Color.line).frame(height: 1).padding(.leading, 14)
              }
            }
            HStack(spacing: 0) {
              Spacer(minLength: 0)
              Text(verbatim: "Powered by Google")
                .tcFont(.meta)
                .foregroundStyle(Tokens.Color.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
          }
        }
        .padding(.top, 6)
        .background(
          RoundedRectangle(cornerRadius: Tokens.Radius.card)
            .fill(Tokens.Color.panel)
        )
        .overlay(
          RoundedRectangle(cornerRadius: Tokens.Radius.card)
            .stroke(Tokens.Color.line, lineWidth: 1)
        )
        .padding(.top, 6)
      }
    }
  }

  private var typedName: String {
    suggestions.query.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func submitTypedName() {
    let name = typedName
    guard !name.isEmpty else { return }
    onSubmit(name, nil)
    suggestions.query = ""
    // 1 件ずつ足す窓なので、足した直後は次の 1 件を待つ。SwiftUI は `onSubmit` で
    // first responder を降ろすため、戻さないと 1 件ごとに窓を押し直すことになる。
    isFocused = true
  }

  private func choose(_ suggestion: PlaceSuggestion) {
    onSubmit(suggestion.title, suggestion)
    suggestions.query = ""
    isFocused = false
  }

  /// Apple 行と正規化名で重ならない Google 行を、上限まで。
  private var webRows: [WorkerPlaceSuggestion] {
    // 入力欄が最小長に満たないときは Google 行を出さない。Start に戻った直後(query 空)に
    // root 常駐の webSuggestions が前回の結果をまだ持っていても、.task の reset を待たずに
    // 同期で隠れる。WorkerSuggestions.minimumQueryLength と対称。
    guard typedName.count >= WorkerSuggestions.minimumQueryLength else { return [] }
    let taken = Set(suggestions.results.prefix(Self.visibleSuggestions).map { Self.normalize($0.title) })
    var seen = Set<String>()
    var out: [WorkerPlaceSuggestion] = []
    for row in webSuggestions.results {
      let key = Self.normalize(row.primaryText)
      if taken.contains(key) || seen.contains(key) { continue }
      seen.insert(key)
      out.append(row)
      if out.count == Self.visibleWebSuggestions { break }
    }
    return out
  }

  private static func normalize(_ s: String) -> String {
    s.lowercased().split(whereSeparator: { $0.isWhitespace }).joined()
  }

  /// Google 予測は `CompletionToken` を持たない。`fullText` を通常入力として渡し、
  /// CTA 時に既存チェーン(Google 優先)が解決する(`suggestion == nil` パス)。
  private func chooseWeb(_ row: WorkerPlaceSuggestion) {
    onSubmit(row.fullText, nil)
    suggestions.query = ""     // onChange 経由で webSuggestions.query も空になる
    isFocused = false
  }
}
