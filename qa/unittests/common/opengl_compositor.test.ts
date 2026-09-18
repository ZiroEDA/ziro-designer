// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OPENGL_COMPOSITOR` under WebGL's feedback-loop rule.
 *
 * The C++ attaches every buffer to ONE framebuffer object at consecutive
 * `GL_COLOR_ATTACHMENTn` and picks the target with `glDrawBuffer`; a
 * presentor then samples one attachment while drawing into another of the
 * same FBO (`ANTIALIASING_SUPERSAMPLING::DrawBuffer` is
 * `compositor->DrawBuffer( aBuffer, ssaaMainBuffer )`, and every SMAA pass is
 * the same shape). Desktop GL allows that; WebGL raises `INVALID_OPERATION`
 * on a draw whose sampled texture is attached to the bound framebuffer,
 * whichever attachment the draw buffer is, and the draw does nothing — a
 * black board in both antialiasing modes (measured 2026-09-18 with
 * `qa/probes/pcb_aa_probe.mjs`). So each buffer is the colour attachment of
 * its own framebuffer object, sharing the one depth buffer.
 *
 * The mock below IS that rule: it tracks attachments and the bound texture
 * and refuses the draw the way Chrome does.
 */
import { describe, expect, it } from 'vitest';
import { GAL_ANTIALIASING_MODE } from '@ziroeda/common/src/gal/gal_display_options.js';
import { GL_FIXED_FUNCTION } from '@ziroeda/common/src/gal/opengl/gl_fixed_function.js';
import { OPENGL_COMPOSITOR } from '@ziroeda/common/src/gal/opengl/opengl_compositor.js';

const GL = {
  NO_ERROR: 0,
  INVALID_OPERATION: 0x0502,
  TEXTURE0: 0x84c0,
  TEXTURE_2D: 0x0de1,
  FRAMEBUFFER: 0x8d40,
  RENDERBUFFER: 0x8d41,
  COLOR_ATTACHMENT0: 0x8ce0,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_COLOR_ATTACHMENTS: 0x8cdf,
  CURRENT_PROGRAM: 0x8b8d,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VIEWPORT: 0x0ba2,
  NONE: 0,
  TRIANGLES: 4,
};

interface Draw {
  /** The framebuffer drawn into; null is the screen. */
  fbo: object | null;
  /** The texture sampled on unit 0. */
  sampled: object | null;
  viewport: [number, number, number, number];
}

/**
 * A WebGL2 stand-in that keeps the framebuffer attachments, the texture
 * bindings and the viewport, and applies the feedback-loop rule on a draw.
 */
class FeedbackGL {
  boundFbo: object | null = null;
  /** framebuffer -> the textures attached to it, at any attachment point. */
  attachments = new Map<object, Set<object>>();
  unit = 0;
  bound2D = new Map<number, object | null>();
  vp: [number, number, number, number] = [0, 0, 0, 0];
  draws: Draw[] = [];
  error = 0;
  private live = new Set<object>();

  constructor() {
    Object.assign(this, GL);
  }

  getError(): number {
    const e = this.error;
    this.error = 0;
    return e;
  }
  getParameter(p: number): unknown {
    switch (p) {
      case GL.MAX_RENDERBUFFER_SIZE:
      case GL.MAX_TEXTURE_SIZE:
        return 16384;
      case GL.MAX_COLOR_ATTACHMENTS:
        return 8;
      case GL.CURRENT_PROGRAM:
        return null;
      case GL.VIEWPORT:
        return Int32Array.from(this.vp);
      default:
        return 0;
    }
  }
  private make(): object {
    const o = {};
    this.live.add(o);
    return o;
  }
  createFramebuffer(): object {
    const f = this.make();
    this.attachments.set(f, new Set());
    return f;
  }
  deleteFramebuffer(f: object): void {
    this.attachments.delete(f);
    this.live.delete(f);
  }
  bindFramebuffer(_t: number, f: object | null): void {
    this.boundFbo = f;
  }
  framebufferTexture2D(_t: number, _att: number, _tt: number, tex: object): void {
    if (!this.boundFbo) throw new Error('framebufferTexture2D on the default framebuffer');
    this.attachments.get(this.boundFbo)!.add(tex);
  }
  checkFramebufferStatus(): number {
    return GL.FRAMEBUFFER_COMPLETE;
  }
  createRenderbuffer(): object {
    return this.make();
  }
  createTexture(): object {
    return this.make();
  }
  deleteTexture(t: object): void {
    this.live.delete(t);
    for (const set of this.attachments.values()) set.delete(t);
  }
  activeTexture(u: number): void {
    this.unit = u - GL.TEXTURE0;
  }
  bindTexture(_t: number, tex: object | null): void {
    this.bound2D.set(this.unit, tex);
  }
  viewport(x: number, y: number, w: number, h: number): void {
    this.vp = [x, y, w, h];
  }

  // The shaders link; the rest of the program and buffer calls are the Proxy's no-ops.
  createBuffer(): object {
    return this.make();
  }
  createShader(): object {
    return this.make();
  }
  getShaderParameter(): boolean {
    return true;
  }
  createProgram(): object {
    return this.make();
  }
  getProgramParameter(): boolean {
    return true;
  }
  getUniformLocation(): object {
    return this.make();
  }
  getAttribLocation(): number {
    return 0;
  }

  drawArrays(): void {
    const sampled = this.bound2D.get(0) ?? null;
    // The rule: a sampled texture attached to the bound framebuffer, at ANY
    // attachment point, is INVALID_OPERATION and the draw is dropped.
    if (sampled && this.boundFbo && this.attachments.get(this.boundFbo)?.has(sampled)) {
      this.error = GL.INVALID_OPERATION;
      return;
    }
    this.draws.push({ fbo: this.boundFbo, sampled, viewport: [...this.vp] });
  }
}

function makeCompositor(mode: GAL_ANTIALIASING_MODE, w = 100, h = 80) {
  const mock = new FeedbackGL();
  // Everything the rule does not need (SMAA's shader and lookup-texture
  // uploads, the uniforms) is a no-op that hands back a fresh handle.
  const gl = new Proxy(mock, {
    get(t, k) {
      if (k in t) return Reflect.get(t, k);
      return () => ({});
    },
  }) as unknown as WebGL2RenderingContext;
  const ff = new GL_FIXED_FUNCTION(gl);
  const c = new OPENGL_COMPOSITOR(gl, ff);
  c.SetAntialiasingMode(mode);
  c.Resize(w, h);
  c.Initialize();
  return { mock, c };
}

describe('OPENGL_COMPOSITOR buffers under the WebGL feedback-loop rule', () => {
  it('supersampling: main -> ssaa -> screen, every draw accepted', () => {
    const { mock, c } = makeCompositor(GAL_ANTIALIASING_MODE.AA_HIGHQUALITY);
    const main = c.CreateBuffer();
    c.Begin();
    c.SetBuffer(main);
    // ... the scene would be drawn here, at the internal (2x) size
    expect(mock.vp).toEqual([0, 0, 200, 160]);
    c.DrawBuffer(main);
    c.Present();

    expect(mock.getError()).toBe(GL.NO_ERROR);
    expect(mock.draws).toHaveLength(2);
    // main composited into the ssaa buffer, an FBO other than the one main is attached to
    const [toSsaa, toScreen] = mock.draws as [Draw, Draw];
    expect(toSsaa.fbo).not.toBeNull();
    expect(toSsaa.viewport).toEqual([0, 0, 200, 160]);
    expect(mock.attachments.get(toSsaa.fbo!)!.has(toSsaa.sampled!)).toBe(false);
    // then the ssaa buffer to the screen at the screen size
    expect(toScreen.fbo).toBeNull();
    expect(toScreen.viewport).toEqual([0, 0, 100, 80]);
    expect(toScreen.sampled).not.toBe(toSsaa.sampled);
  });

  it('every buffer is the colour attachment of a framebuffer of its own', () => {
    const { mock, c } = makeCompositor(GAL_ANTIALIASING_MODE.AA_FAST);
    const handles = [c.CreateBuffer(), c.CreateBuffer(), c.CreateBuffer()];
    // `ANTIALIASING_SMAA::Init` took 1-3 (base, edges, blend) in Initialize
    expect(handles).toEqual([4, 5, 6]);
    const fbos = [...mock.attachments.entries()].filter(([, set]) => set.size > 0);
    // SMAA's three of its own, main, temp, overlay: six, one texture each
    expect(fbos).toHaveLength(6);
    for (const [, set] of fbos) expect(set.size).toBe(1);
  });

  it('no antialiasing: the one composite goes straight to the screen', () => {
    const { mock, c } = makeCompositor(GAL_ANTIALIASING_MODE.AA_NONE);
    const main = c.CreateBuffer();
    c.Begin();
    c.SetBuffer(main);
    expect(mock.vp).toEqual([0, 0, 100, 80]);
    c.DrawBuffer(main);
    c.Present();
    expect(mock.getError()).toBe(GL.NO_ERROR);
    expect(mock.draws).toHaveLength(1);
    expect(mock.draws[0]!.fbo).toBeNull();
  });

  it('a mode change drops the buffers and the next Initialize rebuilds them at the new size', () => {
    const { mock, c } = makeCompositor(GAL_ANTIALIASING_MODE.AA_NONE);
    c.CreateBuffer();
    c.SetAntialiasingMode(GAL_ANTIALIASING_MODE.AA_HIGHQUALITY);
    expect([...mock.attachments.values()].filter((s) => s.size > 0)).toHaveLength(0);
    c.Initialize();
    const main = c.CreateBuffer();
    c.SetBuffer(main);
    expect(mock.vp).toEqual([0, 0, 200, 160]);
  });
});
