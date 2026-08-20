// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Re-deriving a directory level from a project's flat file list.
 *
 * The store keeps a project as relative paths — `sub/dir/board.kicad_pcb` —
 * so the folders between are implied. A file chooser has to show them anyway,
 * one level at a time, which is what this does.
 */
import { describe, expect, it } from 'vitest';
import { type FlatFile, dirLevel } from '@ziroeda/designer/src/fs/filesystem.js';

const f = (name: string, size = 10, modified = 1000): FlatFile => ({ name, size, modified });

const named = (files: readonly FlatFile[], dir: string, base = '/P'): string[] =>
  dirLevel(files, dir, base)
    .map((e) => e.name)
    .sort();

describe('the immediate children, and only those', () => {
  const files = [f('board.kicad_pcb'), f('sub/a.txt'), f('sub/b/c.txt'), f('other/d.txt')];

  it('lists a project root', () => {
    expect(named(files, '')).toEqual(['board.kicad_pcb', 'other', 'sub']);
  });

  it('folds a deep path into the one folder it starts with', () => {
    // `sub/b/c.txt` contributes `sub` here and nothing else — `b` belongs to
    // the next level down, not this one.
    expect(named(files, '')).not.toContain('b');
    expect(named(files, 'sub')).toEqual(['a.txt', 'b']);
    expect(named(files, 'sub/b')).toEqual(['c.txt']);
  });

  it('gives nothing for a folder that does not exist', () => {
    expect(named(files, 'nope')).toEqual([]);
  });
});

describe('a folder is not a name prefix', () => {
  it('does not swallow a sibling whose name merely starts the same', () => {
    // The bug this guards: matching on `sub` rather than `sub/` would list
    // `subwoofer.txt` as a child of `sub`, and would show `sub` twice at the
    // root. Both are wrong, and both look right in a quick read of the code.
    const files = [f('sub/a.txt'), f('subwoofer.txt')];
    expect(named(files, 'sub')).toEqual(['a.txt']);
    expect(named(files, '')).toEqual(['sub', 'subwoofer.txt']);
  });
});

describe('what each entry carries', () => {
  const files = [f('board.kicad_pcb', 4096, 5000), f('sub/a.txt', 12, 7000)];

  it('gives a file its own size and time', () => {
    const [file] = dirLevel(files, '', '/P').filter((e) => e.kind === 'file');
    expect(file).toMatchObject({ name: 'board.kicad_pcb', size: 4096, modified: 5000 });
  });

  it('gives a folder no size at all, because the column is empty for one', () => {
    // Measured on the real chooser: a folder's Size and Type cells are blank.
    // `null` rather than `0`, so nothing can print `0 bytes` for a folder.
    const [folder] = dirLevel(files, '', '/P').filter((e) => e.kind === 'folder');
    expect(folder?.size).toBeNull();
  });

  it('absolutises the path against the base, so the chooser can navigate', () => {
    expect(dirLevel(files, 'sub', '/P/sub').map((e) => e.path)).toEqual(['/P/sub/a.txt']);
    expect(
      dirLevel(files, '', '/P')
        .map((e) => e.path)
        .sort(),
    ).toEqual(['/P/board.kicad_pcb', '/P/sub']);
  });
});

describe('a synthesised folder’s timestamp', () => {
  it('is its newest descendant’s, not its oldest and not the first seen', () => {
    // A folder has no record of its own here. The newest child is the answer
    // a real folder would give after those files were written into it; taking
    // the first one in the list would make the column depend on store order.
    const files = [f('sub/old.txt', 1, 1000), f('sub/new.txt', 1, 9000), f('sub/mid.txt', 1, 5000)];
    const [folder] = dirLevel(files, '', '/P');
    expect(folder?.modified).toBe(9000);
  });

  it('takes it from a grandchild too', () => {
    const files = [f('sub/a.txt', 1, 1000), f('sub/deep/b.txt', 1, 8000)];
    const [folder] = dirLevel(files, '', '/P');
    expect(folder?.modified).toBe(8000);
  });
});

describe('degenerate input', () => {
  it('lists nothing for an empty project', () => {
    expect(dirLevel([], '', '/P')).toEqual([]);
  });

  it('ignores a name that is exactly the folder, which is not a child of it', () => {
    // Defensive: a stored name equal to the directory would otherwise appear
    // as an entry with an empty name.
    expect(named([f('sub/'), f('sub/a.txt')], 'sub')).toEqual(['a.txt']);
  });
});
