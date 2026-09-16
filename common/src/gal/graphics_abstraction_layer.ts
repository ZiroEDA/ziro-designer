// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/graphics_abstraction_layer.h` + `common/gal/graphics_abstraction_layer.cpp`:
 * `KIGFX::GAL`, the abstract drawing interface. Every drawing method has the
 * empty default body the header gives it; a concrete GAL (the WebGL one, the
 * callback one for text) overrides what it draws.
 */

import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { MATRIX3x3D } from '@ziroeda/kimath/src/math/matrix3x3.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { LINK } from '@ziroeda/core/src/observable.js';
import { ADVANCED_CFG } from '../advanced_config.js';
import type { BITMAP_BASE } from '../bitmap_base.js';
import type { Color4d } from '../color4d.js';
import { FONT } from '../font/font.js';
import { METRICS } from '../font/font_metrics.js';
import type { GLYPH_LIKE } from '../font/glyph.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T, TEXT_ATTRIBUTES } from '../font/text_attributes.js';
import { PgmOrNull } from '../pgm_base.js';
import { KICURSOR } from './cursors.js';
import { MAX_LAYERS_FOR_VIEW, RENDER_TARGET } from './definitions.js';
import {
  CROSS_HAIR_MODE,
  type GAL_DISPLAY_OPTIONS,
  type GAL_DISPLAY_OPTIONS_OBSERVER,
  GRID_SNAPPING,
  GRID_STYLE,
} from './gal_display_options.js';

const COLOR4D = (r: number, g: number, b: number, a: number): Color4d => ({ r, g, b, a });

/**
 * Abstract interface for drawing on a 2D-surface.
 *
 * The functions are optimized for drawing shapes of an EDA-program such as KiCad. Most methods
 * are abstract and need to be implemented by a lower layer, for example by a Cairo or OpenGL
 * implementation.  Almost all methods use world coordinates as arguments. The board design is
 * defined in world space units for drawing purposes these are transformed to screen units with
 * this layer. So zooming is handled here as well.
 */
export class GAL implements GAL_DISPLAY_OPTIONS_OBSERVER {
  protected m_options: GAL_DISPLAY_OPTIONS;
  protected m_observerLink: LINK<GAL_DISPLAY_OPTIONS_OBSERVER> | null = null;

  protected m_depthStack: number[] = []; ///< Stored depth values
  protected m_screenSize: VECTOR2I = { x: 0, y: 0 }; ///< Screen size in screen (wx logical) coordinates

  protected m_worldUnitLength = 0; ///< The unit length of the world coordinates [inch]
  protected m_screenDPI = 0; ///< The dots per inch of the screen
  protected m_lookAtPoint: Vec2 = { x: 0, y: 0 }; ///< Point to be looked at in world space
  protected m_zoomFactor = 0; ///< The zoom factor
  protected m_rotation = 0; ///< Rotation transformation (radians)
  protected m_worldScreenMatrix: MATRIX3x3D = new MATRIX3x3D(); ///< World transformation
  protected m_screenWorldMatrix: MATRIX3x3D = new MATRIX3x3D(); ///< Screen transformation
  protected m_worldScale = 0; ///< The scale factor world->screen
  protected m_globalFlipX = false; ///< Flag for X axis flipping
  protected m_globalFlipY = false; ///< Flag for Y axis flipping

  protected m_lineWidth = 0; ///< The line width
  protected m_minLineWidth = 0; ///< Minimum line width in pixels

  protected m_isFillEnabled = false; ///< Is filling of graphic objects enabled ?
  protected m_isStrokeEnabled = false; ///< Are the outlines stroked ?

  protected m_fillColor: Color4d = COLOR4D(0, 0, 0, 0); ///< The fill color
  protected m_strokeColor: Color4d = COLOR4D(0, 0, 0, 0); ///< The color of the outlines
  protected m_clearColor: Color4d = COLOR4D(0, 0, 0, 0);
  protected m_hoverColor: Color4d = COLOR4D(0, 0, 0, 0); ///< Color for hovered (active) links

  protected m_layerDepth = 0; ///< The actual layer depth
  protected m_depthRange: Vec2 = { x: 0, y: 0 }; ///< Range of the depth

  // Grid settings
  protected m_gridVisibility = false; ///< Should the grid be shown
  protected m_gridStyle: GRID_STYLE = GRID_STYLE.DOTS; ///< Grid display style
  protected m_gridSize: Vec2 = { x: 0, y: 0 }; ///< The grid size
  protected m_gridOrigin: Vec2 = { x: 0, y: 0 }; ///< The grid origin
  protected m_gridOffset: Vec2 = { x: 0, y: 0 }; ///< The grid offset to compensate cursor position
  protected m_gridColor: Color4d = COLOR4D(0, 0, 0, 0); ///< Color of the grid
  protected m_axesColor: Color4d = COLOR4D(0, 0, 0, 0); ///< Color of the axes
  protected m_axesEnabled = false; ///< Should the axes be drawn
  protected m_gridTick = 0; ///< Every tick line gets the double width
  protected m_gridLineWidth = 0; ///< Line width of the grid
  protected m_gridMinSpacing = 0; ///< Minimum screen size of the grid (pixels)
  ///< below which the grid is not drawn

  // Cursor settings
  protected m_isCursorEnabled = false; ///< Is the cursor enabled?
  protected m_forceDisplayCursor = false; ///< Always show cursor
  protected m_cursorColor: Color4d = COLOR4D(0, 0, 0, 0); ///< Cursor color
  protected m_crossHairMode: CROSS_HAIR_MODE = CROSS_HAIR_MODE.SMALL_CROSS; ///< Crosshair drawing mode
  protected m_cursorPosition: Vec2 = { x: 0, y: 0 }; ///< Current cursor position (world coordinates)

  protected m_currentNativeCursor: KICURSOR; ///< Current cursor

  private m_attributes: TEXT_ATTRIBUTES = new TEXT_ATTRIBUTES();

  // Constructor / Destructor
  constructor(aDisplayOptions: GAL_DISPLAY_OPTIONS) {
    this.m_options = aDisplayOptions;
    // m_currentNativeCursor is initialized with KICURSOR::DEFAULT value to avoid
    // if comparison with uninitialized value on SetNativeCursorStyle method.
    // Some classes inheriting from GAL has different SetNativeCursorStyle method
    // implementation and therefore it's called also on constructor
    // to change the value from DEFAULT to KICURSOR::ARROW
    this.m_currentNativeCursor = KICURSOR.DEFAULT;

    // Set the default values for the internal variables
    this.SetIsFill(false);
    this.SetIsStroke(true);
    this.SetFillColor(COLOR4D(0.0, 0.0, 0.0, 0.0));
    this.SetStrokeColor(COLOR4D(1.0, 1.0, 1.0, 1.0));
    this.SetLookAtPoint({ x: 0, y: 0 });
    this.SetZoomFactor(1.0);
    this.SetRotation(0.0);
    // this value for SetWorldUnitLength is only suitable for Pcbnew.
    // Other editors/viewer must call SetWorldUnitLength with their internal units
    this.SetWorldUnitLength(1e-9 /* 1 nm */ / 0.0254 /* 1 inch in meters */);
    // wxDC::GetPPI() reports 96 DPI, but somehow this value
    // is the closest match to the legacy renderer
    this.SetScreenDPI(ADVANCED_CFG.GetCfg().m_ScreenDPI);
    this.SetDepthRange({ x: GAL.MIN_DEPTH, y: GAL.MAX_DEPTH });
    this.SetLayerDepth(0.0);
    this.SetFlip(false, false);
    this.SetLineWidth(1.0);
    this.SetMinLineWidth(1.0);
    this.computeWorldScale();
    this.SetAxesEnabled(false);

    // Set grid defaults
    this.SetGridVisibility(true);
    this.SetCoarseGrid(10);
    this.m_gridLineWidth = 0.5;
    this.m_gridStyle = GRID_STYLE.LINES;
    this.m_gridMinSpacing = 10;

    // Initialize the cursor shape
    this.SetCursorColor(COLOR4D(1.0, 1.0, 1.0, 1.0));
    this.m_crossHairMode = CROSS_HAIR_MODE.SMALL_CROSS;
    this.m_forceDisplayCursor = false;
    this.SetCursorEnabled(false);

    // Initialize the native widget to an arrow cursor
    this.SetNativeCursorStyle(KICURSOR.ARROW, false);

    // Initialize text properties
    this.ResetTextAttributes();

    // subscribe for settings updates
    this.m_observerLink = this.m_options.Subscribe(this);
  }

  /// Return the initialization status for the canvas.
  IsInitialized(): boolean {
    return true;
  }

  /// Return true if the GAL canvas is visible on the screen.
  IsVisible(): boolean {
    return true;
  }

  /// Return true if the GAL engine is a Cairo based type.
  IsCairoEngine(): boolean {
    return false;
  }

  /// Return true if the GAL engine is a OpenGL based type.
  IsOpenGlEngine(): boolean {
    return false;
  }

  // ---------------
  // Drawing methods
  // ---------------

  /**
   * Draw a line.
   *
   * Start and end points are defined as 2D-Vectors.
   *
   * @param aStartPoint   is the start point of the line.
   * @param aEndPoint     is the end point of the line.
   */
  DrawLine(aStartPoint: Vec2, aEndPoint: Vec2): void {}

  /**
   * Draw a rounded segment.
   *
   * Start and end points are defined as 2D-Vectors.
   *
   * @param aStartPoint   is the start point of the segment.
   * @param aEndPoint     is the end point of the segment.
   * @param aWidth        is a width of the segment
   */
  DrawSegment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number): void {}

  /**
   * Draw a chain of rounded segments.
   *
   * @param aPointList is a list of 2D-Vectors containing the chain points.
   * @param aWidth     is a width of the segments
   */
  DrawSegmentChain(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN, aWidth: number): void {}

  /**
   * Draw a polyline
   *
   * @param aPointList is a list of 2D-Vectors containing the polyline points.
   */
  DrawPolyline(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void {}

  /**
   * Draw multiple polylines
   *
   * @param aPointLists are lists of 2D-Vectors containing the polyline points.
   */
  DrawPolylines(aPointLists: readonly (readonly Vec2[])[]): void {}

  /**
   * Draw a circle using world coordinates.
   *
   * @param aCenterPoint is the center point of the circle.
   * @param aRadius is the radius of the circle.
   */
  DrawCircle(aCenterPoint: Vec2, aRadius: number): void {}

  /**
   * Draw a hole wall (an annular ring) using world coordinates.
   *
   * @param aCenterPoint is the center point of the hole.
   * @param aHoleRadius is the radius of the hole.
   * @param aWallWidth is the width of the wall.
   */
  DrawHoleWall(aCenterPoint: Vec2, aHoleRadius: number, aWallWidth: number): void {}

  /**
   * Draw an arc.
   *
   * @param aCenterPoint  is the center point of the arc.
   * @param aRadius       is the arc radius.
   * @param aStartAngle   is the start angle of the arc.
   * @param aAngle        is the angle of the arc.
   */
  DrawArc(aCenterPoint: Vec2, aRadius: number, aStartAngle: EDA_ANGLE, aAngle: EDA_ANGLE): void {}

  /**
   * Draw an arc segment.
   *
   * This method differs from DrawArc() in what happens when fill/stroke are on or off.
   * DrawArc() draws a "pie piece" when fill is turned on, and a thick stroke when fill is off.
   * DrawArcSegment() with fill *on* behaves like DrawArc() with fill *off*.
   * DrawArcSegment() with fill *off* draws the outline of what it would have drawn with fill on.
   *
   * TODO: Unify Arc routines
   *
   * @param aCenterPoint  is the center point of the arc.
   * @param aRadius       is the arc radius.
   * @param aStartAngle   is the start angle of the arc.
   * @param aAngle        is the angle of the arc.
   * @param aWidth        is the thickness of the arc (pen size).
   * @param aMaxError     is the max allowed error to create segments to approximate a circle.
   *  It has meaning only for back ends that can't draw a true arc, and use segments to approximate.
   */
  DrawArcSegment(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aWidth: number,
    aMaxError: number,
  ): void {}

  /**
   * Draw a rectangle.
   *
   * @param aStartPoint   is the start point of the rectangle.
   * @param aEndPoint     is the end point of the rectangle.
   */
  DrawRectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {}

  /** `DrawRectangle( const BOX2I& )`. */
  DrawRectangleBox(aRect: BOX2I): void {
    this.DrawRectangle(aRect.GetOrigin(), aRect.GetEnd());
  }

  /**
   * Draw a text glyph.
   */
  DrawGlyph(aGlyph: GLYPH_LIKE, aNth = 0, aTotal = 1): void {}

  /**
   * Draw a set of text glyphs.
   */
  DrawGlyphs(aGlyphs: readonly GLYPH_LIKE[]): void {
    const fillColor = this.GetFillColor();
    const strokeColor = this.GetStrokeColor();

    for (let i = 0; i < aGlyphs.length; i++) {
      if (aGlyphs[i]!.IsHover()) {
        this.SetFillColor(this.m_hoverColor);
        this.SetStrokeColor(this.m_hoverColor);
      }

      this.DrawGlyph(aGlyphs[i]!, i, aGlyphs.length);

      if (aGlyphs[i]!.IsHover()) {
        this.SetFillColor(fillColor);
        this.SetStrokeColor(strokeColor);
      }
    }
  }

  /**
   * Draw a polygon.
   *
   * @param aPointList is the list of the polygon points.
   */
  DrawPolygon(aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN): void;
  DrawPolygon(aPolySet: SHAPE_POLY_SET, aStrokeTriangulation?: boolean): void;
  DrawPolygon(
    aPointList: readonly Vec2[] | SHAPE_LINE_CHAIN | SHAPE_POLY_SET,
    aStrokeTriangulation = false,
  ): void {}

  /**
   * Draw a cubic bezier spline.
   *
   * @param startPoint    is the start point of the spline.
   * @param controlPointA is the first control point.
   * @param controlPointB is the second control point.
   * @param endPoint      is the end point of the spline.
   * @param aFilterValue  is used by Bezier to segments approximation, if
   * the Bezier curve is not supported and therefore converted to a polyline.
   */
  DrawCurve(
    startPoint: Vec2,
    controlPointA: Vec2,
    controlPointB: Vec2,
    endPoint: Vec2,
    aFilterValue = 0.0,
  ): void {}

  /**
   * Draw a bitmap image.
   */
  DrawBitmap(aBitmap: BITMAP_BASE, alphaBlend = 1.0): void {}

  // --------------
  // Screen methods
  // --------------

  /// Resize the canvas.
  ResizeScreen(aWidth: number, aHeight: number): void {}

  /// Show/hide the GAL canvas
  Show(aShow: boolean): boolean {
    return true;
  }

  /// Return GAL canvas size in pixels
  GetScreenPixelSize(): VECTOR2I {
    return this.m_screenSize;
  }

  /// Return the swap interval. -1 for adaptive, 0 for disabled/unknown
  GetSwapInterval(): number {
    return 0;
  }

  /// Force all remaining objects to be drawn.
  Flush(): void {}

  SetClearColor(aColor: Color4d): void {
    this.m_clearColor = aColor;
  }

  GetClearColor(): Color4d {
    return this.m_clearColor;
  }

  /**
   * Clear the screen.
   *
   * @param aColor is the color used for clearing.
   */
  ClearScreen(): void {}

  // -----------------
  // Attribute setting
  // -----------------

  /**
   * Enable/disable fill.
   *
   * @param aIsFillEnabled is true, when the graphics objects should be filled, else false.
   */
  SetIsFill(aIsFillEnabled: boolean): void {
    this.m_isFillEnabled = aIsFillEnabled;
  }

  GetIsFill(): boolean {
    return this.m_isFillEnabled;
  }

  /**
   * Enable/disable stroked outlines.
   *
   * @param aIsStrokeEnabled is true, if the outline of an object should be stroked.
   */
  SetIsStroke(aIsStrokeEnabled: boolean): void {
    this.m_isStrokeEnabled = aIsStrokeEnabled;
  }

  GetIsStroke(): boolean {
    return this.m_isStrokeEnabled;
  }

  /**
   * Set the fill color.
   *
   * @param aColor is the color for filling.
   */
  SetFillColor(aColor: Color4d): void {
    this.m_fillColor = aColor;
  }

  /**
   * Get the fill color.
   *
   * @return the color for filling a outline.
   */
  GetFillColor(): Color4d {
    return this.m_fillColor;
  }

  /**
   * Set the stroke color.
   *
   * @param aColor is the color for stroking the outline.
   */
  SetStrokeColor(aColor: Color4d): void {
    this.m_strokeColor = aColor;
  }

  SetHoverColor(aColor: Color4d): void {
    this.m_hoverColor = aColor;
  }

  /**
   * Get the stroke color.
   *
   * @return the color for stroking the outline.
   */
  GetStrokeColor(): Color4d {
    return this.m_strokeColor;
  }

  /**
   * Set the line width.
   *
   * @param aLineWidth is the line width.
   */
  SetLineWidth(aLineWidth: number): void {
    this.m_lineWidth = Math.fround(aLineWidth); // a `float`
  }

  /**
   * Set the minimum line width in pixels.
   */
  SetMinLineWidth(aLineWidth: number): void {
    this.m_minLineWidth = Math.fround(aLineWidth);
  }

  /**
   * Get the line width.
   *
   * @return the actual line width.
   */
  GetLineWidth(): number {
    return this.m_lineWidth;
  }

  GetMinLineWidth(): number {
    return this.m_minLineWidth;
  }

  /**
   * Set the depth of the layer (position on the z-axis)
   *
   * @param aLayerDepth the layer depth for the objects.
   */
  SetLayerDepth(aLayerDepth: number): void {
    // wxCHECK_MSG( aLayerDepth <= m_depthRange.y, "SetLayerDepth: below minimum" )
    if (!(aLayerDepth <= this.m_depthRange.y)) return;
    // wxCHECK_MSG( aLayerDepth >= m_depthRange.x, "SetLayerDepth: above maximum" )
    if (!(aLayerDepth >= this.m_depthRange.x)) return;

    this.m_layerDepth = aLayerDepth;
  }

  AdvanceDepth(): void {
    this.SetLayerDepth(this.m_layerDepth - 0.1);
  }

  // ----
  // Text
  // ----

  /**
   * Draw a text using a bitmap font. It should be faster than StrokeText(),
   * but can be used only for non-Gerber elements.
   *
   * @param aText is the text to be drawn.
   * @param aPosition is the text position in world coordinates.
   * @param aAngle is the text rotation angle.
   */
  BitmapText(aText: string, aPosition: VECTOR2I, aAngle: EDA_ANGLE): void {
    const font = FONT.GetFont();

    if (aText === '') return;

    const attrs = this.m_attributes.clone();
    attrs.m_Angle = aAngle;
    attrs.m_Mirrored = this.m_globalFlipX; // Prevent text flipping when view is flipped

    // Bitmap font has different metrics than the stroke font so we compensate a bit before
    // stroking
    attrs.m_Size = {
      x: this.m_attributes.m_Size.x,
      y: Math.trunc(this.m_attributes.m_Size.y * 0.95),
    };
    attrs.m_StrokeWidth = Math.trunc(this.GetLineWidth() * 0.74);

    font.DrawAt(this, aText, aPosition, attrs, METRICS.Default());
  }

  /**
   * Reset text attributes to default styling.
   *
   * Normally, custom attributes will be set individually after this, otherwise you can use
   * SetTextAttributes()
   */
  ResetTextAttributes(): void {
    // Tiny but non-zero - this will always need setting
    // there is no built-in default
    this.SetGlyphSize({ x: 1, y: 1 });

    this.SetHorizontalJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
    this.SetVerticalJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

    this.SetFontBold(false);
    this.SetFontItalic(false);
    this.SetFontUnderlined(false);
    this.SetTextMirrored(false);
  }

  SetGlyphSize(aSize: VECTOR2I): void {
    this.m_attributes.m_Size = aSize;
  }
  GetGlyphSize(): VECTOR2I {
    return this.m_attributes.m_Size;
  }

  SetFontBold(aBold: boolean): void {
    this.m_attributes.m_Bold = aBold;
  }
  IsFontBold(): boolean {
    return this.m_attributes.m_Bold;
  }

  SetFontItalic(aItalic: boolean): void {
    this.m_attributes.m_Italic = aItalic;
  }
  IsFontItalic(): boolean {
    return this.m_attributes.m_Italic;
  }

  SetFontUnderlined(aUnderlined: boolean): void {
    this.m_attributes.m_Underlined = aUnderlined;
  }
  IsFontUnderlined(): boolean {
    return this.m_attributes.m_Underlined;
  }

  SetTextMirrored(aMirrored: boolean): void {
    this.m_attributes.m_Mirrored = aMirrored;
  }
  IsTextMirrored(): boolean {
    return this.m_attributes.m_Mirrored;
  }

  SetHorizontalJustify(aHorizontalJustify: GR_TEXT_H_ALIGN_T): void {
    this.m_attributes.m_Halign = aHorizontalJustify;
  }
  GetHorizontalJustify(): GR_TEXT_H_ALIGN_T {
    return this.m_attributes.m_Halign;
  }

  SetVerticalJustify(aVerticalJustify: GR_TEXT_V_ALIGN_T): void {
    this.m_attributes.m_Valign = aVerticalJustify;
  }
  GetVerticalJustify(): GR_TEXT_V_ALIGN_T {
    return this.m_attributes.m_Valign;
  }

  // --------------
  // Transformation
  // --------------

  /**
   * Transform the context.
   *
   * @param aTransformation is the transformation matrix.
   */
  Transform(aTransformation: MATRIX3x3D): void {}

  /**
   * Rotate the context.
   *
   * @param aAngle is the rotation angle in radians.
   */
  Rotate(aAngle: number): void {}

  /**
   * Translate the context.
   *
   * @param aTranslation is the translation vector.
   */
  Translate(aTranslation: Vec2): void {}

  /**
   * Scale the context.
   *
   * @param aScale is the scale factor for the x- and y-axis.
   */
  Scale(aScale: Vec2): void {}

  /// Save the context.
  Save(): void {}

  /// Restore the context.
  Restore(): void {}

  // --------------------------------------------
  // Group methods
  // ---------------------------------------------

  /**
   * Begin a group.
   *
   * A group is a collection of graphic items.
   * Hierarchical groups are possible, attributes and transformations can be used.
   *
   * @return the number of the group.
   */
  BeginGroup(): number {
    return 0;
  }

  /// End the group.
  EndGroup(): void {}

  /**
   * Draw the stored group.
   *
   * @param aGroupNumber is the group number.
   */
  DrawGroup(aGroupNumber: number): void {}

  /**
   * Change the color used to draw the group.
   *
   * @param aGroupNumber is the group number.
   * @param aNewColor is the new color.
   */
  ChangeGroupColor(aGroupNumber: number, aNewColor: Color4d): void {}

  /**
   * Change the depth (Z-axis position) of the group.
   *
   * @param aGroupNumber is the group number.
   * @param aDepth is the new depth.
   */
  ChangeGroupDepth(aGroupNumber: number, aDepth: number): void {}

  /**
   * Delete the group from the memory.
   *
   * @param aGroupNumber is the group number.
   */
  DeleteGroup(aGroupNumber: number): void {}

  /**
   * Delete all data created during caching of graphic items.
   */
  ClearCache(): void {}

  // --------------------------------------------------------
  // Handling the world <-> screen transformation
  // --------------------------------------------------------

  /// Compute the world <-> screen transformation matrix
  ComputeWorldScreenMatrix(): void {
    this.computeWorldScale();

    const translation = new MATRIX3x3D();
    translation.SetIdentity();
    // We're deliberately dividing integers to avoid fractional pixel offsets.
    translation.SetTranslation({
      x: Math.trunc(this.m_screenSize.x / 2),
      y: Math.trunc(this.m_screenSize.y / 2),
    });

    const rotate = new MATRIX3x3D();
    rotate.SetIdentity();
    rotate.SetRotation(this.m_rotation);

    const scale = new MATRIX3x3D();
    scale.SetIdentity();
    scale.SetScale({ x: this.m_worldScale, y: this.m_worldScale });

    const flip = new MATRIX3x3D();
    flip.SetIdentity();
    flip.SetScale({ x: this.m_globalFlipX ? -1.0 : 1.0, y: this.m_globalFlipY ? -1.0 : 1.0 });

    const lookat = new MATRIX3x3D();
    lookat.SetIdentity();
    lookat.SetTranslation({ x: -this.m_lookAtPoint.x, y: -this.m_lookAtPoint.y });

    this.m_worldScreenMatrix = translation.mul(rotate).mul(flip).mul(scale).mul(lookat);
    this.m_screenWorldMatrix = this.m_worldScreenMatrix.Inverse();
  }

  /**
   * Get the world <-> screen transformation matrix.
   *
   * @return the transformation matrix.
   */
  GetWorldScreenMatrix(): MATRIX3x3D {
    return this.m_worldScreenMatrix;
  }

  /**
   * Get the screen <-> world transformation matrix.
   *
   * @return the transformation matrix.
   */
  GetScreenWorldMatrix(): MATRIX3x3D {
    return this.m_screenWorldMatrix;
  }

  /**
   * Set the world <-> screen transformation matrix.
   *
   * @param aMatrix is the 3x3 world <-> screen transformation matrix.
   */
  SetWorldScreenMatrix(aMatrix: MATRIX3x3D): void {
    this.m_worldScreenMatrix = aMatrix;
  }

  /**
   * @return the bounding box of the world that is displayed on screen at the moment
   */
  GetVisibleWorldExtents(): BOX2D {
    const matrix = this.GetScreenWorldMatrix();

    const halfSize: Vec2 = {
      x: matrix.GetScale().x * this.m_screenSize.x * 0.5,
      y: matrix.GetScale().y * this.m_screenSize.y * 0.5,
    };
    const extents = new BOX2D();
    extents.SetOrigin({
      x: this.GetLookAtPoint().x - halfSize.x,
      y: this.GetLookAtPoint().y - halfSize.y,
    });
    extents.SetSize({ x: halfSize.x * 2, y: halfSize.y * 2 });

    return extents;
  }

  /**
   * Set the unit length.
   *
   * This defines the length [inch] per one integer. For instance a value 0.001 means
   * that the coordinate [1000, 1000] corresponds with an offset [1 inch, 1 inch] or
   * 1 mil resolution per integer.
   *
   * @param aWorldUnitLength is the world Unit length.
   */
  SetWorldUnitLength(aWorldUnitLength: number): void {
    this.m_worldUnitLength = aWorldUnitLength;
  }

  SetScreenSize(aSize: VECTOR2I): void {
    this.m_screenSize = aSize;
  }

  /**
   * Set the dots per inch of the screen.
   *
   * This value depends on the user screen, it should be configurable by the application.
   * For instance a typical notebook with HD+ resolution (1600x900) has 106 DPI.
   *
   * @param aScreenDPI are the screen DPI.
   */
  SetScreenDPI(aScreenDPI: number): void {
    this.m_screenDPI = aScreenDPI;
  }

  GetScreenDPI(): number {
    return this.m_screenDPI;
  }

  /**
   * Set the Point in world space to look at.
   *
   * This point corresponds with the center of the actual drawing area.
   *
   * @param aPoint is the look at point (center of the actual drawing area).
   */
  SetLookAtPoint(aPoint: Vec2): void {
    this.m_lookAtPoint = aPoint;
  }

  /**
   * Get the look at point.
   *
   * @return the look at point.
   */
  GetLookAtPoint(): Vec2 {
    return this.m_lookAtPoint;
  }

  /**
   * Set the zoom factor of the scene.
   *
   * @param aZoomFactor is the zoom factor.
   */
  SetZoomFactor(aZoomFactor: number): void {
    this.m_zoomFactor = aZoomFactor;
  }

  /**
   * Get the zoom factor
   *
   * @return the zoom factor.
   */
  GetZoomFactor(): number {
    return this.m_zoomFactor;
  }

  /**
   * Set the rotation angle.
   *
   * @param aRotation is the new rotation angle (radians).
   */
  SetRotation(aRotation: number): void {
    this.m_rotation = aRotation;
  }

  /**
   * Get the rotation angle.
   *
   * @return The rotation angle (radians).
   */
  GetRotation(): number {
    return this.m_rotation;
  }

  /**
   * Set the range of the layer depth.
   *
   * Usually required for the OpenGL implementation, any object outside this range is not drawn.
   *
   * @param aDepthRange is the depth range where component x is the near clipping plane and y
   *                    is the far clipping plane.
   */
  SetDepthRange(aDepthRange: Vec2): void {
    this.m_depthRange = aDepthRange;
  }

  /**
   * Return the minimum depth in the currently used range (the top).
   */
  GetMinDepth(): number {
    return this.m_depthRange.x;
  }

  /**
   * Return the maximum depth in the currently used range (the bottom).
   */
  GetMaxDepth(): number {
    return this.m_depthRange.y;
  }

  /**
   * Get the world scale.
   *
   * @return the actual world scale factor.
   */
  GetWorldScale(): number {
    return this.m_worldScale;
  }

  /**
   * Sets flipping of the screen.
   *
   * @param xAxis is the flip flag for the X axis.
   * @param yAxis is the flip flag for the Y axis.
   */
  SetFlip(xAxis: boolean, yAxis: boolean): void {
    this.m_globalFlipX = xAxis;
    this.m_globalFlipY = yAxis;
  }

  /**
   * Return true if flip flag for the X axis is set.
   */
  IsFlippedX(): boolean {
    return this.m_globalFlipX;
  }

  /**
   * Return true if flip flag for the Y axis is set.
   */
  IsFlippedY(): boolean {
    return this.m_globalFlipY;
  }

  // ---------------------------
  // Buffer manipulation methods
  // ---------------------------

  /**
   * Set the target for rendering.
   *
   * @param aTarget is the new target for rendering.
   */
  SetTarget(aTarget: RENDER_TARGET): void {}

  /**
   * Get the currently used target for rendering.
   *
   * @return The current rendering target.
   */
  GetTarget(): RENDER_TARGET {
    return RENDER_TARGET.TARGET_CACHED;
  }

  /**
   * Clear the target for rendering.
   *
   * @param aTarget is the target to be cleared.
   */
  ClearTarget(aTarget: RENDER_TARGET): void {}

  /**
   * Return true if the target exists.
   *
   * @param aTarget is the target to be checked.
   */
  HasTarget(aTarget: RENDER_TARGET): boolean {
    return true;
  }

  /**
   * Set negative draw mode in the renderer.
   *
   * When negative mode is enabled, drawn items will subtract from
   * previously drawn items.  This is mainly needed for Gerber
   * negative item support in Cairo, since unlike in OpenGL, objects
   * drawn with zero opacity on top of other objects would not normally
   * affect the other objects.
   *
   * @param aSetting is true if negative mode should be enabled
   */
  SetNegativeDrawMode(aSetting: boolean): void {}

  /**
   * Begins rendering of a differential layer. Used by gerbview's differential mode.
   *
   * Differential layers are rendered on a separate surface and the composited
   * with the normal surface using an XOR operation.
   */
  StartDiffLayer(): void {}

  /**
   * Ends rendering of a differential layer. Used by gerbview's differential mode.
   */
  EndDiffLayer(): void {}

  /**
   * Begins rendering in a new layer that will be copied to the main
   * layer in EndNegativesLayer().
   *
   * For Cairo, layers with negative items need a new layer so when
   * negative layers are drawn, they clear only the current layer, not
   * the layers underneath.
   */
  StartNegativesLayer(): void {}

  /**
   * Ends rendering of a negatives layer and draws it to the main layer.
   */
  EndNegativesLayer(): void {}

  // -------------
  // Grid methods
  // -------------

  /**
   * Set the visibility setting of the grid.
   *
   * @param aVisibility is the new visibility setting of the grid.
   */
  SetGridVisibility(aVisibility: boolean): void {
    this.m_gridVisibility = aVisibility;
  }

  GetGridVisibility(): boolean {
    return this.m_gridVisibility;
  }

  GetGridSnapping(): boolean {
    return (
      this.m_options.m_gridSnapping === GRID_SNAPPING.ALWAYS ||
      (this.m_gridVisibility && this.m_options.m_gridSnapping === GRID_SNAPPING.WITH_GRID)
    );
  }

  /**
   * Set the origin point for the grid.
   *
   * @param aGridOrigin is a vector containing the grid origin point, in world coordinates.
   */
  SetGridOrigin(aGridOrigin: Vec2): void {
    this.m_gridOrigin = aGridOrigin;

    if (this.m_gridSize.x === 0.0 || this.m_gridSize.y === 0.0) {
      this.m_gridOffset = { x: 0.0, y: 0.0 };
    } else {
      // (long) m_gridOrigin.x % (long) m_gridSize.x
      this.m_gridOffset = {
        x: Math.trunc(this.m_gridOrigin.x) % Math.trunc(this.m_gridSize.x),
        y: Math.trunc(this.m_gridOrigin.y) % Math.trunc(this.m_gridSize.y),
      };
    }
  }

  GetGridOrigin(): Vec2 {
    return this.m_gridOrigin;
  }

  /**
   * Set the grid size.
   *
   * @param aGridSize is a vector containing the grid size in x and y direction.
   */
  SetGridSize(aGridSize: Vec2): void {
    // Avoid stupid grid size values: a grid size  should be >= 1 in internal units
    this.m_gridSize = { x: Math.max(1.0, aGridSize.x), y: Math.max(1.0, aGridSize.y) };

    this.m_gridOffset = {
      x: Math.trunc(this.m_gridOrigin.x) % Math.trunc(this.m_gridSize.x),
      y: Math.trunc(this.m_gridOrigin.y) % Math.trunc(this.m_gridSize.y),
    };
  }

  /**
   * Return the grid size.
   *
   * @return A vector containing the grid size in x and y direction.
   */
  GetGridSize(): Vec2 {
    return this.m_gridSize;
  }

  /**
   * Return the grid size after it has been scaled to be at least the minimum visible spacing.
   *
   * @return A vector containing the visible grid size in x and y direction.
   */
  GetVisibleGridSize(): Vec2 {
    let gridScreenSize: Vec2 = {
      x: Math.max(100.0, this.m_gridSize.x),
      y: Math.max(100.0, this.m_gridSize.y),
    };

    let gridThreshold = this.computeMinGridSpacing() / this.m_worldScale;

    if (this.m_gridStyle === GRID_STYLE.SMALL_CROSS) gridThreshold *= 2.0;

    // If we cannot display the grid density, scale down by a tick size and
    // try again.  Eventually, we get some representation of the grid
    while (Math.min(gridScreenSize.x, gridScreenSize.y) <= gridThreshold) {
      gridScreenSize = {
        x: gridScreenSize.x * this.m_gridTick,
        y: gridScreenSize.y * this.m_gridTick,
      };
    }

    return gridScreenSize;
  }

  /**
   * Set the grid color.
   *
   * @param aGridColor is the grid color, it should have a alpha value of 1.0.
   */
  SetGridColor(aGridColor: Color4d): void {
    this.m_gridColor = aGridColor;
  }

  /**
   * Set the axes color.
   *
   * @param aAxesColor is the color to draw the axes if enabled.
   */
  SetAxesColor(aAxesColor: Color4d): void {
    this.m_axesColor = aAxesColor;
  }

  /**
   * Enable drawing the axes.
   */
  SetAxesEnabled(aAxesEnabled: boolean): void {
    this.m_axesEnabled = aAxesEnabled;
  }

  /**
   * Draw every tick line wider.
   *
   * @param aInterval increase the width of every aInterval line, if 0 do not use this feature.
   */
  SetCoarseGrid(aInterval: number): void {
    this.m_gridTick = aInterval;
  }

  /**
   * Get the grid line width.
   *
   * @return the grid line width
   */
  GetGridLineWidth(): number {
    return this.m_gridLineWidth;
  }

  ///< Draw the grid
  DrawGrid(): void {}

  /**
   * For a given point it returns the nearest point belonging to the grid in world coordinates.
   *
   * @param aPoint is the point for which the grid point is searched.
   * @return The nearest grid point in world coordinates.
   */
  GetGridPoint(aPoint: Vec2): Vec2 {
    // if grid size == 0.0 there is no grid, so use aPoint as grid reference position
    const cx =
      this.m_gridSize.x > 0.0
        ? KiROUND((aPoint.x - this.m_gridOffset.x) / this.m_gridSize.x) * this.m_gridSize.x +
          this.m_gridOffset.x
        : aPoint.x;
    const cy =
      this.m_gridSize.y > 0.0
        ? KiROUND((aPoint.y - this.m_gridOffset.y) / this.m_gridSize.y) * this.m_gridSize.y +
          this.m_gridOffset.y
        : aPoint.y;

    return { x: cx, y: cy };
  }

  /**
   * Compute the point position in world coordinates from given screen coordinates.
   *
   * @param aPoint the point position in screen coordinates.
   * @return the point position in world coordinates.
   */
  ToWorld(aPoint: Vec2): Vec2 {
    return this.m_screenWorldMatrix.mulVec2(aPoint);
  }

  /**
   * Compute the point position in screen coordinates from given world coordinates.
   *
   * @param aPoint the point position in world coordinates.
   * @return the point position in screen coordinates.
   */
  ToScreen(aPoint: Vec2): Vec2 {
    return this.m_worldScreenMatrix.mulVec2(aPoint);
  }

  /**
   * Set the cursor in the native panel.
   *
   * @param aCursor is the cursor to use in the native panel
   * @param aHiDPI is true if the cursor should be scaled for high-DPI screens
   * @return true if the cursor was updated, false if the cursor given was already set
   */
  SetNativeCursorStyle(aCursor: KICURSOR, aHiDPI: boolean): boolean {
    if (this.m_currentNativeCursor === aCursor) return false;

    this.m_currentNativeCursor = aCursor;

    return true;
  }

  /**
   * Enable/disable cursor.
   *
   * @param aCursorEnabled is true if the cursor should be drawn, else false.
   */
  SetCursorEnabled(aCursorEnabled: boolean): void {
    this.m_isCursorEnabled = aCursorEnabled;
  }

  /**
   * Return information about cursor visibility.
   *
   * @return True if cursor is visible.
   */
  IsCursorEnabled(): boolean {
    return this.m_isCursorEnabled || this.m_forceDisplayCursor;
  }

  /**
   * Set the cursor color.
   *
   * @param aCursorColor is the color of the cursor.
   */
  SetCursorColor(aCursorColor: Color4d): void {
    this.m_cursorColor = aCursorColor;
  }

  /**
   * Draw the cursor.
   *
   * @param aCursorPosition is the cursor position in screen coordinates.
   */
  DrawCursor(aCursorPosition: Vec2): void {}

  EnableDepthTest(aEnabled = false): void {}

  /**
   * Checks the state of the context lock
   * @return True if the context is currently locked
   */
  IsContextLocked(): boolean {
    return false;
  }

  /// Use GAL_CONTEXT_LOCKER RAII object unless you know what you're doing.
  LockContext(aClientCookie: number): void {}

  UnlockContext(aClientCookie: number): void {}

  /// Start/end drawing functions, draw calls can be only made in between the calls
  /// to BeginDrawing()/EndDrawing(). Normally you should create a GAL_DRAWING_CONTEXT RAII
  /// object, but I'm leaving these functions public for more precise (i.e. timing/profiling)
  /// control of the drawing process - Tom

  /// Begin the drawing, needs to be called for every new frame.
  /// Use GAL_DRAWING_CONTEXT RAII object unless you know what you're doing.
  BeginDrawing(): void {}

  /// End the drawing, needs to be called for every new frame.
  /// Use GAL_DRAWING_CONTEXT RAII object unless you know what you're doing.
  EndDrawing(): void {}

  /// Enable item update mode.
  /// Private: use GAL_UPDATE_CONTEXT RAII object
  /** `friend class GAL_UPDATE_CONTEXT`: not callable from outside the RAII helper in the C++. */
  beginUpdate(): void {}

  /// Disable item update mode.
  endUpdate(): void {}

  /// Compute the scaling factor for the world->screen matrix
  protected computeWorldScale(): void {
    this.m_worldScale = this.m_screenDPI * this.m_worldUnitLength * this.m_zoomFactor;

    const pgm = PgmOrNull();

    if (pgm?.GetCommonSettings())
      this.m_worldScale *= pgm.GetCommonSettings()!.m_Appearance.zoom_correction_factor;
  }

  /**
   * compute minimum grid spacing from the grid settings
   *
   * @return the minimum spacing to use for drawing the grid
   */
  protected computeMinGridSpacing(): number {
    // just return the current value. This could be cleverer and take
    // into account other settings in future
    return this.m_gridMinSpacing;
  }

  // MIN_DEPTH must be set to be - (VIEW::VIEW_MAX_LAYERS + abs(VIEW::TOP_LAYER_MODIFIER))
  // MAX_DEPTH must be set to be VIEW::VIEW_MAX_LAYERS + abs(VIEW::TOP_LAYER_MODIFIER) -1
  // VIEW_MAX_LAYERS and TOP_LAYER_MODIFIER are defined in view.h.
  // TOP_LAYER_MODIFIER is set as -VIEW_MAX_LAYERS
  // Currently KIGFX::VIEW::VIEW_MAX_LAYERS = MAX_LAYERS_FOR_VIEW
  /// Possible depth range
  static readonly MIN_DEPTH = -2 * MAX_LAYERS_FOR_VIEW;
  static readonly MAX_DEPTH = 2 * MAX_LAYERS_FOR_VIEW - 1;

  /// Depth level on which the grid is drawn
  static readonly GRID_DEPTH = GAL.MAX_DEPTH - 1;

  /**
   * Get the actual cursor color to draw
   */
  protected getCursorColor(): Color4d {
    const color = { ...this.m_cursorColor };

    // dim the cursor if it's only on because it was forced
    // (this helps to provide a hint for active tools)
    if (!this.m_isCursorEnabled) color.a = color.a * 0.5;

    return color;
  }

  // ---------------
  // Settings observer interface
  // ---------------

  /**
   * Handler for observer settings changes.
   */
  OnGalDisplayOptionsChanged(aOptions: GAL_DISPLAY_OPTIONS): void {
    // defer to the child class first
    this.updatedGalDisplayOptions(aOptions);

    // there is no refresh to do at this level
  }

  /**
   * Handle updating display options.
   *
   * Derived classes should call up to this to set base-class methods.
   *
   * @return true if the new settings changed something. Derived classes can use this
   *         information to refresh themselves
   */
  protected updatedGalDisplayOptions(aOptions: GAL_DISPLAY_OPTIONS): boolean {
    let refresh = false;

    if (this.m_options.m_gridStyle !== this.m_gridStyle) {
      this.m_gridStyle = this.m_options.m_gridStyle;
      refresh = true;
    }

    if (this.m_options.m_gridLineWidth !== this.m_gridLineWidth) {
      this.m_gridLineWidth = Math.fround(
        this.m_options.m_scaleFactor * this.m_options.m_gridLineWidth + 0.25,
      );
      refresh = true;
    }

    if (this.m_options.m_gridMinSpacing !== this.m_gridMinSpacing) {
      this.m_gridMinSpacing = this.m_options.m_gridMinSpacing;
      refresh = true;
    }

    if (this.m_options.m_axesEnabled !== this.m_axesEnabled) {
      this.m_axesEnabled = this.m_options.m_axesEnabled;
      refresh = true;
    }

    if (this.m_options.m_forceDisplayCursor !== this.m_forceDisplayCursor) {
      this.m_forceDisplayCursor = this.m_options.m_forceDisplayCursor;
      refresh = true;
    }

    if (this.m_options.GetCursorMode() !== this.m_crossHairMode) {
      this.m_crossHairMode = this.m_options.GetCursorMode();
      refresh = true;
    }

    // tell the derived class if the base class needs an update or not
    return refresh;
  }

  /** `friend class GAL_SCOPED_ATTRS`. */
  getLayerDepth(): number {
    return this.m_layerDepth;
  }
}

/**
 * The RAII helpers below are scopes in the C++; a callback stands for the
 * scope's body, and the destructor runs after it (also when it throws).
 */
export function GAL_CONTEXT_LOCKER<T>(aGal: GAL, aBody: () => T): T {
  const cookie = Math.floor(Math.random() * 2147483647); // rand()
  aGal.LockContext(cookie);
  try {
    return aBody();
  } finally {
    aGal.UnlockContext(cookie);
  }
}

export function GAL_UPDATE_CONTEXT<T>(aGal: GAL, aBody: () => T): T {
  return GAL_CONTEXT_LOCKER(aGal, () => {
    aGal.beginUpdate();
    try {
      return aBody();
    } finally {
      aGal.endUpdate();
    }
  });
}

export function GAL_DRAWING_CONTEXT<T>(aGal: GAL, aBody: () => T): T {
  return GAL_CONTEXT_LOCKER(aGal, () => {
    aGal.BeginDrawing();
    try {
      return aBody();
    } finally {
      aGal.EndDrawing();
    }
  });
}

/**
 * Attribute save/restore.
 *
 * This class is used to save the current GAL state and restore it when the object goes out
 * of scope: the flags say which attributes are restored.
 */
export enum GAL_SCOPED_ATTRS_FLAGS {
  STROKE_WIDTH = 1,
  STROKE_COLOR = 2,
  IS_STROKE = 4,
  FILL_COLOR = 8,
  IS_FILL = 16,
  LAYER_DEPTH = 32,

  // It is not clear to me that GAL needs to save text attributes.
  // Only BitmapText uses it, and maybe that should be passed in
  // explicitly (like for Draw) - every caller of BitmapText sets
  // the text attributes anyway.
  // TEXT_ATTRS = 64,

  // Convenience flags
  STROKE = STROKE_WIDTH | STROKE_COLOR | IS_STROKE,
  FILL = FILL_COLOR | IS_FILL,
  STROKE_FILL = STROKE | FILL,
  ALL_ATTRS = STROKE | FILL | LAYER_DEPTH,
}

export function GAL_SCOPED_ATTRS<T>(aGal: GAL, aFlags: number, aBody: () => T): T {
  // Save what we need to restore later.
  // These are all so cheap to copy, it's likely not worth if'ing
  const strokeWidth = aGal.GetLineWidth();
  const strokeColor = aGal.GetStrokeColor();
  const isStroke = aGal.GetIsStroke();
  const fillColor = aGal.GetFillColor();
  const isFill = aGal.GetIsFill();
  const layerDepth = aGal.getLayerDepth();

  try {
    return aBody();
  } finally {
    // Restore the attributes that were saved
    // based on the flags that were set.
    if (aFlags & GAL_SCOPED_ATTRS_FLAGS.STROKE_WIDTH) aGal.SetLineWidth(strokeWidth);
    if (aFlags & GAL_SCOPED_ATTRS_FLAGS.STROKE_COLOR) aGal.SetStrokeColor(strokeColor);
    if (aFlags & GAL_SCOPED_ATTRS_FLAGS.IS_STROKE) aGal.SetIsStroke(isStroke);
    if (aFlags & GAL_SCOPED_ATTRS_FLAGS.FILL_COLOR) aGal.SetFillColor(fillColor);
    if (aFlags & GAL_SCOPED_ATTRS_FLAGS.IS_FILL) aGal.SetIsFill(isFill);
    if (aFlags & GAL_SCOPED_ATTRS_FLAGS.LAYER_DEPTH) aGal.SetLayerDepth(layerDepth);
  }
}
