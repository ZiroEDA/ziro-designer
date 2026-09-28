// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** EDA_VIEW_SWITCHER (common/dialogs/eda_view_switcher.cpp) and its board-editor wiring. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EDA_VIEW_SWITCHER,
  initialSwitcherSelection,
  stepSwitcherSelection,
} from '@ziroeda/common/dialogs/eda_view_switcher.js';

afterEach(cleanup);

const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
};

describe('TryBefore’s state machine', () => {
  it('opens already advanced, since m_tabState starts up', () => {
    expect(initialSwitcherSelection(3)).toBe(1);
    expect(initialSwitcherSelection(1)).toBe(0);
  });

  it('Tab moves on and wraps; Shift+Tab moves back unless Shift is the held key', () => {
    expect(stepSwitcherSelection(2, 3, false, 'Control')).toBe(0);
    expect(stepSwitcherSelection(0, 3, true, 'Control')).toBe(2);
    expect(stepSwitcherSelection(0, 3, true, 'Shift')).toBe(1);
  });
});

describe('EDA_VIEW_SWITCHER', () => {
  it('keeps the base’s title and lists the MRU', () => {
    render(<EDA_VIEW_SWITCHER items={['A', 'B', 'C']} heldKey="Control" onResult={() => {}} />);
    expect(screen.getByText('View Preset Switcher')).toBeTruthy();
    expect(screen.getByText('B').className).toContain('selected');
  });

  it('stays up while the held key is still down, whatever else is released', () => {
    const onResult = vi.fn();
    render(<EDA_VIEW_SWITCHER items={['A', 'B']} heldKey="Control" onResult={onResult} />);
    key('keyup', { key: 'Shift' });
    key('keyup', { key: 'a' });
    expect(onResult).not.toHaveBeenCalled();
  });

  it('accepts on the held key’s release and cancels on Escape', () => {
    const onResult = vi.fn();
    render(<EDA_VIEW_SWITCHER items={['A', 'B', 'C']} heldKey="Control" onResult={onResult} />);
    key('keydown', { key: 'Tab', ctrlKey: true });
    key('keyup', { key: 'Control' });
    expect(onResult).toHaveBeenLastCalledWith(2);
    key('keydown', { key: 'Escape' });
    expect(onResult).toHaveBeenLastCalledWith(null);
  });
});

describe('the board editor', () => {
  const src = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
    'utf8',
  );

  it('raises the switcher on Ctrl+Tab and Shift+Tab, from the MRU lists', () => {
    expect(src).toContain('<EDA_VIEW_SWITCHER');
    // In the frame's one keydown chain, after its input and suppression guards.
    expect(src).toContain("if (e.key === 'Tab' && openViewSwitcherRef.current(mod, e.shiftKey)) {");
    expect(src).toMatch(/if \(ctrl && presetMRU\.length > 0\)/);
    expect(src).toMatch(/if \(shift && !ctrl && viewportMRU\.length > 0\)/);
  });

  it('names a saved preset or viewport with wxTextEntryDialog, not prompt()', () => {
    expect(src).not.toMatch(/prompt\('Layer preset name:'/);
    expect(src).not.toMatch(/prompt\('Viewport name:'/);
    expect(src).toContain("'Save Layer Preset'");
    expect(src).toContain("'Save Viewport'");
  });
});
