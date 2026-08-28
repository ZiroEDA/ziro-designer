// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Assign Footprints window's chrome: the row pitch of its three panes, the
 * fonts they and the status lines carry, the wxAUI caption band, the menu bar
 * and the button row.
 *
 * Every length here was MEASURED by `qa/probes/cvpcb_listbox_probe.cpp`, which
 * builds the widget `CVPCB_MAINFRAME` builds — a `wxListView` with
 * `LISTBOX_STYLE` (cvpcb/listboxes.h:36) carrying `KIUI::GetMonospacedUIFont()`
 * (cvpcb_mainframe.cpp:107-114) — shows it, pumps the loop, and reads
 * `GetItemRect()` and the art provider back out. On this desktop it reports
 *
 *     wxSYS_DEFAULT_GUI_FONT  Ubuntu Sans 11pt, line box 18 px
 *     GetMonospacedUIFont()   face "Monospace", 11pt, 9.000 px per cell
 *     mono list               itemRect0 = 80x24, pitch 24, charHeight 18
 *     mono 7pt / 16pt         pitch 18 / 32 with line boxes 12 / 26
 *     aui caption size        17, caption font 8pt, text #f7f7f7
 *
 * so the row is the line box plus a fixed 6 px, and 24 is the number — not the
 * 18 that shipped, which was the line box being used as the whole row and made
 * all three panes a third too dense.
 *
 * Two halves, failing for different reasons on purpose:
 *
 *  - the RENDERED half asks the real component for what it lays out and what it
 *    puts in its menus and its button row. A structural claim — that the footer
 *    holds three buttons and no assignment count, that a Help menu exists —
 *    cannot be settled by reading a stylesheet.
 *  - the DECLARED half pins the CSS, because happy-dom applies no stylesheet: a
 *    rule's TEXT is the only place the font size and the caption band can be
 *    checked. It is per-rule, not per-file, so a value sitting in a comment or
 *    on some other selector cannot satisfy it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DialogAssignFootprints } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_assign_footprints.js';

afterEach(cleanup);

// The dialog fetches the hosted footprint index on mount. There is no server
// here; answer 404 so it settles instead of filling the log with ECONNREFUSED.
beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
});

const CSS = readFileSync(
  resolve(process.cwd(), '../designer/src/editors/schematic/dialogs/dialog_assign_footprints.css'),
  'utf8',
);

/** One rule's body, by its exact selector text, comments stripped. */
function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for \`${selector}\``);
  const end = CSS.indexOf('\n}', at);
  return CSS.slice(at + selector.length + 2, end).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** One declaration of a rule, or undefined when the rule does not state it. */
function decl(selector: string, prop: string): string | undefined {
  const m = rule(selector).match(new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

// Three symbols, two of them still unassigned, so the panes have rows to lay
// out and the window has somewhere to land.
const SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
      (property "ki_fp_filters" "R_*" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0))
    (property "Footprint" "Resistor_THT:R_Axial_DIN0207" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 60 50 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 0 0 0)) (property "Value" "2k2" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 70 50 0) (unit 1) (uuid "r3")
    (property "Reference" "R3" (at 0 0 0)) (property "Value" "4k7" (at 0 0 0))))`;

function window_(): HTMLElement {
  const docs = new Map([['a.kicad_sch', readSchematic(parse(SHEET))]]);
  const { container } = render(
    <DialogAssignFootprints docs={docs} onApply={() => {}} onClose={() => {}} />,
  );
  return container;
}

/** The inline geometry the virtual list writes on a row. */
function rowBox(el: Element): { top: number; height: number } {
  const s = (el as HTMLElement).style;
  return { top: Number.parseFloat(s.top), height: Number.parseFloat(s.height) };
}

describe('the row pitch of the three panes is the one wx reports', () => {
  it('gives every row the measured 24 px, not the 18 px line box', () => {
    const rows = window_().querySelectorAll('.ze-fpassign-row');
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) expect(rowBox(r).height).toBe(24);
  });

  it('stacks them at that pitch, so the pane is as tall as wx makes it', () => {
    const rows = [...window_().querySelectorAll('.ze-fpassign-row')];
    // Absolute tops, not a height each: a list that drew 24 px rows 18 px apart
    // would pass the assertion above and overlap on screen.
    const tops = rows.map((r) => rowBox(r).top);
    expect(tops.slice(0, 3)).toEqual([0, 24, 48]);
  });
});

describe('the panes carry KIUI::GetMonospacedUIFont, size and all', () => {
  it('states the monospaced family', () => {
    // wxFONTFAMILY_MODERN with no face name; fontconfig answers DejaVu Sans
    // Mono (`fc-match Monospace`), which is what the probe measures at 9 px per
    // cell — the cell the padded columns of formatSymbolDesc line up on.
    expect(decl('.ze-fpassign-list', 'font-family')).toBe('var(--fpassign-mono)');
    expect(rule('.ze-fpassign').includes('"DejaVu Sans Mono"')).toBe(true);
  });

  it('states no size, because the font keeps the GUI font’s point size', () => {
    // `wxFont( guiFontSize, wxFONTFAMILY_MODERN, … )` — the size is
    // wxSYS_DEFAULT_GUI_FONT's, which .ze-app already sets from
    // --ui-font-size. A local size here is what made the rows 12.5 px against
    // KiCad's 11 pt, and restating the token would be the same mistake in a
    // politer form.
    expect(decl('.ze-fpassign-list', 'font-size')).toBeUndefined();
    expect(decl('.ze-fpassign-row', 'font-size')).toBeUndefined();
  });

  it('sets the row’s line box from --ui-text-height, the other half of the 24', () => {
    expect(decl('.ze-fpassign-row', 'line-height')).toBe('var(--ui-text-height)');
  });
});

describe('the bottom panel’s three wxStaticText lines', () => {
  it('carry KIUI::GetStatusFont, i.e. the window font, so state no size', () => {
    expect(decl('.ze-fpassign-status', 'font-size')).toBeUndefined();
    expect(decl('.ze-fpassign-status > div', 'font-size')).toBeUndefined();
  });

  it('take wx’s own ink rather than a grey of ours', () => {
    expect(decl('.ze-fpassign-status', 'color')).toBe('var(--chrome-fg)');
  });

  it('are one GUI-font line each, the 18 px a wxStaticText reports', () => {
    expect(decl('.ze-fpassign-status > div', 'min-height')).toBe('var(--ui-line-height)');
  });

  it('sit two pixels in from the left and nowhere else', () => {
    // `panelSizer->Add( fgSizerStatus, 1, wxEXPAND|wxLEFT, 2 )`,
    // cvpcb_mainframe.cpp:148 — wxLEFT only, and a border of 2.
    expect(decl('.ze-fpassign-status', 'padding')).toBe('0 0 0 2px');
  });
});

describe('the wxAUI caption band over each pane', () => {
  it('is wx’s own 17 px', () => {
    // wxAuiDefaultDockArt's m_captionSize; WX_AUI_DOCK_ART only overrides it
    // inside `#if defined( _WIN32 )` (wx_aui_art_providers.cpp:307-316), so on
    // Linux it stands. Read back off the live art provider by the probe.
    expect(decl('.ze-fpassign', '--fpassign-caption-h')).toBe('17px');
    expect(decl('.ze-fpassign-caption', 'height')).toBe('var(--fpassign-caption-h)');
  });

  it('is wx’s own 8 pt, which is smaller than the UI font and not equal to it', () => {
    expect(decl('.ze-fpassign', '--fpassign-caption-size')).toBe('8pt');
    expect(decl('.ze-fpassign-caption', 'font-size')).toBe('var(--fpassign-caption-size)');
  });

  it('paints wxSYS_COLOUR_BTNTEXT, which WX_AUI_DOCK_ART sets both captions to', () => {
    expect(decl('.ze-fpassign-caption', 'color')).toBe('var(--chrome-fg)');
  });

  it('has no close box: EDA_PANE’s constructor calls CloseButton( false )', () => {
    const captions = [...window_().querySelectorAll('.ze-fpassign-pane > .ze-fpassign-caption')];
    expect(captions).toHaveLength(3);
    for (const c of captions) expect(c.querySelector('.x')).toBeNull();
  });

  it('lets the footprint viewer start where the caption ends', () => {
    expect(decl('.ze-fpassign-viewer', 'inset')).toBe('var(--fpassign-caption-h) 0 0 0');
  });
});

describe('the menu bar is cvpcb/menubar.cpp’s', () => {
  it('ends with the Help menu AddStandardHelpMenu appends', () => {
    const labels = [...window_().querySelectorAll('.ze-menubar > *')].map((e) =>
      e.textContent?.trim(),
    );
    expect(labels).toEqual(['File', 'Edit', 'Preferences', 'Help']);
  });
});

describe('the button row is buttonsSizer, and only that', () => {
  it('holds the three buttons and nothing to their left', () => {
    const footer = window_().querySelector('.ze-modal-footer')!;
    expect([...footer.children].map((c) => c.textContent)).toEqual([
      'Apply, Save Schematic & Continue',
      'Cancel',
      'OK',
    ]);
  });

  it('does not carry a count of assigned symbols, which cvpcb never shows', () => {
    // Anywhere in the window, not just the footer: moving the invention up into
    // a status line would otherwise pass.
    expect(window_().textContent).not.toMatch(/\d+ of \d+ assigned/);
  });
});

describe('the filter status line is DisplayStatus’s first line', () => {
  it('reads "No Filtering" with the count when no filter is on', () => {
    const line = window_().querySelector('.ze-fpassign-status > div')!;
    // `msg = _( "No Filtering" )` then `msg += _( ": %i matching footprints" )`.
    expect(line.textContent).toBe('No Filtering: 0 matching footprints');
  });

  it('shows the assignment rows the way formatSymbolDesc lays them out', () => {
    // The one already-assigned symbol: the footprint after the colon is the
    // thing the report was about, and the padding is read verbatim rather than
    // through a whitespace-normalising matcher.
    const rows = [...window_().querySelectorAll('.ze-fpassign-row')].map((r) => r.textContent);
    expect(rows).toContain('  1       R1 -               1k : Resistor_THT:R_Axial_DIN0207');
    expect(rows).toContain('  2       R2 -              2k2 : ');
  });
});
