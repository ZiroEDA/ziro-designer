// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Choose Symbol dialog shows no loading indicator, because upstream's does
 * not.
 *
 * `LIB_TREE` (common/widgets/lib_tree.cpp) has no loading state: by the time it
 * is constructed `IFACE::PreloadLibraries` has already run, so it lists the
 * libraries that loaded and simply omits the ones that have not
 * (`SYMBOL_TREE_MODEL_ADAPTER::AddLibraries` puts an unloaded nickname in
 * `m_pending_load_libraries` and moves on, eeschema/symbol_tree_model_adapter.cpp:129-138).
 * The only thing that says a load is in flight is the dialog TITLE's item count
 * and the background job monitor in the status bar.
 *
 * `SYMBOL_PREVIEW_WIDGET` likewise: `SetStatusText`
 * (eeschema/widgets/symbol_preview_widget.cpp:141-148) is its whole text
 * surface and none of its callers passes a loading message
 * (panel_symbol_chooser.cpp:672 passes "No symbol selected"; :577 and :590 pass
 * the footprint ones).
 *
 * Rendered rather than grepped: a `<LibraryLoadingPanel>` behind a condition
 * that happens to be false today and a component that no longer exists look the
 * same to a source scan, and only one of them is the fix.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { SymbolPreviewWidget } from '@ziroeda/designer/src/editors/schematic/widgets/symbol_preview_widget.js';
import { FootprintPreviewWidget } from '@ziroeda/designer/src/widgets/footprint_preview_widget.js';

afterEach(cleanup);

/** A tree with only the two always-present groups, i.e. nothing loaded yet —
 *  the state that used to raise the spinner. */
function emptyAdapter(): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  adapter.addGroup('-- Recently Used --');
  adapter.addGroup('-- Already Placed --');
  return adapter;
}

describe('the tree pane', () => {
  it('shows no spinner and no "Loading" text while its libraries are still arriving', () => {
    const { container } = render(
      <LibTree adapter={emptyAdapter()} onSelect={() => {}} onChoose={() => {}} />,
    );

    expect(container.querySelector('.ze-lib-loading-panel')).toBeNull();
    expect(container.querySelector('.ze-spinner')).toBeNull();
    expect(container.textContent).not.toMatch(/Loading/i);
  });

  it('says "No matches" only when there is genuinely not one row', () => {
    // Upstream draws nothing here; ours says so, because a hosted library that
    // failed to arrive and a filter that matched nothing look identical
    // otherwise. It is NOT a loading state: the group-only tree above, which is
    // what "still arriving" looks like, gets no message at all.
    render(<LibTree adapter={new LibTreeModelAdapter()} onSelect={() => {}} onChoose={() => {}} />);
    expect(screen.getByText('No matches')).not.toBeNull();
  });

  it('and says nothing while the groups are the only rows', () => {
    const { container } = render(
      <LibTree adapter={emptyAdapter()} onSelect={() => {}} onChoose={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/No matches/);
  });

  it('and says nothing at all once there are rows', () => {
    const adapter = emptyAdapter();
    adapter.addLibrary('Device', 'Devices', false);
    const { container } = render(
      <LibTree adapter={adapter} onSelect={() => {}} onChoose={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/No matches/);
    expect(container.querySelector('.ze-lib-loading-panel')).toBeNull();
  });
});

describe('the preview panes', () => {
  it('the symbol preview shows its status text and never a spinner', () => {
    const { container } = render(
      <SymbolPreviewWidget symbol={null} statusText="No symbol selected" />,
    );
    expect(screen.getByText('No symbol selected')).not.toBeNull();
    expect(container.querySelector('.ze-spinner')).toBeNull();
    expect(container.querySelector('.ze-canvas-loading')).toBeNull();
    expect(container.textContent).not.toMatch(/Loading/i);
  });

  it('the footprint preview keeps its status text while a fetch is in flight', async () => {
    // `DisplayFootprint` (common/widgets/footprint_preview_widget.cpp:107-123)
    // has two outcomes and neither is a loading message; while ours resolves,
    // the widget must keep showing what it showed before.
    const never = new Promise<never>(() => {});
    const { container } = render(
      <FootprintPreviewWidget
        footprint="Resistor_SMD:R_0805"
        statusText="No footprint specified"
        resolve={() => never}
      />,
    );
    expect(container.textContent).not.toMatch(/Loading/i);
    expect(screen.getByText('No footprint specified')).not.toBeNull();
  });

  it('and reports a miss with upstream’s exact string, full stop included', async () => {
    // `SetStatusText( _( "Footprint not found." ) )` — footprint_preview_widget.cpp:123.
    const { findByText } = render(
      <FootprintPreviewWidget
        footprint="Resistor_SMD:Nope"
        statusText="No footprint specified"
        resolve={() => Promise.resolve(null)}
      />,
    );
    expect(await findByText('Footprint not found.')).not.toBeNull();
  });
});
