// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/opengl_gal.h` + `common/gal/opengl/opengl_gal.cpp`:
 * `KIGFX::OPENGL_GAL`, the GAL on the GPU, over WebGL2.
 *
 * Where the C++ is a `wxGLCanvas` (HIDPI_GL_CANVAS) with its own GL
 * context, this class draws on the canvas the application hands it
 * ({@link OPENGL_GAL_CANVAS}): the context, the scale factor, the pixel
 * size, and the window-side pieces - the native cursor, the paint event,
 * the bitmap font image (the C array `font_image.pixels`, served as a PNG).
 * The fixed-function calls go through GL_FIXED_FUNCTION; the GLU tesselator
 * is libtess.js (SGI's libtess, the same code); everything else is the
 * reference, member for member.
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { MATRIX3x3D } from '@ziroeda/kimath/src/math/matrix3x3.js';
import { EDA_ANGLE, FULL_CIRCLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import libtess from '@ziroeda/kimath/src/thirdparty/vendor/libtess.js';
import { ADVANCED_CFG } from '../../advanced_config.js';
import type { BITMAP_BASE } from '../../bitmap_base.js';
import type { Color4d } from '../../color4d.js';
import { type GLYPH_LIKE, OUTLINE_GLYPH, STROKE_GLYPH } from '../../font/glyph.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../../font/text_attributes.js';
import type { KIID } from '../../kiid.js';
import { niluuid } from '../../kiid.js';
import type { KICURSOR } from '../cursors.js';
import { RENDER_TARGET } from '../definitions.js';
import type { GAL_DISPLAY_OPTIONS } from '../gal_display_options.js';
import { CROSS_HAIR_MODE, GRID_STYLE } from '../gal_display_options.js';
import {
  GAL,
  GAL_CONTEXT_LOCKER,
  GAL_SCOPED_ATTRS,
  GAL_SCOPED_ATTRS_FLAGS,
} from '../graphics_abstraction_layer.js';
import { GL_BEGIN_MODE, GL_FIXED_FUNCTION, GL_MATRIX_MODE } from './gl_fixed_function.js';
import { font_image, font_information, LookupGlyph } from './gl_resources.js';
import { OPENGL_COMPOSITOR } from './opengl_compositor.js';
import { SHADER, SHADER_TYPE } from './shader.js';
import { glsl_kicad_frag } from './shaders/kicad_frag.js';
import { glsl_kicad_vert } from './shaders/kicad_vert.js';
import { checkGlError } from './utils.js';
import { SHADER_MODE } from './vertex_common.js';
import { VERTEX_ITEM } from './vertex_item.js';
import { VERTEX_MANAGER } from './vertex_manager.js';
import { wxASSERT } from '@ziroeda/core/src/wx_assert.js';

const { SHADER_NONE, SHADER_FILLED_CIRCLE, SHADER_STROKED_CIRCLE, SHADER_FONT, SHADER_HOLE_WALL } =
  SHADER_MODE;
const { SHADER_LINE_A, SHADER_LINE_B, SHADER_LINE_C, SHADER_LINE_D, SHADER_LINE_E, SHADER_LINE_F } =
  SHADER_MODE;
const { TARGET_CACHED, TARGET_NONCACHED, TARGET_OVERLAY, TARGET_TEMP } = RENDER_TARGET;

///< The default number of points for circle approximation
const SEG_PER_CIRCLE_COUNT = 64;

const COLOR4D = (r: number, g: number, b: number, a: number): Color4d => ({ r, g, b, a });
const COLOR4D_BLACK = COLOR4D(0, 0, 0, 1);
/** `COLOR4D( BLUE )`: the legacy colour table's BLUE. */
const COLOR4D_BLUE = COLOR4D(0.0, 0.0, 0.52, 1.0);

/**
 * What the C++ gets from being a HIDPI_GL_CANVAS: the application's canvas
 * element, its WebGL2 context, and the window services around it.
 */
export interface OPENGL_GAL_CANVAS {
  /** The context, with `depth`, `stencil` and `premultipliedAlpha: false`. */
  readonly gl: WebGL2RenderingContext;
  /** `HIDPI_GL_CANVAS::GetScaleFactor()`: device pixels per logical pixel. */
  GetScaleFactor(): number;
  /** `GetNativePixelSize()`: the backing store size. */
  GetNativePixelSize(): VECTOR2I;
  /** `aParent->GetClientSize()`, in logical pixels. */
  GetClientSize(): VECTOR2I;
  /** `IsShownOnScreen() && !GetClientRect().IsEmpty()`. */
  IsShownOnScreen(): boolean;
  /** `wxWindow::Refresh()`: ask for a repaint. */
  Refresh(): void;
  /** `wxWindow::SetCursor( CURSOR_STORE::GetCursor( aCursor, aHiDPI ) )`. */
  SetCursor(aCursor: KICURSOR, aHiDPI: boolean): void;
  /** `wxPostEvent( m_paintListener, aEvent )`. */
  PostPaint(): void;
  /** `font_image.pixels`, decoded: the bitmap font atlas (bitmap_font_img.png). */
  GetBitmapFontImage(): TexImageSource;
  /** `wxImage`s for DrawBitmap, decoded from the BITMAP_BASE's data. */
  GetBitmapImage?(aBitmap: BITMAP_BASE): TexImageSource | null;
}

interface CACHED_BITMAP {
  id: WebGLTexture;
  w: number;
  h: number;
  size: number;
  accessTime: number;
}

class GL_BITMAP_CACHE {
  private readonly m_cacheMaxElements = 50;
  private readonly m_cacheMaxSize = 256 * 1024 * 1024;

  private m_bitmaps: Map<KIID, CACHED_BITMAP> = new Map();
  private m_cacheLru: KIID[] = [];
  private m_cacheSize: number;
  private m_freedTextureIds: WebGLTexture[] = [];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly canvas: OPENGL_GAL_CANVAS,
  ) {
    this.m_cacheSize = 0;
  }

  destroy(): void {
    for (const [, bitmap] of this.m_bitmaps) this.gl.deleteTexture(bitmap.id);
  }

  RequestBitmap(aBitmap: BITMAP_BASE): WebGLTexture | null {
    const it = this.m_bitmaps.get(aBitmap.GetImageID());

    if (it !== undefined) {
      // A bitmap is found in cache bitmap. Ensure the associated texture is still valid.
      if (this.gl.isTexture(it.id)) {
        it.accessTime = Date.now();
        return it.id;
      }

      // Delete the invalid bitmap cache and its data
      this.gl.deleteTexture(it.id);
      this.m_freedTextureIds.push(it.id);

      const listIt = this.m_cacheLru.indexOf(aBitmap.GetImageID());

      if (listIt !== -1) this.m_cacheLru.splice(listIt, 1);

      this.m_cacheSize -= it.size;
      this.m_bitmaps.delete(aBitmap.GetImageID());

      // the cached bitmap is not valid and deleted, it will be recreated.
    }

    return this.cacheBitmap(aBitmap);
  }

  private cacheBitmap(aBitmap: BITMAP_BASE): WebGLTexture | null {
    const gl = this.gl;
    const imgPtr = aBitmap.GetOriginalImageData();

    if (!imgPtr) return null; // std::numeric_limits< GLuint >::max()

    const imgData = imgPtr;

    // Check if the image exceeds the maximum texture size supported by the GPU
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const imgWidth = imgData.GetWidth();
    const imgHeight = imgData.GetHeight();

    if (imgWidth > maxTextureSize || imgHeight > maxTextureSize) {
      // imgData.Scale( newWidth, newHeight, wxIMAGE_QUALITY_HIGH ): WX_IMAGE::Scale pending
      return null;
    }

    const bmp: CACHED_BITMAP = {
      id: null as unknown as WebGLTexture,
      w: imgWidth,
      h: imgHeight,
      size: 0,
      accessTime: 0,
    };

    let textureID: WebGLTexture;

    if (this.m_freedTextureIds.length === 0) {
      textureID = gl.createTexture()!;
    } else {
      textureID = this.m_freedTextureIds.shift()!;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const srcP = imgData.GetData();

    if (!srcP) return null;

    if (imgData.HasAlpha()) {
      bmp.size = bmp.w * bmp.h * 4;
      const buf = new Uint8Array(bmp.size);
      const srcAlpha = imgData.GetAlpha()!;
      const pxCount = bmp.w * bmp.h;

      for (let px = 0; px < pxCount; px++) {
        buf[px * 4] = srcP[px * 3]!;
        buf[px * 4 + 1] = srcP[px * 3 + 1]!;
        buf[px * 4 + 2] = srcP[px * 3 + 2]!;
        buf[px * 4 + 3] = srcAlpha[px]!;
      }

      gl.bindTexture(gl.TEXTURE_2D, textureID);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bmp.w, bmp.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    } else {
      // imgData.HasMask(): WX_IMAGE carries no colour-key mask, its decoders yield alpha
      bmp.size = bmp.w * bmp.h * 3;

      gl.bindTexture(gl.TEXTURE_2D, textureID);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, bmp.w, bmp.h, 0, gl.RGB, gl.UNSIGNED_BYTE, srcP);
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    const currentTime = Date.now();

    bmp.id = textureID;
    bmp.accessTime = currentTime;

    // A single oversized bitmap can exceed the whole cache budget, so evict until it fits or the
    // cache is drained
    while (
      (this.m_cacheLru.length + 1 > this.m_cacheMaxElements ||
        this.m_cacheSize + bmp.size > this.m_cacheMaxSize) &&
      this.m_cacheLru.length > 0
    ) {
      let toRemove: KIID = niluuid;
      let toRemoveLru = -1;

      // Remove entries accessed > 1s ago first
      for (const [kiid, cachedBmp] of this.m_bitmaps) {
        const cacheTimeoutMillis = 1000;

        if (currentTime - cachedBmp.accessTime > cacheTimeoutMillis) {
          toRemove = kiid;
          toRemoveLru = this.m_cacheLru.indexOf(toRemove);
          break;
        }
      }

      // Otherwise, remove the latest entry (it's less likely to be needed soon)
      if (toRemove === niluuid) {
        toRemoveLru = this.m_cacheLru.length - 1;
        toRemove = this.m_cacheLru[toRemoveLru]!;
      }

      const cachedBitmap = this.m_bitmaps.get(toRemove)!;

      this.m_cacheSize -= cachedBitmap.size;
      gl.deleteTexture(cachedBitmap.id);
      this.m_freedTextureIds.push(cachedBitmap.id);

      this.m_bitmaps.delete(toRemove);
      this.m_cacheLru.splice(toRemoveLru, 1);
    }

    this.m_cacheLru.push(aBitmap.GetImageID());
    this.m_cacheSize += bmp.size;
    this.m_bitmaps.set(aBitmap.GetImageID(), bmp);

    return textureID;
  }
}

///< Parameters passed to the GLU tesselator
interface TessParams {
  /// Manager used for storing new vertices
  vboManager: VERTEX_MANAGER;
  /// Intersect points, that have to be freed after tessellation
  intersectPoints: number[][];
}

// Callback functions for the tesselator.  Compare Redbook Chapter 11.
function VertexCallback(aVertexPtr: number[], aData: TessParams): void {
  const vertex = aVertexPtr;
  const vboManager = aData.vboManager;

  wxASSERT(vboManager !== undefined);
  vboManager.Vertex(vertex[0]!, vertex[1]!, vertex[2]!);
}

function CombineCallback(
  coords: number[],
  vertex_data: number[][],
  weight: number[],
  aData: TessParams,
): number[] {
  const vertex = [coords[0]!, coords[1]!, coords[2]!];

  // Save the pointer so we can delete it later
  aData.intersectPoints.push(vertex);

  return vertex;
}

function EdgeCallback(aEdgeFlag: boolean): void {
  // This callback is needed to force GLU tesselator to use triangles only
}

function ErrorCallback(aErrorCode: number): void {
  //throw std::runtime_error( std::string( "Tessellation error: " ) +
  //std::string( (const char*) gluErrorString( aErrorCode ) );
}

function InitTesselatorCallbacks(aTesselator: libtess.GluTesselator): void {
  aTesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, VertexCallback);
  aTesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE_DATA, CombineCallback);
  aTesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, EdgeCallback);
  aTesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, ErrorCallback);
}

function round_to_half_pixel(f: number, r: number): number {
  return (Math.ceil(f / r) - 0.5) * r;
}

/**
 * OpenGL implementation of the Graphics Abstraction Layer.
 *
 * This is a direct OpenGL-implementation and uses low-level graphics primitives like triangles
 * and quads. The purpose is to provide a fast graphics interface, that takes advantage of
 * modern graphics card GPUs. All methods here benefit thus from the hardware acceleration.
 */
export class OPENGL_GAL extends GAL {
  private static m_instanceCounter = 0; ///< GL GAL instance counter

  /** The context's WebGL2. */
  readonly gl: WebGL2RenderingContext;
  /** The fixed-function state the C++ leaves to the driver. */
  readonly ff: GL_FIXED_FUNCTION;
  private readonly m_canvas: OPENGL_GAL_CANVAS;

  private m_swapInterval: number; ///< Used to store swap interval information

  ///< Bitmap font texture handle (shared in the C++; one per context here)
  private g_fontTexture: WebGLTexture | null = null;

  // Vertex buffer objects related fields
  private m_groups: Map<number, VERTEX_ITEM> = new Map(); ///< Stores information about VBO objects (groups)
  private m_groupCounter: number; ///< Counter used for generating keys for groups
  private m_currentManager: VERTEX_MANAGER | null; ///< Currently used VERTEX_MANAGER (for storing
  ///< VERTEX_ITEMs).
  private m_cachedManager: VERTEX_MANAGER | null; ///< Container for storing cached VERTEX_ITEMs
  private m_nonCachedManager: VERTEX_MANAGER | null; ///< Container for storing non-cached VERTEX_ITEMs
  private m_overlayManager: VERTEX_MANAGER | null; ///< Container for storing overlaid VERTEX_ITEMs

  /// Container for storing temp (diff mode) VERTEX_ITEMs
  private m_tempManager: VERTEX_MANAGER | null;

  // Framebuffer & compositing
  private m_compositor: OPENGL_COMPOSITOR; ///< Handles multiple rendering targets
  private m_mainBuffer: number; ///< Main rendering target
  private m_overlayBuffer: number; ///< Auxiliary rendering target (for menus etc.)
  private m_tempBuffer: number; ///< Temporary rendering target (for diffing etc.)
  private m_currentTarget: RENDER_TARGET = TARGET_CACHED; ///< Current rendering target

  // Shader
  /// There is only one shader used for different objects.
  private m_shader: SHADER;

  // Internal flags
  private m_isFramebufferInitialized: boolean; ///< Are the framebuffers initialized?
  private m_isBitmapFontLoaded = false; ///< Is the bitmap font texture loaded?
  private m_isBitmapFontInitialized: boolean; ///< Is the shader set to use bitmap fonts?
  private m_isInitialized: boolean; ///< Basic initialization flag, has to be
  ///< done when the window is visible
  private m_isGrouping: boolean; ///< Was a group started?
  private m_isContextLocked: boolean; ///< Used for assertion checking
  private m_lockClientCookie: number;
  private ufm_worldPixelSize: number;
  private ufm_screenPixelSize: number;
  private ufm_pixelSizeMultiplier: number;
  private ufm_antialiasingOffset: number;
  private ufm_minLinePixelWidth: number;
  private ufm_fontTexture: number;
  private ufm_fontTextureWidth: number;
  /// `gl_ModelViewProjectionMatrix`, which the fixed pipeline supplied to the shader.
  private ufm_modelViewProjection: number;

  private m_bitmapCache: GL_BITMAP_CACHE;

  // Polygon tesselation
  private m_tesselator: libtess.GluTesselator;
  private m_tessIntersects: number[][] = [];

  constructor(aDisplayOptions: GAL_DISPLAY_OPTIONS, aCanvas: OPENGL_GAL_CANVAS) {
    super(aDisplayOptions);
    this.m_canvas = aCanvas;
    this.gl = aCanvas.gl;
    this.ff = new GL_FIXED_FUNCTION(this.gl);

    this.m_currentManager = null;
    this.m_cachedManager = null;
    this.m_nonCachedManager = null;
    this.m_overlayManager = null;
    this.m_tempManager = null;
    this.m_mainBuffer = 0;
    this.m_overlayBuffer = 0;
    this.m_tempBuffer = 0;
    this.m_isContextLocked = false;
    this.m_lockClientCookie = 0;

    // Pgm().GetGLContextManager()->CreateCtx( this ): the canvas owns its one context

    this.m_shader = new SHADER(this.gl);
    ++OPENGL_GAL.m_instanceCounter;

    this.m_bitmapCache = new GL_BITMAP_CACHE(this.gl, aCanvas);

    this.m_compositor = new OPENGL_COMPOSITOR(this.gl, this.ff);
    this.m_compositor.SetAntialiasingMode(this.m_options.antialiasing_mode);

    // Initialize the flags
    this.m_isFramebufferInitialized = false;
    this.m_isBitmapFontInitialized = false;
    this.m_isInitialized = false;
    this.m_isGrouping = false;
    this.m_groupCounter = 0;

    // The native cursor handler, the paint and mouse event routing: the canvas element's

    // SetSize( aParent->GetClientSize() )
    this.m_screenSize = this.m_canvas.GetNativePixelSize();

    // Grid color settings are different in Cairo and OpenGL
    this.SetGridColor(COLOR4D(0.8, 0.8, 0.8, 0.1));
    this.SetAxesColor(COLOR4D_BLUE);

    // Tesselator initialization
    this.m_tesselator = new libtess.GluTesselator();
    InitTesselatorCallbacks(this.m_tesselator);

    this.m_tesselator.gluTessProperty(
      libtess.gluEnum.GLU_TESS_WINDING_RULE,
      libtess.windingRule.GLU_TESS_WINDING_POSITIVE,
    );

    this.SetTarget(TARGET_NONCACHED);

    // Avoid uninitialized variables:
    this.ufm_worldPixelSize = -1;
    this.ufm_screenPixelSize = -1;
    this.ufm_pixelSizeMultiplier = -1;
    this.ufm_antialiasingOffset = -1;
    this.ufm_minLinePixelWidth = -1;
    this.ufm_fontTexture = -1;
    this.ufm_fontTextureWidth = -1;
    this.ufm_modelViewProjection = -1;

    this.m_swapInterval = 0;
  }

  /** `~OPENGL_GAL`. */
  destroy(): void {
    --OPENGL_GAL.m_instanceCounter;

    if (this.m_isInitialized) this.gl.flush();

    this.m_tesselator.gluDeleteTess();

    this.ClearCache();

    this.m_compositor.destroy();

    if (this.m_isInitialized) {
      this.m_cachedManager!.destroy();
      this.m_nonCachedManager!.destroy();
      this.m_overlayManager!.destroy();
      this.m_tempManager!.destroy();
    }

    this.m_shader.destroy();

    if (this.m_isBitmapFontLoaded) {
      this.gl.deleteTexture(this.g_fontTexture);
      this.m_isBitmapFontLoaded = false;
    }

    this.ff.destroy();
  }

  /**
   * Checks OpenGL features.
   *
   * @param aOptions
   * @return wxEmptyString if OpenGL 2.1 or greater is available, otherwise returns error message
   */
  static CheckFeatures(aOptions: GAL_DISPLAY_OPTIONS, aCanvas: OPENGL_GAL_CANVAS): string {
    if (OPENGL_GAL.s_checkedFeatures !== null) return OPENGL_GAL.s_checkedFeatures;

    let retVal = '';
    let opengl_gal: OPENGL_GAL | null = null;

    try {
      opengl_gal = new OPENGL_GAL(aOptions, aCanvas);

      GAL_CONTEXT_LOCKER(opengl_gal, () => {
        opengl_gal!.init();
      });
    } catch (err) {
      //Test failed
      retVal = String((err as Error).message ?? err);
    }

    opengl_gal?.destroy();

    OPENGL_GAL.s_checkedFeatures = retVal;
    return retVal;
  }

  private static s_checkedFeatures: string | null = null;

  override IsOpenGlEngine(): boolean {
    return true;
  }

  /// @copydoc GAL::IsInitialized()
  override IsInitialized(): boolean {
    // is*Initialized flags, but it is enough for OpenGL to show up
    return this.m_canvas.IsShownOnScreen();
  }

  ///< @copydoc GAL::IsVisible()
  override IsVisible(): boolean {
    return this.m_canvas.IsShownOnScreen();
  }

  override SetMinLineWidth(aLineWidth: number): void {
    super.SetMinLineWidth(aLineWidth);

    if (this.m_shader && this.ufm_minLinePixelWidth !== -1) {
      this.m_shader.Use();
      this.m_shader.SetParameter(this.ufm_minLinePixelWidth, aLineWidth);
      this.m_shader.Deactivate();
    }
  }

  PostPaint(): void {
    // posts an event to m_paint_listener to ask for redraw the canvas.
    this.m_canvas.PostPaint();
  }

  protected override updatedGalDisplayOptions(aOptions: GAL_DISPLAY_OPTIONS): boolean {
    return GAL_CONTEXT_LOCKER(this, () => {
      let refresh = false;

      if (this.m_options.antialiasing_mode !== this.m_compositor.GetAntialiasingMode()) {
        this.m_compositor.SetAntialiasingMode(this.m_options.antialiasing_mode);
        this.m_isFramebufferInitialized = false;
        refresh = true;
      }

      if (super.updatedGalDisplayOptions(aOptions) || refresh) {
        this.m_canvas.Refresh();
        refresh = true;
      }

      return refresh;
    });
  }

  private getWorldPixelSize(): number {
    const matrix = this.GetScreenWorldMatrix();
    return Math.min(Math.abs(matrix.GetScale().x), Math.abs(matrix.GetScale().y));
  }

  private getScreenPixelSize(): Vec2 {
    const sf = this.m_canvas.GetScaleFactor();
    return { x: 2.0 / (this.m_screenSize.x * sf), y: 2.0 / (this.m_screenSize.y * sf) };
  }

  /// @copydoc GAL::BeginDrawing()
  override BeginDrawing(): void {
    wxASSERT(
      this.m_isContextLocked,
      'GAL_DRAWING_CONTEXT RAII object should have locked context. ' +
        'Calling GAL::beginDrawing() directly is not allowed.',
    );

    wxASSERT(
      this.IsVisible(),
      'GAL::beginDrawing() must not be entered when GAL is not visible. ' +
        'Other drawing routines will expect everything to be initialized ' +
        'which will not be the case.',
    );

    if (!this.m_isInitialized) this.init();

    const gl = this.gl;
    const ff = this.ff;

    // Set up the view port
    ff.glMatrixMode(GL_MATRIX_MODE.GL_PROJECTION);
    ff.glLoadIdentity();

    // Create the screen transformation (Do the RH-LH conversion here)
    ff.glOrtho(
      0,
      this.m_screenSize.x,
      this.m_screenSize.y,
      0,
      -this.m_depthRange.x,
      -this.m_depthRange.y,
    );

    if (!this.m_isFramebufferInitialized) {
      // Prepare rendering target buffers
      this.m_compositor.Initialize();
      this.m_mainBuffer = this.m_compositor.CreateBuffer();

      try {
        this.m_tempBuffer = this.m_compositor.CreateBuffer();
      } catch {
        console.info('Could not create a framebuffer for diff mode blending.\n');
        this.m_tempBuffer = 0;
      }

      try {
        this.m_overlayBuffer = this.m_compositor.CreateBuffer();
      } catch {
        console.info('Could not create a framebuffer for overlays.\n');
        this.m_overlayBuffer = 0;
      }

      this.m_isFramebufferInitialized = true;
    }

    this.m_compositor.Begin();

    // Disable 2D Textures
    ff.glEnableTexture2D(false);

    // glShadeModel( GL_FLAT ): the shader's flat colour varying

    // Enable the depth buffer
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    // Setup blending, required for transparent objects
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);

    // Set up the world <-> screen transformation
    this.ComputeWorldScreenMatrix();
    ff.glLoadMatrixd(GL_FIXED_FUNCTION.matrixData(this.m_worldScreenMatrix));

    // Set defaults
    this.SetFillColor(this.m_fillColor);
    this.SetStrokeColor(this.m_strokeColor);

    // Remove all previously stored items
    this.m_nonCachedManager!.Clear();
    this.m_overlayManager!.Clear();
    this.m_tempManager!.Clear();

    this.m_cachedManager!.BeginDrawing();
    this.m_nonCachedManager!.BeginDrawing();
    this.m_overlayManager!.BeginDrawing();
    this.m_tempManager!.BeginDrawing();

    if (!this.m_isBitmapFontInitialized) {
      // Keep bitmap font texture always bound to the second texturing unit
      const FONT_TEXTURE_UNIT = 2;

      // Either load the font atlas to video memory, or simply bind it to a texture unit
      if (!this.m_isBitmapFontLoaded) {
        gl.activeTexture(gl.TEXTURE0 + FONT_TEXTURE_UNIT);
        this.g_fontTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.g_fontTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGB8,
          font_image.width,
          font_image.height,
          0,
          gl.RGB,
          gl.UNSIGNED_BYTE,
          this.m_canvas.GetBitmapFontImage(),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        checkGlError(gl, 'loading bitmap font');

        gl.activeTexture(gl.TEXTURE0);

        this.m_isBitmapFontLoaded = true;
      } else {
        gl.activeTexture(gl.TEXTURE0 + FONT_TEXTURE_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, this.g_fontTexture);
        gl.activeTexture(gl.TEXTURE0);
      }

      this.m_shader.Use();
      this.m_shader.SetParameterInt(this.ufm_fontTexture, FONT_TEXTURE_UNIT);
      this.m_shader.SetParameterInt(this.ufm_fontTextureWidth, font_image.width);
      this.m_shader.Deactivate();
      checkGlError(gl, 'setting bitmap font sampler as shader parameter');

      this.m_isBitmapFontInitialized = true;
    }

    this.m_shader.Use();
    this.m_shader.SetParameter(
      this.ufm_worldPixelSize,
      this.getWorldPixelSize() / this.m_canvas.GetScaleFactor(),
    );
    const screenPixelSize = this.getScreenPixelSize();
    this.m_shader.SetParameter(this.ufm_screenPixelSize, screenPixelSize);
    const pixelSizeMultiplier = this.m_compositor.GetAntialiasSupersamplingFactor();
    this.m_shader.SetParameter(this.ufm_pixelSizeMultiplier, pixelSizeMultiplier);
    const renderingOffset = this.m_compositor.GetAntialiasRenderingOffset();
    renderingOffset.x *= screenPixelSize.x;
    renderingOffset.y *= screenPixelSize.y;
    this.m_shader.SetParameter(this.ufm_antialiasingOffset, renderingOffset);
    this.m_shader.SetParameter(this.ufm_minLinePixelWidth, this.GetMinLineWidth());
    this.setModelViewProjection();
    this.m_shader.Deactivate();

    // Something between BeginDrawing and EndDrawing seems to depend on
    // this texture unit being active, but it does not assure it itself.
    gl.activeTexture(gl.TEXTURE0);

    // Unbind buffers - set compositor for direct drawing
    this.m_compositor.SetBuffer(OPENGL_COMPOSITOR.DIRECT_RENDERING);
  }

  /** `gl_ModelViewProjectionMatrix`: the fixed pipeline's product, as the shader's uniform. */
  private setModelViewProjection(): void {
    this.gl.uniformMatrix4fv(
      this.m_shader.Location(this.ufm_modelViewProjection),
      false,
      this.ff.modelViewProjection(),
    );
  }

  /// @copydoc GAL::EndDrawing()
  override EndDrawing(): void {
    wxASSERT(this.m_isContextLocked, 'What happened to the context lock?');

    // Cached & non-cached containers are rendered to the same buffer
    this.m_compositor.SetBuffer(this.m_mainBuffer);
    this.m_nonCachedManager!.EndDrawing();
    this.m_cachedManager!.EndDrawing();

    // Overlay container is rendered to a different buffer
    if (this.m_overlayBuffer) this.m_compositor.SetBuffer(this.m_overlayBuffer);

    this.m_overlayManager!.EndDrawing();

    // Be sure that the framebuffer is not colorized (happens on specific GPU&drivers combinations)
    this.ff.glColor4d(1.0, 1.0, 1.0, 1.0);

    // Draw the remaining contents, blit the rendering targets to the screen, swap the buffers
    this.m_compositor.DrawBuffer(this.m_mainBuffer);

    if (this.m_overlayBuffer) this.m_compositor.DrawBuffer(this.m_overlayBuffer);

    this.m_compositor.Present();
    this.blitCursor();

    // SwapBuffers(): the browser composites the canvas
  }

  /**
   * Read the main render buffer back as RGBA pixels, bottom row first as GL delivers them.
   */
  GetScreenshot(): { width: number; height: number; rgba: Uint8Array } | null {
    if (!this.IsInitialized() || !this.m_compositor) return null;

    return GAL_CONTEXT_LOCKER(this, () => {
      const gl = this.gl;
      this.m_compositor.SetBuffer(this.m_mainBuffer);

      const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
      const w = viewport[2]!;
      const h = viewport[3]!;

      let result: { width: number; height: number; rgba: Uint8Array } | null = null;

      if (w > 0 && h > 0) {
        const rgba = new Uint8Array(w * h * 4);
        gl.finish();
        gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + (this.m_mainBuffer - 1));
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        result = { width: w, height: h, rgba };
      }

      this.m_compositor.SetBuffer(OPENGL_COMPOSITOR.DIRECT_RENDERING);
      return result;
    });
  }

  override LockContext(aClientCookie: number): void {
    wxASSERT(!this.m_isContextLocked, 'Context already locked.');
    this.m_isContextLocked = true;
    this.m_lockClientCookie = aClientCookie;

    // GL_CONTEXT_MANAGER::LockCtx: the canvas's context is always current
  }

  override UnlockContext(aClientCookie: number): void {
    wxASSERT(
      this.m_isContextLocked,
      'Context not locked.  A GAL_CONTEXT_LOCKER RAII object must be stacked rather than making separate lock/unlock calls.',
    );
    wxASSERT(
      this.m_lockClientCookie === aClientCookie,
      'Context was locked by a different client. Should not be possible with RAII objects.',
    );

    this.m_isContextLocked = false;
  }

  override IsContextLocked(): boolean {
    return this.m_isContextLocked;
  }

  /// @copydoc GAL::BeginUpdate()
  override beginUpdate(): void {
    wxASSERT(
      this.m_isContextLocked,
      'GAL_UPDATE_CONTEXT RAII object should have locked context. Calling this from anywhere else is not allowed.',
    );

    wxASSERT(
      this.IsVisible(),
      'GAL::beginUpdate() must not be entered when GAL is not visible. Other update routines will expect everything to be initialized which will not be the case.',
    );

    if (!this.m_isInitialized) this.init();

    this.m_cachedManager!.Map();
  }

  /// @copydoc GAL::EndUpdate()
  override endUpdate(): void {
    if (!this.m_isInitialized) return;

    this.m_cachedManager!.Unmap();
  }

  // ---------------
  // Drawing methods
  // ---------------

  /// @copydoc GAL::DrawLine()
  override DrawLine(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.m_currentManager!.Color(
      this.m_strokeColor.r,
      this.m_strokeColor.g,
      this.m_strokeColor.b,
      this.m_strokeColor.a,
    );

    this.drawLineQuad(aStartPoint, aEndPoint);
  }

  /// @copydoc GAL::DrawSegment()
  override DrawSegment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number): void {
    this.drawSegment(aStartPoint, aEndPoint, aWidth);
  }

  private drawSegment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number, aReserve = true): void {
    const startEndVector = { x: aEndPoint.x - aStartPoint.x, y: aEndPoint.y - aStartPoint.y };
    const lineLength = Math.hypot(startEndVector.x, startEndVector.y);

    // Be careful about floating point rounding.  As we draw segments in larger and larger
    // coordinates, the shader (which uses floats) will lose precision and stop drawing small
    // segments.  In this case, we need to draw a circle for the minimal segment.

    // Check if the coordinate differences can be accurately represented as floats
    const startX = Math.fround(aStartPoint.x);
    const startY = Math.fround(aStartPoint.y);
    const endX = Math.fround(aEndPoint.x);
    const endY = Math.fround(aEndPoint.y);

    if (startX === endX && startY === endY) {
      this.drawCircle(aStartPoint, aWidth / 2, aReserve);
      return;
    }

    if (this.m_isFillEnabled || aWidth === 1.0) {
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );

      this.SetLineWidth(aWidth);
      this.drawLineQuad(aStartPoint, aEndPoint, aReserve);
    } else {
      const lineAngle = EDA_ANGLE.fromVector(startEndVector);

      // Outlined tracks
      this.SetLineWidth(1.0);
      this.m_currentManager!.Color(
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );

      this.Save();

      if (aReserve) this.m_currentManager!.Reserve(6 + 6 + 3 + 3); // Two line quads and two semicircles

      this.m_currentManager!.Translate(aStartPoint.x, aStartPoint.y, 0.0);
      this.m_currentManager!.Rotate(lineAngle.AsRadians(), 0.0, 0.0, 1.0);

      this.drawLineQuad({ x: 0.0, y: aWidth / 2.0 }, { x: lineLength, y: aWidth / 2.0 }, false);

      this.drawLineQuad({ x: 0.0, y: -aWidth / 2.0 }, { x: lineLength, y: -aWidth / 2.0 }, false);

      // Draw line caps
      this.drawStrokedSemiCircle({ x: 0.0, y: 0.0 }, aWidth / 2, Math.PI / 2, false);
      this.drawStrokedSemiCircle({ x: lineLength, y: 0.0 }, aWidth / 2, -Math.PI / 2, false);

      this.Restore();
    }
  }

  /// @copydoc GAL::DrawCircle()
  override DrawCircle(aCenterPoint: Vec2, aRadius: number): void {
    this.drawCircle(aCenterPoint, aRadius);
  }

  /// @copydoc GAL::DrawHoleWall()
  override DrawHoleWall(aCenterPoint: Vec2, aHoleRadius: number, aWallWidth: number): void {
    if (this.m_isFillEnabled) {
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );

      this.m_currentManager!.Shader(SHADER_HOLE_WALL, 1.0, aHoleRadius, aWallWidth);
      this.m_currentManager!.Vertex(aCenterPoint.x, aCenterPoint.y, this.m_layerDepth);

      this.m_currentManager!.Shader(SHADER_HOLE_WALL, 2.0, aHoleRadius, aWallWidth);
      this.m_currentManager!.Vertex(aCenterPoint.x, aCenterPoint.y, this.m_layerDepth);

      this.m_currentManager!.Shader(SHADER_HOLE_WALL, 3.0, aHoleRadius, aWallWidth);
      this.m_currentManager!.Vertex(aCenterPoint.x, aCenterPoint.y, this.m_layerDepth);
    }
  }

  private drawCircle(aCenterPoint: Vec2, aRadius: number, aReserve = true): void {
    if (this.m_isFillEnabled) {
      if (aReserve) this.m_currentManager!.Reserve(3);

      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );

      /* Draw a triangle that contains the circle, then shade it leaving only the circle.
       *  Parameters given to Shader() are indices of the triangle's vertices
       *  (if you want to understand more, check the vertex shader source [shader.vert]).
       *  Shader uses this coordinates to determine if fragments are inside the circle or not.
       *  Does the calculations in the vertex shader now (pixel alignment)
       *       v2
       *       /\
       *      //\\
       *  v0 /_\/_\ v1
       */
      this.m_currentManager!.Shader(SHADER_FILLED_CIRCLE, 1.0, aRadius);
      this.m_currentManager!.Vertex(aCenterPoint.x, aCenterPoint.y, this.m_layerDepth);

      this.m_currentManager!.Shader(SHADER_FILLED_CIRCLE, 2.0, aRadius);
      this.m_currentManager!.Vertex(aCenterPoint.x, aCenterPoint.y, this.m_layerDepth);

      this.m_currentManager!.Shader(SHADER_FILLED_CIRCLE, 3.0, aRadius);
      this.m_currentManager!.Vertex(aCenterPoint.x, aCenterPoint.y, this.m_layerDepth);
    }

    if (this.m_isStrokeEnabled) {
      if (aReserve) this.m_currentManager!.Reserve(3);

      this.m_currentManager!.Color(
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );

      /* Draw a triangle that contains the circle, then shade it leaving only the circle.
       *  Parameters given to Shader() are indices of the triangle's vertices
       *  (if you want to understand more, check the vertex shader source [shader.vert]).
       *  and the line width. Shader uses this coordinates to determine if fragments are
       *  inside the circle or not.
       *       v2
       *       /\
       *      //\\
       *  v0 /_\/_\ v1
       */
      this.m_currentManager!.Shader(SHADER_STROKED_CIRCLE, 1.0, aRadius, this.m_lineWidth);
      this.m_currentManager!.Vertex(
        aCenterPoint.x, // v0
        aCenterPoint.y,
        this.m_layerDepth,
      );

      this.m_currentManager!.Shader(SHADER_STROKED_CIRCLE, 2.0, aRadius, this.m_lineWidth);
      this.m_currentManager!.Vertex(
        aCenterPoint.x, // v1
        aCenterPoint.y,
        this.m_layerDepth,
      );

      this.m_currentManager!.Shader(SHADER_STROKED_CIRCLE, 3.0, aRadius, this.m_lineWidth);
      this.m_currentManager!.Vertex(
        aCenterPoint.x,
        aCenterPoint.y, // v2
        this.m_layerDepth,
      );
    }
  }

  /// @copydoc GAL::DrawArc()
  override DrawArc(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
  ): void {
    if (aRadius <= 0) return;

    let startAngle = aStartAngle.AsRadians();
    let endAngle = startAngle + aAngle.AsRadians();

    // Normalize arc angles
    if (startAngle > endAngle) [startAngle, endAngle] = [endAngle, startAngle];

    const alphaIncrement = this.calcAngleStep(aRadius);

    this.Save();
    this.m_currentManager!.Translate(aCenterPoint.x, aCenterPoint.y, 0.0);

    if (this.m_isFillEnabled) {
      let alpha: number;
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );
      this.m_currentManager!.Shader(SHADER_NONE);

      // Triangle fan
      for (alpha = startAngle; alpha + alphaIncrement < endAngle; ) {
        this.m_currentManager!.Reserve(3);
        this.m_currentManager!.Vertex(0.0, 0.0, this.m_layerDepth);
        this.m_currentManager!.Vertex(
          cos(alpha) * aRadius,
          sin(alpha) * aRadius,
          this.m_layerDepth,
        );
        alpha += alphaIncrement;
        this.m_currentManager!.Vertex(
          cos(alpha) * aRadius,
          sin(alpha) * aRadius,
          this.m_layerDepth,
        );
      }

      // The last missing triangle
      const endPoint = { x: cos(endAngle) * aRadius, y: sin(endAngle) * aRadius };

      this.m_currentManager!.Reserve(3);
      this.m_currentManager!.Vertex(0.0, 0.0, this.m_layerDepth);
      this.m_currentManager!.Vertex(cos(alpha) * aRadius, sin(alpha) * aRadius, this.m_layerDepth);
      this.m_currentManager!.Vertex(endPoint.x, endPoint.y, this.m_layerDepth);
    }

    if (this.m_isStrokeEnabled) {
      this.m_currentManager!.Color(
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );

      let p = { x: cos(startAngle) * aRadius, y: sin(startAngle) * aRadius };
      let alpha: number;
      let lineCount = 0;

      for (alpha = startAngle + alphaIncrement; alpha <= endAngle; alpha += alphaIncrement)
        lineCount++;

      if (alpha !== endAngle) lineCount++;

      this.reserveLineQuads(lineCount);

      for (alpha = startAngle + alphaIncrement; alpha <= endAngle; alpha += alphaIncrement) {
        const p_next = { x: cos(alpha) * aRadius, y: sin(alpha) * aRadius };
        this.drawLineQuad(p, p_next, false);

        p = p_next;
      }

      // Draw the last missing part
      if (alpha !== endAngle) {
        const p_last = { x: cos(endAngle) * aRadius, y: sin(endAngle) * aRadius };
        this.drawLineQuad(p, p_last, false);
      }
    }

    this.Restore();
  }

  /// @copydoc GAL::DrawArcSegment()
  override DrawArcSegment(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aWidth: number,
    aMaxError: number,
  ): void {
    if (aRadius <= 0) {
      // Arcs of zero radius are a circle of aWidth diameter
      if (aWidth > 0) this.DrawCircle(aCenterPoint, aWidth / 2.0);

      return;
    }

    let startAngle = aStartAngle.AsRadians();
    let endAngle = startAngle + aAngle.AsRadians();

    // Swap the angles, if start angle is greater than end angle
    if (startAngle > endAngle) [startAngle, endAngle] = [endAngle, startAngle];

    // Calculate the seg count to approximate the arc with aMaxError or less
    let segCount360 = GetArcToSegmentCount(aRadius, aMaxError, FULL_CIRCLE);
    segCount360 = Math.max(SEG_PER_CIRCLE_COUNT, segCount360);
    let alphaIncrement = (2.0 * Math.PI) / segCount360;

    // Refinement: Use a segment count multiple of 2, because we have a control point
    // on the middle of the arc, and the look is better if it is on a segment junction
    // because there is no approx error
    let seg_count = KiROUND((endAngle - startAngle) / alphaIncrement);

    if (seg_count % 2 !== 0) seg_count += 1;

    // Our shaders have trouble rendering null line quads, so delegate this task to DrawSegment.
    if (seg_count === 0) {
      const p_start = {
        x: aCenterPoint.x + cos(startAngle) * aRadius,
        y: aCenterPoint.y + sin(startAngle) * aRadius,
      };

      const p_end = {
        x: aCenterPoint.x + cos(endAngle) * aRadius,
        y: aCenterPoint.y + sin(endAngle) * aRadius,
      };

      this.DrawSegment(p_start, p_end, aWidth);
      return;
    }

    // Recalculate alphaIncrement with a even integer number of segment
    alphaIncrement = (endAngle - startAngle) / seg_count;

    this.Save();
    this.m_currentManager!.Translate(aCenterPoint.x, aCenterPoint.y, 0.0);

    if (this.m_isStrokeEnabled) {
      this.m_currentManager!.Color(
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );

      const width = aWidth / 2.0;
      const startPoint = { x: cos(startAngle) * aRadius, y: sin(startAngle) * aRadius };
      const endPoint = { x: cos(endAngle) * aRadius, y: sin(endAngle) * aRadius };

      this.drawStrokedSemiCircle(startPoint, width, startAngle + Math.PI);
      this.drawStrokedSemiCircle(endPoint, width, endAngle);

      let pOuter = {
        x: cos(startAngle) * (aRadius + width),
        y: sin(startAngle) * (aRadius + width),
      };

      let pInner = {
        x: cos(startAngle) * (aRadius - width),
        y: sin(startAngle) * (aRadius - width),
      };

      let alpha: number;

      for (alpha = startAngle + alphaIncrement; alpha <= endAngle; alpha += alphaIncrement) {
        const pNextOuter = { x: cos(alpha) * (aRadius + width), y: sin(alpha) * (aRadius + width) };
        const pNextInner = { x: cos(alpha) * (aRadius - width), y: sin(alpha) * (aRadius - width) };

        this.DrawLine(pOuter, pNextOuter);
        this.DrawLine(pInner, pNextInner);

        pOuter = pNextOuter;
        pInner = pNextInner;
      }

      // Draw the last missing part
      if (alpha !== endAngle) {
        const pLastOuter = {
          x: cos(endAngle) * (aRadius + width),
          y: sin(endAngle) * (aRadius + width),
        };
        const pLastInner = {
          x: cos(endAngle) * (aRadius - width),
          y: sin(endAngle) * (aRadius - width),
        };

        this.DrawLine(pOuter, pLastOuter);
        this.DrawLine(pInner, pLastInner);
      }
    }

    if (this.m_isFillEnabled) {
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );
      this.SetLineWidth(aWidth);

      let p = { x: cos(startAngle) * aRadius, y: sin(startAngle) * aRadius };
      let alpha: number;

      let lineCount = 0;

      for (alpha = startAngle + alphaIncrement; alpha <= endAngle; alpha += alphaIncrement) {
        lineCount++;
      }

      // The last missing part
      if (alpha !== endAngle) {
        lineCount++;
      }

      this.reserveLineQuads(lineCount);

      for (alpha = startAngle + alphaIncrement; alpha <= endAngle; alpha += alphaIncrement) {
        const p_next = { x: cos(alpha) * aRadius, y: sin(alpha) * aRadius };
        this.drawLineQuad(p, p_next, false);

        p = p_next;
      }

      // Draw the last missing part
      if (alpha !== endAngle) {
        const p_last = { x: cos(endAngle) * aRadius, y: sin(endAngle) * aRadius };
        this.drawLineQuad(p, p_last, false);
      }
    }

    this.Restore();
  }

  /// @copydoc GAL::DrawRectangle()
  override DrawRectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {
    // Compute the diagonal points of the rectangle
    const diagonalPointA = { x: aEndPoint.x, y: aStartPoint.y };
    const diagonalPointB = { x: aStartPoint.x, y: aEndPoint.y };

    // Fill the rectangle
    if (this.m_isFillEnabled) {
      this.m_currentManager!.Reserve(6);
      this.m_currentManager!.Shader(SHADER_NONE);
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );

      this.m_currentManager!.Vertex(aStartPoint.x, aStartPoint.y, this.m_layerDepth);
      this.m_currentManager!.Vertex(diagonalPointA.x, diagonalPointA.y, this.m_layerDepth);
      this.m_currentManager!.Vertex(aEndPoint.x, aEndPoint.y, this.m_layerDepth);

      this.m_currentManager!.Vertex(aStartPoint.x, aStartPoint.y, this.m_layerDepth);
      this.m_currentManager!.Vertex(aEndPoint.x, aEndPoint.y, this.m_layerDepth);
      this.m_currentManager!.Vertex(diagonalPointB.x, diagonalPointB.y, this.m_layerDepth);
    }

    // Stroke the outline
    if (this.m_isStrokeEnabled) {
      this.m_currentManager!.Color(
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );

      // DrawLine (and DrawPolyline )
      // has problem with 0 length lines so enforce minimum
      if (aStartPoint.x === aEndPoint.x && aStartPoint.y === aEndPoint.y) {
        this.DrawLine({ x: aStartPoint.x + 1.0, y: aStartPoint.y }, aEndPoint);
      } else {
        const pointList: Vec2[] = [];
        pointList.push(aStartPoint);
        pointList.push(diagonalPointA);
        pointList.push(aEndPoint);
        pointList.push(diagonalPointB);
        pointList.push(aStartPoint);
        this.DrawPolyline(pointList);
      }
    }
  }

  /// @copydoc GAL::DrawSegmentChain()
  override DrawSegmentChain(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN, aWidth: number): void {
    if (Array.isArray(aPointList)) {
      const list = aPointList as readonly Vec2[];
      this.drawSegmentChain((idx) => list[idx]!, list.length, aWidth);
      return;
    }

    const aLineChain = aPointList as SHAPE_LINE_CHAIN;
    let numPoints = aLineChain.PointCount();

    if (aLineChain.IsClosed()) numPoints += 1;

    this.drawSegmentChain((idx) => aLineChain.CPoint(idx), numPoints, aWidth);
  }

  /// @copydoc GAL::DrawPolyline()
  override DrawPolyline(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void {
    if (Array.isArray(aPointList)) {
      const list = aPointList as readonly Vec2[];
      this.drawPolyline((idx) => list[idx]!, list.length);
      return;
    }

    const aLineChain = aPointList as SHAPE_LINE_CHAIN;
    let numPoints = aLineChain.PointCount();

    if (aLineChain.IsClosed()) numPoints += 1;

    this.drawPolyline((idx) => aLineChain.CPoint(idx), numPoints);
  }

  /// @copydoc GAL::DrawPolylines()
  override DrawPolylines(aPointList: readonly (readonly Vec2[])[]): void {
    let lineQuadCount = 0;

    for (const points of aPointList) lineQuadCount += points.length - 1;

    this.reserveLineQuads(lineQuadCount);

    for (const points of aPointList) {
      this.drawPolyline((idx) => points[idx]!, points.length, false);
    }
  }

  /// @copydoc GAL::DrawPolygon()
  override DrawPolygon(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void;
  override DrawPolygon(aPolySet: SHAPE_POLY_SET, aStrokeTriangulation?: boolean): void;
  override DrawPolygon(
    a: readonly Vec2[] | SHAPE_LINE_CHAIN | SHAPE_POLY_SET,
    aStrokeTriangulation = false,
  ): void {
    if (Array.isArray(a)) {
      const aPointList = a as readonly Vec2[];
      // wxCHECK( aPointList.size() >= 2, /* void */ )
      if (!(aPointList.length >= 2)) return;

      const points: number[] = [];

      for (const p of aPointList) {
        points.push(p.x);
        points.push(p.y);
        points.push(this.m_layerDepth);
      }

      this.drawPolygon(points, aPointList.length);
      return;
    }

    if (a instanceof SHAPE_POLY_SET) {
      const aPolySet = a;

      if (aPolySet.IsTriangulationUpToDate()) {
        this.drawTriangulatedPolyset(aPolySet, aStrokeTriangulation);
        return;
      }

      for (let j = 0; j < aPolySet.OutlineCount(); ++j) {
        const outline = aPolySet.COutline(j);
        this.DrawPolygon(outline);
      }

      return;
    }

    const aPolygon = a as SHAPE_LINE_CHAIN;

    if (aPolygon.PointCount() < 2) return;

    const pointCount = aPolygon.SegmentCount() + 1;
    const points: number[] = [];

    for (let i = 0; i < pointCount; ++i) {
      const p = aPolygon.CPoint(i);
      points.push(p.x);
      points.push(p.y);
      points.push(this.m_layerDepth);
    }

    this.drawPolygon(points, pointCount);
  }

  private drawTriangulatedPolyset(aPolySet: SHAPE_POLY_SET, aStrokeTriangulation: boolean): void {
    this.m_currentManager!.Shader(SHADER_NONE);
    this.m_currentManager!.Color(
      this.m_fillColor.r,
      this.m_fillColor.g,
      this.m_fillColor.b,
      this.m_fillColor.a,
    );

    if (this.m_isFillEnabled) {
      let totalTriangleCount = 0;

      for (let j = 0; j < aPolySet.TriangulatedPolyCount(); ++j) {
        const triPoly = aPolySet.TriangulatedPolygon(j);

        totalTriangleCount += triPoly.GetTriangleCount();
      }

      this.m_currentManager!.Reserve(3 * totalTriangleCount);

      const a: VECTOR2I = { x: 0, y: 0 };
      const b: VECTOR2I = { x: 0, y: 0 };
      const c: VECTOR2I = { x: 0, y: 0 };

      for (let j = 0; j < aPolySet.TriangulatedPolyCount(); ++j) {
        const triPoly = aPolySet.TriangulatedPolygon(j);

        for (let i = 0; i < triPoly.GetTriangleCount(); i++) {
          triPoly.GetTriangle(i, a, b, c);
          this.m_currentManager!.Vertex(a.x, a.y, this.m_layerDepth);
          this.m_currentManager!.Vertex(b.x, b.y, this.m_layerDepth);
          this.m_currentManager!.Vertex(c.x, c.y, this.m_layerDepth);
        }
      }
    }

    if (this.m_isStrokeEnabled) {
      for (let j = 0; j < aPolySet.OutlineCount(); ++j) {
        const poly = aPolySet.Polygon(j);

        for (const lc of poly) {
          this.DrawPolyline(lc);
        }
      }
    }

    if (ADVANCED_CFG.GetCfg().m_DrawTriangulationOutlines) {
      aStrokeTriangulation = true;
      this.SetStrokeColor(COLOR4D(0.0, 1.0, 0.2, 1.0));
    }

    if (aStrokeTriangulation) {
      GAL_SCOPED_ATTRS(
        this,
        GAL_SCOPED_ATTRS_FLAGS.STROKE_COLOR | GAL_SCOPED_ATTRS_FLAGS.LAYER_DEPTH,
        () => {
          this.SetLayerDepth(this.m_layerDepth - 1);

          const a: VECTOR2I = { x: 0, y: 0 };
          const b: VECTOR2I = { x: 0, y: 0 };
          const c: VECTOR2I = { x: 0, y: 0 };

          for (let j = 0; j < aPolySet.TriangulatedPolyCount(); ++j) {
            const triPoly = aPolySet.TriangulatedPolygon(j);

            for (let i = 0; i < triPoly.GetTriangleCount(); i++) {
              triPoly.GetTriangle(i, a, b, c);
              this.DrawLine(a, b);
              this.DrawLine(b, c);
              this.DrawLine(c, a);
            }
          }
        },
      );
    }
  }

  /// @copydoc GAL::DrawCurve()
  override DrawCurve(
    aStartPoint: Vec2,
    aControlPointA: Vec2,
    aControlPointB: Vec2,
    aEndPoint: Vec2,
    aFilterValue = 0.0,
  ): void {
    const pointCtrl: Vec2[] = [];

    pointCtrl.push(aStartPoint);
    pointCtrl.push(aControlPointA);
    pointCtrl.push(aControlPointB);
    pointCtrl.push(aEndPoint);

    const converter = new BezierPoly(pointCtrl);
    const output = converter.getPolyD(aFilterValue);

    if (output.length === 1) output.push(output[0]!);

    this.DrawPolygon(output);
  }

  /// @copydoc GAL::DrawBitmap()
  override DrawBitmap(aBitmap: BITMAP_BASE, alphaBlend = 1.0): void {
    const gl = this.gl;
    const ff = this.ff;
    const alpha = Math.min(Math.max(alphaBlend, 0.0), 1.0);

    // We have to calculate the pixel size in users units to draw the image.
    // m_worldUnitLength is a factor used for converting IU to inches
    const scale = 1.0 / (aBitmap.GetPPI() * this.m_worldUnitLength);
    const w = aBitmap.GetSizePixels().x * scale;
    const h = aBitmap.GetSizePixels().y * scale;

    const xform = this.m_currentManager!.GetTransformation();

    // xform * vec4( -w/2, -h/2, 0, 0 ) and xform * vec4( w/2, h/2, 0, 0 ): directions, no translation
    const v0 = {
      x: xform[0]! * (-w / 2) + xform[4]! * (-h / 2),
      y: xform[1]! * (-w / 2) + xform[5]! * (-h / 2),
    };
    const v1 = {
      x: xform[0]! * (w / 2) + xform[4]! * (h / 2),
      y: xform[1]! * (w / 2) + xform[5]! * (h / 2),
    };
    const trans = { x: xform[12]!, y: xform[13]!, z: xform[14]! };

    const texture_id = this.m_bitmapCache.RequestBitmap(aBitmap);

    if (!texture_id || !gl.isTexture(texture_id))
      // ensure the bitmap texture is still valid
      return;

    const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;

    if (alpha < 1.0) gl.depthMask(false);

    gl.depthFunc(gl.ALWAYS);

    ff.glAlphaFunc(0.01);
    ff.glEnableAlphaTest(true);

    ff.glMatrixMode(GL_MATRIX_MODE.GL_TEXTURE);
    ff.glPushMatrix();
    ff.glTranslated(0.5, 0.5, 0.5);
    ff.glRotated(aBitmap.Rotation().AsDegrees(), 0, 0, 1);
    ff.glTranslated(-0.5, -0.5, -0.5);

    ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);
    ff.glPushMatrix();
    ff.glTranslated(trans.x, trans.y, trans.z);

    ff.glEnableTexture2D(true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture_id);

    const texStartX = aBitmap.IsMirroredX() ? 1.0 : 0.0;
    const texEndX = aBitmap.IsMirroredX() ? 0.0 : 1.0;
    const texStartY = aBitmap.IsMirroredY() ? 1.0 : 0.0;
    const texEndY = aBitmap.IsMirroredY() ? 0.0 : 1.0;

    ff.glBegin(GL_BEGIN_MODE.GL_QUADS);
    ff.glColor4d(1.0, 1.0, 1.0, alpha);
    ff.glTexCoord2f(texStartX, texStartY);
    ff.glVertex3f(v0.x, v0.y, this.m_layerDepth);
    ff.glColor4d(1.0, 1.0, 1.0, alpha);
    ff.glTexCoord2f(texEndX, texStartY);
    ff.glVertex3f(v1.x, v0.y, this.m_layerDepth);
    ff.glColor4d(1.0, 1.0, 1.0, alpha);
    ff.glTexCoord2f(texEndX, texEndY);
    ff.glVertex3f(v1.x, v1.y, this.m_layerDepth);
    ff.glColor4d(1.0, 1.0, 1.0, alpha);
    ff.glTexCoord2f(texStartX, texEndY);
    ff.glVertex3f(v0.x, v1.y, this.m_layerDepth);
    ff.glEnd();

    gl.bindTexture(gl.TEXTURE_2D, null);

    ff.glPopMatrix();

    ff.glMatrixMode(GL_MATRIX_MODE.GL_TEXTURE);
    ff.glPopMatrix();
    ff.glMatrixMode(GL_MATRIX_MODE.GL_MODELVIEW);

    ff.glEnableAlphaTest(false);
    gl.depthMask(depthMask);
    gl.depthFunc(gl.LESS);
  }

  /// @copydoc GAL::BitmapText()
  override BitmapText(aText: string, aPosition: VECTOR2I, aAngle: EDA_ANGLE): void {
    // Fallback to generic impl (which uses the stroke font) on cases we don't handle
    if (
      this.IsTextMirrored() ||
      aText.includes('^{') ||
      aText.includes('_{') ||
      aText.includes('\n')
    ) {
      super.BitmapText(aText, aPosition, aAngle);
      return;
    }

    const text = aText;
    const [textSize, commonOffset] = this.computeBitmapTextSize(text);

    const SCALE = (1.4 * this.GetGlyphSize().y) / textSize.y;
    let overbarHeight = textSize.y;

    this.Save();

    this.m_currentManager!.Color(
      this.m_strokeColor.r,
      this.m_strokeColor.g,
      this.m_strokeColor.b,
      this.m_strokeColor.a,
    );
    this.m_currentManager!.Translate(aPosition.x, aPosition.y, this.m_layerDepth);
    this.m_currentManager!.Rotate(aAngle.AsRadians(), 0.0, 0.0, -1.0);

    const sx = SCALE * (this.m_globalFlipX ? -1.0 : 1.0);
    const sy = SCALE * (this.m_globalFlipY ? -1.0 : 1.0);

    this.m_currentManager!.Scale(sx, sy, 0);
    this.m_currentManager!.Translate(0, -commonOffset, 0);

    switch (this.GetHorizontalJustify()) {
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
        this.Translate({ x: -textSize.x / 2.0, y: 0 });
        break;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
        //if( !IsTextMirrored() )
        this.Translate({ x: -textSize.x, y: 0 });
        break;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
        //if( IsTextMirrored() )
        //Translate( VECTOR2D( -textSize.x, 0 ) );
        break;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE:
        console.error('Indeterminate state legal only in dialogs.');
        break;
    }

    switch (this.GetVerticalJustify()) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        break;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
        this.Translate({ x: 0, y: -textSize.y / 2.0 });
        overbarHeight = 0;
        break;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        this.Translate({ x: 0, y: -textSize.y });
        overbarHeight = -textSize.y / 2.0;
        break;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE:
        console.error('Indeterminate state legal only in dialogs.');
        break;
    }

    let overbarLength = 0;
    let overbarDepth = -1;
    let braceNesting = 0;

    const iterateString = (
      overbarFn: (aOverbarLength: number, aOverbarHeight: number) => void,
      bitmapCharFn: (aChar: number) => number,
    ): void => {
      const codepoints = [...text].map((ch) => ch.codePointAt(0)!);

      for (let i = 0; i < codepoints.length; ++i) {
        const ch = codepoints[i]!;
        wxASSERT(ch !== 0x0a && ch !== 0x0d, 'No support for multiline bitmap text yet');

        if (ch === 0x7e /* ~ */ && overbarDepth === -1) {
          if (i + 1 < codepoints.length && codepoints[i + 1] === 0x7b /* { */) {
            i++;
            overbarDepth = braceNesting;
            braceNesting++;
            continue;
          }
        } else if (ch === 0x7b /* { */) {
          braceNesting++;
        } else if (ch === 0x7d /* } */) {
          if (braceNesting > 0) braceNesting--;

          if (braceNesting === overbarDepth) {
            overbarFn(overbarLength, overbarHeight);
            overbarLength = 0;

            overbarDepth = -1;
            continue;
          }
        }

        if (overbarDepth !== -1) overbarLength += bitmapCharFn(ch);
        else bitmapCharFn(ch);
      }
    };

    // First, calculate the amount of characters and overbars to reserve

    let charsCount = 0;
    let overbarsCount = 0;

    iterateString(
      () => {
        overbarsCount++;
      },
      (aChar: number): number => {
        if (aChar !== 0x20) charsCount++;

        return 0;
      },
    );

    this.m_currentManager!.Reserve(6 * charsCount + 6 * overbarsCount);

    // Now reset the state and actually draw the characters and overbars
    overbarLength = 0;
    overbarDepth = -1;
    braceNesting = 0;

    iterateString(
      (aOverbarLength: number, aOverbarHeight: number) => {
        this.drawBitmapOverbar(aOverbarLength, aOverbarHeight, false);
      },
      (aChar: number): number => {
        return this.drawBitmapChar(aChar, false);
      },
    );

    // Handle the case when overbar is active till the end of the drawn text
    this.m_currentManager!.Translate(0, commonOffset, 0);

    if (overbarDepth !== -1 && overbarLength > 0)
      this.drawBitmapOverbar(overbarLength, overbarHeight);

    this.Restore();
  }

  /// @copydoc GAL::DrawGrid()
  override DrawGrid(): void {
    const gl = this.gl;

    this.SetTarget(TARGET_NONCACHED);
    this.m_compositor.SetBuffer(this.m_mainBuffer);

    this.m_nonCachedManager!.EnableDepthTest(false);

    // sub-pixel lines all render the same
    const minorLineWidth = Math.fround(
      (Math.max(1.0, this.m_gridLineWidth) * this.getWorldPixelSize()) /
        this.m_canvas.GetScaleFactor(),
    );
    const majorLineWidth = Math.fround(minorLineWidth * 2.0);

    // Draw the axis and grid
    // For the drawing the start points, end points and increments have
    // to be calculated in world coordinates
    const worldStartPoint = this.m_screenWorldMatrix.mulVec2({ x: 0.0, y: 0.0 });
    const worldEndPoint = this.m_screenWorldMatrix.mulVec2(this.m_screenSize);

    // Draw axes if desired
    if (this.m_axesEnabled) {
      this.SetLineWidth(minorLineWidth);
      this.SetStrokeColor(this.m_axesColor);

      this.DrawLine({ x: worldStartPoint.x, y: 0 }, { x: worldEndPoint.x, y: 0 });
      this.DrawLine({ x: 0, y: worldStartPoint.y }, { x: 0, y: worldEndPoint.y });
    }

    // force flush
    this.m_nonCachedManager!.EndDrawing();

    if (!this.m_gridVisibility || this.m_gridSize.x === 0 || this.m_gridSize.y === 0) return;

    const gridScreenSize = this.GetVisibleGridSize();

    // Compute grid starting and ending indexes to draw grid points on the
    // visible screen area
    // Note: later any point coordinate will be offset by m_gridOrigin
    let gridStartX = KiROUND((worldStartPoint.x - this.m_gridOrigin.x) / gridScreenSize.x);
    let gridEndX = KiROUND((worldEndPoint.x - this.m_gridOrigin.x) / gridScreenSize.x);
    let gridStartY = KiROUND((worldStartPoint.y - this.m_gridOrigin.y) / gridScreenSize.y);
    let gridEndY = KiROUND((worldEndPoint.y - this.m_gridOrigin.y) / gridScreenSize.y);

    // Ensure start coordinate < end coordinate
    if (gridStartX > gridEndX) [gridStartX, gridEndX] = [gridEndX, gridStartX];
    if (gridStartY > gridEndY) [gridStartY, gridEndY] = [gridEndY, gridStartY];

    // Ensure the grid fills the screen
    --gridStartX;
    ++gridEndX;
    --gridStartY;
    ++gridEndY;

    gl.disable(gl.DEPTH_TEST);
    this.ff.glEnableTexture2D(false);

    if (this.m_gridStyle === GRID_STYLE.DOTS) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.ALWAYS, 1, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      this.ff.glColor4d(0.0, 0.0, 0.0, 0.0);
      this.SetStrokeColor(COLOR4D(0.0, 0.0, 0.0, 0.0));
    } else {
      this.ff.glColor4d(
        this.m_gridColor.r,
        this.m_gridColor.g,
        this.m_gridColor.b,
        this.m_gridColor.a,
      );
      this.SetStrokeColor(this.m_gridColor);
    }

    if (this.m_gridStyle === GRID_STYLE.SMALL_CROSS) {
      // Vertical positions
      for (let j = gridStartY; j <= gridEndY; j++) {
        const tickY = j % this.m_gridTick === 0;
        const posY = j * gridScreenSize.y + this.m_gridOrigin.y;

        // Horizontal positions
        for (let i = gridStartX; i <= gridEndX; i++) {
          const tickX = i % this.m_gridTick === 0;
          this.SetLineWidth(tickX && tickY ? majorLineWidth : minorLineWidth);
          const lineLen = 2.0 * this.GetLineWidth();
          const posX = i * gridScreenSize.x + this.m_gridOrigin.x;

          this.DrawLine({ x: posX - lineLen, y: posY }, { x: posX + lineLen, y: posY });
          this.DrawLine({ x: posX, y: posY - lineLen }, { x: posX, y: posY + lineLen });
        }
      }

      this.m_nonCachedManager!.EndDrawing();
    } else {
      // Vertical lines
      for (let j = gridStartY; j <= gridEndY; j++) {
        const y = j * gridScreenSize.y + this.m_gridOrigin.y;

        // If axes are drawn, skip the lines that would cover them
        if (this.m_axesEnabled && y === 0.0) continue;

        this.SetLineWidth(j % this.m_gridTick === 0 ? majorLineWidth : minorLineWidth);
        const a = { x: gridStartX * gridScreenSize.x + this.m_gridOrigin.x, y };
        const b = { x: gridEndX * gridScreenSize.x + this.m_gridOrigin.x, y };

        this.DrawLine(a, b);
      }

      this.m_nonCachedManager!.EndDrawing();

      if (this.m_gridStyle === GRID_STYLE.DOTS) {
        gl.stencilFunc(gl.NOTEQUAL, 0, 1);
        this.ff.glColor4d(
          this.m_gridColor.r,
          this.m_gridColor.g,
          this.m_gridColor.b,
          this.m_gridColor.a,
        );
        this.SetStrokeColor(this.m_gridColor);
      }

      // Horizontal lines
      for (let i = gridStartX; i <= gridEndX; i++) {
        const x = i * gridScreenSize.x + this.m_gridOrigin.x;

        // If axes are drawn, skip the lines that would cover them
        if (this.m_axesEnabled && x === 0.0) continue;

        this.SetLineWidth(i % this.m_gridTick === 0 ? majorLineWidth : minorLineWidth);
        const a = { x, y: gridStartY * gridScreenSize.y + this.m_gridOrigin.y };
        const b = { x, y: gridEndY * gridScreenSize.y + this.m_gridOrigin.y };
        this.DrawLine(a, b);
      }

      this.m_nonCachedManager!.EndDrawing();

      if (this.m_gridStyle === GRID_STYLE.DOTS) gl.disable(gl.STENCIL_TEST);
    }

    this.m_nonCachedManager!.EnableDepthTest(true);
    gl.enable(gl.DEPTH_TEST);
    this.ff.glEnableTexture2D(true);
  }

  // --------------
  // Screen methods
  // --------------

  /// @brief Resizes the canvas.
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };

    // Resize framebuffers
    const scaleFactor = this.m_canvas.GetScaleFactor();
    this.m_compositor.Resize(aWidth * scaleFactor, aHeight * scaleFactor);
    this.m_isFramebufferInitialized = false;

    // wxGLCanvas::SetSize( aWidth, aHeight ): the canvas element's
  }

  /// @brief Shows/hides the GAL canvas
  override Show(aShow: boolean): boolean {
    // wxGLCanvas::Show / Raise: the canvas element's
    return true;
  }

  /// @copydoc GAL::GetSwapInterval()
  override GetSwapInterval(): number {
    return this.m_swapInterval;
  }

  /// @copydoc GAL::Flush()
  override Flush(): void {
    this.gl.flush();
  }

  /// @copydoc GAL::ClearScreen()
  override ClearScreen(): void {
    const gl = this.gl;

    // Clear screen
    this.m_compositor.SetBuffer(OPENGL_COMPOSITOR.DIRECT_RENDERING);

    // NOTE: Black used here instead of m_clearColor; it will be composited later
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  // --------------
  // Transformation
  // --------------

  /// @copydoc GAL::Transform()
  override Transform(aTransformation: MATRIX3x3D): void {
    this.ff.glMultMatrixd(GL_FIXED_FUNCTION.matrixData(aTransformation));

    if (this.m_isInitialized && this.ufm_modelViewProjection !== -1) {
      this.m_shader.Use();
      this.setModelViewProjection();
      this.m_shader.Deactivate();
    }
  }

  /// @copydoc GAL::Rotate()
  override Rotate(aAngle: number): void {
    this.m_currentManager!.Rotate(aAngle, 0.0, 0.0, 1.0);
  }

  /// @copydoc GAL::Translate()
  override Translate(aVector: Vec2): void {
    this.m_currentManager!.Translate(aVector.x, aVector.y, 0.0);
  }

  /// @copydoc GAL::Scale()
  override Scale(aScale: Vec2): void {
    this.m_currentManager!.Scale(aScale.x, aScale.y, 1.0);
  }

  /// @copydoc GAL::Save()
  override Save(): void {
    this.m_currentManager!.PushMatrix();
  }

  /// @copydoc GAL::Restore()
  override Restore(): void {
    this.m_currentManager!.PopMatrix();
  }

  // --------------------------------------------
  // Group methods
  // ---------------------------------------------

  /// @copydoc GAL::BeginGroup()
  override BeginGroup(): number {
    this.m_isGrouping = true;

    const newItem = new VERTEX_ITEM(this.m_cachedManager!);
    const groupNumber = this.getNewGroupNumber();
    this.m_groups.set(groupNumber, newItem);

    return groupNumber;
  }

  /// @copydoc GAL::EndGroup()
  override EndGroup(): void {
    this.m_cachedManager!.FinishItem();
    this.m_isGrouping = false;
  }

  /// @copydoc GAL::DrawGroup()
  override DrawGroup(aGroupNumber: number): void {
    const group = this.m_groups.get(aGroupNumber);

    if (group !== undefined) this.m_cachedManager!.DrawItem(group);
  }

  /// @copydoc GAL::ChangeGroupColor()
  override ChangeGroupColor(aGroupNumber: number, aNewColor: Color4d): void {
    const group = this.m_groups.get(aGroupNumber);

    if (group !== undefined) this.m_cachedManager!.ChangeItemColor(group, aNewColor);
  }

  /// @copydoc GAL::ChangeGroupDepth()
  override ChangeGroupDepth(aGroupNumber: number, aDepth: number): void {
    const group = this.m_groups.get(aGroupNumber);

    if (group !== undefined) this.m_cachedManager!.ChangeItemDepth(group, aDepth);
  }

  /// @copydoc GAL::DeleteGroup()
  override DeleteGroup(aGroupNumber: number): void {
    // Frees memory in the container as well
    const group = this.m_groups.get(aGroupNumber);

    if (group !== undefined) {
      group.destroy(); // the shared_ptr's ~VERTEX_ITEM
      this.m_groups.delete(aGroupNumber);
    }
  }

  /// @copydoc GAL::ClearCache()
  override ClearCache(): void {
    this.m_bitmapCache.destroy();
    this.m_bitmapCache = new GL_BITMAP_CACHE(this.gl, this.m_canvas);

    for (const [, group] of this.m_groups) group.destroy();
    this.m_groups.clear();

    if (this.m_isInitialized) this.m_cachedManager!.Clear();
  }

  // --------------------------------------------------------
  // Handling the world <-> screen transformation
  // --------------------------------------------------------

  /// @copydoc GAL::SetTarget()
  override SetTarget(aTarget: RENDER_TARGET): void {
    switch (aTarget) {
      case TARGET_NONCACHED:
        this.m_currentManager = this.m_nonCachedManager;
        break;
      case TARGET_OVERLAY:
        this.m_currentManager = this.m_overlayManager;
        break;
      case TARGET_TEMP:
        this.m_currentManager = this.m_tempManager;
        break;
      default:
        this.m_currentManager = this.m_cachedManager;
        break;
    }

    this.m_currentTarget = aTarget;
  }

  /// @copydoc GAL::GetTarget()
  override GetTarget(): RENDER_TARGET {
    return this.m_currentTarget;
  }

  /// @copydoc GAL::ClearTarget()
  override ClearTarget(aTarget: RENDER_TARGET): void {
    // Save the current state
    const oldTarget = this.m_compositor.GetBuffer();

    switch (aTarget) {
      case TARGET_TEMP:
        if (this.m_tempBuffer) this.m_compositor.SetBuffer(this.m_tempBuffer);
        break;

      case TARGET_OVERLAY:
        if (this.m_overlayBuffer) this.m_compositor.SetBuffer(this.m_overlayBuffer);
        break;

      // Cached and noncached items are rendered to the same buffer
      default:
        this.m_compositor.SetBuffer(this.m_mainBuffer);
        break;
    }

    if (aTarget !== TARGET_OVERLAY) this.m_compositor.ClearBuffer(this.m_clearColor);
    else if (this.m_overlayBuffer) this.m_compositor.ClearBuffer(COLOR4D_BLACK);

    // Restore the previous state
    this.m_compositor.SetBuffer(oldTarget);
  }

  /// @copydoc GAL::HasTarget()
  override HasTarget(aTarget: RENDER_TARGET): boolean {
    switch (aTarget) {
      case TARGET_OVERLAY:
        return this.m_overlayBuffer !== 0;
      case TARGET_TEMP:
        return this.m_tempBuffer !== 0;
      default:
        return true;
    }
  }

  /// @copydoc GAL::SetNegativeDrawMode()
  override SetNegativeDrawMode(aSetting: boolean): void {}

  /// @copydoc GAL::StartDiffLayer()
  override StartDiffLayer(): void {
    this.m_currentManager!.EndDrawing();

    if (this.m_tempBuffer) {
      this.SetTarget(TARGET_TEMP);
      this.ClearTarget(TARGET_TEMP);

      // ClearTarget restores the previous compositor buffer, so we need to explicitly
      // set the compositor to render to m_tempBuffer for the layer drawing
      this.m_compositor.SetBuffer(this.m_tempBuffer);
    }
  }

  /// @copydoc GAL::EndDiffLayer()
  override EndDiffLayer(): void {
    const gl = this.gl;

    if (this.m_tempBuffer) {
      // End drawing to the temp buffer
      this.m_currentManager!.EndDrawing();

      // Use difference compositing for true XOR/difference mode:
      // - Where only one layer has content: shows that layer's color
      // - Where both layers overlap with identical content: cancels out (black)
      // - Where layers overlap with different content: shows the absolute difference
      this.m_compositor.DrawBufferDifference(this.m_tempBuffer, this.m_mainBuffer);
    } else {
      // Fall back to imperfect alpha blending on single buffer
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      this.m_currentManager!.EndDrawing();
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  override ComputeWorldScreenMatrix(): void {
    this.computeWorldScale();
    const pixelSize = this.m_worldScale;

    // we need -m_lookAtPoint == -k * pixelSize + 0.5 * pixelSize for OpenGL
    // meaning m_lookAtPoint = (k-0.5)*pixelSize with integer k
    this.m_lookAtPoint = {
      x: round_to_half_pixel(this.m_lookAtPoint.x, pixelSize),
      y: round_to_half_pixel(this.m_lookAtPoint.y, pixelSize),
    };

    super.ComputeWorldScreenMatrix();
  }

  // -------
  // Cursor
  // -------

  /// @copydoc GAL::SetNativeCursorStyle()
  override SetNativeCursorStyle(aCursor: KICURSOR, aHiDPI: boolean): boolean {
    // Store the current cursor type and get the wx cursor for it
    if (!super.SetNativeCursorStyle(aCursor, aHiDPI)) return false;

    // m_currentwxCursor = CURSOR_STORE::GetCursor( m_currentNativeCursor, aHiDPI );
    this.m_canvas?.SetCursor(this.m_currentNativeCursor, aHiDPI);

    return true;
  }

  /// @copydoc GAL::DrawCursor()
  override DrawCursor(aCursorPosition: Vec2): void {
    // Now we should only store the position of the mouse cursor
    // The real drawing routines are in blitCursor()
    //VECTOR2D screenCursor = m_worldScreenMatrix * aCursorPosition;
    //m_cursorPosition = m_screenWorldMatrix * VECTOR2D( screenCursor.x, screenCursor.y );
    this.m_cursorPosition = aCursorPosition;
  }

  override EnableDepthTest(aEnabled = false): void {
    this.m_cachedManager!.EnableDepthTest(aEnabled);
    this.m_nonCachedManager!.EnableDepthTest(aEnabled);
    this.m_overlayManager!.EnableDepthTest(aEnabled);
  }

  /// @copydoc GAL::DrawGlyph()
  override DrawGlyph(aGlyph: GLYPH_LIKE, aNth: number, aTotal: number): void {
    if (aGlyph.IsStroke()) {
      const strokeGlyph = aGlyph as STROKE_GLYPH;
      this.DrawPolylines(strokeGlyph.strokes);
    } else if (aGlyph.IsOutline()) {
      const outlineGlyph = aGlyph as OUTLINE_GLYPH;

      this.m_currentManager!.Shader(SHADER_NONE);
      this.m_currentManager!.Color(this.m_fillColor);

      outlineGlyph.Triangulate((aPt1: Vec2, aPt2: Vec2, aPt3: Vec2) => {
        this.m_currentManager!.Reserve(3);

        this.m_currentManager!.Vertex(aPt1.x, aPt1.y, this.m_layerDepth);
        this.m_currentManager!.Vertex(aPt2.x, aPt2.y, this.m_layerDepth);
        this.m_currentManager!.Vertex(aPt3.x, aPt3.y, this.m_layerDepth);
      });
    }
  }

  /// @copydoc GAL::DrawGlyphs()
  override DrawGlyphs(aGlyphs: readonly GLYPH_LIKE[]): void {
    if (aGlyphs.length === 0) return;

    let allGlyphsAreStroke = true;
    let allGlyphsAreOutline = true;

    for (const glyph of aGlyphs) {
      if (!glyph.IsStroke()) {
        allGlyphsAreStroke = false;
        break;
      }
    }

    for (const glyph of aGlyphs) {
      if (!glyph.IsOutline()) {
        allGlyphsAreOutline = false;
        break;
      }
    }

    if (allGlyphsAreStroke) {
      // Optimized path for stroke fonts that pre-reserves line quads.
      let lineQuadCount = 0;

      for (const glyph of aGlyphs) {
        const strokeGlyph = glyph as STROKE_GLYPH;

        for (const points of strokeGlyph.strokes) lineQuadCount += points.length - 1;
      }

      this.reserveLineQuads(lineQuadCount);

      for (const glyph of aGlyphs) {
        const strokeGlyph = glyph as STROKE_GLYPH;

        for (const points of strokeGlyph.strokes) {
          this.drawPolyline((idx) => points[idx]!, points.length, false);
        }
      }

      return;
    }

    if (allGlyphsAreOutline) {
      // Optimized path for outline fonts that pre-reserves glyph triangles.
      let triangleCount = 0;

      for (const glyph of aGlyphs) {
        const outlineGlyph = glyph as OUTLINE_GLYPH;

        for (let i = 0; i < outlineGlyph.TriangulatedPolyCount(); i++) {
          const polygon = outlineGlyph.TriangulatedPolygon(i);

          triangleCount += polygon.GetTriangleCount();
        }
      }

      this.m_currentManager!.Shader(SHADER_NONE);
      this.m_currentManager!.Color(this.m_fillColor);

      this.m_currentManager!.Reserve(3 * triangleCount);

      const a: VECTOR2I = { x: 0, y: 0 };
      const b: VECTOR2I = { x: 0, y: 0 };
      const c: VECTOR2I = { x: 0, y: 0 };

      for (const glyph of aGlyphs) {
        const outlineGlyph = glyph as OUTLINE_GLYPH;

        for (let i = 0; i < outlineGlyph.TriangulatedPolyCount(); i++) {
          const polygon = outlineGlyph.TriangulatedPolygon(i);

          for (let j = 0; j < polygon.GetTriangleCount(); j++) {
            polygon.GetTriangle(j, a, b, c);
            this.m_currentManager!.Vertex(a.x, a.y, this.m_layerDepth);
            this.m_currentManager!.Vertex(b.x, b.y, this.m_layerDepth);
            this.m_currentManager!.Vertex(c.x, c.y, this.m_layerDepth);
          }
        }
      }
    } else {
      // Regular path
      for (let i = 0; i < aGlyphs.length; i++) this.DrawGlyph(aGlyphs[i]!, i, aGlyphs.length);
    }
  }

  private drawLineQuad(aStartPoint: Vec2, aEndPoint: Vec2, aReserve = true): void {
    /* Helper drawing:                   ____--- v3       ^
     *                           ____---- ...   \          \
     *                   ____----      ...       \   end    \
     *     v1    ____----           ...    ____----          \ width
     *       ----                ...___----        \          \
     *       \             ___...--                 \          v
     *        \    ____----...                ____---- v2
     *         ----     ...           ____----
     *  start   \    ...      ____----
     *           \... ____----
     *            ----
     *            v0
     * dots mark triangles' hypotenuses
     */

    // GetTransformation() * glm::vec4( aStartPoint.x, aStartPoint.y, 0.0, 0.0 ): a direction
    const m = this.m_currentManager!.GetTransformation();
    const v1 = {
      x: m[0]! * aStartPoint.x + m[4]! * aStartPoint.y,
      y: m[1]! * aStartPoint.x + m[5]! * aStartPoint.y,
    };
    const v2 = {
      x: m[0]! * aEndPoint.x + m[4]! * aEndPoint.y,
      y: m[1]! * aEndPoint.x + m[5]! * aEndPoint.y,
    };

    const vs = { x: v2.x - v1.x, y: v2.y - v1.y };

    if (aReserve) this.reserveLineQuads(1);

    // Line width is maintained by the vertex shader
    this.m_currentManager!.Shader(SHADER_LINE_A, this.m_lineWidth, vs.x, vs.y);
    this.m_currentManager!.Vertex(aStartPoint, this.m_layerDepth);

    this.m_currentManager!.Shader(SHADER_LINE_B, this.m_lineWidth, vs.x, vs.y);
    this.m_currentManager!.Vertex(aStartPoint, this.m_layerDepth);

    this.m_currentManager!.Shader(SHADER_LINE_C, this.m_lineWidth, vs.x, vs.y);
    this.m_currentManager!.Vertex(aEndPoint, this.m_layerDepth);

    this.m_currentManager!.Shader(SHADER_LINE_D, this.m_lineWidth, vs.x, vs.y);
    this.m_currentManager!.Vertex(aEndPoint, this.m_layerDepth);

    this.m_currentManager!.Shader(SHADER_LINE_E, this.m_lineWidth, vs.x, vs.y);
    this.m_currentManager!.Vertex(aEndPoint, this.m_layerDepth);

    this.m_currentManager!.Shader(SHADER_LINE_F, this.m_lineWidth, vs.x, vs.y);
    this.m_currentManager!.Vertex(aStartPoint, this.m_layerDepth);
  }

  private reserveLineQuads(aLineCount: number): void {
    this.m_currentManager!.Reserve(6 * aLineCount);
  }

  private drawSemiCircle(aCenterPoint: Vec2, aRadius: number, aAngle: number): void {
    if (this.m_isFillEnabled) {
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );
      this.drawFilledSemiCircle(aCenterPoint, aRadius, aAngle);
    }

    if (this.m_isStrokeEnabled) {
      this.m_currentManager!.Color(
        this.m_strokeColor.r,
        this.m_strokeColor.g,
        this.m_strokeColor.b,
        this.m_strokeColor.a,
      );
      this.drawStrokedSemiCircle(aCenterPoint, aRadius, aAngle);
    }
  }

  private drawFilledSemiCircle(aCenterPoint: Vec2, aRadius: number, aAngle: number): void {
    this.Save();

    this.m_currentManager!.Reserve(3);
    this.m_currentManager!.Translate(aCenterPoint.x, aCenterPoint.y, 0.0);
    this.m_currentManager!.Rotate(aAngle, 0.0, 0.0, 1.0);

    /* Draw a triangle that contains the semicircle, then shade it to leave only
     * the semicircle. Parameters given to Shader() are indices of the triangle's vertices
     * (if you want to understand more, check the vertex shader source [shader.vert]).
     * Shader uses these coordinates to determine if fragments are inside the semicircle or not.
     * Does the calculations in the vertex shader now (pixel alignment)
     *       v2
     *       /\
     *      /__\
     *  v0 //__\\ v1
     */
    this.m_currentManager!.Shader(SHADER_FILLED_CIRCLE, 4.0);
    this.m_currentManager!.Vertex((-aRadius * 3.0) / Math.sqrt(3.0), 0.0, this.m_layerDepth); // v0

    this.m_currentManager!.Shader(SHADER_FILLED_CIRCLE, 5.0);
    this.m_currentManager!.Vertex((aRadius * 3.0) / Math.sqrt(3.0), 0.0, this.m_layerDepth); // v1

    this.m_currentManager!.Shader(SHADER_FILLED_CIRCLE, 6.0);
    this.m_currentManager!.Vertex(0.0, aRadius * 2.0, this.m_layerDepth); // v2

    this.Restore();
  }

  private drawStrokedSemiCircle(
    aCenterPoint: Vec2,
    aRadius: number,
    aAngle: number,
    aReserve = true,
  ): void {
    const outerRadius = aRadius + this.m_lineWidth / 2;

    this.Save();

    if (aReserve) this.m_currentManager!.Reserve(3);

    this.m_currentManager!.Translate(aCenterPoint.x, aCenterPoint.y, 0.0);
    this.m_currentManager!.Rotate(aAngle, 0.0, 0.0, 1.0);

    /* Draw a triangle that contains the semicircle, then shade it to leave only
     * the semicircle. Parameters given to Shader() are indices of the triangle's vertices
     * (if you want to understand more, check the vertex shader source [shader.vert]), the
     * radius and the line width. Shader uses these coordinates to determine if fragments are
     * inside the semicircle or not.
     *       v2
     *       /\
     *      /__\
     *  v0 //__\\ v1
     */
    this.m_currentManager!.Shader(SHADER_STROKED_CIRCLE, 4.0, aRadius, this.m_lineWidth);
    this.m_currentManager!.Vertex((-outerRadius * 3.0) / Math.sqrt(3.0), 0.0, this.m_layerDepth); // v0

    this.m_currentManager!.Shader(SHADER_STROKED_CIRCLE, 5.0, aRadius, this.m_lineWidth);
    this.m_currentManager!.Vertex((outerRadius * 3.0) / Math.sqrt(3.0), 0.0, this.m_layerDepth); // v1

    this.m_currentManager!.Shader(SHADER_STROKED_CIRCLE, 6.0, aRadius, this.m_lineWidth);
    this.m_currentManager!.Vertex(0.0, outerRadius * 2.0, this.m_layerDepth); // v2

    this.Restore();
  }

  private drawPolygon(aPoints: number[], aPointCount: number): void {
    if (this.m_isFillEnabled) {
      this.m_currentManager!.Shader(SHADER_NONE);
      this.m_currentManager!.Color(
        this.m_fillColor.r,
        this.m_fillColor.g,
        this.m_fillColor.b,
        this.m_fillColor.a,
      );

      // Any non convex polygon needs to be tesselated
      // for this purpose the GLU standard functions are used
      const params: TessParams = {
        vboManager: this.m_currentManager!,
        intersectPoints: this.m_tessIntersects,
      };
      this.m_tesselator.gluTessBeginPolygon(params);
      this.m_tesselator.gluTessBeginContour();

      for (let i = 0; i < aPointCount; ++i) {
        const point = [aPoints[i * 3]!, aPoints[i * 3 + 1]!, aPoints[i * 3 + 2]!];
        this.m_tesselator.gluTessVertex(point, point);
      }

      this.m_tesselator.gluTessEndContour();
      this.m_tesselator.gluTessEndPolygon();

      // Free allocated intersecting points
      this.m_tessIntersects = [];
    }

    if (this.m_isStrokeEnabled) {
      this.drawPolyline((idx) => ({ x: aPoints[idx * 3]!, y: aPoints[idx * 3 + 1]! }), aPointCount);
    }
  }

  private drawPolyline(
    aPointGetter: (idx: number) => Vec2,
    aPointCount: number,
    aReserve = true,
  ): void {
    // wxCHECK( aPointCount > 0, /* return */ )
    if (!(aPointCount > 0)) return;

    this.m_currentManager!.Color(
      this.m_strokeColor.r,
      this.m_strokeColor.g,
      this.m_strokeColor.b,
      this.m_strokeColor.a,
    );

    if (aPointCount === 1) {
      this.drawLineQuad(aPointGetter(0), aPointGetter(0), aReserve);
      return;
    }

    if (aReserve) {
      this.reserveLineQuads(aPointCount - 1);
    }

    for (let i = 1; i < aPointCount; ++i) {
      const start = aPointGetter(i - 1);
      const end = aPointGetter(i);

      this.drawLineQuad(start, end, false);
    }
  }

  private drawSegmentChain(
    aPointGetter: (idx: number) => Vec2,
    aPointCount: number,
    aWidth: number,
    aReserve = true,
  ): void {
    // wxCHECK( aPointCount >= 2, /* return */ )
    if (!(aPointCount >= 2)) return;

    this.m_currentManager!.Color(
      this.m_strokeColor.r,
      this.m_strokeColor.g,
      this.m_strokeColor.b,
      this.m_strokeColor.a,
    );

    let vertices = 0;

    for (let i = 1; i < aPointCount; ++i) {
      const start = aPointGetter(i - 1);
      const end = aPointGetter(i);

      const startx = Math.fround(start.x);
      const starty = Math.fround(start.y);
      const endx = Math.fround(end.x);
      const endy = Math.fround(end.y);

      // Be careful about floating point rounding.  As we draw segments in larger and larger
      // coordinates, the shader (which uses floats) will lose precision and stop drawing small
      // segments.  In this case, we need to draw a circle for the minimal segment.

      // Check if the coordinate differences can be accurately represented as floats
      if (startx === endx && starty === endy) {
        vertices += 3; // One circle
        continue;
      }

      if (this.m_isFillEnabled || aWidth === 1.0) {
        vertices += 6; // One line
      } else {
        vertices += 6 + 6 + 3 + 3; // Two lines and two half-circles
      }
    }

    this.m_currentManager!.Reserve(vertices);

    for (let i = 1; i < aPointCount; ++i) {
      const start = aPointGetter(i - 1);
      const end = aPointGetter(i);

      this.drawSegment(start, end, aWidth, false);
    }
  }

  private drawBitmapChar(aChar: number, aReserve = true): number {
    const TEX_X = font_image.width;
    const TEX_Y = font_image.height;

    // handle space
    if (aChar === 0x20) {
      const g = LookupGlyph(0x78 /* x */);
      // wxCHECK( g, 0 )
      if (!g) return 0;

      // Match stroke font as well as possible
      const spaceWidth = g.advance * 0.74;

      this.Translate({ x: spaceWidth, y: 0 });
      return KiROUND(spaceWidth);
    }

    let glyph = LookupGlyph(aChar);

    // If the glyph is not found (happens for many esoteric unicode chars)
    // shows a '?' instead.
    if (!glyph) glyph = LookupGlyph(0x3f /* ? */);

    if (!glyph)
      // Should not happen.
      return 0;

    const X = Math.fround(glyph.atlas_x + font_information.smooth_pixels);
    const Y = Math.fround(glyph.atlas_y + font_information.smooth_pixels);
    const XOFF = Math.fround(glyph.minx);

    // adjust for height rounding
    const round_adjust = Math.fround(
      glyph.maxy - glyph.miny - (glyph.atlas_h - font_information.smooth_pixels * 2),
    );
    const top_adjust = Math.fround(font_information.max_y - glyph.maxy);
    const YOFF = Math.fround(round_adjust + top_adjust);
    const W = Math.fround(glyph.atlas_w - font_information.smooth_pixels * 2);
    const H = Math.fround(glyph.atlas_h - font_information.smooth_pixels * 2);
    const B = 0;

    if (aReserve) this.m_currentManager!.Reserve(6);

    this.Translate({ x: XOFF, y: YOFF });

    /* Glyph:
     * v0    v1
     *   +--+
     *   | /|
     *   |/ |
     *   +--+
     * v2    v3
     */
    this.m_currentManager!.Shader(SHADER_FONT, X / TEX_X, (Y + H) / TEX_Y);
    this.m_currentManager!.Vertex(-B, -B, 0); // v0

    this.m_currentManager!.Shader(SHADER_FONT, (X + W) / TEX_X, (Y + H) / TEX_Y);
    this.m_currentManager!.Vertex(W + B, -B, 0); // v1

    this.m_currentManager!.Shader(SHADER_FONT, X / TEX_X, Y / TEX_Y);
    this.m_currentManager!.Vertex(-B, H + B, 0); // v2

    this.m_currentManager!.Shader(SHADER_FONT, (X + W) / TEX_X, (Y + H) / TEX_Y);
    this.m_currentManager!.Vertex(W + B, -B, 0); // v1

    this.m_currentManager!.Shader(SHADER_FONT, X / TEX_X, Y / TEX_Y);
    this.m_currentManager!.Vertex(-B, H + B, 0); // v2

    this.m_currentManager!.Shader(SHADER_FONT, (X + W) / TEX_X, Y / TEX_Y);
    this.m_currentManager!.Vertex(W + B, H + B, 0); // v3

    this.Translate({ x: -XOFF + glyph.advance, y: -YOFF });

    return Math.trunc(glyph.advance);
  }

  private drawBitmapOverbar(aLength: number, aHeight: number, aReserve = true): void {
    // To draw an overbar, simply draw an overbar
    const glyph = LookupGlyph(0x5f /* _ */);
    // wxCHECK( glyph, /* void */ )
    if (!glyph) return;

    const H = Math.fround(glyph.maxy - glyph.miny);

    this.Save();

    this.Translate({ x: -aLength, y: -aHeight });

    if (aReserve) this.m_currentManager!.Reserve(6);

    this.m_currentManager!.Color(
      this.m_strokeColor.r,
      this.m_strokeColor.g,
      this.m_strokeColor.b,
      this.m_strokeColor.a,
    );

    this.m_currentManager!.Shader(0);

    this.m_currentManager!.Vertex(0, 0, 0); // v0
    this.m_currentManager!.Vertex(aLength, 0, 0); // v1
    this.m_currentManager!.Vertex(0, H, 0); // v2

    this.m_currentManager!.Vertex(aLength, 0, 0); // v1
    this.m_currentManager!.Vertex(0, H, 0); // v2
    this.m_currentManager!.Vertex(aLength, H, 0); // v3

    this.Restore();
  }

  private computeBitmapTextSize(aText: string): [Vec2, number] {
    const defaultGlyph = LookupGlyph(0x28 /* ( */)!; // for strange chars

    const textSize = { x: 0, y: 0 };
    let commonOffset = Number.MAX_VALUE;
    const charHeight = Math.fround(font_information.max_y - defaultGlyph.miny);
    let overbarDepth = -1;
    let braceNesting = 0;

    const codepoints = [...aText].map((ch) => ch.codePointAt(0)!);

    for (let i = 0; i < codepoints.length; ++i) {
      const ch = codepoints[i]!;

      if (ch === 0x7e /* ~ */ && overbarDepth === -1) {
        if (i + 1 < codepoints.length && codepoints[i + 1] === 0x7b /* { */) {
          i++;
          overbarDepth = braceNesting;
          braceNesting++;
          continue;
        }
      } else if (ch === 0x7b /* { */) {
        braceNesting++;
      } else if (ch === 0x7d /* } */) {
        if (braceNesting > 0) braceNesting--;

        if (braceNesting === overbarDepth) {
          overbarDepth = -1;
          continue;
        }
      }

      let glyph = LookupGlyph(ch);

      if (
        !glyph || // Not coded in font
        ch === 0x2d /* - */ ||
        ch === 0x5f /* _ */
      ) {
        // Strange size of these 2 chars
        glyph = defaultGlyph;
      }

      if (glyph) textSize.x += glyph.advance;
    }

    textSize.y = Math.max(textSize.y, charHeight);
    commonOffset = Math.min(Math.fround(font_information.max_y - defaultGlyph.maxy), commonOffset);
    textSize.y -= commonOffset;

    return [textSize, commonOffset];
  }

  private blitCursor(): void {
    if (!this.IsCursorEnabled()) return;

    const gl = this.gl;
    const ff = this.ff;

    this.m_compositor.SetBuffer(OPENGL_COMPOSITOR.DIRECT_RENDERING);

    let cursorBegin: Vec2 = { x: 0, y: 0 };
    let cursorEnd: Vec2 = { x: 0, y: 0 };
    const cursorCenter = this.m_cursorPosition;

    if (this.m_crossHairMode === CROSS_HAIR_MODE.FULLSCREEN_CROSS) {
      cursorBegin = this.m_screenWorldMatrix.mulVec2({ x: 0.0, y: 0.0 });
      cursorEnd = this.m_screenWorldMatrix.mulVec2(this.m_screenSize);
    } else if (this.m_crossHairMode === CROSS_HAIR_MODE.SMALL_CROSS) {
      const cursorSize = 80;

      cursorBegin = {
        x: this.m_cursorPosition.x - cursorSize / (2 * this.m_worldScale),
        y: this.m_cursorPosition.y - cursorSize / (2 * this.m_worldScale),
      };
      cursorEnd = {
        x: this.m_cursorPosition.x + cursorSize / (2 * this.m_worldScale),
        y: this.m_cursorPosition.y + cursorSize / (2 * this.m_worldScale),
      };
    }

    const color = this.getCursorColor();

    const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    ff.glEnableTexture2D(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.lineWidth(1.0);
    ff.glColor4d(color.r, color.g, color.b, color.a);

    ff.glMatrixMode(GL_MATRIX_MODE.GL_PROJECTION);
    ff.glPushMatrix();
    ff.glTranslated(0, 0, -0.5);

    ff.glBegin(GL_BEGIN_MODE.GL_LINES);

    if (this.m_crossHairMode === CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL) {
      // Calculate screen bounds in world coordinates
      const screenTopLeft = this.m_screenWorldMatrix.mulVec2({ x: 0.0, y: 0.0 });
      const screenBottomRight = this.m_screenWorldMatrix.mulVec2(this.m_screenSize);

      // For 45-degree lines passing through cursor position
      // Line equation: y = x + (cy - cx) for positive slope
      // Line equation: y = -x + (cy + cx) for negative slope
      const cx = this.m_cursorPosition.x;
      const cy = this.m_cursorPosition.y;

      // Calculate intersections for positive slope diagonal (y = x + offset)
      const offset1 = cy - cx;
      const pos_start = { x: screenTopLeft.x, y: screenTopLeft.x + offset1 };
      const pos_end = { x: screenBottomRight.x, y: screenBottomRight.x + offset1 };

      // Draw positive slope diagonal
      ff.glVertex2d(pos_start.x, pos_start.y);
      ff.glVertex2d(pos_end.x, pos_end.y);

      // Calculate intersections for negative slope diagonal (y = -x + offset)
      const offset2 = cy + cx;
      const neg_start = { x: screenTopLeft.x, y: offset2 - screenTopLeft.x };
      const neg_end = { x: screenBottomRight.x, y: offset2 - screenBottomRight.x };

      // Draw negative slope diagonal
      ff.glVertex2d(neg_start.x, neg_start.y);
      ff.glVertex2d(neg_end.x, neg_end.y);
    } else {
      ff.glVertex2d(cursorCenter.x, cursorBegin.y);
      ff.glVertex2d(cursorCenter.x, cursorEnd.y);

      ff.glVertex2d(cursorBegin.x, cursorCenter.y);
      ff.glVertex2d(cursorEnd.x, cursorCenter.y);
    }

    ff.glEnd();

    ff.glPopMatrix();

    if (depthTestEnabled) gl.enable(gl.DEPTH_TEST);
  }

  private getNewGroupNumber(): number {
    wxASSERT(this.m_groups.size < 0xffffffff, 'There are no free slots to store a group');

    while (this.m_groups.has(this.m_groupCounter)) this.m_groupCounter++;

    return this.m_groupCounter++;
  }

  private calcAngleStep(aRadius: number): number {
    // Bigger arcs need smaller alpha increment to make them look smooth
    return Math.min(1e6 / aRadius, (2.0 * Math.PI) / SEG_PER_CIRCLE_COUNT);
  }

  private init(): void {
    wxASSERT(this.m_isContextLocked, 'This should only be called from within a locked context.');

    // Check correct initialization from the constructor
    if (this.m_tesselator === null) throw new Error('Could not create the tesselator');

    const gl = this.gl;

    // gladLoaderLoadGL(), the vendor/renderer/version strings: the browser's context
    const version = gl.getParameter(gl.VERSION) as string | null;

    if (!version) throw new Error('No GL context is current (glGetString returned NULL)');

    // Check the OpenGL version (minimum 2.1 is required): WebGL2 is ES 3.0
    // Framebuffer objects and vertex buffer objects: WebGL2 core

    // Prepare shaders
    if (
      !this.m_shader.IsLinked() &&
      !this.m_shader.LoadShaderFromStrings(SHADER_TYPE.SHADER_TYPE_VERTEX, glsl_kicad_vert)
    ) {
      throw new Error('Cannot compile vertex shader!');
    }

    if (
      !this.m_shader.IsLinked() &&
      !this.m_shader.LoadShaderFromStrings(SHADER_TYPE.SHADER_TYPE_FRAGMENT, glsl_kicad_frag)
    ) {
      throw new Error('Cannot compile fragment shader!');
    }

    if (!this.m_shader.IsLinked() && !this.m_shader.Link())
      throw new Error('Cannot link the shaders!');

    // Set up shader parameters after linking
    this.setupShaderParameters();

    // Check if video card supports textures big enough to fit the font atlas
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    if (maxTextureSize < font_image.width || maxTextureSize < font_image.height) {
      // TODO implement software texture scaling
      // for bitmap fonts and use a higher resolution texture?
      throw new Error('Requested texture size is not supported');
    }

    // SetSwapInterval( -1 ): the browser's vsync
    this.m_swapInterval = -1;

    this.m_cachedManager = new VERTEX_MANAGER(gl, true);
    this.m_nonCachedManager = new VERTEX_MANAGER(gl, false);
    this.m_overlayManager = new VERTEX_MANAGER(gl, false);
    this.m_tempManager = new VERTEX_MANAGER(gl, false);

    // Make VBOs use shaders
    this.m_cachedManager.SetShader(this.m_shader);
    this.m_nonCachedManager.SetShader(this.m_shader);
    this.m_overlayManager.SetShader(this.m_shader);
    this.m_tempManager.SetShader(this.m_shader);

    this.SetTarget(this.m_currentTarget);

    this.m_isInitialized = true;
  }

  private setupShaderParameters(): void {
    // Initialize shader uniform parameter locations
    this.ufm_fontTexture = this.m_shader.AddParameter('u_fontTexture');
    this.ufm_fontTextureWidth = this.m_shader.AddParameter('u_fontTextureWidth');
    this.ufm_worldPixelSize = this.m_shader.AddParameter('u_worldPixelSize');
    this.ufm_screenPixelSize = this.m_shader.AddParameter('u_screenPixelSize');
    this.ufm_pixelSizeMultiplier = this.m_shader.AddParameter('u_pixelSizeMultiplier');
    this.ufm_antialiasingOffset = this.m_shader.AddParameter('u_antialiasingOffset');
    this.ufm_minLinePixelWidth = this.m_shader.AddParameter('u_minLinePixelWidth');
    this.ufm_modelViewProjection = this.m_shader.AddParameter('u_modelViewProjection');
  }
}
