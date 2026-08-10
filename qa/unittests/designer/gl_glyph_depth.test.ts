// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Bitmap text is drawn against the depth buffer, and only bitmap text is.
 *
 * KiCad gives every layer a depth over one cached buffer (`VIEW::redrawRect` →
 * `SetLayerDepth`) and draws with the depth test on. For net names that is not
 * an ordering detail, it is what stops them compounding: all the glyphs of one
 * netname layer share a depth, so where two labels cross, the second one's
 * fragments fail `LESS` and the ink of one is what lands. Draw the same glyphs
 * without it and every crossing comes out brighter than its surroundings —
 * which is exactly the "text overlapping" a side-by-side against pcbnew shows.
 *
 * The rest of the pipeline must stay untouched by this. With `DEPTH_TEST`
 * disabled nothing writes depth either, so the board draws as it always did;
 * these check that it really is disabled everywhere else, and that the two
 * text passes are filed at different depths so the one drawn inside the board
 * cannot block the one drawn over it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlDevice } from '@ziroeda/designer/src/render/gl/device.js';
import {
  loadFontAtlas,
  resetFontAtlasForTest,
} from '@ziroeda/designer/src/render/gl/font_atlas.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';

const RED = { r: 1, g: 0, b: 0, a: 1 };

/** Let the device's own continuation on the shared load promise run. */
const settle = async (): Promise<void> => {
  await loadFontAtlas();
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** What the device asked the driver to do, in order. */
interface Log {
  calls: string[];
  depths: number[];
}

function fakeGl(): { gl: Record<string, unknown>; log: Log } {
  const log: Log = { calls: [], depths: [] };
  let depthLoc: object | null = null;
  const gl: Record<string, unknown> = {
    ARRAY_BUFFER: 1,
    FLOAT: 2,
    TRIANGLES: 3,
    TRIANGLE_STRIP: 4,
    COLOR_BUFFER_BIT: 5,
    BLEND: 6,
    STATIC_DRAW: 7,
    VERTEX_SHADER: 8,
    FRAGMENT_SHADER: 9,
    COMPILE_STATUS: 10,
    LINK_STATUS: 11,
    DEPTH_BUFFER_BIT: 12,
    DEPTH_TEST: 13,
    LESS: 14,
    TEXTURE0: 15,
    TEXTURE_2D: 16,
    RGB: 17,
    UNSIGNED_BYTE: 18,
    TEXTURE_MIN_FILTER: 19,
    TEXTURE_MAG_FILTER: 20,
    TEXTURE_WRAP_S: 21,
    TEXTURE_WRAP_T: 22,
    LINEAR: 23,
    CLAMP_TO_EDGE: 24,
    NO_ERROR: 0,
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribDivisor: () => {},
    vertexAttribPointer: () => {},
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    getUniformLocation: (_p: unknown, name: string) => {
      const loc = { name };
      if (name === 'u_depth') depthLoc = loc;
      return loc;
    },
    useProgram: () => {},
    uniform4f: () => {},
    uniform2f: () => {},
    uniform1i: () => {},
    uniform1f: (loc: object, v: number) => {
      if (loc === depthLoc) log.depths.push(v);
    },
    viewport: () => {},
    clearColor: () => {},
    clear: (bits: number) => {
      log.calls.push(`clear:${bits}`);
    },
    enable: (cap: number) => {
      log.calls.push(cap === 13 ? 'enable:depth' : `enable:${cap}`);
    },
    disable: (cap: number) => {
      log.calls.push(cap === 13 ? 'disable:depth' : `disable:${cap}`);
    },
    depthFunc: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    createTexture: () => ({}),
    texImage2D: () => {},
    texParameteri: () => {},
    deleteTexture: () => {},
    blendFuncSeparate: () => {},
    drawArrays: (_mode: number, first: number, count: number) => {
      log.calls.push(`draw:${first}:${count}`);
    },
    drawArraysInstanced: () => {
      log.calls.push('drawInstanced');
    },
    isContextLost: () => false,
    getError: () => 0,
    deleteBuffer: () => {},
    deleteVertexArray: () => {},
    deleteProgram: () => {},
    getExtension: () => null,
  };
  return { gl, log };
}

/** Pretend the sheet fetched and decoded, so glyph runs are not skipped. */
function stubAtlas(): void {
  resetFontAtlasForTest();
  vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => ({}) }));
  vi.stubGlobal('createImageBitmap', async () => ({ width: 512, height: 135 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetFontAtlasForTest();
});

/** A one-glyph scene. The corner values do not matter; the run kind does. */
function glyphScene(): Scene {
  const s = new Scene(true);
  s.glyph(0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, RED);
  return s;
}

describe('the depth test is on for glyphs and off for everything else', () => {
  it('leaves it disabled through a board draw with no text', async () => {
    stubAtlas();
    const { gl, log } = fakeGl();
    const device = createGlDevice({ getContext: () => gl } as unknown as HTMLCanvasElement)!;
    await settle();

    const s = new Scene(true);
    s.triangle(0, 0, 1, 0, 0, 1, RED);
    s.segment(0, 0, 1, 0, 1, -1, RED);
    device.upload(s);
    log.calls.length = 0;
    device.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);

    expect(log.calls).not.toContain('enable:depth');
    // Cleared with the colour all the same, so a stale depth from the previous
    // frame cannot reject this frame's first label.
    expect(log.calls.some((c) => c.startsWith('clear:'))).toBe(true);
  });

  it('enables it around a glyph run and disables it again after', async () => {
    stubAtlas();
    const { gl, log } = fakeGl();
    const device = createGlDevice({ getContext: () => gl } as unknown as HTMLCanvasElement)!;
    await settle();

    device.uploadText(glyphScene());
    log.calls.length = 0;
    device.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);

    const on = log.calls.indexOf('enable:depth');
    const drew = log.calls.findIndex((c) => c.startsWith('draw:'));
    const off = log.calls.lastIndexOf('disable:depth');
    expect(on).toBeGreaterThanOrEqual(0);
    expect(drew).toBeGreaterThan(on);
    expect(off).toBeGreaterThan(drew);
  });

  it('files the inner pass deeper than the one drawn over the board', async () => {
    // Both passes draw glyphs at one depth each. If they shared it, the back
    // and inner net names — drawn first, inside the board — would reject every
    // track and via label that landed on the same pixel afterwards.
    stubAtlas();
    const { gl, log } = fakeGl();
    const device = createGlDevice({ getContext: () => gl } as unknown as HTMLCanvasElement)!;
    await settle();

    const board = new Scene(true);
    board.triangle(0, 0, 1, 0, 0, 1, RED);
    board.mark('here');
    board.triangle(0, 0, 1, 0, 0, 1, RED);
    device.upload(board);
    device.uploadInner(glyphScene());
    device.uploadText(glyphScene());
    log.depths.length = 0;
    device.drawWithInner({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null, 1);

    expect(log.depths).toHaveLength(2);
    const [inner, over] = log.depths;
    expect(inner).toBeGreaterThan(over!);
  });

  it('draws no glyphs at all until the sheet has arrived', async () => {
    // An untextured quad is a black box, and a board's worth of them over every
    // pad is far worse than a frame with no net names on it.
    resetFontAtlasForTest();
    vi.stubGlobal('fetch', async () => ({ ok: false }));
    const { gl, log } = fakeGl();
    const device = createGlDevice({ getContext: () => gl } as unknown as HTMLCanvasElement)!;
    await settle();

    device.uploadText(glyphScene());
    log.calls.length = 0;
    device.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);
    expect(log.calls.filter((c) => c.startsWith('draw:'))).toHaveLength(0);
  });
});
