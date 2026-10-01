// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TARGET_PROPERTIES` (`pcbnew/dialogs/dialog_target_properties.cpp`) on a
 * live `PCB_TARGET`: Size, Thickness and the `+` / `X` shape choice.
 *
 * `PCB_EDIT_FRAME::ShowTargetOptionsDialog` is what opens it, from
 * `EDIT_TOOL::Properties` (`edit_tool.cpp`) on one selected alignment target.
 * Nothing calls it yet: that tool is `pcbnew/tools/` (the live-BOARD stage), and
 * `PCB_TARGET` is not in the frame's selectable view model. The dialog and its
 * apply are ready for it.
 */
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { toStatusUnits } from '@ziroeda/common/settings/app_settings_units.js';
import { validateUnitValue } from '@ziroeda/common/widgets/unit_binder.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_TARGET } from '../pcb_target.js';
import type { TransferResult } from './dialog_text_properties.js';

/** `m_TargetShapeChoices[] = { _("+"), _("X") }` (`_base.cpp`), in the wxChoice's order. */
export const TARGET_SHAPE_CHOICES: readonly (readonly [0 | 1, string])[] = [
  [0, '+'],
  [1, 'X'],
];

/** Every control on the dialog. */
export interface TargetValues {
  /** `m_Size`, IU. */
  size: number;
  /** `m_Thickness`, IU. */
  thickness: number;
  /** `m_TargetShape->GetSelection()`. */
  shape: 0 | 1;
}

export class DIALOG_TARGET_PROPERTIES {
  private readonly m_Parent: PCB_BASE_FRAME;
  private readonly m_Target: PCB_TARGET;

  constructor(aParent: PCB_BASE_FRAME, aTarget: PCB_TARGET) {
    this.m_Parent = aParent;
    this.m_Target = aTarget;
  }

  TransferDataToWindow(): TargetValues {
    return {
      size: this.m_Target.GetSize(),
      thickness: this.m_Target.GetWidth(),
      shape: this.m_Target.GetShape() ? 1 : 0,
    };
  }

  TransferDataFromWindow(v: TargetValues): TransferResult {
    // Zero-size targets are hard to see/select.
    //   if( !m_Size.Validate( EDA_UNIT_UTILS::Mils2IU( pcbIUScale, 1 ), INT_MAX ) ) return false;
    const message = validateUnitValue(
      'Size:',
      pcbIUScale.iuToMM(v.size),
      { min: pcbIUScale.iuToMM(pcbIUScale.milsToIU(1)), max: Number.MAX_SAFE_INTEGER },
      toStatusUnits(this.m_Parent.GetUserUnits()),
      pcbIUScale,
    );

    if (message) return { ok: false, message };

    const commit = new BOARD_COMMIT(this.m_Parent);
    commit.Modify(this.m_Target);

    // Save old item in undo list, if it's not currently edited (will be later if so)
    const pushCommit = this.m_Target.GetEditFlags() === 0;

    // other edit in progress (MOVE, NEW ..): set flag IN_EDIT to force
    // undo/redo/abort proper operation
    if (this.m_Target.GetEditFlags() !== 0) this.m_Target.SetFlags(IN_EDIT);

    this.m_Target.SetWidth(v.thickness);
    this.m_Target.SetSize(v.size);
    this.m_Target.SetShape(v.shape ? 1 : 0);

    if (pushCommit) commit.Push('Edit Alignment Target');

    return { ok: true };
  }
}
