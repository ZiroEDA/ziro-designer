// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every launcher opens its documents through the ONE file dialog.
 *
 * Upstream that is not a choice: `wxFileDialog` is one class and every frame
 * builds one, so the sidebar, the filter combo, the overwrite prompt and the
 * places are the same in eeschema, pcbnew, the symbol editor and pl_editor
 * without anyone maintaining four of them.
 *
 * Ours had a hidden `<input type="file">` per launcher — the operating system's
 * picker, which knows nothing about the account. A document saved into the
 * account could not be re-opened from inside the editor at all, only downloaded
 * and picked off the local disk, and `accept` flattens KiCad's named wildcards
 * into one unlabelled group.
 *
 * This is per-occurrence because the rule is: one launcher still on the OS
 * picker is one launcher that cannot see the account.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DRAWING_SHEET_FILE_EXTENSION,
  KICAD_SCHEMATIC_FILE_EXTENSION,
  ensureFileExtension,
} from '@ziroeda/common/src/common.js';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

/** Source with comments blanked, so a citation cannot read as code. */
const code = (s: string): string =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('the document editors use the chooser, not the OS picker', () => {
  const wired: [string, string, string | null][] = [
    // file,                                        kind it asks for,  and why
    ['editors/drawingsheet/DrawingSheetEditor.tsx', 'templates', 'GetUserTemplatesPath'],
    ['editors/symbol/SymbolEditor.tsx', 'symbols', 'GetDefaultUserSymbolsPath'],
    ['editors/footprint/FootprintEditor.tsx', 'footprints', 'GetDefaultUserFootprintsPath'],
  ];

  /** Every `<OpenFileDialog …/>` and `<SaveAsDialog …/>` element in a file. */
  const chooserElements = (file: string): string[] =>
    [...src(file).matchAll(/<(?:OpenFileDialog|SaveAsDialog)\b[\s\S]*?\/>/g)].map((m) => m[0]);

  it('asks for the shared folder its document kind belongs in', () => {
    // Read the ELEMENT, not the file. `toContain('kind="symbols"')` over the
    // whole source passed while the chooser asked for footprints, because
    // `LibraryLoadingPanel` has an unrelated `kind` prop further down — the
    // per-file check of a per-occurrence rule, exactly the shape CLAUDE.md
    // names. A sweep found it.
    for (const [file, kind] of wired) {
      const elements = chooserElements(file);
      expect(elements.length, `${file} opens no chooser at all`).toBeGreaterThan(0);
      for (const el of elements) {
        expect(el, `a chooser in ${file} asks for the wrong folder`).toContain(`kind="${kind}"`);
      }
    }
  });

  it('names no OTHER editor’s folder in any of them', () => {
    // The other half: a file could carry the right kind AND a stray wrong one.
    for (const [file, kind] of wired) {
      for (const el of chooserElements(file)) {
        for (const other of ['templates', 'symbols', 'footprints', 'models3d']) {
          if (other === kind) continue;
          expect(el, `a chooser in ${file} also names ${other}`).not.toContain(`kind="${other}"`);
        }
      }
    }
  });

  it('cites the PATHS:: function that folder comes from', () => {
    // Each is a real upstream path, not a folder we invented.
    for (const [file, , cite] of wired) {
      if (cite) expect(src(file), `${file} cites no PATHS:: source`).toContain(cite);
    }
  });

  it('opens none of its OWN documents through the OS picker', () => {
    // Narrowed to KiCad document types on purpose. A bitmap picker is allowed
    // to stay: `accept="image/*"` needs bytes, which the chooser cannot hand
    // back yet — see the block below. What must not survive is a hidden input
    // that takes a `.kicad_*` file, because that is the account's own document
    // being asked for from the local disk.
    for (const [file] of [...wired, ['editors/schematic/SchematicEditor.tsx']] as [string][]) {
      const body = code(src(file));
      for (const m of body.matchAll(/<input[\s\S]{0,240}?type="file"[\s\S]{0,240}?\/>/g)) {
        expect(m[0], `${file} picks a KiCad document off the local disk`).not.toMatch(
          /accept="[^"]*\.kicad_/,
        );
      }
    }
  });
});

describe('what is deliberately NOT wired, and why', () => {
  /**
   * Said here rather than discovered later. Both need a capability the chooser
   * does not have yet, and neither is a wiring job:
   *
   *   GerbView          opens MANY files at once - a whole plot folder - and one
   *                     of them may be a .zip. `FileChooser` selects one file
   *                     and `OpenFileDialog` hands back text, so this needs
   *                     multi-select and bytes first.
   *   Image converter   takes a bitmap. Same bytes problem.
   *
   * The schematic's `Place > Image` and the hotkey importer are the same shape.
   */
  it('leaves GerbView and the image converter on the OS picker for now', () => {
    for (const file of ['editors/gerbview/GerberViewer.tsx', 'editors/image/ImageConverter.tsx']) {
      expect(code(src(file)), `${file} was wired without multi-select or bytes`).toContain(
        'type="file"',
      );
    }
  });

  it('so the chooser still cannot do either, which is what blocks them', () => {
    const chooser = code(src('fs/FileChooser.tsx'));
    // One selection, not a set. When this becomes a set, GerbView can move.
    expect(chooser).toContain('const [selected, setSelected] = useState<string | null>(null);');
    // And the open dialog decodes to text rather than handing bytes over.
    expect(code(src('fs/OpenFileDialog.tsx'))).toContain('new TextDecoder().decode(bytes)');
  });
});

describe('a Save As opens where upstream opens it, which is not one answer', () => {
  /**
   * The two dialogs differ ON PURPOSE, and both were checked rather than
   * assumed:
   *
   *   pl_editor, Save Drawing Sheet As
   *       wxFileDialog( ..., PATHS::GetUserTemplatesPath(), wxEmptyString, ... )
   *       (pagelayout_editor/files.cpp:199-202) — the shared templates folder,
   *       and NO suggested name. Confirmed by building that very dialog and
   *       asking it: wx's GetFilename() and GTK's current-name are both empty
   *       (qa/probes/savedlg_probe.cpp).
   *
   *   eeschema, Save Current Sheet Copy As
   *       wxFileDialog( ..., curr_fn.GetPath(), curr_fn.GetFullName(), ... )
   *       (sch_editor_control.cpp, SaveCurrSheetCopyAs) — the folder the
   *       sheet's own file sits in, and that file's own name UNCHANGED.
   *
   * Ours gave the second a name and no directory, so it opened at the account
   * root listing every project. And the name it seeded was the whole
   * project-relative path where upstream seeds the leaf — invisible until a
   * sheet lives in a subfolder.
   *
   * Upstream appends nothing to that name. There is no "_copy": the word is in
   * the command's FriendlyName (sch_actions.cpp:1623) and nowhere else.
   */
  const SCH = src('editors/schematic/SchematicEditor.tsx');
  const PL = src('editors/drawingsheet/DrawingSheetEditor.tsx');

  it('opens the sheet copy in the folder that sheet already lives in', () => {
    expect(SCH).toContain('initialPath: sheetDirOf(projectName, copyAsSeed)');
  });

  it('walks a sub-sheet to ITS folder, not the project root', () => {
    // `curr_fn.GetPath()` of `sub/amp.kicad_sch` is `sub`, not the project.
    const body = SCH.slice(SCH.indexOf('const sheetDirOf ='));
    expect(body.slice(0, body.indexOf('\n  };'))).toContain('parts.pop();');
  });

  it('suggests the file’s own LEAF, and appends nothing to it', () => {
    expect(SCH).toContain('initialName={basename(copyAsSeed)}');
    // The suffix upstream does not add. Matching /copy/ over the element does
    // not work - the seed is literally called `copyAsSeed` - so read the prop's
    // own expression and require it to be the bare call: no template literal,
    // no concatenation, nothing appended.
    const el = [...SCH.matchAll(/<SaveAsDialog\b[\s\S]*?\/>/g)].map((m) => m[0]).join('\n');
    const prop = el.match(/initialName=\{([^}]*)\}/);
    expect(prop, 'the copy-as dialog seeds no name at all').not.toBeNull();
    expect(
      (prop as RegExpMatchArray)[1]?.trim(),
      'something is appended to the suggested name',
    ).toBe('basename(copyAsSeed)');
  });

  it('leaves the drawing sheet opening on Templates with an empty name', () => {
    // The other half. A change that "made Save As consistent" would break this,
    // and consistency is not what upstream does.
    expect(PL).toContain('kind="templates"');
    expect(PL).toContain('initialName=""');
  });
});

describe('a Save As asks before it replaces a file', () => {
  /**
   * `wxFD_OVERWRITE_PROMPT` is in every Save As upstream passes —
   * pagelayout_editor/files.cpp:201, sch_editor_control.cpp's
   * SaveCurrSheetCopyAs, and the rest. On GTK the flag becomes
   * `gtk_file_chooser_set_do_overwrite_confirmation`, and the chooser puts up
   * its own confirmation before handing the path back.
   *
   * Ours had none. `acceptNow` accepted `join(dir, name)` with no existence
   * check, so a Save As over an existing file replaced it silently — and
   * SaveAsDialog carried a comment asserting the opposite, which is worse than
   * no comment: it is the only thing that would have been read before someone
   * concluded the feature was there.
   *
   * The two sentences are the strings in the libgtk-3 on this machine, read out
   * of the binary rather than remembered — two spaces after each full stop
   * included.
   */
  const CH = src('fs/FileChooser.tsx');

  it('checks for a clash before accepting', () => {
    expect(CH).toContain('if (clash) {');
    expect(CH).toContain('setConfirmOverwrite(target);');
  });

  it('reads the WHOLE listing, not the filtered one', () => {
    // `shown` is what survives the wildcard and the search box. A file hidden
    // by the current filter still exists and would still be overwritten, so
    // checking the visible list would clobber exactly the file a person cannot
    // see.
    expect(CH).toContain('const clash = (entries ?? []).some(');
    expect(CH, 'the clash check reads the filtered list').not.toMatch(/const clash = \(shown/);
  });

  it('does not count a folder of that name as a file to replace', () => {
    expect(CH).toContain("e.kind !== 'folder'");
  });

  it('uses GTK’s own two sentences', () => {
    expect(CH).toContain('already exists.  Do you want to replace it?');
    expect(CH).toContain('Replacing it will overwrite its contents.');
  });

  it('offers Replace and Cancel, with Cancel holding the focus', () => {
    // Two answers, not three: there is no rename button. Cancel returns to the
    // chooser with the name still typed, which is where a person changes it.
    expect(CH).toContain("labels={{ yes: 'Replace', no: 'Cancel' }}");
    expect(CH).toContain('defaultButton="no"');
  });

  it('replaces only on Replace', () => {
    expect(CH).toContain("if (r === 'yes') acceptPath(target);");
  });

  it('no longer claims to do this in a comment while not doing it', () => {
    expect(src('fs/SaveAsDialog.tsx')).not.toContain(
      'it asks before replacing a\n * file that exists, so there is nothing to add here',
    );
  });
});

describe('the overwrite confirmation dismisses itself, not the file manager', () => {
  /**
   * Akshay: cancelling the replace prompt closed the whole chooser, so the name
   * he was about to change went with it.
   *
   * The confirmation renders as a sibling of `.ze-chooser`, INSIDE the backdrop
   * whose `onMouseDown` is `onCancel` for the whole dialog — so a mousedown on
   * its Cancel button bubbled up and closed everything. Esc was already right:
   * `useModalEscape` is a stack and only the topmost dialog answers.
   */
  const CH = src('fs/FileChooser.tsx');

  it('stops its mousedown reaching the backdrop above it', () => {
    const at = CH.indexOf('{confirmOverwrite !== null && (');
    expect(at, 'the confirmation is gone').toBeGreaterThan(0);
    expect(CH.slice(at, at + 400)).toContain('onMouseDown={(e) => e.stopPropagation()}');
  });

  it('leaves the chooser standing, with the name still typed', () => {
    // Only `setConfirmOverwrite(null)` on a cancel — nothing calls onCancel.
    const at = CH.indexOf('onResult={(r) => {');
    const body = CH.slice(at, CH.indexOf('}}', at));
    expect(body).toContain('setConfirmOverwrite(null);');
    expect(body, 'cancelling the prompt cancels the chooser').not.toContain('onCancel');
  });
});

describe('a save dialog opens with the Name box ready to type in', () => {
  /**
   * [px] asked of a real one. `qa/probes/savedlg_probe.cpp` builds the
   * wxFileDialog and asks GTK which widget has the focus and what is selected:
   *
   *     focused widget = GtkFileChooserEntry
   *     entry text     = 'complex_hierarchy.kicad_sch'
   *     selection      = yes [0..17]
   *
   * 17 is the length of `complex_hierarchy`: the extension is NOT selected, so
   * typing replaces the stem and keeps `.kicad_sch`. Ours opened with the focus
   * nowhere — no ring to say where the name goes, and nothing to type over.
   */
  const CH = src('fs/FileChooser.tsx');

  it('focuses the Name entry when the dialog opens', () => {
    expect(CH).toContain('el.focus();');
    expect(CH).toContain('ref={nameRef}');
  });

  it('selects the stem and leaves the extension out of it', () => {
    expect(CH).toContain("const dot = el.value.lastIndexOf('.');");
    expect(CH).toContain('el.setSelectionRange(0, dot > 0 ? dot : el.value.length);');
  });

  it('uses the LAST dot, so a dotted name keeps only its real extension', () => {
    // `board.v2.kicad_sch` must keep `.kicad_sch`, not `.v2.kicad_sch`.
    expect(CH, 'the first dot would eat part of the name').not.toContain("el.value.indexOf('.')");
  });

  it('does not do it in the OPEN dialog, which has no Name entry', () => {
    expect(CH).toContain("if (mode !== 'save') return;");
  });
});

describe('the extension is fixed on accept, not locked in the entry', () => {
  /**
   * The Name entry is a plain text field upstream too - GTK does not lock the
   * extension and KiCad does not nag about it. `EnsureFileExtension`
   * (common/common.cpp:662-678) fixes it when the path comes back, and its own
   * comment says why it APPENDS rather than replaces:
   *
   *     It's annoying to throw up nag dialogs when the extension isn't right.
   *     Just fix it, but be careful not to destroy existing after-dot-text that
   *     isn't actually a bad extension, such as "Schematic_1.1".
   *
   * It cannot tell a typo'd extension from a real part of the name, so it keeps
   * both.
   */
  it('appends without destroying what is already after the dot', () => {
    const sch = KICAD_SCHEMATIC_FILE_EXTENSION;
    // The case Akshay asked about: a mangled extension is KEPT and the real one
    // added after it.
    expect(ensureFileExtension('.kicad-ygyv_sch', sch)).toBe('.kicad-ygyv_sch.kicad_sch');
    expect(ensureFileExtension('foo.kicad-ygyv_sch', sch)).toBe('foo.kicad-ygyv_sch.kicad_sch');
    // The case upstream's comment names by hand.
    expect(ensureFileExtension('Schematic_1.1', sch)).toBe('Schematic_1.1.kicad_sch');
  });

  it('leaves a name that already ends in the extension alone, whatever its case', () => {
    // `newFilename.Lower().AfterLast( '.' )` — the compare is lowered, the name
    // is not, so the user's own capitalisation survives.
    expect(ensureFileExtension('foo.kicad_sch', KICAD_SCHEMATIC_FILE_EXTENSION)).toBe(
      'foo.kicad_sch',
    );
    expect(ensureFileExtension('foo.KICAD_SCH', KICAD_SCHEMATIC_FILE_EXTENSION)).toBe(
      'foo.KICAD_SCH',
    );
  });

  it('adds no second dot to a name that already ends in one', () => {
    // `if( !newFilename.EndsWith( '.' ) ) newFilename.Append( '.' );`
    expect(ensureFileExtension('foo.', KICAD_SCHEMATIC_FILE_EXTENSION)).toBe('foo.kicad_sch');
  });

  it('is the ONE function, not a regex per editor', () => {
    // The drawing sheet had `/\.kicad_wks$/i.test(leaf) ? leaf : leaf + '.kicad_wks'`
    // — the shared function written out again, and not the same function: a
    // trailing dot gave `foo..kicad_wks` where upstream gives `foo.kicad_wks`.
    expect(ensureFileExtension('foo.', DRAWING_SHEET_FILE_EXTENSION)).toBe('foo.kicad_wks');
    // There is no source scan here, and that is deliberate. Two attempts at one
    // both fired on innocent code: first every `/\.kicad_sch$/i.test(name)` that
    // merely FILTERS a file list (there are eight), then every template literal
    // building a name - one comparing against a `.kicad_pro`, one making a
    // DEFAULT name for a new document. Neither is "fix the extension of a name
    // the user typed", and a pattern cannot tell them apart. What can be
    // asserted precisely is that the one call site that does that job calls the
    // shared function, and that the function behaves as upstream's does.
    expect(src('editors/drawingsheet/DrawingSheetEditor.tsx')).toContain(
      'ensureFileExtension(leaf, DRAWING_SHEET_FILE_EXTENSION)',
    );
  });
});
