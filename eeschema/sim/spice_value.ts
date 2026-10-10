// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sim/spice_value.{h,cpp}`: `SPICE_VALUE`, a number with a SPICE unit prefix.
 *
 * Partial: the string and double constructors, `Normalize`, `ToDouble`, `ToSpiceString` and
 * `StripZeros` - what the LTspice importer's `.tran` rewrite calls. Arithmetic, `ToString`, the
 * format struct and the validator are not ported yet.
 */
import { formatG } from '@ziroeda/common/plotters/fmt.js';

export enum UNIT_PREFIX {
  PFX_FEMTO = -15,
  PFX_PICO = -12,
  PFX_NANO = -9,
  PFX_MICRO = -6,
  PFX_MILI = -3,
  PFX_NONE = 0,
  PFX_KILO = 3,
  PFX_MEGA = 6,
  PFX_GIGA = 9,
  PFX_TERA = 12,
}

/** `sscanf( s, "%lf…" )`'s number: strtod's decimal and inf/nan forms, after leading space. */
const STRTOD = /^[ \t\n\v\f\r]*([+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan))/i;

function spicePrefix(aPrefix: UNIT_PREFIX): string {
  switch (aPrefix) {
    case UNIT_PREFIX.PFX_FEMTO:
      return 'f';
    case UNIT_PREFIX.PFX_PICO:
      return 'p';
    case UNIT_PREFIX.PFX_NANO:
      return 'n';
    case UNIT_PREFIX.PFX_MICRO:
      return 'u';
    case UNIT_PREFIX.PFX_MILI:
      return 'm';
    case UNIT_PREFIX.PFX_NONE:
      return '';
    case UNIT_PREFIX.PFX_KILO:
      return 'k';
    case UNIT_PREFIX.PFX_MEGA:
      return 'Meg';
    case UNIT_PREFIX.PFX_GIGA:
      return 'G';
    case UNIT_PREFIX.PFX_TERA:
      return 'T';
    default:
      return '';
  }
}

export class SPICE_VALUE {
  private m_base = 0;
  private m_prefix: UNIT_PREFIX = UNIT_PREFIX.PFX_NONE;
  private m_spiceStr = false;

  constructor(aValue: string | number = 0, aPrefix: UNIT_PREFIX = UNIT_PREFIX.PFX_NONE) {
    if (typeof aValue === 'number') {
      this.m_base = aValue;
      this.m_prefix = aPrefix;
      this.Normalize();
      return;
    }

    if (aValue === '') return;

    // sscanf( s, "%lf%7s", &m_base, units ): a failed %lf leaves m_base 0 and reads no units.
    const m = STRTOD.exec(aValue);

    if (!m) {
      this.Normalize();
      return;
    }

    const num = m[1]!.toLowerCase().replace(/^([+-]?)inf(inity)?$/, '$1Infinity');
    this.m_base = /nan$/.test(num) ? Number.NaN : Number(num);

    const units = (
      /^[ \t\n\v\f\r]*(\S{1,7})/.exec(aValue.substring(m[0].length))?.[1] ?? ''
    ).toLowerCase();

    if (units === '') {
      this.Normalize();
      return;
    }

    this.m_spiceStr = true;

    if (units === 'meg') {
      this.m_prefix = UNIT_PREFIX.PFX_MEGA;
    } else {
      switch (units[0]) {
        case 'f':
          this.m_prefix = UNIT_PREFIX.PFX_FEMTO;
          break;
        case 'p':
          this.m_prefix = UNIT_PREFIX.PFX_PICO;
          break;
        case 'n':
          this.m_prefix = UNIT_PREFIX.PFX_NANO;
          break;
        case 'u':
          this.m_prefix = UNIT_PREFIX.PFX_MICRO;
          break;
        case 'm':
          this.m_prefix = UNIT_PREFIX.PFX_MILI;
          break;
        case 'k':
          this.m_prefix = UNIT_PREFIX.PFX_KILO;
          break;
        case 'g':
          this.m_prefix = UNIT_PREFIX.PFX_GIGA;
          break;
        case 't':
          this.m_prefix = UNIT_PREFIX.PFX_TERA;
          break;
        default:
          this.m_prefix = UNIT_PREFIX.PFX_NONE;
          break;
      }
    }

    this.Normalize();
  }

  /** Move the base into [1, 1000) by changing the prefix, within femto..tera. */
  Normalize(): void {
    while (Math.abs(this.m_base) >= 1000.0) {
      if (this.m_prefix === UNIT_PREFIX.PFX_TERA)
        // this is the biggest unit available
        break;

      this.m_base *= 0.001;
      this.m_prefix = this.m_prefix + 3;
    }

    while (this.m_base !== 0.0 && Math.abs(this.m_base) < 1.0) {
      if (this.m_prefix === UNIT_PREFIX.PFX_FEMTO)
        // this is the smallest unit available
        break;

      this.m_base *= 1000.0;
      this.m_prefix = this.m_prefix - 3;
    }
  }

  ToDouble(): number {
    let res = this.m_base;

    if (this.m_prefix !== UNIT_PREFIX.PFX_NONE) res *= 10 ** this.m_prefix;

    return res;
  }

  /** `wxString::FromCDouble( m_base )` (an ostream at the default precision: `%g`), zeros
   * stripped, then the SPICE prefix. */
  ToSpiceString(): string {
    return SPICE_VALUE.StripZeros(formatG(this.m_base, 6)) + spicePrefix(this.m_prefix);
  }

  IsSpiceString(): boolean {
    return this.m_spiceStr;
  }

  /** Trailing fractional zeros, then a bare decimal point, removed. */
  static StripZeros(aString: string): string {
    let s = aString;

    if (s.includes(',') || s.includes('.')) {
      while (s.endsWith('0')) s = s.slice(0, -1);

      if (s.endsWith('.') || s.endsWith(',')) s = s.slice(0, -1);
    }

    return s;
  }
}
