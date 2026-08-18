// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sheet pin properties. Counterpart:
 * `eeschema/dialogs/dialog_sheet_pin_properties.cpp`
 * (DIALOG_SHEET_PIN_PROPERTIES).
 *
 * A sheet pin is the parent sheet's end of a hierarchical connection: its name
 * has to match a hierarchical label inside the sheet, which is why the name is
 * the first and most prominent control. The shape is the electrical direction
 * drawn as the flag's outline, and is the same set a hierarchical label offers.
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { LabelShape, TextEffects } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** The flag shapes, in the dialog's order (LABEL_FLAG_SHAPE). */
const SHAPES: { value: LabelShape; label: string }[] = [
  { value: 'input', label: 'Input' },
  { value: 'output', label: 'Output' },
  { value: 'bidirectional', label: 'Bidirectional' },
  { value: 'tri_state', label: 'Tri-state' },
  { value: 'passive', label: 'Passive' },
];

/** DEFAULT_SIZE_TEXT, 50 mil. */
const DEFAULT_TEXT_SIZE = mmToIU(1.27);

export interface SheetPinPropsResult {
  name: string;
  shape: LabelShape;
  effects: TextEffects;
}

interface Props {
  initial: SheetPinPropsResult;
  onOk: (r: SheetPinPropsResult) => void;
  onCancel: () => void;
}

export function DialogSheetPinProperties({ initial, onOk, onCancel }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [name, setName] = useState(initial.name);
  const [shape, setShape] = useState<LabelShape>(initial.shape);
  const [size, setSize] = useState(
    String(iuToMM(initial.effects.fontSize?.[0] ?? DEFAULT_TEXT_SIZE)),
  );
  const [bold, setBold] = useState(!!initial.effects.bold);
  const [italic, setItalic] = useState(!!initial.effects.italic);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      // A nameless pin can never match a hierarchical label, so it would be a
      // permanent ERC violation.
      setError('Sheet pins must have a name');
      return;
    }
    const sizeIU = mmToIU(Number(size) || 0) || DEFAULT_TEXT_SIZE;
    onOk({
      name: trimmed,
      shape,
      effects: {
        ...initial.effects,
        fontSize: [sizeIU, sizeIU],
        ...(bold ? { bold: true } : {}),
        ...(italic ? { italic: true } : {}),
      },
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Sheet Pin Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {error && (
            <div className="ze-props-error" onClick={() => setError(null)}>
              {error}, click to dismiss
            </div>
          )}
          <label className="row">
            <span>Name:</span>
            <input
              className="ze-search"
              // biome-ignore lint/a11y/noAutofocus: the name is the dialog's focus upstream
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
          </label>
          <label className="row">
            <span>Shape:</span>
            <select
              className="ze-select"
              value={shape}
              onChange={(e) => setShape(e.target.value as LabelShape)}
            >
              {SHAPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="ze-props-group">
            <legend>Formatting</legend>
            <label className="row">
              <span>Text size:</span>
              <input
                className="ze-search"
                style={{ width: 80 }}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="ze-muted">mm</span>
            </label>
            <label className="row">
              <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
              <span>Bold</span>
              <input
                type="checkbox"
                checked={italic}
                onChange={(e) => setItalic(e.target.checked)}
              />
              <span>Italic</span>
            </label>
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
