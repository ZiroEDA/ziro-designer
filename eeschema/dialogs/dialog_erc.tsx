// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ERC` (eeschema/dialogs/dialog_erc.cpp): the Electrical Rules Checker over
 * `dialog_erc_base.tsx`'s layout. Modeless: the schematic stays live behind it.
 *
 * The class is upstream's, method for method: it runs ERC_TESTER on the frame's live SCHEMATIC,
 * the markers land on the screens, and the Violations tab is an RC_TREE_MODEL over a
 * SHEETLIST_ERC_ITEMS_PROVIDER. What wx gives a dialog for free - the modal sub-dialogs, the save
 * file dialog, showing and hiding the window - is the window's ({@link DIALOG_ERC_WINDOW}).
 */
import { useEffect, useState, type JSX } from 'react';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { MARKER_T } from '@ziroeda/common/marker_base.js';
import { FACE_T } from '@ziroeda/common/kiway.js';
import { numberBadge, type NumberBadgeState } from '@ziroeda/common/widgets/number_badge.js';
import { PROGRESS_REPORTER_BASE } from '@ziroeda/common/widgets/progress_reporter_base.js';
import {
  RC_TREE_MODEL,
  type RC_TREE_NODE,
  RC_TREE_NODE_TYPE,
  RC_TREE_VIEW_STATE,
} from '@ziroeda/common/rc_item.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ContextMenu, type MenuItem } from '@ziroeda/wx/menu_ui.js';
import { ERC_TESTER } from '../erc/erc.js';
import { ERC_ITEM } from '../erc/erc_item.js';
import { ERC_REPORT } from '../erc/erc_report.js';
import { ERCE_T, SHEETLIST_ERC_ITEMS_PROVIDER } from '../erc/erc_settings.js';
import type { SCH_EDIT_FRAME, DIALOG_ERC as DIALOG_ERC_FRAME } from '../sch_edit_frame.js';
import { SCH_MARKER } from '../sch_marker.js';
import { ANNOTATE_SCOPE_T } from '../sch_reference_list.js';
import { SCH_SCREENS } from '../sch_screen.js';
import { SCH_SHEET_PATH, SYMBOL_FILTER } from '../sch_sheet_path.js';
import { SCH_ACTIONS } from '../tools/sch_actions.js';
import { SCH_EDIT_TOOL } from '../tools/sch_edit_tool.js';
import { SCH_INSPECTION_TOOL } from '../tools/sch_inspection_tool.js';
import { DIALOG_ERC_BASE } from './dialog_erc_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** What wx gives the dialog that a page has to be handed: its sub-dialogs, file and window. */
export interface DIALOG_ERC_WINDOW {
  /** `WX_TEXT_ENTRY_DIALOG( this, wxEmptyString, _( "Exclusion Comment" ), aInitial, true )`. */
  textEntry(aInitial: string): Promise<string | null>;
  /**
   * `KICAD_MESSAGE_DIALOG( "Delete exclusions too?", "Delete All Markers", wxYES_NO | wxCANCEL )`
   * labelled "Errors and Warnings Only" / "Errors, Warnings and Exclusions".
   */
  askDeleteExclusions(): Promise<'yes' | 'no' | 'cancel'>;
  /** `wxFileDialog( "Save Report File" )` and the write: the saved path, or null on Cancel. */
  saveReport(
    aDefaultName: string,
    aWrite: (aFullPath: string) => string | null,
  ): Promise<string | null>;
  /** `DisplayErrorMessage( this, msg )`. */
  displayError(aMessage: string): void;
  /**
   * `( *adapter )->BlockUntilLoaded()`: the symbol libraries the placed symbols name and the
   * footprint libraries CvPcb's link test reads, which a synchronous run cannot wait for; and the
   * frame's live schematic brought up to the window's edits.
   */
  blockUntilLoaded(): Promise<void>;
  /** `Show( aShow )` / `Raise()` / `IsShownOnScreen()` / `Destroy()`: the React window. */
  show(aShow: boolean): void;
  raise(): void;
  isShownOnScreen(): boolean;
  destroy(): void;
  /**
   * The project save upstream's OnModify leads to (SCH_EDIT_FRAME::SaveProject: RecordERCExclusions,
   * then SETTINGS_MANAGER::SaveProject), made at once: the exclusions and severities live in the
   * project file, which the window persists as it is written.
   */
  projectModified(): void;
  /** EESCHEMA_SETTINGS m_ERCDialog, read by the constructor and written by `~DIALOG_ERC`. */
  ercDialogSettings(): {
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
    show_all_errors: boolean;
  };
  saveErcDialogSettings(aValues: {
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
    show_all_errors: boolean;
  }): void;
}

/** A row of one of the dialog's popup menus. */
export interface ErcMenuRow {
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

/**
 * `NUMBER_BADGE::SetMaximumNumber( 999 )` (dialog_erc.cpp:140-142): a count above it reads
 * "999+" (number_badge.cpp:177-180).
 */
export const ERC_BADGE_MAX = 999;

/** What a NUMBER_BADGE paints for one count, or null when it paints nothing. */
export type ErcBadge = NumberBadgeState;

/** `NUMBER_BADGE::UpdateNumber` with DIALOG_ERC's maximum. */
export function ercBadge(n: number, severity: 'error' | 'warning' | 'exclusion'): ErcBadge | null {
  return numberBadge(
    n,
    severity === 'error'
      ? RPT_SEVERITY_ERROR
      : severity === 'warning'
        ? RPT_SEVERITY_WARNING
        : RPT_SEVERITY_EXCLUSION,
    ERC_BADGE_MAX,
  );
}

// wxWidgets spends *far* too long calculating column widths (most of it, believe it or
// not, in repeatedly creating/destroying a wxDC to do the measurement in).
// Use default column widths instead.
export const DEFAULT_SINGLE_COL_WIDTH = 660;

/** The notebook page texts the base declares (`m_violationsTitleTemplate` / `m_ignoredTitleTemplate`). */
const VIOLATIONS_TITLE_TEMPLATE = _HKI('Violations (%s)');
const IGNORED_TITLE_TEMPLATE = _HKI('Ignored Tests (%s)');

let g_lastERCSchematic: unknown = null;
let g_lastERCRun = false;
let g_lastERCIgnored: IgnoredRow[] = [];

export class DIALOG_ERC extends PROGRESS_REPORTER_BASE implements DIALOG_ERC_FRAME {
  // The window's controls, as state:
  /** m_infoBar: the annotation warning, or null when hidden. */
  m_infoBar: string | null = null;
  /** m_runningResultsBook: 0 = "Tests Running...", 1 = the results notebook */
  m_runningResultsBook = 1;
  /** m_notebook's selection: 0 Violations, 1 Ignored Tests */
  m_notebookSelection = 0;
  /** m_messages (WX_HTML_REPORT_BOX): the report lines, html */
  m_messages: string[] = [];
  /** m_gauge->GetValue() (0..1000) */
  m_gauge = 0;
  /** m_showAll / m_showErrors / m_showWarnings / m_showExclusions */
  m_showAll = false;
  m_showErrors = true;
  m_showWarnings = true;
  m_showExclusions = false;
  /** m_ignoredList */
  m_ignoredList: IgnoredRow[] = [];
  /** m_sdbSizer1Cancel's label; m_sdbSizer1OK / delete / save buttons' enabled state */
  m_cancelLabel = _HKI('Close');
  m_okEnabled = true;
  m_deleteEnabled = true;
  m_saveEnabled = true;
  /** m_notebook's page texts, as updateDisplayedCounts sets them. */
  m_violationsTitle = 'Violations';
  m_ignoredTitle = 'Ignored Tests';
  /** m_errorsBadge / m_warningsBadge / m_exclusionsBadge's numbers */
  m_errorsCount = -1;
  m_warningsCount = -1;
  m_exclusionsCount = 0;

  readonly m_parent: SCH_EDIT_FRAME;
  readonly m_window: DIALOG_ERC_WINDOW;
  private m_currentSchematic: unknown;
  m_markerProvider: SHEETLIST_ERC_ITEMS_PROVIDER;
  readonly m_markerDataView = new RC_TREE_VIEW_STATE();
  readonly m_markerTreeModel: RC_TREE_MODEL;
  private m_running = false;
  private m_ercRun = false;
  private m_centerMarkerOnIdle: SCH_MARKER | null = null;
  m_crossprobe = true;
  m_scroll_on_crossprobe = true;
  m_showAllErrors = false;

  private m_destroyed = false;
  private m_listeners = new Set<() => void>();

  constructor(aParent: SCH_EDIT_FRAME, aWindow: DIALOG_ERC_WINDOW) {
    super(1);
    this.m_parent = aParent;
    this.m_window = aWindow;
    this.m_currentSchematic = aParent.Schematic();

    this.m_markerProvider = new SHEETLIST_ERC_ITEMS_PROVIDER(aParent.Schematic());

    this.m_markerTreeModel = new RC_TREE_MODEL(aParent, this.m_markerDataView);
    this.m_markerTreeModel.Update(this.m_markerProvider, this.getSeverities());

    // wxEVT_COMMAND_DATAVIEW_SELECTION_CHANGED -> OnERCItemSelected
    this.m_markerDataView.onSelectionChanged = (aNode: RC_TREE_NODE | null): void => {
      this.OnERCItemSelected(aNode);
      this.notify();
    };

    if (this.m_currentSchematic === g_lastERCSchematic) {
      this.m_ercRun = g_lastERCRun;

      for (const row of g_lastERCIgnored) this.m_ignoredList.push({ ...row });
    }

    this.m_notebookSelection = 0;

    this.UpdateAnnotationWarning();

    const cfg = aWindow.ercDialogSettings();
    this.m_crossprobe = cfg.crossprobe;
    this.m_scroll_on_crossprobe = cfg.scroll_on_crossprobe;
    this.m_showAllErrors = cfg.show_all_errors;

    // finishDialogSettings() -> TransferDataToWindow() -> UpdateData()
    this.UpdateData();
  }

  /**
   * TRANSITIONAL (S7, with sch_record_bridge.ts): the window's live mirror reopened the project and
   * the frame holds a new SCHEMATIC, the markers carried onto it; the provider follows.
   */
  OnSchematicReplaced(): void {
    this.m_currentSchematic = this.m_parent.Schematic();
    this.m_markerProvider = new SHEETLIST_ERC_ITEMS_PROVIDER(this.m_parent.Schematic());
    this.UpdateData();
  }

  /** The React window's subscription: every state change notifies. */
  subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  notify(): void {
    for (const l of this.m_listeners) l();
  }

  /** `~DIALOG_ERC` */
  Destroy(): void {
    if (this.m_destroyed) return;

    this.m_destroyed = true;

    g_lastERCSchematic = this.m_currentSchematic;
    g_lastERCRun = this.m_ercRun;
    g_lastERCIgnored = this.m_ignoredList.map((row) => ({ ...row }));

    this.m_window.saveErcDialogSettings({
      crossprobe: this.m_crossprobe,
      scroll_on_crossprobe: this.m_scroll_on_crossprobe,
      show_all_errors: this.m_showAllErrors,
    });

    this.m_window.destroy();
  }

  Show(aShow: boolean): void {
    this.m_window.show(aShow);
  }

  Raise(): void {
    this.m_window.raise();
  }

  FocusOkButton(): void {}

  IsShownOnScreen(): boolean {
    return this.m_window.isShownOnScreen();
  }

  /** `UpdateAnnotationWarning()` (dialog_erc.cpp:183). */
  UpdateAnnotationWarning(): void {
    if (
      this.m_parent.CheckAnnotate(
        () => {},
        ANNOTATE_SCOPE_T.ANNOTATE_ALL,
        true,
        SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
      )
    ) {
      this.m_infoBar = _('Schematic is not fully annotated. ERC results will be incomplete.');
    } else {
      this.m_infoBar = null;
    }
  }

  /** `getSeverities()` (dialog_erc.cpp:221). */
  getSeverities(): number {
    let severities = 0;

    if (this.m_showErrors) severities |= RPT_SEVERITY_ERROR;

    if (this.m_showWarnings) severities |= RPT_SEVERITY_WARNING;

    if (this.m_showExclusions) severities |= RPT_SEVERITY_EXCLUSION;

    return severities;
  }

  /** `OnMenu()` (dialog_erc.cpp:238): the gear's three checks. */
  OnMenu(): ErcMenuRow[] {
    return [
      {
        label: _('Cross-probe Selected Items'),
        help: _('Highlight corresponding items on canvas when selected in the ERC list'),
        checked: this.m_crossprobe,
        action: () => {
          this.m_crossprobe = !this.m_crossprobe;
          this.notify();
        },
      },
      {
        label: _('Center on Cross-probe'),
        help: _('When cross-probing, scroll the canvas so that the item is visible'),
        checked: this.m_scroll_on_crossprobe,
        action: () => {
          this.m_scroll_on_crossprobe = !this.m_scroll_on_crossprobe;
          this.notify();
        },
      },
      {
        label: _('Show all errors'),
        help: _('Show duplicate ERC markers on all applicable pins'),
        checked: this.m_showAllErrors,
        action: () => {
          this.m_showAllErrors = !this.m_showAllErrors;
          this.notify();
        },
      },
    ];
  }

  /** `updateUI()` (dialog_erc.cpp:305). */
  protected override updateUI(): boolean {
    return !this.m_cancelled;
  }

  /** `AdvancePhase( aMessage )` (dialog_erc.cpp:319). */
  override AdvancePhase(aMessage?: string): void {
    // Will also call Report( aMessage ):
    if (aMessage === undefined) super.AdvancePhase();
    else super.AdvancePhase(aMessage);

    this.SetCurrentProgress(0.0);
  }

  /** `Report( aMessage )` (dialog_erc.cpp:327). */
  override Report(aMessage: string): void {
    this.m_messages.push(aMessage);
  }

  /** `UpdateData()` (dialog_erc.cpp:333). */
  UpdateData(): void {
    this.m_markerTreeModel.Update(this.m_markerProvider, this.getSeverities());
    this.updateDisplayedCounts();
  }

  /** `updateDisplayedCounts()` (dialog_erc.cpp:340). */
  updateDisplayedCounts(): void {
    const numMarkers = this.m_markerProvider.GetCount();
    let numErrors = this.m_markerProvider.GetCount(RPT_SEVERITY_ERROR);
    let numWarnings = this.m_markerProvider.GetCount(RPT_SEVERITY_WARNING);
    const numExcluded = this.m_markerProvider.GetCount(RPT_SEVERITY_EXCLUSION);

    // We don't currently have a limit on ERC violations.
    this.m_violationsTitle = this.m_ercRun
      ? VIOLATIONS_TITLE_TEMPLATE.replace('%s', `${numMarkers}`)
      : VIOLATIONS_TITLE_TEMPLATE.replace(' (%s)', '').replace('(%s)', '');

    this.m_ignoredTitle = this.m_ercRun
      ? IGNORED_TITLE_TEMPLATE.replace('%s', `${this.m_ignoredList.length}`)
      : IGNORED_TITLE_TEMPLATE.replace(' (%s)', '').replace('(%s)', '');

    if (!this.m_ercRun && numErrors === 0) numErrors = -1;

    if (!this.m_ercRun && numWarnings === 0) numWarnings = -1;

    this.m_errorsCount = numErrors;
    this.m_warningsCount = numWarnings;
    this.m_exclusionsCount = numExcluded;
    this.notify();
  }

  /** `OnDeleteOneClick()` (dialog_erc.cpp:401). */
  OnDeleteOneClick(): void {
    if (this.m_notebookSelection === 0) {
      // Clear the selection.  It may be the selected ERC marker.
      this.m_parent.GetToolManager()?.RunAction(ACTIONS.selectionClear);

      this.m_markerTreeModel.DeleteCurrentItem(true);

      // redraw the schematic
      this.redrawDrawPanel();
    }

    this.updateDisplayedCounts();
  }

  /** `OnDeleteAllClick()` (dialog_erc.cpp:418). */
  async OnDeleteAllClick(): Promise<void> {
    let includeExclusions = false;
    const numExcluded = this.m_markerProvider.GetCount(RPT_SEVERITY_EXCLUSION);

    if (numExcluded > 0) {
      const ret = await this.m_window.askDeleteExclusions();

      if (ret === 'cancel') return;
      else if (ret === 'no') includeExclusions = true;
    }

    this.deleteAllMarkers(includeExclusions);
    this.m_ercRun = false;

    // redraw the schematic
    this.redrawDrawPanel();
    this.updateDisplayedCounts();
  }

  /** `OnCancelClick()` (dialog_erc.cpp:450). */
  OnCancelClick(): void {
    if (this.m_running) {
      this.m_cancelled = true;
      return;
    }

    this.m_parent.ClearFocus();

    // aEvent.Skip(): the close, OnCloseErcDialog
    this.OnCloseErcDialog();
  }

  /** `OnCloseErcDialog()` (dialog_erc.cpp:464): the modeless dialog asks its parent to destroy it. */
  OnCloseErcDialog(): void {
    this.m_parent.ClearFocus();

    // wxQueueEvent( parent, EDA_EVT_CLOSE_ERC_DIALOG )
    this.m_parent.CloseErcDialog();
  }

  /** `OnLinkClicked()` (dialog_erc.cpp:479). */
  OnLinkClicked(): void {
    this.m_parent.OnAnnotate();
  }

  /** `OnRunERCClick()` (dialog_erc.cpp:485). */
  async OnRunERCClick(): Promise<void> {
    if (this.m_running) return;

    // wxBusyCursor: what the run reads must be in hand before it touches a marker - the
    // libraries ERC_TESTER asks for, and the schematic the window's edits have reached.
    this.m_running = true;
    this.m_cancelLabel = _('Cancel');
    this.m_okEnabled = false;
    this.m_deleteEnabled = false;
    this.m_saveEnabled = false;
    this.notify();

    await this.m_window.blockUntilLoaded();

    const sch = this.m_parent.Schematic();

    this.UpdateAnnotationWarning();

    sch.RecordERCExclusions();
    this.deleteAllMarkers(true);

    this.m_ignoredList = [];

    for (const item of ERC_ITEM.GetItemsWithSeverities()) {
      if (sch.ErcSettings().GetSeverity(item.GetErrorCode()) === RPT_SEVERITY_IGNORE) {
        this.m_ignoredList.push({
          text: ` • ${item.GetErrorText(true)}`,
          code: item.GetErrorCode(),
        });
      }
    }

    this.m_cancelled = false;
    this.Raise();

    this.m_runningResultsBook = 0; // Display the "Tests Running..." tab
    this.m_messages = [];

    this.m_running = true;
    this.m_cancelLabel = _('Cancel');
    this.m_okEnabled = false;
    this.m_deleteEnabled = false;
    this.m_saveEnabled = false;
    this.notify();

    // Update(): repaint only, so the running page is on screen before the tests block.
    await nextPaint();

    const itemsNotAnnotated = this.m_parent.CheckAnnotate(
      (aType, aMsg, aItemA, aItemB) => {
        const ercItem = ERC_ITEM.Create(aType)!;
        ercItem.SetErrorMessage(aMsg);

        if (aItemB) ercItem.SetItems(aItemA!.GetSymbol(), aItemB.GetSymbol());
        else ercItem.SetItems(aItemA!.GetSymbol());

        const marker = new SCH_MARKER(ercItem, aItemA!.GetSymbol().GetPosition());
        aItemA!.GetSheetPath().LastScreen()!.Append(marker);
      },
      ANNOTATE_SCOPE_T.ANNOTATE_ALL,
      true,
      SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
    );

    this.testErc();

    if (itemsNotAnnotated)
      this.m_messages.unshift(
        wxFormat(_('%d symbol(s) require annotation.<br><br>'), itemsNotAnnotated),
      );

    if (this.m_cancelled) this.m_messages.push(_('-------- ERC cancelled by user.<br><br>'));
    else this.m_messages.push(_('Done.<br><br>'));

    this.Raise();

    this.m_running = false;
    this.m_cancelLabel = _('Close');
    this.m_okEnabled = true;
    this.m_deleteEnabled = true;
    this.m_saveEnabled = true;
    this.notify();

    if (!this.m_cancelled) {
      // wxWidgets has a tendency to keep both buttons highlighted without the following:
      this.m_okEnabled = false;
      this.notify();

      await new Promise((r) => setTimeout(r, 500)); // wxMilliSleep( 500 )
      this.m_runningResultsBook = 1;

      // now re-enable m_sdbSizerOK button
      this.m_okEnabled = true;
    }

    this.m_ercRun = true;
    this.redrawDrawPanel();
    this.updateDisplayedCounts();
  }

  /** `redrawDrawPanel()` (dialog_erc.cpp:593). */
  redrawDrawPanel(): void {
    this.m_parent.GetCanvas()?.Refresh();
  }

  /** `testErc()` (dialog_erc.cpp:602). */
  testErc(): void {
    const sch = this.m_parent.Schematic();
    const tester = new ERC_TESTER(sch, this.m_showAllErrors);

    tester.RunTests(
      this.m_parent.GetCanvas()?.GetView().GetDrawingSheet() ?? null,
      this.m_parent,
      this.m_parent.Kiway()?.KiFACE(FACE_T.FACE_CVPCB) ?? null,
      this.m_parent.Prj(),
      this,
    );

    // Update marker list:
    this.m_markerTreeModel.Update(this.m_markerProvider, this.getSeverities());

    // Display new markers from the current screen:
    const view = this.m_parent.GetCanvas()?.GetView();

    if (view) {
      for (const marker of this.m_parent.GetScreen()?.Items().OfType(KICAD_T.SCH_MARKER_T) ?? []) {
        view.Remove(marker);
        view.Add(marker);
      }
    }

    this.m_parent.GetCanvas()?.Refresh();
  }

  /** `OnERCItemSelected( aEvent )` (dialog_erc.cpp:631). */
  OnERCItemSelected(aNode: RC_TREE_NODE | null): void {
    if (!this.m_crossprobe || !aNode) return;

    const itemID = RC_TREE_MODEL.ToUUID(aNode);
    let sheet = new SCH_SHEET_PATH();
    const item = this.m_parent.Schematic().ResolveItem(itemID, sheet, true);

    if (this.m_centerMarkerOnIdle) {
      // we already came from a cross-probe of the marker in the document; don't go
      // around in circles
    } else if (item && item.GetClass() !== 'DELETED_SHEET_ITEM') {
      // Determine the owning sheet for sheet-specific items
      const ercItem = aNode.m_RcItem as ERC_ITEM;

      switch (aNode.m_Type) {
        case RC_TREE_NODE_TYPE.MARKER:
          if (ercItem.IsSheetSpecific()) sheet = ercItem.GetSpecificSheetPath();
          break;
        case RC_TREE_NODE_TYPE.MAIN_ITEM:
          if (ercItem.MainItemHasSheetPath()) sheet = ercItem.GetMainItemSheetPath();
          break;
        case RC_TREE_NODE_TYPE.AUX_ITEM:
          if (ercItem.AuxItemHasSheetPath()) sheet = ercItem.GetAuxItemSheetPath();
          break;
        default:
          break;
      }

      if (!sheet.empty() && !sheet.equals(this.m_parent.GetCurrentSheet())) {
        this.m_parent.GetToolManager()?.RunAction(SCH_ACTIONS.changeSheet, sheet);
        this.m_parent.RedrawScreen(this.m_parent.GetScreen()!.m_ScrollCenter, false);
      }

      this.m_parent.FocusOnItem(item, this.m_scroll_on_crossprobe);
      this.redrawDrawPanel();
    }
  }

  /** `OnERCItemDClick( aEvent )` (dialog_erc.cpp:692). */
  OnERCItemDClick(aNode: RC_TREE_NODE | null): void {
    // turn control over to m_parent, hide this DIALOG_ERC window,
    // no destruction so we can preserve listbox cursor
    if (aNode) this.Show(false);
  }

  /** `OnERCItemRClick( aEvent )` (dialog_erc.cpp:706): the row's popup menu. */
  OnERCItemRClick(aNode: RC_TREE_NODE | null): ErcMenuRow[] {
    if (!aNode || !aNode.m_RcItem) return [];

    const settings = this.m_parent.Schematic().ErcSettings();
    const rcItem = aNode.m_RcItem;
    const marker = rcItem.GetParent() as SCH_MARKER | null;
    const code = rcItem.GetErrorCode();
    const model = this.m_markerTreeModel;

    let listName: string;

    switch (settings.GetSeverity(code)) {
      case RPT_SEVERITY_ERROR:
        listName = _('errors');
        break;
      case RPT_SEVERITY_WARNING:
        listName = _('warnings');
        break;
      default:
        listName = _('appropriate');
        break;
    }

    const modified = (): void => {
      this.updateDisplayedCounts();
      this.redrawDrawPanel();
      this.m_parent.OnModify();
      this.m_window.projectModified();
    };

    const exclude = async (aWithComment: boolean): Promise<void> => {
      if (!marker) return;

      let comment = '';

      if (aWithComment) {
        const value = await this.m_window.textEntry('');

        if (value === null) return;

        comment = value;
      }

      this.m_markerProvider.SetMarkerExcluded(marker, true, comment);

      this.m_parent.GetCanvas()?.GetView()?.Update(marker);

      // The marker survives as an exclusion, so when exclusions are hidden it must leave
      // the filtered view without being counted as deleted; a rebuild re-filters cleanly.
      if (this.getSeverities() & RPT_SEVERITY_EXCLUSION) model.ValueChanged(aNode);
      else model.Update(this.m_markerProvider, this.getSeverities());

      modified();
    };

    const setSeverity = (aSeverity: number): void => {
      settings.SetSeverity(code, aSeverity);

      for (const item of this.m_parent.GetScreen()?.Items().OfType(KICAD_T.SCH_MARKER_T) ?? []) {
        if ((item as SCH_MARKER).GetRCItem()?.GetErrorCode() === code)
          this.m_parent.GetCanvas()?.GetView()?.Update(item);
      }

      // Rebuild model and view
      model.Update(this.m_markerProvider, this.getSeverities());
      modified();
    };

    const rows: ErcMenuRow[] = [];

    if (marker?.IsExcluded()) {
      rows.push({
        label: _('Remove exclusion for this violation'),
        help: wxFormat(_('It will be placed back in the %s list'), listName),
        action: () => {
          this.m_markerProvider.SetMarkerExcluded(marker, false);
          this.m_parent.GetCanvas()?.GetView()?.Update(marker);

          // The restored severity may fall outside the current filter, so re-filter when it no
          // longer matches instead of leaving a stale node in the view.
          if (this.getSeverities() & marker.GetSeverity()) model.ValueChanged(aNode);
          else model.Update(this.m_markerProvider, this.getSeverities());

          modified();
        },
      });
      rows.push({
        label: _('Edit exclusion comment...'),
        action: async () => {
          const value = await this.m_window.textEntry(marker.GetComment());

          if (value === null) return;

          this.m_markerProvider.SetMarkerExcluded(marker, true, value);

          // Update view
          model.ValueChanged(aNode);
          modified();
        },
      });
    } else {
      rows.push({
        label: _('Exclude this violation'),
        help: wxFormat(_('It will be excluded from the %s list'), listName),
        action: () => exclude(false),
      });
      rows.push({
        label: _('Exclude with comment...'),
        help: wxFormat(_('It will be excluded from the %s list'), listName),
        action: () => exclude(true),
      });
    }

    rows.push({ label: '', sep: true });

    const inspectionTool = this.m_parent.GetToolManager()?.GetTool(SCH_INSPECTION_TOOL) ?? null;
    const editTool = this.m_parent.GetToolManager()?.GetTool(SCH_EDIT_TOOL) ?? null;
    const inspectERCErrorMenuText = inspectionTool?.InspectERCErrorMenuText(rcItem) ?? '';
    const fixERCErrorMenuText = editTool?.FixERCErrorMenuText(rcItem) ?? '';

    if (inspectERCErrorMenuText || fixERCErrorMenuText) {
      if (inspectERCErrorMenuText) {
        rows.push({
          label: inspectERCErrorMenuText,
          action: () => inspectionTool!.InspectERCError(rcItem),
        });
      }

      if (fixERCErrorMenuText) {
        rows.push({
          label: fixERCErrorMenuText,
          action: () => editTool!.FixERCError(rcItem),
        });
      }

      rows.push({ label: '', sep: true });
    }

    const pinToPin =
      code === ERCE_T.ERCE_PIN_TO_PIN_WARNING || code === ERCE_T.ERCE_PIN_TO_PIN_ERROR;

    if (pinToPin) {
      // Pin to pin severities edited through pin conflict map
    } else if (settings.GetSeverity(code) === RPT_SEVERITY_WARNING) {
      rows.push({
        label: wxFormat(
          _("Change severity to Error for all '%s' violations"),
          rcItem.GetErrorText(true),
        ),
        help: _('Violation severities can also be edited in Schematic Setup'),
        action: () => setSeverity(RPT_SEVERITY_ERROR),
      });
    } else {
      rows.push({
        label: wxFormat(
          _("Change severity to Warning for all '%s' violations"),
          rcItem.GetErrorText(true),
        ),
        help: _('Violation severities can also be edited in Schematic Setup'),
        action: () => setSeverity(RPT_SEVERITY_WARNING),
      });
    }

    rows.push({
      label: wxFormat(_("Ignore all '%s' violations"), rcItem.GetErrorText(true)),
      help: _('Violations will not be checked or reported'),
      action: () => {
        settings.SetSeverity(code, RPT_SEVERITY_IGNORE);

        if (code === ERCE_T.ERCE_PIN_TO_PIN_ERROR)
          settings.SetSeverity(ERCE_T.ERCE_PIN_TO_PIN_WARNING, RPT_SEVERITY_IGNORE);

        this.m_ignoredList.push({ text: ` • ${rcItem.GetErrorText(true)}`, code });

        // Clear the selection before deleting markers. It may be some selected ERC markers.
        this.m_parent.GetToolManager()?.RunAction(ACTIONS.selectionClear);

        new SCH_SCREENS(this.m_parent.Schematic().Root()).DeleteMarkers(MARKER_T.MARKER_ERC, code);

        // Rebuild model and view
        model.Update(this.m_markerProvider, this.getSeverities());
        modified();
      },
    });

    rows.push({ label: '', sep: true });

    if (pinToPin) {
      rows.push({
        label: _('Edit pin-to-pin conflict map...'),
        help: _('Open the Schematic Setup dialog'),
        action: () => void this.m_parent.ShowSchematicSetupDialog(_('Pin Conflicts Map')),
      });
    } else {
      rows.push({
        label: _('Edit violation severities...'),
        help: _('Open the Schematic Setup dialog'),
        action: () => void this.m_parent.ShowSchematicSetupDialog(_('Violation Severity')),
      });
    }

    if (code === ERCE_T.ERCE_ENDPOINT_OFF_GRID) {
      rows.push({
        label: _('Edit connection grid spacing...'),
        help: _('Open the Schematic Setup dialog'),
        action: () => void this.m_parent.ShowSchematicSetupDialog(_('Formatting')),
      });
    }

    return rows;
  }

  /**
   * `OnIgnoredItemRClick( event )` (dialog_erc.cpp:993): the Ignored Tests row's radio menu
   * over the error code the row carries. A changed severity goes into ERC_SETTINGS and the
   * project is modified.
   */
  OnIgnoredItemRClick(aRow: number): ErcMenuRow[] {
    const row = this.m_ignoredList[aRow];

    if (!row) return [];

    const settings = this.m_parent.Schematic().ErcSettings();
    const errorCode = row.code;
    const current = settings.GetSeverity(errorCode);

    const choose = (severity: number): void => {
      if (settings.GetSeverity(errorCode) !== severity) {
        settings.SetSeverity(errorCode, severity);

        this.updateDisplayedCounts();
        this.redrawDrawPanel();
        this.m_parent.OnModify();
        this.m_window.projectModified();
      }
    };

    return [
      {
        label: _('Error'),
        checked: current === RPT_SEVERITY_ERROR,
        action: () => choose(RPT_SEVERITY_ERROR),
      },
      {
        label: _('Warning'),
        checked: current === RPT_SEVERITY_WARNING,
        action: () => choose(RPT_SEVERITY_WARNING),
      },
      {
        label: _('Ignore'),
        checked: current === RPT_SEVERITY_IGNORE,
        action: () => choose(RPT_SEVERITY_IGNORE),
      },
    ];
  }

  /** `PrevMarker()` (dialog_erc.cpp:1021). */
  PrevMarker(): void {
    if (this.m_notebookSelection !== 0) this.m_notebookSelection = 0;

    this.m_markerTreeModel.PrevMarker();
    this.notify();
  }

  /** `NextMarker()` (dialog_erc.cpp:1033). */
  NextMarker(): void {
    if (this.m_notebookSelection !== 0) this.m_notebookSelection = 0;

    this.m_markerTreeModel.NextMarker();
    this.notify();
  }

  /** `SelectMarker( aMarker )` (dialog_erc.cpp:1045). */
  SelectMarker(aMarker: SCH_MARKER): void {
    this.m_notebookSelection = 0;
    this.m_centerMarkerOnIdle = aMarker;
    this.m_markerTreeModel.SelectMarker(aMarker);

    // centerMarkerIdleHandler, on the next idle
    queueMicrotask(() => {
      if (this.m_centerMarkerOnIdle) this.m_markerTreeModel.CenterMarker(this.m_centerMarkerOnIdle);

      this.m_centerMarkerOnIdle = null;
      this.notify();
    });
    this.notify();
  }

  /** `ExcludeMarker( aMarker )` (dialog_erc.cpp:1071). */
  ExcludeMarker(aMarker: SCH_MARKER | null = null): void {
    let marker = aMarker;

    if (marker !== null) this.m_markerTreeModel.SelectMarker(marker);

    let node: RC_TREE_NODE | null = null;

    if (this.m_notebookSelection === 0) {
      node = this.m_markerDataView.GetCurrentItem();

      if (node?.m_RcItem) marker = node.m_RcItem.GetParent() as SCH_MARKER | null;
    }

    if (!marker || marker.IsExcluded()) return;

    // Route through the provider so its cached counts stay in sync even when the dialog is not on
    // the violations tab and has no tree node to refresh.
    this.m_markerProvider.SetMarkerExcluded(marker, true);
    this.m_parent.GetCanvas()?.GetView()?.Update(marker);

    if (node) {
      // The marker survives as an exclusion, so when exclusions are hidden it must leave the
      // filtered view without being counted as deleted; a rebuild re-filters cleanly.
      if (this.getSeverities() & RPT_SEVERITY_EXCLUSION) this.m_markerTreeModel.ValueChanged(node);
      else this.m_markerTreeModel.Update(this.m_markerProvider, this.getSeverities());
    }

    this.updateDisplayedCounts();
    this.redrawDrawPanel();
    this.m_parent.OnModify();
    this.m_window.projectModified();
  }

  /** `OnEditViolationSeverities()` (dialog_erc.cpp:1112). */
  OnEditViolationSeverities(): void {
    void this.m_parent.ShowSchematicSetupDialog(_('Violation Severity'));
  }

  /** `OnSeverity( aEvent )` (dialog_erc.cpp:1118). */
  OnSeverity(aBox: 'all' | 'errors' | 'warnings' | 'exclusions', aChecked: boolean): void {
    if (aBox === 'all') {
      this.m_showAll = aChecked;
      this.m_showErrors = true;
      this.m_showWarnings = aChecked;
      this.m_showExclusions = aChecked;
    } else if (aBox === 'errors') {
      this.m_showErrors = aChecked;
    } else if (aBox === 'warnings') {
      this.m_showWarnings = aChecked;
    } else {
      this.m_showExclusions = aChecked;
    }

    this.UpdateData();
  }

  /** `deleteAllMarkers( aIncludeExclusions )` (dialog_erc.cpp:1131). */
  deleteAllMarkers(aIncludeExclusions: boolean): void {
    this.m_parent.GetToolManager()?.RunAction(ACTIONS.selectionClear);

    this.m_markerTreeModel.DeleteItems(false, aIncludeExclusions, false);

    new SCH_SCREENS(this.m_parent.Schematic().Root()).DeleteAllMarkers(
      MARKER_T.MARKER_ERC,
      aIncludeExclusions,
    );

    // DeleteItems() only decremented the cached counts for markers matching the current filter,
    // but DeleteAllMarkers() removed hidden severities too; rebuild to resync the counts.
    this.m_markerTreeModel.Update(this.m_markerProvider, this.getSeverities());
  }

  /** `OnSaveReport()` (dialog_erc.cpp:1153). */
  async OnSaveReport(): Promise<void> {
    const reportWriter = new ERC_REPORT(
      this.m_parent.Schematic(),
      this.m_parent.GetUserUnits(),
      this.m_markerProvider,
    );

    const path = await this.m_window.saveReport('ERC.rpt', (aFullPath) => {
      // fn.GetExt() == FILEEXT::JsonFileExtension
      return aFullPath.toLowerCase().endsWith('.json')
        ? reportWriter.WriteJsonReport()
        : reportWriter.WriteTextReport();
    });

    if (path === null) return;

    this.m_messages.push(wxFormat(_("Report file '%s' created."), path));
    this.notify();
  }
}

/** `Update()`: one repaint, so a page change is on screen before a blocking run. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function toMenuItems(aRows: readonly ErcMenuRow[]): MenuItem[] {
  return aRows.map((r) =>
    r.sep
      ? { sep: true }
      : {
          label: r.label,
          ...(r.checked !== undefined ? { checked: r.checked } : {}),
          action: () => void r.action?.(),
        },
  );
}

/** The dialog's window: DIALOG_ERC_BASE over the class's state. */
export function DialogErc({ dialog }: { dialog: DIALOG_ERC }): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => dialog.subscribe(() => force((n) => n + 1)), [dialog]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const d = dialog;

  return (
    <>
      <DIALOG_ERC_BASE
        m_infoBar={d.m_infoBar}
        onShowAnnotate={() => d.OnLinkClicked()}
        onMenu={(aAnchor) => {
          const r = aAnchor.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom, items: toMenuItems(d.OnMenu()) });
        }}
        runningResultsPage={d.m_runningResultsBook}
        m_messages={d.m_messages}
        gauge={d.m_gauge}
        resultsPage={d.m_notebookSelection}
        onResultsPageChanged={(aPage) => {
          d.m_notebookSelection = aPage;
          d.notify();
        }}
        violationsTitle={d.m_violationsTitle}
        ignoredTitle={d.m_ignoredTitle}
        m_markerDataView={
          <RcTreeView
            model={d.m_markerTreeModel}
            view={d.m_markerDataView}
            testId="erc-violation-list"
            onDoubleClick={(aNode) => d.OnERCItemDClick(aNode)}
            onContextMenu={(e, aNode) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, items: toMenuItems(d.OnERCItemRClick(aNode)) });
            }}
          />
        }
        ignoredRows={d.m_ignoredList.map((r) => r.text)}
        onIgnoredRightClick={(aRow, e) =>
          setMenu({ x: e.clientX, y: e.clientY, items: toMenuItems(d.OnIgnoredItemRClick(aRow)) })
        }
        onEditIgnoredTests={() => d.OnEditViolationSeverities()}
        m_showAll={{ value: d.m_showAll, onChange: (aOn) => d.OnSeverity('all', aOn) }}
        m_showErrors={{
          check: { value: d.m_showErrors, onChange: (aOn) => d.OnSeverity('errors', aOn) },
          count: d.m_errorsCount,
          severity: RPT_SEVERITY_ERROR,
        }}
        m_showWarnings={{
          check: { value: d.m_showWarnings, onChange: (aOn) => d.OnSeverity('warnings', aOn) },
          count: d.m_warningsCount,
          severity: RPT_SEVERITY_WARNING,
        }}
        m_showExclusions={{
          check: {
            value: d.m_showExclusions,
            onChange: (aOn) => d.OnSeverity('exclusions', aOn),
          },
          count: d.m_exclusionsCount,
          severity: RPT_SEVERITY_EXCLUSION,
        }}
        badgeMax={ERC_BADGE_MAX}
        saveEnabled={d.m_saveEnabled}
        onSaveReport={() => void d.OnSaveReport()}
        deleteEnabled={d.m_deleteEnabled}
        onDeleteOneMarker={() => d.OnDeleteOneClick()}
        onDeleteAllMarkers={() => void d.OnDeleteAllClick()}
        runEnabled={d.m_okEnabled}
        cancelLabel={d.m_cancelLabel}
        onRunERC={() => void d.OnRunERCClick()}
        onCancel={() => d.OnCancelClick()}
      />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
