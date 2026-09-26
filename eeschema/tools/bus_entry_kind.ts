// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Whether a drawn bus entry is really an entry at all.
 * Counterpart: `SCH_IO_KICAD_SEXPR::saveBusEntry`
 * (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.cpp).
 *
 * KiCad has two entry classes, `SCH_BUS_WIRE_ENTRY` and `SCH_BUS_BUS_ENTRY`,
 * but the file format has only one token. A bus-to-bus entry is never written
 * as `(bus_entry …)`:
 *
 *     // Bus to bus entries are converted to bus line segments.
 *     if( aBusEntry->GetClass() == "SCH_BUS_BUS_ENTRY" ) { … saveLine( … ); return; }
 *
 * and `parseBusEntry` only ever builds a `SCH_BUS_WIRE_ENTRY`, so no file can
 * load one back. A bus-to-bus entry therefore exists only in memory, between
 * being drawn and the next save.
 *
 * Our model has no entry *class* — an entry is a position and a size — so
 * rather than carry a distinction the file cannot hold, the decision is made
 * where it is observable: at the moment the stub is drawn. A stub with both
 * ends on a bus becomes a bus segment immediately, which is exactly the
 * document KiCad would have after one save-and-reload. Deciding it at save
 * time instead would need a document-wide query from inside an item-local
 * writer, and would still round-trip to the same thing.
 */

import type { LibSymbol, Schematic, SchLine, SchBusEntry, Vec2 } from '../types.js';
import { analyzePoint } from './junction_helpers.js';
import { makeBusEntry } from './build-graphics.js';
import { makeBus } from './build.js';

/** The far end of an entry drawn at `at` with `size` (signs carry direction). */
export const busEntryEnd = (at: Vec2, size: Vec2): Vec2 => ({
  x: at.x + size.x,
  y: at.y + size.y,
});

/**
 * True when both ends of the stub land on a bus, which is what makes it a
 * `SCH_BUS_BUS_ENTRY` upstream.
 */
export function isBusToBus(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  at: Vec2,
  size: Vec2,
): boolean {
  if (!analyzePoint(sch, libById, at).hasBusAtPoint) return false;
  return analyzePoint(sch, libById, busEntryEnd(at, size)).hasBusAtPoint;
}

/**
 * The item a drawn stub should actually become: a bus segment when it runs
 * bus-to-bus, an entry otherwise.
 */
export function makeBusEntryOrSegment(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  at: Vec2,
  size: Vec2,
): { busEntries?: SchBusEntry[]; lines?: SchLine[] } {
  if (isBusToBus(sch, libById, at, size)) {
    return { lines: [makeBus(at, busEntryEnd(at, size))] };
  }
  return { busEntries: [makeBusEntry(at, size)] };
}
