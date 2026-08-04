// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Add / delete commands, and junction auto-creation.
 *
 * Add and delete are exact inverses of each other, so undo/redo is lossless.
 * Items are identified by their stable `refId` (uuid-based for created items).
 * Junction auto-creation follows KiCad: a junction belongs where wires form a
 * tee or a 3+-way meeting, not where two wires merely cross or simply continue.
 */

import type {
  Schematic,
  SchSymbol,
  SchLine,
  SchJunction,
  SchNoConnect,
  SchLabel,
  SchDirectiveLabel,
  SchSheet,
  SheetPin,
  SchBusEntry,
  SchImage,
  SchTextBox,
  SchTable,
  LibGraphic,
  LibSymbol,
  Vec2,
} from '../types.js';
import type { Orientation } from '@ziroeda/common/src/transform.js';
import { refId, sheetPinId } from './hittest.js';
import { makeSymbol } from './build.js';
import type { EditCommand } from './command.js';
import { isExplicitJunctionNeeded } from './junction_helpers.js';

/** A batch of items to add or restore, grouped by kind. */
export interface ItemsBatch {
  symbols?: SchSymbol[];
  lines?: SchLine[];
  junctions?: SchJunction[];
  noConnects?: SchNoConnect[];
  labels?: SchLabel[];
  /** Netclass directive labels (SCH_DIRECTIVE_LABEL). */
  directiveLabels?: SchDirectiveLabel[];
  sheets?: SchSheet[];
  busEntries?: SchBusEntry[];
  images?: SchImage[];
  /** Sheet-level graphic shapes (rectangle/circle/arc/polyline on the notes layer). */
  graphics?: LibGraphic[];
  textBoxes?: SchTextBox[];
  tables?: SchTable[];
}

function batchIds(b: ItemsBatch): Set<string> {
  const ids = new Set<string>();
  b.symbols?.forEach((s, i) => ids.add(refId('symbol', s.uuid, i)));
  b.lines?.forEach((l, i) => ids.add(refId('line', l.uuid, i)));
  b.junctions?.forEach((j, i) => ids.add(refId('junction', j.uuid, i)));
  b.noConnects?.forEach((nc, i) => ids.add(refId('noconnect', nc.uuid, i)));
  b.labels?.forEach((l, i) => ids.add(refId('label', l.uuid, i)));
  b.directiveLabels?.forEach((d, i) => ids.add(refId('directive', d.uuid, i)));
  b.sheets?.forEach((s, i) => ids.add(refId('sheet', s.uuid, i)));
  b.busEntries?.forEach((be, i) => ids.add(refId('busentry', be.uuid, i)));
  b.images?.forEach((im, i) => ids.add(refId('image', im.uuid, i)));
  b.graphics?.forEach((_, i) => ids.add(refId('graphic', undefined, i)));
  b.textBoxes?.forEach((tb, i) => ids.add(refId('textbox', tb.uuid, i)));
  b.tables?.forEach((t, i) => ids.add(refId('table', t.uuid, i)));
  return ids;
}

/** An item that was deleted, and where in its array it used to be. */
interface Removed<T> {
  index: number;
  item: T;
}

/**
 * Everything a delete took out of `doc`, each with the index it came from.
 *
 * Undo has to put items *back where they were*, not on the end. The order of
 * these arrays is the order the writer emits items in, so appending turns a
 * delete-then-undo into a reordered file — and for an item with no uuid of its
 * own, `refId` falls back to the index, so appending changes its identity too.
 */
interface RemovedItems {
  symbols: Removed<SchSymbol>[];
  lines: Removed<SchLine>[];
  junctions: Removed<SchJunction>[];
  noConnects: Removed<SchNoConnect>[];
  labels: Removed<SchLabel>[];
  directiveLabels: Removed<SchDirectiveLabel>[];
  sheets: Removed<SchSheet>[];
  busEntries: Removed<SchBusEntry>[];
  images: Removed<SchImage>[];
  graphics: Removed<LibGraphic>[];
  textBoxes: Removed<SchTextBox>[];
  tables: Removed<SchTable>[];
  /**
   * Pins taken off a sheet that itself survived. A sheet pin is an item of its
   * own (SCH_SHEET_PIN), so Delete on one removes just it — and nothing used to
   * collect it, which made deleting a sheet pin permanently unundoable.
   */
  sheetPins: { sheetIndex: number; pinIndex: number; pin: SheetPin }[];
}

const removedFrom = <T>(
  arr: readonly T[],
  id: (item: T, i: number) => string,
  ids: ReadonlySet<string>,
): Removed<T>[] =>
  arr.flatMap((item, index) => (ids.has(id(item, index)) ? [{ index, item }] : []));

function collectByIds(doc: Schematic, ids: ReadonlySet<string>): RemovedItems {
  const sheets = removedFrom(doc.sheets, (s, i) => refId('sheet', s.uuid, i), ids);
  const deletedSheets = new Set(sheets.map((r) => r.index));
  const sheetPins: RemovedItems['sheetPins'] = [];
  doc.sheets.forEach((sh, sheetIndex) => {
    // A pin on a sheet that is going too comes back with the sheet.
    if (deletedSheets.has(sheetIndex)) return;
    const shId = refId('sheet', sh.uuid, sheetIndex);
    sh.pins.forEach((pin, pinIndex) => {
      if (ids.has(sheetPinId(shId, pinIndex))) sheetPins.push({ sheetIndex, pinIndex, pin });
    });
  });

  return {
    symbols: removedFrom(doc.symbols, (s, i) => refId('symbol', s.uuid, i), ids),
    lines: removedFrom(doc.lines, (l, i) => refId('line', l.uuid, i), ids),
    junctions: removedFrom(doc.junctions, (j, i) => refId('junction', j.uuid, i), ids),
    noConnects: removedFrom(doc.noConnects, (nc, i) => refId('noconnect', nc.uuid, i), ids),
    labels: removedFrom(doc.labels, (l, i) => refId('label', l.uuid, i), ids),
    directiveLabels: removedFrom(
      doc.directiveLabels ?? [],
      (d, i) => refId('directive', d.uuid, i),
      ids,
    ),
    sheets,
    busEntries: removedFrom(doc.busEntries, (be, i) => refId('busentry', be.uuid, i), ids),
    images: removedFrom(doc.images, (im, i) => refId('image', im.uuid, i), ids),
    graphics: removedFrom(doc.graphics, (_g, i) => refId('graphic', undefined, i), ids),
    textBoxes: removedFrom(doc.textBoxes, (tb, i) => refId('textbox', tb.uuid, i), ids),
    tables: removedFrom(doc.tables, (t, i) => refId('table', t.uuid, i), ids),
    sheetPins,
  };
}

/** Put `removed` back into `kept` at the indices they came from. */
function spliceBack<T>(kept: readonly T[], removed: readonly Removed<T>[]): readonly T[] {
  if (removed.length === 0) return kept;
  const byIndex = new Map(removed.map((r) => [r.index, r.item]));
  const out: T[] = [];
  let k = 0;
  for (let i = 0; i < kept.length + removed.length; i++) {
    const back = byIndex.get(i);
    out.push(back !== undefined ? back : kept[k++]!);
  }
  return out;
}

/** Undo of a delete: every item back at its old index, sheet pins included. */
function restoreRemoved(removed: RemovedItems, ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Delete',
    apply(doc: Schematic): Schematic {
      const sheets = spliceBack(doc.sheets, removed.sheets);
      // Pins go back after the sheets do, so the recorded sheet index lines up.
      const bySheet = new Map<number, Removed<SheetPin>[]>();
      for (const { sheetIndex, pinIndex, pin } of removed.sheetPins) {
        const arr = bySheet.get(sheetIndex) ?? [];
        arr.push({ index: pinIndex, item: pin });
        bySheet.set(sheetIndex, arr);
      }
      return {
        ...doc,
        symbols: spliceBack(doc.symbols, removed.symbols),
        lines: spliceBack(doc.lines, removed.lines),
        junctions: spliceBack(doc.junctions, removed.junctions),
        noConnects: spliceBack(doc.noConnects, removed.noConnects),
        labels: spliceBack(doc.labels, removed.labels),
        directiveLabels: spliceBack(doc.directiveLabels ?? [], removed.directiveLabels),
        sheets: bySheet.size
          ? sheets.map((sh, i) => {
              const pins = bySheet.get(i);
              return pins ? { ...sh, pins: spliceBack(sh.pins, pins) } : sh;
            })
          : sheets,
        busEntries: spliceBack(doc.busEntries, removed.busEntries),
        images: spliceBack(doc.images, removed.images),
        graphics: spliceBack(doc.graphics, removed.graphics),
        textBoxes: spliceBack(doc.textBoxes, removed.textBoxes),
        tables: spliceBack(doc.tables, removed.tables),
      };
    },
    invert: () => deleteByIds(ids),
  };
}

/** Add a batch of items. Inverse: delete exactly those items. */
export function addItems(batch: ItemsBatch): EditCommand {
  return {
    label: 'Add',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: batch.symbols?.length ? [...doc.symbols, ...batch.symbols] : doc.symbols,
        lines: batch.lines?.length ? [...doc.lines, ...batch.lines] : doc.lines,
        junctions: batch.junctions?.length ? [...doc.junctions, ...batch.junctions] : doc.junctions,
        noConnects: batch.noConnects?.length
          ? [...doc.noConnects, ...batch.noConnects]
          : doc.noConnects,
        labels: batch.labels?.length ? [...doc.labels, ...batch.labels] : doc.labels,
        directiveLabels: batch.directiveLabels?.length
          ? [...(doc.directiveLabels ?? []), ...batch.directiveLabels]
          : doc.directiveLabels,
        sheets: batch.sheets?.length ? [...doc.sheets, ...batch.sheets] : doc.sheets,
        busEntries: batch.busEntries?.length
          ? [...doc.busEntries, ...batch.busEntries]
          : doc.busEntries,
        images: batch.images?.length ? [...doc.images, ...batch.images] : doc.images,
        graphics: batch.graphics?.length ? [...doc.graphics, ...batch.graphics] : doc.graphics,
        textBoxes: batch.textBoxes?.length ? [...doc.textBoxes, ...batch.textBoxes] : doc.textBoxes,
        tables: batch.tables?.length ? [...doc.tables, ...batch.tables] : doc.tables,
      };
    },
    invert(): EditCommand {
      return deleteByIds(batchIds(batch));
    },
  };
}

/** Delete every item whose id is in `ids`. Inverse: re-add those items. */
export function deleteByIds(ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Delete',
    apply(doc: Schematic): Schematic {
      if (ids.size === 0) return doc;
      return {
        ...doc,
        symbols: doc.symbols.filter((s, i) => !ids.has(refId('symbol', s.uuid, i))),
        lines: doc.lines.filter((l, i) => !ids.has(refId('line', l.uuid, i))),
        junctions: doc.junctions.filter((j, i) => !ids.has(refId('junction', j.uuid, i))),
        noConnects: doc.noConnects.filter((nc, i) => !ids.has(refId('noconnect', nc.uuid, i))),
        labels: doc.labels.filter((l, i) => !ids.has(refId('label', l.uuid, i))),
        directiveLabels: (doc.directiveLabels ?? []).filter(
          (d, i) => !ids.has(refId('directive', d.uuid, i)),
        ),
        // A sheet survives, minus any of its pins that were selected: a pin is
        // an item of its own (SCH_SHEET_PIN), so Delete on one removes just it.
        // Pins are dropped before the sheets are, so each sheet still knows its
        // own index and the pin ids still resolve.
        sheets: doc.sheets
          .map((s, i) => {
            const shId = refId('sheet', s.uuid, i);
            if (!s.pins.some((_, k) => ids.has(sheetPinId(shId, k)))) return s;
            return { ...s, pins: s.pins.filter((_, k) => !ids.has(sheetPinId(shId, k))) };
          })
          .filter((_, i) => !ids.has(refId('sheet', doc.sheets[i]!.uuid, i))),
        busEntries: doc.busEntries.filter((be, i) => !ids.has(refId('busentry', be.uuid, i))),
        images: doc.images.filter((im, i) => !ids.has(refId('image', im.uuid, i))),
        graphics: doc.graphics.filter((_, i) => !ids.has(refId('graphic', undefined, i))),
        textBoxes: doc.textBoxes.filter((tb, i) => !ids.has(refId('textbox', tb.uuid, i))),
        tables: doc.tables.filter((t, i) => !ids.has(refId('table', t.uuid, i))),
      };
    },
    invert(before: Schematic): EditCommand {
      return restoreRemoved(collectByIds(before, ids), ids);
    },
  };
}

/**
 * Place a symbol from a library definition at `at`. Adds the placed instance and,
 * if not already present, embeds the library definition in the schematic's
 * `lib_symbols` cache (as KiCad does). Undo removes the instance and the def if it
 * was newly added.
 */
export function placeSymbol(lib: LibSymbol, at: Vec2, orient?: Orientation, unit = 1): EditCommand {
  return placeCmd(lib, makeSymbol(lib, at, orient, unit));
}

/**
 * Place a symbol that has already been built rather than one made from the
 * library defaults — what Place Next Symbol Unit does, where the symbol is a
 * copy of an existing placement (`SCH_ACTIONS::PLACE_SYMBOL_PARAMS` with
 * `reannotate = false`).
 */
export function placeSymbolInstance(lib: LibSymbol, sym: SchSymbol): EditCommand {
  return placeCmd(lib, sym);
}

function placeCmd(lib: LibSymbol, sym: SchSymbol): EditCommand {
  return {
    label: 'Place symbol',
    apply(doc: Schematic): Schematic {
      const hasLib = doc.libSymbols.some((l) => l.libId === lib.libId);
      return {
        ...doc,
        libSymbols: hasLib ? doc.libSymbols : [...doc.libSymbols, lib],
        symbols: [...doc.symbols, sym],
      };
    },
    invert(before: Schematic): EditCommand {
      const hadLib = before.libSymbols.some((l) => l.libId === lib.libId);
      return removeSymbolCmd(lib, sym, hadLib);
    },
  };
}

function removeSymbolCmd(lib: LibSymbol, sym: SchSymbol, keepLib: boolean): EditCommand {
  return {
    label: 'Delete symbol',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.filter((s) => s.uuid !== sym.uuid),
        libSymbols: keepLib ? doc.libSymbols : doc.libSymbols.filter((l) => l.libId !== lib.libId),
      };
    },
    invert(): EditCommand {
      return placeCmd(lib, sym);
    },
  };
}

/** Replace the wire/bus/line at `index` with `next` (e.g. after editing its stroke). */
export function replaceLine(index: number, next: SchLine): EditCommand {
  return {
    label: 'Edit Line',
    apply(doc: Schematic): Schematic {
      return { ...doc, lines: doc.lines.map((l, i) => (i === index ? next : l)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceLine(index, before.lines[index]!);
    },
  };
}

/**
 * Replace the bus entry at `index` with `next`.
 *
 * Upstream groups `SCH_BUS_WIRE_ENTRY_T` with `SCH_LINE_T` and `SCH_JUNCTION_T`
 * in `SCH_EDIT_TOOL::Properties`, so an entry opens the same
 * DIALOG_WIRE_BUS_PROPERTIES a wire does and its stroke is editable.
 */
export function replaceBusEntry(index: number, next: SchBusEntry): EditCommand {
  return {
    label: 'Edit Bus Entry',
    apply(doc: Schematic): Schematic {
      return { ...doc, busEntries: doc.busEntries.map((b, i) => (i === index ? next : b)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceBusEntry(index, before.busEntries[index]!);
    },
  };
}

/** Replace the junction at `index` with `next` (e.g. after editing its diameter). */
export function replaceJunction(index: number, next: SchJunction): EditCommand {
  return {
    label: 'Edit Junction',
    apply(doc: Schematic): Schematic {
      return { ...doc, junctions: doc.junctions.map((j, i) => (i === index ? next : j)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceJunction(index, before.junctions[index]!);
    },
  };
}

/** Replace the label at `index` with `next` (e.g. after editing its text/shape). */
export function replaceLabel(index: number, next: SchLabel): EditCommand {
  return {
    label: 'Edit Label',
    apply(doc: Schematic): Schematic {
      return { ...doc, labels: doc.labels.map((l, i) => (i === index ? next : l)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceLabel(index, before.labels[index]!);
    },
  };
}

/** Replace one netclass directive label (Directive Label Properties). */
export function replaceDirectiveLabel(index: number, next: SchDirectiveLabel): EditCommand {
  return {
    label: 'Edit Directive Label',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        directiveLabels: (doc.directiveLabels ?? []).map((d, i) => (i === index ? next : d)),
      };
    },
    invert(before: Schematic): EditCommand {
      return replaceDirectiveLabel(index, (before.directiveLabels ?? [])[index]!);
    },
  };
}

/**
 * Lock / unlock the selected symbols (SCH_EDIT_TOOL::modifyLockSelected).
 * `mode` 'lock' sets, 'unlock' clears. 'toggle' resolves the way upstream does:
 * if ANY selected symbol is locked the whole selection is unlocked, otherwise
 * the whole selection is locked, it is not a per-item flip. Only symbols
 * carry a lock state in the schematic grammar.
 */
export function setSymbolsLockedCommand(
  ids: ReadonlySet<string>,
  mode: 'lock' | 'unlock' | 'toggle',
): EditCommand {
  return {
    label: mode === 'unlock' ? 'Unlock' : 'Lock',
    apply(doc: Schematic): Schematic {
      // Resolve TOGGLE against the current state: any locked → unlock all.
      const target =
        mode === 'toggle'
          ? !doc.symbols.some((s, i) => ids.has(refId('symbol', s.uuid, i)) && s.locked)
          : mode === 'lock';
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) =>
          ids.has(refId('symbol', s.uuid, i)) ? { ...s, locked: target } : s,
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      // Restore each touched symbol's prior lock state exactly.
      const prior = new Map<string, boolean>();
      before.symbols.forEach((s, i) => {
        const id = refId('symbol', s.uuid, i);
        if (ids.has(id)) prior.set(id, s.locked ?? false);
      });
      return {
        label: mode === 'unlock' ? 'Unlock' : 'Lock',
        apply(doc: Schematic): Schematic {
          return {
            ...doc,
            symbols: doc.symbols.map((s, i) => {
              const id = refId('symbol', s.uuid, i);
              return prior.has(id) ? { ...s, locked: prior.get(id)! } : s;
            }),
          };
        },
        invert(): EditCommand {
          return setSymbolsLockedCommand(ids, mode);
        },
      };
    },
  };
}

/** Replace the sheet at `index` with `next` (e.g. after adding a sheet pin). */
export function replaceSheet(index: number, next: SchSheet): EditCommand {
  return {
    label: 'Edit Sheet',
    apply(doc: Schematic): Schematic {
      return { ...doc, sheets: doc.sheets.map((s, i) => (i === index ? next : s)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceSheet(index, before.sheets[index]!);
    },
  };
}

/** Replace the symbol at `index` with `next` (its fields, orientation, or the
 *  attributes the Attributes menu sets). */
export function replaceSymbol(index: number, next: SchSymbol): EditCommand {
  return {
    label: 'Edit Symbol',
    apply(doc: Schematic): Schematic {
      return { ...doc, symbols: doc.symbols.map((s, i) => (i === index ? next : s)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceSymbol(index, before.symbols[index]!);
    },
  };
}

/** Replace the image at `index` with `next` (its position, scale, or a payload
 *  rewritten by Convert to Greyscale). */
export function replaceImage(index: number, next: SchImage): EditCommand {
  return {
    label: 'Edit Image',
    apply(doc: Schematic): Schematic {
      return { ...doc, images: doc.images.map((im, i) => (i === index ? next : im)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceImage(index, before.images[index]!);
    },
  };
}

/** Replace the sheet-level graphic shape at `index` with `next` (its border and
 *  fill, from DIALOG_SHAPE_PROPERTIES, or its geometry from the point editor). */
export function replaceGraphic(index: number, next: LibGraphic): EditCommand {
  return {
    label: 'Edit Shape',
    apply(doc: Schematic): Schematic {
      return { ...doc, graphics: doc.graphics.map((g, i) => (i === index ? next : g)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceGraphic(index, before.graphics[index]!);
    },
  };
}

/** Replace the text box at `index` with `next` (e.g. after editing its text). */
export function replaceTextBox(index: number, next: SchTextBox): EditCommand {
  return {
    label: 'Edit Text Box',
    apply(doc: Schematic): Schematic {
      return { ...doc, textBoxes: doc.textBoxes.map((t, i) => (i === index ? next : t)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceTextBox(index, before.textBoxes[index]!);
    },
  };
}

/** Replace the table at `index` with `next` (e.g. after editing a cell). */
export function replaceTable(index: number, next: SchTable): EditCommand {
  return {
    label: 'Edit Table',
    apply(doc: Schematic): Schematic {
      return { ...doc, tables: doc.tables.map((t, i) => (i === index ? next : t)) };
    },
    invert(before: Schematic): EditCommand {
      return replaceTable(index, before.tables[index]!);
    },
  };
}

/**
 * Whether a junction dot belongs at `p` and none exists yet
 * (SCH_SCREEN::IsExplicitJunctionNeeded via JUNCTION_HELPERS::AnalyzePoint,
 * counts distinct exit directions of wires/buses plus pins, sheet pins, bus
 * entries and labels; see junction_helpers.ts).
 */
export function needsJunction(
  sch: Schematic,
  p: Vec2,
  libById?: ReadonlyMap<string, LibSymbol>,
): boolean {
  return isExplicitJunctionNeeded(sch, libById, p);
}
