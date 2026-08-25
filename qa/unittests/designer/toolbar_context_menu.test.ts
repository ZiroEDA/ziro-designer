// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOLBAR_CONTEXT_MENU_REGISTRY` — which toolbar buttons carry a right-click
 * menu, and what is on it.
 *
 * Upstream a frame declares one inline while it builds its toolbar
 * (`TOOLBAR_ITEM_REF::WithContextMenu`,
 * `common/tool/ui/toolbar_configuration.cpp:220`) and the factory is filed
 * globally by ACTION NAME, so `ACTION_TOOLBAR::ApplyConfiguration` can find it
 * again when a user-rearranged toolbar is rebuilt from JSON
 * (`common/tool/action_toolbar.cpp:414-419`). Five frames register one:
 *
 *   pl_editor          toggleGrid -> Edit Grids...
 *   schematic editor   toggleGrid -> Edit Grids...
 *   symbol editor      toggleGrid -> Edit Grids...
 *   pcb editor         toggleGrid -> Edit Grids..., Grid Origin...
 *   footprint editor   toggleGrid -> Edit Grids..., Grid Origin...
 *
 * The row labels are the TOOL_ACTIONs' own — `ACTIONS::gridProperties` reads
 * "Edit Grids...", not "Grid Properties", which is only the C++ identifier
 * (`common/tool/actions.cpp:1095-1107`).
 *
 * Ours had no per-button menu in the shared `Toolbar` at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  TOOLBAR_CONTEXT_MENUS,
  toolbarContextMenu,
  toolbarContextMenuRows,
} from '@ziroeda/designer/src/ui/toolbar_context_menu_registry.js';
import {
  COMMON_TOOLBAR_ACTIONS,
  toolbarActionMenuLabel,
  toolbarActionTooltip,
} from '@ziroeda/designer/src/ui/toolbar_actions.js';

/** The exact rows of each frame's registered menu, as the C++ writes them. */
const EXPECTED: Record<string, Record<string, string[]>> = {
  // pagelayout_editor/toolbars_pl_editor.cpp:48-57
  pl_editor: { toggleGrid: ['gridProperties'] },
  // eeschema/toolbars_sch_editor.cpp:71-79
  eeschema: { toggleGrid: ['gridProperties'] },
  // eeschema/symbol_editor/toolbars_symbol_editor.cpp:62-70
  symbol_editor: { toggleGrid: ['gridProperties'] },
  // pcbnew/toolbars_pcb_editor.cpp:149-161
  pcbnew: { toggleGrid: ['gridProperties', 'gridOrigin'] },
  // pcbnew/toolbars_footprint_editor.cpp:53-62
  footprint_editor: { toggleGrid: ['gridProperties', 'gridOrigin'] },
};

describe('the registry matches the five DefaultToolbarConfigs', () => {
  it('files a menu against exactly those frames and buttons', () => {
    const actual = Object.fromEntries(
      Object.entries(TOOLBAR_CONTEXT_MENUS).map(([app, buttons]) => [
        app,
        Object.fromEntries(
          Object.entries(buttons).map(([id, rows]) => [id, rows.map((r) => r.action ?? '---')]),
        ),
      ]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('gives the two PCB frames the Grid Origin row and the other three none', () => {
    // The difference is upstream's, not an oversight: a schematic and a drawing
    // sheet have no movable grid origin, so their lambdas add one row.
    for (const app of ['pl_editor', 'eeschema', 'symbol_editor'])
      expect(toolbarContextMenuRows(app, 'toggleGrid')).toHaveLength(1);
    for (const app of ['pcbnew', 'footprint_editor'])
      expect(toolbarContextMenuRows(app, 'toggleGrid')).toHaveLength(2);
  });

  it('files nothing against a button or an app that has none', () => {
    expect(toolbarContextMenuRows('pl_editor', 'select')).toBeNull();
    expect(toolbarContextMenuRows('gerbview', 'toggleGrid')).toBeNull();
    expect(toolbarContextMenuRows(undefined, 'toggleGrid')).toBeNull();
  });
});

describe('the rows are built the way ACTION_MENU::Add builds them', () => {
  it('labels each row from the TOOL_ACTION, not from a string at the call site', () => {
    const items = toolbarContextMenu('pcbnew', 'toggleGrid', () => {});
    expect(items?.map((i) => i.label)).toEqual(['Edit Grids...', 'Grid Origin...']);
  });

  it('is "Edit Grids...", which is not what the identifier says', () => {
    // `TOOL_ACTION ACTIONS::gridProperties( ... .FriendlyName( _( "Edit Grids..." ) )`
    // — actions.cpp:1095-1098. A menu that read "Grid Properties" would be a
    // string nobody upstream ever wrote.
    expect(COMMON_TOOLBAR_ACTIONS.gridProperties?.name).toBe('Edit Grids...');
    expect(toolbarActionMenuLabel('pl_editor', 'gridProperties')).toBe('Edit Grids...');
  });

  it('carries the action`s help string as the row`s tooltip', () => {
    // `.Tooltip( _( "Edit grid definitions" ) )` / `_( "Set the grid origin point" )`
    // — the third argument of the wxMenuItem in action_menu.cpp:188.
    expect(toolbarActionTooltip('pl_editor', 'gridProperties')).toBe('Edit grid definitions');
    expect(toolbarActionTooltip('pcbnew', 'gridOrigin')).toBe('Set the grid origin point');
    const items = toolbarContextMenu('pcbnew', 'toggleGrid', () => {});
    expect(items?.map((i) => i.tooltip)).toEqual([
      'Edit grid definitions',
      'Set the grid origin point',
    ]);
  });

  it('dispatches the row`s own action, not the button`s', () => {
    const ran: string[] = [];
    const items = toolbarContextMenu('pl_editor', 'toggleGrid', (id) => ran.push(id));
    items?.[0]?.action?.();
    expect(ran).toEqual(['gridProperties']);
  });

  it('greys a row whose action the frame has disabled', () => {
    // One ACTION_CONDITIONS answers for the button and the menu row alike, so
    // the frame's own disabled set is what `Toolbar` feeds this.
    const items = toolbarContextMenu('pcbnew', 'toggleGrid', () => {}, {
      disabled: (id) => id === 'gridOrigin',
    });
    expect(items?.map((i) => !!i.disabled)).toEqual([false, true]);
  });

  it('returns null rather than an empty menu for an unregistered button', () => {
    expect(toolbarContextMenu('pl_editor', 'select', () => {})).toBeNull();
  });
});

/**
 * The call sites.
 *
 * The registry is looked up by APP, and the app is a prop the frame passes to
 * its `<Toolbar>`. A frame that stops passing it loses the whole menu with no
 * test failing anywhere else, and a frame that never handles the row's action
 * shows a menu entry that does nothing. Both are one line, and both are exactly
 * the shape of regression a sweep put back into a call site last month.
 *
 * Read as text because these are `.tsx` and `qa`'s tsc compiles `.ts` only.
 * Rendering the widget itself is covered by
 * `toolbar_context_menu_render.test.tsx`; what is per-file here — one left
 * toolbar per editor — is what a per-file check can see.
 */
const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Each frame that registers a grid menu, and the file that mounts its toolbar. */
const CALL_SITES: [app: string, file: string][] = [
  ['pl_editor', 'editors/drawingsheet/DrawingSheetEditor.tsx'],
  ['eeschema', 'editors/schematic/SchematicEditor.tsx'],
  ['symbol_editor', 'editors/symbol/SymbolEditor.tsx'],
  ['pcbnew', 'editors/pcb/PcbEditor.tsx'],
  ['footprint_editor', 'editors/footprint/FootprintEditor.tsx'],
];

describe('every frame with a registered menu is wired to receive it', () => {
  it.each(CALL_SITES)('%s names itself on the toolbar that carries the button', (app, rel) => {
    expect(read(rel)).toContain(`app="${app}"`);
  });

  it.each(CALL_SITES)('%s dispatches the menu`s action', (_app, rel) => {
    // The row runs through the frame's own `onActivate`, so the frame has to
    // answer for an id that is on no button of its own.
    expect(read(rel)).toMatch(/id === 'gridProperties'/);
  });

  it('every app in the registry has a call site listed here', () => {
    expect(CALL_SITES.map(([a]) => a).sort()).toEqual(Object.keys(TOOLBAR_CONTEXT_MENUS).sort());
  });
});
