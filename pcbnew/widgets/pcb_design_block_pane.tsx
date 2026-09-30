// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_DESIGN_BLOCK_PANE` (pcbnew/widgets/pcb_design_block_pane.{h,cpp}): the
 * board editor's Design Blocks dock - `DESIGN_BLOCK_PANE` over
 * `PANEL_DESIGN_BLOCK_CHOOSER` with the board preview, and under it the three
 * placement options (`REPEATED_PLACEMENT`, `PLACE_AS_GROUP`,
 * `KEEP_ANNOTATIONS`; there is no "Place as sheet" on a board), each read from
 * and written to `pcbnew.json`'s `design_block_chooser.*` (`UpdateCheckboxes`,
 * `OnCheckBox`).
 *
 * The logic half is the class; the window is {@link PcbDesignBlockPane}. The
 * sizer tree (:44-90) is the schematic dock's: the chooser (1, wxEXPAND, 5),
 * then a V sizer of the checkboxes, each `wxTOP|wxLEFT, 2`, the last also
 * `wxBOTTOM`.
 *
 * `FILEDLG_IMPORT_BOARD_CONTENTS` (the same file's import-board file dialog
 * hook) is not ported: the browser has no native file dialog to add custom
 * controls to.
 */
import { useState, type JSX, type ReactNode } from 'react';
import type { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import type { DESIGN_BLOCK_LIBRARY_ADAPTER } from '@ziroeda/common/design_block_library_adapter.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { LibTreeNode } from '@ziroeda/common/lib_tree_model.js';
import type { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import {
  DESIGN_BLOCK_PANE,
  type DESIGN_BLOCK_PANE_DIALOGS,
  type DESIGN_BLOCK_PANE_FRAME,
} from '@ziroeda/common/widgets/design_block_pane.js';
import { PanelDesignBlockChooser } from '@ziroeda/common/widgets/panel_design_block_chooser_ui.js';
import { Check } from '@ziroeda/common/wx/controls.js';

// Do not make these static; they need to respond to language changes
export const REPEATED_PLACEMENT = 'Place repeated copies';
export const PLACE_AS_GROUP = 'Place as group';
export const KEEP_ANNOTATIONS = 'Keep annotations';

/** `setLabelsAndTooltips()` (pcb_design_block_pane.cpp:96-119): each checkbox's label and tooltip. */
export const PCB_DESIGN_BLOCK_PANE_CHECKBOXES = [
  {
    key: 'repeated_placement',
    label: REPEATED_PLACEMENT,
    tooltip: 'Place copies of the design block on subsequent clicks.',
  },
  { key: 'place_as_group', label: PLACE_AS_GROUP, tooltip: 'Place the design block as a group.' },
  {
    key: 'keep_annotations',
    label: KEEP_ANNOTATIONS,
    tooltip: 'Preserve reference designators in the source layout. Otherwise, clear them.',
  },
] as const;

/** `PCBNEW_SETTINGS::m_DesignBlockChooserPanel`'s placement options. */
export interface PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS {
  repeated_placement: boolean;
  place_as_group: boolean;
  keep_annotations: boolean;
}

export class PCB_DESIGN_BLOCK_PANE extends DESIGN_BLOCK_PANE {
  private readonly m_readOptions: () => PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS;
  private readonly m_writeOptions: (aOptions: PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS) => void;

  constructor(
    aFrame: DESIGN_BLOCK_PANE_FRAME,
    aDialogs: DESIGN_BLOCK_PANE_DIALOGS,
    aHistoryList: LIB_ID[],
    aReadOptions: () => PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS,
    aWriteOptions: (aOptions: PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS) => void,
  ) {
    super(aFrame, aDialogs, aHistoryList);
    this.m_readOptions = aReadOptions;
    this.m_writeOptions = aWriteOptions;
  }

  /** The pane's modals, which the frame's design block commands raise too. */
  Dialogs(): DESIGN_BLOCK_PANE_DIALOGS {
    return this.m_dialogs;
  }

  /** `UpdateCheckboxes()` (:139-146): the three values as stored. */
  UpdateCheckboxes(): PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS {
    return { ...this.m_readOptions() };
  }

  /** `OnCheckBox()` (:129-136): all three written back at once. */
  OnCheckBox(aOptions: PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS): void {
    this.m_writeOptions({ ...aOptions });
  }
}

export function PcbDesignBlockPane({
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
  pane: PCB_DESIGN_BLOCK_PANE;
  libs: DESIGN_BLOCK_LIBRARY_ADAPTER;
  manager: LIBRARY_MANAGER;
  pinned: readonly string[];
  width: number;
  /** The pane's close button (`wxEVT_AUI_PANE_CLOSE`). */
  onClose: () => void;
  /** `PCB_ACTIONS::placeDesignBlock`. */
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
  const [options, setOptions] = useState<PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS>(() =>
    pane.UpdateCheckboxes(),
  );

  const onCheckBox = (aKey: keyof PCB_DESIGN_BLOCK_PLACEMENT_OPTIONS, aValue: boolean): void => {
    const next = { ...options, [aKey]: aValue };
    setOptions(next);
    pane.OnCheckBox(next);
  };

  return (
    <div className="ze-rightdock ze-dbpane" style={{ width, minWidth: 240 }}>
      <div className="ze-panel grow">
        <div className="ze-panel-header">
          Design Blocks
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
          {PCB_DESIGN_BLOCK_PANE_CHECKBOXES.map((cb, i) => (
            <Check
              key={cb.key}
              label={cb.label}
              title={cb.tooltip}
              checked={options[cb.key]}
              onChange={(v) => onCheckBox(cb.key, v)}
              // each wxTOP|wxLEFT, 2; the last also wxBOTTOM
              borders={
                i === PCB_DESIGN_BLOCK_PANE_CHECKBOXES.length - 1 ? ['top', 'bottom'] : ['top']
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
