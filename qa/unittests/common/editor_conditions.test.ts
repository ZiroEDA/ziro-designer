// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDITOR_CONDITIONS` (`common/tool/editor_conditions.cpp`): each condition
 * reads the one frame state its helper names, live - built once in
 * setupUIConditions and asked again on every UI update, so a condition that
 * captured the value at build time would be stuck.
 */
import { describe, expect, it } from 'vitest';
import { CROSS_HAIR_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import {
  EDITOR_CONDITIONS,
  type EDITOR_CONDITIONS_DRAW_FRAME,
} from '@ziroeda/common/tool/editor_conditions.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';

function frame() {
  const state = {
    modified: false,
    undo: 0,
    redo: 0,
    units: 'mm' as 'mm' | 'in' | 'mils',
    current: null as TOOL_ACTION | null,
    grid: false,
    overrides: false,
    polar: false,
    cursor: CROSS_HAIR_MODE.SMALL_CROSS,
    bboxes: false,
  };
  const f: EDITOR_CONDITIONS_DRAW_FRAME = {
    IsContentModified: () => state.modified,
    GetUndoCommandCount: () => state.undo,
    GetRedoCommandCount: () => state.redo,
    GetUserUnits: () => state.units,
    IsCurrentTool: (a) => a === state.current,
    ToolStackIsEmpty: () => state.current === null,
    IsGridVisible: () => state.grid,
    IsGridOverridden: () => state.overrides,
    GetShowPolarCoords: () => state.polar,
    GetGalDisplayOptions: () => ({ GetCursorMode: () => state.cursor }),
    GetCanvas: () => ({
      GetView: () => ({
        GetPainter: () => ({ GetSettings: () => ({ GetDrawBoundingBoxes: () => state.bboxes }) }),
      }),
    }),
    IsScriptingConsoleVisible: () => false,
  };
  return { state, cond: new EDITOR_CONDITIONS(f) };
}

const SEL = new SELECTION();

describe('EDITOR_CONDITIONS', () => {
  it('reads the frame live, not the value at build time', () => {
    const { state, cond } = frame();
    const modified = cond.ContentModified();
    const grid = cond.GridVisible();

    expect([modified(SEL), grid(SEL)]).toEqual([false, false]);
    state.modified = true;
    state.grid = true;
    expect([modified(SEL), grid(SEL)]).toEqual([true, true]);
  });

  it('undo and redo are "more than zero" (:163-172)', () => {
    const { state, cond } = frame();

    expect(cond.UndoAvailable()(SEL)).toBe(false);
    state.undo = 1;
    expect(cond.UndoAvailable()(SEL)).toBe(true);
    expect(cond.RedoAvailable()(SEL)).toBe(false);
    state.redo = 2;
    expect(cond.RedoAvailable()(SEL)).toBe(true);
  });

  it('checks exactly one of the three units', () => {
    const { state, cond } = frame();
    const mm = cond.Units('mm');
    const inch = cond.Units('in');
    const mils = cond.Units('mils');

    state.units = 'in';
    expect([mm(SEL), inch(SEL), mils(SEL)]).toEqual([false, true, false]);
  });

  it('checks exactly one of the three cursors', () => {
    const { state, cond } = frame();
    const small = cond.CursorSmallCrosshairs();
    const full = cond.CursorFullCrosshairs();
    const diag = cond.Cursor45Crosshairs();

    expect([small(SEL), full(SEL), diag(SEL)]).toEqual([true, false, false]);
    state.cursor = CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL;
    expect([small(SEL), full(SEL), diag(SEL)]).toEqual([false, false, true]);
    state.cursor = CROSS_HAIR_MODE.FULLSCREEN_CROSS;
    expect([small(SEL), full(SEL), diag(SEL)]).toEqual([false, true, false]);
  });

  it('tells the current tool from another, and an empty stack', () => {
    const { state, cond } = frame();
    const a = {} as TOOL_ACTION;
    const b = {} as TOOL_ACTION;

    expect(cond.NoActiveTool()(SEL)).toBe(true);
    state.current = a;
    expect(cond.CurrentTool(a)(SEL)).toBe(true);
    expect(cond.CurrentTool(b)(SEL)).toBe(false);
    expect(cond.NoActiveTool()(SEL)).toBe(false);
  });

  it('reads polar coordinates, grid overrides and bounding boxes', () => {
    const { state, cond } = frame();

    state.polar = true;
    state.overrides = true;
    state.bboxes = true;
    expect([
      cond.PolarCoordinates()(SEL),
      cond.GridOverrides()(SEL),
      cond.BoundingBoxes()(SEL),
    ]).toEqual([true, true, true]);
  });
});
