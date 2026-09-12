// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR_PARSER` (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp):
 * the `.kicad_pcb` / `.kicad_mod` reader, token to model with nothing kept
 * in between — no tree, no `source` nodes. Each `parseXxx` below is the C++
 * function of the same name, in the same order, with the same `Expecting`
 * messages, so a file KiCad rejects we reject, and one it reads we read into
 * the same values.
 *
 * Line references are to the 10.0.5 source.
 */
import { DSNLEXER, PARSE_ERROR, T, type Tok } from '@ziroeda/common/src/dsnlexer.js';
import { pcbIUScale, type FileDataType } from '@ziroeda/common/src/eda_units.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/src/string_utils.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import {
  B_Adhes,
  B_Cu,
  B_CrtYd,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_Adhes,
  F_Cu,
  F_CrtYd,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  In_Cu,
  LSET_Name,
  LSET_NameToLayer,
  Margin,
  PCB_LAYER_ID_COUNT,
  Rescue,
  UNDEFINED_LAYER,
  User_1,
} from '../../layer_ids.js';
import { LSET } from '../../lset.js';
import {
  type BoardDesignSettingsFile,
  type BoardStackup,
  type BoardVariant,
  type DRILL_MARKS,
  type DielectricPrms,
  defaultDielectricPrms,
  defaultDesignSettingsFile,
  defaultPageInfo,
  type EmbeddedFile,
  type EmbeddedFiles,
  type EmbeddedFileType,
  emptyEmbeddedFiles,
  emptyTitleBlock,
  GBR_DEFAULT_PRECISION,
  IsPrmSpecified,
  type LayerDescr,
  type LayerT,
  LAYER_T_NAMES,
  type PageInfo,
  PAGE_SIZE_TYPES,
  type PageSizeType,
  type PcbPlotParams,
  PLOT_FORMAT,
  STANDARD_PAGE_SIZES_MILS,
  type StackupItem,
  type StackupItemType,
  SVG_PRECISION_MAX,
  SVG_PRECISION_MIN,
  type TitleBlock,
  type ZoneLayerProperties,
  newStackupItem,
} from '../../board_file_model.js';
import type { TeardropParams } from '../../types.js';

/** `SEXPR_BOARD_FILE_VERSION` (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.h). */
export const SEXPR_BOARD_FILE_VERSION = 20260206;
/** `BOARD_FILE_HOST_VERSION`. */
const BOARD_FILE_HOST_VERSION = 20200825;

/** `INT_LIMIT` — the largest board unit that is visible on the screen. */
const INT_LIMIT = 2147483647 - 10;

/** `KiROUND`. */
const KiROUND = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** `MIN_PAGE_SIZE_MM` / `MAX_PAGE_SIZE_PCBNEW_MM` (include/page_info.h:39-40). */
export const MIN_PAGE_SIZE_MM = 25.4;
export const MAX_PAGE_SIZE_PCBNEW_MM = 48000 * 0.0254;

/**
 * `LEGACY_PCB_LAYER_ID` (pcb_plot_params.cpp): the layer numbering before
 * 5e0abadb, which `layerselection` hex values written before 20240819 use.
 */
const LEGACY_PCB_LAYER_ID_COUNT = 60;
function remapLegacyLayerLSET(legacy: LSET): LSET {
  const map: [number, number][] = [
    [0, F_Cu],
    [31, B_Cu],
    [32, B_Adhes],
    [33, F_Adhes],
    [34, B_Paste],
    [35, F_Paste],
    [36, B_SilkS],
    [37, F_SilkS],
    [38, B_Mask],
    [39, F_Mask],
    [40, Dwgs_User],
    [41, Cmts_User],
    [42, Eco1_User],
    [43, Eco2_User],
    [44, Edge_Cuts],
    [45, Margin],
    [46, B_CrtYd],
    [47, F_CrtYd],
    [48, B_Fab],
    [49, F_Fab],
    [59, Rescue],
  ];
  for (let i = 1; i <= 30; i++) map.push([i, In_Cu(i)]);
  for (let i = 1; i <= 9; i++) map.push([49 + i, User_1 + (i - 1) * 2]);
  const out = new LSET();
  for (const [from, to] of map) if (legacy.test(from)) out.set(to);
  return out;
}

/** The C++ `LAYER` the parser fills while reading `(layers …)`. */
interface LAYER {
  name: string;
  userName: string;
  type: LayerT;
  number: number;
  visible: boolean;
}

/** What the header parse produces; the items follow in the same object. */
export interface ParsedBoardHeader {
  fileFormatVersionAtLoad: number;
  generator: string;
  generatorVersion: string;
  pageInfo: PageInfo;
  titleBlock: TitleBlock;
  /** `BOARD::m_layers` for the enabled layers, keyed by `PCB_LAYER_ID`. */
  layerDescrs: Map<number, LayerDescr>;
  copperLayerCount: number;
  enabledLayers: LSET;
  /** `m_LegacyVisibleLayers`, only when a layer was explicitly hidden. */
  legacyVisibleLayers?: LSET;
  designSettings: BoardDesignSettingsFile;
  /** `BOARD::m_properties`, a `std::map`. */
  properties: Map<string, string>;
  variants: BoardVariant[];
  /** `(net N "name")` rows (pre-10.0 files); the netcode map for items. */
  netNames: Map<number, string>;
  embeddedFiles: EmbeddedFiles;
  legacyTeardrops: boolean;
  parseWarnings: string[];
}

export class PCB_IO_KICAD_SEXPR_PARSER extends DSNLEXER {
  private m_requiredVersion = 0;
  /** `m_board`: null while a footprint file is read; the net parsers skip the board then. */
  private m_hasBoard = true;
  private m_generatorVersion = '';
  private m_tooRecent = false;
  /** `m_layerIndices`: layer name (canonical or as the board renamed it) -> id. */
  private readonly m_layerIndices = new Map<string, number>();
  /** `m_layerMasks`: name or wildcard -> LSET. */
  private readonly m_layerMasks = new Map<string, LSET>();
  private readonly m_undefinedLayers = new Set<string>();
  /** `m_netCodes`: the file's net number -> the board's, for pre-10.0 files. */
  private readonly m_netCodes: number[] = [];
  readonly m_parseWarnings: string[] = [];

  /** The header being filled; `hdr()` guards the pre-`kicad_pcb` calls. */
  private m_hdr: ParsedBoardHeader | null = null;

  constructor(text: string, source = 'string') {
    super(text, source);
    this.init();
  }

  /** `init()` (:99). */
  private init(): void {
    this.m_tooRecent = false;
    this.m_requiredVersion = 0;
    this.m_layerIndices.clear();
    this.m_layerMasks.clear();

    // Add untranslated default (i.e. English) layernames.
    // Some may be overridden later if parsing a board rather than a footprint.
    // The English name will survive if parsing only a footprint.
    for (let layer = 0; layer < PCB_LAYER_ID_COUNT; ++layer) {
      const untranslated = LSET_Name(layer);
      this.m_layerIndices.set(untranslated, layer);
      this.m_layerMasks.set(untranslated, new LSET([layer]));
    }

    this.m_layerMasks.set('*.Cu', LSET.AllCuMask());
    this.m_layerMasks.set('*In.Cu', LSET.InternalCuMask());
    this.m_layerMasks.set('F&B.Cu', new LSET([F_Cu, B_Cu]));
    this.m_layerMasks.set('*.Adhes', new LSET([B_Adhes, F_Adhes]));
    this.m_layerMasks.set('*.Paste', new LSET([B_Paste, F_Paste]));
    this.m_layerMasks.set('*.Mask', new LSET([B_Mask, F_Mask]));
    this.m_layerMasks.set('*.SilkS', new LSET([B_SilkS, F_SilkS]));
    this.m_layerMasks.set('*.Fab', new LSET([B_Fab, F_Fab]));
    this.m_layerMasks.set('*.CrtYd', new LSET([B_CrtYd, F_CrtYd]));

    // This is for the first pretty & *.kicad_pcb formats, which had
    // Inner1_Cu - Inner14_Cu with the numbering sequence
    // reversed from the subsequent format's In1_Cu - In30_Cu numbering scheme.
    // The newer format brought in an additional 16 Cu layers and flipped the cu stack but
    // kept the gap between one of the outside layers and the last cu internal.
    for (let i = 1; i <= 14; ++i) {
      this.m_layerMasks.set(`Inner${i}.Cu`, new LSET([In_Cu(15) - 2 * i]));
    }
  }

  get requiredVersion(): number {
    return this.m_requiredVersion;
  }

  private hdr(): ParsedBoardHeader {
    if (!this.m_hdr) throw new Error('parser: no board');
    return this.m_hdr;
  }

  throwParse(message: string): never {
    throw new PARSE_ERROR(
      message,
      this.CurSource(),
      this.CurLine(),
      this.CurLineNumber(),
      this.CurOffset(),
    );
  }

  /** `skipCurrent()` (:167): skip to the end of the current list. */
  skipCurrent(): void {
    let currLevel = 0;
    let token: Tok;
    for (token = this.NextTok(); token !== T.EOF; token = this.NextTok()) {
      if (token === T.LEFT) currLevel--;
      if (token === T.RIGHT) {
        currLevel++;
        if (currLevel > 0) return;
      }
    }
  }

  /** `parseInt( aExpected )`: the next token as an integer. */
  parseInt(expected: string): number {
    const tok = this.NextTok();
    if (!DSNLEXER.IsNumber(tok)) this.throwError(`need a number for '${expected}'`);
    return Number.parseInt(this.CurText(), 10);
  }

  /** `parseDouble( aExpected )`: the next token as a double. */
  parseDoubleNext(expected: string): number {
    this.NeedNUMBER(expected);
    return this.parseDouble();
  }

  /** `parseHex()`. */
  parseHex(): number {
    this.NextTok();
    return Number.parseInt(this.CurText(), 16);
  }

  /**
   * `parseBoardUnits( aExpected, aDataType )` (:217): mm in the file to IU,
   * `KiROUND`ed and clamped to what is visible on the screen.
   */
  parseBoardUnits(expected: string, dataType: FileDataType = 'distance'): number {
    const scale =
      dataType === 'time'
        ? pcbIUScale.IU_PER_PS
        : dataType === 'length_delay'
          ? pcbIUScale.IU_PER_PS_PER_MM
          : dataType === 'unitless'
            ? 1.0
            : pcbIUScale.IU_PER_MM;
    const retval = this.parseDoubleNext(expected) * scale;
    return KiROUND(Math.min(Math.max(retval, -INT_LIMIT), INT_LIMIT));
  }

  /**
   * `parseBoardUnits()` (:200), the overload that reads the CURRENT token:
   * `parseDouble() * IU_PER_MM`, rounded and clamped.
   */
  parseBoardUnitsCur(): number {
    const retval = this.parseDouble() * pcbIUScale.IU_PER_MM;
    return KiROUND(Math.min(Math.max(retval, -INT_LIMIT), INT_LIMIT));
  }

  /** `parseBool()` (:230). */
  parseBool(): boolean {
    const token = this.NextTok();
    if (token === 'yes') return true;
    if (token === 'no') return false;
    this.Expecting('yes or no');
  }

  /** `parseOptBool()` (:245). */
  parseOptBool(): boolean | undefined {
    const token = this.NextTok();
    if (token === 'yes') return true;
    if (token === 'no') return false;
    if (token === 'none') return undefined;
    this.Expecting('yes, no or none');
  }

  /** `parseMaybeAbsentBool( aDefaultValue )` (:265): e.g. "hide", "hide)", "(hide yes)". */
  parseMaybeAbsentBool(defaultValue: boolean): boolean {
    let ret = defaultValue;
    if (this.PrevTok() === T.LEFT) {
      const token = this.NextTok();
      // "hide)"
      if (token === T.RIGHT) return defaultValue;
      if (token === 'yes' || token === 'true') ret = true;
      else if (token === 'no' || token === 'false') ret = false;
      else this.Expecting('yes or no');
      this.NeedRIGHT();
    } else {
      // "hide"
      return defaultValue;
    }
    return ret;
  }

  // -------------------------------------------------------------------------
  // NETINFO_LIST (pcbnew/netinfo_list.cpp): the board's nets, code 0 the
  // unconnected net, new nets numbered by first appearance.
  // -------------------------------------------------------------------------

  /** `m_netNames` of the list: name -> code. */
  private readonly m_netNamesToCode = new Map<string, number>([['', 0]]);
  private m_newNetCode = 0;

  /** `NETINFO_LIST::getFreeNetCode()`. */
  private getFreeNetCode(): number {
    do {
      if (this.m_newNetCode < 0) this.m_newNetCode = 0;
    } while (this.hdr().netNames.has(++this.m_newNetCode));
    return this.m_newNetCode;
  }

  /**
   * `BOARD::Add( new NETINFO_ITEM( board, name, code ) )` → `AppendNet`
   * (netinfo_list.cpp:149): a net with that name keeps its code; a code that
   * is not the next consecutive one (or -1) is auto-assigned. Returns the code.
   */
  addNet(name: string, code = -1): number {
    const netNames = this.hdr().netNames;
    const sameName = this.m_netNamesToCode.get(name);
    if (sameName !== undefined) return sameName;
    if (code !== netNames.size || code < 0) code = this.getFreeNetCode();
    netNames.set(code, name);
    this.m_netNamesToCode.set(name, code);
    return code;
  }

  /** `BOARD::FindNet( aNetname )`: the code, or undefined. */
  findNet(name: string): number | undefined {
    return this.m_netNamesToCode.get(name);
  }

  /** `BOARD::GetNetCount()`. */
  getNetCount(): number {
    return this.hdr().netNames.size;
  }

  /**
   * `BOARD_CONNECTED_ITEM::SetNetCode( code, aNoAssert )`: the net with that
   * code, or — when the board has none — no net at all (`GetNetCode()` -1,
   * `GetNetname()` empty). Returns null when the code is unknown.
   */
  netByCode(code: number): { name: string; code: number } | null {
    if (code < 0) return null;
    const name = this.hdr().netNames.get(code);
    return name === undefined ? null : { name, code };
  }

  /**
   * `parseNet( aItem )` (:296): the item's net, as a legacy netcode or a name.
   * Null is `m_netinfo` left on `NETINFO_LIST::OrphanedItem()`: a net read
   * with no board (`if( m_board )`, :321) — a footprint file.
   */
  parseNet(): { name: string; code: number } | null {
    const token = this.NextTok();
    // Legacy files (pre-10.0) will have a netcode instead of a netname.  This netcode
    // is authoratative (though may be mapped by getNetCode() to prevent collisions).
    if (DSNLEXER.IsNumber(token)) {
      const code = Math.max(0, this.getNetCode(Number.parseInt(this.CurText(), 10)));
      this.NeedRIGHT();
      // `FindNet( code )` missing leaves `m_netinfo` null: `GetNetCode()` -1.
      return this.m_hasBoard ? (this.netByCode(code) ?? { name: '', code: -1 }) : null;
    }
    if (!DSNLEXER.IsSymbol(token)) this.Expecting('net name');
    if (!this.m_hasBoard) {
      this.NeedRIGHT();
      return null;
    }
    let netName = this.CurText();
    // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the
    // first merge so the version is a bit later.
    if (this.m_requiredVersion < 20210606) netName = convertToNewOverbarNotation(netName);
    const code = this.addNet(netName);
    this.NeedRIGHT();
    return { name: netName, code };
  }

  /** `getNetCode( aNetCode )`: through the file's net number map, or as-is. */
  getNetCode(netCode: number): number {
    if (netCode >= 0 && netCode < this.m_netCodes.length) return this.m_netCodes[netCode]!;
    return netCode;
  }

  /** `pushValueIntoMap( aIndex, aValue )` (:188). */
  pushValueIntoMap(index: number, value: number): void {
    while (this.m_netCodes.length <= index) this.m_netCodes.push(0);
    this.m_netCodes[index] = value;
  }

  /** `parseXY()` (:369). */
  parseXY(): Vec2 {
    if (this.CurTok() !== T.LEFT) this.NeedLEFT();
    const token = this.NextTok();
    if (token !== 'xy') this.Expecting('xy');
    const x = this.parseBoardUnits('X coordinate');
    const y = this.parseBoardUnits('Y coordinate');
    this.NeedRIGHT();
    return { x, y };
  }

  /**
   * `parseOutlinePoints( aPoly )` (:389): one `(xy …)` or `(arc …)` of a
   * point list. An arc is returned as its three points; the caller keeps
   * whichever shape it needs.
   */
  parseOutlinePoints(): { xy: Vec2 } | { arc: { start: Vec2; mid: Vec2; end: Vec2 } } {
    if (this.CurTok() !== T.LEFT) this.NeedLEFT();
    let token = this.NextTok();
    switch (token) {
      case 'xy': {
        const x = this.parseBoardUnits('X coordinate');
        const y = this.parseBoardUnits('Y coordinate');
        this.NeedRIGHT();
        return { xy: { x, y } };
      }
      case 'arc': {
        let hasStart = false;
        let hasMid = false;
        let hasEnd = false;
        const start = { x: 0, y: 0 };
        const mid = { x: 0, y: 0 };
        const end = { x: 0, y: 0 };
        for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
          if (token !== T.LEFT) this.Expecting(T.LEFT);
          token = this.NextTok();
          switch (token) {
            case 'start':
              start.x = this.parseBoardUnits('start x');
              start.y = this.parseBoardUnits('start y');
              hasStart = true;
              break;
            case 'mid':
              mid.x = this.parseBoardUnits('mid x');
              mid.y = this.parseBoardUnits('mid y');
              hasMid = true;
              break;
            case 'end':
              end.x = this.parseBoardUnits('end x');
              end.y = this.parseBoardUnits('end y');
              hasEnd = true;
              break;
            default:
              this.Expecting('start, mid or end');
          }
          this.NeedRIGHT();
        }
        if (!hasStart) this.Expecting('start');
        if (!hasMid) this.Expecting('mid');
        if (!hasEnd) this.Expecting('end');
        return { arc: { start, mid, end } };
      }
      default:
        this.Expecting('xy or arc');
    }
  }

  /** `parseMargins()` (:486). */
  parseMargins(): { left: number; top: number; right: number; bottom: number } {
    const left = this.parseBoardUnits('left margin');
    const top = this.parseBoardUnits('top margin');
    const right = this.parseBoardUnits('right margin');
    const bottom = this.parseBoardUnits('bottom margin');
    return { left, top, right, bottom };
  }

  /** `parseBoardProperty()` (:495). */
  private parseBoardProperty(): [string, string] {
    this.NeedSYMBOL();
    const name = this.CurText();
    this.NeedSYMBOL();
    const value = this.CurText();
    this.NeedRIGHT();
    return [name, value];
  }

  /** `parseVariants()` (:510). */
  private parseVariants(): void {
    // (variants
    //   (variant (name "VariantA") (description "Description A"))
    //   (variant (name "VariantB") (description "Description B"))
    // )
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();
      if (token === 'variant') {
        let variantName = '';
        let description = '';
        for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
          if (token === T.LEFT) token = this.NextTok();
          switch (token) {
            case 'name':
              this.NeedSYMBOL();
              variantName = this.CurText();
              this.NeedRIGHT();
              break;
            case 'description':
              this.NeedSYMBOL();
              description = this.CurText();
              this.NeedRIGHT();
              break;
            default:
              this.Expecting('name or description');
          }
        }
        if (variantName !== '') {
          const hdr = this.hdr();
          // `BOARD::AddVariant` ignores a duplicate name.
          let v = hdr.variants.find((x) => x.name === variantName);
          if (!v) {
            v = { name: variantName, description: '' };
            hdr.variants.push(v);
          }
          if (description !== '') v.description = description;
        }
      } else {
        this.Expecting('variant');
      }
    }
  }

  /** `parseTEARDROP_PARAMETERS( tdParams )` (:668). */
  parseTEARDROP_PARAMETERS(tdParams: TeardropParams): void {
    tdParams.enabled = false;
    tdParams.allowUseTwoTracks = false;
    tdParams.tdOnPadsInZones = true;

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();
      switch (token) {
        case 'enabled':
          tdParams.enabled = this.parseMaybeAbsentBool(true);
          break;
        case 'allow_two_segments':
          tdParams.allowUseTwoTracks = this.parseMaybeAbsentBool(true);
          break;
        case 'prefer_zone_connections':
          tdParams.tdOnPadsInZones = !this.parseMaybeAbsentBool(false);
          break;
        case 'best_length_ratio':
          tdParams.bestLengthRatio = this.parseDoubleNext('teardrop best length ratio');
          this.NeedRIGHT();
          break;
        case 'max_length':
          tdParams.tdMaxLen = this.parseBoardUnits('teardrop max length');
          this.NeedRIGHT();
          break;
        case 'best_width_ratio':
          tdParams.bestWidthRatio = this.parseDoubleNext('teardrop best width ratio');
          this.NeedRIGHT();
          break;
        case 'max_width':
          tdParams.tdMaxWidth = this.parseBoardUnits('teardrop max width');
          this.NeedRIGHT();
          break;
        // Legacy token
        case 'curve_points':
          tdParams.curvedEdges = this.parseInt('teardrop curve points count') > 0;
          this.NeedRIGHT();
          break;
        case 'curved_edges':
          tdParams.curvedEdges = this.parseMaybeAbsentBool(true);
          break;
        case 'filter_ratio':
          tdParams.widthtoSizeFilterRatio = this.parseDoubleNext('teardrop filter ratio');
          this.NeedRIGHT();
          break;
        default:
          this.Expecting(
            'enabled, allow_two_segments, prefer_zone_connections, best_length_ratio, ' +
              'max_length, best_width_ratio, max_width, curve_points or filter_ratio',
          );
      }
    }
  }

  // -------------------------------------------------------------------------
  // The board
  // -------------------------------------------------------------------------

  /** `IsValidBoardHeader()` (:1023). */
  IsValidBoardHeader(): boolean {
    this.ReadCommentLines();
    if (this.CurTok() !== T.LEFT) return false;
    if (this.NextTok() !== 'kicad_pcb') return false;
    return true;
  }

  /** `ReadCommentLines()` (dsnlexer.cpp): the leading `#` lines, if any. */
  ReadCommentLines(): string[] | null {
    let ret: string[] | null = null;
    const setting = this.SetCommentsAreTokens(true);
    let tok = this.NextTok();
    if (tok === T.COMMENT) {
      ret = [];
      do {
        ret.push(this.CurText());
        tok = this.NextTok();
      } while (tok === T.COMMENT);
    }
    this.SetCommentsAreTokens(setting);
    return ret;
  }

  /**
   * `Parse()` (:1041) for a board: reads the header sections into the model
   * and hands every item token to `onItem`, which is the item parser (part 2)
   * or a skip while only the header is under test.
   */
  ParseBoardHeader(onItem: (token: string) => void): ParsedBoardHeader {
    this.ReadCommentLines();
    let token = this.CurTok();
    if (token === T.EOF) this.Unexpected(token);
    if (token !== T.LEFT) this.Expecting(T.LEFT);
    token = this.NextTok();
    if (token !== 'kicad_pcb') this.throwParse(`Unknown token '${this.CurText()}'`);

    this.m_hdr = this.freshHeader();
    this.parseBOARD_unchecked(onItem);
    return this.m_hdr;
  }

  /**
   * `Parse()` (:1041) for a `.kicad_mod` / a `(footprint …)` on its own: the
   * leading comment lines, the `(` and the `footprint` / `module` token, with
   * an empty board header behind it (a library footprint has no board, so
   * its nets and layers are the defaults). The caller then runs the
   * footprint parser; the comments are returned for `Format()`.
   */
  BeginFootprintFile(): string[] | null {
    const initialComments = this.ReadCommentLines();
    let token = this.CurTok();
    if (token === T.EOF) this.Unexpected(token);
    if (token !== T.LEFT) this.Expecting(T.LEFT);
    token = this.NextTok();
    if (token !== 'footprint' && token !== 'module')
      this.throwParse(`Unknown token '${this.CurText()}'`);
    this.m_hdr = this.freshHeader();
    this.m_hasBoard = false;
    // `init()` left m_requiredVersion at 0: a footprint file's own
    // `(version …)` raises it from inside the footprint, and one without is
    // read as the oldest format.
    return initialComments;
  }

  /** `BOARD()` as the parser starts from: two copper layers, the defaults, no items. */
  private freshHeader(): ParsedBoardHeader {
    return {
      fileFormatVersionAtLoad: 0,
      generator: '',
      generatorVersion: '',
      pageInfo: defaultPageInfo(),
      titleBlock: emptyTitleBlock(),
      layerDescrs: new Map(),
      copperLayerCount: 2,
      enabledLayers: LSET.AllCuMask(2).or(LSET.AllTechMask()).or(LSET.UserMask()),
      designSettings: defaultDesignSettingsFile(),
      properties: new Map(),
      variants: [],
      // Make sure that the unconnected net has number 0
      netNames: new Map([[0, '']]),
      embeddedFiles: emptyEmbeddedFiles(),
      legacyTeardrops: false,
      parseWarnings: this.m_parseWarnings,
    };
  }

  /** `m_board->GetCopperLayerCount()` while the items are being read. */
  hdrCopperLayerCount(): number {
    return this.hdr().copperLayerCount;
  }

  /** `m_undefinedLayers`: the layer names items referred to that the board lacks. */
  undefinedLayerNames(): string[] {
    return [...this.m_undefinedLayers];
  }

  /** `parseBOARD_unchecked()` (:1116), the header half; items go to `onItem`. */
  private parseBOARD_unchecked(onItem: (token: string) => void): void {
    const hdr = this.hdr();
    this.parseHeader();

    const checkVersion = (): void => {
      if (this.m_requiredVersion > SEXPR_BOARD_FILE_VERSION) {
        throw new PARSE_ERROR(
          `FUTURE_FORMAT_ERROR: ${this.m_requiredVersion} (${this.m_generatorVersion})`,
          this.CurSource(),
          this.CurLine(),
          this.CurLineNumber(),
          this.CurOffset(),
        );
      }
    };

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();

      if (token === 'page' && this.m_requiredVersion <= 20200119) token = 'paper';

      switch (token) {
        case 'host': // legacy token
          this.NeedSYMBOL();
          hdr.generator = this.CurText();
          // Older formats included build data
          if (this.m_requiredVersion < BOARD_FILE_HOST_VERSION) this.NeedSYMBOL();
          this.NeedRIGHT();
          break;

        case 'generator':
          this.NeedSYMBOL();
          hdr.generator = this.CurText();
          this.NeedRIGHT();
          break;

        case 'generator_version': {
          this.NeedSYMBOL();
          this.m_generatorVersion = this.CurText();
          hdr.generatorVersion = this.m_generatorVersion;
          this.NeedRIGHT();
          // If the format includes a generator version, by this point we have enough info to
          // do the version check here
          checkVersion();
          break;
        }

        case 'general':
          // Do another version check here, for older files that do not include generator_version
          checkVersion();
          this.parseGeneralSection();
          break;

        case 'paper':
          this.parsePAGE_INFO();
          break;

        case 'title_block':
          this.parseTITLE_BLOCK();
          break;

        case 'layers':
          this.parseLayers();
          break;

        case 'setup':
          this.parseSetup();
          break;

        case 'property': {
          const [k, v] = this.parseBoardProperty();
          // `std::map::insert` keeps the first value for a repeated key.
          if (!hdr.properties.has(k)) hdr.properties.set(k, v);
          break;
        }

        case 'variants':
          this.parseVariants();
          break;

        case 'net':
          this.parseNETINFO_ITEM();
          break;

        case 'net_class':
          this.parseNETCLASS();
          break;

        case 'embedded_fonts': {
          hdr.embeddedFiles.areFontsEmbedded = this.parseBool();
          this.NeedRIGHT();
          break;
        }

        case 'embedded_files': {
          try {
            this.ParseEmbedded(hdr.embeddedFiles);
          } catch (e) {
            if (e instanceof PARSE_ERROR) this.m_parseWarnings.push(e.message);
            else throw e;
          }
          break;
        }

        default:
          if (typeof token !== 'string') this.throwParse(`Unknown token '${this.CurText()}'`);
          onItem(token);
      }
    }

    // `std::map<wxString, wxString>` iterates in key order.
    hdr.properties = new Map(
      [...hdr.properties.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  /** `parseHeader()` (:1663). */
  private parseHeader(): void {
    if (this.CurTok() !== 'kicad_pcb') this.throwParse('Cannot parse as a header.');
    this.NeedLEFT();
    const tok = this.NextTok();
    if (tok === 'version') {
      this.m_requiredVersion = this.parseInt('version');
      this.NeedRIGHT();
    } else {
      this.m_requiredVersion = 20201115; // Last version before we started writing version #s
      // in footprint files as well as board files.
    }
    this.m_tooRecent = this.m_requiredVersion > SEXPR_BOARD_FILE_VERSION;
    // Prior to this, bar was a valid string char for unquoted strings.
    this.SetKnowsBar(this.m_requiredVersion >= 20240706);
    this.hdr().fileFormatVersionAtLoad = this.m_requiredVersion;
  }

  /** `parseGeneralSection()` (:1692). */
  private parseGeneralSection(): void {
    const hdr = this.hdr();
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      switch (token) {
        case 'thickness':
          hdr.designSettings.boardThickness = this.parseBoardUnits('thickness');
          this.NeedRIGHT();
          break;
        case 'legacy_teardrops':
          hdr.legacyTeardrops = this.parseMaybeAbsentBool(true);
          break;
        default: // Skip everything else.
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) this.Expecting('symbol or number');
          }
      }
    }
  }

  /** `parsePAGE_INFO()` (:1728). */
  private parsePAGE_INFO(): void {
    this.NeedSYMBOL();
    const pageType = this.CurText();
    // `PAGE_INFO::SetType( wxString )`: `magic_enum::enum_cast`, case-insensitive.
    const type = PAGE_SIZE_TYPES.find((t) => t.toLowerCase() === pageType.toLowerCase());
    if (!type) this.throwParse(`Page type '${pageType}' is not valid.`);
    const [w, h] = STANDARD_PAGE_SIZES_MILS[type as PageSizeType];
    const pageInfo: PageInfo = {
      type: type as PageSizeType,
      widthMils: w,
      heightMils: h,
      portrait: false,
    };

    if (pageInfo.type === 'User') {
      let width = this.parseDoubleNext('width'); // width in mm
      // Perform some controls to avoid crashes if the size is edited by hands
      if (width < MIN_PAGE_SIZE_MM) width = MIN_PAGE_SIZE_MM;
      else if (width > MAX_PAGE_SIZE_PCBNEW_MM) width = MAX_PAGE_SIZE_PCBNEW_MM;
      let height = this.parseDoubleNext('height'); // height in mm
      if (height < MIN_PAGE_SIZE_MM) height = MIN_PAGE_SIZE_MM;
      else if (height > MAX_PAGE_SIZE_PCBNEW_MM) height = MAX_PAGE_SIZE_PCBNEW_MM;
      // `SetWidthMM` / `SetHeightMM`: mils as a double.
      pageInfo.widthMils = (width * 1000.0) / 25.4;
      pageInfo.heightMils = (height * 1000.0) / 25.4;
      pageInfo.portrait = pageInfo.heightMils > pageInfo.widthMils;
    }

    const token = this.NextTok();
    if (token === 'portrait') {
      // `SetPortrait( true )`: swap x and y for a landscape standard size.
      if (!pageInfo.portrait) {
        const t = pageInfo.widthMils;
        pageInfo.widthMils = pageInfo.heightMils;
        pageInfo.heightMils = t;
        pageInfo.portrait = pageInfo.heightMils > pageInfo.widthMils;
      }
      this.NeedRIGHT();
    } else if (token !== T.RIGHT) {
      this.Expecting('portrait|)');
    }
    this.hdr().pageInfo = pageInfo;
  }

  /** `parseTITLE_BLOCK()` (:1784). */
  private parseTITLE_BLOCK(): void {
    const titleBlock = emptyTitleBlock();
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      switch (token) {
        case 'title':
          this.NextTok();
          titleBlock.title = this.CurText();
          break;
        case 'date':
          this.NextTok();
          titleBlock.date = this.CurText();
          break;
        case 'rev':
          this.NextTok();
          titleBlock.revision = this.CurText();
          break;
        case 'company':
          this.NextTok();
          titleBlock.company = this.CurText();
          break;
        case 'comment': {
          const commentNumber = this.parseInt('comment');
          if (commentNumber < 1 || commentNumber > 9)
            this.throwParse(`${commentNumber} is not a valid title block comment number`);
          this.NextTok();
          titleBlock.comments[commentNumber - 1] = this.CurText();
          break;
        }
        default:
          this.Expecting('title, date, rev, company, or comment');
      }
      this.NeedRIGHT();
    }
    this.hdr().titleBlock = titleBlock;
  }

  /** `parseLayer( aLayer )` (:1892). */
  private parseLayer(layer: LAYER): void {
    let userName = '';
    let isVisible = true;

    if (this.CurTok() !== T.LEFT) this.Expecting(T.LEFT);

    // this layer_num is not used, we DO depend on LAYER_T however.
    const layerNum = this.parseInt('layer index');

    this.NeedSYMBOLorNUMBER();
    const name = this.CurText();

    this.NeedSYMBOL();
    const type = this.CurText();

    const token = this.NextTok();
    // @todo Figure out why we are looking for a hide token in the layer definition.
    if (token === 'hide') {
      isVisible = false;
      this.NeedRIGHT();
    } else if (token === T.STRING) {
      userName = this.CurText();
      this.NeedRIGHT();
    } else if (token !== T.RIGHT) {
      this.Expecting('hide, user defined name, or )');
    }

    // `LAYER::ParseType`: an unknown word is LT_UNDEFINED.
    layer.type = (LAYER_T_NAMES as readonly string[]).includes(type)
      ? (type as LayerT)
      : 'undefined';
    layer.number = layerNum;
    layer.visible = isVisible;

    if (this.m_requiredVersion >= 20200922) {
      layer.userName = userName;
      layer.name = name;
    } else {
      // Older versions didn't have a dedicated user name field
      layer.name = layer.userName = name;
    }
  }

  /** `parseBoardStackup()` (:1949). */
  private parseBoardStackup(): void {
    const hdr = this.hdr();
    let name: string;
    let dielectricIdx = 1; // the index of dielectric layers
    const stackup: BoardStackup = hdr.designSettings.stackup;

    // Remove existing stack or we end up just appending to the existing stackup
    stackup.list = [];

    // Board appends in older versions could duplicate the whole stackup.  Stop adding items once
    // a board layer id repeats; still parse the duplicates to keep the token stream consistent.
    const seenBrdLayers = new Set<number>();
    let duplicatedStackup = false;

    let token: Tok;
    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (this.CurTok() !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();

      if (token !== 'layer') {
        switch (token) {
          case 'copper_finish':
            this.NeedSYMBOL();
            stackup.finishType = this.CurText();
            this.NeedRIGHT();
            break;
          case 'edge_plating':
            token = this.NextTok();
            stackup.edgePlating = token === 'yes';
            this.NeedRIGHT();
            break;
          case 'dielectric_constraints':
            token = this.NextTok();
            stackup.hasDielectricConstraints = token === 'yes';
            this.NeedRIGHT();
            break;
          case 'edge_connector':
            token = this.NextTok();
            stackup.edgeConnectorConstraints = 0;
            if (token === 'yes') stackup.edgeConnectorConstraints = 1;
            else if (token === 'bevelled') stackup.edgeConnectorConstraints = 2;
            this.NeedRIGHT();
            break;
          case 'castellated_pads': // Legacy compatibility. just skip it
            token = this.NextTok();
            this.NeedRIGHT();
            break;
          default:
            // Currently, skip this item if not defined, because the stackup def
            // is a moving target
            this.skipCurrent();
            break;
        }
        continue;
      }

      this.NeedSYMBOL();
      name = this.CurText();

      // Match the canonical names that we write, not GetLayerID() because the user-name matching
      // could end up being the same as a canonical name and corrupt the stack.
      let layerId = UNDEFINED_LAYER;
      for (const candidate of hdr.enabledLayers.Seq()) {
        if (LSET_Name(candidate) === name) {
          layerId = candidate;
          break;
        }
      }

      // Init the type
      let type: StackupItemType | undefined;
      if (layerId === F_SilkS || layerId === B_SilkS) type = 'silkscreen';
      else if (layerId === F_Mask || layerId === B_Mask) type = 'soldermask';
      else if (layerId === F_Paste || layerId === B_Paste) type = 'solderpaste';
      else if (layerId === UNDEFINED_LAYER) type = 'dielectric';
      else if (!(layerId & 1)) type = 'copper';

      let item: StackupItem | null = null;
      if (layerId !== UNDEFINED_LAYER) {
        if (seenBrdLayers.has(layerId)) duplicatedStackup = true;
        else seenBrdLayers.add(layerId);
      }

      if (type !== undefined) {
        // A 32-copper-layer board has at most 69 stackup items (32 copper +
        // 31 dielectric + 6 mask/paste/silk).  Anything far beyond that
        // indicates a corrupted file.  Parse the item so tokens are consumed
        // correctly, but don't keep it.
        const MAX_STACKUP_ITEMS = 128;
        item = newStackupItem(type);
        item.brdLayerId = layerId;
        if (type === 'dielectric') item.dielectricLayerId = dielectricIdx++;
        if (!duplicatedStackup && stackup.list.length < MAX_STACKUP_ITEMS) stackup.list.push(item);
      } else {
        this.Expecting('layer_name');
      }

      let hasNextSublayer = true;
      let sublayerIdx = 0; // the index of dielectric sub layers
      // sublayer 0 is always existing (main sublayer)

      while (hasNextSublayer) {
        hasNextSublayer = false;
        for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
          if (token === 'addsublayer') {
            hasNextSublayer = true;
            break;
          }
          if (token === T.LEFT) {
            token = this.NextTok();
            const prms: DielectricPrms = item!.sublayers[sublayerIdx]!;
            switch (token) {
              case 'type':
                this.NeedSYMBOL();
                item!.typeName = this.CurText();
                this.NeedRIGHT();
                break;
              case 'thickness':
                prms.thickness = this.parseBoardUnits('thickness');
                token = this.NextTok();
                if (token === T.LEFT) break;
                if (token === 'locked') {
                  // Dielectric thickness can be locked (for impedance controlled layers)
                  if (type === 'dielectric') prms.thicknessLocked = true;
                  this.NeedRIGHT();
                }
                break;
              case 'material':
                this.NeedSYMBOL();
                prms.material = this.CurText();
                this.NeedRIGHT();
                break;
              case 'epsilon_r':
                this.NextTok();
                prms.epsilonR = this.parseDouble();
                this.NeedRIGHT();
                break;
              case 'loss_tangent':
                this.NextTok();
                prms.lossTangent = this.parseDouble();
                this.NeedRIGHT();
                break;
              case 'color': {
                this.NeedSYMBOL();
                name = this.CurText();
                // Older versions didn't store opacity with custom colors
                if (name.startsWith('#') && this.m_requiredVersion < 20210824) {
                  name = legacyStackupColorWithAlpha(name, item!.type === 'soldermask');
                }
                prms.color = name;
                this.NeedRIGHT();
                break;
              }
              default:
                // Currently, skip this item if not defined, because the stackup def
                // is a moving target
                this.skipCurrent();
            }
          }
        }
        if (hasNextSublayer) {
          // Prepare reading the next sublayer description
          sublayerIdx++;
          // `AddDielectricPrms( sublayer_idx )`: a default entry inserted at the index.
          item!.sublayers.splice(sublayerIdx, 0, defaultDielectricPrms());
        }
      }
    }

    if (token !== T.RIGHT) this.Expecting(')');

    // Success:
    hdr.designSettings.hasStackup = true;
  }

  /** `parseLayers()` (:2258). */
  private parseLayers(): void {
    const hdr = this.hdr();
    const visibleLayers = new LSET();
    const enabledLayers = new LSET();
    let copperLayerCount = 0;
    const layer: LAYER = { name: '', userName: '', type: 'undefined', number: 0, visible: true };
    let anyHidden = false;

    const v3LayerNames = createOldLayerMapping();
    const cu: LAYER[] = [];

    let token: Tok;
    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      this.parseLayer(layer);
      if (layer.type === 'undefined') break; // it's a non-copper layer
      cu.push({ ...layer }); // it's copper
    }

    // All Cu layers are parsed, but not the non-cu layers here.

    // The original *.kicad_pcb file format and the inverted
    // Cu stack format both have all the Cu layers first, so use this
    // trick to handle either. The layer number in the (layers ..)
    // s-expression element are ignored.
    if (cu.length) {
      // Rework the layer numbers, which changed when the Cu stack
      // was flipped.  So we instead use position in the list.
      for (let i = 1; i < cu.length - 1; i++) {
        let tmpLayer = LSET_NameToLayer(cu[i]!.name);
        if (tmpLayer < 0) tmpLayer = (i + 1) * 2;
        cu[i]!.number = tmpLayer;
      }
      cu[0]!.number = F_Cu;
      cu[cu.length - 1]!.number = B_Cu;

      for (const cuLayer of cu) {
        enabledLayers.set(cuLayer.number);
        if (cuLayer.visible) visibleLayers.set(cuLayer.number);
        else anyHidden = true;
        hdr.layerDescrs.set(cuLayer.number, {
          number: cuLayer.number,
          name: cuLayer.name,
          userName: cuLayer.userName,
          type: cuLayer.type,
          visible: cuLayer.visible,
        });
        this.m_layerIndices.set(cuLayer.name, cuLayer.number);
        this.m_layerMasks.set(cuLayer.name, new LSET([cuLayer.number]));
      }
      copperLayerCount = cu.length;
    }

    // process non-copper layers
    while (token !== T.RIGHT) {
      let id = this.m_layerIndices.get(layer.name);
      if (id === undefined) {
        const translated = v3LayerNames.get(layer.name);
        if (translated !== undefined) id = this.m_layerIndices.get(translated);
        if (id === undefined) {
          throw new Error(
            `Layer '${layer.name}' in file '${this.CurSource()}' at line ${this.CurLineNumber()} is not in fixed layer hash.`,
          );
        }
        // If we are here, then we have found a translated layer name.  Put it in the maps
        // so that items on this layer get the appropriate layer ID number.
        this.m_layerIndices.set(layer.name, id);
        this.m_layerMasks.set(layer.name, new LSET([id]));
        layer.name = translated!;
      }

      layer.number = id;
      enabledLayers.set(layer.number);
      if (layer.visible) visibleLayers.set(layer.number);
      else anyHidden = true;
      hdr.layerDescrs.set(id, {
        number: id,
        name: layer.name,
        userName: layer.userName,
        type: layer.type,
        visible: layer.visible,
      });

      token = this.NextTok();
      if (token !== T.LEFT) break;
      this.parseLayer(layer);
    }

    // We need at least 2 copper layers and there must be an even number of them.
    if (copperLayerCount < 2 || copperLayerCount % 2 !== 0)
      this.throwParse(`${copperLayerCount} is not a valid layer count`);

    hdr.copperLayerCount = copperLayerCount;
    hdr.enabledLayers = enabledLayers;
    // Only set this if any layers were explicitly marked as hidden.  Otherwise, we want to leave
    // this alone; default visibility will show everything
    if (anyHidden) hdr.legacyVisibleLayers = visibleLayers;
  }

  /** `lookUpLayerSet( aMap )` (:2407). */
  private lookUpLayerSet(): LSET {
    const hit = this.m_layerMasks.get(this.CurText());
    if (!hit) return new LSET([Rescue]);
    return hit.clone();
  }

  /** `lookUpLayer( aMap )` (:2418). */
  private lookUpLayer(): number {
    const hit = this.m_layerIndices.get(this.CurText());
    if (hit === undefined) {
      this.m_undefinedLayers.add(this.CurText());
      return Rescue;
    }
    // Some files may have saved items to the Rescue Layer due to an issue in v5
    if (hit === Rescue) this.m_undefinedLayers.add(this.CurText());
    return hit;
  }

  /** `m_layerIndices.find( name )`. */
  layerIndexOf(name: string): number | undefined {
    return this.m_layerIndices.get(name);
  }

  /** A nested footprint's `(version N)`: `max( m_requiredVersion, N )` and the bar rule. */
  raiseRequiredVersion(thisVersion: number): void {
    this.m_requiredVersion = Math.max(this.m_requiredVersion, thisVersion);
    this.m_tooRecent = this.m_requiredVersion > SEXPR_BOARD_FILE_VERSION;
    this.SetKnowsBar(this.m_requiredVersion >= 20240706); // Bar token is known from this version
  }

  /** `EMBEDDED_FILES_PARSER::ParseEmbedded` for a footprint's own files. */
  ParseEmbeddedInto(files: EmbeddedFiles): void {
    this.ParseEmbedded(files);
  }

  /** `lookUpLayer( m_layerIndices )` on the CURRENT token. */
  lookUpLayerCur(): number {
    return this.lookUpLayer();
  }

  /** `parseBoardItemLayer()` (:2437): after `(layer`, the id; the caller reads the `)`. */
  parseBoardItemLayer(): number {
    this.NextTok();
    return this.lookUpLayer();
  }

  /** `parseBoardItemLayersAsMask()` (:2452): after `(layers`, through the `)`. */
  parseBoardItemLayersAsMask(): LSET {
    let layerMask = new LSET();
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      layerMask = layerMask.or(this.lookUpLayerSet());
    }
    return layerMask;
  }

  /** `parseLayersForCuItemWithSoldermask()` (:2468). */
  parseLayersForCuItemWithSoldermask(): LSET {
    const layerMask = this.parseBoardItemLayersAsMask();
    if (layerMask.and(LSET.AllCuMask()).count() !== 1) this.Expecting('single copper layer');
    if (layerMask.and(new LSET([F_Mask, B_Mask])).count() > 1)
      this.Expecting('max one soldermask layer');
    if (
      layerMask.and(LSET.InternalCuMask()).any() &&
      layerMask.and(new LSET([F_Mask, B_Mask])).any()
    )
      this.Expecting('no mask layer when track is on internal layer');
    if (layerMask.and(new LSET([F_Cu, B_Mask])).count() > 1)
      this.Expecting('copper and mask on the same side');
    if (layerMask.and(new LSET([B_Cu, F_Mask])).count() > 1)
      this.Expecting('copper and mask on the same side');
    return layerMask;
  }

  /** `parseSetup()` (:2494). */
  private parseSetup(): void {
    const hdr = this.hdr();
    const bds = hdr.designSettings;

    // Missing soldermask min width value means that the user has set the value to 0 and
    // not the default value (0.25mm)
    bds.solderMaskMinWidth = 0;

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();

      switch (token) {
        case 'stackup':
          this.parseBoardStackup();
          break;

        // The legacy (pre-6.0) design-rule tokens go to the project settings
        // upstream (m_LegacyDesignSettingsLoaded); none of them is written
        // back to the board, so they are read and let go here.
        case 'last_trace_width': // not used now
        case 'user_trace_width':
        case 'trace_clearance':
        case 'zone_clearance':
        case 'clearance_min':
        case 'trace_min':
        case 'via_size':
        case 'via_drill':
        case 'via_min_annulus':
        case 'via_min_size':
        case 'through_hole_min':
        case 'via_min_drill':
        case 'hole_to_hole_min':
        case 'uvia_size':
        case 'uvia_drill':
        case 'uvia_min_size':
        case 'uvia_min_drill':
        case 'segment_width':
        case 'edge_width':
        case 'mod_edge_width':
        case 'pcb_text_width':
        case 'mod_text_width':
        case 'pad_drill':
        case 'max_error':
          this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'zone_45_only': // legacy setting
        case 'uvias_allowed':
        case 'blind_buried_vias_allowed':
        case 'filled_areas_thickness': // Ignore this value, it is not used anymore
          this.parseBool();
          this.NeedRIGHT();
          break;

        case 'user_via':
          this.parseBoardUnits('user via size');
          this.parseBoardUnits('user via drill');
          this.NeedRIGHT();
          break;

        case 'user_diff_pair':
          this.parseBoardUnits('user diff-pair width');
          this.parseBoardUnits('user diff-pair gap');
          this.parseBoardUnits('user diff-pair via gap');
          this.NeedRIGHT();
          break;

        case 'pcb_text_size':
          this.parseBoardUnits('pcb text width');
          this.parseBoardUnits('pcb text height');
          this.NeedRIGHT();
          break;

        case 'mod_text_size':
          this.parseBoardUnits('footprint text width');
          this.parseBoardUnits('footprint text height');
          this.NeedRIGHT();
          break;

        case 'defaults':
          this.parseDefaults();
          break;

        case 'pad_size':
          this.parseBoardUnits('master pad width');
          this.parseBoardUnits('master pad height');
          this.NeedRIGHT();
          break;

        case 'pad_to_mask_clearance':
          bds.solderMaskExpansion = this.parseBoardUnits('pad_to_mask_clearance');
          this.NeedRIGHT();
          break;

        case 'solder_mask_min_width':
          bds.solderMaskMinWidth = this.parseBoardUnits('solder_mask_min_width');
          this.NeedRIGHT();
          break;

        case 'pad_to_paste_clearance':
          bds.solderPasteMargin = this.parseBoardUnits('pad_to_paste_clearance');
          this.NeedRIGHT();
          break;

        case 'pad_to_paste_clearance_ratio':
          bds.solderPasteMarginRatio = this.parseDoubleNext('pad_to_paste_clearance_ratio');
          this.NeedRIGHT();
          break;

        case 'allow_soldermask_bridges_in_footprints':
          bds.allowSoldermaskBridgesInFPs = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'tenting': {
          const [front, back] = this.parseFrontBackOptBool(true);
          bds.tentViasFront = front ?? false;
          bds.tentViasBack = back ?? false;
          break;
        }

        case 'covering': {
          const [front, back] = this.parseFrontBackOptBool();
          bds.coverViasFront = front ?? false;
          bds.coverViasBack = back ?? false;
          break;
        }

        case 'plugging': {
          const [front, back] = this.parseFrontBackOptBool();
          bds.plugViasFront = front ?? false;
          bds.plugViasBack = back ?? false;
          break;
        }

        case 'capping':
          bds.capVias = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'filling':
          bds.fillVias = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'aux_axis_origin': {
          const x = this.parseBoardUnits('auxiliary origin X');
          const y = this.parseBoardUnits('auxiliary origin Y');
          bds.auxOrigin = { x, y };
          this.NeedRIGHT();
          break;
        }

        case 'grid_origin': {
          const x = this.parseBoardUnits('grid origin X');
          const y = this.parseBoardUnits('grid origin Y');
          bds.gridOrigin = { x, y };
          this.NeedRIGHT();
          break;
        }

        // Stored in board prior to 6.0
        case 'visible_elements':
          this.parseHex();
          this.NeedRIGHT();
          break;

        case 'pcbplotparams': {
          const plotParams = this.parsePlotParams();
          bds.plotOptions = plotParams;
          if (plotParams.legacyPlotViaOnMaskLayer !== undefined) {
            const tent = !plotParams.legacyPlotViaOnMaskLayer;
            bds.tentViasFront = tent;
            bds.tentViasBack = tent;
          }
          break;
        }

        case 'zone_defaults':
          this.parseZoneDefaults(bds.zoneLayerProperties);
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
    // Set up a default stackup in case the file doesn't define one, and now we know
    // the enabled layers: `BuildDefaultStackupList` — with `m_HasStackup` left
    // false, so it is never written; nothing here reads it.
  }

  /** `parseZoneDefaults( aZoneSettings )` (:2910). */
  private parseZoneDefaults(props: Map<number, ZoneLayerProperties>): void {
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      switch (token) {
        case 'property':
          this.parseZoneLayerProperty(props);
          break;
        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  /** `parseZoneLayerProperty( aProperties )` (:2935). */
  parseZoneLayerProperty(props: Map<number, ZoneLayerProperties>): void {
    let layer = UNDEFINED_LAYER;
    const properties: ZoneLayerProperties = {};
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      switch (token) {
        case 'layer':
          layer = this.parseBoardItemLayer();
          this.NeedRIGHT();
          break;
        case 'hatch_position':
          properties.hatchingOffset = this.parseXY();
          this.NeedRIGHT();
          break;
        default:
          this.Unexpected(this.CurText());
      }
    }
    // `std::map::emplace`: the first entry for a layer wins.
    if (!props.has(layer)) props.set(layer, properties);
  }

  /** `parseDefaults( designSettings )` (:2974): legacy project settings, read and let go. */
  private parseDefaults(): void {
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      switch (token) {
        case 'edge_clearance':
        case 'copper_line_width':
        case 'courtyard_line_width':
        case 'edge_cuts_line_width':
        case 'silk_line_width':
        case 'fab_layers_line_width':
        case 'other_layers_line_width':
          this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;
        case 'copper_text_dims':
        case 'silk_text_dims':
        case 'fab_layers_text_dims':
        case 'other_layers_text_dims':
          this.parseDefaultTextDims();
          break;
        case 'dimension_units':
          this.parseInt('dimension units');
          this.NeedRIGHT();
          break;
        case 'dimension_precision':
          this.parseInt('dimension precision');
          this.NeedRIGHT();
          break;
        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  /** `parseDefaultTextDims( aSettings, aLayer )` (:3058). */
  private parseDefaultTextDims(): void {
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();
      switch (token) {
        case 'size':
          this.parseBoardUnits('default text size X');
          this.parseBoardUnits('default text size Y');
          this.NeedRIGHT();
          break;
        case 'thickness':
          this.parseBoardUnits('default text width');
          this.NeedRIGHT();
          break;
        case 'italic':
        case 'keep_upright':
          break;
        default:
          this.Expecting('size, thickness, italic or keep_upright');
      }
    }
  }

  /** `parseNETINFO_ITEM()` (:3095). */
  private parseNETINFO_ITEM(): void {
    const netCode = this.parseInt('net number');
    this.NeedSYMBOLorNUMBER();
    let name = this.CurText();
    // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the first merge
    // so the version is a bit later.
    if (this.m_requiredVersion < 20210606) name = convertToNewOverbarNotation(name);
    this.NeedRIGHT();

    // net 0 should be already in list, so store this net
    // if it is not the net 0, or if the net 0 does not exists.
    // (TODO: a better test.)
    if (netCode > 0 || !this.hdr().netNames.has(0)) {
      const assigned = this.addNet(name, netCode);
      // Store the new code mapping
      this.pushValueIntoMap(netCode, assigned);
    }
  }

  /** `parseNETCLASS()` (:3126): a legacy section — project settings, read and let go. */
  private parseNETCLASS(): void {
    // Read netclass name (can be a name or just a number like track width)
    this.NeedSYMBOLorNUMBER();
    this.NeedSYMBOL();
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      switch (token) {
        case 'clearance':
        case 'trace_width':
        case 'via_dia':
        case 'via_drill':
        case 'uvia_dia':
        case 'uvia_drill':
        case 'diff_pair_width':
        case 'diff_pair_gap':
          this.parseBoardUnits(token);
          break;
        case 'add_net':
          this.NeedSYMBOLorNUMBER();
          break;
        default:
          this.Expecting(
            'clearance, trace_width, via_dia, via_drill, uvia_dia, uvia_drill, ' +
              'diff_pair_width, diff_pair_gap or add_net',
          );
      }
      this.NeedRIGHT();
    }
  }

  /**
   * `parseFrontBackOptBool( aAllowLegacyFormat )` (:7698): `(front yes) (back no)`
   * pairs, or — when allowed — the legacy bare `front back` / `none` list.
   */
  parseFrontBackOptBool(allowLegacyFormat = false): [boolean | undefined, boolean | undefined] {
    let token = this.NextTok();
    let front: boolean | undefined;
    let back: boolean | undefined;
    if (token !== T.LEFT && allowLegacyFormat) {
      // legacy format for tenting.
      while (token !== T.RIGHT) {
        if (token === 'front') front = true;
        else if (token === 'back') back = true;
        else if (token === 'none') {
          front = undefined;
          back = undefined;
        } else this.Expecting('front, back or none');
        token = this.NextTok();
      }
      return [front, back];
    }
    while (token !== T.RIGHT) {
      if (token !== T.LEFT) this.Expecting('(');
      token = this.NextTok();
      if (token === 'front') front = this.parseOptBool();
      else if (token === 'back') back = this.parseOptBool();
      else this.Expecting('front or back');
      this.NeedRIGHT();
      token = this.NextTok();
    }
    return [front, back];
  }

  /**
   * `PCB_PLOT_PARAMS_PARSER::Parse` (pcbnew/pcb_plot_params.cpp:550): the
   * `(pcbplotparams …)` block, whose closing `)` this consumes.
   */
  private parsePlotParams(): PcbPlotParams {
    const p = this.hdr().designSettings.plotOptions;
    let token: Tok;
    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.EOF) this.Unexpected(T.EOF);
      if (token === T.LEFT) token = this.NextTok();
      if (token === 'pcbplotparams') continue;

      let skipRight = false;
      switch (token) {
        case 'layerselection': {
          token = this.NeedSYMBOLorNUMBER();
          const cur = this.CurText();
          if (token === T.NUMBER) {
            // pretty 3 format had legacy Cu stack.
            //  It's not possible to convert a legacy Cu layer number to a new Cu layer
            //  number without knowing the number or total Cu layers in the legacy board.
            //  We do not have that information here, so simply set all layers ON.  User
            //  can turn them off in the UI.
            p.layerSelection = new LSET([F_SilkS, B_SilkS]).or(LSET.AllCuMask());
          } else if (cur.startsWith('0x')) {
            // pretty ver. 4.
            // The layers were renumbered in 5e0abadb23425765e164f49ee2f893e94ddb97fc, but there wasn't
            // a board file version change with it, so this value is the one immediately after that happened.
            if (this.m_requiredVersion < 20240819) {
              const legacy = new LSET();
              legacy.ParseHex(cur.slice(2));
              p.layerSelection = remapLegacyLayerLSET(legacy);
            } else {
              p.layerSelection.ParseHex(cur.slice(2));
            }
          } else {
            this.Expecting('integer or hex layerSelection');
          }
          break;
        }
        case 'plot_on_all_layers_selection': {
          this.NeedSYMBOLorNUMBER();
          const cur = this.CurText();
          if (cur.startsWith('0x')) {
            if (this.m_requiredVersion < 20240819) {
              const legacy = new LSET();
              legacy.ParseHex(cur.slice(2));
              p.plotOnAllLayersSelection = remapLegacyLayerLSET(legacy);
            } else {
              p.plotOnAllLayersSelection.ParseHex(cur.slice(2));
            }
          } else {
            this.Expecting('hex plot_on_all_layers_selection');
          }
          break;
        }
        case 'disableapertmacros':
          p.gerberDisableApertMacros = this.plotParseBool();
          break;
        case 'usegerberextensions':
          p.useGerberProtelExtensions = this.plotParseBool();
          break;
        case 'usegerberattributes':
          p.useGerberX2format = this.plotParseBool();
          break;
        case 'usegerberadvancedattributes':
          p.includeGerberNetlistInfo = this.plotParseBool();
          break;
        case 'creategerberjobfile':
          p.createGerberJobFile = this.plotParseBool();
          break;
        case 'gerberprecision':
          p.gerberPrecision = this.plotParseInt(GBR_DEFAULT_PRECISION - 1, GBR_DEFAULT_PRECISION);
          break;
        case 'dashed_line_dash_ratio':
          p.dashedLineDashRatio = this.plotParseDouble();
          break;
        case 'dashed_line_gap_ratio':
          p.dashedLineGapRatio = this.plotParseDouble();
          break;
        case 'svgprecision':
          p.svgPrecision = this.plotParseInt(SVG_PRECISION_MIN, SVG_PRECISION_MAX);
          break;
        case 'svguseinch':
          this.plotParseBool(); // Unused. For compatibility
          break;
        case 'psa4output':
          p.a4Output = this.plotParseBool();
          break;
        case 'excludeedgelayer':
          if (!this.plotParseBool()) p.plotOnAllLayersSelection.set(Edge_Cuts);
          break;
        case 'plotframeref':
          p.plotDrawingSheet = this.plotParseBool();
          break;
        case 'viasonmask':
          p.legacyPlotViaOnMaskLayer = this.plotParseBool();
          break;
        case 'useauxorigin':
          p.useAuxOrigin = this.plotParseBool();
          break;
        case 'mode':
        case 'hpglpennumber':
        case 'hpglpenspeed':
        case 'hpglpenoverlay':
          // HPGL is no longer supported
          this.plotParseInt(-2147483648, 2147483647);
          break;
        case 'pdf_front_fp_property_popups':
          p.pdfFrontFPPropertyPopups = this.plotParseBool();
          break;
        case 'pdf_back_fp_property_popups':
          p.pdfBackFPPropertyPopups = this.plotParseBool();
          break;
        case 'pdf_metadata':
          p.pdfMetadata = this.plotParseBool();
          break;
        case 'pdf_single_document':
          p.pdfSingle = this.plotParseBool();
          break;
        case 'dxfpolygonmode':
          p.dxfPolygonMode = this.plotParseBool();
          break;
        case 'dxfimperialunits':
          p.dxfImperialUnits = this.plotParseBool();
          break;
        case 'dxfusepcbnewfont':
          p.dxfUsePcbnewFont = this.plotParseBool();
          break;
        case 'pscolor':
          this.NeedSYMBOL(); // This actually was never used...
          break;
        case 'psnegative':
          p.negative = this.plotParseBool();
          break;
        case 'plot_black_and_white':
          p.blackAndWhite = this.plotParseBool();
          break;
        case 'plotinvisibletext': // legacy token; no longer supported
          this.plotParseBool();
          break;
        case 'sketchpadsonfab':
          p.sketchPadsOnFabLayers = this.plotParseBool();
          break;
        case 'plotpadnumbers':
          p.plotPadNumbers = this.plotParseBool();
          break;
        case 'hidednponfab':
          p.hideDNPFPsOnFabLayers = this.plotParseBool();
          break;
        case 'sketchdnponfab':
          p.sketchDNPFPsOnFabLayers = this.plotParseBool();
          break;
        case 'crossoutdnponfab':
          p.crossoutDNPFPsOnFabLayers = this.plotParseBool();
          break;
        case 'subtractmaskfromsilk':
          p.subtractMaskFromSilk = this.plotParseBool();
          break;
        case 'outputformat':
          p.format = this.plotParseInt(PLOT_FORMAT.HPGL, PLOT_FORMAT.SVG) as PLOT_FORMAT;
          break;
        case 'mirror':
          p.mirror = this.plotParseBool();
          break;
        case 'drillshape':
          p.drillMarks = this.plotParseInt(0, 2) as DRILL_MARKS;
          break;
        case 'scaleselection':
          p.scaleSelection = this.plotParseInt(0, 4);
          break;
        case 'outputdirectory':
          this.NeedSYMBOLorNUMBER(); // a dir name can be like a number
          p.outputDirectory = this.CurText();
          break;
        default:
          this.skipCurrent(); // skip unknown or outdated plot parameter
          skipRight = true; // the closing right token is already read.
      }
      if (!skipRight) this.NeedRIGHT();
    }
    return p;
  }

  /** `PCB_PLOT_PARAMS_PARSER::parseBool`. */
  private plotParseBool(): boolean {
    const token = this.NeedSYMBOL();
    switch (token) {
      case 'false':
      case 'no':
        return false;
      case 'true':
      case 'yes':
        return true;
      default:
        this.Expecting('true, false, yes, or no');
    }
  }

  /** `PCB_PLOT_PARAMS_PARSER::parseInt( aMin, aMax )`: clamped, as `atoi`. */
  private plotParseInt(min: number, max: number): number {
    const token = this.NextTok();
    if (token !== T.NUMBER) this.Expecting(T.NUMBER);
    let val = Number.parseInt(this.CurText(), 10);
    if (Number.isNaN(val)) val = 0;
    if (val < min) val = min;
    else if (val > max) val = max;
    return val;
  }

  /** `PCB_PLOT_PARAMS_PARSER::parseDouble`. */
  private plotParseDouble(): number {
    const token = this.NextTok();
    if (token !== T.NUMBER) this.Expecting(T.NUMBER);
    return this.parseDouble();
  }

  /** `EMBEDDED_FILES_PARSER::ParseEmbedded` (common/embedded_files_parser.cpp). */
  private ParseEmbedded(files: EmbeddedFiles): void {
    // embedded files are version 20240706 and uses also Bars as separator
    this.SetKnowsBar(true);
    let file: EmbeddedFile | null = null;
    const add = (f: EmbeddedFile): void => {
      // `AddFile`: keyed by name; a later file of the same name replaces.
      files.files.set(f.name, f);
    };
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);
      token = this.NextTok();
      if (token !== 'file') this.Expecting('file');
      if (file) add(file);
      file = null;
      for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
        if (token !== T.LEFT) this.Expecting(T.LEFT);
        token = this.NextTok();
        switch (token) {
          case 'checksum':
            if (!file) this.Expecting('name');
            token = this.NeedSYMBOLorNUMBER();
            if (!DSNLEXER.IsSymbol(token)) this.Expecting('checksum data');
            file.dataHash = this.CurText();
            this.NeedRIGHT();
            break;
          case 'data': {
            if (!file) this.Expecting('name');
            let bar: Tok = this.NextTok();
            if (bar !== T.BAR) {
              // No data in the file -- due to bug in writer for 9.0.0
              if (bar === T.RIGHT) break;
              this.Expecting(T.BAR);
            }
            token = this.NextTok();
            let data = '';
            while (token !== T.BAR) {
              if (!DSNLEXER.IsSymbol(token)) this.Expecting('base64 file data');
              data += this.CurText();
              token = this.NextTok();
            }
            file.compressedEncodedData = data;
            bar = token;
            this.NeedRIGHT();
            break;
          }
          case 'name':
            this.NeedSYMBOLorNUMBER();
            file = { name: this.CurText(), type: 'other', compressedEncodedData: '', dataHash: '' };
            this.NeedRIGHT();
            break;
          case 'type': {
            if (!file) this.Expecting('name');
            token = this.NextTok();
            const types: EmbeddedFileType[] = ['datasheet', 'font', 'model', 'worksheet', 'other'];
            if (typeof token === 'string' && (types as string[]).includes(token))
              file.type = token as EmbeddedFileType;
            else this.Expecting('datasheet, font, model, worksheet, or other');
            this.NeedRIGHT();
            break;
          }
          default:
            this.Expecting('checksum, data, name, or type');
        }
      }
    }
    if (file) add(file);
    this.SetKnowsBar(this.m_requiredVersion >= 20240706);
  }
}

/** `createOldLayerMapping( aMap )` (:2208). */
function createOldLayerMapping(): Map<string, string> {
  const m = new Map<string, string>();
  // Italian
  m.set('Adesivo.Retro', 'B.Adhes');
  m.set('Adesivo.Fronte', 'F.Adhes');
  m.set('Pasta.Retro', 'B.Paste');
  m.set('Pasta.Fronte', 'F.Paste');
  m.set('Serigrafia.Retro', 'B.SilkS');
  m.set('Serigrafia.Fronte', 'F.SilkS');
  m.set('Maschera.Retro', 'B.Mask');
  m.set('Maschera.Fronte', 'F.Mask');
  m.set('Grafica', 'Dwgs.User');
  m.set('Commenti', 'Cmts.User');
  m.set('Eco1', 'Eco1.User');
  m.set('Eco2', 'Eco2.User');
  m.set('Contorno.scheda', 'Edge.Cuts');
  // Polish
  m.set('Kleju_Dolna', 'B.Adhes');
  m.set('Kleju_Gorna', 'F.Adhes');
  m.set('Pasty_Dolna', 'B.Paste');
  m.set('Pasty_Gorna', 'F.Paste');
  m.set('Opisowa_Dolna', 'B.SilkS');
  m.set('Opisowa_Gorna', 'F.SilkS');
  m.set('Maski_Dolna', 'B.Mask');
  m.set('Maski_Gorna', 'F.Mask');
  m.set('Rysunkowa', 'Dwgs.User');
  m.set('Komentarzy', 'Cmts.User');
  m.set('ECO1', 'Eco1.User');
  m.set('ECO2', 'Eco2.User');
  m.set('Krawedziowa', 'Edge.Cuts');
  // French
  m.set('Dessous.Adhes', 'B.Adhes');
  m.set('Dessus.Adhes', 'F.Adhes');
  m.set('Dessous.Pate', 'B.Paste');
  m.set('Dessus.Pate', 'F.Paste');
  m.set('Dessous.SilkS', 'B.SilkS');
  m.set('Dessus.SilkS', 'F.SilkS');
  m.set('Dessous.Masque', 'B.Mask');
  m.set('Dessus.Masque', 'F.Mask');
  m.set('Dessin.User', 'Dwgs.User');
  m.set('Contours.Ci', 'Edge.Cuts');
  return m;
}

/**
 * The pre-20210824 stackup colour fix-up (:2154): a `#RRGGBB` gains the
 * opacity KiCad assumed then — `DEFAULT_SOLDERMASK_OPACITY` (0.83) for a
 * solder mask, opaque otherwise — written as `#RRGGBBAA`.
 */
function legacyStackupColorWithAlpha(name: string, isSolderMask: boolean): string {
  const DEFAULT_SOLDERMASK_OPACITY = 0.83;
  const hex = name.slice(1);
  if (hex.length < 6) return name;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const alpha = isSolderMask ? DEFAULT_SOLDERMASK_OPACITY : 1.0;
  // `COLOR4D::ToColour`: `KiROUND( a * 255 )`.
  const a = KiROUND(alpha * 255);
  const h2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
  return `#${h2(r)}${h2(g)}${h2(b)}${h2(a)}`;
}

export { IsPrmSpecified };
