/**
 * Update PCB from Schematic dialog. Counterpart:
 * `pcbnew/dialogs/dialog_update_pcb.cpp` (DIALOG_UPDATE_PCB) over
 * `dialog_update_pcb_base.cpp`'s layout: three stacked static boxes — Options,
 * Update Footprints, Update Fields — above the report panel, with "Update PCB" and
 * "Close" for OK and Cancel.
 *
 * The dialog is a live preview of the update: TransferDataToWindow runs the netlist
 * update as a *dry run* so the panel opens already reading "Changes to Be Applied",
 * and every checkbox re-runs that dry run. Pressing Update PCB relabels the panel
 * "Changes Applied to PCB", runs it for real, and hands the new board back.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { ReportLine, Severity } from '@ziroeda/common';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';

/** The option set BOARD_NETLIST_UPDATER is driven with (the dialog's checkboxes). */
export interface UpdatePcbOptions {
  /** m_cbRelinkFootprints — inverted into SetLookupByTimestamp. */
  relinkFootprints: boolean;
  /** m_cbTransferGroups. */
  transferGroups: boolean;
  /** m_cbApplyDesignBlockLayouts. */
  applyDesignBlockLayouts: boolean;
  /** m_cbUpdateFootprints. */
  updateFootprints: boolean;
  /** m_cbDeleteExtraFootprints. */
  deleteExtraFootprints: boolean;
  /** m_cbOverrideLocks. */
  overrideLocks: boolean;
  /** m_cbUpdateFields. */
  updateFields: boolean;
  /** m_cbRemoveExtraFields. */
  removeExtraFields: boolean;
}

/** dialog_update_pcb_base.cpp's initial checkbox states. */
export const DEFAULT_UPDATE_PCB_OPTIONS: UpdatePcbOptions = {
  relinkFootprints: false,
  transferGroups: false,
  applyDesignBlockLayouts: false,
  updateFootprints: true,
  deleteExtraFootprints: false,
  overrideLocks: false,
  updateFields: true,
  removeExtraFields: false,
};

interface Props {
  /** PerformUpdate( aDryRun ) — the caller runs the updater and returns its report. */
  onPerformUpdate: (options: UpdatePcbOptions, dryRun: boolean) => readonly ReportLine[];
  onClose: () => void;
  /**
   * Design blocks are not modelled yet, so "Apply design block layouts" is shown
   * (it is part of the dialog) but disabled.
   */
  designBlocksSupported?: boolean;
}

export function DialogUpdatePcb({
  onPerformUpdate,
  onClose,
  designBlocksSupported = false,
}: Props): JSX.Element {
  const [options, setOptions] = useState<UpdatePcbOptions>(DEFAULT_UPDATE_PCB_OPTIONS);
  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<Severity>(RPT_SEVERITY_ALL);
  /** SetLabel: "Changes to Be Applied" until Update PCB has been pressed. */
  const [applied, setApplied] = useState(false);
  /** m_sdbSizer1OK->Enable( false ) after a successful update. */
  const [okEnabled, setOkEnabled] = useState(true);

  // TransferDataToWindow: PerformUpdate( true ). The ref keeps the effect from
  // re-running the dry run when only the report changes.
  const performRef = useRef(onPerformUpdate);
  performRef.current = onPerformUpdate;

  useEffect(() => {
    setMessages(performRef.current(options, true));
  }, [options]);

  /** OnOptionChanged: design block layouts only apply when groups are transferred. */
  const change = (patch: Partial<UpdatePcbOptions>): void => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      if (!next.transferGroups) next.applyDesignBlockLayouts = false;
      return next;
    });
    // The dry run made the button meaningful again.
    setOkEnabled(true);
    setApplied(false);
  };

  const update = (): void => {
    setApplied(true);
    setMessages(onPerformUpdate(options, false));
    // wxWidgets keeps both buttons highlighted without disabling OK.
    setOkEnabled(false);
  };

  const applyLayoutsEnabled = options.transferGroups && designBlocksSupported;

  const checkbox = (
    key: keyof UpdatePcbOptions,
    label: string,
    opts: { title?: string; disabled?: boolean } = {},
  ): JSX.Element => (
    <label className={opts.disabled ? 'disabled' : ''} title={opts.title}>
      <input
        type="checkbox"
        checked={options[key]}
        disabled={opts.disabled}
        onChange={(e) => change({ [key]: e.target.checked } as Partial<UpdatePcbOptions>)}
      />
      {label}
    </label>
  );

  const label = useMemo(
    () => (applied ? 'Changes Applied to PCB' : 'Changes to Be Applied'),
    [applied],
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-update-pcb-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Update PCB from Schematic
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-update-pcb-body">
          <fieldset>
            <legend>Options</legend>
            {checkbox(
              'relinkFootprints',
              'Re-link footprints to schematic symbols based on their reference designators',
              {
                title:
                  'Normally footprints are linked to their symbols via their Unique IDs.  Select this option only if you want to reset the footprint linkages based on their reference designators.',
              },
            )}
            {checkbox('transferGroups', 'Group footprints based on symbol group')}
            {checkbox('applyDesignBlockLayouts', 'Apply design block layouts to new groups', {
              disabled: !applyLayoutsEnabled,
              title: designBlocksSupported
                ? "For each new group created from a design block, apply the block's saved footprint placement and routing automatically."
                : 'Design blocks are not supported yet.',
            })}
          </fieldset>

          <fieldset>
            <legend>Update Footprints</legend>
            {checkbox('updateFootprints', 'Replace footprints with those specified by symbols', {
              title:
                "Normally footprints on the board should be changed to match footprint assignment changes made in the schematic. Uncheck this only if you don't want to change existing footprints on the board.",
            })}
            {checkbox('deleteExtraFootprints', 'Delete footprints with no symbols', {
              title:
                'Remove from the board unlocked footprints which are not linked to a schematic symbol.',
            })}
            {checkbox('overrideLocks', 'Override locks')}
          </fieldset>

          <fieldset>
            <legend>Update Fields</legend>
            {checkbox('updateFields', 'Update footprint fields from symbols')}
            {checkbox('removeExtraFields', 'Remove footprint fields not found in symbols')}
          </fieldset>

          <HtmlReportPanel
            label={label}
            lines={messages}
            fileName="report.txt"
            visibleSeverities={severities}
            onVisibleSeveritiesChange={setSeverities}
            minHeight={300}
            sorted
          />
        </div>
        <div className="ze-modal-footer">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" disabled={!okEnabled} onClick={update}>
            Update PCB
          </button>
        </div>
      </div>
    </div>
  );
}
