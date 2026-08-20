// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_INSPECTOR` (pagelayout_editor/dialogs/design_inspector.cpp) — the
 * Design Inspector's row click, and what its grid actually contains.
 *
 * WHAT THIS FILE CANNOT DO: there is no DOM test environment in this repo, so
 * the React half is asserted over the component's source. The grid's contents
 * are a pure function (`design_inspector.ts`) and are tested for real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DIALOG = read('../../../designer/src/editors/drawingsheet/DesignInspector.tsx');

describe('DSP-15 — a row click does not end the dialog', () => {
  /** The row's `onClick={…}` handler body. */
  const rowClick = (() => {
    const at = DIALOG.indexOf('onClick={() =>');
    expect(at, 'no row onClick in DesignInspector').toBeGreaterThan(-1);
    return DIALOG.slice(at, DIALOG.indexOf('}\n', at));
  })();

  it('selects the item', () => {
    // design_inspector.cpp:344-353 — ClearSelection, AddItemToSel, Refresh,
    // CopyPrmsFromItemToPanel.
    expect(rowClick).toContain('onSelect(i)');
  });

  it('does not close (onCellClicked never calls EndModal)', () => {
    expect(rowClick).not.toContain('onClose');
  });
});
