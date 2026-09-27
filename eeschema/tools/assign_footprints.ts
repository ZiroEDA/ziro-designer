// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/assign_footprints.cpp`: `SCH_EDITOR_CONTROL::AssignFootprints`,
 * what the schematic does with CvPcb's `MAIL_ASSIGN_FOOTPRINTS` — a
 * `(cvpcb_netlist (ref "R1" (fpid "Lib:Name")) …)` written by
 * `NETLIST::FormatCvpcbNetlist`.
 *
 * Upstream reads the payload with DSNLEXER into a PTREE; the s-expression
 * reader here gives the same nodes. The schematic's items are immutable, so the
 * changes come back as one EditCommand per sheet file, pushed together as the
 * one "Assign Footprints" commit.
 */
import { head, parse } from '@ziroeda/sexpr';
import { arg, childNamed, childrenNamed } from '@ziroeda/sexpr/query.js';
import type { Schematic, SchField, SchSymbol } from '../types.js';
import { buildPropertyNode } from '../sch_io/sexpr/write-schematic.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';
import { restoreSymbols } from './properties.js';

/** One `(ref …)` of the payload: a reference and the footprint it is to carry. */
export interface CvpcbAssignment {
  reference: string;
  footprint: string;
}

/**
 * The `(ref …)` nodes of a `cvpcb_netlist`, in order. Throws, as
 * `doc.get_child( "cvpcb_netlist" )` does, when the payload is not one.
 */
export function parseCvpcbNetlist(aChangedSetOfReferences: string): CvpcbAssignment[] {
  const doc = parse(aChangedSetOfReferences);

  if (head(doc) !== 'cvpcb_netlist') throw new Error('No such node (cvpcb_netlist)');

  const out: CvpcbAssignment[] = [];

  for (const ref of childrenNamed(doc, 'ref')) {
    const reference = arg(ref, 0) ?? '';
    // Ensure the "fpid" node contains a footprint name, and get it if exists
    const fpid = childNamed(ref, 'fpid');
    const footprint = fpid ? (arg(fpid, 0) ?? '') : '';
    out.push({ reference, footprint });
  }

  return out;
}

const REFERENCE = 'Reference';
const FOOTPRINT = 'Footprint';

const fieldOf = (s: SchSymbol, key: string): SchField | undefined =>
  s.fields.find((f) => f.key === key);

/**
 * `SCH_EDITOR_CONTROL::AssignFootprints`: every symbol of the hierarchy whose
 * reference the payload names takes that footprint — all of its units, and
 * every instance ("for backwards-compatibility CvPcb currently updates all
 * instances of a symbol"). A Footprint field that was empty and visible is
 * hidden as it is filled. Symbols already carrying the footprint are left
 * alone, and nothing is returned when nothing changes (`if( isChanged )`).
 *
 * `files` is the hierarchy's sheet files; a sheet reached twice is one screen,
 * edited once. Power symbols are skipped (`SYMBOL_FILTER_NON_POWER`), by their
 * `#` reference as the rest of this port's netlist code does.
 */
export function assignFootprintsCommands(
  docs: ReadonlyMap<string, Schematic>,
  files: readonly string[],
  aChangedSetOfReferences: string,
): Map<string, EditCommand> | null {
  const assignments = parseCvpcbNetlist(aChangedSetOfReferences);
  const byFile = new Map<string, EditCommand>();
  const seen = new Set<string>();

  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);

    const doc = docs.get(file);

    if (!doc) continue;

    const changes = new Map<string, { footprint: string; hide: boolean }>();

    doc.symbols.forEach((symbol, index) => {
      const reference = fieldOf(symbol, REFERENCE)?.value ?? '';

      if (reference.startsWith('#')) return;

      for (const { reference: wanted, footprint } of assignments) {
        // We have found a candidate. It can be not unique (multiple parts per
        // package), so we *do not* stop the search here.
        if (wanted !== reference) continue;

        const footprintField = fieldOf(symbol, FOOTPRINT);
        const oldfp = footprintField?.value ?? '';
        const hide = oldfp === '' && !!footprintField && !footprintField.effects?.hidden;

        if (oldfp !== footprint)
          changes.set(refId('symbol', symbol.uuid, index), { footprint, hide });
      }
    });

    if (changes.size > 0) byFile.set(file, assignFootprintsCommand(changes));
  }

  return byFile.size > 0 ? byFile : null;
}

/** The per-sheet half: set each symbol's Footprint field, hiding it where asked. */
function assignFootprintsCommand(
  changes: ReadonlyMap<string, { footprint: string; hide: boolean }>,
): EditCommand {
  return {
    label: 'Assign Footprints',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => {
          const change = changes.get(refId('symbol', s.uuid, i));

          if (!change) return s;

          const fields = s.fields.map((f) => {
            if (f.key !== FOOTPRINT) return f;

            const next: SchField = {
              ...f,
              value: change.footprint,
              ...(change.hide ? { effects: { ...f.effects, hidden: true } } : {}),
            };
            return { ...next, source: buildPropertyNode(next) };
          });

          return { ...s, fields };
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      return restoreSymbols(new Map(prev.filter(([rid]) => changes.has(rid))));
    },
  };
}
