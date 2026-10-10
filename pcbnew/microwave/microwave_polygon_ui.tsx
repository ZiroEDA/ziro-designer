// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MWAVE_POLYGONAL_SHAPE_DLG`'s window (`pcbnew/microwave/microwave_polygon.cpp:
 * 60-243`), hand-built in KiCad, no wxFormBuilder base. The logic half is
 * `MWAVE_POLYGONAL_SHAPE_DLG` in `microwave_polygon.ts`.
 *
 * The sizer tree, read whole (`port-the-sizer-tree-whole`):
 *
 *     mainBoxSizer (V)
 *       topBoxSizer (H), Add( 1, wxGROW | wxALL, 5 )
 *         m_shapeOptionCtrl wxRadioBox "Shape", 1 column of Normal /
 *           Symmetrical / Mirrored, Add( 1, wxGROW | wxALL, 5 )
 *         sizeSizer wxStaticBoxSizer "Size" (V), Add( 1, wxGROW | wxALL, 5 )
 *           xSizer (H): "X:" wxALIGN_CENTER_VERTICAL | wxALL 5, the entry
 *             proportion 1 wxALIGN_CENTER_VERTICAL, "units" wxALL 5
 *           ySizer (H): the same for "Y:"
 *       buttonsBoxSizer (H), Add( 0, wxALL, 5 )
 *         "Read Shape Description File..." wxALIGN_CENTER_VERTICAL |
 *           wxLEFT | wxRIGHT 10, a stretch spacer, the wxStdDialogButtonSizer
 *           (OK, Cancel) wxALIGN_CENTER_VERTICAL | wxALL 5
 *
 * The two entries are `UNIT_BINDER`s on the frame: the "units" label becomes
 * the frame's unit word and the text is the value in those units.
 *
 * The file chooser is the browser's: a `wxFileSelector` with the default
 * wildcard reads a file from disk, and an `<input type="file">` is that.
 * `File not found` (`wxFopen` failing) cannot happen for a file the browser has
 * already handed over, but a read that fails is reported the same way.
 */
import { Button, RadioButton, StaticBox } from '@ziroeda/common/wx/controls.js';
import { useRef, useState, type JSX } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { unitEntryText, unitEntryValue } from '@ziroeda/common/dialogs/dialog_unit_entry.js';
import type { EdaIuScale } from '@ziroeda/common/eda_units.js';
import { unitLabel, type EdaUnits } from '@ziroeda/common/widgets/unit_binder.js';
import { MWAVE_POLYGONAL_SHAPE_DLG, MWAVE_POLY_SHAPE_TYPE } from './microwave_polygon.js';

/** `wxString shapelist[]`. */
const SHAPE_LIST = ['Normal', 'Symmetrical', 'Mirrored'] as const;

export function MwavePolygonalShapeDlg({
  units,
  iuScale,
  onResult,
}: {
  /** The frame's display units, the UNIT_BINDERs' provider. */
  units: EdaUnits;
  iuScale: EdaIuScale;
  /** `ShowModal()`: true for wxID_OK, false for wxID_CANCEL. */
  onResult: (ok: boolean) => void;
}): JSX.Element {
  // The dialog's constructor clears `g_PolyEdges`; the logic object is made
  // once per showing.
  const dlg = useRef<MWAVE_POLYGONAL_SHAPE_DLG | null>(null);
  if (!dlg.current) dlg.current = new MWAVE_POLYGONAL_SHAPE_DLG();
  const file = useRef<HTMLInputElement>(null);

  // `wxEmptyString` until a file sets them.
  const [sizeX, setSizeX] = useState('');
  const [sizeY, setSizeY] = useState('');
  const [shape, setShape] = useState<MWAVE_POLY_SHAPE_TYPE>(MWAVE_POLY_SHAPE_TYPE.NORMAL);
  const [error, setError] = useState<string | null>(null);

  const cancel = (): void => {
    dlg.current!.OnCancelClick();
    onResult(false);
  };

  const ok = (): void => {
    const d = dlg.current!;
    const value = (t: string): number => (t.trim() === '' ? 0 : unitEntryValue(t, units, iuScale));

    d.m_sizeX = value(sizeX);
    d.m_sizeY = value(sizeY);
    d.m_shapeOptionCtrl = shape;

    if (d.TransferDataFromWindow()) onResult(true);
  };

  const readFile = (f: File | undefined): void => {
    if (!f) return;

    void f.text().then(
      (text) => {
        const d = dlg.current!;

        d.ReadDataShapeDescr(text);
        setSizeX(unitEntryText(d.m_sizeX, units, iuScale));
        setSizeY(unitEntryText(d.m_sizeY, units, iuScale));
        setError(null);
      },
      () => setError('File not found'),
    );
  };

  const sizeRow = (label: string, value: string, set: (v: string) => void): JSX.Element => (
    <div className="ze-mwave-sizerow">
      <span className="ze-mwave-sizelabel">{label}</span>
      <input
        className="ze-search ze-mwave-sizectrl"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span className="ze-mwave-sizeunit">{unitLabel(units)}</span>
    </div>
  );

  return (
    <DialogShim title="Complex Shape" onClose={cancel} className="ze-mwave">
      <div className="ze-mwave-top">
        <StaticBox label="Shape" className="ze-mwave-shape">
          {SHAPE_LIST.map((label, i) => (
            <RadioButton
              key={label}
              label={label}
              name="ze-mwave-shape"
              checked={shape === i}
              className="ze-mwave-radio"
              onChange={() => setShape(i)}
            />
          ))}
        </StaticBox>
        <StaticBox label="Size" className="ze-mwave-size">
          {sizeRow('X:', sizeX, setSizeX)}
          {sizeRow('Y:', sizeY, setSizeY)}
        </StaticBox>
      </div>
      {error && <div className="ze-mwave-error">{error}</div>}
      <StdDialogButtons onOk={ok} onCancel={cancel}>
        <Button
          label="Read Shape Description File..."
          className="ze-mwave-read"
          onClick={() => file.current?.click()}
        />
        <input
          ref={file}
          type="file"
          hidden
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </StdDialogButtons>
    </DialogShim>
  );
}
