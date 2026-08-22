import Foundation

/*
 * `Math.cos`, `Math.sin` and `Math.asin` exactly as V8 computes them.
 *
 * Ported from V8 `src/base/ieee754.cc` at tag **12.4.254.21** — the revision Node 22.18.0 embeds
 * (`process.versions.v8` = `12.4.254.21-node.27`), which is what `scripts/export-golden-snapshots.mjs`
 * runs. V8 ships its own fdlibm-derived implementations rather than calling the platform libm
 * (`V8_USE_LIBM_TRIG_FUNCTIONS` is not defined for this build), and V8's copy has drifted from Sun's
 * fdlibm 5.3, so this is a port of V8's file specifically, not of fdlibm.
 *
 * ## Why the engine cannot just call Foundation
 *
 * Apple's libm rounds these three functions more accurately than V8's fdlibm, and the two disagree
 * by one ulp often enough to change itineraries:
 *
 * | function | sampled | differing | rate |
 * | --- | --- | --- | --- |
 * | `cos` of `latitude × π ÷ 180` | 45,002 latitudes | 3,089 | 6.86 % |
 * | `sin` of `latitude × π ÷ 180` | 45,002 latitudes | 4,489 | 9.97 % |
 * | `sin` over 0–0.035 rad (the haversine half-delta) | 100,001 | 7 | 0.007 % |
 * | `asin` over the whole `[0, 1]` domain | 200,001 | 17,319 | 8.66 % |
 * | `asin` of `√h` for 0.9–400 km separations | 200,001 | 4,217 | 2.11 % |
 *
 * One ulp is enough because the route optimiser (`RouteOrdering.optimize`, `optimizeFromBase`)
 * compares a path against its own reverse. The reverse visits exactly the same edges, so the two
 * distances are the same real number and the strict `<` is decided purely by how the last bit of
 * each edge lands. A single ulp flips the direction of a whole day — its stops, legs, arrival and
 * departure clocks, map URLs, theme and evidence order all follow.
 *
 * `Tests/…/Units/JSMathTests.swift` pins every function against `Fixtures/js-math-vectors.v1.json`,
 * a table of (input bit pattern → output bit pattern) produced by Node itself.
 *
 * ## Reading the port
 *
 * fdlibm addresses a `Double` as two 32-bit words. Swift has no `union`, so the C macros become the
 * `highWord` / `lowWord` / `withHighWord` / `withLowWord` / `insertWords` helpers below. All integer
 * arithmetic on those words uses the wrapping operators (`&+`, `&-`, `&<<`), because C's `int32_t`
 * wraps where Swift's `Int32` traps. `sqrt` is `Double.squareRoot()` (IEEE-exact, so no libm is
 * involved); `scalbn` and `floor` are exact power-of-two scaling and truncation.
 */
public enum JSMath {

  // MARK: - fdlibm's two-word view of a Double

  /// C `GET_HIGH_WORD(i, d)` into an `int32_t`.
  @inline(__always)
  static func highWord(_ x: Double) -> Int32 {
    Int32(bitPattern: UInt32(truncatingIfNeeded: x.bitPattern >> 32))
  }

  /// C `GET_LOW_WORD(i, d)` into a `uint32_t`.
  @inline(__always)
  static func lowWord(_ x: Double) -> UInt32 {
    UInt32(truncatingIfNeeded: x.bitPattern)
  }

  /// C `SET_HIGH_WORD(d, v)`, returned rather than mutated in place.
  @inline(__always)
  static func withHighWord(_ x: Double, _ value: Int32) -> Double {
    Double(bitPattern: (x.bitPattern & 0x0000_0000_FFFF_FFFF) | (UInt64(UInt32(bitPattern: value)) << 32))
  }

  /// C `SET_LOW_WORD(d, v)`, returned rather than mutated in place.
  @inline(__always)
  static func withLowWord(_ x: Double, _ value: UInt32) -> Double {
    Double(bitPattern: (x.bitPattern & 0xFFFF_FFFF_0000_0000) | UInt64(value))
  }

  /// C `INSERT_WORDS(d, ix0, ix1)`.
  @inline(__always)
  static func insertWords(_ high: Int32, _ low: UInt32) -> Double {
    Double(bitPattern: (UInt64(UInt32(bitPattern: high)) << 32) | UInt64(low))
  }

  /// C `static_cast<int32_t>(someDouble)` — truncation toward zero. Every call site has already
  /// bounded the value, so the conversion cannot overflow.
  @inline(__always)
  private static func int32(_ x: Double) -> Int32 {
    Int32(x.rounded(.towardZero))
  }

  // MARK: - __kernel_cos (ieee754.cc:305-337)

  /// V8 `__kernel_cos(x, y)` — cosine on `[-π/4, π/4]`, `y` being the tail of `x`.
  static func kernelCos(_ x: Double, _ y: Double) -> Double {
    let one = 1.00000000000000000000e+00
    let C1 = 4.16666666666666019037e-02
    let C2 = -1.38888888888741095749e-03
    let C3 = 2.48015872894767294178e-05
    let C4 = -2.75573143513906633035e-07
    let C5 = 2.08757232129817482790e-09
    let C6 = -1.13596475577881948265e-11

    let ix = highWord(x) & 0x7FFF_FFFF
    if ix < 0x3E40_0000 {  /* if x < 2**-27 */
      if int32(x) == 0 { return one }
    }
    let z = x * x
    let r = z * fma(z, fma(z, fma(z, fma(z, fma(z, C6, C5), C4), C3), C2), C1)
    if ix < 0x3FD3_3333 {  /* if |x| < 0.3 */
      return one - fma(0.5, z, -fma(z, r, -(x * y)))
    }
    let qx: Double = ix > 0x3FE9_0000
      ? 0.28125                             /* x > 0.78125 */
      : insertWords(ix &- 0x0020_0000, 0)   /* x/4 */
    let iz = fma(0.5, z, -qx)
    let a = one - qx
    return a - (iz - fma(z, r, -(x * y)))
  }

  // MARK: - __kernel_sin (ieee754.cc:673-698)

  /// V8 `__kernel_sin(x, y, iy)` — sine on `[-π/4, π/4]`. `iy == 0` means the tail `y` is zero.
  static func kernelSin(_ x: Double, _ y: Double, _ iy: Int32) -> Double {
    let half = 5.00000000000000000000e-01
    let S1 = -1.66666666666666324348e-01
    let S2 = 8.33333333332248946124e-03
    let S3 = -1.98412698298579493134e-04
    let S4 = 2.75573137070700676789e-06
    let S5 = -2.50507602534068634195e-08
    let S6 = 1.58969099521155010221e-10

    let ix = highWord(x) & 0x7FFF_FFFF
    if ix < 0x3E40_0000 {  /* |x| < 2**-27 */
      if int32(x) == 0 { return x }
    }
    let z = x * x
    let v = z * x
    let r = fma(z, fma(z, fma(z, fma(z, S6, S5), S4), S3), S2)
    if iy == 0 {
      return fma(v, fma(z, r, S1), x)
    }
    return x - fma(-v, S1, fma(z, fma(half, y, -(v * r)), -y))
  }

  // MARK: - __ieee754_rem_pio2 (ieee754.cc:118-270)

  /// 396 hex digits of 2/π, V8 `two_over_pi`.
  private static let twoOverPi: [Int32] = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
    0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
    0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
    0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
    0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
    0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
    0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
    0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
    0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
    0x73A8C9, 0x60E27B, 0xC08C6B,
  ]

  /// V8 `npio2_hw` — the high words of `n × π/2`, used to spot cancellation.
  private static let npio2hw: [Int32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
    0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
    0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
    0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
    0x404858EB, 0x404921FB,
  ]

  /// V8 `__ieee754_rem_pio2(x, y)` — `x` reduced modulo π/2 into `y[0] + y[1]`, returning the
  /// quadrant count. Swift returns the pair rather than writing through a pointer.
  static func remPio2(_ x: Double) -> (n: Int32, y0: Double, y1: Double) {
    let zero = 0.00000000000000000000e+00
    let half = 5.00000000000000000000e-01
    let two24 = 1.67772160000000000000e+07
    let invpio2 = 6.36619772367581382433e-01
    let pio2_1 = 1.57079632673412561417e+00
    let pio2_1t = 6.07710050650619224932e-11
    let pio2_2 = 6.07710050630396597660e-11
    let pio2_2t = 2.02226624879595063154e-21
    let pio2_3 = 2.02226624871116645580e-21
    let pio2_3t = 8.47842766036889956997e-32

    let hx = highWord(x)
    let ix = hx & 0x7FFF_FFFF

    if ix <= 0x3FE9_21FB {  /* |x| ~<= π/4, no reduction needed */
      return (0, x, 0)
    }

    if ix < 0x4002_D97C {  /* |x| < 3π/4, the n = ±1 special case */
      var z: Double
      var y0: Double
      var y1: Double
      if hx > 0 {
        z = x - pio2_1
        if ix != 0x3FF9_21FB {  /* 33+53 bit π is good enough */
          y0 = z - pio2_1t
          y1 = (z - y0) - pio2_1t
        } else {                /* near π/2, use 33+33+53 bit π */
          z -= pio2_2
          y0 = z - pio2_2t
          y1 = (z - y0) - pio2_2t
        }
        return (1, y0, y1)
      }
      z = x + pio2_1
      if ix != 0x3FF9_21FB {
        y0 = z + pio2_1t
        y1 = (z - y0) + pio2_1t
      } else {
        z += pio2_2
        y0 = z + pio2_2t
        y1 = (z - y0) + pio2_2t
      }
      return (-1, y0, y1)
    }

    if ix <= 0x4139_21FB {  /* |x| ~<= 2^19 × (π/2), medium size */
      var t = abs(x)
      let n = int32(fma(t, invpio2, half))
      let fn = Double(n)
      var r = fma(-fn, pio2_1, t)
      var w = fn * pio2_1t  /* 1st round, good to 85 bits */
      var y0: Double
      let j = ix >> 20
      if n < 32 && ix != npio2hw[Int(n) - 1] {
        y0 = r - w  /* quick check: no cancellation */
      } else {
        y0 = r - w
        var i = j &- ((highWord(y0) >> 20) & 0x7FF)
        if i > 16 {  /* 2nd iteration needed, good to 118 bits */
          t = r
          w = fn * pio2_2
          r = t - w
          w = fma(fn, pio2_2t, -((t - r) - w))
          y0 = r - w
          i = j &- ((highWord(y0) >> 20) & 0x7FF)
          if i > 49 {  /* 3rd iteration needed, 151 bits of accuracy */
            t = r
            w = fn * pio2_3
            r = t - w
            w = fma(fn, pio2_3t, -((t - r) - w))
            y0 = r - w
          }
        }
      }
      let y1 = (r - y0) - w
      return hx < 0 ? (-n, -y0, -y1) : (n, y0, y1)
    }

    if ix >= 0x7FF0_0000 {  /* x is Inf or NaN */
      let nan = x - x
      return (0, nan, nan)
    }

    /* All other (large) arguments: set z = scalbn(|x|, ilogb(x) - 23). */
    var z = withLowWord(0, lowWord(x))
    let e0 = (ix >> 20) &- 1046  /* e0 = ilogb(z) - 23 */
    z = withHighWord(z, ix &- Int32(bitPattern: UInt32(bitPattern: e0) << 20))
    var tx = [Double](repeating: 0, count: 3)
    for i in 0..<2 {
      tx[i] = Double(int32(z))
      z = (z - tx[i]) * two24
    }
    tx[2] = z
    var nx = 3
    while tx[nx - 1] == zero { nx -= 1 }  /* skip zero terms */
    let reduced = kernelRemPio2(tx, e0: e0, nx: Int32(nx))
    return hx < 0
      ? (-reduced.n, -reduced.y0, -reduced.y1)
      : (reduced.n, reduced.y0, reduced.y1)
  }

  // MARK: - __kernel_rem_pio2 (ieee754.cc:443-645)

  /// V8 `__kernel_rem_pio2(x, y, e0, nx, prec, ipio2)` with `prec == 2` and `ipio2 == two_over_pi`,
  /// the only combination `__ieee754_rem_pio2` ever asks for. Reached only by arguments larger than
  /// 2^19 × (π/2) ≈ 823,550 — no coordinate in this engine gets there, but leaving the branch
  /// unimplemented would silently return the wrong answer to anyone who did.
  private static func kernelRemPio2(_ x: [Double], e0: Int32, nx: Int32) -> (n: Int32, y0: Double, y1: Double) {
    let initJk: [Int32] = [2, 3, 4, 6]
    let PIo2: [Double] = [
      1.57079625129699707031e+00,
      7.54978941586159635335e-08,
      5.39030252995776476554e-15,
      3.28200341580791294123e-22,
      1.27065575308067607349e-29,
      1.22933308981111328932e-36,
      2.73370053816464559624e-44,
      2.16741683877804819444e-51,
    ]
    let zero = 0.0
    let one = 1.0
    let two24 = 1.67772160000000000000e+07
    let twon24 = 5.96046447753906250000e-08
    let prec: Int32 = 2

    var iq = [Int32](repeating: 0, count: 20)
    var f = [Double](repeating: 0, count: 20)
    var fq = [Double](repeating: 0, count: 20)
    var q = [Double](repeating: 0, count: 20)

    let jk = initJk[Int(prec)]
    let jp = jk

    /* determine jx, jv, q0; note that 3 > q0 */
    let jx = nx - 1
    var jv = (e0 - 3) / 24
    if jv < 0 { jv = 0 }
    var q0 = e0 - 24 * (jv + 1)

    /* set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk] */
    var j = jv - jx
    let m = jx + jk
    var i: Int32 = 0
    while i <= m {
      f[Int(i)] = j < 0 ? zero : Double(twoOverPi[Int(j)])
      i += 1
      j += 1
    }

    /* compute q[0] … q[jk] */
    i = 0
    while i <= jk {
      var fw = 0.0
      var k: Int32 = 0
      while k <= jx {
        fw = fma(x[Int(k)], f[Int(jx + i - k)], fw)
        k += 1
      }
      q[Int(i)] = fw
      i += 1
    }

    var jz = jk
    var z = 0.0
    var ih: Int32 = 0
    var n: Int32 = 0

    recompute: while true {
      /* distill q[] into iq[] reversingly */
      var fw = 0.0
      i = 0
      j = jz
      z = q[Int(jz)]
      while j > 0 {
        fw = Double(int32(twon24 * z))
        iq[Int(i)] = int32(fma(-two24, fw, z))
        z = q[Int(j - 1)] + fw
        i += 1
        j -= 1
      }

      /* compute n */
      z = scalbn(z, Int(q0))         /* actual value of z */
      z = fma(-8.0, (z * 0.125).rounded(.down), z)  /* trim off integer >= 8 */
      n = int32(z)
      z -= Double(n)
      ih = 0
      if q0 > 0 {  /* need iq[jz-1] to determine n */
        let carryIn = iq[Int(jz - 1)] >> (24 - q0)
        n += carryIn
        iq[Int(jz - 1)] -= carryIn << (24 - q0)
        ih = iq[Int(jz - 1)] >> (23 - q0)
      } else if q0 == 0 {
        ih = iq[Int(jz - 1)] >> 23
      } else if z >= 0.5 {
        ih = 2
      }

      if ih > 0 {  /* q > 0.5 */
        n += 1
        var carry: Int32 = 0
        i = 0
        while i < jz {  /* compute 1 - q */
          let value = iq[Int(i)]
          if carry == 0 {
            if value != 0 {
              carry = 1
              iq[Int(i)] = 0x100_0000 - value
            }
          } else {
            iq[Int(i)] = 0xFF_FFFF - value
          }
          i += 1
        }
        if q0 > 0 {  /* rare case: chance is 1 in 12 */
          switch q0 {
          case 1: iq[Int(jz - 1)] &= 0x7F_FFFF
          case 2: iq[Int(jz - 1)] &= 0x3F_FFFF
          default: break
          }
        }
        if ih == 2 {
          z = one - z
          if carry != 0 { z -= scalbn(one, Int(q0)) }
        }
      }

      /* check if recomputation is needed */
      if z == zero {
        var bits: Int32 = 0
        i = jz - 1
        while i >= jk {
          bits |= iq[Int(i)]
          i -= 1
        }
        if bits == 0 {  /* need recomputation */
          // C reads `for (k = 1; iq[jk - k] == 0; k++)` with no lower bound, so an all-zero
          // `iq` walks off the front of the array; `jk >= k` stops it here. The two only part
          // company where C is already undefined, never on a value it defines.
          var k: Int32 = 1
          while jk >= k && iq[Int(jk - k)] == 0 { k += 1 }  /* k = number of terms needed */

          i = jz + 1
          while i <= jz + k {  /* add q[jz+1] … q[jz+k] */
            f[Int(jx + i)] = Double(twoOverPi[Int(jv + i)])
            var fw2 = 0.0
            var t: Int32 = 0
            while t <= jx {
              fw2 = fma(x[Int(t)], f[Int(jx + i - t)], fw2)
              t += 1
            }
            q[Int(i)] = fw2
            i += 1
          }
          jz += k
          continue recompute
        }
      }
      break
    }

    /* chop off zero terms */
    if z == 0.0 {
      jz -= 1
      q0 -= 24
      while iq[Int(jz)] == 0 {
        jz -= 1
        q0 -= 24
      }
    } else {  /* break z into 24-bit chunks if necessary */
      z = scalbn(z, Int(-q0))
      if z >= two24 {
        let fw = Double(int32(twon24 * z))
        iq[Int(jz)] = int32(fma(-two24, fw, z))
        jz += 1
        q0 += 24
        iq[Int(jz)] = int32(fw)
      } else {
        iq[Int(jz)] = int32(z)
      }
    }

    /* convert the integer "bit" chunks to floating point */
    var fw = scalbn(one, Int(q0))
    i = jz
    while i >= 0 {
      q[Int(i)] = fw * Double(iq[Int(i)])
      fw *= twon24
      i -= 1
    }

    /* compute PIo2[0…jp] × q[jz…0] */
    i = jz
    while i >= 0 {
      var sum = 0.0
      var k: Int32 = 0
      while k <= jp && k <= jz - i {
        sum = fma(PIo2[Int(k)], q[Int(i + k)], sum)
        k += 1
      }
      fq[Int(jz - i)] = sum
      i -= 1
    }

    /* compress fq[] into y[] (prec == 2) */
    var sum = 0.0
    i = jz
    while i >= 0 {
      sum += fq[Int(i)]
      i -= 1
    }
    let y0 = ih == 0 ? sum : -sum
    var tail = fq[0] - sum
    i = 1
    while i <= jz {
      tail += fq[Int(i)]
      i += 1
    }
    let y1 = ih == 0 ? tail : -tail
    return (n & 7, y0, y1)
  }

  // MARK: - cos (ieee754.cc:1354-1383)

  /// V8 `Math.cos`.
  public static func cos(_ x: Double) -> Double {
    let ix = highWord(x) & 0x7FFF_FFFF
    if ix <= 0x3FE9_21FB {  /* |x| ~< π/4 */
      return kernelCos(x, 0.0)
    }
    if ix >= 0x7FF0_0000 {  /* cos(Inf or NaN) is NaN */
      return x - x
    }
    let reduced = remPio2(x)
    switch reduced.n & 3 {
    case 0: return kernelCos(reduced.y0, reduced.y1)
    case 1: return -kernelSin(reduced.y0, reduced.y1, 1)
    case 2: return -kernelCos(reduced.y0, reduced.y1)
    default: return kernelSin(reduced.y0, reduced.y1, 1)
    }
  }

  // MARK: - sin (ieee754.cc:2450-2479)

  /// V8 `Math.sin`.
  public static func sin(_ x: Double) -> Double {
    let ix = highWord(x) & 0x7FFF_FFFF
    if ix <= 0x3FE9_21FB {  /* |x| ~< π/4 */
      return kernelSin(x, 0.0, 0)
    }
    if ix >= 0x7FF0_0000 {  /* sin(Inf or NaN) is NaN */
      return x - x
    }
    let reduced = remPio2(x)
    switch reduced.n & 3 {
    case 0: return kernelSin(reduced.y0, reduced.y1, 1)
    case 1: return kernelCos(reduced.y0, reduced.y1)
    case 2: return -kernelSin(reduced.y0, reduced.y1, 1)
    default: return -kernelCos(reduced.y0, reduced.y1)
    }
  }

  // MARK: - asin (ieee754.cc:991-1064)

  /// V8 `Math.asin`. `|x| > 1` yields NaN, exactly as `Math.asin` does — the caller in
  /// `straightLineDistanceKm` relies on that: a haversine `h` above 1 must produce NaN rather than a
  /// clamped angle, because that is what the TypeScript engine produces and parity is the point.
  public static func asin(_ x: Double) -> Double {
    let one = 1.00000000000000000000e+00
    let huge = 1.000e+300
    let pio2_hi = 1.57079632679489655800e+00
    let pio2_lo = 6.12323399573676603587e-17
    let pio4_hi = 7.85398163397448278999e-01
    let pS0 = 1.66666666666666657415e-01
    let pS1 = -3.25565818622400915405e-01
    let pS2 = 2.01212532134862925881e-01
    let pS3 = -4.00555345006794114027e-02
    let pS4 = 7.91534994289814532176e-04
    let pS5 = 3.47933107596021167570e-05
    let qS1 = -2.40339491173441421878e+00
    let qS2 = 2.02094576023350569471e+00
    let qS3 = -6.88283971605453293030e-01
    let qS4 = 7.70381505559019352791e-02

    var t = 0.0
    let hx = highWord(x)
    let ix = hx & 0x7FFF_FFFF

    if ix >= 0x3FF0_0000 {  /* |x| >= 1 */
      let lx = lowWord(x)
      if (UInt32(bitPattern: ix &- 0x3FF0_0000) | lx) == 0 {  /* asin(±1) = ±π/2 */
        return fma(x, pio2_hi, x * pio2_lo)
      }
      return Double.nan  /* asin(|x| > 1) is NaN */
    }

    if ix < 0x3FE0_0000 {  /* |x| < 0.5 */
      if ix < 0x3E40_0000 {  /* |x| < 2**-27 */
        if huge + x > one { return x }
      } else {
        t = x * x
      }
      let p = t * fma(t, fma(t, fma(t, fma(t, fma(t, pS5, pS4), pS3), pS2), pS1), pS0)
      let q = fma(t, fma(t, fma(t, fma(t, qS4, qS3), qS2), qS1), one)
      let w = p / q
      return fma(x, w, x)
    }

    /* 1 > |x| >= 0.5 */
    var w = one - abs(x)
    t = w * 0.5
    var p = t * fma(t, fma(t, fma(t, fma(t, fma(t, pS5, pS4), pS3), pS2), pS1), pS0)
    var q = fma(t, fma(t, fma(t, fma(t, qS4, qS3), qS2), qS1), one)
    let s = t.squareRoot()
    if ix >= 0x3FEF_3333 {  /* |x| > 0.975 */
      w = p / q
      t = pio2_hi - fma(2.0, fma(s, w, s), -pio2_lo)
    } else {
      w = withLowWord(s, 0)
      let c = fma(-w, w, t) / (s + w)
      let r = p / q
      p = fma(2.0 * s, r, -fma(-2.0, c, pio2_lo))
      q = fma(-2.0, w, pio4_hi)
      t = pio4_hi - (p - q)
    }
    return hx > 0 ? t : -t
  }
}
