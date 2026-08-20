// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONDITIONAL_MENU` (`common/tool/conditional_menu.cpp`) — the two rules every
 * KiCad tool menu is assembled by.
 *
 * Written because the drawing sheet's context menu (DSP-14) first spelled the
 * *evaluated* shape by hand, and a mutation that removed its separator guard
 * survived: with only two selection states the guard was vacuously true in
 * both. The rules are now a shared port with entries declared the way the C++
 * declares them, and they are testable on their own.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateConditionalMenu,
  menuEntry,
  menuSeparator,
} from '@ziroeda/designer/src/ui/conditional_menu.js';

const labels = (items: { sep?: boolean; label?: string }[]): string[] =>
  items.map((it) => (it.sep ? '—' : (it.label ?? '?')));

describe('addEntry ordering', () => {
  it('draws entries in ascending order however they were added', () => {
    // Three tools contribute to one menu from three Init()s; only the order
    // number decides where a row lands.
    expect(
      labels(
        evaluateConditionalMenu([
          menuEntry({ label: 'late' }, 1000),
          menuEntry({ label: 'early' }, 200),
          menuEntry({ label: 'middle' }, 250),
        ]),
      ),
    ).toEqual(['early', 'middle', 'late']);
  });

  it('keeps insertion order within one order number', () => {
    // addEntry inserts AFTER every entry with order <= its own, so ties are
    // stable: pl_editor's four Empty draw tools stay in declaration order.
    expect(
      labels(
        evaluateConditionalMenu([
          menuEntry({ label: 'a' }, 200),
          menuEntry({ label: 'b' }, 200),
          menuEntry({ label: 'c' }, 200),
        ]),
      ),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('Evaluate', () => {
  it('drops an entry whose condition is false', () => {
    expect(
      labels(
        evaluateConditionalMenu([
          menuEntry({ label: 'shown' }, 1),
          menuEntry({ label: 'hidden' }, 2, false),
        ]),
      ),
    ).toEqual(['shown']);
  });

  it('drops a separator with nothing in front of it', () => {
    // `if( menu_count ) AppendSeparator()` — a menu never opens on a rule.
    expect(
      labels(evaluateConditionalMenu([menuSeparator(1), menuEntry({ label: 'row' }, 2)])),
    ).toEqual(['row']);
  });

  it('drops a separator whose whole group evaluated away', () => {
    expect(
      labels(
        evaluateConditionalMenu([
          menuEntry({ label: 'a' }, 1),
          menuSeparator(2),
          menuEntry({ label: 'gone' }, 3, false),
          menuSeparator(4),
          menuEntry({ label: 'b' }, 5),
        ]),
      ),
    ).toEqual(['a', '—', 'b']);
  });

  it('counts rows across groups, not within one', () => {
    // menu_count is reset only by a separator that was actually emitted, so a
    // rule draws when ANYTHING preceded it — which is why pl_editor's empty
    // menu still rules off the four draw rows from Paste even though `move`,
    // the only row of its own group, conditioned away.
    expect(
      labels(
        evaluateConditionalMenu([
          menuEntry({ label: 'draw' }, 200),
          menuEntry({ label: 'move' }, 250, false),
          menuSeparator(250),
          menuEntry({ label: 'paste' }, 250),
        ]),
      ),
    ).toEqual(['draw', '—', 'paste']);
  });

  it('collapses two adjacent separators to one', () => {
    // pl_editor really does declare two at order 1000: PL_SELECTION_TOOL::Init
    // adds one (:66) and AddStandardSubMenus adds another (:714).
    expect(
      labels(
        evaluateConditionalMenu([
          menuEntry({ label: 'a' }, 1),
          menuSeparator(2),
          menuSeparator(2),
          menuEntry({ label: 'b' }, 3),
        ]),
      ),
    ).toEqual(['a', '—', 'b']);
  });
});
