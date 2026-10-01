// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * CONVERT_TOOL (pcbnew/tools/convert_tool.cpp) driven through the tool
 * manager on a live BOARD, the OUTSET_ROUTINE it runs
 * (item_modification_routine.cpp:649-1042) and the dialogs' transfers.
 *
 * KiCad's own suite (qa/tests/pcbnew/test_convert_tool.cpp) is ported first;
 * every other expectation is read off the C++ line it cites.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT } from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import {
  DXF_IMPORT_PLUGIN,
  DXF_IMPORT_UNITS,
} from '@ziroeda/common/import_gfx/dxf_import_plugin.js';
import { PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
import type { LSET } from '@ziroeda/common/lset.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KIGEOM_RoundNW, KIGEOM_RoundSE } from '@ziroeda/kimath/src/geometry/vector_utils.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { DIALOG_OUTSET_ITEMS } from '@ziroeda/pcbnew/dialogs/dialog_outset_items.js';
import { GRAPHICS_IMPORTER_PCBNEW } from '@ziroeda/pcbnew/import_gfx/graphics_importer_pcbnew.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { PCB_ARC, PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { CONVERT_SETTINGS, CONVERT_STRATEGY } from '@ziroeda/pcbnew/pcbnew_settings.js';
import {
  CONVERSION_BOX,
  CONVERT_SETTINGS_DIALOG,
} from '@ziroeda/pcbnew/tools/convert_settings_dialog.js';
import {
  CONVERT_TOOL,
  type CONVERT_TOOL_FRAME,
  ResetOutsetParams,
} from '@ziroeda/pcbnew/tools/convert_tool.js';
import {
  CALLABLE_BASED_HANDLER,
  OUTSET_ROUTINE,
  type OUTSET_PARAMETERS,
} from '@ziroeda/pcbnew/tools/item_modification_routine.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_SELECTION_CONDITIONS } from '@ziroeda/pcbnew/tools/pcb_selection_conditions.js';
import { GetBoardItemWidth } from '@ziroeda/pcbnew/tools/pcb_tool_utils.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import type { ZONE_SETTINGS } from '@ziroeda/pcbnew/zone_settings.js';
import {
  byUuid,
  MM,
  mm,
  select,
  type TOOL_HARNESS,
  toolHarness,
  U,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const line = (
  n: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w = 0.2,
  layer = 'F.SilkS',
) =>
  `(gr_line (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width ${w}) (type solid)) (layer "${layer}") (uuid "${U(n)}"))`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (25 "Edge.Cuts" user)
    (31 "F.CrtYd" user "F.Courtyard")
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  ${line(1, 10, 10, 20, 10)}
  ${line(2, 20, 10, 20, 20, 0.25)}
  ${line(3, 20, 20, 10, 20, 0.3)}
  ${line(4, 10, 20, 10, 10, 0.18)}
  ${line(5, 40, 10, 50, 10)}
  ${line(6, 50, 10, 50, 20)}
  (gr_rect (start 60 10) (end 70 20) (stroke (width 0.15) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U(7)}"))
  (gr_circle (center 80 15) (end 85 15) (stroke (width 0.1) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U(8)}"))
  (gr_arc (start 90 10) (mid 95 5) (end 100 10) (stroke (width 0.12) (type solid)) (layer "F.Cu") (uuid "${U(9)}"))
  (segment (start 10 40) (end 20 40) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (arc (start 30 40) (mid 35 35) (end 40 40) (width 0.3) (layer "F.Cu") (net 1) (uuid "${U(21)}"))
  (footprint "R" (layer "F.Cu") (uuid "${U(30)}") (at 60 60)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(31)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 2) (layers "F.Cu") (net 1 "N1") (uuid "${U(32)}"))
    (pad "2" smd circle (at 1 0) (size 1 1) (layers "F.Cu") (uuid "${U(33)}"))
  )
)
`;

class CONVERT_FRAME extends TEST_PCB_FRAME implements CONVERT_TOOL_FRAME {
  infobar: string[] = [];
  asked: string[] = [];
  /** What each dialog does to its settings before answering OK, or false for Cancel. */
  convertAnswer: ((s: CONVERT_SETTINGS) => void) | false = () => {};
  zoneAnswer: ((z: ZONE_SETTINGS, c: CONVERT_SETTINGS) => void) | false = () => {};
  layerAnswer: PCB_LAYER_ID = PCB_LAYER_ID.B_Cu;
  outsetAnswer: ((p: OUTSET_PARAMETERS) => void) | false = () => {};

  ShowConvertSettingsDialog(
    aSettings: CONVERT_SETTINGS,
    aCopy: boolean,
    aCenter: boolean,
    aHull: boolean,
  ): Promise<boolean> {
    this.asked.push(`convert ${aCopy} ${aCenter} ${aHull}`);
    if (this.convertAnswer === false) return Promise.resolve(false);
    this.convertAnswer(aSettings);
    return Promise.resolve(true);
  }
  ShowZoneEditorForConversion(
    aKind: 'ruleArea' | 'nonCopper' | 'copper',
    aZoneSettings: ZONE_SETTINGS,
    aConvertSettings: CONVERT_SETTINGS,
  ): Promise<boolean> {
    this.asked.push(`zone ${aKind}`);
    if (this.zoneAnswer === false) return Promise.resolve(false);
    this.zoneAnswer(aZoneSettings, aConvertSettings);
    return Promise.resolve(true);
  }
  SelectOneLayer(_aDefault: PCB_LAYER_ID, _aNotAllowed: LSET): Promise<PCB_LAYER_ID> {
    this.asked.push('layer');
    return Promise.resolve(this.layerAnswer);
  }
  ShowOutsetItemsDialog(aParams: OUTSET_PARAMETERS): Promise<boolean> {
    this.asked.push(`outset ${aParams.outsetDistance}`);
    if (this.outsetAnswer === false) return Promise.resolve(false);
    this.outsetAnswer(aParams);
    return Promise.resolve(true);
  }
  ShowInfoBarMsg(aMsg: string): void {
    this.infobar.push(aMsg);
  }
}

type Harness = TOOL_HARNESS<CONVERT_FRAME> & { tool: CONVERT_TOOL };

let h: Harness;
let errors: string[];

beforeEach(() => {
  ResetOutsetParams();
  errors = [];
  SetErrorPresenter((aText, aExtra) => errors.push(`${aText}|${aExtra}`));
  let tool: CONVERT_TOOL | null = null;
  const base = toolHarness(
    BOARD_TEXT,
    (aBoard) => new CONVERT_FRAME(aBoard),
    () => {
      tool = new CONVERT_TOOL();
      return [tool];
    },
  );
  h = Object.assign(base, { tool: tool! });
  h.frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
});

/** Every item on the board that is not in the fixture: what a command added. */
function added(): BOARD_ITEM[] {
  const out: BOARD_ITEM[] = [];
  for (const d of h.board.Drawings()) if (!/^00000000-0000-4000-8000/.test(d.m_Uuid)) out.push(d);
  for (const t of h.board.Tracks()) if (!/^00000000-0000-4000-8000/.test(t.m_Uuid)) out.push(t);
  for (const z of h.board.Zones()) out.push(z);
  return out;
}

const gone = (n: number): boolean => {
  try {
    byUuid(h.board, n);
    return false;
  } catch {
    return true;
  }
};

describe('test_convert_tool.cpp: CreatePolygonFromSplineOutline (issue 22127)', () => {
  it('a Fusion360 line+spline outline chains into exactly one closed polygon, every shape used', () => {
    const plugin = new DXF_IMPORT_PLUGIN();
    const importer = new GRAPHICS_IMPORTER_PCBNEW();
    plugin.SetImporter(importer);
    plugin.SetUnit(DXF_IMPORT_UNITS.MM);
    importer.SetLayer('Edge.Cuts');
    const dxf = readFileSync(
      fileURLToPath(
        new URL(
          '../../../data/common/import_gfx/issue22127_fusion360_splines.dxf',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(plugin.Load(dxf)).toBe(true);
    expect(plugin.Import()).toBe(true);

    // The importer's records as the PCB_SHAPEs GRAPHICS_IMPORTER_PCBNEW makes upstream.
    const board = new BOARD();
    const items: EDA_ITEM[] = [];
    for (const i of importer.GetItems()) {
      if (i.type !== 'shape') continue;
      const s = i.shape;
      let shape: PCB_SHAPE;
      if (s.kind === 'line') {
        shape = new PCB_SHAPE(board, SHAPE_T.SEGMENT);
        shape.SetStart(s.start!);
        shape.SetEnd(s.end!);
      } else if (s.kind === 'curve') {
        shape = new PCB_SHAPE(board, SHAPE_T.BEZIER);
        const [p0, c1, c2, p1] = s.pts!;
        shape.SetStart(p0!);
        shape.SetBezierC1(c1!);
        shape.SetBezierC2(c2!);
        shape.SetEnd(p1!);
        shape.RebuildBezierToSegmentsPointsList(shape.GetMaxError());
      } else if (s.kind === 'arc') {
        shape = new PCB_SHAPE(board, SHAPE_T.ARC);
        shape.SetArcGeometry(s.start!, s.mid!, s.end!);
      } else {
        continue;
      }
      items.push(shape);
    }

    expect(items.length).toBeGreaterThanOrEqual(6);

    for (const item of items) item.ClearFlags(SKIP_STRUCT);

    const result = new CONVERT_TOOL().makePolysFromChainedSegs(items, CONVERT_STRATEGY.CENTERLINE);

    expect(result.OutlineCount()).toBe(1);
    expect(result.COutline(0).IsClosed()).toBe(true);
    expect(Math.abs(result.COutline(0).Area())).toBeGreaterThan(0);
    expect(items.filter((i) => i.GetFlags() & SKIP_STRUCT).length).toBe(items.length);
  });
});

describe('CONVERT_TOOL::CreatePolys (convert_tool.cpp:367-583)', () => {
  it('four chained lines become one filled polygon on the active layer; the lines go', async () => {
    select(h, 1, 2, 3, 4);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    // copy-line-width shown for non-pads; centerline and hull always (:423-433)
    expect(h.frame.asked).toEqual(['convert true true true']);
    const polys = added();
    expect(polys).toHaveLength(1);
    const p = polys[0] as PCB_SHAPE;
    expect(p.GetShape()).toBe(SHAPE_T.POLY);
    // CENTERLINE is the user default (initUserSettings, :349-355): filled, width 0
    expect(p.IsSolidFill()).toBe(true);
    expect(p.GetWidth()).toBe(0);
    expect(p.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(p.GetPolyShape().COutline(0).PointCount()).toBe(4);
    // m_DeleteOriginals defaults true: every chained source is removed (:548-557)
    expect([1, 2, 3, 4].every(gone)).toBe(true);
    expect(h.frame.PopCommandFromUndoList()!.GetDescription()).toBe('Convert to Polygon');
  });

  it('COPY_LINEWIDTH takes the width of the top-left stroked item (:466-491)', async () => {
    h.frame.convertAnswer = (s) => {
      s.m_Strategy = CONVERT_STRATEGY.COPY_LINEWIDTH;
      s.m_DeleteOriginals = false;
    };
    select(h, 3, 2, 1, 4);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    const p = added()[0] as PCB_SHAPE;
    // positions (start points): 1 (10,10) 0.2, 4 (10,20) 0.18, 2 (20,10) 0.25,
    // 3 (20,20) 0.3: the left-most, then top-most is 1
    expect(p.GetWidth()).toBe(0.2 * MM);
    expect(p.IsSolidFill()).toBe(false);
    expect(gone(1)).toBe(false);
    expect(h.frame.PopCommandFromUndoList()!.GetDescription()).toBe('Create Polygon');
  });

  it('an open chain under centerlines is refused with the message, and settings roll back (:451-464)', async () => {
    h.frame.convertAnswer = (s) => {
      s.m_DeleteOriginals = false;
    };
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    expect(errors).toEqual(['Could not convert selection|Objects must form a closed shape']);
    expect(added()).toHaveLength(0);
    expect(h.tool.m_userSettings.m_DeleteOriginals).toBe(true);
  });

  it('a bounding hull of the open chain is a polygon (:383-391)', async () => {
    h.frame.convertAnswer = (s) => {
      s.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
    };
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    const p = added()[0] as PCB_SHAPE;
    expect(p.GetShape()).toBe(SHAPE_T.POLY);
    // the hull is not filled; its width is the layer class default (:440-441)
    expect(p.IsSolidFill()).toBe(false);
    expect(p.GetWidth()).toBe(h.board.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.F_SilkS));
  });

  it('a pad selection hides the copy-line-width choice and leaves COPY_LINEWIDTH (:418-425)', async () => {
    h.tool.m_userSettings.m_Strategy = CONVERT_STRATEGY.COPY_LINEWIDTH;
    h.frame.convertAnswer = false;
    h.sel.AddItemToSel(byUuid(h.board, 32), true);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    expect(h.frame.asked).toEqual(['convert false true true']);
    expect(h.tool.m_userSettings.m_Strategy).toBe(CONVERT_STRATEGY.CENTERLINE);
  });

  it('Create Zone on copper asks the copper editor and adds a zone with the outline (:494-545)', async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    select(h, 1, 2, 3, 4);
    h.mgr.RunAction(PCB_ACTIONS.convertToZone);
    await flush();
    expect(h.frame.asked).toEqual(['zone copper']);
    const zones = [...h.board.Zones()];
    expect(zones).toHaveLength(1);
    const z = zones[0] as ZONE;
    expect(z.GetIsRuleArea()).toBe(false);
    expect(z.GetLayerSet().Contains(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(z.Outline().COutline(0).PointCount()).toBe(4);
    expect(h.frame.PopCommandFromUndoList()!.GetDescription()).toBe('Convert to Zone');
  });

  it('Create Rule Area asks the rule-area editor; on a silk layer the zone editor is the non-copper one', async () => {
    select(h, 1, 2, 3, 4);
    h.mgr.RunAction(PCB_ACTIONS.convertToKeepout);
    await flush();
    expect(h.frame.asked).toEqual(['zone ruleArea']);
    expect([...h.board.Zones()][0]!.GetIsRuleArea()).toBe(true);

    h.frame.asked = [];
    h.frame.zoneAnswer = false;
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.convertToZone);
    await flush();
    expect(h.frame.asked).toEqual(['zone nonCopper']);
  });

  it('nothing convertible: the preflight returns before any dialog (:409-410)', async () => {
    select(h, 30);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    expect(h.frame.asked).toEqual([]);
  });

  it('a hull with a gap grows by the gap and half the line width (:440-447)', async () => {
    h.frame.convertAnswer = (s) => {
      s.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
      s.m_Gap = MM;
      s.m_LineWidth = 0.4 * MM;
    };
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    const bb = (added()[0] as PCB_SHAPE).GetPolyShape().BBox();
    // the lines' own half width (0.1) + the gap (1) + half the 0.4 line (0.2)
    expect(Math.abs(bb.GetLeft() - (40 - 1.3) * MM)).toBeLessThanOrEqual(0.01 * MM);
  });

  it('only the items that went into a polygon are deleted (SKIP_STRUCT, :548-557)', async () => {
    select(h, 1, 2, 3, 4, 20);
    h.mgr.RunAction(PCB_ACTIONS.convertToPoly);
    await flush();
    expect([1, 2, 3, 4].every(gone)).toBe(true);
    expect(gone(20)).toBe(false);
  });

  it('cancelling the zone editor adds nothing', async () => {
    h.frame.zoneAnswer = false;
    select(h, 1, 2, 3, 4);
    h.mgr.RunAction(PCB_ACTIONS.convertToZone);
    await flush();
    expect(added()).toHaveLength(0);
    expect(gone(1)).toBe(false);
  });
});

describe('CONVERT_TOOL::CreateLines (convert_tool.cpp:928-1213)', () => {
  it('a rectangle becomes four graphic lines on the active layer, its width kept', async () => {
    select(h, 7);
    h.mgr.RunAction(PCB_ACTIONS.convertToLines);
    await flush();
    expect(h.frame.asked).toEqual(['convert false false false']);
    const lines = added() as PCB_SHAPE[];
    expect(lines.map((l) => l.GetShape())).toEqual(Array(4).fill(SHAPE_T.SEGMENT));
    expect(lines.every((l) => l.GetWidth() === 0.15 * MM)).toBe(true);
    expect(gone(7)).toBe(true);
    expect(h.frame.PopCommandFromUndoList()!.GetDescription()).toBe('Create Lines');
  });

  it('only shapes and zones survive the filter: a lone circle converts nothing (:931-958)', async () => {
    select(h, 8);
    h.mgr.RunAction(PCB_ACTIONS.convertToLines);
    await flush();
    expect(h.frame.asked).toEqual([]);
  });

  it('to tracks off copper, the layer is asked for and the tracks land on it (:1147-1155)', async () => {
    select(h, 7);
    h.mgr.RunAction(PCB_ACTIONS.convertToTracks);
    await flush();
    expect(h.frame.asked).toEqual(['layer']);
    const tracks = added();
    expect(tracks).toHaveLength(4);
    expect(tracks.every((t) => t.Type() === KICAD_T.PCB_TRACE_T)).toBe(true);
    expect(tracks.every((t) => t.GetLayer() === PCB_LAYER_ID.B_Cu)).toBe(true);
  });

  it('a cancelled layer choice converts nothing', async () => {
    h.frame.layerAnswer = UNDEFINED_LAYER;
    select(h, 7);
    h.mgr.RunAction(PCB_ACTIONS.convertToTracks);
    await flush();
    expect(added()).toHaveLength(0);
    expect(gone(7)).toBe(false);
  });
});

describe('CONVERT_TOOL::SegmentToArc (convert_tool.cpp:1216-1325)', () => {
  it('a graphic segment becomes the arc through start, end and a mid bowed 10 % off the chord', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.convertToArc);
    const a = added()[0] as PCB_SHAPE;
    expect(a.GetShape()).toBe(SHAPE_T.ARC);
    expect(a.GetStart()).toEqual(mm(10, 10));
    expect(a.GetEnd()).toEqual(mm(20, 10));
    // normal = Perpendicular( B - A ) = (0, 10) resized to 1 mm, so the
    // circle is through (15, 11): centre (15, -2). SetCenter/SetStart/SetEnd
    // then give the long way round - asked of KiCad's own pcbnew module
    // (PCB_SHAPE ARC, SetCenter (15,-2), SetStart (10,10), SetEnd (20,10)):
    // GetArcMid() = (15, -15), GetArcAngle() = 314.76 degrees.
    expect(a.GetCenter()).toEqual(mm(15, -2));
    expect(a.GetArcMid()).toEqual(mm(15, -15));
    expect(h.frame.PopCommandFromUndoList()!.GetDescription()).toBe('Create Arc');
    // the source stays: SegmentToArc never removes it
    expect(gone(1)).toBe(false);
  });

  it('a track becomes a PCB_ARC on its net, mid (15, 41)', () => {
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.convertToArc);
    const a = added()[0] as PCB_ARC;
    expect(a.Type()).toBe(KICAD_T.PCB_ARC_T);
    expect(a.GetNetCode()).toBe(1);
    expect(a.GetWidth()).toBe(0.25 * MM);
    expect(a.GetMid()).toEqual(mm(15, 41));
  });

  it('a graphic arc becomes a track arc through the same mid; a track arc a graphic one', () => {
    select(h, 9);
    h.mgr.RunAction(PCB_ACTIONS.convertToArc);
    const t = added()[0] as PCB_ARC;
    expect(t.Type()).toBe(KICAD_T.PCB_ARC_T);
    expect(t.GetMid()).toEqual((byUuid(h.board, 9) as PCB_SHAPE).GetArcMid());
    expect(t.GetWidth()).toBe(0.12 * MM);
  });

  it('a track arc becomes a graphic arc of its width', () => {
    select(h, 21);
    h.mgr.RunAction(PCB_ACTIONS.convertToArc);
    const g = added()[0] as PCB_SHAPE;
    expect(g.Type()).toBe(KICAD_T.PCB_SHAPE_T);
    expect(g.GetShape()).toBe(SHAPE_T.ARC);
    expect(g.GetWidth()).toBe(0.3 * MM);
    expect(g.GetArcMid()).toEqual(mm(35, 35));
  });
});

describe('CONVERT_TOOL::OutsetItems and OUTSET_ROUTINE', () => {
  it('asks with the board editor defaults, 1 mm (convert_tool.cpp:1460-1470)', async () => {
    h.frame.outsetAnswer = false;
    select(h, 8);
    h.mgr.RunAction(PCB_ACTIONS.outsetItems);
    await flush();
    expect(h.frame.asked).toEqual([`outset ${1 * MM}`]);
  });

  it('a circle grows by the distance, on its own layer, selected afterwards (:1478-1501)', async () => {
    select(h, 8);
    h.mgr.RunAction(PCB_ACTIONS.outsetItems);
    await flush();
    const c = added()[0] as PCB_SHAPE;
    expect(c.GetShape()).toBe(SHAPE_T.CIRCLE);
    expect(c.GetRadius()).toBe(6 * MM);
    expect(c.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    // useSourceWidths: the circle's 0.1 mm (GetBoardItemWidth, unfilled)
    expect(c.GetWidth()).toBe(0.1 * MM);
    expect([...h.sel.GetSelection()]).toEqual([c]);
    expect(h.frame.PopCommandFromUndoList()!.GetDescription()).toBe('Outset Items');
  });

  function routine(aParams: Partial<OUTSET_PARAMETERS>): {
    r: OUTSET_ROUTINE;
    made: PCB_SHAPE[];
    deleted: BOARD_ITEM[];
  } {
    const made: PCB_SHAPE[] = [];
    const deleted: BOARD_ITEM[] = [];
    const r = new OUTSET_ROUTINE(
      h.board,
      new CALLABLE_BASED_HANDLER(
        (i) => made.push(i as PCB_SHAPE),
        () => {},
        (i) => deleted.push(i),
      ),
      {
        outsetDistance: MM,
        roundCorners: false,
        useSourceLayers: false,
        useSourceWidths: false,
        layer: PCB_LAYER_ID.F_CrtYd,
        lineWidth: 0.05 * MM,
        gridRounding: null,
        deleteSourceItems: false,
        ...aParams,
      },
    );
    return { r, made, deleted };
  }

  it('a rectangle, square corners: a rectangle 1 mm larger all round (:858-897)', () => {
    const { r, made } = routine({});
    r.ProcessItem(byUuid(h.board, 7));
    expect(made).toHaveLength(1);
    expect(made[0]!.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(made[0]!.GetStart()).toEqual(mm(59, 9));
    expect(made[0]!.GetEnd()).toEqual(mm(71, 21));
    expect(made[0]!.GetLayer()).toBe(PCB_LAYER_ID.F_CrtYd);
    expect(made[0]!.GetWidth()).toBe(0.05 * MM);
    expect(r.GetStatusMessage()).toBeNull();
  });

  it('grid rounding pushes the rectangle outwards (GetRectRoundedToGridOutwards, :664-670)', () => {
    const { r, made } = routine({ outsetDistance: 0.3 * MM, gridRounding: MM });
    r.ProcessItem(byUuid(h.board, 7));
    expect(made[0]!.GetStart()).toEqual(mm(59, 9));
    expect(made[0]!.GetEnd()).toEqual(mm(71, 21));
  });

  it('round corners on a rectangle: ROUNDRECT keeps its arcs, so four lines and four arcs (:885-890, :717-746)', () => {
    const { r, made } = routine({ roundCorners: true });
    r.ProcessItem(byUuid(h.board, 7));
    expect(made.map((m) => m.GetShape()).sort()).toEqual(
      [...Array(4).fill(SHAPE_T.SEGMENT), ...Array(4).fill(SHAPE_T.ARC)].sort(),
    );
    // the corner arcs have the 1 mm radius (cornerRadius 0 + the outset)
    expect(
      made.filter((m) => m.GetShape() === SHAPE_T.ARC).every((m) => m.GetRadius() === MM),
    ).toBe(true);
  });

  it('the tool reports a total failure on the infobar (:1530-1531)', async () => {
    h.frame.outsetAnswer = (p) => {
      p.outsetDistance = -6 * MM;
    };
    select(h, 8);
    h.mgr.RunAction(PCB_ACTIONS.outsetItems);
    await flush();
    expect(h.frame.infobar).toEqual(['Unable to outset the selected items.']);
  });

  it('round corners on a grid: the rounded outline is built on the grid-rounded box (:878-883)', () => {
    const { r, made } = routine({ roundCorners: true, outsetDistance: 0.3 * MM, gridRounding: MM });
    r.ProcessItem(byUuid(h.board, 7));
    const xs = made.flatMap((m) => [m.GetStart().x, m.GetEnd().x]);
    // 60..70 outset by 0.3 is 59.7..70.3; rounded outwards to 1 mm, 59..71
    expect(Math.min(...xs)).toBe(59 * MM);
    expect(Math.max(...xs)).toBe(71 * MM);
  });

  it('an arc: the outer and inner arcs and the two end caps (:966-1007)', () => {
    const { r, made } = routine({});
    r.ProcessItem(byUuid(h.board, 9));
    const arcs = made.filter((m) => m.GetShape() === SHAPE_T.ARC);
    expect(arcs).toHaveLength(4);
    const radius = (byUuid(h.board, 9) as PCB_SHAPE).GetRadius();
    expect(arcs.map((a) => Math.round(a.GetRadius() / 1000) * 1000).sort((a, b) => a - b)).toEqual(
      [MM, MM, radius - MM, radius + MM].map((v) => Math.round(v / 1000) * 1000).sort((a, b) => a - b),
    );
  });

  it('a negative distance that swallows a circle is a failure (:900-907, :656-658)', () => {
    const { r, made } = routine({ outsetDistance: -6 * MM });
    r.ProcessItem(byUuid(h.board, 8));
    expect(made).toHaveLength(0);
    expect(r.GetFailures()).toBe(1);
    expect(r.GetStatusMessage()).toBe('Unable to outset the selected items.');
  });

  it('a circle without round corners is the square around it (addCircleOrRect, :766-779)', () => {
    const { r, made } = routine({});
    r.ProcessItem(byUuid(h.board, 8));
    expect(made[0]!.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(made[0]!.GetStart()).toEqual(mm(74, 9));
    expect(made[0]!.GetEnd()).toEqual(mm(86, 21));
  });

  it('a segment, square: the four-corner box around it; with delete, the source goes (:910-941, :1037-1041)', () => {
    const { r, made, deleted } = routine({ deleteSourceItems: true });
    const src = byUuid(h.board, 1);
    r.ProcessItem(src);
    expect(made[0]!.GetShape()).toBe(SHAPE_T.POLY);
    const pts = made[0]!.GetPolyShape().COutline(0).CPoints();
    // ext = (1, 0) mm; perp = GetRotated( ext, ANGLE_90 ) = (0, -1) mm, as
    // RotatePoint turns +90 in KiCad's y-down frame ( x, y ) -> ( y, -x )
    expect(pts).toEqual([mm(9, 9), mm(9, 11), mm(21, 11), mm(21, 9)]);
    expect(deleted).toEqual([src]);
  });

  it('a rectangular pad: the box rotated about the pad, as a polygon (:793-829)', () => {
    const { r, made } = routine({});
    r.ProcessItem(byUuid(h.board, 32));
    expect(made[0]!.GetShape()).toBe(SHAPE_T.POLY);
    const bb = made[0]!.GetBoundingBox();
    // the pad is 1 x 2 at (59, 60): 3 x 4 once outset
    expect([bb.GetWidth(), bb.GetHeight()]).toEqual([3 * MM + 0.05 * MM, 4 * MM + 0.05 * MM]);
  });

  it('a circular pad with round corners: a circle of radius 0.5 + 1 (:832-846)', () => {
    const { r, made } = routine({ roundCorners: true });
    r.ProcessItem(byUuid(h.board, 33));
    expect(made[0]!.GetShape()).toBe(SHAPE_T.CIRCLE);
    expect(made[0]!.GetRadius()).toBe(1.5 * MM);
  });

  it('source widths and layers when asked (:679-693)', () => {
    const { r, made } = routine({ useSourceWidths: true, useSourceLayers: true });
    r.ProcessItem(byUuid(h.board, 3));
    expect(made[0]!.GetWidth()).toBe(0.3 * MM);
    expect(made[0]!.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
  });
});

describe('the dialogs and helpers', () => {
  it('GetBoardItemWidth (pcb_tool_utils.cpp:30-59)', () => {
    expect(GetBoardItemWidth(byUuid(h.board, 1))).toBe(0.2 * MM);
    expect(GetBoardItemWidth(byUuid(h.board, 20))).toBe(0.25 * MM);
    expect(GetBoardItemWidth(byUuid(h.board, 32))).toBeNull();
    const filled = byUuid(h.board, 7) as PCB_SHAPE;
    filled.SetFilled(true);
    expect(GetBoardItemWidth(filled)).toBeNull();
  });

  it('getStartEndPoints: a zero-length line has none (:1347-1348)', () => {
    const z = new PCB_SHAPE(h.board, SHAPE_T.SEGMENT);
    z.SetStart(mm(5, 5));
    z.SetEnd(mm(5, 5));
    expect(CONVERT_TOOL.getStartEndPoints(z)).toBeNull();
    expect(CONVERT_TOOL.getStartEndPoints(byUuid(h.board, 7))).toBeNull();
    expect(CONVERT_TOOL.getStartEndPoints(byUuid(h.board, 1))?.B).toEqual(mm(20, 10));
  });

  it('KIGEOM::RoundNW / RoundSE round towards -inf / +inf, negatives included', () => {
    expect(KIGEOM_RoundNW({ x: 15, y: -15 }, 10)).toEqual({ x: 10, y: -20 });
    expect(KIGEOM_RoundSE({ x: 15, y: -15 }, 10)).toEqual({ x: 20, y: -10 });
    expect(KIGEOM_RoundNW({ x: 20, y: -20 }, 10)).toEqual({ x: 20, y: -20 });
  });

  it('CONVERT_SETTINGS_DIALOG round-trips every control (:205-237)', () => {
    const s = new CONVERT_SETTINGS();
    const d = new CONVERT_SETTINGS_DIALOG(s, {
      copyLineWidth: true,
      centerline: true,
      boundingHull: true,
    });
    d.TransferDataFromWindow({
      strategy: CONVERT_STRATEGY.BOUNDING_HULL,
      gap: 7,
      lineWidth: 9,
      deleteOriginals: true,
    });
    expect([s.m_Strategy, s.m_Gap, s.m_LineWidth, s.m_DeleteOriginals]).toEqual([
      CONVERT_STRATEGY.BOUNDING_HULL,
      7,
      9,
      true,
    ]);
    expect(d.TransferDataToWindow().gap).toBe(7);
    expect(CONVERT_SETTINGS_DIALOG.HullParamsEnabled(d.TransferDataToWindow())).toBe(true);
  });

  it('the conversion box: the rule-area editor opens at gap 0 and writes it only for a hull', () => {
    const s = new CONVERT_SETTINGS();
    s.m_Gap = 5;
    s.m_Strategy = CONVERT_STRATEGY.CENTERLINE;
    expect(CONVERSION_BOX.ToWindow(s, true).gap).toBe(0);
    expect(CONVERSION_BOX.ToWindow(s, false).gap).toBe(5);
    CONVERSION_BOX.FromWindow(s, { boundingHull: false, gap: 9, deleteOriginals: false }, true);
    expect(s.m_Gap).toBe(5);
    CONVERSION_BOX.FromWindow(s, { boundingHull: false, gap: 9, deleteOriginals: false }, false);
    expect(s.m_Gap).toBe(9);
    CONVERSION_BOX.FromWindow(s, { boundingHull: true, gap: 3, deleteOriginals: true }, true);
    expect([s.m_Strategy, s.m_Gap, s.m_DeleteOriginals]).toEqual([
      CONVERT_STRATEGY.BOUNDING_HULL,
      3,
      true,
    ]);
  });

  it('DIALOG_OUTSET_ITEMS: no grid rounding shows the persisted pitch; a zero width is refused', () => {
    const p: OUTSET_PARAMETERS = {
      outsetDistance: MM,
      roundCorners: true,
      useSourceLayers: true,
      useSourceWidths: true,
      layer: PCB_LAYER_ID.Edge_Cuts,
      lineWidth: 0.1 * MM,
      gridRounding: null,
      deleteSourceItems: false,
    };
    const d = new DIALOG_OUTSET_ITEMS(p);
    const v = d.TransferDataToWindow();
    expect(v.roundToGrid).toBe(false);
    expect(v.gridPitchIU).toBe(0.01 * MM);
    expect(v.layer).toBe('Edge.Cuts');
    expect(d.TransferDataFromWindow({ ...v, lineWidthIU: 0 })).toEqual({
      ok: false,
      message: 'Line width must be a positive value.',
    });
    expect(
      d.TransferDataFromWindow({ ...v, roundToGrid: true, gridPitchIU: 5, layer: 'F.CrtYd' }).ok,
    ).toBe(true);
    expect([p.gridRounding, p.layer]).toEqual([5, PCB_LAYER_ID.F_CrtYd]);
  });

  it('PCB_SELECTION_CONDITIONS::SameLayer / SameNet (pcb_selection_conditions.cpp)', () => {
    const sel = (...n: number[]) => {
      const s = new SELECTION();
      for (const i of n) s.Add(byUuid(h.board, i));
      return s;
    };
    expect(PCB_SELECTION_CONDITIONS.SameLayer()(sel(1, 2))).toBe(true);
    expect(PCB_SELECTION_CONDITIONS.SameLayer()(sel(1, 20))).toBe(false);
    expect(PCB_SELECTION_CONDITIONS.SameLayer()(sel())).toBe(false);
    expect(PCB_SELECTION_CONDITIONS.SameNet()(sel(20, 21))).toBe(true);
    expect(PCB_SELECTION_CONDITIONS.SameNet()(sel(20, 1))).toBe(false);
    expect(PCB_SELECTION_CONDITIONS.SameNet(true)(sel(33, 1))).toBe(true);
  });

  it("Init's submenu offers zone and track conversion in the board editor (:302-333)", () => {
    const menu = h.tool.GetMenu()!;
    select(h, 1, 2);
    menu.Evaluate(h.sel.GetSelection());
    const ids = new Set(menu.GetMenuItems().map((i) => i.GetId()));
    expect(ids.has(PCB_ACTIONS.convertToPoly.GetUIId())).toBe(true);
    expect(ids.has(PCB_ACTIONS.convertToZone.GetUIId())).toBe(true);
    expect(ids.has(PCB_ACTIONS.convertToTracks.GetUIId())).toBe(true);
    // two segments: no arc (Count( 1 )), no lines (only polys convert to lines)
    expect(ids.has(PCB_ACTIONS.convertToArc.GetUIId())).toBe(false);
    expect(ids.has(PCB_ACTIONS.convertToLines.GetUIId())).toBe(false);
  });
});
