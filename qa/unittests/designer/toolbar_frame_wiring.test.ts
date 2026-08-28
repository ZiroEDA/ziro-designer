// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every editor with a Toolbars page builds every one of its bars through
 * `useToolbarEntries`, and reaches its own default lists only through that
 * app's `DefaultToolbarConfig` map.
 *
 * The rendered half of this is `toolbar_customization_applies.test.tsx`, which
 * proves the hook honours the store. This is the half that says every bar goes
 * through the hook, and it is **per occurrence** on purpose: one toolbar left
 * wired straight to its module constant is exactly the bug — the page would
 * work for three bars of four — and a file-level "the editor mentions
 * `useToolbarEntries` somewhere" would pass with the other three hard-wired.
 *
 * Upstream there is nothing to check, because there is one place a toolbar can
 * be filled from: `EDA_BASE_FRAME::RecreateToolbars`
 * (`common/eda_base_frame.cpp:1728-1843`) asks
 * `GetToolbarConfig( loc, config()->m_CustomToolbars )` four times and a frame
 * has no way to reach `DefaultToolbarConfig` around it.
 *
 * Read as text because `qa`'s tsconfig sets no `--jsx` and cannot compile a
 * `.tsx` at all — the same reason `prefs_registry.test.ts` walks sources.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ToolbarApp } from '@ziroeda/designer/src/prefs/settings.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/**
 * The frames whose app has a Toolbars page, with the number of toolbars that
 * app's `DefaultToolbarConfig` answers for and the constants the frame must no
 * longer reach for.
 *
 * The bar counts are upstream's: pl_editor and eeschema `return std::nullopt`
 * for `TOOLBAR_LOC::TOP_AUX` (`toolbars_pl_editor.cpp:42`,
 * `toolbars_sch_editor.cpp:67`), pcbnew has all four
 * (`toolbars_pcb_editor.cpp:148, 212, 302, 365`).
 *
 * `banned` is that app's own default lists, transcribed from its toolbar
 * module. It is deliberately not every ALL-CAPS name in the file: `PcbEditor`
 * legitimately renders the 3D viewer's toolbar from `VIEWER3D_TOP_TOOLBAR`,
 * because `EDA_3D_VIEWER_FRAME` is a different frame with a
 * `3d_viewer-toolbars` store of its own, and no Preferences heading here yet.
 */
const FRAMES: {
  app: ToolbarApp;
  file: string;
  bars: number;
  banned: string[];
}[] = [
  {
    app: 'pl_editor',
    file: 'editors/drawingsheet/DrawingSheetEditor.tsx',
    bars: 3,
    banned: ['DS_TOP_TOOLBAR', 'DS_LEFT_TOOLBAR', 'DS_RIGHT_TOOLBAR'],
  },
  {
    app: 'eeschema',
    file: 'editors/schematic/SchematicEditor.tsx',
    bars: 3,
    banned: ['TOP_TOOLBAR', 'LEFT_TOOLBAR', 'RIGHT_TOOLBAR'],
  },
  {
    app: 'pcbnew',
    file: 'editors/pcb/PcbEditor.tsx',
    bars: 4,
    banned: ['PCB_TOP_TOOLBAR', 'PCB_AUX_TOOLBAR', 'PCB_LEFT_TOOLBAR', 'PCB_RIGHT_TOOLBAR'],
  },
];

describe('every editor with a Toolbars page builds every bar through the hook', () => {
  it.each(FRAMES)('$file', ({ app, file, bars, banned }) => {
    const src = read(file);

    // One `useToolbarEntries` call per toolbar the app has, each naming that
    // app and that app's own defaults map.
    const calls = [...src.matchAll(/useToolbarEntries\(\s*'([a-z_]+)',\s*'([A-Z_]+)'/g)];
    expect(calls.length, `${file}: one call per toolbar`).toBe(bars);
    for (const c of calls) expect(c[1], `${file} asks for the wrong app`).toBe(app);
    // Every location asked for exactly once, so two bars cannot share one.
    const locs = calls.map((c) => c[2]);
    expect(new Set(locs).size).toBe(locs.length);

    // And nothing bypasses it. Per occurrence: not one `entries=` on the page
    // may still be that app's own default list.
    const props = [...src.matchAll(/\bentries=\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1] as string);
    expect(props.length, `${file}: an entries= for every bar`).toBeGreaterThanOrEqual(bars);
    for (const name of props)
      expect(banned, `${file}: entries={${name}} bypasses the toolbar store`).not.toContain(name);
  });

  it('leaves each app’s default lists reachable only through its defaults map', () => {
    // A frame that still imported `DS_TOP_TOOLBAR` could quietly go back to
    // using it, and nothing above would notice until it did.
    for (const { file, banned } of FRAMES) {
      const src = read(file);
      const imported = [...src.matchAll(/import \{([^}]*)\} from '[^']*'/g)]
        .flatMap((m) => (m[1] as string).split(','))
        .map((t) => t.trim().split(/\s+as\s+/)[0] as string)
        .filter(Boolean);
      for (const name of banned)
        expect(imported, `${file} still imports ${name}`).not.toContain(name);
    }
  });
});
