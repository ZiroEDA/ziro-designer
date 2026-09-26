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
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import { wxChoice } from '@ziroeda/common/wx/choice.js';
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

  const canvas = {
    GetGAL: () => gal,
    GetView: () => view,
    GetViewControls: () => vc,
    GetBackend: () => GAL_TYPE.GAL_TYPE_OPENGL,
    SwitchBackend: () => true,
    StartDrawing: () => {},
    SetEventDispatcher: () => {},
    SetDrawingSheet: () => {},
    SetFocus: () => {},
    Refresh: () => {},
    ForceRefresh: () => {},
    SetCurrentCursor: () => {},
    SetHighContrastLayer: () => {},
    GetDefaultViewBBox: () => new BOX2I(),
    GetClientSize: () => ({ x: 1000, y: 800 }),
    Destroy: () => {},
  };

  const boxes: string[] = [];
  const host: GERBVIEW_FRAME_HOST = {
    FileDialog: () => Promise.resolve(null),
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
    SingleChoiceDialog: () => Promise.resolve(),
  };

  frame.SetHost(host);
  frame.m_SelLayerBox = new GBR_LAYER_BOX_SELECTOR(frame);
  frame.m_DCodeSelector = new DCODE_SELECTION_BOX();
  frame.m_SelComponentBox = new wxChoice();
  frame.m_SelNetnameBox = new wxChoice();
  frame.m_SelAperAttributesBox = new wxChoice();
  frame.AttachCanvas(canvas as unknown as EDA_DRAW_PANEL_GAL as never);

  return { frame, view, boxes };
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
