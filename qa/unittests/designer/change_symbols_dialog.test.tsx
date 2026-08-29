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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogChangeSymbols } from '../../../designer/src/editors/schematic/dialogs/dialog_change_symbols.js';

afterEach(cleanup);

const SUBJECT = {
  reference: 'J1',
  value: 'Screw_Terminal_01x02',
  libId: 'Connector:Screw_Terminal_01x02',
  isSelected: true,
};

function open(subject?: typeof SUBJECT) {
  render(
    <DialogChangeSymbols
      mode="update"
      // `updateFieldsList()` is a function of the match, because upstream
      // rebuilds the list from the symbols the match selects.
      fieldNamesFor={() => ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description']}
      hasSelection
      {...(subject ? { subject } : {})}
      messages={[]}
      onApply={() => {}}
      onClose={() => {}}
    />,
  );
}

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
