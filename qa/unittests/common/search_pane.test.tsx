// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SEARCH_PANE` / `SEARCH_PANE_TAB` (`common/widgets/search_pane.cpp`,
 * `search_pane_tab.cpp`), against a fake `SEARCH_HANDLER`. Every case below
 * is pinned to a specific line of the C++, named in its `it`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SearchPane,
  type SearchColumn,
  type SearchHandler,
  type SearchPaneMenuState,
} from '@ziroeda/common/widgets/search_pane.js';

afterEach(cleanup);

const COLUMNS: SearchColumn[] = [
  { name: 'Name', proportion: 6, align: 'left' },
  { name: 'X', proportion: 3, align: 'center' },
];

/** A minimal `SEARCH_HANDLER`, recording every call the widget makes on it. */
class FakeHandler implements SearchHandler {
  readonly columns = COLUMNS;
  searchCalls = 0;
  sortCalls: Array<{ col: number; ascending: boolean; selection: readonly number[] }> = [];
  selectItemsCalls: (readonly number[])[] = [];
  private hits: (readonly [string, string])[] = [];

  constructor(
    readonly name: string,
    private readonly data: readonly (readonly [string, string])[],
  ) {}

  search(query: string): number {
    this.searchCalls++;
    this.hits = query
      ? this.data.filter(([n]) => n.toLowerCase().includes(query.toLowerCase()))
      : [...this.data];
    return this.hits.length;
  }

  getResultCell(row: number, col: number): string {
    return this.hits[row]?.[col] ?? '';
  }

  sort(col: number, ascending: boolean, selection: readonly number[]): number[] {
    this.sortCalls.push({ col, ascending, selection });
    const selected = new Set(selection.map((i) => this.hits[i]));
    this.hits = [...this.hits].sort((a, b) => {
      const [x, y] = ascending ? [a, b] : [b, a];
      return (x[col] ?? '').localeCompare(y[col] ?? '');
    });
    const remapped: number[] = [];
    this.hits.forEach((h, i) => {
      if (selected.has(h)) remapped.push(i);
    });
    return remapped;
  }

  selectItems(rows: readonly number[]): void {
    this.selectItemsCalls.push(rows);
  }
}

const menuState: SearchPaneMenuState = {
  selectionZoom: 'pan',
  searchHiddenFields: true,
  searchMetadata: false,
};

describe('tab labels carry no counts', () => {
  it('AddSearcher sets the page title once, from GetName() alone (search_pane.cpp:175)', () => {
    const a = new FakeHandler('Symbols', [
      ['R1', '1'],
      ['R2', '2'],
      ['R3', '3'],
    ]);
    const b = new FakeHandler('Power', []);
    render(<SearchPane handlers={[a, b]} menuState={menuState} onMenuStateChange={() => {}} />);
    const tab = screen.getByText('Symbols', { selector: '.tab' });
    expect(tab.textContent).toBe('Symbols');
  });
});

describe('only the current tab is searched', () => {
  it('RefreshSearch / OnNotebookPageChanged only call Search on GetCurrentTab() (search_pane.cpp:181-217)', () => {
    const a = new FakeHandler('Symbols', [['R1', '1']]);
    const b = new FakeHandler('Power', [['#PWR1', '2']]);
    render(<SearchPane handlers={[a, b]} menuState={menuState} onMenuStateChange={() => {}} />);
    // Mount searches the active (first) tab only.
    expect(a.searchCalls).toBe(1);
    expect(b.searchCalls).toBe(0);

    // Typing re-searches the active tab; the inactive one stays untouched.
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'R1' } });
    expect(a.searchCalls).toBe(2);
    expect(b.searchCalls).toBe(0);

    // Switching tabs runs Search(m_lastQuery) on the newly-current one.
    fireEvent.click(screen.getByText('Power', { selector: '.tab' }));
    expect(b.searchCalls).toBe(1);
    expect(a.searchCalls).toBe(2);
  });
});

describe('OnColClicked (search_pane_tab.cpp:128-153)', () => {
  it('sorts ascending on the first click of a column', () => {
    const h = new FakeHandler('Symbols', [
      ['R2', '2'],
      ['R1', '1'],
    ]);
    render(<SearchPane handlers={[h]} menuState={menuState} onMenuStateChange={() => {}} />);
    fireEvent.click(screen.getByText('Name', { selector: 'th' }));
    expect(h.sortCalls.at(-1)).toMatchObject({ col: 0, ascending: true });
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['R1', '1', 'R2', '2']);
  });

  it('flips to descending on a second click of the SAME column, and back to ascending on a new one', () => {
    const h = new FakeHandler('Symbols', [
      ['R2', '2'],
      ['R1', '1'],
    ]);
    render(<SearchPane handlers={[h]} menuState={menuState} onMenuStateChange={() => {}} />);
    const nameHeader = () => screen.getByText(/^Name/, { selector: 'th' });
    fireEvent.click(nameHeader());
    fireEvent.click(nameHeader());
    expect(h.sortCalls.at(-1)).toMatchObject({ col: 0, ascending: false });

    fireEvent.click(screen.getByText(/^X/, { selector: 'th' }));
    expect(h.sortCalls.at(-1)).toMatchObject({ col: 1, ascending: true });
  });

  it("provides a stable order (col 0) before any header has been clicked (SCH_SEARCH_HANDLER::Sort's comment)", () => {
    const h = new FakeHandler('Symbols', [['R1', '1']]);
    render(<SearchPane handlers={[h]} menuState={menuState} onMenuStateChange={() => {}} />);
    expect(h.sortCalls[0]).toMatchObject({ col: 0, ascending: true });
  });
});

describe('row selection (SEARCH_PANE_LISTVIEW::OnItemSelected / OnUpdateUI)', () => {
  it('pushes the clicked row out through SelectItems', () => {
    const h = new FakeHandler('Symbols', [
      ['R1', '1'],
      ['R2', '2'],
    ]);
    render(<SearchPane handlers={[h]} menuState={menuState} onMenuStateChange={() => {}} />);
    fireEvent.click(screen.getByText('R2'));
    expect(h.selectItemsCalls.at(-1)).toEqual([1]);
  });

  it('a click on the blank area below the rows pushes an EMPTY selection', () => {
    const h = new FakeHandler('Symbols', [['R1', '1']]);
    const { container } = render(
      <SearchPane handlers={[h]} menuState={menuState} onMenuStateChange={() => {}} />,
    );
    const blank = container.querySelector('.ze-search-pane-body') as HTMLElement;
    fireEvent.click(blank);
    expect(h.selectItemsCalls.at(-1)).toEqual([]);
  });
});

describe('SEARCH_PANE_MENU (search_pane.cpp:40-117)', () => {
  it('Zoom to Selection and Pan to Selection are mutually exclusive', () => {
    const h = new FakeHandler('Symbols', []);
    let state = menuState;
    const { rerender } = render(
      <SearchPane
        handlers={[h]}
        menuState={state}
        onMenuStateChange={(next) => {
          state = next;
        }}
      />,
    );
    const gear = screen.getByTitle('Options');
    fireEvent.click(gear);
    fireEvent.click(screen.getByText('Zoom to Selection'));
    expect(state.selectionZoom).toBe('zoom');

    rerender(
      <SearchPane
        handlers={[h]}
        menuState={state}
        onMenuStateChange={(next) => {
          state = next;
        }}
      />,
    );
    fireEvent.click(gear);
    fireEvent.click(screen.getByText('Pan to Selection'));
    expect(state.selectionZoom).toBe('pan');
  });

  it('unticking the active mode leaves NONE', () => {
    const h = new FakeHandler('Symbols', []);
    let state: SearchPaneMenuState = { ...menuState, selectionZoom: 'pan' };
    render(
      <SearchPane
        handlers={[h]}
        menuState={state}
        onMenuStateChange={(next) => {
          state = next;
        }}
      />,
    );
    fireEvent.click(screen.getByTitle('Options'));
    fireEvent.click(screen.getByText('Pan to Selection'));
    expect(state.selectionZoom).toBe('none');
  });
});
