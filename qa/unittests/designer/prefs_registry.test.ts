// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences pages are reached by id, never by import, and are built only when
 * opened.
 *
 * Upstream this needs no test because the C++ makes it impossible: an app's
 * panels live in that app's KIFACE, `EDA_BASE_FRAME::ShowPreferences`
 * (`common/eda_base_frame.cpp:1585-1755`) can only say
 * `kiface->CreateKiWindow( parent, PANEL_<ID>, kiway )`, and no app includes
 * another app's header — eeschema cannot see `panel_pcbnew_color_settings.h`
 * even if someone wanted it to. `AddLazySubPage` then constructs the panel on
 * first open, so a KIFACE that is never asked is never loaded.
 *
 * We have no such barrier. Everything in `designer/src` can import everything
 * else, which is how the tree acquired 28 cross-editor imports and how
 * `PreferencesDialog.tsx` became one 1 800-line switch with every editor's
 * panels inlined. This walks the sources, as `menu_hotkey_coverage.test.ts` and
 * `view_controls_coverage.test.ts` do, so the next page added the wrong way
 * fails here rather than in a review.
 *
 * They are read as text because `qa`'s tsconfig sets no `--jsx` and so cannot
 * compile a `.tsx` at all.
 *
 * Note the lesson `view_controls_coverage.test.ts` learned the hard way: "the
 * right name appears somewhere in the file" is not an assertion. A file can
 * name the shared module and still do its own thing two lines later. So these
 * assert on the *absence* of a whole class of import, and on the exact form of
 * the ones that are allowed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PAGES } from '@ziroeda/designer/src/dialogs/prefs/registry.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const listing = (rel: string): string[] =>
  readdirSync(join(SRC, rel)).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

const SHELL = 'dialogs/PreferencesDialog.tsx';
const BOOK = 'dialogs/prefs/registry.ts';
const LOADER = 'dialogs/prefs/lazy_pages.ts';

/** Every editor that owns Preferences pages, and where they live. */
const EDITOR_PREFS: Record<string, string> = {
  schematic: 'editors/schematic/prefs',
  pcb: 'editors/pcb/prefs',
};

/** Every `import … from '<spec>'` in a source, static only. */
function staticImports(src: string): string[] {
  return [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1] as string);
}

/** Every `import('<spec>')` in a source, dynamic only. */
function dynamicImports(src: string): string[] {
  return [...src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] as string);
}

describe('the shell does not know any editor', () => {
  const src = read(SHELL);

  it('statically imports no editor panel, of any editor', () => {
    const offenders = staticImports(src).filter((s) => /editors\/.*\/prefs/.test(s));
    expect(offenders).toEqual([]);
  });

  it('statically imports no panel module at all', () => {
    const offenders = staticImports(src).filter((s) => /\/Panel[A-Z]/.test(s));
    expect(offenders).toEqual([]);
  });

  it('names no concrete panel component', () => {
    // A registry that is bypassed for one page reads exactly like a registry
    // that is used, unless the bypassed name is banned outright.
    const panels = Object.values(EDITOR_PREFS)
      .concat('dialogs/prefs/panels')
      .flatMap((dir) => listing(dir))
      .filter((f) => f.startsWith('Panel'))
      .map((f) => f.replace(/\.tsx?$/, ''));
    expect(panels.length).toBeGreaterThan(5);
    for (const name of panels) expect(src, `${SHELL} names ${name}`).not.toContain(name);
  });

  it('reaches editors only through the registry and the lazy loader', () => {
    // The one remaining `editors/` reference is a type: it erases at build
    // time, so it is not a runtime edge and cannot pull in a bundle. If that
    // ever becomes a value import, this fails.
    for (const spec of staticImports(src)) {
      if (!spec.includes('editors/')) continue;
      const line = src.split('\n').find((l) => l.includes(`from '${spec}'`)) ?? '';
      expect(line.trimStart(), spec).toMatch(/^import type /);
    }
  });
});

describe('pages are constructed lazily', () => {
  it('the loader reaches every owner by dynamic import only', () => {
    const src = read(LOADER);
    const owners = new Set(PAGES.flatMap((p) => (p.owner ? [p.owner] : [])));
    expect(owners.size).toBeGreaterThan(1);

    // Every owner module is behind an `import(...)`.
    const dyn = dynamicImports(src);
    expect(dyn.length).toBe(owners.size);

    // And none of them is ALSO imported statically, which would make the
    // dynamic import decorative: the bundle is pulled in either way.
    const stat = staticImports(src);
    for (const spec of dyn) expect(stat, `${spec} is also imported statically`).not.toContain(spec);
    expect(stat.filter((s) => /prefs\/(panels\/)?index/.test(s))).toEqual([]);
  });

  it('the page book pulls in no panel at all', () => {
    // registry.ts is the module `qa` imports; if it grew an edge to a panel it
    // would stop compiling here, but it would also stop the book being data.
    const src = read(BOOK);
    expect(staticImports(src)).toEqual(['./types.js']);
    expect(dynamicImports(src)).toEqual([]);
  });

  it('the loader does not eagerly construct pages at module scope', () => {
    const src = read(LOADER);
    expect(src).not.toMatch(/^const \w+ = createPrefsPanel\(/m);
    expect(src).toMatch(/await OWNERS\[owner\]\(\)/);
  });
});

describe('no editor reaches into another editor', () => {
  it.each(Object.entries(EDITOR_PREFS))('%s imports no other editor', (name, dir) => {
    const others = Object.entries(EDITOR_PREFS).filter(([n]) => n !== name);
    expect(others.length).toBeGreaterThan(0);
    for (const file of listing(dir)) {
      const src = read(join(dir, file));
      for (const spec of staticImports(src).concat(dynamicImports(src))) {
        for (const [otherName, otherDir] of others) {
          const leaf = otherDir.split('/')[1] as string;
          expect(spec, `${dir}/${file} -> ${otherName}`).not.toContain(`editors/${leaf}/`);
          expect(spec, `${dir}/${file} -> ${otherName}`).not.toContain(`../${leaf}/prefs`);
        }
      }
    }
  });

  it.each(Object.entries(EDITOR_PREFS))('%s imports the shell from nowhere', (_name, dir) => {
    // Dependency runs shell -> registry -> factory. An editor importing the
    // dialog back would close the loop and defeat the code split.
    for (const file of listing(dir)) {
      const src = read(join(dir, file));
      const back = staticImports(src)
        .concat(dynamicImports(src))
        .filter((spec) => /PreferencesDialog|lazy_pages/.test(spec));
      expect(back, file).toEqual([]);
    }
  });

  it('the generic pages import no editor pages', () => {
    for (const file of listing('dialogs/prefs/panels')) {
      const src = read(join('dialogs/prefs/panels', file));
      const offenders = staticImports(src)
        .concat(dynamicImports(src))
        .filter((s) => /editors\/[a-z]+\/prefs/.test(s));
      expect(offenders, file).toEqual([]);
    }
  });

  it('shares the Cross-probing group instead of one editor importing the other', () => {
    // Upstream writes this group twice, once in each panel
    // (eeschema/dialogs/panel_eeschema_display_options_base.cpp:33-60 and
    // pcbnew/dialogs/panel_display_options_base.cpp:168-193). We write it once,
    // which only stays legitimate while it lives above both editors.
    const users = [
      'editors/schematic/prefs/PanelEeschemaDisplayOptions.tsx',
      'editors/pcb/prefs/PanelPcbDisplayOptions.tsx',
    ];
    for (const rel of users) {
      expect(read(rel), rel).toContain("from '../../../dialogs/prefs/CrossProbingGroup.js'");
    }
  });
});
