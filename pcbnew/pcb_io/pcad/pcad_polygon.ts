// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_polygon.cpp` / `.h`: a `pcbPoly`, and the base of
 * the copper pour, cutout, keepout and plane: a zone on the board, a filled
 * polygon in a footprint.
 */

import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { KiROUND, toInt } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import type { FOOTPRINT } from '../../footprint.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { ZONE } from '../../zone.js';
import { ZONE_BORDER_DISPLAY_STYLE } from '../../zone_settings.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import type { ISLANDS_ARRAY, VERTICES_ARRAY } from './pcad_item_types.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import {
  FindNode,
  GetName,
  SetDoublePrecisionPosition,
  TrimLeft,
  TrimRight,
} from './pcad2kicad_common.js';

export class PCAD_POLYGON extends PCAD_PCB_COMPONENT {
  m_Width = 0;
  m_Priority = 100000;
  m_Outline: VERTICES_ARRAY = []; // collection of boundary/outline lines - objects
  m_Islands: ISLANDS_ARRAY = [];
  m_Cutouts: ISLANDS_ARRAY = [];

  protected m_filled = true;

  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD, aPCadLayer: number) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'Z';
    this.m_PCadLayer = aPCadLayer;
    this.m_KiCadLayer = this.GetKiCadLayer();
  }

  AssignNet(aNetName: string): void {
    this.m_Net = aNetName;
    this.m_NetCode = this.GetNetCode(this.m_Net);
  }

  SetOutline(aOutline: VERTICES_ARRAY): void {
    this.m_Outline = [];

    for (const p of aOutline) this.m_Outline.push({ x: p.x, y: p.y });

    if (this.m_Outline.length > 0) {
      // int = double: truncated
      this.m_PositionX = toInt(this.m_Outline[0]!.x);
      this.m_PositionY = toInt(this.m_Outline[0]!.y);
    }
  }

  FormPolygon(
    aNode: XNODE,
    aPolygon: VERTICES_ARRAY,
    aDefaultUnits: string,
    aActualConversion: string,
  ): void {
    let lNode = FindNode(aNode, 'pt');

    while (lNode) {
      if (lNode.GetName() === 'pt') {
        const [x, y] = SetDoublePrecisionPosition(
          lNode.GetNodeContent(),
          aDefaultUnits,
          aActualConversion,
        );
        aPolygon.push({ x, y });
      }

      lNode = lNode.GetNext();
    }
  }

  Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): boolean {
    const lNode = FindNode(aNode, 'netNameRef');

    if (lNode) {
      this.m_Net = TrimRight(TrimLeft(GetName(lNode, '')));
      this.m_NetCode = this.GetNetCode(this.m_Net);
    }

    // retrieve polygon outline
    this.FormPolygon(aNode, this.m_Outline, aDefaultUnits, aActualConversion);

    // `m_Outline[0]` of an empty array is out of bounds in the C++
    this.m_PositionX = toInt(this.m_Outline[0]!.x);
    this.m_PositionY = toInt(this.m_Outline[0]!.y);

    // fill the polygon with the same contour as its outline is
    this.m_Islands.push([]);
    this.FormPolygon(aNode, this.m_Islands[0]!, aDefaultUnits, aActualConversion);

    return true;
  }

  AddToBoard(aFootprint: FOOTPRINT | null = null): void {
    if (this.m_Outline.length === 0) return;

    if (aFootprint) {
      const dwg = new PCB_SHAPE(aFootprint, SHAPE_T.POLY);
      aFootprint.Add(dwg);

      dwg.SetStroke(new STROKE_PARAMS(0));
      dwg.SetLayer(this.m_KiCadLayer);

      // VECTOR2I( double, double ): truncated
      const outline: VECTOR2I[] = this.m_Outline.map((p) => ({ x: toInt(p.x), y: toInt(p.y) }));

      dwg.SetPolyPoints(outline);
      dwg.SetStart(outline[0]!);
      dwg.SetEnd(outline[outline.length - 1]!);
      dwg.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
      dwg.Move(aFootprint.GetPosition());
    } else {
      const zone = new ZONE(this.m_board);
      this.m_board.Add(zone, ADD_MODE.APPEND);

      zone.SetLayer(this.m_KiCadLayer);
      zone.SetNetCode(this.m_NetCode);

      // add outline
      for (const p of this.m_Outline) zone.AppendCorner({ x: KiROUND(p.x), y: KiROUND(p.y) }, -1);

      zone.SetLocalClearance(this.m_Width);

      zone.SetAssignedPriority(this.m_Priority);

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );

      if (this.m_ObjType === 'K') {
        zone.SetIsRuleArea(true);
        zone.SetDoNotAllowTracks(true);
        zone.SetDoNotAllowVias(true);
        zone.SetDoNotAllowPads(true);
        zone.SetDoNotAllowZoneFills(true);
        zone.SetDoNotAllowFootprints(false);
      } else if (this.m_ObjType === 'C') {
        // convert cutouts to keepouts because standalone cutouts are not supported in KiCad
        zone.SetIsRuleArea(true);
        zone.SetDoNotAllowZoneFills(true);
        zone.SetDoNotAllowTracks(false);
        zone.SetDoNotAllowVias(false);
        zone.SetDoNotAllowPads(false);
        zone.SetDoNotAllowFootprints(false);
      }

      //if( m_filled )
      //    zone->BuildFilledPolysListData( m_board );
    }
  }

  override Flip(): void {
    super.Flip();

    this.m_KiCadLayer = this.m_board.FlipLayer(this.m_KiCadLayer);
  }

  override SetPosOffset(aX_offs: number, aY_offs: number): void {
    super.SetPosOffset(aX_offs, aY_offs);

    for (const p of this.m_Outline) {
      p.x += aX_offs;
      p.y += aY_offs;
    }

    for (const island of this.m_Islands) {
      for (const p of island) {
        p.x += aX_offs;
        p.y += aY_offs;
      }
    }

    for (const cutout of this.m_Cutouts) {
      for (const p of cutout) {
        p.x += aX_offs;
        p.y += aY_offs;
      }
    }
  }
}
