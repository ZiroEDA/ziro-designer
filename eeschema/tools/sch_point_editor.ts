// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_POINT_EDITOR` (eeschema/tools/sch_point_editor.{h,cpp}): drag handles on the selected
 * shape, rule area, text box, table cell, sheet, image or graphic line, with the
 * per-item POINT_EDIT_BEHAVIORs it builds them from.
 */
import type { COMMIT } from '@ziroeda/common/commit.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { ENDPOINT, IS_MOVING, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import { type EDA_SHAPE, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { ARC_EDIT_MODE, FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ANGLE_ITEM } from '@ziroeda/common/preview_items/angle_item.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { EC_PERPLINE } from '@ziroeda/common/tool/edit_constraints.js';
import { EDIT_POINT, EDIT_POINTS } from '@ziroeda/common/tool/edit_points.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import {
  EDA_ARC_POINT_EDIT_BEHAVIOR,
  EDA_BEZIER_POINT_EDIT_BEHAVIOR,
  EDA_CIRCLE_POINT_EDIT_BEHAVIOR,
  EDA_POLYGON_POINT_EDIT_BEHAVIOR,
  EDA_TABLECELL_POINT_EDIT_BEHAVIOR,
  IncrementArcEditMode,
  POINT_EDIT_BEHAVIOR,
} from '@ziroeda/common/tool/point_editor_behavior.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { BUT_LEFT, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KIGEOM_GetSegsInDirection } from '@ziroeda/kimath/src/geometry/shape_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
import { ARC_LOW_DEF_MM } from '@ziroeda/kimath/src/base_units.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import type { SCH_BITMAP } from '../sch_bitmap.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_LINE } from '../sch_line.js';
import type { SCH_NO_CONNECT } from '../sch_no_connect.js';
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { SCH_SHAPE } from '../sch_shape.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PIN } from '../sch_sheet_pin.js';
import type { SCH_TABLE } from '../sch_table.js';
import type { SCH_TABLECELL } from '../sch_tablecell.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { updateSymbolEditorSettings } from '../symbol_editor/symbol_editor_settings.js';
import { updateEeschemaSettings } from '../eeschema_settings.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

const pointEditorTypes: readonly KICAD_T[] = [
  KICAD_T.SCH_SHAPE_T,
  KICAD_T.SCH_RULE_AREA_T,
  KICAD_T.SCH_TEXTBOX_T,
  KICAD_T.SCH_TABLECELL_T,
  KICAD_T.SCH_SHEET_T,
  KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T,
  KICAD_T.SCH_BITMAP_T,
];

// Few constants to avoid using bare numbers for point indices
// enum RECTANGLE_POINTS
const RECT_TOPLEFT = 0;
const RECT_TOPRIGHT = 1;
const RECT_BOTLEFT = 2;
const RECT_BOTRIGHT = 3;
const RECT_CENTER = 4;
const RECT_RADIUS = 5;

// enum RECTANGLE_LINES
const RECT_TOP = 0;
const RECT_RIGHT = 1;
const RECT_BOT = 2;
const RECT_LEFT = 3;

// enum REFIMAGE_POINTS
const REFIMG_ORIGIN = RECT_BOTRIGHT + 1;

// enum TABLECELL_POINTS
const COL_WIDTH = 0;
const ROW_HEIGHT = 1;

// enum LINE_POINTS
const LINE_START = 0;
const LINE_END = 1;

const same = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;
const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
const asEdaShape = (aShape: SCH_SHAPE): EDA_SHAPE => aShape as unknown as EDA_SHAPE;

class LINE_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  constructor(
    private readonly m_line: SCH_LINE,
    private readonly m_screen: SCH_SCREEN,
  ) {
    super();
  }

  MakePoints(aPoints: EDIT_POINTS): void {
    let connectedStart: [EDA_ITEM | null, number] = [null, STARTPOINT];
    let connectedEnd: [EDA_ITEM | null, number] = [null, STARTPOINT];

    for (const test of this.m_screen.Items().OfType(KICAD_T.SCH_LINE_T)) {
      if (test.GetLayer() !== SCH_LAYER_ID.LAYER_NOTES) continue;

      if (test === this.m_line) continue;

      const testLine = test as SCH_LINE;

      if (same(testLine.GetStartPoint(), this.m_line.GetStartPoint())) {
        connectedStart = [testLine, STARTPOINT];
      } else if (same(testLine.GetEndPoint(), this.m_line.GetStartPoint())) {
        connectedStart = [testLine, ENDPOINT];
      } else if (same(testLine.GetStartPoint(), this.m_line.GetEndPoint())) {
        connectedEnd = [testLine, STARTPOINT];
      } else if (same(testLine.GetEndPoint(), this.m_line.GetEndPoint())) {
        connectedEnd = [testLine, ENDPOINT];
      }
    }

    aPoints.AddPoint(this.m_line.GetStartPoint(), connectedStart);
    aPoints.AddPoint(this.m_line.GetEndPoint(), connectedEnd);
  }

  UpdatePoints(aPoints: EDIT_POINTS): boolean {
    aPoints.Point(LINE_START).SetPosition(this.m_line.GetStartPoint());
    aPoints.Point(LINE_END).SetPosition(this.m_line.GetEndPoint());
    return true;
  }

  UpdateItem(
    _aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    this.m_line.SetStartPoint(aPoints.Point(LINE_START).GetPosition());
    this.m_line.SetEndPoint(aPoints.Point(LINE_END).GetPosition());

    let connected = aPoints.Point(LINE_START).GetConnected();

    if (connected[0]) {
      aCommit.Modify(connected[0], this.m_screen);
      aUpdatedItems.push(connected[0]);

      if (connected[1] === STARTPOINT)
        (connected[0] as SCH_LINE).SetStartPoint(this.m_line.GetStartPoint());
      else if (connected[1] === ENDPOINT)
        (connected[0] as SCH_LINE).SetEndPoint(this.m_line.GetStartPoint());
    }

    connected = aPoints.Point(LINE_END).GetConnected();

    if (connected[0]) {
      aCommit.Modify(connected[0], this.m_screen);
      aUpdatedItems.push(connected[0]);

      if (connected[1] === STARTPOINT)
        (connected[0] as SCH_LINE).SetStartPoint(this.m_line.GetEndPoint());
      else if (connected[1] === ENDPOINT)
        (connected[0] as SCH_LINE).SetEndPoint(this.m_line.GetEndPoint());
    }
  }
}

class BITMAP_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  constructor(private readonly m_bitmap: SCH_BITMAP) {
    super();
  }

  MakePoints(aPoints: EDIT_POINTS): void {
    const refImage = this.m_bitmap.GetReferenceImage();
    const pos = refImage.GetPosition();
    const size = refImage.GetSize();
    const topLeft = { x: pos.x - Math.trunc(size.x / 2), y: pos.y - Math.trunc(size.y / 2) };
    const botRight = { x: pos.x + Math.trunc(size.x / 2), y: pos.y + Math.trunc(size.y / 2) };
    const offset = refImage.GetTransformOriginOffset();

    aPoints.AddPoint(topLeft);
    aPoints.AddPoint({ x: botRight.x, y: topLeft.y });
    aPoints.AddPoint({ x: topLeft.x, y: botRight.y });
    aPoints.AddPoint(botRight);

    aPoints.AddPoint({ x: pos.x + offset.x, y: pos.y + offset.y });
  }

  UpdatePoints(aPoints: EDIT_POINTS): boolean {
    const refImage = this.m_bitmap.GetReferenceImage();
    const pos = refImage.GetPosition();
    const size = refImage.GetSize();
    const topLeft = { x: pos.x - Math.trunc(size.x / 2), y: pos.y - Math.trunc(size.y / 2) };
    const botRight = { x: pos.x + Math.trunc(size.x / 2), y: pos.y + Math.trunc(size.y / 2) };
    const offset = refImage.GetTransformOriginOffset();

    aPoints.Point(RECT_TOPLEFT).SetPosition(topLeft);
    aPoints.Point(RECT_TOPRIGHT).SetPosition({ x: botRight.x, y: topLeft.y });
    aPoints.Point(RECT_BOTLEFT).SetPosition({ x: topLeft.x, y: botRight.y });
    aPoints.Point(RECT_BOTRIGHT).SetPosition(botRight);

    aPoints.Point(REFIMG_ORIGIN).SetPosition({ x: pos.x + offset.x, y: pos.y + offset.y });
    return true;
  }

  UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    const refImg = this.m_bitmap.GetReferenceImage();
    const topLeft = aPoints.Point(RECT_TOPLEFT).GetPosition();
    const topRight = aPoints.Point(RECT_TOPRIGHT).GetPosition();
    const botLeft = aPoints.Point(RECT_BOTLEFT).GetPosition();
    const botRight = aPoints.Point(RECT_BOTRIGHT).GetPosition();
    const xfrmOrigin = aPoints.Point(REFIMG_ORIGIN).GetPosition();

    if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(REFIMG_ORIGIN))) {
      // Moving the transform origin
      // As the other points didn't move, we can get the image extent from them
      const newOffset = {
        x: xfrmOrigin.x - Math.trunc((topLeft.x + botRight.x) / 2),
        y: xfrmOrigin.y - Math.trunc((topLeft.y + botRight.y) / 2),
      };
      refImg.SetTransformOriginOffset(newOffset);
    } else {
      const imgPos = refImg.GetPosition();
      const imgOffset = refImg.GetTransformOriginOffset();
      const oldOrigin = { x: imgPos.x + imgOffset.x, y: imgPos.y + imgOffset.y };
      const oldSize = refImg.GetSize();
      const pos = refImg.GetPosition();

      let newCorner: VECTOR2I | null = null;
      const oldCorner = { x: pos.x, y: pos.y };
      const half = (v: VECTOR2I) => ({ x: Math.trunc(v.x / 2), y: Math.trunc(v.y / 2) });

      if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_TOPLEFT))) {
        newCorner = { ...topLeft };
        const h = half(oldSize);
        oldCorner.x -= h.x;
        oldCorner.y -= h.y;
      } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_TOPRIGHT))) {
        newCorner = { ...topRight };
        const h = half({ x: -oldSize.x, y: oldSize.y });
        oldCorner.x -= h.x;
        oldCorner.y -= h.y;
      } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_BOTLEFT))) {
        newCorner = { ...botLeft };
        const h = half({ x: oldSize.x, y: -oldSize.y });
        oldCorner.x -= h.x;
        oldCorner.y -= h.y;
      } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_BOTRIGHT))) {
        newCorner = { ...botRight };
        const h = half(oldSize);
        oldCorner.x += h.x;
        oldCorner.y += h.y;
      }

      if (newCorner) {
        // Turn in the respective vectors from the origin
        newCorner = { x: newCorner.x - xfrmOrigin.x, y: newCorner.y - xfrmOrigin.y };
        oldCorner.x -= oldOrigin.x;
        oldCorner.y -= oldOrigin.y;

        // If we tried to cross the origin, clamp it to stop it
        if (sign(newCorner.x) !== sign(oldCorner.x) || sign(newCorner.y) !== sign(oldCorner.y)) {
          newCorner = { x: 0, y: 0 };
        }

        const newLength = Math.hypot(newCorner.x, newCorner.y);
        const oldLength = Math.hypot(oldCorner.x, oldCorner.y);

        let ratio = oldLength > 0 ? newLength / oldLength : 1.0;

        // Clamp the scaling to a minimum of 50 mils
        // VECTOR2I * double rounds each component (KiROUND in VECTOR2::operator*)
        const newSize = { x: Math.round(oldSize.x * ratio), y: Math.round(oldSize.y * ratio) };
        const newWidth = Math.max(newSize.x, schIUScale.milsToIU(50));
        const newHeight = Math.max(newSize.y, schIUScale.milsToIU(50));
        ratio = Math.min(newWidth / oldSize.x, newHeight / oldSize.y);

        // Also handles the origin offset
        refImg.SetImageScale(refImg.GetImageScale() * ratio);
      }
    }

    aUpdatedItems.push(this.m_bitmap);
  }
}

class SCH_TABLECELL_POINT_EDIT_BEHAVIOR extends EDA_TABLECELL_POINT_EDIT_BEHAVIOR {
  constructor(
    // `m_cell` upstream, which shadows the base class's; the base's is private here.
    private readonly m_tableCell: SCH_TABLECELL,
    private readonly m_screen: SCH_SCREEN,
  ) {
    super(asEdaShape(m_tableCell));
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    const table = this.m_tableCell.GetParent() as SCH_TABLE;
    const rotated = !this.m_tableCell.GetTextAngle().IsHorizontal();

    aCommit.Modify(table, this.m_screen);
    aUpdatedItems.push(table);

    const editRowHeight = (aHeight: number) => {
      let rowHeight = aHeight;

      for (let ii = 0; ii < this.m_tableCell.GetRowSpan() - 1; ++ii)
        rowHeight -= table.GetRowHeight(this.m_tableCell.GetRow() + ii);

      table.SetRowHeight(this.m_tableCell.GetRow() + this.m_tableCell.GetRowSpan() - 1, rowHeight);
    };

    const editColWidth = (aWidth: number) => {
      let colWidth = aWidth;

      for (let ii = 0; ii < this.m_tableCell.GetColSpan() - 1; ++ii)
        colWidth -= table.GetColWidth(this.m_tableCell.GetColumn() + ii);

      table.SetColWidth(this.m_tableCell.GetColumn() + this.m_tableCell.GetColSpan() - 1, colWidth);
    };

    if (rotated) {
      if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(ROW_HEIGHT))) {
        this.m_tableCell.SetEnd({
          x: this.m_tableCell.GetEndX(),
          y: aPoints.Point(ROW_HEIGHT).GetY(),
        });

        editColWidth(Math.abs(this.m_tableCell.GetRectangleHeight()));
      } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(COL_WIDTH))) {
        this.m_tableCell.SetEnd({
          x: aPoints.Point(COL_WIDTH).GetX(),
          y: this.m_tableCell.GetEndY(),
        });

        editRowHeight(this.m_tableCell.GetRectangleWidth());
      }
    } else {
      if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(COL_WIDTH))) {
        this.m_tableCell.SetEnd({
          x: aPoints.Point(COL_WIDTH).GetX(),
          y: this.m_tableCell.GetEndY(),
        });

        editColWidth(this.m_tableCell.GetRectangleWidth());
      } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(ROW_HEIGHT))) {
        this.m_tableCell.SetEnd({
          x: this.m_tableCell.GetEndX(),
          y: aPoints.Point(ROW_HEIGHT).GetY(),
        });

        editRowHeight(this.m_tableCell.GetRectangleHeight());
      }
    }

    table.Normalize();
  }
}

class RECTANGLE_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  constructor(
    private readonly m_rect: SCH_SHAPE,
    private readonly m_frame: SCH_BASE_FRAME,
  ) {
    super();
  }

  static MakeRectPoints(aRect: SCH_SHAPE, aPoints: EDIT_POINTS): void {
    const topLeft = aRect.GetPosition();
    const botRight = aRect.GetEnd();

    aPoints.AddPoint(topLeft);
    aPoints.AddPoint({ x: botRight.x, y: topLeft.y });
    aPoints.AddPoint({ x: topLeft.x, y: botRight.y });
    aPoints.AddPoint(botRight);
    aPoints.AddPoint(aRect.GetCenter());
    aPoints.AddPoint({ x: botRight.x - aRect.GetCornerRadius(), y: topLeft.y });
    aPoints.Point(RECT_RADIUS).SetDrawCircle();

    aPoints.AddLine(aPoints.Point(RECT_TOPLEFT), aPoints.Point(RECT_TOPRIGHT));
    aPoints.Line(RECT_TOP).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_TOP)));
    aPoints.AddLine(aPoints.Point(RECT_TOPRIGHT), aPoints.Point(RECT_BOTRIGHT));
    aPoints.Line(RECT_RIGHT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_RIGHT)));
    aPoints.AddLine(aPoints.Point(RECT_BOTRIGHT), aPoints.Point(RECT_BOTLEFT));
    aPoints.Line(RECT_BOT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_BOT)));
    aPoints.AddLine(aPoints.Point(RECT_BOTLEFT), aPoints.Point(RECT_TOPLEFT));
    aPoints.Line(RECT_LEFT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_LEFT)));
  }

  static UpdateRectPoints(aRect: SCH_SHAPE, aPoints: EDIT_POINTS): void {
    const topLeft = aRect.GetPosition();
    const botRight = aRect.GetEnd();

    aPoints.Point(RECT_TOPLEFT).SetPosition(topLeft);
    aPoints
      .Point(RECT_RADIUS)
      .SetPosition({ x: botRight.x - aRect.GetCornerRadius(), y: topLeft.y });
    aPoints.Point(RECT_TOPRIGHT).SetPosition({ x: botRight.x, y: topLeft.y });
    aPoints.Point(RECT_BOTLEFT).SetPosition({ x: topLeft.x, y: botRight.y });
    aPoints.Point(RECT_BOTRIGHT).SetPosition(botRight);
    aPoints.Point(RECT_CENTER).SetPosition(aRect.GetCenter());
  }

  /**
   * Update the coordinates of 4 corners of a rectangle, according to constraints
   * and the moved corner. The four corners are updated in place.
   */
  static PinEditedCorner(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    minWidth: number,
    minHeight: number,
    topLeft: { x: number; y: number },
    topRight: { x: number; y: number },
    botLeft: { x: number; y: number },
    botRight: { x: number; y: number },
  ): void {
    const isModified = POINT_EDIT_BEHAVIOR.isModified;

    if (isModified(aEditedPoint, aPoints.Point(RECT_TOPLEFT))) {
      // pin edited point within opposite corner
      topLeft.x = Math.min(topLeft.x, botRight.x - minWidth);
      topLeft.y = Math.min(topLeft.y, botRight.y - minHeight);

      // push edited point edges to adjacent corners
      topRight.y = topLeft.y;
      botLeft.x = topLeft.x;
    } else if (isModified(aEditedPoint, aPoints.Point(RECT_TOPRIGHT))) {
      // pin edited point within opposite corner
      topRight.x = Math.max(topRight.x, botLeft.x + minWidth);
      topRight.y = Math.min(topRight.y, botLeft.y - minHeight);

      // push edited point edges to adjacent corners
      topLeft.y = topRight.y;
      botRight.x = topRight.x;
    } else if (isModified(aEditedPoint, aPoints.Point(RECT_BOTLEFT))) {
      // pin edited point within opposite corner
      botLeft.x = Math.min(botLeft.x, topRight.x - minWidth);
      botLeft.y = Math.max(botLeft.y, topRight.y + minHeight);

      // push edited point edges to adjacent corners
      botRight.y = botLeft.y;
      topLeft.x = botLeft.x;
    } else if (isModified(aEditedPoint, aPoints.Point(RECT_BOTRIGHT))) {
      // pin edited point within opposite corner
      botRight.x = Math.max(botRight.x, topLeft.x + minWidth);
      botRight.y = Math.max(botRight.y, topLeft.y + minHeight);

      // push edited point edges to adjacent corners
      botLeft.y = botRight.y;
      topRight.x = botRight.x;
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_TOP))) {
      topLeft.y = Math.min(topLeft.y, botRight.y - minHeight);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_LEFT))) {
      topLeft.x = Math.min(topLeft.x, botRight.x - minWidth);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_BOT))) {
      botRight.y = Math.max(botRight.y, topLeft.y + minHeight);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_RIGHT))) {
      botRight.x = Math.max(botRight.x, topLeft.x + minWidth);
    }
  }

  /** The static `UpdateItem( aRect, aEditedPoint, aPoints, aMinSize )` the text box uses. */
  static UpdateRectItem(
    aRect: SCH_SHAPE,
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aMinSize: VECTOR2I = { x: 0, y: 0 },
  ): void {
    const isModified = POINT_EDIT_BEHAVIOR.isModified;
    const topLeft = { ...aPoints.Point(RECT_TOPLEFT).GetPosition() };
    const topRight = { ...aPoints.Point(RECT_TOPRIGHT).GetPosition() };
    const botLeft = { ...aPoints.Point(RECT_BOTLEFT).GetPosition() };
    const botRight = { ...aPoints.Point(RECT_BOTRIGHT).GetPosition() };

    const minWidth = Math.max(schIUScale.milsToIU(1), aMinSize.x);
    const minHeight = Math.max(schIUScale.milsToIU(1), aMinSize.y);

    RECTANGLE_POINT_EDIT_BEHAVIOR.PinEditedCorner(
      aEditedPoint,
      aPoints,
      minWidth,
      minHeight,
      topLeft,
      topRight,
      botLeft,
      botRight,
    );

    if (
      isModified(aEditedPoint, aPoints.Point(RECT_TOPLEFT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_TOPRIGHT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_BOTRIGHT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_BOTLEFT))
    ) {
      aRect.SetPosition(topLeft);
      aRect.SetEnd(botRight);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_TOP))) {
      aRect.SetStartY(topLeft.y);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_LEFT))) {
      aRect.SetStartX(topLeft.x);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_BOT))) {
      aRect.SetEndY(botRight.y);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_RIGHT))) {
      aRect.SetEndX(botRight.x);
    }

    for (let i = 0; i < aPoints.LinesSize(); ++i) {
      if (!isModified(aEditedPoint, aPoints.Line(i)))
        aPoints.Line(i).SetConstraint(new EC_PERPLINE(aPoints.Line(i)));
    }
  }

  MakePoints(aPoints: EDIT_POINTS): void {
    this.m_rect.Normalize();
    RECTANGLE_POINT_EDIT_BEHAVIOR.MakeRectPoints(this.m_rect, aPoints);
  }

  UpdatePoints(aPoints: EDIT_POINTS): boolean {
    this.m_rect.Normalize();
    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectPoints(this.m_rect, aPoints);
    return true;
  }

  UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    const isModified = POINT_EDIT_BEHAVIOR.isModified;
    const topLeft = { ...aPoints.Point(RECT_TOPLEFT).GetPosition() };
    const topRight = { ...aPoints.Point(RECT_TOPRIGHT).GetPosition() };
    const botLeft = { ...aPoints.Point(RECT_BOTLEFT).GetPosition() };
    const botRight = { ...aPoints.Point(RECT_BOTRIGHT).GetPosition() };

    RECTANGLE_POINT_EDIT_BEHAVIOR.PinEditedCorner(
      aEditedPoint,
      aPoints,
      schIUScale.milsToIU(1),
      schIUScale.milsToIU(1),
      topLeft,
      topRight,
      botLeft,
      botRight,
    );

    const oldBox = BOX2I.ByCorners(this.m_rect.GetStart(), this.m_rect.GetEnd());
    let oldSegs: SEG[] = [];
    const moveVecs: VECTOR2I[] = [];

    if (
      isModified(aEditedPoint, aPoints.Point(RECT_TOPLEFT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_TOPRIGHT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_BOTRIGHT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_BOTLEFT))
    ) {
      // Corner drags don't update pins. Not only is it an escape hatch to avoid
      // moving pins, it also avoids tricky problems when the pins "fall off"
      // the ends of one of the two segments and get either left behind or
      // "swept up" into the corner.
      this.m_rect.SetPosition(topLeft);
      this.m_rect.SetEnd(botRight);
    } else if (isModified(aEditedPoint, aPoints.Point(RECT_CENTER))) {
      const c = aPoints.Point(RECT_CENTER).GetPosition();
      const oc = oldBox.GetCenter();
      this.m_rect.Move({ x: c.x - oc.x, y: c.y - oc.y });
    } else if (isModified(aEditedPoint, aPoints.Point(RECT_RADIUS))) {
      const width = Math.abs(botRight.x - topLeft.x);
      const height = Math.abs(botRight.y - topLeft.y);
      const maxRadius = Math.trunc(Math.min(width, height) / 2);
      let x = aPoints.Point(RECT_RADIUS).GetX();
      x = Math.min(Math.max(x, botRight.x - maxRadius), botRight.x); // std::clamp
      aPoints.Point(RECT_RADIUS).SetPosition({ x, y: topLeft.y });
      this.m_rect.SetCornerRadius(botRight.x - x);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_TOP))) {
      oldSegs = KIGEOM_GetSegsInDirection(oldBox, Directions.N);
      moveVecs.push({ x: 0, y: topLeft.y - oldBox.GetTop() });
      this.m_rect.SetStartY(topLeft.y);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_LEFT))) {
      oldSegs = KIGEOM_GetSegsInDirection(oldBox, Directions.W);
      moveVecs.push({ x: topLeft.x - oldBox.GetLeft(), y: 0 });
      this.m_rect.SetStartX(topLeft.x);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_BOT))) {
      oldSegs = KIGEOM_GetSegsInDirection(oldBox, Directions.S);
      moveVecs.push({ x: 0, y: botRight.y - oldBox.GetBottom() });
      this.m_rect.SetEndY(botRight.y);
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_RIGHT))) {
      oldSegs = KIGEOM_GetSegsInDirection(oldBox, Directions.E);
      moveVecs.push({ x: botRight.x - oldBox.GetRight(), y: 0 });
      this.m_rect.SetEndX(botRight.x);
    }

    this.dragPinsOnEdge(oldSegs, moveVecs, this.m_rect.GetUnit(), aCommit, aUpdatedItems);

    for (let i = 0; i < aPoints.LinesSize(); ++i) {
      if (!isModified(aEditedPoint, aPoints.Line(i)))
        aPoints.Line(i).SetConstraint(new EC_PERPLINE(aPoints.Line(i)));
    }
  }

  private dragPinsOnEdge(
    aOldEdges: SEG[],
    aMoveVecs: VECTOR2I[],
    aEdgeUnit: number,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    if (aOldEdges.length !== aMoveVecs.length) return; // wxCHECK

    // This only make sense in the symbol editor
    if (!this.m_frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR)) return;

    const editor = this.m_frame as unknown as SYMBOL_EDIT_FRAME;

    // And only if the setting is enabled
    if (!editor.GetSettings()?.drag_pins_along_with_edges) return;

    // Adjuting pins on a different unit to a unit-limited shape
    // seems suspect.
    if (!(aEdgeUnit === 0 || aEdgeUnit === editor.GetUnit())) return; // wxCHECK

    /*
     * Get a list of pins on a line segment
     */
    const getPinsOnSeg = (
      aSymbol: NonNullable<ReturnType<SYMBOL_EDIT_FRAME['GetCurSymbol']>>,
      aUnit: number,
      aSeg: SEG,
      aIncludeEnds: boolean,
    ): SCH_PIN[] => {
      const pins: SCH_PIN[] = [];

      for (const pin of aSymbol.GetGraphicalPins(aUnit, 0)) {
        // Figure out if the pin "connects" to the line
        const pinRootPos = pin.GetPinRoot();

        if (aSeg.Contains(pinRootPos)) {
          if (aIncludeEnds || (!same(pinRootPos, aSeg.A) && !same(pinRootPos, aSeg.B)))
            pins.push(pin);
        }
      }

      return pins;
    };

    const symbol = editor.GetCurSymbol();

    for (let i = 0; i < aOldEdges.length; ++i) {
      if ((aMoveVecs[i]!.x === 0 && aMoveVecs[i]!.y === 0) || !symbol) continue;

      const pins = getPinsOnSeg(symbol, aEdgeUnit, aOldEdges[i]!, false);

      for (const pin of pins) {
        aCommit.Modify(pin, editor.GetScreen());
        aUpdatedItems.push(pin);

        // Move the pin
        pin.Move(aMoveVecs[i]!);
      }
    }
  }
}

class TEXTBOX_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  constructor(private readonly m_textbox: SCH_TEXTBOX) {
    super();
  }

  MakePoints(aPoints: EDIT_POINTS): void {
    this.m_textbox.Normalize();
    RECTANGLE_POINT_EDIT_BEHAVIOR.MakeRectPoints(this.m_textbox, aPoints);
  }

  UpdatePoints(aPoints: EDIT_POINTS): boolean {
    // point editor works only with rectangles having width and height > 0
    // Some symbols can have rectangles with width or height < 0
    // So normalize the size:
    this.m_textbox.Normalize();
    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectPoints(this.m_textbox, aPoints);
    return true;
  }

  UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    this.m_textbox.ClearBoundingBoxCache();
    const minSize = this.m_textbox.GetMinSize();

    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectItem(this.m_textbox, aEditedPoint, aPoints, minSize);
    this.m_textbox.ClearRenderCache();
  }
}

class SHEET_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_noConnects: Map<SCH_SHEET_PIN, SCH_NO_CONNECT>;
  private readonly m_connectedWires: [SCH_SHEET_PIN, SCH_LINE, number][] = [];

  constructor(
    private readonly m_sheet: SCH_SHEET,
    private readonly m_screen: SCH_SCREEN,
  ) {
    super();
    this.m_noConnects = this.m_sheet.GetNoConnects();

    // Find all wires connected to sheet pins and store their connections
    for (const pin of this.m_sheet.GetPins()) {
      const pinPos = pin.GetPosition();

      for (const item of this.m_screen.Items().Overlapping(KICAD_T.SCH_LINE_T, pinPos)) {
        const line = item as SCH_LINE;

        if (!line.IsWire() && !line.IsBus()) continue;

        if (same(line.GetStartPoint(), pinPos)) this.m_connectedWires.push([pin, line, STARTPOINT]);
        else if (same(line.GetEndPoint(), pinPos))
          this.m_connectedWires.push([pin, line, ENDPOINT]);
      }
    }
  }

  MakePoints(aPoints: EDIT_POINTS): void {
    const topLeft = this.m_sheet.GetPosition();
    const size = this.m_sheet.GetSize();
    const botRight = { x: topLeft.x + size.x, y: topLeft.y + size.y };

    aPoints.AddPoint(topLeft);
    aPoints.AddPoint({ x: botRight.x, y: topLeft.y });
    aPoints.AddPoint({ x: topLeft.x, y: botRight.y });
    aPoints.AddPoint(botRight);

    aPoints.AddLine(aPoints.Point(RECT_TOPLEFT), aPoints.Point(RECT_TOPRIGHT));
    aPoints.Line(RECT_TOP).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_TOP)));
    aPoints.AddLine(aPoints.Point(RECT_TOPRIGHT), aPoints.Point(RECT_BOTRIGHT));
    aPoints.Line(RECT_RIGHT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_RIGHT)));
    aPoints.AddLine(aPoints.Point(RECT_BOTRIGHT), aPoints.Point(RECT_BOTLEFT));
    aPoints.Line(RECT_BOT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_BOT)));
    aPoints.AddLine(aPoints.Point(RECT_BOTLEFT), aPoints.Point(RECT_TOPLEFT));
    aPoints.Line(RECT_LEFT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_LEFT)));
  }

  UpdatePoints(aPoints: EDIT_POINTS): boolean {
    const topLeft = this.m_sheet.GetPosition();
    const size = this.m_sheet.GetSize();
    const botRight = { x: topLeft.x + size.x, y: topLeft.y + size.y };

    aPoints.Point(RECT_TOPLEFT).SetPosition(topLeft);
    aPoints.Point(RECT_TOPRIGHT).SetPosition({ x: botRight.x, y: topLeft.y });
    aPoints.Point(RECT_BOTLEFT).SetPosition({ x: topLeft.x, y: botRight.y });
    aPoints.Point(RECT_BOTRIGHT).SetPosition(botRight);
    return true;
  }

  UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    const isModified = POINT_EDIT_BEHAVIOR.isModified;
    const topLeft = { ...aPoints.Point(RECT_TOPLEFT).GetPosition() };
    const topRight = { ...aPoints.Point(RECT_TOPRIGHT).GetPosition() };
    const botLeft = { ...aPoints.Point(RECT_BOTLEFT).GetPosition() };
    const botRight = { ...aPoints.Point(RECT_BOTRIGHT).GetPosition() };
    let sheetNewPos = this.m_sheet.GetPosition();
    let sheetNewSize = this.m_sheet.GetSize();

    let editedTopRight = isModified(aEditedPoint, aPoints.Point(RECT_TOPRIGHT));
    let editedBotLeft = isModified(aEditedPoint, aPoints.Point(RECT_BOTLEFT));
    const editedBotRight = isModified(aEditedPoint, aPoints.Point(RECT_BOTRIGHT));

    if (isModified(aEditedPoint, aPoints.Line(RECT_RIGHT))) editedTopRight = true;
    else if (isModified(aEditedPoint, aPoints.Line(RECT_BOT))) editedBotLeft = true;

    RECTANGLE_POINT_EDIT_BEHAVIOR.PinEditedCorner(
      aEditedPoint,
      aPoints,
      this.m_sheet.GetMinWidth(editedTopRight || editedBotRight),
      this.m_sheet.GetMinHeight(editedBotLeft || editedBotRight),
      topLeft,
      topRight,
      botLeft,
      botRight,
    );

    if (
      isModified(aEditedPoint, aPoints.Point(RECT_TOPLEFT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_TOPRIGHT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_BOTRIGHT)) ||
      isModified(aEditedPoint, aPoints.Point(RECT_BOTLEFT))
    ) {
      sheetNewPos = topLeft;
      sheetNewSize = { x: botRight.x - topLeft.x, y: botRight.y - topLeft.y };
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_TOP))) {
      sheetNewPos = { x: this.m_sheet.GetPosition().x, y: topLeft.y };
      sheetNewSize = { x: this.m_sheet.GetSize().x, y: botRight.y - topLeft.y };
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_LEFT))) {
      sheetNewPos = { x: topLeft.x, y: this.m_sheet.GetPosition().y };
      sheetNewSize = { x: botRight.x - topLeft.x, y: this.m_sheet.GetSize().y };
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_BOT))) {
      sheetNewSize = { x: this.m_sheet.GetSize().x, y: botRight.y - topLeft.y };
    } else if (isModified(aEditedPoint, aPoints.Line(RECT_RIGHT))) {
      sheetNewSize = { x: botRight.x - topLeft.x, y: this.m_sheet.GetSize().y };
    }

    for (let i = 0; i < aPoints.LinesSize(); ++i) {
      if (!isModified(aEditedPoint, aPoints.Line(i)))
        aPoints.Line(i).SetConstraint(new EC_PERPLINE(aPoints.Line(i)));
    }

    if (!same(this.m_sheet.GetPosition(), sheetNewPos))
      this.m_sheet.SetPositionIgnoringPins(sheetNewPos);

    if (!same(this.m_sheet.GetSize(), sheetNewSize)) this.m_sheet.Resize(sheetNewSize);

    // Update no-connects to follow their sheet pins
    for (const [sheetPin, noConnect] of this.m_noConnects) {
      if (!same(noConnect.GetPosition(), sheetPin.GetTextPos())) {
        aCommit.Modify(noConnect, this.m_screen);
        noConnect.SetPosition(sheetPin.GetTextPos());
        aUpdatedItems.push(noConnect);
      }
    }

    // Update connected wires to follow their sheet pins
    for (const [pin, line, endpoint] of this.m_connectedWires) {
      const newPinPos = pin.GetPosition();
      let needsUpdate = false;

      if (endpoint === STARTPOINT && !same(line.GetStartPoint(), newPinPos)) needsUpdate = true;
      else if (endpoint === ENDPOINT && !same(line.GetEndPoint(), newPinPos)) needsUpdate = true;

      if (needsUpdate) {
        aCommit.Modify(line, this.m_screen);

        if (endpoint === STARTPOINT) line.SetStartPoint(newPinPos);
        else line.SetEndPoint(newPinPos);

        aUpdatedItems.push(line);
      }
    }
  }
}

export class SCH_POINT_EDITOR extends SCH_TOOL_BASE<SCH_BASE_FRAME> {
  ///< Currently edited point, NULL if there is none.
  private m_editedPoint: EDIT_POINT | null = null;

  ///< True while a point is being dragged; IsDragging() reports it.
  private m_inDrag = false;

  /// `m_arcEditMode`, a cell: EDA_ARC_POINT_EDIT_BEHAVIOR holds a reference and reads it live.
  private readonly m_arcEditMode = { value: ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS };

  ///< Currently edited points set (points and lines that can be edited)
  private m_editPoints: EDIT_POINTS | null = null;
  private m_editBehavior: POINT_EDIT_BEHAVIOR | null = null;
  private m_angleItem: ANGLE_ITEM | null = null;

  private m_inPointEditor = false;

  constructor() {
    super('eeschema.PointEditor');
  }

  /**
   * Indicate the cursor is over an edit point.  Used to coordinate cursor shapes with
   * other tools.
   */
  HasPoint(): boolean {
    return this.m_editedPoint !== null;
  }

  /** `IsDragging()`: whether a point is being dragged (the autosave waits for it). */
  IsDragging(): boolean {
    return this.m_inDrag;
  }

  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as VIEW_CONTROLS;
  }

  private makePointsAndBehavior(aItem: EDA_ITEM | null): void {
    this.m_editBehavior = null;
    this.m_editPoints = new EDIT_POINTS(aItem);

    if (!aItem) return;

    // Generate list of edit points based on the item type
    switch (aItem.Type()) {
      case KICAD_T.SCH_SHAPE_T: {
        const shape = aItem as SCH_SHAPE;

        switch (shape.GetShape()) {
          case SHAPE_T.ARC:
            // EDA_ARC_POINT_EDIT_BEHAVIOR holds a reference to m_arcEditMode, so the
            // persisted value must be synced from settings before the behavior is built.
            if (this.m_isSymbolEditor) {
              const cfg = this.m_frame!.libeditconfig();

              if (cfg) this.m_arcEditMode.value = cfg.editing.arc_edit_mode;
            } else {
              const cfg = this.m_frame!.eeconfig();

              if (cfg) this.m_arcEditMode.value = cfg.drawing.arc_edit_mode;
            }

            this.m_editBehavior = new EDA_ARC_POINT_EDIT_BEHAVIOR(
              asEdaShape(shape),
              this.m_arcEditMode,
              this.controls(),
              schIUScale,
            );
            break;

          case SHAPE_T.CIRCLE:
            this.m_editBehavior = new EDA_CIRCLE_POINT_EDIT_BEHAVIOR(asEdaShape(shape));
            break;

          case SHAPE_T.RECTANGLE:
            this.m_editBehavior = new RECTANGLE_POINT_EDIT_BEHAVIOR(shape, this.m_frame!);
            break;

          case SHAPE_T.POLY:
            this.m_editBehavior = new EDA_POLYGON_POINT_EDIT_BEHAVIOR(asEdaShape(shape));
            break;

          case SHAPE_T.BEZIER: {
            let maxError = schIUScale.mmToIU(ARC_LOW_DEF_MM);
            const schematic = shape.Schematic();

            if (schematic) maxError = schematic.Settings().m_MaxError;

            this.m_editBehavior = new EDA_BEZIER_POINT_EDIT_BEHAVIOR(asEdaShape(shape), maxError);
            break;
          }

          default:
            throw new Error(`SCH_POINT_EDITOR: unimplemented for ${shape.SHAPE_T_asString()}`);
        }

        break;
      }

      case KICAD_T.SCH_RULE_AREA_T: {
        // Implemented directly as a polygon
        this.m_editBehavior = new EDA_POLYGON_POINT_EDIT_BEHAVIOR(asEdaShape(aItem as SCH_SHAPE));
        break;
      }

      case KICAD_T.SCH_TEXTBOX_T:
        this.m_editBehavior = new TEXTBOX_POINT_EDIT_BEHAVIOR(aItem as SCH_TEXTBOX);
        break;

      case KICAD_T.SCH_TABLECELL_T:
        this.m_editBehavior = new SCH_TABLECELL_POINT_EDIT_BEHAVIOR(
          aItem as SCH_TABLECELL,
          this.m_frame!.GetScreen()!,
        );
        break;

      case KICAD_T.SCH_SHEET_T:
        this.m_editBehavior = new SHEET_POINT_EDIT_BEHAVIOR(
          aItem as SCH_SHEET,
          this.m_frame!.GetScreen()!,
        );
        break;

      case KICAD_T.SCH_BITMAP_T:
        this.m_editBehavior = new BITMAP_POINT_EDIT_BEHAVIOR(aItem as SCH_BITMAP);
        break;

      case KICAD_T.SCH_LINE_T:
        this.m_editBehavior = new LINE_POINT_EDIT_BEHAVIOR(
          aItem as SCH_LINE,
          this.m_frame!.GetScreen()!,
        );
        break;

      default:
        this.m_editPoints = null;
        break;
    }

    // If we got a behavior, generate the points
    if (this.m_editBehavior) {
      if (!this.m_editPoints) return; // wxCHECK

      this.m_editBehavior.MakePoints(this.m_editPoints);
    }
  }

  override Reset(aReason: RESET_REASON): void {
    super.Reset(aReason);

    const view = this.getView();

    if (view) {
      if (this.m_angleItem) view.Remove(this.m_angleItem);

      if (this.m_editPoints) view.Remove(this.m_editPoints);
    }

    this.m_angleItem = null;
    this.m_editPoints = null;
    this.m_editedPoint = null;

    // A reset can tear down the Main() loop mid-drag, so clear the drag flag here too.
    this.m_inDrag = false;
  }

  override Init(): boolean {
    const S_C = SELECTION_CONDITIONS;

    super.Init();

    const addCornerCondition = (aSelection: SELECTION): boolean =>
      this.addCornerCondition(aSelection);

    const removeCornerCondition = (aSelection: SELECTION): boolean =>
      this.removeCornerCondition(aSelection);

    const arcIsEdited = (aSelection: SELECTION): boolean => {
      const item = aSelection.Front();
      return (
        item !== null &&
        item.Type() === KICAD_T.SCH_SHAPE_T &&
        (item as SCH_SHAPE).GetShape() === SHAPE_T.ARC
      );
    };

    const menu = this.m_selectionTool!.GetToolMenu().GetMenu();

    // clang-format off
    menu.AddItem(SCH_ACTIONS.pointEditorAddCorner, S_C.And(S_C.Count(1), addCornerCondition));
    menu.AddItem(SCH_ACTIONS.pointEditorRemoveCorner, S_C.And(S_C.Count(1), removeCornerCondition));
    menu.AddItem(ACTIONS.cycleArcEditMode, S_C.And(S_C.Count(1), arcIsEdited));
    // clang-format on

    return true;
  }

  private clearEditedPoints(_aEvent: TOOL_EVENT): number {
    this.setEditedPoint(null);

    return 0;
  }

  private updateEditedPoint(aEvent: TOOL_EVENT): void {
    let point = this.m_editedPoint;

    if (!this.m_editPoints) {
      point = null;
    } else if (aEvent.IsMotion()) {
      point = this.m_editPoints.FindPoint(aEvent.Position(), this.getView()!);
    } else if (aEvent.IsDrag(BUT_LEFT)) {
      point = this.m_editPoints.FindPoint(aEvent.DragOrigin(), this.getView()!);
    } else {
      point = this.m_editPoints.FindPoint(
        this.controls().GetCursorPosition(false),
        this.getView()!,
      );
    }

    if (this.m_editedPoint !== point) this.setEditedPoint(point);
  }

  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_selectionTool) return 0;

    if (this.m_inPointEditor) return 0;

    // REENTRANCY_GUARD guard( &m_inPointEditor )
    this.m_inPointEditor = true;

    try {
      if (this.m_isSymbolEditor) {
        const editor = this.getEditFrame<SYMBOL_EDIT_FRAME>();

        if (!editor.IsSymbolEditable() || editor.IsSymbolAlias()) return 0;
      }

      const selection = this.m_selectionTool.GetSelection();

      if (selection.Size() !== 1 || !selection.Front()!.IsType(pointEditorTypes)) return 0;

      // Wait till drawing tool is done
      if (selection.Front()!.IsNew()) return 0;

      this.Activate();

      const controls = this.controls();
      let grid: EE_GRID_HELPER | null = new EE_GRID_HELPER(this.m_toolMgr);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };
      const view = this.getView()!;
      const item = selection.Front()!;
      const commit = new SCH_COMMIT(this.m_toolMgr!);

      controls.ShowCursor(true);

      this.makePointsAndBehavior(item);
      this.m_angleItem = new ANGLE_ITEM(this.m_editPoints);
      view.Add(this.m_editPoints!);
      view.Add(this.m_angleItem);
      this.setEditedPoint(null);
      this.updateEditedPoint(aEvent);
      let inDrag = false;

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        if (grid) {
          grid.SetSnap(!evt.Modifier(MD_SHIFT));
          grid.SetUseGrid(
            this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping(),
          );
        } else {
          // This check is based on the assumption that the grid object must be valid.
          // If this assumption is wrong, please fix the code above.
          return 0; // wxCHECK( false, 0 )
        }

        if (!this.m_editPoints || evt.IsSelectionEvent()) break;

        if (!inDrag) this.updateEditedPoint(evt);

        if (evt.IsDrag(BUT_LEFT) && this.m_editedPoint) {
          if (!inDrag) {
            commit.Modify(this.m_editPoints.GetParent()!, this.m_frame!.GetScreen());

            if (item instanceof SCH_SHAPE) {
              item.SetFlags(IS_MOVING);
              item.SetHatchingDirty();
              item.UpdateHatching();
            }

            inDrag = true;
          }

          const snap = !evt.DisableGridSnapping();

          cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
          controls.ForceCursorPosition(true, cursorPos);

          this.m_editedPoint.SetPosition(controls.GetCursorPosition(snap));

          this.updateParentItem(snap, commit);
          this.updatePoints();
        } else if (inDrag && evt.IsMouseUp(BUT_LEFT)) {
          if (!commit.Empty()) commit.Push('Move Point');

          controls.SetAutoPan(false);

          if (item instanceof SCH_SHAPE) {
            item.ClearFlags(IS_MOVING);
            item.SetHatchingDirty();
            item.UpdateHatching();
          }

          inDrag = false;
        } else if (evt.IsCancelInteractive() || evt.IsActivate()) {
          if (inDrag) {
            // Restore the last change
            // Currently we are manually managing the lifetime of the grid
            // helpers because there is a bug in the tool stack that adds
            // the point editor again when commit.Revert() rebuilds the selection.
            // We remove this grid here so the its destructor is called before it
            // is added again.
            grid = null;

            commit.Revert();
            inDrag = false;
            break;
          } else if (evt.IsCancelInteractive()) {
            break;
          }

          if (evt.IsActivate()) break;
        } else {
          evt.SetPassEvent();
        }

        // Mirror the drag state so IsDragging() lets the frame defer the autosave snapshot,
        // which would otherwise serialize the whole schematic over a live point edit.
        this.m_inDrag = inDrag;

        controls.SetAutoPan(inDrag);
        controls.CaptureCursor(inDrag);
      }

      this.m_inDrag = false;

      if (item instanceof SCH_SHAPE) {
        item.ClearFlags(IS_MOVING);
        item.SetHatchingDirty();
        item.UpdateHatching();
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.setEditedPoint(null);

      if (this.m_editPoints) {
        view.Remove(this.m_editPoints);
        view.Remove(this.m_angleItem!);

        this.m_editPoints = null;
        this.m_angleItem = null;
        this.m_frame!.GetCanvas()?.Refresh();
      }

      return 0;
    } finally {
      this.m_inPointEditor = false;
    }
  }

  private updateParentItem(_aSnapToGrid: boolean, aCommit: SCH_COMMIT): void {
    const item = this.m_editPoints!.GetParent();

    if (!item) return;

    if (!this.m_editBehavior) return;

    const updatedItems: EDA_ITEM[] = [];
    this.m_editBehavior.UpdateItem(this.m_editedPoint!, this.m_editPoints!, aCommit, updatedItems);

    for (const updatedItem of updatedItems) this.updateItem(updatedItem, true);

    this.m_frame!.SetMsgPanel(item);
  }

  private updatePoints(): void {
    if (!this.m_editPoints || !this.m_editBehavior) return;

    // Careful; the unit and/or body style may have changed out from under us, meaning the item is
    // no longer present on the canvas.
    if (this.m_isSymbolEditor) {
      const editor = this.m_frame as unknown as SYMBOL_EDIT_FRAME;
      const parent = this.m_editPoints.GetParent();
      const item = parent?.IsSCH_ITEM() ? (parent as unknown as SCH_SHAPE) : null;

      if (
        (item && item.GetUnit() !== 0 && item.GetUnit() !== editor.GetUnit()) ||
        (item && item.GetBodyStyle() !== 0 && item.GetBodyStyle() !== editor.GetBodyStyle())
      ) {
        this.getView()!.Remove(this.m_editPoints);
        this.getView()!.Remove(this.m_angleItem!);
        this.m_editPoints = null;
        this.m_angleItem = null;
        return;
      }
    }

    this.m_editBehavior.UpdatePoints(this.m_editPoints);
    this.getView()!.Update(this.m_editPoints);
    this.getView()!.Update(this.m_angleItem!);
  }

  private setEditedPoint(aPoint: EDIT_POINT | null): void {
    const controls = this.controls();

    if (aPoint) {
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      controls.ForceCursorPosition(true, aPoint.GetPosition());
      controls.ShowCursor(true);
    } else {
      if (this.m_frame!.ToolStackIsEmpty()) controls.ShowCursor(false);

      controls.ForceCursorPosition(false);
    }

    this.m_editedPoint = aPoint;
  }

  /** `getEditedPointIndex` (sch_point_editor.h:97): the edited point's index, or -1. */
  private getEditedPointIndex(): number {
    for (let i = 0; i < this.m_editPoints!.PointsSize(); ++i) {
      if (this.m_editedPoint === this.m_editPoints!.Point(i)) return i;
    }

    return -1; // wxNOT_FOUND
  }

  private removeCornerCondition(_aSelection: SELECTION): boolean {
    if (
      !this.m_editPoints ||
      !this.m_editedPoint ||
      !this.m_editPoints.GetParent()!.IsType([KICAD_T.SCH_SHAPE_T, KICAD_T.SCH_RULE_AREA_T])
    )
      return false;

    const shape = this.m_editPoints.GetParent() as SCH_SHAPE;

    if (shape.GetPolyShape().IsEmpty()) return false;

    const poly = shape.GetPolyShape().Outline(0);

    if (this.m_editPoints.GetParent()!.Type() === KICAD_T.SCH_SHAPE_T && poly.GetPointCount() <= 2)
      return false;
    if (
      this.m_editPoints.GetParent()!.Type() === KICAD_T.SCH_RULE_AREA_T &&
      poly.GetPointCount() <= 3
    )
      return false;

    for (const pt of poly.CPoints()) {
      if (same(pt, this.m_editedPoint.GetPosition())) return true;
    }

    return false;
  }

  private addCornerCondition(_aSelection: SELECTION): boolean {
    if (
      !this.m_editPoints ||
      !this.m_editPoints.GetParent()!.IsType([KICAD_T.SCH_SHAPE_T, KICAD_T.SCH_RULE_AREA_T])
    )
      return false;

    const shape = this.m_editPoints.GetParent() as SCH_SHAPE;

    if (shape.GetShape() !== SHAPE_T.POLY) return false;

    const cursorPos = this.controls().GetCursorPosition(false);
    const threshold = this.getView()!.ToWorld(EDIT_POINT.POINT_SIZE);

    return shape.HitTest(cursorPos, Math.trunc(threshold));
  }

  private addCorner(aEvent: TOOL_EVENT): number {
    if (
      !this.m_editPoints ||
      !this.m_editPoints.GetParent()!.IsType([KICAD_T.SCH_SHAPE_T, KICAD_T.SCH_RULE_AREA_T])
    )
      return 0;

    const shape = this.m_editPoints.GetParent() as SCH_SHAPE;
    const poly = shape.GetPolyShape().Outline(0);
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    commit.Modify(shape, this.m_frame!.GetScreen());

    const cursor = this.controls().GetCursorPosition(!aEvent.DisableGridSnapping());
    let currentMinDistance = INT_MAX;
    let closestLineStart = 0;
    let numPoints = poly.GetPointCount();

    if (!shape.IsClosed()) numPoints -= 1;

    for (let i = 0; i < numPoints; ++i) {
      const seg = poly.GetSegment(i);
      const distance = seg.Distance(cursor);

      if (distance < currentMinDistance) {
        currentMinDistance = distance;
        closestLineStart = i;
      }
    }

    poly.Insert(closestLineStart + 1, cursor);

    this.updateItem(shape, true);
    this.updatePoints();

    commit.Push('Add Corner');
    return 0;
  }

  private removeCorner(_aEvent: TOOL_EVENT): number {
    if (
      !this.m_editPoints ||
      !this.m_editedPoint ||
      !this.m_editPoints.GetParent()!.IsType([KICAD_T.SCH_SHAPE_T, KICAD_T.SCH_RULE_AREA_T])
    )
      return 0;

    const shape = this.m_editPoints.GetParent() as SCH_SHAPE;
    const poly = shape.GetPolyShape().Outline(0);
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    if (this.m_editPoints.GetParent()!.Type() === KICAD_T.SCH_SHAPE_T && poly.GetPointCount() <= 2)
      return 0;
    if (
      this.m_editPoints.GetParent()!.Type() === KICAD_T.SCH_RULE_AREA_T &&
      poly.GetPointCount() <= 3
    )
      return 0;

    commit.Modify(shape, this.m_frame!.GetScreen());

    const idx = this.getEditedPointIndex();
    const last = poly.GetPointCount() - 1;

    if (idx === 0 && same(poly.GetPoint(0), poly.GetPoint(last))) {
      poly.Remove(idx);
      poly.SetPoint(last - 1, poly.GetPoint(0));
    } else {
      poly.Remove(idx);
    }

    shape.SetHatchingDirty();

    this.setEditedPoint(null);

    this.updateItem(shape, true);
    this.updatePoints();

    commit.Push('Remove Corner');
    return 0;
  }

  private changeArcEditMode(aEvent: TOOL_EVENT): number {
    // The Symbol Editor uses SYMBOL_EDITOR_SETTINGS, not EESCHEMA_SETTINGS, so eeconfig()
    // returns nullptr there. Dispatch on frame type to read/write the right settings store.
    const schCfg = this.m_isSymbolEditor ? null : this.m_frame!.eeconfig();
    const symCfg = this.m_isSymbolEditor ? this.m_frame!.libeditconfig() : null;

    if (aEvent.Matches(ACTIONS.cycleArcEditMode.MakeEvent())) {
      if (schCfg) this.m_arcEditMode.value = schCfg.drawing.arc_edit_mode;
      else if (symCfg) this.m_arcEditMode.value = symCfg.editing.arc_edit_mode;

      this.m_arcEditMode.value = IncrementArcEditMode(this.m_arcEditMode.value);
    } else {
      this.m_arcEditMode.value = aEvent.Parameter<ARC_EDIT_MODE>();
    }

    const mode = this.m_arcEditMode.value as 0 | 1 | 2;

    if (schCfg) updateEeschemaSettings((s) => (s.drawing.arc_edit_mode = mode));
    else if (symCfg) updateSymbolEditorSettings((s) => (s.editing.arc_edit_mode = mode));

    return 0;
  }

  private modifiedSelection(_aEvent: TOOL_EVENT): number {
    this.updatePoints();
    return 0;
  }

  protected override setTransitions(): void {
    this.Go(this.Main, EVENTS.PointSelectedEvent);
    this.Go(this.Main, EVENTS.SelectedEvent);
    this.Go(this.Main, ACTIONS.activatePointEditor.MakeEvent());
    this.Go(SYNC_HANDLER(this.addCorner), SCH_ACTIONS.pointEditorAddCorner.MakeEvent());
    this.Go(SYNC_HANDLER(this.removeCorner), SCH_ACTIONS.pointEditorRemoveCorner.MakeEvent());
    this.Go(SYNC_HANDLER(this.changeArcEditMode), ACTIONS.pointEditorArcKeepCenter.MakeEvent());
    this.Go(SYNC_HANDLER(this.changeArcEditMode), ACTIONS.pointEditorArcKeepEndpoint.MakeEvent());
    this.Go(SYNC_HANDLER(this.changeArcEditMode), ACTIONS.pointEditorArcKeepRadius.MakeEvent());
    this.Go(SYNC_HANDLER(this.changeArcEditMode), ACTIONS.cycleArcEditMode.MakeEvent());
    this.Go(SYNC_HANDLER(this.modifiedSelection), EVENTS.SelectedItemsModified);
    this.Go(SYNC_HANDLER(this.clearEditedPoints), EVENTS.ClearedEvent);
  }
}
