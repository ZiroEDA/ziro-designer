// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_FRAME` (include/eda_draw_frame.h, common/eda_draw_frame.cpp): the
 * base of every frame with a drawing canvas. Between it and EDA_BASE_FRAME the
 * C++ has KIWAY_PLAYER, the window-to-window messaging base, which has no
 * browser counterpart and is skipped. What is here is the part the model
 * layer reaches: the canvas accessor, the colour settings, the message
 * panel hooks and the item resolver — and, first, the grid snapping the
 * frame owns.
 *
 * Grid snapping, `EDA_DRAW_FRAME::GetNearestGridPosition` /
 * `::GetNearestHalfGridPosition` (`common/eda_draw_frame.cpp:1073/1098`).
 *
 * Upstream reads the grid size and origin off the frame's GAL, so both live on
 * the *frame* — in `common/`, instantiated once and used by every editor. Ours
 * therefore belongs in a shared module too, parameterised by the grid rather
 * than duplicated per editor: the symbol editor already had a private copy
 * (`designer/src/editors/symbol/edits.ts`), and the schematic transform needs
 * exactly the same answer.
 *
 * The grid origin is a user setting that we do not model anywhere yet, so
 * `gridOrigin` defaults to zero, which makes both `fmod` offsets zero.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { EdaIuScale, EdaUnits } from './eda_units.js';
import { EDA_BASE_FRAME } from './eda_base_frame.js';
import type { FRAME_T } from './frame_type.js';
import type { KIID } from './kiid.js';
import type { EDA_ITEM } from './eda_item.js';
import type { ORIGIN_TRANSFORMS } from './origin_transforms.js';
import type { BASE_SCREEN } from './base_screen.js';
import { type EDA_DRAW_PANEL_GAL, GAL_TYPE } from './draw_panel_gal.js';
import { GAL_DISPLAY_OPTIONS } from './gal/gal_display_options.js';
import { DEFAULT_THEME, GetColorSettings } from './pgm_base.js';
import type { COLOR_SETTINGS } from './settings/color_settings.js';
import type { MSG_PANEL_ITEM } from './widgets/msgpanel.js';

/** `KiROUND`: round half *away from zero*, not half up as `Math.round` does. */
const kiRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/** `KiROUND( (p - offset) / size ) * size + offset` on one axis. */
const snapAxis = (v: number, size: number, origin: number): number => {
  const offset = origin % size;
  return kiRound((v - offset) / size) * size + offset;
};

/** `EDA_DRAW_FRAME::GetNearestGridPosition`: the nearest point on the grid. */
export function nearestGridPosition(
  p: Vec2,
  grid: number,
  gridOrigin: Vec2 = { x: 0, y: 0 },
): Vec2 {
  return {
    x: snapAxis(p.x, grid, gridOrigin.x),
    y: snapAxis(p.y, grid, gridOrigin.y),
  };
}

/**
 * `EDA_DRAW_FRAME::GetNearestHalfGridPosition`: the same, on a grid of half the
 * step. Rotate and mirror snap their centre with this one, so a two-item
 * selection whose midpoint falls between grid points still lands somewhere the
 * items' own endpoints can reach.
 */
export function nearestHalfGridPosition(
  p: Vec2,
  grid: number,
  gridOrigin: Vec2 = { x: 0, y: 0 },
): Vec2 {
  return nearestGridPosition(p, grid / 2, gridOrigin);
}

// The frame names (`eda_draw_frame.h:70-77`), which an item's message panel reads to know
// which editor it is describing itself for.
export const SCH_EDIT_FRAME_NAME = 'SchematicFrame';
export const SYMBOL_CHOOSER_FRAME_NAME = 'SymbolChooserFrame';
export const PL_EDITOR_FRAME_NAME = 'PlEditorFrame';
export const FOOTPRINT_WIZARD_FRAME_NAME = 'FootprintWizard';
export const FOOTPRINT_CHOOSER_FRAME_NAME = 'FootprintChooserFrame';
export const FOOTPRINT_EDIT_FRAME_NAME = 'ModEditFrame';
export const FOOTPRINT_VIEWER_FRAME_NAME = 'ModViewFrame';
export const PCB_EDIT_FRAME_NAME = 'PcbFrame';

export abstract class EDA_DRAW_FRAME extends EDA_BASE_FRAME {
  protected m_canvas: EDA_DRAW_PANEL_GAL | null = null;
  protected m_currentScreen: BASE_SCREEN | null = null; ///< current used SCREEN
  protected m_colorSettings: COLOR_SETTINGS | null = null;
  protected m_galDisplayOptions: GAL_DISPLAY_OPTIONS = new GAL_DISPLAY_OPTIONS();
  protected m_canvasType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL;

  constructor(aFrameType: FRAME_T, aIuScale: EdaIuScale, aUnits: EdaUnits) {
    super(aFrameType, aIuScale, aUnits);
  }

  /**
   * Return a pointer to GAL-based canvas of given EDA draw frame.
   */
  GetCanvas(): EDA_DRAW_PANEL_GAL | null {
    return this.m_canvas;
  }

  SetCanvas(aPanel: EDA_DRAW_PANEL_GAL | null): void {
    this.m_canvas = aPanel;
  }

  /**
   * `findDialogs()`: the DIALOG_SHIM children of the frame, as the screen
   * rectangles FocusOnLocation and FocusOnItems steer clear of. A window
   * without children answers none; the designer's frames list their open
   * modeless dialogs.
   */
  findDialogRects(): BOX2D[] {
    return [];
  }

  /**
   * `KIGFX::VIEW::SetCenter( aPos, dialogScreenRects )` as the window applies it.
   * The designer's editor still owns the view transform (its VIEW is synced
   * from it), so the frame lets it perform the centre; the base uses the VIEW.
   */
  protected setViewCenter(aPos: Vec2, aObscuringScreenRects: readonly BOX2D[]): void {
    this.GetCanvas()!.GetView().SetCenter(aPos, aObscuringScreenRects);
  }

  /**
   * Focus on a particular canvas location.
   *
   * The view will be centred on the location if it is not already in view, or
   * behind an obscuring dialog.
   */
  FocusOnLocation(aPos: Vec2, aAllowScroll = true): void {
    let centerView = false;
    const dialogScreenRects: BOX2D[] = [];

    if (aAllowScroll) {
      const r = this.GetCanvas()!.GetView().GetViewport();

      // Center if we're off the current view, or within 10% of its edge
      r.Inflate(-r.GetWidth() / 10.0);

      if (!r.Contains(aPos)) centerView = true;

      for (const dialog of this.findDialogRects()) dialogScreenRects.push(dialog);

      // Center if we're behind an obscuring dialog, or within 10% of its edge
      for (const rect of dialogScreenRects) {
        const inflated = new BOX2D(rect.GetOrigin(), rect.GetSize());
        inflated.Inflate(inflated.GetWidth() / 10);

        if (inflated.Contains(this.GetCanvas()!.GetView().ToScreen(aPos))) centerView = true;
      }
    }

    if (centerView) {
      try {
        this.setViewCenter(aPos, dialogScreenRects);
      } catch (e) {
        // wxFAIL_MSG( "Clipper2 exception occurred centering object" )
        console.error('Clipper2 exception occurred centering object:', e);
      }
    }

    this.GetCanvas()!.GetViewControls().SetCrossHairCursorPosition(aPos);
  }

  /**
   * Focus on a particular item.
   */
  FocusOnItem(_aItem: EDA_ITEM | null, _aAllowScroll = true): void {}

  ClearFocus(): void {
    this.FocusOnItem(null);
  }

  GetGalDisplayOptions(): GAL_DISPLAY_OPTIONS {
    return this.m_galDisplayOptions;
  }

  /**
   * `Kiway().Player( aFrameType, false )`: the sibling frame if it is open.
   * KIWAY is the desktop's window broker; the designer's frames answer with
   * theirs, and the base has no siblings.
   */
  KiwayPlayer(_aFrameType: FRAME_T): unknown {
    return null;
  }

  /** `wxWindow::Raise()`: bring the frame to the front. */
  Raise(): void {}

  /**
   * Use to start up the GAL drawing canvas.
   */
  ActivateGalCanvas(): void {
    // GetCanvas()->SetEvtHandlerEnabled( true );
    this.GetCanvas()!.StartDrawing();
  }

  /**
   * Change the current rendering backend.
   */
  SwitchCanvas(aCanvasType: GAL_TYPE): void {
    this.GetCanvas()!.SwitchBackend(aCanvasType);
    this.m_canvasType = this.GetCanvas()!.GetBackend();

    this.ActivateGalCanvas();
  }

  /**
   * Return a pointer to the active color theme settings.
   */
  GetColorSettings(aForceRefresh = false): COLOR_SETTINGS {
    if (!this.m_colorSettings || aForceRefresh) {
      const colorSettings = GetColorSettings(DEFAULT_THEME);
      this.m_colorSettings = colorSettings;
    }

    return this.m_colorSettings;
  }

  GetScreen(): BASE_SCREEN | null {
    return this.m_currentScreen;
  }

  SetScreen(aScreen: BASE_SCREEN | null): void {
    this.m_currentScreen = aScreen;
  }

  override GetToolCanvas(): unknown {
    return this.GetCanvas();
  }

  /**
   * Return the frame's name, for the message panel and cross-references.
   */
  abstract GetName(): string;

  /**
   * Return a reference to the default ORIGIN_TRANSFORMS object
   */
  abstract GetOriginTransforms(): ORIGIN_TRANSFORMS;

  /**
   * Fetch an item by KIID.  Frame-type-specific implementation.
   */
  ResolveItem(_aId: KIID, _aAllowNullptrReturn = false): EDA_ITEM | null {
    return null;
  }

  /**
   * Clear all messages from the message panel.
   */
  ClearMsgPanel(): void {}

  /**
   * Clear the message panel and populates it with the contents of \a aList.
   *
   * @param aList is the list of #MSG_PANEL_ITEM objects to fill the message panel.
   */
  SetMsgPanel(_aList: readonly MSG_PANEL_ITEM[]): void;
  SetMsgPanel(_aItem: EDA_ITEM): void;
  SetMsgPanel(_a: readonly MSG_PANEL_ITEM[] | EDA_ITEM): void {}

  /**
   * Redraw the message panel.
   */
  UpdateMsgPanel(): void {}
}
