/**
 * The pieces DIALOG_LABEL_PROPERTIES edits that live in the model rather than
 * in the dialog: a label's orientation (SPIN_STYLE) and its fields.
 *
 * Counterpart: `SCH_LABEL_BASE` (eeschema/sch_label.h) plus
 * `DIALOG_LABEL_PROPERTIES::TransferDataFromWindow`. Labels carry fields the
 * same way symbols do — `(property "Netclass" "…")`, the global label's
 * "Intersheetrefs" — so the dialog's Fields grid is the same grid the symbol
 * properties dialog uses, over the label's own `(property …)` children.
 *
 * Fields are read from and written back into the label's `source` node, which
 * keeps everything we don't model (positions, fonts, hyperlinks) byte-stable.
 */

import { head, isList, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { childrenNamed } from '@ziroeda/sexpr/src/query.js';
import { readField } from '../sch_io/sexpr/read-schematic.js';
import { buildPropertyNode, patchProperty } from '../sch_io/sexpr/write-schematic.js';
import type { SchField, SchLabel, Schematic, Vec2 } from '../types.js';

/**
 * SPIN_STYLE (eeschema/sch_item.h): which way a label points. The dialog's four
 * orientation buttons pick one; the file stores it as the third argument of
 * `(at x y angle)`.
 */
export type LabelSpin = 'right' | 'up' | 'left' | 'bottom';

/** SPIN_STYLE -> the label's stored angle. */
export const SPIN_ANGLE: Record<LabelSpin, number> = {
  right: 0,
  up: 90,
  left: 180,
  bottom: 270,
};

/** The stored angle -> SPIN_STYLE, tolerating any multiple of 360°. */
export function spinOfAngle(angle: number): LabelSpin {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return a === 90 ? 'up' : a === 180 ? 'left' : a === 270 ? 'bottom' : 'right';
}

/** A label's fields, in file order (SCH_LABEL_BASE::GetFields). */
export function labelFields(label: SchLabel): SchField[] {
  return childrenNamed(label.source, 'property').map((p) => readField(p));
}

/** A field as the dialog's grid holds it: no `source` yet if the row is new. */
export type EditedLabelField = Omit<SchField, 'source'> & { readonly source?: SList };

/**
 * Replace a label's fields. Existing `(property …)` nodes are patched in place
 * so untouched ones round-trip byte-for-byte; fields added in the dialog are
 * appended (KiCad writes them after the label's own tokens), and removed ones
 * simply aren't emitted.
 */
export function setLabelFields(label: SchLabel, fields: readonly EditedLabelField[]): SchLabel {
  const kept = new Map<SList, SchField>();
  const appended: EditedLabelField[] = [];

  for (const f of fields) {
    // A field carrying a source node that is one of this label's properties is
    // an edit of that node; anything else is new.
    if (f.source && isList(f.source) && head(f.source) === 'property' && !kept.has(f.source)) {
      kept.set(f.source, f as SchField);
    } else {
      appended.push(f);
    }
  }

  const items: SNode[] = [];
  for (const it of label.source.items) {
    if (isList(it) && head(it) === 'property') {
      const edit = kept.get(it);
      if (edit) items.push(patchProperty(it, edit));
      continue; // dropped fields are just not emitted
    }
    items.push(it);
  }
  for (const f of appended) items.push(buildPropertyNode(f));

  return { ...label, source: { kind: 'list', items } };
}

/**
 * TransferDataFromWindow's field clean-up, shared with the symbol dialog: a
 * field with neither name nor value is dropped, and one with a value but no
 * name becomes "untitled".
 */
export function cleanLabelFields(fields: readonly EditedLabelField[]): EditedLabelField[] {
  const out: EditedLabelField[] = [];
  for (const f of fields) {
    if (f.key.trim() === '' && f.value.trim() === '') continue;
    out.push(f.key.trim() === '' ? { ...f, key: 'untitled' } : f);
  }
  return out;
}

/**
 * Where a label dropped at `at` should point — SCH_SCREEN::
 * GetLabelOrientationForPoint, used by SCH_EDIT_FRAME::AutoRotateItem when the
 * label has "Auto" (AutoRotateOnPlacement) set. A wire through the point turns
 * the label away from the wire's body: on a horizontal wire it points right at
 * the wire's right-hand end and left otherwise, and correspondingly for a
 * vertical one.
 *
 * Only the wire case is ported. Upstream also reads a symbol pin's own
 * orientation and a bus entry's bus direction; both fall through to
 * `fallback` here, which is what upstream does when nothing is found.
 */
export function labelOrientationForPoint(sch: Schematic, at: Vec2, fallback: LabelSpin): LabelSpin {
  let ret = fallback;
  const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

  for (const line of sch.lines) {
    if (line.kind !== 'wire' && line.kind !== 'bus') continue;
    // Only a line passing through the point counts (Items().Overlapping).
    const dx = line.end.x - line.start.x;
    const dy = line.end.y - line.start.y;
    const on =
      Math.abs(dx * (at.y - line.start.y) - dy * (at.x - line.start.x)) < 1 &&
      at.x >= Math.min(line.start.x, line.end.x) &&
      at.x <= Math.max(line.start.x, line.end.x) &&
      at.y >= Math.min(line.start.y, line.end.y) &&
      at.y <= Math.max(line.start.y, line.end.y);
    if (!on) continue;

    // The angle normalized to (-90, 90]: horizontal-ish or vertical-ish.
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      if (line.start.x <= line.end.x) ret = same(line.end, at) ? 'right' : 'left';
      else ret = same(line.end, at) ? 'left' : 'right';
    } else {
      if (line.start.y <= line.end.y) ret = same(line.end, at) ? 'bottom' : 'up';
      else ret = same(line.end, at) ? 'up' : 'bottom';
    }
  }
  return ret;
}
