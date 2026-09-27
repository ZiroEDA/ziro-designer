// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** PANEL_EMBEDDED_FILES on a read-only, striped WX_GRID with EMBEDDED_FILES_GRID_TRICKS. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GetClipboardText, SaveClipboard } from '@ziroeda/common/clipboard.js';
import {
  type EmbeddedFilesData,
  PanelEmbeddedFiles,
} from '@ziroeda/common/dialogs/panel_embedded_files.js';

afterEach(cleanup);

const VALUE = {
  embedFonts: false,
  files: [
    { name: 'a.pdf', reference: 'kicad-embed://a.pdf' },
    { name: 'b.step', reference: 'kicad-embed://b.step' },
  ],
} as unknown as EmbeddedFilesData;

describe('Embedded Files', () => {
  it('lists name and reference, striped, read-only', () => {
    const { container } = render(<PanelEmbeddedFiles value={VALUE} onChange={() => {}} />);
    expect(screen.getByText('kicad-embed://b.step')).toBeTruthy();
    expect(container.querySelector('table.ze-grid.ze-grid-striped')).not.toBeNull();
    const td = screen.getByText('a.pdf').closest('td') as HTMLElement;
    fireEvent.mouseDown(td, { button: 0 });
    fireEvent.mouseUp(td);
    expect(td.querySelector('input')).toBeNull();
  });

  it("copies a row's embedded reference from its context menu", () => {
    SaveClipboard('');
    render(<PanelEmbeddedFiles value={VALUE} onChange={() => {}} />);
    fireEvent.contextMenu(screen.getByText('b.step').closest('td') as HTMLElement);
    fireEvent.click(screen.getByText('Copy Embedded Reference'));
    expect(GetClipboardText()).toBe('kicad-embed://b.step');
  });

  it('removes the cursor row', () => {
    let next: EmbeddedFilesData | null = null;
    render(<PanelEmbeddedFiles value={VALUE} onChange={(v) => (next = v)} />);
    fireEvent.mouseDown(screen.getByText('b.step').closest('td') as HTMLElement, { button: 0 });
    fireEvent.click(screen.getByTitle('Remove embedded file'));
    expect(next!.files.map((f) => f.name)).toEqual(['a.pdf']);
  });
});
