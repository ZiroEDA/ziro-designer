// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One upstream action carries ONE id, in every frame that offers it.
 *
 * An id in a toolbar or menu table IS the upstream action name. That is not a
 * convention, it is load-bearing: `ui/hotkeys_inventory.ts` folds the Hotkey
 * List on it the way `HOTKEY_STORE` folds on `action->GetName()`
 * (common/dialogs/panel_hotkeys_editor.cpp). Two spellings of one action
 * therefore produce TWO rows in the Hotkey List where KiCad shows one, and a
 * hotkey assigned on one row does not reach the other frame's button.
 *
 * The footprint editor had four of these. `ACTIONS::selectSetRect` /
 * `selectSetLasso` were spelled `select` / `selectLasso`, and the five
 * `PCB_ACTIONS::draw*Dimension` were spelled `dim*` — while the PCB editor,
 * which offers the very same actions on its own right toolbar
 * (`pcbnew/toolbars_pcb_editor.cpp`, `pcbnew/toolbars_footprint_editor.cpp`
 * lines 41-44 and 124-129), already used the upstream names.
 *
 * This is a per-action check rather than a set comparison. A "the two bars
 * agree" assertion passes while one action of seven is still misspelled,
 * because the disagreement is per-action and so is the damage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src/', import.meta.url));

const idsIn = (rel: string): Set<string> => {
  const text = readFileSync(join(SRC, rel), 'utf8');
  return new Set([...text.matchAll(/\bid:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]!));
};

/**
 * The actions the footprint editor and the PCB editor both put on a toolbar,
 * spelled as `common/tool/actions.cpp` and `pcbnew/tools/pcb_actions.cpp` name
 * them. Each was a rename; each is named here so removing one from the list
 * cannot quietly pass.
 */
const SHARED_WITH_PCB = [
  // `ACTIONS::selectSetRect` — "Selection modes" group, both right toolbars.
  'selectSetRect',
  // `ACTIONS::selectSetLasso` — same group.
  'selectSetLasso',
  // The five `PCB_ACTIONS::draw*Dimension`, "Dimension objects" group.
  'drawOrthogonalDimension',
  'drawAlignedDimension',
  'drawCenterDimension',
  'drawRadialDimension',
  'drawLeader',
] as const;

/** The spellings these replaced. None may come back, in either frame. */
const RETIRED = [
  'select',
  'selectLasso',
  'dimOrthogonal',
  'dimAligned',
  'dimCenter',
  'dimRadial',
  'dimLeader',
] as const;

describe('a shared action has one id across frames', () => {
  const fp = idsIn('editors/footprint/footprintToolbars.ts');
  const pcb = idsIn('editors/pcb/pcbToolbars.ts');

  for (const id of SHARED_WITH_PCB) {
    it(`the footprint editor spells it "${id}", as the PCB editor does`, () => {
      expect(fp.has(id), `footprint toolbar is missing ${id}`).toBe(true);
      expect(pcb.has(id), `PCB toolbar is missing ${id}`).toBe(true);
    });
  }

  for (const id of RETIRED) {
    it(`the footprint editor no longer spells any action "${id}"`, () => {
      expect(fp.has(id)).toBe(false);
    });
  }
});

describe('the footprint canvas gates on the renamed id', () => {
  /**
   * The rename is only half done if the toolbar says `selectSetRect` and the
   * canvas still compares against `'select'` — the button would light and
   * picking would be dead. Five sites in `FootprintCanvas.tsx` gate picking,
   * the box-select, the cursor and the tool-wants-cursor flag on it.
   */
  const canvas = readFileSync(join(SRC, 'editors/footprint/FootprintCanvas.tsx'), 'utf8');
  const editor = readFileSync(join(SRC, 'editors/footprint/FootprintEditor.tsx'), 'utf8');

  it('compares against selectSetRect, never the bare select', () => {
    expect(canvas).toContain("'selectSetRect'");
    expect(canvas).not.toContain("!== 'select'");
    expect(canvas).not.toContain("=== 'select'");
    expect(canvas).not.toContain("= 'select',");
  });

  it('starts the footprint editor on selectSetRect', () => {
    expect(editor).toContain("useState('selectSetRect')");
    expect(editor).not.toContain("useState('select')");
  });
});
