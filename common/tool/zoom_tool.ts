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
 * The class runs on the tool framework. The geometry functions above it are
 * the same arithmetic for the canvases that still own their own transform.
 */
import type { COROUTINE_BODY } from './coroutine.js';
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import { KICURSOR } from '../gal/cursors.js';
import { SELECTION_AREA } from '../preview_items/selection_area.js';
import type { VIEW_CONTROLS } from '../view/view_controls.js';
import { VIEW_UPDATE_FLAGS } from '../view/view_item.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { ACTIONS } from './actions.js';
import { RESET_REASON } from './tool_base.js';
import { BUT_LEFT, BUT_RIGHT, type TOOL_EVENT } from './tool_event.js';
import { TOOL_INTERACTIVE } from './tool_interactive.js';

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

// ---- the tool --------------------------------------------------------------

export class ZOOM_TOOL extends TOOL_INTERACTIVE {
  ///< Pointer to the currently used edit frame.
  private m_frame: EDA_DRAW_FRAME | null;

  constructor() {
    super('common.Control.zoomTool');
    this.m_frame = null;
  }

  /// @copydoc TOOL_INTERACTIVE::Init
  override Init(): boolean {
    // The context menu - cancelInteractive, a separator, then
    // AddStandardSubMenus - is a TOOL_MENU, which is not ported yet
    // (tool_interactive.ts); a right click passes through below.
    return true;
  }

  /// @copydoc TOOL_BASE::Reset
  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<EDA_DRAW_FRAME>();
  }

  /// Main loop
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;

    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ZOOM_IN);
    };

    // Set initial cursor
    setCursor();

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        break;
      } else if (evt.IsDrag(BUT_LEFT) || evt.IsDrag(BUT_RIGHT)) {
        if (yield* this.selectRegion()) break;
      } else if (evt.IsClick(BUT_RIGHT)) {
        // m_menu->ShowContextMenu( dummy ): TOOL_MENU is not ported yet.
      } else {
        evt.SetPassEvent();
      }
    }

    // Exit zoom tool
    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    frame.PopTool(aEvent);
    return 0;
  }

  /// Sets up handlers for various events.
  protected setTransitions(): void {
    this.Go(this.Main, ACTIONS.zoomTool.MakeEvent());
  }

  private *selectRegion(): COROUTINE_BODY<boolean> {
    let cancelled = false;
    const view = this.getView()!;
    const canvas = this.m_frame!.GetCanvas()!;
    const controls = this.getViewControls() as unknown as VIEW_CONTROLS;

    controls.SetAutoPan(true);

    const area = new SELECTION_AREA();
    view.Add(area);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      }

      if (evt.IsDrag(BUT_LEFT) || evt.IsDrag(BUT_RIGHT)) {
        area.SetOrigin(evt.DragOrigin());
        area.SetEnd(evt.Position());
        view.SetVisible(area, true);
        view.Update(area, VIEW_UPDATE_FLAGS.GEOMETRY);
      }

      if (evt.IsMouseUp(BUT_LEFT) || evt.IsMouseUp(BUT_RIGHT)) {
        view.SetVisible(area, false);
        const selectionBox = area.ViewBBox();

        if (selectionBox.GetWidth() === 0 || selectionBox.GetHeight() === 0) {
          break;
        } else {
          const client = canvas.GetClientSize();
          const sSize = view.ToWorld({ x: client.x, y: client.y }, false) as VECTOR2D;
          const vSize = selectionBox.GetSize();
          let scale: number;
          const ratio = Math.max(Math.abs(vSize.x / sSize.x), Math.abs(vSize.y / sSize.y));

          if (evt.IsMouseUp(BUT_LEFT)) scale = view.GetScale() / ratio;
          else scale = view.GetScale() * ratio;

          view.SetScale(scale);
          view.SetCenter(selectionBox.Centre());

          break;
        }
      }
    }

    view.SetVisible(area, false);
    view.Remove(area);
    controls.SetAutoPan(false);

    return cancelled;
  }
}
