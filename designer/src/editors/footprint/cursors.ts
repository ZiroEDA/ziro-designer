// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** Which cursor the footprint canvas shows. See `editors/pcb/cursors.ts`. */
import { toolCursorCss } from '../../ui/tool_cursors.js';

/**
 * The shared actions answer in `ui/tool_cursors.ts`; this frame's own fallback
 * is a crosshair for anything armed and the arrow for the selection tool.
 *
 * The same canvas serves CVPCB's DISPLAY_FOOTPRINTS_FRAME, which is why the
 * fallback is keyed on the selection tool rather than on a list of drawing
 * tools: the viewer arms none of them.
 */
export const footprintToolCursor = (tool: string): string =>
  toolCursorCss(tool, tool === 'selectSetRect' ? 'default' : 'crosshair');
