// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Leaving the canvas does not clear the cursor.
 *
 * `WX_VIEW_CONTROLS::onLeave` is one line
 * (`common/view/wx_view_controls.cpp:625-630`):
 *
 *     void WX_VIEW_CONTROLS::onLeave( wxMouseEvent& aEvent )
 *     {
 *     #if !defined USE_MOUSE_CAPTURE
 *         onMotion( aEvent );
 *     #endif
 *     }
 *
 * Leaving is treated as one more motion and nothing is reset. KiCad's
 * crosshair is the TOOL cursor held by `VIEW_CONTROLS`, not the mouse pointer,
 * so there is nothing to clear when the pointer goes away: the crosshair stays
 * drawn at the edge, `GetCursorPosition()` keeps its last value, and every
 * frame's `UpdateStatusBar` keeps printing coordinates from it. Bring the
 * pointer back and it simply resumes.
 *
 * Four of our canvases cleared it instead — `onCursorMove(null)` plus nulling
 * the cursor ref — so the crosshair vanished and the status bar went to
 * dashes the moment the pointer crossed the edge. That is four copies of one
 * divergence, which is what happens when a shared upstream behaviour is
 * re-implemented per editor.
 *
 * This is a source check because the behaviour is an ABSENCE, and it is
 * per-occurrence: it names every canvas that regresses rather than reporting
 * that "a canvas somewhere" does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../designer/src/editors/', import.meta.url));

/** Every canvas that draws a crosshair and reports a cursor to a status bar. */
const CANVASES = [
  'drawingsheet/DrawingSheetCanvas.tsx',
  'gerbview/GerberCanvas.tsx',
  'symbol/SymbolCanvas.tsx',
  'footprint/FootprintCanvas.tsx',
];

/**
 * A canvas's source with comments blanked.
 *
 * The strip is not cosmetic: each of these files now carries a comment saying
 * why there is no `pointerleave` handler, and the first version of this test
 * matched that comment and reported the fixed file as an offender. Prose about
 * a rule must not read as the rule — that is one of the four shapes in
 * CLAUDE.md, and it caught this test on its first run.
 */
const read = (rel: string): string =>
  readFileSync(SRC + rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('a canvas keeps its cursor when the pointer leaves', () => {
  it('found the canvases, so this cannot pass by scanning nothing', () => {
    for (const rel of CANVASES) {
      // Each one must actually be a canvas that reports a cursor, or the
      // absence-check below is vacuous for it.
      expect(read(rel), rel).toMatch(/onCursorMove/);
    }
  });

  it('none of them clears the cursor on leave', () => {
    const offenders = CANVASES.filter((rel) => {
      const src = read(rel);
      const at = src.indexOf('PointerLeave');
      const at2 = src.indexOf("'pointerleave'");
      return at >= 0 || at2 >= 0;
    });
    expect(
      offenders,
      'upstream treats a leave as one more motion and resets nothing — ' +
        'a leave handler here means the crosshair vanishes and the status bar ' +
        'goes to dashes at the canvas edge',
    ).toStrictEqual([]);
  });

  it('and none of them nulls the cursor position anywhere else', () => {
    // The other half: a handler could be renamed and still clear. This looks
    // for the clearing itself, wherever it is.
    const offenders = CANVASES.filter((rel) => /onCursorMove\?\.\(null\)/.test(read(rel)));
    expect(offenders, 'reports no cursor to the status bar').toStrictEqual([]);
  });
});
