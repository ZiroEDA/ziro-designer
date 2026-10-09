// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TextCombo, the editable wxComboBox: free text in the entry, a drop-down of suggestions drawn
 * with the wxChoice popup, a pick replacing the text, Enter the dialog's default button.
 */
import { TextCombo } from '@ziroeda/common/widgets/wx_combobox.js';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => cleanup());

function Host({ onEnter }: { onEnter?: () => void }) {
  const [v, setV] = useState('IN');
  return <TextCombo value={v} options={['IN1', 'OUT2']} onChange={setV} onEnter={onEnter} />;
}

describe('TextCombo', () => {
  it('takes free text, and a picked suggestion replaces it', () => {
    const view = render(<Host />);
    const input = view.container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'MINE' } });
    expect(input.value).toBe('MINE');

    fireEvent.click(view.container.querySelector('.ze-textcombo-button')!);
    const items = [...document.querySelectorAll('.ze-combo-item')];
    expect(items.map((i) => i.textContent)).toEqual(['IN1', 'OUT2']);
    fireEvent.mouseDown(items[1]!);
    expect(input.value).toBe('OUT2');
    expect(document.querySelector('.ze-combo-popup')).toBe(null);
  });

  it('Enter in the entry is the default button; ArrowDown opens the list', () => {
    let entered = 0;
    const view = render(<Host onEnter={() => entered++} />);
    const input = view.container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.querySelector('.ze-combo-popup')).not.toBe(null);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(entered).toBe(1);
    expect(document.querySelector('.ze-combo-popup')).toBe(null);
  });
});
