// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a text box's properties.
 * Counterpart: `DIALOG_TEXTBOX_PROPERTIES`.
 *
 * The interesting part is `(justify …)`: one token holding three independent
 * settings — horizontal alignment, vertical alignment and mirroring — which
 * upstream edits through three separate setters. Two ways to get it wrong, both
 * pinned below:
 *
 * - **Centre is what the file means by saying nothing.** Writing `center` back
 *   adds a word KiCad never writes, so the file changes on every save even when
 *   nothing was edited.
 * - **The token has to be rebuilt from all three**, not patched word by word.
 *   Changing only the horizontal setting must not drop `mirror`.
 *
 * Every assertion that matters round-trips through the writer, because an
 * in-memory check cannot tell those failures apart from success.
 */
import { describe, expect, it } from 'vitest';
import { joinJustify, splitJustify } from '@ziroeda/pcbnew/dialogs/dialog_textbox_properties.js';

/** Apply a change and read the file back, which is where the failures show. */
describe('splitting a justify token', () => {
  it('reads the horizontal word', () => {
    expect(splitJustify(['left']).horiz).toBe('left');
    expect(splitJustify(['right']).horiz).toBe('right');
  });

  it('reads the vertical word', () => {
    expect(splitJustify(['top']).vert).toBe('top');
    expect(splitJustify(['bottom']).vert).toBe('bottom');
  });

  it('reads centre from the absence of a word, on both axes', () => {
    const j = splitJustify([]);

    expect(j.horiz).toBe('center');
    expect(j.vert).toBe('center');
  });

  it('reads all three at once', () => {
    const j = splitJustify(['right', 'bottom', 'mirror']);

    expect(j).toEqual({ horiz: 'right', vert: 'bottom', mirrored: true });
  });

  it('treats a missing token as all defaults', () => {
    expect(splitJustify(undefined)).toEqual({
      horiz: 'center',
      vert: 'center',
      mirrored: false,
    });
  });
});

describe('rebuilding a justify token', () => {
  it('omits both centres, which the file expresses by silence', () => {
    expect(joinJustify('center', 'center', false)).toEqual([]);
  });

  it('writes only the non-default words', () => {
    expect(joinJustify('left', 'center', false)).toEqual(['left']);
    expect(joinJustify('center', 'bottom', false)).toEqual(['bottom']);
  });

  it('keeps mirror alongside the others', () => {
    expect(joinJustify('right', 'top', true)).toEqual(['right', 'top', 'mirror']);
  });

  it('keeps mirror even when both axes are centred', () => {
    // The one case where the token exists but says nothing about alignment.
    expect(joinJustify('center', 'center', true)).toEqual(['mirror']);
  });

  it('round-trips through split for every combination', () => {
    for (const h of ['left', 'center', 'right'] as const)
      for (const vv of ['top', 'center', 'bottom'] as const)
        for (const m of [false, true]) {
          const j = splitJustify(joinJustify(h, vv, m));
          expect(j, `${h}/${vv}/${m}`).toEqual({ horiz: h, vert: vv, mirrored: m });
        }
  });
});
