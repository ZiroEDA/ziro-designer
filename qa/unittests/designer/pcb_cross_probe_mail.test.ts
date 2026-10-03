// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_EDIT_FRAME::KiwayMailIn` → `ExecuteRemoteCommand` for the net probes
 * (`pcbnew/cross-probing.cpp:83-240`), reached through KIWAY as the schematic
 * sends them, and `SendCrossProbeNetName` going the other way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { PCB_PAINTER } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { EVENTS } from '@ziroeda/common/tool/actions.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (net 3 "Net A")
  (footprint "R" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1" (at 0 0 0) (layer "F.Cu") (effects (font (size 1 1) (thickness 0.15)))))
  (footprint "R" (layer "F.Cu") (at 20 10)
    (property "Reference" "R2" (at 0 0 0) (layer "F.Cu") (effects (font (size 1 1) (thickness 0.15)))))
  (footprint "U" (layer "F.Cu") (at 30 10)
    (property "Reference" "U1" (at 0 0 0) (layer "F.Cu") (effects (font (size 1 1) (thickness 0.15))))
    (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))
    (pad "A/B" smd rect (at 2 0) (size 1 1) (layers "F.Cu")))
  (footprint "R" (layer "F.Cu") (at 40 10)
    (path "/aaaaaaaa-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000002/aaaaaaaa-0000-4000-8000-000000000003")
    (property "Reference" "R9" (at 0 0 0) (layer "F.Cu") (effects (font (size 1 1) (thickness 0.15)))))
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
  /**
   * The net highlight on the view's PCB_RENDER_SETTINGS, as sorted net codes
   * (empty when off): ExecuteRemoteCommand writes it there itself.
   */
  highlight(): number[];
  /**
   * Every PCB_ACTIONS::syncSelection(WithNets) the frame ran, the items named
   * as `$SELECT:` parts: [items, withNets, m_ProbingSchToPcb at the time].
   */
  synced: [string[], boolean, boolean][];
  /** How many times the frame ran Update PCB from Schematic. */
  updates(): number;
  probe(packet: string): void;
  select(packet: string, force?: boolean): void;
}

function setup(): Env {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  const synced: [string[], boolean, boolean][] = [];
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
    editZoneParams: () => {},
    selectCopperLayerPair: () => {},
    updatePcbFromSchematic: () => {
      updates += 1;
    },
  });
  frame.SetBoard(ParseBoard(BOARD), false);

  // The canvas the tool manager's VIEW comes from (ActivateGalCanvas): a
  // PCB_VIEW painted by PCB_PAINTER, whose render settings hold the highlight.
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(1000, 1000);
  const view = new PCB_VIEW();
  view.SetGAL(gal);
  view.SetPainter(new PCB_PAINTER(gal, FRAME_T.FRAME_PCB_EDITOR));
  frame.SetCanvas({
    GetView: () => view,
    GetGAL: () => gal,
    Refresh: () => {},
    ForceRefresh: () => {},
  } as unknown as PCB_DRAW_PANEL_GAL);
  frame.GetToolManager()!.SetEnvironment(frame.GetBoard(), view, null, settings, frame);
  // Centring on the probed net is FocusOnLocation's; this suite is about the highlight.
  settings.m_CrossProbing.center_on_items = false;

  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  frame.SetKiway(kiway);
  kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, frame);

  const mgr = frame.GetToolManager()!;
  const runAction = mgr.RunAction.bind(mgr);
  mgr.RunAction = ((aAction: TOOL_ACTION, aParam?: unknown) => {
    if (aAction === PCB_ACTIONS.syncSelection || aAction === PCB_ACTIONS.syncSelectionWithNets) {
      const parts = (aParam as BOARD_ITEM[]).map((i) =>
        i instanceof PAD
          ? `P${i.GetParentFootprint()!.GetReference()}/${i.GetNumber()}`
          : `F${(i as FOOTPRINT).GetReference()}`,
      );
      synced.push([parts, aAction === PCB_ACTIONS.syncSelectionWithNets, frame.m_ProbingSchToPcb]);
    }
    return runAction(aAction, aParam as never);
  }) as typeof mgr.RunAction;

  return {
    kiway,
    frame,
    settings,
    highlight: () => {
      const rs = view.GetPainter()!.GetSettings();
      return rs.IsHighlightEnabled() ? [...rs.GetHighlightNetCodes()].sort((a, b) => a - b) : [];
    },
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
    expect(env.highlight()).toEqual([2]);
    expect(env.frame.GetBoard()!.GetHighLightNetCodes().has(2)).toBe(true);
  });

  it('keeps a space inside the quoted name (strtok splits the rest on the quote only)', () => {
    const env = setup();
    env.probe('$NET: "Net A"');
    expect(env.highlight()).toEqual([3]);
  });

  it('clears the highlight for a net the board does not have, and for no name', () => {
    // netcode stays -1 and falls to `renderSettings->SetHighlight( false )`.
    const env = setup();
    env.probe('$NET: "VCC"');
    env.probe('$NET: "NOT_A_NET"');
    expect(env.highlight()).toEqual([]);
    env.probe('$NET: "VCC"');
    env.probe('$NET: ""');
    expect(env.highlight()).toEqual([]);
  });

  it('refuses $NET: when auto_highlight is off, leaving the current highlight alone', () => {
    const env = setup();
    env.probe('$NET: "Net A"');
    env.settings.m_CrossProbing.auto_highlight = false;
    env.probe('$NET: "VCC"');
    env.probe('$NETS: "GND,VCC"');
    expect(env.highlight()).toEqual([3]);
  });

  it('$NETS: highlights every named net the board has, skipping empty and unknown ones', () => {
    const env = setup();
    env.probe('$NETS: "GND,,NOPE, VCC"');
    expect(env.highlight()).toEqual([1, 2]);
    expect([...env.frame.GetBoard()!.GetHighLightNetCodes()].sort()).toEqual([1, 2]);
  });

  it('$NETS: with no known net clears', () => {
    const env = setup();
    env.probe('$NET: "VCC"');
    env.probe('$NETS: "NOPE"');
    expect(env.highlight()).toEqual([]);
  });

  it('$CLEAR clears even with auto_highlight off', () => {
    const env = setup();
    env.probe('$NET: "VCC"');
    env.settings.m_CrossProbing.auto_highlight = false;
    env.probe('$CLEAR\n');
    expect(env.highlight()).toEqual([]);
    expect(env.frame.GetBoard()!.IsHighLightNetON()).toBe(false);
  });

  it('ignores a command it does not know and an empty packet', () => {
    const env = setup();
    env.probe('$NET: "Net A"');
    env.probe('$NOPE: "VCC"');
    env.probe('   ');
    expect(env.highlight()).toEqual([3]);
  });

  it('ignores the mail once the frame has told KIWAY it closed', () => {
    const env = setup();
    env.kiway.PlayerDidClose(FRAME_T.FRAME_PCB_EDITOR, env.frame);
    env.probe('$NET: "VCC"');
    expect(env.highlight()).toEqual([]);
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
    // FindItemsFromSyncSelection, in the packet's order: R9 sits two sheets
    // down, on /…01/…02, which the S entry names by prefix.
    env.select('$SELECT: 0,FR1,PU1/3,S/aaaaaaaa-0000-4000-8000-000000000001/');
    expect(env.synced).toEqual([[['FR1', 'PU1/3', 'FR9'], false, true]]);
    expect(env.frame.m_ProbingSchToPcb).toBe(false);
  });

  it('mode 1 is "with connections"', () => {
    const env = setup();
    env.select('$SELECT: 1,FR1');
    expect(env.synced).toEqual([[['FR1'], true, true]]);
  });

  it('refuses MAIL_SELECTION when on_selection is off, but not MAIL_SELECTION_FORCE', () => {
    // `case MAIL_SELECTION: if( !on_selection ) break; KI_FALLTHROUGH;`
    const env = setup();
    env.settings.m_CrossProbing.on_selection = false;
    env.select('$SELECT: 0,FR1');
    env.select('$SELECT: 0,FR2', true);
    expect(env.synced).toEqual([[['FR2'], false, true]]);
  });

  it('selects what it found, and flashes it when flash_selection is on', () => {
    // StartCrossProbeFlash / OnCrossProbeFlashTimer (pcb_edit_frame.cpp:632-752):
    // cleared on even phases, restored on odd, selected for good after six.
    vi.useFakeTimers();
    try {
      const env = setup();
      env.settings.m_CrossProbing.flash_selection = true;
      const sel = env.frame.GetSelectionTool();
      const size = (): number => sel.GetSelection().Size();
      env.select('$SELECT: 0,FR1,FR2');
      expect(size()).toBe(2);
      expect(env.frame.m_crossProbeFlashing).toBe(true);
      vi.advanceTimersByTime(500);
      expect(size()).toBe(0);
      // The tick ran under the guard and put it back as it found it.
      expect(env.frame.m_ProbingSchToPcb).toBe(false);
      vi.advanceTimersByTime(500);
      expect(size()).toBe(2);
      vi.advanceTimersByTime(2500);
      expect(env.frame.m_crossProbeFlashing).toBe(false);
      expect(size()).toBe(2);
      vi.advanceTimersByTime(1000);
      expect(size()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names a pad by its escaped number, unescaped to match', () => {
    const env = setup();
    env.select('$SELECT: 0,PU1/A{slash}B');
    expect(env.synced).toEqual([[['PU1/A/B'], false, true]]);
  });

  it('S/ takes every footprint, the root sheet’s own among them', () => {
    // An empty sheet path is rewritten to "/" so that it prefix-matches.
    const env = setup();
    env.select('$SELECT: 0,S/');
    expect(env.synced).toEqual([[['FR1', 'FR2', 'FU1', 'FR9'], false, true]]);
  });

  it('StartCrossProbeFlash itself refuses with flash_selection off', () => {
    const env = setup();
    env.settings.m_CrossProbing.flash_selection = false;
    env.frame.StartCrossProbeFlash([env.frame.GetBoard()!.Footprints()[0]!]);
    expect(env.frame.m_crossProbeFlashing).toBe(false);
  });

  it('does not flash with flash_selection off, or with nothing found', () => {
    const env = setup();
    env.settings.m_CrossProbing.flash_selection = false;
    env.select('$SELECT: 0,FR1');
    expect(env.frame.m_crossProbeFlashing).toBe(false);
    env.settings.m_CrossProbing.flash_selection = true;
    env.select('$SELECT: 0,FR404');
    expect(env.frame.m_crossProbeFlashing).toBe(false);
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
    expect(env.synced).toEqual([[['FR1'], false, true]]);
  });
});

describe('the board syncing its selection to the schematic', () => {
  // PCB_EDIT_FRAME::SendSelectItemsToSch (pcbnew/cross-probing.cpp:349-399).
  const ITEMS = ParseBoard(`(kicad_pcb (version 20241229) (generator "pcbnew")
    (general (thickness 1.6)) (paper "A4")
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user))
    (footprint "R" (layer "F.Cu") (at 10 10)
      (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
      (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))
    (footprint "R" (layer "F.Cu") (at 20 10)
      (property "Reference" "R2" (at 0 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
      (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))
    (footprint "R" (layer "F.Cu") (at 30 10)
      (property "Reference" "R3" (at 0 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15)))))
    (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 0)))`);
  const [r1, r2, r3] = ITEMS.Footprints();
  const track = ITEMS.Tracks()[0]!;

  it('mails $SELECT: 0,<parts> as MAIL_SELECTION, or _FORCE, the parts sorted', () => {
    const env = setup();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);

    env.frame.SendSelectItemsToSch([r2!.Pads()[0]!, r1!, track], null, false);
    env.frame.SendSelectItemsToSch([r3!], null, true);

    expect(sch.received).toEqual([
      [MAIL_T.MAIL_SELECTION, '$SELECT: 0,FR1,PR2/1'],
      [MAIL_T.MAIL_SELECTION_FORCE, '$SELECT: 0,FR3'],
    ]);
  });

  it('names a focus item as mode 1, and a focus with no part as mode 0', () => {
    const env = setup();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);

    env.frame.SendSelectItemsToSch([r1!, r2!], r2!, false);
    env.frame.SendSelectItemsToSch([r1!, track], track, false);

    expect(sch.received).toEqual([
      [MAIL_T.MAIL_SELECTION, '$SELECT: 1,FR2,FR1,FR2'],
      [MAIL_T.MAIL_SELECTION, '$SELECT: 0,FR1'],
    ]);
  });

  it('sends nothing for a selection with no parts, so the schematic keeps its own', () => {
    const env = setup();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    env.frame.SendSelectItemsToSch([], null, false);
    env.frame.SendSelectItemsToSch([track], track, false);
    expect(sch.received).toEqual([]);
  });
});

describe('BOARD_EDITOR_CONTROL::CrossProbeToSch, on the selection events', () => {
  // board_editor_control.cpp:2097-2114, 2351-2355.
  // Each test its own: a selected item keeps its SELECTED flag.
  const R7 = (): FOOTPRINT =>
    ParseBoard(`(kicad_pcb (version 20241229) (generator "pcbnew")
    (general (thickness 1.6)) (paper "A4")
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user))
    (footprint "R" (layer "F.Cu") (at 10 10)
      (property "Reference" "R7" (at 0 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))))`).Footprints()[0]!;

  it('mails the selection whenever it changes', () => {
    const env = setup();
    const r7 = R7();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    env.frame.GetSelectionTool().AddItemToSel(r7, false);
    expect(sch.received).toEqual([[MAIL_T.MAIL_SELECTION, '$SELECT: 0,FR7']]);
  });

  it('stays quiet while the selection is the schematic’s own probe', () => {
    const env = setup();
    const r7 = R7();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    env.frame.m_ProbingSchToPcb = true;
    env.frame.GetSelectionTool().AddItemToSel(r7, false);
    expect(sch.received).toEqual([]);
  });

  it('names the clicked item as the focus on a point select', () => {
    const env = setup();
    const r7 = R7();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    env.frame.GetSelectionTool().AddItemToSel(r7, true);
    env.frame.GetToolManager()!.ProcessEvent(EVENTS.PointSelectedEvent);
    expect(sch.received).toEqual([[MAIL_T.MAIL_SELECTION, '$SELECT: 1,FR7,FR7']]);
  });

  it('forces it for Select on Schematic', () => {
    const env = setup();
    const r7 = R7();
    const sch = new SCH_STUB();
    env.kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
    env.frame.GetSelectionTool().AddItemToSel(r7, true);
    env.frame.GetToolManager()!.RunAction(PCB_ACTIONS.selectOnSchematic);
    expect(sch.received).toEqual([[MAIL_T.MAIL_SELECTION_FORCE, '$SELECT: 0,FR7']]);
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
