// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window's hierarchy helpers beside SCH_NAVIGATE_TOOL (sch_navigate_tool.cpp): the
 * depth-first order Previous/Next follow, a file's first instance, and an instance's parent.
 * The Back/Forward history itself is the live tool's (sch_navigate_history.test.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  firstInstanceOf,
  flattenHierarchy,
  parentPath,
} from '@ziroeda/eeschema/tools/sch_navigate_tool.js';
import type { SheetTreeNode } from '@ziroeda/eeschema';

// Page numbers are the ones SetInitialPageNumbers would seed: a depth-first
// walk numbered from the root. flattenHierarchy follows child order, not the
// page number, so they only have to be present and consistent.
const tree: SheetTreeNode = {
  file: 'root.kicad_sch',
  name: 'Root',
  path: '/',
  page: '1',
  children: [
    {
      file: 'power.kicad_sch',
      name: 'Power',
      path: '/a/',
      page: '2',
      children: [{ file: 'reg.kicad_sch', name: 'Reg', path: '/a/c/', page: '3', children: [] }],
    },
    { file: 'io.kicad_sch', name: 'IO', path: '/b/', page: '4', children: [] },
  ],
};

describe('flattenHierarchy', () => {
  it('is depth-first, KiCad virtual page number order', () => {
    expect(flattenHierarchy(tree).map((s) => s.path)).toEqual(['/', '/a/', '/a/c/', '/b/']);
  });
});

/**
 * MAIL_SCH_NAVIGATE_TO_SHEET's search: a sub-sheet opened from the project tree lands on the
 * first sheet in Hierarchy() order using that file. 10-28: it opened the sub-sheet's drawing on
 * the ROOT's path, so the Schematic Hierarchy highlighted the root.
 */
describe('firstInstanceOf', () => {
  // reg.kicad_sch is used twice (a complex hierarchy): under Power, and again under IO.
  const complex: SheetTreeNode = {
    ...tree,
    children: [
      tree.children[0]!,
      {
        ...tree.children[1]!,
        children: [{ file: 'reg.kicad_sch', name: 'Reg2', path: '/b/d/', page: '5', children: [] }],
      },
    ],
  };

  it("is the sheet's own path for a file used once", () => {
    expect(firstInstanceOf(tree, 'io.kicad_sch')).toBe('/b/');
    expect(firstInstanceOf(tree, 'reg.kicad_sch')).toBe('/a/c/');
  });

  it('is the first instance in hierarchy order for a file used more than once', () => {
    expect(firstInstanceOf(complex, 'reg.kicad_sch')).toBe('/a/c/');
  });

  it('is the root for the root file, and nothing for a file no sheet uses', () => {
    expect(firstInstanceOf(tree, 'root.kicad_sch')).toBe('/');
    expect(firstInstanceOf(tree, 'orphan.kicad_sch')).toBeNull();
  });
});

describe('parentPath', () => {
  it('pops the last instance segment; the root has no parent', () => {
    expect(parentPath('/a/c/')).toBe('/a/');
    expect(parentPath('/a/')).toBe('/');
    expect(parentPath('/')).toBeNull();
  });
});
