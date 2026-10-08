// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SCH_EDIT_FRAME::KiwayMailIn` → `ExecuteRemoteCommand` for the net probe
 * (`eeschema/cross-probing.cpp:202-259`), reached through KIWAY as the board
 * sends it, and the two packets the schematic sends back.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { STRTOK } from '@ziroeda/common/libc/string.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';

// SCH_EDIT_FRAME asks Prj() in its constructor, as KiCad's does: KiCad always has a PGM_BASE.
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

class PCB_STUB extends KIWAY_PLAYER {
  readonly received: [MAIL_T, string][] = [];

  constructor() {
    super(FRAME_T.FRAME_PCB_EDITOR, pcbIUScale, 'mm');
  }

  override KiwayMailIn(aEvent: KIWAY_MAIL_EVENT): void {
    this.received.push([aEvent.Command(), aEvent.GetPayload()]);
  }
}

function setup() {
  const cfg = new CROSS_PROBING_SETTINGS();
  let saveAnswer = true;
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => cfg,
    saveProject: () => saveAnswer,
    getNetlist: () => null,
  });
  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  frame.SetKiway(kiway);
  kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, frame);
  const pcb = new PCB_STUB();
  kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
  const probe = (packet: string) =>
    kiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_CROSS_PROBE, { value: packet }, pcb);
  const select = (packet: string, force = false) =>
    kiway.ExpressMail(
      FRAME_T.FRAME_SCH,
      force ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
      { value: packet },
      pcb,
    );
  const mail = (command: MAIL_T, value: string) => {
    const payload = { value };
    kiway.ExpressMail(FRAME_T.FRAME_SCH, command, payload);
    return payload.value;
  };
  return {
    cfg,
    frame,
    pcb,
    probe,
    select,
    mail,
    failSave: () => {
      saveAnswer = false;
    },
  };
}

describe('the schematic probing a net on the board', () => {
  it('mails $NET: "<name>" and $CLEAR to FRAME_PCB_EDITOR', () => {
    const env = setup();
    env.frame.SendCrossProbeNetName('GND');
    env.frame.SendCrossProbeClearHighlight();
    expect(env.pcb.received).toEqual([
      [MAIL_T.MAIL_CROSS_PROBE, '$NET: "GND"'],
      [MAIL_T.MAIL_CROSS_PROBE, '$CLEAR\n'],
    ]);
  });
});

describe('Update PCB from Schematic', () => {
  it('OnUpdatePCB brings the board up, then mails it MAIL_PCB_UPDATE', () => {
    const shown: FRAME_T[] = [];
    const kiway = new KIWAY({
      OnKiCadExit: () => {},
      Player: (t) => {
        shown.push(t);
        return true;
      },
      HasProjectManager: () => true,
      ShowProjectManager: () => {},
      CreateKiWindow: () => false,
    });
    const frame = new SCH_EDIT_FRAME({
      crossProbingSettings: () => new CROSS_PROBING_SETTINGS(),
      saveProject: () => true,
      getNetlist: () => null,
    });
    frame.SetKiway(kiway);

    // The board is not up yet: the mail waits for it to register.
    frame.OnUpdatePCB();
    expect(shown).toEqual([FRAME_T.FRAME_PCB_EDITOR]);
    const pcb = new PCB_STUB();
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
    expect(pcb.received).toEqual([[MAIL_T.MAIL_PCB_UPDATE, '']]);
  });
});

describe('CvPcb mailing the schematic', () => {
  it('MAIL_SCH_SAVE answers "success" when SaveProject() does, and leaves the payload otherwise', () => {
    const env = setup();
    expect(env.mail(MAIL_T.MAIL_SCH_SAVE, '')).toBe('success');
    env.failSave();
    expect(env.mail(MAIL_T.MAIL_SCH_SAVE, '')).toBe('');
  });
});

describe('strtok', () => {
  it('skips leading delimiters, consumes one after the token, and ends with null', () => {
    const tok = new STRTOK('  $NET: "a b"\n');
    expect(tok.Next(' \n\r')).toBe('$NET:');
    expect(tok.Next('"\n\r')).toBe('a b');
    expect(tok.Next('"\n\r')).toBeNull();
    expect(tok.Next('"\n\r')).toBeNull();
  });

  it('returns null for a string of only delimiters', () => {
    expect(new STRTOK(' \n ').Next(' \n\r')).toBeNull();
    expect(new STRTOK('').Next(' ')).toBeNull();
  });
});
