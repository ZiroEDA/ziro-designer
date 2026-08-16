// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The imported template manifest, pinned against BuildTemplateList.
 *
 * These are facts about KiCad's own templates that tools/templates/import.mjs
 * has to reproduce, and each has already been got wrong once. The manifest is
 * checked in, so the assertions run without KiCad installed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;

interface Entry {
  id: string;
  base: string;
  title: string;
  description: string;
  icon: string | null;
  html: string;
  category: 'user' | 'system';
  files: string[];
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, 'designer/public/templates/index.json'), 'utf8'),
) as { templates: Entry[] };

const byId = (id: string): Entry | undefined => manifest.templates.find((t) => t.id === id);

describe('the imported template manifest', () => {
  it('imported every template KiCad ships', () => {
    expect(manifest.templates.length).toBeGreaterThanOrEqual(20);
  });

  it('titles each card with its directory name', () => {
    // PROJECT_TEMPLATE's constructor ends `m_title = GetPrjDirName()`, which
    // makes GetTitle()'s parse of <title> in meta/info.html unreachable. The
    // real dialog reads "API_Series-500", not "API Series 500 - Audio Devices".
    for (const t of manifest.templates) expect(t.title).toBe(t.id);
  });

  it('marks `default` a user template and the bundled ones system', () => {
    // KICAD_USER_TEMPLATE_DIR always has a value - common_settings.cpp registers
    // it with PATHS::GetUserTemplatesPath() - so NewProject fills
    // userTemplatesPath, blanks the separate default scan because the seeded
    // default lives inside it, and what is left is
    // scanDirectory( m_userTemplatesPath, true ).
    expect(byId('default')?.category).toBe('user');

    const system = manifest.templates.filter((t) => t.category === 'system');
    expect(system.length).toBe(manifest.templates.length - 1);
    expect(byId('Arduino_Uno')?.category).toBe('system');
  });

  it('leaves the icon null where the template ships none', () => {
    // SetTemplate falls back to KiBitmapBundleDef( BITMAPS::icon_kicad, 48 ) for
    // these two, so a null here is the signal for that, not a broken import.
    expect(byId('default')?.icon).toBeNull();
    expect(byId('STM32H7_DevEBox')?.icon).toBeNull();

    const withIcons = manifest.templates.filter((t) => t.icon !== null);
    expect(withIcons.length).toBe(manifest.templates.length - 2);
    for (const t of withIcons) expect(t.icon).toBe(`/templates/${t.id}/meta/icon.png`);
  });

  it('points every template at its own meta/info.html', () => {
    // LoadTemplatePreview loads this file; a template with no info.html is not
    // a template as far as BuildTemplateList is concerned.
    for (const t of manifest.templates) {
      expect(t.html).toBe(`/templates/${encodeURIComponent(t.id)}/meta/info.html`);
    }
  });

  it('keeps meta out of the project file list', () => {
    // GetFileList()'s traverser skips the meta directory, so nothing under it
    // is ever copied into a new project.
    for (const t of manifest.templates) {
      for (const f of t.files) expect(f.startsWith('meta/')).toBe(false);
    }
  });

  it('names a .kicad_pro basename to rename for each real template', () => {
    // CreateProject swaps this basename for the project name.
    for (const t of manifest.templates) {
      if (t.files.length === 0) continue;
      expect(t.base).not.toBe('');
    }
  });
});
