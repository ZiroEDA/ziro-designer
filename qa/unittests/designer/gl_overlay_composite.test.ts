// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KiCad's `TARGET_OVERLAY` compositing, and the GL layer that reproduces it.
 *
 * An overlay layer in KiCad is rendered into its own buffer — cleared to alpha
 * 0 — with a NON-separate `glBlendFunc( GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA )`
 * (`opengl_gal.cpp:664`), so that buffer's ALPHA comes out `a²` while its
 * colour comes out the premultiplied `a·C`. `OPENGL_COMPOSITOR::DrawBuffer`
 * blits it with `glBlendFunc( GL_ONE, GL_ONE_MINUS_SRC_ALPHA )`
 * (`opengl_compositor.cpp:338`). Between them:
 *
 *     out = a·C + (1 − a²)·dst,   clamped
 *
 * Source weight `a`, destination weight `1 − a²` — they sum to more than one,
 * so a KiCad overlay is *lighter* than a plain alpha blend and saturates over
 * bright copper. Nothing here is inferred from that reading alone: the three
 * expectations below are pixels measured off KiCad 10.0.5 on this machine, and
 * a 50% alpha blend reproduces none of them.
 */
import { describe, expect, it } from 'vitest';
import { createGlDevice } from '@ziroeda/designer/src/render/gl/device.js';
import {
  overlayTargetColor,
  parseColor,
  Scene,
  TRIANGLE_STRIDE,
} from '@ziroeda/designer/src/render/gl/scene.js';
import { overlayRecorder } from '@ziroeda/designer/src/render/gl/pcb_gl.js';
import { PCB_SPECIAL } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { selectedColor } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

/**
 * What the browser puts on screen for a premultiplied source over `dst`.
 *
 * A premultiplied canvas composites as `src + (1 − srcAlpha)·dst`, which is the
 * same equation `OPENGL_COMPOSITOR::DrawBuffer` uses — so feeding it
 * `overlayTargetColor`'s output is feeding it KiCad's overlay buffer.
 */
function composite(source: string, dst: [number, number, number]): [number, number, number] {
  const c = parseColor(source);
  const ch = (v: number, d: number): number => Math.min(255, Math.round(v * 255 + (1 - c.a) * d));
  return [ch(c.r, dst[0]), ch(c.g, dst[1]), ch(c.b, dst[2])];
}

/** The board with its area shadow under it, which is what the wash sits on. */
const BOARD: [number, number, number] = [35, 45, 58];
/** KiCad Default's F.Cu, `CSS_COLOR(200, 52, 52)`. */
const FCU: [number, number, number] = [200, 52, 52];

describe('overlayTargetColor', () => {
  it('premultiplies the colour and squares the alpha', () => {
    // rgba(255,0,5,0.5) -> colour a·C, alpha a². Fractions are kept: rounding
    // 0.5·255 to 8 bits here would quantise a second time.
    expect(overlayTargetColor('rgba(255,0,5,0.5)')).toBe('rgba(127.5,0,2.5,0.25)');
    // An opaque colour is its own premultiplied source and composites normally.
    expect(overlayTargetColor('rgb(10,20,30)')).toBe('rgba(10,20,30,1)');
  });

  it('reproduces the three courtyard-shadow pixels measured off KiCad', () => {
    const base = PCB_SPECIAL.conflictsShadow;
    expect(base).toBe('rgba(255,0,5,0.5)');

    // [px] the wash over the board, and over an F.Cu pad, where KiCad clamps
    // the red channel: 0.5·255 + 0.75·200 = 277.5.
    expect(composite(overlayTargetColor(base), BOARD)).toEqual([154, 34, 46]);
    expect(composite(overlayTargetColor(base), FCU)).toEqual([255, 39, 42]);

    // [px] and the moving footprint, which is SELECTED and so takes
    // `m_layerColorsSel` (pcb_painter.cpp:341).
    const moving = selectedColor(base);
    expect(moving).toBe('rgba(255,103,106,0.5)');
    expect(composite(overlayTargetColor(moving), BOARD)).toEqual([154, 85, 97]);
  });

  it('is not a 50% alpha blend, which is what it replaced', () => {
    // The same three destinations under an ordinary convex blend. Every one of
    // them is wrong by 8 to 27 levels, which is the whole reason this exists.
    const plain = (c: string, dst: [number, number, number]): [number, number, number] => {
      const p = parseColor(c);
      return [0, 1, 2].map((i) =>
        Math.round(p.a * [p.r, p.g, p.b][i]! * 255 + (1 - p.a) * dst[i]!),
      ) as [number, number, number];
    };
    expect(plain(PCB_SPECIAL.conflictsShadow, BOARD)).toEqual([145, 23, 32]);
    expect(plain(PCB_SPECIAL.conflictsShadow, FCU)).toEqual([228, 26, 29]);
    expect(plain(selectedColor(PCB_SPECIAL.conflictsShadow), BOARD)).toEqual([145, 74, 82]);
  });
});

describe('overlayRecorder', () => {
  it('records world coordinates, not view coordinates', () => {
    // The bug this exists for: a retained target gets the SCALE and nothing
    // else, because the buffer holds world units and the device applies the
    // view. Recorded through the real view instead — the transform 2D canvas
    // code sets, and the one the callback looks like it wants — a polygon at
    // 100 mm lands at 100 mm plus tx/scale, which for a board-sized offset is
    // millions of units off screen: a blank overlay and no error.
    const scene = new Scene(true);
    const rec = overlayRecorder(scene, 1e-5) as unknown as CanvasRenderingContext2D;
    rec.fillStyle = 'rgba(255,0,5,0.5)';
    rec.beginPath();
    rec.moveTo(1e8, 1e8);
    rec.lineTo(1.2e8, 1e8);
    rec.lineTo(1.2e8, 1.2e8);
    rec.closePath();
    rec.fill();

    const t = scene.triangles.view();
    expect(t.length).toBeGreaterThan(0);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < t.length; i += TRIANGLE_STRIDE) {
      minX = Math.min(minX, t[i]!);
      maxX = Math.max(maxX, t[i]!);
    }
    expect(minX).toBeCloseTo(1e8, -3);
    expect(maxX).toBeCloseTo(1.2e8, -3);
  });

  it('carries the premultiplied colour through unchanged', () => {
    // `overlayTargetColor`'s fractions must survive `parseColor`, or the
    // premultiply is quantised twice and the wash drifts.
    const scene = new Scene(true);
    const rec = overlayRecorder(scene, 1e-5) as unknown as CanvasRenderingContext2D;
    rec.fillStyle = overlayTargetColor('rgba(255,0,5,0.5)');
    rec.beginPath();
    rec.moveTo(0, 0);
    rec.lineTo(1e7, 0);
    rec.lineTo(1e7, 1e7);
    rec.closePath();
    rec.fill();
    const t = scene.triangles.view();
    // position(2) then rgba(4).
    expect(t[2]).toBeCloseTo(0.5, 6);
    expect(t[3]).toBe(0);
    expect(t[4]).toBeCloseTo(5 / 255 / 2, 6);
    expect(t[5]).toBeCloseTo(0.25, 6);
  });
});

// ---------------------------------------------------------------------------
// The device half: the overlay layer has to be drawn with the matching blend,
// and only when it has something in it.

/** GL enum stand-ins, matching `gl_device_trace`'s table where they overlap. */
const K = {
  ONE: 31,
  SRC_ALPHA: 32,
  ONE_MINUS_SRC_ALPHA: 33,
} as const;

function traceGl(): { gl: Record<string, unknown>; trace: string[] } {
  const trace: string[] = [];
  const consts: Record<string, number> = {
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
    NO_ERROR: 0,
    DEPTH_BUFFER_BIT: 12,
    DEPTH_TEST: 13,
    LESS: 14,
    TEXTURE0: 15,
    TEXTURE_2D: 16,
    RGB: 17,
    RGBA: 25,
    RGBA8: 26,
    UNSIGNED_BYTE: 18,
    TEXTURE_MIN_FILTER: 19,
    TEXTURE_MAG_FILTER: 20,
    TEXTURE_WRAP_S: 21,
    TEXTURE_WRAP_T: 22,
    LINEAR: 23,
    CLAMP_TO_EDGE: 24,
    NEAREST: 27,
    FRAMEBUFFER: 28,
    COLOR_ATTACHMENT0: 29,
    FRAMEBUFFER_COMPLETE: 30,
    DYNAMIC_DRAW: 35,
    ...K,
    TEXTURE1: 34,
  };
  const rec =
    (name: string) =>
    (...args: unknown[]): unknown => {
      trace.push(
        `${name}(${args
          .map((a) => (typeof a === 'number' ? String(a) : typeof a === 'object' ? '#' : String(a)))
          .join(',')})`,
      );
      return undefined;
    };
  const gl: Record<string, unknown> = { ...consts };
  const handles = (): object => ({});
  for (const name of [
    'bindVertexArray',
    'bindBuffer',
    'bufferData',
    'enableVertexAttribArray',
    'vertexAttribDivisor',
    'vertexAttribPointer',
    'shaderSource',
    'compileShader',
    'deleteShader',
    'attachShader',
    'linkProgram',
    'useProgram',
    'uniform4f',
    'uniform2f',
    'uniform1f',
    'uniform1i',
    'viewport',
    'clearColor',
    'clear',
    'enable',
    'disable',
    'depthFunc',
    'activeTexture',
    'bindTexture',
    'texImage2D',
    'texParameteri',
    'blendFuncSeparate',
    'blendFunc',
    'drawArrays',
    'drawArraysInstanced',
  ]) {
    gl[name] = rec(name);
  }
  for (const [name, fn] of Object.entries<() => unknown>({
    createVertexArray: handles,
    createBuffer: handles,
    createShader: handles,
    createProgram: handles,
    createTexture: handles,
    createFramebuffer: handles,
    getUniformLocation: handles,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    isContextLost: () => false,
    getError: () => 0,
    getExtension: () => null,
  })) {
    const wrapped = rec(name);
    gl[name] = (...a: unknown[]): unknown => {
      wrapped(...a);
      return fn();
    };
  }
  Object.defineProperty(gl, 'drawingBufferWidth', { get: () => 800 });
  Object.defineProperty(gl, 'drawingBufferHeight', { get: () => 600 });
  return { gl, trace };
}

const RED = { r: 1, g: 0, b: 0, a: 1 };

const oneTriangle = (): Scene => {
  const s = new Scene(true);
  s.triangle(0, 0, 10, 0, 0, 10, RED);
  return s;
};

const device = (): { dev: NonNullable<ReturnType<typeof createGlDevice>>; trace: string[] } => {
  const { gl, trace } = traceGl();
  const dev = createGlDevice({ getContext: () => gl } as unknown as HTMLCanvasElement);
  expect(dev).not.toBeNull();
  return { dev: dev!, trace };
};

const BLEND_OVERLAY = `blendFunc(${K.ONE},${K.ONE_MINUS_SRC_ALPHA})`;
const BLEND_NORMAL = `blendFuncSeparate(${K.SRC_ALPHA},${K.ONE_MINUS_SRC_ALPHA},${K.ONE},${K.ONE_MINUS_SRC_ALPHA})`;

describe('the overlay GL layer', () => {
  it('switches to the overlay blend for its runs and puts the normal one back', () => {
    const { dev, trace } = device();
    dev.upload(oneTriangle());
    dev.uploadOverlay(oneTriangle());
    const mark = trace.length;
    dev.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);
    const after = trace.slice(mark).filter((c) => c.startsWith('blend') || c.startsWith('drawArr'));
    // Frame opens normal, the base triangle draws, then the blend flips for the
    // overlay triangle and is restored once the layer walk is done.
    expect(after).toEqual([
      BLEND_NORMAL,
      'drawArrays(3,0,3)',
      BLEND_OVERLAY,
      'drawArrays(3,0,3)',
      BLEND_NORMAL,
    ]);
  });

  it('touches the blend at all only when the overlay has something in it', () => {
    // The cost of the layer existing must be zero on the frames — nearly all of
    // them — where nothing is being dragged into anything.
    const { dev, trace } = device();
    dev.upload(oneTriangle());
    const mark = trace.length;
    dev.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);
    const after = trace.slice(mark).filter((c) => c.startsWith('blend'));
    expect(after).toEqual([BLEND_NORMAL]);
  });

  it('stops drawing it once the layer is cleared', () => {
    const { dev, trace } = device();
    dev.uploadOverlay(oneTriangle());
    dev.clearOverlay();
    const mark = trace.length;
    dev.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);
    const after = trace.slice(mark).filter((c) => c.startsWith('blend') || c.startsWith('drawArr'));
    expect(after).toEqual([BLEND_NORMAL]);
  });
});
