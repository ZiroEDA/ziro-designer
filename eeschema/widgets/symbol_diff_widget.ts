// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_DIFF_WIDGET` (eeschema/widgets/symbol_diff_widget.{h,cpp}): the schematic copy and the
 * library copy of a symbol, overlaid with a slider fading from one to the other. This holds what
 * it shows; the canvas that draws it is the window's.
 */
import type { LIB_SYMBOL } from '../lib_symbol.js';

export class SYMBOL_DIFF_WIDGET {
  private m_schSymbol: LIB_SYMBOL | null = null;
  private m_libSymbol: LIB_SYMBOL | null = null;
  private m_unit = 0;
  private m_bodyStyle = 0;

  /** `DisplayDiff`: the widget takes ownership of both symbols. */
  DisplayDiff(
    aSchSymbol: LIB_SYMBOL,
    aLibSymbol: LIB_SYMBOL,
    aUnit: number,
    aBodyStyle: number,
  ): void {
    this.m_schSymbol = aSchSymbol;
    this.m_libSymbol = aLibSymbol;
    this.m_unit = aUnit;
    this.m_bodyStyle = aBodyStyle;
  }

  GetSchSymbol(): LIB_SYMBOL | null {
    return this.m_schSymbol;
  }

  GetLibSymbol(): LIB_SYMBOL | null {
    return this.m_libSymbol;
  }

  GetUnit(): number {
    return this.m_unit;
  }

  GetBodyStyle(): number {
    return this.m_bodyStyle;
  }
}
