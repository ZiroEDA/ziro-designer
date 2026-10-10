// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Modeless Find dialog for the board editor. Counterpart:
 * `pcbnew/dialogs/dialog_find.cpp` (DIALOG_FIND / dialog_find_base.cpp), the
 * same controls in the same order: the search combo, then Match case, Whole
 * words only, Wildcards, Wrap; the include-scope checkboxes (footprint
 * reference designators, footprint values, other text items, net names, DRC
 * markers greyed until DRC lands); Find Next / Find Previous / Restart Search /
 * Close, with a status line. Enter = Find Next, Shift+Enter = Find Previous,
 * Esc = close.
 */
import { useState, type JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { KeyNameFromKeyCode } from '@ziroeda/common/hotkeys_basic.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { Button, CheckBox, HyperlinkCtrl, StaticLine } from '@ziroeda/common/wx/controls.js';
import { TextCombo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { DIALOG_FIND, FIND_OPTIONS } from './dialog_find.js';

interface Props {
  /** The live DIALOG_FIND this window draws. */
  dialog: DIALOG_FIND;
  onClose: () => void;
}

export function DialogPcbFind({ dialog, onClose }: Props): JSX.Element {
  // The dialog's own state changes under its handlers; the window redraws after each.
  const [, setTick] = useState(0);
  const redraw = (): void => setTick((t) => t + 1);
  const options = dialog.m_options;
  const onFind = (dir: 'next' | 'prev' | 'restart'): void => {
    if (dir === 'next') dialog.OnFindNext();
    else if (dir === 'prev') dialog.OnFindPrevious();
    else dialog.OnSearchAgain();
    redraw();
  };
  // `onOptionChanged`: any checkbox makes the hit list stale.
  const opt = (patch: Partial<FIND_OPTIONS>): void => {
    dialog.SetOptions({ ...options, ...patch });
    redraw();
  };
  const check = (label: string, key: keyof FIND_OPTIONS, className: string) => (
    <CheckBox
      label={label}
      checked={options[key]}
      onChange={(on) => opt({ [key]: on })}
      className={className}
    />
  );

  // `ACTIONS::showSearch.GetHotKey()` appended as " (%s)".
  const hotkey = ACTIONS.showSearch.GetHotKey();
  const linkLabel = `Show search panel${hotkey ? ` (${KeyNameFromKeyCode(hotkey)})` : ''}`;

  return (
    <DialogShim title="Find" onClose={onClose} modeless className="ze-pcbfind">
      {/* bSizer10 (V) */}
      <div
        className="ze-pcbfind-main"
        onKeyDown={(e) => {
          // OnCharHook: F3 / Shift+F3 is FindNext( aEvent.ShiftDown() ).
          if (e.key === 'F3') {
            e.preventDefault();
            e.stopPropagation();
            dialog.FindNext(e.shiftKey);
            redraw();
          }
        }}
      >
        {/* topSizer (H), 0, wxALL|wxEXPAND 5 */}
        <div className="ze-pcbfind-top">
          {/* leftSizer (V), 1, wxEXPAND */}
          <div className="ze-pcbfind-left">
            {/* bSizer8 (H), 1, wxEXPAND */}
            <div className="ze-pcbfind-search">
              {/* searchStringLabel: wxALIGN_CENTER_VERTICAL|wxALL 5 */}
              <span className="ze-pcbfind-label">Search for:</span>
              {/* m_searchCombo: 1, wxALL|wxEXPAND 5 */}
              <TextCombo
                className="ze-pcbfind-combo"
                // m_searchCombo->SetToolTip( _( "Text with optional wildcards" ) )
                title="Text with optional wildcards"
                value={dialog.m_searchString}
                options={dialog.GetHistory()}
                autoFocus
                onChange={(v) => {
                  dialog.SetSearchString(v);
                  redraw();
                }}
                // onTextEnter: the next hit.
                onEnter={() => onFind('next')}
              />
            </div>
            {/* sizerOptions (H), each box wxALL 5 with a stretch spacer between */}
            <div className="ze-pcbfind-options">
              {check('Match case', 'matchCase', '')}
              <span className="ze-pcbfind-stretch" />
              {check('Whole words only', 'matchWords', '')}
              <span className="ze-pcbfind-stretch" />
              {check('Wildcards', 'wildcards', '')}
              <span className="ze-pcbfind-stretch" />
              {check('Wrap', 'wrap', '')}
            </div>
            {/* the 5px spacer, then sizerInclude = wxFlexGridSizer( 0, 2, 6, 20 ), wxEXPAND|wxALL 5 */}
            <div className="ze-pcbfind-include">
              {check('Search footprint reference designators', 'includeReferences', '')}
              {check('Search DRC markers', 'includeMarkers', '')}
              {check('Search footprint values', 'includeValues', '')}
              {check('Search net names', 'includeNets', '')}
              {check('Include hidden fields', 'checkAllFields', '')}
              <span />
              {check('Search other text items', 'includeTexts', '')}
            </div>
          </div>
          {/* buttonSizer (V); each button wxALL|wxEXPAND 5 */}
          <div className="ze-pcbfind-buttons">
            <Button label="Find Next" isDefault onClick={() => onFind('next')} />
            <Button label="Find Previous" onClick={() => onFind('prev')} />
            <Button label="Restart Search" onClick={() => onFind('restart')} />
            <Button label="Close" onClick={onClose} />
          </div>
        </div>
        {/* staticline: wxEXPAND|wxALL 5 */}
        <StaticLine className="ze-pcbfind-line" />
        {/* sizerStatus (H), wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT 5 */}
        <div className="ze-pcbfind-status">
          <span className="ze-pcbfind-statustext">{dialog.m_status}</span>
          <span className="ze-pcbfind-stretch" />
          <HyperlinkCtrl
            label={linkLabel}
            className="ze-pcbfind-link"
            onClick={() => {
              dialog.OnShowSearchPanel();
              // Show( false )
              onClose();
            }}
          />
        </div>
      </div>
    </DialogShim>
  );
}
