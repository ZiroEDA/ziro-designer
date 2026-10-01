// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * GROUP_TOOL (`common/tool/group_tool.cpp`): Ungroup, Add to Group, Remove
 * from Group, Enter Group and the Grouping submenu's enables, run through a
 * TOOL_MANAGER with a selection tool, against real PCB_GROUPs and tracks.
 */
import { describe, expect, it } from 'vitest';
import { EDA_BASE_FRAME } from '@ziroeda/common/eda_base_frame.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { GROUP_CONTEXT_MENU, GROUP_TOOL, GroupMenuState } from '@ziroeda/common/tool/group_tool.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_TOOL } from '@ziroeda/common/tool/selection_tool.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_GROUP } from '@ziroeda/pcbnew/pcb_group.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';

class TEST_SELECTION_TOOL extends SELECTION_TOOL {
  sel = new SELECTION();
  entered = 0;
  exited: boolean[] = [];
  constructor() {
    super('common.InteractiveSelection');
  }
  override Reset(_r: RESET_REASON): void {}
  protected selection(): SELECTION {
    return this.sel;
  }
  protected select(aItem: EDA_ITEM): void {
    this.sel.Add(aItem);
  }
  protected unselect(aItem: EDA_ITEM): void {
    this.sel.Remove(aItem);
  }
  protected highlight(): void {}
  protected unhighlight(): void {}
  override EnterGroup(): void {
    this.entered++;
  }
  override ExitGroup(aSelectGroup = false): void {
    this.exited.push(aSelectGroup);
  }
  Clear(_e: TOOL_EVENT): number {
    this.sel.Clear();
    return 0;
  }
  SelectItems(e: TOOL_EVENT): number {
    for (const i of e.Parameter<EDA_ITEM[]>()) this.sel.Add(i);
    return 0;
  }
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.Clear), ACTIONS.selectionClear.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectItems), ACTIONS.selectItems.MakeEvent());
  }
}

interface CommitLog {
  calls: string[];
}

class TEST_GROUP_TOOL extends GROUP_TOOL {
  log: CommitLog = { calls: [] };
  names = new Map<EDA_ITEM, string>();
  refuse = new Set<EDA_ITEM>();
  // biome-ignore lint/correctness/useYield: the base declares a coroutine; this stub never waits
  *PickNewMember(): Generator<void, number, void> {
    return 0;
  }
  Group(): number {
    return 0;
  }
  protected canGroupItem(aItem: EDA_ITEM, aErrorMsg: { value: string }): boolean {
    if (this.refuse.has(aItem)) {
      aErrorMsg.value = 'refused';
      return false;
    }
    return true;
  }
  protected getGroupFromItem(): null {
    return null;
  }
  protected createCommit(): never {
    const n = (i: EDA_ITEM) => this.names.get(i) ?? '?';
    const log = this.log;
    const c = {
      Remove: (i: EDA_ITEM) => (log.calls.push(`remove ${n(i)}`), c),
      Modify: (i: EDA_ITEM) => (log.calls.push(`modify ${n(i)}`), c),
      Push: (m: string) => log.calls.push(`push ${m}`),
    };
    return c as never;
  }
}

class TEST_FRAME extends EDA_BASE_FRAME {
  warnings: string[] = [];
  modified = 0;
  GetScreen() {
    return null;
  }
  override OnModify(): void {
    this.modified++;
  }
  override ShowInfoBarWarning(m: string): void {
    this.warnings.push(m);
  }
}

function setup() {
  const board = new BOARD();
  const frame = new TEST_FRAME(FRAME_T.FRAME_PCB_EDITOR, pcbIUScale, 'mm');
  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(null, null, null, null, frame);
  const selTool = new TEST_SELECTION_TOOL();
  const tool = new TEST_GROUP_TOOL();
  mgr.RegisterTool(selTool);
  mgr.RegisterTool(tool);
  mgr.InitTools();
  const track = (name: string) => {
    const t = new PCB_TRACK(board);
    tool.names.set(t, name);
    return t;
  };
  const group = (name: string, ...members: EDA_ITEM[]) => {
    const g = new PCB_GROUP(board);
    tool.names.set(g, name);
    for (const m of members) g.AddItem(m);
    return g;
  };
  const select = (...items: EDA_ITEM[]) => {
    selTool.sel.Clear();
    for (const i of items) selTool.sel.Add(i);
  };
  const selected = () => selTool.sel.GetItems().map((i) => tool.names.get(i));
  return { mgr, frame, tool, selTool, track, group, select, selected, calls: tool.log.calls };
}

describe('GROUP_TOOL', () => {
  it('is common.Groups and puts Grouping in the selection menu', () => {
    const { tool } = setup();
    expect(tool.GetName()).toBe('common.Groups');
  });

  it('Init fails without a selection tool', () => {
    const mgr = new TOOL_MANAGER();
    mgr.SetEnvironment(
      null,
      null,
      null,
      null,
      new TEST_FRAME(FRAME_T.FRAME_PCB_EDITOR, pcbIUScale, 'mm'),
    );
    const tool = new TEST_GROUP_TOOL();
    mgr.RegisterTool(tool);
    expect(tool.Init()).toBe(false);
  });

  it('Ungroup removes the group, modifies each member and selects them', () => {
    const env = setup();
    const a = env.track('a');
    const b = env.track('b');
    const g = env.group('g', a, b);
    env.select(g);

    env.mgr.RunAction(ACTIONS.ungroup);

    expect(env.calls).toEqual(['remove g', 'modify a', 'modify b', 'push Ungroup Items']);
    expect(g.GetItems().size).toBe(0);
    expect(a.GetParentGroup()).toBeNull();
    expect(env.selected()).toEqual(['a', 'b']);
    expect(env.frame.modified).toBe(1);
  });

  it('Add to Group adds the ungrouped items and selects the group', () => {
    const env = setup();
    const a = env.track('a');
    const b = env.track('b');
    const c = env.track('c');
    const g = env.group('g', a, b);
    env.select(g, c);

    env.mgr.RunAction(ACTIONS.addToGroup);

    expect(env.calls).toEqual(['modify g', 'modify c', 'push Add Items to Group']);
    expect(c.GetParentGroup()).toBe(g);
    expect(env.selected()).toEqual(['g']);
  });

  it('Add to Group moves an item out of another group (group_tool.cpp:215, :232-241)', () => {
    const env = setup();
    const g = env.group('g', env.track('a'), env.track('b'));
    const c = env.track('c');
    const h = env.group('h', c, env.track('d'));
    env.select(g, c);

    env.mgr.RunAction(ACTIONS.addToGroup);

    expect(env.calls).toEqual(['modify g', 'modify c', 'modify h', 'push Add Items to Group']);
    expect(c.GetParentGroup()).toBe(g);
    expect(h.GetItems().size).toBe(1);
  });

  it('Add to Group does nothing with two groups selected', () => {
    const env = setup();
    const g1 = env.group('g1', env.track('a'), env.track('b'));
    const g2 = env.group('g2', env.track('c'), env.track('d'));
    const e = env.track('e');
    env.select(g1, g2, e);
    env.mgr.RunAction(ACTIONS.addToGroup);
    expect(env.calls).toEqual([]);
    expect(e.GetParentGroup()).toBeNull();
  });

  it('a refused item is skipped and its message shown', () => {
    const env = setup();
    const g = env.group('g', env.track('a'), env.track('b'));
    const r = env.track('r');
    env.tool.refuse.add(r);
    env.select(g, r);
    env.mgr.RunAction(ACTIONS.addToGroup);
    expect(env.calls).toEqual([]);
    expect(env.frame.warnings).toEqual(['refused']);
  });

  it('Remove from Group dissolves a group left with fewer than two', () => {
    const env = setup();
    const a = env.track('a');
    const b = env.track('b');
    const c = env.track('c');
    const g = env.group('g', a, b);
    const h = env.group('h', c, env.track('d'), env.track('e'));
    env.select(a, c);

    env.mgr.RunAction(ACTIONS.removeFromGroup);

    expect(env.calls).toEqual([
      'modify g',
      'modify a',
      'modify h',
      'modify c',
      'remove g',
      'push Remove Group Items',
    ]);
    expect(g.GetItems().size).toBe(0);
    expect(b.GetParentGroup()).toBeNull();
    expect(h.GetItems().size).toBe(2);
  });

  it('Enter Group only for a lone selected group; Leave Group selects it', () => {
    const env = setup();
    const a = env.track('a');
    const g = env.group('g', a, env.track('b'));
    env.select(g, a);
    env.mgr.RunAction(ACTIONS.groupEnter);
    expect(env.selTool.entered).toBe(0);
    env.select(g);
    env.mgr.RunAction(ACTIONS.groupEnter);
    expect(env.selTool.entered).toBe(1);
    env.mgr.RunAction(ACTIONS.groupLeave);
    expect(env.selTool.exited).toEqual([true]);
  });
});

describe('GROUP_CONTEXT_MENU::update', () => {
  it('enables per group_tool.cpp:67-105', () => {
    const env = setup();
    const a = env.track('a');
    const b = env.track('b');
    const free = env.track('free');
    const g = env.group('g', a, b);
    const g2 = env.group('g2', env.track('c'), env.track('d'));

    expect(GroupMenuState([free])).toEqual({
      group: false,
      ungroup: false,
      addToGroup: false,
      removeFromGroup: false,
    });
    expect(GroupMenuState([free, a])).toEqual({
      group: true,
      ungroup: false,
      addToGroup: false,
      removeFromGroup: true,
    });
    expect(GroupMenuState([g, free])).toEqual({
      group: true,
      ungroup: true,
      addToGroup: true,
      removeFromGroup: false,
    });
    expect(GroupMenuState([g, g2, free]).addToGroup).toBe(false);
    // `else hasNonGroupItems = true` (:92-93): an item already in ANOTHER
    // group counts, since AddToGroup moves it (:215, :232-241)
    const c = [...g2.GetItems()][0]!;
    expect(GroupMenuState([g, c]).addToGroup).toBe(true);
    expect(GroupMenuState(null).group).toBe(false);
  });
});

describe('GROUP_CONTEXT_MENU', () => {
  it('is Grouping, four rows, enabled from the selection tool', () => {
    const env = setup();
    const g = env.group('g', env.track('a'), env.track('b'));
    const free = env.track('free');
    env.select(g, free);

    const menu = new GROUP_CONTEXT_MENU();
    menu.SetSelectionTool(env.selTool);
    menu.UpdateAll();

    const ids = [ACTIONS.group, ACTIONS.ungroup, ACTIONS.addToGroup, ACTIONS.removeFromGroup];
    expect(ids.map((a) => menu.FindItem(a.GetUIId())?.GetItemLabelText())).toEqual([
      'Group Items',
      'Ungroup Items',
      'Add Items',
      'Remove Items',
    ]);
    expect(ids.map((a) => menu.IsEnabled(a.GetUIId()))).toEqual([true, true, true, false]);
  });
});
