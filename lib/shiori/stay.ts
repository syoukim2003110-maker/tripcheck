/*
 * How long a visit to a well-known sight usually takes, for the first draft
 * of a booklet. Deliberately on the short side: a traveller lengthens the
 * stops they care about, and a day planned at guidebook maximums holds two
 * places and looks empty.
 */
const rules: Array<[RegExp, number]> = [
  /* A building of food stalls is a meal, whatever the catalogue calls it. */
  [/food theme park/, 75],
  /* The catalogue says "amusement park" or "theme park" of a food hall, a
   * fairground beside a harbour, a children's museum and a craft village as
   * readily as of Disneyland. The category alone therefore means a visit of a
   * couple of hours; a park that takes most of a day is named below. */
  [/amusement|theme park/, 150],
  [/\bzoo\b|safari/, 150],
  [/aquarium/, 120],
  [/museum|gallery/, 90],
  [/castle|palace|fortress|citadel/, 75],
  [/market|bazaar|shopping|department store/, 75],
  [/mountain|volcano|\bhill\b/, 120],
  [/island/, 180],
  [/beach/, 120],
  [/hot spring|onsen/, 120],
  [/national park|botanical/, 90],
  [/park|garden/, 60],
  [/temple|shrine|church|cathedral|basilica|mosque|chapel|pagoda|monastery/, 50],
  [/tower|observation|skyscraper|ferris/, 60],
  [/street|avenue|boulevard|neighbou?rhood|quarter|square|plaza|chinatown|old town/, 60],
  [/bridge|statue|sculpture|monument|memorial|fountain|gate|pier|promenade/, 30],
];

/*
 * Parks named one by one, because only the name tells an all-day park from a
 * small one. Three sizes: the resort a traveller gives the whole day, the park
 * that takes most of one, and the ride or water park of half a day.
 */
const names: Array<[RegExp, number]> = [
  [/ディズニー|disney|ユニバーサル|universal studios|USJ|レゴランド|legoland/i, 480],
  [/富士急ハイランド|fuji-q|ハウステンボス|huis ten bosch|ナガシマスパーランド|nagashima spa ?land|志摩スペイン村/i, 420],
  [/香港オーシャンパーク|香港海洋公園|ocean park hong kong|ロッテワールド|lotte world|エバーランド|everland|江戸村|edo wonderland|ピューロランド|puroland|よみうりランド|ひらかたパーク/i, 360],
  [/チボリ公園|tivoli gardens|グローナルンド|gröna lund|ベニーランド|benyland|dam sen|ダムセン|ワイルド・ワディ|wild wadi|wild wild wet/i, 240],
];

/*
 * A place that carries a park's name without being the park: the tower, the
 * shop, the hotel, the station or the hall named after it. (釜山ロッテタウン
 * タワー is "Busan Lotte World Tower" in English, and a skyscraper was planned
 * as six hours that fill the day.) Such a place is judged by its kind.
 */
const NOT_THE_PARK_NAME = /タワー|tower|ストア|store|ショップ|shop|ホテル|hotel|駅|station|モール|mall|ホール|\bhall\b|シティウォーク|citywalk/i;
const NOT_THE_PARK_KIND = /skyscraper|\btower\b|hotel|station|\bstore\b|\bshop\b|shopping|\bmall\b|concert|theat/;

export function shioriStayMinutes(kind: string | undefined, name: string) {
  const lowered = (kind ?? "").toLowerCase();
  if (!NOT_THE_PARK_NAME.test(name) && !NOT_THE_PARK_KIND.test(lowered)) {
    for (const [pattern, minutes] of names) if (pattern.test(name)) return minutes;
  }
  for (const [pattern, minutes] of rules) if (pattern.test(lowered)) return minutes;
  return 75;
}
