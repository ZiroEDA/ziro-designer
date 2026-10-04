// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_LIST_DIALOG` with `SAVE_AS_DIALOG`'s additions
 * (`pcbnew/footprint_libraries_utils.cpp:995-1055`): a Name row whose
 * validator excludes the characters a footprint name may not hold, and an
 * OK button labelled Save. OK answers the selected row and the trimmed name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EdaListDialog } from '@ziroeda/common/dialogs/eda_list_dialog.js';

afterEach(cleanup);

describe('EdaListDialog as SAVE_AS_DIALOG', () => {
  it('answers the library and the name, the excluded characters never typed', () => {
    const answers: [string | null, string | undefined][] = [];
    const { container } = render(
      <EdaListDialog
        title="Save Footprint As"
        listLabel="Save in library:"
        okLabel="Save"
        headers={['Nickname', 'Description']}
        rows={[
          { value: 'A', cells: ['A', ''] },
          { value: 'B', cells: ['B', ''] },
        ]}
        initialValue="B"
        nameRow={{ label: 'Name:', value: 'R', excludeChars: '/:' }}
        onResult={(aLib, aName) => answers.push([aLib, aName])}
      />,
    );

    const name = container.querySelector('.ze-list-dialog-name input') as HTMLInputElement;
    fireEvent.change(name, { target: { value: ' R/0805: ' } });
    expect(name.value).toBe(' R0805 ');

    const save = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save',
    )!;
    fireEvent.click(save);

    expect(answers).toEqual([['B', 'R0805']]);
  });

  it('without a name row it answers the row alone, under OK', () => {
    const answers: [string | null, string | undefined][] = [];
    const { container } = render(
      <EdaListDialog
        title="Pick"
        headers={['Item']}
        rows={[{ value: 'x', cells: ['x'] }]}
        onResult={(aValue, aName) => answers.push([aValue, aName])}
      />,
    );

    expect(container.querySelector('.ze-list-dialog-name')).toBeNull();
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'OK')!,
    );
    expect(answers).toEqual([['x', undefined]]);
  });
});
