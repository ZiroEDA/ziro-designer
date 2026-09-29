// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The `eeschema` KIFACE (eeschema/eeschema.cpp): `OnKifaceStart`'s settings
 * registration, `CreateKiWindow`'s page switch, and `SaveFileAs` over each
 * file type it handles, with common's `CopySexprFile` underneath.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { CopySexprFile } from '@ziroeda/common/gestfich.js';
import {
  CreateKiWindow,
  type EESCHEMA_PAGES,
  OnKifaceStart,
  SaveFileAs,
} from '@ziroeda/eeschema/eeschema.js';
import { EESCHEMA_DEFAULTS, currentEeschemaSettings } from '@ziroeda/eeschema/eeschema_settings.js';
import {
  SYMBOL_EDITOR_DEFAULTS,
  currentSymbolEditorSettings,
} from '@ziroeda/eeschema/symbol_editor/symbol_editor_settings.js';

describe('OnKifaceStart', () => {
  it('registers both settings objects the frames read', () => {
    const ee = { ...EESCHEMA_DEFAULTS };
    const sym = { ...SYMBOL_EDITOR_DEFAULTS };
    OnKifaceStart(
      () => ee,
      () => sym,
    );
    expect(currentEeschemaSettings()).toBe(ee);
    expect(currentSymbolEditorSettings()).toBe(sym);
  });
});

describe('CreateKiWindow', () => {
  const pages: EESCHEMA_PAGES<string> = {
    PANEL_SYM_DISPLAY_OPTIONS: 'sym-disp',
    PANEL_SYM_GRID_SETTINGS: 'sym-grid',
    PANEL_SYM_EDITING_OPTIONS: 'sym-edit',
    PANEL_SYM_TOOLBAR_CUSTOMIZATION: 'sym-tb',
    PANEL_SYM_COLOR_SETTINGS: 'sym-col',
    PANEL_EESCHEMA_DISPLAY_OPTIONS: 'sch-disp',
    PANEL_SCH_GRID_SETTINGS: 'sch-grid',
    PANEL_EESCHEMA_EDITING_OPTIONS: 'sch-edit',
    PANEL_SCH_TOOLBAR_CUSTOMIZATION: 'sch-tb',
    PANEL_EESCHEMA_COLOR_SETTINGS: 'sch-col',
    PANEL_TEMPLATE_FIELDNAMES: 'fields',
    PANEL_SCH_DATA_SOURCES: 'sources',
    PANEL_SIMULATOR_PREFERENCES: 'sim',
  };

  it('answers every PANEL_SYM_* and PANEL_SCH_* id with its page', () => {
    const got = [
      FRAME_T.PANEL_SYM_DISP_OPTIONS,
      FRAME_T.PANEL_SYM_EDIT_GRIDS,
      FRAME_T.PANEL_SYM_EDIT_OPTIONS,
      FRAME_T.PANEL_SYM_TOOLBARS,
      FRAME_T.PANEL_SYM_COLORS,
      FRAME_T.PANEL_SCH_DISP_OPTIONS,
      FRAME_T.PANEL_SCH_GRIDS,
      FRAME_T.PANEL_SCH_EDIT_OPTIONS,
      FRAME_T.PANEL_SCH_TOOLBARS,
      FRAME_T.PANEL_SCH_COLORS,
      FRAME_T.PANEL_SCH_FIELD_NAME_TEMPLATES,
      FRAME_T.PANEL_SCH_DATA_SOURCES,
      FRAME_T.PANEL_SCH_SIMULATOR,
    ].map((id) => CreateKiWindow(id, pages));
    expect(got).toEqual([
      'sym-disp',
      'sym-grid',
      'sym-edit',
      'sym-tb',
      'sym-col',
      'sch-disp',
      'sch-grid',
      'sch-edit',
      'sch-tb',
      'sch-col',
      'fields',
      'sources',
      'sim',
    ]);
  });

  it('answers nothing for a frame, another kiface’s page, or a page not supplied', () => {
    expect(CreateKiWindow(FRAME_T.FRAME_SCH, pages)).toBeNull();
    expect(CreateKiWindow(FRAME_T.PANEL_DS_GRIDS, pages)).toBeNull();
    expect(CreateKiWindow(FRAME_T.PANEL_SCH_SIMULATOR, {})).toBeNull();
  });
});

describe('CopySexprFile', () => {
  it('rewrites a string or symbol value the callback accepts, and prettifies', () => {
    const errors = { value: '' };
    const out = CopySexprFile(
      '(kicad_sch (version 1) (project "old" (path "/x")) (keep old))',
      '/d/a.kicad_sch',
      (token, value) => {
        if ((token === 'project' || token === 'keep') && value.value === 'old') {
          value.value = 'new';
          return token === 'project';
        }
        return false;
      },
      errors,
    );
    expect(out).toContain('(project "new"');
    // A callback answering false leaves the value as it was.
    expect(out).toContain('(keep old)');
    expect(errors.value).toBe('');
  });

  it('rewrites a symbol (unquoted) value too', () => {
    const out = CopySexprFile(
      '(a (b old))',
      '/d/a',
      (token, value) => {
        value.value = 'new';
        return token === 'b';
      },
      { value: '' },
    );
    expect(out).toContain('(b new)');
  });

  it('reports a file it cannot parse', () => {
    const errors = { value: 'earlier' };
    expect(CopySexprFile('(unclosed', '/d/x.kicad_sch', () => false, errors)).toBeNull();
    expect(errors.value).toBe("earlier\nCannot copy file '/d/x.kicad_sch'.");
  });
});

describe('IFACE::SaveFileAs', () => {
  const save = (src: string, text = '(x)', errors = { value: '' }) =>
    SaveFileAs('/p/old', 'old', '/p/new', 'new', src, text, errors);

  it('a schematic named after the project follows it, with its (project) rewritten', () => {
    const r = save('/p/old/old.kicad_sch', '(kicad_sch (project "old"))');
    expect(r?.path).toBe('/p/new/new.kicad_sch');
    expect(r?.text).toContain('(project "new")');
  });

  it('only a (project) naming the old project is renamed', () => {
    expect(save('/p/old/old.kicad_sch', '(kicad_sch (project "other"))')?.text).toContain(
      '(project "other")',
    );
  });

  it('a sub-sheet keeps its name; a backup counts as a schematic', () => {
    expect(save('/p/old/sub/amp.kicad_sch')?.path).toBe('/p/new/sub/amp.kicad_sch');
    expect(save('/p/old/old.kicad_sch-bak')?.path).toBe('/p/new/new.kicad_sch-bak');
  });

  it('refuses a sheet already named after the new project', () => {
    const errors = { value: '' };
    expect(save('/p/old/new.kicad_sch', '(kicad_sch)', errors)).toBeNull();
    expect(errors.value).toBe(
      "Cannot copy file '/p/new/new.kicad_sch' as it will be overwritten by the new root sheet file.",
    );
  });

  it('symbol files: .sym keeps its name, cache and rescue libraries follow the project', () => {
    expect(save('/p/old/old.sym')).toEqual({ path: '/p/new/old.sym', text: null });
    expect(save('/p/old/old-cache.lib')?.path).toBe('/p/new/new-cache.lib');
    expect(save('/p/old/old-rescue.kicad_sym')?.path).toBe('/p/new/new-rescue.kicad_sym');
    expect(save('/p/old/mine.kicad_sym')?.path).toBe('/p/new/mine.kicad_sym');
  });

  it('a netlist follows the project and its (source) paths are rewritten', () => {
    const r = save('/p/old/old.net', '(export (design (source "/p/old/old.kicad_sch")))');
    expect(r?.path).toBe('/p/new/new.net');
    // The `.sch` pass runs first and its third arm — the path merely starts
    // with the old base — fires before the `.kicad_sch` pass can match the
    // whole name, so upstream moves the directory and keeps the file name.
    expect(r?.text).toContain('(source "/p/new/old.kicad_sch")');
    expect(save('/p/old/old.net', '(export (design (source "old.sch")))')?.text).toContain(
      '(source "new.sch")',
    );
  });

  it('the sym-lib-table renames the project libraries in its URIs', () => {
    const table =
      '(sym_lib_table (version 7) (lib (name "c")(type "KiCad")(uri "${KIPRJMOD}/old-cache.lib")(options "")(descr "")))';
    const r = save('/p/old/sym-lib-table', table);
    expect(r?.path).toBe('/p/new/sym-lib-table');
    expect(r?.text).toContain('${KIPRJMOD}/new-cache.lib');
  });

  it('any other file type is not copied', () => {
    expect(save('/p/old/old.kicad_pcb')).toBeNull();
  });
});
