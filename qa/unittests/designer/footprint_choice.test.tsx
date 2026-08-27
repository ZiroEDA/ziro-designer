// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_CHOICE` — the symbol chooser's footprint drop-down.
 *
 * It was a native `<select>`, which means the browser owned the option list,
 * and three separate faults fell out of that one fact:
 *
 *   1. the list opened detached at the top of the screen instead of under the
 *      control;
 *   2. every row was one flat colour, where KiCad dims the library prefix and
 *      leaves the footprint name bright;
 *   3. the rows were at the browser's font and pitch, not GTK's.
 *
 * `common/widgets/footprint_choice.cpp:58-122` is the whole rendering rule, and
 * this pins it row by row rather than by grepping the file — a file-level check
 * cannot tell "every row is dimmed" from "the one row that should not be, is
 * not", and that distinction is literally the `wxODCB_PAINTING_SELECTED` branch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  FootprintChoice,
  drawFootprintItem,
  greyRange,
} from '@ziroeda/designer/src/widgets/footprint_choice.js';
import {
  FootprintSelectWidget,
  footprintChoiceItems,
} from '@ziroeda/designer/src/widgets/footprint_select_widget.js';
import { POPUP_MAX_H, placeComboPopup } from '@ziroeda/designer/src/ui/owner_drawn_combo_popup.js';
import { resetModalStack } from '@ziroeda/designer/src/ui/modal_escape.js';

afterEach(() => {
  cleanup();
  resetModalStack();
  // stubFieldRect installs a prototype spy; left in place it would follow the
  // suite into the next test.
  vi.restoreAllMocks();
});

// `import.meta.url` is not a file: URL under happy-dom, so the path is resolved
// from the working directory instead, as chooser_shell_metrics.test.tsx does.
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** The body of one CSS rule, comments stripped so they cannot read as code. */
function rule(selector: string): string {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = new RegExp(`\\n${selector.replace(/[.\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(code);
  expect(at, `shell.css has no ${selector} rule`).not.toBeNull();
  return at?.[1] ?? '';
}

// ---------------------------------------------------------------------------
// The greying rule, as arithmetic.
// ---------------------------------------------------------------------------

describe('greyRange: which run of the label is drawn in m_grey', () => {
  it('takes the library up to and INCLUDING the last colon', () => {
    // `lib.SubString( 0, colon_index )` is inclusive of colon_index, so the
    // colon is greyed with the library. Dropping it is the obvious off-by-one
    // and it is visible: "TerminalBlock" dim then ":" bright then the name.
    const { start, end } = greyRange(
      'TerminalBlock:TerminalBlock_MaiXu_MX126',
      'TerminalBlock:TerminalBlock_MaiXu_MX126',
    );
    expect(start).toBe(0);
    expect(end).toBe('TerminalBlock:'.length);
    expect('TerminalBlock:TerminalBlock_MaiXu_MX126'.slice(start, end)).toBe('TerminalBlock:');
  });

  it('finds the library INSIDE the display string, past a "[Default] " prefix', () => {
    // The whole reason the library comes from the client data and is then
    // searched for in the text: the default row's two strings differ.
    const text = '[Default] TerminalBlock:TB_1x02';
    const { start, end } = greyRange(text, 'TerminalBlock:TB_1x02');
    expect(start).toBe(10);
    expect(end).toBe(24);
    expect(text.slice(0, start)).toBe('[Default] ');
    expect(text.slice(start, end)).toBe('TerminalBlock:');
    expect(text.slice(end)).toBe('TB_1x02');
  });

  it('uses the LAST colon, not the first', () => {
    // `lib.rfind( ':' )`. A LIB_ID with a colon in the footprint name still
    // greys the whole library-and-separator run.
    const text = 'Lib:Sub:Name';
    const { start, end } = greyRange(text, 'Lib:Sub:Name');
    expect(text.slice(start, end)).toBe('Lib:Sub:');
  });

  it('greys nothing when the client data has no colon', () => {
    expect(greyRange('No default footprint', '')).toEqual({ start: 0, end: 0 });
    expect(greyRange('SomeFootprint', 'SomeFootprint')).toEqual({ start: 0, end: 0 });
  });

  it('greys nothing when the label does not contain the library', () => {
    // `library_index != wxString::npos` guards this; without it start/end would
    // be nonsense indices into a string that never had the library in it.
    expect(greyRange('a different label', 'Lib:Name')).toEqual({ start: 0, end: 0 });
  });
});

describe('drawFootprintItem: the wxODCB_PAINTING_SELECTED branch', () => {
  // `if( start_grey != end_grey && !( aFlags & wxODCB_PAINTING_SELECTED ) )` —
  // three fragments when not selected, one `DrawText` when it is.
  const item = { label: 'Lib:Name', value: 'Lib:Name' };

  it('splits an unselected row into fragments', () => {
    const drawn = drawFootprintItem(item, { control: false, selected: false });
    expect(typeof drawn).not.toBe('string');
  });

  it('draws a selected row as one flat string', () => {
    expect(drawFootprintItem(item, { control: false, selected: true })).toBe('Lib:Name');
  });

  it('draws a focused closed control as one flat string too', () => {
    // ShouldDrawFocus() sets SELECTED on the CONTROL paint as well; measured
    // with ~/kicad-probes/fp_choice_flags.cpp, which records every OnDrawItem
    // call's flags: "control FOCUSED: CONTROL=1 SELECTED=1".
    expect(drawFootprintItem(item, { control: true, selected: true })).toBe('Lib:Name');
  });
});

// ---------------------------------------------------------------------------
// The rendered rows.
// ---------------------------------------------------------------------------

const LIBS = [
  'TerminalBlock:TerminalBlock_MaiXu_MX126-5.0-02P_1x02_P5.00mm',
  'TerminalBlock_Altech:Altech_AK100_1x02_P5.00mm',
  'TerminalBlock_CUI:TerminalBlock_CUI_TB007-508-02_1x02_P5.08mm_Horizontal',
];

/** The library run of a "Lib:Name" id, colon included. */
const libOf = (id: string): string => id.slice(0, id.indexOf(':') + 1);

/** Give the closed control a real rectangle; happy-dom hands out zeroes. */
function stubFieldRect(rect: { left: number; top: number; bottom: number; width: number }): void {
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains('ze-odcombo')) return real.call(this);
    return {
      ...rect,
      right: rect.left + rect.width,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function open(ui: React.ReactElement): { rows: HTMLElement[]; popup: HTMLElement } {
  const r = render(ui);
  fireEvent.click(r.container.querySelector('.ze-odcombo') as HTMLElement);
  const popup = document.querySelector('.ze-odcombo-popup') as HTMLElement;
  expect(popup, 'the list did not open').not.toBeNull();
  return { rows: Array.from(popup.children) as HTMLElement[], popup };
}

describe('the popup rows, one by one', () => {
  it('dims the library fragment of EVERY unselected row and nothing else', () => {
    const { rows } = open(
      <FootprintSelectWidget
        defaultFootprint=""
        items={LIBS}
        value=""
        onFootprintSelected={() => {}}
      />,
    );

    // Row 0 is "No default footprint": no colon in its client data, so no dim
    // run at all. Rows 1..3 are the filter results.
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toBe('No default footprint');
    expect(rows[0]?.querySelector('.ze-fp-lib')).toBeNull();

    // Row 0 is the selection, so rows 1..3 are the unselected ones.
    for (let i = 0; i < LIBS.length; i++) {
      const id = LIBS[i] as string;
      const row = rows[i + 1] as HTMLElement;
      const dim = row.querySelectorAll('.ze-fp-lib');
      expect(dim, `row ${i + 1} (${id}) has no dim run`).toHaveLength(1);
      expect(dim[0]?.textContent, `row ${i + 1} dims the wrong run`).toBe(libOf(id));
      // And the rest of the row is NOT inside it: the footprint name must be
      // bright. Ours drew the whole row one colour, which this catches.
      expect(row.textContent).toBe(id);
      expect(dim[0]?.textContent).not.toBe(id);
    }
  });

  it('leaves the highlighted row undimmed', () => {
    // `!( aFlags & wxODCB_PAINTING_SELECTED )`. Open with a list row selected
    // rather than the default, so the selected row is one that WOULD be dimmed.
    const picked = LIBS[1] as string;
    const { rows } = open(
      <FootprintSelectWidget
        defaultFootprint=""
        items={LIBS}
        value={picked}
        onFootprintSelected={() => {}}
      />,
    );

    const selected = rows[2] as HTMLElement;
    expect(selected.className).toContain('selected');
    expect(selected.textContent).toBe(picked);
    expect(selected.querySelectorAll('.ze-fp-lib')).toHaveLength(0);

    // Its neighbours, which are not selected, still are dimmed - so this is the
    // SELECTED branch and not a widget that stopped dimming altogether.
    expect((rows[1] as HTMLElement).querySelectorAll('.ze-fp-lib')).toHaveLength(1);
    expect((rows[3] as HTMLElement).querySelectorAll('.ze-fp-lib')).toHaveLength(1);
  });

  it('keeps the "[Default] " prefix bright and dims only the library after it', () => {
    // FOOTPRINT_SELECT_WIDGET::UpdateList gives the default row a label that is
    // not its client data, and OnDrawItem is written around exactly that.
    const fp = 'TerminalBlock:TB_1x02';
    const { rows } = open(
      <FootprintSelectWidget
        defaultFootprint={fp}
        items={[]}
        value="ignored-so-nothing-is-selected"
        onFootprintSelected={() => {}}
      />,
    );

    const row = rows[0] as HTMLElement;
    expect(row.textContent).toBe('[Default] TerminalBlock:TB_1x02');
    const dim = row.querySelectorAll('.ze-fp-lib');
    expect(dim).toHaveLength(1);
    expect(dim[0]?.textContent).toBe('TerminalBlock:');
    // The prefix is outside the dim span, i.e. drawn in the standard colour.
    expect(dim[0]?.previousSibling?.textContent).toBe('[Default] ');
  });

  it('renders an empty entry as a separator rule, not a blank row', () => {
    // include/widgets/footprint_choice.h:29 - "empty items are displayed as
    // nonselectable separators". A native <select> could only give a blank row.
    const { rows } = open(
      <FootprintChoice
        items={[
          { label: 'Lib:First', value: 'Lib:First' },
          { label: '', value: '' },
          { label: 'Lib:Second', value: 'Lib:Second' },
        ]}
        value="Lib:First"
        onChange={() => {}}
      />,
    );

    const sep = rows[1] as HTMLElement;
    expect(sep.className).toBe('ze-odcombo-sep');
    expect(sep.getAttribute('role')).toBe('separator');
    expect(sep.textContent).toBe('');
    // Not a row: it must not carry the item class, or it would take the item
    // height and the item highlight.
    expect(sep.className).not.toContain('ze-odcombo-item');
    // Its neighbours are ordinary rows, so this is the empty-string branch and
    // not "the popup stopped rendering items".
    expect((rows[0] as HTMLElement).className).toContain('ze-odcombo-item');
    expect((rows[2] as HTMLElement).className).toContain('ze-odcombo-item');
  });

  it('refuses to select a separator, by click or by arrow', () => {
    // `FOOTPRINT_CHOICE::TryVetoSelect` puts the selection back to
    // m_last_selection rather than skipping onward, so the row is unreachable.
    const onChange = vi.fn();
    const items = [
      { label: 'Lib:First', value: 'Lib:First' },
      { label: '', value: '' },
      { label: 'Lib:Second', value: 'Lib:Second' },
    ];
    const r = render(<FootprintChoice items={items} value="Lib:First" onChange={onChange} />);
    const btn = r.container.querySelector('.ze-odcombo') as HTMLElement;
    fireEvent.click(btn);

    const rows = Array.from((document.querySelector('.ze-odcombo-popup') as HTMLElement).children);
    fireEvent.mouseDown(rows[1] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();

    // And the keyboard stops at it rather than stepping over it.
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    expect(btn.getAttribute('aria-activedescendant')).toBe((rows[0] as HTMLElement).id);
  });
});

// ---------------------------------------------------------------------------
// Where the list opens.
// ---------------------------------------------------------------------------

describe('the popup is placed against its field', () => {
  it('opens flush under the control, at its left edge', () => {
    // [px] ~/kicad-probes/fp_choice_probe.cpp: combo screen rect (110,177,420x34),
    // popup screen rect (110,211,...) - dx 0, dy 0. The bug being fixed is a
    // native select's list, which the browser put at the top of the window.
    stubFieldRect({ left: 137, top: 400, bottom: 434, width: 260 });
    const { popup } = open(
      <FootprintChoice
        items={[{ label: 'Lib:One', value: 'Lib:One' }]}
        value="Lib:One"
        onChange={() => {}}
      />,
    );

    expect(popup.style.position).toBe('fixed');
    expect(popup.style.left).toBe('137px');
    expect(popup.style.top).toBe('434px');
    // A floor, not a width: the list still grows past the control.
    expect(popup.style.minWidth).toBe('260px');
    // Never the "detached at 0,0" the unmeasured first frame renders at.
    expect(popup.style.visibility).not.toBe('hidden');
  });

  it('flips above the control when the list will not fit below', () => {
    // [px] control at y=1080..1114 on a 1200px screen: wx opened the 398px popup
    // at y=682, its bottom edge exactly on the control's top edge.
    expect(
      placeComboPopup(
        { left: 110, top: 1080, bottom: 1114, width: 420 },
        { width: 748, height: 900 },
        { width: 1920, height: 1200 },
      ),
    ).toEqual({ left: 110, top: 1080 - POPUP_MAX_H, minWidth: 420, maxHeight: POPUP_MAX_H });
  });

  it('opens below whenever the list does fit', () => {
    expect(
      placeComboPopup(
        { left: 110, top: 177, bottom: 211, width: 420 },
        { width: 748, height: 110 },
        { width: 1920, height: 1200 },
      ),
    ).toEqual({ left: 110, top: 211, minWidth: 420, maxHeight: 110 });
  });

  it('clamps a list wider than the viewport back onto it', () => {
    // wx clamps its popup window to the display; a fixed box pushed past the
    // right edge of the viewport is simply unreachable.
    const box = placeComboPopup(
      { left: 1400, top: 100, bottom: 134, width: 300 },
      { width: 900, height: 100 },
      { width: 1920, height: 1200 },
    );
    expect(box.left).toBe(1020);
  });

  it('caps the list at the height wx caps it at', () => {
    // [px] 398 with 200 entries in the list: 1px border, 22 rows of 18, 1px
    // border. Re-derived from the probe, not from whatever we render.
    expect(POPUP_MAX_H).toBe(398);
    expect(rule('.ze-odcombo-popup')).toMatch(/max-height:\s*398px/);
  });
});

// ---------------------------------------------------------------------------
// Everything a native <select> was giving us for free.
// ---------------------------------------------------------------------------

describe('keyboard, which the native select used to provide', () => {
  const items = [
    { label: 'Lib:Alpha', value: 'Lib:Alpha' },
    { label: 'Lib:Beta', value: 'Lib:Beta' },
    { label: 'Lib:Gamma', value: 'Lib:Gamma' },
  ];

  it('moves the highlight with the arrows without committing', () => {
    // [measured] ~/kicad-probes/fp_choice_keys.cpp: with the popup open, Down
    // moved the inner list's selection while the combo's own selection and value
    // stayed put.
    const onChange = vi.fn();
    const r = render(<FootprintChoice items={items} value="Lib:Alpha" onChange={onChange} />);
    const btn = r.container.querySelector('.ze-odcombo') as HTMLElement;
    fireEvent.click(btn);
    const rows = Array.from((document.querySelector('.ze-odcombo-popup') as HTMLElement).children);

    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    expect(btn.getAttribute('aria-activedescendant')).toBe((rows[1] as HTMLElement).id);
    expect((rows[1] as HTMLElement).className).toContain('selected');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    expect(btn.getAttribute('aria-activedescendant')).toBe((rows[2] as HTMLElement).id);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(btn, { key: 'ArrowUp' });
    expect(btn.getAttribute('aria-activedescendant')).toBe((rows[1] as HTMLElement).id);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the highlighted row on Enter and closes', () => {
    const onChange = vi.fn();
    const r = render(<FootprintChoice items={items} value="Lib:Alpha" onChange={onChange} />);
    const btn = r.container.querySelector('.ze-odcombo') as HTMLElement;
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    fireEvent.keyDown(btn, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Lib:Beta');
    expect(document.querySelector('.ze-odcombo-popup')).toBeNull();
  });

  it('closes on Escape WITHOUT committing', () => {
    // [measured] reopened + DOWN left innerSel=1 with comboSel=0; Escape closed
    // the popup and the value was still "Alpha".
    const onChange = vi.fn();
    const r = render(<FootprintChoice items={items} value="Lib:Alpha" onChange={onChange} />);
    const btn = r.container.querySelector('.ze-odcombo') as HTMLElement;
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.ze-odcombo-popup')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps the value with the arrows while CLOSED, as a read-only combo does', () => {
    // [measured] closed + DOWN moved comboSel 0 -> 1 -> 2 and never opened the
    // popup.
    const onChange = vi.fn();
    const r = render(<FootprintChoice items={items} value="Lib:Alpha" onChange={onChange} />);
    const btn = r.container.querySelector('.ze-odcombo') as HTMLElement;
    btn.focus();
    fireEvent.keyDown(btn, { key: 'ArrowDown' });

    expect(onChange).toHaveBeenCalledWith('Lib:Beta');
    expect(document.querySelector('.ze-odcombo-popup')).toBeNull();
  });

  it('jumps to a row by typing its first letters', () => {
    const onChange = vi.fn();
    const r = render(<FootprintChoice items={items} value="Lib:Alpha" onChange={onChange} />);
    const btn = r.container.querySelector('.ze-odcombo') as HTMLElement;
    fireEvent.click(btn);
    const rows = Array.from((document.querySelector('.ze-odcombo-popup') as HTMLElement).children);
    // Every label starts "Lib:", so this walks to the row after the current one.
    fireEvent.keyDown(btn, { key: 'L' });
    expect(btn.getAttribute('aria-activedescendant')).toBe((rows[1] as HTMLElement).id);
  });

  it('is focusable and carries a name and combobox semantics', () => {
    // The half of a native <select> that is not visible. `aria-expanded` is what
    // tells a screen reader the list is open at all.
    const r = render(
      <FootprintSelectWidget
        defaultFootprint=""
        items={LIBS}
        value=""
        onFootprintSelected={() => {}}
      />,
    );
    const btn = r.container.querySelector('.ze-odcombo') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('role')).toBe('combobox');
    expect(btn.getAttribute('aria-label')).toBe('Footprint');
    expect(btn.getAttribute('aria-haspopup')).toBe('listbox');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// The list FOOTPRINT_SELECT_WIDGET builds, and the metrics the rows take.
// ---------------------------------------------------------------------------

describe('FOOTPRINT_SELECT_WIDGET::UpdateList', () => {
  it('puts the default entry first, with the bare LIB_ID as its client data', () => {
    expect(footprintChoiceItems('Lib:Fp', ['A:B'])).toEqual([
      { label: '[Default] Lib:Fp', value: 'Lib:Fp' },
      { label: 'A:B', value: 'A:B' },
    ]);
  });

  it('labels an absent default "No default footprint"', () => {
    expect(footprintChoiceItems('', [])).toEqual([{ label: 'No default footprint', value: '' }]);
  });
});

describe('the rows take GTK’s metrics, not the browser’s', () => {
  it('is one text line tall, which is what GetCharHeight() reports', () => {
    // [px] every row boundary in the popped-up wxVListBox is 18 apart, and
    // GetCharHeight() for Ubuntu Sans 11pt on this desktop is 18 - the same 18
    // --ui-line-height already carries. A native select's rows were ~26.
    const body = rule('.ze-odcombo-item');
    expect(body).toMatch(/height:\s*var\(--ui-line-height\)/);
    expect(body).toMatch(/font-size:\s*var\(--ui-font-size\)/);
    // No local answer to a question the tokens answer.
    expect(body).not.toMatch(/height:\s*\d/);
  });

  it('takes the LISTBOX palette, not the menu palette a wxChoice takes', () => {
    // The two popups are different widgets: [px] this one is #272727 behind
    // #ffffff with a light border, where .ze-combo-popup is #1d1d1d on #4b4b4b.
    const body = rule('.ze-odcombo-popup');
    expect(body).toMatch(/background:\s*var\(--chrome-bg2\)/);
    expect(body).not.toContain('#1d1d1d');
    expect(rule('.ze-odcombo-item')).toMatch(/color:\s*var\(--view-fg\)/);
    expect(rule('.ze-odcombo-item.selected')).toMatch(/background:\s*var\(--selection-bg\)/);
  });

  it('draws the dim run and the separator in the SAME m_grey', () => {
    // `wxColour FOOTPRINT_CHOICE::m_grey( 0x808080 )` is one static used by both
    // draws, so it is one token. It is KiCad's own literal and NOT the theme's
    // grey text (#929292 here), which is what --ctl-fg-disabled carries.
    expect(CSS).toMatch(/--odcombo-grey:\s*#808080/);
    expect(rule('.ze-fp-lib')).toMatch(/color:\s*var\(--odcombo-grey\)/);
    expect(rule('.ze-odcombo-sep::before')).toMatch(/background:\s*var\(--odcombo-grey\)/);
    expect(rule('.ze-fp-lib')).not.toContain('--ctl-fg-disabled');
  });

  it('gives a separator row the 11px OnMeasureItem returns', () => {
    // [data] `if( SafeGetString( aItem ) == wxS( "" ) ) return 11;` - shorter
    // than a text row, and the rule sits at height/2 = 5 down.
    const body = rule('.ze-odcombo-sep');
    expect(body).toMatch(/height:\s*11px/);
    expect(rule('.ze-odcombo-sep::before')).toMatch(/margin-top:\s*5px/);
    expect(rule('.ze-odcombo-sep::before')).toMatch(/height:\s*1px/);
  });

  it('does not wrap a long row', () => {
    // KiCad's popup grows to its widest entry instead; the rows never wrap and
    // never ellipsize.
    expect(rule('.ze-odcombo-item')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.ze-odcombo-popup')).toMatch(/width:\s*max-content/);
  });

  it('has no native <select> left in the footprint selector', () => {
    // The root cause. A <select> hands the option list to the browser, and none
    // of the above is reachable from a stylesheet.
    const r = render(
      <FootprintSelectWidget
        defaultFootprint=""
        items={LIBS}
        value=""
        onFootprintSelected={() => {}}
      />,
    );
    expect(r.container.querySelector('select')).toBeNull();
  });
});
