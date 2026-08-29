// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_CHANGE_SYMBOLS opened ON a symbol seeds itself from that symbol.
 *
 * `TransferDataToWindow` (dialog_change_symbols.cpp:144-160):
 *
 *     if( m_symbol ) {
 *         m_specifiedReference->ChangeValue( m_symbol->GetRef( currentSheet ) );
 *         m_specifiedValue->ChangeValue( UnescapeString( ...VALUE...GetText() ) );
 *         m_specifiedId->ChangeValue( UnescapeString( m_symbol->GetLibId().Format() ) );
 *     }
 *     if( m_symbol && m_symbol->IsSelected() ) m_matchBySelection->SetValue( true );
 *     else if( m_mode == MODE::UPDATE )        m_matchAll->SetValue( true );
 *     else                                     m_matchByReference->SetValue( true );
 *
 * Three SEPARATE entries, one per match row — not one shared box — and each is
 * filled whether or not its radio is the one chosen, so switching rows finds
 * the value already there.
 *
 * Akshay reached this dialog through Symbol Properties' "Update Symbol from
 * Library...", where KiCad shows J1 / Screw_Terminal_01x02 /
 * Connector:Screw_Terminal_01x02 already filled in and ours showed three empty
 * boxes.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DialogChangeSymbols } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_change_symbols.js';

afterEach(cleanup);

const SUBJECT = {
  reference: 'J1',
  value: 'Screw_Terminal_01x02',
  libId: 'Connector:Screw_Terminal_01x02',
  isSelected: true,
};

type Message = { text: string; severity: 'action' | 'error' };

function open(
  subject?: typeof SUBJECT,
  messages: readonly Message[] = [],
  mode: 'update' | 'change' = 'update',
) {
  render(
    <DialogChangeSymbols
      mode={mode}
      // `updateFieldsList()` is a function of the match, because upstream
      // rebuilds the list from the symbols the match selects.
      fieldNamesFor={() => ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description']}
      hasSelection
      {...(subject ? { subject } : {})}
      messages={messages}
      onApply={() => {}}
      onClose={() => {}}
    />,
  );
}

/** The message view WX_HTML_REPORT_PANEL's m_htmlView stands in for. */
const view = (): HTMLElement => screen.getByTestId('report-panel-view');
/** Its visible lines, prefix included, in report order. */
const lines = (): string[] =>
  Array.from(view().querySelectorAll('.ze-report-line')).map((n) => n.textContent ?? '');
/** m_errorsBadge then m_warningsBadge, the order bSizerBottom adds them in. */
const badges = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.ze-report-filters .ze-badge'));

const entry = (name: string): HTMLInputElement =>
  screen.getByLabelText(name, { selector: 'input.ze-search' }) as HTMLInputElement;

describe('the three match entries are seeded from the symbol', () => {
  it('reference, value and library identifier all carry the symbol’s own', () => {
    open(SUBJECT);
    expect(entry('Update symbols matching reference designator:').value).toBe('J1');
    expect(entry('Update symbols matching value:').value).toBe('Screw_Terminal_01x02');
    expect(entry('Update symbols matching library identifier:').value).toBe(
      'Connector:Screw_Terminal_01x02',
    );
  });

  it('and are empty when the dialog is opened without one', () => {
    // From the Tools menu there is no `m_symbol`.
    open();
    expect(entry('Update symbols matching reference designator:').value).toBe('');
    expect(entry('Update symbols matching value:').value).toBe('');
  });
});

describe('the opening radio follows m_symbol->IsSelected()', () => {
  it('is "selected symbol(s)" when the symbol is selected', () => {
    open(SUBJECT);
    expect((screen.getByLabelText(/selected symbol/i) as HTMLInputElement).checked).toBe(true);
  });

  it('is "all symbols" in UPDATE mode when it is not', () => {
    open({ ...SUBJECT, isSelected: false });
    expect(
      (screen.getByLabelText('Update all symbols in schematic') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('and the selected-symbol row does not exist at all without a symbol', () => {
    // `if( !m_symbol ) m_matchSizer->FindItem( m_matchBySelection )->Show( false )`.
    open();
    expect(screen.queryByLabelText(/selected symbol/i)).toBeNull();
  });
});

describe('the Update Options box', () => {
  it('carries the two that are always on and cannot be turned off', () => {
    // `SetValue( true )` then `Enable( false )` (base.cpp:160-161, 167-168):
    // they state what the operation always does, they are not options.
    open(SUBJECT);
    for (const label of ['Update symbol shape and pins', 'Update keywords and footprint filters']) {
      const box = screen.getByLabelText(label) as HTMLInputElement;
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(true);
    }
  });

  it('and Check All / Uncheck All sweep the rest', () => {
    open(SUBJECT);
    const positions = screen.getByLabelText('Update/reset field positions') as HTMLInputElement;
    expect(positions.checked).toBe(false); // UPDATE-mode default
    fireEvent.click(screen.getByRole('button', { name: 'Check All Update Options' }));
    expect(
      (screen.getByLabelText('Update/reset field positions') as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Uncheck All Update Options' }));
    expect((screen.getByLabelText('Update/reset field text') as HTMLInputElement).checked).toBe(
      false,
    );
  });
});

describe('the report panel is always present', () => {
  it('even with nothing in it — the dialog opens showing an empty one', () => {
    // `m_messagePanel` is added unconditionally with SetMinSize( -1, 200 ).
    open(SUBJECT);
    expect(screen.getByText('Output Messages')).toBeTruthy();
  });
});

/**
 * `m_messagePanel` is a WX_HTML_REPORT_PANEL, not a list of lines this dialog
 * draws itself, so it brings WX_HTML_REPORT_PANEL_BASE's bottom row with it:
 *
 *     Show:  [x] All  [x] Errors (0)  [x] Warnings (0)  [x] Actions  [x] Infos   [ Save... ]
 *
 * The dialog had none of it. Each `it` below fails if the panel is hand-rolled
 * again, because none of these controls exist unless the shared widget is the
 * thing mounted.
 */
/**
 * Two rules in the CSS block are addressed by position rather than by a class,
 * because the sizer treats the two option columns differently:
 *
 *   `m_updateOptionsSizer->Add( bSizer8, 1, wxEXPAND|wxRIGHT, 10 )`  <- border
 *   `m_updateOptionsSizer->Add( bSizer9, 1, wxEXPAND, 5 )`           <- none
 *
 * and the last checkbox above each button takes wxBOTTOM 10 where the rest
 * take 5 (:150, :189). A positional selector that quietly matches the wrong
 * element — or both — is a number nothing reads, so the match is pinned here.
 */
/**
 * Which fields the checklist opens with. DIALOG_CHANGE_SYMBOLS' constructor
 * (:97-111) walks MANDATORY_FIELDS — REFERENCE, VALUE, FOOTPRINT, DATASHEET,
 * DESCRIPTION (template_fieldnames.h:59) — and checks each:
 *
 *     if( fieldId == REFERENCE )   Check( listIdx, selectReference );
 *     else if( fieldId == VALUE )  Check( listIdx, selectValue );
 *     else                         Check( listIdx, true );
 *
 * with selectReference/selectValue out of EESCHEMA_SETTINGS'
 * m_ChangeSymbols.updateReferences / .updateValues, both defaulting to FALSE
 * (eeschema_settings.cpp:636,639).
 *
 * Ours opened with Reference + Value + Footprint + Datasheet — the two that
 * should be off were on, and Description, which should be on, was off. Akshay
 * caught it opening the dialog on the same symbol in both builds.
 */
describe('the Update/Reset Fields checklist opens the way upstream leaves it', () => {
  const ticked = (): string[] =>
    Array.from(document.querySelectorAll('.ze-chsym-fieldbox label'))
      .filter((l) => (l.querySelector('input') as HTMLInputElement | null)?.checked)
      .map((l) => l.textContent?.trim() ?? '');

  it('the three non-identity mandatory fields are on', () => {
    open(SUBJECT);
    expect(ticked()).toStrictEqual(['Footprint', 'Datasheet', 'Description']);
  });

  it('and Reference and Value are off, because renaming from the library is the destructive one', () => {
    open(SUBJECT);
    for (const name of ['Reference', 'Value']) expect(ticked()).not.toContain(name);
  });
});

/**
 * `m_matchIdBrowserButton` is a STD_BITMAP_BUTTON — an ordinary bordered
 * button beside the library-id entry. It carried `.ze-grid-cellbtn`, which is
 * GRID_CELL_TEXT_BUTTON's in-cell button: transparent and borderless by
 * design, because that one sits inside a grid cell. Beside an entry it read as
 * a bare icon with no button around it.
 */
describe('the library-identifier browse button is a STD_BITMAP_BUTTON', () => {
  it('it takes that widget’s shared chrome, not the in-cell button’s', () => {
    open(SUBJECT);
    const btn = screen.getByRole('button', { name: 'Browse for symbol' });
    expect(btn.className).toContain('ze-gridbtn');
    expect(btn.className).not.toContain('ze-grid-cellbtn');
  });

  it('and sits beside the library-id entry only, as bSizer10 puts it', () => {
    open(SUBJECT);
    // The reference and value rows have no browse button; only m_specifiedId.
    expect(screen.getAllByRole('button', { name: 'Browse for symbol' })).toHaveLength(1);
  });

  /**
   * It was rendered `disabled` while the chooser was unwired. It is not a new
   * dialog: `launchMatchIdSymbolBrowser` (:245) does
   * `Kiway().Player( FRAME_SYMBOL_CHOOSER, true, this )`, and
   * SYMBOL_CHOOSER_FRAME is a shell around the SAME PANEL_SYMBOL_CHOOSER that
   * DIALOG_SYMBOL_CHOOSER (Place Symbol) wraps — one panel, two hosts.
   */
  it('is enabled, and opens the chooser', () => {
    open(SUBJECT);
    const btn = screen.getByRole('button', { name: 'Browse for symbol' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    expect(document.querySelector('.ze-symbol-chooser')).toBeNull();
    fireEvent.click(btn);
    expect(document.querySelector('.ze-symbol-chooser')).not.toBeNull();
  });

  it('the chooser it opens is the FRAME, not the Place Symbol dialog', () => {
    open(SUBJECT);
    fireEvent.click(screen.getByRole('button', { name: 'Browse for symbol' }));

    // `SetTitle( GetTitle() + " (%d items loaded)" )` on a frame titled
    // "Symbol Chooser" (:72, :117) — DIALOG_SYMBOL_CHOOSER's is "Choose Symbol".
    const header = document.querySelector('.ze-symbol-chooser .ze-modal-header');
    expect(header?.textContent).toContain('Symbol Chooser');
    expect(header?.textContent).not.toContain('Choose Symbol');

    // The frame's bottom panel is a bare wxStdDialogButtonSizer: the two
    // placement checkboxes belong to the dialog and must not appear here.
    expect(screen.queryByText('Place repeated copies')).toBeNull();
    expect(screen.queryByText('Place all units')).toBeNull();
  });

  it('the Change mode’s new-id row has its own button, m_newIdBrowserButton', () => {
    // _base.cpp:97 builds a second STD_BITMAP_BUTTON beside m_newId. That row
    // had no button at all, so only one of upstream's two was reachable.
    open(SUBJECT, [], 'change');
    expect(screen.getByRole('button', { name: 'Browse for new symbol' })).not.toBeNull();
  });

  /**
   * Both backdrops are `.ze-modal-backdrop`, which is `position: fixed;
   * z-index: 200` — the same stacking level, so DOCUMENT ORDER is the only
   * thing deciding which one paints on top. The chooser was rendered before
   * the dialog and was therefore painted over by the very dialog that opened
   * it: mounted, findable in the DOM, and invisible on screen. Every
   * assertion above still passed, because none of them looks at order.
   */
  it('paints above the dialog that opened it, which only document order decides', () => {
    open(SUBJECT);
    fireEvent.click(screen.getByRole('button', { name: 'Browse for symbol' }));

    const backdrops = Array.from(document.querySelectorAll('.ze-modal-backdrop'));
    const dialogAt = backdrops.findIndex((b) => b.querySelector('.ze-chsym'));
    const chooserAt = backdrops.findIndex((b) => b.querySelector('.ze-symbol-chooser'));

    expect(dialogAt).toBeGreaterThanOrEqual(0);
    expect(chooserAt).toBeGreaterThanOrEqual(0);
    // Later sibling wins at equal z-index, so the chooser must come second.
    expect(chooserAt).toBeGreaterThan(dialogAt);
  });

  /**
   * The panel's signature is
   *   `(…, bool aAllowFieldEdits, bool aShowFootprints, bool& aCancelled, …)`
   * and SYMBOL_CHOOSER_FRAME hardcodes `false, false` (symbol_chooser_frame.cpp
   * :87). DIALOG_SYMBOL_CHOOSER forwards both from ITS caller, which is where
   * the "Show footprint previews in Symbol Chooser" preference gets in — the
   * frame consults no preference at all. The header: "if false, all footprint
   * preview and selection features are disabled. This forces aAllowFieldEdits
   * false too."
   *
   * This shipped reading the preference, so it showed the footprint preview and
   * the footprint selector where the real dialog shows one symbol pane and
   * nothing else. Akshay caught it against a live KiCad.
   */
  it('shows no footprint preview and no footprint selector', () => {
    open(SUBJECT);
    fireEvent.click(screen.getByRole('button', { name: 'Browse for symbol' }));

    const chooser = document.querySelector('.ze-symbol-chooser') as HTMLElement;
    expect(chooser.querySelector('.ze-chooser-fppreview')).toBeNull();
    expect(within(chooser).queryByLabelText('Footprint')).toBeNull();
  });

  it('closing the chooser leaves the dialog that opened it standing', () => {
    // The chooser is a SIBLING of this dialog's backdrop. Nested, a click on
    // the chooser's backdrop would bubble into `onMouseDown={onClose}` and
    // dismiss Change Symbols along with it.
    open(SUBJECT);
    fireEvent.click(screen.getByRole('button', { name: 'Browse for symbol' }));
    const chooserBackdrop = document.querySelector('.ze-symbol-chooser')
      ?.parentElement as HTMLElement;
    fireEvent.mouseDown(chooserBackdrop);
    expect(document.querySelector('.ze-symbol-chooser')).toBeNull();
    expect(document.querySelector('.ze-chsym')).not.toBeNull();
  });
});

describe('the positional selectors reach the elements the sizer distinguishes', () => {
  it('nth-of-type(1) is bSizer8 alone, not both columns', () => {
    open(SUBJECT);
    const both = Array.from(document.querySelectorAll('.ze-chsym-optcol'));
    expect(both).toHaveLength(2);
    const bordered = Array.from(document.querySelectorAll('.ze-chsym-optcol:nth-of-type(1)'));
    expect(bordered).toHaveLength(1);
    expect(bordered[0]).toBe(both[0]);
    expect(bordered[0]?.textContent).toContain('Remove fields if not in library symbol');
  });

  it('and last-of-type is the option each button sits under, in both columns', () => {
    open(SUBJECT);
    const last = Array.from(document.querySelectorAll('.ze-chsym-optcol')).map(
      (c) => c.querySelector('.ze-chsym-opt:last-of-type')?.textContent,
    );
    // m_resetFieldPositions and m_resetCustomPower — the two with wxBOTTOM 10.
    expect(last).toStrictEqual(['Update/reset field positions', 'Reset custom power symbols']);
  });
});

describe('the Show: strip, which comes with WX_HTML_REPORT_PANEL', () => {
  it('carries the label, all five severity boxes and Save...', () => {
    open(SUBJECT);
    expect(screen.getByText('Show:')).toBeTruthy();
    // WX_HTML_REPORT_PANEL_BASE creates exactly these five, in this order,
    // every one `SetValue( true )`.
    for (const name of ['All', 'Errors', 'Warnings', 'Actions', 'Infos']) {
      const box = screen.getByLabelText(name) as HTMLInputElement;
      expect(box.type).toBe('checkbox');
      expect(box.checked).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Save...' })).toBeTruthy();
  });

  it('and the two NUMBER_BADGEs count errors and warnings, not lines', () => {
    // updateBadges(): Count( RPT_SEVERITY_ERROR ) and Count( RPT_SEVERITY_WARNING ).
    // Three lines here, two of them errors and none a warning.
    open(SUBJECT, [
      { text: 'R1: *** symbol not found ***', severity: 'error' },
      { text: 'C1: *** symbol not found ***', severity: 'error' },
      { text: 'J1: updated', severity: 'action' },
    ]);
    expect(badges().map((b) => b.textContent)).toStrictEqual(['2', '0']);
  });

  it('unticking Errors drops the error lines and leaves the actions', () => {
    // generateHtml returns nothing for a line outside GetVisibleSeverities().
    open(SUBJECT, [
      { text: 'R1: *** symbol not found ***', severity: 'error' },
      { text: 'J1: updated', severity: 'action' },
    ]);
    expect(lines()).toStrictEqual(['Error: R1: *** symbol not found ***', 'J1: updated']);
    fireEvent.click(screen.getByLabelText('Errors'));
    expect(lines()).toStrictEqual(['J1: updated']);
    // The badge still counts what the report HOLDS, not what is on screen:
    // Count() walks m_report, and only generateHtml consults the mask.
    expect(badges().map((b) => b.textContent)).toStrictEqual(['1', '0']);
  });

  it('unticking All clears the rest but forces Errors back on', () => {
    // onCheckBox: m_checkBoxShowErrors->SetValue( true ) unconditionally, then
    // the other three follow event.IsChecked().
    open(SUBJECT, [
      { text: 'R1: *** symbol not found ***', severity: 'error' },
      { text: 'J1: updated', severity: 'action' },
    ]);
    fireEvent.click(screen.getByLabelText('All'));
    expect((screen.getByLabelText('Errors') as HTMLInputElement).checked).toBe(true);
    for (const name of ['All', 'Warnings', 'Actions', 'Infos'])
      expect((screen.getByLabelText(name) as HTMLInputElement).checked).toBe(false);
    expect(lines()).toStrictEqual(['Error: R1: *** symbol not found ***']);
  });

  it('prefixes an error line with "Error:" and an action line with nothing', () => {
    // generateHtml: only RPT_SEVERITY_ERROR and _WARNING take a prefix;
    // an ACTION line is the message alone, coloured.
    open(SUBJECT, [
      { text: 'R1: *** symbol not found ***', severity: 'error' },
      { text: 'J1: updated', severity: 'action' },
    ]);
    const rendered = view().querySelectorAll('.ze-report-line');
    expect(rendered[0]?.querySelector('.tag')?.textContent).toBe('Error: ');
    expect(rendered[1]?.querySelector('.tag')).toBe(null);
    expect(rendered[1]?.className).toContain('action');
  });
});
