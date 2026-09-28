// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_EDIT_FRAME::KiwayMailIn` → `ExecuteRemoteCommand` for the net probes
 * (`pcbnew/cross-probing.cpp:83-240`), reached through KIWAY as the schematic
 * sends them, and `SendCrossProbeNetName` going the other way.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetPgm } from '@ziroeda/common/pgm_base.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME } from '@ziroeda/designer/src/editors/pcb/pcb_edit_frame.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (net 3 "Net A")
)
`;

class SCH_STUB extends KIWAY_PLAYER {
  readonly received: [MAIL_T, string][] = [];

  constructor() {
    super(FRAME_T.FRAME_SCH, schIUScale, 'mm');
  }

  override KiwayMailIn(aEvent: KIWAY_MAIL_EVENT): void {
    this.received.push([aEvent.Command(), aEvent.GetPayload()]);
  }
}

interface Env {
  kiway: KIWAY;
  frame: PCB_EDIT_FRAME;
  settings: PCBNEW_SETTINGS;
  /** Every highlight the frame asked the editor for, as sorted net codes. */
  highlights: number[][];
  /** Every selection the frame asked the editor to sync: [parts, selectConnections]. */
  synced: [string[], boolean][];
  /** How many times the frame ran Update PCB from Schematic. */
  updates(): number;
  probe(packet: string): void;
  select(packet: string, force?: boolean): void;
}

function setup(): Env {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  const highlights: number[][] = [];
  const synced: [string[], boolean][] = [];
  let updates = 0;
  const frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    createDrcDialog: () => {
      throw new Error('no DRC here');
    },
    isSingle: () => false,
    fetchNetlistFromSchematic: () => false,
    schematicNetlistText: () => null,
    projectText: () => null,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
    setHighlightNets: (codes) => highlights.push([...codes].sort((a, b) => a - b)),
    syncSelection: (parts, conn) => synced.push([[...parts], conn]),
    updatePcbFromSchematic: () => {
      updates += 1;
    },
  });
  frame.SetBoard(ParseBoard(BOARD), false);

  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  frame.SetKiway(kiway);
  kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, frame);

  return {
    kiway,
    frame,
    settings,
    highlights,
    synced,
    updates: () => updates,
    probe: (packet) =>
      kiway.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_CROSS_PROBE, { value: packet }),
    select: (packet, force = false) =>
      kiway.ExpressMail(
        FRAME_T.FRAME_PCB_EDITOR,
        force ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
        { value: packet },
      ),
  };
}

beforeEach(() => SetPgm(null));
afterEach(() => SetPgm(null));

describe('the schematic probing a net on the board', () => {
  it('$NET: highlights the named net', () => {
    const env = setup();
    env.probe('$NET: "VCC"');
    expect(env.highlights).toEqual([[2]]);
  });

  it('keeps a space inside the quoted name (strtok splits the rest on the quote only)', () => {
    const env = setup();
    env.probe('$NET: "Net A"');
    expect(env.highlights).toEqual([[3]]);
  });

  it('clears the highlight for a net the board does not have, and for no name', () => {
    // netcode stays -1 and falls to `renderSettings->SetHighlight( false )`.
    const env = setup();
    env.probe('$NET: "NOT_A_NET"');
    env.probe('$NET: ""');
    expect(env.highlights).toEqual([[], []]);
  });

  it('refuses $NET: when auto_highlight is off, leaving the current highlight alone', () => {
    const env = setup();
    env.settings.m_CrossProbing.auto_highlight = false;
    env.probe('$NET: "VCC"');
    env.probe('$NETS: "GND,VCC"');
    expect(env.highlights).toEqual([]);
  });

  it('$NETS: highlights every named net the board has, skipping empty and unknown ones', () => {
    const env = setup();
    env.probe('$NETS: "GND,,NOPE, VCC"');
    expect(env.highlights).toEqual([[1, 2]]);
  });

  it('$NETS: with no known net clears', () => {
    const env = setup();
    env.probe('$NETS: "NOPE"');
    expect(env.highlights).toEqual([[]]);
  });

  it('$CLEAR clears even with auto_highlight off', () => {
    const env = setup();
    env.settings.m_CrossProbing.auto_highlight = false;
    env.probe('$CLEAR\n');
    expect(env.highlights).toEqual([[]]);
  });

  it('ignores a command it does not know and an empty packet', () => {
    const env = setup();
    env.probe('$NOPE: "VCC"');
    env.probe('   ');
    expect(env.highlights).toEqual([]);
  });

  it('ignores the mail once the frame has told KIWAY it closed', () => {
    const env = setup();
    env.kiway.PlayerDidClose(FRAME_T.FRAME_PCB_EDITOR, env.frame);
    env.probe('$NET: "VCC"');
    expect(env.highlights).toEqual([]);
  });
});

describe('the board probing a net on the schematic', () => {
  it('SendCrossProbeNetName mails $NET: "<name>" to FRAME_SCH, and "" to clear', () => {
    const env = setup();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);

    env.frame.SendCrossProbeNetName('GND');
    env.frame.SendCrossProbeNetName('');

    expect(sch.received).toEqual([
      [MAIL_T.MAIL_CROSS_PROBE, '$NET: "GND"'],
      [MAIL_T.MAIL_CROSS_PROBE, '$NET: ""'],
    ]);
  });
});

describe('the schematic syncing its selection to the board', () => {
  it('MAIL_SELECTION hands the parts after the mode to the selection', () => {
    const env = setup();
    env.select('$SELECT: 0,FR1,PU1/3,S/abc/');
    expect(env.synced).toEqual([[['FR1', 'PU1/3', 'S/abc/'], false]]);
  });

  it('mode 1 is "with connections"', () => {
    const env = setup();
    env.select('$SELECT: 1,FR1');
    expect(env.synced).toEqual([[['FR1'], true]]);
  });

  it('refuses MAIL_SELECTION when on_selection is off, but not MAIL_SELECTION_FORCE', () => {
    // `case MAIL_SELECTION: if( !on_selection ) break; KI_FALLTHROUGH;`
    const env = setup();
    env.settings.m_CrossProbing.on_selection = false;
    env.select('$SELECT: 0,FR1');
    env.select('$SELECT: 0,FR2', true);
    expect(env.synced).toEqual([[['FR2'], false]]);
  });

  it('ignores a packet without the $SELECT: prefix', () => {
    const env = setup();
    env.select('$SELECTX 0,FR1');
    env.select('0,FR1');
    expect(env.synced).toEqual([]);
  });

  it('with no comma after the mode, syncs the whole parameter string (npos + 1 is 0)', () => {
    const env = setup();
    env.select('$SELECT: FR1');
    expect(env.synced).toEqual([[['FR1'], false]]);
  });
});

describe('the board syncing its selection to the schematic', () => {
  it('SendSelectItemsToSch mails $SELECT: 0,<parts> as MAIL_SELECTION, or _FORCE', () => {
    const env = setup();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);

    env.frame.SendSelectItemsToSch(['FR1', 'PR2/1'], false);
    env.frame.SendSelectItemsToSch(['FR3'], true);

    expect(sch.received).toEqual([
      [MAIL_T.MAIL_SELECTION, '$SELECT: 0,FR1,PR2/1'],
      [MAIL_T.MAIL_SELECTION_FORCE, '$SELECT: 0,FR3'],
    ]);
  });

  it('sends nothing for an empty selection, so the schematic keeps its own', () => {
    const env = setup();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    env.frame.SendSelectItemsToSch([], false);
    expect(sch.received).toEqual([]);
  });
});

describe('MAIL_PCB_UPDATE', () => {
  it('runs Update PCB from Schematic, whatever the payload', () => {
    const env = setup();
    env.kiway.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_PCB_UPDATE, { value: '' });
    expect(env.updates()).toBe(1);
    env.probe('$NET: "VCC"');
    expect(env.updates()).toBe(1);
  });
});
