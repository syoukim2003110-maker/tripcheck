import Foundation
import MapKit
import Observation
import TripCheckKit

/*
 * 検索窓に出る候補。旅行者が打っている途中の文字列を端末の地図(`MKLocalSearchCompleter`)へ
 * 渡し、返ってきた行を並べるだけの小さな部品。
 *
 * 尋ねる規則は 3 つだけで、どれも「尋ねすぎない」ためにある:
 *
 *   1. **2 文字未満は尋ねない。** 1 文字の候補は誰の役にも立たず、打ち始めの 1 文字で必ず
 *      1 往復が起きる。
 *   2. **打ち終わるまで待つ(デバウンス)。** `query` が動くたびに前の予定を捨てて取り直す
 *      ので、続けて打っている間は 1 度も尋ねない。
 *   3. **同じ問いは覚えている。** 鍵は (文字列, 行き先の箱) の 2 つ組 —— 国を選べば同じ
 *      文字列でも探す範囲が変わるので、文字列だけを鍵にすると国を選んだ意味が消える。
 *      **この 2 つ組は下の `MKLocalSearchCompleterAdapter` でも同じ**で、片方だけが覚えると
 *      前の国の答えが新しい鍵で保存される。
 *
 * `MKLocalSearchCompleter` そのものは `SuggestionCompleting` の後ろに隠す。`swift test` は
 * macOS で走り、端末の地図に触る道はテストから一度も呼ばれない —— 実物の適合
 * (`MKLocalSearchCompleterAdapter`)で検査できるのは、尋ね直すかどうかを決める純関数
 * (`nextStep(after:asking:)`)だけである。
 */

/// `MKLocalSearchCompletion` を持ち歩くための包み。あの型は `Sendable` を名乗らないが、
/// 中身は不変で、作るのも読むのも本線(delegate が本線で呼ばれる)なので、包んで運ぶ。
/// **`ApplePlaceResolver.resolve(completion:)` が受け取るのがこれ**で、候補を選んだときに
/// 座標と住所へ変えるための唯一の材料になる —— 名前で尋ね直すと、地図は同じ名前の
/// 別の場所を返しうる。
public struct CompletionToken: @unchecked Sendable {
  public let completion: MKLocalSearchCompletion

  public init(_ completion: MKLocalSearchCompletion) {
    self.completion = completion
  }
}

/// 候補 1 行。`title` が場所名、`subtitle` が地区や住所の断片。
public struct PlaceSuggestion: Identifiable, Sendable, Equatable {
  public let title: String
  public let subtitle: String
  public let token: CompletionToken

  /// 同じ名前の候補が 2 行並ぶことがある(「駅」と「駅前広場」など、地図が別物として返す)
  /// ので、行の識別子は文字ではなく**返ってきた物そのもの**にする。
  public var id: ObjectIdentifier { ObjectIdentifier(token.completion) }

  public init(_ completion: MKLocalSearchCompletion) {
    self.title = completion.title
    self.subtitle = completion.subtitle
    self.token = CompletionToken(completion)
  }

  public static func == (lhs: PlaceSuggestion, rhs: PlaceSuggestion) -> Bool { lhs.id == rhs.id }
}

/// 「この文字列で探して」に答えられるもの。実物は端末の地図、テストはフェイク。
public protocol SuggestionCompleting: Sendable {
  func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion]
}

/// 実物。`MKLocalSearchCompleter` は delegate で答える古い形なので、`CheckedContinuation` で
/// `async` の形に橋渡しする。delegate は本線で呼ばれるため、この型ごと `@MainActor`。
@MainActor
public final class MKLocalSearchCompleterAdapter: NSObject, SuggestionCompleting, MKLocalSearchCompleterDelegate {

  /// いま鳴らしている一台。箱が変わったときは畳んで取り替えるので `var`。
  private var completer = MKLocalSearchCompleter()
  /// 答えを待っている 1 件。次の問い合わせが来たら畳む(2 つは待たない)。
  private var waiting: CheckedContinuation<[PlaceSuggestion], any Error>?
  /// 手元の一台にいま入っている問い。まだ何も入れていなければ `nil`。
  private var applied: Ask?

  /// 端末の地図へ投げた 1 つの問い。**文字列と箱の 2 つ組で 1 つの問い** —— 国を選べば
  /// 同じ文字列でも別の問いであり、答えも別物になる。
  struct Ask: Equatable, Sendable {
    var query: String
    var region: GeoBounds?
  }

  /// 次にすること。`MKLocalSearchCompleter` は「入れ直しても同じ値なら鳴らない」ので、
  /// 尋ね直したいときに何をすれば delegate が鳴るかまで含めて、ここで決める。
  enum NextStep: Equatable, Sendable {
    /// 文字列も箱も前と同じ。もう鳴らないので、手元の答えをそのまま返す。
    case reuseLastAnswer
    /// 文字列が変わった。`queryFragment` に入れれば鳴る。
    case ask
    /// 箱が変わった。文字列が同じなら代入では鳴かず、違っていても箱と文字列の 2 つを
    /// 続けて動かすと途中の答えが混ざる。どちらも一台を畳んで取り替えてから入れる。
    case restartForNewRegion
  }

  /// 「もう一度尋ねるか」を決める全部。純関数なので、端末の地図に触らずに検査できる。
  nonisolated static func nextStep(after last: Ask?, asking: Ask) -> NextStep {
    guard let last else { return .ask }
    if last == asking { return .reuseLastAnswer }
    return last.region == asking.region ? .ask : .restartForNewRegion
  }

  public override init() {
    super.init()
    adopt(completer)
  }

  public func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion] {
    // 前の問い合わせを畳む。捨てる側は既に `Task` が取り消されているので、空で返しても
    // 画面には出ない。
    finish(.success([]))
    let asking = Ask(query: query, region: region)
    switch Self.nextStep(after: applied, asking: asking) {
    case .reuseLastAnswer:
      // 同じ問いを入れ直しても delegate は鳴らない —— 手元の答えをそのまま返す
      // (待ち続けると、その 1 回だけ候補が永久に出ない)。
      return completer.results.map(PlaceSuggestion.init)
    case .restartForNewRegion:
      // 国を選んだ直後。同じ文字列を入れ直しても delegate は鳴かないので、そのまま待つと
      // その 1 回の答えが来ない。空の一台に取り替えれば、同じ文字列がもう一度「変化」になる。
      let fresh = MKLocalSearchCompleter()
      completer.delegate = nil
      completer.cancel()
      completer = fresh
      adopt(fresh)
    case .ask:
      break
    }
    completer.region = region.map(Self.coordinateRegion) ?? MKCoordinateRegion(.world)
    applied = asking
    return try await withCheckedThrowingContinuation { continuation in
      waiting = continuation
      completer.queryFragment = query
    }
  }

  private func adopt(_ searchCompleter: MKLocalSearchCompleter) {
    searchCompleter.delegate = self
    searchCompleter.resultTypes = [.pointOfInterest, .address]
  }

  /*
   * delegate の 2 つは `nonisolated` にして中で本線へ入り直す。MapKit がこれを本線から呼ぶのは
   * 確かだが、protocol 側の隔離注釈は SDK の版で変わるので、こちらの約束を SDK に預けない。
   * 引数の completer は型が `Sendable` ではないので閉包へ持ち込めない —— 持ち出すのは
   * 見分けのための同一性(`ObjectIdentifier`)と、失敗の文だけ。畳んだ一台の答えが遅れて
   * 届くことがあるので、いま鳴らしている一台からの声かどうかを毎回見る。
   */

  nonisolated public func completerDidUpdateResults(_ searchCompleter: MKLocalSearchCompleter) {
    let source = ObjectIdentifier(searchCompleter)
    MainActor.assumeIsolated {
      guard source == ObjectIdentifier(self.completer) else { return }
      finish(.success(self.completer.results.map(PlaceSuggestion.init)))
    }
  }

  nonisolated public func completer(_ searchCompleter: MKLocalSearchCompleter, didFailWithError error: any Error) {
    let source = ObjectIdentifier(searchCompleter)
    let reason = error.localizedDescription
    MainActor.assumeIsolated {
      guard source == ObjectIdentifier(self.completer) else { return }
      finish(.failure(SuggestionsUnavailable(reason: reason)))
    }
  }

  /// 端末の地図が答えられなかった。`AppleSuggestions` はこれを `.unavailable` に畳む。
  public struct SuggestionsUnavailable: Error, Sendable {
    public let reason: String
  }

  private func finish(_ result: Result<[PlaceSuggestion], any Error>) {
    guard let continuation = waiting else { return }
    waiting = nil
    continuation.resume(with: result)
  }

  /// 行き先の箱を `MKCoordinateRegion` に直す。緯度経度の幅は南北・東西の差そのもの。
  private static func coordinateRegion(_ bounds: GeoBounds) -> MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(
        latitude: (bounds.south + bounds.north) / 2,
        longitude: (bounds.west + bounds.east) / 2
      ),
      span: MKCoordinateSpan(
        latitudeDelta: max(bounds.north - bounds.south, 0.01),
        longitudeDelta: max(bounds.east - bounds.west, 0.01)
      )
    )
  }
}

/// 検索窓 1 つぶんの状態。画面は `query` を書き、`results` と `state` を読む。
@Observable
@MainActor
public final class AppleSuggestions {

  /// `idle` はまだ尋ねていない(空・1 文字を含む)、`loading` は待っている、`ready` は
  /// 答えが出ている(0 件も答え)、`unavailable` は端末が答えられなかった。
  public enum State: Equatable, Sendable {
    case idle, loading, ready, unavailable
  }

  /// これ未満の長さでは尋ねない。
  public static let minimumQueryLength = 2
  /// 覚えておく問いの数。超えたら古いものから捨てる。
  public static let cacheLimit = 60

  public var query: String = "" {
    didSet {
      guard query != oldValue else { return }
      schedule()
    }
  }

  public private(set) var results: [PlaceSuggestion] = []
  public private(set) var state: State = .idle

  @ObservationIgnored private let debounce: Duration
  @ObservationIgnored private let completer: any SuggestionCompleting
  @ObservationIgnored private var region: GeoBounds?
  @ObservationIgnored private var cache: [CacheKey: [PlaceSuggestion]] = [:]
  /// 入れた順。先頭がいちばん古い(FIFO)。
  @ObservationIgnored private var cacheOrder: [CacheKey] = []
  @ObservationIgnored private var pending: Task<Void, Never>?

  public init(
    debounce: Duration = .milliseconds(550),
    completer: any SuggestionCompleting = MKLocalSearchCompleterAdapter()
  ) {
    self.debounce = debounce
    self.completer = completer
  }

  /// 探す範囲を行き先の国に寄せる。範囲が変われば、同じ文字列でも尋ね直す。
  public func setRegion(_ bounds: GeoBounds?) {
    guard bounds != region else { return }
    region = bounds
    schedule()
  }

  // MARK: - 内部

  private struct CacheKey: Hashable {
    var query: String
    var region: GeoBounds?
  }

  private var currentKey: CacheKey? {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count >= Self.minimumQueryLength else { return nil }
    return CacheKey(query: text, region: region)
  }

  /// 予定を取り直す。`query` が動くたび・範囲が変わるたびにここへ来る。
  private func schedule() {
    pending?.cancel()
    pending = nil
    guard let key = currentKey else {
      // 2 文字未満。前の候補を残すと、消した文字の答えが出たままになる。
      results = []
      state = .idle
      return
    }
    if let remembered = cache[key] {
      results = remembered
      state = .ready
      return
    }
    state = .loading
    pending = Task { [weak self] in
      guard let self else { return }
      try? await Task.sleep(for: self.debounce)
      guard !Task.isCancelled else { return }
      await self.ask(key)
    }
  }

  private func ask(_ key: CacheKey) async {
    do {
      let found = try await completer.complete(key.query, region: key.region)
      guard !Task.isCancelled else { return }
      remember(key, found)
      guard key == currentKey else { return }   // 待っている間に打ち替えられた
      results = found
      state = .ready
    } catch {
      guard !Task.isCancelled, key == currentKey else { return }
      // 失敗は覚えない —— 次に同じ文字列を打ったら、もう一度尋ねる。
      results = []
      state = .unavailable
    }
  }

  private func remember(_ key: CacheKey, _ found: [PlaceSuggestion]) {
    if cache[key] == nil { cacheOrder.append(key) }
    cache[key] = found
    while cacheOrder.count > Self.cacheLimit {
      cache[cacheOrder.removeFirst()] = nil
    }
  }
}
