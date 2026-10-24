// Deterministic sin, cos and atan2 for the robot world (N18 R3.1, D-R12, ADR 0001 §4.6).
//
// ECMAScript only asks Math.sin/cos/atan2 (and exp, log, pow, hypot…) to approximate the result, and the
// four runtimes we target really do return different bits (ADR 0001 §4.6, even Node 24 against Chromium
// 153). A world that must hash the same everywhere therefore never calls them: it uses these functions,
// a line-by-line port of fdlibm 5.3 (netlib.org/fdlibm: s_sin.c, s_cos.c, k_sin.c, k_cos.c,
// e_rem_pio2.c, k_rem_pio2.c, s_atan.c, e_atan2.c, s_scalbn.c). The port only uses + − × ÷, Math.abs,
// Math.floor and integer bit operations, which IEEE 754 and ECMAScript define exactly, so every engine
// gets the same bits. dmath.test.ts checks them against Java's StrictMath, which is specified to return
// fdlibm's results (golden table: scripts/dmath-golden.java).
//
// fdlibm's licence asks for its notice to be kept with the code:
//
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this software is freely granted, provided that
//   this notice is preserved.
//
// C's `(int)x` truncation of a value that fits in 32 bits is `x | 0`; the high and low 32-bit words of a
// double (fdlibm's __HI and __LO) are read and written through a shared buffer.

const words = new Float64Array(1);
const halves = new Int32Array(words.buffer);
words[0] = 1;
// The high word of 1.0 is 0x3ff00000; it sits at index 1 on little-endian machines.
const HI = halves[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

/** fdlibm's __HI: the sign, exponent and top 20 mantissa bits, as a signed 32-bit integer. */
function highWord(x: number): number {
  words[0] = x;
  return halves[HI]!;
}

/** fdlibm's __LO: the low 32 mantissa bits, as a signed 32-bit integer. */
function lowWord(x: number): number {
  words[0] = x;
  return halves[LO]!;
}

function fromWords(high: number, low: number): number {
  halves[HI] = high;
  halves[LO] = low;
  return words[0]!;
}

// ---------------------------------------------------------------------------------------------- s_scalbn.c

const two54 = 1.8014398509481984e16; // 0x43500000 00000000
const twom54 = 5.551115123125783e-17; // 0x3C900000 00000000
const huge = 1.0e300;
const tiny = 1.0e-300;

function copysign(x: number, y: number): number {
  return fromWords((highWord(x) & 0x7fffffff) | (highWord(y) & 0x80000000), lowWord(x));
}

/** x · 2ⁿ by exponent manipulation (never `2 ** n`, which ECMAScript lets engines approximate). */
function scalbn(x: number, n: number): number {
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {
    if ((lx | (hx & 0x7fffffff)) === 0) return x;
    x *= two54;
    hx = highWord(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return tiny * x;
  }
  if (k === 0x7ff) return x + x;
  k = k + n;
  if (k > 0x7fe) return huge * copysign(huge, x);
  if (k > 0) return fromWords((hx & 0x800fffff) | (k << 20), lowWord(x));
  if (k <= -54) {
    if (n > 50000) return huge * copysign(huge, x);
    return tiny * copysign(tiny, x);
  }
  k += 54;
  return fromWords((hx & 0x800fffff) | (k << 20), lowWord(x)) * twom54;
}

// ------------------------------------------------------------------------------------------- k_rem_pio2.c

const PIo2 = [
  1.570796251296997070e0, // 0x3FF921FB 40000000
  7.549789415861596353e-8, // 0x3E74442D 00000000
  5.390302529957765e-15, // 0x3CF84698 80000000
  3.282003415807912941e-22, // 0x3B78CC51 60000000
  1.270655753080676073e-29, // 0x39F01B83 80000000
  1.229333089811113289e-36, // 0x387A2520 40000000
  2.733700538164645596e-44, // 0x36E38222 80000000
  2.167416838778048194e-51, // 0x3569F31D 00000000
];

const two24 = 1.6777216e7; // 0x41700000 00000000
const twon24 = 5.9604644775390625e-8; // 0x3E700000 00000000

/** 396 hex digits of 2/π, 24 bits per entry. */
const twoOverPi = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7,
  0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c,
  0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11,
  0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7,
  0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e,
  0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
];

/** The reduced argument of the last remPio2 call: y0 + y1 = x − n·π/2 (fdlibm's y[0], y[1]). */
let y0 = 0;
let y1 = 0;

/**
 * Payne–Hanek reduction of a huge positive x, given as 24-bit pieces `x` with exponent `e0`; writes y0, y1
 * and returns n mod 8. fdlibm's `__kernel_rem_pio2(x, y, e0, nx, prec = 2, two_over_pi)`.
 */
function kernelRemPio2(x: Float64Array, e0: number, nx: number): number {
  const iq = new Int32Array(20);
  const f = new Float64Array(20);
  const fq = new Float64Array(20);
  const q = new Float64Array(20);
  const jk = 4; // init_jk[prec = 2]
  const jp = jk;

  const jx = nx - 1;
  let jv = ((e0 - 3) / 24) | 0;
  if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);

  let j = jv - jx;
  const m = jx + jk;
  for (let i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0 : twoOverPi[j]!;

  let fw: number;
  for (let i = 0; i <= jk; i++) {
    fw = 0;
    for (j = 0; j <= jx; j++) fw += x[j]! * f[jx + i - j]!;
    q[i] = fw;
  }

  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) {
    // Distill q[] into iq[] reversingly.
    let i = 0;
    j = jz;
    z = q[jz]!;
    for (; j > 0; i++, j--) {
      fw = (twon24 * z) | 0;
      iq[i] = (z - two24 * fw) | 0;
      z = q[j - 1]! + fw;
    }

    z = scalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1]! >> (24 - q0);
      n += i;
      iq[jz - 1] = iq[jz - 1]! - (i << (24 - q0));
      ih = iq[jz - 1]! >> (23 - q0);
    } else if (q0 === 0) {
      ih = iq[jz - 1]! >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }

    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (i = 0; i < jz; i++) {
        j = iq[i]!;
        if (carry === 0) {
          if (j !== 0) {
            carry = 1;
            iq[i] = 0x1000000 - j;
          }
        } else {
          iq[i] = 0xffffff - j;
        }
      }
      if (q0 > 0) {
        if (q0 === 1) iq[jz - 1] = iq[jz - 1]! & 0x7fffff;
        else if (q0 === 2) iq[jz - 1] = iq[jz - 1]! & 0x3fffff;
      }
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= scalbn(1, q0);
      }
    }

    // Recompute with more terms of 2/π when the fraction came out zero.
    if (z === 0) {
      j = 0;
      for (i = jz - 1; i >= jk; i--) j |= iq[i]!;
      if (j === 0) {
        let k = 1;
        while (iq[jk - k] === 0) k++;
        for (i = jz + 1; i <= jz + k; i++) {
          f[jx + i] = twoOverPi[jv + i]!;
          fw = 0;
          for (j = 0; j <= jx; j++) fw += x[j]! * f[jx + i - j]!;
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  // Chop off zero terms.
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z = scalbn(z, -q0);
    if (z >= two24) {
      fw = (twon24 * z) | 0;
      iq[jz] = (z - two24 * fw) | 0;
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else {
      iq[jz] = z | 0;
    }
  }

  // Convert the integer chunks to floating point.
  fw = scalbn(1, q0);
  for (let i = jz; i >= 0; i--) {
    q[i] = fw * iq[i]!;
    fw *= twon24;
  }

  // fq = PIo2[0..jp] · q[jz..0].
  for (let i = jz; i >= 0; i--) {
    fw = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k]! * q[i + k]!;
    fq[jz - i] = fw;
  }

  // Compress fq[] into y0, y1 (prec 2).
  fw = 0;
  for (let i = jz; i >= 0; i--) fw += fq[i]!;
  y0 = ih === 0 ? fw : -fw;
  fw = fq[0]! - fw;
  for (let i = 1; i <= jz; i++) fw += fq[i]!;
  y1 = ih === 0 ? fw : -fw;
  return n & 7;
}

// ------------------------------------------------------------------------------------------- e_rem_pio2.c

/** High words of n·π/2 for n = 1..32: a hit means the quick reduction may cancel. */
const npio2Hw = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a,
  0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a,
  0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac,
  0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];

const invpio2 = 6.36619772367581382433e-1; // 0x3FE45F30 6DC9C883, 53 bits of 2/π
const pio2_1 = 1.57079632673412561417e0; // 0x3FF921FB 54400000, first 33 bits of π/2
const pio2_1t = 6.07710050650619224932e-11; // 0x3DD0B461 1A626331, π/2 − pio2_1
const pio2_2 = 6.07710050630396597660e-11; // 0x3DD0B461 1A600000, second 33 bits of π/2
const pio2_2t = 2.02226624879595063154e-21; // 0x3BA3198A 2E037073, π/2 − (pio2_1 + pio2_2)
const pio2_3 = 2.02226624871116645580e-21; // 0x3BA3198A 2E000000, third 33 bits of π/2
const pio2_3t = 8.47842766036889956997e-32; // 0x397B839A 252049C1, π/2 − (pio2_1 + pio2_2 + pio2_3)

/** x rem π/2 into y0 + y1; returns n with x = n·π/2 + y0 + y1. fdlibm's `__ieee754_rem_pio2`. */
function remPio2(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  let z: number;
  if (ix <= 0x3fe921fb) {
    y0 = x;
    y1 = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3π/4: n = ±1.
    if (hx > 0) {
      z = x - pio2_1;
      if (ix !== 0x3ff921fb) {
        y0 = z - pio2_1t;
        y1 = z - y0 - pio2_1t;
      } else {
        z -= pio2_2;
        y0 = z - pio2_2t;
        y1 = z - y0 - pio2_2t;
      }
      return 1;
    }
    z = x + pio2_1;
    if (ix !== 0x3ff921fb) {
      y0 = z + pio2_1t;
      y1 = z - y0 + pio2_1t;
    } else {
      z += pio2_2;
      y0 = z + pio2_2t;
      y1 = z - y0 + pio2_2t;
    }
    return -1;
  }
  if (ix <= 0x413921fb) {
    // |x| ≤ 2^19·π/2: medium size.
    let t = Math.abs(x);
    const n = (t * invpio2 + 0.5) | 0;
    const fn = n;
    let r = t - fn * pio2_1;
    let w = fn * pio2_1t;
    if (n < 32 && ix !== npio2Hw[n - 1]) {
      y0 = r - w;
    } else {
      const j = ix >> 20;
      y0 = r - w;
      let i = j - ((highWord(y0) >> 20) & 0x7ff);
      if (i > 16) {
        t = r;
        w = fn * pio2_2;
        r = t - w;
        w = fn * pio2_2t - (t - r - w);
        y0 = r - w;
        i = j - ((highWord(y0) >> 20) & 0x7ff);
        if (i > 49) {
          t = r;
          w = fn * pio2_3;
          r = t - w;
          w = fn * pio2_3t - (t - r - w);
          y0 = r - w;
        }
      }
    }
    y1 = r - y0 - w;
    if (hx < 0) {
      y0 = -y0;
      y1 = -y1;
      return -n;
    }
    return n;
  }
  if (ix >= 0x7ff00000) {
    y0 = y1 = x - x;
    return 0;
  }
  // Huge |x|: break it into three 24-bit pieces and use the Payne–Hanek kernel.
  const e0 = (ix >> 20) - 1046;
  z = fromWords(ix - (e0 << 20), lowWord(x));
  const tx = new Float64Array(3);
  for (let i = 0; i < 2; i++) {
    tx[i] = z | 0;
    z = (z - tx[i]!) * two24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0) nx--;
  const n = kernelRemPio2(tx, e0, nx);
  if (hx < 0) {
    y0 = -y0;
    y1 = -y1;
    return -n;
  }
  return n;
}

// --------------------------------------------------------------------------------------- k_sin.c, k_cos.c

const S1 = -1.66666666666666324348e-1; // 0xBFC55555 55555549
const S2 = 8.33333333332248946124e-3; // 0x3F811111 1110F8A6
const S3 = -1.98412698298579493134e-4; // 0xBF2A01A0 19C161D5
const S4 = 2.75573137070700676789e-6; // 0x3EC71DE3 57B1FE7D
const S5 = -2.50507602534068634195e-8; // 0xBE5AE5E6 8A2B9CEB
const S6 = 1.58969099521155010221e-10; // 0x3DE5D93A 5ACFD57C

/** sin on [−π/4, π/4]; `y` is the tail of x, `iy` = 0 when it is zero. fdlibm's `__kernel_sin`. */
function kernelSin(x: number, y: number, iy: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x; // |x| < 2^-27 (C also raises "inexact" here)
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2; // 0x3FA55555 5555554C
const C2 = -1.38888888888741095749e-3; // 0xBF56C16C 16C15177
const C3 = 2.48015872894767294178e-5; // 0x3EFA01A0 19CB1590
const C4 = -2.75573143513906633035e-7; // 0xBE927E4F 809C52AD
const C5 = 2.08757232129817482790e-9; // 0x3E21EE9E BDB4B1C4
const C6 = -1.13596475577881948265e-11; // 0xBDA8FAE9 BE8838D4

/** cos on [−π/4, π/4]; `y` is the tail of x. fdlibm's `__kernel_cos`. */
function kernelCos(x: number, y: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1; // |x| < 2^-27
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)); // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0); // x > 0.78125 ? 0.28125 : x/4
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// ------------------------------------------------------------------------------------------ s_sin.c, s_cos.c

/** sin(x), bit-identical on every JS engine (fdlibm 5.3). */
export function sin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x; // Inf or NaN
  switch (remPio2(x) & 3) {
    case 0:
      return kernelSin(y0, y1, 1);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, 1);
    default:
      return -kernelCos(y0, y1);
  }
}

/** cos(x), bit-identical on every JS engine (fdlibm 5.3). */
export function cos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x; // Inf or NaN
  switch (remPio2(x) & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, 1);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, 1);
  }
}

// ------------------------------------------------------------------------------------------------ s_atan.c

const atanhi = [
  4.63647609000806093515e-1, // atan(0.5) hi 0x3FDDAC67 0561BB4F
  7.85398163397448278999e-1, // atan(1.0) hi 0x3FE921FB 54442D18
  9.82793723247329054082e-1, // atan(1.5) hi 0x3FEF730B D281F69B
  1.57079632679489655800e0, // atan(inf) hi 0x3FF921FB 54442D18
];

const atanlo = [
  2.26987774529616870924e-17, // atan(0.5) lo 0x3C7A2B7F 222F65E2
  3.06161699786838301793e-17, // atan(1.0) lo 0x3C81A626 33145C07
  1.39033110312309984516e-17, // atan(1.5) lo 0x3C700788 7AF0CBBD
  6.12323399573676603587e-17, // atan(inf) lo 0x3C91A626 33145C07
];

const aT = [
  3.33333333333329318027e-1, // 0x3FD55555 5555550D
  -1.99999999998764832476e-1, // 0xBFC99999 9998EBC4
  1.42857142725034663711e-1, // 0x3FC24924 920083FF
  -1.11111104054623557880e-1, // 0xBFBC71C6 FE231671
  9.09088713343650656196e-2, // 0x3FB745CD C54C206E
  -7.69187620504482999495e-2, // 0xBFB3B0F2 AF749A6D
  6.66107313738753120669e-2, // 0x3FB10D66 A0D03D51
  -5.83357013379057348645e-2, // 0xBFADDE2D 52DEFD9A
  4.97687799461593236017e-2, // 0x3FA97B4B 24760DEB
  -3.65315727442169155270e-2, // 0xBFA2B444 2C6A6C2F
  1.62858201153657823623e-2, // 0x3F90AD3A E322DA11
];

/** atan(x), fdlibm 5.3. Only atan2 uses it. */
function atan(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| ≥ 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lowWord(x) !== 0)) return x + x; // NaN
    return hx > 0 ? atanhi[3]! + atanlo[3]! : -atanhi[3]! - atanlo[3]!;
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e200000) return x; // |x| < 2^-29 (C also raises "inexact" here)
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        id = 0; // 7/16 ≤ |x| < 11/16
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1; // 11/16 ≤ |x| < 19/16
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2; // |x| < 2.4375
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3; // 2.4375 ≤ |x| < 2^66
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (aT[0]! + w * (aT[2]! + w * (aT[4]! + w * (aT[6]! + w * (aT[8]! + w * aT[10]!)))));
  const s2 = w * (aT[1]! + w * (aT[3]! + w * (aT[5]! + w * (aT[7]! + w * aT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const result = atanhi[id]! - (x * (s1 + s2) - atanlo[id]! - x);
  return hx < 0 ? -result : result;
}

// ----------------------------------------------------------------------------------------------- e_atan2.c

const pi_o_4 = 7.8539816339744827900e-1; // 0x3FE921FB 54442D18
const pi_o_2 = 1.5707963267948965580e0; // 0x3FF921FB 54442D18
const pi = 3.1415926535897931160e0; // 0x400921FB 54442D18
const pi_lo = 1.2246467991473532e-16; // 0x3CA1A626 33145C07

/** atan2(y, x) in (−π, π], bit-identical on every JS engine (fdlibm 5.3 `__ieee754_atan2`). */
export function atan2(y: number, x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  const lx = lowWord(x);
  const hy = highWord(y);
  const iy = hy & 0x7fffffff;
  const ly = lowWord(y);
  // NaN: the exponent is all ones and the mantissa is not zero.
  if ((ix | (lx !== 0 ? 1 : 0)) >>> 0 > 0x7ff00000 || (iy | (ly !== 0 ? 1 : 0)) >>> 0 > 0x7ff00000) return x + y;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x = 1.0
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2·sign(x) + sign(y)

  if ((iy | ly) === 0) {
    // y = ±0
    switch (m) {
      case 0:
      case 1:
        return y;
      case 2:
        return pi + tiny;
      default:
        return -pi - tiny;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny; // x = ±0

  if (ix === 0x7ff00000) {
    // x = ±Inf
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return pi_o_4 + tiny;
        case 1:
          return -pi_o_4 - tiny;
        case 2:
          return 3 * pi_o_4 + tiny;
        default:
          return -3 * pi_o_4 - tiny;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return pi + tiny;
      default:
        return -pi - tiny;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny; // y = ±Inf

  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) z = pi_o_2 + 0.5 * pi_lo; // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0; // |y|/x < −2^60
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z; // atan(+, +)
    case 1:
      return -z; // atan(−, +): fdlibm flips the sign bit
    case 2:
      return pi - (z - pi_lo); // atan(+, −)
    default:
      return z - pi_lo - pi; // atan(−, −)
  }
}
