// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** Which cursor the symbol editor's canvas shows. See `editors/pcb/cursors.ts`. */
import { toolCursorCss } from '../../ui/tool_cursors.js';

/**
 * The symbol editor shares `ACTIONS::deleteTool` with eeschema — literally the
 * same `SCH_TOOL_BASE::InteractiveDelete` — so its eraser comes from the shared
 * table. What is left is this frame's own: the arrow for the selection tool, a
 * crosshair for anything else armed.
 */
export const symbolToolCursor = (tool: string): string =>
  toolCursorCss(tool, tool === 'select' ? 'default' : 'crosshair');
