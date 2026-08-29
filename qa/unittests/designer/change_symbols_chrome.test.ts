// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_CHANGE_SYMBOLS' chrome, against the numbers wxWidgets itself reports
 * on this desktop.
 *
 * `qa/probes/change_symbols_probe.cpp` transcribes `dialog_change_symbols_base.cpp`
 * and `wx_html_report_panel_base.cpp` into real widgets, runs them under the
 * live GTK theme and prints what the toolkit decides:
 *
 *     dialog GetClientSize                    956 x 753
 *     m_mainSizer CalcMin                     956 x 753
 *     bSizerUpdate CalcMin                    956          <- the width driver
 *     m_updateFieldsSizer CalcMin             246
 *     m_updateOptionsSizer CalcMin            624
 *     wxRadioButton GetBestSize               239 x 22
 *     wxTextCtrl GetBestSize                   98 x 34
 *     wxCheckBox GetBestSize                  180 x 22
 *     match row centres                        d=30, 36, 37, 37
 *     wxSYS_COLOUR_LISTBOX                    #272727
 *     wxSYS_COLOUR_WINDOW                     #272727
 *     wxSYS_COLOUR_3DFACE                     #373737
 *
 * Three things this file pins, each of which was wrong:
 *
 *  1. Both inset surfaces — the wxCheckListBox of fields and the report panel's
 *     HTML window — were filled with --ctl-face (#373737), the BUTTON face, so
 *     they read as raised where KiCad's are sunken. They are LISTBOX / WINDOW,
 *     both #272727.
 *  2. The five match rows had their bottom borders folded into the grid's row
 *     gap, which gave every row the same pitch. Only the top two rows carry
 *     `wxBOTTOM 5`; rows 2-4 carry no vertical border at all, and their height
 *     is an entry's (34) against a radio's (22). That is what makes wx's
 *     30 / 36 / 37 / 37 rather than one number.
 *  3. The dialog's width is `bSizerUpdate`'s minimum and nothing else, so the
 *     boxes' 10 px borders and the 2:4 proportions have to be exact; a blanket
 *     body padding sitting outside them cannot be there.
 *
 * happy-dom implements no layout, so every assertion here is on the stated
 * declaration, never on a measured box.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = readFileSync(join(__dirname, '../../../designer/src/ui/shell.css'), 'utf8');

/** The declarations of one rule, by exact selector, comments stripped. */
function rule(selector: string): string {
  const at = SHELL.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = SHELL.indexOf('{', at);
  const body = SHELL.slice(open + 1, SHELL.indexOf('}', open));
  return body.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** One declaration's value, or undefined when the rule does not state it. */
function decl(selector: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(rule(selector));
  return m?.[1]?.trim();
}

/** A `--token: value` from :root. */
function token(name: string): string {
  const m = new RegExp(`\\n\\s*${name}\\s*:\\s*([^;]+)`).exec(SHELL);
  if (!m?.[1]) throw new Error(`no token ${name}`);
  return m[1].trim().split('/*')[0]!.trim();
}

describe('the inset surfaces take the listbox/window colour, not the button face', () => {
  it('the tokens still hold what wx reports for those three system colours', () => {
    // The probe: LISTBOX and WINDOW are both #272727; 3DFACE is #373737.
    expect(token('--chrome-bg2')).toBe('#272727');
    expect(token('--ctl-face')).toBe('#373737');
  });

  it('m_fieldsBox, a wxCheckListBox, is wxSYS_COLOUR_LISTBOX', () => {
    expect(decl('.ze-chsym-fieldbox', 'background')).toBe('var(--chrome-bg2)');
  });

  it('the report panel’s message view is wxSYS_COLOUR_WINDOW', () => {
    // HTML_WINDOW::onThemeChanged sets it explicitly, which is why it is the
    // one surface a GTK backdrop does not shift (html_window.cpp:59).
    expect(decl('.ze-report-view', 'background')).toBe('var(--chrome-bg2)');
  });

  it('and neither one is the button face', () => {
    for (const sel of ['.ze-chsym-fieldbox', '.ze-report-view'])
      expect(decl(sel, 'background')).not.toBe('var(--ctl-face)');
  });
});

describe('the five match rows keep wx’s uneven pitch', () => {
  it('the row gap is the wxGridBagSizer’s vgap alone', () => {
    // `new wxGridBagSizer( 3, 0 )`. It said 5, the bottom border folded in.
    expect(decl('.ze-chsym-match', 'row-gap')).toBe('3px');
    expect(decl('.ze-chsym-match', 'column-gap')).toBe('0');
  });

  it('and only the two rows that carry wxBOTTOM 5 add anything to it', () => {
    // m_matchAll (:29) and m_matchBySelection (:32) — nothing else in the grid
    // states a vertical border.
    expect(decl('.ze-chsym-mspan', 'margin-bottom')).toBe('5px');
    expect(decl('.ze-chsym-mrad', 'margin-bottom')).toBeUndefined();
  });

  it('a radio-only row is a radio tall, so it is shorter than an entry row', () => {
    // 22 against --ctl-height's 34: the probe reports both.
    expect(decl('.ze-chsym-mrad', 'min-height')).toBe('var(--check-row)');
    expect(token('--check-row')).toBe('22px');
    expect(token('--ctl-height')).toBe('34px');
  });

  it('the radios state no trailing border, because wx applies none', () => {
    // The 2 / 5 / 6 on rows 2-4 go with wxALIGN_CENTER_VERTICAL and no
    // direction flag, so wx ignores them; hgap is 0.
    expect(decl('.ze-chsym-mrad', 'padding-right')).toBeUndefined();
  });
});

describe('the width is bSizerUpdate’s minimum, so its borders must be exact', () => {
  it('m_mainSizer puts nothing between its children and no inset around them', () => {
    // The shared `.ze-label-dialog-body` states 14px 16px and a 12px gap; both
    // have to be off here or the boxes' own 10 sits inside another 16.
    expect(decl('.ze-chsym-body', 'padding')).toBe('0');
    expect(decl('.ze-chsym-body', 'gap')).toBe('0');
  });

  it('the two boxes carry the proportions 2 and 4, not a width', () => {
    // As grid tracks — see the grid block at the foot of this file for why
    // flexbox could not hold them.
    expect(decl('.ze-chsym-update', 'grid-template-columns')).toBe('2fr 4fr');
    for (const sel of ['.ze-chsym-fields', '.ze-chsym-options', '.ze-chsym-update'])
      expect(decl(sel, 'width')).toBeUndefined();
  });

  it('with wxTOP|wxRIGHT|wxLEFT 10 on the fields box and no wxLEFT on the options box', () => {
    // `bSizerUpdate->Add( m_updateFieldsSizer, 2, ...|wxTOP|wxRIGHT|wxLEFT, 10 )`
    // and `Add( m_updateOptionsSizer, 4, ...|wxTOP|wxRIGHT, 10 )`.
    expect(decl('.ze-chsym-fields', 'margin')).toBe('10px 10px 0');
    expect(decl('.ze-chsym-options', 'margin')).toBe('10px 10px 0 0');
  });

  it('and the 5 px spacer between them', () => {
    // `bSizerUpdate->Add( 5, 0, 0, wxEXPAND, 5 )`.
    expect(decl('.ze-chsym-update', 'gap')).toBe('5px');
  });

  it('the wxRIGHT 10 is on the left option column only', () => {
    // `Add( bSizer8, 1, wxEXPAND|wxRIGHT, 10 )`; bSizer9 is added with none.
    expect(decl('.ze-chsym-optcol', 'padding-right')).toBeUndefined();
    expect(decl('.ze-chsym-optcol:nth-of-type(1)', 'padding-right')).toBe('10px');
  });

  it('and no rule in the block may shrink a control below its label', () => {
    // A wxSizer never takes a child below its minimum, and a wxCheckBox's
    // minimum is its whole label. `min-width: 0` is how the option columns
    // collapsed until they overlapped each other.
    // Comments first: this block explains at length why `min-width: 0` is
    // wrong, and the prose must not read as the declaration.
    const block = SHELL.slice(SHELL.indexOf('/* DIALOG_CHANGE_SYMBOLS,')).replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const offenders = [...block.matchAll(/(\.ze-chsym-[\w-]+)[^{}]*\{[^}]*min-width:\s*0/g)];
    expect(offenders.map((m) => m[1])).toStrictEqual([]);
  });
});

/**
 * The bug that actually kept this dialog narrow, and the reason it survived a
 * fix: there are TWO copies of the label-column rule.
 *
 *     .ze-label-dialog-body .row > span   { width: 56px; flex: 0 0 auto }
 *     .ze-props-group label.row > span    { width: 56px; flex: 0 0 auto }
 *
 * The first was scoped to `:first-child` when the match radios came out one
 * word per line. The second was not — and it is the one that applies inside a
 * group box, so every checkbox in Update Options was still being crushed into
 * a 56 px column. At (0,2,2) it beat `.ze-chsym-opt > span`'s `nowrap` at
 * (0,1,1), so the labels could neither wrap nor size, and they printed on top
 * of the box beside them.
 *
 * Measured against the real build with the label column freed, the dialog goes
 * from 728 px to 977 against the 956 wx reports.
 *
 * A caption span is the one BEFORE the control. A checkbox or radio carries
 * its label inside the one control, so a span that is not `:first-child` is
 * never a caption — and that is per-rule, not per-file, so every copy is
 * checked rather than just the first.
 */
describe('a control that carries its own label is never given a label column', () => {
  const labelColumnRules = (): string[] => {
    const hits: string[] = [];
    // Every selector whose body fixes a span at the 56 px caption width.
    const re = /\n([^\n{}]*>\s*span[^\n{}]*)\{([^}]*)\}/g;
    for (const m of SHELL.matchAll(re))
      if (/width:\s*56px/.test(m[2] ?? '')) hits.push((m[1] ?? '').trim());
    return hits;
  };

  it('both copies of the rule exist and both are :first-child scoped', () => {
    const rules = labelColumnRules();
    // If a third copy is ever added, it is caught here rather than by a user.
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const sel of rules) expect(sel).toContain(':first-child');
  });

  it('and the option labels state nowrap, so a column is as wide as its widest', () => {
    expect(
      decl(
        '.ze-chsym-opt > span,\n.ze-chsym-fieldbox .row > span,\n.ze-chsym-mrad > span',
        'white-space',
      ),
    ).toBe('nowrap');
  });

  it('the indicator-to-label gap beats the shared .row rule that states 10px', () => {
    // `.ze-label-dialog-body .row { gap: 10px }` is (0,2,0) and outranks both
    // `.ze-chsym-opt` (0,1,0) and `.ze-props-group label` (0,1,1), so the fix
    // has to match its specificity — and still consume the token, not restate
    // a number.
    expect(decl('.ze-label-dialog-body .ze-chsym-opt', 'gap')).toBe('var(--check-inset)');
    expect(decl('.ze-props-group label', 'gap')).toBe('var(--check-inset)');
  });
});

/**
 * wxBoxSizer's proportion is CSS Grid's `fr`, not flexbox's `flex-grow`.
 *
 * A flex item's automatic minimum size is its min-content, and every label in
 * these boxes is `nowrap`, so with `display: flex` both boxes were floored at
 * their own text: the row came out as the SUM of two minimums and the 2:4 was
 * never applied. The fields box measured 236 px against wx's 297.
 *
 * Grid resolves `fr` by taking the largest base-size-over-flex-factor and
 * scaling every track back up by it (css-grid-1 §12.7) — the same arithmetic
 * as wxBoxSizer::CalcMin. Measured, the two now agree: the fields box is
 * 0.476 of the options box in ours and in wx alike.
 */
describe('the 2:4 proportion is a grid track, because flexbox cannot express it', () => {
  it('the update row is a grid of 2fr and 4fr', () => {
    expect(decl('.ze-chsym-update', 'display')).toBe('grid');
    expect(decl('.ze-chsym-update', 'grid-template-columns')).toBe('2fr 4fr');
  });

  it('and the boxes state no flex-grow of their own, which would re-introduce it', () => {
    // `flex: 2` / `flex: 4` on a grid item does nothing, and leaving them in
    // would say the proportion lives somewhere it does not.
    expect(decl('.ze-chsym-fields', 'flex')).toBeUndefined();
    expect(decl('.ze-chsym-options', 'flex')).toBeUndefined();
  });
});

/**
 * WX_HTML_REPORT_PANEL's own chrome. It is a shared widget, so these six
 * dialogs get the same answer — ERC, DRC, Annotate, Plot, Export Netlist and
 * Update PCB from Schematic.
 *
 * A dialog has ONE font size, the GUI font, unless upstream asks for another
 * BY NAME. This panel restated three: 12px on the legend, 12px on the message
 * view, 12px on the Show: strip and 11px on the badges, against a dialog of
 * 14.67. Only two of those have a citation, and both are a POINT size:
 *
 *     m_htmlView->SetFont( KIUI::GetInfoFont( m_htmlView ) )  wx_html_report_panel.cpp:47
 *     KIUI::GetInfoFont = getGUIFont( win, -1 )               ui_common.cpp:156
 *     NUMBER_BADGE::m_textSize( 10 )                          number_badge.cpp:33
 *
 * so the view and the badge are --ui-font-size-info and everything else
 * inherits.
 */
describe('the report panel has one font size, and names its two exceptions', () => {
  it('the Show: strip and the box label state no size of their own', () => {
    expect(decl('.ze-report-filters', 'font-size')).toBeUndefined();
    expect(decl('.ze-report-panel > legend', 'font-size')).toBeUndefined();
  });

  it('the message view is GetInfoFont, one point down', () => {
    expect(decl('.ze-report-view', 'font-size')).toBe('var(--ui-font-size-info)');
  });

  it("and the badge is NUMBER_BADGE's own 10 point", () => {
    expect(decl('.ze-badge', 'font-size')).toBe('var(--ui-font-size-info)');
  });

  it('with the token holding the point size, not a pixel count', () => {
    expect(token('--ui-font-size-info')).toBe('10pt');
    expect(token('--ui-font-size')).toBe('11pt');
  });

  it('no rule in the panel states a px font size at all', () => {
    // Per-rule, so a fourth one added later is caught rather than averaged out.
    const from = SHELL.indexOf('/* WX_HTML_REPORT_PANEL:');
    const block = SHELL.slice(from, SHELL.indexOf('.ze-mitem', from)).replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect([...block.matchAll(/font-size:\s*(\d+px)/g)].map((m) => m[1])).toStrictEqual([]);
  });
});

/**
 * The output box was 200 px tall with the message view 10 px tall inside it —
 * the Show: strip sitting under a sliver, and 130 px of dead space below.
 *
 * `.ze-report-panel` is a <fieldset>, and a fieldset lays its children out in
 * an anonymous box that a flex item's stretched height does not reach. Nor can
 * `height: 100%` help: the wrapper's height comes from `min-height`, which a
 * percentage cannot resolve against. A GRID item's stretch is definite, so the
 * wrapper is a grid and the fieldset's own flex column can divide it.
 */
describe('the output box fills the 200 px upstream reserves for it', () => {
  it('the wrapper is a grid and carries the panel’s minimum', () => {
    expect(decl('.ze-chsym-msgs', 'display')).toBe('grid');
    expect(decl('.ze-chsym-msgs', 'min-height')).toBe('200px');
  });

  it('and nothing sizes the fieldset directly, which is what collapsed it', () => {
    // Both attempts are gone: `min-height: 200px` on the fieldset never
    // reached its anonymous content box, and `height: 100%` resolved against
    // a min-height-derived height, i.e. to the content's own 82 px.
    expect(SHELL).not.toContain('.ze-chsym-msgs > .ze-report-panel');
  });
});
