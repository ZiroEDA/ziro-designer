// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table Cell Properties. Counterpart: `DIALOG_TABLECELL_PROPERTIES`.
 *
 * A thin renderer over `table_cell_props.ts`, which holds the rule the dialog
 * turns on: a property the selected cells disagree on is **indeterminate**, and
 * an indeterminate property is left alone on OK rather than flattened.
 *
 * Here that shows up as three-state checkboxes (`indeterminate` on the DOM
 * node, which is not something a React `checked` prop can express) and as empty
 * number boxes — an empty box means "leave each cell as it is", so clearing one
 * is how you undo a change you have not committed yet.
 *
 * The text box is offered **only for a single cell**. Upstream shows it for a
 * multi-cell selection too and writes it to all of them, which is defensible
 * when a dialog has to show one string, and is still a way to flatten five
 * cells to one word by accident. One cell, one text box.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { applyCellProps, cellPropsFromSelection, type CellProps } from '@ziroeda/eeschema';
import type { SchTableCell } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  cells: readonly SchTableCell[];
  /** Format an internal-unit length for display, and parse it back. */
  fmt: (iu: number) => string;
  parse: (text: string) => number | null;
  onOk: (next: (cell: SchTableCell) => SchTableCell) => void;
  onCancel: () => void;
}

/** A checkbox with upstream's third state for "the cells disagree". */
function TriCheck({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === undefined;
  }, [value]);
  return (
    <label className="ze-check">
      <input
        ref={ref}
        type="checkbox"
        checked={value === true}
        // Cycles through the third state the way wxCHK_3STATE does, so a
        // property you did not mean to touch can be put back.
        onChange={() => onChange(value === undefined ? true : value ? false : undefined)}
      />
      {label}
    </label>
  );
}

function NumBox({
  label,
  value,
  fmt,
  parse,
  onChange,
}: {
  label: string;
  value: number | undefined;
  fmt: (iu: number) => string;
  parse: (t: string) => number | null;
  onChange: (v: number | undefined) => void;
}): JSX.Element {
  const [text, setText] = useState(value === undefined ? '' : fmt(value));
  return (
    <label className="ze-field">
      <span>{label}</span>
      <input
        className="ze-input"
        value={text}
        placeholder="—"
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value.trim() === '' ? null : parse(e.target.value);
          onChange(n === null ? undefined : n);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (v: T | undefined) => void;
}): JSX.Element {
  return (
    <label className="ze-field">
      <span>{label}</span>
      <select
        className="ze-input"
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      >
        {/* The empty option is the indeterminate one: picking it back leaves
            every selected cell as it was. */}
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DialogTableCellProperties({
  cells,
  fmt,
  parse,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const initial = useMemo(() => cellPropsFromSelection(cells), [cells]);
  const [props, setProps] = useState<CellProps>(() => ({}));
  const set = <K extends keyof CellProps>(k: K, v: CellProps[K]): void =>
    setProps((p) => ({ ...p, [k]: v }));
  const single = cells.length === 1;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Table Cell Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body" style={{ display: 'grid', gap: 8 }}>
          {single && (
            <label className="ze-field">
              <span>Text</span>
              <textarea
                className="ze-input"
                rows={3}
                defaultValue={initial.text ?? ''}
                onChange={(e) => set('text', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
          )}
          {!single && (
            <div className="ze-muted">
              {cells.length} cells selected. Their text is left alone; everything below applies to
              all of them.
            </div>
          )}

          <div className="row" style={{ gap: 12 }}>
            <TriCheck
              label="Bold"
              value={props.bold ?? initial.bold}
              onChange={(v) => set('bold', v)}
            />
            <TriCheck
              label="Italic"
              value={props.italic ?? initial.italic}
              onChange={(v) => set('italic', v)}
            />
          </div>

          <NumBox
            label="Text size"
            value={initial.textSize}
            fmt={fmt}
            parse={parse}
            onChange={(v) => set('textSize', v)}
          />

          <div className="row" style={{ gap: 8 }}>
            <Choice
              label="Horizontal"
              value={props.hAlign ?? initial.hAlign}
              options={['left', 'center', 'right'] as const}
              onChange={(v) => set('hAlign', v)}
            />
            <Choice
              label="Vertical"
              value={props.vAlign ?? initial.vAlign}
              options={['top', 'center', 'bottom'] as const}
              onChange={(v) => set('vAlign', v)}
            />
          </div>

          <div className="row" style={{ gap: 8 }}>
            <NumBox
              label="Margin left"
              value={initial.marginLeft}
              fmt={fmt}
              parse={parse}
              onChange={(v) => set('marginLeft', v)}
            />
            <NumBox
              label="top"
              value={initial.marginTop}
              fmt={fmt}
              parse={parse}
              onChange={(v) => set('marginTop', v)}
            />
            <NumBox
              label="right"
              value={initial.marginRight}
              fmt={fmt}
              parse={parse}
              onChange={(v) => set('marginRight', v)}
            />
            <NumBox
              label="bottom"
              value={initial.marginBottom}
              fmt={fmt}
              parse={parse}
              onChange={(v) => set('marginBottom', v)}
            />
          </div>

          <div className="ze-muted">A blank box leaves that property as each cell has it.</div>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="ze-btn primary"
            onClick={() => onOk((cell) => applyCellProps(cell, props))}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
