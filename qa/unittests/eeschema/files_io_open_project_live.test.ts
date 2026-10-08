// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME::OpenProjectFiles on the live model (files-io.cpp:98-790). The oracle is
 * KiCad itself: kicad-cli loaded each `.pass1` and wrote `.pass2`, so a frame that opens
 * `.pass1` - hierarchy, page numbers, instance data, cleanup, connectivity, all of it - must
 * save `.pass2` byte for byte.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { KICTL_CREATE } from '@ziroeda/common/kiway_player.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../data');
const ORACLE = join(DATA, 'eeschema', 'sexpr_oracle');

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  saveProject: () => true,
  getNetlist: () => null,
};

function oracleFiles(aDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(aDir)) {
    const p = join(aDir, name);
    if (statSync(p).isDirectory()) out.push(...oracleFiles(p));
    else if (name.endsWith('.kicad_sch.pass1')) out.push(p.slice(0, -'.pass1'.length));
  }
  return out.sort();
}

/** Open \a aFile through the frame, its sheets read from the `.pass1` files. */
function openThroughFrame(aFile: string) {
  const dir = dirname(aFile);
  const pro = join(dir, `${basename(aFile, '.kicad_sch')}.kicad_pro`);
  Pgm()
    .GetSettingsManager()
    .LoadProject(pro, existsSync(pro) ? JSON.parse(readFileSync(pro, 'utf8')) : null);
  const readFile = (p: string): string | null => {
    const oracle = `${join(ORACLE, relative(DATA, p))}.pass1`;
    return existsSync(oracle) ? readFileSync(oracle, 'utf8') : null;
  };
  const frame = new SCH_EDIT_FRAME(hooks);
  const ok = frame.OpenProjectFiles([aFile], 0, readFile);
  return { frame, ok };
}

const files = existsSync(ORACLE) ? oracleFiles(ORACLE) : [];

/**
 * `.pass2` is kicad-cli's JobUpgrade: no project, and it saves a SECOND load of the file
 * (eeschema_jobs_handler.cpp:1417). The editor opens it under its project through
 * OpenProjectFiles. Exactly three things differ for that reason, each set aside here:
 *
 * - `(embedded_fonts ...)`: written only for the schematic's first top-level sheet
 *   (sch_io_kicad_sexpr.cpp:535), which the editor saves and the CLI's second load is not;
 * - the current project's instance name: `Project().GetProjectName()` (:937), the CLI's "";
 * - `(sheet_instances ...)`: written when the saved sheet HasRootInstance (:523), which the
 *   editor's root has once OpenProjectFiles numbers the pages and the CLI's second load lacks;
 * - symbol instances CheckForMissingSymbolInstances adds (files-io.cpp:739) for the file's own
 *   root path: compared separately - every instance KiCad wrote must survive.
 */
function editorView(aText: string, aProject: string, _aPass1: string): string {
  return aText
    .replace(/^\t\(embedded_fonts (yes|no)\)\n/m, '')
    .replaceAll(`(project "${aProject}"`, '(project ""')
    .replace(/^\t\(sheet_instances\n(?:\t\t.*\n)*\t\)\n/m, '')
    .replace(/^\t\t\(instances\n(?:\t\t\t.*\n)*\t\t\)\n/gm, '');
}

/**
 * Instances the editor's PruneOrphanedSymbolInstances removes on open (sch_screen.cpp), each
 * read off the file: a current-project instance whose path leads to another sheet's screen.
 */
const PRUNED: Record<string, string[]> = {
  // A symbol on the ROOT screen carrying an instance for the path to sub3 (701adb8c), whose
  // screen is sub3's: `pathFound.value().LastScreen() != this`, pruned.
  'eeschema/netlist_oracle/test_hier_no_connect/test_hier_no_connect.kicad_sch': [
    '|/a68fb8f1-2acf-4e52-8498-fd8a9cae28e4/701adb8c-f139-4a93-a927-02c9f06ca5b2|U4|1',
  ],
};

/** Each symbol instance a file carries: `project|path|reference|unit`, project-name neutral. */
function instancesOf(aText: string, aProject: string): Set<string> {
  const out = new Set<string>();
  for (const block of aText
    .replaceAll(`(project "${aProject}"`, '(project ""')
    .matchAll(/^\t\t\(instances\n((?:\t\t\t.*\n)*)\t\t\)$/gm)) {
    let project = '';
    let path = '';
    let reference = '';
    for (const line of (block[1] ?? '').split('\n')) {
      const m = /\((project|path|reference|unit) "?([^")]*)"?/.exec(line);
      if (!m) continue;
      if (m[1] === 'project') project = m[2]!;
      else if (m[1] === 'path') path = m[2]!;
      else if (m[1] === 'reference') reference = m[2]!;
      else out.add(`${project}|${path}|${reference}|${m[2]}`);
    }
  }
  return out;
}

// The application installs its program object; each test gets a fresh settings manager.
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

describe('SCH_EDIT_FRAME::OpenProjectFiles', () => {
  it('has the oracle fixtures', () => {
    expect(files.length).toBe(36);
  });

  for (const oracleFile of files) {
    const rel = relative(ORACLE, oracleFile);
    it(`${rel}: opened through the frame, saves exactly what KiCad saved`, () => {
      const { frame, ok } = openThroughFrame(join(DATA, rel));
      expect(ok).toBe(true);
      const schematic = frame.Schematic();
      const root = schematic.GetTopLevelSheet()!;
      const out = new SCH_IO_KICAD_SEXPR('eeschema').SaveSchematicFile(root, schematic);
      const pass1 = readFileSync(`${oracleFile}.pass1`, 'utf8');
      const pass2 = readFileSync(`${oracleFile}.pass2`, 'utf8');
      const project = basename(join(DATA, rel), '.kicad_sch');
      expect(editorView(out, project, pass1)).toBe(editorView(pass2, project, pass1));
      // Symbol instances: the editor adds (CheckForMissingSymbolInstances) and prunes
      // (PruneOrphanedSymbolInstances); the CLI does neither. Nothing else may be lost.
      const ours = instancesOf(out, project);
      expect([...instancesOf(pass2, project)].filter((i) => !ours.has(i))).toEqual(
        PRUNED[rel] ?? [],
      );
      // ...and the editor's save does write the fonts line, on the root file.
      expect(out).toMatch(/^\t\(embedded_fonts (yes|no)\)$/m);
    });
  }

  it('starts with an empty undo list and the current sheet on screen', () => {
    const { frame } = openThroughFrame(join(DATA, relative(ORACLE, files[0]!)));
    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(frame.GetScreen()).toBe(frame.GetCurrentSheet().LastScreen());
  });

  it('refuses a missing file unless asked to create it, then makes a modified empty sheet', () => {
    const frame = new SCH_EDIT_FRAME(hooks);
    Pgm().GetSettingsManager().LoadProject('/tmp/none/new.kicad_pro', null);
    expect(frame.OpenProjectFiles(['/tmp/none/new.kicad_sch'], 0, () => null)).toBe(false);
    expect(frame.OpenProjectFiles(['/tmp/none/new.kicad_sch'], KICTL_CREATE, () => null)).toBe(
      true,
    );
    expect(frame.GetScreen()!.IsContentModified()).toBe(true);
    expect(frame.GetScreen()!.GetFileName()).toBe('/tmp/none/new.kicad_sch');
  });

  it('numbers the pages of a schematic that had none (SetInitialPageNumbers)', () => {
    const { frame } = openThroughFrame(join(DATA, 'eeschema/sexpr_1006/sub.kicad_sch'));
    expect(frame.GetCurrentSheet().GetPageNumber()).toBe('1');
  });

  it('links every symbol to its library symbol (UpdateLocalLibSymbolLinks)', () => {
    const { frame } = openThroughFrame(join(DATA, 'nfc-antenna.kicad_sch'));
    const symbols = frame
      .GetScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SYMBOL_T) as unknown as SCH_SYMBOL[];
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.filter((sym) => !sym.GetLibSymbolRef())).toEqual([]);
  });

  it('builds the connectivity (RecalculateConnections, GLOBAL_CLEANUP)', () => {
    const { frame } = openThroughFrame(join(DATA, 'nfc-antenna.kicad_sch'));
    expect(frame.Schematic().ConnectionGraph().GetNetMap().size).toBeGreaterThan(0);
  });

  it('names a single root "Root"', () => {
    const { frame } = openThroughFrame(join(DATA, 'nfc-antenna.kicad_sch'));
    expect(frame.Schematic().GetTopLevelSheet()!.GetName()).toBe('Root');
  });

  it("loads the project file's top-level sheets with their uuid and name", () => {
    const file = join(DATA, 'nfc-antenna.kicad_sch');
    Pgm()
      .GetSettingsManager()
      .LoadProject(join(DATA, 'nfc-antenna.kicad_pro'), {
        schematic: {
          top_level_sheets: [
            {
              uuid: '11111111-2222-4333-8444-555555555555',
              name: 'Main',
              filename: 'nfc-antenna.kicad_sch',
            },
          ],
        },
      });
    const readFile = (p: string): string | null => {
      const oracle = `${join(ORACLE, relative(DATA, p))}.pass1`;
      return existsSync(oracle) ? readFileSync(oracle, 'utf8') : null;
    };
    const frame = new SCH_EDIT_FRAME(hooks);
    expect(frame.OpenProjectFiles([file], 0, readFile)).toBe(true);
    const top = frame.Schematic().GetTopLevelSheet()!;
    expect(top.m_Uuid).toBe('11111111-2222-4333-8444-555555555555');
    expect(top.GetName()).toBe('Main');
  });

  it("switches to the schematic's own project, read from beside it", () => {
    const file = join(DATA, 'eeschema/netlist_oracle/issue24330/issue24330.kicad_sch');
    const pro = file.replace(/\.kicad_sch$/, '.kicad_pro');
    const readFile = (p: string): string | null => {
      if (p === pro) return readFileSync(pro, 'utf8');
      const oracle = `${join(ORACLE, relative(DATA, p))}.pass1`;
      return existsSync(oracle) ? readFileSync(oracle, 'utf8') : null;
    };
    const frame = new SCH_EDIT_FRAME(hooks);
    expect(frame.OpenProjectFiles([file], 0, readFile)).toBe(true);
    expect(frame.Prj().GetProjectFullName()).toBe(pro);
    expect(frame.Prj().GetProjectName()).toBe('issue24330');
    expect(frame.Prj().IsReadOnly()).toBe(false);
  });

  it('opens a schematic with no project file read-only, unless creating', () => {
    const readFile = (p: string): string | null =>
      p === '/x/lonely.kicad_sch' ? readFileSync(`${files[0]}.pass1`, 'utf8') : null;
    const frame = new SCH_EDIT_FRAME(hooks);
    expect(frame.OpenProjectFiles(['/x/lonely.kicad_sch'], 0, readFile)).toBe(true);
    expect(frame.Prj().GetProjectFullName()).toBe('/x/lonely.kicad_pro');
    expect(frame.Prj().IsReadOnly()).toBe(true);
  });
});
