// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_text.cpp` / `.h`: a `text`.
 *
 * Every text is added to the BOARD at its own coordinates, a footprint's
 * included (which leaves a pattern's text at the pattern's origin): upstream
 * does exactly that.
 */

import type { XNODE } from '@ziroeda/common/xnode.js';
import { ANGLE_360, EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import type { FOOTPRINT } from '../../footprint.js';
import { PCB_TEXT } from '../../pcb_text.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import {
  FindNode,
  FindNodeGetContent,
  GetJustifyIdentificator,
  GetName,
  IsSameAsNoCase,
  SetFontProperty,
  SetPosition,
  SetTextJustify,
  SetTextSizeFromStrokeFontHeight,
  SetTextSizeFromTrueTypeFontHeight,
  StrToInt1Units,
  TrimLeft,
} from './pcad2kicad_common.js';

export class PCAD_TEXT extends PCAD_PCB_COMPONENT {
  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
    this.m_ObjType = 'T';
  }

  Parse(aNode: XNODE, aLayer: number, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;
    let str: string;

    this.m_PCadLayer = aLayer;
    this.m_KiCadLayer = this.GetKiCadLayer();
    this.m_PositionX = 0;
    this.m_PositionY = 0;
    this.m_Name.mirror = 0; // Normal, not mirrored
    lNode = FindNode(aNode, 'pt');

    if (lNode)
      [this.m_PositionX, this.m_PositionY] = SetPosition(
        lNode.GetNodeContent(),
        aDefaultUnits,
        aActualConversion,
      );

    lNode = FindNode(aNode, 'rotation');

    if (lNode) {
      str = TrimLeft(lNode.GetNodeContent());
      this.m_Rotation = new EDA_ANGLE(StrToInt1Units(str), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
    }

    this.m_Name.text = GetName(aNode, this.m_Name.text).replaceAll('\r', '');

    str = FindNodeGetContent(aNode, 'justify');
    this.m_Name.justify = GetJustifyIdentificator(str);

    str = FindNodeGetContent(aNode, 'isFlipped');

    if (IsSameAsNoCase(str, 'True')) this.m_Name.mirror = 1;

    lNode = FindNode(aNode, 'textStyleRef');

    if (lNode) SetFontProperty(lNode, this.m_Name, aDefaultUnits, aActualConversion);
  }

  AddToBoard(_aFootprint: FOOTPRINT | null = null): void {
    this.m_Name.textPositionX = this.m_PositionX;
    this.m_Name.textPositionY = this.m_PositionY;
    this.m_Name.textRotation = this.m_Rotation;

    const pcbtxt = new PCB_TEXT(this.m_board);
    this.m_board.Add(pcbtxt, ADD_MODE.APPEND);

    pcbtxt.SetText(this.m_Name.text);

    if (this.m_Name.isTrueType) SetTextSizeFromTrueTypeFontHeight(pcbtxt, this.m_Name.textHeight);
    else SetTextSizeFromStrokeFontHeight(pcbtxt, this.m_Name.textHeight);

    pcbtxt.SetItalic(this.m_Name.isItalic);
    pcbtxt.SetTextThickness(this.m_Name.textstrokeWidth);

    SetTextJustify(pcbtxt, this.m_Name.justify);
    pcbtxt.SetTextPos({ x: this.m_Name.textPositionX, y: this.m_Name.textPositionY });

    pcbtxt.SetMirrored(this.m_Name.mirror !== 0);

    if (pcbtxt.IsMirrored()) pcbtxt.SetTextAngle(ANGLE_360.sub(this.m_Name.textRotation));
    else pcbtxt.SetTextAngle(this.m_Name.textRotation);

    pcbtxt.SetLayer(this.m_KiCadLayer);
  }
}
