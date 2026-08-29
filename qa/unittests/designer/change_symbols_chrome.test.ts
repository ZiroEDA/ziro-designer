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
    expect(decl('.ze-chsym-fields', 'flex')).toBe('2');
    expect(decl('.ze-chsym-options', 'flex')).toBe('4');
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
