// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME` (eeschema/symbol_editor/symbol_edit_frame.h), on
 * `SCH_BASE_FRAME` — so far its KIWAY half: the mail it takes in. `SymbolEditor.tsx` is the window
 * and owns the library tree and canvas each command changes, so the frame
 * reaches them through {@link SYMBOL_EDIT_FRAME_HOOKS}.
 */
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { LIB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { SCH_BASE_FRAME } from '../sch_base_frame.js';

export interface SYMBOL_EDIT_FRAME_HOOKS {
  /**
   * `MAIL_LIB_EDIT`'s body: resolve the library URI through the symbol
   * library table (refusing one no row names, or a disabled one, with
   * upstream's messages), make it the current library and show it.
   */
  libEdit(aUri: string): void;
}

export class SYMBOL_EDIT_FRAME extends SCH_BASE_FRAME {
  /**
   * `Kiface().KifaceSettings()` is SYMBOL_EDITOR_SETTINGS upstream, which is not an
   * APP_SETTINGS_BASE here yet (symbol_editor_settings.ts is the JSON slice); none until it is,
   * as before SCH_BASE_FRAME answered EESCHEMA_SETTINGS.
   */
  override config(): APP_SETTINGS_BASE | null {
    return null;
  }

  private readonly hooks: SYMBOL_EDIT_FRAME_HOOKS;

  constructor(hooks: SYMBOL_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);
    this.hooks = hooks;
  }

  /** `LIB_EDIT_FRAME_NAME`, the name wx gives this frame. */
  override GetName(): string {
    return LIB_EDIT_FRAME_NAME;
  }

  /** `SYMBOL_EDIT_FRAME::KiwayMailIn` (symbol_edit_frame.cpp:1753). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_LIB_EDIT:
        if (payload !== '') this.hooks.libEdit(payload);

        break;

      default:
        break;
    }
  }
}
