// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint position files — what a pick-and-place machine is programmed from.
 * Counterpart: `PLACE_FILE_EXPORTER::GenPositionData` and `DecorateFilename`
 * (pcbnew/exporters/place_file_exporter.cpp).
 *
 * Pure string formatting over the board: no plotter stack, no dialog. Two
 * output shapes from one pass — a column-aligned ASCII table and a CSV — which
 * differ by more than their separators, so they are written separately rather
 * than through one parameterised writer.
 *
 * ## The two formats disagree on purpose
 *
 * CSV wraps reference, value and package in double quotes and does **no**
 * escaping; ASCII does the opposite, quoting nothing and replacing spaces with
 * underscores. A value like `0,1uF/50V` is therefore safe in the CSV (it is
 * quoted) and safe in the ASCII (there is no separator to confuse), and
 * "unifying" the two would break one of them.
 *
 * ## Column widths come from the filtered set
 *
 * The ASCII column widths are the longest reference, value and package **among
 * the footprints that survived the filters**, not across the board. Exporting
 * front-only and back-only from the same board legitimately produces two files
 * with different column widths.
 */
import {
  GENERATOR_APPLICATION,
  GENERATOR_VENDOR,
  GENERATOR_VERSION,
} from '@ziroeda/common/src/generator.js';
import { strNumCmp, unescapeString } from '@ziroeda/common/src/string_utils.js';
import { boardAuxOrigin } from './plot_gerber.js';
import type { Board, PcbFootprint } from './types.js';

/**
 * Spelled as upstream spells them, for traceability rather than for arithmetic.
 *
 * Worth recording because it is easy to assume otherwise: `1e6 * 0.0254`
 * evaluates to *exactly* 25400 in IEEE754, so writing the constant either way
 * gives bit-identical doubles and identical output. Mutation testing confirms
 * it — replacing this with the literal 25400 changes nothing. The upstream
 * spelling is kept so the line can be matched against the C++, not because the
 * association matters.
 */
const IU_PER_MILS = 1e6 * 0.0254;
const CONV_UNIT_INCH = 0.001 / IU_PER_MILS;
const CONV_UNIT_MM = 1.0 / 1e6;

const UNIT_TEXT_MM = '## Unit = mm, Angle = deg.\n';
const UNIT_TEXT_INCH = '## Unit = inches, Angle = deg.\n';

/** `GetFrontSideName()` / `GetBackSideName()`. */
const FRONT_SIDE = 'top';
const BACK_SIDE = 'bottom';

export interface PlaceFileOptions {
  unitsMM: boolean;
  frontSide: boolean;
  backSide: boolean;
  formatCSV?: boolean;
  onlySMD?: boolean;
  excludeAllTH?: boolean;
  excludeDNP?: boolean;
  excludeBOM?: boolean;
  negateBottomX?: boolean;
  useAuxOrigin?: boolean;
  /** `GetISO8601CurrentDateTime()`: local time, `YYYY-MM-DDTHH:MM:SS`, no zone. */
  creationDate?: string;
}

interface PlaceEntry {
  footprint: PcbFootprint;
  reference: string;
  value: string;
  package: string;
  layerId: number;
}

/**
 * `%.*f` as glibc renders it, which is **not** what `toFixed` does.
 *
 * They disagree on exact ties: the ES spec picks the larger candidate (half
 * away from zero) while glibc rounds half to even on the exact binary value.
 * This is reachable, not theoretical — 31250 IU is exactly 0.03125 mm as a
 * double, which prints `0.0312` upstream and `0.0313` through `toFixed(4)`.
 *
 * Working in exact integer arithmetic on the double's own mantissa and exponent
 * is the only way to see the tie at all; scaling in floating point reintroduces
 * the error being corrected for.
 */
export function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return String(value);

  // printf renders -0.0 with its sign; JS `(-0).toFixed()` does not. Upstream
  // negates an integer before multiplying so it never produces one, and the
  // callers here do the same — this only keeps a stray -0 from leaking a sign.
  const v = Object.is(value, -0) ? 0 : value;
  const negative = v < 0;

  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
  const bits = (BigInt(buf.getUint32(0)) << 32n) | BigInt(buf.getUint32(4));
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xf_ffff_ffff_ffffn;
  const mantissa = expBits === 0 ? frac : frac | (1n << 52n);
  const exponent = (expBits === 0 ? -1074 : expBits - 1075) as number;

  // |v| = mantissa * 2^exponent exactly. Want round(|v| * 10^digits).
  const scaled = mantissa * 10n ** BigInt(digits);
  let n: bigint;

  if (exponent >= 0) {
    n = scaled << BigInt(exponent);
  } else {
    const den = 1n << BigInt(-exponent);
    const q = scaled / den;
    const r = scaled % den;
    const twice = r * 2n;
    // Half to even on an exact tie, matching glibc.
    n = twice > den || (twice === den && q % 2n === 1n) ? q + 1n : q;
  }

  const s = n.toString().padStart(digits + 1, '0');
  const whole = s.slice(0, s.length - digits);
  const frac2 = digits > 0 ? `.${s.slice(s.length - digits)}` : '';

  return `${negative ? '-' : ''}${whole}${frac2}`;
}

/** `%-*s`: pad right to at least `width`, never truncating. */
const padRight = (s: string, width: number): string => s.padEnd(width, ' ');

/** `%9.9s`-style: truncate to `width` then right-align in `width`. */
const padLeftTrunc = (s: string, width: number): string => s.slice(0, width).padStart(width, ' ');

/** `FOOTPRINT::HasThroughHolePads`. */
export function hasThroughHolePads(fp: PcbFootprint): boolean {
  // Upstream tests `!= PAD_ATTRIB::SMD`, so an edge-connector pad ('connect',
  // which has no hole at all) and an NPTH both count as through-hole. The
  // checkbox says "with through hole pads"; it means "with any non-SMD pad".
  return fp.pads.some((p) => p.type !== 'smd');
}

const hasAttr = (fp: PcbFootprint, name: string): boolean => (fp.attributes ?? []).includes(name);

/** The part of a LIB_ID after the colon: `GetFPID().GetLibItemName()`. */
const libItemName = (lib: string): string => {
  const i = lib.indexOf(':');
  return i === -1 ? lib : lib.slice(i + 1);
};

/**
 * `sortFPlist`: **descending** layer id, then reference.
 *
 * B.Cu is 2 and F.Cu is 0, so descending puts the *back* first. The comment
 * above it upstream says "top layer first" and is a fossil of the pre-6.0 layer
 * numbering — the code is what ships, so the back leads.
 */
export function sortPlaceFileList(a: PlaceEntry, b: PlaceEntry): number {
  if (a.layerId === b.layerId) return strNumCmp(a.reference, b.reference);
  return b.layerId - a.layerId;
}

const layerIdOf = (layer: string): number => (layer === 'B.Cu' ? 2 : 0);

function collect(board: Board, opts: PlaceFileOptions): PlaceEntry[] {
  const both = opts.frontSide && opts.backSide;
  const list: PlaceEntry[] = [];

  for (const fp of board.footprints) {
    if (!both) {
      // Both tests are layer-specific, so a footprint on neither outer copper
      // layer survives them — and is then printed as `bottom`, since the side
      // ternary has no third branch. Reproduced rather than guarded.
      if (fp.layer === 'B.Cu' && !opts.backSide) continue;
      if (fp.layer === 'F.Cu' && !opts.frontSide) continue;
    }

    if (hasAttr(fp, 'exclude_from_pos_files')) continue;
    if (opts.onlySMD && !hasAttr(fp, 'smd')) continue;
    if (opts.excludeAllTH && hasThroughHolePads(fp)) continue;
    if (opts.excludeDNP && hasAttr(fp, 'dnp')) continue;
    if (opts.excludeBOM && hasAttr(fp, 'exclude_from_bom')) continue;

    list.push({
      footprint: fp,
      reference: fp.reference ?? '',
      // The value is unescaped explicitly by the exporter; the reference
      // arrives already unescaped from GetShownText.
      value: unescapeString(fp.value ?? ''),
      package: libItemName(fp.lib),
      layerId: layerIdOf(fp.layer),
    });
  }

  if (list.length > 1) list.sort(sortPlaceFileList);
  return list;
}

/**
 * `GenPositionData`, returning the count alongside the text.
 *
 * Upstream splits these across a method and an accessor only because C++ made
 * that convenient; the dialog calls the generator purely for the count when it
 * decides whether to say "No footprint for automated placement", so they have
 * to come out of one pass or they can disagree.
 */
export function genPositionData(
  board: Board,
  opts: PlaceFileOptions,
): { data: string; footprintCount: number } {
  const list = collect(board, opts);
  const conv = opts.unitsMM ? CONV_UNIT_MM : CONV_UNIT_INCH;
  const origin = opts.useAuxOrigin ? boardAuxOrigin(board) : { x: 0, y: 0 };

  const placed = list.map((e) => {
    let x = e.footprint.at.x - origin.x;
    const y = e.footprint.at.y - origin.y;
    // X is negated only for the back, only when asked, and only *after* the
    // aux origin has been taken off.
    if (e.layerId === 2 && opts.negateBottomX) x = -x;
    return { e, x, y };
  });

  if (opts.formatCSV) {
    let out = 'Ref,Val,Package,PosX,PosY,Rot,Side\n';

    for (const { e, x, y } of placed) {
      const side = e.layerId === 0 ? FRONT_SIDE : BACK_SIDE;
      // No escaping and no space substitution — the quotes do the work.
      out += `"${e.reference}","${e.value}","${e.package}",`;
      // `%f` is six decimals, for the rotation as well as the coordinates.
      out += `${formatFixed(x * conv, 6)},${formatFixed(-y * conv, 6)},`;
      out += `${formatFixed(e.footprint.angle, 6)},${side}\n`;
    }

    return { data: out, footprintCount: list.length };
  }

  let lenRef = 8;
  let lenVal = 8;
  let lenPkg = 16;
  for (const e of list) {
    lenRef = Math.max(lenRef, e.reference.length);
    lenVal = Math.max(lenVal, e.value.length);
    lenPkg = Math.max(lenPkg, e.package.length);
  }

  const sideWord =
    opts.backSide && !opts.frontSide
      ? BACK_SIDE
      : opts.frontSide && !opts.backSide
        ? FRONT_SIDE
        : // "All" is capitalised here while the row words and the filename suffixes
          // are lowercase. Three casings of one concept in one file, all upstream's.
          opts.frontSide && opts.backSide
          ? 'All'
          : // Neither side is a reachable state, not an error: a header-only file.
            '---';

  let out = `### Footprint positions - created on ${opts.creationDate ?? ''} ###\n`;
  // Upstream prints `### Printed by KiCad version <ver>`. Naming KiCad in a
  // file we generated is what common/src/generator.ts exists to prevent, so the
  // line carries our own identity, as plot_gerber.ts already does.
  // One name, not two: the application and the vendor are now the same word,
  // and "Printed by ZiroEDA ZiroEDA" is not a sentence.
  out += `### Printed by ${GENERATOR_APPLICATION} version ${GENERATOR_VERSION}\n`;
  out += opts.unitsMM ? UNIT_TEXT_MM : UNIT_TEXT_INCH;
  out += `## Side : ${sideWord}\n`;

  // The '# Ref' header sits *inside* the reference column, so the word 'Ref' is
  // two characters right of where the data references start. Not an alignment
  // bug to fix — the column boundary is what a parser keys off.
  out += `${padRight('# Ref', lenRef)}  ${padRight('Val', lenVal)}  ${padRight('Package', lenPkg)}  `;
  out += `${padLeftTrunc('PosX', 9)}  ${padLeftTrunc('PosY', 9)}  ${padLeftTrunc('Rot', 8)}  Side\n`;

  for (const { e, x, y } of placed) {
    const side = e.layerId === 0 ? FRONT_SIDE : BACK_SIDE;
    const ref = e.reference.replace(/ /g, '_');
    const val = e.value.replace(/ /g, '_');
    const pkg = e.package.replace(/ /g, '_');

    out += `${padRight(ref, lenRef)}  ${padRight(val, lenVal)}  ${padRight(pkg, lenPkg)}  `;
    out += `${padLeftTrunc(formatFixed(x * conv, 4), 9)}  ${padLeftTrunc(formatFixed(-y * conv, 4), 9)}  `;
    out += `${padLeftTrunc(formatFixed(e.footprint.angle, 4), 8)}  ${side}\n`;
  }

  out += '## End\n';

  return { data: out, footprintCount: list.length };
}

/** `DecorateFilename`. */
export function decorateFilename(baseName: string, front: boolean, back: boolean): string {
  if (front && back) return `${baseName}-all`;
  if (front) return `${baseName}-${FRONT_SIDE}`;
  if (back) return `${baseName}-${BACK_SIDE}`;
  return baseName;
}

/**
 * The full output name, which upstream duplicates between the dialog and the
 * jobs handler. Factored once so the two cannot drift.
 *
 * Note the CSV name gains a **second** suffix: a both-sides CSV export is
 * `<board>-all-pos.csv`, not `<board>-all.csv`.
 */
export function placeFileName(
  boardBaseName: string,
  front: boolean,
  back: boolean,
  formatCSV: boolean,
): string {
  const decorated = decorateFilename(boardBaseName, front, back);
  return formatCSV ? `${decorated}-pos.csv` : `${decorated}.pos`;
}
