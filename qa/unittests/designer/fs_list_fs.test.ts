// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The listing filesystems behind the chooser's sidebar places.
 *
 * Recent, Demos and Templates are not folders of the account's tree — they are
 * the browser equivalent of GTK's `recent:///`, a query with nothing behind it.
 * Each is dressed as the smallest filesystem that can answer `list`.
 *
 * What these pin is the thing that was wrong when it shipped: a demo's id is a
 * path, `simulation/amplifier_ac`, and flattening it put the amplifier at the
 * top level beside the `simulation` folder it lives in. A demo also carries the
 * files it is made of, so entering one has to show them rather than an empty
 * folder.
 */
import { describe, expect, it } from 'vitest';
import { type FileSystem, FsErrorCode } from '@ziroeda/designer/src/fs/filesystem.js';
import { formatModified } from '@ziroeda/designer/src/fs/format.js';
import { listFileSystem } from '@ziroeda/designer/src/fs/list_fs.js';

/** The two demos that made the bug visible, with a file each. */
const DEMOS = [
  { id: 'simulation/amplifier_ac', files: ['amp.kicad_sch', 'amp.kicad_pro'] },
  { id: 'simulation/rectifier', files: ['rect.kicad_pro'] },
  { id: 'cm5_minima', files: ['cm5.kicad_pro', 'footprints.pretty/R.kicad_mod'] },
];

/**
 * The demos manifest as it really is: file names, and nothing about their size
 * or when they were written. Those bytes sit on the CDN until a demo is opened,
 * so the listing genuinely does not know either.
 */
const UNDATED = { size: null, modified: null } as const;

const demosFs = (): FileSystem =>
  listFileSystem(
    async () => ({
      files: DEMOS.flatMap((d) => d.files.map((rel) => ({ name: `${d.id}/${rel}`, ...UNDATED }))),
      projects: new Set(DEMOS.map((d) => `/${d.id}`)),
    }),
    { leafKind: 'file' },
  );

const rows = async (fs: FileSystem, dir: string): Promise<string[]> =>
  (await fs.list(dir)).map((e) => `${e.name} ${e.kind}`).sort();

describe('a demos listing is a tree, not a flat list', () => {
  it('shows only the group folder at the top, never the project inside it', async () => {
    // The bug: `amplifier_ac` appeared here, next to `simulation`.
    expect(await rows(demosFs(), '/')).toEqual(['cm5_minima project', 'simulation folder']);
  });

  it('shows the demos inside the group, marked as projects', async () => {
    expect(await rows(demosFs(), '/simulation')).toEqual([
      'amplifier_ac project',
      'rectifier project',
    ]);
  });

  it('shows a demo project its own files, so entering one is not empty', async () => {
    expect(await rows(demosFs(), '/simulation/amplifier_ac')).toEqual([
      'amp.kicad_pro file',
      'amp.kicad_sch file',
    ]);
    expect(await rows(demosFs(), '/cm5_minima')).toEqual([
      'cm5.kicad_pro file',
      'footprints.pretty folder',
    ]);
  });

  it('gives a file its size when the source has one', async () => {
    // The other direction from the undated cases below: a source that knows
    // must get its number through, so `null` cannot be hardcoded.
    const fs = listFileSystem(
      async () => ({ files: [{ name: 'p/board.kicad_pcb', size: 4096, modified: 1700 }] }),
      { leafKind: 'file' },
    );
    const [entry] = (await fs.list('/p')).filter((e) => e.name === 'board.kicad_pcb');
    expect(entry?.size).toBe(4096);
    expect(entry?.modified).toBe(1700);
  });

  it('finds a derived folder with stat, not only the leaves', async () => {
    expect((await demosFs().stat('/simulation'))?.kind).toBe('folder');
    expect((await demosFs().stat('/simulation/rectifier'))?.kind).toBe('project');
    expect(await demosFs().stat('/nope')).toBeNull();
  });
});

describe('a source that does not know says nothing, rather than epoch 0', () => {
  it('leaves Modified empty for an undated row', async () => {
    // The bug this pins: `modified: 0` rendered as `Jan 1, 1970`, a date a
    // person reads as real. Blank is the honest answer, and it is what a
    // folder's Size column already does.
    const [pro] = (await demosFs().list('/simulation/rectifier')).filter(
      (e) => e.name === 'rect.kicad_pro',
    );
    expect(pro?.modified).toBeNull();
    // `?? null`, never `?? 0`: coercing the null away here would hand
    // formatModified the very value this is meant to prove never reaches it.
    expect(formatModified(pro?.modified ?? null)).toBe('');
  });

  it('leaves Size empty for a row whose bytes are not local yet', async () => {
    const [pro] = (await demosFs().list('/simulation/rectifier')).filter(
      (e) => e.name === 'rect.kicad_pro',
    );
    expect(pro?.size).toBeNull();
  });

  it('leaves a folder undated while every child under it is', async () => {
    const [group] = (await demosFs().list('/')).filter((e) => e.name === 'simulation');
    expect(group?.modified).toBeNull();
  });

  it('still gives a folder the newest date any child does have', async () => {
    const fs = listFileSystem(
      async () => ({
        files: [
          { name: 'grp/old.txt', size: 1, modified: 100 },
          { name: 'grp/undated.txt', size: 1, modified: null },
          { name: 'grp/new.txt', size: 1, modified: 900 },
        ],
      }),
      { leafKind: 'file' },
    );
    const [group] = (await fs.list('/')).filter((e) => e.name === 'grp');
    expect(group?.modified).toBe(900);
  });
});

describe('a listing place refuses every change', () => {
  // Named calls rather than a lookup by string: qa's tsc typechecks .ts only
  // and rejects indexing FileSystem by an arbitrary key, so a table here would
  // pass vitest and break CI. One entry per method also means adding a method
  // to FileSystem without a refusal shows up as a missing case, not a silent
  // hole in a loop.
  const P = '/cm5_minima';
  const refusals: ReadonlyArray<readonly [string, (fs: FileSystem) => Promise<unknown>]> = [
    ['write', (fs) => fs.write(P, new Uint8Array())],
    ['mkdir', (fs) => fs.mkdir(P)],
    ['mkproject', (fs) => fs.mkproject(P)],
    ['rename', (fs) => fs.rename(P, 'other')],
    ['remove', (fs) => fs.remove(P)],
  ];

  it.each(refusals)('%s reports READ_ONLY rather than doing nothing', async (_name, call) => {
    await expect(call(demosFs())).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
  });
});

describe('Recent owns its order and delegates what is inside', () => {
  /** Stands in for the account tree: it answers for anything below the root. */
  const account = {
    async list(dir: string) {
      return dir === '/Blinky'
        ? [
            {
              name: 'Blinky.kicad_pro',
              path: '/Blinky/Blinky.kicad_pro',
              kind: 'file' as const,
              size: 3,
              modified: 1,
            },
          ]
        : [];
    },
    async stat() {
      return null;
    },
  } as unknown as FileSystem;

  const recent = (): FileSystem =>
    listFileSystem(
      async () => ({
        files: [
          { name: 'Blinky', size: 0, modified: 200 },
          { name: 'Amp', size: 0, modified: 100 },
        ],
      }),
      { below: account },
    );

  it('lists the projects themselves at the top level', async () => {
    expect(await rows(recent(), '/')).toEqual(['Amp project', 'Blinky project']);
  });

  it('shows a project no size, because a project is a folder', async () => {
    // The leaf here IS the project - `Blinky` has no slash in it - so this is
    // the one place the leaf kind decides whether a size comes through. The
    // source hands one over; a folder's row must not show it.
    const [entry] = (await recent().list('/')).filter((e) => e.name === 'Blinky');
    expect(entry?.size).toBeNull();
  });

  it('hands a project s contents to the account tree instead of showing nothing', async () => {
    // The bug this pins: Recent only ever knew the project's *name*, so
    // walking into one derived no children and read as an empty folder.
    expect(await rows(recent(), '/Blinky')).toEqual(['Blinky.kicad_pro file']);
  });
});
