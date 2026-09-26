// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/antialiasing.h` + `.cpp`: `KIGFX::OPENGL_PRESENTOR` and the
 * three ways the compositor presents its buffers - as they are, through a
 * 2x supersampled buffer, or through the three SMAA passes.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { Color4d } from '../../color4d.js';
import { GL_BEGIN_MODE, GL_MATRIX_MODE } from './gl_fixed_function.js';
import type { OPENGL_COMPOSITOR } from './opengl_compositor.js';
import { SHADER, SHADER_TYPE } from './shader.js';
import { glsl_smaa_base } from './shaders/smaa_base.js';
import {
  glsl_smaa_pass_1_frag_luma,
  glsl_smaa_pass_1_vert,
  glsl_smaa_pass_2_frag,
  glsl_smaa_pass_2_vert,
  glsl_smaa_pass_3_frag,
  glsl_smaa_pass_3_vert,
} from './shaders/smaa_passes.js';
import {
  AREATEX_HEIGHT,
  AREATEX_WIDTH,
  areaTexBytes,
  SEARCHTEX_HEIGHT,
  SEARCHTEX_WIDTH,
  searchTexBytes,
} from './smaa_textures.js';
import { checkGlError } from './utils.js';

const COLOR4D_BLACK: Color4d = { r: 0, g: 0, b: 0, a: 1 };

export interface OPENGL_PRESENTOR {
  Init(): boolean;
  CreateBuffer(): number;
  GetInternalBufferSize(): VECTOR2I;
  OnLostBuffers(): void;
  Begin(): void;
  DrawBuffer(aBuffer: number): void;
  Present(): void;
}

// =========================
// ANTIALIASING_NONE
// =========================

export class ANTIALIASING_NONE implements OPENGL_PRESENTOR {
  private compositor: OPENGL_COMPOSITOR;

  constructor(aCompositor: OPENGL_COMPOSITOR) {
    this.compositor = aCompositor;
  }

  Init(): boolean {
    // Nothing to initialize
    return true;
  }

  GetInternalBufferSize(): VECTOR2I {
    return this.compositor.GetScreenSize();
  }

  DrawBuffer(buffer: number): void {
    this.compositor.DrawBuffer(buffer, DIRECT_RENDERING);
  }

  Present(): void {
    // Nothing to present, draw_buffer already drew to the screen
  }

  OnLostBuffers(): void {
    // Nothing to do
  }

  Begin(): void {
    // Nothing to do
  }

  CreateBuffer(): number {
    return this.compositor.CreateBuffer(this.compositor.GetScreenSize());
  }
}

const DIRECT_RENDERING = 0; // OPENGL_COMPOSITOR::DIRECT_RENDERING

function draw_fullscreen_primitive(compositor: OPENGL_COMPOSITOR): void {
  const ff = compositor.ff;

  ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);
  ff.glPushMatrix();
  ff.glLoadIdentity();
  ff.glMatrixMode(GL_MATRIX_MODE.GL_PROJECTION);
  ff.glPushMatrix();
  ff.glLoadIdentity();

  ff.glBegin(GL_BEGIN_MODE.GL_TRIANGLES);
  ff.glTexCoord2f(0.0, 1.0);
  ff.glVertex2f(-1.0, 1.0);
  ff.glTexCoord2f(0.0, 0.0);
  ff.glVertex2f(-1.0, -1.0);
  ff.glTexCoord2f(1.0, 1.0);
  ff.glVertex2f(1.0, 1.0);

  ff.glTexCoord2f(1.0, 1.0);
  ff.glVertex2f(1.0, 1.0);
  ff.glTexCoord2f(0.0, 0.0);
  ff.glVertex2f(-1.0, -1.0);
  ff.glTexCoord2f(1.0, 0.0);
  ff.glVertex2f(1.0, -1.0);
  ff.glEnd();

  ff.glPopMatrix();
  ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);
  ff.glPopMatrix();
}

// =========================
// ANTIALIASING_SUPERSAMPLING
// =========================

export class ANTIALIASING_SUPERSAMPLING implements OPENGL_PRESENTOR {
  private compositor: OPENGL_COMPOSITOR;
  private ssaaMainBuffer: number;
  private areBuffersCreated: boolean;
  private areShadersCreated: boolean;

  constructor(aCompositor: OPENGL_COMPOSITOR) {
    this.compositor = aCompositor;
    this.ssaaMainBuffer = 0;
    this.areBuffersCreated = false;
    this.areShadersCreated = false;
  }

  Init(): boolean {
    const gl = this.compositor.gl;
    this.areShadersCreated = false;

    if (!this.areBuffersCreated) {
      this.ssaaMainBuffer = this.compositor.CreateBuffer();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      this.areBuffersCreated = true;
    }

    return true;
  }

  GetInternalBufferSize(): VECTOR2I {
    const s = this.compositor.GetScreenSize();
    return { x: s.x * 2, y: s.y * 2 };
  }

  Begin(): void {
    this.compositor.SetBuffer(this.ssaaMainBuffer);
    this.compositor.ClearBuffer(COLOR4D_BLACK);
  }

  DrawBuffer(aBuffer: number): void {
    this.compositor.DrawBuffer(aBuffer, this.ssaaMainBuffer);
  }

  Present(): void {
    const gl = this.compositor.gl;

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.compositor.GetBufferTexture(this.ssaaMainBuffer));
    this.compositor.SetBuffer(DIRECT_RENDERING);

    gl.colorMask(true, true, true, false);
    draw_fullscreen_primitive(this.compositor);
    gl.colorMask(true, true, true, true);
  }

  OnLostBuffers(): void {
    this.areBuffersCreated = false;
  }

  CreateBuffer(): number {
    return this.compositor.CreateBuffer(this.GetInternalBufferSize());
  }
}

// ===============================
// ANTIALIASING_SMAA
// ===============================

export class ANTIALIASING_SMAA implements OPENGL_PRESENTOR {
  private areBuffersInitialized: boolean;

  private smaaBaseBuffer: number; // base + overlay temporary
  private smaaEdgesBuffer: number;
  private smaaBlendBuffer: number;

  // smaa shader lookup textures
  private smaaAreaTex: WebGLTexture | null;
  private smaaSearchTex: WebGLTexture | null;

  private shadersLoaded: boolean;

  private pass_1_shader: SHADER | null = null;
  private pass_1_metrics: number;

  private pass_2_shader: SHADER | null = null;
  private pass_2_metrics: number;

  private pass_3_shader: SHADER | null = null;
  private pass_3_metrics: number;

  private compositor: OPENGL_COMPOSITOR;

  constructor(aCompositor: OPENGL_COMPOSITOR) {
    this.areBuffersInitialized = false;
    this.shadersLoaded = false;
    this.compositor = aCompositor;

    this.smaaBaseBuffer = 0;
    this.smaaEdgesBuffer = 0;
    this.smaaBlendBuffer = 0;
    this.smaaAreaTex = null;
    this.smaaSearchTex = null;
    this.pass_1_metrics = 0;
    this.pass_2_metrics = 0;
    this.pass_3_metrics = 0;
  }

  GetInternalBufferSize(): VECTOR2I {
    return this.compositor.GetScreenSize();
  }

  private loadShaders(): void {
    const gl = this.compositor.gl;

    // Load constant textures
    this.compositor.ff.glEnableTexture2D(true);
    gl.activeTexture(gl.TEXTURE0);

    this.smaaAreaTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.smaaAreaTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG8,
      AREATEX_WIDTH,
      AREATEX_HEIGHT,
      0,
      gl.RG,
      gl.UNSIGNED_BYTE,
      areaTexBytes,
    );
    checkGlError(gl, 'loading smaa area tex');

    this.smaaSearchTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.smaaSearchTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      SEARCHTEX_WIDTH,
      SEARCHTEX_HEIGHT,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      searchTexBytes,
    );
    checkGlError(gl, 'loading smaa search tex');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    // Quality settings:
    // THRESHOLD: intended to exclude spurious edges in photorealistic game graphics
    //            but in a high-contrast CAD application, all edges are intentional
    //            should be set fairly low, so user color choices do not affect antialiasing
    // MAX_SEARCH_STEPS: steps of 2px, searched in H/V direction to discover true angle of edges
    //                   improves AA for lines close H/V but creates fuzzyness at junctions
    // MAX_SEARCH_STEPS_DIAG: steps of 1px, searched in diagonal direction
    //                        improves lines close to 45deg but turns small circles into octagons
    // CORNER_ROUNDING: SMAA can distinguish actual corners from aliasing jaggies,
    //                  we want to preserve those as much as possible
    // Edge Detection: In Eeschema, when a single pixel line changes color, edge detection using
    //                 color is too aggressive and leads to a white spot at the transition point

    // trades imperfect AA of shallow angles for a near artifact-free reproduction of fine features
    // jaggies are smoothed over max 5px (original step + 2px in both directions)
    const quality_string =
      '#define SMAA_THRESHOLD 0.005\n' +
      '#define SMAA_MAX_SEARCH_STEPS 1\n' +
      '#define SMAA_MAX_SEARCH_STEPS_DIAG 2\n' +
      '#define SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR 1.5\n' +
      '#define SMAA_CORNER_ROUNDING 0\n';
    const edge_detect_shader = glsl_smaa_pass_1_frag_luma;

    // set up shaders: SMAA_GLSL_3 is the flavour GLSL ES 3.00 compiles
    const vert_preamble = `#version 300 es
precision highp float;
#define SMAA_GLSL_3
#define SMAA_INCLUDE_VS 1
#define SMAA_INCLUDE_PS 0
uniform vec4 SMAA_RT_METRICS;
`;

    const frag_preamble = `#version 300 es
precision highp float;
#define SMAA_GLSL_3
#define SMAA_INCLUDE_VS 0
#define SMAA_INCLUDE_PS 1
uniform vec4 SMAA_RT_METRICS;
`;

    //
    // Set up pass 1 Shader
    //
    this.pass_1_shader = new SHADER(gl);
    this.pass_1_shader.LoadShaderFromStrings(
      SHADER_TYPE.SHADER_TYPE_VERTEX,
      vert_preamble,
      quality_string,
      glsl_smaa_base,
      glsl_smaa_pass_1_vert,
    );
    this.pass_1_shader.LoadShaderFromStrings(
      SHADER_TYPE.SHADER_TYPE_FRAGMENT,
      frag_preamble,
      quality_string,
      glsl_smaa_base,
      edge_detect_shader,
    );
    this.pass_1_shader.Link();
    checkGlError(gl, 'linking pass 1 shader');

    const smaaColorTexParameter = this.pass_1_shader.AddParameter('colorTex');
    checkGlError(gl, 'pass1: getting colorTex uniform');
    this.pass_1_metrics = this.pass_1_shader.AddParameter('SMAA_RT_METRICS');
    checkGlError(gl, 'pass1: getting metrics uniform');

    this.pass_1_shader.Use();
    checkGlError(gl, 'pass1: using shader');
    this.pass_1_shader.SetParameterInt(smaaColorTexParameter, 0);
    checkGlError(gl, 'pass1: setting colorTex uniform');
    this.pass_1_shader.Deactivate();
    checkGlError(gl, 'pass1: deactivating shader');

    //
    // set up pass 2 shader
    //
    this.pass_2_shader = new SHADER(gl);
    this.pass_2_shader.LoadShaderFromStrings(
      SHADER_TYPE.SHADER_TYPE_VERTEX,
      vert_preamble,
      quality_string,
      glsl_smaa_base,
      glsl_smaa_pass_2_vert,
    );
    this.pass_2_shader.LoadShaderFromStrings(
      SHADER_TYPE.SHADER_TYPE_FRAGMENT,
      frag_preamble,
      quality_string,
      glsl_smaa_base,
      glsl_smaa_pass_2_frag,
    );
    this.pass_2_shader.Link();
    checkGlError(gl, 'linking pass 2 shader');

    const smaaEdgesTexParameter = this.pass_2_shader.AddParameter('edgesTex');
    checkGlError(gl, 'pass2: getting colorTex uniform');
    const smaaAreaTexParameter = this.pass_2_shader.AddParameter('areaTex');
    checkGlError(gl, 'pass2: getting areaTex uniform');
    const smaaSearchTexParameter = this.pass_2_shader.AddParameter('searchTex');
    checkGlError(gl, 'pass2: getting searchTex uniform');
    this.pass_2_metrics = this.pass_2_shader.AddParameter('SMAA_RT_METRICS');
    checkGlError(gl, 'pass2: getting metrics uniform');

    this.pass_2_shader.Use();
    checkGlError(gl, 'pass2: using shader');
    this.pass_2_shader.SetParameterInt(smaaEdgesTexParameter, 0);
    checkGlError(gl, 'pass2: setting colorTex uniform');
    this.pass_2_shader.SetParameterInt(smaaAreaTexParameter, 1);
    checkGlError(gl, 'pass2: setting areaTex uniform');
    this.pass_2_shader.SetParameterInt(smaaSearchTexParameter, 3);
    checkGlError(gl, 'pass2: setting searchTex uniform');
    this.pass_2_shader.Deactivate();
    checkGlError(gl, 'pass2: deactivating shader');

    //
    // set up pass 3 shader
    //
    this.pass_3_shader = new SHADER(gl);
    this.pass_3_shader.LoadShaderFromStrings(
      SHADER_TYPE.SHADER_TYPE_VERTEX,
      vert_preamble,
      quality_string,
      glsl_smaa_base,
      glsl_smaa_pass_3_vert,
    );
    this.pass_3_shader.LoadShaderFromStrings(
      SHADER_TYPE.SHADER_TYPE_FRAGMENT,
      frag_preamble,
      quality_string,
      glsl_smaa_base,
      glsl_smaa_pass_3_frag,
    );
    this.pass_3_shader.Link();

    const smaaP3ColorTexParameter = this.pass_3_shader.AddParameter('colorTex');
    checkGlError(gl, 'pass3: getting colorTex uniform');
    const smaaBlendTexParameter = this.pass_3_shader.AddParameter('blendTex');
    checkGlError(gl, 'pass3: getting blendTex uniform');
    this.pass_3_metrics = this.pass_3_shader.AddParameter('SMAA_RT_METRICS');
    checkGlError(gl, 'pass3: getting metrics uniform');

    this.pass_3_shader.Use();
    checkGlError(gl, 'pass3: using shader');
    this.pass_3_shader.SetParameterInt(smaaP3ColorTexParameter, 0);
    checkGlError(gl, 'pass3: setting colorTex uniform');
    this.pass_3_shader.SetParameterInt(smaaBlendTexParameter, 1);
    checkGlError(gl, 'pass3: setting blendTex uniform');
    this.pass_3_shader.Deactivate();
    checkGlError(gl, 'pass3: deactivating shader');

    this.shadersLoaded = true;
  }

  private updateUniforms(): void {
    const gl = this.compositor.gl;
    const dims = this.compositor.GetScreenSize();

    this.pass_1_shader!.Use();
    checkGlError(gl, 'pass1: using shader');
    this.pass_1_shader!.SetParameter(this.pass_1_metrics, 1 / dims.x, 1 / dims.y, dims.x, dims.y);
    checkGlError(gl, 'pass1: setting metrics uniform');
    this.pass_1_shader!.Deactivate();
    checkGlError(gl, 'pass1: deactivating shader');

    this.pass_2_shader!.Use();
    checkGlError(gl, 'pass2: using shader');
    this.pass_2_shader!.SetParameter(this.pass_2_metrics, 1 / dims.x, 1 / dims.y, dims.x, dims.y);
    checkGlError(gl, 'pass2: setting metrics uniform');
    this.pass_2_shader!.Deactivate();
    checkGlError(gl, 'pass2: deactivating shader');

    this.pass_3_shader!.Use();
    checkGlError(gl, 'pass3: using shader');
    this.pass_3_shader!.SetParameter(this.pass_3_metrics, 1 / dims.x, 1 / dims.y, dims.x, dims.y);
    checkGlError(gl, 'pass3: setting metrics uniform');
    this.pass_3_shader!.Deactivate();
    checkGlError(gl, 'pass3: deactivating shader');
  }

  Init(): boolean {
    const gl = this.compositor.gl;

    if (!this.shadersLoaded) this.loadShaders();

    if (!this.areBuffersInitialized) {
      this.smaaBaseBuffer = this.compositor.CreateBuffer();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      this.smaaEdgesBuffer = this.compositor.CreateBuffer();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      this.smaaBlendBuffer = this.compositor.CreateBuffer();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      this.updateUniforms();
      this.areBuffersInitialized = true;
    }

    // Nothing to initialize
    return true;
  }

  OnLostBuffers(): void {
    this.areBuffersInitialized = false;
  }

  CreateBuffer(): number {
    return this.compositor.CreateBuffer(this.compositor.GetScreenSize());
  }

  DrawBuffer(buffer: number): void {
    // draw to internal buffer
    this.compositor.DrawBuffer(buffer, this.smaaBaseBuffer);
  }

  Begin(): void {
    this.compositor.SetBuffer(this.smaaBaseBuffer);
    this.compositor.ClearBuffer(COLOR4D_BLACK);
  }

  private draw_fullscreen_triangle(): void {
    const ff = this.compositor.ff;

    ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);
    ff.glPushMatrix();
    ff.glLoadIdentity();
    ff.glMatrixMode(GL_MATRIX_MODE.GL_PROJECTION);
    ff.glPushMatrix();
    ff.glLoadIdentity();

    ff.glBegin(GL_BEGIN_MODE.GL_TRIANGLES);
    ff.glTexCoord2f(0.0, 1.0);
    ff.glVertex2f(-1.0, 1.0);
    ff.glTexCoord2f(0.0, -1.0);
    ff.glVertex2f(-1.0, -3.0);
    ff.glTexCoord2f(2.0, 1.0);
    ff.glVertex2f(3.0, 1.0);
    ff.glEnd();

    ff.glPopMatrix();
    ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);
    ff.glPopMatrix();
  }

  Present(): void {
    const gl = this.compositor.gl;
    const sourceTexture = this.compositor.GetBufferTexture(this.smaaBaseBuffer);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.compositor.ff.glEnableTexture2D(true);

    //
    // pass 1: main-buffer -> smaaEdgesBuffer
    //
    this.compositor.SetBuffer(this.smaaEdgesBuffer);
    this.compositor.ClearBuffer(COLOR4D_BLACK);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    checkGlError(gl, 'binding colorTex');
    this.pass_1_shader!.Use();
    checkGlError(gl, 'using smaa pass 1 shader');
    this.draw_fullscreen_triangle();
    this.pass_1_shader!.Deactivate();

    //
    // pass 2: smaaEdgesBuffer -> smaaBlendBuffer
    //
    this.compositor.SetBuffer(this.smaaBlendBuffer);
    this.compositor.ClearBuffer(COLOR4D_BLACK);
    const edgesTex = this.compositor.GetBufferTexture(this.smaaEdgesBuffer);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, edgesTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.smaaAreaTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.smaaSearchTex);

    this.pass_2_shader!.Use();
    this.draw_fullscreen_triangle();
    this.pass_2_shader!.Deactivate();

    //
    // pass 3: colorTex + BlendBuffer -> output
    //
    this.compositor.SetBuffer(DIRECT_RENDERING);
    this.compositor.ClearBuffer(COLOR4D_BLACK);
    const blendTex = this.compositor.GetBufferTexture(this.smaaBlendBuffer);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blendTex);

    gl.colorMask(true, true, true, false);
    this.pass_3_shader!.Use();
    this.draw_fullscreen_triangle();
    this.pass_3_shader!.Deactivate();
    gl.colorMask(true, true, true, true);
  }
}
