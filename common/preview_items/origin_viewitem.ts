// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::ORIGIN_VIEWITEM` — the origin marker, once, for everything that puts
 * one up.
 *
 * KiCad has exactly one of these (`common/origin_viewitem.cpp`, declared in
 * `include/origin_viewitem.h`) and five callers instantiate it:
 *
 *   - `PCB_CONTROL::m_gridOrigin` — the board's grid origin, CIRCLE_X in the
 *     grid colour (`pcb_control.cpp:116`, `:130-146`);
 *   - `BOARD_EDITOR_CONTROL::m_placeOrigin` — the drill/place file origin,
 *     CIRCLE_CROSS in `COLOR4D( 0.8, 0, 0 )` (`board_editor_control.cpp:330`);
 *   - `GRID_HELPER::m_viewAxis` (CROSS) and `m_viewSnapPoint` (CIRCLE_CROSS),
 *     in both eeschema's and pcbnew's grid helpers;
 *   - `DIALOG_PAD_PROPERTIES::m_axisOrigin` — the preview canvas's axes, CROSS
 *     at a size of 100000 IU (`dialog_pad_properties.cpp:351`);
 *   - and `KIGFX::PREVIEW::SNAP_INDICATOR` derives from it.
 *
 * So it belongs here rather than in one editor: this is the module the
 * central-value rule means when it says "a base class every subclass
 * inherits" (see `CLAUDE.md`). pcbnew had a private copy that drew the
 * drill/place origin only, in one hardcoded style.
 *
 * **The size is in SCREEN pixels, not world units.** `ViewDraw` runs it
 * through `aView->ToWorld( VECTOR2D( m_size, m_size ), false )` — the vector
 * form, which divides by the world scale and applies no translation — so the
 * marker keeps its size at every zoom, the way a footprint anchor cross does.
 * That is why this painter works in device space and takes `toPx` rather than
 * being drawn under the world transform.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { galSnapPx } from '../gal_pixel_grid.js';

/** `ORIGIN_VIEWITEM::MARKER_STYLE` (`include/origin_viewitem.h:44-47`). */
export type OriginMarkerStyle = 'no_graphic' | 'cross' | 'circle_cross' | 'circle_x';

/** The constructor's `aSize = 16` default, in screen pixels. */
export const ORIGIN_VIEWITEM_SIZE = 16;

export interface OriginViewItemOptions {
  /**
   * `m_position`, in world units. The `m_drawAtZero` test is on *this*, not on
   * where it lands on screen, so it has to be the world point.
   */
  position: Vec2;
  /** World -> device pixels, the caller's view transform. */
  toPx(p: Vec2): Vec2;
  style: OriginMarkerStyle;
  /** `m_size`, in screen pixels. Defaults to {@link ORIGIN_VIEWITEM_SIZE}. */
  size?: number;
  /** `m_color`. The item carries no theme of its own; the caller answers. */
  color: string;
  /**
   * `m_drawAtZero`. False in both constructors, and left false by every caller
   * above — so a board that never set an auxiliary origin, which leaves it at
   * (0, 0), shows no marker at all rather than one sitting on the page corner.
   */
  drawAtZero?: boolean;
  /**
   * The pen. `SetLineWidth( 1 )` is one *internal unit*, i.e. nothing at any
   * sane zoom, so what actually reaches the screen is GAL's minimum pen — one
   * device pixel. Callers on a HiDPI canvas pass `max(1, dpr)`.
   */
  lineWidth?: number;
  /** Canvas extent in device px; the marker is skipped when it lands outside. */
  canvasWidth?: number;
  canvasHeight?: number;
}

/**
 * `ORIGIN_VIEWITEM::ViewDraw` (`common/origin_viewitem.cpp:70-105`).
 *
 *     if( !m_drawAtZero && ( m_position.x == 0 ) && ( m_position.y == 0 ) )
 *         return;
 *     …
 *     VECTOR2D scaledSize = aView->ToWorld( VECTOR2D( m_size, m_size ), false );
 *     if( m_style == CIRCLE_CROSS || m_style == CIRCLE_X )
 *         gal->DrawCircle( m_position, fabs( scaledSize.x ) );
 *     switch( m_style )
 *     {
 *     case NO_GRAPHIC: break;
 *     case CROSS: case CIRCLE_CROSS:
 *         gal->DrawLine( m_position - VECTOR2D( scaledSize.x, 0 ), … );
 *         gal->DrawLine( m_position - VECTOR2D( 0, scaledSize.y ), … );
 *         break;
 *     case CIRCLE_X:
 *         gal->DrawLine( m_position - scaledSize, m_position + scaledSize );
 *         scaledSize.y = -scaledSize.y;
 *         gal->DrawLine( m_position - scaledSize, m_position + scaledSize );
 *         break;
 *     }
 *
 * Note the circle is drawn *before* the switch and for two of the four styles,
 * so a CIRCLE_X is a ring with a diagonal cross through it whose arms reach
 * √2 · size — they poke out past the ring — while a CIRCLE_CROSS's arms are
 * axis-aligned and stop exactly on it. That asymmetry is upstream and it is
 * what tells the grid origin apart from the drill origin at a glance.
 */
export function drawOriginViewItem(
  ctx: CanvasRenderingContext2D,
  opts: OriginViewItemOptions,
): void {
  const { position, style, color } = opts;

  // Nothing to do if the target shouldn't be drawn at 0,0 and that's where the
  // target is.
  if (!opts.drawAtZero && position.x === 0 && position.y === 0) return;
  if (style === 'no_graphic') return;

  const size = opts.size ?? ORIGIN_VIEWITEM_SIZE;
  const pen = opts.lineWidth ?? 1;
  const p = opts.toPx(position);
  const x = galSnapPx(p.x, pen);
  const y = galSnapPx(p.y, pen);

  // `fabs( scaledSize.x )`: a mirrored view carries a negative scale and the
  // radius takes the magnitude. The arms do not — a CIRCLE_X on a flipped
  // board draws the same two diagonals either way, since they are symmetric.
  const r = Math.abs(size);

  if (opts.canvasWidth !== undefined && (x < -r || x > opts.canvasWidth + r)) return;
  if (opts.canvasHeight !== undefined && (y < -r || y > opts.canvasHeight + r)) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = pen;

  if (style === 'circle_cross' || style === 'circle_x') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  if (style === 'cross' || style === 'circle_cross') {
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
  } else {
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x - r, y + r);
    ctx.lineTo(x + r, y - r);
  }
  ctx.stroke();
}
