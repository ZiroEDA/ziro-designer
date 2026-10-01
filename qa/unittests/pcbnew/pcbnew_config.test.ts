// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbnew_config.cpp`: `PCB_EDIT_FRAME::LoadProjectSettings`,
 * `SaveProjectLocalSettings`, `saveProjectSettings` and `LoadDrawingSheet`,
 * run on a real frame, board, project and settings manager. Only the canvas
 * (a painter's render settings behind a recording view) and the two docked
 * widgets are doubles.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import {
  HIGH_CONTRAST_MODE,
  type LAYER_PRESET,
  NET_COLOR_MODE,
  PCB_SELECTION_FILTER_OPTIONS,
  type VIEWPORT,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import type { APPEARANCE_CONTROLS_LIKE } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_DISPLAY_OPTIONS, PCB_RENDER_SETTINGS } from '@ziroeda/pcbnew/pcb_painter.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { IsUnspecifiedColor, NetColorAssignmentsToCodes } from '@ziroeda/pcbnew/pcbnew_config.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (net 3 "SIG")
)
`;

const PRO = '/p/x.kicad_pro';

const WKS = `(kicad_wks (version 20220228) (generator "pl_editor")
  (setup (textsize 1.5 1.5) (linewidth 0.15) (textlinewidth 0.15)
    (left_margin 10) (right_margin 10) (top_margin 10) (bottom_margin 10)))
`;

interface Env {
  frame: PCB_EDIT_FRAME;
  manager: SETTINGS_MANAGER;
  render: PCB_RENDER_SETTINGS;
  errors: string[];
  panel: {
    layerPresets: LAYER_PRESET[] | null;
    viewports: VIEWPORT[] | null;
    filter: PCB_SELECTION_FILTER_OPTIONS | null;
    active: string;
    userPresets: LAYER_PRESET[];
    userViewports: VIEWPORT[];
  };
}

function setup(aPro: JsonValue | null = {}, aPrl: JsonValue | null = null): Env {
  const manager = new SETTINGS_MANAGER();
  // PGM_BASE's constructor loads the null project; the real one comes after.
  SetPgm(new PGM_BASE(null, manager));
  manager.LoadProject(PRO, aPro, aPrl);

  const errors: string[] = [];
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
    showInfoBarError: (aMsg: string) => errors.push(aMsg),
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
  };
  frame.SetCanvas({
    GetView: () => view,
    SetHighContrastLayer: () => {},
    Refresh: () => {},
  } as unknown as PCB_DRAW_PANEL_GAL);

  const panel: Env['panel'] = {
    layerPresets: null,
    viewports: null,
    filter: null,
    active: '',
    userPresets: [],
    userViewports: [],
  };
  const appearance: APPEARANCE_CONTROLS_LIKE = {
    GetUserLayerPresets: () => panel.userPresets,
    SetUserLayerPresets: (p) => {
      panel.layerPresets = p;
    },
    GetActiveLayerPreset: () => panel.active,
    GetUserViewports: () => panel.userViewports,
    SetUserViewports: (v) => {
      panel.viewports = v;
    },
  };
  frame.m_appearancePanel = appearance;
  frame.m_selectionFilterPanel = {
    SetCheckboxesFromFilter: (o) => {
      panel.filter = Object.assign(new PCB_SELECTION_FILTER_OPTIONS(), o);
    },
  };

  return { frame, manager, render, errors, panel };
}

const colour = (r: number, g: number, b: number): Color4d => ({ r, g, b, a: 1 });

beforeEach(() => {
  BASE_SCREEN.m_DrawingSheetFileName = '';
});
afterEach(() => SetPgm(null));

describe('NetColorAssignmentsToCodes (pcbnew_config.cpp:95-105)', () => {
  it('maps a named net to its code and drops UNSPECIFIED and unknown names', () => {
    const { frame } = setup();
    const nets = frame.GetBoard()!.GetNetInfo();
    const out = NetColorAssignmentsToCodes(
      nets,
      [
        ['VCC', colour(1, 0, 0)],
        ['GND', COLOR4D_UNSPECIFIED],
        ['NOSUCH', colour(0, 1, 0)],
      ],
      IsUnspecifiedColor,
    );
    expect([...out.keys()]).toEqual([nets.GetNetItem('VCC')!.GetNetCode()]);
  });

  it('IsUnspecifiedColor is the alpha-0 sentinel, not black', () => {
    expect(IsUnspecifiedColor(COLOR4D_UNSPECIFIED)).toBe(true);
    expect(IsUnspecifiedColor(colour(0, 0, 0))).toBe(false);
  });
});

describe('PCB_EDIT_FRAME::LoadProjectSettings', () => {
  it('turns hidden net names and hidden netclasses into hidden net codes', () => {
    const { frame, manager, render } = setup();
    const local = manager.Prj().GetLocalSettings();
    local.m_HiddenNets = ['GND', 'NOSUCH'];
    // every net is in the Default class; hide it by class name
    local.m_HiddenNetclasses = new Set<string>();
    expect(frame.LoadProjectSettings()).toBe(true);
    const nets = frame.GetBoard()!.GetNetInfo();
    expect([...render.GetHiddenNets()]).toEqual([nets.GetNetItem('GND')!.GetNetCode()]);

    // a second load starts from empty (the C++ clears first)
    local.m_HiddenNets = [];
    frame.LoadProjectSettings();
    expect(render.GetHiddenNets().size).toBe(0);

    local.m_HiddenNetclasses = new Set(['Default']);
    frame.LoadProjectSettings();
    for (const net of nets) {
      if (net.GetNetCode() > 0) expect(render.GetHiddenNets().has(net.GetNetCode())).toBe(true);
    }
  });

  it("fills the painter's net colour map from NET_SETTINGS, by net code", () => {
    const { frame, manager, render } = setup();
    const ns = manager.Prj().GetProjectFile().NetSettings();
    ns.SetNetColorAssignment('VCC', colour(1, 0, 0));
    ns.SetNetColorAssignment('SIG', COLOR4D_UNSPECIFIED);
    render.GetNetColorMap().set(99, colour(0, 0, 1)); // stale, must go
    frame.LoadProjectSettings();
    const nets = frame.GetBoard()!.GetNetInfo();
    const map = render.GetNetColorMap();
    expect([...map.keys()]).toEqual([nets.GetNetItem('VCC')!.GetNetCode()]);
    expect(map.get(nets.GetNetItem('VCC')!.GetNetCode())).toEqual(colour(1, 0, 0));
  });

  it('copies the local settings into the display options and the design settings', () => {
    const { frame, manager } = setup();
    const local = manager.Prj().GetLocalSettings();
    local.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.HIDDEN;
    local.m_NetColorMode = NET_COLOR_MODE.ALL;
    local.m_TrackOpacity = 0.11;
    local.m_ViaOpacity = 0.22;
    local.m_PadOpacity = 0.33;
    local.m_ZoneOpacity = 0.44;
    local.m_ImageOpacity = 0.55;
    local.m_ShapeOpacity = 0.66;
    local.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;
    local.m_AutoTrackWidth = true;
    frame.LoadProjectSettings();
    const o = frame.GetDisplayOptions();
    expect(o.m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.HIDDEN);
    expect(o.m_NetColorMode).toBe(NET_COLOR_MODE.ALL);
    expect(o.m_TrackOpacity).toBe(0.11);
    expect(o.m_ViaOpacity).toBe(0.22);
    expect(o.m_PadOpacity).toBe(0.33);
    expect(o.m_ZoneOpacity).toBe(0.44);
    expect(o.m_ImageOpacity).toBe(0.55);
    // m_ShapeOpacity is the file's name for m_FilledShapeOpacity
    expect(o.m_FilledShapeOpacity).toBe(0.66);
    expect(o.m_ZoneDisplayMode).toBe(ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE);
    expect(frame.GetDesignSettings().m_UseConnectedTrackWidth).toBe(true);
  });

  it('keeps every option the local settings do not carry (it edits a copy)', () => {
    const { frame } = setup();
    const before = frame.GetDisplayOptions();
    before.m_FlipBoardView = true;
    frame.LoadProjectSettings();
    expect(frame.GetDisplayOptions()).not.toBe(before);
    expect(frame.GetDisplayOptions().m_FlipBoardView).toBe(true);
    expect(frame.GetDisplayOptions()).toBeInstanceOf(PCB_DISPLAY_OPTIONS);
  });

  it('hands the presets, viewports and selection filter to the docked widgets', () => {
    const { frame, manager, panel } = setup();
    const project = manager.Prj().GetProjectFile();
    const preset = { name: 'p1' } as unknown as LAYER_PRESET;
    const viewport = { name: 'v1' } as unknown as VIEWPORT;
    project.m_LayerPresets = [preset];
    project.m_Viewports = [viewport];
    const local = manager.Prj().GetLocalSettings();
    local.m_PcbSelectionFilter.tracks = false;
    local.m_PcbSelectionFilter.zones = false;
    frame.LoadProjectSettings();
    expect(panel.layerPresets).toEqual([preset]);
    expect(panel.viewports).toEqual([viewport]);
    expect(frame.GetSelectionFilter().tracks).toBe(false);
    expect(frame.GetSelectionFilter().zones).toBe(false);
    expect(frame.GetSelectionFilter().pads).toBe(true);
    expect(panel.filter?.tracks).toBe(false);
  });

  it('remembers the project drawing sheet on the screen class', () => {
    const { frame, manager } = setup();
    manager.Prj().GetProjectFile().m_BoardDrawingSheetFile = 'my.kicad_wks';
    frame.LoadProjectSettings();
    expect(BASE_SCREEN.m_DrawingSheetFileName).toBe('my.kicad_wks');
  });
});

describe('PCB_EDIT_FRAME::saveProjectSettings / SaveProjectLocalSettings', () => {
  it('writes the frame state into the local settings', () => {
    const { frame, manager, render, panel } = setup();
    const nets = frame.GetBoard()!.GetNetInfo();
    render.GetHiddenNets().add(nets.GetNetItem('SIG')!.GetNetCode());
    render.GetHiddenNets().add(9999); // no such net: skipped
    panel.active = 'MyPreset';
    frame.SetActiveLayer(PCB_LAYER_ID.B_Cu);
    const o = new PCB_DISPLAY_OPTIONS();
    o.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;
    o.m_NetColorMode = NET_COLOR_MODE.OFF;
    o.m_TrackOpacity = 0.7;
    o.m_ViaOpacity = 0.6;
    o.m_PadOpacity = 0.5;
    o.m_ZoneOpacity = 0.4;
    o.m_ImageOpacity = 0.3;
    o.m_FilledShapeOpacity = 0.2;
    o.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;
    frame.SetDisplayOptions(o, false);
    frame.GetDesignSettings().m_UseConnectedTrackWidth = true;
    frame.GetSelectionFilter().vias = false;

    frame.saveProjectSettings();

    const l = manager.Prj().GetLocalSettings();
    expect(l.m_ActiveLayer).toBe(PCB_LAYER_ID.B_Cu);
    expect(l.m_ActiveLayerPreset).toBe('MyPreset');
    expect(l.m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.DIMMED);
    expect(l.m_NetColorMode).toBe(NET_COLOR_MODE.OFF);
    expect(l.m_TrackOpacity).toBe(0.7);
    expect(l.m_ViaOpacity).toBe(0.6);
    expect(l.m_PadOpacity).toBe(0.5);
    expect(l.m_ZoneOpacity).toBe(0.4);
    expect(l.m_ImageOpacity).toBe(0.3);
    expect(l.m_ShapeOpacity).toBe(0.2);
    expect(l.m_ZoneDisplayMode).toBe(ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE);
    expect(l.m_AutoTrackWidth).toBe(true);
    expect(l.m_HiddenNets).toEqual(['SIG']);
    expect(l.m_PcbSelectionFilter.vias).toBe(false);
    expect(l.m_PcbSelectionFilter.tracks).toBe(true);
  });

  it('writes nothing for a project with no name, or a read-only one', () => {
    const { frame, manager } = setup();
    const l = manager.Prj().GetLocalSettings();
    l.m_TrackOpacity = 0.123;
    const o = new PCB_DISPLAY_OPTIONS();
    o.m_TrackOpacity = 0.9;
    frame.SetDisplayOptions(o, false);

    manager.Prj().SetReadOnly(true);
    expect(frame.SaveProjectLocalSettings()).toBeNull();
    frame.saveProjectSettings();
    expect(l.m_TrackOpacity).toBe(0.123);

    // the same frame, writable, does write (the guard is what stopped it)
    manager.Prj().SetReadOnly(false);
    frame.saveProjectSettings();
    expect(l.m_TrackOpacity).toBe(0.9);
  });

  it('SaveProjectLocalSettings persists net colours, presets and the sheet into both files', () => {
    const { frame, manager, render, panel } = setup();
    const nets = frame.GetBoard()!.GetNetInfo();
    render.GetNetColorMap().set(nets.GetNetItem('VCC')!.GetNetCode(), colour(1, 0, 0));
    render.GetNetColorMap().set(4242, colour(0, 1, 0)); // no such net: skipped
    panel.userPresets = [{ name: 'saved' } as unknown as LAYER_PRESET];
    panel.userViewports = [{ name: 'vp' } as unknown as VIEWPORT];
    BASE_SCREEN.m_DrawingSheetFileName = 'sheet.kicad_wks';
    // a stale assignment the save must clear first
    manager
      .Prj()
      .GetProjectFile()
      .NetSettings()
      .SetNetColorAssignment('GND', colour(0, 0, 1));

    const saved = frame.SaveProjectLocalSettings();
    expect(saved).not.toBeNull();

    const ns = manager.Prj().GetProjectFile().NetSettings();
    expect([...ns.GetNetColorAssignments().keys()]).toEqual(['VCC']);
    const project = manager.Prj().GetProjectFile();
    expect(project.m_BoardDrawingSheetFile).toBe('sheet.kicad_wks');
    expect(project.m_LayerPresets).toEqual([{ name: 'saved' }]);
    expect(project.m_Viewports).toEqual([{ name: 'vp' }]);
    expect(saved!.pro).toBeTruthy();
    expect(saved!.prl).toBeTruthy();
  });

  it('a save then a load reproduces the state (the round trip a reopen makes)', () => {
    const a = setup();
    a.render.GetHiddenNets().add(a.frame.GetBoard()!.GetNetInfo().GetNetItem('GND')!.GetNetCode());
    const o = new PCB_DISPLAY_OPTIONS();
    o.m_TrackOpacity = 0.35;
    a.frame.SetDisplayOptions(o, false);
    const saved = a.frame.SaveProjectLocalSettings()!;
    SetPgm(null);

    const b = setup(saved.pro as JsonValue, saved.prl as JsonValue);
    b.frame.LoadProjectSettings();
    expect(b.frame.GetDisplayOptions().m_TrackOpacity).toBe(0.35);
    expect([...b.render.GetHiddenNets()]).toEqual([
      b.frame.GetBoard()!.GetNetInfo().GetNetItem('GND')!.GetNetCode(),
    ]);
  });
});

describe('PCB_EDIT_FRAME::LoadDrawingSheet', () => {
  it('loads the default sheet for an empty project entry and reports nothing', () => {
    const { frame, errors } = setup();
    expect(frame.LoadDrawingSheet(() => null)).toBe('');
    expect(errors).toEqual([]);
  });

  it('a named sheet the resolver finds but cannot be read goes to the infobar', () => {
    const { frame, manager, errors } = setup();
    const fs = new MEMORY_FILESYSTEM();
    fs.Write('gone.kicad_wks', new Uint8Array());
    const unmount = wxMountFileSystem('/p', fs);
    try {
      manager.Prj().GetProjectFile().m_BoardDrawingSheetFile = 'gone.kicad_wks';
      const msg = frame.LoadDrawingSheet(() => null);
      expect(msg).toBe('File not found.');
      expect(errors).toEqual(['File not found.']);
    } finally {
      unmount();
    }
  });

  it('a named sheet that exists is read through the callback, by its resolved path', () => {
    const { frame, manager, errors } = setup();
    const fs = new MEMORY_FILESYSTEM();
    fs.Write('mine.kicad_wks', new Uint8Array());
    const unmount = wxMountFileSystem('/p', fs);
    const asked: string[] = [];
    try {
      manager.Prj().GetProjectFile().m_BoardDrawingSheetFile = 'mine.kicad_wks';
      const msg = frame.LoadDrawingSheet((aPath) => {
        asked.push(aPath);
        return WKS;
      });
      expect(asked).toEqual(['/p/mine.kicad_wks']);
      expect(msg).toBe('');
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });
});
