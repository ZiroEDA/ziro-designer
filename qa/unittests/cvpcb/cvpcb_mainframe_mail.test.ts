// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `CVPCB_MAINFRAME::SaveFootprintAssociation` (cvpcb/readwrite_dlgs.cpp:290):
 * the assignments go to the schematic as a `cvpcb_netlist` in
 * MAIL_ASSIGN_FOOTPRINTS, and "Apply, Save Schematic & Continue" follows with
 * MAIL_SCH_SAVE, whose answer decides "Schematic saved".
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { CVPCB_MAINFRAME, type CvpcbComponent } from '@ziroeda/cvpcb/cvpcb_mainframe.js';

class SCH_STUB extends KIWAY_PLAYER {
  readonly received: [MAIL_T, string][] = [];

  constructor(private readonly m_saveAnswer: string) {
    super(FRAME_T.FRAME_SCH, schIUScale, 'mm');
  }

  override KiwayMailIn(aEvent: KIWAY_MAIL_EVENT): void {
    this.received.push([aEvent.Command(), aEvent.GetPayload()]);
    if (aEvent.Command() === MAIL_T.MAIL_SCH_SAVE) aEvent.SetPayload(this.m_saveAnswer);
  }
}

const comp = (reference: string, footprint: string): CvpcbComponent => ({
  reference,
  value: 'v',
  footprint,
  fpFilters: [],
  pinCount: 2,
  instances: [],
});

function setup(saveAnswer = 'success') {
  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  const sch = new SCH_STUB(saveAnswer);
  kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
  const frame = new CVPCB_MAINFRAME();
  frame.SetKiway(kiway);
  return { sch, frame };
}

const COMPONENTS = [comp('R1', 'Old:R'), comp('C1', '')];

describe('SaveFootprintAssociation', () => {
  it('mails every component with its footprint now, assigned or not', () => {
    const { sch, frame } = setup();
    const saved = frame.SaveFootprintAssociation(false, COMPONENTS, new Map([['C1', 'New:C']]));
    expect(saved).toBe(false);
    expect(sch.received).toEqual([
      [
        MAIL_T.MAIL_ASSIGN_FOOTPRINTS,
        '(cvpcb_netlist\n  (ref "R1" (fpid "Old:R")\n  )\n  (ref "C1" (fpid "New:C")\n  )\n)\n',
      ],
    ]);
  });

  it('follows with MAIL_SCH_SAVE when asked, and reports the "success" answer', () => {
    const { sch, frame } = setup();
    expect(frame.SaveFootprintAssociation(true, COMPONENTS, new Map())).toBe(true);
    expect(sch.received.map(([c]) => c)).toEqual([
      MAIL_T.MAIL_ASSIGN_FOOTPRINTS,
      MAIL_T.MAIL_SCH_SAVE,
    ]);
    expect(sch.received[1]![1]).toBe('');
  });

  it('reports no save when the schematic does not answer "success"', () => {
    const { frame } = setup('nope');
    expect(frame.SaveFootprintAssociation(true, COMPONENTS, new Map())).toBe(false);
  });

  it('sends nothing from a window no KIWAY adopted', () => {
    const frame = new CVPCB_MAINFRAME();
    expect(frame.SaveFootprintAssociation(true, COMPONENTS, new Map())).toBe(false);
  });
});
