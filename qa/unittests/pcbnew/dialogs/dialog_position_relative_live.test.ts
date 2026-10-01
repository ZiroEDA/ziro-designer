// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_POSITION_RELATIVE (pcbnew/dialogs/dialog_position_relative.cpp) as a
 * PCB_PICKER_TOOL::RECEIVER with its two tools stubbed: the position-relative
 * tool it asks for the selection anchor and tells to move, and the picker it
 * hands its two pick actions to. KiCad has no qa for it; each expectation is
 * read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { TOOL_INTERACTIVE, SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  ANCHOR_TYPE,
  DIALOG_POSITION_RELATIVE,
} from '@ziroeda/pcbnew/dialogs/dialog_position_relative.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { PCB_ACTIONS, type INTERACTIVE_PARAMS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

class STUB_POSREL extends TOOL_INTERACTIVE {
  anchor: Vec2 = { x: 0, y: 0 };
  moves: { anchor: Vec2; translation: Vec2 }[] = [];

  constructor() {
    super('pcbnew.PositionRelative');
  }
  override Init(): boolean {
    return true;
  }
  override Reset(_r: RESET_REASON): void {}
  protected override setTransitions(): void {}
  GetSelectionAnchorPosition(): Vec2 {
    return this.anchor;
  }
  RelativeItemSelectionMove(aAnchor: Vec2, aTranslation: Vec2): number {
    this.moves.push({ anchor: aAnchor, translation: aTranslation });
    return 0;
  }
}

class STUB_PICKER extends TOOL_INTERACTIVE {
  asked: { action: string; params: INTERACTIVE_PARAMS }[] = [];

  constructor() {
    super('pcbnew.InteractivePicker');
  }
  override Init(): boolean {
    return true;
  }
  override Reset(_r: RESET_REASON): void {}
  protected override setTransitions(): void {
    const record =
      (aName: string) =>
      (aEvent: TOOL_EVENT): number => {
        this.asked.push({ action: aName, params: aEvent.Parameter<INTERACTIVE_PARAMS>() });
        return 0;
      };
    this.Go(
      SYNC_HANDLER<STUB_PICKER>(record('item')),
      PCB_ACTIONS.selectItemInteractively.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<STUB_PICKER>(record('point')),
      PCB_ACTIONS.selectPointInteractively.MakeEvent(),
    );
  }
}

let board: BOARD;
let frame: TEST_PCB_FRAME;
let posrel: STUB_POSREL;
let picker: STUB_PICKER;
let dlg: DIALOG_POSITION_RELATIVE;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "t")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (grid_origin 100 50))
  (gr_text "T" (at 5 6 0) (layer "Edge.Cuts") (uuid "00000000-0000-4000-8000-000000000001")
    (effects (font (size 1 1) (thickness 0.15)))))`;

function make(units: 'mm' | 'in' | 'mils' = 'mm'): void {
  board = ParseBoard(BOARD_TEXT);
  frame = new TEST_PCB_FRAME(board);
  frame.SetScreen(new PCB_SCREEN({ x: 297e6, y: 210e6 }));
  frame.SetUserUnits(units);
  posrel = new STUB_POSREL();
  picker = new STUB_PICKER();
  const mgr = frame.GetToolManager()!;
  mgr.RegisterTool(posrel);
  mgr.RegisterTool(picker);
  mgr.InitTools();
  dlg = new DIALOG_POSITION_RELATIVE(frame);
}

const typeXY = (x: string, y: string): void => {
  dlg.SetEntryText(dlg.m_xOffset, x);
  dlg.SetEntryText(dlg.m_yOffset, y);
};

beforeEach(() => {
  // `static ANCHOR_TYPE s_anchorType = ANCHOR_ITEM`: the persistent option, reset for each test
  DIALOG_POSITION_RELATIVE.s_anchorType = ANCHOR_TYPE.ANCHOR_ITEM;
  make();
});

describe('DIALOG_POSITION_RELATIVE controls (dialog_position_relative_base.cpp, .cpp:68, :143-162)', () => {
  it('starts as the base file states it: polar ticked, the reference info, both entries 0', () => {
    expect(dlg.m_polarCoords).toBe(true);
    expect(dlg.m_referenceInfo).toBe('Reference item: <none selected>');
    expect(dlg.m_xOffset.GetText()).toBe('0');
    expect(dlg.m_yOffset.GetText()).toBe('0');
    expect(dlg.IsShown()).toBe(false);
  });

  it('Show( true ) is InitDialog: TransferDataToWindow puts the polar labels on the entries (:143-151)', () => {
    dlg.Show(true);
    expect(dlg.IsShown()).toBe(true);
    expect(dlg.GetXLabel()).toBe('Distance:');
    expect(dlg.GetYLabel()).toBe('Angle:');
    expect(dlg.GetXUnitLabel()).toBe('mm');
    expect(dlg.GetYUnitLabel()).toBe('°');
    expect(dlg.m_clearXToolTip).toBe('Reset to the current distance from the reference position.');
    expect(dlg.m_clearYToolTip).toBe('Reset to the current angle from the reference position.');
  });

  it('unticking polar gives Offset X/Y in the frame units (:152-159)', () => {
    make('mils');
    dlg.Show(true);
    dlg.OnPolarChanged(false);
    expect(dlg.GetXLabel()).toBe('Offset X:');
    expect(dlg.GetYLabel()).toBe('Offset Y:');
    expect(dlg.GetXUnitLabel()).toBe('mils');
    expect(dlg.GetYUnitLabel()).toBe('mils');
    expect(dlg.m_clearXToolTip).toBe('Reset to the current X offset from the reference position.');
    expect(dlg.m_clearYToolTip).toBe('Reset to the current Y offset from the reference position.');
  });

  it("GetUserUnits is the units the dialog was made in, not the frame's now (DIALOG_SHIM m_units)", () => {
    frame.SetUserUnits('in');
    expect(dlg.GetUserUnits()).toBe('mm');
  });

  it('Hide leaves the dialog alive, Destroy does not', () => {
    dlg.Show(true);
    dlg.Hide();
    expect(dlg.IsShown()).toBe(false);
    expect(dlg.IsDestroyed()).toBe(false);
    dlg.Destroy();
    expect(dlg.IsDestroyed()).toBe(true);
    dlg.Show(true);
    expect(dlg.IsShown()).toBe(false);
  });
});

describe('DIALOG_POSITION_RELATIVE::OnPolarChanged (:95-141)', () => {
  beforeEach(() => {
    // InitDialog: the angle entry is in degrees from the first Show
    dlg.Show(true);
  });

  it('Cartesian to polar: the distance and the angle of the typed vector (:108-118)', () => {
    dlg.OnPolarChanged(false);
    typeXY('3', '4');
    dlg.OnPolarChanged(true);
    expect(dlg.m_xOffset.GetText()).toBe('5');
    // pcbnew shows a relative angle negated while Y is not inverted (pcb_origin_transforms.cpp:76):
    // the vector (3,4) points down-right on a Y-down board, which is -53.13 degrees counter-clockwise.
    // Four digits: StringFromValue prints DEGREES with %.4f
    expect(dlg.m_yOffset.GetText()).toBe('-53.1301');
  });

  it('polar to Cartesian: the distance and the typed angle become x and y (:120-135)', () => {
    typeXY('10', '90');
    dlg.OnPolarChanged(false);
    // r cos 90 = 0 and r sin 90 = 10, the typed angle used as it is (no FromDisplay at :123)
    expect(dlg.m_xOffset.GetText()).toBe('0');
    expect(dlg.m_yOffset.GetText()).toBe('10');
  });

  it('the typed angle goes in as the displayed one, so Cartesian -> polar -> Cartesian flips y (:123-126)', () => {
    // upstream's else branch reads the angle entry with GetDoubleValue(), which is the DISPLAYED
    // angle (-53.13), and takes its sine: y = 5 * sin( -53.13 deg ) = -4
    dlg.OnPolarChanged(false);
    typeXY('3', '4');
    dlg.OnPolarChanged(true);
    dlg.OnPolarChanged(false);
    // the angle entry holds four digits (-53.1301), so the round trip loses precision as the
    // field text does in KiCad: 5 cos(-53.1301 deg) = 3.00000016435, 5 sin(-53.1301 deg) = -3.99999987674
    expect(dlg.m_xOffset.GetText()).toBe('3.0000001644');
    expect(dlg.m_yOffset.GetText()).toBe('-3.9999998767');
  });

  it('an unchanged pair restores the remembered values rather than recomputing (:112-116)', () => {
    typeXY('10', '400');
    dlg.OnPolarChanged(false); // m_stateTheta = EDA_ANGLE( 400 ), unnormalised
    dlg.OnPolarChanged(true); // nothing edited since: SetAngleValue( m_stateTheta )
    expect(dlg.m_xOffset.GetText()).toBe('10');
    // a recomputation from the Cartesian vector would give an angle within +-180
    expect(dlg.m_yOffset.GetText()).toBe('-400');
  });

  it('an edit between toggles is recomputed from the entries (:107-110)', () => {
    typeXY('10', '400');
    dlg.OnPolarChanged(false);
    dlg.OnPolarChanged(true);
    typeXY('10', '30');
    dlg.OnPolarChanged(false);
    expect(dlg.m_xOffset.GetText()).toBe('8.6602540378');
    expect(dlg.m_yOffset.GetText()).toBe('5');
  });

  it('a zero vector has angle 0 (ToPolarDeg, :88-90)', () => {
    expect(dlg.ToPolarDeg(0, 0).q.AsDegrees()).toBe(0);
    expect(dlg.ToPolarDeg(0, 0).r).toBe(0);
  });
});

describe('DIALOG_POSITION_RELATIVE anchors (:200-292)', () => {
  it('starts on ANCHOR_ITEM, as the static does (dialog_position_relative.cpp:36)', () => {
    expect(DIALOG_POSITION_RELATIVE.s_anchorType).toBe(ANCHOR_TYPE.ANCHOR_ITEM);
  });

  it('Use Grid Origin: the reference is the board grid origin (:233-234, :254-255)', () => {
    dlg.OnUseGridOriginClick();
    expect(dlg.m_referenceInfo).toBe('Reference location: grid origin');
    expect(dlg.getAnchorPos()).toEqual({ x: MM(100), y: MM(50) });
  });

  it("Use Local Origin: the reference is the screen's local origin (:236-237, :257-258)", () => {
    frame.GetScreen()!.m_LocalOrigin = { x: 7, y: 9 };
    dlg.OnUseUserOriginClick();
    expect(dlg.m_referenceInfo).toBe('Reference location: local coordinates origin');
    expect(dlg.getAnchorPos()).toEqual({ x: 7, y: 9 });
  });

  it('an item picked becomes the anchor and is described (:259-277, :293-307)', () => {
    const text = board.Drawings()[0]!;
    dlg.UpdatePickedItem(text);
    expect(dlg.m_referenceInfo).toBe(
      `Reference item: ${text.GetItemDescription(frame.GetUnitsProvider(), true)}`,
    );
    expect(dlg.getAnchorPos()).toEqual({ x: MM(5), y: MM(6) });
    expect(DIALOG_POSITION_RELATIVE.s_anchorType).toBe(ANCHOR_TYPE.ANCHOR_ITEM);
  });

  it('picking an item brings the dialog back (:304-306)', () => {
    const raised = dlg.GetRaiseCount();
    dlg.UpdatePickedItem(board.Drawings()[0]!);
    expect(dlg.IsShown()).toBe(true);
    expect(dlg.GetRaiseCount()).toBe(raised + 1);
  });

  it('picking nothing keeps the old item position and says <none selected> (:296-299)', () => {
    dlg.UpdatePickedItem(board.Drawings()[0]!);
    dlg.UpdatePickedItem(null);
    expect(dlg.m_referenceInfo).toBe('Reference item: <none selected>');
    expect(dlg.getAnchorPos()).toEqual({ x: MM(5), y: MM(6) });
  });

  it('a picked point is the anchor and is printed in the frame units (:279-285, :309-318)', () => {
    dlg.UpdatePickedPoint({ x: MM(12), y: MM(34) });
    expect(DIALOG_POSITION_RELATIVE.s_anchorType).toBe(ANCHOR_TYPE.ANCHOR_POINT);
    expect(dlg.getAnchorPos()).toEqual({ x: MM(12), y: MM(34) });
    expect(dlg.m_referenceInfo).toBe('Reference location: selected point (12.0000 mm, 34.0000 mm)');
    expect(dlg.IsShown()).toBe(true);
  });

  it('a cancelled point pick keeps the previous point (:316-317)', () => {
    dlg.UpdatePickedPoint({ x: MM(12), y: MM(34) });
    dlg.UpdatePickedPoint(null);
    expect(dlg.getAnchorPos()).toEqual({ x: MM(12), y: MM(34) });
  });

  it('the anchor type outlives the dialog: it is a static (.h:94-103)', () => {
    dlg.OnUseGridOriginClick();
    const second = new DIALOG_POSITION_RELATIVE(frame);
    expect(second.getAnchorPos()).toEqual({ x: MM(100), y: MM(50) });
  });
});

describe('DIALOG_POSITION_RELATIVE pick buttons (:186-211)', () => {
  it('Select Item... hides the dialog and runs selectItemInteractively with itself as the receiver', () => {
    dlg.Show(true);
    dlg.OnSelectItemClick();
    expect(dlg.IsShown()).toBe(false);
    expect(picker.asked).toHaveLength(1);
    expect(picker.asked[0]!.action).toBe('item');
    expect(picker.asked[0]!.params.m_Receiver).toBe(dlg);
    expect(picker.asked[0]!.params.m_Prompt).toBe('Select reference item...');
  });

  it('Select Point... hides, but does not close, the dialog (:199-207)', () => {
    dlg.Show(true);
    dlg.OnSelectPointClick();
    expect(dlg.IsShown()).toBe(false);
    expect(dlg.IsDestroyed()).toBe(false);
    expect(picker.asked[0]!.action).toBe('point');
    expect(picker.asked[0]!.params.m_Prompt).toBe('Select reference point...');
  });
});

describe('DIALOG_POSITION_RELATIVE::OnClear (:163-196)', () => {
  beforeEach(() => {
    // the selection's anchor is at (10,20); the reference point is at (7,4): offset (3,16)
    posrel.anchor = { x: MM(10), y: MM(20) };
    dlg.UpdatePickedPoint({ x: MM(7), y: MM(4) });
  });

  it('Reset X in Cartesian mode shows the current x offset from the reference (:180-181)', () => {
    dlg.OnPolarChanged(false);
    dlg.OnClear('x');
    expect(dlg.m_xOffset.GetText()).toBe('3');
    expect(dlg.m_yOffset.GetText()).toBe('0');
  });

  it('Reset Y in Cartesian mode shows the current y offset (:191-193)', () => {
    dlg.OnPolarChanged(false);
    dlg.OnClear('y');
    expect(dlg.m_yOffset.GetText()).toBe('16');
  });

  it('Reset X in polar mode shows the current distance (:176-178)', () => {
    dlg.Show(true);
    dlg.OnClear('x');
    // hypot(3, 16) = 16.2788205961 mm
    expect(dlg.m_xOffset.GetText()).toBe('16.2788205961');
  });

  it('Reset Y in polar mode shows the current angle, negated for display (:187-189)', () => {
    dlg.Show(true);
    dlg.OnClear('y');
    // atan2(16, 3) = 79.3803 degrees (four digits), shown negated
    expect(dlg.m_yOffset.GetText()).toBe('-79.3803');
  });
});

describe('DIALOG_POSITION_RELATIVE::OnOkClick (:330-348)', () => {
  it('hands the tool the anchor position and a Cartesian translation, then hides (:336-344)', () => {
    dlg.Show(true);
    dlg.OnUseGridOriginClick();
    dlg.OnPolarChanged(false);
    typeXY('3', '4');
    dlg.OnOkClick();
    expect(posrel.moves).toEqual([
      { anchor: { x: MM(100), y: MM(50) }, translation: { x: MM(3), y: MM(4) } },
    ]);
    expect(dlg.IsShown()).toBe(false);
  });

  it('polar entries are delivered as the vector they describe (:63-71)', () => {
    dlg.Show(true);
    dlg.OnUseGridOriginClick();
    // distance 10 mm, angle 90 degrees: the entry is a DISPLAYED angle, counter-clockwise on
    // screen, so GetAngleValue() negates it (:67) and the vector points up the Y-down board
    typeXY('10', '90');
    dlg.OnOkClick();
    expect(posrel.moves[0]!.translation).toEqual({ x: 0, y: -MM(10) });
  });

  it('rounds the polar vector to IU (KiROUND)', () => {
    dlg.Show(true);
    dlg.OnUseGridOriginClick();
    typeXY('1', '45');
    dlg.OnOkClick();
    // 1 mm at 45 degrees: 707106.78... rounds to 707107
    expect(posrel.moves[0]!.translation).toEqual({ x: 707107, y: -707107 });
  });

  it('Cancel hides it without moving anything', () => {
    dlg.Show(true);
    dlg.OnCancel();
    expect(dlg.IsShown()).toBe(false);
    expect(posrel.moves).toEqual([]);
  });
});

describe('DIALOG_POSITION_RELATIVE::OnTextFocusLost (:350-358)', () => {
  it('an entry left blank is reset to 0', () => {
    dlg.SetEntryText(dlg.m_xOffset, '');
    dlg.OnTextFocusLost(dlg.m_xOffset);
    expect(dlg.m_xOffset.GetText()).toBe('0');
  });

  it('an entry with text is left alone', () => {
    dlg.SetEntryText(dlg.m_xOffset, '2.5');
    dlg.OnTextFocusLost(dlg.m_xOffset);
    expect(dlg.m_xOffset.GetText()).toBe('2.5');
  });
});

describe('DIALOG_POSITION_RELATIVE window subscription', () => {
  it("tells the window after each change, and stops after Subscribe's remover", () => {
    let calls = 0;
    const off = dlg.Subscribe(() => calls++);
    dlg.OnUseGridOriginClick();
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    off();
    dlg.OnUseUserOriginClick();
    expect(calls).toBe(seen);
  });
});
