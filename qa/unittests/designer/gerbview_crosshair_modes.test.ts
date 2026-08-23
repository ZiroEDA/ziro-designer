// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's "Crosshair modes" group is THREE modes, not a two-way toggle.
 *
 * `TOOLBAR_GROUP_CONFIG( _( "Crosshair modes" ) )` holds
 * `cursorSmallCrosshairs`, `cursorFullCrosshairs` and `cursor45Crosshairs`
 * (`gerbview/toolbars_gerber.cpp:62-65`), and each handler sets one value of
 * `KIGFX::CROSS_HAIR_MODE { SMALL_CROSS, FULLSCREEN_CROSS, FULLSCREEN_DIAGONAL }`
 * (`gal_display_options.h:67-71`) via `galOpts.SetCursorMode()`.
 *
 * Akshay: clicking the button cycled three icons but only ever produced the
 * small cross and the full-window one. The frame was passing the canvas a
 * boolean `fullCrosshair`, so the diagonal mode had nothing to select — and
 * the three ids were toggling independently because only the units group had
 * mutual exclusion.
 *
 * The drawing itself was already right: `crosshairSegments` in the shared
 * `ui/grid_cursor.ts` has carried all three cases all along. Only GerbView's
 * wiring was two-valued, which is why this is a frame fix and not a GAL one.
 */
import { describe, expect, it } from 'vitest';
import {
  applyToggle,
  CROSSHAIR_GROUP,
  DEFAULT_TOGGLES,
} from '@ziroeda/designer/src/editors/gerbview/toggles.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crosshairSegments } from '@ziroeda/designer/src/ui/grid_cursor.js';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const VIEWER = src('editors/gerbview/GerberViewer.tsx');
const CANVAS = src('editors/gerbview/GerberCanvas.tsx');

describe('the frame carries a mode, not a boolean', () => {
  it('no longer passes fullCrosshair', () => {
    expect(VIEWER).not.toContain('fullCrosshair');
    expect(CANVAS).not.toContain('fullCrosshair');
  });

  it('selects all three, diagonal included', () => {
    expect(VIEWER).toContain("toggles.has('crosshair45') ? '45'");
    expect(VIEWER).toContain("toggles.has('crosshairFull') ? 'full' : 'small'");
  });

  it('makes the three exclusive, as one cursor mode must be', () => {
    // A cycling group calls onActivate with the NEXT member's id
    // (ui/Toolbar.tsx, cycleOnClick), so without this they accumulate.
    //
    // This RAN the reducer only after it was lifted out of GerberViewer.tsx.
    // While it was a useCallback in there the assertion could only read the
    // source, and a sweep that disabled the exclusion outright — leaving both
    // source strings intact — failed nothing at all. The exclusion is the thing
    // this whole change exists for.
    let on: ReadonlySet<string> = new Set(['crosshairSmall']);
    on = applyToggle(on, 'crosshairFull');
    expect([...on].sort()).toEqual(['crosshairFull']);
    on = applyToggle(on, 'crosshair45');
    expect([...on].sort()).toEqual(['crosshair45']);
    // Every member of the group, so a rule that only handles two would show.
    for (const id of CROSSHAIR_GROUP) {
      const only = applyToggle(new Set(CROSSHAIR_GROUP), id);
      expect([...only]).toEqual([id]);
    }
  });

  it('leaves a mode ON when it is activated again', () => {
    // A radio member is not a toggle: cycling back round to the one already in
    // force must not turn the crosshair off entirely, which is what an
    // `else if (has) delete` fallthrough would do.
    expect([...applyToggle(new Set(['crosshair45']), 'crosshair45')]).toEqual(['crosshair45']);
  });

  it('does not touch the OTHER buttons, grouped or not', () => {
    // A reducer that cleared everything would satisfy the assertions above.
    const before = new Set(['crosshairSmall', 'toggleGrid', 'unitsMm', 'showLayerManager']);
    const after = applyToggle(before, 'crosshair45');
    expect([...after].sort()).toEqual(['crosshair45', 'showLayerManager', 'toggleGrid', 'unitsMm']);
    // ...and a plain toggle still flips rather than replacing its neighbours.
    expect([...applyToggle(after, 'toggleGrid')].sort()).toEqual([
      'crosshair45',
      'showLayerManager',
      'unitsMm',
    ]);
  });

  it('opens on SMALL_CROSS, the GAL constructor default', () => {
    // m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )  gal_display_options.cpp:53
    expect(DEFAULT_TOGGLES.has('crosshairSmall')).toBe(true);
    // Exactly one of the group, or the frame opens with two cursors asked for.
    expect(CROSSHAIR_GROUP.filter((id) => DEFAULT_TOGGLES.has(id))).toEqual(['crosshairSmall']);
  });

  it('hands the mode the toolbar picked to the canvas', () => {
    // Source-only, and said so: there is no DOM test environment here, so the
    // prop cannot be observed arriving. A sweep hardcoding `mode: 'small'` in
    // GerberCanvas.tsx failed nothing, because no test read that file at all.
    expect(CANVAS).toContain('crosshairMode: CrosshairMode;');
    expect(CANVAS).toContain('mode: crosshairRef.current,');
    expect(CANVAS).not.toMatch(/mode:\s*'(small|full|45)'/);
  });
});

describe('the geometry each mode draws', () => {
  const cursor = { x: 100, y: 50 };

  it('SMALL_CROSS is 80 logical px across, centred', () => {
    // `const int cursorSize = 80` (opengl_gal.cpp:2841), so each arm is 40.
    const s = crosshairSegments('small', cursor, 400, 300, 1);
    expect(s).toEqual([
      { x1: 60, y1: 50, x2: 140, y2: 50 },
      { x1: 100, y1: 10, x2: 100, y2: 90 },
    ]);
  });

  it('FULLSCREEN_CROSS spans the viewport through the cursor', () => {
    // cursorBegin = screen(0,0), cursorEnd = screen(m_screenSize)
    // (opengl_gal.cpp:2836-2837), drawn as two axis-aligned lines (:2897-2901).
    expect(crosshairSegments('full', cursor, 400, 300, 1)).toEqual([
      { x1: 0, y1: 50, x2: 400, y2: 50 },
      { x1: 100, y1: 0, x2: 100, y2: 300 },
    ]);
  });

  it('FULLSCREEN_DIAGONAL is two lines of slope +1 and -1 through the cursor', () => {
    // y = x + (cy - cx) and y = -x + (cy + cx), opengl_gal.cpp:2865-2894.
    // Ours oversizes them and clips, which cairo_gal.cpp:1222 does too.
    const [pos, neg] = crosshairSegments('45', cursor, 400, 300, 1) as [
      { x1: number; y1: number; x2: number; y2: number },
      { x1: number; y1: number; x2: number; y2: number },
    ];
    expect((pos.y2 - pos.y1) / (pos.x2 - pos.x1)).toBe(1);
    expect((neg.y2 - neg.y1) / (neg.x2 - neg.x1)).toBe(-1);
    // both pass through the cursor
    expect(pos.y1 + (cursor.x - pos.x1)).toBe(cursor.y);
    expect(neg.y1 - (cursor.x - neg.x1)).toBe(cursor.y);
  });

  it('the three are genuinely different, which the boolean could not express', () => {
    const a = crosshairSegments('small', cursor, 400, 300, 1);
    const b = crosshairSegments('full', cursor, 400, 300, 1);
    const c = crosshairSegments('45', cursor, 400, 300, 1);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });
});
