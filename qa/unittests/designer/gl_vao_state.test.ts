// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Attribute pointers must land in the VAO they belong to.
 *
 * `vertexAttribPointer` writes into whichever VAO is bound, so a call that
 * trusts the caller to have bound the right one can silently rewrite another
 * program's attributes. That is what happened: the two "rewind the pointers"
 * calls at the end of an ordered draw ran with whatever the last run left
 * bound, and when that was a *triangle* run the disc rewind landed in the
 * triangle VAO. Location 1 there is the triangle colour (tri buffer, size 4,
 * stride 24, offset 8); the rewind re-pointed it at the disc buffer (size 2,
 * stride 32, offset 0), which on a board with no discs is empty — so WebGL fed
 * every triangle zeros and defaulted z,w to (0,1). Opaque black. Every zone
 * pour became a black rectangle and everything under it in the paint order
 * vanished behind it.
 *
 * It stuck for the life of the context (nothing re-points the triangle VAO)
 * and only appeared when a startup race produced an early partial record whose
 * run list ended in a triangle run — which is why it read as a caching bug.
 *
 * This drives the real `GlDevice` against a fake context that models the one
 * thing that matters: attribute state is per-VAO.
 */
import { describe, expect, it } from 'vitest';
import { createGlDevice } from '@ziroeda/designer/src/render/gl/device.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';

interface AttrState {
  buffer: unknown;
  size: number;
  stride: number;
  offset: number;
}

/** Enough WebGL2 to exercise draw(); attribute state is scoped per VAO. */
function fakeGl(): {
  gl: Record<string, unknown>;
  vaos: Map<object, Map<number, AttrState>>;
  order: object[];
} {
  const vaos = new Map<object, Map<number, AttrState>>();
  const order: object[] = [];
  let boundVao: object | null = null;
  let boundBuffer: unknown = null;
  const buffers: object[] = [];
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
    NO_ERROR: 0,
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
    createVertexArray: () => {
      const v = {};
      vaos.set(v, new Map());
      order.push(v);
      return v;
    },
    bindVertexArray: (v: object | null) => {
      boundVao = v;
    },
    createBuffer: () => {
      const b = {};
      buffers.push(b);
      return b;
    },
    bindBuffer: (_t: number, b: unknown) => {
      boundBuffer = b;
    },
    bufferData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribDivisor: () => {},
    vertexAttribPointer: (
      loc: number,
      size: number,
      _t: number,
      _n: boolean,
      stride: number,
      offset: number,
    ) => {
      if (!boundVao) throw new Error('vertexAttribPointer with no VAO bound');
      vaos.get(boundVao)!.set(loc, { buffer: boundBuffer, size, stride, offset });
    },
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
    getUniformLocation: () => ({}),
    useProgram: () => {},
    uniform4f: () => {},
    uniform2f: () => {},
    uniform1f: () => {},
    uniform1i: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    enable: () => {},
    disable: () => {},
    depthFunc: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    createTexture: () => ({}),
    texImage2D: () => {},
    texParameteri: () => {},
    deleteTexture: () => {},
    blendFuncSeparate: () => {},
    drawArrays: () => {},
    drawArraysInstanced: () => {},
    isContextLost: () => false,
    getError: () => 0,
    deleteBuffer: () => {},
    deleteVertexArray: () => {},
    deleteProgram: () => {},
    getExtension: () => null,
  };
  return { gl, vaos, order };
}

const RED = { r: 1, g: 0, b: 0, a: 1 };

describe('ordered draw leaves every VAO pointing at its own buffer', () => {
  it('does not repoint the triangle colour when a run list ends in triangles', () => {
    const { gl, vaos, order } = fakeGl();
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
    const device = createGlDevice(canvas);
    expect(device).not.toBeNull();

    // A scene whose last run is a triangle run, with no discs at all — the
    // exact shape that corrupted the board.
    const scene = new Scene(true);
    scene.segment(0, 0, 1, 0, 1, -1, RED);
    scene.triangle(0, 0, 1, 0, 0, 1, RED);
    expect(scene.discCount).toBe(0);

    device!.upload(scene);
    device!.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null);

    // Identify the VAO by creation order, not by its contents: a corrupted
    // triangle VAO is indistinguishable from a disc VAO by content alone, and
    // the preview layer keeps an untouched triangle VAO that would satisfy a
    // content search whether or not the bug is present. Each layer creates
    // seg, disc, ring, tri in that order, so index 3 is the first layer's
    // triangles. (It was index 2 until the exact-circle `ring` primitive was
    // added between the disc and the triangles — an index that moves when a
    // primitive is added is the cost of identifying by creation order, and the
    // alternative, identifying by content, is what this comment rules out.)
    const triVao = order[3]!;
    const colour = vaos.get(triVao)!.get(1)!;
    // The disc rewind used to land here as size 2 / stride 32 / offset 0.
    expect(
      { size: colour.size, stride: colour.stride, offset: colour.offset },
      'triangle colour must still point at the triangle buffer',
    ).toEqual({ size: 4, stride: 24, offset: 8 });
    expect(colour.buffer).not.toBe(vaos.get(order[1]!)!.get(1)!.buffer);
  });

  it('never points an attribute with no VAO bound', () => {
    const { gl } = fakeGl();
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
    const device = createGlDevice(canvas);
    const scene = new Scene(true);
    scene.triangle(0, 0, 1, 0, 0, 1, RED);
    scene.segment(0, 0, 1, 0, 1, -1, RED);
    scene.disc(2, 2, 1, -1, RED);
    device!.upload(scene);
    // fakeGl throws if vertexAttribPointer runs with nothing bound.
    expect(() =>
      device!.draw({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, null),
    ).not.toThrow();
  });
});
