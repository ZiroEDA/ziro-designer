// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/easyedapro/easyedapro_import_utils.cpp` / `.h`: what the Pro
 * board and schematic importers share — the library naming, the project
 * chooser's descriptions, and reading the `.epro` / `.zip` archive: its
 * `project.json`, its entries in order, and their JSON-lines documents.
 *
 * The archive is bytes here (`wxZipInputStream` over `common/wx/zipstrm.ts`)
 * rather than a path the functions open.
 */

import { IO_ERROR } from '../../exceptions.js';
import { formatG } from '../../string_utils.js';
import { ESCAPE_CONTEXT, EscapeString } from '../../string_utils.js';
import { LIB_ID } from '../../lib_id.js';
import {
  isNumber,
  isObject,
  isString,
  jAt,
  jMap,
  jNum,
  JSON_EXCEPTION,
  type JSON_VALUE,
  jParse,
  jStr,
} from '../../json_common.js';
import { wxZipInputStream } from '../../wx/zipstrm.js';
import type { IMPORT_PROJECT_DESC } from '../common/plugin_common_choose_project.js';
import { PRJ_BOARD_from_json, PRJ_SCHEMATIC_from_json } from './easyedapro_parser.js';

/** `EASY_IT_CONTINUE` / `EASY_IT_BREAK`: what an `IterateZipFiles` callback returns. */
export const EASY_IT_CONTINUE = false;
export const EASY_IT_BREAK = true;

/** `wxString::substr( 0, n )`: n UTF-32 characters (wchar_t on Linux). */
function substrChars(s: string, n: number): string {
  return [...s].slice(0, n).join('');
}

export function ShortenLibName(aProjectName: string): string {
  let shortenedName = aProjectName;
  shortenedName = shortenedName.replaceAll('ProProject_', '');
  shortenedName = shortenedName.replaceAll('ProDocument_', '');
  shortenedName = substrChars(shortenedName, 10);

  return LIB_ID.FixIllegalChars(`${shortenedName}-easyedapro`, true);
}

export function ToKiCadLibID(aLibName: string, aLibReference: string): LIB_ID {
  const libName = LIB_ID.FixIllegalChars(aLibName, true);
  const libReference = EscapeString(aLibReference, ESCAPE_CONTEXT.CTX_LIBID);

  const key = libName !== '' ? `${libName}:${libReference}` : libReference;

  const libId = new LIB_ID();
  libId.Parse(key, true);

  return libId;
}

export function ProjectToSelectorDialog(
  aProject: JSON_VALUE,
  aPcbOnly = false,
  aSchOnly = false,
): IMPORT_PROJECT_DESC[] {
  const result: IMPORT_PROJECT_DESC[] = [];

  const prjSchematics = jMap(jAt(aProject, 'schematics'), PRJ_SCHEMATIC_from_json);
  const prjBoards = jMap(jAt(aProject, 'boards'), PRJ_BOARD_from_json);

  const prjPcbNames = new Map<string, string>();
  const prjPcbs = jMap(jAt(aProject, 'pcbs'), (v) => v);

  for (const [pcbUuid, pcbJsonEntry] of prjPcbs) {
    if (isString(pcbJsonEntry)) prjPcbNames.set(pcbUuid, pcbJsonEntry);
    else if (isObject(pcbJsonEntry)) prjPcbNames.set(pcbUuid, jStr(jAt(pcbJsonEntry, 'title')));
  }

  for (const [prjName, board] of prjBoards) {
    const desc = newDesc();
    desc.ComboName = desc.ComboId = prjName;
    desc.PCBId = board.pcb;
    desc.SchematicId = board.schematic;

    const pcbName = prjPcbNames.get(desc.PCBId);

    if (pcbName !== undefined) {
      desc.PCBName = pcbName;

      if (desc.PCBName === '') desc.PCBName = desc.PCBId;

      prjPcbNames.delete(desc.PCBId);
    }

    const sch = prjSchematics.get(desc.SchematicId);

    if (sch !== undefined) {
      desc.SchematicName = sch.name;

      if (desc.SchematicName === '') desc.SchematicName = desc.SchematicId;

      prjSchematics.delete(desc.SchematicId);
    }

    result.push(desc);
  }

  if (!aSchOnly) {
    for (const [pcbId, pcbName] of prjPcbNames) {
      const desc = newDesc();
      desc.PCBId = pcbId;
      desc.PCBName = pcbName;

      if (desc.PCBName === '') desc.PCBName = pcbId;

      result.push(desc);
    }
  }

  if (!aPcbOnly) {
    for (const [schId, schData] of prjSchematics) {
      const desc = newDesc();
      desc.SchematicId = schId;
      desc.SchematicName = schData.name;

      if (desc.SchematicName === '') desc.SchematicName = schId;

      result.push(desc);
    }
  }

  return result;
}

function newDesc(): IMPORT_PROJECT_DESC {
  return { ComboName: '', PCBName: '', SchematicName: '', ComboId: '', PCBId: '', SchematicId: '' };
}

/** `wxString::FromUTF8( bytes )`: invalid UTF-8 gives an empty string. */
function fromUTF8(aBytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(aBytes);
  } catch {
    return '';
  }
}

export function FindJsonFile(aZipData: Uint8Array, aFileNames: ReadonlySet<string>): JSON_VALUE {
  const zip = new wxZipInputStream(aZipData);

  for (let entry = zip.GetNextEntry(); entry !== null; entry = zip.GetNextEntry()) {
    const name = entry.GetName();

    try {
      if (aFileNames.has(name)) {
        const bytes = entry.Read() ?? new Uint8Array();

        return jParse(fromUTF8(bytes));
      }
    } catch (e) {
      if (e instanceof JSON_EXCEPTION)
        throw new IO_ERROR(`JSON error reading '${name}': ${e.message}`);

      if (e instanceof IO_ERROR) throw e;

      throw new IO_ERROR(`Error reading '${name}': ${(e as Error).message}`);
    }
  }

  return null;
}

const c_files = new Set(['project.json', 'device.json', 'footprint.json', 'symbol.json']);

export function ReadProjectOrDeviceFile(aZipData: Uint8Array, aZipFileName: string): JSON_VALUE {
  const j = FindJsonFile(aZipData, c_files);

  if (j !== null) return j;

  throw new IO_ERROR(
    `'${aZipFileName}' does not appear to be a valid EasyEDA (JLCEDA) Pro project or library file. Cannot find project.json or device.json.`,
  );
}

/** The callback `IterateZipFiles` hands each entry: its name, base name and bytes. */
export type ZIP_CALLBACK = (aName: string, aBaseName: string, aData: Uint8Array) => boolean;

export function IterateZipFiles(
  aZipData: Uint8Array,
  aFileName: string,
  aCallback: ZIP_CALLBACK,
): void {
  const zip = new wxZipInputStream(aZipData);

  if (!zip.IsOk()) throw new IO_ERROR(`Cannot read ZIP archive '${aFileName}'`);

  for (let entry = zip.GetNextEntry(); entry !== null; entry = zip.GetNextEntry()) {
    const name = entry.GetName();

    // `name.AfterLast( '\\' ).AfterLast( '/' ).BeforeFirst( '.' )`
    let baseName = name.substring(name.lastIndexOf('\\') + 1);
    baseName = baseName.substring(baseName.lastIndexOf('/') + 1);
    const dot = baseName.indexOf('.');
    if (dot >= 0) baseName = baseName.substring(0, dot);

    try {
      if (aCallback(name, baseName, entry.Read() ?? new Uint8Array())) break;
    } catch (e) {
      if (e instanceof JSON_EXCEPTION)
        throw new IO_ERROR(`JSON error reading '${name}': ${e.message}`);

      if (e instanceof IO_ERROR) throw e;

      throw new IO_ERROR(`Error reading '${name}': ${(e as Error).message}`);
    }
  }
}

/**
 * `wxTextInputStream::ReadLine` over the whole stream while `CanRead()`: the
 * lines split on `\n`, `\r\n` or `\r`, decoded as UTF-8; a final line
 * terminator does not start another line.
 */
function readLines(aData: Uint8Array): string[] {
  const text = new TextDecoder('utf-8').decode(aData);

  if (text === '') return [];

  const lines = text.split(/\r\n|\r|\n/);

  if (lines[lines.length - 1] === '') lines.pop();

  return lines;
}

/** A warning the reader logs (`wxLogWarning`); the importers route it to their reporter. */
export type WARNING_SINK = (aMessage: string) => void;

export function ParseJsonLines(
  aInput: Uint8Array,
  aSource: string,
  aWarn: WARNING_SINK | null = null,
): JSON_VALUE[] {
  let currentLine = 1;

  const lines: JSON_VALUE[] = [];

  for (const line of readLines(aInput)) {
    try {
      if (line !== '') {
        const js = jParse(line);
        lines.push(js);
      } else {
        lines.push(null);
      }
    } catch (e) {
      if (!(e instanceof JSON_EXCEPTION)) throw e;

      aWarn?.(`Cannot parse JSON line ${currentLine} in '${aSource}': ${e.message}`);
    }

    currentLine++;
  }

  return lines;
}

/**
 * Multiple document types (e.g. footprint and PCB) can be put into a single file, separated by
 * empty line.
 */
export function ParseJsonLinesWithSeparation(
  aInput: Uint8Array,
  aSource: string,
  aWarn: WARNING_SINK | null = null,
): JSON_VALUE[][] {
  let currentLine = 1;

  const lineBlocks: JSON_VALUE[][] = [[]];

  for (const line of readLines(aInput)) {
    try {
      if (line !== '') {
        const js = jParse(line);
        lineBlocks[lineBlocks.length - 1]!.push(js);
      } else {
        lineBlocks.push([]);
      }
    } catch (e) {
      if (!(e instanceof JSON_EXCEPTION)) throw e;

      aWarn?.(`Cannot parse JSON line ${currentLine} in '${aSource}': ${e.message}`);
    }

    currentLine++;
  }

  return lineBlocks;
}

/** `AnyMapToStringMap`: strings as they are, numbers as `wxString::FromCDouble`, the rest dropped. */
export function AnyMapToStringMap(aInput: ReadonlyMap<string, JSON_VALUE>): Map<string, string> {
  const stringMap = new Map<string, string>();

  for (const [key, value] of aInput) {
    if (isString(value)) stringMap.set(key, value);
    else if (isNumber(value)) stringMap.set(key, formatG(jNum(value), 6));
  }

  return stringMap;
}
