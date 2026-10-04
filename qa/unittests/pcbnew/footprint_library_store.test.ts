// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT_LIBRARY_STORE, the browser's FOOTPRINT_LIBRARY_ADAPTER
 * (`pcbnew/footprint_library_adapter.cpp`): footprints read with FootprintLoad
 * and written with FootprintSave, hosted libraries read only, and the
 * plugin's IO_ERRORs swallowed the way the adapter swallows them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { BOARD, BOARD_USE } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT_LIBRARY_STORE, SAVE_T } from '@ziroeda/pcbnew/footprint_library_adapter.js';

const U = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const FP_TEXT = (aName: string, aLayer = 'F.Cu', aAngle = 0): string => `(footprint "${aName}"
  (layer "${aLayer}") (uuid "${U(10)}") (at 0 0 ${aAngle})
  (property "Reference" "R1" (at 0 0 0) (layer "${aLayer === 'F.Cu' ? 'F.SilkS' : 'B.SilkS'}") (uuid "${U(11)}"))
  (property "Value" "R" (at 0 1 0) (layer "${aLayer === 'F.Cu' ? 'F.Fab' : 'B.Fab'}") (uuid "${U(12)}"))
  (pad "1" smd rect (at 1 0) (size 1 1) (layers "${aLayer}") (uuid "${U(13)}")))`;

let written: [string, string, string][];
let removed: [string, string][];
let fetched: string[];
let store: FOOTPRINT_LIBRARY_STORE;

beforeEach(() => {
  written = [];
  removed = [];
  fetched = [];
  store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: (aNick, aName) => {
      fetched.push(`${aNick}:${aName}`);
      return Promise.resolve(FP_TEXT(aName));
    },
    flipLeftRight: () => false,
    writeFootprintFile: (aDir, aFile, aText) => written.push([aDir, aFile, aText]),
    removeFootprintFile: (aDir, aFile) => removed.push([aDir, aFile]),
  });
  store.AddProjectLibrary('Proj', 'Proj.pretty', [
    { fileName: 'Proj.pretty/R_0603.kicad_mod', text: FP_TEXT('R_0603') },
  ]);
  store.AddGlobalLibrary('Resistor_SMD', ['R_0402', 'R_0805']);
});

describe('reading', () => {
  it("a project footprint loads under the row's nickname, named by its file", () => {
    expect(store.GetFootprintNames('Proj')).toEqual(['R_0603']);

    const fp = store.LoadFootprint('Proj', 'R_0603', true)!;
    expect(fp.GetFPID().Format()).toBe('Proj:R_0603');
    expect(fp.GetParent()).toBeNull();
  });

  it('keeping UUIDs keeps them; not keeping them is a Duplicate with fresh ones', () => {
    const kept = store.LoadFootprint('Proj', 'R_0603', true)!;
    const fresh = store.LoadFootprint('Proj', 'R_0603', false)!;

    expect(kept.m_Uuid).toBe(U(10));
    expect(fresh.m_Uuid).not.toBe(U(10));
    expect(fresh.Pads()[0]!.m_Uuid).not.toBe(U(13));
  });

  it('a hosted footprint is fetched once, on its first load', async () => {
    expect(store.LoadFootprint('Resistor_SMD', 'R_0402', true)).toBeNull();

    const fp = await store.LoadFootprintAsync('Resistor_SMD', 'R_0402', true);
    expect(fp!.GetFPID().Format()).toBe('Resistor_SMD:R_0402');

    await store.LoadFootprintAsync('Resistor_SMD', 'R_0402', true);
    expect(fetched).toEqual(['Resistor_SMD:R_0402']);
    expect(store.LoadFootprint('Resistor_SMD', 'R_0402', true)).not.toBeNull();
  });

  it('a name the library does not hold is null, and is not fetched', async () => {
    expect(await store.LoadFootprintAsync('Resistor_SMD', 'R_9999', true)).toBeNull();
    expect(fetched).toEqual([]);
    expect(store.FootprintExists('Resistor_SMD', 'R_0805')).toBe(true);
    expect(store.FootprintExists('Resistor_SMD', 'R_9999')).toBe(false);
  });
});

describe('writing', () => {
  it('saves a clone at orientation zero on the front, as <item name>.kicad_mod', () => {
    store.AddProjectLibrary('Back', 'Back.pretty', [
      { fileName: 'B.kicad_mod', text: FP_TEXT('B', 'B.Cu', 90) },
    ]);
    const fp = store.LoadFootprint('Back', 'B', true)!;
    // The footprint editor's footprint lives on its holder board, which Flip asks.
    const holder = new BOARD();
    holder.SetBoardUse(BOARD_USE.FPHOLDER);
    holder.Add(fp);

    expect(store.SaveFootprint('Proj', fp)).toBe(SAVE_T.SAVE_OK);
    expect(written.map(([d, f]) => [d, f])).toEqual([['Proj.pretty', 'B.kicad_mod']]);

    const saved = store.LoadFootprint('Proj', 'B', true)!;
    expect(saved.GetLayerName()).toBe('F.Cu');
    expect(saved.GetOrientation().AsDegrees()).toBe(0);
    // The footprint being edited is not touched: FootprintSave writes a clone.
    expect(fp.GetLayerName()).toBe('B.Cu');
    expect(store.GetFootprintNames('Proj')).toEqual(['R_0603', 'B']);
  });

  it('a hosted library is read only: SAVE_SKIPPED and nothing written', () => {
    const fp = store.LoadFootprint('Proj', 'R_0603', true)!;
    fp.SetFPID(new LIB_ID('', 'R_0402'));

    expect(store.IsFootprintLibWritable('Resistor_SMD')).toBe(false);
    expect(store.IsFootprintLibWritable('Proj')).toBe(true);
    expect(store.SaveFootprint('Resistor_SMD', fp)).toBe(SAVE_T.SAVE_SKIPPED);
    expect(written).toEqual([]);
  });

  it('without overwrite an existing name is skipped', () => {
    const fp = store.LoadFootprint('Proj', 'R_0603', true)!;

    expect(store.SaveFootprint('Proj', fp, false)).toBe(SAVE_T.SAVE_SKIPPED);
    expect(store.SaveFootprint('Proj', fp, true)).toBe(SAVE_T.SAVE_OK);
  });

  it('deletes the file; a missing or read-only one is silently left', () => {
    store.DeleteFootprint('Proj', 'R_0603');
    expect(store.GetFootprintNames('Proj')).toEqual([]);
    expect(store.LoadFootprint('Proj', 'R_0603', true)).toBeNull();
    expect(removed).toEqual([['Proj.pretty', 'R_0603.kicad_mod']]);

    store.DeleteFootprint('Proj', 'R_0603');
    store.DeleteFootprint('Resistor_SMD', 'R_0402');
    expect(removed).toHaveLength(1);
    expect(store.GetFootprintNames('Resistor_SMD')).toEqual(['R_0402', 'R_0805']);
  });
});

describe('the rows', () => {
  it('pinned libraries list first, then by name', () => {
    store.CreateLibrary('Aaa');
    expect(store.GetLibraryNames()).toEqual(['Aaa', 'Proj', 'Resistor_SMD']);

    store.SetPinned('Resistor_SMD', true);
    expect(store.GetLibraryNames()).toEqual(['Resistor_SMD', 'Aaa', 'Proj']);
  });

  it("a project change drops the project's rows and keeps the hosted ones", () => {
    store.DropProjectLibraries();
    expect(store.GetLibraryNames()).toEqual(['Resistor_SMD']);
    expect(store.HasLibrary('Proj')).toBe(false);
  });
});
