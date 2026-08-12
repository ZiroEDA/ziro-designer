// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Selection text helpers, ported from KiCad's `eeschema/tools/sch_tool_utils.cpp`:
 * GetSchItemAsText / GetSelectedItemsAsText, the "Copy as Text" payload.
 * Text-bearing items yield their shown text (labels, text, text boxes; tables
 * as tab-separated rows); everything else yields nothing, exactly upstream.
 */

import type { Schematic, SchSymbol } from '../types.js';
import { refId } from './hittest.js';

/** GetSelectedItemsAsText: the selected items' texts joined with newlines. */
export function getSelectedItemsAsText(sch: Schematic, ids: ReadonlySet<string>): string {
  const texts: string[] = [];

  sch.labels.forEach((l, i) => {
    if (ids.has(refId('label', l.uuid, i))) {
      const t = l.text.trim();
      if (t) texts.push(t);
    }
  });
  sch.textBoxes.forEach((tb, i) => {
    if (ids.has(refId('textbox', tb.uuid, i))) {
      const t = tb.text.trim();
      if (t) texts.push(t);
    }
  });
  sch.tables.forEach((table, i) => {
    if (!ids.has(refId('table', table.uuid, i))) return;
    // "A simple tabbed list of the cells": tab-separated columns, one row per line.
    const rows: string[] = [];
    for (let r = 0; r * table.columnCount < table.cells.length; r++) {
      rows.push(
        table.cells
          .slice(r * table.columnCount, (r + 1) * table.columnCount)
          .map((c) => c.text)
          .join('\t'),
      );
    }
    const t = rows.join('\n').trim();
    if (t) texts.push(t);
  });
  sch.graphics.forEach((g, i) => {
    // Schematic-level graphics have no uuid, so the index form is their refId.
    if (ids.has(refId('graphic', undefined, i)) && g.kind === 'text') {
      const t = g.text.trim();
      if (t) texts.push(t);
    }
  });

  return texts.join('\n');
}

/**
 * Whether a unit of this part is already on the sheet under this reference.
 *
 * `IsUnannotatedUnitOccupied` (sch_tool_utils.cpp): a placement occupies a unit
 * when its unit number, its reference string and its library id all match. The
 * library id is the part that matters and the reason upstream wrote a helper
 * for it — before annotation every symbol reads `U?`, so two different
 * multi-unit parts on one sheet share a reference string, and matching on the
 * reference alone would have a 4001 skip units occupied by an unrelated 4011.
 */
export function isUnannotatedUnitOccupied(
  symbols: readonly SchSymbol[],
  reference: string,
  libId: string,
  unit: number,
): boolean {
  return symbols.some(
    (s) =>
      s.unit === unit &&
      s.libId === libId &&
      (s.fields.find((f) => f.key === 'Reference')?.value ?? '') === reference,
  );
}

/**
 * The unit to place next, stepping past the ones already taken.
 *
 * `SCH_DRAWING_TOOLS::PlaceSymbol`'s continuation, for "Place all units":
 *
 *   while( unit <= unitCount && unitOccupied( unit ) ) unit++;
 *   if( unit > unitCount ) unit = 1;
 *
 * Blindly incrementing instead — which is what this replaced — meant reopening
 * the chooser restarted at unit 1, so placing a 4001 twice from the chooser put
 * two unit-A gates on the sheet instead of A and then B.
 *
 * An annotated placement is matched on its own reference, an unannotated one
 * additionally on the library id; both come out of the same predicate here
 * because the reference carries the distinction.
 */
export function nextFreeUnit(
  symbols: readonly SchSymbol[],
  reference: string,
  libId: string,
  unitCount: number,
  from: number,
): number {
  let unit = from;
  while (unit <= unitCount && isUnannotatedUnitOccupied(symbols, reference, libId, unit)) unit++;
  return unit > unitCount ? 1 : unit;
}
