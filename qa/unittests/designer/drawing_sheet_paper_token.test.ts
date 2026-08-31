// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `${PAPER}` in a drawing sheet is the page TYPE, and nothing else.
 *
 *     m_paperFormat = aPageInfo.GetTypeAsString();   (ds_draw_item.cpp:552)
 *
 * Both renderers passed the document's whole `(paper …)` value through instead.
 * For "A4" the two are the same string, which is why this went unnoticed; for a
 * custom page they are not, and the default sheet's "Size: ${PAPER}" cell —
 * 109 mm along a row that puts "Date:" at 122 (`default-sheet.ts:158`) — ran
 * "Size: User 152.4000 127.0000" straight across the date beside it.
 */
import { describe, expect, it } from 'vitest';
import { paperTypeName } from '@ziroeda/common';

describe('the paper token is the type name', () => {
  it.each([
    ['A4', 'A4'],
    ['USLetter', 'USLetter'],
    // A custom page carries its size in the same node.
    ['User 152.4000 127.0000', 'User'],
    ['A4 portrait', 'A4'],
  ])('%s -> %s', (paper, expected) => {
    expect(paperTypeName(paper)).toBe(expected);
  });

  it('has something to say about a document with no paper node', () => {
    expect(paperTypeName(undefined)).toBe('');
  });
});
