// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Stopping the browser acting on a key the app has bound.
 *
 * A desktop KiCad owns its accelerator table; a tab shares one with Chrome. The
 * interesting cases here are the two edges - the combos the browser will never
 * give up, and the fields where taking a combo would break typing.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_RESERVED,
  browserSafeKey,
  isBrowserReserved,
  isTypingTarget,
  planClaim,
} from '@ziroeda/designer/src/ui/browser_hotkeys.js';
import { buildHotkeySections } from '@ziroeda/designer/src/ui/hotkeys_inventory.js';

describe('what a page can and cannot take', () => {
  it('never claims a combo the browser reserves', () => {
    // Chromium's IsReservedCommandOrKey: anything that opens or closes a
    // browsing context, plus tab cycling. preventDefault on these is ignored,
    // so claiming them would be a listener that does nothing.
    const r = planClaim(['Ctrl+N', 'Ctrl+W', 'Ctrl+O']);
    expect(r.reserved.sort()).toEqual(['Ctrl+N', 'Ctrl+W']);
    expect(r.claimed).toEqual(['ctrl+o']);
  });

  it('reports Ctrl+N as reserved, which is the one that bites', () => {
    // ACTIONS::newProject is Ctrl+N and so is Chrome's new window. Both fire
    // and there is no page-side fix; naming it is the only honest handling.
    expect(isBrowserReserved('Ctrl+N')).toBe(true);
    expect(BROWSER_RESERVED).toContain('Ctrl+N');
  });

  it('does not reserve the ones a page is allowed to have', () => {
    // Ctrl+G is Chrome's find-next and was falling through to it; Ctrl+O, P, F
    // and D are all the browser's by default and all yield to preventDefault.
    for (const combo of ['Ctrl+G', 'Ctrl+O', 'Ctrl+P', 'Ctrl+F', 'Ctrl+D', 'F5']) {
      expect(isBrowserReserved(combo), combo).toBe(false);
    }
  });

  it('ignores a gesture, which is not a keystroke', () => {
    // The Gestures section is Ctrl+Click, Shift+Wheel, Double-click - rows in
    // the same inventory this is fed from, and nothing a keydown can match.
    const r = planClaim(['Ctrl+Click', 'Shift+Wheel', 'Double-click']);
    expect(r.claimed).toEqual([]);
    expect(r.reserved).toEqual([]);
  });
});

describe('somewhere the user is typing', () => {
  it('leaves a text field its keys', () => {
    // Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A and Ctrl+Z are all bound somewhere in the
    // app and all are how a text field works. Claiming them while a field has
    // focus would break copying out of a project name box to fix a shortcut
    // nobody pressed. The project manager's own Edit menu greys out
    // cut/copy/paste for the same reason.
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('does not count a control you cannot type into', () => {
    // A checkbox is not somewhere you type, so a hotkey pressed with one
    // focused should still work.
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'file']) {
      expect(isTypingTarget({ tagName: 'INPUT', type }), type).toBe(false);
    }
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('fed from the app’s own inventory', () => {
  const combos = buildHotkeySections().flatMap((s) => s.entries.map((e) => e.keys));

  it('claims the keys the Hotkey List shows, so the two cannot disagree', () => {
    const r = planClaim(combos);
    // Every command the app advertises a key for is one the browser has been
    // told to leave alone.
    expect(r.claimed).toContain('ctrl+g');
    expect(r.claimed).toContain('f5');
    expect(r.claimed).toContain('ctrl+alt+n');
  });

  it('binds nothing on a reserved combo but the two documented cases', () => {
    // The guard against this quietly coming back. A command bound to a combo
    // the browser keeps does not work in a tab, whatever the menu says, so
    // every one of these has to be a deliberate entry in BROWSER_REBINDS or a
    // known exception:
    //
    //   Ctrl+W        the platform's own close-this-window, which a browser
    //                 spells close-this-tab - the faithful analogue, left alone
    //   Ctrl+Shift+T  PCB_ACTIONS::placeText, advertised on the PCB toolbar and
    //                 read by no dispatcher yet - decided in #525
    expect(planClaim(combos).reserved.sort()).toEqual(['Ctrl+Shift+T', 'Ctrl+W']);
  });

  it('has moved New Project off the browser’s new window', () => {
    // KICAD_MANAGER_ACTIONS::newProject is Ctrl+N upstream, which Chrome
    // handles before the page sees the key.
    expect(browserSafeKey('Ctrl+N')).toBe('Ctrl+Alt+N');
    expect(isBrowserReserved(browserSafeKey('Ctrl+N'))).toBe(false);
    expect(combos).toContain('Ctrl+Alt+N');
    expect(combos).not.toContain('Ctrl+N');
  });

  it('claims nothing empty, since most commands have no key at all', () => {
    expect(planClaim(combos).claimed).not.toContain('');
  });
});
