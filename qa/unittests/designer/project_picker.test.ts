// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Project ingestion walking: directory-handle recursion, dropped-entry
 * recursion (batched readEntries), depth limits, and unreadable-file skips,
 * exercised with structural fakes for the browser APIs.
 */
import { describe, it, expect } from 'vitest';
import {
  walkDirectoryHandle,
  walkDroppedEntries,
  filesFromFileList,
  MAX_WALK_DEPTH,
  type DirHandle,
  type DropEntry,
  type FsEntry,
} from '@ziroeda/designer/src/home/project_picker.js';

const enc = new TextEncoder();

// --- File System Access fakes ------------------------------------------------

const fakeFile = (name: string, content: string): FsEntry => ({
  kind: 'file',
  name,
  getFile: async () => new File([enc.encode(content)], name),
  // biome-ignore lint/suspicious/useAwait: structural stub, never called on files
  values: async function* () {},
});

const fakeDir = (name: string, children: FsEntry[]): FsEntry => ({
  kind: 'directory',
  name,
  getFile: () => Promise.reject(new Error('not a file')),
  values: async function* () {
    yield* children;
  },
});

/** A File carrying the relative path webkitdirectory would have set. */
const relFile = (rel: string, content: string): File => {
  const f = new File([enc.encode(content)], rel.split('/').pop()!);
  Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
};

describe('walkDirectoryHandle', () => {
  it('recurses subfolders and keeps relative paths', async () => {
    const root: DirHandle = fakeDir('root', [
      fakeFile('proj.kicad_pro', '{}'),
      fakeDir('CM5IO.pretty', [fakeFile('pad.kicad_mod', '(footprint)')]),
    ]);
    const files = await walkDirectoryHandle(root);
    expect(files.map((f) => f.name).sort()).toEqual([
      'CM5IO.pretty/pad.kicad_mod',
      'proj.kicad_pro',
    ]);
    expect(new TextDecoder().decode(await files[0]!.bytesOf())).toBe('{}');
  });

  it('stops at the depth limit', async () => {
    let deep: FsEntry = fakeFile('leaf.txt', 'x');
    for (let i = 0; i < MAX_WALK_DEPTH + 2; i++) deep = fakeDir(`d${i}`, [deep]);
    const files = await walkDirectoryHandle(fakeDir('root', [deep]));
    expect(files).toHaveLength(0);
  });
});

// --- Drag-and-drop fakes ------------------------------------------------------

const dropFile = (name: string, content: string | null): DropEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok, err) =>
    content === null ? err(new Error('unreadable')) : ok(new File([enc.encode(content)], name)),
  createReader: () => ({ readEntries: (ok) => ok([]) }),
});

/** Directory whose reader yields children one-per-batch (exercises draining). */
const dropDir = (name: string, children: DropEntry[]): DropEntry => {
  return {
    isFile: false,
    isDirectory: true,
    name,
    file: (_ok, err) => err(new Error('not a file')),
    createReader: () => {
      let i = 0;
      return {
        readEntries: (ok) => {
          ok(i < children.length ? [children[i++]!] : []);
        },
      };
    },
  };
};

describe('walkDroppedEntries', () => {
  it('walks nested dropped folders with batched readers', async () => {
    const files = await walkDroppedEntries([
      dropDir('proj', [
        dropFile('proj.kicad_sch', '(kicad_sch)'),
        dropDir('lib', [dropFile('r.kicad_sym', '(kicad_symbol_lib)')]),
      ]),
    ]);
    expect(files.map((f) => f.name).sort()).toEqual([
      'proj/lib/r.kicad_sym',
      'proj/proj.kicad_sch',
    ]);
  });

  it('skips unreadable files instead of failing the whole drop', async () => {
    const files = await walkDroppedEntries([
      dropDir('proj', [dropFile('bad.bin', null), dropFile('ok.txt', 'ok')]),
    ]);
    expect(files.map((f) => f.name)).toEqual(['proj/ok.txt']);
  });
});

describe('a picked folder is a working directory, not just a project', () => {
  // Observed on a real board: .git held 60 files and 5.9 MB, .history 170 and
  // 4.1 MB, none of it the design. Encrypted blobs are keyed by a random id,
  // so re-uploading a churning .git orphans the previous copies rather than
  // replacing them, and the orphans are never collected.
  it('leaves .git and .history out of a picked directory', async () => {
    const root: DirHandle = fakeDir('root', [
      fakeFile('board.kicad_pcb', '(kicad_pcb)'),
      fakeDir('.git', [fakeFile('HEAD', 'ref: refs/heads/main')]),
      fakeDir('.history', [fakeFile('board-20260101.kicad_pcb', '(old)')]),
      fakeDir('3d_shapes', [fakeFile('part.wrl', 'wrl')]),
    ]);
    const names = (await walkDirectoryHandle(root)).map((f) => f.name);
    expect(names).toContain('board.kicad_pcb');
    // The models are project content and must survive: they are NOT in
    // s_allowedExtensionsToList, which is why that list cannot be the filter.
    expect(names).toContain('3d_shapes/part.wrl');
    expect(names.some((n) => n.includes('.git'))).toBe(false);
    expect(names.some((n) => n.includes('.history'))).toBe(false);
  });

  it('leaves them out of a dropped folder too', async () => {
    const entries = [
      dropFile('board.kicad_pcb', '(kicad_pcb)'),
      dropDir('.git', [dropFile('HEAD', 'ref')]),
    ];
    const names = (await walkDroppedEntries(entries)).map((f) => f.name);
    expect(names).toEqual(['board.kicad_pcb']);
  });

  it('leaves them out of a webkitdirectory file list, where the tree is flat', async () => {
    const list = [
      relFile('proj/board.kicad_pcb', 'x'),
      relFile('proj/.git/objects/ab/cdef', 'y'),
      relFile('proj/3d_shapes/part.step', 'z'),
    ] as unknown as FileList;
    const names = filesFromFileList(list).map((f) => f.name);
    expect(names).toEqual(['proj/board.kicad_pcb', 'proj/3d_shapes/part.step']);
  });
});
