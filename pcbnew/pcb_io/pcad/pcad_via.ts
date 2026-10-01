// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_via.cpp` / `.h`: a `via` and its `viaStyleDef`.
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '../../board.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PAD } from './pcad_pad.js';
import { PCAD_VIA_SHAPE } from './pcad_via_shape.js';
import {
  FindNode,
  GetName,
  IsSameAsNoCase,
  SetPosition,
  SetWidth,
  TrimLeft,
  TrimRight,
} from './pcad2kicad_common.js';

export class PCAD_VIA extends PCAD_PAD {
  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'V';
  }

  override Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;
    let propValue = '';

    this.m_Rotation = ANGLE_0;
    lNode = FindNode(aNode, 'viaStyleRef');

    if (lNode) {
      propValue = TrimRight(TrimLeft(GetName(lNode, propValue)));
      this.m_Name.text = propValue;
    }

    lNode = FindNode(aNode, 'pt');

    if (lNode)
      [this.m_PositionX, this.m_PositionY] = SetPosition(
        lNode.GetNodeContent(),
        aDefaultUnits,
        aActualConversion,
      );

    lNode = FindNode(aNode, 'netNameRef');

    if (lNode) {
      propValue = TrimRight(TrimLeft(GetName(lNode, propValue)));
      this.m_Net = propValue;
      this.m_NetCode = this.GetNetCode(this.m_Net);
    }

    lNode = aNode;

    while (lNode && lNode.GetName() !== 'www.lura.sk') lNode = lNode.GetParent();

    lNode = lNode ? FindNode(lNode, 'library') : null;

    if (!lNode) throw new IO_ERROR('Unable to find library section.');

    lNode = FindNode(lNode, 'viaStyleDef');

    while (lNode) {
      propValue = GetName(lNode, propValue);

      if (IsSameAsNoCase(propValue, this.m_Name.text)) break;

      lNode = lNode.GetNext();
    }

    if (!lNode) throw new IO_ERROR(`Unable to find viaStyleDef ${this.m_Name.text}.`);

    const tNode = lNode;
    lNode = FindNode(tNode, 'holeDiam');

    if (lNode) this.m_Hole = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

    lNode = FindNode(tNode, 'viaShape');

    while (lNode) {
      if (lNode.GetName() === 'viaShape') {
        // we support only Vias on specific layers......
        // we do not support vias on "Plane", "NonSignal" , "Signal" ... layerr
        if (FindNode(lNode, 'layerNumRef')) {
          const viaShape = new PCAD_VIA_SHAPE(this.m_callbacks, this.m_board);
          viaShape.Parse(lNode, aDefaultUnits, aActualConversion);
          this.m_Shapes.push(viaShape);
        }
      }

      lNode = lNode.GetNext();
    }
  }
}
