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
import {
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  saveProject,
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

async function wipe(): Promise<void> {
  for (const p of await listProjects()) await deleteProject(p.id);
}

beforeEach(wipe);
afterEach(wipe);

describe('the root holds projects', () => {
  it('shows one folder per project, and calls it a project', async () => {
    await saveProject('Blinky', [file('blinky.kicad_pro', '{}')]);
    const [entry] = await fs.list('/');
    expect(entry).toMatchObject({ name: 'Blinky', path: '/Blinky', kind: 'project' });
  });

  it('gives a project no size, because a folder shows none', async () => {
    await saveProject('Blinky', [file('a.txt', 'x')]);
    expect((await fs.list('/'))[0]?.size).toBeNull();
  });

  it('is empty when there are no projects', async () => {
    expect(await fs.list('/')).toEqual([]);
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
    expect(await names('/')).toEqual(['Other']);
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
    expect(await names('/')).toEqual([]);
  });
});

describe('two projects with the same name', () => {
  it('shows the later one suffixed, oldest keeping the bare name', async () => {
    // The store never required unique names and a directory does. The one
    // saved first keeps `Blinky`, so an existing project's path does not move
    // when a namesake is saved.
    const first = await saveProject('Blinky', [file('a.txt', 'first')]);
    const second = await saveProject('Blinky', [file('b.txt', 'second')]);
    expect(await names('/')).toEqual(['Blinky', 'Blinky (2)']);
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
    expect(await names('/')).toEqual(['Fresh']);
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
