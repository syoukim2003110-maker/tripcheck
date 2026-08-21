/*
 * Traveller essentials — the handful of country facts that reliably trip
 * people up abroad: the plug in the wall, whether to tip, whether to drink
 * the tap water, the number to call, what a Japanese passport needs at the
 * border, and the one transport pass that changes the trip's budget. These
 * are stable, well-documented facts — but entry rules do change, so every
 * entry line links to the official source and is written as "verify before
 * departure", never as a guarantee.
 *
 * TS `lib/destinations.ts:930-1472`.
 */

/// TS `DestinationEssentials` (`lib/destinations.ts:930-940`)
public struct DestinationEssentials: Hashable, Sendable, Codable {
  /// IEC plug letters and mains voltage, e.g. "C / J · 230V".
  public var plug: String
  public var tipping: [PlannerLocale: String]
  public var emergency: [PlannerLocale: String]
  /// Entry requirement for a Japanese passport; always verify officially.
  public var entry: DestinationEntryInfo
  /// The one pass that materially changes trip cost, if the country has one.
  public var pass: DestinationLinkedNote?
  /// Official page for planned strikes/disruption, where a reliable one exists.
  public var strikeInfo: DestinationLinkedNote?

  public init(
    plug: String,
    tipping: [PlannerLocale: String],
    emergency: [PlannerLocale: String],
    entry: DestinationEntryInfo,
    pass: DestinationLinkedNote? = nil,
    strikeInfo: DestinationLinkedNote? = nil
  ) {
    self.plug = plug
    self.tipping = tipping
    self.emergency = emergency
    self.entry = entry
    self.pass = pass
    self.strikeInfo = strikeInfo
  }
}

public struct DestinationEntryInfo: Hashable, Sendable, Codable {
  public var en: String
  public var ja: String
  public var sourceUrl: String

  public init(en: String, ja: String, sourceUrl: String) {
    self.en = en
    self.ja = ja
    self.sourceUrl = sourceUrl
  }
}

/// Shared shape for `DestinationEssentials.pass` and `.strikeInfo` (TS `{ en, ja, url }`).
public struct DestinationLinkedNote: Hashable, Sendable, Codable {
  public var en: String
  public var ja: String
  public var url: String

  public init(en: String, ja: String, url: String) {
    self.en = en
    self.ja = ja
    self.url = url
  }
}

private func mofa(_ path: String) -> String {
  "https://www.mofa.go.jp/mofaj/area/\(path)/index.html"
}

private func schengenEntry(_ path: String) -> DestinationEntryInfo {
  DestinationEntryInfo(
    en: "Japan passport: visa-free 90 days in any 180 (Schengen). ETIAS pre-travel authorisation is being introduced — check before departure.",
    ja: "日本のパスポート：シェンゲン圏はビザ不要（180日中90日）。ETIAS（電子渡航認証）の導入が予定されているため出発前に要確認。",
    sourceUrl: mofa(path)
  )
}

private let essentialsById: [DestinationId: DestinationEssentials] = [
  .japan: DestinationEssentials(
    plug: "A · 100V",
    tipping: [.en: "No tipping anywhere.", .ja: "チップの習慣なし。"],
    emergency: [.en: "110 police · 119 fire/ambulance", .ja: "110 警察 / 119 消防・救急"],
    entry: DestinationEntryInfo(en: "Japanese citizens need no visa or travel authorisation to enter Japan. Non-Japanese companions must check their own passport rules.", ja: "日本国籍は不要。外国籍の同行者は各自の旅券の条件を確認。", sourceUrl: "https://www.mofa.go.jp/j_info/visit/visa/index.html"),
    pass: DestinationLinkedNote(en: "Japan Rail Pass (overseas visitors only) can pay off on multi-city rail trips.", ja: "ジャパン・レール・パスは訪日外国人専用。日本国籍者は利用不可。", url: "https://japanrailpass.net/"),
  ),
  .switzerland: DestinationEssentials(
    plug: "C / J · 230V",
    tipping: [.en: "Service included; rounding up is plenty.", .ja: "サービス料込み。端数を切り上げる程度で十分。"],
    emergency: [.en: "112 general · 117 police · 144 ambulance · 1414 Rega air rescue", .ja: "112 共通 / 117 警察 / 144 救急 / 1414 山岳救助(Rega)"],
    entry: schengenEntry("switzerland"),
    pass: DestinationLinkedNote(en: "Swiss Travel Pass covers rail, bus, boat and most museums; the Half Fare Card halves mountain railways. Price the pass before buying single tickets.", ja: "スイストラベルパスは鉄道・バス・湖船・多くの美術館をカバー。山岳鉄道は半額カード適用。個別購入前にパスの損益分岐を確認する価値あり。", url: "https://www.myswitzerland.com/ja/planning/transport/tickets-public-transport/swiss-travel-pass/"),
  ),
  .korea: DestinationEssentials(
    plug: "C / F · 220V",
    tipping: [.en: "No tipping.", .ja: "チップの習慣なし。"],
    emergency: [.en: "112 police · 119 fire/ambulance", .ja: "112 警察 / 119 消防・救急"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free short stays; K-ETA requirement is periodically waived — check current status.", ja: "日本のパスポート：短期観光はビザ不要。K-ETAの要否は時期で変わるため出発前に要確認。", sourceUrl: mofa("korea")),
    pass: nil,
  ),
  .taiwan: DestinationEssentials(
    plug: "A / B · 110V",
    tipping: [.en: "No tipping.", .ja: "チップの習慣なし。"],
    emergency: [.en: "110 police · 119 fire/ambulance", .ja: "110 警察 / 119 消防・救急"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free 90 days.", ja: "日本のパスポート：90日以内はビザ不要。", sourceUrl: mofa("taiwan")),
    pass: nil,
  ),
  .hongkong: DestinationEssentials(
    plug: "G · 220V",
    tipping: [.en: "10% service charge is usually added; loose change otherwise.", .ja: "10%のサービス料が加算されることが多い。追加は小銭程度。"],
    emergency: [.en: "999 all services", .ja: "999（警察・消防・救急共通）"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free 90 days.", ja: "日本のパスポート：90日以内はビザ不要。", sourceUrl: mofa("hongkong")),
    pass: nil,
  ),
  .singapore: DestinationEssentials(
    plug: "G · 230V",
    tipping: [.en: "No tipping; 10% service charge is built in.", .ja: "チップ不要。10%サービス料込みが基本。"],
    emergency: [.en: "999 police · 995 fire/ambulance", .ja: "999 警察 / 995 消防・救急"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free short stays; submit the SG Arrival Card online before landing.", ja: "日本のパスポート：短期滞在はビザ不要。入国前にSGアライバルカード（電子入国申告）の提出が必要。", sourceUrl: mofa("singapore")),
    pass: nil,
  ),
  .thailand: DestinationEssentials(
    plug: "A / B / C / O · 220V",
    tipping: [.en: "Not required; small notes appreciated at sit-down places.", .ja: "必須ではない。レストランで少額を置く程度。"],
    emergency: [.en: "191 police · 1669 ambulance · 1155 tourist police", .ja: "191 警察 / 1669 救急 / 1155 ツーリストポリス"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free tourist stays; a digital arrival card may be required — check before departure.", ja: "日本のパスポート：観光はビザ不要。電子入国カード（TDAC）の要否を出発前に確認。", sourceUrl: mofa("thailand")),
    pass: nil,
  ),
  .vietnam: DestinationEssentials(
    plug: "A / C · 220V",
    tipping: [.en: "Not expected; appreciated for guides and spas.", .ja: "基本不要。ガイドやスパでは歓迎される。"],
    emergency: [.en: "113 police · 115 ambulance", .ja: "113 警察 / 115 救急"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free 45 days — verify the current limit.", ja: "日本のパスポート：45日以内はビザ不要（最新の日数は要確認）。", sourceUrl: mofa("vietnam")),
    pass: nil,
  ),
  .indonesia: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Not required; 5–10% at upscale places.", .ja: "基本不要。高級店では5〜10%程度。"],
    emergency: [.en: "110 police · 118 ambulance · 112 general (rollout)", .ja: "110 警察 / 118 救急 / 112 共通(整備中)"],
    entry: DestinationEntryInfo(en: "Japan passport: Visa on Arrival (paid) at major airports — e-VOA can be bought online in advance.", ja: "日本のパスポート：到着ビザ（VOA・有料）が必要。事前にe-VOAをオンライン取得可能。", sourceUrl: mofa("indonesia")),
    pass: nil,
  ),
  .uae: DestinationEssentials(
    plug: "G · 230V",
    tipping: [.en: "10% common; often already on the bill.", .ja: "10%程度が一般的。伝票に含まれていることも多い。"],
    emergency: [.en: "999 police · 998 ambulance", .ja: "999 警察 / 998 救急"],
    entry: DestinationEntryInfo(en: "Japan passport: visa-free 30 days on arrival.", ja: "日本のパスポート：30日以内はビザ不要（到着時スタンプ）。", sourceUrl: mofa("uae")),
    pass: nil,
  ),
  .france: DestinationEssentials(
    plug: "C / E · 230V",
    tipping: [.en: "Service included; leave coins for great service.", .ja: "サービス料込み。良い接客に小銭を置く程度。"],
    emergency: [.en: "112 general · 17 police · 15 SAMU", .ja: "112 共通 / 17 警察 / 15 救急(SAMU)"],
    entry: schengenEntry("france"),
    pass: nil,
    strikeInfo: DestinationLinkedNote(en: "French transport strikes are announced in advance — check SNCF traffic info for your dates.", ja: "フランスの交通ストは事前告知制。旅程の日付でSNCFの運行情報を確認。", url: "https://www.sncf-connect.com/en-en/trafficInfo"),
  ),
  .italy: DestinationEssentials(
    plug: "C / F / L · 230V",
    tipping: [.en: "No tipping needed; coperto (cover charge) appears on bills.", .ja: "チップ不要。コペルト（席料）が伝票に載るのは正規の慣習。"],
    emergency: [.en: "112 all services", .ja: "112（共通）"],
    entry: schengenEntry("italy"),
    pass: nil,
    strikeInfo: DestinationLinkedNote(en: "Italian strikes are pre-announced on the transport ministry's official calendar — check it against your dates; guaranteed-service trains still run.", ja: "イタリアのストは交通省の公式カレンダーで事前告知される。旅程の日付と照合を。スト中も「運行保証便」は走る。", url: "https://scioperi.mit.gov.it/mit2/public/scioperi"),
  ),
  .spain: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Not expected; rounding up is fine.", .ja: "基本不要。端数の切り上げ程度。"],
    emergency: [.en: "112 all services", .ja: "112（共通）"],
    entry: schengenEntry("spain"),
    pass: nil,
  ),
  .portugal: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Round up ~5–10% for table service.", .ja: "テーブルサービスで5〜10%目安の切り上げ。"],
    emergency: [.en: "112 all services", .ja: "112（共通）"],
    entry: schengenEntry("portugal"),
    pass: nil,
  ),
  .uk: DestinationEssentials(
    plug: "G · 230V",
    tipping: [.en: "10–12.5% at restaurants when service isn't added.", .ja: "サービス料がなければレストランで10〜12.5%。"],
    emergency: [.en: "999 (or 112) all services", .ja: "999（112も可・共通）"],
    entry: DestinationEntryInfo(en: "Japan passport: ETA (electronic travel authorisation) required before travel; visa-free up to 6 months.", ja: "日本のパスポート：渡航前にETA（電子渡航認証）の取得が必要。観光は最長6か月ビザ不要。", sourceUrl: mofa("uk")),
    pass: nil,
  ),
  .germany: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Round up 5–10%; say the total when paying.", .ja: "5〜10%の切り上げ。支払い時に合計額を告げる方式。"],
    emergency: [.en: "112 fire/ambulance · 110 police", .ja: "112 消防・救急 / 110 警察"],
    entry: schengenEntry("germany"),
    pass: nil,
    strikeInfo: DestinationLinkedNote(en: "Check DB's live disruption page close to travel — rail strikes are announced, not spontaneous.", ja: "鉄道ストは事前告知制。直前にDBの運行情報ページを確認。", url: "https://www.bahn.de/service/fahrplaene/aktuell"),
  ),
  .austria: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Round up 5–10%.", .ja: "5〜10%の切り上げが目安。"],
    emergency: [.en: "112 general · 133 police · 144 ambulance", .ja: "112 共通 / 133 警察 / 144 救急"],
    entry: schengenEntry("austria"),
    pass: nil,
  ),
  .netherlands: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Not expected; round up if you like.", .ja: "基本不要。端数の切り上げ程度。"],
    emergency: [.en: "112 all services", .ja: "112（共通）"],
    entry: schengenEntry("netherlands"),
    pass: nil,
  ),
  .iceland: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "No tipping.", .ja: "チップの習慣なし。"],
    emergency: [.en: "112 all services", .ja: "112（共通）"],
    entry: schengenEntry("iceland"),
    pass: nil,
  ),
  .norway: DestinationEssentials(
    plug: "C / F · 230V",
    tipping: [.en: "Not expected; round up for good service.", .ja: "基本不要。良い接客に切り上げ程度。"],
    emergency: [.en: "112 police · 113 ambulance · 110 fire", .ja: "112 警察 / 113 救急 / 110 消防"],
    entry: schengenEntry("norway"),
    pass: nil,
  ),
  .usa: DestinationEssentials(
    plug: "A / B · 120V",
    tipping: [.en: "18–20% expected at sit-down restaurants; tip counter service less.", .ja: "レストランで18〜20%が事実上必須。カウンター店は少なめ。"],
    emergency: [.en: "911 all services", .ja: "911（共通）"],
    entry: DestinationEntryInfo(en: "Japan passport: ESTA required before travel (Visa Waiver Program).", ja: "日本のパスポート：渡航前にESTAの取得が必要（ビザ免除プログラム）。", sourceUrl: mofa("usa")),
    pass: nil,
  ),
  .canada: DestinationEssentials(
    plug: "A / B · 120V",
    tipping: [.en: "15–20% at restaurants.", .ja: "レストランで15〜20%が一般的。"],
    emergency: [.en: "911 all services", .ja: "911（共通）"],
    entry: DestinationEntryInfo(en: "Japan passport: eTA required before flying in.", ja: "日本のパスポート：空路入国は事前にeTAの取得が必要。", sourceUrl: mofa("canada")),
    pass: nil,
  ),
  .australia: DestinationEssentials(
    plug: "I · 230V",
    tipping: [.en: "Not expected.", .ja: "チップは基本不要。"],
    emergency: [.en: "000 all services", .ja: "000（共通）"],
    entry: DestinationEntryInfo(en: "Japan passport: ETA (subclass 601) required before travel.", ja: "日本のパスポート：渡航前にETA（サブクラス601）の取得が必要。", sourceUrl: mofa("australia")),
    pass: nil,
  ),
  .newzealand: DestinationEssentials(
    plug: "I · 230V",
    tipping: [.en: "Not expected.", .ja: "チップは基本不要。"],
    emergency: [.en: "111 all services", .ja: "111（共通）"],
    entry: DestinationEntryInfo(en: "Japan passport: NZeTA required before travel (plus IVL levy).", ja: "日本のパスポート：渡航前にNZeTAの取得が必要（IVL料金あり）。", sourceUrl: mofa("nz")),
    pass: nil,
  ),
]

/*
 * ── Entry authorisations & passport validity ─────────────────────────────
 * The pre-trip timeline turns these into dated to-dos. Real travellers get
 * turned away at check-in over exactly two things encoded here: an electronic
 * authorisation they never heard of (ESTA at the counter, eTA for a mere
 * Vancouver transit) and a passport that is valid but not valid ENOUGH.
 * Figures verified 2026-08 against the linked official sites; no free API
 * exists for any of this, so the data is static by design and each item
 * carries its official URL for the user to re-verify.
 */

/// TS `EntryAuthority.status` (`lib/destinations.ts:1220`) — required now · not launched
/// yet ("check again") · currently waived.
public enum EntryAuthorityStatus: String, Hashable, Sendable, Codable {
  case required, not_yet, waived
}

/// TS `EntryAuthority` (`lib/destinations.ts:1217-1234`)
public struct EntryAuthority: Hashable, Sendable, Codable {
  /// What the airline agent will call it.
  public var name: String
  public var status: EntryAuthorityStatus
  /// Last calendar day covered by a temporary status such as a waiver.
  public var statusValidUntil: String?
  public var summary: [PlannerLocale: String]
  /// Days before arrival when applications OPEN (Thailand's TDAC and Singapore's arrival
  /// card cannot be filed earlier); nil = apply anytime.
  public var opensDaysBefore: Int?
  /// Have-it-done margin in days before departure; 0 = by the arrival day.
  public var deadlineDaysBefore: Int
  /// True when even an airside transit through the country requires it.
  public var transit: Bool
  public var officialUrl: String

  public init(
    name: String,
    status: EntryAuthorityStatus,
    statusValidUntil: String? = nil,
    summary: [PlannerLocale: String],
    opensDaysBefore: Int?,
    deadlineDaysBefore: Int,
    transit: Bool,
    officialUrl: String
  ) {
    self.name = name
    self.status = status
    self.statusValidUntil = statusValidUntil
    self.summary = summary
    self.opensDaysBefore = opensDaysBefore
    self.deadlineDaysBefore = deadlineDaysBefore
    self.transit = transit
    self.officialUrl = officialUrl
  }
}

/// TS `PassportRule.referenceDate` (`lib/destinations.ts:1240`) — `entry` rules are measured
/// from the first trip day; `departure` rules are measured from the final trip day.
public enum PassportReferenceDate: String, Hashable, Sendable, Codable {
  case entry, departure
}

/// TS `PassportRule` (`lib/destinations.ts:1236-1249`)
public struct PassportRule: Hashable, Sendable, Codable {
  /// Months of validity the border demands beyond the relevant date. 0 + `.departure` means
  /// the passport only needs to remain valid for the whole stay.
  public var monthsBeyond: Int
  public var referenceDate: PassportReferenceDate
  /// A condition (other than expiry) that this product cannot verify.
  public var additionalCheck: [PlannerLocale: String]?
  public var summary: [PlannerLocale: String]
  public var sourceUrl: String

  public init(
    monthsBeyond: Int,
    referenceDate: PassportReferenceDate,
    additionalCheck: [PlannerLocale: String]? = nil,
    summary: [PlannerLocale: String],
    sourceUrl: String
  ) {
    self.monthsBeyond = monthsBeyond
    self.referenceDate = referenceDate
    self.additionalCheck = additionalCheck
    self.summary = summary
    self.sourceUrl = sourceUrl
  }
}

private let etiasPending = EntryAuthority(
  name: "ETIAS",
  status: .not_yet,
  summary: [.en: "EU travel authorisation — NOT launched yet (2027 expected). Check the official page before departure and ignore paid lookalike sites.", .ja: "EUの電子渡航認証。まだ開始されていない（2027年開始見込み）。出発前に公式ページで最新状況を確認。高額な非公式代行サイトに注意。"],
  opensDaysBefore: nil,
  deadlineDaysBefore: 0,
  transit: false,
  officialUrl: "https://travel-europe.europa.eu/etias_en",
)

private let entryAuthorityById: [DestinationId: EntryAuthority] = [
  .usa: EntryAuthority(
    name: "ESTA",
    status: .required,
    summary: [.en: "US$40.27, valid 2 years. Needed even for a transit. Apply at least 72 hours before departure.", .ja: "US$40.27・有効2年。乗り継ぎだけでも必要。出発72時間前までの申請が推奨。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 3,
    transit: true,
    officialUrl: "https://esta.cbp.dhs.gov/",
  ),
  .uk: EntryAuthority(
    name: "ETA",
    status: .required,
    summary: [.en: "£20, valid 2 years. Usually minutes, allow 3 working days.", .ja: "£20・有効2年。通常は数分〜、最大3営業日みておく。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 3,
    transit: false,
    officialUrl: "https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta",
  ),
  .canada: EntryAuthority(
    name: "eTA",
    status: .required,
    summary: [.en: "CA$7, valid 5 years. Needed even when only transiting a Canadian airport. Usually minutes, can take days.", .ja: "CA$7・有効5年。カナダの空港で乗り継ぐだけでも必要（見落とし最多）。通常は数分だが数日かかる場合あり。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 3,
    transit: true,
    officialUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html",
  ),
  .australia: EntryAuthority(
    name: "ETA (601)",
    status: .required,
    summary: [.en: "AU$20, valid 1 year. Apply only via the AustralianETA app.", .ja: "AU$20・有効1年。申請はAustralianETAアプリからのみ。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 3,
    transit: false,
    officialUrl: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601",
  ),
  .newzealand: EntryAuthority(
    name: "NZeTA",
    status: .required,
    summary: [.en: "NZ$17 (app) / NZ$23 (web) plus NZ$100 IVL levy, valid 2 years. Needed for Auckland transits too. Allow 72 hours.", .ja: "NZ$17（アプリ）/ NZ$23（Web）+ IVL料 NZ$100・有効2年。オークランド乗り継ぎでも必要。72時間前までの申請推奨。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 3,
    transit: true,
    officialUrl: "https://www.immigration.govt.nz/visas/new-zealand-electronic-travel-authority-nzeta/",
  ),
  .korea: EntryAuthority(
    name: "K-ETA",
    status: .waived,
    statusValidUntil: "2026-12-31",
    summary: [.en: "Waived for Japanese passports until 31 Dec 2026 — re-check for later trips.", .ja: "日本のパスポートは2026年12月31日まで免除。それ以降の旅行は要再確認。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 0,
    transit: false,
    officialUrl: "https://www.k-eta.go.kr/",
  ),
  .thailand: EntryAuthority(
    name: "TDAC",
    status: .required,
    summary: [.en: "Digital arrival card, free. Opens 72 hours before arrival — it cannot be filed earlier.", .ja: "電子入国カード・無料。到着72時間前から提出可（それより早くは出せない）。"],
    opensDaysBefore: 3,
    deadlineDaysBefore: 0,
    transit: false,
    officialUrl: "https://tdac.immigration.go.th/",
  ),
  .singapore: EntryAuthority(
    name: "SG Arrival Card",
    status: .required,
    summary: [.en: "Free, mandatory. Opens 3 days before arrival, including the arrival day.", .ja: "無料・必須。到着日を含む3日前から提出可。"],
    opensDaysBefore: 3,
    deadlineDaysBefore: 0,
    transit: false,
    officialUrl: "https://eservices.ica.gov.sg/sgarrivalcard/",
  ),
  .indonesia: EntryAuthority(
    name: "e-VOA",
    status: .required,
    summary: [.en: "Visa on Arrival, IDR 500,000. Buying the e-VOA online beforehand skips the airport queue.", .ja: "到着ビザ（IDR 500,000・有料）。オンラインのe-VOAを事前取得すると空港の列を回避できる。"],
    opensDaysBefore: nil,
    deadlineDaysBefore: 3,
    transit: false,
    officialUrl: "https://evisa.imigrasi.go.id/",
  ),
  .switzerland: etiasPending,
  .france: etiasPending,
  .italy: etiasPending,
  .spain: etiasPending,
  .portugal: etiasPending,
  .germany: etiasPending,
  .austria: etiasPending,
  .netherlands: etiasPending,
  .iceland: etiasPending,
  .norway: etiasPending,
]

private let anzen = "https://www.anzen.mofa.go.jp/"

private let schengenPassport = PassportRule(
  monthsBeyond: 3,
  referenceDate: .departure,
  additionalCheck: [.en: "whether the passport was issued within the last 10 years", .ja: "パスポートが発行から10年以内か"],
  summary: [.en: "Passport must be valid 3+ months beyond leaving Schengen and issued within the last 10 years.", .ja: "シェンゲン圏出国予定日から3ヶ月以上の残存+発行10年以内が必要。"],
  sourceUrl: anzen
)

private let sixMonthsAtEntry = PassportRule(
  monthsBeyond: 6,
  referenceDate: .entry,
  summary: [.en: "Passport must be valid 6+ months at entry.", .ja: "入国時点で6ヶ月以上の残存有効期間が必要。"],
  sourceUrl: anzen
)

private let validForStay = PassportRule(
  monthsBeyond: 0,
  referenceDate: .departure,
  summary: [.en: "Passport must be valid for the whole stay (comfortable margin recommended).", .ja: "滞在全期間有効であればよい（余裕を持つのが安全）。"],
  sourceUrl: anzen
)

private let passportRuleById: [DestinationId: PassportRule] = [
  .switzerland: schengenPassport,
  .france: schengenPassport,
  .italy: schengenPassport,
  .spain: schengenPassport,
  .portugal: schengenPassport,
  .germany: schengenPassport,
  .austria: schengenPassport,
  .netherlands: schengenPassport,
  .iceland: schengenPassport,
  .norway: schengenPassport,
  .thailand: sixMonthsAtEntry,
  .singapore: sixMonthsAtEntry,
  .vietnam: sixMonthsAtEntry,
  .indonesia: sixMonthsAtEntry,
  .uae: sixMonthsAtEntry,
  .usa: validForStay,
  .uk: validForStay,
  .canada: validForStay,
  .korea: validForStay,
  .taiwan: validForStay,
  .hongkong: PassportRule(
    monthsBeyond: 1,
    referenceDate: .departure,
    summary: [.en: "Passport must be valid 1+ month beyond the stay.", .ja: "滞在期間+1ヶ月以上の残存有効期間が必要。"],
    sourceUrl: anzen
  ),
  .australia: validForStay,
  .newzealand: PassportRule(
    monthsBeyond: 3,
    referenceDate: .departure,
    summary: [.en: "Passport must be valid 3+ months beyond your departure from NZ.", .ja: "NZ出国予定日から3ヶ月以上の残存有効期間が必要。"],
    sourceUrl: anzen
  ),
]

extension Destinations {
  /// Traveller-basics card data; nil when we have no verified facts to show. TS
  /// `destinationEssentials`.
  public static func essentials(_ destination: Destination) -> DestinationEssentials? {
    essentialsById[destination.id]
  }

  /// TS `destinationEntryAuthority`.
  public static func entryAuthority(_ destination: Destination) -> EntryAuthority? {
    entryAuthorityById[destination.id]
  }

  /// TS `destinationPassportRule`.
  public static func passportRule(_ destination: Destination) -> PassportRule? {
    passportRuleById[destination.id]
  }
}
