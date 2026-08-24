// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What an editor does with the path its Save As dialog handed back.
 *
 * Upstream this is three lines every `wxID_SAVEAS` writes out for itself:
 *
 *     filename = openFileDialog.GetPath();
 *     wxFileName fn( filename );
 *     if( fn.GetExt() != FILEEXT::DrawingSheetFileExtension )
 *         filename << wxT( "." ) << FILEEXT::DrawingSheetFileExtension;
 *
 * (pagelayout_editor/files.cpp:213-221; eeschema, pcbnew and the symbol editor
 * each have their own copy with their own extension.) The FULL path is what
 * carries on to `SaveDrawingSheetFile` and to `SetCurrentFileName`.
 *
 * Here it lived inline in `DrawingSheetEditor.tsx`, and it reduced the path to
 * its leaf before applying the extension — so the folder a person had just
 * picked was gone by the next line, and every sheet landed in the open project
 * whatever they clicked. A rule that lives in a `.tsx` cannot be run by a test
 * in this repo, only read as source text, which pins its spelling; a sweep that
 * deleted the directory from it passed.
 */

import { ensureFileExtension } from '@ziroeda/common/src/common.js';

/** `wxFileName::GetFullName()` — the name with its extension, no directory. */
export const leafOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? '';

/**
 * The chosen path with the document's extension applied to its NAME.
 *
 * `ensureFileExtension` is `EnsureFileExtension` (common/common.cpp:662-678),
 * which appends rather than replaces — "be careful not to destroy existing
 * after-dot-text that isn't actually a bad extension, such as Schematic_1.1",
 * says the comment there. It is given the leaf alone because a dot in a
 * DIRECTORY component is not an extension: `/lib.pretty/x` must not come out
 * `/lib.pretty.kicad_mod/x`.
 */
export function savePathWithExtension(path: string, ext: string): string {
  const leaf = leafOf(path);
  return `${path.slice(0, path.length - leaf.length)}${ensureFileExtension(leaf, ext)}`;
}
