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
import { comparePageNum, getRootPageNumber, getSheetPageNumber } from './tools/sch_sheet_path.js';

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
 * Build the hierarchy tree from the root document, following each sheet's
 * Sheetfile into `docs`. A missing document still appears (as a leaf) so broken
 * links are visible; recursion guards against self-referencing cycles.
 *
 * Siblings are sorted by their stored page number (SCH_SHEET::ComparePageNum,
 * via HIERARCHY_TREE::OnCompareItems) rather than by sheet-symbol placement
 * order: KiCad's tree only uses placement position to seed page numbers when
 * they're first assigned, but always displays siblings in page-number order.
 *
 * A file saved before KiCad tracked per-instance page numbers (or never
 * re-saved since) has none stored anywhere at all; SCH_SHEET_LIST's own
 * AllSheetPageNumbersEmpty() guard catches exactly that and, in that case
 * only, seeds them (SetInitialPageNumbers) by numbering a canvas-position
 * DFS - the same traversal SCH_SCREEN::GetSheets() sorts by (x, then y, then
 * uuid) - sequentially from the root. A file with even one stored page number
 * skips this entirely and shows the rest blank, same as upstream.
 */
export function buildSheetTree(
  docs: ReadonlyMap<string, Schematic>,
  rootFile: string,
): SheetTreeNode {
  const rootDoc = docs.get(rootFile);
  const rootUuid = rootDoc?.uuid ?? '';
  // The instance path of the sheets placed directly inside `ancestorUuids`'
  // screen (SCH_SHEET_PATH::Path() then pop_back()): "/<rootUuid>" for the
  // root screen's own sheets, one segment deeper per level of nesting.
  const containingPath = (ancestorUuids: readonly string[]): string =>
    `/${[rootUuid, ...ancestorUuids].join('/')}`;
  const byPosition = (a: SchSheet, b: SchSheet): number =>
    a.at.x - b.at.x || a.at.y - b.at.y || (a.uuid ?? '').localeCompare(b.uuid ?? '');
  const build = (
    file: string,
    name: string,
    path: string,
    page: string,
    stack: readonly string[],
    ancestorUuids: readonly string[],
    positionOrder: boolean,
  ): SheetTreeNode => {
    const node: SheetTreeNode = { file, name, path, page, children: [] };
    if (stack.includes(file)) return node; // recursion guard (KiCad TestForRecursion)
    const doc = docs.get(file);
    if (!doc) return node;
    const key = containingPath(ancestorUuids);
    const sheets = positionOrder ? [...doc.sheets].sort(byPosition) : doc.sheets;
    sheets.forEach((sh, i) => {
      const child = sheetFile(sh);
      if (child === '') return;
      // Append this sheet symbol's uuid (falling back to its index) so each
      // instance of a shared file gets its own path.
      const uuid = sh.uuid || `i${i}`;
      const childPath = `${path}${uuid}/`;
      const childName = sheetName(sh) || child.replace(/\.kicad_sch$/i, '');
      node.children.push(
        build(
          child,
          childName,
          childPath,
          getSheetPageNumber(sh, key),
          [...stack, file],
          [...ancestorUuids, uuid],
          positionOrder,
        ),
      );
    });
    if (!positionOrder) node.children.sort((a, b) => comparePageNum(a.page, b.page));
    return node;
  };
  const rootPage = rootDoc ? getRootPageNumber(rootDoc) : '';
  const stored = build(
    rootFile,
    rootFile.replace(/\.kicad_sch$/i, ''),
    '/',
    rootPage,
    [],
    [],
    false,
  );
  const allEmpty = (n: SheetTreeNode): boolean => n.page === '' && n.children.every(allEmpty);
  if (!allEmpty(stored)) return stored;

  const seeded = build(
    rootFile,
    rootFile.replace(/\.kicad_sch$/i, ''),
    '/',
    rootPage,
    [],
    [],
    true,
  );
  let pageNumber = 0;
  const numberFrom = (n: SheetTreeNode): SheetTreeNode => {
    pageNumber += 1;
    return { ...n, page: String(pageNumber), children: n.children.map(numberFrom) };
  };
  return numberFrom(seeded);
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
