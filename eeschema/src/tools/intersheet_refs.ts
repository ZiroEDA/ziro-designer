/**
 * Inter-sheet references for global labels. Counterparts:
 * `SCHEMATIC::RecomputeIntersheetRefs` + `GetVirtualPageToSheetPagesMap`
 * (eeschema/schematic.cpp) and `SCH_GLOBALLABEL::ResolveTextVar`'s
 * `INTERSHEET_REFS` branch (eeschema/sch_label.cpp).
 *
 * Every global label carries an implicit `${INTERSHEET_REFS}` field
 * ("Intersheet References") listing the page numbers of the other sheets where
 * a global label with the same resolved text appears. Formatting's inter-sheet
 * settings control visibility, own-page listing, the abbreviated `first..last`
 * form and the prefix/suffix.
 */

import { childNamed, childrenNamed } from '@ziroeda/sexpr/src/query.js';
import type { Schematic, SchField, SchLabel } from '../types.js';
import { readField } from '../sch_io/sexpr/read-schematic.js';

export const INTERSHEET_REFS_FIELD_NAME = 'Intersheet References';

/** One sheet instance of the hierarchy, in SCH_SHEET_LIST order. */
export interface IntersheetSheet {
  sch: Schematic;
  /** SCH_SHEET_PATH::GetVirtualPageNumber, 1-based hierarchy ordinal. */
  virtualPage: number;
  /** SCH_SHEET_PATH::GetPageNumber, the page-number *string* ("2", "A", …). */
  pageString: string;
  /** Per-sheet `${VAR}` expansion for the label text (GetShownText). */
  resolve?: (text: string) => string;
}

/**
 * SCHEMATIC::RecomputeIntersheetRefs (map-building half): resolved global-label
 * text → the set of virtual page numbers containing it.
 */
export function buildPageRefsMap(sheets: readonly IntersheetSheet[]): Map<string, Set<number>> {
  const pageRefsMap = new Map<string, Set<number>>();
  for (const sheet of sheets) {
    for (const label of sheet.sch.labels) {
      if (label.kind !== 'global_label') continue;
      const resolvedLabel = sheet.resolve ? sheet.resolve(label.text) : label.text;
      let set = pageRefsMap.get(resolvedLabel);
      if (!set) {
        set = new Set();
        pageRefsMap.set(resolvedLabel, set);
      }
      set.add(sheet.virtualPage);
    }
  }
  return pageRefsMap;
}

export interface IntersheetRefsConfig {
  pageRefsMap: ReadonlyMap<string, ReadonlySet<number>>;
  /** GetVirtualPageToSheetPagesMap: virtual page number → page string. */
  virtualPageToPages: ReadonlyMap<number, string>;
  /** CurrentSheet().GetVirtualPageNumber(). */
  currentVirtualPage: number;
  /** m_IntersheetRefsListOwnPage. */
  listOwnPage: boolean;
  /** m_IntersheetRefsFormatShort. */
  formatShort: boolean;
  /** m_IntersheetRefsPrefix / m_IntersheetRefsSuffix. */
  prefix: string;
  suffix: string;
}

/**
 * SCH_GLOBALLABEL::ResolveTextVar, `INTERSHEET_REFS` branch: the field's shown
 * text for a label whose resolved text is `resolvedLabel`.
 */
export function intersheetRefsText(resolvedLabel: string, cfg: IntersheetRefsConfig): string {
  let ref = '';
  const pages = cfg.pageRefsMap.get(resolvedLabel);

  if (!pages) {
    ref = '?';
  } else {
    let pageListCopy = [...pages].sort((a, b) => a - b);

    if (!cfg.listOwnPage) pageListCopy = pageListCopy.filter((p) => p !== cfg.currentVirtualPage);

    if (cfg.formatShort && pageListCopy.length > 2) {
      ref = `${cfg.virtualPageToPages.get(pageListCopy[0]!) ?? ''}..${
        cfg.virtualPageToPages.get(pageListCopy[pageListCopy.length - 1]!) ?? ''
      }`;
    } else {
      ref = pageListCopy.map((pageNo) => cfg.virtualPageToPages.get(pageNo) ?? '').join(',');
    }
  }

  return cfg.prefix + ref + cfg.suffix;
}

/**
 * The label's stored "Intersheet References" property, if the file carries one
 * with its own position/effects (the field survives in the label's lossless
 * AST; a position equal to the label's own means "autoplace", like
 * SCHEMATIC::RecomputeIntersheetRefs' `GetTextPos() == GetPosition()` check).
 */
export function intersheetRefsField(label: SchLabel): SchField | null {
  for (const prop of childrenNamed(label.source, 'property')) {
    const field = readField(prop);
    if (field.key === INTERSHEET_REFS_FIELD_NAME) return field;
  }
  return null;
}

/** Whether the stored field position means "autoplace at the label tail". */
export function intersheetRefsAutoplaced(label: SchLabel, field: SchField | null): boolean {
  if (!field?.at || !childNamed(field.source, 'at')) return true;
  return field.at.x === label.at.x && field.at.y === label.at.y;
}
