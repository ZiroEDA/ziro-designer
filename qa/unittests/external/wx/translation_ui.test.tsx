// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The wx widgets translate what they draw, and redraw when the language
 * changes - `EDA_BASE_FRAME::ShowChangedLanguage`, for a React tree. The
 * catalog here is hand-built: the lookup has its own tests, this is about the
 * widgets calling it and being subscribed.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, CheckBox, RadioBox, StaticBox, StaticText } from '@ziroeda/wx/controls.js';
import { Dialog } from '@ziroeda/wx/dialog.js';
import { MenuBar } from '@ziroeda/wx/menu_ui.js';
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import type { Menu } from '@ziroeda/wx/menu.js';
import { wxMsgCatalog, wxTranslations } from '@ziroeda/wx/translation.js';

const GERMAN = new wxMsgCatalog({
  language: 'de',
  nplurals: 2,
  plural: 'n != 1',
  messages: {
    '&File': '&Datei',
    'Open Project...': 'Projekt öffnen...',
    'Open the project': 'Das Projekt öffnen',
    Default: 'Voreinstellung',
    English: 'Englisch (must never be shown)',
    Browse: 'Durchsuchen',
    Options: 'Optionen',
    'Show grid': 'Raster anzeigen',
    Units: 'Einheiten',
    Inches: 'Zoll',
    Millimeters: 'Millimeter',
    'Page Settings': 'Seiteneinstellungen',
    General: 'Allgemein',
    Close: 'Schließen',
  },
});

const setCatalog = (c: wxMsgCatalog | null): void => act(() => wxTranslations.Get().SetCatalog(c));

afterEach(() => {
  cleanup();
  wxTranslations.Get().SetCatalog(null);
});

const MENUS: Menu[] = [
  {
    label: 'File',
    items: [
      { label: 'Open Project...', tooltip: 'Open the project', mnemonic: 'O' },
      { label: 'Default' },
      // LANGUAGE_DESCR::m_DoNotTranslate: an endonym is drawn as given.
      { label: 'English', noTranslate: true },
      { label: 'my_board.kicad_pcb' },
    ],
  },
];

describe('MenuBar', () => {
  it('draws English with no catalog, the translation with one, and follows a change live', () => {
    const { container } = render(<MenuBar menus={MENUS} />);
    const bar = (): string[] =>
      [...container.querySelectorAll('.ze-menu')].map((m) => m.firstChild!.textContent!);
    expect(bar()).toEqual(['File']);

    // Open the menu, then change the language with it open.
    fireEvent.click(container.querySelector('.ze-menu')!);
    const rows = (): string[] =>
      [...container.querySelectorAll('.ze-mitem .lbl')].map((r) => r.textContent!);
    expect(rows()).toEqual(['Open Project...', 'Default', 'English', 'my_board.kicad_pcb']);
    // The English label has its mnemonic underlined.
    expect(container.querySelector('.ze-mitem .lbl u')?.textContent).toBe('O');

    setCatalog(GERMAN);
    expect(bar()).toEqual(['Datei']);
    expect(rows()).toEqual([
      'Projekt öffnen...',
      'Voreinstellung',
      'English',
      'my_board.kicad_pcb',
    ]);
    expect(container.querySelector('.ze-mitem')?.getAttribute('title')).toBe('Das Projekt öffnen');
    // The mnemonic was a letter of the English label: none is underlined.
    expect(container.querySelector('.ze-mitem .lbl u')).toBeNull();

    setCatalog(null);
    expect(bar()).toEqual(['File']);
    expect(rows()).toEqual(['Open Project...', 'Default', 'English', 'my_board.kicad_pcb']);
  });
});

describe('the wx controls', () => {
  it('translate their labels and follow a language change', () => {
    const { container } = render(
      <Dialog title="Page Settings" onClose={() => {}}>
        <StaticBox label="Options">
          <StaticText label="Units" />
          <CheckBox label="Show grid" checked onChange={() => {}} />
          <RadioBox
            label="Units"
            choices={['Inches', 'Millimeters']}
            selection={0}
            onChange={() => {}}
          />
          <Button label="Browse" title="Open the project" />
          <StaticText label="/home/me/board.kicad_pcb" />
        </StaticBox>
        <Notebook
          pages={[{ text: 'General', content: <span /> }]}
          selection={0}
          onPageChanged={() => {}}
        />
      </Dialog>,
    );
    const text = (sel: string): string[] =>
      [...container.ownerDocument.querySelectorAll(sel)].map((e) => e.textContent!);
    const dialog = (): Element => container.ownerDocument.querySelector('[role="dialog"]')!;

    expect(dialog().getAttribute('aria-label')).toBe('Page Settings');
    expect(text('legend')).toEqual(['Options', 'Units']);
    expect(text('.ze-btn')).toEqual(['Browse']);

    setCatalog(GERMAN);
    expect(dialog().getAttribute('aria-label')).toBe('Seiteneinstellungen');
    expect(dialog().querySelector('.ze-modal-header')!.firstChild!.textContent).toBe(
      'Seiteneinstellungen',
    );
    expect(dialog().querySelector('.ze-modal-header .x')!.getAttribute('title')).toBe('Schließen');
    expect(text('legend')).toEqual(['Optionen', 'Einheiten']);
    expect(text('.ze-statictext')).toEqual(['Einheiten', '/home/me/board.kicad_pcb']);
    expect(text('.ze-check')).toEqual(['Raster anzeigen', 'Zoll', 'Millimeter']);
    expect(text('.ze-btn')).toEqual(['Durchsuchen']);
    expect(dialog().querySelector('.ze-btn')!.getAttribute('title')).toBe('Das Projekt öffnen');
    expect(text('[role="tab"]')).toEqual(['Allgemein']);
  });
});
