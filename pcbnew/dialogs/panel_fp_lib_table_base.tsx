// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_LIB_TABLE_BASE` (pcbnew/dialogs/panel_fp_lib_table_base.cpp): the tables' notebook, the row buttons, and the read-only grid of path
 * substitutions. PANEL_FP_LIB_TABLE fills it through the shared LibTablePanel (common/dialogs/lib_table_panel.tsx).
 *
 * Web delta: m_migrate_libs_button ("Migrate Libraries") is left out - there is no older library
 * format here to migrate from. m_resetGlobal ("Reset Libraries") is the symbol panel's: the global
 * table is the user's own, chaining the hosted set, and Reset makes it again as a new install has it.
 */
import type { JSX } from 'react';
import type { LIB_TABLE_BASE_PROPS } from '@ziroeda/common/dialogs/lib_table_panel.js';
import { SplitButton } from '@ziroeda/common/widgets/split_button.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { Button } from '@ziroeda/wx/controls.js';

export function PANEL_FP_LIB_TABLE_BASE(p: LIB_TABLE_BASE_PROPS): JSX.Element {
  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        {p.m_notebook}
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={8}>
        {/* bButtonsSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title="Add empty row to table"
              onClick={p.onAppend}
            />
          </SizerItem>
          <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <SplitButton
              label="Add Existing"
              bitmap="small_folder"
              onClick={() => {}}
              clickOpensMenu
              menu={p.browseMenu}
              disabled={p.browseMenu.length === 0}
            />
          </SizerItem>
          <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StdBitmapButton bitmap="small_up" title="Move up" onClick={p.onMoveUp} />
          </SizerItem>
          <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StdBitmapButton bitmap="small_down" title="Move down" onClick={p.onMoveDown} />
          </SizerItem>
          <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove library from table"
              onClick={p.onDelete}
            />
          </SizerItem>
          <Spacer width={20} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
            <Button
              label="Reset Libraries"
              onClick={() => p.onReset?.()}
              disabled={!p.resetEnabled}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      {/* No "Available path substitutions:": a library's place is its page, not a path (see
          lib_table_panel.tsx), so there is nothing to substitute. */}
    </BoxSizer>
  );
}
