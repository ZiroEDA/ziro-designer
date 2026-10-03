// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME::setupTools (sch_edit_frame.cpp:679), GetDocumentExtents (:2130),
 * initScreenZoom (:1866) and SetCurrentSheet (:1085), on a stand-in canvas holding a real
 * SCH_VIEW (the panel itself needs WebGL2).
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import type { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import { openProject, schToolHarness } from './support/sch_tool_harness.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function frameWithCanvas() {
  return schToolHarness();
}

function open(frame: SCH_EDIT_FRAME) {
  openProject(frame, ORACLE, 'complex_hierarchy', SHEETS);
}

describe('SCH_EDIT_FRAME::setupTools', () => {
  it('registers the common tools and routes the canvas events to its dispatcher', () => {
    const { frame, dispatcher } = frameWithCanvas();
    const mgr = frame.GetToolManager()!;
    expect(mgr.GetTool(COMMON_TOOLS)).toBeTruthy();
    expect(mgr.GetTool(ZOOM_TOOL)).toBeTruthy();
    expect(dispatcher()).toBe(frame.GetToolDispatcher());
    expect(mgr.GetView()).toBe(frame.GetCanvas()!.GetView());
  });
});

describe('SCH_EDIT_FRAME::GetDocumentExtents', () => {
  it('is the whole page by default, and the items without it', () => {
    const { frame } = frameWithCanvas();
    open(frame);
    const page = frame.GetDocumentExtents();
    // A4 landscape, 11693 x 8268 mils at 254 IU per mil
    expect(page.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(page.GetSize()).toEqual({ x: 11693 * 254, y: 8268 * 254 });
    const items = frame.GetDocumentExtents(false);
    expect(items.GetWidth()).toBeGreaterThan(0);
    expect(items.GetWidth()).toBeLessThan(page.GetWidth());
  });
});

describe('SCH_EDIT_FRAME::initScreenZoom', () => {
  it('zooms to fit on open and marks the screen', () => {
    const { frame } = frameWithCanvas();
    let fits = 0;
    const run = frame.GetToolManager()!.RunAction.bind(frame.GetToolManager()!);
    frame.GetToolManager()!.RunAction = ((a: unknown, ...rest: unknown[]) => {
      if (a === ACTIONS.zoomFitScreen) fits++;
      return (run as (...x: unknown[]) => boolean)(a, ...rest);
    }) as never;
    open(frame);
    expect(fits).toBe(1);
    expect(frame.GetScreen()!.m_zoomInitialized).toBe(true);
  });
});

describe('SCH_EDIT_FRAME::SetCurrentSheet', () => {
  it('shows the sheet it goes to, and does nothing for the one it is on', () => {
    const { frame, shown } = frameWithCanvas();
    open(frame);
    shown.length = 0;
    const sub = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    frame.SetCurrentSheet(sub);
    expect(frame.GetCurrentSheet().equals(sub)).toBe(true);
    expect(shown).toEqual([sub.LastScreen()]);
    frame.SetCurrentSheet(sub);
    expect(shown).toHaveLength(1);
  });
});
