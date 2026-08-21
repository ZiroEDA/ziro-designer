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
import { listFileSystem } from '@ziroeda/designer/src/fs/list_fs.js';

/** The two demos that made the bug visible, with a file each. */
const DEMOS = [
  { id: 'simulation/amplifier_ac', files: ['amp.kicad_sch', 'amp.kicad_pro'] },
  { id: 'simulation/rectifier', files: ['rect.kicad_pro'] },
  { id: 'cm5_minima', files: ['cm5.kicad_pro', 'footprints.pretty/R.kicad_mod'] },
];

const demosFs = (): FileSystem =>
  listFileSystem(
    async () => ({
      files: DEMOS.flatMap((d) =>
        d.files.map((rel) => ({ name: `${d.id}/${rel}`, size: 7, modified: 5 })),
      ),
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

  it('marks a project folder with no size, the way every folder is drawn', async () => {
    const [entry] = (await demosFs().list('/simulation')).filter((e) => e.name === 'rectifier');
    expect(entry?.size).toBeNull();
  });

  it('finds a derived folder with stat, not only the leaves', async () => {
    expect((await demosFs().stat('/simulation'))?.kind).toBe('folder');
    expect((await demosFs().stat('/simulation/rectifier'))?.kind).toBe('project');
    expect(await demosFs().stat('/nope')).toBeNull();
  });
});

describe('a listing place refuses every change', () => {
  it.each([
    'write',
    'mkdir',
    'mkproject',
    'rename',
    'remove',
  ] as const)('%s reports READ_ONLY rather than doing nothing', async (op) => {
    const fs = demosFs();
    // Every mutation takes the path first, so one call shape covers them all.
    const call = (fs as unknown as Record<string, (p: string, x?: unknown) => Promise<void>>)[op];
    await expect(call.call(fs, '/cm5_minima', new Uint8Array())).rejects.toMatchObject({
      code: FsErrorCode.READ_ONLY,
    });
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

  it('hands a project s contents to the account tree instead of showing nothing', async () => {
    // The bug this pins: Recent only ever knew the project's *name*, so
    // walking into one derived no children and read as an empty folder.
    expect(await rows(recent(), '/Blinky')).toEqual(['Blinky.kicad_pro file']);
  });
});
