// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `bitmap2component/bitmap2cmp_control.cpp` + `.h`: `BITMAP2CMP_CONTROL`, the
 * frame's one tool. It answers `ACTIONS::open` (File > Open..., Ctrl+O) by
 * asking the frame for an image, as the Load Source Image button does.
 *
 * The header also declares `Close()`, which the `.cpp` never defines and
 * nothing binds; it is absent here too.
 */
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { BITMAP2CMP_FRAME } from './bitmap2cmp_frame.js';

export class BITMAP2CMP_CONTROL extends TOOL_INTERACTIVE {
  private m_frame: BITMAP2CMP_FRAME | null;

  constructor() {
    super('bitmap2cmp.Control');
    this.m_frame = null;
  }

  /** @copydoc TOOL_INTERACTIVE::Init() */
  override Init(): boolean {
    this.Reset(RESET_REASON.MODEL_RELOAD);
    return true;
  }

  /** @copydoc TOOL_INTERACTIVE::Reset() */
  Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<BITMAP2CMP_FRAME>();
  }

  // biome-ignore lint/correctness/useYield: Open never waits; a handler is still a coroutine
  *Open(_aEvent: TOOL_EVENT) {
    void this.m_frame!.OnLoadFile();
    return 0;
  }

  /** Set up handlers for various events. */
  protected setTransitions(): void {
    this.Go(this.Open, ACTIONS.open.MakeEvent());
  }
}
