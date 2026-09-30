// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The five Place > Draw Microwave Shapes rows reach the tool.
 *
 * `menubar_pcb_editor.cpp:294-301` adds `microwaveCreateLine`, `Gap`, `Stub`,
 * `StubArc` and `FunctionShape`, in that order, to a submenu of Place. Each
 * row arms a tool (`h.tool( id )`) and the frame runs `MICROWAVE_TOOL` off that
 * id; nothing in the type system ties the string in the menu module to the
 * table in the frame, so this does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { buildPcbMenus, type PcbMenuState } from '@ziroeda/pcbnew/menubar_pcb_editor.js';
import { PCB_ACTIONS, MICROWAVE_FOOTPRINT_SHAPE } from '@ziroeda/pcbnew/tools/pcb_actions.js';

const STATE: PcbMenuState = {
  selectionCount: 0,
  polygonBooleanCount: 0,
  modifiableLineCount: 0,
  hasSchematic: true,
  hasFootprintEditor: true,
  highContrast: false,
  flipBoard: false,
};

const calls: string[] = [];
const menus = buildPcbMenus(
  {
    action: (id) => calls.push(`action:${id}`),
    tool: (id) => calls.push(`tool:${id}`),
    toggle: (id) => calls.push(`toggle:${id}`),
    language: 'Default',
    onSelectLanguage: () => {},
    showHotkeys: () => {},
    showAbout: () => {},
  },
  STATE,
);
const submenu = (
  menus.find((m) => m.label === 'Place')!.items!.find((i) => i.label === 'Draw Microwave Shapes')!
    .submenu as MenuItem[]
).filter((i) => !i.sep);

const FRAME = readFileSync(resolve(process.cwd(), '../pcbnew/pcb_edit_frame_ui.tsx'), 'utf8');

const ROWS: [string, string, string][] = [
  ['Draw Microwave Lines', 'microwaveCreateLine', 'microwaveCreateLine'],
  ['Draw Microwave Gaps', 'microwaveCreateGap', 'microwaveCreateGap'],
  ['Draw Microwave Stubs', 'microwaveCreateStub', 'microwaveCreateStub'],
  ['Draw Microwave Arc Stubs', 'microwaveCreateStubArc', 'microwaveCreateStubArc'],
  [
    'Draw Microwave Polygonal Shapes',
    'microwaveCreateFunctionShape',
    'microwaveCreateFunctionShape',
  ],
];

describe('Place > Draw Microwave Shapes', () => {
  it('lists the five rows in menubar_pcb_editor.cpp order, each with a label of its action', () => {
    expect(submenu.map((i) => i.label)).toEqual(ROWS.map((r) => r[0]));
    const friendly = [
      PCB_ACTIONS.microwaveCreateLine,
      PCB_ACTIONS.microwaveCreateGap,
      PCB_ACTIONS.microwaveCreateStub,
      PCB_ACTIONS.microwaveCreateStubArc,
      PCB_ACTIONS.microwaveCreateFunctionShape,
    ].map((a) => a.GetFriendlyName());
    expect(submenu.map((i) => i.label)).toEqual(friendly);
  });

  it.each(ROWS)('%s is live and arms tool %s', (label, id) => {
    const row = submenu.find((i) => i.label === label)!;
    expect(row.disabled).toBeFalsy();
    calls.length = 0;
    row.action?.();
    expect(calls).toEqual([`tool:${id}`]);
  });

  it('prints no accelerator: none of the five actions declares a hotkey', () => {
    for (const row of submenu) expect(row.shortcut).toBeUndefined();
  });

  it.each(ROWS)('the frame knows tool %s: status text, click tool, shape table', (_l, id) => {
    // The "Current Tool" pane says the action's friendly name.
    expect(FRAME).toMatch(new RegExp(`\\b${id}: '[^']+',`));
    // The four footprint tools carry their MICROWAVE_FOOTPRINT_SHAPE; the fifth is the inductor.
    if (id !== 'microwaveCreateLine')
      expect(FRAME).toMatch(new RegExp(`\\b${id}: MICROWAVE_FOOTPRINT_SHAPE\\.`));
  });

  it('the frame maps each tool to the shape MICROWAVE_TOOL::setTransitions binds it to', () => {
    const table = /MICROWAVE_PLACE_TOOLS[^=]*=\s*\{([\s\S]*?)\};/.exec(FRAME)![1]!;
    const pairs = [...table.matchAll(/(\w+): MICROWAVE_FOOTPRINT_SHAPE\.(\w+)/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(pairs).toEqual([
      ['microwaveCreateGap', 'GAP'],
      ['microwaveCreateStub', 'STUB'],
      ['microwaveCreateStubArc', 'STUB_ARC'],
      ['microwaveCreateFunctionShape', 'FUNCTION_SHAPE'],
    ]);
    // ...which are the parameters the TOOL_ACTIONs carry.
    expect(PCB_ACTIONS.microwaveCreateGap.MakeEvent().Parameter<MICROWAVE_FOOTPRINT_SHAPE>()).toBe(
      MICROWAVE_FOOTPRINT_SHAPE.GAP,
    );
    expect(
      PCB_ACTIONS.microwaveCreateStubArc.MakeEvent().Parameter<MICROWAVE_FOOTPRINT_SHAPE>(),
    ).toBe(MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC);
  });
});
