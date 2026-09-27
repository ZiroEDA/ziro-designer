// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/kiway.cpp` `ExpressMail` / `ProcessEvent`, `common/kiway_player.cpp`
 * `kiway_express`: mail reaches the live player of its destination through
 * `KiwayMailIn`, is dropped when no such player is alive, and carries its
 * answer back in the sender's payload.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';

class TEST_PLAYER extends KIWAY_PLAYER {
  readonly received: [FRAME_T, MAIL_T, string, unknown][] = [];

  constructor(
    aFrameType: FRAME_T,
    private readonly m_answer?: string,
  ) {
    super(aFrameType, pcbIUScale, 'mm');
  }

  override KiwayMailIn(aEvent: KIWAY_MAIL_EVENT): void {
    this.received.push([
      aEvent.Dest(),
      aEvent.Command(),
      aEvent.GetPayload(),
      aEvent.GetEventObject(),
    ]);

    if (this.m_answer !== undefined) aEvent.SetPayload(this.m_answer);
  }
}

function makeKiway(aShown: FRAME_T[] = []): KIWAY {
  return new KIWAY({
    OnKiCadExit: () => {},
    Player: (t) => {
      aShown.push(t);
      return t !== FRAME_T.FRAME_CALC;
    },
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
}

describe('KIWAY mail', () => {
  it('delivers to the live player of the destination, with its command, payload and source', () => {
    const kiway = makeKiway();
    const sch = new TEST_PLAYER(FRAME_T.FRAME_SCH);
    const pcb = new TEST_PLAYER(FRAME_T.FRAME_PCB_EDITOR);
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);

    kiway.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: '$PART: "R1"' },
      sch,
    );

    expect(pcb.received).toEqual([
      [FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_CROSS_PROBE, '$PART: "R1"', sch],
    ]);
    expect(sch.received).toEqual([]);
  });

  it('drops mail for a player that is not alive', () => {
    const kiway = makeKiway();
    const pcb = new TEST_PLAYER(FRAME_T.FRAME_PCB_EDITOR);

    kiway.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_CROSS_PROBE, { value: 'early' });
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);

    expect(pcb.received).toEqual([]);
  });

  it("returns the recipient's answer in the sender's payload (MAIL_SCH_GET_NETLIST)", () => {
    const kiway = makeKiway();
    kiway.SetPlayerFrame(
      FRAME_T.FRAME_SCH,
      new TEST_PLAYER(FRAME_T.FRAME_SCH, '(export (version "E"))'),
    );

    const payload = { value: '' };
    kiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_NETLIST, payload);

    expect(payload.value).toBe('(export (version "E"))');
  });

  it('forgets a player that closed, but not its successor', () => {
    const kiway = makeKiway();
    const first = new TEST_PLAYER(FRAME_T.FRAME_SCH);
    const second = new TEST_PLAYER(FRAME_T.FRAME_SCH);
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, first);
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, second);

    kiway.PlayerDidClose(FRAME_T.FRAME_SCH, first);
    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_SCH)).toBe(second);

    kiway.PlayerDidClose(FRAME_T.FRAME_SCH, second);
    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_SCH)).toBeNull();
    kiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_REFRESH, { value: '' });
    expect(second.received).toEqual([]);
  });

  it('holds mail for a player Player() is creating, and delivers it in order when it registers', () => {
    const shown: FRAME_T[] = [];
    const kiway = makeKiway(shown);
    const fpEdit = new TEST_PLAYER(FRAME_T.FRAME_FOOTPRINT_EDITOR);

    expect(kiway.Player(FRAME_T.FRAME_FOOTPRINT_EDITOR)).toBe(true);
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_EDITOR, MAIL_T.MAIL_FP_EDIT, {
      value: 'a.kicad_mod',
    });
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_EDITOR, MAIL_T.MAIL_RELOAD_LIB, { value: '' });
    expect(fpEdit.received).toEqual([]);

    kiway.SetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_EDITOR, fpEdit);
    expect(shown).toEqual([FRAME_T.FRAME_FOOTPRINT_EDITOR]);
    expect(fpEdit.received.map((r) => [r[1], r[2]])).toEqual([
      [MAIL_T.MAIL_FP_EDIT, 'a.kicad_mod'],
      [MAIL_T.MAIL_RELOAD_LIB, ''],
    ]);
  });

  it('holds nothing for a player the program could not create', () => {
    const kiway = makeKiway();
    const calc = new TEST_PLAYER(FRAME_T.FRAME_CALC);

    expect(kiway.Player(FRAME_T.FRAME_CALC)).toBe(false);
    kiway.ExpressMail(FRAME_T.FRAME_CALC, MAIL_T.MAIL_RELOAD_LIB, { value: '' });
    kiway.SetPlayerFrame(FRAME_T.FRAME_CALC, calc);

    expect(calc.received).toEqual([]);
  });

  it('answers GetPlayerFrame with the registered player only (Player( aFrameType, false ))', () => {
    const kiway = makeKiway();
    const pcb = new TEST_PLAYER(FRAME_T.FRAME_PCB_EDITOR);
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);

    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR)).toBe(pcb);
    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_SCH)).toBeNull();
  });
});
