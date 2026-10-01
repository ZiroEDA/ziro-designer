// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tools > Update Footprints from Library and Edit > Change Footprints:
 * GLOBAL_EDIT_TOOL::ExchangeFootprints, DIALOG_EXCHANGE_FOOTPRINTS
 * (dialog_exchange_footprints.cpp) and PCB_EDIT_FRAME::ExchangeFootprint
 * (pcb_edit_frame.cpp:2591-3062) on a real PCB_EDIT_FRAME and a live BOARD.
 * KiCad has no qa for them; each expectation cites its line.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
} from '@ziroeda/common/reporter.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import {
  type DIALOG_EXCHANGE_FOOTPRINTS,
  ID_MATCH_FP_ALL,
  ID_MATCH_FP_REF,
  ID_MATCH_FP_SELECTED,
} from '@ziroeda/pcbnew/dialogs/dialog_exchange_footprints.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { harnessCanvas } from '../support/pcb_tool_harness.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { FP_SMD } from '@ziroeda/pcbnew/footprint.js';

const U = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const MM = (n: number): number => Math.round(n * 1_000_000);

/** A board footprint: R1 at (10,10) on nets GND/VCC, its 1 x 1 pads, value "R". */
const boardFp = (ref: string, n: number, x: number, extra = '', layer = 'F.Cu') => `
  (footprint "Lib:R" (layer "${layer}") (uuid "${U(n)}") (at ${x} 10)
    (property "Reference" "${ref}" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(n + 1)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "R" (at 0 3 0) (layer "F.Fab") (uuid "${U(n + 2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    ${extra}
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "GND") (uuid "${U(n + 3)}"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 2 "VCC") (uuid "${U(n + 4)}")))`;

const BOARD_TEXT = (
  r1 = '',
  r1Layer = 'F.Cu',
) => `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (13 "F.Fab" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  ${boardFp('R1', 1, 10, r1, r1Layer)}
  ${boardFp('R2', 10, 30)}
)
`;

/** The library's footprints: Lib:R with 2 x 2 pads and its reference at y=-4, Lib:C with three pads. */
const LIB: Record<string, (seq: number) => string> = {
  R: (s) => `(footprint "R" (version 20241229) (layer "F.Cu") (attr smd)
    (property "Reference" "REF**" (at 0 -4 0) (layer "F.SilkS") (uuid "${U(900 + s)}")
      (effects (font (size 1.2 1.2) (thickness 0.15))))
    (property "Value" "R" (at 0 3 0) (layer "F.Fab") (uuid "${U(910 + s)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "2" smd rect (at 1 0) (size 2 2) (layers "F.Cu" "F.Mask") (uuid "${U(920 + s)}"))
    (pad "1" smd rect (at -1 0) (size 2 2) (layers "F.Cu" "F.Mask") (uuid "${U(930 + s)}")))`,
  // Lib:RS has pad 1 where the board's pad 2 is, and pad 2 where pad 1 is.
  RS: (s) => `(footprint "RS" (version 20241229) (layer "F.Cu")
    (property "Reference" "REF**" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(990 + s)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "RS" (at 0 3 0) (layer "F.Fab") (uuid "${U(995 + s)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(1000 + s)}"))
    (pad "2" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(1010 + s)}")))`,
  C: (s) => `(footprint "C" (version 20241229) (layer "F.Cu")
    (property "Reference" "REF**" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(940 + s)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "C" (at 0 3 0) (layer "F.Fab") (uuid "${U(950 + s)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(960 + s)}"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(970 + s)}"))
    (pad "3" smd rect (at 0 1) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(980 + s)}")))`,
};

beforeAll(() => {
  installPgm();
});

function setup(
  aR1Extra = '',
  aR1Layer = 'F.Cu',
  aLib: Record<string, (s: number) => string> = LIB,
) {
  let shown: DIALOG_EXCHANGE_FOOTPRINTS | null = null;
  let seq = 0;
  const settings = new PCBNEW_SETTINGS();
  const hooks = {
    settings: () => settings,
    onModify: () => {},
    updateProperties: () => {},
    showExchangeFootprintsDialog: (aDialog: DIALOG_EXCHANGE_FOOTPRINTS) => {
      shown = aDialog;
    },
    // FOOTPRINT_LIBRARY_ADAPTER::LoadFootprint (:344-349) stamps the row's nickname.
    loadFootprintFromLibrary: async (aId: LIB_ID) => {
      const text = aLib[aId.GetUniStringLibItemName()];
      if (!text) return null;
      const lib = ParseFootprintFile(text(seq++));
      const id = lib.GetFPID();
      id.SetLibNickname(aId.GetUniStringLibNickname());
      lib.SetFPID(id);
      return lib;
    },
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const f = new PCB_EDIT_FRAME(hooks);
  const board = ParseBoard(BOARD_TEXT(aR1Extra, aR1Layer));
  f.SetBoard(board);
  f.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  // The cursor sits off the board, so the menu actions' cursor selection
  // (RequestSelection with nothing selected) finds nothing.
  const { view, controls } = harnessCanvas(board, f, {
    mouse: { x: MM(-100), y: MM(-100) },
    forced: null,
  });
  f.GetToolManager()!.SetEnvironment(board, view, controls, settings as never, f);
  const fp = (aRef: string): FOOTPRINT =>
    board.Footprints().find((x) => x.GetReference() === aRef)!;
  const open = (aAction = PCB_ACTIONS.updateFootprints): DIALOG_EXCHANGE_FOOTPRINTS => {
    f.GetToolManager()!.RunAction(aAction);
    const dlg = shown!;
    dlg.TransferDataToWindow();
    return dlg;
  };
  return { f, board, fp, open };
}

describe('DIALOG_EXCHANGE_FOOTPRINTS', () => {
  it('Update with nothing selected: update mode, no Selected radio, the update defaults (:63-118)', () => {
    const { open } = setup();
    const dlg = open();
    expect(dlg.GetTitle()).toBe('Update Footprints from Library');
    expect(dlg.OkLabel()).toBe('Update');
    expect(dlg.ShowMatchSelected()).toBe(false);
    expect(dlg.ShowChangeSizer()).toBe(false);
    expect([dlg.m_resetTextItemLayers, dlg.m_resetFabricationAttrs]).toEqual([false, false]);
    expect([dlg.m_resetClearanceOverrides, dlg.m_reset3DModels, dlg.m_removeExtraBox]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('Change mode: the change labels and defaults, and no "all" radio (:65-79, :88-93)', () => {
    const { open } = setup();
    const dlg = open(PCB_ACTIONS.changeFootprints);
    expect(dlg.GetTitle()).toBe('Change Footprints');
    expect(dlg.ShowMatchAll()).toBe(false);
    expect(dlg.Labels().matchRef).toBe('Change footprints matching reference designator:');
    expect(dlg.m_resetTextItemLayers).toBe(true);
  });

  it('updates every footprint in place: identity, position, pad nets by number, one undo (:299-317, :2591-2685)', async () => {
    const { f, fp, open } = setup();
    const dlg = open();
    dlg.m_matchMode = ID_MATCH_FP_ALL;
    const undo = f.GetUndoCommandCount();
    await dlg.OnOKClicked();
    const r1 = fp('R1');
    expect(String(r1.m_Uuid)).toBe(U(1));
    expect(r1.GetPosition()).toEqual({ x: MM(10), y: MM(10) });
    const pad1 = r1.Pads().find((p) => p.GetNumber() === '1')!;
    expect(pad1.GetNetname()).toBe('GND');
    expect(String(pad1.m_Uuid)).toBe(U(4));
    expect(pad1.GetSize(PCB_LAYER_ID.F_Cu).x).toBe(MM(2));
    expect(f.GetUndoCommandCount()).toBe(undo + 1);
    expect(dlg.m_MessageWindow.lines.map((l) => [l.message, l.severity])).toEqual([
      ['Updated footprint R2 (Lib:R): : OK', RPT_SEVERITY_ACTION],
      ['Updated footprint R1 (Lib:R): : OK', RPT_SEVERITY_ACTION],
    ]);
  });

  it('an unchanged footprint reports "(no changes)" (:394-398)', async () => {
    const same: Record<string, (s: number) => string> = {
      R: (s) => `(footprint "R" (version 20241229) (layer "F.Cu")
        (property "Reference" "REF**" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(900 + s)}")
          (effects (font (size 1 1) (thickness 0.15))))
        (property "Value" "R" (at 0 3 0) (layer "F.Fab") (uuid "${U(910 + s)}")
          (effects (font (size 1 1) (thickness 0.15))))
        (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(920 + s)}"))
        (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(930 + s)}")))`,
    };
    const { open } = setup('', 'F.Cu', same);
    const dlg = open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    await dlg.OnOKClicked();
    expect(dlg.m_MessageWindow.lines).toEqual([
      {
        message: 'Updated footprint R1 (Lib:R): : (no changes)',
        severity: RPT_SEVERITY_INFO,
        location: 'body',
      },
    ]);
  });

  it('a missing library footprint is an error and leaves the board alone (:370-375)', async () => {
    const { f, fp, open } = setup('', 'F.Cu', {});
    const dlg = open();
    dlg.m_matchMode = ID_MATCH_FP_ALL;
    const before = fp('R1');
    const undo = f.GetUndoCommandCount();
    await dlg.OnOKClicked();
    expect(fp('R1')).toBe(before);
    expect(dlg.m_MessageWindow.lines[0]!.severity).toBe(RPT_SEVERITY_ERROR);
    expect(dlg.m_MessageWindow.lines[0]!.message).toBe(
      'Updated footprint R2 (Lib:R): *** library footprint not found ***',
    );
    expect(f.GetUndoCommandCount()).toBe(undo);
  });

  it('Change by reference: only R1 takes the new library id (:150-165, :319-349)', async () => {
    const { fp, open } = setup();
    const dlg = open(PCB_ACTIONS.changeFootprints);
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_newID = 'Lib:C';
    await dlg.OnOKClicked();
    expect(fp('R1').GetFPID().Format()).toBe('Lib:C');
    expect(fp('R1').Pads()).toHaveLength(3);
    expect(fp('R2').GetFPID().Format()).toBe('Lib:R');
    expect(dlg.m_MessageWindow.lines[0]!.message).toBe(
      "Changed footprint R1 from 'Lib:R' to 'Lib:C': : OK",
    );
  });

  it('Change with an invalid new id does nothing (:328-333)', async () => {
    const { f, open } = setup();
    const dlg = open(PCB_ACTIONS.changeFootprints);
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = '*';
    dlg.m_newID = '';
    const undo = f.GetUndoCommandCount();
    await dlg.OnOKClicked();
    expect(f.GetUndoCommandCount()).toBe(undo);
    expect(dlg.m_MessageWindow.lines).toHaveLength(0);
  });

  it('pads pair by number before position: a same-number pad scores 2 more (:2540-2544)', async () => {
    const { fp, open } = setup();
    const dlg = open(PCB_ACTIONS.changeFootprints);
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_newID = 'Lib:RS';
    await dlg.OnOKClicked();
    const pads = fp('R1').Pads();
    expect(pads.find((p) => p.GetNumber() === '1')!.GetNetname()).toBe('GND');
    expect(pads.find((p) => p.GetNumber() === '2')!.GetNetname()).toBe('VCC');
  });

  it('ExchangeFootprint unconnects a new pad no old pad matched (:2662-2669)', () => {
    const { f, fp } = setup();
    const r1 = fp('R1');
    const lib = ParseFootprintFile(LIB.C!(0));
    // On the board, so a net code means its net.
    lib.SetParent(f.GetBoard());
    for (const pad of lib.Pads()) pad.SetNetCode(2);
    expect(lib.Pads()[2]!.GetNetCode()).toBe(2);
    f.ExchangeFootprint(
      r1,
      lib,
      new BOARD_COMMIT(f),
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    );
    expect(
      lib
        .Pads()
        .find((p) => p.GetNumber() === '3')!
        .GetNetCode(),
    ).toBe(0);
    expect(
      lib
        .Pads()
        .find((p) => p.GetNumber() === '1')!
        .GetNetCode(),
    ).toBe(1);
  });

  it('a new pad with no old counterpart is unconnected (:2662-2669)', async () => {
    const { fp, open } = setup();
    const dlg = open(PCB_ACTIONS.changeFootprints);
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_newID = 'Lib:C';
    await dlg.OnOKClicked();
    const pads = fp('R1').Pads();
    expect(pads.find((p) => p.GetNumber() === '1')!.GetNetname()).toBe('GND');
    expect(pads.find((p) => p.GetNumber() === '3')!.GetNetCode()).toBe(0);
  });

  it('text positions: kept unless reset (processTextItem :2502-2511)', async () => {
    let s = setup();
    let dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    await dlg.OnOKClicked();
    expect(s.fp('R1').Reference().GetFPRelativePosition()).toEqual({ x: 0, y: MM(-3) });

    s = setup();
    dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_resetTextItemPositions = true;
    await dlg.OnOKClicked();
    expect(s.fp('R1').Reference().GetFPRelativePosition()).toEqual({ x: 0, y: MM(-4) });
  });

  it('text sizes: kept unless reset (processTextItem :2490-2500)', async () => {
    let s = setup();
    let dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    await dlg.OnOKClicked();
    expect(s.fp('R1').Reference().GetTextSize().x).toBe(MM(1));

    s = setup();
    dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_resetTextItemEffects = true;
    await dlg.OnOKClicked();
    expect(s.fp('R1').Reference().GetTextSize().x).toBe(MM(1.2));
    // positions not reset: the board's, without SetAttributes to carry it (:2508-2510)
    expect(s.fp('R1').Reference().GetFPRelativePosition()).toEqual({ x: 0, y: MM(-3) });
  });

  it('the reference text is always the board one (:2894-2896)', async () => {
    const { fp, open } = setup();
    const dlg = open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_resetTextItemContent = true;
    await dlg.OnOKClicked();
    expect(fp('R1').GetReference()).toBe('R1');
  });

  it('fabrication attributes: the board ones kept unless reset (:2961-2971)', async () => {
    let s = setup();
    let dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    await dlg.OnOKClicked();
    expect(s.fp('R1').GetAttributes() & FP_SMD).toBe(0);

    s = setup();
    dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_resetFabricationAttrs = true;
    await dlg.OnOKClicked();
    expect(s.fp('R1').GetAttributes() & FP_SMD).toBe(FP_SMD);
  });

  it('an extra board text is kept, or removed with "Remove text items" (:2858-2875)', async () => {
    const extra = `(fp_text user "NOTE" (at 0 5 0) (layer "F.SilkS") (uuid "${U(50)}")
      (effects (font (size 1 1) (thickness 0.15))))`;
    let s = setup(extra);
    let dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    await dlg.OnOKClicked();
    const texts = (fp: FOOTPRINT) => fp.GraphicalItems().filter((i) => i.GetClass() === 'PCB_TEXT');
    expect(texts(s.fp('R1'))).toHaveLength(1);

    s = setup(extra);
    dlg = s.open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    dlg.m_removeExtraBox = true;
    await dlg.OnOKClicked();
    expect(texts(s.fp('R1'))).toHaveLength(0);
  });

  it('a back-side footprint comes back on the back (:2617-2618)', async () => {
    const { fp, open } = setup('', 'B.Cu');
    const dlg = open();
    dlg.m_matchMode = ID_MATCH_FP_REF;
    dlg.m_specifiedRef = 'R1';
    await dlg.OnOKClicked();
    expect(fp('R1').GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('Selected mode updates the selected footprint only, and selects the result (:172-173, :308)', async () => {
    const { f, fp, open } = setup();
    const r2 = fp('R2');
    f.GetToolManager()!.RunAction(ACTIONS.selectItem, r2);
    const dlg = open(PCB_ACTIONS.updateFootprints);
    expect(dlg.ShowMatchSelected()).toBe(true);
    expect(dlg.m_matchMode).toBe(ID_MATCH_FP_SELECTED);
    await dlg.OnOKClicked();
    expect(fp('R2')).not.toBe(r2);
    expect(fp('R2').IsSelected()).toBe(true);
    expect(dlg.m_MessageWindow.lines).toHaveLength(1);
  });

  it('Check All / Uncheck All set all eight options (:286-296)', () => {
    const { open } = setup();
    const dlg = open();
    dlg.CheckAll(true);
    expect([dlg.m_removeExtraBox, dlg.m_resetTextItemContent, dlg.m_reset3DModels]).toEqual([
      true,
      true,
      true,
    ]);
    dlg.CheckAll(false);
    expect([dlg.m_resetClearanceOverrides, dlg.m_resetTextItemLayers, dlg.m_reset3DModels]).toEqual(
      [false, false, false],
    );
  });

  it('fills the match fields from the current footprint (:137-149)', () => {
    const { f, fp, open } = setup();
    f.GetToolManager()!.RunAction(ACTIONS.selectItem, fp('R1'));
    const dlg = open(PCB_ACTIONS.changeFootprints);
    expect([dlg.m_specifiedRef, dlg.m_specifiedValue, dlg.m_specifiedID]).toEqual([
      'R1',
      'R',
      'Lib:R',
    ]);
    expect(dlg.m_newID).toBe('');
  });
});
