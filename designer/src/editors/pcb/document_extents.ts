// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What "Zoom to Fit" measures in pcbnew. Counterpart:
 * `PCB_BASE_FRAME::GetBoardBoundingBox` / `PCB_BASE_FRAME::GetDocumentExtents`
 * (`pcbnew/pcb_base_frame.cpp:596-637`) and the box `COMMON_TOOLS::doZoomFit`
 * builds out of them (`common/tool/common_tools.cpp:325-370`).
 *
 * ## An empty board still has a box
 *
 * The piece we did not have. `GetBoardBoundingBox` ends with
 *
 * ```cpp
 * if( area.GetWidth() == 0 && area.GetHeight() == 0 )
 * {
 *     VECTOR2I pageSize = GetPageSizeIU();
 *
 *     if( m_showBorderAndTitleBlock )
 *     {
 *         area.SetOrigin( 0, 0 );
 *         area.SetEnd( pageSize.x, pageSize.y );
 *     }
 *     else
 *     {
 *         area.SetOrigin( -pageSize.x / 2, -pageSize.y / 2 );
 *         area.SetEnd( pageSize.x / 2, pageSize.y / 2 );
 *     }
 * }
 *                                             pcb_base_frame.cpp:598-614
 * ```
 *
 * so a board with no footprint, no track and no outline in it still hands
 * doZoomFit a rectangle — the PAGE — and Home frames the sheet. That is what
 * `ACTIONS::zoomFitScreen`'s own tooltip promises, "Zoom to worksheet area if
 * exists or edited object" (`common/tool/actions.cpp:727`), and its icon is
 * literally `BITMAPS::zoom_fit_in_page`.
 *
 * Ours bailed out on the null scene box (`if (!scene?.bbox) return;`) and did
 * nothing at all, so on a fresh board the button was dead. doZoomFit has a
 * second guard of the same shape one level up — `if( bBox.GetWidth() == 0 ||
 * bBox.GetHeight() == 0 ) bBox = defaultBox;` (`common_tools.cpp:344-345`) —
 * and note the operators differ: `&&` in the frame, `||` in the tool, so a box
 * that is wide but flat (one horizontal segment on an otherwise empty board)
 * survives the frame's test and is replaced by the tool's. Both are here.
 *
 * ## Known divergence: Home measures the board OUTLINE upstream
 *
 * `doZoomFit` re-fetches `GetDocumentExtents( false )` for `FRAME_PCB_EDITOR`
 * (`common_tools.cpp:333-337`), and with Edge.Cuts visible that resolves to
 * `GetBoardBoundingBox( true )` = `ComputeBoundingBox( true, true )`, the
 * Edge.Cuts graphics **only** (`pcb_base_frame.cpp:619-636`, `board.cpp`).
 * Ctrl+Home takes the default `aIncludeAllVisible = true` and so measures every
 * item. We have no Edge.Cuts-only bounding box in the engine yet, so Home here
 * still unions the item box with the page instead; the page fallback below is
 * reached on the same boards either way, which is the case this module fixes.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common';
import { fromPaperToken, pageSizeMM } from '../../dialogs/page_settings_model.js';

/** A `BOX2I` in pcbnew internal units (1 nm). */
export interface ExtentsBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `PCB_BASE_FRAME::GetPageSizeIU()` — `GetPageSettings().GetSizeIU(
 * pcbIUScale.IU_PER_MILS )` — for a stored `(paper …)` token.
 *
 * The token is split by the one splitter this tree has (`fromPaperToken`), so
 * `(paper "A4" portrait)` and `(paper "User" 431.8 279.4)` resolve the way the
 * Page Settings dialog resolves them rather than by a second reading of the
 * string. The table behind it is `PAGE_INFO::standardPageSizes` in
 * `common/src/page_info.ts`; there is no size table in this file on purpose.
 */
export function pcbPageSizeIU(paperToken: string): { x: number; y: number } {
  const [widthMM, heightMM] = pageSizeMM(fromPaperToken(paperToken));
  return { x: mmToIU(widthMM), y: mmToIU(heightMM) };
}

/**
 * The rectangle `GetBoardBoundingBox` substitutes for an empty board.
 *
 * `m_showBorderAndTitleBlock` decides where it sits: at the origin while the
 * drawing sheet is drawn — the board's (0,0) is the page's top-left corner —
 * and centred on the origin when it is not, because then there is no page on
 * screen for the box to line up with.
 */
export function pcbPageBox(paperToken: string, showBorderAndTitleBlock: boolean): ExtentsBox {
  const { x, y } = pcbPageSizeIU(paperToken);

  if (showBorderAndTitleBlock) return { minX: 0, minY: 0, maxX: x, maxY: y };

  // `-pageSize.x / 2` on a VECTOR2I is C++ integer division, which truncates
  // toward zero rather than flooring.
  const halfX = Math.trunc(x / 2);
  const halfY = Math.trunc(y / 2);
  return { minX: -halfX, minY: -halfY, maxX: halfX, maxY: halfY };
}

/** Whether a box would give doZoomFit a finite scale to work with. */
function isDegenerate(box: ExtentsBox): boolean {
  // doZoomFit's own test, `GetWidth() == 0 || GetHeight() == 0`.
  return box.maxX - box.minX === 0 || box.maxY - box.minY === 0;
}

/**
 * `BOARD::BOARD() : … m_paper( PAGE_SIZE_TYPE::A4 )` (`pcbnew/board.cpp:98`) —
 * a board that never wrote a `(paper …)` token still has a page, and it is A4.
 */
export const DEFAULT_BOARD_PAPER = 'A4';

export interface ZoomFitOptions {
  /** The board's `(paper …)` token; absent on a board that never wrote one. */
  paper: string | undefined;
  /** `m_showBorderAndTitleBlock` — the drawing sheet's own visibility. */
  drawingSheetVisible: boolean;
  /** True for `zoomFitScreen` (Home), false for `zoomFitObjects` (Ctrl+Home). */
  includeSheet: boolean;
}

/**
 * The box Zoom to Fit scales the view to, or null when there is nothing at all
 * to measure (a board with neither items nor a page).
 *
 * @param itemsBox the scene's bounding box over the board items, null when the
 *                 board is empty — `BOARD::ComputeBoundingBox`'s empty `BOX2I`.
 */
export function pcbZoomFitBox(
  itemsBox: ExtentsBox | null,
  opts: ZoomFitOptions,
): ExtentsBox | null {
  const page = pcbPageBox(opts.paper || DEFAULT_BOARD_PAPER, opts.drawingSheetVisible);

  let box = itemsBox;

  if (opts.includeSheet && opts.drawingSheetVisible) {
    box = box
      ? {
          minX: Math.min(box.minX, page.minX),
          minY: Math.min(box.minY, page.minY),
          maxX: Math.max(box.maxX, page.maxX),
          maxY: Math.max(box.maxY, page.maxY),
        }
      : page;
  }

  // GetBoardBoundingBox's fallback, then doZoomFit's. Both land on the page:
  // it is what PCB_DRAW_PANEL_GAL::GetDefaultViewBBox returns too, the drawing
  // sheet's ViewBBox while LAYER_DRAWINGSHEET is visible
  // (pcb_draw_panel_gal.cpp:822-828).
  if (!box || isDegenerate(box)) box = page;

  return isDegenerate(box) ? null : box;
}
