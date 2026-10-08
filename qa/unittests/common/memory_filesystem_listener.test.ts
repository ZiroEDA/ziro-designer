// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * MEMORY_FILESYSTEM's write listener: how the page keeps the files a mount holds in its own store.
 * Told of every write after it lands, through wxWriteFileSync as through Write, and not after it is
 * cleared.
 */
import {
  MEMORY_FILESYSTEM,
  wxMountFileSystem,
  wxReadFileSync,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { describe, expect, it } from 'vitest';

describe('MEMORY_FILESYSTEM.SetWriteListener', () => {
  it('hears each write, after it has landed, with the path relative to the mount', () => {
    const fs = new MEMORY_FILESYSTEM();
    const heard: [string, string, string | null][] = [];
    const unmount = wxMountFileSystem('/proj', fs);

    try {
      fs.SetWriteListener((aRel, aData) => {
        // The bytes are already readable when the listener runs.
        const now = wxReadFileSync(`/proj/${aRel}`);
        heard.push([
          aRel,
          new TextDecoder().decode(aData),
          now ? new TextDecoder().decode(now) : null,
        ]);
      });

      wxWriteFileSync('/proj/a.kicad_sch', new TextEncoder().encode('one'));
      fs.Write('sub/b.kicad_sch', new TextEncoder().encode('two'));

      expect(heard).toEqual([
        ['a.kicad_sch', 'one', 'one'],
        ['sub/b.kicad_sch', 'two', 'two'],
      ]);

      fs.SetWriteListener(null);
      wxWriteFileSync('/proj/c.kicad_sch', new TextEncoder().encode('three'));
      expect(heard.length).toBe(2);
    } finally {
      unmount();
    }
  });
});
