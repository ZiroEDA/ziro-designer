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
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { toCss } from '@ziroeda/common/gal/color4d.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import {
  PANEL_ZONE_PROPERTIES,
  type PANEL_ZONE_PROPERTIES_FRAME,
} from '../dialogs/panel_zone_properties.js';
import { PanelZoneProperties } from '../dialogs/panel_zone_properties.js';
import {
  GetColumnNames,
  LAYER_BAR_WIDTH,
  type MODEL_ZONES_FRAME,
  MODEL_ZONES_OVERVIEW,
  type MODEL_ZONES_OVERVIEW_VIEW,
  ZONES_OVERVIEW_COL,
  ZONE_INDEX_MOVEMENT,
  type wxDataViewItem,
} from './model_zones_overview.js';
import {
  LAYER_ICON_SIZE,
  ZONE_PREVIEW_NOTEBOOK,
  type ZONE_PREVIEW_CANVAS_LIKE,
  type ZONE_PREVIEW_NOTEBOOK_HOST,
  type ZONE_PREVIEW_NOTEBOOK_PAGE,
} from './zone_preview_notebook.js';

/** What the dialog reads and does on its `PCB_BASE_FRAME`. */
import { DataViewCtrl, DataViewIconText } from '@ziroeda/wx/dataview_ui.js';
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import { DIALOG_ZONE_MANAGER_BASE } from './dialog_zone_manager_base.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '../board.js';
import type { ZONE } from '../zone.js';
import { AutoAssignZonePriorities } from '../zone_utils.js';
import { ZONE_SETTINGS_BAG } from '../zone_settings_bag.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

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

export interface ZONE_MANAGER_FRAME extends DIALOG_ZONE_MANAGER_FRAME, PANEL_ZONE_PROPERTIES_FRAME {
  GetBoard(): BOARD;
  GetColorSettings(): COLOR_SETTINGS;
}

/**
 * `new ZONE_PREVIEW_CANVAS( aBoard, aZone->Clone( aLayer ), aLayer, page, ... )`
 * onto `aPage`, the page's element. The canvas is a WebGL panel, which is the
 * window's to make: `PCB_EDIT_FRAME` hands one in.
 */
export type ZonePreviewCanvasFactory = (
  aBoard: BOARD,
  aZone: ZONE,
  aLayer: PCB_LAYER_ID,
  aPage: HTMLElement,
) => ZONE_PREVIEW_CANVAS_LIKE & { Destroy?(): void };

/**
 * The state `m_viewZonesOverview`, `m_filterCtrl`, `m_layerFilter`, the four
 * move buttons and `m_checkRepour` hold, which the logic reads and drives
 * through {@link DIALOG_ZONE_MANAGER_UI}. A store, because the logic's
 * constructor talks to the controls before the window has rendered.
 */
export class ZONE_MANAGER_VIEW implements DIALOG_ZONE_MANAGER_UI {
  private m_selection: wxDataViewItem = null;
  private m_filterText = '';
  private m_choices: { name: string; layer: PCB_LAYER_ID }[] = [];
  private m_moveEnabled = true;
  private m_repour = false;
  private m_count = 0;
  private m_version = 0;
  private readonly m_listeners = new Set<() => void>();
  /** The row `EnsureVisible` last asked to be scrolled to. */
  m_visibleRow: number | null = null;

  Subscribe = (aListener: () => void): (() => void) => {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  };

  GetVersion = (): number => this.m_version;

  private notify(): void {
    this.m_version++;
    for (const l of this.m_listeners) l();
  }

  GetSelection(): wxDataViewItem {
    return this.m_selection;
  }

  Select(aItem: wxDataViewItem): void {
    this.m_selection = aItem;
    this.notify();
  }

  EnsureVisible(aItem: wxDataViewItem): void {
    this.m_visibleRow = aItem;
    this.notify();
  }

  GetFilterText(): string {
    return this.m_filterText;
  }

  SetFilterText(aText: string): void {
    this.m_filterText = aText;
    this.notify();
  }

  SetLayerFilterChoices(aChoices: readonly { name: string; layer: PCB_LAYER_ID }[]): void {
    this.m_choices = [...aChoices];
    this.notify();
  }

  GetLayerFilterChoices(): readonly { name: string; layer: PCB_LAYER_ID }[] {
    return this.m_choices;
  }

  EnableMoveButtons(aEnable: boolean): void {
    this.m_moveEnabled = aEnable;
    this.notify();
  }

  IsMoveEnabled(): boolean {
    return this.m_moveEnabled;
  }

  Reset(aCount: number): void {
    this.m_count = aCount;

    // A reset drops the selection, as `wxDataViewVirtualListModel::Reset` does.
    if (this.m_selection !== null && this.m_selection >= aCount) this.m_selection = null;

    this.notify();
  }

  RowChanged(_aRow: number): void {
    this.notify();
  }

  GetRepourOnClose(): boolean {
    return this.m_repour;
  }

  SetRepour(aRepour: boolean): void {
    this.m_repour = aRepour;
    this.notify();
  }
}

/** The tab strip's state: `wxNotebook`'s pages and selection. */
class ZONE_NOTEBOOK_HOST implements ZONE_PREVIEW_NOTEBOOK_HOST {
  m_pages: readonly ZONE_PREVIEW_NOTEBOOK_PAGE[] = [];
  m_selection = -1;
  private readonly m_created: {
    canvas: ZONE_PREVIEW_CANVAS_LIKE & { Destroy?(): void };
    el: HTMLElement;
  }[] = [];
  private readonly m_listeners = new Set<() => void>();
  private m_version = 0;

  constructor(
    private readonly m_frame: ZONE_MANAGER_FRAME,
    private readonly m_factory: ZonePreviewCanvasFactory,
    /** The element the pages' elements are appended to. */
    private readonly m_pagesEl: HTMLElement,
  ) {}

  Subscribe = (aListener: () => void): (() => void) => {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  };

  GetVersion = (): number => this.m_version;

  private notify(): void {
    this.m_version++;
    for (const l of this.m_listeners) l();
  }

  GetBoard(): BOARD | null {
    return this.m_frame.GetBoard();
  }

  CreateCanvas(aBoard: BOARD, aZone: ZONE, aLayer: PCB_LAYER_ID): ZONE_PREVIEW_CANVAS_LIKE {
    // `ZONE_PREVIEW_NOTEBOOK_PAGE`: a panel holding the canvas at proportion 1.
    const el = document.createElement('div');
    el.className = 'ze-zm-nbpage';
    this.m_pagesEl.appendChild(el);

    const canvas = this.m_factory(aBoard, aZone.Clone(aLayer), aLayer, el);
    this.m_created.push({ canvas, el });

    return canvas;
  }

  OnPagesChanged(aPages: readonly ZONE_PREVIEW_NOTEBOOK_PAGE[], aSelection: number): void {
    this.m_pages = aPages;
    this.m_selection = aSelection;

    // "Detaching a page destroys the native window under its GAL canvas but
    // leaves the canvas repainting into it, so the pages have to be destroyed
    // outright": what is not a page any more goes.
    const live = new Set(aPages.map((p) => p.GetCanvas()));

    for (let i = this.m_created.length - 1; i >= 0; i--) {
      const c = this.m_created[i]!;

      if (live.has(c.canvas)) continue;

      c.canvas.Destroy?.();
      c.el.remove();
      this.m_created.splice(i, 1);
    }

    this.ShowSelected();
    this.notify();
  }

  /** Only the selected page's element is shown. */
  /** The element a page's canvas draws in, for the notebook page that shows it. */
  GetPageElement(aPage: ZONE_PREVIEW_NOTEBOOK_PAGE): HTMLElement | null {
    return this.m_created.find((c) => c.canvas === aPage.GetCanvas())?.el ?? null;
  }

  ShowSelected(): void {
    this.m_pages.forEach((page, i) => {
      const c = this.m_created.find((x) => x.canvas === page.GetCanvas());

      if (c) c.el.style.display = i === this.m_selection ? '' : 'none';
    });
  }

  PostSizeEvent(): void {
    // The canvases watch their own element's size.
  }

  Destroy(): void {
    for (const c of this.m_created) {
      c.canvas.Destroy?.();
      c.el.remove();
    }

    this.m_created.length = 0;
  }
}

export interface DialogZoneManagerProps {
  frame: ZONE_MANAGER_FRAME;
  /** The frame's display units, the panel's UNIT_BINDERs. */
  units: StatusUnits;
  /** Net codes and names, for the panel's NET_SELECTOR. */
  nets: ReadonlyMap<number, string>;
  /** `ZONE_PREVIEW_CANVAS`, made over the window's WebGL. */
  createCanvas: ZonePreviewCanvasFactory;
  /** `DisplayErrorMessage( this, msg )`. */
  displayError?: (aMessage: string) => void;
  /**
   * `ShowQuasiModal()`'s answer: true for wxID_OK (the zones are written back
   * by then), and `GetRepourOnClose()`. False for wxID_CANCEL.
   */
  onResult: (aOk: boolean, aRepour: boolean) => void;
}

/** The logic, its controls' store, and the parts built over both. */
class SESSION {
  readonly view = new ZONE_MANAGER_VIEW();
  readonly notebookHost: ZONE_NOTEBOOK_HOST;
  readonly notebook: ZONE_PREVIEW_NOTEBOOK;
  readonly panel: PANEL_ZONE_PROPERTIES;
  readonly dialog: DIALOG_ZONE_MANAGER;

  constructor(aProps: DialogZoneManagerProps, aPagesEl: HTMLElement) {
    this.notebookHost = new ZONE_NOTEBOOK_HOST(aProps.frame, aProps.createCanvas, aPagesEl);
    this.notebook = new ZONE_PREVIEW_NOTEBOOK(this.notebookHost);

    let dialog: DIALOG_ZONE_MANAGER | null = null;

    // `m_zoneSettingsBag( aParent->GetBoard() )`, shared by the dialog and the panel.
    const bag = new ZONE_SETTINGS_BAG(aProps.frame.GetBoard());

    this.panel = new PANEL_ZONE_PROPERTIES(aProps.frame, bag, true, {
      ZoneNameUpdate: () => dialog?.OnZoneNameUpdate(),
      ZoneNetUpdate: () => dialog?.OnZoneNetUpdate(),
      ...(aProps.displayError ? { DisplayErrorMessage: aProps.displayError } : {}),
    });

    dialog = new DIALOG_ZONE_MANAGER(aProps.frame, this.panel, this.notebook, this.view, bag);
    this.dialog = dialog;
  }
}

const COLUMNS = [ZONES_OVERVIEW_COL.NAME, ZONES_OVERVIEW_COL.NET, ZONES_OVERVIEW_COL.LAYERS];

export function DialogZoneManager(props: DialogZoneManagerProps): JSX.Element | null {
  // The pages' element is made first and put in the window once it renders.
  const [pagesEl] = useState(() => document.createElement('div'));
  const [session, setSession] = useState<SESSION | null>(null);

  // The constructor of the dialog builds a WebGL canvas per layer of the first
  // zone: a side effect, so it runs once mounted and not in a render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: made once, from the props it opened with
  useEffect(() => {
    const s = new SESSION(props, pagesEl);
    setSession(s);

    return () => s.notebookHost.Destroy();
  }, []);

  return session ? <ZoneManagerBody props={props} session={session} pagesEl={pagesEl} /> : null;
}

function ZoneManagerBody({
  props,
  session,
  pagesEl,
}: {
  props: DialogZoneManagerProps;
  session: SESSION;
  pagesEl: HTMLElement;
}): JSX.Element {
  const { frame, units, nets, onResult } = props;
  const { view, dialog, panel, notebook, notebookHost } = session;

  // The three stores this window is a view of.
  useSyncExternalStore(view.Subscribe, view.GetVersion);
  useSyncExternalStore(panel.Subscribe.bind(panel), panel.GetVersion.bind(panel));
  useSyncExternalStore(notebookHost.Subscribe, notebookHost.GetVersion);

  const close = (ok: boolean): void => {
    onResult(ok, ok ? dialog.GetRepourOnClose() : false);
  };

  // `OnIdle`'s `m_viewZonesOverview->SetFocus()`: the tree view takes the focus
  // and, with nothing selected, GTK selects the first row.
  const model = dialog.GetModel();
  const table = useRef<HTMLTableElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one shot on the first render
  useEffect(() => {
    if (view.GetSelection() === null && model.GetCount() > 0) view.Select(model.GetItem(0));
    table.current?.focus();
  }, []);

  const selection = view.GetSelection();

  // `EnsureVisible`.
  const visibleRow = view.m_visibleRow;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row is the trigger
  useEffect(() => {
    if (visibleRow !== null)
      table.current
        ?.querySelector<HTMLElement>(`tr[data-row="${visibleRow}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [visibleRow]);

  const columnNames = GetColumnNames();
  const rows = Array.from({ length: model.GetCount() }, (_, i) => i);
  const layerSel = view.GetLayerFilterChoices();
  const [layerIndex, setLayerIndex] = useState(0);
  const moveEnabled = view.IsMoveEnabled();
  const values = panel.GetValues();
  const zoneKey = panel.GetZone();
  // A key per zone shown, so the panel's half-typed text does not follow to the next one.
  const zoneKeys = useRef({ next: 1, ids: new WeakMap<object, number>() });
  const keyOf = (z: object | null): number => {
    if (!z) return 0;
    let k = zoneKeys.current.ids.get(z);
    if (k === undefined) {
      k = zoneKeys.current.next++;
      zoneKeys.current.ids.set(z, k);
    }
    return k;
  };

  const colors = frame.GetColorSettings();
  const swatch = (layer: PCB_LAYER_ID): string => toCss(colors.GetColor(layer));

  const [checks, setChecks] = useState({ name: true, net: true });

  return (
    <DIALOG_ZONE_MANAGER_BASE
      m_filterCtrl={{
        value: view.GetFilterText(),
        onChange: (aValue) => {
          view.SetFilterText(aValue);
          dialog.OnFilterCtrlTextChange(aValue);
        },
        onCancel: () => {
          view.SetFilterText('');
          dialog.OnFilterCtrlCancel();
        },
      }}
      m_checkName={{
        value: checks.name,
        onChange: (aOn) => {
          setChecks((c) => ({ ...c, name: aOn }));
          dialog.OnFilterFieldCheckBox('name', aOn);
        },
      }}
      m_checkNet={{
        value: checks.net,
        onChange: (aOn) => {
          setChecks((c) => ({ ...c, net: aOn }));
          dialog.OnFilterFieldCheckBox('net', aOn);
        },
      }}
      m_layerFilter={{
        choices: [wxGetTranslation('All Layers'), ...layerSel.map((c) => c.name)],
        value: layerIndex,
        onChange: (aIndex) => {
          setLayerIndex(aIndex);
          // `sel <= 0` is UNDEFINED_LAYER; otherwise the entry's client data.
          dialog.OnLayerFilterChanged(aIndex <= 0 ? null : layerSel[aIndex - 1]!.layer);
        },
      }}
      m_viewZonesOverview={
        <DataViewCtrl
          columns={COLUMNS.map((c) => columnNames.get(c) ?? '')}
          rowCount={model.GetCount()}
          cell={(aRow, aCol) => {
            const value = model.GetValueByRow(aRow, COLUMNS[aCol]!);
            if (!value) return null;
            if (!('icon' in value)) return value.text;
            // MakeBitmapForLayers' bitmap: one band per layer, in its colour.
            const bar = (
              <span
                style={{ display: 'inline-flex', flexDirection: 'column', width: LAYER_BAR_WIDTH }}
              >
                {value.icon.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the bands are positional
                  <span key={i} style={{ height: r.h, background: toCss(r.color) }} />
                ))}
              </span>
            );
            return <DataViewIconText icon={bar} text={value.text} />;
          }}
          selection={selection}
          onSelect={(aRow) => {
            view.Select(aRow);
            dialog.OnDataViewCtrlSelectionChanged(aRow);
          }}
          tableRef={table}
          ariaLabel={wxGetTranslation('Zones')}
        />
      }
      moveEnabled={moveEnabled}
      onMoveTop={() => dialog.OnMoveTopClick()}
      onMoveUp={() => dialog.OnMoveUpClick()}
      onMoveDown={() => dialog.OnMoveDownClick()}
      onMoveBottom={() => dialog.OnMoveBottomClick()}
      onAutoAssign={() => dialog.OnAutoAssignClick()}
      m_sizerProperties={
        values ? (
          <PanelZoneProperties
            key={keyOf(zoneKey)}
            values={values}
            onChange={(patch) => panel.SetValues(patch)}
            units={units}
            nets={nets}
            allowNetSpec={panel.IsNetSpecAllowed()}
            teardrop={panel.IsTeardrop()}
          />
        ) : null
      }
      m_sizerPreview={
        <Notebook
          pages={notebookHost.m_pages.map((page) => ({
            text: frame.GetBoard().GetLayerName(page.GetLayer() as PCB_LAYER_ID),
            // The image list's COLOR_SWATCH for the layer.
            image: (
              <span
                style={{
                  display: 'inline-block',
                  width: LAYER_ICON_SIZE.WIDTH,
                  height: LAYER_ICON_SIZE.HEIGHT,
                  background: swatch(page.GetLayer() as PCB_LAYER_ID),
                }}
              />
            ),
            content: (
              <div
                style={{ display: 'flex', flex: 1, minHeight: 0 }}
                ref={(el) => {
                  const canvasEl = notebookHost.GetPageElement(page);
                  if (el && canvasEl && canvasEl.parentElement !== el) el.appendChild(canvasEl);
                }}
              />
            ),
          }))}
          selection={Math.max(0, notebookHost.m_selection)}
          ariaLabel="Zone previews"
          onPageChanged={(aPage) => {
            // `wxNotebook`'s own tab click, then `OnPageChanged`.
            notebook.SetSelection(aPage);
            notebookHost.m_selection = aPage;
            notebookHost.ShowSelected();
            notebook.OnPageChanged();
          }}
        />
      }
      m_checkRepour={{ value: view.GetRepourOnClose(), onChange: (aOn) => view.SetRepour(aOn) }}
      onUpdateDisplayedZones={() => dialog.OnUpdateDisplayedZonesClick()}
      onCharHook={(e) => {
        // `OnDialogCharHook`: WXK_UP / WXK_DOWN navigate the zone selection, whichever control
        // has the focus.
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          dialog.NavigateZoneSelection(-1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          dialog.NavigateZoneSelection(1);
        }
      }}
      onOK={() => {
        dialog.OnOk();
        close(true);
      }}
      onCancel={() => close(false)}
    />
  );
}
