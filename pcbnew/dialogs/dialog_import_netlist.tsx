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
import { useRef, useState, type JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  type ReportLine,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { Check, Radio } from '@ziroeda/common/wx/controls.js';
import { WxFileDialog, type ChooserFilter } from '@ziroeda/common/wx/filedlg.js';

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
      message: `Reading netlist file '${aNetlistFileName}'.\n`,
      severity: RPT_SEVERITY_INFO,
      location: 'head',
    },
    {
      message: aMatchByReference
        ? 'Using reference designators to match symbols and footprints.\n'
        : 'Using tstamps (unique IDs) to match symbols and footprints.\n',
      severity: RPT_SEVERITY_INFO,
      location: 'head',
    },
  ];
}

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
  /**
   * `ReadNetlistFromFile` + `BOARD_NETLIST_UPDATER::UpdateNetlist`: the body lines
   * of the report, or null when the file could not be read (nothing more is shown).
   */
  performLoad: (
    aFileName: string,
    aText: string,
    aOptions: ImportNetlistOptions,
    aDryRun: boolean,
  ) => Promise<readonly ReportLine[] | null>;
  /** `SetLastPath( LAST_PATH_NETLIST, netlistName )`, then the dialog goes. */
  onClose: (aNetlistName: string) => void;
}): JSX.Element {
  const [name, setName] = useState(netlistName);
  const [options, setOptions] = useState(DEFAULT_IMPORT_NETLIST_OPTIONS);
  const [lines, setLines] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<Severity>(RPT_SEVERITY_ALL);
  const [label, setLabel] = useState('Changes to Be Applied');
  const [browsing, setBrowsing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** The files Browse has handed us, by path. */
  const chosen = useRef(new Map<string, string>());
  /** `m_netlistPath`, the last path found to exist. */
  const pathRef = useRef(netlistName);

  const textOf = (aPath: string): string | null => chosen.current.get(aPath) ?? readFile(aPath);

  /** `loadNetlist( aDryRun )`. */
  const loadNetlist = async (aDryRun: boolean, aOptions = options, aName = name): Promise<void> => {
    const text = aName === '' ? null : textOf(aName);

    if (text === null) return;

    setLines(netlistHeadLines(aName, aOptions.matchByReference));

    const body = await performLoad(aName, text, aOptions, aDryRun);

    if (body) setLines([...netlistHeadLines(aName, aOptions.matchByReference), ...body]);
  };

  /** `onFilenameChanged( aLoadNetlist )`. */
  const onFilenameChanged = (aLoadNetlist: boolean, aName = name): void => {
    if (aName === '') return;

    if (textOf(aName) !== null) {
      pathRef.current = aName;

      if (aLoadNetlist) void loadNetlist(true, options, aName);
    } else {
      setLines([
        {
          message: 'The netlist file does not exist.',
          severity: RPT_SEVERITY_ERROR,
          location: 'body',
        },
      ]);
    }
  };

  /** `OnMatchChanged` / `OnOptionChanged`: every control re-runs the dry run. */
  const change = (patch: Partial<ImportNetlistOptions>): void => {
    const next = { ...options, ...patch };
    setOptions(next);
    void loadNetlist(true, next);
  };

  /** `onUpdatePCB`. */
  const updatePcb = (): void => {
    if (name === '') {
      setMessage('Please choose a valid netlist file.');
      return;
    }

    if (textOf(name) === null) {
      setMessage('The netlist file does not exist.');
      return;
    }

    setLabel('Changes Applied to PCB');
    void loadNetlist(false);
  };

  const check = (key: keyof ImportNetlistOptions, text: string): JSX.Element => (
    <Check label={text} checked={options[key] as boolean} onChange={(v) => change({ [key]: v })} />
  );

  return (
    <DialogShim
      title="Import Netlist"
      onClose={() => onClose(pathRef.current)}
      className="ze-import-netlist"
    >
      <div className="ze-modal-body ze-import-netlist-body">
        <div className="ze-import-netlist-file">
          <label htmlFor="ze-import-netlist-name">Netlist file:</label>
          <input
            id="ze-import-netlist-name"
            className="ze-search"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="ze-btn ze-import-netlist-browse"
            title="Browse"
            aria-label="Browse"
            onClick={() => setBrowsing(true)}
          >
            ...
          </button>
        </div>
        <div className="ze-import-netlist-upper">
          <fieldset className="ze-sbox ze-import-netlist-link">
            <legend>Link Method</legend>
            {/* The tooltip is the radio box's own. */}
            <div title="Select whether to update footprint references to match their currently-assigned symbols, or to re-assign footprints to symbols which match their current references.">
              <Radio
                name="ze-import-netlist-link"
                value={options.matchByReference ? 1 : 0}
                options={[
                  [0, 'Link footprints using component tstamps (unique ids)'],
                  [1, 'Link footprints using reference designators'],
                ]}
                onChange={(v) => change({ matchByReference: v === 1 })}
              />
            </div>
          </fieldset>
          <fieldset className="ze-sbox ze-import-netlist-options">
            <legend>Options</legend>
            {check('deleteExtraFootprints', 'Delete footprints with no components in netlist')}
            {check('updateFootprints', 'Replace footprints with those specified in netlist')}
            {check('transferGroups', 'Group footprints based on symbol group')}
            {check('overrideLocks', 'Delete/replace footprints even if locked')}
            {check('deleteShortingTracks', 'Delete tracks shorting multiple nets')}
          </fieldset>
        </div>
        <div className="ze-import-netlist-lower">
          <HtmlReportPanel
            label={label}
            lines={lines}
            fileName="report.txt"
            visibleSeverities={severities}
            onVisibleSeveritiesChange={setSeverities}
            minHeight={250}
            sorted
          />
        </div>
      </div>
      {/* `wxStdDialogButtonSizer` on GTK: Cancel, Apply, then the affirmative. */}
      <div className="ze-modal-footer">
        <span className="ze-sdb-spacer" />
        <button type="button" className="ze-btn" onClick={() => onClose(pathRef.current)}>
          Close
        </button>
        <button type="button" className="ze-btn" onClick={updatePcb}>
          Update PCB
        </button>
        <button type="button" className="ze-btn primary" onClick={() => onFilenameChanged(true)}>
          Load and Test Netlist
        </button>
      </div>
      {browsing && (
        <WxFileDialog
          title="Import Netlist"
          filters={[NETLIST_FILE_FILTER]}
          onDone={(file) => {
            setBrowsing(false);

            if (!file) return;

            chosen.current.set(file.path, file.text);
            setName(file.path);
            onFilenameChanged(false, file.path);
          }}
        />
      )}
      {message !== null && <MessageDialogOk message={message} onClose={() => setMessage(null)} />}
    </DialogShim>
  );
}
