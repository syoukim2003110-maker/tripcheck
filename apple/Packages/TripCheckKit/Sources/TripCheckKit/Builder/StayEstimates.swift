import Foundation

/*
 * Realistic stay durations. A theme park is a day, not a coffee stop; a shrine
 * is an hour, not an afternoon. Name patterns catch the famous cases in any
 * language; Google place types cover everything else; the caller's fallback
 * stands when neither says anything.
 *
 * lib/stay-estimates.ts:1-67
 */
public enum StayEstimates {
  // lib/stay-estimates.ts:8-15
  private static let namePatterns: [(pattern: JSRegex, minutes: Int)] = [
    (try! JSRegex("ディズニー(?:ランド|シー|リゾート)?|disney", options: [.caseInsensitive]), 540),
    (try! JSRegex("ユニバーサル[・･]?スタジオ|universal\\s*studios|(?:^|[^A-Za-z])USJ(?:$|[^A-Za-z])", options: [.caseInsensitive]), 510),
    (try! JSRegex("富士急ハイランド|ハウステンボス|ナガシマスパーランド|志摩スペイン村|グリーンランド|ルスツリゾート"), 420),
    (try! JSRegex("レゴランド|legoland|サンリオピューロランド|よみうりランド|ひらかたパーク|東武動物公園", options: [.caseInsensitive]), 360),
    (try! JSRegex("チームラボ|teamlab", options: [.caseInsensitive]), 150),
    (try! JSRegex("温泉(?:街|郷)|湯布院|由布院|草津温泉|城崎温泉|銀山温泉|下呂温泉|箱根湯本"), 180),
  ]

  // lib/stay-estimates.ts:17-34
  private static let typeDurations: [(types: Set<String>, minutes: Int)] = [
    (["amusement_park", "theme_park"], 420),
    (["water_park"], 300),
    (["zoo", "wildlife_park", "safari_park"], 180),
    (["aquarium"], 150),
    (["museum", "art_gallery", "planetarium", "science_museum"], 120),
    (["spa", "public_bath", "onsen"], 120),
    (["national_park", "state_park", "botanical_garden"], 150),
    (["stadium", "arena", "concert_hall", "performing_arts_theater"], 150),
    (["shopping_mall", "department_store"], 90),
    (["castle", "fort"], 90),
    (["market", "food_market", "flea_market"], 75),
    (["park", "garden", "japanese_garden"], 75),
    (["hiking_area", "ski_resort"], 240),
    (["beach"], 120),
    (["church", "hindu_temple", "mosque", "synagogue", "buddhist_temple", "shinto_shrine", "place_of_worship"], 60),
    (["observation_deck", "lookout", "scenic_point"], 60),
  ]

  /* Checked after the specific venue table so a food market or a food hall keeps
   * its venue-scale stay, but before the generic tourist_attraction bucket that
   * Google attaches to any famous restaurant. lib/stay-estimates.ts:39-42 */
  private static let foodVenueTypes: Set<String> = [
    "restaurant", "cafe", "coffee_shop", "bakery", "dessert_shop", "tea_house",
    "bar", "izakaya", "food_court", "meal_takeaway", "meal_delivery",
  ]

  private static let genericLandmarkTypes: Set<String> = ["landmark", "historical_landmark", "monument", "tourist_attraction"]

  /// lib/stay-estimates.ts:46-48
  public static func isFoodPlaceTypes(_ types: [String] = []) -> Bool {
    types.contains { $0.hasSuffix("_restaurant") || foodVenueTypes.contains($0) }
  }

  /// lib/stay-estimates.ts:50-62
  public static func estimateStayMinutes(name: String, placeTypes: [String]? = nil, fallback: Int = 90) -> Int {
    let types = placeTypes ?? []
    for entry in namePatterns where entry.pattern.test(name) { return entry.minutes }
    let typeSet = Set(types)
    for entry in typeDurations where !entry.types.isDisjoint(with: typeSet) { return entry.minutes }
    // A meal is 45 minutes, not a museum visit.
    if isFoodPlaceTypes(types) { return 45 }
    if !genericLandmarkTypes.isDisjoint(with: typeSet) { return 75 }
    return fallback
  }

  /// A stop that effectively claims the day; scheduling gives it the morning and its own space.
  /// lib/stay-estimates.ts:65-67
  public static func isDayAnchorStay(_ minutes: Int) -> Bool {
    minutes >= EngineConstants.dayAnchorStayMinutes
  }
}
