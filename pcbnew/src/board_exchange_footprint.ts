// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a library footprint on a board, and swapping one for another.
 * Counterparts: `pcbnew/netlist_reader/pcb_netlist_utils.cpp`
 * (LoadFootprintFromProject) and `pcbnew/board_exchange_footprint.cpp`
 * (BOARD::ExchangeFootprint).
 *
 * A library `.kicad_mod` footprint and a board footprint are the same node with a
 * different envelope: the library form has no placement, no UUID, no symbol link
 * and no nets, and it carries the `(version)`/`(generator)` header a board
 * footprint must not. So `placeFootprint` builds that envelope and re-reads the
 * node in board context, which is what bakes the children from footprint-local to
 * board coordinates, the same path the board reader takes.
 *
 * `exchangeFootprint` then replaces a placed footprint with a fresh copy from the
 * library while carrying over everything the board owns rather than the library:
 * position, orientation, side, lock state, UUID, the reference text, and each pad's
 * net and pin function. Everything else (text styling and position, fabrication
 * attributes, clearance overrides, 3D models) comes from the library, which is what
 * ExchangeFootprint's default reset flags do.
 */

import { atom, head, isList, str, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { computeFootprintShift } from './footprint_utils.js';
import { fpidItemName } from './netlist_reader/pcb_netlist.js';
import { readBoardFootprint } from './read-board.js';
import type { PcbFootprint } from './types.js';

/** A UUID for a new board item (KIID's default constructor). */
export function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Internal units -> trimmed millimetre string, KiCad's formatInternalUnits. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/**
 * Children the placement envelope owns: the library node's own header
 * (`version`/`generator`/`generator_version`, which CTL_OMIT_FOOTPRINT_VERSION drops
 * for a board footprint) plus anything `placeFootprint` writes itself.
 */
const ENVELOPE_CHILDREN = new Set([
  'version',
  'generator',
  'generator_version',
  'at',
  'layer',
  'uuid',
  'tstamp',
  'locked',
  'path',
  'sheetname',
  'sheetfile',
]);

export interface PlaceFootprintOptions {
  /** The full LIB_ID the board footprint should carry ("Library:Footprint"). */
  fpid: string;
  /** Board position of the footprint anchor. */
  at: VECTOR2I;
  /** Orientation in degrees. */
  angle?: number;
  /** 'F.Cu' or 'B.Cu'. */
  layer?: string;
  uuid?: string;
  /** `(path …)`, the linked symbol's KIID_PATH. */
  path?: string;
  sheetname?: string;
  sheetfile?: string;
  locked?: boolean;
}

/**
 * Turn a library footprint into a board footprint at a given place.
 * `LoadFootprintFromProject` + `FOOTPRINT::SetPosition`: all nets are cleared (a
 * library footprint's pads carry orphaned net codes) and the placement envelope is
 * written, then the node is re-read so children land in board coordinates.
 */
export function placeFootprint(
  libFootprint: PcbFootprint,
  opts: PlaceFootprintOptions,
): PcbFootprint | null {
  const src = libFootprint.source;
  if (src.items.length === 0) return null;

  const items: SNode[] = [atom('footprint'), str(opts.fpid)];

  if (opts.locked) items.push(list(atom('locked'), atom('yes')));
  items.push(list(atom('layer'), str(opts.layer ?? 'F.Cu')));
  items.push(list(atom('uuid'), str(opts.uuid ?? newUuid())));

  const angle = opts.angle ?? 0;
  items.push(
    angle
      ? list(atom('at'), atom(mm(opts.at.x)), atom(mm(opts.at.y)), atom(String(angle)))
      : list(atom('at'), atom(mm(opts.at.x)), atom(mm(opts.at.y))),
  );

  // Everything the library node holds, minus its own header and any placement it
  // happened to carry, and minus the pads' stale `(net …)` (ClearAllNets).
  for (let i = 1; i < src.items.length; i++) {
    const it = src.items[i]!;
    if (!isList(it)) continue; // the library's own name atom
    const h = head(it) ?? '';
    if (ENVELOPE_CHILDREN.has(h)) continue;
    items.push(h === 'pad' ? clearPadNet(it) : it);
  }

  if (opts.path) items.push(list(atom('path'), str(opts.path)));
  if (opts.sheetname) items.push(list(atom('sheetname'), str(opts.sheetname)));
  if (opts.sheetfile) items.push(list(atom('sheetfile'), str(opts.sheetfile)));

  return readBoardFootprint({ kind: 'list', items });
}

/** FOOTPRINT::ClearAllNets, drop a pad's `(net …)`, `(pinfunction …)`, `(pintype …)`. */
function clearPadNet(pad: SList): SList {
  return {
    kind: 'list',
    items: pad.items.filter((it) => {
      if (!isList(it)) return true;
      const h = head(it);
      return h !== 'net' && h !== 'pinfunction' && h !== 'pintype';
    }),
  };
}

/**
 * BOARD::ExchangeFootprint with the netlist updater's arguments
 * (`matchPadPositions = true`, every reset flag at its default): the replacement
 * comes from the library, and only the board-owned state listed in this module's
 * header is carried over.
 *
 * The one thing this does not reproduce is per-item UUID preservation for graphics,
 * zones and fields, KiCad matches those by geometric similarity, which the typed
 * model has no counterpart for. Pads, whose UUIDs and nets do matter, are matched
 * by number.
 */
export function exchangeFootprint(
  existing: PcbFootprint,
  libFootprint: PcbFootprint,
  newFpid: string,
): PcbFootprint | null {
  // The shift to apply if the library footprint's anchor or body moved relative to
  // the one on the board.
  const probe = placeFootprint(libFootprint, {
    fpid: newFpid,
    at: existing.at,
    angle: existing.angle,
    layer: existing.layer,
  });
  if (!probe) return null;

  const shift = computeFootprintShift(existing, probe);
  const position = shift
    ? { x: existing.at.x + shift.shift.x, y: existing.at.y + shift.shift.y }
    : existing.at;
  const orientation =
    shift && !shift.angleShift.equals(ANGLE_0)
      ? existing.angle + shift.angleShift.AsDegrees()
      : existing.angle;

  const placed = placeFootprint(libFootprint, {
    fpid: newFpid,
    at: position,
    angle: orientation,
    layer: existing.layer,
    ...(existing.uuid ? { uuid: existing.uuid } : {}),
    ...(existing.path ? { path: existing.path } : {}),
    ...(existing.sheetname ? { sheetname: existing.sheetname } : {}),
    ...(existing.sheetfile ? { sheetfile: existing.sheetfile } : {}),
    ...(existing.locked ? { locked: true } : {}),
  });
  if (!placed) return null;

  // Pads: net, pin function and pin type belong to the board, matched by number.
  // An unmatched pad on the replacement starts unconnected.
  const oldPadsByNumber = new Map<string, (typeof existing.pads)[number][]>();
  for (const pad of existing.pads) {
    const arr = oldPadsByNumber.get(pad.number) ?? [];
    arr.push(pad);
    oldPadsByNumber.set(pad.number, arr);
  }
  const takenPads = new Map<string, number>();

  placed.pads = placed.pads.map((pad) => {
    const candidates = oldPadsByNumber.get(pad.number) ?? [];
    const taken = takenPads.get(pad.number) ?? 0;
    const oldPad = candidates[taken];
    if (!oldPad) return pad;
    takenPads.set(pad.number, taken + 1);
    return {
      ...pad,
      ...(oldPad.uuid ? { uuid: oldPad.uuid } : {}),
      ...(oldPad.net !== undefined ? { net: oldPad.net } : {}),
      ...(oldPad.pinFunction !== undefined ? { pinFunction: oldPad.pinFunction } : {}),
      ...(oldPad.pinType !== undefined ? { pinType: oldPad.pinType } : {}),
      source: carryPadNet(pad.source, oldPad.source),
    };
  });

  // Reference: the initial text is always used, never reset.
  const reference = existing.reference ?? '';
  // Value: reset only when it was a proxy for the footprint ID (replacing
  // "MountingHole-2.5mm" with "MountingHole-4.0mm").
  const valueWasFpidProxy = existing.value === fpidItemName(existing.lib);
  const value = valueWasFpidProxy ? (placed.value ?? '') : (existing.value ?? '');

  placed.reference = reference;
  placed.value = value;
  placed.texts = placed.texts.map((t) => {
    if (t.kind === 'reference')
      return { ...t, text: reference, source: setTextValue(t.source, reference) };
    if (t.kind === 'value') return { ...t, text: value, source: setTextValue(t.source, value) };
    return t;
  });

  // Fields the board has but the library copy does not are kept (deleteExtraTexts
  // applies to *texts*; fields fall through to the "clone the old one" branch).
  const placedFieldNames = new Set((placed.fields ?? []).map((f) => f.name));
  for (const field of existing.fields ?? []) {
    if (placedFieldNames.has(field.name)) continue;
    placed.fields = [...(placed.fields ?? []), field];
  }

  return placed;
}

/** Copy a pad's `(net …)` / `(pinfunction …)` / `(pintype …)` from the old source. */
function carryPadNet(next: SList, old: SList): SList {
  const carried = old.items.filter((it) => {
    if (!isList(it)) return false;
    const h = head(it);
    return h === 'net' || h === 'pinfunction' || h === 'pintype';
  });
  if (carried.length === 0) return next;
  return { kind: 'list', items: [...next.items, ...carried] };
}

/**
 * Rewrite the text of a `(property "Reference" "R1" …)` or `(fp_text reference "R1" …)`:
 * in both spellings the text is the second scalar after the head.
 */
function setTextValue(src: SList, value: string): SList {
  let seen = -1;
  const items = src.items.map((it) => {
    if (isList(it)) return it;
    seen++;
    return seen === 2 ? str(value) : it;
  });
  return { kind: 'list', items };
}
