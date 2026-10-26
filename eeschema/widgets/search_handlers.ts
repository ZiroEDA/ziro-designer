// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/widgets/search_handlers.cpp`: `SCH_SEARCH_HANDLER` and the five handlers
 * `SCH_SEARCH_PANE` adds - symbols, power symbols, text, labels and groups - over the live
 * SCHEMATIC, on the common `SEARCH_HANDLER` contract (`common/widgets/search_pane_types.ts`).
 *
 * Every handler walks each screen's client sheet paths (`FindAll`), matches with the items' own
 * `Matches( SCH_SEARCH_DATA )`, and `SelectItems` goes through the frame's tool manager:
 * `changeSheet` to the hits' sheet when they share one, `selectItems`, then the pan or zoom the
 * search pane's settings ask for.
 */

import { EDA_SEARCH_MATCH_MODE, SCH_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { SEARCH_PANE_SELECTION_ZOOM } from '@ziroeda/common/settings/app_settings.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { SearchColumn, SearchHandler } from '@ziroeda/common/widgets/search_pane_types.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_GROUP } from '../sch_group.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_LABEL_BASE } from '../sch_label.js';
import { SCH_SCREENS } from '../sch_screen.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import type { SCHEMATIC } from '../schematic.js';
import { SCH_ACTIONS } from '../tools/sch_actions.js';

/** `SCH_EDIT_FRAME`, as far as `search_handlers.cpp` reads it. */
export interface SchSearchFrame {
  Schematic(): SCHEMATIC;
  GetCurrentSheet(): SCH_SHEET_PATH;
  GetToolManager(): TOOL_MANAGER | null;
  /** `UNITS_PROVIDER::MessageTextFromValue( aValue )`. */
  MessageTextFromValue(aValue: number): string;
  /** `config()->m_SearchPane`. */
  config(): Pick<APP_SETTINGS_BASE, 'm_SearchPane'>;
  /** `GetCanvas()->Refresh( false )`. */
  GetCanvas(): { Refresh(aEraseBackground?: boolean): void } | null;
}

/** `SCH_SEARCH_HIT`. */
interface SCH_SEARCH_HIT {
  item: SCH_ITEM;
  sheetPath: SCH_SHEET_PATH;
}

const col = (name: string, proportion: number, align: SearchColumn['align']): SearchColumn => ({
  name,
  proportion,
  align,
});

/** `SCH_SEARCH_HANDLER`: the shared FindAll, Sort, SelectItems and ActivateItem. */
abstract class SCH_SEARCH_HANDLER implements SearchHandler {
  protected m_hitlist: SCH_SEARCH_HIT[] = [];

  constructor(
    readonly name: string,
    readonly columns: readonly SearchColumn[],
    protected readonly m_frame: SchSearchFrame,
  ) {}

  abstract search(aQuery: string): number;

  /** `getResultCell( aHit, aCol )`. */
  protected abstract getResultCellOfHit(aHit: SCH_SEARCH_HIT, aCol: number): string;

  /** `GetResultCell( aRow, aCol )`. */
  getResultCell(aRow: number, aCol: number): string {
    const hit = this.m_hitlist[aRow];
    return hit ? this.getResultCellOfHit(hit, aCol) : '';
  }

  /** The `SCH_SEARCH_DATA` every `Search()` builds. */
  protected searchData(aQuery: string): SCH_SEARCH_DATA {
    const settings = this.m_frame.config().m_SearchPane;
    const frp = new SCH_SEARCH_DATA();
    frp.searchAllFields = settings.search_hidden_fields;
    frp.searchMetadata = settings.search_metadata;
    frp.findString = aQuery;
    // Try to handle whatever the user throws at us (substring, wildcards, regex, etc.)
    frp.matchMode = EDA_SEARCH_MATCH_MODE.PERMISSIVE;
    frp.searchCurrentSheetOnly = false;
    return frp;
  }

  /** `FindAll( aCollector )`: every item of every screen, once per sheet path that shows it. */
  protected FindAll(aCollector: (aItem: SCH_ITEM, aSheet: SCH_SHEET_PATH) => boolean): void {
    const screens = new SCH_SCREENS(this.m_frame.Schematic().Root());
    const paths: SCH_SHEET_PATH[] = [];

    this.m_hitlist = [];

    screens.BuildClientSheetPathList();

    for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
      for (const sheet of screen.GetClientSheetPaths()) paths.push(sheet);
    }

    for (const sheet of paths) {
      for (const item of sheet.LastScreen()!.Items()) {
        if (aCollector(item, sheet)) this.m_hitlist.push({ item, sheetPath: sheet });
      }
    }
  }

  /** `Sort( aCol, aAscending, aSelection )`: the selection is remapped to the sorted rows. */
  sort(aCol: number, aAscending: boolean, aSelection: readonly number[]): number[] {
    const selection: SCH_ITEM[] = [];

    for (let i = 0; i < this.m_hitlist.length; ++i) {
      if (aSelection.includes(i)) selection.push(this.m_hitlist[i]!.item);
    }

    // Provide a stable order by sorting on first column if no sort column provided.
    const c = Math.max(0, aCol);

    // std::sort is not stable; Array.prototype.sort is, which only ever tightens the order where
    // StrNumCmp reports equal.
    this.m_hitlist.sort((a, b) =>
      aAscending
        ? strNumCmp(this.getResultCellOfHit(a, c), this.getResultCellOfHit(b, c), true)
        : strNumCmp(this.getResultCellOfHit(b, c), this.getResultCellOfHit(a, c), true),
    );

    const out: number[] = [];

    for (let i = 0; i < this.m_hitlist.length; ++i) {
      if (selection.includes(this.m_hitlist[i]!.item)) out.push(i);
    }

    return out;
  }

  /** `SelectItems( aItemRows )`. */
  selectItems(aItemRows: readonly number[]): void {
    const mgr = this.m_frame.GetToolManager();
    const selectedItems: EDA_ITEM[] = [];
    const selectedHits: SCH_SEARCH_HIT[] = [];

    mgr?.RunAction(ACTIONS.selectionClear);

    for (const row of aItemRows) {
      if (row >= 0 && row < this.m_hitlist.length) {
        selectedHits.push(this.m_hitlist[row]!);
        selectedItems.push(this.m_hitlist[row]!.item);
      }
    }

    if (selectedHits.length === 0) return;

    // r.sheetPath == selectedHits.front().sheetPath: the same SCH_SHEET_PATH object
    const first = selectedHits[0]!.sheetPath;
    const allHitsOnSamePage = selectedHits.slice(1).every((r) => r.sheetPath === first);
    const settings = this.m_frame.config().m_SearchPane;

    if (allHitsOnSamePage) {
      if (!this.m_frame.GetCurrentSheet().equals(first))
        mgr?.RunAction<SCH_SHEET_PATH>(SCH_ACTIONS.changeSheet, first);

      if (selectedItems.length) mgr?.RunAction<EDA_ITEM[]>(ACTIONS.selectItems, selectedItems);

      switch (settings.selection_zoom) {
        case SEARCH_PANE_SELECTION_ZOOM.PAN:
          mgr?.RunAction(ACTIONS.centerSelection);
          break;
        case SEARCH_PANE_SELECTION_ZOOM.ZOOM:
          mgr?.RunAction(ACTIONS.zoomFitSelection);
          break;
        case SEARCH_PANE_SELECTION_ZOOM.NONE:
          break;
      }

      this.m_frame.GetCanvas()?.Refresh(false);
    }
  }

  /** `ActivateItem( aItemRow )`. */
  activateItem(aItemRow: number): void {
    this.selectItems([aItemRow]);
    this.m_frame.GetToolManager()?.RunAction(SCH_ACTIONS.properties);
  }

  protected pos(aValue: number): string {
    return this.m_frame.MessageTextFromValue(aValue);
  }
}

/** `SYMBOL_SEARCH_HANDLER`. */
class SYMBOL_SEARCH_HANDLER extends SCH_SEARCH_HANDLER {
  constructor(aFrame: SchSearchFrame) {
    super(
      'Symbols',
      [
        col('Reference', 2, 'left'),
        col('Value', 6, 'left'),
        col('Footprint', 10, 'left'),
        col('Page', 1, 'center'),
        col('X', 3, 'center'),
        col('Y', 3, 'center'),
        col('Excl. Sim', 2, 'center'),
        col('Excl. BOM', 2, 'center'),
        col('Excl. Board', 2, 'center'),
        col('Excl. Pos Files', 2, 'center'),
        col('DNP', 2, 'center'),
        col('Library Link', 8, 'left'),
        col('Library Description', 10, 'left'),
      ],
      aFrame,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const frp = this.searchData(aQuery);

    this.FindAll((item, sheet) => {
      if (item && item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const sym = item as SCH_SYMBOL;

        // IsPower depends on non-missing lib symbol association
        if (!sym.IsMissingLibSymbol() && sym.IsPower()) return false;

        for (const field of sym.GetFields()) {
          if (frp.findString === '' || field.Matches(frp, sheet)) return true;
        }
      }

      return false;
    });

    return this.m_hitlist.length;
  }

  protected getResultCellOfHit(aHit: SCH_SEARCH_HIT, aCol: number): string {
    if (aHit.item.Type() !== KICAD_T.SCH_SYMBOL_T) return '';

    const sym = aHit.item as SCH_SYMBOL;
    const mark = (aOn: boolean) => (aOn ? 'X' : ' ');

    switch (aCol) {
      case 0:
        return sym.GetRef(aHit.sheetPath, true);
      case 1:
        return sym.GetField(FIELD_T.VALUE)!.GetShownText(aHit.sheetPath, false);
      case 2:
        return sym.GetField(FIELD_T.FOOTPRINT)!.GetShownText(aHit.sheetPath, false);
      case 3:
        return aHit.sheetPath.GetPageNumber();
      case 4:
        return this.pos(sym.GetPosition().x);
      case 5:
        return this.pos(sym.GetPosition().y);
      case 6:
        return mark(sym.ResolveExcludedFromSim());
      case 7:
        return mark(sym.ResolveExcludedFromBOM());
      case 8:
        return mark(sym.ResolveExcludedFromBoard());
      case 9:
        return mark(sym.ResolveExcludedFromPosFiles());
      case 10:
        return mark(sym.ResolveDNP(aHit.sheetPath, this.m_frame.Schematic().GetCurrentVariant()));
      case 11:
        return sym.GetLibId().Format();
      case 12:
        return sym.GetShownDescription();
    }

    return '';
  }
}

/** `POWER_SEARCH_HANDLER`. */
class POWER_SEARCH_HANDLER extends SCH_SEARCH_HANDLER {
  constructor(aFrame: SchSearchFrame) {
    super(
      'Power',
      [
        col('Reference', 2, 'left'),
        col('Value', 6, 'left'),
        col('Page', 1, 'center'),
        col('X', 3, 'center'),
        col('Y', 3, 'center'),
      ],
      aFrame,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const frp = this.searchData(aQuery);

    this.FindAll((item, sheet) => {
      if (item && item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const sym = item as SCH_SYMBOL;

        // IsPower depends on non-missing lib symbol association
        if (sym.IsMissingLibSymbol() || !sym.IsPower()) return false;

        for (const field of sym.GetFields()) {
          if (frp.findString === '' || field.Matches(frp, sheet)) return true;
        }
      }

      return false;
    });

    return this.m_hitlist.length;
  }

  protected getResultCellOfHit(aHit: SCH_SEARCH_HIT, aCol: number): string {
    if (aHit.item.Type() !== KICAD_T.SCH_SYMBOL_T) return '';

    const sym = aHit.item as SCH_SYMBOL;

    switch (aCol) {
      case 0:
        return sym.GetRef(aHit.sheetPath, true);
      case 1:
        return sym.GetField(FIELD_T.VALUE)!.GetShownText(aHit.sheetPath, false);
      case 2:
        return aHit.sheetPath.GetPageNumber();
      case 3:
        return this.pos(sym.GetPosition().x);
      case 4:
        return this.pos(sym.GetPosition().y);
    }

    return '';
  }
}

/** `TEXT_SEARCH_HANDLER`. */
class TEXT_SEARCH_HANDLER extends SCH_SEARCH_HANDLER {
  constructor(aFrame: SchSearchFrame) {
    super(
      'Text',
      [
        col('Type', 2, 'left'),
        col('Text', 12, 'left'),
        col('Page', 1, 'center'),
        col('X', 3, 'center'),
        col('Y', 3, 'center'),
      ],
      aFrame,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const frp = this.searchData(aQuery);

    this.FindAll((item, sheet) => {
      if (item.Type() === KICAD_T.SCH_TEXT_T || item.Type() === KICAD_T.SCH_TEXTBOX_T) {
        if (frp.findString === '' || item.Matches(frp, sheet)) return true;
      }

      return false;
    });

    return this.m_hitlist.length;
  }

  protected getResultCellOfHit(aHit: SCH_SEARCH_HIT, aCol: number): string {
    const type = aHit.item.Type();

    if (type !== KICAD_T.SCH_TEXT_T && type !== KICAD_T.SCH_TEXTBOX_T) return '';

    const txt = aHit.item as SCH_TEXT | SCH_TEXTBOX;

    switch (aCol) {
      case 0:
        return type === KICAD_T.SCH_TEXT_T ? 'Text' : 'Text Box';
      case 1:
        return txt.GetShownText(false);
      case 2:
        return aHit.sheetPath.GetPageNumber();
      case 3:
        return this.pos(txt.GetPosition().x);
      case 4:
        return this.pos(txt.GetPosition().y);
    }

    return '';
  }
}

/** `LABEL_SEARCH_HANDLER`. */
class LABEL_SEARCH_HANDLER extends SCH_SEARCH_HANDLER {
  constructor(aFrame: SchSearchFrame) {
    super(
      'Labels',
      [
        col('Type', 2, 'left'),
        col('Name', 6, 'left'),
        col('Page', 2, 'center'),
        col('X', 3, 'center'),
        col('Y', 3, 'center'),
      ],
      aFrame,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const frp = this.searchData(aQuery);

    this.FindAll((item, sheet) => {
      if (item.IsType([KICAD_T.SCH_LABEL_LOCATE_ANY_T])) {
        const lbl = item as SCH_LABEL_BASE;

        if (frp.findString === '' || lbl.Matches(frp, sheet)) return true;
      }

      return false;
    });

    return this.m_hitlist.length;
  }

  protected getResultCellOfHit(aHit: SCH_SEARCH_HIT, aCol: number): string {
    if (!aHit.item.IsType([KICAD_T.SCH_LABEL_LOCATE_ANY_T])) return '';

    const lbl = aHit.item as SCH_LABEL_BASE;

    if (aCol === 0) {
      switch (lbl.Type()) {
        case KICAD_T.SCH_LABEL_T:
          return 'Local';
        case KICAD_T.SCH_GLOBAL_LABEL_T:
          return 'Global';
        case KICAD_T.SCH_HIER_LABEL_T:
          return 'Hierarchical';
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
          return 'Directive';
      }
    } else if (aCol === 1) {
      return lbl.GetShownText(false);
    } else if (aCol === 2) {
      return aHit.sheetPath.GetPageNumber();
    } else if (aCol === 3) {
      return this.pos(lbl.GetPosition().x);
    } else if (aCol === 4) {
      return this.pos(lbl.GetPosition().y);
    }

    return '';
  }
}

/** `GROUP_SEARCH_HANDLER`. */
class GROUP_SEARCH_HANDLER extends SCH_SEARCH_HANDLER {
  constructor(aFrame: SchSearchFrame) {
    super(
      'Groups',
      [
        col('Name', 6, 'left'),
        col('Page', 2, 'center'),
        col('X', 3, 'center'),
        col('Y', 3, 'center'),
      ],
      aFrame,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const frp = this.searchData(aQuery);

    this.FindAll((item, sheet) => {
      if (item.IsType([KICAD_T.SCH_GROUP_T])) {
        const group = item as SCH_GROUP;

        if (frp.findString === '' || group.Matches(frp, sheet)) return true;
      }

      return false;
    });

    return this.m_hitlist.length;
  }

  protected getResultCellOfHit(aHit: SCH_SEARCH_HIT, aCol: number): string {
    if (aHit.item.Type() !== KICAD_T.SCH_GROUP_T) return '';

    const group = aHit.item as SCH_GROUP;

    switch (aCol) {
      case 0:
        return group.GetName();
      case 1:
        return aHit.sheetPath.GetPageNumber();
      case 2:
        return this.pos(group.GetPosition().x);
      case 3:
        return this.pos(group.GetPosition().y);
    }

    return '';
  }
}

/** The handlers `SCH_SEARCH_PANE`'s constructor adds, in its order. */
export function makeSchSearchHandlers(aFrame: SchSearchFrame): SearchHandler[] {
  return [
    new SYMBOL_SEARCH_HANDLER(aFrame),
    new POWER_SEARCH_HANDLER(aFrame),
    new TEXT_SEARCH_HANDLER(aFrame),
    new LABEL_SEARCH_HANDLER(aFrame),
    new GROUP_SEARCH_HANDLER(aFrame),
  ];
}
