// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_SYMBOL`'s per-sheet-path getters (eeschema/sch_symbol.cpp): one symbol
 * on a sheet that is used more than once has a reference and a unit for each
 * sheet path it is shown on (`m_instances`), and every consumer that walks the
 * hierarchy asks with the path.
 *
 * `aInstancePath` is the sheet path's KIID path as the `(instances …)` records
 * key it: `/<root uuid>/<sheet uuids…>` (`SCH_SHEET_PATH::Path()`).
 */
import { list, atom, str } from '@ziroeda/sexpr';
import type { SchSymbol, SchSymbolInstance } from './types.js';

const referenceField = (sym: SchSymbol): string =>
  sym.fields.find((f) => f.key === 'Reference')?.value ?? '';

/** `m_instancePathIndex.find( path )`. */
function instanceOn(sym: SchSymbol, aInstancePath: string): SchSymbolInstance | undefined {
  return sym.instances?.find((i) => i.path === aInstancePath);
}

/**
 * `GetRef( sheet, false )`: the instance's reference, else the Reference field
 * (a version 1 file, or a path with no record - then every instance of the
 * sheet shows the same references, "but perhaps this is best").
 */
export function GetRef(sym: SchSymbol, aInstancePath: string): string {
  let ref = instanceOn(sym, aInstancePath)?.reference ?? '';

  if (ref === '' && referenceField(sym) !== '') ref = referenceField(sym);

  // An empty reference is the prefix with a '?' (UTIL::GetRefDesUnannotated);
  // the parser never leaves a symbol without a Reference field.
  return ref;
}

/** `GetUnitSelection( sheet )`: the instance's unit, else `m_unit`. */
export function GetUnitSelection(sym: SchSymbol, aInstancePath: string): number {
  return instanceOn(sym, aInstancePath)?.unit ?? sym.unit;
}

/** `AddHierarchicalReference( path, ref, unit )`: add or replace the record for `path`. */
export function AddHierarchicalReference(
  sym: SchSymbol,
  aPath: string,
  aRef: string,
  aUnit: number,
): SchSymbol {
  const record: SchSymbolInstance = {
    project: '',
    path: aPath,
    reference: aRef,
    unit: aUnit,
    source: list(
      atom('path'),
      str(aPath),
      list(atom('reference'), str(aRef)),
      list(atom('unit'), atom(String(aUnit))),
    ),
  };
  const kept = (sym.instances ?? []).filter((i) => i.path !== aPath);
  return { ...sym, instances: [...kept, record] };
}
