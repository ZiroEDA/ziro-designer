// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * WX_TEXT_ENTRY_DIALOG (common/dialogs/dialog_text_entry.cpp), and the two
 * "Exclusion Comment" callers that used the browser's prompt() instead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WX_TEXT_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_text_entry.js';
import { FOOTPRINT_NAME_VALIDATOR } from '@ziroeda/common/validators.js';

afterEach(cleanup);

const entry = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;

describe('WX_TEXT_ENTRY_DIALOG', () => {
  it('titles itself with the caption and seeds the entry with the default', () => {
    render(
      <WX_TEXT_ENTRY_DIALOG
        label=""
        caption="Exclusion Comment"
        defaultValue="old"
        onResult={() => {}}
      />,
    );
    expect(screen.getByText('Exclusion Comment')).toBeTruthy();
    expect(entry().value).toBe('old');
  });

  it('hides m_label when the label is empty, and shows it otherwise', () => {
    const { container, unmount } = render(
      <WX_TEXT_ENTRY_DIALOG label="" caption="C" onResult={() => {}} />,
    );
    expect(container.ownerDocument.querySelector('.ze-textentry-label')).toBeNull();
    unmount();
    render(<WX_TEXT_ENTRY_DIALOG label="Name:" caption="C" onResult={() => {}} />);
    expect(screen.getByText('Name:')).toBeTruthy();
  });

  it('widens the entry for aExtraWidth', () => {
    render(<WX_TEXT_ENTRY_DIALOG label="" caption="C" extraWidth onResult={() => {}} />);
    expect(entry().classList.contains('extra')).toBe(true);
  });

  it('OK returns the text, Enter too, and Cancel returns null', () => {
    const onResult = vi.fn();
    render(<WX_TEXT_ENTRY_DIALOG label="" caption="C" onResult={onResult} />);
    fireEvent.change(entry(), { target: { value: 'why' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.keyDown(entry(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult.mock.calls).toEqual([['why'], ['why'], [null]]);
  });

  it('applies its validator as the text is typed', () => {
    render(
      <WX_TEXT_ENTRY_DIALOG
        label=""
        caption="C"
        validator={new FOOTPRINT_NAME_VALIDATOR()}
        onResult={() => {}}
      />,
    );
    fireEvent.change(entry(), { target: { value: 'a/b:c' } });
    expect(entry().value).toBe('abc');
  });
});

describe('the Exclusion Comment callers', () => {
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), '..', rel), 'utf8');

  for (const file of [
    'designer/src/editors/schematic/components/ErcDialog.tsx',
    'designer/src/editors/pcb/PcbEditor.tsx',
  ]) {
    it(`${file.split('/').pop()} asks with WX_TEXT_ENTRY_DIALOG, never prompt()`, () => {
      const src = read(file);
      expect(src).toContain('<WX_TEXT_ENTRY_DIALOG');
      expect(src).not.toMatch(/prompt\(\s*['"]Exclusion Comment/);
      expect(src).not.toMatch(/textEntry:\s*async\s*\([^)]*\)\s*=>\s*globalThis\.prompt/);
    });
  }
});
