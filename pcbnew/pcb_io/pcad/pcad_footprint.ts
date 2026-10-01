// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_footprint.cpp` / `.h`: a placed `pattern`, read
 * from its `patternDef` in the library; also the base of PCAD_PCB, whose
 * `layerContents` go through the same `DoLayerContentsObjects`.
 *
 * The `wxStatusBar*` every parser threads through is always null and is not
 * kept.
 */

import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import { FOOTPRINT } from '../../footprint.js';
import { PCAD_ARC } from './pcad_arc.js';
import { type PCAD_CALLBACKS, LAYER_TYPE_T } from './pcad_callbacks.js';
import { PCAD_COPPER_POUR } from './pcad_copper_pour.js';
import { PCAD_CUTOUT } from './pcad_cutout.js';
import type { VERTICES_ARRAY } from './pcad_item_types.js';
import { PCAD_LINE } from './pcad_line.js';
import { PCAD_PAD } from './pcad_pad.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import { PCAD_PLANE } from './pcad_plane.js';
import { PCAD_POLYGON } from './pcad_polygon.js';
import { PCAD_TEXT } from './pcad_text.js';
import { PCAD_VIA } from './pcad_via.js';
import {
  CorrectTextPosition,
  FindNode,
  FindPinMap,
  GetName,
  InitTTextValue,
  NodeToLong,
  SetFontProperty,
  SetPosition,
  SetTextSizeFromStrokeFontHeight,
  SetTextSizeFromTrueTypeFontHeight,
  SetWidth,
  type TTEXTVALUE,
  TrimLeft,
  TrimRight,
  ValidateName,
  ValidateReference,
} from './pcad2kicad_common.js';

function HasLine(vector: readonly PCAD_LINE[], line: PCAD_LINE): boolean {
  return vector.some(
    (l2) =>
      line.m_PositionX === l2.m_PositionX &&
      line.m_PositionY === l2.m_PositionY &&
      line.m_ToX === l2.m_ToX &&
      line.m_ToY === l2.m_ToY,
  );
}

export class PCAD_FOOTPRINT extends PCAD_PCB_COMPONENT {
  m_Value: TTEXTVALUE = InitTTextValue(); // has reference (Name from parent) and value
  readonly m_FootprintItems: PCAD_PCB_COMPONENT[] = []; // set of objects like PCAD_LINE, PCAD_PAD, PCAD_ARC ...
  m_Mirror = 0;
  m_BoardOutline: VERTICES_ARRAY = [];

  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'M'; // FOOTPRINT
    this.m_KiCadLayer = PCB_LAYER_ID.F_SilkS; // default
  }

  FindModulePatternDefName(aNode: XNODE, aName: string): XNODE | null {
    let result: XNODE | null = null;
    let lNode: XNODE | null;
    let propValue1 = '';
    let propValue2 = '';

    // Old file format
    lNode = FindNode(aNode, 'patternDef');

    while (lNode) {
      if (lNode.GetName() === 'patternDef') {
        propValue1 = GetName(lNode, propValue1);

        const originalNameNode = FindNode(lNode, 'originalName');

        if (originalNameNode) propValue2 = GetName(originalNameNode, propValue2);

        if (ValidateName(propValue1) === aName || ValidateName(propValue2) === aName) {
          result = lNode;
          lNode = null;
        }
      }

      if (lNode) lNode = lNode.GetNext();
    }

    if (result === null) {
      lNode = FindNode(aNode, 'patternDefExtended'); // New file format

      while (lNode) {
        if (lNode.GetName() === 'patternDefExtended') {
          propValue1 = GetName(lNode, propValue1);

          if (ValidateName(propValue1) === aName) {
            result = lNode;
            lNode = null;
          }
        }

        if (lNode) lNode = lNode.GetNext();
      }
    }

    return result;
  }

  /** `FindPatternMultilayerSection`: the section, and the (possibly updated) graphics name. */
  private FindPatternMultilayerSection(
    aNode: XNODE,
    aPatGraphRefName: string,
  ): [XNODE | null, string] {
    let result: XNODE | null = null;
    let pNode: XNODE | null = aNode;
    let lNode: XNODE | null = aNode;
    let propValue = '';

    if (lNode.GetName() === 'compDef') {
      // calling from library conversion we need to find pattern
      propValue = TrimLeft(GetName(lNode, propValue));
      let patName = ValidateName(propValue);

      const patternNode = FindNode(lNode, 'attachedPattern');

      if (patternNode) {
        const patternNameNode = FindNode(patternNode, 'patternName');

        if (patternNameNode) propValue = GetName(patternNameNode, propValue);

        propValue = TrimRight(TrimLeft(propValue));
        patName = ValidateName(propValue);
      }

      lNode = this.FindModulePatternDefName(lNode.GetParent()!, patName);
      pNode = lNode; // pattern;
    }

    lNode = null;

    if (pNode) lNode = FindNode(pNode, 'multiLayer'); // Old file format

    if (lNode) {
      aPatGraphRefName = ''; // default
      result = lNode;
    } else {
      // New file format

      if (aPatGraphRefName === '') {
        const nameRefNode = FindNode(aNode, 'patternGraphicsNameRef');

        if (nameRefNode) aPatGraphRefName = GetName(nameRefNode, aPatGraphRefName);
      }

      // Every version of the patternGraphicsDef-searching loop below starts from the first
      if (FindNode(aNode, 'patternGraphicsDef')) lNode = FindNode(aNode, 'patternGraphicsDef');
      else if (pNode) lNode = FindNode(pNode, 'patternGraphicsDef');

      if (aPatGraphRefName === '') {
        // Default the first one found
        if (lNode) {
          result = FindNode(lNode, 'multiLayer');
          lNode = null;
        }
      }

      while (lNode) {
        if (lNode.GetName() === 'patternGraphicsDef') {
          const nameDefNode = FindNode(lNode, 'patternGraphicsNameDef');

          if (nameDefNode) propValue = GetName(nameDefNode, propValue);

          if (propValue === aPatGraphRefName) {
            result = FindNode(lNode, 'multiLayer');
            lNode = null;
          } else {
            lNode = lNode.GetNext();
          }
        } else {
          lNode = lNode.GetNext();
        }
      }
    }

    return [result, aPatGraphRefName];
  }

  DoLayerContentsObjects(
    aNode: XNODE,
    aFootprint: PCAD_FOOTPRINT | null,
    aList: PCAD_PCB_COMPONENT[],
    aDefaultMeasurementUnit: string,
    aActualConversion: string,
  ): void {
    let plane_layer: PCAD_POLYGON | null = null;
    let line: PCAD_LINE;
    let lNode: XNODE | null;
    let pNode: XNODE | null;
    let propValue = '';
    let num = 0;
    let width = 0;
    let x = 0;
    let y = 0;
    let LastX = 0;
    let LastY = 0;
    let FirstX = 0;
    let FirstY = 0;
    let IsFirstPoint = false;
    const lines: PCAD_LINE[] = [];

    const layerNumRef = FindNode(aNode, 'layerNumRef');

    if (layerNumRef) num = NodeToLong(layerNumRef.GetNodeContent());

    const PCadLayer = num;
    const IsBoardLayer = PCadLayer === 3;

    if (this.m_callbacks.GetLayerType(PCadLayer) === LAYER_TYPE_T.LAYER_TYPE_PLANE) {
      plane_layer = new PCAD_POLYGON(this.m_callbacks, this.m_board, PCadLayer);
      plane_layer.AssignNet(this.m_callbacks.GetLayerNetNameRef(PCadLayer));
      plane_layer.SetOutline(this.m_BoardOutline);
      aList.push(plane_layer);

      // fill the polygon with the same contour as its outline is
      //plane_layer->m_islands.Add( plane_layer->m_outline );
    }

    lNode = aNode.GetChildren();

    while (lNode) {
      const name = lNode.GetName();

      if (name === 'line') {
        line = new PCAD_LINE(this.m_callbacks, this.m_board);
        line.Parse(lNode, PCadLayer, aDefaultMeasurementUnit, aActualConversion);

        if (IsBoardLayer) {
          if (!HasLine(lines, line)) {
            lines.push(line);
            aList.push(line);
          }
        } else {
          aList.push(line);
        }
      }

      if (name === 'text') {
        const text = new PCAD_TEXT(this.m_callbacks, this.m_board);
        text.Parse(lNode, PCadLayer, aDefaultMeasurementUnit, aActualConversion);
        aList.push(text);
      }

      // added  as Sergeys request 02/2008
      if (name === 'attr') {
        // assign fonts to Module Name,Value,Type,....s
        propValue = TrimRight(TrimLeft(GetName(lNode, propValue)));

        if (propValue === 'RefDes') {
          const tNode = FindNode(lNode, 'textStyleRef');

          if (tNode && aFootprint) {
            // TODO: to understand and may be repair
            // Alexander Lunev: it seems that the sense of this code is that
            // "attr" node can refer to a text style. So the text style
            // of the reference designator is taken from it.
            SetFontProperty(tNode, aFootprint.m_Name, aDefaultMeasurementUnit, aActualConversion);
          }
        }
      }

      // added  as Sergeys request 02/2008
      if (name === 'arc' || name === 'triplePointArc') {
        const arc = new PCAD_ARC(this.m_callbacks, this.m_board);
        arc.Parse(lNode, PCadLayer, aDefaultMeasurementUnit, aActualConversion);
        aList.push(arc);
      }

      if (name === 'pcbPoly') {
        if (this.m_callbacks.GetLayerType(PCadLayer) === LAYER_TYPE_T.LAYER_TYPE_PLANE) {
          if (plane_layer) {
            const plane_layer_polygon: VERTICES_ARRAY = [];
            plane_layer.FormPolygon(
              lNode,
              plane_layer_polygon,
              aDefaultMeasurementUnit,
              aActualConversion,
            );
            plane_layer.m_Cutouts.push(plane_layer_polygon);
          }
        } else {
          const polygon = new PCAD_POLYGON(this.m_callbacks, this.m_board, PCadLayer);

          if (polygon.Parse(lNode, aDefaultMeasurementUnit, aActualConversion)) aList.push(polygon);
        }
      }

      if (name === 'copperPour95') {
        const copperPour = new PCAD_COPPER_POUR(this.m_callbacks, this.m_board, PCadLayer);

        if (copperPour.Parse(lNode, aDefaultMeasurementUnit, aActualConversion))
          aList.push(copperPour);
      }

      if (name === 'polyCutOut') {
        const cutout = new PCAD_CUTOUT(this.m_callbacks, this.m_board, PCadLayer);

        if (cutout.Parse(lNode, aDefaultMeasurementUnit, aActualConversion)) aList.push(cutout);
      }

      if (name === 'planeObj') {
        const plane = new PCAD_PLANE(this.m_callbacks, this.m_board, PCadLayer);

        if (plane.Parse(lNode, aDefaultMeasurementUnit, aActualConversion)) aList.push(plane);
      }

      if (name === 'boardOutlineObj' && IsBoardLayer) {
        LastX = 0;
        LastY = 0;
        FirstX = 0;
        FirstY = 0;
        IsFirstPoint = true;

        pNode = FindNode(lNode, 'width');

        if (pNode) {
          width = SetWidth(pNode.GetNodeContent(), aDefaultMeasurementUnit, aActualConversion);

          pNode = FindNode(lNode, 'enhancedPolygon');

          if (pNode) {
            pNode = pNode.GetChildren();

            while (pNode) {
              if (pNode.GetName() === 'polyPoint') {
                [x, y] = SetPosition(
                  pNode.GetNodeContent(),
                  aDefaultMeasurementUnit,
                  aActualConversion,
                );

                if (IsFirstPoint) {
                  IsFirstPoint = false;
                  FirstX = x;
                  FirstY = y;
                } else {
                  line = this.boardOutlineLine(LastX, LastY, x, y, width, PCadLayer);

                  if (!HasLine(lines, line)) {
                    lines.push(line);
                    aList.push(line);
                  }
                }

                LastX = x;
                LastY = y;
              }

              pNode = pNode.GetNext();
            }

            if (LastX !== FirstX || LastY !== FirstY) {
              line = this.boardOutlineLine(LastX, LastY, FirstX, FirstY, width, PCadLayer);

              if (!HasLine(lines, line)) {
                lines.push(line);
                aList.push(line);
              }
            }
          }
        }
      }

      lNode = lNode.GetNext();
    }
  }

  private boardOutlineLine(
    aFromX: number,
    aFromY: number,
    aToX: number,
    aToY: number,
    aWidth: number,
    aPCadLayer: number,
  ): PCAD_LINE {
    const line = new PCAD_LINE(this.m_callbacks, this.m_board);
    line.m_PositionX = aFromX;
    line.m_PositionY = aFromY;
    line.m_ToX = aToX;
    line.m_ToY = aToY;
    line.m_Width = aWidth;
    line.m_PCadLayer = aPCadLayer;
    line.m_KiCadLayer = line.GetKiCadLayer();

    return line;
  }

  SetName(aPin: string, aName: string): void {
    const num = NodeToLong(aPin);

    for (const item of this.m_FootprintItems) {
      if (item.m_ObjType === 'P') {
        if ((item as PCAD_PAD).m_Number === num) (item as PCAD_PAD).m_Name.text = aName;
      }
    }
  }

  Parse(aNode: XNODE, aDefaultMeasurementUnit: string, aActualConversion: string): void {
    let lNode: XNODE | null;
    let propValue = '';

    // `FindNode( … )->GetAttribute`: a pattern with no originalName crashes the C++
    propValue = TrimLeft(GetName(FindNode(aNode, 'originalName')!, propValue));
    this.m_Name.text = propValue;

    lNode = aNode;
    [lNode, this.m_PatGraphRefName] = this.FindPatternMultilayerSection(
      lNode,
      this.m_PatGraphRefName,
    );

    if (lNode) {
      let tNode = lNode.GetChildren();

      while (tNode) {
        if (tNode.GetName() === 'pad') {
          const pad = new PCAD_PAD(this.m_callbacks, this.m_board);
          pad.Parse(tNode, aDefaultMeasurementUnit, aActualConversion);
          this.m_FootprintItems.push(pad);
        }

        if (tNode.GetName() === 'via') {
          const via = new PCAD_VIA(this.m_callbacks, this.m_board);
          via.Parse(tNode, aDefaultMeasurementUnit, aActualConversion);
          this.m_FootprintItems.push(via);
        }

        tNode = tNode.GetNext();
      }

      lNode = lNode.GetParent();
    }

    if (lNode) lNode = FindNode(lNode, 'layerContents');

    while (lNode) {
      if (lNode.GetName() === 'layerContents')
        this.DoLayerContentsObjects(
          lNode,
          this,
          this.m_FootprintItems,
          aDefaultMeasurementUnit,
          aActualConversion,
        );

      lNode = lNode.GetNext();
    }

    // map pins
    lNode = FindPinMap(aNode);

    if (lNode) {
      let mNode = lNode.GetChildren();

      while (mNode) {
        if (mNode.GetName() === 'padNum') {
          const str = mNode.GetNodeContent();
          mNode = mNode.GetNext();

          if (!mNode) break;

          propValue = GetName(mNode, propValue);
          this.SetName(str, propValue);
          mNode = mNode.GetNext();
        } else {
          mNode = mNode.GetNext();

          if (!mNode) break;

          mNode = mNode.GetNext();
        }
      }
    }
  }

  AddToBoard(aFootprint: FOOTPRINT | null = null): void {
    // wxCHECK( aFootprint == nullptr, ): a footprint is never added to another
    if (aFootprint !== null) return;

    this.CorrectAndRotate(this.m_Name);
    this.CorrectAndRotate(this.m_Value);

    const footprint = new FOOTPRINT(this.m_board);
    this.m_board.Add(footprint, ADD_MODE.APPEND);

    footprint.SetPosition({ x: this.m_PositionX, y: this.m_PositionY });
    footprint.SetLayer(this.m_Mirror ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu);
    footprint.SetOrientation(this.m_Rotation);

    const fpID = new LIB_ID();
    fpID.Parse(this.m_CompRef, true);
    footprint.SetFPID(fpID);

    // reference text
    const ref_text = footprint.Reference();

    ref_text.SetText(ValidateReference(this.m_Name.text));

    ref_text.SetFPRelativePosition({
      x: this.m_Name.correctedPositionX,
      y: this.m_Name.correctedPositionY,
    });

    if (this.m_Name.isTrueType) SetTextSizeFromTrueTypeFontHeight(ref_text, this.m_Name.textHeight);
    else SetTextSizeFromStrokeFontHeight(ref_text, this.m_Name.textHeight);

    ref_text.SetTextAngle(this.m_Name.textRotation.sub(this.m_Rotation));
    ref_text.SetKeepUpright(false);

    ref_text.SetItalic(this.m_Name.isItalic);
    ref_text.SetTextThickness(this.m_Name.textstrokeWidth);

    ref_text.SetMirrored(this.m_Name.mirror !== 0);
    ref_text.SetVisible(this.m_Name.textIsVisible !== 0);

    ref_text.SetLayer(
      this.m_Mirror ? this.m_board.FlipLayer(this.m_KiCadLayer) : this.m_KiCadLayer,
    );

    // value text
    const val_text = footprint.Value();

    val_text.SetText(this.m_Value.text);

    val_text.SetFPRelativePosition({
      x: this.m_Value.correctedPositionX,
      y: this.m_Value.correctedPositionY,
    });

    if (this.m_Value.isTrueType)
      SetTextSizeFromTrueTypeFontHeight(val_text, this.m_Value.textHeight);
    else SetTextSizeFromStrokeFontHeight(val_text, this.m_Value.textHeight);

    val_text.SetTextAngle(this.m_Value.textRotation.sub(this.m_Rotation));
    val_text.SetKeepUpright(false);

    val_text.SetItalic(this.m_Value.isItalic);
    val_text.SetTextThickness(this.m_Value.textstrokeWidth);

    val_text.SetMirrored(this.m_Value.mirror !== 0);
    val_text.SetVisible(this.m_Value.textIsVisible !== 0);

    // the value's layer follows the VALUE's mirror flag, the reference's the
    // footprint's: upstream does exactly that
    val_text.SetLayer(
      this.m_Value.mirror ? this.m_board.FlipLayer(this.m_KiCadLayer) : this.m_KiCadLayer,
    );

    // TEXTS
    for (const item of this.m_FootprintItems)
      if (item.m_ObjType === 'T') item.AddToBoard(footprint);

    // FOOTPRINT LINES
    for (const item of this.m_FootprintItems)
      if (item.m_ObjType === 'L') item.AddToBoard(footprint);

    // FOOTPRINT ARCS
    for (const item of this.m_FootprintItems)
      if (item.m_ObjType === 'A') item.AddToBoard(footprint);

    // FOOTPRINT POLYGONS
    for (const item of this.m_FootprintItems)
      if (item.m_ObjType === 'Z') item.AddToBoard(footprint);

    // PADS
    for (const item of this.m_FootprintItems)
      if (item.m_ObjType === 'P')
        (item as PCAD_PAD).AddToFootprint(footprint, this.m_Rotation, false);

    // VIAS
    for (const item of this.m_FootprintItems)
      if (item.m_ObjType === 'V')
        (item as PCAD_VIA).AddToFootprint(footprint, this.m_Rotation, false);
  }

  /** `CorrectTextPosition` then `RotatePoint( …, -m_Rotation )`. */
  private CorrectAndRotate(aValue: TTEXTVALUE): void {
    CorrectTextPosition(aValue);
    const p = RotatePoint(
      { x: aValue.correctedPositionX, y: aValue.correctedPositionY },
      this.m_Rotation.negate() as EDA_ANGLE,
    );
    aValue.correctedPositionX = p.x;
    aValue.correctedPositionY = p.y;
  }

  override Flip(): void {
    if (this.m_Mirror === 1) {
      this.m_Rotation = this.m_Rotation.negate();

      for (const item of this.m_FootprintItems) {
        if (
          item.m_ObjType === 'L' || // lines
          item.m_ObjType === 'A' || // arcs
          item.m_ObjType === 'Z' || // polygons
          item.m_ObjType === 'P' || // pads
          item.m_ObjType === 'V' // vias
        ) {
          item.Flip();
        }
      }
    }
  }
}
