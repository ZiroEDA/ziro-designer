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
 *    (`libField = field`) and then overwrites only the position. We take the
 *    **library's** field values and borrow only the *position* from the
 *    placement. See below — this one is a deliberate divergence.
 *
 * ### Why the values stay the library's
 *
 * Upstream's working symbol carries the placement's field *text* too, so the
 * editor shows `R1` where the library says `R`. That is what lets its
 * `SaveSymbolToSchematic` call `UpdateFields` with `aUpdateRef` and write `R1`
 * straight back.
 *
 * For us it would be a live hazard. Our `libById` **is** the schematic's
 * embedded `lib_symbols`, so a save-back that put `R1` into the cached
 * `Device:R` would leave "Update Symbols from Library" ready to push `R1` onto
 * every other resistor on the sheet. Taking the position and leaving the value
 * removes that entirely: the editor shows a library symbol, as a symbol editor
 * should, and the placement's own Reference is never a thing the round trip can
 * touch.
 *
 * The cost is that fields the placement has and the library does not are not
 * carried into the working copy. They are not part of the library symbol, and
 * the placement keeps them either way.
 *
 * What comes back is a working copy. Nothing here writes a library — the round
 * trip (editing it, and pushing the result back onto the placement) is the
 * other half of the feature.
 */

import { applyTransform, invertTransform, symbolTransform } from '@ziroeda/common/src/transform.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import type { LibSymbol, SchField, SchSymbol } from '../types.js';
import { refId } from './hittest.js';

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
  const placed = new Map(sym.fields.map((f) => [f.key, f]));
  const properties = lib.properties.map((f): SchField => {
    const from = placed.get(f.key);
    if (!from?.at) return f;
    // Relative to the symbol origin first: a placement's field position is
    // absolute, a library symbol's is not.
    return { ...f, at: applyTransform(inv, { x: from.at.x - sym.at.x, y: from.at.y - sym.at.y }) };
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

/**
 * Which of the two symbols the editor is seeded with.
 *
 * Both of DIALOG_SYMBOL_PROPERTIES' hand-off buttons run the same upstream
 * handler and open the same SYMBOL_EDIT_FRAME; they differ only here
 * (`sch_edit_tool.cpp:2727-2760`):
 *
 *     'schematic'  SYMBOL_PROPS_EDIT_SCHEMATIC_SYMBOL
 *                  editor->LoadSymbolFromSchematic( symbol )
 *     'library'    SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL
 *                  editor->LoadSymbol( symbol->GetLibId(), symbol->GetUnit(),
 *                                      symbol->GetBodyStyle() )
 */
export type SymbolEditorTarget = 'schematic' | 'library';

/** What the symbol editor has to be handed for it to open on a symbol. */
export interface SymbolEditorRequest {
  symbol: LibSymbol;
  unit: number;
  bodyStyle: number;
  /** The placement the edit comes back to (`refId('symbol', …)`). */
  targetId: string;
}

/**
 * The seed for "Edit Symbol..." / "Edit Library Symbol..." / Ctrl+E.
 *
 * `null` is upstream's refusal, not an empty editor: the schematic-symbol leg
 * bails on `symbol->IsMissingLibSymbol()` (`sch_edit_tool.cpp:2735`) and
 * `EditWithSymbolEditor` says so out loud — "Symbols with broken library symbol
 * links cannot be edited." (`sch_editor_control.cpp:2870`). A caller that gets
 * `null` must report that, and must NOT open the editor on nothing.
 *
 * This is the whole decision both buttons make, kept out of the React
 * component so it can be tested: the component's job is to call it and hand
 * the result over.
 */
export function symbolEditorRequest(
  symbols: readonly SchSymbol[],
  libById: ReadonlyMap<string, LibSymbol>,
  targetId: string,
  target: SymbolEditorTarget,
): SymbolEditorRequest | null {
  const sym = symbols.find((sy, i) => refId('symbol', sy.uuid, i) === targetId);
  const lib = sym && libById.get(schSymbolLibraryName(sym));
  if (!sym || !lib) return null;
  return {
    // 'library' is the library part as it stands. 'schematic' folds this
    // instance's field placement in — which is exactly, and only, what
    // separates the two buttons.
    symbol: target === 'library' ? lib : libSymbolFromPlacement(sym, lib),
    ...editorUnitFor(sym),
    targetId,
  };
}
