// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Multi-sheet project helpers, mirroring KiCad's SCH_SHEET_LIST hierarchy walk:
 * the root schematic references sub-sheets through their "Sheetfile" field, each
 * of which is another .kicad_sch document. Files are keyed by basename, KiCad
 * projects normally keep all sheets beside the .kicad_pro, and relative paths
 * resolve to the same basename.
 */

import type { Schematic, SchSheet } from './types.js';
import {
  comparePageNum,
  getRootPageNumber,
  getSheetPageNumber,
  setRootPageNumberCommand,
  setSheetPageNumberCommand,
} from './tools/sch_sheet_path.js';

/** The "Sheetname" field value (KiCad's mandatory sheet-name field). */
export function sheetName(sheet: SchSheet): string {
  return sheet.fields.find((f) => f.key === 'Sheetname')?.value ?? '';
}

/** The "Sheetfile" field as a basename ("sub/dir/amp.kicad_sch" -> "amp.kicad_sch"). */
export function sheetFile(sheet: SchSheet): string {
  const raw = sheet.fields.find((f) => f.key === 'Sheetfile')?.value ?? '';
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  return idx === -1 ? raw : raw.slice(idx + 1);
}

export interface SheetTreeNode {
  /** Document basename, e.g. "power.kicad_sch". */
  file: string;
  /** Display name: the Sheetname field, or the file for the root. */
  name: string;
  /**
   * Unique instance path, KiCad's SCH_SHEET_PATH (KIID_PATH): the chain of
   * sheet-symbol UUIDs from the root ("/", then "/<uuid>/", "/<uuid>/<uuid>/"…).
   * A file used by several sheet instances (a *complex* hierarchy) appears once
   * per instance with a distinct path, so navigation/highlight can tell them
   * apart even though they share one document.
   */
  path: string;
  /** Stored page number (SCH_SHEET_PATH::GetPageNumber), '' if unset. */
  page: string;
  children: SheetTreeNode[];
}

/**
 * One sheet instance of the hierarchy as `SCH_SHEET_LIST` carries it, plus
 * where its page number is stored: the sheet symbol lives in its PARENT's
 * document, keyed by the instance path of that document's screen.
 */
interface SheetEntry {
  node: SheetTreeNode;
  /** The document holding the sheet symbol; undefined for the root sheet. */
  parentFile?: string;
  /** Index into `parentFile`'s `sheets`. */
  sheetIndex: number;
  /** `instanceKey` of the sheet symbol's instance (SCH_SHEET_PATH::Path() then pop_back). */
  instanceKey: string;
}

/**
 * `SCH_SCREEN::GetSheets` (sch_screen.cpp:1228-1249): a screen's sheet symbols
 * by x, then y, then `KIID::operator<` — a byte compare of the uuid, which for
 * the canonical lowercase-hex form is a codepoint compare. Not `localeCompare`:
 * that follows the browser's locale and can fold case.
 */
const byPosition = (a: SchSheet, b: SchSheet): number => {
  if (a.at.x !== b.at.x) return a.at.x - b.at.x;
  if (a.at.y !== b.at.y) return a.at.y - b.at.y;
  const ua = a.uuid ?? '';
  const ub = b.uuid ?? '';
  return ua < ub ? -1 : ua > ub ? 1 : 0;
};

/**
 * `SCH_SHEET_LIST::BuildSheetList` (sch_sheet_path.cpp:1018): the hierarchy in
 * placement order — each screen's sheets as `GetSheets` sorts them, depth
 * first — with every sheet's STORED page number. The position in this walk is
 * the sheet's virtual page number, which is what breaks a page-number tie
 * everywhere upstream (`SortByPageNumbers`, `ComparePageNum`).
 *
 * A missing document still appears (as a leaf) so broken links are visible;
 * recursion guards against self-referencing cycles (TestForRecursion).
 */
function buildSheetList(
  docs: ReadonlyMap<string, Schematic>,
  rootFile: string,
): { root: SheetTreeNode; flat: SheetEntry[] } {
  const rootDoc = docs.get(rootFile);
  const rootUuid = rootDoc?.uuid ?? '';
  // The instance path of the sheets placed directly inside `ancestorUuids`'
  // screen (SCH_SHEET_PATH::Path() then pop_back()): "/<rootUuid>" for the
  // root screen's own sheets, one segment deeper per level of nesting.
  const containingPath = (ancestorUuids: readonly string[]): string =>
    `/${[rootUuid, ...ancestorUuids].join('/')}`;
  const flat: SheetEntry[] = [];
  const build = (
    entry: Omit<SheetEntry, 'node'>,
    file: string,
    name: string,
    path: string,
    page: string,
    stack: readonly string[],
    ancestorUuids: readonly string[],
  ): SheetTreeNode => {
    const node: SheetTreeNode = { file, name, path, page, children: [] };
    flat.push({ ...entry, node });
    if (stack.includes(file)) return node; // recursion guard (KiCad TestForRecursion)
    const doc = docs.get(file);
    if (!doc) return node;
    const key = containingPath(ancestorUuids);
    // `GetSheets` sorts a COPY; the index into `doc.sheets` is what an edit
    // command addresses, so it is taken before the sort.
    const sheets = doc.sheets.map((sh, i) => ({ sh, i })).sort((a, b) => byPosition(a.sh, b.sh));
    for (const { sh, i } of sheets) {
      const child = sheetFile(sh);
      if (child === '') continue;
      // Append this sheet symbol's uuid (falling back to its index) so each
      // instance of a shared file gets its own path.
      const uuid = sh.uuid || `i${i}`;
      const childPath = `${path}${uuid}/`;
      const childName = sheetName(sh) || child.replace(/\.kicad_sch$/i, '');
      node.children.push(
        build(
          { parentFile: file, sheetIndex: i, instanceKey: key },
          child,
          childName,
          childPath,
          getSheetPageNumber(sh, key),
          [...stack, file],
          [...ancestorUuids, uuid],
        ),
      );
    }
    return node;
  };
  const root = build(
    { sheetIndex: -1, instanceKey: '/' },
    rootFile,
    rootFile.replace(/\.kicad_sch$/i, ''),
    '/',
    rootDoc ? getRootPageNumber(rootDoc) : '',
    [],
    [],
  );
  return { root, flat };
}

/**
 * `SCHEMATIC::Hierarchy()`: `BuildSheetListSortedByPageNumbers`
 * (schematic.cpp:2129) is the placement-order list above put through
 * `SCH_SHEET_LIST::SortByPageNumbers` (sch_sheet_path.cpp:1159) — one FLAT
 * sort over every sheet of the hierarchy, by page number and then by virtual
 * page number. `Array.prototype.sort` is stable, so the placement order that
 * `buildSheetList` produced is the tie-break, as the virtual page number is.
 */
function sortByPageNumbers(flat: readonly SheetEntry[]): SheetEntry[] {
  return [...flat].sort((a, b) => comparePageNum(a.node.page, b.node.page));
}

/**
 * Build the hierarchy tree from the root document, following each sheet's
 * Sheetfile into `docs`.
 *
 * Siblings are sorted by their stored page number — `HIERARCHY_TREE::
 * OnCompareItems` is `SCH_SHEET_PATH::ComparePageNum` (sch_sheet_path.cpp:226),
 * the page compare with the virtual page number as the tie-break — rather than
 * by sheet-symbol placement order: KiCad's tree only uses placement position
 * to seed page numbers when they're first assigned, but always displays
 * siblings in page-number order. Two siblings on the same page (a file KiCad
 * would repair on load, see {@link repairPageNumbersOnLoad}) keep their
 * placement order, which is what the virtual page number encodes.
 *
 * A file saved before KiCad tracked per-instance page numbers (or never
 * re-saved since) has none stored anywhere at all; SCH_SHEET_LIST's own
 * AllSheetPageNumbersEmpty() guard catches exactly that and, in that case
 * only, seeds them (SetInitialPageNumbers) by numbering the placement-order
 * DFS sequentially from the root. A file with even one stored page number
 * skips this entirely and shows the rest blank, same as upstream. The loader
 * writes those numbers into the documents; this fallback is for a hierarchy
 * that did not come through it.
 */
export function buildSheetTree(
  docs: ReadonlyMap<string, Schematic>,
  rootFile: string,
): SheetTreeNode {
  const { root, flat } = buildSheetList(docs, rootFile);
  // `SortChildren` with `OnCompareItems`. The siblings arrive in placement
  // order, which is the order their virtual page numbers run in, and the sort
  // is stable — so "page number, then virtual page number" is a stable sort on
  // the page number alone.
  const sortChildren = (n: SheetTreeNode): void => {
    n.children.sort((a, b) => comparePageNum(a.page, b.page));
    for (const c of n.children) sortChildren(c);
  };
  sortChildren(root);
  if (!flat.every((e) => e.node.page === '')) return root;

  let pageNumber = 0;
  const numberFrom = (n: SheetTreeNode): SheetTreeNode => {
    pageNumber += 1;
    return { ...n, page: String(pageNumber), children: n.children.map(numberFrom) };
  };
  return numberFrom(root);
}

/**
 * What `SCH_EDIT_FRAME::OpenProjectFiles` does to page numbers the moment the
 * sheets are in memory (files-io.cpp:439-458):
 *
 *     SCH_SHEET_LIST sheetList = Schematic().Hierarchy();
 *     if( sheetList.AllSheetPageNumbersEmpty() )
 *         sheetList.SetInitialPageNumbers();
 *     else
 *         repairedPageNumbers = sheetList.RepairPageNumbers();
 *
 * `RepairPageNumbers` (sch_sheet_path.cpp:1704): walking the hierarchy in
 * `Hierarchy()` order, a page number is claimed by the first sheet that uses
 * it; any sheet with an empty page, or one repeating a number an earlier sheet
 * already claimed, is reassigned to the lowest unused positive integer. Every
 * distinct stored page is reserved up front so a reassignment never takes a
 * number a later, non-conflicting sheet holds. `SetInitialPageNumbers`
 * (:1687) numbers the same walk 1..N.
 *
 * KiCad's own cm5_minima demo ships with USB and PCIe-M2 both on page "7";
 * a running eeschema shows "PCIe-M2 (page 2)" because USB, placed first, keeps
 * the 7 and PCIe-M2 takes the first free number. Ours showed two page 7s.
 *
 * Returns the documents with the numbers written into the sheet instances —
 * upstream's `SetPageNumber` mutates the sheet, and the file is repaired when
 * the user saves — and whether anything changed, which is what gates the
 * "automatically fixed" information box (`repairedPageNumbers`).
 *
 * A sheet symbol with no `(instances …)` record at all cannot take a number
 * here: `setSheetPageNumberCommand` only patches an existing `(path …)`, as
 * the writer only re-emits one. Upstream's `addInstance` would create it.
 */
export function repairPageNumbersOnLoad(
  docs: ReadonlyMap<string, Schematic>,
  rootFile: string,
): { docs: Map<string, Schematic>; repaired: boolean } {
  const { flat } = buildSheetList(docs, rootFile);
  const hierarchy = sortByPageNumbers(flat);
  const assign: { entry: SheetEntry; page: string }[] = [];
  const seeded = hierarchy.every((e) => e.node.page === '');

  if (seeded) {
    // SetInitialPageNumbers
    hierarchy.forEach((entry, i) => assign.push({ entry, page: String(i + 1) }));
  } else {
    // RepairPageNumbers
    const reservedPageIds = new Set<string>();
    for (const e of hierarchy) if (e.node.page !== '') reservedPageIds.add(e.node.page);
    const assignedPageIds = new Set<string>();
    let nextPage = 1;
    for (const entry of hierarchy) {
      const pageNumber = entry.node.page;
      // Keep the first sheet to claim a given page number.
      if (pageNumber !== '' && !assignedPageIds.has(pageNumber)) {
        assignedPageIds.add(pageNumber);
        continue;
      }
      let pageStr = String(nextPage);
      while (reservedPageIds.has(pageStr) || assignedPageIds.has(pageStr)) {
        nextPage++;
        pageStr = String(nextPage);
      }
      assign.push({ entry, page: pageStr });
      assignedPageIds.add(pageStr);
      nextPage++;
    }
  }

  // `repairedPageNumbers` is set by the repair branch alone: `SetPageNumber`
  // (sch_sheet.cpp:1677) does not flag the screen modified, so the seeding
  // branch raises no box upstream either.
  const out = new Map(docs);
  let repaired = false;
  for (const { entry, page } of assign) {
    const file = entry.parentFile ?? rootFile;
    const doc = out.get(file);
    if (!doc) continue;
    const next =
      entry.parentFile === undefined
        ? setRootPageNumberCommand(page).apply(doc)
        : setSheetPageNumberCommand(entry.sheetIndex, entry.instanceKey, page).apply(doc);
    if (next === doc) continue;
    out.set(file, next);
    repaired = true;
  }
  return { docs: out, repaired: repaired && !seeded };
}

/**
 * Pick the project's root schematic from a set of parsed documents: the
 * basename matching the .kicad_pro if given, else the document no other
 * document references as a sub-sheet, else the first file.
 */
export function findRootFile(docs: ReadonlyMap<string, Schematic>, proName?: string): string {
  if (proName) {
    const want = proName.replace(/\.kicad_pro$/i, '.kicad_sch');
    if (docs.has(want)) return want;
  }
  const referenced = new Set<string>();
  for (const doc of docs.values()) {
    for (const sh of doc.sheets) referenced.add(sheetFile(sh));
  }
  for (const file of docs.keys()) {
    if (!referenced.has(file)) return file;
  }
  return docs.keys().next().value ?? '';
}
