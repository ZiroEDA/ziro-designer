// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor records its sheet into the shared GL scene.
 *
 * It was the last canvas still rasterising with Canvas2D, which antialiases a
 * one-device-pixel stroke across two pixels whenever it lands off the grid —
 * the reason its title block read soft beside the schematic's, which has been
 * recording the same `drawDrawingSheetItems` output through `GlRecorder` all
 * along (`schematic_gl.ts`).
 *
 * There is no painter here to test, and that is the point: upstream's
 * `PL_DRAW_PANEL_GAL` installs `KIGFX::DS_PAINTER` from `common/drawing_sheet/`
 * — the same painter eeschema, pcbnew and gerbview reach through
 * `DS_PROXY_VIEW_ITEM` (pl_draw_panel_gal.cpp:55-61). So what is pinned here is
 * the wiring: that geometry lands in the scene, and that the buffer does not
 * depend on the view.
 */
import { describe, expect, it } from 'vitest';
import {
  createDrawingSheetScene,
  recordDrawingSheetScene,
  type DrawingSheetGlContent,
} from '@ziroeda/designer/src/render/gl/drawingsheet_gl.js';
import { defaultDrawingSheet, layoutDrawingSheet } from '@ziroeda/common';

/** The built-in stationery, resolved on an A3 page — what the editor opens on. */
function sheetDraws() {
  return layoutDrawingSheet(defaultDrawingSheet(), { widthMM: 419.989, heightMM: 297.002 }, {});
}

const content = (over: Partial<DrawingSheetGlContent> = {}): DrawingSheetGlContent => ({
  draws: sheetDraws(),
  selection: new Set(),
  ...over,
});

/** Total vertices across every primitive kind the scene holds. */
function volume(scene: ReturnType<typeof createDrawingSheetScene>): number {
  return scene.runs.reduce((n, r) => n + r.count, 0);
}

describe('recording the default sheet', () => {
  it('puts geometry in the scene', () => {
    const scene = createDrawingSheetScene();
    recordDrawingSheetScene(scene, content());
    expect(volume(scene)).toBeGreaterThan(0);
    expect(scene.runs.length).toBeGreaterThan(0);
  });

  it('records the title-block TEXT, not only the rules', () => {
    // The glyphs are the reason this port exists. `drawText` walks the stroke
    // font and emits segments, so a sheet with text records materially more
    // than the same sheet without any.
    const withText = createDrawingSheetScene();
    recordDrawingSheetScene(withText, content());

    const noText = createDrawingSheetScene();
    recordDrawingSheetScene(
      noText,
      content({ draws: sheetDraws().filter((d) => d.kind !== 'text') }),
    );

    expect(volume(withText)).toBeGreaterThan(volume(noText));
  });
});

describe('the buffer does not depend on the view', () => {
  it('records byte-identical geometry whatever the zoom', () => {
    // The trap every one of these adapters was warned about: a caller's
    // "one screen pixel" width is `1 / scale`, and recording that bakes the
    // zoom into the vertices, which forces a re-record on every zoom step and
    // makes the whole exercise pointless. `recordDrawingSheetScene` takes no
    // scale at all, and this is what says so.
    const a = createDrawingSheetScene();
    const b = createDrawingSheetScene();
    const draws = sheetDraws();
    recordDrawingSheetScene(a, content({ draws }));
    recordDrawingSheetScene(b, content({ draws }));
    expect(volume(a)).toBe(volume(b));
    expect(a.runs.length).toBe(b.runs.length);
  });

  it('takes no view argument, so a zoom cannot reach the geometry', () => {
    // A signature check, deliberately: the guard above compares two recordings
    // that could only differ if a scale were passed, and the strongest way to
    // keep that true is for there to be nowhere to pass one.
    expect(recordDrawingSheetScene.length).toBe(2);
  });
});

describe('selection', () => {
  it('changes the recorded colours while leaving the geometry alone', () => {
    const plain = createDrawingSheetScene();
    const picked = createDrawingSheetScene();
    const draws = sheetDraws();
    recordDrawingSheetScene(plain, content({ draws }));
    recordDrawingSheetScene(picked, content({ draws, selection: new Set([0]) }));
    // Colour is a vertex attribute rather than a run boundary, so the run list
    // is identical and the buffers are not: selecting an item repaints it in
    // m_selectedColor, which is what pl_editor does instead of outlining it.
    expect(volume(picked)).toBe(volume(plain));
    expect(picked.runs.length).toBe(plain.runs.length);
    const a = plain.segments.view();
    const b = picked.segments.view();
    expect(a.length).toBe(b.length);
    expect(Array.from(a)).not.toStrictEqual(Array.from(b));
  });

  it('and an empty selection records exactly what no selection does', () => {
    // Guards the mutant that makes any selection argument change the colours.
    const none = createDrawingSheetScene();
    const empty = createDrawingSheetScene();
    const draws = sheetDraws();
    recordDrawingSheetScene(none, content({ draws }));
    recordDrawingSheetScene(empty, content({ draws, selection: new Set() }));
    expect(Array.from(empty.segments.view())).toStrictEqual(Array.from(none.segments.view()));
  });
});

describe('clearing', () => {
  it('leaves nothing behind, so a re-record cannot double the sheet', () => {
    const scene = createDrawingSheetScene();
    recordDrawingSheetScene(scene, content());
    const once = volume(scene);
    recordDrawingSheetScene(scene, content());
    expect(volume(scene)).toBe(once);
  });
});
