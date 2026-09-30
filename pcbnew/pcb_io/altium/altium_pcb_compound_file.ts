// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/altium_pcb_compound_file.cpp`: the compound file with
 * the PCB library lookups on top — footprint directories by their Unicode
 * pattern name, and the library's embedded 3D models.
 */

import {
  ALTIUM_BINARY_PARSER,
  ALTIUM_COMPOUND_FILE,
} from '@ziroeda/common/io/altium/altium_binary_parser.js';
import { ALTIUM_PROPS_UTILS } from '@ziroeda/common/io/altium/altium_props_utils.js';
import {
  type COMPOUND_FILE_ENTRY,
  UTF16ToUTF8,
  UTF16ToWstring,
} from '@ziroeda/common/io/altium/compoundfilereader.js';
import { ToLong } from '@ziroeda/common/libc/stdlib.js';
import { wxCmpNoCase } from '@ziroeda/common/wx/wxstring.js';
import { AMODEL } from './altium_parser_pcb.js';

/**
 * `CASE_INSENSITIVE_MAP<T>`: a `std::map` ordered by `wxString::CmpNoCase`.
 * A key equal to a stored one but for case finds it, and `operator[]` keeps
 * the key first stored.
 */
export class CASE_INSENSITIVE_MAP<T> {
  private readonly m_items = new Map<string, [string, T]>();

  private static fold(aKey: string): string {
    return aKey.toLowerCase();
  }

  get size(): number {
    return this.m_items.size;
  }

  empty(): boolean {
    return this.m_items.size === 0;
  }

  clear(): void {
    this.m_items.clear();
  }

  /** `find`: the stored key and value, or undefined. */
  find(aKey: string): [string, T] | undefined {
    return this.m_items.get(CASE_INSENSITIVE_MAP.fold(aKey));
  }

  /** `operator[]( aKey ) = aValue`. */
  set(aKey: string, aValue: T): void {
    const k = CASE_INSENSITIVE_MAP.fold(aKey);
    const it = this.m_items.get(k);

    if (it) it[1] = aValue;
    else this.m_items.set(k, [aKey, aValue]);
  }

  /** `emplace`: stores only when absent. */
  emplace(aKey: string, aValue: T): void {
    const k = CASE_INSENSITIVE_MAP.fold(aKey);

    if (!this.m_items.has(k)) this.m_items.set(k, [aKey, aValue]);
  }

  /** In the map's order. */
  entries(): [string, T][] {
    return [...this.m_items.values()].sort(([a], [b]) => wxCmpNoCase(a, b));
  }
}

export class ALTIUM_PCB_COMPOUND_FILE extends ALTIUM_COMPOUND_FILE {
  private readonly m_libFootprintNameCache = new CASE_INSENSITIVE_MAP<COMPOUND_FILE_ENTRY>();
  private readonly m_libFootprintDirNameCache = new CASE_INSENSITIVE_MAP<string>();
  private readonly m_libModelsCache = new CASE_INSENSITIVE_MAP<[AMODEL, Uint8Array]>();

  ListLibFootprints(): CASE_INSENSITIVE_MAP<string> {
    if (this.m_libFootprintDirNameCache.empty()) this.cacheLibFootprintNames();

    return this.m_libFootprintDirNameCache;
  }

  FindLibFootprintDirName(aFpUnicodeName: string): [string, COMPOUND_FILE_ENTRY | null] {
    if (this.m_libFootprintNameCache.empty()) this.cacheLibFootprintNames();

    const it = this.m_libFootprintNameCache.find(aFpUnicodeName);

    if (it === undefined) return ['', null];

    return [it[0], it[1]];
  }

  GetLibModel(aModelName: string): [AMODEL, Uint8Array] | null {
    const it = this.m_libModelsCache.find(aModelName);

    if (it === undefined) return null;

    return it[1];
  }

  private cacheLibFootprintNames(): void {
    this.m_libFootprintDirNameCache.clear();
    this.m_libFootprintNameCache.clear();

    if (!this.m_reader) return;

    const reader = this.m_reader;
    const root = reader.GetRootEntry();

    if (!root) return;

    reader.EnumFiles(root, 1, (tentry) => {
      if (reader.IsStream(tentry)) return 0;

      reader.EnumFiles(tentry, 1, (entry) => {
        const fileName = UTF16ToWstring(entry.name);

        if (reader.IsStream(entry) && fileName === 'Parameters') {
          const parametersReader = new ALTIUM_BINARY_PARSER(this, entry);
          const parameterProperties = parametersReader.ReadProperties();

          const key = ALTIUM_PROPS_UTILS.ReadString(parameterProperties, 'PATTERN', '');
          const fpName = ALTIUM_PROPS_UTILS.ReadUnicodeString(parameterProperties, 'PATTERN', '');

          this.m_libFootprintDirNameCache.set(key, fpName);
          this.m_libFootprintNameCache.set(fpName, tentry);
        }

        return 0;
      });
      return 0;
    });
  }

  CacheLibModels(): boolean {
    let models_root: COMPOUND_FILE_ENTRY | null = null;
    let found = false;

    if (!this.m_reader || !this.m_libModelsCache.empty()) return false;

    const reader = this.m_reader;
    const models_data = this.FindStream(['Library', 'Models', 'Data']);

    if (!models_data) return false;

    const parser = new ALTIUM_BINARY_PARSER(this, models_data);

    if (parser.GetRemainingBytes() === 0) return false;

    const models: AMODEL[] = [];

    // First, we parse and extract the model data from the Data stream
    while (parser.GetRemainingBytes() >= 4) {
      const elem = new AMODEL(parser);
      models.push(elem);
    }

    // Next, we need the model directory entry to read the compressed model streams
    reader.EnumFiles(reader.GetRootEntry()!, 2, (entry, dir) => {
      if (found) return 1;

      if (reader.IsStream(entry)) return 0;

      const dir_str = dir.split('\0')[0]!;
      const entry_str = UTF16ToUTF8(entry.name);

      if (dir_str === 'Library' && entry_str === 'Models') {
        models_root = entry;
        found = true;
        return 1;
      }

      return 0;
    });

    if (!models_root) return false;

    reader.EnumFiles(models_root, 1, (stepEntry) => {
      const fileName = UTF16ToUTF8(stepEntry.name);
      const fileNumber = ToLong(fileName);

      if (!fileNumber.ok) return 0;

      if (!reader.IsStream(stepEntry) || fileNumber.value >= models.length) return 0;

      const stepSize = stepEntry.size;
      const stepContent = new Uint8Array(stepSize);

      // read file into buffer
      reader.ReadFile(stepEntry, 0, stepContent, stepSize);

      if (stepContent.length === 0) return 0;

      // We store the models in their original compressed form so as to speed the caching process
      // When we parse an individual footprint, we decompress and recompress the model data into
      // our format
      const modelName = models[fileNumber.value]!.id;
      this.m_libModelsCache.emplace(modelName, [models[fileNumber.value]!, stepContent]);
      return 0;
    });

    return true;
  }
}
