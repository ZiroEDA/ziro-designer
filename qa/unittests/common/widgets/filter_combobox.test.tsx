// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILTER_COMBOBOX` (common/widgets/filter_combobox.cpp) and its two
 * subclasses, `NET_SELECTOR` and `NETCLASS_SELECTOR`.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FilterComboBox,
  filterListContent,
  sortStringList,
} from '@ziroeda/common/widgets/filter_combobox.js';
import {
  CREATE_NET,
  NO_NET,
  NetSelector,
  netSelectorListContent,
  netSelectorValue,
} from '@ziroeda/common/widgets/net_selector.js';
import { netclassSelectorListContent } from '@ziroeda/common/widgets/netclass_selector.js';
import { resetModalStack } from '@ziroeda/common/dialog_shim.js';

afterEach(() => {
  cleanup();
  resetModalStack();
});

describe('FILTER_COMBOPOPUP::getListContent', () => {
  it('is a case-insensitive substring match over the sorted list', () => {
    const sorted = sortStringList(['beta', 'Alpha', 'gamma', 'alphabet']);
    // wxArrayString::Sort: by code point, so upper case first.
    expect(sorted).toEqual(['Alpha', 'alphabet', 'beta', 'gamma']);
    expect(filterListContent(sorted, 'ALPHA')).toEqual(['Alpha', 'alphabet']);
    expect(filterListContent(sorted, '')).toEqual(sorted);
  });
});

const NETS = new Map<number, string>([
  [0, ''],
  [1, 'GND'],
  [2, 'Net-(R10-Pad1)'],
  [3, 'Net-(R2-Pad1)'],
  [4, '/{slash}bus'],
]);

describe('NET_SELECTOR_COMBOPOPUP::getListContent', () => {
  it('puts <no net> first, sorts by StrNumCmp, and unescapes', () => {
    const { names, unescaped } = netSelectorListContent(NETS, '', '', false);
    // R2 before R10: StrNumCmp compares the digit runs as numbers.
    expect(names).toEqual([NO_NET, '//bus', 'GND', 'Net-(R2-Pad1)', 'Net-(R10-Pad1)']);
    expect(unescaped.get('//bus')).toBe('/{slash}bus');
  });

  it('filters with *filter*, drops <no net> unless it matches, and offers <create net>', () => {
    const { names } = netSelectorListContent(NETS, 'pad', '', true);
    expect(names).toEqual(['Net-(R2-Pad1)', 'Net-(R10-Pad1)', `${CREATE_NET}: pad`]);
    // No create row for a name the board has, nor without a board to add to.
    expect(netSelectorListContent(NETS, 'GND', '', true).names).toEqual(['GND']);
    expect(netSelectorListContent(NETS, 'pad', '', false).names).not.toContain(
      `${CREATE_NET}: pad`,
    );
  });

  it('puts the indeterminate label last', () => {
    const { names } = netSelectorListContent(NETS, '', '-- mixed values --', false);
    expect(names.at(-1)).toBe('-- mixed values --');
  });

  it('GetStringValue: indeterminate for -1, <no net> for 0 or an unknown code', () => {
    expect(netSelectorValue(NETS, -1, 'mixed')).toBe('mixed');
    expect(netSelectorValue(NETS, 0, '')).toBe(NO_NET);
    expect(netSelectorValue(NETS, 99, '')).toBe(NO_NET);
    expect(netSelectorValue(NETS, 4, '')).toBe('//bus');
  });
});

describe('NETCLASS_SELECTOR_POPUP::getListContent', () => {
  it('lists every netclass sorted, whatever the filter', () => {
    expect(netclassSelectorListContent(['Power', 'Default', 'HS'])).toEqual([
      'Default',
      'HS',
      'Power',
    ]);
  });
});

describe('the popup', () => {
  const open = (combo: HTMLElement): HTMLInputElement => {
    fireEvent.click(combo);
    return document.querySelector('.ze-filter-popup input') as HTMLInputElement;
  };
  const rows = (): string[] =>
    Array.from(document.querySelectorAll('.ze-filter-popup [role="option"]')).map(
      (r) => r.textContent ?? '',
    );
  const selectedRow = (): string | null =>
    document.querySelector('.ze-filter-popup [aria-selected="true"]')?.textContent ?? null;

  it('opens with the current value selected and an empty filter', () => {
    const { getByRole } = render(
      <FilterComboBox stringList={['b', 'a', 'c']} value="b" onChange={() => {}} />,
    );
    const filter = open(getByRole('combobox'));
    expect(filter.value).toBe('');
    expect(rows()).toEqual(['a', 'b', 'c']);
    expect(selectedRow()).toBe('b');
  });

  it('typing filters and selects the first row; spaces are refused', () => {
    const { getByRole } = render(
      <FilterComboBox stringList={['alpha', 'beta', 'alps']} value="beta" onChange={() => {}} />,
    );
    const filter = open(getByRole('combobox'));
    fireEvent.change(filter, { target: { value: 'al p' } });
    expect(filter.value).toBe('alp');
    expect(rows()).toEqual(['alpha', 'alps']);
    expect(selectedRow()).toBe('alpha');
  });

  it('Down then Enter accepts, and fires only on a change', () => {
    const picked: string[] = [];
    const { getByRole } = render(
      <FilterComboBox stringList={['a', 'b', 'c']} value="a" onChange={(s) => picked.push(s)} />,
    );
    const filter = open(getByRole('combobox'));
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(picked).toEqual(['b']);
    expect(document.querySelector('.ze-filter-popup')).toBeNull();
    // Re-accepting the current value posts nothing.
    const again = open(getByRole('combobox'));
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(picked).toEqual(['b']);
  });

  it('Up stops at the first row and Down at the last', () => {
    const { getByRole } = render(
      <FilterComboBox stringList={['a', 'b']} value="a" onChange={() => {}} />,
    );
    const filter = open(getByRole('combobox'));
    fireEvent.keyDown(filter, { key: 'ArrowUp' });
    expect(selectedRow()).toBe('a');
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    expect(selectedRow()).toBe('b');
  });

  it('a printable key on the closed control opens it with that key in the filter', () => {
    const { getByRole } = render(
      <FilterComboBox stringList={['alpha', 'beta']} value="alpha" onChange={() => {}} />,
    );
    fireEvent.keyDown(getByRole('combobox'), { key: 'b' });
    const filter = document.querySelector('.ze-filter-popup input') as HTMLInputElement;
    expect(filter.value).toBe('b');
    // Through `onFilterEdit`: filtered, and the first row selected.
    expect(rows()).toEqual(['beta']);
    expect(selectedRow()).toBe('beta');
  });

  it('a click on a row accepts it', () => {
    const picked: number[] = [];
    const { getByRole } = render(
      <NetSelector netInfo={NETS} netcode={1} onChange={(c) => picked.push(c)} />,
    );
    expect(getByRole('combobox').textContent).toBe('GND');
    open(getByRole('combobox'));
    const row = Array.from(document.querySelectorAll('.ze-filter-popup [role="option"]')).find(
      (r) => r.textContent === '//bus',
    ) as HTMLElement;
    fireEvent.mouseDown(row);
    // The escaped name maps back to its netcode.
    expect(picked).toEqual([4]);
  });

  it('NET_SELECTOR accepts <no net> as netcode 0', () => {
    const picked: number[] = [];
    const { getByRole } = render(
      <NetSelector netInfo={NETS} netcode={1} onChange={(c) => picked.push(c)} />,
    );
    const filter = open(getByRole('combobox'));
    fireEvent.change(filter, { target: { value: 'no' } });
    expect(rows()).toEqual([NO_NET]);
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(picked).toEqual([0]);
  });

  it('NET_SELECTOR creates a net through onCreateNet', () => {
    const picked: number[] = [];
    const created: string[] = [];
    const { getByRole } = render(
      <NetSelector
        netInfo={NETS}
        netcode={1}
        onChange={(c) => picked.push(c)}
        onCreateNet={(name) => {
          created.push(name);
          return 7;
        }}
      />,
    );
    const filter = open(getByRole('combobox'));
    fireEvent.change(filter, { target: { value: 'VBUS' } });
    expect(rows()).toEqual([`${CREATE_NET}: VBUS`]);
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(created).toEqual(['VBUS']);
    expect(picked).toEqual([7]);
  });
});
