// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_BASE_FRAME::PickSymbolFromLibrary` (`eeschema/picksymbol.cpp`)'s
 * contract: the PICKED_SYMBOL it returns (declared upstream in sch_screen.h)
 * and the Choose Symbol dialog it runs, `DIALOG_SYMBOL_CHOOSER` — its props
 * and what it hands back on OK. The dialog itself is designer's
 * (`dialogs/dialog_symbol_chooser.tsx`), reached through
 * `EESCHEMA_APP.DialogSymbolChooser`.
 */
import type { LibSymbol } from './types.js';

/** Upstream PICKED_SYMBOL (sch_screen.h): LIB_ID + unit + edited fields. */
export interface PickedSymbol {
  libId: string;
  unit: number;
  fields: [string, string][];
}

/** What the dialog hands back on OK (PICKED_SYMBOL + the checkbox states). */
export interface SymbolChooserResult {
  symbol: LibSymbol;
  /** Selected unit; 0 when the symbol itself was picked (default to 1). */
  unit: number;
  /** Field edits, currently just a footprint override: [name, value]. */
  fields: [string, string][];
  /** "Place repeated copies", keep the symbol selected for subsequent clicks. */
  keepSymbol: boolean;
  /** "Place all units", sequentially place all units of the symbol. */
  placeAllUnits: boolean;
}

export interface DialogSymbolChooserProps {
  /** Restrict to power symbols (SYMBOL_LIBRARY_FILTER::FilterPowerSymbols). */
  powerFilter?: boolean;
  /** "Show footprint previews in Symbol Chooser" (Preferences > Editing Options). */
  showFootprints?: boolean;
  historyList?: readonly PickedSymbol[];
  alreadyPlaced?: readonly PickedSymbol[];
  getPlacedLibSymbol?: (libId: string) => LibSymbol | undefined;
  /** wxID_OK, null when OK was pressed with nothing selected (invalid LIB_ID). */
  onOk: (result: SymbolChooserResult | null) => void;
  /** wxID_CANCEL. */
  onCancel: () => void;
}
