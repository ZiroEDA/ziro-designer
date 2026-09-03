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
  RIGHT_TOOLBAR_COMMANDS,
} from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import { TOOL_HOTKEYS } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import { nextInGroup } from '@ziroeda/designer/src/ui/toolbar_types.js';
import {
  EESCHEMA_TOOLBAR_ACTIONS,
  toolbarButtonTooltip,
  actionFor,
} from '@ziroeda/designer/src/ui/toolbar_actions.js';
import type { ToolButton, ToolEntry, ToolGroup } from '@ziroeda/designer/src/ui/toolbar_types.js';

/** Every button, groups flattened; controls and separators contribute none. */
const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) =>
    e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e || 'spacer' in e ? [] : [e],
  );

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

  /**
   * Every button must resolve to a tooltip. The `title` field is gone from this
   * editor's data — `ui/toolbar_actions.ts` carries the three parts upstream
   * keeps separate — so the rule is no longer "has a title" but "the shared
   * table knows this id".
   *
   * This is the guard that makes removing the titles safe: an id missing from
   * the table falls back to `title`, which is now `undefined`, and the button
   * would get a silently EMPTY tooltip rather than a wrong one. Checked per
   * button, so one missing id fails on its own name.
   */
  it('every button has an icon, and a tooltip the shared table can build', () => {
    for (const tb of [TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR]) {
      for (const b of buttons(tb)) {
        expect({ id: b.id, icon: !!b.icon }).toEqual({ id: b.id, icon: true });
        expect(toolbarButtonTooltip('eeschema', b.id, b.title), b.id).not.toBe('');
        // Resolved, not looked up in one table: an `ACTIONS::` object lives in
        // the shared `COMMON_TOOLBAR_ACTIONS` and eeschema reaches it through
        // the fallback, exactly as KiCad's toolbar points at the one object.
        expect(actionFor('eeschema', b.id), `${b.id} is transcribed nowhere`).toBeDefined();
      }
    }
  });

  /**
   * And nothing states a tooltip locally any more. A `title` beside an id the
   * shared table also carries is the central-value rule's exact failure mode:
   * two copies, one of them stale, and no way to see which is winning.
   */
  it('states no tooltip locally', () => {
    for (const tb of [TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR]) {
      for (const b of buttons(tb)) expect(b.title, b.id).toBeUndefined();
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
    // `drawRuleArea` came off this list when SCH_RULE_AREA was implemented.
    // Three came off this list as they were built: `drawRuleArea`,
    // `syncAllSheetsPins` (an id typo, not a missing feature), and the two
    // ellipse shapes.
    expect(greyed).toEqual(['simulator']);
  });
});

describe('a group button: one click picks, a long press opens the palette', () => {
  /**
   * `ACTION_TOOLBAR::onMouseClick` arms the palette timer on left *down* and
   * stops it on left *up*, so a click shorter than PALETTE_OPEN_DELAY never
   * pops the palette — it falls through to the ordinary tool event. And for a
   * group with no activation in it, `onToolEvent` says:
   *
   *     // For non-tool toggle groups (units, crosshair, line modes), cycle to the next
   *     // action on click. Tool groups (route track, etc.) fall through and just dispatch
   *     // the currently displayed action.
   *
   * Ours opened the palette on click *as well*, so both gestures did the same
   * thing and a single click could not select anything.
   */
  const groups = (entries: readonly ToolEntry[]): ToolGroup[] =>
    entries.filter((e): e is ToolGroup => e !== 'sep' && 'group' in e);

  /**
   * WHICH groups exist at all, per toolbar. Nothing in this file could see the
   * three groups ours had invented on the right bar — "Text objects", "Circle"
   * and "Arc" — so removing them broke no test here, which is the finding.
   *
   * `TOOLBAR_GROUP_CONFIG` appears exactly five times in
   * `SCH_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig`: Units (:81), Crosshair
   * modes (:85) and Line modes (:94) on the LEFT, Selection modes (:112) and
   * Labels (:125) on the RIGHT. Everything else on both bars is a flat
   * `AppendAction`, and the top bar has no group at all.
   */
  it('groups exactly where upstream declares a TOOLBAR_GROUP_CONFIG', () => {
    expect(groups(LEFT_TOOLBAR).map((g) => g.group)).toEqual([
      'Units',
      'Crosshair modes',
      'Line modes',
    ]);
    expect(groups(RIGHT_TOOLBAR).map((g) => g.group)).toEqual(['Selection modes', 'Labels']);
    expect(groups(TOP_TOOLBAR)).toEqual([]);
  });

  /**
   * The shape actions are flat buttons, named one at a time: a group holding
   * any one of them is a triangle KiCad does not draw.
   */
  for (const id of ['placeText', 'textBox', 'table', 'rectangle', 'circle', 'arc', 'bezier']) {
    it(`${id} is a flat button on the right bar, not inside a group`, () => {
      expect(RIGHT_TOOLBAR).toContainEqual(expect.objectContaining({ id }));
      expect(groups(RIGHT_TOOLBAR).flatMap((g) => g.actions.map((a) => a.id))).not.toContain(id);
    });
  }

  /** `SHAPE_T` (include/eda_shape.h:44-53) has no ELLIPSE member. */
  for (const id of ['ellipse', 'ellipseArc']) {
    it(`${id} is not on any schematic toolbar`, () => {
      expect(ids([...TOP_TOOLBAR, ...LEFT_TOOLBAR, ...RIGHT_TOOLBAR])).not.toContain(id);
    });
  }

  it('marks exactly the three toggle groups upstream names', () => {
    const cycling = [...groups(LEFT_TOOLBAR), ...groups(RIGHT_TOOLBAR)]
      .filter((g) => g.cycleOnClick)
      .map((g) => g.group);
    expect(cycling.sort()).toEqual(['Crosshair modes', 'Line modes', 'Units']);
  });

  it('and leaves tool groups alone, which dispatch what they show', () => {
    // Selection modes is select/selectLasso — both activations, so upstream
    // takes the fall-through branch and runs the displayed action.
    const sel = groups(RIGHT_TOOLBAR).find((g) => g.group === 'Selection modes');
    expect(sel).toBeDefined();
    expect(sel?.cycleOnClick).toBeUndefined();
  });

  it('steps to the next action and wraps at the end', () => {
    const modes = groups(LEFT_TOOLBAR).find((g) => g.group === 'Crosshair modes')!;
    const order = modes.actions.map((a) => a.id);
    expect(order).toEqual(['crosshairSmall', 'crosshairFull', 'crosshair45']);
    expect(nextInGroup(modes, 'crosshairSmall').id).toBe('crosshairFull');
    expect(nextInGroup(modes, 'crosshairFull').id).toBe('crosshair45');
    expect(nextInGroup(modes, 'crosshair45').id).toBe('crosshairSmall');
  });

  it('and falls back to the first action for an id the group does not hold', () => {
    const modes = groups(LEFT_TOOLBAR).find((g) => g.group === 'Line modes')!;
    expect(nextInGroup(modes, 'nonsense').id).toBe(modes.actions[0]!.id);
  });

  it('every cycling group has at least two actions, or a click does nothing', () => {
    for (const g of [...groups(LEFT_TOOLBAR), ...groups(RIGHT_TOOLBAR)].filter(
      (g) => g.cycleOnClick,
    ))
      expect(g.actions.length, g.group).toBeGreaterThan(1);
  });
});

describe('the zoom tool is the one top-toolbar button that stays lit', () => {
  /**
   * Everything on the top toolbar is a plain action except `zoomTool`, which is
   * an AF_ACTIVATE tool: `ZOOM_TOOL::Main` keeps running until it is cancelled,
   * and the button is checked for as long as it does —
   *
   *     mgr->SetConditions( ACTIONS::zoomTool, CHECK( cond.CurrentTool( ACTIONS::zoomTool ) ) );
   *
   * `Toolbar` lights a button when `activeTool === b.id`, so the toolbar only
   * needs the current tool passed to it. That is safe precisely because no
   * other id up there is a tool id — this test is what keeps it safe.
   */
  const idsOf = (entries: readonly ToolEntry[]): string[] =>
    entries.flatMap((e) =>
      e === 'sep'
        ? []
        : 'group' in e
          ? e.actions.map((a) => a.id)
          : 'control' in e || 'spacer' in e
            ? []
            : [e.id],
    );

  it('names a tool the right toolbar also names', () => {
    // The id has to match what `setActiveTool` stores, or nothing lights up.
    expect(idsOf(TOP_TOOLBAR)).toContain('zoomTool');
  });

  it('and is the only top-toolbar id that collides with a tool id', () => {
    const tools = new Set(idsOf(RIGHT_TOOLBAR));
    const collisions = idsOf(TOP_TOOLBAR).filter((id) => tools.has(id));
    // A new one would light up on its own the moment its tool was picked.
    expect(collisions).toEqual([]);
  });
});

describe('the right toolbar’s one non-tool button', () => {
  it('Sync All Sheet Pins is a command, not a placement tool', () => {
    // `SCH_DRAWING_TOOLS::SyncAllSheetsPins` opens DIALOG_SYNC_SHEET_PINS and
    // returns; it never enters a tool loop. Sent to the tool selector it set an
    // `activeTool` nothing answers to — a changed cursor and no dialog.
    expect(RIGHT_TOOLBAR_COMMANDS.has('syncAllSheetPins')).toBe(true);
  });

  it('and every other button on it is a tool', () => {
    const commands = ids(RIGHT_TOOLBAR).filter((id) => RIGHT_TOOLBAR_COMMANDS.has(id));
    expect(commands).toEqual(['syncAllSheetPins']);
  });

  it('every command id is actually on the toolbar', () => {
    // A typo here is invisible at runtime: the id simply falls through to the
    // tool selector again, which is the bug this set exists to prevent.
    for (const id of RIGHT_TOOLBAR_COMMANDS) expect(ids(RIGHT_TOOLBAR)).toContain(id);
  });
});

/**
 * Toolbar tooltips carry the hotkey, so a tooltip printing the wrong branch of
 * a `#if defined( __WXMAC__ )` is the same bug as a menu row printing it.
 *
 * Named one at a time rather than as one "no toolbar title says Ctrl+R",
 * because the rule is per button.
 */
describe('the two accelerators that came from the macOS branch', () => {
  /** actions.cpp:292-302 — `#else` is `MD_CTRL + 'Y'`. */
  it('Redo advertises Ctrl+Y, not the macOS Ctrl+Shift+Z', () => {
    // Resolved as a call site resolves it: `ACTIONS::redo` is a `common.*`
    // object, so it lives in the shared table and eeschema reaches it through
    // the fallback.
    expect(actionFor('eeschema', 'redo')?.hotkey).toBe('Ctrl+Y');
    // `GetButtonTooltip()`: a TAB before the hotkey, and no second line at all,
    // because ACTIONS::redo declares no `.Tooltip()`.
    expect(toolbarButtonTooltip('eeschema', 'redo')).toBe('Redo\t(Ctrl+Y)');
  });

  /** actions.cpp:705-716 — `#else` is `WXK_F5`. */
  it('Refresh advertises F5, not the macOS Ctrl+R', () => {
    expect(actionFor('eeschema', 'zoomRedraw')?.hotkey).toBe('F5');
    expect(toolbarButtonTooltip('eeschema', 'zoomRedraw')).toBe('Refresh\t(F5)');
  });

  it('and no button anywhere still advertises a macOS-only default', () => {
    const all = [TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR]
      .flatMap(buttons)
      .map((b) => toolbarButtonTooltip('eeschema', b.id, b.title));
    for (const mac of ['Ctrl+Shift+Z', '(Ctrl+R)']) {
      expect(all.filter((t) => t.includes(mac))).toEqual([]);
    }
  });
});
