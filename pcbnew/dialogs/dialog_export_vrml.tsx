// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_EXPORT_VRML (`dialog_export_vrml_base.cpp` + `dialog_export_vrml.{h,cpp}`), File > Export >
 * VRML....
 *
 * Sizer tree, read whole:
 *
 *     bSizer1 (V)
 *       bUpperSizer (V, wxALL|wxEXPAND 5): File name: / m_filePicker (*.wrl) /
 *         Footprint 3D model path: / m_SubdirNameCtrl ("shapes3D")
 *       bSizerOptions (V): [x] User defined origin (on) /
 *         fgSizerOptions (3 cols, 20 left/right): X: m_VRML_Xref units / Y: m_VRML_Yref units /
 *         bSizer7: Units: m_unitsChoice (mm, meter, 0.1 inch, inch; meter)
 *       bLowerSizer: Ignore 'Do not populate' components / Ignore 'Unspecified' components /
 *         Copy 3D model files to 3D model path / Use relative paths to model files in board VRML
 *         file (enabled only with the copy, OnUpdateUseRelativePath)
 *       m_sdbSizer OK / Cancel
 *
 * The X/Y entries are UNIT_BINDERs on absolute coordinates, so they read in the frame's units
 * through its display origin. "Copy 3D model files" is greyed: the exporter's models-dir form is
 * not ported yet.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import {
  UNIT_BINDER,
  type UNIT_BINDER_UNITS_PROVIDER,
} from '@ziroeda/common/widgets/unit_binder.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';

/** What BOARD_EDITOR_CONTROL::ExportVRML reads off the dialog on OK. */
export interface VRML_DIALOG_RESULT {
  path: string;
  subdir3Dshapes: string;
  userDefinedOrigin: boolean;
  /** `GetXRefMM()` / `GetYRefMM()`: the origin entries, in mm. */
  xRefMM: number;
  yRefMM: number;
  /** `GetScale()`: mm to the chosen VRML unit. */
  scale: number;
  noUnspecified: boolean;
  noDNP: boolean;
  copyFiles: boolean;
  useRelativePaths: boolean;
}

// Assuming the VRML default unit is the mm
// this is the mm to VRML scaling factor for mm, 0.1 inch, and inch
const SCALE_LIST = [1.0, 0.001, 10.0 / 25.4, 1.0 / 25.4];

const UNITS_CHOICES = [
  { value: '0', label: 'mm' },
  { value: '1', label: 'meter' },
  { value: '2', label: '0.1 inch' },
  { value: '3', label: 'inch' },
];

interface Props {
  /** `dlg.FilePicker()->SetPath( path )`. */
  initialPath: string;
  /** The frame, as the UNIT_BINDERs' units and origin. */
  unitsProvider: UNIT_BINDER_UNITS_PROVIDER;
  /** `TransferDataFromWindow`'s question for an existing file: true to overwrite. */
  fileExists: (aPath: string) => boolean;
  confirmOverwrite: () => Promise<boolean>;
  onClose: (aResult: VRML_DIALOG_RESULT | null) => void;
}

export function DialogExportVrml({
  initialPath,
  unitsProvider,
  fileExists,
  confirmOverwrite,
  onClose,
}: Props): JSX.Element {
  const cancel = (): void => onClose(null);
  useModalEscape(cancel);

  const [path, setPath] = useState(initialPath);
  const [subdir, setSubdir] = useState('shapes3D');
  const [userOrigin, setUserOrigin] = useState(true);
  const [xText, setXText] = useState('0');
  const [yText, setYText] = useState('0');
  const [units, setUnits] = useState('1');
  const [noDNP, setNoDNP] = useState(false);
  const [noUnspecified, setNoUnspecified] = useState(false);

  const [binders] = useState(() => {
    const x = new UNIT_BINDER(unitsProvider, 'X:');
    const y = new UNIT_BINDER(unitsProvider, 'Y:');
    x.SetCoordType(COORD_TYPES_T.ABS_X_COORD);
    y.SetCoordType(COORD_TYPES_T.ABS_Y_COORD);
    return { x, y };
  });

  const unitWord = unitLabel(binders.x.GetUnits());
  const mm = (aIU: number): number => aIU / unitsProvider.GetIuScale().IU_PER_MM;

  const onOK = async (): Promise<void> => {
    // TransferDataFromWindow
    if (fileExists(path) && !(await confirmOverwrite())) return;

    binders.x.SetText(xText);
    binders.y.SetText(yText);

    onClose({
      path,
      subdir3Dshapes: subdir,
      userDefinedOrigin: userOrigin,
      xRefMM: mm(binders.x.GetIntValue()),
      yRefMM: mm(binders.y.GetIntValue()),
      scale: SCALE_LIST[Number(units)]!,
      noUnspecified,
      noDNP,
      copyFiles: false,
      useRelativePaths: false,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={cancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          VRML Export Options
          <span className="x" title="Close" onClick={cancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', overflow: 'auto' }}>
          <div className="ze-genpos-label">File name:</div>
          <div className="ze-genpos-row">
            <input
              className="ze-search"
              style={{ flex: 1 }}
              value={path}
              aria-label="File name"
              onChange={(e) => setPath(e.target.value)}
            />
            <button type="button" className="ze-btn sm" title="Save VRML Board File" disabled>
              <Icon name="folder" size={14} />
            </button>
          </div>
          <div className="ze-genpos-label">Footprint 3D model path:</div>
          <div className="ze-genpos-row">
            <input
              className="ze-search"
              style={{ flex: 1 }}
              value={subdir}
              aria-label="Footprint 3D model path"
              onChange={(e) => setSubdir(e.target.value)}
            />
          </div>

          <label className="ze-genpos-field">
            <input
              type="checkbox"
              checked={userOrigin}
              onChange={(e) => setUserOrigin(e.target.checked)}
            />
            User defined origin
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 3,
              margin: '0 20px',
            }}
          >
            <span className="ze-genpos-label">X:</span>
            <input
              className="ze-search"
              value={xText}
              aria-label="X"
              disabled={!userOrigin}
              onChange={(e) => setXText(e.target.value)}
            />
            <span>{unitWord}</span>
            <span className="ze-genpos-label">Y:</span>
            <input
              className="ze-search"
              value={yText}
              aria-label="Y"
              disabled={!userOrigin}
              onChange={(e) => setYText(e.target.value)}
            />
            <span>{unitWord}</span>
          </div>
          <div className="ze-genpos-field">
            <span className="ze-genpos-label">Units:</span>
            <Combo value={units} options={UNITS_CHOICES} onChange={setUnits} ariaLabel="Units" />
          </div>

          <label className="ze-genpos-field">
            <input type="checkbox" checked={noDNP} onChange={(e) => setNoDNP(e.target.checked)} />
            Ignore 'Do not populate' components
          </label>
          <label className="ze-genpos-field">
            <input
              type="checkbox"
              checked={noUnspecified}
              onChange={(e) => setNoUnspecified(e.target.checked)}
            />
            Ignore 'Unspecified' components
          </label>
          <label
            className="ze-genpos-field"
            title="Copy 3D model files into the 3D model path folder (not available yet)"
          >
            <input type="checkbox" checked={false} disabled />
            Copy 3D model files to 3D model path
          </label>
          <label className="ze-genpos-field">
            <input type="checkbox" checked={false} disabled />
            Use relative paths to model files in board VRML file
          </label>
        </div>

        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={() => void onOK()}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
