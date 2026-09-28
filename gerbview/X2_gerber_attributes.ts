// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/X2_gerber_attributes.h` + `.cpp`: the Gerber X2 attribute
 * commands (`%TF`, `%TA`, `%TO`, `%TD`) split into their comma-separated
 * parameters, and `.FileFunction`'s reading of them.
 *
 *     %TF.FileFunction,Copper,L1,Top*%
 *
 * `DbgListPrms` (a `wxLogMessage` dump) is not ported.
 */
import { type CHAR_PTR, type FILE, type LINE_BUFFER, NUL } from './libc.js';

/** `X2_ATTRIBUTE`: the parameters read after `%TF`, `%TA`, `%TO` or `%TD`. */
export class X2_ATTRIBUTE {
  /** The list of parameters; the first is the attribute name when it starts by '.'. */
  protected m_Prms: string[] = [];

  /** @return the parameters list read in the TF command. */
  GetPrms(): string[] {
    return this.m_Prms;
  }

  /**
   * @return parameter `aIdx`, 0 being the attribute name, or an empty string
   *         past the end (`static const wxString dummy`).
   */
  GetPrm(aIdx: number): string {
    if (this.GetPrmCount() > aIdx && aIdx >= 0) return this.m_Prms[aIdx] as string;
    return '';
  }

  /** @return the attribute name, e.g. `.FileFunction`. */
  GetAttribute(): string {
    // m_Prms.Item( 0 ) asserts on an empty array; the only callers read it
    // after ParseAttribCmd, which always adds at least the '*'-terminated one.
    return this.m_Prms[0] ?? '';
  }

  /** @return the number of parameters read. */
  GetPrmCount(): number {
    return this.m_Prms.length;
  }

  /**
   * Parse a TF, TA, TO... command up to its closing `%` and fill m_Prms.
   * The `%TF` itself is already read by the caller. With no file (a `G04 #@!`
   * structured comment) it stops at the end of the text.
   *
   * @return true if no error; false on end of file before the `%`.
   */
  ParseAttribCmd(
    aFile: FILE | null,
    aBuffer: LINE_BUFFER | null,
    aBuffSize: number,
    aText: CHAR_PTR,
    aLineNum: { value: number },
  ): boolean {
    let ok = true;
    let data = '';

    for (;;) {
      while (aText.c() !== NUL) {
        switch (aText.c()) {
          case '%': // end of command
            return ok; // success completion

          case ' ':
          case '\r':
          case '\n':
            aText.inc();
            break;

          case '*': // End of block
            this.m_Prms.push(data);
            data = '';
            aText.inc();
            break;

          case ',': // End of parameter (separator)
            aText.inc();
            this.m_Prms.push(data);
            data = '';
            break;

          default:
            data += aText.c();
            aText.inc();
            break;
        }
      }

      // end of current line, read another one.
      if (aBuffer && aFile) {
        if (aFile.fgets(aBuffer, aBuffSize) === null) {
          // end of file
          ok = false;
          break;
        }

        aLineNum.value++;
        aText.reset(aBuffer);
      } else {
        return ok;
      }
    }

    return ok;
  }

  /** @return true if the attribute is `.FileFunction` (case-insensitive). */
  IsFileFunction(): boolean {
    return this.GetAttribute().toLowerCase() === '.filefunction';
  }

  /** @return true if the attribute is `.MD5`. */
  IsFileMD5(): boolean {
    return this.GetAttribute().toLowerCase() === '.md5';
  }

  /** @return true if the attribute is `.Part`. */
  IsFilePart(): boolean {
    return this.GetAttribute().toLowerCase() === '.part';
  }
}

/** `wxString::IsSameAs( aOther, false )`. */
const sameNoCase = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * `X2_ATTRIBUTE_FILEFUNCTION`, from `%TF.FileFunction`:
 *
 * - the type: Copper, Soldermask, ...;
 * - the position: `L1`..`Ln` then Top / Inr / Bot for copper; Top or Bot for
 *   an extra layer; the span `1,4` for a drill or rout file;
 * - an optional index.
 */
export class X2_ATTRIBUTE_FILEFUNCTION extends X2_ATTRIBUTE {
  /** The z order of the layer for a board. */
  private m_z_order = 0;
  /** The z sub order of the copper layer for a board. */
  private m_z_sub_order = 0;

  constructor(aAttributeBase: X2_ATTRIBUTE) {
    super();
    this.m_Prms = aAttributeBase.GetPrms().slice();
    this.m_z_order = 0;

    // ensure at least 7 parameters exist.
    while (this.GetPrmCount() < 7) this.m_Prms.push('');

    this.set_Z_Order();
  }

  /** The type of layer (Copper, Soldermask ... ). */
  GetFileType(): string {
    return this.m_Prms[1] as string;
  }

  /** The board layer identifier: Ln (for Copper type) or Top, Bot. */
  GetBrdLayerId(): string {
    return this.m_Prms[2] as string;
  }

  /** The layer pair `n,m` of a drill file (`Plated` / `NonPlated`). */
  GetDrillLayerPair(): string {
    return `${this.m_Prms[2]},${this.m_Prms[3]}`;
  }

  /** The board layer side: Top, Bot, Inr; `GetBrdLayerId()` for a non-copper file. */
  GetBrdLayerSide(): string {
    if (this.IsCopper()) return this.m_Prms[3] as string;
    return this.m_Prms[2] as string;
  }

  /** The file function label, if any. */
  GetLabel(): string {
    if (this.IsCopper()) return this.m_Prms[4] as string;
    return this.m_Prms[3] as string;
  }

  /** Drill files only: the layer pair type (PTH, NPTH, Blind or Buried). */
  GetLPType(): string {
    return this.m_Prms[4] as string;
  }

  /** Drill files only: the drill/routing type (Drill, Route, Mixed). */
  GetRouteType(): string {
    return this.m_Prms[5] as string;
  }

  /** True if the file function type is "Copper". */
  IsCopper(): boolean {
    return sameNoCase(this.GetFileType(), 'Copper');
  }

  /** True if the file function type is "Plated" or "NonPlated": a drill file. */
  IsDrillFile(): boolean {
    return sameNoCase(this.GetFileType(), 'Plated') || sameNoCase(this.GetFileType(), 'NonPlated');
  }

  /** The order of the board layer, from front (Top) to back (Bot). */
  GetZOrder(): number {
    return this.m_z_order;
  }

  /** The order of the board copper layer, from front (Top) to back (Bot). */
  GetZSubOrder(): number {
    return this.m_z_sub_order;
  }

  /** Initialize the z order priority of the current file, from its attributes. */
  private set_Z_Order(): void {
    this.m_z_order = 100; // high level
    this.m_z_sub_order = 0;

    if (this.IsCopper()) {
      // Copper layer: the priority is the layer Id
      this.m_z_order = 0;
      const num = this.GetBrdLayerId().slice(1);
      const lnum = toLong(num);

      if (lnum !== null) this.m_z_sub_order = -lnum;
    }

    if (sameNoCase(this.GetFileType(), 'Soldermask')) {
      // solder mask layer: the priority is top then bottom
      this.m_z_order = 1; // for top
      if (sameNoCase(this.GetBrdLayerId(), 'Bot')) this.m_z_order = -this.m_z_order;
    }

    if (sameNoCase(this.GetFileType(), 'Legend')) {
      // Silk screen layer: the priority is top then bottom
      this.m_z_order = 2; // for top
      if (sameNoCase(this.GetBrdLayerId(), 'Bot')) this.m_z_order = -this.m_z_order;
    }

    if (sameNoCase(this.GetFileType(), 'Paste')) {
      // solder paste layer: the priority is top then bottom
      this.m_z_order = 3; // for top
      if (sameNoCase(this.GetBrdLayerId(), 'Bot')) this.m_z_order = -this.m_z_order;
    }

    if (sameNoCase(this.GetFileType(), 'Glue')) {
      // Glue spots: the priority is top then bottom
      this.m_z_order = 4; // for top
      if (sameNoCase(this.GetBrdLayerId(), 'Bot')) this.m_z_order = -this.m_z_order;
    }
  }
}

/**
 * `wxString::ToLong( &lnum )` in base 10: the whole string must be an
 * integer (surrounding whitespace allowed, as `strtol` skips the leading one
 * and wx rejects the trailing), else false.
 */
function toLong(s: string): number | null {
  const m = /^\s*([+-]?\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}
