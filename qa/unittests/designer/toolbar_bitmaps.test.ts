// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every toolbar button wears KiCad's own icon.
 *
 * `Toolbar.tsx` resolves a button's artwork as
 *
 *     toolbarIconUrl(b.id) ?? toolbarIconUrl(b.icon)
 *
 * against the vendored SVGs in `designer/src/assets/toolbar/`, and falls back to
 * the hand-drawn line glyph in `icons.tsx` when neither name is mapped. That
 * fallback is the problem this file guards: a key that matches no button, or a
 * button whose id was renamed out from under its key, produces no error at all
 * — the button simply shows a home-made glyph that looks intentional.
 *
 * Which is what happened. The table said `syncAllSheetsPins`, upstream's action
 * name, while the button's id was `syncAllSheetPins` (the name our handler
 * dispatches on), so Sync All Sheet Pins wore a generic pair of refresh arrows
 * instead of `BITMAPS::import_hierarchical_label` — the file was vendored and
 * sitting there unused the whole time. The two ellipse tools had the same gap,
 * under `drawEllipse` / `drawEllipseArc`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { BITMAP } from '@ziroeda/designer/src/ui/toolbar_bitmaps.js';
import {
  TOP_TOOLBAR,
  LEFT_TOOLBAR,
  RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import type { ToolButton, ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';

const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) => (e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e ? [] : [e]));

const ALL = [...buttons(TOP_TOOLBAR), ...buttons(LEFT_TOOLBAR), ...buttons(RIGHT_TOOLBAR)];

/** The vendored bitmap names, i.e. assets/toolbar/*.svg without the extension. */
const VENDORED = new Set(
  readdirSync(new URL('../../../designer/src/assets/toolbar', import.meta.url))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4)),
);

describe('the schematic toolbars', () => {
  it('have buttons at all (guards a broken import)', () => {
    expect(ALL.length).toBeGreaterThan(60);
  });

  it('every button resolves to a KiCad icon, by id or by icon name', () => {
    const unmapped = ALL.filter((b) => !BITMAP[b.id] && !BITMAP[b.icon]).map(
      (b) => `${b.id} (icon ${b.icon})`,
    );
    expect(unmapped).toEqual([]);
  });

  it('and the file that name points at is actually vendored', () => {
    // A typo in the bitmap name fails the same silent way: the glob lookup
    // misses and the fallback glyph appears.
    const missing = ALL.map((b) => BITMAP[b.id] ?? BITMAP[b.icon])
      .filter((n): n is string => !!n)
      .filter((n) => !VENDORED.has(n));
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('the bitmap table', () => {
  it('names no file that is not vendored', () => {
    // Covers the pcb and symbol editors' entries too, which this file does not
    // otherwise reach.
    const dangling = Object.entries(BITMAP)
      .filter(([, name]) => !VENDORED.has(name))
      .map(([id, name]) => `${id} -> ${name}`);
    expect(dangling).toEqual([]);
  });

  it('gives both sync actions import_hierarchical_label', () => {
    // `SCH_ACTIONS::syncSheetPins` and `syncAllSheetsPins` both carry
    // `.Icon( BITMAPS::import_hierarchical_label )`.
    expect(BITMAP.syncSheetPins).toBe('import_hierarchical_label');
    expect(BITMAP.syncAllSheetPins).toBe('import_hierarchical_label');
  });

  it('and the two ellipse tools their own shapes', () => {
    expect(BITMAP.ellipse).toBe('add_ellipse');
    expect(BITMAP.ellipseArc).toBe('add_ellipse_arc');
  });
});
