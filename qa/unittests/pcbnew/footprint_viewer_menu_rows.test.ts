// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where KiCad opens the Footprint Library Browser: `ACTIONS::showFootprintBrowser`
 * in pcbnew's View menu (menubar_pcb_editor.cpp:230), the footprint editor's
 * View menu (menubar_footprint_editor.cpp:140) and pcbnew's top toolbar
 * (toolbars_pcb_editor.cpp:346). COMMON_CONTROL::ShowPlayer runs it as
 * `Kiway().Player( FRAME_FOOTPRINT_VIEWER, true )`.
 *
 * The two View rows were greyed. Each is pressed here and its dispatched id
 * followed into the frame that runs it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPcbMenus, type PcbMenuState } from '@ziroeda/pcbnew/menubar_pcb_editor.js';
import {
  footprintEditorMenus,
  type FootprintMenuConditions,
} from '@ziroeda/pcbnew/menubar_footprint_editor.js';
import type { Menu, MenuItem } from '@ziroeda/common/tool/action_menu_types.js';

const find = (menus: Menu[], menu: string, label: string): MenuItem | undefined =>
  menus.find((m) => m.label === menu)?.items.find((i) => i.label === label);

const handlers = (calls: string[]) => ({
  action: (id: string) => calls.push(`action:${id}`),
  tool: (id: string) => calls.push(`tool:${id}`),
  toggle: (id: string) => calls.push(`toggle:${id}`),
  language: 'Default',
  onSelectLanguage: () => {},
  showHotkeys: () => {},
  showAbout: () => {},
});

/** The body of one `case '<id>':` in a frame's action switch. */
function caseBody(file: string, id: string): string {
  const src = readFileSync(resolve(__dirname, '../../../pcbnew', file), 'utf8');
  const at = src.indexOf(`case '${id}':`);
  expect(at, `${file} has a case for ${id}`).toBeGreaterThan(0);
  return src.slice(at, src.indexOf('break;', at));
}

describe("pcbnew's View > Footprint Library Browser", () => {
  const calls: string[] = [];
  const menus = buildPcbMenus(
    handlers(calls),
    {
      selectionCount: 0,
      polygonBooleanCount: 0,
      modifiableLineCount: 0,
      hasSchematic: true,
      hasFootprintEditor: true,
      highContrast: false,
      flipBoard: false,
    } as PcbMenuState,
    {},
  );
  const row = find(menus, 'View', 'Footprint Library Browser');

  it('is live, wears the library_browser icon, and dispatches the toolbar id', () => {
    expect(row).toBeDefined();
    expect(row?.disabled).toBeFalsy();
    expect(row?.icon).toBe('footprintBrowser');
    expect(row?.shortcut).toBeUndefined();
    row?.action?.();
    expect(calls).toEqual(['action:footprintBrowser']);
  });

  it('which the PCB frame runs as Player( FRAME_FOOTPRINT_VIEWER )', () => {
    expect(caseBody('pcb_edit_frame_ui.tsx', 'footprintBrowser')).toMatch(
      /Player\(FRAME_T\.FRAME_FOOTPRINT_VIEWER\)/,
    );
  });
});

describe("the footprint editor's View > Footprint Library Browser", () => {
  const calls: string[] = [];
  const menus = footprintEditorMenus(handlers(calls), {}, {
    haveFootprint: true,
    targetLib: true,
    targetFootprint: true,
    footprintSelectedInTree: true,
    contentModified: true,
    hasItems: true,
    undoAvailable: true,
    redoAvailable: true,
  } as FootprintMenuConditions);
  const row = find(menus, 'View', 'Footprint Library Browser');

  it('is live and dispatches showFootprintBrowser', () => {
    expect(row).toBeDefined();
    expect(row?.disabled).toBeFalsy();
    row?.action?.();
    expect(calls).toEqual(['action:showFootprintBrowser']);
  });

  it('which the footprint editor runs as Player( FRAME_FOOTPRINT_VIEWER )', () => {
    expect(caseBody('footprint_edit_frame_ui.tsx', 'showFootprintBrowser')).toMatch(
      /Player\(FRAME_T\.FRAME_FOOTPRINT_VIEWER\)/,
    );
  });
});
