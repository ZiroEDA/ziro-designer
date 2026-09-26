// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GERBVIEW_FRAME with its tools on a real VIEW (a stub GAL, the real
 * GERBVIEW_PAINTER), loading files by path from the RAM disk as KiCad loads
 * them from the file system. Expectations are the C++'s:
 *
 *   files.cpp LoadListOfGerberAndDrillFiles (:260-428)  each file takes the
 *       next free layer; a job file and a missing file take none and are
 *       reported in one Errors box; the first loaded layer ends active.
 *   files.cpp unarchiveFiles (:440-642)  a job file in the zip is skipped with
 *       a warning; the rest load and are sorted by extension.
 *   events_called_functions.cpp (:84-156)  each TOP_AUX box sets its OWN
 *       render setting; a picked D-code is stored on the image.
 *   gbr_layer_box_selector.cpp Resync (:76-129)  one row per LOADED image.
 *   gerbview_control.cpp LayerNext/MoveLayerUp (:334-380).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { EDA_DRAW_PANEL_GAL } from '@ziroeda/common/draw_panel_gal.js';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { CROSS_HAIR_MODE, GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GERBVIEW_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  GERBVIEW_AUTODETECT_FILTERS,
  GERBVIEW_DRILL_FILTERS,
  GERBVIEW_GERBER_FILTERS,
  GERBVIEW_JOB_FILTERS,
  GERBVIEW_ZIP_FILTERS,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import { wxChoice } from '@ziroeda/common/wx/choice.js';
import { wxUpdateUIEvent } from '@ziroeda/common/wx/wx_event.js';
import { s_tempFileSystem } from '@ziroeda/common/wx/filefn.js';
import { ZOOM_MAX_LIMIT_GERBVIEW, ZOOM_MIN_LIMIT_GERBVIEW } from '@ziroeda/common/zoom_defines.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { EXCELLON_IMAGE } from '@ziroeda/gerbview/excellon_read_drill_file.js';
import { MSG_JOB_FILE_AS_PLOT } from '@ziroeda/gerbview/files.js';
import { GERBER_FILE_IMAGE_LIST } from '@ziroeda/gerbview/gerber_file_image_list.js';
import { GERBVIEW_FRAME, type GERBVIEW_FRAME_HOST } from '@ziroeda/gerbview/gerbview_frame.js';
import { GERBVIEW_PAINTER } from '@ziroeda/gerbview/gerbview_painter.js';
import { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';
import { GERBVIEW_ACTIONS } from '@ziroeda/gerbview/tools/gerbview_actions.js';
import { DIALOG_PRINT_GERBVIEW } from '@ziroeda/gerbview/dialogs/dialog_print_gerbview.js';
import { BOARD_PRINTOUT_SETTINGS } from '@ziroeda/common/board_printout.js';
import type { DIALOG_DRAW_LAYERS_SETTINGS } from '@ziroeda/gerbview/dialogs/dialog_draw_layers_settings.js';
import { GERBER_LAYER_WIDGET_ID } from '@ziroeda/gerbview/widgets/gerbview_layer_widget.js';
import { checkedSet } from '@ziroeda/designer/src/editors/gerbview/gerbview_settings_bridge.js';
import { DCODE_SELECTION_BOX } from '@ziroeda/gerbview/widgets/dcode_selection_box.js';
import { GBR_LAYER_BOX_SELECTOR } from '@ziroeda/gerbview/widgets/gbr_layer_box_selector.js';

class STUB_GAL extends GAL {}

/** A gerber with one line on aperture D10 and one on D11, the second on net GND. */
const gerber = (fileFunction: string): string =>
  [
    '%FSLAX46Y46*%',
    '%MOMM*%',
    `%TF.FileFunction,${fileFunction}*%`,
    '%ADD10C,0.100000*%',
    '%ADD11C,0.200000*%',
    'D10*',
    'X0Y0D02*',
    'X1000000Y0D01*',
    '%TO.N,GND*%',
    'D11*',
    'X0Y1000000D02*',
    'X1000000Y1000000D01*',
    '%TD*%',
    'M02*',
    '',
  ].join('\n');

const DRILL = ['M48', 'METRIC,TZ', 'T1C0.800', '%', 'T1', 'X1.0Y1.0', 'M30', ''].join('\n');

const enc = new TextEncoder();

function put(aName: string, aText: string | Uint8Array): string {
  s_tempFileSystem.Write(aName, typeof aText === 'string' ? enc.encode(aText) : aText);
  return `/tmp/${aName}`;
}

/** CRC-32 (IEEE), for a stored zip entry. */
function crc32(aData: Uint8Array): number {
  let c = ~0;

  for (const b of aData) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }

  return ~c >>> 0;
}

/** A zip of stored (uncompressed) entries, written by hand. */
function storedZip(aEntries: [string, string][]): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) =>
    a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

  for (const [name, text] of aEntries) {
    const data = enc.encode(text);
    const nameBytes = enc.encode(name);
    const offset = parts.length;
    const crc = crc32(data);

    u32(parts, 0x04034b50);
    u16(parts, 20);
    u16(parts, 0);
    u16(parts, 0);
    u16(parts, 0);
    u16(parts, 0);
    u32(parts, crc);
    u32(parts, data.length);
    u32(parts, data.length);
    u16(parts, nameBytes.length);
    u16(parts, 0);
    parts.push(...nameBytes, ...data);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, crc);
    u32(central, data.length);
    u32(central, data.length);
    u16(central, nameBytes.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, offset);
    central.push(...nameBytes);
  }

  const cdOffset = parts.length;
  const out = [...parts, ...central];
  u32(out, 0x06054b50);
  u16(out, 0);
  u16(out, 0);
  u16(out, aEntries.length);
  u16(out, aEntries.length);
  u32(out, central.length);
  u32(out, cdOffset);
  u16(out, 0);

  return new Uint8Array(out);
}

interface Env {
  frame: GERBVIEW_FRAME;
  view: VIEW;
  boxes: string[];
  /** What the frame handed `GERBVIEW_DRAW_PANEL_GAL::SetDrawingSheet`, in order. */
  sheets: DS_PROXY_VIEW_ITEM[];
  /** Every `wxFileDialog` the frame opened, in order. */
  dialogs: { title: string; filters: readonly unknown[]; multiple: boolean }[];
  /** What the next dialogs answer, in order; Cancel once it runs out. */
  answers: string[][];
  /** Every cursor the frame set on its canvas, in order. */
  cursors: KICURSOR[];
  /** Every wxSingleChoiceDialog the frame showed. */
  choices: { caption: string; choices: string[] }[];
  /** Every DIALOG_DRAW_LAYERS_SETTINGS shown, as it was when shown. */
  drawLayers: DIALOG_DRAW_LAYERS_SETTINGS[];
  /** What the user does in the next ones before OK; Cancel once it runs out. */
  drawLayersEdits: ((aDlg: DIALOG_DRAW_LAYERS_SETTINGS) => void)[];
  /** Every DIALOG_PRINT_GERBVIEW shown. */
  prints: DIALOG_PRINT_GERBVIEW[];
}

function setup(): Env {
  SetPgm(new PGM_BASE());
  GERBER_FILE_IMAGE_LIST.GetImagesList().DeleteAllImages();

  const frame = new GERBVIEW_FRAME(new GERBVIEW_SETTINGS());
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  const view = new VIEW();
  view.SetGAL(gal);
  view.SetPainter(new GERBVIEW_PAINTER(gal));
  view.SetScaleLimits(ZOOM_MAX_LIMIT_GERBVIEW, ZOOM_MIN_LIMIT_GERBVIEW);

  const vcSettings = new VC_SETTINGS();
  const vc = {
    GetSettings: () => vcSettings,
    ApplySettings: () => {},
    ForceCursorPosition: () => {},
    WarpMouseCursor: () => {},
    GetMousePosition: () => ({ x: 0, y: 0 }),
    GetCursorPosition: () => ({ x: 0, y: 0 }),
    SetCrossHairCursorPosition: () => {},
    IsCursorWarpingEnabled: () => false,
    CenterOnCursor: () => {},
    SetAutoPan: () => {},
    CaptureCursor: () => {},
    ShowCursor: () => {},
  };

  const sheets: DS_PROXY_VIEW_ITEM[] = [];
  const cursors: KICURSOR[] = [];
  const canvas = {
    GetGAL: () => gal,
    GetView: () => view,
    GetViewControls: () => vc,
    GetBackend: () => GAL_TYPE.GAL_TYPE_OPENGL,
    SwitchBackend: () => true,
    StartDrawing: () => {},
    SetEventDispatcher: () => {},
    SetDrawingSheet: (aSheet: DS_PROXY_VIEW_ITEM) => sheets.push(aSheet),
    SetFocus: () => {},
    Refresh: () => {},
    ForceRefresh: () => {},
    SetCurrentCursor: (aCursor: KICURSOR) => cursors.push(aCursor),
    SetHighContrastLayer: () => {},
    GetDefaultViewBBox: () => new BOX2I(),
    GetClientSize: () => ({ x: 1000, y: 800 }),
    Destroy: () => {},
  };

  const boxes: string[] = [];
  const dialogs: Env['dialogs'] = [];
  const answers: Env['answers'] = [];
  const choices: Env['choices'] = [];
  const drawLayers: Env['drawLayers'] = [];
  const prints: Env['prints'] = [];
  const drawLayersEdits: Env['drawLayersEdits'] = [];
  const host: GERBVIEW_FRAME_HOST = {
    FileDialog: (aTitle, aFilters, aMultiple) => {
      dialogs.push({ title: aTitle, filters: aFilters, multiple: aMultiple });
      const paths = answers.shift();
      return Promise.resolve(paths ? { paths, filterIndex: 0 } : null);
    },
    HtmlMessageBox: (caption, messages) => {
      boxes.push(`${caption}: ${messages}`);
      return Promise.resolve();
    },
    InfoBarError: (m) => boxes.push(`infobar: ${m}`),
    MessageBox: (m) => {
      boxes.push(`msg: ${m}`);
      return Promise.resolve();
    },
    UpdateFileHistory: () => {},
    SaveFileDialog: () => Promise.resolve(null),
    MapGerberLayersToPcb: () => Promise.resolve(null),
    SaveTextFile: () => {},
    PrintDialog: (aDlg) => {
      prints.push(aDlg);
      return Promise.resolve();
    },
    DrawLayersSettingsDialog: (aDlg) => {
      drawLayers.push(aDlg);
      const edit = drawLayersEdits.shift();
      if (!edit) return Promise.resolve(false);
      edit(aDlg);
      return Promise.resolve(aDlg.TransferDataFromWindow());
    },
    SingleChoiceDialog: (aCaption, aChoices) => {
      choices.push({ caption: aCaption, choices: [...aChoices] });
      return Promise.resolve();
    },
  };

  frame.SetHost(host);
  frame.m_SelLayerBox = new GBR_LAYER_BOX_SELECTOR(frame);
  frame.m_DCodeSelector = new DCODE_SELECTION_BOX();
  frame.m_SelComponentBox = new wxChoice();
  frame.m_SelNetnameBox = new wxChoice();
  frame.m_SelAperAttributesBox = new wxChoice();
  frame.AttachCanvas(canvas as unknown as EDA_DRAW_PANEL_GAL as never);

  return {
    frame,
    view,
    boxes,
    sheets,
    dialogs,
    answers,
    cursors,
    choices,
    drawLayers,
    drawLayersEdits,
    prints,
  };
}

let env: Env;

beforeEach(() => {
  env = setup();
});

describe('GERBVIEW_FRAME::LoadListOfGerberAndDrillFiles', () => {
  it('loads each file on the next free layer and leaves the first loaded one active', async () => {
    const a = put('a.gtl', gerber('Copper,L1,Top'));
    const b = put('b.gbl', gerber('Copper,L2,Bot'));

    const ok = await env.frame.LoadListOfGerberAndDrillFiles('/tmp', [a, b], [0, 0]);

    expect(ok).toBe(true);
    expect(env.frame.GetImagesList().GetLoadedImageCount()).toBe(2);
    expect(env.frame.GetActiveLayer()).toBe(0);
    expect(env.frame.GetGbrImage(1)?.m_FileName).toBe(b);
    expect(env.boxes).toEqual([]);
  });

  it('refuses a job file and a missing file in one Errors box, and neither takes a layer', async () => {
    const job = put('x.gbrjob', '{}');
    const a = put('a.gtl', gerber('Copper,L1,Top'));

    const ok = await env.frame.LoadListOfGerberAndDrillFiles(
      '/tmp',
      [job, '/tmp/missing.gbr', a],
      [0, 0, 0],
    );

    expect(ok).toBe(false);
    expect(env.frame.GetImagesList().GetLoadedImageCount()).toBe(1);
    expect(env.boxes).toHaveLength(1);
    expect(env.boxes[0]).toContain('Errors: ');
    expect(env.boxes[0]).toContain(MSG_JOB_FILE_AS_PLOT.replace('%s', 'x.gbrjob'));
    expect(env.boxes[0]).toContain('<b>File not found:</b><br>/tmp/missing.gbr<br>');
  });

  it('autodetect reads an Excellon file as a drill image', async () => {
    const d = put('d.txt', DRILL);

    await env.frame.LoadListOfGerberAndDrillFiles('/tmp', [d], [2]);

    expect(env.frame.GetGbrImage(0)).toBeInstanceOf(EXCELLON_IMAGE);
  });
});

describe('GERBVIEW_FRAME toolbar boxes', () => {
  it('the layer box has a row per loaded image only', async () => {
    await env.frame.LoadListOfGerberAndDrillFiles(
      '/tmp',
      [put('a.gtl', gerber('Copper,L1,Top')), put('b.gbl', gerber('Copper,L2,Bot'))],
      [0, 0],
    );

    expect(env.frame.m_SelLayerBox!.GetCount()).toBe(2);
    expect(env.frame.m_SelLayerBox!.GetRows().map((r) => r.layerid)).toEqual([0, 1]);
  });

  it('the net and D-code highlights are independent, and the D-code is kept on its image', async () => {
    await env.frame.LoadListOfGerberAndDrillFiles(
      '/tmp',
      [put('a.gtl', gerber('Copper,L1,Top')), put('b.gbl', gerber('Copper,L2,Bot'))],
      [0, 0],
    );
    env.frame.SetActiveLayer(0);
    env.frame.syncLayerBox(false);
    const rs = (env.view.GetPainter() as GERBVIEW_PAINTER).GetSettings();

    const netBox = env.frame.m_SelNetnameBox!;
    netBox.SetSelection(netBox.FindString('GND'));
    env.frame.OnSelectHighlightChoice(netBox);

    const dcodes = env.frame.m_DCodeSelector!;
    dcodes.SetDCodeSelection(11);
    env.frame.OnSelectActiveDCode();

    expect(rs.m_netHighlightString).toBe('GND');
    expect(rs.m_dcodeHighlightValue).toBe(11);
    expect(env.frame.GetGbrImage(0)!.m_Selected_Tool).toBe(11);

    // Another layer: its own (unset) tool; back again: 11 is restored.
    env.frame.OnSelectActiveLayer(1);
    expect(rs.m_dcodeHighlightValue).toBe(0);
    env.frame.OnSelectActiveLayer(0);
    expect(rs.m_dcodeHighlightValue).toBe(11);
    expect(rs.m_netHighlightString).toBe('GND');
  });
});

describe('GERBVIEW_FRAME::LoadZipArchiveFile', () => {
  it('skips the job file with a warning; X2 files are sorted by their attributes', async () => {
    // Both .gbr, listed bottom first: an extension sort cannot tell them
    // apart, so only SortLayersByX2Attributes puts the top copper first.
    const zip = put(
      'board.zip',
      storedZip([
        ['board-a.gbr', gerber('Copper,L2,Bot')],
        ['board-job.gbrjob', '{}'],
        ['board-b.gbr', gerber('Copper,L1,Top')],
      ]),
    );

    await env.frame.LoadZipArchiveFile(zip);

    expect(env.frame.GetImagesList().GetLoadedImageCount()).toBe(2);
    expect(env.boxes.join('\n')).toContain("Skipped file 'board-job.gbrjob' (gerber job file).");
    expect(env.frame.GetGbrImage(0)!.m_FileName).toBe('board-b.gbr');
    expect(env.frame.GetGbrImage(1)!.m_FileName).toBe('board-a.gbr');
  });
});

describe('GERBVIEW_CONTROL layer actions', () => {
  it('layerNext stops at the last loaded image; moveLayerUp swaps with the one above', async () => {
    await env.frame.LoadListOfGerberAndDrillFiles(
      '/tmp',
      [put('a.gtl', gerber('Copper,L1,Top')), put('b.gbl', gerber('Copper,L2,Bot'))],
      [0, 0],
    );
    const mgr = env.frame.GetToolManager()!;
    env.frame.SetActiveLayer(0);

    mgr.RunAction(GERBVIEW_ACTIONS.layerNext);
    expect(env.frame.GetActiveLayer()).toBe(1);
    mgr.RunAction(GERBVIEW_ACTIONS.layerNext);
    expect(env.frame.GetActiveLayer()).toBe(1);

    const second = env.frame.GetGbrImage(1)!.m_FileName;
    mgr.RunAction(GERBVIEW_ACTIONS.moveLayerUp);
    expect(env.frame.GetActiveLayer()).toBe(0);
    expect(env.frame.GetGbrImage(0)!.m_FileName).toBe(second);
  });
});

/**
 * `GERBVIEW_FRAME::SetPageSettings` (`gerbview_frame.cpp:880-902`), which the
 * frame runs when it gets its canvas: the proxy goes on a GERBER page
 * (`:134`, 32000 x 32000 mils, page_info.cpp:61), sheet 1 of 1 (`:893-894`),
 * coloured by the two gerbview layers (`:897-898`).
 */
describe('GERBVIEW_FRAME::SetPageSettings', () => {
  const peek = (s: DS_PROXY_VIEW_ITEM) =>
    s as unknown as {
      m_pageNumber: string;
      m_sheetCount: number;
      m_colorLayer: number;
      m_pageBorderColorLayer: number;
    };

  it('hands the panel a drawing sheet on the GERBER page, sheet 1 of 1', () => {
    const sheet = env.sheets.at(-1)!;

    expect(sheet).toBeInstanceOf(DS_PROXY_VIEW_ITEM);
    expect(sheet.GetPageInfo().GetType()).toBe(PAGE_SIZE_TYPE.GERBER);
    expect(sheet.GetPageInfo().GetWidthMils()).toBe(32000);
    expect(sheet.GetPageInfo().GetHeightMils()).toBe(32000);
    expect(peek(sheet).m_pageNumber).toBe('1');
    expect(peek(sheet).m_sheetCount).toBe(1);
  });

  it('colours it by LAYER_GERBVIEW_DRAWINGSHEET and LAYER_GERBVIEW_PAGE_LIMITS', () => {
    const sheet = peek(env.sheets.at(-1)!);

    expect(sheet.m_colorLayer).toBe(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET);
    expect(sheet.m_pageBorderColorLayer).toBe(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS);
  });

  it('spans the page in gerbview IU, which is what zoom-to-fit falls back to', () => {
    // 32000 mils = 812.8 mm, at gerbview's gerbIUScale - 1 nm, where KiCad's
    // is 10 nm (the open IU divergence; this moves with it).
    const bbox = env.sheets.at(-1)!.ViewBBox();

    expect(bbox.GetWidth()).toBe(Math.round(812.8 * 1e6));
    expect(bbox.GetHeight()).toBe(Math.round(812.8 * 1e6));
  });
});

/**
 * GerbView opens five dialogs, each with its own filter list: the three of
 * LoadFileOrShowDialog (`files.cpp:203,246,257`, all wxFD_MULTIPLE), the zip
 * (`:661`, one file) and the job file (`job_file_reader.cpp:190`, one file,
 * its own dialog - not the plot loader, which refuses a .gbrjob by name).
 */
describe('GERBVIEW_FRAME opens five dialogs, not two', () => {
  it('names its own filter list for each entry', async () => {
    await env.frame.LoadAutodetectedFiles('');
    await env.frame.LoadGerberFiles('');
    await env.frame.LoadExcellonFiles('');
    await env.frame.LoadZipArchiveFile('');
    await env.frame.LoadGerberJobFile('');

    expect(env.dialogs.map((d) => [d.title, d.filters, d.multiple])).toEqual([
      ['Open Autodetected File(s)', GERBVIEW_AUTODETECT_FILTERS, true],
      ['Open Gerber File(s)', GERBVIEW_GERBER_FILTERS, true],
      ['Open NC (Excellon) Drill File(s)', GERBVIEW_DRILL_FILTERS, true],
      ['Open Zip File', GERBVIEW_ZIP_FILTERS, false],
      ['Open Gerber Job File', GERBVIEW_JOB_FILTERS, false],
    ]);
  });
});

/**
 * Where a load sorts the layers. LoadFileOrShowDialog sorts by extension only
 * when nothing was loaded before the batch (`files.cpp:226,236-242`), and a
 * job file always sorts by X2 attributes (`job_file_reader.cpp:167`). The zip
 * case is above.
 */
describe('the automatic layer sorts', () => {
  const names = (): string[] =>
    [0, 1, 2]
      .map((i) => env.frame.GetGbrImage(i)?.m_FileName)
      .filter((n): n is string => n !== undefined)
      .map((n) => n.slice(n.lastIndexOf('/') + 1));

  it('a first Open sorts its batch by file extension: .gtl over .gbl', async () => {
    env.answers.push([
      put('b.gbl', gerber('Copper,L2,Bot')),
      put('t.gtl', gerber('Copper,L1,Top')),
    ]);

    await env.frame.LoadGerberFiles('');

    expect(names()).toEqual(['t.gtl', 'b.gbl']);
  });

  it('an Open onto loaded layers leaves the load order alone', async () => {
    await env.frame.LoadGerberFiles(put('z.gbr', gerber('Other,Comment')));
    env.answers.push([
      put('b.gbl', gerber('Copper,L2,Bot')),
      put('t.gtl', gerber('Copper,L1,Top')),
    ]);

    await env.frame.LoadGerberFiles('');

    expect(names()).toEqual(['z.gbr', 'b.gbl', 't.gtl']);
  });

  it('a job file sorts by X2 attributes, which the extensions cannot tell apart', async () => {
    put('job-a.gbr', gerber('Copper,L2,Bot'));
    put('job-b.gbr', gerber('Copper,L1,Top'));
    const job = put(
      'board.gbrjob',
      JSON.stringify({
        FilesAttributes: [
          { Path: 'job-a.gbr', FileFunction: 'Copper,L2,Bot' },
          { Path: 'job-b.gbr', FileFunction: 'Copper,L1,Top' },
        ],
      }),
    );

    await env.frame.LoadGerberJobFile(job);

    expect(names()).toEqual(['job-b.gbr', 'job-a.gbr']);
  });
});

/**
 * GerbView's "Crosshair modes" toolbar group is three actions
 * (`toolbars_gerber.cpp:62-65`), each COMMON_TOOLS setting ONE value of
 * CROSS_HAIR_MODE and writing it to the window settings
 * (`common_tools.cpp`, CursorSmall/Full/45Crosshairs). One enum, so the three
 * are exclusive by construction and the diagonal is reachable.
 */
describe('the crosshair modes', () => {
  it('each action sets its own mode on the GAL and in gerbview.json', () => {
    const mgr = env.frame.GetToolManager()!;
    const cases = [
      [ACTIONS.cursor45Crosshairs, CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL],
      [ACTIONS.cursorFullCrosshairs, CROSS_HAIR_MODE.FULLSCREEN_CROSS],
      [ACTIONS.cursorSmallCrosshairs, CROSS_HAIR_MODE.SMALL_CROSS],
    ] as const;

    for (const [action, mode] of cases) {
      mgr.RunAction(action);
      expect(env.frame.GetGalDisplayOptions().GetCursorMode()).toBe(mode);
      expect(env.frame.gvconfig().m_Window.cursor.cross_hair_mode).toBe(mode);
    }
  });
});

/**
 * What the toolbar opens with, read off a fresh frame through the conditions
 * setupUIConditions registers: grid on (`app_settings.cpp:555-556`),
 * millimetres (gerbview is on neither imperial name, the `else` arm), the
 * layer manager, SMALL_CROSS (`gal_display_options.cpp:52`), and the
 * selection arrow - with an empty tool stack IsCurrentTool( selectionTool )
 * is true (`tools_holder.cpp:129-135`). Every display toggle starts off.
 */
describe('the toolbar a fresh frame opens with', () => {
  it('checks exactly five buttons', () => {
    expect([...checkedSet(env.frame)].sort()).toEqual([
      'crosshairSmall',
      'select',
      'showLayerManager',
      'toggleGrid',
      'unitsMm',
    ]);
  });

  it('follows the frame when a tool flips a setting', () => {
    env.frame.GetToolManager()!.RunAction(ACTIONS.cursor45Crosshairs);
    env.frame.gvconfig().m_Display.m_DisplayLinesFill = false;

    const on = checkedSet(env.frame);
    expect(on.has('crosshair45')).toBe(true);
    expect(on.has('crosshairSmall')).toBe(false);
    expect(on.has('linesSketch')).toBe(true);
  });

  it('moves the tool check to the tool that is running', () => {
    env.frame.GetToolManager()!.RunAction(ACTIONS.measureTool);

    const on = checkedSet(env.frame);
    expect(on.has('measure')).toBe(true);
    expect(on.has('select')).toBe(false);
  });
});

/**
 * GERBVIEW_INSPECTION_TOOL::MeasureTool sets KICURSOR::MEASURE on the canvas
 * (`gerbview_inspection_tool.cpp`, its setCursor lambda), the cursor every
 * frame's ruler uses.
 */
describe('the measure tool', () => {
  it('shows the MEASURE cursor', () => {
    env.frame.GetToolManager()!.RunAction(ACTIONS.measureTool);

    expect(env.cursors.at(-1)).toBe(KICURSOR.MEASURE);
  });
});

/**
 * Units go through EDA_DRAW_FRAME: ToggleUserUnits returns to the unit last
 * used on the other side (`eda_draw_frame.cpp`, m_System.last_*_units), and
 * the frame's settings carry it back to gerbview.json.
 */
describe('the unit actions', () => {
  it('Ctrl+U goes back to the imperial unit last used, not the default', () => {
    const mgr = env.frame.GetToolManager()!;

    mgr.RunAction(ACTIONS.milsUnits);
    mgr.RunAction(ACTIONS.millimetersUnits);
    expect(env.frame.GetUserUnits()).toBe('mm');

    mgr.RunAction(ACTIONS.toggleUnits);
    expect(env.frame.GetUserUnits()).toBe('mils');
  });
});

/**
 * Alt+1 / Alt+2 are COMMON_TOOLS::GridFast1 / GridFast2 on this frame: the
 * grid row gerbview.json names (window.grid.fast_grid_1 / _2), written back
 * to window.grid.last_size_idx.
 */
describe('the fast grids', () => {
  it('select the rows gerbview.json names, and cycle between them', () => {
    const grid = env.frame.gvconfig().m_Window.grid;
    grid.fast_grid_1 = 2;
    grid.fast_grid_2 = 5;
    const mgr = env.frame.GetToolManager()!;

    mgr.RunAction(ACTIONS.gridFast1);
    expect(grid.last_size_idx).toBe(2);
    mgr.RunAction(ACTIONS.gridFast2);
    expect(grid.last_size_idx).toBe(5);
    mgr.RunAction(ACTIONS.gridFastCycle);
    expect(grid.last_size_idx).toBe(2);
  });
});

/**
 * GERBVIEW_FRAME::UpdateTitleAndInfo (`gerbview_frame.cpp:659-710`): the
 * title, status field 0 and the text beside the aux toolbar, all read off the
 * ACTIVE layer's image.
 */
describe('GERBVIEW_FRAME::UpdateTitleAndInfo', () => {
  const plain = ['%FSLAX24Y24*%', '%MOIN*%', '%ADD10C,0.01*%', 'D10*', 'X0Y0D03*', 'M02*'].join(
    '\n',
  );
  const x2 = [
    '%FSLAX36Y36*%',
    '%MOMM*%',
    '%TF.FileFunction,Copper,L1,Top*%',
    '%INMyImage*%',
    '%LNTopCopper*%',
    '%ADD10C,0.5*%',
    'D10*',
    'X0Y0D03*',
    'M02*',
  ].join('\n');

  /** `SetTitle( _("Gerber Viewer") )` and "Drawing layer not in use" (:667-671). */
  it('with nothing loaded: the bare frame name, a blank field 0, the unused-layer text', () => {
    env.frame.UpdateTitleAndInfo();

    expect(env.frame.GetTitle()).toBe('Gerber Viewer');
    expect(env.frame.GetStatusText(0)).toBe('');
    expect(env.frame.m_TextInfo).toBe('Drawing layer not in use');
  });

  /**
   * `filename.GetFullName()` WITH the extension (:684), " (with X2
   * attributes)" before the dash (:686-688); `"fmt: %s X%d.%d Y%d.%d no %cZ"`
   * plus " X2 attr" (:701-708). %LN is skipped as a comment
   * (`rs274x.cpp:676-681`), so the layer name is always 'no name', while %IN
   * does store.
   */
  it('for an X2 file: the extension kept, both X2 flags, the names quoted', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', x2));

    expect(env.frame.GetTitle()).toBe('top.gbr (with X2 attributes) — Gerber Viewer');
    expect(env.frame.GetStatusText(0)).toBe("Image name: 'MyImage'  Layer name: 'no name'");
    expect(env.frame.m_TextInfo).toBe('fmt: mm X3.6 Y3.6 no LZ X2 attr');
  });

  it('for a plain file: no X2 flag anywhere, and inches', async () => {
    await env.frame.LoadGerberFiles(put('p.gbr', plain));

    expect(env.frame.GetTitle()).toBe('p.gbr — Gerber Viewer');
    expect(env.frame.m_TextInfo).toBe('fmt: in X2.4 Y2.4 no LZ');
  });

  it('follows the active layer', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', x2));
    await env.frame.LoadGerberFiles(put('p.gbr', plain));

    env.frame.SetActiveLayer(0);
    expect(env.frame.GetTitle()).toBe('top.gbr (with X2 attributes) — Gerber Viewer');
    env.frame.SetActiveLayer(1);
    expect(env.frame.GetTitle()).toBe('p.gbr — Gerber Viewer');
  });
});

/**
 * A two-aperture, two-item RS-274X file in millimetres: D10 is a 0.6 mm round
 * pad and D11 a 1.5 x 0.8 mm rectangle, flashed with %TO.N / %TO.C attached.
 */
const SAMPLE = [
  '%FSLAX36Y36*%',
  '%MOMM*%',
  '%TF.FileFunction,Copper,L1,Top*%',
  '%ADD10C,0.6*%',
  '%ADD11R,1.5X0.8*%',
  '%TO.N,GND*%',
  '%TO.C,R1*%',
  'D10*',
  'X1000000Y1000000D03*',
  '%TO.N,VCC*%',
  '%TO.C,C2*%',
  'D11*',
  'X2000000Y1000000D03*',
  'M02*',
].join('\n');

/** A second layer: one aperture, D20, and a component the first file lacks. */
const SECOND = [
  '%FSLAX36Y36*%',
  '%MOMM*%',
  '%ADD20C,0.3*%',
  '%TO.C,U9*%',
  'D20*',
  'X0Y0D03*',
  'M02*',
].join('\n');

/**
 * The TOP_AUX boxes, read off the frame's own widgets after a load
 * (`toolbars_gerber.cpp:275-420`). The empty entry is `NO_SELECTION_STRING`,
 * `_( "<No selection>" )` (:280).
 */
describe('the D-code box', () => {
  /**
   * `"tool %d [%.3fx%.3f %s] %s"` (:322-326): three decimals in EVERY unit, so
   * 0.6 mm is "0.600", and the units are GerbView's own "in" and "mil".
   */
  it('formats an aperture as tool N [WxH unit] Type, per the frame units', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', SAMPLE));

    expect(env.frame.m_DCodeSelector!.GetStrings()).toEqual([
      '<No selection>',
      'tool 10 [0.600x0.600 mm] Round',
      'tool 11 [1.500x0.800 mm] Rect',
    ]);

    env.frame.GetToolManager()!.RunAction(ACTIONS.inchesUnits);
    expect(env.frame.m_DCodeSelector!.GetString(1)).toBe('tool 10 [0.024x0.024 in] Round');
    env.frame.GetToolManager()!.RunAction(ACTIONS.milsUnits);
    expect(env.frame.m_DCodeSelector!.GetString(1)).toBe('tool 10 [23.622x23.622 mil] Round');
  });

  it('carries the D-code number the selection stores', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', SAMPLE));

    env.frame.m_DCodeSelector!.SetDCodeSelection(11);
    expect(env.frame.m_DCodeSelector!.GetSelectedDCodeId()).toBe(11);
  });

  it('holds only the empty entry when the active layer has no image', () => {
    env.frame.updateDCodeSelectBox();

    expect(env.frame.m_DCodeSelector!.GetStrings()).toEqual(['<No selection>']);
  });
});

describe('the three highlight lists', () => {
  /**
   * Built "from the partial lists stored in EACH file image" (:335-345), and
   * through a std::map, so sorted and de-duplicated.
   */
  it('span every loaded image, sorted, after the empty entry', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', SAMPLE));
    await env.frame.LoadGerberFiles(put('bot.gbr', SECOND));

    env.frame.SetActiveLayer(0);
    expect(env.frame.m_SelComponentBox!.GetStrings()).toEqual(['<No selection>', 'C2', 'R1', 'U9']);
    expect(env.frame.m_SelNetnameBox!.GetStrings()).toEqual(['<No selection>', 'GND', 'VCC']);
  });

  /**
   * `m_SelNetnameBox->Append( UnescapeString( entry.first ) )` (:381): the net
   * list is the ONE of the three that unescapes.
   */
  it('unescapes a net name, which the component list does not', async () => {
    await env.frame.LoadGerberFiles(
      put(
        'esc.gbr',
        [
          '%FSLAX36Y36*%',
          '%MOMM*%',
          '%ADD10C,0.2*%',
          '%TO.N,SHEET{slash}NET*%',
          '%TO.C,J{slash}1*%',
          'D10*',
          'X0Y0D03*',
          'M02*',
        ].join('\n'),
      ),
    );

    expect(env.frame.m_SelNetnameBox!.GetStrings()).toEqual(['<No selection>', 'SHEET/NET']);
    expect(env.frame.m_SelComponentBox!.GetStrings()).toEqual(['<No selection>', 'J{slash}1']);
  });
});

/**
 * GERBVIEW_INSPECTION_TOOL::ShowDCodes (`gerbview_inspection_tool.cpp:88-145`),
 * the list it hands wxSingleChoiceDialog.
 */
describe('GERBVIEW_INSPECTION_TOOL::ShowDCodes', () => {
  const show = (): string[] => {
    env.frame.GetToolManager()!.RunAction(GERBVIEW_ACTIONS.showDCodes);
    const shown = env.choices.at(-1)!;
    expect(shown.caption).toBe('D Codes');
    return shown.choices;
  };

  /**
   * `*** Active layer (%2.2d) ***` / `*** layer %2.2d  ***` on layer + 1
   * (:109-113): the inactive form has two spaces before its stars.
   */
  it('heads every layer, marking the active one, and moves the marker with it', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', SAMPLE));
    await env.frame.LoadGerberFiles(put('bot.gbr', SECOND));

    env.frame.SetActiveLayer(0);
    let lines = show();
    expect(lines[0]).toBe('*** Active layer (01) ***');
    expect(lines.find((l) => l.startsWith('*** layer'))).toBe('*** layer 02  ***');

    env.frame.SetActiveLayer(1);
    lines = show();
    expect(lines[0]).toBe('*** layer 01  ***');
    expect(lines.find((l) => l.includes('Active'))).toBe('*** Active layer (02) ***');
    // ii restarts at 1 for each layer (:116).
    expect(lines.filter((l) => l.startsWith('tool 1:'))).toHaveLength(2);
  });

  /**
   * `"tool %d:   Dcode D%d   V %.4f %s  H %.4f %s   %s  attribute '%s'"`
   * (:125-131). V is m_Size.y and H is m_Size.x: D11 is 1.5 wide by 0.8 tall.
   */
  it('formats a row exactly, with V before H, and flags one in use', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', SAMPLE));

    const lines = show();
    expect(lines[1]).toBe(
      "tool 1:   Dcode D10   V 0.6000 mm  H 0.6000 mm   Round  attribute 'none' (in use)",
    );
    expect(lines[2]).toBe(
      "tool 2:   Dcode D11   V 0.8000 mm  H 1.5000 mm   Rect  attribute 'none' (in use)",
    );
  });

  it('uses four decimals in every unit, and GerbView’s own unit words', async () => {
    await env.frame.LoadGerberFiles(put('top.gbr', SAMPLE));

    env.frame.GetToolManager()!.RunAction(ACTIONS.inchesUnits);
    expect(show()[1]).toContain('V 0.0236 in');
    env.frame.GetToolManager()!.RunAction(ACTIONS.milsUnits);
    expect(show()[1]).toContain('V 23.6220 mil');
  });

  /** `if( gerber->GetDcodesCount() == 0 ) continue;` (:106-107). */
  it('skips a layer with no apertures, and lists nothing when nothing is loaded', async () => {
    expect(show()).toEqual([]);

    await env.frame.LoadGerberFiles(put('e.gbr', ['%FSLAX36Y36*%', '%MOMM*%', 'M02*'].join('\n')));
    expect(show()).toEqual([]);
  });
});

/**
 * GERBVIEW_FRAME::SetLayerDrawPrms (`gerbview_frame.cpp:586-605`) and
 * DIALOG_DRAW_LAYERS_SETTINGS (`dialogs/dialog_draw_layers_settings.cpp`).
 */
describe('DIALOG_DRAW_LAYERS_SETTINGS', () => {
  const load3 = async (): Promise<void> => {
    await env.frame.LoadGerberFiles(put('a.gbr', SAMPLE));
    await env.frame.LoadGerberFiles(put('b.gbr', SECOND));
    await env.frame.LoadGerberFiles(put('c.gbr', SECOND));
    env.frame.SetActiveLayer(1);
  };

  it('opens on the active layer: its full name, its offset and rotation', async () => {
    await load3();
    env.frame
      .GetGbrImage(1)!
      .SetDrawOffetAndRotation({ x: 1.5, y: -2 }, new EDA_ANGLE(12.34567, EDA_ANGLE_T.DEGREES_T));

    await env.frame.SetLayerDrawPrms();

    const dlg = env.drawLayers.at(-1)!;
    expect(dlg.m_stLayerName).toBe('b.gbr');
    expect([dlg.m_tcOffsetX, dlg.m_tcOffsetY]).toEqual(['1.5', '-2']);
    // SetPrecision( 3 ) truncates, it does not round (unit_binder.cpp:583-600).
    expect(dlg.m_tcRotation).toBe('12.345');
    expect(dlg.m_rbScope).toBe(0);
  });

  it('shows the offsets in the frame units', async () => {
    await load3();
    env.frame
      .GetGbrImage(1)!
      .SetDrawOffetAndRotation({ x: 25.4, y: 0 }, new EDA_ANGLE(0, EDA_ANGLE_T.DEGREES_T));
    env.frame.GetToolManager()!.RunAction(ACTIONS.inchesUnits);

    await env.frame.SetLayerDrawPrms();

    expect(env.drawLayers.at(-1)!.m_tcOffsetX).toBe('1');
  });

  it('does not open with no image on the active layer (:589-592)', async () => {
    await env.frame.SetLayerDrawPrms();

    expect(env.drawLayers).toHaveLength(0);
  });

  const offsetsOf = (): string[] =>
    [0, 1, 2].map((i) => {
      const img = env.frame.GetGbrImage(i)!;
      return `${img.m_DisplayOffset.x / 1e6},${img.m_DisplayOffset.y / 1e6}@${img.m_DisplayRotation.AsDegrees()}`;
    });

  const apply =
    (aScope: number) =>
    (aDlg: DIALOG_DRAW_LAYERS_SETTINGS): void => {
      aDlg.m_tcOffsetX = '1';
      aDlg.m_tcOffsetY = '2';
      aDlg.m_tcRotation = '90';
      aDlg.m_rbScope = aScope;
    };

  it('Active layer: only the active image moves', async () => {
    await load3();
    env.drawLayersEdits.push(apply(0));

    await env.frame.SetLayerDrawPrms();

    expect(offsetsOf()).toEqual(['0,0@0', '1,2@90', '0,0@0']);
  });

  it('All layers: every image moves', async () => {
    await load3();
    env.drawLayersEdits.push(apply(1));

    await env.frame.SetLayerDrawPrms();

    expect(offsetsOf()).toEqual(['1,2@90', '1,2@90', '1,2@90']);
  });

  it('All visible layers: a hidden image stays put', async () => {
    await load3();
    env.frame.m_LayersManager.onPopupSelection(GERBER_LAYER_WIDGET_ID.ID_SHOW_ALL_LAYERS);
    const v = env.frame.GetVisibleLayers();
    v.set(2, false);
    env.frame.SetVisibleLayers(v);
    env.drawLayersEdits.push(apply(2));

    await env.frame.SetLayerDrawPrms();

    expect(offsetsOf()).toEqual(['1,2@90', '1,2@90', '0,0@0']);
  });

  it('Cancel changes nothing', async () => {
    await load3();

    await env.frame.SetLayerDrawPrms();

    expect(offsetsOf()).toEqual(['0,0@0', '0,0@0', '0,0@0']);
  });
});

/**
 * GERBER_LAYER_WIDGET::onPopupSelection / OnLayerSelected
 * (`gerbview_layer_widget.cpp:212-290`).
 */
describe('GERBER_LAYER_WIDGET', () => {
  const shown = (): boolean[] => [0, 1, 2].map((i) => env.frame.IsLayerVisible(i));
  const load3 = async (): Promise<void> => {
    await env.frame.LoadGerberFiles(put('a.gbr', SAMPLE));
    await env.frame.LoadGerberFiles(put('b.gbr', SECOND));
    await env.frame.LoadGerberFiles(put('c.gbr', SECOND));
  };

  it('hides all but the active layer, once', async () => {
    await load3();
    env.frame.SetActiveLayer(1);

    env.frame.m_LayersManager.onPopupSelection(GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS_BUT_ACTIVE);
    expect(shown()).toEqual([false, true, false]);

    // Not the "always" mode: selecting another layer does not follow.
    env.frame.SetActiveLayer(2);
    expect(shown()).toEqual([false, true, false]);
  });

  it('in the "always" mode, the newly active layer is the one shown', async () => {
    await load3();
    env.frame.SetActiveLayer(1);

    env.frame.m_LayersManager.onPopupSelection(
      GERBER_LAYER_WIDGET_ID.ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE,
    );
    env.frame.SetActiveLayer(2);
    expect(shown()).toEqual([false, false, true]);

    // Show All leaves the mode (:229).
    env.frame.m_LayersManager.onPopupSelection(GERBER_LAYER_WIDGET_ID.ID_SHOW_ALL_LAYERS);
    expect(shown()).toEqual([true, true, true]);
    env.frame.SetActiveLayer(0);
    expect(shown()).toEqual([true, true, true]);
  });

  it('Hide All hides every row', async () => {
    await load3();

    env.frame.m_LayersManager.onPopupSelection(GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS);
    expect(shown()).toEqual([false, false, false]);
  });

  it('Clear Current Layer clears without asking (Erase_Current_DrawLayer( false ))', async () => {
    await load3();
    env.frame.SetActiveLayer(1);
    const asked = env.boxes.length;

    env.frame.m_LayersManager.onPopupSelection(GERBER_LAYER_WIDGET_ID.ID_LAYER_DELETE);
    await Promise.resolve();

    // RemoveImage erases the slot and the rest move up (`RemapLayers`), so
    // the third file is the second layer now and the third is empty.
    const name = (i: number): string | undefined =>
      env.frame.GetGbrImage(i)?.m_FileName.split('/').pop();
    expect([name(0), name(1), name(2)]).toEqual(['a.gbr', 'c.gbr', undefined]);
    expect(env.boxes.length).toBe(asked);
  });
});

/**
 * EDA_BASE_FRAME::HandleUpdateUIEvent (`eda_base_frame.cpp:638-702`), which
 * answers the page's wxEVT_UPDATE_UI for each control.
 */
describe('EDA_BASE_FRAME::HandleUpdateUIEvent', () => {
  it('skips a control nobody registered conditions for', () => {
    const event = new wxUpdateUIEvent(ACTIONS.undo.GetUIId());

    expect(env.frame.ProcessUpdateUI(event)).toBe(false);
    expect(event.GetSetChecked()).toBe(false);
  });

  it('checks only a checkable control', () => {
    const checkable = new wxUpdateUIEvent(ACTIONS.toggleGrid.GetUIId(), true);
    const plain = new wxUpdateUIEvent(ACTIONS.toggleGrid.GetUIId(), false);

    env.frame.ProcessUpdateUI(checkable);
    env.frame.ProcessUpdateUI(plain);

    expect([checkable.GetSetChecked(), checkable.GetChecked()]).toEqual([true, true]);
    expect(plain.GetSetChecked()).toBe(false);
    expect([plain.GetEnabled(), plain.GetShown()]).toEqual([true, true]);
  });

  it('titles Undo "Undo", with the description only while enabled', () => {
    env.frame.RegisterUIUpdateHandler(
      ACTIONS.undo,
      new ACTION_CONDITIONS().Enable((): boolean => env.frame.GetUndoCommandCount() > 0),
    );
    const event = new wxUpdateUIEvent(ACTIONS.undo.GetUIId());

    env.frame.ProcessUpdateUI(event);

    expect(event.GetText()).toBe('Undo');
    expect(event.GetEnabled()).toBe(false);
  });
});

/**
 * GERBVIEW_CONTROL::Print and DIALOG_PRINT_GERBVIEW
 * (`gerbview/dialogs/dialog_print_gerbview.cpp`).
 */
describe('DIALOG_PRINT_GERBVIEW', () => {
  const load3 = async (): Promise<void> => {
    await env.frame.LoadGerberFiles(put('a.gbr', SAMPLE));
    await env.frame.LoadGerberFiles(put('b.gbr', SECOND));
    await env.frame.LoadGerberFiles(put('c.gbr', SECOND));
  };
  const open = async (): Promise<DIALOG_PRINT_GERBVIEW> => {
    env.frame.GetToolManager()!.RunAction(ACTIONS.print);
    await Promise.resolve();
    return env.prints.at(-1)!;
  };

  it('Print opens it with the drawing sheet forced off and hidden (:283-286)', async () => {
    await load3();
    const dlg = await open();

    expect(dlg.m_titleBlockShown).toBe(false);
    expect(dlg.m_titleBlock).toBe(false);
  });

  it('lists each loaded file by its full name, and checks all of them at first', async () => {
    await load3();
    const dlg = await open();

    // BOARD_PRINTOUT_SETTINGS starts with m_LayerSet.set(): every layer.
    expect(dlg.m_layerLists[0]!.items).toEqual(['a.gbr', 'b.gbr', 'c.gbr']);
    expect(dlg.m_layerLists[0]!.checked).toEqual([true, true, true]);
    expect(dlg.m_layerLists[1]!.items).toEqual([]);
  });

  it('prints one page per checked layer', async () => {
    await load3();
    const dlg = await open();
    dlg.m_layerLists[0]!.checked[1] = false;

    expect(dlg.onPrintButtonClick()).toEqual({ info: null, error: null });
    expect(dlg.settings().m_pageCount).toBe(2);
    expect([0, 1, 2].map((l) => dlg.settings().m_LayerSet.test(l))).toEqual([true, false, true]);
  });

  it('refuses to print nothing (dialog_print_generic.cpp:283-287)', async () => {
    await load3();
    const dlg = await open();
    dlg.onDeselectAllClick();

    expect(dlg.onPrintButtonClick().error).toBe('Nothing to print');

    dlg.onSelectAllClick();
    expect(dlg.onPrintButtonClick().error).toBe(null);
  });

  it('carries the mirror, the output mode and the scale into the settings', async () => {
    await load3();
    const dlg = await open();
    dlg.m_checkboxMirror = true;
    dlg.m_outputMode = 0;
    dlg.m_scaleMode = 'fit';

    dlg.onPrintButtonClick();

    expect(dlg.settings().m_Mirror).toBe(true);
    expect(dlg.settings().m_blackWhite).toBe(false);
    expect(dlg.settings().m_scale).toBe(0);
  });

  it('warns and clamps a custom scale out of range, and still prints', async () => {
    await load3();
    const dlg = await open();
    dlg.m_scaleMode = 'custom';
    dlg.m_customScale = '500';

    const { info, error } = dlg.onPrintButtonClick();

    expect(info).toContain('too large');
    expect(error).toBe(null);
    expect(dlg.settings().m_scale).toBe(100);
  });

  it('keeps nothing in gerbview.json: Print builds fresh settings each time', async () => {
    await load3();
    const before = JSON.stringify(env.frame.gvconfig().m_Printing);
    const dlg = await open();
    dlg.m_checkboxMirror = true;
    dlg.onPrintButtonClick();

    expect(JSON.stringify(env.frame.gvconfig().m_Printing)).toBe(before);
    expect((await open()).m_checkboxMirror).toBe(false);
  });
});

/**
 * `listBox->Check( ii, true )` checks by LAYER index, not the file's row
 * (`dialog_print_gerbview.cpp:136-137`): with slot 0 empty, the file in slot 1
 * is row 0 but the check goes to row 1, past the list's end, and is lost.
 * Reproduced, because it is what GerbView does.
 */
describe('DIALOG_PRINT_GERBVIEW::TransferDataToWindow across a gap', () => {
  it('checks by layer index, so the file after the gap stays unchecked', () => {
    const image = { m_FileName: '/tmp/x/b.gbr' };
    const list = {
      ImagesMaxCount: () => 3,
      GetGbrImage: (i: number) => (i === 1 ? image : null),
    };
    const frame = { GetGerberLayout: () => ({ GetImagesList: () => list }) };
    const settings = new BOARD_PRINTOUT_SETTINGS(new PAGE_INFO(PAGE_SIZE_TYPE.GERBER));
    const dlg = new DIALOG_PRINT_GERBVIEW(frame as never, settings);

    dlg.TransferDataToWindow();

    expect(dlg.m_layerLists[0]!.items).toEqual(['b.gbr']);
    expect(dlg.m_layerLists[0]!.checked).toEqual([false]);
  });
});
