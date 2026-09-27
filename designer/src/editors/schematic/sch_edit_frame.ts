// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME` (eeschema/sch_edit_frame.h) — so far only its KIWAY half:
 * the mail it takes in (`KiwayMailIn`, `ExecuteRemoteCommand`) and the
 * cross-probe packets it sends (eeschema/cross-probing.cpp).
 * `SchematicEditor.tsx` is the window, and owns the state each command
 * changes, so the frame reaches it through {@link SCH_EDIT_FRAME_HOOKS}.
 */
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';

export interface SCH_EDIT_FRAME_HOOKS {
  /** `eeconfig()->m_CrossProbing`, read on every probe so a changed preference is seen. */
  crossProbingSettings(): CROSS_PROBING_SETTINGS;
  /**
   * `m_highlightedConn = …` then `SCH_ACTIONS::updateNetHighlighting`: the
   * editor resolves the name against its connection graph
   * (`FindFirstSubgraphByName`) and relights; empty is no highlight.
   */
  highlightNet(aNetName: string): void;
}

export class SCH_EDIT_FRAME extends KIWAY_PLAYER {
  private readonly hooks: SCH_EDIT_FRAME_HOOKS;

  constructor(hooks: SCH_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_SCH, schIUScale, 'mm');
    this.hooks = hooks;
  }

  /** `SCH_EDIT_FRAME::KiwayMailIn` (eeschema/cross-probing.cpp). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_CROSS_PROBE:
        this.ExecuteRemoteCommand(payload);
        break;

      default:
        break;
    }
  }

  /**
   * `SCH_EDIT_FRAME::ExecuteRemoteCommand` (eeschema/cross-probing.cpp:202):
   * a cross-probe packet from the board. The `$NET:` and `$CLEAR:` arms are
   * here; `$CONFIG`, `$ERC` and the `$PART:` probe are not yet.
   */
  ExecuteRemoteCommand(cmdline: string): void {
    const tok = new STRTOK(strncpyLine(cmdline));
    const idcmd = tok.Next(' \n\r');
    const text = tok.Next('"\n\r');

    if (idcmd === null) return;

    const crossProbingSettings = this.hooks.crossProbingSettings();

    if (idcmd === '$NET:') {
      if (!crossProbingSettings.auto_highlight) return;

      this.hooks.highlightNet(text ?? '');
      return;
    } else if (idcmd === '$CLEAR:') {
      // Cross-probing is now done through selection so we no longer need a clear command
      return;
    }
  }

  /** `SCH_EDIT_FRAME::SendCrossProbeNetName` (eeschema/cross-probing.cpp:383). */
  SendCrossProbeNetName(aNetName: string): void {
    // The command is a keyword followed by a quoted string.
    const packet = `$NET: "${aNetName}"`;

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }

  /** `SCH_EDIT_FRAME::SendCrossProbeClearHighlight` (eeschema/cross-probing.cpp:457). */
  SendCrossProbeClearHighlight(): void {
    const packet = '$CLEAR\n';

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }
}
