// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Picking a tool must not rebuild the canvas.
 *
 * Reported as "the whole app flickers when I choose any tool". It was two
 * effects in `DrawingSheetCanvas`, both listing `requestDraw` in their
 * dependency array:
 *
 *  - the WebGL device. `requestDraw` is rebuilt whenever `draw` is, and `draw`
 *    closes over `activeTool`, so it is a new function on every tool click.
 *    The effect's cleanup therefore ran `dispose()` and the body re-ran
 *    `DrawingSheetGl.create( el )` — a fresh context, both programs recompiled,
 *    every buffer re-uploaded — per click.
 *  - the ResizeObserver. `observe()` fires its callback immediately, and that
 *    callback assigned `canvas.width`, which resets the drawing buffer even
 *    when the value is unchanged. So re-arming it blanked all three layers
 *    until the next animation frame.
 *
 * GerbView's canvas and the schematic's already mount their GL device once and
 * reach `requestDraw` through a ref (`GerberCanvas.tsx:385,393-394`;
 * `SchematicCanvas.tsx:2487`). The drawing sheet was the one that did not — it
 * is also the one the user saw flicker.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');

/** The body of the effect that starts with `line`, up to its dependency array. */
function effectDeps(src: string, line: string): string {
  const at = src.indexOf(line);
  expect(at, `no effect containing ${line}`).toBeGreaterThanOrEqual(0);
  const close = src.indexOf('}, [', at);
  expect(close, `effect containing ${line} has no dependency array`).toBeGreaterThan(at);
  return src.slice(close + 3, src.indexOf(']', close) + 1);
}

describe('the WebGL device', () => {
  it('is mounted once, not per tool click', () => {
    // `[requestDraw]` here is the flash: a new requestDraw per tool click
    // disposes and recreates the context.
    expect(effectDeps(CANVAS, 'DrawingSheetGl.create(el)')).toBe('[]');
  });

  it('still reaches the live requestDraw for a lost/restored context', () => {
    // Mounting once must not freeze the redraw at the first render's closure:
    // a context restored after a loss has to repaint with the CURRENT view.
    const at = CANVAS.indexOf('DrawingSheetGl.create(el)');
    const body = CANVAS.slice(at, CANVAS.indexOf('}, [', at));
    expect(body).toContain('requestDrawRef.current()');
    expect(body).not.toMatch(/[^.]\brequestDraw\(\)/);
  });
});

describe('the ResizeObserver', () => {
  it('is mounted once too — observe() fires immediately', () => {
    expect(effectDeps(CANVAS, 'new ResizeObserver(')).toBe('[dpr]');
  });

  it('assigns width and height only when they changed', () => {
    // Assigning `canvas.width` resets the drawing buffer even to the same
    // value, so an unconditional assignment is one blank frame per callback.
    const at = CANVAS.indexOf('new ResizeObserver(');
    const body = CANVAS.slice(at, CANVAS.indexOf('ro.observe(', at));
    expect(body).toMatch(/if \(el\.width !== w\) el\.width = w;/);
    expect(body).toMatch(/if \(el\.height !== h\) el\.height = h;/);
    // Per-occurrence: no *unguarded* assignment may survive anywhere in it.
    for (const m of body.matchAll(/(^|[^)] )el\.(width|height) = /gm)) {
      expect.unreachable(`unguarded ${m[2]} assignment in the resize callback`);
    }
  });
});
