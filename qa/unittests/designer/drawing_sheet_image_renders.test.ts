// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A sheet with an image on it has to be drawn by something that draws images.
 *
 * `GlRecorder.drawImage` is a no-op — its own comment said "images are not
 * recorded yet ... which is why the backend is not yet the default". The
 * backend then became the default in `DrawingSheetCanvas` and the comment's
 * condition went with it, so placing an image put a real bitmap item in the
 * sheet, saved it, reloaded it, and drew nothing. Reported as "the image
 * inserting tool not working"; the tool was fine.
 *
 * Two halves are pinned here, because either alone passes with the bug:
 *
 *  1. the raster painter really does draw a bitmap item (it always did), and
 *  2. the canvas actually routes a sheet containing one to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DsDrawItem } from '@ziroeda/common';
import { drawDrawingSheetItems } from '@ziroeda/common';

const PAINTER = readFileSync(
  fileURLToPath(new URL('../../../common/src/drawing_sheet/ds_painter.ts', import.meta.url)),
  'utf8',
);

const CANVAS = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx', import.meta.url),
  ),
  'utf8',
);

describe('the raster painter', () => {
  /** A context double that records only what this test is about. */
  function recorder() {
    const calls: string[] = [];
    const ctx = {
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      lineCap: '',
      lineJoin: '',
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => calls.push('stroke'),
      strokeRect: () => calls.push('strokeRect'),
      fill: () => {},
      setLineDash: () => {},
      measureText: () => ({ width: 0 }),
      fillText: () => {},
      strokeText: () => {},
      drawImage: () => calls.push('drawImage'),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  const bitmap = (pngB64: string): DsDrawItem[] => [
    {
      kind: 'bitmap',
      src: 0,
      at: { x: 1000, y: 1000 },
      ppi: 300,
      scale: 1,
      pxW: 32,
      pxH: 32,
      pngB64,
    } as unknown as DsDrawItem,
  ];

  /** A real PNG, so the decode path is the one under test. */
  const PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAbElEQVR42u2UwQoAIAhD/f+fLoKCCJUubhF7l6DL1rSZCSHET7QJTXwcywdNHG7CE4eZyMTLDUj8ybkjXs75dkswMgGN/TQBKZwz8n+rtm1E96Wxe8tGiRpqwIkWE3eyYAavVmoCWsKbHqikA0DGYK6k3QKyAAAAAElFTkSuQmCC';

  it('survives a payload that is not base64 at all', () => {
    // `atob` throws InvalidCharacterError, and this runs inside the paint
    // loop: unguarded, one corrupt `(data ...)` blob in a .kicad_wks blanked
    // the whole canvas instead of losing one logo.
    const { ctx, calls } = recorder();
    expect(() =>
      drawDrawingSheetItems(ctx, bitmap('not-a-real-png!!'), new Set(), { minWidth: 1 }),
    ).not.toThrow();
    expect(calls).toContain('strokeRect');
  });

  it('falls back to a dashed placeholder while the PNG has not decoded', () => {
    // `getBitmapImage` starts the decode and returns null until it lands, and
    // the painter outlines the box rather than drawing nothing — a rectangle
    // the GL recorder CAN record, which is why an undecoded image is not the
    // case the canvas has to divert.
    const { ctx, calls } = recorder();
    drawDrawingSheetItems(ctx, bitmap(PNG_B64), new Set(), { minWidth: 1 });
    expect(calls).toContain('strokeRect');
    expect(calls).not.toContain('drawImage');
  });

  it('draws the image once it HAS decoded — the call the recorder swallows', () => {
    // Straight at `drawBitmap`'s decoded branch: give the painter a cache hit
    // by asking twice is not possible without a real ImageBitmap here, so the
    // contract is pinned at the call the painter makes, which is drawImage and
    // not strokeRect. If this ever became strokeRect the GL path would be
    // "fine" and the picture still absent.
    expect(PAINTER).toContain('ctx.drawImage(decoded.img, x, y, w, h);');
  });
});

describe('the canvas', () => {
  it('keeps a sheet carrying a decoded image off the GL layer', () => {
    // The condition itself, because the no-op it works around is invisible:
    // nothing throws, nothing logs, the image is simply not there.
    expect(CANVAS).toMatch(
      /const hasImage = drawsRef\.current\.some\(\(d\) => d\.kind === 'bitmap' && !!d\.pngB64\)/,
    );
  });

  it('has that check inside the GL gate, not merely present in the file', () => {
    // Per-occurrence: a `hasImage` computed and never consulted is exactly the
    // shape of a test that cannot fail.
    const at = CANVAS.indexOf('if (\n        GL_RENDERER');
    expect(at, 'the GL gate is not the multi-line form this reads').toBeGreaterThanOrEqual(0);
    const gate = CANVAS.slice(at, CANVAS.indexOf('sheetOnGl = true;', at));
    expect(gate).toContain('!hasImage');
  });

  it('still lets an image-free sheet use the GL layer', () => {
    // The fallback must be conditional. Diverting every sheet would "fix" the
    // image and throw away the reason the layer exists.
    const at = CANVAS.indexOf('if (\n        GL_RENDERER');
    const gate = CANVAS.slice(at, CANVAS.indexOf('sheetOnGl = true;', at));
    expect(gate).toContain('GL_RENDERER');
    expect(gate).not.toMatch(/GL_RENDERER && false/);
  });
});

describe('the recorder that made this necessary', () => {
  const REC = readFileSync(
    fileURLToPath(new URL('../../../designer/src/render/gl/recorder.ts', import.meta.url)),
    'utf8',
  );

  it('still says out loud that drawImage draws nothing', () => {
    expect(REC).toMatch(/drawImage\(\): void \{\}/);
    // The stale version of this comment read as a live precondition long after
    // it had stopped being true, which is what let the bug ship. So the thing
    // to pin is not the absence of that sentence — it wrapped across two lines
    // and no substring test could see it — but the presence of the warning
    // that replaced it.
    expect(REC).toContain('A caller that can be handed one must check');
  });

  it('names the two callers that still drop an image', () => {
    // One `expect` per call site, not a single "mentions renderer" check: the
    // point of the list is that BOTH are recorded, and a per-file test of a
    // per-occurrence rule passes on either one alone.
    expect(REC).toContain('editors/schematic/render/renderer.ts:1076');
    expect(REC).toContain('editors/pcb/renderBoard.ts:2034');
  });
});
