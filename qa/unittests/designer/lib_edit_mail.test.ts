// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SYMBOL_EDIT_FRAME::KiwayMailIn`'s MAIL_LIB_EDIT and `FOOTPRINT_EDIT_FRAME::
 * KiwayMailIn`'s MAIL_FP_EDIT: the project manager's double-click on a library
 * file (`PROJECT_TREE_ITEM::Activate`), arriving at an editor that is running
 * or still mounting.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { SYMBOL_EDIT_FRAME } from '@ziroeda/eeschema/symbol_editor/symbol_edit_frame.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';

const makeKiway = (shown: FRAME_T[] = []) =>
  new KIWAY({
    OnKiCadExit: () => {},
    Player: (t) => {
      shown.push(t);
      return true;
    },
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });

describe('MAIL_LIB_EDIT', () => {
  it('hands a non-empty URI to the symbol editor, and ignores an empty one', () => {
    const kiway = makeKiway();
    const got: string[] = [];
    kiway.SetPlayerFrame(
      FRAME_T.FRAME_SCH_SYMBOL_EDITOR,
      new SYMBOL_EDIT_FRAME({ libEdit: (u) => got.push(u) }),
    );

    kiway.ExpressMail(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, MAIL_T.MAIL_LIB_EDIT, {
      value: 'lib/mine.kicad_sym',
    });
    kiway.ExpressMail(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, MAIL_T.MAIL_LIB_EDIT, { value: '' });
    kiway.ExpressMail(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, MAIL_T.MAIL_FP_EDIT, {
      value: 'x.kicad_mod',
    });

    expect(got).toEqual(['lib/mine.kicad_sym']);
  });

  it('reaches an editor opened by Player() once it registers', () => {
    const shown: FRAME_T[] = [];
    const kiway = makeKiway(shown);
    const got: string[] = [];

    kiway.Player(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);
    kiway.ExpressMail(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, MAIL_T.MAIL_LIB_EDIT, {
      value: 'a.kicad_sym',
    });
    expect(got).toEqual([]);

    kiway.SetPlayerFrame(
      FRAME_T.FRAME_SCH_SYMBOL_EDITOR,
      new SYMBOL_EDIT_FRAME({ libEdit: (u) => got.push(u) }),
    );
    expect(shown).toEqual([FRAME_T.FRAME_SCH_SYMBOL_EDITOR]);
    expect(got).toEqual(['a.kicad_sym']);
  });
});

describe('MAIL_FP_EDIT', () => {
  it('hands a non-empty file to the footprint editor, and ignores an empty one', () => {
    const kiway = makeKiway();
    const got: string[] = [];
    kiway.SetPlayerFrame(
      FRAME_T.FRAME_FOOTPRINT_EDITOR,
      new FOOTPRINT_EDIT_FRAME({ fpEdit: (f) => got.push(f) }),
    );

    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_EDITOR, MAIL_T.MAIL_FP_EDIT, {
      value: 'my.pretty/R.kicad_mod',
    });
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_EDITOR, MAIL_T.MAIL_FP_EDIT, { value: '' });
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_EDITOR, MAIL_T.MAIL_LIB_EDIT, {
      value: 'a.kicad_sym',
    });

    expect(got).toEqual(['my.pretty/R.kicad_mod']);
  });

  it('goes to the footprint editor, not the symbol editor', () => {
    const kiway = makeKiway();
    const sym: string[] = [];
    const fp: string[] = [];
    kiway.SetPlayerFrame(
      FRAME_T.FRAME_SCH_SYMBOL_EDITOR,
      new SYMBOL_EDIT_FRAME({ libEdit: (u) => sym.push(u) }),
    );
    kiway.SetPlayerFrame(
      FRAME_T.FRAME_FOOTPRINT_EDITOR,
      new FOOTPRINT_EDIT_FRAME({ fpEdit: (f) => fp.push(f) }),
    );

    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_EDITOR, MAIL_T.MAIL_FP_EDIT, {
      value: 'R.kicad_mod',
    });

    expect([sym, fp]).toEqual([[], ['R.kicad_mod']]);
  });
});

describe('the frames are the types KIWAY knows them as', () => {
  it('IsType answers FRAME_SCH_SYMBOL_EDITOR and FRAME_FOOTPRINT_EDITOR', () => {
    const sym = new SYMBOL_EDIT_FRAME({ libEdit: () => {} });
    const fp = new FOOTPRINT_EDIT_FRAME({ fpEdit: () => {} });
    expect([
      sym.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR),
      sym.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR),
    ]).toEqual([true, false]);
    expect([
      fp.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR),
      fp.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR),
    ]).toEqual([true, false]);
  });
});
