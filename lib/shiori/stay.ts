/*
 * How long a visit to a well-known sight usually takes, for the first draft
 * of a booklet. Deliberately on the short side: a traveller lengthens the
 * stops they care about, and a day planned at guidebook maximums holds two
 * places and looks empty.
 */
const rules: Array<[RegExp, number]> = [
  [/amusement|theme park/, 420],
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

const names: Array<[RegExp, number]> = [
  [/ディズニー|disney|ユニバーサル|universal studios|USJ|レゴランド|legoland/i, 480],
  [/オーシャンパーク|海洋公園|ロッテワールド|エバーランド/i, 360],
];

export function shioriStayMinutes(kind: string | undefined, name: string) {
  for (const [pattern, minutes] of names) if (pattern.test(name)) return minutes;
  const lowered = (kind ?? "").toLowerCase();
  for (const [pattern, minutes] of rules) if (pattern.test(lowered)) return minutes;
  return 75;
}
