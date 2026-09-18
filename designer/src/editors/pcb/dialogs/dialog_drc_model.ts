// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/dialogs/dialog_drc.h` + `.cpp` (DIALOG_DRC): the dialog's state and
 * every handler, as a window-less class. `dialog_drc.tsx` is the wx layout
 * (`dialog_drc_base.cpp`) rendered from it; the handlers here are what its
 * controls call, and `subscribe()` is how it learns something changed.
 *
 * What a wxWidgets dialog does that a browser cannot: the modal text-entry and
 * yes/no dialogs are the frame's (`DIALOG_DRC_WINDOW` hooks, promise-valued),
 * and the run is synchronous - the "Tests Running..." page paints before the
 * run starts and the gauge lands at the end, because there is no event loop
 * to yield to mid-run (`updateUI`'s `SafeYieldFor`).
 */
import { PROGRESS_REPORTER_BASE } from '@ziroeda/common/src/widgets/progress_reporter_base.js';
import { PARSE_ERROR } from '@ziroeda/common/src/dsnlexer.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { MARKER_T } from '@ziroeda/common/src/marker_base.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import {
  MALFORMED_B_COURTYARD,
  MALFORMED_F_COURTYARD,
} from '@ziroeda/common/src/eda_item_flags.js';
import {
  RC_TREE_MODEL,
  type RC_TREE_NODE,
  RC_TREE_NODE_TYPE,
  RC_TREE_VIEW_STATE,
} from '@ziroeda/common/src/rc_item.js';
import type { RC_ITEM } from '@ziroeda/common/src/rc_item.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/src/reporter.js';
import { ACTIONS } from '@ziroeda/common/src/tool/actions.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/src/board_item.js';
import type { BOARD_CONNECTED_ITEM } from '@ziroeda/pcbnew/src/board_connected_item.js';
import type { BOARD_DESIGN_SETTINGS } from '@ziroeda/pcbnew/src/board_design_settings.js';
import { REMOVE_MODE } from '@ziroeda/pcbnew/src/board_item_container.js';
import type { CN_EDGE } from '@ziroeda/pcbnew/src/connectivity/connectivity_algo.js';
import { DRC_ITEM, DRC_ITEMS_PROVIDER, PCB_DRC_CODE } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { DRC_REPORT } from '@ziroeda/pcbnew/src/drc/drc_report.js';
import { PAD } from '@ziroeda/pcbnew/src/pad.js';
import { PCB_MARKER } from '@ziroeda/pcbnew/src/pcb_marker.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/src/pcb_track.js';
import { ZONE } from '@ziroeda/pcbnew/src/zone.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/src/tools/pcb_actions.js';
import { DRC_TOOL, type ZONE_FILLER_TOOL_LIKE } from '@ziroeda/pcbnew/src/tools/drc_tool.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';

/** `BOARD_INSPECTION_TOOL` as the row menu asks it; found by name until stage 3. */
export interface BOARD_INSPECTION_TOOL_LIKE {
  InspectDRCErrorMenuText(aDRCItem: RC_ITEM): string;
  InspectDRCError(aDRCItem: RC_ITEM): void;
}

/**
 * What the dialog needs the window to do for it: the modal sub-dialogs, the
 * report file, Board Setup, and the appearance panel's layer switch.
 */
export interface DIALOG_DRC_WINDOW {
  /** `WX_TEXT_ENTRY_DIALOG( this, "", "Exclusion Comment", aInitial, true )`; null on Cancel. */
  textEntry(aTitle: string, aInitial: string): Promise<string | null>;
  /**
   * `wxMessageDialog( _( "Delete exclusions too?" ), _( "Delete All Markers" ), wxYES_NO | wxCANCEL )`
   * with the labels "Errors and Warnings Only" / "Errors, Warnings and Exclusions".
   */
  askDeleteExclusions(): Promise<'yes' | 'no' | 'cancel'>;
  /** `wxFileDialog( "Save Report File" )` + the write; returns the path or null on Cancel. */
  saveReport(
    aDefaultName: string,
    aWrite: (aFullPath: string) => string | null,
  ): Promise<string | null>;
  /** `DisplayError( this, msg )`. */
  displayError(aMessage: string): void;
  /** `m_frame->ShowBoardSetupDialog( aPage, this )`. */
  showBoardSetupDialog(aPage: 'Custom Rules' | 'Violation Severity'): void;
  /** `m_frame->GetAppearancePanel()->SetLayerVisible( layer, true )`. */
  setLayerVisible(aLayer: PCB_LAYER_ID, aVisible: boolean): void;
  /** `Show( aShow )` / `Raise()` / `IsShownOnScreen()` / `Destroy()`: the React window. */
  show(aShow: boolean): void;
  raise(): void;
  isShownOnScreen(): boolean;
  destroy(): void;
  /** The frame's PCBNEW_SETTINGS store, written back on close (`~DIALOG_DRC`). */
  saveDrcDialogSettings(aValues: {
    report_all_track_errors: boolean;
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
  }): void;
}

/** One `wxMenu` row of OnDRCItemRClick / OnIgnoredItemRClick / OnMenu. */
export interface DrcMenuRow {
  label: string;
  help?: string;
  checked?: boolean;
  sep?: boolean;
  action?: () => void | Promise<void>;
}

/** `m_ignoredList`'s rows: the text and the error code the row carries as its data. */
export interface IgnoredRow {
  text: string;
  code: number;
}

/** DIALOG_DRC_WINDOW_NAME */
export const DIALOG_DRC_WINDOW_NAME = 'DialogDrcWindowName';

// wxWidgets spends *far* too long calcuating column widths (most of it, believe it or
// not, in repeatedly creating/destroying a wxDC to do the measurement in).
// Use default column widths instead.
export const DEFAULT_SINGLE_COL_WIDTH = 660;

let g_lastDRCBoard: BOARD | null = null;
let g_lastDRCRun = false;
let g_lastFootprintTestsRun = false;

let g_lastIgnored: IgnoredRow[] = [];

/** `static bool s_includeExclusions` of OnDeleteAllClick. */
let s_includeExclusions = false;

/** `wxString::Format( _( "Violations (%s)" ), num )` and the other three page titles. */
const MARKERS_TITLE_TEMPLATE = 'Violations (%s)';
const UNCONNECTED_TITLE_TEMPLATE = 'Unconnected Items (%s)';
const FOOTPRINTS_TITLE_TEMPLATE = 'Schematic Parity (%s)';
const IGNORED_TITLE_TEMPLATE = 'Ignored Tests (%s)';

export class DIALOG_DRC extends PROGRESS_REPORTER_BASE {
  // The window's controls, as state:
  /** m_cbRefillZones, m_cbTestFootprints */
  m_cbRefillZones = true;
  m_cbTestFootprints = false;
  /** m_runningResultsBook: 0 = "Tests Running...", 1 = the results notebook */
  m_runningResultsBook = 1;
  /** m_Notebook's selection: 0 violations, 1 unconnected, 2 footprints, 3 ignored */
  m_notebookSelection = 0;
  /** m_messages (WX_HTML_REPORT_BOX): the report lines, html */
  m_messages: string[] = [];
  /** m_gauge->GetValue() (0..1000) */
  m_gauge = 0;
  /** m_drcStatusBar's second field */
  m_statusText = '';
  /** m_showAll / m_showErrors / m_showWarnings / m_showExclusions */
  m_showAll = false;
  m_showErrors = true;
  m_showWarnings = true;
  m_showExclusions = false;
  /** m_ignoredList */
  m_ignoredList: IgnoredRow[] = [];
  /** m_sdbSizerCancel's label, m_sdbSizerOK / delete / save buttons' enabled state */
  m_cancelLabel = 'Close';
  m_okEnabled = true;
  m_deleteEnabled = true;
  m_saveEnabled = true;
  /** The four page titles, as updateDisplayedCounts sets them. */
  m_pageTitles = ['Violations', 'Unconnected Items', 'Schematic Parity', 'Ignored Tests'];
  /** The three NUMBER_BADGEs: (number, maximum) each. */
  m_errorsBadge = { number: -1, max: -1 };
  m_warningsBadge = { number: -1, max: -1 };
  m_exclusionsBadge = { number: 0, max: 0 };

  readonly m_frame: PCB_EDIT_FRAME;
  readonly m_window: DIALOG_DRC_WINDOW;
  private m_currentBoard: BOARD;
  private m_running: boolean;
  private m_drcRun: boolean;
  private m_footprintTestsRun: boolean;
  private m_report_all_track_errors: boolean;
  private m_crossprobe: boolean;
  private m_scroll_on_crossprobe: boolean;

  readonly m_markersProvider: DRC_ITEMS_PROVIDER;
  readonly m_ratsnestProvider: DRC_ITEMS_PROVIDER;
  readonly m_fpWarningsProvider: DRC_ITEMS_PROVIDER;

  readonly m_markerDataView = new RC_TREE_VIEW_STATE();
  readonly m_unconnectedDataView = new RC_TREE_VIEW_STATE();
  readonly m_footprintsDataView = new RC_TREE_VIEW_STATE();

  readonly m_markersTreeModel: RC_TREE_MODEL;
  readonly m_unconnectedTreeModel: RC_TREE_MODEL;
  readonly m_fpWarningsTreeModel: RC_TREE_MODEL;

  private m_drcStartTime = 0;
  private m_lastTickSeconds = -1;
  private m_destroyed = false;

  private m_listeners = new Set<() => void>();

  constructor(aEditorFrame: PCB_EDIT_FRAME, aWindow: DIALOG_DRC_WINDOW) {
    super(1);
    this.m_running = false;
    this.m_drcRun = false;
    this.m_footprintTestsRun = false;
    this.m_report_all_track_errors = false;
    this.m_crossprobe = true;
    this.m_scroll_on_crossprobe = true;

    this.m_frame = aEditorFrame;
    this.m_window = aWindow;
    this.m_currentBoard = this.m_frame.GetBoard()!;

    const cfg = this.m_frame.GetPcbNewSettings();

    if (cfg) {
      this.m_report_all_track_errors = cfg.m_DRCDialog.report_all_track_errors;
      this.m_crossprobe = cfg.m_DRCDialog.crossprobe;
      this.m_scroll_on_crossprobe = cfg.m_DRCDialog.scroll_on_crossprobe;
    }

    this.m_markersProvider = new DRC_ITEMS_PROVIDER(
      this.m_currentBoard,
      MARKER_T.MARKER_DRC,
      MARKER_T.MARKER_DRAWING_SHEET,
    );

    this.m_ratsnestProvider = new DRC_ITEMS_PROVIDER(this.m_currentBoard, MARKER_T.MARKER_RATSNEST);

    this.m_fpWarningsProvider = new DRC_ITEMS_PROVIDER(this.m_currentBoard, MARKER_T.MARKER_PARITY);

    this.m_markersTreeModel = new RC_TREE_MODEL(this.m_frame, this.m_markerDataView);
    this.m_unconnectedTreeModel = new RC_TREE_MODEL(this.m_frame, this.m_unconnectedDataView);
    this.m_fpWarningsTreeModel = new RC_TREE_MODEL(this.m_frame, this.m_footprintsDataView);

    // wxEVT_COMMAND_DATAVIEW_SELECTION_CHANGED -> OnDRCItemSelected, on each of the three views
    for (const view of [
      this.m_markerDataView,
      this.m_unconnectedDataView,
      this.m_footprintsDataView,
    ]) {
      view.onSelectionChanged = (aNode: RC_TREE_NODE | null): void => {
        this.OnDRCItemSelected(aNode);
        this.notify();
      };
    }

    // m_ignoredList->InsertColumn( 0, wxEmptyString, wxLIST_FORMAT_LEFT, DEFAULT_SINGLE_COL_WIDTH );

    if (this.m_currentBoard === g_lastDRCBoard) {
      this.m_drcRun = g_lastDRCRun;
      this.m_footprintTestsRun = g_lastFootprintTestsRun;

      for (const row of g_lastIgnored) this.m_ignoredList.push({ ...row });
    }

    this.m_notebookSelection = 0;

    // if( Kiface().IsSingle() ) m_cbTestFootprints->Hide(): the window reads IsSingle()

    // SetupStandardButtons( { { wxID_OK, _( "Run DRC" ) }, { wxID_CANCEL, _( "Close" ) } } )

    // finishDialogSettings() -> TransferDataToWindow() -> UpdateData()
    this.UpdateData();
  }

  /** The React window's subscription: every state change notifies. */
  subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  private notify(): void {
    for (const l of this.m_listeners) l();
  }

  /** `~DIALOG_DRC` */
  Destroy(): void {
    if (this.m_destroyed) return;

    this.m_destroyed = true;

    this.m_window.saveDrcDialogSettings({
      report_all_track_errors: this.m_report_all_track_errors,
      crossprobe: this.m_crossprobe,
      scroll_on_crossprobe: this.m_scroll_on_crossprobe,
    });

    this.m_frame.ClearFocus();

    g_lastDRCBoard = this.m_currentBoard;
    g_lastDRCRun = this.m_drcRun;
    g_lastFootprintTestsRun = this.m_footprintTestsRun;

    g_lastIgnored = [];

    for (const row of this.m_ignoredList) g_lastIgnored.push({ ...row });

    this.m_window.destroy();
  }

  // DIALOG_DRC_LIKE (the tool's surface)

  Show(aShow: boolean): void {
    this.m_window.show(aShow);
    this.notify();
  }

  ShowModal(): void {
    this.Show(true);
  }

  Raise(): void {
    this.m_window.raise();
  }

  IsShownOnScreen(): boolean {
    return this.m_window.isShownOnScreen();
  }

  IsModal(): boolean {
    return false;
  }

  SetDrcRun(): void {
    this.m_drcRun = true;
  }

  SetFootprintTestsRun(): void {
    this.m_footprintTestsRun = true;
  }

  IsRunning(): boolean {
    return this.m_running;
  }

  private bds(): BOARD_DESIGN_SETTINGS {
    return this.m_currentBoard.GetDesignSettings();
  }

  private drcTool(): DRC_TOOL {
    return this.m_frame.GetToolManager()!.GetTool(DRC_TOOL)!;
  }

  OnActivateDlg(): void {
    if (this.m_currentBoard !== this.m_frame.GetBoard()) {
      // If m_currentBoard is not the current board, (for instance because a new board was loaded),
      // close the dialog, because many pointers are now invalid in lists
      this.drcTool().DestroyDRCDialog();
    }
  }

  // PROGRESS_REPORTER calls

  protected override updateUI(): boolean {
    if (this.m_maxProgress !== 0) {
      const cur = Math.min(Math.max(this.m_progress / this.m_maxProgress, 0.0), 1.0);

      const newValue = KiROUND(cur * 1000.0);
      this.m_gauge = newValue;
    }

    if (this.m_running) {
      const elapsed = Math.trunc((performance.now() - this.m_drcStartTime) / 1000);

      if (elapsed !== this.m_lastTickSeconds) {
        this.m_lastTickSeconds = elapsed;

        let tick: string;

        if (elapsed >= 60) tick = `${Math.trunc(elapsed / 60)} min ${elapsed % 60} s`;
        else tick = `${elapsed} s`;

        this.m_statusText = `Elapsed: ${tick}`;
      }
    }

    // Update() / SafeYieldFor(): the run is synchronous here; the window repaints after it.
    return !this.m_cancelled;
  }

  override AdvancePhase(aMessage?: string): void {
    if (aMessage === undefined) {
      super.AdvancePhase();
      return;
    }

    super.AdvancePhase(aMessage);
    this.SetCurrentProgress(0.0);

    this.m_messages.push(aMessage);
  }

  private getSeverities(): number {
    let severities = 0;

    if (this.m_showErrors) severities |= RPT_SEVERITY_ERROR;

    if (this.m_showWarnings) severities |= RPT_SEVERITY_WARNING;

    if (this.m_showExclusions) severities |= RPT_SEVERITY_EXCLUSION;

    return severities;
  }

  /** `OnMenu`: the config button's popup, as rows; each toggles and returns. */
  OnMenu(): DrcMenuRow[] {
    return [
      {
        label: 'Report All Errors for Each Track',
        help: 'If unchecked, only the first error will be reported for each track',
        checked: this.m_report_all_track_errors,
        action: () => {
          this.m_report_all_track_errors = !this.m_report_all_track_errors;
          this.notify();
        },
      },
      { sep: true, label: '' },
      {
        label: 'Cross-probe Selected Items',
        help: 'Highlight corresponding items on canvas when selected in the DRC list',
        checked: this.m_crossprobe,
        action: () => {
          this.m_crossprobe = !this.m_crossprobe;
          this.notify();
        },
      },
      {
        label: 'Center on Cross-probe',
        help: 'When cross-probing, scroll the canvas so that the item is visible',
        checked: this.m_scroll_on_crossprobe,
        action: () => {
          this.m_scroll_on_crossprobe = !this.m_scroll_on_crossprobe;
          this.notify();
        },
      },
    ];
  }

  OnErrorLinkClicked(): void {
    this.m_window.showBoardSetupDialog('Custom Rules');
  }

  /** `OnCharHook`: the exclude-marker hotkey while the dialog has focus. */
  OnCharHook(aHotkey: number): boolean {
    if (aHotkey === ACTIONS.excludeMarker.GetHotKey()) {
      this.ExcludeMarker();
      return true;
    }

    return false;
  }

  OnRunDRCClick(): void {
    const toolMgr = this.m_frame.GetToolManager()!;
    const drcTool = toolMgr.GetTool(DRC_TOOL)!;
    const zoneFillerTool = toolMgr.FindTool(
      'pcbnew.ZoneFiller',
    ) as unknown as ZONE_FILLER_TOOL_LIKE | null;
    const refillZones = this.m_cbRefillZones;
    const testFootprints = this.m_cbTestFootprints;

    if (zoneFillerTool?.IsBusy()) {
      // wxBell();
      return;
    }

    this.m_footprintTestsRun = false;
    this.m_cancelled = false;

    this.m_frame.GetBoard()!.RecordDRCExclusions();
    this.deleteAllMarkers(true);

    // This is not the time to have stale or buggy rules.  Ensure they're up-to-date
    // and that they at least parse.
    try {
      drcTool
        .GetDRCEngine()!
        .InitEngine(this.m_frame.GetDesignRulesText(), this.m_frame.GetDesignRulesPath());
    } catch (e) {
      if (!(e instanceof PARSE_ERROR)) throw e;

      this.m_runningResultsBook = 0; // Display the "Tests Running..." tab
      this.m_deleteEnabled = false;
      this.m_saveEnabled = false;

      this.m_messages = [];
      this.m_messages.push(
        `DRC incomplete: could not compile custom design rules.&nbsp;&nbsp;<a href='$CUSTOM_RULES'>Show design rules.</a>`,
      );

      this.Raise();
      this.notify();
      return;
    }

    const violations = DRC_ITEM.GetItemsWithSeverities();
    this.m_ignoredList = [];

    for (const item of violations) {
      if (this.bds().GetSeverity(item.GetErrorCode()) === RPT_SEVERITY_IGNORE) {
        this.m_ignoredList.push({
          text: ` • ${item.GetErrorText(true)}`,
          code: item.GetErrorCode(),
        });
      }
    }

    this.Raise();

    this.m_runningResultsBook = 0; // Display the "Tests Running..." tab
    this.m_messages = [];

    this.m_running = true;
    this.m_cancelLabel = 'Cancel';
    this.m_okEnabled = false;
    this.m_deleteEnabled = false;
    this.m_saveEnabled = false;

    this.m_drcStartTime = performance.now();
    this.m_lastTickSeconds = -1;

    this.m_statusText = 'Elapsed: 0 s';
    this.notify();

    // Update(): the window paints the running page before the (synchronous) run. NOTE:
    // setTimeout, not requestAnimationFrame - rAF never fires in a hidden tab.
    setTimeout(() => {
      try {
        drcTool.RunTests(this, refillZones, this.m_report_all_track_errors, testFootprints);
      } catch (e) {
        this.m_messages.push(`<b>${String(e instanceof Error ? (e.stack ?? e.message) : e)}</b>`);
      }

      this.finishRun();
    });
  }

  private finishRun(): void {
    const elapsedMs = performance.now() - this.m_drcStartTime;

    const formatElapsed = (): string => {
      const totalSeconds = KiROUND(elapsedMs / 1000.0);

      if (totalSeconds >= 60) return `${Math.trunc(totalSeconds / 60)} min ${totalSeconds % 60} s`;

      return `${(elapsedMs / 1000.0).toFixed(2)} s`;
    };

    if (this.m_cancelled) {
      this.m_messages.push('-------- DRC canceled by user.<br><br>');

      this.m_statusText = `Canceled after ${formatElapsed()}`;
    } else {
      this.m_messages.push('Done.<br><br>');

      this.m_statusText = `Completed in ${formatElapsed()}`;
    }

    this.Raise();

    this.m_running = false;
    this.m_cancelLabel = 'Close';
    this.m_okEnabled = true;
    this.m_deleteEnabled = true;
    this.m_saveEnabled = true;

    if (!this.m_cancelled) {
      // m_sdbSizerCancel->SetDefault(); wxMilliSleep( 500 ); then the results page
      this.notify();

      setTimeout(() => {
        this.m_runningResultsBook = 1;
        this.notify();
        this.refreshEditor();
      }, 500);

      return;
    }

    this.notify();
    this.refreshEditor();
  }

  UpdateData(): void {
    const severities = this.getSeverities();

    this.m_markersTreeModel.Update(this.m_markersProvider, severities);
    this.m_unconnectedTreeModel.Update(this.m_ratsnestProvider, severities);
    this.m_fpWarningsTreeModel.Update(this.m_fpWarningsProvider, severities);

    this.updateDisplayedCounts();
    this.notify();
  }

  OnDRCItemSelected(aNode: RC_TREE_NODE | null): void {
    if (!this.m_crossprobe) return;

    const board = this.m_frame.GetBoard()!;
    const node = aNode;

    const getActiveLayers = (aItem: BOARD_ITEM): LSET => {
      // aItem->Type() == PCB_PAD_T: PAD is the one class of that type
      if (aItem instanceof PAD) {
        const pad = aItem;
        const layers = new LSET();

        for (const layer of aItem.GetLayerSet()) {
          if (pad.FlashLayer(layer)) layers.set(layer);
        }

        return layers;
      } else {
        return aItem.GetLayerSet();
      }
    };

    if (!node) {
      // list is being freed; don't do anything with null ptrs
      return;
    }

    const rc_item = node.m_RcItem!;

    if (
      rc_item.GetErrorCode() === PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE &&
      rc_item.GetParent()!.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET
    ) {
      this.m_frame.FocusOnLocation(
        node.m_RcItem!.GetParent()!.GetPos(),
        this.m_scroll_on_crossprobe,
      );
      return;
    }

    const itemID = RC_TREE_MODEL.ToUUID(node);
    const item = board.ResolveItem(itemID, true);

    if (!item) {
      // nothing to highlight / focus on
      return;
    }

    let principalLayer: PCB_LAYER_ID;
    let violationLayers = new LSET();
    const a = board.ResolveItem(rc_item.GetMainItemID(), true);
    const b = board.ResolveItem(rc_item.GetAuxItemID(), true);
    const c = board.ResolveItem(rc_item.GetAuxItem2ID(), true);
    const d = board.ResolveItem(rc_item.GetAuxItem3ID(), true);

    if (rc_item.GetErrorCode() === PCB_DRC_CODE.DRCE_MALFORMED_COURTYARD) {
      if (
        a &&
        (a.GetFlags() & MALFORMED_B_COURTYARD) > 0 &&
        (a.GetFlags() & MALFORMED_F_COURTYARD) === 0
      ) {
        principalLayer = PCB_LAYER_ID.B_CrtYd;
      } else {
        principalLayer = PCB_LAYER_ID.F_CrtYd;
      }
    } else if (rc_item.GetErrorCode() === PCB_DRC_CODE.DRCE_INVALID_OUTLINE) {
      principalLayer = PCB_LAYER_ID.Edge_Cuts;
    } else {
      principalLayer = PCB_LAYER_ID.UNDEFINED_LAYER;

      // The marker's layer is set by the test provider
      const marker = rc_item.GetParent();

      if (marker instanceof PCB_MARKER) {
        const markerLayer = marker.GetLayer();

        if (markerLayer > PCB_LAYER_ID.UNDEFINED_LAYER) principalLayer = markerLayer;
      }

      // Fall back to intersecting the contributing items layer sets.
      if (principalLayer <= PCB_LAYER_ID.UNDEFINED_LAYER) {
        if (a || b || c || d) violationLayers = LSET.AllLayersMask();

        for (const it of [a, b, c, d]) {
          if (!it) continue;

          const layersList = getActiveLayers(it);
          violationLayers = violationLayers.and(layersList);

          if (principalLayer <= PCB_LAYER_ID.UNDEFINED_LAYER && layersList.count())
            principalLayer = layersList.Seq()[0]!;
        }
      }
    }

    if (violationLayers.count()) principalLayer = violationLayers.Seq()[0]!;
    else if (principalLayer >= 0) violationLayers.set(principalLayer);

    // WINDOW_THAWER thawer( m_frame );

    if (
      principalLayer > PCB_LAYER_ID.UNDEFINED_LAYER &&
      violationLayers.and(board.GetVisibleLayers()).none()
    )
      this.m_window.setLayerVisible(principalLayer, true);

    if (
      principalLayer > PCB_LAYER_ID.UNDEFINED_LAYER &&
      board.GetVisibleLayers().test(principalLayer)
    )
      this.m_frame.SetActiveLayer(principalLayer);

    if (rc_item.GetErrorCode() === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS) {
      if (!this.m_frame.GetPcbNewSettings().m_Display.m_ShowGlobalRatsnest)
        this.m_frame.GetToolManager()!.RunAction(PCB_ACTIONS.showRatsnest);

      // item->Type() == PCB_ZONE_T
      if (item instanceof ZONE) {
        this.m_frame.FocusOnItem(item, principalLayer, this.m_scroll_on_crossprobe);

        this.m_frame
          .GetBoard()!
          .GetConnectivity()
          .RunOnUnconnectedEdges((edge: CN_EDGE): boolean => {
            // Connectivity was valid when DRC was run, but this is a modeless dialog
            // so it might not be now.
            if (!edge.GetSourceNode() || edge.GetSourceNode()!.Dirty()) return true;

            if (!edge.GetTargetNode() || edge.GetTargetNode()!.Dirty()) return true;

            if (edge.GetSourceNode()!.Parent() === a && edge.GetTargetNode()!.Parent() === b) {
              let focusPos: VECTOR2I;

              if (item === a && item === b) {
                focusPos =
                  node.m_Type === RC_TREE_NODE_TYPE.MAIN_ITEM
                    ? edge.GetSourcePos()
                    : edge.GetTargetPos();
              } else {
                focusPos =
                  item === edge.GetSourceNode()!.Parent()
                    ? edge.GetSourcePos()
                    : edge.GetTargetPos();
              }

              this.m_frame.FocusOnLocation(focusPos, this.m_scroll_on_crossprobe);
              this.m_frame.RefreshCanvas();

              return false;
            }

            return true;
          });
      } else {
        this.m_frame.FocusOnItem(item, principalLayer, this.m_scroll_on_crossprobe);
      }
    } else if (rc_item.GetErrorCode() === PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG) {
      const track = item instanceof PCB_TRACK ? (item as BOARD_CONNECTED_ITEM) : null;
      const items: BOARD_ITEM[] = [];

      if (track) {
        const net = track.GetNetCode();

        // wxASSERT( net > 0 );    // Without a net how can it be a diff-pair?

        for (const id of rc_item.GetIDs()) {
          const candidate = board.ResolveItem(id, true);

          if (candidate?.IsConnected() && (candidate as BOARD_CONNECTED_ITEM).GetNetCode() === net)
            items.push(candidate);
        }
      } else {
        items.push(item);
      }

      this.m_frame.FocusOnItems(items, principalLayer, this.m_scroll_on_crossprobe);
    } else {
      this.m_frame.FocusOnItem(item, principalLayer, this.m_scroll_on_crossprobe);
    }
  }

  OnDRCItemDClick(aNode: RC_TREE_NODE | null): void {
    if (aNode) {
      // turn control over to m_frame, hide this DIALOG_DRC window,
      // no destruction so we can preserve listbox cursor
      if (!this.IsModal()) this.Show(false);
    }
  }

  /** `OnDRCItemRClick`: the row's popup menu, as rows whose actions are the switch's cases. */
  OnDRCItemRClick(aModel: RC_TREE_MODEL, aNode: RC_TREE_NODE | null): DrcMenuRow[] {
    const toolMgr = this.m_frame.GetToolManager()!;
    const inspectionTool = toolMgr.FindTool(
      'pcbnew.InspectionTool',
    ) as unknown as BOARD_INSPECTION_TOOL_LIKE | null;
    const drcTool = toolMgr.GetTool(DRC_TOOL)!;
    const node = aNode;

    if (!node) return [];

    const rcItem = node.m_RcItem!;
    const drcItem = rcItem as DRC_ITEM;
    let listName: string;
    const menu: DrcMenuRow[] = [];

    switch (this.bds().m_DRCSeverities.get(rcItem.GetErrorCode())) {
      case RPT_SEVERITY_ERROR:
        listName = 'errors';
        break;
      case RPT_SEVERITY_WARNING:
        listName = 'warnings';
        break;
      default:
        listName = 'appropriate';
        break;
    }

    const finish = (modified: boolean): void => {
      if (modified) {
        this.updateDisplayedCounts();
        this.refreshEditor();
        this.m_frame.OnModify();
      }

      this.notify();
    };

    if (rcItem.GetParent()!.IsExcluded()) {
      menu.push({
        label: 'Remove exclusion for this violation',
        help: `It will be placed back in the ${listName} list`,
        action: () => {
          const marker = rcItem.GetParent();

          if (marker instanceof PCB_MARKER) {
            marker.SetExcluded(false);

            const serialized = marker.SerializeToString();
            this.bds().m_DrcExclusions.delete(serialized);
            this.bds().m_DrcExclusionComments.delete(serialized);

            if (rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS) {
              this.m_frame.GetBoard()!.UpdateRatsnestExclusions();
              this.m_frame.GetCanvas()?.RedrawRatsnest();
            } else {
              this.m_frame.GetCanvas()?.GetView().Update(marker);
            }

            // Update view
            aModel.ValueChanged(node);
            finish(true);
          }
        },
      });

      menu.push({
        label: 'Edit exclusion comment...',
        action: async () => {
          const marker = node.m_RcItem!.GetParent();

          if (marker instanceof PCB_MARKER) {
            const value = await this.m_window.textEntry('Exclusion Comment', marker.GetComment());

            if (value === null) return;

            marker.SetExcluded(true, value);

            const serialized = marker.SerializeToString();
            this.bds().m_DrcExclusions.add(serialized);
            this.bds().m_DrcExclusionComments.set(serialized, value);

            // Update view
            aModel.ValueChanged(node);
            finish(true);
          }
        },
      });

      if (drcItem.GetViolatingRule() && !drcItem.GetViolatingRule()!.IsImplicit()) {
        menu.push({
          label: `Remove all exclusions for violations of rule '${drcItem.GetViolatingRule()!.m_Name}'`,
          help: `They will be placed back in the ${listName} list`,
          action: () => {
            for (const marker of this.m_frame.GetBoard()!.Markers()) {
              const candidateDrcItem = marker.GetRCItem() as DRC_ITEM;

              if (candidateDrcItem.GetViolatingRule() === drcItem.GetViolatingRule()) {
                marker.SetExcluded(false);

                const serialized = marker.SerializeToString();
                this.bds().m_DrcExclusions.delete(serialized);
                this.bds().m_DrcExclusionComments.delete(serialized);
              }
            }

            // Rebuild model and view
            aModel.Update(this.m_markersProvider, this.getSeverities());
            finish(true);
          },
        });
      }
    } else {
      const addExclusion = async (withComment: boolean): Promise<void> => {
        const marker = rcItem.GetParent();

        if (marker instanceof PCB_MARKER) {
          let comment = '';

          if (withComment) {
            const value = await this.m_window.textEntry('Exclusion Comment', '');

            if (value === null) return;

            comment = value;
          }

          marker.SetExcluded(true, comment);

          const serialized = marker.SerializeToString();
          this.bds().m_DrcExclusions.add(serialized);
          this.bds().m_DrcExclusionComments.set(serialized, comment);

          if (rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS) {
            this.m_frame.GetBoard()!.UpdateRatsnestExclusions();
            this.m_frame.GetCanvas()?.RedrawRatsnest();
          } else {
            this.m_frame.GetCanvas()?.GetView().Update(marker);
          }

          // Update view
          if (this.m_showExclusions) aModel.ValueChanged(node);
          else aModel.DeleteCurrentItem(false);

          finish(true);
        }
      };

      menu.push({
        label: 'Exclude this violation',
        help: `It will be excluded from the ${listName} list`,
        action: () => addExclusion(false),
      });

      menu.push({
        label: 'Exclude with comment...',
        help: `It will be excluded from the ${listName} list`,
        action: () => addExclusion(true),
      });

      if (drcItem.GetViolatingRule() && !drcItem.GetViolatingRule()!.IsImplicit()) {
        menu.push({
          label: `Exclude all violations of rule '${drcItem.GetViolatingRule()!.m_Name}'...`,
          help: `They will be excluded from the ${listName} list`,
          action: () => {
            for (const marker of this.m_frame.GetBoard()!.Markers()) {
              const candidateDrcItem = marker.GetRCItem() as DRC_ITEM;

              if (candidateDrcItem.GetViolatingRule() === drcItem.GetViolatingRule()) {
                marker.SetExcluded(true);

                const serialized = marker.SerializeToString();
                this.bds().m_DrcExclusions.add(serialized);
              }
            }

            // Rebuild model and view
            aModel.Update(this.m_markersProvider, this.getSeverities());
            finish(true);
          },
        });
      }
    }

    menu.push({ sep: true, label: '' });

    const inspectDRCErrorMenuText = inspectionTool?.InspectDRCErrorMenuText(rcItem) ?? '';
    const fixDRCErrorMenuText = drcTool.FixDRCErrorMenuText(rcItem);

    if (inspectDRCErrorMenuText.length > 0 || fixDRCErrorMenuText.length > 0) {
      if (inspectDRCErrorMenuText.length > 0)
        menu.push({
          label: inspectDRCErrorMenuText,
          action: () => inspectionTool!.InspectDRCError(node.m_RcItem!),
        });

      if (fixDRCErrorMenuText.length > 0)
        menu.push({
          label: fixDRCErrorMenuText,
          action: () => drcTool.FixDRCError(node.m_RcItem!),
        });

      menu.push({ sep: true, label: '' });
    }

    const setSeverity = (severity: Severity): void => {
      this.bds().m_DRCSeverities.set(rcItem.GetErrorCode(), severity);

      for (const marker of this.m_frame.GetBoard()!.Markers()) {
        if (marker.GetRCItem()!.GetErrorCode() === rcItem.GetErrorCode())
          this.m_frame.GetCanvas()?.GetView().Update(marker);
      }

      // Rebuild model and view
      aModel.Update(this.m_markersProvider, this.getSeverities());
      finish(true);
    };

    if (this.bds().m_DRCSeverities.get(rcItem.GetErrorCode()) === RPT_SEVERITY_WARNING) {
      menu.push({
        label: `Change severity to Error for all '${rcItem.GetErrorText(true)}' violations`,
        help: 'Violation severities can also be edited in Board Setup',
        action: () => setSeverity(RPT_SEVERITY_ERROR),
      });
    } else {
      menu.push({
        label: `Change severity to Warning for all '${rcItem.GetErrorText(true)}' violations`,
        help: 'Violation severities can also be edited in Board Setup',
        action: () => setSeverity(RPT_SEVERITY_WARNING),
      });
    }

    menu.push({
      label: `Ignore all '${rcItem.GetErrorText(true)}' violations`,
      help: 'Violations will not be checked or reported',
      action: () => {
        this.bds().m_DRCSeverities.set(rcItem.GetErrorCode(), RPT_SEVERITY_IGNORE);

        this.m_ignoredList.push({
          text: ` • ${rcItem.GetErrorText(true)}`,
          code: rcItem.GetErrorCode(),
        });

        const board = this.m_frame.GetBoard()!;

        const toRemove: BOARD_ITEM[] = [];

        for (const marker of board.Markers()) {
          if (marker.GetRCItem()!.GetErrorCode() === rcItem.GetErrorCode()) {
            this.m_frame.GetCanvas()?.GetView().Remove(marker);
            toRemove.push(marker);
          }
        }

        for (const marker of toRemove) board.Remove(marker, REMOVE_MODE.BULK);

        board.FinalizeBulkRemove(toRemove);

        if (rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS)
          this.m_frame.GetCanvas()?.RedrawRatsnest();

        // Rebuild model and view
        aModel.Update(this.m_markersProvider, this.getSeverities());
        finish(true);
      },
    });

    menu.push({ sep: true, label: '' });

    menu.push({
      label: 'Edit violation severities...',
      help: 'Open the Board Setup dialog',
      action: () => this.m_window.showBoardSetupDialog('Violation Severity'),
    });

    return menu;
  }

  /** `OnIgnoredItemRClick`: the three radio rows for one ignored test. */
  OnIgnoredItemRClick(aRow: IgnoredRow): DrcMenuRow[] {
    const errorCode = aRow.code;

    const choose = (severity: Severity): void => {
      if (severity > 0) {
        if (this.bds().m_DRCSeverities.get(errorCode) !== severity) {
          this.bds().m_DRCSeverities.set(errorCode, severity);

          this.updateDisplayedCounts();
          this.refreshEditor();
          this.m_frame.OnModify();
          this.notify();
        }
      }
    };

    const current = this.bds().GetSeverity(errorCode);

    return [
      {
        label: 'Error',
        checked: current === RPT_SEVERITY_ERROR,
        action: () => choose(RPT_SEVERITY_ERROR),
      },
      {
        label: 'Warning',
        checked: current === RPT_SEVERITY_WARNING,
        action: () => choose(RPT_SEVERITY_WARNING),
      },
      {
        label: 'Ignore',
        checked: current === RPT_SEVERITY_IGNORE,
        action: () => choose(RPT_SEVERITY_IGNORE),
      },
    ];
  }

  OnEditViolationSeverities(): void {
    this.m_window.showBoardSetupDialog('Violation Severity');
  }

  /** `OnSeverity`: one of the four "Show:" boxes was clicked (its new value given). */
  OnSeverity(aBox: 'all' | 'errors' | 'warnings' | 'exclusions', aChecked: boolean): void {
    if (aBox === 'all') {
      this.m_showAll = aChecked;
      this.m_showErrors = true;
      this.m_showWarnings = aChecked;
      this.m_showExclusions = aChecked;
    } else if (aBox === 'errors') this.m_showErrors = aChecked;
    else if (aBox === 'warnings') this.m_showWarnings = aChecked;
    else this.m_showExclusions = aChecked;

    this.UpdateData();
  }

  async OnSaveReport(): Promise<void> {
    // wxFileName fn( "DRC." + FILEEXT::ReportFileExtension ); the file dialog's wildcard
    // is the report (.rpt) or the JSON schema; the window picks the extension.
    const reportWriter = new DRC_REPORT(
      this.m_frame.GetBoard()!,
      this.m_frame.GetUserUnits(),
      this.m_markersProvider,
      this.m_ratsnestProvider,
      this.m_fpWarningsProvider,
    );

    let failed: string | null = null;

    const path = await this.m_window.saveReport('DRC.rpt', (aFullPath: string): string | null => {
      try {
        if (aFullPath.toLowerCase().endsWith('.json')) return reportWriter.WriteJsonReport();

        return reportWriter.WriteTextReport();
      } catch {
        failed = aFullPath;
        return null;
      }
    });

    if (path === null) return;

    if (failed === null) this.m_messages.push(`Report file '${path}' created<br>`);
    else this.m_window.displayError(`Failed to create file '${failed}'.`);

    this.notify();
  }

  OnClose(): void {
    this.OnCancelClick();
  }

  OnCancelClick(): void {
    if (this.m_running) {
      this.m_cancelled = true;
      return;
    }

    this.m_frame.ClearFocus();

    // The dialog can be modal or not modal.
    // Leave the DRC caller destroy (or not) the dialog
    const drcTool = this.m_frame.GetToolManager()!.GetTool(DRC_TOOL)!;
    drcTool.DestroyDRCDialog();
  }

  OnChangingNotebookPage(aSelection: number): void {
    this.m_markerDataView.UnselectAll();
    this.m_unconnectedDataView.UnselectAll();
    this.m_footprintsDataView.UnselectAll();

    this.m_notebookSelection = aSelection;
    this.notify();
  }

  private refreshEditor(): void {
    // WINDOW_THAWER thawer( m_frame );
    this.m_frame.GetCanvas()?.Refresh();
  }

  PrevMarker(): void {
    if (this.m_runningResultsBook === 1) {
      switch (this.m_notebookSelection) {
        case 0:
          this.m_markersTreeModel.PrevMarker();
          break;
        case 1:
          this.m_unconnectedTreeModel.PrevMarker();
          break;
        case 2:
          this.m_fpWarningsTreeModel.PrevMarker();
          break;
        case 3:
          break;
      }
    }

    this.notify();
  }

  NextMarker(): void {
    if (this.m_runningResultsBook === 1) {
      switch (this.m_notebookSelection) {
        case 0:
          this.m_markersTreeModel.NextMarker();
          break;
        case 1:
          this.m_unconnectedTreeModel.NextMarker();
          break;
        case 2:
          this.m_fpWarningsTreeModel.NextMarker();
          break;
        case 3:
          break;
      }
    }

    this.notify();
  }

  SelectMarker(aMarker: PCB_MARKER): void {
    if (this.m_runningResultsBook === 1) {
      const markerType = aMarker.GetMarkerType();

      if (markerType === MARKER_T.MARKER_DRC) this.m_notebookSelection = 0;
      else if (markerType === MARKER_T.MARKER_PARITY) this.m_notebookSelection = 2;

      this.m_markersTreeModel.SelectMarker(aMarker);

      // CallAfter( CenterMarker )
      setTimeout(() => {
        this.m_markersTreeModel.CenterMarker(aMarker);
        this.notify();
      });
    }

    this.notify();
  }

  ExcludeMarker(): void {
    if (this.m_runningResultsBook !== 1 || this.m_notebookSelection !== 0) return;

    const node = this.m_markerDataView.GetCurrentItem();

    if (node?.m_RcItem) {
      const marker = node.m_RcItem.GetParent();

      if (marker instanceof PCB_MARKER && marker.GetSeverity() !== RPT_SEVERITY_EXCLUSION) {
        marker.SetExcluded(true);
        this.bds().m_DrcExclusions.add(marker.SerializeToString());
        this.m_frame.GetCanvas()?.GetView().Update(marker);

        // Update view
        if (this.m_showExclusions) this.m_markersTreeModel.ValueChanged(node);
        else this.m_markersTreeModel.DeleteCurrentItem(false);

        this.updateDisplayedCounts();
        this.refreshEditor();
        this.m_frame.OnModify();
        this.notify();
      }
    }
  }

  private deleteAllMarkers(aIncludeExclusions: boolean): void {
    // Clear current selection list to avoid selection of deleted items
    this.m_frame.GetToolManager()!.RunAction(ACTIONS.selectionClear);

    this.m_markersTreeModel.DeleteItems(false, aIncludeExclusions, false);
    this.m_unconnectedTreeModel.DeleteItems(false, aIncludeExclusions, false);
    this.m_fpWarningsTreeModel.DeleteItems(false, aIncludeExclusions, false);

    this.m_frame.GetBoard()!.DeleteMARKERs(true, aIncludeExclusions);
  }

  OnDeleteOneClick(): void {
    if (this.m_notebookSelection === 0) {
      // Clear the selection.  It may be the selected DRC marker.
      this.m_frame.GetToolManager()!.RunAction(ACTIONS.selectionClear);

      this.m_markersTreeModel.DeleteCurrentItem(true);

      // redraw the pcb
      this.refreshEditor();
    } else if (this.m_notebookSelection === 1) {
      this.m_unconnectedTreeModel.DeleteCurrentItem(true);
    } else if (this.m_notebookSelection === 2) {
      this.m_fpWarningsTreeModel.DeleteCurrentItem(true);
    }

    this.updateDisplayedCounts();
    this.notify();
  }

  async OnDeleteAllClick(): Promise<void> {
    let numExcluded = 0;

    if (this.m_markersProvider)
      numExcluded += this.m_markersProvider.GetCount(RPT_SEVERITY_EXCLUSION);

    if (this.m_ratsnestProvider)
      numExcluded += this.m_ratsnestProvider.GetCount(RPT_SEVERITY_EXCLUSION);

    if (this.m_fpWarningsProvider)
      numExcluded += this.m_fpWarningsProvider.GetCount(RPT_SEVERITY_EXCLUSION);

    if (numExcluded > 0) {
      const ret = await this.m_window.askDeleteExclusions();

      if (ret === 'cancel') return;
      else if (ret === 'no') s_includeExclusions = true;
    }

    this.deleteAllMarkers(s_includeExclusions);
    this.m_drcRun = false;

    this.refreshEditor();
    this.updateDisplayedCounts();
    this.notify();
  }

  private updateDisplayedCounts(): void {
    const drcTool = this.m_frame.GetToolManager()!.GetTool(DRC_TOOL)!;
    const drcEngine = drcTool.GetDRCEngine()!;

    // Collect counts:

    let numMarkers = 0;
    let numUnconnected = 0;
    let numFootprints = 0;

    let numErrors = 0;
    let numWarnings = 0;
    let numExcluded = 0;

    if (this.m_markersProvider) {
      numMarkers += this.m_markersProvider.GetCount();
      numErrors += this.m_markersProvider.GetCount(RPT_SEVERITY_ERROR);
      numWarnings += this.m_markersProvider.GetCount(RPT_SEVERITY_WARNING);
      numExcluded += this.m_markersProvider.GetCount(RPT_SEVERITY_EXCLUSION);
    }

    if (this.m_ratsnestProvider) {
      numUnconnected += this.m_ratsnestProvider.GetCount();
      numErrors += this.m_ratsnestProvider.GetCount(RPT_SEVERITY_ERROR);
      numWarnings += this.m_ratsnestProvider.GetCount(RPT_SEVERITY_WARNING);
      numExcluded += this.m_ratsnestProvider.GetCount(RPT_SEVERITY_EXCLUSION);
    }

    if (this.m_footprintTestsRun && this.m_fpWarningsProvider) {
      numFootprints += this.m_fpWarningsProvider.GetCount();
      numErrors += this.m_fpWarningsProvider.GetCount(RPT_SEVERITY_ERROR);
      numWarnings += this.m_fpWarningsProvider.GetCount(RPT_SEVERITY_WARNING);
      numExcluded += this.m_fpWarningsProvider.GetCount(RPT_SEVERITY_EXCLUSION);
    }

    let errorsOverflowed = false;
    let warningsOverflowed = false;
    let markersOverflowed = false;
    let unconnectedOverflowed = false;
    let footprintsOverflowed = false;

    for (let ii = PCB_DRC_CODE.DRCE_FIRST; ii <= PCB_DRC_CODE.DRCE_LAST; ++ii) {
      const severity = this.bds().GetSeverity(ii);

      if (drcEngine.IsErrorLimitExceeded(ii)) {
        if (severity === RPT_SEVERITY_ERROR) errorsOverflowed = true;
        else if (severity === RPT_SEVERITY_WARNING) warningsOverflowed = true;

        if (ii === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS) {
          if (this.m_showWarnings && severity === RPT_SEVERITY_WARNING)
            unconnectedOverflowed = true;
          else if (this.m_showErrors && severity === RPT_SEVERITY_ERROR)
            unconnectedOverflowed = true;
        } else if (
          ii === PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT ||
          ii === PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT ||
          ii === PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT ||
          ii === PCB_DRC_CODE.DRCE_NET_CONFLICT ||
          ii === PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY ||
          ii === PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS ||
          ii === PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY
        ) {
          if (this.m_showWarnings && severity === RPT_SEVERITY_WARNING) footprintsOverflowed = true;
          else if (this.m_showErrors && severity === RPT_SEVERITY_ERROR)
            footprintsOverflowed = true;
        } else {
          if (this.m_showWarnings && severity === RPT_SEVERITY_WARNING) markersOverflowed = true;
          else if (this.m_showErrors && severity === RPT_SEVERITY_ERROR) markersOverflowed = true;
        }
      }
    }

    let msg: string;
    let num: string;

    // Update tab headers:

    if (this.m_drcRun) {
      num = markersOverflowed ? `${numMarkers}+` : `${numMarkers}`;
      msg = MARKERS_TITLE_TEMPLATE.replace('%s', num);
    } else {
      msg = MARKERS_TITLE_TEMPLATE;
      msg = msg.replace('(%s)', '');
    }

    this.m_pageTitles[0] = msg;

    if (this.m_drcRun) {
      num = unconnectedOverflowed ? `${numUnconnected}+` : `${numUnconnected}`;
      msg = UNCONNECTED_TITLE_TEMPLATE.replace('%s', num);
    } else {
      msg = UNCONNECTED_TITLE_TEMPLATE;
      msg = msg.replace('(%s)', '');
    }

    this.m_pageTitles[1] = msg;

    if (this.m_footprintTestsRun) {
      num = footprintsOverflowed ? `${numFootprints}+` : `${numFootprints}`;
      msg = FOOTPRINTS_TITLE_TEMPLATE.replace('%s', num);
    } else if (this.m_drcRun) {
      msg = FOOTPRINTS_TITLE_TEMPLATE;
      msg = msg.replace('%s', 'not run');
    } else {
      msg = FOOTPRINTS_TITLE_TEMPLATE;
      msg = msg.replace('(%s)', '');
    }

    this.m_pageTitles[2] = msg;

    if (this.m_drcRun) {
      num = `${this.m_ignoredList.length}`;
      msg = IGNORED_TITLE_TEMPLATE.replace('%s', num);
    } else {
      msg = IGNORED_TITLE_TEMPLATE;
      msg = msg.replace('(%s)', '');
    }

    this.m_pageTitles[3] = msg;

    // Update badges:

    if (!this.m_drcRun && numErrors === 0) numErrors = -1;

    if (!this.m_drcRun && numWarnings === 0) numWarnings = -1;

    this.m_errorsBadge = { max: numErrors, number: errorsOverflowed ? numErrors + 1 : numErrors };
    this.m_warningsBadge = {
      max: numWarnings,
      number: warningsOverflowed ? numWarnings + 1 : numWarnings,
    };
    this.m_exclusionsBadge = { max: numExcluded, number: numExcluded };
  }

  // Read accessors for the window

  IsDrcRun(): boolean {
    return this.m_drcRun;
  }
  IsFootprintTestsRun(): boolean {
    return this.m_footprintTestsRun;
  }
  IsCancelledRun(): boolean {
    return this.m_cancelled;
  }
  ReportAllTrackErrors(): boolean {
    return this.m_report_all_track_errors;
  }
  CrossProbe(): boolean {
    return this.m_crossprobe;
  }
  ScrollOnCrossProbe(): boolean {
    return this.m_scroll_on_crossprobe;
  }
}
