/*
 * The colour a train line is painted in on its own signs, for the bar on a
 * ride's ticket. Decoration only: the line's name is always written beside it.
 *
 * A colour is never guessed. Only the exact names the bundled Tokyo network
 * emits are listed, because the short names repeat across cities — Sapporo,
 * Sendai, Kobe and Kyoto each have their own 東西線 / 南北線 in other colours,
 * and their English names ("Tōzai Line", "Namboku Line") are identical to
 * Tokyo's. Those two English names are therefore left out. Anything not
 * listed returns null and is drawn in the neutral bar.
 */
const LINE_COLORS: Readonly<Record<string, string>> = {
  "東京メトロ銀座線": "#f39700",
  "東京メトロ丸ノ内線": "#e60012",
  "東京メトロ日比谷線": "#b5b5ac",
  "東京メトロ東西線": "#009bbf",
  "東京メトロ千代田線": "#00bb85",
  "東京メトロ有楽町線": "#c1a470",
  "東京メトロ半蔵門線": "#8f76d6",
  "東京メトロ南北線": "#00ac9b",
  "東京メトロ副都心線": "#9c5e31",
  "都営地下鉄浅草線": "#e85298",
  "都営地下鉄三田線": "#0079c2",
  "都営地下鉄新宿線": "#6cbb5a",
  "都営地下鉄大江戸線": "#b6007a",
  "山手線": "#9acd32",
  "Ginza Line": "#f39700",
  "Marunouchi Line": "#e60012",
  "Hibiya Line": "#b5b5ac",
  "Chiyoda Line": "#00bb85",
  "Yūrakuchō Line": "#c1a470",
  "Hanzōmon Line": "#8f76d6",
  "Fukutoshin Line": "#9c5e31",
  "Asakusa Line": "#e85298",
  "Mita Line": "#0079c2",
  "Shinjuku Line": "#6cbb5a",
  "Toei Ōedo Line": "#b6007a",
  "Yamanote Line": "#9acd32",
};

export function lineColor(name: string | null): string | null {
  if (!name) return null;
  return LINE_COLORS[name.trim()] ?? null;
}
