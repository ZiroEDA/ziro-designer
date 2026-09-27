// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SCH_EDIT_FRAME::KiwayMailIn` → `ExecuteRemoteCommand` for the net probe
 * (`eeschema/cross-probing.cpp:202-259`), reached through KIWAY as the board
 * sends it, and the two packets the schematic sends back.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { STRTOK } from '@ziroeda/common/libc/string.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { SCH_EDIT_FRAME } from '@ziroeda/designer/src/editors/schematic/sch_edit_frame.js';

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
  const highlighted: string[] = [];
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => cfg,
    highlightNet: (n) => highlighted.push(n),
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
  return { cfg, highlighted, frame, pcb, probe };
}

describe('the board probing a net on the schematic', () => {
  it('$NET: highlights the named net, spaces and all, and "" clears', () => {
    const env = setup();
    env.probe('$NET: "Net A"');
    env.probe('$NET: ""');
    expect(env.highlighted).toEqual(['Net A', '']);
  });

  it('refuses $NET: when auto_highlight is off', () => {
    const env = setup();
    env.cfg.auto_highlight = false;
    env.probe('$NET: "GND"');
    expect(env.highlighted).toEqual([]);
  });

  it('ignores $CLEAR: and anything it does not know', () => {
    const env = setup();
    env.probe('$CLEAR: ""');
    env.probe('$NETS: "A,B"');
    env.probe('');
    expect(env.highlighted).toEqual([]);
  });
});

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
