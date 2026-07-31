// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Teardrops dialog. Counterpart: `pcbnew/dialogs/dialog_global_edit_teardrops.cpp`
 * over `dialog_global_edit_teardrops_base.cpp`'s layout — three static boxes,
 * Scope and Filter Items side by side above Action, with OK/Cancel.
 *
 * The three-state checkboxes in the "specified values" block are real: leaving
 * one indeterminate means "do not touch this field on the items I edit", which
 * is the only way to change one property across a board without flattening the
 * rest. A plain two-state checkbox would silently rewrite every other field.
 *
 * The decision logic lives in `pcbnew/src/teardrop_global_edit.ts`; this file is
 * only the controls.
 */

import { useState, type JSX } from 'react';
import type {
  GlobalTeardropEditOptions,
  TeardropEditAction,
} from '@ziroeda/pcbnew/src/teardrop_global_edit.js';
import { DEFAULT_GLOBAL_TEARDROP_EDIT } from '@ziroeda/pcbnew/src/teardrop_global_edit.js';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';

interface Props {
  /** Net codes and names for the "Filter items by net" choice. */
  nets: ReadonlyMap<number, string>;
  /** Copper layer names for the layer filter. */
  layers: readonly string[];
  /** Netclass names for the netclass filter. */
  netclasses: readonly string[];
  /** Whether anything is selected; gates "Selected items only". */
  hasSelection: boolean;
  /** The project's remembered `teardrop_options` scope flags. */
  initialScope?: Pick<
    GlobalTeardropEditOptions,
    'pthPads' | 'smdPads' | 'vias' | 'trackToTrack' | 'roundPadsOnly'
  >;
  /** Open Board Setup on the Teardrops page. */
  onEditDefaults?: () => void;
  onApply: (options: GlobalTeardropEditOptions) => void;
  onClose: () => void;
}

/** A three-state control's value: on, off, or "leave alone". */
type Tri = boolean | undefined;

const nextTri = (v: Tri): Tri => (v === undefined ? true : v ? false : undefined);
const triLabel = (v: Tri): string => (v === undefined ? '—' : v ? '✓' : '');

export function DialogGlobalEditTeardrops({
  nets,
  layers,
  netclasses,
  hasSelection,
  initialScope,
  onEditDefaults,
  onApply,
  onClose,
}: Props): JSX.Element {
  const [opts, setOpts] = useState<GlobalTeardropEditOptions>({
    ...DEFAULT_GLOBAL_TEARDROP_EDIT,
    ...initialScope,
  });

  // The "specified values" fields, held as strings so a half-typed number does
  // not snap back under the caret.
  const [preferZone, setPreferZone] = useState<Tri>(undefined);
  const [twoTracks, setTwoTracks] = useState<Tri>(undefined);
  const [curvedEdges, setCurvedEdges] = useState<Tri>(undefined);
  const [widthLimit, setWidthLimit] = useState('');
  const [bestLength, setBestLength] = useState('');
  const [maxLength, setMaxLength] = useState('');
  const [bestWidth, setBestWidth] = useState('');
  const [maxWidth, setMaxWidth] = useState('');

  const set = (patch: Partial<GlobalTeardropEditOptions>): void =>
    setOpts((prev) => ({ ...prev, ...patch }));

  const specifiedEnabled = opts.action === 'specified';

  /** Collect the non-blank "specified" fields; a blank one stays indeterminate. */
  const buildSpecified = (): GlobalTeardropEditOptions['specified'] => {
    const out: NonNullable<GlobalTeardropEditOptions['specified']> = {};

    if (preferZone !== undefined) out.tdOnPadsInZones = !preferZone;
    if (twoTracks !== undefined) out.allowUseTwoTracks = twoTracks;
    if (curvedEdges !== undefined) out.curvedEdges = curvedEdges;

    const pct = (s: string): number | undefined => {
      const v = Number(s);
      return s.trim() === '' || Number.isNaN(v) ? undefined : v / 100;
    };
    const mm = (s: string): number | undefined => {
      const v = Number(s);
      return s.trim() === '' || Number.isNaN(v) ? undefined : pcbMmToIU(v);
    };

    const wl = pct(widthLimit);
    if (wl !== undefined) out.widthtoSizeFilterRatio = wl;
    const bl = pct(bestLength);
    if (bl !== undefined) out.bestLengthRatio = bl;
    const bw = pct(bestWidth);
    if (bw !== undefined) out.bestWidthRatio = bw;
    const ml = mm(maxLength);
    if (ml !== undefined) out.tdMaxLen = ml;
    const mw = mm(maxWidth);
    if (mw !== undefined) out.tdMaxWidth = mw;

    return out;
  };

  const apply = (): void => {
    onApply({ ...opts, specified: specifiedEnabled ? buildSpecified() : {} });
  };

  const check = (
    key: 'pthPads' | 'smdPads' | 'vias' | 'trackToTrack',
    label: string,
  ): JSX.Element => (
    <label>
      <input
        type="checkbox"
        checked={opts[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<GlobalTeardropEditOptions>)}
      />
      {label}
    </label>
  );

  const radio = (value: TeardropEditAction, label: string, title?: string): JSX.Element => (
    <label title={title}>
      <input
        type="radio"
        name="td-action"
        checked={opts.action === value}
        onChange={() => set({ action: value })}
      />
      {label}
    </label>
  );

  const triBox = (v: Tri, setV: (n: Tri) => void, label: string, title?: string): JSX.Element => (
    <label className={specifiedEnabled ? '' : 'disabled'} title={title}>
      <button
        type="button"
        className="ze-tristate"
        disabled={!specifiedEnabled}
        aria-checked={v === undefined ? 'mixed' : v}
        role="checkbox"
        onClick={() => setV(nextTri(v))}
      >
        {triLabel(v)}
      </button>
      {label}
    </label>
  );

  const field = (
    value: string,
    setValue: (s: string) => void,
    label: string,
    unit: string,
    title?: string,
  ): JSX.Element => (
    <label className={specifiedEnabled ? '' : 'disabled'} title={title}>
      <span className="ze-td-label">{label}</span>
      <input
        type="text"
        className="ze-td-input"
        value={value}
        disabled={!specifiedEnabled}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
      />
      <span className="ze-td-unit">{unit}</span>
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-teardrops-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Edit Teardrops
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-teardrops-body">
          <div className="ze-teardrops-top">
            <fieldset>
              <legend>Scope</legend>
              {check('pthPads', 'PTH pads')}
              {check('smdPads', 'SMD pads')}
              {check('vias', 'Vias')}
              {check('trackToTrack', 'Track to track')}
            </fieldset>

            <fieldset>
              <legend>Filter Items</legend>
              <label>
                <input
                  type="checkbox"
                  checked={opts.netFilter != null}
                  onChange={(e) => set({ netFilter: e.target.checked ? 0 : null })}
                />
                Filter items by net:
                <select
                  value={opts.netFilter ?? 0}
                  disabled={opts.netFilter == null}
                  onChange={(e) => set({ netFilter: Number(e.target.value) })}
                >
                  {[...nets.entries()].map(([code, name]) => (
                    <option key={code} value={code}>
                      {name === '' ? '<no net>' : name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={opts.netclassFilter != null}
                  onChange={(e) =>
                    set({ netclassFilter: e.target.checked ? (netclasses[0] ?? null) : null })
                  }
                />
                Filter items by net class:
                <select
                  value={opts.netclassFilter ?? ''}
                  disabled={opts.netclassFilter == null}
                  onChange={(e) => set({ netclassFilter: e.target.value })}
                >
                  {netclasses.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={opts.layerFilter != null}
                  onChange={(e) =>
                    set({ layerFilter: e.target.checked ? (layers[0] ?? null) : null })
                  }
                />
                Filter items by layer:
                <select
                  value={opts.layerFilter ?? ''}
                  disabled={opts.layerFilter == null}
                  onChange={(e) => set({ layerFilter: e.target.value })}
                >
                  {layers.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={opts.roundPadsOnly ?? false}
                  onChange={(e) => set({ roundPadsOnly: e.target.checked })}
                />
                Round pads only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={opts.existingOnly ?? false}
                  onChange={(e) => set({ existingOnly: e.target.checked })}
                />
                Existing teardrops only
              </label>
              <label className={hasSelection ? '' : 'disabled'}>
                <input
                  type="checkbox"
                  checked={opts.selectedOnly ?? false}
                  disabled={!hasSelection}
                  onChange={(e) => set({ selectedOnly: e.target.checked })}
                />
                Selected items only
              </label>
            </fieldset>
          </div>

          <fieldset>
            <legend>Action</legend>
            {radio('remove', 'Remove teardrops', 'Remove teardrops according to filtering options')}
            {radio(
              'removeAll',
              'Remove all teardrops',
              'Remove all teardrops, regardless of filtering options',
            )}
            <div className="ze-td-row">
              {radio('addDefaults', 'Add teardrops with default values for shape')}
              <button
                type="button"
                className="ze-link"
                disabled={!onEditDefaults}
                onClick={onEditDefaults}
              >
                Edit default values in Board Setup
              </button>
            </div>
            {radio('specified', 'Add teardrops with specified values:')}

            <div className="ze-td-specified">
              {triBox(
                preferZone,
                setPreferZone,
                'Prefer zone connection',
                'Do not create teardrops on tracks connected to pads that are also connected to a copper zone.',
              )}
              {triBox(
                twoTracks,
                setTwoTracks,
                'Allow teardrops to span two track segments',
                'Allows a teardrop to extend over the first 2 connected track segments if the first track segment is too short to accommodate the best length.',
              )}
              {field(
                widthLimit,
                setWidthLimit,
                'Track width limit:',
                '%',
                'Max pad/via size to track width ratio to create a teardrop.\n100 always creates a teardrop.',
              )}
              <div className="ze-td-note">
                Tracks which are similar in size to the pad or via do not need teardrops.
              </div>
              <div className="ze-td-note">(as a percentage of pad/via minor dimension)</div>
              {field(bestLength, setBestLength, 'Best length (L):', '%')}
              {field(maxLength, setMaxLength, 'Maximum length (L):', 'mm')}
              {field(bestWidth, setBestWidth, 'Best width (W):', '%')}
              {field(maxWidth, setMaxWidth, 'Maximum width (W):', 'mm')}
              {triBox(curvedEdges, setCurvedEdges, 'Curved edges')}
            </div>
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={apply}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/** Millimetre text for a stored IU value, for callers pre-filling the fields. */
export const teardropMm = (iu: number): string => String(pcbIuToMM(iu));
