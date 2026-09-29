// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MODEL_ZONES_OVERVIEW` - `pcbnew/zone_manager/model_zones_overview.{h,cpp}`:
 * the Zone Manager's table model, a `wxDataViewVirtualListModel` over the
 * bag's cloned zones, filtered by a text and a layer and sorted by priority.
 *
 * A `wxDataViewItem` is the row index here, and `null` the invalid item (the
 * convention of `common/widgets/wx_dataviewctrl.ts`). What the view must be told
 * (`Reset( count )`, `RowChanged( row )`, `wxPostEvent( EVT_ZONES_OVERVIEW_COUNT_CHANGE )`)
 * goes through {@link MODEL_ZONES_OVERVIEW_VIEW}.
 *
 * The Layers cell's icon is `MakeBitmapForLayers`' bitmap; it is returned as the
 * rectangles that bitmap is drawn from, for the view to paint.
 */
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { BOARD } from '../board.js';
import type { ZONE } from '../zone.js';
import type { ZONE_SETTINGS_BAG } from '../zone_settings_bag.js';

export const LAYER_BAR_WIDTH = 16;
export const LAYER_BAR_HEIGHT = 16;

export type wxDataViewItem = number | null;

export enum ZONE_INDEX_MOVEMENT {
  MOVE_UP,
  MOVE_DOWN,
  MOVE_TO_TOP,
  MOVE_TO_BOTTOM,
}

/** The columns (`MODEL_ZONES_OVERVIEW` enum). */
export enum ZONES_OVERVIEW_COL {
  NAME,
  NET,
  LAYERS,
  COL_COUNT,
}

/** `GetColumnNames()`. */
export const GetColumnNames = (): ReadonlyMap<number, string> =>
  new Map([
    [ZONES_OVERVIEW_COL.NAME, 'Name'],
    [ZONES_OVERVIEW_COL.NET, 'Net'],
    [ZONES_OVERVIEW_COL.LAYERS, 'Layers'],
  ]);

/** What the model reads from its `PCB_BASE_FRAME`. */
export interface MODEL_ZONES_FRAME {
  GetBoard(): BOARD | null;
  GetColorSettings(): COLOR_SETTINGS;
}

/** What the model tells its `wxDataViewCtrl` (the wx notifications and the count event). */
export interface MODEL_ZONES_OVERVIEW_VIEW {
  /** `Reset( count )`: the whole table changed. */
  Reset(aCount: number): void;
  /** `RowChanged( row )`. */
  RowChanged(aRow: number): void;
  /** `EVT_ZONES_OVERVIEW_COUNT_CHANGE` posted to the parent, with `GetCount()`. */
  OnRowCountChange(aCount: number): void;
}

/** One stripe of `MakeBitmapForLayers`' bitmap. */
export interface LAYER_BAR_RECT {
  x: number;
  y: number;
  w: number;
  h: number;
  color: Color4d;
}

/**
 * `MakeBitmapForLayers`: a stripe per layer, colours from the colour settings,
 * top to bottom; above 4 layers only the first two and the last two.
 */
export function MakeBitmapForLayers(
  aLayers: LSEQ,
  aSettings: COLOR_SETTINGS,
  aSize: { x: number; y: number },
): LAYER_BAR_RECT[] {
  const layer_cout = aLayers.length;
  let layersToDraw: PCB_LAYER_ID[];

  if (layer_cout > 4) {
    layersToDraw = [aLayers[0]!, aLayers[1]!, aLayers[layer_cout - 1]!, aLayers[layer_cout - 2]!];
  } else {
    layersToDraw = [...aLayers];
  }

  const step = Math.trunc(aSize.y / layersToDraw.length);

  return layersToDraw.map((layer, i) => ({
    x: 0,
    y: i * step,
    w: aSize.x,
    h: step,
    color: aSettings.GetColor(layer),
  }));
}

/** A cell: `wxVariant` of a string, or the `wxDataViewIconText` of the Layers column. */
export type ZONES_OVERVIEW_CELL =
  | { text: string }
  | { text: string; icon: LAYER_BAR_RECT[] }
  | null;

export class MODEL_ZONES_OVERVIEW {
  private m_filteredZones: ZONE[];
  private m_sortByName = true;
  private m_sortByNet = true;
  private m_layerFilter: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;

  constructor(
    private readonly m_view: MODEL_ZONES_OVERVIEW_VIEW,
    private readonly m_frame: MODEL_ZONES_FRAME,
    private readonly m_zoneSettingsBag: ZONE_SETTINGS_BAG,
  ) {
    this.m_filteredZones = [...this.m_zoneSettingsBag.GetClonedZoneList()];
    this.m_view.Reset(this.m_filteredZones.length);
  }

  /** `wxDataViewVirtualListModel::GetItem( row )`. */
  GetItem(aRow: number): wxDataViewItem {
    return aRow;
  }

  /** `wxDataViewVirtualListModel::GetRow( item )`. */
  GetRow(aItem: wxDataViewItem): number {
    return aItem ?? -1;
  }

  private SortFilteredZones(): void {
    this.m_filteredZones.sort((l, r) => (l.HigherPriority(r) ? -1 : r.HigherPriority(l) ? 1 : 0));
  }

  private OnRowCountChange(): void {
    this.m_view.OnRowCountChange(this.GetCount());
  }

  GetValueByRow(aRow: number, aCol: ZONES_OVERVIEW_COL): ZONES_OVERVIEW_CELL {
    if (aRow + 1 > this.m_filteredZones.length) return null;

    const cur = this.m_filteredZones[aRow]!;

    switch (aCol) {
      case ZONES_OVERVIEW_COL.NAME:
        return { text: cur.GetZoneName() };

      case ZONES_OVERVIEW_COL.NET:
        return { text: cur.GetNet()?.GetNetname() ?? '' };

      case ZONES_OVERVIEW_COL.LAYERS: {
        const board = this.m_frame.GetBoard()!;
        const layers = cur
          .GetLayerSet()
          .Seq()
          .map((layer) => board.GetLayerName(layer));

        return {
          text: layers.join(','),
          icon: MakeBitmapForLayers(cur.GetLayerSet().UIOrder(), this.m_frame.GetColorSettings(), {
            x: LAYER_BAR_WIDTH,
            y: LAYER_BAR_HEIGHT,
          }),
        };
      }

      default:
        return null;
    }
  }

  EnableFitterByName(aEnable: boolean): void {
    this.m_sortByName = aEnable;
  }

  EnableFitterByNet(aEnable: boolean): void {
    this.m_sortByNet = aEnable;
  }

  SetLayerFilter(aLayer: PCB_LAYER_ID): void {
    this.m_layerFilter = aLayer;
  }

  /** `SetValueByRow`: the table is read-only; upstream returns `{}` (false). */
  SetValueByRow(_aValue: unknown, _aRow: number, _aCol: number): boolean {
    return false;
  }

  GetCount(): number {
    return this.m_filteredZones.length;
  }

  GetZone(aItem: wxDataViewItem): ZONE | null {
    if (aItem === null) return null;

    const aRow = this.GetRow(aItem);

    if (aRow + 1 > this.GetCount()) return null;

    return this.m_filteredZones[aRow]!;
  }

  GetItemByZone(aZone: ZONE | null): wxDataViewItem {
    if (!aZone) return null;

    for (let i = 0; i < this.m_filteredZones.length; i++) {
      if (this.m_filteredZones[i] === aZone) return this.GetItem(i);
    }

    return null;
  }

  /** `MoveZoneIndex`: the new index of the moved zone, or undefined when nothing moved. */
  MoveZoneIndex(aIndex: number, aMovement: ZONE_INDEX_MOVEMENT): number | undefined {
    switch (aMovement) {
      case ZONE_INDEX_MOVEMENT.MOVE_UP:
        if (aIndex >= 1 && this.GetCount() > 1) return this.SwapZonePriority(aIndex, aIndex - 1);

        break;

      case ZONE_INDEX_MOVEMENT.MOVE_DOWN:
        if (aIndex + 1 < this.GetCount()) return this.SwapZonePriority(aIndex, aIndex + 1);

        break;

      case ZONE_INDEX_MOVEMENT.MOVE_TO_TOP:
        if (aIndex >= 1 && this.GetCount() > 1) {
          let cur = aIndex;

          while (cur > 0) {
            this.SwapZonePriority(cur, cur - 1);
            --cur;
          }

          return 0;
        }

        break;

      case ZONE_INDEX_MOVEMENT.MOVE_TO_BOTTOM:
        if (aIndex + 1 < this.GetCount()) {
          let cur = aIndex;
          const last = this.GetCount() - 1;

          while (cur < last) {
            this.SwapZonePriority(cur, cur + 1);
            ++cur;
          }

          return last;
        }

        break;
    }

    return undefined;
  }

  /** `SwapZonePriority`: swap two rows (drag and drop). The dragged one's new index. */
  SwapZonePriority(aDragIndex: number, aDropIndex: number): number | undefined {
    for (const i of [aDragIndex, aDropIndex]) {
      if (!(i >= 0 && i < this.GetCount())) return undefined;
    }

    if (aDragIndex === aDropIndex) return aDragIndex;

    this.m_zoneSettingsBag.SwapPriority(
      this.m_filteredZones[aDragIndex]!,
      this.m_filteredZones[aDropIndex]!,
    );
    const tmp = this.m_filteredZones[aDragIndex]!;
    this.m_filteredZones[aDragIndex] = this.m_filteredZones[aDropIndex]!;
    this.m_filteredZones[aDropIndex] = tmp;

    for (const row of [aDragIndex, aDropIndex]) this.m_view.RowChanged(row);

    return aDropIndex;
  }

  /** `ApplyFilter`: zones whose name or net contains the text (and are on the layer). */
  ApplyFilter(aFilterText: string, aSelection: wxDataViewItem): wxDataViewItem {
    if (this.m_zoneSettingsBag.GetClonedZoneList().length === 0) return null;

    const lowerFilterText = aFilterText.trim().toLowerCase();

    if (lowerFilterText === '') return this.ClearFilter(aSelection);

    const selected_zone = this.GetZone(aSelection);
    this.m_filteredZones = [];

    for (const zone of this.m_zoneSettingsBag.GetClonedZoneList()) {
      if (
        this.m_layerFilter !== PCB_LAYER_ID.UNDEFINED_LAYER &&
        !zone.GetLayerSet().Contains(this.m_layerFilter)
      )
        continue;

      if (
        (this.m_sortByName && zone.GetZoneName().toLowerCase().includes(lowerFilterText)) ||
        (this.m_sortByNet && zone.GetNetname().toLowerCase().includes(lowerFilterText))
      )
        this.m_filteredZones.push(zone);
    }

    this.SortFilteredZones();
    this.m_view.Reset(this.GetCount());
    this.OnRowCountChange();
    return this.GetItemByZone(selected_zone);
  }

  /** `ClearFilter`: back to every zone (still on the layer filter), by priority. */
  ClearFilter(aSelection: wxDataViewItem): wxDataViewItem {
    if (this.m_zoneSettingsBag.GetClonedZoneList().length === 0) return null;

    const zone = this.GetZone(aSelection);
    this.m_filteredZones = [];

    for (const z of this.m_zoneSettingsBag.GetClonedZoneList()) {
      if (
        this.m_layerFilter === PCB_LAYER_ID.UNDEFINED_LAYER ||
        z.GetLayerSet().Contains(this.m_layerFilter)
      )
        this.m_filteredZones.push(z);
    }

    this.SortFilteredZones();
    this.m_view.Reset(this.GetCount());
    this.OnRowCountChange();
    return this.GetItemByZone(zone);
  }
}
