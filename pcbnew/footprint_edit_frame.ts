// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME` (pcbnew/footprint_edit_frame.h) — so far only its
 * KIWAY half: the mail it takes in. `FootprintEditor.tsx` is the window and
 * owns the library tree and canvas each command changes, so the frame
 * reaches them through {@link FOOTPRINT_EDIT_FRAME_HOOKS}.
 */
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';

export interface FOOTPRINT_EDIT_FRAME_HOOKS {
  /**
   * `MAIL_FP_EDIT`'s body: find the footprint file's library, select the
   * footprint in the tree and load it.
   */
  fpEdit(aFile: string): void;
}

export class FOOTPRINT_EDIT_FRAME extends KIWAY_PLAYER {
  private readonly hooks: FOOTPRINT_EDIT_FRAME_HOOKS;

  constructor(hooks: FOOTPRINT_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_FOOTPRINT_EDITOR, pcbIUScale, 'mm');
    this.hooks = hooks;
  }

  /** `FOOTPRINT_EDIT_FRAME::KiwayMailIn` (footprint_editor_utils.cpp:330). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_FP_EDIT:
        if (payload !== '') this.hooks.fpEdit(payload);

        break;

      default:
        break;
    }
  }
}
