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
} from '@ziroeda/common/generator.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  GetISO8601CurrentDateTime,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import { FP_SMD, type FOOTPRINT } from '../footprint.js';

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

/** `SELECT_SIDE`. */
enum SELECT_SIDE {
  PCB_NO_SIDE,
  PCB_BACK_SIDE,
  PCB_FRONT_SIDE,
  PCB_BOTH_SIDES,
}

/** `LIST_MOD`: an helper class used to build a list of useful footprints. */
interface LIST_MOD {
  m_Footprint: FOOTPRINT; // Link to the actual footprint
  m_Reference: string; // Its schematic reference
  m_Value: string; // Its schematic value
  m_Layer: number; // its side (B_Cu, or F_Cu)
}

/**
 * `sortFPlist`: sort is made by side (layer), then by reference increasing
 * order. Upstream's comment says "top layer first"; the code returns
 * `ref.m_Layer > tst.m_Layer`, and B_Cu (2) > F_Cu (0), so the back leads.
 */
function sortFPlist(ref: LIST_MOD, tst: LIST_MOD): number {
  if (ref.m_Layer === tst.m_Layer) return strNumCmp(ref.m_Reference, tst.m_Reference);

  return tst.m_Layer - ref.m_Layer;
}

/**
 * `PLACE_FILE_EXPORTER` (place_file_exporter.cpp): the footprint position
 * data of a board, as ASCII or CSV.
 */
export class PLACE_FILE_EXPORTER {
  private readonly m_board: BOARD;
  private readonly m_unitsMM: boolean;
  private readonly m_onlySMD: boolean;
  private readonly m_excludeAllTH: boolean;
  private readonly m_excludeDNP: boolean;
  private readonly m_excludeBOM: boolean;
  private readonly m_negateBottomX: boolean;
  private readonly m_side: SELECT_SIDE;
  private readonly m_formatCSV: boolean;
  private readonly m_place_Offset: VECTOR2I;
  private m_fpCount = 0;
  private m_variant = '';

  constructor(
    aBoard: BOARD,
    aUnitsMM: boolean,
    aOnlySMD: boolean,
    aExcludeAllTH: boolean,
    aExcludeDNP: boolean,
    aExcludeBOM: boolean,
    aTopSide: boolean,
    aBottomSide: boolean,
    aFormatCSV: boolean,
    aUseAuxOrigin: boolean,
    aNegateBottomX: boolean,
  ) {
    this.m_board = aBoard;
    this.m_unitsMM = aUnitsMM;
    this.m_onlySMD = aOnlySMD;
    this.m_excludeAllTH = aExcludeAllTH;
    this.m_excludeDNP = aExcludeDNP;
    this.m_excludeBOM = aExcludeBOM;
    this.m_negateBottomX = aNegateBottomX;

    if (aTopSide && aBottomSide) this.m_side = SELECT_SIDE.PCB_BOTH_SIDES;
    else if (aTopSide) this.m_side = SELECT_SIDE.PCB_FRONT_SIDE;
    else if (aBottomSide) this.m_side = SELECT_SIDE.PCB_BACK_SIDE;
    else this.m_side = SELECT_SIDE.PCB_NO_SIDE;

    this.m_formatCSV = aFormatCSV;

    if (aUseAuxOrigin) this.m_place_Offset = this.m_board.GetDesignSettings().GetAuxOrigin();
    else this.m_place_Offset = { x: 0, y: 0 };
  }

  /** The variant whose DNP / BOM / position-file exclusions apply. */
  SetVariant(aVariant: string): void {
    this.m_variant = aVariant;
  }

  /** The footprint count of the last GenPositionData. */
  GetFootprintCount(): number {
    return this.m_fpCount;
  }

  static GetFrontSideName(): string {
    return FRONT_SIDE;
  }

  static GetBackSideName(): string {
    return BACK_SIDE;
  }

  /** `GenPositionData()`: the position file's text. */
  GenPositionData(): string {
    let buffer = '';

    // Minimal text lengths:
    this.m_fpCount = 0;
    let lenRefText = 8;
    let lenValText = 8;
    let lenPkgText = 16;

    // Select units:
    const conv_unit = this.m_unitsMM ? CONV_UNIT_MM : CONV_UNIT_INCH;
    const unit_text = this.m_unitsMM ? UNIT_TEXT_MM : UNIT_TEXT_INCH;

    // Build and sort the list of footprints alphabetically
    const list: LIST_MOD[] = [];

    for (const footprint of this.m_board.Footprints()) {
      if (this.m_side !== SELECT_SIDE.PCB_BOTH_SIDES) {
        if (footprint.GetLayer() === PCB_LAYER_ID.B_Cu && this.m_side !== SELECT_SIDE.PCB_BACK_SIDE)
          continue;
        if (
          footprint.GetLayer() === PCB_LAYER_ID.F_Cu &&
          this.m_side !== SELECT_SIDE.PCB_FRONT_SIDE
        )
          continue;
      }

      if (footprint.GetExcludedFromPosFilesForVariant(this.m_variant)) continue;

      if (this.m_onlySMD && !(footprint.GetAttributes() & FP_SMD)) continue;

      if (this.m_excludeAllTH && footprint.HasThroughHolePads()) continue;

      if (this.m_excludeDNP && footprint.GetDNPForVariant(this.m_variant)) continue;

      if (this.m_excludeBOM && footprint.GetExcludedFromBOMForVariant(this.m_variant)) continue;

      this.m_fpCount++;

      const item: LIST_MOD = {
        m_Footprint: footprint,
        m_Reference: footprint.Reference().GetShownText(false),
        m_Value: unescapeString(
          footprint.GetFieldValueForVariant(this.m_variant, GetCanonicalFieldName(FIELD_T.VALUE)),
        ),
        m_Layer: footprint.GetLayer(),
      };

      lenRefText = Math.max(lenRefText, item.m_Reference.length);
      lenValText = Math.max(lenValText, item.m_Value.length);
      lenPkgText = Math.max(lenPkgText, footprint.GetFPID().GetLibItemName().length);

      list.push(item);
    }

    if (list.length > 1) list.sort(sortFPlist);

    const sideName = (aLayer: number): string =>
      aLayer === PCB_LAYER_ID.F_Cu ? FRONT_SIDE : BACK_SIDE;
    const position = (aItem: LIST_MOD): VECTOR2I => {
      const footprint_pos = {
        x: aItem.m_Footprint.GetPosition().x - this.m_place_Offset.x,
        y: aItem.m_Footprint.GetPosition().y - this.m_place_Offset.y,
      };

      if (aItem.m_Footprint.GetLayer() === PCB_LAYER_ID.B_Cu && this.m_negateBottomX)
        footprint_pos.x = -footprint_pos.x;

      return footprint_pos;
    };

    if (this.m_formatCSV) {
      const csv_sep = ',';

      // Set first line:;
      buffer += `Ref${csv_sep}Val${csv_sep}Package${csv_sep}PosX${csv_sep}PosY${csv_sep}Rot${csv_sep}Side\n`;

      for (const item of list) {
        const footprint_pos = position(item);
        const pkg = item.m_Footprint.GetFPID().GetLibItemName();

        // No escaping and no space substitution — the quotes do the work.
        let line = `"${item.m_Reference}"${csv_sep}"${item.m_Value}"${csv_sep}"${pkg}"${csv_sep}`;
        line += `${formatFixed(footprint_pos.x * conv_unit, 6)}${csv_sep}`;
        // Keep the Y axis oriented from bottom to top, ( change y coordinate sign )
        line += `${formatFixed(-footprint_pos.y * conv_unit, 6)}${csv_sep}`;
        line += `${formatFixed(item.m_Footprint.GetOrientation().AsDegrees(), 6)}${csv_sep}`;
        line += `${sideName(item.m_Layer)}\n`;

        buffer += line;
      }
    } else {
      // Write file header
      buffer += `### Footprint positions - created on ${GetISO8601CurrentDateTime()} ###\n`;
      // Upstream prints `### Printed by KiCad version <ver>`; a file we wrote
      // names us, as common/generator.ts arranges for every output.
      buffer += `### Printed by ${GENERATOR_APPLICATION} version ${GENERATOR_VERSION}\n`;

      buffer += unit_text;
      buffer += '## Side : ';

      if (this.m_side === SELECT_SIDE.PCB_BACK_SIDE) buffer += BACK_SIDE;
      else if (this.m_side === SELECT_SIDE.PCB_FRONT_SIDE) buffer += FRONT_SIDE;
      else if (this.m_side === SELECT_SIDE.PCB_BOTH_SIDES) buffer += 'All';
      else buffer += '---';

      buffer += '\n';

      buffer += `${padRight('# Ref', lenRefText)}  ${padRight('Val', lenValText)}  ${padRight('Package', lenPkgText)}  `;
      buffer += `${padLeftTrunc('PosX', 9)}  ${padLeftTrunc('PosY', 9)}  ${padLeftTrunc('Rot', 8)}  Side\n`;

      for (const item of list) {
        const footprint_pos = position(item);
        const ref = item.m_Reference.replace(/ /g, '_');
        const val = item.m_Value.replace(/ /g, '_');
        const pkg = item.m_Footprint.GetFPID().GetLibItemName().replace(/ /g, '_');

        buffer += `${padRight(ref, lenRefText)}  ${padRight(val, lenValText)}  ${padRight(pkg, lenPkgText)}  `;
        // Keep the coordinates in the first quadrant, (i.e. change y sign)
        buffer += `${padLeftTrunc(formatFixed(footprint_pos.x * conv_unit, 4), 9)}  `;
        buffer += `${padLeftTrunc(formatFixed(-footprint_pos.y * conv_unit, 4), 9)}  `;
        buffer += `${padLeftTrunc(formatFixed(item.m_Footprint.GetOrientation().AsDegrees(), 4), 8)}  `;
        buffer += `${sideName(item.m_Layer)}\n`;
      }

      // Write EOF
      buffer += '## End\n';
    }

    return buffer;
  }
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
