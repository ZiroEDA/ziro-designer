// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerber_file_image.h` + `.cpp`: `GERBER_FILE_IMAGE`, the data and
 * parameters of one Gerber file (an "image"), and `GERBER_LAYER`, the subset
 * of parameters that are layer specific.
 *
 * "In Gerber world an image is the entire gerber file and its global
 * parameters; a layer (very different from a board layer) is just a sub set of
 * a file that have specific parameters."
 *
 * The class's reader methods are defined upstream in the files that read each
 * part of the format, and so are they here: the bodies live in readgerb.ts,
 * rs274x.ts, rs274d.ts and rs274_read_XY_and_IJ_coordinates.ts, taking the
 * image as their first argument, and the methods below call them. The members
 * C++ keeps `private` for those friends are public here for the same reason.
 *
 * Browser divergences: a file is text in memory, so `LoadGerberFile` and
 * `TestFileIsRS274` take the text beside the name, and `m_Current_File` is a
 * `FILE` over it (libc.ts).
 */
import { EDA_ITEM, INSPECT_RESULT, type INSPECTOR } from '@ziroeda/common/eda_item.js';
import { type Color4d, COLOR4D_WHITE } from '@ziroeda/common/color4d.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { APERTURE_MACRO, APERTURE_MACRO_SET } from './aperture_macro.js';
import { D_CODE } from './dcode.js';
import { GBR_NETLIST_METADATA } from './gbr_netlist_metadata.js';
import { GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import { Gerb_Interpolation, gerbIUScale } from './gerbview.js';
import { type CHAR_PTR, type FILE, LINE_BUFFER } from './libc.js';
import { LoadGerberFile, TestFileIsRS274 } from './readgerb.js';
import { CodeNumber, Execute_DCODE_Command, Execute_G_Command } from './rs274d.js';
import {
  ExecuteRS274XCommand,
  GetEndOfBlock,
  GetNextLine,
  ReadApertureMacro,
  ReadRS274XCommand,
  ReadXCommandID,
} from './rs274x.js';
import { ReadIJCoord, ReadXYCoord, scaletoIU } from './rs274_read_XY_and_IJ_coordinates.js';
import type { X2_ATTRIBUTE, X2_ATTRIBUTE_FILEFUNCTION } from './X2_gerber_attributes.js';

/** `GERBER_DRAW_ITEMS`. */
export type GERBER_DRAW_ITEMS = GERBER_DRAW_ITEM[];

/**
 * `LAST_EXTRA_ARC_DATA_TYPE`: for arcs, the last extra coordinate read — an
 * `I`/`J` centre, or (Excellon) an `A` radius.
 */
export enum LAST_EXTRA_ARC_DATA_TYPE {
  ARC_INFO_TYPE_NONE,
  /** last info is a IJ command: arc center is given */
  ARC_INFO_TYPE_CENTER,
  /** last info is a A command: arc radius is given */
  ARC_INFO_TYPE_RADIUS,
}

/**
 * `GERBER_BUFZ`: the max size of a single line of text from a gerber file.
 * "I saw a file using only one line of 1,400,000 chars." [data]
 */
export const GERBER_BUFZ = 5000000;

/** `GERBER_LAYER`: the parameters that are layer specific. */
export class GERBER_LAYER {
  /** Layer name, from LN <name>* command. */
  m_LayerName = '';
  /** true = Negative Layer: command LP. */
  m_LayerNegative = false;
  /** X and Y offsets for Step and Repeat command (`wxRealPoint`). */
  m_StepForRepeat = { x: 0, y: 0 };
  /** The repeat count on X axis. */
  m_XRepeatCount = 1;
  /** The repeat count on Y axis. */
  m_YRepeatCount = 1;
  /**
   * false = Inches, true = metric; needed here because repeated gerber items
   * can have coordinates in different units than step parameters.
   */
  m_StepForRepeatMetric = false;

  constructor() {
    this.ResetDefaultValues();
  }

  /** Private upstream, called by its friend GERBER_FILE_IMAGE. */
  ResetDefaultValues(): void {
    this.m_LayerName = 'no name'; // Layer name from the LN command
    this.m_LayerNegative = false; // true = Negative Layer
    this.m_StepForRepeat = { x: 0, y: 0 }; // X and Y offsets for Step and Repeat command
    this.m_XRepeatCount = 1; // The repeat count on X axis
    this.m_YRepeatCount = 1; // The repeat count on Y axis
    this.m_StepForRepeatMetric = false; // false = Inches, true = metric
  }
}

/** What `DisplayImageInfo` writes to: the frame's message panel. */
export interface GBR_MSG_PANEL_FRAME {
  ClearMsgPanel(): void;
  AppendMsgPanel(aTextUpper: string, aTextLower: string): void;
  MessageTextFromValue(aValue: number): string;
}

/** Hold the image data and parameters for one gerber file and layer parameters. */
export class GERBER_FILE_IMAGE extends EDA_ITEM {
  /** true if this image is currently in use (a file is loaded in it). */
  m_InUse = false;
  /** The color used to draw positive items. */
  m_PositiveDrawColor: Color4d = COLOR4D_WHITE;
  /** Full File Name for this layer. */
  m_FileName = '';
  /** Image name, from IN <name>* command. */
  m_ImageName = '';
  /** True if a X2 gerber attribute was found in file. */
  m_IsX2_file = false;
  /** File function parameters, found in a %TF command or a G04. */
  m_FileFunction: X2_ATTRIBUTE_FILEFUNCTION | null = null;
  /** MD5 value found in a %TF.MD5 command. */
  m_MD5_value = '';
  /** String found in a %TF.Part command. */
  m_PartString = '';
  /** Graphic layer Number. */
  m_GraphicLayer: number;
  /** true = Negative image. */
  m_ImageNegative = false;
  /** Image Justify Center on X axis (default = false). */
  m_ImageJustifyXCenter = false;
  /** Image Justify Center on Y axis (default = false). */
  m_ImageJustifyYCenter = false;
  /** Image Justify Offset on XY axis (default = 0,0). */
  m_ImageJustifyOffset: VECTOR2I = { x: 0, y: 0 };
  /** false = Inches, true = metric. */
  m_GerbMetric = false;
  /** false = absolute Coord, true = relative Coord. */
  m_Relative = false;
  /** true: remove tailing zeros. */
  m_NoTrailingZeros = false;
  /** Coord Offset, from IO command. */
  m_ImageOffset: VECTOR2I = { x: 0, y: 0 };
  /** Fmt 2.3: m_FmtScale = 3, fmt 3.4: m_FmtScale = 4. */
  m_FmtScale = { x: 4, y: 4 };
  /** Nb chars per coord. ex fmt 2.3, m_FmtLen = 5. */
  m_FmtLen = { x: 7, y: 7 };
  /** Image rotation (0, 90, 180, 270 only) in degrees. */
  m_ImageRotation = 0;
  /** Local rotation added to m_ImageRotation (from the RO command, in degrees). */
  m_LocalRotation = 0;
  /** Coord Offset, from OF command. */
  m_Offset: VECTOR2I = { x: 0, y: 0 };
  /** scale (X and Y) of layer (a VECTOR2I upstream, so whole numbers: see SF). */
  m_Scale = { x: 1, y: 1 };
  /** false if A = X and B = Y (default); true if A = Y, B = X. */
  m_SwapAxis = false;
  /** true: mirror / axis A (X). */
  m_MirrorA = false;
  /** true: mirror / axis B (Y). */
  m_MirrorB = false;
  /** Linear, 90 arc, Circ. */
  m_Iterpolation: number = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X;
  /** Current Tool (Dcode) number selected. */
  m_Current_Tool = 0;
  /** Current or last pen state (0..9, set by Dn option with n < 10). */
  m_Last_Pen_Command = 0;
  /** State of gerber analysis command. */
  m_CommandState = 0;
  /** Line number of the gerber file while reading. */
  m_LineNum = 0;
  /** Current specified coord for plot. */
  m_CurrentPos: VECTOR2I = { x: 0, y: 0 };
  /** Old current specified coord for plot. */
  m_PreviousPos: VECTOR2I = { x: 0, y: 0 };
  /** IJ coord (for arcs & circles). */
  m_IJPos: VECTOR2I = { x: 0, y: 0 };
  /** True if a IJ coord was read (for arcs & circles). */
  m_LastCoordIsIJPos = false;
  /** A value (= radius in circular routing in Excellon files). */
  m_ArcRadius = 0;
  /** Identifier for arc data type (IJ (center) or A## (radius)). */
  m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_NONE;
  /** Current file to read. */
  m_Current_File: FILE | null = null;
  /** For highlight: current selected Dcode. */
  m_Selected_Tool = 0;
  /** True if has DCodes in file or false if no DCodes found (perhaps a RS274D file). */
  m_Has_DCode = false;
  /** true = some DCodes in file are not defined (broken file or deprecated RS274D file). */
  m_Has_MissingDCode = false;
  /** Enable 360 deg circular interpolation. */
  m_360Arc_enbl = true;
  /** Set to true when a G74 or G75 command is found; mandatory before an arc. */
  m_AsArcG74G75Cmd = false;
  /** Enable polygon mode (read coord as a polygon descr). */
  m_PolygonFillMode = false;
  /** In polygon mode: 0 = first segm, 1 = next segm. */
  m_PolygonFillModeState = 0;
  /** A collection of APERTURE_MACROS, by name. */
  m_aperture_macros: APERTURE_MACRO_SET = new Map();
  /** The net attributes set by a %TO.CN, %TO.C and/or %TO.N add object attribute command. */
  m_NetAttributeDict = new GBR_NETLIST_METADATA();
  /** The aperture function set by a %TA.AperFunction, xxx (the xxx value). */
  m_AperFunction = '';
  /** List of components (`std::map`: iterate sorted, see SortedKeys). */
  m_ComponentsList = new Map<string, number>();
  /** List of net names (`std::map`: iterate sorted, see SortedKeys). */
  m_NetnamesList = new Map<string, number>();
  /** Dcode (Aperture) List for this layer (`std::map<int, D_CODE*>`). */
  m_ApertureList = new Map<number, D_CODE>();
  /** Whether an aperture macro tool is flashed on or off. */
  m_Exposure = false;
  /** Hold params for the current gerber layer. */
  m_GBRLayerParams = new GERBER_LAYER();
  /** Linked list of Gerber Items to draw. */
  m_drawings: GERBER_DRAW_ITEMS = [];
  /** true when inside an SR block with repeat count > 1. */
  m_SRBlockCollecting = false;
  /** Index into m_drawings where the current SR block begins. */
  m_SRBlockStartIdx = 0;
  /** Parameters used only to draw (display) items on this layer. */
  m_DisplayOffset: VECTOR2I = { x: 0, y: 0 };
  m_DisplayRotation: EDA_ANGLE = ANGLE_0;
  /** A large buffer to store one line (`static char m_LineBuffer[GERBER_BUFZ+1]`). */
  static readonly m_LineBuffer = new LINE_BUFFER();

  /** A list of messages created when reading a file. */
  private m_messagesList: string[] = [];
  /** -1: not yet searched; 0: no negative items found; 1: negative items found. */
  private m_hasNegativeItems = -1;

  constructor(aLayer: number) {
    super(null, KICAD_T.GERBER_IMAGE_T);
    this.m_GraphicLayer = aLayer; // Graphic layer Number
    this.m_PositiveDrawColor = COLOR4D_WHITE; // The color used to draw positive items

    this.m_Selected_Tool = 0;
    this.m_FileFunction = null; // file function parameters

    // A virtual call in a C++ constructor runs the base class's own version,
    // not a derived override (EXCELLON_IMAGE's); say so explicitly here.
    GERBER_FILE_IMAGE.prototype.ResetDefaultValues.call(this);

    this.m_ApertureList.clear();
  }

  override GetClass(): string {
    return 'GERBER_FILE_IMAGE';
  }

  /**
   * A heuristics-based check of whether the text is an RS274 gerber file,
   * without invoking the full parser.
   */
  static TestFileIsRS274(aFileText: string): boolean {
    return TestFileIsRS274(aFileText);
  }

  /**
   * Read and load a gerber file. If the file cannot be loaded, warning and
   * information messages are stored in m_messagesList.
   */
  LoadGerberFile(aFullFileName: string, aFileText: string | null): boolean {
    return LoadGerberFile(this, aFullFileName, aFileText);
  }

  GetMessages(): readonly string[] {
    return this.m_messagesList;
  }

  /** The count of Dcode tools in use in the image. */
  GetDcodesCount(): number {
    let count = 0;

    for (const dcode of this.m_ApertureList.values()) {
      if (dcode.m_InUse || dcode.m_Defined) count++;
    }

    return count;
  }

  /** Set all parameters to a default value, before reading a file. */
  ResetDefaultValues(): void {
    this.m_InUse = false;
    this.m_GBRLayerParams.ResetDefaultValues();
    this.m_FileName = '';
    this.m_ImageName = ''; // Image name from the IN command (deprecated)
    this.m_ImageNegative = false; // true = Negative image
    this.m_IsX2_file = false; // true only if a %TF, %TA or %TD command
    this.m_FileFunction = null; // file function parameters
    this.m_MD5_value = ''; // MD5 value found in a %TF.MD5 command
    this.m_PartString = ''; // string found in a %TF.Part command
    this.m_hasNegativeItems = -1; // set to uninitialized
    this.m_ImageJustifyOffset = { x: 0, y: 0 }; // Image justify Offset
    this.m_ImageJustifyXCenter = false; // Image Justify Center on X axis (default = false)
    this.m_ImageJustifyYCenter = false; // Image Justify Center on Y axis (default = false)
    this.m_GerbMetric = false; // false = Inches (default), true = metric
    this.m_Relative = false; // false = absolute Coord, true = relative Coord
    this.m_NoTrailingZeros = false; // true: trailing zeros deleted
    this.m_ImageOffset = { x: 0, y: 0 }; // Coord Offset, from IO command
    this.m_ImageRotation = 0; // Allowed 0, 90, 180, 270 (in degree)
    this.m_LocalRotation = 0.0; // Layer rotation from RO command
    this.m_Offset = { x: 0, y: 0 }; // Coord Offset, from OF command
    this.m_Scale = { x: 1, y: 1 }; // scale (A and B) this layer
    this.m_MirrorA = false; // true: mirror / axe A (default = X)
    this.m_MirrorB = false; // true: mirror / axe B (default = Y)
    this.m_SwapAxis = false; // false if A = X, B = Y; true if A =Y, B = Y
    this.m_Has_DCode = false; // true = DCodes in file
    this.m_Has_MissingDCode = false; // true = some D_Codes are used, but not defined
    this.m_FmtScale = { x: 4, y: 4 }; // Initialize default format to 3.4 => 4
    this.m_FmtLen = { x: 3 + 4, y: 3 + 4 }; // Initialize default format len = 3+4

    this.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X; // Linear, 90 arc, Circ.
    this.m_360Arc_enbl = true; // 360 deg circular mode (G75) selected as default
    this.m_AsArcG74G75Cmd = false; // false until a G74 or G75 command is found
    this.m_Current_Tool = 0; // Current Dcode selected
    this.m_CommandState = 0; // State of the current command
    this.m_CurrentPos = { x: 0, y: 0 }; // current specified coord
    this.m_PreviousPos = { x: 0, y: 0 }; // last specified coord
    this.m_IJPos = { x: 0, y: 0 }; // current centre coord for plot arcs & circles
    this.m_LastCoordIsIJPos = false; // True only after a IJ coordinate is read
    this.m_ArcRadius = 0; // radius of arcs in circular interpol (given by A## command).
    this.m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_NONE;
    this.m_LineNum = 0; // line number in file being read
    this.m_Current_File = null; // Gerber file to read
    this.m_PolygonFillMode = false;
    this.m_PolygonFillModeState = 0;
    this.m_Selected_Tool = 0;
    this.m_Last_Pen_Command = 0;
    this.m_Exposure = false;

    this.m_DisplayOffset = { x: 0, y: 0 };
    this.m_DisplayRotation = ANGLE_0;

    this.m_SRBlockCollecting = false;
    this.m_SRBlockStartIdx = 0;
  }

  GetPositiveDrawColor(): Color4d {
    return this.m_PositiveDrawColor;
  }

  /** The GERBER_DRAW_ITEMS list. */
  GetItems(): GERBER_DRAW_ITEMS {
    return this.m_drawings;
  }

  /** The count of GERBER_DRAW_ITEMS in the image. */
  GetItemsCount(): number {
    return this.m_drawings.length;
  }

  AddItemToList(aItem: GERBER_DRAW_ITEM): void {
    this.m_drawings.push(aItem);
  }

  /** The last item of the list (`m_drawings.back()`, UB when empty). */
  GetLastItemInList(): GERBER_DRAW_ITEM | null {
    return this.m_drawings[this.m_drawings.length - 1] ?? null;
  }

  GetLayerParams(): GERBER_LAYER {
    return this.m_GBRLayerParams;
  }

  /**
   * True if at least one item must be drawn in background color; used to
   * optimize screen refresh.
   */
  HasNegativeItems(): boolean {
    if (this.m_hasNegativeItems < 0) {
      // negative items are not yet searched: find them if any
      if (this.m_ImageNegative) {
        // A negative layer is expected having always negative objects.
        this.m_hasNegativeItems = 1;
      } else {
        this.m_hasNegativeItems = 0;

        for (const item of this.GetItems()) {
          if (item.GetLayer() !== this.m_GraphicLayer) continue;

          if (item.HasNegativeItems()) {
            this.m_hasNegativeItems = 1;
            break;
          }
        }
      }
    }

    return this.m_hasNegativeItems === 1;
  }

  /** Clear the message list. Call it before reading a Gerber file. */
  ClearMessageList(): void {
    this.m_messagesList = [];
  }

  /**
   * Add a message to the message list, but only if there are less than
   * max_messages, to avoid very long list (can happen if trying to read a
   * non gerber file).
   */
  AddMessageToList(aMessage: string): void {
    const max_messages = 50; // Arbitrary but reasonable value. [data]

    if (this.m_messagesList.length < max_messages) this.m_messagesList.push(aMessage);
    else if (this.m_messagesList.length === max_messages)
      this.m_messagesList.push('Too many messages, some are skipped');
  }

  ReadXYCoord(aText: CHAR_PTR | null, aExcellonMode = false): VECTOR2I {
    return ReadXYCoord(this, aText, aExcellonMode);
  }

  ReadIJCoord(aText: CHAR_PTR | null): VECTOR2I {
    return ReadIJCoord(this, aText);
  }

  /** Reads the next number and returns the value. */
  CodeNumber(aText: CHAR_PTR): number {
    return CodeNumber(aText);
  }

  /**
   * The D_CODE for `aDCODE`, created if it does not exist and
   * `aCreateIfNoExist`.
   */
  GetDCODEOrCreate(aDCODE: number, aCreateIfNoExist = true): D_CODE | null {
    const it = this.m_ApertureList.get(aDCODE);

    if (it) return it;

    // lazily create the D_CODE if it does not exist.
    if (aCreateIfNoExist) {
      const dcode = new D_CODE(aDCODE);
      this.m_ApertureList.set(aDCODE, dcode);
      return dcode;
    }

    return null;
  }

  /** The D_CODE for `aDCODE`, or null. */
  GetDCODE(aDCODE: number): D_CODE | null {
    return this.m_ApertureList.get(aDCODE) ?? null;
  }

  /** A previously read aperture macro with the lookup's name, or null. */
  FindApertureMacro(aLookup: APERTURE_MACRO): APERTURE_MACRO | null {
    return this.m_aperture_macros.get(aLookup.m_AmName) ?? null;
  }

  /**
   * Gerber's Step and Repeat, for one item: called after creating a new
   * item that must be repeated. A no-op while an SR block is collecting,
   * because the whole block is replicated when it closes.
   */
  StepAndRepeatItem(aItem: GERBER_DRAW_ITEM): void {
    // When collecting items for a block-level SR replication, individual item
    // replication is deferred until the SR block is closed.
    if (this.m_SRBlockCollecting) return;

    const params = this.GetLayerParams();

    if (params.m_XRepeatCount < 2 && params.m_YRepeatCount < 2) return; // Nothing to repeat

    // Duplicate item:
    for (let ii = 0; ii < params.m_XRepeatCount; ii++) {
      for (let jj = 0; jj < params.m_YRepeatCount; jj++) {
        // the first gerber item already exists (this is the template)
        // create duplicate only if ii or jj > 0
        if (jj === 0 && ii === 0) continue;

        const dupItem = new GERBER_DRAW_ITEM(aItem);
        const move_vector: VECTOR2I = {
          x: scaletoIU(ii * params.m_StepForRepeat.x, params.m_StepForRepeatMetric),
          y: scaletoIU(jj * params.m_StepForRepeat.y, params.m_StepForRepeatMetric),
        };
        dupItem.MoveXY(move_vector);
        this.AddItemToList(dupItem);
      }
    }
  }

  /**
   * Called when an SR block is closed (%SR*%): "all objects within an SR
   * statement must be collected first, then the combined block replicated as
   * a unit" (Gerber specification section 4.12).
   */
  FinishStepAndRepeatBlock(): void {
    if (!this.m_SRBlockCollecting) return;

    this.m_SRBlockCollecting = false;

    const params = this.GetLayerParams();

    if (params.m_XRepeatCount < 2 && params.m_YRepeatCount < 2) return;

    const blockSize = this.m_drawings.length - this.m_SRBlockStartIdx;

    if (blockSize <= 0) return;

    // Replicate the entire collected block for each SR copy (skipping the 0,0 original)
    for (let ii = 0; ii < params.m_XRepeatCount; ii++) {
      for (let jj = 0; jj < params.m_YRepeatCount; jj++) {
        if (jj === 0 && ii === 0) continue;

        const move_vector: VECTOR2I = {
          x: scaletoIU(ii * params.m_StepForRepeat.x, params.m_StepForRepeatMetric),
          y: scaletoIU(jj * params.m_StepForRepeat.y, params.m_StepForRepeatMetric),
        };

        for (let kk = 0; kk < blockSize; kk++) {
          const src = this.m_drawings[this.m_SRBlockStartIdx + kk] as GERBER_DRAW_ITEM;
          const dupItem = new GERBER_DRAW_ITEM(src);
          dupItem.MoveXY(move_vector);
          this.AddItemToList(dupItem);
        }
      }
    }
  }

  /**
   * Display information about the image parameters in the message panel.
   * "These parameters are valid for the entire file, and must set only once
   * (If more than once, only the last value is used). Some are deprecated."
   */
  DisplayImageInfo(aMainFrame: GBR_MSG_PANEL_FRAME): void {
    let msg: string;

    aMainFrame.ClearMsgPanel();

    // Display the Gerber variant (X1 / X2
    aMainFrame.AppendMsgPanel('Format', this.m_IsX2_file ? 'X2' : 'X1');

    // Display Image name (Image specific). IM command (Image Name) is deprecated
    // So non empty image name is very rare, probably never found
    if (this.m_ImageName.length > 0) aMainFrame.AppendMsgPanel('Image name', this.m_ImageName);

    // Display graphic layer number used to draw this Image
    // (not a Gerber parameter but is also image specific)
    msg = `${this.m_GraphicLayer + 1}`;
    aMainFrame.AppendMsgPanel('Graphic layer', msg);

    // Display Image rotation (Image specific)
    msg = `${this.m_ImageRotation}`;
    aMainFrame.AppendMsgPanel('Img Rot.', msg);

    // Display Image polarity (Image specific)
    msg = this.m_ImageNegative ? 'Negative' : 'Normal';
    aMainFrame.AppendMsgPanel('Polarity', msg);

    // Display Image justification and offset for justification (Image specific)
    msg = this.m_ImageJustifyXCenter ? 'Center' : 'Normal';
    aMainFrame.AppendMsgPanel('X Justify', msg);

    msg = this.m_ImageJustifyYCenter ? 'Center' : 'Normal';
    aMainFrame.AppendMsgPanel('Y Justify', msg);

    msg =
      `X=${aMainFrame.MessageTextFromValue(this.m_ImageJustifyOffset.x)} ` +
      `Y=${aMainFrame.MessageTextFromValue(this.m_ImageJustifyOffset.y)}`;

    aMainFrame.AppendMsgPanel('Image Justify Offset', msg);
  }

  /**
   * Set the offset and rotation to draw a file image; does not change any
   * coordinate of the draw items. "Draw transform order is rotation and after
   * offset."
   */
  SetDrawOffetAndRotation(aOffsetMM: { x: number; y: number }, aRotation: EDA_ANGLE): void {
    this.m_DisplayOffset = {
      x: KiROUND(aOffsetMM.x * gerbIUScale.IU_PER_MM),
      y: KiROUND(aOffsetMM.y * gerbIUScale.IU_PER_MM),
    };
    this.m_DisplayRotation = aRotation;

    // Clear m_AbsolutePolygon member of Gerber items, because draw coordinates
    // are now outdated
    for (const item of this.GetItems()) item.m_AbsolutePolygon.RemoveAllContours();
  }

  /**
   * Called when a %TD command is found: remove the attribute it names, or all
   * the %TO / %TA attributes when it names none.
   */
  RemoveAttribute(aAttribute: X2_ATTRIBUTE): void {
    const cmd = aAttribute.GetPrm(0);
    this.m_NetAttributeDict.ClearAttribute(cmd);

    if (cmd.length === 0 || cmd === '.AperFunction') this.m_AperFunction = '';
  }

  override Visit(
    inspector: INSPECTOR,
    testData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.GERBER_DRAW_ITEM_T) {
        if (
          EDA_ITEM.IterateForward(this.GetItems(), inspector, testData, [scanType]) ===
          INSPECT_RESULT.QUIT
        )
          return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  // The reader's own methods, private upstream (see the file comment).

  GetNextLine(
    aBuff: LINE_BUFFER,
    aBuffSize: number,
    aText: CHAR_PTR,
    aFile: FILE | null,
  ): CHAR_PTR | null {
    return GetNextLine(this, aBuff, aBuffSize, aText, aFile);
  }

  GetEndOfBlock(
    aBuff: LINE_BUFFER,
    aBuffSize: number,
    aText: CHAR_PTR,
    aGerberFile: FILE | null,
  ): boolean {
    return GetEndOfBlock(this, aBuff, aBuffSize, aText, aGerberFile);
  }

  ReadRS274XCommand(aBuff: LINE_BUFFER, aBuffSize: number, aText: CHAR_PTR): boolean {
    return ReadRS274XCommand(this, aBuff, aBuffSize, aText);
  }

  ExecuteRS274XCommand(
    aCommand: number,
    aBuff: LINE_BUFFER | null,
    aBuffSize: number,
    aText: CHAR_PTR,
  ): boolean {
    return ExecuteRS274XCommand(this, aCommand, aBuff, aBuffSize, aText);
  }

  ReadXCommandID(text: CHAR_PTR): number {
    return ReadXCommandID(text);
  }

  ReadApertureMacro(
    aBuff: LINE_BUFFER,
    aBuffSize: number,
    text: CHAR_PTR,
    gerber_file: FILE | null,
  ): boolean {
    return ReadApertureMacro(this, aBuff, aBuffSize, text, gerber_file);
  }

  Execute_G_Command(text: CHAR_PTR, G_command: number): boolean {
    return Execute_G_Command(this, text, G_command);
  }

  Execute_DCODE_Command(text: CHAR_PTR, D_command: number): boolean {
    return Execute_DCODE_Command(this, text, D_command);
  }
}

/**
 * The keys of a `std::map<wxString, int>` in the map's own order — the
 * components and net names are shown sorted because the map is.
 */
export function SortedKeys(aMap: ReadonlyMap<string, number>): string[] {
  return [...aMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
