// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DRAW_LAYERS_SETTINGS_BASE` (`dialog_draw_layers_settings_base.cpp`),
 * drawing the state {@link DIALOG_DRAW_LAYERS_SETTINGS} holds.
 *
 * The sizer tree, `m_namiSizer` (vertical):
 *   - bSizer3 (horizontal), wxEXPAND: "Active layer name:" and the name, each
 *     wxALL 5;
 *   - fgSizer, wxFlexGridSizer( 3, 3, 0, 0 ) with AddGrowableCol( 1 ),
 *     wxEXPAND: label | wxTextCtrl | unit, every cell wxALL 5;
 *   - a wxStaticLine, wxALL|wxEXPAND 5;
 *   - the "Scope" wxRadioBox, one column, wxALL 5;
 *   - a wxStaticLine, wxEXPAND|wxALL 5;
 *   - the std buttons.
 * Title `_("Layers Settings")` (`_base.h:64`).
 */

import { type JSX, useState } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import {
  DIALOG_DRAW_LAYERS_SETTINGS,
  DRAW_LAYERS_SCOPE_CHOICES,
} from './dialog_draw_layers_settings.js';

export function DialogDrawLayersSettings({
  dlg,
  onClose,
}: {
  /** Already through TransferDataToWindow. */
  dlg: DIALOG_DRAW_LAYERS_SETTINGS;
  /** wxID_OK after TransferDataFromWindow, or wxID_CANCEL. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [offsetX, setOffsetX] = useState(dlg.m_tcOffsetX);
  const [offsetY, setOffsetY] = useState(dlg.m_tcOffsetY);
  const [rotation, setRotation] = useState(dlg.m_tcRotation);
  const [scope, setScope] = useState(dlg.m_rbScope);
  const units = unitLabel(dlg.GetOffsetUnits());

  useModalEscape(() => onClose(false));

  const ok = (): void => {
    dlg.m_tcOffsetX = offsetX;
    dlg.m_tcOffsetY = offsetY;
    dlg.m_tcRotation = rotation;
    dlg.m_rbScope = scope;

    onClose(dlg.TransferDataFromWindow());
  };

  const row = (
    aLabel: string,
    aValue: string,
    aSet: (aText: string) => void,
    aUnit: string,
  ): JSX.Element[] => [
    <span key="l" className="ze-drawlayers-cell">
      {aLabel}
    </span>,
    <input
      key="c"
      className="ze-search ze-drawlayers-cell"
      aria-label={aLabel}
      value={aValue}
      onChange={(e) => aSet(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ok();
        }
        e.stopPropagation();
      }}
    />,
    <span key="u" className="ze-drawlayers-cell">
      {aUnit}
    </span>,
  ];

  return (
    <div className="ze-modal-backdrop">
      <div
        className="ze-modal ze-drawlayers"
        role="dialog"
        aria-modal="true"
        aria-label="Layers Settings"
      >
        <div className="ze-modal-header">Layers Settings</div>
        <div className="ze-drawlayers-name">
          <span className="ze-drawlayers-cell">Active layer name:</span>
          <span className="ze-drawlayers-cell">{dlg.m_stLayerName}</span>
        </div>
        <div className="ze-drawlayers-grid">
          {row('Offset X:', offsetX, setOffsetX, units)}
          {row('Offset Y:', offsetY, setOffsetY, units)}
          {/* UNIT_BINDER::SetUnits( DEGREES ) relabels the "dummy" to °. */}
          {row('Rotate counterclockwise:', rotation, setRotation, unitLabel('degrees'))}
        </div>
        <div className="ze-drawlayers-line" />
        <fieldset className="ze-props-group ze-drawlayers-scope">
          <legend>Scope</legend>
          {DRAW_LAYERS_SCOPE_CHOICES.map((c, i) => (
            <label key={c}>
              <input
                type="radio"
                name="drawlayers-scope"
                checked={scope === i}
                onChange={() => setScope(i)}
              />{' '}
              {c}
            </label>
          ))}
        </fieldset>
        <div className="ze-drawlayers-line" />
        <StdDialogButtons onCancel={() => onClose(false)} onOk={ok} />
      </div>
    </div>
  );
}
