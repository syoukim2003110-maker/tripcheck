import Foundation

/*
 * 解決器を束ねる純粋な規則(spec §4.2、統合仕様 §6.6)。
 *
 * 移植元:
 * - `lib/google-place-resolver.ts:163-165` `normalizePlaceName`
 * - `lib/google-place-resolver.ts:286-303` `nonVisitPrimaryTypes`(12 種)
 * - `lib/google-place-resolver.ts:305` `corporateQualifierPattern`(逐語)
 * - `lib/google-place-resolver.ts:307-325` `isPlainlyNonVisitCandidate`
 * - `lib/google-place-resolver.ts:327-343` `autoPickCandidates` / `exactNameCandidate`
 * - `lib/google-place-resolver.ts:345-379` `needsTravellerChoice`
 * - `lib/place-resolution-client.ts:30-37` `resolvedPlaceCountryCodes` / `hasMixedResolvedPlaceCountries`
 *   (呼び出し側は `app/components/planner/hooks/usePlanBuild.tsx:907-912` と `:1090-1105`)
 * - `app/components/planner/hooks/useTripDomainModel.tsx:1209-1217` `resolveAttentionRanks`
 *   (`>= 3` で抑止するのは画面側 `app/components/planner/start/ResolveScreen.tsx:218-219`)
 *
 * **国の投票はここに無い**。明示 > 国コード投票 > 最小外接箱・未対応コードがあれば worldwide・
 * 同数は worldwide という規則は `Builder/DestinationVote.swift`(TS `lib/trip-builder.ts:1905-1937`)
 * が既に持っていて、二重に書けば二つの答えが生まれる。ここが受け持つのは、その投票の**手前**で
 * 旅行者に差し戻す条件 —— 複数の国が混ざったこと自体 —— だけである。
 */
public enum ResolutionPipeline {
  /// どの解決器も答えを返さなかった問い合わせに付く理由。TS には対応する語が無い
  /// (`places` にも `ambiguous` にも出てこない入力がそのまま「未解決」だった)。
  public static let notFoundReason = "not_found"

  /// 解決器を順に呼び、**先に `confirmed` を返した解決器で止まる**(spec §4.2)。
  ///
  /// 止まり方は問い合わせ 1 件ごと:確定した添字は次の解決器に渡らないので、全件が確定すれば
  /// 次の解決器は**呼ばれない**。一部だけ確定したときは、残りだけを渡して次を呼ぶ。
  ///
  /// 確定しなかった答えは `confirmed > review > unresolved` の順位で比べ、**厳密に上回った
  /// ときだけ**置き換える。同順位なら先に答えた解決器が勝つ(束ねた順が信頼の順である)——
  /// これで、後から来た解決器の「見つからない」が、先の解決器が集めた候補一覧を消すことはない。
  ///
  /// どの解決器も答えなかった添字には `unresolved(reason: notFoundReason)` が入るので、
  /// 戻り値は必ず全問い合わせを覆う。同じ `inputIndex` が二度渡されたときは最初の 1 件だけを使う
  /// (答えは `inputIndex` で引かれるので、二度尋ねても後の答えが前を消すだけ)。
  public static func resolve(
    _ queries: [PlaceQuery],
    destination: DestinationChoice,
    locale: PlannerLocale,
    resolvers: [any PlaceResolver]
  ) async -> [Int: PlaceResolution] {
    var pending: [PlaceQuery] = []
    var asked: Set<Int> = []
    for query in queries where !asked.contains(query.inputIndex) {
      asked.insert(query.inputIndex)
      pending.append(query)
    }

    var results: [Int: PlaceResolution] = [:]
    for resolver in resolvers {
      if pending.isEmpty { break }
      let answers = await resolver.resolve(pending, destination: destination, locale: locale)
      for (inputIndex, answer) in answers where asked.contains(inputIndex) {
        guard let existing = results[inputIndex] else {
          results[inputIndex] = answer
          continue
        }
        if rank(answer) > rank(existing) { results[inputIndex] = answer }
      }
      pending = pending.filter { query in
        if case .confirmed = results[query.inputIndex] { return false }
        return true
      }
    }
    for query in queries where results[query.inputIndex] == nil {
      results[query.inputIndex] = .unresolved(reason: notFoundReason)
    }
    return results
  }

  /// 旅行者を通さずに採用してよい候補。無ければ `nil`(= 確認へ回す)。
  ///
  /// TS は `autoPickCandidates`(`:327-337`)で非観光の候補を落とし、`needsTravellerChoice`
  /// (`:345-379`)で差し戻す条件を数え、残りを `exactNameCandidate(input, eligible) ?? eligible[0]`
  /// で採る(`:406-409`)。Kit が採るのは**そのうち曖昧さの無い 2 つ**だけ:
  ///
  /// 1. 正規化した名前が入力と**完全一致する候補がちょうど 1 件**あるならそれ
  ///    (TS `exactNameCandidate` `:339-343`、`:369` —— 「ゴルナーグラート」が「〜鉄道」に
  ///    負けない。複数が同名なら答えではない: `:357`)。
  /// 2. 非観光を落として**残りが 1 件**ならそれ(TS `:352-356`)。
  ///
  /// TS の最後の一手 —— 完全一致が無くても「もっともらしい候補が 1 件だけなら先頭を採る」
  /// (`:374-378`)—— は移植しない。Google の関連度順という前提の上に立っており、解決器を
  /// 差し替える Kit では成り立たない。差は**確認画面に回る件数が増える**方向だけで、
  /// 旅行者の意図しない場所が黙って旅程に入ることはない。
  ///
  /// auto のときの国跨ぎ(`:363-364`)もここでは見ない —— それは `mixedCountryCodes` が
  /// 旅程全体に対して答える(TS も画面側 `usePlanBuild.tsx:907-912` で判定している)。
  ///
  /// 「非観光」を読むのは `PlaceCandidate.isTouristic`(既定は `isNonTouristic` の否定)。
  public static func autoAccept(input: String, candidates: [PlaceCandidate]) -> PlaceCandidate? {
    let eligible = candidates.filter(\.isTouristic)
    guard !eligible.isEmpty else { return nil }
    let normalized = normalizePlaceName(input)
    let exact = eligible.filter { normalizePlaceName($0.stop.name) == normalized }
    if exact.count == 1 { return exact[0] }
    if exact.count > 1 { return nil }
    return eligible.count == 1 ? eligible[0] : nil
  }

  /// TS `nonVisitPrimaryTypes`(`lib/google-place-resolver.ts:286-303`)。逐語 12 種。
  public static let nonTouristicCategories: Set<String> = [
    "university",
    "school",
    "primary_school",
    "secondary_school",
    "hospital",
    "doctor",
    "corporate_office",
    "local_government_office",
    "real_estate_agency",
    "insurance_agency",
    "accounting",
    "lawyer",
  ]

  /// 「単独候補でも自動採用しない」型(統合仕様 §6.6)。カテゴリが上の 12 種のどれか、または
  /// 名前が企業名パターンに当たれば真。
  ///
  /// TS の `isPlainlyNonVisitCandidate`(`:307-325`)は入力も見て、**旅行者が自分でその語を
  /// 書いたときは通す**(`!textualMatch || providerAddedCorporateQualifier`)。この署名には入力が
  /// 無いので、その免除は無い —— 「Bern」に対する「Universität Bern」は TS では名前が入力を
  /// 含むため自動採用されるが、Kit では確認へ回る(ブリーフの
  /// `singleNonTouristicCandidateGoesToReview` が要求する側)。TS のコメント自身が挙げる
  /// 「ベルン旧市街 → Universität Bern は誤ランクである」という意図はこちらで、代償は
  /// 「大学を本当に探した人にも一度尋ねる」こと。TS の `service` 型の規則(`:319-324`)も
  /// 入力との比較が要るので同じ理由で持ってきていない。
  public static func isNonTouristic(name: String, category: String?) -> Bool {
    if let category, nonTouristicCategories.contains(category) { return true }
    return corporateQualifierPattern.test(name)
  }

  /// 解決済み停留所が 2 か国以上に分かれているなら全コードを昇順で、そうでなければ空。
  ///
  /// TS `resolvedPlaceCountryCodes` + `hasMixedResolvedPlaceCountries`
  /// (`lib/place-resolution-client.ts:30-37`)。TS は `Set` の**挿入順**で返すが、ここは
  /// ブリーフ指定どおり昇順に整える(比較は Global Constraints の UTF-16 コード単位)——
  /// 画面に並ぶ国の順が、貼られた行の並びで変わらないように。
  ///
  /// 国コードを持たない停留所(カタログ由来はこれ。TS の `resolveKnownStops` も国コードを
  /// 持たない)は数に入らない。auto のまま複数国が出たらビルドを止めて確認画面へ戻す、という
  /// 使い方は `usePlanBuild.tsx:1090-1105`。
  public static func mixedCountryCodes(_ stops: [ResolvedStop]) -> [String] {
    var codes: Set<String> = []
    for stop in stops {
      guard let code = stop.countryCode, !code.isEmpty else { continue }
      codes.insert(code)
    }
    guard codes.count > 1 else { return [] }
    return codes.sorted { jsStringLess($0, $1) }
  }

  /// 確認が要る行(`review` / `unresolved`)に、**入力順**の 0 始まりの順位を付ける。
  ///
  /// TS `resolveAttentionRanks`(`app/components/planner/hooks/useTripDomainModel.tsx:1209-1217`)。
  /// TS は貼られた行の並び(`reviewedPlaceRows`)を辿って `ranks.size` を順位にするので、
  /// ここも `inputIndex` の昇順で数える。画面はこの順位が 3 以上の行を「先に上の項目を確認すると、
  /// ここが選べるようになります」で抑止し、1 件解決するたびに次が窓に入る
  /// (`ResolveScreen.tsx:218-219`)。順位が付くのは確認が要る行だけなので、確定した行は飛ばす。
  public static func attentionRanks(_ results: [Int: PlaceResolution]) -> [Int: Int] {
    var ranks: [Int: Int] = [:]
    for inputIndex in results.keys.sorted() {
      switch results[inputIndex] {
      case .review, .unresolved: ranks[inputIndex] = ranks.count
      case .confirmed, nil: continue
      }
    }
    return ranks
  }

  // MARK: - 内部

  /// TS `normalizePlaceName`(`lib/google-place-resolver.ts:163-165`)。
  /// `value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")`。
  ///
  /// TS の `toLocaleLowerCase()` は実行環境の既定ロケール依存(tr で `I` → `ı`)だが、移植先は
  /// 端末をまたいで同じ答えでなければならないので、ロケール非依存の `lowercased()` を使う。
  static func normalizePlaceName(_ value: String) -> String {
    let folded = value.precomposedStringWithCompatibilityMapping.lowercased()
    return separatorsAndMarks.replacingAll(in: folded, with: "")
  }

  /// TS `corporateQualifierPattern`(`lib/google-place-resolver.ts:305`)を逐語転記。
  /// ICU の `\b` は既定で JS と同じ単純な語境界(`[A-Za-z0-9_]`)。
  private static let corporateQualifierPattern = try! JSRegex(
    "(?:保険(?:会社|代理店)?|生命(?:保険)?|株式会社|合同会社|本社|オフィス|insurance|corporat(?:e|ion)|headquarters|\\boffice\\b|\\binc\\.?\\b|\\bltd\\.?\\b)",
    options: [.caseInsensitive]
  )

  private static let separatorsAndMarks = try! JSRegex("[\\s\\p{P}\\p{S}]+")

  /// `confirmed > review > unresolved`。パイプラインが後の答えで置き換えてよいかだけに使う。
  private static func rank(_ resolution: PlaceResolution) -> Int {
    switch resolution {
    case .confirmed: 2
    case .review: 1
    case .unresolved: 0
    }
  }
}
