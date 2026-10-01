// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_line.cpp` / `.h`: a `line`, which becomes a track
 * on copper outside a footprint and a segment otherwise.
 *
 * A footprint's line is added to the BOARD, not the footprint, and moved to
 * the footprint's place: upstream does exactly that.
 */

import { IsCopperLayer } from '@ziroeda/common/layer_id.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import type { FOOTPRINT } from '../../footprint.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TRACK } from '../../pcb_track.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import {
  FindNode,
  GetName,
  SetPosition,
  SetWidth,
  TrimLeft,
  TrimRight,
} from './pcad2kicad_common.js';

export class PCAD_LINE extends PCAD_PCB_COMPONENT {
  m_Width = 0;
  m_ToX = 0;
  m_ToY = 0;

  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'L';
  }

  Parse(aNode: XNODE, aLayer: number, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;

    this.m_PCadLayer = aLayer;
    this.m_KiCadLayer = this.GetKiCadLayer();
    this.m_PositionX = 0;
    this.m_PositionY = 0;
    this.m_ToX = 0;
    this.m_ToY = 0;
    this.m_Width = 0;
    lNode = FindNode(aNode, 'pt');

    if (lNode)
      [this.m_PositionX, this.m_PositionY] = SetPosition(
        lNode.GetNodeContent(),
        aDefaultUnits,
        aActualConversion,
      );

    if (lNode) lNode = lNode.GetNext();

    if (lNode)
      [this.m_ToX, this.m_ToY] = SetPosition(
        lNode.GetNodeContent(),
        aDefaultUnits,
        aActualConversion,
      );

    lNode = FindNode(aNode, 'width');

    if (lNode) this.m_Width = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

    lNode = FindNode(aNode, 'netNameRef');

    if (lNode) {
      this.m_Net = TrimRight(TrimLeft(GetName(lNode, '')));
      this.m_NetCode = this.GetNetCode(this.m_Net);
    }
  }

  override SetPosOffset(aX_offs: number, aY_offs: number): void {
    super.SetPosOffset(aX_offs, aY_offs);

    this.m_ToX += aX_offs;
    this.m_ToY += aY_offs;
  }

  override Flip(): void {
    super.Flip();

    this.m_ToX = -this.m_ToX;
    this.m_KiCadLayer = this.m_board.FlipLayer(this.m_KiCadLayer);
  }

  AddToBoard(aFootprint: FOOTPRINT | null = null): void {
    if (IsCopperLayer(this.m_KiCadLayer) && !aFootprint) {
      const track = new PCB_TRACK(this.m_board);
      this.m_board.Add(track);

      track.SetPosition({ x: this.m_PositionX, y: this.m_PositionY });
      track.SetEnd({ x: this.m_ToX, y: this.m_ToY });

      track.SetWidth(this.m_Width);

      track.SetLayer(this.m_KiCadLayer);
      track.SetNetCode(this.m_NetCode);
    } else {
      const segment = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);
      this.m_board.Add(segment, ADD_MODE.APPEND);

      segment.SetLayer(this.m_KiCadLayer);
      segment.SetStart({ x: this.m_PositionX, y: this.m_PositionY });
      segment.SetEnd({ x: this.m_ToX, y: this.m_ToY });
      segment.SetStroke(new STROKE_PARAMS(this.m_Width, LINE_STYLE.SOLID));

      if (aFootprint) {
        segment.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
        segment.Move(aFootprint.GetPosition());
      }
    }
  }
}
