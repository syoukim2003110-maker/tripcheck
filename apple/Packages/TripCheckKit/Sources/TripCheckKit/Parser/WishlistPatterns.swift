import Foundation

/// lib/wishlist-parser.ts:35-238 — regex ソース文字列は TS の文字列リテラルを逐語転記する。
/// JS の "i" フラグ → `.caseInsensitive`、"g" フラグ → `matches(in:)`/`replacingAll` で全件処理、
/// "u" フラグ → ICU (`NSRegularExpression`) の既定動作でそのまま対応する。
enum WishlistPatterns {
  // MARK: lib/wishlist-parser.ts:35-36

  static let SEP = "\\s、,，・·()（）\\[\\]【】—–―:~\\-\\.。|｜!！?？"
  static let EDGE_SEP = "\\s、,，・·—–―:~\\-\\.。|｜!！?？"

  /// lib/wishlist-parser.ts:37-38 — `boundaryToken(source)`
  static func boundaryTokenSource(_ source: String) -> String {
    "(?:(?<=^)|(?<=[\(SEP)]))(?:\(source))(?=$|[\(SEP)])"
  }

  static func boundaryToken(_ source: String) -> JSRegex {
    try! JSRegex(boundaryTokenSource(source), options: [.caseInsensitive])
  }

  // MARK: lib/wishlist-parser.ts:40-41 — day

  static let dayTokenSource = "day\\s*\\d{1,2}|\\d{1,2}\\s*日目|\\d{1,2}\\s*일차|第?\\s*\\d{1,2}\\s*天"
  static let dayAnywhere = try! JSRegex(
    "day\\s*(\\d{1,2})|(\\d{1,2})\\s*日目|(\\d{1,2})\\s*일차|第?\\s*(\\d{1,2})\\s*天",
    options: [.caseInsensitive]
  )
  static let dayToken = boundaryToken(dayTokenSource)

  // MARK: lib/wishlist-parser.ts:43-44 — must

  static let mustAnywhere = try! JSRegex(
    "\\bmust(?:-do)?\\b|\\bnon[- ]?negotiable\\b|絶対に?行く|絶対に?行きたい|必須|絶対|マスト|필수|꼭|必去|必须",
    options: [.caseInsensitive]
  )
  static let mustTokenSource = "must(?:-do)?|non[- ]?negotiable|絶対に?行きたい|絶対に?行く|必須|絶対|マスト|필수|꼭|必去|必须"
  static let mustToken = boundaryToken(mustTokenSource)

  // MARK: lib/wishlist-parser.ts:46-47 — optional

  static let optionalAnywhere = try! JSRegex(
    "\\boptional\\b|\\bif\\s+(?:there(?:'s| is)\\s+)?time\\b|時間があれば|時間が余れば|余裕があれば|できれば|任意|선택|시간(?:이|\\s)?되면|可选|有时间",
    options: [.caseInsensitive]
  )
  static let optionalTokenSource = "optional|if\\s+(?:there(?:'s| is)\\s+)?time|時間があれば|時間が余れば|余裕があれば|できれば|任意|선택|可选|有时间"
  static let optionalToken = boundaryToken(optionalTokenSource)

  // MARK: lib/wishlist-parser.ts:49-50 — reservation

  static let reservationAnywhere = try! JSRegex(
    "\\bbooked\\b|\\breserved\\b|\\breservation\\b|\\btimed ticket\\b|\\bneed tickets?\\b|\\btickets? (?:required|needed)\\b|\\badvance tickets?\\b|予約済み?|要予約|予約|確定|要チケット|チケット必要|チケット(?:購入|確保)済み?|예약|예매|预约|预订",
    options: [.caseInsensitive]
  )
  static let reservationTokenSource = "booked|reserved|reservation|timed ticket|need\\s+tickets?|tickets?\\s+(?:required|needed)|advance\\s+tickets?|予約済み?|要予約|予約|確定|要チケット|チケット必要|チケット(?:購入|確保)済み?|예약|예매|预约|预订"
  static let reservationToken = boundaryToken(reservationTokenSource)

  // MARK: lib/wishlist-parser.ts:55-57 — time of day

  static let eveningTokenSource = "at\\s+sunset|sunset|at\\s+dusk|dusk|in\\s+the\\s+evening|evening|夕方|夕暮れ|夕日|サンセット"
  static let nightTokenSource = "at\\s+night|night\\s+view|night|夜景|ナイト|夜"
  static let morningTokenSource = "early\\s+morning|morning|朝イチ|朝一番?|午前中|朝ごはん|朝食|朝"
  static let eveningToken = boundaryToken(eveningTokenSource)
  static let nightToken = boundaryToken(nightTokenSource)
  static let morningToken = boundaryToken(morningTokenSource)

  // MARK: lib/wishlist-parser.ts:59-67 — clock times

  static let colonTimeSource = "(?:[01]?\\d|2[0-3]):[0-5]\\d"
  static let kanjiTimeSource = "(?:[01]?\\d|2[0-3])\\s*時(?!間)(?:\\s*(?:半|[0-5]?\\d\\s*分))?"
  static let anyTimeSource = "(?:\(colonTimeSource)|\(kanjiTimeSource))"
  static let timeRange = try! JSRegex(
    "\(anyTimeSource)\\s*(?:[-~–—―]|から)\\s*\(anyTimeSource)",
    options: [.caseInsensitive]
  )
  static let timeWithAffixes = try! JSRegex(
    "(?:午前|午後|am|pm)?\\s*(?:@\\s*)?(\(colonTimeSource))(?:\\s*(?:予約|集合|入場|開始|着|発|に|から|頃|ごろ|くらい))?"
      + "|(?:午前|午後|am|pm)?\\s*(?:@\\s*)?((?:[01]?\\d|2[0-3]))\\s*時(?!間)(?:\\s*(半)|\\s*([0-5]?\\d)\\s*分)?(?:\\s*(?:予約|集合|入場|開始|着|発|に|から|頃|ごろ|くらい))?",
    options: [.caseInsensitive]
  )

  // MARK: lib/wishlist-parser.ts:69-73 — stay

  static let staySources = [
    "滞在\\s*(\\d{1,3})\\s*分",
    "(\\d{1,3})\\s*分\\s*滞在",
    "stay\\s*(\\d{1,3})\\s*min(?:ute)?s?",
  ]
  static let stayPatterns = staySources.map { try! JSRegex($0, options: [.caseInsensitive]) }

  // MARK: lib/wishlist-parser.ts:83-88 — stripBullet

  static let bulletLead = try! JSRegex("^[-•*・●○◦▪‣☆★>»]+\\s*")
  static let numberedLead = try! JSRegex("^\\(?\\d{1,2}[.)、]\\s*")

  // MARK: lib/wishlist-parser.ts:90-106 — tidyName

  static let parenResidue = try! JSRegex("[（(][\\s!！?？。.、,，・·—–―:~\\-|｜]*[)）]")
  static let emptyQuotes = try! JSRegex("[「『]\\s*[」』]")
  static let separatorRun = try! JSRegex("(?:^|\\s)[—–―·・:~\\-,、，.。|｜]+(?=\\s|$)")
  static let edgeSepLeading = try! JSRegex("^[\(EDGE_SEP)]+")
  static let edgeSepTrailing = try! JSRegex("[\(EDGE_SEP)]+$")
  static let multiSpace = try! JSRegex("\\s{2,}")

  // MARK: lib/wishlist-parser.ts:108-121 — hasCjk / topLevelMiddleDotCount

  static let cjkPattern = try! JSRegex("[぀-ヿ㐀-鿿豈-﫿]")
  static let middleDotSpacing = try! JSRegex("\\s・|・\\s")

  // MARK: lib/wishlist-parser.ts:168-183 — parenthetical landmark

  static let parentheticalLandmark = try! JSRegex(
    "(?:寺|神社|大社|城|橋|公園|庭園|竹林|市場|駅|タワー|ミュージアム|博物館|美術館|水族館|動物園|通天閣)$"
  )
  static let parenGroupPattern = try! JSRegex("^(.+?)\\(([^()]*)\\)$")

  // MARK: lib/wishlist-parser.ts:193-207 — headings

  static let headingLead = try! JSRegex(
    "^(?:day\\s*(\\d{1,2})|(\\d{1,2})\\s*日目|(\\d{1,2})\\s*일차|第?\\s*(\\d{1,2})\\s*天)(?:\\s+|\\s*[.:、,，\\-–—―~]\\s*|$)",
    options: [.caseInsensitive]
  )

  static let englishMonthSource = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"

  static let calendarHeadingLead = try! JSRegex(
    "^(?:(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})|(?:(\\d{4})\\s*年\\s*)?(\\d{1,2})月(\\d{1,2})日|(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?(?:,)?\\s+)?(\(englishMonthSource))\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?)(?:\\s+|\\s*[.:、,，\\-–—―~]\\s*|$)",
    options: [.caseInsensitive]
  )

  static let englishMonths: [String: Int] = [
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
  ]

  // MARK: lib/wishlist-parser.ts:379 — URL stripping

  static let urlPattern = try! JSRegex("https?://\\S+")
}
