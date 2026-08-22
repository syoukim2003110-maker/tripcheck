import Foundation

/// JS の `Number.MAX_SAFE_INTEGER`(2^53 - 1)。TS 側が「無限大の代わりに使う一番大きい安全な
/// 整数」として比較のセンチネルに使う値。数値リテラルとして各ファイルに散らさない。
public let jsMaxSafeInteger = 9_007_199_254_740_991

/// JS `Number.prototype.toFixed(digits)` —— 桁を落とした数の文字列。表示の桁(`Presentation/`)
/// と手入力の停留所 id(`Edits/`・`Share/`)が同じ丸めを使う。
///
/// ECMA-262 は「n/10^f − x が 0 に最も近い整数 n。2 つあるなら **大きいほう**」と言う。
/// 大事なのは x が **二進の値そのもの** だということ:
///
///   - `1450/1000` は二進では 1.45 に届かない(1.4499999999999999556)ので `"1.4"`。
///     10 倍してから丸めると、積のほうが丸められて 14.5 ちょうどになり `"1.5"` に化ける。
///   - `4.25` は二進でちょうど表せるので同点。JS は大きいほうを採って `"4.3"`、
///     `%.1f`(偶数側に丸める)は `"4.2"` にしてしまう。
///
/// そこで、同点でないときは `printf`(二進値そのものから正しく丸める)に任せ、同点だけ
/// 切り上げる。x が f 桁で同点になるのは `x = k / 2^(f+1)`(k は奇数)のときに限られる
/// ——「`x * 2^(f+1)` が奇数の整数」で判定でき、2 の冪倍なので誤差が入らない。
public func jsToFixed(_ value: Double, _ digits: Int) -> String {
  guard value.isFinite else { return value.isNaN ? "NaN" : (value > 0 ? "Infinity" : "-Infinity") }
  let negative = value < 0
  let magnitude = abs(value)
  let plain = String(format: "%.\(max(0, digits))f", magnitude)
  guard digits >= 0, magnitude < 1e15 else { return negative ? "-\(plain)" : plain }

  let halves = magnitude * pow(2, Double(digits + 1))
  guard halves == halves.rounded(), halves.truncatingRemainder(dividingBy: 2) == 1 else {
    return negative ? "-\(plain)" : plain
  }
  let scaled = Int((magnitude * pow(10, Double(digits))).rounded(.up))
  if digits == 0 { return negative ? "-\(scaled)" : "\(scaled)" }
  let unit = Int(pow(10, Double(digits)))
  let fraction = String(format: "%0\(digits)d", scaled % unit)
  let text = "\(scaled / unit).\(fraction)"
  return negative ? "-\(text)" : text
}
