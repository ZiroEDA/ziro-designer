// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DESIGN_BLOCK_PANE` (eeschema/widgets/sch_design_block_pane.{h,cpp}),
 * the logic half: the schematic's Design Blocks dock — `DESIGN_BLOCK_PANE`
 * plus the four placement options under the chooser, each read from and
 * written to `eeschema.json`'s `design_block_chooser.*` (`UpdateCheckboxes`,
 * `OnCheckBox`). The window is `sch_design_block_pane_ui.tsx`.
 */
import {
  DESIGN_BLOCK_PANE,
  type DESIGN_BLOCK_PANE_DIALOGS,
  type DESIGN_BLOCK_PANE_FRAME,
} from '@ziroeda/common/widgets/design_block_pane.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';

// Do not make these static; they need to respond to language changes
export const REPEATED_PLACEMENT = 'Place repeated copies';
export const PLACE_AS_SHEET = 'Place as sheet';
export const PLACE_AS_GROUP = 'Place as group';
export const KEEP_ANNOTATIONS = 'Keep annotations';

/** `setLabelsAndTooltips()` (sch_design_block_pane.cpp:95-124): each checkbox's label and tooltip. */
export const SCH_DESIGN_BLOCK_PANE_CHECKBOXES = [
  {
    key: 'repeated_placement',
    label: REPEATED_PLACEMENT,
    tooltip: 'Place copies of the design block on subsequent clicks.',
  },
  { key: 'place_as_group', label: PLACE_AS_GROUP, tooltip: 'Place the design block as a group.' },
  {
    key: 'place_as_sheet',
    label: PLACE_AS_SHEET,
    tooltip: 'Place the design block as a new sheet.',
  },
  {
    key: 'keep_annotations',
    label: KEEP_ANNOTATIONS,
    tooltip:
      'Preserve reference designators in the source schematic. Otherwise, clear then reannotate according to settings.',
  },
] as const;

/** `EESCHEMA_SETTINGS::m_DesignBlockChooserPanel`'s placement options. */
export interface DESIGN_BLOCK_PLACEMENT_OPTIONS {
  repeated_placement: boolean;
  place_as_group: boolean;
  place_as_sheet: boolean;
  keep_annotations: boolean;
}

/**
 * `FILEDLG_IMPORT_SHEET_CONTENTS` (sch_design_block_pane.cpp:163): the four placement check boxes
 * the Import Sheet file dialog carries, seeded from and written back to
 * `m_DesignBlockChooserPanel` (`TransferDataFromCustomControls`) when the window showed them.
 */
export interface FILEDLG_IMPORT_SHEET_CONTENTS {
  kind: 'import_sheet_contents';
  attached: boolean;
  repeated_placement: boolean;
  place_as_group: boolean;
  place_as_sheet: boolean;
  keep_annotations: boolean;
}

/** `FILEDLG_IMPORT_SHEET_CONTENTS( aSettings )`: the boxes as the settings have them. */
export function MakeFileDlgImportSheetContents(aSettings: {
  repeated_placement: boolean;
  place_as_group: boolean;
  place_as_sheet: boolean;
  keep_annotations: boolean;
}): FILEDLG_IMPORT_SHEET_CONTENTS {
  return {
    kind: 'import_sheet_contents',
    attached: false,
    repeated_placement: aSettings.repeated_placement,
    place_as_group: aSettings.place_as_group,
    place_as_sheet: aSettings.place_as_sheet,
    keep_annotations: aSettings.keep_annotations,
  };
}

/** `TransferDataFromCustomControls()`: the boxes into the settings. */
export function TransferImportSheetContents(
  aHook: FILEDLG_IMPORT_SHEET_CONTENTS,
  aSettings: {
    repeated_placement: boolean;
    place_as_group: boolean;
    place_as_sheet: boolean;
    keep_annotations: boolean;
  },
): void {
  if (!aHook.attached) return;

  aSettings.repeated_placement = aHook.repeated_placement;
  aSettings.place_as_group = aHook.place_as_group;
  aSettings.place_as_sheet = aHook.place_as_sheet;
  aSettings.keep_annotations = aHook.keep_annotations;
}

export class SCH_DESIGN_BLOCK_PANE extends DESIGN_BLOCK_PANE {
  private readonly m_readOptions: () => DESIGN_BLOCK_PLACEMENT_OPTIONS;
  private readonly m_writeOptions: (aOptions: DESIGN_BLOCK_PLACEMENT_OPTIONS) => void;

  constructor(
    aFrame: DESIGN_BLOCK_PANE_FRAME,
    aDialogs: DESIGN_BLOCK_PANE_DIALOGS,
    aHistoryList: LIB_ID[],
    aReadOptions: () => DESIGN_BLOCK_PLACEMENT_OPTIONS,
    aWriteOptions: (aOptions: DESIGN_BLOCK_PLACEMENT_OPTIONS) => void,
  ) {
    super(aFrame, aDialogs, aHistoryList);
    this.m_readOptions = aReadOptions;
    this.m_writeOptions = aWriteOptions;
  }

  /** The pane's modals, which the frame's design block commands raise too. */
  Dialogs(): DESIGN_BLOCK_PANE_DIALOGS {
    return this.m_dialogs;
  }

  /** `UpdateCheckboxes()` (:141-150): the four values as stored. */
  UpdateCheckboxes(): DESIGN_BLOCK_PLACEMENT_OPTIONS {
    return { ...this.m_readOptions() };
  }

  /** `OnCheckBox()` (:130-138): all four written back at once. */
  OnCheckBox(aOptions: DESIGN_BLOCK_PLACEMENT_OPTIONS): void {
    this.m_writeOptions({ ...aOptions });
  }
}
