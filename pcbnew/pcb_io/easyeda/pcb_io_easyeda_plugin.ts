// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/easyeda/pcb_io_easyeda_plugin.cpp` / `.h`: the EasyEDA
 * (JLCEDA) Std importer — a board, footprint or component `.json`, or a
 * `.zip` of them (the first entry holding one is used).
 *
 * Files are read through `IO_BASE::m_readFile`; a `.zip` is walked with
 * `wxZipInputStream` (`common/wx/zipstrm.ts`).
 */

import {
  DOC_TYPE,
  type DOCUMENT,
  DOCUMENT_from_json,
  DOCUMENT_PCB_from_json,
  JSON_EXCEPTION,
  type JSON_VALUE,
  parseJsonDiscarding,
} from '@ziroeda/common/io/easyeda/easyeda_parser_structs.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { F_Cu, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { atoi } from '@ziroeda/common/libc/stdlib.js';
import { wxSplit } from '@ziroeda/common/string_utils.js';
import { wxZipInputStream } from '@ziroeda/common/wx/zipstrm.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { type FOOTPRINT_MAP, PCB_IO_EASYEDA_PARSER } from './pcb_io_easyeda_parser.js';

interface FOUND {
  js: JSON_VALUE;
  doc: DOCUMENT;
}

/** `FindBoardInStream( aName, aStream, aOut, aDoc )`: the first PCB-typed document. */
function FindBoardInStream(aName: string, aBytes: Uint8Array): FOUND | null {
  if (aName.toLowerCase().endsWith('.json')) {
    const js = parseJsonDiscarding(aBytes);

    if (js === undefined) return null;

    const doc = DOCUMENT_from_json(js);

    if (
      doc.head.docType === DOC_TYPE.PCB ||
      doc.head.docType === DOC_TYPE.PCB_MODULE ||
      doc.head.docType === DOC_TYPE.PCB_COMPONENT
    ) {
      return { js, doc };
    }
  } else if (aName.toLowerCase().endsWith('.zip')) {
    const zip = new wxZipInputStream(aBytes);

    if (!zip.IsOk()) return null;

    for (let entry = zip.GetNextEntry(); entry !== null; entry = zip.GetNextEntry()) {
      const name = entry.GetName();
      const data = entry.Read();

      if (data === null) continue;

      const found = FindBoardInStream(name, data);

      if (found) return found;
    }
  }

  return null;
}

/** `std::map<wxString, T>` in key order. */
function sortedEntries<T>(aMap: ReadonlyMap<string, T>): [string, T][] {
  return [...aMap].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `wxSplit( s, c, '\0' )`. */
const split = (s: string, c: string): string[] => wxSplit(s, c, '');

/** `wxArrayString[i]`, '' past the end. */
const at = (a: readonly string[], i: number): string => a[i] ?? '';

export class PCB_IO_EASYEDA extends PCB_IO {
  private m_loadedFootprints: FOOTPRINT_MAP = new Map();

  constructor() {
    super('EasyEDA (JLCEDA) Standard');
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('EasyEDA (JLCEDA) Std files', ['json', 'zip']);
  }

  override GetLibraryFileDesc(): IO_FILE_DESC {
    return this.GetBoardFileDesc();
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return this.GetBoardFileDesc();
  }

  private find(aFileName: string): FOUND | null {
    const data = this.m_readFile(aFileName);

    if (!data) return null;

    return FindBoardInStream(aFileName, data);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    try {
      return this.find(aFileName) !== null;
    } catch {
      // nlohmann::json::exception, std::exception
    }

    return false;
  }

  override CanReadFootprint(aFileName: string): boolean {
    return this.CanReadBoard(aFileName);
  }

  override CanReadLibrary(aFileName: string): boolean {
    return this.CanReadBoard(aFileName);
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.m_loadedFootprints.clear();

    this.m_props = aProperties;
    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    if (this.m_progressReporter) {
      this.m_progressReporter.Report(`Loading ${aFileName}...`);

      if (!this.m_progressReporter.KeepRefreshing())
        throw new IO_ERROR('File import canceled by user.');
    }

    const parser = new PCB_IO_EASYEDA_PARSER(null);

    try {
      const found = this.find(aFileName);

      if (!found) throw new IO_ERROR(`Unable to find a valid board in '${aFileName}'`);

      const { js, doc } = found;

      const pcbDoc = DOCUMENT_PCB_from_json(js);

      const innerStart = 21;
      const innerEnd = 52;

      let maxLayer = innerStart;
      const layerNames = new Map<PCB_LAYER_ID, string>();

      for (const layerLine of pcbDoc.layers) {
        const parts = split(layerLine, '~');
        const layerId = atoi(at(parts, 0));
        const layerName = at(parts, 1);
        const enabled = at(parts, 5) !== 'false';

        if (layerId >= innerStart && layerId <= innerEnd && enabled) maxLayer = layerId + 1;

        layerNames.set(parser.LayerToKi(at(parts, 0)), layerName);
      }

      board.SetCopperLayerCount(2 + maxLayer - innerStart);

      for (const [klayer, name] of [...layerNames].sort(([a], [b]) => a - b))
        board.SetLayerName(klayer, name);

      const bds = board.GetDesignSettings();
      const defNetclass = bds.m_NetSettings.GetDefaultNetclass();

      if (pcbDoc.DRCRULE) {
        const rules = pcbDoc.DRCRULE;
        const defRules = rules.get('Default');

        if (defRules !== undefined && typeof defRules === 'object' && defRules !== null) {
          const num = (key: string): number | undefined => {
            const v = Array.isArray(defRules)
              ? undefined
              : (defRules as { [k: string]: JSON_VALUE })[key];
            return typeof v === 'number' ? v : undefined;
          };

          // `SetTrackWidth( double )`: the scaled value narrowed to int
          let v = num('trackWidth');
          if (v !== undefined) defNetclass.SetTrackWidth(Math.trunc(parser.ScaleSize(v)));

          v = num('clearance');
          if (v !== undefined) defNetclass.SetClearance(Math.trunc(parser.ScaleSize(v)));

          v = num('viaHoleD');
          if (v !== undefined) defNetclass.SetViaDrill(Math.trunc(parser.ScaleSize(v)));

          v = num('viaHoleDiameter'); // Yes, this is via diameter, not drill diameter
          if (v !== undefined) defNetclass.SetViaDiameter(Math.trunc(parser.ScaleSize(v)));
        }
      }

      const origin = { x: doc.head.x, y: doc.head.y };
      parser.ParseBoard(board, origin, this.m_loadedFootprints, doc.shape);

      // Center the board
      const outlineBbox = board.ComputeBoundingBox(true, true);
      const pageInfo = board.GetPageSettings();

      // `GetWidthMils() / 2`: an int halved as an int
      const pageCenter = {
        x: pcbIUScale.milsToIU(Math.trunc(pageInfo.GetWidthMils() / 2)),
        y: pcbIUScale.milsToIU(Math.trunc(pageInfo.GetHeightMils() / 2)),
      };

      const center = outlineBbox.GetCenter();
      const offset = { x: pageCenter.x - center.x, y: pageCenter.y - center.y };

      const alignGrid = pcbIUScale.mmToIU(10);
      offset.x = KiROUND(offset.x / alignGrid) * alignGrid;
      offset.y = KiROUND(offset.y / alignGrid) * alignGrid;

      board.Move(offset);
      bds.SetAuxOrigin(offset);

      return board;
    } catch (e) {
      if (e instanceof JSON_EXCEPTION || !(e instanceof IO_ERROR)) {
        throw new IO_ERROR(
          `Error loading board '${aFileName}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      throw e;
    }
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  override FootprintEnumerate(
    aFootprintNames: string[],
    aLibraryPath: string,
    _aBestEfforts: boolean,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    try {
      const found = this.find(aLibraryPath);

      if (!found) throw new IO_ERROR(`Unable to find valid footprints in '${aLibraryPath}'`);

      const { js, doc } = found;

      if (doc.head.docType === DOC_TYPE.PCB || doc.head.docType === DOC_TYPE.PCB_MODULE) {
        for (const shapIn of doc.shape) {
          const shap = shapIn.replaceAll('#@$', '\n');
          const parts = split(shap, '\n');

          if (parts.length < 1) continue;

          const paramsRoot = split(parts[0]!, '~');

          if (paramsRoot.length < 1) continue;

          const rootType = paramsRoot[0]!;

          if (rootType === 'LIB') {
            if (paramsRoot.length < 4) continue;

            let packageName = `Unknown_${at(paramsRoot, 1)}_${at(paramsRoot, 2)}`;

            const paramParts = split(at(paramsRoot, 3), '`');

            for (let i = 1; i < paramParts.length; i += 2) {
              const key = paramParts[i - 1]!;
              const value = paramParts[i]!;

              if (key === 'package') packageName = value;
            }

            aFootprintNames.push(packageName);
          }
        }
      } else if (doc.head.docType === DOC_TYPE.PCB_COMPONENT) {
        const pcbDoc = DOCUMENT_PCB_from_json(js);

        let packageName = `Unknown_${pcbDoc.uuid ?? 'Unknown'}`;

        const c_para = pcbDoc.c_para ?? doc.head.c_para;

        if (c_para) packageName = c_para.get('package') ?? packageName;

        aFootprintNames.push(packageName);
      }
    } catch (e) {
      if (e instanceof IO_ERROR && !(e instanceof JSON_EXCEPTION)) throw e;

      throw new IO_ERROR(
        `Error enumerating footprints in library '${aLibraryPath}': ${(e as Error).message}`,
      );
    }
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    const parser = new PCB_IO_EASYEDA_PARSER(null);

    this.m_loadedFootprints.clear();

    try {
      const found = this.find(aLibraryPath);

      if (!found) throw new IO_ERROR(`Unable to find valid footprints in '${aLibraryPath}'`);

      const { js, doc } = found;

      if (doc.head.docType === DOC_TYPE.PCB || doc.head.docType === DOC_TYPE.PCB_MODULE) {
        for (const shapIn of doc.shape) {
          if (!shapIn.includes('LIB')) continue;

          const shap = shapIn.replaceAll('#@$', '\n');
          const parts = split(shap, '\n');

          if (parts.length < 1) continue;

          const paramsRoot = split(parts[0]!, '~');

          if (paramsRoot.length < 1) continue;

          const rootType = paramsRoot[0]!;

          if (rootType === 'LIB') {
            if (paramsRoot.length < 4) continue;

            const origin = {
              x: parser.Convert(at(paramsRoot, 1)),
              y: parser.Convert(at(paramsRoot, 2)),
            };

            let packageName = `Unknown_${at(paramsRoot, 1)}_${at(paramsRoot, 2)}`;

            const paramParts = split(at(paramsRoot, 3), '`');

            const paramMap = new Map<string, string>();

            for (let i = 1; i < paramParts.length; i += 2) {
              const key = paramParts[i - 1]!;
              const value = paramParts[i]!;

              if (key === 'package') packageName = value;

              paramMap.set(key, value);
            }

            let orientation = new EDA_ANGLE(0);
            if (at(paramsRoot, 4) !== '')
              orientation = new EDA_ANGLE(parser.Convert(at(paramsRoot, 4)));

            let layer = 1;

            if (at(paramsRoot, 7) !== '') layer = Math.trunc(parser.Convert(at(paramsRoot, 7)));

            if (packageName === aFootprintName) {
              parts.splice(0, 1);

              const footprint = parser.ParseFootprint(
                origin,
                orientation,
                layer,
                null,
                paramMap,
                this.m_loadedFootprints,
                parts,
              );

              if (!footprint) return null;

              return finishLibraryFootprint(footprint);
            }
          }
        }
      } else if (doc.head.docType === DOC_TYPE.PCB_COMPONENT) {
        const pcbDoc = DOCUMENT_PCB_from_json(js);

        let packageName = `Unknown_${pcbDoc.uuid ?? 'Unknown'}`;

        const c_para = pcbDoc.c_para ?? doc.head.c_para;

        if (c_para) {
          packageName = c_para.get('package') ?? packageName;

          if (packageName !== aFootprintName) return null;

          const origin = { x: doc.head.x, y: doc.head.y };

          const footprint = parser.ParseFootprint(
            origin,
            ANGLE_0,
            F_Cu,
            null,
            c_para,
            this.m_loadedFootprints,
            doc.shape,
          );

          if (!footprint) return null;

          return finishLibraryFootprint(footprint);
        }
      }
    } catch (e) {
      if (e instanceof IO_ERROR && !(e instanceof JSON_EXCEPTION)) throw e;

      throw new IO_ERROR(
        `Error reading footprint '${aFootprintName}' from library '${aLibraryPath}': ${(e as Error).message}`,
      );
    }

    return null;
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    const result: FOOTPRINT[] = [];

    for (const [, footprint] of sortedEntries(this.m_loadedFootprints))
      result.push(footprint.Clone() as FOOTPRINT);

    return result;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }
}

/** The field reset both `FootprintLoad` arms end with. */
function finishLibraryFootprint(footprint: FOOTPRINT): FOOTPRINT {
  footprint.Reference().SetPosition({ x: 0, y: 0 });
  footprint.Reference().SetTextAngle(ANGLE_0);
  footprint.Reference().SetVisible(true);

  footprint.Value().SetPosition({ x: 0, y: 0 });
  footprint.Value().SetTextAngle(ANGLE_0);
  footprint.Value().SetVisible(true);

  footprint.AutoPositionFields();

  return footprint;
}
