import Foundation
import MapKit
import TripCheckKit

/*
 * 端末の地図で場所を決める解決器(spec §4.2、統合仕様 §6.6)。鍵は要らない。
 *
 * **答えるのは「見つけた」であって「確かめた」ではない。** Apple のローカル検索は出どころの
 * URL も確認時刻も返さないので、ここが作る停留所は `sourceUrl` / `verifiedAt` を空のまま、
 * `providerRef: nil`・`confidence: .medium`・`provider: .apple` で運ぶ。Kit の表示側はその 3 つで
 * 「提供元が確かめた場所」を見分けるので、埋めた瞬間に嘘の証拠になる。id を `apple-` で
 * 始めるのも同じ理由 —— `google-` / `hotel-` で始まる id は、Kit では検証済みの意味を持つ。
 *
 * `MKLocalSearch` は `LocalSearching` の後ろに隠す。`swift test` は macOS で走り、端末の地図に
 * 触る道はテストから一度も呼ばれない —— 検査できるのは、後ろに何を置いても変わらない部分
 * (候補の組み立て・自動採用・打ち切り・同時数)だけである。`Providers/AppleSuggestions.swift`
 * の `SuggestionCompleting` と同じ形。
 */

/// 端末の地図が返した 1 件。**`category` は Kit の Google 型文字列**(`"museum"`, `"park"`,
/// `"university"` …)で、`MKPointOfInterestCategory` の rawValue(`"MKPOICategoryMuseum"`)では
/// ない —— Kit の `StayEstimates.typeDurations` と `ResolutionPipeline.nonTouristicCategories` は
/// どちらも Google の語で書かれているので、rawValue のまま渡すと両方の表を素通りする。
/// 写す表は `ApplePlaceResolver.googlePlaceType(_:)`。
public struct LocalSearchHit: Hashable, Sendable {
  public var name: String
  public var address: String?
  public var latitude: Double
  public var longitude: Double
  /// ISO 3166-1 alpha-2。`ResolutionPipeline.mixedCountryCodes` が読む。
  public var countryCode: String?
  public var category: String?

  public init(
    name: String,
    address: String?,
    latitude: Double,
    longitude: Double,
    countryCode: String?,
    category: String?
  ) {
    self.name = name
    self.address = address
    self.latitude = latitude
    self.longitude = longitude
    self.countryCode = countryCode
    self.category = category
  }
}

/// 「この文字列の場所を探して」に答えられるもの。実物は端末の地図、テストはフェイク。
public protocol LocalSearching: Sendable {
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit]

  /// 「検索窓で旅行者が選んだ**この 1 件**を探して」。文字列ではなく候補そのもの
  /// (`MKLocalSearchCompletion`)を渡すので、同名の別の場所には化けない —— 文字列で
  /// 尋ね直すと、地図は同じ名前の別の街の駅を返しうる。
  func search(completion: CompletionToken, locale: PlannerLocale) async throws -> [LocalSearchHit]
}

/// 待っている最中に取り消しが来たら、待たせている相手へ「畳め」の一手だけを渡す 1 枚。
///
/// **`MKLocalSearch.start()` は取り消しを見ない。** `Task.isCancelled` が真になっても、
/// MapKit 自身の通信タイムアウトまで待ち続ける —— つまり `ApplePlaceResolver` の 6 秒は、
/// 競争に負けた側が `MKLocalSearch.cancel()` で本当に手を離さないかぎり、端末では
/// ただの飾りになる(テストの `HangingSearch` は `Task.sleep` なので取り消しで解け、
/// この差は macOS のテストからは見えない)。
///
/// `@unchecked Sendable` なのは、`withTaskCancellationHandler` の `onCancel` が本線の外から
/// 呼ばれるのに、包む相手(`MKLocalSearch`)が `Sendable` を名乗らないから。外へ出るのは
/// 「畳め」の一手だけで、錠が 1 つ守り、2 度目以降は空振りする —— 取り消しは競争の合図と
/// 親の取り消しの 2 度来うる。
final class CancelHandle: @unchecked Sendable {
  private let lock = NSLock()
  private var pull: (() -> Void)?

  init(_ pull: @escaping () -> Void) { self.pull = pull }

  /// 預かった一手を**一度だけ**引く。
  func cancel() {
    lock.lock()
    let pull = self.pull
    self.pull = nil
    lock.unlock()
    pull?()
  }

  /// この待ちが取り消されたら `cancel()` を引く。**待ちそのものは相手のまま** —— 渡すのは
  /// 合図だけで、取り消された `start()` はエラーを投げて返るので、続きは呼び手の `catch` が
  /// いつもの道で受ける(待ち手が宙に浮かない)。
  func relaying<T>(
    isolation: isolated (any Actor)? = #isolation,
    _ operation: () async throws -> T
  ) async rethrows -> T {
    try await withTaskCancellationHandler(
      operation: operation,
      onCancel: { self.cancel() },
      isolation: isolation
    )
  }
}

/// 実物。delegate を持たない `MKLocalSearch` を 1 回の問い合わせにつき 1 台使う。
///
/// `@MainActor` なのは `MKLocalSearch` とその応答が `Sendable` を名乗らないから —— 本線に
/// 留めておけば、どこへも渡らない。待つのは `await` なので本線は塞がない。`init` だけは
/// `nonisolated` にしてある(`ApplePlaceResolver` の既定引数として、どこからでも書けるように)。
@MainActor
public final class MKLocalSearchAdapter: LocalSearching {
  nonisolated public init() {}

  public func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.resultTypes = [.pointOfInterest, .address]
    // 箱は「寄せる」だけの助言で、外の場所も返ってくる。落とすのは `ApplePlaceResolver` の側。
    if let region { request.region = Self.coordinateRegion(region) }
    // **1 台を手元に持ったまま待つ。** 作って捨てる書き方(`MKLocalSearch(request:).start()`)
    // だと取り消しを伝える宛先が残らず、`ApplePlaceResolver.race` が時計に負けを告げても
    // この問い合わせは MapKit の中で生き続ける。`cancel()` を掛けると `start()` は
    // エラーを投げて返り、`race` の `catch` が `.gaveUp` にする。
    let search = MKLocalSearch(request: request)
    let response = try await CancelHandle { search.cancel() }.relaying { try await search.start() }
    return response.mapItems.map(Self.hit(from:))
  }

  /// 候補 1 件を座標と住所のある 1 件に変える。`MKLocalSearch.Request(completion:)` は
  /// 「この候補のことだ」を地図へそのまま渡す唯一の道で、文字列を組み立て直さない ——
  /// 組み立て直せば、旅行者が選んだ行と地図が探す物の対応がこちらの綴り方に依ってしまう。
  /// 取り消しの伝え方(`CancelHandle`)も証拠の扱いも、文字列で探すときと同じ。
  public func search(completion token: CompletionToken, locale: PlannerLocale) async throws -> [LocalSearchHit] {
    let search = MKLocalSearch(request: MKLocalSearch.Request(completion: token.completion))
    let response = try await CancelHandle { search.cancel() }.relaying { try await search.start() }
    return response.mapItems.map(Self.hit(from:))
  }

  private static func hit(from item: MKMapItem) -> LocalSearchHit {
    let placemark = item.placemark
    return LocalSearchHit(
      name: item.name ?? placemark.name ?? "",
      // `placemark.title` は端末の言語で組んだ住所。**改行が入ってくる**(日本語の住所は
      // 郵便番号・市区町村・番地が別の行で返る)ので、1 行に畳んでから渡す —— Kit の
      // `placeCandidateLabel` は 1 行の住所を前提に " · " で繋ぐので、畳まないと候補 1 件が
      // 4 行のボタンになる。
      address: placemark.title.map(Self.oneLine),
      latitude: placemark.coordinate.latitude,
      longitude: placemark.coordinate.longitude,
      countryCode: placemark.isoCountryCode,
      category: item.pointOfInterestCategory.flatMap(ApplePlaceResolver.googlePlaceType)
    )
  }

  /// 続いた空白(改行を含む)を 1 つの空白に畳む。
  private static func oneLine(_ text: String) -> String {
    text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  /// 行き先の箱を `MKCoordinateRegion` に直す。緯度経度の幅は南北・東西の差そのもの
  /// (`MKLocalSearchCompleterAdapter` と同じ式)。
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

/// 端末の地図に尋ねる解決器。`ResolutionPipeline` は `CatalogResolver` の前に置く
/// (`TripCheckApp` の並び) —— カタログは 26 地点しか知らないので、それ以外は地図が答える。
public struct ApplePlaceResolver: PlaceResolver {

  /// 打ち切りと通信の失敗に付く理由。TS `PlaceResolutionError`
  /// (`lib/place-resolution-client.ts:56-57`)の語で、旅行者に見せる文ではない。
  /// 「探したが無かった」(`ResolutionPipeline.notFoundReason`)とは別物 —— 前者は
  /// 「もう一度探す」に意味があり、後者には無い。
  public static let unavailableReason = "unavailable"

  let search: any LocalSearching
  let timeout: Duration
  let concurrency: Int

  public init(
    search: any LocalSearching = MKLocalSearchAdapter(),
    timeout: Duration = .seconds(6),
    concurrency: Int = 4
  ) {
    self.search = search
    self.timeout = timeout
    self.concurrency = max(1, concurrency)
  }

  public func resolve(
    _ queries: [PlaceQuery],
    destination: DestinationChoice,
    locale: PlannerLocale
  ) async -> [Int: PlaceResolution] {
    // 旅行者が既にプロバイダの候補を選んでいる問い合わせには手を出さない —— その id を
    // 発行した解決器だけが厳密 id 取得で同一性を確かめられる(`CatalogResolver` と同じ約束)。
    // Apple のローカル検索に id 空間は無いので、ここは常に見送る側になる。
    let asked = queries.filter { $0.pinnedProviderRef == nil }
    guard !asked.isEmpty else { return [:] }

    let bounds = Self.bounds(for: destination)
    return await withTaskGroup(of: (Int, PlaceResolution).self) { group in
      var pending = asked.makeIterator()
      var results: [Int: PlaceResolution] = [:]
      // 端末の地図に 12 本の問い合わせを一度に投げない。1 件返るたびに次を 1 件立てる。
      for _ in 0..<concurrency {
        guard let query = pending.next() else { break }
        group.addTask { await answer(query, bounds: bounds, locale: locale) }
      }
      while let (inputIndex, resolution) = await group.next() {
        results[inputIndex] = resolution
        if let query = pending.next() {
          group.addTask { await answer(query, bounds: bounds, locale: locale) }
        }
      }
      return results
    }
  }

  /// 検索窓で旅行者が選んだ 1 件を、そのまま行に固定できる停留所に変える(spec §5.2)。
  ///
  /// 候補一覧は名前と地区だけで、座標も住所も持たない —— だから選んだ時点でもう一度地図に
  /// 尋ねる必要がある。尋ねるのは**その候補そのもの**(`CompletionToken`)で、名前で尋ね直す
  /// ことはしない:「Bahnhof Bern」を選んだ旅行者が、後の解決でチューリヒの駅を渡されない
  /// ようにするための一手だからである。
  ///
  /// 答えないとき(打ち切り・通信の失敗・0 件)は `nil`。呼び手はその行を固定せずに残すので、
  /// CTA の解決が普通に尋ね直す —— 選んだことが無駄になるだけで、旅程は組める。
  ///
  /// 証拠の規則は文字列で探したときと同じ(`candidate(_:query:)` を通る)—— `providerRef` は
  /// 空、`sourceUrl` / `verifiedAt` は空、`confidence` は `.medium`、id は `apple-` で始まる。
  public func resolve(
    completion token: CompletionToken,
    inputIndex: Int,
    input: String,
    locale: PlannerLocale
  ) async -> ResolvedStop? {
    let searcher = search
    switch await race({ try await searcher.search(completion: token, locale: locale) }) {
    case .found(let hits):
      // 候補は既に 1 つの場所を指しているので、先頭が「その場所」である。箱では絞らない ——
      // 旅行者が選んだのは箱の中の 1 件ではなく、目で見た 1 行だからである。
      guard let hit = hits.first else { return nil }
      return candidate(hit, query: PlaceQuery(inputIndex: inputIndex, input: input)).stop
    case .gaveUp:
      return nil
    }
  }

  // MARK: - 1 件ぶん

  private func answer(_ query: PlaceQuery, bounds: GeoBounds?, locale: PlannerLocale) async -> (Int, PlaceResolution) {
    let searcher = search
    let hits: [LocalSearchHit]
    switch await race({ try await searcher.search(query: query.input, region: bounds, locale: locale) }) {
    case .found(let found): hits = found
    case .gaveUp: return (query.inputIndex, .unresolved(reason: Self.unavailableReason))
    }

    // 行き先の国が決まっているなら、その箱の外は採らない(TS `withinBounds`,
    // `lib/google-place-resolver.ts:181`)。`region` は寄せるだけの助言なので、隣の国の
    // 同名の街がそのまま返ってくる。
    let inside = hits.filter { Destinations.withinBounds(bounds, latitude: $0.latitude, longitude: $0.longitude) }
    guard !inside.isEmpty else { return (query.inputIndex, .unresolved(reason: ResolutionPipeline.notFoundReason)) }

    // 切るのは表示ではなく結果の側(`ResolutionPipeline.reviewShortlistLimit`)—— 4 件目以降は
    // 誰にも渡らないので、画面が別の 3 件を選ぶ余地が生まれない。
    let candidates = inside.prefix(ResolutionPipeline.reviewShortlistLimit).map { candidate($0, query: query) }
    if let accepted = ResolutionPipeline.autoAccept(input: query.input, candidates: candidates) {
      return (query.inputIndex, .confirmed(accepted.stop))
    }
    return (query.inputIndex, .review(candidates))
  }

  private func candidate(_ hit: LocalSearchHit, query: PlaceQuery) -> PlaceCandidate {
    let address = hit.address ?? ""
    let placeTypes = hit.category.map { [$0] }
    let stop = ResolvedStop(
      // 同じ入力に 2 件が並ぶことがある(「Bahnhof」がベルンとチューリヒ)ので、id は
      // 入力の添字だけでなく**その 1 件そのもの**から出す。`FNV1a` は Kit の決定的な
      // ハッシュで、`Hasher` と違って走らせるたびに変わらない。
      id: "apple-\(query.inputIndex)-\(FNV1a.hash32("\(hit.name)|\(hit.latitude)|\(hit.longitude)"))",
      providerRef: nil,
      name: hit.name,
      area: AppleAddress.area(from: address, fallback: hit.name, countryCode: hit.countryCode),
      latitude: hit.latitude,
      longitude: hit.longitude,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: StayEstimates.estimateStayMinutes(name: hit.name, placeTypes: placeTypes),
      isAnchor: true,
      placeTypes: placeTypes,
      input: query.input,
      inputIndex: query.inputIndex,
      address: address,
      countryCode: hit.countryCode,
      provider: .apple
    )
    // `isTouristic` は渡さない —— `PlaceCandidate.init` の既定が `category` と `placeTypes` と
    // 名前の 3 つから計算する。ここで上書きすると、規則が 2 か所に分かれる。
    return PlaceCandidate(stop: stop, category: hit.category)
  }

  /// 探す側と時計を**本当に競争させる**。どちらが先に着いたかで決めるので、地図が答えない
  /// 限り `resolve` が返らない、ということが起こらない。
  ///
  /// 尋ね方(文字列か、旅行者が選んだ候補か)は呼び手が閉包に畳んで渡す —— 打ち切りの
  /// 秒数と負けた側の畳み方は、どちらの尋ね方でも 1 つでなければならない。
  private func race(_ ask: @escaping @Sendable () async throws -> [LocalSearchHit]) async -> SearchOutcome {
    let limit = timeout
    return await withTaskGroup(of: SearchOutcome.self) { group in
      group.addTask {
        do { return .found(try await ask()) }
        catch { return .gaveUp }
      }
      group.addTask {
        try? await Task.sleep(for: limit)
        return .gaveUp
      }
      let first = await group.next() ?? .gaveUp
      // 負けたほうを畳む。`withTaskGroup` は子が全部畳まれるまで返らないので、**打ち切りが
      // 打ち切りであるためには、負けた側が取り消しで本当に解ける必要がある** ——
      // `Task.sleep` は自分で解け、端末の地図は `CancelHandle` が `MKLocalSearch.cancel()` を
      // 引いて解く(`theLoserOfTheRaceIsToldToStop` / `aCancelledWaitPullsTheHandle`)。
      group.cancelAll()
      return first
    }
  }

  private enum SearchOutcome: Sendable {
    case found([LocalSearchHit])
    case gaveUp
  }

  /// 候補検索を寄せる箱。`auto` と `worldwide` は箱を持たない(世界中が対象)——
  /// `PlannerStore.destinationBounds` と同じ規則。
  static func bounds(for destination: DestinationChoice) -> GeoBounds? {
    guard case .destination(let id) = destination, id != .worldwide else { return nil }
    return Destinations.byId(id).bounds
  }

  /// MapKit の分類を Kit の Google 型文字列へ写す表(R9)。**両方の表に当たる語を選ぶ** ——
  /// `StayEstimates.typeDurations`(滞在時間)と `ResolutionPipeline.nonTouristicCategories`
  /// (自動採用しない型)はどちらも Google の語で書かれている。表に無い分類は `nil` で、
  /// そのときは名前の見当と既定の 90 分に任せる(間違った型を当てるより、何も言わないほうがよい)。
  public static func googlePlaceType(_ category: MKPointOfInterestCategory) -> String? {
    switch category {
    case .museum: "museum"
    case .park: "park"
    case .amusementPark: "amusement_park"
    case .zoo: "zoo"
    case .aquarium: "aquarium"
    case .restaurant: "restaurant"
    case .cafe: "cafe"
    case .university: "university"
    case .school: "school"
    case .hospital: "hospital"
    case .stadium: "stadium"
    case .beach: "beach"
    case .nationalPark: "national_park"
    case .theater: "performing_arts_theater"
    case .store: "department_store"
    default: nil
    }
  }
}

/*
 * 停留所の下に出る短い地名を、1 行の住所から取り出す。
 *
 * TS `areaFromAddress`(`lib/google-place-resolver.ts:91-137`)の**縮小版**。TS は
 * `Destination` を受け取って国名の語を落とすが、ここが持っているのは 1 件ぶんの国コードだけ
 * なので、`Destinations.forCountryCode` で引ける範囲の名前を落とす。日本の住所は 1 つの
 * 文字列に県と市区が入っていて分けられないのに対し、多くの国は最後から 2 番目のカンマ区切りに
 * 街の名前が入る、という TS の見立てはそのまま。
 */
enum AppleAddress {

  static func area(from address: String, fallback: String, countryCode: String?) -> String {
    let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return fallback }

    // 1. 日本の住所は都道府県 + 市区町村。カンマで割れないので、名前のほうを見る。
    if let prefecture = japanesePrefecture.firstMatch(in: trimmed) {
      let name = String(trimmed[prefecture.range])
      let following = String(trimmed[prefecture.range.upperBound...])
      let municipality = japaneseMunicipality.firstMatch(in: following).map { String(following[$0.range]) } ?? ""
      return name + municipality
    }

    let countryWords = countryNames(countryCode)

    // 2. 日本語版の**外国の**住所はカンマを持たず、国名が先頭で、郵便番号の次が街の名前
    //    (「スイス 〒3920 ツェルマット ゴルナーグラート」)。
    if !trimmed.contains(",") {
      let tokens = trimmed.split(whereSeparator: \.isWhitespace)
        .map(String.init)
        .filter { !countryWords.contains($0.lowercased()) }
      if let postal = tokens.firstIndex(where: { postalToken.test($0) }), postal + 1 < tokens.count {
        return tokens[postal + 1]
      }
    }

    // 3. それ以外は最後から 2 番目のカンマ区切り —— 街の上の地区であることが多い。ただし
    //    そこが番地の行(「Bahnhofstrasse 1」)なら最後の区切りを採る(最後は番地ではない)。
    let parts = trimmed.split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    let useful = parts.filter { !countryWords.contains($0.lowercased()) && !postalOnly.test($0) }
    guard let last = useful.last else { return fallback }
    let secondToLast = useful.count >= 2 ? useful[useful.count - 2] : nil
    let label = secondToLast.map { isStreetLike($0) ? last : $0 } ?? last

    // 4. 郵便番号は街の前に付くことも(「3920 Zermatt」)後ろに付くことも(「Tokyo 111-0032」)ある。
    let cleaned = trailingPostal
      .replacingAll(in: leadingPostal.replacingAll(in: label, with: ""), with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty || isStreetLike(cleaned) ? fallback : cleaned
  }

  /// その国コードで呼ばれうる名前(日本語名・英語名・Google 向けの綴り)。国名は地名ではない。
  private static func countryNames(_ code: String?) -> Set<String> {
    guard let code, let destination = Destinations.forCountryCode(code) else { return [] }
    return Set((destination.names.values + [destination.querySuffix].compactMap { $0 }).map { $0.lowercased() })
  }

  /// 数字を含み、かつ数字で始まるか数字で終わる —— 番地の行の形。
  private static func isStreetLike(_ part: String) -> Bool {
    anyDigit.test(part) && streetLike.test(part)
  }

  private static let japanesePrefecture = try! JSRegex("北海道|東京都|(?:京都|大阪)府|[\\p{Script=Han}]{2,3}県")
  private static let japaneseMunicipality = try! JSRegex("^[^\\s,、市区町村]{1,8}[市区町村]")
  private static let postalToken = try! JSRegex("^〒?\\d{3,6}(?:-\\d{2,4})?$")
  private static let postalOnly = try! JSRegex("^[A-Z]{0,2}[-\\s]?\\d[\\dA-Z\\s-]{2,9}$", options: [.caseInsensitive])
  private static let leadingPostal = try! JSRegex("^(?:〒\\s*|[A-Z]{1,2}-)?\\d{3,6}(?:-\\d{2,4})?\\s+", options: [.caseInsensitive])
  private static let trailingPostal = try! JSRegex("\\s+〒?\\d{3,6}(?:-\\d{2,4})?$")
  private static let anyDigit = try! JSRegex("\\d")
  private static let streetLike = try! JSRegex("^\\d|\\s\\d+[a-z]?$", options: [.caseInsensitive])
}
