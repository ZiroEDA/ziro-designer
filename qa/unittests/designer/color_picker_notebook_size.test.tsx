// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A wxNotebook is ONE size, whatever page is showing.
 *
 * `wxBookCtrlBase::DoGetBestSize` walks EVERY page and `IncTo`s the largest of
 * them; it asks only the current page when `SetFitToCurrentPage( true )` has
 * been called, and the one call to that in all of KiCad is PAGED_DIALOG's
 * treebook (common/widgets/paged_dialog.cpp:73). So DIALOG_COLOR_PICKER — whose
 * notebook is left at the default — opens as wide as its widest page and as
 * tall as its tallest, and clicking between "Color Picker" and "Defined Colors"
 * does not resize the dialog.
 *
 * Ours rendered `{tab === 'defined' && <page/>}`, so the page that was not
 * showing did not exist, could not contribute a size, and the two tabs came out
 * two different dialogs. The fix is structural: both pages are built once and
 * kept — as wx builds them — stacked in one grid cell, the unselected one
 * hidden by VISIBILITY so that it still counts toward the cell.
 *
 * happy-dom has no layout engine, so nothing here can measure a pixel. What it
 * CAN see is the two things the sizing rests on, and both are per-occurrence:
 * that neither page is ever unmounted, and that nothing in the stylesheet takes
 * a hidden page out of layout. The measurement itself was made with the real
 * component in headless Chrome at 1920x1200 — 846.3 x 550.1 on both tabs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DialogColorPicker } from '@ziroeda/designer/src/ui/DialogColorPicker.js';
import { saveColorPickerTab } from '@ziroeda/designer/src/ui/color_picker_tab.js';

afterEach(cleanup);

// happy-dom rewrites `import.meta.url` to an http: URL, so the path is taken
// off the cwd the way the other DOM tests here take it.
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** Every rule body, by selector, comments stripped. */
function rules(): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: m[2] ?? '' });
  }
  return out;
}

const picker = () => {
  const r = render(
    <DialogColorPicker
      value={{ r: 0, g: 0, b: 0, a: 1 }}
      defaultColor={{ r: 0, g: 0, b: 0, a: 0 }}
      allowOpacity
      onDone={() => {}}
    />,
  );
  const q = (sel: string): HTMLElement | null => r.container.querySelector<HTMLElement>(sel);
  return { ...r, q };
};

describe('both notebook pages are built, and stay built', () => {
  it('the unselected page is present and hidden, never absent', () => {
    saveColorPickerTab('free');
    const { q, getByRole } = picker();

    const free = q('.ze-cp-panels');
    const defined = q('.ze-cp-defined');
    // Both pages exist on page 0. `{tab === 'defined' && ...}` fails here.
    expect(free).not.toBeNull();
    expect(defined).not.toBeNull();
    expect(free?.hasAttribute('hidden')).toBe(false);
    expect(defined?.hasAttribute('hidden')).toBe(true);

    fireEvent.click(getByRole('button', { name: 'Defined Colors' }));

    // ...and both still exist on page 1, with the roles swapped. A page that
    // unmounted on the way out would fail here instead.
    expect(q('.ze-cp-panels')).not.toBeNull();
    expect(q('.ze-cp-defined')).not.toBeNull();
    expect(q('.ze-cp-panels')?.hasAttribute('hidden')).toBe(true);
    expect(q('.ze-cp-defined')?.hasAttribute('hidden')).toBe(false);
  });

  it('neither page is taken out of layout by a style of its own', () => {
    // The stylesheet guards below read the stylesheet, so an inline `display`
    // would slip past them and cost the book its size just as surely.
    // Explicitly, because the picker reopens on the page it was left on and
    // the test before this one leaves it on the second: without this the free
    // page is the one showing and the hidden page is never looked at.
    saveColorPickerTab('free');
    const { q, getByRole } = picker();
    const displays = (): (string | undefined)[] => [
      q('.ze-cp-panels')?.style.display,
      q('.ze-cp-defined')?.style.display,
    ];
    expect(displays()).toEqual(['', '']);
    fireEvent.click(getByRole('button', { name: 'Defined Colors' }));
    expect(displays()).toEqual(['', '']);
  });

  it('the two pages are siblings in one book, which is what stacks them', () => {
    const { q } = picker();
    const book = q('.ze-cp-book');
    expect(book).not.toBeNull();
    // Not `.contains`: a page nested one level deeper would not land in the
    // book's single grid cell, and the two would lay out one under the other.
    expect(q('.ze-cp-panels')?.parentElement).toBe(book);
    expect(q('.ze-cp-defined')?.parentElement).toBe(book);
  });

  it('the palettes are painted once, not on every tab click', () => {
    // The reason the page is kept rather than rebuilt: `createRGBBitmap` and
    // `createHSVBitmap` run once in the constructor (dialog_color_picker.cpp),
    // and unmounting the page would throw both bitmaps away.
    const { q, getByRole } = picker();
    const before = q('.ze-cp-panels .ze-cp-palette canvas');
    fireEvent.click(getByRole('button', { name: 'Defined Colors' }));
    fireEvent.click(getByRole('button', { name: 'Color Picker' }));
    expect(q('.ze-cp-panels .ze-cp-palette canvas')).toBe(before);
  });
});

describe('the stylesheet keeps a hidden page in layout', () => {
  it('a page in the book is hidden by visibility, not by display', () => {
    const hide = rules().find((r) => r.sel === '.ze-cp-book > [hidden]');
    expect(hide).toBeDefined();
    expect(hide?.body).toMatch(/visibility:\s*hidden/);
    expect(hide?.body).not.toMatch(/display:\s*none/);
  });

  it.each([
    '.ze-cp-panels',
    '.ze-cp-defined',
  ])('no rule takes %s out of layout when hidden', (page) => {
    // Per occurrence, not once for the file: every rule that could match the
    // page while it carries [hidden] is checked, so a new one added later is
    // checked too. `display: none` here is what made the two tabs two sizes.
    const offenders = rules().filter(
      (r) => r.sel.includes(page) && r.sel.includes('[hidden]') && /display:\s*none/.test(r.body),
    );
    expect(offenders.map((r) => r.sel)).toEqual([]);
  });

  it('the defined-colours page states no size of its own', () => {
    // It used to carry `min-height: 264px` — the palettes' size, copied onto
    // the other page so that selecting it did not shrink the dialog. That is
    // the notebook rule written by hand, for one page and one axis; the book
    // now states it once, so the number may not come back.
    const page = rules().find((r) => r.sel === '.ze-cp-defined');
    expect(page).toBeDefined();
    expect(page?.body).not.toMatch(/(^|[;\s])(min-)?(height|width)\s*:/);
  });
});
