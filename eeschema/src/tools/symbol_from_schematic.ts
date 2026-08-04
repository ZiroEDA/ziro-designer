// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Edit with Symbol Editor" (Ctrl+E). Counterpart:
 * `SYMBOL_EDIT_FRAME::LoadSymbolFromSchematic`, the half that turns a *placed*
 * symbol back into a library symbol the editor can open.
 *
 * The subtle part is the fields. A placement's fields are stored in schematic
 * space: they were rotated and mirrored along with the symbol, and their
 * positions are absolute. The symbol editor draws an unrotated, unmirrored
 * part, so each field has to be put back where it would sit on the library
 * symbol — relative to the symbol origin, with the placement transform undone.
 *
 * Upstream hand-rolls that inverse as a case analysis ("the inverse transform
 * is mirroring before, rotate after"). We invert the matrix instead, which is
 * the same answer and is the exact inverse of *our* forward transform by
 * construction rather than by agreement.
 *
 * Two things upstream does that we do not have to:
 *
 *  - **`Flatten()`.** Our reader already resolves `extends` when it builds the
 *    library index, so a derived symbol arrives flattened. Flattening again
 *    would be a no-op.
 *  - **field text, effects and angle.** Upstream copies the whole field
 *    (`libField = field`) and then overwrites only the position, so everything
 *    else rides along untouched. So does this: only `at` changes.
 *
 * What comes back is a working copy. Nothing here writes a library — the round
 * trip (editing it, and pushing the result back onto the placement) is the
 * other half of the feature.
 */

import { applyTransform, invertTransform, symbolTransform } from '@ziroeda/common/src/transform.js';
import type { LibSymbol, SchField, SchSymbol } from '../types.js';

/**
 * The library symbol to open in the editor for a placement.
 *
 * `lib` is the placement's library symbol as the index holds it (already
 * flattened). The result keeps that symbol's body and takes the *placement's*
 * fields, moved back into symbol space.
 *
 * The lib id comes from the placement (`symbol->SetLibId( aSymbol->GetLibId() )`),
 * so a placement whose library entry has since been renamed still opens under
 * the name the schematic refers to.
 */
export function libSymbolFromPlacement(sym: SchSymbol, lib: LibSymbol): LibSymbol {
  const inv = invertTransform(symbolTransform(sym.angle, sym.mirror));
  const properties = sym.fields.map((f): SchField => {
    if (!f.at) return f;
    // Relative to the symbol origin first: a placement's field position is
    // absolute, a library symbol's is not.
    const local = applyTransform(inv, { x: f.at.x - sym.at.x, y: f.at.y - sym.at.y });
    return { ...f, at: local };
  });
  return { ...lib, libId: sym.libId, properties };
}

/**
 * The unit and body style the editor should open on
 * (`std::max( 1, aSymbol->GetUnit() )`).
 *
 * A placement may carry 0 for either, meaning "unset"; the editor has no unit 0
 * to show, so upstream floors both at 1 rather than opening on nothing.
 */
export function editorUnitFor(sym: SchSymbol): { unit: number; bodyStyle: number } {
  return { unit: Math.max(1, sym.unit), bodyStyle: Math.max(1, sym.bodyStyle) };
}
