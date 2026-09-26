// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The package barrel: KiCad's `pagelayout_editor/`, file for file (see
 * STRUCTURE.md). Callers import a unit by its path; this lists the engine
 * modules, not the `_ui.tsx` screens.
 */
export * from './files.js';
export * from './pl_editor_frame.js';
export * from './pl_editor_settings.js';
export * from './pl_editor_undo_redo.js';
export * from './toolbars_pl_editor.js';
export * from './dialogs/design_inspector.js';
export * from './dialogs/dialogs_for_printing.js';
export * from './dialogs/properties_frame.js';
export * from './tools/pl_selection_tool.js';
