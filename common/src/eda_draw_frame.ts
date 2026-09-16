// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_FRAME` (include/eda_draw_frame.h, common/eda_draw_frame.cpp): the
 * base of every frame with a drawing canvas. Between it and EDA_BASE_FRAME the
 * C++ has KIWAY_PLAYER, the window-to-window messaging base, which has no
 * browser counterpart and is skipped. What is here is the part the model
 * layer reaches: the canvas accessor (the GAL panel is stage 5's, so it is
 * an interface the designer's canvas implements), the message panel hooks
 * and the item resolver — and, first, the grid snapping the frame owns.
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
import type { EdaIuScale, EdaUnits } from './eda_units.js';
import { EDA_BASE_FRAME } from './eda_base_frame.js';
import type { FRAME_T } from './frame_type.js';
import type { KIID } from './kiid.js';
import type { EDA_ITEM } from './eda_item.js';
import type { ORIGIN_TRANSFORMS } from './origin_transforms.js';
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

/**
 * `EDA_DRAW_PANEL_GAL` as the frame reaches it: the view it draws and the
 * two refresh calls. The panel is stage 5's; the designer's canvas provides
 * this until then.
 */
export interface EDA_DRAW_PANEL_GAL_LIKE {
  GetView(): DRAW_FRAME_VIEW_LIKE | null;
  Refresh(): void;
  ForceRefresh(): void;
}

/**
 * `KIGFX::VIEW` as the frames call it: add/remove/update/hide of items and
 * the colliding-items refresh. KIGFX::VIEW is stage 5's.
 */
export interface DRAW_FRAME_VIEW_LIKE {
  Add(aItem: EDA_ITEM, aDrawPriority?: number): void;
  Remove(aItem: EDA_ITEM): void;
  Update(aItem: EDA_ITEM, aUpdateFlags?: number): void;
  Hide(aItem: EDA_ITEM, aHide?: boolean, aHideOverlay?: boolean): void;
  HasItem(aItem: EDA_ITEM): boolean;
  IsDirty(): boolean;
}

export abstract class EDA_DRAW_FRAME extends EDA_BASE_FRAME {
  protected m_canvas: EDA_DRAW_PANEL_GAL_LIKE | null = null;

  constructor(aFrameType: FRAME_T, aIuScale: EdaIuScale, aUnits: EdaUnits) {
    super(aFrameType, aIuScale, aUnits);
  }

  /**
   * Return a pointer to GAL-based canvas of given EDA draw frame.
   */
  GetCanvas(): EDA_DRAW_PANEL_GAL_LIKE | null {
    return this.m_canvas;
  }

  SetCanvas(aPanel: EDA_DRAW_PANEL_GAL_LIKE | null): void {
    this.m_canvas = aPanel;
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
