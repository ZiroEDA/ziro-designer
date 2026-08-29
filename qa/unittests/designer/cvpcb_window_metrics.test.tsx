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
    const rows = Array.from(window_().querySelectorAll('.ze-fpassign-row'));
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) expect(rowBox(r).height).toBe(24);
  });

  it('stacks them at that pitch, so the pane is as tall as wx makes it', () => {
    const rows = Array.from(window_().querySelectorAll('.ze-fpassign-row'));
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

  it('insets the row text by nothing, because a wxListView row does not', () => {
    // `GetItemRect( 0, r, wxLIST_RECT_LABEL ).x` equals the item's own x, so
    // the text starts flush; the columns are the spaces formatSymbolDesc puts
    // in the STRING. 6 px of padding here shifted every row off that grid.
    expect(decl('.ze-fpassign-row', 'padding')).toBeUndefined();
  });
});

describe('the toolbar’s "Footprint Filters:" label', () => {
  it('sits behind AppendSpacer( 15 ) and nothing else', () => {
    // `config.AppendSeparator().AppendSpacer( 15 ).AppendControl( … )`,
    // toolbars_cvpcb.cpp:69-71. KiCad's number; ours was 10 on the left and a
    // 6 on the right that upstream does not have at all.
    expect(decl('.ze-fpassign-filters-label', 'padding')).toBe('0 0 0 15px');
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

  it('starts its text 4 px in, where DrawCaption puts it', () => {
    // Measured by painting the art provider's caption twice, once with the
    // string and once empty, and taking the first column where the two bitmaps
    // differ (qa/probes/cvpcb_listbox_probe.cpp).
    expect(decl('.ze-fpassign-caption', 'padding')).toBe('0 4px');
  });

  it('paints wxSYS_COLOUR_BTNTEXT, which WX_AUI_DOCK_ART sets both captions to', () => {
    expect(decl('.ze-fpassign-caption', 'color')).toBe('var(--chrome-fg)');
  });

  it('fills from --panel-header, the token every other docked caption uses', () => {
    // `m_gradientType = wxAUI_GRADIENT_NONE` and no wxAUI_MGR_ALLOW_ACTIVE_PANE,
    // so every pane paints wxAUI_DOCKART_INACTIVE_CAPTION_COLOUR flat — the
    // same value --panel-header already holds. This stood here as a private
    // `--fpassign-caption-bg: #2e2e2e`, which the central-value ratchet cannot
    // see: it skips custom-property DECLARATIONS, so a launcher-local token is
    // drift that counts as zero. Hence the second half, which is the half that
    // fails if the private property comes back under any name.
    expect(decl('.ze-fpassign-caption', 'background')).toBe('var(--panel-header)');
    expect(CSS).not.toMatch(/--fpassign-[\w-]*(bg|colou?r)\s*:/);
  });

  it('has no close box: EDA_PANE’s constructor calls CloseButton( false )', () => {
    const captions = Array.from(
      window_().querySelectorAll('.ze-fpassign-pane > .ze-fpassign-caption'),
    );
    expect(captions).toHaveLength(3);
    for (const c of captions) expect(c.querySelector('.x')).toBeNull();
  });

  it('does not put the footprint viewer inside a pane', () => {
    // `CVPCB_CONTROL::ShowFootprintViewer` creates a DISPLAY_FOOTPRINTS_FRAME,
    // a top-level PCB_BASE_FRAME window — not a pane of this dialog. Ours was
    // an absolutely-positioned overlay inset under the Filtered Footprints
    // caption, which is why it had no toolbars, no message panel and no status
    // bar to put anywhere. The rule is gone and must not come back.
    expect(CSS).not.toMatch(/\.ze-fpassign-viewer\b/);
    expect(decl('.ze-fpview-frame', 'position')).toBe('fixed');
  });
});

describe('the window opens at the size EDA_BASE_FRAME gives a cvpcb frame', () => {
  it('is 1280x720, not a size of ours', () => {
    // CVPCB_MAINFRAME hands KIWAY_PLAYER wxDefaultSize, so it takes
    // `defaultSize( aFrameType, this )` — `FromDIP( wxSize( 1280, 720 ) )` for
    // every frame but the project manager (common/eda_base_frame.cpp:110-120).
    const frame = window_().querySelector('.ze-fpassign') as HTMLElement;
    expect(frame.style.width).toBe('1280px');
    expect(frame.style.height).toBe('720px');
  });

  it('will not shrink past minSizeLookup’s 500x400', () => {
    const frame = window_().querySelector('.ze-fpassign') as HTMLElement;
    expect(frame.style.minWidth).toBe('500px');
    expect(frame.style.minHeight).toBe('400px');
  });
});

describe('the menu bar is cvpcb/menubar.cpp’s', () => {
  it('ends with the Help menu AddStandardHelpMenu appends', () => {
    const labels = Array.from(window_().querySelectorAll('.ze-menubar > *')).map((e) =>
      e.textContent?.trim(),
    );
    expect(labels).toEqual(['File', 'Edit', 'Preferences', 'Help']);
  });
});

describe('the button row is buttonsSizer, and only that', () => {
  it('holds the three buttons and nothing to their left', () => {
    const footer = window_().querySelector('.ze-modal-footer')!;
    expect(Array.from(footer.children).map((c) => c.textContent)).toEqual([
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
    const rows = Array.from(window_().querySelectorAll('.ze-fpassign-row')).map(
      (r) => r.textContent,
    );
    expect(rows).toContain('  1       R1 -               1k : Resistor_THT:R_Axial_DIN0207');
    expect(rows).toContain('  2       R2 -              2k2 : ');
  });
});
