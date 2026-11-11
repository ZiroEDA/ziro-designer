// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UPDATE_FROM_PCB` (eeschema/dialogs/dialog_update_from_pcb.cpp): Update Schematic from
 * PCB over BACK_ANNOTATE. Every option change re-runs a dry run (`updateData`), so the report
 * always describes what Update Schematic would do now; Update Schematic applies it and leaves
 * the dialog open with OK disabled, as upstream.
 *
 * Not carried over: `m_sdbSizerCancel->SetDefault()` after an update (the button sizer has a
 * fixed default; OK is disabled by then, so Enter does nothing rather than close).
 */
import { type JSX, useEffect, useState } from 'react';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { Reporter, type ReportLine } from '@ziroeda/common/reporter.js';
import type { CHECK } from '@ziroeda/wx/controls.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { BACK_ANNOTATE } from '../tools/backannotate.js';
import { DIALOG_UPDATE_FROM_PCB_BASE } from './dialog_update_from_pcb_base.js';
import { _ } from '@ziroeda/wx/translation.js';

interface Props {
  frame: SCH_EDIT_FRAME;
  /** After a successful Update Schematic (the commit has been pushed). */
  onUpdated?: () => void;
  onClose: () => void;
}

/** The nine checkboxes' values; every one starts checked but re-link. */
interface OPTIONS {
  relink: boolean;
  references: boolean;
  footprints: boolean;
  values: boolean;
  netNames: boolean;
  attributes: boolean;
  preferUnitSwaps: boolean;
  otherFields: boolean;
  preferPinSwaps: boolean;
}

const DEFAULTS: OPTIONS = {
  relink: false,
  references: true,
  footprints: true,
  values: true,
  netNames: true,
  attributes: true,
  preferUnitSwaps: true,
  otherFields: true,
  preferPinSwaps: true,
};

function backAnnotate(
  aFrame: SCH_EDIT_FRAME,
  aReporter: Reporter,
  o: OPTIONS,
  aDryRun: boolean,
): BACK_ANNOTATE {
  return new BACK_ANNOTATE(
    aFrame,
    aReporter,
    o.relink,
    o.footprints,
    o.values,
    o.references,
    o.netNames,
    o.attributes,
    o.otherFields,
    o.preferUnitSwaps,
    o.preferPinSwaps,
    aDryRun,
  );
}

export function DIALOG_UPDATE_FROM_PCB({ frame, onUpdated, onClose }: Props): JSX.Element {
  // The constructor: with re-link on, references are cleared and disabled (it starts off).
  const [opts, setOpts] = useState<OPTIONS>(DEFAULTS);
  const [lines, setLines] = useState<readonly ReportLine[]>([]);
  const [okEnabled, setOkEnabled] = useState(false);
  const [severities, setSeverities] = useState(RPT_SEVERITY_ALL);

  /** `updateData()`: a dry run into a cleared panel; OK only if it ran. */
  const updateData = (o: OPTIONS): void => {
    let successfulRun = false;
    const reporter = new Reporter();
    const backAnno = backAnnotate(frame, reporter, o, true);
    const netlist = { value: '' };

    if (backAnno.FetchNetlistFromPCB(netlist))
      successfulRun = backAnno.BackAnnotateSymbols(netlist.value);

    setOkEnabled(successfulRun);
    setLines([...reporter.lines]);
  };

  // TransferDataToWindow() -> updateData().
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, as TransferDataToWindow does
  useEffect(() => {
    updateData(DEFAULTS);
  }, []);

  /** `OnOptionChanged()`. */
  const onOptionChanged = (aKey: keyof OPTIONS, aOn: boolean): void => {
    const o = { ...opts, [aKey]: aOn };

    if (aKey === 'relink' && aOn) o.references = false;

    setOpts(o);
    updateData(o);
  };

  /** `OnUpdateClick()`. */
  const onUpdateClick = (): void => {
    const reporter = new Reporter();
    const backAnno = backAnnotate(frame, reporter, opts, false);
    const netlist = { value: '' };

    if (backAnno.FetchNetlistFromPCB(netlist) && backAnno.BackAnnotateSymbols(netlist.value)) {
      for (const sheet of frame.Schematic().Hierarchy()) sheet.UpdateAllScreenReferences();

      frame.SetSheetNumberAndCount();
      frame.SyncView();
      frame.OnModify();
      frame.GetCanvas()?.Refresh();

      if (opts.relink) backAnno.PushNewLinksToPCB();

      setOkEnabled(false);
      onUpdated?.();
    }

    setLines([...reporter.lines]);
  };

  const check = (aKey: keyof OPTIONS, aEnabled = true): CHECK => ({
    value: opts[aKey],
    enabled: aEnabled,
    onChange: (aOn) => onOptionChanged(aKey, aOn),
  });

  return (
    <DIALOG_UPDATE_FROM_PCB_BASE
      m_cbRelinkFootprints={check('relink')}
      m_cbUpdateReferences={check('references', !opts.relink)}
      m_cbUpdateFootprints={check('footprints')}
      m_cbUpdateValues={check('values')}
      m_cbUpdateNetNames={check('netNames')}
      m_cbUpdateAttributes={check('attributes')}
      m_cbPreferUnitSwaps={check('preferUnitSwaps')}
      m_cbUpdateOtherFields={check('otherFields')}
      m_cbPreferPinSwaps={check('preferPinSwaps')}
      m_messagePanel={{
        label: _('Changes to Be Applied'),
        fileName: `${frame.Prj().GetProjectPath()}report.txt`,
        lines,
        visibleSeverities: severities,
        onVisibleSeveritiesChange: setSeverities,
      }}
      okLabel={_('Update Schematic')}
      cancelLabel={_('Close')}
      okEnabled={okEnabled}
      onUpdateClick={onUpdateClick}
      onCancel={onClose}
    />
  );
}
