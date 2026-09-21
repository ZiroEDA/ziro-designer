// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZOOM_TOOL` (`common/tool/zoom_tool.cpp`) — the drag-a-rectangle zoom behind
 * `ACTIONS::zoomTool`, the "Zoom to Selection Area" button.
 *
 * This is a shared module for the reason the upstream file is in `common/`:
 * it is 174 lines that **ten** frames register, not a feature any one editor
 * owns. `eeschema/sch_edit_frame.cpp:691`, `pcbnew/pcb_edit_frame.cpp:950`,
 * `gerbview/gerbview_frame.cpp:1097`, the symbol and footprint editors and
 * viewers, `pl_editor_frame.cpp:292`, `cvpcb/display_footprints_frame.cpp:111`
 * and `footprint_chooser_frame.cpp:225` all do
 * `m_toolManager->RegisterTool( new ZOOM_TOOL )` and get exactly this.
 *
 * Only the geometry lives here. Arming the tool, drawing the rubber band and
 * capturing the pointer are per-canvas, because each of ours owns its own
 * transform; the arithmetic below is the part that must not be re-derived.
 */

/** A world-space point, matching the canvases' own `Vec2`. */
export interface ZoomAreaPoint {
  x: number;
  y: number;
}

/** The drag `ZOOM_TOOL::selectRegion` accumulates. */
export interface ZoomArea {
  /** `evt->DragOrigin()`. */
  a: ZoomAreaPoint;
  /** `evt->Position()`. */
  b: ZoomAreaPoint;
  /**
   * The drag was made with the RIGHT button, which zooms **out**.
   *
   * This is the half of the tool nobody knows about: upstream accepts
   * `IsDrag( BUT_LEFT ) || IsDrag( BUT_RIGHT )` throughout
   * (`zoom_tool.cpp:84,113`) and branches only at the very end —
   * `if( evt->IsMouseUp( BUT_LEFT ) ) scale = GetScale() / ratio; else
   * scale = GetScale() * ratio;` (`:150-153`). So a right-drag frames the same
   * rectangle and pushes it away by the same factor instead of pulling it in.
   */
  out: boolean;
}

/** The viewport, in the same world units as the area. */
export interface ZoomViewport {
  /** Current view scale, `view->GetScale()`. */
  scale: number;
  /** Canvas width in device pixels. */
  width: number;
  /** Canvas height in device pixels. */
  height: number;
}

/** What the view should become, or `null` when the drag changes nothing. */
export interface ZoomAreaResult {
  scale: number;
  /** `selectionBox.Centre()`, the point the view centres on. */
  centre: ZoomAreaPoint;
}

/**
 * `ZOOM_TOOL::selectRegion`'s tail (`common/tool/zoom_tool.cpp:134-160`):
 *
 *     VECTOR2D sSize = view->ToWorld( ToVECTOR2I( canvas->GetClientSize() ), false );
 *     VECTOR2D vSize = selectionBox.GetSize();
 *     double   ratio = std::max( fabs( vSize.x / sSize.x ), fabs( vSize.y / sSize.y ) );
 *
 *     if( evt->IsMouseUp( BUT_LEFT ) ) scale = view->GetScale() / ratio;
 *     else                             scale = view->GetScale() * ratio;
 *
 *     view->SetScale( scale );
 *     view->SetCenter( selectionBox.Centre() );
 *
 * Three details that are each easy to get wrong:
 *
 *  - `ratio` is the **larger** of the two axis ratios, not the smaller and not
 *    the area ratio. Taking the smaller would fit the tighter axis and crop the
 *    other; the max is what makes the whole rectangle land on screen.
 *  - `sSize` comes from `ToWorld( size, false )`. The `false` is
 *    `aAbsolute` — it converts a *vector*, so the view translation drops out
 *    and it is simply the device extent over the scale.
 *  - a zero-width or zero-height box returns before any of this and leaves the
 *    view alone (`:138-142`), which is what a click rather than a drag does.
 */
export function zoomAreaTarget(area: ZoomArea, view: ZoomViewport): ZoomAreaResult | null {
  const w = Math.abs(area.b.x - area.a.x);
  const h = Math.abs(area.b.y - area.a.y);

  // `if( selectionBox.GetWidth() == 0 || selectionBox.GetHeight() == 0 ) break;`
  if (w === 0 || h === 0) return null;
  if (!(view.scale > 0)) return null;

  const sw = view.width / view.scale;
  const sh = view.height / view.scale;
  const ratio = Math.max(Math.abs(w / sw), Math.abs(h / sh));
  if (!Number.isFinite(ratio) || ratio === 0) return null;

  return {
    scale: area.out ? view.scale * ratio : view.scale / ratio,
    centre: { x: (area.a.x + area.b.x) / 2, y: (area.a.y + area.b.y) / 2 },
  };
}

/**
 * `KIGFX::PREVIEW::SELECTION_AREA`'s dark-background colours
 * (`common/preview_items/selection_area.cpp:44-52`), which is the rubber band
 * `ZOOM_TOOL` puts on the view while the drag is live (`zoom_tool.cpp:106-107`).
 *
 * A default-constructed SELECTION_AREA is `INSIDE_RECTANGLE` with none of the
 * additive / subtractive / exclusive-or flags set, so it takes `normal` for the
 * fill and `outline_l2r` for the stroke (`:107-121`). COLOR4D components are
 * 0..1 floats; these are them at 255.
 */
// [data] COLOR4D( 0.3, 0.3, 0.7, 0.3 ), selection_area.cpp:46 — KiCad's own
// literal, not a theme value: GTK is never asked about a rubber band.
export const SELECTION_AREA_FILL = 'rgb(77 77 179 / 30%)';
// [data] COLOR4D( 1.0, 1.0, 0.4, 1.0 ), selection_area.cpp:51.
export const SELECTION_AREA_STROKE = 'rgb(255 255 102)';
