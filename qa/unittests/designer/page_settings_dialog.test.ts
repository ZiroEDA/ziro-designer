// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAGES_SETTINGS` — one dialog, three callers.
 *
 * Upstream `common/dialogs/dialog_page_settings.cpp` is constructed by
 * `pl_editor` (`pagelayout_editor/tools/pl_editor_control.cpp:94-98`), by
 * pcbnew (`pcbnew/tools/board_editor_control.cpp:530-532`) and by eeschema
 * through its one subclass (`eeschema/tools/sch_editor_control.cpp:511-513` →
 * `eeschema/dialogs/dialog_eeschema_page_settings.cpp`). We had TWO components
 * for it, and the consequence is the reason this file exists: every rule below
 * was already written down in the drawing sheet's copy and the schematic's copy
 * disagreed with it, because nothing here ran either one.
 *
 * Nothing in this file reads a `.tsx` as text unless the note on it says why
 * text is all there is; the rest calls the functions.
 */
import { describe, expect, it } from 'vitest';
import { DS_BG_COLOR, DS_BG_COLOR_DARK, DS_BG_COLOR_LIGHT, DS_ITEM_COLOR } from '@ziroeda/common';
import { PCB_BACKGROUND, PCB_DRAWINGSHEET } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMMENT_COUNT,
  customPageRangeMM,
  customSizeEnabled,
  formatIsoDate,
  fromPaperToken,
  MAX_PAGE_EXAMPLE_SIZE,
  MAX_PAGE_SIZE_EESCHEMA_MILS,
  MAX_PAGE_SIZE_PCBNEW_MILS,
  maxPageSizeMils,
  MIN_PAGE_SIZE_MILS,
  noPageExports,
  orientationEnabled,
  pageExportsFromSettings,
  pageExportsToSettings,
  orientationFromCustomSize,
  pageSettingsValue,
  pageSizeMM,
  previewThumbSize,
  showsExportCheckboxes,
  showsSheetTallies,
  TITLE_BLOCK_ROWS,
  previewColors,
  toPaperToken,
  wksPickerEnabled,
  type PageSettingsFrame,
} from '@ziroeda/designer/src/dialogs/page_settings_model.js';
import { validateUnitValue } from '@ziroeda/designer/src/ui/unit_binder.js';
import { PAPER_MM } from '@ziroeda/common';

const FRAMES: readonly PageSettingsFrame[] = ['eeschema', 'pcbnew', 'pl_editor'];

describe('what actually differs per caller, and nothing else', () => {
  it('only pcbnew gets the smaller max page size', () => {
    // include/page_info.h:34-36, and the three constructor calls that pass one
    // of them: sch_editor_control.cpp:512, board_editor_control.cpp:531,
    // pl_editor_control.cpp:95-96. pl_editor passes EESCHEMA's, not its own —
    // there is no MAX_PAGE_SIZE_PL_EDITOR_MILS.
    expect(maxPageSizeMils('eeschema')).toBe(MAX_PAGE_SIZE_EESCHEMA_MILS);
    expect(maxPageSizeMils('pl_editor')).toBe(MAX_PAGE_SIZE_EESCHEMA_MILS);
    expect(maxPageSizeMils('pcbnew')).toBe(MAX_PAGE_SIZE_PCBNEW_MILS);
    expect(MAX_PAGE_SIZE_EESCHEMA_MILS).toBe(120000);
    expect(MAX_PAGE_SIZE_PCBNEW_MILS).toBe(48000);
    expect(MIN_PAGE_SIZE_MILS).toBe(1000);
  });

  it('only pl_editor disables the drawing-sheet file picker', () => {
    // `dlg.EnableWksFileNamePicker( false )` (pl_editor_control.cpp:98) is the
    // ONE call to it in the tree. It disables the entry and the browse button
    // (dialog_page_settings.h:56-60); it hides neither, and no caller hides the
    // Drawing Sheet section — which is what ours did.
    expect(wksPickerEnabled('pl_editor')).toBe(false);
    expect(wksPickerEnabled('eeschema')).toBe(true);
    expect(wksPickerEnabled('pcbnew')).toBe(true);
  });

  it('only eeschema shows the export checkboxes and the sheet tallies', () => {
    // TransferDataToWindow Show(false)s all sixteen for every frame
    // (dialog_page_settings.cpp:169-185); only
    // DIALOG_EESCHEMA_PAGE_SETTINGS::onTransferDataToWindow Show(true)s them
    // again (dialog_eeschema_page_settings.cpp:87-102). Ours drew them in
    // pcbnew, where a board has no other sheet to export to.
    expect(showsExportCheckboxes('eeschema')).toBe(true);
    expect(showsExportCheckboxes('pcbnew')).toBe(false);
    expect(showsExportCheckboxes('pl_editor')).toBe(false);
    for (const f of FRAMES) expect(showsSheetTallies(f), f).toBe(showsExportCheckboxes(f));
  });
});

describe('the custom-size validator', () => {
  it('is MIN_PAGE_SIZE_MILS to the caller’s max, in millimetres', () => {
    for (const f of FRAMES) {
      const r = customPageRangeMM(f);
      expect(r.min, f).toBeCloseTo(1000 * 0.0254, 10);
      expect(r.max, f).toBeCloseTo(maxPageSizeMils(f) * 0.0254, 10);
    }
    // 25.4 mm and 3048 mm for a board; 3048 mm is A0's long edge fourteen times
    // over, which is the point of a per-caller limit.
    expect(customPageRangeMM('pcbnew').max).toBeCloseTo(1219.2, 6);
    expect(customPageRangeMM('eeschema').max).toBeCloseTo(3048, 6);
  });

  it('does not move when the frame’s display unit does', () => {
    // `Validate( MIN_PAGE_SIZE_MILS, m_maxPageSizeMils.x, EDA_UNITS::MILS )`
    // (dialog_page_settings.cpp:208-211). The third argument says the two
    // bounds are in MILS whatever the field is showing, so a schematic in mils
    // and a board in mm are checked against the same physical size — only the
    // number the message quotes back changes.
    const range = customPageRangeMM('eeschema');
    const tooSmall = 20; // mm, under the 25.4 mm floor
    const ok = 297;
    for (const units of ['mm', 'mils', 'in'] as const) {
      expect(validateUnitValue('Width:', tooSmall, range, units), units).not.toBeNull();
      expect(validateUnitValue('Width:', ok, range, units), units).toBeNull();
    }
    // …and the message really is in the display unit, so the number it names is
    // one the user could type back into the field (unit_binder.cpp:391-393).
    expect(validateUnitValue('Width:', tooSmall, range, 'mils')).toContain('mils');
    expect(validateUnitValue('Width:', tooSmall, range, 'mm')).toContain('mm');
  });

  it('names the field without its colon, as valueDescriptionFromLabel does', () => {
    // unit_binder.cpp:356 — "Width must be at least …", not "Width: must be".
    const msg = validateUnitValue('Width:', 1, customPageRangeMM('pcbnew'), 'mm');
    expect(msg).toMatch(/^Width must be at least/);
  });
});

describe('fgSizer2 — thirteen rows, one aligned checkbox column', () => {
  it('is the .fbp’s thirteen labels in the .fbp’s order', () => {
    // dialog_page_settings_base.cpp:216-382.
    expect(TITLE_BLOCK_ROWS.map((r) => r.label)).toEqual([
      'Issue Date:',
      'Revision:',
      'Title:',
      'Company:',
      'Comment1:',
      'Comment2:',
      'Comment3:',
      'Comment4:',
      'Comment5:',
      'Comment6:',
      'Comment7:',
      'Comment8:',
      'Comment9:',
    ]);
  });

  it('carries the SetMinSize the .fbp gives each entry', () => {
    // wxSize( 100, -1 ) on the date and the revision (:224, :245); wxSize(
    // 360, -1 ) on Title, Company and all nine comments (:257-377).
    const width = (label: string): number =>
      TITLE_BLOCK_ROWS.find((r) => r.label === label)!.minWidth;
    expect(width('Issue Date:')).toBe(100);
    expect(width('Revision:')).toBe(100);
    expect(width('Title:')).toBe(360);
    expect(width('Company:')).toBe(360);
    for (let i = 1; i <= COMMENT_COUNT; i++) expect(width(`Comment${i}:`), `${i}`).toBe(360);
  });

  it('puts the Issue Date row’s checkbox in the same column as the rest', () => {
    // The date entry, its "<<<" button and the wxDatePickerCtrl are ONE
    // bSizerDate occupying ONE cell of the grid (:220-235), so `m_DateExport`
    // is the row's third cell like every other row's (:237-238). Ours let that
    // row wrap its checkbox onto a line of its own, which broke the column at
    // the very first row — so the shape of the row is the assertion: every row
    // has an export cell, and the date's is not special.
    expect(TITLE_BLOCK_ROWS).toHaveLength(13);
    // The date is the FIRST row of the grid, not a row above it: fgSizer2's
    // first three Add()s are m_staticTextDate, bSizerDate and m_DateExport.
    const date = TITLE_BLOCK_ROWS[0]!;
    expect(date.label).toBe('Issue Date:');
    expect(date.field).toBe('date');
    expect(date.comment).toBeNull();
    // Every row names exactly one field, so every row has one entry and one
    // checkbox — thirteen of each, in three columns.
    expect(new Set(TITLE_BLOCK_ROWS.map((r) => r.field)).size).toBe(TITLE_BLOCK_ROWS.length);
  });

  it('maps the nine comment rows onto comments 0..8', () => {
    const comments = TITLE_BLOCK_ROWS.filter((r) => r.comment !== null);
    expect(comments).toHaveLength(COMMENT_COUNT);
    expect(comments.map((r) => r.comment)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // The LABEL is 1-based and the index is 0-based, which is the off-by-one
    // this mapping exists to hold: `m_Comment1Export` writes `SetComment( 0, … )`
    // (dialog_page_settings.cpp:345).
    expect(comments[0]!.label).toBe('Comment1:');
    expect(comments[8]!.label).toBe('Comment9:');
  });

  it('has fourteen checkboxes in all — thirteen here and m_PaperExport', () => {
    // :117-118 adds m_PaperExport to bleftSizer, not to fgSizer2, so it is the
    // one that sits under the custom-size fields rather than in the column.
    const flags = noPageExports();
    const count = Object.keys(flags).length - 1 + flags.comments.length;
    expect(count).toBe(TITLE_BLOCK_ROWS.length + 1);
    expect(count).toBe(14);
    expect(
      Object.values(flags)
        .flat()
        .every((v) => v === false),
    ).toBe(true);
  });
});

describe('the export ticks are a preference, not dialog state', () => {
  const stored = {
    paper: true,
    date: true,
    rev: true,
    title: true,
    company: true,
    comments: Array<boolean>(9).fill(true),
  };
  const filled = pageSettingsValue('A4', {
    date: 'd',
    rev: 'r',
    title: 't',
    company: 'c',
    comments: Array<string>(9).fill('x'),
  });
  const blank = pageSettingsValue('A4', {
    date: '',
    rev: '',
    title: '',
    company: '',
    comments: [],
  });

  it('comes back checked when the field it copies has text', () => {
    // dialog_eeschema_page_settings.cpp:111-124.
    expect(pageExportsFromSettings(stored, filled)).toEqual(stored);
  });

  it('comes back clear for every EMPTY field — except the paper one', () => {
    // `m_PaperExport->SetValue( cfg->… )` is the one line with no
    // `IsEmpty() ? false :` guard (:111), because a page always has a size.
    const seeded = pageExportsFromSettings(stored, blank);
    expect(seeded.paper).toBe(true);
    expect(seeded.date).toBe(false);
    expect(seeded.rev).toBe(false);
    expect(seeded.title).toBe(false);
    expect(seeded.company).toBe(false);
    expect(seeded.comments).toEqual(Array<boolean>(9).fill(false));
  });

  it('does not CLEAR a stored tick when the field is left empty', () => {
    // The destructor's mirror (:44-81): thirteen of the fourteen are written
    // back only `if( !m_TextRevision->GetValue().IsEmpty() )`. Ours wrote all
    // fourteen unconditionally, so opening the dialog on a sheet with no title
    // and pressing OK forgot the Title tick set on the sheet that had one.
    const ticked = pageExportsFromSettings(stored, blank); // all but paper false
    const written = pageExportsToSettings(stored, blank, ticked);
    expect(written.title).toBe(true);
    expect(written.rev).toBe(true);
    expect(written.comments).toEqual(Array<boolean>(9).fill(true));
    // …and paper, which has no guard, takes whatever the box says.
    expect(pageExportsToSettings(stored, blank, { ...ticked, paper: false }).paper).toBe(false);
  });

  it('writes a tick through when the field DOES have text', () => {
    const cleared = {
      paper: false,
      date: false,
      rev: false,
      title: false,
      company: false,
      comments: Array<boolean>(9).fill(false),
    };
    expect(pageExportsToSettings(stored, filled, cleared)).toEqual(cleared);
  });
});

describe('the enable rules OnPaperSizeChoice writes', () => {
  it('are mutually exclusive and turn on for User alone', () => {
    // dialog_page_settings.cpp:240-259.
    for (const paper of ['A4', 'A3', 'USLetter', 'GERBER']) {
      expect(customSizeEnabled(paper), paper).toBe(false);
      expect(orientationEnabled(paper), paper).toBe(true);
    }
    expect(customSizeEnabled('User')).toBe(true);
    expect(orientationEnabled('User')).toBe(false);
  });

  it('derive a User page’s orientation from its two edges', () => {
    // GetPageLayoutInfoFromDialog (:641-651): portrait exactly when the width
    // is less than the height, and only when NEITHER is zero.
    expect(orientationFromCustomSize(210, 297)).toBe(true);
    expect(orientationFromCustomSize(297, 210)).toBe(false);
    // A square is not portrait — `<`, not `<=`.
    expect(orientationFromCustomSize(200, 200)).toBe(false);
    expect(orientationFromCustomSize(0, 297)).toBeNull();
    expect(orientationFromCustomSize(297, 0)).toBeNull();
  });
});

describe('the page the preview is drawn at', () => {
  it('swaps a standard size for portrait and leaves a User one alone', () => {
    const base = pageSettingsValue('A4', {
      date: '',
      rev: '',
      title: '',
      company: '',
      comments: [],
    });
    const [lw, lh] = pageSizeMM(base);
    expect(pageSizeMM({ ...base, portrait: true })).toEqual([lh, lw]);
    expect([lw, lh]).toEqual(PAPER_MM.A4);
    // A User page is stored as entered; there is nothing to swap.
    const user = { ...base, paper: 'User', customWidthMM: 100, customHeightMM: 300 };
    expect(pageSizeMM(user)).toEqual([100, 300]);
    expect(pageSizeMM({ ...user, portrait: true })).toEqual([100, 300]);
  });

  it('pins the thumbnail’s long edge to MAX_PAGE_EXAMPLE_SIZE', () => {
    // UpdateDrawingSheetExample (:537-550).
    expect(MAX_PAGE_EXAMPLE_SIZE).toBe(200);
    const land = previewThumbSize(420, 297, 'eeschema');
    expect(land.width).toBe(200);
    expect(land.height).toBe(Math.round(200 / (420 / 297)));
    const port = previewThumbSize(297, 420, 'eeschema');
    expect(port.height).toBe(200);
    expect(port.width).toBe(Math.round(200 / (420 / 297)));
  });

  it('clamps the page first, and clamps it against the CALLER’s max', () => {
    // `clamped_layout_size` (:532-535) uses m_maxPageSizeMils, which is the
    // per-caller number — so an over-size page is a different shape in a board
    // than in a schematic. A 3000 mm x 300 mm page clamps to 1219.2 x 300 for
    // pcbnew and stays 3000 x 300 for eeschema.
    const pcb = previewThumbSize(3000, 300, 'pcbnew');
    const sch = previewThumbSize(3000, 300, 'eeschema');
    expect(pcb.height).toBe(Math.round(200 / (customPageRangeMM('pcbnew').max / 300)));
    expect(sch.height).toBe(Math.round(200 / (3000 / 300)));
    expect(pcb.height).not.toBe(sch.height);
    // …and the floor bites too: nothing is thinner than MIN_PAGE_SIZE_MILS.
    expect(previewThumbSize(1, 300, 'eeschema')).toEqual(
      previewThumbSize(customPageRangeMM('eeschema').min, 300, 'eeschema'),
    );
  });
});

describe('the (paper …) token', () => {
  it('writes `portrait` only for a standard size, as PAGE_INFO::Format does', () => {
    // common/page_info.cpp:238-256: the two edges are printed for User only,
    // and `portrait` for !IsCustom() only.
    expect(
      toPaperToken({ paper: 'A4', portrait: false, customWidthMM: 1, customHeightMM: 2 }),
    ).toBe('A4');
    expect(toPaperToken({ paper: 'A4', portrait: true, customWidthMM: 1, customHeightMM: 2 })).toBe(
      'A4 portrait',
    );
    // A User page never gets the word, whichever way round its edges are.
    expect(
      toPaperToken({ paper: 'User', portrait: true, customWidthMM: 100, customHeightMM: 300 }),
    ).toBe('User 100 300');
  });

  it('round-trips every standard size, both orientations', () => {
    for (const id of ['A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'A', 'B', 'USLetter', 'USLedger']) {
      for (const portrait of [false, true]) {
        const token = toPaperToken({
          paper: id,
          portrait,
          customWidthMM: 0,
          customHeightMM: 0,
        });
        const back = fromPaperToken(token);
        expect(back.paper, token).toBe(id);
        expect(back.portrait, token).toBe(portrait);
      }
    }
  });

  it('round-trips a User page’s two edges', () => {
    const token = toPaperToken({
      paper: 'User',
      portrait: false,
      customWidthMM: 431.8,
      customHeightMM: 279.4,
    });
    expect(token).toBe('User 431.8 279.4');
    const back = fromPaperToken(token);
    expect(back.paper).toBe('User');
    expect(back.customWidthMM).toBe(431.8);
    expect(back.customHeightMM).toBe(279.4);
    // Derived, not stored — 431.8 > 279.4, so landscape.
    expect(back.portrait).toBe(false);
    expect(fromPaperToken('User 279.4 431.8').portrait).toBe(true);
  });

  it('falls back to PAGE_INFO’s own 17000 x 11000 mils, not to a guess', () => {
    // common/page_info.cpp:70-71 — the static custom size a fresh session
    // starts on. A standard token carries no edges, so the fields have to show
    // something, and this is what KiCad shows.
    const a4 = fromPaperToken('A4');
    expect(a4.customWidthMM).toBeCloseTo(17000 * 0.0254, 9);
    expect(a4.customHeightMM).toBeCloseTo(11000 * 0.0254, 9);
    // A malformed User token gets the same, rather than NaN in the field.
    const bad = fromPaperToken('User');
    expect(Number.isFinite(bad.customWidthMM)).toBe(true);
    expect(bad.customWidthMM).toBeCloseTo(17000 * 0.0254, 9);
  });

  it('defaults an empty token to A4', () => {
    expect(fromPaperToken('').paper).toBe('A4');
  });

  it('pads a title block to nine comments and no more', () => {
    const v = pageSettingsValue('A3 portrait', {
      date: '2026-01-02',
      rev: 'B',
      title: 'T',
      company: 'C',
      comments: ['one', 'two'],
    });
    expect(v.comments).toHaveLength(COMMENT_COUNT);
    expect(v.comments.slice(0, 2)).toEqual(['one', 'two']);
    expect(v.comments.slice(2).every((c) => c === '')).toBe(true);
    expect(v.paper).toBe('A3');
    expect(v.portrait).toBe(true);
    expect(v.rev).toBe('B');
  });
});

describe('the "<<<" button', () => {
  it('formats the picker’s date as FormatISODate, zero-padded', () => {
    // dialog_page_settings.cpp:439-452. Local fields, not toISOString: the
    // picker holds a local date and a UTC conversion moves it a day either way.
    expect(formatIsoDate(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(formatIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(formatIsoDate(new Date(2026, 7, 25, 23, 30))).toBe('2026-08-25');
  });
});

/*
 * The three checks below read the component as TEXT, which pins spelling and
 * not behaviour. They are here anyway because what they check is the ABSENCE of
 * something, and an absence has no function to call: a control that is not
 * rendered cannot be asked whether it is not rendered. Each is written
 * per-occurrence — a count, not a "does not contain" over the whole file — so a
 * second offender cannot hide behind the first one being gone.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL('../../../designer/src/dialogs/dialog_page_settings.tsx', import.meta.url)),
  'utf8',
);

/**
 * Comments blanked to spaces, the way `central_values.test.ts` does it. Without
 * this the checks below pass on a `<select>` that is only being TALKED about —
 * which is exactly what happened the first time this file ran, since the note
 * beside the file entry says what it replaced.
 */
function blankComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? text.length : j + 2;
      for (let k = i; k < j; k++) out += text[k] === '\n' ? '\n' : ' ';
      i = j;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      for (let k = i; k < j; k++) out += ' ';
      i = j;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

const DIALOG = blankComments(SOURCE);

/**
 * Upstream's structure, not just its behaviour.
 *
 * `DIALOG_PAGES_SETTINGS` ships WITHOUT the export column and the sheet
 * tallies, and `DIALOG_EESCHEMA_PAGE_SETTINGS` is the one subclass that adds
 * them along with their settings round-trip
 * (dialog_eeschema_page_settings.cpp:37-125). Collapsing that into a boolean
 * would leave the round-trip homeless, so the split is mirrored — and that
 * makes "which component does each frame open" a fact worth pinning.
 */
const EDITOR = (rel: string): string =>
  blankComments(
    readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8'),
  );

describe('the base class and its one subclass', () => {
  it('is eeschema alone that opens the subclass', () => {
    const sch = EDITOR('editors/schematic/SchematicEditor.tsx');
    expect([...sch.matchAll(/<DialogEeschemaPageSettings\b/g)]).toHaveLength(1);
    // …and it does NOT reach past it to the base class.
    expect([...sch.matchAll(/<DialogPageSettings\b/g)]).toEqual([]);
  });

  it('pcbnew and pl_editor open the BASE class, as their tools do', () => {
    // board_editor_control.cpp:530 and pl_editor_control.cpp:94 both construct
    // DIALOG_PAGES_SETTINGS itself; neither has a subclass.
    for (const rel of [
      'editors/pcb/PcbEditor.tsx',
      'editors/drawingsheet/DrawingSheetEditor.tsx',
    ]) {
      const src = EDITOR(rel);
      expect([...src.matchAll(/<DialogPageSettings\b/g)], rel).toHaveLength(1);
      expect([...src.matchAll(/DialogEeschemaPageSettings/g)], rel).toEqual([]);
    }
  });

  it('and the subclass is the only thing that knows about the export settings', () => {
    // The two transforms are the constructor/destructor pair; nothing else in
    // the tree should be applying them, or the guard gets restated.
    const wrapper = EDITOR('dialogs/dialog_eeschema_page_settings.tsx');
    expect([...wrapper.matchAll(/pageExportsFromSettings\(/g)]).toHaveLength(1);
    expect([...wrapper.matchAll(/pageExportsToSettings\(/g)]).toHaveLength(1);
    for (const rel of [
      'dialogs/dialog_page_settings.tsx',
      'editors/pcb/PcbEditor.tsx',
      'editors/drawingsheet/DrawingSheetEditor.tsx',
    ]) {
      expect([...EDITOR(rel).matchAll(/pageExports(From|To)Settings/g)], rel).toEqual([]);
    }
  });

  it('leaves the base component with no eeschema settings knowledge at all', () => {
    // `frame` decides show/hide (that IS the base's own Show(false) branch);
    // the settings object never reaches it.
    expect([
      ...DIALOG.matchAll(/\.page_settings\b|export_paper|updateEeschema|EeschemaSettings/g),
    ]).toEqual([]);
    // The wrapper is where all four of those live.
    const wrapper = EDITOR('dialogs/dialog_eeschema_page_settings.tsx');
    expect([...wrapper.matchAll(/frame="eeschema"/g)]).toHaveLength(1);
  });
});

describe('what the merged component must NOT draw', () => {
  it('writes no unit word of its own — the binder supplies it', () => {
    // `UNIT_BINDER( aParent, m_userSizeXLabel, m_userSizeXCtrl, m_userSizeXUnits )`
    // (dialog_page_settings.cpp:65-66) re-labels the static text from the
    // frame's unit (unit_binder.cpp:109-110). Ours had `mm` written twice, and
    // that is why real eeschema showed mils beside a field where ours said mm.
    const spans = [...DIALOG.matchAll(/>\s*(mm|mils|in)\s*</g)];
    expect(spans.map((m) => m[0])).toEqual([]);
    // …and both fields are the shared UnitField, taking the frame's unit.
    expect([...DIALOG.matchAll(/<UnitField\b/g)]).toHaveLength(2);
    expect([...DIALOG.matchAll(/units=\{units\}/g)]).toHaveLength(2);
  });

  it('prints no dimension line under the preview', () => {
    // bleftSizer ends at m_PageLayoutExampleBitmap (dialog_page_settings_base.cpp:
    // 133-140): there is no static text after it and nothing anywhere in the
    // dialog prints the page's size as a number. Ours printed
    // "297.0022 × 210.00719999999998 mm" there — a raw double, and a control
    // upstream does not have.
    expect([...DIALOG.matchAll(/[×x]\s*\{/g)]).toEqual([]);
    expect([...DIALOG.matchAll(/\{wMM\}|\{pageW\}\s*[×x]/g)]).toEqual([]);
  });

  it('offers the drawing sheet as an entry and a browse button, not a list', () => {
    // m_textCtrlFilePicker is a wxTextCtrl and m_browseButton a
    // STD_BITMAP_BUTTON (dialog_page_settings_base.cpp:168-172); the button
    // opens a wxFileDialog (dialog_page_settings.cpp:722-735). Ours was a
    // <select> of the project's .kicad_wks files, which is neither.
    expect([...DIALOG.matchAll(/<select\b/g)]).toEqual([]);
    expect(DIALOG).toContain('ze-btn-bitmap');
    expect(DIALOG).toContain('OpenFileDialog');
  });
});

describe('the preview takes both its colours from the parent frame', () => {
  /**
   * `UpdateDrawingSheetExample` (`dialog_page_settings.cpp:594-616`). Ours
   * painted `#ffffff` and the schematic ink for all three frames, so the PCB
   * editor showed a white sheet where KiCad shows a near-black one.
   *
   * Values are the theme entries, not literals repeated here — a colour written
   * out twice is two numbers that have to agree.
   */
  it('eeschema: the schematic background and the schematic drawing-sheet ink', () => {
    // `SCH_BASE_FRAME::GetDrawBgColor` returns LAYER_SCHEMATIC_BACKGROUND
    // outright (eeschema/sch_base_frame.cpp:643-646), and :606-613 substitutes
    // LAYER_SCHEMATIC_DRAWINGSHEET for the sheet layer on schematic frames.
    expect(previewColors('eeschema')).toEqual({
      background: DS_BG_COLOR,
      ink: DS_ITEM_COLOR,
    });
  });

  it('pcbnew: the board background and the plain drawing-sheet ink', () => {
    // LAYER_PCB_BACKGROUND via appearance_controls.cpp:3235-3236, and NO
    // substitution — pcbnew is not a schematic frame, so it keeps
    // LAYER_DRAWINGSHEET.
    const c = previewColors('pcbnew');
    expect(c.background).toBe(PCB_BACKGROUND);
    expect(c.ink).toBe(PCB_DRAWINGSHEET);
    // The bug in one assertion: these are the two that used to be shared with
    // eeschema, and neither may drift back to it.
    expect(c.background).not.toBe(DS_BG_COLOR);
    expect(c.ink).not.toBe(DS_ITEM_COLOR);
  });

  it('pl_editor: a user toggle, not a theme layer', () => {
    // `SetDrawBgColor( cfg->m_BlackBackground ? BLACK : WHITE )`
    // (pl_editor_frame.cpp:541) — the one frame where this is not a layer.
    expect(previewColors('pl_editor', false).background).toBe(DS_BG_COLOR_LIGHT);
    expect(previewColors('pl_editor', true).background).toBe(DS_BG_COLOR_DARK);
    // Still not a schematic frame, so the ink is the plain sheet layer.
    expect(previewColors('pl_editor').ink).toBe(PCB_DRAWINGSHEET);
  });

  it('gives every frame a different background', () => {
    // Per-frame and not per-file: three frames sharing one colour is exactly
    // the bug, and a check that only looked at one of them would have passed.
    const backgrounds = (['eeschema', 'pcbnew', 'pl_editor'] as const).map(
      (f) => previewColors(f).background,
    );
    expect(new Set(backgrounds).size).toBe(3);
  });
});
