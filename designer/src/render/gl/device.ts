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
import {
  DISC_STRIDE,
  SEGMENT_STRIDE,
  TRIANGLE_STRIDE,
  type ItemRanges,
  type Run,
  type Scene,
} from './scene.js';

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

/**
 * One set of buffers: the geometry of a single layer.
 *
 * There are two. The **base** holds the document and is uploaded when the
 * document changes. The **preview** holds only the items being dragged and is
 * re-uploaded on every pointer move, which is what KiCad's
 * `VIEW::AddToPreview` group is for. Keeping them apart is the whole point: a
 * drag must not touch the base, and a base upload of 30,000 segments must not
 * happen sixty times a second.
 */
interface GlLayer {
  seg: WebGLBuffer;
  disc: WebGLBuffer;
  tri: WebGLBuffer;
  vaoSeg: WebGLVertexArrayObject;
  vaoDisc: WebGLVertexArrayObject;
  vaoTri: WebGLVertexArrayObject;
  segCount: number;
  discCount: number;
  triVerts: number;
  /** Painter's order across the three kinds; empty means "three draws". */
  runs: Run[];
}

/**
 * The per-instance attribute layout of each instanced program: (location, size,
 * float offset within the stride).
 *
 * Named rather than inlined because a run has to re-point them at its own first
 * instance: WebGL2 has no `baseInstance`, so an instanced draw always starts at
 * instance zero and the only way to start elsewhere is to move the attribute
 * pointers.
 */
const SEGMENT_ATTRS: [number, number, number][] = [
  [1, 2, 0], // p0
  [2, 2, 2], // p1
  [3, 1, 4], // halfWidth
  [4, 1, 5], // minPx
  [5, 4, 6], // colour
];

const DISC_ATTRS: [number, number, number][] = [
  [1, 2, 0], // centre
  [2, 1, 2], // radius
  [3, 1, 3], // minPx
  [4, 4, 4], // colour
];

/** The unit quad every instanced primitive expands from. */
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

/** Build one layer's buffers and vertex arrays. Null if the driver refuses. */
function createLayer(gl: WebGL2RenderingContext, quad: WebGLBuffer): GlLayer | null {
  const seg = gl.createBuffer();
  const disc = gl.createBuffer();
  const tri = gl.createBuffer();
  const vaoSeg = gl.createVertexArray();
  const vaoDisc = gl.createVertexArray();
  const vaoTri = gl.createVertexArray();
  if (!seg || !disc || !tri || !vaoSeg || !vaoDisc || !vaoTri) return null;

  // Segments: location 0 is the shared quad (divisor 0), 1..5 are per-instance.
  gl.bindVertexArray(vaoSeg);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, seg);
  const segStride = SEGMENT_STRIDE * F32;
  for (const [loc, size, offset] of SEGMENT_ATTRS) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, segStride, offset * F32);
    gl.vertexAttribDivisor(loc, 1);
  }

  gl.bindVertexArray(vaoDisc);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, disc);
  const discStride = DISC_STRIDE * F32;
  for (const [loc, size, offset] of DISC_ATTRS) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, discStride, offset * F32);
    gl.vertexAttribDivisor(loc, 1);
  }

  gl.bindVertexArray(vaoTri);
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  const triStride = TRIANGLE_STRIDE * F32;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, triStride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, triStride, 2 * F32);

  gl.bindVertexArray(null);
  return {
    seg,
    disc,
    tri,
    vaoSeg,
    vaoDisc,
    vaoTri,
    segCount: 0,
    discCount: 0,
    triVerts: 0,
    runs: [],
  };
}

export class GlDevice {
  /** Uniform locations, looked up once. Each `getUniformLocation` is a
   *  synchronous query into the driver, and this was doing four per frame. */
  private readonly uniforms = new Map<
    WebGLProgram,
    { view: WebGLUniformLocation | null; viewport: WebGLUniformLocation | null }
  >();

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly progSeg: WebGLProgram,
    private readonly progDisc: WebGLProgram,
    private readonly progTri: WebGLProgram,
    private readonly quad: WebGLBuffer,
    private readonly base: GlLayer,
    private readonly preview: GlLayer,
  ) {
    for (const p of [progSeg, progDisc, progTri]) {
      this.uniforms.set(p, {
        view: gl.getUniformLocation(p, 'u_view'),
        viewport: gl.getUniformLocation(p, 'u_viewport'),
      });
    }
  }

  static create(canvas: HTMLCanvasElement): GlDevice | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        // Transparent, because this canvas is a layer: the grid is painted by a
        // 2D canvas underneath and the pointer overlay by another on top. The
        // grid is genuinely zoom-dependent, so keeping it out of the retained
        // buffer is right rather than a compromise.
        alpha: true,
        // Premultiplied, because that is what ends up in the buffer.
        //
        // The fragment shader emits straight alpha, but the blend equation
        // below (SRC_ALPHA, ONE_MINUS_SRC_ALPHA over a transparent canvas)
        // stores `alpha·colour` — premultiplied by definition. Declaring
        // `false` made the compositor multiply by the buffer's alpha a second
        // time, so anything not fully opaque came out too dark: a lone zone
        // fill at 0.6 composited as 0.36·colour. Measured against pcbnew, that
        // put a B.Cu pour at (28,52,85) where KiCad draws (46,83,132), and the
        // error tracked the buffer's own alpha exactly — 0.6 under one zone,
        // 0.84 under two, and none at all on opaque tracks, which is why they
        // matched pixel for pixel while every pour was visibly dark.
        premultipliedAlpha: true,
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
    // Chrome over its context budget can hand out a context that is lost from
    // birth — no `webglcontextlost` event will ever fire for it.
    if (gl.isContextLost()) return null;

    const progSeg = link(gl, SEGMENT_VERT, SEGMENT_FRAG);
    const progDisc = link(gl, DISC_VERT, DISC_FRAG);
    const progTri = link(gl, TRIANGLE_VERT, TRIANGLE_FRAG);
    if (!progSeg || !progDisc || !progTri) return null;

    const quad = gl.createBuffer();
    if (!quad) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

    const base = createLayer(gl, quad);
    const preview = createLayer(gl, quad);
    if (!base || !preview) return null;

    return new GlDevice(gl, progSeg, progDisc, progTri, quad, base, preview);
  }

  /**
   * Send a recorded scene to the GPU. The expensive half, and the half that
   * should run only when the document actually changes.
   */
  private uploadInto(layer: GlLayer, scene: Scene): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.seg);
    gl.bufferData(gl.ARRAY_BUFFER, scene.segments.view(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.disc);
    gl.bufferData(gl.ARRAY_BUFFER, scene.discs.view(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.tri);
    gl.bufferData(gl.ARRAY_BUFFER, scene.triangles.view(), gl.DYNAMIC_DRAW);
    layer.segCount = scene.segmentCount;
    layer.discCount = scene.discCount;
    layer.triVerts = scene.triangleVertexCount;
    // Copied, not aliased: the scene is cleared and re-recorded in place.
    layer.runs = scene.runs.map((r) => ({ ...r }));
  }

  /** Send the document. The expensive half, and the rare one. */
  upload(scene: Scene): void {
    this.uploadInto(this.base, scene);
  }

  /**
   * Re-send just one item's vertices after `Scene.translateItem` moved them.
   *
   * This is the point of the per-item ranges, and KiCad's own answer to the
   * same problem: `VIEW::Update` re-caches the moved item alone rather than
   * rebuilding the buffer. A footprint is a few hundred floats out of a
   * million, so a drag costs a handful of `bufferSubData` calls instead of a
   * 1228 ms re-record.
   */
  updateItem(scene: Scene, ranges: ItemRanges): void {
    const gl = this.gl;
    const send = (
      buffer: WebGLBuffer,
      data: Float32Array,
      stride: number,
      list: readonly (readonly [number, number])[],
    ): void => {
      if (list.length === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [first, count] of list) {
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          first * stride * F32,
          data,
          first * stride,
          count * stride,
        );
      }
    };
    send(this.base.seg, scene.segments.view(), SEGMENT_STRIDE, ranges.seg);
    send(this.base.disc, scene.discs.view(), DISC_STRIDE, ranges.disc);
    send(this.base.tri, scene.triangles.view(), TRIANGLE_STRIDE, ranges.tri);
  }

  /**
   * Send the items being dragged. Runs on every pointer move, so it must stay
   * proportional to what is moving rather than to the size of the sheet, which
   * is what `onlyItems` on the recording side is for.
   */
  uploadPreview(scene: Scene): void {
    this.uploadInto(this.preview, scene);
  }

  /** Drop the preview, at the end of a drag. */
  clearPreview(): void {
    this.preview.segCount = 0;
    this.preview.discCount = 0;
    this.preview.triVerts = 0;
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
      const u = this.uniforms.get(p);
      gl.uniform4f(u?.view ?? null, view.scaleX, view.scaleY, view.offsetX, view.offsetY);
      gl.uniform2f(u?.viewport ?? null, w, h);
    };

    // Only re-bind a program when it actually changes. An ordered layer walks
    // hundreds of runs, and most of them share a program with their neighbour.
    let current: WebGLProgram | null = null;
    const bindProgram = (p: WebGLProgram): void => {
      if (p === current) return;
      setView(p);
      current = p;
    };

    // The document, then the items being dragged over it.
    for (const layer of [this.base, this.preview]) {
      if (layer.runs.length > 0) {
        // Painter's order, reproduced exactly: one draw per stretch of one kind,
        // in the sequence they were recorded.
        //
        // The three-draw path below cannot do this, and on a board it is not a
        // subtlety: `buildDrawSteps` paints layer by layer through
        // `PCB_PAINT_ORDER`, so an inner-layer track belongs *under* the front
        // copper pour. Drawing every fill and then every stroke lifts every
        // inner-layer track out from under every pour, and the board comes out
        // looking like a net of wires laid over the top of it.
        for (const run of layer.runs) {
          if (run.count <= 0) continue;
          if (run.kind === 'tri') {
            bindProgram(this.progTri);
            gl.bindVertexArray(layer.vaoTri);
            // Non-instanced, so the first vertex is an argument and nothing has
            // to be re-pointed.
            gl.drawArrays(gl.TRIANGLES, run.start, run.count);
          } else if (run.kind === 'seg') {
            bindProgram(this.progSeg);
            this.pointInstances(layer.vaoSeg, layer.seg, SEGMENT_ATTRS, SEGMENT_STRIDE, run.start);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, run.count);
          } else {
            bindProgram(this.progDisc);
            this.pointInstances(layer.vaoDisc, layer.disc, DISC_ATTRS, DISC_STRIDE, run.start);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, run.count);
          }
        }
        // Leave the pointers at zero so the next frame starts from a known
        // state whichever path draws it. Each rewinds its *own* VAO.
        this.pointInstances(layer.vaoSeg, layer.seg, SEGMENT_ATTRS, SEGMENT_STRIDE, 0);
        this.pointInstances(layer.vaoDisc, layer.disc, DISC_ATTRS, DISC_STRIDE, 0);
        continue;
      }

      // Unordered (the schematic): fills, then strokes, then discs. One layer,
      // and a fill is nearly always under its own outline, so the sequence is
      // not observable and three draws beat several hundred.
      if (layer.triVerts > 0) {
        bindProgram(this.progTri);
        gl.bindVertexArray(layer.vaoTri);
        gl.drawArrays(gl.TRIANGLES, 0, layer.triVerts);
      }
      if (layer.segCount > 0) {
        bindProgram(this.progSeg);
        gl.bindVertexArray(layer.vaoSeg);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.segCount);
      }
      if (layer.discCount > 0) {
        bindProgram(this.progDisc);
        gl.bindVertexArray(layer.vaoDisc);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.discCount);
      }
    }
    gl.bindVertexArray(null);
  }

  /**
   * Aim an instanced program's attributes at instance `first`.
   *
   * WebGL2 has no `baseInstance`: `drawArraysInstanced` always starts at
   * instance zero, so the only way to draw a slice of a buffer is to move the
   * pointers.
   *
   * **Takes the VAO and binds it itself.** `vertexAttribPointer` writes into
   * whichever VAO happens to be bound, so a call that assumed the caller had
   * already bound the right one could silently rewrite another program's
   * attributes — and did: the two "reset the pointers" calls at the end of an
   * ordered draw ran with whatever the last run left bound. When that was a
   * triangle run, the disc reset landed in `vaoTri`, where location 1 is the
   * triangle colour, and re-pointed it at the (empty) disc buffer. WebGL then
   * fed every triangle a colour of zeros, defaulting z and w to (0, 1): opaque
   * black. Every zone pour turned into a black rectangle and everything under
   * it in `PCB_PAINT_ORDER` disappeared behind it. Strokes survived because
   * `vaoSeg` is re-pointed per run on the next frame; nothing ever repaired
   * `vaoTri`, so the damage stuck for the life of the context and looked for
   * all the world like a cache. Passing the VAO makes that unrepresentable.
   */
  private pointInstances(
    vao: WebGLVertexArrayObject,
    buffer: WebGLBuffer,
    attrs: [number, number, number][],
    stride: number,
    first: number,
  ): void {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const base = first * stride * F32;
    for (const [loc, size, offset] of attrs) {
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * F32, base + offset * F32);
    }
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

  /**
   * Whether the context has been lost; the caller falls back when it has.
   *
   * Deliberately just `isContextLost`. A `getError()` probe lived here
   * briefly, meant to catch a context that creates and links but then fails
   * every draw — except `getError` reports *any* error since the last call,
   * including harmless ones from elsewhere, and a false positive drops the
   * board to the software renderer permanently. The case it was added for
   * turned out to be a stale tab rather than a sick device.
   */
  get isLost(): boolean {
    return this.gl.isContextLost();
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.quad);
    for (const layer of [this.base, this.preview]) {
      gl.deleteBuffer(layer.seg);
      gl.deleteBuffer(layer.disc);
      gl.deleteBuffer(layer.tri);
      gl.deleteVertexArray(layer.vaoSeg);
      gl.deleteVertexArray(layer.vaoDisc);
      gl.deleteVertexArray(layer.vaoTri);
    }
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
