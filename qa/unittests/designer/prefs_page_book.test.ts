// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Preferences book: the same pages, in the same order, with the same
 * labels, as before the dialog was split into a shell plus a registry.
 *
 * Upstream the book is an explicit run of `AddPage` / `AddLazySubPage` calls in
 * `EDA_BASE_FRAME::ShowPreferences` (`common/eda_base_frame.cpp:1573-1755`), so
 * the order is source order and a page cannot go missing without deleting a
 * line. Ours used to be a `PAGES` array next to a `switch (page)` in the one
 * file that rendered them; now the array is `dialogs/prefs/registry.ts` and the
 * panels live in three different modules that the registry reaches by id.
 *
 * That is exactly the shape in which a page can be dropped, renamed or
 * reordered by accident, and nothing else would fail. The expected list below
 * is transcribed from `designer/src/prefs/PreferencesDialog.tsx` as it stood at
 * 5d6a2f40, the commit this refactor started from.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  FIRST_PAGE,
  PAGES,
  labelOf,
  ownerOf,
  type PrefsPageEntry,
} from '@ziroeda/designer/src/dialogs/prefs/registry.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/**
 * The book as the dialog rendered it before the split. Headings are `id: null`
 * — upstream's `AddPage( new wxPanel( book ), … )`, a tree node with no panel.
 */
const EXPECTED: PrefsPageEntry[] = [
  { id: 'common', label: 'Common', owner: 'generic' },
  { id: 'mouse', label: 'Mouse and Touchpad', owner: 'generic' },
  { id: 'hotkeys', label: 'Hotkeys', owner: 'generic' },
  { id: null, label: 'Schematic Editor' },
  { id: 'sch-display', label: 'Display Options', indent: true, owner: 'schematic' },
  { id: 'sch-grids', label: 'Grids', indent: true, owner: 'schematic' },
  { id: 'sch-editing', label: 'Editing Options', indent: true, owner: 'schematic' },
  { id: 'sch-annotation', label: 'Annotation Options', indent: true, owner: 'schematic' },
  { id: 'sch-colors', label: 'Colors', indent: true, owner: 'schematic' },
  { id: 'sch-fields', label: 'Field Name Templates', indent: true, owner: 'schematic' },
  { id: null, label: 'PCB Editor' },
  { id: 'pcb-display', label: 'Display Options', indent: true, owner: 'pcb' },
];

describe('the Preferences page book', () => {
  it('is the same pages in the same order with the same labels', () => {
    expect(PAGES).toEqual(EXPECTED);
  });

  // toEqual on the whole array reports "arrays differ"; these two say which
  // page and how, so a reorder is not mistaken for a rename.
  it('has the ids in the order the dialog rendered them', () => {
    expect(PAGES.map((p) => p.id)).toEqual(EXPECTED.map((p) => p.id));
  });

  it('has the labels the dialog rendered them under', () => {
    expect(PAGES.map((p) => p.label)).toEqual(EXPECTED.map((p) => p.label));
  });

  it('opens on the first selectable page', () => {
    expect(FIRST_PAGE).toBe(PAGES.find((p) => p.id !== null)?.id);
  });

  it('has no duplicate ids', () => {
    const ids = PAGES.map((p) => p.id).filter((id) => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every page an owner, and no heading one', () => {
    for (const p of PAGES) {
      if (p.id === null) expect(p.owner, p.label).toBeUndefined();
      else expect(ownerOf(p.id), p.id).toBeDefined();
    }
  });

  it('resolves a label for every page id', () => {
    for (const p of PAGES) if (p.id !== null) expect(labelOf(p.id)).toBe(p.label);
  });
});

/**
 * The other half of the same invariant, from the panels' side: dropping a page
 * from `PAGES` *and* from the expected list above would still leave the panel
 * behind, and adding one to `PAGES` without a `case` for it would throw only
 * when a user clicked it. Each owning module's `CreateKiWindow` switch must
 * construct exactly the ids the registry assigns to it.
 */
const OWNER_SOURCES: Record<string, string> = {
  generic: 'dialogs/prefs/panels/index.ts',
  schematic: 'editors/schematic/prefs/index.ts',
  pcb: 'editors/pcb/prefs/index.ts',
};

describe('every page id is constructed by its owner', () => {
  it.each(Object.entries(OWNER_SOURCES))('%s constructs exactly its own ids', (owner, rel) => {
    const src = read(rel);
    const cases = [...src.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]).sort();
    const mine = PAGES.filter((p) => p.owner === owner)
      .map((p) => p.id as string)
      .sort();
    expect(cases).toEqual(mine);
  });

  it('leaves no page id unowned by any factory', () => {
    const constructed = new Set(
      Object.values(OWNER_SOURCES).flatMap((rel) =>
        [...read(rel).matchAll(/case '([a-z-]+)':/g)].map((m) => m[1] as string),
      ),
    );
    for (const p of PAGES) if (p.id !== null) expect(constructed.has(p.id), p.id).toBe(true);
  });
});
