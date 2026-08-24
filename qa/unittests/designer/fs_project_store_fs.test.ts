// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The account's tree, run against a real IndexedDB.
 *
 * The file chooser is written against `FileSystem`, so everything it can do to
 * a project happens through this adapter. What is worth executing here is the
 * part that is not a pass-through: a project appearing as a folder, the
 * folders inside one being re-derived from flat paths, an empty folder
 * surviving a reload despite the store having no way to express one, and the
 * two refusals — a loose file at the root, and a second project taking a name.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsErrorCode } from '@ziroeda/designer/src/fs/filesystem.js';
import { projectAt, projectStoreFileSystem } from '@ziroeda/designer/src/fs/project_store_fs.js';
import { USER_DIRS } from '@ziroeda/designer/src/fs/chooser_places.js';
import {
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  saveProject,
  USER_DIR_IDS,
} from '@ziroeda/designer/src/home/projectStore.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const file = (name: string, text: string): { name: string; bytes: Uint8Array } => ({
  name,
  bytes: enc.encode(text),
});

const fs = projectStoreFileSystem();

/** The code of a refusal, or the string 'resolved' when there wasn't one. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

const names = async (dir: string): Promise<string[]> =>
  (await fs.list(dir)).map((e) => e.name).sort();

/**
 * The four user-data folders, from the table the sidebar itself reads.
 *
 * Taken from `USER_DIRS` rather than written out, so renaming one moves this
 * with it instead of leaving a test that quietly stops filtering anything.
 */
const USER_DIR_NAMES = Object.values(USER_DIRS).map((p) => p.replace(/^\/+/, ''));

/** The root's projects — everything that is not one of those four folders. */
const projectNames = async (dir: string): Promise<string[]> =>
  (await names(dir)).filter((n) => !USER_DIR_NAMES.includes(n));

async function wipe(): Promise<void> {
  for (const p of await listProjects()) await deleteProject(p.id);
  // The user-data folders are not in that list — that is the point of them —
  // so they outlive it, and a folder left standing between tests would carry
  // one test's files into the next and stop the migration below from ever
  // being the first thing to create Templates.
  for (const id of Object.values(USER_DIR_IDS)) await deleteProject(id);
  // And the OLD database the Templates folder seeds itself from. It is not the
  // projects store, so nothing above touches it, and a row left there is
  // carried into the next test's Templates the moment it is created.
  await new Promise<void>((resolve) => {
    const req = indexedDB.open('ziroeda-templates', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('templates'))
        d.createObjectStore('templates', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('template-files'))
        d.createObjectStore('template-files', { keyPath: 'path' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction('template-files', 'readwrite');
      t.objectStore('template-files').clear();
      t.oncomplete = () => {
        db.close();
        resolve();
      };
      t.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

beforeEach(wipe);
afterEach(wipe);

describe('the root holds projects', () => {
  it('shows one folder per project, and calls it a project', async () => {
    await saveProject('Blinky', [file('blinky.kicad_pro', '{}')]);
    const entry = (await fs.list('/')).find((e) => e.name === 'Blinky');
    expect(entry).toMatchObject({ name: 'Blinky', path: '/Blinky', kind: 'project' });
  });

  it('gives a project no size, because a folder shows none', async () => {
    await saveProject('Blinky', [file('a.txt', 'x')]);
    expect((await fs.list('/'))[0]?.size).toBeNull();
  });

  it('is empty when there are no projects', async () => {
    expect(await projectNames('/')).toEqual([]);
  });
});

describe('a project holds files, and the folders between them', () => {
  beforeEach(async () => {
    await saveProject('Board', [
      file('board.kicad_pcb', '(kicad_pcb)'),
      file('3d/case.step', 'ISO-10303-21;'),
      file('3d/parts/screw.step', 'ISO-10303-21;'),
    ]);
  });

  it('lists the project folder one level deep', async () => {
    expect(await names('/Board')).toEqual(['3d', 'board.kicad_pcb']);
  });

  it('descends', async () => {
    expect(await names('/Board/3d')).toEqual(['case.step', 'parts']);
    expect(await names('/Board/3d/parts')).toEqual(['screw.step']);
  });

  it('gives a file its uncompressed size, not what it compressed to', async () => {
    // The store gzips, and the Size column is the user's answer to "how big is
    // my board". A 11-byte file that gzips to 31 bytes must read 11.
    const [entry] = (await fs.list('/Board')).filter((e) => e.kind === 'file');
    expect(entry?.size).toBe('(kicad_pcb)'.length);
  });

  it('reads a file back byte for byte', async () => {
    expect(dec.decode(await fs.read('/Board/3d/case.step'))).toBe('ISO-10303-21;');
  });
});

describe('what may be written where', () => {
  beforeEach(async () => {
    await saveProject('Board', [file('board.kicad_pcb', '(kicad_pcb)')]);
  });

  it('writes a file into a project', async () => {
    await fs.write('/Board/notes.md', enc.encode('# hi'));
    expect(await names('/Board')).toContain('notes.md');
    expect(dec.decode(await fs.read('/Board/notes.md'))).toBe('# hi');
  });

  it('writes an arbitrary type, as a KiCad project folder holds', async () => {
    // Upstream a project directory carries .md, .pdf, .csv beside the board.
    // Nothing here filters on extension.
    await fs.write('/Board/datasheet.pdf', enc.encode('%PDF-1.4'));
    expect(await names('/Board')).toContain('datasheet.pdf');
  });

  it('refuses a loose file at the root', async () => {
    // The one structural rule: the root holds projects, because upstream has
    // no place for a file that belongs to no project either.
    // NOT_IN_PROJECT, not NOT_FOUND: `/loose.txt` is indeed not an existing
    // project, and that is not the reason it was refused. The first version of
    // this adapter answered NOT_FOUND here and this test is what found it.
    expect(await codeOf(fs.write('/loose.txt', enc.encode('x')))).toBe(FsErrorCode.NOT_IN_PROJECT);
  });

  it('refuses writing to a project folder as though it were a file', async () => {
    expect(await codeOf(fs.write('/Board', enc.encode('x')))).toBe(FsErrorCode.NOT_A_DIRECTORY);
  });

  it('refuses a folder at the root', async () => {
    expect(await codeOf(fs.mkdir('/somewhere'))).toBe(FsErrorCode.NOT_IN_PROJECT);
  });
});

describe('an empty folder, which the store cannot express', () => {
  beforeEach(async () => {
    await saveProject('Board', [file('board.kicad_pcb', '(kicad_pcb)')]);
  });

  it('survives, though no file implies it', async () => {
    // A project is a flat list of paths, so a folder with nothing in it has
    // nothing to be derived from. This is the case New Folder creates, and it
    // has to still be there after a reload.
    await fs.mkdir('/Board/gerbers');
    expect(await names('/Board')).toEqual(['board.kicad_pcb', 'gerbers']);
    expect(await names('/Board/gerbers')).toEqual([]);
  });

  it('stops being remembered separately once a file lands in it', async () => {
    // From then on the file implies it, and remembering it twice would show
    // the folder twice or keep it alive after the file was deleted.
    await fs.mkdir('/Board/gerbers');
    await fs.write('/Board/gerbers/top.gbr', enc.encode('%FSLAX46Y46*%'));
    expect(await names('/Board')).toEqual(['board.kicad_pcb', 'gerbers']);
    await fs.remove('/Board/gerbers/top.gbr');
    expect(await names('/Board')).toEqual(['board.kicad_pcb']);
  });

  it('appears only in the folder it is in', async () => {
    // An empty folder is recorded by its project-relative path, so listing a
    // sibling has to filter on that path and not just take the whole list. A
    // mutation that dropped the filter showed `gerbers` inside `3d`, and every
    // other test still passed.
    await fs.write('/Board/3d/case.step', enc.encode('ISO'));
    await fs.mkdir('/Board/gerbers');
    expect(await names('/Board')).toEqual(['3d', 'board.kicad_pcb', 'gerbers']);
    expect(await names('/Board/3d')).toEqual(['case.step']);
  });

  it('shows a nested one at the right level, and only there', async () => {
    await fs.write('/Board/3d/case.step', enc.encode('ISO'));
    await fs.mkdir('/Board/gerbers/out');
    expect(await names('/Board')).toEqual(['3d', 'board.kicad_pcb', 'gerbers']);
    expect(await names('/Board/gerbers')).toEqual(['out']);
    expect(await names('/Board/3d')).toEqual(['case.step']);
  });

  it('survives an ordinary save of the project', async () => {
    // saveProject rebuilds the record from scratch, so anything it does not
    // carry across is dropped on the next save. An empty folder is not
    // derivable from the files, which makes it exactly the kind of field that
    // disappears silently — the folder would vanish the next time anything in
    // the project was written.
    const id = (await listProjects())[0]!.id;
    await fs.mkdir('/Board/gerbers');
    await saveProject('Board', [file('board.kicad_pcb', '(kicad_pcb) edited')], id);
    expect(await names('/Board')).toEqual(['board.kicad_pcb', 'gerbers']);
  });

  it('survives a pull from the cloud, which carries no folders', async () => {
    // `SyncableProject` has no field for an empty folder, so importProject
    // rebuilding the record without consulting the local one would delete it
    // on every sync.
    const id = (await listProjects())[0]!.id;
    await fs.mkdir('/Board/gerbers');
    const exported = await exportProject(id);
    await importProject(exported!);
    expect(await names('/Board')).toEqual(['board.kicad_pcb', 'gerbers']);
  });

  it('refuses to make one that already exists', async () => {
    await fs.mkdir('/Board/gerbers');
    expect(await codeOf(fs.mkdir('/Board/gerbers'))).toBe(FsErrorCode.EXISTS);
  });
});

describe('renaming', () => {
  beforeEach(async () => {
    await saveProject('Board', [
      file('board.kicad_pcb', '(kicad_pcb)'),
      file('3d/case.step', 'ISO'),
      file('3d/parts/screw.step', 'ISO'),
    ]);
  });

  it('renames a file without touching its bytes', async () => {
    await fs.rename('/Board/board.kicad_pcb', 'renamed.kicad_pcb');
    expect(await names('/Board')).toEqual(['3d', 'renamed.kicad_pcb']);
    expect(dec.decode(await fs.read('/Board/renamed.kicad_pcb'))).toBe('(kicad_pcb)');
  });

  it('renames a folder, taking everything beneath it', async () => {
    await fs.rename('/Board/3d', 'models');
    expect(await names('/Board')).toEqual(['board.kicad_pcb', 'models']);
    expect(await names('/Board/models')).toEqual(['case.step', 'parts']);
    expect(dec.decode(await fs.read('/Board/models/parts/screw.step'))).toBe('ISO');
  });

  it('does not take a sibling whose name merely starts the same', async () => {
    // `3dnotes.txt` starts with `3d` as text and is not inside it. The store
    // matches on the path plus a separator for exactly this reason.
    await fs.write('/Board/3dnotes.txt', enc.encode('x'));
    await fs.rename('/Board/3d', 'models');
    expect(await names('/Board')).toEqual(['3dnotes.txt', 'board.kicad_pcb', 'models']);
  });

  it('renames a project', async () => {
    await fs.rename('/Board', 'Other');
    expect(await projectNames('/')).toEqual(['Other']);
    expect(await names('/Other')).toContain('board.kicad_pcb');
  });

  it('refuses a name already taken in the same folder', async () => {
    await fs.write('/Board/taken.txt', enc.encode('x'));
    expect(await codeOf(fs.rename('/Board/board.kicad_pcb', 'taken.txt'))).toBe(FsErrorCode.EXISTS);
  });

  it('refuses a name that is not one', async () => {
    // A separator in a name would move the file rather than rename it.
    expect(await codeOf(fs.rename('/Board/board.kicad_pcb', 'a/b'))).toBe(FsErrorCode.INVALID);
  });
});

describe('deleting', () => {
  beforeEach(async () => {
    await saveProject('Board', [
      file('board.kicad_pcb', '(kicad_pcb)'),
      file('3d/case.step', 'ISO'),
      file('3d/parts/screw.step', 'ISO'),
    ]);
  });

  it('deletes a file', async () => {
    await fs.remove('/Board/board.kicad_pcb');
    expect(await names('/Board')).toEqual(['3d']);
  });

  it('deletes a folder and everything under it', async () => {
    await fs.remove('/Board/3d');
    expect(await names('/Board')).toEqual(['board.kicad_pcb']);
  });

  it('does not delete a sibling whose name merely starts the same', async () => {
    await fs.write('/Board/3dnotes.txt', enc.encode('x'));
    await fs.remove('/Board/3d');
    expect(await names('/Board')).toEqual(['3dnotes.txt', 'board.kicad_pcb']);
  });

  it('deletes a project', async () => {
    await fs.remove('/Board');
    expect(await projectNames('/')).toEqual([]);
  });
});

describe('two projects with the same name', () => {
  it('shows the later one suffixed, oldest keeping the bare name', async () => {
    // The store never required unique names and a directory does. The one
    // saved first keeps `Blinky`, so an existing project's path does not move
    // when a namesake is saved.
    const first = await saveProject('Blinky', [file('a.txt', 'first')]);
    // Let the clock tick. `createdAt` is `Date.now()`, so two saves inside one
    // millisecond record the SAME creation time and nothing in the store says
    // which came first — the order is then whatever `listProjects` happened to
    // return. This test passed on luck until an unrelated test was added ahead
    // of it and the two saves stopped straddling a millisecond.
    for (const t = Date.now(); Date.now() === t; );
    const second = await saveProject('Blinky', [file('b.txt', 'second')]);
    expect(await projectNames('/')).toEqual(['Blinky', 'Blinky (2)']);
    expect(await names('/Blinky')).toEqual(['a.txt']);
    expect(await names('/Blinky (2)')).toEqual(['b.txt']);
    expect((await projectAt('/Blinky'))?.id).toBe(first);
    expect((await projectAt('/Blinky (2)'))?.id).toBe(second);
  });

  it('cannot be created through the tree', async () => {
    await saveProject('Blinky', [file('a.txt', 'x')]);
    expect(await codeOf(fs.mkproject('/Blinky'))).toBe(FsErrorCode.EXISTS);
  });
});

describe('making a project', () => {
  it('creates an empty one at the root', async () => {
    await fs.mkproject('/Fresh');
    expect(await projectNames('/')).toEqual(['Fresh']);
    expect(await names('/Fresh')).toEqual([]);
  });

  it('refuses one anywhere else', async () => {
    await saveProject('Board', [file('a.txt', 'x')]);
    expect(await codeOf(fs.mkproject('/Board/inner'))).toBe(FsErrorCode.INVALID);
  });
});

describe('a project that arrived from the cloud', () => {
  it('still reports uncompressed sizes, measuring them once', async () => {
    // A record written before `size` existed, and any row an older client
    // pushed, carries compressed bytes and nothing else. The Size column must
    // not quietly become "how big is this gzipped" for those — 11 characters
    // gzip to more than 11 bytes, so a fallback to the blob length would be
    // both wrong and plausible-looking.
    const id = await saveProject('Board', [file('board.kicad_pcb', '(kicad_pcb)')]);
    const exported = await exportProject(id);
    expect(exported).not.toBeNull();
    await deleteProject(id);
    // Strip what the local store had computed, which is exactly the shape an
    // older cloud row has.
    await importProject({
      ...exported!,
      files: exported!.files.map(({ name, gzB64 }) => ({ name, gzB64 })),
    });

    const [entry] = (await fs.list('/Board')).filter((e) => e.kind === 'file');
    expect(entry?.size).toBe('(kicad_pcb)'.length);
  });

  it('carries the size across the round trip when it has one', async () => {
    // The cheaper half: a project exported from a store that knows its sizes
    // hands them over, so the other side never has to measure at all.
    const id = await saveProject('Board', [file('board.kicad_pcb', '(kicad_pcb)')]);
    const exported = await exportProject(id);
    expect(exported?.files[0]?.size).toBe('(kicad_pcb)'.length);
  });
});

describe('resolving a path back to a project', () => {
  it('answers for the project folder and for anything inside it', async () => {
    const id = await saveProject('Board', [file('3d/case.step', 'ISO')]);
    expect((await projectAt('/Board'))?.id).toBe(id);
    expect((await projectAt('/Board/3d/case.step'))?.id).toBe(id);
  });

  it('answers null for the root and for a project that is gone', async () => {
    expect(await projectAt('/')).toBeNull();
    expect(await projectAt('/Nothing')).toBeNull();
  });
});

/**
 * The account's user-data folders.
 *
 * Upstream they are real directories beside the project folders, one per KIND
 * of thing a user makes — `template/`, `symbols/`, `footprints/`, `3dmodels/` —
 * and pl_editor's Save As opens straight into `template/`
 * (pagelayout_editor/files.cpp:199-202). Here they are reserved records in the
 * projects store, which is why every operation below is the ordinary one: a
 * write, a mkdir, a rename. Nothing about them is special-cased in the chooser.
 *
 * They were a FAÇADE for a while — four sidebar rows whose paths resolved to
 * nothing, because the first path segment was looked up as a project name. A
 * drawing sheet saved into Templates went into the open project instead, or
 * downloaded when there was none.
 */
describe('the user-data folders', () => {
  it('shows all four at the root, as folders and not as projects', async () => {
    const root = await fs.list('/');
    for (const name of USER_DIR_NAMES) {
      // `project` would let Open Project accept `Templates` as a board, and
      // would make one click plus Open take it instead of walking into it.
      expect(root.find((e) => e.name === name)).toMatchObject({ kind: 'folder', size: null });
    }
  });

  it('takes a file, and hands the same bytes back', async () => {
    await fs.write('/Templates/frame.kicad_wks', enc.encode('(drawing_sheet)'));
    expect(await names('/Templates')).toEqual(['frame.kicad_wks']);
    expect(dec.decode(await fs.read('/Templates/frame.kicad_wks'))).toBe('(drawing_sheet)');
  });

  it('holds folders, and files inside them', async () => {
    await fs.mkdir('/Symbols/connectors');
    await fs.write('/Symbols/connectors/usb.kicad_sym', enc.encode('(kicad_symbol_lib)'));
    expect(await names('/Symbols')).toEqual(['connectors']);
    expect(await names('/Symbols/connectors')).toEqual(['usb.kicad_sym']);
  });

  it('is not offered as a project to open', async () => {
    // The home screen's list, its Recent row and Open Existing Project all read
    // `listProjects`. A folder in there would be a board you could try to open.
    await fs.write('/Templates/frame.kicad_wks', enc.encode('(drawing_sheet)'));
    expect((await listProjects()).map((p) => p.name)).toEqual([]);
    expect(await projectAt('/Templates')).toBeNull();
  });

  it('owns its name: a project called Templates is the one that gets suffixed', async () => {
    await saveProject('Templates', [file('t.kicad_pro', '{}')]);
    await fs.write('/Templates/frame.kicad_wks', enc.encode('(drawing_sheet)'));
    // The folder keeps `/Templates`, so the sidebar row still reaches it, and
    // the project is displayed through the machinery two same-named projects
    // already use. Both are reachable; neither shadows the other.
    expect(await names('/')).toContain('Templates (2)');
    expect(await names('/Templates')).toEqual(['frame.kicad_wks']);
    expect(await names('/Templates (2)')).toEqual(['t.kicad_pro']);
  });

  it('refuses to be made, renamed or deleted', async () => {
    expect(await codeOf(fs.mkproject('/Templates'))).toBe(FsErrorCode.EXISTS);
    // A fixed name, the way `template/` is on disk: renaming it would leave the
    // sidebar row pointing at nothing.
    expect(await codeOf(fs.rename('/Templates', 'Sheets'))).toBe(FsErrorCode.READ_ONLY);
    expect(await codeOf(fs.remove('/Templates'))).toBe(FsErrorCode.READ_ONLY);
  });

  it('refuses a loose file written AT it, as the root does', async () => {
    expect(await codeOf(fs.write('/Templates', enc.encode('x')))).toBe(FsErrorCode.NOT_A_DIRECTORY);
  });

  it('survives a wipe of every project, having none to be wiped with', async () => {
    // `wipe` deletes everything `listProjects` returns, which is the shape a
    // reserved record has to survive: it is not in that list, so it is still
    // there afterwards and the sidebar row still resolves.
    await fs.write('/Footprints/lib.pretty/x.kicad_mod', enc.encode('(footprint)'));
    for (const p of await listProjects()) await deleteProject(p.id);
    expect(await names('/Footprints/lib.pretty')).toEqual(['x.kicad_mod']);
  });
});

describe('the sheets saved while Templates was a store of its own', () => {
  /** The `template-files` object store, written the way the deleted module did. */
  async function seedLegacy(rows: { path: string; text: string; deletedAt?: number }[]) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ziroeda-templates', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('templates'))
          d.createObjectStore('templates', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('template-files'))
          d.createObjectStore('template-files', { keyPath: 'path' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('template-files', 'readwrite');
      // Cleared first: the old database outlives `wipe`, which only knows the
      // projects store, so rows would pile up from one test into the next.
      t.objectStore('template-files').clear();
      for (const r of rows) t.objectStore('template-files').put({ updatedAt: 1, ...r });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    db.close();
  }

  it('are carried into the Templates folder the first time it is opened', async () => {
    await seedLegacy([{ path: 'old.kicad_wks', text: '(drawing_sheet old)' }]);
    expect(await names('/Templates')).toEqual(['old.kicad_wks']);
    expect(dec.decode(await fs.read('/Templates/old.kicad_wks'))).toBe('(drawing_sheet old)');
  });

  it('leaves a tombstoned one behind, as the store meant it to be', async () => {
    await seedLegacy([
      { path: 'kept.kicad_wks', text: 'a' },
      { path: 'gone.kicad_wks', text: 'b', deletedAt: 2 },
    ]);
    expect(await names('/Templates')).toEqual(['kept.kicad_wks']);
  });

  it('does not put a file back after it is deleted here', async () => {
    // The seed runs on CREATION, not on every resolve. A mirror would resurrect
    // anything the user removed, on the next listing.
    await seedLegacy([{ path: 'old.kicad_wks', text: 'a' }]);
    expect(await names('/Templates')).toEqual(['old.kicad_wks']);
    await fs.remove('/Templates/old.kicad_wks');
    expect(await names('/Templates')).toEqual([]);
  });
});

describe('a user-data folder is a row the cloud will accept', () => {
  /**
   * `projects.id` is a `uuid` column and the primary key is `(user_id, id)`
   * (`supabaseBackend.putProject`). The first version of this used readable ids
   * — `userdir:footprints` — which reach Postgres unchanged on the first push
   * and come back `invalid input syntax for type uuid`. That aborts the run, so
   * four unrelated projects stopped syncing because of a folder.
   */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('has a plain UUID for an id, with nothing readable encoded in it', async () => {
    for (const name of USER_DIR_NAMES) {
      const meta = await projectAt(`/${name}`).catch(() => null);
      expect(meta).toBeNull(); // not a project — the id comes from the record
    }
    await fs.write('/Footprints/x.kicad_mod', enc.encode('(footprint)'));
    for (const id of Object.values(USER_DIR_IDS)) expect(id).toMatch(UUID);
  });

  it('uses the SAME id every time, so two devices converge on one folder', async () => {
    // A fresh id per creation would make a second Templates on every machine
    // the account signs in from, and the sync has no way to merge them.
    await fs.write('/Templates/a.kicad_wks', enc.encode('a'));
    const first = await exportProject(USER_DIR_IDS.templates!);
    expect(first?.files.map((f) => f.name)).toEqual(['a.kicad_wks']);
  });

  it('moves a folder made under the old readable id, files and all', async () => {
    // Anyone running the build that shipped the readable ids has one of these.
    // Moved, not re-seeded: it holds whatever was saved after it was created,
    // and the seed only ever knew about Templates.
    await saveProject('Symbols', [file('mine.kicad_sym', '(kicad_symbol_lib)')], 'userdir:symbols');
    expect(await names('/Symbols')).toEqual(['mine.kicad_sym']);
    // And the old row is gone rather than left to show up as a project.
    expect((await listProjects()).map((p) => p.name)).toEqual([]);
    expect(await exportProject('userdir:symbols')).toBeNull();
  });

  it('is still a folder after a pull, which carries no marker', async () => {
    // The cloud row has no column for it and `SyncableProject` no field, so the
    // marker is recovered from the id. Signing in on a second device would
    // otherwise pull all four down as projects to open.
    await fs.write('/Templates/a.kicad_wks', enc.encode('a'));
    const row = await exportProject(USER_DIR_IDS.templates!);
    expect(row).not.toBeNull();
    for (const id of Object.values(USER_DIR_IDS)) await deleteProject(id);
    await importProject(row!);
    expect((await listProjects()).map((p) => p.name)).toEqual([]);
    expect(await names('/Templates')).toEqual(['a.kicad_wks']);
  });

  it('keeps it out of the project list across writes into it', async () => {
    await fs.write('/Templates/a.kicad_wks', enc.encode('a'));
    await fs.write('/Templates/b.kicad_wks', enc.encode('b'));
    expect((await listProjects()).map((p) => p.name)).toEqual([]);
  });

  it('is not un-marked by a saveProject that does not know it is a folder', async () => {
    // `saveProject` REBUILDS the record — "anything not carried across here is
    // silently dropped on every save", as its own comment says — which is why
    // `syncedAt`, `ownerId` and `emptyFolders` are each carried explicitly. The
    // marker is the same kind of thing: a save that passes no `userDir` must
    // not turn the folder back into a project. Called directly because that is
    // the only way to reach the branch; `fs.write` goes through
    // `updateProjectFiles`, which patches instead of rebuilding.
    await fs.write('/Templates/a.kicad_wks', enc.encode('a'));
    await saveProject('Templates', [file('b.kicad_wks', 'b')], USER_DIR_IDS.templates!);
    expect((await listProjects()).map((p) => p.name)).toEqual([]);
    expect(await names('/Templates')).toEqual(['b.kicad_wks']);
  });
});
