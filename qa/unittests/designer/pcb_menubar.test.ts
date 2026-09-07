// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board editor's menu bar, against `pcbnew/menubar_pcb_editor.cpp`.
 *
 * `PCB_EDIT_FRAME::doReCreateMenuBar` is 440 lines of `Add()` calls and this is
 * the transcription of them: same menus, same rows, same order, same
 * separators, same submenus. Ours had roughly half of them, and the half that
 * was missing was not the half that is unbuildable — the 3D viewer, Flip Board
 * View, Design Rules Checker, Route Single Track, Measure Tool, Board Setup,
 * Page Settings, Print, Plot and Fill All Zones were all commands this frame
 * already ran from a toolbar button, greyed or absent in the menu a user
 * actually looks in.
 *
 * A source check, because the menus are built inside a 10,000-line component
 * and what is being pinned is the SHAPE: which rows, in which order. A row that
 * quietly moves is exactly the drift this file exists to catch, and it is
 * invisible in a screenshot taken a week later.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
  'utf8',
);

/**
 * The labels of one menu, in order, with `---` for a separator and nesting by
 * indentation depth so a submenu reads as one.
 *
 * Comments are stripped first: several rows carry the upstream label in prose
 * beside them, and a note about a row is not the row.
 */
function rows(menu: string): string[] {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const start = code.indexOf(`label: '${menu}',`);
  expect(start, menu).toBeGreaterThan(-1);
  // Each top-level menu ends where the next one's `label:` begins.
  const next = code.indexOf('\n    {\n      label: ', start);
  const seg = code.slice(start, next === -1 ? code.length : next);

  const out: string[] = [];
  for (const line of seg.split('\n').slice(1)) {
    const m = /label: '([^']+)'/.exec(line);
    const indent = line.length - line.trimStart().length;
    // A submenu's rows are two levels deeper than the menu's own.
    const prefix = indent >= 12 ? '  '.repeat(Math.floor((indent - 8) / 4)) : '';
    if (m) out.push(prefix + m[1]);
    else if (line.includes('sep: true')) out.push(`${prefix}---`);
    else if (line.includes('addQuitOrClose')) out.push('Close');
  }
  return out;
}

describe('File', () => {
  it('is the project-manager branch, row for row', () => {
    // `:54-183`. No New Board / Open... / Open Recent: all three are inside
    // `if( Kiface().IsSingle() )`, which means "launched standalone". Every
    // board here belongs to a project, so this is always the other branch —
    // which is also why the row is Save a Copy and not Save As.
    expect(rows('File')).toEqual([
      'Append Board...',
      '---',
      'Save',
      'Save a Copy...',
      'Revert',
      '---',
      'Rescue',
      '---',
      'Import',
      '  Netlist...',
      '  Specctra Session...',
      '  Graphics...',
      '  Non-KiCad Board File...',
      'Export',
      '  Specctra DSN...',
      '  GenCAD...',
      '  VRML...',
      '  IDFv3...',
      '  STEP/GLB/BREP/XAO/PLY/STL...',
      '  Footprint Association (.cmp) File...',
      '  Hyperlynx...',
      '  ---',
      '  Footprints...',
      'Fabrication Outputs',
      '  Gerbers (.gbr)...',
      '  Drill Files (.drl)...',
      '  IPC-2581 File (.xml)...',
      '  ODB++ Output File...',
      '  Component Placement (.pos, .gbr)...',
      '  Footprint Report (.rpt)...',
      '  IPC-D-356 Netlist File...',
      '  Bill of Materials...',
      '---',
      'Board Setup...',
      '---',
      'Page Settings...',
      'Print...',
      'Plot...',
      '---',
      'Close',
    ]);
  });
});

describe('Edit', () => {
  it('is upstream down to Global Deletions', () => {
    // `:180-211`. Everything after Global Deletions belongs to the SELECTION
    // CONTEXT MENU upstream (`edit_tool.cpp`, `pcb_selection_tool.cpp`) and is
    // here only until the context menu carries it — removing it now would make
    // three working features unreachable.
    const r = rows('Edit');
    expect(r.slice(0, r.indexOf('Global Deletions...') + 1)).toEqual([
      'Undo',
      'Redo',
      '---',
      'Cut',
      'Copy',
      'Paste',
      'Paste Special...',
      'Delete',
      '---',
      'Select',
      '  Select All',
      '  Unselect All',
      '---',
      'Find',
      '---',
      'Edit Track & Via Properties...',
      'Edit Text & Graphics Properties...',
      'Edit Teardrops...',
      'Change Footprints...',
      'Swap Layers...',
      'Grid Origin...',
      '---',
      'Fill All Zones',
      'Unfill All Zones',
      'Update All Tuning Patterns',
      '---',
      'Interactive Delete Tool',
      'Global Deletions...',
    ]);
  });

  it('has no row upstream puts in the context menu instead', () => {
    // These three are the whole of the exception, and each names a
    // `PCB_ACTIONS` that appears in `edit_tool.cpp` / `pcb_selection_tool.cpp`
    // and nowhere in `menubar_pcb_editor.cpp`.
    const extra = rows('Edit').slice(rows('Edit').indexOf('Global Deletions...') + 1);
    expect(extra.filter((r) => r !== '---' && !r.startsWith('  '))).toEqual([
      'Polygons',
      'Modify Lines',
      'Filter Selection...',
    ]);
  });
});

describe('View', () => {
  it('is upstream, submenus and all', () => {
    // `:213-281`.
    expect(rows('View')).toEqual([
      'Panels',
      '  Properties',
      '  Search',
      '  Appearance',
      '  Net Inspector',
      '---',
      'Footprint Library Browser',
      '3D Viewer',
      '---',
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit',
      'Zoom to All Objects',
      'Zoom to Selected Objects',
      'Zoom to Selection Area',
      'Refresh',
      '---',
      'Drawing Mode',
      '  Draw Zone Fills',
      '  Draw Zone Outlines',
      '  ---',
      '  Sketch Pads',
      '  Sketch Vias',
      '  Sketch Tracks',
      '  ---',
      '  Sketch Graphic Items',
      '  Sketch Text Items',
      'Contrast Mode',
      '  Inactive Layer View Mode',
      '  Decrease Layer Opacity',
      '  Increase Layer Opacity',
      'Flip Board View',
    ]);
  });
});

describe('Route and Inspect', () => {
  it('Route is upstream, under the FriendlyNames', () => {
    // `:352-368`. "Route Single Track", not "Single Track".
    expect(rows('Route')).toEqual([
      'Set Layer Pair...',
      '---',
      'Route Single Track',
      'Route Differential Pair',
      '---',
      'Tune Length of a Single Track',
      'Tune Length of a Differential Pair',
      'Tune Skew of a Differential Pair',
      '---',
      'Interactive Router Settings...',
    ]);
  });

  it('Inspect is upstream, and the resolution rows carry no ellipsis', () => {
    // `:371-388`. `inspectClearance`'s FriendlyName is "Clearance Resolution".
    expect(rows('Inspect')).toEqual([
      'Show Board Statistics',
      'Measure Tool',
      '---',
      'Design Rules Checker',
      'Previous Marker',
      'Next Marker',
      'Exclude Marker',
      '---',
      'Clearance Resolution',
      'Constraints Resolution',
      'Show Footprint Associations',
      'Compare Footprint with Library',
    ]);
  });
});

describe('what is left out, and why', () => {
  /**
   * Three blocks upstream builds that this menu does not, and none of them is
   * an omission:
   *
   *   * the generators rows and the Design Blocks panel row sit behind
   *     `ADVANCED_CFG` flags (`m_EnableGenerators`, `m_EnablePcbDesignBlocks`),
   *     so a stock KiCad does not draw them either;
   *   * the Scripting Console is inside `SCRIPTING::IsWxAvailable()`;
   *   * "Reveal Plugin Folder in Finder" opens a folder on a disk.
   *
   * The last two are removed rather than greyed, which is what this repo does
   * with a control the browser cannot have.
   */
  it.each([
    ['Scripting Console'],
    ['Reveal Plugin Folder in Finder'],
    ['Rebuild All Generators'],
    ['Design Blocks'],
  ])('%s is absent', (label) => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain(`label: '${label}'`);
  });
});
