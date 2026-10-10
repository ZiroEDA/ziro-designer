// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SELECT_LAYER_DIALOG` (`dialog_select_one_pcb_layer.cpp:86-160`), drawing
 * the state {@link SELECT_LAYER_DIALOG} holds. The sizers are the
 * constructor's, not a `_base.cpp`'s:
 *
 *   mainSizer (horizontal):
 *     - m_layerRadioBox, "Layer", wxRA_SPECIFY_ROWS at
 *       `std::min( count, 12 )` rows, proportion 1, wxEXPAND|wxALIGN_TOP|wxALL 5;
 *     - buttonsSizer (vertical), wxALIGN_BOTTOM|wxALL 5: OK (the default),
 *       then Cancel, each wxGROW|wxALL 5.
 *
 * A wxRA_SPECIFY_ROWS box fills its buttons down each column first. Picking
 * one is OK: `OnLayerSelected` posts wxID_OK (`:163-166`).
 */

import { Button } from '@ziroeda/common/wx/controls.js';
import { type JSX, useState } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { SELECT_LAYER_DIALOG } from './dialog_select_one_pcb_layer.js';

export function DialogSelectOnePcbLayer({
  dlg,
  onClose,
}: {
  dlg: SELECT_LAYER_DIALOG;
  /** wxID_OK after TransferDataFromWindow, or wxID_CANCEL. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [selection, setSelection] = useState(dlg.m_layerRadioBox);

  useModalEscape(() => onClose(false));

  const ok = (aSelection: number): void => {
    dlg.m_layerRadioBox = aSelection;
    onClose(dlg.TransferDataFromWindow());
  };

  return (
    <div className="ze-modal-backdrop">
      <div
        className="ze-modal ze-selectlayer"
        role="dialog"
        aria-modal="true"
        aria-label={dlg.m_title}
      >
        <div className="ze-modal-header">{dlg.m_title}</div>
        <div className="ze-selectlayer-main">
          <fieldset className="ze-props-group ze-selectlayer-box">
            <legend>Layer</legend>
            <div
              className="ze-selectlayer-grid"
              // [data] wxRA_SPECIFY_ROWS: the major dimension is the row count.
              style={{ gridTemplateRows: `repeat(${dlg.GetMajorDimension()}, auto)` }}
            >
              {dlg.m_layerList.map((name, i) => (
                <label key={`${dlg.m_layerId[i]}`}>
                  <input
                    type="radio"
                    name="select-one-pcb-layer"
                    checked={selection === i}
                    onChange={() => {
                      setSelection(i);
                      ok(i);
                    }}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="ze-selectlayer-buttons">
            <Button label="OK" isDefault onClick={() => ok(selection)} />
            <Button label="Cancel" onClick={() => onClose(false)} />
          </div>
        </div>
      </div>
    </div>
  );
}
