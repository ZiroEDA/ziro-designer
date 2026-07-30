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
import type { AnnotateOptions } from '@ziroeda/eeschema';
import type { ReportLine, Severity } from '@ziroeda/common';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';
import { toolbarIconUrl } from '../../../ui/toolbarIcons.js';
import { settings } from '../../../prefs/settings.js';

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
  hasSelection: boolean;
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
}

const SCOPES: { id: AnnotateOptions['scope']; label: string }[] = [
  { id: 'all', label: 'Entire schematic' },
  { id: 'current_sheet', label: 'Current sheet only' },
  { id: 'selection', label: 'Selection' },
];

export function DialogAnnotate({
  hasSelection,
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
  const [scope, setScope] = useState<AnnotateOptions['scope']>(() => {
    if (infoBarMessage) return 'all';
    const saved = SCOPES[cfg.scope]?.id ?? 'all';
    // A remembered Selection scope is meaningless with nothing selected.
    return saved === 'selection' && !hasSelection ? 'all' : saved;
  });
  const [recursive, setRecursive] = useState(cfg.recursive);
  const [order, setOrder] = useState<AnnotateOptions['order']>(initial.order);
  const [reset, setReset] = useState(cfg.options >= 1);
  const [regroupUnits, setRegroupUnits] = useState(cfg.regroup_units);
  const [algo, setAlgo] = useState<AnnotateOptions['algo']>(initial.algo);
  const [startNumber, setStartNumber] = useState(initial.startNumber);
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

  const orderIcon = (name: string): JSX.Element | null => {
    const url = toolbarIconUrl(name);
    return url ? <img className="ze-order-bitmap" src={url} alt="" /> : null;
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={close}>
      <div className="ze-modal ze-annotate-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Annotate Schematic
          <span className="x" onClick={close}>
            ✕
          </span>
        </div>
        {/* WX_INFOBAR: shown when annotation was demanded by another action. */}
        {infoBarMessage && <div className="ze-infobar">{infoBarMessage}</div>}
        <div className="ze-modal-body ze-annotate-body">
          <div className="ze-annotate-grid">
            <fieldset>
              <legend>Scope</legend>
              {SCOPES.map((s) => (
                <label
                  key={s.id}
                  className={
                    (s.id === 'selection' && !hasSelection) || scopeLocked ? 'disabled' : ''
                  }
                >
                  <input
                    type="radio"
                    name="ze-annotate-scope"
                    checked={scope === s.id}
                    disabled={(s.id === 'selection' && !hasSelection) || scopeLocked}
                    onChange={() => setScope(s.id)}
                  />
                  {s.label}
                </label>
              ))}
              <label className={scopeLocked ? 'disabled' : ''}>
                <input
                  type="checkbox"
                  checked={recursive}
                  disabled={scopeLocked}
                  onChange={(e) => setRecursive(e.target.checked)}
                />
                Recurse into subsheets
              </label>
            </fieldset>

            <fieldset>
              <legend>Order</legend>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-order"
                  checked={order === 'x'}
                  onChange={() => setOrder('x')}
                />
                Sort symbols by X position
                {orderIcon('annotateDownRight')}
              </label>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-order"
                  checked={order === 'y'}
                  onChange={() => setOrder('y')}
                />
                Sort symbols by Y position
                {orderIcon('annotateRightDown')}
              </label>
            </fieldset>

            <fieldset>
              <legend>Options</legend>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-reset"
                  checked={!reset}
                  onChange={() => setReset(false)}
                />
                Keep existing annotations
              </label>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-reset"
                  checked={reset}
                  onChange={() => setReset(true)}
                />
                Reset existing annotations
              </label>
              {/* OnOptionChanged: only meaningful when resetting. */}
              <label className={reset ? '' : 'disabled'}>
                <input
                  type="checkbox"
                  checked={regroupUnits}
                  disabled={!reset}
                  onChange={(e) => setRegroupUnits(e.target.checked)}
                />
                Regroup symbol units
              </label>
            </fieldset>

            <fieldset>
              <legend>Numbering</legend>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-algo"
                  checked={algo === 'incremental'}
                  onChange={() => setAlgo('incremental')}
                />
                Use first free number after:
                <input
                  type="number"
                  className="ze-search start-num"
                  value={startNumber}
                  min={0}
                  onChange={(e) => setStartNumber(Number(e.target.value) || 0)}
                  onFocus={() => setAlgo('incremental')}
                />
              </label>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-algo"
                  checked={algo === 'sheet_100'}
                  onChange={() => setAlgo('sheet_100')}
                />
                First free after sheet number X 100
              </label>
              <label>
                <input
                  type="radio"
                  name="ze-annotate-algo"
                  checked={algo === 'sheet_1000'}
                  onChange={() => setAlgo('sheet_1000')}
                />
                First free after sheet number X 1000
              </label>
            </fieldset>
          </div>

          <HtmlReportPanel
            label="Annotation Messages:"
            lines={messages}
            fileName="report.txt"
            visibleSeverities={severities}
            onVisibleSeveritiesChange={setSeverities}
            minHeight={160}
            sorted
          />
        </div>
        <div className="ze-modal-footer">
          <button type="button" onClick={() => onClear(scope, recursive)}>
            Clear Annotation
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={close}>
            Close
          </button>
          <button type="button" className="primary" onClick={() => onAnnotate(run)}>
            Annotate
          </button>
        </div>
      </div>
    </div>
  );
}
