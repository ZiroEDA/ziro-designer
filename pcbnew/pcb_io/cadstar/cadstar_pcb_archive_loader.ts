// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/cadstar/cadstar_pcb_archive_loader.cpp` / `.h`: builds a
 * KiCad BOARD (or a footprint library) from a parsed CADSTAR PCB archive.
 *
 * The C++ copies its structures by value wherever it loops or fetches one
 * (`getPadCode`, the `for( std::pair<…> p : map )` loops); where the copy is
 * then modified this clones, so the parsed archive stays as read.
 *
 * `wxLogWarning` / `wxLogError` / `wxLogMessage` go to wxLog upstream, which
 * is not the import reporter; they are dropped here.
 */

import {
  ALIGNMENT,
  type ATTRIBUTE_ID,
  type ATTRIBUTE_LOCATION,
  ATTRIBUTE_VALUE,
  CADSTAR_TO_KICAD_FIELDS,
  type EDA_TEXT_LIKE,
  COMPONENT_NAME_2_ATTRID,
  COMPONENT_NAME_ATTRID,
  type CUTOUT,
  FixTextPositionNoAlignment,
  FONT_BOLD,
  type GROUP_ID,
  HATCHCODE,
  type HATCHCODE_ID,
  type LAYER_ID,
  LINECODE,
  type LINECODE_ID,
  type NET_ID,
  type NETELEMENT_ID,
  ParseTextFields,
  PART,
  type PART_ID,
  PART_NAME_ATTRID,
  POINT,
  ROUTECODE,
  type ROUTECODE_ID,
  SHAPE,
  SHAPE_TYPE,
  type SPACING_CLASS_ID,
  STD_MAP,
  TEXT,
  TEXT_FIELD_NAME,
  TEXTCODE,
  type TEXTCODE_ID,
  TXT_HEIGHT_RATIO,
  UNDEFINED_VALUE,
  UNITS,
  VERTEX,
  VERTEX_TYPE,
  sortedKeys,
  type SYMDEF_ID,
} from '@ziroeda/common/io/cadstar/cadstar_archive_parser.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IGNORE_PARENT_GROUP } from '@ziroeda/common/eda_item.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import {
  ERROR_LOC,
  RECT_CHAMFER_ALL,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_TOP_LEFT,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import {
  ANGLE_180,
  ANGLE_90,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  TransformArcToPolygon,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, ResizeI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE, type BOARD_ITEM_CONTAINER } from '../../board_item_container.js';
import type { BOARD_ITEM } from '../../board_item.js';
import {
  BOARD_STACKUP_ITEM_TYPE,
  type BOARD_STACKUP_ITEM,
  KEY_CORE,
  KEY_PREPREG,
} from '../../board_stackup_manager/board_stackup.js';
import { LAYER_T } from '../../board_types.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import {
  PCB_DIM_ALIGNED,
  type PCB_DIMENSION_BASE,
  PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
} from '../../pcb_dimension.js';
import { DIM_PRECISION, DIM_UNITS_FORMAT, DIM_UNITS_MODE } from '../../pcb_dimension_types.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import {
  ISLAND_REMOVAL_MODE,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
} from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import type {
  INPUT_LAYER_DESC,
  LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import type { PCB_IO_PROJECT } from '../pcb_io.js';
import {
  CADSTAR_PCB_ARCHIVE_PARSER,
  type COMPONENT,
  type COMPONENT_ID,
  COMPONENT_PAD,
  COPPERCODE,
  type COPPERCODE_ID,
  type DIMENSION,
  DIMENSION_LINE_STYLE,
  DIMENSION_SUBTYPE,
  DIMENSION_TYPE,
  EMBEDDING,
  LAYER_SUBTYPE,
  LAYER_TYPE,
  LAYERPAIR,
  type LAYERPAIR_ID,
  NETSYNCH,
  type NET_PCB,
  type NET_PCB_VIA,
  PADCODE,
  type PADCODE_ID,
  type PAD_ID,
  PAD_SHAPE_TYPE,
  PAD_SIDE,
  type ROUTE,
  type ROUTE_VERTEX,
  type SYMDEF_PCB,
  type TEMPLATE_ID,
  COPPER_FILL_TYPE,
  VIACODE,
  type VIACODE_ID,
} from './cadstar_pcb_archive_parser.js';

const INT_MAX = 2147483647;
const PCB_IU_PER_MM = pcbIUScale.IU_PER_MM;

/** `DEFAULT_SIZE_TEXT` (mils). */
const DEFAULT_SIZE_TEXT = 50;

/** `static_cast<int>` of an integer that fits a long: the low 32 bits. */
const toInt = (v: number): number => Number(BigInt.asIntN(32, BigInt(Math.trunc(v))));

type ASSOCIATED_COPPER_PADS = STD_MAP<PAD_ID, PAD_ID[]>;

interface LAYER_BLOCK {
  ElecLayerID: LAYER_ID; ///< Normally ELEC or POWER (could be JUMPER)
  ConstructionLayers: LAYER_ID[]; ///< Normally CONSTRUCTION layers
}

const newLayerBlock = (): LAYER_BLOCK => ({ ElecLayerID: '', ConstructionLayers: [] });

const layerBlockIsInitialised = (b: LAYER_BLOCK): boolean =>
  b.ElecLayerID !== '' || b.ConstructionLayers.length > 0;

const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: (a.x - b.x) | 0, y: (a.y - b.y) | 0 });
const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: (a.x + b.x) | 0, y: (a.y + b.y) | 0 });

export class CADSTAR_PCB_ARCHIVE_LOADER extends CADSTAR_PCB_ARCHIVE_PARSER {
  private m_layerMappingHandler: LAYER_MAPPING_HANDLER;
  private m_logLayerWarnings: boolean;
  private m_board: BOARD | null = null;
  private m_project: PCB_IO_PROJECT | null = null;

  /** Map between Cadstar and KiCad Layers. */
  private m_layermap = new STD_MAP<LAYER_ID, PCB_LAYER_ID>();
  /** Map between Cadstar and KiCad components in the library. */
  private m_libraryMap = new STD_MAP<SYMDEF_ID, FOOTPRINT>();
  private m_groupMap = new STD_MAP<GROUP_ID, PCB_GROUP>();
  /** Map between Cadstar and KiCad components on the board. */
  private m_componentMap = new STD_MAP<COMPONENT_ID, FOOTPRINT>();
  /** Associated copper pads (if any) for each component library definition. */
  private m_librarycopperpads = new STD_MAP<SYMDEF_ID, ASSOCIATED_COPPER_PADS>();
  private m_netMap = new STD_MAP<NET_ID, NETINFO_ITEM>();
  /** Map between Cadstar and KiCad classes (the key is the three ids joined). */
  private m_netClassMap = new Map<string, NETCLASS>();
  /** Map between Cadstar and KiCad zones. */
  private m_zonesMap = new STD_MAP<TEMPLATE_ID, ZONE>();
  /** List of layers that are marked as power plane in CADSTAR. */
  private m_powerPlaneLayers: LAYER_ID[] = [];
  /** Used for calculating the required offset to apply to the Cadstar design so that it fits in KiCad canvas. */
  private m_designCenter: VECTOR2I = { x: 0, y: 0 };
  private m_hatchcodesTested = new Set<HATCHCODE_ID>();
  private m_padcodesTested = new Set<PADCODE_ID>();
  private m_doneCopperWarning = false;
  private m_doneSpacingClassWarning = false;
  private m_doneNetClassWarning = false;
  private m_doneTearDropWarning = false;
  private m_numNets = 0; ///< Number of nets loaded so far
  private m_numCopperLayers = 0; ///< Number of layers in the design

  constructor(
    aFilename: string,
    aData: Uint8Array,
    aLayerMappingHandler: LAYER_MAPPING_HANDLER,
    aLogLayerWarnings: boolean,
    aProgressReporter: PROGRESS_REPORTER | null,
  ) {
    super(aFilename, aData, aProgressReporter);
    this.m_layerMappingHandler = aLayerMappingHandler;
    this.m_logLayerWarnings = aLogLayerWarnings;
  }

  private get board(): BOARD {
    return this.m_board!;
  }

  /** Loads a CADSTAR PCB Archive file into the KiCad BOARD object given. */
  Load(aBoard: BOARD, aProject: PCB_IO_PROJECT | null): void {
    this.m_board = aBoard;
    this.m_project = aProject;

    this.m_progressReporter?.SetNumPhases(3); // (0) Read file, (1) Parse file, (2) Load file

    this.Parse();

    const designLimit = this.Assignments.Technology.DesignLimit;

    //Note: can't use getKiCadPoint() due wxPoint being int - need long long to make the check
    const designSizeXkicad = designLimit.x * this.KiCadUnitMultiplier;
    const designSizeYkicad = designLimit.y * this.KiCadUnitMultiplier;

    // Max size limited by the positive dimension of wxPoint (which is an int)
    const maxDesignSizekicad = INT_MAX;

    if (designSizeXkicad > maxDesignSizekicad || designSizeYkicad > maxDesignSizekicad) {
      const f = (v: number): string => (v / PCB_IU_PER_MM).toFixed(2);

      throw new IO_ERROR(
        'The design is too large and cannot be imported into KiCad. \n' +
          'Please reduce the maximum design size in CADSTAR by navigating to: \n' +
          'Design Tab -> Properties -> Design Options -> Maximum Design Size. \n' +
          `Current Design size: ${f(designSizeXkicad)}, ${f(designSizeYkicad)} millimeters. \n` +
          `Maximum permitted design size: ${f(maxDesignSizekicad)}, ${f(maxDesignSizekicad)} millimeters.\n`,
      );
    }

    // Assume the center at 0,0 since we are going to be translating the design afterwards anyway
    const [a0, a1] = this.Assignments.Technology.DesignArea;
    this.m_designCenter = {
      x: KiROUND(((a0.x + a1.x) | 0) / 2),
      y: KiROUND(((a0.y + a1.y) | 0) / 2),
    };

    if (this.Layout.NetSynch === NETSYNCH.WARNING) {
      // wxLogWarning: the nets might be out of synchronisation with the schematic
    }

    if (this.m_progressReporter) {
      this.m_progressReporter.BeginPhase(2); // Load file

      // Significantly most amount of time spent loading coppers compared to all the other steps
      // (39 seconds vs max of ~3 seconds for other steps). Hence, use only the coppers to report
      // progress
      let numSteps = this.Layout.Coppers.size;

      // A large amount is also spent calculating zone priorities
      numSteps += Math.trunc((this.Layout.Templates.size * this.Layout.Templates.size) / 2);

      this.m_progressReporter.SetMaxProgress(numSteps);
    }

    this.loadBoardStackup();
    this.remapUnsureLayers();
    this.loadDesignRules();
    this.loadComponentLibrary();
    this.loadGroups();
    this.loadBoards();
    this.loadFigures();
    this.loadTexts();
    this.loadDimensions();
    this.loadAreas();
    this.loadComponents();
    this.loadDocumentationSymbols();
    this.loadTemplates();
    this.loadCoppers();

    for (const id of LSET.AllCuMask(this.m_numCopperLayers).Seq()) {
      // wxLogError when the priorities cannot be determined
      this.calculateZonePriorities(id);
    }

    this.loadNets();
    this.loadTextVariables();
  }

  /** Return a copy of the loaded library footprints (caller owns the objects). */
  GetLoadedLibraryFootpints(): FOOTPRINT[] {
    return this.m_libraryMap.values().map((fp) => fp.Clone() as FOOTPRINT);
  }

  /** Parse a CADSTAR PCB Archive and load the footprints contained within. */
  LoadLibrary(aNewBoard: () => BOARD): FOOTPRINT[] {
    this.m_progressReporter?.SetNumPhases(2); // (0) Read file, (1) Parse file

    this.Parse(true /*library*/);

    this.m_libraryMap = new STD_MAP();
    this.m_board = aNewBoard();
    this.m_project = null;
    this.m_designCenter = { x: 0, y: 0 }; // load footprints at 0,0

    this.loadBoardStackup();
    this.remapUnsureLayers();
    this.loadComponentLibrary();

    const retval: FOOTPRINT[] = [];

    for (const [, footprint] of this.m_libraryMap) {
      footprint.SetParent(null);
      retval.push(footprint);
    }

    this.m_board = null;
    this.m_libraryMap = new STD_MAP();

    return retval;
  }

  private initStackupItem(
    aCadstarLayer: import('./cadstar_pcb_archive_parser.js').LAYER,
    aKiCadItem: BOARD_STACKUP_ITEM,
    aDielectricSublayer: number,
  ): void {
    if (aCadstarLayer.MaterialId !== '') {
      const material = this.Assignments.Layerdefs.Materials.at(aCadstarLayer.MaterialId);

      aKiCadItem.SetMaterial(material.Name, aDielectricSublayer);
      aKiCadItem.SetEpsilonR(material.Permittivity.GetDouble(), aDielectricSublayer);
      aKiCadItem.SetLossTangent(material.LossTangent.GetDouble(), aDielectricSublayer);
      //TODO add Resistivity when KiCad supports it
    }

    if (aCadstarLayer.Name !== '') aKiCadItem.SetLayerName(aCadstarLayer.Name);

    if (aCadstarLayer.Thickness !== 0)
      aKiCadItem.SetThickness(this.getKiCadLength(aCadstarLayer.Thickness), aDielectricSublayer);
  }

  private loadBoardStackup(): void {
    // Structure describing an electrical layer with optional dielectric layers below it
    // (construction layers in CADSTAR)
    const cadstarBoardStackup: LAYER_BLOCK[] = [];
    let currentBlock = newLayerBlock();
    let first = true;

    // Find the electrical and construction (dielectric) layers in the stackup
    for (const cadstarLayerID of this.Assignments.Layerdefs.LayerStack) {
      const cadstarLayer = this.Assignments.Layerdefs.Layers.at(cadstarLayerID);

      if (
        cadstarLayer.Type === LAYER_TYPE.JUMPERLAYER ||
        cadstarLayer.Type === LAYER_TYPE.POWER ||
        cadstarLayer.Type === LAYER_TYPE.ELEC
      ) {
        if (layerBlockIsInitialised(currentBlock)) {
          cadstarBoardStackup.push(currentBlock);
          currentBlock = newLayerBlock(); //reset the block
        }

        currentBlock.ElecLayerID = cadstarLayerID;
        first = false;
      } else if (cadstarLayer.Type === LAYER_TYPE.CONSTRUCTION) {
        if (first) {
          // wxLogWarning: construction layer on the outer surface, ignored
        } else {
          currentBlock.ConstructionLayers.push(cadstarLayerID);
        }
      }
    }

    if (layerBlockIsInitialised(currentBlock)) cadstarBoardStackup.push(currentBlock);

    this.m_numCopperLayers = cadstarBoardStackup.length;

    // Special case: last layer in the stackup is a construction layer, drop it
    if (cadstarBoardStackup[cadstarBoardStackup.length - 1]!.ConstructionLayers.length > 0) {
      // wxLogWarning for each: construction layer on the outer surface, ignored
      cadstarBoardStackup[cadstarBoardStackup.length - 1]!.ConstructionLayers = [];
    }

    // Make sure it is an even number of layers (KiCad doesn't yet support unbalanced stack-ups)
    if (this.m_numCopperLayers % 2 !== 0) {
      const bottomLayer = cadstarBoardStackup.pop()!;
      const secondToLastLayer = cadstarBoardStackup.pop()!;

      const dummyLayer = newLayerBlock();

      if (secondToLastLayer.ConstructionLayers.length > 0) {
        const lastConstruction =
          secondToLastLayer.ConstructionLayers[secondToLastLayer.ConstructionLayers.length - 1]!;

        if (secondToLastLayer.ConstructionLayers.length > 1) {
          // At least two construction layers, lets remove one here and use the
          // other in the dummy layer
          secondToLastLayer.ConstructionLayers.pop();
        } else {
          // There is only one construction layer, lets halve its thickness so it is split
          // evenly between this layer and the dummy layer
          const l = this.Assignments.Layerdefs.Layers.at(lastConstruction);
          l.Thickness = Math.trunc(l.Thickness / 2);
        }

        dummyLayer.ConstructionLayers.push(lastConstruction);
      }

      cadstarBoardStackup.push(secondToLastLayer);
      cadstarBoardStackup.push(dummyLayer);
      cadstarBoardStackup.push(bottomLayer);
      ++this.m_numCopperLayers;
    }

    // Create a new stackup from default stackup list
    const boardDesignSettings = this.board.GetDesignSettings();
    const stackup = boardDesignSettings.GetStackupDescriptor();
    stackup.RemoveAll();
    this.board.SetEnabledLayers(LSET.AllLayersMask());
    this.board.SetVisibleLayers(LSET.AllLayersMask());
    this.board.SetCopperLayerCount(this.m_numCopperLayers);
    stackup.BuildDefaultStackupList(this.board.GetDesignSettings(), this.m_numCopperLayers);

    let stackIndex = 0;

    for (const item of stackup.GetList()) {
      if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER) {
        const layerID = cadstarBoardStackup[stackIndex]!.ElecLayerID;

        if (layerID === '') {
          // Loading a dummy layer. Make zero thickness so it doesn't affect overall stackup
          item.SetThickness(0);
        } else {
          const copperLayer = this.Assignments.Layerdefs.Layers.at(layerID);
          this.initStackupItem(copperLayer, item, 0);
          let copperType = LAYER_T.LT_SIGNAL;

          switch (copperLayer.Type) {
            case LAYER_TYPE.JUMPERLAYER:
              copperType = LAYER_T.LT_JUMPER;
              break;
            case LAYER_TYPE.ELEC:
              copperType = LAYER_T.LT_SIGNAL;
              break;
            case LAYER_TYPE.POWER:
              copperType = LAYER_T.LT_POWER;
              this.m_powerPlaneLayers.push(copperLayer.ID); //need to add a Copper zone
              break;
            default:
              break;
          }

          this.board.SetLayerType(item.GetBrdLayerId(), copperType);
          this.board.SetLayerName(item.GetBrdLayerId(), item.GetLayerName());
          this.m_layermap.insert(copperLayer.ID, item.GetBrdLayerId());
        }
      } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
        const layerBlock = cadstarBoardStackup[stackIndex]!;
        const layerBlockBelow = cadstarBoardStackup[stackIndex + 1];

        if (!layerBlockBelow) throw new RangeError('vector::_M_range_check');

        if (layerBlock.ConstructionLayers.length === 0) {
          ++stackIndex;
          continue; // Older cadstar designs have no construction layers - use KiCad defaults
        }

        const dielectricId = stackIndex + 1;
        item.SetDielectricLayerId(dielectricId);

        //Prepreg or core?
        //Look at CADSTAR layer embedding (see LAYER->Embedding) to see whether the electrical
        //layer embeds above and below to decide if current layer is prepreg or core
        if (layerBlock.ElecLayerID === '') {
          //Dummy electrical layer, assume prepreg
          item.SetTypeName(KEY_PREPREG);
        } else {
          const copperLayer = this.Assignments.Layerdefs.Layers.at(layerBlock.ElecLayerID);

          if (layerBlockBelow.ElecLayerID === '') {
            //Dummy layer below, just use current layer to decide
            if (copperLayer.Embedding === EMBEDDING.ABOVE) item.SetTypeName(KEY_CORE);
            else item.SetTypeName(KEY_PREPREG);
          } else {
            const copperLayerBelow = this.Assignments.Layerdefs.Layers.at(
              layerBlockBelow.ElecLayerID,
            );

            if (copperLayer.Embedding === EMBEDDING.ABOVE) {
              //Need to check layer below is embedding downwards
              if (copperLayerBelow.Embedding === EMBEDDING.BELOW) item.SetTypeName(KEY_CORE);
              else item.SetTypeName(KEY_PREPREG);
            } else {
              item.SetTypeName(KEY_PREPREG);
            }
          }
        }

        let dielectricSublayer = 0;

        for (const constructionLaID of layerBlock.ConstructionLayers) {
          const dielectricLayer = this.Assignments.Layerdefs.Layers.at(constructionLaID);

          if (dielectricSublayer) item.AddDielectricPrms(dielectricSublayer);

          this.initStackupItem(dielectricLayer, item, dielectricSublayer);
          this.board.SetLayerName(item.GetBrdLayerId(), item.GetLayerName());
          this.m_layermap.insert(dielectricLayer.ID, item.GetBrdLayerId());
          ++dielectricSublayer;
        }

        ++stackIndex;
      } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN) {
        item.SetColor('White');
      } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK) {
        item.SetColor('Green');
      }
    }

    const thickness = stackup.BuildBoardThicknessFromStackup();
    boardDesignSettings.SetBoardThickness(thickness);
    boardDesignSettings.m_HasStackup = true;

    let numElecLayersProcessed = 0;

    // Map CADSTAR documentation layers to KiCad "User layers"
    let currentDocLayer = 0;
    const docLayers = [
      PCB_LAYER_ID.Dwgs_User,
      PCB_LAYER_ID.Cmts_User,
      PCB_LAYER_ID.User_1,
      PCB_LAYER_ID.User_2,
      PCB_LAYER_ID.User_3,
      PCB_LAYER_ID.User_4,
      PCB_LAYER_ID.User_5,
      PCB_LAYER_ID.User_6,
      PCB_LAYER_ID.User_7,
      PCB_LAYER_ID.User_8,
      PCB_LAYER_ID.User_9,
    ];

    for (const cadstarLayerID of this.Assignments.Layerdefs.LayerStack) {
      const curLayer = this.Assignments.Layerdefs.Layers.at(cadstarLayerID);
      let kicadLayerID = PCB_LAYER_ID.UNDEFINED_LAYER;
      const layerName = curLayer.Name.toLowerCase();

      const selectLayerID = (aFront: PCB_LAYER_ID, aBack: PCB_LAYER_ID): void => {
        if (numElecLayersProcessed >= this.m_numCopperLayers) kicadLayerID = aBack;
        else kicadLayerID = aFront;

        // logBoardStackupMessage / logBoardStackupWarning go to wxLog
      };

      switch (curLayer.Type) {
        case LAYER_TYPE.ALLDOC:
        case LAYER_TYPE.ALLELEC:
        case LAYER_TYPE.ALLLAYER:
        case LAYER_TYPE.ASSCOMPCOPP:
        case LAYER_TYPE.NOLAYER:
          //Shouldn't be here if CPA file is correctly parsed and not corrupt
          throw new IO_ERROR(`Unexpected layer '${curLayer.Name}' in layer stack.`);

        case LAYER_TYPE.JUMPERLAYER:
        case LAYER_TYPE.ELEC:
        case LAYER_TYPE.POWER:
          ++numElecLayersProcessed;
          break;

        case LAYER_TYPE.CONSTRUCTION:
          //Already dealt with these when loading board stackup
          break;

        case LAYER_TYPE.DOC:
          if (currentDocLayer >= docLayers.length) currentDocLayer = 0;

          kicadLayerID = docLayers[currentDocLayer++]!;
          break;

        case LAYER_TYPE.NONELEC:
          switch (curLayer.SubType) {
            case LAYER_SUBTYPE.LAYERSUBTYPE_ASSEMBLY:
              selectLayerID(PCB_LAYER_ID.F_Fab, PCB_LAYER_ID.B_Fab);
              break;

            case LAYER_SUBTYPE.LAYERSUBTYPE_PLACEMENT:
              selectLayerID(PCB_LAYER_ID.F_CrtYd, PCB_LAYER_ID.B_CrtYd);
              break;

            case LAYER_SUBTYPE.LAYERSUBTYPE_NONE:
              // Generic Non-electrical layer (older CADSTAR versions).
              // Attempt to detect technical layers by string matching.
              if (layerName.includes('glue') || layerName.includes('adhesive')) {
                selectLayerID(PCB_LAYER_ID.F_Adhes, PCB_LAYER_ID.B_Adhes);
              } else if (layerName.includes('silk') || layerName.includes('legend')) {
                selectLayerID(PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS);
              } else if (layerName.includes('assembly') || layerName.includes('fabrication')) {
                selectLayerID(PCB_LAYER_ID.F_Fab, PCB_LAYER_ID.B_Fab);
              } else if (layerName.includes('resist') || layerName.includes('mask')) {
                selectLayerID(PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask);
              } else if (layerName.includes('paste')) {
                selectLayerID(PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste);
              } else {
                // Does not appear to be a technical layer - Map to Eco layers for now.
                selectLayerID(PCB_LAYER_ID.Eco1_User, PCB_LAYER_ID.Eco2_User);
              }

              break;

            case LAYER_SUBTYPE.LAYERSUBTYPE_PASTE:
              selectLayerID(PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste);
              break;

            case LAYER_SUBTYPE.LAYERSUBTYPE_SILKSCREEN:
              selectLayerID(PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS);
              break;

            case LAYER_SUBTYPE.LAYERSUBTYPE_SOLDERRESIST:
              selectLayerID(PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask);
              break;

            case LAYER_SUBTYPE.LAYERSUBTYPE_ROUT:
            case LAYER_SUBTYPE.LAYERSUBTYPE_CLEARANCE:
              //Unsure what these layer types are used for. Map to Eco layers for now.
              selectLayerID(PCB_LAYER_ID.Eco1_User, PCB_LAYER_ID.Eco2_User);
              break;

            default:
              break;
          }

          break;

        default:
          break;
      }

      this.m_layermap.insert(curLayer.ID, kicadLayerID);
    }
  }

  private remapUnsureLayers(): void {
    let enabledLayers = this.board.GetEnabledLayers();
    const validRemappingLayers = new LSET(enabledLayers)
      .or(LSET.AllBoardTechMask())
      .or(LSET.UserMask())
      .or(LSET.UserDefinedLayersMask());

    const inputLayers: INPUT_LAYER_DESC[] = [];
    const cadstarLayerNameMap = new STD_MAP<string, LAYER_ID>();

    for (const [layerId, kicadLayer] of this.m_layermap) {
      const curLayer = this.Assignments.Layerdefs.Layers.at(layerId);

      //Only remap layers that we aren't sure about
      if (curLayer.Type === LAYER_TYPE.NONELEC || curLayer.Type === LAYER_TYPE.DOC) {
        inputLayers.push({
          Name: curLayer.Name,
          PermittedLayers: validRemappingLayers,
          AutoMapLayer: kicadLayer,
          Required: true,
        });
        cadstarLayerNameMap.insert(curLayer.Name, curLayer.ID);
      }
    }

    //Callback:
    if (inputLayers.length === 0) return;

    const reMappedLayers = this.m_layerMappingHandler(inputLayers);

    for (const name of sortedKeys(reMappedLayers.keys())) {
      const layer = reMappedLayers.get(name)!;

      if (layer === PCB_LAYER_ID.UNDEFINED_LAYER) continue; // "Unexpected Layer ID"

      const cadstarLayerID = cadstarLayerNameMap.at(name);
      this.m_layermap.at(cadstarLayerID);
      this.m_layermap.set(cadstarLayerID, layer);
      enabledLayers = enabledLayers.or(new LSET([layer]));
    }

    this.board.SetEnabledLayers(enabledLayers);
    this.board.SetVisibleLayers(enabledLayers);
  }

  private loadDesignRules(): void {
    const bds = this.board.GetDesignSettings();
    const spacingCodes = this.Assignments.Codedefs.SpacingCodes;

    const applyRule = (aID: string): number | null => {
      if (!spacingCodes.has(aID)) return null; // wxLogWarning: design rule not found

      return this.getKiCadLength(spacingCodes.at(aID).Spacing);
    };

    const tt = applyRule('T_T');

    if (tt !== null) bds.m_MinClearance = tt;

    const cb = applyRule('C_B');

    if (cb !== null) bds.m_CopperEdgeClearance = cb;

    const hh = applyRule('H_H');

    if (hh !== null) bds.m_HoleToHoleMin = hh;

    bds.m_TrackMinWidth = this.getKiCadLength(this.Assignments.Technology.MinRouteWidth);
    bds.m_ViasMinSize = bds.m_TrackMinWidth;
    bds.m_ViasMinAnnularWidth = Math.trunc(bds.m_TrackMinWidth / 2);
    bds.m_MinThroughDrill = Math.trunc(PCB_IU_PER_MM * 0.0508); // CADSTAR does not specify a minimum hole size so set to minimum permitted
    bds.m_HoleClearance = 0; // CADSTAR does not specify a minimum hole clearance

    const value = applyRule('T_T') ?? -1;

    if (value !== -1) bds.m_NetSettings.GetDefaultNetclass().SetClearance(value);

    // wxLogWarning: KiCad design rules are different from CADSTAR ones
  }

  private loadComponentLibrary(): void {
    for (const [key, component] of this.Library.ComponentDefinitions) {
      let componentLayer: LAYER_ID = '';

      if (component.Figures.size > 0) {
        const firstFigure = component.Figures.values()[0]!;
        componentLayer = firstFigure.LayerID;
      } else if (component.Texts.size > 0) {
        const firstText = component.Texts.values()[0]!;
        componentLayer = firstText.LayerID;
      }

      if (componentLayer !== '' && this.getLayerType(componentLayer) === LAYER_TYPE.NOLAYER) {
        //don't load documentation symbols
        continue;
      }

      const footprint = new FOOTPRINT(this.board);
      footprint.SetPosition(this.getKiCadPoint(component.Origin));

      const libID = new LIB_ID();
      libID.Parse(component.BuildLibName(), true);

      footprint.SetFPID(libID);
      this.loadLibraryFigures(component, footprint);
      this.loadLibraryAreas(component, footprint);
      this.loadLibraryPads(component, footprint);
      this.loadLibraryCoppers(component, footprint); // Load coppers after pads to ensure correct
      // ordering of pads in footprint->Pads()

      footprint.SetPosition({ x: 0, y: 0 }); // KiCad expects library footprints at 0,0
      footprint.SetReference('REF**');
      footprint.SetValue(libID.GetLibItemName());
      footprint.AutoPositionFields();
      this.m_libraryMap.insert(key, footprint);
    }
  }

  private loadLibraryFigures(aComponent: SYMDEF_PCB, aFootprint: FOOTPRINT): void {
    for (const fig of aComponent.Figures.values()) {
      for (const layer of this.getKiCadLayerSet(fig.LayerID).Seq()) {
        this.drawCadstarShape(
          fig.Shape,
          layer,
          this.getLineThickness(fig.LineCodeID),
          `Component ${aComponent.ReferenceName}:${aComponent.Alternate} -> Figure ${fig.ID}`,
          aFootprint,
        );
      }
    }
  }

  private loadLibraryCoppers(aComponent: SYMDEF_PCB, aFootprint: FOOTPRINT): void {
    for (const compCopper of aComponent.ComponentCoppers) {
      const lineThickness = this.getKiCadLength(
        this.getCopperCode(compCopper.CopperCodeID).CopperWidth,
      );
      const layers = this.getKiCadLayerSet(compCopper.LayerID);
      const copperLayers = LSET.AllCuMask().and(layers);
      let remainingLayers = new LSET(layers);

      if (
        compCopper.AssociatedPadIDs.length > 0 &&
        copperLayers.count() > 0 &&
        compCopper.Shape.Type === SHAPE_TYPE.SOLID
      ) {
        // The copper is associated with pads and in an electrical layer which means it can
        // have a net associated with it. Load as a pad instead.
        // Note: we can only handle SOLID copper shapes. If the copper shape is an outline or
        // hatched or outline, then we give up and load as a graphical shape instead.

        // Find the first non-PCB-only pad. If there are none, use the first one
        let anchorPad = new COMPONENT_PAD();
        let found = false;

        for (const padID of compCopper.AssociatedPadIDs) {
          anchorPad = aComponent.ComponentPads.at(padID);

          if (!anchorPad.PCBonlyPad) {
            found = true;
            break;
          }
        }

        if (!found) anchorPad = aComponent.ComponentPads.at(compCopper.AssociatedPadIDs[0]!);

        const pad = new PAD(aFootprint);
        pad.SetAttribute(PAD_ATTRIB.SMD);
        pad.SetLayerSet(copperLayers);
        pad.SetNumber(anchorPad.Identifier === '' ? String(anchorPad.ID) : anchorPad.Identifier);

        // Custom pad shape with an anchor at the position of one of the associated
        // pads and same size as the pad. Shape circle as it fits inside a rectangle
        // but not the other way round
        const anchorpadcode = this.getPadCode(anchorPad.PadCodeID);
        let anchorSize = this.getKiCadLength(anchorpadcode.Shape.Size);
        const anchorPos = this.getKiCadPoint(anchorPad.Position);

        if (anchorSize <= 0) anchorSize = 1;

        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
        pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: anchorSize, y: anchorSize });
        pad.SetPosition(anchorPos);

        const shapePolys = this.getPolySetFromCadstarShape(
          compCopper.Shape,
          lineThickness,
          aFootprint,
        );
        shapePolys.Move({ x: -anchorPos.x, y: -anchorPos.y });
        pad.AddPrimitivePoly(PADSTACK.ALL_LAYERS, shapePolys, 0, true);

        // Now renumber all the associated pads
        for (const padID of compCopper.AssociatedPadIDs) {
          const assocPad = this.getPadReference(aFootprint, padID);
          assocPad.SetNumber(pad.GetNumber());
        }

        aFootprint.Add(pad, ADD_MODE.APPEND); // Append so that we get the correct behaviour
        // when finding pads by PAD_ID. See loadNets()

        this.m_librarycopperpads
          .ref(aComponent.ID, () => new STD_MAP())
          .ref(anchorPad.ID, () => [])
          .push(aFootprint.Pads().length);

        remainingLayers = remainingLayers.xor(copperLayers); // don't process copper layers again!
      }

      // Now process any remaining layers (copper layers without associated pads or non-copper
      // layers)
      if (remainingLayers.any()) {
        for (const layer of remainingLayers.Seq()) {
          this.drawCadstarShape(
            compCopper.Shape,
            layer,
            lineThickness,
            `Component ${aComponent.ReferenceName}:${aComponent.Alternate} -> Copper element`,
            aFootprint,
          );
        }
      }
    }
  }

  private loadLibraryAreas(aComponent: SYMDEF_PCB, aFootprint: FOOTPRINT): void {
    for (const area of aComponent.ComponentAreas.values()) {
      if (area.NoVias || area.NoTracks) {
        const lineThickness = 0; // CADSTAR areas only use the line width for display purpose
        const zone = this.getZoneFromCadstarShape(area.Shape, lineThickness, aFootprint);

        aFootprint.Add(zone, ADD_MODE.APPEND);

        if (this.isLayerSet(area.LayerID)) zone.SetLayerSet(this.getKiCadLayerSet(area.LayerID));
        else zone.SetLayer(this.getKiCadLayer(area.LayerID));

        zone.SetIsRuleArea(true); //import all CADSTAR areas as Keepout zones
        zone.SetDoNotAllowPads(false); //no CADSTAR equivalent
        zone.SetZoneName(area.ID);

        //There is no distinction between tracks and copper pours in CADSTAR Keepout zones
        zone.SetDoNotAllowTracks(area.NoTracks);
        zone.SetDoNotAllowZoneFills(area.NoTracks);

        zone.SetDoNotAllowVias(area.NoVias);
      } else {
        // wxLogError: the area is neither a via nor a route keepout; not imported
      }
    }
  }

  private loadLibraryPads(aComponent: SYMDEF_PCB, aFootprint: FOOTPRINT): void {
    for (const pad of aComponent.ComponentPads.values()) {
      const kiPad = this.getKiCadPad(pad, aFootprint);

      if (kiPad) aFootprint.Add(kiPad, ADD_MODE.APPEND); // Append so that we get correct behaviour
      // when finding pads by PAD_ID - see loadNets()
    }
  }

  private getKiCadPad(aCadstarPad: COMPONENT_PAD, aParent: FOOTPRINT): PAD | null {
    const csPadcode = this.getPadCode(aCadstarPad.PadCodeID);
    let errorMSG = '';

    const pad = new PAD(aParent);
    let padLayerSet = new LSET(); // prevent redundant copies

    switch (aCadstarPad.Side) {
      case PAD_SIDE.MAXIMUM: //Bottom side
        padLayerSet = padLayerSet.or(
          new LSET([PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Paste, PCB_LAYER_ID.B_Mask]),
        );
        break;

      case PAD_SIDE.MINIMUM: //TOP side
        padLayerSet = padLayerSet.or(
          new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.F_Mask]),
        );
        break;

      case PAD_SIDE.THROUGH_HOLE:
        padLayerSet = LSET.AllCuMask(this.m_numCopperLayers).or(
          new LSET([
            PCB_LAYER_ID.F_Mask,
            PCB_LAYER_ID.B_Mask,
            PCB_LAYER_ID.F_Paste,
            PCB_LAYER_ID.B_Paste,
          ]),
        );
        break;

      default:
        break;
    }

    pad.SetAttribute(PAD_ATTRIB.SMD); // assume SMD pad for now
    pad.SetLocalSolderMaskMargin(0);
    pad.SetLocalSolderPasteMargin(0);
    pad.SetLocalSolderPasteMarginRatio(0.0);
    let complexPadErrorLogged = false;

    for (const [layer, shape] of csPadcode.Reassigns) {
      const kiLayer = this.getKiCadLayer(layer);

      if (shape.Size === 0) {
        if (kiLayer > PCB_LAYER_ID.UNDEFINED_LAYER) padLayerSet.reset(kiLayer);
      } else {
        const newMargin = Math.trunc(this.getKiCadLength(shape.Size - csPadcode.Shape.Size) / 2);

        if (kiLayer === PCB_LAYER_ID.F_Mask || kiLayer === PCB_LAYER_ID.B_Mask) {
          const localMargin = pad.GetLocalSolderMaskMargin();

          if (localMargin === undefined) pad.SetLocalSolderMaskMargin(newMargin);
          else if (Math.abs(localMargin) < Math.abs(newMargin))
            pad.SetLocalSolderMaskMargin(newMargin);
        } else if (kiLayer === PCB_LAYER_ID.F_Paste || kiLayer === PCB_LAYER_ID.B_Paste) {
          const localMargin = pad.GetLocalSolderPasteMargin();

          if (localMargin === undefined) pad.SetLocalSolderPasteMargin(newMargin);
          else if (Math.abs(localMargin) < Math.abs(newMargin))
            pad.SetLocalSolderPasteMargin(newMargin);
        } else {
          //TODO fix properly when KiCad supports full padstacks
          if (!complexPadErrorLogged) {
            complexPadErrorLogged = true;
            errorMSG += `\n - The CADSTAR pad definition '${csPadcode.Name}' is a complex pad stack, which is not supported in KiCad. Please review the imported pads as they may require manual correction.`;
          }
        }
      }
    }

    pad.SetLayerSet(padLayerSet);

    if (aCadstarPad.PCBonlyPad) {
      // PCB Only pads in CADSTAR do not have a representation in the schematic - they are
      // purely mechanical pads that have no net associated with them. Make the pad name
      // empty to avoid warnings when importing from the schematic
      pad.SetNumber('');
    } else {
      pad.SetNumber(
        aCadstarPad.Identifier === '' ? String(aCadstarPad.ID) : aCadstarPad.Identifier,
      );
    }

    if (csPadcode.Shape.Size === 0) {
      if (
        csPadcode.DrillDiameter === UNDEFINED_VALUE &&
        aCadstarPad.Side === PAD_SIDE.THROUGH_HOLE
      ) {
        // Through-hole, zero sized pad?. Lets load this just on the F_Mask for now to
        // prevent DRC errors.
        // TODO: This could be a custom padstack, update when KiCad supports padstacks
        pad.SetAttribute(PAD_ATTRIB.SMD);
        pad.SetLayerSet(new LSET([PCB_LAYER_ID.F_Mask]));
      }

      // zero sized pads seems to break KiCad so lets make it very small instead
      csPadcode.Shape.Size = 1;
    }

    let padOffset: VECTOR2I = { x: 0, y: 0 }; // offset of the pad origin (before rotating)
    let drillOffset: VECTOR2I = { x: 0, y: 0 }; // offset of the drill origin w.r.t. the pad (before rotating)

    const s = csPadcode.Shape;
    const L = (v: number): number => this.getKiCadLength(v);
    const halfDiff = (): number => L(Math.trunc(s.LeftLength / 2) - Math.trunc(s.RightLength / 2));
    const longSize = (): VECTOR2I => ({
      x: L(s.Size + s.LeftLength + s.RightLength),
      y: L(s.Size),
    });

    switch (s.ShapeType) {
      case PAD_SHAPE_TYPE.ANNULUS:
        //todo fix: use custom shape instead (Donught shape, i.e. a circle with a hole)
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: L(s.Size), y: L(s.Size) });
        break;

      case PAD_SHAPE_TYPE.BULLET:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CHAMFERED_RECT);
        pad.SetSize(PADSTACK.ALL_LAYERS, longSize());
        pad.SetChamferPositions(
          PADSTACK.ALL_LAYERS,
          RECT_CHAMFER_BOTTOM_LEFT | RECT_CHAMFER_TOP_LEFT,
        );
        pad.SetRoundRectRadiusRatio(PADSTACK.ALL_LAYERS, 0.5);
        pad.SetChamferRectRatio(PADSTACK.ALL_LAYERS, 0.0);

        padOffset.x = halfDiff();
        break;

      case PAD_SHAPE_TYPE.CIRCLE:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: L(s.Size), y: L(s.Size) });
        break;

      case PAD_SHAPE_TYPE.DIAMOND: {
        // Cadstar diamond shape is a square rotated 45 degrees
        // We convert it in KiCad to a square with chamfered edges
        const sizeOfSquare = Math.trunc(L(s.Size) * Math.sqrt(2.0));
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
        pad.SetChamferRectRatio(PADSTACK.ALL_LAYERS, 0.5);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: sizeOfSquare, y: sizeOfSquare });

        padOffset.x = halfDiff();
        break;
      }

      case PAD_SHAPE_TYPE.FINGER:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
        pad.SetSize(PADSTACK.ALL_LAYERS, longSize());

        padOffset.x = halfDiff();
        break;

      case PAD_SHAPE_TYPE.OCTAGON:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CHAMFERED_RECT);
        pad.SetChamferPositions(PADSTACK.ALL_LAYERS, RECT_CHAMFER_ALL);
        pad.SetChamferRectRatio(PADSTACK.ALL_LAYERS, 0.25);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: L(s.Size), y: L(s.Size) });
        break;

      case PAD_SHAPE_TYPE.RECTANGLE:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, longSize());

        padOffset.x = halfDiff();
        break;

      case PAD_SHAPE_TYPE.ROUNDED_RECT:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.ROUNDRECT);
        pad.SetRoundRectCornerRadius(PADSTACK.ALL_LAYERS, L(s.InternalFeature));
        pad.SetSize(PADSTACK.ALL_LAYERS, longSize());

        padOffset.x = halfDiff();
        break;

      case PAD_SHAPE_TYPE.SQUARE:
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: L(s.Size), y: L(s.Size) });
        break;

      default:
        break;
    }

    if (csPadcode.ReliefClearance !== UNDEFINED_VALUE)
      pad.SetThermalGap(L(csPadcode.ReliefClearance));

    if (csPadcode.ReliefWidth !== UNDEFINED_VALUE)
      pad.SetLocalThermalSpokeWidthOverride(L(csPadcode.ReliefWidth));

    if (csPadcode.DrillDiameter !== UNDEFINED_VALUE) {
      if (csPadcode.SlotLength !== UNDEFINED_VALUE) {
        pad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);
        pad.SetDrillSize({
          x: L(csPadcode.SlotLength + csPadcode.DrillDiameter),
          y: L(csPadcode.DrillDiameter),
        });
      } else {
        pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
        pad.SetDrillSize({ x: L(csPadcode.DrillDiameter), y: L(csPadcode.DrillDiameter) });
      }

      drillOffset.x = -L(csPadcode.DrillXoffset);
      drillOffset.y = L(csPadcode.DrillYoffset);

      if (csPadcode.Plated) pad.SetAttribute(PAD_ATTRIB.PTH);
      else pad.SetAttribute(PAD_ATTRIB.NPTH);
    } else {
      pad.SetDrillSize({ x: 0, y: 0 });
    }

    if (csPadcode.SlotOrientation !== 0) {
      const lset = pad.GetLayerSet().and(LSET.AllCuMask());

      if (lset.size() > 0) {
        const padOutline = new SHAPE_POLY_SET();
        const layer = lset.Seq()[0]!;
        const maxError = this.board.GetDesignSettings().m_MaxError;

        pad.SetPosition({ x: 0, y: 0 });
        pad.TransformShapeToPolygon(padOutline, layer, 0, maxError, ERROR_LOC.ERROR_INSIDE);

        const padShape = new PCB_SHAPE(null);
        padShape.SetShape(SHAPE_T.POLY);
        padShape.SetFilled(true);
        padShape.SetPolyShape(padOutline);
        padShape.SetStroke(new STROKE_PARAMS(0));
        padShape.Move(sub(padOffset, drillOffset));
        padShape.Rotate({ x: 0, y: 0 }, ANGLE_180.sub(this.getAngle(csPadcode.SlotOrientation)));

        const editedPadOutline = padShape.GetPolyShape();

        if (editedPadOutline.Contains({ x: 0, y: 0 })) {
          pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
          pad.SetSize(PADSTACK.ALL_LAYERS, { x: 4, y: 4 });
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
          pad.AddPrimitive(PADSTACK.ALL_LAYERS, padShape);
          padOffset = { x: 0, y: 0 };
        } else {
          // The CADSTAR pad has the hole shape outside the pad shape
          // Lets just put the hole in the center of the pad instead
          csPadcode.SlotOrientation = 0;
          drillOffset = { x: 0, y: 0 };

          errorMSG += `\n - The CADSTAR pad definition '${csPadcode.Name}' has the hole shape outside the pad shape. The hole has been moved to the center of the pad.`;
        }
      } else {
        // "No copper layers defined in the pad?"
        csPadcode.SlotOrientation = 0;
        pad.SetOffset(PADSTACK.ALL_LAYERS, drillOffset);
      }
    } else {
      pad.SetOffset(PADSTACK.ALL_LAYERS, drillOffset);
    }

    const padOrientation = this.getAngle(aCadstarPad.OrientAngle).add(
      this.getAngle(csPadcode.Shape.OrientAngle),
    );

    padOffset = RotatePoint(padOffset, padOrientation);
    drillOffset = RotatePoint(drillOffset, padOrientation);
    pad.SetPosition(sub(sub(this.getKiCadPoint(aCadstarPad.Position), padOffset), drillOffset));
    pad.SetOrientation(padOrientation.add(this.getAngle(csPadcode.SlotOrientation)));

    //TODO handle csPadcode.Reassigns when KiCad supports full padstacks

    //log warnings:
    if (!this.m_padcodesTested.has(csPadcode.ID) && errorMSG !== '') {
      // wxLogError: the pad definition has import errors
      this.m_padcodesTested.add(csPadcode.ID);
    }

    return pad;
  }

  /** `PAD*& getPadReference( aFootprint, aCadstarPadID )`: the slot, readable and writable. */
  private padIndex(aFootprint: FOOTPRINT, aCadstarPadID: PAD_ID): number {
    const index = aCadstarPadID - 1;

    // size_t: a negative id wraps to a huge index
    if (!(index >= 0 && index < aFootprint.Pads().length)) {
      throw new IO_ERROR(
        `Unable to find pad index '${aCadstarPadID}' in footprint '${aFootprint.GetReference()}'.`,
      );
    }

    return index;
  }

  private getPadReference(aFootprint: FOOTPRINT, aCadstarPadID: PAD_ID): PAD {
    return aFootprint.Pads()[this.padIndex(aFootprint, aCadstarPadID)]!;
  }

  private loadGroups(): void {
    for (const csGroup of this.Layout.Groups.values()) {
      const kiGroup = new PCB_GROUP(this.board);

      this.board.Add(kiGroup);
      kiGroup.SetName(csGroup.Name);
      kiGroup.SetLocked(csGroup.Fixed);

      this.m_groupMap.insert(csGroup.ID, kiGroup);
    }

    //now add any groups to their parent group
    for (const csGroup of this.Layout.Groups.values()) {
      if (csGroup.GroupID !== '') {
        if (!this.m_groupMap.has(csGroup.ID)) {
          throw new IO_ERROR(`Unable to find group ID ${csGroup.ID} in the group definitions.`);
        } else {
          const kiCadGroup = this.m_groupMap.at(csGroup.ID);
          const parentGroup = this.m_groupMap.at(csGroup.GroupID);
          parentGroup.AddItem(kiCadGroup);
        }
      }
    }
  }

  private loadBoards(): void {
    for (const board of this.Layout.Boards.values()) {
      const boardGroup = this.createUniqueGroupID('Board');

      this.drawCadstarShape(
        board.Shape,
        PCB_LAYER_ID.Edge_Cuts,
        this.getLineThickness(board.LineCodeID),
        `BOARD ${board.ID}`,
        this.board,
        boardGroup,
      );

      if (board.GroupID !== '') this.addToGroup(board.GroupID, this.getKiCadGroup(boardGroup)!);

      //TODO process board attributes when KiCad supports them
    }
  }

  private loadFigures(): void {
    for (const fig of this.Layout.Figures.values()) {
      for (const layer of this.getKiCadLayerSet(fig.LayerID).Seq()) {
        this.drawCadstarShape(
          fig.Shape,
          layer,
          this.getLineThickness(fig.LineCodeID),
          `FIGURE ${fig.ID}`,
          this.board,
          fig.GroupID,
        );
      }

      //TODO process "swaprule" (doesn't seem to apply to Layout Figures?)
      //TODO process re-use block when KiCad Supports it
      //TODO process attributes when KiCad Supports attributes in figures
    }
  }

  private loadTexts(): void {
    for (const csTxt of this.Layout.Texts.values()) this.drawCadstarText(csTxt, this.board);
  }

  private loadDimensions(): void {
    for (const csDim of this.Layout.Dimensions.values()) {
      switch (csDim.Type) {
        case DIMENSION_TYPE.LINEARDIM:
          switch (csDim.Subtype) {
            case DIMENSION_SUBTYPE.ANGLED:
            // wxLogWarning: an aligned dimension was loaded instead
            // fallthrough
            case DIMENSION_SUBTYPE.DIRECT:
            case DIMENSION_SUBTYPE.ORTHOGONAL: {
              let dimension: PCB_DIM_ALIGNED;

              if (csDim.Subtype === DIMENSION_SUBTYPE.ORTHOGONAL) {
                dimension = new PCB_DIM_ORTHOGONAL(this.board);
                const orDim = dimension as PCB_DIM_ORTHOGONAL;

                if (csDim.ExtensionLineParams.Start.x === csDim.Line.Start.x)
                  orDim.SetOrientation(PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL);
                else orDim.SetOrientation(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
              } else {
                dimension = new PCB_DIM_ALIGNED(this.board, KICAD_T.PCB_DIM_ALIGNED_T);
              }

              this.board.Add(dimension, ADD_MODE.APPEND);
              this.applyDimensionSettings(csDim, dimension);

              dimension.SetExtensionHeight(
                this.getKiCadLength(csDim.ExtensionLineParams.Overshoot),
              );

              // Calculate height:
              const crossbarStart = this.getKiCadPoint(csDim.Line.Start);
              const crossbarEnd = this.getKiCadPoint(csDim.Line.End);
              const crossbarVector = sub(crossbarEnd, crossbarStart);
              const heightVector = sub(crossbarStart, dimension.GetStart());
              let height = 0.0;

              if (csDim.Subtype === DIMENSION_SUBTYPE.ORTHOGONAL) {
                if (csDim.ExtensionLineParams.Start.x === csDim.Line.Start.x)
                  height = heightVector.y;
                else height = heightVector.x;
              } else {
                const angle = EDA_ANGLE.fromVector(crossbarVector).add(ANGLE_90);
                height = heightVector.x * angle.Cos() + heightVector.y * angle.Sin();
              }

              dimension.SetHeight(Math.trunc(height));
              break;
            }

            default:
              // wxLogError: unexpected dimension type, not imported
              continue;
          }

          break;

        case DIMENSION_TYPE.LEADERDIM:
          //TODO: update import when KiCad supports radius and diameter dimensions

          if (csDim.Line.Style === DIMENSION_LINE_STYLE.INTERNAL) {
            // "internal" is a simple double sided arrow from start to end (no extension lines)
            const dimension = new PCB_DIM_ALIGNED(this.board, KICAD_T.PCB_DIM_ALIGNED_T);
            this.board.Add(dimension, ADD_MODE.APPEND);
            this.applyDimensionSettings(csDim, dimension);

            // Lets set again start/end:
            dimension.SetStart(this.getKiCadPoint(csDim.Line.Start));
            dimension.SetEnd(this.getKiCadPoint(csDim.Line.End));

            // Do not use any extension lines:
            dimension.SetExtensionOffset(0);
            dimension.SetExtensionHeight(0);
            dimension.SetHeight(0);
          } else {
            // "external" is a "leader" style dimension
            const leaderDim = new PCB_DIM_LEADER(this.board);
            this.board.Add(leaderDim, ADD_MODE.APPEND);

            this.applyDimensionSettings(csDim, leaderDim);
            leaderDim.SetStart(this.getKiCadPoint(csDim.Line.End));

            /*
             * In CADSTAR, the resulting shape orientation of the leader dimension depends on
             * on the positions of the #Start (S) and #End (E) points as shown below. In the
             * diagrams below, the leader angle (angRad) is represented by HEV
             */
            const angRad = (this.getAngleDegrees(csDim.Line.LeaderAngle) * Math.PI) / 180.0;
            let orientX = 1;
            let orientY = 1;

            if (csDim.Line.End.x >= csDim.Line.Start.x) {
              if (csDim.Line.End.y >= csDim.Line.Start.y) {
                //Quadrant 1
                orientX = 1;
                orientY = 1;
              } else {
                //Quadrant 4
                orientX = 1;
                orientY = -1;
              }
            } else {
              if (csDim.Line.End.y >= csDim.Line.Start.y) {
                //Quadrant 2
                orientX = -1;
                orientY = 1;
              } else {
                //Quadrant 3
                orientX = -1;
                orientY = -1;
              }
            }

            const endOffset: VECTOR2I = {
              x: Math.trunc(csDim.Line.LeaderLineLength * cos(angRad) * orientX),
              y: Math.trunc(csDim.Line.LeaderLineLength * sin(angRad) * orientY),
            };

            const endPoint = add(csDim.Line.End, endOffset);
            const txtPoint: VECTOR2I = {
              x: Math.trunc(endPoint.x + csDim.Line.LeaderLineExtensionLength * orientX),
              y: endPoint.y,
            };

            leaderDim.SetEnd(this.getKiCadPoint(endPoint));
            leaderDim.SetTextPos(this.getKiCadPoint(txtPoint));
            leaderDim.SetOverrideText(ParseTextFields(csDim.Text.Text, this.m_context));
            leaderDim.SetPrefix('');
            leaderDim.SetSuffix('');
            leaderDim.SetUnitsFormat(DIM_UNITS_FORMAT.NO_SUFFIX);

            if (orientX === 1) leaderDim.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
            else leaderDim.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

            leaderDim.SetExtensionOffset(0);
          }

          break;

        case DIMENSION_TYPE.ANGLEDIM:
          //TODO: update import when KiCad supports angular dimensions
          // wxLogError: angular dimension not imported
          break;
      }
    }
  }

  private loadAreas(): void {
    for (const area of this.Layout.Areas.values()) {
      if (area.NoVias || area.NoTracks || area.Keepout || area.Routing) {
        const lineThickness = 0; // CADSTAR areas only use the line width for display purpose
        const zone = this.getZoneFromCadstarShape(area.Shape, lineThickness, this.board);

        this.board.Add(zone, ADD_MODE.APPEND);

        if (this.isLayerSet(area.LayerID)) zone.SetLayerSet(this.getKiCadLayerSet(area.LayerID));
        else zone.SetLayer(this.getKiCadLayer(area.LayerID));

        zone.SetIsRuleArea(true); //import all CADSTAR areas as Keepout zones
        zone.SetDoNotAllowPads(false); //no CADSTAR equivalent
        zone.SetZoneName(area.Name);

        zone.SetDoNotAllowFootprints(area.Keepout);

        zone.SetDoNotAllowTracks(area.NoTracks);
        zone.SetDoNotAllowZoneFills(area.NoTracks);

        zone.SetDoNotAllowVias(area.NoVias);

        // wxLogWarning when area.Placement: placement areas are not supported
      } else {
        // wxLogError: pure placement areas are not supported
      }

      //todo Process area.AreaHeight when KiCad supports 3D design rules
      //TODO process attributes
      //TODO process addition to a group
      //TODO process "swaprule"
      //TODO process re-use block
    }
  }

  private loadComponents(): void {
    for (const comp of this.Layout.Components.values()) {
      if (comp.VariantID !== '' && comp.VariantParentComponentID !== comp.ID) continue; // Only load master Variant

      const libFootprint = this.m_libraryMap.get(comp.SymdefID);

      if (!libFootprint) {
        throw new IO_ERROR(
          `Unable to find component '${comp.Name}' in the library (Symdef ID: '${comp.SymdefID}')`,
        );
      }

      // Use Duplicate() to ensure unique KIID for all objects
      const footprint = libFootprint.Duplicate(IGNORE_PARENT_GROUP) as FOOTPRINT;

      this.board.Add(footprint, ADD_MODE.APPEND);

      // First lets fix the pad names on the footprint.
      // CADSTAR defines the pad name in the PART definition and the SYMDEF (i.e. the PCB
      // footprint definition) uses a numerical sequence. COMP is the only object that has
      // visibility of both the SYMDEF and PART.
      if (this.Parts.PartDefinitions.has(comp.PartID)) {
        const part = this.Parts.PartDefinitions.at(comp.PartID);

        // Only do this when the number of pins in the part definition equals the number of
        // pads in the footprint. Otherwise we don't know for sure which pins map to which pads
        if (part.Definition.Pins.size === footprint.Pads().length) {
          for (const pin of part.Definition.Pins.values()) {
            let pinName = pin.Name;

            if (pinName === '') pinName = pin.Identifier;

            if (pinName === '') pinName = String(pin.ID);

            this.getPadReference(footprint, pin.ID).SetNumber(pinName);
          }
        }
      }

      //Override pads with pad exceptions
      if (comp.PadExceptions.size > 0) {
        const fpLibEntry = this.Library.ComponentDefinitions.at(comp.SymdefID);

        for (const [padId, padEx] of comp.PadExceptions) {
          const csPad = fpLibEntry.ComponentPads.at(padId).clone();

          // Reset the pad to be around 0,0
          csPad.Position = new POINT(
            (csPad.Position.x - fpLibEntry.Origin.x + this.m_designCenter.x) | 0,
            (csPad.Position.y - fpLibEntry.Origin.y + this.m_designCenter.y) | 0,
          );

          if (padEx.PadCode !== '') csPad.PadCodeID = padEx.PadCode;

          if (padEx.OverrideExits) csPad.Exits = padEx.Exits;

          if (padEx.OverrideOrientation) csPad.OrientAngle = padEx.OrientAngle;

          if (padEx.OverrideSide) csPad.Side = padEx.Side;

          // Find the pad in the footprint definition
          const index = this.padIndex(footprint, padEx.ID);
          const kiPad = footprint.Pads()[index]!;
          const padNumber = kiPad.GetNumber();

          const newPad = this.getKiCadPad(csPad, footprint);

          if (newPad) {
            newPad.SetNumber(padNumber);

            // Change the pointer in the footprint to the newly created pad
            footprint.Pads()[this.padIndex(footprint, padEx.ID)] = newPad;
          }
        }
      }

      //set to empty string to avoid duplication when loading attributes:
      footprint.SetValue('');

      footprint.SetPosition(this.getKiCadPoint(comp.Origin));
      footprint.SetOrientation(this.getAngle(comp.OrientAngle));
      footprint.SetReference(comp.Name);

      if (comp.Mirror) {
        const mirroredAngle = this.getAngle(comp.OrientAngle).negate();
        mirroredAngle.Normalize180();
        footprint.SetOrientation(mirroredAngle);
        footprint.Flip(this.getKiCadPoint(comp.Origin), FLIP_DIRECTION.LEFT_RIGHT);
      }

      this.loadComponentAttributes(comp, footprint);

      if (comp.PartID !== '' && comp.PartID !== 'NO_PART')
        footprint.SetLibDescription(this.getPart(comp.PartID).Definition.Name);

      this.m_componentMap.insert(comp.ID, footprint);
    }
  }

  private loadDocumentationSymbols(): void {
    //No KiCad equivalent. Loaded as graphic and text elements instead

    for (const docSymInstance of this.Layout.DocumentationSymbols.values()) {
      const docSymDefinition = this.Library.ComponentDefinitions.get(docSymInstance.SymdefID);

      if (!docSymDefinition) {
        throw new IO_ERROR(
          `Unable to find documentation symbol in the library (Symdef ID: '${docSymInstance.SymdefID}')`,
        );
      }

      const moveVector = sub(
        this.getKiCadPoint(docSymInstance.Origin),
        this.getKiCadPoint(docSymDefinition.Origin),
      );
      const rotationAngle = this.getAngleTenthDegree(docSymInstance.OrientAngle);
      const scalingFactor =
        docSymInstance.ScaleRatioNumerator / docSymInstance.ScaleRatioDenominator;
      const centreOfTransform = this.getKiCadPoint(docSymDefinition.Origin);
      const mirrorInvert = docSymInstance.Mirror;

      //create a group to store the items in
      let groupName = docSymDefinition.ReferenceName;

      if (docSymDefinition.Alternate !== '') groupName += ` (${docSymDefinition.Alternate})`;

      const groupID = this.createUniqueGroupID(groupName);

      const layers = this.getKiCadLayerSet(docSymInstance.LayerID).Seq();

      for (const layer of layers) {
        for (const fig of docSymDefinition.Figures.values()) {
          this.drawCadstarShape(
            fig.Shape,
            layer,
            this.getLineThickness(fig.LineCodeID),
            `DOCUMENTATION SYMBOL ${docSymDefinition.ReferenceName}, FIGURE ${fig.ID}`,
            this.board,
            groupID,
            moveVector,
            rotationAngle,
            scalingFactor,
            centreOfTransform,
            mirrorInvert,
          );
        }
      }

      for (const txt of docSymDefinition.Texts.values()) {
        this.drawCadstarText(
          txt,
          this.board,
          groupID,
          docSymInstance.LayerID,
          moveVector,
          rotationAngle,
          scalingFactor,
          centreOfTransform,
          mirrorInvert,
        );
      }
    }
  }

  private loadTemplates(): void {
    for (const csTemplate of this.Layout.Templates.values()) {
      const zonelinethickness = 0; // The line thickness in CADSTAR is only for display purposes but
      // does not affect the end copper result.
      const zone = this.getZoneFromCadstarShape(csTemplate.Shape, zonelinethickness, this.board);

      this.board.Add(zone, ADD_MODE.APPEND);

      zone.SetZoneName(csTemplate.Name);
      zone.SetLayer(this.getKiCadLayer(csTemplate.LayerID));
      zone.SetAssignedPriority(1); // initially 1, we will increase in calculateZonePriorities

      if (!(csTemplate.NetID === '' || csTemplate.NetID === 'NONE'))
        zone.SetNet(this.getKiCadNet(csTemplate.NetID));

      // wxLogWarning for AllowInNoRouting / BoxIsolatedPins / AutomaticRepour / SliverWidth
      // and different isolated / disjoint copper settings

      //Note: for some reason the CADSTAR units for minimum island area appear to be
      //      the square of the design units.
      let minIslandArea = -1;

      if (csTemplate.Pouring.MinDisjointCopper !== UNDEFINED_VALUE) {
        const l = this.getKiCadLength(csTemplate.Pouring.MinDisjointCopper);
        minIslandArea = l * l;

        zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.AREA);
      } else {
        zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.ALWAYS);
      }

      zone.SetMinIslandArea(minIslandArea);

      // In cadstar zone clearance is in addition to the global clearance.
      // TODO: need to create custom rules for individual items: zone to pad, zone to track, etc.
      let clearance = this.getKiCadLength(csTemplate.Pouring.AdditionalIsolation);
      clearance += this.board.GetDesignSettings().m_MinClearance;

      zone.SetLocalClearance(clearance);

      const pouringCopperCode = this.getCopperCode(csTemplate.Pouring.CopperCodeID);
      const minThickness = this.getKiCadLength(pouringCopperCode.CopperWidth);
      zone.SetMinThickness(minThickness);

      if (csTemplate.Pouring.FillType === COPPER_FILL_TYPE.HATCHED) {
        zone.SetFillMode(ZONE_FILL_MODE.HATCH_PATTERN);
        zone.SetHatchGap(this.getKiCadHatchCodeGap(csTemplate.Pouring.HatchCodeID));
        zone.SetHatchThickness(this.getKiCadHatchCodeThickness(csTemplate.Pouring.HatchCodeID));
        zone.SetHatchOrientation(this.getHatchCodeAngle(csTemplate.Pouring.HatchCodeID));
      } else {
        zone.SetFillMode(ZONE_FILL_MODE.POLYGONS);
      }

      // wxLogWarning when thermal relief settings differ between pads and vias

      const reliefCopperCode = this.getCopperCode(csTemplate.Pouring.ReliefCopperCodeID);
      let spokeWidth = this.getKiCadLength(reliefCopperCode.CopperWidth);
      const reliefWidth = this.getKiCadLength(csTemplate.Pouring.ClearanceWidth);

      // Cadstar supports having a spoke width thinner than the minimum thickness of the zone, but
      // this is not permitted in KiCad. We load it as solid fill instead.
      if (csTemplate.Pouring.ThermalReliefOnPads && reliefWidth > 0) {
        if (spokeWidth < minThickness) {
          // wxLogWarning: the minimum thickness has been applied as the new spoke width
          spokeWidth = minThickness;
        }

        zone.SetThermalReliefGap(reliefWidth);
        zone.SetThermalReliefSpokeWidth(spokeWidth);
        zone.SetPadConnection(ZONE_CONNECTION.THERMAL);
      } else {
        zone.SetPadConnection(ZONE_CONNECTION.FULL);
      }

      this.m_zonesMap.insert(csTemplate.ID, zone);
    }

    //Now create power plane layers:
    for (const layer of this.m_powerPlaneLayers) {
      const powerPlaneLayerName = this.Assignments.Layerdefs.Layers.at(layer).Name;
      let netid: NET_ID = '';

      //find net based on layer name (Net name is exactly the same as the layer name)
      for (const net of this.Layout.Nets.values()) {
        if (net.Name === powerPlaneLayerName) {
          netid = net.ID;
          break;
        }
      }

      if (netid === '') {
        // wxLogError: no net with the power plane layer's name; no zone created
      } else {
        for (const board of this.Layout.Boards.values()) {
          //create a zone in each board shape
          const bds = this.board.GetDesignSettings();
          const defaultLineThicknesss = bds.GetLineThickness(PCB_LAYER_ID.Edge_Cuts);
          const zone = this.getZoneFromCadstarShape(board.Shape, defaultLineThicknesss, this.board);

          this.board.Add(zone, ADD_MODE.APPEND);

          zone.SetZoneName(powerPlaneLayerName);
          zone.SetLayer(this.getKiCadLayer(layer));
          zone.SetFillMode(ZONE_FILL_MODE.POLYGONS);
          zone.SetPadConnection(ZONE_CONNECTION.FULL);
          zone.SetMinIslandArea(-1);
          zone.SetAssignedPriority(0); // Priority always 0 (lowest priority) for implied power planes.
          zone.SetNet(this.getKiCadNet(netid));
        }
      }
    }
  }

  private loadCoppers(): void {
    for (const csCopper of this.Layout.Coppers.values()) {
      this.checkPoint();

      if (csCopper.PouredTemplateID !== '') {
        const pouredZone = this.m_zonesMap.at(csCopper.PouredTemplateID);
        let fill = new SHAPE_POLY_SET();

        const copperWidth = this.getKiCadLength(
          this.getCopperCode(csCopper.CopperCodeID).CopperWidth,
        );

        if (csCopper.Shape.Type === SHAPE_TYPE.OPENSHAPE) {
          // This is usually for themal reliefs. They are lines of copper with a thickness.
          // We convert them to an oval in most cases, but handle also the possibility of
          // encountering arcs in here.

          const outlineShapes = this.getShapesFromVertices(csCopper.Shape.Vertices);

          for (const shape of outlineShapes) {
            const poly = new SHAPE_POLY_SET();

            if (shape.GetShape() === SHAPE_T.ARC) {
              TransformArcToPolygon(
                poly,
                shape.GetStart(),
                shape.GetArcMid(),
                shape.GetEnd(),
                copperWidth,
                ARC_HIGH_DEF,
                ERROR_LOC.ERROR_INSIDE,
              );
            } else {
              TransformOvalToPolygon(
                poly,
                shape.GetStart(),
                shape.GetEnd(),
                copperWidth,
                ARC_HIGH_DEF,
                ERROR_LOC.ERROR_INSIDE,
              );
            }

            poly.ClearArcs();
            fill.BooleanAdd(poly);
          }
        } else {
          fill = this.getPolySetFromCadstarShape(csCopper.Shape, -1);
          fill.ClearArcs();
          fill.Inflate(Math.trunc(copperWidth / 2), CornerStrategy.ROUND_ALL_CORNERS, ARC_HIGH_DEF);
        }

        const layer = this.getKiCadLayer(csCopper.LayerID);

        if (pouredZone.HasFilledPolysForLayer(layer)) fill.BooleanAdd(pouredZone.GetFill(layer)!);

        fill.Fracture();

        pouredZone.SetFilledPolysList(layer, fill);
        pouredZone.SetIsFilled(true);
        pouredZone.SetNeedRefill(false);
        continue;
      }

      // For now we are going to load coppers to a KiCad zone however this isn't perfect
      //TODO: Load onto a graphical polygon with a net (when KiCad has this feature)

      if (!this.m_doneCopperWarning) {
        // wxLogWarning: COPPER elements have no direct KiCad equivalent
        this.m_doneCopperWarning = true;
      }

      if (
        csCopper.Shape.Type === SHAPE_TYPE.OPENSHAPE ||
        csCopper.Shape.Type === SHAPE_TYPE.OUTLINE
      ) {
        const width = this.getKiCadLength(this.getCopperCode(csCopper.CopperCodeID).CopperWidth);
        const outlineShapes = this.getShapesFromVertices(csCopper.Shape.Vertices);

        this.makeTracksFromShapes(
          outlineShapes,
          this.board,
          this.getKiCadNet(csCopper.NetRef.NetID),
          this.getKiCadLayer(csCopper.LayerID),
          width,
        );

        //cutouts
        for (const cutout of csCopper.Shape.Cutouts) {
          const cutoutShapes = this.getShapesFromVertices(cutout.Vertices);

          this.makeTracksFromShapes(
            cutoutShapes,
            this.board,
            this.getKiCadNet(csCopper.NetRef.NetID),
            this.getKiCadLayer(csCopper.LayerID),
            width,
          );
        }
      } else {
        const zone = this.getZoneFromCadstarShape(
          csCopper.Shape,
          this.getKiCadLength(this.getCopperCode(csCopper.CopperCodeID).CopperWidth),
          this.board,
        );

        this.board.Add(zone, ADD_MODE.APPEND);

        zone.SetZoneName(csCopper.ID);
        zone.SetLayer(this.getKiCadLayer(csCopper.LayerID));
        zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);

        if (csCopper.Shape.Type === SHAPE_TYPE.HATCHED) {
          zone.SetFillMode(ZONE_FILL_MODE.HATCH_PATTERN);
          zone.SetHatchGap(this.getKiCadHatchCodeGap(csCopper.Shape.HatchCodeID));
          zone.SetHatchThickness(this.getKiCadHatchCodeThickness(csCopper.Shape.HatchCodeID));
          zone.SetHatchOrientation(this.getHatchCodeAngle(csCopper.Shape.HatchCodeID));
        } else {
          zone.SetFillMode(ZONE_FILL_MODE.POLYGONS);
        }

        zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.NEVER);
        zone.SetPadConnection(ZONE_CONNECTION.FULL);
        zone.SetNet(this.getKiCadNet(csCopper.NetRef.NetID));
        zone.SetAssignedPriority(this.m_zonesMap.size + 1); // Highest priority (always fill first)

        const fill = new SHAPE_POLY_SET(zone.Outline());
        fill.Fracture();

        zone.SetFilledPolysList(this.getKiCadLayer(csCopper.LayerID), fill);
      }
    }
  }

  private loadNets(): void {
    for (const net of this.Layout.Nets.values()) {
      let netnameForErrorReporting = net.Name;
      const netelementSizes = new STD_MAP<NETELEMENT_ID, number>();

      if (netnameForErrorReporting === '') netnameForErrorReporting = `$${net.SignalNum}`;

      for (const [viaId, via] of net.Vias) {
        // viasize is used for calculating route offset (as done in CADSTAR post processor)
        const viaSize = this.loadNetVia(net.ID, via);
        netelementSizes.insert(viaId, viaSize);
      }

      for (const [pinId, pin] of net.Pins) {
        const footprint = this.getFootprintFromCadstarID(pin.ComponentID);

        if (footprint === null) {
          // wxLogWarning: the net references a component ID which does not exist
        } else if (pin.PadID - 1 > footprint.Pads().length) {
          // wxLogWarning: the net references a non-existent pad index
        } else {
          // The below works because we have added the pads in the correct order to the
          // footprint and the PAD_ID in Cadstar is a sequential, numerical ID
          const pad = this.getPadReference(footprint, pin.PadID);
          pad.SetNet(this.getKiCadNet(net.ID));

          // also set the net to any copper pads (i.e. copper elements that we have imported
          // as pads instead:
          const symdefid = this.Layout.Components.at(pin.ComponentID).SymdefID;

          if (this.m_librarycopperpads.has(symdefid)) {
            const assocPads = this.m_librarycopperpads.at(symdefid);

            if (assocPads.has(pin.PadID)) {
              for (const copperPadID of assocPads.at(pin.PadID)) {
                const copperpad = this.getPadReference(footprint, copperPadID);
                copperpad.SetNet(this.getKiCadNet(net.ID));
              }
            }
          }

          // padsize is used for calculating route offset (as done in CADSTAR post processor)
          const padsize = Math.min(pad.GetSizeX(), pad.GetSizeY());
          netelementSizes.insert(pinId, padsize);
        }
      }

      // For junction points we need to find out the biggest size of the other routes connecting
      // at the junction in order to correctly apply the same "route offset" operation that the
      // CADSTAR post processor applies when generating Manufacturing output. The only exception
      // is if there is just a single route at the junction point, we use that route width
      const getRouteCodeWidth = (aRouteCodeID: ROUTECODE_ID): number => {
        const rc = this.Assignments.Codedefs.RouteCodes.get(aRouteCodeID);

        if (rc && rc.OptimalWidth > 0) return rc.OptimalWidth;

        const defaultWidth = this.board
          .GetDesignSettings()
          .m_NetSettings.GetDefaultNetclass()
          .GetTrackWidth();

        return Math.trunc(defaultWidth / this.KiCadUnitMultiplier);
      };

      const getVertexWidth = (aVertex: ROUTE_VERTEX, aRouteCodeID: ROUTECODE_ID): number => {
        if (aVertex.RouteWidthIsExplicit) return aVertex.RouteWidth;

        return getRouteCodeWidth(aRouteCodeID);
      };

      const getJunctionSize = (
        aJptNetElemId: NETELEMENT_ID,
        aConnectionToIgnore: (typeof net.Connections)[number],
      ): number => {
        let jptsize = INT_MAX;

        for (const connection of net.Connections) {
          if (connection.Route.RouteVertices.length === 0) continue;

          if (
            connection.StartNode === aConnectionToIgnore.StartNode &&
            connection.EndNode === aConnectionToIgnore.EndNode
          ) {
            continue;
          }

          if (connection.StartNode === aJptNetElemId) {
            const s = this.getKiCadLength(
              getVertexWidth(connection.Route.RouteVertices[0]!, connection.RouteCodeID),
            );
            jptsize = Math.max(jptsize, s);
          } else if (connection.EndNode === aJptNetElemId) {
            const s = this.getKiCadLength(
              getVertexWidth(
                connection.Route.RouteVertices[connection.Route.RouteVertices.length - 1]!,
                connection.RouteCodeID,
              ),
            );
            jptsize = Math.max(jptsize, s);
          }
        }

        if (jptsize === INT_MAX && aConnectionToIgnore.Route.RouteVertices.length > 0) {
          // aConnectionToIgnore is actually the only one that has a route, so lets use that
          // to determine junction size
          const rv = aConnectionToIgnore.Route.RouteVertices;
          let vertex = rv[0]!;

          if (aConnectionToIgnore.EndNode === aJptNetElemId) vertex = rv[rv.length - 1]!;

          jptsize = this.getKiCadLength(getVertexWidth(vertex, aConnectionToIgnore.RouteCodeID));
        }

        return jptsize;
      };

      for (const connection of net.Connections) {
        let startSize = INT_MAX;
        let endSize = INT_MAX;

        if (netelementSizes.has(connection.StartNode))
          startSize = netelementSizes.at(connection.StartNode);
        else if (net.Junctions.has(connection.StartNode))
          startSize = getJunctionSize(connection.StartNode, connection);

        if (netelementSizes.has(connection.EndNode))
          endSize = netelementSizes.at(connection.EndNode);
        else if (net.Junctions.has(connection.EndNode))
          endSize = getJunctionSize(connection.EndNode, connection);

        startSize = Math.trunc(startSize / this.KiCadUnitMultiplier);
        endSize = Math.trunc(endSize / this.KiCadUnitMultiplier);

        if (!connection.Unrouted) {
          this.loadNetTracks(
            net.ID,
            connection.Route,
            getRouteCodeWidth(connection.RouteCodeID),
            startSize,
            endSize,
          );
        }
      }
    }
  }

  private loadTextVariables(): void {
    const ctx = this.m_context;

    const findAndReplaceTextField = (aField: TEXT_FIELD_NAME, aValue: string): boolean => {
      if (ctx.TextFieldToValuesMap.has(aField)) {
        if (ctx.TextFieldToValuesMap.at(aField) !== aValue) {
          ctx.TextFieldToValuesMap.set(aField, aValue);
          ctx.InconsistentTextFields.add(aField);
          return false;
        }
      } else {
        ctx.TextFieldToValuesMap.insert(aField, aValue);
      }

      return true;
    };

    if (this.m_project) {
      const txtVars = this.m_project.GetTextVars();

      // Most of the design text fields can be derived from other elements
      if (this.Layout.VariantHierarchy.Variants.size > 0) {
        const loadedVar = this.Layout.VariantHierarchy.Variants.values()[0]!;

        findAndReplaceTextField(TEXT_FIELD_NAME.VARIANT_NAME, loadedVar.Name);
        findAndReplaceTextField(TEXT_FIELD_NAME.VARIANT_DESCRIPTION, loadedVar.Description);
      }

      findAndReplaceTextField(TEXT_FIELD_NAME.DESIGN_TITLE, this.Header.JobTitle);

      for (const [field, value] of ctx.TextFieldToValuesMap) {
        const varName = CADSTAR_TO_KICAD_FIELDS.get(field)!;

        if (!txtVars.has(varName)) txtVars.set(varName, value);
      }

      for (const [varName, varValue] of ctx.FilenamesToTextMap) {
        if (!txtVars.has(varName)) txtVars.set(varName, varValue);
      }
    } else {
      // wxLogError: text variables could not be set as there is no project loaded
    }
  }

  private loadComponentAttributes(aComponent: COMPONENT, aFootprint: FOOTPRINT): void {
    for (const attrval of aComponent.AttributeValues.values()) {
      if (attrval.HasLocation) {
        //only import attributes with location. Ignore the rest
        this.addAttribute(
          attrval.AttributeLocation,
          attrval.AttributeID,
          aFootprint,
          attrval.Value,
        );
      }
    }

    for (const textloc of aComponent.TextLocations.values()) {
      let attrval: string;

      if (textloc.AttributeID === COMPONENT_NAME_ATTRID)
        attrval = ''; // Designator is loaded separately
      else if (textloc.AttributeID === COMPONENT_NAME_2_ATTRID) attrval = '${REFERENCE}';
      else if (textloc.AttributeID === PART_NAME_ATTRID)
        attrval = this.getPart(aComponent.PartID).Name;
      else attrval = this.getAttributeValue(textloc.AttributeID, aComponent.AttributeValues);

      this.addAttribute(textloc, textloc.AttributeID, aFootprint, attrval);
    }
  }

  private loadNetTracks(
    aCadstarNetID: NET_ID,
    aCadstarRoute: ROUTE,
    aDefaultRouteWidth: number,
    aStartWidth = Number.MAX_SAFE_INTEGER,
    aEndWidth = Number.MAX_SAFE_INTEGER,
  ): void {
    if (aCadstarRoute.RouteVertices.length === 0) return;

    const shapes: PCB_SHAPE[] = [];
    const routeVertices = aCadstarRoute.RouteVertices.map((v) => v.clone());

    // Add thin route at front so that route offsetting works as expected
    for (const v of routeVertices) {
      if (!v.RouteWidthIsExplicit) v.RouteWidth = aDefaultRouteWidth;
    }

    if (aStartWidth < routeVertices[0]!.RouteWidth) {
      const newFrontVertex = aCadstarRoute.RouteVertices[0]!.clone();
      newFrontVertex.RouteWidth = aStartWidth;
      newFrontVertex.Vertex.End = new POINT(aCadstarRoute.StartPoint.x, aCadstarRoute.StartPoint.y);
      routeVertices.unshift(newFrontVertex);
    }

    // Add thin route at the end so that route offsetting works as expected
    if (aEndWidth < routeVertices[routeVertices.length - 1]!.RouteWidth) {
      const rv = aCadstarRoute.RouteVertices;
      const newBackVertex = rv[rv.length - 1]!.clone();
      newBackVertex.RouteWidth = aEndWidth;
      routeVertices.push(newBackVertex);
    }

    let prevEnd: POINT = aCadstarRoute.StartPoint;

    for (const v of routeVertices) {
      const shape = this.getShapeFromVertex(prevEnd, v.Vertex);
      shape.SetLayer(this.getKiCadLayer(aCadstarRoute.LayerID));
      shape.SetStroke(new STROKE_PARAMS(this.getKiCadLength(v.RouteWidth), LINE_STYLE.SOLID));
      shape.SetLocked(v.Fixed);
      shapes.push(shape);
      prevEnd = v.Vertex.End;

      if (!this.m_doneTearDropWarning && (v.TeardropAtEnd || v.TeardropAtStart)) {
        // TODO: load teardrops
        // wxLogError: teardrops were ignored
        this.m_doneTearDropWarning = true;
      }
    }

    const net = this.getKiCadNet(aCadstarNetID);
    this.makeTracksFromShapes(shapes, this.board, net);
  }

  private loadNetVia(aCadstarNetID: NET_ID, aCadstarVia: NET_PCB_VIA): number {
    const via = new PCB_VIA(this.board);
    this.board.Add(via, ADD_MODE.APPEND);

    const csViaCode = this.getViaCode(aCadstarVia.ViaCodeID);
    const csLayerPair = this.getLayerPair(aCadstarVia.LayerPairID);

    via.SetPosition(this.getKiCadPoint(aCadstarVia.Location));
    via.SetDrill(this.getKiCadLength(csViaCode.DrillDiameter));
    via.SetLocked(aCadstarVia.Fixed);

    // wxLogError when the via code is not circular: KiCad only supports circular vias

    via.SetWidth(PADSTACK.ALL_LAYERS, this.getKiCadLength(csViaCode.Shape.Size));

    const start_layer_outside =
      csLayerPair.PhysicalLayerStart === 1 ||
      csLayerPair.PhysicalLayerStart === this.Assignments.Technology.MaxPhysicalLayer;
    const end_layer_outside =
      csLayerPair.PhysicalLayerEnd === 1 ||
      csLayerPair.PhysicalLayerEnd === this.Assignments.Technology.MaxPhysicalLayer;

    if (start_layer_outside && end_layer_outside) via.SetViaType(VIATYPE.THROUGH);
    else if (!start_layer_outside && !end_layer_outside) via.SetViaType(VIATYPE.BURIED);
    else via.SetViaType(VIATYPE.BLIND);

    via.SetLayerPair(
      this.getKiCadCopperLayerID(csLayerPair.PhysicalLayerStart),
      this.getKiCadCopperLayerID(csLayerPair.PhysicalLayerEnd),
    );
    via.SetNet(this.getKiCadNet(aCadstarNetID));
    ///todo add netcode to the via

    return via.GetWidth(PADSTACK.ALL_LAYERS);
  }

  private drawCadstarText(
    aCadstarText: TEXT,
    aContainer: BOARD_ITEM_CONTAINER,
    aCadstarGroupID: GROUP_ID = '',
    aCadstarLayerOverride: LAYER_ID = '',
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotationAngle = 0.0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): void {
    // new PCB_TEXT( aContainer ): the BOARD_ITEM* constructor
    const txt = new PCB_TEXT(null);
    txt.SetParent(aContainer);
    aContainer.Add(txt);
    txt.SetText(aCadstarText.Text);

    const rotationAngle = new EDA_ANGLE(aRotationAngle, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
    let rotatedTextPos = this.getKiCadPoint(aCadstarText.Position);
    rotatedTextPos = RotatePoint(rotatedTextPos, aTransformCentre, rotationAngle);
    rotatedTextPos = {
      x: KiROUND((rotatedTextPos.x - aTransformCentre.x) * aScalingFactor),
      y: KiROUND((rotatedTextPos.y - aTransformCentre.y) * aScalingFactor),
    };
    rotatedTextPos = add(rotatedTextPos, aTransformCentre);
    txt.SetTextPos(rotatedTextPos);
    txt.SetPosition(rotatedTextPos);

    txt.SetTextAngle(this.getAngle(aCadstarText.OrientAngle).add(rotationAngle));

    txt.SetMirrored(aCadstarText.Mirror);

    this.applyTextCode(txt, aCadstarText.TextCodeID);

    this.applyAlignment(txt, aCadstarText.Alignment);

    if (aMirrorInvert) txt.Flip(aTransformCentre, FLIP_DIRECTION.LEFT_RIGHT);

    //scale it after flipping:
    if (aScalingFactor !== 1.0) {
      const unscaledTextSize = txt.GetTextSize();
      const unscaledThickness = txt.GetTextThickness();

      txt.SetTextSize({
        x: KiROUND(unscaledTextSize.x * aScalingFactor),
        y: KiROUND(unscaledTextSize.y * aScalingFactor),
      });
      txt.SetTextThickness(KiROUND(unscaledThickness * aScalingFactor));
    }

    txt.Move(aMoveVector);

    if (aCadstarText.Alignment === ALIGNMENT.NO_ALIGNMENT) FixTextPositionNoAlignment(txt);

    let layersToDrawOn = aCadstarLayerOverride;

    if (layersToDrawOn === '') layersToDrawOn = aCadstarText.LayerID;

    if (this.isLayerSet(layersToDrawOn)) {
      //Make a copy on each layer
      for (const layer of this.getKiCadLayerSet(layersToDrawOn).Seq()) {
        txt.SetLayer(layer);
        const newtxt = txt.Duplicate(IGNORE_PARENT_GROUP) as PCB_TEXT;
        this.board.Add(newtxt, ADD_MODE.APPEND);

        if (aCadstarGroupID !== '') this.addToGroup(aCadstarGroupID, newtxt);
      }

      this.board.Remove(txt);
    } else {
      txt.SetLayer(this.getKiCadLayer(layersToDrawOn));

      if (aCadstarGroupID !== '') this.addToGroup(aCadstarGroupID, txt);
    }

    //TODO Handle different font types when KiCad can support it.
  }

  /** The alignment switch drawCadstarText and addAttribute share (NO_ALIGNMENT is bottom left). */
  private applyAlignment(aText: EDA_TEXT_LIKE, aAlignment: ALIGNMENT): void {
    const V = GR_TEXT_V_ALIGN_T;
    const H = GR_TEXT_H_ALIGN_T;

    switch (aAlignment) {
      case ALIGNMENT.NO_ALIGNMENT: // Default for Single line text is Bottom Left
      case ALIGNMENT.BOTTOMLEFT:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
        break;
      case ALIGNMENT.BOTTOMCENTER:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
        break;
      case ALIGNMENT.BOTTOMRIGHT:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
        break;
      case ALIGNMENT.CENTERLEFT:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
        break;
      case ALIGNMENT.CENTERCENTER:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
        break;
      case ALIGNMENT.CENTERRIGHT:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
        break;
      case ALIGNMENT.TOPLEFT:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
        break;
      case ALIGNMENT.TOPCENTER:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
        break;
      case ALIGNMENT.TOPRIGHT:
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
        break;
      default:
        break;
    }
  }

  private drawCadstarShape(
    aCadstarShape: SHAPE,
    aKiCadLayer: PCB_LAYER_ID,
    aLineThickness: number,
    _aShapeName: string,
    aContainer: BOARD_ITEM_CONTAINER,
    aCadstarGroupID: GROUP_ID = '',
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotationAngle = 0.0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): void {
    const drawAsOutline = (): void => {
      this.drawCadstarVerticesAsShapes(
        aCadstarShape.Vertices,
        aKiCadLayer,
        aLineThickness,
        aContainer,
        aCadstarGroupID,
        aMoveVector,
        aRotationAngle,
        aScalingFactor,
        aTransformCentre,
        aMirrorInvert,
      );
      this.drawCadstarCutoutsAsShapes(
        aCadstarShape.Cutouts,
        aKiCadLayer,
        aLineThickness,
        aContainer,
        aCadstarGroupID,
        aMoveVector,
        aRotationAngle,
        aScalingFactor,
        aTransformCentre,
        aMirrorInvert,
      );
    };

    if (aCadstarShape.Type === SHAPE_TYPE.OPENSHAPE || aCadstarShape.Type === SHAPE_TYPE.OUTLINE) {
      drawAsOutline();
      return;
    }

    // Special case solid shapes that are effectively a single line
    if (aCadstarShape.Vertices.length < 3) {
      drawAsOutline();
      return;
    }

    const shape = new PCB_SHAPE(aContainer as unknown as BOARD_ITEM, SHAPE_T.POLY);

    if (aCadstarShape.Type === SHAPE_TYPE.SOLID) shape.SetFillMode(FILL_T.FILLED_SHAPE);
    else if (this.getHatchCodeAngle(aCadstarShape.HatchCodeID).gt(ANGLE_90))
      shape.SetFillMode(FILL_T.REVERSE_HATCH);
    else shape.SetFillMode(FILL_T.HATCH);

    const shapePolys = this.getPolySetFromCadstarShape(
      aCadstarShape,
      -1,
      aContainer,
      aMoveVector,
      aRotationAngle,
      aScalingFactor,
      aTransformCentre,
      aMirrorInvert,
    );

    shapePolys.Fracture();

    shape.SetPolyShape(shapePolys);
    shape.SetStroke(new STROKE_PARAMS(aLineThickness, LINE_STYLE.SOLID));
    shape.SetLayer(aKiCadLayer);
    aContainer.Add(shape, ADD_MODE.APPEND);

    if (aCadstarGroupID !== '') this.addToGroup(aCadstarGroupID, shape);
  }

  private drawCadstarCutoutsAsShapes(
    aCutouts: readonly CUTOUT[],
    aKiCadLayer: PCB_LAYER_ID,
    aLineThickness: number,
    aContainer: BOARD_ITEM_CONTAINER,
    aCadstarGroupID: GROUP_ID,
    aMoveVector: VECTOR2I,
    aRotationAngle: number,
    aScalingFactor: number,
    aTransformCentre: VECTOR2I,
    aMirrorInvert: boolean,
  ): void {
    for (const cutout of aCutouts) {
      this.drawCadstarVerticesAsShapes(
        cutout.Vertices,
        aKiCadLayer,
        aLineThickness,
        aContainer,
        aCadstarGroupID,
        aMoveVector,
        aRotationAngle,
        aScalingFactor,
        aTransformCentre,
        aMirrorInvert,
      );
    }
  }

  private drawCadstarVerticesAsShapes(
    aCadstarVertices: readonly VERTEX[],
    aKiCadLayer: PCB_LAYER_ID,
    aLineThickness: number,
    aContainer: BOARD_ITEM_CONTAINER,
    aCadstarGroupID: GROUP_ID,
    aMoveVector: VECTOR2I,
    aRotationAngle: number,
    aScalingFactor: number,
    aTransformCentre: VECTOR2I,
    aMirrorInvert: boolean,
  ): void {
    const shapes = this.getShapesFromVertices(
      aCadstarVertices,
      aContainer,
      aCadstarGroupID,
      aMoveVector,
      aRotationAngle,
      aScalingFactor,
      aTransformCentre,
      aMirrorInvert,
    );

    for (const shape of shapes) {
      shape.SetStroke(new STROKE_PARAMS(aLineThickness, LINE_STYLE.SOLID));
      shape.SetLayer(aKiCadLayer);
      shape.SetParent(aContainer as unknown as BOARD_ITEM);
      aContainer.Add(shape, ADD_MODE.APPEND);
    }
  }

  private getShapesFromVertices(
    aCadstarVertices: readonly VERTEX[],
    aContainer: BOARD_ITEM_CONTAINER | null = null,
    aCadstarGroupID: GROUP_ID = '',
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotationAngle = 0.0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): PCB_SHAPE[] {
    const shapes: PCB_SHAPE[] = [];

    if (aCadstarVertices.length < 2) return shapes; //need at least two points to draw a segment! (unlikely but possible to have only one)

    let prev = aCadstarVertices[0]!;

    for (let i = 1; i < aCadstarVertices.length; i++) {
      const cur = aCadstarVertices[i]!;
      shapes.push(
        this.getShapeFromVertex(
          prev.End,
          cur,
          aContainer,
          aCadstarGroupID,
          aMoveVector,
          aRotationAngle,
          aScalingFactor,
          aTransformCentre,
          aMirrorInvert,
        ),
      );
      prev = cur;
    }

    return shapes;
  }

  private getShapeFromVertex(
    aCadstarStartPoint: POINT,
    aCadstarVertex: VERTEX,
    aContainer: BOARD_ITEM_CONTAINER | null = null,
    aCadstarGroupID: GROUP_ID = '',
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotationAngle = 0.0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): PCB_SHAPE {
    let shape: PCB_SHAPE;
    let cw = false;

    const startPoint = this.getKiCadPoint(aCadstarStartPoint);
    const endPoint = this.getKiCadPoint(aCadstarVertex.End);
    let centerPoint: VECTOR2I;

    if (
      aCadstarVertex.Type === VERTEX_TYPE.ANTICLOCKWISE_SEMICIRCLE ||
      aCadstarVertex.Type === VERTEX_TYPE.CLOCKWISE_SEMICIRCLE
    ) {
      // ( startPoint + endPoint ) / 2: VECTOR2I / double rounds
      const s = add(startPoint, endPoint);
      centerPoint = { x: KiROUND(s.x / 2), y: KiROUND(s.y / 2) };
    } else {
      centerPoint = this.getKiCadPoint(aCadstarVertex.Center);
    }

    const parent = aContainer as unknown as BOARD_ITEM | null;

    switch (aCadstarVertex.Type) {
      case VERTEX_TYPE.VT_POINT:
        shape = new PCB_SHAPE(parent, SHAPE_T.SEGMENT);
        shape.SetStart(startPoint);
        shape.SetEnd(endPoint);
        break;

      case VERTEX_TYPE.CLOCKWISE_SEMICIRCLE:
      case VERTEX_TYPE.CLOCKWISE_ARC:
      case VERTEX_TYPE.ANTICLOCKWISE_SEMICIRCLE:
      case VERTEX_TYPE.ANTICLOCKWISE_ARC: {
        cw =
          aCadstarVertex.Type === VERTEX_TYPE.CLOCKWISE_SEMICIRCLE ||
          aCadstarVertex.Type === VERTEX_TYPE.CLOCKWISE_ARC;

        shape = new PCB_SHAPE(parent, SHAPE_T.ARC);

        shape.SetCenter(centerPoint);
        shape.SetStart(startPoint);

        const arcStartAngle = EDA_ANGLE.fromVector(sub(startPoint, centerPoint));
        const arcEndAngle = EDA_ANGLE.fromVector(sub(endPoint, centerPoint));
        const arcAngle = arcEndAngle.sub(arcStartAngle).Normalize();
        //TODO: detect if we are supposed to draw a circle instead (i.e. two SEMICIRCLEs
        // with opposite start/end points and same centre point)

        if (!cw) arcAngle.NormalizeNegative(); // anticlockwise in KiCad = negative angle

        shape.SetArcAngleAndEnd(arcAngle, true);

        break;
      }

      default:
        throw new Error('unreachable vertex type');
    }

    //Apply transforms
    if (aMirrorInvert) shape.Flip(aTransformCentre, FLIP_DIRECTION.LEFT_RIGHT);

    if (aScalingFactor !== 1.0) {
      shape.Move({ x: -aTransformCentre.x, y: -aTransformCentre.y });
      shape.Scale(aScalingFactor);
      shape.Move(aTransformCentre);
    }

    if (aRotationAngle !== 0.0)
      shape.Rotate(
        aTransformCentre,
        new EDA_ANGLE(aRotationAngle, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T),
      );

    if (aMoveVector.x !== 0 || aMoveVector.y !== 0) shape.Move(aMoveVector);

    if (aCadstarGroupID !== '') this.addToGroup(aCadstarGroupID, shape);

    return shape;
  }

  private getZoneFromCadstarShape(
    aCadstarShape: SHAPE,
    aLineThickness: number,
    aParentContainer: BOARD_ITEM_CONTAINER,
  ): ZONE {
    const zone = new ZONE(aParentContainer);

    if (aCadstarShape.Type === SHAPE_TYPE.HATCHED) {
      zone.SetFillMode(ZONE_FILL_MODE.HATCH_PATTERN);
      zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL);
    } else {
      zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);
    }

    const polygon = this.getPolySetFromCadstarShape(aCadstarShape, aLineThickness);

    zone.AddPolygon(polygon.COutline(0));

    for (let i = 0; i < polygon.HoleCount(0); i++) zone.AddPolygon(polygon.CHole(0, i));

    return zone;
  }

  private getPolySetFromCadstarShape(
    aCadstarShape: SHAPE,
    aLineThickness = -1,
    aContainer: BOARD_ITEM_CONTAINER | null = null,
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotationAngle = 0.0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): SHAPE_POLY_SET {
    const noGroup = '';

    const outlineShapes = this.getShapesFromVertices(
      aCadstarShape.Vertices,
      aContainer,
      noGroup,
      aMoveVector,
      aRotationAngle,
      aScalingFactor,
      aTransformCentre,
      aMirrorInvert,
    );

    const polySet = new SHAPE_POLY_SET(this.getLineChainFromShapes(outlineShapes));

    for (const cutout of aCadstarShape.Cutouts) {
      const cutoutShapes = this.getShapesFromVertices(
        cutout.Vertices,
        aContainer,
        noGroup,
        aMoveVector,
        aRotationAngle,
        aScalingFactor,
        aTransformCentre,
        aMirrorInvert,
      );

      polySet.AddHole(this.getLineChainFromShapes(cutoutShapes));
    }

    polySet.ClearArcs();

    if (aLineThickness > 0)
      polySet.Inflate(
        Math.trunc(aLineThickness / 2),
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_HIGH_DEF,
      );

    return polySet;
  }

  private getLineChainFromShapes(aShapes: readonly PCB_SHAPE[]): SHAPE_LINE_CHAIN {
    const lineChain = new SHAPE_LINE_CHAIN();

    for (const shape of aShapes) {
      switch (shape.GetShape()) {
        case SHAPE_T.ARC: {
          const arc = new SHAPE_ARC(shape.GetCenter(), shape.GetStart(), shape.GetArcAngle());

          if (shape.EndsSwapped()) arc.Reverse();

          lineChain.Append(arc);
          break;
        }

        case SHAPE_T.SEGMENT:
          lineChain.Append(shape.GetStartX(), shape.GetStartY());
          lineChain.Append(shape.GetEndX(), shape.GetEndY());
          break;

        default:
          // "Drawsegment type is unexpected. Ignored."
          break;
      }
    }

    // Shouldn't have less than 3 points to make a closed shape!
    // Ensure chain is closed
    const p0 = lineChain.GetPoint(0);
    const pn = lineChain.GetPoint(lineChain.PointCount() - 1);

    if (p0.x !== pn.x || p0.y !== pn.y) lineChain.Append(p0);

    lineChain.SetClosed(true);

    return lineChain;
  }

  private makeTracksFromShapes(
    aShapes: readonly PCB_SHAPE[],
    aParentContainer: BOARD_ITEM_CONTAINER,
    aNet: NETINFO_ITEM | null = null,
    aLayerOverride: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aWidthOverride = -1,
  ): PCB_TRACK[] {
    const tracks: PCB_TRACK[] = [];
    let prevTrack: PCB_TRACK | null = null;
    let track: PCB_TRACK | null = null;
    const parent = aParentContainer as unknown as BOARD_ITEM;

    const addTrack = (aTrack: PCB_TRACK): void => {
      // Ignore zero length tracks in the same way as the CADSTAR postprocessor does
      // when generating gerbers. Note that CADSTAR reports these as "Route offset
      // errors" when running a DRC within CADSTAR, so we shouldn't be getting this in
      // general, however it is used to remove any synthetic points added to
      // aDrawSegments by the caller of this function.
      if (aTrack.GetLength() !== 0) {
        tracks.push(aTrack);
        aParentContainer.Add(aTrack, ADD_MODE.APPEND);
      }
    };

    for (const shape of aShapes) {
      switch (shape.GetShape()) {
        case SHAPE_T.ARC: {
          const arc = new SHAPE_ARC(shape.GetStart(), shape.GetArcMid(), shape.GetEnd(), 0);

          if (shape.EndsSwapped()) arc.Reverse();

          track = new PCB_ARC(parent, arc);
          break;
        }

        case SHAPE_T.SEGMENT:
          track = new PCB_TRACK(parent);
          track.SetStart(shape.GetStart());
          track.SetEnd(shape.GetEnd());
          break;

        default:
          // "Drawsegment type is unexpected. Ignored."
          continue;
      }

      if (aWidthOverride === -1) track.SetWidth(shape.GetWidth());
      else track.SetWidth(aWidthOverride);

      if (aLayerOverride === PCB_LAYER_ID.UNDEFINED_LAYER) track.SetLayer(shape.GetLayer());
      else track.SetLayer(aLayerOverride);

      if (aNet !== null) track.SetNet(aNet);
      else track.SetNetCode(-1);

      track.SetLocked(shape.IsLocked());

      // Apply route offsetting, mimmicking the behaviour of the CADSTAR post processor
      if (prevTrack !== null) {
        const offsetAmount =
          Math.trunc(track.GetWidth() / 2) - Math.trunc(prevTrack.GetWidth() / 2);

        if (offsetAmount > 0) {
          // modify the start of the current track
          const newStart = this.applyRouteOffset(track.GetStart(), track.GetEnd(), offsetAmount);
          track.SetStart(newStart);
        } else if (offsetAmount < 0) {
          // amend the end of the previous track
          const newEnd = this.applyRouteOffset(
            prevTrack.GetEnd(),
            prevTrack.GetStart(),
            -offsetAmount,
          );
          prevTrack.SetEnd(newEnd);
        } // don't do anything if offsetAmount == 0

        // Add a synthetic track of the thinnest width between the tracks
        // to ensure KiCad features works as expected on the imported design
        // (KiCad expects tracks are contiguous segments)
        const ts = track.GetStart();
        const pe = prevTrack.GetEnd();

        if (ts.x !== pe.x || ts.y !== pe.y) {
          const minWidth = Math.min(track.GetWidth(), prevTrack.GetWidth());
          const synthTrack = new PCB_TRACK(parent);
          synthTrack.SetStart(pe);
          synthTrack.SetEnd(ts);
          synthTrack.SetWidth(minWidth);
          synthTrack.SetLocked(track.IsLocked());
          synthTrack.SetNet(track.GetNet());
          synthTrack.SetLayer(track.GetLayer());
          addTrack(synthTrack);
        }
      }

      if (prevTrack) addTrack(prevTrack);

      prevTrack = track;
    }

    if (track) addTrack(track);

    return tracks;
  }

  private addAttribute(
    aCadstarAttrLoc: ATTRIBUTE_LOCATION,
    aCadstarAttributeID: ATTRIBUTE_ID,
    aFootprint: FOOTPRINT,
    aAttributeValue: string,
  ): void {
    let field: PCB_FIELD;

    if (aCadstarAttributeID === COMPONENT_NAME_ATTRID) {
      field = aFootprint.Reference(); //text should be set outside this function
    } else if (aCadstarAttributeID === PART_NAME_ATTRID) {
      if (aFootprint.Value().GetText() === '') {
        // Use PART_NAME_ATTRID as the value is value field is blank
        aFootprint.SetValue(aAttributeValue);
        field = aFootprint.Value();
      } else {
        field = new PCB_FIELD(aFootprint, FIELD_T.USER, aCadstarAttributeID);
        aFootprint.Add(field);
        field.SetText(aAttributeValue);
      }

      field.SetVisible(false); //make invisible to avoid clutter.
    } else if (
      aCadstarAttributeID !== COMPONENT_NAME_2_ATTRID &&
      this.getAttributeName(aCadstarAttributeID) === 'Value'
    ) {
      if (aFootprint.Value().GetText() !== '') {
        // Copy the object
        aFootprint.Add(aFootprint.Value().Duplicate(IGNORE_PARENT_GROUP));
      }

      aFootprint.SetValue(aAttributeValue);
      field = aFootprint.Value();
      field.SetVisible(false); //make invisible to avoid clutter.
    } else {
      field = new PCB_FIELD(aFootprint, FIELD_T.USER, aCadstarAttributeID);
      aFootprint.Add(field);
      field.SetText(aAttributeValue);
      field.SetVisible(false); //make all user attributes invisible to avoid clutter.
      //TODO: Future improvement - allow user to decide what to do with attributes
    }

    field.SetPosition(this.getKiCadPoint(aCadstarAttrLoc.Position));
    field.SetLayer(this.getKiCadLayer(aCadstarAttrLoc.LayerID));
    field.SetMirrored(aCadstarAttrLoc.Mirror);
    field.SetTextAngle(this.getAngle(aCadstarAttrLoc.OrientAngle));

    if (aCadstarAttrLoc.Mirror)
      // If mirroring, invert angle to match CADSTAR
      field.SetTextAngle(field.GetTextAngle().negate());

    this.applyTextCode(field, aCadstarAttrLoc.TextCodeID);

    field.SetKeepUpright(false); //Keeping it upright seems to result in incorrect orientation

    if (aCadstarAttrLoc.Alignment === ALIGNMENT.NO_ALIGNMENT) FixTextPositionNoAlignment(field);

    this.applyAlignment(field, aCadstarAttrLoc.Alignment);
  }

  /** `applyRouteOffset`: moves the point towards the reference by the offset amount. */
  private applyRouteOffset(
    aPointToOffset: VECTOR2I,
    aRefPoint: VECTOR2I,
    aOffsetAmount: number,
  ): VECTOR2I {
    const v = sub(aPointToOffset, aRefPoint);
    const newLength = EuclideanNormI(v) - aOffsetAmount;

    if (newLength > 0) return add(ResizeI(v, newLength), aRefPoint);

    return { x: aRefPoint.x, y: aRefPoint.y };
  }

  private applyTextCode(aKiCadText: EDA_TEXT_LIKE, aCadstarTextCodeID: TEXTCODE_ID): void {
    const tc = this.getTextCode(aCadstarTextCodeID);

    aKiCadText.SetTextThickness(this.getKiCadLength(tc.LineWidth));

    if (tc.Font.Modifier1 === FONT_BOLD) aKiCadText.SetBold(true);

    if (tc.Font.Italic) aKiCadText.SetItalic(true);

    const textSize: VECTOR2I = { x: this.getKiCadLength(tc.Width), y: 0 };

    // The width is zero for all non-cadstar fonts. Using a width equal to the height seems
    // to work well for most fonts.
    if (textSize.x === 0) textSize.x = this.getKiCadLength(tc.Height);

    textSize.y = KiROUND(TXT_HEIGHT_RATIO * this.getKiCadLength(tc.Height));

    if (textSize.x === 0 || textSize.y === 0) {
      // Make zero sized text not visible
      const s = pcbIUScale.milsToIU(DEFAULT_SIZE_TEXT);
      aKiCadText.SetTextSize({ x: s, y: s });
    } else {
      aKiCadText.SetTextSize(textSize);
    }

    const font = FONT.GetFont(tc.Font.Name, tc.Font.Modifier1 === FONT_BOLD, tc.Font.Italic);

    if (font) aKiCadText.SetFont(font);
  }

  private getLineThickness(aCadstarLineCodeID: LINECODE_ID): number {
    if (!this.Assignments.Codedefs.LineCodes.has(aCadstarLineCodeID))
      return this.board.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.Edge_Cuts);

    return this.getKiCadLength(this.Assignments.Codedefs.LineCodes.at(aCadstarLineCodeID).Width);
  }

  private getCopperCode(aCadstaCopperCodeID: COPPERCODE_ID): COPPERCODE {
    return this.Assignments.Codedefs.CopperCodes.get(aCadstaCopperCodeID) ?? new COPPERCODE();
  }

  private getTextCode(aCadstarTextCodeID: TEXTCODE_ID): TEXTCODE {
    return this.Assignments.Codedefs.TextCodes.get(aCadstarTextCodeID) ?? new TEXTCODE();
  }

  /** Returns a copy: the caller may modify it. */
  private getPadCode(aCadstarPadCodeID: PADCODE_ID): PADCODE {
    return (this.Assignments.Codedefs.PadCodes.get(aCadstarPadCodeID) ?? new PADCODE()).clone();
  }

  private getViaCode(aCadstarViaCodeID: VIACODE_ID): VIACODE {
    return this.Assignments.Codedefs.ViaCodes.get(aCadstarViaCodeID) ?? new VIACODE();
  }

  private getLayerPair(aCadstarLayerPairID: LAYERPAIR_ID): LAYERPAIR {
    return this.Assignments.Codedefs.LayerPairs.get(aCadstarLayerPairID) ?? new LAYERPAIR();
  }

  private getAttributeName(aCadstarAttributeID: ATTRIBUTE_ID): string {
    return this.Assignments.Codedefs.AttributeNames.get(aCadstarAttributeID)?.Name ?? '';
  }

  private getAttributeValue(
    aCadstarAttributeID: ATTRIBUTE_ID,
    aCadstarAttributeMap: STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>,
  ): string {
    return aCadstarAttributeMap.get(aCadstarAttributeID)?.Value ?? '';
  }

  private getLayerType(aCadstarLayerID: LAYER_ID): LAYER_TYPE {
    return this.Assignments.Layerdefs.Layers.get(aCadstarLayerID)?.Type ?? LAYER_TYPE.UNDEFINED;
  }

  private getPart(aCadstarPartID: PART_ID): PART {
    return this.Parts.PartDefinitions.get(aCadstarPartID) ?? new PART();
  }

  private getRouteCode(aCadstarRouteCodeID: ROUTECODE_ID): ROUTECODE {
    return this.Assignments.Codedefs.RouteCodes.get(aCadstarRouteCodeID) ?? new ROUTECODE();
  }

  private getHatchCode(aCadstarHatchcodeID: HATCHCODE_ID): HATCHCODE {
    return this.Assignments.Codedefs.HatchCodes.get(aCadstarHatchcodeID) ?? new HATCHCODE();
  }

  private getHatchCodeAngle(aCadstarHatchcodeID: HATCHCODE_ID): EDA_ANGLE {
    this.checkAndLogHatchCode(aCadstarHatchcodeID);
    const hcode = this.getHatchCode(aCadstarHatchcodeID);

    if (hcode.Hatches.length < 1)
      return this.board.GetDesignSettings().GetDefaultZoneSettings().m_HatchOrientation;

    return this.getAngle(hcode.Hatches[0]!.OrientAngle);
  }

  private getKiCadHatchCodeThickness(aCadstarHatchcodeID: HATCHCODE_ID): number {
    this.checkAndLogHatchCode(aCadstarHatchcodeID);
    const hcode = this.getHatchCode(aCadstarHatchcodeID);

    if (hcode.Hatches.length < 1)
      return this.board.GetDesignSettings().GetDefaultZoneSettings().m_HatchThickness;

    return this.getKiCadLength(hcode.Hatches[0]!.LineWidth);
  }

  private getKiCadHatchCodeGap(aCadstarHatchcodeID: HATCHCODE_ID): number {
    this.checkAndLogHatchCode(aCadstarHatchcodeID);
    const hcode = this.getHatchCode(aCadstarHatchcodeID);

    if (hcode.Hatches.length < 1)
      return this.board.GetDesignSettings().GetDefaultZoneSettings().m_HatchGap;

    return this.getKiCadLength(hcode.Hatches[0]!.Step);
  }

  private getKiCadGroup(aCadstarGroupID: GROUP_ID): PCB_GROUP | null {
    return this.m_groupMap.get(aCadstarGroupID) ?? null;
  }

  private checkAndLogHatchCode(aCadstarHatchcodeID: HATCHCODE_ID): void {
    if (this.m_hatchcodesTested.has(aCadstarHatchcodeID)) return;

    // the checks only log (wxLogWarning) when the hatching is not two 90-degree hatches
    this.m_hatchcodesTested.add(aCadstarHatchcodeID);
  }

  private applyDimensionSettings(aCadstarDim: DIMENSION, aKiCadDim: PCB_DIMENSION_BASE): void {
    let dimensionUnits = aCadstarDim.LinearUnits;
    const linecode: LINECODE = this.Assignments.Codedefs.LineCodes.at(aCadstarDim.Line.LineCodeID);

    aKiCadDim.SetLayer(this.getKiCadLayer(aCadstarDim.LayerID));
    aKiCadDim.SetPrecision(aCadstarDim.Precision as DIM_PRECISION);
    aKiCadDim.SetStart(this.getKiCadPoint(aCadstarDim.ExtensionLineParams.Start));
    aKiCadDim.SetEnd(this.getKiCadPoint(aCadstarDim.ExtensionLineParams.End));
    aKiCadDim.SetExtensionOffset(this.getKiCadLength(aCadstarDim.ExtensionLineParams.Offset));
    aKiCadDim.SetLineThickness(this.getKiCadLength(linecode.Width));

    this.applyTextCode(aKiCadDim, aCadstarDim.Text.TextCodeID);

    // Find prefix and suffix:
    let prefix = '';
    let suffix = '';
    const text = aCadstarDim.Text.Text;
    const startpos = text.indexOf('<@DISTANCE');

    if (startpos >= 0) {
      prefix = ParseTextFields(text.substring(0, startpos), this.m_context);
      const remainingStr = text.substring(startpos);
      const endpos = remainingStr.indexOf('@>');
      suffix = ParseTextFields(remainingStr.substring(endpos + 2), this.m_context);
    }

    if (suffix.startsWith('mm')) {
      aKiCadDim.SetUnitsFormat(DIM_UNITS_FORMAT.BARE_SUFFIX);
      suffix = suffix.substring(2);
    } else {
      aKiCadDim.SetUnitsFormat(DIM_UNITS_FORMAT.NO_SUFFIX);
    }

    aKiCadDim.SetPrefix(prefix);
    aKiCadDim.SetSuffix(suffix);

    if (aCadstarDim.LinearUnits === UNITS.DESIGN) {
      // For now we will hardcode the units as per the original CADSTAR design.
      // TODO: update this when KiCad supports design units
      aKiCadDim.SetPrecision(this.Assignments.Technology.UnitDisplPrecision as DIM_PRECISION);
      dimensionUnits = this.Assignments.Technology.Units;
    }

    switch (dimensionUnits) {
      case UNITS.METER:
      case UNITS.CENTIMETER:
      case UNITS.MICROMETRE:
      // wxLogWarning: millimeters were applied instead
      // fallthrough
      case UNITS.MM:
        aKiCadDim.SetUnitsMode(DIM_UNITS_MODE.MM);
        break;

      case UNITS.INCH:
        aKiCadDim.SetUnitsMode(DIM_UNITS_MODE.INCH);
        break;

      case UNITS.THOU:
        aKiCadDim.SetUnitsMode(DIM_UNITS_MODE.MILS);
        break;

      case UNITS.DESIGN:
        break;
    }
  }

  private calculateZonePriorities(aLayer: PCB_LAYER_ID): boolean {
    const winningOverlaps = new STD_MAP<TEMPLATE_ID, Set<TEMPLATE_ID>>();
    const winning = (id: TEMPLATE_ID): Set<TEMPLATE_ID> => winningOverlaps.ref(id, () => new Set());

    const inflateValue = (aZoneA: ZONE, aZoneB: ZONE): number => {
      const extra =
        this.getKiCadLength(this.Assignments.Codedefs.SpacingCodes.at('C_C').Spacing) -
        this.board.GetDesignSettings().m_MinClearance;

      let retval = Math.max(aZoneA.GetLocalClearance()!, aZoneB.GetLocalClearance()!);

      retval += extra;

      return retval;
    };

    // Find the error in fill area when guessing that aHigherZone gets filled before aLowerZone
    const errorArea = (aLowerZone: ZONE, aHigherZone: ZONE): number => {
      const intersectShape = new SHAPE_POLY_SET(aHigherZone.Outline());
      intersectShape.Inflate(
        inflateValue(aLowerZone, aHigherZone),
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_HIGH_DEF,
      );

      const lowerZoneFill = new SHAPE_POLY_SET(aLowerZone.GetFilledPolysList(aLayer));

      const lowerZoneOutline = new SHAPE_POLY_SET(aLowerZone.Outline());

      lowerZoneOutline.BooleanSubtract(intersectShape);

      lowerZoneFill.BooleanSubtract(lowerZoneOutline);

      return lowerZoneFill.Area();
    };

    const intersectionAreaOfZoneOutlines = (aZoneA: ZONE, aZoneB: ZONE): number => {
      const outLineA = new SHAPE_POLY_SET(aZoneA.Outline());
      outLineA.Inflate(
        inflateValue(aZoneA, aZoneB),
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_HIGH_DEF,
      );

      // upstream inflates aZoneA's outline twice (outLineB is also aZoneA)
      const outLineB = new SHAPE_POLY_SET(aZoneA.Outline());
      outLineB.Inflate(
        inflateValue(aZoneA, aZoneB),
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_HIGH_DEF,
      );

      outLineA.BooleanIntersection(outLineB);

      return outLineA.Area();
    };

    // Lambda to determine if the zone with template ID 'a' is lower priority than 'b'
    const isLowerPriority = (a: TEMPLATE_ID, b: TEMPLATE_ID): boolean => winning(b).has(a);

    const zones = this.m_zonesMap.entries();

    for (let i1 = 0; i1 < zones.length; i1++) {
      const [id1, thisZone] = zones[i1]!;
      const thisTemplate = this.Layout.Templates.at(id1);

      if (!thisZone.GetLayerSet().Contains(aLayer)) continue;

      for (let i2 = i1; i2 < zones.length; i2++) {
        const [id2, otherZone] = zones[i2]!;
        const otherTemplate = this.Layout.Templates.at(id2);

        if (thisTemplate.ID === otherTemplate.ID) continue;

        if (!otherZone.GetLayerSet().Contains(aLayer)) {
          this.checkPoint();
          continue;
        }

        if (intersectionAreaOfZoneOutlines(thisZone, otherZone) === 0) {
          this.checkPoint();
          continue; // The zones do not interact in any way
        }

        const thisZonePolyFill = thisZone.GetFilledPolysList(aLayer);
        const otherZonePolyFill = otherZone.GetFilledPolysList(aLayer);

        if (thisZonePolyFill.Area() > 0.0 && otherZonePolyFill.Area() > 0.0) {
          // Test if this zone were lower priority than other zone, what is the error?
          const areaThis = errorArea(thisZone, otherZone);
          // Vice-versa
          const areaOther = errorArea(otherZone, thisZone);

          if (areaThis > areaOther) {
            // thisTemplate is filled before otherTemplate
            winning(thisTemplate.ID).add(otherTemplate.ID);
          } else {
            // thisTemplate is filled AFTER otherTemplate
            winning(otherTemplate.ID).add(thisTemplate.ID);
          }
        } else if (thisZonePolyFill.Area() > 0.0) {
          // The other template is not filled, this one wins
          winning(thisTemplate.ID).add(otherTemplate.ID);
        } else if (otherZonePolyFill.Area() > 0.0) {
          // This template is not filled, the other one wins
          winning(otherTemplate.ID).add(thisTemplate.ID);
        } else {
          // Neither of the templates is poured - use zone outlines instead (bigger outlines
          // get a lower priority)
          if (intersectionAreaOfZoneOutlines(thisZone, otherZone) !== 0) {
            if (thisZone.Outline().Area() > otherZone.Outline().Area())
              winning(otherTemplate.ID).add(thisTemplate.ID);
            else winning(thisTemplate.ID).add(otherTemplate.ID);
          }
        }

        this.checkPoint();
      }
    }

    // Build a set of unique TEMPLATE_IDs of all the zones that intersect with another one
    const intersectingIDs = new Set<TEMPLATE_ID>();

    for (const [id, set] of winningOverlaps) {
      intersectingIDs.add(id);

      for (const x of set) intersectingIDs.add(x);
    }

    // Now store them in a vector
    const sortedIDs = sortedKeys(intersectingIDs);

    // sort by priority
    stdSort(sortedIDs, isLowerPriority);

    let prevID: TEMPLATE_ID = '';

    for (const id of sortedIDs) {
      if (prevID === '') {
        prevID = id;
        continue;
      }

      let newPriority = this.m_zonesMap.at(prevID).GetAssignedPriority();

      // Only increase priority of the current zone
      if (isLowerPriority(prevID, id)) newPriority++;

      this.m_zonesMap.at(id).SetAssignedPriority(newPriority);
      prevID = id;
    }

    // Verify
    for (const [winningID, set] of winningOverlaps) {
      for (const losingID of sortedKeys(set)) {
        if (
          this.m_zonesMap.at(losingID).GetAssignedPriority() >
          this.m_zonesMap.at(winningID).GetAssignedPriority()
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private getFootprintFromCadstarID(aCadstarComponentID: COMPONENT_ID): FOOTPRINT | null {
    return this.m_componentMap.get(aCadstarComponentID) ?? null;
  }

  /** Scales, offsets and inverts y axis to make the point usable directly in KiCad. */
  private getKiCadPoint(aCadstarPoint: VECTOR2I): VECTOR2I {
    return {
      x: toInt((aCadstarPoint.x - this.m_designCenter.x) * this.KiCadUnitMultiplier),
      y: toInt(-(aCadstarPoint.y - this.m_designCenter.y) * this.KiCadUnitMultiplier),
    };
  }

  private getKiCadLength(aCadstarLength: number): number {
    return toInt(aCadstarLength * this.KiCadUnitMultiplier);
  }

  private getAngleTenthDegree(aCadstarAngle: number): number {
    if (this.Header.Format.Version > 8) return aCadstarAngle / 100.0;

    return aCadstarAngle;
  }

  private getAngle(aCadstarAngle: number): EDA_ANGLE {
    // CADSTAR v6 (which outputted Format.Version 8) and earlier used 1/10 degree
    // as the unit for angles/orientations. It is assumed that CADSTAR version 7
    // (i.e. Format.Version 9 and later) use 1/1000 of a degree
    if (this.Header.Format.Version > 8) return new EDA_ANGLE(aCadstarAngle / 1000.0);

    return new EDA_ANGLE(Math.trunc(aCadstarAngle), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
  }

  private getAngleDegrees(aCadstarAngle: number): number {
    return this.getAngleTenthDegree(aCadstarAngle) / 10.0;
  }

  private getKiCadNet(aCadstarNetID: NET_ID): NETINFO_ITEM | null {
    if (aCadstarNetID === '') return null;

    const existing = this.m_netMap.get(aCadstarNetID);

    if (existing) return existing;

    const csNet: NET_PCB | undefined = this.Layout.Nets.get(aCadstarNetID);

    if (!csNet) return null;

    let newName = csNet.Name;

    if (csNet.Name === '') {
      if (csNet.Pins.size > 0) {
        // Create default KiCad net naming:
        const firstPin = csNet.Pins.values()[0]!;
        //we should have already loaded the component with loadComponents() :
        const m = this.getFootprintFromCadstarID(firstPin.ComponentID)!;
        newName = `Net-(${m.Reference().GetText()}-Pad${firstPin.PadID})`;
      } else {
        // "A net with no pins associated?"
        newName = `csNet-${csNet.SignalNum}`;
      }
    }

    if (!this.m_doneNetClassWarning && csNet.NetClassID !== '' && csNet.NetClassID !== 'NONE') {
      // wxLogMessage: net classes were not imported
      this.m_doneNetClassWarning = true;
    }

    if (
      !this.m_doneSpacingClassWarning &&
      csNet.SpacingClassID !== '' &&
      csNet.SpacingClassID !== 'NONE'
    ) {
      // wxLogWarning: spacing classes were not imported
      this.m_doneSpacingClassWarning = true;
    }

    const netSettings = this.board.GetDesignSettings().m_NetSettings;
    const netInfo = new NETINFO_ITEM(this.board, newName, ++this.m_numNets);
    let netclass: NETCLASS;

    const key = JSON.stringify([csNet.RouteCodeID, csNet.NetClassID, csNet.SpacingClassID]);
    const rc = this.Assignments.Codedefs.RouteCodes.get(csNet.RouteCodeID);

    if (this.m_netClassMap.has(key)) {
      netclass = this.m_netClassMap.get(key)!;
    } else if (csNet.RouteCodeID !== '' && rc && rc.OptimalWidth > 0) {
      let netClassName = '';

      const routeCode = this.getRouteCode(csNet.RouteCodeID);
      netClassName += `Route code: ${routeCode.Name}`;

      if (csNet.NetClassID !== '') {
        const nc = this.Assignments.Codedefs.NetClasses.at(csNet.NetClassID);
        netClassName += ` | Net class: ${nc.Name}`;
      }

      if (csNet.SpacingClassID !== '') {
        const sp = this.Assignments.Codedefs.SpacingClassNames.at(csNet.SpacingClassID);
        netClassName += ` | Spacing class: ${sp.Name}`;
      }

      netclass = new NETCLASS(netClassName);
      netSettings.SetNetclass(netClassName, netclass);
      netclass.SetTrackWidth(this.getKiCadLength(routeCode.OptimalWidth));
      this.m_netClassMap.set(key, netclass);
    } else {
      netclass = netSettings.GetDefaultNetclass();
    }

    netSettings.SetNetclassPatternAssignment(newName, netclass.GetName());
    netInfo.SetNetClass(netclass);

    this.board.Add(netInfo, ADD_MODE.APPEND);
    this.m_netMap.insert(aCadstarNetID, netInfo);

    return netInfo;
  }

  private getKiCadCopperLayerID(aLayerNum: number, aDetectMaxLayer = true): PCB_LAYER_ID {
    if (aDetectMaxLayer && aLayerNum === this.m_numCopperLayers) return PCB_LAYER_ID.B_Cu;

    if (aLayerNum === 1) return PCB_LAYER_ID.F_Cu;

    if (aLayerNum >= 2 && aLayerNum <= 31)
      return (PCB_LAYER_ID.In1_Cu + (aLayerNum - 2) * 2) as PCB_LAYER_ID;

    if (aLayerNum === 32) return PCB_LAYER_ID.B_Cu;

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  private isLayerSet(aCadstarLayerID: LAYER_ID): boolean {
    const layer = this.Assignments.Layerdefs.Layers.get(aCadstarLayerID);

    if (!layer) return false;

    switch (layer.Type) {
      case LAYER_TYPE.ALLDOC:
      case LAYER_TYPE.ALLELEC:
      case LAYER_TYPE.ALLLAYER:
        return true;
      default:
        return false;
    }
  }

  private getKiCadLayer(aCadstarLayerID: LAYER_ID): PCB_LAYER_ID {
    if (this.getLayerType(aCadstarLayerID) === LAYER_TYPE.NOLAYER) {
      //The "no layer" is common for CADSTAR documentation symbols
      //map it to undefined layer for later processing
      return PCB_LAYER_ID.UNDEFINED_LAYER;
    }

    return this.m_layermap.get(aCadstarLayerID) ?? PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  private getKiCadLayerSet(aCadstarLayerID: LAYER_ID): LSET {
    const docs = new LSET([
      PCB_LAYER_ID.Dwgs_User,
      PCB_LAYER_ID.Cmts_User,
      PCB_LAYER_ID.Eco1_User,
      PCB_LAYER_ID.Eco2_User,
    ]);

    switch (this.getLayerType(aCadstarLayerID)) {
      case LAYER_TYPE.ALLDOC:
        return docs.or(LSET.UserDefinedLayersMask());

      case LAYER_TYPE.ALLELEC:
        return LSET.AllCuMask(this.m_numCopperLayers);

      case LAYER_TYPE.ALLLAYER:
        return LSET.AllCuMask(this.m_numCopperLayers)
          .or(docs)
          .or(LSET.UserDefinedLayersMask())
          .or(LSET.AllBoardTechMask());

      default:
        return new LSET([this.getKiCadLayer(aCadstarLayerID)]);
    }
  }

  private addToGroup(aCadstarGroupID: GROUP_ID, aKiCadItem: BOARD_ITEM): void {
    const parentGroup = this.m_groupMap.get(aCadstarGroupID);

    if (!parentGroup) return;

    parentGroup.AddItem(aKiCadItem);
  }

  private createUniqueGroupID(aName: string): GROUP_ID {
    let groupName = aName;
    let num = 0;

    while (this.m_groupMap.has(groupName)) groupName = `${aName}_${++num}`;

    const docSymGroup = new PCB_GROUP(this.board);
    this.board.Add(docSymGroup);
    docSymGroup.SetName(groupName);
    this.m_groupMap.insert(groupName, docSymGroup);

    return groupName;
  }
}
