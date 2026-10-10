// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/ipc2581/pcb_io_ipc2581.{h,cpp}`: `PCB_IO_IPC2581`, the IPC-2581 (revision B or
 * C) fabrication export - File > Fabrication Outputs > IPC-2581 File and
 * `kicad-cli pcb export ipc2581`.
 *
 * The dictionaries upstream keys by `hash_fp_item` / `hash_combine` (`std::map<size_t, …>`) are
 * only ever looked up, never walked, so the canonical-string form of hash_eda.ts gives the same
 * de-duplication and the same `LINE_n` / `RECT_n` / `PADSTACK_n` numbering (insertion order).
 *
 * Three orders upstream are memory addresses, reproduced here as load order (footprints are
 * allocated in the order the board lists them): the layer-feature sort by parent footprint
 * pointer, `m_OEMRef_dict` (`std::map<FOOTPRINT*, …>`, the AVL's walk), and the footprint-less
 * items, whose null parent sorts first.
 *
 * The file is written through the plugin's file writer (IO_BASE.SetFileWriter); the HistoryRecord
 * and AvlHeader carry the export time, as upstream's do.
 */
import { SHAPE_T, FILL_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import {
  PCB_LAYER_ID,
  FlipLayer,
  IsCopperLayer,
  IsFrontLayer,
  IsNonCopperLayer,
  IsValidLayer,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { wxXmlDocumentSave } from '@ziroeda/common/wx/xml.js';
import { wxXmlNodeType, XNODE } from '@ziroeda/common/xnode.js';
import { CALLBACK_GAL } from '@ziroeda/common/callback_gal.js';
import { setFromHexString } from '@ziroeda/common/gal/color4d.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import { GetMajorMinorPatchVersion } from '@ziroeda/common/build_version.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import {
  ERROR_LOC,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_90, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  type POLYGON,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../../board.js';
import type { BOARD_ITEM } from '../../board_item.js';
import {
  BOARD_STACKUP_ITEM_TYPE,
  type BOARD_STACKUP_ITEM,
  IsPrmSpecified,
  KEY_CORE,
} from '../../board_stackup_manager/board_stackup.js';
import { GetStandardColors } from '../../board_stackup_manager/stackup_predefined_prms.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { FOOTPRINT, FOOTPRINT_ATTR_T } from '../../footprint.js';
import { hash_fp_item, HASH_FLAGS } from '../../hash_eda.js';
import { PAD, PAD_ATTRIB, PAD_SHAPE } from '../../pad.js';
import {
  PADSTACK,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  type PADSTACK_DRILL_PROPS as DRILL_PROPS,
  type PADSTACK_POST_MACHINING_PROPS as POST_MACHINING_PROPS,
} from '../../padstack.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import type { PCB_TEXT } from '../../pcb_text.js';
import type { PCB_TEXTBOX } from '../../pcb_textbox.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import type { ZONE } from '../../zone.js';
import { PCB_IO, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { auxLayerType, surfaceFinishType } from './ipc2581_types.js';

type wxXmlNode = XNODE;

const newNode = (aName: string): XNODE => new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, aName);

/** `std::map<K, V>` walked in key order: the keys sorted, compared as C++ would. */
function sortedEntries<V>(aMap: Map<string, V>, aKey: (s: string) => number[]): [string, V][] {
  return [...aMap].sort(([a], [b]) => {
    const ka = aKey(a);
    const kb = aKey(b);

    for (let i = 0; i < Math.min(ka.length, kb.length); i++)
      if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;

    return ka.length - kb.length;
  });
}

const numKey = (s: string): number[] => s.split(',').map(Number);

/** `wxString` ordering: code unit by code unit. */
const strCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `wxString::Strip( both )`: wxSafeIsspace, ASCII white space only. */
const wxStrip = (s: string): string => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');

// Extend the padstack identity with secondary/tertiary drill (backdrill) and
// post-machining data so pads/vias with identical geometry but different
// backdrill configuration do not collapse onto the same padstack entry.
function mixBackdrillIntoPadstackHash(aHash: string, aPadstack: PADSTACK): string {
  const mixDrill = (aDrill: DRILL_PROPS): string =>
    [
      aDrill.start,
      aDrill.end,
      aDrill.size.x,
      aDrill.size.y,
      aDrill.shape,
      aDrill.is_capped !== null && aDrill.is_capped !== undefined,
      aDrill.is_capped ?? false,
      aDrill.is_filled !== null && aDrill.is_filled !== undefined,
      aDrill.is_filled ?? false,
    ].join(',');

  const mixPostMachining = (aPost: POST_MACHINING_PROPS): string =>
    [
      aPost.mode !== null && aPost.mode !== undefined,
      aPost.mode ?? PAD_DRILL_POST_MACHINING_MODE.UNKNOWN,
      aPost.size,
      aPost.depth,
      aPost.angle,
    ].join(',');

  return [
    aHash,
    mixDrill(aPadstack.SecondaryDrill()),
    mixDrill(aPadstack.TertiaryDrill()),
    mixPostMachining(aPadstack.FrontPostMachining()),
    mixPostMachining(aPadstack.BackPostMachining()),
  ].join('|');
}

function ipcPadstackHash(aItem: PCB_VIA | PAD): string {
  return mixBackdrillIntoPadstackHash(hash_fp_item(aItem, 0), aItem.Padstack());
}

/** Map KiCad surface finish strings to IPC-6012 surfaceFinishType enum. */
const surfaceFinishMap = new Map<string, surfaceFinishType>([
  ['', surfaceFinishType.NONE],
  ['ENIG', surfaceFinishType.ENIG_N],
  ['ENEPIG', surfaceFinishType.ENEPIG_N],
  ['HAL SNPB', surfaceFinishType.S],
  ['HAL LEAD-FREE', surfaceFinishType.S],
  ['HARD GOLD', surfaceFinishType.G],
  ['IMMERSION TIN', surfaceFinishType.ISN],
  ['IMMERSION NICKEL', surfaceFinishType.N],
  ['IMMERSION SILVER', surfaceFinishType.IAG],
  ['IMMERSION GOLD', surfaceFinishType.DIG],
  ['HT_OSP', surfaceFinishType.HT_OSP],
  ['OSP', surfaceFinishType.OSP],
  ['NONE', surfaceFinishType.NONE],
  ['NOT SPECIFIED', surfaceFinishType.NONE],
  ['USER DEFINED', surfaceFinishType.NONE],
]);

/** Map surfaceFinishType enum to IPC-2581 XML string values. */
const surfaceFinishTypeToString = new Map<surfaceFinishType, string>([
  [surfaceFinishType.ENIG_N, 'ENIG-N'],
  [surfaceFinishType.ENEPIG_N, 'ENEPIG-N'],
  [surfaceFinishType.OSP, 'OSP'],
  [surfaceFinishType.HT_OSP, 'HT_OSP'],
  [surfaceFinishType.IAG, 'IAg'],
  [surfaceFinishType.ISN, 'ISn'],
  [surfaceFinishType.G, 'G'],
  [surfaceFinishType.N, 'N'],
  [surfaceFinishType.DIG, 'DIG'],
  [surfaceFinishType.S, 'S'],
  [surfaceFinishType.OTHER, 'OTHER'],
]);

function getSurfaceFinishType(aFinish: string): surfaceFinishType {
  return surfaceFinishMap.get(aFinish.toUpperCase()) ?? surfaceFinishType.OTHER;
}

// Map the top-level CadHeader/units value to the propertyUnitType enum used
// inside <Property unit="..."/>. The two enumerations differ (MILLIMETER vs MM).
function propertyUnitForCadUnits(aCadUnits: string): string {
  if (aCadUnits === 'MILLIMETER') return 'MM';

  if (aCadUnits === 'MICRON') return 'MICRON';

  if (aCadUnits === 'INCH') return 'INCH';

  return 'MM';
}

function isOppositeSideSilk(aFootprint: FOOTPRINT | null, aLayer: PCB_LAYER_ID): boolean {
  if (!aFootprint) return false;

  if (aLayer !== PCB_LAYER_ID.F_SilkS && aLayer !== PCB_LAYER_ID.B_SilkS) return false;

  if (aFootprint.IsFlipped()) return aLayer === PCB_LAYER_ID.F_SilkS;

  return aLayer === PCB_LAYER_ID.B_SilkS;
}

/** `wxDateTime::Now().FormatISOCombined()`: local time, `YYYY-MM-DDTHH:MM:SS`. */
function nowISOCombined(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `wxFileName( path ).GetName()`. */
function fileNameName(aPath: string): string {
  const base = aPath.substring(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.substring(0, dot) : base;
}

interface REFDES {
  m_name: string;
  m_pkg: string;
  m_populate: boolean;
  m_layer: string;
}

interface BOM_ENTRY {
  m_OEMDesignRef: string; // String combining LIB+FP+VALUE
  m_count: number;
  m_pads: number;
  m_type: string;
  m_description: string;
  m_refdes: REFDES[];
  /** std::map: emplace keeps the first value, walked sorted. */
  m_props: Map<string, string>;
}

export class PCB_IO_IPC2581 extends PCB_IO {
  private m_total_bytes = 0; //<! Total number of bytes to be written
  private m_units_str = ''; //<! Output string for units
  private m_scale = 1.0; //<! Scale factor from IU to IPC2581 units (mm, micron, in)
  private m_sigfig = 3; //<! Max number of digits past the decimal point
  private m_version = 'B'; //<! Currently, either 'B' or 'C' for the IPC2581 version
  private m_OEMRef = ''; //<! If set, field name containing the internal ID of parts
  private m_mpn = ''; //<! If set, field name containing the manufacturer part number
  private m_mfg = ''; //<! If set, field name containing the part manufacturer
  private m_distpn = ''; //<! If set, field name containing the distributor part number
  private m_dist = ''; //<! If set, field name containing the distributor name
  private m_bomRev = ''; //<! BOM revision string for the BomHeader element

  // Node pointer to the main enterprise node to be used for adding
  // enterprises later when forming the AVL
  private m_enterpriseNode: wxXmlNode | null = null;
  private readonly m_loaded_footprints: FOOTPRINT[] = [];

  private m_user_shape_dict = new Map<string, string>();
  private m_shape_user_node: wxXmlNode | null = null;
  private m_std_shape_dict = new Map<string, string>();
  private m_shape_std_node: wxXmlNode | null = null;
  private m_line_dict = new Map<string, string>();
  private m_line_node: wxXmlNode | null = null;
  private m_padstack_dict = new Map<string, string>();
  private m_padstacks: wxXmlNode[] = [];
  private m_last_padstack: wxXmlNode | null = null;

  private m_padstack_backdrill_specs = new Map<string, [string, string]>();
  /** std::map<wxString, …>: walked sorted. */
  private m_backdrill_spec_nodes = new Map<string, wxXmlNode>();
  private m_backdrill_spec_used = new Set<string>();
  private m_backdrill_spec_index = 0;
  private m_cad_header_node: wxXmlNode | null = null;

  private m_footprint_dict = new Map<string, string>();
  private m_footprint_refdes_dict = new Map<string, FOOTPRINT>();
  private m_footprint_refdes_reverse_dict = new Map<FOOTPRINT, string>();
  /** std::map<FOOTPRINT*, …>: walked in pointer order, here the board's footprint order. */
  private m_OEMRef_dict = new Map<FOOTPRINT, string>();
  /** std::map<int, …>: walked by netcode. */
  private m_net_pin_dict = new Map<number, [string, string][]>();
  /** std::map<PCB_LAYER_ID, wxString>: emplace keeps the first, operator[] inserts "". */
  private m_layer_name_map = new Map<PCB_LAYER_ID, string>();
  /** std::map<std::pair<PCB_LAYER_ID, PCB_LAYER_ID>, …>, keyed "from,to". */
  private m_drill_layers = new Map<string, BOARD_ITEM[]>();
  private m_slot_holes = new Map<string, PAD[]>();
  /** std::map<std::tuple<auxLayerType, PCB_LAYER_ID, PCB_LAYER_ID>, …>, keyed "type,a,b". */
  private m_auxilliary_Layers = new Map<string, BOARD_ITEM[]>();

  private m_element_names = new Set<string>(); //<! Track generated element names
  private m_generated_names = new Map<string, string>(); //<! Map input keys to unique names
  private m_acceptable_chars = new Set<string>(); //<! IPC2581B and C have differing sets of allowed characters in names

  private m_xml_root: wxXmlNode | null = null;
  private m_contentNode: wxXmlNode | null = null;

  constructor() {
    super('IPC-2581');
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', [], [], false, false, true);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    // No library description for this plugin
    return new IO_FILE_DESC('', []);
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    return this.m_loaded_footprints.map((fp) => fp.Clone());
  }

  override GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  // Reading currently disabled
  override CanReadBoard(_aFileName: string): boolean {
    return false;
  }

  // Reading currently disabled
  override CanReadFootprint(_aFileName: string): boolean {
    return false;
  }

  // Reading currently disabled
  override CanReadLibrary(_aFileName: string): boolean {
    return false;
  }

  private get board(): BOARD {
    return this.m_board!;
  }

  /** `m_layer_name_map[ aLayer ]`: inserts an empty name when absent. */
  private layerName(aLayer: PCB_LAYER_ID): string {
    if (!this.m_layer_name_map.has(aLayer)) this.m_layer_name_map.set(aLayer, '');

    return this.m_layer_name_map.get(aLayer)!;
  }

  /** `m_layer_name_map.emplace( aLayer, aName )`. */
  private emplaceLayerName(aLayer: PCB_LAYER_ID, aName: string): void {
    if (!this.m_layer_name_map.has(aLayer)) this.m_layer_name_map.set(aLayer, aName);
  }

  // ---------------------------------------------------------------------------------------------
  // Node helpers
  // ---------------------------------------------------------------------------------------------

  private insertNodeAt(aParent: wxXmlNode, aNode: wxXmlNode): void {
    // insertNode places the node at the start of the list of children
    aParent.InsertChildAfter(aNode, null);
    this.m_total_bytes += 2 * aNode.GetName().length + 5;
  }

  private insertNodeAfter(aPrev: wxXmlNode, aNode: wxXmlNode): void {
    // insertNode places the node directly after aPrev
    aPrev.GetParent()!.InsertChildAfter(aNode, aPrev);
    this.m_total_bytes += 2 * aNode.GetName().length + 5;
  }

  private insertNode(aParent: wxXmlNode, aName: string): wxXmlNode {
    // Opening tag, closing tag, brackets and the closing slash
    this.m_total_bytes += 2 * aName.length + 5;
    const node = newNode(aName);
    this.insertNodeAt(aParent, node);
    return node;
  }

  private appendNode(aParent: wxXmlNode, aName: string): wxXmlNode {
    const node = newNode(aName);

    this.appendExisting(aParent, node);
    return node;
  }

  private appendExisting(aParent: wxXmlNode, aNode: wxXmlNode): void {
    aParent.AddChild(aNode);

    // Opening tag, closing tag, brackets and the closing slash
    this.m_total_bytes += 2 * aNode.GetName().length + 5;
  }

  private addAttribute(aNode: wxXmlNode, aName: string, aValue: string): void {
    this.m_total_bytes += aName.length + aValue.length + 4;
    aNode.AddAttribute(aName, aValue);
  }

  // ---------------------------------------------------------------------------------------------
  // Names
  // ---------------------------------------------------------------------------------------------

  private sanitizeId(aStr: string): string {
    if (this.m_version === 'C') return aStr.replaceAll(':', '_');

    let str = '';

    for (const ch of aStr) str += this.m_acceptable_chars.has(ch) ? ch : '_';

    return str;
  }

  private genString(aStr: string, aPrefix: string | null = null): string {
    // Build a key using the prefix and original string so that repeated calls for the same
    // element return the same generated name.
    const key = aPrefix !== null ? `${aPrefix}:${aStr}` : aStr;

    const known = this.m_generated_names.get(key);

    if (known !== undefined) return known;

    const base = this.sanitizeId(aStr);
    let name = base;
    let suffix = 1;

    while (this.m_element_names.has(name)) name = `${base}_${suffix++}`;

    this.m_element_names.add(name);
    this.m_generated_names.set(key, name);

    return name;
  }

  private genLayerString(aLayer: PCB_LAYER_ID, aPrefix: string): string {
    return this.genString(this.board.GetLayerName(aLayer), aPrefix);
  }

  private stackupLayerName(
    aItem: BOARD_STACKUP_ITEM,
    aSublayerId: number,
    aPrefix: string,
  ): string {
    let name: string;

    if (aItem.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
      name = `DIELECTRIC_${aItem.GetDielectricLayerId()}`;
    } else {
      name = aItem.GetLayerName();

      if (name === '' && IsValidLayer(aItem.GetBrdLayerId()))
        name = this.board.GetLayerName(aItem.GetBrdLayerId());
    }

    if (aSublayerId > 0) name += `_${aSublayerId}`;

    return this.genString(name, aPrefix);
  }

  private genLayersString(aTop: PCB_LAYER_ID, aBottom: PCB_LAYER_ID, aPrefix: string): string {
    return this.genString(
      `${this.board.GetLayerName(aTop)}_${this.board.GetLayerName(aBottom)}`,
      aPrefix,
    );
  }

  private pinName(aPad: PAD): string {
    let name = aPad.GetNumber();

    const fp = aPad.GetParentFootprint();
    let ii = 0;

    if (name === '' && fp) {
      for (ii = 0; ii < fp.GetPadCount(); ++ii) {
        if (fp.Pads()[ii] === aPad) break;
      }
    }

    // Pins are required to have names, so if our pad doesn't have a name, we need to
    // generate one that is unique
    if (aPad.GetAttribute() === PAD_ATTRIB.NPTH) name = `NPTH${ii}`;
    else if (name === '') name = `PAD${ii}`;

    // Pins are scoped per-package, so we only sanitize; uniqueness is handled by
    // the per-package pin_nodes map in addPackage().
    return this.sanitizeId(name);
  }

  private componentName(aFootprint: FOOTPRINT): string {
    const tryInsert = (aName: string): boolean => {
      const held = this.m_footprint_refdes_dict.get(aName);

      if (held !== undefined) {
        if (held !== aFootprint) return false;
      } else {
        this.m_footprint_refdes_dict.set(aName, aFootprint);
      }

      return true;
    };

    const known = this.m_footprint_refdes_reverse_dict.get(aFootprint);

    if (known !== undefined) return known;

    let ref = aFootprint.GetReference();

    if (ref === '') ref = `NOREF_${aFootprint.m_Uuid.substring(0, 8)}`;

    const baseName = this.genString(ref, 'CMP');
    let name = baseName;
    let suffix = 1;

    while (!tryInsert(name)) name = `${baseName}_${suffix++}`;

    this.m_footprint_refdes_reverse_dict.set(aFootprint, name);

    return name;
  }

  /** `wxString::FromCDouble( aVal, digits )`, trailing zeros trimmed to one. */
  private floatVal(aVal: number, aSigFig = -1): string {
    let str = fixed(aVal, aSigFig === -1 ? this.m_sigfig : aSigFig);

    // Remove all but the last trailing zeros from str
    while (str.endsWith('00')) str = str.slice(0, -1);

    // We don't want to output -0.0 as this value is just 0 for fabs
    if (str === '-0.0') return '0.0';

    return str;
  }

  private addXY(
    aNode: wxXmlNode,
    aVec: VECTOR2I,
    aXName: string | null = null,
    aYName: string | null = null,
  ): void {
    this.addAttribute(aNode, aXName ?? 'x', this.floatVal(this.m_scale * aVec.x));
    this.addAttribute(aNode, aYName ?? 'y', this.floatVal(-this.m_scale * aVec.y));
  }

  // ---------------------------------------------------------------------------------------------
  // Header and content
  // ---------------------------------------------------------------------------------------------

  private generateXmlHeader(): wxXmlNode {
    const xmlHeaderNode = newNode('IPC-2581');
    this.addAttribute(xmlHeaderNode, 'revision', this.m_version);
    this.addAttribute(xmlHeaderNode, 'xmlns', 'http://webstds.ipc.org/2581');
    this.addAttribute(xmlHeaderNode, 'xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    this.addAttribute(xmlHeaderNode, 'xmlns:xsd', 'http://www.w3.org/2001/XMLSchema');

    if (this.m_version === 'B') {
      this.addAttribute(
        xmlHeaderNode,
        'xsi:schemaLocation',
        'http://webstds.ipc.org/2581 http://webstds.ipc.org/2581/IPC-2581B1.xsd',
      );
    } else {
      this.addAttribute(
        xmlHeaderNode,
        'xsi:schemaLocation',
        'http://webstds.ipc.org/2581 http://webstds.ipc.org/2581/IPC-2581C.xsd',
      );
    }

    return xmlHeaderNode;
  }

  private generateContentSection(): wxXmlNode {
    this.m_progressReporter?.AdvancePhase('Generating content section');

    this.m_contentNode = this.appendNode(this.m_xml_root!, 'Content');
    const contentNode = this.m_contentNode;
    this.addAttribute(contentNode, 'roleRef', 'Owner');

    let node = this.appendNode(contentNode, 'FunctionMode');
    this.addAttribute(node, 'mode', 'ASSEMBLY');

    // This element is deprecated in revision 'C' and later
    if (this.m_version === 'B') this.addAttribute(node, 'level', '3');

    node = this.appendNode(contentNode, 'StepRef');
    this.addAttribute(
      node,
      'name',
      this.genString(fileNameName(this.board.GetFileName()), 'BOARD'),
    );

    const color_node = this.generateContentStackup(contentNode);

    if (this.m_version === 'C') {
      contentNode.AddChild(color_node);
      this.m_line_node = this.appendNode(contentNode, 'DictionaryLineDesc');
      this.addAttribute(this.m_line_node, 'units', this.m_units_str);

      const fillNode = this.appendNode(contentNode, 'DictionaryFillDesc');
      this.addAttribute(fillNode, 'units', this.m_units_str);

      this.m_shape_std_node = this.appendNode(contentNode, 'DictionaryStandard');
      this.addAttribute(this.m_shape_std_node, 'units', this.m_units_str);

      this.m_shape_user_node = this.appendNode(contentNode, 'DictionaryUser');
      this.addAttribute(this.m_shape_user_node, 'units', this.m_units_str);
    } else {
      this.m_shape_std_node = this.appendNode(contentNode, 'DictionaryStandard');
      this.addAttribute(this.m_shape_std_node, 'units', this.m_units_str);

      this.m_shape_user_node = this.appendNode(contentNode, 'DictionaryUser');
      this.addAttribute(this.m_shape_user_node, 'units', this.m_units_str);

      this.m_line_node = this.appendNode(contentNode, 'DictionaryLineDesc');
      this.addAttribute(this.m_line_node, 'units', this.m_units_str);

      contentNode.AddChild(color_node);
    }

    return contentNode;
  }

  private addLocationXY(aNode: wxXmlNode, aX: number, aY: number): void {
    const location_node = this.appendNode(aNode, 'Location');
    // VECTOR2I( double, double ): the int conversion truncates.
    this.addXY(location_node, { x: Math.trunc(aX), y: Math.trunc(aY) });
  }

  private addLocationPad(aNode: wxXmlNode, aPad: PAD, aRelative: boolean): void {
    const at = aRelative ? aPad.GetFPRelativePosition() : aPad.GetPosition();
    const pos = { x: at.x, y: at.y };
    const offset = aPad.GetOffset(PADSTACK.ALL_LAYERS);

    if (offset.x !== 0 || offset.y !== 0) {
      pos.x += offset.x;
      pos.y += offset.y;
    }

    this.addLocationXY(aNode, pos.x, pos.y);
  }

  private addLocationShape(aNode: wxXmlNode, aShape: PCB_SHAPE): void {
    let pos = { x: 0, y: 0 };

    switch (aShape.GetShape()) {
      // Rectangles in KiCad are mapped by their corner while IPC2581 uses the center
      case SHAPE_T.RECTANGLE: {
        const p = aShape.GetPosition();
        pos = {
          x: p.x + Math.trunc(aShape.GetRectangleWidth() / 2.0),
          y: p.y + Math.trunc(aShape.GetRectangleHeight() / 2.0),
        };
        break;
      }
      // Both KiCad and IPC2581 use the center of the circle
      case SHAPE_T.CIRCLE:
        pos = aShape.GetPosition();
        break;

      // KiCad uses the exact points on the board, so we want the reference location to be 0,0
      default:
        pos = { x: 0, y: 0 };
        break;
    }

    this.addLocationXY(aNode, pos.x, pos.y);
  }

  private lineHash(aWidth: number, aDashType: LINE_STYLE): string {
    return `${aWidth},${aDashType}`;
  }

  private shapeHash(aShape: PCB_SHAPE): string {
    let hash = hash_fp_item(aShape, HASH_FLAGS.HASH_POS | HASH_FLAGS.REL_COORD);

    // hash_fp_item does not distinguish rectangles by their corner radius, so two rects that
    // differ only in radius would otherwise share one primitive.
    if (aShape.GetShape() === SHAPE_T.RECTANGLE) hash += `|r${aShape.GetCornerRadius()}`;

    return hash;
  }

  private generateContentStackup(aContentNode: wxXmlNode): wxXmlNode {
    const bds = this.board.GetDesignSettings();
    const stackup = bds.GetStackupDescriptor();
    stackup.SynchronizeWithBoard(bds);

    const color_node = newNode('DictionaryColor');

    for (const item of stackup.GetList()) {
      for (let sub_idx = 0; sub_idx < item.GetSublayersCount(); sub_idx++) {
        const sub_layer_name = this.stackupLayerName(item, sub_idx, 'LAYER');

        if (sub_idx === 0 && item.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)
          this.emplaceLayerName(item.GetBrdLayerId(), sub_layer_name);

        const node = this.appendNode(aContentNode, 'LayerRef');
        this.addAttribute(node, 'name', sub_layer_name);

        if (!IsPrmSpecified(item.GetColor(sub_idx))) continue;

        const entry_color = this.appendNode(color_node, 'EntryColor');
        this.addAttribute(entry_color, 'id', this.genString(sub_layer_name, 'COLOR'));
        const color = this.appendNode(entry_color, 'Color');

        const colorName = item.GetColor(sub_idx);

        if (colorName.startsWith('#')) {
          // This is a user defined color, not in standard color list.
          const layer_color = setFromHexString(colorName)!;
          this.addAttribute(color, 'r', String(KiROUND(layer_color.r * 255)));
          this.addAttribute(color, 'g', String(KiROUND(layer_color.g * 255)));
          this.addAttribute(color, 'b', String(KiROUND(layer_color.b * 255)));
        } else {
          for (const fab_color of GetStandardColors(item.GetType())) {
            if (fab_color.GetName() === colorName) {
              const c = fab_color.GetColor(item.GetType());
              this.addAttribute(color, 'r', String(KiROUND(c.r * 255)));
              this.addAttribute(color, 'g', String(KiROUND(c.g * 255)));
              this.addAttribute(color, 'b', String(KiROUND(c.b * 255)));
              break;
            }
          }
        }
      }
    }

    return color_node;
  }

  private addFillDesc(aNode: wxXmlNode, aFill: FILL_T, aForce = false): void {
    if (aFill === FILL_T.FILLED_SHAPE) {
      // By default, we do not fill shapes because FILL is the default value for most.
      // But for some outlines, we may need to force a fill.
      if (aForce) {
        const fillDesc_node = this.appendNode(aNode, 'FillDesc');
        this.addAttribute(fillDesc_node, 'fillProperty', 'FILL');
      }
    } else {
      const fillDesc_node = this.appendNode(aNode, 'FillDesc');
      this.addAttribute(fillDesc_node, 'fillProperty', 'HOLLOW');
    }
  }

  private addLineDesc(
    aNode: wxXmlNode,
    aWidth: number,
    aDashType: LINE_STYLE,
    aForce = false,
  ): void {
    if (aWidth < 0) return;

    let entry_node: wxXmlNode;

    if (!aForce) {
      const hash = this.lineHash(aWidth, aDashType);
      const name = `LINE_${this.m_line_dict.size + 1}`;
      const inserted = !this.m_line_dict.has(hash);

      if (inserted) this.m_line_dict.set(hash, name);

      // Either add a new entry or reference an existing one
      const lineDesc_node = this.appendNode(aNode, 'LineDescRef');
      this.addAttribute(lineDesc_node, 'id', this.m_line_dict.get(hash)!);

      if (!inserted) return;

      entry_node = this.appendNode(this.m_line_node!, 'EntryLineDesc');
      this.addAttribute(entry_node, 'id', name);
    } else {
      // Force the LineDesc to be added directly to the parent node
      entry_node = aNode;
    }

    const line_node = this.appendNode(entry_node, 'LineDesc');
    this.addAttribute(line_node, 'lineWidth', this.floatVal(this.m_scale * aWidth));
    this.addAttribute(line_node, 'lineEnd', 'ROUND');

    switch (aDashType) {
      case LINE_STYLE.DOT:
        this.addAttribute(line_node, 'lineProperty', 'DOTTED');
        break;
      case LINE_STYLE.DASH:
        this.addAttribute(line_node, 'lineProperty', 'DASHED');
        break;
      case LINE_STYLE.DASHDOT:
        this.addAttribute(line_node, 'lineProperty', 'CENTER');
        break;
      case LINE_STYLE.DASHDOTDOT:
        this.addAttribute(line_node, 'lineProperty', 'PHANTOM');
        break;
      default:
        break;
    }
  }

  private addKnockoutText(aContentNode: wxXmlNode, aText: PCB_TEXT): void {
    const finalPoly = new SHAPE_POLY_SET();

    aText.TransformTextToPolySet(finalPoly, 0, ARC_HIGH_DEF, ERROR_LOC.ERROR_INSIDE);
    finalPoly.Fracture();

    const outlineCount = finalPoly.OutlineCount();

    if (outlineCount === 0) return;

    // The IPC-2581 schema allows only one top-level Feature under Features/Marking,
    // so wrap multiple glyph contours in a UserSpecial (a UserPrimitive Feature that
    // may contain any number of child Features).

    if (outlineCount === 1) {
      this.addContourNode(aContentNode, finalPoly, 0);
      return;
    }

    const special_node = this.appendNode(aContentNode, 'UserSpecial');

    for (let ii = 0; ii < outlineCount; ++ii) this.addContourNode(special_node, finalPoly, ii);
  }

  private addText(aContentNode: wxXmlNode, aText: PCB_TEXT | PCB_TEXTBOX): void {
    const font = aText.GetDrawFont(null);
    const attrs = aText.GetAttributes().clone();

    attrs.m_StrokeWidth = aText.GetEffectiveTextPenWidth();
    attrs.m_Angle = aText.GetDrawRotation();
    attrs.m_Multiline = false;

    const text_node = this.appendNode(aContentNode, 'UserSpecial');

    let pts: VECTOR2I[] = [];
    const same = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

    const push_pts = (): void => {
      if (pts.length < 2) return;

      let line_node: wxXmlNode;

      // Polylines are only allowed for more than 3 points (in version B).
      // Otherwise, we have to use a line
      if (pts.length < 3) {
        line_node = this.appendNode(text_node, 'Line');
        this.addXY(line_node, pts[0]!, 'startX', 'startY');
        this.addXY(line_node, pts[pts.length - 1]!, 'endX', 'endY');
      } else {
        line_node = this.appendNode(text_node, 'Polyline');
        const point_node = this.appendNode(line_node, 'PolyBegin');
        this.addXY(point_node, pts[0]!);

        for (let i = 1; i < pts.length; i++) {
          const step_node = this.appendNode(line_node, 'PolyStepSegment');
          this.addXY(step_node, pts[i]!);
        }
      }

      this.addLineDesc(line_node, attrs.m_StrokeWidth, LINE_STYLE.SOLID);
      pts = [];
    };

    const callback_gal = new CALLBACK_GAL(
      // Stroke callback
      (aPt1: VECTOR2I, aPt2: VECTOR2I) => {
        if (pts.length > 0) {
          if (same(aPt1, pts[pts.length - 1]!)) pts.push(aPt2);
          else if (same(aPt2, pts[0]!)) pts.unshift(aPt1);
          else if (same(aPt1, pts[0]!)) pts.unshift(aPt2);
          else if (same(aPt2, pts[pts.length - 1]!)) pts.push(aPt1);
          else {
            push_pts();
            pts.push(aPt1, aPt2);
          }
        } else {
          pts.push(aPt1, aPt2);
        }
      },
      // Polygon callback
      (aPoly: SHAPE_LINE_CHAIN) => {
        if (aPoly.PointCount() < 3) return;

        const outline_node = this.appendNode(text_node, 'Outline');
        const poly_node = this.appendNode(outline_node, 'Polygon');
        this.addLineDesc(outline_node, 0, LINE_STYLE.SOLID);

        const polyPts = aPoly.CPoints();
        let point_node = this.appendNode(poly_node, 'PolyBegin');
        this.addXY(point_node, polyPts[0]!);

        for (let ii = 1; ii < polyPts.length; ++ii) {
          const poly_step_node = this.appendNode(poly_node, 'PolyStepSegment');
          this.addXY(poly_step_node, polyPts[ii]!);
        }

        point_node = this.appendNode(poly_node, 'PolyStepSegment');
        this.addXY(point_node, polyPts[0]!);
      },
    );

    //TODO: handle multiline text

    font.Draw(
      callback_gal,
      aText.GetShownText(true),
      aText.GetTextPos(),
      { x: 0, y: 0 },
      attrs,
      aText.GetFontMetrics(),
    );

    if (pts.length > 0) push_pts();

    if (text_node.GetChildren() === null) aContentNode.RemoveChild(text_node);
  }

  private addPadShape(aContentNode: wxXmlNode, aPad: PAD, aLayer: PCB_LAYER_ID): void {
    const maxError = this.board.GetDesignSettings().m_MaxError;
    let name = '';
    let expansion = { x: 0, y: 0 };

    // Mask and paste margins are stored per side, so query the actual layer rather than the
    // front default or a back aperture would be grown by the front margin.
    if (new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]).Contains(aLayer)) {
      const m = 2 * aPad.GetSolderMaskExpansion(aLayer);
      expansion = { x: m, y: m };
    }

    if (new LSET([PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste]).Contains(aLayer)) {
      const m = aPad.GetSolderPasteMargin(aLayer);
      expansion = { x: 2 * m.x, y: 2 * m.y };
    }

    // The mask and paste apertures are the copper shape grown by a per-layer margin, so a pad
    // needs a distinct primitive per expansion. Fold the expansion into the dict key or the
    // copper shape would be shared with the (differently sized) mask/paste apertures.
    const hash = `${hash_fp_item(aPad, 0)}|${expansion.x},${expansion.y}`;
    const existing = this.m_std_shape_dict.get(hash);

    if (existing !== undefined) {
      const shape_node = this.appendNode(aContentNode, 'StandardPrimitiveRef');
      this.addAttribute(shape_node, 'id', existing);
      return;
    }

    const padSize = (): { x: number; y: number } => {
      const s = aPad.GetSize(PADSTACK.ALL_LAYERS);
      return { x: s.x + expansion.x, y: s.y + expansion.y };
    };

    const newEntry = (aPrefix: string): wxXmlNode => {
      name = `${aPrefix}_${this.m_std_shape_dict.size + 1}`;
      this.m_std_shape_dict.set(hash, name);

      const entry_node = this.appendNode(this.m_shape_std_node!, 'EntryStandard');
      this.addAttribute(entry_node, 'id', name);
      return entry_node;
    };

    switch (aPad.GetShape(PADSTACK.ALL_LAYERS)) {
      case PAD_SHAPE.CIRCLE: {
        const entry_node = newEntry('CIRCLE');
        const circle_node = this.appendNode(entry_node, 'Circle');
        circle_node.AddAttribute(
          'diameter',
          this.floatVal(this.m_scale * (expansion.x + aPad.GetSizeX())),
        );
        break;
      }

      case PAD_SHAPE.RECTANGLE: {
        const entry_node = newEntry('RECT');
        const rect_node = this.appendNode(entry_node, 'RectCenter');
        const pad_size = padSize();
        this.addAttribute(rect_node, 'width', this.floatVal(this.m_scale * Math.abs(pad_size.x)));
        this.addAttribute(rect_node, 'height', this.floatVal(this.m_scale * Math.abs(pad_size.y)));
        break;
      }

      case PAD_SHAPE.OVAL: {
        const entry_node = newEntry('OVAL');
        const oval_node = this.appendNode(entry_node, 'Oval');
        const pad_size = padSize();
        this.addAttribute(oval_node, 'width', this.floatVal(this.m_scale * pad_size.x));
        this.addAttribute(oval_node, 'height', this.floatVal(this.m_scale * pad_size.y));
        break;
      }

      case PAD_SHAPE.ROUNDRECT: {
        const entry_node = newEntry('ROUNDRECT');
        const roundrect_node = this.appendNode(entry_node, 'RectRound');
        const pad_size = padSize();
        this.addAttribute(roundrect_node, 'width', this.floatVal(this.m_scale * pad_size.x));
        this.addAttribute(roundrect_node, 'height', this.floatVal(this.m_scale * pad_size.y));

        // A mask/paste aperture is the copper roundrect grown by the per-side margin, which
        // also grows the corner radius by that margin (Minkowski sum with a disk). expansion
        // carries twice the per-side margin. Asymmetric paste margins are not a true Minkowski
        // sum, so follow the plotter and use the larger component, then clamp the radius to the
        // aperture's half-extent so a shrunk aperture cannot yield an over-rounded shape.
        const base_radius = aPad.GetRoundRectCornerRadius(PADSTACK.ALL_LAYERS);
        const radius_margin = Math.trunc(Math.max(expansion.x, expansion.y) / 2);
        const max_radius = Math.max(0, KiROUND(Math.min(pad_size.x, pad_size.y) / 2.0));
        const radius = Math.min(Math.max(base_radius + radius_margin, 0), max_radius);
        roundrect_node.AddAttribute('radius', this.floatVal(this.m_scale * radius));
        this.addAttribute(roundrect_node, 'upperRight', 'true');
        this.addAttribute(roundrect_node, 'upperLeft', 'true');
        this.addAttribute(roundrect_node, 'lowerRight', 'true');
        this.addAttribute(roundrect_node, 'lowerLeft', 'true');
        break;
      }

      case PAD_SHAPE.CHAMFERED_RECT: {
        const entry_node = newEntry('RECTCHAMFERED');
        const chamfered_node = this.appendNode(entry_node, 'RectCham');
        const pad_size = padSize();
        this.addAttribute(chamfered_node, 'width', this.floatVal(this.m_scale * pad_size.x));
        this.addAttribute(chamfered_node, 'height', this.floatVal(this.m_scale * pad_size.y));

        const shorterSide = Math.trunc(Math.min(pad_size.x, pad_size.y));
        const chamfer = Math.max(
          0,
          KiROUND(aPad.GetChamferRectRatio(PADSTACK.ALL_LAYERS) * shorterSide),
        );

        this.addAttribute(chamfered_node, 'chamfer', this.floatVal(this.m_scale * chamfer));

        const positions = aPad.GetChamferPositions(PADSTACK.ALL_LAYERS);

        if (positions & RECT_CHAMFER_TOP_LEFT)
          this.addAttribute(chamfered_node, 'upperLeft', 'true');
        if (positions & RECT_CHAMFER_TOP_RIGHT)
          this.addAttribute(chamfered_node, 'upperRight', 'true');
        if (positions & RECT_CHAMFER_BOTTOM_LEFT)
          this.addAttribute(chamfered_node, 'lowerLeft', 'true');
        if (positions & RECT_CHAMFER_BOTTOM_RIGHT)
          this.addAttribute(chamfered_node, 'lowerRight', 'true');

        break;
      }

      case PAD_SHAPE.TRAPEZOID: {
        const entry_node = newEntry('TRAPEZOID');

        const pad_size = aPad.GetSize(PADSTACK.ALL_LAYERS);
        const trap_delta = aPad.GetDelta(PADSTACK.ALL_LAYERS);
        const outline = new SHAPE_POLY_SET();
        outline.NewOutline();
        const dx = Math.trunc(pad_size.x / 2);
        const dy = Math.trunc(pad_size.y / 2);
        const ddx = Math.trunc(trap_delta.x / 2);
        const ddy = Math.trunc(trap_delta.y / 2);

        outline.Append(-dx - ddy, dy + ddx);
        outline.Append(dx + ddy, dy - ddx);
        outline.Append(dx - ddy, -dy + ddx);
        outline.Append(-dx + ddy, -dy - ddx);

        // Shape polygon can have holes so use InflateWithLinkedHoles(), not Inflate()
        // which can create bad shapes if margin.x is < 0
        if (expansion.x)
          outline.InflateWithLinkedHoles(expansion.x, CornerStrategy.ROUND_ALL_CORNERS, maxError);

        this.addContourNode(entry_node, outline);
        break;
      }

      case PAD_SHAPE.CUSTOM: {
        const entry_node = newEntry('CUSTOM');

        const shape = new SHAPE_POLY_SET();
        aPad.MergePrimitivesAsPolygon(PADSTACK.ALL_LAYERS, shape);

        if (expansion.x !== 0 || expansion.y !== 0) {
          shape.InflateWithLinkedHoles(
            Math.max(expansion.x, expansion.y),
            CornerStrategy.ROUND_ALL_CORNERS,
            maxError,
          );
        }

        this.addContourNode(entry_node, shape);
        break;
      }

      default:
        this.Report('Pad has unsupported type; it was skipped.', RPT_SEVERITY_WARNING);
        break;
    }

    if (name !== '') {
      const shape_node = this.appendNode(aContentNode, 'StandardPrimitiveRef');
      this.addAttribute(shape_node, 'id', name);
    }
  }

  private addShape(aContentNode: wxXmlNode, aShape: PCB_SHAPE, aInline = false): void {
    const hash = this.shapeHash(aShape);
    const existing = this.m_user_shape_dict.get(hash);
    let name = '';

    // When not inline, check for existing shape in dictionary and reference it
    if (!aInline && existing !== undefined) {
      const shape_node = this.appendNode(aContentNode, 'UserPrimitiveRef');
      this.addAttribute(shape_node, 'id', existing);
      return;
    }

    const stroke = aShape.GetStroke();

    switch (aShape.GetShape()) {
      case SHAPE_T.CIRCLE: {
        if (aInline) {
          // For inline shapes (e.g., in Marking elements), output geometry directly as a
          // Polyline with two arcs forming a circle
          const radius = aShape.GetRadius();
          const polyline_node = this.appendNode(aContentNode, 'Polyline');

          // Create a circle using two semicircular arcs
          // Start at the rightmost point of the circle
          const center = aShape.GetCenter();
          const start = { x: center.x + radius, y: center.y };
          const mid = { x: center.x - radius, y: center.y };

          const begin_node = this.appendNode(polyline_node, 'PolyBegin');
          this.addXY(begin_node, start);

          // First arc from start to mid (top semicircle)
          const arc1_node = this.appendNode(polyline_node, 'PolyStepCurve');
          this.addXY(arc1_node, mid);
          this.addXY(arc1_node, center, 'centerX', 'centerY');
          this.addAttribute(arc1_node, 'clockwise', 'true');

          // Second arc from mid back to start (bottom semicircle)
          const arc2_node = this.appendNode(polyline_node, 'PolyStepCurve');
          this.addXY(arc2_node, start);
          this.addXY(arc2_node, center, 'centerX', 'centerY');
          this.addAttribute(arc2_node, 'clockwise', 'true');

          this.addLineDesc(polyline_node, stroke.GetWidth(), stroke.GetLineStyle(), true);
          break;
        }

        name = `UCIRCLE_${this.m_user_shape_dict.size + 1}`;
        this.m_user_shape_dict.set(hash, name);
        const diameter = Math.trunc(aShape.GetRadius() * 2.0);
        const width = stroke.GetWidth();

        const entry_node = this.appendNode(this.m_shape_user_node!, 'EntryUser');
        this.addAttribute(entry_node, 'id', name);
        const special_node = this.appendNode(entry_node, 'UserSpecial');

        const circle_node = this.appendNode(special_node, 'Circle');

        if (aShape.GetFillMode() === FILL_T.NO_FILL) {
          this.addAttribute(circle_node, 'diameter', this.floatVal(this.m_scale * diameter));
          this.addLineDesc(circle_node, width, stroke.GetLineStyle(), true);
        } else {
          // IPC2581 does not allow strokes on filled elements
          this.addAttribute(
            circle_node,
            'diameter',
            this.floatVal(this.m_scale * (diameter + width)),
          );
        }

        this.addFillDesc(circle_node, aShape.GetFillMode());
        break;
      }

      case SHAPE_T.RECTANGLE: {
        if (aInline) {
          // For inline shapes, output as a Polyline with the rectangle corners
          const polyline_node = this.appendNode(aContentNode, 'Polyline');

          // Get the rectangle corners. Use GetRectCorners for proper handling
          const corners = aShape.GetRectCorners();

          const begin_node = this.appendNode(polyline_node, 'PolyBegin');
          this.addXY(begin_node, corners[0]!);

          for (let i = 1; i < corners.length; ++i) {
            const step_node = this.appendNode(polyline_node, 'PolyStepSegment');
            this.addXY(step_node, corners[i]!);
          }

          // Close the rectangle
          const close_node = this.appendNode(polyline_node, 'PolyStepSegment');
          this.addXY(close_node, corners[0]!);

          this.addLineDesc(polyline_node, stroke.GetWidth(), stroke.GetLineStyle(), true);
          break;
        }

        name = `URECT_${this.m_user_shape_dict.size + 1}`;
        this.m_user_shape_dict.set(hash, name);

        const entry_node = this.appendNode(this.m_shape_user_node!, 'EntryUser');
        this.addAttribute(entry_node, 'id', name);
        const special_node = this.appendNode(entry_node, 'UserSpecial');

        let width = Math.abs(aShape.GetRectangleWidth());
        let height = Math.abs(aShape.GetRectangleHeight());
        const stroke_width = stroke.GetWidth();
        const corner_radius = aShape.GetCornerRadius();

        const rect_node = this.appendNode(special_node, 'RectRound');
        this.addLineDesc(rect_node, stroke.GetWidth(), stroke.GetLineStyle(), true);

        // RectRound rounds only the corners whose flag is set. KiCad rounds all four when the
        // rectangle carries a corner radius, so drive the flags off the radius rather than the
        // fill mode. A filled rect is grown by the stroke width the same as before.
        const cornerFlag = corner_radius > 0 ? 'true' : 'false';
        this.addAttribute(rect_node, 'upperRight', cornerFlag);
        this.addAttribute(rect_node, 'upperLeft', cornerFlag);
        this.addAttribute(rect_node, 'lowerRight', cornerFlag);
        this.addAttribute(rect_node, 'lowerLeft', cornerFlag);

        if (aShape.GetFillMode() !== FILL_T.NO_FILL) {
          width += stroke_width;
          height += stroke_width;
        }

        this.addFillDesc(rect_node, aShape.GetFillMode());

        this.addAttribute(rect_node, 'width', this.floatVal(this.m_scale * width));
        this.addAttribute(rect_node, 'height', this.floatVal(this.m_scale * height));
        this.addAttribute(rect_node, 'radius', this.floatVal(this.m_scale * corner_radius));
        break;
      }

      case SHAPE_T.POLY: {
        if (aInline) {
          // For inline shapes, output as Polyline elements directly
          const poly_set = aShape.GetPolyShape();

          for (let ii = 0; ii < poly_set.OutlineCount(); ++ii) {
            const outline = poly_set.Outline(ii);

            if (outline.PointCount() < 2) continue;

            const polyline_node = this.appendNode(aContentNode, 'Polyline');
            const pts = outline.CPoints();

            const begin_node = this.appendNode(polyline_node, 'PolyBegin');
            this.addXY(begin_node, pts[0]!);

            for (let jj = 1; jj < pts.length; ++jj) {
              const step_node = this.appendNode(polyline_node, 'PolyStepSegment');
              this.addXY(step_node, pts[jj]!);
            }

            // Close the polygon if needed
            const front = pts[0]!;
            const back = pts[pts.length - 1]!;

            if (pts.length > 2 && (front.x !== back.x || front.y !== back.y)) {
              const close_node = this.appendNode(polyline_node, 'PolyStepSegment');
              this.addXY(close_node, pts[0]!);
            }

            this.addLineDesc(polyline_node, stroke.GetWidth(), stroke.GetLineStyle(), true);
          }

          break;
        }

        name = `UPOLY_${this.m_user_shape_dict.size + 1}`;
        this.m_user_shape_dict.set(hash, name);

        const entry_node = this.appendNode(this.m_shape_user_node!, 'EntryUser');
        this.addAttribute(entry_node, 'id', name);

        // If we are stroking a polygon, we need two contours.  This is only allowed
        // inside a "UserSpecial" shape
        const special_node = this.appendNode(entry_node, 'UserSpecial');

        const poly_set = aShape.GetPolyShape();

        for (let ii = 0; ii < poly_set.OutlineCount(); ++ii) {
          if (aShape.GetFillMode() !== FILL_T.NO_FILL) {
            // IPC2581 does not allow strokes on filled elements
            this.addContourNode(
              special_node,
              poly_set,
              ii,
              FILL_T.FILLED_SHAPE,
              0,
              LINE_STYLE.SOLID,
            );
          }

          this.addContourNode(
            special_node,
            poly_set,
            ii,
            FILL_T.NO_FILL,
            stroke.GetWidth(),
            stroke.GetLineStyle(),
          );
        }

        break;
      }

      case SHAPE_T.ARC: {
        const arc_node = this.appendNode(aContentNode, 'Arc');
        this.addXY(arc_node, aShape.GetStart(), 'startX', 'startY');
        this.addXY(arc_node, aShape.GetEnd(), 'endX', 'endY');
        this.addXY(arc_node, aShape.GetCenter(), 'centerX', 'centerY');

        //N.B. because our coordinate system is flipped, we need to flip the arc direction
        this.addAttribute(arc_node, 'clockwise', !aShape.IsClockwiseArc() ? 'true' : 'false');

        this.addLineDesc(arc_node, stroke.GetWidth(), stroke.GetLineStyle(), true);
        break;
      }

      case SHAPE_T.BEZIER: {
        const polyline_node = this.appendNode(aContentNode, 'Polyline');
        const ctrlPoints = [
          aShape.GetStart(),
          aShape.GetBezierC1(),
          aShape.GetBezierC2(),
          aShape.GetEnd(),
        ];
        const converter = new BezierPoly(ctrlPoints);
        const points = converter.getPoly(ARC_HIGH_DEF);

        const point_node = this.appendNode(polyline_node, 'PolyBegin');
        this.addXY(point_node, points[0]!);

        for (let i = 1; i < points.length; i++) {
          const seg_node = this.appendNode(polyline_node, 'PolyStepSegment');
          this.addXY(seg_node, points[i]!);
        }

        this.addLineDesc(polyline_node, stroke.GetWidth(), stroke.GetLineStyle(), true);
        break;
      }

      case SHAPE_T.SEGMENT: {
        const line_node = this.appendNode(aContentNode, 'Line');
        this.addXY(line_node, aShape.GetStart(), 'startX', 'startY');
        this.addXY(line_node, aShape.GetEnd(), 'endX', 'endY');

        this.addLineDesc(line_node, stroke.GetWidth(), stroke.GetLineStyle(), true);
        break;
      }

      default:
        break;
    }

    // Only add UserPrimitiveRef when not in inline mode and a dictionary entry was created
    if (!aInline && name !== '') {
      const shape_node = this.appendNode(aContentNode, 'UserPrimitiveRef');
      this.addAttribute(shape_node, 'id', name);
    }
  }

  private addSlotCavity(aNode: wxXmlNode, aPad: PAD, aName: string): void {
    const slotNode = this.appendNode(aNode, 'SlotCavity');
    this.addAttribute(slotNode, 'name', aName);
    this.addAttribute(
      slotNode,
      'platingStatus',
      aPad.GetAttribute() === PAD_ATTRIB.PTH ? 'PLATED' : 'NONPLATED',
    );
    this.addAttribute(slotNode, 'plusTol', '0.0');
    this.addAttribute(slotNode, 'minusTol', '0.0');

    if (this.m_version > 'B') this.addLocationPad(slotNode, aPad, false);

    // Normally only oblong drill shapes should reach this code path since m_slot_holes
    // is filtered to pads where DrillSizeX != DrillSizeY. However, use a fallback to
    // ensure valid XML is always generated.
    if (aPad.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG) {
      const drill_size = { ...aPad.GetDrillSize() };
      let rotation = aPad.GetOrientation().Normalized();

      // IPC-2581C requires width >= height for Oval primitive
      // Swap dimensions if needed and adjust rotation accordingly
      if (drill_size.y > drill_size.x) {
        [drill_size.x, drill_size.y] = [drill_size.y, drill_size.x];
        rotation = rotation.add(ANGLE_90).Normalize();
      }

      // Add Xform if rotation is needed (must come before Feature per IPC-2581C schema)
      if (!rotation.equals(ANGLE_0)) {
        const xformNode = this.appendNode(slotNode, 'Xform');
        this.addAttribute(xformNode, 'rotation', this.floatVal(rotation.AsDegrees()));
      }

      // Use IPC-2581 Oval primitive for oblong slots
      const ovalNode = this.appendNode(slotNode, 'Oval');
      this.addAttribute(ovalNode, 'width', this.floatVal(this.m_scale * drill_size.x));
      this.addAttribute(ovalNode, 'height', this.floatVal(this.m_scale * drill_size.y));
    } else {
      // Fallback to polygon outline for non-oblong shapes
      const poly_set = new SHAPE_POLY_SET();
      const maxError = this.board.GetDesignSettings().m_MaxError;
      aPad.TransformHoleToPolygon(poly_set, 0, maxError, ERROR_LOC.ERROR_INSIDE);

      this.addOutlineNode(slotNode, poly_set);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Logistic, history, BOM
  // ---------------------------------------------------------------------------------------------

  private generateLogisticSection(): wxXmlNode {
    const logisticNode = this.appendNode(this.m_xml_root!, 'LogisticHeader');

    const roleNode = this.appendNode(logisticNode, 'Role');
    this.addAttribute(roleNode, 'id', 'Owner');
    this.addAttribute(roleNode, 'roleFunction', 'SENDER');

    this.m_enterpriseNode = this.appendNode(logisticNode, 'Enterprise');
    this.addAttribute(this.m_enterpriseNode, 'id', 'UNKNOWN');
    this.addAttribute(this.m_enterpriseNode, 'code', 'NONE');

    const personNode = this.appendNode(logisticNode, 'Person');
    this.addAttribute(personNode, 'name', 'UNKNOWN');
    this.addAttribute(personNode, 'enterpriseRef', 'UNKNOWN');
    this.addAttribute(personNode, 'roleRef', 'Owner');

    return logisticNode;
  }

  private generateHistorySection(): wxXmlNode {
    this.m_progressReporter?.AdvancePhase('Generating history section');

    const historyNode = this.appendNode(this.m_xml_root!, 'HistoryRecord');
    this.addAttribute(historyNode, 'number', '1');
    this.addAttribute(historyNode, 'origination', nowISOCombined());
    this.addAttribute(historyNode, 'software', 'KiCad EDA');
    this.addAttribute(historyNode, 'lastChange', nowISOCombined());

    const fileRevisionNode = this.appendNode(historyNode, 'FileRevision');
    this.addAttribute(fileRevisionNode, 'fileRevisionId', '1');
    this.addAttribute(fileRevisionNode, 'comment', 'NO COMMENT');
    this.addAttribute(fileRevisionNode, 'label', 'NO LABEL');

    const softwarePackageNode = this.appendNode(fileRevisionNode, 'SoftwarePackage');
    this.addAttribute(softwarePackageNode, 'name', 'KiCad');
    this.addAttribute(softwarePackageNode, 'revision', GetMajorMinorPatchVersion());
    this.addAttribute(softwarePackageNode, 'vendor', 'KiCad EDA');

    const certificationNode = this.appendNode(softwarePackageNode, 'Certification');
    this.addAttribute(certificationNode, 'certificationStatus', 'SELFTEST');

    return historyNode;
  }

  /** A footprint copy at the origin, unrotated and unflipped: the package's own geometry. */
  private normalizedClone(aFp: FOOTPRINT): FOOTPRINT {
    const fp = aFp.Clone();
    fp.SetParentGroup(null);
    fp.SetPosition({ x: 0, y: 0 });
    fp.SetOrientation(ANGLE_0);

    // Normalize to unflipped state to match hash computed in addPackage
    if (fp.IsFlipped()) fp.Flip(fp.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

    return fp;
  }

  private generateBOMSection(aEcadNode: wxXmlNode): wxXmlNode | null {
    this.m_progressReporter?.AdvancePhase('Generating BOM section');

    // std::set ordered by m_OEMDesignRef.
    const bom_entries = new Map<string, BOM_ENTRY>();

    for (const fp_it of this.board.Footprints()) {
      const fp = this.normalizedClone(fp_it);

      const hash = hash_fp_item(fp, HASH_FLAGS.HASH_POS | HASH_FLAGS.REL_COORD);

      if (!this.m_footprint_dict.has(hash)) {
        this.Report(
          `Footprint ${fp.GetFPID().GetLibItemName()} not found in dictionary; BOM data may be incomplete.`,
          RPT_SEVERITY_WARNING,
        );
        continue;
      }

      const entry: BOM_ENTRY = {
        m_OEMDesignRef: '',
        m_count: 0,
        m_pads: 0,
        m_type: '',
        m_description: '',
        m_refdes: [],
        m_props: new Map(),
      };

      /// We assume that the m_OEMRef_dict is populated already by the generateComponents function
      /// This will either place a unique string in the dictionary or field reference.
      const oem = this.m_OEMRef_dict.get(fp_it);

      if (oem !== undefined) {
        entry.m_OEMDesignRef = oem;
      } else {
        this.Report(
          `Component "${fp.GetFPID().GetLibItemName()}" missing OEM reference; BOM entry will be skipped.`,
          RPT_SEVERITY_WARNING,
        );
      }

      entry.m_OEMDesignRef = this.genString(entry.m_OEMDesignRef, 'REF');
      entry.m_count = 1;
      entry.m_pads = fp.GetPadCount();

      // TODO: The options are "ELECTRICAL", "MECHANICAL", "PROGRAMMABLE", "DOCUMENT", "MATERIAL"
      //      We need to figure out how to determine this.
      const variantName = this.board.GetCurrentVariant();

      if (entry.m_pads === 0 || fp_it.GetExcludedFromBOMForVariant(variantName))
        entry.m_type = 'DOCUMENT';
      else entry.m_type = 'ELECTRICAL';

      // Use the footprint's Description field if it exists
      const descField = fp_it.GetField(FIELD_T.DESCRIPTION);

      if (descField && descField.GetShownText(false) !== '')
        entry.m_description = descField.GetShownText(false);

      let bom = bom_entries.get(entry.m_OEMDesignRef);

      if (!bom) {
        bom = entry;
        bom_entries.set(entry.m_OEMDesignRef, entry);
      } else {
        bom.m_count++;
      }

      bom.m_refdes.push({
        m_name: this.componentName(fp_it),
        m_pkg: fp.GetFPID().GetLibItemName(),
        m_populate:
          !fp.GetDNPForVariant(variantName) && !fp.GetExcludedFromBOMForVariant(variantName),
        m_layer: this.layerName(fp_it.GetLayer()),
      });

      // TODO: This amalgamates all the properties from all the footprints.  We need to decide
      // if we want to group footprints by their properties
      for (const prop of fp.GetFields()) {
        // We don't include Reference, Datasheet, or Description in BOM characteristics.
        // Value and any user-defined fields are included.  Reference is captured above,
        // and Description is used for the BomItem description attribute.
        if (prop.IsMandatory() && !prop.IsValue()) continue;

        if (!bom.m_props.has(prop.GetName()))
          bom.m_props.set(prop.GetName(), prop.GetShownText(false));
      }
    }

    if (bom_entries.size === 0) return null;

    const fnName = fileNameName(this.board.GetFileName());

    const bomNode = newNode('Bom');
    this.m_xml_root!.InsertChild(bomNode, aEcadNode);
    this.addAttribute(bomNode, 'name', this.genString(fnName, 'BOM'));

    const bomHeaderNode = this.appendNode(bomNode, 'BomHeader');
    let bomRevision = this.m_bomRev;

    if (bomRevision === '') bomRevision = this.board.GetTitleBlock().GetRevision();

    if (bomRevision === '') bomRevision = '1.0';

    this.addAttribute(bomHeaderNode, 'revision', bomRevision);
    this.addAttribute(bomHeaderNode, 'assembly', this.genString(fnName));

    const stepRefNode = this.appendNode(bomHeaderNode, 'StepRef');
    this.addAttribute(stepRefNode, 'name', this.genString(fnName, 'BOARD'));

    for (const [, entry] of [...bom_entries].sort(([a], [b]) => strCmp(a, b))) {
      const bomEntryNode = this.appendNode(bomNode, 'BomItem');
      this.addAttribute(bomEntryNode, 'OEMDesignNumberRef', entry.m_OEMDesignRef);
      this.addAttribute(bomEntryNode, 'quantity', String(entry.m_count));
      this.addAttribute(bomEntryNode, 'pinCount', String(entry.m_pads));
      this.addAttribute(bomEntryNode, 'category', entry.m_type);

      if (entry.m_description !== '')
        this.addAttribute(bomEntryNode, 'description', entry.m_description);

      for (const refdes of entry.m_refdes) {
        const refdesNode = this.appendNode(bomEntryNode, 'RefDes');
        this.addAttribute(refdesNode, 'name', refdes.m_name);
        this.addAttribute(refdesNode, 'packageRef', this.genString(refdes.m_pkg, 'PKG'));
        this.addAttribute(refdesNode, 'populate', refdes.m_populate ? 'true' : 'false');
        this.addAttribute(refdesNode, 'layerRef', refdes.m_layer);
      }

      const characteristicsNode = this.appendNode(bomEntryNode, 'Characteristics');
      this.addAttribute(characteristicsNode, 'category', entry.m_type);

      for (const [propName, propValue] of [...entry.m_props].sort(([a], [b]) => strCmp(a, b))) {
        const textualDefNode = this.appendNode(characteristicsNode, 'Textual');
        this.addAttribute(textualDefNode, 'definitionSource', 'KICAD');
        this.addAttribute(textualDefNode, 'textualCharacteristicName', propName);
        this.addAttribute(textualDefNode, 'textualCharacteristicValue', propValue);
      }
    }

    return bomNode;
  }

  // ---------------------------------------------------------------------------------------------
  // ECAD: header, layers, stackup
  // ---------------------------------------------------------------------------------------------

  private generateEcadSection(): wxXmlNode {
    this.m_progressReporter?.AdvancePhase('Generating CAD data');

    const ecadNode = this.appendNode(this.m_xml_root!, 'Ecad');
    this.addAttribute(ecadNode, 'name', 'Design');

    this.addCadHeader(ecadNode);

    const cadDataNode = this.appendNode(ecadNode, 'CadData');
    this.generateCadLayers(cadDataNode);
    this.generateDrillLayers(cadDataNode);
    this.generateAuxilliaryLayers(cadDataNode);
    this.generateStackup(cadDataNode);
    this.generateStepSection(cadDataNode);

    this.pruneUnusedBackdrillSpecs();

    return ecadNode;
  }

  private stackup() {
    const dsnSettings = this.board.GetDesignSettings();
    const stackup = dsnSettings.GetStackupDescriptor();
    stackup.SynchronizeWithBoard(dsnSettings);
    return stackup;
  }

  private generateCadSpecs(aCadLayerNode: wxXmlNode): void {
    const stackup = this.stackup();
    const layers = stackup.GetList();

    for (let i = 0; i < stackup.GetCount(); i++) {
      const stackup_item = layers[i]!;

      for (let sublayer_id = 0; sublayer_id < stackup_item.GetSublayersCount(); sublayer_id++) {
        const ly_name = this.stackupLayerName(stackup_item, sublayer_id, 'SPEC_LAYER');

        const specNode = this.appendNode(aCadLayerNode, 'Spec');
        this.addAttribute(specNode, 'name', ly_name);
        const generalNode = this.appendNode(specNode, 'General');
        this.addAttribute(generalNode, 'type', 'MATERIAL');
        let propertyNode = this.appendNode(generalNode, 'Property');

        switch (stackup_item.GetType()) {
          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER: {
            this.addAttribute(propertyNode, 'text', 'COPPER');
            const conductorNode = this.appendNode(specNode, 'Conductor');
            this.addAttribute(conductorNode, 'type', 'CONDUCTIVITY');
            propertyNode = this.appendNode(conductorNode, 'Property');
            this.addAttribute(propertyNode, 'unit', 'SIEMENS/M');
            this.addAttribute(propertyNode, 'value', '5.959E7');
            break;
          }
          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC: {
            this.addAttribute(propertyNode, 'text', stackup_item.GetMaterial());
            propertyNode = this.appendNode(generalNode, 'Property');
            this.addAttribute(propertyNode, 'text', `Type : ${stackup_item.GetTypeName()}`);
            let dielectricNode = this.appendNode(specNode, 'Dielectric');
            this.addAttribute(dielectricNode, 'type', 'DIELECTRIC_CONSTANT');
            propertyNode = this.appendNode(dielectricNode, 'Property');
            this.addAttribute(
              propertyNode,
              'value',
              this.floatVal(stackup_item.GetEpsilonR(sublayer_id)),
            );
            dielectricNode = this.appendNode(specNode, 'Dielectric');
            this.addAttribute(dielectricNode, 'type', 'LOSS_TANGENT');
            propertyNode = this.appendNode(dielectricNode, 'Property');
            this.addAttribute(
              propertyNode,
              'value',
              this.floatVal(stackup_item.GetLossTangent(sublayer_id)),
            );
            break;
          }
          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN:
            this.addAttribute(propertyNode, 'text', stackup_item.GetTypeName());
            propertyNode = this.appendNode(generalNode, 'Property');
            this.addAttribute(propertyNode, 'text', `Color : ${stackup_item.GetColor()}`);
            propertyNode = this.appendNode(generalNode, 'Property');
            this.addAttribute(propertyNode, 'text', `Type : ${stackup_item.GetTypeName()}`);
            break;
          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK: {
            this.addAttribute(propertyNode, 'text', 'SOLDERMASK');
            propertyNode = this.appendNode(generalNode, 'Property');
            this.addAttribute(propertyNode, 'text', `Color : ${stackup_item.GetColor()}`);
            propertyNode = this.appendNode(generalNode, 'Property');
            this.addAttribute(propertyNode, 'text', `Type : ${stackup_item.GetTypeName()}`);

            // Generate Epsilon R if > 1.0 (value <= 1.0 means not specified)
            if (stackup_item.GetEpsilonR(sublayer_id) > 1.0) {
              const dielectricNode = this.appendNode(specNode, 'Dielectric');
              this.addAttribute(dielectricNode, 'type', 'DIELECTRIC_CONSTANT');
              propertyNode = this.appendNode(dielectricNode, 'Property');
              this.addAttribute(
                propertyNode,
                'value',
                this.floatVal(stackup_item.GetEpsilonR(sublayer_id)),
              );
            }

            // Generate LossTangent if > 0.0 (value <= 0.0 means not specified)
            if (stackup_item.GetLossTangent(sublayer_id) > 0.0) {
              const dielectricNode = this.appendNode(specNode, 'Dielectric');
              this.addAttribute(dielectricNode, 'type', 'LOSS_TANGENT');
              propertyNode = this.appendNode(dielectricNode, 'Property');
              this.addAttribute(
                propertyNode,
                'value',
                this.floatVal(stackup_item.GetLossTangent(sublayer_id)),
              );
            }
            break;
          }
          default:
            break;
        }
      }
    }

    // SurfaceFinish is only defined as a SpecificationType in IPC-2581C
    if (this.m_version > 'B') {
      const finishType = getSurfaceFinishType(stackup.m_FinishType);

      if (finishType !== surfaceFinishType.NONE) {
        const specNode = this.appendNode(aCadLayerNode, 'Spec');
        this.addAttribute(specNode, 'name', 'SURFACE_FINISH');

        const surfaceFinishNode = this.appendNode(specNode, 'SurfaceFinish');
        this.addAttribute(surfaceFinishNode, 'type', surfaceFinishTypeToString.get(finishType)!);

        if (finishType === surfaceFinishType.OTHER)
          this.addAttribute(surfaceFinishNode, 'comment', stackup.m_FinishType);
      }
    }
  }

  private addCadHeader(aEcadNode: wxXmlNode): void {
    const cadHeaderNode = this.appendNode(aEcadNode, 'CadHeader');
    this.addAttribute(cadHeaderNode, 'units', this.m_units_str);

    this.m_cad_header_node = cadHeaderNode;

    this.generateCadSpecs(cadHeaderNode);
  }

  private isValidLayerFor2581(aLayer: PCB_LAYER_ID): boolean {
    return (
      IsCopperLayer(aLayer) ||
      (IsNonCopperLayer(aLayer) && aLayer <= PCB_LAYER_ID.User_9) ||
      aLayer === PCB_LAYER_ID.UNDEFINED_LAYER
    );
  }

  private addLayerAttributes(aNode: wxXmlNode, aLayer: PCB_LAYER_ID): void {
    const L = PCB_LAYER_ID;
    const set = (aFunction: string, aSide: string): void => {
      this.addAttribute(aNode, 'layerFunction', aFunction);
      this.addAttribute(aNode, 'polarity', 'POSITIVE');
      this.addAttribute(aNode, 'side', aSide);
    };

    switch (aLayer) {
      case L.F_Adhes:
      case L.B_Adhes:
        set('GLUE', aLayer === L.F_Adhes ? 'TOP' : 'BOTTOM');
        break;
      case L.F_Paste:
      case L.B_Paste:
        set('SOLDERPASTE', aLayer === L.F_Paste ? 'TOP' : 'BOTTOM');
        break;
      case L.F_SilkS:
      case L.B_SilkS:
        set('SILKSCREEN', aLayer === L.F_SilkS ? 'TOP' : 'BOTTOM');
        break;
      case L.F_Mask:
      case L.B_Mask:
        set('SOLDERMASK', aLayer === L.F_Mask ? 'TOP' : 'BOTTOM');
        break;
      case L.Edge_Cuts:
        set('BOARD_OUTLINE', 'ALL');
        break;
      case L.B_CrtYd:
      case L.F_CrtYd:
        set('COURTYARD', aLayer === L.F_CrtYd ? 'TOP' : 'BOTTOM');
        break;
      case L.B_Fab:
      case L.F_Fab:
        set('ASSEMBLY', aLayer === L.F_Fab ? 'TOP' : 'BOTTOM');
        break;
      case L.Dwgs_User:
      case L.Cmts_User:
      case L.Eco1_User:
      case L.Eco2_User:
      case L.Margin:
      case L.User_1:
      case L.User_2:
      case L.User_3:
      case L.User_4:
      case L.User_5:
      case L.User_6:
      case L.User_7:
      case L.User_8:
      case L.User_9:
        set('DOCUMENT', 'NONE');
        break;

      default:
        if (IsCopperLayer(aLayer))
          set('CONDUCTOR', aLayer === L.F_Cu ? 'TOP' : aLayer === L.B_Cu ? 'BOTTOM' : 'INTERNAL');

        break; // Do not handle other layers
    }
  }

  private generateStackup(aCadLayerNode: wxXmlNode): void {
    const stackup = this.stackup();

    // Coating layers reference the SurfaceFinish Spec which is only valid in IPC-2581C
    const finishType = getSurfaceFinishType(stackup.m_FinishType);
    const hasCoating = this.m_version > 'B' && finishType !== surfaceFinishType.NONE;

    const stackupNode = this.appendNode(aCadLayerNode, 'Stackup');
    this.addAttribute(stackupNode, 'name', 'Primary_Stackup');
    this.addAttribute(
      stackupNode,
      'overallThickness',
      this.floatVal(this.m_scale * stackup.BuildBoardThicknessFromStackup()),
    );
    this.addAttribute(stackupNode, 'tolPlus', '0.0');
    this.addAttribute(stackupNode, 'tolMinus', '0.0');
    this.addAttribute(stackupNode, 'whereMeasured', 'MASK');

    if (this.m_version > 'B') this.addAttribute(stackupNode, 'stackupStatus', 'PROPOSED');

    const stackupGroup = this.appendNode(stackupNode, 'StackupGroup');
    this.addAttribute(stackupGroup, 'name', 'Primary_Stackup_Group');
    this.addAttribute(
      stackupGroup,
      'thickness',
      this.floatVal(this.m_scale * stackup.BuildBoardThicknessFromStackup()),
    );
    this.addAttribute(stackupGroup, 'tolPlus', '0.0');
    this.addAttribute(stackupGroup, 'tolMinus', '0.0');

    const layers = stackup.GetList();
    let sequence = 0;

    const coating = (aRef: string): void => {
      const coatingLayer = this.appendNode(stackupGroup, 'StackupLayer');
      this.addAttribute(coatingLayer, 'layerOrGroupRef', aRef);
      this.addAttribute(coatingLayer, 'thickness', '0.0');
      this.addAttribute(coatingLayer, 'tolPlus', '0.0');
      this.addAttribute(coatingLayer, 'tolMinus', '0.0');
      this.addAttribute(coatingLayer, 'sequence', String(sequence++));

      const specRefNode = this.appendNode(coatingLayer, 'SpecRef');
      this.addAttribute(specRefNode, 'id', 'SURFACE_FINISH');
    };

    for (let i = 0; i < stackup.GetCount(); i++) {
      const stackup_item = layers[i]!;

      for (let sublayer_id = 0; sublayer_id < stackup_item.GetSublayersCount(); sublayer_id++) {
        const layer_id = stackup_item.GetBrdLayerId();

        // Insert top coating layer before F.Cu
        if (hasCoating && layer_id === PCB_LAYER_ID.F_Cu && sublayer_id === 0)
          coating('COATING_TOP');

        const stackupLayer = this.appendNode(stackupGroup, 'StackupLayer');
        const spec_name = this.stackupLayerName(stackup_item, sublayer_id, 'SPEC_LAYER');
        const ly_name = this.stackupLayerName(stackup_item, sublayer_id, 'LAYER');

        this.addAttribute(stackupLayer, 'layerOrGroupRef', ly_name);
        this.addAttribute(
          stackupLayer,
          'thickness',
          this.floatVal(this.m_scale * stackup_item.GetThickness()),
        );
        this.addAttribute(stackupLayer, 'tolPlus', '0.0');
        this.addAttribute(stackupLayer, 'tolMinus', '0.0');
        this.addAttribute(stackupLayer, 'sequence', String(sequence++));

        const specLayerNode = this.appendNode(stackupLayer, 'SpecRef');
        this.addAttribute(specLayerNode, 'id', spec_name);

        // Insert bottom coating layer after B.Cu
        if (
          hasCoating &&
          layer_id === PCB_LAYER_ID.B_Cu &&
          sublayer_id === stackup_item.GetSublayersCount() - 1
        )
          coating('COATING_BOTTOM');
      }
    }
  }

  private generateCadLayers(aCadLayerNode: wxXmlNode): void {
    const stackup = this.stackup();
    const layers = stackup.GetList();
    const added_layers = new Set<PCB_LAYER_ID>();

    for (let i = 0; i < stackup.GetCount(); i++) {
      const stackup_item = layers[i]!;

      for (let sublayer_id = 0; sublayer_id < stackup_item.GetSublayersCount(); sublayer_id++) {
        const cadLayerNode = this.appendNode(aCadLayerNode, 'Layer');
        const ly_name = this.stackupLayerName(stackup_item, sublayer_id, 'LAYER');

        this.addAttribute(cadLayerNode, 'name', ly_name);

        if (stackup_item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
          if (stackup_item.GetTypeName() === KEY_CORE)
            this.addAttribute(cadLayerNode, 'layerFunction', 'DIELCORE');
          else this.addAttribute(cadLayerNode, 'layerFunction', 'DIELPREG');

          this.addAttribute(cadLayerNode, 'polarity', 'POSITIVE');
          this.addAttribute(cadLayerNode, 'side', 'INTERNAL');
          continue;
        }

        added_layers.add(stackup_item.GetBrdLayerId());
        this.addLayerAttributes(cadLayerNode, stackup_item.GetBrdLayerId());
        this.emplaceLayerName(stackup_item.GetBrdLayerId(), ly_name);
      }
    }

    for (const layer of this.board.GetEnabledLayers().Seq()) {
      if (added_layers.has(layer) || !this.isValidLayerFor2581(layer)) continue;

      const ly_name = this.genLayerString(layer, 'LAYER');
      this.emplaceLayerName(layer, ly_name);
      added_layers.add(layer);
      const cadLayerNode = this.appendNode(aCadLayerNode, 'Layer');
      this.addAttribute(cadLayerNode, 'name', ly_name);

      this.addLayerAttributes(cadLayerNode, layer);
    }

    // COATINGCOND layers reference the SurfaceFinish Spec which is only valid in IPC-2581C
    if (this.m_version > 'B') {
      const finishType = getSurfaceFinishType(stackup.m_FinishType);

      if (finishType !== surfaceFinishType.NONE) {
        const topCoatingNode = this.appendNode(aCadLayerNode, 'Layer');
        this.addAttribute(topCoatingNode, 'name', 'COATING_TOP');
        this.addAttribute(topCoatingNode, 'layerFunction', 'COATINGCOND');
        this.addAttribute(topCoatingNode, 'side', 'TOP');
        this.addAttribute(topCoatingNode, 'polarity', 'POSITIVE');

        const botCoatingNode = this.appendNode(aCadLayerNode, 'Layer');
        this.addAttribute(botCoatingNode, 'name', 'COATING_BOTTOM');
        this.addAttribute(botCoatingNode, 'layerFunction', 'COATINGCOND');
        this.addAttribute(botCoatingNode, 'side', 'BOTTOM');
        this.addAttribute(botCoatingNode, 'polarity', 'POSITIVE');
      }
    }
  }

  private pushMap<V>(aMap: Map<string, V[]>, aKey: string, aValue: V): void {
    let v = aMap.get(aKey);

    if (!v) {
      v = [];
      aMap.set(aKey, v);
    }

    v.push(aValue);
  }

  private generateDrillLayers(aCadLayerNode: wxXmlNode): void {
    for (const item of this.board.Tracks()) {
      if (item.Type() === KICAD_T.PCB_VIA_T) {
        const via = item as PCB_VIA;
        this.pushMap(this.m_drill_layers, `${via.TopLayer()},${via.BottomLayer()}`, via);
      }
    }

    for (const fp of this.board.Footprints()) {
      for (const pad of fp.Pads()) {
        if (pad.HasDrilledHole())
          this.pushMap(this.m_drill_layers, `${PCB_LAYER_ID.F_Cu},${PCB_LAYER_ID.B_Cu}`, pad);
        else if (pad.HasHole())
          this.pushMap(this.m_slot_holes, `${PCB_LAYER_ID.F_Cu},${PCB_LAYER_ID.B_Cu}`, pad);
      }
    }

    const span = (aNode: wxXmlNode, aFrom: PCB_LAYER_ID, aTo: PCB_LAYER_ID): void => {
      const spanNode = this.appendNode(aNode, 'Span');
      this.addAttribute(spanNode, 'fromLayer', this.genLayerString(aFrom, 'LAYER'));
      this.addAttribute(spanNode, 'toLayer', this.genLayerString(aTo, 'LAYER'));
    };

    for (const [key] of sortedEntries(this.m_drill_layers, numKey)) {
      const [first, second] = numKey(key) as [PCB_LAYER_ID, PCB_LAYER_ID];
      const drillNode = this.appendNode(aCadLayerNode, 'Layer');
      drillNode.AddAttribute('name', this.genLayersString(first, second, 'DRILL'));
      this.addAttribute(drillNode, 'layerFunction', 'DRILL');
      this.addAttribute(drillNode, 'polarity', 'POSITIVE');
      this.addAttribute(drillNode, 'side', 'ALL');

      span(drillNode, first, second);
    }

    for (const [key] of sortedEntries(this.m_slot_holes, numKey)) {
      const [first, second] = numKey(key) as [PCB_LAYER_ID, PCB_LAYER_ID];
      const drillNode = this.appendNode(aCadLayerNode, 'Layer');
      drillNode.AddAttribute('name', this.genLayersString(first, second, 'SLOT'));

      this.addAttribute(drillNode, 'layerFunction', 'ROUT');
      this.addAttribute(drillNode, 'polarity', 'POSITIVE');
      this.addAttribute(drillNode, 'side', 'ALL');

      span(drillNode, first, second);
    }
  }

  private static auxName(
    aType: auxLayerType,
  ): { name: string; layerFunction: string; hole: boolean } | null {
    // clang-format off: suggestion is inconsitent
    switch (aType) {
      case auxLayerType.COVERING:
        return { name: 'COVERING', layerFunction: 'COATINGNONCOND', hole: false };
      case auxLayerType.PLUGGING:
        return { name: 'PLUGGING', layerFunction: 'HOLEFILL', hole: true };
      case auxLayerType.TENTING:
        return { name: 'TENTING', layerFunction: 'COATINGNONCOND', hole: false };
      case auxLayerType.FILLING:
        return { name: 'FILLING', layerFunction: 'HOLEFILL', hole: true };
      case auxLayerType.CAPPING:
        return { name: 'CAPPING', layerFunction: 'COATINGCOND', hole: true };
      default:
        return null;
    }
  }

  private generateAuxilliaryLayers(aCadLayerNode: wxXmlNode): void {
    for (const item of this.board.Tracks()) {
      if (item.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = item as PCB_VIA;
      const ps = via.Padstack();
      const new_layers: [auxLayerType, PCB_LAYER_ID, PCB_LAYER_ID][] = [];

      if (ps.IsFilled() ?? false)
        new_layers.push([auxLayerType.FILLING, via.TopLayer(), via.BottomLayer()]);

      if (ps.IsCapped() ?? false)
        new_layers.push([auxLayerType.CAPPING, via.TopLayer(), via.BottomLayer()]);

      for (const layer of [via.TopLayer(), via.BottomLayer()]) {
        if (ps.IsPlugged(layer) ?? false)
          new_layers.push([auxLayerType.PLUGGING, layer, PCB_LAYER_ID.UNDEFINED_LAYER]);

        if (ps.IsCovered(layer) ?? false)
          new_layers.push([auxLayerType.COVERING, layer, PCB_LAYER_ID.UNDEFINED_LAYER]);

        if (ps.IsTented(layer) ?? false)
          new_layers.push([auxLayerType.TENTING, layer, PCB_LAYER_ID.UNDEFINED_LAYER]);
      }

      for (const tuple of new_layers) this.pushMap(this.m_auxilliary_Layers, tuple.join(','), via);
    }

    for (const [key, vec] of sortedEntries(this.m_auxilliary_Layers, numKey)) {
      const [type, first, second] = numKey(key) as [auxLayerType, PCB_LAYER_ID, PCB_LAYER_ID];
      const aux = PCB_IO_IPC2581.auxName(type);

      if (aux && vec.length > 0) {
        const node = this.appendNode(aCadLayerNode, 'Layer');
        this.addAttribute(node, 'layerFunction', aux.layerFunction);
        this.addAttribute(node, 'polarity', 'POSITIVE');

        if (second === PCB_LAYER_ID.UNDEFINED_LAYER) {
          this.addAttribute(node, 'name', this.genLayerString(first, aux.name));
          this.addAttribute(node, 'side', IsFrontLayer(first) ? 'TOP' : 'BOTTOM');
        } else {
          this.addAttribute(node, 'name', this.genLayersString(first, second, aux.name));

          const first_external = first === PCB_LAYER_ID.F_Cu || first === PCB_LAYER_ID.B_Cu;
          const second_external = second === PCB_LAYER_ID.F_Cu || second === PCB_LAYER_ID.B_Cu;

          if (first_external) this.addAttribute(node, 'side', second_external ? 'ALL' : 'TOP');
          else this.addAttribute(node, 'side', second_external ? 'BOTTOM' : 'INTERNAL');

          const spanNode = this.appendNode(node, 'Span');
          this.addAttribute(spanNode, 'fromLayer', this.genLayerString(first, 'LAYER'));
          this.addAttribute(spanNode, 'toLayer', this.genLayerString(second, 'LAYER'));
        }
      }
    }
  }

  private generateStepSection(aCadNode: wxXmlNode): void {
    const stepNode = this.appendNode(aCadNode, 'Step');
    this.addAttribute(
      stepNode,
      'name',
      this.genString(fileNameName(this.board.GetFileName()), 'BOARD'),
    );

    if (this.m_version > 'B') this.addAttribute(stepNode, 'type', 'BOARD');

    const datumNode = this.appendNode(stepNode, 'Datum');
    this.addAttribute(datumNode, 'x', '0.0');
    this.addAttribute(datumNode, 'y', '0.0');

    this.generateProfile(stepNode);
    this.generateComponents(stepNode);

    this.m_last_padstack = this.insertNode(stepNode, 'NonstandardAttribute');
    this.addAttribute(this.m_last_padstack, 'name', 'FOOTPRINT_COUNT');
    this.addAttribute(this.m_last_padstack, 'type', 'INTEGER');
    this.addAttribute(this.m_last_padstack, 'value', String(this.board.Footprints().length));

    this.generateLayerFeatures(stepNode);
    this.generateLayerSetDrill(stepNode);
    this.generateLayerSetAuxilliary(stepNode);
  }

  // ---------------------------------------------------------------------------------------------
  // Pads, vias, padstacks
  // ---------------------------------------------------------------------------------------------

  private addPad(aContentNode: wxXmlNode, aPad: PAD, aLayer: PCB_LAYER_ID): void {
    const padNode = this.appendNode(aContentNode, 'Pad');
    const fp = aPad.GetParentFootprint();

    this.addPadStackForPad(padNode, aPad);

    if (!aPad.GetOrientation().equals(ANGLE_0)) {
      const xformNode = this.appendNode(padNode, 'Xform');
      const angle = aPad.GetOrientation().Normalized();

      xformNode.AddAttribute('rotation', this.floatVal(angle.AsDegrees()));
    }

    this.addLocationPad(padNode, aPad, false);
    this.addPadShape(padNode, aPad, aLayer);

    if (fp) {
      const pinRefNode = this.appendNode(padNode, 'PinRef');

      this.addAttribute(pinRefNode, 'componentRef', this.componentName(fp));
      this.addAttribute(pinRefNode, 'pin', this.pinName(aPad));
    }
  }

  private addVia(aContentNode: wxXmlNode, aVia: PCB_VIA, aLayer: PCB_LAYER_ID): void {
    if (!aVia.FlashLayer(aLayer)) return;

    const padNode = this.appendNode(aContentNode, 'Pad');

    this.addPadStackForVia(padNode, aVia);
    this.addLocationXY(padNode, aVia.GetPosition().x, aVia.GetPosition().y);

    const dummy = new PAD(null);
    const hole = aVia.GetDrillValue();
    dummy.SetDrillSize({ x: hole, y: hole });
    dummy.SetPosition(aVia.GetStart());
    dummy.SetSize(aLayer, { x: aVia.GetWidth(aLayer), y: aVia.GetWidth(aLayer) });

    this.addPadShape(padNode, dummy, aLayer);
  }

  private addPadStackForPad(aPadNode: wxXmlNode, aPad: PAD): void {
    const hash = ipcPadstackHash(aPad);
    const name = `PADSTACK_${this.m_padstack_dict.size + 1}`;
    const success = !this.m_padstack_dict.has(hash);

    if (success) this.m_padstack_dict.set(hash, name);

    this.addAttribute(aPadNode, 'padstackDefRef', this.m_padstack_dict.get(hash)!);

    // If we did not insert a new padstack, then we have already added it to the XML
    // and we don't need to add it again.
    if (!success) return;

    const padStackDefNode = newNode('PadStackDef');
    this.addAttribute(padStackDefNode, 'name', name);
    this.ensureBackdrillSpecs(name, aPad.Padstack());
    this.m_padstacks.push(padStackDefNode);

    if (this.m_last_padstack) {
      this.insertNodeAfter(this.m_last_padstack, padStackDefNode);
      this.m_last_padstack = padStackDefNode;
    }

    const offset = aPad.GetOffset(PADSTACK.ALL_LAYERS);

    // Only handle round holes here because IPC2581 does not support non-round holes
    // These will be handled in a slot layer
    if (aPad.HasDrilledHole()) {
      const padStackHoleNode = this.appendNode(padStackDefNode, 'PadstackHoleDef');
      padStackHoleNode.AddAttribute(
        'name',
        `${aPad.GetAttribute() === PAD_ATTRIB.PTH ? 'PTH' : 'NPTH'}${aPad.GetDrillSizeX()}_${aPad.GetDrillSizeY()}`,
      );

      this.addAttribute(
        padStackHoleNode,
        'diameter',
        this.floatVal(this.m_scale * aPad.GetDrillSizeX()),
      );
      this.addAttribute(
        padStackHoleNode,
        'platingStatus',
        aPad.GetAttribute() === PAD_ATTRIB.PTH ? 'PLATED' : 'NONPLATED',
      );
      this.addAttribute(padStackHoleNode, 'plusTol', '0.0');
      this.addAttribute(padStackHoleNode, 'minusTol', '0.0');
      this.addXY(padStackHoleNode, offset);
    }

    for (const layer of aPad.GetLayerSet().Seq()) {
      if (!this.board.IsLayerEnabled(layer)) continue;

      const padStackPadDefNode = this.appendNode(padStackDefNode, 'PadstackPadDef');
      this.addAttribute(padStackPadDefNode, 'layerRef', this.layerName(layer));
      this.addAttribute(padStackPadDefNode, 'padUse', 'REGULAR');
      this.addLocationXY(padStackPadDefNode, offset.x, offset.y);

      if (aPad.HasHole() || !aPad.FlashLayer(layer)) {
        const shape = new PCB_SHAPE(null, SHAPE_T.CIRCLE);
        shape.SetStart(offset);
        // VECTOR2I / 2: VECTOR2<int> divides by a double and rounds.
        const drill = aPad.GetDrillSize();
        shape.SetEnd({ x: offset.x + KiROUND(drill.x / 2), y: offset.y + KiROUND(drill.y / 2) });
        this.addShape(padStackPadDefNode, shape);
      } else {
        this.addPadShape(padStackPadDefNode, aPad, layer);
      }
    }
  }

  private addPadStackForVia(aContentNode: wxXmlNode, aVia: PCB_VIA): void {
    const hash = ipcPadstackHash(aVia);
    const name = `PADSTACK_${this.m_padstack_dict.size + 1}`;
    const success = !this.m_padstack_dict.has(hash);

    if (success) this.m_padstack_dict.set(hash, name);

    this.addAttribute(aContentNode, 'padstackDefRef', this.m_padstack_dict.get(hash)!);

    // If we did not insert a new padstack, then we have already added it to the XML
    // and we don't need to add it again.
    if (!success) return;

    const padStackDefNode = newNode('PadStackDef');
    this.insertNodeAfter(this.m_last_padstack!, padStackDefNode);
    this.m_last_padstack = padStackDefNode;
    this.addAttribute(padStackDefNode, 'name', name);
    this.ensureBackdrillSpecs(name, aVia.Padstack());

    const padStackHoleNode = this.appendNode(padStackDefNode, 'PadstackHoleDef');
    this.addAttribute(padStackHoleNode, 'name', `PH${aVia.GetDrillValue()}`);
    padStackHoleNode.AddAttribute('diameter', this.floatVal(this.m_scale * aVia.GetDrillValue()));
    this.addAttribute(padStackHoleNode, 'platingStatus', 'VIA');
    this.addAttribute(padStackHoleNode, 'plusTol', '0.0');
    this.addAttribute(padStackHoleNode, 'minusTol', '0.0');
    this.addAttribute(padStackHoleNode, 'x', '0.0');
    this.addAttribute(padStackHoleNode, 'y', '0.0');

    const addPadShape = (aLayer: PCB_LAYER_ID, aLayerRef: string, aDrill: boolean): void => {
      const shape = new PCB_SHAPE(null, SHAPE_T.CIRCLE);

      if (aDrill) shape.SetEnd({ x: KiROUND(aVia.GetDrillValue() / 2.0), y: 0 });
      else shape.SetEnd({ x: KiROUND(aVia.GetWidth(aLayer) / 2.0), y: 0 });

      const padStackPadDefNode = this.appendNode(padStackDefNode, 'PadstackPadDef');
      this.addAttribute(padStackPadDefNode, 'layerRef', aLayerRef);
      this.addAttribute(padStackPadDefNode, 'padUse', 'REGULAR');

      this.addLocationXY(padStackPadDefNode, 0.0, 0.0);
      this.addShape(padStackPadDefNode, shape);
    };

    for (const layer of aVia.GetLayerSet().Seq()) {
      if (!aVia.FlashLayer(layer) || !this.board.IsLayerEnabled(layer)) continue;

      addPadShape(layer, this.layerName(layer), false);
    }

    const ps = aVia.Padstack();

    if (ps.IsFilled() ?? false)
      addPadShape(
        PCB_LAYER_ID.UNDEFINED_LAYER,
        this.genLayersString(aVia.TopLayer(), aVia.BottomLayer(), 'FILLING'),
        true,
      );

    if (ps.IsCapped() ?? false)
      addPadShape(
        PCB_LAYER_ID.UNDEFINED_LAYER,
        this.genLayersString(aVia.TopLayer(), aVia.BottomLayer(), 'CAPPING'),
        true,
      );

    for (const layer of [aVia.TopLayer(), aVia.BottomLayer()]) {
      if (ps.IsPlugged(layer) ?? false)
        addPadShape(layer, this.genLayerString(layer, 'PLUGGING'), true);

      if (ps.IsCovered(layer) ?? false)
        addPadShape(layer, this.genLayerString(layer, 'COVERING'), false);

      if (ps.IsTented(layer) ?? false)
        addPadShape(layer, this.genLayerString(layer, 'TENTING'), false);
    }
  }

  private ensureBackdrillSpecs(aPadstackName: string, aPadstack: PADSTACK): void {
    if (this.m_padstack_backdrill_specs.has(aPadstackName)) return;

    const secondary = aPadstack.SecondaryDrill();
    const tertiary = aPadstack.TertiaryDrill();

    const hasBackdrill = (aDrill: DRILL_PROPS): boolean =>
      aDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      aDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      (aDrill.size.x > 0 || aDrill.size.y > 0);

    if (!hasBackdrill(secondary) && !hasBackdrill(tertiary)) return;

    if (!this.m_cad_header_node) return;

    const layerHasRef = (aLayer: PCB_LAYER_ID): boolean => this.m_layer_name_map.has(aLayer);

    if (hasBackdrill(secondary) && (!layerHasRef(secondary.start) || !layerHasRef(secondary.end)))
      return;

    if (hasBackdrill(tertiary) && (!layerHasRef(tertiary.start) || !layerHasRef(tertiary.end)))
      return;

    const stackup = this.stackup();

    // KiCad's DRILL_PROPS.end is the must-cut layer (deepest copper the drill
    // must pass through, per the UI label "backdrill must-cut"). IPC-2581
    // requires the must-not-cut layer, which is the next enabled copper layer
    // past the must-cut layer going inward (away from the drill start surface).
    const cuStack = this.board.GetEnabledLayers().CuStack();

    const computeMustNotCutLayer = (aDrill: DRILL_PROPS): PCB_LAYER_ID => {
      const it = cuStack.indexOf(aDrill.end);

      if (it < 0) return PCB_LAYER_ID.UNDEFINED_LAYER;

      if (aDrill.start === PCB_LAYER_ID.F_Cu)
        return it + 1 < cuStack.length ? cuStack[it + 1]! : PCB_LAYER_ID.UNDEFINED_LAYER;

      if (aDrill.start === PCB_LAYER_ID.B_Cu)
        return it === 0 ? PCB_LAYER_ID.UNDEFINED_LAYER : cuStack[it - 1]!;

      return PCB_LAYER_ID.UNDEFINED_LAYER;
    };

    const createSpec = (aDrill: DRILL_PROPS, aSpecName: string): string => {
      if (!hasBackdrill(aDrill)) return '';

      const startLayer = this.m_layer_name_map.get(aDrill.start);

      if (startLayer === undefined) return '';

      const mustNotCut = computeMustNotCutLayer(aDrill);
      const mustNotCutEntry = this.m_layer_name_map.get(mustNotCut);

      const specNode = this.appendNode(this.m_cad_header_node!, 'Spec');
      this.addAttribute(specNode, 'name', aSpecName);

      // Counterbore/countersink hint. SpecType has no comment attribute, so
      // surface it as an OTHER-typed Backdrill child whose comment field is
      // schema-allowed.
      let pm_mode = PAD_DRILL_POST_MACHINING_MODE.UNKNOWN;

      if (aDrill.start === PCB_LAYER_ID.F_Cu)
        pm_mode = aPadstack.FrontPostMachining().mode ?? PAD_DRILL_POST_MACHINING_MODE.UNKNOWN;
      else if (aDrill.start === PCB_LAYER_ID.B_Cu)
        pm_mode = aPadstack.BackPostMachining().mode ?? PAD_DRILL_POST_MACHINING_MODE.UNKNOWN;

      let postMachiningComment = '';

      if (pm_mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE)
        postMachiningComment = 'post-machining=COUNTERBORE';
      else if (pm_mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK)
        postMachiningComment = 'post-machining=COUNTERSINK';

      // START_LAYER
      {
        const bd = this.appendNode(specNode, 'Backdrill');
        this.addAttribute(bd, 'type', 'START_LAYER');

        const p = this.appendNode(bd, 'Property');
        this.addAttribute(p, 'layerOrGroupRef', startLayer);
      }

      // MUST_NOT_CUT_LAYER (only when a deeper signal layer exists)
      if (mustNotCut !== PCB_LAYER_ID.UNDEFINED_LAYER && mustNotCutEntry !== undefined) {
        const bd = this.appendNode(specNode, 'Backdrill');
        this.addAttribute(bd, 'type', 'MUST_NOT_CUT_LAYER');

        const p = this.appendNode(bd, 'Property');
        this.addAttribute(p, 'layerOrGroupRef', mustNotCutEntry);
      }

      // MAX_STUB_LENGTH: the maximum residual copper allowed past the
      // must-cut layer. KiCad has no explicit fabricator tolerance, so use
      // half the dielectric thickness between must-cut and must-not-cut as
      // a nominal midpoint. Falls back to zero if no inner signal exists.
      let stubLength = 0;

      if (mustNotCut !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        const dielectric = stackup.GetLayerDistance(aDrill.end, mustNotCut);

        if (dielectric > 0) stubLength = Math.trunc(dielectric / 2);
      }

      {
        const bd = this.appendNode(specNode, 'Backdrill');
        this.addAttribute(bd, 'type', 'MAX_STUB_LENGTH');

        const p = this.appendNode(bd, 'Property');
        this.addAttribute(p, 'value', this.floatVal(this.m_scale * stubLength));
        this.addAttribute(p, 'unit', propertyUnitForCadUnits(this.m_units_str));
      }

      if (postMachiningComment !== '') {
        const bd = this.appendNode(specNode, 'Backdrill');
        this.addAttribute(bd, 'type', 'OTHER');
        this.addAttribute(bd, 'comment', postMachiningComment);
      }

      this.m_backdrill_spec_nodes.set(aSpecName, specNode);

      return aSpecName;
    };

    const specIndex = this.m_backdrill_spec_index + 1;

    const secondarySpec = createSpec(secondary, `BD_${specIndex}A`);
    const tertiarySpec = createSpec(tertiary, `BD_${specIndex}B`);

    if (secondarySpec === '' && tertiarySpec === '') return;

    this.m_backdrill_spec_index = specIndex;
    this.m_padstack_backdrill_specs.set(aPadstackName, [secondarySpec, tertiarySpec]);
  }

  private addBackdrillSpecRefs(aHoleNode: wxXmlNode, aPadstackName: string): void {
    const specs = this.m_padstack_backdrill_specs.get(aPadstackName);

    if (!specs) return;

    for (const specName of specs) {
      if (specName === '') continue;

      const specRefNode = this.appendNode(aHoleNode, 'SpecRef');
      this.addAttribute(specRefNode, 'id', specName);
      this.m_backdrill_spec_used.add(specName);
    }
  }

  private pruneUnusedBackdrillSpecs(): void {
    if (!this.m_cad_header_node) return;

    for (const [name, specNode] of [...this.m_backdrill_spec_nodes].sort(([a], [b]) =>
      strCmp(a, b),
    )) {
      if (this.m_backdrill_spec_used.has(name)) continue;

      this.m_cad_header_node.RemoveChild(specNode);
      this.m_backdrill_spec_nodes.delete(name);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Polygons
  // ---------------------------------------------------------------------------------------------

  private addPolygonNode(
    aParentNode: wxXmlNode,
    aPolygon: SHAPE_LINE_CHAIN,
    aFillType: FILL_T = FILL_T.FILLED_SHAPE,
    aWidth = 0,
    aDashType: LINE_STYLE = LINE_STYLE.SOLID,
  ): boolean {
    if (aPolygon.PointCount() < 3) return false;

    let polygonNode: wxXmlNode | null = null;

    const make_node = (): void => {
      polygonNode = this.appendNode(aParentNode, 'Polygon');
      const polybeginNode = this.appendNode(polygonNode, 'PolyBegin');

      const pts = aPolygon.CPoints();
      this.addXY(polybeginNode, pts[0]!);

      for (let ii = 1; ii < pts.length; ++ii) {
        const polyNode = this.appendNode(polygonNode, 'PolyStepSegment');
        this.addXY(polyNode, pts[ii]!);
      }

      const polyendNode = this.appendNode(polygonNode, 'PolyStepSegment');
      this.addXY(polyendNode, pts[0]!);
    };

    // Allow the case where we don't want line/fill information in the polygon
    if (aFillType === FILL_T.NO_FILL) {
      make_node();
      // If we specify a line width, we need to add a LineDescRef node and
      // since this is only valid for a non-filled polygon, we need to create
      // the fillNode as well
      if (aWidth > 0) this.addLineDesc(polygonNode!, aWidth, aDashType, true);
    } else {
      if (aWidth !== 0) return false;

      make_node();
    }

    this.addFillDesc(polygonNode!, aFillType);

    return true;
  }

  private addPolygonCutouts(aParentNode: wxXmlNode, aPolygon: POLYGON): boolean {
    for (let ii = 1; ii < aPolygon.length; ++ii) {
      if (aPolygon[ii]!.PointCount() < 3) continue;

      const cutoutNode = this.appendNode(aParentNode, 'Cutout');
      const polybeginNode = this.appendNode(cutoutNode, 'PolyBegin');

      const hole = aPolygon[ii]!.CPoints();
      this.addXY(polybeginNode, hole[0]!);

      for (let jj = 1; jj < hole.length; ++jj) {
        const polyNode = this.appendNode(cutoutNode, 'PolyStepSegment');
        this.addXY(polyNode, hole[jj]!);
      }

      const polyendNode = this.appendNode(cutoutNode, 'PolyStepSegment');
      this.addXY(polyendNode, hole[0]!);
    }

    return true;
  }

  private addOutlineNode(
    aParentNode: wxXmlNode,
    aPolySet: SHAPE_POLY_SET,
    aWidth = 0,
    aDashType: LINE_STYLE = LINE_STYLE.SOLID,
  ): boolean {
    if (aPolySet.OutlineCount() === 0) return false;

    const outlineNode = this.appendNode(aParentNode, 'Outline');

    let source = aPolySet;

    if (aPolySet.OutlineCount() > 1) {
      const merged = new SHAPE_POLY_SET(aPolySet);
      merged.Simplify();

      if (merged.OutlineCount() > 0) source = merged;
    }

    for (let ii = 0; ii < source.OutlineCount(); ++ii)
      this.addPolygonNode(outlineNode, source.Outline(ii));

    if (!outlineNode.GetChildren()) {
      aParentNode.RemoveChild(outlineNode);
      return false;
    }

    this.addLineDesc(outlineNode, aWidth, aDashType);

    return true;
  }

  private addContourNode(
    aParentNode: wxXmlNode,
    aPolySet: SHAPE_POLY_SET,
    aOutline = 0,
    aFillType: FILL_T = FILL_T.FILLED_SHAPE,
    aWidth = 0,
    aDashType: LINE_STYLE = LINE_STYLE.SOLID,
  ): boolean {
    if (aPolySet.OutlineCount() < aOutline + 1) return false;

    const contourNode = this.appendNode(aParentNode, 'Contour');

    if (
      this.addPolygonNode(contourNode, aPolySet.Outline(aOutline), aFillType, aWidth, aDashType)
    ) {
      // Do not attempt to add cutouts to shapes that are already hollow
      if (aFillType !== FILL_T.NO_FILL)
        this.addPolygonCutouts(contourNode, aPolySet.Polygon(aOutline));
    } else {
      aParentNode.RemoveChild(contourNode);
      return false;
    }

    return true;
  }

  private generateProfile(aStepNode: wxXmlNode): void {
    const board_outline = new SHAPE_POLY_SET();

    if (
      !this.board.GetBoardPolygonOutlines(board_outline, false) ||
      board_outline.OutlineCount() === 0
    ) {
      this.Report('Board outline is invalid or missing.  Please run DRC.', RPT_SEVERITY_ERROR);
      return;
    }

    const profileNode = this.appendNode(aStepNode, 'Profile');

    if (!this.addPolygonNode(profileNode, board_outline.Outline(0))) {
      aStepNode.RemoveChild(profileNode);
      return;
    }

    this.addPolygonCutouts(profileNode, board_outline.Polygon(0));
  }

  // ---------------------------------------------------------------------------------------------
  // Packages and components
  // ---------------------------------------------------------------------------------------------

  private addPackage(aContentNode: wxXmlNode, aFp: FOOTPRINT): wxXmlNode | null {
    const fp = aFp.Clone();
    fp.SetParentGroup(null);
    fp.SetPosition({ x: 0, y: 0 });
    fp.SetOrientation(ANGLE_0);

    // Track original flipped state before normalization. This is needed to correctly
    // determine OtherSideView content per IPC-2581C. After flipping, layer IDs swap,
    // so for bottom components, B_SilkS/B_Fab after flip is actually the primary view.
    const wasFlipped = fp.IsFlipped();

    // Normalize package geometry to the unflipped footprint coordinate system.
    if (fp.IsFlipped()) fp.Flip(fp.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

    const hash = hash_fp_item(fp, HASH_FLAGS.HASH_POS | HASH_FLAGS.REL_COORD);
    const name = this.genString(
      `${fp.GetFPID().GetLibItemName()}_${this.m_footprint_dict.size + 1}`,
    );

    const success = !this.m_footprint_dict.has(hash);

    if (success) this.m_footprint_dict.set(hash, name);

    this.addAttribute(aContentNode, 'packageRef', this.m_footprint_dict.get(hash)!);

    if (!success) return null;

    // Package and Component nodes are at the same level, so we need to find the parent
    // which should be the Step node
    const packageNode = newNode('Package');
    let otherSideViewNode: wxXmlNode | null = null; // Only set this if we have elements on the back side

    this.addAttribute(packageNode, 'name', name);
    this.addAttribute(packageNode, 'type', 'OTHER'); // TODO: Replace with actual package type once we encode this

    // We don't specially identify pin 1 in our footprints, so we need to guess
    let pinOne = 'UNKNOWN';

    for (const candidate of ['1', 'A1', 'A', 'a', 'a1', 'Anode', 'ANODE']) {
      if (fp.FindPadByNumber(candidate)) {
        pinOne = candidate;
        break;
      }
    }

    this.addAttribute(packageNode, 'pinOne', pinOne);

    // Infer pinOneOrientation from pin 1 position relative to package centroid.
    // IPC-2581C 8.2.3.6 requires a comment attribute when OTHER is used.
    let pinOnePad = fp.FindPadByNumber('1');

    if (!pinOnePad) pinOnePad = fp.FindPadByNumber('A1');

    if (pinOnePad && fp.Pads().length >= 2) {
      const pinPos = pinOnePad.GetFPRelativePosition();
      const fpBBox = fp.GetBoundingBox();
      const center = fpBBox.GetCenter();

      // Use 5% of each dimension as the centerline tolerance band
      const tolX = Math.trunc(fpBBox.GetWidth() / 20);
      const tolY = Math.trunc(fpBBox.GetHeight() / 20);

      const onCenterX = Math.abs(pinPos.x - center.x) <= tolX;
      const onCenterY = Math.abs(pinPos.y - center.y) <= tolY;

      let orientation = 'OTHER';

      if (onCenterX && onCenterY) orientation = 'CENTER';
      else if (onCenterX && pinPos.y < center.y) orientation = 'UPPER_CENTER';
      else if (onCenterX && pinPos.y > center.y) orientation = 'LOWER_CENTER';
      else if (onCenterY && pinPos.x < center.x) orientation = 'LEFT';
      else if (onCenterY && pinPos.x > center.x) orientation = 'RIGHT';
      else if (pinPos.x < center.x && pinPos.y < center.y) orientation = 'UPPER_LEFT';
      else if (pinPos.x > center.x && pinPos.y < center.y) orientation = 'UPPER_RIGHT';
      else if (pinPos.x < center.x && pinPos.y > center.y) orientation = 'LOWER_LEFT';
      else orientation = 'LOWER_RIGHT';

      this.addAttribute(packageNode, 'pinOneOrientation', orientation);
    } else {
      this.addAttribute(packageNode, 'pinOneOrientation', 'OTHER');
      this.addAttribute(packageNode, 'comment', 'Pin 1 orientation could not be determined');
    }

    // After normalization: F_CrtYd is top, B_CrtYd is bottom.
    // For bottom components (wasFlipped), these are swapped from original orientation.
    const courtyard_primary = fp.GetCourtyard(
      wasFlipped ? PCB_LAYER_ID.B_CrtYd : PCB_LAYER_ID.F_CrtYd,
    );
    const courtyard_other = fp.GetCourtyard(
      wasFlipped ? PCB_LAYER_ID.F_CrtYd : PCB_LAYER_ID.B_CrtYd,
    );

    if (courtyard_primary.OutlineCount() > 0) {
      this.addOutlineNode(
        packageNode,
        courtyard_primary,
        courtyard_primary.Outline(0).Width(),
        LINE_STYLE.SOLID,
      );
    } else {
      const bbox = fp.GetBoundingHull();
      this.addOutlineNode(packageNode, bbox);
    }

    if (courtyard_other.OutlineCount() > 0) {
      if (this.m_version > 'B') {
        otherSideViewNode = newNode('OtherSideView');
        this.addOutlineNode(
          otherSideViewNode,
          courtyard_other,
          courtyard_other.Outline(0).Width(),
          LINE_STYLE.SOLID,
        );
      }
    }

    const pickupPointNode = this.appendNode(packageNode, 'PickupPoint');
    this.addAttribute(pickupPointNode, 'x', '0.0');
    this.addAttribute(pickupPointNode, 'y', '0.0');

    // std::map<PCB_LAYER_ID, std::map<bool, std::vector<BOARD_ITEM*>>>: layers ascending, and
    // within one, the relative (false) items before the absolute (true) ones.
    const elements = new Map<PCB_LAYER_ID, Map<boolean, BOARD_ITEM[]>>();

    for (const item of fp.GraphicalItems()) {
      const layer = item.GetLayer();

      /// IPC2581 only supports the documentation layers for production and post-production
      /// All other layers are ignored
      /// TODO: Decide if we should place the other layers from footprints on the board
      if (
        layer !== PCB_LAYER_ID.F_SilkS &&
        layer !== PCB_LAYER_ID.B_SilkS &&
        layer !== PCB_LAYER_ID.F_Fab &&
        layer !== PCB_LAYER_ID.B_Fab
      )
        continue;

      if (this.m_version === 'B' && isOppositeSideSilk(fp, layer)) continue;

      let is_abs = true;

      if (item.Type() === KICAD_T.PCB_SHAPE_T) {
        const shape = item as PCB_SHAPE;

        // Circles and Rectanges only have size information so we need to place them in
        // a separate node that has a location
        if (shape.GetShape() === SHAPE_T.CIRCLE || shape.GetShape() === SHAPE_T.RECTANGLE)
          is_abs = false;
      }

      let byAbs = elements.get(layer);

      if (!byAbs) {
        byAbs = new Map();
        elements.set(layer, byAbs);
      }

      let vec = byAbs.get(is_abs);

      if (!vec) {
        vec = [];
        byAbs.set(is_abs, vec);
      }

      vec.push(item);
    }

    const add_base_node = (aLayer: PCB_LAYER_ID): wxXmlNode => {
      let parent = packageNode;

      // Determine if this layer content should go in OtherSideView.
      // Per IPC-2581C, OtherSideView contains geometry visible from the opposite
      // side of the package body from the primary view.
      //
      // For non-flipped (top) components: B_SilkS/B_Fab → OtherSideView
      // For flipped (bottom) components after normalization: F_SilkS/F_Fab → OtherSideView
      //   (because after flip, B_SilkS/B_Fab contains the original primary graphics)
      const is_other_side = wasFlipped
        ? aLayer === PCB_LAYER_ID.F_SilkS || aLayer === PCB_LAYER_ID.F_Fab
        : aLayer === PCB_LAYER_ID.B_SilkS || aLayer === PCB_LAYER_ID.B_Fab;

      if (is_other_side && this.m_version > 'B') {
        if (!otherSideViewNode) otherSideViewNode = newNode('OtherSideView');

        parent = otherSideViewNode;
      }

      const nodeName =
        aLayer === PCB_LAYER_ID.F_SilkS || aLayer === PCB_LAYER_ID.B_SilkS
          ? 'SilkScreen'
          : 'AssemblyDrawing';

      return this.appendNode(parent, nodeName);
    };

    const add_marking_node = (aNode: wxXmlNode): wxXmlNode => {
      const marking_node = this.appendNode(aNode, 'Marking');
      this.addAttribute(marking_node, 'markingUsage', 'NONE');
      return marking_node;
    };

    const layer_nodes = new Map<PCB_LAYER_ID, wxXmlNode>();
    const layer_bbox = new Map<PCB_LAYER_ID, BOX2I>();

    for (const layer of [PCB_LAYER_ID.F_Fab, PCB_LAYER_ID.B_Fab]) {
      const byAbs = elements.get(layer);

      if (byAbs) {
        const abs = byAbs.get(true) ?? [];
        const rel = byAbs.get(false) ?? [];

        // `elements[layer][true]` inserts an empty vector, which the walk below then sees.
        if (!byAbs.has(true)) byAbs.set(true, abs);

        if (abs.length > 0) layer_bbox.set(layer, abs[0]!.GetBoundingBox().Clone());
        else {
          if (!byAbs.has(false)) byAbs.set(false, rel);

          if (rel.length > 0) layer_bbox.set(layer, rel[0]!.GetBoundingBox().Clone());
        }
      }
    }

    for (const layer of [...elements.keys()].sort((a, b) => a - b)) {
      const map = elements.get(layer)!;
      const layer_node = add_base_node(layer);
      const marking_node = add_marking_node(layer_node);
      const group_node = this.appendNode(marking_node, 'UserSpecial');
      let update_bbox = false;

      if (layer === PCB_LAYER_ID.F_Fab || layer === PCB_LAYER_ID.B_Fab) {
        layer_nodes.set(layer, layer_node);
        update_bbox = true;
      }

      for (const is_abs of [false, true]) {
        const vec = map.get(is_abs);

        if (!vec) continue;

        for (const item of vec) {
          if (update_bbox) {
            let box = layer_bbox.get(layer);

            if (!box) {
              box = new BOX2I();
              layer_bbox.set(layer, box);
            }

            box.Merge(item.GetBoundingBox());
          }

          const output_node = !is_abs ? add_marking_node(layer_node) : group_node;

          switch (item.Type()) {
            case KICAD_T.PCB_TEXT_T: {
              const text = item as PCB_TEXT;

              if (text.IsKnockout()) this.addKnockoutText(output_node, text);
              else this.addText(output_node, text);

              break;
            }

            case KICAD_T.PCB_TEXTBOX_T: {
              const text = item as PCB_TEXTBOX;
              this.addText(output_node, text);

              // We want to force this to be a polygon to get absolute coordinates
              if (text.IsBorderEnabled()) {
                const poly_set = new SHAPE_POLY_SET();
                text.GetEffectiveShape().TransformToPolygon(poly_set, 0, ERROR_LOC.ERROR_INSIDE);
                this.addContourNode(
                  output_node,
                  poly_set,
                  0,
                  FILL_T.NO_FILL,
                  text.GetBorderWidth(),
                );
              }

              break;
            }

            case KICAD_T.PCB_SHAPE_T: {
              if (!is_abs) this.addLocationShape(output_node, item as PCB_SHAPE);

              // When in Marking context (!is_abs), use inline geometry to avoid
              // unresolved UserPrimitiveRef errors in validators like Vu2581
              this.addShape(output_node, item as PCB_SHAPE, !is_abs);

              break;
            }

            default:
              break;
          }
        }
      }

      if (group_node.GetChildren() === null) {
        marking_node.RemoveChild(group_node);
        layer_node.RemoveChild(marking_node);
      }
    }

    for (const layer of [...layer_bbox.keys()].sort((a, b) => a - b)) {
      const bbox = layer_bbox.get(layer)!;

      if (bbox.GetWidth() > 0) {
        // `layer_nodes[layer]` - set for every Fab layer that had elements.
        const outlineNode = this.insertNode(layer_nodes.get(layer)!, 'Outline');

        const outline = new SHAPE_LINE_CHAIN();
        const p0 = bbox.GetPosition();
        const p2 = bbox.GetEnd();

        for (const pt of [p0, { x: p0.x, y: p2.y }, p2, { x: p2.x, y: p0.y }]) outline.Append(pt);
        this.addPolygonNode(outlineNode, outline, FILL_T.NO_FILL, 0);
        this.addLineDesc(outlineNode, 0, LINE_STYLE.SOLID);
      }
    }

    const pin_nodes = new Set<string>();

    for (const pad of fp.Pads()) {
      const pin_name = this.pinName(pad);

      if (!pin_nodes.has(pin_name)) {
        pin_nodes.add(pin_name);

        const pinNode = this.appendNode(packageNode, 'Pin');

        this.addAttribute(pinNode, 'number', pin_name);

        let pins = this.m_net_pin_dict.get(pad.GetNetCode());

        if (!pins) {
          pins = [];
          this.m_net_pin_dict.set(pad.GetNetCode(), pins);
        }

        pins.push([this.genString(fp.GetReference(), 'CMP'), pin_name]);

        if (pad.GetAttribute() === PAD_ATTRIB.NPTH)
          this.addAttribute(pinNode, 'electricalType', 'MECHANICAL');
        else if (pad.IsOnCopperLayer()) this.addAttribute(pinNode, 'electricalType', 'ELECTRICAL');
        else this.addAttribute(pinNode, 'electricalType', 'UNDEFINED');

        if (pad.HasHole()) this.addAttribute(pinNode, 'type', 'THRU');
        else this.addAttribute(pinNode, 'type', 'SURFACE');

        if (!pad.GetFPRelativeOrientation().equals(ANGLE_0)) {
          //|| fp->IsFlipped() )
          const xformNode = this.appendNode(pinNode, 'Xform');
          let pad_angle = pad.GetFPRelativeOrientation().Normalized();

          if (fp.IsFlipped()) pad_angle = pad_angle.Invert().Normalize();

          if (!pad_angle.equals(ANGLE_0))
            xformNode.AddAttribute('rotation', this.floatVal(pad_angle.AsDegrees()));
        }

        this.addLocationPad(pinNode, pad, true);
        this.addPadShape(pinNode, pad, pad.GetLayer());
      }

      // We just need the padstack, we don't need the reference here.  The reference will be
      // created in the LayerFeature set
      this.addPadStackForPad(newNode(''), pad);
    }

    if (otherSideViewNode) packageNode.AddChild(otherSideViewNode);

    return packageNode;
  }

  private generateComponents(aStepNode: wxXmlNode): void {
    const componentNodes: wxXmlNode[] = [];
    const packageNodes: wxXmlNode[] = [];

    const generate_unique = this.m_OEMRef === '';

    for (const fp of this.board.Footprints()) {
      const componentNode = newNode('Component');
      this.addAttribute(componentNode, 'refDes', this.componentName(fp));
      const pkg = this.addPackage(componentNode, fp);

      if (pkg) packageNodes.push(pkg);

      let name: string;

      const field = generate_unique ? null : fp.GetField(this.m_OEMRef);

      if (field && field.GetText() !== '') {
        name = field.GetShownText(false);
      } else {
        name = `${fp.GetFPID().GetFullLibraryName()}_${fp.GetFPID().GetLibItemName()}_${fp.GetValue()}`;
      }

      if (this.m_OEMRef_dict.has(fp))
        this.Report(
          'Duplicate footprint pointers encountered; IPC-2581 output may be incorrect.',
          RPT_SEVERITY_ERROR,
        );
      else this.m_OEMRef_dict.set(fp, name);

      this.addAttribute(componentNode, 'part', this.genString(name, 'REF'));
      this.addAttribute(componentNode, 'layerRef', this.layerName(fp.GetLayer()));

      if (fp.GetAttributes() & FOOTPRINT_ATTR_T.FP_THROUGH_HOLE)
        this.addAttribute(componentNode, 'mountType', 'THMT');
      else if (fp.GetAttributes() & FOOTPRINT_ATTR_T.FP_SMD)
        this.addAttribute(componentNode, 'mountType', 'SMT');
      else this.addAttribute(componentNode, 'mountType', 'OTHER');

      if (!fp.GetOrientation().equals(ANGLE_0) || fp.IsFlipped()) {
        const xformNode = this.appendNode(componentNode, 'Xform');

        let fp_angle = fp.GetOrientation().Normalized();

        if (fp.IsFlipped()) fp_angle = fp_angle.Invert().sub(ANGLE_180).Normalize();

        if (!fp_angle.equals(ANGLE_0))
          this.addAttribute(xformNode, 'rotation', this.floatVal(fp_angle.AsDegrees(), 2));

        if (fp.IsFlipped()) this.addAttribute(xformNode, 'mirror', 'true');
      }

      this.addLocationXY(componentNode, fp.GetPosition().x, fp.GetPosition().y);

      componentNodes.push(componentNode);
    }

    for (const padstack of this.m_padstacks) {
      this.insertNodeAt(aStepNode, padstack);
      this.m_last_padstack = padstack;
    }

    for (const pkg of packageNodes) aStepNode.AddChild(pkg);

    for (const cmp of componentNodes) aStepNode.AddChild(cmp);
  }

  private generateLogicalNets(aStepNode: wxXmlNode): void {
    for (const net of [...this.m_net_pin_dict.keys()].sort((a, b) => a - b)) {
      const netNode = this.appendNode(aStepNode, 'LogicalNet');
      this.addAttribute(
        netNode,
        'name',
        this.genString(this.board.GetNetInfo().GetNetItem(net)!.GetNetname(), 'NET'),
      );

      for (const [cmp, pin] of this.m_net_pin_dict.get(net)!) {
        const netPinNode = this.appendNode(netNode, 'PinRef');
        this.addAttribute(netPinNode, 'componentRef', cmp);
        this.addAttribute(netPinNode, 'pin', pin);
      }
      //TODO: Finish
    }
  }

  //TODO: Add PhyNetGroup section

  private generateLayerFeatures(aStepNode: wxXmlNode): void {
    const layers = this.board.GetEnabledLayers().Seq();
    const nets = this.board.GetNetInfo();

    // To avoid the overhead of repeatedly cycling through the layers and nets,
    // we pre-sort the board items into a map of layer -> net -> items
    const elements = new Map<PCB_LAYER_ID, Map<number, BOARD_ITEM[]>>();

    const push = (aLayer: PCB_LAYER_ID, aNet: number, aItem: BOARD_ITEM): void => {
      let byNet = elements.get(aLayer);

      if (!byNet) {
        byNet = new Map();
        elements.set(aLayer, byNet);
      }

      let vec = byNet.get(aNet);

      if (!vec) {
        vec = [];
        byNet.set(aNet, vec);
      }

      vec.push(aItem);
    };

    for (const aTrack of this.board.Tracks()) {
      if (aTrack.Type() === KICAD_T.PCB_VIA_T) {
        const via = aTrack as PCB_VIA;

        for (const layer of layers) {
          if (via.FlashLayer(layer)) push(layer, via.GetNetCode(), via);
        }
      } else {
        push(aTrack.GetLayer(), aTrack.GetNetCode(), aTrack);
      }
    }

    for (const zone of this.board.Zones()) {
      for (const layer of zone.GetLayerSet().Seq()) push(layer, zone.GetNetCode(), zone);
    }

    for (const item of this.board.Drawings()) {
      if (item.IsConnected()) push(item.GetLayer(), (item as PCB_SHAPE).GetNetCode(), item);
      else push(item.GetLayer(), 0, item);
    }

    for (const fp of this.board.Footprints()) {
      for (const field of fp.GetFields()) push(field.GetLayer(), 0, field);

      // A graphic can live on several layers at once (e.g. copper + mask). KiCad plots it on
      // each, so emit it on every layer in its set rather than only its primary layer.
      for (const item of fp.GraphicalItems()) {
        for (const layer of item.GetLayerSet().Seq()) push(layer, 0, item);
      }

      for (const pad of fp.Pads()) {
        for (const layer of pad.GetLayerSet().Seq()) {
          if (pad.FlashLayer(layer)) push(layer, pad.GetNetCode(), pad);
        }

        // Some SMD pad definitions omit the mask layer even though their copper needs a
        // mask opening. Add those implicit mask features on the corresponding copper side.
        // This only applies when the pad authors no mask side at all. A pad that carries a
        // mask on one side only (e.g. *.Cu + B.Mask) has intentionally suppressed the other,
        // so it must not receive an implicit opening there.
        // Solder paste is intentionally NOT added here. Absence of F.Paste/B.Paste in the
        // pad's layer set means "no paste" and must be respected, e.g. for thermal/exposed
        // pads whose stencil apertures are modeled as separate paste-only pads.
        const hasAuthoredMask =
          pad.IsOnLayer(PCB_LAYER_ID.F_Mask) || pad.IsOnLayer(PCB_LAYER_ID.B_Mask);

        if (!hasAuthoredMask) {
          if (pad.IsOnLayer(PCB_LAYER_ID.F_Cu) && pad.FlashLayer(PCB_LAYER_ID.F_Cu))
            push(PCB_LAYER_ID.F_Mask, pad.GetNetCode(), pad);

          if (pad.IsOnLayer(PCB_LAYER_ID.B_Cu) && pad.FlashLayer(PCB_LAYER_ID.B_Cu))
            push(PCB_LAYER_ID.B_Mask, pad.GetNetCode(), pad);
        }
      }
    }

    // The parent-footprint pointer order upstream sorts by: load order, null first.
    const fpOrder = new Map<FOOTPRINT, number>();
    this.board.Footprints().forEach((fp, i) => fpOrder.set(fp, i + 1));
    const parentRank = (aItem: BOARD_ITEM): number => {
      const fp = aItem.GetParentFootprint();
      return fp ? (fpOrder.get(fp) ?? 0) : 0;
    };

    for (const layer of layers) {
      const layerNode = this.appendNode(aStepNode, 'LayerFeature');
      this.addAttribute(layerNode, 'layerRef', this.layerName(layer));

      const process_net = (net: number): void => {
        const vec = elements.get(layer)?.get(net);

        if (!vec || vec.length === 0) return;

        // std::stable_sort; Array.prototype.sort is stable.
        vec.sort((a, b) => {
          const ra = parentRank(a);
          const rb = parentRank(b);

          if (ra === rb) return a.Type() - b.Type();

          return ra - rb;
        });

        this.generateLayerSetNet(layerNode, layer, vec);
      };

      for (const net of nets) process_net(net.GetNetCode());

      if (layerNode.GetChildren() === null) aStepNode.RemoveChild(layerNode);
    }
  }

  private generateLayerSetDrill(aLayerNode: wxXmlNode): void {
    let hole_count = 1;

    for (const [key, vec] of sortedEntries(this.m_drill_layers, numKey)) {
      const [first, second] = numKey(key) as [PCB_LAYER_ID, PCB_LAYER_ID];
      const layerNode = this.appendNode(aLayerNode, 'LayerFeature');
      layerNode.AddAttribute('layerRef', this.genLayersString(first, second, 'DRILL'));

      for (const item of vec) {
        if (item.Type() === KICAD_T.PCB_VIA_T) {
          const via = item as PCB_VIA;
          const geometry = this.m_padstack_dict.get(ipcPadstackHash(via));

          if (geometry === undefined) {
            this.Report(
              'Via uses unsupported padstack; omitted from drill data.',
              RPT_SEVERITY_WARNING,
            );
            continue;
          }

          const padNode = this.appendNode(layerNode, 'Set');
          this.addAttribute(padNode, 'geometry', geometry);

          if (via.GetNetCode() > 0)
            this.addAttribute(padNode, 'net', this.genString(via.GetNetname(), 'NET'));

          const holeNode = this.appendNode(padNode, 'Hole');
          this.addAttribute(holeNode, 'name', `H${hole_count++}`);
          this.addAttribute(
            holeNode,
            'diameter',
            this.floatVal(this.m_scale * via.GetDrillValue()),
          );
          this.addAttribute(holeNode, 'platingStatus', 'VIA');
          this.addAttribute(holeNode, 'plusTol', '0.0');
          this.addAttribute(holeNode, 'minusTol', '0.0');
          this.addXY(holeNode, via.GetPosition());
          this.addBackdrillSpecRefs(holeNode, geometry);
        } else if (item.Type() === KICAD_T.PCB_PAD_T) {
          const pad = item as PAD;
          const geometry = this.m_padstack_dict.get(ipcPadstackHash(pad));

          if (geometry === undefined) {
            this.Report(
              'Pad uses unsupported padstack; hole was omitted from drill data.',
              RPT_SEVERITY_WARNING,
            );
            continue;
          }

          const padNode = this.appendNode(layerNode, 'Set');
          this.addAttribute(padNode, 'geometry', geometry);

          if (pad.GetNetCode() > 0)
            this.addAttribute(padNode, 'net', this.genString(pad.GetNetname(), 'NET'));

          const holeNode = this.appendNode(padNode, 'Hole');
          this.addAttribute(holeNode, 'name', `H${hole_count++}`);
          this.addAttribute(
            holeNode,
            'diameter',
            this.floatVal(this.m_scale * pad.GetDrillSizeX()),
          );
          this.addAttribute(
            holeNode,
            'platingStatus',
            pad.GetAttribute() === PAD_ATTRIB.PTH ? 'PLATED' : 'NONPLATED',
          );
          this.addAttribute(holeNode, 'plusTol', '0.0');
          this.addAttribute(holeNode, 'minusTol', '0.0');
          this.addXY(holeNode, pad.GetPosition());
          this.addBackdrillSpecRefs(holeNode, geometry);
        }
      }
    }

    hole_count = 1;

    for (const [key, vec] of sortedEntries(this.m_slot_holes, numKey)) {
      const [first, second] = numKey(key) as [PCB_LAYER_ID, PCB_LAYER_ID];
      const layerNode = this.appendNode(aLayerNode, 'LayerFeature');
      layerNode.AddAttribute('layerRef', this.genLayersString(first, second, 'SLOT'));

      for (const pad of vec) {
        const padNode = this.appendNode(layerNode, 'Set');

        if (pad.GetNetCode() > 0)
          this.addAttribute(padNode, 'net', this.genString(pad.GetNetname(), 'NET'));

        this.addSlotCavity(padNode, pad, `SLOT${hole_count++}`);
      }
    }
  }

  private generateLayerSetNet(
    aLayerNode: wxXmlNode,
    aLayer: PCB_LAYER_ID,
    aItems: BOARD_ITEM[],
  ): void {
    const layerSetNode = this.appendNode(aLayerNode, 'Set');
    const featureSetNode = this.appendNode(layerSetNode, 'Features');
    const specialNode = this.appendNode(featureSetNode, 'UserSpecial');

    let has_via = false;
    let has_pad = false;

    let padSetNode: wxXmlNode | null = null;
    let viaSetNode: wxXmlNode | null = null;

    let teardropFeatureSetNode: wxXmlNode | null = null;

    let teardrop_warning = false;

    const first = aItems[0]!;

    if (IsCopperLayer(aLayer) && first.IsConnected()) {
      const item = first as PAD;

      if (item.GetNetCode() > 0)
        this.addAttribute(layerSetNode, 'net', this.genString(item.GetNetname(), 'NET'));
    }

    const add_track = (track: PCB_TRACK): void => {
      if (track.Type() === KICAD_T.PCB_TRACE_T) {
        const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
        shape.SetStart(track.GetStart());
        shape.SetEnd(track.GetEnd());
        shape.SetWidth(track.GetWidth());
        this.addShape(specialNode, shape);
      } else if (track.Type() === KICAD_T.PCB_ARC_T) {
        const arc = track as PCB_ARC;
        const shape = new PCB_SHAPE(null, SHAPE_T.ARC);
        shape.SetArcGeometry(arc.GetStart(), arc.GetMid(), arc.GetEnd());
        shape.SetWidth(arc.GetWidth());
        this.addShape(specialNode, shape);
      } else {
        if (!viaSetNode) {
          if (!has_pad) {
            viaSetNode = layerSetNode;
            has_via = true;
          } else {
            viaSetNode = this.appendNode(layerSetNode, 'Set');

            if (track.GetNetCode() > 0)
              this.addAttribute(viaSetNode, 'net', this.genString(track.GetNetname(), 'NET'));
          }

          this.addAttribute(viaSetNode, 'padUsage', 'VIA');
        }

        this.addVia(viaSetNode, track as PCB_VIA, aLayer);
      }
    };

    const add_zone = (zone: ZONE): void => {
      let zoneFeatureNode = specialNode;

      if (zone.IsTeardropArea()) {
        if (this.m_version > 'B') {
          if (!teardropFeatureSetNode) {
            const teardropLayerSetNode = this.appendNode(aLayerNode, 'Set');
            this.addAttribute(teardropLayerSetNode, 'geometryUsage', 'TEARDROP');

            if (zone.GetNetCode() > 0)
              this.addAttribute(
                teardropLayerSetNode,
                'net',
                this.genString(zone.GetNetname(), 'NET'),
              );

            const new_teardrops = this.appendNode(teardropLayerSetNode, 'Features');
            this.addLocationXY(new_teardrops, 0.0, 0.0);
            teardropFeatureSetNode = this.appendNode(new_teardrops, 'UserSpecial');
          }

          zoneFeatureNode = teardropFeatureSetNode;
        } else if (!teardrop_warning) {
          this.Report(
            'Teardrops are not supported in IPC-2581 revision B; they were exported as zones.',
            RPT_SEVERITY_WARNING,
          );
          teardrop_warning = true;
        }
      } else {
        const fp = zone.GetParentFootprint();

        if (fp) {
          const tempSetNode = this.appendNode(aLayerNode, 'Set');
          const refDes = this.componentName(fp);
          this.addAttribute(tempSetNode, 'componentRef', refDes);
          const newFeatures = this.appendNode(tempSetNode, 'Features');
          this.addLocationXY(newFeatures, 0.0, 0.0);
          zoneFeatureNode = this.appendNode(newFeatures, 'UserSpecial');
        }
      }

      const zone_shape = zone.GetFilledPolysList(aLayer);

      if (!zone_shape) return;

      for (let ii = 0; ii < zone_shape.OutlineCount(); ++ii)
        this.addContourNode(zoneFeatureNode, zone_shape, ii);
    };

    const add_shape = (shape: PCB_SHAPE): void => {
      const fp = shape.GetParentFootprint();

      if (fp) {
        const tempSetNode = this.appendNode(aLayerNode, 'Set');

        if (this.m_version > 'B') this.addAttribute(tempSetNode, 'geometryUsage', 'GRAPHIC');

        let link_to_component = true;

        if (this.m_version === 'B' && isOppositeSideSilk(fp, shape.GetLayer()))
          link_to_component = false;

        if (link_to_component)
          this.addAttribute(tempSetNode, 'componentRef', this.componentName(fp));

        const tempFeature = this.appendNode(tempSetNode, 'Features');

        this.addLocationShape(tempFeature, shape);
        this.addShape(tempFeature, shape);
      } else if (
        shape.GetShape() === SHAPE_T.CIRCLE ||
        shape.GetShape() === SHAPE_T.RECTANGLE ||
        shape.GetShape() === SHAPE_T.POLY
      ) {
        const tempSetNode = this.appendNode(aLayerNode, 'Set');

        if (shape.GetNetCode() > 0)
          this.addAttribute(tempSetNode, 'net', this.genString(shape.GetNetname(), 'NET'));

        const tempFeature = this.appendNode(tempSetNode, 'Features');
        this.addLocationShape(tempFeature, shape);
        this.addShape(tempFeature, shape);
      } else {
        this.addShape(specialNode, shape);
      }
    };

    const add_text = (text: BOARD_ITEM): void => {
      const fp = text.GetParentFootprint();
      const type = text.Type();

      if (
        type !== KICAD_T.PCB_TEXT_T &&
        type !== KICAD_T.PCB_FIELD_T &&
        type !== KICAD_T.PCB_TEXTBOX_T
      )
        return;

      const text_item = text as PCB_TEXT | PCB_TEXTBOX;

      if (!text_item.IsVisible() || text_item.GetShownText(false) === '') return;

      const isWhitespace = wxStrip(text_item.GetShownText(false)) === '';
      const isKnockout = type === KICAD_T.PCB_TEXT_T && (text as PCB_TEXT).IsKnockout();
      const hasBorder = type === KICAD_T.PCB_TEXTBOX_T && (text as PCB_TEXTBOX).IsBorderEnabled();

      if (isWhitespace && !isKnockout && !hasBorder) return;

      const tempSetNode = this.appendNode(aLayerNode, 'Set');

      if (this.m_version > 'B') this.addAttribute(tempSetNode, 'geometryUsage', 'TEXT');

      let link_to_component = fp !== null;

      if (this.m_version === 'B' && fp && isOppositeSideSilk(fp, text.GetLayer()))
        link_to_component = false;

      if (link_to_component)
        this.addAttribute(tempSetNode, 'componentRef', this.componentName(fp!));

      const nonStandardAttributeNode = this.appendNode(tempSetNode, 'NonstandardAttribute');
      this.addAttribute(nonStandardAttributeNode, 'name', 'TEXT');
      this.addAttribute(nonStandardAttributeNode, 'value', text_item.GetShownText(false));
      this.addAttribute(nonStandardAttributeNode, 'type', 'STRING');

      if (!isWhitespace || isKnockout) {
        const glyphFeature = this.appendNode(tempSetNode, 'Features');
        this.addLocationXY(glyphFeature, 0.0, 0.0);

        if (isKnockout) this.addKnockoutText(glyphFeature, text as PCB_TEXT);
        else this.addText(glyphFeature, text_item);
      }

      if (hasBorder) {
        const border = text as unknown as PCB_SHAPE;
        const borderFeature = this.appendNode(tempSetNode, 'Features');

        this.addLocationShape(borderFeature, border);
        this.addShape(borderFeature, border);
      }
    };

    const add_pad = (pad: PAD): void => {
      if (!padSetNode) {
        if (!has_via) {
          padSetNode = layerSetNode;
          has_pad = true;
        } else {
          padSetNode = this.appendNode(aLayerNode, 'Set');

          if (pad.GetNetCode() > 0)
            this.addAttribute(padSetNode, 'net', this.genString(pad.GetNetname(), 'NET'));
        }
      }

      const fp = pad.GetParentFootprint();

      if (fp?.IsFlipped()) this.addPad(padSetNode, pad, FlipLayer(aLayer));
      else this.addPad(padSetNode, pad, aLayer);
    };

    for (const item of aItems) {
      switch (item.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
          add_track(item as PCB_TRACK);
          break;

        case KICAD_T.PCB_ZONE_T:
          add_zone(item as ZONE);
          break;

        case KICAD_T.PCB_PAD_T:
          add_pad(item as PAD);
          break;

        case KICAD_T.PCB_SHAPE_T:
          add_shape(item as PCB_SHAPE);
          break;

        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_FIELD_T:
          add_text(item);
          break;

        default:
          //TODO: Add support for dimensions
          break;
      }
    }

    if (specialNode.GetChildren() === null) featureSetNode.RemoveChild(specialNode);

    if (featureSetNode.GetChildren() === null) layerSetNode.RemoveChild(featureSetNode);

    if (layerSetNode.GetChildren() === null) aLayerNode.RemoveChild(layerSetNode);
  }

  private generateLayerSetAuxilliary(aStepNode: wxXmlNode): void {
    for (const [key, vec] of sortedEntries(this.m_auxilliary_Layers, numKey)) {
      const [type, first, second] = numKey(key) as [auxLayerType, PCB_LAYER_ID, PCB_LAYER_ID];
      const aux = PCB_IO_IPC2581.auxName(type);

      if (!aux) continue;

      const layerNode = this.appendNode(aStepNode, 'LayerFeature');

      if (second === PCB_LAYER_ID.UNDEFINED_LAYER)
        layerNode.AddAttribute('layerRef', this.genLayerString(first, aux.name));
      else layerNode.AddAttribute('layerRef', this.genLayersString(first, second, aux.name));

      const setNode = this.appendNode(layerNode, 'Set');

      for (const item of vec) {
        if (item.Type() !== KICAD_T.PCB_VIA_T) continue;

        const via = item as PCB_VIA;

        const shape = new PCB_SHAPE(null, SHAPE_T.CIRCLE);

        if (aux.hole) shape.SetEnd({ x: KiROUND(via.GetDrillValue() / 2.0), y: 0 });
        else shape.SetEnd({ x: KiROUND(via.GetWidth(first) / 2.0), y: 0 });

        const padNode = this.appendNode(setNode, 'Pad');
        this.addPadStackForVia(padNode, via);

        this.addLocationXY(padNode, via.GetPosition().x, via.GetPosition().y);
        this.addShape(padNode, shape);
      }
    }
  }

  private generateAvlSection(): wxXmlNode | null {
    this.m_progressReporter?.AdvancePhase('Generating BOM section');

    // Per IPC-2581 schema, Avl requires at least one AvlItem child element.
    // Don't emit Avl section if there are no items.
    if (this.m_OEMRef_dict.size === 0) return null;

    const avl = this.appendNode(this.m_xml_root!, 'Avl');
    this.addAttribute(avl, 'name', 'Primary_Vendor_List');

    const header = this.appendNode(avl, 'AvlHeader');
    this.addAttribute(header, 'title', 'BOM');
    this.addAttribute(header, 'source', 'KiCad');
    this.addAttribute(header, 'author', 'OWNER');
    this.addAttribute(header, 'datetime', nowISOCombined());
    this.addAttribute(header, 'version', '1');

    const unique_parts = new Set<string>();
    const unique_vendors = new Map<string, string>();

    // std::map<FOOTPRINT*, …>: pointer order, here the board's footprint order.
    const order = new Map<FOOTPRINT, number>();
    this.board.Footprints().forEach((fp, i) => order.set(fp, i));

    const byPointer = [...this.m_OEMRef_dict].sort(
      ([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );

    for (const [fp, name] of byPointer) {
      if (unique_parts.has(name)) continue;

      unique_parts.add(name);

      const part = this.appendNode(avl, 'AvlItem');
      this.addAttribute(part, 'OEMDesignNumber', this.genString(name, 'REF'));

      const nums = [fp.GetField(this.m_mpn), fp.GetField(this.m_distpn)];
      const company = [fp.GetField(this.m_mfg), null];
      const company_name = [this.m_mfg, this.m_dist];

      for (let ii = 0; ii < 2; ++ii) {
        const num = nums[ii];

        if (num) {
          const mpn_name = num.GetShownText(false);

          if (mpn_name === '') continue;

          const vmpn = this.appendNode(part, 'AvlVmpn');
          this.addAttribute(vmpn, 'qualified', 'false');
          this.addAttribute(vmpn, 'chosen', 'false');

          const mpn = this.appendNode(vmpn, 'AvlMpn');
          this.addAttribute(mpn, 'name', mpn_name);

          const vendor = this.appendNode(vmpn, 'AvlVendor');

          let vendor_name = 'UNKNOWN';

          // If the field resolves, then use that field content unless it is empty
          if (!ii && company[ii]) {
            const tmp = company[ii]!.GetShownText(false);

            if (tmp !== '') vendor_name = tmp;
          }
          // If it doesn't resolve but there is content from the dialog, use the static content
          else if (!ii && company_name[ii] !== '') {
            vendor_name = company_name[ii]!;
          } else if (ii && this.m_dist !== '') {
            vendor_name = this.m_dist;
          }

          const inserted = !unique_vendors.has(vendor_name);

          if (inserted) unique_vendors.set(vendor_name, `VENDOR_${unique_vendors.size}`);

          const vendor_id = unique_vendors.get(vendor_name)!;

          this.addAttribute(vendor, 'enterpriseRef', vendor_id);

          if (inserted) {
            const new_vendor = newNode('Enterprise');
            this.addAttribute(new_vendor, 'id', vendor_id);
            this.addAttribute(new_vendor, 'name', vendor_name);
            this.addAttribute(new_vendor, 'code', 'NONE');
            this.insertNodeAfter(this.m_enterpriseNode!, new_vendor);
            this.m_enterpriseNode = new_vendor;
          }
        }
      }
    }

    return avl;
  }

  /** The whole document as text: what SaveBoard writes. */
  FormatBoard(aBoard: BOARD, aProperties: PCB_IO_PROPERTIES | null = null): string {
    // Clean up any previous export state to allow multiple exports per plugin instance
    this.m_xml_root = null;
    this.m_contentNode = null;

    this.m_board = aBoard;
    this.m_padstack_backdrill_specs.clear();
    this.m_backdrill_spec_nodes.clear();
    this.m_backdrill_spec_used.clear();
    this.m_backdrill_spec_index = 0;
    this.m_cad_header_node = null;
    this.m_layer_name_map.clear();

    // Clear all internal dictionaries and caches
    this.m_user_shape_dict.clear();
    this.m_shape_user_node = null;
    this.m_std_shape_dict.clear();
    this.m_shape_std_node = null;
    this.m_line_dict.clear();
    this.m_line_node = null;
    this.m_padstack_dict.clear();
    this.m_padstacks = [];
    this.m_last_padstack = null;
    this.m_footprint_dict.clear();
    this.m_footprint_refdes_dict.clear();
    this.m_footprint_refdes_reverse_dict.clear();
    this.m_OEMRef_dict.clear();
    this.m_net_pin_dict.clear();
    this.m_drill_layers.clear();
    this.m_slot_holes.clear();
    this.m_auxilliary_Layers.clear();
    this.m_element_names.clear();
    this.m_generated_names.clear();
    this.m_acceptable_chars.clear();
    this.m_total_bytes = 0;

    this.m_units_str = 'MILLIMETER';
    this.m_scale = 1.0 / pcbIUScale.IU_PER_MM;
    this.m_sigfig = 6;

    // The base PCB_IO interface permits a null property set; alias it to an empty
    // map so the optional lookups below remain valid.
    const props = aProperties ?? new Map<string, string>();
    const prop = (k: string): string | undefined => props.get(k);

    if (prop('units') === 'inch') {
      this.m_units_str = 'INCH';
      this.m_scale = 1.0 / 25.4 / pcbIUScale.IU_PER_MM;
    }

    if (prop('sigfig') !== undefined) this.m_sigfig = Number.parseInt(prop('sigfig')!, 10);

    if (prop('version') !== undefined) this.m_version = prop('version')!.charAt(0);

    if (prop('OEMRef') !== undefined) this.m_OEMRef = prop('OEMRef')!;

    if (prop('mpn') !== undefined) this.m_mpn = prop('mpn')!;

    if (prop('mfg') !== undefined) this.m_mfg = prop('mfg')!;

    if (prop('dist') !== undefined) this.m_dist = prop('dist')!;

    if (prop('distpn') !== undefined) this.m_distpn = prop('distpn')!;

    if (prop('bomrev') !== undefined) this.m_bomRev = prop('bomrev')!;

    if (this.m_version === 'B') {
      for (const c of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
        this.m_acceptable_chars.add(c);

      // Add special characters
      for (const c of '_\\-.+><') this.m_acceptable_chars.add(c);
    }

    this.m_xml_root = this.generateXmlHeader();

    this.generateContentSection();

    this.m_progressReporter?.SetNumPhases(7);
    this.m_progressReporter?.BeginPhase(1);
    this.m_progressReporter?.Report('Generating logistic section');

    this.generateLogisticSection();
    this.generateHistorySection();

    const ecad_node = this.generateEcadSection();
    const bom_node = this.generateBOMSection(ecad_node);
    const avl_node = this.generateAvlSection();

    // Insert BomRef/AvlRef into Content section per IPC-2581C 4.1.1.2.
    // They go after LayerRef and before Dictionary* nodes.
    const contentNode = this.m_contentNode as wxXmlNode | null;

    if (contentNode && (bom_node || avl_node)) {
      let insertBefore: wxXmlNode | null = null;

      for (let child = contentNode.GetChildren(); child; child = child.GetNext()) {
        if (child.GetName().startsWith('Dictionary')) {
          insertBefore = child;
          break;
        }
      }

      const insertRef = (aNodeName: string, aSection: wxXmlNode | null): void => {
        if (!aSection) return;

        const ref = newNode(aNodeName);
        ref.AddAttribute('name', aSection.GetAttribute('name') ?? '');

        if (insertBefore) contentNode.InsertChild(ref, insertBefore);
        else contentNode.AddChild(ref);
      };

      insertRef('BomRef', bom_node);
      insertRef('AvlRef', avl_node);
    }

    this.m_progressReporter?.AdvancePhase('Saving file');

    void this.generateLogicalNets;

    return wxXmlDocumentSave(this.m_xml_root);
  }

  override SaveBoard(
    aFileName: string,
    aBoard: BOARD,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    const text = this.FormatBoard(aBoard, aProperties);

    this.m_writeFile(aFileName, new TextEncoder().encode(text));
  }
}
