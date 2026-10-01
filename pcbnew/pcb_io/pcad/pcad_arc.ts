// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_arc.cpp` / `.h`: an `arc` or `triplePointArc`.
 */

import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { ANGLE_360, EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import { FindNode, SetPosition, SetWidth, StrToInt1Units } from './pcad2kicad_common.js';

export class PCAD_ARC extends PCAD_PCB_COMPONENT {
  m_StartX = 0;
  m_StartY = 0;
  m_Angle = new EDA_ANGLE(0);
  m_Width = 0;

  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'A';
  }

  Parse(aNode: XNODE, aLayer: number, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;
    let r = 0;
    const end = { x: 0, y: 0 };

    this.m_PCadLayer = aLayer;
    this.m_KiCadLayer = this.GetKiCadLayer();

    const widthNode = FindNode(aNode, 'width');

    if (widthNode)
      this.m_Width = SetWidth(widthNode.GetNodeContent(), aDefaultUnits, aActualConversion);

    if (aNode.GetName() === 'triplePointArc') {
      // center point
      lNode = FindNode(aNode, 'pt');

      if (lNode)
        [this.m_PositionX, this.m_PositionY] = SetPosition(
          lNode.GetNodeContent(),
          aDefaultUnits,
          aActualConversion,
        );

      // start point
      if (lNode) lNode = lNode.GetNext();

      if (lNode)
        [this.m_StartX, this.m_StartY] = SetPosition(
          lNode.GetNodeContent(),
          aDefaultUnits,
          aActualConversion,
        );

      // end point
      if (lNode) lNode = lNode.GetNext();

      if (lNode)
        [end.x, end.y] = SetPosition(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

      const position = { x: this.m_PositionX, y: this.m_PositionY };
      const start = { x: this.m_StartX, y: this.m_StartY };

      if (start.x === end.x && start.y === end.y) {
        this.m_Angle = ANGLE_360.Clone();
      } else {
        const alpha1 = EDA_ANGLE.fromVector({ x: start.x - position.x, y: start.y - position.y });
        const alpha2 = EDA_ANGLE.fromVector({ x: end.x - position.x, y: end.y - position.y });
        this.m_Angle = alpha1.sub(alpha2);
        this.m_Angle.Normalize();
      }
    } else if (aNode.GetName() === 'arc') {
      lNode = FindNode(aNode, 'pt');

      if (lNode)
        [this.m_PositionX, this.m_PositionY] = SetPosition(
          lNode.GetNodeContent(),
          aDefaultUnits,
          aActualConversion,
        );

      lNode = FindNode(aNode, 'radius');

      if (lNode) r = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

      lNode = FindNode(aNode, 'startAngle');
      let a = new EDA_ANGLE(0);

      if (lNode)
        a = new EDA_ANGLE(StrToInt1Units(lNode.GetNodeContent()), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);

      lNode = FindNode(aNode, 'sweepAngle');

      if (lNode)
        this.m_Angle = new EDA_ANGLE(
          StrToInt1Units(lNode.GetNodeContent()),
          EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T,
        );

      this.m_StartX = this.m_PositionX + KiROUND(r * a.Cos());
      this.m_StartY = this.m_PositionY - KiROUND(r * a.Sin());
    }
  }

  override SetPosOffset(aX_offs: number, aY_offs: number): void {
    super.SetPosOffset(aX_offs, aY_offs);

    this.m_StartX += aX_offs;
    this.m_StartY += aY_offs;
  }

  override Flip(): void {
    super.Flip();

    this.m_StartX = -this.m_StartX;
    this.m_Angle = this.m_Angle.negate();
    this.m_KiCadLayer = this.m_board.FlipLayer(this.m_KiCadLayer);
  }

  AddToBoard(aFootprint: FOOTPRINT | null = null): void {
    const arc = new PCB_SHAPE(aFootprint, this.IsCircle() ? SHAPE_T.CIRCLE : SHAPE_T.ARC);

    arc.SetCenter({ x: this.m_PositionX, y: this.m_PositionY });
    arc.SetStart({ x: this.m_StartX, y: this.m_StartY });
    arc.SetArcAngleAndEnd(this.m_Angle.negate(), true);

    arc.SetStroke(new STROKE_PARAMS(this.m_Width, LINE_STYLE.SOLID));
    arc.SetLayer(this.m_KiCadLayer);

    if (aFootprint) {
      aFootprint.Add(arc);
      arc.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
      arc.Move(aFootprint.GetPosition());
    } else {
      this.m_board.Add(arc);
    }
  }

  private IsCircle(): boolean {
    return this.m_Angle.equals(ANGLE_360);
  }
}
