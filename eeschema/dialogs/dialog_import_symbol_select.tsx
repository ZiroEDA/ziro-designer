// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_SYMBOL_SELECT` (eeschema/dialogs/dialog_import_symbol_select.{h,cpp}) over
 * DIALOG_IMPORT_SYMBOL_SELECT_BASE: the symbols of a library file, filtered and checked for import
 * (SYMBOL_IMPORT_MANAGER brings a derived symbol's parents along), a power symbol marked with its
 * icon and one already in the destination library with a warning, derived ones in italics, the
 * selected one previewed at a chosen unit; and on Import, the "Resolve Import Conflicts" dialog for
 * the symbols the destination already has.
 *
 * SYMBOL_EDIT_FRAME::ImportSymbol hands the window DIALOG_IMPORT_SYMBOL_SELECT_ARG; on OK the
 * dialog fills its selected symbols and conflict resolutions.
 */
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { Button, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { DataViewCtrl, DataViewIconText } from '@ziroeda/wx/dataview_ui.js';
import {
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { BoxSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { type JSX, useRef, useState } from 'react';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import { type SCH_FILE_T, SCH_IO_MGR, type SCH_IO } from '../sch_io/sch_io_mgr.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import type { DIALOG_IMPORT_SYMBOL_SELECT_ARG } from '../symbol_editor/symbol_editor_import_export.js';
import { CONFLICT_RESOLUTION, SYMBOL_IMPORT_MANAGER } from '../symbol_import_manager.js';
import { SYMBOL_PREVIEW_WIDGET, SymbolPreviewWidget } from '../widgets/symbol_preview_widget.js';
import { DIALOG_IMPORT_SYMBOL_SELECT_BASE } from './dialog_import_symbol_select_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The list's columns: the toggle, then the symbol. */
export const COL_CHECKBOX = 0;

/** One row of `m_symbolList`, as refreshList appends it. */
export interface IMPORT_SYMBOL_ROW {
  name: string;
  /** Checked for both manual and auto-selected. */
  checked: boolean;
  /** `add_power` for a power symbol, `small_warning` for one the destination has, else none. */
  icon: 'add_power' | 'small_warning' | null;
  /** ROW_DATA_DERIVED: a derived symbol, its name drawn in italics. */
  derived: boolean;
}

/** The controls, as the handlers leave them. */
export interface IMPORT_SYMBOL_DIALOG_STATE {
  m_searchCtrl: string;
  rows: IMPORT_SYMBOL_ROW[];
  /** `m_symbolList->GetSelectedRow()`, or -1. */
  selectedRow: number;
  unitChoices: string[];
  m_unitChoice: number;
  unitChoiceEnabled: boolean;
  m_statusLine: string;
  okEnabled: boolean;
}

/** The "Resolve Import Conflicts" dialog's rows: each conflicting symbol and its Action text. */
export interface IMPORT_CONFLICT_ROW {
  name: string;
  action: string;
}

const LoadError = (e: unknown): boolean => e instanceof IO_ERROR || e instanceof PARSE_ERROR;

export class DIALOG_IMPORT_SYMBOL_SELECT {
  readonly m_frame: SYMBOL_EDIT_FRAME;
  readonly m_filePath: string;
  readonly m_destLibrary: string;
  readonly m_plugin: SCH_IO | null;
  readonly m_manager = new SYMBOL_IMPORT_MANAGER();
  /** `SetTitle( "Import Symbols from %s" )`. */
  readonly m_title: string;
  m_preview: SYMBOL_PREVIEW_WIDGET | null = null;
  /** `m_listIndices`: each symbol's row in the filtered list, -1 when filtered out. */
  readonly m_listIndices = new Map<string, number>();
  m_filterString = '';
  m_selectedSymbol = '';
  readonly m_conflictResolutions = new Map<string, CONFLICT_RESOLUTION>();
  m_state: IMPORT_SYMBOL_DIALOG_STATE;

  constructor(
    aParent: SYMBOL_EDIT_FRAME,
    aFilePath: string,
    aDestLibrary: string,
    aPluginType: SCH_FILE_T,
  ) {
    this.m_frame = aParent;
    this.m_filePath = aFilePath;
    this.m_destLibrary = aDestLibrary;
    this.m_plugin = SCH_IO_MGR.FindPlugin(aPluginType);

    // wxFileName fn( aFilePath ); fn.GetFullName()
    this.m_title = `Import Symbols from ${aFilePath.slice(aFilePath.lastIndexOf('/') + 1)}`;

    this.m_state = {
      m_searchCtrl: '',
      rows: [],
      selectedRow: -1,
      unitChoices: [],
      m_unitChoice: 0,
      // m_unitChoice->Enable( false )
      unitChoiceEnabled: false,
      // The base's label.
      m_statusLine: _('0 symbols selected'),
      // m_sdbSizerOK->Disable()
      okEnabled: false,
    };
  }

  /** The preview, once the window has built it. */
  SetPreviewWidget(aWidget: SYMBOL_PREVIEW_WIDGET | null): void {
    this.m_preview = aWidget;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): IMPORT_SYMBOL_DIALOG_STATE | null {
    if (!this.loadSymbols()) return null;

    this.m_manager.BuildDependencyMaps();
    this.refreshList();
    this.updateStatusLine();
    return this.snapshot();
  }

  /** `loadSymbols()`: every symbol in the file, its parent and power flag, and whether it clashes. */
  loadSymbols(): boolean {
    if (!this.m_plugin) {
      DisplayErrorMessage(_('Unable to find a plugin to read this library.'));
      return false;
    }

    const symbolNames: string[] = [];

    try {
      this.m_plugin.EnumerateSymbolLib(symbolNames, this.m_filePath);
    } catch (ioe) {
      if (!LoadError(ioe)) throw ioe;

      DisplayErrorMessage(
        `Cannot read symbol library '${this.m_filePath}'.`,
        ioe instanceof IO_ERROR ? ioe.What() : (ioe as Error).message,
      );
      return false;
    }

    if (symbolNames.length === 0) {
      DisplayErrorMessage(`Symbol library '${this.m_filePath}' is empty.`);
      return false;
    }

    // Get the library manager to check for existing symbols
    const libMgr = this.m_frame.GetLibManager();

    this.m_manager.Clear();

    for (const name of symbolNames) {
      let parentName = '';
      let isPower = false;

      try {
        const sym = this.m_plugin.LoadSymbol(this.m_filePath, name);

        if (sym) {
          parentName = sym.GetParentName();
          isPower = sym.IsPower();
        }
      } catch (e) {
        // Symbol failed to load - still add it to list but without full info
        if (!LoadError(e)) throw e;
      }

      // Add to manager - don't pass the symbol, which is the plugin's cached one
      this.m_manager.AddSymbol(name, parentName, isPower, null);
    }

    this.m_manager.CheckExistingSymbols((name) => libMgr.SymbolExists(name, this.m_destLibrary));

    return true;
  }

  /** `refreshList()`: the rows that match the filter. */
  refreshList(): void {
    const rows: IMPORT_SYMBOL_ROW[] = [];
    this.m_listIndices.clear();

    for (const name of this.m_manager.GetSymbolNames()) {
      if (!this.matchesFilter(name)) {
        this.m_listIndices.set(name, -1);
        continue;
      }

      this.m_listIndices.set(name, rows.length);

      const info = this.m_manager.GetSymbolInfo(name);

      if (!info) continue;

      rows.push({
        name,
        // Checkbox column - show checked for both manual and auto-selected
        checked: info.m_checked || info.m_autoSelected,
        icon: info.m_isPower ? 'add_power' : info.m_existsInDest ? 'small_warning' : null,
        // Tag derived (non-root) rows so the store italicizes them.
        derived: info.m_parentName !== '',
      });
    }

    this.m_state.rows = rows;
    this.updateImportButton();
  }

  /** `updatePreview()`: the selected symbol, flattened if derived, at the first unit. */
  updatePreview(): void {
    const s = this.m_state;

    if (this.m_selectedSymbol === '') {
      this.m_preview?.DisplayPart(null, 0);
      s.unitChoices = [];
      s.unitChoiceEnabled = false;
      return;
    }

    const sym = this.loadSelected();

    if (!sym) {
      this.m_preview?.DisplayPart(null, 0);
      return;
    }

    const unitCount = Math.max(sym.GetUnitCount(), 1);

    // Update unit choice if count changed
    s.unitChoiceEnabled = unitCount > 1;
    s.unitChoices = [];

    if (unitCount > 1) {
      for (let ii = 0; ii < unitCount; ii++)
        s.unitChoices.push(sym.GetUnitDisplayName(ii + 1, true));
    }

    // SetSelection( 0 ) on a filled choice; an empty one has no selection
    s.m_unitChoice = 0;
    const selectedUnit = s.unitChoices.length > 0 ? s.m_unitChoice + 1 : 1;

    this.displaySymbol(sym, selectedUnit);
  }

  /** `updateStatusLine()`. */
  updateStatusLine(): void {
    const manualCount = this.m_manager.GetManualSelectionCount();
    const autoCount = this.m_manager.GetAutoSelectionCount();

    this.m_state.m_statusLine =
      autoCount > 0
        ? `${manualCount} symbols selected, ${autoCount} parents auto-included`
        : `${manualCount} symbols selected`;
  }

  /** `updateImportButton()`: Import is enabled while there is something to import. */
  updateImportButton(): void {
    this.m_state.okEnabled = this.m_manager.GetSymbolsToImport().length > 0;
  }

  /** `OnFilterTextChanged( event )`. */
  OnFilterTextChanged(aText: string): IMPORT_SYMBOL_DIALOG_STATE {
    this.m_state.m_searchCtrl = aText;
    this.m_filterString = aText.toLowerCase();
    this.refreshList();
    return this.snapshot();
  }

  /** `OnSymbolSelected( event )`: the row's symbol previewed, or none. */
  OnSymbolSelected(aRow: number): IMPORT_SYMBOL_DIALOG_STATE {
    this.m_state.selectedRow = aRow;

    if (aRow < 0) {
      this.m_selectedSymbol = '';
      this.updatePreview();
      return this.snapshot();
    }

    for (const [name, listIndex] of this.m_listIndices) {
      if (listIndex === aRow) {
        this.m_selectedSymbol = name;
        this.updatePreview();
        break;
      }
    }

    return this.snapshot();
  }

  /** `onItemChecked( event )`: the row's toggle changed. */
  onItemChecked(aRow: number, aChecked: boolean): IMPORT_SYMBOL_DIALOG_STATE {
    for (const [name, listIndex] of this.m_listIndices) {
      if (listIndex === aRow) {
        this.m_state.rows[aRow]!.checked = aChecked;
        this.toggleSymbolSelection(name, aChecked);
        break;
      }
    }

    return this.snapshot();
  }

  /**
   * `toggleSymbolSelection( aSymbolName, aChecked )`: checking ticks the symbols it brings along;
   * unchecking takes its descendants out and re-reads every row.
   */
  toggleSymbolSelection(aSymbolName: string, aChecked: boolean): boolean {
    const rows = this.m_state.rows;

    if (aChecked) {
      for (const changedName of this.m_manager.SetSymbolSelected(aSymbolName, true)) {
        const index = this.m_listIndices.get(changedName);

        if (index !== undefined && index >= 0) rows[index]!.checked = true;
      }
    } else {
      this.m_manager.DeselectWithDescendants(aSymbolName);

      for (const name of this.m_manager.GetSymbolNames()) {
        const index = this.m_listIndices.get(name);

        if (index !== undefined && index >= 0) {
          const info = this.m_manager.GetSymbolInfo(name);

          if (info) rows[index]!.checked = info.m_checked || info.m_autoSelected;
        }
      }
    }

    this.updateStatusLine();
    this.updateImportButton();
    return true;
  }

  matchesFilter(aSymbolName: string): boolean {
    return SYMBOL_IMPORT_MANAGER.MatchesFilter(aSymbolName, this.m_filterString);
  }

  /** `OnSelectAll( event )`: every symbol the filter shows. */
  OnSelectAll(): IMPORT_SYMBOL_DIALOG_STATE {
    this.m_manager.SelectAll((name) => this.matchesFilter(name));
    this.refreshList();
    this.updateStatusLine();
    this.updateImportButton();
    return this.snapshot();
  }

  /** `OnSelectNone( event )`. */
  OnSelectNone(): IMPORT_SYMBOL_DIALOG_STATE {
    this.m_manager.DeselectAll((name) => this.matchesFilter(name));
    this.refreshList();
    this.updateStatusLine();
    this.updateImportButton();
    return this.snapshot();
  }

  /** `OnUnitChanged( event )`: the selected symbol previewed at the chosen unit. */
  OnUnitChanged(aSelection: number): IMPORT_SYMBOL_DIALOG_STATE {
    this.m_state.m_unitChoice = aSelection;

    if (this.m_selectedSymbol === '') return this.snapshot();

    const selectedUnit = aSelection >= 0 ? aSelection + 1 : 1;
    const sym = this.loadSelected();

    if (sym) this.displaySymbol(sym, selectedUnit);

    return this.snapshot();
  }

  /** `GetSelectedSymbols()`. */
  GetSelectedSymbols(): string[] {
    return this.m_manager.GetSymbolsToImport();
  }

  /** `GetConflictResolutions()`. */
  GetConflictResolutions(): Map<string, CONFLICT_RESOLUTION> {
    return this.m_conflictResolutions;
  }

  /**
   * `resolveConflicts()`'s set-up: every conflict set to Overwrite, and the rows of the dialog it
   * shows; null when nothing conflicts (TransferDataFromWindow then accepts).
   */
  BeginResolveConflicts(): IMPORT_CONFLICT_ROW[] | null {
    this.m_conflictResolutions.clear();

    const conflicts = this.m_manager.GetConflicts();

    if (conflicts.length === 0) return null;

    return conflicts.map((name) => {
      this.m_conflictResolutions.set(name, CONFLICT_RESOLUTION.OVERWRITE);
      return { name, action: _('Overwrite') };
    });
  }

  /** The conflicts dialog's Action cell edited: "Skip" skips, anything else overwrites. */
  SetConflictAction(aName: string, aAction: string): void {
    this.m_conflictResolutions.set(
      aName,
      aAction === 'Skip' ? CONFLICT_RESOLUTION.SKIP : CONFLICT_RESOLUTION.OVERWRITE,
    );
  }

  /** What the arg ImportSymbol waits on is filled with on OK. */
  FillArg(aArg: DIALOG_IMPORT_SYMBOL_SELECT_ARG): void {
    aArg.selectedSymbols.length = 0;
    aArg.selectedSymbols.push(...this.GetSelectedSymbols());
    aArg.conflictResolutions.clear();

    for (const [name, resolution] of this.m_conflictResolutions)
      aArg.conflictResolutions.set(name, resolution);
  }

  /** The plugin's cached copy of the selected symbol, or null when it does not load. */
  private loadSelected(): LIB_SYMBOL | null {
    try {
      return this.m_plugin?.LoadSymbol(this.m_filePath, this.m_selectedSymbol) ?? null;
    } catch (e) {
      if (!LoadError(e)) throw e;

      return null;
    }
  }

  /** For derived symbols, we need to flatten to show properly. */
  private displaySymbol(aSym: LIB_SYMBOL, aUnit: number): void {
    if (aSym.IsDerived() || aSym.GetParentName() !== '') {
      let flattened: LIB_SYMBOL | null = null;

      try {
        flattened = aSym.Flatten();
      } catch (e) {
        // show unflattened symbol as fallback
        if (!LoadError(e)) throw e;
      }

      this.m_preview?.DisplayPart(flattened ?? aSym, aUnit);
    } else {
      this.m_preview?.DisplayPart(aSym, aUnit);
    }
  }

  /** A copy for React: the handlers change m_state in place. */
  private snapshot(): IMPORT_SYMBOL_DIALOG_STATE {
    return structuredClone(this.m_state);
  }
}

/**
 * `resolveConflicts()`'s wxDialog "Resolve Import Conflicts": the conflicting symbols with an
 * editable Action, Skip All / Overwrite All, Import / Cancel.
 */
function ResolveImportConflicts({
  dlg,
  initial,
  onClose,
}: {
  dlg: DIALOG_IMPORT_SYMBOL_SELECT;
  initial: IMPORT_CONFLICT_ROW[];
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [rows, setRows] = useState(initial);
  const setAll = (aAction: 'Skip' | 'Overwrite') => {
    for (const row of rows) dlg.SetConflictAction(row.name, aAction);
    setRows(rows.map((r) => ({ ...r, action: aAction })));
  };

  return (
    // wxSize( 500, 400 ), wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER
    <DialogShim
      title={_('Resolve Import Conflicts')}
      onClose={() => onClose(false)}
      // [data] wxSize( 500, 400 ), dialog_import_symbol_select.cpp's resolveConflicts
      style={{ width: 500, height: 400 }}
    >
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={10}>
          <StaticText
            label={
              'The following symbols already exist in the destination library. ' +
              'Choose how to handle each conflict:'
            }
            wrap={450}
          />
        </SizerItem>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
          <DataViewCtrl
            columns={[_('Symbol'), _('Action')]}
            rowCount={rows.length}
            selection={null}
            onSelect={() => {}}
            ariaLabel={_HKI('Conflicts')}
            cell={(row, col) =>
              col === 0 ? (
                rows[row]!.name
              ) : (
                // wxDATAVIEW_CELL_EDITABLE text: the edit is the value-changed event
                <TextCtrl
                  value={rows[row]!.action}
                  ariaLabel={`Action for ${rows[row]!.name}`}
                  onChange={(t) => {
                    dlg.SetConflictAction(rows[row]!.name, t);
                    setRows(rows.map((r, i) => (i === row ? { ...r, action: t } : r)));
                  }}
                />
              )
            }
          />
        </SizerItem>
        <SizerItem flag={wxLEFT | wxRIGHT | wxBOTTOM} border={10}>
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxRIGHT} border={5}>
              <Button label={_('Skip All')} onClick={() => setAll('Skip')} />
            </SizerItem>
            <SizerItem>
              <Button label={_('Overwrite All')} onClick={() => setAll('Overwrite')} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={10}>
          <StdDialogButtonSizer
            onOk={() => onClose(true)}
            okLabel={_('Import')}
            onCancel={() => onClose(false)}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}

/**
 * The dialog as the window shows it for SYMBOL_EDIT_FRAME::ImportSymbol's
 * ShowModalDialog( "DIALOG_IMPORT_SYMBOL_SELECT" ): \a onClose gets wxID_OK once the arg holds the
 * selection and the conflict resolutions, or wxID_CANCEL.
 */
export function DialogImportSymbolSelect({
  frame,
  arg,
  onClose,
}: {
  frame: SYMBOL_EDIT_FRAME;
  arg: DIALOG_IMPORT_SYMBOL_SELECT_ARG;
  onClose: (aResult: number) => void;
}): JSX.Element {
  const [dlg] = useState(
    () => new DIALOG_IMPORT_SYMBOL_SELECT(frame, arg.filePath, arg.destLibrary, arg.pluginType),
  );
  // A file that does not load leaves the dialog empty, its error already shown.
  const [s, setS] = useState(() => dlg.TransferDataToWindow() ?? structuredClone(dlg.m_state));
  const [conflicts, setConflicts] = useState<IMPORT_CONFLICT_ROW[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const accept = () => {
    dlg.FillArg(arg);
    onClose(wxID_OK);
  };

  return (
    <>
      <DIALOG_IMPORT_SYMBOL_SELECT_BASE
        title={dlg.m_title}
        m_searchCtrl={s.m_searchCtrl}
        onFilterTextChanged={(t) => setS(dlg.OnFilterTextChanged(t))}
        searchRef={searchRef}
        m_symbolList={
          <DataViewCtrl
            columns={['', _('Symbol')]}
            rowCount={s.rows.length}
            selection={s.selectedRow >= 0 ? s.selectedRow : null}
            onSelect={(row) => setS(dlg.OnSymbolSelected(row))}
            ariaLabel="Symbols"
            cell={(row, col) => {
              const r = s.rows[row]!;

              if (col === COL_CHECKBOX)
                return (
                  <CheckBox
                    label=""
                    ariaLabel={`Import ${r.name}`}
                    checked={r.checked}
                    onChange={(on) => setS(dlg.onItemChecked(row, on))}
                  />
                );

              const icon = r.icon ? <img src={bitmapUrl(r.icon)} alt="" /> : null;

              // IMPORT_SYMBOL_LIST_STORE::GetAttrByRow: a derived symbol's name in italics.

              return <DataViewIconText icon={icon} text={r.name} italic={r.derived} />;
            }}
          />
        }
        onSelectAll={() => setS(dlg.OnSelectAll())}
        onSelectNone={() => setS(dlg.OnSelectNone())}
        unitChoices={s.unitChoices}
        m_unitChoice={s.m_unitChoice}
        unitChoiceEnabled={s.unitChoiceEnabled}
        onUnitChanged={(i) => setS(dlg.OnUnitChanged(i))}
        m_previewPanel={
          <SymbolPreviewWidget project={frame.Prj()} onReady={(w) => dlg.SetPreviewWidget(w)} />
        }
        m_statusLine={s.m_statusLine}
        okEnabled={s.okEnabled}
        onOK={() => {
          // TransferDataFromWindow(): resolveConflicts()
          const rows = dlg.BeginResolveConflicts();

          if (rows === null) accept();
          else setConflicts(rows);
        }}
        onCancel={() => onClose(wxID_CANCEL)}
      />
      {conflicts !== null && (
        <ResolveImportConflicts
          dlg={dlg}
          initial={conflicts}
          onClose={(ok) => {
            setConflicts(null);

            if (ok) accept();
          }}
        />
      )}
    </>
  );
}
