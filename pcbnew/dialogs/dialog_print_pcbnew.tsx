// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/dialogs/dialog_print_pcbnew.cpp`: DIALOG_PRINT_PCBNEW, the controls'
 * state and the transfers both ways over the DIALOG_PRINT_GENERIC state it
 * derives (`common/dialogs/dialog_print_generic.cpp`), and PCB_CONTROL::Print,
 * which upstream defines in this file. `dialog_print_pcbnew.tsx` draws it
 * through the shared `DIALOG_PRINT_GENERIC` view; the pages are PCBNEW_PRINTOUT's.
 */

import { type JSX, useState } from 'react';
import { DIALOG_PRINT_GENERIC } from '@ziroeda/common/dialogs/dialog_print_generic.js';
import { CheckListBox } from '@ziroeda/wx/checklst.js';
import { CheckBox, Choice, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { ContextMenu } from '@ziroeda/wx/menu_ui.js';
import { SizerItem, StaticBoxSizer } from '@ziroeda/wx/sizer.js';
import {
  getScaleValue,
  type PrintScaleMode,
  setScaleValue,
} from '@ziroeda/common/dialogs/dialog_print_generic.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { DRILL_MARKS } from '../pcb_plot_params.js';
import { PAGINATION_T, PCBNEW_PRINTOUT, PCBNEW_PRINTOUT_SETTINGS } from '../pcbnew_printout.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `onPopUpLayers`' menu ids. */
export enum PRINT_LAYER_MENU {
  ID_SELECT_FAB_LAYERS = 4100,
  ID_SELECT_COPPER_LAYERS,
  ID_DESELECT_COPPER_LAYERS,
  ID_SELECT_ALL_LAYERS,
  ID_DESELECT_ALL_LAYERS,
}

/** `m_popMenu`'s items, in order. */
export const PRINT_LAYER_MENU_ITEMS: readonly { id: PRINT_LAYER_MENU; label: string }[] = [
  { id: PRINT_LAYER_MENU.ID_SELECT_FAB_LAYERS, label: _HKI('Select Fab Layers') },
  { id: PRINT_LAYER_MENU.ID_SELECT_COPPER_LAYERS, label: _HKI('Select all Copper Layers') },
  { id: PRINT_LAYER_MENU.ID_DESELECT_COPPER_LAYERS, label: _HKI('Deselect all Copper Layers') },
  { id: PRINT_LAYER_MENU.ID_SELECT_ALL_LAYERS, label: _HKI('Select all Layers') },
  { id: PRINT_LAYER_MENU.ID_DESELECT_ALL_LAYERS, label: _HKI('Deselect all Layers') },
];

export class DIALOG_PRINT_PCBNEW {
  private readonly m_parent: PCB_BASE_EDIT_FRAME;
  private readonly m_settings: PCBNEW_PRINTOUT_SETTINGS;

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

  // ---- DIALOG_PRINT_PCBNEW's extra widgets --------------------------------
  /// List to hold CheckListBox layer numbers
  m_layerList: LSEQ = [];
  /** `m_layerCheckListBox`: one row per `m_layerList` entry. */
  m_layerNames: string[] = [];
  m_layerChecked: boolean[] = [];
  m_checkboxMirror = false;
  m_drillMarksChoice = 0;
  m_checkboxPagePerLayer = false;
  m_checkboxEdgesOnAllPages = false;
  m_checkboxEdgesOnAllPagesEnabled = false;
  m_checkAsItems = false;
  m_checkBackground = false;
  m_checkBackgroundEnabled = true;
  m_checkUseTheme = false;
  m_checkUseThemeEnabled = true;
  /** `m_colorTheme`: the themes, the selection, and whether it is enabled. */
  m_colorThemes: COLOR_SETTINGS[] = [];
  m_colorThemeSelection = 0;
  m_colorThemeEnabled = true;

  constructor(aParent: PCB_BASE_EDIT_FRAME, aSettings: PCBNEW_PRINTOUT_SETTINGS) {
    this.m_parent = aParent;
    this.m_settings = aSettings;

    const board = this.m_parent.GetBoard()!;

    // Create layer list
    // Could devote a PlotOrder() function in place of UIOrder().
    this.m_layerList = board.GetEnabledLayers().UIOrder();

    // Populate the check list box by all enabled layers names. They will be enabled later
    // when the dlg settings are loaded (i.e. after DIALOG_PRINT_GENERIC::TransferDataToWindow()
    // is called
    for (const layer of this.m_layerList) {
      this.m_layerNames.push(board.GetLayerName(layer));
      this.m_layerChecked.push(false);
    }
  }

  settings(): PCBNEW_PRINTOUT_SETTINGS {
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

    const board = this.m_parent.GetBoard()!;

    // Enable layers from previous dlg settings
    this.m_layerList = board.GetEnabledLayers().UIOrder();
    let choice_ly_id = 0;

    for (const layer of this.m_layerList) {
      if (this.m_settings.m_LayerSet.test(layer)) this.m_layerChecked[choice_ly_id] = true;

      choice_ly_id++;
    }

    this.m_checkAsItems = this.m_settings.m_AsItemCheckboxes;
    this.m_checkboxMirror = this.m_settings.m_Mirror;
    this.m_titleBlock = this.m_settings.m_titleBlock;

    const cfg = this.m_parent.GetPcbNewSettings();

    this.m_checkBackground = cfg.m_Printing.background;
    this.m_checkUseTheme = cfg.m_Printing.use_theme;

    const target = cfg.m_Printing.use_theme ? cfg.m_Printing.color_theme : cfg.m_ColorTheme;

    this.m_colorThemes = Pgm().GetSettingsManager().GetColorSettingsList();
    this.m_colorThemeSelection = 0;

    this.m_colorThemes.forEach((settings, pos) => {
      if (settings.GetFilename() === target) this.m_colorThemeSelection = pos;
    });

    this.onColorModeClicked();

    // Options to plot pads and vias holes
    this.m_drillMarksChoice = this.m_settings.m_DrillMarks;

    // Print all layers one one page or separately
    this.m_checkboxPagePerLayer = this.m_settings.m_Pagination === PAGINATION_T.LAYER_PER_PAGE;
    this.onPagePerLayerClicked();

    return true;
  }

  onUseThemeClicked(): void {
    this.m_colorThemeEnabled = this.m_checkUseTheme;
  }

  onPagePerLayerClicked(): void {
    if (this.m_checkboxPagePerLayer) {
      this.m_checkboxEdgesOnAllPagesEnabled = true;
      this.m_checkboxEdgesOnAllPages = this.m_settings.m_PrintEdgeCutsOnAllPages;
    } else {
      this.m_checkboxEdgesOnAllPagesEnabled = false;
      this.m_checkboxEdgesOnAllPages = false;
    }
  }

  onColorModeClicked(): void {
    this.m_settings.m_blackWhite = this.m_outputMode !== 0;

    this.m_checkBackgroundEnabled = !this.m_settings.m_blackWhite;
    this.m_checkUseThemeEnabled = !this.m_settings.m_blackWhite;

    const cfg = this.m_parent.GetPcbNewSettings();
    this.m_colorThemeEnabled = !this.m_settings.m_blackWhite && cfg.m_Printing.use_theme;
  }

  // Select or deselect groups of layers in the layers list:
  onPopUpLayers(aId: PRINT_LAYER_MENU): void {
    // Build a list of layers for usual fabrication: copper layers + tech layers without courtyard
    const fab_layer_set = LSET.AllCuMask()
      .or(LSET.AllTechMask())
      .and(new LSET([PCB_LAYER_ID.B_CrtYd, PCB_LAYER_ID.F_CrtYd]).not());

    switch (aId) {
      case PRINT_LAYER_MENU.ID_SELECT_FAB_LAYERS: // Select layers usually needed to build a board
        for (let i = 0; i < this.m_layerList.length; i++) {
          const layermask = new LSET([this.m_layerList[i]!]);

          this.m_layerChecked[i] = layermask.and(fab_layer_set).any();
        }

        break;

      case PRINT_LAYER_MENU.ID_SELECT_COPPER_LAYERS:
        for (let i = 0; i < this.m_layerList.length; i++) {
          if (IsCopperLayer(this.m_layerList[i]!)) this.m_layerChecked[i] = true;
        }

        break;

      case PRINT_LAYER_MENU.ID_DESELECT_COPPER_LAYERS:
        for (let i = 0; i < this.m_layerList.length; i++) {
          if (IsCopperLayer(this.m_layerList[i]!)) this.m_layerChecked[i] = false;
        }

        break;

      case PRINT_LAYER_MENU.ID_SELECT_ALL_LAYERS:
        for (let i = 0; i < this.m_layerList.length; i++) this.m_layerChecked[i] = true;

        break;

      case PRINT_LAYER_MENU.ID_DESELECT_ALL_LAYERS:
        for (let i = 0; i < this.m_layerList.length; i++) this.m_layerChecked[i] = false;

        break;
    }
  }

  ///< Update layerset basing on the selected layers.
  private setLayerSetFromList(): number {
    this.m_settings.m_LayerSet = new LSET();
    let pageCount = 0;

    for (let i = 0; i < this.m_layerList.length; i++) {
      if (this.m_layerChecked[i]) {
        ++pageCount;
        this.m_settings.m_LayerSet.set(this.m_layerList[i]!);
      }
    }

    // In Pcbnew force the EDGE layer to be printed or not with the other layers
    this.m_settings.m_PrintEdgeCutsOnAllPages = this.m_checkboxEdgesOnAllPages;

    // All layers on one page (only if there is at least one layer selected)
    if (!this.m_checkboxPagePerLayer && pageCount > 0) pageCount = 1;

    this.m_settings.m_pageCount = pageCount;

    return pageCount;
  }

  /**
   * `saveSettings()`: the layer set and options, the colour theme, the generic
   * three, then `Save( cfg )`. The return is getScaleValue's DisplayInfoMessage
   * when the custom scale had to be corrected, for the page to show.
   */
  saveSettings(): string | null {
    this.setLayerSetFromList();

    this.m_settings.m_AsItemCheckboxes = this.m_checkAsItems;

    this.m_settings.m_DrillMarks = this.m_drillMarksChoice as DRILL_MARKS;

    if (this.m_checkboxPagePerLayer) {
      this.m_settings.m_Pagination = PAGINATION_T.LAYER_PER_PAGE;
      this.m_settings.m_PrintEdgeCutsOnAllPages = this.m_checkboxEdgesOnAllPages;
    } else {
      this.m_settings.m_Pagination = PAGINATION_T.ALL_LAYERS;
    }

    this.m_settings.m_Mirror = this.m_checkboxMirror;

    const cfg = this.m_parent.GetPcbNewSettings();

    cfg.m_Printing.background = this.m_checkBackground;
    this.m_settings.m_background = cfg.m_Printing.background;
    cfg.m_Printing.use_theme = this.m_checkUseTheme;

    const sel = this.m_colorThemeSelection;
    let theme: COLOR_SETTINGS | null = null;

    if (sel >= 0 && sel < this.m_colorThemes.length) theme = this.m_colorThemes[sel]!;

    if (theme && this.m_checkUseTheme) {
      cfg.m_Printing.color_theme = theme.GetFilename();
      this.m_settings.m_colorSettings = theme;
    } else {
      this.m_settings.m_colorSettings = this.m_parent.GetColorSettings();
    }

    // DIALOG_PRINT_GENERIC::saveSettings
    const scale = getScaleValue(this.m_scaleMode, this.m_customScale);

    if (scale.reset) {
      this.m_scaleMode = scale.reset.mode;
      if (scale.reset.text !== undefined) this.m_customScale = scale.reset.text;
    }

    this.m_settings.m_scale = scale.scale;
    this.m_settings.m_titleBlock = this.m_titleBlock;
    this.m_settings.m_blackWhite = this.m_outputMode === 1;

    this.m_settings.Save(cfg);

    return scale.info ?? null;
  }

  /** `createPrintout( aTitle )`: the pages, drawn from the frame's view. */
  createPrintout(aTitle: string): PCBNEW_PRINTOUT {
    return new PCBNEW_PRINTOUT(
      this.m_parent.GetBoard()!,
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

/** The frame the print dialog needs: the board editor's, or the footprint editor's. */
export interface PRINT_FRAME_HOST {
  /** `dlg.ShowModal()`. */
  ShowPrintDialog(aDlg: DIALOG_PRINT_PCBNEW): Promise<void>;
}

/** `PCB_CONTROL::Print` (`dialog_print_pcbnew.cpp:463-483`). */
export async function PCB_CONTROL_Print(
  aFrame: PCB_BASE_EDIT_FRAME & PRINT_FRAME_HOST,
  aToolMgr: TOOL_MANAGER,
): Promise<number> {
  // Selection affects the origin item visibility
  aToolMgr.RunAction(ACTIONS.selectionClear);

  const settings = new PCBNEW_PRINTOUT_SETTINGS(aFrame.GetPageSettings());

  // Load saved settings
  const cfg = aFrame.GetPcbNewSettings();
  settings.Load(cfg);

  const dlg = new DIALOG_PRINT_PCBNEW(aFrame, settings);

  if (aFrame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR)) dlg.ForcePrintBorder(false);

  dlg.TransferDataToWindow();

  await aFrame.ShowPrintDialog(dlg);

  return 0;
}

/** DIALOG_PRINT_PCBNEW's window: createLeftPanel() and createExtraOptions() on DIALOG_PRINT_GENERIC. */
export function DialogPcbPrint({
  dlg,
  onMessage,
  onPrint,
  onClose,
}: {
  dlg: DIALOG_PRINT_PCBNEW;
  /** A message the dialog raised; `aIsError` for DisplayError. */
  onMessage: (aMessage: string, aIsError: boolean) => void;
  onPrint: () => void;
  onClose: () => void;
}): JSX.Element {
  const [, setTick] = useState(0);
  const changed = (): void => setTick((t) => t + 1);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const check = (aGet: () => boolean, aSet: (aOn: boolean) => void, aEnabled = true) => ({
    value: aGet(),
    enabled: aEnabled,
    onChange: (aOn: boolean) => {
      aSet(aOn);
      changed();
    },
  });

  // createExtraOptions(): `rows = optionsSizer->GetEffectiveRowsCount()`, the base's two.
  const ROW_AS_ITEMS = 2;
  const ROW_DRILL_MARKS = 7; // after the theme row, `rows++` leaves one empty

  return (
    <>
      <DIALOG_PRINT_GENERIC
        blackWhite={dlg.m_outputMode === 1}
        onBlackWhite={(v) => {
          dlg.m_outputMode = v ? 1 : 0;
          dlg.onColorModeClicked();
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
        infoText={wxGetTranslation('Right-click for layer selection commands.')}
        mainSizerInserts={
          // createLeftPanel(): getMainSizer()->Insert( 0, sbLayersSizer, 1, wxEXPAND | wxALL, 5 )
          <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
            <StaticBoxSizer label={wxGetTranslation('Include Layers')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
                <CheckListBox
                  items={dlg.m_layerNames}
                  checked={dlg.m_layerNames.map((_, i) => dlg.m_layerChecked[i] === true)}
                  onCheck={(aIndex, aOn) => {
                    dlg.m_layerChecked[aIndex] = aOn;
                    changed();
                  }}
                  onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY })}
                  ariaLabel={wxGetTranslation('Include Layers')}
                />
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        }
        optionsSizerAdds={
          <>
            <SizerItem
              pos={[ROW_AS_ITEMS, 0]}
              span={[1, 2]}
              flag={wxLEFT | wxRIGHT | wxBOTTOM}
              border={5}
            >
              <CheckBox
                label={wxGetTranslation('Print according to objects tab of appearance manager')}
                check={check(
                  () => dlg.m_checkAsItems,
                  (aOn) => {
                    dlg.m_checkAsItems = aOn;
                  },
                )}
              />
            </SizerItem>
            <SizerItem
              pos={[ROW_AS_ITEMS + 1, 0]}
              span={[1, 2]}
              flag={wxLEFT | wxRIGHT | wxBOTTOM}
              border={5}
            >
              <CheckBox
                label={wxGetTranslation('Print background color')}
                check={check(
                  () => dlg.m_checkBackground,
                  (aOn) => {
                    dlg.m_checkBackground = aOn;
                  },
                  dlg.m_checkBackgroundEnabled,
                )}
              />
            </SizerItem>
            <SizerItem pos={[ROW_AS_ITEMS + 2, 0]} span={[1, 2]} flag={wxLEFT | wxRIGHT} border={5}>
              <CheckBox
                label={wxGetTranslation('Use a different color theme for printing:')}
                check={check(
                  () => dlg.m_checkUseTheme,
                  (aOn) => {
                    dlg.m_checkUseTheme = aOn;
                    dlg.onUseThemeClicked();
                  },
                  dlg.m_checkUseThemeEnabled,
                )}
              />
            </SizerItem>
            <SizerItem
              pos={[ROW_AS_ITEMS + 3, 0]}
              span={[1, 2]}
              flag={wxLEFT}
              border={28}
              minSize={[200, -1]}
            >
              <Choice
                choices={dlg.m_colorThemes.map((t) => t.GetName())}
                choice={{
                  value: dlg.m_colorThemeSelection,
                  enabled: dlg.m_colorThemeEnabled,
                  onChange: (aIndex) => {
                    dlg.m_colorThemeSelection = aIndex;
                    changed();
                  },
                }}
                ariaLabel={wxGetTranslation('Color theme')}
              />
            </SizerItem>
            <SizerItem
              pos={[ROW_DRILL_MARKS, 0]}
              flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT | wxBOTTOM}
              border={5}
            >
              <StaticText label={wxGetTranslation('Drill marks:')} />
            </SizerItem>
            <SizerItem
              pos={[ROW_DRILL_MARKS, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxBOTTOM}
              border={5}
            >
              <Choice
                choices={[
                  wxGetTranslation('No drill mark'),
                  wxGetTranslation('Small mark'),
                  wxGetTranslation('Real drill'),
                ]}
                choice={{
                  value: dlg.m_drillMarksChoice,
                  onChange: (aIndex) => {
                    dlg.m_drillMarksChoice = aIndex;
                    changed();
                  },
                }}
                ariaLabel={wxGetTranslation('Drill marks')}
              />
            </SizerItem>
            <SizerItem
              pos={[ROW_DRILL_MARKS + 1, 0]}
              span={[1, 2]}
              flag={wxLEFT | wxRIGHT | wxBOTTOM}
              border={5}
            >
              <CheckBox
                label={wxGetTranslation('Print mirrored')}
                check={check(
                  () => dlg.m_checkboxMirror,
                  (aOn) => {
                    dlg.m_checkboxMirror = aOn;
                  },
                )}
              />
            </SizerItem>
            <SizerItem
              pos={[ROW_DRILL_MARKS + 2, 0]}
              span={[1, 2]}
              flag={wxLEFT | wxRIGHT}
              border={5}
            >
              <CheckBox
                label={wxGetTranslation('Print one page per layer')}
                check={check(
                  () => dlg.m_checkboxPagePerLayer,
                  (aOn) => {
                    dlg.m_checkboxPagePerLayer = aOn;
                    dlg.onPagePerLayerClicked();
                  },
                )}
              />
            </SizerItem>
            <SizerItem pos={[ROW_DRILL_MARKS + 3, 0]} span={[1, 2]} flag={wxLEFT} border={28}>
              <CheckBox
                label={wxGetTranslation('Print board edges on all pages')}
                check={check(
                  () => dlg.m_checkboxEdgesOnAllPages,
                  (aOn) => {
                    dlg.m_checkboxEdgesOnAllPages = aOn;
                  },
                  dlg.m_checkboxEdgesOnAllPagesEnabled,
                )}
              />
            </SizerItem>
          </>
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
          // onCancelButtonClick / onClose: saveSettings first.
          const info = dlg.saveSettings();
          if (info !== null) onMessage(info, false);
          onClose();
        }}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={PRINT_LAYER_MENU_ITEMS.map((item) => ({
            label: item.label,
            action: () => {
              dlg.onPopUpLayers(item.id);
              setMenu(null);
              changed();
            },
          }))}
        />
      )}
    </>
  );
}
