// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCBNEW_PRINTOUT (`pcbnew/pcbnew_printout.cpp`) and DIALOG_PRINT_PCBNEW
 * (`pcbnew/dialogs/dialog_print_pcbnew.cpp`) on a live board: the layers each
 * page carries, and what the dialog makes of its controls.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  type DIALOG_PRINT_PCBNEW,
  PRINT_LAYER_MENU,
} from '@ziroeda/pcbnew/dialogs/dialog_print_pcbnew.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DRILL_MARKS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import {
  PAGINATION_T,
  PCBNEW_PRINTOUT,
  PCBNEW_PRINTOUT_SETTINGS,
} from '@ziroeda/pcbnew/pcbnew_printout.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (31 "F.CrtYd" user "F.Courtyard") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
)`;

/** A printout whose DrawPage records the page instead of drawing it. */
class RECORDING_PRINTOUT extends PCBNEW_PRINTOUT {
  pages: { name: string; layers: string[] }[] = [];

  constructor(
    aBoard: BOARD,
    private readonly m_params: PCBNEW_PRINTOUT_SETTINGS,
  ) {
    super(aBoard, m_params, null as unknown as VIEW, 'Print');
  }

  override DrawPage(aLayerName = ''): void {
    this.pages.push({
      name: aLayerName,
      layers: this.m_params.m_LayerSet.Seq().map((l) => LSET.Name(l)),
    });
  }
}

let board: BOARD;
let settings: PCBNEW_SETTINGS;
let frame: PCB_EDIT_FRAME;
let shown: DIALOG_PRINT_PCBNEW[];

beforeEach(() => {
  installPgm();
  settings = new PCBNEW_SETTINGS();
  shown = [];
  frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    showPrintDialog: (aDlg: DIALOG_PRINT_PCBNEW) => {
      shown.push(aDlg);
      return Promise.resolve();
    },
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  board = ParseBoard(BOARD_TEXT);
  frame.SetBoard(board, false);
});

const printoutSettings = (aLayers: PCB_LAYER_ID[], aPagination: PAGINATION_T, aEdges = true) => {
  const s = new PCBNEW_PRINTOUT_SETTINGS(board.GetPageSettings());
  s.m_LayerSet = new LSET(aLayers);
  s.m_Pagination = aPagination;
  s.m_PrintEdgeCutsOnAllPages = aEdges;
  return s;
};

describe('PCBNEW_PRINTOUT::OnPrintPage', () => {
  const layers = [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.F_SilkS];

  it('prints every layer on one page, Edge.Cuts added, as "Multiple Layers"', () => {
    const s = printoutSettings(layers, PAGINATION_T.ALL_LAYERS);
    const p = new RECORDING_PRINTOUT(board, s);

    expect(p.OnPrintPage(1)).toBe(true);
    expect(p.pages).toEqual([
      { name: 'Multiple Layers', layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'Edge.Cuts'] },
    ]);
    // The original set is restored for the next page.
    expect(s.m_LayerSet.Seq().map((l) => LSET.Name(l))).toEqual(['F.Cu', 'B.Cu', 'F.SilkS']);
  });

  it('prints one layer per page in UI order, named by the board', () => {
    const p = new RECORDING_PRINTOUT(board, printoutSettings(layers, PAGINATION_T.LAYER_PER_PAGE));

    for (const page of [1, 2, 3]) p.OnPrintPage(page);

    expect(p.pages).toEqual([
      { name: 'F.Cu', layers: ['F.Cu', 'Edge.Cuts'] },
      { name: 'B.Cu', layers: ['B.Cu', 'Edge.Cuts'] },
      // GetLayerName: the user name the board gives the layer.
      { name: 'F.Silkscreen', layers: ['F.SilkS', 'Edge.Cuts'] },
    ]);
  });

  it('leaves Edge.Cuts off a page when not asked for it', () => {
    const p = new RECORDING_PRINTOUT(
      board,
      printoutSettings(layers, PAGINATION_T.LAYER_PER_PAGE, false),
    );
    p.OnPrintPage(2);
    expect(p.pages).toEqual([{ name: 'B.Cu', layers: ['B.Cu'] }]);
  });

  it('prints nothing for an empty layer set', () => {
    const p = new RECORDING_PRINTOUT(board, printoutSettings([], PAGINATION_T.ALL_LAYERS));
    expect(p.OnPrintPage(1)).toBe(false);
    expect(p.pages).toEqual([]);
  });
});

describe('PCB_CONTROL::Print and DIALOG_PRINT_PCBNEW', () => {
  async function open(): Promise<DIALOG_PRINT_PCBNEW> {
    frame.GetToolManager()!.RunAction(ACTIONS.print);
    await Promise.resolve();
    return shown.at(-1)!;
  }

  it('lists the enabled layers by name and checks the saved ones', async () => {
    settings.m_Printing.layers = [PCB_LAYER_ID.B_Cu];
    const dlg = await open();

    // BOARD_DESIGN_SETTINGS::SetEnabledLayers (:1634) always enables both
    // courtyards, Edge.Cuts and Margin, whatever the file lists.
    expect(dlg.m_layerNames).toEqual([
      'F.Cu',
      'B.Cu',
      'F.Silkscreen',
      'Edge.Cuts',
      'Margin',
      'F.Courtyard',
      'B.Courtyard',
    ]);
    expect(dlg.m_layerChecked).toEqual([false, true, false, false, false, false, false]);
  });

  it('"Select Fab Layers" is copper and technical layers without the courtyards', async () => {
    const dlg = await open();
    dlg.onPopUpLayers(PRINT_LAYER_MENU.ID_SELECT_FAB_LAYERS);

    // Edge.Cuts and Margin are user layers, not technical ones.
    expect(dlg.m_layerChecked).toEqual([true, true, true, false, false, false, false]);
  });

  it('counts one page for everything, or one per layer', async () => {
    const dlg = await open();
    dlg.onPopUpLayers(PRINT_LAYER_MENU.ID_SELECT_COPPER_LAYERS);

    dlg.m_checkboxPagePerLayer = false;
    expect(dlg.onPrintButtonClick().error).toBeNull();
    expect(dlg.settings().m_pageCount).toBe(1);

    dlg.m_checkboxPagePerLayer = true;
    dlg.onPrintButtonClick();
    expect(dlg.settings().m_pageCount).toBe(2);
  });

  it('says "Nothing to print" with no layer checked', async () => {
    const dlg = await open();
    dlg.onPopUpLayers(PRINT_LAYER_MENU.ID_DESELECT_ALL_LAYERS);
    expect(dlg.onPrintButtonClick().error).toBe('Nothing to print');
  });

  it('saves its controls into printing.* on the way out', async () => {
    const dlg = await open();
    dlg.onPopUpLayers(PRINT_LAYER_MENU.ID_SELECT_COPPER_LAYERS);
    dlg.m_drillMarksChoice = DRILL_MARKS.FULL_DRILL_SHAPE;
    dlg.m_checkboxMirror = true;
    dlg.m_checkboxPagePerLayer = true;
    dlg.saveSettings();

    expect(settings.m_Printing.layers).toEqual([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]);
    expect(settings.m_Printing.drill_marks).toBe(DRILL_MARKS.FULL_DRILL_SHAPE);
    expect(settings.m_Printing.mirror).toBe(true);
    expect(settings.m_Printing.pagination).toBe(PAGINATION_T.LAYER_PER_PAGE);
  });

  it('"Print board edges on all pages" only applies to one page per layer', async () => {
    settings.m_Printing.edge_cuts_on_all_pages = true;
    settings.m_Printing.pagination = PAGINATION_T.ALL_LAYERS;
    const dlg = await open();

    // onPagePerLayerClicked: disabled and cleared...
    expect([dlg.m_checkboxEdgesOnAllPagesEnabled, dlg.m_checkboxEdgesOnAllPages]).toEqual([
      false,
      false,
    ]);

    // ...and restored from the stored value when re-enabled.
    dlg.m_checkboxPagePerLayer = true;
    dlg.onPagePerLayerClicked();
    expect([dlg.m_checkboxEdgesOnAllPagesEnabled, dlg.m_checkboxEdgesOnAllPages]).toEqual([
      true,
      true,
    ]);

    // Unchecking "one page per layer" clears it again.
    dlg.m_checkboxPagePerLayer = false;
    dlg.onPagePerLayerClicked();
    expect([dlg.m_checkboxEdgesOnAllPagesEnabled, dlg.m_checkboxEdgesOnAllPages]).toEqual([
      false,
      false,
    ]);
  });

  it('Black and white disables the colour-only options', async () => {
    settings.m_Printing.use_theme = true;
    const dlg = await open();

    dlg.m_outputMode = 0;
    dlg.onColorModeClicked();
    expect([dlg.m_checkBackgroundEnabled, dlg.m_colorThemeEnabled]).toEqual([true, true]);

    dlg.m_outputMode = 1;
    dlg.onColorModeClicked();
    expect([dlg.m_checkBackgroundEnabled, dlg.m_colorThemeEnabled]).toEqual([false, false]);
  });
});
