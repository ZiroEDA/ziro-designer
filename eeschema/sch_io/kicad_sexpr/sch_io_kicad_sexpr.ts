// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_IO_KICAD_SEXPR` (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.cpp): the KiCad
 * s-expression schematic reader and writer onto the live item classes (eeschema stage E3).
 *
 * There is no disk here: a load is handed a `readFile( absolutePath )` that answers a
 * file's text (or null when it does not exist), and a save returns the text.  File paths
 * are POSIX paths.
 *
 * Pending, marked in place: `Format( SCH_SELECTION* … )` (the clipboard; it needs
 * SCH_SELECTION), the symbol-library plugin half (Enumerate/Load/Save/Delete symbol and
 * library, which ride on the library table), the progress reporter, and the group
 * sanity-check user query.
 */

import { GetMajorMinorVersion } from '@ziroeda/common/build_version.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { FormatAngle, FormatInternalUnits, schIUScale } from '@ziroeda/common/eda_units.js';
import { GENERATOR } from '@ziroeda/common/generator.js';
import {
  FormatBool,
  FormatStreamData,
  FormatUuid,
} from '@ziroeda/common/io/kicad/kicad_io_utils.js';
import { type KIID, KIID_PATH, niluuid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { type OUTPUTFORMATTER, PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { EscapedUTF8, FormatDouble2Str, formatG } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_270,
  ANGLE_90,
  type EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { DEFAULT_SIZE_TEXT } from '@ziroeda/common/eda_text.js';
import type { LIB_SYMBOL } from '../../lib_symbol.js';
import type { SCH_BITMAP } from '../../sch_bitmap.js';
import type { SCH_BUS_ENTRY_BASE } from '../../sch_bus_entry.js';
import type { SCH_FIELD } from '../../sch_field.js';
import type { SCH_GROUP } from '../../sch_group.js';
import { AUTOPLACE_ALGO } from '../../sch_item.js';
import type { SCH_JUNCTION } from '../../sch_junction.js';
import { type SCH_DIRECTIVE_LABEL, SCH_LABEL_BASE, SPIN_STYLE } from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import type { SCH_NO_CONNECT } from '../../sch_no_connect.js';
import type { SCH_RULE_AREA } from '../../sch_rule_area.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import type { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import {
  type SCH_SHEET_INSTANCE,
  type SCH_SHEET_LIST,
  SCH_SHEET_PATH,
  SCH_SYMBOL_INSTANCE,
} from '../../sch_sheet_path.js';
import { type SCH_SYMBOL, toUTFTildaText } from '../../sch_symbol.js';
import type { SCH_TABLE } from '../../sch_table.js';
import { SCH_TABLECELL } from '../../sch_tablecell.js';
import type { SCH_TEXT } from '../../sch_text.js';
import type { SCH_TEXTBOX } from '../../sch_textbox.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SEXPR_SCHEMATIC_FILE_VERSION } from '../../sch_file_versions.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import {
  formatArc,
  formatBezier,
  formatCircle,
  formatFill,
  formatPoly,
  formatRect,
  getSheetPinAngle,
  getSheetPinShapeToken,
  getTextTypeToken,
} from './sch_io_kicad_sexpr_common.js';
import { SCH_IO_KICAD_SEXPR_LIB_CACHE } from './sch_io_kicad_sexpr_lib_cache.js';
import { type LIB_SYMBOL_MAP, SCH_IO_KICAD_SEXPR_PARSER } from './sch_io_kicad_sexpr_parser.js';

/** A file's text by absolute path, or null when there is no such file. */
export type SCH_FILE_READER = (aAbsolutePath: string) => string | null;

const IU = (aValue: number): string => FormatInternalUnits(schIUScale, aValue);

/** `std::map<wxString, …>` / `wxArrayString::Sort` order: code points. */
const cpCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `KIID_PATH::operator<` as a comparator. */
const kiidPathCmp = (a: KIID_PATH, b: KIID_PATH): number =>
  a.lessThan(b) ? -1 : b.lessThan(a) ? 1 : 0;

/** `wxFileName` on POSIX paths, the parts the loader uses. */
const PosixPath = {
  isAbsolute: (p: string): boolean => p.startsWith('/'),
  dirname: (p: string): string => {
    const i = p.lastIndexOf('/');
    return i <= 0 ? (i === 0 ? '/' : '') : p.substring(0, i);
  },
  /** `MakeAbsolute( aCwd )`, normalising `.` and `..`. */
  makeAbsolute: (p: string, aCwd: string): string => {
    const joined = PosixPath.isAbsolute(p) ? p : `${aCwd.replace(/\/+$/, '')}/${p}`;
    const out: string[] = [];

    for (const part of joined.split('/')) {
      if (part === '' || part === '.') continue;

      if (part === '..') out.pop();
      else out.push(part);
    }

    return `/${out.join('/')}`;
  },
  /** `MakeRelativeTo( aBase )` for a path under the base; else the path itself. */
  makeRelativeTo: (p: string, aBase: string): string => {
    const base = aBase.replace(/\/+$/, '');

    // The filesystem root is a base too: "/" strips to "", which every absolute path is under.
    if ((base !== '' || aBase.startsWith('/')) && p.startsWith(`${base}/`))
      return p.substring(base.length + 1);

    return p;
  },
};

/**
 * A #SCH_IO derivation for loading 6.x+ s-expression schematic files.
 */
export class SCH_IO_KICAD_SEXPR {
  /// Property the library cache reads to buffer writes.
  static readonly PropBuffering = 'buffering';

  protected m_version = 0; ///< Version of file being loaded.
  protected m_appending = false; ///< Schematic load append status.
  protected m_error = ''; ///< For throwing exceptions or errors on partial loads.

  protected m_path = ''; ///< Root project path for loading child sheets.
  protected m_currentPath: string[] = []; ///< Stack to maintain nested sheet paths
  protected m_currentSheetPath = new SCH_SHEET_PATH();
  protected m_rootSheet: SCH_SHEET | null = null; ///< The root sheet of the schematic being loaded.
  protected m_loadedRootSheets: SCH_SHEET[] = [];
  protected m_schematic: SCHEMATIC | null = null;
  protected m_out: OUTPUTFORMATTER | null = null; ///< The formatter for saving SCH_SCREEN objects.
  protected m_readFile: SCH_FILE_READER = () => null;

  /**
   * The `(generator …)` a schematic is written with.  Upstream writes its own program
   * name, "eeschema", as a literal; ours defaults to common/generator.ts's, the one place
   * it deviates (the kicad-cli oracle passes "eeschema").
   */
  protected m_generator: string;

  constructor(aGenerator: string = GENERATOR) {
    this.m_generator = aGenerator;
    this.init(null);
  }

  GetName(): string {
    return 'Eeschema s-expression';
  }

  /** Return any error text accumulated by a partial load (a child sheet that failed). */
  GetError(): string {
    return this.m_error;
  }

  protected init(aSchematic: SCHEMATIC | null): void {
    if (this.m_schematic !== aSchematic) this.m_loadedRootSheets = [];

    this.m_version = 0;
    this.m_appending = false;
    this.m_rootSheet = null;
    this.m_schematic = aSchematic;
    this.m_out = null;
  }

  /**
   * Load a schematic file and its hierarchy.
   *
   * @param aFileName the absolute path of the root schematic file.
   * @param aProjectPath the project folder (`Project().GetProjectPath()`), which child
   *                     sheet file names are relative to.
   * @param aReadFile answers a file's text.
   * @param aAppendToMe the sheet to append into, or null to make a new root sheet.
   */
  LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aProjectPath: string,
    aReadFile: SCH_FILE_READER,
    aAppendToMe: SCH_SHEET | null = null,
  ): SCH_SHEET {
    let sheet: SCH_SHEET;

    this.m_readFile = aReadFile;

    if (aAppendToMe) {
      this.m_appending = true;

      const normedFn = aAppendToMe.GetFileName();

      if (!PosixPath.isAbsolute(normedFn)) {
        if (aFileName.endsWith(normedFn))
          this.m_path = aFileName.substring(0, aFileName.length - normedFn.length);
      }

      if (this.m_path === '') this.m_path = aProjectPath;
    } else {
      this.m_path = aProjectPath;
    }

    this.m_currentPath.push(this.m_path);
    this.init(aSchematic);

    if (aAppendToMe === null) {
      // Clean up any allocated memory if an exception occurs loading the schematic.
      const newSheet = new SCH_SHEET(aSchematic);

      newSheet.SetFileName(PosixPath.makeRelativeTo(aFileName, aProjectPath));
      this.m_rootSheet = newSheet;
      this.loadHierarchy(new SCH_SHEET_PATH(), newSheet);

      // If we got here, the schematic loaded successfully.
      sheet = newSheet;
      this.m_rootSheet = null; // Quiet Coverity warning.
      this.m_loadedRootSheets.push(sheet);
    } else {
      this.m_rootSheet = aSchematic.Root();
      sheet = aAppendToMe;
      this.loadHierarchy(new SCH_SHEET_PATH(), sheet);
    }

    this.m_currentPath.pop(); // Clear the path stack for next call to Load

    return sheet;
  }

  /**
   * Load the sheet's file (or share a screen already loaded from the same file) and
   * recurse into its sheets.
   */
  protected loadHierarchy(aParentSheetPath: SCH_SHEET_PATH, aSheet: SCH_SHEET): void {
    this.m_currentSheetPath.push_back(aSheet);

    let screen: { value: SCH_SCREEN | null } = { value: null };

    if (!aSheet.GetScreen()) {
      // SCH_SCREEN objects store the full path and file name where the SCH_SHEET object
      // only stores the file name and extension.  Add the project path to the file name
      // and extension to compare when calling SCH_SHEET::SearchHierarchy().
      // (ExpandTextVars over the project's variables is pending: the file name is used as
      // written.)
      let fileName = aSheet.GetFileName();

      if (!PosixPath.isAbsolute(fileName))
        fileName = PosixPath.makeAbsolute(
          fileName,
          this.m_currentPath[this.m_currentPath.length - 1]!,
        );

      // Save the current path so that it gets restored when descending and ascending the
      // sheet hierarchy which allows for sheet schematic files to be nested in folders
      // relative to the last path a schematic was loaded from.
      this.m_currentPath.push(PosixPath.dirname(fileName));

      // Make sure we don't try to load the same sheet twice in a chain of ancestors
      const ancestorSheetPath = aParentSheetPath.Clone();

      while (!ancestorSheetPath.empty()) {
        if (ancestorSheetPath.LastScreen()!.GetFileName() === fileName) {
          if (this.m_error !== '') this.m_error += '\n';

          this.m_error += `Could not load sheet '${fileName}' because it already appears as a direct ancestor in the schematic hierarchy.`;

          fileName = '';
          break;
        }

        ancestorSheetPath.pop_back();
      }

      if (ancestorSheetPath.empty()) {
        // Existing schematics could be either in the root sheet path or the current sheet
        // load path so we have to check both.
        if (!this.m_rootSheet!.SearchHierarchy(fileName, screen))
          this.m_currentSheetPath.at(0)!.SearchHierarchy(fileName, screen);

        // When loading multiple top-level sheets that reference the same sub-sheet file,
        // the screen won't be found in the current root's hierarchy.  Search previously
        // loaded root sheets to share screens across top-level sheets.
        if (!screen.value) {
          for (const prevRoot of this.m_loadedRootSheets) {
            if (prevRoot.SearchHierarchy(fileName, screen)) break;
          }
        }
      }

      if (screen.value) {
        aSheet.SetScreen(screen.value);
        aSheet.GetScreen()!.SetParent(this.m_schematic);
        // Do not need to load the sub-sheets - this has already been done.
      } else {
        aSheet.SetScreen(new SCH_SCREEN(this.m_schematic));
        aSheet.GetScreen()!.SetFileName(fileName);

        let exists = false;

        try {
          exists = this.loadFile(fileName, aSheet);
        } catch (ioe) {
          // If there is a problem loading the root sheet, there is no recovery.
          if (aSheet === this.m_rootSheet) throw ioe;

          // For all subsheets, queue up the error message for the caller.
          if (this.m_error !== '') this.m_error += '\n';

          this.m_error += ioe instanceof Error ? ioe.message : String(ioe);
        }

        // There is no write permission to ask about here: an existing file is writable.
        aSheet.GetScreen()!.SetFileReadOnly(false);
        aSheet.GetScreen()!.SetFileExists(exists);

        const currentSheetPath = aParentSheetPath.Clone();
        currentSheetPath.push_back(aSheet);

        // This was moved out of the try{} block so that any sheet definitions that the
        // plugin fully parsed before the exception was raised will be loaded.
        for (const aItem of aSheet.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)) {
          const sheet = aItem as SCH_SHEET;

          // Recursion starts here.
          this.loadHierarchy(currentSheetPath, sheet);
        }
      }

      this.m_currentPath.pop();
    }

    screen = { value: null };
    this.m_currentSheetPath.pop_back();
  }

  /** @return true if the file existed. */
  protected loadFile(aFileName: string, aSheet: SCH_SHEET): boolean {
    const text = this.m_readFile(aFileName);

    if (text === null) throw new Error(`Failed to open file '${aFileName}'.`);

    const parser = new SCH_IO_KICAD_SEXPR_PARSER(
      text,
      aFileName,
      this.m_rootSheet,
      this.m_appending,
    );

    parser.ParseSchematic(aSheet);
    return true;
  }

  /** Parse copyable schematic content (the clipboard's) into \a aSheet. */
  LoadContent(aText: string, aSheet: SCH_SHEET, aFileVersion = SEXPR_SCHEMATIC_FILE_VERSION): void {
    const parser = new SCH_IO_KICAD_SEXPR_PARSER(aText);

    parser.ParseSchematic(aSheet, true, aFileVersion);
  }

  /**
   * Save \a aSheet's screen as a `.kicad_sch` and return the text (PRETTIFIED, as the
   * file formatter writes it).
   */
  SaveSchematicFile(aSheet: SCH_SHEET, aSchematic: SCHEMATIC): string {
    // Upstream offers "Save Anyway" when the group structure fails its check; there is no
    // one to ask here, so the save goes ahead.
    aSheet.GetScreen()!.GroupsSanityCheck();

    const formatter = new PRETTIFIED_STRING_FORMATTER();

    this.FormatSchematicToFormatter(formatter, aSheet, aSchematic);

    if (aSheet.GetScreen()) aSheet.GetScreen()!.SetFileExists(true);

    return formatter.Finish();
  }

  FormatSchematicToFormatter(
    aOut: OUTPUTFORMATTER,
    aSheet: SCH_SHEET,
    aSchematic: SCHEMATIC,
  ): void {
    this.init(aSchematic);

    this.m_out = aOut;

    this.Format(aSheet);

    this.m_out = null;
  }

  /** Format \a aSheet's screen. */
  Format(aSheet: SCH_SHEET): void {
    const schematic = this.m_schematic!;
    const out = this.m_out!;
    const sheets = schematic.Hierarchy();
    const screen = aSheet.GetScreen();

    if (!screen) return; // wxCHECK

    // If we've requested to embed the fonts in the schematic, do so.
    // Otherwise, clear the embedded fonts from the schematic.  Embedded
    // fonts will be used if available
    if (schematic.GetAreFontsEmbedded()) schematic.EmbedFonts();
    else schematic.GetEmbeddedFiles().ClearEmbeddedFonts();

    out.Print(
      `(kicad_sch (version ${SEXPR_SCHEMATIC_FILE_VERSION}) (generator ${out.Quotew(this.m_generator)}) (generator_version ${out.Quotew(GetMajorMinorVersion())})`,
    );

    FormatUuid(out, screen.m_uuid);

    screen.GetPageSettings().Format(out);
    screen.GetTitleBlock().Format(out);

    // Save cache library.
    out.Print('(lib_symbols');

    for (const libItemName of [...screen.GetLibSymbols().keys()].sort(cpCmp))
      SCH_IO_KICAD_SEXPR_LIB_CACHE.SaveSymbol(
        screen.GetLibSymbols().get(libItemName)!,
        out,
        libItemName,
      );

    out.Print(')');

    // Enforce item ordering: by type, then uuid (a std::multiset keeps equal ones in
    // insertion order).
    const save_map = [...screen.Items()]
      .filter((item) => item.Type() !== KICAD_T.SCH_MARKER_T)
      .map((item, i) => ({ item, i }))
      .sort((a, b) => {
        if (a.item.Type() !== b.item.Type()) return a.item.Type() - b.item.Type();

        if (a.item.m_Uuid !== b.item.m_Uuid) return a.item.m_Uuid < b.item.m_Uuid ? -1 : 1;

        return a.i - b.i;
      })
      .map((e) => e.item);

    for (const item of save_map) {
      switch (item.Type()) {
        case KICAD_T.SCH_SYMBOL_T:
          this.saveSymbol(item as SCH_SYMBOL, schematic, sheets, false);
          break;

        case KICAD_T.SCH_BITMAP_T:
          this.saveBitmap(item as SCH_BITMAP);
          break;

        case KICAD_T.SCH_SHEET_T:
          this.saveSheet(item as SCH_SHEET, sheets);
          break;

        case KICAD_T.SCH_JUNCTION_T:
          this.saveJunction(item as SCH_JUNCTION);
          break;

        case KICAD_T.SCH_NO_CONNECT_T:
          this.saveNoConnect(item as SCH_NO_CONNECT);
          break;

        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
        case KICAD_T.SCH_BUS_BUS_ENTRY_T:
          this.saveBusEntry(item as SCH_BUS_ENTRY_BASE);
          break;

        case KICAD_T.SCH_LINE_T:
          this.saveLine(item as SCH_LINE);
          break;

        case KICAD_T.SCH_SHAPE_T:
          this.saveShape(item as SCH_SHAPE);
          break;

        case KICAD_T.SCH_RULE_AREA_T:
          this.saveRuleArea(item as SCH_RULE_AREA);
          break;

        case KICAD_T.SCH_TEXT_T:
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
          this.saveText(item as SCH_TEXT);
          break;

        case KICAD_T.SCH_TEXTBOX_T:
          this.saveTextBox(item as SCH_TEXTBOX);
          break;

        case KICAD_T.SCH_TABLE_T:
          this.saveTable(item as SCH_TABLE);
          break;

        case KICAD_T.SCH_GROUP_T:
          this.saveGroup(item as SCH_GROUP);
          break;

        default:
          // wxASSERT( "Unexpected schematic object type in SCH_IO_KICAD_SEXPR::Format()" )
          break;
      }
    }

    if (aSheet.HasRootInstance()) {
      const instances: SCH_SHEET_INSTANCE[] = [aSheet.GetRootInstance()];

      this.saveInstances(instances);
    }

    // Save embedded files only in the first top-level sheet to avoid duplication
    if (schematic.GetTopLevelSheet(0) === aSheet) {
      FormatBool(out, 'embedded_fonts', schematic.GetAreFontsEmbedded());

      // Save any embedded files
      if (!schematic.GetEmbeddedFiles().IsEmpty()) schematic.WriteEmbeddedFiles(out, true);
    }

    out.Print(')');
  }

  protected saveSymbol(
    aSymbol: SCH_SYMBOL,
    aSchematic: SCHEMATIC,
    aSheetList: SCH_SHEET_LIST,
    aForClipboard: boolean,
    aRelativePath: SCH_SHEET_PATH | null = null,
  ): void {
    const out = this.m_out!;
    let libName: string;
    const symbol_name = aSymbol.GetLibId().Format();

    if (symbol_name.length) libName = toUTFTildaText(symbol_name);
    else libName = '_NONAME_';

    void libName;

    let angle: EDA_ANGLE;
    const orientation =
      aSymbol.GetOrientation() &
      ~(SYMBOL_ORIENTATION_T.SYM_MIRROR_X | SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);

    if (orientation === SYMBOL_ORIENTATION_T.SYM_ORIENT_90) angle = ANGLE_90;
    else if (orientation === SYMBOL_ORIENTATION_T.SYM_ORIENT_180) angle = ANGLE_180;
    else if (orientation === SYMBOL_ORIENTATION_T.SYM_ORIENT_270) angle = ANGLE_270;
    else angle = ANGLE_0;

    out.Print('(symbol');

    if (!aSymbol.UseLibIdLookup())
      out.Print(`(lib_name ${out.Quotew(aSymbol.GetSchSymbolLibraryName())})`);

    out.Print(
      `(lib_id ${out.Quotew(aSymbol.GetLibId().Format())}) (at ${IU(aSymbol.GetPosition().x)} ${IU(aSymbol.GetPosition().y)} ${FormatAngle(angle.AsDegrees())})`,
    );

    const mirrorX = (aSymbol.GetOrientation() & SYMBOL_ORIENTATION_T.SYM_MIRROR_X) !== 0;
    const mirrorY = (aSymbol.GetOrientation() & SYMBOL_ORIENTATION_T.SYM_MIRROR_Y) !== 0;

    if (mirrorX || mirrorY) out.Print(`(mirror ${mirrorX ? 'x' : ''} ${mirrorY ? 'y' : ''})`);

    // The symbol unit is always set to the ordianal instance regardless of the current
    // sheet instance to prevent file churn.
    let ordinalInstance = new SCH_SYMBOL_INSTANCE();

    ordinalInstance.m_Reference = aSymbol.GetPrefix();

    const parentScreen = aSymbol.GetParent() as unknown as SCH_SCREEN | null;

    if (parentScreen && this.m_schematic) {
      const ordinalPath = this.m_schematic.Hierarchy().GetOrdinalPath(parentScreen);

      if (ordinalPath) aSymbol.GetInstance(ordinalInstance, ordinalPath.Path());
      else if (aSymbol.GetInstances().length) ordinalInstance = aSymbol.GetInstances()[0]!.Clone();
    }

    let unit = ordinalInstance.m_Unit;

    if (aForClipboard && aRelativePath) {
      const unitInstance = new SCH_SYMBOL_INSTANCE();

      if (aSymbol.GetInstance(unitInstance, aRelativePath.Path())) unit = unitInstance.m_Unit;
    }

    out.Print(`(unit ${unit})`);
    out.Print(`(body_style ${aSymbol.GetBodyStyle()})`);

    FormatBool(out, 'exclude_from_sim', aSymbol.GetExcludedFromSim());
    FormatBool(out, 'in_bom', !aSymbol.GetExcludedFromBOM());
    FormatBool(out, 'on_board', !aSymbol.GetExcludedFromBoard());
    FormatBool(out, 'in_pos_files', !aSymbol.GetExcludedFromPosFiles());
    FormatBool(out, 'dnp', aSymbol.GetDNP());

    const fieldsAutoplaced = aSymbol.GetFieldsAutoplaced();

    if (
      fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
      fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
    )
      FormatBool(out, 'fields_autoplaced', true);

    FormatUuid(out, aSymbol.m_Uuid);

    const orderedFields: SCH_FIELD[] = [];
    aSymbol.GetFields(orderedFields, false);

    for (const field of orderedFields) {
      const id = field.GetId();
      const value = field.GetText();

      if (!aForClipboard && aSymbol.GetInstances().length) {
        // The instance fields are always set to the default instance regardless of the
        // sheet instance to prevent file churn.
        if (id === FIELD_T.REFERENCE) field.SetText(ordinalInstance.m_Reference);
      } else if (
        aForClipboard &&
        aSymbol.GetInstances().length &&
        aRelativePath &&
        id === FIELD_T.REFERENCE
      ) {
        const instance = new SCH_SYMBOL_INSTANCE();

        if (aSymbol.GetInstance(instance, aRelativePath.Path()))
          field.SetText(instance.m_Reference);
      }

      try {
        this.saveField(field);
      } finally {
        // Restore the changed field text on write error (and after).
        if (id === FIELD_T.REFERENCE) field.SetText(value);
      }
    }

    for (const pin of aSymbol.GetRawPins()) {
      if (pin.GetAlt() === '' || pin.GetAlt() === pin.GetBaseName()) {
        out.Print(`(pin ${out.Quotew(pin.GetNumber())}`);
        FormatUuid(out, pin.m_Uuid);
        out.Print(')');
      } else {
        out.Print(`(pin ${out.Quotew(pin.GetNumber())}`);
        FormatUuid(out, pin.m_Uuid);
        out.Print(`(alternate ${out.Quotew(pin.GetAlt())}))`);
      }
    }

    if (aSymbol.GetInstances().length > 0) {
      // std::map<KIID, …>: walked in uuid order
      const projectInstances = new Map<KIID, SCH_SYMBOL_INSTANCE[]>();
      const currentProjectKeys = new Set<KIID>();

      out.Print('(instances');

      let projectName: string;
      const rootSheetUuid = aSchematic.Root().m_Uuid;

      // Build the set of UUIDs that belong to the current project.  With the virtual
      // root, instance paths start with the top-level sheets' uuids.
      if (rootSheetUuid === niluuid) {
        for (const sheet of aSchematic.GetTopLevelSheets()) currentProjectKeys.add(sheet.m_Uuid);
      } else {
        currentProjectKeys.add(rootSheetUuid);
      }

      for (const inst of aSymbol.GetInstances()) {
        // Zero length KIID_PATH objects are not valid and will cause a crash below.
        if (!inst.m_Path.size()) continue; // wxCHECK2

        // If the instance data is part of this design but no longer has an associated
        // sheet path, don't save it.  This prevents large amounts of orphaned instance
        // data for the current project from accumulating in the schematic files.
        //
        // Keep all instance data when copying to the clipboard.  They may be needed on
        // paste.
        const pathToCheck = inst.m_Path.Clone();

        // A leading virtual root (nil uuid) is not a project key.
        if (rootSheetUuid === niluuid && !pathToCheck.empty() && pathToCheck.at(0) === niluuid) {
          if (pathToCheck.size() > 1) pathToCheck.eraseFirst();
          else continue;
        }

        if (pathToCheck.empty()) continue;

        const belongsToThisProject = currentProjectKeys.has(pathToCheck.at(0));
        const isOrphaned = belongsToThisProject && !aSheetList.GetSheetPathByKIIDPath(pathToCheck);

        if (!aForClipboard && isOrphaned) continue;

        const projectKey = pathToCheck.at(0);
        const it = projectInstances.get(projectKey);

        if (!it) projectInstances.set(projectKey, [inst]);
        else it.push(inst);
      }

      for (const uuid of [...projectInstances.keys()].sort(cpCmp)) {
        const instances = [...projectInstances.get(uuid)!];

        if (!instances.length) continue; // wxCHECK2

        // Sort project instances by KIID_PATH.
        instances.sort((aLhs, aRhs) => kiidPathCmp(aLhs.m_Path, aRhs.m_Path));

        if (currentProjectKeys.has(uuid))
          projectName = this.m_schematic!.Project().GetProjectName();
        else projectName = instances[0]!.m_ProjectName;

        out.Print(`(project ${out.Quotew(projectName)}`);

        for (const instance of instances) {
          const tmp = instance.m_Path.Clone();

          if (aForClipboard && aRelativePath) tmp.MakeRelativeTo(aRelativePath.Path());

          const path = tmp.AsString();

          out.Print(
            `(path ${out.Quotew(path)} (reference ${out.Quotew(instance.m_Reference)}) (unit ${instance.m_Unit})`,
          );

          if (instance.m_Variants.size > 0) {
            for (const name of [...instance.m_Variants.keys()].sort(cpCmp)) {
              const variant = instance.m_Variants.get(name)!;

              // A variant without differentials resolves identically to no variant,
              // writing it only keeps deleted variants alive across sessions.
              if (!variant.HasDifferentials(aSymbol)) continue;

              out.Print(`(variant (name ${out.Quotew(name)})`);

              if (variant.m_DNP !== aSymbol.GetDNP()) FormatBool(out, 'dnp', variant.m_DNP);

              if (variant.m_ExcludedFromSim !== aSymbol.GetExcludedFromSim())
                FormatBool(out, 'exclude_from_sim', variant.m_ExcludedFromSim);

              if (variant.m_ExcludedFromBOM !== aSymbol.GetExcludedFromBOM())
                FormatBool(out, 'in_bom', !variant.m_ExcludedFromBOM);

              if (variant.m_ExcludedFromBoard !== aSymbol.GetExcludedFromBoard())
                FormatBool(out, 'on_board', !variant.m_ExcludedFromBoard);

              if (variant.m_ExcludedFromPosFiles !== aSymbol.GetExcludedFromPosFiles())
                FormatBool(out, 'in_pos_files', !variant.m_ExcludedFromPosFiles);

              for (const fname of [...variant.m_Fields.keys()].sort(cpCmp)) {
                out.Print(
                  `(field (name ${out.Quotew(fname)}) (value ${out.Quotew(variant.m_Fields.get(fname)!)}))`,
                );
              }

              out.Print(')'); // Closes `variant` token.
            }
          }

          out.Print(')'); // Closes `path` token.
        }

        out.Print(')'); // Closes `project`.
      }

      out.Print(')'); // Closes `instances`.
    }

    out.Print(')'); // Closes `symbol`.
  }

  protected saveField(aField: SCH_FIELD): void {
    const out = this.m_out!;
    const fieldName = aField.GetCanonicalName();
    const pos = aField.GetPosition();

    out.Print(
      `(property ${aField.IsPrivate() ? 'private' : ''} ${out.Quotew(fieldName)} ${out.Quotew(aField.GetText())} (at ${IU(pos.x)} ${IU(pos.y)} ${FormatAngle(aField.GetTextAngle().AsDegrees())})`,
    );

    if (!aField.IsVisible()) FormatBool(out, 'hide', true);

    FormatBool(out, 'show_name', aField.IsNameShown());

    FormatBool(out, 'do_not_autoplace', !aField.CanAutoplace());

    if (
      !aField.IsDefaultFormatting() ||
      aField.GetTextHeight() !== schIUScale.milsToIU(DEFAULT_SIZE_TEXT)
    ) {
      aField.Format(out, 0);
    }

    out.Print(')'); // Closes `property` token
  }

  protected saveBitmap(aBitmap: SCH_BITMAP): void {
    const out = this.m_out!;
    const refImage = aBitmap.GetReferenceImage();
    const bitmapBase = refImage.GetImage();

    const image = bitmapBase.GetImageData();

    if (image === null) return; // wxCHECK_RET: "wxImage* is NULL"

    out.Print(`(image (at ${IU(refImage.GetPosition().x)} ${IU(refImage.GetPosition().y)})`);

    let scale = refImage.GetImageScale();

    // 20230121 or older file format versions assumed 300 image PPI at load/save.
    // Let's keep compatibility by changing image scale.
    if (SEXPR_SCHEMATIC_FILE_VERSION <= 20230121) scale = (scale * 300.0) / bitmapBase.GetPPI();

    if (scale !== 1.0) out.Print(`(scale ${formatG(refImage.GetImageScale(), 6)})`);

    FormatUuid(out, aBitmap.m_Uuid);

    const stream = bitmapBase.SaveImageData() ?? new Uint8Array(0);

    FormatStreamData(out, stream);

    out.Print(')'); // Closes image token.
  }

  protected saveSheet(aSheet: SCH_SHEET, aSheetList: SCH_SHEET_LIST): void {
    const out = this.m_out!;

    out.Print(
      `(sheet (at ${IU(aSheet.GetPosition().x)} ${IU(aSheet.GetPosition().y)}) (size ${IU(aSheet.GetSize().x)} ${IU(aSheet.GetSize().y)})`,
    );

    FormatBool(out, 'exclude_from_sim', aSheet.GetExcludedFromSim());
    FormatBool(out, 'in_bom', !aSheet.GetExcludedFromBOM());
    FormatBool(out, 'on_board', !aSheet.GetExcludedFromBoard());
    FormatBool(out, 'dnp', aSheet.GetDNP());

    const fieldsAutoplaced = aSheet.GetFieldsAutoplaced();

    if (
      fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
      fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
    )
      FormatBool(out, 'fields_autoplaced', true);

    const stroke = new STROKE_PARAMS(
      aSheet.GetBorderWidth(),
      LINE_STYLE.SOLID,
      aSheet.GetBorderColor(),
    );

    stroke.SetWidth(aSheet.GetBorderWidth());
    stroke.Format(out, schIUScale);

    const bg = aSheet.GetBackgroundColor();

    out.Print(
      `(fill (color ${KiROUND(bg.r * 255.0)} ${KiROUND(bg.g * 255.0)} ${KiROUND(bg.b * 255.0)} ${FormatDouble2Str(bg.a)}))`,
    );

    FormatUuid(out, aSheet.m_Uuid);

    for (const field of aSheet.GetFields()) this.saveField(field);

    for (const pin of aSheet.GetPins()) {
      out.Print(
        `(pin ${EscapedUTF8(pin.GetText())} ${getSheetPinShapeToken(pin.GetShape())} (at ${IU(pin.GetPosition().x)} ${IU(pin.GetPosition().y)} ${FormatAngle(getSheetPinAngle(pin.GetSide()).AsDegrees())})`,
      );

      FormatUuid(out, pin.m_Uuid);
      pin.Format(out, 0);
      out.Print(')'); // Closes pin token.
    }

    // Save all sheet instances here except the root sheet instance.
    const sheetInstances = aSheet.GetInstances().filter((i) => i.m_Path.size() !== 0);

    if (sheetInstances.length > 0) {
      out.Print('(instances');

      let lastProjectUuid: KIID = niluuid;
      const rootSheetUuid = this.m_schematic!.Root().m_Uuid;
      let inProjectClause = false;

      // With the virtual root, instance paths start with the top-level sheets' uuids.
      const currentProjectKeys = new Set<KIID>();

      if (rootSheetUuid === niluuid) {
        for (const sheet of this.m_schematic!.GetTopLevelSheets())
          currentProjectKeys.add(sheet.m_Uuid);
      } else {
        currentProjectKeys.add(rootSheetUuid);
      }

      for (let i = 0; i < sheetInstances.length; i++) {
        const inst = sheetInstances[i]!;

        // If the instance data is part of this design but no longer has an associated
        // sheet path, don't save it.  This prevents large amounts of orphaned instance
        // data for the current project from accumulating in the schematic files.
        //
        // The page number of the sheet is found on its parent's path, so the last sheet
        // is left off the look-up (aIncludeLastSheet = false).
        const belongsToThisProject =
          !inst.m_Path.empty() && currentProjectKeys.has(inst.m_Path.at(0));

        if (belongsToThisProject && !aSheetList.GetSheetPathByKIIDPath(inst.m_Path, false)) {
          if (
            inProjectClause &&
            (i + 1 === sheetInstances.length ||
              lastProjectUuid !== sheetInstances[i + 1]!.m_Path.at(0))
          ) {
            out.Print(')'); // Closes `project` token.
            inProjectClause = false;
          }

          continue;
        }

        if (lastProjectUuid !== inst.m_Path.at(0)) {
          let projectName: string;

          if (belongsToThisProject) projectName = this.m_schematic!.Project().GetProjectName();
          else projectName = inst.m_ProjectName;

          lastProjectUuid = inst.m_Path.at(0);
          out.Print(`(project ${out.Quotew(projectName)}`);
          inProjectClause = true;
        }

        const path = inst.m_Path.AsString();

        out.Print(`(path ${out.Quotew(path)} (page ${out.Quotew(inst.m_PageNumber)})`);

        if (inst.m_Variants.size > 0) {
          for (const name of [...inst.m_Variants.keys()].sort(cpCmp)) {
            const variant = inst.m_Variants.get(name)!;

            // A variant without differentials resolves identically to no variant,
            // writing it only keeps deleted variants alive across sessions.
            if (!variant.HasDifferentials(aSheet)) continue;

            out.Print(`(variant (name ${out.Quotew(name)})`);

            if (variant.m_DNP !== aSheet.GetDNP()) FormatBool(out, 'dnp', variant.m_DNP);

            if (variant.m_ExcludedFromSim !== aSheet.GetExcludedFromSim())
              FormatBool(out, 'exclude_from_sim', variant.m_ExcludedFromSim);

            if (variant.m_ExcludedFromBOM !== aSheet.GetExcludedFromBOM())
              FormatBool(out, 'in_bom', !variant.m_ExcludedFromBOM);

            for (const fname of [...variant.m_Fields.keys()].sort(cpCmp)) {
              out.Print(
                `(field (name ${out.Quotew(fname)}) (value ${out.Quotew(variant.m_Fields.get(fname)!)}))`,
              );
            }

            out.Print(')'); // Closes `variant` token.
          }
        }

        out.Print(')'); // Closes `path` token.

        if (
          inProjectClause &&
          (i + 1 === sheetInstances.length ||
            lastProjectUuid !== sheetInstances[i + 1]!.m_Path.at(0))
        ) {
          out.Print(')'); // Closes `project` token.
          inProjectClause = false;
        }
      }

      out.Print(')'); // Closes `instances` token.
    }

    out.Print(')'); // Closes sheet token.
  }

  protected saveJunction(aJunction: SCH_JUNCTION): void {
    const out = this.m_out!;
    const color = aJunction.GetColor();

    out.Print(
      `(junction (at ${IU(aJunction.GetPosition().x)} ${IU(aJunction.GetPosition().y)}) (diameter ${IU(aJunction.GetDiameter())}) (color ${KiROUND(color.r * 255.0)} ${KiROUND(color.g * 255.0)} ${KiROUND(color.b * 255.0)} ${FormatDouble2Str(color.a)})`,
    );

    FormatUuid(out, aJunction.m_Uuid);
    out.Print(')');
  }

  protected saveNoConnect(aNoConnect: SCH_NO_CONNECT): void {
    const out = this.m_out!;

    out.Print(
      `(no_connect (at ${IU(aNoConnect.GetPosition().x)} ${IU(aNoConnect.GetPosition().y)})`,
    );

    FormatUuid(out, aNoConnect.m_Uuid);
    out.Print(')');
  }

  protected saveBusEntry(aBusEntry: SCH_BUS_ENTRY_BASE): void {
    const out = this.m_out!;

    // Bus to bus entries are converted to bus line segments.
    if (aBusEntry.GetClass() === 'SCH_BUS_BUS_ENTRY') {
      const busEntryLine = new SCH_LINE(aBusEntry.GetPosition(), SCH_LAYER_ID.LAYER_BUS);

      busEntryLine.SetEndPoint(aBusEntry.GetEnd());
      this.saveLine(busEntryLine);
      return;
    }

    out.Print(
      `(bus_entry (at ${IU(aBusEntry.GetPosition().x)} ${IU(aBusEntry.GetPosition().y)}) (size ${IU(aBusEntry.GetSize().x)} ${IU(aBusEntry.GetSize().y)})`,
    );

    aBusEntry.GetStroke().Format(out, schIUScale);
    FormatUuid(out, aBusEntry.m_Uuid);
    out.Print(')');
  }

  protected saveShape(aShape: SCH_SHAPE): void {
    const out = this.m_out!;

    switch (aShape.GetShape()) {
      case SHAPE_T.ARC:
        formatArc(
          out,
          aShape,
          false,
          aShape.GetStroke(),
          aShape.GetFillMode(),
          aShape.GetFillColor(),
          false,
          aShape.m_Uuid,
        );
        break;

      case SHAPE_T.CIRCLE:
        formatCircle(
          out,
          aShape,
          false,
          aShape.GetStroke(),
          aShape.GetFillMode(),
          aShape.GetFillColor(),
          false,
          aShape.m_Uuid,
        );
        break;

      case SHAPE_T.RECTANGLE:
        formatRect(
          out,
          aShape,
          false,
          aShape.GetStroke(),
          aShape.GetFillMode(),
          aShape.GetFillColor(),
          false,
          aShape.m_Uuid,
        );
        break;

      case SHAPE_T.BEZIER:
        formatBezier(
          out,
          aShape,
          false,
          aShape.GetStroke(),
          aShape.GetFillMode(),
          aShape.GetFillColor(),
          false,
          aShape.m_Uuid,
        );
        break;

      case SHAPE_T.POLY:
        formatPoly(
          out,
          aShape,
          false,
          aShape.GetStroke(),
          aShape.GetFillMode(),
          aShape.GetFillColor(),
          false,
          aShape.m_Uuid,
        );
        break;

      default:
        throw new Error(`UNIMPLEMENTED_FOR( ${aShape.SHAPE_T_asString()} )`);
    }
  }

  protected saveRuleArea(aRuleArea: SCH_RULE_AREA): void {
    const out = this.m_out!;

    out.Print('(rule_area ');

    FormatBool(out, 'exclude_from_sim', aRuleArea.GetExcludedFromSim());
    FormatBool(out, 'in_bom', !aRuleArea.GetExcludedFromBOM());
    FormatBool(out, 'on_board', !aRuleArea.GetExcludedFromBoard());
    FormatBool(out, 'dnp', aRuleArea.GetDNP());

    this.saveShape(aRuleArea);

    out.Print(')');
  }

  protected saveLine(aLine: SCH_LINE): void {
    const out = this.m_out!;
    let lineType: string;
    const line_stroke = aLine.GetStroke();

    switch (aLine.GetLayer()) {
      case SCH_LAYER_ID.LAYER_BUS:
        lineType = 'bus';
        break;
      case SCH_LAYER_ID.LAYER_WIRE:
        lineType = 'wire';
        break;
      case SCH_LAYER_ID.LAYER_NOTES:
        lineType = 'polyline';
        break;
      default:
        throw new Error(`UNIMPLEMENTED_FOR( layer ${aLine.GetLayer()} )`);
    }

    out.Print(
      `(${lineType} (pts (xy ${IU(aLine.GetStartPoint().x)} ${IU(aLine.GetStartPoint().y)}) (xy ${IU(aLine.GetEndPoint().x)} ${IU(aLine.GetEndPoint().y)}))`,
    );

    line_stroke.Format(out, schIUScale);
    FormatUuid(out, aLine.m_Uuid);
    out.Print(')');
  }

  protected saveText(aText: SCH_TEXT): void {
    const out = this.m_out!;
    const label = aText instanceof SCH_LABEL_BASE ? aText : null;

    out.Print(`(${getTextTypeToken(aText.Type())} ${out.Quotew(aText.GetText())}`);

    if (aText.Type() === KICAD_T.SCH_TEXT_T)
      FormatBool(out, 'exclude_from_sim', aText.GetExcludedFromSim());

    if (aText.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T) {
      const flag = aText as SCH_DIRECTIVE_LABEL;

      out.Print(`(length ${IU(flag.GetPinLength())})`);
    }

    let angle = aText.GetTextAngle();

    if (label) {
      if (
        label.Type() === KICAD_T.SCH_GLOBAL_LABEL_T ||
        label.Type() === KICAD_T.SCH_HIER_LABEL_T ||
        label.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T
      ) {
        out.Print(`(shape ${getSheetPinShapeToken(label.GetShape())})`);
      }

      // The angle of the text is always 0 or 90 degrees for readibility reasons,
      // but the item itself can have more rotation (-90 and 180 deg)
      switch (Number(label.GetSpinStyle())) {
        case SPIN_STYLE.UP:
        case SPIN_STYLE.RIGHT:
          break;
        default: // LEFT, BOTTOM
          angle = angle.add(ANGLE_180);
          break;
      }
    }

    out.Print(
      `(at ${IU(aText.GetPosition().x)} ${IU(aText.GetPosition().y)} ${FormatAngle(angle.AsDegrees())})`,
    );

    if (label && label.GetFields().length > 0) {
      const fieldsAutoplaced = label.GetFieldsAutoplaced();

      if (
        fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
        fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
      )
        FormatBool(out, 'fields_autoplaced', true);
    }

    EDA_TEXT.prototype.Format.call(aText, out, 0);
    FormatUuid(out, aText.m_Uuid);

    if (label) {
      for (const field of label.GetFields()) this.saveField(field);
    }

    out.Print(')'); // Closes text token.
  }

  protected saveTextBox(aTextBox: SCH_TEXTBOX): void {
    const out = this.m_out!;

    out.Print(
      `(${aTextBox.Type() === KICAD_T.SCH_TABLECELL_T ? 'table_cell' : 'text_box'} ${out.Quotew(aTextBox.GetText())}`,
    );

    FormatBool(out, 'exclude_from_sim', aTextBox.GetExcludedFromSim());

    const pos = aTextBox.GetStart();
    const end = aTextBox.GetEnd();
    const size = { x: end.x - pos.x, y: end.y - pos.y };

    out.Print(
      `(at ${IU(pos.x)} ${IU(pos.y)} ${FormatAngle(aTextBox.GetTextAngle().AsDegrees())}) (size ${IU(size.x)} ${IU(size.y)}) (margins ${IU(aTextBox.GetMarginLeft())} ${IU(aTextBox.GetMarginTop())} ${IU(aTextBox.GetMarginRight())} ${IU(aTextBox.GetMarginBottom())})`,
    );

    if (aTextBox instanceof SCH_TABLECELL)
      out.Print(`(span ${aTextBox.GetColSpan()} ${aTextBox.GetRowSpan()})`);

    if (aTextBox.Type() !== KICAD_T.SCH_TABLECELL_T) aTextBox.GetStroke().Format(out, schIUScale);

    formatFill(out, aTextBox.GetFillMode(), aTextBox.GetFillColor());
    EDA_TEXT.prototype.Format.call(aTextBox, out, 0);
    FormatUuid(out, aTextBox.m_Uuid);
    out.Print(')');
  }

  protected saveTable(aTable: SCH_TABLE): void {
    const out = this.m_out!;
    const skip = (aTable.GetFlags() & SKIP_STRUCT) !== 0;

    if (skip) {
      aTable = aTable.Clone() as SCH_TABLE;

      let minCol = aTable.GetColCount();
      let maxCol = -1;
      let minRow = aTable.GetRowCount();
      let maxRow = -1;

      for (let row = 0; row < aTable.GetRowCount(); ++row) {
        for (let col = 0; col < aTable.GetColCount(); ++col) {
          const cell = aTable.GetCell(row, col)!;

          if (cell.IsSelected()) {
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
          } else {
            cell.SetFlags(STRUCT_DELETED);
          }
        }
      }

      if (!(maxCol >= minCol && maxRow >= minRow)) return; // wxCHECK_MSG: "No selected cells!"

      let destRow = 0;

      for (let row = minRow; row <= maxRow; row++)
        aTable.SetRowHeight(destRow++, aTable.GetRowHeight(row));

      let destCol = 0;

      for (let col = minCol; col <= maxCol; col++)
        aTable.SetColWidth(destCol++, aTable.GetColWidth(col));

      aTable.DeleteMarkedCells();
      aTable.SetColCount(maxCol - minCol + 1);
    }

    out.Print(`(table (column_count ${aTable.GetColCount()})`);

    out.Print('(border');
    FormatBool(out, 'external', aTable.StrokeExternal());
    FormatBool(out, 'header', aTable.StrokeHeaderSeparator());

    if (aTable.StrokeExternal() || aTable.StrokeHeaderSeparator())
      aTable.GetBorderStroke().Format(out, schIUScale);

    out.Print(')'); // Close `border` token.

    out.Print('(separators');
    FormatBool(out, 'rows', aTable.StrokeRows());
    FormatBool(out, 'cols', aTable.StrokeColumns());

    if (aTable.StrokeRows() || aTable.StrokeColumns())
      aTable.GetSeparatorsStroke().Format(out, schIUScale);

    out.Print(')'); // Close `separators` token.

    out.Print('(column_widths');

    for (let col = 0; col < aTable.GetColCount(); ++col)
      out.Print(` ${IU(aTable.GetColWidth(col))}`);

    out.Print(')');

    out.Print('(row_heights');

    for (let row = 0; row < aTable.GetRowCount(); ++row)
      out.Print(` ${IU(aTable.GetRowHeight(row))}`);

    out.Print(')');

    FormatUuid(out, aTable.m_Uuid);

    out.Print('(cells');

    for (const cell of aTable.GetCells()) this.saveTextBox(cell);

    out.Print(')'); // Close `cells` token.
    out.Print(')'); // Close `table` token.
  }

  protected saveGroup(aGroup: SCH_GROUP): void {
    const out = this.m_out!;

    // Don't write empty groups
    if (aGroup.GetItems().size === 0) return;

    out.Print(`(group ${out.Quotew(aGroup.GetName())}`);

    FormatUuid(out, aGroup.m_Uuid);

    if (aGroup.IsLocked()) FormatBool(out, 'locked', true);

    if (aGroup.HasDesignBlockLink())
      out.Print(`(lib_id "${aGroup.GetDesignBlockLibId().Format()}")`);

    const memberIds: string[] = [];

    for (const member of aGroup.GetItems()) memberIds.push(member.m_Uuid);

    memberIds.sort(cpCmp);

    out.Print('(members');

    for (const memberId of memberIds) out.Print(` ${out.Quotew(memberId)}`);

    out.Print(')'); // Close `members` token.
    out.Print(')'); // Close `group` token.
  }

  protected saveInstances(aInstances: readonly SCH_SHEET_INSTANCE[]): void {
    const out = this.m_out!;

    if (aInstances.length) {
      out.Print('(sheet_instances');

      for (const instance of aInstances) {
        let path = instance.m_Path.AsString();

        if (path === '') path = '/'; // Root path

        out.Print(`(path ${out.Quotew(path)} (page ${out.Quotew(instance.m_PageNumber)}))`);
      }

      out.Print(')'); // Close sheet instances token.
    }
  }

  /** `ParseLibSymbols( aSymbolText, aSource, aFileVersion )`: the symbols in a text. */
  static ParseLibSymbols(
    aSymbolText: string,
    aSource: string,
    aFileVersion = SEXPR_SCHEMATIC_FILE_VERSION,
  ): LIB_SYMBOL[] {
    const map: LIB_SYMBOL_MAP = new Map();
    const newSymbols: LIB_SYMBOL[] = [];
    const parser = new SCH_IO_KICAD_SEXPR_PARSER(aSymbolText, aSource);

    let newSymbol: LIB_SYMBOL | null;

    do {
      newSymbol = parser.ParseSymbol(map, aFileVersion);

      if (newSymbol) newSymbols.push(newSymbol);
    } while (newSymbol);

    return newSymbols;
  }

  static FormatLibSymbol(symbol: LIB_SYMBOL, formatter: OUTPUTFORMATTER): void {
    SCH_IO_KICAD_SEXPR_LIB_CACHE.SaveSymbol(symbol, formatter);
  }
}
