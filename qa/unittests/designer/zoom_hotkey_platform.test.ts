// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The zoom actions' hotkeys are this platform's, not macOS's.
 *
 * Six actions in `common/tool/actions.cpp` declare a different `DefaultHotkey`
 * per platform. We ship a Linux/GTK build, so every one of them takes the
 * `#else` branch:
 *
 *     redo           MD_CTRL+MD_SHIFT+'Z'  |  MD_CTRL+'Y'      actions.cpp:294-299
 *     doDelete       WXK_BACK              |  WXK_DELETE       actions.cpp:401-406
 *     zoomRedraw     MD_CTRL+'R'           |  WXK_F5           actions.cpp:707-712
 *     zoomFitScreen  MD_CTRL+'0'           |  WXK_HOME         actions.cpp:719-724
 *     zoomIn         MD_CTRL+'+'           |  WXK_F1           actions.cpp:747-752
 *     zoomOut        MD_CTRL+'-'           |  WXK_F2           actions.cpp:759-764
 *
 * and `zoomInCenter` / `zoomOutCenter` (`actions.cpp:769-779`) declare no
 * hotkey at all, on any platform.
 *
 * This pins the two halves that were wrong together: the macOS spelling was
 * ALSO bound, so Ctrl++ zoomed in a build of KiCad where it cannot; and the
 * cursor/centre pair was crossed, so the table filed F1 under `zoomInCenter`
 * (which has no key) and Ctrl++ under `zoomIn` (whose key is F1).
 */
import { describe, expect, it } from 'vitest';
import { HOTKEYS } from '@ziroeda/designer/src/editors/schematic/hotkeys.js';

/** The row for an action id, or a failure naming what is actually there. */
function row(id: string) {
  const r = HOTKEYS.find((h) => h.id === id);
  if (!r) throw new Error(`no hotkey row with id ${id}`);
  return r;
}

describe('zoomIn / zoomOut carry this platform’s key and upstream’s name', () => {
  it('zoomIn is F1, and is named "Zoom In at Cursor"', () => {
    const r = row('zoomIn');
    expect(r.keys).toBe('F1');
    expect(r.label).toBe('Zoom In at Cursor');
    expect(r.upstream).toBe('ACTIONS::zoomIn');
  });

  it('zoomOut is F2, and is named "Zoom Out at Cursor"', () => {
    const r = row('zoomOut');
    expect(r.keys).toBe('F2');
    expect(r.label).toBe('Zoom Out at Cursor');
    expect(r.upstream).toBe('ACTIONS::zoomOut');
  });
});

describe('the *Center pair is unbound, as upstream declares it', () => {
  it('zoomInCenter has no key and is named "Zoom In"', () => {
    const r = row('zoomInCenter');
    expect(r.keys).toBe('');
    expect(r.label).toBe('Zoom In');
    expect(r.upstream).toBe('ACTIONS::zoomInCenter');
  });

  it('zoomOutCenter has no key and is named "Zoom Out"', () => {
    const r = row('zoomOutCenter');
    expect(r.keys).toBe('');
    expect(r.label).toBe('Zoom Out');
    expect(r.upstream).toBe('ACTIONS::zoomOutCenter');
  });

  it('so the cursor pair and the centre pair do not share a key', () => {
    // The crossed-over state passed every per-row check that existed, because
    // each row was individually plausible. What it could not survive is being
    // asked about both pairs at once.
    expect(row('zoomIn').keys).not.toBe(row('zoomInCenter').keys);
    expect(row('zoomOut').keys).not.toBe(row('zoomOutCenter').keys);
  });
});

describe('no macOS-only spelling is bound as well', () => {
  // Per-occurrence, not a file-level scan: the rule is about each row's key.
  const MAC_ONLY: ReadonlyArray<[string, string]> = [
    ['Ctrl++', 'zoomIn'],
    ['Ctrl+-', 'zoomOut'],
  ];

  for (const [combo, action] of MAC_ONLY) {
    it(`${combo} appears on no row (it is ${action}'s __WXMAC__ branch)`, () => {
      const holders = HOTKEYS.filter((h) => h.keys === combo).map((h) => h.id);
      expect(holders).toStrictEqual([]);
    });
  }

  it('and the keys those rows do hold are the #else branch', () => {
    // Guards the mutant that empties both rows to satisfy the check above.
    expect(row('zoomIn').keys).toBe('F1');
    expect(row('zoomOut').keys).toBe('F2');
  });
});

describe('the platform-split actions we already had right stay right', () => {
  // Named so a future sweep of this class does not silently re-baseline them.
  const EXPECTED: ReadonlyArray<[string, string]> = [
    ['redo', 'Ctrl+Y'],
    ['zoomRedraw', 'F5'],
  ];

  for (const [id, keys] of EXPECTED) {
    it(`${id} is ${keys}`, () => {
      expect(row(id).keys).toBe(keys);
    });
  }
});
