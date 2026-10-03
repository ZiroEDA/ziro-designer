// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/erc/erc_sch_pin_context.cpp` / `.h`: an SCH_PIN with the SCH_SHEET_PATH it is seen
 * through, so pins of a sheet used more than once can be told apart.
 *
 * Upstream's hash combines the pin's ADDRESS with the sheet path's hash; here it is the pin's
 * KIID with the path, so equality means the same pin on the same path, as there. Its order is
 * not upstream's, but the one caller that orders by it (TestPinToPin's sort) cannot observe
 * it: `ret = lhs < rhs` makes the tie-break 0 or 1, never less than 0.
 */
import type { SCH_PIN } from '../sch_pin.js';
import { SCH_SHEET_PATH } from '../sch_sheet_path.js';

export class ERC_SCH_PIN_CONTEXT {
  private m_pin: SCH_PIN | null;
  private m_sheet: SCH_SHEET_PATH;
  private m_hash: string;

  constructor(pin: SCH_PIN | null = null, sheet: SCH_SHEET_PATH = new SCH_SHEET_PATH()) {
    this.m_pin = pin;
    this.m_sheet = sheet;
    this.m_hash = '';

    if (pin) this.rehash();
  }

  /** Get the SCH_PIN for this context. */
  Pin(): SCH_PIN | null {
    return this.m_pin;
  }

  /** Get the #SCH_SHEET_PATH context for the paired #SCH_PIN. */
  Sheet(): SCH_SHEET_PATH {
    return this.m_sheet;
  }

  /** Test two pin contexts for equality based on the deterministic hash. */
  equals(other: ERC_SCH_PIN_CONTEXT): boolean {
    return this.m_hash === other.m_hash;
  }

  /** Provide a deterministic ordering for item contexts based on hash value. */
  lessThan(other: ERC_SCH_PIN_CONTEXT): boolean {
    return this.m_hash < other.m_hash;
  }

  /** Calculate the deterministic hash for this context. */
  protected rehash(): void {
    this.m_hash = `${this.m_pin!.m_Uuid}@${this.m_sheet.PathAsString()}`;
  }
}
