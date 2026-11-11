/*
 * Realistic stay durations. A theme park is a day, not a coffee stop; a shrine
 * is an hour, not an afternoon. Name patterns catch the famous cases in any
 * language; Google place types cover everything else; the caller's fallback
 * stands when neither says anything.
 */

const namePatterns: Array<[RegExp, number]> = [
  [/ディズニー(?:ランド|シー|リゾート)?|disney/iu, 540],
  [/ユニバーサル[・･]?スタジオ|universal\s*studios|(?:^|[^A-Za-z])USJ(?:$|[^A-Za-z])/iu, 510],
  [/富士急ハイランド|ハウステンボス|ナガシマスパーランド|志摩スペイン村|グリーンランド|ルスツリゾート/u, 420],
  [/レゴランド|legoland|サンリオピューロランド|よみうりランド|ひらかたパーク|東武動物公園/iu, 360],
  [/チームラボ|teamlab/iu, 150],
  [/温泉(?:街|郷)|湯布院|由布院|草津温泉|城崎温泉|銀山温泉|下呂温泉|箱根湯本/u, 180],
];

const typeDurations: Array<[types: string[], minutes: number]> = [
  [["amusement_park", "theme_park"], 420],
  [["water_park"], 300],
  [["zoo", "wildlife_park", "safari_park"], 180],
  [["aquarium"], 150],
  [["museum", "art_gallery", "planetarium", "science_museum"], 120],
  [["spa", "public_bath", "onsen"], 120],
  [["national_park", "state_park", "botanical_garden"], 150],
  [["stadium", "arena", "concert_hall", "performing_arts_theater"], 150],
  [["shopping_mall", "department_store"], 90],
  [["castle", "fort"], 90],
  [["market", "food_market", "flea_market"], 75],
  [["park", "garden", "japanese_garden"], 75],
  [["hiking_area", "ski_resort"], 240],
  [["beach"], 120],
  [["church", "hindu_temple", "mosque", "synagogue", "buddhist_temple", "shinto_shrine", "place_of_worship"], 60],
  [["observation_deck", "lookout", "scenic_point"], 60],
  [["street", "square", "bridge", "pier", "statue", "promenade"], 45],
];

/*
 * What the name itself says when no source supplied a type. A keyless lookup
 * returns an encyclopedia pin with no category at all, and a flat 90 minutes
 * for a ferry pier, a street and a small temple alike makes every day look
 * fuller than it is. Checked after the type table, so a typed venue keeps its
 * own duration.
 */
const genericNamePatterns: Array<[RegExp, number]> = [
  [/動物園|\bzoo\b/iu, 180],
  [/水族館|\baquarium\b/iu, 150],
  [/美術館|博物館|記念館|\bmuseum\b|\bgallery\b/iu, 120],
  [/城(?:跡|址)?$|宮殿|御所|\bcastle\b|\bpalace\b/iu, 90],
  [/市場|マーケット|商店街|横丁|夜市|\bmarket\b/iu, 75],
  [/公園|御苑|庭園|\bpark\b|\bgardens?\b/iu, 75],
  [/寺$|寺院|神社|大社|神宮|廟|祠$|教会|大聖堂|\btemple\b|\bshrine\b|\bchurch\b|\bcathedral\b|\bbasilica\b/iu, 60],
  [/タワー|展望台|\btower\b|\bobservatory\b|\bobservation deck\b/iu, 60],
  [/フェリー|桟橋|埠頭|プロムナード|遊歩道|通り$|交差点|橋$|像$|\bferry\b|\bpier\b|\bpromenade\b|\bstreet\b|\bcrossing\b|\bbridge\b|\bstatue\b/iu, 45],
];

/* Checked after the specific venue table so a food market or a food hall keeps
 * its venue-scale stay, but before the generic tourist_attraction bucket that
 * Google attaches to any famous restaurant. */
const foodVenueTypes = new Set([
  "restaurant", "cafe", "coffee_shop", "bakery", "dessert_shop", "tea_house",
  "bar", "izakaya", "food_court", "meal_takeaway", "meal_delivery",
]);

const genericLandmarkTypes = ["landmark", "historical_landmark", "monument", "tourist_attraction"];

export function isFoodPlaceTypes(types: string[] = []) {
  return types.some((type) => type.endsWith("_restaurant") || foodVenueTypes.has(type));
}

export function estimateStayMinutes(name: string, types: string[] = [], fallback = 90) {
  for (const [pattern, minutes] of namePatterns) {
    if (pattern.test(name)) return minutes;
  }
  const typeSet = new Set(types);
  for (const [candidates, minutes] of typeDurations) {
    if (candidates.some((type) => typeSet.has(type))) return minutes;
  }
  // A meal is 45 minutes, not a museum visit.
  if (isFoodPlaceTypes(types)) return 45;
  if (genericLandmarkTypes.some((type) => typeSet.has(type))) return 75;
  for (const [pattern, minutes] of genericNamePatterns) {
    if (pattern.test(name)) return minutes;
  }
  return fallback;
}

/** A stop that effectively claims the day; scheduling gives it the morning and its own space. */
export function isDayAnchorStay(minutes: number) {
  return minutes >= 300;
}
