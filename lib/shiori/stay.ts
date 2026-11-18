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
  [/オーシャンパーク|海洋公園|ロッテワールド|lotte world|エバーランド|everland|江戸村|edo wonderland|ピューロランド|puroland|よみうりランド|ひらかたパーク/i, 360],
  [/チボリ公園|tivoli gardens|グローナルンド|gröna lund|ベニーランド|benyland|dam sen|ダムセン|ワイルド・ワディ|wild wadi|wild wild wet/i, 240],
];

export function shioriStayMinutes(kind: string | undefined, name: string) {
  for (const [pattern, minutes] of names) if (pattern.test(name)) return minutes;
  const lowered = (kind ?? "").toLowerCase();
  for (const [pattern, minutes] of rules) if (pattern.test(lowered)) return minutes;
  return 75;
}
