// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::OpenProjectFiles` (files.cpp:906-908): once the board is
 * up and its nets are known, `LoadProjectSettings()` and `LoadDrawingSheet()`
 * read the project's `.kicad_prl` into the frame. A later reload of the same
 * files (Board Setup's OK, another session) does not: nothing upstream
 * re-reads local settings then.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { PCB_RENDER_SETTINGS } from '@ziroeda/pcbnew/pcb_painter.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6)) (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "GND") (net 2 "VCC"))
`;

const PRO = JSON.stringify({ meta: { filename: 'x.kicad_pro', version: 3 } });
const PRL = JSON.stringify({
  meta: { filename: 'x.kicad_prl', version: 5 },
  board: {
    opacity: { tracks: 0.25, zones: 0.75 },
    hidden_nets: ['GND'],
    visible_items: [],
  },
});

function frameOnBoard(): { frame: PCB_EDIT_FRAME; render: PCB_RENDER_SETTINGS } {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  const frame = new PCB_EDIT_FRAME({
    settings: () => new PCBNEW_SETTINGS(),
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    createDrcDialog: () => {
      throw new Error('no DRC dialog here');
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    schematicNetlistText: () => null,
    projectText: () => null,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
    syncSelection: () => {},
    editZoneParams: () => {},
    selectCopperLayerPair: () => {},
    updatePcbFromSchematic: () => {},
  });
  frame.SetBoard(ParseBoard(BOARD, '/p/x.kicad_pcb'), false);
  frame.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  const render = new PCB_RENDER_SETTINGS();
  const view = {
    GetPainter: () => ({ GetSettings: () => render }),
    UpdateDisplayOptions: () => {},
    SetMirror: () => {},
    IsMirroredY: () => false,
    RecacheAllItems: () => {},
    UpdateAllItemsConditionally: () => {},
    SetLayerVisible: () => {},
    UpdateAllItems: () => {},
  };
  frame.SetCanvas({
    GetView: () => view,
    SetHighContrastLayer: () => {},
    Refresh: () => {},
    ForceRefresh: () => {},
    GetGAL: () => ({}),
  } as unknown as PCB_DRAW_PANEL_GAL);
  return { frame, render };
}

const FILES = [
  { name: 'x.kicad_pro', text: PRO },
  { name: 'x.kicad_prl', text: PRL },
];

afterEach(() => SetPgm(null));

describe('PCB_EDIT_FRAME::SyncProjectSettingsIntoBoard, the open path', () => {
  it('loads the .kicad_prl into the frame after the board is bound', () => {
    const { frame, render } = frameOnBoard();
    frame.SyncProjectSettingsIntoBoard(FILES, 'x', false, '/p');
    const o = frame.GetDisplayOptions();
    expect(o.m_TrackOpacity).toBe(0.25);
    expect(o.m_ZoneOpacity).toBe(0.75);
    expect(o.m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.NORMAL);
    const gnd = frame.GetBoard()!.GetNetInfo().GetNetItem('GND')!.GetNetCode();
    expect([...render.GetHiddenNets()]).toEqual([gnd]);
  });

  it('a reload for Board Setup does not re-read local settings', () => {
    const { frame, render } = frameOnBoard();
    frame.SyncProjectSettingsIntoBoard(FILES, 'x', true, '/p');
    expect(frame.GetDisplayOptions().m_TrackOpacity).toBe(1);
    expect(render.GetHiddenNets().size).toBe(0);
  });

  it("reads the project's drawing sheet from the project files", () => {
    const { frame } = frameOnBoard();
    const wks = `(kicad_wks (version 20220228) (generator "pl_editor")
  (setup (textsize 1.5 1.5) (linewidth 0.15) (textlinewidth 0.15)
    (left_margin 37) (right_margin 11) (top_margin 12) (bottom_margin 13)))`;
    const fs = new MEMORY_FILESYSTEM();
    fs.Write('mine.kicad_wks', new Uint8Array());
    const unmount = wxMountFileSystem('/p', fs);
    try {
      const pro = JSON.stringify({ pcbnew: { page_layout_descr_file: 'mine.kicad_wks' } });
      frame.SyncProjectSettingsIntoBoard(
        [
          { name: 'x.kicad_pro', text: pro },
          { name: 'mine.kicad_wks', text: wks },
        ],
        'x',
        false,
        '/p',
      );
      expect(DS_DATA_MODEL.GetTheInstance().GetLeftMargin()).toBe(37);
    } finally {
      unmount();
      DS_DATA_MODEL.GetTheInstance().SetDefaultLayout();
    }
  });
});
