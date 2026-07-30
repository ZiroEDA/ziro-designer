/**
 * Selection text helpers, ported from KiCad's `eeschema/tools/sch_tool_utils.cpp`:
 * GetSchItemAsText / GetSelectedItemsAsText, the "Copy as Text" payload.
 * Text-bearing items yield their shown text (labels, text, text boxes; tables
 * as tab-separated rows); everything else yields nothing, exactly upstream.
 */

import type { Schematic } from '../types.js';
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
