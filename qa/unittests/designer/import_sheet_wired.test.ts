// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Import > Sheet (`SCH_ACTIONS::importSheet`).
 *
 * Upstream's `SCH_DRAWING_TOOLS::ImportSheet` loads another schematic, selects
 * everything it brought in and moves it to the cursor. That is what paste
 * already does here, so the feature is paste sourced from a file — and
 * `parsePastedText` already accepts a whole `(kicad_sch …)` document, which is
 * the part that would otherwise have needed a reader of its own.
 *
 * The guard that matters is the menubar one: an entry implemented but left
 * `disabled` is unreachable, and nothing else in the suite would notice.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { parsePastedText } from '@ziroeda/eeschema/src/tools/clipboard.js';
import { buildMenus } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/** Every handler is a no-op; we are inspecting structure, not behaviour. */
const handlers = new Proxy({}, { get: () => () => {} }) as Parameters<typeof buildMenus>[0];

function walk(items: readonly MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    out.push(it);
    const sub = it.submenu ?? it.items;
    if (sub) out.push(...walk(sub));
  }
  return out;
}

const entry = (label: string): MenuItem | undefined => {
  const menus: Menu[] = buildMenus(handlers);
  return menus.flatMap((m) => walk(m.items)).find((i) => i.label === label);
};

describe('the menu entry', () => {
  it('exists and is reachable', () => {
    // It was `stub('Import Sheet...')` — present, greyed out, doing nothing.
    const e = entry('Import Sheet...');
    expect(e).toBeDefined();
    expect(e?.disabled ?? false).toBe(false);
  });

  it('dispatches the id the editor listens for', () => {
    // The id is captured in the item's closure rather than stored on it, so the
    // only honest check is to fire it and see what comes out. That also pins
    // the half that a rename would otherwise break silently: the menu and the
    // editor's `else if (id === …)` are matched by string alone.
    const seen: string[] = [];
    const spy = new Proxy({}, { get: () => (id: string) => seen.push(id) }) as Parameters<
      typeof buildMenus
    >[0];
    const menus: Menu[] = buildMenus(spy);
    const item = menus.flatMap((m) => walk(m.items)).find((i) => i.label === 'Import Sheet...');
    item?.action?.();
    expect(seen).toEqual(['importSheet']);
  });
});

describe('what a picked file turns into', () => {
  const SRC = `(kicad_sch (version 20250114) (generator "test") (paper "A4") (lib_symbols)
    (wire (pts (xy 10 10) (xy 20 10)) (uuid "w1"))
    (junction (at 20 10) (diameter 0) (color 0 0 0 0) (uuid "j1"))
    (text "note" (at 30 30 0) (effects (font (size 1.27 1.27))) (uuid "t1")))`;
  const target = () =>
    readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`));

  it('is a placeable payload, not a replacement document', () => {
    // The distinction the separate file input exists to protect: importing adds
    // to the open sheet, opening replaces it.
    const payload = parsePastedText(SRC, target(), 'unique');
    expect(payload).not.toBeNull();
    expect(payload!.batch.lines).toHaveLength(1);
    expect(payload!.batch.junctions).toHaveLength(1);
    expect(payload!.batch.labels).toHaveLength(1);
  });

  it('and a file with nothing in it yields an empty batch, not a crash', () => {
    const payload = parsePastedText(
      `(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`,
      target(),
      'unique',
    );
    expect(payload?.batch.lines ?? []).toHaveLength(0);
  });
});
