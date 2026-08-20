// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Paths in the account's tree.
 *
 * The breadcrumb draws one button per ancestor, so splitting and rejoining has
 * to be exact. And because this tree is synced and addressed by name rather
 * than by inode, the validity rules are stricter than a filesystem's — the
 * tests for what is *refused* matter more than the ones for what is accepted.
 */
import { describe, expect, it } from 'vitest';
import {
  ROOT,
  ancestors,
  basename,
  dirname,
  fromSegments,
  isValidName,
  isValidPath,
  isWithin,
  join,
  normalize,
  segments,
} from '@ziroeda/designer/src/fs/path.js';

describe('splitting and rejoining', () => {
  it('drops the empty parts, so a trailing or doubled slash means nothing', () => {
    expect(segments('/a/b')).toEqual(['a', 'b']);
    expect(segments('//a//b/')).toEqual(['a', 'b']);
    expect(segments(ROOT)).toEqual([]);
  });

  it('round-trips', () => {
    for (const p of ['/', '/a', '/a/b', '/a/b/c.kicad_pro']) {
      expect(fromSegments(segments(p))).toBe(p);
    }
  });

  it('normalises the redundancy away', () => {
    expect(normalize('//a//b/')).toBe('/a/b');
    expect(normalize('')).toBe(ROOT);
  });
});

describe('naming the parts', () => {
  it('gives the last part as the name, and the root none', () => {
    expect(basename('/a/b.kicad_pro')).toBe('b.kicad_pro');
    expect(basename(ROOT)).toBe('');
  });

  it('gives the containing folder, and makes the root contain itself', () => {
    expect(dirname('/a/b')).toBe('/a');
    expect(dirname('/a')).toBe(ROOT);
    // Not an error case: walking up from the root has to terminate somewhere,
    // and a parent button that disables itself is easier than one that throws.
    expect(dirname(ROOT)).toBe(ROOT);
  });

  it('joins a name as one part, never as a path', () => {
    expect(join('/a', 'b')).toBe('/a/b');
    expect(join(ROOT, 'a')).toBe('/a');
    // join cannot tell join('/a', 'b/c') from join('/a/b', 'c') — same string.
    // A separator in a user-supplied name is caught before the join, not by it.
    expect(join('/a', 'b/c')).toBe(join('/a/b', 'c'));
    expect(isValidName('b/c')).toBe(false);
  });
});

describe('containment, which is not a string prefix', () => {
  it('holds for a folder and its descendants', () => {
    expect(isWithin('/a', '/a')).toBe(true);
    expect(isWithin('/a', '/a/b')).toBe(true);
    expect(isWithin(ROOT, '/a/b')).toBe(true);
  });

  it('does not hold for a sibling whose name merely starts the same', () => {
    // '/abc' starts with '/ab' as text and is not inside it. Comparing strings
    // instead of segments is the bug this exists to prevent.
    expect(isWithin('/ab', '/abc')).toBe(false);
  });

  it('does not hold upwards', () => {
    expect(isWithin('/a/b', '/a')).toBe(false);
  });
});

describe('the breadcrumb’s buttons', () => {
  it('runs root first, ending with the path itself', () => {
    expect(ancestors('/a/b')).toEqual(['/', '/a', '/a/b']);
  });

  it('is just the root at the root', () => {
    expect(ancestors(ROOT)).toEqual(['/']);
  });
});

describe('what may be named', () => {
  for (const ok of ['board.kicad_pro', 'My Project', 'a', 'notes.md', 'x.y.z']) {
    it(`accepts ${JSON.stringify(ok)}`, () => expect(isValidName(ok)).toBe(true));
  }

  it('refuses the names that are not names', () => {
    expect(isValidName('')).toBe(false);
    expect(isValidName('.')).toBe(false);
    expect(isValidName('..')).toBe(false);
  });

  it('refuses a separator, so a name cannot smuggle a path', () => {
    expect(isValidName('a/b')).toBe(false);
    expect(isValidName('/')).toBe(false);
  });

  it('refuses control characters, which would make a file unfetchable', () => {
    // Not an aesthetic rule: these do not survive a round trip through a URL or
    // a header, so the file would list and then fail to load.
    expect(isValidName('a\nb')).toBe(false);
    expect(isValidName('a\u0000b')).toBe(false);
    expect(isValidName('a\u007fb')).toBe(false);
  });

  it('refuses edge whitespace rather than trimming it', () => {
    // Trimming would let two files differ by something invisible, and the
    // second would silently overwrite the first.
    expect(isValidName(' a')).toBe(false);
    expect(isValidName('a ')).toBe(false);
    expect(isValidName('a b')).toBe(true);
  });
});

describe('what may be addressed', () => {
  it('requires an absolute path', () => {
    expect(isValidPath('/a/b')).toBe(true);
    expect(isValidPath('a/b')).toBe(false);
  });

  it('accepts the root', () => {
    expect(isValidPath(ROOT)).toBe(true);
  });

  it('refuses traversal rather than resolving it', () => {
    // Upstream a file dialog sits over a real filesystem where `..` is bounded
    // by permissions. Here it is a way to address someone else's space, so it
    // is refused, not normalised.
    expect(isValidPath('/a/../b')).toBe(false);
    expect(isValidPath('/..')).toBe(false);
  });
});
