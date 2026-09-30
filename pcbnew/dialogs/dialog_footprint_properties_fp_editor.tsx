// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useRef, useState, type JSX, type ReactNode } from 'react';
import type { PadEdit } from '../index.js';
import type { PcbFootprint, PcbPad } from '../index.js';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { footprintStringChild } from '../index.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { FOOTPRINT, FP_3DMODEL } from '../footprint.js';
import type { PANEL_3D_MODEL_HOST, SELECTED_3D_MODEL } from './panel_fp_properties_3d_model.js';
import {
  PanelFpProperties3dModel,
  type PANEL_3D_MODEL_API,
} from './panel_fp_properties_3d_model_ui.js';

/**
 * Footprint properties, the working subset of KiCad's
 * DIALOG_FOOTPRINT_PROPERTIES (pcbnew/dialogs): Reference, Value, and the
 * library Description / Keywords. (Side/layer flip and per-attribute flags are
 * staged, they need the full change-side geometry transform.)
 *
 * The 3D Models page is `PANEL_FP_PROPERTIES_3D_MODEL`, the same panel the board
 * editor's dialog uses (`dialog_footprint_properties_fp_editor.cpp:172-174`).
 * Of upstream's notebook (General, Layers, Clearance Overrides, Pad Connections,
 * 3D Models, Embedded Files) only General's four fields and 3D Models are here.
 */
export function FootprintPropertiesDialog({
  footprint,
  onOk,
  onCancel,
  model3d,
}: {
  footprint: PcbFootprint;
  onOk: (r: {
    reference: string;
    value: string;
    description: string;
    keywords: string;
    /** The 3D Models page's list; absent when the page was not supplied. */
    models?: FP_3DMODEL[];
  }) => void;
  onCancel: () => void;
  /**
   * The 3D Models page: a FOOTPRINT carrying the edited footprint's models and
   * library id, what the page asks of the frame, and the two 3D widgets it hosts.
   */
  model3d?: {
    footprint: FOOTPRINT;
    host: PANEL_3D_MODEL_HOST;
    renderPreview: (
      aModels: readonly FP_3DMODEL[],
      aSelected: number,
      aVersion: number,
    ) => ReactNode;
    pickModel: () => Promise<SELECTED_3D_MODEL | null>;
  };
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [reference, setReference] = useState(footprint.reference ?? '');
  const [value, setValue] = useState(footprint.value ?? '');
  const [description, setDescription] = useState(footprintStringChild(footprint, 'descr'));
  const [keywords, setKeywords] = useState(footprintStringChild(footprint, 'tags'));

  const [tab, setTab] = useState<'general' | 'models3d'>('general');
  const modelsApi = useRef<PANEL_3D_MODEL_API | null>(null);

  const submit = (): void => {
    // `m_3dPanel->TransferDataFromWindow()`: commit the open cell, then take the list.
    if (modelsApi.current && !modelsApi.current.CommitPendingChanges()) return;
    onOk({
      reference,
      value,
      description,
      keywords,
      ...(modelsApi.current ? { models: modelsApi.current.GetModelList() } : {}),
    });
  };

  const tabButton = (id: 'general' | 'models3d', label: string): JSX.Element => (
    <button
      type="button"
      className={`ze-tab${tab === id ? ' active' : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Footprint Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        {model3d && (
          <div className="ze-tabbar ze-fpprops-tabs">
            {tabButton('general', 'General')}
            {tabButton('models3d', '3D Models')}
          </div>
        )}
        <div
          className="ze-modal-body"
          hidden={tab !== 'general'}
          style={{
            // an inline display would beat the `hidden` attribute's own
            display: tab === 'general' ? 'grid' : 'none',
            gridTemplateColumns: 'auto 1fr',
            gap: '8px 10px',
            padding: 14,
            alignItems: 'center',
          }}
        >
          <label>Reference</label>
          <input
            className="ze-search"
            autoFocus
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submit();
            }}
          />
          <label>Value</label>
          <input
            className="ze-search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submit();
            }}
          />
          <label>Description</label>
          <input
            className="ze-search"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <label>Keywords</label>
          <input
            className="ze-search"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        {/* Mounted for the dialog's life, so the list survives a change of page. */}
        {model3d && (
          <div className="ze-fp3d-host" hidden={tab !== 'models3d'}>
            <PanelFpProperties3dModel
              footprint={model3d.footprint}
              host={model3d.host}
              renderPreview={model3d.renderPreview}
              pickModel={model3d.pickModel}
              apiRef={modelsApi}
            />
          </div>
        )}
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

const PAD_TYPES: { v: PcbPad['type']; label: string }[] = [
  { v: 'thru_hole', label: 'Through-hole' },
  { v: 'smd', label: 'SMD' },
  { v: 'connect', label: 'Edge connector' },
  { v: 'np_thru_hole', label: 'NPTH, mechanical' },
];
const PAD_SHAPES: { v: PcbPad['shape']; label: string }[] = [
  { v: 'circle', label: 'Circular' },
  { v: 'oval', label: 'Oval' },
  { v: 'rect', label: 'Rectangular' },
  { v: 'roundrect', label: 'Rounded rectangle' },
  { v: 'trapezoid', label: 'Trapezoidal' },
  { v: 'custom', label: 'Custom' },
];

/** Copper/mask layer sets that follow from the pad type (DIALOG_PAD_PROPERTIES). */
const layersForType = (type: PcbPad['type']): string[] =>
  type === 'smd'
    ? ['F.Cu', 'F.Paste', 'F.Mask']
    : type === 'np_thru_hole'
      ? ['*.Cu', '*.Mask']
      : ['*.Cu', '*.Mask'];

/**
 * Pad properties, the working subset of KiCad's DIALOG_PAD_PROPERTIES: number,
 * type, shape, position, size and drill. Layers follow the pad type. Values are
 * shown/entered in millimetres.
 */
export function PadPropertiesDialog({
  pad,
  onOk,
  onCancel,
}: {
  pad: PcbPad;
  onOk: (e: PadEdit) => void;
  onCancel: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [number, setNumber] = useState(pad.number);
  const [type, setType] = useState<PcbPad['type']>(pad.type);
  const [shape, setShape] = useState<PcbPad['shape']>(pad.shape);
  const [posX, setPosX] = useState(String(iuToMM(pad.at.x)));
  const [posY, setPosY] = useState(String(iuToMM(pad.at.y)));
  const [sizeX, setSizeX] = useState(String(iuToMM(pad.size.x)));
  const [sizeY, setSizeY] = useState(String(iuToMM(pad.size.y)));
  const [drill, setDrill] = useState(String(pad.drill ? iuToMM(pad.drill.w) : 0));

  const hasDrill = type === 'thru_hole' || type === 'np_thru_hole';
  const num = (s: string): number => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  };

  const submit = (): void => {
    const drillMM = num(drill);
    onOk({
      number,
      type,
      shape,
      at: { x: mmToIU(num(posX)), y: mmToIU(num(posY)) },
      size: { x: mmToIU(num(sizeX)), y: mmToIU(num(sizeY)) },
      drill:
        hasDrill && drillMM > 0 ? { oblong: false, w: mmToIU(drillMM), h: mmToIU(drillMM) } : null,
      layers: layersForType(type),
    });
  };

  const Row = ({ label, children }: { label: string; children: JSX.Element }): JSX.Element => (
    <>
      <label>{label}</label>
      {children}
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Pad Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '8px 10px',
            padding: 14,
            alignItems: 'center',
          }}
        >
          <Row label="Pad number">
            <input
              className="ze-search"
              autoFocus
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
          </Row>
          <Row label="Pad type">
            <select
              className="ze-select"
              value={type}
              onChange={(e) => setType(e.target.value as PcbPad['type'])}
            >
              {PAD_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Shape">
            <select
              className="ze-select"
              value={shape}
              onChange={(e) => setShape(e.target.value as PcbPad['shape'])}
            >
              {PAD_SHAPES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Position (mm)">
            <span style={{ display: 'flex', gap: 6 }}>
              <input
                className="ze-search"
                style={{ width: 90 }}
                value={posX}
                onChange={(e) => setPosX(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <input
                className="ze-search"
                style={{ width: 90 }}
                value={posY}
                onChange={(e) => setPosY(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </span>
          </Row>
          <Row label="Size (mm)">
            <span style={{ display: 'flex', gap: 6 }}>
              <input
                className="ze-search"
                style={{ width: 90 }}
                value={sizeX}
                onChange={(e) => setSizeX(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <input
                className="ze-search"
                style={{ width: 90 }}
                value={sizeY}
                onChange={(e) => setSizeY(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </span>
          </Row>
          <Row label="Hole (mm)">
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={drill}
              disabled={!hasDrill}
              onChange={(e) => setDrill(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </Row>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
