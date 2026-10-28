// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_EDIT_FRAME::KiwayMailIn's MAIL_RELOAD_LIB (pcbnew/cross-probing.cpp:859-861):
 * InvokeEditDesignBlockLibTable sends it after the design block tables changed, and the Design
 * Blocks pane lists the libraries again.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

beforeAll(() => {
  installPgm();
});

const frame = () =>
  new PCB_EDIT_FRAME({
    settings: () => new PCBNEW_SETTINGS(),
  } as unknown as PCB_EDIT_FRAME_HOOKS);

const reload = (aFrame: PCB_EDIT_FRAME) =>
  aFrame.KiwayMailIn(
    new KIWAY_MAIL_EVENT(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_RELOAD_LIB, { value: '' }),
  );

describe('MAIL_RELOAD_LIB', () => {
  it('refreshes the Design Blocks pane', () => {
    const f = frame();
    let refreshed = 0;
    f.m_designBlocksPane = {
      RefreshLibs: () => {
        refreshed++;
      },
    } as unknown as NonNullable<PCB_EDIT_FRAME['m_designBlocksPane']>;

    reload(f);

    expect(refreshed).toBe(1);
  });

  it('is a no-op with no pane', () => {
    const f = frame();
    f.m_designBlocksPane = null;
    expect(() => reload(f)).not.toThrow();
  });
});
