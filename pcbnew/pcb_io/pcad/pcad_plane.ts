// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_plane.cpp` / `.h`: a `planeObj`, a zone of
 * priority 1.
 */

import type { XNODE } from '@ziroeda/common/xnode.js';
import { toInt } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../../board.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_POLYGON } from './pcad_polygon.js';
import { FindNode, GetName, SetWidth, TrimLeft, TrimRight } from './pcad2kicad_common.js';

export class PCAD_PLANE extends PCAD_POLYGON {
  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD, aPCadLayer: number) {
    super(aCallbacks, aBoard, aPCadLayer);
    this.m_Priority = 1;
  }

  override Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): boolean {
    let lNode = FindNode(aNode, 'netNameRef');

    if (lNode) {
      this.m_Net = TrimRight(TrimLeft(GetName(lNode, '')));
      this.m_NetCode = this.GetNetCode(this.m_Net);
    }

    const width = FindNode(aNode, 'width');

    if (width) this.m_Width = SetWidth(width.GetNodeContent(), aDefaultUnits, aActualConversion);

    lNode = FindNode(aNode, 'pcbPoly');

    if (!lNode) lNode = FindNode(aNode, 'planeOutline');

    if (!lNode) return false;

    this.FormPolygon(lNode, this.m_Outline, aDefaultUnits, aActualConversion);

    // `m_Outline[0]` of an empty outline is out of bounds in the C++
    this.m_PositionX = toInt(this.m_Outline[0]!.x);
    this.m_PositionY = toInt(this.m_Outline[0]!.y);

    return true;
  }
}
