// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/ltspice/ltspice_schematic.{h,cpp}`: `LTSPICE_SCHEMATIC`, which reads an
 * LTspice `.asc` and the `.asy` symbols it places into the intermediate `LT_ASC` structures that
 * SCH_IO_LTSPICE_PARSER turns into KiCad items, and `LTSPICE_FILE`, one placed element.
 *
 * Upstream's nested enums and structs (`LTSPICE_SCHEMATIC::LINESTYLE`, `::LT_SYMBOL` …) are
 * exported at module level under the same names.
 *
 * Files are read through the plugin's file source and folders listed through its lister; upstream
 * walks them with wxDir, whose order is the file system's - so when two library folders hold a
 * symbol of the same bare name, the one kept here (the lister's order) may differ.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { IO_DIR_LISTER, IO_FILE_READER } from '@ziroeda/common/io/io_base.js';
import { RPT_SEVERITY_ERROR, type Reporter } from '@ziroeda/common/reporter.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PATH } from '../../sch_sheet_path.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SCH_IO_LTSPICE_PARSER } from './sch_io_ltspice_parser.js';

const INT_MAX = 2147483647;

// ---------------------------------------------------------------------------------------------
// wx helpers the reader depends on
// ---------------------------------------------------------------------------------------------

/**
 * `wxSplit( aStr, aSep )` with the default `\` escape, as wx 3.2 behaves (measured by
 * qa/probes/wxsplit_probe.cpp): an empty string gives no tokens; `\` before the separator keeps it
 * as text and is dropped; a doubled `\\` is one `\` and escapes nothing after it; a trailing
 * separator gives a final empty token.
 */
export function wxSplit(aStr: string, aSep: string, aEscape = '\\'): string[] {
  if (aStr.length === 0) return [];

  const out: string[] = [];
  let cur = '';
  let pendingEscape = false;

  for (const ch of aStr) {
    if (ch === aSep) {
      if (pendingEscape) {
        cur = cur.slice(0, -1) + aSep;
      } else {
        out.push(cur);
        cur = '';
      }

      pendingEscape = false;
    } else if (aEscape !== '' && ch === aEscape) {
      // The second of a pair is swallowed.
      if (!pendingEscape) cur += ch;

      pendingEscape = !pendingEscape;
    } else {
      cur += ch;
      pendingEscape = false;
    }
  }

  out.push(cur);
  return out;
}

/** `wxString::ToLong( &val )` (base 10): whether the whole string is a number, and what strtol
 * read - stored even when the parse fails. */
export function wxToLong(aStr: string): { ok: boolean; value: number } {
  const m = /^[ \t\n\v\f\r]*([+-]?)(\d+)/.exec(aStr);

  if (!m) return { ok: false, value: 0 };

  let v = Number(m[2]);

  if (m[1] === '-') v = -v;

  const LONG_MAX = 2 ** 63;
  let range = true;

  if (v >= LONG_MAX) {
    v = LONG_MAX;
    range = false;
  } else if (v < -LONG_MAX) {
    v = -LONG_MAX;
    range = false;
  }

  return { ok: m[0].length === aStr.length && range, value: v };
}

/** `(int)` of a long: the low 32 bits, two's complement. */
function toInt(aValue: number): number {
  return Number(BigInt.asIntN(32, BigInt(Math.trunc(aValue))));
}

/** `wxString::Upper()` / `Lower()`. */
const upper = (s: string): string => s.toUpperCase();
const lower = (s: string): string => s.toLowerCase();

/** `std::map<wxString, wxString>::operator[]` read: inserts an empty value when absent. */
function mapAt(aMap: Map<string, string>, aKey: string): string {
  if (!aMap.has(aKey)) aMap.set(aKey, '');

  return aMap.get(aKey)!;
}

/**
 * `SafeReadFile( aPath, "r" )` (richio.cpp): a missing file throws; UTF-16LE when the second byte
 * is zero, else UTF-8, falling back to CP1252 when that fails or reads nothing; `\r\r\n` becomes
 * `\n`.
 */
export function SafeReadFile(aReadFile: IO_FILE_READER, aFilePath: string): string {
  const data = aFilePath === '' ? null : aReadFile(aFilePath);

  if (!data) throw new IO_ERROR(`File '${aFilePath}' does not exist.`);

  const utf16le = data.length < 2 || data[1] === 0;
  let contents = '';
  let readOk = true;

  try {
    contents = new TextDecoder(utf16le ? 'utf-16le' : 'utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(data);
  } catch {
    readOk = false;
  }

  if (!readOk || contents === '') {
    // wxConvAuto( CP1252 ): a BOM picks its encoding, else UTF-8, else the fallback.
    contents = decodeConvAuto(data);
  }

  if (contents === '') throw new IO_ERROR(`Unable to read file '${aFilePath}'.`);

  return contents.replaceAll('\r\r\n', '\n');
}

function decodeConvAuto(aData: Uint8Array): string {
  if (aData.length >= 3 && aData[0] === 0xef && aData[1] === 0xbb && aData[2] === 0xbf)
    return new TextDecoder('utf-8').decode(aData.subarray(3));

  if (aData.length >= 2 && aData[0] === 0xff && aData[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(aData.subarray(2));

  if (aData.length >= 2 && aData[0] === 0xfe && aData[1] === 0xff)
    return new TextDecoder('utf-16be').decode(aData.subarray(2));

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(aData);
  } catch {
    return new TextDecoder('windows-1252').decode(aData);
  }
}

/** `wxFileName( aDir, aName ).GetFullPath()`. */
export function joinPath(aDir: string, aName: string): string {
  if (aDir === '') return aName;

  return aDir.endsWith('/') ? aDir + aName : `${aDir}/${aName}`;
}

/** `wxFileName::GetExt()` / `GetName()` of a bare file name (a leading dot is part of the name). */
function splitName(aFileName: string): { name: string; ext: string } {
  const dot = aFileName.lastIndexOf('.');

  if (dot <= 0) return { name: aFileName, ext: '' };

  return { name: aFileName.substring(0, dot), ext: aFileName.substring(dot + 1) };
}

// ---------------------------------------------------------------------------------------------
// LTSPICE_FILE
// ---------------------------------------------------------------------------------------------

export class LTSPICE_FILE {
  ElementName: string;
  Offset: VECTOR2I;
  ParentIndex = 0;
  Sheet: SCH_SHEET | null = null;
  Screen: SCH_SCREEN | null = null;
  SheetPath = new SCH_SHEET_PATH();

  constructor(aElementName: string, aOffset: VECTOR2I) {
    this.ElementName = lower(aElementName);
    this.Offset = { x: aOffset.x, y: aOffset.y };
  }

  /** The C++ struct is copied by value into the queue and the vector. */
  copy(): LTSPICE_FILE {
    const f = new LTSPICE_FILE(this.ElementName, this.Offset);
    f.ParentIndex = this.ParentIndex;
    f.Sheet = this.Sheet;
    f.Screen = this.Screen;
    f.SheetPath = new SCH_SHEET_PATH(this.SheetPath);
    return f;
  }
}

// ---------------------------------------------------------------------------------------------
// LTSPICE_SCHEMATIC's enums and structs
// ---------------------------------------------------------------------------------------------

export enum LINESTYLE {
  SOLID = 0,
  DASH = 1,
  DOT = 2,
  DASHDOT = 3,
  DASHDOTDOT = 4,
}

export enum LINEWIDTH {
  Normal = 5,
  Wide = 10,
}

/** Polarity of an IOPIN. */
export enum POLARITY {
  PIN_INPUT, // IN POLARITY
  OUTPUT, // OUT POLARITY
  BIDIR, // BI-DIRECTIONAL POLARITY
}

/** Only CELL and BLOCK have been seen in the wild. */
export enum SYMBOLTYPE {
  CELL,
  BLOCK,
}

/** The ways a PIN or a TEXT can be justified. */
export enum JUSTIFICATION {
  NONE,
  BOTTOM,
  LEFT,
  RIGHT,
  CENTER,
  TOP,
  VBOTTOM, // Vertical Bottom Justification
  VLEFT, // Vertical Left Justification
  VRIGHT, // Vertical Right Justification
  VCENTER, // Vertical Center Justification
  VTOP, // Vertical Top Justification.
  INVISIBLE,
}

/** The rotations and mirrors an LT_SYMBOL can carry. */
export enum ORIENTATION {
  R0, // 0 degree rotation
  R90, // 90 degree rotatioin.
  R180, // 180 degree rotation.
  R270, // 270 degree rotation.
  M0, // 0 degree mirror
  M90, // 90 degree mirror
  M180, // 180 degree mirror
  M270, // 270 degree mirror
}

export interface LINE {
  Start: VECTOR2I;
  End: VECTOR2I;
  LineWidth: LINEWIDTH;
  LineStyle: LINESTYLE;
}

export interface LT_PIN {
  PinLocation: VECTOR2I;
  PinJustification: JUSTIFICATION;
  NameOffSet: number;
  /** std::map: iterated sorted, read with operator[]. */
  PinAttribute: Map<string, string>;
}

/** A circle, given as the rectangle around it. */
export interface CIRCLE {
  TopLeft: VECTOR2I;
  BotRight: VECTOR2I;
  LineWidth: LINEWIDTH;
  LineStyle: LINESTYLE;
}

export interface LT_WINDOW {
  WindowNumber: number;
  FontSize: number;
  Position: VECTOR2I;
  Justification: JUSTIFICATION;
}

/** An arc: the rectangle around its circle, and its two ends on that rectangle. */
export interface ARC {
  TopLeft: VECTOR2I;
  BotRight: VECTOR2I;
  ArcStart: VECTOR2I;
  ArcEnd: VECTOR2I;
  LineWidth: LINEWIDTH;
  LineStyle: LINESTYLE;
}

export interface RECTANGLE {
  TopLeft: VECTOR2I;
  BotRight: VECTOR2I;
  LineWidth: LINEWIDTH;
  LineStyle: LINESTYLE;
}

export interface WIRE {
  Start: VECTOR2I;
  End: VECTOR2I;
}

export interface FLAG {
  Offset: VECTOR2I;
  FontSize: number;
  Value: string;
}

export interface DATAFLAG {
  Offset: VECTOR2I;
  FontSize: number;
  Expression: string;
}

export interface TEXT {
  Offset: VECTOR2I;
  Justification: JUSTIFICATION;
  FontSize: number;
  Value: string;
}

/** A special contact used for IO. */
export interface IOPIN {
  Location: VECTOR2I;
  Polarity: POLARITY;
}

export interface BUSTAP {
  Start: VECTOR2I;
  End: VECTOR2I;
}

export interface LT_SYMBOL {
  Name: string;
  SymbolType: SYMBOLTYPE;
  Offset: VECTOR2I;
  SymAttributes: Map<string, string>;
  Pins: LT_PIN[];
  Lines: LINE[];
  Circles: CIRCLE[];
  Windows: LT_WINDOW[];
  Arcs: ARC[];
  Rectangles: RECTANGLE[];
  Wires: WIRE[];
  SymbolOrientation: ORIENTATION;
}

export interface LT_ASC {
  SheetSize: VECTOR2I;
  Version: number;
  VersionMinor: number;
  SheetNumber: number;
  Symbols: LT_SYMBOL[];
  Lines: LINE[];
  Circles: CIRCLE[];
  Windows: LT_WINDOW[];
  Arcs: ARC[];
  Rectangles: RECTANGLE[];
  Wires: WIRE[];
  Flags: FLAG[];
  DataFlags: DATAFLAG[];
  Iopins: IOPIN[];
  Bustap: BUSTAP[];
  Texts: TEXT[];
  BoundingBox: BOX2I;
}

/** A default-constructed LT_SYMBOL: enums and the offset uninitialised upstream, zero here. */
export function newLtSymbol(): LT_SYMBOL {
  return {
    Name: '',
    SymbolType: SYMBOLTYPE.CELL,
    Offset: { x: 0, y: 0 },
    SymAttributes: new Map(),
    Pins: [],
    Lines: [],
    Circles: [],
    Windows: [],
    Arcs: [],
    Rectangles: [],
    Wires: [],
    SymbolOrientation: ORIENTATION.R0,
  };
}

export function newLtAsc(): LT_ASC {
  return {
    SheetSize: { x: 0, y: 0 },
    Version: 0,
    VersionMinor: 0,
    SheetNumber: 0,
    Symbols: [],
    Lines: [],
    Circles: [],
    Windows: [],
    Arcs: [],
    Rectangles: [],
    Wires: [],
    Flags: [],
    DataFlags: [],
    Iopins: [],
    Bustap: [],
    Texts: [],
    BoundingBox: new BOX2I(),
  };
}

const pt = (p: VECTOR2I): VECTOR2I => ({ x: p.x, y: p.y });

/** An LT_SYMBOL copied by value, as `std::vector<LT_SYMBOL> symbols = lt_asc.Symbols` does. */
export function copyLtSymbol(s: LT_SYMBOL): LT_SYMBOL {
  return {
    Name: s.Name,
    SymbolType: s.SymbolType,
    Offset: pt(s.Offset),
    SymAttributes: new Map(s.SymAttributes),
    Pins: s.Pins.map((p) => ({
      ...p,
      PinLocation: pt(p.PinLocation),
      PinAttribute: new Map(p.PinAttribute),
    })),
    Lines: s.Lines.map((l) => ({ ...l, Start: pt(l.Start), End: pt(l.End) })),
    Circles: s.Circles.map((c) => ({ ...c, TopLeft: pt(c.TopLeft), BotRight: pt(c.BotRight) })),
    Windows: s.Windows.map((w) => ({ ...w, Position: pt(w.Position) })),
    Arcs: s.Arcs.map((a) => ({
      ...a,
      TopLeft: pt(a.TopLeft),
      BotRight: pt(a.BotRight),
      ArcStart: pt(a.ArcStart),
      ArcEnd: pt(a.ArcEnd),
    })),
    Rectangles: s.Rectangles.map((r) => ({
      ...r,
      TopLeft: pt(r.TopLeft),
      BotRight: pt(r.BotRight),
    })),
    Wires: s.Wires.map((w) => ({ Start: pt(w.Start), End: pt(w.End) })),
    SymbolOrientation: s.SymbolOrientation,
  };
}

// ASC SYMBOL lines look like: SYMBOL [folder\]name ...
// Examples: "res", "Misc\signal", "SomeFolder\opamp".
//
// We index each .asy under its real path and as a bare name.  If the ASC uses a
// folder that is not in the LTspice library tree, try the bare name so the same
// symbol still loads.
function resolveAsyMapKey(aMap: Map<string, string>, aName: string): string {
  const key = lower(aName).replaceAll('\\', '/');

  if (aMap.has(key)) return key;

  const slash = key.lastIndexOf('/');
  const base = slash < 0 ? key : key.substring(slash + 1);

  if (base !== '' && aMap.has(base)) return base;

  return '';
}

// ---------------------------------------------------------------------------------------------
// LTSPICE_SCHEMATIC
// ---------------------------------------------------------------------------------------------

export class LTSPICE_SCHEMATIC {
  private m_reporter: Reporter | null;
  private m_schematic: SCHEMATIC | null = null;
  private m_ltspiceDataDir: string;
  private m_readFile: IO_FILE_READER;
  private m_listDir: IO_DIR_LISTER;
  private m_fileCache = new Map<string, Map<string, string>>();

  constructor(
    _aFilename: string,
    aLTspiceDataDir: string,
    aReporter: Reporter | null,
    aReadFile: IO_FILE_READER,
    aListDir: IO_DIR_LISTER,
  ) {
    this.m_reporter = aReporter;
    this.m_ltspiceDataDir = aLTspiceDataDir;
    this.m_readFile = aReadFile;
    this.m_listDir = aListDir;
  }

  private fileCache(aKey: string): Map<string, string> {
    let m = this.m_fileCache.get(aKey);

    if (!m) {
      m = new Map();
      this.m_fileCache.set(aKey, m);
    }

    return m;
  }

  private readFile(aPath: string): string {
    return SafeReadFile(this.m_readFile, aPath);
  }

  /**
   * Load the `.asc` (and every sub-schematic it places) into aRootSheet. aLibraryFileName is the
   * schematic's own path: its folder is searched first, ahead of the LTspice library.
   */
  Load(
    aSchematic: SCHEMATIC,
    aRootSheet: SCH_SHEET,
    aLibraryFileName: string,
    aReporter: Reporter | null,
  ): void {
    const mapOfAscFiles = new Map<string, string>();
    const mapOfAsyFiles = new Map<string, string>();
    const slash = aLibraryFileName.lastIndexOf('/');
    const libraryDir = slash < 0 ? '' : aLibraryFileName.substring(0, slash);
    const libraryName = splitName(aLibraryFileName.substring(slash + 1)).name;

    // Library paths to search (Give highest priority to files contained in same directory)
    this.GetAscAndAsyFilePaths(libraryDir, false, mapOfAscFiles, mapOfAsyFiles);

    // TODO: Custom paths go here (non-recursive)

    // Default LTspice libs
    if (this.m_ltspiceDataDir !== '') {
      this.GetAscAndAsyFilePaths(
        joinPath(this.m_ltspiceDataDir, 'sub'),
        true,
        mapOfAscFiles,
        mapOfAsyFiles,
      );
      this.GetAscAndAsyFilePaths(
        joinPath(this.m_ltspiceDataDir, 'sym'),
        true,
        mapOfAscFiles,
        mapOfAsyFiles,
      );
    }

    this.m_schematic = aSchematic;

    const ascFileQueue: string[] = [lower(libraryName)];

    const rootAscFile = new LTSPICE_FILE(ascFileQueue[0]!, { x: 0, y: 0 });

    rootAscFile.Sheet = aRootSheet;
    rootAscFile.Screen = new SCH_SCREEN();

    let parentSheetIndex = 0;

    // Asc files who are subschematic in nature
    const ascFiles: LTSPICE_FILE[] = [rootAscFile.copy()];

    while (ascFileQueue.length > 0) {
      let screen: SCH_SCREEN | null = null;

      // Reading the .asc file
      const ascFilePath = mapAt(mapOfAscFiles, ascFileQueue[0]!);
      const buffer = this.readFile(ascFilePath);

      const newSubSchematicElements = this.GetSchematicElements(buffer).filter(
        (ii) => mapAt(mapOfAscFiles, ii.ElementName) !== '',
      );

      for (const newSubSchematicElement of newSubSchematicElements) {
        const asyName = newSubSchematicElement.ElementName;
        const asyKey = resolveAsyMapKey(mapOfAsyFiles, asyName);

        if (asyKey === '') continue;

        const asyBuffer = this.readFile(mapOfAsyFiles.get(asyKey)!);

        if (this.IsAsySubsheet(asyBuffer)) {
          if (!screen) screen = new SCH_SCREEN(this.m_schematic);

          newSubSchematicElement.ParentIndex = parentSheetIndex;
          newSubSchematicElement.Screen = screen;
          newSubSchematicElement.Sheet = new SCH_SHEET();

          ascFileQueue.push(newSubSchematicElement.ElementName);
          ascFiles.push(newSubSchematicElement.copy());
        }
      }

      ascFileQueue.shift();

      parentSheetIndex++;
    }

    for (let i = 0; i < ascFiles.length; i++) {
      // Reading the .asc file
      const buffer = this.readFile(mapAt(mapOfAscFiles, ascFiles[i]!.ElementName));

      // Getting the keywords to read
      {
        const sourceFiles = this.GetSchematicElements(buffer);

        this.m_fileCache.set('asyFiles', this.ReadAsyFiles(sourceFiles, mapOfAsyFiles));
        this.fileCache('ascFiles').set('parentFile', buffer);
      }

      let curSheetPath = new SCH_SHEET_PATH();
      const parser = new SCH_IO_LTSPICE_PARSER(this);

      if (i > 0) {
        const curSheet = ascFiles[i]!.Sheet!;
        const tempAsyMap = this.ReadAsyFile(ascFiles[i]!, mapOfAsyFiles);
        const ascFileName = ascFiles[i]!.ElementName;
        const dummyAsc = newLtAsc();
        const tempSymbol = this.SymbolBuilder(
          ascFileName,
          mapAt(tempAsyMap, ascFileName),
          dummyAsc,
        );
        const tempLibSymbol = new LIB_SYMBOL(ascFiles[i]!.ElementName);

        parser.CreateSymbol(tempSymbol, tempLibSymbol);

        const bbox = tempLibSymbol.GetBoundingBox();
        const origin = bbox.GetOrigin();
        const at = parser.ToKicadCoords(ascFiles[i]!.Offset);

        curSheet.SetSize(bbox.GetSize());
        curSheet.SetPosition({ x: at.x + origin.x, y: at.y + origin.y });
        curSheet.SetParent(ascFiles[ascFiles[i]!.ParentIndex]!.Sheet);

        const sheetNameField = curSheet.GetField(FIELD_T.SHEET_NAME)!;
        const fileNameSheet = curSheet.GetField(FIELD_T.SHEET_FILENAME)!;
        const sheetName = `${ascFiles[i]!.ElementName}-subsheet-${i}`;

        sheetNameField.SetText(sheetName);
        fileNameSheet.SetText(`${sheetName}.kicad_sch`);

        curSheet.SetScreen(ascFiles[i]!.Screen);

        curSheetPath = new SCH_SHEET_PATH(ascFiles[ascFiles[i]!.ParentIndex]!.SheetPath);
        curSheetPath.push_back(curSheet);

        ascFiles[i]!.SheetPath = new SCH_SHEET_PATH(curSheetPath);

        ascFiles[ascFiles[i]!.ParentIndex]!.Sheet!.GetScreen()!.Append(curSheet);

        curSheet
          .GetScreen()!
          .SetFileName(`${this.m_schematic.Project().GetProjectPath()}${sheetName}.kicad_sch`);
      } else {
        const curSheet = ascFiles[i]!.Sheet!;

        ascFiles[i]!.SheetPath.push_back(curSheet);
        curSheetPath = new SCH_SHEET_PATH(ascFiles[i]!.SheetPath);
      }

      const subSchematicAsyFiles: string[] = ascFiles.map((ascFile) => ascFile.ElementName);

      try {
        const lt_ascs = this.StructureBuilder();
        parser.Parse(curSheetPath, lt_ascs, subSchematicAsyFiles);
      } catch (e) {
        if (!(e instanceof IO_ERROR)) throw e;

        aReporter?.Report(e.What(), RPT_SEVERITY_ERROR);
      }
    }
  }

  /** Index every `.asc` and `.asy` in aDir (and, recursively, below it) under `dir1/dir2/cmp`,
   * `dir2/cmp` and `cmp`; the first found under a key wins. */
  GetAscAndAsyFilePaths(
    aDir: string,
    aRecursive: boolean,
    aMapOfAscFiles: Map<string, string>,
    aMapOfAsyFiles: Map<string, string>,
    aBaseDirs: string[] = [],
  ): void {
    const names = this.m_listDir(aDir);

    if (!names) return;

    const isDir = (aName: string): boolean => this.m_listDir(joinPath(aDir, aName)) !== null;

    for (const filename of names) {
      if (isDir(filename)) continue;

      const fullPath = joinPath(aDir, filename);

      const logToMap = (aMapToLogTo: Map<string, string>, aKey: string): void => {
        if (aMapToLogTo.has(aKey)) {
          this.m_reporter?.Report(
            `File at '${fullPath}' was ignored. Using previously found file at '${aMapToLogTo.get(aKey)}' instead.`,
          );
        } else {
          aMapToLogTo.set(aKey, fullPath);
        }
      };

      // Add dir1/dir2/cmp, dir2/cmp, cmp
      const { name, ext } = splitName(filename);
      const extension = lower(ext);

      for (let i = 0; i < aBaseDirs.length + 1; i++) {
        let alias = '';

        for (let j = i; j < aBaseDirs.length; j++) alias += `${lower(aBaseDirs[j]!)}/`;

        alias += lower(name);

        if (extension === 'asc') logToMap(aMapOfAscFiles, alias);
        else if (extension === 'asy') logToMap(aMapOfAsyFiles, alias);
      }
    }

    if (aRecursive) {
      for (const filename of names) {
        if (!isDir(filename)) continue;

        this.GetAscAndAsyFilePaths(joinPath(aDir, filename), true, aMapOfAscFiles, aMapOfAsyFiles, [
          ...aBaseDirs,
          filename,
        ]);
      }
    }
  }

  ReadAsyFile(aSourceFile: LTSPICE_FILE, aAsyFileMap: Map<string, string>): Map<string, string> {
    const resultantMap = new Map<string, string>();

    const fileName = aSourceFile.ElementName;
    // resolveAsyMapKey may match by bare name if the folder is unknown.
    const mapKey = resolveAsyMapKey(aAsyFileMap, fileName);

    if (mapKey !== '') resultantMap.set(fileName, this.readFile(aAsyFileMap.get(mapKey)!));

    return resultantMap;
  }

  ReadAsyFiles(
    aSourceFiles: LTSPICE_FILE[],
    aAsyFileMap: Map<string, string>,
  ): Map<string, string> {
    const resultantMap = new Map<string, string>();

    for (const source of aSourceFiles) {
      const fileName = source.ElementName;
      // resolveAsyMapKey may match by bare name if the folder is unknown.
      const mapKey = resolveAsyMapKey(aAsyFileMap, fileName);

      if (mapKey !== '') resultantMap.set(fileName, this.readFile(aAsyFileMap.get(mapKey)!));
    }

    return new Map([...resultantMap].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  /** The SYMBOL lines of an `.asc`. */
  GetSchematicElements(aAscFile: string): LTSPICE_FILE[] {
    const resultantArray: LTSPICE_FILE[] = [];
    const lines = wxSplit(aAscFile, '\n');

    for (const line of lines) {
      const tokens = wxSplit(line, ' ');

      if (tokens.length >= 4 && upper(tokens[0]!) === 'SYMBOL') {
        const elementName = tokens[1]!.replaceAll('\\', '/');
        const posX = wxToLong(tokens[2]!).value;
        const posY = wxToLong(tokens[3]!).value;

        resultantArray.push(new LTSPICE_FILE(elementName, { x: toInt(posX), y: toInt(posY) }));
      }
    }

    return resultantArray;
  }

  /** An `.asy` with no `SYMATTR Prefix` line is a sub-schematic's symbol. */
  IsAsySubsheet(aAsyFile: string): boolean {
    // wxStringTokenizer( aAsyFile, "\n" ) and ( line, " " ): white-space delimiters, so
    // wxTOKEN_STRTOK - empty tokens skipped - and an exhausted tokenizer gives "".
    for (const line of tokenizeStrtok(aAsyFile, '\n')) {
      const parts = tokenizeStrtok(line, ' ');

      if (lower(parts[0] ?? '') === 'symattr' && lower(parts[1] ?? '') === 'prefix') return false;
    }

    return true;
  }

  private static integerCheck(aToken: string, aLineNumber: number, aFileName: string): number {
    const r = wxToLong(aToken);

    if (!r.ok) throw new IO_ERROR(`Expecting integer at line ${aLineNumber} in file ${aFileName}`);

    return toInt(r.value);
  }

  private static pointCheck(
    aTokenX: string,
    aTokenY: string,
    aLineNumber: number,
    aFileName: string,
  ): VECTOR2I {
    return {
      x: LTSPICE_SCHEMATIC.integerCheck(aTokenX, aLineNumber, aFileName),
      y: LTSPICE_SCHEMATIC.integerCheck(aTokenY, aLineNumber, aFileName),
    };
  }

  private static tokensSizeRangeCheck(
    aActualSize: number,
    aExpectedMin: number,
    aExpectedMax: number,
    aLineNumber: number,
    aFileName: string,
  ): void {
    if (aActualSize < aExpectedMin) {
      throw new IO_ERROR(`Expected data missing on line ${aLineNumber} in file ${aFileName}`);
    } else if (aActualSize > aExpectedMax) {
      throw new IO_ERROR(`Extra data found on line ${aLineNumber} in file ${aFileName}`);
    }
  }

  /** Join a value spread over tokens aIndex.. into token aIndex (the rest are left in place). */
  private static aggregateAttributeValue(aTokens: string[], aIndex: number): void {
    for (let i = aIndex + 1; i < aTokens.length; i++) aTokens[aIndex] += ` ${aTokens[i]}`;
  }

  private static getLineStyle(aValue: number): LINESTYLE {
    if (aValue < 0 || aValue > 4) throw new IO_ERROR('Expecting 0, 1, 2, 3 or 4');

    return aValue as LINESTYLE;
  }

  private static getLineWidth(aValue: string): LINEWIDTH {
    const v = upper(aValue);

    if (v === 'NORMAL') return LINEWIDTH.Normal;

    if (v === 'WIDE') return LINEWIDTH.Wide;

    throw new IO_ERROR('Expecting NORMAL or WIDE');
  }

  private static getPolarity(aValue: string): POLARITY {
    const m: Record<string, POLARITY> = {
      I: POLARITY.PIN_INPUT,
      O: POLARITY.OUTPUT,
      B: POLARITY.BIDIR,
      IN: POLARITY.PIN_INPUT,
      OUT: POLARITY.OUTPUT,
      BIDIR: POLARITY.BIDIR,
    };
    const v = m[upper(aValue)];

    if (v === undefined) throw new IO_ERROR('Expecting I, O, B, IN, OUT or BIDIR');

    return v;
  }

  private static getSymbolRotationOrMirror(aValue: string): ORIENTATION {
    const m: Record<string, ORIENTATION> = {
      R0: ORIENTATION.R0,
      R90: ORIENTATION.R90,
      R180: ORIENTATION.R180,
      R270: ORIENTATION.R270,
      M0: ORIENTATION.M0,
      M90: ORIENTATION.M90,
      M180: ORIENTATION.M180,
      M270: ORIENTATION.M270,
    };
    const v = m[upper(aValue)];

    if (v === undefined) throw new IO_ERROR('Expecting R0, R90, R18, R270, M0, M90, M180 or M270');

    return v;
  }

  private static getTextJustification(aValue: string): JUSTIFICATION {
    const m: Record<string, JUSTIFICATION> = {
      LEFT: JUSTIFICATION.LEFT,
      CENTER: JUSTIFICATION.CENTER,
      RIGHT: JUSTIFICATION.RIGHT,
      VLEFT: JUSTIFICATION.VLEFT,
      VRIGHT: JUSTIFICATION.VRIGHT,
      VCENTER: JUSTIFICATION.VCENTER,
      BOTTOM: JUSTIFICATION.BOTTOM,
      TOP: JUSTIFICATION.TOP,
      VBOTTOM: JUSTIFICATION.VBOTTOM,
      VTOP: JUSTIFICATION.VTOP,
      INVISIBLE: JUSTIFICATION.INVISIBLE,
    };
    const v = m[upper(aValue)];

    if (v === undefined)
      throw new IO_ERROR(
        'Expecting LEFT, CENTER, RIGHT, TOP, BOTTOM, VLEFT, VRIGHT, VCENTER, VTOP, VBOTTOM or INVISIBLE',
      );

    return v;
  }

  private static getPinJustification(aValue: string): JUSTIFICATION {
    const m: Record<string, JUSTIFICATION> = {
      BOTTOM: JUSTIFICATION.BOTTOM,
      NONE: JUSTIFICATION.NONE,
      LEFT: JUSTIFICATION.LEFT,
      RIGHT: JUSTIFICATION.RIGHT,
      TOP: JUSTIFICATION.TOP,
      VBOTTOM: JUSTIFICATION.VBOTTOM,
      VLEFT: JUSTIFICATION.VLEFT,
      VRIGHT: JUSTIFICATION.VRIGHT,
      VCENTER: JUSTIFICATION.VCENTER,
      VTOP: JUSTIFICATION.VTOP,
    };
    const v = m[upper(aValue)];

    if (v === undefined)
      throw new IO_ERROR(
        'Expecting NONE, BOTTOM, TOP, LEFT, RIGHT, VBOTTOM, VTOP, VCENTER, VLEFT or VRIGHT',
      );

    return v;
  }

  private static getSymbolType(aValue: string): SYMBOLTYPE {
    const v = upper(aValue);

    if (v === 'CELL') return SYMBOLTYPE.CELL;

    if (v === 'BLOCK') return SYMBOLTYPE.BLOCK;

    throw new IO_ERROR('Expecting CELL or BLOCK');
  }

  private static removeCarriageReturn(aLine: string): string {
    if (aLine.endsWith('\r')) return aLine.substring(0, aLine.lastIndexOf('\r'));

    return aLine;
  }

  /** The symbol aAscFileName from the cached `.asy` files. */
  SymbolBuilder(aAscFileName: string, aAscFile: LT_ASC): LT_SYMBOL;
  SymbolBuilder(aAscFileName: string, aAsyFileContent: string, aAscFile: LT_ASC): LT_SYMBOL;
  SymbolBuilder(
    aAscFileName: string,
    aContentOrAsc: string | LT_ASC,
    aAscFile?: LT_ASC,
  ): LT_SYMBOL {
    if (typeof aContentOrAsc !== 'string') {
      const asyFiles = this.fileCache('asyFiles');
      const key = resolveAsyMapKey(asyFiles, aAscFileName);

      if (!asyFiles.has(key)) throw new IO_ERROR(`Symbol '${aAscFileName}.asy' not found`);

      return this.SymbolBuilder(aAscFileName, asyFiles.get(key)!, aContentOrAsc);
    }

    void aAscFile;
    return this.buildSymbol(aAscFileName, aContentOrAsc);
  }

  private buildSymbol(aAscFileName: string, aAsyFileContent: string): LT_SYMBOL {
    const S = LTSPICE_SCHEMATIC;
    const lt_symbol = newLtSymbol();
    let lineNumber = 1;

    lt_symbol.Name = aAscFileName;
    lt_symbol.SymbolType = SYMBOLTYPE.CELL;
    lt_symbol.SymbolOrientation = ORIENTATION.R0;

    for (const rawLine of wxSplit(aAsyFileContent, '\n')) {
      const line = S.removeCarriageReturn(rawLine);
      const tokens = wxSplit(line, ' ');

      if (tokens.length === 0) continue;

      const element = upper(tokens[0]!);

      const lineStyleAt = (aIndex: number): LINESTYLE => {
        let lineStyleNumber = 0; // default

        if (tokens.length === aIndex + 1)
          lineStyleNumber = S.integerCheck(tokens[aIndex]!, lineNumber, aAscFileName);

        return S.getLineStyle(lineStyleNumber);
      };

      if (element === 'LINE') {
        S.tokensSizeRangeCheck(tokens.length, 6, 7, lineNumber, aAscFileName);

        const LineWidth = S.getLineWidth(tokens[1]!);
        const Start = S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, aAscFileName);
        const End = S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, aAscFileName);

        lt_symbol.Lines.push({ LineWidth, Start, End, LineStyle: lineStyleAt(6) });
      } else if (element === 'RECTANGLE') {
        S.tokensSizeRangeCheck(tokens.length, 6, 7, lineNumber, aAscFileName);

        const LineWidth = S.getLineWidth(tokens[1]!);
        const BotRight = S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, aAscFileName);
        const TopLeft = S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, aAscFileName);

        lt_symbol.Rectangles.push({ LineWidth, BotRight, TopLeft, LineStyle: lineStyleAt(6) });
      } else if (element === 'CIRCLE') {
        // The Circle is enclosed in the square which is represented by bottomRight and topLeft
        // coordinates.
        S.tokensSizeRangeCheck(tokens.length, 6, 7, lineNumber, aAscFileName);

        const LineWidth = S.getLineWidth(tokens[1]!);
        const BotRight = S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, aAscFileName);
        const TopLeft = S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, aAscFileName);

        lt_symbol.Circles.push({ LineWidth, BotRight, TopLeft, LineStyle: lineStyleAt(6) });
      } else if (element === 'ARC') {
        // The Arc is enclosed in the square given by above coordinates and its start and end
        // coordinates are given. The arc is drawn counterclockwise from the starting point to
        // the ending point.
        S.tokensSizeRangeCheck(tokens.length, 10, 11, lineNumber, aAscFileName);

        const LineWidth = S.getLineWidth(tokens[1]!);
        const BotRight = S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, aAscFileName);
        const TopLeft = S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, aAscFileName);
        const ArcStart = S.pointCheck(tokens[6]!, tokens[7]!, lineNumber, aAscFileName);
        const ArcEnd = S.pointCheck(tokens[8]!, tokens[9]!, lineNumber, aAscFileName);

        lt_symbol.Arcs.push({
          LineWidth,
          BotRight,
          TopLeft,
          ArcStart,
          ArcEnd,
          LineStyle: lineStyleAt(10),
        });
      } else if (element === 'WINDOW') {
        S.tokensSizeRangeCheck(tokens.length, 6, 6, lineNumber, aAscFileName);

        const window: LT_WINDOW = {
          WindowNumber: S.integerCheck(tokens[1]!, lineNumber, aAscFileName),
          Position: S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, aAscFileName),
          Justification: S.getTextJustification(tokens[4]!),
          FontSize: S.integerCheck(tokens[5]!, lineNumber, aAscFileName),
        };

        // LTSpice appears to ignore hidden property from .asy files
        if (window.FontSize === 0) window.FontSize = 2;

        lt_symbol.Windows.push(window);
      } else if (element === 'SYMATTR') {
        S.aggregateAttributeValue(tokens, 2);

        S.tokensSizeRangeCheck(tokens.length, 3, INT_MAX, lineNumber, aAscFileName);

        const key = tokens[1]!;
        let value = tokens[2]!;

        if (value === '""') value = '';

        lt_symbol.SymAttributes.set(upper(key), value);
      } else if (element === 'PIN') {
        S.tokensSizeRangeCheck(tokens.length, 5, 5, lineNumber, aAscFileName);

        lt_symbol.Pins.push({
          PinLocation: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, aAscFileName),
          PinJustification: S.getPinJustification(tokens[3]!),
          NameOffSet: S.integerCheck(tokens[4]!, lineNumber, aAscFileName),
          PinAttribute: new Map(),
        });
      } else if (element === 'PINATTR') {
        S.aggregateAttributeValue(tokens, 2);

        S.tokensSizeRangeCheck(tokens.length, 3, INT_MAX, lineNumber, aAscFileName);

        const attrs = lt_symbol.Pins[lt_symbol.Pins.length - 1]!.PinAttribute;

        // std::map::insert keeps an existing key.
        if (!attrs.has(tokens[1]!)) attrs.set(tokens[1]!, tokens[2]!);
      } else if (element === 'SYMBOLTYPE') {
        S.tokensSizeRangeCheck(tokens.length, 2, 2, lineNumber, aAscFileName);

        lt_symbol.SymbolType = S.getSymbolType(tokens[1]!);
      }

      lineNumber++;
    }

    return lt_symbol;
  }

  /** The placeholder for a symbol whose `.asy` cannot be found: a 40-unit square. */
  MakeDummySymbol(aAscFileName: string): LT_SYMBOL {
    const lt_symbol = newLtSymbol();

    lt_symbol.Name = aAscFileName;
    lt_symbol.SymbolType = SYMBOLTYPE.CELL;
    lt_symbol.SymbolOrientation = ORIENTATION.R0;

    lt_symbol.Rectangles.push({
      LineWidth: LTSPICE_SCHEMATIC.getLineWidth('NORMAL'),
      LineStyle: LINESTYLE.SOLID,
      BotRight: { x: 20, y: 20 },
      TopLeft: { x: -20, y: -20 },
    });

    return lt_symbol;
  }

  /** The intermediate structure of every cached `.asc`. */
  StructureBuilder(): LT_ASC[] {
    const S = LTSPICE_SCHEMATIC;
    const ascFiles: LT_ASC[] = [];
    const cached = [...this.fileCache('ascFiles')].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    for (const [fileName, contents] of cached) {
      const ascFile = newLtAsc();

      let lineNumber = 1;

      for (const rawLine of wxSplit(contents, '\n')) {
        const line = S.removeCarriageReturn(rawLine);
        const tokens = wxSplit(line, ' ');

        if (tokens.length === 0) continue;

        const element = upper(tokens[0]!);

        const lineStyleAt = (aIndex: number): LINESTYLE => {
          let lineStyleNumber = 0; // default

          if (tokens.length === aIndex + 1)
            lineStyleNumber = S.integerCheck(tokens[aIndex]!, lineNumber, fileName);

          return S.getLineStyle(lineStyleNumber);
        };

        const lastSymbol = (): LT_SYMBOL => {
          // `Symbols.back()` on an empty vector is undefined behaviour upstream.
          const s = ascFile.Symbols[ascFile.Symbols.length - 1];

          if (!s)
            throw new IO_ERROR(
              `Attribute before any SYMBOL on line ${lineNumber} in file ${fileName}`,
            );

          return s;
        };

        if (element === 'SHEET') {
          S.tokensSizeRangeCheck(tokens.length, 4, 4, lineNumber, fileName);

          ascFile.SheetNumber = S.integerCheck(tokens[1]!, lineNumber, fileName);
          ascFile.SheetSize = S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, fileName);
        } else if (element === 'SYMBOL') {
          S.tokensSizeRangeCheck(tokens.length, 5, 5, lineNumber, fileName);

          const symbolName = tokens[1]!.replaceAll('\\', '/');
          const posX = tokens[2]!;
          const posY = tokens[3]!;
          const rotate_mirror_option = tokens[4]!;

          let lt_symbol: LT_SYMBOL;

          try {
            lt_symbol = this.SymbolBuilder(symbolName, ascFile);
            lt_symbol.Offset = S.pointCheck(posX, posY, lineNumber, fileName);
            lt_symbol.SymbolOrientation = S.getSymbolRotationOrMirror(rotate_mirror_option);
          } catch (e) {
            if (!(e instanceof IO_ERROR)) throw e;

            this.m_reporter?.Report(e.What(), RPT_SEVERITY_ERROR);

            // Use dummy symbol
            lt_symbol = this.MakeDummySymbol(symbolName);
            lt_symbol.Offset = S.pointCheck(posX, posY, lineNumber, fileName);
            lt_symbol.SymbolOrientation = S.getSymbolRotationOrMirror(rotate_mirror_option);
          }

          ascFile.Symbols.push(lt_symbol);
          ascFile.BoundingBox.Merge(lt_symbol.Offset);
        } else if (element === 'WIRE') {
          S.tokensSizeRangeCheck(tokens.length, 5, 5, lineNumber, fileName);

          const wire: WIRE = {
            Start: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, fileName),
            End: S.pointCheck(tokens[3]!, tokens[4]!, lineNumber, fileName),
          };

          ascFile.Wires.push(wire);
          ascFile.BoundingBox.Merge(wire.Start);
          ascFile.BoundingBox.Merge(wire.End);
        } else if (element === 'FLAG') {
          S.tokensSizeRangeCheck(tokens.length, 4, 4, lineNumber, fileName);

          const flag: FLAG = {
            Offset: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, fileName),
            Value: tokens[3]!,
            FontSize: 2,
          };

          ascFile.Flags.push(flag);
          ascFile.BoundingBox.Merge(flag.Offset);
        } else if (element === 'DATAFLAG') {
          S.tokensSizeRangeCheck(tokens.length, 4, 4, lineNumber, fileName);

          const flag: DATAFLAG = {
            Offset: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, fileName),
            Expression: tokens[3]!,
            FontSize: 2,
          };

          ascFile.DataFlags.push(flag);
          ascFile.BoundingBox.Merge(flag.Offset);
        } else if (element === 'WINDOW') {
          S.tokensSizeRangeCheck(tokens.length, 6, 6, lineNumber, fileName);

          const windowNumber = S.integerCheck(tokens[1]!, lineNumber, fileName);
          const symbol = lastSymbol();

          // Overwrite an existing window from the symbol definition
          let window = symbol.Windows.find((candidate) => candidate.WindowNumber === windowNumber);

          if (!window) {
            window = {
              WindowNumber: 0,
              FontSize: 0,
              Position: { x: 0, y: 0 },
              Justification: JUSTIFICATION.NONE,
            };
            symbol.Windows.push(window);
          }

          window.WindowNumber = windowNumber;
          window.Position = S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, fileName);
          window.Justification = S.getTextJustification(tokens[4]!);
          window.FontSize = S.integerCheck(tokens[5]!, lineNumber, fileName);

          ascFile.BoundingBox.Merge(window.Position);
        } else if (element === 'SYMATTR') {
          S.tokensSizeRangeCheck(tokens.length, 3, INT_MAX, lineNumber, fileName);

          S.aggregateAttributeValue(tokens, 2);

          const name = tokens[1]!;
          let value = tokens[2]!;

          if (value === '""') value = '';

          lastSymbol().SymAttributes.set(upper(name), value);
        } else if (element === 'LINE') {
          S.tokensSizeRangeCheck(tokens.length, 6, 7, lineNumber, fileName);

          const lt_line: LINE = {
            LineWidth: S.getLineWidth(tokens[1]!),
            Start: S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, fileName),
            End: S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, fileName),
            LineStyle: LINESTYLE.SOLID,
          };
          lt_line.LineStyle = lineStyleAt(6);

          ascFile.Lines.push(lt_line);
          ascFile.BoundingBox.Merge(lt_line.Start);
          ascFile.BoundingBox.Merge(lt_line.End);
        } else if (element === 'RECTANGLE') {
          S.tokensSizeRangeCheck(tokens.length, 6, 7, lineNumber, fileName);

          const rect: RECTANGLE = {
            LineWidth: S.getLineWidth(tokens[1]!),
            BotRight: S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, fileName),
            TopLeft: S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, fileName),
            LineStyle: LINESTYLE.SOLID,
          };
          rect.LineStyle = lineStyleAt(6);

          ascFile.Rectangles.push(rect);
          ascFile.BoundingBox.Merge(rect.TopLeft);
          ascFile.BoundingBox.Merge(rect.BotRight);
        } else if (element === 'CIRCLE') {
          S.tokensSizeRangeCheck(tokens.length, 6, 7, lineNumber, fileName);

          const circle: CIRCLE = {
            LineWidth: S.getLineWidth(tokens[1]!),
            BotRight: S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, fileName),
            TopLeft: S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, fileName),
            LineStyle: LINESTYLE.SOLID,
          };
          circle.LineStyle = lineStyleAt(6);

          ascFile.Circles.push(circle);
          ascFile.BoundingBox.Merge(circle.TopLeft);
          ascFile.BoundingBox.Merge(circle.BotRight);
        } else if (element === 'ARC') {
          // The Arc is enclosed in the square given by above coordinates and its start and end
          // coordinates are given. The arc is drawn counterclockwise from the starting point to
          // the ending point.
          S.tokensSizeRangeCheck(tokens.length, 10, 11, lineNumber, fileName);

          const arc: ARC = {
            LineWidth: S.getLineWidth(tokens[1]!),
            BotRight: S.pointCheck(tokens[2]!, tokens[3]!, lineNumber, fileName),
            TopLeft: S.pointCheck(tokens[4]!, tokens[5]!, lineNumber, fileName),
            // Swapped here, unlike the .asy reader.
            ArcEnd: S.pointCheck(tokens[6]!, tokens[7]!, lineNumber, fileName),
            ArcStart: S.pointCheck(tokens[8]!, tokens[9]!, lineNumber, fileName),
            LineStyle: LINESTYLE.SOLID,
          };
          arc.LineStyle = lineStyleAt(10);

          ascFile.Arcs.push(arc);
          ascFile.BoundingBox.Merge(arc.TopLeft);
          ascFile.BoundingBox.Merge(arc.BotRight);
        } else if (element === 'IOPIN') {
          S.tokensSizeRangeCheck(tokens.length, 4, 4, lineNumber, fileName);

          const iopin: IOPIN = {
            Location: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, fileName),
            Polarity: S.getPolarity(tokens[3]!),
          };

          ascFile.Iopins.push(iopin);
          ascFile.BoundingBox.Merge(iopin.Location);
        } else if (element === 'TEXT') {
          S.aggregateAttributeValue(tokens, 5);

          S.tokensSizeRangeCheck(tokens.length, 6, INT_MAX, lineNumber, fileName);

          const value = tokens[5]!;
          const text: TEXT = {
            Offset: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, fileName),
            Justification: S.getTextJustification(tokens[3]!),
            FontSize: S.integerCheck(tokens[4]!, lineNumber, fileName),
            Value: '',
          };

          if (value.startsWith('!'))
            text.Value = value.substring(1).replaceAll('! ', '\n'); // replace subsequent ! with \n
          else if (value.startsWith(';'))
            text.Value = value.substring(1).replaceAll('; ', '\n'); // replace subsequent ; with \n
          else text.Value = value;

          text.Value = text.Value.replaceAll('\\n', '\n');

          ascFile.Texts.push(text);
          ascFile.BoundingBox.Merge(text.Offset);
        } else if (element === 'BUSTAP') {
          S.tokensSizeRangeCheck(tokens.length, 5, 5, lineNumber, fileName);

          const bustap: BUSTAP = {
            Start: S.pointCheck(tokens[1]!, tokens[2]!, lineNumber, fileName),
            End: S.pointCheck(tokens[3]!, tokens[4]!, lineNumber, fileName),
          };

          ascFile.Bustap.push(bustap);
          ascFile.BoundingBox.Merge(bustap.Start);
          ascFile.BoundingBox.Merge(bustap.End);
        } else if (element === 'VERSION') {
          // `tokens[1]` past the end is undefined behaviour upstream; read as empty here.
          const versionNumber = tokens[1] ?? '';

          if (versionNumber.includes('.')) {
            const dot = versionNumber.indexOf('.');
            ascFile.Version = S.integerCheck(versionNumber.substring(0, dot), lineNumber, fileName);
            ascFile.VersionMinor = S.integerCheck(
              versionNumber.substring(dot + 1),
              lineNumber,
              fileName,
            );
          } else {
            ascFile.Version = S.integerCheck(versionNumber, lineNumber, fileName);
          }
        }

        lineNumber++;
      }

      ascFiles.push(ascFile);
    }

    return ascFiles;
  }

  GetLTspiceDataDir(): string {
    return this.m_ltspiceDataDir;
  }

  /** The plugin's file source, for the parser's own reads. */
  GetFileReader(): IO_FILE_READER {
    return this.m_readFile;
  }
}

/** `wxStringTokenizer( aStr, aDelim )` with a white-space delimiter (wxTOKEN_STRTOK): empty
 * tokens skipped. */
function tokenizeStrtok(aStr: string, aDelim: string): string[] {
  return aStr.split(aDelim).filter((t) => t !== '');
}
