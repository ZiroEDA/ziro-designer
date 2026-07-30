// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PIN helpers. Counterpart: `eeschema/sch_pin.cpp`.
 *
 * Ported here is the pin-to-pad resolution, SCH_PIN::GetEffectivePadNumber, which
 * every consumer that has to name a *pad* rather than a *pin* goes through: the
 * netlist exporters, ERC's pin-map tests and the board's back-annotation. A symbol
 * pin does not have to carry the pad number it lands on: a named pin map, the
 * footprint association that selects one, and per-instance sparse edits can all
 * remap it, and the resolved pad may itself use stacked-pin notation (`[1,2]`) and
 * so stand for several pads.
 */

import { expandStackedPinNotation } from '@ziroeda/common/src/string_utils.js';
import type { LibSymbol, SchSymbol } from './types.js';

/** SCH_PIN::PAD_RESOLUTION, how a pin's pad number was arrived at. */
export type PadResolution = 'mapped' | 'identity' | 'unmapped';

export interface EffectivePadNumber {
  /** The resolved pad number; empty when UNMAPPED. */
  padNumber: string;
  state: PadResolution;
}

/**
 * SCH_PIN::GetEffectivePadNumber, the pad number `pinNumber` resolves to on
 * `footprintLibId`, in upstream's order:
 *
 *   0. an instance-local sparse edit for this pin (unless identity is forced),
 *   1. MAPPED, an explicit entry of the resolved pin map; needs no footprint,
 *   2. IDENTITY, no entry, but the footprint carries a pad of that number,
 *   3. UNMAPPED, the footprint has no such pad.
 *
 * `footprintPads` undefined means "no footprint available": the caller gets the
 * pin number back as an assumed identity, which is the painter's path.
 */
export function getEffectivePadNumber(
  pinNumber: string,
  symbol: SchSymbol,
  lib: LibSymbol | undefined,
  footprintLibId: string,
  footprintPads: ReadonlySet<string> | undefined,
): EffectivePadNumber {
  const override = symbol.pinMapOverride;
  const mode = override?.mode ?? 'library_default';
  const maps = lib?.pinMaps ?? [];
  let map = mode === 'named_map' ? maps.find((m) => m.name === override?.mapName) : undefined;

  // Library default, or a named map that no longer exists, resolves through the
  // footprint association.
  if (!map && mode !== 'identity' && lib) {
    const assoc = (lib.associatedFootprints ?? []).find((a) => a.footprintLibId === footprintLibId);
    if (assoc) map = maps.find((m) => m.name === assoc.mapName);
  }

  // Instance-local sparse edits patch the resolved map, but are ignored under
  // forced identity per the PIN_MAP_INSTANCE_OVERRIDE contract.
  if (mode !== 'identity') {
    const edit = override?.edits.find((e) => e.pin === pinNumber);
    if (edit) return { padNumber: edit.pad, state: 'mapped' };
  }

  const entry = map?.entries.find((e) => e.pin === pinNumber);
  if (entry) return { padNumber: entry.pad, state: 'mapped' };

  if (footprintPads?.has(pinNumber)) return { padNumber: pinNumber, state: 'identity' };

  return footprintPads
    ? { padNumber: '', state: 'unmapped' }
    : { padNumber: pinNumber, state: 'identity' };
}

/**
 * NETLIST_EXPORTER_BASE::resolvePadNumbers, the pad numbers one pin contributes
 * to a netlist: the resolved pad expanded through stacked-pin notation, or nothing
 * at all when the pin maps to no pad on its footprint (an UNMAPPED pin must not
 * open a net entry).
 */
export function resolvePadNumbers(
  pinNumber: string,
  symbol: SchSymbol,
  lib: LibSymbol | undefined,
  footprintLibId: string,
  footprintPads: ReadonlySet<string> | undefined,
): string[] {
  const { padNumber, state } = getEffectivePadNumber(
    pinNumber,
    symbol,
    lib,
    footprintLibId,
    footprintPads,
  );
  if (state === 'unmapped') return [];
  return expandStackedPinNotation(padNumber).numbers;
}
