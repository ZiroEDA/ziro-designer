// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_DESIGN_BLOCK_LIB_TABLE_BASE` (common/dialogs/panel_design_block_lib_table_base.cpp): the tables' notebook, the row buttons, and the read-only grid of path
 * substitutions. PANEL_DESIGN_BLOCK_LIB_TABLE fills it through the shared LibTablePanel (common/dialogs/lib_table_panel.tsx).
 *
 * The footprint panel's base without its Reset Libraries: upstream's has none, as there are no stock
 * design block libraries to reset to. Web delta: m_migrate_libs_button ("Migrate Libraries") is left
 * out - there is no older library format here to migrate from.
 */
import type { JSX } from 'react';
import type { LIB_TABLE_BASE_PROPS } from './lib_table_panel.js';
import { SplitButton } from '../widgets/split_button.js';
import { StdBitmapButton } from '../widgets/std_bitmap_button.js';
import {
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';

export function PANEL_DESIGN_BLOCK_LIB_TABLE_BASE(p: LIB_TABLE_BASE_PROPS): JSX.Element {
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
        </BoxSizer>
      </SizerItem>
      {/* No "Available path substitutions:": a library's place is its page, not a path (see
          lib_table_panel.tsx), so there is nothing to substitute. */}
    </BoxSizer>
  );
}
