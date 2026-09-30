// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/widgets/search_handlers.cpp`: `PCB_SEARCH_HANDLER` and its seven
 * subclasses, in `PCB_SEARCH_PANE`'s `AddSearcher` order: `FOOTPRINT_`,
 * `ZONE_`, `NETS_`, `RATSNEST_`, `TEXT_`, `GROUP_` and `DRILL_SEARCH_HANDLER`,
 * over the common `SEARCH_HANDLER` contract (`common/widgets/search_pane_types.ts`).
 *
 * Unlike eeschema's set, which searches a flat scene, these walk the LIVE
 * `BOARD` and hold `BOARD_ITEM`s in the hitlist exactly as the C++ does, so
 * `EDA_ITEM::Matches`, `StrNumCmp` and every `GetResultCell` body are the
 * ones upstream calls.
 *
 * What `m_frame` is upstream (`PCB_EDIT_FRAME*`) is two seams here:
 *  - {@link PcbSearchFrame}, the read-only slice the handlers ask the frame for
 *    (`GetBoard`, `MessageTextFromValue`, `GetOriginTransforms`, `config()`);
 *  - {@link PcbSearchWiring}, the tool-manager actions `SelectItems` and
 *    `ActivateItem` run (`ACTIONS::selectItems`, `centerSelection`,
 *    `zoomFitSelection`, `PCB_ACTIONS::properties`, the net highlight the two
 *    net handlers write to the painter's `RENDER_SETTINGS`, and
 *    `ShowBoardSetupDialog`). The editor hands them in; a test hands in
 *    recorders.
 */
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { SEARCH_PANE_SELECTION_ZOOM } from '@ziroeda/common/settings/app_settings.js';
import { KICAD_T, BaseType } from '@ziroeda/core/typeinfo.js';
import { EDA_SEARCH_DATA, EDA_SEARCH_MATCH_MODE } from '@ziroeda/common/eda_search_data.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { EdaDataType } from '@ziroeda/common/eda_units.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { COORD_TYPES_T, ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import { COORD_TYPES_T as COORDS } from '@ziroeda/common/origin_transforms.js';
import { strNumCmp, unescapeString } from '@ziroeda/common/string_utils.js';
import type { SearchColumn, SearchHandler } from '@ziroeda/common/widgets/search_pane_types.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import {
  CollectDrillLineItems,
  DRILL_LINE_ITEM_COL_ID,
  DRILL_LINE_ITEM_COMPARE,
  sameDrillLineItem,
  type DrillLineItem,
} from '../board_statistics.js';
import type { FOOTPRINT } from '../footprint.js';
import type { NETINFO_ITEM } from '../netinfo_item.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE } from '../padstack.js';
import type { PCB_GROUP } from '../pcb_group.js';
import type { PCB_TEXT } from '../pcb_text.js';
import type { PCB_TEXTBOX } from '../pcb_textbox.js';
import type { PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';

/** `PCB_EDIT_FRAME`, as far as `search_handlers.cpp` reads it. */
export interface PcbSearchFrame {
  GetBoard(): BOARD | null;
  IsClosing?(): boolean;
  /** `UNITS_PROVIDER::MessageTextFromValue( aValue, aAddUnitLabel, aType )`. */
  MessageTextFromValue(aValue: number, aAddUnitLabel?: boolean, aType?: EdaDataType): string;
  GetOriginTransforms(): Pick<ORIGIN_TRANSFORMS, 'ToDisplay'>;
  /** `config()->m_SearchPane`. */
  config(): Pick<APP_SETTINGS_BASE, 'm_SearchPane'>;
}

/** The tool-manager side of `SelectItems` / `ActivateItem`. */
export interface PcbSearchWiring {
  /** `ACTIONS::selectionClear`. */
  clearSelection(): void;
  /** `ACTIONS::selectItems`, given the hitlist rows' items. */
  selectItems(aItems: readonly EDA_ITEM[]): void;
  /** `ACTIONS::centerSelection`. */
  centerSelection(): void;
  /** `ACTIONS::zoomFitSelection`. */
  zoomFitSelection(): void;
  /** `GetCanvas()->Refresh( false )`. */
  refresh(): void;
  /** `PCB_ACTIONS::properties`. */
  properties(): void;
  /**
   * `RENDER_SETTINGS::SetHighlight( false )` followed by one
   * `SetHighlight( true, code, true )` per row, then `UpdateAllLayersColor()` and
   * `Refresh()`. An empty list is the plain `SetHighlight( false )`.
   */
  highlightNets(aNetCodes: readonly number[]): void;
  /** `m_frame->ShowBoardSetupDialog( aInitialPage )`. */
  showBoardSetupDialog(aInitialPage: string): void;
}

/** `wxString PCB_EDIT_FRAME::MessageTextFromCoord`: the origin-transformed distance text. */
function coordText(aFrame: PcbSearchFrame, aValue: number, aType: COORD_TYPES_T): string {
  return aFrame.MessageTextFromValue(aFrame.GetOriginTransforms().ToDisplay(aValue, aType));
}

/**
 * The `EDA_SEARCH_DATA` every `Search()` builds: `search_hidden_fields`,
 * `search_metadata`, the query, and "try to handle whatever the user throws at
 * us" (`PERMISSIVE`).
 */
function searchData(aFrame: PcbSearchFrame, aQuery: string): EDA_SEARCH_DATA {
  const settings = aFrame.config().m_SearchPane;
  const frp = new EDA_SEARCH_DATA();

  frp.searchAllFields = settings.search_hidden_fields;
  frp.searchMetadata = settings.search_metadata;
  frp.findString = aQuery;
  frp.matchMode = EDA_SEARCH_MATCH_MODE.PERMISSIVE;

  return frp;
}

/** `PCB_SEARCH_HANDLER`: the shared `GetResultCell`, `Sort`, `SelectItems`, `ActivateItem`. */
export abstract class PCB_SEARCH_HANDLER implements SearchHandler {
  protected m_hitlist: BOARD_ITEM[] = [];

  constructor(
    readonly name: string,
    readonly columns: readonly SearchColumn[],
    protected readonly m_frame: PcbSearchFrame,
    protected readonly m_wiring: PcbSearchWiring,
  ) {}

  abstract search(aQuery: string): number;

  protected abstract getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string;

  /** `PCB_SEARCH_HANDLER::GetResultCell`. */
  getResultCell(aRow: number, aCol: number): string {
    if (this.m_frame.IsClosing?.()) return '';

    if (aRow >= this.m_hitlist.length) return '';

    const item = this.m_hitlist[aRow];

    if (!item) return '';

    return this.getResultCellOfItem(item, aCol);
  }

  /** `PCB_SEARCH_HANDLER::Sort`: the selection is remapped to the sorted rows. */
  sort(aCol: number, aAscending: boolean, aSelection: readonly number[]): number[] {
    const selection: BOARD_ITEM[] = [];

    for (let i = 0; i < this.m_hitlist.length; ++i) {
      if (aSelection.includes(i)) selection.push(this.m_hitlist[i]!);
    }

    // Provide a stable order by sorting on first column if no sort column provided.
    const col = Math.max(0, aCol);

    // std::sort is not stable; Array.prototype.sort is, which only ever
    // tightens the order where StrNumCmp reports equal.
    this.m_hitlist.sort((a, b) =>
      aAscending
        ? strNumCmp(this.getResultCellOfItem(a, col), this.getResultCellOfItem(b, col), true)
        : strNumCmp(this.getResultCellOfItem(b, col), this.getResultCellOfItem(a, col), true),
    );

    const out: number[] = [];

    for (let i = 0; i < this.m_hitlist.length; ++i) {
      if (selection.includes(this.m_hitlist[i]!)) out.push(i);
    }

    return out;
  }

  /** `PCB_SEARCH_HANDLER::SelectItems`. */
  selectItems(aItemRows: readonly number[]): void {
    this.selectHitlistItems(this.rowsToItems(aItemRows));
  }

  protected rowsToItems(aItemRows: readonly number[]): BOARD_ITEM[] {
    const items: BOARD_ITEM[] = [];

    for (const row of aItemRows) {
      if (row >= 0 && row < this.m_hitlist.length) items.push(this.m_hitlist[row]!);
    }

    return items;
  }

  /** The tail every `SelectItems` shares: clear, select, pan or zoom, refresh. */
  protected selectHitlistItems(aItems: readonly EDA_ITEM[]): void {
    const settings = this.m_frame.config().m_SearchPane;

    this.m_wiring.clearSelection();

    if (aItems.length) {
      this.m_wiring.selectItems(aItems);

      switch (settings.selection_zoom) {
        case SEARCH_PANE_SELECTION_ZOOM.PAN:
          this.m_wiring.centerSelection();
          break;
        case SEARCH_PANE_SELECTION_ZOOM.ZOOM:
          this.m_wiring.zoomFitSelection();
          break;
        case SEARCH_PANE_SELECTION_ZOOM.NONE:
          break;
      }
    }

    this.m_wiring.refresh();
  }

  /** `PCB_SEARCH_HANDLER::ActivateItem`. */
  activateItem(aItemRow: number): void {
    this.selectItems([aItemRow]);
    this.m_wiring.properties();
  }
}

/** `FOOTPRINT_SEARCH_HANDLER`. */
export class FOOTPRINT_SEARCH_HANDLER extends PCB_SEARCH_HANDLER {
  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super(
      'Footprints',
      [
        { name: 'Reference', proportion: 2, align: 'left' },
        { name: 'Value', proportion: 6, align: 'left' },
        { name: 'Layer', proportion: 2, align: 'center' },
        { name: 'X', proportion: 3, align: 'center' },
        { name: 'Y', proportion: 3, align: 'center' },
        { name: 'Library Link', proportion: 8, align: 'left' },
        { name: 'Library Description', proportion: 10, align: 'left' },
      ],
      aFrame,
      aWiring,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const board = this.m_frame.GetBoard();

    if (board === null) return 0;

    const frp = searchData(this.m_frame, aQuery);

    for (const fp of board.Footprints()) {
      let found = false;

      if (frp.findString === '') found = true;

      if (!found && fp.Matches(frp, null)) found = true;

      if (!found) {
        for (const field of fp.GetFields()) {
          if (field.Matches(frp, null)) {
            found = true;
            break;
          }
        }
      }

      if (found) this.m_hitlist.push(fp);
    }

    return this.m_hitlist.length;
  }

  protected getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string {
    const fp = aItem as FOOTPRINT;

    if (aCol === 0) return fp.GetReference();
    if (aCol === 1) return unescapeString(fp.GetValue());
    if (aCol === 2) return fp.GetLayerName();
    if (aCol === 3) return coordText(this.m_frame, fp.GetX(), COORDS.ABS_X_COORD);
    if (aCol === 4) return coordText(this.m_frame, fp.GetY(), COORDS.ABS_Y_COORD);
    if (aCol === 5) return fp.GetFPID().Format();
    if (aCol === 6) return fp.GetLibDescription();

    return '';
  }
}

/** `ZONE_SEARCH_HANDLER`. */
export class ZONE_SEARCH_HANDLER extends PCB_SEARCH_HANDLER {
  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super(
      'Zones',
      [
        { name: 'Name', proportion: 6, align: 'left' },
        { name: 'Net', proportion: 6, align: 'left' },
        { name: 'Layer', proportion: 3, align: 'center' },
        { name: 'Priority', proportion: 2, align: 'center' },
        { name: 'X', proportion: 3, align: 'center' },
        { name: 'Y', proportion: 3, align: 'center' },
        { name: 'Area', proportion: 3, align: 'right' },
      ],
      aFrame,
      aWiring,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const board = this.m_frame.GetBoard();

    if (!board) return 0;

    const frp = searchData(this.m_frame, aQuery);

    for (const item of board.Zones()) {
      if (frp.findString === '' || item.Matches(frp, null)) this.m_hitlist.push(item);
    }

    return this.m_hitlist.length;
  }

  protected getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string {
    const zone = aItem as ZONE;

    if (aCol === 0) return zone.GetZoneName();
    if (aCol === 1) return unescapeString(zone.GetNetname());

    if (aCol === 2) {
      const board = this.m_frame.GetBoard();

      if (!board) return '';

      const layers: string[] = [];

      // Make sure we don't show layers from Rule Areas that aren't actually on the board,
      // since they have all copper areas by default.
      const dialogLayers = LSET.AllNonCuMask().or(LSET.AllCuMask(board.GetCopperLayerCount()));

      for (const layer of dialogLayers.UIOrder()) {
        if (zone.IsOnLayer(layer)) layers.push(board.GetLayerName(layer));
      }

      return layers.join(',');
    }

    if (aCol === 3) return `${zone.GetAssignedPriority()}`;
    if (aCol === 4) return coordText(this.m_frame, zone.GetX(), COORDS.ABS_X_COORD);
    if (aCol === 5) return coordText(this.m_frame, zone.GetY(), COORDS.ABS_Y_COORD);

    if (aCol === 6) {
      return this.m_frame.MessageTextFromValue(
        zone.GetIsRuleArea() ? zone.GetOutlineArea() : zone.GetFilledArea(),
        true,
        'area',
      );
    }

    return '';
  }
}

/** `TEXT_SEARCH_HANDLER`. */
export class TEXT_SEARCH_HANDLER extends PCB_SEARCH_HANDLER {
  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super(
      'Text',
      [
        { name: 'Type', proportion: 2, align: 'left' },
        { name: 'Text', proportion: 12, align: 'left' },
        { name: 'Layer', proportion: 3, align: 'center' },
        { name: 'X', proportion: 3, align: 'center' },
        { name: 'Y', proportion: 3, align: 'center' },
      ],
      aFrame,
      aWiring,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const board = this.m_frame.GetBoard();

    if (!board) return 0;

    const frp = searchData(this.m_frame, aQuery);

    for (const item of board.Drawings()) {
      if (
        item.Type() === KICAD_T.PCB_TEXT_T ||
        BaseType(item.Type()) === KICAD_T.PCB_DIMENSION_T ||
        item.Type() === KICAD_T.PCB_TEXTBOX_T ||
        item.Type() === KICAD_T.PCB_TABLECELL_T
      ) {
        if (frp.findString === '' || item.Matches(frp, null)) this.m_hitlist.push(item);
      }
    }

    return this.m_hitlist.length;
  }

  protected getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string {
    if (aCol === 0) {
      if (aItem.Type() === KICAD_T.PCB_TEXT_T) return 'Text';
      if (aItem.Type() === KICAD_T.PCB_TEXTBOX_T) return 'Textbox';
      if (BaseType(aItem.Type()) === KICAD_T.PCB_DIMENSION_T) return 'Dimension';
    } else if (aCol === 1) {
      // PCB_TEXT, PCB_TEXTBOX and PCB_DIMENSION_BASE (a PCB_TEXT) all answer GetText().
      if (
        aItem.Type() === KICAD_T.PCB_TEXT_T ||
        aItem.Type() === KICAD_T.PCB_TEXTBOX_T ||
        BaseType(aItem.Type()) === KICAD_T.PCB_DIMENSION_T
      ) {
        return unescapeString((aItem as PCB_TEXT | PCB_TEXTBOX).GetText());
      }
    } else if (aCol === 2) return aItem.GetLayerName();
    else if (aCol === 3) return coordText(this.m_frame, aItem.GetX(), COORDS.ABS_X_COORD);
    else if (aCol === 4) return coordText(this.m_frame, aItem.GetY(), COORDS.ABS_Y_COORD);

    return '';
  }
}

/** `GROUP_SEARCH_HANDLER`. */
export class GROUP_SEARCH_HANDLER extends PCB_SEARCH_HANDLER {
  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super(
      'Groups',
      [
        { name: 'Type', proportion: 2, align: 'left' },
        { name: 'Name', proportion: 6, align: 'left' },
        { name: 'X', proportion: 3, align: 'center' },
        { name: 'Y', proportion: 3, align: 'center' },
      ],
      aFrame,
      aWiring,
    );
  }

  search(aQuery: string): number {
    this.m_hitlist = [];
    const board = this.m_frame.GetBoard();

    if (!board) return 0;

    const frp = searchData(this.m_frame, aQuery);

    for (const item of board.Groups()) {
      // Skip generators, they are for internal use, not user-facing grouping
      if (item.Type() === KICAD_T.PCB_GENERATOR_T) continue;

      if (frp.findString === '' || item.Matches(frp, null)) this.m_hitlist.push(item);
    }

    return this.m_hitlist.length;
  }

  protected getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string {
    if (aCol === 0) {
      if (aItem.Type() === KICAD_T.PCB_GROUP_T) return 'Group';
      if (aItem.Type() === KICAD_T.PCB_GENERATOR_T) return 'Generator';
    } else if (aCol === 1) return (aItem as PCB_GROUP).GetName();
    else if (aCol === 2) return coordText(this.m_frame, aItem.GetX(), COORDS.ABS_X_COORD);
    else if (aCol === 3) return coordText(this.m_frame, aItem.GetY(), COORDS.ABS_Y_COORD);

    return '';
  }
}

/**
 * The two net tabs share `getResultCell`, `SelectItems` and `ActivateItem`
 * bodies upstream, copied twice; one base here.
 */
abstract class NET_LIST_SEARCH_HANDLER extends PCB_SEARCH_HANDLER {
  constructor(aName: string, aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super(
      aName,
      [
        { name: 'Name', proportion: 6, align: 'left' },
        { name: 'Class', proportion: 6, align: 'left' },
      ],
      aFrame,
      aWiring,
    );
  }

  protected getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string {
    const net = aItem as unknown as NETINFO_ITEM;

    if (net.GetNetCode() === 0) {
      if (aCol === 0) return 'No Net';
      if (aCol === 1) return '';
    }

    if (aCol === 0) return unescapeString(net.GetNetname());
    if (aCol === 1) return net.GetNetClass().GetName();

    return '';
  }

  override selectItems(aItemRows: readonly number[]): void {
    const codes: number[] = [];

    for (const row of aItemRows) {
      if (row >= 0 && row < this.m_hitlist.length) {
        codes.push((this.m_hitlist[row] as unknown as NETINFO_ITEM).GetNetCode());
      }
    }

    this.m_wiring.highlightNets(codes);
  }

  override activateItem(_aItemRow: number): void {
    this.m_wiring.showBoardSetupDialog('Net Classes');
  }
}

/** `NETS_SEARCH_HANDLER`. */
export class NETS_SEARCH_HANDLER extends NET_LIST_SEARCH_HANDLER {
  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super('Nets', aFrame, aWiring);
  }

  search(aQuery: string): number {
    this.m_hitlist = [];

    const frp = searchData(this.m_frame, aQuery);
    const board = this.m_frame.GetBoard();

    if (!board) return 0;

    for (const net of board.GetNetInfo()) {
      if (net && (aQuery === '' || net.Matches(frp, null))) {
        this.m_hitlist.push(net as unknown as BOARD_ITEM);
      }
    }

    return this.m_hitlist.length;
  }
}

/** `RATSNEST_SEARCH_HANDLER`. */
export class RATSNEST_SEARCH_HANDLER extends NET_LIST_SEARCH_HANDLER {
  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super('Ratsnest', aFrame, aWiring);
  }

  search(aQuery: string): number {
    this.m_hitlist = [];

    const frp = searchData(this.m_frame, aQuery);
    const board = this.m_frame.GetBoard();

    if (!board) return 0;

    for (const net of board.GetNetInfo()) {
      if (net == null || !net.Matches(frp, null)) continue;

      const rn = board.GetConnectivity().GetRatsnestForNet(net.GetNetCode());

      if (rn && rn.GetEdges().length > 0) this.m_hitlist.push(net as unknown as BOARD_ITEM);
    }

    return this.m_hitlist.length;
  }
}

/** `DRILL_SEARCH_HANDLER::DRILL_ROW`. */
interface DRILL_ROW {
  entry: DrillLineItem;
  /** One representative pad or via, so the shared `PCB_SEARCH_HANDLER` plumbing works. */
  item: BOARD_ITEM;
}

/** `DRILL_SEARCH_HANDLER`. */
export class DRILL_SEARCH_HANDLER extends PCB_SEARCH_HANDLER {
  private m_drills: DRILL_ROW[] = [];
  /** `m_ptrToDrill`: the DRILL_ROW.item to its index in `m_drills`. */
  private m_ptrToDrill = new Map<BOARD_ITEM, number>();

  constructor(aFrame: PcbSearchFrame, aWiring: PcbSearchWiring) {
    super(
      'Drills',
      [
        { name: 'Count', proportion: 2, align: 'right' },
        { name: 'Shape', proportion: 3, align: 'left' },
        { name: 'X Size', proportion: 3, align: 'center' },
        { name: 'Y Size', proportion: 3, align: 'center' },
        { name: 'Plated', proportion: 2, align: 'center' },
        { name: 'Via/Pad', proportion: 2, align: 'center' },
        { name: 'Start Layer', proportion: 4, align: 'center' },
        { name: 'Stop Layer', proportion: 4, align: 'center' },
      ],
      aFrame,
      aWiring,
    );
  }

  search(aQuery: string): number {
    const board = this.m_frame.GetBoard();

    if (!board) return 0;

    this.m_drills = [];
    this.m_ptrToDrill = new Map();
    this.m_hitlist = [];

    const addEntryOrIncrement = (d: DrillLineItem, rep: BOARD_ITEM): void => {
      for (const g of this.m_drills) {
        if (sameDrillLineItem(g.entry, d)) {
          g.entry.qty++;
          return;
        }
      }

      this.m_drills.push({ entry: { ...d, qty: 1 }, item: rep });
    };

    // Collect from pads
    for (const fp of board.Footprints()) {
      for (const pad of fp.Pads()) {
        const d = padDrill(pad);

        if (d) addEntryOrIncrement(d, pad);
      }
    }

    // Collect from vias
    for (const t of board.Tracks()) {
      if (t.Type() !== KICAD_T.PCB_VIA_T) continue;

      const d = viaDrill(t as PCB_VIA);

      if (d) addEntryOrIncrement(d, t);
    }

    const byCount = DRILL_LINE_ITEM_COMPARE(DRILL_LINE_ITEM_COL_ID.COL_COUNT, false);
    this.m_drills.sort((a, b) => byCount(a.entry, b.entry));

    // Apply filter and populate display list
    for (let i = 0; i < this.m_drills.length; ++i) {
      if (aQuery === '' || this.rowMatchesQuery(this.m_drills[i]!.entry, aQuery.toLowerCase())) {
        this.m_hitlist.push(this.m_drills[i]!.item);
        this.m_ptrToDrill.set(this.m_drills[i]!.item, i);
      }
    }

    return this.m_hitlist.length;
  }

  protected getResultCellOfItem(aItem: BOARD_ITEM, aCol: number): string {
    const it = this.m_ptrToDrill.get(aItem);

    if (it === undefined) return '';

    return this.cellText(this.m_drills[it]!.entry, aCol);
  }

  override sort(aCol: number, aAscending: boolean, aSelection: readonly number[]): number[] {
    // Preserve current selection pointers
    const selPtrs: BOARD_ITEM[] = [];

    for (const row of aSelection) {
      if (row >= 0 && row < this.m_hitlist.length) selPtrs.push(this.m_hitlist[row]!);
    }

    const cmpPtr = (pa: BOARD_ITEM, pb: BOARD_ITEM): number => {
      const itA = this.m_ptrToDrill.get(pa);
      const itB = this.m_ptrToDrill.get(pb);
      const validA = itA !== undefined && itA >= 0 && itA < this.m_drills.length;
      const validB = itB !== undefined && itB >= 0 && itB < this.m_drills.length;

      if (!validA || !validB) {
        // Valid rows first; two invalid ones keep their relative order (the C++
        // compares the pointers, which no caller can observe).
        if (validA !== validB) return validA ? -1 : 1;

        return 0;
      }

      const col = aCol < 0 ? 0 : aCol;

      return DRILL_LINE_ITEM_COMPARE(col as DRILL_LINE_ITEM_COL_ID, aAscending)(
        this.m_drills[itA]!.entry,
        this.m_drills[itB]!.entry,
      );
    };

    this.m_hitlist.sort(cmpPtr);

    // Rebuild selection rows from pointers
    const out: number[] = [];

    for (let row = 0; row < this.m_hitlist.length; ++row) {
      if (selPtrs.includes(this.m_hitlist[row]!)) out.push(row);
    }

    return out;
  }

  override selectItems(aItemRows: readonly number[]): void {
    const board = this.m_frame.GetBoard();

    if (!board) return;

    const selectedItems: EDA_ITEM[] = [];

    // Collect matching items
    for (const row of aItemRows) {
      if (row < 0 || row >= this.m_hitlist.length) continue;

      const rep = this.m_hitlist[row]!;
      const it = this.m_ptrToDrill.get(rep);

      if (it === undefined) continue;

      const target = this.m_drills[it]!.entry;

      // Pads
      for (const fp of board.Footprints()) {
        for (const pad of fp.Pads()) {
          const e = padDrill(pad, false);

          if (e && sameDrillLineItem(e, target)) selectedItems.push(pad);
        }
      }

      // Vias
      for (const t of board.Tracks()) {
        if (t.Type() !== KICAD_T.PCB_VIA_T) continue;

        const via = t as PCB_VIA;
        const e = viaDrill(via, false);

        if (e && sameDrillLineItem(e, target)) selectedItems.push(via);
      }
    }

    this.selectHitlistItems(selectedItems);
  }

  private cellText(e: DrillLineItem, col: number): string {
    const board = this.m_frame.GetBoard();

    if (!board) return '';

    switch (col) {
      case 0:
        return `${e.qty}`;
      case 1:
        return e.shape === PAD_DRILL_SHAPE.CIRCLE ? 'Round' : 'Slot';
      case 2:
        return this.m_frame.MessageTextFromValue(e.xSize);
      case 3:
        return this.m_frame.MessageTextFromValue(e.ySize);
      case 4:
        return e.isPlated ? 'PTH' : 'NPTH';
      case 5:
        return e.isPad ? 'Pad' : 'Via';
      case 6:
        return e.startLayer === PCB_LAYER_ID.UNDEFINED_LAYER
          ? 'N/A'
          : board.GetLayerName(e.startLayer);
      case 7:
        return e.stopLayer === PCB_LAYER_ID.UNDEFINED_LAYER
          ? 'N/A'
          : board.GetLayerName(e.stopLayer);
      default:
        return '';
    }
  }

  private rowMatchesQuery(e: DrillLineItem, aQuery: string): boolean {
    if (aQuery === '') return true;

    for (let col = 0; col < 8; ++col) {
      if (this.cellText(e, col).toLowerCase().includes(aQuery)) return true;
    }

    return false;
  }
}

/** The pad half of `DRILL_SEARCH_HANDLER::Search`; `aSkipEmpty` is false in `SelectItems`, which never skips. */
function padDrill(pad: PAD, aSkipEmpty = true): DrillLineItem | null {
  if (!pad.HasHole()) return null;

  const xs = pad.GetDrillSize().x;
  const ys = pad.GetDrillSize().y;

  if (aSkipEmpty && (xs <= 0 || ys <= 0)) return null;

  const cuStack = pad.GetLayerSet().CuStack();
  const top = cuStack.length === 0 ? PCB_LAYER_ID.UNDEFINED_LAYER : cuStack[0]!;
  const bottom = cuStack.length === 0 ? PCB_LAYER_ID.UNDEFINED_LAYER : cuStack[cuStack.length - 1]!;

  return {
    xSize: xs,
    ySize: ys,
    shape: pad.GetDrillShape(),
    isPlated: pad.GetAttribute() !== PAD_ATTRIB.NPTH,
    isPad: true,
    startLayer: top,
    stopLayer: bottom,
    qty: 0,
  };
}

/** The via half; `SelectItems` builds the entry without the `<= 0` skip. */
function viaDrill(via: PCB_VIA, aSkipEmpty = true): DrillLineItem | null {
  const dmm = via.GetDrillValue();

  if (aSkipEmpty && dmm <= 0) return null;

  return {
    xSize: dmm,
    ySize: dmm,
    shape: PAD_DRILL_SHAPE.CIRCLE,
    isPlated: true,
    isPad: false,
    startLayer: via.TopLayer(),
    stopLayer: via.BottomLayer(),
    qty: 0,
  };
}

/** `PCB_SEARCH_PANE`'s constructor: one handler per tab, in `AddSearcher` order. */
export function makePcbSearchHandlers(
  aFrame: PcbSearchFrame,
  aWiring: PcbSearchWiring,
): SearchHandler[] {
  return [
    new FOOTPRINT_SEARCH_HANDLER(aFrame, aWiring),
    new ZONE_SEARCH_HANDLER(aFrame, aWiring),
    new NETS_SEARCH_HANDLER(aFrame, aWiring),
    new RATSNEST_SEARCH_HANDLER(aFrame, aWiring),
    new TEXT_SEARCH_HANDLER(aFrame, aWiring),
    new GROUP_SEARCH_HANDLER(aFrame, aWiring),
    new DRILL_SEARCH_HANDLER(aFrame, aWiring),
  ];
}
