// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pieces DIALOG_LABEL_PROPERTIES edits that live in the model rather than
 * in the dialog: a label's orientation (SPIN_STYLE) and its fields.
 *
 * Counterpart: `SCH_LABEL_BASE` (eeschema/sch_label.h) plus
 * `DIALOG_LABEL_PROPERTIES::TransferDataFromWindow`. Labels carry fields the
 * same way symbols do, `(property "Netclass" "…")`, the global label's
 * "Intersheetrefs", so the dialog's Fields grid is the same grid the symbol
 * properties dialog uses, over the label's own `(property …)` children.
 *
 * Fields are read from and written back into the label's `source` node, which
 * keeps everything we don't model (positions, fonts, hyperlinks) byte-stable.
 */

import { head, isList, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { childrenNamed } from '@ziroeda/sexpr/src/query.js';
import { readField } from '../sch_io/sexpr/read-schematic.js';
import { buildPropertyNode, patchProperty } from '../sch_io/sexpr/write-schematic.js';
import type { LibSymbol, SchField, SchLabel, SchSymbol, Schematic, Vec2 } from '../types.js';
import { symbolPinPositions } from './connect.js';
import { refId } from './hittest.js';

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
  return { ...label, source: setNodeFields(label.source, fields) };
}

/**
 * The same, on the bare node — sheet pins are SCH_LABEL_BASEs too, so their
 * `(pin …)` node carries fields the properties dialog edits.
 */
export function setNodeFields(node: SList, fields: readonly EditedLabelField[]): SList {
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
  for (const it of node.items) {
    if (isList(it) && head(it) === 'property') {
      const edit = kept.get(it);
      if (edit) items.push(patchProperty(it, edit));
      continue; // dropped fields are just not emitted
    }
    items.push(it);
  }
  for (const f of appended) items.push(buildPropertyNode(f));

  return { kind: 'list', items };
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
 * Where a label dropped at `at` should point, SCH_SCREEN::
 * GetLabelOrientationForPoint, used by SCH_EDIT_FRAME::AutoRotateItem when the
 * label has "Auto" (AutoRotateOnPlacement) set. A wire through the point turns
 * the label away from the wire's body: on a horizontal wire it points right at
 * the wire's right-hand end and left otherwise, and correspondingly for a
 * vertical one.
 *
 * A pin at the point turns the label away from the symbol (GetPinSpinStyle),
 * and a bus entry turns it to the side of its bus. With nothing at the point
 * the label keeps `fallback`, as upstream does.
 */
export function labelOrientationForPoint(
  sch: Schematic,
  at: Vec2,
  fallback: LabelSpin,
  libById?: ReadonlyMap<string, LibSymbol>,
): LabelSpin {
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

  // A bus entry: the label goes on the side the entry leans towards, and only
  // when the bus it joins runs square (SCH_BUS_WIRE_ENTRY's branch).
  for (const entry of sch.busEntries) {
    const end = { x: entry.at.x + entry.size.x, y: entry.at.y + entry.size.y };
    if (!same(entry.at, at) && !same(end, at)) continue;
    for (const bus of sch.lines) {
      if (bus.kind !== 'bus') continue;
      const onBus =
        same(bus.start, entry.at) ||
        same(bus.end, entry.at) ||
        same(bus.start, end) ||
        same(bus.end, end);
      if (!onBus) continue;
      if (bus.start.x === bus.end.x) {
        // Vertical bus -> horizontal label, on the entry's side of it.
        if (at.x < bus.start.x) ret = 'left';
        else if (at.x > bus.start.x) ret = 'right';
      } else if (bus.start.y === bus.end.y) {
        if (at.y < bus.start.y) ret = 'up';
        else if (at.y > bus.start.y) ret = 'bottom';
      }
    }
  }

  // A symbol pin at the point: the label points away from the symbol body.
  if (libById) {
    for (const sym of sch.symbols) {
      const lib = libById.get(sym.libId);
      if (!lib) continue;
      const pins = symbolPins(sym, lib);
      for (const pin of pins) {
        if (same(pin.at, at)) return pinSpinStyle(pin.angle, sym.angle, sym.mirror);
      }
    }
  }
  return ret;
}

/** A placed symbol's pins with their world positions and orientations. */
function symbolPins(sym: SchSymbol, lib: LibSymbol): { at: Vec2; angle: number }[] {
  const positions = symbolPinPositions(sym, lib);
  const angles: number[] = [];
  for (const unit of lib.units) {
    const unitOk =
      (unit.unit === 0 || unit.unit === sym.unit) &&
      (unit.bodyStyle === 0 || unit.bodyStyle === sym.bodyStyle);
    if (!unitOk) continue;
    for (const pin of unit.pins) angles.push(pin.angle);
  }
  return positions.map((at, i) => ({ at, angle: angles[i] ?? 0 }));
}

/**
 * GetPinSpinStyle (eeschema/symb_transforms_utils.cpp): the label faces away
 * from the pin's body, then follows the symbol's own rotation and mirroring.
 */
export function pinSpinStyle(
  pinAngle: number,
  symbolAngle: number,
  mirror: 'x' | 'y' | undefined,
): LabelSpin {
  const a = (((Math.round(pinAngle / 90) * 90) % 360) + 360) % 360;
  // PIN_RIGHT -> LEFT, PIN_LEFT -> RIGHT, PIN_UP -> BOTTOM, PIN_DOWN -> UP.
  let ret: LabelSpin = a === 0 ? 'left' : a === 180 ? 'right' : a === 90 ? 'bottom' : 'up';

  const rot90: Record<LabelSpin, LabelSpin> = {
    up: 'left',
    bottom: 'right',
    left: 'bottom',
    right: 'up',
  };
  const rot270: Record<LabelSpin, LabelSpin> = {
    up: 'right',
    bottom: 'left',
    left: 'up',
    right: 'bottom',
  };
  const rot180: Record<LabelSpin, LabelSpin> = {
    up: 'bottom',
    bottom: 'up',
    left: 'right',
    right: 'left',
  };
  const sa = (((Math.round(symbolAngle / 90) * 90) % 360) + 360) % 360;
  if (sa === 90) ret = rot90[ret];
  else if (sa === 270) ret = rot270[ret];
  else if (sa === 180) ret = rot180[ret];

  // Mirroring flips the axis it applies to, whatever the rotation was.
  if (mirror === 'x') ret = ret === 'up' ? 'bottom' : ret === 'bottom' ? 'up' : ret;
  if (mirror === 'y') ret = ret === 'left' ? 'right' : ret === 'right' ? 'left' : ret;
  return ret;
}

/**
 * The name a new label dropped at `at` should take, or '' if it should ask.
 * SCH_DRAWING_TOOLS::createNewLabel does this before opening the dialog: when
 * the wire under the click is already driven by a local or global label, the
 * new label copies that net's name and no dialog is shown at all
 * (findWireLabelDriverName).
 */
export function wireLabelDriverName(
  sch: Schematic,
  netlist: { netByItem: ReadonlyMap<string, number>; nets: readonly NetInfo[] } | null | undefined,
  at: Vec2,
): string {
  if (!netlist) return '';
  for (let i = 0; i < sch.lines.length; i++) {
    const line = sch.lines[i]!;
    if (line.kind !== 'wire') continue;
    if (!onSegmentPoint(line.start, line.end, at)) continue;
    const code = netlist.netByItem.get(refId('line', line.uuid, i));
    const net = code === undefined ? undefined : netlist.nets.find((n) => n.code === code);
    // Only a label-driven net names the new label: a pin-driven net's auto name
    // ("Net-(R1-Pad1)") is not something upstream copies.
    if (
      net &&
      (net.driverPriority === LOCAL_LABEL_PRIORITY || net.driverPriority === GLOBAL_PRIORITY)
    ) {
      return net.localName;
    }
  }
  return '';
}

/** CONNECTION_SUBGRAPH::PRIORITY values for the two label drivers. */
const LOCAL_LABEL_PRIORITY = 4;
const GLOBAL_PRIORITY = 7;

/** What `wireLabelDriverName` needs of a net (the netlist's own Net type). */
interface NetInfo {
  code: number;
  localName: string;
  driverPriority: number;
}

/** Is `p` on the segment a→b (KiCad's Items().Overlapping test, squared off)? */
function onSegmentPoint(a: Vec2, b: Vec2, p: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return (
    Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) < 1 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
