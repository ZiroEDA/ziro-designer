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
import { buttonTooltipFor, tooltipFor } from '@ziroeda/designer/src/ui/tooltip_text.js';
import {
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
    expect(EESCHEMA_TOOLBAR_ACTIONS[id]).toEqual({
      name,
      ...(hotkey ? { hotkey } : {}),
      ...(tip ? { tip } : {}),
    });
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
