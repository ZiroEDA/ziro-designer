// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SYMBOL_CHOOSER::SetPreselect`, both halves of it.
 *
 *     void PANEL_SYMBOL_CHOOSER::SetPreselect( const LIB_ID& aPreselect )
 *     {
 *         m_adapter->SetPreselectNode( aPreselect, 0 );
 *
 *         if( m_tree && aPreselect.IsValid() )
 *             m_tree->SelectLibId( aPreselect );
 *     }
 *
 * The two lines do different jobs and only one of them is visible on opening.
 * `SetPreselectNode` records a node for the ADAPTER to fall back to when a
 * search matches nothing (lib_tree_model_adapter.ts:406) — it never selects a
 * row. `SelectLibId` is the one that finds the row, expands its ancestors and
 * selects it.
 *
 * We shipped the first and not the second, so browsing from a filled-in
 * library-identifier field opened at the top of the tree with nothing selected
 * and an empty preview, where KiCad opens sitting on the symbol the field
 * names — Akshay's screenshot of the real Symbol Chooser has
 * Screw_Terminal_01x02 selected, previewed, and scrolled to.
 *
 * Neither half had a test. `selectLibId` is a LIB_TREE prop we ported and never
 * exercised anywhere, which is why passing it was easy to leave out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

afterEach(cleanup);

/** A Connector library holding the parts Akshay's screenshot shows. */
function connectorTree(): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  const lib = adapter.addLibrary('Connector', 'Connector description', false);
  for (const name of ['Screw_Terminal_01x01', 'Screw_Terminal_01x02', 'Screw_Terminal_01x03']) {
    const item = new LibTreeNode();
    item.type = LibTreeNodeType.ITEM;
    item.parent = lib;
    item.name = name;
    item.libNickname = 'Connector';
    item.libItemName = name;
    lib.children.push(item);
  }
  adapter.finishLibrary(lib);
  adapter.tree.assignIntrinsicRanks();
  return adapter;
}

const activeRow = (): string =>
  document.querySelector('.ze-libtree-row.active .col-item')?.textContent ?? '';

const rowNames = (): string[] =>
  [...document.querySelectorAll('.ze-libtree-row .col-item')].map((el) => el.textContent ?? '');

describe('LIB_TREE::SelectLibId, the half that actually selects', () => {
  it('selects the row the LIB_ID names', () => {
    render(
      <LibTree
        adapter={connectorTree()}
        onSelect={() => {}}
        onChoose={() => {}}
        selectLibId="Connector:Screw_Terminal_01x02"
      />,
    );
    expect(activeRow()).toBe('Screw_Terminal_01x02');
  });

  it('expands its ancestors, so a row inside a closed library is reachable', () => {
    // `ExpandAncestors( item )` before `selectIfValid( item )`. The library
    // starts closed, so without the expand the row is not even drawn.
    render(
      <LibTree
        adapter={connectorTree()}
        onSelect={() => {}}
        onChoose={() => {}}
        selectLibId="Connector:Screw_Terminal_01x02"
      />,
    );
    expect(rowNames()).toContain('Screw_Terminal_01x02');
  });

  /* The tree already carries a selection of its own before any preselect —
     `selectIfValid` is a no-op for an id it cannot find, and the tree's own
     first-row selection stands. So the assertion is not "nothing is active"
     (it never was); it is that an unmatched id does not MOVE the selection,
     and that without a preselect the tree does not land on our symbol by
     coincidence — otherwise the two passing tests above would prove nothing. */
  it('leaves the selection alone when the id names no row, rather than guessing', () => {
    render(
      <LibTree
        adapter={connectorTree()}
        onSelect={() => {}}
        onChoose={() => {}}
        selectLibId="Connector:Does_Not_Exist"
      />,
    );
    expect(activeRow()).not.toBe('Does_Not_Exist');
  });

  it('and does not land on that symbol by itself, with no preselect given', () => {
    // The state the browse button used to open in: a default selection, not
    // the symbol the field named.
    render(<LibTree adapter={connectorTree()} onSelect={() => {}} onChoose={() => {}} />);
    expect(activeRow()).not.toBe('Screw_Terminal_01x02');
  });
});

/**
 * The panel has to hand its `preselect` down as `selectLibId`; that forwarding
 * IS the fix. The panel builds its own adapter from the library index, which
 * does not load under test, so the tree is empty and no row assertion can see
 * anything — the LIB_TREE props are the observable surface here.
 */
describe('PANEL_SYMBOL_CHOOSER forwards its preselect to the tree', () => {
  /**
   * The forwarding IS the fix, and the panel builds its own adapter from a
   * library index that does not load under test, so the tree is empty and no
   * row assertion can see anything. LIB_TREE's props are the observable
   * surface, so the tree is stubbed and its props captured.
   */
  async function treePropsFor(
    preselect?: string,
    historyList: { libId: string; unit: number; fields: [string, string][] }[] = [],
  ): Promise<Record<string, unknown>> {
    const captured: Record<string, unknown>[] = [];
    vi.resetModules();
    vi.doMock('@ziroeda/designer/src/widgets/lib_tree.js', () => ({
      LibTree: (props: Record<string, unknown>) => {
        captured.push(props);
        return <div data-testid="libtree-stub" />;
      },
    }));
    const { PanelSymbolChooser } = await import(
      '@ziroeda/designer/src/editors/schematic/widgets/panel_symbol_chooser.js'
    );
    render(
      <PanelSymbolChooser
        showFootprints={false}
        historyList={historyList}
        alreadyPlaced={[]}
        {...(preselect ? { preselect } : {})}
        onAccept={() => {}}
      />,
    );
    vi.doUnmock('@ziroeda/designer/src/widgets/lib_tree.js');
    expect(captured.length).toBeGreaterThan(0);
    return captured[captured.length - 1]!;
  }

  it('passes preselect through as selectLibId', async () => {
    const props = await treePropsFor('Connector:Screw_Terminal_01x02');
    expect(props.selectLibId).toBe('Connector:Screw_Terminal_01x02');
  }, 20000);

  it('and passes none when there is nothing to preselect', async () => {
    const props = await treePropsFor();
    expect(props.selectLibId).toBeUndefined();
  }, 20000);

  /**
   * The adapter takes a preselect from two places and the tree shows whichever
   * it holds: the constructor sets one from the history list
   * (`if( !aHistoryList.empty() ) adapter->SetPreselectNode( aHistoryList[0].LibId, … )`,
   * panel_symbol_chooser.cpp:176-177) and `SetPreselect` (:486) sets one from
   * the caller's field. SYMBOL_CHOOSER_FRAME::OnOK calls AddSymbolToHistory
   * before dismissing (:183), so browsing once puts that symbol at the head for
   * the next opening.
   *
   * Only the explicit one was forwarded, so the New-library-identifier browser
   * — whose field starts empty — opened on nothing, where the match-id one
   * opened on the symbol. Akshay asked for the two icons to behave alike.
   */
  it('falls back to the history head, which is what the empty-field browser gets', async () => {
    const props = await treePropsFor(undefined, [
      { libId: 'Connector:Screw_Terminal_01x02', unit: 1, fields: [] },
    ]);
    expect(props.selectLibId).toBe('Connector:Screw_Terminal_01x02');
  }, 20000);

  it('and the explicit preselect still wins over the history head', async () => {
    // The call order upstream: the constructor first, SetPreselect after.
    const props = await treePropsFor('Device:R', [
      { libId: 'Connector:Screw_Terminal_01x02', unit: 1, fields: [] },
    ]);
    expect(props.selectLibId).toBe('Device:R');
  }, 20000);
});
