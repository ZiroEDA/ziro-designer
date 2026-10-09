// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tools > Zone Manager... and what `GLOBAL_EDIT_TOOL::ZonesManager`
 * (global_edit_tool.cpp:240-290) does around the dialog.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD, BOARD_LISTENER } from '@ziroeda/pcbnew/board.js';
import { buildPcbMenus } from '@ziroeda/pcbnew/menubar_pcb_editor.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';

beforeAll(() => {
  installPgm();
});

function frame(answer: { ok: boolean; repour: boolean } | null) {
  const calls: string[] = [];
  const settings = new PCBNEW_SETTINGS();
  const hooks = {
    settings: () => settings,
    onModify: () => calls.push('modify'),
    ...(answer
      ? {
          showZoneManager: async () => {
            calls.push('dialog');
            return answer;
          },
        }
      : {}),
    // PROPERTIES_TOOL hears the selection tool's ClearedEvent
    updateProperties: () => calls.push('clear'),
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const f = new PCB_EDIT_FRAME(hooks);
  const board = new BOARD();
  const z = new ZONE(board);
  for (const p of [
    { x: 0, y: 0 },
    { x: 1e6, y: 0 },
    { x: 1e6, y: 1e6 },
  ])
    z.AppendCorner(p, -1);
  z.SetLayer(PCB_LAYER_ID.F_Cu);
  board.Add(z);
  f.SetBoard(board);
  // A selected zone, so ZonesManager's `selectionClear` has something to clear.
  f.GetSelectionTool().AddItemToSel(z, true);
  const heard: string[] = [];
  board.AddListener(
    new (class extends BOARD_LISTENER {
      override OnBoardItemsChanged(): void {
        heard.push('changed');
      }
    })(),
  );
  calls.length = 0;
  return { f, calls, heard, z };
}

describe('Tools > Zone Manager...', () => {
  it('is a live row that runs the zonesManager action', () => {
    const acts: string[] = [];
    const menus = buildPcbMenus(
      {
        action: (id) => acts.push(id),
        tool: () => {},
        toggle: () => {},
        language: 'Default',
        onSelectLanguage: () => {},
        showHotkeys: () => {},
        showAbout: () => {},
      },
      {
        hasSchematic: true,
        hasFootprintEditor: true,
        highContrast: false,
        flipBoard: false,
      },
    );
    const row = menus
      .find((m) => m.label === 'Tools')!
      .items!.find((i: MenuItem) => i.label === 'Zone Manager...')!;
    expect(row.disabled).toBeFalsy();
    row.action?.();
    expect(acts).toEqual(['zonesManager']);
  });
});

/** The zonesManager action on the board editor's tool manager: GLOBAL_EDIT_TOOL::ZonesManager. */
async function run(t: { f: PCB_EDIT_FRAME }): Promise<void> {
  t.f.GetToolManager()!.RunAction(PCB_ACTIONS.zonesManager);
  await new Promise((r) => setTimeout(r, 0));
}

describe('GLOBAL_EDIT_TOOL::ZonesManager on the board editor', () => {
  it('cancel leaves everything alone', async () => {
    const t = frame({ ok: false, repour: false });
    await run(t);
    expect(t.calls).toEqual(['dialog']);
    expect(t.heard).toEqual([]);
  });

  it('OK deselects, marks modified, tells the board its zones changed and pushes no undo entry', async () => {
    const t = frame({ ok: true, repour: false });
    await run(t);
    expect(t.calls).toEqual(['dialog', 'clear', 'modify']);
    expect(t.heard).toEqual(['changed']);
    expect(t.f.GetUndoCommandCount()).toBe(0);
  });

  it('OK with "Refill zones" ticked then runs zoneFillAll (ZONE_MANAGER_REPOUR)', async () => {
    const t = frame({ ok: true, repour: true });
    await run(t);
    // ZONE_FILLER_TOOL, registered on the frame, poured the board.
    expect(t.z.IsFilled()).toBe(true);
  });

  it('a frame without the dialog does nothing', async () => {
    const t = frame(null);
    await run(t);
    expect(t.calls).toEqual([]);
  });
});

describe('PCB_EDIT_FRAME::m_ZoneFillsDirty (pcb_edit_frame.cpp:234, :2087)', () => {
  it('starts dirty, and every OnModify marks it dirty again', () => {
    const t = frame(null);
    expect(t.f.m_ZoneFillsDirty).toBe(true);
    t.f.m_ZoneFillsDirty = false;
    t.f.OnModify();
    expect(t.f.m_ZoneFillsDirty).toBe(true);
  });
});

describe("DIALOG_ZONE_MANAGER::OnUpdateDisplayedZonesClick's pour (dialog_zone_manager.cpp:495-519)", () => {
  it('fills the clones with the board zone list swapped for them, then puts the originals back', () => {
    const t = frame(null);
    const board = t.f.GetBoard()!;
    const clone = t.z.Clone() as ZONE;

    expect(t.f.FillZones(board, [clone])).toBe(true);

    expect(clone.IsFilled()).toBe(true);
    expect(clone.GetFilledPolysList(PCB_LAYER_ID.F_Cu).OutlineCount()).toBe(1);
    // The board's own zone is untouched and back in the list.
    expect(t.z.IsFilled()).toBe(false);
    expect(board.Zones()).toHaveLength(1);
    expect(board.Zones()[0]).toBe(t.z);
    // "Do not use a commit here since we're operating on cloned zones."
    expect(t.f.GetUndoCommandCount()).toBe(0);
  });
});
