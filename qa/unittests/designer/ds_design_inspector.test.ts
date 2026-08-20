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
const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');

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

describe('DSP-16 — a row click selects, it does not re-zoom the view', () => {
  /** The `onSelect` the editor hands the inspector. */
  const onSelect = (() => {
    const at = EDITOR.indexOf('<DesignInspector');
    expect(at, 'DesignInspector is not rendered').toBeGreaterThan(-1);
    return EDITOR.slice(at, EDITOR.indexOf('/>', at));
  })();

  it('sets the selection', () => {
    expect(onSelect).toContain('setSelection(new Set([i]))');
  });

  it('leaves the zoom and the scroll position alone', () => {
    // onCellClicked calls GetCanvas()->Refresh() and nothing else: KiCad stayed
    // at Z 0.53 through a row click where ours jumped 1.12 -> 2.02 and
    // re-centred on the item.
    expect(onSelect).not.toContain('zoomToSelection');
    expect(onSelect).not.toContain('zoomToFit');
  });
});
