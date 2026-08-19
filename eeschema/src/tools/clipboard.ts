// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copy / paste / duplicate, ported from KiCad's SCH_EDITOR_CONTROL
 * (eeschema/tools/sch_editor_control.cpp):
 *
 *  - doCopy(): the clipboard payload is KiCad's own format, a bare sequence of
 *    S-expressions, `(lib_symbols <defs used by the selection>)` followed by the
 *    selected items, exactly what SCH_IO_KICAD_SEXPR::Format(SCH_SELECTION*)
 *    writes. Text copied here pastes into desktop KiCad and vice versa.
 *  - Paste(): parses the clipboard content (ParseSchematic with
 *    aIsCopyableOnly = true accepts the bare sequence), gives every pasted item
 *    a fresh UUID (pins included), merges the needed lib_symbols into the sheet,
 *    prunes clipboard-foreign instance data, and re-annotates any reference that
 *    collides with one already in the schematic (PASTE_MODE::UNIQUE_ANNOTATIONS,
 *    the default when automatic annotation is on). Content that isn't valid
 *    schematic data becomes a text item, as KiCad does.
 *  - Duplicate(): doCopy(true) into a local buffer + Paste from it.
 */

import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { head, isList, str, type SList } from '@ziroeda/sexpr/src/types.js';
import { readSchematic } from '../sch_io/sexpr/read-schematic.js';
import type { Schematic, SchSymbol, SchField, LibSymbol, Vec2 } from '../types.js';
import { writeSchematic } from '../sch_io/sexpr/write-schematic.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';
import {
  moveBusEntry,
  moveDirectiveLabel,
  moveGraphic,
  moveImage,
  moveSheet,
  moveTable,
  moveTextBox,
} from './move.js';
import { refId } from './hittest.js';
import { hasCellSelection, promoteCellSelection } from './table_cells.js';
import {
  makeLabel,
  nodeWithUuid,
  symbolNodeWithFreshUuids,
  symbolNodeWithoutInstances,
} from './build.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import type { EditCommand } from './command.js';
import type { ItemsBatch } from './mutate.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import {
  annotateHierarchy,
  splitReference,
  type AnnotateOptions,
  type AnnotateSheet,
} from './annotate.js';

// ----- copy -------------------------------------------------------------------

/**
 * Serialize the selected items to KiCad's clipboard text: `(lib_symbols ...)`
 * with the definitions the selected symbols use, then each item, top-level.
 * Uses the same write path as saving, so edited geometry is current.
 */
export function copySelectionText(sch: Schematic, rawIds: ReadonlySet<string>): string {
  // SCH_EDITOR_CONTROL special-cases a selection holding cells: what goes on
  // the clipboard is the table, since a cell out of its grid is not a thing
  // that can be pasted anywhere.
  const ids = hasCellSelection(rawIds) ? promoteCellSelection(rawIds) : rawIds;
  const symbols = sch.symbols.filter((s, i) => ids.has(refId('symbol', s.uuid, i)));
  const lines = sch.lines.filter((l, i) => ids.has(refId('line', l.uuid, i)));
  const junctions = sch.junctions.filter((j, i) => ids.has(refId('junction', j.uuid, i)));
  const noConnects = sch.noConnects.filter((nc, i) => ids.has(refId('noconnect', nc.uuid, i)));
  const labels = sch.labels.filter((l, i) => ids.has(refId('label', l.uuid, i)));

  const busEntries = sch.busEntries.filter((b, i) => ids.has(refId('busentry', b.uuid, i)));
  const images = sch.images.filter((im, i) => ids.has(refId('image', im.uuid, i)));
  const graphics = sch.graphics.filter((_g, i) => ids.has(refId('graphic', undefined, i)));
  const textBoxes = sch.textBoxes.filter((t, i) => ids.has(refId('textbox', t.uuid, i)));
  const directiveLabels = (sch.directiveLabels ?? []).filter((d, i) =>
    ids.has(refId('directive', d.uuid, i)),
  );
  const tables = sch.tables.filter((t, i) => ids.has(refId('table', t.uuid, i)));

  // SCH_IO_KICAD_SEXPR::Format(SCH_SELECTION*) looks the definition up under
  // the name the placement files it under, not under its lib_id:
  //
  //   wxString libSymbolLookup = symbol->GetLibId().Format().wx_str();
  //   if( !symbol->UseLibIdLookup() )
  //       libSymbolLookup = symbol->GetSchSymbolLibraryName();
  //
  // and `UseLibIdLookup()` is false exactly when the placement carries a
  // `(lib_name …)`, so the lookup is `GetSchSymbolLibraryName()` either way.
  // Keying on `libId` instead missed every symbol whose cached definition had
  // diverged from its library — after Update Symbol, or in any sheet holding
  // two different definitions of one lib_id — and copied it with no definition
  // at all, so it pasted body-less and pin-less.
  const usedLibNames = new Set(symbols.map((s) => schSymbolLibraryName(s)));
  const libs = sch.libSymbols.filter((l) => usedLibNames.has(l.libId));

  // Round the subset through the writer so item nodes carry current geometry.
  // `doCopy` copies whatever is selected, so every kind that can be selected
  // belongs here. Sheets are the one deliberate exception: KiCad ships each
  // sheet's screen along on the clipboard (m_supplementaryClipboard), which
  // needs multi-document paste support.
  const subset: Schematic = {
    ...sch,
    symbols,
    lines,
    junctions,
    noConnects,
    labels,
    sheets: [],
    busEntries,
    images,
    graphics,
    textBoxes,
    directiveLabels,
    tables,
    libSymbols: libs,
  };
  const root = writeSchematic(subset);

  const parts: string[] = [];
  for (const it of root.items) {
    if (!isList(it)) continue;
    const h = head(it);
    if (h === 'lib_symbols') {
      if (it.items.length > 1) parts.push(serialize(it));
    } else if (
      h === 'symbol' ||
      h === 'wire' ||
      h === 'bus' ||
      h === 'polyline' ||
      h === 'junction' ||
      h === 'no_connect' ||
      h === 'label' ||
      h === 'global_label' ||
      h === 'hierarchical_label' ||
      h === 'text' ||
      // The kinds that used to fall through this filter and vanish silently.
      h === 'bus_entry' ||
      h === 'text_box' ||
      h === 'rectangle' ||
      h === 'circle' ||
      h === 'arc' ||
      h === 'bezier' ||
      h === 'netclass_flag' ||
      h === 'image' ||
      h === 'table'
    ) {
      parts.push(serialize(it));
    }
  }
  return parts.join('\n');
}

// ----- paste ------------------------------------------------------------------

/** What a paste drops on the sheet: items (still at their copied positions) + libs. */
export interface PastePayload {
  batch: Required<ItemsBatch>;
  libs: LibSymbol[];
  /** KiCad's paste anchor: the leftmost item position (SCH_SELECTION::GetTopLeftItem). */
  refPoint: Vec2;
}

function setFieldValue(f: SchField, value: string): SchField {
  const items = f.source.items.slice();
  items[2] = str(value);
  const source: SList = { kind: 'list', items };
  return { ...f, value, source };
}

/**
 * PASTE_MODE (common/tool/actions.h): how pasted reference designators are
 * handled. 'unique' re-annotates duplicates (UNIQUE_ANNOTATIONS, the default),
 * 'keep' leaves them as copied (KEEP_ANNOTATIONS), 'remove' clears every
 * pasted designator back to its `X?` form (REMOVE_ANNOTATIONS).
 */
export type PasteMode = 'unique' | 'keep' | 'remove';

/** REMOVE_ANNOTATIONS: clear the reference back to its unannotated `X?` form. */
function clearAnnotation(sym: SchSymbol): SchSymbol {
  const refField = sym.fields.find((f) => f.key === 'Reference');
  if (!refField || refField.value.endsWith('?')) return sym;
  const { prefix } = splitReference(refField.value);
  const newRef = `${prefix || refField.value}?`;
  const fields = sym.fields.map((f) => (f.key === 'Reference' ? setFieldValue(f, newRef) : f));
  return { ...sym, fields };
}

const referenceOf = (sym: SchSymbol): string | undefined =>
  sym.fields.find((f) => f.key === 'Reference')?.value;

/** Everything `SCH_EDITOR_CONTROL::Paste` reads off the frame and the project. */
export interface PasteOptions {
  /**
   * The chosen PASTE_MODE. Upstream derives it from the annotation toggle —
   * `pasteMode = annotateAutomatic ? UNIQUE_ANNOTATIONS : REMOVE_ANNOTATIONS`
   * (sch_editor_control.cpp:2203) — and DIALOG_PASTE_SPECIAL overrides it.
   */
  mode?: PasteMode;
  /**
   * Every sheet of the project, `Schematic().Hierarchy()` (:2222). Reference
   * uniqueness is a hierarchy-wide question: upstream builds `existingRefs`
   * with `hierarchy.GetSymbols( existingRefs, SYMBOL_FILTER_ALL )` (:2249).
   * Pass the sheets with scope 'out' — they only reserve their numbers, which
   * is upstream's additionalRefs. Defaults to the destination sheet alone,
   * which is what a caller without a hierarchy to hand can honestly claim.
   */
  hierarchy?: readonly AnnotateSheet[];
  /**
   * SCHEMATIC_SETTINGS' annotation settings, read at :2201 and :2604-2606:
   * `m_AnnotateSortOrder`, `m_AnnotateMethod`, `m_AnnotateStartNum` and
   * `m_refDesTracker`. Defaults to KiCad's own defaults.
   */
  annotate?: Partial<Pick<AnnotateOptions, 'order' | 'algo' | 'startNumber' | 'tracker'>>;
  /** The destination sheet's page number, for the sheet-× algos. */
  sheetNumber?: number;
  /**
   * `forceRemoveAnnotations` (:2213): true only when DIALOG_PASTE_SPECIAL
   * explicitly chose "remove annotations" *and* that was not already the
   * default. It is what stops the "already in the schematic" rule below from
   * putting the annotations back.
   */
  forceRemoveAnnotations?: boolean;
}

/** The key the pasted items are filed under in the annotation pass; it must not
 *  collide with a real sheet file name. */
const CLIPBOARD_SHEET = '<clipboard>';

/**
 * The re-annotation pass at the tail of `Paste` (:2583-2652).
 *
 * Upstream collects the pasted symbols into `annotatedSymbols` and hands them
 * to the same `SCH_REFERENCE_LIST` machinery the Annotate dialog uses, so the
 * project's sort order, algorithm, start number and REFDES_TRACKER all apply:
 *
 *   annotatedSymbols[path].SetRefDesTracker( schematicSettings.m_refDesTracker );
 *   if( pasteMode == PASTE_MODE::UNIQUE_ANNOTATIONS )
 *       annotatedSymbols[path].ReannotateDuplicates( existingRefs, annotateAlgo );
 *   else
 *       annotatedSymbols[path].ReannotateByOptions( annotateOrder, annotateAlgo,
 *                                                   annotateStartNum, existingRefs,
 *                                                   false, &hierarchy );
 *
 * This used to be a bare `while (taken.has(prefix + n)) n++` starting at 1,
 * which ignored every one of those settings: a project on "sheet number × 100"
 * got R1 where KiCad gives R201, and retired designators were handed straight
 * back out.
 *
 * Which symbols take part differs by mode (:2586-2596): UNIQUE_ANNOTATIONS
 * renumbers everything pasted, every other mode only the ones
 * `SCH_REFERENCE::AlwaysAnnotate()` (sch_reference_list.cpp:826) is true for —
 * a power symbol or a `#`-prefixed reference — which is how a pasted `#PWR?`
 * still comes out numbered while `R?` stays `R?` for the user to annotate.
 */
function reannotatePasted(
  symbols: SchSymbol[],
  clip: Schematic,
  hierarchy: readonly AnnotateSheet[],
  mode: PasteMode,
  opts: PasteOptions,
): SchSymbol[] {
  if (symbols.length === 0) return symbols;

  const libById = new Map<string, LibSymbol>();
  for (const sheet of hierarchy)
    for (const l of sheet.doc.libSymbols) if (!libById.has(l.libId)) libById.set(l.libId, l);
  for (const l of clip.libSymbols) libById.set(l.libId, l);

  const pasted: AnnotateSheet = {
    file: CLIPBOARD_SHEET,
    doc: { ...clip, symbols },
    sheetNumber: opts.sheetNumber ?? 1,
    // UNIQUE_ANNOTATIONS renumbers the whole paste; the other modes only the
    // AlwaysAnnotate ones, which `selected` below narrows it to.
    scope: mode === 'unique' ? 'full' : 'selected',
  };
  let selected: Set<string> | undefined;
  if (mode !== 'unique') {
    const ids = new Set<string>();
    symbols.forEach((sym, i) => {
      const ref = referenceOf(sym) ?? '';
      const lib = libById.get(schSymbolLibraryName(sym));
      if (lib?.isPower === true || ref.startsWith('#')) ids.add(refId('symbol', sym.uuid, i));
    });
    if (ids.size === 0) return symbols;
    selected = ids;
  }

  // The hierarchy only reserves its numbers here (upstream's additionalRefs,
  // `AddItem` with `m_isNew = false`); nothing already on a sheet is renumbered
  // by a paste.
  const sheets: AnnotateSheet[] = [
    pasted,
    ...hierarchy.map((s) => ({ ...s, scope: 'out' as const })),
  ];

  const next = annotateHierarchy(
    sheets,
    libById,
    {
      scope: mode === 'unique' ? 'all' : 'selection',
      // `ReannotateDuplicates` passes UNSORTED, but `AnnotateByOptions`'s sort
      // switch has no UNSORTED case and falls through `default:` to
      // `SortByXCoordinate()` (sch_reference_list.cpp:372-377), so the
      // duplicate pass ends up sorted by X after all.
      order: mode === 'unique' ? 'x' : (opts.annotate?.order ?? 'x'),
      algo: opts.annotate?.algo ?? 'incremental',
      startNumber: mode === 'unique' ? 0 : (opts.annotate?.startNumber ?? 0),
      // `ReannotateByOptions` sets `ref.m_isNew = true` on every annotated
      // reference it is given ("We want to reannotate all references",
      // sch_reference_list.cpp:349), so a pasted R5 is re-issued rather than
      // left alone.
      resetExisting: true,
      // Only ReannotateDuplicates passes aStartAtCurrent.
      startAtCurrent: mode === 'unique',
      // SYMBOL_FILTER_ALL: `pastedSymbols` is built with it (:2385), and the
      // AlwaysAnnotate branch above exists precisely to number power symbols.
      includePower: true,
      ...(opts.annotate?.tracker ? { tracker: opts.annotate.tracker } : {}),
    },
    selected,
  );
  const out = next.get(CLIPBOARD_SHEET);
  return out ? [...out] : symbols;
}

/**
 * Parse clipboard text into a paste payload. Accepts KiCad's bare item sequence
 * (the clipboard format), a whole `(kicad_sch ...)` document, or, failing both,
 * returns the content as a text item exactly as KiCad's Paste() fallback does.
 */
export function parsePastedText(
  text: string,
  existing: Schematic,
  opts: PasteOptions = {},
): PastePayload | null {
  const mode: PasteMode = opts.mode ?? 'unique';
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Not schematic data: paste as a text object (KiCad's IO_ERROR fallback).
  const asTextItem = (): PastePayload => ({
    batch: {
      symbols: [],
      lines: [],
      junctions: [],
      noConnects: [],
      labels: [makeLabel('text', text, { x: 0, y: 0 })],
      sheets: [],
      busEntries: [],
      images: [],
      graphics: [],
      textBoxes: [],
      directiveLabels: [],
      tables: [],
    },
    libs: [],
    refPoint: { x: 0, y: 0 },
  });

  // KiCad's parser rejects anything that isn't an S-expression outright.
  if (!trimmed.startsWith('(')) return asTextItem();

  let doc: Schematic;
  try {
    const wrapped = trimmed.startsWith('(kicad_sch')
      ? trimmed
      : `(kicad_sch (version 20250114) (generator "ziroeda")\n${trimmed}\n)`;
    doc = readSchematic(parse(wrapped));
  } catch {
    return asTextItem();
  }

  // `hierarchy.GetSymbols( existingRefs, SYMBOL_FILTER_ALL )` (:2249): every
  // reference in the *project*, not just this sheet's. Copying R5 on sheet 2
  // and pasting on sheet 1 used to keep R5 and collide hierarchy-wide.
  const hierarchy: readonly AnnotateSheet[] = opts.hierarchy ?? [
    { file: '', doc: existing, sheetNumber: opts.sheetNumber ?? 1, scope: 'out' },
  ];
  const existingRefs = new Set<string>();
  for (const sheet of hierarchy)
    for (const s of sheet.doc.symbols) {
      const r = referenceOf(s);
      if (r !== undefined) existingRefs.add(r);
    }

  // `bool forceKeepAnnotations = pasteMode != PASTE_MODE::REMOVE_ANNOTATIONS;`
  // (:2218), then, inside the per-item loop and *never reset* (:2338-2348):
  //
  //   for( const SCH_SYMBOL_INSTANCE& instance : symbol->GetInstances() )
  //       if( !existingRefsSet.contains( instance.m_Reference ) )
  //       { forceKeepAnnotations = !forceRemoveAnnotations; break; }
  //
  // So one pasted symbol whose reference the project has never seen makes the
  // whole rest of the paste keep its annotations. It is sticky and it is
  // order-dependent — a symbol processed before that one is still cleared —
  // which is why this runs as a single forward pass rather than a precomputed
  // flag. We have no `(instances …)` on a pasted symbol yet (audit finding 7),
  // and upstream falls back to the same place when the clipboard carries none:
  // `newInstance.m_Reference = aSymbol->GetField( FIELD_T::REFERENCE )->GetText()`
  // (updatePastedSymbol, :1903).
  let forceKeepAnnotations = mode !== 'remove';

  const symbols = doc.symbols.map((s) => {
    const ref = referenceOf(s);
    if (ref !== undefined && !existingRefs.has(ref))
      forceKeepAnnotations = !opts.forceRemoveAnnotations;

    // ":2354-2364" — most modes need new KIIDs, but a paste that is not
    // re-annotating and whose reference the hierarchy does not already hold is
    // most likely the same symbol being moved, so it keeps its KIID (and its
    // pins'). Re-uuiding it there breaks board cross-probing and the
    // symbol↔footprint link on what the user experienced as a move.
    const needsNewKiid = mode === 'unique' || (ref !== undefined && existingRefs.has(ref));
    // `prunePastedSymbolInstances` (:2011-2030) drops the clipboard's instance
    // records from every pasted symbol, whatever happened to its KIID: they
    // annotate a sheet path of the source project, not of the destination.
    const { instances: _pruned, ...bare } = s;
    let withIds: SchSymbol;
    if (needsNewKiid) {
      const source = symbolNodeWithFreshUuids(s.source);
      const uuid = (childNamed(source, 'uuid')!.items[1] as { value: string }).value;
      // Re-read fields from the fresh source so field.source identity stays aligned.
      withIds = { ...bare, uuid, source };
    } else {
      withIds = { ...bare, source: symbolNodeWithoutInstances(s.source) };
    }

    // `if( !aForceKeepAnnotations ) aSymbol->ClearAnnotation( &aPastePath, false );`
    // (updatePastedSymbol, :1911).
    return forceKeepAnnotations ? withIds : clearAnnotation(withIds);
  });
  const reuuid = <T extends { source: SList; uuid?: string }>(item: T): T => {
    const uuid = newKiid();
    return { ...item, uuid, source: nodeWithUuid(item.source, uuid) };
  };
  // Graphics carry a uuid in their node but not as a model field (they are
  // identified by index), so their node alone is refreshed.
  const reuuidNode = <T extends { source: SList }>(item: T): T => ({
    ...item,
    source: nodeWithUuid(item.source, newKiid()),
  });
  const lines = doc.lines.map(reuuid);
  const junctions = doc.junctions.map(reuuid);
  const noConnects = doc.noConnects.map(reuuid);
  const labels = doc.labels.map(reuuid);
  const busEntries = doc.busEntries.map(reuuid);
  const images = doc.images.map(reuuid);
  const textBoxes = doc.textBoxes.map(reuuid);
  const directiveLabels = (doc.directiveLabels ?? []).map(reuuid);
  const tables = doc.tables.map(reuuid);
  const graphics = doc.graphics.map(reuuidNode);

  if (
    symbols.length +
      lines.length +
      junctions.length +
      noConnects.length +
      labels.length +
      busEntries.length +
      images.length +
      textBoxes.length +
      directiveLabels.length +
      tables.length +
      graphics.length ===
    0
  )
    return null;

  const annotated = reannotatePasted(symbols, doc, hierarchy, mode, opts);

  // `ChoosePasteLibSymbol` (:2033-2062) tries the *clipboard's* cache first and
  // only falls back to the destination's, and says why:
  //
  //   The clipboard's cached library symbol is a matched pair with the pasted
  //   instance, so it must win over the destination's same-named cache.
  //   Pasting from the destination cache would silently remap the instance to
  //   a different definition and drop in-place edits such as renumbered pins
  //   (issue 21401) or a changed power type (issue 22162).
  //
  // We used to do the exact opposite — drop any clipboard definition whose id
  // the destination already had — so an edited symbol pasted back as the
  // unedited one. Every clipboard definition is carried; `pasteItems` decides
  // what to do with a name the destination also holds.
  const libs = [...doc.libSymbols];

  // KiCad sets the move reference to the top-left item: smallest x, then y
  // (SCH_SELECTION::GetTopLeftItem), preferring connectable items.
  let refPoint: Vec2 | null = null;
  const consider = (p: Vec2): void => {
    if (!refPoint || p.x < refPoint.x || (p.x === refPoint.x && p.y < refPoint.y)) refPoint = p;
  };
  for (const s of annotated) consider(s.at);
  for (const l of lines) consider(l.start);
  for (const j of junctions) consider(j.at);
  for (const nc of noConnects) consider(nc.at);
  for (const l of labels) consider(l.at);
  for (const b of busEntries) consider(b.at);
  for (const im of images) consider(im.at);
  for (const t of textBoxes) consider(t.start);
  for (const d of directiveLabels) consider(d.at);
  // Shapes have no single anchor; each kind's leading point stands in, which is
  // what `SCH_SHAPE::GetPosition` returns for it.
  for (const g of graphics) {
    if (g.kind === 'rectangle' || g.kind === 'arc') consider(g.start);
    else if (g.kind === 'circle' || g.kind === 'ellipse' || g.kind === 'ellipse_arc')
      consider(g.center);
    else if (g.kind === 'text') consider(g.at);
    else if (g.points[0]) consider(g.points[0]);
  }

  return {
    batch: {
      symbols: annotated,
      lines,
      junctions,
      noConnects,
      labels,
      sheets: [],
      busEntries,
      images,
      graphics,
      textBoxes,
      directiveLabels,
      tables,
    },
    libs,
    refPoint: refPoint ?? { x: 0, y: 0 },
  };
}

/** Translate every pasted item by `delta` (fields move with their symbol). */
export function translatePayload(p: PastePayload, delta: Vec2): PastePayload {
  const mv = (pt: Vec2): Vec2 => ({ x: pt.x + delta.x, y: pt.y + delta.y });
  return {
    libs: p.libs,
    refPoint: mv(p.refPoint),
    batch: {
      symbols: p.batch.symbols.map((s) => ({
        ...s,
        at: mv(s.at),
        fields: s.fields.map((f) => (f.at ? { ...f, at: mv(f.at) } : f)),
      })),
      lines: p.batch.lines.map((l) => ({
        ...l,
        start: mv(l.start),
        end: mv(l.end),
        points: l.points?.map(mv),
      })),
      junctions: p.batch.junctions.map((j) => ({ ...j, at: mv(j.at) })),
      noConnects: p.batch.noConnects.map((nc) => ({ ...nc, at: mv(nc.at) })),
      labels: p.batch.labels.map((l) => ({ ...l, at: mv(l.at) })),
      // The other seven kinds used to be dropped here — hardcoded to `[]` —
      // even though `copySelection` collects them and `PastePayload.batch` is a
      // `Required<ItemsBatch>` that carries them. So a copied rectangle, sheet,
      // image, text box, table, bus entry or netclass flag survived the copy
      // and vanished the moment the paste moved, which is every paste.
      // `move.ts` already knew how to translate each of them.
      sheets: p.batch.sheets.map((x) => moveSheet(x, delta)),
      busEntries: p.batch.busEntries.map((x) => moveBusEntry(x, delta)),
      images: p.batch.images.map((x) => moveImage(x, delta)),
      graphics: p.batch.graphics.map((x) => moveGraphic(x, delta)),
      textBoxes: p.batch.textBoxes.map((x) => moveTextBox(x, delta)),
      directiveLabels: p.batch.directiveLabels.map((x) => moveDirectiveLabel(x, delta)),
      tables: p.batch.tables.map((x) => moveTable(x, delta)),
    },
  };
}

/** The paste commit: add the items and any lib definitions they need, undoably. */
export function pasteItems(payload: PastePayload): EditCommand {
  const { batch, libs } = payload;
  return {
    label: 'Paste',
    apply(doc: Schematic): Schematic {
      // ChoosePasteLibSymbol (:2033-2062): the clipboard's cached definition
      // wins over the destination's same-named one, so an in-place edit
      // (renumbered pins, a changed power type) survives a copy/paste instead
      // of being silently reverted. Upstream hands it to the pasted SCH_SYMBOL
      // alone; a definition here is shared by every placement of the name, so
      // the merge is `SCH_SCREEN::AddLibSymbol`'s (sch_screen.cpp:1463), which
      // erases the existing entry for a name before inserting the new one.
      const fromClip = new Map(libs.map((l) => [l.libId, l]));
      const merged = doc.libSymbols.map((l) => fromClip.get(l.libId) ?? l);
      const have = new Set(doc.libSymbols.map((l) => l.libId));
      const newLibs = libs.filter((l) => !have.has(l.libId));
      return {
        ...doc,
        libSymbols: [...merged, ...newLibs],
        symbols: [...doc.symbols, ...batch.symbols],
        lines: [...doc.lines, ...batch.lines],
        junctions: [...doc.junctions, ...batch.junctions],
        noConnects: [...doc.noConnects, ...batch.noConnects],
        labels: [...doc.labels, ...batch.labels],
        // …and the same seven here: they were collected, carried, and then not
        // added, so pasting one produced nothing at all.
        sheets: [...doc.sheets, ...batch.sheets],
        busEntries: [...doc.busEntries, ...batch.busEntries],
        images: [...doc.images, ...batch.images],
        graphics: [...doc.graphics, ...batch.graphics],
        textBoxes: [...doc.textBoxes, ...batch.textBoxes],
        tables: [...doc.tables, ...batch.tables],
        ...(batch.directiveLabels.length
          ? { directiveLabels: [...(doc.directiveLabels ?? []), ...batch.directiveLabels] }
          : {}),
      };
    },
    invert(before: Schematic): EditCommand {
      const had = new Map(before.libSymbols.map((l) => [l.libId, l]));
      const addedLibs = libs.filter((l) => !had.has(l.libId)).map((l) => l.libId);
      // Undo has to put back the definitions the paste replaced, not only drop
      // the ones it added.
      const replacedLibs = libs
        .map((l) => had.get(l.libId))
        .filter((l): l is LibSymbol => l !== undefined);
      const ids = new Set<string>();
      batch.symbols.forEach((s) => ids.add(s.uuid!));
      batch.lines.forEach((l) => ids.add(l.uuid!));
      batch.junctions.forEach((j) => ids.add(j.uuid!));
      batch.noConnects.forEach((nc) => ids.add(nc.uuid!));
      batch.labels.forEach((l) => ids.add(l.uuid!));
      batch.sheets.forEach((x) => ids.add(x.uuid!));
      batch.busEntries.forEach((x) => ids.add(x.uuid!));
      batch.images.forEach((x) => ids.add(x.uuid!));
      batch.textBoxes.forEach((x) => ids.add(x.uuid!));
      batch.directiveLabels.forEach((x) => ids.add(x.uuid!));
      batch.tables.forEach((x) => ids.add(x.uuid!));
      return unpasteItems(payload, ids, addedLibs, replacedLibs);
    },
  };
}

function unpasteItems(
  payload: PastePayload,
  ids: ReadonlySet<string>,
  libIds: readonly string[],
  replacedLibs: readonly LibSymbol[],
): EditCommand {
  return {
    label: 'Paste',
    apply(doc: Schematic): Schematic {
      const restore = new Map(replacedLibs.map((l) => [l.libId, l]));
      return {
        ...doc,
        libSymbols: doc.libSymbols
          .filter((l) => !libIds.includes(l.libId))
          .map((l) => restore.get(l.libId) ?? l),
        symbols: doc.symbols.filter((s) => !ids.has(s.uuid ?? '')),
        lines: doc.lines.filter((l) => !ids.has(l.uuid ?? '')),
        junctions: doc.junctions.filter((j) => !ids.has(j.uuid ?? '')),
        noConnects: doc.noConnects.filter((nc) => !ids.has(nc.uuid ?? '')),
        labels: doc.labels.filter((l) => !ids.has(l.uuid ?? '')),
        // Undo has to remove everything the paste added, or the seven kinds
        // above would stay behind while their neighbours went.
        sheets: doc.sheets.filter((x) => !ids.has(x.uuid ?? '')),
        busEntries: doc.busEntries.filter((x) => !ids.has(x.uuid ?? '')),
        images: doc.images.filter((x) => !ids.has(x.uuid ?? '')),
        // A graphic carries its uuid in its source node, not on the model, so
        // it cannot be matched by id the way the others are. The paste appends
        // them, so undo drops the same number off the end — exact for an
        // append, and this runs as that command's own inverse.
        graphics: payload.batch.graphics.length
          ? doc.graphics.slice(0, doc.graphics.length - payload.batch.graphics.length)
          : doc.graphics,
        textBoxes: doc.textBoxes.filter((x) => !ids.has(x.uuid ?? '')),
        tables: doc.tables.filter((x) => !ids.has(x.uuid ?? '')),
        ...(doc.directiveLabels
          ? { directiveLabels: doc.directiveLabels.filter((x) => !ids.has(x.uuid ?? '')) }
          : {}),
      };
    },
    invert(): EditCommand {
      return pasteItems(payload);
    },
  };
}
