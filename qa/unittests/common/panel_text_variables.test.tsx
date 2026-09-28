// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PANEL_TEXT_VARIABLES on WX_GRID + GRID_TRICKS (panel_text_variables.cpp):
 * edits reach the project through onChange, Add opens the new name, the name
 * validator refuses its characters, an empty name is vetoed, Delete removes
 * the selected rows.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { PanelTextVariables, type TextVar } from '@ziroeda/common/dialogs/panel_text_variables.js';

afterEach(cleanup);

function Harness({ start, seen }: { start: TextVar[]; seen: TextVar[][] }) {
  const [vars, setVars] = useState(start);
  return (
    <PanelTextVariables
      vars={vars}
      onChange={(v) => {
        seen.push(v);
        setVars(v);
      }}
    />
  );
}

function setup(start: TextVar[]) {
  const seen: TextVar[][] = [];
  const view = render(<Harness start={start} seen={seen} />);
  const cell = (r: number, c: number): HTMLElement =>
    view.container.querySelector(`td[data-row="${r}"][data-col="${c}"]`)!;
  const edit = (r: number, c: number, text: string, key = 'Enter'): void => {
    fireEvent.mouseDown(cell(r, c), { button: 0 });
    fireEvent.mouseUp(cell(r, c));
    const input = cell(r, c).querySelector('input')!;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key, code: key });
  };
  return { view, cell, edit, seen, last: () => seen[seen.length - 1] };
}

describe('Text Variables', () => {
  it('shows the variables and reports an edited value', () => {
    const { cell, edit, last } = setup([{ name: 'REV', value: 'A' }]);
    expect(cell(0, 0).textContent).toBe('REV');
    edit(0, 1, 'B');
    expect(last()).toEqual([{ name: 'REV', value: 'B' }]);
  });

  it('adds a row with its name open, refusing the validator characters', () => {
    const { view, cell, last } = setup([]);
    fireEvent.click(view.getByTitle('Add text variable'));
    const input = cell(0, 0).querySelector('input')!;
    fireEvent.change(input, { target: { value: 'MY{VAR}.X' } });
    expect(input.value).toBe('MYVARX');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(last()).toEqual([{ name: 'MYVARX', value: '' }]);
  });

  it('vetoes an empty name and says so', async () => {
    const errors: string[] = [];
    SetErrorPresenter((m) => errors.push(m));
    const { edit, cell, last } = setup([{ name: 'REV', value: 'A' }]);
    edit(0, 0, '');
    // The veto's DisplayErrorMessage / SetGridCursor / EnableCellEditControl
    // are queued with queueMicrotask (panel_text_variables.tsx), so they run
    // after this handler returns; awaiting inside `act` — not chaining a
    // `.then` onto it — is what makes the test's own promise, and not just a
    // detached continuation, wait for them.
    await act(async () => {
      await Promise.resolve();
    });
    expect(errors).toEqual(['Variable name cannot be empty.']);
    expect(cell(0, 0).querySelector('input')).not.toBeNull();
    expect(last()).toBeUndefined();
  });

  it('deletes the selected row', () => {
    const { view, cell, last } = setup([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ]);
    fireEvent.mouseDown(cell(1, 1), { button: 0 });
    fireEvent.mouseUp(cell(1, 1));
    fireEvent.keyDown(cell(1, 1).querySelector('input')!, { key: 'Escape', code: 'Escape' });
    fireEvent.click(view.getByTitle('Delete text variable'));
    expect(last()).toEqual([{ name: 'A', value: '1' }]);
  });
});
