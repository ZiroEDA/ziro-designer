// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Text & Graphics Properties. Counterpart:
 * `eeschema/dialogs/dialog_global_edit_text_and_graphics_base.cpp`
 * (DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS).
 *
 * Three boxes that compose: Scope picks the items, Filters narrows them, Action
 * says what to change. Every control in the Action box starts indeterminate —
 * "-- leave unchanged --" in a dropdown, blank in a size field, the third state
 * of a checkbox — because a global edit almost always means changing one thing
 * about many items, not setting all their properties at once.
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { GlobalEditAction, GlobalEditScope } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

export interface GlobalEditResult {
  scope: GlobalEditScope;
  filters: {
    fieldName?: string;
    reference?: string;
    symbolLibId?: string;
    symbolType?: 'normal' | 'power';
    net?: string;
    selectedOnly: boolean;
  };
  action: GlobalEditAction;
}

interface Props {
  /** Whether "Selected items only" can be ticked at all. */
  hasSelection: boolean;
  onOk: (r: GlobalEditResult) => void;
  onCancel: () => void;
}

/** A checkbox that also carries an indeterminate state (wxCHK_3STATE). */
type Tri = 'indeterminate' | 'yes' | 'no';

const INDETERMINATE = '-- leave unchanged --';

/** LINE_STYLE, in the dropdown's order. */
const LINE_STYLES = ['default', 'solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'];

/** SPIN_STYLE, in the orientation dropdown's order. */
const ORIENTATIONS = ['Right', 'Up', 'Left', 'Down'];

const triValue = (t: Tri): boolean | undefined => (t === 'indeterminate' ? undefined : t === 'yes');

function TriCheck({
  label,
  value,
  onChange,
  note,
}: {
  label: string;
  value: Tri;
  onChange: (t: Tri) => void;
  note?: string;
}): JSX.Element {
  // Click cycles indeterminate → yes → no, the order wx gives a 3-state box.
  const next: Record<Tri, Tri> = { indeterminate: 'yes', yes: 'no', no: 'indeterminate' };
  return (
    <label className="row">
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = value === 'indeterminate';
        }}
        checked={value === 'yes'}
        onChange={() => onChange(next[value])}
      />
      <span>{label}</span>
      {note && <span className="ze-muted">{note}</span>}
    </label>
  );
}

export function DialogGlobalEditTextAndGraphics({
  hasSelection,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [scope, setScope] = useState<GlobalEditScope>({
    references: false,
    values: false,
    otherFields: false,
    wires: false,
    buses: false,
    globalLabels: false,
    hierLabels: false,
    labelFields: false,
    sheetTitles: false,
    sheetFields: false,
    sheetPins: false,
    sheetBorders: false,
    schTextAndGraphics: false,
  });
  const tick = (k: keyof GlobalEditScope) => (
    <label className="row">
      <input
        type="checkbox"
        checked={scope[k]}
        onChange={(e) => setScope((s) => ({ ...s, [k]: e.target.checked }))}
      />
      <span>{SCOPE_LABELS[k]}</span>
    </label>
  );

  // Filters. Typing in a filter ticks its checkbox, as the dialog's
  // OnReferenceFilterText and friends do.
  const [fieldNameOpt, setFieldNameOpt] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [refOpt, setRefOpt] = useState(false);
  const [reference, setReference] = useState('');
  const [libIdOpt, setLibIdOpt] = useState(false);
  const [libId, setLibId] = useState('');
  const [typeOpt, setTypeOpt] = useState(false);
  const [symbolType, setSymbolType] = useState<'normal' | 'power'>('normal');
  const [netOpt, setNetOpt] = useState(false);
  const [net, setNet] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);

  // Action.
  const [textSize, setTextSize] = useState('');
  const [bold, setBold] = useState<Tri>('indeterminate');
  const [italic, setItalic] = useState<Tri>('indeterminate');
  const [orientation, setOrientation] = useState(INDETERMINATE);
  const [hAlign, setHAlign] = useState(INDETERMINATE);
  const [vAlign, setVAlign] = useState(INDETERMINATE);
  const [visible, setVisible] = useState<Tri>('indeterminate');
  const [showFieldNames, setShowFieldNames] = useState<Tri>('indeterminate');
  const [lineWidth, setLineWidth] = useState('');
  const [lineStyle, setLineStyle] = useState(INDETERMINATE);
  const [junctionSize, setJunctionSize] = useState('');

  const numeric = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? mmToIU(n) : undefined;
  };

  const submit = (): void => {
    onOk({
      scope,
      filters: {
        ...(fieldNameOpt && fieldName ? { fieldName } : {}),
        ...(refOpt && reference ? { reference } : {}),
        ...(libIdOpt && libId ? { symbolLibId: libId } : {}),
        ...(typeOpt ? { symbolType } : {}),
        ...(netOpt && net ? { net } : {}),
        selectedOnly,
      },
      action: {
        ...(numeric(textSize) !== undefined ? { textSizeIU: numeric(textSize) } : {}),
        ...(triValue(bold) !== undefined ? { bold: triValue(bold) } : {}),
        ...(triValue(italic) !== undefined ? { italic: triValue(italic) } : {}),
        ...(orientation !== INDETERMINATE
          ? { orientation: ORIENTATIONS.indexOf(orientation) }
          : {}),
        ...(hAlign !== INDETERMINATE ? { hAlign: hAlign as 'left' | 'center' | 'right' } : {}),
        ...(vAlign !== INDETERMINATE ? { vAlign: vAlign as 'top' | 'center' | 'bottom' } : {}),
        ...(triValue(visible) !== undefined ? { visible: triValue(visible) } : {}),
        ...(triValue(showFieldNames) !== undefined
          ? { showFieldNames: triValue(showFieldNames) }
          : {}),
        ...(numeric(lineWidth) !== undefined ? { lineWidthIU: numeric(lineWidth) } : {}),
        ...(lineStyle !== INDETERMINATE ? { lineStyle } : {}),
        ...(numeric(junctionSize) !== undefined ? { junctionSizeIU: numeric(junctionSize) } : {}),
      },
    });
  };

  const choice = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: string[],
    note?: string,
  ): JSX.Element => (
    <label className="row">
      <span>{label}</span>
      <select className="ze-select" value={value} onChange={(e) => set(e.target.value)}>
        <option value={INDETERMINATE}>{INDETERMINATE}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {note && <span className="ze-muted">{note}</span>}
    </label>
  );

  const sizeField = (label: string, value: string, set: (v: string) => void): JSX.Element => (
    <label className="row">
      <span>{label}</span>
      <input
        className="ze-search"
        style={{ width: 90 }}
        value={value}
        placeholder="—"
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span className="ze-muted">mm</span>
    </label>
  );

  const filterRow = (
    label: string,
    on: boolean,
    setOn: (b: boolean) => void,
    value: string,
    set: (v: string) => void,
  ): JSX.Element => (
    <label className="row">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span>{label}</span>
      <input
        className="ze-search"
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setOn(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-label-dialog"
        style={{ minWidth: 560 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Edit Text and Graphic Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          <fieldset className="ze-props-group">
            <legend>Scope</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
              <div>
                {tick('references')}
                {tick('values')}
                {tick('otherFields')}
              </div>
              <div>
                {tick('wires')}
                {tick('buses')}
                {tick('globalLabels')}
                {tick('hierLabels')}
                {tick('labelFields')}
              </div>
              <div>
                {tick('sheetTitles')}
                {tick('sheetFields')}
                {tick('sheetPins')}
                {tick('sheetBorders')}
                {tick('schTextAndGraphics')}
              </div>
            </div>
          </fieldset>

          <fieldset className="ze-props-group">
            <legend>Filters</legend>
            {filterRow('By field name:', fieldNameOpt, setFieldNameOpt, fieldName, setFieldName)}
            {filterRow(
              'By parent reference designator:',
              refOpt,
              setRefOpt,
              reference,
              setReference,
            )}
            {filterRow('By parent symbol library id:', libIdOpt, setLibIdOpt, libId, setLibId)}
            <label className="row">
              <input
                type="checkbox"
                checked={typeOpt}
                onChange={(e) => setTypeOpt(e.target.checked)}
              />
              <span>By parent symbol type:</span>
              <select
                className="ze-select"
                value={symbolType}
                onChange={(e) => {
                  setSymbolType(e.target.value as 'normal' | 'power');
                  setTypeOpt(true);
                }}
              >
                <option value="normal">Non-power symbols</option>
                <option value="power">Power symbols</option>
              </select>
            </label>
            {filterRow('By net:', netOpt, setNetOpt, net, setNet)}
            <label className="row">
              <input
                type="checkbox"
                checked={selectedOnly}
                disabled={!hasSelection}
                onChange={(e) => setSelectedOnly(e.target.checked)}
              />
              <span>Selected items only</span>
            </label>
          </fieldset>

          <fieldset className="ze-props-group">
            <legend>Action</legend>
            {sizeField('Text size:', textSize, setTextSize)}
            <div className="row">
              <TriCheck label="Bold" value={bold} onChange={setBold} />
              <TriCheck label="Italic" value={italic} onChange={setItalic} />
            </div>
            {choice('Orientation:', orientation, setOrientation, ORIENTATIONS, '(labels only)')}
            {choice('H Align:', hAlign, setHAlign, ['left', 'center', 'right'], '(fields only)')}
            {choice('V Align:', vAlign, setVAlign, ['top', 'center', 'bottom'], '(fields only)')}
            <TriCheck label="Visible" value={visible} onChange={setVisible} note="(fields only)" />
            <TriCheck
              label="Show field name"
              value={showFieldNames}
              onChange={setShowFieldNames}
              note="(fields only)"
            />
            {sizeField('Line width:', lineWidth, setLineWidth)}
            {choice('Line style:', lineStyle, setLineStyle, LINE_STYLES)}
            {sizeField('Junction size:', junctionSize, setJunctionSize)}
          </fieldset>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

const SCOPE_LABELS: Record<keyof GlobalEditScope, string> = {
  references: 'Reference designators',
  values: 'Values',
  otherFields: 'Other symbol fields',
  wires: 'Wires & wire labels',
  buses: 'Buses & bus labels',
  globalLabels: 'Global labels',
  hierLabels: 'Hierarchical labels',
  labelFields: 'Label fields',
  sheetTitles: 'Sheet titles',
  sheetFields: 'Other sheet fields',
  sheetPins: 'Sheet pins',
  sheetBorders: 'Sheet borders & backgrounds',
  schTextAndGraphics: 'Schematic text & graphics',
};

/** Exported for the editor, which shows the current text size as the hint. */
export const mmText = (iu: number): string => String(iuToMM(iu));
