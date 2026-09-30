// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ZONE_MANAGER`'s window: `dialog_zone_manager_base.cpp`'s wxFormBuilder
 * tree folded into this component (`_base` is not split out here) over the
 * logic in `dialog_zone_manager.ts`.
 *
 * The sizer tree, read whole (`port-the-sizer-tree-whole`):
 *
 *     m_MainBoxSizer (V)
 *       m_sizerTop (H), Add( 1, wxEXPAND )
 *         m_listPanel, Add( 1, wxEXPAND )            listPanelSizer (V)
 *           m_leftColumn (V), Add( 1, wxEXPAND | wxRIGHT | wxLEFT, 5 )
 *             searchSizer (H), Add( 0, wxBOTTOM | wxEXPAND | wxTOP, 5 )
 *               m_filterCtrl wxSearchCtrl, Add( 1, wxALIGN_CENTER_VERTICAL, 1 )
 *               spacer ( 10, 0 )
 *               m_checkName "Name", checked, Add( 0, wxALIGN_CENTER_VERTICAL |
 *                 wxRIGHT | wxLEFT, 5 )
 *               m_checkNet "Net", checked, Add( 0, wxALIGN_CENTER_VERTICAL, 5 )
 *             layerFilterSizer (H), Add( 0, wxBOTTOM | wxEXPAND | wxTOP, 5 )
 *               "Layer:" Add( 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 )
 *               m_layerFilter wxChoice, Add( 1, wxALIGN_CENTER_VERTICAL, 0 )
 *             m_viewZonesOverview wxDataViewCtrl ( wxDV_HORIZ_RULES | wxDV_SINGLE
 *               | wxDV_VERT_RULES ), Add( 1, wxEXPAND, 5 )
 *             m_sizerZoneOP (H), Add( 0, wxEXPAND | wxTOP | wxBOTTOM, 5 )
 *               m_btnMoveTop / Up / Down / Bottom, each Add( 0,
 *                 wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 ), spacer ( 10, 0 ),
 *               m_btnAutoAssign, Add( 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 )
 *         m_zonePanel, Add( 2, wxEXPAND )            zonePanelSizer (V)
 *           m_rightColumn (V), Add( 1, wxEXPAND )
 *             m_sizerProperties (V), Add( 1, wxEXPAND ): PANEL_ZONE_PROPERTIES,
 *               Add( 1, wxEXPAND, 5 )
 *             m_sizerPreview (V), Add( 1, wxEXPAND ): ZONE_PREVIEW_NOTEBOOK,
 *               Add( 1, wxBOTTOM | wxLEFT | wxRIGHT | wxEXPAND, 5 )
 *       m_staticline1 wxStaticLine, Add( 0, wxEXPAND )
 *       m_sizerBottom (H), Add( 0, wxBOTTOM | wxEXPAND | wxTOP, 5 )
 *         m_checkRepour "Refill zones", Add( 0, wxALIGN_CENTER_VERTICAL | wxLEFT, 5 )
 *         spacer ( 100, 0 ), proportion 1
 *         m_updateDisplayedZones "Update Displayed Zones",
 *           Add( 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 )
 *         m_sdbSizer (OK, Cancel), Add( 0, wxALIGN_CENTER_VERTICAL, 5 )
 *
 * The zone list is a `wxDataViewCtrl` with three text columns (Name, Net, and
 * Layers with the layer bar as its icon), rendered as a read-only table whose
 * selected row is the one `m_viewZonesOverview->GetSelection()` returns.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';
import { ZONE_SETTINGS_BAG } from '../zone_settings_bag.js';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { toCss } from '@ziroeda/common/gal/color4d.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '../board.js';
import {
  PANEL_ZONE_PROPERTIES,
  type PANEL_ZONE_PROPERTIES_FRAME,
} from '../dialogs/panel_zone_properties.js';
import { PanelZoneProperties } from '../dialogs/panel_zone_properties_ui.js';
import type { ZONE } from '../zone.js';
import {
  DIALOG_ZONE_MANAGER,
  type DIALOG_ZONE_MANAGER_FRAME,
  type DIALOG_ZONE_MANAGER_UI,
} from './dialog_zone_manager.js';
import { GetColumnNames, type wxDataViewItem, ZONES_OVERVIEW_COL } from './model_zones_overview.js';
import {
  ZONE_PREVIEW_NOTEBOOK,
  type ZONE_PREVIEW_CANVAS_LIKE,
  type ZONE_PREVIEW_NOTEBOOK_HOST,
  type ZONE_PREVIEW_NOTEBOOK_PAGE,
} from './zone_preview_notebook.js';

/** What the dialog reads and does on its `PCB_BASE_FRAME`. */
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

  useModalEscape(() => close(false));

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

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-zm" role="dialog" aria-modal="true" aria-label="Zone Manager">
        <div className="ze-modal-header">Zone Manager</div>

        {/* m_sizerTop */}
        <div
          className="ze-zm-top"
          onKeyDown={(e) => {
            // `OnDialogCharHook`: WXK_UP / WXK_DOWN navigate the zone selection,
            // whichever control has the focus.
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              dialog.NavigateZoneSelection(-1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              dialog.NavigateZoneSelection(1);
            }
          }}
        >
          <div className="ze-zm-list">
            <div className="ze-zm-left">
              <div className="ze-zm-search">
                <span className="ze-zm-searchbox">
                  <input
                    className="ze-search"
                    aria-label="Filter"
                    value={view.GetFilterText()}
                    onChange={(e) => {
                      view.SetFilterText(e.target.value);
                      dialog.OnFilterCtrlTextChange(e.target.value);
                    }}
                  />
                  {view.GetFilterText() !== '' && (
                    <button
                      type="button"
                      className="ze-zm-searchcancel"
                      aria-label="Clear filter"
                      onClick={() => {
                        view.SetFilterText('');
                        dialog.OnFilterCtrlCancel();
                      }}
                    >
                      ✕
                    </button>
                  )}
                </span>
                <span className="ze-zm-gap10" />
                <label className="ze-zm-check">
                  <input
                    type="checkbox"
                    defaultChecked
                    onChange={(e) => dialog.OnFilterFieldCheckBox('name', e.target.checked)}
                  />
                  Name
                </label>
                <label className="ze-zm-check2">
                  <input
                    type="checkbox"
                    defaultChecked
                    onChange={(e) => dialog.OnFilterFieldCheckBox('net', e.target.checked)}
                  />
                  Net
                </label>
              </div>

              <div className="ze-zm-layerrow">
                <label className="ze-zm-layerlabel" htmlFor="ze-zm-layer">
                  Layer:
                </label>
                <Combo
                  id="ze-zm-layer"
                  value={String(layerIndex)}
                  options={[
                    { value: '0', label: 'All Layers' },
                    ...layerSel.map((c, i) => ({ value: String(i + 1), label: c.name })),
                  ]}
                  onChange={(v) => {
                    const i = Number(v);
                    setLayerIndex(i);
                    // `sel <= 0` is UNDEFINED_LAYER; otherwise the entry's client data.
                    dialog.OnLayerFilterChanged(i <= 0 ? null : layerSel[i - 1]!.layer);
                  }}
                />
              </div>

              <div className="ze-zm-table">
                <table className="ze-grid ze-zm-grid" ref={table} tabIndex={0}>
                  <thead>
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c}>{columnNames.get(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row}
                        data-row={row}
                        className={selection === row ? 'selected' : ''}
                        onClick={() => {
                          view.Select(row);
                          dialog.OnDataViewCtrlSelectionChanged(row);
                        }}
                      >
                        {COLUMNS.map((c) => {
                          const cell = model.GetValueByRow(row, c);

                          return (
                            <td key={c}>
                              {cell && 'icon' in cell && (
                                <span className="ze-zm-layerbar" aria-hidden="true">
                                  {cell.icon.map((r, i) => (
                                    <span
                                      key={i}
                                      style={{ height: r.h, background: toCss(r.color) }}
                                    />
                                  ))}
                                </span>
                              )}
                              {cell?.text ?? ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ze-zm-oprow">
                {(
                  [
                    ['small_top', () => dialog.OnMoveTopClick()],
                    ['small_up', () => dialog.OnMoveUpClick()],
                    ['small_down', () => dialog.OnMoveDownClick()],
                    ['small_bottom', () => dialog.OnMoveBottomClick()],
                  ] as const
                ).map(([bitmap, click]) => (
                  <span key={bitmap} className="ze-zm-opbtn">
                    <StdBitmapButton
                      bitmap={bitmap}
                      title={bitmap.slice(6)}
                      tooltip="Top zone has the highest priority. When a zone is inside another zone, if its priority is higher, its outlines are removed from the other zone."
                      disabled={!moveEnabled}
                      onClick={click}
                    />
                  </span>
                ))}
                <span className="ze-zm-gap10" />
                <span className="ze-zm-opbtn">
                  <StdBitmapButton
                    bitmap="small_sort_desc"
                    title="Auto-assign"
                    tooltip="Automatically assign zone priorities based on connectivity analysis of overlapping regions."
                    disabled={!moveEnabled}
                    onClick={() => dialog.OnAutoAssignClick()}
                  />
                </span>
              </div>
            </div>
          </div>

          <div className="ze-zm-zone">
            <div className="ze-zm-props">
              {values ? (
                <PanelZoneProperties
                  key={keyOf(zoneKey)}
                  values={values}
                  onChange={(patch) => panel.SetValues(patch)}
                  units={units}
                  nets={nets}
                  allowNetSpec={panel.IsNetSpecAllowed()}
                  teardrop={panel.IsTeardrop()}
                />
              ) : (
                <fieldset disabled className="ze-zm-noprops" />
              )}
            </div>
            <div className="ze-zm-preview">
              <div className="ze-zm-nb">
                <div className="ze-nb-tabs">
                  {notebookHost.m_pages.map((page, i) => (
                    <button
                      key={page.GetLayer()}
                      type="button"
                      className={i === notebookHost.m_selection ? 'active' : ''}
                      onClick={() => {
                        // `wxNotebook`'s own tab click, then `OnPageChanged`.
                        notebook.SetSelection(i);
                        notebookHost.m_selection = i;
                        notebookHost.ShowSelected();
                        notebook.OnPageChanged();
                      }}
                    >
                      <span
                        className="ze-zm-tabswatch"
                        style={{ background: swatch(page.GetLayer() as PCB_LAYER_ID) }}
                      />
                      {frame.GetBoard().GetLayerName(page.GetLayer() as PCB_LAYER_ID)}
                    </button>
                  ))}
                </div>
                <div
                  className="ze-zm-nbpages"
                  ref={(el) => {
                    if (el && pagesEl.parentElement !== el) el.appendChild(pagesEl);
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <hr className="ze-zm-line" />

        {/* m_sizerBottom */}
        <div className="ze-zm-bottom">
          <label className="ze-zm-repour" title="Refill zones after changes made on board">
            <input
              type="checkbox"
              checked={view.GetRepourOnClose()}
              onChange={(e) => view.SetRepour(e.target.checked)}
            />
            Refill zones
          </label>
          <span className="ze-zm-stretch" />
          <button
            type="button"
            className="ze-btn ze-zm-update"
            title="Update filled areas shown in dialog, according to the new current settings"
            onClick={() => dialog.OnUpdateDisplayedZonesClick()}
          >
            Update Displayed Zones
          </button>
          <StdDialogButtons
            onCancel={() => close(false)}
            onOk={() => {
              dialog.OnOk();
              close(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
