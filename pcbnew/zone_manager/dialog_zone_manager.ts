// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ZONE_MANAGER` - `pcbnew/zone_manager/dialog_zone_manager.{h,cpp}`,
 * the logic half. The dialog edits a *bag* of zone clones: a table of them by
 * priority (`MODEL_ZONES_OVERVIEW`), the selected one's properties
 * (`PANEL_ZONE_PROPERTIES`) and one preview page per layer
 * (`ZONE_PREVIEW_NOTEBOOK`); OK writes the clones back over the board's zones,
 * keeping each original's fill.
 *
 * The layout - `dialog_zone_manager_base.cpp`, the wxFormBuilder tree - is
 * `dialog_zone_manager_ui.tsx`, which this class drives through
 * {@link DIALOG_ZONE_MANAGER_UI}, the way `dialog_create_array.ts` drives
 * `dialog_create_array_ui.tsx`. The properties panel is `PANEL_ZONE_PROPERTIES`
 * (`dialogs/panel_zone_properties.ts`), seen here as {@link PANEL_ZONE_PROPERTIES_LIKE}.
 */
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '../board.js';
import type { ZONE } from '../zone.js';
import { AutoAssignZonePriorities } from '../zone_utils.js';
import { ZONE_SETTINGS_BAG } from '../zone_settings_bag.js';
import {
  type MODEL_ZONES_FRAME,
  MODEL_ZONES_OVERVIEW,
  type MODEL_ZONES_OVERVIEW_VIEW,
  type wxDataViewItem,
  ZONE_INDEX_MOVEMENT,
} from './model_zones_overview.js';
import type { ZONE_PREVIEW_NOTEBOOK } from './zone_preview_notebook.js';

/** The part of `PANEL_ZONE_PROPERTIES` the dialog calls. */
export interface PANEL_ZONE_PROPERTIES_LIKE {
  SetZone(aZone: ZONE | null): void;
  GetZone(): ZONE | null;
  /** False when a field failed validation (an error was shown). */
  TransferZoneSettingsFromWindow(): boolean;
}

/** The dialog's own controls (the `_base`), as the logic drives them. */
export interface DIALOG_ZONE_MANAGER_UI {
  /** `m_viewZonesOverview->GetSelection()`; null when nothing is selected. */
  GetSelection(): wxDataViewItem;
  Select(aItem: wxDataViewItem): void;
  EnsureVisible(aItem: wxDataViewItem): void;
  /** `m_filterCtrl->GetValue()`. */
  GetFilterText(): string;
  /** `m_layerFilter->Clear(); Append( "All Layers" ); Append( name, layer )...; SetSelection( 0 )`. */
  SetLayerFilterChoices(aChoices: readonly { name: string; layer: PCB_LAYER_ID }[]): void;
  /** `btn->Enable( count > 1 )` for the four move buttons and Auto-assign. */
  EnableMoveButtons(aEnable: boolean): void;
  /** The data view's own notification when the table changes. */
  Reset(aCount: number): void;
  RowChanged(aRow: number): void;
  /** `m_checkRepour->GetValue()`. */
  GetRepourOnClose(): boolean;
}

/** What the dialog reads and does on its `PCB_BASE_FRAME`. */
export interface DIALOG_ZONE_MANAGER_FRAME extends MODEL_ZONES_FRAME {
  GetBoard(): BOARD;
  /**
   * `ZONE_FILLER( board, nullptr ).Fill( zones )` over the clones, with the
   * board's zone list swapped for them for the duration; true when it completed.
   */
  FillZones(aBoard: BOARD, aZones: ZONE[]): boolean;
}

export class DIALOG_ZONE_MANAGER implements MODEL_ZONES_OVERVIEW_VIEW {
  private m_zoneSettingsBag: ZONE_SETTINGS_BAG;
  private m_modelZonesOverview: MODEL_ZONES_OVERVIEW;
  private m_priorityDragIndex: number | undefined;
  private m_isFillingZones = false;
  private m_zoneFillComplete = false;

  constructor(
    private readonly m_pcbFrame: DIALOG_ZONE_MANAGER_FRAME,
    private readonly m_panelZoneProperties: PANEL_ZONE_PROPERTIES_LIKE,
    private readonly m_zonePreviewNotebook: ZONE_PREVIEW_NOTEBOOK,
    private readonly m_ui: DIALOG_ZONE_MANAGER_UI,
    /**
     * `m_zoneSettingsBag`, which the C++ constructs in its member-initializer
     * list before the panel that shares it exists: here the panel is handed in,
     * so the caller that built one over a bag hands the same bag in too.
     */
    aZoneSettingsBag?: ZONE_SETTINGS_BAG,
  ) {
    this.m_zoneSettingsBag = aZoneSettingsBag ?? new ZONE_SETTINGS_BAG(m_pcbFrame.GetBoard());
    this.m_modelZonesOverview = new MODEL_ZONES_OVERVIEW(this, m_pcbFrame, this.m_zoneSettingsBag);

    let usedLayers = new LSET();
    const board = this.m_pcbFrame.GetBoard();

    for (const zone of this.m_zoneSettingsBag.GetClonedZoneList())
      usedLayers = usedLayers.or(zone.GetLayerSet());

    this.m_ui.SetLayerFilterChoices(
      usedLayers.Seq().map((layer) => ({ name: board.GetLayerName(layer), layer })),
    );

    this.m_modelZonesOverview.SetLayerFilter(PCB_LAYER_ID.UNDEFINED_LAYER);
    this.m_modelZonesOverview.ApplyFilter(this.m_ui.GetFilterText(), this.m_ui.GetSelection());

    if (this.m_modelZonesOverview.GetCount())
      this.SelectZoneTableItem(this.m_modelZonesOverview.GetItem(0));
    else this.m_panelZoneProperties.SetZone(null);
  }

  GetModel(): MODEL_ZONES_OVERVIEW {
    return this.m_modelZonesOverview;
  }

  GetBag(): ZONE_SETTINGS_BAG {
    return this.m_zoneSettingsBag;
  }

  GetRepourOnClose(): boolean {
    return this.m_ui.GetRepourOnClose();
  }

  /** True when the last "Update Displayed Zones" fill ran to the end. */
  IsZoneFillComplete(): boolean {
    return this.m_zoneFillComplete;
  }

  // MODEL_ZONES_OVERVIEW_VIEW: the model's wx notifications.
  Reset(aCount: number): void {
    this.m_ui.Reset(aCount);
  }

  RowChanged(aRow: number): void {
    this.m_ui.RowChanged(aRow);
  }

  /** `OnZonesTableRowCountChange`. */
  OnRowCountChange(aCount: number): void {
    this.m_ui.EnableMoveButtons(aCount > 1);
  }

  PostProcessZoneViewSelChange(aItem: wxDataViewItem): void {
    if (aItem !== null) {
      this.m_ui.Select(aItem);
      this.m_ui.EnsureVisible(aItem);
      this.SelectZoneTableItem(aItem);
    } else if (this.m_modelZonesOverview.GetCount()) {
      const first_item = this.m_modelZonesOverview.GetItem(0);
      this.m_ui.Select(first_item);
      this.m_ui.EnsureVisible(first_item);
      this.m_zonePreviewNotebook.OnZoneSelectionChanged(
        this.m_modelZonesOverview.GetZone(first_item),
      );
    } else {
      this.m_zonePreviewNotebook.OnZoneSelectionChanged(null);
    }
  }

  /** `OnDialogCharHook`'s WXK_UP / WXK_DOWN. */
  NavigateZoneSelection(aDirection: number): void {
    const count = this.m_modelZonesOverview.GetCount();

    if (count === 0) return;

    const current = this.m_ui.GetSelection();
    let currentRow = 0;

    if (current !== null) currentRow = this.m_modelZonesOverview.GetRow(current);

    let newRow = currentRow + aDirection;
    newRow = Math.max(0, Math.min(newRow, count - 1));

    if (current === null || newRow !== currentRow)
      this.PostProcessZoneViewSelChange(this.m_modelZonesOverview.GetItem(newRow));
  }

  OnZoneSelectionChanged(aZone: ZONE): void {
    this.m_panelZoneProperties.SetZone(aZone);
    this.m_zonePreviewNotebook.OnZoneSelectionChanged(aZone);
  }

  /** `OnDataViewCtrlSelectionChanged`. */
  OnDataViewCtrlSelectionChanged(aItem: wxDataViewItem): void {
    this.SelectZoneTableItem(aItem);
  }

  SelectZoneTableItem(aItem: wxDataViewItem): void {
    const zone = this.m_modelZonesOverview.GetZone(aItem);

    if (!zone) return;

    this.OnZoneSelectionChanged(zone);
  }

  /**
   * `OnOk`: the properties panel's fields into the bag, the bag into the
   * clones, and each clone over its original - which keeps its own fill
   * (`*zone = *zoneClone`, then `SetFilledPolysList` per layer).
   */
  OnOk(): void {
    this.m_panelZoneProperties.TransferZoneSettingsFromWindow();

    this.m_zoneSettingsBag.UpdateClonedZones();

    for (const [zone, zoneClone] of this.m_zoneSettingsBag.GetZonesCloneMap()) {
      const filled_zone_to_restore = new Map<
        PCB_LAYER_ID,
        ReturnType<ZONE['GetFilledPolysList']>
      >();

      zone.GetLayerSet().RunOnLayers((layer: PCB_LAYER_ID) => {
        const fill = zone.GetFilledPolysList(layer);

        if (fill) filled_zone_to_restore.set(layer, fill);
      });

      zone.assignZone(zoneClone);

      for (const [layer, fill] of filled_zone_to_restore) zone.SetFilledPolysList(layer, fill);
    }
  }

  // Drag and drop of a row, to change its priority.
  OnBeginDrag(aItem: wxDataViewItem): void {
    if (aItem !== null) this.m_priorityDragIndex = this.m_modelZonesOverview.GetRow(aItem);
  }

  /** `OnDrop`: false when the drop is vetoed. */
  OnDrop(aItem: wxDataViewItem): boolean {
    if (this.m_priorityDragIndex === undefined) return true;

    if (aItem === null) return false;

    const drop_index = this.m_modelZonesOverview.GetRow(aItem);
    const rtn = this.m_modelZonesOverview.SwapZonePriority(this.m_priorityDragIndex, drop_index);

    if (rtn !== undefined) {
      const item = this.m_modelZonesOverview.GetItem(rtn);

      if (item !== null) this.m_ui.Select(item);
    }

    return true;
  }

  MoveSelectedZonePriority(aMove: ZONE_INDEX_MOVEMENT): void {
    const selectedItem = this.m_ui.GetSelection();

    if (selectedItem === null) return;

    const selectedRow = this.m_modelZonesOverview.GetRow(selectedItem);
    const new_index = this.m_modelZonesOverview.MoveZoneIndex(selectedRow, aMove);

    if (new_index !== undefined)
      this.PostProcessZoneViewSelChange(this.m_modelZonesOverview.GetItem(new_index));
  }

  OnMoveTopClick(): void {
    this.MoveSelectedZonePriority(ZONE_INDEX_MOVEMENT.MOVE_TO_TOP);
  }

  OnMoveUpClick(): void {
    this.MoveSelectedZonePriority(ZONE_INDEX_MOVEMENT.MOVE_UP);
  }

  OnMoveDownClick(): void {
    this.MoveSelectedZonePriority(ZONE_INDEX_MOVEMENT.MOVE_DOWN);
  }

  OnMoveBottomClick(): void {
    this.MoveSelectedZonePriority(ZONE_INDEX_MOVEMENT.MOVE_TO_BOTTOM);
  }

  /**
   * `OnAutoAssignClick`: run `AutoAssignZonePriorities` on the real zones, copy
   * the priorities it chose to the clones, then put the originals back - the
   * dialog works on clones and only OK may touch the board.
   */
  OnAutoAssignClick(): void {
    const board = this.m_pcbFrame.GetBoard();

    const savedPriorities = new Map<ZONE, number>();

    for (const zone of board.Zones()) savedPriorities.set(zone, zone.GetAssignedPriority());

    if (AutoAssignZonePriorities(board)) {
      for (const [original, clone] of this.m_zoneSettingsBag.GetZonesCloneMap()) {
        const newPri = original.GetAssignedPriority();
        clone.SetAssignedPriority(newPri);
        this.m_zoneSettingsBag.SetZonePriority(clone, newPri);
      }

      this.PostProcessZoneViewSelChange(
        this.m_modelZonesOverview.ApplyFilter(this.m_ui.GetFilterText(), this.m_ui.GetSelection()),
      );
    }

    for (const [zone, priority] of savedPriorities) zone.SetAssignedPriority(priority);
  }

  OnFilterCtrlCancel(): void {
    this.PostProcessZoneViewSelChange(
      this.m_modelZonesOverview.ClearFilter(this.m_ui.GetSelection()),
    );
  }

  /** `OnFilterCtrlSearch` / `OnFilterCtrlTextChange` / `OnFilterCtrlEnter`, the same body. */
  OnFilterCtrlTextChange(aText: string): void {
    this.PostProcessZoneViewSelChange(
      this.m_modelZonesOverview.ApplyFilter(aText, this.m_ui.GetSelection()),
    );
  }

  OnLayerFilterChanged(aLayer: PCB_LAYER_ID | null): void {
    this.m_modelZonesOverview.SetLayerFilter(aLayer ?? PCB_LAYER_ID.UNDEFINED_LAYER);

    this.PostProcessZoneViewSelChange(
      this.m_modelZonesOverview.ApplyFilter(this.m_ui.GetFilterText(), this.m_ui.GetSelection()),
    );
  }

  /** `OnCheckBoxClicked` for the "Name" and "Net" filter boxes. */
  OnFilterFieldCheckBox(aWhich: 'name' | 'net', aChecked: boolean): void {
    if (aWhich === 'name') this.m_modelZonesOverview.EnableFitterByName(aChecked);
    else this.m_modelZonesOverview.EnableFitterByNet(aChecked);

    if (this.m_ui.GetFilterText() !== '')
      this.m_modelZonesOverview.ApplyFilter(this.m_ui.GetFilterText(), this.m_ui.GetSelection());
  }

  /**
   * `OnUpdateDisplayedZonesClick`: fill the *clones* (never the board's own
   * zones) so the previews show what the settings would produce, then redraw the
   * preview of the selected zone.
   */
  OnUpdateDisplayedZonesClick(): void {
    if (this.m_isFillingZones) return;

    this.m_isFillingZones = true;

    if (!this.m_panelZoneProperties.TransferZoneSettingsFromWindow()) {
      this.m_isFillingZones = false;
      return;
    }

    this.m_zoneSettingsBag.UpdateClonedZones();

    const board = this.m_pcbFrame.GetBoard();
    board.IncrementTimeStamp();

    this.m_zoneFillComplete = this.m_pcbFrame.FillZones(
      board,
      this.m_zoneSettingsBag.GetClonedZoneList(),
    );

    this.m_zonePreviewNotebook.OnZoneSelectionChanged(this.m_panelZoneProperties.GetZone());

    this.m_isFillingZones = false;
  }

  /** `OnZoneNameUpdate` / `OnZoneNetUpdate`: the edited zone's row repaints. */
  OnZoneNameUpdate(): void {
    const zone = this.m_panelZoneProperties.GetZone();

    if (zone)
      this.RowChanged(
        this.m_modelZonesOverview.GetRow(this.m_modelZonesOverview.GetItemByZone(zone)),
      );
  }

  OnZoneNetUpdate(): void {
    this.OnZoneNameUpdate();
  }
}
