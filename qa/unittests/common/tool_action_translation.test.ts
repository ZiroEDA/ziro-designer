// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A TOOL_ACTION's text is stored in English and translated when it is asked
 * for (common/tool/tool_action.cpp:146-206: every getter is
 * `wxGetTranslation( m_... )`), and so is the text of the plain-data action
 * tables and of a `title` the tooltip layer draws. The expected strings are
 * the committed German catalog's own entries, read here from the file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TOOL_ACTION, TOOL_ACTION_ARGS } from '@ziroeda/common/tool/tool_action.js';
import {
  toolbarButtonLabel,
  toolbarButtonTooltip,
} from '@ziroeda/common/tool/action_toolbar_actions.js';
import {
  buttonTooltipFor,
  tooltipFor,
  translateTooltip,
} from '@ziroeda/common/tool/tool_action_tooltip.js';
import { wxMsgCatalog, type wxMsgCatalogData, wxTranslations } from '@ziroeda/wx/translation.js';

const GERMAN = JSON.parse(
  readFileSync(
    join(fileURLToPath(new URL('../../..', import.meta.url)), 'translation/de.json'),
    'utf8',
  ),
) as wxMsgCatalogData;
/** The catalog's own translation of a message, so no German is restated here. */
const de = (msgid: string): string => {
  const s = GERMAN.messages[msgid];
  if (typeof s !== 'string' || s === msgid) throw new Error(`de.json has no entry for ${msgid}`);
  return s;
};

beforeEach(() => wxTranslations.Get().SetCatalog(new wxMsgCatalog(GERMAN)));
afterEach(() => wxTranslations.Get().SetCatalog(null));

describe('TOOL_ACTION', () => {
  it('translates its friendly name, menu label, tooltip and description', () => {
    // ACTIONS::open: .FriendlyName( _HKI( "Open..." ) ).Tooltip( _HKI( "Open existing document" ) )
    expect(ACTIONS.open.GetFriendlyName()).toBe(de('Open...'));
    expect(ACTIONS.open.GetMenuLabel()).toBe(de('Open...'));
    expect(ACTIONS.open.GetTooltip(false)).toBe(de('Open existing document'));
    expect(ACTIONS.open.GetDescription()).toBe(de('Open existing document'));
    expect(ACTIONS.open.GetButtonTooltip()).toContain(de('Open...'));
    expect(ACTIONS.open.GetButtonTooltip()).toContain(`\n${de('Open existing document')}`);
  });

  it('translates a menu label and a description of their own, not the friendly name', () => {
    // ACTIONS::exportTableCSV: .FriendlyName( _HKI( "Export Table to CSV" ) )
    //                          .MenuText( _HKI( "Export Table to CSV..." ) )
    expect(ACTIONS.exportTableCSV.GetMenuLabel()).toBe(de('Export Table to CSV...'));
    expect(ACTIONS.exportTableCSV.GetMenuLabel()).not.toBe(
      ACTIONS.exportTableCSV.GetFriendlyName(),
    );
    // No shipped action states a description apart from its tooltip, so one is made here.
    const described = new TOOL_ACTION(
      new TOOL_ACTION_ARGS()
        .Name('qa.translation.described')
        .FriendlyName('Export Table to CSV')
        .Tooltip('Export table contents to CSV file with resolved text variables')
        .Description('Open existing document'),
    );
    expect(described.GetDescription()).toBe(de('Open existing document'));
    wxTranslations.Get().SetCatalog(null);
    expect(described.GetDescription()).toBe('Open existing document');
  });

  it('is English again with no catalog', () => {
    wxTranslations.Get().SetCatalog(null);
    expect(ACTIONS.open.GetFriendlyName()).toBe('Open...');
    expect(ACTIONS.open.GetTooltip(false)).toBe('Open existing document');
  });
});

describe('the tooltip builders for plain-data action tables', () => {
  it('tooltipFor translates the text and leaves the hotkey', () => {
    expect(tooltipFor('Edit PCB in PCB editor', 'Ctrl+P')).toBe(
      `${de('Edit PCB in PCB editor')}  (Ctrl+P)`,
    );
    expect(tooltipFor('Edit PCB in PCB editor')).toBe(de('Edit PCB in PCB editor'));
  });

  it('buttonTooltipFor translates the name and the second line separately', () => {
    expect(
      buttonTooltipFor(
        'New Project...',
        'Ctrl+N',
        'Create a new project based on an existing project',
      ),
    ).toBe(
      `${de('New Project...')}\t(Ctrl+N)\n${de('Create a new project based on an existing project')}`,
    );
    expect(buttonTooltipFor('Open Project...')).toBe(de('Open Project...'));
  });

  it('a toolbar button of a transcribed action is labelled in the language', () => {
    expect(toolbarButtonLabel('eeschema', 'save')).toBe(de('Save'));
    expect(toolbarButtonTooltip('eeschema', 'save')).toBe(
      `${de('Save')}\t(Ctrl+S)\n${de('Save changes')}`,
    );
    // An untranscribed button falls back to its own title, which is English too.
    expect(toolbarButtonLabel('no-such-app', 'no-such-id', 'Save')).toBe(de('Save'));
    expect(toolbarButtonTooltip('no-such-app', 'no-such-id', 'Save')).toBe(de('Save'));
    // ...and is joined like GetButtonTooltip, so it is read a line at a time, the hotkey kept:
    // toolbars_pcb_editor.ts states the board editor's buttons this way.
    expect(
      toolbarButtonTooltip('no-such-app', 'no-such-id', 'Route Single Track (X)\nRoute tracks'),
    ).toBe(`${de('Route Single Track')} (X)\n${de('Route tracks')}`);
    expect(
      toolbarButtonLabel('no-such-app', 'no-such-id', 'Route Single Track (X)\nRoute tracks'),
    ).toBe(`${de('Route Single Track')} (X)\n${de('Route tracks')}`);
    expect(toolbarButtonTooltip('no-such-app', 'no-such-id', 'Place Footprints (A)')).toBe(
      `${de('Place Footprints')} (A)`,
    );
  });
});

describe('translateTooltip, for a title that reaches the tooltip layer as text', () => {
  it('translates a whole message', () => {
    expect(translateTooltip('Save changes')).toBe(de('Save changes'));
  });

  it('translates each line of a joined button tooltip, keeping the hotkey', () => {
    expect(translateTooltip('Save\t(Ctrl+S)\nSave changes')).toBe(
      `${de('Save')}\t(Ctrl+S)\n${de('Save changes')}`,
    );
    expect(translateTooltip('Edit PCB in PCB editor  (Ctrl+P)')).toBe(
      `${de('Edit PCB in PCB editor')}  (Ctrl+P)`,
    );
  });

  it('returns text that is not a message as given', () => {
    expect(translateTooltip('my_board.kicad_pcb')).toBe('my_board.kicad_pcb');
    expect(translateTooltip('Share with your team  (Ctrl+J)')).toBe(
      'Share with your team  (Ctrl+J)',
    );
    // Already translated: nothing to look up, nothing changed.
    const once = translateTooltip('Save\t(Ctrl+S)\nSave changes');
    expect(translateTooltip(once)).toBe(once);
  });
});
