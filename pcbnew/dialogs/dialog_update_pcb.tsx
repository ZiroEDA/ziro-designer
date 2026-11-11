// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Update PCB from Schematic dialog. Counterpart:
 * `pcbnew/dialogs/dialog_update_pcb.cpp` (DIALOG_UPDATE_PCB) over
 * `dialog_update_pcb_base.cpp`'s layout: three stacked static boxes, Options,
 * Update Footprints, Update Fields, above the report panel, with "Update PCB" and
 * "Close" for OK and Cancel.
 *
 * The dialog is a live preview of the update: TransferDataToWindow runs the netlist
 * update as a *dry run* so the panel opens already reading "Changes to Be Applied",
 * and every checkbox re-runs that dry run. Pressing Update PCB relabels the panel
 * "Changes Applied to PCB" (for good: a later option change does not relabel it), runs it for
 * real, and hands the new board back. `DialogUpdatePcb` below is the window.
 */

import { type JSX, useReducer, useState } from 'react';
import type { ReportLine, Severity } from '@ziroeda/common';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { CHECK } from '@ziroeda/wx/controls.js';
import { DIALOG_UPDATE_PCB_BASE } from './dialog_update_pcb_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The option set BOARD_NETLIST_UPDATER is driven with (the dialog's checkboxes). */
export interface UpdatePcbOptions {
  /** m_cbRelinkFootprints, inverted into SetLookupByTimestamp. */
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

/** `PerformUpdate`'s BOARD_NETLIST_UPDATER run, which the frame owns: its report lines. */
export type NETLIST_UPDATE = (
  aOptions: UpdatePcbOptions,
  aDryRun: boolean,
) => readonly ReportLine[];

/** A wxCheckBox: its value and Enable(). */
interface BOX {
  value: boolean;
  enabled: boolean;
}

export class DIALOG_UPDATE_PCB {
  readonly m_cbRelinkFootprints: BOX = { value: false, enabled: true };
  readonly m_cbTransferGroups: BOX = { value: false, enabled: true };
  readonly m_cbApplyDesignBlockLayouts: BOX = { value: false, enabled: true };
  /** `m_cbUpdateFootprints->SetValue( true )` in the base. */
  readonly m_cbUpdateFootprints: BOX = { value: true, enabled: true };
  readonly m_cbDeleteExtraFootprints: BOX = { value: false, enabled: true };
  readonly m_cbOverrideLocks: BOX = { value: false, enabled: true };
  /** `m_cbUpdateFields->SetValue( true )` in the base. */
  readonly m_cbUpdateFields: BOX = { value: true, enabled: true };
  readonly m_cbRemoveExtraFields: BOX = { value: false, enabled: true };

  /** `m_messagePanel`: its label and lines. */
  m_messageLabel = _HKI('Changes to Be Applied');
  m_messageLines: readonly ReportLine[] = [];
  m_okEnabled = true;

  constructor(
    private readonly m_update: NETLIST_UPDATE,
    /**
     * Design blocks are not modelled yet, so "Apply design block layouts" stays shown but greyed
     * whatever the groups box says.
     */
    readonly m_designBlocksSupported = false,
  ) {
    this.m_cbApplyDesignBlockLayouts.enabled = this.applyLayoutsEnabled();
  }

  private applyLayoutsEnabled(): boolean {
    return this.m_cbTransferGroups.value && this.m_designBlocksSupported;
  }

  private options(): UpdatePcbOptions {
    return {
      relinkFootprints: this.m_cbRelinkFootprints.value,
      transferGroups: this.m_cbTransferGroups.value,
      applyDesignBlockLayouts: this.m_cbApplyDesignBlockLayouts.value,
      updateFootprints: this.m_cbUpdateFootprints.value,
      deleteExtraFootprints: this.m_cbDeleteExtraFootprints.value,
      overrideLocks: this.m_cbOverrideLocks.value,
      updateFields: this.m_cbUpdateFields.value,
      removeExtraFields: this.m_cbRemoveExtraFields.value,
    };
  }

  PerformUpdate(aDryRun: boolean): void {
    this.m_messageLines = this.m_update(this.options(), aDryRun);
  }

  TransferDataToWindow(): boolean {
    this.m_cbApplyDesignBlockLayouts.enabled = this.applyLayoutsEnabled();
    this.PerformUpdate(true);
    return true;
  }

  OnOptionChanged(): void {
    const transferGroups = this.m_cbTransferGroups.value;

    if (!transferGroups) this.m_cbApplyDesignBlockLayouts.value = false;

    this.m_cbApplyDesignBlockLayouts.enabled = this.applyLayoutsEnabled();

    this.PerformUpdate(true);
    this.m_okEnabled = true;
  }

  OnUpdateClick(): void {
    this.m_messageLabel = _('Changes Applied to PCB');
    this.PerformUpdate(false);

    // wxWidgets has a tendency to keep both buttons highlighted without the following:
    this.m_okEnabled = false;
  }
}

type OPT =
  | 'm_cbRelinkFootprints'
  | 'm_cbTransferGroups'
  | 'm_cbApplyDesignBlockLayouts'
  | 'm_cbUpdateFootprints'
  | 'm_cbDeleteExtraFootprints'
  | 'm_cbOverrideLocks'
  | 'm_cbUpdateFields'
  | 'm_cbRemoveExtraFields';

interface Props {
  /** PerformUpdate( aDryRun ), the caller runs the updater and returns its report. */
  onPerformUpdate: NETLIST_UPDATE;
  onClose: () => void;
  /**
   * Design blocks are not modelled yet, so "Apply design block layouts" is shown
   * (it is part of the dialog) but disabled.
   */
  designBlocksSupported?: boolean;
}

/** `DIALOG_UPDATE_PCB( frame, &netlist ).ShowModal()`. */
export function DialogUpdatePcb({
  onPerformUpdate,
  onClose,
  designBlocksSupported = false,
}: Props): JSX.Element {
  const [dialog] = useState(() => {
    const d = new DIALOG_UPDATE_PCB(onPerformUpdate, designBlocksSupported);
    // OnInitDialog -> TransferDataToWindow
    d.TransferDataToWindow();
    return d;
  });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [severities, setSeverities] = useState<Severity>(RPT_SEVERITY_ALL);

  const opt = (aKey: OPT): CHECK => ({
    value: dialog[aKey].value,
    enabled: dialog[aKey].enabled,
    onChange: (aOn) => {
      dialog[aKey].value = aOn;
      dialog.OnOptionChanged();
      redraw();
    },
  });

  return (
    <DIALOG_UPDATE_PCB_BASE
      m_cbRelinkFootprints={opt('m_cbRelinkFootprints')}
      m_cbTransferGroups={opt('m_cbTransferGroups')}
      m_cbApplyDesignBlockLayouts={opt('m_cbApplyDesignBlockLayouts')}
      applyDesignBlockLayoutsTip={
        dialog.m_designBlocksSupported
          ? _(
              "For each new group created from a design block, apply the block's saved footprint placement and routing automatically.",
            )
          : 'Design blocks are not supported yet.'
      }
      m_cbUpdateFootprints={opt('m_cbUpdateFootprints')}
      m_cbDeleteExtraFootprints={opt('m_cbDeleteExtraFootprints')}
      m_cbOverrideLocks={opt('m_cbOverrideLocks')}
      m_cbUpdateFields={opt('m_cbUpdateFields')}
      m_cbRemoveExtraFields={opt('m_cbRemoveExtraFields')}
      m_messagePanel={{
        label: dialog.m_messageLabel,
        lines: dialog.m_messageLines,
        severities,
        onSeveritiesChange: setSeverities,
      }}
      okEnabled={dialog.m_okEnabled}
      OnUpdateClick={() => {
        dialog.OnUpdateClick();
        redraw();
      }}
      onCancel={onClose}
    />
  );
}
