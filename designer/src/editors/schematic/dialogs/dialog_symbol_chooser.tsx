// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Choose Symbol dialog wrapper: title with the lazy-load item count, the
 * chooser panel, and the button row with the "Place repeated copies" /
 * "Place all units" checkboxes ahead of the standard OK/Cancel buttons.
 * Mirrors kicad/eeschema/dialogs/dialog_symbol_chooser.cpp
 * (DIALOG_SYMBOL_CHOOSER).
 */
import { useCallback, useRef, useState } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import {
  PanelSymbolChooser,
  type PanelSymbolChooserHandle,
  type PickedSymbol,
} from '../widgets/panel_symbol_chooser.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

export type { PickedSymbol } from '../widgets/panel_symbol_chooser.js';

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

export function DialogSymbolChooser({
  powerFilter = false,
  showFootprints = true,
  historyList = [],
  alreadyPlaced = [],
  getPlacedLibSymbol,
  onOk,
  onCancel,
}: DialogSymbolChooserProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const panelRef = useRef<PanelSymbolChooserHandle>(null);
  const [itemCount, setItemCount] = useState(0);
  const [keepSymbol, setKeepSymbol] = useState(false);
  const [placeAllUnits, setPlaceAllUnits] = useState(true);

  // onLazyLoadUpdate runs once in the constructor, so the count is in the title
  // from the outset, including the "(0 items loaded)" of an empty tree.
  const originalTitle = powerFilter ? 'Choose Power Symbol' : 'Choose Symbol';
  const title = `${originalTitle} (${itemCount} items loaded)`;

  const accept = useCallback(() => {
    const selected = panelRef.current?.getSelected() ?? null;
    onOk(
      selected && {
        symbol: selected.symbol,
        unit: selected.unit,
        fields: selected.fields,
        keepSymbol,
        placeAllUnits,
      },
    );
  }, [onOk, keepSymbol, placeAllUnits]);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-symbol-chooser" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {title}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body">
          <PanelSymbolChooser
            ref={panelRef}
            powerFilter={powerFilter}
            showFootprints={showFootprints}
            historyList={historyList}
            alreadyPlaced={alreadyPlaced}
            getPlacedLibSymbol={getPlacedLibSymbol}
            onAccept={accept}
            onItemCountChanged={setItemCount}
          />
        </div>
        <div className="ze-modal-footer ze-chooser-footer">
          <label className="ze-check" title="Keep the symbol selected for subsequent clicks.">
            <input
              type="checkbox"
              checked={keepSymbol}
              onChange={(e) => setKeepSymbol(e.target.checked)}
            />
            Place repeated copies
          </label>
          <label className="ze-check" title="Sequentially place all units of the symbol.">
            <input
              type="checkbox"
              checked={placeAllUnits}
              onChange={(e) => setPlaceAllUnits(e.target.checked)}
            />
            Place all units
          </label>
          <span className="ze-chooser-footer-spacer" />
          {/* Cancel then OK, the order wxStdDialogButtonSizer lays out on GTK
              and the order every other dialog here already uses. This one had
              them the other way round. */}
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={accept}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
