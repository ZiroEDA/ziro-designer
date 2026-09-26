// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/embedded_files.h` / `common/embedded_files.cpp` and the
 * `EMBEDDED_FILES_PARSER`: the `(embedded_files …)` collection a board, a
 * footprint, a schematic or a symbol carries, with its zstd + base64 codec
 * and MurmurHash3 checksum.
 *
 * The checksum is `MMH3_HASH` as 10.0.5 computes it (`mmh3HashToStringV1`:
 * the padded tail); kimath's `mmh3HashToString` is master's later fix and
 * would reject every file KiCad 10.0.5 writes.
 *
 * zstd is the same wasm build eeschema's tools use; its module has to be
 * instantiated once, asynchronously, before the synchronous codec can run —
 * `await EMBEDDED_FILES.InitCodec()` ahead of a parse that may meet data.
 * The C++ links libzstd and has no such step.
 *
 * Not ported: the disk-facing calls (`AddFile( wxFileName )`,
 * `ComputeFileHash`, `GetTemporaryFileName`, the fontconfig cache
 * `UpdateFontFiles` / `GetFontFiles`) — there is no disk here.
 */

import { compress, decompress, init as zstdInit } from '@bokuweb/zstd-wasm';
import { mmh3HashToStringV1 as mmh3HashToString } from '@ziroeda/kimath/src/mmh3_hash.js';
import { type DSNLEXER, DSNLEXER as DSNLEXER_CLASS, PARSE_ERROR, T, type Tok } from './dsnlexer.js';
import { PATHS } from './paths.js';
import { hash256_hex_string } from './picosha2.js';
import type { OUTPUTFORMATTER } from './richio.js';
import {
  MEMORY_FILESYSTEM,
  wxFileExists,
  wxFindMount,
  wxGetTempDir,
  wxNormalizePath,
} from './wx/filefn.js';

/** `FILEEXT::KiCadUriPrefix`. */
export const KiCadUriPrefix = 'kicad-embed';

export enum FILE_TYPE {
  FONT = 0,
  MODEL,
  WORKSHEET,
  DATASHEET,
  OTHER,
}

export enum RETURN_CODE {
  OK = 0, ///< Success.
  FILE_NOT_FOUND, ///< File not found on disk.
  PERMISSIONS_ERROR, ///< Could not read/write file.
  FILE_ALREADY_EXISTS, ///< File already exists in the collection.
  OUT_OF_MEMORY, ///< Could not allocate memory.
  CHECKSUM_ERROR, ///< Checksum in file does not match data.
}

export class EMBEDDED_FILE {
  name = '';
  type: FILE_TYPE = FILE_TYPE.OTHER;
  is_valid = false;
  compressedEncodedData = '';
  decompressedData: Uint8Array = new Uint8Array(0);
  data_hash = '';

  /** The compiler-generated copy (`std::make_shared<EMBEDDED_FILE>( *file )`). */
  static copyOf(aOther: EMBEDDED_FILE): EMBEDDED_FILE {
    const f = new EMBEDDED_FILE();
    f.name = aOther.name;
    f.type = aOther.type;
    f.is_valid = aOther.is_valid;
    f.compressedEncodedData = aOther.compressedEncodedData;
    f.decompressedData = aOther.decompressedData.slice();
    f.data_hash = aOther.data_hash;
    return f;
  }

  Validate(): boolean {
    this.is_valid =
      mmh3HashToString(this.decompressedData, EMBEDDED_FILES.Seed()) === this.data_hash;

    return this.is_valid;
  }

  // This is the old way of validating the file.  It is deprecated and retained only
  // to validate files that were previously embedded.
  Validate_SHA256(): boolean {
    const new_sha = hash256_hex_string(this.decompressedData);
    this.is_valid = new_sha === this.data_hash;
    return this.is_valid;
  }

  GetLink(): string {
    return `${KiCadUriPrefix}://${this.name}`;
  }
}

export type FILE_ADDED_CALLBACK = (aFile: EMBEDDED_FILE) => void;

let zstdReady: Promise<void> | null = null;
let zstdIsReady = false;

/** `std::map<wxString, …>`: iteration in key order (`wxString` compares by code unit). */
function sortedKeys(aMap: Map<string, EMBEDDED_FILE>): string[] {
  return [...aMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `wxFileName( name ).GetFullName()`: the last path component. */
function fullNameOf(aName: string): string {
  const slash = Math.max(aName.lastIndexOf('/'), aName.lastIndexOf('\\'));
  return slash >= 0 ? aName.slice(slash + 1) : aName;
}

const base64Encode = (bytes: Uint8Array): string => {
  let bin = '';
  const CHUNK = 0x8000;

  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));

  return btoa(bin);
};

const base64Decode = (text: string): Uint8Array | null => {
  let bin: string;

  try {
    bin = atob(text.replace(/\s+/g, ''));
  } catch {
    return null;
  }

  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);

  return out;
};

/**
 * A second base for `BOARD`, `FOOTPRINT`, `SCHEMATIC` and `LIB_SYMBOL`, mixed
 * in with `applyMixins`; a derived constructor calls `initEmbeddedFiles()`
 * (its copy constructor `initEmbeddedFilesFrom( aOther )`). Used on its own,
 * the constructor does the same.
 */
export class EMBEDDED_FILES {
  protected m_files!: Map<string, EMBEDDED_FILE>;
  protected m_fileAddedCallback!: FILE_ADDED_CALLBACK | null;

  protected m_embedFonts!: boolean; ///< If set, fonts will be embedded in the element on save.
  ///< Otherwise, font files embedded in the element will be
  ///< removed on save.

  constructor() {
    this.initEmbeddedFiles();
  }

  /** `EMBEDDED_FILES() = default`. */
  protected initEmbeddedFiles(): void {
    this.m_files = new Map();
    this.m_fileAddedCallback = null;
    this.m_embedFonts = false;
  }

  /**
   * `EMBEDDED_FILES( const EMBEDDED_FILES& other )`: shares the payloads
   * (a `shared_ptr` copy); `aDeepCopy` is the `( other, true )` overload.
   */
  protected initEmbeddedFilesFrom(aOther: EMBEDDED_FILES, aDeepCopy = false): void {
    this.m_files = new Map();
    this.m_fileAddedCallback = aOther.m_fileAddedCallback;
    this.m_embedFonts = aOther.m_embedFonts;

    if (aDeepCopy) {
      // True deep copy is requested.  Allocate a fresh EMBEDDED_FILE for each entry so that
      // subsequent mutations through this collection cannot affect the source collection.
      for (const [name, file] of aOther.m_files) this.m_files.set(name, EMBEDDED_FILE.copyOf(file));
    } else {
      this.m_files = new Map(aOther.m_files);
    }
  }

  /**
   * Instantiate the zstd module the synchronous codec needs. Idempotent;
   * every entry point that may decode data awaits this first.
   */
  static InitCodec(): Promise<void> {
    if (!zstdReady) {
      zstdReady = zstdInit().then(() => {
        zstdIsReady = true;
      });
    }

    return zstdReady;
  }

  static CodecReady(): boolean {
    return zstdIsReady;
  }

  static copyOf(aOther: EMBEDDED_FILES, aDeepCopy = false): EMBEDDED_FILES {
    const e = new EMBEDDED_FILES();
    e.initEmbeddedFilesFrom(aOther, aDeepCopy);
    return e;
  }

  /** `operator=`: a deep copy. */
  assignEmbeddedFiles(aOther: EMBEDDED_FILES): this {
    if (this !== aOther) {
      this.m_files.clear();

      for (const [name, file] of aOther.m_files) this.m_files.set(name, EMBEDDED_FILE.copyOf(file));

      this.m_fileAddedCallback = aOther.m_fileAddedCallback;
      this.m_embedFonts = aOther.m_embedFonts;
    }

    return this;
  }

  SetFileAddedCallback(callback: FILE_ADDED_CALLBACK | null): void {
    this.m_fileAddedCallback = callback;
  }

  GetFileAddedCallback(): FILE_ADDED_CALLBACK | null {
    return this.m_fileAddedCallback;
  }

  /**
   * Append a file to the collection.  Ownership of @p aFile is transferred to the collection.
   */
  AddFile(aFile: EMBEDDED_FILE | null): void {
    if (!aFile) return;

    const name = aFile.name;

    // std::map::emplace silently drops duplicates
    if (this.m_files.has(name)) return;

    this.m_files.set(name, aFile);

    if (this.m_fileAddedCallback) this.m_fileAddedCallback(aFile);
  }

  /**
   * Remove a file from the collection and frees the memory.
   *
   * @param aName is the name of the file to remove.
   */
  RemoveFile(name: string, _aErase = true): void {
    this.m_files.delete(name);
  }

  /**
   * Output formatter for the embedded files.
   *
   * @param aOut is the output formatter.
   * @param aWriteData is true if the actual data should be written.  This is false when writing
   *                   an element that is already embedded in a file that itself has embedded
   *                   files (boards, schematics, etc.).
   */
  WriteEmbeddedFiles(aOut: OUTPUTFORMATTER, aWriteData: boolean): void {
    const MIME_BASE64_LENGTH = 76;
    aOut.Print('(embedded_files ');

    for (const name of sortedKeys(this.m_files)) {
      const file = this.m_files.get(name)!;

      // Skip empty files
      if (file.compressedEncodedData === '') {
        continue;
      }

      aOut.Print('(file ');
      aOut.Print(`(name ${aOut.Quotew(file.name)})`);

      let type: string;

      switch (file.type) {
        case FILE_TYPE.DATASHEET:
          type = 'datasheet';
          break;
        case FILE_TYPE.FONT:
          type = 'font';
          break;
        case FILE_TYPE.MODEL:
          type = 'model';
          break;
        case FILE_TYPE.WORKSHEET:
          type = 'worksheet';
          break;
        default:
          type = 'other';
          break;
      }

      aOut.Print(`(type ${type})`);

      if (aWriteData) {
        aOut.Print('(data');

        let first = 0;

        while (first < file.compressedEncodedData.length) {
          const remaining = file.compressedEncodedData.length - first;
          const length = Math.min(remaining, MIME_BASE64_LENGTH);

          const view = file.compressedEncodedData.slice(first, first + length);

          aOut.Print(`\n${first ? '' : '|'}${view}${remaining === length ? '|' : ''}\n`);
          first += MIME_BASE64_LENGTH;
        }

        aOut.Print(')'); // Close data
      }

      aOut.Print(`(checksum ${aOut.Quotew(file.data_hash)})`);
      aOut.Print(')'); // Close file
    }

    aOut.Print(')'); // Close embedded_files
  }

  /**
   * Return the link for an embedded file.
   *
   * @param aFile is the file to get the link for.
   * @return the link for the file to be used in a hyperlink.
   */
  GetEmbeddedFileLink(aFile: EMBEDDED_FILE): string {
    return aFile.GetLink();
  }

  HasFile(name: string): boolean {
    return this.m_files.has(fullNameOf(name));
  }

  IsEmpty(): boolean {
    return this.m_files.size === 0;
  }

  /**
   * Provide access to nested embedded files, such as symbols in schematics and footprints in
   * boards.
   */
  RunOnNestedEmbeddedFiles(_aFunction: (aFiles: EMBEDDED_FILES) => void): void {}

  /**
   * Remove all embedded fonts from the collection.
   */
  ClearEmbeddedFonts(): void {
    for (const [name, file] of [...this.m_files]) {
      if (file.type === FILE_TYPE.FONT) this.m_files.delete(name);
    }
  }

  /**
   * Take data from the #decompressedData buffer and compresses it using ZSTD
   * into the #compressedEncodedData buffer.
   *
   * The data is then Base64 encoded.  This call is used when adding a new file to the
   * collection from disk.
   */
  static CompressAndEncode(aFile: EMBEDDED_FILE): RETURN_CODE {
    if (!zstdIsReady) throw new Error('EMBEDDED_FILES: InitCodec() has not completed');

    let compressedData: Uint8Array;

    try {
      compressedData = new Uint8Array(compress(aFile.decompressedData, 15));
    } catch {
      return RETURN_CODE.OUT_OF_MEMORY;
    }

    aFile.compressedEncodedData = base64Encode(compressedData);

    aFile.data_hash = mmh3HashToString(aFile.decompressedData, EMBEDDED_FILES.Seed());

    return RETURN_CODE.OK;
  }

  /**
   * Takes data from the #compressedEncodedData buffer and Base64 decodes it.
   *
   * The data is then decompressed using ZSTD and stored in the #decompressedData buffer.
   * This call is used when loading the embedded files using the parsers.
   */
  static DecompressAndDecode(aFile: EMBEDDED_FILE): RETURN_CODE {
    if (!zstdIsReady) throw new Error('EMBEDDED_FILES: InitCodec() has not completed');

    const compressed = base64Decode(aFile.compressedEncodedData);

    if (!compressed || compressed.length === 0) return RETURN_CODE.OUT_OF_MEMORY;

    let decompressed: Uint8Array;

    try {
      decompressed = new Uint8Array(decompress(compressed));
    } catch {
      aFile.decompressedData = new Uint8Array(0);
      return RETURN_CODE.OUT_OF_MEMORY;
    }

    if (decompressed.length > 1e9)
      // Limit to 1GB
      return RETURN_CODE.OUT_OF_MEMORY;

    aFile.decompressedData = decompressed;
    let test_hash: string;

    const new_hash = mmh3HashToString(aFile.decompressedData, EMBEDDED_FILES.Seed());

    if (aFile.data_hash.length === 64) test_hash = hash256_hex_string(aFile.decompressedData);
    else test_hash = new_hash;

    if (test_hash !== aFile.data_hash) {
      aFile.decompressedData = new Uint8Array(0);
      return RETURN_CODE.CHECKSUM_ERROR;
    }

    aFile.data_hash = new_hash;

    return RETURN_CODE.OK;
  }

  /**
   * Returns the embedded file with the given name or nullptr if it does not exist.
   */
  GetEmbeddedFile(aName: string): EMBEDDED_FILE | null {
    return this.m_files.get(aName) ?? null;
  }

  /**
   * `GetTemporaryFileName`: write the file's data where other code can open it
   * by path, and return that path ("" when there is no such file or it cannot
   * be written). Named by the data hash, so projects sharing a file share one
   * copy and two files with one name do not collide. The cache directory
   * cannot be made in a page, so this lands in KiCad's own fallback, the
   * temp directory.
   */
  GetTemporaryFileName(aName: string): string {
    const file = this.m_files.get(aName);

    if (!file) return '';

    let dir = `${PATHS.GetUserCachePath()}embed/`;

    if (!PATHS.EnsurePathExists(dir)) dir = `${wxGetTempDir()}/`;

    const dot = aName.lastIndexOf('.');
    const ext = dot > aName.lastIndexOf('/') && dot >= 0 ? aName.slice(dot + 1) : '';
    const cacheFile = wxNormalizePath(
      `${dir}kicad_embedded_${file.data_hash}${ext === '' ? '' : `.${ext}`}`,
    );

    if (wxFileExists(cacheFile)) return cacheFile;

    const hit = wxFindMount(cacheFile);

    if (!hit || !(hit.mount instanceof MEMORY_FILESYSTEM)) return '';

    hit.mount.Write(hit.rel, file.decompressedData);

    return cacheFile;
  }

  /**
   * Provide an iterable view of the file collection, in name order (a `std::map`).
   */
  EmbeddedFileMap(): Map<string, EMBEDDED_FILE> {
    const sorted = new Map<string, EMBEDDED_FILE>();

    for (const name of sortedKeys(this.m_files)) sorted.set(name, this.m_files.get(name)!);

    return sorted;
  }

  ClearEmbeddedFiles(_aDeleteFiles = true): void {
    this.m_files.clear();
  }

  EmbedFonts(): void {}

  SetAreFontsEmbedded(aEmbedFonts: boolean): void {
    this.m_embedFonts = aEmbedFonts;
  }

  GetAreFontsEmbedded(): boolean {
    return this.m_embedFonts;
  }

  static Seed(): number {
    return 0xabba2345;
  }
}

/**
 * `EMBEDDED_FILES_PARSER::ParseEmbedded` (common/embedded_files.cpp:395).
 *
 * The C++ is an `EMBEDDED_FILES_LEXER` over the containing file's reader;
 * here it reads that parser's own token stream.
 */
export function ParseEmbedded(aLexer: DSNLEXER, aFiles: EMBEDDED_FILES | null): void {
  // embedded files are version 20240706 and uses also Bars as separator
  aLexer.SetKnowsBar(true);

  const throwParse = (message: string): never => {
    throw new PARSE_ERROR(
      message,
      aLexer.CurSource(),
      aLexer.CurLine(),
      aLexer.CurLineNumber(),
      aLexer.CurOffset(),
    );
  };

  if (!aFiles) {
    throwParse('No embedded files object provided');
    return;
  }

  let file: EMBEDDED_FILE | null = null;

  let token: Tok;

  for (token = aLexer.NextTok(); token !== T.RIGHT; token = aLexer.NextTok()) {
    if (token !== T.LEFT) aLexer.Expecting(T.LEFT);

    token = aLexer.NextTok();

    if (token !== 'file') aLexer.Expecting('file');

    if (file) {
      if (file.compressedEncodedData !== '') {
        if (EMBEDDED_FILES.DecompressAndDecode(file) === RETURN_CODE.CHECKSUM_ERROR)
          throwParse(`Checksum error in embedded file ${file.name}`);
      }

      aFiles.AddFile(file);
    }

    file = null;

    for (token = aLexer.NextTok(); token !== T.RIGHT; token = aLexer.NextTok()) {
      if (token !== T.LEFT) aLexer.Expecting(T.LEFT);

      token = aLexer.NextTok();

      switch (token) {
        case 'checksum':
          if (!file) aLexer.Expecting('name');

          token = aLexer.NeedSYMBOLorNUMBER();

          if (!DSNLEXER_CLASS.IsSymbol(token)) aLexer.Expecting('checksum data');

          file.data_hash = aLexer.CurText();
          aLexer.NeedRIGHT();
          break;

        case 'data': {
          if (!file) aLexer.Expecting('name');

          let bar: Tok;

          try {
            aLexer.NeedBAR();
            bar = T.BAR;
          } catch (e) {
            // No data in the file -- due to bug in writer for 9.0.0
            if (aLexer.CurTok() === T.RIGHT) bar = T.RIGHT;
            else throw e;
          }

          if (bar === T.RIGHT) break;

          token = aLexer.NextTok();

          const parts: string[] = [];

          while (token !== T.BAR) {
            if (!DSNLEXER_CLASS.IsSymbol(token)) aLexer.Expecting('base64 file data');

            parts.push(aLexer.CurText());
            token = aLexer.NextTok();
          }

          file.compressedEncodedData = parts.join('');
          aLexer.NeedRIGHT();
          break;
        }

        case 'name':
          // if( file ) wxLogTrace( "Duplicate 'name' tag in embedded file" )
          aLexer.NeedSYMBOLorNUMBER();
          file = new EMBEDDED_FILE();
          file.name = aLexer.CurText();
          aLexer.NeedRIGHT();
          break;

        case 'type':
          if (!file) aLexer.Expecting('name');

          token = aLexer.NextTok();

          switch (token) {
            case 'datasheet':
              file.type = FILE_TYPE.DATASHEET;
              break;
            case 'font':
              file.type = FILE_TYPE.FONT;
              break;
            case 'model':
              file.type = FILE_TYPE.MODEL;
              break;
            case 'worksheet':
              file.type = FILE_TYPE.WORKSHEET;
              break;
            case 'other':
              file.type = FILE_TYPE.OTHER;
              break;
            default:
              aLexer.Expecting('datasheet, font, model, worksheet or other');
          }

          aLexer.NeedRIGHT();
          break;

        default:
          aLexer.Expecting('checksum, data or name');
      }
    }
  }

  // Add the last file in the collection
  if (file) {
    if (file.compressedEncodedData !== '') {
      if (EMBEDDED_FILES.DecompressAndDecode(file) === RETURN_CODE.CHECKSUM_ERROR)
        throwParse(`Checksum error in embedded file ${file.name}`);
    }

    aFiles.AddFile(file);
  }
}

/**
 * One row of PANEL_EMBEDDED_FILES' grid: the name and `kicad-embed://`
 * reference of an EMBEDDED_FILE, plus the raw bytes of a file added in this
 * dialog session and not yet compressed into the document (EMBEDDED_FILES::
 * AddFile happens on OK).
 */
export interface EmbeddedFile {
  name: string;
  reference: string;
  pendingBytes?: Uint8Array;
}

/** The panel's whole state: the rows and `GetAreFontsEmbedded()`. */
export interface EmbeddedFilesData {
  files: EmbeddedFile[];
  embedFonts: boolean;
}

export function defaultEmbeddedFiles(): EmbeddedFilesData {
  return { files: [], embedFonts: false };
}
