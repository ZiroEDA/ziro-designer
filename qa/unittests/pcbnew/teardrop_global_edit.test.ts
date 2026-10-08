// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Teardrops (DIALOG_GLOBAL_EDIT_TEARDROPS) over the live BOARD: the scope
 * checkboxes, the filter gauntlet, the four actions, and the BOARD_COMMITs
 * that carry them (dialog_global_edit_teardrops.cpp TransferDataFromWindow).
 */
import { describe, it, expect } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_GLOBAL_EDIT_TEARDROPS,
  TEARDROP_ACTION,
} from '@ziroeda/pcbnew/dialogs/dialog_global_edit_teardrops.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { TARGET_TD } from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';
import { TEARDROP_TYPE } from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let uuidSeq = 0;
const U = (): string => `00000000-0000-4000-8000-${(++uuidSeq).toString(16).padStart(12, '0')}`;

const seg = (x1: number, x2: number, net = 1): string =>
  `(segment (start ${x1} 10) (end ${x2} 10) (width 0.25) (layer "F.Cu") (net ${net}) (uuid "${U()}"))`;

/**
 * One via, one round SMD pad, one rectangular PTH pad, each with a track
 * running into it. `viaNet` moves the via (and its track) to net 2.
 */
function mixed(opts: { viaNet?: number; viaTd?: string; padTd?: string } = {}): BOARD {
  const vn = opts.viaNet ?? 1;
  const padTd = opts.padTd ?? '';
  const text = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net ${vn}) ${opts.viaTd ?? ''} (uuid "${U()}"))
  (footprint "R" (layer "F.Cu") (uuid "${U()}") (at 20 10)
    (pad "1" smd circle (at 0 0) (size 1.5 1.5) (layers "F.Cu") (net 1 "N1") ${padTd} (uuid "${U()}"))
    (pad "2" thru_hole rect (at 10 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask") (net 1 "N1") ${padTd} (uuid "${U()}")))
  ${seg(10, 15, vn)}
  ${seg(20, 25)}
  ${seg(30, 35)}
)`;
  const board = new PCB_IO_KICAD_SEXPR_PARSER(text, 'mixed.kicad_pcb').Parse() as BOARD;
  board.BuildConnectivity();
  return board;
}

/** A PCB_EDIT_FRAME without the window: the model, the settings and the tool manager. */
class TEST_PCB_EDIT_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();

  constructor(board: BOARD) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.SetBoard(board);
    this.SetScreen(new PCB_SCREEN({ x: MM(297), y: MM(210) }));
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(board, null, null, this.settings, this);
  }

  GetName(): string {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.settings;
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
}

/** Open the dialog on `board` (TransferDataToWindow), set its controls, then OK. */
function run(
  board: BOARD,
  aSet: (dlg: DIALOG_GLOBAL_EDIT_TEARDROPS) => void = () => {},
): TEST_PCB_EDIT_FRAME {
  const frame = new TEST_PCB_EDIT_FRAME(board);
  const dlg = new DIALOG_GLOBAL_EDIT_TEARDROPS(frame as unknown as PCB_EDIT_FRAME);
  dlg.TransferDataToWindow();
  aSet(dlg);
  dlg.TransferDataFromWindow();
  return frame;
}

const viaOf = (b: BOARD): PCB_VIA =>
  b.Tracks().find((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA;
const padsOf = (b: BOARD): PAD[] => b.Footprints()[0]!.Pads();
const smd = (b: BOARD): PAD => padsOf(b).find((p) => p.GetNumber() === '1')!;
const pth = (b: BOARD): PAD => padsOf(b).find((p) => p.GetNumber() === '2')!;
const tdZones = (b: BOARD) => b.Zones().filter((z) => z.IsTeardropArea());
const enabled = (b: BOARD): number =>
  [viaOf(b), ...padsOf(b)].filter((i) => i.GetTeardropParams().m_Enabled).length;

describe('action: add teardrops with default values', () => {
  it('enables every item in scope and generates a zone for each', () => {
    const b = mixed();
    run(b);

    expect(enabled(b)).toBe(3);
    expect(tdZones(b)).toHaveLength(3);
    expect(tdZones(b).every((z) => z.GetTeardropAreaType() === TEARDROP_TYPE.TD_VIAPAD)).toBe(true);
  });

  it('takes the round parameters for round items and the rect ones otherwise', () => {
    const b = mixed();
    const list = b.GetDesignSettings().GetTeadropParamsList();
    list.GetParameters(TARGET_TD.TARGET_ROUND).m_CurvedEdges = true;
    list.GetParameters(TARGET_TD.TARGET_RECT).m_CurvedEdges = false;
    run(b);

    expect(viaOf(b).GetTeardropParams().m_CurvedEdges).toBe(true);
    expect(smd(b).GetTeardropParams().m_CurvedEdges).toBe(true); // circle
    expect(pth(b).GetTeardropParams().m_CurvedEdges).toBe(false); // rect
  });

  it('is one undo step, and undoing it takes the teardrops away again', () => {
    const b = mixed();
    const frame = run(b);
    expect(tdZones(b)).toHaveLength(3);
    // The edit and the rebuild are two Pushes; the second is APPEND_UNDO.
    expect(frame.GetUndoCommandCount()).toBe(1);

    frame.RestoreCopyFromUndoList();
    expect(tdZones(b)).toHaveLength(0);
    expect(enabled(b)).toBe(0);
  });

  it('saves the scope checkboxes into BOARD_DESIGN_SETTINGS', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_vias = false;
      d.m_pthPads = false;
      d.m_trackToTrack = true;
      d.m_roundPadsFilter = true;
    });
    const list = b.GetDesignSettings().GetTeadropParamsList();

    expect(list.m_TargetVias).toBe(false);
    expect(list.m_TargetPTHPads).toBe(false);
    expect(list.m_TargetSMDPads).toBe(true);
    expect(list.m_TargetTrack2Track).toBe(true);
    expect(list.m_UseRoundShapesOnly).toBe(true);
    // Track to track with "add defaults" is what switches TARGET_TRACK on.
    expect(list.GetParameters(TARGET_TD.TARGET_TRACK).m_Enabled).toBe(true);
  });
});

describe('scope', () => {
  it('leaves vias alone when the Vias box is off', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_vias = false;
    });

    expect(viaOf(b).GetTeardropParams().m_Enabled).toBe(false);
    expect(enabled(b)).toBe(2);
  });

  it('splits PTH from SMD pads', () => {
    const smdOnly = mixed();
    run(smdOnly, (d) => {
      d.m_pthPads = false;
    });
    expect(smd(smdOnly).GetTeardropParams().m_Enabled).toBe(true);
    expect(pth(smdOnly).GetTeardropParams().m_Enabled).toBe(false);

    const pthOnly = mixed();
    run(pthOnly, (d) => {
      d.m_smdPads = false;
    });
    expect(smd(pthOnly).GetTeardropParams().m_Enabled).toBe(false);
    expect(pth(pthOnly).GetTeardropParams().m_Enabled).toBe(true);
  });
});

describe('filters', () => {
  it('filters by net', () => {
    const b = mixed({ viaNet: 2 });
    run(b, (d) => {
      d.m_netFilterOpt = true;
      d.m_netFilter = 1;
    });

    expect(viaOf(b).GetTeardropParams().m_Enabled).toBe(false);
    expect(enabled(b)).toBe(2);
  });

  it('filters by layer', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_layerFilterOpt = true;
      d.m_layerFilter = PCB_LAYER_ID.B_Cu;
    });
    expect(enabled(b)).toBe(0);
  });

  it('filters to round pads only', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_roundPadsFilter = true;
    });

    expect(smd(b).GetTeardropParams().m_Enabled).toBe(true);
    expect(pth(b).GetTeardropParams().m_Enabled).toBe(false);
  });

  it('filters to existing teardrops only, and does not enable what was off', () => {
    const b = mixed({ viaTd: '(teardrops (enabled yes))' });
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.SPECIFIED;
      d.m_existingFilter = true;
      d.m_curvedEdges = true;
    });

    expect(viaOf(b).GetTeardropParams().m_CurvedEdges).toBe(true);
    // The pads had no teardrops, so the filter skipped them entirely.
    expect(padsOf(b).every((p) => !p.GetTeardropParams().m_CurvedEdges)).toBe(true);
    expect(padsOf(b).every((p) => !p.GetTeardropParams().m_Enabled)).toBe(true);
  });

  it('filters to the selection', () => {
    const b = mixed();
    viaOf(b).SetSelected();
    run(b, (d) => {
      d.m_selectedItemsFilter = true;
    });

    expect(viaOf(b).GetTeardropParams().m_Enabled).toBe(true);
    expect(padsOf(b).every((p) => !p.GetTeardropParams().m_Enabled)).toBe(true);
  });

  it('reads the selection off the items themselves (EDA_ITEM::IsSelected)', () => {
    const b = mixed();
    smd(b).SetSelected();
    run(b, (d) => {
      d.m_selectedItemsFilter = true;
    });

    expect(smd(b).GetTeardropParams().m_Enabled).toBe(true);
    expect(enabled(b)).toBe(1);
  });

  it('a filter applies only when its box is ticked (:315-332)', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_layerFilter = PCB_LAYER_ID.B_Cu;
      d.m_netclassFilter = 'Power';
      d.m_netFilter = 2;
    });
    expect(enabled(b)).toBe(3);
  });

  it('filters by the effective netclass, constituents included', () => {
    // No assignments: every net's effective class is Default.
    const power = mixed();
    run(power, (d) => {
      d.m_netclassFilterOpt = true;
      d.m_netclassFilter = 'Power';
    });
    expect(enabled(power)).toBe(0);

    const def = mixed();
    run(def, (d) => {
      d.m_netclassFilterOpt = true;
      d.m_netclassFilter = 'Default';
    });
    expect(enabled(def)).toBe(3);
  });
});

describe('action: remove', () => {
  const enabledBoard = (): BOARD => {
    const b = mixed();
    run(b);
    return b;
  };

  it('clears m_Enabled on the filtered items and drops their zones', () => {
    const b = enabledBoard();
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.REMOVE;
    });

    expect(enabled(b)).toBe(0);
    expect(tdZones(b)).toHaveLength(0);
  });

  it('honours the filters', () => {
    const b = enabledBoard();
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.REMOVE;
      d.m_roundPadsFilter = true;
    });

    // The rect pad kept its teardrop; the round items lost theirs.
    expect(pth(b).GetTeardropParams().m_Enabled).toBe(true);
    expect(viaOf(b).GetTeardropParams().m_Enabled).toBe(false);
    expect(tdZones(b)).toHaveLength(1);
  });

  it('remove-all ignores the filters', () => {
    const b = enabledBoard();
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.REMOVE_ALL;
      d.m_roundPadsFilter = true;
      d.m_netFilterOpt = true;
      d.m_netFilter = 999;
      d.m_vias = false;
    });

    expect(enabled(b)).toBe(0);
  });

  it('remove-all still respects "selected items only"', () => {
    const b = enabledBoard();
    viaOf(b).SetSelected();
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.REMOVE_ALL;
      d.m_selectedItemsFilter = true;
    });

    expect(viaOf(b).GetTeardropParams().m_Enabled).toBe(false);
    expect(padsOf(b).every((p) => p.GetTeardropParams().m_Enabled)).toBe(true);
  });
});

describe('action: specified values', () => {
  it('overlays only the fields given, leaving the rest untouched', () => {
    const b = mixed({ viaTd: '(teardrops (enabled yes) (max_length 3) (best_width_ratio 0.42))' });
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.SPECIFIED;
      d.m_curvedEdges = true;
    });

    const td = viaOf(b).GetTeardropParams();
    expect(td.m_CurvedEdges).toBe(true);
    // The indeterminate fields survived.
    expect(td.m_TdMaxLen).toBe(MM(3));
    expect(td.m_BestWidthRatio).toBe(0.42);
  });

  it('enables items it touches unless the existing-only filter is on', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.SPECIFIED;
      d.m_teardropMaxHeight.SetValue(MM(1));
    });

    expect(enabled(b)).toBe(3);
    expect(viaOf(b).GetTeardropParams().m_TdMaxWidth).toBe(MM(1));
  });
});

describe('DIALOG_GLOBAL_EDIT_TEARDROPS controls', () => {
  const open = (b: BOARD): DIALOG_GLOBAL_EDIT_TEARDROPS => {
    const dlg = new DIALOG_GLOBAL_EDIT_TEARDROPS(
      new TEST_PCB_EDIT_FRAME(b) as unknown as PCB_EDIT_FRAME,
    );
    dlg.TransferDataToWindow();
    return dlg;
  };

  it('opens on the board scope, "add defaults", every specified value undetermined (:166-185)', () => {
    const b = mixed();
    const list = b.GetDesignSettings().GetTeadropParamsList();
    list.m_TargetVias = false;
    list.m_TargetTrack2Track = true;
    list.m_UseRoundShapesOnly = true;
    const dlg = open(b);
    expect([dlg.m_vias, dlg.m_pthPads, dlg.m_smdPads, dlg.m_trackToTrack]).toEqual([
      false,
      true,
      true,
      true,
    ]);
    // TransferDataToWindow does not read m_UseRoundShapesOnly back.
    expect(dlg.m_roundPadsFilter).toBe(false);
    expect(dlg.m_action).toBe(TEARDROP_ACTION.ADD_DEFAULTS);
    expect([dlg.m_cbPreferZoneConnection, dlg.m_curvedEdges]).toEqual([null, null]);
    expect(dlg.m_teardropMaxLen.IsIndeterminate()).toBe(true);
    expect(dlg.m_teardropHDPercent.IsIndeterminate()).toBe(true);
  });

  it('the percentages are percent: 50 is a ratio of 0.5 (:236-247)', () => {
    const b = mixed();
    run(b, (d) => {
      d.m_action = TEARDROP_ACTION.SPECIFIED;
      d.m_teardropLenPercent.SetValue(50);
      d.m_cbPreferZoneConnection = true;
    });
    expect(viaOf(b).GetTeardropParams().m_BestLengthRatio).toBe(0.5);
    expect(viaOf(b).GetTeardropParams().m_TdOnPadsInZones).toBe(false);
  });

  it('track to track turns "specified" back into "add defaults" (:66-73)', () => {
    const dlg = open(mixed());
    dlg.m_action = TEARDROP_ACTION.SPECIFIED;
    dlg.OnTrackToTrack(true);
    expect(dlg.m_action).toBe(TEARDROP_ACTION.ADD_DEFAULTS);
    expect(dlg.FiltersEnabled()).toBe(false);
  });

  it('"existing only" drops "add" from the two labels (:92-104)', () => {
    const dlg = open(mixed());
    expect(dlg.AddLabels().addTeardrops).toBe('Add teardrops with default values for shape');
    dlg.m_existingFilter = true;
    expect(dlg.AddLabels()).toEqual({
      addTeardrops: 'Set teardrops to default values for shape',
      specifiedValues: 'Set teardrops to specified values:',
    });
  });

  it('lists Default then the netclasses, and keeps the filters for the next open (:146-158)', () => {
    const b = mixed();
    let dlg = open(b);
    expect(dlg.m_netclassNames[0]).toBe('Default');
    dlg.m_netFilter = 2;
    dlg.OnClose();
    dlg = open(b);
    expect(dlg.m_netFilter).toBe(2);
  });
});
