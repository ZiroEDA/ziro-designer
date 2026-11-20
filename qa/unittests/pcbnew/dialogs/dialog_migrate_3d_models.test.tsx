// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tools > Migrate 3D Models... and its load-time half: DIALOG_MIGRATE_3D_MODELS and
 * MODEL_SUBSTITUTION (dialog_migrate_3d_models.cpp, model_substitution_helpers.cpp).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IsWrlExtension,
  NormalizeStem,
  ParentDirName,
} from '@ziroeda/3d-viewer/3d_cache/model_substitution_helpers.js';
import { mountHostedLibrary, SetHosted3DCatalog } from '@ziroeda/3d-viewer/component3d.js';
import { PATHS } from '@ziroeda/common/paths.js';
import { PICKED_ITEMS_LIST } from '@ziroeda/common/undo_redo_container.js';
import { SetUsageListener } from '@ziroeda/common/usage_hooks.js';
import { wxFileExists } from '@ziroeda/wx/filefn.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_MIGRATE_3D_MODELS,
  DialogMigrate3DModels,
  MigrateWrlModelsOnLoad,
} from '@ziroeda/pcbnew/dialogs/dialog_migrate_3d_models.js';
import { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';
import { buildPcbMenus } from '@ziroeda/pcbnew/menubar_pcb_editor.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

beforeAll(() => {
  installPgm();
});

// Resistor_Other first, so preferring the reference's own folder is what picks Resistor_SMD.
const CATALOG = {
  'Resistor_Other.3dshapes': ['R_0603_1608Metric.step'],
  'Resistor_SMD.3dshapes': ['R_0603_1608Metric.step'],
  'Capacitor_SMD.3dshapes': ['C_0805_2012Metric.step'],
};

beforeEach(() => SetHosted3DCatalog(CATALOG));
afterEach(() => {
  cleanup();
  SetHosted3DCatalog(null);
});

const R_WRL = '${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.wrl';
// No STEP model has this stem; one edit away from C_0805_2012Metric.
const C_WRL = '${KICAD9_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0805_2012Metrc.wrl';

function frame(aModels: string[]) {
  const settings = new PCBNEW_SETTINGS();
  const f = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    updateProperties: () => {},
    projectFileNames: () => [],
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  const board = new BOARD();
  for (const name of aModels) {
    const fp = new FOOTPRINT(board);
    const m = new FP_3DMODEL();
    m.m_Filename = name;
    m.m_Offset = { x: 1, y: 2, z: 3 };
    fp.Models().push(m);
    board.Add(fp);
  }
  f.SetBoard(board);
  return { f, board };
}

/** The board's model names, sorted: a commit may reorder the footprints. */
const filenames = (aBoard: BOARD): string[] =>
  aBoard
    .Footprints()
    .flatMap((fp) => fp.Models().map((m) => m.m_Filename))
    .sort();

describe('MODEL_SUBSTITUTION', () => {
  it('reads a .wrl or .wrz name, whatever its case', () => {
    expect(IsWrlExtension('a/B.WRL')).toBe(true);
    expect(IsWrlExtension('b.wrz')).toBe(true);
    expect(IsWrlExtension('c.step')).toBe(false);
  });

  it('normalises a stem: no model extension, lower case, - and space as _', () => {
    expect(NormalizeStem('R-0603 1608Metric.WRL')).toBe('r_0603_1608metric');
    expect(NormalizeStem('x.step.gz')).toBe('x');
  });

  it('names the folder a model sits in', () => {
    expect(ParentDirName('${V}/Resistor_SMD.3dshapes/R.wrl')).toBe('Resistor_SMD.3dshapes');
  });
});

describe('the hosted library, listed by its catalogue', () => {
  it('holds the catalogue STEP files and never a .wrl', () => {
    mountHostedLibrary();
    const stock = PATHS.GetStock3dmodelsPath();
    expect(wxFileExists(`${stock}/Resistor_SMD.3dshapes/R_0603_1608Metric.step`)).toBe(true);
    expect(wxFileExists(`${stock}/Resistor_SMD.3dshapes/R_0603_1608Metric.wrl`)).toBe(false);
    expect(wxFileExists(`${stock}/Resistor_SMD.3dshapes/R_9999.step`)).toBe(false);
  });

  it('before the catalogue loads, takes any STEP name to exist but still never a .wrl', () => {
    SetHosted3DCatalog(null);
    mountHostedLibrary();
    const stock = PATHS.GetStock3dmodelsPath();
    expect(wxFileExists(`${stock}/Resistor_SMD.3dshapes/R_9999.step`)).toBe(true);
    expect(wxFileExists(`${stock}/Resistor_SMD.3dshapes/R_0603_1608Metric.wrl`)).toBe(false);
  });
});

describe('AutoMigrateByFilename', () => {
  it('rewrites a .wrl whose stem has a STEP model, preferring the same folder, in one undo step', () => {
    const { f, board } = frame([R_WRL, C_WRL]);
    expect(DIALOG_MIGRATE_3D_MODELS.CountUnresolvedWrlReferences(f)).toBe(2);
    expect(DIALOG_MIGRATE_3D_MODELS.AutoMigrateByFilename(f)).toBe(1);
    expect(filenames(board)).toEqual(
      ['${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step', C_WRL].sort(),
    );
    expect(f.GetUndoCommandCount()).toBe(1);
    expect(DIALOG_MIGRATE_3D_MODELS.CountUnresolvedWrlReferences(f)).toBe(1);
  });

  it("is not reported as the person's edit to the usage counts, though it stays undoable", () => {
    const heard: string[] = [];
    SetUsageListener((e) => heard.push(e));
    try {
      const { f } = frame([R_WRL]);
      expect(DIALOG_MIGRATE_3D_MODELS.AutoMigrateByFilename(f)).toBe(1);
      expect(f.GetUndoCommandCount()).toBe(1);
      expect(heard).toEqual([]);
      // ...while an edit the person makes afterwards is heard as usual
      f.PushCommandToUndoList(new PICKED_ITEMS_LIST());
      expect(heard).toEqual(['edit']);
    } finally {
      SetUsageListener(null);
    }
  });

  it('leaves a board with nothing to match alone', () => {
    const { f } = frame([C_WRL]);
    expect(DIALOG_MIGRATE_3D_MODELS.AutoMigrateByFilename(f)).toBe(0);
    expect(f.GetUndoCommandCount()).toBe(0);
  });
});

describe('on load (PCB_EDIT_FRAME::OnBoardLoaded)', () => {
  it('migrates what the name settles, then counts the rest in the infobar with Show options', async () => {
    const { f, board } = frame([R_WRL, C_WRL]);
    const shown: { msg: string; link: string[] }[] = [];
    let links: { label: string; onClick(): void }[] = [];
    f.SetInfoBar({
      IsLocked: () => false,
      AddButton: (b) => links.push(b),
      RemoveAllButtons: () => {
        links = [];
      },
      ShowMessage: () => {},
      ShowMessageFor: (msg) => shown.push({ msg, link: links.map((l) => l.label) }),
      Dismiss: () => {},
    });
    await MigrateWrlModelsOnLoad(f);
    expect(filenames(board)).toContain(
      '${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step',
    );
    expect(shown).toEqual([
      {
        msg: '1 WRL 3D model could not be matched to an equivalent STEP model.',
        link: ['Show options'],
      },
    ]);
  });

  it('says nothing when every reference was migrated', async () => {
    const { f } = frame([R_WRL]);
    const shown: string[] = [];
    f.SetInfoBar({
      IsLocked: () => false,
      AddButton: () => {},
      RemoveAllButtons: () => {},
      ShowMessage: () => {},
      ShowMessageFor: (msg) => shown.push(msg),
      Dismiss: () => {},
    });
    await MigrateWrlModelsOnLoad(f);
    expect(shown).toEqual([]);
  });
});

describe('DIALOG_MIGRATE_3D_MODELS', () => {
  it('ranks a near name under the exact ones, ends with keep-existing, and preselects the best', () => {
    const { f } = frame([C_WRL, R_WRL]);
    const dlg = new DIALOG_MIGRATE_3D_MODELS(f);
    // std::map order.
    expect(dlg.m_missing).toEqual([C_WRL, R_WRL].sort());
    const r = dlg.m_missing.indexOf(R_WRL);
    expect(dlg.m_candidatesPerMissing[r]!.map((c) => [c.m_display, c.m_score])).toEqual([
      ['R_0603_1608Metric.step   —   Resistor_SMD.3dshapes', 1000],
      ['R_0603_1608Metric.step   —   Resistor_Other.3dshapes', 800],
      ['(keep existing reference)', 0],
    ]);
    const c = dlg.m_missing.indexOf(C_WRL);
    expect(dlg.m_candidatesPerMissing[c]![0]!.m_score).toBe(490);
    expect(dlg.m_selectedPerMissing).toEqual([0, 0]);
  });

  it('Replace Models writes each chosen file with the model transform kept; keep-existing writes nothing', () => {
    const { f, board } = frame([R_WRL, C_WRL]);
    const dlg = new DIALOG_MIGRATE_3D_MODELS(f);
    dlg.OnCandidateSelected(dlg.m_missing.indexOf(C_WRL), 1); // (keep existing reference)
    expect(dlg.OnReplaceClick()).toBe(true);
    expect(filenames(board)).toEqual(
      ['${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step', C_WRL].sort(),
    );
    for (const fp of board.Footprints())
      expect(fp.Models()[0]!.m_Offset).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('Replace Models with every row kept is wxID_CANCEL', () => {
    const { f, board } = frame([C_WRL]);
    const dlg = new DIALOG_MIGRATE_3D_MODELS(f);
    dlg.OnCandidateSelected(0, 1);
    expect(dlg.OnReplaceClick()).toBe(false);
    expect(filenames(board)).toEqual([C_WRL]);
  });

  it('draws a row bold while it has no replacement, and choosing one unbolds it', () => {
    const { f } = frame([C_WRL]);
    let closed: boolean | null = null;
    render(
      <DialogMigrate3DModels frame={f} Preview={() => null} onClose={(ok) => (closed = ok)} />,
    );
    const missing = screen.getByRole('list', { name: 'Missing 3D model references' });
    expect(missing.querySelector('.bold')).toBeNull();
    fireEvent.click(screen.getByText('(keep existing reference)'));
    expect(missing.querySelector('.bold')?.textContent).toBe(C_WRL);
    fireEvent.click(screen.getByRole('button', { name: 'Keep Existing' }));
    expect(closed).toBe(false);
  });
});

describe('Tools > Migrate 3D Models...', () => {
  it('is a live row that runs the migrate3DModels action', () => {
    const acts: string[] = [];
    const menus = buildPcbMenus(
      {
        action: (id) => acts.push(id),
        tool: () => {},
        toggle: () => {},
        language: 'Default',
        onSelectLanguage: () => {},
        showHotkeys: () => {},
        showAbout: () => {},
      },
      { hasSchematic: true } as never,
    );
    const row = menus.flatMap((m) => m.items).find((i) => i.label === 'Migrate 3D Models...');
    expect(row?.disabled).toBeFalsy();
    row!.action!();
    expect(acts).toEqual(['migrate3DModels']);
  });
});
