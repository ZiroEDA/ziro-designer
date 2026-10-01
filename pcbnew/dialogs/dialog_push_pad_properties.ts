// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PUSH_PAD_PROPERTIES` (`pcbnew/dialogs/dialog_push_pad_properties.cpp`
 * + `.h`): the modal dialog `PAD_TOOL::pushPadSettings` shows, with the four
 * "do not modify pads having a different ..." filters and the two buttons that
 * choose between the current footprint and every identical one.
 *
 * The class is the dialog's logic and control state; the window is
 * `dialog_push_pad_properties_ui.tsx`.
 */
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';

/** `wxID_CANCEL`, which `ShowModal()` answers when the dialog is dismissed. */
export const wxID_CANCEL = 5101;

/** `DIALOG_PUSH_PAD_PROPERTIES_BASE`'s title: the base file states none. */
export const DIALOG_PUSH_PAD_PROPERTIES_TITLE = 'Push Pad Properties';

/** `SetupStandardButtons`' labels for `wxID_OK` and `wxID_APPLY`. */
export const PUSH_PAD_OK_LABEL = 'Change Pads on Current Footprint';
export const PUSH_PAD_APPLY_LABEL = 'Change Pads on Identical Footprints';

export class DIALOG_PUSH_PAD_PROPERTIES {
  private readonly m_parent: PCB_BASE_FRAME;

  // the four wxCheckBoxes, `SetValue( true )` in the base file
  m_Pad_Shape_Filter_CB = true;
  m_Pad_Layer_Filter_CB = true;
  m_Pad_Orient_Filter_CB = true;
  m_Pad_Type_Filter_CB = true;

  /** `m_sdbSizer1Apply->Show( false )` in the footprint editor. */
  readonly m_applyShown: boolean;

  constructor(aParent: PCB_BASE_FRAME) {
    this.m_parent = aParent;

    this.m_applyShown = !aParent.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);
  }

  GetPadShapeFilter(): boolean {
    return this.m_Pad_Shape_Filter_CB;
  }

  GetPadLayerFilter(): boolean {
    return this.m_Pad_Layer_Filter_CB;
  }

  GetPadOrientFilter(): boolean {
    return this.m_Pad_Orient_Filter_CB;
  }

  GetPadTypeFilter(): boolean {
    return this.m_Pad_Type_Filter_CB;
  }

  /**
   * `PadPropertiesAccept`: `wxID_APPLY` ends the dialog with 1, `wxID_OK` with 0,
   * and either way the frame is told it was modified.
   */
  PadPropertiesAccept(aId: 'ok' | 'apply'): number {
    const returncode = aId === 'apply' ? 1 : 0;

    this.m_parent.OnModify();

    return returncode;
  }
}
