// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_copper_pour.cpp` / `.h`: a `copperPour95`.
 * Its pour spacing and thermal width are read and, as upstream, unused.
 */

import type { XNODE } from '@ziroeda/common/xnode.js';
import { toInt } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../../board.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_POLYGON } from './pcad_polygon.js';
import { FindNode, GetName, SetWidth, TrimLeft, TrimRight } from './pcad2kicad_common.js';

export class PCAD_COPPER_POUR extends PCAD_POLYGON {
  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD, aPCadLayer: number) {
    super(aCallbacks, aBoard, aPCadLayer);
    this.m_filled = false;
  }

  override Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): boolean {
    let lNode = FindNode(aNode, 'netNameRef');

    if (lNode) {
      this.m_Net = TrimRight(TrimLeft(GetName(lNode, '')));
      this.m_NetCode = this.GetNetCode(this.m_Net);
    }

    const width = FindNode(aNode, 'width');

    if (width) this.m_Width = SetWidth(width.GetNodeContent(), aDefaultUnits, aActualConversion);

    if (FindNode(aNode, 'island')) this.m_filled = true;

    lNode = FindNode(aNode, 'pcbPoly');

    if (!lNode) lNode = FindNode(aNode, 'pourOutline');

    if (!lNode) return false;

    this.FormPolygon(lNode, this.m_Outline, aDefaultUnits, aActualConversion);

    if (this.m_Outline.length <= 0) return false;

    this.m_PositionX = toInt(this.m_Outline[0]!.x);
    this.m_PositionY = toInt(this.m_Outline[0]!.y);

    return true;
  }
}
