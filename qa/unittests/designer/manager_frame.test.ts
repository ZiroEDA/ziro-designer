// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KICAD_MANAGER_FRAME`'s window title and status-bar line, against
 * `kicad/kicad_manager_frame.cpp`.
 *
 * Both were ours rather than KiCad's, and swapped: the bracketed placeholder
 * that belongs in the title had been reworded into the status bar, and the
 * title carried a shorter phrase of our own. Neither was pinned.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_PROJECT_TITLE,
  READ_ONLY_SUFFIX,
  managerTitle,
  projectStatusText,
} from '@ziroeda/designer/src/home/manager_frame.js';

describe('the title', () => {
  it('is the project’s basename without its extension', () => {
    // title = fn.GetName() (:1296), which drops the extension.
    expect(managerTitle('demo', 'ZiroEDA')).toBe('demo — ZiroEDA');
    expect(managerTitle('demo.kicad_pro', 'ZiroEDA')).toBe('demo — ZiroEDA');
  });

  it('is "[no project loaded]" with no project', () => {
    // _( "[no project loaded]" ) (:1304), brackets and all - not "No project".
    expect(NO_PROJECT_TITLE).toBe('[no project loaded]');
    expect(managerTitle(null, 'ZiroEDA')).toBe('[no project loaded] — ZiroEDA');
    expect(managerTitle(undefined, 'ZiroEDA')).toBe('[no project loaded] — ZiroEDA');
    expect(managerTitle('   ', 'ZiroEDA')).toBe('[no project loaded] — ZiroEDA');
  });

  it('appends " [Read Only]" after the name, before the app', () => {
    //     title = fn.GetName();
    //     if( Prj().IsReadOnly() )
    //         title += wxS( " " ) + _( "[Read Only]" );
    // (:1296-1299) - inside the name half, not after the app name.
    expect(READ_ONLY_SUFFIX).toBe('[Read Only]');
    expect(managerTitle('demo', 'ZiroEDA', true)).toBe('demo [Read Only] — ZiroEDA');
  });

  it('does not append the suffix when there is no project to be read-only', () => {
    // The else branch has no suffix at all.
    expect(managerTitle(null, 'ZiroEDA', true)).toBe('[no project loaded] — ZiroEDA');
  });

  it('separates with an em dash and one space either side', () => {
    // title += wxT( " — " ) + ... (:1307, :1309).
    expect(managerTitle('demo', 'X')).toBe('demo — X');
    expect(managerTitle('demo', 'X')).not.toContain(' - ');
  });
});

describe('the status-bar line', () => {
  it('is "Project: " and the whole path', () => {
    // wxString::Format( _( "Project: %s" ), Prj().GetProjectFullName() ) (:1356),
    // and GetProjectFullName is m_project_name.GetFullPath() - the full path,
    // not a basename.
    expect(projectStatusText('/demo/demo.kicad_pro')).toBe('Project: /demo/demo.kicad_pro');
  });

  it('is EMPTY with no project, not a sentence of our own', () => {
    // CloseProject does SetStatusText( "" ) (:856) and PrintPrjInfo only ever
    // runs with a project loaded. "No project loaded" appears nowhere in KiCad
    // except as a *title* (:1304), and we were writing it here.
    expect(projectStatusText(null)).toBe('');
    expect(projectStatusText(undefined)).toBe('');
    expect(projectStatusText('   ')).toBe('');
  });

  it('never writes the title’s placeholder into the status bar', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(projectStatusText(v)).not.toContain('project');
      expect(projectStatusText(v)).not.toContain('Project');
    }
  });
});
