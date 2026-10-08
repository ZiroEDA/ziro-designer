// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAWING_TOOLS::PlaceImage (sch_drawing_tools.cpp:1110) on the live model: an image file
 * chosen, following the cursor, placed by a click; or a given (pasted) bitmap placed once.
 */
import { resolve } from 'node:path';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_BITMAP } from '@ziroeda/eeschema/sch_bitmap.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

let unmount: () => void = () => {};

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  const fs = new MEMORY_FILESYSTEM();
  fs.Write('art/pic.png', new WX_IMAGE(8, 6).SaveFilePng()!);
  fs.Write('art/broken.png', new Uint8Array([1, 2, 3]));
  unmount = wxMountFileSystem('/complex_hierarchy', fs);
});
afterEach(() => {
  unmount();
  SetPgm(null);
});

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const errors: string[] = [];
  const h = schToolHarness(schFrame({ displayError: (m) => errors.push(m), ...aHooks }));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  // KiCad always has COMMON_SETTINGS; immediate_actions defaults to false here so no prime click.
  Pgm().SetCommonSettings({ m_Input: { immediate_actions: false } } as never);
  const bitmaps = () =>
    [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_BITMAP_T)] as SCH_BITMAP[];
  return { ...h, mgr: h.frame.GetToolManager()!, bitmaps, errors };
}

describe('PlaceImage', () => {
  it('a click asks for the image, it follows the cursor, and the next click places it as one undo step', async () => {
    let title = '';
    const h = setUp({
      fileDialog: (aTitle) => {
        title = aTitle;
        return '/complex_hierarchy/art/pic.png';
      },
    });
    const undo = h.frame.GetUndoCommandCount();

    h.mgr.RunAction(SCH_ACTIONS.placeImage);
    click(h, P(1, 1));
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(6, 4));
    click(h, P(6, 4));
    await flush();

    expect(title).toBe('Choose Image');
    const placed = h.bitmaps();
    expect(placed.length).toBe(1);
    expect(placed[0]!.GetPosition()).toEqual(P(6, 4));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('the folder of the chosen image is offered next time', async () => {
    const dirs: string[] = [];
    const h = setUp({
      fileDialog: (_aTitle, aDir) => {
        dirs.push(aDir);
        return '/complex_hierarchy/art/pic.png';
      },
    });

    h.mgr.RunAction(SCH_ACTIONS.placeImage);
    click(h, P(1, 1));
    await flush();
    click(h, P(2, 2));
    await flush();
    // Placing hands over to the point editor, which ends this tool; start it again.
    h.mgr.RunAction(SCH_ACTIONS.placeImage);
    click(h, P(3, 3));
    await flush();

    expect(dirs).toEqual(['', '/complex_hierarchy/art']);
  });

  it('cancelling the file dialog places nothing', async () => {
    const h = setUp({ fileDialog: () => null });

    h.mgr.RunAction(SCH_ACTIONS.placeImage);
    click(h, P(1, 1));
    await flush();

    expect(h.bitmaps()).toEqual([]);
  });

  it('a file that is not an image says it could not be loaded', async () => {
    const h = setUp({ fileDialog: () => '/complex_hierarchy/art/broken.png' });

    h.mgr.RunAction(SCH_ACTIONS.placeImage);
    click(h, P(1, 1));
    await flush();

    expect(h.errors).toEqual(["Could not load image from '/complex_hierarchy/art/broken.png'."]);
    expect(h.bitmaps()).toEqual([]);
  });

  it('Escape while the image follows the cursor drops it', async () => {
    const h = setUp({ fileDialog: () => '/complex_hierarchy/art/pic.png' });

    h.mgr.RunAction(SCH_ACTIONS.placeImage);
    click(h, P(1, 1));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();

    expect(h.bitmaps()).toEqual([]);
  });

  it('given a bitmap (a pasted image), it places that one and the tool ends', async () => {
    const h = setUp();
    const bitmap = new SCH_BITMAP();
    bitmap.GetReferenceImage().SetImage(new WX_IMAGE(4, 4));
    h.h.mouse = P(2, 2);

    h.mgr.RunAction(SCH_ACTIONS.placeImage, bitmap);
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(9, 9));
    click(h, P(9, 9));
    await flush();

    expect(h.bitmaps()).toEqual([bitmap]);
    expect(bitmap.GetPosition()).toEqual(P(9, 9));
    // The tool has ended: another click places nothing more.
    click(h, P(12, 12));
    await flush();
    expect(h.bitmaps().length).toBe(1);
  });
});
