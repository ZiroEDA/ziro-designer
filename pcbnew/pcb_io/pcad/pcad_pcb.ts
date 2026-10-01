// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_pcb.cpp` / `.h`: the whole P-CAD design — layer
 * map, stackup, board outline, netlist and components — and what it adds to
 * the BOARD.
 *
 * In the C++ PCAD_PCB is both the top footprint and the PCAD_CALLBACKS every
 * object asks, and the two share method names (`GetKiCadLayer()` of the
 * component, `GetKiCadLayer( layer )` of the callbacks). Here the callbacks
 * are a small object that reads this PCB's tables.
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { LAYER_TYPE_T, type PCAD_CALLBACKS, type TLAYER } from './pcad_callbacks.js';
import { PCAD_FOOTPRINT } from './pcad_footprint.js';
import type { VERTICES_ARRAY, wxRealPoint } from './pcad_item_types.js';
import { PCAD_KEEPOUT } from './pcad_keepout.js';
import { ConvertNetName, PCAD_NET } from './pcad_nets.js';
import { PCAD_PAD } from './pcad_pad.js';
import type { PCAD_PCB_COMPONENT } from './pcad_pcb_component.js';
import { PCAD_POLYGON } from './pcad_polygon.js';
import { PCAD_VIA } from './pcad_via.js';
import {
  FindNode,
  FindNodeGetContent,
  FindPinMap,
  GetName,
  IsSameAsNoCase,
  MakeLower,
  MakeUpper,
  NodeToLong,
  SetPosition,
  SetTextParameters,
  StrToInt1Units,
  type TTEXTVALUE,
  TrimLeft,
  TrimRight,
  ValidateName,
} from './pcad2kicad_common.js';

// std::numeric_limits<long>::max(), as a sort key only
const LONG_MAX = Number.MAX_SAFE_INTEGER;

/** The PCAD_CALLBACKS half of PCAD_PCB. */
class PCB_CALLBACKS implements PCAD_CALLBACKS {
  m_pcb: PCAD_PCB | null = null;

  private layer(aPCadLayer: number): TLAYER {
    const it = this.m_pcb!.m_LayersMap.get(aPCadLayer);

    if (!it) throw new IO_ERROR(`Unknown PCad layer ${aPCadLayer >>> 0}`);

    return it;
  }

  GetKiCadLayer(aPCadLayer: number): PCB_LAYER_ID {
    return this.layer(aPCadLayer).KiCadLayer;
  }

  GetLayerType(aPCadLayer: number): LAYER_TYPE_T {
    return this.layer(aPCadLayer).layerType;
  }

  GetLayerNetNameRef(aPCadLayer: number): string {
    return this.layer(aPCadLayer).netNameRef;
  }

  GetNetCode(aNetName: string): number {
    for (const net of this.m_pcb!.m_PcbNetlist) {
      if (net.m_Name === aNetName) return net.m_NetCode;
    }

    return 0;
  }
}

export class PCAD_PCB extends PCAD_FOOTPRINT {
  readonly m_PcbComponents: PCAD_PCB_COMPONENT[] = []; // PCB Footprints,Lines,Routes,Texts, .... and so on
  readonly m_PcbNetlist: PCAD_NET[] = []; // net objects collection
  m_DefaultMeasurementUnit = 'mil';
  /** `std::map<int, TLAYER>`: iterated in key order where it matters. */
  readonly m_LayersMap = new Map<number, TLAYER>(); // flexible layers mapping
  m_SizeX = 0;
  m_SizeY = 0;

  private readonly m_layersStackup: [string, number][] = [];

  constructor(aBoard: BOARD) {
    const callbacks = new PCB_CALLBACKS();
    super(callbacks, aBoard);
    callbacks.m_pcb = this;

    for (let i = 1; i < 12; ++i) {
      this.m_LayersMap.set(i, {
        KiCadLayer: PCB_LAYER_ID.User_1,
        layerType: LAYER_TYPE_T.LAYER_TYPE_NONSIGNAL,
        netNameRef: '', // default
        hasContent: false,
      });
    }

    const L = (i: number) => this.m_LayersMap.get(i)!;

    L(1).KiCadLayer = PCB_LAYER_ID.F_Cu;
    L(1).layerType = LAYER_TYPE_T.LAYER_TYPE_SIGNAL;
    L(2).KiCadLayer = PCB_LAYER_ID.B_Cu;
    L(2).layerType = LAYER_TYPE_T.LAYER_TYPE_SIGNAL;
    L(3).KiCadLayer = PCB_LAYER_ID.Edge_Cuts;
    L(4).KiCadLayer = PCB_LAYER_ID.F_Mask;
    L(5).KiCadLayer = PCB_LAYER_ID.B_Mask;
    L(6).KiCadLayer = PCB_LAYER_ID.F_SilkS;
    L(7).KiCadLayer = PCB_LAYER_ID.B_SilkS;
    L(8).KiCadLayer = PCB_LAYER_ID.F_Paste;
    L(9).KiCadLayer = PCB_LAYER_ID.B_Paste;
    L(10).KiCadLayer = PCB_LAYER_ID.F_Fab;
    L(11).KiCadLayer = PCB_LAYER_ID.B_Fab;
  }

  private FindCompDefName(aNode: XNODE | null, aName: string): XNODE | null {
    let result: XNODE | null = null;
    let propValue = '';

    // `FindNode( nullptr, … )` crashes in the C++; a design always has a library
    let lNode = FindNode(aNode!, 'compDef');

    while (lNode) {
      if (IsSameAsNoCase(lNode.GetName(), 'compDef')) {
        propValue = GetName(lNode, propValue);

        if (propValue === aName) {
          result = lNode;
          lNode = null;
        }
      }

      if (lNode) lNode = lNode.GetNext();
    }

    return result;
  }

  private SetTextProperty(
    aNode: XNODE,
    aTextValue: TTEXTVALUE,
    _aPatGraphRefName: string,
    aXmlName: string,
    aActualConversion: string,
  ): void {
    let tNode: XNODE | null = aNode;
    let t1Node: XNODE = aNode;
    let n = aXmlName;
    let nnew = '';
    let pn = '';
    let propValue = '';

    // new file format version
    const nameRef = FindNode(tNode, 'patternGraphicsNameRef');

    if (nameRef) {
      pn = TrimRight(TrimLeft(GetName(nameRef, pn)));
      tNode = FindNode(tNode, 'patternGraphicsRef');

      while (tNode) {
        if (IsSameAsNoCase(tNode.GetName(), 'patternGraphicsRef')) {
          const ref = FindNode(tNode, 'patternGraphicsNameRef');

          if (ref) {
            propValue = GetName(ref, propValue);

            if (propValue === pn) {
              t1Node = tNode; // find correct section with same name.
              const str = TrimRight(TrimLeft(aTextValue.text));
              nnew = n; // new file version
              n = `${n} ${str}`; // old file version
              tNode = null;
            }
          }
        }

        if (tNode) tNode = tNode.GetNext();
      }
    }

    // old version and compatible for both from this point
    tNode = FindNode(t1Node, 'attr');

    while (tNode) {
      propValue = TrimRight(TrimLeft(GetName(tNode, propValue)));

      if (propValue === n || propValue === nnew) break;

      tNode = tNode.GetNext();
    }

    if (tNode)
      SetTextParameters(tNode, aTextValue, this.m_DefaultMeasurementUnit, aActualConversion);
  }

  private DoPCBComponents(aNode: XNODE, aRoot: XNODE, aActualConversion: string): void {
    let lNode: XNODE | null;
    let tNode: XNODE | null;
    let mNode: XNODE | null;
    let fp: PCAD_FOOTPRINT | null;
    let cn = '';
    let str: string;
    let propValue = '';

    lNode = aNode.GetChildren();

    while (lNode) {
      fp = null;

      if (IsSameAsNoCase(lNode.GetName(), 'pattern')) {
        // `FindNode( … )->GetAttribute`: a pattern with no patternRef crashes the C++
        cn = ValidateName(GetName(FindNode(lNode, 'patternRef')!, cn));
        tNode = FindNode(aRoot, 'library');

        if (tNode && cn.length > 0) {
          tNode = this.FindModulePatternDefName(tNode, cn);

          if (tNode) {
            fp = new PCAD_FOOTPRINT(this.m_callbacks, this.m_board);

            mNode = FindNode(lNode, 'patternGraphicsNameRef');

            if (mNode) fp.m_PatGraphRefName = GetName(mNode, fp.m_PatGraphRefName);

            fp.Parse(tNode, this.m_DefaultMeasurementUnit, aActualConversion);
          }
        }

        if (fp) {
          fp.m_CompRef = cn; // default - in new version of file it is updated later....
          tNode = FindNode(lNode, 'refDesRef');

          if (tNode) {
            fp.m_Name.text = GetName(tNode, fp.m_Name.text);
            this.SetTextProperty(
              lNode,
              fp.m_Name,
              fp.m_PatGraphRefName,
              'RefDes',
              aActualConversion,
            );
            this.SetTextProperty(
              lNode,
              fp.m_Value,
              fp.m_PatGraphRefName,
              'Value',
              aActualConversion,
            );
          }

          tNode = FindNode(lNode, 'pt');

          if (tNode)
            [fp.m_PositionX, fp.m_PositionY] = SetPosition(
              tNode.GetNodeContent(),
              this.m_DefaultMeasurementUnit,
              aActualConversion,
            );

          tNode = FindNode(lNode, 'rotation');

          if (tNode) {
            str = TrimLeft(tNode.GetNodeContent());
            fp.m_Rotation = new EDA_ANGLE(StrToInt1Units(str), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
          }

          str = FindNodeGetContent(lNode, 'isFlipped');

          if (IsSameAsNoCase(str, 'True')) fp.m_Mirror = 1;

          tNode = aNode;

          while (tNode!.GetName() !== 'www.lura.sk') tNode = tNode!.GetParent();

          tNode = FindNode(tNode!, 'netlist');

          if (tNode) {
            tNode = FindNode(tNode, 'compInst');

            while (tNode) {
              propValue = GetName(tNode, propValue);

              if (propValue === fp.m_Name.text) {
                const compValue = FindNode(tNode, 'compValue');

                if (compValue)
                  fp.m_Value.text = TrimRight(TrimLeft(GetName(compValue, fp.m_Value.text)));

                const compRef = FindNode(tNode, 'compRef');

                if (compRef) fp.m_CompRef = TrimRight(TrimLeft(GetName(compRef, fp.m_CompRef)));

                tNode = null;
              } else {
                tNode = tNode.GetNext();
              }
            }
          }

          // map pins
          tNode = FindNode(aRoot, 'library');
          tNode = this.FindCompDefName(tNode, fp.m_CompRef);

          if (tNode) {
            tNode = FindPinMap(tNode);

            if (tNode) {
              mNode = tNode.GetChildren();

              while (mNode) {
                if (IsSameAsNoCase(mNode.GetName(), 'padNum')) {
                  str = mNode.GetNodeContent();
                  mNode = mNode.GetNext();

                  if (!mNode) break;

                  propValue = GetName(mNode, propValue);
                  fp.SetName(str, propValue);
                  mNode = mNode.GetNext();
                } else {
                  mNode = mNode.GetNext();

                  if (!mNode) break;

                  mNode = mNode.GetNext();
                }
              }
            }
          }

          this.m_PcbComponents.push(fp);
        }
      } else if (IsSameAsNoCase(lNode.GetName(), 'pad')) {
        const pad = new PCAD_PAD(this.m_callbacks, this.m_board);
        pad.Parse(lNode, this.m_DefaultMeasurementUnit, aActualConversion);
        this.m_PcbComponents.push(pad);
      } else if (IsSameAsNoCase(lNode.GetName(), 'via')) {
        const via = new PCAD_VIA(this.m_callbacks, this.m_board);
        via.Parse(lNode, this.m_DefaultMeasurementUnit, aActualConversion);
        this.m_PcbComponents.push(via);
      } else if (IsSameAsNoCase(lNode.GetName(), 'polyKeepOut')) {
        const keepOut = new PCAD_KEEPOUT(this.m_callbacks, this.m_board, 0);

        if (keepOut.Parse(lNode, this.m_DefaultMeasurementUnit, aActualConversion))
          this.m_PcbComponents.push(keepOut);
      }

      lNode = lNode.GetNext();
    }
  }

  private ConnectPinToNet(aCompRef: string, aPinRef: string, aNetName: string): void {
    for (const comp of this.m_PcbComponents) {
      if (comp.m_ObjType === 'M' && comp.m_Name.text === aCompRef) {
        for (const item of (comp as PCAD_FOOTPRINT).m_FootprintItems) {
          if (item.m_ObjType === 'P') {
            const cp = item as PCAD_PAD;

            if (cp.m_Name.text === aPinRef) cp.m_Net = aNetName;
          }
        }
      }
    }
  }

  private FindLayer(aLayerName: string): number {
    let layerIndex = -1;
    let layerNum = -1;

    for (let i = 0; i < this.m_layersStackup.length; ++i) {
      if (this.m_layersStackup[i]![0] === aLayerName) {
        layerIndex = i;
        layerNum = this.m_layersStackup[i]![1];
        break;
      }
    }

    switch (layerNum) {
      case -1:
        return -1;
      case 1:
        return PCB_LAYER_ID.F_Cu;
      case 2:
        return PCB_LAYER_ID.B_Cu;
      default:
        return (layerIndex + 1) * 2;
    }
  }

  /**
   * Map P-CAD layer to KiCad layer.
   *
   * @note
   * KiCad layers
   *  0..31 are copper layers
   *  32..45 are technical layers
   */
  private MapLayer(aNode: XNODE): void {
    let KiCadLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
    let num = 0;

    const lName = MakeUpper(GetName(aNode, ''));

    if (lName === 'TOP ASSY') KiCadLayer = PCB_LAYER_ID.F_Fab;
    else if (lName === 'TOP SILK') KiCadLayer = PCB_LAYER_ID.F_SilkS;
    else if (lName === 'TOP PASTE') KiCadLayer = PCB_LAYER_ID.F_Paste;
    else if (lName === 'TOP MASK') KiCadLayer = PCB_LAYER_ID.F_Mask;
    else if (lName === 'TOP') KiCadLayer = PCB_LAYER_ID.F_Cu;
    else if (lName === 'BOTTOM') KiCadLayer = PCB_LAYER_ID.B_Cu;
    else if (lName === 'BOT MASK') KiCadLayer = PCB_LAYER_ID.B_Mask;
    else if (lName === 'BOT PASTE') KiCadLayer = PCB_LAYER_ID.B_Paste;
    else if (lName === 'BOT SILK') KiCadLayer = PCB_LAYER_ID.B_SilkS;
    else if (lName === 'BOT ASSY') KiCadLayer = PCB_LAYER_ID.B_Fab;
    else if (lName === 'BOARD') KiCadLayer = PCB_LAYER_ID.Edge_Cuts;
    else {
      const layernum = this.FindLayer(lName);

      if (layernum !== -1) KiCadLayer = ToLAYER_ID(layernum);
    }

    const layerNum = FindNode(aNode, 'layerNum');

    if (layerNum) num = NodeToLong(layerNum.GetNodeContent());

    if (num < 0) throw new IO_ERROR(`layerNum = ${num} is out of range`);

    const newlayer: TLAYER = {
      KiCadLayer,
      layerType: LAYER_TYPE_T.LAYER_TYPE_SIGNAL,
      netNameRef: '',
      hasContent: false,
    };

    if (KiCadLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      // Unsupported layers are mapped to Dwgs_User
      newlayer.KiCadLayer = PCB_LAYER_ID.Dwgs_User;
    }

    const layerTypeNode = FindNode(aNode, 'layerType');

    if (layerTypeNode) {
      const layerType = TrimLeft(layerTypeNode.GetNodeContent());

      if (IsSameAsNoCase(layerType, 'NonSignal'))
        newlayer.layerType = LAYER_TYPE_T.LAYER_TYPE_NONSIGNAL;

      if (IsSameAsNoCase(layerType, 'Signal')) newlayer.layerType = LAYER_TYPE_T.LAYER_TYPE_SIGNAL;

      if (IsSameAsNoCase(layerType, 'Plane')) newlayer.layerType = LAYER_TYPE_T.LAYER_TYPE_PLANE;
    }

    // `(int) num` as the key; `insert` keeps an existing entry, which is then overwritten
    const key = num | 0;
    const existing = this.m_LayersMap.get(key);

    if (existing) {
      // No KiCad layer found: keep the default mapping
      if (KiCadLayer === PCB_LAYER_ID.UNDEFINED_LAYER) newlayer.KiCadLayer = existing.KiCadLayer;
    }

    this.m_LayersMap.set(key, newlayer);

    const netNameRef = FindNode(aNode, 'netNameRef');

    if (netNameRef) {
      const layer = this.m_LayersMap.get(key)!;
      layer.netNameRef = GetName(netNameRef, layer.netNameRef);
      layer.netNameRef = TrimRight(TrimLeft(layer.netNameRef));
      layer.netNameRef = ConvertNetName(layer.netNameRef);
    }
  }

  private FindOutlinePoint(aOutline: VERTICES_ARRAY, aPoint: wxRealPoint): number {
    for (let i = 0; i < aOutline.length; i++)
      if (aOutline[i]!.x === aPoint.x && aOutline[i]!.y === aPoint.y) return i;

    return -1;
  }

  private GetDistance(aPoint1: wxRealPoint, aPoint2: wxRealPoint): number {
    return Math.sqrt(
      (aPoint1.x - aPoint2.x) * (aPoint1.x - aPoint2.x) +
        (aPoint1.y - aPoint2.y) * (aPoint1.y - aPoint2.y),
    );
  }

  private ExtractOutlinePointsFromEnhancedPolygon(aActualConversion: string, lNode: XNODE): void {
    let epNode = FindNode(lNode, 'enhancedPolygon');

    if (!epNode) return;

    // enhancedPolygon ( polyPoint ...
    epNode = epNode.GetChildren();

    while (epNode) {
      if (IsSameAsNoCase(epNode.GetName(), 'polyPoint')) {
        const [x, y] = SetPosition(
          epNode.GetNodeContent(),
          this.m_DefaultMeasurementUnit,
          aActualConversion,
        );

        if (this.FindOutlinePoint(this.m_BoardOutline, { x, y }) === -1)
          this.m_BoardOutline.push({ x, y });
      }

      epNode = epNode.GetNext();
    }
  }

  private GetBoardOutline(aRoot: XNODE, aActualConversion: string): void {
    let iNode: XNODE | null;
    let lNode: XNODE | null;
    let pNode: XNODE | null;
    let PCadLayer = 0;

    iNode = FindNode(aRoot, 'pcbDesign');

    if (!iNode) return;

    iNode = iNode.GetChildren();

    while (iNode) {
      if (IsSameAsNoCase(iNode.GetName(), 'layerContents')) {
        const layerNumRef = FindNode(iNode, 'layerNumRef');

        if (layerNumRef) PCadLayer = NodeToLong(layerNumRef.GetNodeContent());

        if (this.m_callbacks.GetKiCadLayer(PCadLayer) === PCB_LAYER_ID.Edge_Cuts) {
          lNode = iNode.GetChildren();

          while (lNode) {
            if (IsSameAsNoCase(lNode.GetName(), 'boardOutlineObj'))
              this.ExtractOutlinePointsFromEnhancedPolygon(aActualConversion, lNode);

            if (IsSameAsNoCase(lNode.GetName(), 'line')) {
              pNode = FindNode(lNode, 'pt');

              if (pNode) {
                const [x, y] = SetPosition(
                  pNode.GetNodeContent(),
                  this.m_DefaultMeasurementUnit,
                  aActualConversion,
                );

                if (this.FindOutlinePoint(this.m_BoardOutline, { x, y }) === -1)
                  this.m_BoardOutline.push({ x, y });
              }

              if (pNode) pNode = pNode.GetNext();

              if (pNode) {
                const [x, y] = SetPosition(
                  pNode.GetNodeContent(),
                  this.m_DefaultMeasurementUnit,
                  aActualConversion,
                );

                if (this.FindOutlinePoint(this.m_BoardOutline, { x, y }) === -1)
                  this.m_BoardOutline.push({ x, y });
              }
            }

            lNode = lNode.GetNext();
          }

          //m_boardOutline.Sort( cmpFunc );
          // sort vertices according to the distances between them
          const outline = this.m_BoardOutline;

          if (outline.length > 3) {
            for (let i = 0; i < outline.length - 1; i++) {
              let minDistance = this.GetDistance(outline[i]!, outline[i + 1]!);
              let targetInd = i + 1;

              for (let j = i + 2; j < outline.length; j++) {
                const distance = this.GetDistance(outline[i]!, outline[j]!);

                if (distance < minDistance) {
                  minDistance = distance;
                  targetInd = j;
                }
              }

              const xchgPoint = outline[i + 1]!;
              outline[i + 1] = outline[targetInd]!;
              outline[targetInd] = xchgPoint;
            }
          }

          break;
        }
      }

      iNode = iNode.GetNext();
    }
  }

  private ExtractLayerStackup(aRoot: XNODE): void {
    let layerName = '';
    let stackupIncomplete = false;

    const rootNode = FindNode(aRoot, 'pcbDesign');

    if (!rootNode) return;

    let aNode = FindNode(rootNode, 'layersStackup');

    if (aNode) {
      aNode = FindNode(aNode, 'layerStackupData');

      while (aNode) {
        if (aNode.GetName() === 'layerStackupData') {
          const aaNode = FindNode(aNode, 'layerStackupName');

          if (aaNode) {
            layerName = MakeUpper(GetName(aaNode, layerName));
            this.m_layersStackup.push([layerName, -1]);
          }
        }

        aNode = aNode.GetNext();
      }
    }

    aNode = FindNode(rootNode, 'layerDef');

    while (aNode) {
      if (IsSameAsNoCase(aNode.GetName(), 'layerDef')) {
        const layerTypeNode = FindNode(aNode, 'layerType');

        if (layerTypeNode) {
          let num = -1;
          const layerNum = FindNode(aNode, 'layerNum');

          if (layerNum) num = NodeToLong(layerNum.GetNodeContent());

          const layerType = TrimLeft(layerTypeNode.GetNodeContent());
          const isSignalLayer =
            IsSameAsNoCase(layerType, 'Signal') || IsSameAsNoCase(layerType, 'Plane');

          if (num > 0) {
            layerName = MakeUpper(GetName(aNode, layerName));

            const el = this.m_layersStackup.findIndex((e) => IsSameAsNoCase(layerName, e[0]));

            if (el >= 0) {
              if (isSignalLayer) this.m_layersStackup[el]![1] = num;
              else this.m_layersStackup.splice(el, 1);
            } else if (isSignalLayer) {
              stackupIncomplete = true;
              this.m_layersStackup.push([layerName, num]);
            }
          }
        }
      }

      aNode = aNode.GetNext();
    }

    if (stackupIncomplete) {
      // `std::sort`, not stable: equal keys land where libstdc++ puts them
      stdSort(this.m_layersStackup, (a, b) => {
        const lhs = a[1] === 2 ? LONG_MAX : a[1];
        const rhs = b[1] === 2 ? LONG_MAX : b[1];
        return lhs < rhs;
      });
    }

    if (this.m_layersStackup.length > 32)
      throw new IO_ERROR('KiCad only supports 32 signal layers.');
  }

  private CreatePolygonsForEmptyPowerPlanes(): void {
    // std::map iterates in key order
    for (const nbr of [...this.m_LayersMap.keys()].sort((a, b) => a - b)) {
      const layer = this.m_LayersMap.get(nbr)!;

      if (layer.layerType === LAYER_TYPE_T.LAYER_TYPE_PLANE && layer.hasContent === false) {
        const plane_layer = new PCAD_POLYGON(this.m_callbacks, this.m_board, nbr);
        plane_layer.AssignNet(layer.netNameRef);
        plane_layer.SetOutline(this.m_BoardOutline);
        this.m_PcbComponents.push(plane_layer);
      }
    }
  }

  private ProcessLayerContentsObjects(aActualConversion: string, aNode: XNODE): void {
    let num = 0;
    const layerNumRef = FindNode(aNode, 'layerNumRef');

    if (layerNumRef) num = NodeToLong(layerNumRef.GetNodeContent());

    if (num <= 0) return;

    this.DoLayerContentsObjects(
      aNode,
      null,
      this.m_PcbComponents,
      this.m_DefaultMeasurementUnit,
      aActualConversion,
    );

    // `m_LayersMap[num]`: DoLayerContentsObjects has already thrown for an unknown layer
    this.m_LayersMap.get(num)!.hasContent = true;
  }

  ParseBoard(aRoot: XNODE, aActualConversion: string): void {
    let aNode: XNODE | null;

    aNode = FindNode(aRoot, 'asciiHeader');

    if (aNode) {
      aNode = FindNode(aNode, 'fileUnits');

      if (aNode)
        this.m_DefaultMeasurementUnit = TrimLeft(TrimRight(MakeLower(aNode.GetNodeContent())));
    }

    this.ExtractLayerStackup(aRoot);

    aNode = FindNode(aRoot, 'pcbDesign');

    if (aNode) {
      aNode = FindNode(aNode, 'layerDef');

      while (aNode) {
        if (IsSameAsNoCase(aNode.GetName(), 'layerDef')) this.MapLayer(aNode);

        aNode = aNode.GetNext();
      }
    }

    this.GetBoardOutline(aRoot, aActualConversion);

    aNode = FindNode(aRoot, 'netlist');

    if (aNode) {
      aNode = FindNode(aNode, 'net');

      let netCode = 1;

      while (aNode) {
        const net = new PCAD_NET(netCode++);
        net.Parse(aNode);
        this.m_PcbNetlist.push(net);

        aNode = aNode.GetNext();
      }
    }

    // BOARD FILE
    // aStatusBar->SetStatusText( wxT( "Loading BOARD DEFINITION " ) );
    aNode = FindNode(aRoot, 'pcbDesign');

    if (aNode) {
      // COMPONENTS AND OBJECTS
      aNode = aNode.GetChildren();

      while (aNode) {
        // Components/footprints
        if (IsSameAsNoCase(aNode.GetName(), 'multiLayer'))
          this.DoPCBComponents(aNode, aRoot, aActualConversion);

        // objects
        if (IsSameAsNoCase(aNode.GetName(), 'layerContents'))
          this.ProcessLayerContentsObjects(aActualConversion, aNode);

        aNode = aNode.GetNext();
      }

      // POSTPROCESS -- SET NETLIST REFERENCES
      // aStatusBar->SetStatusText( wxT( "Processing NETLIST " ) );

      this.CreatePolygonsForEmptyPowerPlanes();

      for (const net of this.m_PcbNetlist) {
        for (const node of net.m_NetNodes) {
          const compRef = TrimRight(TrimLeft(node.m_CompRef));
          const pinRef = TrimRight(TrimLeft(node.m_PinRef));
          this.ConnectPinToNet(compRef, pinRef, net.m_Name);
        }
      }

      // POSTPROCESS -- FLIP COMPONENTS
      for (const comp of this.m_PcbComponents)
        if (comp.m_ObjType === 'M') (comp as PCAD_FOOTPRINT).Flip();

      // POSTPROCESS -- SET/OPTIMIZE NEW PCB POSITION
      // aStatusBar->SetStatusText( wxT( "Optimizing BOARD POSITION " ) );

      this.m_SizeX = 10000000;
      this.m_SizeY = 0;

      for (const comp of this.m_PcbComponents) {
        if (comp.m_PositionY < this.m_SizeY) this.m_SizeY = comp.m_PositionY; // max Y

        if (comp.m_PositionX < this.m_SizeX && comp.m_PositionX > 0)
          this.m_SizeX = comp.m_PositionX; // Min X
      }

      this.m_SizeY -= 10000;
      this.m_SizeX -= 10000;
      // aStatusBar->SetStatusText( wxT( " POSITIONING POSTPROCESS " ) );

      for (const comp of this.m_PcbComponents) comp.SetPosOffset(-this.m_SizeX, -this.m_SizeY);

      this.m_SizeX = 0;
      this.m_SizeY = 0;

      for (const comp of this.m_PcbComponents) {
        if (comp.m_PositionY < this.m_SizeY) this.m_SizeY = comp.m_PositionY; // max Y

        if (comp.m_PositionX > this.m_SizeX) this.m_SizeX = comp.m_PositionX; // Min X
      }

      // SHEET SIZE CALCULATION
      this.m_SizeY = -this.m_SizeY; // it is in absolute units
      this.m_SizeX += 10000;
      this.m_SizeY += 10000;

      // A4 is minimum $Descr A4 11700 8267
      if (this.m_SizeX < 11700) this.m_SizeX = 11700;

      if (this.m_SizeY < 8267) this.m_SizeY = 8267;
    } else {
      // LIBRARY FILE
      // aStatusBar->SetStatusText( wxT( "Processing LIBRARY FILE " ) );

      aNode = FindNode(aRoot, 'library');

      if (aNode) {
        // COMPONENTS
        aNode = FindNode(aNode, 'compDef');

        while (aNode) {
          // aStatusBar->SetStatusText( wxT( "Processing COMPONENTS " ) );

          if (IsSameAsNoCase(aNode.GetName(), 'compDef')) {
            const footprint = new PCAD_FOOTPRINT(this.m_callbacks, this.m_board);
            footprint.Parse(aNode, this.m_DefaultMeasurementUnit, aActualConversion);
            this.m_PcbComponents.push(footprint);
          }

          aNode = aNode.GetNext();
        }
      }
    }
  }

  override AddToBoard(_aFootprint: FOOTPRINT | null = null): void {
    this.m_board.SetCopperLayerCount(this.m_layersStackup.length);

    for (const net of this.m_PcbNetlist)
      this.m_board.Add(new NETINFO_ITEM(this.m_board, net.m_Name, net.m_NetCode));

    for (const comp of this.m_PcbComponents) comp.AddToBoard();
  }
}
