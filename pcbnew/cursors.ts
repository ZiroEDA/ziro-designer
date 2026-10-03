// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which cursor the board editor's canvas shows, as a function rather than a
 * ternary buried in the JSX — the shape `editors/schematic/cursors.ts` already
 * had, and the reason it is worth copying: a decision inside a component can
 * only be checked by rendering it, so in practice it was not checked at all.
 * The board editor lost the delete tool's eraser that way.
 */
import { kiCursor } from '@ziroeda/common/gal/kicursors.js';
import { toolCursorCss } from '@ziroeda/common/tool/tool_cursors.js';

/**
 * `ui/tool_cursors.ts` answers for every action another editor also has; what
 * is left here is this frame's own.
 *
 * `BOARD_INSPECTION_TOOL::LocalRatsnestTool` is a picker with
 * `picker->SetCursor( KICURSOR::BULLSEYE )` (`board_inspection_tool.cpp:2296`).
 * It is this frame's own — the footprint editor has no ratsnest — which is
 * why it is answered here and not in the shared table. Ours said "sets no
 * cursor of its own" and showed a crosshair; that was a misreading of the
 * source, not a measurement. Everything unarmed is the plain arrow.
 */
export const boardToolCursor = (tool: string): string => {
  if (tool === 'localRatsnestTool') return kiCursor('BULLSEYE');
  // `BOARD_EDITOR_CONTROL::PlaceFootprint`'s `setCursor` is one unconditional
  // line, `SetCurrentCursor( KICURSOR::PENCIL )` (board_editor_control.cpp:1370),
  // before and while a footprint rides the pointer alike. This frame's own:
  // the footprint editor has no such tool.
  if (tool === 'placeFootprint') return kiCursor('PENCIL');
  // `ROUTER_TOOL::MainLoop`'s `setCursor` (router_tool.cpp:1950-1953) is one
  // line, `SetCurrentCursor( KICURSOR::PENCIL )`, run on arming and on every
  // event — idle and mid-route alike, single track and differential pair
  // alike (both are this loop with a different PNS::ROUTER_MODE).
  // `finishInteractive`'s ARROW (:1465) lasts until the loop's next event.
  // Ours showed the plain arrow.
  if (tool === 'routeSingleTrack' || tool === 'routeDiffPair') return kiCursor('PENCIL');
  return toolCursorCss(tool, 'default');
};
