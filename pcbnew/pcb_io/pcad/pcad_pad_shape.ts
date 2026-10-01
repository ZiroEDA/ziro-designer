// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_pad_shape.cpp` / `.h`: one layer's `padShape` of
 * a pad style.
 */

import type { XNODE } from '@ziroeda/common/xnode.js';
import type { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import { FindNode, NodeToLong, SetPosition, SetWidth, TrimLeft } from './pcad2kicad_common.js';

export class PCAD_PAD_SHAPE extends PCAD_PCB_COMPONENT {
  m_Shape = '';
  m_Width = 0;
  m_Height = 0;

  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
  }

  Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;

    lNode = FindNode(aNode, 'padShapeType');

    if (lNode) this.m_Shape = TrimLeft(lNode.GetNodeContent());

    // TODO - many kind of shapes not implemented yet
    lNode = FindNode(aNode, 'layerNumRef');

    if (lNode) this.m_PCadLayer = NodeToLong(lNode.GetNodeContent());

    this.m_KiCadLayer = this.GetKiCadLayer();

    if (
      this.m_Shape === 'Oval' ||
      this.m_Shape === 'Rect' ||
      this.m_Shape === 'Ellipse' ||
      this.m_Shape === 'MtHole' ||
      this.m_Shape === 'RndRect'
    ) {
      lNode = FindNode(aNode, 'shapeWidth');

      if (lNode) this.m_Width = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

      lNode = FindNode(aNode, 'shapeHeight');

      if (lNode) this.m_Height = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);
    } else if (this.m_Shape === 'Polygon') {
      // aproximation to simplier shape
      lNode = FindNode(aNode, 'shapeOutline');

      if (lNode) lNode = FindNode(lNode, 'pt');

      let minX = 0;
      let maxX = 0;
      let minY = 0;
      let maxY = 0;

      while (lNode) {
        const [x, y] = SetPosition(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

        if (minX > x) minX = x;

        if (maxX < x) maxX = x;

        if (minY > y) minY = y;

        if (maxY < y) maxY = y;

        lNode = lNode.GetNext();
      }

      this.m_Width = maxX - minX;
      this.m_Height = maxY - minY;
    }
  }

  AddToBoard(_aFootprint: FOOTPRINT | null = null): void {}
}
