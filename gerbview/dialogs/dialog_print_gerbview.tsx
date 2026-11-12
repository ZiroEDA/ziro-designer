// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/dialogs/dialog_print_gerbview.cpp`: DIALOG_PRINT_GERBVIEW, the
 * controls' state and the transfers both ways, over the DIALOG_PRINT_GENERIC
 * state it derives (`common/dialogs/dialog_print_generic.cpp`).
 * `dialog_print_gerbview.tsx` draws it through the shared
 * `DIALOG_PRINT_GENERIC` view.
 *
 * Reproduced deliberately, because it is what GerbView does:
 *  - TransferDataToWindow checks `listBox->Check( ii, true )` with the LAYER
 *    index, not the item's row in its list (`:136-137`), so with a gap in
 *    the image list the check lands on the wrong row, or on none;
 *  - only the first LAYER_PER_LIST * LAYER_LIST_COUNT = 32 layers can be
 *    listed or printed (`:117-121`, `:252-265`);
 *  - nothing is loaded from or saved to gerbview.json: GERBVIEW_CONTROL::Print
 *    builds fresh settings each time (`:280-290`) and the generic
 *    saveSettings writes only to them (`dialog_print_generic.cpp:120-125`).
 */

import { type JSX, useState } from 'react';
import { DIALOG_PRINT_GENERIC } from '@ziroeda/common/dialogs/dialog_print_generic.js';
import { CheckListBox } from '@ziroeda/wx/checklst.js';
import { Button, CheckBox } from '@ziroeda/wx/controls.js';
import {
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, StaticBoxSizer } from '@ziroeda/wx/sizer.js';
import {
  getScaleValue,
  type PrintScaleMode,
  setScaleValue,
} from '@ziroeda/common/dialogs/dialog_print_generic.js';
import { BOARD_PRINTOUT_SETTINGS } from '@ziroeda/common/board_printout.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { GERBVIEW_FRAME } from '../gerbview_frame.js';
import { GERBVIEW_PRINTOUT } from '../gerbview_printout.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

/** A wxCheckListBox: its rows' text and check state. */
export interface CHECK_LIST_BOX {
  items: string[];
  checked: boolean[];
}

export class DIALOG_PRINT_GERBVIEW {
  /// Number of layers in each list
  static readonly LAYER_PER_LIST = 16;
  /// Number of layer list widgets
  static readonly LAYER_LIST_COUNT = 2;

  private readonly m_parent: GERBVIEW_FRAME;
  private readonly m_settings: BOARD_PRINTOUT_SETTINGS;

  // ---- DIALOG_PRINT_GENERIC's controls -----------------------------------
  /** `m_outputMode->GetSelection()`: 0 Color, 1 Black and white. */
  m_outputMode = 0;
  /** `m_titleBlock->GetValue()`, "Print drawing sheet". */
  m_titleBlock = false;
  /** Whether `m_titleBlock` is shown: ForcePrintBorder hides it. */
  m_titleBlockShown = true;
  /** The Scale radios and the Custom text. */
  m_scaleMode: PrintScaleMode = '1:1';
  m_customScale = '';

  // ---- DIALOG_PRINT_GERBVIEW's extra widgets ------------------------------
  m_layerLists: CHECK_LIST_BOX[] = [];
  m_checkboxMirror = false;
  /// Map layer numbers to items on the list
  private m_layerToItemMap = new Map<number, number>();

  constructor(aParent: GERBVIEW_FRAME, aSettings: BOARD_PRINTOUT_SETTINGS) {
    this.m_parent = aParent;
    this.m_settings = aSettings;

    // createLeftPanel(): the two check lists
    for (let i = 0; i < DIALOG_PRINT_GERBVIEW.LAYER_LIST_COUNT; ++i)
      this.m_layerLists.push({ items: [], checked: [] });
  }

  settings(): BOARD_PRINTOUT_SETTINGS {
    return this.m_settings;
  }

  /** `DIALOG_PRINT_GENERIC::ForcePrintBorder`. */
  ForcePrintBorder(aValue: boolean): void {
    this.m_titleBlock = aValue;
    this.m_titleBlockShown = false;
  }

  TransferDataToWindow(): boolean {
    // DIALOG_PRINT_GENERIC::TransferDataToWindow
    const scale = setScaleValue(this.m_settings.m_scale);
    this.m_scaleMode = scale.mode;
    if (scale.text !== undefined) this.m_customScale = scale.text;
    this.m_titleBlock = this.m_settings.m_titleBlock;
    this.m_outputMode = this.m_settings.m_blackWhite ? 1 : 0;

    const images = this.m_parent.GetGerberLayout().GetImagesList();
    let itemIdx = 0;

    // Create layer list
    for (let ii = 0; ii < images.ImagesMaxCount(); ++ii) {
      const listIdx = Math.trunc(itemIdx / DIALOG_PRINT_GERBVIEW.LAYER_PER_LIST);

      if (listIdx >= DIALOG_PRINT_GERBVIEW.LAYER_LIST_COUNT) break; // wxFAIL

      const gbrImage = images.GetGbrImage(ii);

      if (!gbrImage) continue;

      const listBox = this.m_layerLists[listIdx]!;
      listBox.items.push(gbrImage.m_FileName.split(/[\\/]/).pop() ?? '');
      listBox.checked.push(false);

      // listBox->Check( ii, true ): the layer index, not the item's row. A
      // wxCheckListBox ignores an index past its end.
      if (this.m_settings.m_LayerSet.test(ii) && ii < listBox.checked.length)
        listBox.checked[ii] = true;

      this.m_layerToItemMap.set(ii, itemIdx);
      ++itemIdx;
    }

    this.m_checkboxMirror = this.m_settings.m_Mirror;

    return true;
  }

  onSelectAllClick(): void {
    for (const checkbox of this.m_layerLists) DIALOG_PRINT_GERBVIEW.setListBoxValue(checkbox, true);
  }

  onDeselectAllClick(): void {
    for (const checkbox of this.m_layerLists)
      DIALOG_PRINT_GERBVIEW.setListBoxValue(checkbox, false);
  }

  ///< (Un)check all items in a checklist box
  private static setListBoxValue(aList: CHECK_LIST_BOX, aValue: boolean): void {
    for (let i = 0; i < aList.checked.length; ++i) aList.checked[i] = aValue;
  }

  ///< Check whether a layer is enabled in a listbox
  private isLayerEnabled(aLayer: number): boolean {
    const itemNr = this.m_layerToItemMap.get(aLayer);

    if (itemNr === undefined) return false;

    const listIdx = Math.trunc(itemNr / DIALOG_PRINT_GERBVIEW.LAYER_PER_LIST);
    const itemIdx = itemNr % DIALOG_PRINT_GERBVIEW.LAYER_PER_LIST;

    if (listIdx >= DIALOG_PRINT_GERBVIEW.LAYER_LIST_COUNT) return false;

    const listBox = this.m_layerLists[listIdx]!;

    return itemIdx < listBox.checked.length && listBox.checked[itemIdx] === true;
  }

  ///< Update layerset basing on the selected layers
  private setLayerSetFromList(): number {
    this.m_settings.m_LayerSet = new LSET();
    this.m_settings.m_pageCount = 0;
    let layer = 0;

    for (let j = 0; j < DIALOG_PRINT_GERBVIEW.LAYER_LIST_COUNT; ++j) {
      for (let i = 0; i < DIALOG_PRINT_GERBVIEW.LAYER_PER_LIST; ++i) {
        if (this.isLayerEnabled(layer)) {
          this.m_settings.m_LayerSet.set(layer);
          ++this.m_settings.m_pageCount;
        }

        ++layer;
      }
    }

    return this.m_settings.m_pageCount;
  }

  /**
   * `saveSettings()`: the layer set, the mirror, then the generic three. The
   * return is getScaleValue's DisplayInfoMessage when the custom scale had to
   * be corrected, for the page to show.
   */
  saveSettings(): string | null {
    this.setLayerSetFromList();
    this.m_settings.m_Mirror = this.m_checkboxMirror;

    // DIALOG_PRINT_GENERIC::saveSettings
    const scale = getScaleValue(this.m_scaleMode, this.m_customScale);

    if (scale.reset) {
      this.m_scaleMode = scale.reset.mode;
      if (scale.reset.text !== undefined) this.m_customScale = scale.reset.text;
    }

    this.m_settings.m_scale = scale.scale;
    this.m_settings.m_titleBlock = this.m_titleBlock;
    this.m_settings.m_blackWhite = this.m_outputMode === 1;

    return scale.info ?? null;
  }

  /** `createPrintout( aTitle )`: the pages, drawn from the frame's view. */
  createPrintout(aTitle: string): GERBVIEW_PRINTOUT {
    return new GERBVIEW_PRINTOUT(
      this.m_parent.GetGerberLayout(),
      this.m_settings,
      this.m_parent.GetCanvas()!.GetView(),
      aTitle,
    );
  }

  /**
   * `onPrintButtonClick`'s checks (`dialog_print_generic.cpp:272-293`): the
   * error to show, or null when there are pages to print.
   */
  onPrintButtonClick(): { info: string | null; error: string | null } {
    this.m_settings.m_pageCount = 0; // it needs to be set by a derived dialog
    const info = this.saveSettings();

    if (this.m_settings.m_pageCount === 0)
      return { info, error: wxGetTranslation('Nothing to print') };

    return { info, error: null };
  }
}

/**
 * `GERBVIEW_CONTROL::Print` (`:280-290`), which upstream defines in this file:
 * fresh settings on the frame's page and colours, the drawing sheet forced
 * off, the dialog shown modal.
 */
export async function GERBVIEW_CONTROL_Print(
  aFrame: GERBVIEW_FRAME,
  aToolMgr: TOOL_MANAGER,
): Promise<number> {
  // Selection affects the original item visibility
  aToolMgr.RunAction(ACTIONS.selectionClear);

  const settings = new BOARD_PRINTOUT_SETTINGS(aFrame.GetPageSettings());
  settings.m_colorSettings = aFrame.GetColorSettings();

  const dlg = new DIALOG_PRINT_GERBVIEW(aFrame, settings);
  dlg.ForcePrintBorder(false);
  dlg.TransferDataToWindow();

  await aFrame.Host().PrintDialog(dlg);

  return 0;
}

/** DIALOG_PRINT_GERBVIEW's window: createLeftPanel() and createExtraOptions() on DIALOG_PRINT_GENERIC. */
export function DialogPrintGerbview({
  dlg,
  onMessage,
  onPrint,
  onClose,
}: {
  dlg: DIALOG_PRINT_GERBVIEW;
  /** A message the dialog raised; `aIsError` for DisplayError. */
  onMessage: (aMessage: string, aIsError: boolean) => void;
  onPrint: () => void;
  onClose: () => void;
}): JSX.Element {
  const [, setTick] = useState(0);
  const changed = (): void => setTick((t) => t + 1);

  return (
    <DIALOG_PRINT_GENERIC
      blackWhite={dlg.m_outputMode === 1}
      onBlackWhite={(v) => {
        dlg.m_outputMode = v ? 1 : 0;
        changed();
      }}
      titleBlock={dlg.m_titleBlock}
      titleBlockShown={dlg.m_titleBlockShown}
      onTitleBlock={(v) => {
        dlg.m_titleBlock = v;
        changed();
      }}
      scaleMode={dlg.m_scaleMode}
      onScaleMode={(m) => {
        dlg.m_scaleMode = m;
        changed();
      }}
      customScale={dlg.m_customScale}
      onCustomScale={(t) => {
        dlg.m_customScale = t;
        changed();
      }}
      mainSizerInserts={
        // createLeftPanel(): getMainSizer()->Insert( 0, sbLayersSizer, 1, wxEXPAND | wxALL, 5 )
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          <StaticBoxSizer label={wxGetTranslation('Include Layers')} orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bLayerListsSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                {dlg.m_layerLists.map((list, li) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: m_layerLists[i] is fixed, LAYER_LIST_COUNT long
                  <SizerItem key={li} proportion={1} flag={wxEXPAND} border={5}>
                    <CheckListBox
                      items={list.items}
                      checked={list.items.map((_, i) => list.checked[i] === true)}
                      onCheck={(aIndex, aOn) => {
                        list.checked[aIndex] = aOn;
                        changed();
                      }}
                    />
                  </SizerItem>
                ))}
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* buttonSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxALL} border={5}>
                  <Button
                    label={wxGetTranslation('Select all')}
                    onClick={() => {
                      dlg.onSelectAllClick();
                      changed();
                    }}
                  />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL} border={5}>
                  <Button
                    label={wxGetTranslation('Deselect all')}
                    onClick={() => {
                      dlg.onDeselectAllClick();
                      changed();
                    }}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
      }
      optionsSizerAdds={
        // createExtraOptions(): wxGBPosition( rows, 0 ), wxGBSpan( 1, cols ), the base's 2 x 2.
        <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          <CheckBox
            label={wxGetTranslation('Print mirrored')}
            check={{
              value: dlg.m_checkboxMirror,
              onChange: (aOn) => {
                dlg.m_checkboxMirror = aOn;
                changed();
              },
            }}
          />
        </SizerItem>
      }
      onPrint={() => {
        const { info, error } = dlg.onPrintButtonClick();
        changed();
        if (info !== null) onMessage(info, false);
        if (error !== null) {
          onMessage(error, true);
          return;
        }
        onPrint();
      }}
      onClose={() => {
        const info = dlg.saveSettings();
        if (info !== null) onMessage(info, false);
        onClose();
      }}
    />
  );
}
