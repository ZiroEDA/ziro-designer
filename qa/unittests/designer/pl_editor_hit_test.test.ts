// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * pl_editor's three hit-test thresholds and the one place-tool rule that goes
 * with them. Every number here is read off the C++, not off our own code.
 */
import { describe, expect, it } from 'vitest';
import {
  DELETE_THRESHOLD_PX,
  EDIT_POINT_SIZE_PX,
  SELECT_THRESHOLD_PX,
  thresholdToWorld,
  toolClearsSelection,
  withinPoint,
} from '@ziroeda/designer/src/editors/drawingsheet/hit_test.js';

describe('the three thresholds are three different numbers', () => {
  /**
   * `HITTEST_THRESHOLD_PIXELS` is defined TWICE in pl_editor, with different
   * values: 3 in pl_selection_tool.cpp:44 and 5 in pl_edit_tool.cpp:414. The
   * point editor's is a third, `EDIT_POINT::POINT_SIZE` = 8
   * (include/tool/edit_points.h:194). Ours had 6 at all three call sites,
   * which is none of them.
   */
  it('is 3 for a click, 5 for the delete tool and 8 for an edit handle', () => {
    expect(SELECT_THRESHOLD_PX).toBe(3);
    expect(DELETE_THRESHOLD_PX).toBe(5);
    expect(EDIT_POINT_SIZE_PX).toBe(8);
  });

  it('makes the delete tool more forgiving than the pointer', () => {
    expect(DELETE_THRESHOLD_PX).toBeGreaterThan(SELECT_THRESHOLD_PX);
    expect(EDIT_POINT_SIZE_PX).toBeGreaterThan(DELETE_THRESHOLD_PX);
  });
});

describe('thresholdToWorld', () => {
  it('is the pixel threshold scaled by the display and divided by the view', () => {
    expect(thresholdToWorld(3, 2, 1)).toBe(1.5);
    expect(thresholdToWorld(3, 2, 2)).toBe(3);
    expect(thresholdToWorld(8, 0.5, 1)).toBe(16);
  });

  it('shrinks in world units as the view zooms in', () => {
    expect(thresholdToWorld(5, 10)).toBeLessThan(thresholdToWorld(5, 1));
  });
});

describe('EDIT_POINT::WithinPoint (edit_points.cpp:37-45)', () => {
  const p = { x: 100, y: 200 };

  it('is a square box, not a circle', () => {
    // A corner of the box is inside; a circle of the same radius would not
    // reach it. 8 * 0.99 on both axes is inside the square but at radius 11.2.
    expect(withinPoint(p, { x: 107.9, y: 207.9 }, 8)).toBe(true);
  });

  it('is STRICT on the edges — exactly on the boundary is outside', () => {
    expect(withinPoint(p, { x: 108, y: 200 }, 8)).toBe(false);
    expect(withinPoint(p, { x: 92, y: 200 }, 8)).toBe(false);
    expect(withinPoint(p, { x: 100, y: 208 }, 8)).toBe(false);
    expect(withinPoint(p, { x: 100, y: 192 }, 8)).toBe(false);
  });

  it('accepts a point just inside on each side', () => {
    expect(withinPoint(p, { x: 107.99, y: 200 }, 8)).toBe(true);
    expect(withinPoint(p, { x: 92.01, y: 200 }, 8)).toBe(true);
    expect(withinPoint(p, { x: 100, y: 207.99 }, 8)).toBe(true);
    expect(withinPoint(p, { x: 100, y: 192.01 }, 8)).toBe(true);
  });

  it('rejects a point outside on one axis even when the other is dead centre', () => {
    expect(withinPoint(p, { x: 100, y: 400 }, 8)).toBe(false);
    expect(withinPoint(p, { x: 400, y: 200 }, 8)).toBe(false);
  });
});

describe('arming a tool and the selection (pl_drawing_tools.cpp:77, :243)', () => {
  it('clears it for the four placement tools', () => {
    for (const id of ['dsAddLine', 'dsAddRect', 'dsAddText', 'dsAddBitmap'])
      expect(toolClearsSelection(id)).toBe(true);
  });

  /**
   * ZOOM_TOOL::Main only pushes itself (zoom_tool.cpp:65) and
   * PL_EDIT_TOOL::InteractiveDelete runs a PICKER_TOOL that ADDS its hover
   * pick to the selection (pl_edit_tool.cpp:428-433), so neither empties it.
   */
  it('leaves it alone for the select, zoom and delete tools', () => {
    for (const id of ['select', 'zoomTool', 'dsDelete', 'appendSheet'])
      expect(toolClearsSelection(id)).toBe(false);
  });
});
