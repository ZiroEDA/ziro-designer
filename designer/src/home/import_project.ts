// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Import Non-KiCad Project: `KICAD_MANAGER_FRAME::ImportNonKiCadProject`
 * (kicad/import_project.cpp) and `IMPORT_PROJ_HELPER` (kicad/import_proj.cpp),
 * the parts that decide WHAT is imported, kept apart from the manager so they
 * can be tested.
 *
 * What differs in a browser, and only that:
 *  - KiCad is handed one file and finds the schematic and board BESIDE it on
 *    disk (`ImportIndividualFile`: same name, each extension in turn). A page
 *    cannot read a folder it was not given, so the chooser takes several files
 *    and the siblings are looked for among them.
 *  - The destination is not a folder the user picks (`wxDirDialog`) but a new
 *    project in the account, named for the input file as upstream names
 *    `m_TargetProj`, and suffixed `_1`, `_2`... when the name is taken, as
 *    `FindEmptyTargetDir` does for a folder that is not empty.
 */
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import type { PickedHomeFile } from './files.js';
import { EMPTY_PCB, projectJson } from './new_project.js';
import {
  altiumProjectFilesWildcard,
  cadstarArchiveFilesWildcard,
  eagleFilesWildcard,
  easyEdaArchiveWildcard,
  easyEdaProFileWildcard,
  gedaProjectFilesWildcard,
  padsProjectFilesWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';

/** The rows of File > Import Non-KiCad Project, in kicad/menubar.cpp's order. */
export type ImportFormat =
  | 'altium'
  | 'cadstar'
  | 'eagle'
  | 'easyeda'
  | 'easyedapro'
  | 'pads'
  | 'geda';

export interface ImportFormatDesc {
  /** The menu row (KICAD_MANAGER_ACTIONS::importXxx FriendlyName). */
  menuLabel: string;
  /** `aWindowTitle`. */
  title: string;
  /** `aFilesWildcard`. */
  wildcard: () => ChooserFilter;
  /** `aSchFileExtensions`; `INPUT` is the input file's own extension. */
  schExts: readonly string[];
  /** `aPcbFileExtensions`. */
  pcbExts: readonly string[];
}

/** `KICAD_MANAGER_FRAME::OnImportXxx` (import_project.cpp:178-229), verbatim. */
export const IMPORT_FORMATS: Readonly<Record<ImportFormat, ImportFormatDesc>> = {
  altium: {
    menuLabel: 'Altium Project...',
    title: 'Import Altium Project Files',
    wildcard: altiumProjectFilesWildcard,
    schExts: ['SchDoc'],
    pcbExts: ['PcbDoc', 'CSPcbDoc', 'CMPcbDoc', 'SWPcbDoc'],
  },
  cadstar: {
    menuLabel: 'CADSTAR Project...',
    title: 'Import CADSTAR Archive Project Files',
    wildcard: cadstarArchiveFilesWildcard,
    schExts: ['csa'],
    pcbExts: ['cpa'],
  },
  eagle: {
    menuLabel: 'EAGLE Project...',
    title: 'Import Eagle Project Files',
    wildcard: eagleFilesWildcard,
    schExts: ['sch'],
    pcbExts: ['brd'],
  },
  easyeda: {
    menuLabel: 'EasyEDA (JLCEDA) Std Backup...',
    title: 'Import EasyEDA Std Backup',
    wildcard: easyEdaArchiveWildcard,
    schExts: ['INPUT'],
    pcbExts: ['INPUT'],
  },
  easyedapro: {
    menuLabel: 'EasyEDA (JLCEDA) Pro Project...',
    title: 'Import EasyEDA Pro Project',
    wildcard: easyEdaProFileWildcard,
    schExts: ['INPUT'],
    pcbExts: ['INPUT'],
  },
  pads: {
    menuLabel: 'PADS Project...',
    title: 'Import PADS Project Files',
    wildcard: padsProjectFilesWildcard,
    schExts: ['asc', 'txt'],
    pcbExts: ['asc', 'txt'],
  },
  geda: {
    menuLabel: 'gEDA / Lepton EDA Project...',
    title: 'Import gEDA / Lepton EDA Project Files',
    wildcard: gedaProjectFilesWildcard,
    schExts: ['prj', 'sch'],
    pcbExts: ['pcb'],
  },
};

/** The menu's order (kicad/menubar.cpp's importSubMenu). */
export const IMPORT_FORMAT_ORDER: readonly ImportFormat[] = [
  'altium',
  'cadstar',
  'eagle',
  'easyeda',
  'easyedapro',
  'pads',
  'geda',
];

/** A file the chooser gave: a name (with no folder) and its bytes. */
export interface PickedImportFile {
  name: string;
  bytes: Uint8Array;
}

const baseOf = (n: string): string => n.slice(n.lastIndexOf('/') + 1);
const stemOf = (n: string): string => {
  const b = baseOf(n);
  const dot = b.lastIndexOf('.');
  return dot < 0 ? b : b.slice(0, dot);
};
const extOf = (n: string): string => {
  const b = baseOf(n);
  const dot = b.lastIndexOf('.');
  return dot < 0 ? '' : b.slice(dot + 1);
};

/**
 * The input file: `inputdlg.GetPath()`. Of several chosen, the first the
 * wildcard admits, in the wildcard's own extension order (so for EAGLE the
 * `.sch` before the `.brd`, as either names the project).
 */
export function inputFileOf(
  aFormat: ImportFormat,
  aPicked: readonly PickedImportFile[],
): PickedImportFile | null {
  for (const ext of IMPORT_FORMATS[aFormat].wildcard().extensions) {
    const hit = aPicked.find((f) => extOf(f.name).toLowerCase() === ext.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * `importProj.m_TargetProj.SetName( m_InputFile.GetName() )`, then
 * `FindEmptyTargetDir`'s `_1`, `_2`... while the name is taken.
 */
export function targetProjectName(aInput: string, aTaken: ReadonlySet<string>): string {
  const name = stemOf(aInput);
  if (!aTaken.has(name)) return name;
  for (let attempt = 1; ; attempt++) {
    const next = `${name}_${attempt}`;
    if (!aTaken.has(next)) return next;
  }
}

/**
 * `ImportIndividualFile`'s search: the input's name with each extension in
 * turn (`INPUT` is the input's own), the first that exists. Case-insensitive
 * on the extension, as the files Windows tools write mix `PcbDoc`/`PCBDOC`.
 */
export function siblingFile(
  aExts: readonly string[],
  aInput: PickedImportFile,
  aPicked: readonly PickedImportFile[],
): PickedImportFile | null {
  const stem = stemOf(aInput.name);
  for (let ext of aExts) {
    if (ext === 'INPUT') ext = extOf(aInput.name);
    const hit = aPicked.find(
      (f) => stemOf(f.name) === stem && extOf(f.name).toLowerCase() === ext.toLowerCase(),
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * `AltiumProjectHandler`'s pass over the `.PrjPcb`: every `[DocumentN]`
 * group's `DocumentPath`, a Windows path relative to the project file. The
 * first board-like one (PcbDoc, CSPcbDoc, CMPcbDoc, SWPcbDoc) is the board;
 * every SchDoc is a sheet.
 */
export function altiumProjectDocuments(aPrjPcb: string): { pcb: string | null; sch: string[] } {
  let pcb: string | null = null;
  const sch = new Set<string>();
  let inDocument = false;
  for (const raw of aPrjPcb.split(/\r?\n/)) {
    const line = raw.trim();
    const group = /^\[(.*)\]$/.exec(line);
    if (group) {
      const name = group[1]!;
      inDocument = name.startsWith('Document') && /^\d+$/.test(name.slice(8));
      continue;
    }
    if (!inDocument) continue;
    const eq = line.indexOf('=');
    if (eq < 0 || line.slice(0, eq) !== 'DocumentPath') continue;
    const path = line.slice(eq + 1).replace(/\\/g, '/');
    if (!path) continue;
    const ext = extOf(path).toLowerCase();
    if (pcb === null && ['pcbdoc', 'cspcbdoc', 'cmpcbdoc', 'swpcbdoc'].includes(ext)) pcb = path;
    if (ext === 'schdoc') sch.add(path);
  }
  return { pcb, sch: [...sch] };
}

/** What an import of these files will bring in. */
export interface ImportPlan {
  input: PickedImportFile;
  projectName: string;
  board: PickedImportFile | null;
  schematics: PickedImportFile[];
  /** Documents the project names that were not among the files chosen. */
  missing: string[];
}

/**
 * The whole decision: `ImportNonKiCadProject` + `IMPORT_PROJ_HELPER::ImportFiles`,
 * minus the doing. Null when nothing chosen is the format's input file.
 */
export function planImport(
  aFormat: ImportFormat,
  aPicked: readonly PickedImportFile[],
  aTaken: ReadonlySet<string>,
): ImportPlan | null {
  const input = inputFileOf(aFormat, aPicked);
  if (!input) return null;
  const desc = IMPORT_FORMATS[aFormat];
  const projectName = targetProjectName(input.name, aTaken);
  const byBase = (p: string): PickedImportFile | null =>
    aPicked.find((f) => baseOf(f.name).toLowerCase() === baseOf(p).toLowerCase()) ?? null;

  if (aFormat === 'altium' && extOf(input.name).toLowerCase() === 'prjpcb') {
    const docs = altiumProjectDocuments(new TextDecoder().decode(input.bytes));
    const board = docs.pcb ? byBase(docs.pcb) : null;
    const schematics = docs.sch.map(byBase).filter((f): f is PickedImportFile => f !== null);
    const missing = [
      ...(docs.pcb && !board ? [baseOf(docs.pcb)] : []),
      ...docs.sch.filter((p) => !byBase(p)).map(baseOf),
    ];
    return { input, projectName, board, schematics, missing };
  }

  // gEDA's `pcb` branch in ImportFiles (a .pcb input is a board on its own)
  // needs no case here: KiCad is handed ONE file and a .sch may sit beside the
  // .pcb on disk, but here a .pcb is the input only when no .prj or .sch was
  // chosen (the wildcard's order), so the sheet search below finds nothing.
  const sch = siblingFile(desc.schExts, input, aPicked);
  const board = siblingFile(desc.pcbExts, input, aPicked);
  return { input, projectName, board, schematics: sch ? [sch] : [], missing: [] };
}

/**
 * The new project an import starts from: `CreateNewProject( m_TargetProj,
 * false )` - the project file only, "Don't create stub files" - and, when
 * there is a board to bring in, the board file the editor imports into. KiCad's
 * pcbnew opens the foreign board under the project's own board name
 * (`OpenProjectFiles` keeps `previousBoardFileName`) and the save writes it
 * there; ours needs that name to exist for the editor to open on, so it starts
 * as the empty board `ImportNonKicadBoard` replaces.
 */
export function importProjectFiles(aPlan: ImportPlan): PickedHomeFile[] {
  const enc = new TextEncoder();
  const name = aPlan.projectName;
  const mk = (path: string, text: string): PickedHomeFile => ({
    name: path,
    text,
    bytes: enc.encode(text),
  });
  const out = [mk(`${name}/${name}.kicad_pro`, projectJson(name, null))];
  if (aPlan.board) out.push(mk(`${name}/${name}.kicad_pcb`, EMPTY_PCB));
  return out;
}

/** What the file chooser offers: the wildcard's extensions and every sibling's. */
export function acceptFor(aFormat: ImportFormat): string {
  const d = IMPORT_FORMATS[aFormat];
  const exts = new Set(
    [...d.wildcard().extensions, ...d.schExts, ...d.pcbExts]
      .filter((e) => e !== 'INPUT')
      .map((e) => `.${e}`),
  );
  return [...exts].join(',');
}
