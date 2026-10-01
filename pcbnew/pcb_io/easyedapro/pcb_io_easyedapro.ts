// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/easyedapro/pcb_io_easyedapro.cpp` / `.h`: the EasyEDA
 * (JLCEDA) Professional importer — a project archive (`.epro`, or a `.zip`
 * holding `project.json`) and its footprints, or a lone `.efoo`.
 *
 * A project with several boards asks the registered chooser which to load,
 * unless the `pcb_id` property names one (see PROJECT_CHOOSER_PLUGIN).
 */

import {
  EASY_IT_BREAK,
  EASY_IT_CONTINUE,
  IterateZipFiles,
  ParseJsonLines,
  ParseJsonLinesWithSeparation,
  ProjectToSelectorDialog,
  ReadProjectOrDeviceFile,
  ShortenLibName,
  ToKiCadLibID,
} from '@ziroeda/common/io/easyedapro/easyedapro_import_utils.js';
import {
  type BLOB,
  BLOB_from_json,
  IMPORT_POURED_ECOP,
  PCB_ATTR_from_json,
  type POURED,
  POURED_from_json,
} from '@ziroeda/common/io/easyedapro/easyedapro_parser.js';
import {
  type CHOOSE_PROJECT_HANDLER,
  PROJECT_CHOOSER_PLUGIN,
} from '@ziroeda/common/io/common/plugin_common_choose_project.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  isObject,
  isString,
  jAt,
  jContains,
  jEq,
  jMap,
  jParse,
  jSize,
  jStr,
  type JSON_VALUE,
} from '@ziroeda/common/json_common.js';
import { RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import {
  type FOOTPRINT_MAP,
  PCB_IO_EASYEDAPRO_PARSER,
  type POURED_MAP,
} from './pcb_io_easyedapro_parser.js';

interface PRJ_DATA {
  m_Footprints: FOOTPRINT_MAP;
  m_Blobs: Map<string, BLOB>;
  m_Poured: Map<string, POURED_MAP>;
}

/** `wxFileName::GetName()` / `GetExt()`. */
function fileNameParts(aPath: string): { name: string; ext: string } {
  const base = aPath.substring(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0
    ? { name: base, ext: '' }
    : { name: base.substring(0, dot), ext: base.substring(dot + 1) };
}

/** `wxBase64Encode( utf8 )`. */
function base64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** `std::map<wxString, …>` order over code points. */
function codePointLess(a: string, b: string): number {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; i++) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;

    if (ca !== cb) return ca < cb ? -1 : 1;

    if (ca > 0xffff) i++;
  }

  return a.length - b.length;
}

export class PCB_IO_EASYEDAPRO extends PCB_IO {
  private readonly m_chooser = new PROJECT_CHOOSER_PLUGIN();
  private m_projectData: PRJ_DATA | null = null;

  constructor() {
    super('EasyEDA (JLCEDA) Professional');
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('EasyEDA (JLCEDA) Pro files', ['epro', 'zip']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('EasyEDA (JLCEDA) Pro files', ['elibz', 'efoo']);
  }

  /** `dynamic_cast<PROJECT_CHOOSER_PLUGIN*>( this )`: the chooser half, held by composition. */
  ProjectChooser(): PROJECT_CHOOSER_PLUGIN {
    return this.m_chooser;
  }

  /** `PROJECT_CHOOSER_PLUGIN::RegisterCallback`. */
  RegisterCallback(aHandler: CHOOSE_PROJECT_HANDLER): void {
    this.m_chooser.RegisterCallback(aHandler);
  }

  private data(aPath: string): Uint8Array {
    const d = this.m_readFile(aPath);

    if (!d) throw new IO_ERROR(`Cannot read ZIP archive '${aPath}'`);

    return d;
  }

  private warn = (aMsg: string): void => this.Report(aMsg, RPT_SEVERITY_WARNING);

  override CanReadBoard(aFileName: string): boolean {
    if (aFileName.toLowerCase().endsWith('.epro')) {
      return true;
    } else if (aFileName.toLowerCase().endsWith('.zip')) {
      const bytes = this.m_readFile(aFileName);

      if (!bytes) return false;

      let found = false;

      try {
        IterateZipFiles(bytes, aFileName, (name) => {
          if (name === 'project.json') {
            found = true;
            return EASY_IT_BREAK;
          }

          return EASY_IT_CONTINUE;
        });
      } catch {
        return false;
      }

      return found;
    }

    return false;
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
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

    const parser = new PCB_IO_EASYEDAPRO_PARSER(null, null);
    parser.m_logError = (m) => this.Report(m);

    const fname = fileNameParts(aFileName);
    const fpLibName = ShortenLibName(fname.name);

    if (fname.ext === 'epro' || fname.ext === 'zip') {
      const zipData = this.data(aFileName);
      const project = ReadProjectOrDeviceFile(zipData, aFileName);

      let pcbToLoad = '';

      const pcbId = this.m_props?.get('pcb_id');

      if (pcbId !== undefined) {
        pcbToLoad = pcbId;
      } else {
        const prjPcbNames = jMap(jAt(project, 'pcbs'), jStr);

        if (prjPcbNames.size === 1) {
          pcbToLoad = [...prjPcbNames.keys()][0]!;
        } else {
          const chosen = this.m_chooser.Choose(ProjectToSelectorDialog(project, true, false));

          if (chosen.length > 0) pcbToLoad = chosen[0]!.PCBId;
        }
      }

      if (pcbToLoad === '') return null as unknown as BOARD;

      this.LoadAllDataFromProject(zipData, aFileName, project);

      if (!this.m_projectData) return null as unknown as BOARD;

      const projectData = this.m_projectData;

      IterateZipFiles(zipData, aFileName, (name, pcbUuid, zip) => {
        if (!name.endsWith('.epcb')) return EASY_IT_CONTINUE;

        if (pcbUuid !== pcbToLoad) return EASY_IT_CONTINUE;

        let pcbLines: JSON_VALUE[] | null = null;

        const lineBlocks = ParseJsonLinesWithSeparation(zip, name, this.warn);

        if (lineBlocks.length === 0) return EASY_IT_CONTINUE;

        if (lineBlocks.length > 1) {
          for (const block of lineBlocks) {
            let docType = '';
            let headData: JSON_VALUE = null;

            for (const line of block) {
              if (jSize(line) < 2) continue;

              if (!isString(jAt(line, 0))) continue;

              const lineType = jStr(jAt(line, 0));

              if (lineType === 'DOCTYPE') {
                if (!isString(jAt(line, 1))) continue;

                docType = jStr(jAt(line, 1));
              } else if (lineType === 'HEAD') {
                if (!isObject(jAt(line, 1))) continue;

                headData = jAt(line, 1);
              }
            }

            if (docType === 'FOOTPRINT') {
              const fpUuid = jStr(jAt(headData, 'uuid'));
              const fpTitle = jStr(jAt(headData, 'title'));

              const footprint = parser.ParseFootprint(project, fpUuid, block);

              if (!footprint) return EASY_IT_CONTINUE;

              const fpID = ToKiCadLibID(fpLibName, fpTitle);
              footprint.SetFPID(fpID);

              // std::map::emplace: the first of a uuid stays
              if (!projectData.m_Footprints.has(fpUuid))
                projectData.m_Footprints.set(fpUuid, footprint);
            } else if (docType === 'PCB') {
              pcbLines = block;
            }
          }
        }

        if (pcbLines === null) pcbLines = lineBlocks[0]!;

        const boardKey = `${pcbUuid}_0`;
        const boardPouredKey = base64EncodeUtf8(boardKey);

        const boardPoured: POURED_MAP = projectData.m_Poured.get(boardPouredKey) ?? new Map();

        parser.ParseBoard(
          board,
          project,
          projectData.m_Footprints,
          projectData.m_Blobs,
          boardPoured,
          pcbLines,
          ShortenLibName(fname.name),
        );

        return EASY_IT_BREAK;
      });
    }

    return board;
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
    const fname = fileNameParts(aLibraryPath);

    if (fname.ext === 'efoo') {
      const text = new TextDecoder('utf-8').decode(this.data(aLibraryPath));

      for (const line of text.split(/\r\n|\r|\n/)) {
        if (!line.includes('ATTR')) continue; // Don't bother parsing

        const js = jParse(line);

        if (jEq(jAt(js, 0), 'ATTR') && jEq(jAt(js, 7), 'Footprint'))
          aFootprintNames.push(jStr(jAt(js, 8)));
      }
    } else if (fname.ext === 'elibz' || fname.ext === 'epro' || fname.ext === 'zip') {
      const project = ReadProjectOrDeviceFile(this.data(aLibraryPath), aLibraryPath);
      const footprintMap = jMap(jAt(project, 'footprints'), (v) => v);

      for (const [, value] of footprintMap) {
        let title: string;

        if (jContains(value, 'display_title')) title = jStr(jAt(value, 'display_title'));
        else title = jStr(jAt(value, 'title'));

        aFootprintNames.push(title);
      }
    }
  }

  private LoadAllDataFromProject(
    aZipData: Uint8Array,
    aProjectPath: string,
    aProject: JSON_VALUE,
  ): void {
    this.m_projectData = { m_Footprints: new Map(), m_Blobs: new Map(), m_Poured: new Map() };
    const projectData = this.m_projectData;

    const parser = new PCB_IO_EASYEDAPRO_PARSER(null, null);
    const fname = fileNameParts(aProjectPath);
    const fpLibName = ShortenLibName(fname.name);

    IterateZipFiles(aZipData, aProjectPath, (name, baseName, zip) => {
      if (!name.endsWith('.efoo') && !name.endsWith('.eblob') && !name.endsWith('.ecop'))
        return EASY_IT_CONTINUE;

      const lines = ParseJsonLines(zip, name, this.warn);

      if (name.endsWith('.efoo')) {
        const fpData = jAt(jAt(aProject, 'footprints'), baseName);
        const fpTitle = jStr(jAt(fpData, 'title'));

        const footprint = parser.ParseFootprint(aProject, baseName, lines);

        if (!footprint) return EASY_IT_CONTINUE;

        const fpID = ToKiCadLibID(fpLibName, fpTitle);
        footprint.SetFPID(fpID);

        if (!projectData.m_Footprints.has(baseName))
          projectData.m_Footprints.set(baseName, footprint);
      } else if (name.endsWith('.eblob')) {
        for (const line of lines) {
          if (jEq(jAt(line, 0), 'BLOB')) {
            const blob = BLOB_from_json(line);
            projectData.m_Blobs.set(blob.objectId, blob);
          }
        }
      } else if (name.endsWith('.ecop') && IMPORT_POURED_ECOP) {
        for (const line of lines) {
          if (jEq(jAt(line, 0), 'POURED')) {
            if (!isString(jAt(line, 2))) continue; // Unknown type of POURED

            const poured = POURED_from_json(line);
            let byBase = projectData.m_Poured.get(baseName);
            if (!byBase) {
              byBase = new Map();
              projectData.m_Poured.set(baseName, byBase);
            }
            const list = byBase.get(poured.parentId);
            if (list) list.push(poured);
            else byBase.set(poured.parentId, [poured]);
          }
        }
      }

      return EASY_IT_CONTINUE;
    });
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    const parser = new PCB_IO_EASYEDAPRO_PARSER(null, null);
    let footprint: FOOTPRINT | null = null;

    const libFname = fileNameParts(aLibraryPath);

    const finish = (fp: FOOTPRINT): void => {
      const fpID = ToKiCadLibID('', aFootprintName);
      fp.SetFPID(fpID);

      fp.Reference().SetVisible(true);
      fp.Value().SetText(aFootprintName);
      fp.Value().SetVisible(true);
      fp.AutoPositionFields();
    };

    if (libFname.ext === 'efoo') {
      const lines = ParseJsonLines(this.data(aLibraryPath), aLibraryPath, this.warn);

      for (const js of lines) {
        if (jEq(jAt(js, 0), 'ATTR')) {
          const attr = PCB_ATTR_from_json(js);

          if (attr.key === 'Footprint' && attr.value !== aFootprintName) return null;
        }
      }

      footprint = parser.ParseFootprint(null, '', lines);

      if (!footprint)
        throw new IO_ERROR(`Cannot load footprint '${aFootprintName}' from '${aLibraryPath}'`);

      finish(footprint);
    } else if (libFname.ext === 'elibz' || libFname.ext === 'epro' || libFname.ext === 'zip') {
      const zipData = this.data(aLibraryPath);
      const project = ReadProjectOrDeviceFile(zipData, aLibraryPath);

      let fpUuid = '';

      const footprintMap = jMap(jAt(project, 'footprints'), (v) => v);

      for (const [uuid, data] of footprintMap) {
        let title: string;

        if (jContains(data, 'display_title')) title = jStr(jAt(data, 'display_title'));
        else title = jStr(jAt(data, 'title'));

        if (title === aFootprintName) {
          fpUuid = uuid;
          break;
        }
      }

      if (fpUuid === '')
        throw new IO_ERROR(`Footprint '${aFootprintName}' not found in project '${aLibraryPath}'`);

      IterateZipFiles(zipData, aLibraryPath, (name, baseName, zip) => {
        if (!name.endsWith('.efoo')) return EASY_IT_CONTINUE;

        if (baseName !== fpUuid) return EASY_IT_CONTINUE;

        const lines = ParseJsonLines(zip, name, this.warn);

        footprint = parser.ParseFootprint(project, fpUuid, lines);

        if (!footprint)
          throw new IO_ERROR(`Cannot load footprint '${aFootprintName}' from '${aLibraryPath}'`);

        finish(footprint);

        return EASY_IT_BREAK;
      });
    }

    return footprint;
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    const result: FOOTPRINT[] = [];

    if (!this.m_projectData) return result;

    for (const key of [...this.m_projectData.m_Footprints.keys()].sort(codePointLess))
      result.push(this.m_projectData.m_Footprints.get(key)!.Clone() as FOOTPRINT);

    return result;
  }
}
