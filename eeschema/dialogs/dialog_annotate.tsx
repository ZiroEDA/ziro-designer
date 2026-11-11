// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Annotate Schematic dialog. Counterpart: `eeschema/dialogs/dialog_annotate.cpp`
 * (DIALOG_ANNOTATE) over `dialog_annotate_base.cpp`'s layout, a 2×2 grid of
 * Scope | Order over Options | Numbering, the Annotation Messages report panel,
 * and the Clear Annotation / Close / Annotate buttons.
 *
 * Like upstream the dialog is modeless: annotating leaves it open so the
 * messages it just produced can be read.
 */
import { useState, type JSX } from 'react';
import type { AnnotateOptions } from '../sch_reference_list.js';
import type { ReportLine, Severity } from '@ziroeda/common';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { EESCHEMA_SETTINGS_STORE } from '../browser/eeschema_app.js';
import { DIALOG_ANNOTATE_BASE } from './dialog_annotate_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The project-persisted slice of the dialog (SCHEMATIC_SETTINGS: sort order,
 *  numbering method, start number, DIALOG_ANNOTATE reads them on open and
 *  writes changes back on close; scope/reset stay app preferences). */
export interface AnnotateProjectSettings {
  order: Exclude<AnnotateOptions['order'], 'unsorted'>;
  algo: AnnotateOptions['algo'];
  startNumber: number;
}

/** The full option set an annotation run needs (AnnotateSymbols' arguments). */
export interface AnnotateRun extends AnnotateOptions {
  /** aRecursive: also take the sub-sheets below the scope. */
  recursive: boolean;
}

interface Props {
  /** Seed from the project's Schematic Setup > Annotation (TransferDataToWindow). */
  initial: AnnotateProjectSettings;
  /** Messages of the last run, shown in the report panel. */
  messages: readonly ReportLine[];
  /** ModalAnnotate's info bar text; when set, the scope is locked to the whole
   *  schematic (DIALOG_ANNOTATE's constructor). */
  infoBarMessage?: string;
  onAnnotate: (opts: AnnotateRun) => void;
  onClear: (scope: AnnotateOptions['scope'], recursive: boolean) => void;
  /** ~DIALOG_ANNOTATE: the project slice is handed back on every close so the
   *  caller can persist it when changed (OnModify). */
  onClose: (settings: AnnotateProjectSettings) => void;
  /** `Pgm().GetSettingsManager()`'s eeschema slice (`EESCHEMA_APP.settings`),
   *  which this dialog reads its defaults from and writes back to. */
  settings: EESCHEMA_SETTINGS_STORE;
}

const SCOPES: { id: AnnotateOptions['scope']; label: string }[] = [
  { id: 'all', label: _HKI('Entire schematic') },
  { id: 'current_sheet', label: _HKI('Current sheet only') },
  { id: 'selection', label: _HKI('Selection') },
];

export function DialogAnnotate({
  settings,
  initial,
  messages,
  infoBarMessage,
  onAnnotate,
  onClear,
  onClose,
}: Props): JSX.Element {
  // EESCHEMA_SETTINGS m_AnnotatePanel: scope / options / recursive /
  // regroup_units / messages_filter are app preferences (TransferDataToWindow).
  const cfg = settings.eeschema.annotation;
  // TransferDataToWindow: with an info-bar message m_rbScope_Schematic is set and disabled, and
  // the saved scope and recursion are not read (`if( m_rbScope_Schematic->IsEnabled() )`).
  const [scope, setScope] = useState<AnnotateOptions['scope']>(() =>
    infoBarMessage ? 'all' : (SCOPES[cfg.scope]?.id ?? 'all'),
  );
  const [recursive, setRecursive] = useState(infoBarMessage ? true : cfg.recursive);
  const [order, setOrder] = useState<AnnotateOptions['order']>(initial.order);
  const [reset, setReset] = useState(cfg.options >= 1);
  const [regroupUnits, setRegroupUnits] = useState(cfg.regroup_units);
  const [algo, setAlgo] = useState<AnnotateOptions['algo']>(initial.algo);
  // m_textNumberAfter: wxString::Format( "%d", m_AnnotateStartNum ).
  const [startText, setStartText] = useState(String(initial.startNumber));
  // GetStartNumber(): ToLong, 0 when it does not parse.
  const startNumber = Number.isInteger(Number(startText.trim())) ? Number(startText.trim()) : 0;
  const [severities, setSeverities] = useState<Severity>(() =>
    cfg.messages_filter < 0 ? RPT_SEVERITY_ALL : cfg.messages_filter,
  );

  const scopeLocked = !!infoBarMessage;

  /** ~DIALOG_ANNOTATE: the preferences slice is written back on close. */
  const close = (): void => {
    settings.updateEeschema((s) => {
      s.annotation.options = reset ? 1 : 0;
      if (!scopeLocked) {
        s.annotation.scope = SCOPES.findIndex((sc) => sc.id === scope);
        s.annotation.recursive = recursive;
      }
      s.annotation.regroup_units = regroupUnits;
      s.annotation.messages_filter = severities;
    });
    onClose({ order: order === 'unsorted' ? 'x' : order, algo, startNumber });
  };

  // DialogShim's onClose: Esc is the Close button, which saves the dialog's settings on the way out exactly as OnCancelClick does.

  const run: AnnotateRun = {
    scope,
    order,
    algo,
    resetExisting: reset,
    // OnAnnotateClick: regrouping only applies when resetting.
    regroupUnits: reset && regroupUnits,
    startNumber,
    sheetNumber: 1,
    recursive,
  };

  const ORDERS: AnnotateOptions['order'][] = ['x', 'y'];
  const ALGOS: AnnotateOptions['algo'][] = ['incremental', 'sheet_100', 'sheet_1000'];

  return (
    <DIALOG_ANNOTATE_BASE
      m_infoBar={infoBarMessage ?? null}
      scope={{
        value: SCOPES.findIndex((sc) => sc.id === scope),
        onChange: (i) => setScope(SCOPES[i]!.id),
        // m_rbScope_Schematic->Enable( false ) - the only one upstream disables.
        disabled: [scopeLocked, false, false],
      }}
      m_checkRecursive={{ value: recursive, onChange: setRecursive }}
      order={{
        value: Math.max(0, ORDERS.indexOf(order)),
        onChange: (i) => setOrder(ORDERS[i]!),
      }}
      keepReset={{ value: reset ? 1 : 0, onChange: (i) => setReset(i === 1) }}
      // OnOptionChanged: m_checkRegroupUnits->Enable( m_rbReset_Annotations->GetValue() ).
      m_checkRegroupUnits={{ value: regroupUnits, enabled: reset, onChange: setRegroupUnits }}
      numbering={{ value: Math.max(0, ALGOS.indexOf(algo)), onChange: (i) => setAlgo(ALGOS[i]!) }}
      m_textNumberAfter={startText}
      onNumberAfter={setStartText}
      m_MessageWindow={{
        label: _('Annotation Messages:'),
        fileName: 'report.txt',
        lines: messages,
        visibleSeverities: severities,
        onVisibleSeveritiesChange: setSeverities,
        // [data] The constructor's MsgPanelSetMinSize( wxSize( -1, 160 ) ), over the base's 120.
        minHeight: 160,
      }}
      onClearAnnotationClick={() => onClear(scope, recursive)}
      onAnnotateClick={() => onAnnotate(run)}
      onCancel={close}
    />
  );
}
