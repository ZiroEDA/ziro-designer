// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A KiCad menu shows no icons, and the reason is not the one you would guess.
 *
 * `appearance.use_icons_in_menus` defaults to **true** on Linux — it is false
 * only under `__WXMAC__` (common_settings.cpp:88-99) — and `ACTION_MENU::Add`
 * really does attach a bitmap, `KIUI::AddBitmapToMenuItem( item,
 * KiBitmapBundle( aIcon ) )` (action_menu.cpp:159).
 *
 * GTK3 then draws nothing. `gtk-menu-images` was deprecated and disabled
 * upstream, so menu-item images do not render at all. The setting is on, the
 * bitmap is attached, and the gutter is empty.
 *
 * So the parity target is what the installed build SHOWS, not what its settings
 * ask for. [px] measured on a real Schematic Editor File menu: an empty icon
 * gutter, where ours drew bitmaps beside Save, Print and Plot.
 *
 * The check mark is different and stays: a `wxITEM_CHECK` item is not a bitmap,
 * and GTK renders it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MENUBAR = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/MenuBar.tsx', import.meta.url)),
  'utf8',
);
/** Comments stripped — prose about the rule must not read as the rule. */
const CODE = MENUBAR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('menu rows carry no bitmap, as GTK renders none', () => {
  it('renders no icon image in a menu row', () => {
    expect(CODE).not.toMatch(/toolbarIconUrl/);
    expect(CODE).not.toMatch(/<img[^>]*item\.icon/);
  });

  it('still renders the check mark, which is not a bitmap', () => {
    expect(CODE).toMatch(/item\.checked/);
    expect(CODE).toContain('mcheck');
  });

  it('is fixed in the SHARED menu renderer, so every launcher inherits it', () => {
    // One MenuBar for the whole app: the project manager and all eight editors
    // render through this file, so this is one fix rather than nine.
    expect(MENUBAR).toContain('ze-dropdown');
    expect(MENUBAR).toContain('ze-mitem');
  });
});
