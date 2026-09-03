// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_ACTION::GetButtonTooltip()` (common/tool/tool_action.cpp:194-206), the
 * string `ACTION_TOOLBAR` gives every button (action_toolbar.cpp:149):
 *
 *     wxString tooltip = GetFriendlyName();
 *     if( GetHotKey() )
 *         tooltip += wxString::Format( wxT( "\t(%s)" ), KeyNameFromKeyCode( GetHotKey() ) );
 *     if( !GetTooltip( false ).IsEmpty() )
 *         tooltip += '\n' + GetTooltip( false );
 *
 * Every toolbar in this app used to pass one pre-joined `title` string, so no
 * button anywhere had the second line.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buttonTooltipFor, tooltipFor } from '@ziroeda/designer/src/ui/tooltip_text.js';
import {
  actionFor,
  EESCHEMA_TOOLBAR_ACTIONS,
  TOOLBAR_ACTIONS,
  toolbarButtonLabel,
  toolbarButtonTooltip,
} from '@ziroeda/designer/src/ui/toolbar_actions.js';

describe('buttonTooltipFor', () => {
  it('is name, tab and hotkey, newline, tooltip', () => {
    expect(buttonTooltipFor('Save', 'Ctrl+S', 'Save changes')).toBe('Save\t(Ctrl+S)\nSave changes');
  });

  /** The separator before the hotkey is a TAB, which is what right-aligns it. */
  it('separates the hotkey with a tab, not a space', () => {
    expect(buttonTooltipFor('Save', 'Ctrl+S')).toBe('Save\t(Ctrl+S)');
    expect(buttonTooltipFor('Save', 'Ctrl+S')).not.toBe('Save (Ctrl+S)');
  });

  /** `if( GetHotKey() )` — no key, no parenthesis at all. */
  it('omits the hotkey clause entirely when there is none', () => {
    expect(buttonTooltipFor('Plot...')).toBe('Plot...');
    expect(buttonTooltipFor('Plot...', undefined, 'Plot the board')).toBe(
      'Plot...\nPlot the board',
    );
  });

  /**
   * `if( !GetTooltip( false ).IsEmpty() )` — an action with no `.Tooltip()`
   * gets NO second line, not an empty one. Undo, Redo, Find and Plot are all in
   * that case, so a trailing newline would be visible on the most-used buttons.
   */
  it('adds no second line, not an empty one, when the action has no tooltip', () => {
    const t = buttonTooltipFor('Undo', 'Ctrl+Z');
    expect(t).toBe('Undo\t(Ctrl+Z)');
    expect(t.endsWith('\n')).toBe(false);
    expect(t.split('\n')).toHaveLength(1);
  });
});

/** `GetTooltip( true )` — two spaces and parentheses, a different string. */
describe('tooltipFor is not the same rule', () => {
  it('uses two spaces, for the launcher tiles rather than a toolbar', () => {
    expect(tooltipFor('Save changes', 'Ctrl+S')).toBe('Save changes  (Ctrl+S)');
  });
});

describe('the transcribed actions', () => {
  /**
   * Spot-checked against `common/tool/actions.cpp` and
   * `eeschema/tools/sch_actions.cpp`, one action per assertion. These are the
   * three fields the tooltip is built from, so a wrong one is visible on hover.
   */
  const cases: [id: string, name: string, hotkey: string | undefined, tip: string | undefined][] = [
    ['save', 'Save', 'Ctrl+S', 'Save changes'],
    ['plot', 'Plot...', undefined, undefined],
    ['undo', 'Undo', 'Ctrl+Z', undefined],
    ['paste', 'Paste', 'Ctrl+V', 'Paste item(s) from clipboard'],
    ['zoomFit', 'Zoom to Fit', 'Home', 'Zoom to worksheet area if exists or edited object'],
    ['mirrorV', 'Mirror Vertically', 'Y', 'Flips selected item(s) from top to bottom'],
    ['showPcbNew', 'Switch to PCB Editor', undefined, 'Open PCB in board editor'],
    ['placeSymbol', 'Place Symbols', 'A', undefined],
    ['delete', 'Interactive Delete Tool', undefined, 'Delete clicked items'],
    // FriendlyName "Rectangle", not our old invented "Select item(s): Rectangle".
    ['select', 'Rectangle', undefined, 'Set selection mode to use rectangle'],
  ];

  it.each(cases)('%s', (id, name, hotkey, tip) => {
    // Resolved the way a call site resolves it, not out of one table: the
    // `common.*` actions among these are `ACTIONS::` objects shared by every
    // editor, so they live in `COMMON_TOOLBAR_ACTIONS` and eeschema reaches
    // them through the fallback. Asserting on `EESCHEMA_TOOLBAR_ACTIONS` alone
    // would force a per-app copy of each — the drift this file exists to stop.
    expect(actionFor('eeschema', id)).toEqual({
      name,
      ...(hotkey ? { hotkey } : {}),
      ...(tip ? { tip } : {}),
    });
  });

  it('resolves those shared ones for an app with no table of its own', () => {
    // The Symbol Editor has no `TOOLBAR_ACTIONS` entry, and must still get
    // "Show Grid" rather than falling through to the button's title.
    expect(actionFor('symbol_editor', 'toggleGrid')?.name).toBe('Show Grid');
    expect(actionFor('symbol_editor', 'showProperties')?.name).toBe('Properties');
    expect(actionFor(undefined, 'undo')?.name).toBe('Undo');
  });

  /**
   * All three line-mode actions share ONE FriendlyName upstream
   * (sch_actions.cpp:1341, 1350, 1359) and differ only in `.Tooltip()`. Ours
   * used to invent ": free angle" / ": 90°" / ": 45°" suffixes.
   */
  it('gives the three line modes one name and three tooltips', () => {
    const ids = ['lineModeFree', 'lineMode90', 'lineMode45'];
    const names = new Set(ids.map((i) => EESCHEMA_TOOLBAR_ACTIONS[i]?.name));
    expect([...names]).toEqual(['Line Mode for Wires and Buses']);
    expect(new Set(ids.map((i) => EESCHEMA_TOOLBAR_ACTIONS[i]?.tip)).size).toBe(3);
  });
});

/**
 * A toolbar id is NOT globally unique, and the tooltip is where that bites:
 * `placeText` is `SCH_ACTIONS::placeSchematicText` ("Draw Text", T) in eeschema
 * and `PCB_ACTIONS::placeText` ("Add Text", Ctrl+Shift+T) in pcbnew.
 *
 * A flat id -> action map silently handed pcbnew's button eeschema's name and
 * key. `browser_hotkeys.test.ts` caught it, because Ctrl+Shift+T disappeared
 * from the app's hotkey inventory.
 */
describe('the table is keyed by app', () => {
  it('does not answer for an app it has not transcribed', () => {
    expect(TOOLBAR_ACTIONS.pcbnew).toBeUndefined();
    expect(toolbarButtonTooltip('pcbnew', 'placeText', 'Draw Text (Ctrl+Shift+T)')).toBe(
      'Draw Text (Ctrl+Shift+T)',
    );
  });

  it('does not answer for no app at all', () => {
    expect(toolbarButtonTooltip(undefined, 'placeText', 'fallback')).toBe('fallback');
  });

  it('answers for eeschema, where placeText is Draw Text on T', () => {
    expect(toolbarButtonTooltip('eeschema', 'placeText')).toBe('Draw Text\t(T)');
  });

  it('falls back for an id the app has not transcribed', () => {
    expect(toolbarButtonTooltip('eeschema', 'nosuchid', 'whatever')).toBe('whatever');
    expect(toolbarButtonTooltip('eeschema', 'nosuchid')).toBe('');
  });
});

/**
 * The accessible name is `GetFriendlyName()` alone: a screen reader would read
 * the tab and newline of a button tooltip aloud as punctuation.
 */
describe('toolbarButtonLabel', () => {
  it('is the friendly name, with no hotkey and no second line', () => {
    expect(toolbarButtonLabel('eeschema', 'save')).toBe('Save');
    expect(toolbarButtonLabel('eeschema', 'save')).not.toContain('\t');
    expect(toolbarButtonLabel('eeschema', 'save')).not.toContain('\n');
  });

  it('falls back to the button title where the id is unknown', () => {
    expect(toolbarButtonLabel('eeschema', 'nosuchid', 'Fallback')).toBe('Fallback');
  });
});

/**
 * The component has to actually render through the two helpers. Everything
 * above tests data and pure functions, and a mutation sweep proved that is not
 * enough: putting `title={b.title}` back on the button, and giving `aria-label`
 * the full multi-line tooltip, BOTH survived every case in this file. Neither
 * test could see the JSX.
 *
 * `qa`'s tsconfig cannot compile a `.tsx`, so the render sites are read as
 * text — the same way `sch_panes.test.ts` pins the dock order.
 */
describe('Toolbar renders through the shared rule', () => {
  const SRC = fileURLToPath(new URL('../../../designer/src/ui/Toolbar.tsx', import.meta.url));
  const text = (): string => readFileSync(SRC, 'utf8');

  it('builds the button title with toolbarButtonTooltip, passing the app', () => {
    expect(text()).toContain('title={toolbarButtonTooltip(app, b.id, b.title)}');
  });

  /** A group's wrapper carries the displayed action's tooltip, not its own. */
  it('builds the group wrapper title the same way', () => {
    expect(text()).toContain('title={toolbarButtonTooltip(app, shown.id, shown.title)}');
  });

  /**
   * `aria-label` must be the friendly name alone. Given the tooltip instead, a
   * screen reader reads the tab and the newline aloud as punctuation.
   */
  it('gives aria-label the single-line label, never the tooltip', () => {
    const s = text();
    expect(s).toContain('aria-label={toolbarButtonLabel(app, b.id, b.title)}');
    expect(s).not.toContain('aria-label={toolbarButtonTooltip(');
  });

  /** No render site may reach for the raw local string any more. */
  it('never renders a bare b.title', () => {
    expect(text()).not.toMatch(/title=\{b\.title\}/);
    expect(text()).not.toMatch(/aria-label=\{b\.title\}/);
  });
});
