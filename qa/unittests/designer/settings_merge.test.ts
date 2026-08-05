// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Loading settings from localStorage.
 *
 * The store is editable by hand, survives across app versions, and is read
 * before anything renders — so a value of the wrong *type* is not a preference,
 * it is damage. A string where a number belongs reaches the renderer and throws
 * before React mounts: a white screen, which is the failure the capability
 * probe exists to avoid producing.
 *
 * Falling back to the default is always safe. The worst case is one preference
 * reverting; the alternative is an app that will not start until the user finds
 * localStorage.
 */
import { describe, it, expect } from 'vitest';
import { deepMerge } from '@ziroeda/designer/src/prefs/settings.js';

describe('what a stored value is allowed to override', () => {
  it('takes a stored value of the same type', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge({ a: 'x' }, { a: 'y' })).toEqual({ a: 'y' });
    expect(deepMerge({ a: true }, { a: false })).toEqual({ a: false });
  });

  it('keeps the default when the stored type is wrong', () => {
    expect(deepMerge({ a: 1 }, { a: 'nope' })).toEqual({ a: 1 });
    expect(deepMerge({ a: 'x' }, { a: 7 })).toEqual({ a: 'x' });
    expect(deepMerge({ a: true }, { a: 'yes' })).toEqual({ a: true });
  });

  it('keeps the default when an object arrives where a scalar belongs', () => {
    // The case that reaches the renderer as an object and throws on `.toFixed`.
    expect(deepMerge({ a: 1 }, { a: { nested: 1 } })).toEqual({ a: 1 });
  });

  it('keeps the default when an array arrives where a scalar belongs', () => {
    expect(deepMerge({ a: 1 }, { a: [1, 2] })).toEqual({ a: 1 });
  });

  it('replaces an array wholesale, but only with an array', () => {
    // Grid sizes and the like: a stored list is the list, not a merge.
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    expect(deepMerge({ a: [1, 2] }, { a: 'nope' })).toEqual({ a: [1, 2] });
  });

  it('merges nested objects rather than replacing them', () => {
    // A new setting inside an existing group has to get its default.
    expect(deepMerge({ g: { a: 1, b: 2 } }, { g: { a: 9 } })).toEqual({ g: { a: 9, b: 2 } });
  });

  it('ignores keys the defaults do not have', () => {
    // A setting removed in a later version stays gone.
    expect(deepMerge({ a: 1 }, { a: 2, gone: 3 })).toEqual({ a: 2 });
  });

  it('survives a stored value that is not an object at all', () => {
    expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, 'garbage')).toEqual({ a: 1 });
  });
});
