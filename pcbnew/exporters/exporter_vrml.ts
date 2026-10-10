// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/exporters/exporter_vrml.{h,cpp}` + `export_vrml.h`: EXPORTER_PCB_VRML, the board as a
 * VRML world - board body, copper, paste, mask, plated holes and silk, each a VRML_LAYER
 * tessellated by GLU, built into a scene graph and written by S3D::WriteVRML.
 *
 * Models come through `m_Cache3Dmodels`, an S3D_CACHE stand-in; with none set (the default
 * here) every model is skipped, which is what pcbnew does for a model it cannot resolve. The
 * --models-dir (inline) form is not ported yet: it needs VRML_LAYER's Write* text writers.
 */
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { type Color4d, brightened, mix, setFromHexString } from '@ziroeda/common/gal/color4d.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { IFSG_APPEARANCE } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_appearance.js';
import {
  CalcTriNorm,
  GetSGNodeParent,
  WriteVRML,
} from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_api.js';
import { IFSG_COORDINDEX } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_coordindex.js';
import { IFSG_COORDS } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_coords.js';
import { IFSG_FACESET } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_faceset.js';
import { IFSG_NORMALS } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_normals.js';
import { IFSG_SHAPE } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_shape.js';
import { IFSG_TRANSFORM } from '@ziroeda/3d-viewer/3d_cache/sg/ifsg_transform.js';
import { SGPOINT, SGVECTOR } from '@ziroeda/3d-viewer/3d_cache/sg/sg_base.js';
import type { SGNODE } from '@ziroeda/3d-viewer/3d_cache/sg/sg_node.js';
import { VRML_LAYER } from '@ziroeda/idftools/vrml_layer.js';
import { FULL_CIRCLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import { BOARD_STACKUP_ITEM_TYPE } from '../board_stackup_manager/board_stackup.js';
import { FP_SMD, FP_THROUGH_HOLE, type FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE } from '../padstack.js';
import type { PCB_VIA } from '../pcb_track.js';

const { F_Cu, B_Cu, F_SilkS, B_SilkS, F_Mask, B_Mask, F_Paste, B_Paste, F_Adhes, B_Adhes } =
  PCB_LAYER_ID;
const { Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts } = PCB_LAYER_ID;

// offset for art layers, mm (silk, paste, etc)
const ART_OFFSET = 0.025;
// offset for plating
const PLATE_OFFSET = 0.005;
// The max error (in mm) to approximate arcs to segments:
const ERR_APPROX_MAX_MM = 0.005;

export enum VRML_COLOR_INDEX {
  VRML_COLOR_NONE = -1,
  VRML_COLOR_PCB = 0,
  VRML_COLOR_COPPER,
  VRML_COLOR_TOP_SOLDMASK,
  VRML_COLOR_BOT_SOLDMASK,
  VRML_COLOR_PASTE,
  VRML_COLOR_TOP_SILK,
  VRML_COLOR_BOT_SILK,
  VRML_COLOR_LAST, // Sentinel
}

const f32 = Math.fround;

/** VRML_COLOR: every channel a C float. */
export class VRML_COLOR {
  diffuse_red: number;
  diffuse_grn: number;
  diffuse_blu: number;
  spec_red: number;
  spec_grn: number;
  spec_blu: number;
  emit_red = 0.0;
  emit_grn = 0.0;
  emit_blu = 0.0;
  ambient: number;
  transp: number;
  shiny: number;

  constructor(
    dr = 0.13,
    dg = 0.81,
    db = 0.22,
    sr = 0.01,
    sg = 0.08,
    sb = 0.02,
    am = 0.8,
    tr = 0.0,
    sh = 0.02,
  ) {
    // default green
    this.diffuse_red = f32(dr);
    this.diffuse_grn = f32(dg);
    this.diffuse_blu = f32(db);
    this.spec_red = f32(sr);
    this.spec_grn = f32(sg);
    this.spec_blu = f32(sb);
    this.ambient = f32(am);
    this.transp = f32(tr);
    this.shiny = f32(sh);
  }
}

/** CUSTOM_COLOR_ITEM: a stackup colour and the name the stackup stores. */
interface CUSTOM_COLOR_ITEM {
  m_Color: Color4d;
  m_ColorName: string;
}

const C = (r: number, g: number, b: number, a: number, name: string): CUSTOM_COLOR_ITEM => ({
  m_Color: { r: r / 255.0, g: g / 255.0, b: b / 255.0, a },
  m_ColorName: name,
});

// Data: initStaticColorList's tables, as exporter_vrml.cpp writes them.
const m_SilkscreenColors: CUSTOM_COLOR_ITEM[] = [
  C(245, 245, 245, 1.0, 'Not specified'), // White
  C(20, 51, 36, 1.0, 'Green'),
  C(181, 19, 21, 1.0, 'Red'),
  C(2, 59, 162, 1.0, 'Blue'),
  C(11, 11, 11, 1.0, 'Black'),
  C(245, 245, 245, 1.0, 'White'),
  C(32, 2, 53, 1.0, 'Purple'),
  C(194, 195, 0, 1.0, 'Yellow'),
];

const m_MaskColors: CUSTOM_COLOR_ITEM[] = [
  C(20, 51, 36, 0.83, 'Not specified'), // Green
  C(20, 51, 36, 0.83, 'Green'),
  C(91, 168, 12, 0.83, 'Light Green'),
  C(13, 104, 11, 0.83, 'Saturated Green'),
  C(181, 19, 21, 0.83, 'Red'),
  C(210, 40, 14, 0.83, 'Light Red'),
  C(239, 53, 41, 0.83, 'Red/Orange'),
  C(2, 59, 162, 0.83, 'Blue'),
  C(54, 79, 116, 0.83, 'Light Blue 1'),
  C(61, 85, 130, 0.83, 'Light Blue 2'),
  C(21, 70, 80, 0.83, 'Green/Blue'),
  C(11, 11, 11, 0.83, 'Black'),
  C(245, 245, 245, 0.83, 'White'),
  C(32, 2, 53, 0.83, 'Purple'),
  C(119, 31, 91, 0.83, 'Light Purple'),
  C(194, 195, 0, 0.83, 'Yellow'),
];

const m_PasteColors: CUSTOM_COLOR_ITEM[] = [
  C(128, 128, 128, 1.0, 'Grey'),
  C(90, 90, 90, 1.0, 'Dark Grey'),
  C(213, 213, 213, 1.0, 'Silver'),
];

const m_FinishColors: CUSTOM_COLOR_ITEM[] = [
  C(184, 115, 50, 1.0, 'Copper'),
  C(178, 156, 0, 1.0, 'Gold'),
  C(213, 213, 213, 1.0, 'Silver'),
  C(160, 160, 160, 1.0, 'Tin'),
];

const m_BoardColors: CUSTOM_COLOR_ITEM[] = [
  C(51, 43, 22, 0.83, 'FR4 natural, dark'),
  C(109, 116, 75, 0.83, 'FR4 natural'),
  C(252, 252, 250, 0.9, 'PTFE natural'),
  C(205, 130, 0, 0.68, 'Polyimide'),
  C(92, 17, 6, 0.9, 'Phenolic natural'),
  C(146, 99, 47, 0.83, 'Brown 1'),
  C(160, 123, 54, 0.83, 'Brown 2'),
  C(146, 99, 47, 0.83, 'Brown 3'),
  C(213, 213, 213, 1.0, 'Aluminum'),
];

const m_DefaultSilkscreen: Color4d = { r: 0.94, g: 0.94, b: 0.94, a: 1.0 };
const m_DefaultSolderMask: Color4d = { r: 0.08, g: 0.2, b: 0.14, a: 0.83 };
const m_DefaultSolderPaste: Color4d = { r: 0.5, g: 0.5, b: 0.5, a: 1.0 };
const m_DefaultSurfaceFinish: Color4d = { r: 0.75, g: 0.61, b: 0.23, a: 1.0 };
const m_DefaultBoardBody: Color4d = { r: 0.43, g: 0.45, b: 0.3, a: 0.9 };

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.a === b.a && a.r === b.r && a.g === b.g && a.b === b.b;

/** The S3D_CACHE calls the exporter makes. */
export interface S3D_CACHE {
  Load(aModelFile: string, aBasePath: string): SGNODE | null;
}

// From axis/rot to quaternion
function build_quat(x: number, y: number, z: number, a: number, q: number[]): void {
  const sina = Math.sin(a / 2);

  q[0] = x * sina;
  q[1] = y * sina;
  q[2] = z * sina;
  q[3] = Math.cos(a / 2);
}

// From quaternion to axis/rot
function from_quat(q: number[], rot: number[]): void {
  rot[3] = Math.acos(q[3]!) * 2;

  for (let i = 0; i < 3; i++) rot[i] = q[i]! / Math.sin(rot[3] / 2);
}

// Quaternion composition
function compose_quat(q1: number[], q2: number[], qr: number[]): void {
  const tmp = [
    q2[3]! * q1[0]! + q2[0]! * q1[3]! + q2[1]! * q1[2]! - q2[2]! * q1[1]!,
    q2[3]! * q1[1]! + q2[1]! * q1[3]! + q2[2]! * q1[0]! - q2[0]! * q1[2]!,
    q2[3]! * q1[2]! + q2[2]! * q1[3]! + q2[0]! * q1[1]! - q2[1]! * q1[0]!,
    q2[3]! * q1[3]! - q2[0]! * q1[0]! - q2[1]! * q1[1]! - q2[2]! * q1[2]!,
  ];

  qr[0] = tmp[0]!;
  qr[1] = tmp[1]!;
  qr[2] = tmp[2]!;
  qr[3] = tmp[3]!;
}

export class EXPORTER_PCB_VRML {
  private m_OutputPCB = new IFSG_TRANSFORM(null);
  private m_holes = new VRML_LAYER();
  private m_3D_board = new VRML_LAYER();
  private m_top_copper = new VRML_LAYER();
  private m_bot_copper = new VRML_LAYER();
  private m_top_silk = new VRML_LAYER();
  private m_bot_silk = new VRML_LAYER();
  private m_top_soldermask = new VRML_LAYER();
  private m_bot_soldermask = new VRML_LAYER();
  private m_top_paste = new VRML_LAYER();
  private m_bot_paste = new VRML_LAYER();
  private m_plated_holes = new VRML_LAYER();

  private m_components: SGNODE[] = [];
  m_Cache3Dmodels: S3D_CACHE | null = null;

  private m_UseInlineModelsInBrdfile = false;
  private m_Subdir3DFpModels = '';
  private m_UseRelPathIn3DModelFilename = false;
  private m_ReuseDef = true;
  private m_includeUnspecified = false;
  private m_includeDNP = false;

  // scaling from 0.1 inch to desired VRML unit
  private m_WorldScale = 1.0;
  // scaling from mm to desired VRML world scale
  private m_BoardToVrmlScale = pcbIUScale.MM_PER_IU;
  private m_tx = 0; // global translation along X
  private m_ty = 0; // global translation along Y
  private m_brd_thickness: number; // depth of the PCB

  private m_board: BOARD;
  private vrml_colors_list: VRML_COLOR[] = [];
  private m_layer_z = new Map<number, number>();
  private m_pcbOutlines = new SHAPE_POLY_SET(); // stores the board main outlines
  private m_precision = 6; // precision factor when exporting fp shapes to separate files
  private m_sgmaterial: (SGNODE | null)[] = new Array(VRML_COLOR_INDEX.VRML_COLOR_LAST).fill(null);

  constructor(aBoard: BOARD) {
    this.m_board = aBoard;

    // this default only makes sense if the output is in mm
    this.m_brd_thickness = pcbIUScale.iuToMM(this.m_board.GetDesignSettings().GetBoardThickness());

    // TODO: figure out a way to share all these stackup color definitions...
    let topSilk = m_DefaultSilkscreen;
    let botSilk = m_DefaultSilkscreen;
    let topMask = m_DefaultSolderMask;
    let botMask = m_DefaultSolderMask;
    const paste = m_DefaultSolderPaste;
    let finish = m_DefaultSurfaceFinish;
    let boardBody: Color4d = { r: 0, g: 0, b: 0, a: 0 };

    const stackup = this.m_board.GetDesignSettings().GetStackupDescriptor();

    const findColor = (aColorName: string, aColorSet: readonly CUSTOM_COLOR_ITEM[]): Color4d => {
      if (aColorName.startsWith('#')) {
        return setFromHexString(aColorName) ?? { r: 0, g: 0, b: 0, a: 1.0 };
      } else {
        for (const color of aColorSet) {
          if (color.m_ColorName === aColorName) return color.m_Color;
        }
      }

      // COLOR4D(): opaque black
      return { r: 0, g: 0, b: 0, a: 1.0 };
    };

    for (const stackupItem of stackup.GetList()) {
      const colorName = stackupItem.GetColor();

      switch (stackupItem.GetType()) {
        case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN:
          if (stackupItem.GetBrdLayerId() === F_SilkS)
            topSilk = findColor(colorName, m_SilkscreenColors);
          else botSilk = findColor(colorName, m_SilkscreenColors);
          break;

        case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK:
          if (stackupItem.GetBrdLayerId() === F_Mask) topMask = findColor(colorName, m_MaskColors);
          else botMask = findColor(colorName, m_MaskColors);
          break;

        case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC: {
          const layerColor = findColor(colorName, m_BoardColors);

          if (sameColor(boardBody, { r: 0, g: 0, b: 0, a: 0 })) boardBody = { ...layerColor };
          else boardBody = mix(boardBody, layerColor, 1.0 - layerColor.a);

          boardBody = { ...boardBody, a: boardBody.a + ((1.0 - boardBody.a) * layerColor.a) / 2 };
          break;
        }

        default:
          break;
      }
    }

    if (sameColor(boardBody, { r: 0, g: 0, b: 0, a: 0 })) boardBody = m_DefaultBoardBody;

    const finishName = stackup.m_FinishType;

    if (finishName.endsWith('OSP')) {
      finish = findColor('Copper', m_FinishColors);
    } else if (finishName.endsWith('IG') || finishName.endsWith('gold')) {
      finish = findColor('Gold', m_FinishColors);
    } else if (
      finishName.startsWith('HAL') ||
      finishName.startsWith('HASL') ||
      finishName.endsWith('tin') ||
      finishName.endsWith('nickel')
    ) {
      finish = findColor('Tin', m_FinishColors);
    } else if (finishName.endsWith('silver')) {
      finish = findColor('Silver', m_FinishColors);
    }

    const toVRMLColor = (
      aColor: Color4d,
      aSpecular: number,
      aAmbient: number,
      aShiny: number,
    ): VRML_COLOR => {
      const diff = aColor;
      const spec = brightened(aColor, aSpecular);

      return new VRML_COLOR(
        diff.r,
        diff.g,
        diff.b,
        spec.r,
        spec.g,
        spec.b,
        aAmbient,
        1.0 - aColor.a,
        aShiny,
      );
    };

    const L = this.vrml_colors_list;
    L[VRML_COLOR_INDEX.VRML_COLOR_TOP_SILK] = toVRMLColor(topSilk, 0.1, 0.7, 0.02);
    L[VRML_COLOR_INDEX.VRML_COLOR_BOT_SILK] = toVRMLColor(botSilk, 0.1, 0.7, 0.02);
    L[VRML_COLOR_INDEX.VRML_COLOR_TOP_SOLDMASK] = toVRMLColor(topMask, 0.3, 0.8, 0.3);
    L[VRML_COLOR_INDEX.VRML_COLOR_BOT_SOLDMASK] = toVRMLColor(botMask, 0.3, 0.8, 0.3);
    L[VRML_COLOR_INDEX.VRML_COLOR_PASTE] = toVRMLColor(paste, 0.6, 0.7, 0.7);
    L[VRML_COLOR_INDEX.VRML_COLOR_COPPER] = toVRMLColor(finish, 0.6, 0.7, 0.9);
    L[VRML_COLOR_INDEX.VRML_COLOR_PCB] = toVRMLColor(boardBody, 0.1, 0.7, 0.01);

    this.SetOffset(0.0, 0.0);
  }

  private GetColor(aIndex: VRML_COLOR_INDEX): VRML_COLOR {
    return this.vrml_colors_list[aIndex]!;
  }

  private GetLayerZ(aLayer: number): number {
    return this.m_layer_z.get(aLayer) ?? 0;
  }

  private SetLayerZ(aLayer: number, aValue: number): void {
    this.m_layer_z.set(aLayer, aValue);
  }

  /** `SetScale`: the scaling of the VRML world, 0.001 to 10. */
  private SetScale(aWorldScale: number): boolean {
    if (aWorldScale < 0.001 || aWorldScale > 10.0)
      throw new Error('WorldScale out of range (valid range is 0.001 to 10.0)');

    this.m_OutputPCB.SetScale(aWorldScale * 2.54);
    this.m_WorldScale = aWorldScale * 2.54;

    return true;
  }

  private SetOffset(aXoff: number, aYoff: number): void {
    this.m_tx = aXoff;
    this.m_ty = -aYoff;

    for (const l of [
      this.m_holes,
      this.m_3D_board,
      this.m_top_copper,
      this.m_bot_copper,
      this.m_top_silk,
      this.m_bot_silk,
      this.m_top_paste,
      this.m_bot_paste,
      this.m_top_soldermask,
      this.m_bot_soldermask,
      this.m_plated_holes,
    ])
      l.SetVertexOffsets(aXoff, aYoff);
  }

  // Build and export the solder mask layer, that is a negative layer
  private ExportVrmlSolderMask(): void {
    // holes is the solder mask opening.
    // the actual shape is the negative shape of mask opening.
    let pcb_layer = F_Mask;
    let vrmllayer = this.m_top_soldermask;

    for (let lcnt = 0; lcnt < 2; lcnt++) {
      const holes = new SHAPE_POLY_SET();
      const outlines = new SHAPE_POLY_SET(this.m_pcbOutlines);
      this.m_board.ConvertBrdLayerToPolygonalContours(pcb_layer, holes);

      outlines.BooleanSubtract(holes);
      outlines.Fracture();
      this.ExportVrmlPolygonSet(vrmllayer, outlines);

      pcb_layer = B_Mask;
      vrmllayer = this.m_bot_soldermask;
    }
  }

  // Build and exports the 4 layers F_Cu, B_Cu, F_SilkS, B_SilkS
  private ExportStandardLayers(): void {
    const pcb_layer = [F_Cu, B_Cu, F_SilkS, B_SilkS, F_Paste, B_Paste];
    const vrmllayer = [
      this.m_top_copper,
      this.m_bot_copper,
      this.m_top_silk,
      this.m_bot_silk,
      this.m_top_paste,
      this.m_bot_paste,
    ];

    for (let lcnt = 0; lcnt < vrmllayer.length; lcnt++) {
      const outlines = new SHAPE_POLY_SET();
      this.m_board.ConvertBrdLayerToPolygonalContours(pcb_layer[lcnt]!, outlines);
      outlines.BooleanIntersection(this.m_pcbOutlines);
      outlines.Fracture();

      this.ExportVrmlPolygonSet(vrmllayer[lcnt]!, outlines);
    }
  }

  private writeLayers(): string | null {
    const halfArt = pcbIUScale.mmToIU(ART_OFFSET / 2.0) * this.m_BoardToVrmlScale;
    const P = VRML_COLOR_INDEX;

    // VRML_LAYER board;
    this.m_3D_board.Tesselate(this.m_holes);
    const brdz = this.m_brd_thickness / 2.0 - halfArt;

    this.create_vrml_shell(this.m_OutputPCB, P.VRML_COLOR_PCB, this.m_3D_board, brdz, -brdz);

    // VRML_LAYER m_top_copper;
    this.m_top_copper.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_COPPER,
      this.m_top_copper,
      this.GetLayerZ(F_Cu),
      true,
    );

    // VRML_LAYER m_top_paste;
    this.m_top_paste.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_PASTE,
      this.m_top_paste,
      this.GetLayerZ(F_Cu) + halfArt,
      true,
    );

    // VRML_LAYER m_top_soldermask;
    this.m_top_soldermask.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_TOP_SOLDMASK,
      this.m_top_soldermask,
      this.GetLayerZ(F_Cu) + halfArt,
      true,
    );

    // VRML_LAYER m_bot_copper;
    this.m_bot_copper.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_COPPER,
      this.m_bot_copper,
      this.GetLayerZ(B_Cu),
      false,
    );

    // VRML_LAYER m_bot_paste;
    this.m_bot_paste.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_PASTE,
      this.m_bot_paste,
      this.GetLayerZ(B_Cu) - halfArt,
      false,
    );

    // VRML_LAYER m_bot_mask:
    this.m_bot_soldermask.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_BOT_SOLDMASK,
      this.m_bot_soldermask,
      this.GetLayerZ(B_Cu) - halfArt,
      false,
    );

    // VRML_LAYER PTH;
    this.m_plated_holes.Tesselate(null, true);
    this.create_vrml_shell(
      this.m_OutputPCB,
      P.VRML_COLOR_PASTE,
      this.m_plated_holes,
      this.GetLayerZ(F_Cu) + halfArt,
      this.GetLayerZ(B_Cu) - halfArt,
    );

    // VRML_LAYER m_top_silk;
    this.m_top_silk.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_TOP_SILK,
      this.m_top_silk,
      this.GetLayerZ(F_SilkS),
      true,
    );

    // VRML_LAYER m_bot_silk;
    this.m_bot_silk.Tesselate(this.m_holes);
    this.create_vrml_plane(
      this.m_OutputPCB,
      P.VRML_COLOR_BOT_SILK,
      this.m_bot_silk,
      this.GetLayerZ(B_SilkS),
      false,
    );

    return WriteVRML(this.m_OutputPCB.GetRawPtr(), true, true);
  }

  // Build the Z position of 3D layers
  private ComputeLayer3D_Zpos(): void {
    const copper_layers = this.m_board.GetCopperLayerCount();

    // We call it 'layer' thickness, but it's the whole board thickness!
    this.m_brd_thickness =
      this.m_board.GetDesignSettings().GetBoardThickness() * this.m_BoardToVrmlScale;
    const half_thickness = this.m_brd_thickness / 2;

    // Compute each layer's Z value, more or less like the 3d view
    let orderFromTop = 0;

    for (const layer of LSET.AllCuMask(copper_layers).CuStack()) {
      this.SetLayerZ(
        layer,
        half_thickness - (this.m_brd_thickness * orderFromTop) / (copper_layers - 1),
      );
      orderFromTop++;
    }

    // To avoid rounding interference, we apply an epsilon to each successive layer
    const epsilon_z = pcbIUScale.mmToIU(ART_OFFSET) * this.m_BoardToVrmlScale;
    this.SetLayerZ(B_Paste, -half_thickness - epsilon_z);
    this.SetLayerZ(B_Adhes, -half_thickness - epsilon_z);
    this.SetLayerZ(B_SilkS, -half_thickness - epsilon_z * 3);
    this.SetLayerZ(B_Mask, -half_thickness - epsilon_z * 2);
    this.SetLayerZ(F_Mask, half_thickness + epsilon_z * 2);
    this.SetLayerZ(F_SilkS, half_thickness + epsilon_z * 3);
    this.SetLayerZ(F_Adhes, half_thickness + epsilon_z);
    this.SetLayerZ(F_Paste, half_thickness + epsilon_z);
    this.SetLayerZ(Dwgs_User, half_thickness + epsilon_z * 5);
    this.SetLayerZ(Cmts_User, half_thickness + epsilon_z * 6);
    this.SetLayerZ(Eco1_User, half_thickness + epsilon_z * 7);
    this.SetLayerZ(Eco2_User, half_thickness + epsilon_z * 8);
    this.SetLayerZ(Edge_Cuts, 0);
  }

  // Export a set of polygons without holes.
  // Polygons in SHAPE_POLY_SET must be without hole, i.e. holes must be linked
  // previously to their main outline.
  private ExportVrmlPolygonSet(aVlayer: VRML_LAYER, aOutlines: SHAPE_POLY_SET): void {
    for (let icnt = 0; icnt < aOutlines.OutlineCount(); icnt++) {
      const outline = aOutlines.COutline(icnt);

      const seg = aVlayer.NewContour();

      for (let jj = 0; jj < outline.PointCount(); jj++) {
        if (
          !aVlayer.AddVertex(
            seg,
            outline.CPoint(jj).x * this.m_BoardToVrmlScale,
            -outline.CPoint(jj).y * this.m_BoardToVrmlScale,
          )
        )
          throw new Error(aVlayer.GetError());
      }

      aVlayer.EnsureWinding(seg, false);
    }
  }

  // Build and exports the board outlines (board body)
  private ExportVrmlBoard(): void {
    // wxLogWarning: "Board outline is malformed. Run DRC for a full analysis."
    this.m_board.GetBoardPolygonOutlines(this.m_pcbOutlines, true);

    let seg: number;

    for (let cnt = 0; cnt < this.m_pcbOutlines.OutlineCount(); cnt++) {
      const outline = this.m_pcbOutlines.COutline(cnt);

      seg = this.m_3D_board.NewContour();

      for (let j = 0; j < outline.PointCount(); j++) {
        this.m_3D_board.AddVertex(
          seg,
          outline.CPoint(j).x * this.m_BoardToVrmlScale,
          -(outline.CPoint(j).y * this.m_BoardToVrmlScale),
        );
      }

      this.m_3D_board.EnsureWinding(seg, false);

      // Generate board holes from outlines:
      for (let ii = 0; ii < this.m_pcbOutlines.HoleCount(cnt); ii++) {
        const hole = this.m_pcbOutlines.CHole(cnt, ii);

        seg = this.m_holes.NewContour();

        // wxLogError: "VRML Export Failed: Could not add holes to contours."
        if (seg < 0) return;

        for (let j = 0; j < hole.PointCount(); j++) {
          this.m_holes.AddVertex(
            seg,
            hole.CPoint(j).x * this.m_BoardToVrmlScale,
            -(hole.CPoint(j).y * this.m_BoardToVrmlScale),
          );
        }

        this.m_holes.EnsureWinding(seg, true);
      }
    }
  }

  // Export all via holes
  private ExportVrmlViaHoles(): void {
    for (const track of this.m_board.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;

      const [top_layer, bottom_layer] = via.LayerPair();

      // do not render a buried via
      if (top_layer !== F_Cu && bottom_layer !== B_Cu) continue;

      // Export all via holes to m_holes
      const hole_radius = (via.GetDrillValue() * this.m_BoardToVrmlScale) / 2.0;

      if (hole_radius <= 0) continue;

      const x = via.GetStart().x * this.m_BoardToVrmlScale;
      const y = via.GetStart().y * this.m_BoardToVrmlScale;

      // Set the optimal number of segments to approximate a circle.
      // SetArcParams needs a count max, and the minimal and maximal length
      // of segments
      let max_error = ERR_APPROX_MAX_MM;

      if (this.m_UseInlineModelsInBrdfile) max_error /= 2.54; // The board is exported with a size reduced by 2.54

      const nsides = GetArcToSegmentCount(
        via.GetDrillValue(),
        pcbIUScale.mmToIU(max_error),
        FULL_CIRCLE,
      );

      const minSegLength = (Math.PI * 2.0 * hole_radius) / nsides;
      const maxSegLength = minSegLength * 2.0;

      this.m_holes.SetArcParams(nsides * 2, minSegLength, maxSegLength);
      this.m_plated_holes.SetArcParams(nsides * 2, minSegLength, maxSegLength);

      this.m_holes.AddCircle(x, -y, hole_radius, true, true);
      this.m_plated_holes.AddCircle(x, -y, hole_radius, true, false);

      this.m_holes.ResetArcParams();
      this.m_plated_holes.ResetArcParams();
    }
  }

  private ExportVrmlPadHole(aPad: PAD): void {
    const hole_drill_w = (aPad.GetDrillSize().x * this.m_BoardToVrmlScale) / 2.0;
    const hole_drill_h = (aPad.GetDrillSize().y * this.m_BoardToVrmlScale) / 2.0;
    const hole_drill = Math.min(hole_drill_w, hole_drill_h);
    const hole_x = aPad.GetPosition().x * this.m_BoardToVrmlScale;
    const hole_y = aPad.GetPosition().y * this.m_BoardToVrmlScale;

    // Export the hole on the edge layer
    if (hole_drill > 0) {
      let max_error = ERR_APPROX_MAX_MM;

      if (this.m_UseInlineModelsInBrdfile) max_error /= 2.54; // The board is exported with a size reduced by 2.54

      const nsides = GetArcToSegmentCount(hole_drill, pcbIUScale.mmToIU(max_error), FULL_CIRCLE);
      const minSegLength = (Math.PI * hole_drill) / nsides;
      const maxSegLength = minSegLength * 2.0;

      this.m_holes.SetArcParams(nsides * 2, minSegLength, maxSegLength);
      this.m_plated_holes.SetArcParams(nsides * 2, minSegLength, maxSegLength);

      let pth = false;

      if (aPad.GetAttribute() !== PAD_ATTRIB.NPTH) pth = true;

      const angle = aPad.GetOrientation().AsDegrees();

      if (aPad.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG) {
        // Oblong hole (slot)
        if (pth) {
          this.m_holes.AddSlot(
            hole_x,
            -hole_y,
            hole_drill_w * 2.0 + PLATE_OFFSET,
            hole_drill_h * 2.0 + PLATE_OFFSET,
            angle,
            true,
            true,
          );

          this.m_plated_holes.AddSlot(
            hole_x,
            -hole_y,
            hole_drill_w * 2.0,
            hole_drill_h * 2.0,
            angle,
            true,
            false,
          );
        } else {
          this.m_holes.AddSlot(
            hole_x,
            -hole_y,
            hole_drill_w * 2.0,
            hole_drill_h * 2.0,
            angle,
            true,
            false,
          );
        }
      } else {
        // Drill a round hole
        if (pth) {
          this.m_holes.AddCircle(hole_x, -hole_y, hole_drill + PLATE_OFFSET, true, true);
          this.m_plated_holes.AddCircle(hole_x, -hole_y, hole_drill, true, false);
        } else {
          this.m_holes.AddCircle(hole_x, -hole_y, hole_drill, true, false);
        }
      }

      this.m_holes.ResetArcParams();
      this.m_plated_holes.ResetArcParams();
    }
  }

  private ExportVrmlFootprint(aFootprint: FOOTPRINT): void {
    // Export pad holes
    for (const pad of aFootprint.Pads()) this.ExportVrmlPadHole(pad);

    if (!this.m_includeUnspecified && !(aFootprint.GetAttributes() & (FP_THROUGH_HOLE | FP_SMD)))
      return;

    if (!this.m_includeDNP && aFootprint.GetDNPForVariant(this.m_board.GetCurrentVariant())) return;

    const isFlipped = aFootprint.GetLayer() === B_Cu;

    // Export the object VRML model(s)
    for (const sM of aFootprint.Models()) {
      if (!sM.m_Show) continue;

      const mod3d = this.m_Cache3Dmodels?.Load(sM.m_Filename, '') ?? null;

      /* Calculate 3D shape rotation:
       * this is the rotation parameters, with an additional 180 deg rotation
       * for footprints that are flipped
       * When flipped, axis rotation is the horizontal axis (X axis)
       */
      let rotx = -sM.m_Rotation.x;
      let roty = -sM.m_Rotation.y;
      let rotz = -sM.m_Rotation.z;

      if (isFlipped) {
        rotx += 180.0;
        roty = -roty;
        rotz = -rotz;
      }

      // Do some quaternion munching
      const q1 = [0, 0, 0, 0];
      const q2 = [0, 0, 0, 0];
      const rot = [0, 0, 0, 0];
      const DEG2RAD = (d: number): number => (d * Math.PI) / 180.0;
      build_quat(1, 0, 0, DEG2RAD(rotx), q1);
      build_quat(0, 1, 0, DEG2RAD(roty), q2);
      compose_quat(q1, q2, q1);
      build_quat(0, 0, 1, DEG2RAD(rotz), q2);
      compose_quat(q1, q2, q1);

      // Note here aFootprint->GetOrientation() is in 0.1 degrees, so footprint rotation
      // has to be converted to radians
      build_quat(0, 0, 1, aFootprint.GetOrientation().AsRadians(), q2);
      compose_quat(q1, q2, q1);
      from_quat(q1, rot);

      const offsetFactor = (1000.0 * pcbIUScale.IU_PER_MILS) / f32(25.4);

      // adjust 3D shape local offset position
      // they are given in mm, so they are converted in board IU.
      let offsetx = sM.m_Offset.x * offsetFactor;
      let offsety = sM.m_Offset.y * offsetFactor;
      let offsetz = sM.m_Offset.z * offsetFactor;

      if (isFlipped) offsetz = -offsetz;
      else offsety = -offsety; // In normal mode, Y axis is reversed in Pcbnew.

      const r = RotatePointD({ x: offsetx, y: offsety }, aFootprint.GetOrientation());
      offsetx = r.x;
      offsety = r.y;

      const trans = new SGPOINT(
        (offsetx + aFootprint.GetPosition().x) * this.m_BoardToVrmlScale + this.m_tx,
        -(offsety + aFootprint.GetPosition().y) * this.m_BoardToVrmlScale - this.m_ty,
        offsetz * this.m_BoardToVrmlScale + this.GetLayerZ(aFootprint.GetLayer()),
      );

      if (mod3d === null) continue;

      const modelShape = new IFSG_TRANSFORM(this.m_OutputPCB.GetRawPtr());

      // only write a rotation if it is >= 0.1 deg
      if (Math.abs(rot[3]!) > 0.0001745)
        modelShape.SetRotation(new SGVECTOR(rot[0], rot[1], rot[2]), rot[3]!);

      modelShape.SetTranslation(trans);
      modelShape.SetScale(new SGPOINT(sM.m_Scale.x, sM.m_Scale.y, sM.m_Scale.z));

      if (GetSGNodeParent(mod3d) === null) {
        this.m_components.push(mod3d);
        modelShape.AddChildNode(mod3d);
      } else {
        modelShape.AddRefNode(mod3d);
      }
    }
  }

  /**
   * `ExportVRML_File`: the board's VRML text, or null with aMessages[0] saying why.
   * aMMtoWRMLunit is 1 for millimetres, 0.001 for metres; aXRef / aYRef (mm) is the board
   * point that becomes the origin.
   */
  ExportVRML_File(
    aMessages: string[],
    aMMtoWRMLunit: number,
    aIncludeUnspecified: boolean,
    aIncludeDNP: boolean,
    aExport3DFiles: boolean,
    aUseRelativePaths: boolean,
    a3D_Subdir: string,
    aXRef: number,
    aYRef: number,
  ): string | null {
    if (aExport3DFiles) {
      aMessages.push('VRML export with 3D model files in a folder is not supported yet.');
      return null;
    }

    this.SetScale(aMMtoWRMLunit);
    this.m_UseInlineModelsInBrdfile = aExport3DFiles;
    this.m_Subdir3DFpModels = a3D_Subdir;
    this.m_UseRelPathIn3DModelFilename = aUseRelativePaths;
    this.m_includeUnspecified = aIncludeUnspecified;
    this.m_includeDNP = aIncludeDNP;

    // When 3D models are separate files, for historical reasons the VRML unit
    // is expected to be 0.1 inch (2.54mm) instead of 1mm, so we adjust the m_BoardToVrmlScale
    // to match the VRML scale of these external files.
    // Otherwise we use 1mm as VRML unit
    this.m_BoardToVrmlScale = pcbIUScale.MM_PER_IU;
    this.SetOffset(-aXRef, aYRef);

    try {
      // Preliminary computation: the z value for each layer
      this.ComputeLayer3D_Zpos();

      // board edges and cutouts
      this.ExportVrmlBoard();

      // Draw solder mask layer (negative layer)
      this.ExportVrmlSolderMask();
      this.ExportVrmlViaHoles();
      this.ExportStandardLayers();

      // merge footprints in the .vrml board file
      for (const footprint of this.m_board.Footprints()) this.ExportVrmlFootprint(footprint);

      // write out the board and all layers
      return this.writeLayers();
    } catch (e) {
      aMessages.push(`VRML Export Failed:\n${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private getSGColor(colorIdx: VRML_COLOR_INDEX): SGNODE | null {
    let idx = colorIdx;

    if (idx === VRML_COLOR_INDEX.VRML_COLOR_NONE) idx = VRML_COLOR_INDEX.VRML_COLOR_PCB;
    else if (idx === VRML_COLOR_INDEX.VRML_COLOR_LAST) return null;

    if (this.m_sgmaterial[idx]) return this.m_sgmaterial[idx]!;

    const vcolor = new IFSG_APPEARANCE(null);
    const cp = this.vrml_colors_list[idx]!;

    vcolor.SetSpecular(cp.spec_red, cp.spec_grn, cp.spec_blu);
    vcolor.SetDiffuse(cp.diffuse_red, cp.diffuse_grn, cp.diffuse_blu);
    vcolor.SetShininess(cp.shiny);
    // NOTE: XXX - replace with a better equation; using this definition
    // of ambient will not yield the best results
    vcolor.SetAmbient(cp.ambient, cp.ambient, cp.ambient);
    vcolor.SetTransparency(cp.transp);

    this.m_sgmaterial[idx] = vcolor.GetRawPtr();

    return this.m_sgmaterial[idx]!;
  }

  private create_vrml_plane(
    PcbOutput: IFSG_TRANSFORM,
    colorID: VRML_COLOR_INDEX,
    layer: VRML_LAYER,
    top_z: number,
    aTopPlane: boolean,
  ): void {
    const vertices: number[] = [];
    const idxPlane: number[] = [];

    if (!layer.Get2DTriangles(vertices, idxPlane, top_z, aTopPlane)) return;

    if (idxPlane.length % 3)
      throw new Error('[BUG] index lists are not a multiple of 3 (not a triangle list)');

    const vlist: SGPOINT[] = [];
    const nvert = vertices.length / 3;

    for (let i = 0, j = 0; i < nvert; ++i, j += 3)
      vlist.push(new SGPOINT(vertices[j]!, vertices[j + 1]!, vertices[j + 2]!));

    // create the intermediate scenegraph
    const tx0 = new IFSG_TRANSFORM(PcbOutput.GetRawPtr()); // tx0 = Transform for this outline
    const shape = new IFSG_SHAPE(tx0); // shape will hold (a) all vertices and (b) a local list of normals
    const face = new IFSG_FACESET(shape); // this face shall represent the top and bottom planes
    const cp = new IFSG_COORDS(face); // coordinates for all faces
    cp.SetCoordsList(vlist);
    const coordIdx = new IFSG_COORDINDEX(face); // coordinate indices for top and bottom planes only
    coordIdx.SetIndices(idxPlane);
    const norms = new IFSG_NORMALS(face); // normals for the top and bottom planes

    // set the normals
    if (aTopPlane) {
      for (let i = 0; i < nvert; ++i) norms.AddNormal(0.0, 0.0, 1.0);
    } else {
      for (let i = 0; i < nvert; ++i) norms.AddNormal(0.0, 0.0, -1.0);
    }

    // assign a color from the palette
    const modelColor = this.getSGColor(colorID);

    if (modelColor !== null) {
      if (GetSGNodeParent(modelColor) === null) shape.AddChildNode(modelColor);
      else shape.AddRefNode(modelColor);
    }
  }

  private create_vrml_shell(
    PcbOutput: IFSG_TRANSFORM,
    colorID: VRML_COLOR_INDEX,
    layer: VRML_LAYER,
    aTop_z: number,
    aBottom_z: number,
  ): void {
    const vertices: number[] = [];
    const idxPlane: number[] = [];
    const idxSide: number[] = [];

    let top_z = aTop_z;
    let bottom_z = aBottom_z;

    if (top_z < bottom_z) [top_z, bottom_z] = [bottom_z, top_z];

    if (
      !layer.Get3DTriangles(vertices, idxPlane, idxSide, top_z, bottom_z) ||
      idxPlane.length === 0 ||
      idxSide.length === 0
    ) {
      return;
    }

    if (idxPlane.length % 3 || idxSide.length % 3)
      throw new Error('[BUG] index lists are not a multiple of 3 (not a triangle list)');

    const vlist: SGPOINT[] = [];
    const nvert = vertices.length / 3;

    for (let i = 0, j = 0; i < nvert; ++i, j += 3)
      vlist.push(new SGPOINT(vertices[j]!, vertices[j + 1]!, vertices[j + 2]!));

    // create the intermediate scenegraph
    const tx0 = new IFSG_TRANSFORM(PcbOutput.GetRawPtr()); // tx0 = Transform for this outline
    const shape = new IFSG_SHAPE(tx0); // shape will hold (a) all vertices and (b) a local list of normals
    const face = new IFSG_FACESET(shape); // this face shall represent the top and bottom planes
    const cp = new IFSG_COORDS(face); // coordinates for all faces
    cp.SetCoordsList(vlist);
    const coordIdx = new IFSG_COORDINDEX(face); // coordinate indices for top and bottom planes only
    coordIdx.SetIndices(idxPlane);
    const norms = new IFSG_NORMALS(face); // normals for the top and bottom planes

    // number of TOP (and bottom) vertices
    const half = nvert / 2;

    // set the TOP normals
    for (let i = 0; i < half; ++i) norms.AddNormal(0.0, 0.0, 1.0);

    // set the BOTTOM normals
    for (let i = 0; i < half; ++i) norms.AddNormal(0.0, 0.0, -1.0);

    // assign a color from the palette
    const modelColor = this.getSGColor(colorID);

    if (modelColor !== null) {
      if (GetSGNodeParent(modelColor) === null) shape.AddChildNode(modelColor);
      else shape.AddRefNode(modelColor);
    }

    // create a second shape describing the vertical walls of the extrusion
    // using per-vertex-per-face-normals
    shape.NewNode(tx0);
    shape.AddRefNode(modelColor); // set the color to be the same as the top/bottom
    face.NewNode(shape);
    cp.NewNode(face); // new vertex list
    norms.NewNode(face); // new normals list
    coordIdx.NewNode(face); // new index list

    // populate the new per-face vertex list and its indices and normals
    let sidx = 0; // index to the new coord set

    for (let k = 0; k < idxSide.length; ) {
      const p1 = vlist[idxSide[k++]!]!;
      cp.AddCoord(p1);

      const p2 = vlist[idxSide[k++]!]!;
      cp.AddCoord(p2);

      const p3 = vlist[idxSide[k++]!]!;
      cp.AddCoord(p3);

      const vnorm = new SGVECTOR();
      vnorm.SetVector(CalcTriNorm(p1, p2, p3));
      norms.AddNormal(vnorm);
      norms.AddNormal(vnorm);
      norms.AddNormal(vnorm);

      coordIdx.AddIndex(sidx);
      ++sidx;
      coordIdx.AddIndex(sidx);
      ++sidx;
      coordIdx.AddIndex(sidx);
      ++sidx;
    }
  }
}

/** `EXPORTER_VRML`: the public face of EXPORTER_PCB_VRML. */
export class EXPORTER_VRML {
  private pcb_exporter: EXPORTER_PCB_VRML;

  constructor(aBoard: BOARD) {
    this.pcb_exporter = new EXPORTER_PCB_VRML(aBoard);
  }

  /** The exporter's model source, or null to skip every model. */
  SetModelCache(aCache: S3D_CACHE | null): void {
    this.pcb_exporter.m_Cache3Dmodels = aCache;
  }

  ExportVRML_File(
    aMessages: string[],
    aMMtoWRMLunit: number,
    aIncludeUnspecified: boolean,
    aIncludeDNP: boolean,
    aExport3DFiles: boolean,
    aUseRelativePaths: boolean,
    a3D_Subdir: string,
    aXRef: number,
    aYRef: number,
  ): string | null {
    return this.pcb_exporter.ExportVRML_File(
      aMessages,
      aMMtoWRMLunit,
      aIncludeUnspecified,
      aIncludeDNP,
      aExport3DFiles,
      aUseRelativePaths,
      a3D_Subdir,
      aXRef,
      aYRef,
    );
  }
}
