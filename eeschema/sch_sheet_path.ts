// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sheet-path page numbers. Counterpart: `eeschema/sch_sheet_path.cpp`
 * (SCH_SHEET_PATH::GetPageNumber / SetPageNumber) + `sch_sheet.cpp`
 * (SCH_SHEET::getInstance / AddInstance).
 *
 * A sheet instance is keyed by the KIID path of its *containing* sheet-path,
 * the chain of sheet UUIDs from the root document down to, but excluding, the
 * sheet itself (SCH_SHEET_PATH::Path() then pop_back). We build that key from
 * the root document's uuid and the chain of sheet-symbol uuids that identify
 * the instance, exactly as KiCad serializes it: "/" joined by the ancestor
 * uuids, e.g. "/<rootUuid>" for a sheet directly under the root or
 * "/<rootUuid>/<ancestor>" one level deeper. The root sheet itself has no such
 * key; its page lives in the document-level (sheet_instances (path "/" …)).
 */

import type { LEGACY_SYMBOL_INSTANCE, SchSheet, SheetInstance, Schematic } from './types.js';
import { AddHierarchicalReference, GetRef, GetUnitSelection } from './sch_symbol.js';
import type { EditCommand } from './tools/command.js';
import { str } from '@ziroeda/sexpr';
import type { SList } from '@ziroeda/sexpr';
import { strNumCmp } from '@ziroeda/common';

/**
 * The instance key for the sheet identified by `chain` (the sheet-symbol uuids
 * from the root down to and including the target sheet). Drops the target's own
 * uuid, so the result addresses the sheet's instance the way KiCad stores it.
 */
export function instanceKey(rootUuid: string, chain: readonly string[]): string {
  const ancestors = chain.slice(0, -1); // KIID Path() then pop_back()
  return `/${[rootUuid, ...ancestors].join('/')}`;
}

/** The instance on `sheet` for `path` (SCH_SHEET::getInstance). */
export function getInstance(
  sheet: SchSheet,
  path: string,
  project?: string,
): SheetInstance | undefined {
  return sheet.instances.find(
    (i) => i.path === path && (project === undefined || (i.project ?? '') === project),
  );
}

/** Page number of the sheet at `path` (SCH_SHEET_PATH::GetPageNumber); '' if unset. */
export function getSheetPageNumber(sheet: SchSheet, path: string, project?: string): string {
  return getInstance(sheet, path, project)?.page ?? '';
}

/** Page number of the root sheet (document-level sheet_instances). */
export function getRootPageNumber(doc: Schematic, path = '/'): string {
  return doc.sheetInstances.find((i) => i.path === path)?.page ?? '';
}

/**
 * Order two page numbers the way the hierarchy tree sorts siblings
 * (SCH_SHEET::ComparePageNum, sch_sheet.cpp:1743): numeric pages compare by
 * value, a numeric page always sorts before a non-numeric one (including an
 * unset ''), and two non-numeric pages fall back to `StrNumCmp` — the natural
 * compare in common/, which is case-sensitive and codepoint-ordered. This used
 * `localeCompare(…, { sensitivity: 'base' })`, which folds case and follows
 * the browser's locale, so "a" and "A" tied here where upstream orders them.
 */
export function comparePageNum(a: string, b: string): number {
  if (a === b) return 0;
  const isIntA = /^[+-]?\d+$/.test(a);
  const isIntB = /^[+-]?\d+$/.test(b);
  if (isIntA && isIntB) return parseInt(a, 10) - parseInt(b, 10);
  if (isIntA) return -1;
  if (isIntB) return 1;
  return Math.sign(strNumCmp(a, b));
}

const setPageOnSource = (pathNode: SList, page: string): SList => {
  const hasPage = pathNode.items.some(
    (it) => it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'page',
  );
  if (hasPage) {
    return {
      kind: 'list',
      items: pathNode.items.map((it) =>
        it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'page'
          ? { kind: 'list', items: [it.items[0], str(page)] }
          : it,
      ),
    };
  }
  // No (page …) yet: append one (SCH_SHEET::AddInstance on a fresh instance).
  return {
    kind: 'list',
    items: [
      ...pathNode.items,
      { kind: 'list', items: [{ kind: 'atom', value: 'page' }, str(page)] },
    ],
  };
};

function withPage(inst: SheetInstance, page: string): SheetInstance {
  return { ...inst, page, source: setPageOnSource(inst.source, page) };
}

/** Set the page number of a sub-sheet instance (SCH_SHEET_PATH::SetPageNumber),
 *  as an undoable command over the parent document that holds `sheetIndex`. */
export function setSheetPageNumberCommand(
  sheetIndex: number,
  path: string,
  page: string,
  project?: string,
): EditCommand {
  return {
    label: 'Edit Sheet Page Number',
    apply(doc: Schematic): Schematic {
      const sheet = doc.sheets[sheetIndex];
      if (!sheet) return doc;
      const idx = sheet.instances.findIndex(
        (i) => i.path === path && (project === undefined || (i.project ?? '') === project),
      );
      if (idx === -1) return doc; // no matching instance to edit
      const instances = sheet.instances.map((i, n) => (n === idx ? withPage(i, page) : i));
      const sheets = doc.sheets.map((s, n) => (n === sheetIndex ? { ...s, instances } : s));
      return { ...doc, sheets };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.sheets[sheetIndex]?.instances.find(
        (i) => i.path === path && (project === undefined || (i.project ?? '') === project),
      );
      return setSheetPageNumberCommand(sheetIndex, path, prev?.page ?? '', project);
    },
  };
}

/** Set the root sheet's page number (document-level sheet_instances). */
export function setRootPageNumberCommand(page: string, path = '/'): EditCommand {
  return {
    label: 'Edit Sheet Page Number',
    apply(doc: Schematic): Schematic {
      const idx = doc.sheetInstances.findIndex((i) => i.path === path);
      if (idx === -1) return doc;
      const sheetInstances = doc.sheetInstances.map((i, n) => (n === idx ? withPage(i, page) : i));
      return { ...doc, sheetInstances };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.sheetInstances.find((i) => i.path === path);
      return setRootPageNumberCommand(prev?.page ?? '', path);
    },
  };
}

/**
 * `SCH_SHEET_PATH::Path()` for a sheet of the hierarchy: the root's uuid, then
 * every sheet symbol's uuid down to this sheet. `aSheetPath` is the walk's
 * `/<sheet uuids…>/` (`"/"` for the root).
 */
export function sheetKiidPath(aRootUuid: string, aSheetPath: string): string {
  const inner = aSheetPath.replace(/^\/+|\/+$/g, '');
  return inner === '' ? `/${aRootUuid}` : `/${aRootUuid}/${inner}`;
}

/**
 * `SCH_SHEET_LIST::UpdateSymbolInstanceData` (sch_sheet_path.cpp:1539): the
 * root file's legacy `symbol_instances` applied to the hierarchy. For every
 * sheet path (in sheet-list order) and every symbol on it, the record whose
 * path is that sheet path plus the symbol uuid becomes the symbol's
 * hierarchical reference for the path, and its reference / value / footprint
 * become the shared fields - so, as upstream, the last sheet path visited
 * wins the fields.
 *
 * `aSheets` is the flattened hierarchy (path + file); the documents are
 * returned updated, by file.
 */
export function UpdateSymbolInstanceData(
  aSheets: readonly { path: string; file: string }[],
  aDocs: ReadonlyMap<string, Schematic>,
  aRootUuid: string,
  aSymbolInstances: readonly LEGACY_SYMBOL_INSTANCE[],
): Map<string, Schematic> {
  const out = new Map(aDocs);

  for (const sheet of aSheets) {
    const doc = out.get(sheet.file);
    if (!doc) continue;

    const sheetKiid = sheetKiidPath(aRootUuid, sheet.path);
    // The file's paths carry no root uuid; the parser prepends it (m_rootUuid).
    const rootless = sheetKiid.slice(aRootUuid.length + 1);

    let changed = false;
    const symbols = doc.symbols.map((sym) => {
      if (!sym.uuid) return sym;

      const it = aSymbolInstances.find((r) => r.path === `${rootless}/${sym.uuid}`);
      if (!it) return sym;

      changed = true;
      let next = AddHierarchicalReference(sym, sheetKiid, it.reference, it.unit);
      const setField = (key: string, value: string): void => {
        next = {
          ...next,
          fields: next.fields.map((f) => (f.key === key ? { ...f, value } : f)),
        };
      };
      setField('Reference', it.reference);
      if (it.value !== '') setField('Value', it.value);
      if (it.footprint !== '') setField('Footprint', it.footprint);
      return next;
    });

    if (changed) out.set(sheet.file, { ...doc, symbols });
  }

  return out;
}

/**
 * One sheet instance as its consumers see it: each symbol's Reference field
 * and unit are `GetRef( &sheet )` and `GetUnitSelection( &sheet )` for this
 * sheet path. A sheet used twice gives two different documents.
 */
export function SheetInstanceView(doc: Schematic, aInstancePath: string): Schematic {
  let changed = false;
  const symbols = doc.symbols.map((sym) => {
    const ref = GetRef(sym, aInstancePath);
    const unit = GetUnitSelection(sym, aInstancePath);
    const cur = sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
    if (ref === cur && unit === sym.unit) return sym;
    changed = true;
    return {
      ...sym,
      unit,
      fields: sym.fields.map((f) => (f.key === 'Reference' ? { ...f, value: ref } : f)),
    };
  });
  return changed ? { ...doc, symbols } : doc;
}

// ---------------------------------------------------------------------------
// `SCH_SHEET_PATH`, `SCH_SHEET_LIST` and the instance records: the live-model classes
// (eeschema stage E3). Everything above is the record model's helpers, untouched.
//
// `TestForRecursion` and
// `MakeFilePathRelativeToParentSheet` compare file names as the paths are written (there
// is no wxFileName::MakeAbsolute against a disk here).
//
// `m_current_hash` is `hash_combine` over the sheets' KIID hashes upstream; the hash here
// is the KIID path text, which is what `operator==` and the per-sheet maps key on. The one
// place a hash ORDER is observable (the last tie-break of the page-number sorts) orders by
// that text instead.
// ---------------------------------------------------------------------------

import { ESCAPE_CONTEXT, EscapeString } from '@ziroeda/common/string_utils.js';
import { type KIID, KIID_PATH, niluuid } from '@ziroeda/common/kiid.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { AUTOPLACE_ALGO, SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import {
  SCH_REFERENCE,
  SCH_REFERENCE_LIST,
  multiUnitEntries,
  type SCH_MULTI_UNIT_REFERENCE_MAP,
} from './sch_reference_list.js';

/** `SYMBOL_FILTER`. */
export enum SYMBOL_FILTER {
  SYMBOL_FILTER_NON_POWER,
  SYMBOL_FILTER_POWER,
  SYMBOL_FILTER_ALL,
}

function matchesSymbolFilter(aReference: string, aSymbolFilter: SYMBOL_FILTER): boolean {
  const isPowerSymbol = aReference !== '' && aReference[0] === '#';

  switch (aSymbolFilter) {
    case SYMBOL_FILTER.SYMBOL_FILTER_POWER:
      return isPowerSymbol;

    case SYMBOL_FILTER.SYMBOL_FILTER_ALL:
      return true;

    default:
      return !isPowerSymbol;
  }
}

/** `VARIANT`: a design variant's overrides of one symbol or sheet instance. */
export class VARIANT {
  m_Name: string;
  m_Description: string;
  m_ExcludedFromSim: boolean;
  m_ExcludedFromBOM: boolean;
  m_ExcludedFromBoard: boolean;
  m_ExcludedFromPosFiles: boolean;
  m_DNP: boolean;
  m_Fields: Map<string, string>;

  constructor(aName = '') {
    this.m_Name = aName;
    this.m_Description = '';
    this.m_ExcludedFromSim = false;
    this.m_ExcludedFromBOM = false;
    this.m_ExcludedFromBoard = false;
    this.m_ExcludedFromPosFiles = false;
    this.m_DNP = false;
    this.m_Fields = new Map();
  }

  /** The member-wise copy. */
  protected copyVariantFrom(aOther: VARIANT): this {
    this.m_Name = aOther.m_Name;
    this.m_Description = aOther.m_Description;
    this.m_ExcludedFromSim = aOther.m_ExcludedFromSim;
    this.m_ExcludedFromBOM = aOther.m_ExcludedFromBOM;
    this.m_ExcludedFromBoard = aOther.m_ExcludedFromBoard;
    this.m_ExcludedFromPosFiles = aOther.m_ExcludedFromPosFiles;
    this.m_DNP = aOther.m_DNP;
    this.m_Fields = new Map(aOther.m_Fields);
    return this;
  }
}

/** The symbol/sheet attributes a variant starts from. */
interface VARIANT_SOURCE {
  GetDNP(): boolean;
  GetExcludedFromBOM(): boolean;
  GetExcludedFromSim(): boolean;
  GetExcludedFromBoard(): boolean;
  GetExcludedFromPosFiles?(): boolean;
}

export class SCH_SYMBOL_VARIANT extends VARIANT {
  InitializeAttributes(aSymbol: VARIANT_SOURCE): void {
    this.m_DNP = aSymbol.GetDNP();
    this.m_ExcludedFromBOM = aSymbol.GetExcludedFromBOM();
    this.m_ExcludedFromSim = aSymbol.GetExcludedFromSim();
    this.m_ExcludedFromBoard = aSymbol.GetExcludedFromBoard();
    this.m_ExcludedFromPosFiles = aSymbol.GetExcludedFromPosFiles?.() ?? false;
  }

  /**
   * True if the variant carries any differential against the base symbol values; a variant
   * without differentials resolves identically to no variant at all.
   */
  HasDifferentials(aSymbol: VARIANT_SOURCE): boolean {
    return (
      this.m_DNP !== aSymbol.GetDNP() ||
      this.m_ExcludedFromBOM !== aSymbol.GetExcludedFromBOM() ||
      this.m_ExcludedFromSim !== aSymbol.GetExcludedFromSim() ||
      this.m_ExcludedFromBoard !== aSymbol.GetExcludedFromBoard() ||
      this.m_ExcludedFromPosFiles !== (aSymbol.GetExcludedFromPosFiles?.() ?? false) ||
      this.m_Fields.size > 0
    );
  }

  Clone(): SCH_SYMBOL_VARIANT {
    return new SCH_SYMBOL_VARIANT().copyVariantFrom(this);
  }
}

export class SCH_SHEET_VARIANT extends VARIANT {
  InitializeAttributes(aSheet: VARIANT_SOURCE): void {
    this.m_DNP = aSheet.GetDNP();
    this.m_ExcludedFromBOM = aSheet.GetExcludedFromBOM();
    this.m_ExcludedFromSim = aSheet.GetExcludedFromSim();
    this.m_ExcludedFromBoard = aSheet.GetExcludedFromBoard();
    this.m_ExcludedFromPosFiles = false; // Sheets don't have position files exclusion
  }

  /** True if the variant carries any differential against the base sheet values. */
  HasDifferentials(aSheet: VARIANT_SOURCE): boolean {
    return (
      this.m_DNP !== aSheet.GetDNP() ||
      this.m_ExcludedFromBOM !== aSheet.GetExcludedFromBOM() ||
      this.m_ExcludedFromSim !== aSheet.GetExcludedFromSim() ||
      this.m_Fields.size > 0
    );
  }

  Clone(): SCH_SHEET_VARIANT {
    return new SCH_SHEET_VARIANT().copyVariantFrom(this);
  }
}

/**
 * `SCH_SYMBOL_INSTANCE`: a simple container for schematic symbol instance information.
 */
export class SCH_SYMBOL_INSTANCE {
  m_Path = new KIID_PATH();

  // Things that can be annotated:
  m_Reference = '';
  m_Unit = 1;

  // Do not use.  This is left over from the dubious decision to instantiate symbol value
  // and footprint fields.
  m_Value = '';
  m_Footprint = '';

  // The project name associated with this instance.
  m_ProjectName = '';

  m_DNP = false;
  m_ExcludedFromBOM = false;
  m_ExcludedFromSim = false;
  m_ExcludedFromBoard = false;
  m_ExcludedFromPosFiles = false;

  m_Variants = new Map<string, SCH_SYMBOL_VARIANT>();

  /** The compiler-generated copy. */
  Clone(): SCH_SYMBOL_INSTANCE {
    const c = new SCH_SYMBOL_INSTANCE();
    c.m_Path = this.m_Path.Clone();
    c.m_Reference = this.m_Reference;
    c.m_Unit = this.m_Unit;
    c.m_Value = this.m_Value;
    c.m_Footprint = this.m_Footprint;
    c.m_ProjectName = this.m_ProjectName;
    c.m_DNP = this.m_DNP;
    c.m_ExcludedFromBOM = this.m_ExcludedFromBOM;
    c.m_ExcludedFromSim = this.m_ExcludedFromSim;
    c.m_ExcludedFromBoard = this.m_ExcludedFromBoard;
    c.m_ExcludedFromPosFiles = this.m_ExcludedFromPosFiles;
    c.m_Variants = new Map([...this.m_Variants].map(([k, v]) => [k, v.Clone()]));
    return c;
  }
}

/**
 * `SCH_SHEET_INSTANCE`: a simple container for sheet instance information.
 */
export class SCH_SHEET_INSTANCE {
  m_Path = new KIID_PATH();

  m_PageNumber = '';

  // The project name associated with this instance.
  m_ProjectName = '';

  m_DNP = false;
  m_ExcludedFromBOM = false;
  m_ExcludedFromSim = false;
  m_ExcludedFromBoard = false;
  m_ExcludedFromPosFiles = false;

  m_Variants = new Map<string, SCH_SHEET_VARIANT>();

  /** The compiler-generated copy. */
  Clone(): SCH_SHEET_INSTANCE {
    const c = new SCH_SHEET_INSTANCE();
    c.m_Path = this.m_Path.Clone();
    c.m_PageNumber = this.m_PageNumber;
    c.m_ProjectName = this.m_ProjectName;
    c.m_DNP = this.m_DNP;
    c.m_ExcludedFromBOM = this.m_ExcludedFromBOM;
    c.m_ExcludedFromSim = this.m_ExcludedFromSim;
    c.m_ExcludedFromBoard = this.m_ExcludedFromBoard;
    c.m_ExcludedFromPosFiles = this.m_ExcludedFromPosFiles;
    c.m_Variants = new Map([...this.m_Variants].map(([k, v]) => [k, v.Clone()]));
    return c;
  }
}

/**
 * A singleton item of this class is returned for a weak reference that no longer exists.
 * Its sole purpose is to flag the item as having been deleted.
 */
export class DELETED_SHEET_ITEM extends SCH_ITEM {
  private static s_instance: DELETED_SHEET_ITEM | null = null;

  constructor() {
    super(null, KICAD_T.NOT_USED);
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return '(Deleted Item)';
  }

  override GetClass(): string {
    return 'DELETED_SHEET_ITEM';
  }

  static GetInstance(): DELETED_SHEET_ITEM {
    if (!DELETED_SHEET_ITEM.s_instance) DELETED_SHEET_ITEM.s_instance = new DELETED_SHEET_ITEM();

    return DELETED_SHEET_ITEM.s_instance;
  }

  override SetPosition(_aPos: VECTOR2I): void {}
  override Move(_aMoveVector: VECTOR2I): void {}
  override MirrorHorizontally(_aCenter: number): void {}
  override MirrorVertically(_aCenter: number): void {}
  override Rotate(_aCenter: VECTOR2I, _aRotateCCW: boolean): void {}

  override Similarity(_aOther: SCH_ITEM): number {
    return 0.0;
  }

  override equals(_aOther: SCH_ITEM): boolean {
    return false;
  }
}

/**
 * Handle access to a stack of flattened #SCH_SHEET objects by way of a path for
 * creating a flattened schematic hierarchy.
 *
 * The #SCH_SHEET objects are stored in a list from first (usually the root sheet) to last
 * sheet in the hierarchy.  The _last_ sheet is usually the sheet we want to edit or draw.
 */
export class SCH_SHEET_PATH {
  protected m_sheets: SCH_SHEET[];

  protected m_current_hash: string;

  protected m_cached_page_number: string;

  protected m_cached_path_valid: boolean;
  protected m_cached_path: KIID_PATH;

  protected m_virtualPageNumber: number; ///< Page numbers are maintained by the sheet load order.

  protected m_recursion_test_cache: Map<string, boolean>;

  constructor(aOther?: SCH_SHEET_PATH) {
    this.m_sheets = [];
    this.m_current_hash = '';
    this.m_cached_page_number = '';
    this.m_cached_path_valid = false;
    this.m_cached_path = new KIID_PATH();
    this.m_virtualPageNumber = 1;
    this.m_recursion_test_cache = new Map();

    if (aOther) this.initFromOther(aOther);
  }

  /** `SCH_SHEET_PATH( const SCH_SHEET_PATH& )`. */
  Clone(): SCH_SHEET_PATH {
    return new SCH_SHEET_PATH(this);
  }

  /** `operator=( const SCH_SHEET_PATH& )`. */
  assign(aOther: SCH_SHEET_PATH): this {
    this.initFromOther(aOther);
    return this;
  }

  /** `operator+`: this path followed by \a aOther's sheets. */
  plus(aOther: SCH_SHEET_PATH): SCH_SHEET_PATH {
    const retv = this.Clone();

    for (let i = 0; i < aOther.size(); i++) retv.push_back(aOther.at(i));

    return retv;
  }

  private initFromOther(aOther: SCH_SHEET_PATH): void {
    this.m_sheets = [...aOther.m_sheets];
    this.m_virtualPageNumber = aOther.m_virtualPageNumber;
    this.m_current_hash = aOther.m_current_hash;
    this.m_cached_page_number = aOther.m_cached_page_number;
    this.m_cached_path_valid = aOther.m_cached_path_valid;
    this.m_cached_path = aOther.m_cached_path.Clone();

    // Note: don't copy m_recursion_test_cache as it is slow and we want std::vector
    //       <SCH_SHEET_PATH> to be very fast to construct for use in the connectivity
    //       algorithm.
    this.m_recursion_test_cache = new Map();
  }

  /** Forwarded method from std::vector. */
  at(aIndex: number): SCH_SHEET {
    return this.m_sheets[aIndex]!;
  }

  /** Forwarded method from std::vector. */
  clear(): void {
    this.m_sheets = [];
    this.Rehash();
  }

  /** Forwarded method from std::vector. */
  empty(): boolean {
    return this.m_sheets.length === 0;
  }

  /** Forwarded method from std::vector. */
  pop_back(): void {
    this.m_sheets.pop();
    this.Rehash();
  }

  /** Forwarded method from std::vector. */
  push_back(aSheet: SCH_SHEET): void {
    this.m_sheets.push(aSheet);
    this.Rehash();
  }

  /** Forwarded method from std::vector. */
  size(): number {
    return this.m_sheets.length;
  }

  /** `erase( position )`. */
  erase(aPosition: number): void {
    this.m_sheets.splice(aPosition, 1);
    this.Rehash();
  }

  Rehash(): void {
    this.m_cached_path_valid = false;
    this.m_current_hash = this.m_sheets.map((s) => s.m_Uuid).join('/');
  }

  GetCurrentHash(): string {
    return this.m_current_hash;
  }

  /**
   * Set the sheet instance virtual page number.
   *
   * Virtual page numbers are incrementally updated whenever the schematic hierarchy is
   * modified.  For flat hierarchies, this number is simply the sheet load order.
   */
  SetVirtualPageNumber(aPageNumber: number): void {
    this.m_virtualPageNumber = aPageNumber;
  }

  GetVirtualPageNumber(): number {
    return this.m_virtualPageNumber;
  }

  /**
   * Set the sheet instance user definable page number.
   *
   * @note User definable page numbers can be any string devoid of white space characters.
   */
  SetPageNumber(aPageNumber: string): void {
    const sheet = this.Last();

    if (!sheet) return; // wxCHECK

    const tmpPath = this.Path();

    if (!tmpPath.empty()) {
      tmpPath.pop_back();
    } else {
      // wxCHECK_MSG: Sheet paths must have a least one valid sheet.
      return;
    }

    sheet.addInstance(tmpPath);
    sheet.setPageNumber(tmpPath, aPageNumber);
  }

  GetPageNumber(): string {
    const sheet = this.Last();

    if (!sheet) return ''; // wxCHECK

    const tmpPath = this.Path();

    if (!tmpPath.empty()) tmpPath.pop_back();
    else return '';

    return sheet.getPageNumber(tmpPath);
  }

  /** The page number as an int, else the virtual page number. */
  GetPageNumberAsInt(): number {
    const pageStr = this.GetPageNumber();

    if (/^\s*[+-]?\d+$/.test(pageStr)) return Number.parseInt(pageStr, 10);

    return this.GetVirtualPageNumber();
  }

  GetSheet(aIndex: number): SCH_SHEET | null {
    let retv: SCH_SHEET | null = null;

    if (aIndex < this.size()) retv = this.at(aIndex);

    return retv;
  }

  /**
   * Compare if this is the same sheet path as \a aSheetPathToTest
   *
   * @param aSheetPathToTest is the sheet path to compare.
   * @return 1 if this sheet path has more sheets than aSheetPathToTest,
   *   -1 if this sheet path has fewer sheets than aSheetPathToTest,
   *   or 0 if same
   */
  Cmp(aSheetPathToTest: SCH_SHEET_PATH): number {
    if (this.size() > aSheetPathToTest.size()) return 1;

    if (this.size() < aSheetPathToTest.size()) return -1;

    // otherwise, same number of sheets.
    for (let i = 0; i < this.size(); i++) {
      if (this.at(i).m_Uuid < aSheetPathToTest.at(i).m_Uuid) return -1;

      if (this.at(i).m_Uuid !== aSheetPathToTest.at(i).m_Uuid) return 1;
    }

    return 0;
  }

  CachePageNumber(): void {
    this.m_cached_page_number = this.GetPageNumber();
  }

  GetCachedPageNumber(): string {
    return this.m_cached_page_number;
  }

  /**
   * Compare sheets by their page number. If the actual page number is equal, use virtual page
   * numbers to compare.
   *
   * @return -1 if aSheetPathToTest is greater than this (should appear later in the sort order)
   *          0 if aSheetPathToTest is equal to this
   *          1 if aSheetPathToTest is less than this (should appear earlier in the sort order)
   */
  ComparePageNum(aSheetPathToTest: SCH_SHEET_PATH): number {
    const pageA = this.GetPageNumber();
    const pageB = aSheetPathToTest.GetPageNumber();

    let pageNumComp = comparePageNum(pageA, pageB);

    if (pageNumComp === 0) {
      const virtualPageA = this.GetVirtualPageNumber();
      const virtualPageB = aSheetPathToTest.GetVirtualPageNumber();

      if (virtualPageA > virtualPageB) pageNumComp = 1;
      else if (virtualPageA < virtualPageB) pageNumComp = -1;
    }

    return pageNumComp;
  }

  /**
   * Check if this path is contained inside aSheetPathToTest.
   *
   * @param aSheetPathToTest is the sheet path to compare against.
   * @return true if this path is contained inside or equal to aSheetPathToTest.
   */
  IsContainedWithin(aSheetPathToTest: SCH_SHEET_PATH): boolean {
    if (aSheetPathToTest.size() > this.size()) return false;

    for (let i = 0; i < aSheetPathToTest.size(); ++i) {
      if (this.at(i).m_Uuid !== aSheetPathToTest.at(i).m_Uuid) return false;
    }

    return true;
  }

  /**
   * Return a pointer to the last #SCH_SHEET of the list.
   *
   * One can see the others sheet as the "path" to reach this last sheet.
   */
  Last(): SCH_SHEET | null {
    if (!this.empty()) return this.m_sheets[this.m_sheets.length - 1]!;

    return null;
  }

  /** @return the #SCH_SCREEN relative to the last sheet in list. */
  LastScreen(): SCH_SCREEN | null {
    const lastSheet = this.Last();

    if (lastSheet) return lastSheet.GetScreen();

    return null;
  }

  /** Any sheet on the path excluded from simulation (in \a aVariantName, if given). */
  GetExcludedFromSim(aVariantName = ''): boolean {
    if (aVariantName === '') return this.m_sheets.some((sheet) => sheet.GetExcludedFromSim());

    const copy = this.Clone();

    while (!copy.empty()) {
      const sheet = copy.Last()!;
      copy.pop_back();

      if (sheet.GetExcludedFromSim(copy, aVariantName)) return true;
    }

    return false;
  }

  GetExcludedFromBOM(aVariantName = ''): boolean {
    if (aVariantName === '') return this.m_sheets.some((sheet) => sheet.GetExcludedFromBOM());

    const copy = this.Clone();

    while (!copy.empty()) {
      const sheet = copy.Last()!;
      copy.pop_back();

      if (sheet.GetExcludedFromBOM(copy, aVariantName)) return true;
    }

    return false;
  }

  GetExcludedFromBoard(aVariantName = ''): boolean {
    if (aVariantName === '') return this.m_sheets.some((sheet) => sheet.GetExcludedFromBoard());

    const copy = this.Clone();

    while (!copy.empty()) {
      const sheet = copy.Last()!;
      copy.pop_back();

      if (sheet.GetExcludedFromBoard(copy, aVariantName)) return true;
    }

    return false;
  }

  GetDNP(aVariantName = ''): boolean {
    if (aVariantName === '') return this.m_sheets.some((sheet) => sheet.GetDNP());

    const copy = this.Clone();

    while (!copy.empty()) {
      const sheet = copy.Last()!;
      copy.pop_back();

      if (sheet.GetDNP(copy, aVariantName)) return true;
    }

    return false;
  }

  /** Fetch a SCH_ITEM by ID. */
  ResolveItem(aID: KIID): SCH_ITEM | null {
    for (const aItem of this.LastScreen()!.Items()) {
      if (aItem.m_Uuid === aID) return aItem;

      let childMatch: SCH_ITEM | null = null;

      aItem.RunOnChildren((aChild) => {
        if (aChild.m_Uuid === aID) childMatch = aChild;
      }, RECURSE_MODE.NO_RECURSE);

      if (childMatch) return childMatch;
    }

    return null;
  }

  /**
   * Return the path of time stamps which do not changes even when editing sheet parameters.
   *
   * A path is something like / (root) or /34005677 or /34005677/00AE4523.
   */
  PathAsString(): string {
    let s = '/'; // This is the root path

    // Start at 1 to avoid the root sheet, which does not need to be added to the path.
    // Its timestamp changes anyway.
    for (let i = 1; i < this.size(); i++) s += `${this.at(i).m_Uuid}/`;

    return s;
  }

  /**
   * Get the sheet path as an KIID_PATH.
   *
   * @note This must never include the virtual root sheet.
   */
  Path(): KIID_PATH {
    if (this.m_cached_path_valid) return this.m_cached_path.Clone();

    this.m_cached_path = new KIID_PATH();

    if (this.m_sheets.length === 0) {
      this.m_cached_path_valid = true;
      return this.m_cached_path.Clone();
    }

    // Skip the virtual root sheet (niluuid) so paths are independent of how many
    // top level sheets exist.
    if (this.m_sheets[0]!.m_Uuid !== niluuid)
      this.m_cached_path.push_back(this.m_sheets[0]!.m_Uuid);

    for (let i = 1; i < this.m_sheets.length; i++)
      this.m_cached_path.push_back(this.m_sheets[i]!.m_Uuid);

    this.m_cached_path_valid = true;
    return this.m_cached_path.Clone();
  }

  /**
   * Return the sheet path in a human readable form made from the sheet names.
   *
   * The "normal" path instead uses the #KIID objects in the path that change every time
   * the sheet path is regenerated.
   */
  PathHumanReadable(
    aUseShortRootName = true,
    aStripTrailingSeparator = false,
    aEscapeSheetNames = false,
  ): string {
    let s: string;

    // Skip the virtual root sheet if present
    let startIdx = 0;

    if (!this.empty() && this.at(0).IsVirtualRootSheet()) startIdx = 1;

    if (aUseShortRootName) {
      s = '/'; // Use only the short name in netlists
    } else {
      let fileName = '';

      if (this.size() > startIdx && this.at(startIdx).GetScreen())
        fileName = this.at(startIdx).GetScreen()!.GetFileName();

      // wxFileName::GetName: the name without directory or extension
      const base = fileName.replace(/^.*[\\/]/, '');
      const dot = base.lastIndexOf('.');

      s = `${dot > 0 ? base.slice(0, dot) : base}/`;
    }

    // Start at the first sheet after the virtual root; the short root name already stands
    // for the top-level sheet unless several top-level sheets make it ambiguous.
    let loopStart = startIdx + 1;

    if (aUseShortRootName && this.size() > startIdx) {
      const first = this.at(startIdx);
      const schem = first ? first.Schematic() : null;

      if (schem && schem.GetTopLevelSheets().length > 1 && first.IsTopLevelSheet())
        loopStart = startIdx;
    }

    for (let i = loopStart; i < this.size(); i++) {
      let sheetName = this.at(i).GetField(FIELD_T.SHEET_NAME)!.GetShownText(false);

      if (aEscapeSheetNames) sheetName = EscapeString(sheetName, ESCAPE_CONTEXT.CTX_NETNAME);

      s += `${sheetName}/`;
    }

    if (aStripTrailingSeparator && s.endsWith('/')) s = s.slice(0, -1);

    return s;
  }

  /**
   * Update all the symbol references for this sheet path.
   *
   * Mandatory in complex hierarchies because sheets use the same screen (basic schematic)
   * but with different references and part selections according to the displayed sheet.
   */
  UpdateAllScreenReferences(): void {
    const screen = this.LastScreen()!;
    const items = [...screen.Items()].filter(
      (aItem) =>
        aItem.Type() === KICAD_T.SCH_SYMBOL_T ||
        aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T ||
        aItem.Type() === KICAD_T.SCH_SHAPE_T,
    );

    for (const item of items) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as SCH_SYMBOL;

        symbol.GetField(FIELD_T.REFERENCE)!.SetText(symbol.GetRef(this));
        symbol.SetUnit(symbol.GetUnitSelection(this));
        screen.Update(item, false);
      } else if (item.Type() === KICAD_T.SCH_GLOBAL_LABEL_T) {
        const label = item as SCH_ITEM & {
          GetFields(): { length: number };
          GetField(aType: FIELD_T): SCH_ITEM & {
            IsVisible(): boolean;
            SetVisible(v: boolean): void;
          };
        };

        if (label.GetFields().length > 0) {
          // Possible when reading a legacy .sch schematic
          const intersheetRefs = label.GetField(FIELD_T.INTERSHEET_REFS);

          // Fixup for legacy files which didn't store positions for intersheet references.
          const pos = intersheetRefs.GetPosition();

          if (pos.x === 0 && pos.y === 0 && !intersheetRefs.IsVisible())
            label.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          intersheetRefs.SetVisible(label.Schematic()!.Settings().m_IntersheetRefsShow);
          screen.Update(intersheetRefs, true);
        }
      } else if (item.Type() === KICAD_T.SCH_SHAPE_T) {
        (item as SCH_ITEM & { UpdateHatching(): void }).UpdateHatching();
      }
    }
  }

  /**
   * Adds #SCH_REFERENCE object to \a aReferences for each symbol in the sheet.
   *
   * @param aSymbolFilter which symbols to add (power, non-power or all).
   * @param aForceIncludeOrphanSymbols set to true to include symbols having no symbol found
   *                                   in lib.  The normal option is false, and set to true
   *                                   only to build the full list of symbols.
   */
  GetSymbols(
    aReferences: SCH_REFERENCE_LIST,
    aSymbolFilter: SYMBOL_FILTER,
    aForceIncludeOrphanSymbols = false,
  ): void {
    for (const item of this.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T))
      this.AppendSymbol(aReferences, item as SCH_SYMBOL, aSymbolFilter, aForceIncludeOrphanSymbols);
  }

  /** Append a #SCH_REFERENCE object to \a aReferences based on \a aSymbol. */
  AppendSymbol(
    aReferences: SCH_REFERENCE_LIST,
    aSymbol: SCH_SYMBOL,
    aSymbolFilter: SYMBOL_FILTER,
    aForceIncludeOrphanSymbols = false,
  ): void {
    // Skip pseudo-symbols, which have a reference starting with #.  This mainly
    // affects power symbols.
    if (matchesSymbolFilter(aSymbol.GetRef(this), aSymbolFilter)) {
      if (aSymbol.GetLibSymbolRef() || aForceIncludeOrphanSymbols) {
        const schReference = new SCH_REFERENCE(aSymbol, this);

        schReference.SetSheetNumber(this.GetPageNumberAsInt());
        aReferences.AddItem(schReference);
      }
    }
  }

  /**
   * Add a #SCH_REFERENCE_LIST object to \a aRefList for each same-reference set of
   * multi-unit parts in the sheet. The map key for each element will be the reference
   * designator.
   */
  GetMultiUnitSymbols(aRefList: SCH_MULTI_UNIT_REFERENCE_MAP, aSymbolFilter: SYMBOL_FILTER): void {
    for (const item of this.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T))
      this.AppendMultiUnitSymbol(aRefList, item as SCH_SYMBOL, aSymbolFilter);
  }

  /** Append a #SCH_REFERENCE_LIST object to \a aRefList based on \a aSymbol, if multi-unit. */
  AppendMultiUnitSymbol(
    aRefList: SCH_MULTI_UNIT_REFERENCE_MAP,
    aSymbol: SCH_SYMBOL,
    aSymbolFilter: SYMBOL_FILTER,
  ): void {
    // Skip pseudo-symbols, which have a reference starting with #.  This mainly
    // affects power symbols.
    if (!matchesSymbolFilter(aSymbol.GetRef(this), aSymbolFilter)) return;

    const symbol = aSymbol.GetLibSymbolRef();

    if (symbol && symbol.GetUnitCount() > 1) {
      const schReference = new SCH_REFERENCE(aSymbol, this);
      schReference.SetSheetNumber(this.GetPageNumberAsInt());
      const reference_str = schReference.GetRef();

      // Never lock unassigned references
      if (reference_str[reference_str.length - 1] === '?') return;

      let list = aRefList.get(reference_str);

      if (!list) {
        list = new SCH_REFERENCE_LIST();
        aRefList.set(reference_str, list);
      }

      list.AddItem(schReference);
    }
  }

  /**
   * Test the SCH_SHEET_PATH file names to check adding the sheet stored in the file
   * \a aSrcFileName to the sheet stored in file \a aDestFileName  will cause a sheet
   * path recursion.
   *
   * @return true if the resulting sheet path would recurse.
   */
  TestForRecursion(aSrcFileName: string, aDestFileName: string): boolean {
    const key = `${aSrcFileName}\u0000${aDestFileName}`;
    const cached = this.m_recursion_test_cache.get(key);

    if (cached !== undefined) return cached;

    const sch = this.LastScreen()!.Schematic();

    if (!sch) return false; // wxCHECK_MSG( sch, false, "No SCHEMATIC found..." )

    // wxFileName::MakeAbsolute( rootFn.GetPath() ) on a relative name; wxFileName's == compares
    // the normalised paths.
    const rootPath = sch
      .GetFileName()
      .replace(/\\/g, '/')
      .replace(/\/[^/]*$/, '');
    const absolute = (aName: string): string => {
      const f = aName.replace(/\\/g, '/');
      return f.startsWith('/') ? f : `${rootPath}/${f}`;
    };
    const srcFn = absolute(aSrcFileName);
    const destFn = absolute(aDestFileName);

    // The source and destination sheet file names cannot be the same.
    if (srcFn === destFn) {
      this.m_recursion_test_cache.set(key, true);
      return true;
    }

    /// @todo Store sheet file names with full path, either relative to project path
    ///       or absolute path.  The current design always assumes subsheet files are
    ///       located in the project folder which may or may not be desirable.
    let i = 0;

    while (i < this.size()) {
      // Test if the file name of the destination sheet is in anywhere in this sheet path.
      if (absolute(this.at(i).GetFileName()) === destFn) break;

      i++;
    }

    // The destination sheet file name was not found in the sheet path or the destination
    // sheet file name is the root sheet so no recursion is possible.
    if (i >= this.size() || i === 0) {
      this.m_recursion_test_cache.set(key, false);
      return false;
    }

    // Walk back up to the root sheet to see if the source file name is already a parent in
    // the sheet path.  If so, recursion will occur.
    do {
      i -= 1;

      if (absolute(this.at(i).GetFileName()) === srcFn) {
        this.m_recursion_test_cache.set(key, true);
        return true;
      }
    } while (i !== 0);

    // The source sheet file name is not a parent of the destination sheet file name.
    this.m_recursion_test_cache.set(key, false);
    return false;
  }

  /**
   * Attempt to add new symbol instances for all symbols in this list of sheet paths prefixed
   * with \a aPrefixSheetPath.
   */
  AddNewSymbolInstances(aPrefixSheetPath: SCH_SHEET_PATH, aProjectName: string): void {
    if (aProjectName === '') return; // wxCHECK

    const newSheetPath = aPrefixSheetPath.plus(this);

    for (const item of this.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      const newSymbolInstance = new SCH_SYMBOL_INSTANCE();

      if (symbol.GetInstance(newSymbolInstance, this.Path(), true)) {
        newSymbolInstance.m_ProjectName = aProjectName;

        // Use an existing symbol instance for this path if it exists.
        newSymbolInstance.m_Path = newSheetPath.Path();
        symbol.AddHierarchicalReference(newSymbolInstance);
      } else if (symbol.GetInstances().length > 0) {
        // Use the first symbol instance if any symbol instance data exists.
        const first = symbol.GetInstances()[0]!.Clone();
        first.m_Path = newSheetPath.Path();
        symbol.AddHierarchicalReference(first);
      } else {
        // Fall back to the last saved symbol field and unit settings if there is no
        // instance data.
        newSymbolInstance.m_ProjectName = aProjectName;
        newSymbolInstance.m_Path = newSheetPath.Path();
        newSymbolInstance.m_Reference = symbol.GetField(FIELD_T.REFERENCE)!.GetText();
        newSymbolInstance.m_Unit = symbol.GetUnit();
        symbol.AddHierarchicalReference(newSymbolInstance);
      }
    }
  }

  RemoveSymbolInstances(aPrefixSheetPath: SCH_SHEET_PATH): void {
    for (const item of this.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      const fullSheetPath = aPrefixSheetPath.plus(this);

      symbol.RemoveInstance(fullSheetPath);
    }
  }

  /** Add instance data for any symbol on this path that has none for it. */
  CheckForMissingSymbolInstances(aProjectName: string): void {
    // Skip sheet paths without screens (e.g., sheets that failed to load)
    if (aProjectName === '' || !this.LastScreen()) return;

    const screen = this.LastScreen()!;

    for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;
      let symbolInstance = new SCH_SYMBOL_INSTANCE();

      if (!symbol.GetInstance(symbolInstance, this.Path())) {
        // Legacy schematics that are not shared do not contain separate instance data.
        // The symbol reference and unit are saved in the reference field and unit entries.
        if (screen.GetRefCount() <= 1 && screen.GetFileFormatVersionAtLoad() <= 20200310) {
          const refField = symbol.GetField(FIELD_T.REFERENCE)!;
          symbolInstance.m_Reference = refField.GetShownText(this, true);
          symbolInstance.m_Unit = symbol.GetUnit();
        } else if (symbol.GetInstances().length > 0) {
          // When a schematic is opened as a different project (e.g., a subsheet opened
          // directly from File Browser), use the first available instance data.
          const instances = symbol.GetInstances();
          const sourceIt =
            instances.find((aInstance) => aInstance.m_ProjectName === aProjectName) ??
            instances[0]!;

          symbolInstance = sourceIt.Clone();
        } else {
          // Fall back to the symbol's reference field and unit if no instance data exists.
          const refField = symbol.GetField(FIELD_T.REFERENCE)!;
          symbolInstance.m_Reference = refField.GetText();
          symbolInstance.m_Unit = symbol.GetUnit();
        }

        symbolInstance.m_ProjectName = aProjectName;
        symbolInstance.m_Path = this.Path();
        symbol.AddHierarchicalReference(symbolInstance);
      }
    }
  }

  /**
   * Make the sheet file name relative to its parent sheet.
   *
   * This should only be called when a new file is created or the file name of an existing
   * sheet is changed.
   */
  MakeFilePathRelativeToParentSheet(): void {
    if (!(this.m_sheets.length > 1)) return; // wxCHECK

    const sheetFileName = this.Last()!.GetFileName();

    // If the sheet file name is absolute, then the user requested is so don't make it relative.
    if (sheetFileName.startsWith('/')) return;

    const screen = this.LastScreen();
    const parentScreen = this.m_sheets[this.m_sheets.length - 2]!.GetScreen();

    if (!(screen && parentScreen)) return; // wxCHECK

    const fileName = screen.GetFileName();
    const parentFileName = parentScreen.GetFileName();

    const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
    const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

    // Sheets must always be relative to the parent sheet.
    if (dirOf(fileName) === dirOf(parentFileName)) {
      this.Last()!.SetFileName(nameOf(fileName));
    } else if (fileName.startsWith(`${dirOf(parentFileName)}/`)) {
      this.Last()!.SetFileName(fileName.slice(dirOf(parentFileName).length + 1));
    } else {
      this.Last()!.SetFileName(screen.GetFileName());
    }
  }

  /** `operator==`: the same sheets (by hash). */
  equals(d1: SCH_SHEET_PATH): boolean {
    return this.m_current_hash === d1.GetCurrentHash();
  }

  /** `operator<`: the sheet pointer vectors, lexicographic (by uuid here). */
  lessThan(d1: SCH_SHEET_PATH): boolean {
    return this.Path().lessThan(d1.Path());
  }
}

/**
 * `SCH_SHEET::ComparePageNum`: numeric pages by value, numeric before non-numeric,
 * else `StrNumCmp`. The record model's `comparePageNum` above is the same function.
 */
const comparePageNumE3 = (a: string, b: string): number => comparePageNum(a, b);

/**
 * A container for handling SCH_SHEET_PATH objects in a flattened hierarchy.
 *
 * #SCH_SHEET objects are not unique, there can be many sheets with the same filename and
 * that share the same #SCH_SCREEN reference.  Each The schematic file (#SCH_SCREEN) may be
 * shared between these sheets and symbol references are specific to a sheet path.  When
 * a sheet is entered, symbol references and sheet page number are updated.
 */
export class SCH_SHEET_LIST extends Array<SCH_SHEET_PATH> {
  private m_currentSheetPath = new SCH_SHEET_PATH();

  /**
   * Construct a flattened list of SCH_SHEET_PATH objects from \a aSheet.
   *
   * If aSheet == NULL, then this is an empty hierarchy which the user can populate.
   */
  static build(aSheet: SCH_SHEET | null = null): SCH_SHEET_LIST {
    const list = new SCH_SHEET_LIST();

    if (aSheet !== null) list.BuildSheetList(aSheet, false);

    return list;
  }

  static override get [Symbol.species]() {
    return Array;
  }

  /** Check the entire hierarchy for any modifications. */
  IsModified(): boolean {
    for (const sheet of this) {
      if (sheet.LastScreen()?.IsContentModified()) return true;
    }

    return false;
  }

  ClearModifyStatus(): void {
    for (const sheet of this) sheet.LastScreen()?.SetContentModified(false);
  }

  /**
   * Fetch a SCH_ITEM by ID.
   *
   * Also returns the sheet the item was found on in \a aPathOut.
   */
  ResolveItem(aID: KIID, aPathOut: SCH_SHEET_PATH | null = null, aAllowNullptrReturn = false) {
    for (const sheet of this) {
      const item = sheet.ResolveItem(aID);

      if (item) {
        aPathOut?.assign(sheet);

        return item;
      }
    }

    // Not found; weak reference has been deleted.
    if (aAllowNullptrReturn) return null;
    else return DELETED_SHEET_ITEM.GetInstance();
  }

  /** Fill an item cache for temporary use when many items need to be fetched. */
  FillItemMap(aMap: Map<KIID, SCH_ITEM>): void {
    for (const sheet of this) {
      const screen = sheet.LastScreen()!;

      for (const aItem of screen.Items()) {
        aMap.set(aItem.m_Uuid, aItem);

        aItem.RunOnChildren((aChild) => {
          aMap.set(aChild.m_Uuid, aChild);
        }, RECURSE_MODE.NO_RECURSE);
      }
    }
  }

  /**
   * Silently annotate the not yet annotated power symbols of the entire hierarchy of the
   * sheet path list.
   *
   * It is called before creating a netlist, to annotate power symbols only. This is
   * mandatory to keep power symbols out of the list of symbols with no reference.
   */
  AnnotatePowerSymbols(): void {
    // List of reference for power symbols
    const references = new SCH_REFERENCE_LIST();

    // Build the list of power symbols:
    for (const sheet of this) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;
        const libSymbol = symbol.GetLibSymbolRef();

        if (libSymbol?.IsPower()) {
          const schReference = new SCH_REFERENCE(symbol, sheet);
          references.AddItem(schReference);
        }
      }
    }

    // Find duplicate, and silently clear annotation of duplicate
    const ref_list = new Map<string, number>(); // stores the existing references

    for (let ii = 0; ii < references.GetCount(); ++ii) {
      let curr_ref = references.at(ii).GetRef();

      if (curr_ref === '') continue;

      if (!ref_list.has(curr_ref)) {
        ref_list.set(curr_ref, ii);
        continue;
      }

      // Possible duplicate, if the ref ends by a number. (Upstream's test is
      // `Last() < '0' && Last() > '9'`, which is never true; kept as it is.)
      const last = curr_ref[curr_ref.length - 1]!;

      if (last < '0' && last > '9') continue; // not annotated

      // Duplicate: clear annotation by removing the number ending the ref
      while (
        curr_ref !== '' &&
        curr_ref[curr_ref.length - 1]! >= '0' &&
        curr_ref[curr_ref.length - 1]! <= '9'
      )
        curr_ref = curr_ref.slice(0, -1);

      references.at(ii).SetRef(curr_ref);
    }

    // Break full symbol reference into name (prefix) and number:
    // example: IC1 become IC, and 1
    references.SplitReferences();

    // Ensure all power symbols have the reference starting by '#'
    // (Not sure this is really useful)
    for (let ii = 0; ii < references.GetCount(); ++ii) {
      const ref_unit = references.at(ii);

      if (ref_unit.GetRef()[0] !== '#') {
        const new_ref = `#${ref_unit.GetRef()}`;
        ref_unit.SetRef(new_ref);
        ref_unit.SetRefNum(ii);
      }
    }
  }

  /**
   * Add a #SCH_REFERENCE object to \a aReferences for each symbol in the list of sheets.
   *
   * @param aSymbolFilter which symbols to add (power, non-power or all).
   * @param aForceIncludeOrphanSymbols set to true to include symbols having no symbol found
   *                                   in lib.
   */
  GetSymbols(
    aReferences: SCH_REFERENCE_LIST,
    aSymbolFilter: SYMBOL_FILTER,
    aForceIncludeOrphanSymbols = false,
  ): void {
    for (const sheet of this)
      sheet.GetSymbols(aReferences, aSymbolFilter, aForceIncludeOrphanSymbols);
  }

  /** Add a #SCH_REFERENCE object to \a aReferences for each symbol within \a aSheetPath. */
  GetSymbolsWithinPath(
    aReferences: SCH_REFERENCE_LIST,
    aSheetPath: SCH_SHEET_PATH,
    aSymbolFilter: SYMBOL_FILTER,
    aForceIncludeOrphanSymbols = false,
  ): void {
    for (const sheet of this) {
      if (sheet.IsContainedWithin(aSheetPath))
        sheet.GetSymbols(aReferences, aSymbolFilter, aForceIncludeOrphanSymbols);
    }
  }

  /** Return a list of sheet paths contained within \a aSheetPath. */
  GetSheetsWithinPath(aSheets: SCH_SHEET_PATH[], aSheetPath: SCH_SHEET_PATH): void {
    for (const sheet of this) {
      if (sheet.IsContainedWithin(aSheetPath)) aSheets.push(sheet);
    }
  }

  /**
   * Finds a SCH_SHEET_PATH that matches the provided KIID_PATH.
   *
   * @return the SCH_SHEET_PATH matching the provided KIID_PATH, or undefined if not found.
   */
  GetSheetPathByKIIDPath(aPath: KIID_PATH, aIncludeLastSheet = true): SCH_SHEET_PATH | undefined {
    for (const sheet of this) {
      const testPath = sheet.Path();

      if (!aIncludeLastSheet) testPath.pop_back();

      if (testPath.equals(aPath)) return sheet.Clone();
    }

    return undefined;
  }

  /**
   * Add a #SCH_REFERENCE_LIST object to \a aRefList for each same-reference set of
   * multi-unit parts in the list of sheets. The map key for each element will be the
   * reference designator.
   */
  GetMultiUnitSymbols(aRefList: SCH_MULTI_UNIT_REFERENCE_MAP, aSymbolFilter: SYMBOL_FILTER): void {
    for (const sheet of this) {
      const tempMap: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();
      sheet.GetMultiUnitSymbols(tempMap, aSymbolFilter);

      for (const [key, refs] of multiUnitEntries(tempMap)) {
        // Merge this list into the main one
        let list = aRefList.get(key);

        if (!list) {
          list = new SCH_REFERENCE_LIST();
          aRefList.set(key, list);
        }

        for (let thisRef = 0; thisRef < refs.GetCount(); ++thisRef) list.AddItem(refs.at(thisRef));
      }
    }
  }

  /**
   * Test every SCH_SHEET_PATH in this SCH_SHEET_LIST to verify if adding the sheets stored
   * in \a aSrcSheetHierarchy to the sheet stored in \a aDestFileName will cause recursion.
   */
  TestForRecursion(aSrcSheetHierarchy: SCH_SHEET_LIST, aDestFileName: string): boolean {
    if (this.length === 0) return false;

    for (const path of this) {
      for (const sheetPath of aSrcSheetHierarchy) {
        for (let k = 0; k < sheetPath.size(); k++) {
          if (path.TestForRecursion(sheetPath.GetSheet(k)!.GetFileName(), aDestFileName))
            return true;
        }
      }
    }

    // The source sheet file can safely be added to the destination sheet file.
    return false;
  }

  /**
   * Return a pointer to the first #SCH_SHEET_PATH object (not necessarily the only one)
   * matching the provided path.
   */
  FindSheetForPath(aPath: SCH_SHEET_PATH): SCH_SHEET_PATH | null {
    for (const path of this) {
      if (path.Path().equals(aPath.Path())) return path;
    }

    return null;
  }

  /** Return the first #SCH_SHEET_PATH object (not necessarily the only one) using a
   *  particular screen. */
  FindSheetForScreen(aScreen: SCH_SCREEN): SCH_SHEET_PATH {
    for (const sheetpath of this) {
      if (sheetpath.LastScreen() === aScreen) return sheetpath;
    }

    return new SCH_SHEET_PATH();
  }

  /** Return a #SCH_SHEET_LIST with a copy of all the #SCH_SHEET_PATH using a particular
   *  screen. */
  FindAllSheetsForScreen(aScreen: SCH_SCREEN): SCH_SHEET_LIST {
    const retval = new SCH_SHEET_LIST();

    for (const sheetpath of this) {
      if (sheetpath.LastScreen() === aScreen) retval.push(sheetpath);
    }

    return retval;
  }

  /**
   * Build the list of sheets and their sheet path from \a aSheet.
   *
   * If \a aSheet is the root sheet, the full sheet path and sheet list are built.
   *
   * The list will be ordered as per #SCH_SCREEN::BuildSheetList which results in sheets
   * being ordered in the legacy way of using the X and Y positions of the sheets.
   */
  BuildSheetList(aSheet: SCH_SHEET | null, aCheckIntegrity: boolean): void {
    if (!aSheet) return;

    // Skip the virtual root sheet itself, but process its children
    if (aSheet.IsVirtualRootSheet()) {
      if (aSheet.GetScreen()) {
        const childSheets: SCH_ITEM[] = [];
        aSheet.GetScreen()!.GetSheets(childSheets);

        for (const item of childSheets) this.BuildSheetList(item as SCH_SHEET, aCheckIntegrity);
      }

      return;
    }

    const badSheets: SCH_SHEET[] = [];

    this.m_currentSheetPath.push_back(aSheet);
    this.m_currentSheetPath.SetVirtualPageNumber(this.length + 1);
    this.push(this.m_currentSheetPath.Clone());

    if (this.m_currentSheetPath.LastScreen()) {
      const parentFileName = aSheet.GetFileName();
      const childSheets: SCH_ITEM[] = [];
      this.m_currentSheetPath.LastScreen()!.GetSheets(childSheets);

      for (const item of childSheets) {
        const sheet = item as SCH_SHEET;

        if (aCheckIntegrity) {
          if (!this.m_currentSheetPath.TestForRecursion(sheet.GetFileName(), parentFileName))
            this.BuildSheetList(sheet, true);
          else badSheets.push(sheet);
        } else {
          // If we are not performing a full recursion test, at least check if we are in
          // a simple recursion scenario to prevent stack overflow crashes
          if (sheet.GetFileName() === aSheet.GetFileName()) continue; // wxCHECK2_MSG: Recursion prevented

          this.BuildSheetList(sheet, false);
        }
      }
    }

    if (aCheckIntegrity) {
      for (const sheet of badSheets) {
        this.m_currentSheetPath.LastScreen()!.Remove(sheet);
        this.m_currentSheetPath.LastScreen()!.SetContentModified();
      }
    }

    this.m_currentSheetPath.pop_back();
  }

  /**
   * Sort the list of sheets by page number hierarchically: a parent sheet's page precedes
   * its children's; siblings sort by their page numbers.
   */
  SortByHierarchicalPageNumbers(aUpdateVirtualPageNums = true): void {
    for (const path of this) path.CachePageNumber();

    this.sort((a, b) => {
      const less = (x: SCH_SHEET_PATH, y: SCH_SHEET_PATH): boolean => {
        // Find the common ancestor depth
        let common_len = 0;
        const min_len = Math.min(x.size(), y.size());

        while (common_len < min_len && x.at(common_len).m_Uuid === y.at(common_len).m_Uuid)
          common_len++;

        // If one path is a prefix of the other, the shorter (parent) path comes first. Equal
        // paths are not less than each other (10.0.6: the old test returned true for a == a).
        if (common_len === min_len) return x.size() < y.size();

        // Paths diverge at common_len; compare the sheets at the divergence point
        const sheet_a = x.at(common_len);
        const sheet_b = y.at(common_len);

        // Create partial paths to get the page numbers at this level
        const ancestor = new KIID_PATH();

        for (let i = 0; i < common_len; i++) ancestor.push_back(x.at(i).m_Uuid);

        const page_a = sheet_a.getPageNumber(ancestor);
        const page_b = sheet_b.getPageNumber(ancestor);

        const retval = comparePageNumE3(page_a, page_b);

        if (retval !== 0) return retval < 0;

        // If page numbers are the same, use virtual page numbers as a tie-breaker
        if (x.GetVirtualPageNumber() < y.GetVirtualPageNumber()) return true;
        else if (x.GetVirtualPageNumber() > y.GetVirtualPageNumber()) return false;

        // Finally, use KIIDs to ensure a stable sort
        return x.GetCurrentHash() < y.GetCurrentHash();
      };

      return less(a, b) ? -1 : less(b, a) ? 1 : 0;
    });

    if (aUpdateVirtualPageNums) {
      let virtualPageNum = 1;

      for (const sheet of this) sheet.SetVirtualPageNumber(virtualPageNum++);
    }
  }

  /**
   * Sort the list of sheets by page number. This should be called after #BuildSheetList.
   *
   * If page numbers happen to be equal, then it compares the sheet names to ensure deterministic
   * ordering.  Invalid page numbers are sorted to the end.
   */
  SortByPageNumbers(aUpdateVirtualPageNums = true): void {
    for (const path of this) path.CachePageNumber();

    this.sort((a, b) => {
      const less = (x: SCH_SHEET_PATH, y: SCH_SHEET_PATH): boolean => {
        const retval = comparePageNumE3(x.GetCachedPageNumber(), y.GetCachedPageNumber());

        if (retval < 0) return true;
        else if (retval > 0) return false;

        if (x.GetVirtualPageNumber() < y.GetVirtualPageNumber()) return true;
        else if (x.GetVirtualPageNumber() > y.GetVirtualPageNumber()) return false;

        // Enforce strict ordering.  If the page numbers are the same, use UUIDs
        return x.GetCurrentHash() < y.GetCurrentHash();
      };

      return less(a, b) ? -1 : less(b, a) ? 1 : 0;
    });

    if (aUpdateVirtualPageNums) {
      let virtualPageNum = 1;

      for (const sheet of this) sheet.SetVirtualPageNumber(virtualPageNum++);
    }
  }

  NameExists(aSheetName: string): boolean {
    for (const sheet of this) {
      if (sheet.Last()!.GetName() === aSheetName) return true;
    }

    return false;
  }

  PageNumberExists(aPageNumber: string): boolean {
    for (const sheet of this) {
      if (sheet.GetPageNumber() === aPageNumber) return true;
    }

    return false;
  }

  /** Truncate the list by removing sheet's with page numbers not in the given list. */
  TrimToPageNumbers(aPageInclusions: readonly string[]): void {
    const kept = this.filter((sheet) => aPageInclusions.includes(sheet.GetPageNumber()));
    this.length = 0;
    this.push(...kept);
  }

  /**
   * Update all of the symbol instance information using \a aSymbolInstances.
   *
   * @warning Do not call this on anything other than the full hierarchy.
   */
  UpdateSymbolInstanceData(aSymbolInstances: readonly SCH_SYMBOL_INSTANCE[]): void {
    for (const sheetPath of this) {
      for (const item of sheetPath.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        const sheetPathWithSymbolUuid = sheetPath.Path();
        sheetPathWithSymbolUuid.push_back(symbol.m_Uuid);

        const it = aSymbolInstances.find((r) => sheetPathWithSymbolUuid.equals(r.m_Path));

        if (!it) continue; // No symbol instance found for symbol

        // Symbol instance paths are stored and looked up in memory without the root path
        // so use the full path here.
        symbol.AddHierarchicalReference(sheetPath.Path(), it.m_Reference, it.m_Unit);
        symbol.GetField(FIELD_T.REFERENCE)!.SetText(it.m_Reference);

        if (it.m_Value !== '') symbol.SetValueFieldText(it.m_Value);

        if (it.m_Footprint !== '') symbol.SetFootprintFieldText(it.m_Footprint);

        symbol.UpdatePrefix();
      }
    }
  }

  /**
   * Update all of the sheet instance information using \a aSheetInstances.
   *
   * @warning Do not call this on anything other than the full hierarchy.
   */
  UpdateSheetInstanceData(aSheetInstances: readonly SCH_SHEET_INSTANCE[]): void {
    for (const path of this) {
      const sheet = path.Last();

      if (!sheet) continue; // wxCHECK2

      const it = aSheetInstances.find((r) => path.Path().equals(r.m_Path));

      if (!it) continue; // No sheet instance found for path

      path.SetPageNumber(it.m_PageNumber);
    }
  }

  GetPaths(): KIID_PATH[] {
    return this.map((sheetPath) => sheetPath.Path());
  }

  /**
   * Fetch the instance information for all of the sheets in the hierarchy.
   *
   * @return all of the sheet instance data for the hierarchy.
   */
  GetSheetInstances(): SCH_SHEET_INSTANCE[] {
    const retval: SCH_SHEET_INSTANCE[] = [];

    for (const path of this) {
      const sheet = path.Last();

      if (!sheet) continue; // wxCHECK2

      const instance = new SCH_SHEET_INSTANCE();
      const tmpPath = path.Clone();

      tmpPath.pop_back();
      instance.m_Path = tmpPath.Path();
      instance.m_PageNumber = path.GetPageNumber();

      retval.push(instance);
    }

    return retval;
  }

  /**
   * Check all of the sheet instance for empty page numbers.
   *
   * @note This should only return true when loading legacy schematics or an empty schematic.
   */
  AllSheetPageNumbersEmpty(): boolean {
    for (const instance of this) {
      if (instance.GetPageNumber() !== '') return false;
    }

    return true;
  }

  /**
   * Set initial sheet page numbers.
   *
   * The number scheme is base on the old pseudo sheet numbering algorithm prior to
   * the implementation of user definable sheet page numbers.
   */
  SetInitialPageNumbers(): void {
    if (!this.AllSheetPageNumbersEmpty()) return; // wxCHECK

    let pageNumber = 1;

    for (const instance of this) {
      if (instance.Last()!.IsVirtualRootSheet()) continue;

      instance.SetPageNumber(String(pageNumber));
      pageNumber += 1;
    }
  }

  /** @return the next page number: the smallest positive number not yet used. */
  GetNextPageNumber(): string {
    const usedPageNumbers = new Set<number>();

    for (const path of this) {
      const existingPageNum = path.GetPageNumber();

      if (/^\s*[+-]?\d+$/.test(existingPageNum)) {
        const pageNum = Number.parseInt(existingPageNum, 10);

        if (pageNum > 0) usedPageNumbers.add(pageNum);
      }
    }

    let nextAvailable = 1;

    while (usedPageNumbers.has(nextAvailable)) nextAvailable++;

    return String(nextAvailable);
  }

  /**
   * Ensure that every sheet instance has a unique, non-empty page number.
   *
   * @return true if any page number was changed.
   */
  RepairPageNumbers(): boolean {
    const reservedPageIds = new Set<string>();

    for (const instance of this) {
      if (instance.Last()!.IsVirtualRootSheet()) continue;

      const pageNumber = instance.GetPageNumber();

      if (pageNumber !== '') reservedPageIds.add(pageNumber);
    }

    const assignedPageIds = new Set<string>();
    let modified = false;
    let nextPage = 1;

    for (const instance of this) {
      if (instance.Last()!.IsVirtualRootSheet()) continue;

      const pageNumber = instance.GetPageNumber();

      if (pageNumber !== '' && !assignedPageIds.has(pageNumber)) {
        assignedPageIds.add(pageNumber);
        continue;
      }

      let pageStr = String(nextPage);

      while (reservedPageIds.has(pageStr) || assignedPageIds.has(pageStr)) {
        nextPage++;
        pageStr = String(nextPage);
      }

      instance.SetPageNumber(pageStr);
      assignedPageIds.add(pageStr);
      nextPage++;
      modified = true;
    }

    return modified;
  }

  /**
   * Attempt to add new symbol instances for all symbols in this list of sheet paths prefixed
   * with \a aPrefixSheetPath.
   */
  AddNewSymbolInstances(aPrefixSheetPath: SCH_SHEET_PATH, aProjectName: string): void {
    for (const sheetPath of this) sheetPath.AddNewSymbolInstances(aPrefixSheetPath, aProjectName);
  }

  AddNewSheetInstances(aPrefixSheetPath: SCH_SHEET_PATH, aLastVirtualPageNumber: number): void {
    let lastUsedPageNumber = 1;
    let nextVirtualPageNumber = aLastVirtualPageNumber;

    // Fetch the list of page numbers already in use.
    const usedPageNumbers: string[] = [];

    if (aPrefixSheetPath.size()) {
      const prefixHierarchy = SCH_SHEET_LIST.build(aPrefixSheetPath.at(0));

      for (const path of prefixHierarchy) {
        const pageNumber = path.GetPageNumber();

        if (pageNumber !== '') usedPageNumbers.push(pageNumber);
      }
    }

    for (const sheetPath of this) {
      const tmp = sheetPath.Path();
      const newSheetPath = aPrefixSheetPath.plus(sheetPath);

      // Remove the root sheet from the path
      tmp.pop_back();

      const sheet = sheetPath.Last();

      if (!sheet) continue; // wxCHECK2

      nextVirtualPageNumber += 1;

      const instance = new SCH_SHEET_INSTANCE();

      // Add the instance if it doesn't already exist
      if (!sheet.getInstance(instance, tmp, true)) {
        sheet.addInstance(tmp);
        sheet.getInstance(instance, tmp, true);
      }

      // Get a new page number if we don't have one
      if (instance.m_PageNumber === '') {
        let pageNumber: string;

        do {
          pageNumber = String(lastUsedPageNumber);
          lastUsedPageNumber += 1;
        } while (usedPageNumbers.includes(pageNumber));

        instance.m_PageNumber = pageNumber;
        newSheetPath.SetVirtualPageNumber(nextVirtualPageNumber);
      }

      newSheetPath.SetPageNumber(instance.m_PageNumber);
      usedPageNumbers.push(instance.m_PageNumber);
    }
  }

  GetLastVirtualPageNumber(): number {
    let lastVirtualPageNumber = 1;

    for (const sheetPath of this) {
      if (sheetPath.GetVirtualPageNumber() > lastVirtualPageNumber)
        lastVirtualPageNumber = sheetPath.GetVirtualPageNumber();
    }

    return lastVirtualPageNumber;
  }

  RemoveSymbolInstances(aPrefixSheetPath: SCH_SHEET_PATH): void {
    for (const sheetPath of this) sheetPath.RemoveSymbolInstances(aPrefixSheetPath);
  }

  CheckForMissingSymbolInstances(aProjectName: string): void {
    for (const sheetPath of this) sheetPath.CheckForMissingSymbolInstances(aProjectName);
  }

  HasPath(aPath: KIID_PATH): boolean {
    for (const path of this) {
      if (path.Path().equals(aPath)) return true;
    }

    return false;
  }

  ContainsSheet(aSheet: SCH_SHEET): boolean {
    for (const path of this) {
      for (let i = 0; i < path.size(); i++) {
        if (path.at(i) === aSheet) return true;
      }
    }

    return false;
  }

  /**
   * Return the ordinal sheet path of \a aScreen.
   *
   * @warning The sheet path returned by this function is not necessarily the first sheet in
   *          the hierarchy for shared schematics.
   */
  GetOrdinalPath(aScreen: SCH_SCREEN | null): SCH_SHEET_PATH | undefined {
    // Sheet paths with sheets that do not have a screen object are not valid.
    if (!aScreen) return undefined;

    for (const path of this) {
      if (path.LastScreen() === aScreen) return path;
    }

    return undefined;
  }
}
