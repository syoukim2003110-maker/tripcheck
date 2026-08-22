import Foundation
import TripCheckKit

/*
 * 旅行者が書いた 1 行 —— 「行きたい場所」と、その場所に添えた条件(日・時刻・予約・必須・滞在)。
 *
 * Web は同じものを**テキストのまま**持っている(`itinerary` の 1 行が 1 か所)。アプリは行を
 * 個別に編集・並べ替え・固定できる必要があるので `[WishlistEntry]` を正にし、エンジンに渡す
 * 直前だけ `WishlistSerialization.raw` で Web と同じバイトのテキストへ戻す。Kit のパーサ・
 * 直列化器を通るので、貼り付け → 編集 → 共有の往復で綴りが変わらない。
 *
 * `Codable` にはしない —— 端末内保存は Task 11 の `PersistedTripInput` DTO が担う。Kit の
 * `ResolvedStop` をそのまま書き出すと、プロバイダの内部欄が保存ファイルの形になってしまう。
 */
public struct WishlistEntry: Identifiable, Hashable, Sendable {
  public var id: UUID
  public var text: String
  public var priority: WishlistPriority
  /// 1 始まりの日。`nil` は「どの日でもよい」。
  public var fixedDay: Int?
  /// `HH:MM`。予約や開館待ちのように動かせない時刻。
  public var fixedTime: String?
  public var timeOfDay: WishlistTimeOfDay?
  public var isReservation: Bool
  public var stayMinutes: Int?
  /// 旅行者が「この場所で合っている」と決めた 1 件。決まっていなければ `nil`。
  public var pinned: PinnedResolution?

  public init(
    id: UUID = UUID(),
    text: String,
    priority: WishlistPriority = .normal,
    fixedDay: Int? = nil,
    fixedTime: String? = nil,
    timeOfDay: WishlistTimeOfDay? = nil,
    isReservation: Bool = false,
    stayMinutes: Int? = nil,
    pinned: PinnedResolution? = nil
  ) {
    self.id = id
    self.text = text
    self.priority = priority
    self.fixedDay = fixedDay
    self.fixedTime = fixedTime
    self.timeOfDay = timeOfDay
    self.isReservation = isReservation
    self.stayMinutes = stayMinutes
    self.pinned = pinned
  }

  /// Kit のパーサが読む形。`ParsedWishlistPlace` の init は 7 つの引数を全部要求する
  /// (既定引数が無い)ので、欄の対応をここで一度だけ書く。
  public var parsed: ParsedWishlistPlace {
    ParsedWishlistPlace(
      name: text,
      day: fixedDay,
      time: fixedTime,
      timeOfDay: timeOfDay,
      isReservation: isReservation,
      priority: priority,
      stayMinutes: stayMinutes
    )
  }
}

/// 「この名前はこの場所のことだ」と決まった証拠。**どうやって決まったか**を残すのは、
/// 保存した旅程を開き直すときに扱いが分かれるから: プロバイダの決定は識別子ごと再利用でき、
/// 手入力の決定は旅行者が置いた座標が正で、カタログの決定はカタログを引き直せばよい
/// (Task 11 の `openTrip`)。
public enum PinnedResolution: Hashable, Sendable {
  /// 端末の地図が答えた 1 件。`providerRef` は同じ場所をもう一度引くための識別子。
  case apple(providerRef: String?, stop: ResolvedStop)
  /// 旅行者が地図上に自分で置いた点。
  case manual(ResolvedStop)
  /// Kit の同梱カタログ(サンプル旅程・既知の観光地)が答えた 1 件。
  case catalog(ResolvedStop)

  public var stop: ResolvedStop {
    switch self {
    case .apple(_, let stop): stop
    case .manual(let stop): stop
    case .catalog(let stop): stop
    }
  }
}

/// `[WishlistEntry]` と Web と同じテキストの間の往復。両向きとも Kit の実装をそのまま使う
/// ——「アプリだけが読める書き方」を作らないための唯一の入口。
public enum WishlistSerialization {

  /// `WishlistSerializer.formatPlaces` そのもの。見出しは `Day N` /「N日目」、区切りは " — "。
  public static func raw(from entries: [WishlistEntry], locale: PlannerLocale) -> String {
    WishlistSerializer.formatPlaces(entries.map(\.parsed), languageCode: locale)
  }

  /// 貼り付けられた文字列を行に畳む。`.heading` の日は Kit のパーサが後続の `.place` に
  /// 配ってくれる(`WishlistParser.swift` の `contextDay`)ので、ここは `place.day` を
  /// `fixedDay` へ写すだけでよい。
  ///
  /// `mode` はビルダーと同じ規則(`TripBuilder.build`):見出しが 1 つでもある、または日の
  /// 付いた場所が 1 つでもあれば「既にある旅程の確認」。表示用の値で、正は
  /// `bundle.plan.inputMode`。
  public static func entries(fromPasted raw: String) -> (entries: [WishlistEntry], unparsed: [String], mode: InputMode) {
    let lines = WishlistParser.parse(raw)
    var entries: [WishlistEntry] = []
    var unparsed: [String] = []
    for line in lines {
      switch line {
      case .empty, .heading:
        continue
      case .unparsed(let text):
        // `.unparsed` の `raw` はパーサが既に trim 済みの行そのもの。
        unparsed.append(text)
      case .place(_, let places):
        for place in places {
          entries.append(WishlistEntry(
            text: place.name,
            priority: place.priority,
            fixedDay: place.day,
            fixedTime: place.time,
            timeOfDay: place.timeOfDay,
            isReservation: place.isReservation,
            stayMinutes: place.stayMinutes
          ))
        }
      }
    }
    let checker = lines.contains { line in
      if case .heading = line { return true }
      if case .place(_, let places) = line { return places.contains { $0.day != nil } }
      return false
    }
    return (entries, unparsed, checker ? .existing_itinerary : .wishlist)
  }
}
