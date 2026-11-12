// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_NETLIST` (`pcbnew/dialogs/dialog_import_netlist.cpp` over
 * `dialog_import_netlist_base.cpp`), File > Import > Netlist...
 * (`PCB_ACTIONS::importNetlist` -> `BOARD_EDITOR_CONTROL::ImportNetlist` ->
 * `PCB_EDIT_FRAME::InstallNetlistFrame`).
 *
 *     bMainSizer (V)
 *       bSizerNetlistFilename (H)          wxEXPAND|wxALL 10
 *         "Netlist file:"                  wxALIGN_CENTER_VERTICAL|wxLEFT|wxRIGHT 5
 *         m_NetlistFilenameCtrl            proportion 1
 *         m_browseButton (small_folder)
 *       bUpperSizer (H)                    wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5
 *         m_matchByTimestamp "Link Method" wxRadioBox, 2 rows   proportion 1, wxEXPAND|wxLEFT|wxRIGHT|wxTOP 5
 *         "Options" wxStaticBoxSizer (V)   proportion 1, wxEXPAND|wxLEFT|wxRIGHT|wxTOP 5
 *           5 wxCheckBox                   each wxBOTTOM 5 (the 4th also wxRIGHT)
 *       bLowerSizer, min height 250        wxEXPAND|wxLEFT|wxRIGHT|wxTOP 5, proportion 1
 *         m_MessageWindow (WX_HTML_REPORT_PANEL)   wxEXPAND|wxALL 5
 *       wxStdDialogButtonSizer: OK "Load and Test Netlist", Apply "Update PCB", Cancel "Close"
 *
 * The decisions are the C++'s: any change of a control re-runs the netlist as
 * a dry run (`loadNetlist( true )`), OK only loads and tests (the dialog stays
 * up), Update PCB runs it for real and relabels the report "Changes Applied to
 * PCB". `m_cbDeleteShortingTracks` is drawn and, exactly as in 10.0.6, read by
 * nothing.
 *
 * The netlist is read and applied by the caller (`performLoad`): it owns the
 * board and the footprint libraries. A browser has no paths to stat, so a file
 * "exists" when the caller can produce its text (`readFile`), or when it was
 * just chosen with Browse.
 */
import { type JSX, useReducer, useState } from 'react';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  type ReportLine,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { CHECK } from '@ziroeda/wx/controls.js';
import { type ChooserFilter, WxFileDialog } from '@ziroeda/wx/filedlg.js';
import { DIALOG_IMPORT_NETLIST_BASE } from './dialog_import_netlist_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `FILEEXT::NetlistFileWildcard()`. */
export const NETLIST_FILE_FILTER: ChooserFilter = {
  label: 'KiCad netlist files (*.net)',
  extensions: ['net'],
};

/** The dialog's controls, in the base file's initial state. */
export interface ImportNetlistOptions {
  /** `m_matchByTimestamp->GetSelection() == 1`: link by reference designators. */
  matchByReference: boolean;
  /** `m_cbDeleteExtraFootprints`. */
  deleteExtraFootprints: boolean;
  /** `m_cbUpdateFootprints`. */
  updateFootprints: boolean;
  /** `m_cbTransferGroups`. */
  transferGroups: boolean;
  /** `m_cbOverrideLocks`. */
  overrideLocks: boolean;
  /** `m_cbDeleteShortingTracks`: drawn, read by nothing in 10.0.6. */
  deleteShortingTracks: boolean;
}

export const DEFAULT_IMPORT_NETLIST_OPTIONS: ImportNetlistOptions = {
  matchByReference: false,
  deleteExtraFootprints: false,
  updateFootprints: true,
  transferGroups: true,
  overrideLocks: false,
  deleteShortingTracks: false,
};

/** The two `ReportHead` lines `loadNetlist` writes before anything else. */
export function netlistHeadLines(
  aNetlistFileName: string,
  aMatchByReference: boolean,
): ReportLine[] {
  return [
    {
      message: wxFormat(_("Reading netlist file '%s'.\n"), aNetlistFileName),
      severity: RPT_SEVERITY_INFO,
      location: 'head',
    },
    {
      message: aMatchByReference
        ? _('Using reference designators to match symbols and footprints.\n')
        : _('Using tstamps (unique IDs) to match symbols and footprints.\n'),
      severity: RPT_SEVERITY_INFO,
      location: 'head',
    },
  ];
}

/** `ReadNetlistFromFile` + `BOARD_NETLIST_UPDATER::UpdateNetlist`, which the frame owns. */
export type NETLIST_LOADER = (
  aFileName: string,
  aText: string,
  aOptions: ImportNetlistOptions,
  aDryRun: boolean,
) => Promise<readonly ReportLine[] | null>;

export class DIALOG_IMPORT_NETLIST {
  m_NetlistFilenameCtrl: string;
  /** `m_netlistPath`: the last path found to exist; InstallNetlistFrame stores it on close. */
  m_netlistPath: string;
  /** `m_matchByTimestamp->GetSelection()`: 1 links by reference designators. */
  m_matchByTimestamp = 0;
  m_cbDeleteExtraFootprints = DEFAULT_IMPORT_NETLIST_OPTIONS.deleteExtraFootprints;
  m_cbUpdateFootprints = DEFAULT_IMPORT_NETLIST_OPTIONS.updateFootprints;
  m_cbTransferGroups = DEFAULT_IMPORT_NETLIST_OPTIONS.transferGroups;
  m_cbOverrideLocks = DEFAULT_IMPORT_NETLIST_OPTIONS.overrideLocks;
  /** Drawn, and read by nothing in 10.0.6. */
  m_cbDeleteShortingTracks = DEFAULT_IMPORT_NETLIST_OPTIONS.deleteShortingTracks;

  /** `m_MessageWindow`: its label and lines. */
  m_messageLabel = _HKI('Changes to Be Applied');
  m_messageLines: readonly ReportLine[] = [];
  /** `wxMessageBox( … )`, answered by the window. */
  m_messageBox: string | null = null;

  /** The files Browse has handed us, by path: a browser has no paths to stat. */
  private readonly m_chosen = new Map<string, string>();
  private readonly m_listeners = new Set<() => void>();

  constructor(
    aNetlistFullFilename: string,
    private readonly m_readFile: (aPath: string) => string | null,
    private readonly m_loader: NETLIST_LOADER,
  ) {
    this.m_netlistPath = aNetlistFullFilename;
    this.m_NetlistFilenameCtrl = aNetlistFullFilename;
  }

  /** `wxFileName::FileExists()`: the text of a file the caller can reach, or one Browse chose. */
  private fileText(aPath: string): string | null {
    if (aPath === '') return null;

    return this.m_chosen.get(aPath) ?? this.m_readFile(aPath);
  }

  private options(): ImportNetlistOptions {
    return {
      matchByReference: this.m_matchByTimestamp === 1,
      deleteExtraFootprints: this.m_cbDeleteExtraFootprints,
      updateFootprints: this.m_cbUpdateFootprints,
      transferGroups: this.m_cbTransferGroups,
      overrideLocks: this.m_cbOverrideLocks,
      deleteShortingTracks: this.m_cbDeleteShortingTracks,
    };
  }

  /** `onBrowseNetlistFiles`, after the wxFileDialog returned a file. */
  OnNetlistFileChosen(aPath: string, aText: string): void {
    this.m_chosen.set(aPath, aText);
    this.m_NetlistFilenameCtrl = aPath;
    this.onFilenameChanged(false);
  }

  onImportNetlist(): void {
    this.onFilenameChanged(true);
  }

  onUpdatePCB(): void {
    const name = this.m_NetlistFilenameCtrl;

    if (name === '') {
      this.m_messageBox = _('Please choose a valid netlist file.');
      this.notify();
      return;
    }

    if (this.fileText(name) === null) {
      this.m_messageBox = _('The netlist file does not exist.');
      this.notify();
      return;
    }

    this.m_messageLabel = _('Changes Applied to PCB');
    void this.loadNetlist(false);
  }

  onFilenameChanged(aLoadNetlist: boolean): void {
    if (this.m_NetlistFilenameCtrl === '') return;

    if (this.fileText(this.m_NetlistFilenameCtrl) !== null) {
      this.m_netlistPath = this.m_NetlistFilenameCtrl;

      if (aLoadNetlist) void this.loadNetlist(true);
    } else {
      this.m_messageLines = [
        {
          message: _('The netlist file does not exist.'),
          severity: RPT_SEVERITY_ERROR,
          location: 'body',
        },
      ];
      this.notify();
    }
  }

  OnMatchChanged(): void {
    void this.loadNetlist(true);
  }

  OnOptionChanged(): void {
    void this.loadNetlist(true);
  }

  async loadNetlist(aDryRun: boolean): Promise<void> {
    const netlistFileName = this.m_NetlistFilenameCtrl;
    const text = this.fileText(netlistFileName);

    if (text === null) return;

    const options = this.options();
    const head = netlistHeadLines(netlistFileName, options.matchByReference);

    this.m_messageLines = head;
    this.notify();

    const body = await this.m_loader(netlistFileName, text, options, aDryRun);

    if (body) {
      this.m_messageLines = [...head, ...body];
      this.notify();
    }
  }

  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => {
      this.m_listeners.delete(aListener);
    };
  }

  private notify(): void {
    for (const l of this.m_listeners) l();
  }
}

type OPT =
  | 'm_cbDeleteExtraFootprints'
  | 'm_cbUpdateFootprints'
  | 'm_cbTransferGroups'
  | 'm_cbOverrideLocks'
  | 'm_cbDeleteShortingTracks';

/**
 * `PCB_EDIT_FRAME::InstallNetlistFrame`: DIALOG_IMPORT_NETLIST over the frame's last netlist
 * path, ShowModal, then `SetLastPath( LAST_PATH_NETLIST, netlistName )` through `onClose`.
 */
export function DialogImportNetlist({
  netlistName,
  readFile,
  performLoad,
  onClose,
}: {
  /** `GetLastPath( LAST_PATH_NETLIST )`. */
  netlistName: string;
  /** The text of a netlist the caller can reach by that path, or null. */
  readFile: (aPath: string) => string | null;
  /** The body lines of the report, or null when the file could not be read. */
  performLoad: NETLIST_LOADER;
  /** `SetLastPath( LAST_PATH_NETLIST, netlistName )`, then the dialog goes. */
  onClose: (aNetlistName: string) => void;
}): JSX.Element {
  const [dialog] = useState(() => new DIALOG_IMPORT_NETLIST(netlistName, readFile, performLoad));
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [severities, setSeverities] = useState<Severity>(RPT_SEVERITY_ALL);
  const [browsing, setBrowsing] = useState(false);

  useState(() => dialog.Subscribe(redraw));

  const opt = (aKey: OPT): CHECK => ({
    value: dialog[aKey],
    onChange: (aOn) => {
      dialog[aKey] = aOn;
      dialog.OnOptionChanged();
      redraw();
    },
  });
  const close = (): void => onClose(dialog.m_netlistPath);

  return (
    <>
      <DIALOG_IMPORT_NETLIST_BASE
        m_NetlistFilenameCtrl={{
          value: dialog.m_NetlistFilenameCtrl,
          onChange: (aText) => {
            dialog.m_NetlistFilenameCtrl = aText;
            redraw();
          },
        }}
        onBrowseNetlistFiles={() => setBrowsing(true)}
        m_matchByTimestamp={dialog.m_matchByTimestamp}
        OnMatchChanged={(aSelection) => {
          dialog.m_matchByTimestamp = aSelection;
          dialog.OnMatchChanged();
          redraw();
        }}
        m_cbDeleteExtraFootprints={opt('m_cbDeleteExtraFootprints')}
        m_cbUpdateFootprints={opt('m_cbUpdateFootprints')}
        m_cbTransferGroups={opt('m_cbTransferGroups')}
        m_cbOverrideLocks={opt('m_cbOverrideLocks')}
        m_cbDeleteShortingTracks={opt('m_cbDeleteShortingTracks')}
        m_MessageWindow={{
          label: dialog.m_messageLabel,
          // SetFileName( Prj().GetProjectPath() + "report.txt" )
          fileName: 'report.txt',
          lines: dialog.m_messageLines,
          severities,
          onSeveritiesChange: setSeverities,
        }}
        okLabel={_('Load and Test Netlist')}
        applyLabel={_('Update PCB')}
        cancelLabel={_('Close')}
        onImportNetlist={() => dialog.onImportNetlist()}
        onUpdatePCB={() => dialog.onUpdatePCB()}
        onCancel={close}
      />
      {browsing && (
        <WxFileDialog
          title={_('Import Netlist')}
          filters={[NETLIST_FILE_FILTER]}
          onDone={(file) => {
            setBrowsing(false);
            if (file) dialog.OnNetlistFileChosen(file.path, file.text);
            redraw();
          }}
        />
      )}
      {dialog.m_messageBox !== null && (
        <MessageDialogOk
          message={dialog.m_messageBox}
          onClose={() => {
            dialog.m_messageBox = null;
            redraw();
          }}
        />
      )}
    </>
  );
}
