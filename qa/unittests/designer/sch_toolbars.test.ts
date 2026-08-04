// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic editor's three toolbars. Counterpart:
 * `SCH_EDIT_FRAME::configureToolbars` (eeschema/toolbars_sch_editor.cpp), which
 * declares the top, left and right toolbar contents in order.
 *
 * Testable for the same reason the menubar now is — `toolbar_types.ts` splits
 * the data types out of `Toolbar.tsx`, which `qa`'s tsconfig cannot compile.
 * Together with `sch_menubar.test.ts` this is the other half of #74.
 */
import { describe, it, expect } from 'vitest';
import {
  TOP_TOOLBAR,
  LEFT_TOOLBAR,
  RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import { TOOL_HOTKEYS } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import type { ToolButton, ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';

/** Every button, groups flattened; controls and separators contribute none. */
const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) => (e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e ? [] : [e]));

const ids = (entries: readonly ToolEntry[]): string[] => buttons(entries).map((b) => b.id);

describe('the top toolbar', () => {
  it('opens with the file and edit actions, in upstream order', () => {
    expect(ids(TOP_TOOLBAR).slice(0, 10)).toEqual([
      'save',
      'schematicSetup',
      'pageSettings',
      'print',
      'plot',
      'paste',
      'undo',
      'redo',
      'find',
      'findReplace',
    ]);
  });

  it('carries the zoom, navigation and transform blocks', () => {
    for (const id of ['zoomIn', 'zoomOut', 'zoomFit', 'navBack', 'rotateCCW', 'mirrorV']) {
      expect(ids(TOP_TOOLBAR)).toContain(id);
    }
  });

  it('ends with the cross-editor actions', () => {
    for (const id of ['annotate', 'erc', 'assignFootprints', 'editSymbolFields', 'bom']) {
      expect(ids(TOP_TOOLBAR)).toContain(id);
    }
  });
});

describe('the left toolbar is the display toggles', () => {
  it('has the grid, units, cursor and line-mode groups', () => {
    for (const id of [
      'toggleGrid',
      'unitsInches',
      'unitsMils',
      'unitsMm',
      'crosshairSmall',
      'lineModeFree',
      'lineMode90',
      'lineMode45',
    ]) {
      expect(ids(LEFT_TOOLBAR)).toContain(id);
    }
  });
});

describe('the right toolbar is the drawing tools', () => {
  it('offers every tool the Place menu does', () => {
    for (const id of [
      'placeSymbol',
      'placePower',
      'drawWire',
      'drawBus',
      'busEntry',
      'noConnect',
      'junction',
      'placeLabel',
      'placeHierLabel',
      'drawSheet',
      'placeText',
      'delete',
    ]) {
      expect(ids(RIGHT_TOOLBAR)).toContain(id);
    }
  });

  it('every single-key hotkey names a tool that is actually on it', () => {
    // TOOL_HOTKEYS is what the canvas dispatches on. A key pointing at an id no
    // toolbar carries is a hotkey that silently activates nothing.
    const right = new Set(ids(RIGHT_TOOLBAR));
    for (const [key, tool] of Object.entries(TOOL_HOTKEYS)) {
      expect({ key, tool, present: right.has(tool) }).toEqual({ key, tool, present: true });
    }
  });
});

describe('no button is silently inert', () => {
  it('every id is unique within its toolbar', () => {
    for (const tb of [TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR]) {
      const list = ids(tb);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('every button has an icon and a title', () => {
    // A button with no title has no tooltip, which upstream always provides.
    for (const tb of [TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR]) {
      for (const b of buttons(tb)) {
        expect({ id: b.id, icon: !!b.icon, title: !!b.title }).toEqual({
          id: b.id,
          icon: true,
          title: true,
        });
      }
    }
  });

  it('the greyed-out set is exactly the unbuilt features', () => {
    // Pinned like the menubar's: implementing one of these and forgetting to
    // drop `disabled` leaves it unreachable with nothing to notice.
    const greyed = [TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR].flatMap((tb) =>
      buttons(tb)
        .filter((b) => b.disabled)
        .map((b) => b.id),
    );
    expect(greyed).toEqual([
      'simulator',
      'drawRuleArea',
      'syncAllSheetsPins',
      'ellipse',
      'ellipseArc',
    ]);
  });
});
