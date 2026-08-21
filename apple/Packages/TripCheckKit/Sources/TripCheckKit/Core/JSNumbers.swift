/// JS の `Number.MAX_SAFE_INTEGER`(2^53 - 1)。TS 側が「無限大の代わりに使う一番大きい安全な
/// 整数」として比較のセンチネルに使う値。数値リテラルとして各ファイルに散らさない。
public let jsMaxSafeInteger = 9_007_199_254_740_991
