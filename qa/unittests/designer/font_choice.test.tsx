// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FONT_CHOICE` (common/widgets/font_choice.cpp): the face a file names but
 * the list does not hold, and the `@font-face` rules the specimens draw with.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FontChoice } from '@ziroeda/designer/src/ui/TextFormatBar.js';
import {
  BUNDLED_FAMILIES,
  installOutlineFontFaces,
} from '@ziroeda/designer/src/font/outline_fonts.js';
import { BUNDLED_FONTS } from '@ziroeda/common/src/font/fontconfig.js';

afterEach(cleanup);

describe('FontChoice', () => {
  it('appends a face the list lacks as "<name> <not found>", selected, its value untouched', () => {
    // `SetFontSelection` (font_choice.cpp:269-285): `Append( aFont->GetName()
    // + m_notFound ); SetSelection( GetCount() - 1 )`. "Arial" is what a file
    // authored on Windows says; it is not a family the catalogue holds, even
    // though fontconfig substitutes Liberation Sans for it.
    const changes: string[] = [];
    render(<FontChoice face="Arial" onChange={(v) => changes.push(v)} />);
    const combo = document.querySelector('.ze-lp-font') as HTMLElement;
    expect(combo.textContent).toContain('Arial <not found>');
    fireEvent.click(combo);
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    const last = rows[rows.length - 1]!;
    expect(last.textContent).toBe('Arial <not found>');
    expect(last.getAttribute('aria-selected')).toBe('true');
    // A face the list holds gets no such row.
    expect(rows.filter((r) => r.textContent?.includes('<not found>'))).toHaveLength(1);
  });

  it('"Default Font" is the empty face, and the KiCad Font is named as such', () => {
    const changes: string[] = [];
    render(<FontChoice face="" onChange={(v) => changes.push(v)} />);
    const combo = document.querySelector('.ze-lp-font') as HTMLElement;
    expect(combo.textContent).toContain('Default Font');
    fireEvent.click(combo);
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    fireEvent.mouseDown(rows[1]!);
    expect(changes).toEqual(['KiCad Font']);
  });
});

describe('installOutlineFontFaces', () => {
  it('declares one @font-face per catalogue file, once', () => {
    installOutlineFontFaces(document);
    installOutlineFontFaces(document);
    const styles = document.querySelectorAll('#ze-outline-font-faces');
    expect(styles).toHaveLength(1);
    const css = styles[0]!.textContent ?? '';
    expect(css.match(/@font-face/g)).toHaveLength(BUNDLED_FONTS.length);
    for (const family of BUNDLED_FAMILIES) expect(css).toContain(`font-family:"${family}"`);
    // Bold Italic is weight 700 + italic; Oblique is italic too.
    expect(css).toContain(
      'font-weight:700;font-style:italic;src:url("/fonts/LiberationSans-BoldItalic.ttf")',
    );
    expect(css).toContain(
      'font-weight:400;font-style:italic;src:url("/fonts/DejaVuSansMono-Oblique.ttf")',
    );
    expect(css).toContain('font-weight:400;font-style:normal;src:url("/fonts/DejaVuSans.ttf")');
  });
});
