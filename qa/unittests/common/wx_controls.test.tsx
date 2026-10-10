// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * common/wx/controls: the wx controls every dialog is made of, and how each meets DialogShim's
 * Enter - an entry with wxTE_PROCESS_ENTER takes it, one without lets the default button have it,
 * and a multi-line one keeps it for a new line.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogShim, resetModalStack } from '@ziroeda/common/dialog_shim.js';
import { Button, RadioButton, StaticBox, TextCtrl } from '@ziroeda/common/wx/controls.js';

afterEach(() => {
  cleanup();
  resetModalStack();
});

describe('RadioButton', () => {
  it('reports a selection and never an unselection', () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <>
        <RadioButton label="A" name="g" checked onChange={a} />
        <RadioButton label="B" name="g" checked={false} onChange={b} />
      </>,
    );
    fireEvent.click(screen.getByLabelText('B'));
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1]);
    expect(screen.getByLabelText('A').closest('label')?.className).toBe('ze-check');
  });
});

describe('TextCtrl and the default button', () => {
  const dialog = (entry: JSX.Element, onOk: () => void) =>
    render(
      <DialogShim title="T" onClose={() => {}}>
        {entry}
        <Button label="OK" isDefault onClick={onOk} />
      </DialogShim>,
    );

  it('without onEnter, Enter presses the default button', () => {
    const onOk = vi.fn();
    dialog(<TextCtrl ariaLabel="e" value="x" />, onOk);
    fireEvent.keyDown(screen.getByLabelText('e'), { key: 'Enter' });
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('with onEnter (wxTE_PROCESS_ENTER) the entry takes it and OK is not pressed', () => {
    const onOk = vi.fn();
    const onEnter = vi.fn();
    dialog(<TextCtrl ariaLabel="e" value="x" onEnter={onEnter} />, onOk);
    fireEvent.keyDown(screen.getByLabelText('e'), { key: 'Enter' });
    expect([onEnter.mock.calls.length, onOk.mock.calls.length]).toEqual([1, 0]);
  });

  it('a multi-line one keeps plain Enter for the text', () => {
    const onOk = vi.fn();
    dialog(<TextCtrl ariaLabel="e" value="x" multiLine />, onOk);
    const area = screen.getByLabelText('e');
    expect(area.tagName).toBe('TEXTAREA');
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(onOk).not.toHaveBeenCalled();
  });

  it('reports each edit', () => {
    const onChange = vi.fn();
    render(<TextCtrl ariaLabel="e" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('e'), { target: { value: 'R12' } });
    expect(onChange).toHaveBeenCalledWith('R12');
  });
});

describe('StaticBox', () => {
  it('is fieldset.ze-sbox with its label as the legend', () => {
    const { container } = render(
      <StaticBox label="Options" className="inner">
        <span>child</span>
      </StaticBox>,
    );
    const box = container.querySelector('fieldset')!;
    expect(box.className).toBe('ze-sbox inner');
    expect(box.querySelector('legend')?.textContent).toBe('Options');
  });
});
