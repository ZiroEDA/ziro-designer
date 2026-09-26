// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a library footprint on a board, and swapping one for another.
 * Counterparts: `pcbnew/netlist_reader/pcb_netlist_utils.cpp`
 * (LoadFootprintFromProject) and `PCB_EDIT_FRAME::ExchangeFootprint`
 * (`pcbnew/pcb_edit_frame.cpp`), which lives here until
 * `BOARD_NETLIST_UPDATER` takes a frame the way upstream's does.
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
import { kiidFromString, newKiid } from '@ziroeda/common/kiid.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { computeFootprintShift } from '../footprint_utils.js';
import { fpidItemName } from './pcb_netlist.js';
import { footprintViewOfBoard } from '../pcb_io/kicad_sexpr/board_view.js';
import { LSET_NameToLayer } from '../layer_ids.js';
import type { PcbFootprint } from '../types.js';

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
 * `LoadFootprintFromProject` + the placement: `FOOTPRINT( *lib )`, its nets
 * cleared (a library footprint's pads carry orphaned net codes), then
 * `SetPosition` / `SetOrientation`, which carry every child with the anchor,
 * and `Flip` for the back side, the way `ExchangeFootprint` puts a new
 * footprint on the side of the old one (pcb_edit_frame.cpp:2671).
 */
export function placeFootprint(
  libFootprint: PcbFootprint,
  opts: PlaceFootprintOptions,
): PcbFootprint | null {
  const lib = libFootprint.k;
  if (!lib) return null;

  // `FOOTPRINT( *lib )`: a copy of the library footprint, then the board's own
  // placement written over it — CTL_OMIT_FOOTPRINT_VERSION drops the library
  // header's version and generator, which live on the board instead.
  const k = lib.Clone();
  k.SetInitialComments(null);
  k.SetFPIDAsString(opts.fpid);
  k.SetLocked(opts.locked ?? false);
  (k as { m_Uuid: string }).m_Uuid = opts.uuid ?? newKiid();
  const path = opts.path ?? '';
  k.SetPath(
    path === ''
      ? []
      : path
          .split('/')
          .filter((s) => s !== '')
          .map(kiidFromString),
  );
  k.SetSheetname(opts.sheetname ?? '');
  k.SetSheetfile(opts.sheetfile ?? '');

  // `FOOTPRINT::ClearAllNets`: a library pad's net, pin function and type are
  // the symbol's business, and the netlist fills them in.
  k.ClearAllNets();
  for (const pad of k.Pads()) {
    pad.SetPinFunction('');
    pad.SetPinType('');
  }

  // A library footprint sits at the origin, unrotated; the children ride the anchor.
  k.SetPosition({ x: opts.at.x, y: opts.at.y });
  k.SetOrientation(new EDA_ANGLE(opts.angle ?? 0));
  if (LSET_NameToLayer(opts.layer ?? 'F.Cu') !== k.GetLayer())
    k.Flip(k.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

  return footprintViewOfBoard(k);
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
    if (t.kind === 'reference') return { ...t, text: reference };
    if (t.kind === 'value') return { ...t, text: value };
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
