// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `IMPORT_PROJ_PROPS` (`include/import_proj_properties.h`, new in 10.0.6): the
 * codec the import manager encodes with and both editor frames decode with.
 */
import { describe, expect, it } from 'vitest';
import { IMPORT_PROJ_PROPS } from '@ziroeda/common/import_proj_properties.js';

describe('IMPORT_PROJ_PROPS', () => {
  it('joins list values with the unit separator, which no nickname can contain', () => {
    expect(IMPORT_PROJ_PROPS.JoinList(['a', 'b', 'c'])).toBe('a\x1fb\x1fc');
    expect(IMPORT_PROJ_PROPS.JoinList([])).toBe('');
    expect(IMPORT_PROJ_PROPS.JoinList(['solo'])).toBe('solo');
  });

  it('splits back, dropping empties', () => {
    expect(IMPORT_PROJ_PROPS.SplitList('a\x1fb\x1fc')).toEqual(['a', 'b', 'c']);
    expect(IMPORT_PROJ_PROPS.SplitList('')).toEqual([]);
    expect(IMPORT_PROJ_PROPS.SplitList('\x1fa\x1f\x1fb\x1f')).toEqual(['a', 'b']);
  });

  it('a list survives the round trip', () => {
    const libs = ['Source-A', 'Source B', 'c.d'];
    expect(IMPORT_PROJ_PROPS.SplitList(IMPORT_PROJ_PROPS.JoinList(libs))).toEqual(libs);
  });

  it('reads the two footprint keys out of a properties map', () => {
    const props = new Map([
      [IMPORT_PROJ_PROPS.FP_CACHE_NICKNAME, 'proj-import-fps'],
      [IMPORT_PROJ_PROPS.SOURCE_FP_LIBS, IMPORT_PROJ_PROPS.JoinList(['A', 'B'])],
      ['unrelated', 'x'],
    ]);
    expect(IMPORT_PROJ_PROPS.ReadFootprintProps(props)).toEqual({
      cacheNickname: 'proj-import-fps',
      sourceFpLibs: ['A', 'B'],
    });
  });

  it('a missing key, or no map at all, leaves that value empty', () => {
    expect(IMPORT_PROJ_PROPS.ReadFootprintProps(null)).toEqual({
      cacheNickname: '',
      sourceFpLibs: [],
    });
    expect(
      IMPORT_PROJ_PROPS.ReadFootprintProps(new Map([[IMPORT_PROJ_PROPS.SOURCE_FP_LIBS, 'A']])),
    ).toEqual({ cacheNickname: '', sourceFpLibs: ['A'] });
  });

  it('spells the property keys as the C++ does', () => {
    expect(IMPORT_PROJ_PROPS.FP_CACHE_NICKNAME).toBe('import_fp_cache_nickname');
    expect(IMPORT_PROJ_PROPS.SOURCE_FP_LIBS).toBe('import_source_fp_libs');
  });

  it('derives the cache nickname from a stem, replacing what a nickname may not hold', () => {
    expect(IMPORT_PROJ_PROPS.MakeCacheNickname('hifive')).toBe('hifive-import-fps');
    expect(IMPORT_PROJ_PROPS.MakeCacheNickname('a:b')).toBe('a_b-import-fps');
    expect(IMPORT_PROJ_PROPS.MakeCacheNickname('a\\b')).toBe('a_b-import-fps');
  });
});
