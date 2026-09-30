// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tools > Zone Manager... and what `GLOBAL_EDIT_TOOL::ZonesManager`
 * (global_edit_tool.cpp:240-290) does around the dialog.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD, BOARD_LISTENER } from '@ziroeda/pcbnew/board.js';
import { buildPcbMenus } from '@ziroeda/pcbnew/menubar_pcb_editor.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
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
    clearSelection: () => calls.push('clear'),
    fillAllZones: () => calls.push('fillAll'),
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
  const heard: string[] = [];
  board.AddListener(
    new (class extends BOARD_LISTENER {
      override OnBoardItemsChanged(): void {
        heard.push('changed');
      }
    })(),
  );
  calls.length = 0;
  return { f, calls, heard };
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
        selectionCount: 0,
        polygonBooleanCount: 0,
        modifiableLineCount: 0,
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

describe('PCB_EDIT_FRAME.ZonesManager', () => {
  it('cancel leaves everything alone', async () => {
    const t = frame({ ok: false, repour: false });
    await t.f.ZonesManager();
    expect(t.calls).toEqual(['dialog']);
    expect(t.heard).toEqual([]);
  });

  it('OK deselects, marks modified, tells the board its zones changed and pushes no undo entry', async () => {
    const t = frame({ ok: true, repour: false });
    await t.f.ZonesManager();
    expect(t.calls).toEqual(['dialog', 'clear', 'modify']);
    expect(t.heard).toEqual(['changed']);
    expect(t.f.GetUndoCommandCount()).toBe(0);
  });

  it('OK with "Refill zones" ticked then runs zoneFillAll (ZONE_MANAGER_REPOUR)', async () => {
    const t = frame({ ok: true, repour: true });
    await t.f.ZonesManager();
    expect(t.calls.at(-1)).toBe('fillAll');
  });

  it('a frame without the dialog does nothing', async () => {
    const t = frame(null);
    const spy = vi.fn();
    await t.f.ZonesManager().then(spy);
    expect(t.calls).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });
});
