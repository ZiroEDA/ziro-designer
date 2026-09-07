// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHIM`'s remembered geometry — the half of the paged-dialog size rule
 * that was missing, and the answer to "why does KiCad's Board Setup never
 * resize when mine does?".
 *
 * Both halves are real and they are easy to mistake for each other:
 *
 *  - `PAGED_DIALOG` recomputes its minimum on EVERY page change and grows into
 *    it (`paged_dialog.cpp:424-451`). `m_treebook->SetFitToCurrentPage( true )`
 *    (`:73`) is what makes `GetBestSize()` the CURRENT page rather than the
 *    largest, so the growth is genuinely per page. That half we already had.
 *  - `DIALOG_SHIM::Show()` restores `m_dialogControlValues[key]["__geometry"]`
 *    before the dialog is painted (`dialog_shim.cpp:445-483`). So the growth
 *    happens once in a user's life, is written back, and every later open
 *    starts at the grown size. That half was missing, so ours re-grew on the
 *    first click of every open.
 *
 * The key is `getDialogKeyFromTitle( GetTitle() )` (`:79-93`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dialogGeometryKey,
  readDialogGeometry,
  writeDialogGeometry,
} from '@ziroeda/designer/src/ui/paged_dialog_size.js';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('dialogGeometryKey', () => {
  it('drops a trailing parenthesised suffix, with its spaces', () => {
    // `getDialogKeyFromTitle`: find the LAST '(', walk back over spaces, cut.
    // That is what keeps "Board Setup (my_board)" and "Board Setup (other)"
    // sharing one remembered size.
    expect(dialogGeometryKey('Board Setup (my_board)')).toBe('Board Setup');
    expect(dialogGeometryKey('Board Setup   (x)')).toBe('Board Setup');
  });

  it('leaves a title that has no suffix alone', () => {
    expect(dialogGeometryKey('Board Setup')).toBe('Board Setup');
    expect(dialogGeometryKey('Schematic Setup')).toBe('Schematic Setup');
  });

  it('does not cut a title that merely STARTS with a paren', () => {
    // `parenPos > 0` upstream — a '(' at index 0 is not a suffix marker.
    expect(dialogGeometryKey('(unnamed)')).toBe('(unnamed)');
  });
});

describe('remembering a grown dialog', () => {
  it('round-trips a size under the title key', () => {
    writeDialogGeometry('Board Setup', { w: 1070, h: 620 });
    expect(readDialogGeometry('Board Setup')).toEqual({ w: 1070, h: 620 });
    // and the suffix form finds the same entry.
    expect(readDialogGeometry('Board Setup (demo)')).toEqual({ w: 1070, h: 620 });
  });

  it('returns undefined when nothing has been stored', () => {
    // The first open in a user's life: `aInitialSize` stands, as upstream.
    expect(readDialogGeometry('Board Setup')).toBeUndefined();
  });

  it('keeps two dialogs’ sizes apart', () => {
    writeDialogGeometry('Board Setup', { w: 1070, h: 620 });
    writeDialogGeometry('Schematic Setup', { w: 920, h: 460 });
    expect(readDialogGeometry('Board Setup')?.w).toBe(1070);
    expect(readDialogGeometry('Schematic Setup')?.w).toBe(920);
  });

  it('ignores everything written under an older layout epoch', () => {
    // A dialog that blew up because of a layout bug must not keep the blown-up
    // size once the bug is fixed. Bumping the epoch retires those entries.
    localStorage.setItem('ze-dialog-geometry:Board Setup', JSON.stringify({ w: 1330, h: 620 }));
    expect(readDialogGeometry('Board Setup')).toBeUndefined();
  });

  it('ignores a stored value that is not a usable size', () => {
    // Storage is shared with every other tab and version of the app; a shape
    // we do not recognise must fall back rather than size the dialog to NaN.
    for (const bad of ['not json', '{}', '{"w":"1070","h":620}', '{"w":0,"h":620}']) {
      localStorage.setItem('ze-dialog-geometry:v2:Board Setup', bad);
      expect(readDialogGeometry('Board Setup'), bad).toBeUndefined();
    }
  });
});
