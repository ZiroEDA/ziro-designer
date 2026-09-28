// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_DATAVIEWCTRL`'s tree walks (common/widgets/wx_dataviewctrl.cpp:23-133),
 * which LIB_TREE's Up and Down keys call.
 */
import { describe, expect, it } from 'vitest';
import {
  GetNextItem,
  GetNextSibling,
  GetPrevItem,
  GetPrevSibling,
  type WX_DATAVIEW_MODEL,
} from '@ziroeda/common/widgets/wx_dataviewctrl.js';

// A (open) > a1, a2 (open) > u1, u2 ; B (closed) > b1 ; C
const tree: Record<string, string[]> = {
  '': ['A', 'B', 'C'],
  A: ['a1', 'a2'],
  a2: ['u1', 'u2'],
  B: ['b1'],
};
const parentOf = new Map<string, string | null>();
for (const [p, kids] of Object.entries(tree))
  for (const k of kids) parentOf.set(k, p === '' ? null : p);
const open = new Set(['A', 'a2']);

const model: WX_DATAVIEW_MODEL<string> = {
  GetParent: (n) => parentOf.get(n) ?? null,
  GetChildren: (n) => tree[n ?? ''] ?? [],
  IsExpanded: (n) => open.has(n),
};

describe('WX_DATAVIEWCTRL', () => {
  it('siblings stop at the ends', () => {
    expect(GetPrevSibling(model, 'A')).toBeNull();
    expect(GetNextSibling(model, 'C')).toBeNull();
    expect(GetNextSibling(model, 'a1')).toBe('a2');
  });

  it('GetNextItem: first top-level with no item, into an open node, else up and over', () => {
    expect(GetNextItem(model, null)).toBe('A');
    expect(GetNextItem(model, 'A')).toBe('a1');
    expect(GetNextItem(model, 'u2')).toBe('B');
    expect(GetNextItem(model, 'B')).toBe('C');
    expect(GetNextItem(model, 'C')).toBeNull();
  });

  it('GetPrevItem: the parent from a first child, and ONE level into an open sibling', () => {
    expect(GetPrevItem(model, 'a1')).toBe('A');
    expect(GetPrevItem(model, 'A')).toBeNull();
    expect(GetPrevItem(model, 'u1')).toBe('a2');
    // B's previous sibling A is open: its last child a2 - not a2's last unit
    // u2, although a2 is open too. Upstream descends one level only.
    expect(GetPrevItem(model, 'B')).toBe('a2');
  });
});
