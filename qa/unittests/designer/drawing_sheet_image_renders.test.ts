// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The raster painter really does draw a bitmap item.
 *
 * `GlRecorder.drawImage` was once a no-op, three canvases made the GL backend
 * their default, and every image on a document stopped being drawn — reported
 * as "the image inserting tool not working"; the tool was fine. This file
 * pinned both halves of the workaround for that: the painter's own behaviour,
 * and a gate in `DrawingSheetCanvas` diverting an image-carrying sheet off the
 * GL layer.
 *
 * The recorder draws bitmaps now, so the gate is gone and the two `describe`s
 * that read it out of the canvas source went with it. What replaced them is
 * `gl_image_recording.test.ts`, which asserts the geometry, the UVs and the
 * texture identity actually reach the scene — the behaviour, where these read
 * the source. That is the better test, and it is why these are not rewritten
 * in place.
 *
 * The painter's half below is unchanged and still load-bearing: it is the
 * other end of the same path, and a canvas that routes correctly to a painter
 * that draws nothing looks exactly like the original bug.
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
