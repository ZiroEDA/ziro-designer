// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/compositor.h` + `gal/opengl/opengl_compositor.h` + `.cpp`:
 * `KIGFX::COMPOSITOR` and `OPENGL_COMPOSITOR`, the render targets (one FBO
 * with a texture per buffer and a shared depth/stencil renderbuffer) the
 * GAL draws into and composites to the screen.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { Color4d } from '../../color4d.js';
import { GAL_ANTIALIASING_MODE } from '../gal_display_options.js';
import {
  ANTIALIASING_NONE,
  ANTIALIASING_SMAA,
  ANTIALIASING_SUPERSAMPLING,
  type OPENGL_PRESENTOR,
} from './antialiasing.js';
import { GL_BEGIN_MODE, GL_FIXED_FUNCTION, GL_MATRIX_MODE } from './gl_fixed_function.js';
import { glsl_xor_diff_frag, glsl_xor_diff_vert } from './shaders/xor_diff.js';
import { checkGlError } from './utils.js';

const COLOR4D_BLACK: Color4d = { r: 0, g: 0, b: 0, a: 1 };

/**
 * Handle multitarget rendering (ie. to different textures/surfaces) and later compositing
 * into a single image (`gal/compositor.h`).
 */
export abstract class COMPOSITOR {
  protected m_width: number; ///< Width of the buffer (in pixels)
  protected m_height: number; ///< Height of the buffer (in pixels)

  constructor() {
    this.m_width = 0;
    this.m_height = 0;
  }

  /**
   * Perform primary initialization, necessary to use the object.
   */
  abstract Initialize(): void;

  /**
   * Clear the state of COMPOSITOR, so it has to be reinitialized again with the new
   * dimensions.
   *
   * @param aWidth is the framebuffer width (in pixels).
   * @param aHeight is the framebuffer height (in pixels).
   */
  abstract Resize(aWidth: number, aHeight: number): void;

  /**
   * Prepare a new buffer that may be used as a rendering target.
   *
   * @return is the handle of the buffer. In case of failure 0 (zero) is returned as the handle.
   */
  abstract CreateBuffer(): number;

  /**
   * Return currently used buffer handle.
   *
   * @return Currently used buffer handle.
   */
  abstract GetBuffer(): number;

  /**
   * Set the selected buffer as the rendering target.
   *
   * @param aBufferHandle is the handle of the buffer or 0 in case of rendering directly to
   *                      the display.
   */
  abstract SetBuffer(aBufferHandle: number): void;

  /**
   * Clear the selected buffer (set by the SetBuffer() function).
   */
  abstract ClearBuffer(aColor: Color4d): void;

  /**
   * Call this at the beginning of each frame.
   */
  abstract Begin(): void;

  /**
   * Draw the selected buffer to the output buffer.
   *
   * @param aBufferHandle is the handle of the buffer to be drawn.
   */
  abstract DrawBuffer(aBufferHandle: number): void;

  /**
   * Call this to present the output buffer to the screen.
   */
  abstract Present(): void;
}

// Buffers are simply textures storing a result of certain target rendering.
interface OPENGL_BUFFER {
  dimensions: VECTOR2I;
  textureTarget: WebGLTexture; ///< Main texture handle
  attachmentPoint: number; ///< Point to which an image from texture is attached
}

export class OPENGL_COMPOSITOR extends COMPOSITOR {
  // Constant used by glBindFramebuffer to turn off rendering to framebuffers
  static readonly DIRECT_RENDERING = 0;

  protected m_initialized: boolean; ///< Initialization status flag
  protected m_curBuffer: number; ///< Currently used buffer handle
  protected m_mainFbo: WebGLFramebuffer | null; ///< Main FBO handle (storing all target textures)
  protected m_depthBuffer: WebGLRenderbuffer | null; ///< Depth buffer handle

  /// Stores information about initialized buffers
  protected m_buffers: OPENGL_BUFFER[] = [];

  /// Store the used FBO name in case there was more than one compositor used
  protected m_curFbo: WebGLFramebuffer | number;

  protected m_currentAntialiasingMode: GAL_ANTIALIASING_MODE;
  protected m_antialiasing: OPENGL_PRESENTOR;

  // Difference shader for XOR-style compositing
  protected m_differenceShader: WebGLProgram | null; ///< Difference shader program
  protected m_diffSrcTexUniform: WebGLUniformLocation | null; ///< Source texture uniform location
  protected m_diffDstTexUniform: WebGLUniformLocation | null; ///< Destination texture uniform location
  protected m_differenceShaderInitialized: boolean;

  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly ff: GL_FIXED_FUNCTION,
  ) {
    super();
    this.m_initialized = false;
    this.m_curBuffer = 0;
    this.m_mainFbo = null;
    this.m_depthBuffer = null;
    this.m_curFbo = OPENGL_COMPOSITOR.DIRECT_RENDERING;
    this.m_currentAntialiasingMode = GAL_ANTIALIASING_MODE.AA_NONE;
    this.m_differenceShader = null;
    this.m_diffSrcTexUniform = null;
    this.m_diffDstTexUniform = null;
    this.m_differenceShaderInitialized = false;

    this.m_antialiasing = new ANTIALIASING_NONE(this);
  }

  /** `~OPENGL_COMPOSITOR`. */
  destroy(): void {
    if (this.m_initialized) {
      try {
        this.clean();
      } catch (exc) {
        console.error(`Run time exception \`${exc}\` occurred in OPENGL_COMPOSITOR destructor.`);
      }
    }
  }

  SetAntialiasingMode(aMode: GAL_ANTIALIASING_MODE): void {
    // clears all buffers
    this.m_currentAntialiasingMode = aMode;

    if (this.m_initialized) this.clean();
  }

  GetAntialiasingMode(): GAL_ANTIALIASING_MODE {
    return this.m_currentAntialiasingMode;
  }

  /// @copydoc COMPOSITOR::Initialize()
  Initialize(): void {
    if (this.m_initialized) return;

    const gl = this.gl;

    switch (this.m_currentAntialiasingMode) {
      case GAL_ANTIALIASING_MODE.AA_FAST:
        this.m_antialiasing = new ANTIALIASING_SMAA(this);
        break;
      case GAL_ANTIALIASING_MODE.AA_HIGHQUALITY:
        this.m_antialiasing = new ANTIALIASING_SUPERSAMPLING(this);
        break;
      default:
        this.m_antialiasing = new ANTIALIASING_NONE(this);
        break;
    }

    const dims = this.m_antialiasing.GetInternalBufferSize();
    console.assert(dims.x !== 0 && dims.y !== 0);

    const maxBufSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;

    if (dims.x < 0 || dims.y < 0 || dims.x > maxBufSize || dims.y >= maxBufSize)
      throw new Error('Requested render buffer size is not supported');

    // We need framebuffer objects for drawing the screen contents
    // Generate framebuffer and a depth buffer
    this.m_mainFbo = gl.createFramebuffer();
    checkGlError(gl, 'generating framebuffer');
    this.bindFb(this.m_mainFbo!);

    // Allocate memory for the depth buffer
    // Attach the depth buffer to the framebuffer
    this.m_depthBuffer = gl.createRenderbuffer();
    checkGlError(gl, 'generating renderbuffer');
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.m_depthBuffer);
    checkGlError(gl, 'binding renderbuffer');

    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, dims.x, dims.y);
    checkGlError(gl, 'creating renderbuffer storage');
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      this.m_depthBuffer,
    );
    checkGlError(gl, 'attaching renderbuffer');

    // Unbind the framebuffer, so by default all the rendering goes directly to the display
    this.bindFb(OPENGL_COMPOSITOR.DIRECT_RENDERING);

    this.m_initialized = true;

    this.m_antialiasing.Init();
  }

  /// @copydoc COMPOSITOR::Resize()
  Resize(aWidth: number, aHeight: number): void {
    if (this.m_initialized) this.clean();

    this.m_antialiasing.OnLostBuffers();

    this.m_width = aWidth;
    this.m_height = aHeight;
  }

  /// @copydoc COMPOSITOR::CreateBuffer()
  CreateBuffer(): number;
  CreateBuffer(aDimensions: VECTOR2I): number;
  CreateBuffer(aDimensions?: VECTOR2I): number {
    if (aDimensions === undefined) return this.m_antialiasing.CreateBuffer();

    console.assert(this.m_initialized);
    const gl = this.gl;

    // Get the maximum number of buffers
    const maxBuffers = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;

    if (this.usedBuffers() >= maxBuffers) {
      throw new Error(
        'Cannot create more framebuffers. OpenGL rendering backend requires at ' +
          'least 3 framebuffers. You may try to update/change your graphic drivers.',
      );
    }

    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    if (maxTextureSize < aDimensions.x || maxTextureSize < aDimensions.y) {
      throw new Error('Requested texture size is not supported. Could not create a buffer.');
    }

    // GL_COLOR_ATTACHMENTn are consecutive integers
    const attachmentPoint = gl.COLOR_ATTACHMENT0 + this.usedBuffers();

    // Generate the texture for the pixel storage
    gl.activeTexture(gl.TEXTURE0);
    const textureTarget = gl.createTexture()!;
    checkGlError(gl, 'generating framebuffer texture target');
    gl.bindTexture(gl.TEXTURE_2D, textureTarget);
    checkGlError(gl, 'binding framebuffer texture target');

    // Set texture parameters
    // glTexEnvf( GL_TEXTURE_ENV, GL_TEXTURE_ENV_MODE, GL_MODULATE ): the shim's fixed program
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      aDimensions.x,
      aDimensions.y,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    checkGlError(gl, 'creating framebuffer texture');
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    // Bind the texture to the specific attachment point, clear and rebind the screen
    this.bindFb(this.m_mainFbo!);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, textureTarget, 0);

    // Check the status, exit if the framebuffer can't be created
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      switch (status) {
        case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
          throw new Error('The framebuffer attachment points are incomplete.');

        case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
          throw new Error('No images attached to the framebuffer.');

        case gl.FRAMEBUFFER_UNSUPPORTED:
          throw new Error(
            'The combination of internal formats of the attached images violates ' +
              'an implementation-dependent set of restrictions.',
          );

        case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
          throw new Error('GL_RENDERBUFFER_SAMPLES is not the same for all attached renderbuffers');

        case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
          throw new Error('Framebuffer attachments have different dimensions');

        default:
          throw new Error('Unknown error occurred when creating the framebuffer.');
      }
    }

    this.ClearBuffer(COLOR4D_BLACK);

    // Return to direct rendering (we were asked only to create a buffer, not switch to one)
    this.bindFb(OPENGL_COMPOSITOR.DIRECT_RENDERING);

    // Store the new buffer
    const buffer: OPENGL_BUFFER = { dimensions: aDimensions, textureTarget, attachmentPoint };
    this.m_buffers.push(buffer);

    return this.usedBuffers();
  }

  GetBufferTexture(aBufferHandle: number): WebGLTexture | null {
    // wxCHECK( aBufferHandle > 0 && aBufferHandle <= usedBuffers(), 0 )
    if (!(aBufferHandle > 0 && aBufferHandle <= this.usedBuffers())) return null;

    return this.m_buffers[aBufferHandle - 1]!.textureTarget;
  }

  /// @copydoc COMPOSITOR::SetBuffer()
  SetBuffer(aBufferHandle: number): void {
    // wxCHECK( m_initialized && aBufferHandle <= usedBuffers(), /* void */ )
    if (!(this.m_initialized && aBufferHandle <= this.usedBuffers())) return;

    const gl = this.gl;

    // Either unbind the FBO for direct rendering, or bind the one with target textures
    this.bindFb(
      aBufferHandle === OPENGL_COMPOSITOR.DIRECT_RENDERING
        ? OPENGL_COMPOSITOR.DIRECT_RENDERING
        : this.m_mainFbo!,
    );

    // Switch the target texture
    if (this.m_curFbo !== OPENGL_COMPOSITOR.DIRECT_RENDERING) {
      this.m_curBuffer = aBufferHandle - 1;
      // glDrawBuffer( attachmentPoint ): the one attachment, at its index
      const drawBuffers: number[] = [];
      for (let i = 0; i < this.m_curBuffer; i++) drawBuffers.push(gl.NONE);
      drawBuffers.push(this.m_buffers[this.m_curBuffer]!.attachmentPoint);
      gl.drawBuffers(drawBuffers);
      checkGlError(gl, 'setting draw buffer');

      gl.viewport(
        0,
        0,
        this.m_buffers[this.m_curBuffer]!.dimensions.x,
        this.m_buffers[this.m_curBuffer]!.dimensions.y,
      );
    } else {
      gl.viewport(0, 0, this.GetScreenSize().x, this.GetScreenSize().y);
    }
  }

  /// @copydoc COMPOSITOR::GetBuffer()
  GetBuffer(): number {
    if (this.m_curFbo === OPENGL_COMPOSITOR.DIRECT_RENDERING)
      return OPENGL_COMPOSITOR.DIRECT_RENDERING;

    return this.m_curBuffer + 1;
  }

  /// @copydoc COMPOSITOR::ClearBuffer()
  ClearBuffer(aColor: Color4d): void {
    // wxCHECK( m_initialized, /* void */ )
    if (!this.m_initialized) return;

    const gl = this.gl;
    gl.clearColor(
      aColor.r,
      aColor.g,
      aColor.b,
      this.m_curFbo === OPENGL_COMPOSITOR.DIRECT_RENDERING ? 1.0 : 0.0,
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  GetScreenSize(): VECTOR2I {
    return { x: this.m_width, y: this.m_height };
  }

  /// @copydoc COMPOSITOR::Begin()
  Begin(): void {
    this.m_antialiasing.Begin();
  }

  /// @copydoc COMPOSITOR::DrawBuffer()
  DrawBuffer(aBufferHandle: number): void;
  DrawBuffer(aSourceHandle: number, aDestHandle: number): void;
  DrawBuffer(aSourceHandle: number, aDestHandle?: number): void {
    if (aDestHandle === undefined) {
      this.m_antialiasing.DrawBuffer(aSourceHandle);
      return;
    }

    // wxCHECK( m_initialized && aSourceHandle != 0 && aSourceHandle <= usedBuffers(), /* void */ )
    if (!(this.m_initialized && aSourceHandle !== 0 && aSourceHandle <= this.usedBuffers())) return;
    // wxCHECK( aDestHandle <= usedBuffers(), /* void */ )
    if (!(aDestHandle <= this.usedBuffers())) return;

    const gl = this.gl;

    // Switch to the destination buffer and blit the scene
    this.SetBuffer(aDestHandle);

    // Depth test has to be disabled to make transparency working
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Enable texturing and bind the main texture
    this.ff.glEnableTexture2D(true);
    gl.bindTexture(gl.TEXTURE_2D, this.m_buffers[aSourceHandle - 1]!.textureTarget);

    // Draw a full screen quad with the texture
    this.drawFullScreenQuad();
  }

  // @copydoc COMPOSITOR::Present()
  Present(): void {
    this.m_antialiasing.Present();
  }

  /// Binds a specific Framebuffer Object.
  protected bindFb(aFb: WebGLFramebuffer | number): void {
    // Currently there are only 2 valid FBOs
    console.assert(aFb === OPENGL_COMPOSITOR.DIRECT_RENDERING || aFb === this.m_mainFbo);

    if (this.m_curFbo !== aFb) {
      this.gl.bindFramebuffer(
        this.gl.FRAMEBUFFER,
        aFb === OPENGL_COMPOSITOR.DIRECT_RENDERING ? null : (aFb as WebGLFramebuffer),
      );
      checkGlError(this.gl, 'switching framebuffer');
      this.m_curFbo = aFb;
    }
  }

  /**
   * Perform freeing of resources.
   */
  protected clean(): void {
    // wxCHECK( m_initialized, /* void */ )
    if (!this.m_initialized) return;

    const gl = this.gl;

    this.bindFb(OPENGL_COMPOSITOR.DIRECT_RENDERING);

    for (const buffer of this.m_buffers) gl.deleteTexture(buffer.textureTarget);

    this.m_buffers = [];

    gl.deleteFramebuffer(this.m_mainFbo);
    gl.deleteRenderbuffer(this.m_depthBuffer);

    // Clean up difference shader
    if (this.m_differenceShaderInitialized && this.m_differenceShader !== null) {
      gl.deleteProgram(this.m_differenceShader);
      this.m_differenceShader = null;
      this.m_differenceShaderInitialized = false;
    }

    this.m_initialized = false;
  }

  /// Returns number of used buffers
  protected usedBuffers(): number {
    return this.m_buffers.length;
  }

  GetAntialiasSupersamplingFactor(): number {
    switch (this.m_currentAntialiasingMode) {
      case GAL_ANTIALIASING_MODE.AA_HIGHQUALITY:
        return 2;
      default:
        return 1;
    }
  }

  GetAntialiasRenderingOffset(): { x: number; y: number } {
    switch (this.m_currentAntialiasingMode) {
      case GAL_ANTIALIASING_MODE.AA_HIGHQUALITY:
        return { x: 0.5, y: -0.5 };
      default:
        return { x: 0, y: 0 };
    }
  }

  protected initDifferenceShader(): boolean {
    if (this.m_differenceShaderInitialized) return true;

    const gl = this.gl;

    const vertexShaderSrc = glsl_xor_diff_vert;
    const fragmentShaderSrc = glsl_xor_diff_frag;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;

    // Compile vertex shader
    gl.shaderSource(vertexShader, vertexShaderSrc);
    gl.compileShader(vertexShader);

    let compiled = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS) as boolean;

    if (!compiled) {
      console.error(`Vertex shader compile error:\n${gl.getShaderInfoLog(vertexShader)}`);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    // Compile fragment shader
    gl.shaderSource(fragmentShader, fragmentShaderSrc);
    gl.compileShader(fragmentShader);
    compiled = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS) as boolean;

    if (!compiled) {
      console.error(`Fragment shader compile error:\n${gl.getShaderInfoLog(fragmentShader)}`);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    // Create and link program
    this.m_differenceShader = gl.createProgram();
    gl.attachShader(this.m_differenceShader!, vertexShader);
    gl.attachShader(this.m_differenceShader!, fragmentShader);
    gl.linkProgram(this.m_differenceShader!);

    const linked = gl.getProgramParameter(this.m_differenceShader!, gl.LINK_STATUS) as boolean;

    // Clean up shader objects (they're now part of the program)
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!linked) {
      console.error(
        `Shader program link error:\n${gl.getProgramInfoLog(this.m_differenceShader!)}`,
      );
      gl.deleteProgram(this.m_differenceShader);
      this.m_differenceShader = null;
      return false;
    }

    // Get uniform locations
    this.m_diffSrcTexUniform = gl.getUniformLocation(this.m_differenceShader!, 'srcTex');
    this.m_diffDstTexUniform = gl.getUniformLocation(this.m_differenceShader!, 'dstTex');

    this.m_differenceShaderInitialized = true;
    return true;
  }

  protected drawFullScreenQuad(): void {
    const ff = this.ff;

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

  DrawBufferDifference(aSourceHandle: number, aDestHandle: number): void {
    // wxCHECK( m_initialized && aSourceHandle != 0 && aSourceHandle <= usedBuffers(), /* void */ )
    if (!(this.m_initialized && aSourceHandle !== 0 && aSourceHandle <= this.usedBuffers())) return;
    // wxCHECK( aDestHandle != 0 && aDestHandle <= usedBuffers(), /* void */ )
    if (!(aDestHandle !== 0 && aDestHandle <= this.usedBuffers())) return;

    const gl = this.gl;

    // Initialize shader on first use
    if (!this.initDifferenceShader()) {
      // Fallback to regular DrawBuffer if shader fails
      this.DrawBuffer(aSourceHandle, aDestHandle);
      return;
    }

    // Get the texture targets directly from the buffers
    const srcTexture = this.m_buffers[aSourceHandle - 1]!.textureTarget;

    // We only need to copy the destination since we're writing to it.
    // The source can be read directly via texture sampling
    const dims = this.m_buffers[aDestHandle - 1]!.dimensions;

    // Create temp texture for destination copy (we can't read and write same texture)
    const dstTempTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dstTempTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, dims.x, dims.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    checkGlError(gl, 'allocating dst temp texture');

    // Copy destination buffer to temp texture
    this.bindFb(this.m_mainFbo!);
    const destAttachment = this.m_buffers[aDestHandle - 1]!.attachmentPoint;
    gl.readBuffer(destAttachment);
    checkGlError(gl, 'setting read buffer for dst copy');
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, dims.x, dims.y);
    checkGlError(gl, 'copying dest to temp texture');

    // Set up for rendering with difference shader
    this.SetBuffer(aDestHandle);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // Use the difference shader
    gl.useProgram(this.m_differenceShader);
    checkGlError(gl, 'using difference shader program');

    // Bind source texture to unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    gl.uniform1i(this.m_diffSrcTexUniform, 0);
    checkGlError(gl, 'binding source texture for XOR mode');

    // Bind destination copy to unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dstTempTex);
    gl.uniform1i(this.m_diffDstTexUniform, 1);
    checkGlError(gl, 'binding dest texture for XOR mode');

    // Important: Set GL_TEXTURE0 as active before drawing so that glTexCoord2f
    // sets gl_MultiTexCoord0 (which the vertex shader reads), not gl_MultiTexCoord1
    gl.activeTexture(gl.TEXTURE0);

    // Draw the fullscreen quad
    this.drawFullScreenQuad();
    checkGlError(gl, 'drawing fullscreen quad for XOR mode');

    // Cleanup
    gl.useProgram(null);
    gl.deleteTexture(dstTempTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
}
