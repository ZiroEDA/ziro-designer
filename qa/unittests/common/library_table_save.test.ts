// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIBRARY_TABLE::Save` (library_table.cpp:297-322): the table's `Format`,
 * prettified, into its file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

const table = (path: string): LIBRARY_TABLE =>
  LIBRARY_TABLE.FromFile(
    path,
    '(fp_lib_table (version 7))',
    LIBRARY_TABLE_SCOPE.PROJECT,
    LIBRARY_TABLE_TYPE.FOOTPRINT,
  );

describe('LIBRARY_TABLE::Save', () => {
  it('writes the formatted table to its path, and it parses back', () => {
    unmount = wxMountFileSystem('/lts', new MEMORY_FILESYSTEM());
    const t = table('/lts/fp-lib-table');
    const row = t.InsertRow();
    row.SetNickname('mine');
    row.SetURI('${KIPRJMOD}/mine.pretty');
    row.SetType('KiCad');
    row.SetOptions('kicad_import_cache=1');

    expect(t.Save().ok).toBe(true);

    const text = new TextDecoder().decode(wxReadFileSync('/lts/fp-lib-table')!);
    expect(text).toBe(t.FormatForSave());
    const back = LIBRARY_TABLE.FromFile(
      '/lts/fp-lib-table',
      text,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE_TYPE.FOOTPRINT,
    );
    expect(back.IsOk()).toBe(true);
    expect(back.Row('mine')!.URI()).toBe('${KIPRJMOD}/mine.pretty');
    expect(back.Row('mine')!.Options()).toBe('kicad_import_cache=1');
  });

  it('a read-only table refuses, and writes nothing', () => {
    unmount = wxMountFileSystem('/lts', new MEMORY_FILESYSTEM());
    const t = table('/lts/fp-lib-table');
    t.SetReadOnly(true);
    const r = t.Save();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toBe("Library table '/lts/fp-lib-table' is read-only");
    expect(wxReadFileSync('/lts/fp-lib-table')).toBeNull();
  });

  it('a path no mount holds is an error, not a silent success', () => {
    const r = table('/nowhere-mounted/fp-lib-table').Save();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toBe("Could not write '/nowhere-mounted/fp-lib-table'");
  });
});
