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
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { DIALOG_EXPORT_VRML_BASE } from './dialog_export_vrml_base.js';
import {
  UNIT_BINDER,
  type UNIT_BINDER_UNITS_PROVIDER,
} from '@ziroeda/common/widgets/unit_binder.js';
import { _ } from '@ziroeda/wx/translation.js';

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

interface Props {
  /** `dlg.FilePicker()->SetPath( path )`. */
  initialPath: string;
  /** The frame, as the UNIT_BINDERs' units and origin. */
  unitsProvider: UNIT_BINDER_UNITS_PROVIDER;
  onClose: (aResult: VRML_DIALOG_RESULT | null) => void;
}

export function DialogExportVrml({ initialPath, unitsProvider, onClose }: Props): JSX.Element {
  const cancel = (): void => onClose(null);

  const [path, setPath] = useState(initialPath);
  const [subdir, setSubdir] = useState(_('shapes3D'));
  const [userOrigin, setUserOrigin] = useState(true);
  const [xText, setXText] = useState('0');
  const [yText, setYText] = useState('0');
  const [units, setUnits] = useState(1);
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

  const onOK = (): void => {
    // TransferDataFromWindow. Upstream first asks before overwriting an existing file; the
    // export is downloaded here, which overwrites nothing, so there is nothing to ask.

    binders.x.SetText(xText);
    binders.y.SetText(yText);

    onClose({
      path,
      subdir3Dshapes: subdir,
      userDefinedOrigin: userOrigin,
      xRefMM: mm(binders.x.GetIntValue()),
      yRefMM: mm(binders.y.GetIntValue()),
      scale: SCALE_LIST[units]!,
      noUnspecified,
      noDNP,
      copyFiles: false,
      useRelativePaths: false,
    });
  };

  return (
    <>
      <DIALOG_EXPORT_VRML_BASE
        m_filePicker={path}
        onFilePicker={setPath}
        m_SubdirNameCtrl={subdir}
        onSubdirName={setSubdir}
        m_cbUserDefinedOrigin={userOrigin}
        onUserDefinedOrigin={setUserOrigin}
        m_VRML_Xref={xText}
        onXref={setXText}
        m_VRML_Yref={yText}
        onYref={setYText}
        unitsLabel={unitWord}
        m_unitsChoice={units}
        onUnitsChoice={setUnits}
        m_cbRemoveDNP={noDNP}
        onRemoveDNP={setNoDNP}
        m_cbRemoveUnspecified={noUnspecified}
        onRemoveUnspecified={setNoUnspecified}
        m_cbCopyFiles={false}
        onCopyFiles={() => {}}
        copyFilesEnabled={false}
        m_cbUseRelativePaths={false}
        onUseRelativePaths={() => {}}
        useRelativePathsEnabled={false}
        onOK={onOK}
        onCancel={cancel}
      />
    </>
  );
}
