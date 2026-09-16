// The tool framework (issue 636, stage 2): TOOL_MANAGER, TOOL_INTERACTIVE
// over generator coroutines, ACTION_MANAGER's registry and hotkeys, COMMIT's
// staging and PICKED_ITEMS_LIST. The expectations are the C++'s contract:
// what RegisterTool/InitTools do, how a handler runs, waits and resumes on
// the events its transitions name, which action a hotkey runs, and what a
// commit stages for an add, a remove and a modify.
import { describe, expect, it } from 'vitest';
import { CHANGE_TYPE, COMMIT } from '@ziroeda/common/src/commit.js';
import { EDA_ITEM, type INSPECTOR, INSPECT_RESULT } from '@ziroeda/common/src/eda_item.js';
import { ACTIONS } from '@ziroeda/common/src/tool/actions.js';
import { ACTION_MANAGER } from '@ziroeda/common/src/tool/action_manager.js';
import {
  TOOL_ACTION,
  TOOL_ACTION_ARGS,
  TOOL_ACTION_FLAGS,
  TOOL_ACTION_SCOPE,
} from '@ziroeda/common/src/tool/tool_action.js';
import { RESET_REASON } from '@ziroeda/common/src/tool/tool_base.js';
import {
  MD_CTRL,
  TOOL_ACTIONS,
  TOOL_EVENT,
  TOOL_EVENT_CATEGORY,
  TOOL_MOUSE_BUTTONS,
} from '@ziroeda/common/src/tool/tool_event.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/src/tool/tool_interactive.js';
import { TOOL_MANAGER } from '@ziroeda/common/src/tool/tool_manager.js';
import { TOOLS_HOLDER } from '@ziroeda/common/src/tool/tools_holder.js';
import {
  ITEM_PICKER,
  PICKED_ITEMS_LIST,
  UNDO_REDO,
} from '@ziroeda/common/src/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { WXK } from '@ziroeda/core/src/wx_keycodes.js';
import type { KICAD_T as KT } from '@ziroeda/core/src/typeinfo.js';

/** A bare EDA_ITEM for the commit: `KI_TEST`'s items are board items; this needs only Clone. */
class DUMMY_ITEM extends EDA_ITEM {
  value = 0;
  constructor() {
    super(null, KICAD_T.NOT_USED);
  }
  override GetClass(): string {
    return 'DUMMY_ITEM';
  }
  override Clone(): EDA_ITEM {
    const c = new DUMMY_ITEM();
    c.value = this.value;
    return c;
  }
  override Visit(_i: INSPECTOR, _d: unknown, _t: readonly KT[]): INSPECT_RESULT {
    return INSPECT_RESULT.CONTINUE;
  }
}

/** `KI_TEST::DUMMY_TOOL`'s shape, plus a handler that counts what it sees. */
class COUNTING_TOOL extends TOOL_INTERACTIVE {
  static readonly ping = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('test.Counting.ping')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + 'P'.charCodeAt(0)),
  );
  static readonly run = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      // an activation action is named for its tool, as ACTIONS::measureTool is 'common.InteractiveMeasureTool'
      .Name('test.Counting')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F12)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  pings = 0;
  clicksSeen: number[] = [];
  finished = false;
  resets: RESET_REASON[] = [];

  constructor() {
    super('test.Counting');
  }

  Reset(aReason: RESET_REASON): void {
    this.resets.push(aReason);
  }

  // biome-ignore lint/correctness/useYield: a handler that never waits is still a coroutine
  *onPing(_aEvent: TOOL_EVENT) {
    this.pings++;
    return 0;
  }

  /** An interactive handler: waits for clicks, leaves on cancel. */
  *runLoop(_aEvent: TOOL_EVENT) {
    while (true) {
      const evt = yield* this.Wait();
      if (!evt) break;
      if (evt.IsCancelInteractive()) break;
      if (evt.IsClick(TOOL_MOUSE_BUTTONS.BUT_LEFT)) this.clicksSeen.push(evt.Position().x);
    }
    this.finished = true;
    return 0;
  }

  protected setTransitions(): void {
    this.Go(this.onPing, COUNTING_TOOL.ping.MakeEvent());
    this.Go(this.runLoop, COUNTING_TOOL.run.MakeEvent());
  }
}

class TEST_HOLDER extends TOOLS_HOLDER {
  GetToolCanvas(): unknown {
    return null;
  }
}

function makeManager(): { mgr: TOOL_MANAGER; tool: COUNTING_TOOL } {
  const mgr = new TOOL_MANAGER();
  const holder = new TEST_HOLDER();
  mgr.SetEnvironment(null, null, null, null, holder);
  const tool = new COUNTING_TOOL();
  mgr.RegisterTool(tool);
  mgr.InitTools();
  return { mgr, tool };
}

describe('ACTION_MANAGER', () => {
  it('every ACTIONS static is in the registry, once, with a unique id once a manager exists', () => {
    // ids are -1 until an ACTION_MANAGER is built; its constructor assigns them
    makeManager();
    const list = ACTION_MANAGER.GetActionList();
    const names = list.map((a) => a.GetName());
    expect(names).toContain('common.Interactive.undo');
    expect(names).toContain(ACTIONS.zoomInCenter.GetName());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(list.map((a) => a.GetId())).size).toBe(list.length);
  });

  it('a hotkey runs the action it is bound to, through the tool that handles it', () => {
    const { mgr, tool } = makeManager();
    expect(mgr.GetActionManager().RunHotKey(MD_CTRL + 'P'.charCodeAt(0))).toBe(true);
    expect(tool.pings).toBe(1);
    expect(mgr.GetActionManager().RunHotKey('Q'.charCodeAt(0))).toBe(false);
  });
});

describe('TOOL_MANAGER + TOOL_INTERACTIVE', () => {
  it('RegisterTool + InitTools resets the tool and RunAction dispatches to its transition', () => {
    const { mgr, tool } = makeManager();
    expect(tool.resets).toEqual([RESET_REASON.RUN]);
    expect(mgr.RunAction(COUNTING_TOOL.ping)).toBe(true);
    expect(mgr.RunAction(COUNTING_TOOL.ping)).toBe(true);
    expect(tool.pings).toBe(2);
  });

  it('a waiting handler resumes on each event and ends on cancel', () => {
    const { mgr, tool } = makeManager();
    expect(mgr.RunAction(COUNTING_TOOL.run)).toBe(true);
    expect(tool.finished).toBe(false);
    expect(mgr.GetCurrentTool()).toBe(tool);

    const click = (x: number): TOOL_EVENT => {
      const e = new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MOUSE,
        TOOL_ACTIONS.TA_MOUSE_CLICK,
        TOOL_MOUSE_BUTTONS.BUT_LEFT,
        TOOL_ACTION_SCOPE.AS_GLOBAL,
      );
      e.SetMousePosition({ x, y: 0 });
      return e;
    };
    mgr.ProcessEvent(click(10));
    mgr.ProcessEvent(click(20));
    expect(tool.clicksSeen).toEqual([10, 20]);
    expect(tool.finished).toBe(false);

    mgr.ProcessEvent(ACTIONS.cancelInteractive.MakeEvent());
    expect(tool.finished).toBe(true);
    expect(mgr.GetCurrentTool()).toBeNull();
  });
});

class TEST_COMMIT extends COMMIT {
  pushed = 0;
  Push(): void {
    this.pushed++;
    this.clear();
  }
  Revert(): void {
    this.clear();
  }
  protected undoLevelItem(i: EDA_ITEM): EDA_ITEM {
    return i;
  }
  protected makeImage(i: EDA_ITEM): EDA_ITEM {
    return i.Clone();
  }
  entries() {
    return this.m_entries;
  }
}

describe('COMMIT staging', () => {
  it('stages an add once, a modify with an image taken before the change, and a remove with its image', () => {
    const c = new TEST_COMMIT();
    const a = new DUMMY_ITEM();
    const m = new DUMMY_ITEM();
    m.value = 5;
    const r = new DUMMY_ITEM();

    c.Add(a);
    c.Add(a);
    c.Modify(m);
    m.value = 6;
    c.Modify(m);
    c.Remove(r);

    expect(c.entries().length).toBe(3);
    expect(c.GetStatus(a)).toBe(CHANGE_TYPE.CHT_ADD);
    expect(c.GetStatus(m)).toBe(CHANGE_TYPE.CHT_MODIFY);
    expect(c.GetStatus(r)).toBe(CHANGE_TYPE.CHT_REMOVE);
    expect((c.entries()[1]!.m_copy as DUMMY_ITEM).value).toBe(5);
    expect(c.entries()[2]!.m_copy).not.toBeNull();
    expect(c.GetFirst()).toBe(a);

    // an added item cannot be also modified: the add wins
    c.Modify(a);
    expect(c.entries().length).toBe(3);

    // a PICKED_ITEMS_LIST stages by its statuses
    const list = new PICKED_ITEMS_LIST();
    const n = new DUMMY_ITEM();
    list.PushItem(new ITEM_PICKER(null, n, UNDO_REDO.NEWITEM));
    c.Stage(list);
    expect(c.GetStatus(n)).toBe(CHANGE_TYPE.CHT_ADD);

    c.Push();
    expect(c.Empty()).toBe(true);
    expect(c.pushed).toBe(1);
  });
});

describe('PICKED_ITEMS_LIST', () => {
  it('keeps pickers in order, reverses them, and clears with the deleter', () => {
    const list = new PICKED_ITEMS_LIST();
    const a = new DUMMY_ITEM();
    const b = new DUMMY_ITEM();
    list.PushItem(new ITEM_PICKER(null, a, UNDO_REDO.NEWITEM));
    list.PushItem(new ITEM_PICKER(null, b, UNDO_REDO.DELETED));
    expect(list.GetCount()).toBe(2);
    expect(list.GetPickedItem(0)).toBe(a);
    expect(list.ContainsItem(b)).toBe(true);
    expect(list.FindItem(b)).toBe(1);
    list.ReversePickersListOrder();
    expect(list.GetPickedItem(0)).toBe(b);
    expect(list.GetPickedItemStatus(0)).toBe(UNDO_REDO.DELETED);
    const deleted: EDA_ITEM[] = [];
    list.ClearListAndDeleteItems((i) => deleted.push(i));
    // NEWITEM entries belong to the model; only DELETED (and image links) go to the deleter
    expect(deleted).toEqual([b]);
    expect(list.GetCount()).toBe(0);
  });
});
