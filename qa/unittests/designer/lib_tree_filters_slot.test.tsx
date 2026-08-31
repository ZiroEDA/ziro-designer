// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_TREE`'s filters slot — the seam the two choosers share.
 *
 * Upstream builds it in the TREE, under a flag, between the search control and
 * the tree control:
 *
 *     if( aFlags & FILTERS )
 *     {
 *         m_filtersSizer = new wxBoxSizer( wxVERTICAL );
 *         sizer->Add( m_filtersSizer, 0, wxEXPAND | wxLEFT, 4 );
 *     }
 *     (common/widgets/lib_tree.cpp:165-169)
 *
 * and the tree owns the SLOT and nothing else. `PANEL_FOOTPRINT_CHOOSER::
 * GetFiltersSizer()` is a one-line forward to it, and FOOTPRINT_CHOOSER_FRAME
 * is what puts the "Apply footprint filters" and "Filter by pin count"
 * checkboxes in — because only the frame knows the symbol's fp_filters and pin
 * count, which reach it by KIWAY mail. That is why the slot exists at all
 * rather than the checkboxes living in the tree or the panel.
 *
 * So this is where the footprint chooser and the symbol chooser are allowed to
 * share code, and the only place: upstream keeps PANEL_SYMBOL_CHOOSER and
 * PANEL_FOOTPRINT_CHOOSER as separate classes and shares LIB_TREE between them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';

afterEach(cleanup);

class Adapter extends LibTreeModelAdapter {}

const tree = (filters?: React.ReactNode) =>
  render(
    <LibTree adapter={new Adapter()} filters={filters} onSelect={() => {}} onChoose={() => {}} />,
  );

describe('the tree owns the slot, gated the way the flag gates it', () => {
  it('builds no slot when the owner passes none', () => {
    // `if( aFlags & FILTERS )` unset: there is no sizer, so there is no gap
    // between the search control and the tree either.
    const { container } = tree();
    expect(container.querySelector('.ze-libtree-filters')).toBeNull();
  });

  it('builds one when the owner passes something', () => {
    const { container } = tree(<label>Filter by pin count (2)</label>);
    const slot = container.querySelector('.ze-libtree-filters');
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toContain('Filter by pin count (2)');
  });

  it('puts it between the search control and the tree, as the sizer does', () => {
    const { container } = tree(<label>x</label>);
    const kids = [...container.querySelector('.ze-libtree')!.children];
    const search = kids.findIndex((e) => e.classList.contains('ze-libtree-search'));
    const slot = kids.findIndex((e) => e.classList.contains('ze-libtree-filters'));
    const ctrl = kids.findIndex((e) => e.classList.contains('ze-libtree-tree'));
    expect(search).toBeGreaterThanOrEqual(0);
    expect(slot).toBe(search + 1);
    expect(ctrl).toBe(slot + 1);
  });

  it('holds more than one filter, stacked', () => {
    // `wxBoxSizer( wxVERTICAL )` — the frame adds two checkboxes to it.
    const { container } = tree(
      <>
        <label>Apply footprint filters (TerminalBlock*:*)</label>
        <label>Filter by pin count (2)</label>
      </>,
    );
    expect(container.querySelectorAll('.ze-libtree-filters > label')).toHaveLength(2);
  });
});
