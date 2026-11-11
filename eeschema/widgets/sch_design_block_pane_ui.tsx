// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DESIGN_BLOCK_PANE` (eeschema/widgets/sch_design_block_pane.cpp), the
 * window: the "Design Blocks" dock — `PANEL_DESIGN_BLOCK_CHOOSER` with the
 * schematic preview, and under it the four placement options.
 *
 * The sizer tree (:44-90): `sizer` (V) holding the chooser (1, wxEXPAND, 5)
 * then `cbSizer` (V, 0, wxEXPAND, 5) with the four checkboxes, each
 * `wxTOP|wxLEFT, 2`, the last also `wxBOTTOM`.
 *
 * The AUI pane (`defaultDesignBlocksPaneInfo`, eeschema_settings.cpp): right,
 * layer 3, caption "Design Blocks", close button, minimum 240 x 60, best 300
 * wide.
 */
import { useState, type JSX, type ReactNode } from 'react';
import type { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import type { DESIGN_BLOCK_LIBRARY_ADAPTER } from '@ziroeda/common/design_block_library_adapter.js';
import type { LibTreeNode } from '@ziroeda/common/lib_tree_model.js';
import type { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import { PanelDesignBlockChooser } from '@ziroeda/common/widgets/panel_design_block_chooser_ui.js';
import { Check } from '@ziroeda/common/dialogs/pref_controls.js';
import {
  type DESIGN_BLOCK_PLACEMENT_OPTIONS,
  type FILEDLG_IMPORT_SHEET_CONTENTS,
  KEEP_ANNOTATIONS,
  PLACE_AS_GROUP,
  PLACE_AS_SHEET,
  REPEATED_PLACEMENT,
  SCH_DESIGN_BLOCK_PANE_CHECKBOXES,
  type SCH_DESIGN_BLOCK_PANE,
} from './sch_design_block_pane.js';
import { CheckBox } from '@ziroeda/wx/controls.js';
import { _ } from '@ziroeda/wx/translation.js';

export function SchDesignBlockPane({
  pane,
  libs,
  manager,
  pinned,
  width,
  onClose,
  onChosen,
  renderPreview,
  sortMode,
  sashPosV,
  onSortModeChanged,
  onSashPosVChanged,
  openLibs,
  onToggleLibrary,
  onPinLibrary,
  onItemContextMenu,
}: {
  pane: SCH_DESIGN_BLOCK_PANE;
  libs: DESIGN_BLOCK_LIBRARY_ADAPTER;
  manager: LIBRARY_MANAGER;
  pinned: readonly string[];
  width: number;
  /** The pane's close button (`wxEVT_AUI_PANE_CLOSE`). */
  onClose: () => void;
  /** `SCH_ACTIONS::placeDesignBlock`. */
  onChosen: () => void;
  renderPreview: (aDesignBlock: DESIGN_BLOCK | null) => ReactNode;
  sortMode: number;
  sashPosV: number;
  onSortModeChanged: (aMode: number) => void;
  onSashPosVChanged: (aPos: number) => void;
  openLibs: readonly string[];
  onToggleLibrary?: (aNode: LibTreeNode, aOpen: boolean) => void;
  onPinLibrary?: (aNode: LibTreeNode, aPinned: boolean) => void;
  onItemContextMenu?: (aNode: LibTreeNode, x: number, y: number) => void;
}): JSX.Element {
  const [options, setOptions] = useState<DESIGN_BLOCK_PLACEMENT_OPTIONS>(() =>
    pane.UpdateCheckboxes(),
  );

  const onCheckBox = (aKey: keyof DESIGN_BLOCK_PLACEMENT_OPTIONS, aValue: boolean): void => {
    const next = { ...options, [aKey]: aValue };
    setOptions(next);
    pane.OnCheckBox(next);
  };

  return (
    <div className="ze-rightdock ze-dbpane" style={{ width, minWidth: 240 }}>
      <div className="ze-panel grow">
        <div className="ze-panel-header">
          {_('Design Blocks')}
          <span className="x" role="button" aria-label="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <PanelDesignBlockChooser
          pane={pane}
          libs={libs}
          manager={manager}
          pinned={pinned}
          onChosen={onChosen}
          renderPreview={renderPreview}
          sortMode={sortMode}
          sashPosV={sashPosV}
          onSortModeChanged={onSortModeChanged}
          onSashPosVChanged={onSashPosVChanged}
          openLibs={openLibs}
          {...(onToggleLibrary ? { onToggleLibrary } : {})}
          {...(onPinLibrary ? { onPinLibrary } : {})}
          {...(onItemContextMenu ? { onItemContextMenu } : {})}
        />
        <div className="ze-dbpane-options">
          {SCH_DESIGN_BLOCK_PANE_CHECKBOXES.map((cb, i) => (
            <Check
              key={cb.key}
              label={cb.label}
              title={cb.tooltip}
              checked={options[cb.key]}
              onChange={(v) => onCheckBox(cb.key, v)}
              // each wxTOP|wxLEFT, 2; the last also wxBOTTOM
              borders={
                i === SCH_DESIGN_BLOCK_PANE_CHECKBOXES.length - 1 ? ['top', 'bottom'] : ['top']
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * `FILEDLG_IMPORT_SHEET_CONTENTS::AddCustomControls( customizer )` (sch_design_block_pane.cpp:181):
 * the four boxes under the Import Sheet chooser, seeded from the hook. Each change is held in the
 * hook; `TransferDataFromCustomControls` copies them into the settings after OK.
 */
export function FiledlgImportSheetContentsControls({
  hook,
}: {
  hook: FILEDLG_IMPORT_SHEET_CONTENTS;
}): JSX.Element {
  hook.attached = true;
  const [, repaint] = useState(0);
  const box = (
    aKey: keyof Omit<FILEDLG_IMPORT_SHEET_CONTENTS, 'kind' | 'attached'>,
    aLabel: string,
  ) => (
    <CheckBox
      key={aKey}
      label={aLabel}
      checked={hook[aKey]}
      onChange={(aChecked) => {
        hook[aKey] = aChecked;
        repaint((n) => n + 1);
      }}
    />
  );

  return (
    <>
      {box('repeated_placement', REPEATED_PLACEMENT)}
      {box('place_as_group', PLACE_AS_GROUP)}
      {box('place_as_sheet', PLACE_AS_SHEET)}
      {box('keep_annotations', KEEP_ANNOTATIONS)}
    </>
  );
}
