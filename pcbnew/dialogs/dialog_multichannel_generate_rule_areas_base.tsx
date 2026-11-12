// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS_BASE` (pcbnew/dialogs/dialog_multichannel_generate_
 * rule_areas_base.cpp): the sources notebook and the two options. The pages' grids are what the
 * class builds into m_panel1, m_panel2 and the Groups page it appends.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxALL, wxEXPAND, wxHORIZONTAL, wxLEFT, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { Notebook, type NotebookPage } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS_BASE_PROPS {
  /** m_sourceNotebook's pages: Sheets, Component Classes, and the class's Groups. */
  pages: readonly NotebookPage[];
  selection: number;
  OnNotebookPageChanged: (aPage: number) => void;
  m_cbReplaceExisting: CHECK;
  m_cbGroupItems: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS_BASE(
  p: DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Generate Multichannel Rule Areas')} onClose={p.onCancel}>
      {/* fgSizer3 = wxFlexGridSizer( 0, 1, 0, 0 ) */}
      <FlexGridSizer cols={1} growableCols={[0]} growableRows={[0]}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[600, 400]}>
          <Notebook
            pages={p.pages}
            selection={p.selection}
            onPageChanged={p.OnNotebookPageChanged}
            ariaLabel={_('Sources')}
          />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bSizer4 */}
          <BoxSizer orient={wxVERTICAL}>{null}</BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bSizer13 */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL} border={5}>
              <CheckBox
                label={_('Replace existing placement rule areas')}
                check={p.m_cbReplaceExisting}
              />
            </SizerItem>
            <SizerItem flag={wxALL} border={5}>
              <CheckBox
                label={_('Group footprints with their placement rule areas')}
                check={p.m_cbGroupItems}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* bottomButtonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <Spacer width={10} height={0} proportion={1} border={5} />
            <SizerItem flag={wxALL} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </FlexGridSizer>
    </DialogShim>
  );
}
