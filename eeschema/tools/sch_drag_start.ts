// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a left-button drag does: move the selection, or draw a rubber band.
 *
 * Counterpart: the `evt->IsDrag( BUT_LEFT )` arm of `SCH_SELECTION_TOOL::Main`
 * (eeschema/tools/sch_selection_tool.cpp), plus `selectionContains` and
 * `RequestSelection( SCH_COLLECTOR::MovableItems )`.
 *
 * The decisive test upstream is **not** "did the press hit-test to an item that
 * is already selected". It is `selectionContains( evt->DragOrigin() )`: is the
 * press inside any *selected* item's bounding box, inflated by a 20-pixel grip
 * margin? Nothing is hit-tested at all.
 *
 * That difference is the whole bug this module exists for. Asking the hit test
 * meant the press had to resolve to the very same id the click before it had
 * resolved to, and it very often does not: a symbol's pins and its reference
 * and value fields are separate candidates that sit on top of the body and win
 * the closest-item race from a few pixels away. So the first click selected the
 * symbol, the second press two pixels over resolved to a pin, `selection.has()`
 * said no, and the drag became a selection rectangle — over and over, on the
 * item you had just selected.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { contains, inflate, sheetPinBBox, type BBox } from './bbox.js';
import { collectFieldBoxes, refId, type ItemRef } from './hittest.js';
import { alignBoxes } from './sch_align_tool.js';
import { MovableItems } from './sch_request_selection.js';

/**
 * `SCH_SELECTION_TOOL::selectionContains`' grip margin, in screen pixels: you
 * can grab a selected item from a little outside it.
 */
export const GRIP_MARGIN_PX = 20;

/**
 * The kinds `SCH_COLLECTOR::MovableItems` lists — the one transcription of that
 * table, in `sch_request_selection.ts`, rather than a second copy of the rule
 * here. A pin is selectable but cannot be moved, so `RequestSelection(
 * MovableItems )` drops it and the move tool is left with nothing to move.
 */
export const isMovableKind = (kind: ItemRef['kind']): boolean => MovableItems.has(kind);

/** A movable id: the kinds above, addressed by id rather than by ref. */
const idIsMovable = (id: string): boolean => id.lastIndexOf(':pin') <= 0;

/**
 * `RequestSelection( SCH_COLLECTOR::MovableItems )`: an existing selection is
 * trimmed to the movable kinds; an empty one picks up whatever the press is
 * over (`SelectPoint`), which is what lets "drag any object" move an
 * unselected item in a single gesture.
 */
export function requestMovableSelection(
  selection: ReadonlySet<string>,
  hit: ItemRef | null,
): Set<string> {
  if (selection.size > 0) return new Set([...selection].filter(idIsMovable));
  return hit && isMovableKind(hit.kind) ? new Set([hit.id]) : new Set();
}

/**
 * Every selected item's box, the way `selectionContains` reads `ViewBBox()`.
 *
 * `alignBoxes` is the one walk that knows each kind's extent, but it leaves out
 * fields and pins deliberately: they are parts of their parent and alignment
 * never wants them on their own. Both are separately *selectable* here, and a
 * field is separately movable, so they are added back — and a selected symbol
 * picks up its fields too, since `ViewBBox()` covers them and you must be able
 * to grab a symbol by the reference text you can see.
 */
export function selectionBoxes(
  doc: Schematic,
  libById: Map<string, LibSymbol>,
  ids: ReadonlySet<string>,
): BBox[] {
  const out: BBox[] = alignBoxes(doc, ids, libById).map((b) => b.box);
  for (const f of collectFieldBoxes(doc, libById)) {
    const owner = f.id.slice(0, f.id.lastIndexOf(':field'));
    if (ids.has(f.id) || ids.has(owner)) out.push(f.bbox);
  }
  doc.sheets.forEach((sh, i) => {
    const shId = refId('sheet', sh.uuid, i);
    sh.pins.forEach((p, k) => {
      if (ids.has(`${shId}:sheetpin${k}`)) out.push(sheetPinBBox(p));
    });
  });
  return out;
}

/**
 * `selectionContains( aPoint )`: is the point inside any selected item's box,
 * inflated by the grip margin? `margin` is GRIP_MARGIN_PX converted to world
 * units by the caller, which is the only thing here that knows the view scale.
 */
export function selectionContains(
  doc: Schematic,
  libById: Map<string, LibSymbol>,
  ids: ReadonlySet<string>,
  point: Vec2,
  margin: number,
): boolean {
  if (ids.size === 0) return false;
  for (const box of selectionBoxes(doc, libById, ids))
    if (contains(inflate(box, margin), point)) return true;
  return false;
}

/** The "Left button drag" preference (COMMON_SETTINGS MOUSE_DRAG_ACTION). */
export type LeftDragAction = 'select' | 'drag_selected' | 'drag_any';

/** What the gesture turns into. 'box' covers the lasso variant too. */
export type DragStart = 'move' | 'drag' | 'box';

/**
 * The branch, verbatim in shape:
 *
 *     if( hasModifier() || drag_action == SELECT )        selectMultiple();
 *     else if( m_selection.Empty() && drag_action != DRAG_ANY )  selectMultiple();
 *     else {
 *         m_selection = RequestSelection( MovableItems );
 *         if( evt->HasPosition() && selectionContains( evt->DragOrigin() ) )
 *             RunAction( drag_is_move ? move : drag );
 *         else
 *             selectMultiple();
 *     }
 *
 * Note that a modifier *always* means a rubber band: shift-drag extends a
 * selection, it never moves one.
 */
export function leftDragStart(o: {
  hasModifier: boolean;
  action: LeftDragAction;
  dragIsMove: boolean;
  selectionEmpty: boolean;
  /** `selectionContains( DragOrigin() )` over the requested selection. */
  gripped: boolean;
}): DragStart {
  if (o.hasModifier || o.action === 'select') return 'box';
  if (o.selectionEmpty && o.action !== 'drag_any') return 'box';
  if (!o.gripped) return 'box';
  return o.dragIsMove ? 'move' : 'drag';
}
