// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/eagle/sch_io_eagle.cpp` / `.h`: `SCH_IO_EAGLE`, the EAGLE XML
 * schematic (`.sch`) and library (`.lbr`) importer, over the EAGLE DOM in
 * common/io/eagle/eagle_parser.ts. Every Eagle page becomes a top-level sheet;
 * the symbols go into `<project>-eagle-import.kicad_sym`, added to the project
 * sym-lib-table.
 *
 * Eagle schematic axes are aligned with x increasing left to right and Y increasing
 * bottom to top. KiCad schematic axes are aligned with x increasing left to right and
 * Y increasing top to bottom.
 *
 * Two things KiCad's C++ decides by its types, kept here on purpose:
 * - `std::map` iterates in key order, so every DOM map is walked sorted (code point);
 * - `VECTOR2::operator<` compares squared lengths, not coordinates (vector2d.h:578), and
 *   `std::sort` / `std::binary_search` with no comparator use it: the wire-intersection
 *   search treats two different points of the same length as the same point
 *   (`lengthKey`). A `std::map<VECTOR2I, …>` does NOT: `std::less<VECTOR2I>` is
 *   specialised to x-then-y (vector2.cpp:22), so the connection points key by the point.
 *
 * Not ported: `FONTCONFIG_REPORTER_SCOPE` (font substitution warnings) and the
 * progress reporter's phase count.
 */
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  ConvertArcCenter,
  ConvertEagleTextSize,
  convertDescription,
  EAGLE_DOC,
  EATTR,
  type ECIRCLE,
  type EDEVICE,
  type EDRAWING,
  type EFRAME,
  type EINSTANCE,
  type EJUNCTION,
  type ELABEL,
  type ELAYER,
  type ELIBRARY,
  type EMODULE,
  type EMODULEINST,
  type EPART,
  type EPIN,
  type EPOLYGON,
  type EPORT,
  type ERECT,
  type ESCHEMATIC,
  type ESEGMENT,
  type ESHEET,
  type ESYMBOL,
  ETEXT,
  EWIRE,
  escapeName,
  interpretText,
} from '@ziroeda/common/io/eagle/eagle_parser.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { IGNORE_PARENT_GROUP } from '@ziroeda/common/eda_item.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import { RPT_SEVERITY_ERROR } from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import {
  ESCAPE_CONTEXT,
  EscapeString,
  ReplaceIllegalFileNameChars,
  UnescapeHTML,
  unescapeString,
  wxSplit,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import {
  KiCadSchematicFileExtension,
  KiCadSymbolLibFileExtension,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxXmlDocumentLoad, wxXmlParseError, type wxXmlNode } from '@ziroeda/common/wx/xml.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_VERTICAL, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { ResizeI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { ERC_ITEM } from '../../erc/erc_item.js';
import { ERCE_T } from '../../erc/erc_settings.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SymbolLibAdapter } from '../../project_sch.js';
import { SCH_BUS_WIRE_ENTRY } from '../../sch_bus_entry.js';
import { SCH_FIELD } from '../../sch_field.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from '../../sch_item.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import {
  LABEL_FLAG_SHAPE,
  LABEL_SHAPE,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_MARKER } from '../../sch_marker.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SCREEN, SCH_SCREENS } from '../../sch_screen.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PATH, SCH_SYMBOL_VARIANT } from '../../sch_sheet_path.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../../sch_sheet_pin.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { SCH_IO_KICAD_SEXPR } from '../kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';

export interface EAGLE_LIBRARY {
  name: string;
  KiCadSymbols: Map<string, LIB_SYMBOL>;

  /**
   * Map Eagle gate unit number (which are stored as strings) to KiCad library symbol
   * unit number.  The lookup string is constructed from the deviceset name + the device
   * name + gate name.
   */
  GateToUnitMap: Map<string, number>;
  package: Map<string, string>;
}

/** `DEFAULT_SCH_ENTRY_SIZE` (sch_bus_entry.h): mils. */
const DEFAULT_SCH_ENTRY_SIZE = 100;

/** `SCH_IU_PER_MM`. */
const SCH_IU_PER_MM = 1e4;

/** Map of EAGLE pin type values to KiCad pin type values (a std::map: key order). */
const pinDirectionsMap: readonly [string, ELECTRICAL_PINTYPE][] = [
  ['hiz', ELECTRICAL_PINTYPE.PT_TRISTATE],
  ['in', ELECTRICAL_PINTYPE.PT_INPUT],
  ['io', ELECTRICAL_PINTYPE.PT_BIDI],
  ['nc', ELECTRICAL_PINTYPE.PT_NC],
  ['oc', ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR],
  ['out', ELECTRICAL_PINTYPE.PT_OUTPUT],
  ['pas', ELECTRICAL_PINTYPE.PT_PASSIVE],
  ['pwr', ELECTRICAL_PINTYPE.PT_POWER_IN],
  ['sup', ELECTRICAL_PINTYPE.PT_POWER_IN],
];

/** `std::map<wxString, …>` walked in key order. */
function sortedByKey<T>(aMap: ReadonlyMap<string, T>): [string, T][] {
  return [...aMap].sort(([a], [b]) => codePointCompare(a, b));
}

/** `wxString` (UTF-32 on Linux) ordering. */
function codePointCompare(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i]!.codePointAt(0)!;
    const y = cb[i]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}

/**
 * `VECTOR2I` as a `std::sort` / `std::binary_search` element: `operator<` compares
 * `*this * *this` (vector2d.h:578), so equality is equal squared length.
 */
const lengthKey = (p: VECTOR2I): number => p.x * p.x + p.y * p.y;

/** `VECTOR2I` as a `std::map` key: `std::less<VECTOR2I>` is x then y, the point itself. */
const pointKey = (p: VECTOR2I): string => `${p.x},${p.y}`;

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const eqPt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `wxString::Trim( true ).Trim( false )`: isspace both ends. */
const wxTrim = (s: string): string => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');

/**
 * `wxStringTokenizer( text, "\r\n" )`: both delimiters are whitespace, so the default
 * mode is wxTOKEN_STRTOK and empty tokens are never returned.
 */
const tokenizeLines = (s: string): string[] => s.split(/[\r\n]/).filter((t) => t !== '');

/** The lines of an Eagle text, each trimmed and interpreted, joined by '\n'. */
function adjustText(aEagleText: string): string {
  const tokens = tokenizeLines(aEagleText);
  let adjustedText = '';

  for (let i = 0; i < tokens.length; i++) {
    let tmp = interpretText(wxTrim(tokens[i]!));

    if (i < tokens.length - 1) tmp += '\n';

    adjustedText += tmp;
  }

  return adjustedText;
}

///< Compute a bounding box for all items in a schematic sheet
function getSheetBbox(aSheet: SCH_SHEET): BOX2I {
  const bbox = new BOX2I();

  for (const item of aSheet.GetScreen()!.Items()) bbox.Merge(item.GetBoundingBox());

  return bbox;
}

///< Strip the Eagle "@<tag>" linking hint from a pin name (e.g. return 'GND' for 'GND@2')
function extractNetName(aPinName: string): string {
  const i = aPinName.indexOf('@');
  return i < 0 ? aPinName : aPinName.slice(0, i);
}

// Return the KiCad symbol orientation based on eagle rotation degrees.
function kiCadComponentRotation(eagleDegrees: number): SYMBOL_ORIENTATION_T {
  const roti = Math.trunc(eagleDegrees);

  switch (roti) {
    case 0:
      return SYMBOL_ORIENTATION_T.SYM_ORIENT_0;
    case 90:
      return SYMBOL_ORIENTATION_T.SYM_ORIENT_90;
    case 180:
      return SYMBOL_ORIENTATION_T.SYM_ORIENT_180;
    case 270:
      return SYMBOL_ORIENTATION_T.SYM_ORIENT_270;

    default:
      return SYMBOL_ORIENTATION_T.SYM_ORIENT_0;
  }
}

// Calculate text alignment based on the given Eagle text alignment parameters.
function eagleToKicadAlignment(
  aText: SCH_FIELD | SCH_TEXT,
  aEagleAlignment: number,
  aRelDegress: number,
  aMirror: boolean,
  _aSpin: boolean,
  aAbsDegress: number,
): void {
  let align = aEagleAlignment;

  if (aRelDegress === 90) {
    aText.SetTextAngle(ANGLE_VERTICAL);
  } else if (aRelDegress === 180) {
    align = -align;
  } else if (aRelDegress === 270) {
    aText.SetTextAngle(ANGLE_VERTICAL);
    align = -align;
  }

  if (aMirror === true) {
    if (aAbsDegress === 90 || aAbsDegress === 270) {
      if (align === ETEXT.BOTTOM_RIGHT) align = ETEXT.TOP_RIGHT;
      else if (align === ETEXT.BOTTOM_LEFT) align = ETEXT.TOP_LEFT;
      else if (align === ETEXT.TOP_LEFT) align = ETEXT.BOTTOM_LEFT;
      else if (align === ETEXT.TOP_RIGHT) align = ETEXT.BOTTOM_RIGHT;
    } else if (aAbsDegress === 0 || aAbsDegress === 180) {
      if (align === ETEXT.BOTTOM_RIGHT) align = ETEXT.BOTTOM_LEFT;
      else if (align === ETEXT.BOTTOM_LEFT) align = ETEXT.BOTTOM_RIGHT;
      else if (align === ETEXT.TOP_LEFT) align = ETEXT.TOP_RIGHT;
      else if (align === ETEXT.TOP_RIGHT) align = ETEXT.TOP_LEFT;
      else if (align === ETEXT.CENTER_LEFT) align = ETEXT.CENTER_RIGHT;
      else if (align === ETEXT.CENTER_RIGHT) align = ETEXT.CENTER_LEFT;
    }
  }

  const H = GR_TEXT_H_ALIGN_T;
  const V = GR_TEXT_V_ALIGN_T;

  switch (align) {
    case ETEXT.CENTER:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      break;

    case ETEXT.CENTER_LEFT:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      break;

    case ETEXT.CENTER_RIGHT:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      break;

    case ETEXT.TOP_CENTER:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      break;

    case ETEXT.TOP_LEFT:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      break;

    case ETEXT.TOP_RIGHT:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      break;

    case ETEXT.BOTTOM_CENTER:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      break;

    case ETEXT.BOTTOM_LEFT:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      break;

    case ETEXT.BOTTOM_RIGHT:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      break;

    default:
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      break;
  }
}

/** `wxFileName` pieces of a POSIX path. */
function fileNameParts(aPath: string): { path: string; name: string; ext: string } {
  const slash = aPath.lastIndexOf('/');
  const path = slash < 0 ? '' : aPath.substring(0, slash);
  const base = aPath.substring(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0
    ? { path, name: base, ext: '' }
    : { path, name: base.substring(0, dot), ext: base.substring(dot + 1) };
}

const joinPath = (aDir: string, aFullName: string): string =>
  aDir === '' ? aFullName : `${aDir.replace(/\/+$/, '')}/${aFullName}`;

interface EAGLE_MISSING_CMP {
  cmp: SCH_SYMBOL | null;
  screen: SCH_SCREEN | null;

  /* Map of the symbol units: for each unit there is a flag saying
   * whether the unit needs to be instantiated with appropriate net labels to
   * emulate implicit connections as is done in Eagle.
   */
  units: Map<number, boolean>;
}

/** Segments representing wires for intersection checking. */
class SEG_DESC {
  labels: SCH_LABEL_BASE[] = [];
  segs: SEG[] = [];

  ///< Test if a particular label is attached to any of the stored segments
  LabelAttached(aLabel: SCH_LABEL_BASE): SEG | null {
    const labelPos = aLabel.GetPosition();

    for (const seg of this.segs) {
      if (seg.Contains(labelPos)) return seg;
    }

    return null;
  }
}

export class SCH_IO_EAGLE extends SCH_IO {
  readonly ARC_ACCURACY = KiROUND(SCH_IU_PER_MM * 0.01); // 0.01mm

  private m_missingCmps = new Map<string, EAGLE_MISSING_CMP>();

  private m_rootSheet: SCH_SHEET | null = null; ///< The root sheet of the schematic being loaded
  private m_sheetPath = new SCH_SHEET_PATH(); ///< The current sheet path of the schematic being loaded.
  private m_version = ''; ///< Eagle file version.
  private m_filename = '';
  private m_libName = ''; ///< Library name to save symbols
  private m_schematic: SCHEMATIC | null = null; ///< Passed to Load(), the schematic object being loaded

  private m_modules: EMODULE[] = []; ///< The current module stack being loaded.
  private m_moduleInstances: EMODULEINST[] = [];

  private m_partlist = new Map<string, EPART>();
  private m_timestamps = new Map<string, number>();
  private m_eagleLibs = new Map<string, EAGLE_LIBRARY>();
  private m_userValue = new Map<string, boolean>(); ///< deviceset/@uservalue for device.
  private m_pi: SCH_IO_KICAD_SEXPR | null = null; ///< PI to create KiCad symbol library.
  private m_sheetIndex = 1;
  private m_netCounts = new Map<string, number>();
  private m_layerMap = new Map<number, SCH_LAYER_ID>();
  private m_powerPorts = new Map<string, string>(); ///< map from symbol reference to global label equivalent

  ///< Wire intersection points, used for quick checks whether placing a net label in a
  ///< particular place would short two nets.
  private m_wireIntersections: VECTOR2I[] = [];

  private m_segments: SEG_DESC[] = [];

  ///< Positions of pins and wire endings mapped to its parent
  private m_connPoints = new Map<string, Set<EDA_ITEM | SCH_PIN>>();

  private m_eagleDoc: EAGLE_DOC | null = null;

  constructor() {
    super('EAGLE');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Eagle XML schematic files', ['sch']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Eagle XML library files', ['lbr']);
  }

  override GetModifyHash(): number {
    return 0;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  private getCurrentSheet(): SCH_SHEET | null {
    return this.m_sheetPath.Last();
  }

  private getCurrentScreen(): SCH_SCREEN | null {
    const currentSheet = this.m_sheetPath.Last();

    if (!currentSheet) return null;

    return currentSheet.GetScreen();
  }

  private getLibName(): string {
    if (this.m_libName === '') {
      // Try to come up with a meaningful name
      this.m_libName = this.m_schematic!.Project().GetProjectName();

      if (this.m_libName === '')
        this.m_libName = fileNameParts(this.m_rootSheet!.GetFileName()).name;

      if (this.m_libName === '') this.m_libName = 'noname';

      this.m_libName += '-eagle-import';
      this.m_libName = LIB_ID.FixIllegalChars(this.m_libName, true);
    }

    return this.m_libName;
  }

  private getLibFileName(): string {
    return joinPath(
      this.m_schematic!.Project().GetProjectPath(),
      `${this.getLibName()}.${KiCadSymbolLibFileExtension}`,
    );
  }

  private loadLayerDefs(aLayers: readonly ELAYER[]): void {
    // match layers based on their names
    for (const elayer of aLayers) {
      /**
       * Layers in KiCad schematics are not actually layers, but abstract groups mainly used to
       * decide item colors.
       */
      switch (elayer.number) {
        case 91:
          this.m_layerMap.set(elayer.number, SCH_LAYER_ID.LAYER_WIRE);
          break;
        case 92:
          this.m_layerMap.set(elayer.number, SCH_LAYER_ID.LAYER_BUS);
          break;
        case 97:
        case 98:
          this.m_layerMap.set(elayer.number, SCH_LAYER_ID.LAYER_NOTES);
          break;

        default:
          break;
      }
    }
  }

  private kiCadLayer(aEagleLayer: number): SCH_LAYER_ID {
    return this.m_layerMap.get(aEagleLayer) ?? SCH_LAYER_ID.LAYER_NOTES;
  }

  override LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aAppendToMe: SCH_SHEET | null = null,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): SCH_SHEET {
    this.m_filename = aFileName;
    this.m_schematic = aSchematic;

    if (this.m_progressReporter) {
      this.m_progressReporter.Report(`Loading ${aFileName}...`);

      if (!this.m_progressReporter.KeepRefreshing()) throw new IO_ERROR('Open canceled by user.');
    }

    // Load the document
    const currentNode = this.loadXmlDocument(this.m_filename);

    const fn = fileNameParts(this.m_filename);
    const newFilename = joinPath(fn.path, `${fn.name}.${KiCadSchematicFileExtension}`);

    if (aAppendToMe) {
      if (!aSchematic.IsValid()) throw new IO_ERROR("Can't append to a schematic with no root!");

      this.m_rootSheet = aSchematic.Root();

      // We really should be passing the SCH_SHEET_PATH object to the aAppendToMe attribute
      // instead of the SCH_SHEET.  The full path is needed to properly generate instance
      // data.
      for (const sheetPath of aSchematic.Hierarchy()) {
        if (sheetPath.Last() === aAppendToMe) {
          this.m_sheetPath = sheetPath.Clone();
          break;
        }
      }
    } else {
      // Create a temporary local VR used only to anchor m_sheetPath during loading.
      // loadSchematic() will call SetTopLevelSheets() with the real Eagle pages, which
      // creates the actual schematic VR and re-parents the pages to it.
      this.m_rootSheet = new SCH_SHEET(aSchematic);
      (this.m_rootSheet as { m_Uuid: KIID }).m_Uuid = niluuid;
    }

    if (!this.m_rootSheet.GetScreen()) {
      const screen = new SCH_SCREEN(this.m_schematic);
      screen.SetFileName(newFilename);
      this.m_rootSheet.SetScreen(screen);

      // Virtual root sheet UUID must be nil since all Eagle pages are loaded as subsheets.
      (this.m_rootSheet as { m_Uuid: KIID }).m_Uuid = niluuid;

      // There is always at least a root sheet.
      this.m_sheetPath.push_back(this.m_rootSheet);
    }

    const adapter = SymbolLibAdapter(aSchematic.Project());
    const table = adapter.ProjectTable();

    if (!table) throw new IO_ERROR('Could not load symbol lib table.');

    this.m_pi = new SCH_IO_KICAD_SEXPR();

    /// @note No check is being done here to see if the existing symbol library exists so this
    ///       will overwrite the existing one.
    if (!table.HasRow(this.getLibName())) {
      // Create a new empty symbol library.
      this.m_pi.CreateLibrary(this.getLibFileName());
      const libTableUri = `\${KIPRJMOD}/${fileNameParts(this.getLibFileName()).name}.${KiCadSymbolLibFileExtension}`;

      // Add the new library to the project symbol library table.
      const row = table.InsertRow();
      row.SetNickname(this.getLibName());
      row.SetURI(libTableUri);
      row.SetType('KiCad');

      table.Save();

      adapter.LoadOne(this.getLibName());
    }

    this.m_eagleDoc = new EAGLE_DOC(currentNode, this);

    // If the attribute is found, store the Eagle version;
    // otherwise, store the dummy "0.0" version.
    this.m_version = this.m_eagleDoc.version === '' ? '0.0' : this.m_eagleDoc.version;

    // Load drawing
    this.loadDrawing(this.m_eagleDoc.drawing);

    if (!aAppendToMe) this.m_rootSheet = aSchematic.Root();

    this.m_pi.SaveLibrary(this.getLibFileName());

    // The project library was created empty and then cached by the adapter (LoadOne above)
    // before any symbols were written to it. Reload it from disk now that SaveLibrary has
    // populated the file, otherwise UpdateSymbolLinks resolves against the stale empty cache
    // and every imported symbol is reported as missing.
    adapter.ReloadLibraryEntry(this.getLibName(), LIBRARY_TABLE_SCOPE.PROJECT);

    const allSheets = new SCH_SCREENS(this.m_rootSheet);
    allSheets.UpdateSymbolLinks(null); // Update all symbol library links for all sheets.

    return this.m_rootSheet;
  }

  override EnumerateSymbolLib(
    aSymbolNameList: string[],
    aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.m_filename = aLibraryPath;
    this.m_libName = fileNameParts(this.m_filename).name;

    this.ensureLoadedLibrary(aLibraryPath);

    const lib = this.m_eagleLibs.get(this.m_libName);

    if (lib) {
      for (const [symName] of sortedByKey(lib.KiCadSymbols)) aSymbolNameList.push(symName);
    }
  }

  override EnumerateSymbolLibSymbols(
    aSymbolList: LIB_SYMBOL[],
    aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.m_filename = aLibraryPath;
    this.m_libName = fileNameParts(this.m_filename).name;

    this.ensureLoadedLibrary(aLibraryPath);

    const lib = this.m_eagleLibs.get(this.m_libName);

    if (lib) {
      for (const [, libSymbol] of sortedByKey(lib.KiCadSymbols)) aSymbolList.push(libSymbol);
    }
  }

  override LoadSymbol(
    aLibraryPath: string,
    aAliasName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    this.m_filename = aLibraryPath;
    this.m_libName = fileNameParts(this.m_filename).name;

    this.ensureLoadedLibrary(aLibraryPath);

    return this.m_eagleLibs.get(this.m_libName)?.KiCadSymbols.get(aAliasName) ?? null;
  }

  /** `getLibraryTimestamp`: there is no modification time for bytes handed in; 0. */
  private getLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  private ensureLoadedLibrary(aLibraryPath: string): void {
    if (this.m_eagleLibs.has(this.m_libName)) {
      if (!this.m_timestamps.has(this.m_libName)) return;

      if (this.m_timestamps.get(this.m_libName) === this.getLibraryTimestamp(aLibraryPath)) return;
    }

    if (this.m_progressReporter) {
      this.m_progressReporter.Report(`Loading ${aLibraryPath}...`);

      if (!this.m_progressReporter.KeepRefreshing()) throw new IO_ERROR('Open canceled by user.');
    }

    // Load the document
    const doc = new EAGLE_DOC(this.loadXmlDocument(this.m_filename), this);

    // If the attribute is found, store the Eagle version;
    // otherwise, store the dummy "0.0" version.
    this.m_version = doc.version === '' ? '0.0' : doc.version;

    // Load drawing
    this.loadDrawing(doc.drawing);

    // Remember timestamp
    this.m_timestamps.set(this.m_libName, this.getLibraryTimestamp(aLibraryPath));
  }

  private loadXmlDocument(aFileName: string): wxXmlNode {
    const data = this.m_readFile(aFileName);

    if (!data) throw new IO_ERROR(`Unable to read file '${aFileName}'.`);

    const text = new TextDecoder('utf-8').decode(data);

    // read first line to check for Eagle XML format file
    const line = text.split(/\r\n|\r|\n/, 1)[0] ?? '';

    if (!line.startsWith('<?xml') && !line.startsWith('<!--') && !line.startsWith('<eagle ')) {
      throw new IO_ERROR(
        `'${aFileName}' is an Eagle binary-format file; only Eagle XML-format files can be imported.`,
      );
    }

    try {
      return wxXmlDocumentLoad(text);
    } catch (e) {
      if (!(e instanceof wxXmlParseError)) throw e;

      // Some files don't have the correct header, throwing off the xml parser
      // So prepend the correct header
      const header =
        '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE eagle SYSTEM "eagle.dtd">\n';

      try {
        return wxXmlDocumentLoad(header + text);
      } catch (e2) {
        if (!(e2 instanceof wxXmlParseError)) throw e2;

        throw new IO_ERROR(`Unable to read file '${aFileName}'.`);
      }
    }
  }

  private loadDrawing(aDrawing: EDRAWING | null): void {
    if (!aDrawing) return;

    this.loadLayerDefs(aDrawing.layers);

    if (aDrawing.library) {
      let elib = this.m_eagleLibs.get(this.m_libName);

      if (!elib) {
        elib = newEagleLibrary();
        this.m_eagleLibs.set(this.m_libName, elib);
      }

      elib.name = this.m_libName;

      this.loadLibrary(aDrawing.library, elib);
    }

    if (aDrawing.schematic) this.loadSchematic(aDrawing.schematic);
  }

  private countNets(aSchematic: ESCHEMATIC): void {
    for (const esheet of aSchematic.sheets) {
      for (const enet of esheet.nets) {
        const netName = enet.netname;

        this.m_netCounts.set(netName, (this.m_netCounts.get(netName) ?? 0) + 1);
      }
    }

    for (const [, emodule] of sortedByKey(aSchematic.modules)) {
      for (const esheet of emodule.sheets) {
        for (const enet of esheet.nets) {
          const netName = enet.netname;

          this.m_netCounts.set(netName, (this.m_netCounts.get(netName) ?? 0) + 1);
        }
      }
    }
  }

  private loadSchematic(aSchematic: ESCHEMATIC): void {
    const schematic = this.m_schematic!;

    // Map all children into a readable dictionary
    if (aSchematic.sheets.length === 0) return;

    for (const [name, variantDef] of sortedByKey(aSchematic.variantdefs)) {
      schematic.AddVariant(name);

      if (variantDef.current) schematic.SetCurrentVariant(name);
    }

    // N.B. Eagle parts are case-insensitive in matching but we keep the display case
    for (const [name, epart] of sortedByKey(aSchematic.parts))
      this.m_partlist.set(name.toUpperCase(), epart);

    for (const [, emodule] of sortedByKey(aSchematic.modules)) {
      for (const [partName, epart] of sortedByKey(emodule.parts))
        this.m_partlist.set(partName.toUpperCase(), epart);
    }

    if (aSchematic.libraries.size > 0) {
      for (const [, elibrary] of sortedByKey(aSchematic.libraries)) {
        let elib = this.m_eagleLibs.get(elibrary.GetName());

        if (!elib) {
          elib = newEagleLibrary();
          this.m_eagleLibs.set(elibrary.GetName(), elib);
        }

        elib.name = elibrary.GetName();

        this.loadLibrary(elibrary, elib);
      }

      this.m_pi!.SaveLibrary(this.getLibFileName());
    }

    // Count how many sheets each named net appears on.  Used by the fallback-label path
    // in loadSegments to decide whether to add an extra label on otherwise-unlabelled
    // segments of nets that span multiple sheets.
    this.countNets(aSchematic);

    // Create all Eagle pages as top-level sheets (direct children of the virtual root).
    // Collect them first so we can atomically replace any spurious default sheet created
    // during schematic construction with exactly the set of real Eagle pages.
    const eaglePages: SCH_SHEET[] = [];

    for (const esheet of aSchematic.sheets) {
      // Eagle schematics are never more than one sheet deep so the parent sheet is
      // always the root sheet.
      const sheet = new SCH_SHEET(this.m_rootSheet as unknown as EDA_ITEM);
      const screen = new SCH_SCREEN(schematic);
      sheet.SetScreen(screen);

      const pageNo = `${this.m_sheetIndex}`;

      this.m_sheetPath.push_back(sheet);
      this.loadSheet(esheet);

      this.m_sheetPath.SetPageNumber(pageNo);
      this.m_sheetPath.pop_back();

      eaglePages.push(sheet);

      this.m_sheetIndex++;
    }

    if (eaglePages.length > 0) {
      // In the append path m_rootSheet is already the schematic's VR.  Use
      // AddTopLevelSheet to avoid discarding sheets already in the target.
      // In the fresh-import path m_rootSheet is a temporary local VR, so we use
      // SetTopLevelSheets to atomically replace any spurious default sheet with
      // exactly the Eagle pages.
      if (this.m_rootSheet === schematic.Root()) {
        for (const page of eaglePages) schematic.AddTopLevelSheet(page);
      } else {
        schematic.SetTopLevelSheets(eaglePages);
      }
    }

    // Handle the missing symbol units that need to be instantiated
    // to create the missing implicit connections

    // Calculate the already placed items bounding box and the page size to determine
    // placement for the new symbols
    const schematicRoot = schematic.Root();

    interface MISSING_UNIT_PLACEMENT {
      pageSizeIU: VECTOR2I;
      sheetBbox: BOX2I;
      newCmpPosition: VECTOR2I;
      maxY: number;
      sheetpath: SCH_SHEET_PATH;
      screen: SCH_SCREEN;
    }

    const placements = new Map<SCH_SCREEN, MISSING_UNIT_PLACEMENT>();

    for (const [, cmp] of sortedByKey(this.m_missingCmps)) {
      const origSymbol = cmp.cmp!;

      for (const [unit, needed] of [...cmp.units].sort((a, b) => a[0] - b[0])) {
        if (needed === false) continue; // unit has been already processed

        // Instantiate the missing symbol unit
        const reference = origSymbol.GetField(FIELD_T.REFERENCE)!.GetText();
        const symbol = origSymbol.Duplicate(IGNORE_PARENT_GROUP) as unknown as SCH_SYMBOL;

        let targetScreen = cmp.screen;

        if (!targetScreen) {
          const fallbackSheet = schematic.GetTopLevelSheet(0);

          if (fallbackSheet) targetScreen = fallbackSheet.GetScreen();
          else targetScreen = schematicRoot.GetScreen();
        }

        let placement = placements.get(targetScreen!);

        if (!placement) {
          const sheetpath = new SCH_SHEET_PATH();
          schematicRoot.LocatePathOfScreen(targetScreen!, sheetpath);

          const targetSheet = sheetpath.Last();
          const sheetBbox = targetSheet ? getSheetBbox(targetSheet) : new BOX2I();

          placement = {
            screen: targetScreen!,
            pageSizeIU: targetScreen!.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS),
            sheetpath,
            sheetBbox,
            newCmpPosition: { x: sheetBbox.GetLeft(), y: sheetBbox.GetBottom() },
            maxY: sheetBbox.GetY(),
          };
          placements.set(targetScreen!, placement);
        }

        symbol.SetUnitSelection(placement.sheetpath, unit);
        symbol.SetUnit(unit);
        symbol.SetOrientation(0);
        symbol.AddHierarchicalReference(placement.sheetpath.Path(), reference, unit);

        // Calculate the placement position
        const cmpBbox = symbol.GetBoundingBox();
        const posY = placement.newCmpPosition.y + cmpBbox.GetHeight();
        symbol.SetPosition({ x: placement.newCmpPosition.x, y: posY });
        placement.newCmpPosition.x += cmpBbox.GetWidth();
        placement.maxY = Math.max(placement.maxY, posY);

        if (placement.newCmpPosition.x >= placement.pageSizeIU.x)
          // reached the page boundary?
          placement.newCmpPosition = { x: placement.sheetBbox.GetLeft(), y: placement.maxY }; // then start a new row

        // Add the global net labels to recreate the implicit connections
        this.addImplicitConnections(symbol, placement.screen, false);
        placement.screen.Append(symbol);
      }
    }

    this.m_missingCmps.clear();
  }

  private loadSheet(aSheet: ESHEET): void {
    const sheet = this.getCurrentSheet();
    const screen = this.getCurrentScreen();

    if (!sheet || !screen) return;

    if (this.m_modules.length === 0) {
      let filename = `${fileNameParts(this.m_filename).name}_${this.m_sheetIndex}`;

      if (aSheet.description) sheet.SetName(aSheet.description.text);
      else sheet.SetName(filename);

      filename = ReplaceIllegalFileNameChars(filename);
      filename = filename.replaceAll(' ', '_');

      // Use the project directory so saved pages land alongside the project file,
      // not in the Eagle source directory.
      const fullName = `${filename}.${KiCadSchematicFileExtension}`;

      sheet.SetFileName(fullName);
      screen.SetFileName(joinPath(this.m_schematic!.Project().GetProjectPath(), fullName));
    }

    for (const [, moduleinst] of sortedByKey(aSheet.moduleinsts))
      this.loadModuleInstance(moduleinst);

    sheet.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

    if (aSheet.plain) {
      for (const epoly of aSheet.plain.polygons) screen.Append(this.loadPolyLine(epoly));

      for (const ewire of aSheet.plain.wires) {
        const endpoints = { seg: new SEG() };
        screen.Append(this.loadWire(ewire, endpoints));
      }

      for (const etext of aSheet.plain.texts) screen.Append(this.loadPlainText(etext));

      for (const ecircle of aSheet.plain.circles) screen.Append(this.loadCircle(ecircle));

      for (const erectangle of aSheet.plain.rectangles)
        screen.Append(this.loadRectangle(erectangle));

      for (const eframe of aSheet.plain.frames) {
        const frameItems: SCH_ITEM[] = [];

        this.loadFrame(eframe, frameItems);

        for (const item of frameItems) screen.Append(item);
      }

      // Holes and splines currently not handled.  Not sure hole has any meaning in scheamtics.
    }

    for (const einstance of aSheet.instances)
      this.loadInstance(
        einstance,
        this.m_modules.length > 0
          ? this.m_modules[this.m_modules.length - 1]!.parts
          : this.m_eagleDoc!.drawing!.schematic!.parts,
      );

    // Loop through all buses
    // From the DTD: "Buses receive names which determine which signals they include.
    // A bus is a drawing object. It does not create any electrical connections.
    // These are always created by means of the nets and their names."
    for (const ebus of aSheet.busses) {
      // Get the bus name
      const busName = this.translateEagleBusName(ebus.name);

      // Load segments of this bus
      this.loadSegments(ebus.segments, busName, '', /* aIsBus */ true);
    }

    for (const enet of aSheet.nets) {
      // Get the net name and class
      const netName = enet.netname;
      const netClass = `${enet.netcode}`;

      // Load segments of this net
      this.loadSegments(enet.segments, netName, netClass);
    }

    this.adjustNetLabels(); // needs to be called before addBusEntries()
    this.addBusEntries();

    // Calculate the new sheet size.
    const sheetBoundingBox = getSheetBbox(sheet);
    const bsize = sheetBoundingBox.GetSize();
    const targetSheetSize = {
      x: bsize.x + schIUScale.milsToIU(1500),
      y: bsize.y + schIUScale.milsToIU(1500),
    };

    // Get current Eeschema sheet size.
    let pageSizeIU = screen.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
    const pageInfo = screen.GetPageSettings();

    // Increase if necessary
    if (pageSizeIU.x < targetSheetSize.x)
      pageInfo.SetWidthMils(schIUScale.iuToMils(targetSheetSize.x));

    if (pageSizeIU.y < targetSheetSize.y)
      pageInfo.SetHeightMils(schIUScale.iuToMils(targetSheetSize.y));

    // Set the new sheet size.
    screen.SetPageSettings(pageInfo);

    pageSizeIU = screen.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
    const sheetcentre = { x: Math.trunc(pageSizeIU.x / 2), y: Math.trunc(pageSizeIU.y / 2) };
    const itemsCentre = sheetBoundingBox.Centre();

    // round the translation to nearest 100mil to place it on the grid.
    const translation = sub(sheetcentre, itemsCentre);
    translation.x = translation.x - (translation.x % schIUScale.milsToIU(100));
    translation.y = translation.y - (translation.y % schIUScale.milsToIU(100));

    // Add global net labels for the named power input pins in this sheet
    for (const item of [...screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)]) {
      const symbol = item as unknown as SCH_SYMBOL;
      this.addImplicitConnections(symbol, screen, true);
    }

    this.m_connPoints.clear();

    // Translate the items.
    const allItems: SCH_ITEM[] = [...screen.Items()];

    for (const item of allItems) {
      item.SetPosition(add(item.GetPosition(), translation));

      // We don't read positions of Eagle label fields (primarily intersheet refs), so we
      // need to autoplace them after applying the translation.
      if (isLabel(item))
        (item as unknown as SCH_LABEL_BASE).AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

      item.ClearFlags();
      screen.Update(item);
    }
  }

  private loadModuleInstance(aModuleInstance: EMODULEINST): void {
    const currentSheet = this.getCurrentSheet();
    const currentScreen = this.getCurrentScreen();

    if (!currentSheet || !currentScreen) return;

    this.m_sheetIndex++;

    // Eagle document has already be checked for drawing and schematic nodes so this
    // should not segfault.
    const module = this.m_eagleDoc!.drawing!.schematic!.modules.get(aModuleInstance.moduleinst);

    // Find the module referenced by the module instance.
    if (!module) {
      throw new IO_ERROR(
        `No module instance '${aModuleInstance.name}' found in schematic file:\n${this.m_filename}`,
      );
    }

    const fnParts = fileNameParts(this.m_filename);
    const fnFull = joinPath(
      fnParts.path,
      `${aModuleInstance.moduleinst}.${KiCadSchematicFileExtension}`,
    );

    let portExtWireEndpoint: VECTOR2I = { x: 0, y: 0 };
    const size: VECTOR2I = { x: module.dx.ToSchUnits(), y: module.dy.ToSchUnits() };

    const halfX = KiROUND(size.x / 2.0);
    const halfY = KiROUND(size.y / 2.0);
    const portExtWireLength = schIUScale.mmToIU(5.08);
    const pos: VECTOR2I = {
      x: aModuleInstance.x.ToSchUnits() - halfX,
      y: -aModuleInstance.y.ToSchUnits() - halfY,
    };

    const newSheet = new SCH_SHEET(currentSheet as unknown as EDA_ITEM, pos, size);

    // The Eagle module for this instance (SCH_SCREEN in KiCad) may have already been loaded.
    let newScreen: SCH_SCREEN | null = null;
    const schFiles = new SCH_SCREENS(this.m_rootSheet!);

    for (let schFile = schFiles.GetFirst(); schFile; schFile = schFiles.GetNext()) {
      if (schFile.GetFileName() === fnFull) {
        newScreen = schFile;
        break;
      }
    }

    const isNewSchFile = newScreen === null;

    if (!newScreen) {
      newScreen = new SCH_SCREEN(this.m_schematic);
      newScreen.SetFileName(fnFull);
    }

    newSheet.SetScreen(newScreen);
    newSheet.SetFileName(`${aModuleInstance.moduleinst}.${KiCadSchematicFileExtension}`);
    newSheet.SetName(aModuleInstance.name);

    for (const [portName, port] of sortedByKey(module.ports)) {
      const pinPos: VECTOR2I = { x: 0, y: 0 };
      const pinOffset = port.coord.ToSchUnits();
      let side = SHEET_SIDE.LEFT;

      if (port.side === 'left') {
        side = SHEET_SIDE.LEFT;
        pinPos.x = pos.x;
        pinPos.y = pos.y + halfY - pinOffset;
        portExtWireEndpoint = { ...pinPos };
        portExtWireEndpoint.x -= portExtWireLength;
      } else if (port.side === 'right') {
        side = SHEET_SIDE.RIGHT;
        pinPos.x = pos.x + size.x;
        pinPos.y = pos.y + halfY - pinOffset;
        portExtWireEndpoint = { ...pinPos };
        portExtWireEndpoint.x += portExtWireLength;
      } else if (port.side === 'top') {
        side = SHEET_SIDE.TOP;
        pinPos.x = pos.x + halfX + pinOffset;
        pinPos.y = pos.y;
        portExtWireEndpoint = { ...pinPos };
        portExtWireEndpoint.y -= portExtWireLength;
      } else if (port.side === 'bottom') {
        side = SHEET_SIDE.BOTTOM;
        pinPos.x = pos.x + halfX + pinOffset;
        pinPos.y = pos.y + size.y;
        portExtWireEndpoint = { ...pinPos };
        portExtWireEndpoint.y += portExtWireLength;
      }

      const portExtWire = new SCH_LINE(pinPos, SCH_LAYER_ID.LAYER_WIRE);
      portExtWire.SetEndPoint(portExtWireEndpoint);
      currentScreen.Append(portExtWire);

      let pinType = LABEL_FLAG_SHAPE.L_UNSPECIFIED;

      if (port.direction !== undefined) {
        if (port.direction === 'in') pinType = LABEL_FLAG_SHAPE.L_INPUT;
        else if (port.direction === 'out') pinType = LABEL_FLAG_SHAPE.L_OUTPUT;
        else if (port.direction === 'io') pinType = LABEL_FLAG_SHAPE.L_BIDI;
        else if (port.direction === 'hiz') pinType = LABEL_FLAG_SHAPE.L_TRISTATE;
        else pinType = LABEL_FLAG_SHAPE.L_UNSPECIFIED;

        // KiCad does not support passive, power, open collector, or no-connect sheet
        // pins that Eagle ports support.  They are set to unspecified to minimize
        // ERC issues.
      }

      const sheetPin = new SCH_SHEET_PIN(newSheet, { x: 0, y: 0 }, portName);

      sheetPin.SetShape(pinType);
      sheetPin.SetPosition(pinPos);
      sheetPin.SetSide(side);
      newSheet.AddPin(sheetPin);
    }

    const pageNo = `${this.m_sheetIndex}`;

    newSheet.SetParent(currentSheet as unknown as EDA_ITEM);
    this.m_sheetPath.push_back(newSheet);
    this.m_sheetPath.SetPageNumber(pageNo);
    currentScreen.Append(newSheet);

    this.m_modules.push(module);
    this.m_moduleInstances.push(aModuleInstance);

    // Do not reload shared modules that are already loaded.
    if (isNewSchFile) {
      for (const esheet of module.sheets) this.loadSheet(esheet);
    } else {
      // Add instances for shared schematics.
      let refPrefix = '';

      for (const emoduleInst of this.m_moduleInstances) refPrefix += `${emoduleInst.name}:`;

      const sharedScreen = this.m_sheetPath.LastScreen();

      if (sharedScreen) {
        for (const schItem of sharedScreen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
          const symbol = schItem as unknown as SCH_SYMBOL;

          if (symbol.GetInstances().length === 0) continue;

          const inst = symbol.GetInstances()[0]!;
          const ref = inst.m_Reference;
          const newReference = refPrefix + ref.slice(ref.lastIndexOf(':') + 1);

          symbol.AddHierarchicalReference(this.m_sheetPath.Path(), newReference, inst.m_Unit);
        }
      }
    }

    this.m_moduleInstances.pop();
    this.m_modules.pop();
    this.m_sheetPath.pop_back();
  }

  private loadFrame(
    aFrame: EFRAME,
    aItems: SCH_ITEM[],
    aLayer: SCH_LAYER_ID = SCH_LAYER_ID.LAYER_NOTES,
  ): void {
    let xMin = aFrame.x1.ToSchUnits();
    let xMax = aFrame.x2.ToSchUnits();
    let yMin = -aFrame.y1.ToSchUnits();
    let yMax = -aFrame.y2.ToSchUnits();

    if (xMin > xMax) [xMin, xMax] = [xMax, xMin];

    if (yMin > yMax) [yMin, yMax] = [yMax, yMin];

    const m = (v: number): number => schIUScale.milsToIU(v);

    let lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
    lines.AddPoint({ x: xMin, y: yMin });
    lines.AddPoint({ x: xMax, y: yMin });
    lines.AddPoint({ x: xMax, y: yMax });
    lines.AddPoint({ x: xMin, y: yMax });
    lines.AddPoint({ x: xMin, y: yMin });
    aItems.push(lines);

    const legend = (aPos: VECTOR2I, aChar: string): void => {
      const legendText = new SCH_TEXT();
      legendText.SetLayer(aLayer);
      legendText.SetPosition(aPos);
      legendText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      legendText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      legendText.SetText(aChar);
      legendText.SetTextSize({ x: m(90), y: m(100) });
      aItems.push(legendText);
    };

    /** `char legendChar; legendChar++`. */
    const nextChar = (c: string): string => String.fromCharCode((c.charCodeAt(0) + 1) & 0xff);

    if (!(aFrame.border_left === false)) {
      lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
      lines.AddPoint({ x: xMin + m(150), y: yMin + m(150) });
      lines.AddPoint({ x: xMin + m(150), y: yMax - m(150) });
      aItems.push(lines);

      const height = yMax - yMin;
      const x1 = xMin;
      const x2 = x1 + m(150);
      const legendPosX = xMin + m(75);
      const rowSpacing = height / aFrame.rows;
      let legendPosY = yMin + rowSpacing / 2;

      for (let i = 1; i < aFrame.rows; i++) {
        const newY = KiROUND(yMin + rowSpacing * i);
        lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
        lines.AddPoint({ x: x1, y: newY });
        lines.AddPoint({ x: x2, y: newY });
        aItems.push(lines);
      }

      let legendChar = 'A';

      for (let i = 0; i < aFrame.rows; i++) {
        legend({ x: legendPosX, y: KiROUND(legendPosY) }, legendChar);
        legendChar = nextChar(legendChar);
        legendPosY += rowSpacing;
      }
    }

    if (!(aFrame.border_right === false)) {
      lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
      lines.AddPoint({ x: xMax - m(150), y: yMin + m(150) });
      lines.AddPoint({ x: xMax - m(150), y: yMax - m(150) });
      aItems.push(lines);

      const height = yMax - yMin;
      const x1 = xMax - m(150);
      const x2 = xMax;
      const legendPosX = xMax - m(75);
      const rowSpacing = height / aFrame.rows;
      let legendPosY = yMin + rowSpacing / 2;

      for (let i = 1; i < aFrame.rows; i++) {
        const newY = KiROUND(yMin + rowSpacing * i);
        lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
        lines.AddPoint({ x: x1, y: newY });
        lines.AddPoint({ x: x2, y: newY });
        aItems.push(lines);
      }

      let legendChar = 'A';

      for (let i = 0; i < aFrame.rows; i++) {
        legend({ x: legendPosX, y: KiROUND(legendPosY) }, legendChar);
        legendChar = nextChar(legendChar);
        legendPosY += rowSpacing;
      }
    }

    if (!(aFrame.border_top === false)) {
      lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
      lines.AddPoint({ x: xMax - m(150), y: yMin + m(150) });
      lines.AddPoint({ x: xMin + m(150), y: yMin + m(150) });
      aItems.push(lines);

      const width = xMax - xMin;
      const y1 = yMin;
      const y2 = yMin + m(150);
      const legendPosY = yMin + m(75);
      const columnSpacing = width / aFrame.columns;
      let legendPosX = xMin + columnSpacing / 2;

      for (let i = 1; i < aFrame.columns; i++) {
        const newX = KiROUND(xMin + columnSpacing * i);
        lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
        lines.AddPoint({ x: newX, y: y1 });
        lines.AddPoint({ x: newX, y: y2 });
        aItems.push(lines);
      }

      let legendChar = '1';

      for (let i = 0; i < aFrame.columns; i++) {
        legend({ x: KiROUND(legendPosX), y: legendPosY }, legendChar);
        legendChar = nextChar(legendChar);
        legendPosX += columnSpacing;
      }
    }

    if (!(aFrame.border_bottom === false)) {
      lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
      lines.AddPoint({ x: xMax - m(150), y: yMax - m(150) });
      lines.AddPoint({ x: xMin + m(150), y: yMax - m(150) });
      aItems.push(lines);

      const width = xMax - xMin;
      const y1 = yMax - m(150);
      const y2 = yMax;
      const legendPosY = yMax - m(75);
      const columnSpacing = width / aFrame.columns;
      let legendPosX = xMin + columnSpacing / 2;

      for (let i = 1; i < aFrame.columns; i++) {
        const newX = KiROUND(xMin + columnSpacing * i);
        lines = new SCH_SHAPE(SHAPE_T.POLY, aLayer);
        lines.AddPoint({ x: newX, y: y1 });
        lines.AddPoint({ x: newX, y: y2 });
        aItems.push(lines);
      }

      let legendChar = '1';

      for (let i = 0; i < aFrame.columns; i++) {
        legend({ x: KiROUND(legendPosX), y: legendPosY }, legendChar);
        legendChar = nextChar(legendChar);
        legendPosX += columnSpacing;
      }
    }
  }

  private connPointAdd(aPos: VECTOR2I, aItem: EDA_ITEM | SCH_PIN): void {
    const key = pointKey(aPos);
    let set = this.m_connPoints.get(key);

    if (!set) {
      set = new Set();
      this.m_connPoints.set(key, set);
    }

    set.add(aItem);
  }

  private loadSegments(
    aSegments: readonly ESEGMENT[],
    netName: string,
    _aNetClass: string,
    aIsBus = false,
  ): void {
    // Loop through all segments
    const screen = this.getCurrentScreen();

    if (!screen) return;

    const segmentCount = aSegments.length;

    for (const esegment of aSegments) {
      let labelled = false; // has a label been added to this continuously connected segment
      let firstWireFound = false;
      let firstWire = new SEG();

      const segDesc = new SEG_DESC();
      this.m_segments.push(segDesc);

      for (const ewire of esegment.wires) {
        // TODO: Check how intersections used in adjustNetLabels should be
        // calculated - for now we pretend that all wires are line segments.
        const out = { seg: new SEG() };
        const wire = this.loadWire(ewire, out);
        const thisWire = out.seg;
        this.connPointAdd(thisWire.A, wire);
        this.connPointAdd(thisWire.B, wire);

        if (!firstWireFound) {
          firstWire = thisWire;
          firstWireFound = true;
        }

        // Test for intersections with other wires
        for (const desc of this.m_segments) {
          if (desc.labels.length > 0 && desc.labels[0]!.GetText() === netName) continue; // no point in saving intersections of the same net

          for (const seg of desc.segs) {
            const intersection = thisWire.Intersect(seg, true);

            if (intersection) this.m_wireIntersections.push(intersection);
          }
        }

        segDesc.segs.push(thisWire);
        screen.Append(wire);
      }

      for (const ejunction of esegment.junctions) screen.Append(this.loadJunction(ejunction));

      for (const elabel of esegment.labels) {
        const label = this.loadLabel(elabel, netName, aIsBus);
        screen.Append(label);

        segDesc.labels.push(label);
        labelled = true;
      }

      for (const epinref of esegment.pinRefs) {
        const part = epinref.part;
        const pin = epinref.pin;

        const powerPort = this.m_powerPorts.get(`#${part}`);

        if (
          powerPort !== undefined &&
          powerPort === EscapeString(pin, ESCAPE_CONTEXT.CTX_NETNAME)
        ) {
          labelled = true;
        }
      }

      // Add a small label to the net segment if it hasn't been labeled already or is not
      // connect to a power symbol with a pin on the same net.  This preserves the named net
      // feature of Eagle schematics.
      if (!labelled && firstWireFound) {
        let label: SCH_LABEL_BASE | null = null;

        // Eagle uses a flat net namespace, so a named net should retain its name across
        // every segment and every sheet.  The PCB importer carries Eagle signal names
        // through verbatim, so we must use a global label here too: a local SCH_LABEL
        // would prepend the sheet path (e.g. "/+24V_SWD") and split the net from the
        // matching PCB signal on net update.
        //
        // Two exceptions: (1) buses are conceptual groupings in Eagle, not electrical
        // signals, so a global bus label would join same-named buses project-wide where
        // Eagle only had visual grouping; (2) nets inside module instances are scoped
        // by the module's ports, so a global label would punch through the hierarchy.

        // `m_netCounts[netName]`: operator[] inserts 0 for an unknown net.
        if (!this.m_netCounts.has(netName)) this.m_netCounts.set(netName, 0);

        if (segmentCount > 1 || this.m_netCounts.get(netName)! > 1) {
          if (aIsBus || this.m_modules.length > 0) label = new SCH_LABEL();
          else label = new SCH_GLOBALLABEL();
        }

        if (label) {
          label.SetPosition(firstWire.A);
          label.SetText(escapeName(netName));
          label.SetTextSize({ x: schIUScale.milsToIU(40), y: schIUScale.milsToIU(40) });

          if (firstWire.A.y === firstWire.B.y) {
            // Horizontal wire.
            if (firstWire.B.x > firstWire.A.x) label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
            else label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
          } else if (firstWire.A.x === firstWire.B.x) {
            // Vertical wire.
            if (firstWire.B.y > firstWire.A.y)
              label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
            else label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
          }

          screen.Append(label);
        }
      }
    }
  }

  private loadPolyLine(aPolygon: EPOLYGON): SCH_SHAPE {
    const poly = new SCH_SHAPE(SHAPE_T.POLY);
    let pt: VECTOR2I = { x: 0, y: 0 };
    let prev_pt: VECTOR2I = { x: 0, y: 0 };
    let prev_curve: number | undefined;

    for (const evertex of aPolygon.vertices) {
      pt = { x: evertex.x.ToSchUnits(), y: -evertex.y.ToSchUnits() };

      if (prev_curve !== undefined) {
        const arc = new SHAPE_ARC();
        arc.ConstructFromStartEndAngle(prev_pt, pt, new EDA_ANGLE(prev_curve).negate());
        poly.GetPolyShape().Append(arc, -1, -1, this.ARC_ACCURACY);
      } else {
        poly.AddPoint(pt);
      }

      prev_pt = pt;
      prev_curve = evertex.curve;
    }

    poly.SetLayer(this.kiCadLayer(aPolygon.layer));
    poly.SetStroke(new STROKE_PARAMS(aPolygon.width.ToSchUnits(), LINE_STYLE.SOLID));
    poly.SetFillMode(FILL_T.FILLED_SHAPE);

    return poly;
  }

  private loadWire(aWire: EWIRE, endpoints: { seg: SEG }): SCH_ITEM {
    const start: VECTOR2I = { x: aWire.x1.ToSchUnits(), y: -aWire.y1.ToSchUnits() };
    const end: VECTOR2I = { x: aWire.x2.ToSchUnits(), y: -aWire.y2.ToSchUnits() };

    // For segment wires.
    endpoints.seg = new SEG(start, end);

    const kicadLayer = this.kiCadLayer(aWire.layer);

    // Don't process curved wires on an electrical layer into arcs, they aren't supported
    // in the rest of the code
    // TODO: When curved wires/buses are added, remove this restriction
    // `aWire->curve`: an optional, so a curve of 0 still makes an arc.
    if (kicadLayer === SCH_LAYER_ID.LAYER_NOTES && aWire.curve !== undefined) {
      const arc = new SCH_SHAPE(SHAPE_T.ARC);

      const center = ConvertArcCenter(start, end, aWire.curve);
      arc.SetCenter(center);
      arc.SetStart(start);

      // KiCad rotates the other way.
      arc.SetArcAngleAndEnd(new EDA_ANGLE(aWire.curve).negate(), true);
      arc.SetLayer(this.kiCadLayer(aWire.layer));
      arc.SetStroke(new STROKE_PARAMS(aWire.width.ToSchUnits(), LINE_STYLE.SOLID));

      return arc;
    } else {
      const line = new SCH_LINE();

      line.SetStartPoint(start);
      line.SetEndPoint(end);
      line.SetLayer(this.kiCadLayer(aWire.layer));
      line.SetStroke(new STROKE_PARAMS(aWire.width.ToSchUnits(), LINE_STYLE.SOLID));

      return line;
    }
  }

  private loadCircle(aCircle: ECIRCLE): SCH_SHAPE {
    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE);
    const center: VECTOR2I = { x: aCircle.x.ToSchUnits(), y: -aCircle.y.ToSchUnits() };

    circle.SetLayer(this.kiCadLayer(aCircle.layer));
    circle.SetPosition(center);
    circle.SetEnd({ x: center.x + aCircle.radius.ToSchUnits(), y: center.y });
    circle.SetStroke(new STROKE_PARAMS(aCircle.width.ToSchUnits(), LINE_STYLE.SOLID));

    return circle;
  }

  private loadRectangle(aRectangle: ERECT): SCH_SHAPE {
    const rectangle = new SCH_SHAPE(SHAPE_T.RECTANGLE);

    rectangle.SetLayer(this.kiCadLayer(aRectangle.layer));
    rectangle.SetPosition({ x: aRectangle.x1.ToSchUnits(), y: -aRectangle.y1.ToSchUnits() });
    rectangle.SetEnd({ x: aRectangle.x2.ToSchUnits(), y: -aRectangle.y2.ToSchUnits() });

    if (aRectangle.rot) {
      const center = rectangle.GetCenter();
      const angle = new EDA_ANGLE(aRectangle.rot.degrees);

      const pos = RotatePoint(rectangle.GetPosition(), center, angle);
      const end = RotatePoint(rectangle.GetEnd(), center, angle);

      rectangle.SetPosition(pos);
      rectangle.SetEnd(end);
    }

    // Eagle rectangles are filled by definition.
    rectangle.SetFillMode(FILL_T.FILLED_SHAPE);

    return rectangle;
  }

  private loadJunction(aJunction: EJUNCTION): SCH_JUNCTION {
    const junction = new SCH_JUNCTION();

    const pos: VECTOR2I = { x: aJunction.x.ToSchUnits(), y: -aJunction.y.ToSchUnits() };

    junction.SetPosition(pos);

    return junction;
  }

  private loadLabel(aLabel: ELABEL, aNetName: string, aIsBus: boolean): SCH_LABEL_BASE {
    const elabelpos: VECTOR2I = { x: aLabel.x.ToSchUnits(), y: -aLabel.y.ToSchUnits() };

    // Label-kind decision mirrors loadSegments(): SCH_HIERLABEL for module ports,
    // SCH_LABEL for buses and module-internal nets, SCH_GLOBALLABEL otherwise so the
    // Eagle flat net namespace round-trips through the matching PCB signal name.
    let label: SCH_LABEL_BASE;

    const textSize: VECTOR2I = {
      x: KiROUND(aLabel.size.ToSchUnits() * 0.7),
      y: KiROUND(aLabel.size.ToSchUnits() * 0.7),
    };

    const findModulePort = (): EPORT | null => {
      if (this.m_modules.length === 0) return null;

      const ports = this.m_modules[this.m_modules.length - 1]!.ports;
      return ports.get(aNetName) ?? null;
    };

    const port = findModulePort();

    if (port) {
      const hierLabel = new SCH_HIERLABEL();

      if (port.direction !== undefined) {
        const direction = port.direction;
        let type: LABEL_SHAPE;

        if (direction === 'in') type = LABEL_SHAPE.LABEL_INPUT;
        else if (direction === 'out') type = LABEL_SHAPE.LABEL_OUTPUT;
        else if (direction === 'io') type = LABEL_SHAPE.LABEL_BIDI;
        else if (direction === 'hiz') type = LABEL_SHAPE.LABEL_TRISTATE;
        else type = LABEL_SHAPE.LABEL_PASSIVE;

        // KiCad does not support passive, power, open collector, or no-connect sheet
        // pins that Eagle ports support.  They are set to unspecified to minimize
        // ERC issues.
        hierLabel.SetLabelShape(type);
      }

      label = hierLabel;
    } else if (aIsBus || this.m_modules.length > 0) {
      label = new SCH_LABEL();
    } else {
      label = new SCH_GLOBALLABEL();
    }

    label.SetText(escapeName(aNetName));
    label.SetPosition(elabelpos);
    label.SetTextSize(textSize);
    label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));

    if (aLabel.rot) {
      // According to the Eagle DTD, labels can only be rotated in 90 degree increments.
      const angle = KiROUND(aLabel.rot.degrees);
      const mirror = aLabel.rot.mirror;

      switch (angle) {
        case 90:
          label.SetSpinStyle(new SPIN_STYLE(mirror ? SPIN_STYLE.BOTTOM : SPIN_STYLE.UP));
          break;
        case 180:
          label.SetSpinStyle(new SPIN_STYLE(mirror ? SPIN_STYLE.RIGHT : SPIN_STYLE.LEFT));
          break;
        case 270:
          label.SetSpinStyle(new SPIN_STYLE(mirror ? SPIN_STYLE.UP : SPIN_STYLE.BOTTOM));
          break;
        default:
          label.SetSpinStyle(new SPIN_STYLE(mirror ? SPIN_STYLE.LEFT : SPIN_STYLE.RIGHT));
          break;
      }
    }

    return label;
  }

  private findNearestLinePoint(aPoint: VECTOR2I, aLines: readonly SEG[]): [VECTOR2I, SEG | null] {
    let nearestPoint: VECTOR2I = { x: 0, y: 0 };
    let nearestLine: SEG | null = null;

    let mindistance = Number.MAX_VALUE;

    // Project the label onto the closest wire.  Snapping to the perpendicular foot keeps a
    // detached Eagle label at its position along the wire; snapping only to the wire's
    // endpoints or midpoint would slide it far along a long wire and pile parallel labels
    // onto the same point.
    for (const line of aLines) {
      const testpoint = line.NearestPoint(aPoint);
      const d = Math.hypot(testpoint.x - aPoint.x, testpoint.y - aPoint.y);

      if (d < mindistance) {
        mindistance = d;
        nearestPoint = testpoint;
        nearestLine = line;
      }
    }

    return [nearestPoint, nearestLine];
  }

  private loadInstance(aInstance: EINSTANCE, aParts: ReadonlyMap<string, EPART>): void {
    const screen = this.getCurrentScreen();

    if (!screen) return;

    const epart = aParts.get(aInstance.part);

    if (!epart) {
      this.Report(
        `Error parsing Eagle file. Could not find '${aInstance.part}' instance but it is referenced in the schematic.`,
        RPT_SEVERITY_ERROR,
      );

      return;
    }

    let libName = epart.library;

    // Correctly handle versioned libraries.
    if (epart.libraryUrn) libName += `_${epart.libraryUrn.assetId}`;

    const gatename = `${epart.deviceset}_${epart.device}_${aInstance.gate}`;
    let symbolname = epart.deviceset + epart.device;
    let kiPackageName = epart.deviceset + epart.device;

    if (epart.technology !== undefined) symbolname += epart.technology;

    symbolname = symbolname.replaceAll('*', '');
    kiPackageName = kiPackageName.replaceAll('*', '');

    const kisymbolname = EscapeString(symbolname, ESCAPE_CONTEXT.CTX_LIBID);

    // Eagle schematics can have multiple libraries containing symbols with duplicate symbol
    // names.  Because this parser stores all of the symbols in a single library, the
    // loadSymbol() function, prefixed the original Eagle library name to the symbol name
    // in case of a name clash.  Check for the prefixed symbol first.  This ensures that
    // the correct library symbol gets mapped on load.
    const altSymbolName = EscapeString(`${libName}_${symbolname}`, ESCAPE_CONTEXT.CTX_LIBID);

    let libIdSymbolName = altSymbolName;

    const elib = this.m_eagleLibs.get(libName);

    if (!elib) {
      this.Report(
        `Eagle library '${libName}' not found while looking up symbol for deviceset '${epart.deviceset}', device '${epart.device}', and gate '${aInstance.gate}.`,
      );
      return;
    }

    const unit = elib.GateToUnitMap.get(gatename);

    if (unit === undefined) {
      this.Report(
        `Symbol not found for deviceset '${epart.deviceset}', device '${epart.device}', and gate '${aInstance.gate} in library '${libName}'.`,
      );
      return;
    }

    let packageName = '';

    const p = elib.package.get(kisymbolname);

    if (p !== undefined) {
      packageName = p;
    } else {
      const p2 = elib.package.get(kiPackageName);

      if (p2 !== undefined) packageName = p2;
    }

    // set properties to prevent save file on every symbol save
    const properties: SCH_IO_PROPERTIES = new Map([[SCH_IO_KICAD_SEXPR.PropBuffering, '']]);

    let part = this.m_pi!.LoadSymbol(this.getLibFileName(), altSymbolName, properties);

    if (!part) {
      part = this.m_pi!.LoadSymbol(this.getLibFileName(), kisymbolname, properties);
      libIdSymbolName = kisymbolname;
    }

    if (!part) {
      this.Report(
        `Could not find '${unescapeString(kisymbolname)}' in the imported library.`,
        RPT_SEVERITY_ERROR,
      );
      return;
    }

    const libId = new LIB_ID(this.getLibName(), libIdSymbolName);
    const symbol = new SCH_SYMBOL();
    symbol.SetLibId(libId);
    symbol.SetUnit(unit);
    symbol.SetPosition({ x: aInstance.x.ToSchUnits(), y: -aInstance.y.ToSchUnits() });

    // assume that footprint library is identical to project name
    if (packageName !== '') {
      const footprint = `${this.m_schematic!.Project().GetProjectName()}:${packageName}`;
      symbol.GetField(FIELD_T.FOOTPRINT)!.SetText(footprint);
    }

    if (aInstance.rot) {
      symbol.SetOrientation(kiCadComponentRotation(aInstance.rot.degrees));

      if (aInstance.rot.mirror) symbol.MirrorHorizontally(aInstance.x.ToSchUnits());
    }

    const partFields: SCH_FIELD[] = [];
    part.GetFields(partFields);

    const nextFieldPosition = add(this.getLastSymbolFieldPosition(part), symbol.GetPosition());

    for (const partField of partFields) {
      let symbolField: SCH_FIELD | null;

      if (partField.IsMandatory()) symbolField = symbol.GetField(partField.GetId());
      else symbolField = symbol.GetField(partField.GetName());

      if (!symbolField) {
        const newField = new SCH_FIELD(symbol, FIELD_T.USER, partField.GetName());

        newField.SetVisible(false);
        newField.SetText(partField.GetText());

        nextFieldPosition.y += newField.GetTextHeight() + schIUScale.milsToIU(10);
        newField.SetPosition({ ...nextFieldPosition });
        symbol.AddField(newField);
      } else {
        symbolField.ImportValues(partField);
        symbolField.SetTextPos(add(symbol.GetPosition(), partField.GetTextPos()));
      }
    }

    // If there is no footprint assigned, then prepend the reference value
    // with a hash character to mute netlist updater complaints
    let reference = packageName === '' ? `#${aInstance.part}` : aInstance.part;

    // reference must end with a number but EAGLE does not enforce this
    if (lastNotOf(reference, '0123456789') === reference.length - 1) reference += '0';

    // EAGLE allows references to be single digits.  This breaks KiCad netlisting, which requires
    // parts to have non-digit + digit annotation.  If the reference begins with a number,
    // we prepend 'UNK' (unknown) for the symbol designator
    if (firstNotOf(reference, '0123456789') !== 0) reference = `UNK${reference}`;

    // EAGLE allows designator to start with # but that is used in KiCad
    // for symbols which do not have a footprint
    if (firstNotOf(aInstance.part, '#') !== 0) reference = `UNK${reference}`;

    const referenceField = symbol.GetField(FIELD_T.REFERENCE)!;
    referenceField.SetText(reference);

    const valueField = symbol.GetField(FIELD_T.VALUE)!;

    // `m_userValue.at( libIdSymbolName )`
    const userValue = this.m_userValue.get(libIdSymbolName);

    if (userValue === undefined) throw new IO_ERROR('unordered_map::at');

    if (part.GetUnitCount() > 1) {
      this.getEagleSymbolFieldAttributes(aInstance, '>NAME', referenceField);
      this.getEagleSymbolFieldAttributes(aInstance, '>VALUE', valueField);
    }

    if (epart.value !== undefined && epart.value !== '') {
      valueField.SetText(epart.value);
    } else {
      valueField.SetText(kisymbolname);

      if (userValue) valueField.SetVisible(false);
    }

    for (const [attrName, attr] of sortedByKey(epart.attributes)) {
      const newField = new SCH_FIELD(symbol, FIELD_T.USER);

      newField.SetName(attrName);

      const fields = symbol.GetFields();

      if (fields.length > 0) newField.SetTextPos(fields[fields.length - 1]!.GetPosition());

      if (attr.value !== undefined) newField.SetText(attr.value);

      newField.SetVisible(attr.display === EATTR.Off ? false : true);

      symbol.AddField(newField);
    }

    let valueAttributeFound = false;
    let nameAttributeFound = false;

    // Parse attributes for the instance
    for (const [, eattr] of sortedByKey(aInstance.attributes)) {
      let field: SCH_FIELD | null = null;

      if (eattr.name.toLowerCase() === 'name') {
        field = symbol.GetField(FIELD_T.REFERENCE);
        nameAttributeFound = true;
      } else if (eattr.name.toLowerCase() === 'value') {
        field = symbol.GetField(FIELD_T.VALUE);
        valueAttributeFound = true;
      } else {
        field = symbol.GetField(eattr.name);
      }

      if (field) {
        field.SetVisible(true);
        field.SetPosition({ x: eattr.x!.ToSchUnits(), y: -eattr.y!.ToSchUnits() });

        if (eattr.size) field.SetTextSize(ConvertEagleTextSize(eattr.font, eattr.size));

        const align = eattr.align !== undefined ? eattr.align : ETEXT.BOTTOM_LEFT;
        const absdegrees = eattr.rot ? Math.trunc(eattr.rot.degrees) : 0;
        let mirror = eattr.rot ? eattr.rot.mirror : false;

        if (aInstance.rot?.mirror) mirror = !mirror;

        const spin = eattr.rot ? eattr.rot.spin : false;

        if (eattr.display === EATTR.Off || eattr.display === EATTR.NAME) field.SetVisible(false);

        const rotation = aInstance.rot ? Math.trunc(aInstance.rot.degrees) : 0;
        let reldegrees = Math.trunc(absdegrees - rotation + 360.0);
        reldegrees %= 360;

        eagleToKicadAlignment(field, align, reldegrees, mirror, spin, absdegrees);
      }
    }

    // Use the instance attribute to determine the reference and value field visibility.
    if (aInstance.smashed) {
      symbol.GetField(FIELD_T.VALUE)!.SetVisible(valueAttributeFound);
      symbol.GetField(FIELD_T.REFERENCE)!.SetVisible(nameAttributeFound);
    }

    // Eagle has a brain dead module reference scheme where the module names separated by colons
    // are prefixed to the symbol references.  This will get blown away in KiCad the first time
    // any annotation is performed.  It is required for the initial synchronization between the
    // schematic and the board.
    let refPrefix = '';

    for (const emoduleInst of this.m_moduleInstances) refPrefix += `${emoduleInst.name}:`;

    symbol.AddHierarchicalReference(this.m_sheetPath.Path(), refPrefix + reference, unit);

    // Cache the lib symbol so pin positions are available for connection-point tracking.
    // Use the already-loaded `part` directly rather than re-fetching through the adapter,
    // because the .kicad_sym library is still buffered in m_pi and has not yet been saved to
    // disk at the time loadInstance runs.
    symbol.SetLibSymbol(part.Flatten());

    for (const [name, variant] of sortedByKey(epart.variants)) {
      const symbolVariant = new SCH_SYMBOL_VARIANT(name);

      if (variant.populate !== undefined && !variant.populate) symbolVariant.m_DNP = true;

      if (variant.value !== undefined)
        symbolVariant.m_Fields.set(GetCanonicalFieldName(FIELD_T.VALUE), variant.value);

      if (variant.technology !== undefined) {
        const eLib = this.m_eagleDoc!.drawing!.schematic!.libraries.get(epart.library);

        if (!eLib) {
          this.Report(`Library '${epart.library}' not found in schematic.`);
          continue;
        }

        const eDeviceSet = eLib.devicesets.get(epart.deviceset);

        if (!eDeviceSet) {
          this.Report(`Device set '${epart.deviceset}' not found in library '${epart.library}'.`);
          continue;
        }

        const eDevice = eDeviceSet.devices.get(epart.device);

        if (!eDevice) {
          this.Report(
            `Device '${epart.device}' not found in device set '${epart.deviceset}' in library '${epart.library}'.`,
          );
          continue;
        }

        const eTechnology = eDevice.technologies.get(variant.technology);

        if (!eTechnology) {
          this.Report(
            `Technology '${variant.technology}' not found in device '${epart.device}'  in device set '${epart.deviceset}' in library '${epart.library}'.`,
          );
          continue;
        }

        for (const attr of eTechnology.attributes)
          symbolVariant.m_Fields.set(attr.name, attr.value ?? '');
      }

      symbol.AddVariant(this.m_sheetPath, symbolVariant);
    }

    for (const pin of symbol.GetLibPins())
      this.connPointAdd(symbol.GetPinPhysicalPosition(pin), pin);

    if (part.IsGlobalPower())
      this.m_powerPorts.set(reference, symbol.GetField(FIELD_T.VALUE)!.GetText());

    symbol.ClearFlags();

    screen.Append(symbol);
  }

  private loadLibrary(aLibrary: ELIBRARY, aEagleLibrary: EAGLE_LIBRARY): EAGLE_LIBRARY {
    const canAutoplace = ADVANCED_CFG.GetCfg().m_EagleImportFieldsCanAutoplace;

    // Loop through the device sets and load each of them
    for (const [, edeviceset] of sortedByKey(aLibrary.devicesets)) {
      // Get Device set information
      const prefix = edeviceset.prefix !== undefined ? edeviceset.prefix : '';
      let deviceSetDescr = '';

      if (edeviceset.description)
        deviceSetDescr = convertDescription(UnescapeHTML(edeviceset.description.text));

      // For each device in the device set:
      for (const [, edevice] of sortedByKey(edeviceset.devices)) {
        const derivedSymbols: LIB_SYMBOL[] = [];

        // Create symbol name from deviceset and device names.
        let symbolName = edeviceset.name + edevice.name;
        symbolName = symbolName.replaceAll('*', '');
        symbolName = EscapeString(symbolName, ESCAPE_CONTEXT.CTX_LIBID);

        if (edevice.package !== undefined) aEagleLibrary.package.set(symbolName, edevice.package);

        // Create KiCad symbol.
        const libSymbol = new LIB_SYMBOL(symbolName);

        // Process each gate in the deviceset for this device.
        const gate_count = edeviceset.gates.size;
        libSymbol.SetUnitCount(gate_count, true);
        libSymbol.LockUnits(true);

        const reference = libSymbol.GetField(FIELD_T.REFERENCE)!;

        if (prefix.length === 0) {
          reference.SetVisible(false);
        } else {
          // If there is no footprint assigned, then prepend the reference value
          // with a hash character to mute netlist updater complaints
          reference.SetText(edevice.package !== undefined ? prefix : `#${prefix}`);
        }

        libSymbol.GetValueField().SetVisible(true);

        let gateindex = 1;
        let ispower = false;

        for (const [, egate] of sortedByKey(edeviceset.gates)) {
          const esymbol = aLibrary.symbols.get(egate.symbol);

          if (!esymbol) {
            this.Report(
              `Eagle symbol '${egate.symbol}' not found in library '${aLibrary.GetName()}'.`,
            );
            continue;
          }

          const gateMapName = `${edeviceset.name}_${edevice.name}_${egate.name}`;
          aEagleLibrary.GateToUnitMap.set(gateMapName, gateindex);
          ispower = this.loadSymbol(esymbol, libSymbol, edevice, gateindex, egate.name);

          gateindex++;
        }

        const fields: SCH_FIELD[] = [];
        libSymbol.GetFields(fields);

        for (const field of fields) field.SetCanAutoplace(canAutoplace);

        for (const [, technology] of sortedByKey(edevice.technologies)) {
          let derivedSymbol: LIB_SYMBOL | null = null;
          const nextFieldPosition = this.getLastSymbolFieldPosition(libSymbol);

          if (technology.name !== '') {
            derivedSymbol = new LIB_SYMBOL(symbolName + technology.name, libSymbol);

            for (const parentField of fields) {
              const childField = derivedSymbol.GetField(parentField.GetName());

              if (childField) {
                childField.SetAttributes(parentField as unknown as EDA_TEXT);
                childField.SetCanAutoplace(canAutoplace);
              }
            }
          }

          for (const attr of technology.attributes) {
            if (attr.value === undefined) continue;

            let field: SCH_FIELD | null;

            if (!derivedSymbol) field = libSymbol.FindFieldCaseInsensitive(attr.name);
            else field = derivedSymbol.FindFieldCaseInsensitive(attr.name);

            if (field) {
              field.SetText(attr.value);
            } else {
              const newField = new SCH_FIELD(derivedSymbol ?? libSymbol, FIELD_T.USER, attr.name);

              if (derivedSymbol) {
                const parentField = libSymbol.FindFieldCaseInsensitive(attr.name);

                if (parentField) newField.SetAttributes(parentField as unknown as EDA_TEXT);
              }

              nextFieldPosition.y += newField.GetTextHeight() + schIUScale.milsToIU(10);
              newField.SetText(attr.value);
              newField.SetVisible(false);
              newField.SetPosition({ ...nextFieldPosition });
              newField.SetCanAutoplace(canAutoplace);

              if (!derivedSymbol) libSymbol.AddField(newField);
              else derivedSymbol.AddField(newField);
            }
          }

          if (derivedSymbol) derivedSymbols.push(derivedSymbol);
        }

        libSymbol.SetUnitCount(gate_count, true);

        if (gate_count === 1 && ispower) libSymbol.SetGlobalPower();

        // Don't set the footprint field if no package is defined in the Eagle schematic.
        if (edevice.package !== undefined) {
          let libName: string;

          if (this.m_schematic) {
            // assume that footprint library is identical to project name
            libName = this.m_schematic.Project().GetProjectName();
          } else {
            libName = this.m_libName;
          }

          const packageString = `${libName}:${aEagleLibrary.package.get(symbolName) ?? ''}`;

          libSymbol.GetFootprintField().SetText(packageString);
        }

        let libName = libSymbol.GetName();
        libSymbol.SetName(libName);
        libSymbol.SetDescription(deviceSetDescr);

        if (this.m_pi) {
          // If duplicate symbol names exist in multiple Eagle symbol libraries, prefix the
          // Eagle symbol library name to the symbol which should ensure that it is unique.
          try {
            if (this.m_pi.LoadSymbol(this.getLibFileName(), libName)) {
              libName = EscapeString(`${aEagleLibrary.name}_${libName}`, ESCAPE_CONTEXT.CTX_LIBID);
              libSymbol.SetName(libName);
            }

            // set properties to prevent save file on every symbol save
            const properties: SCH_IO_PROPERTIES = new Map([[SCH_IO_KICAD_SEXPR.PropBuffering, '']]);

            const parentSymbol = LIB_SYMBOL.copyOf(libSymbol);
            this.m_pi.SaveSymbol(this.getLibFileName(), parentSymbol, properties);

            for (const symbol of derivedSymbols) {
              if (this.m_pi.LoadSymbol(this.getLibFileName(), symbol.GetName())) {
                const tmp = EscapeString(
                  `${aEagleLibrary.name}_${symbol.GetName()}`,
                  ESCAPE_CONTEXT.CTX_LIBID,
                );
                symbol.SetName(tmp);
              }

              const derived = LIB_SYMBOL.copyOf(symbol);

              derived.SetLibParent(parentSymbol);
              this.m_pi.SaveSymbol(this.getLibFileName(), derived, properties);
            }
          } catch {
            // A library symbol cannot be loaded for some reason.
            // Just skip this symbol creating an issue.
            // The issue will be reported later by the Reporter
          }
        }

        aEagleLibrary.KiCadSymbols.set(libName, libSymbol);

        // Store information on whether the value of FIELD_T::VALUE for a part should be
        // part/@value or part/@deviceset + part/@device.
        if (!this.m_userValue.has(libName))
          this.m_userValue.set(libName, edeviceset.uservalue === true);

        for (const symbol of derivedSymbols) {
          if (!this.m_userValue.has(symbol.GetName()))
            this.m_userValue.set(symbol.GetName(), edeviceset.uservalue === true);

          aEagleLibrary.KiCadSymbols.set(symbol.GetName(), symbol);
        }
      }
    }

    return aEagleLibrary;
  }

  private loadSymbol(
    aEsymbol: ESYMBOL,
    aSymbol: LIB_SYMBOL,
    aDevice: EDEVICE,
    aGateNumber: number,
    aGateName: string,
  ): boolean {
    let showRefDes = false;
    let showValue = false;
    let ispower = false;
    let pincount = 0;

    for (const ecircle of aEsymbol.circles)
      aSymbol.AddDrawItem(this.loadSymbolCircle(aSymbol, ecircle, aGateNumber));

    for (const epin of aEsymbol.pins) {
      const pin = this.loadPin(aSymbol, epin, aGateNumber);
      pincount++;

      pin.SetType(ELECTRICAL_PINTYPE.PT_BIDI);

      if (epin.direction !== undefined) {
        for (const [dir, type] of pinDirectionsMap) {
          if (epin.direction.toLowerCase() === dir) {
            pin.SetType(type);

            if (dir === 'sup')
              // power supply symbol
              ispower = true;

            break;
          }
        }
      }

      if (aDevice.connects.length !== 0) {
        for (const connect of aDevice.connects) {
          // Eagle <connect> references the full pin name including any "@<tag>"
          // linking hint, so match against the raw Eagle name rather than the
          // stripped display name set on the pin.
          if (connect.gate === aGateName && epin.name === connect.pin) {
            const pads = wxSplit(connect.pad, ' ', '\\');

            pin.SetUnit(aGateNumber);
            pin.SetName(escapeName(pin.GetName()));

            if (pads.length > 1) {
              pin.SetNumberTextSize(0);
            }

            for (const padname of pads) {
              const apin = SCH_PIN.copyOf(pin);

              apin.SetNumber(padname);
              aSymbol.AddDrawItem(apin);
            }

            break;
          }
        }
      } else {
        pin.SetUnit(aGateNumber);
        pin.SetNumber(`${pincount}`);
        aSymbol.AddDrawItem(pin);
      }
    }

    for (const epolygon of aEsymbol.polygons)
      aSymbol.AddDrawItem(this.loadSymbolPolyLine(aSymbol, epolygon, aGateNumber));

    for (const erectangle of aEsymbol.rectangles)
      aSymbol.AddDrawItem(this.loadSymbolRectangle(aSymbol, erectangle, aGateNumber));

    for (const etext of aEsymbol.texts) {
      const libtext = this.loadSymbolText(aSymbol, etext, aGateNumber);

      if (libtext.GetText() === '${REFERENCE}') {
        // Move text & attributes to Reference field and discard LIB_TEXT item
        this.loadFieldAttributes(aSymbol.GetReferenceField(), libtext);

        // Show Reference field if Eagle reference was uppercase
        showRefDes = etext.text === '>NAME';
      } else if (libtext.GetText() === '${VALUE}') {
        // Move text & attributes to Value field and discard LIB_TEXT item
        this.loadFieldAttributes(aSymbol.GetValueField(), libtext);

        // Show Value field if Eagle reference was uppercase
        showValue = etext.text === '>VALUE';
      } else if (etext.text.startsWith('>')) {
        // Text values that start with '>' are place holders for fields defined later
        // in library deviceset objects.
        const fieldName = etext.text.slice(1);

        if (fieldName !== '') {
          const field = new SCH_FIELD(aSymbol, FIELD_T.USER, fieldName);

          this.loadFieldAttributes(field, libtext);

          // Field visibility is determined by the symbol instance attributes.
          field.SetVisible(false);
          aSymbol.AddField(field);
        }
      } else {
        aSymbol.AddDrawItem(libtext);
      }
    }

    for (const ewire of aEsymbol.wires) {
      const item = this.loadSymbolWire(aSymbol, ewire, aGateNumber);

      // `AddDrawItem( nullptr )`: a zero-length wire yields nothing to add.
      if (item) aSymbol.AddDrawItem(item);
    }

    for (const eframe of aEsymbol.frames) {
      const frameItems: SCH_ITEM[] = [];

      this.loadFrame(eframe, frameItems);

      for (const item of frameItems) {
        item.SetParent(aSymbol as unknown as EDA_ITEM);
        item.SetUnit(aGateNumber);
        aSymbol.AddDrawItem(item);
      }
    }

    aSymbol.GetReferenceField().SetVisible(showRefDes);
    aSymbol.GetValueField().SetVisible(showValue);

    return pincount === 1 ? ispower : false;
  }

  private loadSymbolCircle(aSymbol: LIB_SYMBOL, aCircle: ECIRCLE, aGateNumber: number): SCH_SHAPE {
    // Parse the circle properties
    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
    const center: VECTOR2I = { x: aCircle.x.ToSchUnits(), y: -aCircle.y.ToSchUnits() };

    circle.SetParent(aSymbol as unknown as EDA_ITEM);
    circle.SetPosition(center);
    circle.SetEnd({ x: center.x + aCircle.radius.ToSchUnits(), y: center.y });

    if (aCircle.width.ToSchUnits() === 0) {
      circle.SetStroke(new STROKE_PARAMS(-1, LINE_STYLE.SOLID));
      circle.SetFillMode(FILL_T.FILLED_SHAPE);
    } else {
      circle.SetStroke(new STROKE_PARAMS(aCircle.width.ToSchUnits(), LINE_STYLE.SOLID));
    }

    circle.SetUnit(aGateNumber);

    return circle;
  }

  private loadSymbolRectangle(
    aSymbol: LIB_SYMBOL,
    aRectangle: ERECT,
    aGateNumber: number,
  ): SCH_SHAPE {
    const rectangle = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

    rectangle.SetParent(aSymbol as unknown as EDA_ITEM);
    rectangle.SetPosition({ x: aRectangle.x1.ToSchUnits(), y: -aRectangle.y1.ToSchUnits() });
    rectangle.SetEnd({ x: aRectangle.x2.ToSchUnits(), y: -aRectangle.y2.ToSchUnits() });

    if (aRectangle.rot) {
      const center = rectangle.GetCenter();
      const angle = new EDA_ANGLE(aRectangle.rot.degrees);

      const pos = RotatePoint(rectangle.GetPosition(), center, angle);
      const end = RotatePoint(rectangle.GetEnd(), center, angle);

      rectangle.SetPosition(pos);
      rectangle.SetEnd(end);
    }

    rectangle.SetUnit(aGateNumber);

    // Eagle rectangles are filled and have vanishing line width by definition.
    rectangle.SetFillMode(FILL_T.FILLED_SHAPE);
    rectangle.SetWidth(-1);

    return rectangle;
  }

  private loadSymbolWire(aSymbol: LIB_SYMBOL, aWire: EWIRE, aGateNumber: number): SCH_ITEM | null {
    let begin: VECTOR2I = { x: aWire.x1.ToSchUnits(), y: -aWire.y1.ToSchUnits() };
    const end: VECTOR2I = { x: aWire.x2.ToSchUnits(), y: -aWire.y2.ToSchUnits() };

    if (eqPt(begin, end)) return null;

    // if the wire is an arc
    if (aWire.curve !== undefined) {
      const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);
      const center = ConvertArcCenter(begin, end, aWire.curve);
      const radius = Math.sqrt(
        (center.x - begin.x) * (center.x - begin.x) + (center.y - begin.y) * (center.y - begin.y),
      );

      arc.SetParent(aSymbol as unknown as EDA_ITEM);

      // this emulates the filled semicircles created by a thick arc with flat ends caps.
      if (aWire.cap === EWIRE.FLAT && aWire.width.ToSchUnits() >= 2 * radius) {
        // `( begin - center ) * ( width / radius )`: a VECTOR2<double>, cast back to int.
        const f = aWire.width.ToSchUnits() / radius;
        const centerStartVector: VECTOR2I = {
          x: Math.trunc((begin.x - center.x) * f),
          y: Math.trunc((begin.y - center.y) * f),
        };
        begin = add(center, centerStartVector);

        arc.SetStroke(new STROKE_PARAMS(1, LINE_STYLE.SOLID));
        arc.SetFillMode(FILL_T.FILLED_SHAPE);
      } else {
        arc.SetStroke(new STROKE_PARAMS(aWire.width.ToSchUnits(), LINE_STYLE.SOLID));
      }

      arc.SetCenter(center);
      arc.SetStart(begin);

      // KiCad rotates the other way.
      arc.SetArcAngleAndEnd(new EDA_ANGLE(aWire.curve).negate(), true);
      arc.SetUnit(aGateNumber);

      return arc;
    } else {
      const poly = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

      poly.AddPoint(begin);
      poly.AddPoint(end);
      poly.SetUnit(aGateNumber);
      poly.SetStroke(new STROKE_PARAMS(aWire.width.ToSchUnits(), LINE_STYLE.SOLID));

      return poly;
    }
  }

  private loadSymbolPolyLine(
    aSymbol: LIB_SYMBOL,
    aPolygon: EPOLYGON,
    aGateNumber: number,
  ): SCH_SHAPE {
    const poly = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
    let pt: VECTOR2I = { x: 0, y: 0 };
    let prev_pt: VECTOR2I = { x: 0, y: 0 };
    let prev_curve: number | undefined;
    let first_pt: VECTOR2I | undefined;

    poly.SetParent(aSymbol as unknown as EDA_ITEM);

    for (const evertex of aPolygon.vertices) {
      pt = { x: evertex.x.ToSchUnits(), y: -evertex.y.ToSchUnits() };

      if (first_pt === undefined) first_pt = pt;

      if (prev_curve !== undefined) {
        const arc = new SHAPE_ARC();
        arc.ConstructFromStartEndAngle(prev_pt, pt, new EDA_ANGLE(prev_curve).negate());
        poly.GetPolyShape().Append(arc, -1, -1, this.ARC_ACCURACY);
      } else {
        poly.AddPoint(pt);
      }

      prev_pt = pt;
      prev_curve = evertex.curve;
    }

    if (first_pt !== undefined) poly.AddPoint(first_pt);

    poly.SetStroke(new STROKE_PARAMS(aPolygon.width.ToSchUnits(), LINE_STYLE.SOLID));
    poly.SetFillMode(FILL_T.FILLED_SHAPE);
    poly.SetUnit(aGateNumber);

    return poly;
  }

  private loadPin(aSymbol: LIB_SYMBOL, aPin: EPIN, aGateNumber: number): SCH_PIN {
    const pin = new SCH_PIN(aSymbol as unknown as EDA_ITEM);
    pin.SetPosition({ x: aPin.x.ToSchUnits(), y: -aPin.y.ToSchUnits() });

    // Eagle pin names may carry a trailing "@<tag>" linking hint that disambiguates
    // duplicate names within a symbol. It is metadata, not visible text, so strip it
    // from the displayed name. The full Eagle name is still used to match <connect>.
    pin.SetName(extractNetName(aPin.name));
    pin.SetUnit(aGateNumber);

    const roti = aPin.rot ? Math.trunc(aPin.rot.degrees) : 0;

    switch (roti) {
      case 0:
        pin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT);
        break;
      case 90:
        pin.SetOrientation(PIN_ORIENTATION.PIN_UP);
        break;
      case 180:
        pin.SetOrientation(PIN_ORIENTATION.PIN_LEFT);
        break;
      case 270:
        pin.SetOrientation(PIN_ORIENTATION.PIN_DOWN);
        break;
      default:
        break; // wxFAIL_MSG: "Unhandled orientation"
    }

    pin.SetLength(schIUScale.milsToIU(300)); // Default pin length when not defined.

    if (aPin.length !== undefined) {
      const length = aPin.length;

      if (length === 'short') pin.SetLength(schIUScale.milsToIU(100));
      else if (length === 'middle') pin.SetLength(schIUScale.milsToIU(200));
      else if (length === 'long') pin.SetLength(schIUScale.milsToIU(300));
      else if (length === 'point') pin.SetLength(schIUScale.milsToIU(0));
    }

    // Pin names and numbers are fixed size in Eagle.
    pin.SetNumberTextSize(schIUScale.milsToIU(60));
    pin.SetNameTextSize(schIUScale.milsToIU(60));

    // emulate the visibility of pin elements
    if (aPin.visible !== undefined) {
      const visible = aPin.visible;

      if (visible === 'off') {
        pin.SetNameTextSize(0);
        pin.SetNumberTextSize(0);
      } else if (visible === 'pad') {
        pin.SetNameTextSize(0);
      } else if (visible === 'pin') {
        pin.SetNumberTextSize(0);
      }
    }

    if (aPin.function !== undefined) {
      const fn = aPin.function;

      if (fn === 'dot') pin.SetShape(GRAPHIC_PINSHAPE.INVERTED);
      else if (fn === 'clk') pin.SetShape(GRAPHIC_PINSHAPE.CLOCK);
      else if (fn === 'dotclk') pin.SetShape(GRAPHIC_PINSHAPE.INVERTED_CLOCK);
    }

    return pin;
  }

  private loadSymbolText(aSymbol: LIB_SYMBOL, aText: ETEXT, aGateNumber: number): SCH_TEXT {
    const libtext = new SCH_TEXT();

    libtext.SetLayer(SCH_LAYER_ID.LAYER_DEVICE);
    libtext.SetParent(aSymbol as unknown as EDA_ITEM);
    libtext.SetUnit(aGateNumber);
    libtext.SetPosition({ x: aText.x.ToSchUnits(), y: -aText.y.ToSchUnits() });

    const adjustedText = adjustText(aText.text);

    libtext.SetText(adjustedText === '' ? '~' : adjustedText);

    this.loadTextAttributes(libtext, aText);

    return libtext;
  }

  private loadPlainText(aText: ETEXT): SCH_TEXT {
    const schtext = new SCH_TEXT();

    const adjustedText = adjustText(aText.text);

    schtext.SetText(adjustedText === '' ? '" "' : escapeName(adjustedText));

    schtext.SetPosition({ x: aText.x.ToSchUnits(), y: -aText.y.ToSchUnits() });
    this.loadTextAttributes(schtext, aText);
    schtext.SetItalic(false);

    return schtext;
  }

  private loadTextAttributes(aText: SCH_FIELD | SCH_TEXT, aAttributes: ETEXT): void {
    aText.SetTextSize(aAttributes.ConvertSize());

    // Must come after SetTextSize()
    if (aAttributes.ratio !== undefined && aAttributes.ratio > 12) aText.SetBold(true);

    const align = aAttributes.align !== undefined ? aAttributes.align : ETEXT.BOTTOM_LEFT;
    const degrees = aAttributes.rot ? Math.trunc(aAttributes.rot.degrees) : 0;
    const mirror = aAttributes.rot ? aAttributes.rot.mirror : false;
    const spin = aAttributes.rot ? aAttributes.rot.spin : false;

    eagleToKicadAlignment(aText, align, degrees, mirror, spin, 0);
  }

  private loadFieldAttributes(aField: SCH_FIELD, aText: SCH_TEXT): void {
    aField.SetTextPos(aText.GetPosition());
    aField.SetTextSize(aText.GetTextSize());
    aField.SetTextAngle(aText.GetTextAngle());

    // Must come after SetTextSize()
    aField.SetBold(aText.IsBold());
    aField.SetItalic(false);

    aField.SetVertJustify(aText.GetVertJustify());
    aField.SetHorizJustify(aText.GetHorizJustify());
  }

  private adjustNetLabels(): void {
    // Eagle supports detached labels, so a label does not need to be placed on a wire
    // to be associated with it. KiCad needs to move them, so the labels actually touch the
    // corresponding wires.

    // Sort the intersection points to speed up the search process. `std::sort` /
    // `std::binary_search` over `VECTOR2I::operator<`: ordered, and found, by squared length.
    const intersectionKeys = new Set(this.m_wireIntersections.map(lengthKey));

    const onIntersection = (aPos: VECTOR2I): boolean => intersectionKeys.has(lengthKey(aPos));

    for (const segDesc of this.m_segments) {
      for (const label of segDesc.labels) {
        let labelPos = label.GetPosition();
        let segAttached = segDesc.LabelAttached(label);

        if (segAttached && !onIntersection(labelPos)) continue; // label is placed correctly

        // Move the label to the nearest wire
        if (!segAttached) {
          [labelPos, segAttached] = this.findNearestLinePoint(label.GetPosition(), segDesc.segs);

          if (!segAttached)
            // we cannot do anything
            continue;
        }

        // Create a vector pointing in the direction of the wire, 50 mils long
        let wireDirection = sub(segAttached.B, segAttached.A);

        if (wireDirection.x === 0 && wireDirection.y === 0) continue;

        wireDirection = ResizeI(wireDirection, schIUScale.milsToIU(50));
        const origPos = { ...labelPos };

        // Flags determining the search direction
        let checkPositive = true;
        let checkNegative = true;
        let move = false;
        let trial = 0;

        // `wireDirection * trial / 2`: VECTOR2<int>::operator/( double ) rounds.
        const step = (): VECTOR2I => ({
          x: KiROUND((wireDirection.x * trial) / 2),
          y: KiROUND((wireDirection.y * trial) / 2),
        });

        // Be sure the label is not placed on a wire intersection
        while ((!move || onIntersection(labelPos)) && (checkPositive || checkNegative)) {
          move = false;

          // Move along the attached wire to find the new label position
          if (trial % 2 === 1) {
            labelPos = add(origPos, step());
            move = checkPositive = segAttached.Contains(labelPos);
          } else {
            labelPos = sub(origPos, step());
            move = checkNegative = segAttached.Contains(labelPos);
          }

          ++trial;
        }

        if (move) {
          label.SetPosition(labelPos);

          if (wireDirection.x === 0) {
            // Moved vertically
            if (wireDirection.y < 0) label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
            else label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
          } else if (wireDirection.y === 0) {
            // Moved horizontally
            if (wireDirection.x < 0) label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
            else label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
          }
        }
      }
    }

    this.m_segments = [];
    this.m_wireIntersections = [];
  }

  override CanReadSchematicFile(aFileName: string): boolean {
    if (!super.CanReadSchematicFile(aFileName)) return false;

    return this.checkHeader(aFileName);
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return this.checkHeader(aFileName);
  }

  private checkHeader(aFileName: string): boolean {
    const data = this.m_readFile(aFileName);

    if (!data) return false;

    const lines = new TextDecoder('utf-8').decode(data).split(/\r\n|\r|\n/);

    for (let i = 0; i < 8; i++) {
      if (i >= lines.length) return false;

      if (lines[i]!.includes('<eagle')) return true;
    }

    return false;
  }

  private moveLabels(aWire: SCH_LINE, aNewEndPoint: VECTOR2I): void {
    const screen = this.getCurrentScreen();

    if (!screen) return;

    for (const item of screen.Items().Overlapping(aWire.GetBoundingBox())) {
      if (!item.IsType([KICAD_T.SCH_LABEL_LOCATE_ANY_T])) continue;

      if (TestSegmentHit(item.GetPosition(), aWire.GetStartPoint(), aWire.GetEndPoint(), 0))
        item.SetPosition(aNewEndPoint);
    }
  }

  private addBusEntries(): void {
    // Add bus entry symbols
    // TODO: Cleanup this function and break into pieces

    // for each wire segment, compare each end with all busses.
    // If the wire end is found to end on a bus segment, place a bus entry symbol.

    const buses: SCH_LINE[] = [];
    const wires: SCH_LINE[] = [];

    const screen = this.getCurrentScreen();

    if (!screen) return;

    for (const ii of screen.Items().OfType(KICAD_T.SCH_LINE_T)) {
      const line = ii as unknown as SCH_LINE;

      if (line.IsBus()) buses.push(line);
      else if (line.IsWire()) wires.push(line);
    }

    const entrySize = (signX: number, signY: number): VECTOR2I => ({
      x: schIUScale.milsToIU(DEFAULT_SCH_ENTRY_SIZE) * signX,
      y: schIUScale.milsToIU(DEFAULT_SCH_ENTRY_SIZE) * signY,
    });

    const marker = (aPos: VECTOR2I): void => {
      const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_BUS_ENTRY_NEEDED);
      screen.Append(new SCH_MARKER(ercItem, aPos));
    };

    const entry = (
      aWire: SCH_LINE,
      p: VECTOR2I,
      aQuadrant: number,
      aStart: boolean,
      aMoveTo = p,
    ) => {
      const busEntry = new SCH_BUS_WIRE_ENTRY(p, aQuadrant);
      busEntry.SetFlags(IS_NEW);
      screen.Append(busEntry);
      this.moveLabels(aWire, aMoveTo);

      if (aStart) aWire.SetStartPoint(aMoveTo);
      else aWire.SetEndPoint(aMoveTo);
    };

    for (const wire of wires) {
      const wireStart = wire.GetStartPoint();
      const wireEnd = wire.GetEndPoint();

      for (const bus of buses) {
        const busStart = bus.GetStartPoint();
        const busEnd = bus.GetEndPoint();

        const testBusHit = (aPt: VECTOR2I): boolean => TestSegmentHit(aPt, busStart, busEnd, 0);

        if (wireStart.y === wireEnd.y && busStart.x === busEnd.x) {
          // Horizontal wire and vertical bus

          if (testBusHit(wireStart)) {
            // Wire start is on the vertical bus

            if (wireEnd.x < busStart.x) {
              /* the end of the wire is to the left of the bus */
              const p = add(wireStart, entrySize(-1, 0));

              if (testBusHit(add(wireStart, entrySize(0, -1)))) {
                /* there is room above the wire for the bus entry */
                entry(wire, p, 1, true);
              } else if (testBusHit(add(wireStart, entrySize(0, 1)))) {
                /* there is room below the wire for the bus entry */
                entry(wire, p, 2, true);
              } else {
                marker(wireStart);
              }
            } else {
              /* the wire end is to the right of the bus */
              const p = add(wireStart, entrySize(1, 0));

              if (testBusHit(add(wireStart, entrySize(0, -1)))) {
                /* There is room above the wire for the bus entry */
                entry(wire, p, 4, true);
              } else if (testBusHit(add(wireStart, entrySize(0, 1)))) {
                /* There is room below the wire for the bus entry */
                entry(wire, p, 3, true);
              } else {
                marker(wireStart);
              }
            }

            break;
          } else if (testBusHit(wireEnd)) {
            // Wire end is on the vertical bus

            if (wireStart.x < busStart.x) {
              /* start of the wire is to the left of the bus */
              const p = add(wireEnd, entrySize(-1, 0));

              if (testBusHit(add(wireEnd, entrySize(0, -1)))) {
                /* there is room above the wire for the bus entry */
                entry(wire, p, 1, false);
                // biome-ignore lint/suspicious/noDuplicateElseIf: upstream's own: this "room below" test repeats ( 0, -1 ) (sch_io_eagle.cpp:3308), so the branch is dead in KiCad too.
              } else if (testBusHit(add(wireEnd, entrySize(0, -1)))) {
                /* there is room below the wire for the bus entry */
                entry(wire, p, 2, false, add(wireEnd, entrySize(-1, 0)));
              } else {
                marker(wireEnd);
              }
            } else {
              /* the start of the wire is to the right of the bus */
              const p = add(wireEnd, entrySize(1, 0));

              if (testBusHit(add(wireEnd, entrySize(0, -1)))) {
                /* There is room above the wire for the bus entry */
                entry(wire, p, 4, false);
              } else if (testBusHit(add(wireEnd, entrySize(0, 1)))) {
                /* There is room below the wire for the bus entry */
                entry(wire, p, 3, false);
              } else {
                marker(wireEnd);
              }
            }

            break;
          }
        } else if (wireStart.x === wireEnd.x && busStart.y === busEnd.y) {
          // Vertical wire and horizontal bus

          if (testBusHit(wireStart)) {
            // Wire start is on the bus

            if (wireEnd.y < busStart.y) {
              /* the end of the wire is above the bus */
              const p = add(wireStart, entrySize(0, -1));

              if (testBusHit(add(wireStart, entrySize(-1, 0)))) {
                /* there is room to the left of the wire for the bus entry */
                entry(wire, p, 3, true);
              } else if (testBusHit(add(wireStart, entrySize(1, 0)))) {
                /* there is room to the right of the wire for the bus entry */
                entry(wire, p, 2, true);
              } else {
                marker(wireStart);
              }
            } else {
              /* wire end is below the bus */
              const p = add(wireStart, entrySize(0, 1));

              if (testBusHit(add(wireStart, entrySize(-1, 0)))) {
                /* there is room to the left of the wire for the bus entry */
                entry(wire, p, 4, true);
              } else if (testBusHit(add(wireStart, entrySize(1, 0)))) {
                /* there is room to the right of the wire for the bus entry */
                entry(wire, p, 1, true);
              } else {
                marker(wireStart);
              }
            }

            break;
          } else if (testBusHit(wireEnd)) {
            // Wire end is on the bus

            if (wireStart.y < busStart.y) {
              /* the start of the wire is above the bus */
              const p = add(wireEnd, entrySize(0, -1));

              if (testBusHit(add(wireEnd, entrySize(-1, 0)))) {
                /* there is room to the left of the wire for the bus entry */
                entry(wire, p, 3, false);
              } else if (testBusHit(add(wireEnd, entrySize(1, 0)))) {
                /* there is room to the right of the wire for the bus entry */
                entry(wire, p, 2, false);
              } else {
                marker(wireEnd);
              }
            } else {
              /* wire start is below the bus */
              const p = add(wireEnd, entrySize(0, 1));

              if (testBusHit(add(wireEnd, entrySize(-1, 0)))) {
                /* there is room to the left of the wire for the bus entry */
                entry(wire, p, 4, false);
              } else if (testBusHit(add(wireEnd, entrySize(1, 0)))) {
                /* there is room to the right of the wire for the bus entry */
                entry(wire, p, 1, false);
              } else {
                marker(wireEnd);
              }
            }

            break;
          }
        } else {
          // Wire isn't horizontal or vertical

          if (testBusHit(wireStart)) {
            const wirevector = sub(wireStart, wireEnd);

            if (wirevector.x > 0) {
              if (wirevector.y > 0) entry(wire, add(wireStart, entrySize(-1, -1)), 2, true);
              else entry(wire, add(wireStart, entrySize(-1, 1)), 1, true);
            } else {
              if (wirevector.y > 0) entry(wire, add(wireStart, entrySize(1, -1)), 3, true);
              else entry(wire, add(wireStart, entrySize(1, 1)), 4, true);
            }

            break;
          } else if (testBusHit(wireEnd)) {
            const wirevector = sub(wireStart, wireEnd);

            if (wirevector.x > 0) {
              if (wirevector.y > 0) entry(wire, add(wireEnd, entrySize(1, 1)), 4, false);
              else entry(wire, add(wireEnd, entrySize(1, -1)), 3, false);
            } else {
              if (wirevector.y > 0) entry(wire, add(wireEnd, entrySize(-1, 1)), 1, false);
              else entry(wire, add(wireEnd, entrySize(-1, -1)), 2, false);
            }

            break;
          }
        }
      }
    }
  }

  // TODO could be used to place junctions, instead of IsJunctionNeeded()
  // (see SCH_EDIT_FRAME::importFile())
  private checkConnections(aSymbol: SCH_SYMBOL, aPin: SCH_PIN): boolean {
    const pinPosition = aSymbol.GetPinPhysicalPosition(aPin);
    const items = this.m_connPoints.get(pointKey(pinPosition));

    if (!items) return false;

    if (!items.has(aPin)) return false;

    return items.size > 1;
  }

  private addImplicitConnections(
    aSymbol: SCH_SYMBOL,
    aScreen: SCH_SCREEN,
    aUpdateSet: boolean,
  ): void {
    const libSymbol = aSymbol.GetLibSymbolRef();

    if (!libSymbol) return;

    // Normally power parts also have power input pins,
    // but they already force net names on the attached wires
    if (libSymbol.IsGlobalPower()) return;

    const unit = aSymbol.GetUnit();
    const reference = aSymbol.GetField(FIELD_T.REFERENCE)!.GetText();
    const pins = libSymbol.GetGraphicalPins(0, 0);
    const missingUnits = new Set<number>();

    // Search all units for pins creating implicit connections
    for (const pin of pins) {
      if (pin.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN) {
        const pinInUnit = !unit || pin.GetUnit() === unit; // pin belongs to the tested unit

        // Create a global net label only if there are no other wires/pins attached
        if (pinInUnit) {
          if (!this.checkConnections(aSymbol, pin)) {
            // Create a net label to force the net name on the pin
            const netLabel = new SCH_GLOBALLABEL();
            netLabel.SetPosition(aSymbol.GetPinPhysicalPosition(pin));
            netLabel.SetText(extractNetName(pin.GetName()));
            netLabel.SetTextSize({ x: schIUScale.milsToIU(40), y: schIUScale.milsToIU(40) });

            switch (pin.GetOrientation()) {
              case PIN_ORIENTATION.PIN_LEFT:
                netLabel.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
                break;
              case PIN_ORIENTATION.PIN_UP:
                netLabel.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
                break;
              case PIN_ORIENTATION.PIN_DOWN:
                netLabel.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
                break;
              default:
                netLabel.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
                break;
            }

            aScreen.Append(netLabel);
          }
        } else if (aUpdateSet) {
          // Found a pin creating implicit connection information in another unit.
          // Such units will be instantiated if they do not appear in another sheet and
          // processed later.
          missingUnits.add(pin.GetUnit());
        }
      }
    }

    if (aUpdateSet && libSymbol.GetUnitCount() > 1) {
      const cmp = this.m_missingCmps.get(reference);

      // The first unit found has always already been processed.
      if (!cmp) {
        const entry: EAGLE_MISSING_CMP = { cmp: aSymbol, screen: aScreen, units: new Map() };
        this.m_missingCmps.set(reference, entry);
        if (!entry.units.has(unit)) entry.units.set(unit, false);
      } else {
        // Set the flag indicating this unit has been processed.
        cmp.units.set(unit, false);
      }

      if (missingUnits.size > 0) {
        // Save the units that need later processing
        let entry = this.m_missingCmps.get(reference);

        if (!entry) {
          entry = { cmp: null, screen: null, units: new Map() };
          this.m_missingCmps.set(reference, entry);
        }

        entry.cmp = aSymbol;
        entry.screen = aScreen;

        // Add units that haven't already been processed.
        //
        // Upstream: `if( entry.units.find( i ) != entry.units.end() ) entry.units.emplace(
        // i, true );` - it emplaces only a unit ALREADY in the map, which `emplace` refuses.
        // Nothing is ever added, so no missing unit is ever instantiated; kept that way.
      }
    }
  }

  private translateEagleBusName(aEagleName: string): string {
    if (NET_SETTINGS.ParseBusVector(aEagleName, null, null)) return aEagleName;

    let ret = '{';

    // `wxStringTokenizer( aEagleName, "," )`: ',' is not whitespace, so wxTOKEN_RET_EMPTY -
    // empty tokens between delimiters are returned, a trailing one is not.
    const tokens = aEagleName.split(',');

    if (tokens.length > 1 && tokens[tokens.length - 1] === '') tokens.pop();

    if (aEagleName === '') tokens.length = 0;

    for (let member of tokens) {
      // In Eagle, overbar text is automatically stopped at the end of the net name, even when
      // that net name is part of a bus definition.  In KiCad, we don't (currently) do that, so
      // if there is an odd number of overbar markers in this net name, we need to append one
      // to close it out before appending the space.

      if ((member.split('!').length - 1) % 2 > 0) member += '!';

      ret += `${member} `;
    }

    ret = ret.replace(/[ \t\n\v\f\r]+$/, '');
    ret += '}';

    return ret;
  }

  private getEagleSymbol(aInstance: EINSTANCE): ESYMBOL | null {
    const schematic = this.m_eagleDoc?.drawing?.schematic;

    if (!schematic) return null;

    const epart = schematic.parts.get(aInstance.part);

    if (!epart || epart.deviceset === '') return null;

    const elibrary = schematic.libraries.get(epart.library);

    if (!elibrary) return null;

    const edeviceset = elibrary.devicesets.get(epart.deviceset);

    if (!edeviceset) return null;

    const egate = edeviceset.gates.get(aInstance.gate);

    if (!egate) return null;

    return elibrary.symbols.get(egate.symbol) ?? null;
  }

  private getEagleSymbolFieldAttributes(
    aInstance: EINSTANCE,
    aEagleFieldName: string,
    aField: SCH_FIELD,
  ): void {
    if (aEagleFieldName === '') return;

    const esymbol = this.getEagleSymbol(aInstance);

    if (esymbol) {
      for (const text of esymbol.texts) {
        if (text.text === aEagleFieldName) {
          aField.SetVisible(true);
          const pos: VECTOR2I = {
            x: text.x.ToSchUnits() + aInstance.x.ToSchUnits(),
            y: -text.y.ToSchUnits() - aInstance.y.ToSchUnits(),
          };

          let mirror = text.rot ? text.rot.mirror : false;

          if (aInstance.rot?.mirror) mirror = !mirror;

          if (mirror) pos.y = -aInstance.y.ToSchUnits() + text.y.ToSchUnits();

          aField.SetPosition(pos);
        }
      }
    }
  }

  private getLastSymbolFieldPosition(aPart: LIB_SYMBOL): VECTOR2I {
    const retv: VECTOR2I = { x: 0, y: 0 };

    const fields: SCH_FIELD[] = [];
    aPart.GetFields(fields);

    if (fields.length > 0) {
      const first = fields[0]!.GetPosition();
      retv.x = first.x;
      retv.y = first.y;

      for (let i = 1; i < fields.length; i++) {
        const p = fields[i]!.GetPosition();

        if (p.x > retv.x) retv.x = p.x;

        if (p.y > retv.y) retv.y = p.y;
      }
    }

    return retv;
  }
}

function newEagleLibrary(): EAGLE_LIBRARY {
  return { name: '', KiCadSymbols: new Map(), GateToUnitMap: new Map(), package: new Map() };
}

/** `SCH_LABEL_BASE*` dynamic_cast. */
function isLabel(aItem: SCH_ITEM): boolean {
  const t = aItem.Type();
  return (
    t === KICAD_T.SCH_LABEL_T ||
    t === KICAD_T.SCH_GLOBAL_LABEL_T ||
    t === KICAD_T.SCH_HIER_LABEL_T ||
    t === KICAD_T.SCH_DIRECTIVE_LABEL_T
  );
}

/** `std::wstring::find_last_not_of( aChars )`: -1 for npos. */
function lastNotOf(aStr: string, aChars: string): number {
  for (let i = aStr.length - 1; i >= 0; i--) if (!aChars.includes(aStr[i]!)) return i;
  return -1;
}

/** `std::wstring::find_first_not_of( aChars )`: -1 for npos. */
function firstNotOf(aStr: string, aChars: string): number {
  for (let i = 0; i < aStr.length; i++) if (!aChars.includes(aStr[i]!)) return i;
  return -1;
}
