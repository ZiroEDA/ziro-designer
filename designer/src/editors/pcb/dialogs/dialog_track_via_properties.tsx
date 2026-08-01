// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track & Via Properties. Counterpart:
 * `pcbnew/dialogs/dialog_track_via_properties.cpp` over
 * `dialog_track_via_properties_base.cpp`'s layout — a Common box, then Tracks
 * and Vias boxes enabled only when the selection contains that kind, then the
 * via's teardrop box.
 *
 * Every control is three-state. A blank box means "the selection disagrees;
 * leave each item's own value alone", which is the only way one dialog can edit
 * a mixed selection without flattening it. Typing into a blank box arms it.
 *
 * The decision logic lives in `pcbnew/src/track_via_properties.ts`; this file is
 * only the controls.
 */

import { useMemo, useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type {
  TrackViaSelection,
  TrackViaValues,
} from '@ziroeda/pcbnew/src/track_via_properties.js';
import { collectTrackViaValues } from '@ziroeda/pcbnew/src/track_via_properties.js';

interface Props {
  selection: TrackViaSelection;
  /** Net codes and names, for the Net choice. */
  nets: ReadonlyMap<number, string>;
  /** Copper layer names. */
  layers: readonly string[];
  /** `(setup (track_width_list …))` in IU, the "Pre-defined sizes" list. */
  trackWidths: readonly number[];
  /** `(setup (via_size …))` pairs in IU. */
  viaSizes: readonly { diameter: number; drill: number }[];
  onApply: (values: TrackViaValues) => void;
  onClose: () => void;
}

/** A field's text: '' is INDETERMINATE, as upstream's blank box is. */
type Text = string;

const mmText = (iu: number | undefined): Text => (iu === undefined ? '' : String(pcbIuToMM(iu)));
const numText = (v: number | undefined): Text => (v === undefined ? '' : String(v));

/** Read a millimetre box back, or undefined when it is blank or unparseable. */
const readMm = (s: Text): number | undefined => {
  if (s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? pcbMmToIU(v) : undefined;
};

const readNum = (s: Text): number | undefined => {
  if (s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

/** Three-state: on, off, or leave alone. */
type Tri = boolean | undefined;
const nextTri = (v: Tri): Tri => (v === undefined ? true : v ? false : undefined);
const triLabel = (v: Tri): string => (v === undefined ? '—' : v ? '✓' : '');

export function DialogTrackViaProperties({
  selection,
  nets,
  layers,
  trackWidths,
  viaSizes,
  onApply,
  onClose,
}: Props): JSX.Element {
  const seed = useMemo(() => collectTrackViaValues(selection), [selection]);

  const hasTracks = selection.tracks.length > 0 || selection.arcs.length > 0;
  const hasStraightTracks = selection.tracks.length > 0;
  const hasVias = selection.vias.length > 0;

  // ----- Common -----
  const [net, setNet] = useState<Text>(numText(seed.net));
  const [locked, setLocked] = useState<Tri>(seed.locked);

  // ----- Tracks -----
  const [startX, setStartX] = useState<Text>(mmText(seed.startX));
  const [startY, setStartY] = useState<Text>(mmText(seed.startY));
  const [endX, setEndX] = useState<Text>(mmText(seed.endX));
  const [endY, setEndY] = useState<Text>(mmText(seed.endY));
  const [trackWidth, setTrackWidth] = useState<Text>(mmText(seed.trackWidth));
  const [layer, setLayer] = useState<Text>(seed.layer ?? '');
  const [hasMask, setHasMask] = useState<Tri>(seed.hasMask);
  const [maskMargin, setMaskMargin] = useState<Text>(
    seed.maskMargin === undefined || seed.maskMargin === null
      ? ''
      : String(pcbIuToMM(seed.maskMargin)),
  );

  // ----- Vias -----
  const [viaX, setViaX] = useState<Text>(mmText(seed.viaX));
  const [viaY, setViaY] = useState<Text>(mmText(seed.viaY));
  const [viaDiameter, setViaDiameter] = useState<Text>(mmText(seed.viaDiameter));
  const [viaDrill, setViaDrill] = useState<Text>(mmText(seed.viaDrill));
  const [viaType, setViaType] = useState<Text>(seed.viaType ?? '');
  const [startLayer, setStartLayer] = useState<Text>(seed.startLayer ?? '');
  const [endLayer, setEndLayer] = useState<Text>(seed.endLayer ?? '');

  // ----- Teardrops -----
  const [tdEnabled, setTdEnabled] = useState<Tri>(seed.tdEnabled);
  const [tdTwoTracks, setTdTwoTracks] = useState<Tri>(seed.tdAllowTwoTracks);
  const [tdCurved, setTdCurved] = useState<Tri>(seed.tdCurvedEdges);
  const [tdMaxLen, setTdMaxLen] = useState<Text>(mmText(seed.tdMaxLen));
  const [tdMaxWidth, setTdMaxWidth] = useState<Text>(mmText(seed.tdMaxWidth));
  const [tdBestLen, setTdBestLen] = useState<Text>(numText(seed.tdBestLengthPct));
  const [tdBestWidth, setTdBestWidth] = useState<Text>(numText(seed.tdBestWidthPct));
  const [tdFilter, setTdFilter] = useState<Text>(numText(seed.tdFilterPct));

  const apply = (): void => {
    const v: TrackViaValues = {
      net: readNum(net),
      locked,
      startX: readMm(startX),
      startY: readMm(startY),
      endX: readMm(endX),
      endY: readMm(endY),
      trackWidth: readMm(trackWidth),
      layer: layer === '' ? undefined : layer,
      hasMask,
      // A blank margin box on an armed mask means "use the Board Setup value",
      // which the model spells as null rather than "leave alone".
      maskMargin:
        hasMask === undefined && maskMargin.trim() === ''
          ? undefined
          : (readMm(maskMargin) ?? null),
      viaX: readMm(viaX),
      viaY: readMm(viaY),
      viaDiameter: readMm(viaDiameter),
      viaDrill: readMm(viaDrill),
      viaType: viaType === '' ? undefined : (viaType as TrackViaValues['viaType']),
      startLayer: startLayer === '' ? undefined : startLayer,
      endLayer: endLayer === '' ? undefined : endLayer,
      tdEnabled,
      tdAllowTwoTracks: tdTwoTracks,
      tdCurvedEdges: tdCurved,
      tdMaxLen: readMm(tdMaxLen),
      tdMaxWidth: readMm(tdMaxWidth),
      tdBestLengthPct: readNum(tdBestLen),
      tdBestWidthPct: readNum(tdBestWidth),
      tdFilterPct: readNum(tdFilter),
    };
    onApply(v);
  };

  const field = (
    label: string,
    value: Text,
    setValue: (s: Text) => void,
    unit: string,
    disabled = false,
  ): JSX.Element => (
    <label className={disabled ? 'disabled' : ''}>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={value}
        disabled={disabled}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
      />
      <span className="ze-tvp-unit">{unit}</span>
    </label>
  );

  const tri = (v: Tri, setV: (n: Tri) => void, label: string, title?: string): JSX.Element => (
    <label title={title}>
      <button
        type="button"
        className="ze-tristate"
        role="checkbox"
        aria-checked={v === undefined ? 'mixed' : v}
        onClick={() => setV(nextTri(v))}
      >
        {triLabel(v)}
      </button>
      {label}
    </label>
  );

  /** A choice whose first entry is the blank "leave alone" row. */
  const choice = (
    label: string,
    value: Text,
    setValue: (s: Text) => void,
    options: readonly { value: string; label: string }[],
    disabled = false,
  ): JSX.Element => (
    <label className={disabled ? 'disabled' : ''}>
      <span className="ze-tvp-label">{label}</span>
      <select
        className="ze-tvp-select"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const layerOptions = layers.map((l) => ({ value: l, label: l }));

  const title = `${hasTracks ? 'Track' : ''}${hasTracks && hasVias ? ' & ' : ''}${
    hasVias ? 'Via' : ''
  } Properties`;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-tvp-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {title}
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Common</legend>
            {choice(
              'Net:',
              net,
              setNet,
              [...nets.entries()].map(([code, name]) => ({
                value: String(code),
                label: name === '' ? '<no net>' : name,
              })),
            )}
            {tri(locked, setLocked, 'Locked')}
          </fieldset>

          {hasTracks && (
            <fieldset>
              <legend>Tracks</legend>
              <div className="ze-tvp-row">
                {field('Start X:', startX, setStartX, 'mm', !hasStraightTracks)}
                {field('Y:', startY, setStartY, 'mm', !hasStraightTracks)}
              </div>
              <div className="ze-tvp-row">
                {field('End X:', endX, setEndX, 'mm', !hasStraightTracks)}
                {field('Y:', endY, setEndY, 'mm', !hasStraightTracks)}
              </div>
              {trackWidths.length > 0 &&
                choice(
                  'Pre-defined sizes:',
                  '',
                  (s) => {
                    if (s !== '') setTrackWidth(String(pcbIuToMM(Number(s))));
                  },
                  trackWidths.map((w) => ({ value: String(w), label: `${pcbIuToMM(w)} mm` })),
                )}
              {field('Track width:', trackWidth, setTrackWidth, 'mm')}
              {choice('Layer:', layer, setLayer, layerOptions)}

              <div className="ze-tvp-sub">Technical Layers</div>
              {tri(hasMask, setHasMask, 'Solder mask')}
              {field('Expansion:', maskMargin, setMaskMargin, 'mm', hasMask === false)}
              <div className="ze-tvp-note">
                Local clearance between the track and the solder mask opening. Leave blank to use
                the Board Setup value.
              </div>
            </fieldset>
          )}

          {hasVias && (
            <fieldset>
              <legend>Vias</legend>
              <div className="ze-tvp-row">
                {field('Position X:', viaX, setViaX, 'mm')}
                {field('Y:', viaY, setViaY, 'mm')}
              </div>
              {viaSizes.length > 0 &&
                choice(
                  'Pre-defined sizes:',
                  '',
                  (s) => {
                    if (s === '') return;
                    const size = viaSizes[Number(s)];
                    if (!size) return;
                    setViaDiameter(String(pcbIuToMM(size.diameter)));
                    setViaDrill(String(pcbIuToMM(size.drill)));
                  },
                  viaSizes.map((v, i) => ({
                    value: String(i),
                    label: `${pcbIuToMM(v.diameter)} / ${pcbIuToMM(v.drill)} mm`,
                  })),
                )}
              {field('Via diameter:', viaDiameter, setViaDiameter, 'mm')}
              {field('Via hole:', viaDrill, setViaDrill, 'mm')}
              {choice('Via type:', viaType, setViaType, [
                { value: 'through', label: 'Through' },
                { value: 'micro', label: 'Micro' },
                { value: 'blind', label: 'Blind/buried' },
              ])}
              {choice('Start layer:', startLayer, setStartLayer, layerOptions)}
              {choice('End layer:', endLayer, setEndLayer, layerOptions)}
            </fieldset>
          )}

          {hasVias && (
            <fieldset>
              <legend>Teardrops</legend>
              {tri(tdEnabled, setTdEnabled, "Add teardrops on via's track connections")}
              {tri(
                tdTwoTracks,
                setTdTwoTracks,
                'Allow teardrops to span two track segments',
                'Allows a teardrop to extend over the first 2 connected track segments if the first track segment is too short to accommodate the best length.',
              )}
              {field('Maximum track width:', tdFilter, setTdFilter, '%')}
              <div className="ze-tvp-note">
                Tracks which are similar in size to the via do not need teardrops.
              </div>
              {field('Best length:', tdBestLen, setTdBestLen, '%')}
              {field('Maximum length:', tdMaxLen, setTdMaxLen, 'mm')}
              {field('Best width:', tdBestWidth, setTdBestWidth, '%')}
              {field('Maximum width:', tdMaxWidth, setTdMaxWidth, 'mm')}
              {tri(tdCurved, setTdCurved, 'Curved edges')}
            </fieldset>
          )}
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
