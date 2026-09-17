// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::OPENGL_GAL`'s vertex pipeline, driven against a recording stand-in
 * for the WebGL2 context: what the GAL packs into its VERTEX buffers (the
 * shader modes and parameters `drawLineQuad`, `drawCircle` and `BitmapText`
 * write), how groups are cached, recoloured, redepthed and deleted, and what
 * the GPU managers upload and draw. The GPU itself is the browser's; the
 * shaders compile there, and that is where the picture is checked.
 */
import { describe, expect, it } from 'vitest';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/src/gal/gal_display_options.js';
import {
  GAL_DRAWING_CONTEXT,
  GAL_UPDATE_CONTEXT,
} from '@ziroeda/common/src/gal/graphics_abstraction_layer.js';
import { RENDER_TARGET } from '@ziroeda/common/src/gal/definitions.js';
import { OPENGL_GAL, type OPENGL_GAL_CANVAS } from '@ziroeda/common/src/gal/opengl/opengl_gal.js';
import {
  GL_FIXED_FUNCTION,
  GL_MATRIX_MODE,
} from '@ziroeda/common/src/gal/opengl/gl_fixed_function.js';
import {
  COLOR_OFFSET,
  SHADER_MODE,
  SHADER_OFFSET,
  VERTEX_SIZE,
} from '@ziroeda/common/src/gal/opengl/vertex_common.js';
import { MATRIX3x3D } from '@ziroeda/kimath/src/math/matrix3x3.js';

/** The WebGL2 constants the GAL reaches for. */
const GL = {
  NO_ERROR: 0,
  TRIANGLES: 4,
  LINES: 1,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  STENCIL_TEST: 0x0b90,
  LESS: 0x0201,
  ALWAYS: 0x0207,
  NOTEQUAL: 0x0205,
  KEEP: 0x1e00,
  INCR: 0x1e02,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  ONE: 1,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STREAM_DRAW: 0x88e0,
  DYNAMIC_DRAW: 0x88e8,
  FLOAT: 0x1406,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_INT: 0x1405,
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  TEXTURE1: 0x84c1,
  TEXTURE3: 0x84c3,
  RGB: 0x1907,
  RGBA: 0x1908,
  RGB8: 0x8051,
  RGBA8: 0x8058,
  RG8: 0x822b,
  R8: 0x8229,
  RG: 0x8227,
  RED: 0x1903,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  LINEAR: 0x2601,
  NEAREST: 0x2600,
  CLAMP_TO_EDGE: 0x812f,
  FRAMEBUFFER: 0x8d40,
  RENDERBUFFER: 0x8d41,
  DEPTH24_STENCIL8: 0x88f0,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  NONE: 0,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_COLOR_ATTACHMENTS: 0x8cdf,
  MAX_TEXTURE_SIZE: 0x0d33,
  VERSION: 0x1f02,
  VIEWPORT: 0x0ba2,
  DEPTH_WRITEMASK: 0x0b72,
  CURRENT_PROGRAM: 0x8b8d,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH_BUFFER_BIT: 0x100,
  STENCIL_BUFFER_BIT: 0x400,
  UNPACK_ALIGNMENT: 0x0cf5,
  PACK_ALIGNMENT: 0x0d05,
};

interface DRAW {
  kind: 'arrays' | 'elements';
  mode: number;
  first: number;
  count: number;
  indices: number[] | null;
}

/** A WebGL2 stand-in that keeps what was uploaded and what was drawn. */
class MockGL {
  buffers = new Map<object, Uint8Array>();
  bound: { [target: number]: object | null } = {};
  program: object | null = null;
  draws: DRAW[] = [];
  private attribs = ['a_position', 'a_color', 'a_shaderParams', 'a_texCoord'];
  private nextId = 1;

  constructor() {
    Object.assign(this, GL);
  }

  getError(): number {
    return 0;
  }
  getParameter(p: number): unknown {
    switch (p) {
      case GL.MAX_RENDERBUFFER_SIZE:
      case GL.MAX_TEXTURE_SIZE:
        return 16384;
      case GL.MAX_COLOR_ATTACHMENTS:
        return 8;
      case GL.VERSION:
        return 'WebGL 2.0 (mock)';
      case GL.VIEWPORT:
        return new Int32Array([0, 0, 800, 600]);
      case GL.DEPTH_WRITEMASK:
        return true;
      case GL.CURRENT_PROGRAM:
        return this.program;
      default:
        return 0;
    }
  }
  createBuffer(): object {
    const b = { id: this.nextId++ };
    this.buffers.set(b, new Uint8Array(0));
    return b;
  }
  deleteBuffer(): void {}
  bindBuffer(target: number, b: object | null): void {
    this.bound[target] = b;
  }
  /** Every payload handed to bufferData / bufferSubData, in order. */
  uploads: Uint8Array[] = [];
  bufferData(target: number, data: ArrayBufferView | number, _usage: number): void {
    const b = this.bound[target];
    if (!b) return;
    if (typeof data === 'number') this.buffers.set(b, new Uint8Array(data));
    else {
      const copy = new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
      this.buffers.set(b, copy);
      this.uploads.push(copy);
    }
  }
  bufferSubData(target: number, offset: number, data: ArrayBufferView): void {
    const b = this.bound[target];
    if (!b) return;
    const copy = new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
    this.buffers.get(b)!.set(copy, offset);
    this.uploads.push(copy);
  }
  drawArrays(mode: number, first: number, count: number): void {
    this.draws.push({ kind: 'arrays', mode, first, count, indices: null });
  }
  drawElements(mode: number, count: number, _type: number, _offset: number): void {
    const b = this.bound[GL.ELEMENT_ARRAY_BUFFER];
    const data = b ? this.buffers.get(b)! : new Uint8Array(0);
    const u32 = new Uint32Array(data.buffer, 0, data.byteLength / 4);
    this.draws.push({
      kind: 'elements',
      mode,
      first: 0,
      count,
      indices: [...u32.subarray(0, count)],
    });
  }
  createShader(): object {
    return {};
  }
  shaderSource(): void {}
  compileShader(): void {}
  getShaderParameter(): boolean {
    return true;
  }
  getShaderInfoLog(): string {
    return '';
  }
  deleteShader(): void {}
  isShader(): boolean {
    return true;
  }
  detachShader(): void {}
  createProgram(): object {
    return { id: this.nextId++ };
  }
  attachShader(): void {}
  linkProgram(): void {}
  getProgramParameter(): boolean {
    return true;
  }
  getProgramInfoLog(): string {
    return '';
  }
  deleteProgram(): void {}
  useProgram(p: object | null): void {
    this.program = p;
  }
  getUniformLocation(_p: object, name: string): object {
    return { name };
  }
  getAttribLocation(_p: object, name: string): number {
    return this.attribs.indexOf(name);
  }
  uniform1f(): void {}
  uniform1i(): void {}
  uniform2f(): void {}
  uniform4fv(): void {}
  uniformMatrix4fv(): void {}
  enableVertexAttribArray(): void {}
  disableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}
  createTexture(): object {
    return { id: this.nextId++ };
  }
  deleteTexture(): void {}
  isTexture(): boolean {
    return true;
  }
  bindTexture(): void {}
  activeTexture(): void {}
  texImage2D(): void {}
  texParameteri(): void {}
  pixelStorei(): void {}
  copyTexSubImage2D(): void {}
  createFramebuffer(): object {
    return { id: this.nextId++ };
  }
  deleteFramebuffer(): void {}
  bindFramebuffer(): void {}
  framebufferTexture2D(): void {}
  framebufferRenderbuffer(): void {}
  checkFramebufferStatus(): number {
    return GL.FRAMEBUFFER_COMPLETE;
  }
  createRenderbuffer(): object {
    return { id: this.nextId++ };
  }
  deleteRenderbuffer(): void {}
  bindRenderbuffer(): void {}
  renderbufferStorage(): void {}
  drawBuffers(): void {}
  readBuffer(): void {}
  readPixels(): void {}
  viewport(): void {}
  clearColor(): void {}
  clear(): void {}
  enable(): void {}
  disable(): void {}
  isEnabled(): boolean {
    return true;
  }
  depthFunc(): void {}
  depthMask(): void {}
  blendFunc(): void {}
  colorMask(): void {}
  stencilFunc(): void {}
  stencilOp(): void {}
  lineWidth(): void {}
  flush(): void {}
  finish(): void {}
}

function makeGal(): { gal: OPENGL_GAL; gl: MockGL } {
  const gl = new MockGL();
  const canvas: OPENGL_GAL_CANVAS = {
    gl: gl as unknown as WebGL2RenderingContext,
    GetScaleFactor: () => 1,
    GetNativePixelSize: () => ({ x: 800, y: 600 }),
    GetClientSize: () => ({ x: 800, y: 600 }),
    IsShownOnScreen: () => true,
    Refresh: () => {},
    SetCursor: () => {},
    PostPaint: () => {},
    GetBitmapFontImage: () => ({}) as unknown as TexImageSource,
  };
  const gal = new OPENGL_GAL(new GAL_DISPLAY_OPTIONS(), canvas);
  return { gal, gl };
}

/** The VERTEX structs in an uploaded buffer, decoded. */
function decode(bytes: Uint8Array): {
  x: number;
  y: number;
  z: number;
  rgba: number[];
  shader: number[];
}[] {
  const out = [];
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  for (let i = 0; i + VERTEX_SIZE <= bytes.byteLength; i += VERTEX_SIZE) {
    const f = i / 4;
    out.push({
      x: f32[f]!,
      y: f32[f + 1]!,
      z: f32[f + 2]!,
      rgba: [...bytes.subarray(i + COLOR_OFFSET, i + COLOR_OFFSET + 4)],
      shader: [...f32.subarray(f + SHADER_OFFSET / 4, f + SHADER_OFFSET / 4 + 4)],
    });
  }
  return out;
}

describe('OPENGL_GAL vertex pipeline', () => {
  it('a cached group holds the six line-quad vertices with SHADER_LINE_A..F and the direction', () => {
    const { gal, gl } = makeGal();

    gal.SetStrokeColor({ r: 1, g: 0.5, b: 0, a: 1 });
    gal.SetLineWidth(200);
    gal.SetLayerDepth(-3);

    let group = -1;
    GAL_UPDATE_CONTEXT(gal, () => {
      gal.SetTarget(RENDER_TARGET.TARGET_CACHED);
      group = gal.BeginGroup();
      gal.DrawLine({ x: 1000, y: 2000 }, { x: 4000, y: 6000 });
      gal.EndGroup();
    });

    // The cached container uploads on Unmap; the manager drew the group on EndDrawing
    GAL_DRAWING_CONTEXT(gal, () => {
      gal.DrawGroup(group);
    });

    // The cached container's upload is exactly the six VERTEX structs (the compositor's
    // full-screen quads go through the fixed-function shim's own, wider, buffer).
    const uploads = gl.uploads.filter((b) => b.byteLength === 6 * VERTEX_SIZE);
    expect(uploads.length).toBe(1);
    const verts = decode(uploads[0]!);

    const modes = verts.map((v) => v.shader[0]);
    expect(modes).toEqual([
      SHADER_MODE.SHADER_LINE_A,
      SHADER_MODE.SHADER_LINE_B,
      SHADER_MODE.SHADER_LINE_C,
      SHADER_MODE.SHADER_LINE_D,
      SHADER_MODE.SHADER_LINE_E,
      SHADER_MODE.SHADER_LINE_F,
    ]);
    // shader = { mode, m_lineWidth, vs.x, vs.y }
    for (const v of verts) expect(v.shader.slice(1)).toEqual([200, 3000, 4000]);
    // A B F at the start, C D E at the end, all at the layer depth
    expect(verts.map((v) => [v.x, v.y, v.z])).toEqual([
      [1000, 2000, -3],
      [1000, 2000, -3],
      [4000, 6000, -3],
      [4000, 6000, -3],
      [4000, 6000, -3],
      [1000, 2000, -3],
    ]);
    // GLubyte = colour * 255.0, truncated
    for (const v of verts) expect(v.rgba).toEqual([255, 127, 0, 255]);

    // DrawGroup went through the cached manager: one glDrawElements over the item's range
    const el = gl.draws.filter((d) => d.kind === 'elements');
    expect(el.length).toBe(1);
    expect(el[0]!.count).toBe(6);
    expect(el[0]!.indices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('a filled circle is the shader triangle with vertex indices 1, 2, 3 and the radius', () => {
    const { gal, gl } = makeGal();
    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    gal.SetFillColor({ r: 0, g: 0, b: 1, a: 0.5 });

    GAL_DRAWING_CONTEXT(gal, () => {
      gal.SetTarget(RENDER_TARGET.TARGET_NONCACHED);
      gal.DrawCircle({ x: 10, y: 20 }, 500);
    });

    // The non-cached manager streams its vertices at EndDrawing and draws them with glDrawArrays
    // (the other glDrawArrays are the compositor's six-vertex full-screen quads)
    const arrays = gl.draws.filter((d) => d.kind === 'arrays' && d.count === 3);
    expect(arrays.length).toBe(1);

    const upload = gl.uploads.find((b) => b.byteLength === 3 * VERTEX_SIZE)!;
    const verts = decode(upload);
    expect(verts.map((v) => v.shader)).toEqual([
      [SHADER_MODE.SHADER_FILLED_CIRCLE, 1, 500, 0],
      [SHADER_MODE.SHADER_FILLED_CIRCLE, 2, 500, 0],
      [SHADER_MODE.SHADER_FILLED_CIRCLE, 3, 500, 0],
    ]);
    for (const v of verts) {
      expect([v.x, v.y]).toEqual([10, 20]);
      expect(v.rgba).toEqual([0, 0, 255, 127]);
    }
  });

  it('ChangeGroupColor and ChangeGroupDepth rewrite the cached vertices; DeleteGroup frees them', () => {
    const { gal, gl } = makeGal();
    gal.SetStrokeColor({ r: 1, g: 1, b: 1, a: 1 });

    let group = -1;
    GAL_UPDATE_CONTEXT(gal, () => {
      gal.SetTarget(RENDER_TARGET.TARGET_CACHED);
      group = gal.BeginGroup();
      gal.DrawLine({ x: 0, y: 0 }, { x: 100, y: 0 });
      gal.EndGroup();
    });

    GAL_UPDATE_CONTEXT(gal, () => {
      gal.ChangeGroupColor(group, { r: 0.2, g: 0.4, b: 0.6, a: 0.8 });
      gal.ChangeGroupDepth(group, 42);
    });

    GAL_DRAWING_CONTEXT(gal, () => {
      gal.DrawGroup(group);
    });

    // The first update's Unmap uploaded the six vertices; the rewrite marks their
    // range dirty and the second Unmap uploads exactly those six again
    const uploads = gl.uploads.filter((b) => b.byteLength === 6 * VERTEX_SIZE);
    expect(uploads.length).toBe(2);
    const verts = decode(uploads[1]!);
    for (const v of verts) {
      expect(v.rgba).toEqual([51, 102, 153, 204]);
      expect(v.z).toBe(42);
    }

    // After DeleteGroup the group is unknown: DrawGroup draws nothing
    gl.draws = [];
    GAL_UPDATE_CONTEXT(gal, () => gal.DeleteGroup(group));
    GAL_DRAWING_CONTEXT(gal, () => gal.DrawGroup(group));
    expect(gl.draws.filter((d) => d.kind === 'elements')).toHaveLength(0);
  });

  it('BitmapText packs SHADER_FONT quads with the atlas coordinates of each glyph', () => {
    const { gal, gl } = makeGal();
    gal.SetStrokeColor({ r: 1, g: 1, b: 1, a: 1 });
    gal.SetGlyphSize({ x: 1000, y: 1000 });

    GAL_DRAWING_CONTEXT(gal, () => {
      gal.SetTarget(RENDER_TARGET.TARGET_NONCACHED);
      gal.BitmapText('AB', { x: 0, y: 0 }, { AsRadians: () => 0 } as never);
    });

    const upload = gl.uploads.find((b) => b.byteLength === 12 * VERTEX_SIZE)!;
    expect(upload).toBeDefined();
    const verts = decode(upload);
    for (const v of verts) expect(v.shader[0]).toBe(SHADER_MODE.SHADER_FONT);
    // the texture coordinates are inside the atlas
    for (const v of verts) {
      expect(v.shader[1]).toBeGreaterThan(0);
      expect(v.shader[1]).toBeLessThan(1);
      expect(v.shader[2]).toBeGreaterThan(0);
      expect(v.shader[2]).toBeLessThan(1);
    }
    // the two glyphs sample different places
    expect(verts[0]!.shader[1]).not.toBe(verts[6]!.shader[1]);
  });
});

describe('GL_FIXED_FUNCTION', () => {
  it('glOrtho and the world-screen modelview compose to the fixed pipeline product', () => {
    const gl = new MockGL();
    const ff = new GL_FIXED_FUNCTION(gl as unknown as WebGL2RenderingContext);

    ff.glMatrixMode(GL_MATRIX_MODE.GL_PROJECTION);
    ff.glLoadIdentity();
    ff.glOrtho(0, 800, 600, 0, 4096, -4095);

    const m = new MATRIX3x3D();
    m.SetIdentity();
    m.SetScale({ x: 2, y: 2 });
    m.SetTranslation({ x: 400, y: 300 });
    ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);
    ff.glLoadMatrixd(GL_FIXED_FUNCTION.matrixData(m));

    const mvp = ff.modelViewProjection();
    // world (0,0) -> screen (400,300) -> clip (0, 0)
    const x = mvp[0]! * 0 + mvp[4]! * 0 + mvp[12]!;
    const y = mvp[1]! * 0 + mvp[5]! * 0 + mvp[13]!;
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    // world (200, 0) -> screen (800, 300) -> clip x = 1
    expect(mvp[0]! * 200 + mvp[12]!).toBeCloseTo(1, 6);
    // world (0, -150) -> screen (400, 0) -> clip y = +1 (the RH-LH conversion of glOrtho)
    expect(mvp[5]! * -150 + mvp[13]!).toBeCloseTo(1, 6);

    // push/pop restores
    ff.glPushMatrix();
    ff.glTranslated(10, 0, 0);
    expect(ff.modelViewProjection()[12]).not.toBeCloseTo(mvp[12]!, 6);
    ff.glPopMatrix();
    expect(ff.modelViewProjection()[12]).toBeCloseTo(mvp[12]!, 6);
  });
});
