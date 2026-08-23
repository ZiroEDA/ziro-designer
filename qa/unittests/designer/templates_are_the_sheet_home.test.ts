// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A drawing sheet lives outside any project, as it does in KiCad.
 *
 * `PL_EDITOR_FRAME::Files_io` saves one into `PATHS::GetUserTemplatesPath()`
 * (pagelayout_editor/files.cpp:199-202), and `DIALOG_PAGES_SETTINGS` names one
 * by PATH — a wxTextCtrl and a browse button whose own default is that same
 * directory (dialog_page_settings.cpp:686-716). Those two facts are one design:
 * a sheet in a shared folder is reusable by every project, and a sheet inside a
 * project is reachable from that project alone.
 *
 * That directory is not a guess. `qa/probes/savedlg_probe.cpp` builds the very
 * wxFileDialog `Files_io` builds and asks it:
 *
 *     PATHS::GetUserTemplatesPath() = /home/akshay/.local/share/kicad/10.0/template/
 *       exists on this machine: yes
 *     wx:  GetDirectory() = '/home/akshay/.local/share/kicad/10.0/template/'
 *          GetFilename()  = ''
 *     GTK: current folder = '/home/akshay/.local/share/kicad/10.0/template'
 *          current name   = ''
 *
 * The first version of that probe transcribed `getUserDocumentPath` with
 * wxWidgets' documents dir and reported `~/Documents/kicad/...`, a folder that
 * does not exist here. `KIPLATFORM::ENV::GetDocumentsPath()` on Linux is
 * `g_get_user_data_dir()` (libs/kiplatform/os/unix/environment.cpp:93-105).
 * Transcribing a call is not running it.
 *
 * Ours saved into the open project and opened the chooser on Recent — a row
 * nothing can be saved into at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standardChooserPlaces } from '@ziroeda/designer/src/fs/chooser_places.js';
import { listFileSystem } from '@ziroeda/designer/src/fs/list_fs.js';
import { FsErrorCode } from '@ziroeda/designer/src/fs/filesystem.js';
import type { Entry, FileSystem } from '@ziroeda/designer/src/fs/filesystem.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PL = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');
const SAVEAS = read('../../../designer/src/fs/SaveAsDialog.tsx');
const SCH = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');

const accountFs: FileSystem = {
  list: async (): Promise<Entry[]> => [],
  stat: async (): Promise<Entry | null> => null,
  read: async (): Promise<Uint8Array> => new Uint8Array(),
  write: async (): Promise<void> => {},
  mkdir: async (): Promise<void> => {},
  mkproject: async (): Promise<void> => {},
  rename: async (): Promise<void> => {},
  remove: async (): Promise<void> => {},
};

describe('Save As opens where pl_editor opens', () => {
  it('starts on Templates, not on Recent', () => {
    // `wxString dir = PATHS::GetUserTemplatesPath();` is the defaultDir. Recent
    // is not merely the wrong folder - it is not a save target at all, so the
    // Save button opened insensitive.
    expect(PL).toContain('initialPlace="templates"');
  });

  it('gives the chooser a way to say which place a path came from', () => {
    // A path in Templates means nothing to the account's tree, so the accept
    // has to carry its origin - `ChooserPlace.onAccept`, which exists for
    // exactly this.
    expect(SAVEAS).toContain('onAccept: (path: string) => onDone(path, p.id)');
    expect(SAVEAS).toContain('onDone: (path: string | null, placeId?: string) => void;');
  });

  it('writes a sheet accepted in Templates to the templates root', () => {
    expect(PL).toContain("if (placeId === 'templates') writeSheetToTemplates(finalName);");
    expect(PL).toContain('else writeSheet(finalName);');
    expect(PL).toContain('void writeUserTemplateFile(name, text);');
  });
});

describe('the Templates place is a DIRECTORY, not a catalogue', () => {
  const places = standardChooserPlaces(accountFs);
  const templates = places.find((p) => p.id === 'templates');

  it('takes a write, where Demos and Recent still refuse one', () => {
    // The default rule is "only the row with no filesystem of its own", which
    // read Templates as read-only until it grew loose files. Recent and Demos
    // are genuinely queries and must stay refused - a test that only proved
    // Templates writable would pass with every row writable.
    expect(templates?.writable).toBe(true);
    expect(places.find((p) => p.id === 'recent')?.writable).toBeFalsy();
    expect(places.find((p) => p.id === 'demos')?.writable).toBeFalsy();
    expect(places.find((p) => p.id === 'templates')?.fs).toBeDefined();
  });
});

describe('listFileSystem grew loose files, and only where asked', () => {
  const listing = {
    files: [
      { name: 'a_template', size: null, modified: null },
      { name: 'sheet.kicad_wks', size: 12, modified: 5 },
    ],
    fileLeaves: new Set(['/sheet.kicad_wks']),
  };

  it('still refuses every write when no loose-file store is given', async () => {
    const fs = listFileSystem(async () => ({ files: listing.files }));
    for (const call of [
      fs.write('/x', new Uint8Array()),
      fs.rename('/x', 'y'),
      fs.remove('/x'),
      fs.mkdir('/x'),
    ]) {
      await expect(call).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
    }
  });

  it('routes read, write, rename and remove to the store when one is given', async () => {
    const seen: string[] = [];
    const fs = listFileSystem(async () => listing, {
      files: {
        read: async (p) => (p === '/sheet.kicad_wks' ? 'hello' : null),
        write: async (p) => {
          seen.push(`write ${p}`);
        },
        rename: async (p, to) => {
          seen.push(`rename ${p} ${to}`);
        },
        remove: async (p) => {
          seen.push(`remove ${p}`);
        },
      },
    });
    expect(new TextDecoder().decode(await fs.read('/sheet.kicad_wks'))).toBe('hello');
    await fs.write('/new.kicad_wks', new TextEncoder().encode('x'));
    await fs.rename('/a', 'b');
    await fs.remove('/a');
    expect(seen).toEqual(['write /new.kicad_wks', 'rename /a b', 'remove /a']);
    // A flat store has no subdirectory, so New Folder is still refused.
    await expect(fs.mkdir('/x')).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
  });

  it('marks a loose file a FILE and a template a leaf, in one listing', async () => {
    // `leafKind` is one answer for the whole place, and this place needs two.
    const fs = listFileSystem(async () => listing);
    const kinds = Object.fromEntries((await fs.list('/')).map((e) => [e.name, e.kind]));
    expect(kinds['sheet.kicad_wks']).toBe('file');
    expect(kinds.a_template).toBe('project');
  });
});

describe('Page Settings can read back what was saved there', () => {
  it('offers the templates root’s sheets beside the project’s', () => {
    // Saving into a folder Page Settings cannot see would be worse than the
    // divergence it fixes.
    expect(SCH).toContain('listUserTemplateFiles()');
    expect(SCH).toContain('...templateSheets.filter((c) => !taken.has(c.name))');
  });

  it('lets a project’s own sheet win a name clash', () => {
    // A sheet beside the schematic is the more specific of the two, as a file
    // in the project directory is upstream.
    expect(SCH).toContain('const taken = new Set(project.map((c) => c.name));');
  });

  it('lists a sheet that will not parse rather than dropping it', () => {
    // It is still a file in that folder. Dropping it would make a corrupt sheet
    // look like one that was never saved.
    expect(SCH).toContain('return { name: f.path, sheet: null };');
  });
});

describe('the two halves of the templates folder share one database', () => {
  /**
   * `user_templates.ts` (the template folders) and `user_template_files.ts`
   * (the loose files beside them) open the SAME IndexedDB database. That makes
   * three things load-bearing, and a mutation sweep found none of them pinned:
   * dropping `user_templates.ts` back to version 1 broke nothing here while
   * breaking the templates list for anyone who had saved a sheet.
   *
   * IndexedDB refuses an open at a LOWER version than the one on disk with a
   * VersionError. So whichever module opens first decides, and if they disagree
   * the loser throws — at runtime, in the browser, where no test looks.
   */
  const FOLDERS = read('../../../designer/src/home/user_templates.ts');
  const FILES = read('../../../designer/src/home/user_template_files.ts');

  const versionOf = (src: string): string => {
    const m = src.match(/const VERSION = (\d+);/);
    expect(m, 'no VERSION in this module').not.toBeNull();
    return (m as RegExpMatchArray)[1] as string;
  };
  const dbNameOf = (src: string): string => {
    const m = src.match(/const DB_NAME = '([^']+)';/);
    expect(m, 'no DB_NAME in this module').not.toBeNull();
    return (m as RegExpMatchArray)[1] as string;
  };

  it('names the same database', () => {
    expect(dbNameOf(FOLDERS)).toBe(dbNameOf(FILES));
  });

  it('names the same version', () => {
    // The whole point. They differed by one and nothing noticed.
    expect(versionOf(FOLDERS)).toBe(versionOf(FILES));
  });

  it('creates BOTH stores from either upgrade path', () => {
    // Whichever module opens first runs `onupgradeneeded`, so an upgrade that
    // creates only its own store leaves the other module opening a database at
    // the right version with no store to read.
    //
    // Both modules name their stores through constants, so the constants are
    // resolved before looking - grepping the block for the literals reported a
    // failure that was only this test reading the wrong thing.
    const storesCreated = (src: string): string[] => {
      const consts = Object.fromEntries(
        [...src.matchAll(/const (\w+) = '([^']+)';/g)].map((m) => [m[1] as string, m[2] as string]),
      );
      const upgrade = src.slice(src.indexOf('onupgradeneeded'), src.indexOf('req.onsuccess'));
      return [...upgrade.matchAll(/createObjectStore\(\s*([^,]+),/g)]
        .map((m) => (m[1] as string).trim())
        .map((arg) => consts[arg] ?? arg.replace(/^'|'$/g, ''))
        .sort();
    };
    for (const [name, src] of [
      ['user_templates.ts', FOLDERS],
      ['user_template_files.ts', FILES],
    ] as const) {
      expect(storesCreated(src), `${name} does not create both stores`).toEqual([
        'template-files',
        'templates',
      ]);
    }
  });
});

describe('a loose file in Templates opens, rather than doing nothing', () => {
  /**
   * The other end of the same folder. Saving a drawing sheet into Templates put
   * it in the list, and clicking it in Open Existing Project did NOTHING AT
   * ALL — no editor, no message.
   *
   * The chooser's own accept looks a path up with `projectAt`, and a path in
   * this place belongs to no project, so it returned null and the handler
   * returned. The Templates place had an `onAccept` of its own already, but it
   * only matched template FOLDERS (`path === '/' + t.id`); a loose file fell
   * past it into the same silent return.
   *
   * Upstream a file is opened by its EXTENSION: `PROJECT_TREE_ITEM::Activate`
   * dispatches on the type and hands a `.kicad_wks` to `editDrawingSheet`
   * (kicad/project_tree_item.cpp:342-344). That table is already ported and
   * already runs for the project tree, so the fix reuses it rather than growing
   * a second answer for one extension.
   */
  const HOME = read('../../../designer/src/home/HomePage.tsx');

  it('still takes a template folder as a copy, which came first', () => {
    // The half that already worked, kept: a template is not a file to open.
    expect(HOME).toContain('const t = templatesRef.current.find((x) => path === `/${x.id}`);');
    expect(HOME).toContain('openTemplateRef.current(t);');
  });

  it('takes anything else in that root as a FILE', () => {
    expect(HOME).toContain('void openLooseTemplateFileRef.current(path);');
    expect(HOME).toContain('const text = await readUserTemplateFile(name);');
  });

  it('runs the SAME activation the project tree runs', () => {
    // Not a `.kicad_wks` special case: whatever `activationForFile` says, which
    // is `GetFileExt`'s table. A `.kicad_sym` dropped in that folder lands in
    // the symbol editor for free.
    expect(HOME).toContain('activateFile(file, [file], name);');
  });

  it('says so when the file cannot be read, instead of returning silently', () => {
    // Silence is what this whole test exists about.
    expect(HOME).toContain('setInfoMessage(`Could not read ${name}.`);');
  });

  it('closes the dialog first, as the other two places do', () => {
    const at = HOME.indexOf('openLooseTemplateFileRef.current = async (path)');
    expect(at, 'the ref is never assigned').toBeGreaterThan(0);
    expect(HOME.slice(at, at + 200)).toContain('setOpenPrjOpen(false);');
  });
});
