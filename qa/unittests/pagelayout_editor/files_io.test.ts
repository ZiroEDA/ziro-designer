// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PL_EDITOR_FRAME::Files_io` and `OnFileHistory` (pagelayout_editor/files.cpp),
 * run through the frame's tool actions against the recording host. The
 * sentences are `ds_file_commands.test.ts`' transcriptions of a driven
 * pl_editor; what is pinned here is WHERE each one appears:
 *
 *   Open (:159-181)       status `File '%s' saved.`; history row (the loader,
 *                         :261); a failed load raises TWO modals (:253-256,
 *                         :173-174) and leaves the status line alone.
 *   Append (:130-156)     `File '%s' inserted`; SetContentModified WITHOUT
 *                         OnModify, so the title is not starred; no history.
 *   Save (:186-196)       no name is Save As (:105); a write adds NO history.
 *   Save As (:198-235)    "Save Drawing Sheet As" in the templates dir; the
 *                         extension appended when the leaf lacks it.
 *   New (:123-128)        guarded by HandleUnsavedChanges (:108-118); an empty
 *                         list, no name, and NO status text.
 *   OnFileHistory (:55-86) `File '%s' loaded`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  DS_APPEND_DIALOG_TITLE,
  DS_OPEN_DIALOG_TITLE,
  DS_SAVE_AS_DIALOG_TITLE,
  DS_SAVE_CHANGES_QUESTION,
} from '@ziroeda/pagelayout_editor/files.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { type Harness, makeHarness, settle } from './pl_editor_fixture.js';

let model: DS_DATA_MODEL;

beforeEach(() => {
  SetPgm(new PGM_BASE());
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

const PATH = '/Templates/probe.kicad_wks';

/** A sheet of one line, as the current writer writes it. */
function oneLineSheet(): string {
  const m = new DS_DATA_MODEL();
  m.SetPageLayout(
    '(kicad_wks (version 20231118) (generator "pl_editor") (setup (textsize 1.5 1.5)' +
      ' (linewidth 0.15) (textlinewidth 0.15) (left_margin 10) (right_margin 10)' +
      ' (top_margin 10) (bottom_margin 10)) (line (name "") (start 10 10) (end 50 10)))',
  );
  return m.SaveInString();
}

async function run(h: Harness, aAction: { MakeEvent(): unknown }): Promise<void> {
  h.mgr.RunAction(aAction as never);
  await settle();
}

describe('Open', () => {
  it('loads the chosen file, reports it, and adds a history row', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.host.files.set(PATH, oneLineSheet());
    h.host.openAnswers.push(PATH);

    await run(h, ACTIONS.open);

    expect(h.host.dialogs).toEqual([DS_OPEN_DIALOG_TITLE]);
    expect(model.GetCount()).toBe(1);
    expect(h.status[0]).toBe(`File '${PATH}' saved.`);
    expect(h.host.history).toEqual([PATH]);
    expect(h.frame.GetCurrentFileName()).toBe(PATH);
    expect(h.frame.GetTitle()).toBe('probe — Drawing Sheet Editor');
    expect(h.frame.IsContentModified()).toBe(false);
  });

  it('a bad file raises two modals, in order, and leaves the status line', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.frame.SetStatusText('before');
    h.host.files.set(PATH, '(kicad_wks (version 20231118) (line (start');
    h.host.openAnswers.push(PATH);

    await run(h, ACTIONS.open);

    expect(h.host.errors.map((e) => e.text)).toEqual([
      `Error loading drawing sheet '${PATH}'.`,
      `Unable to load ${PATH} file`,
    ]);
    expect(h.host.errors[0]!.extra).not.toBe('');
    expect(h.status[0]).toBe('before');
    expect(h.host.history).toEqual([]);
  });

  it('an older file raises the outdated-format infobar; a save dismisses it', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.host.files.set(PATH, oneLineSheet().replace('20231118', '20210606'));
    h.host.openAnswers.push(PATH);

    await run(h, ACTIONS.open);
    expect(h.host.outdatedInfoBar).toBe(true);

    await run(h, ACTIONS.save);
    expect(h.host.outdatedInfoBar).toBe(false);
  });

  it('Cancel changes nothing', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const before = model.GetCount();

    await run(h, ACTIONS.open);

    expect(model.GetCount()).toBe(before);
    expect(h.status[0] ?? '').toBe('');
  });
});

describe('Append', () => {
  it('inserts, marks the sheet modified WITHOUT retitling, adds no history', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const before = model.GetCount();
    h.host.files.set(PATH, oneLineSheet());
    h.host.openAnswers.push(PATH);

    await run(h, PL_ACTIONS.appendImportedDrawingSheet);

    expect(h.host.dialogs).toEqual([DS_APPEND_DIALOG_TITLE]);
    expect(model.GetCount()).toBe(before + 1);
    expect(h.status[0]).toBe(`File '${PATH}' inserted`);
    expect(h.frame.IsContentModified()).toBe(true);
    expect(h.frame.GetTitle().startsWith('*')).toBe(false);
    expect(h.host.history).toEqual([]);
    // InsertDrawingSheetFile pushes an undo copy first (files.cpp:296).
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });
});

describe('Save and Save As', () => {
  it('Save with no name is Save As: the templates dir, the extension appended', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    let dir = '';
    h.host.SaveFileDialog = (aTitle, aDir) => {
      h.host.dialogs.push(aTitle);
      dir = aDir;
      return Promise.resolve('/Templates/frame');
    };

    await run(h, ACTIONS.save);

    expect(h.host.dialogs).toEqual([DS_SAVE_AS_DIALOG_TITLE]);
    expect(dir).toBe('/Templates');
    expect(h.host.written).toEqual(['/Templates/frame.kicad_wks']);
    expect(h.status[0]).toBe("File '/Templates/frame.kicad_wks' saved.");
    expect(h.frame.GetTitle()).toBe('frame — Drawing Sheet Editor');
    // SaveDrawingSheetFile never calls UpdateFileHistory (files.cpp:305-338).
    expect(h.host.history).toEqual([]);
  });

  it('keeps an extension that is already there', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.host.saveAsAnswers.push('/Templates/a.b.kicad_wks');

    await run(h, ACTIONS.saveAs);

    expect(h.host.written).toEqual(['/Templates/a.b.kicad_wks']);
  });

  it('Save with a name writes in place, with no dialog', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.frame.SetCurrentFileName(PATH);

    await run(h, ACTIONS.save);

    expect(h.host.dialogs).toEqual([]);
    expect(h.host.written).toEqual([PATH]);
    expect(h.host.files.get(PATH)).toContain('(kicad_wks');
    expect(h.status[0]).toBe(`File '${PATH}' saved.`);
  });
});

describe('New', () => {
  it('asks first when modified; Cancel keeps the sheet', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const before = model.GetCount();
    h.frame.OnModify();
    h.host.unsavedAnswers.push('cancel');

    await run(h, ACTIONS.doNew);

    expect(h.host.unsavedQuestions).toEqual([DS_SAVE_CHANGES_QUESTION]);
    expect(model.GetCount()).toBe(before);
  });

  it('Discard: an empty list, no name, and no status text', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.frame.SetCurrentFileName(PATH);
    h.frame.SetStatusText('kept');
    h.frame.OnModify();
    h.host.unsavedAnswers.push('discard');

    await run(h, ACTIONS.doNew);

    expect(model.GetCount()).toBe(0);
    expect(h.frame.GetCurrentFileName()).toBe('');
    expect(h.frame.GetTitle()).toBe('[no drawing sheet loaded] — Drawing Sheet Editor');
    expect(h.status[0]).toBe('kept');
  });

  it('Save in the guard saves first, then proceeds', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.frame.SetCurrentFileName(PATH);
    h.frame.OnModify();
    h.host.unsavedAnswers.push('save');

    await run(h, ACTIONS.doNew);

    expect(h.host.written).toEqual([PATH]);
    expect(model.GetCount()).toBe(0);
  });

  it('is not asked on an unmodified sheet', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    await run(h, ACTIONS.doNew);

    expect(h.host.unsavedQuestions).toEqual([]);
    expect(model.GetCount()).toBe(0);
  });
});

describe('OnFileHistory', () => {
  it('says "loaded"', async () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.host.files.set(PATH, oneLineSheet());

    await h.frame.OnFileHistory(PATH);

    expect(h.status[0]).toBe(`File '${PATH}' loaded`);
    expect(model.GetCount()).toBe(1);
  });
});
