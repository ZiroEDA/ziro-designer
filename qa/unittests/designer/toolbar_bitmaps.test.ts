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
import {
  SYM_TOP_TOOLBAR,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import {
  PCB_TOP_TOOLBAR,
  PCB_AUX_TOOLBAR,
  PCB_LEFT_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import {
  FP_TOP_TOOLBAR,
  FP_LEFT_TOOLBAR,
  FP_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import {
  GBR_TOP_TOOLBAR,
  GBR_TOP_AUX_TOOLBAR,
  GBR_LEFT_TOOLBAR,
} from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import {
  DS_TOP_TOOLBAR,
  DS_LEFT_TOOLBAR,
  DS_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { VIEWER3D_TOP_TOOLBAR } from '@ziroeda/designer/src/editors/pcb/viewer3dToolbars.js';
import type { ToolButton, ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';

const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) =>
    e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e || 'spacer' in e ? [] : [e],
  );

const ALL = [...buttons(TOP_TOOLBAR), ...buttons(LEFT_TOOLBAR), ...buttons(RIGHT_TOOLBAR)];

/**
 * Every editor's inventory, by name, because this file used to cover the
 * SCHEMATIC's three bars and nothing else — "a rule scoped to the directory a
 * bug was found in", which is one of the four shapes of test that cannot fail.
 *
 * It could not fail for `saveAll`. `ACTIONS::saveAll` carries
 * `.Icon( BITMAPS::save_all )` (`common/tool/actions.cpp:118`) and the Symbol
 * Editor's top bar is the only one that mounts it
 * (`toolbars_symbol_editor.cpp:112`); with no `saveAll` row in `BITMAP` and no
 * `save_all.svg` vendored, `toolbarIconUrl` returned undefined and the button
 * painted the fallback glyph — an empty box where KiCad draws two stacked
 * floppies. The schematic bars have no Save All, so nothing here saw it.
 */
const BARS: Readonly<Record<string, readonly ToolEntry[]>> = {
  'schematic top': TOP_TOOLBAR,
  'schematic left': LEFT_TOOLBAR,
  'schematic right': RIGHT_TOOLBAR,
  'symbol top': SYM_TOP_TOOLBAR,
  'symbol left': SYM_LEFT_TOOLBAR,
  'symbol right': SYM_RIGHT_TOOLBAR,
  'pcb top': PCB_TOP_TOOLBAR,
  'pcb aux': PCB_AUX_TOOLBAR,
  'pcb left': PCB_LEFT_TOOLBAR,
  'pcb right': PCB_RIGHT_TOOLBAR,
  'footprint top': FP_TOP_TOOLBAR,
  'footprint left': FP_LEFT_TOOLBAR,
  'footprint right': FP_RIGHT_TOOLBAR,
  'gerbview top': GBR_TOP_TOOLBAR,
  'gerbview aux': GBR_TOP_AUX_TOOLBAR,
  'gerbview left': GBR_LEFT_TOOLBAR,
  'drawing sheet top': DS_TOP_TOOLBAR,
  'drawing sheet left': DS_LEFT_TOOLBAR,
  'drawing sheet right': DS_RIGHT_TOOLBAR,
  '3d viewer top': VIEWER3D_TOP_TOOLBAR,
};

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

describe('every editor, not only the schematic', () => {
  it('mounts a bar in each of them (guards a broken import)', () => {
    // Entries, not buttons: GerbView's TOP_AUX is four `AppendControl` combos
    // and two separators (`gerbview/toolbars_gerber.cpp`), with no button on it
    // at all, so "has buttons" would be a false claim about that one bar.
    for (const [name, bar] of Object.entries(BARS))
      expect([name, bar.length > 0]).toEqual([name, true]);
  });

  /**
   * Per BUTTON, and reported with the bar it is on. A single flat list would
   * pass the moment one editor is right, which is the per-occurrence trap this
   * file already documents for the schematic and then did not apply anywhere
   * else.
   */
  it('resolves every button on every bar to a vendored KiCad icon', () => {
    const bad: string[] = [];
    for (const [name, bar] of Object.entries(BARS)) {
      for (const b of buttons(bar)) {
        const file = BITMAP[b.id] ?? BITMAP[b.icon];
        if (!file) bad.push(`${name}: ${b.id} (icon ${b.icon}) is in no BITMAP row`);
        else if (!VENDORED.has(file)) bad.push(`${name}: ${b.id} -> ${file}.svg is not vendored`);
      }
    }
    expect(bad).toEqual([]);
  });

  /** The row and the file the Symbol Editor's Save All button needs, named so
   *  that deleting either fails here and not only in the sweep above. */
  it('gives ACTIONS::saveAll BITMAPS::save_all', () => {
    expect(BITMAP.saveAll).toBe('save_all');
    expect(VENDORED.has('save_all')).toBe(true);
  });
});
