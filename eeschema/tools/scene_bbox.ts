// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The extent of a selection, and of a whole sheet. Counterparts:
 * `ACTIONS::zoomFitSelection` (`SCH_EDIT_FRAME::GetDocumentExtents` over the
 * selection) and `ACTIONS::zoomFitObjects` (the same over every item).
 *
 * Both of these had grown their *own* walk over the document, and both walks
 * were short — the selection one covered five item kinds of fifteen and the
 * whole-sheet one covered four. The result was silent in the worst way: Zoom to
 * Selected Objects on a text box, an image, a table, a graphic, a no-connect, a
 * bus entry or a directive label computed an empty box and simply did nothing,
 * and Zoom to All Objects on a sheet made of those framed nothing at all.
 *
 * There is now one walk. `alignBoxes` already had to know every kind's extent —
 * alignment needs exactly the same answer — so this asks it, and a completeness
 * guard fails when the model grows an item array that walk does not cover.
 *
 * What is deliberately absent:
 *
 *  - **groups** carry no geometry of their own. A group is a set of member
 *    uuids and each member already contributes its own box, so giving the group
 *    one too would double-count, not add anything;
 *  - **fields, symbol pins and sheet pins** are parts of their parent. Upstream
 *    drops any item whose parent is also in the collection, and ours are only
 *    ever selected alongside their parent.
 */

import type { LibSymbol, Schematic } from '../types.js';
import { emptyBBox, includePoint, isEmpty, type BBox } from './bbox.js';
import { alignBoxes } from './sch_align_tool.js';

const union = (boxes: readonly { box: BBox }[]): BBox => {
  const out = emptyBBox();
  for (const { box } of boxes) {
    includePoint(out, { x: box.minX, y: box.minY });
    includePoint(out, { x: box.maxX, y: box.maxY });
  }
  return out;
};

/**
 * The extent of `ids`. Empty (see `isEmpty`) when the selection holds nothing
 * with geometry, which the caller must treat as "do not move the view" rather
 * than as a box at the origin.
 */
export function selectionBBox(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
): BBox {
  return union(alignBoxes(doc, ids, libById));
}

/** The extent of every item on the sheet, ignoring the page. */
export function contentBBox(doc: Schematic, libById: Map<string, LibSymbol>): BBox {
  return union(alignBoxes(doc, null, libById));
}

/** Whether an item kind contributes to the extents at all. */
export const hasExtent = (doc: Schematic, id: string, libById: Map<string, LibSymbol>): boolean =>
  !isEmpty(selectionBBox(doc, new Set([id]), libById));
