// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/pcb_io_altium_designer.cpp`: the Altium Designer
 * plugin — `.PcbDoc` boards, `.PcbLib` / `.IntLib` footprint libraries — and
 * the project-variant / project-parameter application every Altium board
 * plugin shares.
 *
 * `LoadBoard` in upstream's four Altium plugins differs only in the stream
 * directory names; the shared body is `loadAltiumBoard` here, each plugin
 * passing its own mapping. The `.PrjPcb` named by the `project_file`
 * property is read through the plugin's file source.
 */

import {
  ALTIUM_BINARY_PARSER,
  FormatPath,
  latin1ToString,
} from '@ziroeda/common/io/altium/altium_binary_parser.js';
import {
  type ALTIUM_PROJECT_VARIANT,
  AltiumUniqueIdToKiid,
  ParseAltiumProjectParameters,
  ParseAltiumProjectVariants,
} from '@ziroeda/common/io/altium/altium_project_variants.js';
import { CFBException } from '@ziroeda/common/io/altium/compoundfilereader.js';
import { IO_FILE_DESC, type IO_FILE_READER } from '@ziroeda/common/io/io_base.js';
import { COMPOUND_FILE_HEADER, fileHasBinaryHeader } from '@ziroeda/common/io/io_utils.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { Reporter } from '@ziroeda/common/reporter.js';
import { wxCmpNoCase } from '@ziroeda/common/wx/wxstring.js';
import { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import {
  type INPUT_LAYER_DESC,
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { ALTIUM_PCB, ALTIUM_PCB_DIR } from './altium_pcb.js';
import { ALTIUM_PCB_COMPOUND_FILE } from './altium_pcb_compound_file.js';

export function ApplyAltiumProjectVariantsToBoard(
  aBoard: BOARD,
  aVariants: readonly ALTIUM_PROJECT_VARIANT[],
): void {
  const fpByRef = new Map<string, FOOTPRINT>();
  const fpByUid = new Map<KIID, FOOTPRINT[]>();

  for (const fp of aBoard.Footprints()) {
    fpByRef.set(fp.GetReference(), fp);

    // The importer stores the component unique id as the last path element. Repeated
    // channels share one id across footprints, so collect all of them to detect ambiguity.
    const path = fp.GetPath();

    if (path.length >= 2) {
      const uid = path[path.length - 1]!;
      const list = fpByUid.get(uid);
      if (list) list.push(fp);
      else fpByUid.set(uid, [fp]);
    }
  }

  for (const pv of aVariants) {
    aBoard.AddVariant(pv.name);

    if (pv.description !== '' && pv.description !== pv.name)
      aBoard.SetVariantDescription(pv.name, pv.description);

    for (const entry of pv.variations) {
      let target: FOOTPRINT | null = null;

      // Prefer unique-id matching, but only when it resolves to a single footprint. A
      // shared id (repeated channels) is ambiguous, so fall back to the designator.
      if (entry.uniqueId !== '') {
        const it = fpByUid.get(AltiumUniqueIdToKiid(entry.uniqueId));

        if (it !== undefined && it.length === 1) target = it[0]!;
      }

      if (!target) {
        const it = fpByRef.get(entry.designator);

        if (it !== undefined) target = it;
      }

      if (!target) continue;

      const fpVariant = target.AddVariant(pv.name);

      if (!fpVariant) continue;

      if (entry.kind === 1) {
        fpVariant.SetDNP(true);
        fpVariant.SetExcludedFromBOM(true);
        fpVariant.SetExcludedFromPosFiles(true);
      } else if (entry.kind === 0) {
        for (const [key, value] of [...entry.alternateFields].sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        )) {
          if (wxCmpNoCase(key, 'LibReference') === 0) fpVariant.SetFieldValue('Value', value);
          else if (wxCmpNoCase(key, 'Description') === 0)
            fpVariant.SetFieldValue('Description', value);
          else if (wxCmpNoCase(key, 'Footprint') === 0) fpVariant.SetFieldValue('Footprint', value);
        }
      }
    }
  }
}

export function ApplyAltiumProjectParametersToProject(
  aProject: PCB_IO_PROJECT | null,
  aParameters: ReadonlyMap<string, string>,
): void {
  if (!aProject) return;

  // Names KiCad resolves contextually (board fields, title block, special strings). Importing
  // them as project variables would shadow nothing useful and could surprise the user, so they
  // are left to native resolution.
  const reserved = new Set([
    'LAYER',
    'FILENAME',
    'FILEPATH',
    'PROJECTNAME',
    'VARIANT',
    'VARIANT_DESC',
    'ISSUE_DATE',
    'CURRENT_DATE',
    'CURRENT_TIME_LOCALE',
    'CURRENT_TIME_HH_MM_SS',
    'REVISION',
    'TITLE',
    'COMPANY',
    'COMMENT1',
    'COMMENT2',
    'COMMENT3',
    'COMMENT4',
    'COMMENT5',
    'COMMENT6',
    'COMMENT7',
    'COMMENT8',
    'COMMENT9',
    'VCSHASH',
    'VCSSHORTHASH',
    'KICAD_VERSION',
    'PAPER',
    'SHEETNAME',
    'SHEETPATH',
    'DRC_WARNING',
    'DRC_ERROR',
    'ERC_WARNING',
    'ERC_ERROR',
  ]);

  const textVars = aProject.GetTextVars();
  let added = false;

  for (const [name, value] of aParameters) {
    if (reserved.has(name)) continue;

    // Don't clobber a variable the user (or a prior import step) already set.
    if (textVars.has(name)) continue;

    textVars.set(name, value);
    added = true;
  }

  if (added) aProject.IncrementTextVarsTicker?.();
}

/**
 * `LoadBoard` of the Altium board plugins, shared (see the file header): the
 * compound file parsed into the board, then the `.PrjPcb`'s variants and
 * parameters applied when the `project_file` property names one.
 */
export function loadAltiumBoard(
  aFileName: string,
  aBoard: BOARD,
  aMapping: Map<ALTIUM_PCB_DIR, string>,
  aReadFile: IO_FILE_READER,
  aProgressReporter: PROGRESS_REPORTER | null,
  aLayerMappingHandler: LAYER_MAPPING_HANDLER,
  aReporter: Reporter | null,
  aProperties: PCB_IO_PROPERTIES | null,
  aProject: PCB_IO_PROJECT | null,
): void {
  const data = aReadFile(aFileName);

  if (!data) throw new IO_ERROR(`Cannot open file '${aFileName}'.`);

  const altiumPcbFile = new ALTIUM_PCB_COMPOUND_FILE(data);

  try {
    // Parse File
    const pcb = new ALTIUM_PCB(aBoard, aProgressReporter, aLayerMappingHandler, aReporter);
    pcb.Parse(altiumPcbFile, aMapping);
  } catch (exception) {
    if (exception instanceof CFBException) throw new IO_ERROR(exception.message);

    throw exception;
  }

  const projectFile = aProperties?.get('project_file');

  if (projectFile !== undefined) {
    const bytes = aReadFile(projectFile);
    const text = bytes ? latin1ToString(bytes) : '';

    const variants = ParseAltiumProjectVariants(text);

    if (variants.length !== 0) ApplyAltiumProjectVariantsToBoard(aBoard, variants);

    ApplyAltiumProjectParametersToProject(aProject, ParseAltiumProjectParameters(text));
  }
}

interface ALTIUM_FILE_CACHE {
  m_Files: ALTIUM_PCB_COMPOUND_FILE[];
  m_Timestamp: number;
}

export class PCB_IO_ALTIUM_DESIGNER extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();
  private readonly m_fplibFiles = new Map<string, ALTIUM_FILE_CACHE>();

  constructor() {
    super('Altium Designer');

    // m_reporter = &WXLOG_REPORTER::GetInstance(): the caller's SetReporter here

    this.RegisterCallback(PCB_IO_ALTIUM_DESIGNER.DefaultLayerMappingCallback);
  }

  // -----<PUBLIC PCB_IO API>--------------------------------------------------
  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Altium Designer PCB files', ['PcbDoc']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Altium PCB Library or Integrated Library', ['PcbLib', 'IntLib']);
  }

  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
  }

  /**
   * Return the automapped layers.
   *
   * @param aInputLayerDescriptionVector
   * @return Auto-mapped layers
   */
  static DefaultLayerMappingCallback(
    aInputLayerDescriptionVector: readonly INPUT_LAYER_DESC[],
  ): Map<string, PCB_LAYER_ID> {
    const retval = new Map<string, PCB_LAYER_ID>();

    // Just return a the auto-mapped layers
    for (const layerDesc of aInputLayerDescriptionVector) {
      // std::map::insert: the first layer of a name stays
      if (!retval.has(layerDesc.Name)) retval.set(layerDesc.Name, layerDesc.AutoMapLayer);
    }

    return retval;
  }

  /** `checkFileHeader( aFileName )`: the Compound File Binary Format header, on the file's bytes. */
  static checkFileHeader(aData: Uint8Array | null): boolean {
    // Compound File Binary Format header
    return fileHasBinaryHeader(aData, COMPOUND_FILE_HEADER);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return PCB_IO_ALTIUM_DESIGNER.checkFileHeader(this.m_readFile(aFileName));
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return PCB_IO_ALTIUM_DESIGNER.checkFileHeader(this.m_readFile(aFileName));
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.m_props = aProperties;

    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    const mapping = new Map<ALTIUM_PCB_DIR, string>([
      [ALTIUM_PCB_DIR.FILE_HEADER, 'FileHeader'],
      [ALTIUM_PCB_DIR.ARCS6, 'Arcs6'],
      [ALTIUM_PCB_DIR.BOARD6, 'Board6'],
      [ALTIUM_PCB_DIR.BOARDREGIONS, 'BoardRegions'],
      [ALTIUM_PCB_DIR.CLASSES6, 'Classes6'],
      [ALTIUM_PCB_DIR.COMPONENTS6, 'Components6'],
      [ALTIUM_PCB_DIR.COMPONENTBODIES6, 'ComponentBodies6'],
      [ALTIUM_PCB_DIR.DIMENSIONS6, 'Dimensions6'],
      [ALTIUM_PCB_DIR.EXTENDPRIMITIVEINFORMATION, 'ExtendedPrimitiveInformation'],
      [ALTIUM_PCB_DIR.FILLS6, 'Fills6'],
      [ALTIUM_PCB_DIR.MODELS, 'Models'],
      [ALTIUM_PCB_DIR.NETS6, 'Nets6'],
      [ALTIUM_PCB_DIR.PADS6, 'Pads6'],
      [ALTIUM_PCB_DIR.POLYGONS6, 'Polygons6'],
      [ALTIUM_PCB_DIR.REGIONS6, 'Regions6'],
      [ALTIUM_PCB_DIR.RULES6, 'Rules6'],
      [ALTIUM_PCB_DIR.SHAPEBASEDREGIONS6, 'ShapeBasedRegions6'],
      [ALTIUM_PCB_DIR.SMARTUNIONS, 'SmartUnions'],
      [ALTIUM_PCB_DIR.TEXTS6, 'Texts6'],
      [ALTIUM_PCB_DIR.TRACKS6, 'Tracks6'],
      [ALTIUM_PCB_DIR.VIAS6, 'Vias6'],
      [ALTIUM_PCB_DIR.WIDESTRINGS6, 'WideStrings6'],
    ]);

    loadAltiumBoard(
      aFileName,
      board,
      mapping,
      this.m_readFile,
      this.m_progressReporter,
      this.m_layerMappable.m_layer_mapping_handler,
      this.m_reporter,
      aProperties,
      aProject,
    );

    return board;
  }

  GetLibraryTimestamp(aLibraryPath: string): number {
    // File hasn't been loaded yet.
    if (aLibraryPath === '') return 0;

    // The browser's files carry no modification time; a readable library is timestamp 1.
    return this.m_readFile(aLibraryPath) ? 1 : 0;
  }

  private loadAltiumLibrary(aLibraryPath: string): void {
    const timestamp = this.GetLibraryTimestamp(aLibraryPath);

    const cached = this.m_fplibFiles.get(aLibraryPath);

    if (cached && cached.m_Timestamp === timestamp) return; // Already loaded

    try {
      const libFiles: ALTIUM_FILE_CACHE = cached ?? { m_Files: [], m_Timestamp: 0 };
      this.m_fplibFiles.set(aLibraryPath, libFiles);

      const data = this.m_readFile(aLibraryPath);

      if (!data) throw new IO_ERROR(`Cannot open file '${aLibraryPath}'.`);

      if (aLibraryPath.toLowerCase().endsWith('.pcblib')) {
        libFiles.m_Files.push(new ALTIUM_PCB_COMPOUND_FILE(data));
      } else if (aLibraryPath.toLowerCase().endsWith('.intlib')) {
        const lib = new ALTIUM_PCB_COMPOUND_FILE(data);

        for (const [, pcbCfe] of lib.EnumDir('PCBLib')) {
          const libFile = new ALTIUM_PCB_COMPOUND_FILE();

          if (lib.DecodeIntLibStream(pcbCfe, libFile)) libFiles.m_Files.push(libFile);
        }
      }

      libFiles.m_Timestamp = timestamp;
    } catch (exception) {
      if (exception instanceof CFBException) throw new IO_ERROR(exception.message);

      throw exception;
    }
  }

  override FootprintEnumerate(
    aFootprintNames: string[],
    aLibraryPath: string,
    _aBestEfforts: boolean,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    this.loadAltiumLibrary(aLibraryPath);

    const cache = this.m_fplibFiles.get(aLibraryPath);

    if (!cache) return; // No footprint libraries in file, ignore.

    try {
      for (const altiumLibFile of cache.m_Files) {
        // Map code-page-dependent names to unicode names
        const patternMap = altiumLibFile.ListLibFootprints();

        const streamName = ['Library', 'Data'];
        const libraryData = altiumLibFile.FindStream(streamName);

        if (libraryData === null) {
          throw new IO_ERROR(`File not found: '${FormatPath(streamName)}'.`);
        }

        const parser = new ALTIUM_BINARY_PARSER(altiumLibFile, libraryData);

        parser.ReadProperties();

        let numberOfFootprints = parser.ReadUint32();

        // The number of footprints might be bogus. Following it is a list of index strings to
        // find the footprints, and this list might actually be longer than how many footprints
        // actually are in the library.
        // If this case was detected, truncate the list to the number of footprints.
        // Sample in #18452 shows that by simply truncating can get the correct footprints.
        // Fixes https://gitlab.com/kicad/code/kicad/issues/18452.
        // After truncation we shall no longer detect if the stream is fully parsed.
        let footprintListNotTruncated = true;

        if (patternMap.size < numberOfFootprints) {
          numberOfFootprints = patternMap.size;
          footprintListNotTruncated = false;
        }

        for (let i = 0; i < numberOfFootprints; i++) {
          parser.ReadAndSetSubrecordLength();

          const charBuffer = parser.ReadCharBuffer();
          const fpPattern = charBuffer ? latin1ToString(charBuffer) : '';

          const it = patternMap.find(fpPattern);

          if (it !== undefined) {
            aFootprintNames.push(it[1]); // Proper unicode name
          } else {
            throw new IO_ERROR(`Component name not found: '${fpPattern}'`);
          }

          parser.SkipSubrecord();
        }

        if (parser.HasParsingError()) {
          throw new IO_ERROR(`${FormatPath(streamName)} stream was not parsed correctly`);
        }

        if (footprintListNotTruncated && parser.GetRemainingBytes() !== 0) {
          throw new IO_ERROR(`${FormatPath(streamName)} stream is not fully parsed`);
        }
      }
    } catch (exception) {
      if (exception instanceof CFBException) throw new IO_ERROR(exception.message);

      throw exception;
    }
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    this.loadAltiumLibrary(aLibraryPath);

    const cache = this.m_fplibFiles.get(aLibraryPath);

    if (!cache) throw new IO_ERROR(`No footprints in library '${aLibraryPath}'`);

    try {
      for (const altiumLibFile of cache.m_Files) {
        altiumLibFile.CacheLibModels();
        const [dirName] = altiumLibFile.FindLibFootprintDirName(aFootprintName);

        if (dirName === '') continue;

        // Parse File
        const pcb = new ALTIUM_PCB(
          this.m_board as BOARD,
          null,
          this.m_layerMappable.m_layer_mapping_handler,
          this.m_reporter,
          aLibraryPath,
          aFootprintName,
        );
        return pcb.ParseFootprint(altiumLibFile, aFootprintName);
      }
    } catch (exception) {
      if (exception instanceof CFBException) throw new IO_ERROR(exception.message);

      throw exception;
    }

    throw new IO_ERROR(`Footprint '${aFootprintName}' not found in '${aLibraryPath}'.`);
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    const footprints: FOOTPRINT[] = [];

    // caller owns result, clone not alias
    for (const fp of this.m_board?.Footprints() ?? []) footprints.push(fp.Clone() as FOOTPRINT);

    return footprints;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }
}
