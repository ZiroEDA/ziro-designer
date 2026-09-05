// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the GerbView canvas shows for each tool.
 *
 * The same shape as `editors/pcb/cursors.ts` and its two siblings, and here
 * for the same reason: a ternary in the canvas is a fifth private copy of an
 * answer that belongs to the action.
 *
 * GerbView spells two shared tools differently — `zoom` and `measure`, where
 * every other frame says `zoomTool` and `measureTool` — so the shared table
 * carries both spellings, exactly as it already carries three for the one
 * delete action. Upstream there is one `ACTIONS::zoomTool` and one
 * `ACTIONS::measureTool`; the aliases are ours.
 */
import { toolCursorCss } from '../../ui/tool_cursors.js';

/**
 * GerbView's canvas falls back to the plain arrow for its own tools, as the
 * board editor does — `GERBVIEW_FRAME` has no drawing tools to want a pencil.
 */
export const gerberToolCursor = (tool: string): string => toolCursorCss(tool, 'default');
