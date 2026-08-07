// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The WebGL2 device: owns the context, the programs and the buffers.
 *
 * The division of labour that makes this worth having is between `upload` and
 * `draw`. `upload` is the expensive one and runs only when the document, the
 * theme or the display options change. `draw` sets one uniform and issues three
 * draw calls, so panning and zooming cost the same on a dense sheet as on an
 * empty one. That is the whole reason for the exercise: today a zoom step is a
 * full Canvas2D repaint of about 70 ms (#449).
 *
 * Everything degrades rather than throws. `createGlDevice` returns null when
 * there is no WebGL2, when the context is refused, or when a program fails to
 * build, and the caller keeps the Canvas2D renderer. A browser without WebGL2
 * must still get a working editor, and a context can be lost at any moment for
 * reasons that have nothing to do with us.
 */

import {
  DISC_FRAG,
  DISC_VERT,
  SEGMENT_FRAG,
  SEGMENT_VERT,
  TRIANGLE_FRAG,
  TRIANGLE_VERT,
} from './shaders.js';
import { DISC_STRIDE, SEGMENT_STRIDE, TRIANGLE_STRIDE, type Scene } from './scene.js';

/** The view as the shaders want it: pixels per world unit, and a pixel offset. */
export interface GlView {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

const F32 = Float32Array.BYTES_PER_ELEMENT;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Worth a console line: a shader that fails to build is a bug in our
    // source, not a property of the user's machine, and the fallback to
    // Canvas2D would otherwise hide it completely.
    console.warn('GL shader failed to compile:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn('GL program failed to link:', gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

/** The unit quad every instanced primitive expands from. */
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

export class GlDevice {
  private segCount = 0;
  private discCount = 0;
  private triVerts = 0;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly progSeg: WebGLProgram,
    private readonly progDisc: WebGLProgram,
    private readonly progTri: WebGLProgram,
    private readonly quad: WebGLBuffer,
    private readonly bufSeg: WebGLBuffer,
    private readonly bufDisc: WebGLBuffer,
    private readonly bufTri: WebGLBuffer,
    private readonly vaoSeg: WebGLVertexArrayObject,
    private readonly vaoDisc: WebGLVertexArrayObject,
    private readonly vaoTri: WebGLVertexArrayObject,
  ) {}

  static create(canvas: HTMLCanvasElement): GlDevice | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        // Transparent, because this canvas is a layer: the grid is painted by a
        // 2D canvas underneath and the pointer overlay by another on top. The
        // grid is genuinely zoom-dependent, so keeping it out of the retained
        // buffer is right rather than a compromise.
        alpha: true,
        // The fragment shader emits straight (non-premultiplied) alpha, which
        // is what the coverage term produces naturally, so the compositor has
        // to be told not to expect premultiplied.
        premultipliedAlpha: false,
        antialias: false, // the distance test antialiases; MSAA on top costs for nothing
        depth: false,
        stencil: false,
        // The scene persists between frames and we always redraw it in full,
        // so there is nothing to preserve and preserving costs a copy.
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      }) as WebGL2RenderingContext | null;
    } catch {
      return null;
    }
    if (!gl) return null;

    const progSeg = link(gl, SEGMENT_VERT, SEGMENT_FRAG);
    const progDisc = link(gl, DISC_VERT, DISC_FRAG);
    const progTri = link(gl, TRIANGLE_VERT, TRIANGLE_FRAG);
    if (!progSeg || !progDisc || !progTri) return null;

    const quad = gl.createBuffer();
    const bufSeg = gl.createBuffer();
    const bufDisc = gl.createBuffer();
    const bufTri = gl.createBuffer();
    const vaoSeg = gl.createVertexArray();
    const vaoDisc = gl.createVertexArray();
    const vaoTri = gl.createVertexArray();
    if (!quad || !bufSeg || !bufDisc || !bufTri || !vaoSeg || !vaoDisc || !vaoTri) return null;

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

    // Segments: location 0 is the shared quad (divisor 0), 1..5 are per-instance.
    gl.bindVertexArray(vaoSeg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufSeg);
    const segStride = SEGMENT_STRIDE * F32;
    const segAttrs: [number, number, number][] = [
      [1, 2, 0], // p0
      [2, 2, 2], // p1
      [3, 1, 4], // halfWidth
      [4, 1, 5], // minPx
      [5, 4, 6], // colour
    ];
    for (const [loc, size, offset] of segAttrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, segStride, offset * F32);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.bindVertexArray(vaoDisc);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDisc);
    const discStride = DISC_STRIDE * F32;
    const discAttrs: [number, number, number][] = [
      [1, 2, 0], // centre
      [2, 1, 2], // radius
      [3, 1, 3], // minPx
      [4, 4, 4], // colour
    ];
    for (const [loc, size, offset] of discAttrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, discStride, offset * F32);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.bindVertexArray(vaoTri);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTri);
    const triStride = TRIANGLE_STRIDE * F32;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, triStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, triStride, 2 * F32);

    gl.bindVertexArray(null);

    return new GlDevice(
      gl,
      progSeg,
      progDisc,
      progTri,
      quad,
      bufSeg,
      bufDisc,
      bufTri,
      vaoSeg,
      vaoDisc,
      vaoTri,
    );
  }

  /**
   * Send a recorded scene to the GPU. The expensive half, and the half that
   * should run only when the document actually changes.
   */
  upload(scene: Scene): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeg);
    gl.bufferData(gl.ARRAY_BUFFER, scene.segments.view(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDisc);
    gl.bufferData(gl.ARRAY_BUFFER, scene.discs.view(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufTri);
    gl.bufferData(gl.ARRAY_BUFFER, scene.triangles.view(), gl.DYNAMIC_DRAW);
    this.segCount = scene.segmentCount;
    this.discCount = scene.discCount;
    this.triVerts = scene.triangleVertexCount;
  }

  /**
   * Redraw at the given view. The cheap half: one uniform per program and three
   * draw calls, whatever the sheet contains.
   */
  draw(view: GlView, clear: { r: number; g: number; b: number; a: number } | null): void {
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    gl.viewport(0, 0, w, h);
    // Null clears to transparent, which is what a layer over the grid wants.
    if (clear) gl.clearColor(clear.r, clear.g, clear.b, clear.a);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    // Straight (non-premultiplied) alpha, matching how the colours are parsed.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const setView = (p: WebGLProgram): void => {
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is WebGL, not a React hook; the rule matches on the "use" prefix
      gl.useProgram(p);
      gl.uniform4f(
        gl.getUniformLocation(p, 'u_view'),
        view.scaleX,
        view.scaleY,
        view.offsetX,
        view.offsetY,
      );
      gl.uniform2f(gl.getUniformLocation(p, 'u_viewport'), w, h);
    };

    // Fills first, then strokes over them, then discs: the order the Canvas2D
    // renderer paints in, and the order the result has to match.
    if (this.triVerts > 0) {
      setView(this.progTri);
      gl.bindVertexArray(this.vaoTri);
      gl.drawArrays(gl.TRIANGLES, 0, this.triVerts);
    }
    if (this.segCount > 0) {
      setView(this.progSeg);
      gl.bindVertexArray(this.vaoSeg);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.segCount);
    }
    if (this.discCount > 0) {
      setView(this.progDisc);
      gl.bindVertexArray(this.vaoDisc);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.discCount);
    }
    gl.bindVertexArray(null);
  }

  /**
   * Blank the layer without drawing anything.
   *
   * Needed whenever a frame is painted by the Canvas2D path instead: this
   * canvas sits *above* the 2D one, so a buffer left on it from an earlier
   * frame keeps showing through. That is what put a second, stale copy of a
   * dragged symbol on screen while the real one followed the cursor
   * underneath.
   */
  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Whether the context has been lost; the caller falls back when it has. */
  get isLost(): boolean {
    return this.gl.isContextLost();
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.bufSeg);
    gl.deleteBuffer(this.bufDisc);
    gl.deleteBuffer(this.bufTri);
    gl.deleteVertexArray(this.vaoSeg);
    gl.deleteVertexArray(this.vaoDisc);
    gl.deleteVertexArray(this.vaoTri);
    gl.deleteProgram(this.progSeg);
    gl.deleteProgram(this.progDisc);
    gl.deleteProgram(this.progTri);
  }
}

/** Build a device, or null when this browser or moment cannot provide one. */
export function createGlDevice(canvas: HTMLCanvasElement): GlDevice | null {
  try {
    return GlDevice.create(canvas);
  } catch {
    return null;
  }
}
