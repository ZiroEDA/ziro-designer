// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/pads/pads_sch_parser.cpp` / `.h`: the PADS Logic ASCII schematic
 * (`*PADS-LOGIC-V…*` / `*PADS-POWERLOGIC-V…*`) read into the structures the builders use.
 *
 * The file is read as bytes, a line a `std::string` (one JS character per byte), and every
 * `>>` goes through ISTRINGSTREAM (common/libc/sstream.ts) so its failures land where the
 * C++'s do. Text is decoded later, by the importer, as upstream does.
 */
import { ParseDouble, ParseInt, byteString } from '@ziroeda/common/io/pads/pads_common.js';
import { ISTRINGSTREAM } from '@ziroeda/common/libc/sstream.js';
import { type Reporter, RPT_SEVERITY_ERROR } from '@ziroeda/common/reporter.js';

export enum UNIT_TYPE {
  MILS,
  METRIC,
  INCHES,
}

export class FILE_HEADER {
  product = '';
  version = '';
  codepage = '';
  description = '';
  valid = false;
}

export class SHEET_SIZE {
  width = 11000.0;
  height = 8500.0;
  name = '';
}

export class PARAMETERS {
  units = UNIT_TYPE.MILS;
  grid_x = 100.0;
  grid_y = 100.0;
  border_template = '';
  job_name = '';
  sheet_size = new SHEET_SIZE();
  text_size = 60.0;
  line_width = 1.0;

  // Additional *SCH* parameters
  cur_sheet = 0;
  conn_width = 0;
  bus_width = 0;
  bus_angle = 0;
  pin_name_h = 0;
  pin_name_w = 0;
  ref_name_h = 0;
  ref_name_w = 0;
  part_name_h = 0;
  part_name_w = 0;
  pin_no_h = 0;
  pin_no_w = 0;
  net_name_h = 0;
  net_name_w = 0;
  text_h = 0;
  text_w = 0;
  dot_grid = 0;
  tied_dot_size = 0;
  real_width = 0;
  font_mode = '';
  default_font = '';

  /** All user fields from *FIELDS*, keyed by field name (`std::map`: walk it sorted). */
  fields = new Map<string, string>();
}

export interface POINT {
  x: number;
  y: number;
}

export interface ARC_DATA {
  bulge: number;
  angle: number;
  bbox_x1: number;
  bbox_y1: number;
  bbox_x2: number;
  bbox_y2: number;
}

export interface GRAPHIC_POINT {
  coord: POINT;
  arc: ARC_DATA | null;
}

export enum PIN_TYPE {
  PASSIVE,
  INPUT,
  OUTPUT,
  BIDIRECTIONAL,
  TRISTATE,
  OPEN_COLLECTOR,
  OPEN_EMITTER,
  POWER,
  UNSPECIFIED,
}

export class SYMBOL_PIN {
  name = '';
  number = '';
  position: POINT = { x: 0, y: 0 };
  type = PIN_TYPE.UNSPECIFIED;
  length = 200.0;
  rotation = 0.0;
  inverted = false;
  clock = false;

  // T-line fields
  side = 0;
  pn_h = 0;
  pn_w = 0;
  pn_angle = 0;
  pn_just = 0;
  pl_h = 0;
  pl_w = 0;
  pl_angle = 0;
  pl_just = 0;
  pin_decal_name = '';

  // P-line fields
  pn_offset: POINT = { x: 0, y: 0 };
  pn_off_angle = 0;
  pn_off_just = 0;
  pl_offset: POINT = { x: 0, y: 0 };
  pl_off_angle = 0;
  pl_off_just = 0;
  p_flags = 0;
}

export enum GRAPHIC_TYPE {
  LINE,
  RECTANGLE,
  CIRCLE,
  ARC,
  POLYLINE,
}

export class SYMBOL_GRAPHIC {
  type = GRAPHIC_TYPE.LINE;
  line_width = 0.0;
  filled = false;
  line_style = 255;
  points: GRAPHIC_POINT[] = [];
  center: POINT = { x: 0, y: 0 };
  radius = 0.0;
  start_angle = 0.0;
  end_angle = 0.0;
}

export class SYMBOL_TEXT {
  content = '';
  position: POINT = { x: 0, y: 0 };
  size = 60.0;
  rotation = 0.0;
  visible = true;
  justification = 0;
  width_factor = 0;
  attr_flag = 0;
  font_name = '';
}

export class CAEDECAL_ATTR {
  position: POINT = { x: 0, y: 0 };
  angle = 0;
  justification = 0;
  height = 0;
  width = 0;
  visibility = 0;
  font_name = '';
  attr_name = '';
}

export class SYMBOL_DEF {
  name = '';
  timestamp = '';
  gate_count = 1;
  current_gate = 1;
  pins: SYMBOL_PIN[] = [];
  graphics: SYMBOL_GRAPHIC[] = [];
  texts: SYMBOL_TEXT[] = [];

  // Full CAEDECAL header fields
  f1 = 0;
  f2 = 0;
  height = 0;
  width = 0;
  h2 = 0;
  w2 = 0;
  num_attrs = 0;
  num_pieces = 0;
  has_polarity = 0;
  num_pins = 0;
  pin_origin_code = 0;
  is_pin_decal = 0;
  font1 = '';
  font2 = '';
  attrs: CAEDECAL_ATTR[] = [];
}

export class PART_ATTRIBUTE {
  name = '';
  value = '';
  position: POINT = { x: 0, y: 0 };
  rotation = 0.0;
  size = 60.0;
  visible = true;
  justification = 0;
  height = 0;
  width = 0;
  visibility = 0;
  font_name = '';
}

export interface PIN_OVERRIDE {
  height: number;
  width: number;
  angle: number;
  justification: number;
}

export class PART_PLACEMENT {
  reference = '';
  symbol_name = '';
  part_type = '';
  position: POINT = { x: 0, y: 0 };
  rotation = 0.0;
  mirror_flags = 0;
  power_net_name = '';
  sheet_number = 1;
  gate_number = 1;
  attributes: PART_ATTRIBUTE[] = [];

  // Full *PART* header fields
  h1 = 0;
  w1 = 0;
  h2 = 0;
  w2 = 0;
  num_attrs = 0;
  num_displayed_values = 0;
  num_pins = 0;
  gate_index = 0;
  pin_origin_code = 0;
  font1 = '';
  font2 = '';

  /** Attribute value overrides parsed from "name" value lines (`std::map`). */
  attr_overrides = new Map<string, string>();

  /** Pin override lines (zero-based index -> formatting). */
  pin_overrides: PIN_OVERRIDE[] = [];
}

export class WIRE_SEGMENT {
  start: POINT = { x: 0, y: 0 };
  end: POINT = { x: 0, y: 0 };
  sheet_number = 1;

  // Real format fields
  endpoint_a = '';
  endpoint_b = '';
  vertex_count = 0;
  flags = 0;
  vertices: POINT[] = [];
}

export interface PIN_CONNECTION {
  reference: string;
  pin_number: string;
  sheet_number: number;
}

export class SCH_SIGNAL {
  name = '';
  wires: WIRE_SEGMENT[] = [];
  connections: PIN_CONNECTION[] = [];
  flags1 = 0;
  flags2 = 0;
  function = '';
}

export class OFF_PAGE_CONNECTOR {
  signal_name = '';
  source_sheet = 1;
  target_sheet = 1;
  position: POINT = { x: 0, y: 0 };
  id = 0;
  symbol_lib = '';
  rotation = 0;
  flags1 = 0;
  flags2 = 0;
}

export class SHEET_DEF {
  sheet_number = 1;
  name = '';
  size = new SHEET_SIZE();
}

export class SHEET_HEADER {
  sheet_num = 0;
  sheet_name = '';
  parent_num = -1;
  parent_name = '';
}

export class TIED_DOT {
  id = 0;
  position: POINT = { x: 0, y: 0 };
  sheet_number = 1;
}

export class TEXT_ITEM {
  position: POINT = { x: 0, y: 0 };
  rotation = 0;
  justification = 0;
  height = 0;
  width_factor = 0;
  attr_flag = 0;
  sheet_number = 0;
  font_name = '';
  content = '';
}

export class LINES_ITEM {
  name = '';
  origin: POINT = { x: 0, y: 0 };
  param1 = 0;
  param2 = 0;
  sheet_number = 0;
  primitives: SYMBOL_GRAPHIC[] = [];
  texts: TEXT_ITEM[] = [];
}

export class NETNAME_LABEL {
  net_name = '';
  anchor_ref = '';
  x_offset = 0;
  y_offset = 0;
  rotation = 0;
  justification = 0;
  f3 = 0;
  f4 = 0;
  f5 = 0;
  f6 = 0;
  f7 = 0;
  height = 0;
  width_pct = 0;
  font_name = '';
}

export class PARTTYPE_PIN {
  pin_id = '';
  swap_group = 0;
  pin_type = 'U';
  pin_name = '';
}

export class GATE_DEF {
  num_decal_variants = 0;
  num_pins = 0;
  swap_flag = 0;
  decal_names: string[] = [];
  pins: PARTTYPE_PIN[] = [];
}

export interface SPECIAL_VARIANT {
  decal_name: string;
  pin_type: string;
  net_suffix: string;
}

export interface SIGPIN {
  pin_number: string;
  net_name: string;
}

export class PARTTYPE_DEF {
  name = '';
  category = '';
  num_physical = 0;
  num_sigpins = 0;
  unused = 0;
  num_swap_groups = 0;
  timestamp = '';
  gates: GATE_DEF[] = [];

  // For special symbols ($GND_SYMS, $PWR_SYMS, $OSR_SYMS)
  special_keyword = '';
  special_variants: SPECIAL_VARIANT[] = [];

  // For CONN-based connectors
  is_connector = false;

  // SIGPIN entries (hidden power pins)
  sigpins: SIGPIN[] = [];

  // Swap group lines
  swap_lines: string[] = [];
}

const isdigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isalpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));

/** `std::getline( iss, s, aDelim )` repeated: no token after a trailing delimiter. */
function getlineTokens(aStr: string, aDelim: string): string[] {
  if (aStr === '') return [];

  const parts = aStr.split(aDelim);

  if (aStr.endsWith(aDelim)) parts.pop();

  return parts;
}

/** `rest.find( '"' )` .. the next `'"'`: the quoted text, or null. */
function quoted(aRest: string): string | null {
  const qStart = aRest.indexOf('"');

  if (qStart < 0) return null;

  const qEnd = aRest.indexOf('"', qStart + 1);

  return qEnd < 0 ? null : aRest.substring(qStart + 1, qEnd);
}

/** `find_first_not_of( " \t" )` .. end, or '' when it is all blank. */
function trimLeadingBlanks(aStr: string): string {
  const m = /[^ \t]/.exec(aStr);
  return m ? aStr.substring(m.index) : '';
}

/** Every `>> token` left in the stream. */
function remainingTokens(aIss: ISTRINGSTREAM): string[] {
  const tokens: string[] = [];

  for (let t = aIss.str(); t !== null; t = aIss.str()) tokens.push(t);

  return tokens;
}

export class PADS_SCH_PARSER {
  private m_reporter: Reporter | null = null;
  private m_header = new FILE_HEADER();
  private m_parameters = new PARAMETERS();
  private m_symbolDefs: SYMBOL_DEF[] = [];
  private m_partPlacements: PART_PLACEMENT[] = [];
  private m_signals: SCH_SIGNAL[] = [];
  private m_offPageConnectors: OFF_PAGE_CONNECTOR[] = [];
  private m_lineNumber = 0;
  private m_currentSheet = 0;
  /** `std::map<std::string, PARTTYPE_DEF>`: walk it sorted. */
  private m_partTypes = new Map<string, PARTTYPE_DEF>();
  private m_tiedDots: TIED_DOT[] = [];
  private m_sheetHeaders: SHEET_HEADER[] = [];
  private m_textItems: TEXT_ITEM[] = [];
  private m_linesItems: LINES_ITEM[] = [];
  private m_netNameLabels: NETNAME_LABEL[] = [];

  SetReporter(aReporter: Reporter | null): void {
    this.m_reporter = aReporter;
  }

  GetHeader(): FILE_HEADER {
    return this.m_header;
  }

  GetParameters(): PARAMETERS {
    return this.m_parameters;
  }

  GetSymbolDefs(): readonly SYMBOL_DEF[] {
    return this.m_symbolDefs;
  }

  GetPartPlacements(): readonly PART_PLACEMENT[] {
    return this.m_partPlacements;
  }

  GetSignals(): readonly SCH_SIGNAL[] {
    return this.m_signals;
  }

  GetVersion(): string {
    return this.m_header.version;
  }

  IsValid(): boolean {
    return this.m_header.valid;
  }

  GetOffPageConnectors(): readonly OFF_PAGE_CONNECTOR[] {
    return this.m_offPageConnectors;
  }

  GetPartTypes(): ReadonlyMap<string, PARTTYPE_DEF> {
    return this.m_partTypes;
  }

  GetTiedDots(): readonly TIED_DOT[] {
    return this.m_tiedDots;
  }

  GetSheetHeaders(): readonly SHEET_HEADER[] {
    return this.m_sheetHeaders;
  }

  GetTextItems(): readonly TEXT_ITEM[] {
    return this.m_textItems;
  }

  GetLinesItems(): readonly LINES_ITEM[] {
    return this.m_linesItems;
  }

  GetNetNameLabels(): readonly NETNAME_LABEL[] {
    return this.m_netNameLabels;
  }

  private isSectionMarker(aLine: string): boolean {
    if (aLine.length < 3 || aLine[0] !== '*') return false;

    const endPos = aLine.indexOf('*', 1);
    return endPos !== -1 && endPos > 1;
  }

  private extractSectionName(aLine: string): string {
    if (aLine.length < 3 || aLine[0] !== '*') return '';

    const endPos = aLine.indexOf('*', 1);

    if (endPos === -1 || endPos <= 1) return '';

    return aLine.substring(1, endPos);
  }

  /** The lines of a file as `std::getline` gives them, each `'\r'` end dropped. */
  static splitLines(aData: Uint8Array): string[] {
    const text = byteString(aData);
    const lines = text.split('\n');

    if (text.endsWith('\n') || text === '') lines.pop();

    return lines.map((l) => (l.endsWith('\r') ? l.substring(0, l.length - 1) : l));
  }

  /** `Parse( aFileName )`, from the file's bytes (null: it could not be opened). */
  Parse(aData: Uint8Array | null, aFileName = ''): boolean {
    this.m_header = new FILE_HEADER();
    this.m_parameters = new PARAMETERS();
    this.m_symbolDefs = [];
    this.m_partPlacements = [];
    this.m_signals = [];
    this.m_offPageConnectors = [];
    this.m_partTypes.clear();
    this.m_tiedDots = [];
    this.m_sheetHeaders = [];
    this.m_textItems = [];
    this.m_linesItems = [];
    this.m_netNameLabels = [];
    this.m_lineNumber = 0;
    this.m_currentSheet = 0;

    if (!aData) {
      this.m_reporter?.Report(`Cannot open file: ${aFileName}`, RPT_SEVERITY_ERROR);
      return false;
    }

    const lines = PADS_SCH_PARSER.splitLines(aData);

    if (lines.length === 0) {
      this.m_reporter?.Report('File is empty', RPT_SEVERITY_ERROR);
      return false;
    }

    if (!this.parseHeader(lines[0]!)) {
      this.m_reporter?.Report('Invalid PADS Logic file header', RPT_SEVERITY_ERROR);
      return false;
    }

    this.m_header.valid = true;

    for (let i = 1; i < lines.length; i++) {
      this.m_lineNumber = i + 1;
      const currentLine = lines[i]!;

      if (currentLine === '') continue;

      // Skip remark lines
      if (currentLine.startsWith('*REMARK*')) continue;

      if (!this.isSectionMarker(currentLine)) continue;

      const sectionName = this.extractSectionName(currentLine);

      if (sectionName === 'SCH') i = this.parseSectionSCH(lines, i);
      else if (sectionName === 'CAM' || sectionName === 'MISC')
        i = this.skipBraceDelimitedSection(lines, i);
      else if (sectionName === 'FIELDS') i = this.parseSectionFIELDS(lines, i);
      else if (sectionName === 'SHT') i = this.parseSectionSHT(lines, i);
      else if (sectionName === 'CAE') i = this.parseSectionCAE(lines, i);
      else if (sectionName === 'TEXT') i = this.parseSectionTEXT(lines, i);
      else if (sectionName === 'LINES') i = this.parseSectionLINES(lines, i);
      else if (sectionName === 'CAEDECAL') i = this.parseSectionCAEDECAL(lines, i);
      else if (sectionName === 'PARTTYPE') i = this.parseSectionPARTTYPE(lines, i);
      else if (sectionName === 'PART') i = this.parseSectionPART(lines, i);
      else if (sectionName === 'BUSSES')
        continue; // Empty in all observed files, skip to next section
      else if (sectionName === 'OFFPAGE REFS') i = this.parseSectionOFFPAGEREFS(lines, i);
      else if (sectionName === 'TIEDOTS') i = this.parseSectionTIEDOTS(lines, i);
      else if (sectionName === 'CONNECTION') i = this.parseSectionCONNECTION(lines, i);
      else if (sectionName === 'NETNAMES') i = this.parseSectionNETNAMES(lines, i);
      else if (sectionName === 'END') break;
    }

    this.mergePartTypeData();

    return true;
  }

  private mergePartTypeData(): void {
    // Pin data from PARTTYPEs is applied at symbol build time via GATE_DEF::pins,
    // not mutated on shared SYMBOL_DEF objects. Multiple PARTTYPEs can reference
    // the same CAEDECAL with different pin mappings.

    for (const part of this.m_partPlacements) {
      for (const attr of part.attributes) {
        if (attr.name === 'Ref.Des.' && attr.value === '') attr.value = part.reference;

        const ovr = part.attr_overrides.get(attr.name);

        if (ovr !== undefined && attr.value === '') attr.value = ovr;
      }
    }
  }

  static CheckFileHeader(aData: Uint8Array | null): boolean {
    if (!aData || aData.length === 0) return false;

    let firstLine = PADS_SCH_PARSER.splitLines(aData)[0] ?? '';

    if (firstLine.endsWith('\r')) firstLine = firstLine.substring(0, firstLine.length - 1);

    if (firstLine.startsWith('*PADS-LOGIC')) return true;

    if (firstLine.startsWith('*PADS-POWERLOGIC')) return true;

    return false;
  }

  private parseHeader(aLine: string): boolean {
    if (aLine === '' || aLine[0] !== '*') return false;

    const endPos = aLine.indexOf('*', 1);

    if (endPos === -1) return false;

    const headerTag = aLine.substring(1, endPos);

    // Accept an optional trailing suffix after the version, used by some PADS
    // exporters for the ANSI code page of any non-ASCII strings (e.g.
    // *PADS-LOGIC-V9.0-CP1250*).
    const match = /^PADS-(POWER)?LOGIC-V(\d+\.\d+)(?:-([A-Za-z0-9]+))?$/.exec(headerTag);

    if (!match) return false;

    this.m_header.product = match[1] !== undefined ? 'PADS-POWERLOGIC' : 'PADS-LOGIC';

    this.m_header.version = `V${match[2]}`;

    if (match[3] !== undefined) this.m_header.codepage = match[3];

    if (endPos + 1 < aLine.length) {
      const desc = aLine.substring(endPos + 1);
      const start = desc.search(/[^ ]/);

      if (start !== -1) this.m_header.description = desc.substring(start);
    }

    return true;
  }

  private parseSectionSCH(aLines: string[], aStartLine: number): number {
    const P = this.m_parameters;
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (this.isSectionMarker(line)) return i - 1;

      if (line === '') {
        i++;
        continue;
      }

      const iss = new ISTRINGSTREAM(line);
      const keyword = iss.readString();

      if (keyword === 'UNITS') {
        const unitsVal = iss.readInt(0);

        switch (unitsVal) {
          case 1:
            P.units = UNIT_TYPE.METRIC;
            break;
          case 2:
            P.units = UNIT_TYPE.INCHES;
            break;
          default:
            P.units = UNIT_TYPE.MILS;
            break;
        }
      } else if (keyword === 'CUR') {
        // Compound keyword: CUR SHEET
        if (iss.readString() === 'SHEET') P.cur_sheet = iss.readInt(P.cur_sheet);
      } else if (keyword === 'SHEET') {
        // Compound keyword: SHEET SIZE
        if (iss.readString() === 'SIZE') {
          const sizeCode = iss.readString();

          P.sheet_size.name = sizeCode;

          const sizes: Record<string, [number, number]> = {
            A: [11000.0, 8500.0],
            B: [17000.0, 11000.0],
            C: [22000.0, 17000.0],
            D: [34000.0, 22000.0],
            E: [44000.0, 34000.0],
          };
          const size = Object.hasOwn(sizes, sizeCode) ? sizes[sizeCode] : undefined;

          if (size) [P.sheet_size.width, P.sheet_size.height] = size;
        }
      } else if (keyword === 'USERGRID') {
        P.grid_x = iss.readDouble(P.grid_x);
        P.grid_y = iss.readDouble(P.grid_y);
      } else if (keyword === 'LINEWIDTH') {
        P.line_width = iss.readDouble(P.line_width);
      } else if (keyword === 'CONNWIDTH') {
        P.conn_width = iss.readInt(P.conn_width);
      } else if (keyword === 'BUSWIDTH') {
        P.bus_width = iss.readInt(P.bus_width);
      } else if (keyword === 'BUSANGLE') {
        P.bus_angle = iss.readInt(P.bus_angle);
      } else if (keyword === 'TEXTSIZE') {
        P.text_h = iss.readInt(P.text_h);
        P.text_w = iss.readInt(P.text_w);
        P.text_size = P.text_h;
      } else if (keyword === 'PINNAMESIZE') {
        P.pin_name_h = iss.readInt(P.pin_name_h);
        P.pin_name_w = iss.readInt(P.pin_name_w);
      } else if (keyword === 'REFNAMESIZE') {
        P.ref_name_h = iss.readInt(P.ref_name_h);
        P.ref_name_w = iss.readInt(P.ref_name_w);
      } else if (keyword === 'PARTNAMESIZE') {
        P.part_name_h = iss.readInt(P.part_name_h);
        P.part_name_w = iss.readInt(P.part_name_w);
      } else if (keyword === 'PINNOSIZE') {
        P.pin_no_h = iss.readInt(P.pin_no_h);
        P.pin_no_w = iss.readInt(P.pin_no_w);
      } else if (keyword === 'NETNAMESIZE') {
        P.net_name_h = iss.readInt(P.net_name_h);
        P.net_name_w = iss.readInt(P.net_name_w);
      } else if (keyword === 'DOTGRID') {
        P.dot_grid = iss.readInt(P.dot_grid);
      } else if (keyword === 'TIEDOTSIZE') {
        P.tied_dot_size = iss.readInt(P.tied_dot_size);
      } else if (keyword === 'REAL') {
        // Compound keyword: REAL WIDTH
        if (iss.readString() === 'WIDTH') P.real_width = iss.readInt(P.real_width);
      } else if (keyword === 'FONT') {
        // Compound keyword: FONT MODE
        if (iss.readString() === 'MODE') P.font_mode = iss.readString(P.font_mode);
      } else if (keyword === 'DEFAULT') {
        // Compound keyword: DEFAULT FONT
        if (iss.readString() === 'FONT') {
          const rest = iss.getline();
          const q = quoted(rest);

          if (q !== null) P.default_font = q;
        }
      } else if (keyword === 'BORDER') {
        // Compound keyword: BORDER NAME
        const second = iss.readString();

        if (second === 'NAME') {
          P.border_template = iss.readString();
        } else {
          // Might just be "BORDER value" in simplified test format
          P.border_template = second;
        }
      } else if (keyword === 'JOBNAME') {
        let rest = iss.getline();
        const start = rest.search(/[^ \t]/);

        if (start !== -1) {
          rest = rest.substring(start);

          if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"'))
            rest = rest.substring(1, rest.length - 1);

          P.job_name = rest;
        }
      }
      // Color keywords and other numeric keywords -- just skip without error

      i++;
    }

    return aLines.length - 1;
  }

  private parseSectionFIELDS(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (this.isSectionMarker(line)) return i - 1;

      if (line === '' || line[0] !== '"') {
        i++;
        continue;
      }

      // Format: "Field Name" [value text]
      const closeQuote = line.indexOf('"', 1);

      if (closeQuote !== -1) {
        const fieldName = line.substring(1, closeQuote);
        let fieldValue = '';

        if (closeQuote + 1 < line.length)
          fieldValue = trimLeadingBlanks(line.substring(closeQuote + 1));

        this.m_parameters.fields.set(fieldName, fieldValue);
      }

      i++;
    }

    return aLines.length - 1;
  }

  private parseSectionSHT(aLines: string[], aStartLine: number): number {
    // Format: *SHT*   sheet_num sheet_name parent_num parent_name
    const line = aLines[aStartLine]!;
    const afterMarker = line.substring(line.indexOf('*', 1) + 1);

    const iss = new ISTRINGSTREAM(afterMarker);
    const header = new SHEET_HEADER();

    header.sheet_num = iss.readInt(header.sheet_num);
    header.sheet_name = iss.readString(header.sheet_name);
    header.parent_num = iss.readInt(header.parent_num);
    header.parent_name = iss.readString(header.parent_name);

    this.m_currentSheet = header.sheet_num;
    this.m_sheetHeaders.push(header);

    return aStartLine;
  }

  private parseSectionCAE(aLines: string[], aStartLine: number): number {
    // *CAE* just contains viewport parameters, skip until next section
    let i = aStartLine + 1;

    while (i < aLines.length) {
      if (this.isSectionMarker(aLines[i]!)) return i - 1;

      i++;
    }

    return aLines.length - 1;
  }

  /** A text attribute line: x y rotation justification height width [attr_flag] "font". */
  private parseTextAttrLine(aLine: string, aWithFlag: boolean): TEXT_ITEM {
    const item = new TEXT_ITEM();
    item.sheet_number = this.m_currentSheet;
    const iss = new ISTRINGSTREAM(aLine);

    const x = iss.readInt(0);
    const y = iss.readInt(0);
    item.rotation = iss.readInt(item.rotation);
    item.justification = iss.readInt(item.justification);
    item.height = iss.readInt(item.height);
    item.width_factor = iss.readInt(item.width_factor);

    if (aWithFlag) item.attr_flag = iss.readInt(item.attr_flag);

    item.position = { x, y };

    // Parse quoted font name from remainder
    const q = quoted(iss.getline());

    if (q !== null) item.font_name = q;

    return item;
  }

  private parseSectionTEXT(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Each text item is two lines: attribute line + content line
      const item = this.parseTextAttrLine(line, true);

      // Next line is content
      i++;

      if (i < aLines.length) item.content = aLines[i]!;

      this.m_textItems.push(item);
      i++;
    }

    return aLines.length - 1;
  }

  private parseSectionLINES(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Look for LINES item header: name LINES x y param1 param2
      if (line.includes('LINES')) {
        const item = new LINES_ITEM();
        const iss = new ISTRINGSTREAM(line);

        const name = iss.readString();
        const keyword = iss.readString();
        const x = iss.readInt(0);
        const y = iss.readInt(0);
        item.param1 = iss.readInt(item.param1);
        item.param2 = iss.readInt(item.param2);

        if (keyword === 'LINES') {
          item.name = name;
          item.origin = { x, y };
          item.sheet_number = this.m_currentSheet;

          i++;

          // Parse graphic primitives and embedded text until next LINES item or section
          while (i < aLines.length) {
            const pline = aLines[i]!;

            if (pline === '') {
              i++;
              continue;
            }

            if (this.isSectionMarker(pline)) break;

            // Check if this is a new LINES item header
            if (pline.includes('LINES')) {
              const tiss = new ISTRINGSTREAM(pline);
              tiss.readString();

              if (tiss.readString() === 'LINES') break;
            }

            const piss = new ISTRINGSTREAM(pline);
            const firstToken = piss.readString();

            if (
              firstToken === 'OPEN' ||
              firstToken === 'CLOSED' ||
              firstToken === 'CIRCLE' ||
              firstToken === 'COPCLS'
            ) {
              const graphic = new SYMBOL_GRAPHIC();
              i = this.parseGraphicPrimitive(aLines, i, graphic);
              item.primitives.push(graphic);
              i++;
              continue;
            }

            // Try to parse as text (attribute line + content) if it starts with
            // a number that could be a coordinate
            const isNumber =
              firstToken !== '' &&
              (isdigit(firstToken[0]) || firstToken[0] === '-' || firstToken[0] === '+');

            if (isNumber && pline.includes('"')) {
              // Text attribute line
              const text = this.parseTextAttrLine(pline, false);

              i++;

              if (i < aLines.length) text.content = aLines[i]!;

              item.texts.push(text);
            }

            i++;
          }

          this.m_linesItems.push(item);
          continue;
        }
      }

      i++;
    }

    return aLines.length - 1;
  }

  private parseSectionCAEDECAL(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) break;

      // Each entry starts with a header line of 13 fields
      const symbol = new SYMBOL_DEF();
      i = this.parseSymbolDef(aLines, i, symbol);

      if (symbol.name !== '') this.m_symbolDefs.push(symbol);

      i++;
    }

    // Resolve pin lengths from pin decal OPEN line geometry. The name-based
    // heuristic (SHORT/LONG) only covers standard pin decals; custom names
    // like PIN_ADI_300 need their length computed from the actual graphics.
    const pinDecalLengths = new Map<string, number>();

    for (const sym of this.m_symbolDefs) {
      if (!sym.is_pin_decal) continue;

      for (const graphic of sym.graphics) {
        if (graphic.type !== GRAPHIC_TYPE.LINE && graphic.type !== GRAPHIC_TYPE.POLYLINE) continue;

        if (graphic.points.length < 2) continue;

        const first = graphic.points[0]!.coord;
        const last = graphic.points[graphic.points.length - 1]!.coord;
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        pinDecalLengths.set(sym.name, Math.sqrt(dx * dx + dy * dy));
        break;
      }
    }

    for (const sym of this.m_symbolDefs) {
      if (sym.is_pin_decal) continue;

      for (const pin of sym.pins) {
        if (pin.pin_decal_name === '') continue;

        const len = pinDecalLengths.get(pin.pin_decal_name);

        if (len !== undefined) pin.length = len;
      }
    }

    return i > 0 ? i - 1 : aLines.length - 1;
  }

  private parseSymbolDef(aLines: string[], aStartLine: number, aSymbol: SYMBOL_DEF): number {
    if (aStartLine >= aLines.length) return aStartLine;

    const headerLine = aLines[aStartLine]!;

    // Parse header: name f1 f2 height width h2 w2 num_attrs num_pieces has_polarity num_pins
    //               pin_origin_code is_pin_decal
    const iss = new ISTRINGSTREAM(headerLine);
    const name = iss.readString();

    if (name === '') return aStartLine;

    aSymbol.name = name;

    // Try parsing as full 13-field CAEDECAL format
    const tokens = remainingTokens(iss);

    if (tokens.length >= 12) {
      // Full CAEDECAL format
      const n = (k: number): number => ParseInt(tokens[k]!, 0, 'CAEDECAL header');
      aSymbol.f1 = n(0);
      aSymbol.f2 = n(1);
      aSymbol.height = n(2);
      aSymbol.width = n(3);
      aSymbol.h2 = n(4);
      aSymbol.w2 = n(5);
      aSymbol.num_attrs = n(6);
      aSymbol.num_pieces = n(7);
      aSymbol.has_polarity = n(8);
      aSymbol.num_pins = n(9);
      aSymbol.pin_origin_code = n(10);
      aSymbol.is_pin_decal = n(11);
    } else {
      // Simplified test format: name num_pieces num_pins gate_count
      if (tokens.length >= 3) {
        aSymbol.num_pieces = ParseInt(tokens[0]!, 0, 'CAEDECAL simplified');
        aSymbol.num_pins = ParseInt(tokens[1]!, 0, 'CAEDECAL simplified');
        aSymbol.gate_count = ParseInt(tokens[2]!, 0, 'CAEDECAL simplified');
      } else {
        return aStartLine;
      }

      // Parse simplified format graphics and pins inline
      let idx = aStartLine + 1;

      for (let p = 0; p < aSymbol.num_pieces && idx < aLines.length; p++) {
        const gline = aLines[idx]!;

        if (gline === '' || this.isSectionMarker(gline)) break;

        const graphic = new SYMBOL_GRAPHIC();
        const giss = new ISTRINGSTREAM(gline);
        const typeStr = giss.readString();

        if (
          typeStr === 'OPEN' ||
          typeStr === 'LINE' ||
          typeStr === 'CLOSED' ||
          typeStr === 'RECT'
        ) {
          graphic.type =
            typeStr === 'OPEN' || typeStr === 'LINE' ? GRAPHIC_TYPE.LINE : GRAPHIC_TYPE.RECTANGLE;
          const p1 = { x: giss.readDouble(0), y: 0 };
          p1.y = giss.readDouble(0);
          const p2 = { x: giss.readDouble(0), y: 0 };
          p2.y = giss.readDouble(0);
          graphic.points.push({ coord: p1, arc: null });
          graphic.points.push({ coord: p2, arc: null });
          graphic.line_width = giss.readDouble(graphic.line_width);
        } else if (typeStr === 'CIRCLE') {
          graphic.type = GRAPHIC_TYPE.CIRCLE;
          graphic.center.x = giss.readDouble(graphic.center.x);
          graphic.center.y = giss.readDouble(graphic.center.y);
          graphic.radius = giss.readDouble(graphic.radius);
          graphic.line_width = giss.readDouble(graphic.line_width);
        }

        aSymbol.graphics.push(graphic);
        idx++;
      }

      for (let p = 0; p < aSymbol.num_pins && idx < aLines.length; p++) {
        const pline = aLines[idx]!;

        if (pline === '' || this.isSectionMarker(pline)) break;

        const pin = new SYMBOL_PIN();
        const piss = new ISTRINGSTREAM(pline);

        pin.position.x = piss.readDouble(pin.position.x);
        pin.position.y = piss.readDouble(pin.position.y);
        const orientation = piss.readDouble(0);
        pin.length = piss.readDouble(pin.length);
        pin.number = piss.readString(pin.number);
        pin.name = piss.readString(pin.name);

        pin.rotation = orientation;

        const typeStr = piss.str();

        if (typeStr !== null) pin.type = this.parsePinType(typeStr);

        aSymbol.pins.push(pin);
        idx++;
      }

      return idx - 1;
    }

    // Full CAEDECAL format parsing
    let idx = aStartLine + 1;

    // TIMESTAMP line
    if (idx < aLines.length && aLines[idx]!.startsWith('TIMESTAMP')) {
      const tiss = new ISTRINGSTREAM(aLines[idx]!);
      tiss.readString();
      aSymbol.timestamp = tiss.readString(aSymbol.timestamp);
      idx++;
    }

    // Two font name lines (optional, not present in older formats like V5.2)
    for (const which of ['font1', 'font2'] as const) {
      const fl = aLines[idx];

      if (fl !== undefined && fl.length >= 2 && fl[0] === '"') {
        const qEnd = fl.indexOf('"', 1);

        if (qEnd !== -1) aSymbol[which] = fl.substring(1, qEnd);

        idx++;
      }
    }

    // Attribute label pairs (num_attrs pairs of position+name lines)
    for (let a = 0; a < aSymbol.num_attrs && idx + 1 < aLines.length; a++) {
      const attr = new CAEDECAL_ATTR();
      const aiss = new ISTRINGSTREAM(aLines[idx]!);

      const x = aiss.readInt(0);
      const y = aiss.readInt(0);
      attr.angle = aiss.readInt(attr.angle);
      attr.justification = aiss.readInt(attr.justification);
      attr.height = aiss.readInt(attr.height);
      attr.width = aiss.readInt(attr.width);
      attr.position = { x, y };

      // Parse quoted font name
      const q = quoted(aiss.getline());

      if (q !== null) attr.font_name = q;

      idx++;

      if (idx < aLines.length) attr.attr_name = aLines[idx]!;

      aSymbol.attrs.push(attr);
      idx++;
    }

    // Graphic primitives (num_pieces)
    for (let p = 0; p < aSymbol.num_pieces && idx < aLines.length; p++) {
      if (aLines[idx] === '') {
        idx++;
        p--;
        continue;
      }

      const graphic = new SYMBOL_GRAPHIC();
      idx = this.parseGraphicPrimitive(aLines, idx, graphic);
      aSymbol.graphics.push(graphic);
      idx++;
    }

    // Embedded text labels (between graphics and pins)
    // Scan forward looking for T-prefixed pin lines. A blank line marks the end of
    // the current CAEDECAL entry (important for entries with num_pins=0 like pin decals).
    while (idx < aLines.length) {
      const tline = aLines[idx]!;

      if (tline === '') break;

      if (this.isSectionMarker(tline)) break;

      // Pin T-lines start with T immediately followed by a digit or minus sign
      if (tline.length > 1 && tline[0] === 'T' && (isdigit(tline[1]) || tline[1] === '-')) break;

      // This is an embedded text label (two-line format)
      const text = new SYMBOL_TEXT();
      const tiss = new ISTRINGSTREAM(tline);

      const tx = tiss.readInt(0);
      const ty = tiss.readInt(0);
      text.rotation = tiss.readDouble(text.rotation);
      text.justification = tiss.readInt(text.justification);

      const height = tiss.readInt(0);
      const width = tiss.readInt(0);
      text.size = height;
      text.width_factor = width;

      text.position = { x: tx, y: ty };

      idx++;

      if (idx < aLines.length) {
        text.content = aLines[idx]!;
        idx++;
      }

      aSymbol.texts.push(text);
    }

    // Pin T/P line pairs (num_pins)
    for (let p = 0; p < aSymbol.num_pins && idx < aLines.length; p++) {
      const tLine = aLines[idx]!;

      if (tLine === '') {
        idx++;
        p--;
        continue;
      }

      if (this.isSectionMarker(tLine)) break;

      const pin = new SYMBOL_PIN();

      // T line: T<x> y angle side pn_h pn_w pn_angle pn_just pl_h pl_w pl_angle pl_just
      //         pin_decal_name
      if (tLine.length > 1 && tLine[0] === 'T') {
        // T immediately followed by x coordinate
        const tiss = new ISTRINGSTREAM(tLine.substring(1));

        const tx = tiss.readInt(0);
        const ty = tiss.readInt(0);
        const angle = tiss.readInt(0);
        pin.side = tiss.readInt(pin.side);
        pin.pn_h = tiss.readInt(pin.pn_h);
        pin.pn_w = tiss.readInt(pin.pn_w);
        pin.pn_angle = tiss.readInt(pin.pn_angle);
        pin.pn_just = tiss.readInt(pin.pn_just);
        pin.pl_h = tiss.readInt(pin.pl_h);
        pin.pl_w = tiss.readInt(pin.pl_w);
        pin.pl_angle = tiss.readInt(pin.pl_angle);
        pin.pl_just = tiss.readInt(pin.pl_just);
        pin.pin_decal_name = tiss.readString(pin.pin_decal_name);

        pin.position = { x: tx, y: ty };
        pin.rotation = angle;

        // Determine inverted/clock from pin decal name
        const d = pin.pin_decal_name;

        if (d === 'PINB' || d === 'PINORB' || d === 'PCLKB' || d === 'PINIEB' || d === 'PINCLKB')
          pin.inverted = true;

        if (d === 'PCLK' || d === 'PCLKB' || d === 'PINCLK' || d === 'PINCLKB') pin.clock = true;

        // Pin stub length from pin decal name. Self-contained pin decals
        // (no pin_decal_name) draw the pin graphics themselves so the
        // KiCad stub length should be zero.
        if (d === '') pin.length = 0.0;
        else if (d.includes('SHORT')) pin.length = 100.0;
        else if (d.includes('LONG')) pin.length = 300.0;
      }

      idx++;

      // P line: P<x1> y1 angle1 just1 x2 y2 angle2 just2 flags
      if (idx < aLines.length) {
        const pLine = aLines[idx]!;

        if (pLine.length > 1 && pLine[0] === 'P') {
          const piss = new ISTRINGSTREAM(pLine.substring(1));

          const px1 = piss.readInt(0);
          const py1 = piss.readInt(0);
          pin.pn_off_angle = piss.readInt(pin.pn_off_angle);
          pin.pn_off_just = piss.readInt(pin.pn_off_just);
          const px2 = piss.readInt(0);
          const py2 = piss.readInt(0);
          pin.pl_off_angle = piss.readInt(pin.pl_off_angle);
          pin.pl_off_just = piss.readInt(pin.pl_off_just);
          pin.p_flags = piss.readInt(pin.p_flags);

          pin.pn_offset = { x: px1, y: py1 };
          pin.pl_offset = { x: px2, y: py2 };

          // Pin name hidden if flags bit 128 set
          if (pin.p_flags & 128) pin.name = '';
        }

        idx++;
      }

      // Pin number is derived from index+1 by default. The actual assignment
      // comes from the PARTTYPE section, so we use a placeholder.
      pin.number = `${p + 1}`;

      aSymbol.pins.push(pin);
    }

    return idx > 0 ? idx - 1 : 0;
  }

  private parseGraphicPrimitive(
    aLines: string[],
    aStartLine: number,
    aGraphic: SYMBOL_GRAPHIC,
  ): number {
    if (aStartLine >= aLines.length) return aStartLine;

    const iss = new ISTRINGSTREAM(aLines[aStartLine]!);

    const typeStr = iss.readString();
    const pointCount = iss.readInt(0);
    const lineWidth = iss.readInt(0);
    const lineStyle = iss.readInt(255);

    aGraphic.line_width = lineWidth;
    aGraphic.line_style = lineStyle;

    if (typeStr === 'OPEN') {
      aGraphic.type = GRAPHIC_TYPE.POLYLINE;
      aGraphic.filled = false;
    } else if (typeStr === 'CLOSED') {
      aGraphic.type = GRAPHIC_TYPE.RECTANGLE;
      aGraphic.filled = false;
    } else if (typeStr === 'CIRCLE') {
      aGraphic.type = GRAPHIC_TYPE.CIRCLE;
      aGraphic.filled = false;
    } else if (typeStr === 'COPCLS') {
      aGraphic.type = GRAPHIC_TYPE.RECTANGLE;
      aGraphic.filled = true;
    }

    // Parse point data
    let idx = aStartLine + 1;

    for (let p = 0; p < pointCount && idx < aLines.length; p++) {
      const ptLine = aLines[idx]!;

      if (ptLine === '' || this.isSectionMarker(ptLine)) break;

      const piss = new ISTRINGSTREAM(ptLine);
      const gpt: GRAPHIC_POINT = { coord: { x: 0, y: 0 }, arc: null };
      gpt.coord.x = piss.readDouble(gpt.coord.x);
      gpt.coord.y = piss.readDouble(gpt.coord.y);

      const extraTokens = remainingTokens(piss);

      if (extraTokens.length >= 6) {
        const d = (k: number): number => ParseDouble(extraTokens[k]!, 0.0, 'arc data');
        gpt.arc = {
          bulge: d(0),
          angle: d(1),
          bbox_x1: d(2),
          bbox_y1: d(3),
          bbox_x2: d(4),
          bbox_y2: d(5),
        };
      }

      aGraphic.points.push(gpt);

      idx++;
    }

    // For CLOSED/COPCLS polygons, determine whether the points form an axis-aligned rectangle
    // or a general polygon. Rectangles are reduced to 2 corner points (min, max) for the builder.
    // Non-rectangular shapes (triangles, arbitrary polygons) become POLYLINE primitives.
    if (aGraphic.type === GRAPHIC_TYPE.RECTANGLE && aGraphic.points.length >= 4) {
      const uniqueX = new Set<number>();
      const uniqueY = new Set<number>();

      for (const pt of aGraphic.points) {
        uniqueX.add(pt.coord.x);
        uniqueY.add(pt.coord.y);
      }

      const isRect = uniqueX.size === 2 && uniqueY.size === 2;

      if (isRect) {
        const xs = [...uniqueX].sort((a, b) => a - b);
        const ys = [...uniqueY].sort((a, b) => a - b);

        aGraphic.points = [
          { coord: { x: xs[0]!, y: ys[0]! }, arc: null },
          { coord: { x: xs[1]!, y: ys[1]! }, arc: null },
        ];
      } else {
        aGraphic.type = GRAPHIC_TYPE.POLYLINE;
      }
    }

    // For CIRCLE with 2 points, compute center and radius
    if (aGraphic.type === GRAPHIC_TYPE.CIRCLE && aGraphic.points.length === 2) {
      const [a, b] = [aGraphic.points[0]!.coord, aGraphic.points[1]!.coord];
      aGraphic.center.x = (a.x + b.x) / 2.0;
      aGraphic.center.y = (a.y + b.y) / 2.0;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      aGraphic.radius = Math.sqrt(dx * dx + dy * dy) / 2.0;
    }

    return idx > 0 ? idx - 1 : aStartLine;
  }

  /** A V9.0+ pin definition line: pin_id swap_group pin_type [pin_name]. */
  private static parsePartTypePin(aLine: string, aWithName: boolean): PARTTYPE_PIN {
    const pin = new PARTTYPE_PIN();
    const piss = new ISTRINGSTREAM(aLine);

    pin.pin_id = piss.readString(pin.pin_id);
    pin.swap_group = piss.readInt(pin.swap_group);
    const pinType = piss.readString();

    if (pinType !== '') pin.pin_type = pinType[0]!;

    if (aWithName) {
      const pinName = piss.str();

      if (pinName !== null) pin.pin_name = pinName;
    }

    return pin;
  }

  private parseSectionPARTTYPE(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Part type header: name category num_physical num_sigpins unused num_swap_groups
      const pt = new PARTTYPE_DEF();
      const iss = new ISTRINGSTREAM(line);
      pt.name = iss.readString(pt.name);
      pt.category = iss.readString(pt.category);
      pt.num_physical = iss.readInt(pt.num_physical);
      pt.num_sigpins = iss.readInt(pt.num_sigpins);
      pt.unused = iss.readInt(pt.unused);
      pt.num_swap_groups = iss.readInt(pt.num_swap_groups);

      if (pt.name === '') {
        i++;
        continue;
      }

      i++;

      // TIMESTAMP line
      if (i < aLines.length && aLines[i]!.startsWith('TIMESTAMP')) {
        const tiss = new ISTRINGSTREAM(aLines[i]!);
        tiss.readString();
        pt.timestamp = tiss.readString(pt.timestamp);
        i++;
      }

      // Check for special symbols ($GND_SYMS, $PWR_SYMS, $OSR_SYMS)
      const isSpecial =
        pt.name === '$GND_SYMS' || pt.name === '$PWR_SYMS' || pt.name === '$OSR_SYMS';

      // V5.2 uses "G:decalname swap num_pins" for gate definitions while V9.0+ uses
      // "GATE num_variants num_pins swap" followed by decal name lines. Detect by
      // checking whether the first content line starts with "G:".
      const isV52Gates =
        i < aLines.length &&
        aLines[i]!.length >= 3 &&
        aLines[i]![0] === 'G' &&
        aLines[i]![1] === ':';

      if (isSpecial && !isV52Gates) {
        // V9.0+ special symbol format: keyword num_variants, then variant lines
        if (i < aLines.length) {
          const siss = new ISTRINGSTREAM(aLines[i]!);
          pt.special_keyword = siss.readString(pt.special_keyword);
          const numVariants = siss.readInt(0);
          i++;

          for (let v = 0; v < numVariants && i < aLines.length; v++) {
            const viss = new ISTRINGSTREAM(aLines[i]!);
            const sv: SPECIAL_VARIANT = { decal_name: '', pin_type: '', net_suffix: '' };
            sv.decal_name = viss.readString(sv.decal_name);
            sv.pin_type = viss.readString(sv.pin_type);

            const rest = viss.str();

            if (rest !== null) sv.net_suffix = rest;

            pt.special_variants.push(sv);
            i++;
          }
        }
      } else if (i < aLines.length) {
        if (isSpecial) {
          if (pt.name === '$GND_SYMS') pt.special_keyword = 'GND';
          else if (pt.name === '$PWR_SYMS') pt.special_keyword = 'PWR';
          else pt.special_keyword = 'OSR';
        }

        // Standard parts have GATE, CONN, or V5.2 G: blocks
        while (i < aLines.length) {
          const gline = aLines[i]!;

          if (gline === '') {
            // Blank line ends this parttype entry
            break;
          }

          if (this.isSectionMarker(gline)) break;

          const giss = new ISTRINGSTREAM(gline);
          const keyword = giss.readString();

          if (keyword === 'GATE') {
            const gate = new GATE_DEF();
            gate.num_decal_variants = giss.readInt(gate.num_decal_variants);
            gate.num_pins = giss.readInt(gate.num_pins);
            gate.swap_flag = giss.readInt(gate.swap_flag);
            i++;

            // Decal name lines
            for (let d = 0; d < gate.num_decal_variants && i < aLines.length; d++) {
              if (aLines[i] === '' || this.isSectionMarker(aLines[i]!)) break;

              gate.decal_names.push(aLines[i]!);
              i++;
            }

            // Pin definition lines
            for (let p = 0; p < gate.num_pins && i < aLines.length; p++) {
              if (aLines[i] === '' || this.isSectionMarker(aLines[i]!)) break;

              gate.pins.push(PADS_SCH_PARSER.parsePartTypePin(aLines[i]!, true));
              i++;
            }

            pt.gates.push(gate);
            continue;
          } else if (keyword.length >= 3 && keyword[0] === 'G' && keyword[1] === ':') {
            // V5.2 gate format: G:decal1[:decal2:...] swap_flag num_pins
            // Pin lines use dot-separated fields with multiple pins per line.
            if (pt.category === 'CON') pt.is_connector = true;

            const gate = new GATE_DEF();

            for (const decalName of getlineTokens(keyword.substring(2), ':')) {
              if (decalName !== '') gate.decal_names.push(decalName);
            }

            gate.num_decal_variants = gate.decal_names.length;
            gate.swap_flag = giss.readInt(gate.swap_flag);
            gate.num_pins = giss.readInt(gate.num_pins);
            i++;

            let pinsRead = 0;

            while (pinsRead < gate.num_pins && i < aLines.length) {
              const pline = aLines[i]!;

              if (pline === '' || this.isSectionMarker(pline)) break;

              if (
                (pline[0] === 'G' && pline.length >= 2 && pline[1] === ':') ||
                pline.startsWith('SIGPIN')
              )
                break;

              const piss = new ISTRINGSTREAM(pline);

              // `while( piss >> pinToken && pinsRead < gate.num_pins )`: the token is read
              // before the count is tested.
              for (
                let pinToken = piss.str();
                pinToken !== null && pinsRead < gate.num_pins;
                pinToken = piss.str()
              ) {
                const pin = new PARTTYPE_PIN();
                const fields = getlineTokens(pinToken, '.');

                if (fields.length >= 1) pin.pin_id = fields[0]!;

                if (fields.length >= 2) pin.swap_group = ParseInt(fields[1]!, 0, 'V5.2 pin');

                if (fields.length >= 3 && fields[2] !== '') pin.pin_type = fields[2]![0]!;

                if (fields.length >= 4) pin.pin_name = fields[3]!;

                gate.pins.push(pin);
                pinsRead++;
              }

              i++;
            }

            if (isSpecial) {
              const sv: SPECIAL_VARIANT = {
                decal_name: gate.decal_names.length === 0 ? '' : gate.decal_names[0]!,
                pin_type: gate.pins.length > 0 ? gate.pins[0]!.pin_type : '',
                net_suffix: '',
              };

              pt.special_variants.push(sv);
            }

            pt.gates.push(gate);
            continue;
          } else if (keyword === 'CONN') {
            pt.is_connector = true;
            const gate = new GATE_DEF();
            gate.num_decal_variants = giss.readInt(gate.num_decal_variants);
            const numPins = giss.readInt(0);
            gate.num_pins = numPins;
            i++;

            // Decal name + pin_type lines
            for (let d = 0; d < gate.num_decal_variants && i < aLines.length; d++) {
              if (aLines[i] === '' || this.isSectionMarker(aLines[i]!)) break;

              const diss = new ISTRINGSTREAM(aLines[i]!);
              gate.decal_names.push(diss.readString());
              i++;
            }

            // Pin definition lines
            for (let p = 0; p < numPins && i < aLines.length; p++) {
              if (aLines[i] === '' || this.isSectionMarker(aLines[i]!)) break;

              gate.pins.push(PADS_SCH_PARSER.parsePartTypePin(aLines[i]!, false));
              i++;
            }

            pt.gates.push(gate);
            continue;
          } else if (keyword === 'SIGPIN') {
            const sp: SIGPIN = { pin_number: '', net_name: '' };
            const token = giss.readString();

            // V5.2 uses dot-separated fields (e.g. "1.50.DGND") while
            // V9.0+ uses space-separated "pin_number net_name".
            if (token.includes('.')) {
              const fields = getlineTokens(token, '.');

              if (fields.length >= 1) sp.pin_number = fields[0]!;

              if (fields.length >= 3) sp.net_name = fields[fields.length - 1]!;
            } else {
              sp.pin_number = token;
              sp.net_name = giss.readString(sp.net_name);
            }

            pt.sigpins.push(sp);
            i++;
            continue;
          } else {
            // Swap group line or unknown, store and continue
            pt.swap_lines.push(gline);
            i++;
            continue;
          }
        }
      }

      this.m_partTypes.set(pt.name, pt);
    }

    return aLines.length - 1;
  }

  private parseSectionPART(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    // Skip blank lines after header
    while (i < aLines.length && aLines[i] === '') i++;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Part header starts with reference designator (alpha character)
      if (isalpha(line[0])) {
        const part = new PART_PLACEMENT();
        i = this.parsePartPlacement(aLines, i, part);

        if (part.reference !== '') {
          part.sheet_number = this.m_currentSheet;
          this.m_partPlacements.push(part);
        }

        i++;
        continue;
      }

      i++;
    }

    return aLines.length - 1;
  }

  private parsePartPlacement(aLines: string[], aStartLine: number, aPart: PART_PLACEMENT): number {
    if (aStartLine >= aLines.length) return aStartLine;

    const headerLine = aLines[aStartLine]!;
    const iss = new ISTRINGSTREAM(headerLine);

    // Two PART header formats:
    //   Normal:  ref part_type x y angle mirror h1 w1 h2 w2 attrs disp pins u1 gate u2
    //   Power:   ref net_name $part_type x y angle mirror variant_index
    // Detect power format by checking whether the third token is numeric.
    let x = 0;
    let y = 0;
    let angleCode = 0;
    let mirrorFlag = 0;

    const refdes = iss.readString();
    let partType = iss.readString();

    x = iss.readInt(x);

    if (iss.fail()) {
      // Third field is not a number (e.g. "$PWR_SYMS"), so this is a power symbol entry.
      iss.clear();
      const actualPartType = iss.readString();
      x = iss.readInt(x);
      y = iss.readInt(y);
      angleCode = iss.readInt(angleCode);
      mirrorFlag = iss.readInt(mirrorFlag);

      aPart.power_net_name = partType;
      partType = actualPartType;
    } else {
      y = iss.readInt(y);
      angleCode = iss.readInt(angleCode);
      mirrorFlag = iss.readInt(mirrorFlag);
    }

    aPart.reference = refdes;
    aPart.part_type = partType;
    aPart.symbol_name = partType;
    aPart.position = { x, y };

    switch (angleCode) {
      case 0:
        aPart.rotation = 0.0;
        break;
      case 1:
        aPart.rotation = 90.0;
        break;
      case 2:
        aPart.rotation = 180.0;
        break;
      case 3:
        aPart.rotation = 270.0;
        break;
      default:
        aPart.rotation = angleCode;
        break;
    }

    aPart.mirror_flags = mirrorFlag;

    if (aPart.power_net_name !== '') {
      // Power symbol: remaining field is the variant index
      const variantIdx = iss.readInt(0);

      if (!iss.fail()) aPart.gate_index = variantIdx;
    } else {
      // Try to read remaining header fields for normal parts
      const h1 = iss.readInt(aPart.h1);
      const w1 = iss.readInt(aPart.w1);
      const h2 = iss.readInt(aPart.h2);
      const w2 = iss.readInt(aPart.w2);
      // `iss >> aPart.h1 >> …`: each member is written as it is extracted, even on failure.
      aPart.h1 = h1;
      aPart.w1 = w1;
      aPart.h2 = h2;
      aPart.w2 = w2;
      const numAttrs = iss.readInt(0);
      const numDisplayedValues = iss.readInt(0);
      const numPins = iss.readInt(0);
      iss.readInt(0); // unused1
      const gateIdx = iss.readInt(0);
      iss.readInt(0); // unused2

      if (!iss.fail()) {
        aPart.num_attrs = numAttrs;
        aPart.num_displayed_values = numDisplayedValues;
        aPart.num_pins = numPins;
        aPart.gate_index = gateIdx;
        aPart.gate_number = gateIdx + 1;
      } else {
        // Simplified test format: ref part_type x y angle mirror sheet gate
        const iss2 = new ISTRINGSTREAM(headerLine);
        iss2.readString();
        iss2.readString();
        x = iss2.readInt(x);
        y = iss2.readInt(y);

        aPart.rotation = iss2.readDouble(0);

        const mirrorStr = iss2.str();

        if (mirrorStr !== null) {
          if (mirrorStr === 'M' || mirrorStr === 'Y' || mirrorStr === '1') aPart.mirror_flags = 1;
        }

        aPart.sheet_number = iss2.readInt(aPart.sheet_number);
        aPart.gate_number = iss2.readInt(aPart.gate_number);
      }
    }

    // Extract gate index from reference designator suffix. PADS multi-gate components
    // use "REFDES-LETTER" or "REFDES.LETTER" (e.g., U17-A, U1.B).
    let sepPos = refdes.lastIndexOf('-');

    if (sepPos === -1) sepPos = refdes.lastIndexOf('.');

    if (sepPos !== -1 && sepPos + 1 < refdes.length) {
      const gateLetter = refdes[sepPos + 1]!;

      if (isalpha(gateLetter)) {
        // Only derive gate index from the letter when the header didn't provide one
        if (aPart.gate_index === 0) {
          aPart.gate_index = gateLetter.toUpperCase().charCodeAt(0) - 65;
          aPart.gate_number = aPart.gate_index + 1;
        }
      }
    }

    let i = aStartLine + 1;

    // If full format, parse font lines, attribute labels, overrides, and pin overrides
    if (aPart.num_attrs > 0 || aPart.num_displayed_values > 0) {
      // Two font lines
      for (const which of ['font1', 'font2'] as const) {
        if (i < aLines.length) {
          const fl = aLines[i]!;

          if (fl.length >= 2 && fl[0] === '"') {
            const qEnd = fl.indexOf('"', 1);

            if (qEnd !== -1) aPart[which] = fl.substring(1, qEnd);

            i++;
          }
        }
      }

      // Attribute label pairs (num_attrs pairs)
      for (let a = 0; a < aPart.num_attrs && i + 1 < aLines.length; a++) {
        const attr = new PART_ATTRIBUTE();
        const aiss = new ISTRINGSTREAM(aLines[i]!);

        const ax = aiss.readInt(0);
        const ay = aiss.readInt(0);
        const angle = aiss.readInt(0);
        const disp = aiss.readInt(0);
        const h = aiss.readInt(0);
        const w = aiss.readInt(0);
        const vis = aiss.readInt(0);

        attr.position = { x: ax, y: ay };
        attr.rotation = angle;
        attr.justification = disp;
        attr.height = h;
        attr.width = w;
        attr.size = h;
        attr.visibility = vis;
        attr.visible = vis === 0;

        // Parse quoted font name
        const q = quoted(aiss.getline());

        if (q !== null) attr.font_name = q;

        i++;

        if (i < aLines.length) attr.name = aLines[i]!;

        aPart.attributes.push(attr);
        i++;
      }

      // Displayed value overrides: each has a position line then a "name" value line
      for (let d = 0; d < aPart.num_displayed_values && i < aLines.length; d++) {
        // Skip the position/formatting line (starts with digit)
        if (aLines[i] !== '' && isdigit(aLines[i]![0])) i++;

        if (i >= aLines.length) break;

        const valLine = aLines[i]!;

        if (valLine.length > 2 && valLine[0] === '"') {
          const closeQ = valLine.indexOf('"', 1);

          if (closeQ !== -1) {
            const attrName = valLine.substring(1, closeQ);
            let attrValue = '';

            if (closeQ + 1 < valLine.length)
              attrValue = trimLeadingBlanks(valLine.substring(closeQ + 1));

            aPart.attr_overrides.set(attrName, attrValue);
          }
        }

        i++;
      }

      // Apply overrides back to the attribute vector so attr.value is populated
      for (const attr of aPart.attributes) {
        const v = aPart.attr_overrides.get(attr.name);

        if (v !== undefined) attr.value = v;
      }

      // Pin override lines
      while (i < aLines.length) {
        const pline = aLines[i]!;

        if (pline === '') break;

        if (this.isSectionMarker(pline)) return i - 1;

        // New part (alpha at start)
        if (isalpha(pline[0])) return i - 1;

        // Pin override: index height width angle justification
        if (isdigit(pline[0])) {
          const poiss = new ISTRINGSTREAM(pline);
          poiss.readInt(0);
          const po: PIN_OVERRIDE = { height: 0, width: 0, angle: 0, justification: 0 };
          po.height = poiss.readInt(po.height);
          po.width = poiss.readInt(po.width);
          po.angle = poiss.readInt(po.angle);
          po.justification = poiss.readInt(po.justification);
          aPart.pin_overrides.push(po);
        }

        i++;
      }
    } else {
      // Simplified test format: @-prefixed attribute lines
      while (i < aLines.length) {
        const attrLine = aLines[i]!;

        if (attrLine === '') break;

        if (this.isSectionMarker(attrLine)) return i - 1;

        if (attrLine[0] === '@') {
          const attr = new PART_ATTRIBUTE();
          const aiss = new ISTRINGSTREAM(attrLine.substring(1));
          attr.name = aiss.readString(attr.name);

          let rest = aiss.getline();
          const start = rest.search(/[^ \t]/);

          if (start !== -1) {
            rest = rest.substring(start);

            if (rest !== '' && rest[0] === '"') {
              const endQuote = rest.indexOf('"', 1);

              if (endQuote !== -1) {
                attr.value = rest.substring(1, endQuote);
                rest = rest.substring(endQuote + 1);
              }
            } else {
              const viss = new ISTRINGSTREAM(rest);
              attr.value = viss.readString(attr.value);
              rest = viss.getline(rest);
            }

            const piss = new ISTRINGSTREAM(rest);
            attr.position.x = piss.readDouble(attr.position.x);
            attr.position.y = piss.readDouble(attr.position.y);
            attr.rotation = piss.readDouble(attr.rotation);
            attr.size = piss.readDouble(attr.size);

            const visStr = piss.str();

            if (visStr !== null) attr.visible = visStr !== 'N' && visStr !== '0' && visStr !== 'H';
          }

          aPart.attributes.push(attr);
          i++;
        } else if (isalpha(attrLine[0])) {
          return i - 1;
        } else {
          i++;
        }
      }
    }

    return i - 1;
  }

  private parseSectionOFFPAGEREFS(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Format: @@@O<id>    net_name symbol_lib x y rotation flags1 flags2
      if (line.startsWith('@@@O')) {
        const opc = new OFF_PAGE_CONNECTOR();
        const iss = new ISTRINGSTREAM(line);
        const idToken = iss.readString();

        // Extract numeric ID from @@@O<id>
        if (idToken.length > 4) opc.id = ParseInt(idToken.substring(4), 0, 'OPC id');

        opc.signal_name = iss.readString(opc.signal_name);
        opc.symbol_lib = iss.readString(opc.symbol_lib);
        const x = iss.readInt(0);
        const y = iss.readInt(0);
        opc.rotation = iss.readInt(opc.rotation);
        opc.flags1 = iss.readInt(opc.flags1);
        opc.flags2 = iss.readInt(opc.flags2);

        opc.position = { x, y };
        opc.source_sheet = this.m_currentSheet;

        this.m_offPageConnectors.push(opc);
      }

      i++;
    }

    return aLines.length - 1;
  }

  private parseSectionTIEDOTS(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Format: @@@D<id>    x y
      if (line.startsWith('@@@D')) {
        const dot = new TIED_DOT();
        const iss = new ISTRINGSTREAM(line);
        const idToken = iss.readString();

        if (idToken.length > 4) dot.id = ParseInt(idToken.substring(4), 0, 'TIEDOT id');

        const x = iss.readInt(0);
        const y = iss.readInt(0);
        dot.position = { x, y };
        dot.sheet_number = this.m_currentSheet;

        this.m_tiedDots.push(dot);
      }

      i++;
    }

    return aLines.length - 1;
  }

  private parseSectionCONNECTION(aLines: string[], aStartLine: number): number {
    // *CONNECTION* is the section marker. *SIGNAL* blocks follow within.
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      // A non-SIGNAL section marker ends the CONNECTION section
      if (this.isSectionMarker(line)) {
        const secName = this.extractSectionName(line);

        if (secName === 'SIGNAL') {
          const signal = new SCH_SIGNAL();
          i = this.parseSignalDef(aLines, i, signal);

          if (signal.name !== '') {
            // Set sheet number on all wire segments
            for (const wire of signal.wires) wire.sheet_number = this.m_currentSheet;

            // Build connections from endpoint references
            for (const wire of signal.wires) {
              for (const ep of [wire.endpoint_a, wire.endpoint_b]) {
                if (ep.includes('.') && !ep.includes('@@@')) {
                  const dotPos = ep.indexOf('.');
                  const conn: PIN_CONNECTION = {
                    reference: ep.substring(0, dotPos),
                    pin_number: ep.substring(dotPos + 1),
                    sheet_number: this.m_currentSheet,
                  };

                  // Avoid duplicates
                  const found = signal.connections.some(
                    (existing) =>
                      existing.reference === conn.reference &&
                      existing.pin_number === conn.pin_number,
                  );

                  if (!found) signal.connections.push(conn);
                }
              }
            }

            this.m_signals.push(signal);
          }

          i++;
          continue;
        }

        return i - 1;
      }

      i++;
    }

    return aLines.length - 1;
  }

  private parseSignalDef(aLines: string[], aStartLine: number, aSignal: SCH_SIGNAL): number {
    if (aStartLine >= aLines.length) return aStartLine;

    // Header: *SIGNAL* net_name flags1 flags2
    const headerLine = aLines[aStartLine]!;

    if (this.extractSectionName(headerLine) !== 'SIGNAL') return aStartLine;

    // Extract everything after *SIGNAL*
    const afterMarker = headerLine.indexOf('*', 1);

    if (afterMarker === -1) return aStartLine;

    const iss = new ISTRINGSTREAM(headerLine.substring(afterMarker + 1));

    aSignal.name = iss.readString(aSignal.name);
    aSignal.flags1 = iss.readInt(aSignal.flags1);
    aSignal.flags2 = iss.readInt(aSignal.flags2);

    let i = aStartLine + 1;

    // Optional FUNCTION line
    if (aSignal.flags2 === 1 && i < aLines.length) {
      const funcLine = aLines[i]!;

      if (funcLine.includes('"FUNCTION"') || funcLine.startsWith('FUNCTION')) {
        const qStart = funcLine.indexOf('"');

        if (qStart !== -1) {
          const qEnd = funcLine.indexOf('"', qStart + 1);

          if (qEnd !== -1) {
            const afterQ = funcLine.substring(qEnd + 1).search(/[^ \t]/);

            if (afterQ !== -1) aSignal.function = funcLine.substring(qEnd + 1 + afterQ);
          }
        }

        i++;
      }
    }

    // Wire segments: endpoint_a endpoint_b vertex_count flags
    //                x1 y1
    //                x2 y2 ...
    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Wire segment header line: endpoint_a endpoint_b vertex_count flags
      const wire = new WIRE_SEGMENT();
      const wiss = new ISTRINGSTREAM(line);
      wire.endpoint_a = wiss.readString(wire.endpoint_a);
      wire.endpoint_b = wiss.readString(wire.endpoint_b);
      wire.vertex_count = wiss.readInt(wire.vertex_count);
      wire.flags = wiss.readInt(wire.flags);

      if (wire.endpoint_a === '' || wire.endpoint_b === '') {
        i++;
        continue;
      }

      i++;

      // Read vertex coordinates
      for (let v = 0; v < wire.vertex_count && i < aLines.length; v++) {
        const ptLine = aLines[i]!;

        if (ptLine === '' || this.isSectionMarker(ptLine)) break;

        const piss = new ISTRINGSTREAM(ptLine);
        const pt: POINT = { x: 0, y: 0 };
        pt.x = piss.readDouble(pt.x);
        pt.y = piss.readDouble(pt.y);
        wire.vertices.push(pt);
        i++;
      }

      // Set start/end from first/last vertex for backward compat
      if (wire.vertices.length > 0) {
        wire.start = wire.vertices[0]!;
        wire.end = wire.vertices[wire.vertices.length - 1]!;
      }

      aSignal.wires.push(wire);
    }

    return i > 0 ? i - 1 : aStartLine;
  }

  private parseSectionNETNAMES(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;

    while (i < aLines.length) {
      const line = aLines[i]!;

      if (line === '') {
        i++;
        continue;
      }

      if (this.isSectionMarker(line)) return i - 1;

      // Format: net_name anchor_ref x_offset y_offset rotation justification f3 f4 f5 f6 f7
      //         height width_pct "font_name"
      const label = new NETNAME_LABEL();
      const iss = new ISTRINGSTREAM(line);

      label.net_name = iss.readString(label.net_name);
      label.anchor_ref = iss.readString(label.anchor_ref);
      for (const k of [
        'x_offset',
        'y_offset',
        'rotation',
        'justification',
        'f3',
        'f4',
        'f5',
        'f6',
        'f7',
        'height',
        'width_pct',
      ] as const)
        label[k] = iss.readInt(label[k]);

      // Parse quoted font name
      const q = quoted(iss.getline());

      if (q !== null) label.font_name = q;

      this.m_netNameLabels.push(label);
      i++;
    }

    return aLines.length - 1;
  }

  private skipBraceDelimitedSection(aLines: string[], aStartLine: number): number {
    let i = aStartLine + 1;
    let braceDepth = 0;
    let foundFirstBrace = false;

    while (i < aLines.length) {
      const line = aLines[i]!;

      for (const c of line) {
        if (c === '{') {
          braceDepth++;
          foundFirstBrace = true;
        } else if (c === '}') {
          braceDepth--;
        }
      }

      if (foundFirstBrace && braceDepth <= 0) return i;

      // If we hit another section marker without finding any braces, this section was empty
      if (!foundFirstBrace && this.isSectionMarker(line)) return i - 1;

      i++;
    }

    return aLines.length - 1;
  }

  GetSymbolDef(aName: string): SYMBOL_DEF | null {
    return this.m_symbolDefs.find((sym) => sym.name === aName) ?? null;
  }

  GetPartPlacement(aReference: string): PART_PLACEMENT | null {
    return this.m_partPlacements.find((part) => part.reference === aReference) ?? null;
  }

  GetSignal(aName: string): SCH_SIGNAL | null {
    return this.m_signals.find((signal) => signal.name === aName) ?? null;
  }

  GetSheetCount(): number {
    const sheets = this.GetSheetNumbers();

    if (sheets.length === 0) return 1;

    return sheets[sheets.length - 1]!;
  }

  /** `std::set<int>`: ascending. */
  GetSheetNumbers(): number[] {
    const sheets = new Set<number>();

    for (const header of this.m_sheetHeaders) sheets.add(header.sheet_num);

    for (const part of this.m_partPlacements) sheets.add(part.sheet_number);

    for (const signal of this.m_signals) {
      for (const wire of signal.wires) sheets.add(wire.sheet_number);

      for (const conn of signal.connections) sheets.add(conn.sheet_number);
    }

    if (sheets.size === 0) sheets.add(1);

    return [...sheets].sort((a, b) => a - b);
  }

  GetSignalsOnSheet(aSheetNumber: number): SCH_SIGNAL[] {
    const result: SCH_SIGNAL[] = [];

    for (const signal of this.m_signals) {
      const filteredSignal = new SCH_SIGNAL();
      filteredSignal.name = signal.name;

      for (const wire of signal.wires) {
        if (wire.sheet_number === aSheetNumber) filteredSignal.wires.push(wire);
      }

      for (const conn of signal.connections) {
        if (conn.sheet_number === aSheetNumber) filteredSignal.connections.push(conn);
      }

      if (filteredSignal.wires.length > 0 || filteredSignal.connections.length > 0)
        result.push(filteredSignal);
    }

    return result;
  }

  GetPartsOnSheet(aSheetNumber: number): PART_PLACEMENT[] {
    return this.m_partPlacements.filter((part) => part.sheet_number === aSheetNumber);
  }

  private parsePinType(aTypeStr: string): PIN_TYPE {
    const upper = aTypeStr.toUpperCase();

    if (upper === 'I' || upper === 'IN' || upper === 'INPUT' || upper === 'L')
      return PIN_TYPE.INPUT;

    if (upper === 'O' || upper === 'OUT' || upper === 'OUTPUT' || upper === 'S')
      return PIN_TYPE.OUTPUT;

    if (upper === 'B' || upper === 'BI' || upper === 'BIDIR' || upper === 'BIDIRECTIONAL')
      return PIN_TYPE.BIDIRECTIONAL;

    if (upper === 'T' || upper === 'TRI' || upper === 'TRISTATE') return PIN_TYPE.TRISTATE;

    if (upper === 'OC' || upper === 'OPENCOLLECTOR') return PIN_TYPE.OPEN_COLLECTOR;

    if (upper === 'OE' || upper === 'OPENEMITTER') return PIN_TYPE.OPEN_EMITTER;

    if (upper === 'P' || upper === 'PWR' || upper === 'POWER' || upper === 'G')
      return PIN_TYPE.POWER;

    if (upper === 'PAS' || upper === 'PASSIVE') return PIN_TYPE.PASSIVE;

    return PIN_TYPE.UNSPECIFIED;
  }

  static ParsePinTypeChar(aTypeChar: string): PIN_TYPE {
    switch (aTypeChar.toUpperCase()) {
      case 'L':
        return PIN_TYPE.INPUT;
      case 'S':
        return PIN_TYPE.OUTPUT;
      case 'B':
        return PIN_TYPE.BIDIRECTIONAL;
      case 'P':
        return PIN_TYPE.POWER;
      case 'G':
        return PIN_TYPE.POWER;
      default:
        return PIN_TYPE.UNSPECIFIED;
    }
  }
}
