// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_pad.cpp` / `.h`: a `pad` and its `padStyleDef`.
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { ANGLE_0, EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import { PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PAD_SHAPE } from './pcad_pad_shape.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import {
  FindNode,
  FindNodeGetContent,
  GetName,
  IsSameAsNoCase,
  NodeToLong,
  SetPosition,
  SetWidth,
  StrToInt1Units,
  TrimLeft,
  TrimRight,
} from './pcad2kicad_common.js';

export class PCAD_PAD extends PCAD_PCB_COMPONENT {
  m_Number = 0;
  m_Hole = 0;
  m_IsHolePlated = true;
  readonly m_Shapes: PCAD_PAD_SHAPE[] = [];

  private m_defaultPinDes = '';

  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'P';
  }

  Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;
    let propValue = '';

    this.m_Rotation = ANGLE_0;
    lNode = FindNode(aNode, 'padNum');

    if (lNode) this.m_Number = NodeToLong(lNode.GetNodeContent());

    lNode = FindNode(aNode, 'padStyleRef');

    if (lNode) {
      propValue = TrimLeft(GetName(lNode, propValue));
      this.m_Name.text = propValue;
    }

    lNode = FindNode(aNode, 'pt');

    if (lNode)
      [this.m_PositionX, this.m_PositionY] = SetPosition(
        lNode.GetNodeContent(),
        aDefaultUnits,
        aActualConversion,
      );

    lNode = FindNode(aNode, 'rotation');

    if (lNode) {
      const str = TrimLeft(lNode.GetNodeContent());
      this.m_Rotation = new EDA_ANGLE(StrToInt1Units(str), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
    }

    lNode = FindNode(aNode, 'netNameRef');

    if (lNode) {
      propValue = TrimRight(TrimLeft(GetName(lNode, propValue)));
      this.m_Net = propValue;
      this.m_NetCode = this.GetNetCode(this.m_Net);
    }

    lNode = FindNode(aNode, 'defaultPinDes');

    if (lNode) {
      propValue = GetName(lNode, propValue);
      this.m_defaultPinDes = propValue;
    }

    lNode = aNode;

    while (lNode && lNode.GetName() !== 'www.lura.sk') lNode = lNode.GetParent();

    lNode = lNode ? FindNode(lNode, 'library') : null;

    if (!lNode) throw new IO_ERROR('Unable to find library section');

    lNode = FindNode(lNode, 'padStyleDef');

    while (lNode) {
      propValue = GetName(lNode, propValue);

      if (IsSameAsNoCase(propValue, this.m_Name.text)) break;

      lNode = lNode.GetNext();
    }

    if (!lNode) throw new IO_ERROR(`Unable to find padStyleDef ${this.m_Name.text}`);

    let cNode = FindNode(lNode, 'holeDiam');

    if (cNode) this.m_Hole = SetWidth(cNode.GetNodeContent(), aDefaultUnits, aActualConversion);

    if (IsSameAsNoCase(FindNodeGetContent(lNode, 'isHolePlated'), 'False'))
      this.m_IsHolePlated = false;

    cNode = FindNode(lNode, 'padShape');

    while (cNode) {
      if (IsSameAsNoCase(cNode.GetName(), 'padShape')) {
        // we support only Pads on specific layers......
        // we do not support pads on "Plane", "NonSignal" , "Signal" ... layerr
        if (FindNode(cNode, 'layerNumRef')) {
          const padShape = new PCAD_PAD_SHAPE(this.m_callbacks, this.m_board);
          padShape.Parse(cNode, aDefaultUnits, aActualConversion);
          this.m_Shapes.push(padShape);
        }
      }

      cNode = cNode.GetNext();
    }
  }

  override Flip(): void {
    super.Flip();

    if (this.m_ObjType === 'P') this.m_Rotation = this.m_Rotation.negate();

    for (const shape of this.m_Shapes)
      shape.m_KiCadLayer = this.m_board.FlipLayer(shape.m_KiCadLayer);
  }

  AddToFootprint(aFootprint: FOOTPRINT, aRotation: EDA_ANGLE, aEncapsulatedPad: boolean): void {
    let padShapeName = 'Ellipse';
    let padType: PAD_ATTRIB;
    let width = 0;
    let height = 0;
    const ALL = PADSTACK.ALL_LAYERS;

    const pad = new PAD(aFootprint);

    if (!this.m_IsHolePlated && this.m_Hole) {
      // mechanical hole
      pad.SetShape(ALL, PAD_SHAPE.CIRCLE);
      pad.SetAttribute(PAD_ATTRIB.NPTH);

      pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
      pad.SetDrillSize({ x: this.m_Hole, y: this.m_Hole });
      pad.SetSize(ALL, { x: this.m_Hole, y: this.m_Hole });

      // Mounting Hole: Solder Mask Margin from Top Layer Width size.
      // Used the default zone clearance (simplify)
      if (this.m_Shapes.length && IsSameAsNoCase(this.m_Shapes[0]!.m_Shape, 'MtHole')) {
        const sm_margin = Math.trunc((this.m_Shapes[0]!.m_Width - this.m_Hole) / 2);
        pad.SetLocalSolderMaskMargin(sm_margin);
        // int + double into std::optional<int>: truncated
        pad.SetLocalClearance(Math.trunc(sm_margin + pcbIUScale.mmToIU(0.254)));
      }

      pad.SetLayerSet(LSET.AllCuMask().or(new LSET([PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.F_Mask])));
    } else {
      padType = this.m_Hole ? PAD_ATTRIB.PTH : PAD_ATTRIB.SMD;

      // form layer mask
      for (const padShape of this.m_Shapes) {
        if (padShape.m_Width > 0 && padShape.m_Height > 0) {
          if (
            padShape.m_KiCadLayer === PCB_LAYER_ID.F_Cu ||
            padShape.m_KiCadLayer === PCB_LAYER_ID.B_Cu
          ) {
            padShapeName = padShape.m_Shape;
            width = padShape.m_Width;
            height = padShape.m_Height;

            // assume this is SMD pad
            if (padShape.m_KiCadLayer === PCB_LAYER_ID.F_Cu)
              pad.SetLayerSet(
                new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.F_Mask]),
              );
            else
              pad.SetLayerSet(
                new LSET([PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Paste, PCB_LAYER_ID.B_Mask]),
              );

            break;
          }
        }
      }

      if (width === 0 || height === 0) return; // `delete pad`

      if (padType === PAD_ATTRIB.PTH) {
        // actually this is a thru-hole pad
        pad.SetLayerSet(LSET.AllCuMask().or(new LSET([PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.F_Mask])));
      }

      pad.SetNumber(this.m_Name.text);

      if (
        IsSameAsNoCase(padShapeName, 'Oval') ||
        IsSameAsNoCase(padShapeName, 'Ellipse') ||
        IsSameAsNoCase(padShapeName, 'MtHole')
      ) {
        if (width !== height) pad.SetShape(ALL, PAD_SHAPE.OVAL);
        else pad.SetShape(ALL, PAD_SHAPE.CIRCLE);
      } else if (IsSameAsNoCase(padShapeName, 'Rect')) {
        pad.SetShape(ALL, PAD_SHAPE.RECTANGLE);
      } else if (IsSameAsNoCase(padShapeName, 'RndRect')) {
        pad.SetShape(ALL, PAD_SHAPE.ROUNDRECT);
      } else if (IsSameAsNoCase(padShapeName, 'Polygon')) {
        pad.SetShape(ALL, PAD_SHAPE.RECTANGLE); // approximation
      }

      pad.SetSize(ALL, { x: width, y: height });
      pad.SetDelta(ALL, { x: 0, y: 0 });
      pad.SetOrientation(this.m_Rotation.add(aRotation));

      pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
      pad.SetOffset(ALL, { x: 0, y: 0 });
      pad.SetDrillSize({ x: this.m_Hole, y: this.m_Hole });

      pad.SetAttribute(padType);

      // Set the proper net code
      let netinfo = this.m_board.FindNet(this.m_Net);

      if (netinfo === null) {
        // I believe this should not happen, but just in case
        netinfo = new NETINFO_ITEM(this.m_board, this.m_Net);
        this.m_board.Add(netinfo);
      }

      pad.SetNetCode(netinfo.GetNetCode());
    }

    if (!aEncapsulatedPad) {
      // pad's "Position" is not relative to the footprint's, whereas Pos0 is relative to
      // the footprint's but is the unrotated coordinate.
      const padpos = RotatePoint(
        { x: this.m_PositionX, y: this.m_PositionY },
        aFootprint.GetOrientation(),
      );
      const fpPos = aFootprint.GetPosition();
      pad.SetPosition({ x: padpos.x + fpPos.x, y: padpos.y + fpPos.y });
    }

    aFootprint.Add(pad);
  }

  AddToBoard(aFootprint: FOOTPRINT | null = null): void {
    let width = 0;
    let height = 0;

    if (this.m_ObjType === 'V') {
      // pad of via
      for (const padShape of this.m_Shapes) {
        if (padShape.m_Width > 0 && padShape.m_Height > 0) {
          if (
            padShape.m_KiCadLayer === PCB_LAYER_ID.F_Cu ||
            padShape.m_KiCadLayer === PCB_LAYER_ID.B_Cu
          ) {
            width = padShape.m_Width;
            height = padShape.m_Height;

            break;
          }
        }
      }

      if (width === 0 || height === 0) return;

      if (IsCopperLayer(this.m_KiCadLayer)) {
        const via = new PCB_VIA(this.m_board);
        this.m_board.Add(via);

        via.SetPosition({ x: this.m_PositionX, y: this.m_PositionY });
        via.SetEnd({ x: this.m_PositionX, y: this.m_PositionY });

        via.SetWidth(PADSTACK.ALL_LAYERS, height);
        via.SetViaType(VIATYPE.THROUGH);
        via.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
        via.SetDrill(this.m_Hole);

        via.SetLayer(this.m_KiCadLayer);
        via.SetNetCode(this.m_NetCode);
      }
    } else {
      // pad
      if (!aFootprint) {
        aFootprint = new FOOTPRINT(this.m_board);
        this.m_board.Add(aFootprint, ADD_MODE.APPEND);
        aFootprint.SetPosition({ x: this.m_PositionX, y: this.m_PositionY });
      }

      this.m_Name.text = this.m_defaultPinDes;

      this.AddToFootprint(aFootprint, ANGLE_0, true);
    }
  }
}
