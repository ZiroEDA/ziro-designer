// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_CHOOSER_FRAME` (eeschema/symbol_chooser_frame.cpp), the chooser
 * opened by a *browse button* rather than by Place Symbol.
 *
 * Upstream has TWO hosts around ONE panel, and this is the second of them:
 *
 *   DIALOG_SYMBOL_CHOOSER   Place Symbol. Takes a filter, the already-placed
 *                           list and unit/field edits, and carries the two
 *                           placement checkboxes in its button row.
 *   SYMBOL_CHOOSER_FRAME    A field's "..." button. `nullptr` filter, an EMPTY
 *                           already-placed list, plain OK/Cancel, and it hands
 *                           back nothing but `libId.Format()`.
 *
 * Both build `PANEL_SYMBOL_CHOOSER`, so the tree, the search box, the preview
 * and the details pane are literally the same widget in both — which is why
 * this file is a shell and not a second chooser. `DIALOG_CHANGE_SYMBOLS`'
 * `launchMatchIdSymbolBrowser` / `launchNewIdSymbolBrowser` (:245, :262) reach
 * it through `Kiway().Player( FRAME_SYMBOL_CHOOSER, true, this )`; anything
 * else wanting a lib id from the user wants this one too.
 *
 * Differences from the Place Symbol dialog, all of them upstream's:
 *   - the title is "Symbol Chooser (N items loaded)", not "Choose Symbol"
 *     (`SetTitle( GetTitle() + …" (%d items loaded)" )`, :117);
 *   - no "Place repeated copies" / "Place all units" — the frame's bottom
 *     panel is a bare wxStdDialogButtonSizer (:103-112);
 *   - `dummyAlreadyPlaced` is a local empty vector (:86), so there is no
 *     "-- Already Placed --" group, but `s_SymbolHistoryList` IS passed, so
 *     "-- Recently Used --" is shared with Place Symbol;
 *   - `ShowModal` seeds the selection from the caller's current text (:131),
 *     so browsing a filled-in field starts on that symbol.
 */
import { useCallback, useRef, useState } from 'react';
import {
  PanelSymbolChooser,
  type PanelSymbolChooserHandle,
  type PickedSymbol,
} from '../widgets/panel_symbol_chooser.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

export interface SymbolChooserFrameProps {
  /**
   * The caller's current text, parsed as a LIB_ID and preselected when valid.
   * `ShowModal( wxString* aSymbol, … )`: `if( aSymbol && !aSymbol->IsEmpty() )
   * { libid.Parse( *aSymbol, true ); if( libid.IsValid() ) SetPreselect(…) }`.
   */
  preselect?: string;
  /** "Show footprint previews in Symbol Chooser" (Preferences > Editing). */
  showFootprints?: boolean;
  /** `s_SymbolHistoryList`, shared with the Place Symbol chooser. */
  historyList?: readonly PickedSymbol[];
  /**
   * `OnOK` (:174): the chosen `libId.Format()`, i.e. "Library:Symbol". Not
   * called at all when the selection is invalid — that path is `DismissModal(
   * false )`, the same as Cancel.
   */
  onOk: (libId: string) => void;
  /** wxID_CANCEL / the Escape handler's `DismissModal( false )`. */
  onCancel: () => void;
}

export function SymbolChooserFrame({
  preselect,
  showFootprints = true,
  historyList = [],
  onOk,
  onCancel,
}: SymbolChooserFrameProps): JSX.Element {
  useModalEscape(onCancel);

  const panelRef = useRef<PanelSymbolChooserHandle>(null);
  const [itemCount, setItemCount] = useState(0);
  const title = `Symbol Chooser (${itemCount} items loaded)`;

  const accept = useCallback(() => {
    const selected = panelRef.current?.getSelected() ?? null;
    // `if( libId.IsValid() ) … else DismissModal( false )` — an OK with nothing
    // chosen closes the frame without changing the caller's field.
    if (selected) onOk(selected.symbol.libId);
    else onCancel();
  }, [onOk, onCancel]);

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
            showFootprints={showFootprints}
            historyList={historyList}
            // `std::vector<PICKED_SYMBOL> dummyAlreadyPlaced;` — the frame
            // never shows an "Already Placed" group.
            alreadyPlaced={[]}
            preselect={preselect}
            onAccept={accept}
            onItemCountChanged={setItemCount}
          />
        </div>
        {/* The frame's bottom panel is a wxStdDialogButtonSizer and nothing
            else: no placement checkboxes. Cancel then OK is GTK's order. */}
        <div className="ze-modal-footer">
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
