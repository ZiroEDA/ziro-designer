// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dropping a selection INTO a sheet — `SCH_MOVE_TOOL::findTargetSheet` and
 * `::moveSelectionToSheet` (`eeschema/tools/sch_move_tool.cpp:1420-1504`,
 * `:1957-2008`).
 *
 * Drag a symbol over a sheet box and let go: the symbol leaves this sheet and
 * appears on that sheet's own screen. The cursor is the whole announcement —
 * it turns from MOVING to PLACE while the drop is armed, and the sheet under it
 * brightens — so the two halves belong together. A PLACE cursor over a sheet
 * that then does nothing would be worse than never showing it.
 *
 * The three conditions worth stating, because none of them is obvious from the
 * gesture:
 *
 *  - it is a MOVE only. A drag/break/slice reshapes connections in place and
 *    must never pull items onto a sub-sheet (`:817-819`);
 *  - a selection holding a sheet PIN never drops — the pin belongs to a sheet
 *    on this screen — and a selection of only graphics needs Ctrl held, so that
 *    a drawn box crossing a sheet does not silently vanish into it (`:1499-1503`);
 *  - if any connection point of the selection has landed on one of the sheet's
 *    PINS, the user is wiring to the sheet, not dropping into it (`:1472-1495`).
 */

import { refId } from './hittest.js';
import { connectionPoints } from './connect.js';
import { selectionBBox } from './scene_bbox.js';
import { isEmpty, type BBox } from './bbox.js';
import type { LibSymbol, SchSheet, Schematic, Vec2 } from '../types.js';

/** `SCH_SHEET::GetBodyBoundingBox` (`sch_sheet.cpp:822-840`): the box itself,
 *  inflated by half the border pen, and NOT its fields. */
export function sheetBodyBBox(sheet: SchSheet, defaultLineWidthIU: number): BBox {
  const pen = sheet.stroke && sheet.stroke.width > 0 ? sheet.stroke.width : defaultLineWidthIU;
  const half = Math.floor(pen / 2);
  return {
    minX: sheet.at.x - half,
    minY: sheet.at.y - half,
    maxX: sheet.at.x + sheet.size.w + half,
    maxY: sheet.at.y + sheet.size.h + half,
  };
}

const inside = (b: BBox, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

const holds = (outer: BBox, inner: BBox): boolean =>
  inner.minX >= outer.minX &&
  inner.minY >= outer.minY &&
  inner.maxX <= outer.maxX &&
  inner.maxY <= outer.maxY;

/**
 * `isGraphicItemForDrop` (`sch_move_tool.cpp:70-84`): SCH_SHAPE, SCH_BITMAP,
 * SCH_TEXT, SCH_TEXTBOX, and a SCH_LINE only when `IsGraphicLine()`.
 *
 * Our `kind` for a graphic line is 'polyline'; a wire or a bus is not one of
 * these, and neither is a label, which is a SCH_LABEL and not a SCH_TEXT.
 */
function selectionTraits(
  sch: Schematic,
  selection: ReadonlySet<string>,
): { hasSheetPins: boolean; isGraphicsOnly: boolean; hasField: boolean } {
  let hasSheetPins = false;
  let hasGraphics = false;
  let hasNonGraphics = false;
  let hasField = false;
  // An id alone does not say what it names, so the graphic kinds are collected
  // from the document first. A sheet pin's id is `${sheetRefId}:sheetpin${k}`
  // and a field's is `${ownerId}:field${k}`; nothing else here carries either
  // suffix.
  const graphic = new Set<string>();
  const sheets = new Set<string>();
  // A `LibGraphic` carries no uuid, so its id is always the index form.
  sch.graphics.forEach((_, i) => graphic.add(refId('graphic', undefined, i)));
  sch.images.forEach((im, i) => graphic.add(refId('image', im.uuid, i)));
  sch.textBoxes.forEach((t, i) => graphic.add(refId('textbox', t.uuid, i)));
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') graphic.add(refId('label', l.uuid, i));
  });
  sch.lines.forEach((l, i) => {
    if (l.kind === 'polyline') graphic.add(refId('line', l.uuid, i));
  });
  sch.sheets.forEach((sh, i) => sheets.add(refId('sheet', sh.uuid, i)));
  for (const id of selection) {
    if (id.includes(':sheetpin')) {
      hasSheetPins = true;
      continue;
    }
    if (id.includes(':field')) {
      hasField = true;
      continue;
    }
    if (graphic.has(id)) hasGraphics = true;
    // `else if( schItem->Type() != SCH_SHEET_T )` — a sheet counts as neither,
    // so dragging one sheet over another is still "graphics only" if the rest
    // of the selection is.
    else if (!sheets.has(id)) hasNonGraphics = true;
  }
  return { hasSheetPins, isGraphicsOnly: hasGraphics && !hasNonGraphics, hasField };
}

export interface SheetDropOpts {
  /** `SCHEMATIC_SETTINGS::m_DefaultLineWidth`, for the body box's pen inflation. */
  defaultLineWidthIU: number;
  /** Ctrl at this instant: the only thing that lets a graphics-only selection drop. */
  ctrlDown: boolean;
  /**
   * `SCH_SHEET::IsTopLevelSheet()`, the sheets sitting directly under the
   * virtual root. A sheet DRAWN on an ordinary screen is never one of them, so
   * this is empty in every case this port can currently reach — it is here
   * because upstream tests it and a multi-root project would need it.
   */
  topLevelSheetIds?: ReadonlySet<string>;
}

/**
 * The sheet a drop is currently armed for, as its refId — or null.
 *
 * `sch` is the sheet as the drag leaves it: upstream reads the live screen,
 * whose items `performItemMove` has already moved, and the selection bounding
 * box is explicitly "in its (already moved) position" (`:1438`).
 */
export function findTargetSheet(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  selection: ReadonlySet<string>,
  cursor: Vec2,
  opts: SheetDropOpts,
): string | null {
  if (selection.size === 0) return null;
  const traits = selectionTraits(sch, selection);
  // "Fields are children of their parent item and must not be dropped into a
  // sheet" (`:1423-1428`) — one is enough to refuse the whole drop.
  if (traits.hasField) return null;

  const topLevel = opts.topLevelSheetIds ?? new Set<string>();
  const candidates = sch.sheets.map((sheet, i) => ({
    sheet,
    id: refId('sheet', sheet.uuid, i),
    body: sheetBodyBBox(sheet, opts.defaultLineWidthIU),
  }));

  // `GetScreen()->GetItem( aCursorPos, 0, SCH_SHEET_T )`, then "never target a
  // selected sheet" — a sheet being dragged cannot be dropped into.
  let target = candidates.find((c) => inside(c.body, cursor) && !selection.has(c.id)) ?? null;

  if (!target) {
    // The fallback: the first sheet whose body holds the whole selection, or at
    // least its centre. This is what makes a drop work when the cursor has been
    // grabbed by a corner and is outside the sheet the items are over.
    //
    // The two arms are upstream's and only the second can decide anything: a
    // box a rectangle contains has its centre inside that rectangle too, so
    // `holds` is strictly implied by `inside(centre)`. Kept because it is what
    // `body.Contains( selBBox ) || body.Contains( selCenter )` says.
    const box = selectionBBox(sch, selection, libById);
    if (!isEmpty(box) && box.maxX > box.minX && box.maxY > box.minY) {
      const centre = {
        x: box.minX + Math.floor((box.maxX - box.minX) / 2),
        y: box.minY + Math.floor((box.maxY - box.minY) / 2),
      };
      target =
        candidates.find(
          (c) =>
            !selection.has(c.id) &&
            !topLevel.has(c.id) &&
            (holds(c.body, box) || inside(c.body, centre)),
        ) ?? null;
    }
  }

  if (!target) return null;

  // Wiring to the sheet, not dropping into it.
  const pins = new Set(target.sheet.pins.map((p) => `${p.at.x},${p.at.y}`));
  for (const p of connectionPoints(sch, libById, selection)) {
    if (pins.has(`${p.x},${p.y}`)) return null;
  }

  const allowedBySelection = !traits.hasSheetPins;
  const allowedByModifiers = !traits.isGraphicsOnly || opts.ctrlDown;
  return allowedBySelection && allowedByModifiers ? target.id : null;
}

/** `schIUScale.MilsToIU( 50 )`, the step the drop nudges by while it overlaps
 *  something already on the target sheet (`:1969`). [data] */
export const SHEET_DROP_STEP_IU = 50 * 254;

/**
 * `moveSelectionToSheet`'s placement (`:1963-1989`): the offset that takes the
 * dropped selection to the target sheet's origin, then diagonally out of the
 * way of anything already there.
 *
 * `destBoxes` are the bounding boxes of the target sheet's existing items. The
 * loop is upstream's `do { … } while( overlap )` — the first offset is tried
 * before any step is added, so an empty sheet takes the items at its origin.
 */
export function sheetDropOffset(selBox: BBox, destBoxes: readonly BBox[]): Vec2 {
  const offset = { x: -selBox.minX, y: -selBox.minY };
  for (;;) {
    const moved = {
      minX: selBox.minX + offset.x,
      minY: selBox.minY + offset.y,
      maxX: selBox.maxX + offset.x,
      maxY: selBox.maxY + offset.y,
    };
    const overlap = destBoxes.some(
      (b) =>
        !isEmpty(b) &&
        moved.minX <= b.maxX &&
        b.minX <= moved.maxX &&
        moved.minY <= b.maxY &&
        b.minY <= moved.maxY,
    );
    if (!overlap) return offset;
    offset.x += SHEET_DROP_STEP_IU;
    offset.y += SHEET_DROP_STEP_IU;
  }
}
