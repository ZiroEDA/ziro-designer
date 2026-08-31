// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Right-clicking inside a selection keeps the selection.
 *
 * The report: "when I have selected a whole component, right-clicking even on
 * the text should not open the text menu". It is upstream's rule and the whole
 * rule — `PCB_SELECTION_TOOL::Main` (pcb_selection_tool.cpp:359-379) re-picks on
 * a right-click **only** when the selection is empty:
 *
 *     if( m_selection.Empty() )
 *     {
 *         selectPoint( evt->Position(), false, &selectionCancelled );
 *         m_selection.SetIsHover( true );
 *     }
 *     …
 *     m_menu->ShowContextMenu( m_selection );
 *
 * Ours re-picked whenever the top hit was not itself in the selection, so every
 * field, pad and silk line *inside* a selected footprint stole the selection and
 * opened its own menu — the menu is built entirely from the selection, so the
 * wrong selection is the wrong menu.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contextMenuPick } from '@ziroeda/designer/src/editors/pcb/pcb_context_selection.js';

const FOOTPRINT = new Set(['footprint:5']);

describe('contextMenuPick (PCB_SELECTION_TOOL::Main, BUT_RIGHT)', () => {
  it('picks the item under the cursor when nothing is selected', () => {
    expect(contextMenuPick(new Set(), 'fptext:5:0')).toBe('fptext:5:0');
    expect(contextMenuPick(new Set(), 'footprint:5')).toBe('footprint:5');
  });

  it('picks nothing on bare canvas with nothing selected', () => {
    expect(contextMenuPick(new Set(), null)).toBeNull();
  });

  it('leaves a selection alone when the click lands on one of its parts', () => {
    // The reported case: the footprint is selected, the pointer is over its
    // reference text. The text is a different item id and is not in the
    // selection — which under the old rule was the whole test, and was wrong.
    expect(contextMenuPick(FOOTPRINT, 'fptext:5:0')).toBeNull();
    expect(contextMenuPick(FOOTPRINT, 'pad:5:1')).toBeNull();
  });

  it('leaves a selection alone even for an unrelated item', () => {
    // pcbnew has no "clicked outside the selection" branch at all. eeschema
    // does (sch_selection_tool.cpp:659), and copying it here would be inventing
    // behaviour for this editor.
    expect(contextMenuPick(FOOTPRINT, 'track:12')).toBeNull();
    expect(contextMenuPick(FOOTPRINT, 'footprint:1')).toBeNull();
  });

  it('leaves a selection alone over bare canvas', () => {
    expect(contextMenuPick(FOOTPRINT, null)).toBeNull();
  });

  it('holds for a multi-item selection, which is what the report was about', () => {
    const many = new Set(['footprint:5', 'footprint:1', 'track:3']);
    expect(contextMenuPick(many, 'fptext:1:0')).toBeNull();
    expect(contextMenuPick(many, 'zone:0')).toBeNull();
    expect(contextMenuPick(many, null)).toBeNull();
  });
});

describe('the editor asks it', () => {
  /**
   * `PcbEditor.tsx` as text: qa's tsc has no `--jsx`, so the call site cannot be
   * imported, and a rule stated in a module nothing calls is not a rule.
   * `pcb_move_ghost.test.ts` reads the same file for the same reason.
   */
  const text = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
    'utf8',
  );

  it('routes the right-click through contextMenuPick', () => {
    expect(text).toContain("import { contextMenuPick } from './pcb_context_selection.js';");
    expect(text).toContain(
      'const pick = contextMenuPick(selForDrawRef.current, hitCandidates(w)[0] ?? null);',
    );
  });

  it('has no second, unguarded route back to applySelect on right-click', () => {
    // The line this replaced. If it ever comes back the module above is dead
    // code and every test in it passes anyway.
    expect(text).not.toContain('if (hit && !selForDrawRef.current.has(hit)) applySelect(hit');
  });
});
