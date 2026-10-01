// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PANEL_FP_PROPERTIES_3D_MODEL (panel_fp_properties_3d_model.cpp): the model
 * list, its per-row validation, add / remove and the selection it keeps.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';
import {
  MODEL_VALIDATE_ERRORS,
  MODELS_TABLE_COLUMNS,
  PANEL_FP_PROPERTIES_3D_MODEL,
  type PANEL_3D_MODEL_HOST,
} from '@ziroeda/pcbnew/dialogs/panel_fp_properties_3d_model.js';

const model = (name: string, show = true): FP_3DMODEL => {
  const m = new FP_3DMODEL();
  m.m_Filename = name;
  m.m_Show = show;
  return m;
};

let existing: Set<string>;
let embedded: string[];
let modified: number;
let fp: FOOTPRINT;
let host: PANEL_3D_MODEL_HOST;
let panel: PANEL_FP_PROPERTIES_3D_MODEL;

beforeEach(() => {
  existing = new Set(['/models/R.wrl', '/models/C.step']);
  embedded = [];
  modified = 0;
  const resolver = new FILENAME_RESOLVER();
  // The mount table of a real page is not under test: a name resolves when it is in `existing`.
  vi.spyOn(resolver, 'ResolvePath').mockImplementation((name) =>
    existing.has(name) || name.startsWith('/missing') ? name : '',
  );
  host = {
    resolver: () => resolver,
    footprintBasePath: () => '',
    embeddedFilesStack: () => [],
    addEmbeddedFile: (p) => (p === '' ? null : `kicad-embed://${p.split('/').pop()}`),
    removeEmbeddedFile: (n) => embedded.push(n),
    isFileReadable: (p) => existing.has(p),
    onModify: () => modified++,
  };
  fp = new FOOTPRINT(new BOARD());
  fp.Models().push(model('/models/R.wrl'), model('/models/C.step', false), model('/missing/x.wrl'));
  panel = new PANEL_FP_PROPERTIES_3D_MODEL(fp, host);
  panel.TransferDataToWindow();
});

describe('PANEL_FP_PROPERTIES_3D_MODEL rows', () => {
  it('one row per model, with its file name and Show as "1" / "0"', () => {
    expect(panel.m_rows.map((r) => [r.filename, r.shown])).toEqual([
      ['/models/R.wrl', '1'],
      ['/models/C.step', '0'],
      ['/missing/x.wrl', '1'],
    ]);
  });

  it('works on a copy: the footprint keeps its models until the dialog transfers them', () => {
    panel.On3DModelCellChanged(0, MODELS_TABLE_COLUMNS.COL_SHOWN, '0');
    expect(panel.GetModelList()[0]!.m_Show).toBe(false);
    expect(fp.Models()[0]!.m_Show).toBe(true);
  });

  it('opens with the first row selected', () => {
    expect(panel.m_selected).toBe(0);
  });
});

describe('the status icon and its text', () => {
  it('no icon when the file resolves and opens', () => {
    expect(panel.m_rows[0]).toMatchObject({ icon: 0, problem: '' });
  });

  it('"File not found" (error) when the path does not resolve', () => {
    panel.m_rows[0]!.filename = '/nowhere/a.wrl';
    panel.updateValidateStatus(0);
    expect(panel.m_rows[0]).toMatchObject({ icon: 'error', problem: 'File not found' });
  });

  it('"Unable to open file" (error) when it resolves and cannot be read', () => {
    expect(panel.m_rows[2]).toMatchObject({ icon: 'error', problem: 'Unable to open file' });
  });

  it('"No filename entered" is a WARNING, not an error', () => {
    panel.m_rows[0]!.filename = '';
    panel.updateValidateStatus(0);
    expect(panel.m_rows[0]).toMatchObject({ icon: 'warning', problem: 'No filename entered' });
  });

  it('"Illegal filename" (error) for a name the resolver refuses', () => {
    expect(panel.validateModelExists('a:')).toBe(MODEL_VALIDATE_ERRORS.ILLEGAL_FILENAME);
    panel.on3DModelCellChanging(0, MODELS_TABLE_COLUMNS.COL_FILENAME, 'a:');
    expect(panel.m_rows[0]).toMatchObject({ icon: 'error', problem: 'Illegal filename' });
  });

  it('while a cell is being edited the status follows the editor, not the stored text', () => {
    panel.on3DModelCellChanging(0, MODELS_TABLE_COLUMNS.COL_FILENAME, '/models/C.step');
    expect(panel.m_rows[0]!.icon).toBe(0);
    panel.on3DModelCellChanging(0, MODELS_TABLE_COLUMNS.COL_FILENAME, '');
    expect(panel.m_rows[0]!.icon).toBe('warning');
    // and another column never asks
    panel.on3DModelCellChanging(0, MODELS_TABLE_COLUMNS.COL_SHOWN, '');
    expect(panel.m_rows[0]!.icon).toBe('warning');
  });
});

describe('editing', () => {
  it('a file name is stored on the model, control characters removed, and the row re-validated', () => {
    panel.On3DModelCellChanged(0, MODELS_TABLE_COLUMNS.COL_FILENAME, '/models/C.step\n\t');
    expect(panel.GetModelList()[0]!.m_Filename).toBe('/models/C.step');
    expect(panel.m_rows[0]).toMatchObject({ filename: '/models/C.step', icon: 0 });
    expect(modified).toBe(1);
  });

  it('an alias gets the ":" KiCad writes in front of it', () => {
    expect(panel.cleanupFilename('MYLIB:part.wrl')).toBe(':MYLIB:part.wrl');
    expect(panel.cleanupFilename('/models/R.wrl')).toBe('/models/R.wrl');
  });

  it("the Show cell is the model's m_Show", () => {
    panel.On3DModelCellChanged(1, MODELS_TABLE_COLUMNS.COL_SHOWN, '1');
    expect(panel.GetModelList()[1]!.m_Show).toBe(true);
    expect(panel.m_rows[1]!.shown).toBe('1');
  });
});

describe('add', () => {
  it('Add row appends an empty, shown model, selects it and edits its file name cell', () => {
    const at = panel.OnAdd3DRow();
    expect(at).toEqual([3, MODELS_TABLE_COLUMNS.COL_FILENAME]);
    expect(panel.GetModelList()[3]).toMatchObject({ m_Filename: '', m_Show: true });
    expect(panel.m_selected).toBe(3);
    expect(panel.m_rows[3]).toMatchObject({ icon: 'warning' });
    expect(modified).toBe(1);
  });

  it('Browse: a chosen file becomes a shown row, selected and validated', () => {
    expect(panel.OnAdd3DModel({ filename: '/models/R.wrl', embedded: false }, 0)).toEqual({
      ok: true,
    });
    expect(panel.m_rows.at(-1)).toMatchObject({ filename: '/models/R.wrl', shown: '1', icon: 0 });
    expect(panel.m_selected).toBe(3);
  });

  it('Browse, cancelled: nothing is added and the previous row is selected again', () => {
    panel.select3DModel(2);
    expect(panel.OnAdd3DModel(null, 1)).toEqual({ ok: true });
    expect(panel.m_rows).toHaveLength(3);
    expect(panel.m_selected).toBe(1);
  });

  it('Browse with Embed stores the embedded link, and fails as "Error adding 3D model"', () => {
    expect(panel.OnAdd3DModel({ filename: '/models/R.wrl', embedded: true }, 0).ok).toBe(true);
    expect(panel.GetModelList().at(-1)!.m_Filename).toBe('kicad-embed://R.wrl');

    const n = panel.m_rows.length;
    host.addEmbeddedFile = () => null;
    expect(panel.OnAdd3DModel({ filename: '/nowhere.wrl', embedded: true }, 0)).toEqual({
      ok: false,
      error: 'Error adding 3D model',
    });
    expect(panel.m_rows).toHaveLength(n);
  });
});

describe('remove', () => {
  it('deletes the selected rows, un-embedding each, and selects the row that took their place', () => {
    expect(panel.OnRemove3DModel([1])).toBe(true);
    expect(panel.m_rows.map((r) => r.filename)).toEqual(['/models/R.wrl', '/missing/x.wrl']);
    expect(embedded).toEqual(['/models/C.step']);
    expect(panel.m_selected).toBe(1);
  });

  it('several rows go highest first, each once', () => {
    panel.OnRemove3DModel([0, 2, 2]);
    expect(panel.m_rows.map((r) => r.filename)).toEqual(['/models/C.step']);
    expect(embedded).toEqual(['/missing/x.wrl', '/models/R.wrl']);
    expect(panel.m_selected).toBe(0);
  });

  it('with no selection it removes the cursor row', () => {
    panel.select3DModel(2);
    panel.OnRemove3DModel([]);
    expect(panel.m_rows).toHaveLength(2);
  });

  it('removing the last row leaves nothing selected; an empty list is a no-op', () => {
    panel.OnRemove3DModel([0, 1, 2]);
    expect(panel.m_rows).toEqual([]);
    expect(panel.m_selected).toBe(-1);
    expect(panel.OnRemove3DModel([0])).toBe(false);
  });
});

describe('selection', () => {
  it('select3DModel clamps into the list', () => {
    expect(panel.select3DModel(99)).toBe(2);
    expect(panel.m_selected).toBe(2);
    expect(panel.select3DModel(-5)).toBe(0);
    expect(panel.m_selected).toBe(0);
  });

  it('a selection made while select3DModel is running does not re-enter it', () => {
    panel.m_inSelect = true;
    panel.On3DModelSelected(2);
    expect(panel.m_selected).toBe(0);
    panel.m_inSelect = false;
    panel.On3DModelSelected(2);
    expect(panel.m_selected).toBe(2);
  });
});
