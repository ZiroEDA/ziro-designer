// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rows 3 and 4 of `docs/frame-titles.md`: `SYMBOL_EDIT_FRAME::UpdateTitle`
 * (eeschema/symbol_editor/symbol_editor.cpp:58-88) and
 * `FOOTPRINT_EDIT_FRAME::UpdateTitle` (pcbnew/footprint_edit_frame.cpp:1080-1132).
 *
 * Every expectation here is a literal read off the C++, never a value computed
 * by calling the function under test. The branches are asserted ONE AT A TIME
 * rather than through a single "looks about right" string, because a per-file
 * check passes with one branch of four still wrong — which is how the symbol
 * editor came to print the project name where the LIB_ID goes and nothing
 * noticed.
 */
import { describe, expect, it } from 'vitest';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import {
  FROM_SCHEMATIC_SUFFIX,
  READ_ONLY_LIBRARY_SUFFIX,
  SYM_FRAME_NAME,
  SYM_NO_DOCUMENT,
  symFrameTitle,
} from '@ziroeda/designer/src/editors/symbol/frame_title.js';
import {
  FP_FRAME_NAME,
  FP_NO_DOCUMENT,
  fpFrameTitle,
  fromBoardSuffix,
  PCB_FILE_EXTENSION,
} from '@ziroeda/designer/src/editors/footprint/frame_title.js';
import { READ_ONLY_SUFFIX, UNSAVED_SUFFIX } from '@ziroeda/designer/src/ui/useDocumentTitle.js';

/** The one call shape the symbol editor's own module needs. */
const sym = (spec: Parameters<typeof symFrameTitle>[0]): string =>
  symFrameTitle(spec, unescapeString).full;

describe('SYMBOL_EDIT_FRAME::UpdateTitle', () => {
  /** `title += wxT( " — " ) + _( "Symbol Editor" );` — symbol_editor.cpp:86. */
  it('names the frame "Symbol Editor" after an em dash', () => {
    expect(SYM_FRAME_NAME).toBe('Symbol Editor');
    expect(sym({ hasSymbol: true, libId: 'Device:R' })).toBe('Device:R — Symbol Editor');
  });

  /**
   * The bug this module was written for. `UpdateTitle` does not mention the
   * project in ANY branch; ours printed `Prj().GetProjectName()` where the
   * LIB_ID goes, so a user editing `Device:R` read `MyProject`.
   */
  it('names the symbol, never the project', () => {
    const title = sym({ hasSymbol: true, libId: 'Device:R' });
    expect(title).toContain('Device:R');
    expect(title).not.toContain('MyProject');
  });

  /** `title += UnescapeString( GetCurSymbol()->GetLibId().Format() );` — :74. */
  it('unescapes the LIB_ID', () => {
    expect(sym({ hasSymbol: true, libId: 'Power:AC{slash}DC' })).toBe(
      'Power:AC/DC — Symbol Editor',
    );
  });

  /** `if( … IsContentModified() ) title = wxT( "*" );` then `title += …` — :70-74. */
  it('puts a star straight against the name when modified', () => {
    expect(sym({ hasSymbol: true, libId: 'Device:R', modified: true })).toBe(
      '*Device:R — Symbol Editor',
    );
  });

  it('has no star when unmodified', () => {
    expect(sym({ hasSymbol: true, libId: 'Device:R', modified: false })).toBe(
      'Device:R — Symbol Editor',
    );
  });

  /**
   * `title += wxS( " " ) + _( "[Read Only Library]" );` — :79.
   *
   * Frame 3 is the ONLY one of the thirteen that says "Library" here
   * (`docs/frame-titles.md` note C); the other five say `[Read Only]`. Both
   * halves are asserted so collapsing the two constants fails.
   */
  it('marks a read-only library with [Read Only Library], not [Read Only]', () => {
    const title = sym({ hasSymbol: true, libId: 'Device:R', readOnlyLibrary: true });
    expect(title).toBe('Device:R [Read Only Library] — Symbol Editor');
    expect(READ_ONLY_LIBRARY_SUFFIX).toBe('[Read Only Library]');
    expect(READ_ONLY_LIBRARY_SUFFIX).not.toBe(READ_ONLY_SUFFIX);
  });

  it('omits the read-only suffix on a writable library', () => {
    expect(sym({ hasSymbol: true, libId: 'Device:R', readOnlyLibrary: false })).toBe(
      'Device:R — Symbol Editor',
    );
  });

  /**
   * `title += m_reference; title += wxS( " " ) + _( "[from schematic]" );`
   * — :67-68. The document is the REFERENCE, and the LIB_ID is not printed.
   */
  it('prints the reference and [from schematic] for a symbol from the schematic', () => {
    const title = sym({
      hasSymbol: true,
      fromSchematic: true,
      reference: 'R1',
      libId: 'Device:R',
    });
    expect(title).toBe('R1 [from schematic] — Symbol Editor');
    expect(title).not.toContain('Device:R');
    expect(FROM_SCHEMATIC_SUFFIX).toBe('[from schematic]');
  });

  it('stars the from-schematic branch too', () => {
    expect(sym({ hasSymbol: true, fromSchematic: true, reference: 'R1', modified: true })).toBe(
      '*R1 [from schematic] — Symbol Editor',
    );
  });

  /** `else { title = _( "[no symbol loaded]" ); }` — :83. */
  it('substitutes [no symbol loaded] with no symbol open', () => {
    expect(sym({ hasSymbol: false })).toBe('[no symbol loaded] — Symbol Editor');
    expect(SYM_NO_DOCUMENT).toBe('[no symbol loaded]');
  });

  /**
   * The placeholder is an ASSIGNMENT (`title = _( … )`) and both `title = "*"`
   * lines sit inside branches that ran already, so the empty branch cannot
   * carry a star however modified the library is.
   */
  it('never stars the placeholder', () => {
    expect(sym({ hasSymbol: false, modified: true })).toBe('[no symbol loaded] — Symbol Editor');
  });

  /**
   * `if( GetCurSymbol() && IsSymbolFromSchematic() )` — the FIRST half is the
   * guard on both non-empty branches. `IsSymbolFromSchematic()` alone must not
   * select branch 1.
   */
  it('falls to the placeholder when from-schematic is set but no symbol is loaded', () => {
    expect(sym({ hasSymbol: false, fromSchematic: true, reference: 'R1' })).toBe(
      '[no symbol loaded] — Symbol Editor',
    );
  });
});

describe('FOOTPRINT_EDIT_FRAME::UpdateTitle', () => {
  /** `title += wxT( " — " ) + _( "Footprint Editor" );` — :1130. */
  it('names the frame "Footprint Editor" after an em dash', () => {
    expect(FP_FRAME_NAME).toBe('Footprint Editor');
    expect(fpFrameTitle({ loadedFpidValid: true, fpid: 'Resistor_SMD:R_0805' }).full).toBe(
      'Resistor_SMD:R_0805 — Footprint Editor',
    );
  });

  it('puts a star straight against the name when modified', () => {
    expect(
      fpFrameTitle({ loadedFpidValid: true, fpid: 'Resistor_SMD:R_0805', modified: true }).full,
    ).toBe('*Resistor_SMD:R_0805 — Footprint Editor');
  });

  /** `if( !writable ) title += wxS( " " ) + _( "[Read Only]" );` — :1112-1113. */
  it('marks a non-writable library [Read Only]', () => {
    expect(fpFrameTitle({ loadedFpidValid: true, fpid: 'Lib:FP', writable: false }).full).toBe(
      `Lib:FP ${READ_ONLY_SUFFIX} — Footprint Editor`,
    );
  });

  /**
   * `bool writable = true;` at :1084, and an `IO_ERROR` from the lookup is
   * swallowed "best efforts" — so not knowing means writable, not read-only.
   */
  it('treats an unknown writability as writable, as the C++ seed does', () => {
    expect(fpFrameTitle({ loadedFpidValid: true, fpid: 'Lib:FP' }).full).toBe(
      'Lib:FP — Footprint Editor',
    );
    expect(fpFrameTitle({ loadedFpidValid: true, fpid: 'Lib:FP', writable: true }).full).toBe(
      'Lib:FP — Footprint Editor',
    );
  });

  /**
   * Branch 1 (:1088-1096): the document is the footprint's REFERENCE, and the
   * suffix interpolates the project name and the board extension.
   */
  it('prints the reference and [from <project>.kicad_pcb] for a board footprint', () => {
    const title = fpFrameTitle({
      fromBoard: true,
      reference: 'R12',
      projectName: 'MyProject',
      fpid: 'Resistor_SMD:R_0805',
    }).full;
    expect(title).toBe('R12 [from MyProject.kicad_pcb] — Footprint Editor');
    expect(title).not.toContain('Resistor_SMD');
  });

  /** `FILEEXT::PcbFileExtension`, interpolated after a literal dot. */
  it('builds the from-board suffix from the project name and the board extension', () => {
    expect(PCB_FILE_EXTENSION).toBe('kicad_pcb');
    expect(fromBoardSuffix('Widget')).toBe('[from Widget.kicad_pcb]');
  });

  /** `if( IsCurrentFPFromBoard() )` is tested FIRST, before `fpid.IsValid()`. */
  it('prefers the board branch over a valid FPID', () => {
    expect(
      fpFrameTitle({
        fromBoard: true,
        reference: 'R12',
        projectName: 'P',
        loadedFpidValid: true,
        fpid: 'Lib:FP',
      }).full,
    ).toBe('R12 [from P.kicad_pcb] — Footprint Editor');
  });

  /**
   * Branch 3 (:1118-1126): a loaded FPID with a library item name but no valid
   * id prints the NAME half and `[Unsaved]`, unconditionally.
   */
  it('prints the item name and [Unsaved] for a footprint that has never been saved', () => {
    expect(
      fpFrameTitle({ loadedFpidValid: false, loadedLibItemName: 'R_0805', libItemName: 'R_0805' })
        .full,
    ).toBe(`R_0805 ${UNSAVED_SUFFIX} — Footprint Editor`);
  });

  /**
   * The trap upstream comments twice: "don't used GetLoadedFPID(); footprint
   * name may have been edited". The branch is chosen by the LOADED id and the
   * string printed comes off the LIVE one, so a rename shows through before it
   * is saved. Reading both off one value is the obvious simplification and it
   * is wrong.
   */
  it('chooses the branch on the loaded FPID but prints the live one', () => {
    expect(fpFrameTitle({ loadedFpidValid: true, fpid: 'Lib:RenamedAfterLoad' }).full).toBe(
      'Lib:RenamedAfterLoad — Footprint Editor',
    );
    // Branch 3's guard is the LOADED name; its document is the live name.
    expect(
      fpFrameTitle({
        loadedFpidValid: false,
        loadedLibItemName: 'OldName',
        libItemName: 'NewName',
      }).full,
    ).toBe(`NewName ${UNSAVED_SUFFIX} — Footprint Editor`);
  });

  /** `else { title = _( "[no footprint loaded]" ); }` — :1128. */
  it('substitutes [no footprint loaded] with nothing open', () => {
    expect(fpFrameTitle({}).full).toBe('[no footprint loaded] — Footprint Editor');
    expect(FP_NO_DOCUMENT).toBe('[no footprint loaded]');
  });

  it('never stars the placeholder', () => {
    expect(fpFrameTitle({ modified: true }).full).toBe('[no footprint loaded] — Footprint Editor');
  });

  /** An empty loaded item name does not select branch 3. */
  it('falls to the placeholder when the loaded item name is empty', () => {
    expect(fpFrameTitle({ loadedFpidValid: false, loadedLibItemName: '' }).full).toBe(
      '[no footprint loaded] — Footprint Editor',
    );
  });
});

describe('both frames', () => {
  /**
   * `wxT( " — " )`. Ours wrote `&nbsp;-&nbsp;` at both call sites, which
   * is an ASCII hyphen and two non-breaking spaces — three wrong characters.
   */
  it('separate the halves with an em dash and never a hyphen', () => {
    for (const parts of [
      symFrameTitle({ hasSymbol: true, libId: 'Device:R' }, unescapeString),
      fpFrameTitle({ loadedFpidValid: true, fpid: 'Lib:FP' }),
    ]) {
      expect(parts.separator).toBe(' — ');
      expect(parts.full).not.toContain('-');
      // U+00A0, the `&nbsp;` half of what both call sites used to write.
      expect(parts.full).not.toContain('\u00a0');
    }
  });

  /**
   * The document half is returned separately so the title bar can weight it,
   * and the star is NOT part of it — `<b>{modified}{document}</b>` at the call
   * sites puts both inside the bold run.
   */
  it('return the star apart from the document', () => {
    const parts = fpFrameTitle({ loadedFpidValid: true, fpid: 'Lib:FP', modified: true });
    expect(parts.modified).toBe('*');
    expect(parts.document).toBe('Lib:FP');
  });
});
