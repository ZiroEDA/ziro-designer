// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_POINT_EDITOR on TOOL_MANAGER (pcb_point_editor.cpp): a selection makes
 * the edit points, a left drag on one reshapes the live item on one commit,
 * Esc mid-drag reverts, and the corner commands edit polygons.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  MD_CTRL,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TA_MOUSE_UP,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import type { PCB_BARCODE } from '@ziroeda/pcbnew/pcb_barcode.js';
import type { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';
import type { REFERENCE_IMAGE } from '@ziroeda/common/reference_image.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import {
  type PCB_DIM_ALIGNED,
  PCB_DIM_ORTHOGONAL,
  type PCB_DIM_RADIAL,
} from '@ziroeda/pcbnew/pcb_dimension.js';
import { DIM_TEXT_POSITION } from '@ziroeda/pcbnew/pcb_dimension_types.js';
import { EDIT_LINE } from '@ziroeda/common/tool/edit_points.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_POINT_EDITOR } from '@ziroeda/pcbnew/tools/pcb_point_editor.js';
import {
  byUuid,
  MM,
  mm,
  mouse,
  type TOOL_HARNESS,
  toolHarness,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

/** A real PNG from the fixtures, base64 as a board file carries it. */
const PNG = readFileSync(
  fileURLToPath(new URL('../../../fixtures/png/rgb8.png', import.meta.url)),
).toString('base64');

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (17 "Dwgs.User" user "User.Drawings") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (gr_rect (start 10 10) (end 20 16) (stroke (width 0.2) (type solid)) (fill no) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000001"))
  (gr_line (start 30 10) (end 40 10) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000002"))
  (gr_poly (pts (xy 50 10) (xy 60 10) (xy 60 20) (xy 50 20)) (stroke (width 0.2) (type solid)) (fill no) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000003"))
  (gr_line (start 30 30) (end 40 30) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (locked yes) (uuid "00000000-0000-4000-8000-000000000004"))
  (segment (start 30 40) (end 40 40) (width 0.25) (layer "F.Cu") (net 0) (uuid "00000000-0000-4000-8000-000000000005"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000006"))
  (gr_line (start 10 60) (end 20 60) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000007"))
  (gr_poly (pts (xy 100 10) (xy 108 10) (xy 108 30)) (stroke (width 0.2) (type solid)) (fill no) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000009"))
  (dimension (type aligned) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000020")
    (pts (xy 0 0) (xy 10 0)) (height 5)
    (gr_text "10" (at 5 -6 0) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000020") (effects (font (size 1 1) (thickness 0.15))))
    (format (prefix "") (suffix "") (units 2) (units_format 0) (precision 4) (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (extension_height 0.58642) (extension_offset 0.5) (keep_text_aligned yes)))
  (dimension (type orthogonal) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000021")
    (pts (xy 0 0) (xy 10 7)) (height 5) (orientation 0)
    (gr_text "10" (at 5 -6 0) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000021") (effects (font (size 1 1) (thickness 0.15))))
    (format (prefix "") (suffix "") (units 2) (units_format 0) (precision 4) (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (extension_height 0.58642) (extension_offset 0.5) (keep_text_aligned yes)))
  (dimension (type leader) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000022")
    (pts (xy 0 0) (xy 10 10))
    (gr_text "L" (at 20 10 0) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000022") (effects (font (size 1 1) (thickness 0.15))))
    (format (prefix "") (suffix "") (units 2) (units_format 0) (precision 4) (override_value "L"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (text_frame 0) (extension_offset 0.5)))
  (dimension (type radial) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000023")
    (pts (xy 0 0) (xy 10 0)) (leader_length 3)
    (gr_text "R10" (at 20 0 0) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000023") (effects (font (size 1 1) (thickness 0.15))))
    (format (prefix "R") (suffix "") (units 2) (units_format 0) (precision 4) (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (extension_offset 0.5) (keep_text_aligned yes)))
  (dimension (type center) (layer "Dwgs.User") (uuid "00000000-0000-4000-8000-000000000024")
    (pts (xy 0 0) (xy 5 0))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (extension_offset 0.5)))
  (gr_text_box "Box" (start 120 10) (end 140 20) (margins 1 1 1 1) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000040")
    (effects (font (size 1 1) (thickness 0.15)) (justify left top)) (border yes) (stroke (width 0.1) (type solid)))
  (barcode (at 210 20 0) (layer "Dwgs.User") (size 8 8) (text "ZIRO")
    (text_height 1.27) (type qr) (ecc_level L) (hide yes) (knockout no)
    (uuid "00000000-0000-4000-8000-000000000050"))
  (barcode (at 240 20 0) (layer "Dwgs.User") (size 8 8) (text "ZIRO")
    (text_height 1.27) (type code128) (ecc_level L) (hide yes) (knockout no)
    (uuid "00000000-0000-4000-8000-000000000051"))
  (barcode (at 270 20 30) (layer "Dwgs.User") (size 8 8) (text "ZIRO")
    (text_height 1.27) (type qr) (ecc_level L) (hide yes) (knockout no)
    (uuid "00000000-0000-4000-8000-000000000052"))
  (image (at 300 50) (layer "F.SilkS") (scale 20) (uuid "00000000-0000-4000-8000-000000000060")
    (data "${PNG}"))
  (zone (net 0) (net_name "") (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000008") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 70 10) (xy 90 10) (xy 90 30) (xy 70 30))))
)
`;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let pe: PCB_POINT_EDITOR;

const shape = (n: number): PCB_SHAPE => byUuid(h.board, n) as unknown as PCB_SHAPE;

/** Select one or more items the way a click does: SelectedEvent reaches the point editor. */
function pick(...aUuids: number[]): void {
  for (const n of aUuids) h.sel.AddItemToSel(byUuid(h.board, n));
}

/** A left drag from `aFrom` to `aTo`, its motions, and the release. */
function drag(aFrom: Vec2, aTo: Vec2, aRelease = true, aMods = 0): void {
  mouse(h, TA_MOUSE_MOTION, aFrom);
  mouse(h, TA_MOUSE_DOWN, aFrom);

  for (const at of [aTo, aTo]) {
    h.mouse = at;
    const evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, BUT_LEFT | aMods, AS_GLOBAL);
    evt.SetMousePosition(at);
    evt.setMouseDragOrigin(aFrom);
    h.mgr.ProcessEvent(evt);
  }

  if (aRelease) mouse(h, TA_MOUSE_UP, aTo);
}

const pts = (s: PCB_SHAPE): Vec2[] => {
  const ps = s.GetPolyShape().Outline(0);
  return Array.from({ length: ps.PointCount() }, (_, i) => ps.CPoint(i));
};

beforeEach(() => {
  h = toolHarness(
    BOARD,
    (b) => new TEST_PCB_FRAME(b),
    () => [new PCB_POINT_EDITOR()],
  );
  pe = h.mgr.FindTool('pcbnew.PointEditor') as PCB_POINT_EDITOR;
});

describe('PCB_POINT_EDITOR: the points a selection gets (makePoints, :1955)', () => {
  it('a rectangle has its four corners, its centre and the radius handle, and four edge lines', () => {
    pick(1);
    const points = pe.GetEditPoints()!;
    expect(points.PointsSize()).toBe(6);
    expect(points.LinesSize()).toBe(4);
    expect(points.Point(0).GetPosition()).toEqual(mm(10, 10));
    expect(points.Point(2).GetPosition()).toEqual(mm(20, 16));
    expect(points.Point(4).GetPosition()).toEqual(mm(15, 13));
  });

  it('a track has none: KiCad 10 does not point-edit tracks', () => {
    pick(5);
    expect(pe.GetEditPoints()).toBeNull();
  });

  it('a locked item has none', () => {
    pick(4);
    expect(pe.GetEditPoints()).toBeNull();
  });

  it('two graphic shapes share one bounding box of points (SHAPE_GROUP behaviour)', () => {
    pick(6, 7);
    const points = pe.GetEditPoints()!;
    expect(points.PointsSize()).toBe(5);
    // The box is the two segments' bounding boxes, stroke included.
    expect(points.Point(4).GetPosition()).toEqual(mm(15, 55));
  });

  it('the points go when the selection is cleared', () => {
    pick(1);
    h.mgr.RunAction(ACTIONS.selectionClear);
    expect(pe.GetEditPoints()).toBeNull();
  });
});

describe('PCB_POINT_EDITOR: dragging a point', () => {
  it('a rectangle corner moves its two edges and nothing else, on one undoable commit', () => {
    pick(1);
    drag(mm(20, 16), mm(24, 18));

    const r = shape(1);
    expect(r.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(r.GetStart()).toEqual(mm(10, 10));
    expect(r.GetEnd()).toEqual(mm(24, 18));
    expect(h.frame.GetUndoCommandCount()).toBe(1);

    h.frame.RestoreCopyFromUndoList();
    expect(shape(1).GetEnd()).toEqual(mm(20, 16));
  });

  it('a rectangle edge moves only that edge (EC_PERPLINE)', () => {
    pick(1);
    // The right edge's midpoint is (20, 13); drag it right and down.
    drag(mm(20, 13), mm(23, 15));

    const r = shape(1);
    expect(r.GetStart()).toEqual(mm(10, 10));
    expect(r.GetEnd()).toEqual(mm(23, 16));
  });

  it('a segment end follows the cursor', () => {
    pick(2);
    drag(mm(40, 10), mm(44, 12));

    expect(shape(2).GetStart()).toEqual(mm(30, 10));
    expect(shape(2).GetEnd()).toEqual(mm(44, 12));
  });

  it('Esc mid-drag puts the item back and leaves no undo step', () => {
    pick(2);
    drag(mm(40, 10), mm(44, 12), false);
    expect(shape(2).GetEnd()).toEqual(mm(44, 12));

    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(shape(2).GetEnd()).toEqual(mm(40, 10));
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('a second edge drag in the same session moves from where the first left it (EC_PERPLINE re-armed)', () => {
    pick(1);
    drag(mm(20, 16), mm(24, 18));
    // The top edge's midpoint is now (17, 10); pull it up.
    drag(mm(17, 10), mm(17, 7));

    const r = shape(1);
    expect(r.GetStart()).toEqual(mm(10, 7));
    expect(r.GetEnd()).toEqual(mm(24, 18));
  });

  it('a zone corner moves the zone outline and drops its fill (ZONE_POINT_EDIT_BEHAVIOR, :526)', () => {
    (byUuid(h.board, 8) as unknown as ZONE).SetIsFilled(true);
    pick(8);
    drag(mm(90, 30), mm(95, 33));

    const zone = byUuid(h.board, 8) as unknown as ZONE;
    const outline = zone.Outline().Outline(0);
    const corners = Array.from({ length: outline.PointCount() }, (_, i) => outline.CPoint(i));
    expect(corners).toContainEqual(mm(95, 33));
    expect(corners).not.toContainEqual(mm(90, 30));
    expect(zone.IsFilled()).toBe(false);
  });
});

describe('PCB_POINT_EDITOR: corner commands', () => {
  it('Add Corner splits a segment at the cursor (:3301)', () => {
    pick(2);
    h.mouse = mm(34, 10);
    mouse(h, TA_MOUSE_MOTION, mm(34, 10));
    h.mgr.RunAction(PCB_ACTIONS.pointEditorAddCorner);

    expect(shape(2).GetEnd()).toEqual(mm(34, 10));
    const halves = h.board
      .Drawings()
      .filter((d) => d.Type() === shape(2).Type())
      .map((d) => d as unknown as PCB_SHAPE)
      .filter(
        (s) => s.GetStart().y === 10 * MM && s.GetStart().x >= 30 * MM && s.GetStart().x <= 40 * MM,
      );
    expect(halves.map((s) => [s.GetStart(), s.GetEnd()])).toContainEqual([mm(34, 10), mm(40, 10)]);
  });

  it('Add Corner puts a polygon vertex on the nearest edge (:3229)', () => {
    pick(3);
    h.mouse = mm(55, 10);
    mouse(h, TA_MOUSE_MOTION, mm(55, 10.2));
    h.mgr.RunAction(PCB_ACTIONS.pointEditorAddCorner);

    expect(pts(shape(3))).toHaveLength(5);
    expect(pts(shape(3))).toContainEqual(mm(55, 10));
  });

  it('Add Corner on a vertex adds the middle of the side instead (:3289)', () => {
    pick(3);
    h.mouse = mm(60, 10);
    mouse(h, TA_MOUSE_MOTION, mm(60, 10));
    h.mgr.RunAction(PCB_ACTIONS.pointEditorAddCorner);

    const p = pts(shape(3));
    expect(p).toHaveLength(5);
    expect(new Set(p.map((v) => `${v.x},${v.y}`)).size).toBe(5);
  });

  it('Remove Corner drops the polygon vertex under the cursor (:3346)', () => {
    pick(3);
    mouse(h, TA_MOUSE_MOTION, mm(60, 20));
    expect(pe.HasCorner()).toBe(true);
    expect(pe.CanRemoveCorner(h.sel.GetSelection())).toBe(true);
    h.mgr.RunAction(PCB_ACTIONS.pointEditorRemoveCorner);

    expect(pts(shape(3))).toHaveLength(3);
    expect(pts(shape(3))).not.toContainEqual(mm(60, 20));
  });

  it('a triangle cannot lose a corner, and a midpoint is not a corner', () => {
    pick(3);
    mouse(h, TA_MOUSE_MOTION, mm(55, 10));
    // The top edge's midpoint is an EDIT_LINE.
    expect(pe.HasMidpoint()).toBe(true);
    expect(pe.CanRemoveCorner(h.sel.GetSelection())).toBe(false);
  });

  it('Chamfer Corner replaces a polygon corner with two, 5 mm back, clamped to a quarter edge (:3423)', () => {
    pick(3);
    mouse(h, TA_MOUSE_MOTION, mm(60, 20));
    h.mgr.RunAction(PCB_ACTIONS.pointEditorChamferCorner);

    const p = pts(shape(3));
    expect(p).toHaveLength(5);
    expect(p).not.toContainEqual(mm(60, 20));
    // 10 mm edges: a quarter is 2.5 mm, under the 5 mm default.
    expect(p).toContainEqual(mm(60, 17.5));
    expect(p).toContainEqual(mm(57.5, 20));
  });
});

describe('PCB_POINT_EDITOR: chamfer setback', () => {
  it('is clamped by each of the two edges separately', () => {
    // The corner at (108, 10): edges of 8 mm and 20 mm, so min(5, 2, 5) = 2 mm.
    pick(9);
    mouse(h, TA_MOUSE_MOTION, mm(108, 10));
    h.mgr.RunAction(PCB_ACTIONS.pointEditorChamferCorner);

    const p = pts(shape(9));
    expect(p).toContainEqual(mm(106, 10));
    expect(p).toContainEqual(mm(108, 12));
  });
});

describe('PCB_POINT_EDITOR: what the point under the cursor is', () => {
  it('hovering a point makes it the edited point; the line between corners is a midpoint', () => {
    pick(1);
    mouse(h, TA_MOUSE_MOTION, mm(10, 10));
    expect(pe.HasCorner()).toBe(true);
    mouse(h, TA_MOUSE_MOTION, mm(15, 10));
    expect(pe.HasMidpoint()).toBe(true);
    mouse(h, TA_MOUSE_MOTION, mm(12, 12));
    expect(pe.HasPoint()).toBe(false);
    void EDIT_LINE;
  });
});

// ---- dimensions ------------------------------------------------------------

const DIM_START = 0;
const DIM_END = 1;
const DIM_TEXT = 2;
const DIM_CROSSBARSTART = 3;
const DIM_CROSSBAREND = 4;
const DIM_KNEE = DIM_CROSSBARSTART;

const dimension = (n: number): PCB_DIM_ALIGNED => byUuid(h.board, n) as unknown as PCB_DIM_ALIGNED;

/** Pick dimension `n` and drag its point `aIndex` to `aTo`. */
function dragDimPoint(n: number, aIndex: number, aTo: Vec2): PCB_DIM_ALIGNED {
  pick(n);
  const from = { ...pe.GetEditPoints()!.Point(aIndex).GetPosition() };
  drag(from, aTo);
  return dimension(n);
}

describe('PCB_POINT_EDITOR: dimensions (:1089-1610)', () => {
  it('gives the crossbar kinds five points, a radial four, a leader three, a centre mark two', () => {
    for (const [n, count] of [
      [20, 5],
      [21, 5],
      [23, 4],
      [22, 3],
      [24, 2],
    ] as const) {
      h.mgr.RunAction(ACTIONS.selectionClear);
      pick(n);
      expect(pe.GetEditPoints()!.PointsSize()).toBe(count);
      expect(pe.GetEditPoints()!.LinesSize()).toBe(0);
    }
  });

  it('moves a feature point and re-derives the label', () => {
    const d = dragDimPoint(20, DIM_END, mm(25, 0));
    expect(d.GetEnd()).toEqual(mm(25, 0));
    expect(d.GetText()).toBe('25');
  });

  it('carries a leader label along with the end it hangs off', () => {
    const d = dragDimPoint(22, DIM_END, mm(12, 14));
    expect(d.GetEnd()).toEqual(mm(12, 14));
    expect(d.GetTextPos()).toEqual(mm(22, 14));
  });

  it('carries a radial label by the knee delta, not the end delta', () => {
    pick(23);
    const before = { ...(dimension(23) as unknown as PCB_DIM_RADIAL).GetKnee() };
    const textBefore = { ...dimension(23).GetTextPos() };
    drag({ ...pe.GetEditPoints()!.Point(DIM_END).GetPosition() }, mm(20, 0));
    const after = (dimension(23) as unknown as PCB_DIM_RADIAL).GetKnee();
    expect(dimension(23).GetTextPos()).toEqual({
      x: textBefore.x + (after.x - before.x),
      y: textBefore.y + (after.y - before.y),
    });
    void DIM_KNEE;
  });

  it('dragging the label forces MANUAL mode and leaves the measurement alone', () => {
    const d = dragDimPoint(20, DIM_TEXT, mm(4, -9));
    expect(d.GetTextPositionMode()).toBe(DIM_TEXT_POSITION.MANUAL);
    expect(d.GetTextPos()).toEqual(mm(4, -9));
    expect(d.GetStart()).toEqual(mm(0, 0));
    expect(d.GetEnd()).toEqual(mm(10, 0));
  });

  it('an aligned crossbar handle sets the height from the feature line, signed by side', () => {
    const up = dragDimPoint(20, DIM_CROSSBARSTART, mm(0, -8)).GetHeight();
    expect(Math.abs(up)).toBe(8 * MM);
    expect(Math.sign(up)).toBe(-1);
  });

  it('projects the cursor onto the extension line, so sliding sideways does nothing', () => {
    const d = dragDimPoint(20, DIM_CROSSBARSTART, mm(6, -8));
    expect(d.GetHeight()).toBe(-8 * MM);
  });

  it('reads the same height from the other end of the bar', () => {
    const d = dragDimPoint(20, DIM_CROSSBAREND, mm(10, -8));
    expect(d.GetHeight()).toBe(-8 * MM);
  });

  it('an orthogonal crossbar handle takes one raw axis of the cursor as the height', () => {
    const d = dragDimPoint(21, DIM_CROSSBARSTART, mm(5, 20)) as unknown as PCB_DIM_ORTHOGONAL;
    expect(d.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL);
    expect(d.GetHeight()).toBe(20 * MM);
  });

  it('re-picks the orthogonal orientation once the cursor leaves the feature box', () => {
    const d = dragDimPoint(21, DIM_CROSSBARSTART, mm(40, 3)) as unknown as PCB_DIM_ORTHOGONAL;
    expect(d.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    expect(d.GetHeight()).toBe(40 * MM);
  });

  it('a centre mark end is held to 45 degrees off its start (EC_45DEGREE)', () => {
    const d = dragDimPoint(24, DIM_END, mm(6, 1));
    expect(d.GetEnd()).toEqual(mm(6, 0));
  });
});

// ---- text boxes and shape groups ---------------------------------------------

describe('PCB_POINT_EDITOR: text boxes and shape groups', () => {
  it('a text box corner cannot shrink it below its text (TEXTBOX_POINT_EDIT_BEHAVIOR, :1611)', () => {
    pick(40);
    const box = byUuid(h.board, 40) as unknown as PCB_TEXTBOX;
    const min = box.GetMinSize();
    expect(pe.GetEditPoints()!.PointsSize()).toBe(6);

    drag(mm(140, 20), mm(121, 11));

    expect(box.GetEnd().x - box.GetStart().x).toBeGreaterThanOrEqual(min.x);
    expect(box.GetEnd().y - box.GetStart().y).toBeGreaterThanOrEqual(min.y);
    expect(box.GetStart()).toEqual(mm(120, 10));
  });

  it('two selected shapes scale together about their centre, widths with them (:1653)', () => {
    pick(6, 7);
    const box = pe.GetEditPoints()!;
    const from = { ...box.Point(2).GetPosition() };
    const centre = { ...box.Point(4).GetPosition() };
    const before = [shape(6), shape(7)].map((s) => ({
      start: { ...s.GetStart() },
      end: { ...s.GetEnd() },
      width: s.GetWidth(),
    }));

    const topLeft = { ...box.Point(0).GetPosition() };
    const width = from.x - topLeft.x;
    const height = from.y - topLeft.y;

    // An uneven pull, so the two axis ratios differ and only their mean is right.
    // Ctrl lifts the 45-degree limit (`need_constraint = ... && !ctrlHeld`).
    // The corner starts off the 0.1 mm harness grid; SNAP_BY_GRID moves it by the
    // grid-snapped delta, and 10 mm and 4 mm are on that grid, so it lands exactly here.
    const pinned = { x: from.x + 10 * MM, y: from.y + 4 * MM };
    // One drag event: each one rescales from the box the last one left (UpdatePoints
    // puts the dragged corner back on the new bounding box), so two would compound.
    mouse(h, TA_MOUSE_MOTION, from);
    mouse(h, TA_MOUSE_DOWN, from);
    const evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, BUT_LEFT | MD_CTRL, AS_GLOBAL);
    evt.SetMousePosition(pinned);
    evt.setMouseDragOrigin(from);
    h.mgr.ProcessEvent(evt);
    mouse(h, TA_MOUSE_UP, pinned);

    const sx = (pinned.x - topLeft.x) / width;
    const sy = (pinned.y - topLeft.y) / height;
    const scale = (sx + sy) / 2;
    expect(Math.abs(sx - sy)).toBeGreaterThan(0.2);

    for (const [i, s] of [shape(6), shape(7)].entries()) {
      const b = before[i]!;
      // About the old centre: p' = c + (p - c) * scale, each rounded.
      expect(s.GetStart().x).toBeCloseTo(centre.x + (b.start.x - centre.x) * scale, -2);
      expect(s.GetStart().y).toBeCloseTo(centre.y + (b.start.y - centre.y) * scale, -2);
      expect(s.GetWidth()).toBe(Math.round(b.width * scale));
    }

    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('the centre point of a shape group moves it whole', () => {
    pick(6, 7);
    const centre = { ...pe.GetEditPoints()!.Point(4).GetPosition() };
    drag(centre, { x: centre.x + 3 * MM, y: centre.y - 2 * MM });

    expect(shape(6).GetStart()).toEqual(mm(13, 48));
    expect(shape(7).GetEnd()).toEqual(mm(23, 58));
    expect(shape(6).GetWidth()).toBe(0.2 * MM);
  });
});

// ---- rectangles, polygons, barcodes and reference images ----------------------

describe('PCB_POINT_EDITOR: rectangle and polygon details', () => {
  it('a corner cannot cross its opposite: it stops 1 mil short (PinEditedCorner)', () => {
    pick(1);
    drag(mm(20, 16), mm(5, 5), true, MD_CTRL);

    const r = shape(1);
    expect(r.GetEnd().x - r.GetStart().x).toBe(25_400);
    expect(r.GetEnd().y - r.GetStart().y).toBe(25_400);
    expect(r.GetStart()).toEqual(mm(10, 10));
  });

  it('the centre point moves the rectangle whole', () => {
    pick(1);
    drag(mm(15, 13), mm(18, 11));

    expect(shape(1).GetStart()).toEqual(mm(13, 8));
    expect(shape(1).GetEnd()).toEqual(mm(23, 14));
  });

  it('a polygon vertex moves alone', () => {
    pick(3);
    drag(mm(60, 20), mm(64, 23), true, MD_CTRL);

    expect(pts(shape(3))).toEqual([mm(50, 10), mm(60, 10), mm(64, 23), mm(50, 20)]);
  });

  it('a polygon edge slides along its neighbours (EC_CONVERGING)', () => {
    pick(3);
    // The right edge, (60, 10)-(60, 20), pulled 5 mm right.
    drag(mm(60, 15), mm(65, 15));

    expect(pts(shape(3))).toEqual([mm(50, 10), mm(65, 10), mm(65, 20), mm(50, 20)]);
  });
});

describe('PCB_POINT_EDITOR: barcodes (BARCODE_POINT_EDIT_BEHAVIOR, :680)', () => {
  const barcode = (n: number): PCB_BARCODE => byUuid(h.board, n) as unknown as PCB_BARCODE;

  it('a cardinal barcode gets the rectangle points; a rotated one none', () => {
    pick(50);
    expect(pe.GetEditPoints()!.PointsSize()).toBe(6);
    h.mgr.RunAction(ACTIONS.selectionClear);
    pick(52);
    expect(pe.GetEditPoints()!.PointsSize()).toBe(0);
  });

  it('a QR code stays square when a corner is dragged (EC_45DEGREE both diagonals)', () => {
    pick(50);
    drag(mm(206, 16), mm(202, 16), true, MD_CTRL);

    expect(barcode(50).GetWidth()).toBe(barcode(50).GetHeight());
    expect(barcode(50).GetWidth()).toBe(12 * MM);
  });

  it('a code 128 takes the dragged size as it is', () => {
    pick(51);
    drag(mm(236, 16), mm(232, 16), true, MD_CTRL);

    expect(barcode(51).GetWidth()).toBe(12 * MM);
    expect(barcode(51).GetHeight()).toBe(8 * MM);
  });

  it('the centre point moves it rather than resizing it', () => {
    pick(51);
    drag(mm(240, 20), mm(250, 30));

    expect(barcode(51).GetPosition()).toEqual(mm(250, 30));
    expect(barcode(51).GetWidth()).toBe(8 * MM);
  });
});

describe('PCB_POINT_EDITOR: reference images (REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR, :550)', () => {
  const ref = (): REFERENCE_IMAGE =>
    (byUuid(h.board, 60) as unknown as PCB_REFERENCE_IMAGE).GetReferenceImage();

  it('has four corners and the transform origin', () => {
    pick(60);
    const points = pe.GetEditPoints()!;
    expect(points.PointsSize()).toBe(5);
    expect(points.Point(4).GetPosition()).toEqual(mm(300, 50));
  });

  it('dragging the origin stores its offset from the box centre and leaves the scale', () => {
    pick(60);
    drag(mm(300, 50), mm(304, 51));

    expect(ref().GetTransformOriginOffset()).toEqual(mm(4, 1));
    expect(ref().GetImageScale()).toBe(20);
  });

  it('a corner scales about the origin by the ratio of distances, keeping the aspect', () => {
    pick(60);
    const corner = { ...pe.GetEditPoints()!.Point(2).GetPosition() };
    const twice = {
      x: 300 * MM + (corner.x - 300 * MM) * 2,
      y: 50 * MM + (corner.y - 50 * MM) * 2,
    };
    drag(corner, twice, true, MD_CTRL);

    expect(ref().GetImageScale()).toBeCloseTo(40, 2);
  });

  it('a corner dragged past the origin collapses to the 50 mil floor', () => {
    pick(60);
    const corner = { ...pe.GetEditPoints()!.Point(2).GetPosition() };
    drag(corner, mm(290, 40), true, MD_CTRL);

    // `ratio = min( newWidth / oldSize.x, newHeight / oldSize.y )` with both new sizes at
    // the 50 mil floor: the LARGER side lands on 1.27 mm. The fixture is 13 x 9 pixels.
    const size = ref().GetSize();
    expect(Math.abs(Math.max(size.x, size.y) - 1_270_000)).toBeLessThanOrEqual(1);
    expect(Math.min(size.x, size.y)).toBeLessThan(1_270_000);
  });
});
