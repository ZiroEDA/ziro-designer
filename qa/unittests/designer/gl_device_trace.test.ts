// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The default `draw()` path issues exactly the GL calls it always did.
 *
 * GerbView's XOR mode needs the device to render a layer into an offscreen
 * colour target and composite it with a difference shader, which is a change
 * to the layer the schematic and PCB already render through. The condition on
 * that change is that neither of them moves by a pixel.
 *
 * "It looks the same" is not checkable from Node and a screenshot of a board is
 * not checkable at all, so what is pinned here is the thing that decides the
 * pixels: the ordered sequence of GL calls the device makes for a fixed scene.
 * A refactor that preserves it cannot change the image; one that does not shows
 * up here as a diff rather than as a bug report about a board.
 *
 * The trace deliberately excludes uniform *locations* and buffer handles, which
 * are opaque objects with no stable identity, but keeps every call name, every
 * numeric argument and their order.
 */
import { describe, expect, it } from 'vitest';
import { createGlDevice } from '@ziroeda/designer/src/render/gl/device.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';

/** Calls whose arguments are all opaque handles; only the name/order matters. */
const NAME_ONLY = new Set([
  'bindVertexArray',
  'bindBuffer',
  'useProgram',
  'bindTexture',
  'attachShader',
  'linkProgram',
  'shaderSource',
  'compileShader',
  'deleteShader',
  'getUniformLocation',
  'getProgramParameter',
  'getShaderParameter',
  'getProgramInfoLog',
  'getShaderInfoLog',
  'createShader',
  'createProgram',
  'createBuffer',
  'createVertexArray',
  'createTexture',
  'bufferData',
]);

function traceGl(): { gl: Record<string, unknown>; trace: string[] } {
  const trace: string[] = [];
  const K: Record<string, number> = {
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
    ONE: 31,
    SRC_ALPHA: 32,
    ONE_MINUS_SRC_ALPHA: 33,
    TEXTURE1: 34,
  };
  const rec =
    (name: string) =>
    (...args: unknown[]): unknown => {
      if (NAME_ONLY.has(name)) trace.push(name);
      else
        trace.push(
          `${name}(${args
            .map((a) =>
              typeof a === 'number' || typeof a === 'boolean' || a === null
                ? String(a)
                : typeof a === 'object'
                  ? '#'
                  : String(a),
            )
            .join(',')})`,
        );
      return undefined;
    };
  const gl: Record<string, unknown> = { ...K };
  const handles = (): object => ({});
  const fns: Record<string, (...a: unknown[]) => unknown> = {
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
    checkFramebufferStatus: () => K.FRAMEBUFFER_COMPLETE!,
  };
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
    'deleteTexture',
    'blendFuncSeparate',
    'blendFunc',
    'drawArrays',
    'drawArraysInstanced',
    'deleteBuffer',
    'deleteVertexArray',
    'deleteProgram',
    'deleteFramebuffer',
    'bindFramebuffer',
    'framebufferTexture2D',
    'texStorage2D',
  ]) {
    gl[name] = rec(name);
  }
  for (const [name, fn] of Object.entries(fns)) {
    const wrapped = rec(name);
    gl[name] = (...a: unknown[]): unknown => {
      wrapped(...a);
      return fn(...a);
    };
  }
  Object.defineProperty(gl, 'drawingBufferWidth', { get: () => 800 });
  Object.defineProperty(gl, 'drawingBufferHeight', { get: () => 600 });
  return { gl, trace };
}

const RED = { r: 1, g: 0, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 1, a: 0.5 };

/** A scene with all three kinds and an alternating run list. */
function fixture(): Scene {
  const s = new Scene(true);
  s.triangle(0, 0, 10, 0, 0, 10, RED);
  s.segment(0, 0, 10, 10, 2, -1, BLUE);
  s.segment(10, 10, 20, 0, 2, -1, BLUE);
  s.disc(5, 5, 3, 0.5, RED);
  s.triangle(1, 1, 2, 1, 1, 2, BLUE);
  return s;
}

describe('GlDevice default draw path', () => {
  it('issues a stable sequence of GL calls for a fixed ordered scene', () => {
    const { gl, trace } = traceGl();
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
    const device = createGlDevice(canvas);
    expect(device).not.toBeNull();
    device!.upload(fixture());
    const mark = trace.length;
    device!.draw({ scaleX: 2, scaleY: -2, offsetX: 7, offsetY: 9 }, RED);
    expect(trace.slice(mark)).toMatchSnapshot();
  });

  it('never binds a framebuffer when drawing to the screen', () => {
    // The offscreen target added for GerbView's XOR mode must be invisible to
    // every other caller: if the default path ever binds one, the schematic and
    // the board are rendering somewhere other than the canvas.
    const { gl, trace } = traceGl();
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
    const device = createGlDevice(canvas);
    device!.upload(fixture());
    const mark = trace.length;
    device!.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);
    const after = trace.slice(mark);
    expect(after.filter((c) => c.startsWith('bindFramebuffer'))).toEqual([]);
    expect(after.filter((c) => c.startsWith('createFramebuffer'))).toEqual([]);
  });
});
