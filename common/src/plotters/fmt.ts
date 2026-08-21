// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `{fmt}` conversions the plot backends print through.
 *
 * KiCad's plotters do not each carry a number formatter: PS_PLOTTER,
 * SVG_PLOTTER and PDF_PLOTTER all call `fmt::print` with `{:g}`, `{:f}` or
 * `{:.{}f}` and share one implementation of each conversion. The *precision*
 * differs per backend and per call site — SVG passes `m_precision`
 * (SVG_plotter.cpp:176, 4 by default), PS asks for `{:.3g}` in
 * `emitSetRGBColor` (PS_plotter.cpp:417) — but that is an argument, not a
 * separate formatter, so the same is true here: one `fixed`, precision at the
 * call site.
 *
 * The three copies this replaced were verified to agree digit for digit over
 * ~36k value/precision pairs, ties and denormals included, before being
 * collapsed.
 */

const F64 = new DataView(new ArrayBuffer(8));

/** The IEEE-754 fields of |aValue|, as the exact rational mantissa * 2^exponent. */
export function decompose(aValue: number): { mantissa: bigint; exponent: number } {
  F64.setFloat64(0, Math.abs(aValue));

  const hi = F64.getUint32(0);
  const lo = F64.getUint32(4);
  const rawExponent = (hi >>> 20) & 0x7ff;

  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);

  // Subnormals have no implicit leading bit and an exponent of 1, not 0.
  if (rawExponent !== 0) mantissa |= 1n << 52n;

  return { mantissa, exponent: (rawExponent === 0 ? 1 : rawExponent) - 1075 };
}

/**
 * `mantissa * 2^exponent * 10^aScale`, rounded to an integer with ties going to
 * even. Exact by construction: the whole computation is a BigInt rational, so
 * there is no second rounding to disagree with the first.
 */
export function scaledRound(aMantissa: bigint, aExponent: number, aScale: number): bigint {
  let numerator = aMantissa;
  let denominator = 1n;

  if (aScale >= 0) numerator *= 10n ** BigInt(aScale);
  else denominator *= 10n ** BigInt(-aScale);

  if (aExponent >= 0) numerator <<= BigInt(aExponent);
  else denominator <<= BigInt(-aExponent);

  let quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;

  if (twiceRemainder > denominator || (twiceRemainder === denominator && (quotient & 1n) === 1n))
    quotient += 1n;

  return quotient;
}

/**
 * fmt's `{:.Nf}`, i.e. C's `%.*f`: the exact binary value of the double is
 * rounded to N decimals with ties going to even, and the sign survives even
 * when the result is zero.
 *
 * `Number.prototype.toFixed` differs on both counts — it rounds ties away from
 * zero and prints negative zero as "0" — so it is not a drop-in. The negative
 * zero matters to PDF specifically: `encodeDoubleForPlotter` recognises `"-0"`
 * and rewrites it, and it can only do that if the minus sign survives.
 */
export function fixed(aValue: number, aPrecision: number): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  const negative = aValue < 0 || Object.is(aValue, -0);
  const { mantissa, exponent } = decompose(aValue);

  let digits = scaledRound(mantissa, exponent, aPrecision).toString();

  if (aPrecision > 0) {
    digits = digits.padStart(aPrecision + 1, '0');
    digits = `${digits.slice(0, digits.length - aPrecision)}.${digits.slice(digits.length - aPrecision)}`;
  }

  return negative ? `-${digits}` : digits;
}

/** printf's default `%g` precision, i.e. six *significant* digits. */
export const FMT_G_PRECISION = 6;

/**
 * fmt's `{:g}` / `{:.Ng}`, i.e. C's `%g` at N significant digits: pick `%e`
 * when the decimal exponent falls outside `[-4, N)` and `%f` otherwise, then
 * strip the fractional part's trailing zeros and a bare trailing point.
 *
 * The exponent is decided on the *rounded* value, not the raw one, which is why
 * it is recovered here by rounding to N significant digits and checking the
 * digit count rather than by trusting `Math.log10`. 9.9999995 is a six-digit
 * value whose exponent is 1, not 0.
 */
export function formatG(aValue: number, aPrecision: number = FMT_G_PRECISION): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  const negative = aValue < 0 || Object.is(aValue, -0);
  const sign = negative ? '-' : '';

  if (aValue === 0) return `${sign}0`;

  const precision = aPrecision;
  const { mantissa, exponent } = decompose(aValue);
  const low = 10n ** BigInt(precision - 1);
  const high = low * 10n;

  // log10 only seeds the exponent; the loops below make it exact, which is what
  // lets the digits come from BigInt arithmetic rather than from log10's
  // accuracy. The overflow loop is the one that runs — rounding to N
  // significant digits can carry into the next decade, as 9.999999 does.
  let decimalExponent = Math.floor(Math.log10(Math.abs(aValue)));
  let significand = scaledRound(mantissa, exponent, precision - 1 - decimalExponent);

  while (significand >= high) {
    decimalExponent += 1;
    significand = scaledRound(mantissa, exponent, precision - 1 - decimalExponent);
  }

  while (significand < low) {
    decimalExponent -= 1;
    significand = scaledRound(mantissa, exponent, precision - 1 - decimalExponent);
  }

  if (decimalExponent < -4 || decimalExponent >= precision) {
    const digits = significand.toString();
    const fraction = digits.slice(1).replace(/0+$/, '');
    const expSign = decimalExponent < 0 ? '-' : '+';
    const expDigits = String(Math.abs(decimalExponent)).padStart(2, '0');

    return `${sign}${digits[0]}${fraction ? `.${fraction}` : ''}e${expSign}${expDigits}`;
  }

  let out = fixed(Math.abs(aValue), precision - 1 - decimalExponent);

  if (out.includes('.')) {
    out = out.replace(/0+$/, '');
    if (out.endsWith('.')) out = out.slice(0, -1);
  }

  return `${sign}${out}`;
}

/**
 * `FormatDouble2Str` — `common/string_utils.cpp:1446-1473`:
 *
 * ```cpp
 * if( aValue != 0.0 && std::fabs( aValue ) <= 0.0001 )
 * {
 *     buf = fmt::format( "{:.16f}", aValue );
 *     while( !buf.empty() && buf[buf.size() - 1] == '0' ) buf.pop_back();
 *     if( buf[buf.size() - 1] == '.' ) buf.pop_back();
 * }
 * else
 * {
 *     buf = fmt::format( "{:.10g}", aValue );
 * }
 * ```
 *
 * This is how KiCad writes a bare double into an s-expression, and getting it
 * wrong changes files other tools read. Three different approximations of it
 * had grown here, none matching and none matching each other:
 *
 *  - the drawing sheet's `toFixed(6)`, which rounds anything below 1e-7 to a
 *    flat `0` where KiCad writes sixteen decimal places;
 *  - `net_chains`'s `String(Number(v.toPrecision(10)))`, which is JS's shortest
 *    round-tripping form and never uses exponent notation, so a large value
 *    comes out with more digits than `%.10g` allows;
 *  - `write-footprint`'s `toFixed(10)`, which is `%.10f` and not `%.10g` at all
 *    — ten digits after the point rather than ten significant ones.
 *
 * The small-value branch is the interesting one and the reason `%g` alone will
 * not do: `%.10g` would render 0.00001 as `1e-05`, and KiCad deliberately
 * avoids exponent notation there by switching to a fixed sixteen places and
 * trimming. The boundary is `<= 0.0001` on the ABSOLUTE value, and exact zero
 * takes the `%g` path, where it prints as `0`.
 */
export function formatDouble2Str(aValue: number): string {
  if (aValue !== 0 && Math.abs(aValue) <= 0.0001) {
    let buf = fixed(aValue, 16);

    // `while( … buf.back() == '0' ) pop_back()` then one `'.'`. Note this trims
    // the string, not the fraction: it is only ever reached for |v| <= 0.0001,
    // whose fixed form always has a decimal point, so it cannot eat an integer's
    // trailing zeros.
    buf = buf.replace(/0+$/, '');
    if (buf.endsWith('.')) buf = buf.slice(0, -1);
    return buf;
  }

  return formatG(aValue, 10);
}
