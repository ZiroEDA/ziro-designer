// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sheet Properties. Counterpart: `eeschema/dialogs/dialog_sheet_properties.cpp`
 * (DIALOG_SHEET_PROPERTIES) over the shared fields grid
 * (`fields_grid_table.cpp`).
 *
 * The sheet name and file name are not special-cased controls upstream: they are
 * the two mandatory rows of the fields grid, "Sheetname" and "Sheetfile", which
 * is why the dialog can carry user fields alongside them at all. This shows the
 * columns the sheet variant shows, `ShowHideColumns("0 1 2 3 4 5 6 7")`: Name,
 * Value, Show, Show Name, H Align, V Align, Italic, Bold. Sheets have no
 * transform, so the effective justification is the stored one and the alignment
 * cells are plain.
 *
 * Below the grid: border width and colour, background fill colour, the page
 * number for this instance, the hierarchical path (read-only), and the same
 * four attributes a symbol carries.
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { SchField, TextEffects } from '@ziroeda/eeschema';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** The two rows that always exist and cannot be renamed, deleted or reordered
 *  (SCH_SHEET's mandatory fields). */
const SHEETNAME = 'Sheetname';
const SHEETFILE = 'Sheetfile';
const isMandatory = (key: string): boolean => key === SHEETNAME || key === SHEETFILE;

export interface SheetFieldRow {
  key: string;
  value: string;
  effects: TextEffects;
  nameShown: boolean;
  source?: SchField['source'];
}

export interface SheetPropsResult {
  fields: SheetFieldRow[];
  borderWidthIU: number;
  borderColor?: ItemColor;
  backgroundColor?: ItemColor;
  pageNumber: string;
  excludeFromSim: boolean;
  excludeFromBom: boolean;
  excludeFromBoard: boolean;
  dnp: boolean;
}

interface Props {
  initial: SheetPropsResult;
  /** `SCH_SHEET_PATH::PathHumanReadable`, shown read-only. */
  hierarchicalPath: string;
  onOk: (r: SheetPropsResult) => void;
  onCancel: () => void;
}

const H_ALIGN = ['left', 'center', 'right'] as const;
const V_ALIGN = ['top', 'center', 'bottom'] as const;

/** The horizontal/vertical tokens of `(justify …)`, defaulted to centre. */
function alignOf(fx: TextEffects, axis: 'h' | 'v'): string {
  const set = axis === 'h' ? H_ALIGN : V_ALIGN;
  return (fx.justify ?? []).find((t) => (set as readonly string[]).includes(t)) ?? 'center';
}

/** Rebuild `(justify …)` from the two axes, dropping the centres KiCad omits. */
function withAlign(fx: TextEffects, h: string, v: string): TextEffects {
  const tokens = [h, v].filter((t) => t !== 'center');
  const { justify: _drop, ...rest } = fx;
  return tokens.length ? { ...rest, justify: tokens } : rest;
}

export function DialogSheetProperties({
  initial,
  hierarchicalPath,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [rows, setRows] = useState<SheetFieldRow[]>(initial.fields.map((f) => ({ ...f })));
  const [selRow, setSelRow] = useState(0);
  const [borderWidth, setBorderWidth] = useState(
    initial.borderWidthIU === 0 ? '0' : String(iuToMM(initial.borderWidthIU)),
  );
  const [borderColor, setBorderColor] = useState(initial.borderColor);
  const [background, setBackground] = useState(initial.backgroundColor);
  const [pageNumber, setPageNumber] = useState(initial.pageNumber);
  const [excludeFromSim, setExcludeFromSim] = useState(initial.excludeFromSim);
  const [excludeFromBom, setExcludeFromBom] = useState(initial.excludeFromBom);
  const [excludeFromBoard, setExcludeFromBoard] = useState(initial.excludeFromBoard);
  const [dnp, setDnp] = useState(initial.dnp);
  const [error, setError] = useState<string | null>(null);

  const patchRow = (i: number, patch: Partial<SheetFieldRow>): void =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const patchEffects = (i: number, patch: Partial<TextEffects>): void =>
    setRows((rs) =>
      rs.map((r, k) => (k === i ? { ...r, effects: { ...r.effects, ...patch } } : r)),
    );

  /** OnAddField: a new field is "Field<n>", starts hidden, and is selected. */
  const addField = (): void => {
    setRows((rs) => {
      const n = rs.length;
      return [...rs, { key: `Field${n}`, value: '', effects: { hidden: true }, nameShown: false }];
    });
    setSelRow(rows.length);
  };
  const deleteField = (): void => {
    const r = rows[selRow];
    if (!r || isMandatory(r.key)) return;
    setRows((rs) => rs.filter((_, i) => i !== selRow));
    setSelRow((i) => Math.max(0, i - 1));
  };
  /** Move up/down, never past the mandatory rows at the top. */
  const move = (delta: number): void => {
    const to = selRow + delta;
    const from = rows[selRow];
    const dest = rows[to];
    if (!from || !dest || isMandatory(from.key) || isMandatory(dest.key)) return;
    setRows((rs) => {
      const out = rs.slice();
      out[selRow] = dest;
      out[to] = from;
      return out;
    });
    setSelRow(to);
  };

  const submit = (): void => {
    const name = rows.find((r) => r.key === SHEETNAME)?.value.trim() ?? '';
    if (!name) {
      // OnOkClick: a sheet must be named, the file name may be blank.
      setError('A sheet must have a name');
      return;
    }
    const seen = new Set<string>();
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) {
        setError('Fields must have a name');
        return;
      }
      // FieldNamesAreDuplicates: two fields may not share a name.
      if (seen.has(key)) {
        setError(`The field name "${key}" is used more than once`);
        return;
      }
      seen.add(key);
    }
    onOk({
      fields: rows.map((r) => ({ ...r, key: r.key.trim() })),
      borderWidthIU: mmToIU(Number(borderWidth) || 0),
      ...(borderColor ? { borderColor } : {}),
      ...(background ? { backgroundColor: background } : {}),
      pageNumber: pageNumber.trim(),
      excludeFromSim,
      excludeFromBom,
      excludeFromBoard,
      dnp,
    });
  };

  const swatch = (
    label: string,
    value: ItemColor | undefined,
    set: (c: ItemColor | undefined) => void,
  ): JSX.Element => (
    <label className="row">
      <span>{label}</span>
      {/* COLOR_SWATCH: it draws the colour and opens DIALOG_COLOR_PICKER
          (color_swatch.cpp:301-328). It was an <input type="color">,
          i.e. the desktop's picker as a popup anchored to the control -
          off-screen near the window edge, and unable to carry alpha. */}
      <ColorSwatch
        label={label}
        color={itemColorToColor4d(value)}
        onChange={(c) => set(color4dToItemColor(c))}
      />
      <button
        className="ze-btn"
        style={{ fontSize: 11 }}
        title="Clear color to use Schematic Editor colors."
        disabled={!value}
        onClick={() => set(undefined)}
      >
        Clear
      </button>
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-props-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Sheet Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-props-body">
          {error && (
            <div className="ze-props-error" onClick={() => setError(null)}>
              {error}, click to dismiss
            </div>
          )}

          <div className="ze-props-grid-wrap">
            <table className="ze-props-grid">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Show</th>
                  <th>Show Name</th>
                  <th>H Align</th>
                  <th>V Align</th>
                  <th>Italic</th>
                  <th>Bold</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are reordered by index
                  <tr key={i} className={i === selRow ? 'sel' : ''} onClick={() => setSelRow(i)}>
                    <td>
                      {isMandatory(row.key) ? (
                        <span className="ze-cell-ro">{row.key}</span>
                      ) : (
                        <input
                          className="ze-cell-input"
                          value={row.key}
                          onChange={(e) => patchRow(i, { key: e.target.value })}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        className="ze-cell-input"
                        // biome-ignore lint/a11y/noAutofocus: matches m_delayedFocusColumn = FDC_VALUE
                        autoFocus={i === 0}
                        value={row.value}
                        onChange={(e) => patchRow(i, { value: e.target.value })}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="c">
                      <input
                        type="checkbox"
                        checked={!row.effects.hidden}
                        onChange={(e) => patchEffects(i, { hidden: !e.target.checked })}
                      />
                    </td>
                    <td className="c">
                      <input
                        type="checkbox"
                        checked={row.nameShown}
                        onChange={(e) => patchRow(i, { nameShown: e.target.checked })}
                      />
                    </td>
                    <td>
                      <select
                        className="ze-cell-select"
                        value={alignOf(row.effects, 'h')}
                        onChange={(e) =>
                          patchRow(i, {
                            effects: withAlign(
                              row.effects,
                              e.target.value,
                              alignOf(row.effects, 'v'),
                            ),
                          })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="ze-cell-select"
                        value={alignOf(row.effects, 'v')}
                        onChange={(e) =>
                          patchRow(i, {
                            effects: withAlign(
                              row.effects,
                              alignOf(row.effects, 'h'),
                              e.target.value,
                            ),
                          })
                        }
                      >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </td>
                    <td className="c">
                      <input
                        type="checkbox"
                        checked={!!row.effects.italic}
                        onChange={(e) => patchEffects(i, { italic: e.target.checked || undefined })}
                      />
                    </td>
                    <td className="c">
                      <input
                        type="checkbox"
                        checked={!!row.effects.bold}
                        onChange={(e) => patchEffects(i, { bold: e.target.checked || undefined })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ze-props-rowbtns">
            <button className="ze-btn" title="Add field" onClick={addField}>
              +
            </button>
            <button
              className="ze-btn"
              title="Delete field"
              disabled={!rows[selRow] || isMandatory(rows[selRow]!.key)}
              onClick={deleteField}
            >
              −
            </button>
            <button className="ze-btn" title="Move up" onClick={() => move(-1)}>
              ↑
            </button>
            <button className="ze-btn" title="Move down" onClick={() => move(1)}>
              ↓
            </button>
          </div>

          <div className="ze-props-columns">
            <fieldset className="ze-props-group">
              <legend>Border</legend>
              <label className="row">
                <span>Width:</span>
                <input
                  className="ze-search"
                  style={{ width: 90 }}
                  value={borderWidth}
                  onChange={(e) => setBorderWidth(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <span className="ze-muted">mm</span>
              </label>
              {swatch('Color:', borderColor, setBorderColor)}
            </fieldset>

            <fieldset className="ze-props-group">
              <legend>Fill</legend>
              {swatch('Color:', background, setBackground)}
            </fieldset>

            <fieldset className="ze-props-group">
              <legend>Attributes</legend>
              <label className="row">
                <input
                  type="checkbox"
                  checked={excludeFromSim}
                  onChange={(e) => setExcludeFromSim(e.target.checked)}
                />
                <span>Exclude from simulation</span>
              </label>
              <label
                className="row"
                title={
                  'This is useful for adding symbols for board footprints such as fiducials\n' +
                  'and logos that you do not want to appear in the bill of materials export'
                }
              >
                <input
                  type="checkbox"
                  checked={excludeFromBom}
                  onChange={(e) => setExcludeFromBom(e.target.checked)}
                />
                <span>Exclude from bill of materials</span>
              </label>
              <label
                className="row"
                title={
                  'This is useful for adding symbols that only get exported to the bill of materials but\n' +
                  'not required to layout the board such as mechanical fasteners and enclosures'
                }
              >
                <input
                  type="checkbox"
                  checked={excludeFromBoard}
                  onChange={(e) => setExcludeFromBoard(e.target.checked)}
                />
                <span>Exclude from board</span>
              </label>
              <label className="row">
                <input type="checkbox" checked={dnp} onChange={(e) => setDnp(e.target.checked)} />
                <span>Do not populate</span>
              </label>
            </fieldset>
          </div>

          <label className="row">
            <span>Page number:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={pageNumber}
              onChange={(e) => setPageNumber(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
          </label>
          <label className="row">
            <span>Hierarchical path:</span>
            <span className="ze-cell-ro">{hierarchicalPath}</span>
          </label>
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
