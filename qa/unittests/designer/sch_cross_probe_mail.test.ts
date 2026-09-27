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
  const synced: [string[], boolean][] = [];
  const assigned: string[] = [];
  let saveAnswer = true;
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => cfg,
    highlightNet: (n) => highlighted.push(n),
    syncSelection: (parts, focus) => synced.push([[...parts], focus]),
    assignFootprints: (payload) => {
      if (!payload.startsWith('(cvpcb_netlist')) throw new Error('not a cvpcb_netlist');
      assigned.push(payload);
    },
    saveProject: () => saveAnswer,
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
    highlighted,
    synced,
    assigned,
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

describe('the board syncing its selection to the schematic', () => {
  it('hands the parts after the two-character mode to the selection', () => {
    const env = setup();
    env.select('$SELECT: 0,FR1,PR2/1');
    env.select('$SELECT: 1,FR3');
    expect(env.synced).toEqual([
      [['FR1', 'PR2/1'], false],
      [['FR3'], true],
    ]);
  });

  it('refuses MAIL_SELECTION when on_selection is off, but not MAIL_SELECTION_FORCE', () => {
    const env = setup();
    env.cfg.on_selection = false;
    env.select('$SELECT: 0,FR1');
    env.select('$SELECT: 0,FR2', true);
    expect(env.synced).toEqual([[['FR2'], false]]);
  });

  it('drops a command too short to carry a sync string', () => {
    // `if( paramStr.size() < 2 ) break;` — the prefix itself is not checked.
    const env = setup();
    env.select('$SELECT: 0');
    env.select('$SELECT: ');
    expect(env.synced).toEqual([]);
  });
});

describe('the schematic syncing its selection to the board', () => {
  it('SendSelectItemsToPcb mails $SELECT: 0,<parts>, forced or not, and nothing for no parts', () => {
    const env = setup();
    env.frame.SendSelectItemsToPcb(['FR1', 'S/a/b/'], false);
    env.frame.SendSelectItemsToPcb(['PU1/2'], true);
    env.frame.SendSelectItemsToPcb([], true);
    expect(env.pcb.received).toEqual([
      [MAIL_T.MAIL_SELECTION, '$SELECT: 0,FR1,S/a/b/'],
      [MAIL_T.MAIL_SELECTION_FORCE, '$SELECT: 0,PU1/2'],
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
      highlightNet: () => {},
      syncSelection: () => {},
      assignFootprints: () => {},
      saveProject: () => true,
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
  it('MAIL_ASSIGN_FOOTPRINTS hands the payload to AssignFootprints', () => {
    const env = setup();
    env.mail(MAIL_T.MAIL_ASSIGN_FOOTPRINTS, '(cvpcb_netlist\n)\n');
    expect(env.assigned).toEqual(['(cvpcb_netlist\n)\n']);
  });

  it('swallows a payload AssignFootprints cannot read, as the IO_ERROR catch does', () => {
    const env = setup();
    expect(() => env.mail(MAIL_T.MAIL_ASSIGN_FOOTPRINTS, '(export)')).not.toThrow();
    expect(env.assigned).toEqual([]);
  });

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
