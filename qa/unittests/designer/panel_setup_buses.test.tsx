// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PANEL_SETUP_BUSES on two WX_GRIDs (panel_setup_buses.cpp): the members pane
 * follows the alias cursor, a member typed with spaces splits, a duplicate
 * alias is vetoed, aliases load sorted case-blind.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import {
  type BusAlias,
  PanelSetupBuses,
} from '@ziroeda/eeschema/dialogs/panel_setup_buses.js';

afterEach(cleanup);

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function Harness({ start, seen }: { start: BusAlias[]; seen: BusAlias[][] }) {
  const [a, setA] = useState(start);
  return (
    <PanelSetupBuses
      aliases={a}
      onChange={(n) => {
        seen.push(n);
        setA(n);
      }}
    />
  );
}

function setup(start: BusAlias[]) {
  const seen: BusAlias[][] = [];
  const view = render(<Harness start={start} seen={seen} />);
  const grid = (label: string) => screen.getByLabelText(label);
  const cell = (label: string, r: number): HTMLElement =>
    grid(label).querySelector(`td[data-row="${r}"][data-col="0"]`) as HTMLElement;
  const edit = (label: string, r: number, text: string): void => {
    fireEvent.mouseDown(cell(label, r), { button: 0 });
    fireEvent.mouseUp(cell(label, r));
    const input = cell(label, r).querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  };
  return { view, cell, edit, seen, last: () => seen[seen.length - 1] };
}

describe('Bus Alias Definitions', () => {
  it('loads the aliases sorted case-blind and shows the cursor alias’s members', async () => {
    const { cell } = setup([
      { name: 'data', members: ['D0', 'D1'] },
      { name: 'Addr', members: ['A0'] },
    ]);
    await flush();
    expect([cell('Bus aliases', 0).textContent, cell('Bus aliases', 1).textContent]).toEqual([
      'Addr',
      'data',
    ]);
    expect(screen.getByText("Members of 'Addr'")).toBeTruthy();
    expect(cell('Bus members', 0).textContent).toBe('A0');
  });

  it('splits a member typed with spaces into one member per word', async () => {
    const { edit, last } = setup([{ name: 'BUS', members: ['A'] }]);
    await flush();
    edit('Bus members', 0, 'X Y');
    await flush();
    expect(last()).toEqual([{ name: 'BUS', members: ['X', 'Y'] }]);
  });

  it('vetoes a duplicate alias name', async () => {
    const errors: string[] = [];
    SetErrorPresenter((m) => errors.push(m));
    const { edit, cell } = setup([
      { name: 'A', members: [] },
      { name: 'B', members: [] },
    ]);
    await flush();
    edit('Bus aliases', 1, 'A');
    await flush();
    expect(errors).toEqual(["Alias name 'A' already in use."]);
    expect(cell('Bus aliases', 1).querySelector('input')).not.toBeNull();
  });

  it('adds an alias with its name open, and deletes the cursor alias', async () => {
    const { view, cell, last } = setup([{ name: 'A', members: [] }]);
    await flush();
    fireEvent.click(view.getByLabelText('Add alias'));
    const input = cell('Bus aliases', 1).querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NEW' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await flush();
    expect(last()!.map((a) => a.name)).toEqual(['A', 'NEW']);

    fireEvent.click(view.getByLabelText('Delete alias'));
    await flush();
    expect(last()!.length).toBe(1);
  });
});
